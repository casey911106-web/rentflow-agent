import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface ReadinessFactors {
  availabilityFresh: number;
  priceConfirmedFresh: number;
  ownerLinked: number;
  hasPhotos: number;
  hasVideo: number;
  descriptionReady: number;
  commissionClear: number;
  depositClear: number;
  moveInDateClear: number;
  occupancyRulesClear: number;
  viewingAccessConfirmed: number;
}

const READINESS_WEIGHTS: ReadinessFactors = {
  availabilityFresh: 20,
  priceConfirmedFresh: 15,
  ownerLinked: 10,
  hasPhotos: 15,
  hasVideo: 5,
  descriptionReady: 10,
  commissionClear: 5,
  depositClear: 5,
  moveInDateClear: 5,
  occupancyRulesClear: 5,
  viewingAccessConfirmed: 5,
};

@Injectable()
export class ScoresService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recompute the readiness score for a property and persist a snapshot.
   * Returns the new score and the factor breakdown.
   */
  async recomputeReadiness(companyId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, companyId, deletedAt: null },
      include: { media: true },
    });
    if (!property) return null;

    const within = (date: Date | null | undefined, days: number) =>
      date ? Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000 : false;

    const f: Record<keyof ReadinessFactors, number> = {
      availabilityFresh: within(property.availabilityConfirmedAt, 7) ? 1 : 0,
      priceConfirmedFresh: within(property.priceConfirmedAt, 14) ? 1 : 0,
      ownerLinked: property.ownerId ? 1 : 0,
      hasPhotos: property.media.length >= 3 ? 1 : property.media.length >= 1 ? 0.5 : 0,
      hasVideo: property.media.some((m) => m.kind === 'video') ? 1 : 0,
      descriptionReady: property.description ? 1 : 0,
      commissionClear: property.commissionPolicy ? 1 : 0,
      depositClear: property.depositAed ? 1 : 0,
      moveInDateClear: property.moveInDate ? 1 : 0,
      occupancyRulesClear: property.occupancyMax ? 1 : 0,
      viewingAccessConfirmed: property.viewingAccess ? 1 : 0,
    };

    const score = Math.round(
      (Object.keys(f) as (keyof ReadinessFactors)[]).reduce(
        (acc, key) => acc + f[key] * READINESS_WEIGHTS[key],
        0,
      ),
    );

    await this.prisma.$transaction([
      this.prisma.property.update({ where: { id: propertyId }, data: { readinessScore: score } }),
      this.prisma.propertyScoreSnapshot.create({
        data: { propertyId, kind: 'readiness', score, factors: f },
      }),
    ]);

    return { score, factors: f };
  }

  async getProperty(companyId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, companyId },
      include: {
        scoreSnapshots: { orderBy: { createdAt: 'desc' }, take: 30 },
      },
    });
    return property;
  }
}
