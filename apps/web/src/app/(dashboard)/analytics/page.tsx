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

export default function AnalyticsPage() {
  const { data } = useQuery({
    queryKey: ['analytics', 'funnel'],
    queryFn: () => api<FunnelData>('/analytics/funnel'),
  });

  const stages = [
    { label: 'Post packages', value: data?.posts ?? 0,             color: '#082B5F' },
    { label: 'Leads',         value: data?.leads ?? 0,             color: '#0E7490' },
    { label: 'Qualified',     value: data?.qualified ?? 0,         color: '#00A7A5' },
    { label: 'Viewings',      value: data?.viewingsCompleted ?? 0, color: '#14B8A6' },
    { label: 'Deals won',     value: data?.dealsWon ?? 0,          color: '#00B894' },
  ];

  const max = Math.max(...stages.map((s) => s.value || 1));

  return (
    <div>
      <header className="mb-6">
        <h1>Funnel analytics</h1>
        <p className="mt-1 text-sm text-gray-medium">Post → Lead → Qualified → Viewing → Deal → Commission.</p>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label="Commission expected" value={`AED ${Number(data?.commissionExpected ?? 0).toLocaleString()}`} />
        <KpiCard label="Commission collected" value={`AED ${Number(data?.commissionCollected ?? 0).toLocaleString()}`} />
        <KpiCard
          label="Lead → Won"
          value={data?.leads ? `${((data.dealsWon / data.leads) * 100).toFixed(1)}%` : '—'}
        />
      </div>

      <div className="rounded-md border border-gray-light bg-white p-6 shadow-card">
        <h3 className="mb-4">Conversion funnel</h3>
        <div className="space-y-2">
          {stages.map((s) => (
            <div key={s.label} className="flex items-center gap-3">
              <span className="w-32 text-sm text-gray-dark">{s.label}</span>
              <div className="flex-1 overflow-hidden rounded-full bg-offwhite">
                <div
                  className="flex h-8 items-center justify-end pr-3 text-xs font-semibold text-white"
                  style={{ width: `${(s.value / max) * 100}%`, backgroundColor: s.color, minWidth: '32px' }}
                >
                  {s.value}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
