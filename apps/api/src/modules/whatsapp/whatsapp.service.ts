import { Injectable, NotFoundException } from '@nestjs/common';
import type { ConversationMode } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from './adapter.provider';

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: WhatsAppAdapterProvider,
  ) {}

  listConversations(companyId: string) {
    return this.prisma.whatsAppConversation.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
      include: {
        lead: { select: { id: true, fullName: true, status: true, temperature: true } },
        _count: { select: { messages: true } },
      },
      take: 200,
    });
  }

  async findConversation(companyId: string, id: string) {
    const conv = await this.prisma.whatsAppConversation.findFirst({
      where: { id, companyId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 500 },
        lead: { include: { property: true } },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    return conv;
  }

  async send(companyId: string, conversationId: string, body: string) {
    const conv = await this.findConversation(companyId, conversationId);

    const result = await this.adapter.adapter.sendText({
      to: conv.leadPhoneE164,
      body,
      conversationId,
    });

    await this.prisma.whatsAppMessage.create({
      data: {
        companyId,
        conversationId,
        externalId: result.externalId || null,
        direction: 'outbound',
        type: 'text',
        body,
        providerStatus: result.status,
        providerError: result.error,
      },
    });

    await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { lastOutboundAt: new Date() },
    });

    return { ok: result.status !== 'failed', status: result.status, externalId: result.externalId };
  }

  async setMode(companyId: string, conversationId: string, mode: ConversationMode) {
    await this.findConversation(companyId, conversationId);
    return this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { mode },
    });
  }
}
