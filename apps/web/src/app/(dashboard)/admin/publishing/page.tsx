'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface LeaderboardRow {
  user: { id: string; fullName: string; email: string; roles: string[] } | null;
  placements: number;
  totalReach: number;
}

export default function PublishingLeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<LeaderboardRow[]>(`/admin/publishing/leaderboard?sinceDays=${days}`);
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [days]);

  const totalPlacements = rows.reduce((sum, r) => sum + r.placements, 0);
  const totalReach = rows.reduce((sum, r) => sum + r.totalReach, 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-navy-deep">Publishing leaderboard</h1>
        <p className="text-sm text-gray-medium">
          Effort & reach per publisher. The more groups they post in, the more leads we get.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-medium">Window:</label>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-gray-light px-3 py-1 text-sm"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiTile label="Total placements" value={totalPlacements.toLocaleString()} />
        <KpiTile label="Total reach" value={totalReach.toLocaleString()} suffix="people" />
        <KpiTile label="Avg reach / placement" value={totalPlacements > 0 ? Math.round(totalReach / totalPlacements).toLocaleString() : '—'} />
      </div>

      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{error}</p> : null}
      {loading ? <p className="text-sm text-gray-medium">Loading…</p> : null}

      <div className="overflow-hidden rounded-md border border-gray-light bg-white">
        <table className="w-full text-sm">
          <thead className="bg-offwhite text-left text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Publisher</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3 text-right">Placements</th>
              <th className="px-4 py-3 text-right">Total reach</th>
              <th className="px-4 py-3 text-right">Avg reach / placement</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
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
                <td className="px-4 py-3 text-right font-semibold">{r.placements.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-semibold">{r.totalReach.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-gray-dark">
                  {r.placements > 0 ? Math.round(r.totalReach / r.placements).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr><td className="px-4 py-6 text-center text-gray-medium" colSpan={6}>No placements logged in this window yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-medium">
        Reach is the sum of group/page member counts publishers reported when logging each placement.
        Encourage publishers to fill in the audience size accurately — it&apos;s the basis for scoring effort.
      </p>
    </div>
  );
}

function KpiTile({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <div className="rounded-md bg-white p-4 shadow-card">
      <p className="text-xs uppercase tracking-wide text-gray-medium">{label}</p>
      <p className="mt-1 text-2xl font-bold text-navy-deep">
        {value} {suffix ? <span className="text-xs font-normal text-gray-medium">{suffix}</span> : null}
      </p>
    </div>
  );
}
