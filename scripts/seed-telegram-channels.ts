/**
 * One-shot seed: register the two RentFlow Telegram channels as automated
 * PostChannels for the company. Idempotent — safe to re-run.
 *
 * Usage (on VPS, inside the api container):
 *   docker compose -f docker-compose.prod.yml exec api node -e "require('/repo/scripts/seed-telegram-channels.js')"
 *
 * Or locally pointed at prod:
 *   pnpm --filter @rentflow/api ts-node ../../scripts/seed-telegram-channels.ts
 */
import { PrismaClient } from '@rentflow/database';

const CHANNELS = [
  {
    name: 'Dubai Rentals (EN) — @RentFlowDubai',
    platform: 'telegram' as const,
    kind: 'channel' as const,
    externalId: '-1003919020505',
    notes: 'Public Telegram channel @RentFlowDubai. English audience. Admin: RentFlowDubaiBot.',
  },
  {
    name: 'Rentas en Dubai (ES) — @RentasEnDubai',
    platform: 'telegram' as const,
    kind: 'channel' as const,
    externalId: '-1003584603240',
    notes: 'Public Telegram channel @RentasEnDubai. Spanish-speaking audience. Admin: RentFlowDubaiBot.',
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.findFirst({ where: { deletedAt: null } });
    if (!company) {
      console.error('No company found — aborting seed.');
      process.exit(1);
    }
    for (const c of CHANNELS) {
      const existing = await prisma.postChannel.findUnique({
        where: {
          companyId_platform_name: {
            companyId: company.id,
            platform: c.platform,
            name: c.name,
          },
        },
      });
      if (existing) {
        await prisma.postChannel.update({
          where: { id: existing.id },
          data: {
            externalId: c.externalId,
            automated: true,
            active: true,
            kind: c.kind,
            notes: c.notes,
          },
        });
        console.log(`✓ Updated channel: ${c.name}`);
      } else {
        await prisma.postChannel.create({
          data: {
            companyId: company.id,
            name: c.name,
            platform: c.platform,
            kind: c.kind,
            externalId: c.externalId,
            automated: true,
            active: true,
            notes: c.notes,
          },
        });
        console.log(`✓ Created channel: ${c.name}`);
      }
    }
    console.log('Done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
