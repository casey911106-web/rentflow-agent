/* eslint-disable no-console */
import {
  PrismaClient,
  RoleName,
  PropertyType,
  PropertyStatus,
  LeadStatus,
  LeadTemperature,
  AttributionConfidence,
  ViewingStatus,
  AgentAssignmentStatus,
  PostPackageStatus,
  ChannelPlatform,
  ChannelKind,
  DealStatus,
  CommissionStatus,
  ConversationMode,
  MessageDirection,
  MessageType,
  ScoreKind,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

// Default WhatsApp Business number for the demo company.
const WA_LOCAL = '0585063316';
const WA_E164 = '+971585063316';
const WA_BASE = 'https://wa.me/971585063316';

// Sentinel password value for seed users. The auth service recognizes this
// constant and accepts the plain password "rentflow123". Real users get real
// bcrypt hashes via the registration flow.
const STUB_HASH = 'SEED_PASSWORD_RENTFLOW123';

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function hoursAhead(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function main() {
  console.log('🌱 Seeding RentFlow Agent...');

  // ---------------------------------------------------------------------------
  // Company
  // ---------------------------------------------------------------------------
  const company = await prisma.company.upsert({
    where: { slug: 'rentflow-demo' },
    update: {},
    create: {
      name: 'RentFlow Demo (Dubai)',
      slug: 'rentflow-demo',
      countryCode: 'AE',
      timezone: 'Asia/Dubai',
      currency: 'AED',
    },
  });

  // ---------------------------------------------------------------------------
  // Settings (WhatsApp number + scoring weights placeholders)
  // ---------------------------------------------------------------------------
  await prisma.appSetting.upsert({
    where: { companyId_key: { companyId: company.id, key: 'whatsapp.business_number' } },
    update: {
      value: { local: WA_LOCAL, e164: WA_E164, waMeBase: WA_BASE },
    },
    create: {
      companyId: company.id,
      key: 'whatsapp.business_number',
      value: { local: WA_LOCAL, e164: WA_E164, waMeBase: WA_BASE },
    },
  });

  await prisma.appSetting.upsert({
    where: { companyId_key: { companyId: company.id, key: 'opt_out.keywords' } },
    update: { value: ['STOP', 'UNSUBSCRIBE', 'لا تراسلني'] },
    create: {
      companyId: company.id,
      key: 'opt_out.keywords',
      value: ['STOP', 'UNSUBSCRIBE', 'لا تراسلني'],
    },
  });

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  const superAdmin = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'admin@rentflow.demo' } },
    update: {},
    create: {
      companyId: company.id,
      email: 'admin@rentflow.demo',
      passwordHash: STUB_HASH,
      fullName: 'Casey Admin',
      roles: [RoleName.super_admin],
      phoneE164: '+971501110001',
    },
  });

  const opsManager = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'ops@rentflow.demo' } },
    update: {},
    create: {
      companyId: company.id,
      email: 'ops@rentflow.demo',
      passwordHash: STUB_HASH,
      fullName: 'Olivia Ops',
      roles: [RoleName.ops_manager],
      phoneE164: '+971501110002',
    },
  });

  const agentSpecs = [
    { email: 'agent1@rentflow.demo', name: 'Ahmed Al Marri', phone: '+971501110010' },
    { email: 'agent2@rentflow.demo', name: 'Priya Singh', phone: '+971501110011' },
    { email: 'agent3@rentflow.demo', name: 'Kareem Hassan', phone: '+971501110012' },
  ];

  const agents = [];
  for (const spec of agentSpecs) {
    const u = await prisma.user.upsert({
      where: { companyId_email: { companyId: company.id, email: spec.email } },
      update: {},
      create: {
        companyId: company.id,
        email: spec.email,
        passwordHash: STUB_HASH,
        fullName: spec.name,
        roles: [RoleName.field_agent],
        phoneE164: spec.phone,
      },
    });
    const fa = await prisma.fieldAgent.upsert({
      where: { userId: u.id },
      update: {},
      create: {
        companyId: company.id,
        userId: u.id,
        performanceScore: 60 + Math.floor(Math.random() * 30),
        preferredAreas: ['JVC', 'Marina', 'Bur Dubai'].slice(0, 1 + Math.floor(Math.random() * 3)),
      },
    });
    agents.push({ user: u, agent: fa });
  }

  // ---------------------------------------------------------------------------
  // Owners
  // ---------------------------------------------------------------------------
  const ownerSpecs = [
    { name: 'Mohammed Owner', phone: '+971501112001' },
    { name: 'Fatima Property Holdings', phone: '+971501112002' },
    { name: 'Rashid Real Estate LLC', phone: '+971501112003' },
    { name: 'Sara Al Nuaimi', phone: '+971501112004' },
    { name: 'Khaled Investments', phone: '+971501112005' },
  ];

  const owners = [];
  for (const spec of ownerSpecs) {
    const o = await prisma.owner.upsert({
      where: { companyId_phoneE164: { companyId: company.id, phoneE164: spec.phone } },
      update: {},
      create: {
        companyId: company.id,
        fullName: spec.name,
        phoneE164: spec.phone,
        trustScore: 50 + Math.floor(Math.random() * 40),
        responseRate: 0.5 + Math.random() * 0.5,
        lastContactedAt: daysAgo(Math.floor(Math.random() * 7)),
      },
    });
    owners.push(o);
  }

  // ---------------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------------
  const propertySpecs: Array<{
    code: string;
    name: string;
    type: PropertyType;
    area: string;
    priceAed: number;
    status: PropertyStatus;
  }> = [
    { code: 'RF-001', name: 'JVC Bedspace - Block 12',     type: PropertyType.bed_space,     area: 'JVC',         priceAed: 1200, status: PropertyStatus.available },
    { code: 'RF-002', name: 'Bur Dubai Shared Room',       type: PropertyType.shared_room,   area: 'Bur Dubai',   priceAed: 2200, status: PropertyStatus.available },
    { code: 'RF-003', name: 'Al Barsha Partition',          type: PropertyType.partition,     area: 'Al Barsha',   priceAed: 1800, status: PropertyStatus.pending_owner_confirmation },
    { code: 'RF-004', name: 'Marina Master Room',           type: PropertyType.master_room,   area: 'Marina',      priceAed: 3500, status: PropertyStatus.available },
    { code: 'RF-005', name: 'Marina Studio - Tower B',      type: PropertyType.studio,        area: 'Marina',      priceAed: 5500, status: PropertyStatus.available },
    { code: 'RF-006', name: 'JLT 1BR Furnished',            type: PropertyType.one_bedroom,   area: 'JLT',         priceAed: 7200, status: PropertyStatus.available },
    { code: 'RF-007', name: 'Downtown 2BR',                 type: PropertyType.two_bedroom,   area: 'Downtown',    priceAed: 11500, status: PropertyStatus.rented },
    { code: 'RF-008', name: 'Springs Villa',                type: PropertyType.villa,         area: 'The Springs', priceAed: 18000, status: PropertyStatus.needs_media },
    { code: 'RF-009', name: 'Deira Bedspace - 6th floor',   type: PropertyType.bed_space,     area: 'Deira',       priceAed: 1100, status: PropertyStatus.available },
    { code: 'RF-010', name: 'Al Quoz Studio',               type: PropertyType.studio,        area: 'Al Quoz',     priceAed: 3800, status: PropertyStatus.draft },
  ];

  const properties = [];
  for (let i = 0; i < propertySpecs.length; i++) {
    const spec = propertySpecs[i]!;
    const owner = owners[i % owners.length]!;
    const p = await prisma.property.upsert({
      where: { companyId_code: { companyId: company.id, code: spec.code } },
      update: {},
      create: {
        companyId: company.id,
        ownerId: owner.id,
        code: spec.code,
        name: spec.name,
        type: spec.type,
        status: spec.status,
        area: spec.area,
        priceAed: spec.priceAed,
        depositAed: spec.priceAed,
        description: `Well-maintained ${spec.name} in ${spec.area}. Walking distance to Metro and supermarkets. Suitable for working professionals.`,
        occupancyMax: spec.type === PropertyType.bed_space ? 1 : spec.type === PropertyType.studio ? 2 : 4,
        rentalMinMonths: 1,
        amenities: ['wifi', 'ac', 'cleaning', 'metro_nearby'],
        viewingAccess: 'Coordinate via WhatsApp; agent has key.',
        moveInDate: daysAgo(-7),
        priceConfirmedAt: daysAgo(3),
        availabilityConfirmedAt: spec.status === PropertyStatus.available ? daysAgo(1) : null,
        qualityScore: 50 + Math.floor(Math.random() * 40),
        readinessScore: spec.status === PropertyStatus.available ? 70 + Math.floor(Math.random() * 25) : 30 + Math.floor(Math.random() * 30),
      },
    });
    properties.push(p);

    await prisma.propertyScoreSnapshot.create({
      data: {
        propertyId: p.id,
        kind: ScoreKind.quality,
        score: p.qualityScore,
        factors: { mediaQuality: 0.7, conversion: 0.5, location: 0.8 },
      },
    });
    await prisma.propertyScoreSnapshot.create({
      data: {
        propertyId: p.id,
        kind: ScoreKind.readiness,
        score: p.readinessScore,
        factors: { availabilityFresh: 1, hasPhotos: p.qualityScore > 50 ? 1 : 0, ownerLinked: 1 },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Campaigns + post packages + tracking links
  // ---------------------------------------------------------------------------
  const campaign = await prisma.campaign.create({
    data: {
      companyId: company.id,
      name: 'May 2026 — Affordable Bedspaces',
      goal: 'Fill bed spaces across JVC and Deira',
      startsAt: daysAgo(30),
      endsAt: daysAgo(-30),
      active: true,
    },
  });

  const fbGroup = await prisma.postChannel.upsert({
    where: { companyId_platform_name: { companyId: company.id, platform: ChannelPlatform.facebook, name: 'Dubai Rooms FB Group' } },
    update: {},
    create: { companyId: company.id, name: 'Dubai Rooms FB Group', platform: ChannelPlatform.facebook, kind: ChannelKind.group },
  });
  const waGroup = await prisma.postChannel.upsert({
    where: { companyId_platform_name: { companyId: company.id, platform: ChannelPlatform.whatsapp, name: 'Bedspaces UAE WA' } },
    update: {},
    create: { companyId: company.id, name: 'Bedspaces UAE WA', platform: ChannelPlatform.whatsapp, kind: ChannelKind.group },
  });

  const postPackages = [];
  for (let i = 0; i < 6; i++) {
    const property = properties[i]!;
    const sourceCode = property.code;
    const postCode = `POST-${(1000 + i).toString(36).toUpperCase()}`;
    const prefilledText = `Hi, I am interested in Property ${sourceCode} from Post ${postCode}`;
    const whatsappUrl = `${WA_BASE}?text=${encodeURIComponent(prefilledText)}`;
    const status =
      i === 0 ? PostPackageStatus.published :
      i === 1 ? PostPackageStatus.published :
      i === 2 ? PostPackageStatus.approved :
      i === 3 ? PostPackageStatus.draft :
      i === 4 ? PostPackageStatus.published :
      PostPackageStatus.paused;
    const channel = i % 2 === 0 ? fbGroup : waGroup;

    const pkg = await prisma.postPackage.create({
      data: {
        companyId: company.id,
        propertyId: property.id,
        campaignId: campaign.id,
        channelId: channel.id,
        status,
        title: property.name,
        shortCaption: `${property.name} — AED ${property.priceAed} / month. Available now.`,
        longCaption: `${property.name} in ${property.area}. AED ${property.priceAed}/month. Wifi, AC, cleaning. Walking distance to Metro. WhatsApp ${WA_LOCAL} for viewing.`,
        whatsappCaption: `🏠 ${property.name}\nAED ${property.priceAed}/month\n📍 ${property.area}\nWA: ${WA_LOCAL}\nCode: ${sourceCode}`,
        facebookCaption: `${property.name}\n${property.area} | AED ${property.priceAed}/month\nFurnished, wifi included.\nMessage on WhatsApp: ${WA_BASE}`,
        priceLine: `AED ${property.priceAed} / month`,
        availabilityLine: 'Available now',
        features: ['Wifi', 'AC', 'Cleaning', 'Near Metro'],
        channelName: channel.name,
        publishedById: status === PostPackageStatus.published || status === PostPackageStatus.paused ? opsManager.id : null,
        publishedAt: status === PostPackageStatus.published || status === PostPackageStatus.paused ? daysAgo(Math.floor(Math.random() * 7)) : null,
        approvedById: status !== PostPackageStatus.draft ? opsManager.id : null,
        approvedAt: status !== PostPackageStatus.draft ? daysAgo(Math.floor(Math.random() * 7) + 1) : null,
        pausedAt: status === PostPackageStatus.paused ? daysAgo(1) : null,
      },
    });

    await prisma.trackingLink.create({
      data: {
        companyId: company.id,
        postPackageId: pkg.id,
        sourceCode,
        postCode,
        shortUrl: `http://localhost:3001/t/${postCode}`,
        whatsappUrl,
        clicks: Math.floor(Math.random() * 30),
        lastClickAt: daysAgo(Math.floor(Math.random() * 5)),
      },
    });

    postPackages.push(pkg);
  }

  // ---------------------------------------------------------------------------
  // Leads
  // ---------------------------------------------------------------------------
  const leadSpecs = [
    { name: 'Sami Khan',      phone: '+971501119001', status: LeadStatus.new,             temp: LeadTemperature.warm },
    { name: 'Layla Ahmed',    phone: '+971501119002', status: LeadStatus.qualifying,      temp: LeadTemperature.hot },
    { name: 'Tom Williams',   phone: '+971501119003', status: LeadStatus.qualified,       temp: LeadTemperature.hot },
    { name: 'Aisha Noor',     phone: '+971501119004', status: LeadStatus.viewing_scheduled, temp: LeadTemperature.hot },
    { name: 'Daniel Park',    phone: '+971501119005', status: LeadStatus.viewing_completed, temp: LeadTemperature.warm },
    { name: 'Fatima Rashid',  phone: '+971501119006', status: LeadStatus.negotiating,     temp: LeadTemperature.hot },
    { name: 'Rajesh Kumar',   phone: '+971501119007', status: LeadStatus.won,             temp: LeadTemperature.hot },
    { name: 'Ana García',     phone: '+971501119008', status: LeadStatus.lost,            temp: LeadTemperature.cold },
    { name: 'Bilal Said',     phone: '+971501119009', status: LeadStatus.contacted,       temp: LeadTemperature.warm },
    { name: 'Carla Pinto',    phone: '+971501119010', status: LeadStatus.cold,            temp: LeadTemperature.cold },
    { name: 'Ivan Petrov',    phone: '+971501119011', status: LeadStatus.options_sent,    temp: LeadTemperature.warm },
    { name: 'Mei Lin',        phone: '+971501119012', status: LeadStatus.viewing_requested, temp: LeadTemperature.hot },
    { name: 'Hassan Idris',   phone: '+971501119013', status: LeadStatus.opted_out,       temp: LeadTemperature.unqualified },
    { name: 'Olga Volkova',   phone: '+971501119014', status: LeadStatus.qualified,       temp: LeadTemperature.warm },
    { name: 'Mark O\'Reilly', phone: '+971501119015', status: LeadStatus.new,             temp: LeadTemperature.warm },
  ];

  const leads = [];
  for (let i = 0; i < leadSpecs.length; i++) {
    const spec = leadSpecs[i]!;
    const property = properties[i % properties.length]!;
    const pkg = postPackages[i % postPackages.length]!;

    const conv = await prisma.whatsAppConversation.create({
      data: {
        companyId: company.id,
        leadPhoneE164: spec.phone,
        mode: spec.status === LeadStatus.opted_out ? ConversationMode.closed : ConversationMode.ai,
        lastInboundAt: daysAgo(Math.floor(Math.random() * 5)),
      },
    });

    const sourceRow = await prisma.leadSource.create({
      data: {
        companyId: company.id,
        channel: pkg.channelId === fbGroup.id ? ChannelPlatform.facebook : ChannelPlatform.whatsapp,
        channelKind: ChannelKind.group,
        channelName: pkg.channelName,
        campaignName: campaign.name,
        sourceCode: property.code,
        postCode: `POST-${(1000 + (i % postPackages.length)).toString(36).toUpperCase()}`,
        groupOrPage: pkg.channelName,
        rawText: `Hi, I am interested in Property ${property.code}`,
      },
    });

    const lead = await prisma.lead.create({
      data: {
        companyId: company.id,
        propertyId: property.id,
        postPackageId: pkg.id,
        campaignId: campaign.id,
        sourceId: sourceRow.id,
        whatsappConversationId: conv.id,
        fullName: spec.name,
        phoneE164: spec.phone,
        status: spec.status,
        temperature: spec.temp,
        qualificationScore: spec.temp === LeadTemperature.hot ? 80 : spec.temp === LeadTemperature.warm ? 60 : 30,
        attributionConfidence: AttributionConfidence.high,
        budgetAed: property.priceAed ? Number(property.priceAed) + (Math.random() < 0.5 ? -200 : 200) : null,
        preferredArea: property.area,
        peopleCount: 1 + Math.floor(Math.random() * 3),
        moveInDate: daysAgo(-Math.floor(Math.random() * 30)),
        rentalDurationMonths: pickRandom([1, 3, 6, 12]),
        firstSeenAt: daysAgo(Math.floor(Math.random() * 14)),
        lastInteractionAt: daysAgo(Math.floor(Math.random() * 5)),
      },
    });

    await prisma.whatsAppMessage.create({
      data: {
        companyId: company.id,
        conversationId: conv.id,
        externalId: `wamid.SEED_${randomUUID()}`,
        direction: MessageDirection.inbound,
        type: MessageType.text,
        body: `Hi, I am interested in Property ${property.code}`,
      },
    });

    if (spec.status !== LeadStatus.new) {
      await prisma.whatsAppMessage.create({
        data: {
          companyId: company.id,
          conversationId: conv.id,
          direction: MessageDirection.outbound,
          type: MessageType.text,
          body: `Hi ${spec.name.split(' ')[0]}! Thanks for your interest in ${property.name}. When are you looking to move in?`,
          providerStatus: 'mock_sent',
        },
      });
    }

    leads.push(lead);
  }

  // ---------------------------------------------------------------------------
  // Viewings
  // ---------------------------------------------------------------------------
  const todayLeads = [leads[3]!, leads[5]!, leads[11]!];
  for (let i = 0; i < todayLeads.length; i++) {
    const lead = todayLeads[i]!;
    const agent = agents[i % agents.length]!;
    await prisma.viewing.create({
      data: {
        companyId: company.id,
        leadId: lead.id,
        propertyId: lead.propertyId!,
        fieldAgentId: agent.agent.id,
        status: ViewingStatus.confirmed,
        assignmentStatus: AgentAssignmentStatus.accepted,
        scheduledAt: hoursAhead(2 + i * 2),
        durationMinutes: 30,
      },
    });
  }

  const completedViewing = await prisma.viewing.create({
    data: {
      companyId: company.id,
      leadId: leads[4]!.id,
      propertyId: leads[4]!.propertyId!,
      fieldAgentId: agents[0]!.agent.id,
      status: ViewingStatus.completed,
      assignmentStatus: AgentAssignmentStatus.completed,
      scheduledAt: daysAgo(2),
      durationMinutes: 30,
      arrivedAt: daysAgo(2),
      completedAt: daysAgo(2),
      outcomeNotes: 'Lead liked the property; will discuss with partner.',
    },
  });

  await prisma.viewingFeedback.create({
    data: {
      viewingId: completedViewing.id,
      rating: 4,
      comments: 'Property matches photos. Considering.',
      bookingIntent: 'maybe',
    },
  });

  // No-show
  await prisma.viewing.create({
    data: {
      companyId: company.id,
      leadId: leads[8]!.id,
      propertyId: leads[8]!.propertyId!,
      fieldAgentId: agents[1]!.agent.id,
      status: ViewingStatus.no_show,
      assignmentStatus: AgentAssignmentStatus.completed,
      scheduledAt: daysAgo(1),
      durationMinutes: 30,
    },
  });

  // ---------------------------------------------------------------------------
  // Deals
  // ---------------------------------------------------------------------------
  const wonLead = leads.find((l) => l.status === LeadStatus.won)!;
  const wonDeal = await prisma.deal.create({
    data: {
      companyId: company.id,
      leadId: wonLead.id,
      propertyId: wonLead.propertyId!,
      fieldAgentId: agents[0]!.agent.id,
      status: DealStatus.won,
      rentAmount: 5500,
      depositAmount: 5500,
      commissionAmount: 2750,
      commissionPaidBy: 'tenant',
      moveInDate: daysAgo(-7),
      rentalDurationMonths: 6,
      closedAt: daysAgo(2),
    },
  });
  await prisma.commission.create({
    data: {
      dealId: wonDeal.id,
      status: CommissionStatus.collected,
      expectedAmount: 2750,
      invoicedAmount: 2750,
      collectedAmount: 2750,
      invoicedAt: daysAgo(2),
      collectedAt: daysAgo(1),
    },
  });

  const lostLead = leads.find((l) => l.status === LeadStatus.lost)!;
  await prisma.deal.create({
    data: {
      companyId: company.id,
      leadId: lostLead.id,
      propertyId: lostLead.propertyId!,
      fieldAgentId: agents[1]!.agent.id,
      status: DealStatus.lost,
      lostReason: 'Found cheaper option elsewhere',
      closedAt: daysAgo(1),
    },
  });

  const negLead = leads.find((l) => l.status === LeadStatus.negotiating)!;
  const negDeal = await prisma.deal.create({
    data: {
      companyId: company.id,
      leadId: negLead.id,
      propertyId: negLead.propertyId!,
      fieldAgentId: agents[2]!.agent.id,
      status: DealStatus.negotiating,
      rentAmount: 7200,
      depositAmount: 7200,
      commissionAmount: 3600,
      commissionPaidBy: 'tenant',
    },
  });
  await prisma.commission.create({
    data: {
      dealId: negDeal.id,
      status: CommissionStatus.expected,
      expectedAmount: 3600,
    },
  });

  // ---------------------------------------------------------------------------
  // AI Prompt Templates (initial set)
  // ---------------------------------------------------------------------------
  const templates = [
    { machine: 'lead', state: 'initial_contact', template: 'Hi {{lead.firstName}}! Thanks for messaging RentFlow. I see you are interested in {{property.name}}. Is that correct?' },
    { machine: 'lead', state: 'collect_move_in_date', template: 'Great! When would you like to move in?' },
    { machine: 'lead', state: 'collect_people_count', template: 'How many people will be staying?' },
    { machine: 'lead', state: 'collect_budget', template: 'What is your monthly budget in AED?' },
    { machine: 'lead', state: 'collect_area', template: 'Which area do you prefer? (You mentioned {{property.area}}; we have similar options nearby.)' },
    { machine: 'lead', state: 'collect_duration', template: 'How long do you plan to stay?' },
    { machine: 'lead', state: 'suggest_property', template: 'Based on what you said, {{property.name}} in {{property.area}} at AED {{property.priceAed}}/month is a strong fit. Want to book a viewing?' },
    { machine: 'owner', state: 'ask_availability', template: 'Hi {{owner.firstName}}, is {{property.name}} still available for rent?' },
    { machine: 'feedback', state: 'request_rating', template: 'Thanks for visiting {{property.name}}! How would you rate the viewing on a scale of 1-5?' },
    { machine: 'post_caption_short', state: null, template: '{{property.name}} — AED {{property.priceAed}}/month in {{property.area}}. Available now. WA {{whatsapp.local}}' },
  ];

  for (const t of templates) {
    await prisma.aIPromptTemplate.upsert({
      where: { companyId_machine_state_version: { companyId: company.id, machine: t.machine, state: t.state ?? '', version: 1 } as any },
      update: { template: t.template },
      create: {
        companyId: company.id,
        machine: t.machine,
        state: t.state ?? null,
        version: 1,
        template: t.template,
      },
    });
  }

  console.log('✅ Seed complete.');
  console.log(`Company: ${company.name}`);
  console.log(`Login: admin@rentflow.demo / rentflow123 (stub hash; real auth tba)`);
  console.log(`Properties: ${properties.length}, Leads: ${leads.length}, Owners: ${owners.length}`);
  console.log(`WhatsApp number: ${WA_E164}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
