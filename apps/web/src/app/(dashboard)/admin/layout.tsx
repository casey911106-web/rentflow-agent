import { RoleGate } from '@/components/RoleGate';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RoleGate roles={['super_admin']}>{children}</RoleGate>;
}
