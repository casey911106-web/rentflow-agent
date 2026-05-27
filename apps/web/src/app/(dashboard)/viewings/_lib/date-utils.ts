// Dubai is UTC+4 year-round. Convert ISO timestamps to Dubai-local for display
// and back to UTC ISO for API queries.
const DUBAI_OFFSET_HOURS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function dubaiNow(): Date {
  return new Date(Date.now() + DUBAI_OFFSET_HOURS * 60 * 60 * 1000);
}

export function toDubai(utc: Date): Date {
  return new Date(utc.getTime() + DUBAI_OFFSET_HOURS * 60 * 60 * 1000);
}

/** UTC instant corresponding to 00:00 Dubai-local on the first day of the month. */
export function monthStart(year: number, monthIndex: number): Date {
  const dubaiMidnight = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  return new Date(dubaiMidnight.getTime() - DUBAI_OFFSET_HOURS * 60 * 60 * 1000);
}

export function monthEnd(year: number, monthIndex: number): Date {
  const next = monthStart(year, monthIndex + 1);
  return new Date(next.getTime() - 1);
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface MonthGridCell {
  date: Date;
  inMonth: boolean;
}

/** 7-column month grid (Mon..Sun) padded with the leading days from the
 *  previous month. Always returns full weeks (multiples of 7) and trims a
 *  trailing all-padding row when the month ends mid-grid. */
export function buildMonthGrid(year: number, monthIndex: number): MonthGridCell[] {
  const firstDub = new Date(Date.UTC(year, monthIndex, 1));
  const dayOfWeek = (firstDub.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const gridStart = new Date(firstDub.getTime() - dayOfWeek * MS_PER_DAY);

  const cells: MonthGridCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * MS_PER_DAY);
    cells.push({
      date: d,
      inMonth: d.getUTCMonth() === monthIndex && d.getUTCFullYear() === year,
    });
  }
  while (cells.length > 35 && !cells.slice(-7).some((c) => c.inMonth)) {
    cells.length = cells.length - 7;
  }
  return cells;
}

export function sameDubaiDay(a: Date, b: Date): boolean {
  return toISODate(toDubai(a)) === toISODate(toDubai(b));
}

export function formatHHmm(utc: Date): string {
  const dub = toDubai(utc);
  const h = String(dub.getUTCHours()).padStart(2, '0');
  const m = String(dub.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
