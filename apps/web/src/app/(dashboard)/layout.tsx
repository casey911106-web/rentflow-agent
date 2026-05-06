import Link from 'next/link';
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
} from 'lucide-react';
import { PendingSuggestionsBadge } from '@/components/PendingSuggestionsBadge';

const NAV: Array<{ href: string; label: string; icon: React.ReactNode; badge?: React.ReactNode }> = [
  { href: '/dashboard',         label: 'Overview',         icon: <Home size={18} /> },
  { href: '/properties',        label: 'Properties',       icon: <Building2 size={18} /> },
  { href: '/owners',            label: 'Owners',           icon: <ClipboardCheck size={18} /> },
  { href: '/leads',             label: 'Leads',            icon: <Users size={18} /> },
  { href: '/suggestions',       label: 'Suggestions',      icon: <Sparkles size={18} />, badge: <PendingSuggestionsBadge /> },
  { href: '/whatsapp',          label: 'WhatsApp',         icon: <MessageCircle size={18} /> },
  { href: '/viewings',          label: 'Viewings',         icon: <Calendar size={18} /> },
  { href: '/issues',            label: 'Issues',           icon: <AlertTriangle size={18} /> },
  { href: '/posting',           label: 'Fast Posting',     icon: <Megaphone size={18} /> },
  { href: '/deals',             label: 'Deals',            icon: <Wallet size={18} /> },
  { href: '/analytics',         label: 'Analytics',        icon: <BarChart3 size={18} /> },
  { href: '/how-it-works',      label: 'How it works',     icon: <HelpCircle size={18} /> },
  { href: '/admin/users',       label: 'Users',            icon: <UserCog size={18} /> },
  { href: '/settings',          label: 'Settings',         icon: <Settings size={18} /> },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-offwhite">
      <aside className="flex w-64 flex-col bg-navy-deep text-white">
        <div className="px-6 py-6">
          <p className="text-lg font-bold">RentFlow Agent</p>
          <p className="mt-0.5 text-xs text-slate-300">Rental conversion OS</p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-white/5 hover:text-white"
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-6 py-4 text-xs text-slate-400">
          <p>WhatsApp: +971 58 506 3316</p>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <div className="border-b border-gray-light bg-white px-8 py-4">
          <p className="text-xs uppercase tracking-wide text-gray-medium">Operations dashboard</p>
        </div>
        <div className="px-8 py-6">{children}</div>
      </main>
    </div>
  );
}
