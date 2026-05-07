'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Role = 'super_admin' | 'ops_manager' | 'field_agent';

export interface Me {
  id: string;
  email: string;
  fullName: string;
  roles: Role[];
  company: { id: string; name: string; slug: string } | null;
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function hasAnyRole(userRoles: Role[] | undefined, required: Role[]): boolean {
  if (!userRoles || userRoles.length === 0) return false;
  return required.some((r) => userRoles.includes(r));
}
