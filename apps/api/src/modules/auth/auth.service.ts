import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Sentinel hash used by the demo seed so devs can log in with `rentflow123`
 * without the seeder needing to depend on bcryptjs. Real users have real bcrypt
 * hashes; this fallback only kicks in for seed users.
 */
const SEED_PASSWORD_SENTINEL = 'SEED_PASSWORD_RENTFLOW123';
const SEED_PASSWORD_PLAIN = 'rentflow123';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, status: 'active' },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    let ok = false;
    if (user.passwordHash === SEED_PASSWORD_SENTINEL) {
      // SECURITY: the sentinel mechanism only ever logs anyone in if it
      // is allowed by env. In production it is disabled outright — a
      // user whose passwordHash is still the seed sentinel is treated
      // as having no valid password until an admin resets it via the
      // reset-user-password script.
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED_LOGIN !== 'true') {
        ok = false;
      } else {
        ok = password === SEED_PASSWORD_PLAIN;
      }
    } else {
      try {
        ok = await bcrypt.compare(password, user.passwordHash);
      } catch {
        ok = false;
      }
    }
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const accessToken = this.jwt.sign({
      sub: user.id,
      companyId: user.companyId,
      roles: user.roles,
      email: user.email,
    });

    return {
      accessToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, roles: user.roles },
    };
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        roles: true,
        companyId: true,
        company: { select: { id: true, name: true, slug: true } },
      },
    });
  }
}
