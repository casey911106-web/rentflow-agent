import { Injectable, NotFoundException } from '@nestjs/common';
import type { LeadStatus, LeadTemperature } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  list(
    companyId: string,
    filter: { status?: LeadStatus; temperature?: LeadTemperature; propertyId?: string; postPackageId?: string } = {},
  ) {
    return this.prisma.lead.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.temperature ? { temperature: filter.temperature } : {}),
        ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
        ...(filter.postPackageId ? { postPackageId: filter.postPackageId } : {}),
      },
      include: {
        property: { select: { id: true, code: true, name: true } },
        postPackage: { select: { id: true, title: true } },
        whatsappConversation: { select: { id: true, mode: true, lastInboundAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async findById(companyId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        property: true,
        postPackage: { include: { trackingLink: true } },
        source: true,
        whatsappConversation: { include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 } } },
        viewings: { include: { fieldAgent: { include: { user: { select: { fullName: true } } } } } },
        deal: { include: { commission: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async updateStatus(companyId: string, id: string, status: LeadStatus) {
    await this.findById(companyId, id);
    return this.prisma.lead.update({ where: { id }, data: { status } });
  }

  async update(companyId: string, id: string, body: Record<string, unknown>) {
    await this.findById(companyId, id);
    // SECURITY: explicit allowlist. The controller takes Record<string, unknown>
    // for ergonomic edits, but we MUST NOT pass that through to Prisma —
    // otherwise an attacker can pass companyId, attributionPlacementId,
    // whatsappConversationId, deletedAt, etc. and cross tenants or corrupt
    // attribution. Only the fields below can be edited via this endpoint.
    const data: Record<string, unknown> = {};
    const allowed = [
      'fullName',
      'status',
      'temperature',
      'qualificationScore',
      'budgetAed',
      'preferredArea',
      'peopleCount',
      'moveInDate',
      'rentalDurationMonths',
      'propertyId',
    ] as const;
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }
    if (Object.keys(data).length === 0) return this.findById(companyId, id);
    return this.prisma.lead.update({ where: { id }, data });
  }
}
