'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { api, clearToken } from '@/lib/api';

interface Me {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  company: { id: string; name: string; slug: string } | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isError, error } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    retry: false,
  });

  function handleLogout() {
    clearToken();
    queryClient.clear();
    router.replace('/login');
  }

  const rolesLabel =
    data?.roles && data.roles.length > 0
      ? data.roles.map((r) => r.replace(/_/g, ' ')).join(', ')
      : '—';

  return (
    <div>
      <header className="mb-6">
        <h1>Settings</h1>
        <p className="mt-1 text-sm text-gray-medium">Tenant configuration. Most settings are post-MVP.</p>
      </header>

      <div className="space-y-4">
        <section className="rounded-md border border-gray-light bg-white p-6 shadow-card">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h3 className="m-0">Account</h3>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md border border-gray-light bg-white px-3 py-1.5 text-sm font-semibold text-near-black hover:bg-offwhite"
            >
              Sign out
            </button>
          </div>
          {isError ? (
            <p className="text-sm text-danger">Failed to load account: {(error as Error)?.message ?? 'unknown error'}</p>
          ) : data ? (
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-gray-medium">Name</dt><dd className="font-semibold">{data.fullName}</dd></div>
              <div><dt className="text-xs text-gray-medium">Email</dt><dd className="font-mono text-xs">{data.email}</dd></div>
              <div><dt className="text-xs text-gray-medium">Roles</dt><dd className="font-semibold">{rolesLabel}</dd></div>
              <div><dt className="text-xs text-gray-medium">Company</dt><dd className="font-semibold">{data.company?.name ?? '—'}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-gray-medium">Loading…</p>
          )}
        </section>

        <section className="rounded-md border border-gray-light bg-white p-6 shadow-card">
          <h3 className="mb-2">WhatsApp business number</h3>
          <p className="text-sm text-gray-medium">
            Default: <span className="font-mono text-near-black">+971 58 506 3316</span>
          </p>
          <p className="mt-1 text-xs text-gray-medium">
            Update in <code>AppSetting</code> with key <code>whatsapp.business_number</code>.
          </p>
        </section>
      </div>
    </div>
  );
}
