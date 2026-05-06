/**
 * Simple deterministic parsers for inbound lead messages.
 * Used by the lead workflow runner to extract structured data without
 * round-tripping to an LLM. Replace with AI-driven parsing later if needed.
 */

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'no contact', 'leave me alone', 'لا تراسلني'];

export function isOptOut(text: string, extraKeywords: string[] = []): boolean {
  const t = text.toLowerCase().trim();
  const all = [...OPT_OUT_KEYWORDS, ...extraKeywords.map((k) => k.toLowerCase())];
  return all.some((kw) => {
    if (kw.length <= 4) {
      return new RegExp(`(^|\\W)${kw}($|\\W)`, 'i').test(t);
    }
    return t.includes(kw);
  });
}

/** Parse a number of people from a free-text reply. Returns undefined if unclear. */
export function parsePeopleCount(text: string): number | undefined {
  const m = text.match(/(\d{1,2})\b/);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 10);
  if (n >= 1 && n <= 20) return n;
  return undefined;
}

/** Parse rental duration in months. Handles "6 months", "1 year", "yearly", "monthly". */
export function parseDurationMonths(text: string): number | undefined {
  const t = text.toLowerCase();
  if (/\b(month|monthly)\b/.test(t) && !/\d/.test(t)) return 1;
  const yearMatch = t.match(/(\d{1,2})\s*(year|años|yr)/);
  if (yearMatch) return parseInt(yearMatch[1]!, 10) * 12;
  const monthMatch = t.match(/(\d{1,3})\s*(month|mes)/);
  if (monthMatch) return parseInt(monthMatch[1]!, 10);
  if (/\byear(ly)?\b/.test(t)) return 12;
  if (/\b6\s*m\b/.test(t)) return 6;
  if (/\b3\s*m\b/.test(t)) return 3;
  const bare = t.match(/^\s*(\d{1,3})\s*$/);
  if (bare) {
    const n = parseInt(bare[1]!, 10);
    if (n >= 1 && n <= 60) return n;
  }
  return undefined;
}

/** Parse a budget in AED. Strips commas, ignores currency symbols. */
export function parseBudgetAed(text: string): number | undefined {
  const cleaned = text.replace(/,/g, '').toLowerCase();
  // "5k", "5,000", "AED 5000"
  const kMatch = cleaned.match(/(\d{1,3}(?:\.\d{1,2})?)\s*k/);
  if (kMatch) {
    const n = parseFloat(kMatch[1]!) * 1000;
    if (n >= 200 && n <= 200_000) return Math.round(n);
  }
  const m = cleaned.match(/(\d{3,7})/);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 10);
  if (n >= 200 && n <= 200_000) return n;
  return undefined;
}

/**
 * Parse a move-in date. Supports:
 *   - ISO-ish: 2026-06-15, 15/06/2026, 15-06-2026
 *   - Natural: today, tomorrow, next week, next month, in 2 weeks, "1st June"
 * Returns the resolved Date or undefined.
 */
export function parseMoveInDate(text: string, now: Date = new Date()): Date | undefined {
  const t = text.toLowerCase().trim();

  if (/\btoday\b/.test(t) || /\bahora\b/.test(t) || /\binmediato\b/.test(t)) return now;
  if (/\btomorrow\b/.test(t) || /\bmañana\b/.test(t)) return addDays(now, 1);
  if (/\bnext week\b/.test(t)) return addDays(now, 7);
  if (/\bnext month\b/.test(t)) return addDays(now, 30);
  if (/\bin two weeks\b/.test(t) || /\bin 2 weeks\b/.test(t)) return addDays(now, 14);
  const inDays = t.match(/in\s+(\d{1,2})\s+days?/);
  if (inDays) return addDays(now, parseInt(inDays[1]!, 10));
  const inWeeks = t.match(/in\s+(\d{1,2})\s+weeks?/);
  if (inWeeks) return addDays(now, parseInt(inWeeks[1]!, 10) * 7);

  // ISO yyyy-mm-dd
  const iso = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const d = new Date(`${iso[1]}-${pad(iso[2]!)}-${pad(iso[3]!)}T00:00:00Z`);
    if (!isNaN(d.getTime())) return d;
  }

  // dd/mm/yyyy or dd-mm-yyyy
  const dmY = t.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (dmY) {
    const d = new Date(`${dmY[3]}-${pad(dmY[2]!)}-${pad(dmY[1]!)}T00:00:00Z`);
    if (!isNaN(d.getTime())) return d;
  }

  // "1 June" / "June 1" / "1st June"
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  for (let i = 0; i < months.length; i++) {
    const month = months[i]!;
    const re1 = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${month}`);
    const re2 = new RegExp(`${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?`);
    const m = t.match(re1) ?? t.match(re2);
    if (m) {
      const day = parseInt(m[1]!, 10);
      const year = now.getUTCMonth() > i ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
      const d = new Date(Date.UTC(year, i, day));
      if (!isNaN(d.getTime())) return d;
    }
  }

  return undefined;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function pad(s: string): string {
  return s.padStart(2, '0');
}
