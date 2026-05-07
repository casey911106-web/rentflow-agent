/* eslint-disable no-console */
/**
 * Download first N photos per Hostaway listing and upload to RentFlow.
 *
 *   pnpm tsx scripts/import-hostaway-photos.ts [--per N] [--limit M] [--dry]
 *
 * Defaults: N=10 photos per property, M=all properties.
 * Uploads via the production API as multipart so files land on the VPS volume.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HOSTAWAY_BASE = 'https://api.hostaway.com/v1';
const ACCOUNT_ID = process.env.HOSTAWAY_ACCOUNT_ID;
const API_KEY = process.env.HOSTAWAY_API_KEY;
const RENTFLOW_API = process.env.RENTFLOW_API_URL ?? 'https://rentflow-api.rentalho.com';
const ADMIN_EMAIL = process.env.RENTFLOW_ADMIN_EMAIL ?? 'admin@rentflow.demo';
const ADMIN_PASS = process.env.RENTFLOW_ADMIN_PASS ?? 'rentflow123';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const perIdx = args.indexOf('--per');
const PER = perIdx >= 0 ? Number(args[perIdx + 1]) : 10;
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx >= 0 ? Number(args[limIdx + 1]) : null;

interface HostawayImage {
  id: number;
  url: string;
  caption: string | null;
  sortOrder: number | null;
}

async function getHostawayToken(): Promise<string> {
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
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function getRentflowToken(): Promise<string> {
  const res = await fetch(`${RENTFLOW_API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  if (!res.ok) throw new Error(`Rentflow login: ${res.status}`);
  const json = (await res.json()) as { accessToken: string };
  return json.accessToken;
}

async function fetchListingImages(hwToken: string, hostawayId: string): Promise<HostawayImage[]> {
  const res = await fetch(`${HOSTAWAY_BASE}/listings/${hostawayId}?includeResources=1`, {
    headers: { Authorization: `Bearer ${hwToken}`, 'Cache-control': 'no-cache' },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { result: { listingImages?: HostawayImage[] } };
  const imgs = json.result?.listingImages ?? [];
  return imgs.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${res.status} ${url.slice(0, 80)}`);
  const mime = res.headers.get('content-type') ?? 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mime };
}

async function uploadToRentflow(
  rfToken: string,
  propertyId: string,
  buffer: Buffer,
  mime: string,
  filename: string,
  caption: string | null,
): Promise<void> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: mime });
  form.append('file', blob, filename);
  form.append('kind', 'photo');
  if (caption) form.append('caption', caption);
  const res = await fetch(`${RENTFLOW_API}/properties/${propertyId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rfToken}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Upload ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

async function main() {
  if (!ACCOUNT_ID || !API_KEY) throw new Error('HOSTAWAY_* env vars missing');

  console.log('🔗 Auth Hostaway + RentFlow…');
  const [hwToken, rfToken] = await Promise.all([getHostawayToken(), getRentflowToken()]);

  // Find imported properties
  const where = { code: { startsWith: 'HW-' }, deletedAt: null };
  let properties = await prisma.property.findMany({
    where,
    select: { id: true, code: true, name: true, _count: { select: { media: true } } },
    orderBy: { code: 'asc' },
  });
  if (LIMIT) properties = properties.slice(0, LIMIT);
  console.log(`Found ${properties.length} HW property(ies). Will fetch up to ${PER} photo(s) each.\n`);

  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i]!;
    const hostawayId = prop.code.slice(3); // strip HW-
    const tag = `[${i + 1}/${properties.length}] ${prop.code}`;

    if (prop._count.media >= PER) {
      console.log(`${tag} ⏭  has ${prop._count.media} media already, skipping`);
      totalSkipped += PER;
      continue;
    }

    let images: HostawayImage[];
    try {
      images = await fetchListingImages(hwToken, hostawayId);
    } catch (err) {
      console.log(`${tag} ❌ fetchImages: ${(err as Error).message}`);
      totalFailed += PER;
      continue;
    }
    images = images.slice(0, PER);

    if (images.length === 0) {
      console.log(`${tag} (no images on Hostaway)`);
      continue;
    }

    if (DRY) {
      console.log(`${tag} would upload ${images.length} image(s)`);
      images.forEach((img) =>
        console.log(`   sortOrder=${img.sortOrder} ${(img.caption ?? '').slice(0, 60)}`),
      );
      continue;
    }

    process.stdout.write(`${tag} uploading ${images.length} image(s)…`);
    let ok = 0;
    let fail = 0;
    for (let j = 0; j < images.length; j++) {
      const img = images[j]!;
      try {
        const { buffer, mime } = await downloadImage(img.url);
        const filename = `${prop.code}-${j + 1}.jpg`;
        await uploadToRentflow(rfToken, prop.id, buffer, mime, filename, img.caption);
        ok++;
      } catch (err) {
        fail++;
        console.log(`\n   ❌ image ${j + 1}: ${(err as Error).message}`);
      }
    }
    console.log(` done (ok=${ok} fail=${fail})`);
    totalUploaded += ok;
    totalFailed += fail;
  }

  console.log(`\n✅ Photos: uploaded=${totalUploaded} skipped=${totalSkipped} failed=${totalFailed}`);
}

main()
  .catch((err) => {
    console.error('❌', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
