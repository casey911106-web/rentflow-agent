import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, fullName: true, role: true, status: true, lastLoginAt: true, createdAt: true },
    });
  }
}
