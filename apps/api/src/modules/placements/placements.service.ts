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

  /** Pending assignments for the current user. The `confirmedCount` is
   *  scoped to THIS assignment window (placements by this user since the
   *  assignment was created) — not a lifetime count. A field agent
   *  reassigned to a popular package must publish 3 NEW times to fulfil. */
  async listMyAssignments(userId: string, companyId: string) {
    const assignments = await this.prisma.postAssignment.findMany({
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
            kind: true,
            growthTargetUrl: true,
            growthTargetLabel: true,
            growthTargetKind: true,
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
          },
        },
      },
    });

    if (assignments.length === 0) return [];

    const counts = await Promise.all(
      assignments.map((a) =>
        this.prisma.postPlacement.count({
          where: {
            companyId,
            postPackageId: a.postPackageId,
            publisherUserId: userId,
            removedAt: null,
            confirmedAt: { gte: a.assignedAt },
          },
        }),
      ),
    );

    // Channel-growth packages have no Property of their own. Without an
    // image the FB/WA group post would scroll past unnoticed, so we inject
    // a small set of random property photos per assignment. The pick is
    // deterministic on assignmentId so the same agent sees the same photos
    // every time they reload the task — but different assignments get
    // different photos.
    const growthIdxs = assignments
      .map((a, i) => (a.postPackage.kind === 'channel_growth' ? i : -1))
      .filter((i) => i !== -1);
    let growthPool: Array<{ file: { id: string; mimeType: string } }> = [];
    if (growthIdxs.length > 0) {
      const media = await this.prisma.propertyMedia.findMany({
        where: { kind: 'photo', property: { companyId, deletedAt: null } },
        select: { file: { select: { id: true, mimeType: true } } },
        take: 100,
      });
      growthPool = media;
    }

    return assignments.map((a, i) => {
      const base = { ...a, confirmedCount: counts[i] ?? 0 };
      if (a.postPackage.kind === 'channel_growth' && growthPool.length > 0) {
        return { ...base, growthMedia: pickStableSubset(growthPool, 5, a.id) };
      }
      return base;
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

    // Count only placements made WITHIN THIS assignment window — not the
    // user's lifetime placements for this package. Otherwise a publisher
    // reassigned to a popular package could mark 'complete' instantly with
    // zero new posts, since their old placements would still be on the row.
    const count = await this.prisma.postPlacement.count({
      where: {
        companyId,
        postPackageId: assignment.postPackageId,
        publisherUserId: userId,
        removedAt: null,
        confirmedAt: { gte: assignment.assignedAt },
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

  /** Publisher leaderboard for an explicit window. Internal — `leaderboard`
   *  and `monthlyLeaderboard` both delegate here. */
  private async leaderboardForWindow(companyId: string, since: Date, until: Date) {

    const [placements, assignments] = await Promise.all([
      this.prisma.postPlacement.findMany({
        where: { companyId, publishedAt: { gte: since, lt: until }, removedAt: null },
        select: {
          publisherUserId: true,
          clicks: true,
          _count: { select: { attributedLeads: true } },
        },
      }),
      // Pull every assignment that LANDED in the window — fulfilled/expired
      // both count, so ops can see drop-off per publisher.
      this.prisma.postAssignment.findMany({
        where: { companyId, assignedAt: { gte: since, lt: until } },
        select: { assigneeUserId: true, status: true },
      }),
    ]);

    interface Bucket {
      placements: number;
      clicks: number;
      leads: number;
      assignedTotal: number;
      assignedFulfilled: number;
      assignedExpired: number;
      assignedPending: number;
    }
    const blankBucket = (): Bucket => ({
      placements: 0,
      clicks: 0,
      leads: 0,
      assignedTotal: 0,
      assignedFulfilled: 0,
      assignedExpired: 0,
      assignedPending: 0,
    });
    const acc = new Map<string, Bucket>();
    for (const p of placements) {
      const cur = acc.get(p.publisherUserId) ?? blankBucket();
      cur.placements += 1;
      cur.clicks += p.clicks;
      cur.leads += p._count.attributedLeads;
      acc.set(p.publisherUserId, cur);
    }
    for (const a of assignments) {
      const cur = acc.get(a.assigneeUserId) ?? blankBucket();
      cur.assignedTotal += 1;
      if (a.status === 'fulfilled') cur.assignedFulfilled += 1;
      else if (a.status === 'expired') cur.assignedExpired += 1;
      else if (a.status === 'pending') cur.assignedPending += 1;
      acc.set(a.assigneeUserId, cur);
    }
    if (acc.size === 0) return [];

    const userIds = Array.from(acc.keys());
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, email: true, roles: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return userIds
      .map((id) => {
        const m = acc.get(id)!;
        const completionRate = m.assignedTotal > 0 ? m.assignedFulfilled / m.assignedTotal : 0;
        return {
          user: userMap.get(id) ?? null,
          placements: m.placements,
          totalClicks: m.clicks,
          attributedLeads: m.leads,
          assignedTotal: m.assignedTotal,
          assignedFulfilled: m.assignedFulfilled,
          assignedExpired: m.assignedExpired,
          assignedPending: m.assignedPending,
          completionRate, // 0..1
        };
      })
      // Rank by leads first (real conversions), tiebreak on clicks.
      .sort((a, b) => (b.attributedLeads - a.attributedLeads) || (b.totalClicks - a.totalClicks));
  }

  /** Publisher leaderboard for a date window (default last 30 days).
   *  Metrics are REAL engagement signals — not the publisher-reported
   *  groupSize, which we used to inflate as "reach". `totalClicks` is the
   *  sum of trackingSlug redirects (counted server-side); `attributedLeads`
   *  is the count of Leads that landed via those clicks. Group membership
   *  is meaningless without view rate so we don't surface it. */
  async leaderboard(companyId: string, sinceDays = 30) {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);
    return this.leaderboardForWindow(companyId, since, new Date());
  }

  /** Calendar-month leaderboard (UTC). Powers the monthly commission split
   *  algorithm: only placements published between [monthStart, nextMonth)
   *  count toward the agent's performance score for that month. */
  async monthlyLeaderboard(companyId: string, year: number, month: number) {
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    return this.leaderboardForWindow(companyId, monthStart, monthEnd);
  }
}

/** Deterministic shuffle: each item is scored by hash(seed:index) and the
 *  list is sorted by that score. Same seed → same order; different seeds
 *  → different orderings. Used to pick a stable random photo subset per
 *  assignment without persisting anything. */
function pickStableSubset<T>(items: T[], count: number, seed: string): T[] {
  return items
    .map((item, i) => ({ item, h: simpleHash(`${seed}:${i}`) }))
    .sort((a, b) => a.h - b.h)
    .slice(0, count)
    .map((x) => x.item);
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}
