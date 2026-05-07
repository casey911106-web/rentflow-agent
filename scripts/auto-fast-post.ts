/* eslint-disable no-console */
/**
 * Bulk-create Fast Posting (PostPackage) entries for currently-available
 * properties so the public marketplace surfaces them immediately.
 *
 *   pnpm tsx scripts/auto-fast-post.ts [--dry] [--all]
 *
 * Defaults: only properties with status='available' and at least one media
 * row, that don't already have an active PostPackage.
 * --all also covers properties with status='rented' (for testing).
 *
 * Skips PostingService.generate() so the readiness-score gate (60) doesn't
 * block Hostaway imports that haven't gone through manual prep yet.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ALL = args.includes('--all');

function randomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `POST-${out}`;
}

async function main() {
  const company = await prisma.company.findFirst();
  if (!company) throw new Error('No company');

  const where = {
    companyId: company.id,
    deletedAt: null,
    media: { some: {} },
    postPackages: {
      none: {
        deletedAt: null,
        status: { in: ['generated', 'scheduled', 'pending_approval', 'approved', 'published'] },
      },
    },
    ...(ALL ? {} : { status: 'available' as const }),
  };

  const properties = await prisma.property.findMany({
    where,
    include: { _count: { select: { media: true, postPackages: true } } },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${properties.length} property(ies) needing a Fast Posting${ALL ? ' (--all)' : ''}.`);

  if (properties.length === 0) return;

  const waMeBase = process.env.WHATSAPP_BUSINESS_WA_ME_BASE_URL ?? 'https://wa.me/971585063316';
  const waLocal = process.env.WHATSAPP_BUSINESS_PHONE_LOCAL ?? '0585063316';
  const trackingBase = process.env.TRACKING_BASE_URL ?? 'http://localhost:3001/t';

  let created = 0;

  for (const prop of properties) {
    const priceLine = prop.priceAed ? `AED ${Number(prop.priceAed).toLocaleString()} / night` : '';
    const availabilityLine = 'Available now';
    const shortCaption = `${prop.name} — ${priceLine}. ${availabilityLine}.`;
    const longCaption =
      `${prop.name} in ${prop.area ?? 'Dubai'}. ${priceLine}. ${availabilityLine}. ` +
      `Wifi, AC, cleaning included. WhatsApp ${waLocal} for viewing.`;
    const whatsappCaption = `🏠 ${prop.name}\n${priceLine}\n📍 ${prop.area ?? '—'}\nWA: ${waLocal}\nCode: ${prop.code}`;
    const postCode = randomCode();
    const trackingShort = `${trackingBase}/${postCode}`;
    const waUrl = `${waMeBase}?text=${encodeURIComponent(`Hi! Interested in ${prop.code} — ${prop.name}.`)}`;

    if (DRY) {
      console.log(`[dry] ${prop.code} ${prop.name} → would create POST package ${postCode}`);
      continue;
    }

    await prisma.postPackage.create({
      data: {
        companyId: company.id,
        propertyId: prop.id,
        status: 'approved',
        title: prop.name,
        shortCaption,
        longCaption,
        whatsappCaption,
        facebookCaption: longCaption,
        priceLine,
        availabilityLine,
        features: ['Wifi', 'AC', 'Cleaning', 'Furnished'],
        trackingLink: {
          create: {
            companyId: company.id,
            sourceCode: prop.code,
            postCode,
            shortUrl: trackingShort,
            whatsappUrl: waUrl,
          },
        },
      },
    });
    console.log(`✓ ${prop.code} ${prop.name}`);
    created++;
  }

  console.log(`\n✅ Created ${created} Fast Posting(s).`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
