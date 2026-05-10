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
    // SECURITY: explicit allowlist. The controller body is Record<string,
    // unknown>; without filtering an attacker could pass companyId and
    // move the owner to another tenant, or set arbitrary fields like
    // deletedAt. Only the small set of edit-safe fields below is honoured.
    const data: Record<string, unknown> = {};
    const allowed = ['fullName', 'phoneE164', 'email', 'notes'] as const;
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }
    if (Object.keys(data).length === 0) return this.findById(companyId, id);
    return this.prisma.owner.update({ where: { id }, data });
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
