'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';

const E164_REGEX = /^\+\d{6,15}$/;

export default function NewOwnerPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: '',
    phoneE164: '+971',
    email: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/owners', {
        method: 'POST',
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          phoneE164: form.phoneE164.trim(),
          email: form.email.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      }),
    onSuccess: (owner) => router.push(`/owners/${owner.id}`),
    onError: (err) => setError((err as Error).message || 'Failed to create owner'),
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    setError(null);
    if (form.fullName.trim().length < 2) {
      setError('Full name is required.');
      return;
    }
    if (!E164_REGEX.test(form.phoneE164.trim())) {
      setError('Phone must be in E.164 format, e.g. +971501234567.');
      return;
    }
    create.mutate();
  }

  return (
    <div className="max-w-2xl">
      <Link href="/owners" className="text-sm text-gray-medium hover:text-navy-deep">
        ← Back to Owners
      </Link>

      <header className="mb-6 mt-3">
        <h1>Add owner</h1>
        <p className="mt-1 text-sm text-gray-medium">
          Owners communicate via WhatsApp; the phone number is the identity used for availability checks.
        </p>
      </header>

      <div className="rounded-md border border-gray-light bg-white p-6 shadow-card">
        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <Field
          label="Full name"
          value={form.fullName}
          onChange={(v) => setField('fullName', v)}
          placeholder="e.g. Mohammed Al Marri"
          required
        />

        <Field
          label="Phone (E.164)"
          value={form.phoneE164}
          onChange={(v) => setField('phoneE164', v)}
          placeholder="+971501234567"
          hint="Must start with + and country code. UAE = +971."
          required
        />

        <Field
          label="Email (optional)"
          type="email"
          value={form.email}
          onChange={(v) => setField('email', v)}
          placeholder="owner@example.com"
        />

        <label className="mb-1 block text-xs font-semibold text-gray-dark">
          Internal notes (optional)
        </label>
        <textarea
          rows={4}
          placeholder="Preferences, constraints, history with this owner…"
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value)}
          className="w-full rounded-md border border-gray-light bg-offwhite p-2.5 text-sm focus:border-teal focus:bg-white focus:outline-none"
        />

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={create.isPending}
            className="rounded-md bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create owner'}
          </button>
          <Link
            href="/owners"
            className="rounded-md border border-gray-light px-5 py-2.5 text-sm font-semibold text-gray-dark hover:bg-offwhite"
          >
            Cancel
          </Link>
        </div>

        <p className="mt-6 border-t border-gray-light pt-4 text-xs text-gray-medium">
          After creating, you can link properties to this owner from the property edit page or by creating new properties with this owner selected.
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
  hint,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  type?: 'text' | 'email' | 'tel';
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
      {hint ? <p className="mt-1 text-xs text-gray-medium">{hint}</p> : null}
    </div>
  );
}
