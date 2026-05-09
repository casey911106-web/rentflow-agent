import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PropertyStatus, PropertyType } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from '../files/files.service';

export interface CreatePropertyInput {
  name: string;
  type: PropertyType;
  area?: string;
  priceAed?: number;
  depositAed?: number;
  description?: string;
  ownerId?: string;
  occupancyMax?: number;
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async list(companyId: string, filter: { status?: PropertyStatus; q?: string } = {}) {
    return this.prisma.property.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.q
          ? { OR: [{ name: { contains: filter.q, mode: 'insensitive' } }, { code: { contains: filter.q, mode: 'insensitive' } }] }
          : {}),
      },
      include: {
        owner: true,
        submittedBy: { select: { id: true, fullName: true, email: true } },
        assignedFieldAgent: { select: { id: true, fullName: true } },
        _count: { select: { leads: true, postPackages: true, viewings: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(companyId: string, id: string) {
    const property = await this.prisma.property.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        owner: true,
        media: {
          include: { file: true },
          orderBy: { position: 'asc' },
        },
        availabilityBlocks: { orderBy: { startsAt: 'desc' } },
        calendarEvents: { orderBy: { startsAt: 'asc' } },
        issues: { orderBy: { createdAt: 'desc' }, take: 20 },
        scoreSnapshots: { orderBy: { createdAt: 'desc' }, take: 10 },
        postPackages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            title: true,
            status: true,
            channelName: true,
            publishedAt: true,
            trackingLink: { select: { sourceCode: true, postCode: true, clicks: true } },
          },
        },
        leads: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            fullName: true,
            phoneE164: true,
            status: true,
            temperature: true,
            qualificationScore: true,
            createdAt: true,
          },
        },
        viewings: {
          orderBy: { scheduledAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            scheduledAt: true,
            fieldAgent: { include: { user: { select: { fullName: true } } } },
          },
        },
      },
    });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  async create(companyId: string, input: CreatePropertyInput) {
    const code = await this.nextCode(companyId);
    return this.prisma.property.create({
      data: {
        companyId,
        code,
        name: input.name,
        type: input.type,
        area: input.area,
        priceAed: input.priceAed,
        depositAed: input.depositAed,
        description: input.description,
        ownerId: input.ownerId,
        occupancyMax: input.occupancyMax,
        status: 'draft',
      },
    });
  }

  async update(companyId: string, id: string, data: Prisma.PropertyUpdateInput) {
    await this.findById(companyId, id);
    return this.prisma.property.update({ where: { id }, data });
  }

  async softDelete(companyId: string, id: string) {
    await this.findById(companyId, id);
    return this.prisma.property.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async getCalendar(companyId: string, id: string) {
    await this.findById(companyId, id);
    return this.prisma.propertyCalendarEvent.findMany({
      where: { propertyId: id },
      orderBy: { startsAt: 'asc' },
    });
  }

  async addAvailabilityBlock(
    companyId: string,
    id: string,
    body: { startsAt: string; endsAt: string; reason: string },
  ) {
    await this.findById(companyId, id);
    return this.prisma.propertyAvailabilityBlock.create({
      data: { propertyId: id, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), reason: body.reason },
    });
  }

  async uploadMedia(
    companyId: string,
    propertyId: string,
    uploadedById: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    body: { kind?: string; caption?: string; position?: string | number },
  ) {
    await this.findById(companyId, propertyId);
    const fileUpload = await this.files.save({
      companyId,
      uploadedById,
      ownerEntityType: 'Property',
      ownerEntityId: propertyId,
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });
    const kind =
      body.kind ??
      (file.mimetype.startsWith('image/')
        ? 'photo'
        : file.mimetype.startsWith('video/')
          ? 'video'
          : 'document');
    const position =
      typeof body.position === 'string' ? Number(body.position) : (body.position ?? 0);
    return this.prisma.propertyMedia.create({
      data: {
        propertyId,
        fileUploadId: fileUpload.id,
        kind,
        caption: body.caption,
        position: Number.isFinite(position) ? position : 0,
      },
      include: { file: true },
    });
  }

  listIssues(
    companyId: string,
    filter: { resolved?: boolean; type?: string } = {},
  ) {
    return this.prisma.propertyIssue.findMany({
      where: {
        property: { companyId },
        ...(filter.resolved === true ? { resolvedAt: { not: null } } : {}),
        ...(filter.resolved === false ? { resolvedAt: null } : {}),
        ...(filter.type ? { type: filter.type as Prisma.PropertyIssueWhereInput['type'] } : {}),
      },
      include: {
        property: { select: { id: true, code: true, name: true, area: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async resolveIssue(companyId: string, issueId: string) {
    const issue = await this.prisma.propertyIssue.findFirst({
      where: { id: issueId, property: { companyId } },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return this.prisma.propertyIssue.update({
      where: { id: issueId },
      data: { resolvedAt: new Date() },
    });
  }

  async reportIssue(
    companyId: string,
    id: string,
    body: { type: string; description: string; reportedById?: string },
  ) {
    await this.findById(companyId, id);
    return this.prisma.propertyIssue.create({
      data: {
        propertyId: id,
        type: body.type as Prisma.PropertyIssueCreateInput['type'],
        description: body.description,
        reportedById: body.reportedById,
      },
    });
  }

  /** Generate next sequential code per company: RF-001, RF-002, ... */
  private async nextCode(companyId: string): Promise<string> {
    const last = await this.prisma.property.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: { code: true },
    });
    const lastNum = last?.code?.match(/(\d+)$/)?.[1];
    const next = (lastNum ? parseInt(lastNum, 10) : 0) + 1;
    return `RF-${next.toString().padStart(3, '0')}`;
  }
}
