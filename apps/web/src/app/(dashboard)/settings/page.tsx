'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Me {
  id: string;
  email: string;
  fullName: string;
  role: string;
  company: { name: string; slug: string };
}

export default function SettingsPage() {
  const { data } = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });

  return (
    <div>
      <header className="mb-6">
        <h1>Settings</h1>
        <p className="mt-1 text-sm text-gray-medium">Tenant configuration. Most settings are post-MVP.</p>
      </header>

      <div className="space-y-4">
        <section className="rounded-md border border-gray-light bg-white p-6 shadow-card">
          <h3 className="mb-4">Account</h3>
          {data ? (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-xs text-gray-medium">Name</dt><dd className="font-semibold">{data.fullName}</dd></div>
              <div><dt className="text-xs text-gray-medium">Email</dt><dd className="font-mono text-xs">{data.email}</dd></div>
              <div><dt className="text-xs text-gray-medium">Role</dt><dd className="font-semibold">{data.role.replace(/_/g, ' ')}</dd></div>
              <div><dt className="text-xs text-gray-medium">Company</dt><dd className="font-semibold">{data.company.name}</dd></div>
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
