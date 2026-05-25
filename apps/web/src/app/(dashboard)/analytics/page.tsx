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

interface BonusStandings {
  year: number;
  month: number;
  performance: Array<{
    userId: string;
    fullName: string | null;
    leads: number;
    clicks: number;
    completionRate: number;
    score: number;
  }>;
  sourcing: Array<{
    userId: string;
    fullName: string | null;
    sourcedCount: number;
  }>;
  topPerformer: { userId: string; fullName: string | null; score: number } | null;
  topSourcer: { userId: string; fullName: string | null; sourcedCount: number } | null;
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

  const { data: bonus } = useQuery({
    queryKey: ['analytics', 'bonus-pool-standings'],
    queryFn: () => api<BonusStandings>('/bonus-pool/standings'),
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

      {/* SECTION 3.5 — Bonus pool standings (commission split preview) */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-medium">
          Bonus pool · {bonus ? `${bonus.year}-${String(bonus.month).padStart(2, '0')}` : '—'}
        </h2>
        <p className="text-xs text-gray-medium">
          Quién va ganando cada bucket del split mensual. Aplica a deals cerrados desde junio 2026:
          30% al closer (assigned field agent al cierre) · 10% al top performer del mes · 10% al
          sourcer del property (o split equitativo si no hay sourcer) · 50% plataforma.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-md border border-gray-light bg-white p-4 shadow-card">
            <h3 className="mb-2 text-xs uppercase tracking-wide text-gray-medium">
              Top performer (10%) — score 0.60 leads · 0.25 clicks · 0.15 completion
            </h3>
            {bonus && bonus.performance.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wide text-gray-medium">
                  <tr>
                    <th className="py-1">#</th>
                    <th className="py-1">Publisher</th>
                    <th className="py-1 text-right">Leads</th>
                    <th className="py-1 text-right">Clicks</th>
                    <th className="py-1 text-right">Done%</th>
                    <th className="py-1 text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {bonus.performance.slice(0, 6).map((r, i) => (
                    <tr key={r.userId} className={`border-t border-gray-light ${i === 0 ? 'bg-teal/5' : ''}`}>
                      <td className="py-1.5 font-mono text-xs text-gray-medium">{i + 1}</td>
                      <td className="py-1.5">
                        <span className={i === 0 ? 'font-bold text-teal' : 'font-semibold text-navy-deep'}>
                          {r.fullName ?? '—'}
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-semibold">{r.leads}</td>
                      <td className="py-1.5 text-right">{r.clicks}</td>
                      <td className="py-1.5 text-right">{Math.round(r.completionRate * 100)}%</td>
                      <td className="py-1.5 text-right font-mono text-xs">{r.score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-gray-medium">No activity this month yet.</p>
            )}
          </div>

          <div className="rounded-md border border-gray-light bg-white p-4 shadow-card">
            <h3 className="mb-2 text-xs uppercase tracking-wide text-gray-medium">
              Top sourcer (10%) — properties brought direct from owner this month
            </h3>
            {bonus && bonus.sourcing.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wide text-gray-medium">
                  <tr>
                    <th className="py-1">#</th>
                    <th className="py-1">Field agent</th>
                    <th className="py-1 text-right">Properties sourced</th>
                  </tr>
                </thead>
                <tbody>
                  {bonus.sourcing.slice(0, 6).map((r, i) => (
                    <tr key={r.userId} className={`border-t border-gray-light ${i === 0 ? 'bg-teal/5' : ''}`}>
                      <td className="py-1.5 font-mono text-xs text-gray-medium">{i + 1}</td>
                      <td className="py-1.5">
                        <span className={i === 0 ? 'font-bold text-teal' : 'font-semibold text-navy-deep'}>
                          {r.fullName ?? '—'}
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-semibold">{r.sourcedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-gray-medium">
                Nobody has been marked as the sourcer on a property this month yet. Set
                &quot;Sourced by&quot; on property cards to start counting.
              </p>
            )}
          </div>
        </div>
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
