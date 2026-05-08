import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CostsService } from './costs.service';

/**
 * Daily 02:00 UTC roll-up: for each tenant, write CostEntry rows summarising
 * yesterday's Anthropic API spend, Meta WhatsApp template sends, and pro-rata
 * subscription cost. Idempotent — re-running the same day is a no-op because
 * each day is keyed by ISO date inside metadata.
 */
@Injectable()
export class CostsScheduler {
  private readonly logger = new Logger(CostsScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: CostsService,
  ) {}

  @Cron('0 2 * * *', { name: 'costs-daily-rollup', timeZone: 'UTC' })
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const companies = await this.prisma.company.findMany({ where: { deletedAt: null } });
      for (const c of companies) {
        try {
          const result = await this.costs.rollDailyForCompany(c.id, yesterday);
          if (!result.skipped) {
            this.logger.log(
              `Cost roll-up ${result.dayLabel} for ${c.id}: anthropic=${result.anthropicEntries}, wa=${result.whatsappTemplates}, subs=${result.subscriptionEntries}`,
            );
          }
        } catch (err) {
          this.logger.error(`Cost roll-up failed for ${c.id}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Manual backfill for ops debugging. */
  async runManually(day?: string) {
    const target = day ? new Date(day) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const companies = await this.prisma.company.findMany({ where: { deletedAt: null } });
    const results = [] as unknown[];
    for (const c of companies) {
      results.push({ companyId: c.id, ...(await this.costs.rollDailyForCompany(c.id, target)) });
    }
    return results;
  }
}
