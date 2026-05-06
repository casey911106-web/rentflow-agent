import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OwnersService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.owner.findMany({
      where: { companyId, deletedAt: null },
      include: { _count: { select: { properties: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(companyId: string, id: string) {
    const owner = await this.prisma.owner.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        properties: { where: { deletedAt: null } },
        scoreSnapshots: { orderBy: { createdAt: 'desc' }, take: 10 },
        availabilityChecks: { orderBy: { askedAt: 'desc' }, take: 20 },
      },
    });
    if (!owner) throw new NotFoundException('Owner not found');
    return owner;
  }

  create(companyId: string, body: { fullName: string; phoneE164: string; email?: string; notes?: string }) {
    return this.prisma.owner.create({ data: { companyId, ...body } });
  }

  async update(companyId: string, id: string, body: Record<string, unknown>) {
    await this.findById(companyId, id);
    return this.prisma.owner.update({ where: { id }, data: body });
  }

  async triggerAvailabilityCheck(companyId: string, id: string) {
    await this.findById(companyId, id);
    const properties = await this.prisma.property.findMany({
      where: { ownerId: id, companyId, deletedAt: null },
      select: { id: true },
    });
    return Promise.all(
      properties.map((p) =>
        this.prisma.ownerAvailabilityCheck.create({
          data: {
            companyId,
            ownerId: id,
            propertyId: p.id,
            status: 'pending_response',
            askedAt: new Date(),
          },
        }),
      ),
    );
  }
}
