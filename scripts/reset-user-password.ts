/**
 * Reset a user's password to a real bcrypt hash. Use this after the
 * SECURITY incident where the seed sentinel + pre-filled login form
 * exposed admin@rentflow.demo / rentflow123 to anyone visiting /login.
 *
 * Usage:
 *   pnpm tsx scripts/reset-user-password.ts admin@rentflow.demo
 *
 * The script prompts for the new password (masked, no echo) and writes
 * a bcrypt hash. After running, the seed sentinel no longer applies to
 * this user and the only valid login is the password you just set.
 */
import { PrismaClient } from '@rentflow/database';
import bcrypt from 'bcryptjs';
import { stdin as input, stdout as output } from 'node:process';

const prisma = new PrismaClient();

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    output.write(prompt);
    let value = '';
    const isTTY = Boolean((input as { isTTY?: boolean }).isTTY);
    if (isTTY) (input as { setRawMode?: (b: boolean) => void }).setRawMode?.(true);
    input.resume();
    input.setEncoding('utf8');

    const onData = (chunk: Buffer | string) => {
      const key = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const ch of key) {
        if (ch === '\n' || ch === '\r' || ch === '') {
          if (isTTY) (input as { setRawMode?: (b: boolean) => void }).setRawMode?.(false);
          input.pause();
          input.off('data', onData);
          output.write('\n');
          return resolve(value);
        }
        if (ch === '') {
          if (isTTY) (input as { setRawMode?: (b: boolean) => void }).setRawMode?.(false);
          input.pause();
          input.off('data', onData);
          output.write('\n');
          return reject(new Error('Cancelled'));
        }
        if (ch === '' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        value += ch;
        output.write('*');
      }
    };
    input.on('data', onData);
  });
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('usage: reset-user-password.ts <email>');
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, fullName: true, email: true, roles: true, passwordHash: true },
  });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }

  console.log(`Resetting password for: ${user.fullName} <${user.email}>`);
  console.log(`Roles: ${user.roles.join(', ')}`);
  if (user.passwordHash === 'SEED_PASSWORD_RENTFLOW123') {
    console.log('⚠ Current passwordHash is the SEED sentinel — anyone could log in as this user with `rentflow123` until production env disables that path. Resetting now.');
  }

  const pw1 = await readHidden('New password (min 12 chars): ');
  if (pw1.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }
  const pw2 = await readHidden('Confirm new password: ');
  if (pw1 !== pw2) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(pw1, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hash },
  });
  console.log(`✓ Password updated for ${user.email}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
