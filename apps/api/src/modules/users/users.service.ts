import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

const VALID_ROLES = ['super_admin', 'ops_manager', 'field_agent'] as const;
type RoleName = (typeof VALID_ROLES)[number];

function assertValidRoles(roles: string[]): asserts roles is RoleName[] {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new BadRequestException('At least one role is required');
  }
  for (const r of roles) {
    if (!VALID_ROLES.includes(r as RoleName)) {
      throw new BadRequestException(`Invalid role: ${r}`);
    }
  }
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        roles: true,
        status: true,
        phoneE164: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  async create(
    companyId: string,
    dto: { email: string; fullName: string; password: string; roles: string[]; phoneE164?: string },
  ) {
    assertValidRoles(dto.roles);
    const existing = await this.prisma.user.findFirst({
      where: { companyId, email: dto.email, deletedAt: null },
    });
    if (existing) throw new BadRequestException('A user with that email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        companyId,
        email: dto.email,
        fullName: dto.fullName,
        phoneE164: dto.phoneE164 ?? null,
        passwordHash,
        roles: dto.roles as RoleName[],
        status: 'active',
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        roles: true,
        status: true,
        phoneE164: true,
        createdAt: true,
      },
    });
  }

  async updateRoles(companyId: string, userId: string, roles: string[]) {
    assertValidRoles(roles);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id: userId },
      data: { roles: roles as RoleName[] },
      select: { id: true, email: true, fullName: true, roles: true, status: true },
    });
  }
}
