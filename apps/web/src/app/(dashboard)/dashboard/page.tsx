'use client';

import { useQuery } from '@tanstack/react-query';
import { KpiCard } from '@rentflow/ui';
import { api } from '@/lib/api';

interface FunnelData {
  posts: number;
  leads: number;
  qualified: number;
  viewingsCompleted: number;
  dealsWon: number;
  commissionExpected: number;
  commissionCollected: number;
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', 'funnel'],
    queryFn: () => api<FunnelData>('/analytics/funnel'),
  });

  return (
    <div>
      <header className="mb-6">
        <h1>Overview</h1>
        <p className="mt-1 text-sm text-gray-medium">
          Funnel from post packages to commission collected.
        </p>
      </header>

      {error ? <p className="text-sm text-danger">Failed to load: {(error as Error).message}</p> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Posts published" value={isLoading ? '—' : data?.posts ?? 0} />
        <KpiCard label="Leads" value={isLoading ? '—' : data?.leads ?? 0} />
        <KpiCard label="Qualified leads" value={isLoading ? '—' : data?.qualified ?? 0} />
        <KpiCard label="Viewings completed" value={isLoading ? '—' : data?.viewingsCompleted ?? 0} />
        <KpiCard label="Deals won" value={isLoading ? '—' : data?.dealsWon ?? 0} />
        <KpiCard
          label="Commission expected"
          value={isLoading ? '—' : `AED ${Number(data?.commissionExpected ?? 0).toLocaleString()}`}
        />
        <KpiCard
          label="Commission collected"
          value={isLoading ? '—' : `AED ${Number(data?.commissionCollected ?? 0).toLocaleString()}`}
          hint="Realized revenue"
        />
        <KpiCard
          label="Conversion (lead → won)"
          value={
            isLoading || !data?.leads
              ? '—'
              : `${((data.dealsWon / data.leads) * 100).toFixed(1)}%`
          }
        />
      </div>
    </div>
  );
}
