/* eslint-disable no-console */
/**
 * Sync Hostaway calendar to RentFlow PropertyAvailabilityBlock.
 *
 *   pnpm tsx scripts/import-hostaway-availability.ts [--days 90] [--dry] [--limit M]
 *
 * For each HW-* property, fetch the next N days of calendar from Hostaway.
 * Coalesce contiguous unavailable days (status reserved|blocked|unavailable)
 * into PropertyAvailabilityBlock rows. Idempotent: deletes existing
 * 'hostaway-sync' blocks for the property before inserting fresh ones, so
 * re-running picks up new bookings and removes cancelled ones.
 *
 * Also updates Property.availabilityConfirmedAt = now and sets status:
 *   - 'rented' if booked through > 7 days from today
 *   - 'available' otherwise
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HOSTAWAY_BASE = 'https://api.hostaway.com/v1';
const ACCOUNT_ID = process.env.HOSTAWAY_ACCOUNT_ID;
const API_KEY = process.env.HOSTAWAY_API_KEY;

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const daysIdx = args.indexOf('--days');
const DAYS = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 90;
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx >= 0 ? Number(args[limIdx + 1]) : null;

const SYNC_REASON = 'hostaway-sync';

interface CalendarDay {
  date: string;
  isAvailable: number;
  status: string;
  price?: number | null;
}

async function getToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: ACCOUNT_ID!,
    client_secret: API_KEY!,
    scope: 'general',
  });
  const res = await fetch(`${HOSTAWAY_BASE}/accessTokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-control': 'no-cache' },
    body,
  });
  if (!res.ok) throw new Error(`Hostaway auth: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchCalendar(token: string, hostawayId: string, start: string, end: string): Promise<CalendarDay[]> {
  const res = await fetch(
    `${HOSTAWAY_BASE}/listings/${hostawayId}/calendar?startDate=${start}&endDate=${end}`,
    { headers: { Authorization: `Bearer ${token}`, 'Cache-control': 'no-cache' } },
  );
  if (!res.ok) throw new Error(`calendar ${res.status}`);
  const json = (await res.json()) as { result: CalendarDay[] };
  return json.result ?? [];
}

interface Range {
  start: string;
  end: string;
  reasonDetail: string;
}

function coalesceUnavailable(days: CalendarDay[]): Range[] {
  const ranges: Range[] = [];
  let cur: { start: string; end: string; statuses: Set<string> } | null = null;

  for (const day of days) {
    const unavailable = day.isAvailable === 0;
    if (unavailable) {
      if (!cur) {
        cur = { start: day.date, end: day.date, statuses: new Set([day.status]) };
      } else {
        cur.end = day.date;
        cur.statuses.add(day.status);
      }
    } else if (cur) {
      ranges.push({
        start: cur.start,
        end: cur.end,
        reasonDetail: [...cur.statuses].sort().join('+'),
      });
      cur = null;
    }
  }
  if (cur) {
    ranges.push({
      start: cur.start,
      end: cur.end,
      reasonDetail: [...cur.statuses].sort().join('+'),
    });
  }
  return ranges;
}

async function main() {
  if (!ACCOUNT_ID || !API_KEY) throw new Error('HOSTAWAY_* env vars missing');

  console.log('🔗 Auth Hostaway…');
  const token = await getToken();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startStr = isoDate(today);
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + DAYS);
  const endStr = isoDate(endDate);

  console.log(`📅 Fetching calendar ${startStr} → ${endStr} (${DAYS} days)`);

  let properties = await prisma.property.findMany({
    where: { code: { startsWith: 'HW-' }, deletedAt: null },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
  if (LIMIT) properties = properties.slice(0, LIMIT);
  console.log(`Properties to sync: ${properties.length}\n`);

  let totalBlocks = 0;
  let propsRented = 0;
  let propsAvailable = 0;

  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i]!;
    const hostawayId = prop.code.slice(3);
    const tag = `[${i + 1}/${properties.length}] ${prop.code}`;

    let days: CalendarDay[] = [];
    try {
      days = await fetchCalendar(token, hostawayId, startStr, endStr);
    } catch (err) {
      console.log(`${tag} ❌ ${(err as Error).message}`);
      continue;
    }

    const ranges = coalesceUnavailable(days);
    const totalUnavailable = days.filter((d) => d.isAvailable === 0).length;
    const availableNext7 = days.slice(0, 7).filter((d) => d.isAvailable === 1).length;
    const isRentedNow = availableNext7 < 3; // <3 free in next week → consider rented

    console.log(
      `${tag} unavail=${totalUnavailable}/${days.length} ranges=${ranges.length} ${isRentedNow ? '🔒 rented' : '🟢 available'}`,
    );

    if (DRY) {
      ranges.slice(0, 3).forEach((r) => console.log(`     ${r.start} → ${r.end} (${r.reasonDetail})`));
      continue;
    }

    // Replace synced blocks
    await prisma.propertyAvailabilityBlock.deleteMany({
      where: { propertyId: prop.id, reason: SYNC_REASON },
    });
    if (ranges.length > 0) {
      await prisma.propertyAvailabilityBlock.createMany({
        data: ranges.map((r) => ({
          propertyId: prop.id,
          startsAt: new Date(`${r.start}T00:00:00Z`),
          endsAt: new Date(`${r.end}T23:59:59Z`),
          reason: SYNC_REASON,
        })),
      });
      totalBlocks += ranges.length;
    }

    await prisma.property.update({
      where: { id: prop.id },
      data: {
        availabilityConfirmedAt: new Date(),
        status: isRentedNow ? 'rented' : 'available',
      },
    });
    if (isRentedNow) propsRented++;
    else propsAvailable++;
  }

  console.log(`\n✅ Sync complete`);
  console.log(`   Properties rented now:    ${propsRented}`);
  console.log(`   Properties available now: ${propsAvailable}`);
  console.log(`   Total blocks written:     ${totalBlocks}`);
}

main()
  .catch((err) => {
    console.error('❌', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
