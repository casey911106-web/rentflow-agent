/**
 * Backfill: recompute qualificationScore / temperature / status for every
 * existing Lead based on whatever profile fields are populated today.
 *
 * Mirrors the live logic inside LeadWorkflowRunner so a Lead created
 * before the in-workflow scoring fix gets the same outcome a new Lead
 * would get now (i.e. score = knownFields × 20, temperature bucketed,
 * qualifying/new → qualified once known ≥ 3).
 *
 * Usage:
 *   pnpm tsx scripts/backfill-lead-scores.ts          # dry run
 *   pnpm tsx scripts/backfill-lead-scores.ts --apply  # write changes
 */
import { PrismaClient } from '@prisma/client';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      status: true,
      temperature: true,
      qualificationScore: true,
      budgetAed: true,
      preferredArea: true,
      peopleCount: true,
      moveInDate: true,
      rentalDurationMonths: true,
    },
  });

  let updated = 0;
  const byTemp: Record<string, number> = {};
  const byStatusTransition: Record<string, number> = {};

  for (const l of leads) {
    let known = 0;
    if (l.budgetAed != null) known++;
    if (l.preferredArea) known++;
    if (l.peopleCount != null) known++;
    if (l.moveInDate != null) known++;
    if (l.rentalDurationMonths != null) known++;

    const score = known * 20;
    let temp: 'unqualified' | 'cold' | 'warm' | 'hot' = 'unqualified';
    if (known >= 4) temp = 'hot';
    else if (known === 3) temp = 'warm';
    else if (known === 2) temp = 'cold';

    const data: Record<string, unknown> = { qualificationScore: score, temperature: temp };
    if (known >= 3 && (l.status === 'qualifying' || l.status === 'new')) {
      data.status = 'qualified';
    }

    const willChange =
      l.qualificationScore !== score ||
      l.temperature !== temp ||
      (data.status && l.status !== data.status);
    if (!willChange) continue;

    byTemp[temp] = (byTemp[temp] || 0) + 1;
    if (data.status) byStatusTransition[String(data.status)] = (byStatusTransition[String(data.status)] || 0) + 1;

    if (apply) {
      await prisma.lead.update({ where: { id: l.id }, data });
    }
    updated++;
  }

  console.log(`Total leads scanned: ${leads.length}`);
  console.log(`Leads needing update: ${updated}`);
  console.log('New temperature distribution:', byTemp);
  console.log('Status transitions (qualifying/new → qualified):', byStatusTransition);
  if (!apply) console.log('\nDRY RUN — pass --apply to persist.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
