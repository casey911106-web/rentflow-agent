import { RoleGate } from '@/components/RoleGate';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RoleGate roles={['super_admin', 'ops_manager']}>{children}</RoleGate>;
}
