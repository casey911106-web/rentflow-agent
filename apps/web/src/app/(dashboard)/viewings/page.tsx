'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CalendarHeader } from './_components/header';
import { CalendarGrid, type ViewingRow } from './_components/calendar-grid';
import { DayDrawer } from './_components/day-drawer';
import {
  dubaiNow,
  monthStart,
  monthEnd,
  toISODate,
  sameDubaiDay,
} from './_lib/date-utils';

export default function ViewingsPage() {
  const today = dubaiNow();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [monthIndex, setMonthIndex] = useState(today.getUTCMonth());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const range = useMemo(() => {
    if (view === 'week') {
      const base = today;
      const dow = (base.getUTCDay() + 6) % 7;
      const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - dow));
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
      return { from: toISODate(start), to: toISODate(end) };
    }
    return {
      from: toISODate(monthStart(year, monthIndex)),
      to: toISODate(monthEnd(year, monthIndex)),
    };
  }, [view, year, monthIndex, today]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['viewings', range.from, range.to],
    queryFn: () => api<ViewingRow[]>(`/viewings?from=${range.from}&to=${range.to}`),
  });

  const drawerRows = selectedDay
    ? rows.filter((r) => sameDubaiDay(new Date(r.scheduledAt), selectedDay))
    : [];

  function goPrev() {
    if (monthIndex === 0) {
      setYear(year - 1);
      setMonthIndex(11);
    } else {
      setMonthIndex(monthIndex - 1);
    }
  }
  function goNext() {
    if (monthIndex === 11) {
      setYear(year + 1);
      setMonthIndex(0);
    } else {
      setMonthIndex(monthIndex + 1);
    }
  }
  function goToday() {
    setYear(today.getUTCFullYear());
    setMonthIndex(today.getUTCMonth());
  }

  return (
    <div>
      <header className="mb-6">
        <h1>Viewings</h1>
        <p className="mt-1 text-sm text-gray-medium">
          Scheduled viewings across all field agents.
        </p>
      </header>

      <CalendarHeader
        year={year}
        monthIndex={monthIndex}
        view={view}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onViewChange={setView}
      />

      {isLoading ? (
        <div className="rounded-md border border-gray-light bg-white p-8 text-center text-sm text-gray-medium shadow-card">
          Loading…
        </div>
      ) : (
        <CalendarGrid
          year={year}
          monthIndex={monthIndex}
          rows={rows}
          onDayClick={setSelectedDay}
        />
      )}

      <DayDrawer
        date={selectedDay}
        rows={drawerRows}
        onClose={() => setSelectedDay(null)}
      />
    </div>
  );
}
