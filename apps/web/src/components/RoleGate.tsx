'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { hasAnyRole, useMe, type Role } from '@/lib/auth';

interface RoleGateProps {
  roles: Role[];
  children: React.ReactNode;
  fallbackPath?: string;
}

export function RoleGate({ roles, children, fallbackPath = '/dashboard' }: RoleGateProps) {
  const router = useRouter();
  const { data: me, isLoading, isError } = useMe();

  const allowed = hasAnyRole(me?.roles, roles);

  useEffect(() => {
    if (isLoading) return;
    if (isError || !me) return;
    if (!allowed) router.replace(fallbackPath);
  }, [allowed, isLoading, isError, me, router, fallbackPath]);

  if (isLoading) {
    return <p className="p-6 text-sm text-gray-medium">Loading…</p>;
  }
  if (!allowed) {
    return null;
  }
  return <>{children}</>;
}
