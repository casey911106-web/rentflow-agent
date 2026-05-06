-- Add 'interactive' to MessageType enum so we can store WhatsApp interactive
-- messages (button replies, list selections) without crashing Prisma.

ALTER TYPE "MessageType" ADD VALUE 'interactive';
