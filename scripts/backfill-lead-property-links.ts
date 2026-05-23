/**
 * One-off backfill that re-runs the (fixed) property-code regex against every
 * lead's WhatsApp conversation and sets `lead.propertyId` if a real property
 * code shows up.
 *
 * Context: until the regex fix, parseAttribution() required the literal word
 * "Property" in front of the code. Guests almost never write that — they say
 * "interested in RF-46GP5". So 80/80 leads have propertyId=null even when the
 * inbound message clearly names a property. This script walks each lead, scans
 * its WA messages with the new regex, finds a matching Property by `code`, and
 * sets the link.
 *
 *   pnpm tsx scripts/backfill-lead-property-links.ts          # dry run
 *   pnpm tsx scripts/backfill-lead-property-links.ts --apply  # write changes
 */
import { PrismaClient } from '@prisma/client';
import { parseAttribution } from '@rentflow/shared';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const leads = await prisma.lead.findMany({
    where: { propertyId: null, deletedAt: null },
    select: {
      id: true,
      companyId: true,
      whatsappConversationId: true,
      createdAt: true,
    },
  });
  console.log(`Scanning ${leads.length} unattributed leads (apply=${apply})`);

  let matched = 0;
  let updated = 0;
  for (const lead of leads) {
    if (!lead.whatsappConversationId) continue;
    const msgs = await prisma.whatsAppMessage.findMany({
      where: { conversationId: lead.whatsappConversationId, direction: 'inbound' },
      select: { body: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    let propertyCode: string | undefined;
    for (const m of msgs) {
      const parsed = parseAttribution(m.body ?? '');
      if (parsed.propertyCode) {
        propertyCode = parsed.propertyCode;
        break;
      }
    }
    if (!propertyCode) continue;
    const property = await prisma.property.findFirst({
      where: { companyId: lead.companyId, code: propertyCode, deletedAt: null },
      select: { id: true },
    });
    if (!property) {
      console.log(`  lead=${lead.id} mentioned ${propertyCode} but no Property with that code`);
      continue;
    }
    matched++;
    console.log(`  lead=${lead.id} -> ${propertyCode} (${property.id})`);
    if (apply) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { propertyId: property.id, attributionConfidence: 'medium' },
      });
      updated++;
    }
  }

  console.log(`\nMatched: ${matched}/${leads.length}`);
  if (apply) {
    console.log(`Updated: ${updated} leads`);
  } else {
    console.log('Dry run. Pass --apply to persist changes.');
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
