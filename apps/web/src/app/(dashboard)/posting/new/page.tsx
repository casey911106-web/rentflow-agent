'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { ScoreBadge, StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface PropertyRow {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  area: string | null;
  priceAed: string | null;
  readinessScore: number;
  qualityScore: number;
  owner: { fullName: string } | null;
}

const READINESS_GATE = 50;

export default function NewPostPackagePage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: properties, isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api<PropertyRow[]>('/properties'),
  });

  const generate = useMutation({
    mutationFn: (propertyId: string) =>
      api<{ id: string }>('/post-packages/generate', {
        method: 'POST',
        body: JSON.stringify({ propertyId }),
      }),
    onSuccess: (pkg) => router.push(`/posting/${pkg.id}`),
    onError: (err) => setError((err as Error).message || 'Generation failed'),
  });

  const filtered = !properties
    ? []
    : properties
        .filter((p) => showAll || p.readinessScore >= READINESS_GATE)
        .filter(
          (p) =>
            !search ||
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.code.toLowerCase().includes(search.toLowerCase()) ||
            (p.area ?? '').toLowerCase().includes(search.toLowerCase()),
        );

  return (
    <div className="max-w-5xl">
      <Link href="/posting" className="text-sm text-gray-medium hover:text-navy-deep">
        ← Back to Posting Studio
      </Link>

      <header className="mb-6 mt-3">
        <h1>Generate post package</h1>
        <p className="mt-1 text-sm text-gray-medium">
          Pick a property. Only properties with readiness ≥ {READINESS_GATE} can be posted; flip the toggle to
          override (you'll get a clear error if it's not ready).
        </p>
      </header>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 whitespace-pre-line">
          <strong>Cannot generate:</strong>{'\n'}{error}
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-3">
        <input
          type="search"
          placeholder="Search by name, code, or area…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-md border border-gray-light px-3 py-2 text-sm focus:border-teal focus:outline-none"
        />
        <label className="flex items-center gap-2 text-xs text-gray-dark">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="h-4 w-4"
          />
          Show all (ignore readiness gate)
        </label>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-medium">Loading properties…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-light bg-white p-12 text-center">
          <p className="text-sm text-gray-medium">
            No properties match. Lower the readiness gate or check your inventory.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-gray-light bg-white shadow-card">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Area</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Readiness</th>
                <th className="px-4 py-3">Quality</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const blocked = p.readinessScore < READINESS_GATE;
                return (
                  <tr key={p.id} className="border-t border-gray-light hover:bg-offwhite">
                    <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                    <td className="px-4 py-3 font-semibold">{p.name}</td>
                    <td className="px-4 py-3 text-gray-dark">{p.type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-gray-dark">{p.area ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-dark">
                      {p.priceAed ? `AED ${Number(p.priceAed).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3"><StatusPill status={p.status} /></td>
                    <td className="px-4 py-3"><ScoreBadge score={p.readinessScore} /></td>
                    <td className="px-4 py-3"><ScoreBadge score={p.qualityScore} /></td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => generate.mutate(p.id)}
                        disabled={generate.isPending || (blocked && !showAll)}
                        className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
                      >
                        {generate.isPending && generate.variables === p.id
                          ? 'Generating…'
                          : 'Generate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
