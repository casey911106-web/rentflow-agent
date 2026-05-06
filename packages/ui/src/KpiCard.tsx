import * as React from 'react';
import { cn } from './cn';

export interface KpiCardProps {
  label: string;
  value: string | number;
  trend?: number;       // percent change vs previous period
  hint?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function KpiCard({ label, value, trend, hint, icon, className }: KpiCardProps) {
  const trendColor =
    trend === undefined ? 'text-gray-medium' : trend >= 0 ? 'text-success' : 'text-danger';
  const trendLabel =
    trend === undefined ? null : `${trend >= 0 ? '+' : ''}${trend.toFixed(1)}%`;

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-card p-5 shadow-card',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-medium">
          {label}
        </span>
        {icon ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-light text-navy">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-navy-deep">{value}</span>
        {trendLabel ? (
          <span className={cn('text-sm font-semibold', trendColor)}>{trendLabel}</span>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-gray-medium">{hint}</p> : null}
    </div>
  );
}
