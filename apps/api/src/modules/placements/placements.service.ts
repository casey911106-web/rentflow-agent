import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface CreatePlacementDto {
  channelName: string;
  channelKind?: string;
  externalUrl?: string;
  groupSize?: number;
  notes?: string;
}

@Injectable()
export class PlacementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pending assignments for the current user. */
  async listMyAssignments(userId: string, companyId: string) {
    return this.prisma.postAssignment.findMany({
      where: { assigneeUserId: userId, companyId, status: 'pending' },
      orderBy: { assignedAt: 'desc' },
      include: {
        postPackage: {
          select: {
            id: true,
            title: true,
            shortCaption: true,
            whatsappCaption: true,
            status: true,
            property: {
              select: {
                id: true,
                code: true,
                name: true,
                area: true,
                priceAed: true,
                media: {
                  orderBy: { position: 'asc' },
                  take: 10,
                  select: { file: { select: { id: true, mimeType: true } } },
                },
              },
            },
            trackingLink: { select: { shortUrl: true, whatsappUrl: true } },
            _count: { select: { placements: true } },
          },
        },
      },
    });
  }

  /** All placements for a PostPackage. */
  async listForPackage(companyId: string, postPackageId: string) {
    return this.prisma.postPlacement.findMany({
      where: { companyId, postPackageId, removedAt: null },
      orderBy: { publishedAt: 'desc' },
      include: {
        publisher: { select: { id: true, fullName: true, email: true } },
        _count: { select: { attributedLeads: true } },
      },
    });
  }

  /** Create a placement; closes the user's pending assignment for this package. */
  async create(
    companyId: string,
    publisherUserId: string,
    postPackageId: string,
    dto: CreatePlacementDto,
  ) {
    if (!dto.channelName?.trim()) {
      throw new BadRequestException('channelName is required');
    }
    const pkg = await this.prisma.postPackage.findFirst({
      where: { id: postPackageId, companyId, deletedAt: null },
    });
    if (!pkg) throw new NotFoundException('PostPackage not found');

    const placement = await this.prisma.postPlacement.create({
      data: {
        companyId,
        postPackageId,
        publisherUserId,
        channelName: dto.channelName.trim(),
        channelKind: dto.channelKind ?? null,
        externalUrl: dto.externalUrl ?? null,
        groupSize: dto.groupSize ?? null,
        notes: dto.notes ?? null,
        // Per-placement tracking slug — lets us see which group/channel the
        // clicks came from instead of bundling everything at the package level.
        trackingSlug: this.generateSlug(),
        // Created with full details, so it counts as confirmed immediately.
        confirmedAt: new Date(),
      },
    });

    // Bump the package status to 'published' as soon as ANY placement exists.
    // Idempotent: leave alone if already published/paused/archived. The
    // previous version only fired when count===1; any race or out-of-order
    // insert would leave the package stuck in 'approved'.
    if (pkg.status !== 'published' && pkg.status !== 'paused' && pkg.status !== 'archived') {
      await this.prisma.postPackage.update({
        where: { id: postPackageId },
        data: {
          status: 'published',
          publishedById: publisherUserId,
          publishedAt: new Date(),
          channelName: pkg.channelName ?? dto.channelName.trim(),
        },
      });
    }

    // Don't auto-fulfill the assignment here — the publisher must reach the
    // minimum placement count and explicitly tap 'Mark complete'.
    return placement;
  }

  private generateSlug(): string {
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 8; i++) {
      s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return s;
  }

  /** Pre-generate a unique tracking slug for a Fast Posting before the
   *  agent posts in a Facebook group. The placement row is created with
   *  channelName=null and confirmedAt=null — these get filled in via
   *  `confirmDraft` after the agent comes back from posting. */
  async createDraft(companyId: string, userId: string, postPackageId: string) {
    const pkg = await this.prisma.postPackage.findFirst({
      where: { id: postPackageId, companyId, deletedAt: null },
      select: { id: true, trackingLink: { select: { shortUrl: true, postCode: true } } },
    });
    if (!pkg) throw new NotFoundException('PostPackage not found');

    const slug = this.generateSlug();
    const placement = await this.prisma.postPlacement.create({
      data: {
        companyId,
        postPackageId,
        publisherUserId: userId,
        channelName: null,
        trackingSlug: slug,
        confirmedAt: null,
      },
    });

    const shortUrl = pkg.trackingLink?.shortUrl ?? null;
    const trackingUrl = shortUrl ? `${shortUrl}?s=${slug}` : null;
    return {
      id: placement.id,
      trackingSlug: slug,
      trackingUrl,
      postCode: pkg.trackingLink?.postCode ?? null,
    };
  }

  /** Fill in channelName + optional details on a draft placement. From
   *  this moment on it counts as a real placement (toward the 3-min
   *  threshold and the package's status bump). */
  async confirmDraft(
    companyId: string,
    userId: string,
    placementId: string,
    body: CreatePlacementDto,
  ) {
    if (!body.channelName?.trim()) {
      throw new BadRequestException('channelName is required');
    }
    const placement = await this.prisma.postPlacement.findFirst({
      where: { id: placementId, companyId, removedAt: null },
      select: { id: true, publisherUserId: true, confirmedAt: true, postPackageId: true },
    });
    if (!placement) throw new NotFoundException('Placement not found');
    if (placement.publisherUserId !== userId) {
      throw new ForbiddenException('You can only confirm your own draft placements');
    }
    if (placement.confirmedAt !== null) {
      throw new BadRequestException('Placement already confirmed');
    }

    const updated = await this.prisma.postPlacement.update({
      where: { id: placementId },
      data: {
        channelName: body.channelName.trim(),
        channelKind: body.channelKind ?? null,
        externalUrl: body.externalUrl ?? null,
        groupSize: body.groupSize ?? null,
        notes: body.notes ?? null,
        confirmedAt: new Date(),
      },
    });

    // Idempotent bump of the package's published status, mirroring `create`.
    const pkg = await this.prisma.postPackage.findUnique({
      where: { id: placement.postPackageId },
      select: { status: true, channelName: true },
    });
    if (pkg && pkg.status !== 'published' && pkg.status !== 'paused' && pkg.status !== 'archived') {
      await this.prisma.postPackage.update({
        where: { id: placement.postPackageId },
        data: {
          status: 'published',
          publishedById: userId,
          publishedAt: new Date(),
          channelName: pkg.channelName ?? body.channelName.trim(),
        },
      });
    }

    return updated;
  }

  /** Placements the current user logged for this package (any status). */
  listMyForPackage(companyId: string, userId: string, postPackageId: string) {
    return this.prisma.postPlacement.findMany({
      where: { companyId, postPackageId, publisherUserId: userId, removedAt: null },
      orderBy: { publishedAt: 'desc' },
    });
  }

  /** Mark a publisher's assignment as fulfilled (requires >= MIN_PLACEMENTS). */
  async completeAssignment(
    companyId: string,
    userId: string,
    assignmentId: string,
    minPlacements = 3,
  ) {
    const assignment = await this.prisma.postAssignment.findFirst({
      where: { id: assignmentId, companyId, assigneeUserId: userId, status: 'pending' },
    });
    if (!assignment) throw new NotFoundException('Assignment not found or already closed');

    const count = await this.prisma.postPlacement.count({
      where: {
        companyId,
        postPackageId: assignment.postPackageId,
        publisherUserId: userId,
        removedAt: null,
        confirmedAt: { not: null },
      },
    });
    if (count < minPlacements) {
      throw new BadRequestException(
        `Need at least ${minPlacements} placements to mark this task complete (you have ${count}).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const fulfilled = await tx.postAssignment.update({
        where: { id: assignmentId },
        data: { status: 'fulfilled', fulfilledAt: new Date() },
      });

      // Defense in depth: when a field agent marks a task complete, the
      // package is by definition published — bump the status if some prior
      // placement-create race left it stuck in approved/pending_approval.
      const pkg = await tx.postPackage.findUnique({
        where: { id: assignment.postPackageId },
        select: { status: true, channelName: true },
      });
      if (pkg && pkg.status !== 'published' && pkg.status !== 'paused' && pkg.status !== 'archived') {
        // Find one placement to copy the channelName from if the package
        // doesn't have one yet (kept as the "primary" channel for display).
        const firstPlacement = await tx.postPlacement.findFirst({
          where: { postPackageId: assignment.postPackageId, removedAt: null },
          orderBy: { publishedAt: 'asc' },
          select: { channelName: true },
        });
        await tx.postPackage.update({
          where: { id: assignment.postPackageId },
          data: {
            status: 'published',
            publishedById: userId,
            publishedAt: new Date(),
            channelName: pkg.channelName ?? firstPlacement?.channelName ?? null,
          },
        });
      }

      return fulfilled;
    });
  }

  /** Mark a placement as removed (the post was taken down or unpublished). */
  async remove(companyId: string, userId: string, isAdmin: boolean, placementId: string) {
    const placement = await this.prisma.postPlacement.findFirst({
      where: { id: placementId, companyId },
    });
    if (!placement) throw new NotFoundException();
    if (!isAdmin && placement.publisherUserId !== userId) {
      throw new ForbiddenException('Only the publisher or an admin can remove this placement');
    }
    return this.prisma.postPlacement.update({
      where: { id: placementId },
      data: { removedAt: new Date() },
    });
  }

  /** Publisher leaderboard for a date window (default last 30 days). */
  async leaderboard(companyId: string, sinceDays = 30) {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);

    const rows = await this.prisma.postPlacement.groupBy({
      by: ['publisherUserId'],
      where: { companyId, publishedAt: { gte: since }, removedAt: null },
      _count: { _all: true },
      _sum: { groupSize: true },
    });

    if (rows.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.publisherUserId) } },
      select: { id: true, fullName: true, email: true, roles: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return rows
      .map((r) => ({
        user: userMap.get(r.publisherUserId) ?? null,
        placements: r._count._all,
        totalReach: r._sum.groupSize ?? 0,
      }))
      .sort((a, b) => b.totalReach - a.totalReach);
  }
}
