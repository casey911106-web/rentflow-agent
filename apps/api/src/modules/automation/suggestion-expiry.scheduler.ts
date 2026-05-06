import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

const EXPIRY_HOURS = 24;

/**
 * Marks pending Suggestions older than EXPIRY_HOURS as 'expired'. Stale
 * pending suggestions clutter the inbox and the operator's WhatsApp
 * history with buttons that point at no-longer-relevant context. Expiring
 * them clears the queue and ensures any subsequent inbound from the same
 * lead generates a fresh suggestion based on current state.
 */
@Injectable()
export class SuggestionExpiryScheduler {
  private readonly logger = new Logger(SuggestionExpiryScheduler.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'suggestion-expiry-sweep' })
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - EXPIRY_HOURS * 60 * 60 * 1000);
      const result = await this.prisma.suggestion.updateMany({
        where: { status: 'pending', createdAt: { lt: cutoff } },
        data: { status: 'expired', decidedAt: new Date() },
      });
      if (result.count > 0) {
        this.logger.log(`Expired ${result.count} pending suggestion(s) older than ${EXPIRY_HOURS}h`);
      }
    } catch (err) {
      this.logger.error(`Suggestion expiry sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runManually(): Promise<{ expired: number }> {
    const cutoff = new Date(Date.now() - EXPIRY_HOURS * 60 * 60 * 1000);
    const result = await this.prisma.suggestion.updateMany({
      where: { status: 'pending', createdAt: { lt: cutoff } },
      data: { status: 'expired', decidedAt: new Date() },
    });
    return { expired: result.count };
  }
}
