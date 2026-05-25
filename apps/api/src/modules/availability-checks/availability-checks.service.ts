import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AvailabilityChecksService {
  constructor(private readonly prisma: PrismaService) {}

  /** A field agent's open queue: checks assigned to them, still within TTL.
   *  Includes the first 3 photos so the agent can save them to camera roll
   *  and forward to the owner via WhatsApp — owners often don't recognise
   *  a property by code/name alone. */
  async listMyAssignments(companyId: string, userId: string) {
    return this.prisma.ownerAvailabilityCheck.findMany({
      where: {
        companyId,
        assigneeUserId: userId,
        status: 'pending_response',
        expiresAt: { gt: new Date() },
      },
      orderBy: { assignedAt: 'asc' },
      include: {
        property: {
          select: {
            id: true,
            code: true,
            name: true,
            area: true,
            priceAed: true,
            media: {
              where: { file: { mimeType: { startsWith: 'image/' } } },
              orderBy: { position: 'asc' },
              take: 3,
              select: {
                id: true,
                file: { select: { id: true, mimeType: true } },
              },
            },
          },
        },
        owner: { select: { id: true, fullName: true, phoneE164: true } },
      },
    });
  }

  /** Owner confirmed property is still available. */
  async markAvailable(companyId: string, userId: string, id: string) {
    const check = await this.requireMyAssignment(companyId, userId, id);
    const now = new Date();
    return this.prisma.ownerAvailabilityCheck.update({
      where: { id: check.id },
      data: {
        status: 'available',
        fulfilledAt: now,
        repliedAt: now,
        nextCheckAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  /** Owner confirmed property is NOT available. Pauses all active packages for
   *  that property so the round-robin stops showing it. `availableFrom` is
   *  recorded as info — admin decides whether/when to resume. */
  async markUnavailable(
    companyId: string,
    userId: string,
    id: string,
    body: { availableFromDate?: string; notes?: string },
  ) {
    const check = await this.requireMyAssignment(companyId, userId, id);
    const now = new Date();
    const availableFrom = body.availableFromDate ? new Date(body.availableFromDate) : null;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ownerAvailabilityCheck.update({
        where: { id: check.id },
        data: {
          status: 'unavailable',
          fulfilledAt: now,
          repliedAt: now,
          reportedAvailableFrom: availableFrom,
          reportedNotes: body.notes ?? null,
        },
      });
      await tx.postPackage.updateMany({
        where: {
          companyId,
          propertyId: check.propertyId,
          status: { in: ['approved', 'published'] },
        },
        data: { status: 'paused', pausedAt: now },
      });
      return updated;
    });
  }

  private async requireMyAssignment(companyId: string, userId: string, id: string) {
    const check = await this.prisma.ownerAvailabilityCheck.findFirst({
      where: { id, companyId },
    });
    if (!check) throw new NotFoundException('Check not found');
    if (check.assigneeUserId !== userId) {
      throw new ForbiddenException('This check is not assigned to you');
    }
    if (check.fulfilledAt) {
      throw new ForbiddenException('This check is already fulfilled');
    }
    return check;
  }
}
