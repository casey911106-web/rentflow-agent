'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Home,
  Building2,
  Users,
  MessageCircle,
  Calendar,
  Wallet,
  BarChart3,
  Megaphone,
  Settings,
  ClipboardCheck,
  AlertTriangle,
  Sparkles,
  HelpCircle,
  UserCog,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { PendingSuggestionsBadge } from '@/components/PendingSuggestionsBadge';
import { clearToken } from '@/lib/api';
import { hasAnyRole, useMe, type Role } from '@/lib/auth';

const ALL_ROLES: Role[] = ['super_admin', 'ops_manager', 'field_agent'];
const ADMIN_OPS: Role[] = ['super_admin', 'ops_manager'];
const SUPER_ONLY: Role[] = ['super_admin'];

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  roles: Role[];
}

const NAV: NavItem[] = [
  { href: '/dashboard',    label: 'Overview',     icon: <Home size={18} />,           roles: ALL_ROLES },
  { href: '/properties',   label: 'Properties',   icon: <Building2 size={18} />,      roles: ALL_ROLES },
  { href: '/owners',       label: 'Owners',       icon: <ClipboardCheck size={18} />, roles: ADMIN_OPS },
  { href: '/leads',        label: 'Leads',        icon: <Users size={18} />,          roles: ADMIN_OPS },
  { href: '/suggestions',  label: 'Suggestions',  icon: <Sparkles size={18} />,       roles: ADMIN_OPS, badge: <PendingSuggestionsBadge /> },
  { href: '/whatsapp',     label: 'WhatsApp',     icon: <MessageCircle size={18} />,  roles: ADMIN_OPS },
  { href: '/viewings',     label: 'Viewings',     icon: <Calendar size={18} />,       roles: ALL_ROLES },
  { href: '/issues',       label: 'Issues',       icon: <AlertTriangle size={18} />,  roles: ALL_ROLES },
  { href: '/posting',      label: 'Fast Posting', icon: <Megaphone size={18} />,      roles: ADMIN_OPS },
  { href: '/admin/publishing', label: 'Publishing', icon: <BarChart3 size={18} />,    roles: ADMIN_OPS },
  { href: '/deals',        label: 'Deals',        icon: <Wallet size={18} />,         roles: ADMIN_OPS },
  { href: '/analytics',    label: 'Analytics',    icon: <BarChart3 size={18} />,      roles: ADMIN_OPS },
  { href: '/how-it-works', label: 'How it works', icon: <HelpCircle size={18} />,     roles: ALL_ROLES },
  { href: '/admin/users',  label: 'Users',        icon: <UserCog size={18} />,        roles: SUPER_ONLY },
  { href: '/settings',     label: 'Settings',     icon: <Settings size={18} />,       roles: ALL_ROLES },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  icon,
  badge,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={[
        'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
        active
          ? 'bg-white/10 text-white'
          : 'text-slate-200 hover:bg-white/5 hover:text-white',
      ].join(' ')}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {badge}
    </Link>
  );
}

export function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: me } = useMe();

  const visibleNav = NAV.filter((item) => hasAnyRole(me?.roles, item.roles));

  function handleLogout() {
    clearToken();
    queryClient.clear();
    setOpen(false);
    router.replace('/login');
  }

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer open
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-gray-light bg-navy-deep px-4 text-white md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10 active:bg-white/15"
        >
          <Menu size={22} />
        </button>
        <p className="text-base font-bold tracking-tight">RentFlow Agent</p>
      </header>

      {/* Mobile drawer backdrop */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden={!open}
        className={[
          'fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
      />

      {/* Sidebar — drawer on mobile, static on md+ */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-navy-deep text-white shadow-2xl transition-transform duration-200 ease-out',
          'md:sticky md:top-0 md:z-auto md:h-screen md:w-64 md:max-w-none md:translate-x-0 md:shadow-none',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
        aria-label="Primary navigation"
      >
        <div className="flex items-center justify-between px-5 py-5 md:px-6 md:py-6">
          <div>
            <p className="text-lg font-bold">RentFlow Agent</p>
            <p className="mt-0.5 text-xs text-slate-300">Rental conversion OS</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10 md:hidden"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {visibleNav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              badge={item.badge}
              active={isActive(pathname, item.href)}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </nav>
        <div className="border-t border-white/10 px-3 py-3 md:px-4">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut size={18} />
            <span className="flex-1 text-left">Sign out</span>
          </button>
          <p className="mt-3 px-3 text-xs text-slate-400">WhatsApp: +971 58 506 3316</p>
        </div>
      </aside>
    </>
  );
}
