import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from '../whatsapp/adapter.provider';

const SLOT_MINUTES = 30;
const DAY_START_HOUR = 9; // 09:00 Asia/Dubai
const DAY_END_HOUR = 21; // 21:00 Asia/Dubai
const WINDOW_DAYS = 7;
const RESCHEDULE_CUTOFF_HOURS = 1; // can reschedule up to 1h before

interface Slot {
  start: Date;
  isoLocal: string;
  taken: boolean;
}

interface PublicSlotResponse {
  property: { code: string; name: string; area: string | null; priceAed: unknown };
  current?: { startsAt: string };
  canReschedule: boolean;
  slots: Slot[];
  expiresAt: string;
  isReschedule: boolean;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waAdapter: WhatsAppAdapterProvider,
  ) {}

  /** Issue a fresh booking token (called from the AI agent flow). */
  async issueBookingToken(companyId: string, leadId: string, propertyCode: string) {
    const property = await this.prisma.property.findFirst({
      where: { companyId, code: propertyCode, deletedAt: null },
    });
    if (!property) throw new NotFoundException('Property not found');
    return this.createToken(companyId, leadId, property.id, null);
  }

  /** Issue a reschedule token attached to an existing viewing. */
  async issueRescheduleToken(companyId: string, viewingId: string) {
    const viewing = await this.prisma.viewing.findFirst({
      where: { id: viewingId, companyId },
    });
    if (!viewing) throw new NotFoundException();
    return this.createToken(companyId, viewing.leadId, viewing.propertyId, viewing.id);
  }

  private async createToken(
    companyId: string,
    leadId: string,
    propertyId: string,
    viewingId: string | null,
  ) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return this.prisma.viewingScheduleToken.create({
      data: { companyId, leadId, propertyId, viewingId, expiresAt },
      select: { id: true, expiresAt: true },
    });
  }

  /** Public view — what the scheduler page calls on load. */
  async publicView(tokenId: string): Promise<PublicSlotResponse> {
    const token = await this.prisma.viewingScheduleToken.findUnique({
      where: { id: tokenId },
      include: {
        property: { select: { code: true, name: true, area: true, priceAed: true, status: true } },
        viewing: { select: { id: true, scheduledAt: true, status: true } },
      },
    });
    if (!token) throw new NotFoundException('Invalid scheduler link');
    if (token.usedAt) throw new BadRequestException('This scheduler link has already been used.');
    if (token.expiresAt < new Date()) throw new BadRequestException('Scheduler link expired. Ask us for a fresh one.');
    if (token.property.status !== 'available') {
      throw new BadRequestException('This property is no longer available. Ask us for alternatives.');
    }

    const isReschedule = !!token.viewingId;
    let canReschedule = true;
    if (isReschedule && token.viewing) {
      const cutoff = new Date(Date.now() + RESCHEDULE_CUTOFF_HOURS * 60 * 60 * 1000);
      canReschedule = new Date(token.viewing.scheduledAt) > cutoff;
    }

    const slots = await this.computeSlots(token.companyId, token.propertyId);

    return {
      property: token.property,
      current: token.viewing ? { startsAt: token.viewing.scheduledAt.toISOString() } : undefined,
      canReschedule,
      slots,
      expiresAt: token.expiresAt.toISOString(),
      isReschedule,
    };
  }

  /** Lead picks a slot. Books or reschedules. */
  async commit(tokenId: string, isoStart: string, leadName?: string) {
    const token = await this.prisma.viewingScheduleToken.findUnique({
      where: { id: tokenId },
      include: { viewing: true, property: true, lead: true },
    });
    if (!token) throw new NotFoundException();
    if (token.usedAt) throw new BadRequestException('Already used');
    if (token.expiresAt < new Date()) throw new BadRequestException('Expired');

    const startsAt = new Date(isoStart);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('Invalid date');
    const minDate = new Date(Date.now() + 60 * 60 * 1000); // not less than 1h from now
    if (startsAt < minDate) throw new BadRequestException('Pick a slot at least 1h from now.');

    // Re-validate slot still free
    const conflict = await this.findConflict(token.companyId, token.propertyId, startsAt, token.viewingId);
    if (conflict) throw new BadRequestException('That slot was just taken — pick another.');

    let viewing;
    if (token.viewing) {
      // reschedule
      const cutoff = new Date(token.viewing.scheduledAt.getTime() - RESCHEDULE_CUTOFF_HOURS * 60 * 60 * 1000);
      if (new Date() > cutoff) {
        throw new BadRequestException('Cannot reschedule less than 1h before the viewing.');
      }
      viewing = await this.prisma.viewing.update({
        where: { id: token.viewing.id },
        data: { scheduledAt: startsAt, status: 'rescheduled' },
        include: { fieldAgent: { include: { user: true } }, property: true, lead: true },
      });
    } else {
      // new booking — apply round-robin agent
      const agent = await this.pickFieldAgent(token.companyId);
      viewing = await this.prisma.viewing.create({
        data: {
          companyId: token.companyId,
          leadId: token.leadId,
          propertyId: token.propertyId,
          fieldAgentId: agent?.id ?? null,
          status: agent ? 'assigned' : 'requested',
          assignmentStatus: agent ? 'accepted' : 'pending',
          scheduledAt: startsAt,
          durationMinutes: SLOT_MINUTES,
        },
        include: { fieldAgent: { include: { user: true } }, property: true, lead: true },
      });
    }

    // Update lead name if missing and provided
    if (leadName && !token.lead.fullName) {
      await this.prisma.lead.update({ where: { id: token.leadId }, data: { fullName: leadName } });
    }

    await this.prisma.viewingScheduleToken.update({
      where: { id: tokenId },
      data: { usedAt: new Date(), viewingId: viewing.id },
    });

    // Send WhatsApp confirmation (free text inside 24h window)
    await this.sendConfirmationWhatsApp(viewing);

    // Notify field agent in-app
    if (viewing.fieldAgentId && viewing.fieldAgent?.user) {
      await this.prisma.notification.create({
        data: {
          companyId: token.companyId,
          userId: viewing.fieldAgent.user.id,
          kind: 'info',
          title: `New viewing assigned — ${viewing.property.code}`,
          body: `${viewing.lead.fullName ?? viewing.lead.phoneE164} on ${this.fmtDate(viewing.scheduledAt)}`,
          link: `/viewing/${viewing.id}`,
        },
      });
    }

    return {
      viewingId: viewing.id,
      scheduledAt: viewing.scheduledAt.toISOString(),
      agentName: viewing.fieldAgent?.user?.fullName ?? null,
      property: { code: viewing.property.code, name: viewing.property.name },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Slot computation
  // ────────────────────────────────────────────────────────────────────

  private async computeSlots(companyId: string, propertyId: string): Promise<Slot[]> {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const horizon = new Date(dayStart.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Existing bookings for this property
    const existing = await this.prisma.viewing.findMany({
      where: {
        companyId,
        propertyId,
        scheduledAt: { gte: dayStart, lte: horizon },
        status: { notIn: ['cancelled', 'lost'] },
      },
      select: { scheduledAt: true, durationMinutes: true },
    });
    const taken = new Set<string>();
    for (const v of existing) {
      const start = v.scheduledAt.getTime();
      const end = start + (v.durationMinutes ?? SLOT_MINUTES) * 60_000;
      for (let t = start; t < end; t += SLOT_MINUTES * 60_000) {
        taken.add(new Date(t).toISOString());
      }
    }

    const slots: Slot[] = [];
    const oneHourFromNow = now.getTime() + 60 * 60 * 1000;

    for (let d = 0; d < WINDOW_DAYS; d++) {
      const day = new Date(dayStart.getTime() + d * 24 * 60 * 60 * 1000);
      // Asia/Dubai is UTC+4 (no DST). DAY_START_HOUR / DAY_END_HOUR are local.
      // We approximate by treating slots as UTC h-4 (i.e. local 09:00 = UTC 05:00).
      for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
        for (let m = 0; m < 60; m += SLOT_MINUTES) {
          const utcStart = new Date(day);
          utcStart.setUTCHours(h - 4, m, 0, 0);
          if (utcStart.getTime() < oneHourFromNow) continue;
          slots.push({
            start: utcStart,
            isoLocal: utcStart.toISOString(),
            taken: taken.has(utcStart.toISOString()),
          });
        }
      }
    }
    return slots;
  }

  private async findConflict(
    companyId: string,
    propertyId: string,
    startsAt: Date,
    excludeViewingId: string | null,
  ) {
    return this.prisma.viewing.findFirst({
      where: {
        companyId,
        propertyId,
        scheduledAt: startsAt,
        status: { notIn: ['cancelled', 'lost'] },
        ...(excludeViewingId ? { id: { not: excludeViewingId } } : {}),
      },
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Round-robin field agent
  // ────────────────────────────────────────────────────────────────────

  private async pickFieldAgent(companyId: string) {
    const agents = await this.prisma.fieldAgent.findMany({
      where: { companyId, active: true, user: { deletedAt: null, status: 'active' } },
      include: { user: true },
    });
    if (agents.length === 0) return null;

    // Sort by least-recent assignedViewing (LRU). Get last assigned timestamp.
    const last = await this.prisma.viewing.groupBy({
      by: ['fieldAgentId'],
      where: { companyId, fieldAgentId: { in: agents.map((a) => a.id) } },
      _max: { createdAt: true },
    });
    const lastMap = new Map(last.map((r) => [r.fieldAgentId!, r._max.createdAt]));
    agents.sort((a, b) => {
      const ta = lastMap.get(a.id)?.getTime() ?? 0;
      const tb = lastMap.get(b.id)?.getTime() ?? 0;
      return ta - tb;
    });
    return agents[0];
  }

  // ────────────────────────────────────────────────────────────────────
  // WhatsApp confirmation
  // ────────────────────────────────────────────────────────────────────

  private async sendConfirmationWhatsApp(viewing: {
    id: string;
    companyId: string;
    scheduledAt: Date;
    property: { code: string; name: string };
    lead: { phoneE164: string; fullName: string | null };
    fieldAgent: { user: { fullName: string } | null } | null;
  }) {
    const date = this.fmtDate(viewing.scheduledAt);
    const agentName = viewing.fieldAgent?.user?.fullName ?? null;
    const text = agentName
      ? `✓ Viewing confirmed for ${viewing.property.code} — ${viewing.property.name} on ${date}.\n\n${agentName} will meet you. They'll WhatsApp 30 min before with arrival details.`
      : `✓ Viewing confirmed for ${viewing.property.code} — ${viewing.property.name} on ${date}.\n\nWe'll confirm the agent shortly.`;

    try {
      const conv = await this.prisma.whatsAppConversation.findFirst({
        where: { companyId: viewing.companyId, leadPhoneE164: viewing.lead.phoneE164 },
      });
      const conversationId = conv?.id ?? `lead:${viewing.lead.phoneE164}`;
      await this.waAdapter.adapter.sendText({
        to: viewing.lead.phoneE164,
        body: text,
        conversationId,
      });
      if (conv) {
        await this.prisma.whatsAppMessage.create({
          data: {
            companyId: viewing.companyId,
            conversationId: conv.id,
            direction: 'outbound',
            type: 'text',
            body: text,
            providerStatus: 'sent',
          },
        });
      }
    } catch (err) {
      this.logger.warn(`Confirm WA send failed: ${(err as Error).message}`);
    }
  }

  private fmtDate(d: Date): string {
    return d.toLocaleString('en-GB', {
      timeZone: 'Asia/Dubai',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
