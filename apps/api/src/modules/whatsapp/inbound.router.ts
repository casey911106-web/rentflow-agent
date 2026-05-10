import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { parseAttribution } from '@rentflow/shared';
import type { InboundMessage } from '@rentflow/integrations';
import { PrismaService } from '../../prisma/prisma.service';
import { InboundDebouncer } from './inbound-debouncer.service';
import { OperatorInboundHandler } from './operator-inbound.handler';
import { OwnerReplyParser } from '../automation/owner-reply.parser';
import { PushService } from '../notifications/push.service';
import { IngestionService } from '../ingestion/ingestion.service';

@Injectable()
export class InboundRouter {
  private readonly logger = new Logger(InboundRouter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly debouncer: InboundDebouncer,
    private readonly operatorHandler: OperatorInboundHandler,
    @Inject(forwardRef(() => OwnerReplyParser))
    private readonly ownerParser: OwnerReplyParser,
    private readonly push: PushService,
    @Inject(forwardRef(() => IngestionService))
    private readonly ingestion: IngestionService,
  ) {}

  /**
   * Idempotently process a single inbound WhatsApp message:
   * 1. Resolve the company (via business number or single-tenant default).
   * 2. Find or create a WhatsAppConversation for the sender.
   * 3. Persist the WhatsAppMessage.
   * 4. If the conversation has no Lead yet, create one with attribution.
   */
  async route(msg: InboundMessage): Promise<{ leadId?: string; conversationId: string; messageId: string }> {
    // Early idempotency on Meta's wamid: when our endpoint times out or
    // Meta double-delivers, the same message arrives twice. Without this
    // guard the operator handler, owner-reply parser, and partner ingestion
    // would re-fire — clicking suggestion buttons twice, parsing the same
    // owner availability twice, processing /property twice. The
    // WhatsAppMessage row is the source of truth for "have we seen this".
    if (msg.externalId) {
      const seen = await this.prisma.whatsAppMessage.findUnique({
        where: { externalId: msg.externalId },
        select: { id: true, conversationId: true },
      });
      if (seen) {
        this.logger.debug(`Duplicate inbound ignored (wamid=${msg.externalId})`);
        return { conversationId: seen.conversationId, messageId: seen.id };
      }
    }

    const company = await this.resolveCompany(msg.toBusinessNumber);
    if (!company) {
      this.logger.warn(`No company resolved for business number ${msg.toBusinessNumber}; dropping message.`);
      throw new Error('Unknown business number');
    }

    // Operator shortcut: if the message is from the operator's personal phone,
    // try the operator handler first. It returns true when the message was
    // a button reply or a pending-edit text — those don't create a Lead.
    const operatorE164 = process.env.OPERATOR_WHATSAPP_E164;
    if (operatorE164 && msg.from === operatorE164) {
      // Persist a minimal record for traceability (no conversation/lead).
      const handled = await this.operatorHandler.handle({
        companyId: company.id,
        operatorE164,
        inboundMessageId: msg.externalId ?? '',
        buttonId: msg.buttonReply?.id,
        text: msg.body,
      });
      if (handled) {
        return { conversationId: 'operator', messageId: msg.externalId ?? '' };
      }
      // Fall through to normal lead flow if the operator was not acting on a
      // suggestion (e.g. they're testing as a regular lead).
    }

    // Owner shortcut: if the message is from a known owner and there's a
    // pending OwnerAvailabilityCheck, parse the reply and update the
    // property. Otherwise fall through to the lead flow.
    if (msg.body) {
      try {
        const handledByOwner = await this.ownerParser.handle({
          companyId: company.id,
          fromE164: msg.from,
          body: msg.body,
        });
        if (handledByOwner) {
          return { conversationId: 'owner', messageId: msg.externalId ?? '' };
        }
      } catch (err) {
        this.logger.error(`Owner reply parser failed: ${(err as Error).message}`);
      }
    }

    let conversation = await this.prisma.whatsAppConversation.findFirst({
      where: { companyId: company.id, leadPhoneE164: msg.from },
      include: { lead: true },
    });
    if (!conversation) {
      conversation = await this.prisma.whatsAppConversation.create({
        data: { companyId: company.id, leadPhoneE164: msg.from, lastInboundAt: msg.receivedAt },
        include: { lead: true },
      });
    } else {
      await this.prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: msg.receivedAt },
      });
    }

    // Idempotent on externalId
    const existing = msg.externalId
      ? await this.prisma.whatsAppMessage.findUnique({ where: { externalId: msg.externalId } })
      : null;
    const stored =
      existing ??
      (await this.prisma.whatsAppMessage.create({
        data: {
          companyId: company.id,
          conversationId: conversation.id,
          externalId: msg.externalId,
          direction: 'inbound',
          type: msg.type,
          body: msg.body,
          mediaUrl: msg.mediaUrl,
        },
      }));

    // Partner ingestion check — if the sender is a registered partner User
    // (User.isPartner = true), route /property submissions to the
    // IngestionService instead of the lead flow. Their phone never becomes
    // a Lead, even on subsequent messages.
    const partner = await this.prisma.user.findFirst({
      where: {
        companyId: company.id,
        isPartner: true,
        phoneE164: msg.from,
        deletedAt: null,
        status: 'active',
      },
      select: { id: true },
    });
    if (partner) {
      const handled = await this.ingestion.tryHandle({
        companyId: company.id,
        conversationId: conversation.id,
        partnerUserId: partner.id,
        partnerPhoneE164: msg.from,
        inbound: {
          type: msg.type,
          body: msg.body ?? null,
          raw: msg.raw,
          receivedAt: msg.receivedAt,
        },
      });
      if (handled) {
        return { conversationId: conversation.id, messageId: stored.id };
      }
      // Partner sent something not /property and is not in an active
      // ingestion session — silently ignore (don't create a Lead).
      this.logger.debug(`Partner ${msg.from} sent non-ingestion message; ignoring.`);
      return { conversationId: conversation.id, messageId: stored.id };
    }

    let leadId = conversation.lead?.id;
    if (!leadId) {
      const lead = await this.createLeadFromMessage(company.id, conversation.id, msg);
      leadId = lead.id;
    }

    // Schedule the lead workflow with a 10s debounce per conversation so
    // multi-line messages ("¿precio?\n¿deposit?\n¿día libre?") collapse into
    // a single Claude call once the lead pauses.
    if (leadId) {
      this.debouncer.schedule({
        companyId: company.id,
        leadId,
        conversationId: conversation.id,
      });
      // Push to ops/admins so they know a lead just replied even if they
      // don't have the dashboard open. Fire-and-forget.
      this.notifyLeadReplied(company.id, leadId, msg).catch(() => {});
    }

    return { leadId, conversationId: conversation.id, messageId: stored.id };
  }

  private async notifyLeadReplied(companyId: string, leadId: string, msg: InboundMessage) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { fullName: true, phoneE164: true },
    });
    if (!lead) return;
    const opsUsers = await this.prisma.user.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'active',
        roles: { hasSome: ['ops_manager', 'super_admin'] },
      },
      select: { id: true },
    });
    if (opsUsers.length === 0) return;
    await this.push.notifyLeadReplied(
      opsUsers.map((u) => u.id),
      {
        leadId,
        leadName: lead.fullName,
        phoneE164: lead.phoneE164,
        preview: msg.body ?? '(media)',
      },
    );
  }

  private async resolveCompany(businessNumberE164: string) {
    // MVP: pick by AppSetting `whatsapp.business_number.e164` match, then any single tenant.
    const setting = await this.prisma.appSetting.findFirst({
      where: { key: 'whatsapp.business_number' },
    });
    if (setting && (setting.value as { e164?: string }).e164 === businessNumberE164) {
      return this.prisma.company.findUnique({ where: { id: setting.companyId } });
    }
    return this.prisma.company.findFirst({ where: { deletedAt: null } });
  }

  private async createLeadFromMessage(companyId: string, conversationId: string, msg: InboundMessage) {
    const text = msg.body ?? '';
    const { propertyCode, postCode, placementSlug } = parseAttribution(text);

    let propertyId: string | undefined;
    let postPackageId: string | undefined;
    let trackingLinkId: string | undefined;
    let attributionPlacementId: string | undefined;
    let attributionSource: string | undefined;
    let attributionConfidence: 'high' | 'medium' | 'low' | 'none' = 'none';

    if (propertyCode) {
      const prop = await this.prisma.property.findFirst({
        where: { companyId, code: propertyCode, deletedAt: null },
        select: { id: true },
      });
      if (prop) {
        propertyId = prop.id;
        attributionConfidence = 'medium';
      }
    }

    if (postCode) {
      const tracking = await this.prisma.trackingLink.findUnique({
        where: { postCode },
        include: { postPackage: { select: { id: true, propertyId: true, channelId: true, channel: true, campaignId: true, channelName: true } } },
      });
      if (tracking && tracking.companyId === companyId) {
        trackingLinkId = tracking.id;
        postPackageId = tracking.postPackageId;
        propertyId = propertyId ?? tracking.postPackage.propertyId;
        attributionConfidence = propertyCode ? 'high' : 'medium';
      }
    }

    // Owned-channel attribution: a [ref:<slug>] in the first inbound traces
    // back to a specific PostPlacement (one Telegram/IG/FB post we made).
    if (placementSlug) {
      const placement = await this.prisma.postPlacement.findUnique({
        where: { trackingSlug: placementSlug },
        select: {
          id: true,
          companyId: true,
          channelKind: true,
          channelName: true,
          postPackage: { select: { id: true, propertyId: true } },
        },
      });
      if (placement && placement.companyId === companyId) {
        attributionPlacementId = placement.id;
        attributionSource = placement.channelKind ?? placement.channelName ?? undefined;
        postPackageId = postPackageId ?? placement.postPackage.id;
        propertyId = propertyId ?? placement.postPackage.propertyId;
        attributionConfidence = 'high';
      }
    }

    const sourceRow = await this.prisma.leadSource.create({
      data: {
        companyId,
        channel: 'whatsapp',
        sourceCode: propertyCode,
        postCode: postCode,
        rawText: text,
      },
    });

    const lead = await this.prisma.lead.create({
      data: {
        companyId,
        propertyId,
        postPackageId,
        trackingLinkId,
        attributionPlacementId,
        attributionSource,
        sourceId: sourceRow.id,
        whatsappConversationId: conversationId,
        phoneE164: msg.from,
        status: 'new',
        attributionConfidence,
        firstSeenAt: msg.receivedAt,
        lastInteractionAt: msg.receivedAt,
      },
    });

    this.logger.log(
      `Created lead ${lead.id} (${attributionConfidence}${attributionSource ? `, src=${attributionSource}` : ''}) for ${msg.from}`,
    );
    return lead;
  }
}
