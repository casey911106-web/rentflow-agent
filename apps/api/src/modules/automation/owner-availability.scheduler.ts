import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from '../whatsapp/adapter.provider';

const STALE_HOURS = 24;
const COOLDOWN_HOURS = 23;

/**
 * Daily cron that checks owner availability for stale properties.
 *
 * Strategy:
 *   - At 10am Asia/Dubai, find each property whose availability hasn't been
 *     confirmed in the last 24h.
 *   - For each property, if there's no pending OwnerAvailabilityCheck row in
 *     the last 23h, send a direct WhatsApp message to the owner.
 *   - Save the OwnerAvailabilityCheck row with status pending_response.
 *   - The OwnerReplyParser handles the reply when it lands.
 *
 * NOTE: outside the 24h customer-service window, owner pings need an approved
 * template. For dev we attempt plain text and surface the error in the
 * OwnerAvailabilityCheck record. In prod, register an "availability_check_v1"
 * utility template with Meta and switch to sendTemplate.
 */
@Injectable()
export class OwnerAvailabilityScheduler {
  private readonly logger = new Logger(OwnerAvailabilityScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly waAdapter: WhatsAppAdapterProvider,
  ) {}

  /** Daily at 10:00 Asia/Dubai (06:00 UTC). */
  @Cron('0 6 * * *', { name: 'owner-availability-sweep', timeZone: 'UTC' })
  async sweep(): Promise<void> {
    // Disabled by default — the parser was producing too many false-positive
    // updates and burning Claude tokens for low-value pings. Set
    // OWNER_AVAILABILITY_SWEEP_ENABLED=true on the API .env to re-enable.
    // The manual trigger endpoint stays live for ops debugging.
    if (process.env.OWNER_AVAILABILITY_SWEEP_ENABLED !== 'true') {
      this.logger.debug('Owner availability sweep disabled by env flag');
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      await this.runSweep();
    } catch (err) {
      this.logger.error(`Owner availability sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runManually(): Promise<{ pinged: number; skipped: number }> {
    return this.runSweep();
  }

  private async runSweep(): Promise<{ pinged: number; skipped: number }> {
    let pinged = 0;
    let skipped = 0;

    const staleAt = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
    const cooldownAt = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000);

    const properties = await this.prisma.property.findMany({
      where: {
        deletedAt: null,
        status: { in: ['available', 'pending_owner_confirmation', 'needs_price_confirmation', 'not_ready_to_post'] },
        ownerId: { not: null },
        OR: [
          { availabilityConfirmedAt: null },
          { availabilityConfirmedAt: { lt: staleAt } },
        ],
      },
      include: { owner: true },
      take: 50,
    });

    for (const property of properties) {
      if (!property.owner) {
        skipped++;
        continue;
      }
      const recentCheck = await this.prisma.ownerAvailabilityCheck.findFirst({
        where: {
          propertyId: property.id,
          askedAt: { gt: cooldownAt },
        },
        orderBy: { askedAt: 'desc' },
      });
      if (recentCheck) {
        skipped++;
        continue;
      }

      const ok = await this.pingOwner(property);
      if (ok) pinged++;
      else skipped++;
    }

    this.logger.log(`Owner availability sweep: pinged=${pinged} skipped=${skipped}`);
    return { pinged, skipped };
  }

  private async pingOwner(property: {
    id: string;
    companyId: string;
    code: string;
    name: string;
    owner: { id: string; phoneE164: string; fullName: string } | null;
  }): Promise<boolean> {
    if (!property.owner) return false;

    const firstName = property.owner.fullName.split(/\s+/)[0] ?? property.owner.fullName;
    const body = `Hi ${firstName}, this is RentFlow Agent. Quick check — is ${property.code} still available for rent? Reply: Yes / Rented / Available from <date> / Price changed.`;

    // Owner pings use a UTILITY template so they work regardless of the 24h
    // customer-service window. If the template isn't approved yet, the send
    // fails and the OwnerAvailabilityCheck row records the error.
    const result = await this.waAdapter.adapter.sendTemplate({
      to: property.owner.phoneE164,
      template: { name: 'owner_availability_check', languageCode: 'en' },
      variables: { '1': firstName, '2': property.code },
      conversationId: `owner:${property.owner.id}`,
    });

    await this.prisma.ownerAvailabilityCheck.create({
      data: {
        companyId: property.companyId,
        ownerId: property.owner.id,
        propertyId: property.id,
        status: result.status === 'failed' ? 'needs_clarification' : 'pending_response',
        askedAt: new Date(),
        rawReply: result.status === 'failed' ? `[send failed] ${result.error ?? ''}` : null,
        nextCheckAt: new Date(Date.now() + STALE_HOURS * 60 * 60 * 1000),
      },
    });

    await this.prisma.ownerMessage.create({
      data: {
        ownerId: property.owner.id,
        direction: 'outbound',
        type: 'text',
        body,
        metadata: { propertyId: property.id, sendStatus: result.status, error: result.error ?? null },
      },
    });

    if (result.status === 'failed') {
      this.logger.warn(
        `Owner ping failed for ${property.code} → ${property.owner.phoneE164}: ${result.error ?? 'unknown'}`,
      );
    }
    return result.status !== 'failed';
  }
}
