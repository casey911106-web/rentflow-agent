/**
 * Generates 3 hook-style variants for the same property's slide 1 so we
 * can compare which one actually stops the scroll vs which one just looks
 * like a real-estate listing. Same source photo, same data, different
 * visual + copy treatment.
 *
 * Usage:
 *   pnpm tsx scripts/preview-carousel-variants.ts                # auto picks
 *   pnpm tsx scripts/preview-carousel-variants.ts HW-421036
 *
 * Outputs /tmp/carousel-<code>-v[1-3].jpg. Prints the open commands.
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
  } as Record<string, string>)[t] ?? '1BR';
}

// Use single quotes around multi-word font names — the attribute itself
// is double-quoted in the SVG, so nested double quotes break XML parsing.
const SAFE_FONT = "system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

interface VariantInput {
  w: number; h: number;
  priceAed: number;
  type: string;
  area: string;
}

// V2 — POV / curiosity hook at TOP
// Pattern interrupt: lead with a provocative line, not specs.
function variantPOV(input: VariantInput): string {
  const { w, h, priceAed, type, area } = input;
  const fontTitle = Math.round(h * 0.055);
  const fontSpec  = Math.round(h * 0.024);
  const hookY = Math.round(h * 0.10) + fontTitle;
  const specY = hookY + Math.round(fontTitle * 1.05);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="${h * 0.35}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="rgba(0,0,0,0.78)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${w}" height="${h * 0.35}" fill="url(#fade)"/>
    <text x="${Math.round(w * 0.06)}" y="${hookY}" text-anchor="start"
          font-family="${SAFE_FONT}" font-size="${fontTitle}" font-weight="900"
          fill="white" letter-spacing="-1.5">POV: your new ${humanType(type)} in ${area}</text>
    <text x="${Math.round(w * 0.06)}" y="${specY}" text-anchor="start"
          font-family="${SAFE_FONT}" font-size="${fontSpec}" font-weight="400"
          fill="white" opacity="0.85">AED ${priceAed.toLocaleString()} / mo  ·  See slide 4</text>
  </svg>`;
}

// V3 — Magazine / minimal — HUGE price center, subtle context
// Pattern interrupt: doesn't look like a real-estate ad at all.
function variantMagazine(input: VariantInput): string {
  const { w, h, priceAed, area } = input;
  const fontMega = Math.round(h * 0.13);
  const fontSub  = Math.round(h * 0.028);
  const fontTag  = Math.round(h * 0.022);
  const centerY = Math.round(h * 0.46);
  const tagY    = Math.round(h * 0.94);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="ovr" x1="0" y1="${h * 0.25}" x2="0" y2="${h * 0.75}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
        <stop offset="50%" stop-color="rgba(0,0,0,0.55)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${h * 0.25}" width="${w}" height="${h * 0.5}" fill="url(#ovr)"/>
    <text x="50%" y="${centerY}" text-anchor="middle"
          font-family="${SAFE_FONT}" font-size="${fontMega}" font-weight="900"
          fill="white" letter-spacing="-4">AED ${priceAed.toLocaleString()}</text>
    <text x="50%" y="${centerY + Math.round(fontMega * 0.7)}" text-anchor="middle"
          font-family="${SAFE_FONT}" font-size="${fontSub}" font-weight="500"
          fill="white" opacity="0.88" letter-spacing="2">${area.toUpperCase()}</text>
    <text x="50%" y="${tagY}" text-anchor="middle"
          font-family="${SAFE_FONT}" font-size="${fontTag}" font-weight="600"
          fill="white" opacity="0.7" letter-spacing="3">SWIPE →</text>
  </svg>`;
}

// V4 — Question / curiosity gap
// Tells them slide 2+ has the answer to a question they want answered.
function variantQuestion(input: VariantInput): string {
  const { w, h, priceAed, type, area } = input;
  const fontHook = Math.round(h * 0.075);
  const fontSub  = Math.round(h * 0.026);
  const lineH    = Math.round(fontHook * 1.05);
  const block1   = Math.round(h * 0.10) + fontHook;
  const block2   = block1 + lineH;
  const ctaY     = Math.round(h * 0.93);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="topfade" x1="0" y1="0" x2="0" y2="${h * 0.5}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="rgba(0,0,0,0.82)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${w}" height="${h * 0.5}" fill="url(#topfade)"/>
    <text x="${Math.round(w * 0.06)}" y="${block1}" text-anchor="start"
          font-family="${SAFE_FONT}" font-size="${fontHook}" font-weight="900"
          fill="white" letter-spacing="-1.5">${humanType(type)} in ${area}</text>
    <text x="${Math.round(w * 0.06)}" y="${block2}" text-anchor="start"
          font-family="${SAFE_FONT}" font-size="${fontHook}" font-weight="900"
          fill="white" letter-spacing="-1.5">for AED ${priceAed.toLocaleString()}?</text>
    <text x="${Math.round(w * 0.06)}" y="${ctaY}" text-anchor="start"
          font-family="${SAFE_FONT}" font-size="${fontSub}" font-weight="600"
          fill="white" opacity="0.92">Let me show you →</text>
  </svg>`;
}

async function main() {
  const code = process.argv[2];

  const property = await prisma.property.findFirst({
    where: code
      ? { code }
      : { deletedAt: null, priceAed: { not: null }, area: { not: null }, media: { some: { kind: 'photo' } } },
    select: {
      code: true, name: true, type: true, area: true, priceAed: true,
      media: { where: { kind: 'photo' }, orderBy: { position: 'asc' }, take: 1,
        select: { file: { select: { id: true } } } },
    },
  });
  if (!property || !property.media[0]?.file) {
    console.error('Could not find a property with a photo'); process.exit(1);
  }

  console.log(`Property: ${property.code} · ${property.type} · ${property.area} · AED ${property.priceAed}`);

  const url = `${PUBLIC_BASE}/public/files/${property.media[0].file.id}`;
  const resp = await fetch(url);
  if (!resp.ok) { console.error(`download failed`); process.exit(1); }
  const photo = Buffer.from(await resp.arrayBuffer());
  const meta = await sharp(photo).metadata();
  const w = meta.width ?? 1080, h = meta.height ?? 1080;

  const data: VariantInput = {
    w, h,
    priceAed: Number(property.priceAed),
    type: property.type,
    area: property.area ?? 'Dubai',
  };

  const variants = [
    { tag: 'v2-pov',      svg: variantPOV(data) },
    { tag: 'v3-magazine', svg: variantMagazine(data) },
    { tag: 'v4-question', svg: variantQuestion(data) },
  ];

  console.log('');
  for (const v of variants) {
    const out = await sharp(photo)
      .composite([{ input: Buffer.from(v.svg), top: 0, left: 0 }])
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    const path = `/tmp/carousel-${property.code}-${v.tag}.jpg`;
    writeFileSync(path, out);
    console.log(`✓ ${v.tag.padEnd(14)} → ${path}`);
  }
  console.log('');
  console.log(`Open all 3 + the v1 you already have:`);
  console.log(`  open /tmp/carousel-${property.code}-slide1.jpg /tmp/carousel-${property.code}-v2-pov.jpg /tmp/carousel-${property.code}-v3-magazine.jpg /tmp/carousel-${property.code}-v4-question.jpg`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
