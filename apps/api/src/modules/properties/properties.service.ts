import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma, PropertyStatus, PropertyType } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { PostingService } from '../posting/posting.service';

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
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly posting: PostingService,
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
        sourcedByFieldAgent: { select: { id: true, fullName: true } },
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
        sourcedByFieldAgent: { select: { id: true, fullName: true } },
        assignedFieldAgent: { select: { id: true, fullName: true } },
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

  async update(companyId: string, id: string, body: Record<string, unknown>) {
    await this.findById(companyId, id);
    // SECURITY: explicit allowlist for the editable fields. The controller
    // body is Record<string, unknown>; passing it directly would let an
    // attacker set companyId, code (immutable), deletedAt, readinessScore,
    // submittedByUserId etc. via the public PATCH endpoint.
    const data: Prisma.PropertyUpdateInput = {};
    const stringFields = [
      'name',
      'description',
      'addressLine',
      'area',
      'viewingAccess',
      'commissionPolicy',
    ] as const;
    const numberFields = ['priceAed', 'depositAed', 'occupancyMax', 'rentalMinMonths', 'latitude', 'longitude'] as const;
    const dateFields = ['priceConfirmedAt', 'availabilityConfirmedAt', 'moveInDate'] as const;
    for (const k of stringFields) {
      if (k in body) (data as Record<string, unknown>)[k] = body[k];
    }
    for (const k of numberFields) {
      if (k in body) (data as Record<string, unknown>)[k] = body[k];
    }
    for (const k of dateFields) {
      if (k in body) {
        const v = body[k];
        (data as Record<string, unknown>)[k] = v ? new Date(v as string) : null;
      }
    }
    if ('type' in body) (data as Record<string, unknown>).type = body.type;
    if ('status' in body) (data as Record<string, unknown>).status = body.status;
    if ('amenities' in body) (data as Record<string, unknown>).amenities = body.amenities;
    if ('ownerId' in body) (data as Record<string, unknown>).ownerId = body.ownerId;
    if ('assignedFieldAgentId' in body) {
      (data as Record<string, unknown>).assignedFieldAgentId = body.assignedFieldAgentId;
    }
    if ('sourcedByFieldAgentId' in body) {
      (data as Record<string, unknown>).sourcedByFieldAgentId = body.sourcedByFieldAgentId;
    }

    const property = await this.prisma.property.update({ where: { id }, data });
    // Re-render every active Fast Posting tied to this property so the
    // next batch of placements goes out with the edited price/name/area.
    // Frozen packages (paused/archived) are skipped inside the helper.
    try {
      await this.posting.regenerateForProperty(companyId, id);
    } catch (err) {
      this.logger.error(
        `Failed to regenerate captions after Property ${id} update: ${(err as Error).message}`,
      );
    }
    return property;
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

  /** Soft-delete a media row + null its FileUpload entity link. */
  async deleteMedia(companyId: string, propertyId: string, mediaId: string) {
    const media = await this.prisma.propertyMedia.findFirst({
      where: { id: mediaId, propertyId, property: { companyId, deletedAt: null } },
    });
    if (!media) throw new NotFoundException('Media not found');
    await this.prisma.propertyMedia.delete({ where: { id: mediaId } });
    return { ok: true, id: mediaId };
  }

  /**
   * Reassign `position` on every media row to match the order of the
   * incoming array. Anything not listed keeps its current position.
   * Caller is expected to pass the FULL ordered list for that property.
   */
  async reorderMedia(companyId: string, propertyId: string, mediaIds: string[]) {
    if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
      throw new BadRequestException('mediaIds must be a non-empty array');
    }
    const all = await this.prisma.propertyMedia.findMany({
      where: { propertyId, property: { companyId, deletedAt: null } },
      select: { id: true },
    });
    const valid = new Set(all.map((m) => m.id));
    const seen = new Set<string>();
    for (const id of mediaIds) {
      if (!valid.has(id)) throw new BadRequestException(`Unknown media id: ${id}`);
      if (seen.has(id)) throw new BadRequestException(`Duplicate media id: ${id}`);
      seen.add(id);
    }
    await this.prisma.$transaction(
      mediaIds.map((id, i) =>
        this.prisma.propertyMedia.update({
          where: { id },
          data: { position: i },
        }),
      ),
    );
    return { ok: true, count: mediaIds.length };
  }
}
