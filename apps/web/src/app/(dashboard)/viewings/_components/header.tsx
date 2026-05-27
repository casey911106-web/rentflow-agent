'use client';

interface Props {
  year: number;
  monthIndex: number;
  view: 'month' | 'week';
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (v: 'month' | 'week') => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function CalendarHeader({ year, monthIndex, view, onPrev, onNext, onToday, onViewChange }: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onPrev}
        className="rounded-md border border-gray-light bg-white px-3 py-1 text-sm text-gray-dark hover:bg-offwhite"
        aria-label="Previous month"
      >
        ‹
      </button>
      <span className="min-w-[180px] text-center text-lg font-semibold text-navy">
        {MONTH_NAMES[monthIndex]} {year}
      </span>
      <button
        type="button"
        onClick={onNext}
        className="rounded-md border border-gray-light bg-white px-3 py-1 text-sm text-gray-dark hover:bg-offwhite"
        aria-label="Next month"
      >
        ›
      </button>
      <button
        type="button"
        onClick={onToday}
        className="rounded-md border border-gray-light bg-white px-3 py-1 text-sm text-gray-dark hover:bg-offwhite"
      >
        Today
      </button>
      <div className="ml-auto flex rounded-md border border-gray-light bg-white p-0.5 text-sm">
        <button
          type="button"
          onClick={() => onViewChange('month')}
          className={`rounded px-3 py-1 ${view === 'month' ? 'bg-teal text-white' : 'text-gray-dark'}`}
        >
          Month
        </button>
        <button
          type="button"
          onClick={() => onViewChange('week')}
          className={`rounded px-3 py-1 ${view === 'week' ? 'bg-teal text-white' : 'text-gray-dark'}`}
        >
          Week
        </button>
      </div>
    </div>
  );
}
