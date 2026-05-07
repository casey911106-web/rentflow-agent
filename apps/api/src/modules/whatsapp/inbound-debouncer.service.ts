import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadWorkflowRunner } from './lead-workflow.runner';

const DEBOUNCE_MS = 10_000;

interface PendingRun {
  companyId: string;
  leadId: string;
  conversationId: string;
}

/**
 * Debounces lead-workflow execution per WhatsApp conversation. People often
 * type messages line by line; without this, every line would spawn a Claude
 * call and a separate operator suggestion. We wait DEBOUNCE_MS after the
 * last inbound, then process the conversation once with the full context.
 *
 * In-memory only — if the API restarts mid-window we miss the auto-trigger,
 * but the next inbound (or proactive cron) will pick it up.
 */
@Injectable()
export class InboundDebouncer implements OnModuleDestroy {
  private readonly logger = new Logger(InboundDebouncer.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: LeadWorkflowRunner,
  ) {}

  schedule(input: PendingRun): void {
    const existing = this.timers.get(input.conversationId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(input.conversationId);
      void this.fire(input);
    }, DEBOUNCE_MS);
    this.timers.set(input.conversationId, timer);
  }

  private async fire(input: PendingRun) {
    try {
      const latestInbound = await this.prisma.whatsAppMessage.findFirst({
        where: { conversationId: input.conversationId, direction: 'inbound' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!latestInbound) return;
      await this.runner.run({
        companyId: input.companyId,
        leadId: input.leadId,
        conversationId: input.conversationId,
        inboundMessageId: latestInbound.id,
      });
    } catch (err) {
      this.logger.error(
        `Debounced runner failed for conversation=${input.conversationId}: ${(err as Error).message}`,
      );
    }
  }

  onModuleDestroy() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
