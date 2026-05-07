/* eslint-disable no-console */
/**
 * One-off cleanup after the Hostaway import:
 * 1. Hostaway prices were stored as nightly. We now want monthly. Multiply
 *    by 27 (30 nights × 10% monthly discount) for HW-* properties.
 * 2. Tracking links written by auto-fast-post.ts have shortUrl pointing at
 *    http://localhost:3001/t/... — replace with the production base URL.
 * 3. PostPackage.priceLine + captions need to be regenerated to use the
 *    new monthly amount and "/ month" suffix everywhere.
 *
 *   pnpm tsx scripts/migrate-prices-and-tracking.ts [--dry]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');

const NEW_TRACKING_BASE = process.env.TRACKING_BASE_URL ?? 'https://rentflow-api.rentalho.com/t';
const PRICE_MULTIPLIER = 27; // 30 nights × 0.9 discount → rounded monthly

async function main() {
  // 1. Hostaway property prices nightly → monthly
  const hwProps = await prisma.property.findMany({
    where: { code: { startsWith: 'HW-' }, deletedAt: null },
    select: { id: true, code: true, priceAed: true, name: true },
  });

  let pricesUpdated = 0;
  for (const p of hwProps) {
    if (p.priceAed === null) continue;
    const nightly = Number(p.priceAed);
    if (nightly < 50 || nightly > 5000) continue; // sanity: skip suspiciously low/high
    const monthly = Math.round(nightly * PRICE_MULTIPLIER);
    if (monthly === nightly) continue;
    if (DRY) {
      console.log(`[dry] ${p.code}  ${nightly} → ${monthly}  (${p.name.slice(0, 50)})`);
    } else {
      await prisma.property.update({
        where: { id: p.id },
        data: { priceAed: monthly, priceConfirmedAt: new Date() },
      });
    }
    pricesUpdated++;
  }
  console.log(`Prices ${DRY ? 'would update' : 'updated'}: ${pricesUpdated}`);

  // 2. Tracking link short URLs — replace localhost with production
  const localhostLinks = await prisma.trackingLink.findMany({
    where: { shortUrl: { startsWith: 'http://localhost' } },
    select: { id: true, shortUrl: true, postCode: true },
  });
  let linksUpdated = 0;
  for (const l of localhostLinks) {
    const newUrl = `${NEW_TRACKING_BASE}/${l.postCode}`;
    if (DRY) {
      console.log(`[dry] tracking ${l.shortUrl} → ${newUrl}`);
    } else {
      await prisma.trackingLink.update({ where: { id: l.id }, data: { shortUrl: newUrl } });
    }
    linksUpdated++;
  }
  console.log(`Tracking URLs ${DRY ? 'would update' : 'updated'}: ${linksUpdated}`);

  // 3. PostPackage captions/priceLine — rebuild for HW-* properties so they
  //    reflect the new monthly amount instead of the old nightly text.
  const packages = await prisma.postPackage.findMany({
    where: { deletedAt: null, property: { code: { startsWith: 'HW-' } } },
    include: { property: { select: { name: true, area: true, priceAed: true, code: true } } },
  });
  let packagesUpdated = 0;
  const waLocal = process.env.WHATSAPP_BUSINESS_PHONE_LOCAL ?? '0585063316';
  for (const pkg of packages) {
    if (!pkg.property) continue;
    const p = pkg.property;
    const priceLine = p.priceAed ? `AED ${Number(p.priceAed).toLocaleString()} / month` : '';
    const availabilityLine = 'Available now';
    const shortCaption = `${p.name} — ${priceLine}. ${availabilityLine}.`;
    const longCaption =
      `${p.name} in ${p.area ?? 'Dubai'}. ${priceLine}. ${availabilityLine}. ` +
      `Wifi, AC, cleaning included. WhatsApp ${waLocal} for viewing.`;
    const whatsappCaption = `🏠 ${p.name}\n${priceLine}\n📍 ${p.area ?? '—'}\nWA: ${waLocal}\nCode: ${p.code}`;

    if (DRY) {
      console.log(`[dry] package ${p.code} priceLine="${priceLine}"`);
    } else {
      await prisma.postPackage.update({
        where: { id: pkg.id },
        data: {
          priceLine,
          availabilityLine,
          shortCaption,
          longCaption,
          whatsappCaption,
          facebookCaption: longCaption,
        },
      });
    }
    packagesUpdated++;
  }
  console.log(`PostPackage captions ${DRY ? 'would update' : 'updated'}: ${packagesUpdated}`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
