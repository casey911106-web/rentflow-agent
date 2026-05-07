import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';

const HOSTAWAY_BASE = 'https://api.hostaway.com/v1';
const SYNC_REASON = 'hostaway-sync';
const DAYS = 90;

interface CalendarDay {
  date: string;
  isAvailable: number;
  status: string;
}

interface Range {
  start: string;
  end: string;
}

/**
 * Daily Hostaway → RentFlow calendar sync.
 *
 * Runs at 05:00 Asia/Dubai. For each property whose code starts with HW-,
 * fetches the Hostaway calendar for the next 90 days, coalesces unavailable
 * days into PropertyAvailabilityBlock rows (reason='hostaway-sync', replacing
 * any prior synced blocks), and updates Property.status (rented vs available)
 * + availabilityConfirmedAt.
 *
 * No-op when HOSTAWAY_ACCOUNT_ID / HOSTAWAY_API_KEY are not set.
 */
@Injectable()
export class HostawayAvailabilityScheduler {
  private readonly logger = new Logger(HostawayAvailabilityScheduler.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 5 * * *', { name: 'hostaway-availability-sync', timeZone: 'Asia/Dubai' })
  async sweep(): Promise<void> {
    if (this.running) {
      this.logger.warn('Skipping — previous Hostaway sweep still in progress');
      return;
    }
    if (!process.env.HOSTAWAY_ACCOUNT_ID || !process.env.HOSTAWAY_API_KEY) {
      this.logger.log('Hostaway credentials not set; skipping availability sweep');
      return;
    }
    this.running = true;
    try {
      const result = await this.runSweep();
      this.logger.log(
        `Hostaway availability sweep done: rented=${result.rented} available=${result.available} blocks=${result.blocks}`,
      );
    } catch (err) {
      this.logger.error(`Hostaway sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Manual trigger via API for ops debugging. */
  async runManually() {
    return this.runSweep();
  }

  private async runSweep(): Promise<{ rented: number; available: number; blocks: number }> {
    const token = await this.getToken();

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const startStr = today.toISOString().slice(0, 10);
    const endDate = new Date(today);
    endDate.setUTCDate(today.getUTCDate() + DAYS);
    const endStr = endDate.toISOString().slice(0, 10);

    const properties = await this.prisma.property.findMany({
      where: { code: { startsWith: 'HW-' }, deletedAt: null },
      select: { id: true, code: true },
    });

    let rented = 0;
    let available = 0;
    let totalBlocks = 0;

    for (const prop of properties) {
      const hostawayId = prop.code.slice(3);
      let days: CalendarDay[] = [];
      try {
        days = await this.fetchCalendar(token, hostawayId, startStr, endStr);
      } catch (err) {
        this.logger.warn(`${prop.code} calendar fetch failed: ${(err as Error).message}`);
        continue;
      }

      const ranges = this.coalesceUnavailable(days);
      const availableNext7 = days.slice(0, 7).filter((d) => d.isAvailable === 1).length;
      const isRentedNow = availableNext7 < 3;

      await this.prisma.propertyAvailabilityBlock.deleteMany({
        where: { propertyId: prop.id, reason: SYNC_REASON },
      });
      if (ranges.length > 0) {
        await this.prisma.propertyAvailabilityBlock.createMany({
          data: ranges.map((r) => ({
            propertyId: prop.id,
            startsAt: new Date(`${r.start}T00:00:00Z`),
            endsAt: new Date(`${r.end}T23:59:59Z`),
            reason: SYNC_REASON,
          })),
        });
        totalBlocks += ranges.length;
      }

      await this.prisma.property.update({
        where: { id: prop.id },
        data: {
          availabilityConfirmedAt: new Date(),
          status: isRentedNow ? 'rented' : 'available',
        },
      });
      if (isRentedNow) rented++;
      else available++;
    }

    return { rented, available, blocks: totalBlocks };
  }

  private async getToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.HOSTAWAY_ACCOUNT_ID!,
      client_secret: process.env.HOSTAWAY_API_KEY!,
      scope: 'general',
    });
    const res = await fetch(`${HOSTAWAY_BASE}/accessTokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-control': 'no-cache' },
      body,
    });
    if (!res.ok) throw new Error(`Hostaway auth ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  private async fetchCalendar(token: string, hostawayId: string, start: string, end: string): Promise<CalendarDay[]> {
    const res = await fetch(
      `${HOSTAWAY_BASE}/listings/${hostawayId}/calendar?startDate=${start}&endDate=${end}`,
      { headers: { Authorization: `Bearer ${token}`, 'Cache-control': 'no-cache' } },
    );
    if (!res.ok) throw new Error(`calendar ${res.status}`);
    const json = (await res.json()) as { result: CalendarDay[] };
    return json.result ?? [];
  }

  private coalesceUnavailable(days: CalendarDay[]): Range[] {
    const ranges: Range[] = [];
    let cur: { start: string; end: string } | null = null;
    for (const day of days) {
      if (day.isAvailable === 0) {
        if (!cur) cur = { start: day.date, end: day.date };
        else cur.end = day.date;
      } else if (cur) {
        ranges.push(cur);
        cur = null;
      }
    }
    if (cur) ranges.push(cur);
    return ranges;
  }
}
