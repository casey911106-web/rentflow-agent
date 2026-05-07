/* eslint-disable no-console */
/**
 * Import properties from Hostaway into RentFlow.
 *
 * Run from repo root:
 *   pnpm tsx scripts/import-hostaway.ts [--dry] [--limit N]
 *
 * Requires HOSTAWAY_ACCOUNT_ID, HOSTAWAY_API_KEY, DIRECT_URL in .env.
 * Idempotent: re-running upserts by code 'HW-<hostaway_id>'.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HOSTAWAY_BASE = 'https://api.hostaway.com/v1';
const ACCOUNT_ID = process.env.HOSTAWAY_ACCOUNT_ID;
const API_KEY = process.env.HOSTAWAY_API_KEY;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry');
const LIMIT_ARG = args.indexOf('--limit');
const LIMIT = LIMIT_ARG >= 0 ? Number(args[LIMIT_ARG + 1]) : null;

interface HostawayListing {
  id: number;
  name: string;
  description: string | null;
  internalListingName: string | null;
  propertyTypeId: number | null;
  roomType: string | null;
  city: string | null;
  street: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  price: number | null;
  bedroomsNumber: number | null;
  bedsNumber: number | null;
  bathroomsNumber: number | null;
  personCapacity: number | null;
  thumbnailUrl: string | null;
  contactName: string | null;
  contactSurName: string | null;
  contactPhone1: string | null;
  contactPhone2: string | null;
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
  if (!res.ok) throw new Error(`Hostaway auth failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function fetchAllListings(token: string): Promise<HostawayListing[]> {
  const all: HostawayListing[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const res = await fetch(`${HOSTAWAY_BASE}/listings?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}`, 'Cache-control': 'no-cache' },
    });
    if (!res.ok) throw new Error(`Listings fetch failed: ${res.status}`);
    const json = (await res.json()) as { result: HostawayListing[]; count: number };
    all.push(...json.result);
    if (json.result.length < limit) break;
    offset += limit;
  }
  return all;
}

function mapPropertyType(bedrooms: number | null, roomType: string | null, name: string): string {
  const b = bedrooms ?? 0;
  if (roomType === 'shared_room') return 'shared_room';
  if (roomType === 'private_room') return 'master_room';
  // Hostaway often marks studios as bedroomsNumber=1 — trust the name.
  if (/\bstudio\b/i.test(name)) return 'studio';
  if (b === 0) return 'studio';
  if (b === 1) return 'one_bedroom';
  if (b === 2) return 'two_bedroom';
  if (b === 3) return 'three_bedroom';
  if (b >= 4) return 'villa';
  return 'other';
}

function ownerNameFrom(l: HostawayListing): string | null {
  const parts = [l.contactName, l.contactSurName].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.join(' ');
}

async function main() {
  if (!ACCOUNT_ID || !API_KEY) {
    throw new Error('HOSTAWAY_ACCOUNT_ID and HOSTAWAY_API_KEY must be set in .env');
  }

  console.log(`🔗 Connecting to Hostaway (account ${ACCOUNT_ID})…`);
  const token = await getToken();

  console.log('📥 Fetching all listings…');
  let listings = await fetchAllListings(token);
  if (LIMIT) listings = listings.slice(0, LIMIT);
  console.log(`   → ${listings.length} listing(s) ${LIMIT ? `(limited to ${LIMIT})` : ''}`);

  const company = await prisma.company.findFirst();
  if (!company) throw new Error('No Company in DB — seed first.');
  console.log(`🏢 Target company: ${company.name} (${company.id})`);

  if (DRY_RUN) {
    console.log('\n🌵 DRY RUN — preview of mapping (first 5):\n');
    for (const l of listings.slice(0, 5)) {
      console.log(`HW-${l.id} | ${l.name}`);
      console.log(`  type=${mapPropertyType(l.bedroomsNumber, l.roomType, l.name)} city=${l.city} addr=${l.address}`);
      console.log(`  lat=${l.lat} lng=${l.lng} bedrooms=${l.bedroomsNumber} beds=${l.bedsNumber}`);
      console.log(`  price=${l.price} capacity=${l.personCapacity}`);
      console.log(`  contact=${ownerNameFrom(l)} phone=${l.contactPhone1}`);
      console.log();
    }
    console.log('Run without --dry to actually import.');
    return;
  }

  let created = 0;
  let updated = 0;
  let ownersCreated = 0;

  for (const l of listings) {
    const code = `HW-${l.id}`;

    // Owner
    let ownerId: string | undefined;
    const ownerName = ownerNameFrom(l);
    if (ownerName && l.contactPhone1) {
      const phone = l.contactPhone1.replace(/[^+\d]/g, '');
      const owner = await prisma.owner.upsert({
        where: { companyId_phoneE164: { companyId: company.id, phoneE164: phone } },
        update: { fullName: ownerName },
        create: { companyId: company.id, fullName: ownerName, phoneE164: phone },
      });
      if (owner.createdAt.getTime() === owner.updatedAt.getTime()) ownersCreated++;
      ownerId = owner.id;
    }

    // Property — upsert by (companyId, code)
    const existing = await prisma.property.findUnique({
      where: { companyId_code: { companyId: company.id, code } },
    });
    const data = {
      companyId: company.id,
      ownerId,
      code,
      name: l.name,
      type: mapPropertyType(l.bedroomsNumber, l.roomType, l.name) as
        | 'studio'
        | 'one_bedroom'
        | 'two_bedroom'
        | 'three_bedroom'
        | 'villa'
        | 'shared_room'
        | 'master_room'
        | 'other',
      area: l.city ?? null,
      addressLine: l.address ?? l.street ?? null,
      latitude: l.lat ?? null,
      longitude: l.lng ?? null,
      priceAed: l.price ?? null,
      description: l.description?.slice(0, 5000) ?? null,
      occupancyMax: l.personCapacity ?? null,
      status: 'available' as const,
    };
    if (existing) {
      await prisma.property.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.property.create({ data });
      created++;
    }
  }

  console.log('\n✅ Import complete');
  console.log(`   Properties created: ${created}`);
  console.log(`   Properties updated: ${updated}`);
  console.log(`   Owners created:     ${ownersCreated}`);
  console.log(`   Total Hostaway listings processed: ${listings.length}`);
}

main()
  .catch((err) => {
    console.error('❌ Import failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
