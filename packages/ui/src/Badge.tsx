import * as React from 'react';
import { cn } from './cn';

export type BadgeVariant =
  | 'available'
  | 'pending'
  | 'rented'
  | 'blocked'
  | 'hot'
  | 'qualified'
  | 'won'
  | 'lost'
  | 'ai_active'
  | 'human_takeover'
  | 'neutral';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  available:      'bg-emerald-50 text-emerald-700',
  pending:        'bg-amber-50 text-amber-800',
  rented:         'bg-slate-100 text-slate-600',
  blocked:        'bg-red-50 text-red-800',
  hot:            'bg-red-50 text-red-800',
  qualified:      'bg-teal-50 text-teal-800',
  won:            'bg-emerald-50 text-emerald-700',
  lost:           'bg-red-50 text-red-800',
  ai_active:      'bg-teal-50 text-teal-800',
  human_takeover: 'bg-violet-50 text-violet-800',
  neutral:        'bg-slate-100 text-slate-700',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: React.ReactNode;
}

export function Badge({ variant = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
