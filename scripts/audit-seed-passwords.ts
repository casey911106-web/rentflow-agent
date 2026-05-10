/**
 * Audit: lists every User whose passwordHash is still the seed sentinel.
 * In production those accounts are now locked out (the AuthService gates
 * the sentinel check on NODE_ENV !== 'production'), but they still need
 * their password reset before anyone can log in legitimately.
 *
 * Usage:
 *   pnpm tsx scripts/audit-seed-passwords.ts
 */
import { PrismaClient } from '@rentflow/database';

const prisma = new PrismaClient();
const SENTINEL = 'SEED_PASSWORD_RENTFLOW123';

async function main() {
  const users = await prisma.user.findMany({
    where: { passwordHash: SENTINEL, deletedAt: null },
    select: { id: true, email: true, fullName: true, roles: true, status: true, lastLoginAt: true },
    orderBy: { roles: 'desc' },
  });

  console.log(`Users with seed-sentinel passwordHash: ${users.length}`);
  if (users.length === 0) {
    console.log('✓ All users have real bcrypt hashes.');
    return;
  }
  console.log('Each of these is currently locked out of prod login (sentinel disabled in NODE_ENV=production).');
  console.log('Reset their password with: pnpm tsx scripts/reset-user-password.ts <email>');
  console.log();
  for (const u of users) {
    const last = u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 10) : 'never';
    console.log(`  ${u.email}  (${u.fullName})  roles=${u.roles.join(',')}  status=${u.status}  lastLogin=${last}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
