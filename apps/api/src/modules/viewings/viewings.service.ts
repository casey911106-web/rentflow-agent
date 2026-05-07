import { Injectable, NotFoundException } from '@nestjs/common';
import type { ViewingStatus } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.strategy';

@Injectable()
export class ViewingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the field_agent id to scope queries to, when the caller is a
   * field_agent without admin/ops privileges. Returns null when no scoping
   * needed (admin/ops_manager) and `undefined` when the user is field_agent
   * but has no FieldAgent record (treat as "scoped to nothing").
   */
  private async resolveAgentScope(user: JwtPayload): Promise<string | null | undefined> {
    const isAdminOrOps = user.roles.includes('super_admin') || user.roles.includes('ops_manager');
    if (isAdminOrOps) return null;
    if (!user.roles.includes('field_agent')) return undefined;
    const fa = await this.prisma.fieldAgent.findUnique({
      where: { userId: user.sub },
      select: { id: true },
    });
    return fa?.id ?? undefined;
  }

  async list(
    user: JwtPayload,
    filter: { date?: string; status?: ViewingStatus; agentId?: string; propertyId?: string } = {},
  ) {
    const scope = await this.resolveAgentScope(user);
    if (scope === undefined) return [];

    const where: Record<string, unknown> = { companyId: user.companyId };
    if (filter.status) where.status = filter.status;
    if (filter.propertyId) where.propertyId = filter.propertyId;
    // Field-agent callers are forced to their own viewings; the agentId query
    // param is honored only when the caller has admin/ops privileges.
    if (scope) where.fieldAgentId = scope;
    else if (filter.agentId) where.fieldAgentId = filter.agentId;
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

  async findById(user: JwtPayload, id: string) {
    const scope = await this.resolveAgentScope(user);
    if (scope === undefined) throw new NotFoundException('Viewing not found');

    const where: Record<string, unknown> = { id, companyId: user.companyId };
    if (scope) where.fieldAgentId = scope;

    const v = await this.prisma.viewing.findFirst({
      where,
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

  async updateStatus(user: JwtPayload, id: string, status: ViewingStatus, notes?: string) {
    await this.findById(user, id);
    const data: Record<string, unknown> = { status };
    if (notes) data.outcomeNotes = notes;
    if (status === 'completed') data.completedAt = new Date();
    return this.prisma.viewing.update({ where: { id }, data });
  }

  async assignAgent(companyId: string, id: string, fieldAgentId: string) {
    const v = await this.prisma.viewing.findFirst({ where: { id, companyId } });
    if (!v) throw new NotFoundException('Viewing not found');
    return this.prisma.viewing.update({
      where: { id },
      data: { fieldAgentId, status: 'assigned', assignmentStatus: 'accepted' },
    });
  }

  async addFeedback(
    user: JwtPayload,
    id: string,
    body: { rating?: number; comments?: string; bookingIntent?: string },
  ) {
    await this.findById(user, id);
    return this.prisma.viewingFeedback.upsert({
      where: { viewingId: id },
      update: body,
      create: { viewingId: id, ...body },
    });
  }
}
