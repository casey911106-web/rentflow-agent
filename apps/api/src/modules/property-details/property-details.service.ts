import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@rentflow/database';
import type { PropertyDetailQuestion, PropertyDetailQuestionType } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notifications/push.service';

/** Hours until a pending PropertyDetailsCheck expires and the scheduler can
 *  rotate it to another field agent. Mirrors OwnerAvailabilityCheck (24h). */
export const DETAILS_CHECK_TTL_HOURS = 24;

/** Detail answers are considered fresh for this many days; once stale, a new
 *  check is created when the property is published again. Keeps owner info
 *  from drifting (e.g. they took on new flatmates). */
export const DETAILS_STALENESS_DAYS = 90;

@Injectable()
export class PropertyDetailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // -------------------------------------------------------------------------
  // Question catalogue (admin)
  // -------------------------------------------------------------------------

  /** Active questions in display order. Mobile uses this to render the form. */
  async listActiveQuestions(companyId: string) {
    return this.prisma.propertyDetailQuestion.findMany({
      where: { companyId, isActive: true, deletedAt: null },
      orderBy: { position: 'asc' },
    });
  }

  /** Admin view — includes inactive rows so they can be re-enabled. */
  async listAllQuestions(companyId: string) {
    return this.prisma.propertyDetailQuestion.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { position: 'asc' },
    });
  }

  async createQuestion(
    companyId: string,
    body: {
      key: string;
      label: string;
      helperText?: string;
      type: PropertyDetailQuestionType;
      options?: string[];
      isRequired?: boolean;
      position?: number;
    },
  ) {
    this.assertOptionsForType(body.type, body.options);
    return this.prisma.propertyDetailQuestion.create({
      data: {
        companyId,
        key: body.key,
        label: body.label,
        helperText: body.helperText ?? null,
        type: body.type,
        options: body.options ?? undefined,
        isRequired: body.isRequired ?? true,
        position: body.position ?? 0,
      },
    });
  }

  async updateQuestion(
    companyId: string,
    id: string,
    body: Partial<{
      label: string;
      helperText: string | null;
      type: PropertyDetailQuestionType;
      options: string[] | null;
      isRequired: boolean;
      isActive: boolean;
      position: number;
    }>,
  ) {
    const existing = await this.prisma.propertyDetailQuestion.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Question not found');
    if (body.type) this.assertOptionsForType(body.type, body.options ?? (existing.options as string[] | null));
    return this.prisma.propertyDetailQuestion.update({
      where: { id },
      data: {
        label: body.label,
        helperText: body.helperText,
        type: body.type,
        options:
          body.options === null
            ? Prisma.JsonNull
            : body.options ?? undefined,
        isRequired: body.isRequired,
        isActive: body.isActive,
        position: body.position,
      },
    });
  }

  async deleteQuestion(companyId: string, id: string) {
    const existing = await this.prisma.propertyDetailQuestion.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Question not found');
    return this.prisma.propertyDetailQuestion.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  // -------------------------------------------------------------------------
  // Field-agent task queue (mobile)
  // -------------------------------------------------------------------------

  /** Pending tasks for this agent, oldest first. Includes the first 3 photos
   *  so the agent can forward them to the owner via WhatsApp — owners often
   *  don't recognise a property by code/name alone. */
  async listMyTasks(companyId: string, userId: string) {
    return this.prisma.propertyDetailsCheck.findMany({
      where: {
        companyId,
        assigneeUserId: userId,
        status: 'pending',
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
            type: true,
            details: true,
            media: {
              where: { file: { mimeType: { startsWith: 'image/' } } },
              orderBy: { position: 'asc' },
              take: 3,
              select: {
                id: true,
                file: { select: { id: true, mimeType: true } },
              },
            },
            owner: { select: { id: true, fullName: true, phoneE164: true } },
          },
        },
      },
    });
  }

  /** Field agent submits answers. Stores them as the authoritative
   *  Property.details and snapshots them on the check for audit. If every
   *  required active question is answered, marks Property.detailsCompletedAt. */
  async submit(
    companyId: string,
    userId: string,
    checkId: string,
    answers: Record<string, unknown>,
  ) {
    const check = await this.prisma.propertyDetailsCheck.findFirst({
      where: { id: checkId, companyId },
    });
    if (!check) throw new NotFoundException('Task not found');
    if (check.assigneeUserId !== userId) {
      throw new ForbiddenException('This task is not assigned to you');
    }
    if (check.status !== 'pending') {
      throw new ForbiddenException('Task is already closed');
    }

    const questions = await this.listActiveQuestions(companyId);
    const cleaned = this.validateAnswers(questions, answers);

    const now = new Date();
    const property = await this.prisma.property.findFirst({
      where: { id: check.propertyId, companyId, deletedAt: null },
      select: { details: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    // Merge with existing details so partial submissions don't clobber prior
    // answers (e.g. admin added a new question after the first fill).
    const merged: Record<string, unknown> = {
      ...((property.details as Record<string, unknown> | null) ?? {}),
      ...cleaned,
    };

    const allRequiredFilled = questions
      .filter((q) => q.isRequired)
      .every((q) => isPresent(merged[q.key]));

    return this.prisma.$transaction(async (tx) => {
      await tx.property.update({
        where: { id: check.propertyId },
        data: {
          details: merged as Prisma.InputJsonValue,
          detailsCompletedAt: allRequiredFilled ? now : null,
        },
      });
      const updated = await tx.propertyDetailsCheck.update({
        where: { id: checkId },
        data: {
          status: 'filled',
          fulfilledAt: now,
          submittedAnswers: cleaned as Prisma.InputJsonValue,
        },
      });
      // Cancel any other pending tasks for this property — first one to fill
      // closes the rest so we don't notify multiple agents about a done task.
      await tx.propertyDetailsCheck.updateMany({
        where: {
          companyId,
          propertyId: check.propertyId,
          status: 'pending',
          id: { not: checkId },
        },
        data: { status: 'cancelled', fulfilledAt: now },
      });
      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // Task creation hook (called from posting flow + scheduler)
  // -------------------------------------------------------------------------

  /** Create (or refresh) a PropertyDetailsCheck for a property. Idempotent —
   *  if there's already a live pending check, returns it instead of creating
   *  a duplicate. Defaults to assigning to `preferredAssigneeUserId` (the
   *  publisher who just posted) when provided. */
  async ensureCheck(
    companyId: string,
    propertyId: string,
    preferredAssigneeUserId: string | null,
  ): Promise<{ check: { id: string } | null; created: boolean }> {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, companyId, deletedAt: null },
      select: { id: true, code: true, name: true, details: true, detailsCompletedAt: true },
    });
    if (!property) return { check: null, created: false };

    // Already fresh — no task needed.
    if (property.detailsCompletedAt) {
      const ageDays = (Date.now() - property.detailsCompletedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < DETAILS_STALENESS_DAYS) return { check: null, created: false };
    }

    const now = new Date();
    const existing = await this.prisma.propertyDetailsCheck.findFirst({
      where: {
        companyId,
        propertyId,
        status: 'pending',
        expiresAt: { gt: now },
      },
    });
    if (existing) return { check: existing, created: false };

    const assigneeUserId = await this.pickAssignee(companyId, preferredAssigneeUserId);
    const expiresAt = new Date(now.getTime() + DETAILS_CHECK_TTL_HOURS * 60 * 60 * 1000);

    const check = await this.prisma.propertyDetailsCheck.create({
      data: {
        companyId,
        propertyId,
        status: 'pending',
        assigneeUserId,
        assignedAt: now,
        expiresAt,
      },
    });

    if (assigneeUserId) {
      await this.prisma.notification.create({
        data: {
          companyId,
          userId: assigneeUserId,
          kind: 'action_required',
          title: `Missing details — ${property.code}`,
          body: `Ask the owner the basics for ${property.code} (${property.name}). 24h.`,
          link: '/property-details',
        },
      });
      this.push.notifyPropertyDetailsAssigned(assigneeUserId, {
        propertyCode: property.code,
        propertyName: property.name,
      });
    }

    return { check, created: true };
  }

  // -------------------------------------------------------------------------
  // Coverage stats (analytics)
  // -------------------------------------------------------------------------

  /** % of active properties that have details filled — used in /analytics. */
  async coverage(companyId: string) {
    const [total, withDetails, openTasks] = await Promise.all([
      this.prisma.property.count({
        where: { companyId, deletedAt: null, status: { notIn: ['archived'] } },
      }),
      this.prisma.property.count({
        where: {
          companyId,
          deletedAt: null,
          status: { notIn: ['archived'] },
          detailsCompletedAt: { not: null },
        },
      }),
      this.prisma.propertyDetailsCheck.count({
        where: { companyId, status: 'pending', expiresAt: { gt: new Date() } },
      }),
    ]);
    return {
      totalProperties: total,
      propertiesWithDetails: withDetails,
      coverageRate: total === 0 ? 0 : withDetails / total,
      openTasks,
    };
  }

  // -------------------------------------------------------------------------
  // privates
  // -------------------------------------------------------------------------

  /** Round-robin assignment among active field agents, favouring the publisher
   *  who just posted (if they're a field agent). Falls back to the agent with
   *  the oldest last-assigned task to keep the queue balanced. */
  private async pickAssignee(
    companyId: string,
    preferredUserId: string | null,
  ): Promise<string | null> {
    if (preferredUserId) {
      const candidate = await this.prisma.user.findFirst({
        where: {
          id: preferredUserId,
          companyId,
          deletedAt: null,
          status: 'active',
          roles: { has: 'field_agent' as never },
        },
        select: { id: true },
      });
      if (candidate) return candidate.id;
    }

    const fieldAgents = await this.prisma.user.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'active',
        roles: { has: 'field_agent' as never },
      },
      select: { id: true },
    });
    if (fieldAgents.length === 0) return null;

    const lastAssignedRows = await this.prisma.propertyDetailsCheck.groupBy({
      by: ['assigneeUserId'],
      where: { companyId, assigneeUserId: { not: null } },
      _max: { assignedAt: true },
    });
    const lastAssignedMap = new Map<string, Date>();
    for (const r of lastAssignedRows) {
      if (r.assigneeUserId && r._max.assignedAt) {
        lastAssignedMap.set(r.assigneeUserId, r._max.assignedAt);
      }
    }
    fieldAgents.sort((a, b) => {
      const ta = lastAssignedMap.get(a.id)?.getTime() ?? 0;
      const tb = lastAssignedMap.get(b.id)?.getTime() ?? 0;
      return ta - tb;
    });
    return fieldAgents[0]?.id ?? null;
  }

  private assertOptionsForType(
    type: PropertyDetailQuestionType,
    options: unknown,
  ): void {
    if (type === 'enum' || type === 'multi_enum') {
      if (!Array.isArray(options) || options.length === 0) {
        throw new BadRequestException(`Question type "${type}" requires non-empty options[]`);
      }
      if (!options.every((o) => typeof o === 'string' && o.length > 0)) {
        throw new BadRequestException('options[] must be non-empty strings');
      }
    }
  }

  /** Per-question type validation. Strips unknown keys, coerces basic types,
   *  throws on enum mismatch. */
  private validateAnswers(
    questions: PropertyDetailQuestion[],
    answers: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const q of questions) {
      const raw = answers[q.key];
      if (!isPresent(raw)) continue;
      switch (q.type) {
        case 'text': {
          if (typeof raw !== 'string') throw new BadRequestException(`${q.key} must be a string`);
          out[q.key] = raw.trim();
          break;
        }
        case 'number': {
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(n)) throw new BadRequestException(`${q.key} must be a number`);
          out[q.key] = n;
          break;
        }
        case 'boolean': {
          if (typeof raw === 'boolean') out[q.key] = raw;
          else if (raw === 'true' || raw === 'false') out[q.key] = raw === 'true';
          else throw new BadRequestException(`${q.key} must be a boolean`);
          break;
        }
        case 'enum': {
          const opts = (q.options as string[] | null) ?? [];
          if (typeof raw !== 'string' || !opts.includes(raw)) {
            throw new BadRequestException(`${q.key} must be one of: ${opts.join(', ')}`);
          }
          out[q.key] = raw;
          break;
        }
        case 'multi_enum': {
          const opts = (q.options as string[] | null) ?? [];
          if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string' && opts.includes(v))) {
            throw new BadRequestException(`${q.key} must be an array of: ${opts.join(', ')}`);
          }
          out[q.key] = Array.from(new Set(raw));
          break;
        }
      }
    }
    return out;
  }
}

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
