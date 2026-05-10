/**
 * One-shot: the Virgin Mobile SIM (AED 36.5) was seeded as a recurring
 * monthly subscription, but it's actually a one-time purchase. The daily
 * cron has been creating pro-rated CostEntry rows from it every day,
 * inflating the running cost total.
 *
 * This script:
 *   1) Finds the CostSubscription whose label contains "Virgin"
 *   2) Deletes every CostEntry the cron auto-created from it
 *   3) Marks the subscription inactive (cron stops generating new rows)
 *   4) Creates ONE CostEntry of kind 'fixed_one_off' for AED 36.5 dated
 *      2026-05-06 — the date the SIM was purchased.
 *
 * Usage from Mac (DB access via DIRECT_URL in .env):
 *   pnpm tsx scripts/fix-virgin-mobile-cost.ts
 *
 * Idempotent: if no Virgin subscription is found, the script exits clean.
 */
import { PrismaClient } from '@rentflow/database';

const prisma = new PrismaClient();

const SIM_PURCHASE_DATE = new Date('2026-05-06T00:00:00Z');
const SIM_AMOUNT_AED = 36.5;

async function main() {
  const subs = await prisma.costSubscription.findMany({
    where: { label: { contains: 'Virgin', mode: 'insensitive' } },
  });

  if (subs.length === 0) {
    console.log('No Virgin Mobile CostSubscription found. Nothing to fix.');
    return;
  }

  for (const sub of subs) {
    console.log(`\nFound subscription ${sub.id}`);
    console.log(`  label:    ${sub.label}`);
    console.log(`  cadence:  ${sub.cadence}`);
    console.log(`  amount:   AED ${sub.amountAed.toString()}`);
    console.log(`  active:   ${sub.active}`);

    const linked = await prisma.costEntry.findMany({
      where: { subscriptionId: sub.id },
      select: { id: true, amountAed: true, incurredAt: true },
    });
    const linkedTotal = linked.reduce((s, e) => s + Number(e.amountAed), 0);
    console.log(`  pro-rated entries: ${linked.length} totalling AED ${linkedTotal.toFixed(2)}`);

    if (linked.length > 0) {
      const del = await prisma.costEntry.deleteMany({ where: { subscriptionId: sub.id } });
      console.log(`  → deleted ${del.count} pro-rated CostEntry rows`);
    }

    await prisma.costSubscription.update({
      where: { id: sub.id },
      data: {
        active: false,
        notes: [
          sub.notes,
          'Deactivated 2026-05-10: SIM is a one-time purchase, not a monthly cost. Replaced with a single fixed_one_off CostEntry.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    });
    console.log(`  → marked subscription inactive`);

    const entry = await prisma.costEntry.create({
      data: {
        companyId: sub.companyId,
        kind: 'fixed_one_off',
        label: 'Virgin Mobile WA line — SIM purchase (one-time)',
        amountAed: SIM_AMOUNT_AED,
        sourceType: 'manual',
        incurredAt: SIM_PURCHASE_DATE,
        metadata: { migratedFromSubscriptionId: sub.id },
      },
    });
    console.log(`  → created one-off CostEntry ${entry.id} for AED ${SIM_AMOUNT_AED} on ${SIM_PURCHASE_DATE.toISOString().slice(0, 10)}`);
  }

  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
