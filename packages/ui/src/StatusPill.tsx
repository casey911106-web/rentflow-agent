import * as React from 'react';
import { Badge, type BadgeVariant } from './Badge';

const STATUS_TO_VARIANT: Record<string, BadgeVariant> = {
  available: 'available',
  pending_owner_confirmation: 'pending',
  rented: 'rented',
  blocked: 'blocked',
  hot: 'hot',
  warm: 'pending',
  cold: 'rented',
  qualified: 'qualified',
  won: 'won',
  lost: 'lost',
  ai: 'ai_active',
  ai_active: 'ai_active',
  human_takeover: 'human_takeover',
};

const STATUS_TO_LABEL: Record<string, string> = {
  available: 'Available',
  pending_owner_confirmation: 'Pending Owner',
  rented: 'Rented',
  blocked: 'Blocked',
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
  qualified: 'Qualified',
  won: 'Won',
  lost: 'Lost',
  ai: 'AI Active',
  ai_active: 'AI Active',
  human_takeover: 'Human Takeover',
};

export function StatusPill({ status }: { status: string }) {
  const variant = STATUS_TO_VARIANT[status] ?? 'neutral';
  const label = STATUS_TO_LABEL[status] ?? status.replace(/_/g, ' ');
  return <Badge variant={variant}>{label}</Badge>;
}
