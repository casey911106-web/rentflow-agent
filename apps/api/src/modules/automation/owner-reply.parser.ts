import { Injectable, Logger } from '@nestjs/common';
import type { OwnerAvailabilityStatus } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Parses inbound messages from owners and updates the matching
 * OwnerAvailabilityCheck + Property.status accordingly.
 *
 * Heuristic-based for MVP. Replace the classify() with a Claude classify call
 * later if the regex coverage isn't enough.
 */
@Injectable()
export class OwnerReplyParser {
  private readonly logger = new Logger(OwnerReplyParser.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tries to handle an inbound message as an owner reply.
   * Returns true when handled (a pending OwnerAvailabilityCheck existed and
   * was resolved), false otherwise — the caller should fall through to the
   * normal lead workflow.
   */
  async handle(input: {
    companyId: string;
    fromE164: string;
    body: string;
  }): Promise<boolean> {
    // Slash commands (`/property`, `/done`, `/<AgentName>`, etc.) are
    // partner-ingestion semantics. Even if the sender's phone happens to
    // also be registered as an Owner with a pending availability check,
    // a slash-prefixed message should NEVER be parsed as an owner reply.
    if (input.body.trim().startsWith('/')) return false;

    const owner = await this.prisma.owner.findFirst({
      where: { companyId: input.companyId, phoneE164: input.fromE164, deletedAt: null },
    });
    if (!owner) return false;

    // Partner-User takes priority over Owner: if this phone is also a
    // registered partner, route through the partner flow downstream
    // instead of consuming the message as an owner reply.
    const partner = await this.prisma.user.findFirst({
      where: {
        companyId: input.companyId,
        isPartner: true,
        phoneE164: input.fromE164,
        deletedAt: null,
        status: 'active',
      },
      select: { id: true },
    });
    if (partner) return false;

    const pending = await this.prisma.ownerAvailabilityCheck.findFirst({
      where: { ownerId: owner.id, status: 'pending_response' },
      orderBy: { askedAt: 'desc' },
    });
    if (!pending) return false;

    const parsed = this.classify(input.body);
    const property = await this.prisma.property.findUnique({ where: { id: pending.propertyId } });

    await this.prisma.$transaction(async (tx) => {
      await tx.ownerAvailabilityCheck.update({
        where: { id: pending.id },
        data: {
          status: parsed.status,
          repliedAt: new Date(),
          rawReply: input.body,
          parsedReply: parsed as unknown as object,
          nextCheckAt: parsed.nextCheckAt ?? null,
        },
      });

      await tx.ownerMessage.create({
        data: {
          ownerId: owner.id,
          direction: 'inbound',
          type: 'text',
          body: input.body,
          metadata: { matchedCheckId: pending.id, parsedStatus: parsed.status },
        },
      });

      if (property) {
        const updates: Record<string, unknown> = {};
        if (parsed.status === 'available') {
          updates.status = 'available';
          updates.availabilityConfirmedAt = new Date();
        } else if (parsed.status === 'rented') {
          updates.status = 'rented';
          updates.availabilityConfirmedAt = new Date();
          if (parsed.rentedUntil) updates.rentedUntil = parsed.rentedUntil;
        } else if (parsed.status === 'blocked_until_date' && parsed.availableFrom) {
          updates.status = 'blocked';
          updates.rentedUntil = parsed.availableFrom;
        } else if (parsed.status === 'unavailable') {
          updates.status = 'unavailable';
          updates.availabilityConfirmedAt = new Date();
        }
        if (Object.keys(updates).length > 0) {
          await tx.property.update({ where: { id: property.id }, data: updates });
        }
      }

      await tx.owner.update({
        where: { id: owner.id },
        data: { lastContactedAt: new Date() },
      });
    });

    this.logger.log(
      `Owner ${owner.id} reply parsed as ${parsed.status} for property=${pending.propertyId}`,
    );
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  // classifier
  // ──────────────────────────────────────────────────────────────────────

  private classify(text: string): {
    status: OwnerAvailabilityStatus;
    availableFrom?: Date;
    rentedUntil?: Date;
    nextCheckAt?: Date;
  } {
    const t = text.toLowerCase().trim();

    if (/\b(yes|still available|available|sí|si|disponible|متاح)\b/.test(t)) {
      return { status: 'available' };
    }

    const rentedMatch = t.match(/\brented\b.*?(?:until|hasta|till)\s+(.+?)(?:\.|$)/);
    if (rentedMatch) {
      const dt = this.tryParseDate(rentedMatch[1]!);
      return { status: 'rented', rentedUntil: dt };
    }
    if (/\b(rented|taken|booked|alquilado|مؤجر)\b/.test(t)) {
      return { status: 'rented' };
    }

    const availableFromMatch = t.match(/\bavailable\s+(?:from|after)\s+(.+?)(?:\.|$)/);
    if (availableFromMatch) {
      const dt = this.tryParseDate(availableFromMatch[1]!);
      return { status: 'blocked_until_date', availableFrom: dt };
    }

    if (/\b(blocked|busy|reserved|bloqueado)\b/.test(t)) {
      return { status: 'blocked_until_date' };
    }

    if (/\b(price changed|nuevo precio|new price|سعر)\b/.test(t)) {
      return { status: 'needs_clarification' };
    }

    if (/\b(no|not available|no disponible)\b/.test(t)) {
      return { status: 'unavailable' };
    }

    return { status: 'needs_clarification' };
  }

  private tryParseDate(s: string): Date | undefined {
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) return new Date(parsed);
    const iso = s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
      const dt = new Date(`${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}T00:00:00Z`);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    return undefined;
  }
}
