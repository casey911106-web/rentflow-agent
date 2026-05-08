/**
 * Pricing helpers shared by API + web. Centralised so the same numbers
 * appear in (a) AI agent suggestions, (b) viewing confirmations, (c) field
 * agent reminders, (d) marketplace pages — without drifting between files.
 *
 * Commission policy below is the company's standard: paid once on close,
 * varies by property type. Rent and deposit come straight from the catalog;
 * the deposit fallback (= 1 month) only kicks in when the catalog has no
 * explicit value.
 */

export type PropertyTypeKey =
  | 'studio'
  | 'one_bedroom'
  | 'two_bedroom'
  | 'three_bedroom'
  | 'villa'
  | 'master_room'
  | 'shared_room'
  | 'partition'
  | 'bed_space'
  | 'other';

export interface PriceFields {
  type: string;
  priceAed: number | string | { toString(): string } | null;
  depositAed: number | string | { toString(): string } | null;
}

/**
 * Commission paid once on deal close, in AED. Bedrooms drive the tier.
 * Match the tiers documented in the AI prompt rules so on-chat numbers and
 * confirmation numbers never diverge.
 */
export function commissionAed(propertyType: string): number {
  switch (propertyType) {
    case 'studio':
    case 'one_bedroom':
      return 1000;
    case 'two_bedroom':
    case 'three_bedroom':
      return 2000;
    case 'villa':
      return 3000;
    case 'master_room':
    case 'shared_room':
    case 'partition':
    case 'bed_space':
      return 500;
    default:
      return 1000;
  }
}

function toNumber(v: PriceFields['priceAed']): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

function fmtAed(n: number): string {
  return `AED ${n.toLocaleString('en-US')}`;
}

/**
 * Build the standard 3-line price block in the company's voice.
 * Pass `language` to localise; defaults to English.
 *
 *   Rent: AED 6,500/month
 *   Refundable deposit: AED 6,500
 *   Commission (one-time, on close): AED 1,000
 */
export function formatPriceLines(
  property: PriceFields,
  language: 'en' | 'es' = 'en',
): string {
  const rent = toNumber(property.priceAed);
  const depositRaw = toNumber(property.depositAed);
  const deposit = depositRaw && depositRaw > 0 ? depositRaw : rent;
  const commission = commissionAed(property.type);

  if (language === 'es') {
    return [
      `Renta: ${rent != null ? `${fmtAed(rent)}/mes` : 'a confirmar'}`,
      `Depósito reembolsable: ${deposit != null ? fmtAed(deposit) : 'a confirmar'}`,
      `Comisión (única, al cerrar): ${fmtAed(commission)}`,
    ].join('\n');
  }
  return [
    `Rent: ${rent != null ? `${fmtAed(rent)}/month` : 'TBC'}`,
    `Refundable deposit: ${deposit != null ? fmtAed(deposit) : 'TBC'}`,
    `Commission (one-time, on close): ${fmtAed(commission)}`,
  ].join('\n');
}
