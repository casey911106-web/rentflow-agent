/**
 * One-shot: flag the partner agent's User as `isPartner = true` so the
 * ingestion router intercepts /property messages from their phone.
 *
 * Usage from your Mac (DB access via DIRECT_URL):
 *   pnpm tsx scripts/seed-partner-user.ts +971526608543
 *
 * If the User doesn't exist yet, the script asks you to create it first
 * via /admin/users in the dashboard.
 */
import { PrismaClient } from '@rentflow/database';

const prisma = new PrismaClient();

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    console.error('usage: seed-partner-user.ts <phone-e164>');
    process.exit(1);
  }
  const target = phone.startsWith('+') ? phone : `+${phone}`;

  const user = await prisma.user.findFirst({
    where: { phoneE164: target, deletedAt: null },
  });
  if (!user) {
    console.error(`No User found with phone ${target}.`);
    console.error('Create a User in /admin/users first (any role works), then re-run this script.');
    process.exit(1);
  }

  if (user.isPartner) {
    console.log(`✓ ${user.fullName} (${user.email}) is already a partner — no change.`);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isPartner: true },
  });
  console.log(`✓ Flagged ${user.fullName} (${user.email}, ${user.phoneE164}) as isPartner=true.`);
  console.log(`  Their /property submissions to the WhatsApp business number will now route`);
  console.log(`  through IngestionService instead of the lead flow.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
