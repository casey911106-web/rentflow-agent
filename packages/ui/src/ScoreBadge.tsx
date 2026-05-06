import * as React from 'react';
import { bandFor } from '@rentflow/shared';
import { cn } from './cn';

export interface ScoreBadgeProps {
  score: number;
  label?: string;
  className?: string;
}

export function ScoreBadge({ score, label, className }: ScoreBadgeProps) {
  const band = bandFor(score);
  return (
    <span
      className={cn('inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold text-white', className)}
      style={{ backgroundColor: band.color }}
      title={label}
    >
      {label ? `${label}: ` : null}
      {score}
    </span>
  );
}
