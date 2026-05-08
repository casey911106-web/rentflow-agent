/**
 * Dump a lead's full conversation + recent AI suggestions for diagnostic
 * review. Looks up by phone (E.164) or partial name match (case-insensitive).
 *
 * Usage from the repo root on your Mac (DB access via DIRECT_URL):
 *   pnpm tsx scripts/dump-lead-conversation.ts +971526608543
 *   pnpm tsx scripts/dump-lead-conversation.ts "Juan Perez"
 *
 * Pipe to a file if it's long:
 *   pnpm tsx scripts/dump-lead-conversation.ts +971526608543 > /tmp/lead.txt
 */
import { PrismaClient } from '@rentflow/database';

const prisma = new PrismaClient();

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: dump-lead-conversation.ts <phone-e164-or-name>');
    process.exit(1);
  }

  const isPhone = /^\+?\d{8,16}$/.test(arg.replace(/\s/g, ''));
  const lead = isPhone
    ? await findByPhone(arg)
    : await findByName(arg);

  if (!lead) {
    console.error(`No lead found for: ${arg}`);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`LEAD ${lead.id}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Name:        ${lead.fullName ?? '(unknown)'}`);
  console.log(`Phone:       ${lead.phoneE164}`);
  console.log(`Status:      ${lead.status}`);
  console.log(`Temperature: ${lead.temperature}`);
  console.log(`Confidence:  ${lead.attributionConfidence}`);
  console.log(`First seen:  ${lead.firstSeenAt.toISOString()}`);
  console.log(`Last seen:   ${lead.lastInteractionAt?.toISOString() ?? '(never)'}`);
  console.log(`Property:    ${lead.property ? `${lead.property.code} — ${lead.property.name} (${lead.property.status})` : '(none)'}`);
  console.log(`Budget:      ${lead.budgetAed ?? '(unknown)'}`);
  console.log(`Area:        ${lead.preferredArea ?? '(unknown)'}`);
  console.log(`People:      ${lead.peopleCount ?? '(unknown)'}`);
  console.log(`Move-in:     ${lead.moveInDate?.toISOString().slice(0, 10) ?? '(unknown)'}`);
  console.log(`Duration:    ${lead.rentalDurationMonths ?? '(unknown)'} months`);

  if (lead.whatsappConversation) {
    console.log('');
    console.log('─── WHATSAPP CONVERSATION (oldest first) ──────────────────────');
    const messages = await prisma.whatsAppMessage.findMany({
      where: { conversationId: lead.whatsappConversation.id },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const m of messages) {
      const tag = m.direction === 'inbound' ? '[LEAD]' : '[US]   ';
      const ts = m.createdAt.toISOString().slice(0, 19).replace('T', ' ');
      const body = (m.body ?? '(non-text message)').replace(/\n/g, '\n         ');
      console.log(`${ts}  ${tag}  ${body}`);
    }
  } else {
    console.log('\n(no WhatsApp conversation linked)');
  }

  console.log('');
  console.log('─── AI SUGGESTIONS (most recent first) ────────────────────────');
  const suggestions = await prisma.suggestion.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: {
      decidedBy: { select: { fullName: true } },
    },
  });
  for (const s of suggestions) {
    const ts = s.createdAt.toISOString().slice(0, 19).replace('T', ' ');
    console.log(`\n[${ts}]  status=${s.status}  state=${s.state}→${s.stateAfter}  conf=${(s.confidence * 100).toFixed(0)}%`);
    console.log(`  reasoning: ${s.reasoning}`);
    console.log(`  reply:`);
    console.log(s.suggestedReply.split('\n').map((l) => `    ${l}`).join('\n'));
    if (s.decidedBy) console.log(`  decided by: ${s.decidedBy.fullName}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
}

async function findByPhone(arg: string) {
  const phone = arg.startsWith('+') ? arg : `+${arg.replace(/^00/, '')}`;
  return prisma.lead.findFirst({
    where: { phoneE164: phone, deletedAt: null },
    include: {
      whatsappConversation: { select: { id: true } },
      property: { select: { code: true, name: true, status: true } },
    },
  });
}

async function findByName(arg: string) {
  return prisma.lead.findFirst({
    where: {
      fullName: { contains: arg, mode: 'insensitive' },
      deletedAt: null,
    },
    orderBy: { lastInteractionAt: 'desc' },
    include: {
      whatsappConversation: { select: { id: true } },
      property: { select: { code: true, name: true, status: true } },
    },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
