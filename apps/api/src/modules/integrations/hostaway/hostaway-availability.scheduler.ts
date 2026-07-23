import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';

const HOSTAWAY_BASE = 'https://api.hostaway.com/v1';
const CAUCEO_BASE_DEFAULT = 'https://sync.cauceo.com';
const HOSTAWAY_REASON = 'hostaway-sync';
const CAUCEO_REASON = 'cauceo-sync';
const SYNC_REASONS = [HOSTAWAY_REASON, CAUCEO_REASON];
const DAYS = 90;

interface CalendarDay {
  date: string;
  isAvailable: number;
  status: string;
}

interface CauceoCalendarDay {
  date: string;
  status: 'available' | 'reserved' | 'blocked' | 'unknown';
}

interface Range {
  start: string;
  end: string;
}

/**
 * Daily PMS → RentFlow calendar sync.
 *
 * Runs at 05:00 Asia/Dubai. For each property whose code starts with HW-,
 * fetches the next 90 days of calendar, coalesces unavailable days into
 * PropertyAvailabilityBlock rows (replacing any prior synced blocks), and
 * updates Property.status (rented vs available) + availabilityConfirmedAt.
 *
 * Source routing per property (carril M3):
 * - Default: Hostaway (`/listings/{id}/calendar`), reason='hostaway-sync'.
 * - Cauceo (`/api/v1/calendar/{hostawayListingId}` — Cauceo resolves the
 *   Hostaway id natively, no manual mapping), reason='cauceo-sync', when:
 *   - `RENTFLOW_AVAIL_SOURCE=cauceo` (total flip, D-day), or
 *   - the property's Hostaway id is listed in `RENTFLOW_CAUCEO_UNITS`
 *     (comma-separated, per-unit flip).
 *   Both require `CAUCEO_API_KEY`; without it everything stays on Hostaway.
 *
 * No-op when neither Hostaway nor Cauceo credentials are set.
 */
@Injectable()
export class HostawayAvailabilityScheduler {
  private readonly logger = new Logger(HostawayAvailabilityScheduler.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 5 * * *', { name: 'hostaway-availability-sync', timeZone: 'Asia/Dubai' })
  async sweep(): Promise<void> {
    if (this.running) {
      this.logger.warn('Skipping — previous availability sweep still in progress');
      return;
    }
    const hostawayReady = !!(process.env.HOSTAWAY_ACCOUNT_ID && process.env.HOSTAWAY_API_KEY);
    const cauceoReady = !!process.env.CAUCEO_API_KEY;
    if (!hostawayReady && !cauceoReady) {
      this.logger.log('Neither Hostaway nor Cauceo credentials set; skipping availability sweep');
      return;
    }
    this.running = true;
    try {
      const result = await this.runSweep();
      this.logger.log(
        `Availability sweep done: rented=${result.rented} available=${result.available} blocks=${result.blocks} viaCauceo=${result.viaCauceo}`,
      );
    } catch (err) {
      this.logger.error(`Availability sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Manual trigger via API for ops debugging. */
  async runManually() {
    return this.runSweep();
  }

  private async runSweep(): Promise<{
    rented: number;
    available: number;
    blocks: number;
    viaCauceo: number;
  }> {
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
    let viaCauceoCount = 0;
    let token: string | null = null;

    for (const prop of properties) {
      const hostawayId = prop.code.slice(3);
      const viaCauceo = this.usesCauceo(hostawayId);
      let days: CalendarDay[] = [];
      try {
        if (viaCauceo) {
          days = await this.fetchCauceoCalendar(hostawayId, startStr, endStr);
        } else {
          token = token ?? (await this.getToken());
          days = await this.fetchCalendar(token, hostawayId, startStr, endStr);
        }
      } catch (err) {
        this.logger.warn(
          `${prop.code} calendar fetch failed (${viaCauceo ? 'cauceo' : 'hostaway'}): ${(err as Error).message}`,
        );
        continue;
      }

      const ranges = this.coalesceUnavailable(days);
      const availableNext7 = days.slice(0, 7).filter((d) => d.isAvailable === 1).length;
      const isRentedNow = availableNext7 < 3;

      await this.prisma.propertyAvailabilityBlock.deleteMany({
        where: { propertyId: prop.id, reason: { in: SYNC_REASONS } },
      });
      if (ranges.length > 0) {
        await this.prisma.propertyAvailabilityBlock.createMany({
          data: ranges.map((r) => ({
            propertyId: prop.id,
            startsAt: new Date(`${r.start}T00:00:00Z`),
            endsAt: new Date(`${r.end}T23:59:59Z`),
            reason: viaCauceo ? CAUCEO_REASON : HOSTAWAY_REASON,
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
      if (viaCauceo) viaCauceoCount++;
    }

    return { rented, available, blocks: totalBlocks, viaCauceo: viaCauceoCount };
  }

  private usesCauceo(hostawayId: string): boolean {
    if (!process.env.CAUCEO_API_KEY) return false;
    if (process.env.RENTFLOW_AVAIL_SOURCE === 'cauceo') return true;
    const units = (process.env.RENTFLOW_CAUCEO_UNITS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return units.includes(hostawayId);
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

  private async fetchCauceoCalendar(hostawayId: string, start: string, end: string): Promise<CalendarDay[]> {
    const base = process.env.CAUCEO_API_BASE || CAUCEO_BASE_DEFAULT;
    const res = await fetch(`${base}/api/v1/calendar/${hostawayId}?from=${start}&to=${end}`, {
      headers: { Authorization: `Bearer ${process.env.CAUCEO_API_KEY}` },
    });
    if (!res.ok) throw new Error(`cauceo calendar ${res.status}`);
    const json = (await res.json()) as { days?: CauceoCalendarDay[] };
    // 'unknown' (day without a row in Cauceo) counts as unavailable: for
    // long-stay conversion, over-offering is costlier than under-offering.
    return (json.days ?? []).map((d) => ({
      date: d.date,
      isAvailable: d.status === 'available' ? 1 : 0,
      status: d.status,
    }));
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
