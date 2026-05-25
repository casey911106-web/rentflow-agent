'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';

const PROPERTY_TYPES: Array<{ value: string; label: string }> = [
  { value: 'bed_space',     label: 'Bed space' },
  { value: 'shared_room',   label: 'Shared room' },
  { value: 'partition',     label: 'Partition' },
  { value: 'standard_room', label: 'Standard room' },
  { value: 'master_room',   label: 'Master room' },
  { value: 'studio',        label: 'Studio' },
  { value: 'one_bedroom',   label: '1-bedroom' },
  { value: 'two_bedroom',   label: '2-bedroom' },
  { value: 'three_bedroom', label: '3-bedroom' },
  { value: 'villa',         label: 'Villa' },
  { value: 'other',         label: 'Other' },
];

interface OwnerOption {
  id: string;
  fullName: string;
  phoneE164: string;
}

export default function NewPropertyPage() {
  const router = useRouter();

  const { data: owners, isLoading: ownersLoading } = useQuery({
    queryKey: ['owners'],
    queryFn: () => api<OwnerOption[]>('/owners'),
  });

  const [form, setForm] = useState({
    name: '',
    type: 'studio',
    ownerId: '',
    area: '',
    priceAed: '',
    depositAed: '',
    occupancyMax: '',
    description: '',
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/properties', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          ownerId: form.ownerId || undefined,
          area: form.area.trim() || undefined,
          priceAed: form.priceAed ? Number(form.priceAed) : undefined,
          depositAed: form.depositAed ? Number(form.depositAed) : undefined,
          occupancyMax: form.occupancyMax ? Number(form.occupancyMax) : undefined,
          description: form.description.trim() || undefined,
        }),
      }),
    onSuccess: (property) => router.push(`/properties/${property.id}`),
    onError: (err) => setError((err as Error).message || 'Failed to create property'),
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    setError(null);
    if (form.name.trim().length < 2) {
      setError('Name is required (at least 2 characters).');
      return;
    }
    if (form.priceAed && Number(form.priceAed) <= 0) {
      setError('Price must be a positive number.');
      return;
    }
    create.mutate();
  }

  return (
    <div className="max-w-3xl">
      <Link href="/properties" className="text-sm text-gray-medium hover:text-navy-deep">
        ← Back to Properties
      </Link>

      <header className="mb-6 mt-3">
        <h1>Add property</h1>
        <p className="mt-1 text-sm text-gray-medium">
          Create the listing now; you can add photos, description, viewing access and other fields on the detail page after.
          A property code (e.g. <code className="font-mono">RF-011</code>) is generated automatically.
        </p>
      </header>

      <div className="rounded-md border border-gray-light bg-white p-6 shadow-card">
        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <Field
          label="Name"
          value={form.name}
          onChange={(v) => setField('name', v)}
          placeholder="e.g. JVC Studio - Tower B"
          required
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="mb-4">
            <label className="mb-1 block text-xs font-semibold text-gray-dark">
              Type <span className="ml-1 text-danger">*</span>
            </label>
            <select
              value={form.type}
              onChange={(e) => setField('type', e.target.value)}
              className="w-full rounded-md border border-gray-light px-3 py-2 text-sm focus:border-teal focus:outline-none"
            >
              {PROPERTY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-xs font-semibold text-gray-dark">Owner</label>
            <select
              value={form.ownerId}
              onChange={(e) => setField('ownerId', e.target.value)}
              disabled={ownersLoading}
              className="w-full rounded-md border border-gray-light px-3 py-2 text-sm focus:border-teal focus:outline-none disabled:bg-offwhite"
            >
              <option value="">— Unassigned (link later) —</option>
              {(owners ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.fullName} ({o.phoneE164})
                </option>
              ))}
            </select>
            {!ownersLoading && (owners ?? []).length === 0 ? (
              <p className="mt-1 text-xs text-gray-medium">
                No owners yet —{' '}
                <Link href="/owners/new" className="text-teal hover:underline">
                  add one first
                </Link>
                .
              </p>
            ) : null}
          </div>
        </div>

        <Field
          label="Area"
          value={form.area}
          onChange={(v) => setField('area', v)}
          placeholder="e.g. JVC, Marina, Bur Dubai"
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field
            label="Monthly price (AED)"
            type="number"
            value={form.priceAed}
            onChange={(v) => setField('priceAed', v)}
            placeholder="3500"
          />
          <Field
            label="Deposit (AED)"
            type="number"
            value={form.depositAed}
            onChange={(v) => setField('depositAed', v)}
            placeholder="3500"
          />
          <Field
            label="Occupancy max"
            type="number"
            value={form.occupancyMax}
            onChange={(v) => setField('occupancyMax', v)}
            placeholder="2"
          />
        </div>

        <label className="mb-1 block text-xs font-semibold text-gray-dark">Description</label>
        <textarea
          rows={3}
          placeholder="Quick description; you can expand it later."
          value={form.description}
          onChange={(e) => setField('description', e.target.value)}
          className="w-full rounded-md border border-gray-light bg-offwhite p-2.5 text-sm focus:border-teal focus:bg-white focus:outline-none"
        />

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={create.isPending}
            className="rounded-md bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create property'}
          </button>
          <Link
            href="/properties"
            className="rounded-md border border-gray-light px-5 py-2.5 text-sm font-semibold text-gray-dark hover:bg-offwhite"
          >
            Cancel
          </Link>
        </div>

        <p className="mt-6 border-t border-gray-light pt-4 text-xs text-gray-medium">
          On the next page you can upload photos, set address, viewing access, confirm price, and review readiness score (must reach 60 to publish post packages).
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  required?: boolean;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1 block text-xs font-semibold text-gray-dark">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-light px-3 py-2 text-sm focus:border-teal focus:outline-none"
      />
    </div>
  );
}
