import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusPoolService } from '../bonus-pool/bonus-pool.service';

interface SplitInput {
  recipientUserId?: string | null;
  label: string;
  percent: number;
  notes?: string;
}

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonus: BonusPoolService,
  ) {}

  list(companyId: string) {
    return this.prisma.deal.findMany({
      where: { companyId, deletedAt: null },
      include: {
        lead: { select: { id: true, fullName: true, phoneE164: true } },
        property: { select: { id: true, code: true, name: true } },
        commission: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async findById(companyId: string, id: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        lead: true,
        property: true,
        fieldAgent: { include: { user: true } },
        commission: { include: { payments: true } },
        splits: {
          include: { recipient: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  async create(
    companyId: string,
    body: {
      leadId: string;
      propertyId?: string;
      rentAmount?: number;
      depositAmount?: number;
      commissionAmount?: number;
      commissionPaidBy?: string;
      moveInDate?: string;
      rentalDurationMonths?: number;
    },
  ) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: body.leadId, companyId, deletedAt: null },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // Prefer the explicit propertyId the operator picked; fall back to the
    // lead's attributed property. If neither is set the deal can't be created.
    let propertyId = body.propertyId ?? lead.propertyId ?? undefined;
    if (!propertyId) {
      // Last resort: any viewing tied to this lead names a property.
      const v = await this.prisma.viewing.findFirst({
        where: { leadId: lead.id, companyId },
        orderBy: { createdAt: 'desc' },
        select: { propertyId: true },
      });
      propertyId = v?.propertyId ?? undefined;
    }
    if (!propertyId) {
      throw new NotFoundException(
        'Cannot create deal: no property linked to this lead. Pick a property explicitly or attribute the lead first.',
      );
    }

    return this.prisma.deal.create({
      data: {
        companyId,
        leadId: lead.id,
        propertyId,
        status: 'open',
        rentAmount: body.rentAmount,
        depositAmount: body.depositAmount,
        commissionAmount: body.commissionAmount,
        commissionPaidBy: body.commissionPaidBy,
        moveInDate: body.moveInDate ? new Date(body.moveInDate) : undefined,
        rentalDurationMonths: body.rentalDurationMonths,
      },
    });
  }

  async markWon(companyId: string, id: string) {
    const deal = await this.findById(companyId, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.deal.update({
        where: { id },
        data: { status: 'won', closedAt: new Date() },
      });
      if (!deal.commission && deal.commissionAmount) {
        await tx.commission.create({
          data: { dealId: id, status: 'expected', expectedAmount: deal.commissionAmount },
        });
      }
      await tx.lead.update({ where: { id: deal.leadId }, data: { status: 'won' } });
      return u;
    });

    // Auto-generate commission splits using the bonus-pool policy
    // (30% closer / 10% top performer / 10% sourcer or even split / 50%
    // platform). Only kicks in for deals closed on/after the algorithm's
    // effective date so we don't rewrite older deals. Best-effort — log
    // and continue if it fails so the close itself isn't blocked.
    try {
      const splits = await this.bonus.buildDealSplits(id);
      if (splits.length > 0) {
        await this.prisma.$transaction(async (tx) => {
          await tx.commissionSplit.deleteMany({ where: { dealId: id } });
          await tx.commissionSplit.createMany({
            data: splits.map((s) => ({
              companyId,
              dealId: id,
              recipientUserId: s.recipientUserId ?? null,
              label: s.label,
              percent: s.percent,
              notes: s.notes ?? null,
            })),
          });
        });
      }
    } catch (err) {
      this.logger.warn(
        `Bonus pool split generation failed for deal ${id}: ${(err as Error).message}`,
      );
    }

    return updated;
  }

  async markLost(companyId: string, id: string, reason: string) {
    const deal = await this.findById(companyId, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deal.update({
        where: { id },
        data: { status: 'lost', closedAt: new Date(), lostReason: reason },
      });
      await tx.lead.update({ where: { id: deal.leadId }, data: { status: 'lost' } });
      return updated;
    });
  }

  /** Replace ALL splits for a deal in one transaction. Sum of percents must
   *  equal 100. Pass an empty array to clear. */
  async replaceSplits(companyId: string, id: string, splits: SplitInput[]) {
    const deal = await this.findById(companyId, id);
    if (splits.length === 0) {
      await this.prisma.commissionSplit.deleteMany({ where: { dealId: id } });
      return [];
    }
    const total = splits.reduce((acc, s) => acc + Number(s.percent), 0);
    if (Math.abs(total - 100) > 0.01) {
      throw new BadRequestException(`Splits must sum to 100 (got ${total.toFixed(2)})`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.commissionSplit.deleteMany({ where: { dealId: id } });
      return tx.commissionSplit.createMany({
        data: splits.map((s) => ({
          companyId: deal.companyId,
          dealId: id,
          recipientUserId: s.recipientUserId ?? null,
          label: s.label,
          percent: s.percent,
          notes: s.notes ?? null,
        })),
      });
    });
  }

  async upsertCommission(
    companyId: string,
    id: string,
    body: { status?: string; expectedAmount?: number; invoicedAmount?: number; collectedAmount?: number; notes?: string },
  ) {
    const deal = await this.findById(companyId, id);
    return this.prisma.commission.upsert({
      where: { dealId: id },
      update: body as Record<string, unknown>,
      create: {
        dealId: id,
        status: (body.status as 'expected') ?? 'expected',
        expectedAmount: body.expectedAmount ?? deal.commissionAmount ?? 0,
        invoicedAmount: body.invoicedAmount,
        collectedAmount: body.collectedAmount ?? 0,
        notes: body.notes,
      },
    });
  }
}
