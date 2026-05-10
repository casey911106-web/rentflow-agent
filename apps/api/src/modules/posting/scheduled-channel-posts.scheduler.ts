import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingService } from './posting.service';

/**
 * Picks up ScheduledChannelPost rows whose `scheduledFor` has passed and
 * fires the same auto-publish path the "Publish now" button uses. The
 * worker runs every minute so the worst-case slip is ~60s, which is fine
 * for owned-channel posts.
 *
 * Failure mode: each row's status moves to 'failed' with the error
 * message captured. Ops can re-schedule by creating a new row.
 */
@Injectable()
export class ScheduledChannelPostsScheduler {
  private readonly logger = new Logger(ScheduledChannelPostsScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'scheduled-channel-posts' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error(`Scheduled channel posts tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Manual trigger for ops debugging. */
  runManually() {
    return this.runOnce();
  }

  private async runOnce(): Promise<{ fired: number; failed: number }> {
    const due = await this.prisma.scheduledChannelPost.findMany({
      where: {
        status: 'pending',
        scheduledFor: { lte: new Date() },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 20, // soft cap per tick to spread load
      include: { postPackage: { select: { companyId: true } } },
    });
    if (due.length === 0) return { fired: 0, failed: 0 };

    let fired = 0;
    let failed = 0;
    for (const job of due) {
      // Optimistic claim — flip status to 'attempting' first so a parallel
      // worker (or a duplicate cron tick) can't double-fire the same job.
      const claimed = await this.prisma.scheduledChannelPost.updateMany({
        where: { id: job.id, status: 'pending' },
        data: { status: 'attempting', attemptedAt: new Date() },
      });
      if (claimed.count === 0) continue; // someone else got it

      // The job's createdById is the user who scheduled it. We attribute
      // the resulting placement to them so the leaderboard reflects the
      // operator who set this up — not a synthetic system user.
      const userId = job.createdById ?? '';
      try {
        const placement = await this.posting.autoPublish(
          job.companyId,
          job.postPackageId,
          userId,
          { channelId: job.channelId, caption: job.caption },
        );
        await this.prisma.scheduledChannelPost.update({
          where: { id: job.id },
          data: {
            status: 'done',
            placementId: (placement as { id?: string } | null)?.id ?? null,
            errorMessage: null,
          },
        });
        fired++;
      } catch (err) {
        const msg = (err as Error).message;
        await this.prisma.scheduledChannelPost.update({
          where: { id: job.id },
          data: { status: 'failed', errorMessage: msg.slice(0, 1000) },
        });
        this.logger.error(`Scheduled post ${job.id} failed: ${msg}`);
        failed++;
      }
    }
    if (fired > 0 || failed > 0) {
      this.logger.log(`Scheduled channel posts tick: fired=${fired} failed=${failed}`);
    }
    return { fired, failed };
  }
}
