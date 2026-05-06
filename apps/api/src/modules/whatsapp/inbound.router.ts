import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { parseAttribution } from '@rentflow/shared';
import type { InboundMessage } from '@rentflow/integrations';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadWorkflowRunner } from './lead-workflow.runner';
import { OperatorInboundHandler } from './operator-inbound.handler';
import { OwnerReplyParser } from '../automation/owner-reply.parser';

@Injectable()
export class InboundRouter {
  private readonly logger = new Logger(InboundRouter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: LeadWorkflowRunner,
    private readonly operatorHandler: OperatorInboundHandler,
    @Inject(forwardRef(() => OwnerReplyParser))
    private readonly ownerParser: OwnerReplyParser,
  ) {}

  /**
   * Idempotently process a single inbound WhatsApp message:
   * 1. Resolve the company (via business number or single-tenant default).
   * 2. Find or create a WhatsAppConversation for the sender.
   * 3. Persist the WhatsAppMessage.
   * 4. If the conversation has no Lead yet, create one with attribution.
   */
  async route(msg: InboundMessage): Promise<{ leadId?: string; conversationId: string; messageId: string }> {
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

    let leadId = conversation.lead?.id;
    if (!leadId) {
      const lead = await this.createLeadFromMessage(company.id, conversation.id, msg);
      leadId = lead.id;
    }

    // Trigger the lead workflow runner. We swallow errors here so a runner
    // failure never blocks ingestion of the underlying message.
    if (leadId) {
      try {
        await this.runner.run({
          companyId: company.id,
          leadId,
          conversationId: conversation.id,
          inboundMessageId: stored.id,
        });
      } catch (err) {
        this.logger.error(
          `Lead workflow runner failed for lead=${leadId}: ${(err as Error).message}`,
        );
      }
    }

    return { leadId, conversationId: conversation.id, messageId: stored.id };
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
    const { propertyCode, postCode } = parseAttribution(text);

    let propertyId: string | undefined;
    let postPackageId: string | undefined;
    let trackingLinkId: string | undefined;
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
        sourceId: sourceRow.id,
        whatsappConversationId: conversationId,
        phoneE164: msg.from,
        status: 'new',
        attributionConfidence,
        firstSeenAt: msg.receivedAt,
        lastInteractionAt: msg.receivedAt,
      },
    });

    this.logger.log(`Created lead ${lead.id} (${attributionConfidence}) for ${msg.from}`);
    return lead;
  }
}
