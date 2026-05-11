/**
 * Renders a sample IG carousel slide 1 (the hook slide) for a property so
 * ops can validate the overlay design before we wire the full carousel
 * generation pipeline.
 *
 * Usage:
 *   pnpm tsx scripts/preview-carousel-slide.ts                 # picks a sample property
 *   pnpm tsx scripts/preview-carousel-slide.ts HW-421036       # specific property code
 *
 * Output: writes `/tmp/carousel-<code>-slide1.jpg`. The script prints the
 * `open` command at the end so you can preview it on macOS Preview.
 *
 * No DB writes. No published posts. Pure preview.
 */
import { PrismaClient } from '@rentflow/database';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const prisma = new PrismaClient();
const PUBLIC_BASE = process.env.PUBLIC_API_URL ?? 'https://rentflow-api.rentalho.com';

function humanType(t: string): string {
  return ({
    studio: 'Studio',
    one_bedroom: '1BR',
    two_bedroom: '2BR',
    three_bedroom: '3BR',
    villa: 'Villa',
    master_room: 'Master room',
    shared_room: 'Shared room',
    partition: 'Partition',
    bed_space: 'Bed space',
  } as Record<string, string>)[t] ?? '1BR';
}

async function main() {
  const code = process.argv[2];

  const property = await prisma.property.findFirst({
    where: code
      ? { code }
      : {
          deletedAt: null,
          priceAed: { not: null },
          area: { not: null },
          media: { some: { kind: 'photo' } },
        },
    select: {
      code: true, name: true, type: true, area: true, priceAed: true,
      media: {
        where: { kind: 'photo' },
        orderBy: { position: 'asc' },
        take: 1,
        select: { fileUploadId: true, file: { select: { id: true, mimeType: true } } },
      },
    },
  });

  if (!property) {
    console.error(`No property found${code ? ` for code ${code}` : ''}`);
    process.exit(1);
  }
  if (!property.media[0]?.file) {
    console.error(`Property ${property.code} has no photos`);
    process.exit(1);
  }

  console.log(`Property: ${property.code} — ${property.name}`);
  console.log(`  type=${property.type} area=${property.area} priceAed=${property.priceAed}`);

  // Download the photo via public URL
  const fileId = property.media[0].file.id;
  const url = `${PUBLIC_BASE}/public/files/${fileId}`;
  console.log(`  Downloading ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`  ✗ download failed (${resp.status})`);
    process.exit(1);
  }
  const photoBuffer = Buffer.from(await resp.arrayBuffer());

  // Read photo dimensions
  const meta = await sharp(photoBuffer).metadata();
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1080;
  console.log(`  Source: ${w}x${h}`);

  // Compose the overlay SVG. The overlay covers the bottom 28% with a
  // vertical gradient (transparent → black/85%) plus two text lines.
  // Font sizes scale with image height so the result looks consistent
  // whether the source is 1080 or 2160.
  const fontHook = Math.round(h * 0.052);       // ~56px on 1080-high image
  const fontSub  = Math.round(h * 0.028);       // ~30px
  const overlayHeight = Math.round(h * 0.28);
  const overlayTop = h - overlayHeight;
  const hookY = h - Math.round(h * 0.13);
  const subY  = h - Math.round(h * 0.06);
  const priceLabel = `AED ${Number(property.priceAed).toLocaleString()}`;
  const subline = `${humanType(property.type)} · ${property.area}`;
  // Text-only arrow (U+2192) — color emojis bail out in Pango/rsvg unless
  // the system has a color emoji font configured. All public-facing copy
  // is English per ops decision (RentFlow audience is Dubai expats).
  const cta = 'Swipe →';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="fade" x1="0" y1="${overlayTop}" x2="0" y2="${h}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
        <stop offset="40%" stop-color="rgba(0,0,0,0.5)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.88)"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${overlayTop}" width="${w}" height="${overlayHeight}" fill="url(#fade)"/>
    <text x="50%" y="${hookY}" text-anchor="middle"
          font-family="system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
          font-size="${fontHook}" font-weight="900" fill="white"
          letter-spacing="-0.5">${priceLabel} · ${subline}</text>
    <text x="50%" y="${subY}" text-anchor="middle"
          font-family="system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
          font-size="${fontSub}" font-weight="500" fill="white" opacity="0.92">${cta}</text>
  </svg>`;

  const outBuffer = await sharp(photoBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const outPath = `/tmp/carousel-${property.code}-slide1.jpg`;
  writeFileSync(outPath, outBuffer);
  console.log(`\n✓ Wrote ${outPath} (${(outBuffer.length / 1024).toFixed(1)} KB)`);
  console.log(`\nOpen with:  open ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
