import { brandColors } from './brand';

export type ScoreBand = 'excellent' | 'good' | 'needs_attention' | 'risky';

export interface ScoreBandSpec {
  band: ScoreBand;
  label: string;
  color: string;
  min: number;
  max: number;
}

export const SCORE_BANDS: readonly ScoreBandSpec[] = [
  { band: 'excellent',       label: 'Excellent',       color: brandColors.emeraldTeal, min: 80, max: 100 },
  { band: 'good',            label: 'Good',            color: brandColors.primaryTeal, min: 60, max: 79 },
  { band: 'needs_attention', label: 'Needs attention', color: brandColors.warning,     min: 40, max: 59 },
  { band: 'risky',           label: 'Risky',           color: brandColors.danger,      min: 0,  max: 39 },
] as const;

export function bandFor(score: number): ScoreBandSpec {
  return (
    SCORE_BANDS.find((b) => score >= b.min && score <= b.max) ?? SCORE_BANDS[SCORE_BANDS.length - 1]!
  );
}
