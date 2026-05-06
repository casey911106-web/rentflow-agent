/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const KEEP_USER_EMAIL = 'admin@rentflow.demo';

async function main() {
  console.log('🧹 Cleanup starting against:', process.env.DATABASE_URL?.replace(/:[^@]*@/, ':***@'));

  const adminUser = await prisma.user.findFirst({ where: { email: KEEP_USER_EMAIL } });
  if (!adminUser) throw new Error(`Admin user ${KEEP_USER_EMAIL} not found — refusing to wipe`);
  console.log(`✅ Will keep User ${adminUser.email} (id=${adminUser.id}) and its Company (id=${adminUser.companyId})`);

  await prisma.$transaction(async (tx) => {
    await tx.trainingExample.deleteMany();
    await tx.suggestion.deleteMany();
    await tx.notification.deleteMany();
    await tx.automationJob.deleteMany();
    await tx.automationRule.deleteMany();
    await tx.paymentRecord.deleteMany();
    await tx.commission.deleteMany();
    await tx.deal.deleteMany();
    await tx.viewingFeedback.deleteMany();
    await tx.viewing.deleteMany();
    await tx.trackingLink.deleteMany();
    await tx.postPackage.deleteMany();
    await tx.postChannel.deleteMany();
    await tx.campaign.deleteMany();
    await tx.aIPromptTemplate.deleteMany();
    await tx.aIAgentSession.deleteMany();
    await tx.whatsAppMessage.deleteMany();
    await tx.whatsAppConversation.deleteMany();
    await tx.leadMessage.deleteMany();
    await tx.lead.deleteMany();
    await tx.leadSource.deleteMany();
    await tx.agentPerformanceSnapshot.deleteMany();
    await tx.agentAvailability.deleteMany();
    await tx.fieldAgent.deleteMany();
    await tx.propertyScoreSnapshot.deleteMany();
    await tx.propertyIssue.deleteMany();
    await tx.propertyCalendarEvent.deleteMany();
    await tx.propertyAvailabilityBlock.deleteMany();
    await tx.propertyMedia.deleteMany();
    await tx.property.deleteMany();
    await tx.ownerScoreSnapshot.deleteMany();
    await tx.ownerAvailabilityCheck.deleteMany();
    await tx.ownerMessage.deleteMany();
    await tx.owner.deleteMany();
    await tx.fileUpload.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.webhookLog.deleteMany();
    await tx.integrationToken.deleteMany();
    await tx.appSetting.deleteMany();
    await tx.user.deleteMany({ where: { id: { not: adminUser.id } } });
    await tx.company.deleteMany({ where: { id: { not: adminUser.companyId } } });
  }, { timeout: 60000, maxWait: 10000 });

  const counts = {
    companies: await prisma.company.count(),
    users: await prisma.user.count(),
    properties: await prisma.property.count(),
    leads: await prisma.lead.count(),
    owners: await prisma.owner.count(),
    conversations: await prisma.whatsAppConversation.count(),
    suggestions: await prisma.suggestion.count(),
  };
  console.log('📊 Final state:', counts);
  console.log('✅ Cleanup complete.');
}

main()
  .catch((e) => {
    console.error('❌ Cleanup failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
