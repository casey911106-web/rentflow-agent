import { Injectable, NotFoundException } from '@nestjs/common';
import type { ViewingStatus } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ViewingsService {
  constructor(private readonly prisma: PrismaService) {}

  list(
    companyId: string,
    filter: { date?: string; status?: ViewingStatus; agentId?: string; propertyId?: string } = {},
  ) {
    const where: Record<string, unknown> = { companyId };
    if (filter.status) where.status = filter.status;
    if (filter.agentId) where.fieldAgentId = filter.agentId;
    if (filter.propertyId) where.propertyId = filter.propertyId;
    if (filter.date) {
      const start = new Date(filter.date);
      const end = new Date(start);
      end.setUTCHours(23, 59, 59, 999);
      where.scheduledAt = { gte: start, lte: end };
    }
    return this.prisma.viewing.findMany({
      where,
      include: {
        property: { select: { id: true, code: true, name: true, area: true } },
        lead: { select: { id: true, fullName: true, phoneE164: true, status: true } },
        fieldAgent: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 200,
    });
  }

  async findById(companyId: string, id: string) {
    const v = await this.prisma.viewing.findFirst({
      where: { id, companyId },
      include: {
        property: true,
        lead: { include: { property: true } },
        fieldAgent: { include: { user: true } },
        feedback: true,
      },
    });
    if (!v) throw new NotFoundException('Viewing not found');
    return v;
  }

  async create(
    companyId: string,
    body: {
      leadId: string;
      propertyId: string;
      scheduledAt: string;
      durationMinutes?: number;
      fieldAgentId?: string;
    },
  ) {
    return this.prisma.viewing.create({
      data: {
        companyId,
        leadId: body.leadId,
        propertyId: body.propertyId,
        scheduledAt: new Date(body.scheduledAt),
        durationMinutes: body.durationMinutes ?? 30,
        fieldAgentId: body.fieldAgentId,
        status: body.fieldAgentId ? 'assigned' : 'requested',
        assignmentStatus: body.fieldAgentId ? 'pending' : 'pending',
      },
    });
  }

  async updateStatus(companyId: string, id: string, status: ViewingStatus, notes?: string) {
    await this.findById(companyId, id);
    const data: Record<string, unknown> = { status };
    if (notes) data.outcomeNotes = notes;
    if (status === 'completed') data.completedAt = new Date();
    return this.prisma.viewing.update({ where: { id }, data });
  }

  async assignAgent(companyId: string, id: string, fieldAgentId: string) {
    await this.findById(companyId, id);
    return this.prisma.viewing.update({
      where: { id },
      data: { fieldAgentId, status: 'assigned', assignmentStatus: 'accepted' },
    });
  }

  async addFeedback(
    companyId: string,
    id: string,
    body: { rating?: number; comments?: string; bookingIntent?: string },
  ) {
    await this.findById(companyId, id);
    return this.prisma.viewingFeedback.upsert({
      where: { viewingId: id },
      update: body,
      create: { viewingId: id, ...body },
    });
  }
}
