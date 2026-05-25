'use client';

import { useEffect, useState } from 'react';
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

interface LeaderboardRow {
  user: { id: string; fullName: string; email: string; roles: string[] } | null;
  placements: number;
  totalClicks: number;
  attributedLeads: number;
  assignedTotal: number;
  assignedFulfilled: number;
  assignedExpired: number;
  assignedPending: number;
  completionRate: number;
}

interface DetailsCoverage {
  totalProperties: number;
  propertiesWithDetails: number;
  coverageRate: number;
  openTasks: number;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const { data: funnel } = useQuery({
    queryKey: ['analytics', 'funnel'],
    queryFn: () => api<FunnelData>('/analytics/funnel'),
  });

  const { data: coverage } = useQuery({
    queryKey: ['analytics', 'details-coverage'],
    queryFn: () => api<DetailsCoverage>('/property-details/coverage'),
  });

  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setBoardLoading(true);
    setBoardError(null);
    api<LeaderboardRow[]>(`/admin/publishing/leaderboard?sinceDays=${days}`)
      .then((data) => active && setBoard(data))
      .catch((e) => active && setBoardError((e as Error).message))
      .finally(() => active && setBoardLoading(false));
    return () => { active = false; };
  }, [days]);

  const stages = [
    { label: 'Post packages', value: funnel?.posts ?? 0,             color: '#082B5F' },
    { label: 'Leads',         value: funnel?.leads ?? 0,             color: '#0E7490' },
    { label: 'Qualified',     value: funnel?.qualified ?? 0,         color: '#00A7A5' },
    { label: 'Viewings',      value: funnel?.viewingsCompleted ?? 0, color: '#14B8A6' },
    { label: 'Deals won',     value: funnel?.dealsWon ?? 0,          color: '#00B894' },
  ];
  const max = Math.max(...stages.map((s) => s.value || 1));
  const conversion = funnel?.leads ? `${((funnel.dealsWon / funnel.leads) * 100).toFixed(1)}%` : '—';

  const totalPlacements = board.reduce((sum, r) => sum + r.placements, 0);
  const totalClicks = board.reduce((sum, r) => sum + r.totalClicks, 0);
  const totalLeads = board.reduce((sum, r) => sum + r.attributedLeads, 0);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold text-navy-deep">Analytics</h1>
        <p className="mt-1 text-sm text-gray-medium">
          Negocio end-to-end en un solo lugar: pipeline → funnel → publishers → calidad de catálogo.
        </p>
      </header>

      {/* SECTION 1 — Overview KPIs */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-medium">Overview</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard label="Posts published" value={funnel?.posts ?? 0} />
          <KpiCard label="Leads" value={funnel?.leads ?? 0} />
          <KpiCard label="Qualified leads" value={funnel?.qualified ?? 0} />
          <KpiCard label="Viewings completed" value={funnel?.viewingsCompleted ?? 0} />
          <KpiCard label="Deals won" value={funnel?.dealsWon ?? 0} />
          <KpiCard
            label="Commission expected"
            value={`AED ${Number(funnel?.commissionExpected ?? 0).toLocaleString()}`}
          />
          <KpiCard
            label="Commission collected"
            value={`AED ${Number(funnel?.commissionCollected ?? 0).toLocaleString()}`}
            hint="Realized revenue"
          />
          <KpiCard label="Conversion (lead → won)" value={conversion} />
        </div>
      </section>

      {/* SECTION 2 — Funnel */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-medium">
          Funnel: Post → Lead → Qualified → Viewing → Deal
        </h2>
        <div className="rounded-md border border-gray-light bg-white p-6 shadow-card">
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
      </section>

      {/* SECTION 3 — Property details coverage */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-medium">
          Calidad de catálogo
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard
            label="Properties with details"
            value={coverage ? `${coverage.propertiesWithDetails} / ${coverage.totalProperties}` : '—'}
            hint="Field agent has answered the FAQ basics with the owner"
          />
          <KpiCard
            label="Coverage rate"
            value={coverage ? `${(coverage.coverageRate * 100).toFixed(0)}%` : '—'}
          />
          <KpiCard
            label="Open details tasks"
            value={coverage?.openTasks ?? 0}
            hint="Pending property-details checks across field agents"
          />
        </div>
        <p className="text-xs text-gray-medium">
          Coverage = properties whose details JSON has every required question answered.
          When this is high, the WhatsApp AI agent answers guest FAQs without escalating.
        </p>
      </section>

      {/* SECTION 4 — Publisher leaderboard */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-medium">
            Publisher leaderboard
          </h2>
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-medium">Window:</label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-md border border-gray-light px-3 py-1 text-xs"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard label="Total placements" value={totalPlacements.toLocaleString()} />
          <KpiCard label="Total clicks" value={totalClicks.toLocaleString()} hint="link clicks" />
          <KpiCard label="Attributed leads" value={totalLeads.toLocaleString()} hint="from these placements" />
        </div>

        {boardError ? <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{boardError}</p> : null}
        {boardLoading ? <p className="text-sm text-gray-medium">Loading…</p> : null}

        <div className="overflow-hidden rounded-md border border-gray-light bg-white">
          <table className="w-full text-sm">
            <thead className="bg-offwhite text-left text-xs uppercase tracking-wide text-gray-medium">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Publisher</th>
                <th className="px-4 py-3">Roles</th>
                <th className="px-4 py-3 text-right">Tasks assigned</th>
                <th className="px-4 py-3 text-right">✓ Done</th>
                <th className="px-4 py-3 text-right">✗ Expired</th>
                <th className="px-4 py-3 text-right">Complete %</th>
                <th className="px-4 py-3 text-right">Placements</th>
                <th className="px-4 py-3 text-right">Clicks</th>
                <th className="px-4 py-3 text-right">Leads</th>
              </tr>
            </thead>
            <tbody>
              {board.map((r, i) => (
                <tr key={r.user?.id ?? i} className="border-t border-gray-light">
                  <td className="px-4 py-3 font-mono text-xs text-gray-medium">{i + 1}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-navy-deep">{r.user?.fullName ?? '—'}</p>
                    <p className="text-xs text-gray-medium">{r.user?.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.user?.roles.map((role) => (
                        <span key={role} className="rounded-full bg-teal/10 px-2 py-0.5 text-[10px] font-semibold text-teal">
                          {role}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{r.assignedTotal.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-700">{r.assignedFulfilled.toLocaleString()}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${r.assignedExpired > 0 ? 'text-rose-700' : 'text-gray-medium'}`}>
                    {r.assignedExpired.toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${
                    r.assignedTotal === 0 ? 'text-gray-medium' :
                    r.completionRate >= 0.8 ? 'text-emerald-700' :
                    r.completionRate >= 0.5 ? 'text-amber-600' :
                    'text-rose-700'
                  }`}>
                    {r.assignedTotal === 0 ? '—' : `${Math.round(r.completionRate * 100)}%`}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{r.placements.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold">{r.totalClicks.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-teal">{r.attributedLeads.toLocaleString()}</td>
                </tr>
              ))}
              {!boardLoading && board.length === 0 ? (
                <tr><td className="px-4 py-6 text-center text-gray-medium" colSpan={10}>No activity in this window yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-medium">
          Clicks are server-counted hits on each placement&apos;s unique tracking link. Leads are visitors who came through one of those clicks and started a WhatsApp conversation.
        </p>
      </section>
    </div>
  );
}
