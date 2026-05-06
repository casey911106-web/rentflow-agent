/**
 * RentFlow Agent brand tokens. Mirrored from the brand identity manual.
 * UI packages (web/mobile) consume these as Tailwind theme values.
 */

export const brandColors = {
  primaryNavy: '#082B5F',
  deepNavy: '#061D3F',
  primaryTeal: '#00A7A5',
  emeraldTeal: '#00B894',
  lightTeal: '#E6FAF8',
  white: '#FFFFFF',
  offWhite: '#F8FAFC',
  lightGray: '#E5E7EB',
  mediumGray: '#64748B',
  darkGray: '#334155',
  nearBlack: '#0F172A',
  success: '#00B894',
  warning: '#F59E0B',
  danger: '#DC2626',
  info: '#00A7A5',
  purple: '#7C3AED',
} as const;

export const brandRadii = {
  sm: '8px',
  md: '12px',
  lg: '16px',
  full: '999px',
} as const;

export const brandShadows = {
  card: '0 4px 16px rgba(15, 23, 42, 0.06)',
  modal: '0 20px 40px rgba(15, 23, 42, 0.16)',
} as const;

export type BrandColor = keyof typeof brandColors;
