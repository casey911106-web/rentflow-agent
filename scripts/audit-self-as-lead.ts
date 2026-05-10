/**
 * Audit + cleanup: ensure the operator's personal number isn't being
 * tracked as a customer Lead anywhere in the DB.
 *
 * READ-ONLY by default — pass `--apply` to actually archive the leads.
 *
 * Usage from Mac:
 *   pnpm tsx scripts/audit-self-as-lead.ts                # report only
 *   pnpm tsx scripts/audit-self-as-lead.ts --apply        # archive leads
 */
import { PrismaClient } from '@rentflow/database';

const prisma = new PrismaClient();
const SELF_PHONE = '+971526608543';
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`Phone under audit: ${SELF_PHONE}`);
  console.log(`Mode: ${APPLY ? '🔥 APPLY (will archive leads)' : '👀 READ-ONLY'}\n`);

  // 1) User record — confirm partner + operator setup
  const user = await prisma.user.findFirst({
    where: { phoneE164: SELF_PHONE, deletedAt: null },
    select: { id: true, fullName: true, email: true, roles: true, isPartner: true, status: true },
  });
  if (!user) {
    console.log('⚠ No User row with this phone. The router cannot route /property to ingestion.');
  } else {
    console.log('User row:');
    console.log(`  ${user.fullName} <${user.email}> — ${user.id}`);
    console.log(`  roles=${user.roles.join(',')} status=${user.status} isPartner=${user.isPartner}`);
    if (!user.isPartner) {
      console.log('  ⚠ isPartner is FALSE. Setting it true so future messages route to ingestion, not lead flow.');
      if (APPLY) {
        await prisma.user.update({ where: { id: user.id }, data: { isPartner: true } });
        console.log('  → updated.');
      }
    }
  }

  // 2) Lead rows tracking this phone as a customer
  const leads = await prisma.lead.findMany({
    where: { phoneE164: SELF_PHONE, deletedAt: null },
    select: {
      id: true,
      fullName: true,
      status: true,
      temperature: true,
      createdAt: true,
      property: { select: { code: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`\nLeads with this phone (status != deleted): ${leads.length}`);
  for (const l of leads) {
    console.log(`  ${l.id}  ${l.fullName ?? '—'}  status=${l.status}  prop=${l.property?.code ?? '—'}  msgs=${l._count.messages}  ${l.createdAt.toISOString().slice(0, 10)}`);
  }

  if (leads.length > 0 && APPLY) {
    const result = await prisma.lead.updateMany({
      where: { phoneE164: SELF_PHONE, deletedAt: null },
      data: { deletedAt: new Date(), status: 'opted_out' },
    });
    console.log(`  → soft-deleted ${result.count} leads (deletedAt=now, status=opted_out)`);
  }

  // 3) WhatsAppConversation — these are tracking history, leave them alone
  //    but report so the operator knows they exist.
  const convs = await prisma.whatsAppConversation.findMany({
    where: { leadPhoneE164: SELF_PHONE },
    select: {
      id: true,
      lastInboundAt: true,
      mode: true,
      _count: { select: { messages: true } },
    },
    orderBy: { lastInboundAt: 'desc' },
    take: 10,
  });
  console.log(`\nWhatsApp conversations with this phone: ${convs.length} (kept for audit history)`);
  for (const c of convs) {
    console.log(`  ${c.id}  mode=${c.mode}  msgs=${c._count.messages}  lastInbound=${c.lastInboundAt?.toISOString().slice(0, 16) ?? '—'}`);
  }

  // 4) Suggestions tied to leads we just archived (cleanup orphans)
  if (leads.length > 0) {
    const orphanedSuggestions = await prisma.suggestion.count({
      where: { leadId: { in: leads.map((l) => l.id) }, status: 'pending' },
    });
    if (orphanedSuggestions > 0) {
      console.log(`\nPending Suggestions tied to these leads: ${orphanedSuggestions}`);
      if (APPLY) {
        const r = await prisma.suggestion.updateMany({
          where: { leadId: { in: leads.map((l) => l.id) }, status: 'pending' },
          data: { status: 'expired' },
        });
        console.log(`  → marked ${r.count} suggestions expired.`);
      }
    }
  }

  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
