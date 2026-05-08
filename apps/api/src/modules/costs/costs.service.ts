import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const USD_TO_AED = 3.6725; // peg, stable

// Anthropic pricing per 1M tokens (USD). Sonnet 4.6 default; Opus / Haiku
// fall through to their own rates.
const ANTHROPIC_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number }> = {
  'claude-sonnet-4-6':   { input: 3,    output: 15,   cacheRead: 0.30,  cacheCreation: 3.75  },
  'claude-sonnet-4-5':   { input: 3,    output: 15,   cacheRead: 0.30,  cacheCreation: 3.75  },
  'claude-opus-4-7':     { input: 5,    output: 25,   cacheRead: 0.50,  cacheCreation: 6.25  },
  'claude-opus-4-6':     { input: 5,    output: 25,   cacheRead: 0.50,  cacheCreation: 6.25  },
  'claude-haiku-4-5':    { input: 1,    output: 5,    cacheRead: 0.10,  cacheCreation: 1.25  },
};

// Meta WhatsApp Cloud API conversation rates (UAE), AED per conversation.
// User-initiated within the 24h window is free for replies; only template-
// initiated business conversations are charged.
const META_WA_PRICE_AED: Record<string, number> = {
  marketing:      0.30,
  utility:        0.07,
  authentication: 0.06,
  service:        0,    // free in 24h window
};

interface CreateManualEntryDto {
  kind: string;
  label: string;
  amountAed: number;
  amountUsd?: number;
  incurredAt?: string;
  metadata?: Record<string, unknown>;
}

interface CreateSubscriptionDto {
  label: string;
  kind?: string;
  amountAed: number;
  cadence: 'monthly' | 'yearly';
  startsAt: string;
  endsAt?: string;
  notes?: string;
}

@Injectable()
export class CostsService {
  private readonly logger = new Logger(CostsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────
  // Read APIs (dashboard)
  // ────────────────────────────────────────────────────────────────────

  async summary(companyId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [thisMonth, lastMonth, ytd, byKindThisMonth] = await Promise.all([
      this.sum(companyId, monthStart, now),
      this.sum(companyId, lastMonthStart, lastMonthEnd),
      this.sum(companyId, yearStart, now),
      this.prisma.costEntry.groupBy({
        by: ['kind'],
        where: { companyId, incurredAt: { gte: monthStart, lte: now } },
        _sum: { amountAed: true },
      }),
    ]);

    // Forecast next 12 months from active subscriptions + 30-day trailing
    // average of variable costs (Anthropic + WA).
    const subs = await this.prisma.costSubscription.findMany({
      where: { companyId, active: true },
    });
    const monthlyFixed = subs.reduce((sum, s) => {
      const m = Number(s.amountAed);
      return sum + (s.cadence === 'monthly' ? m : m / 12);
    }, 0);
    const last30 = await this.sum(companyId, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), now, ['anthropic_api', 'meta_whatsapp']);
    const monthlyVariable = last30; // last 30 days variable as next-month estimate
    const forecast12m = (monthlyFixed + monthlyVariable) * 12;

    return {
      thisMonthAed: thisMonth,
      lastMonthAed: lastMonth,
      ytdAed: ytd,
      forecast12mAed: forecast12m,
      byKindThisMonth: byKindThisMonth.map((r) => ({
        kind: r.kind,
        amountAed: Number(r._sum.amountAed ?? 0),
      })),
      activeSubscriptionsMonthlyAed: monthlyFixed,
    };
  }

  list(companyId: string, opts: { kind?: string; limit?: number } = {}) {
    return this.prisma.costEntry.findMany({
      where: { companyId, ...(opts.kind ? { kind: opts.kind } : {}) },
      orderBy: { incurredAt: 'desc' },
      take: opts.limit ?? 100,
      include: { subscription: { select: { label: true } } },
    });
  }

