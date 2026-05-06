import { DashboardNav } from '@/components/DashboardNav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-offwhite md:flex-row">
      <DashboardNav />
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <div className="hidden border-b border-gray-light bg-white px-4 py-4 md:block md:px-8">
          <p className="text-xs uppercase tracking-wide text-gray-medium">Operations dashboard</p>
        </div>
        <div className="px-4 py-4 md:px-8 md:py-6">{children}</div>
      </main>
    </div>
  );
}