  listSubscriptions(companyId: string) {
    return this.prisma.costSubscription.findMany({
      where: { companyId },
      orderBy: [{ active: 'desc' }, { label: 'asc' }],
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Write APIs
  // ────────────────────────────────────────────────────────────────────

  createManualEntry(companyId: string, dto: CreateManualEntryDto) {
    if (!dto.label?.trim()) throw new BadRequestException('label is required');
    if (!dto.amountAed || dto.amountAed < 0) throw new BadRequestException('amountAed must be > 0');
    return this.prisma.costEntry.create({
      data: {
        companyId,
        kind: dto.kind,
        label: dto.label,
        amountAed: dto.amountAed,
        amountUsd: dto.amountUsd ?? null,
        sourceType: 'manual',
        incurredAt: dto.incurredAt ? new Date(dto.incurredAt) : new Date(),
        metadata: (dto.metadata ?? {}) as never,
      },
    });
  }

  async deleteEntry(companyId: string, id: string) {
    await this.prisma.costEntry.deleteMany({ where: { id, companyId } });
    return { ok: true };
  }

  async createSubscription(companyId: string, dto: CreateSubscriptionDto) {
    if (!['monthly', 'yearly'].includes(dto.cadence)) throw new BadRequestException('invalid cadence');
    if (!dto.amountAed || dto.amountAed < 0) throw new BadRequestException('amountAed must be > 0');
    return this.prisma.costSubscription.create({
      data: {
        companyId,
        label: dto.label,
        kind: dto.kind ?? 'fixed_subscription',
        amountAed: dto.amountAed,
        cadence: dto.cadence,
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        active: true,
        notes: dto.notes ?? null,
      },
    });
  }

  async toggleSubscription(companyId: string, id: string, active: boolean) {
    return this.prisma.costSubscription.updateMany({
      where: { id, companyId },
      data: { active },
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Cron: roll yesterday's variable usage into ledger entries
  // ────────────────────────────────────────────────────────────────────

  async rollDailyForCompany(companyId: string, day: Date) {
    const start = new Date(day);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    // Idempotency: skip if we already wrote yesterday's auto entries.
    const dayLabel = start.toISOString().slice(0, 10);
    const existing = await this.prisma.costEntry.count({
      where: {
        companyId,
        sourceType: { in: ['suggestion', 'whatsapp_message'] },
        metadata: { path: ['day'], equals: dayLabel },
      },
    });
    if (existing > 0) {
      return { skipped: true, dayLabel };
    }

    // 1) Anthropic costs from suggestions
    const sugs = await this.prisma.suggestion.findMany({
      where: { companyId, createdAt: { gte: start, lt: end } },
      select: {
        modelId: true, inputTokens: true, outputTokens: true,
        cacheReadTokens: true, cacheCreationTokens: true,
      },
    });
    const byModel = new Map<string, { input: number; output: number; cacheRead: number; cacheCreation: number; count: number }>();
    for (const s of sugs) {
      const model = s.modelId ?? 'claude-sonnet-4-6';
      if (!byModel.has(model)) byModel.set(model, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, count: 0 });
      const m = byModel.get(model)!;
      m.input += s.inputTokens ?? 0;
      m.output += s.outputTokens ?? 0;
      m.cacheRead += s.cacheReadTokens ?? 0;
      m.cacheCreation += s.cacheCreationTokens ?? 0;
      m.count += 1;
    }

    let anthropicCount = 0;
    for (const [model, t] of byModel) {
      const price = ANTHROPIC_PRICING[model] ?? ANTHROPIC_PRICING['claude-sonnet-4-6']!;
      const usd =
        (t.input / 1_000_000) * price.input +
        (t.output / 1_000_000) * price.output +
        (t.cacheRead / 1_000_000) * price.cacheRead +
        (t.cacheCreation / 1_000_000) * price.cacheCreation;
      if (usd <= 0) continue;
      const aed = Number((usd * USD_TO_AED).toFixed(4));
      await this.prisma.costEntry.create({
        data: {
          companyId,
          kind: 'anthropic_api',
          label: `Anthropic ${model} — ${dayLabel}`,
          amountAed: aed,
          amountUsd: Number(usd.toFixed(4)),
          sourceType: 'suggestion',
          incurredAt: end,
          metadata: { day: dayLabel, model, count: t.count, tokens: t } as never,
        },
      });
      anthropicCount++;
    }

    // 2) WhatsApp template messages (one row aggregated per category we don't
    //    distinguish yet — treat all template outbound as 'utility' cheapest
    //    rate for conservative MVP estimate).
    const templates = await this.prisma.whatsAppMessage.count({
      where: {
        companyId,
        direction: 'outbound',
        type: 'template',
        createdAt: { gte: start, lt: end },
      },
    });
    if (templates > 0) {
      const aed = Number((templates * META_WA_PRICE_AED.utility!).toFixed(4));
      await this.prisma.costEntry.create({
        data: {
          companyId,
          kind: 'meta_whatsapp',
          label: `Meta WhatsApp templates — ${dayLabel} (×${templates})`,
          amountAed: aed,
          sourceType: 'whatsapp_message',
          incurredAt: end,
          metadata: { day: dayLabel, templateCount: templates, rateAed: META_WA_PRICE_AED.utility } as never,
        },
      });
    }

    // 3) Pro-rata from active subscriptions (one row per sub per day)
    const subs = await this.prisma.costSubscription.findMany({
      where: { companyId, active: true, startsAt: { lte: end }, OR: [{ endsAt: null }, { endsAt: { gte: start } }] },
    });
    let subCount = 0;
    for (const sub of subs) {
      const monthlyAed = sub.cadence === 'monthly' ? Number(sub.amountAed) : Number(sub.amountAed) / 12;
      const dailyAed = Number((monthlyAed / 30).toFixed(4));
      await this.prisma.costEntry.create({
        data: {
          companyId,
          kind: sub.kind,
          label: `${sub.label} — ${dayLabel}`,
          amountAed: dailyAed,
          subscriptionId: sub.id,
          sourceType: 'subscription',
          incurredAt: end,
          metadata: { day: dayLabel, cadence: sub.cadence, monthlyAed } as never,
        },
      });
      subCount++;
    }

    return {
      skipped: false,
      dayLabel,
      anthropicEntries: anthropicCount,
      whatsappTemplates: templates,
      subscriptionEntries: subCount,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────────────

  private async sum(companyId: string, gte: Date, lte: Date, kinds?: string[]) {
    const result = await this.prisma.costEntry.aggregate({
      where: {
        companyId,
        incurredAt: { gte, lte },
        ...(kinds ? { kind: { in: kinds } } : {}),
      },
      _sum: { amountAed: true },
    });
    return Number(result._sum.amountAed ?? 0);
  }
}
