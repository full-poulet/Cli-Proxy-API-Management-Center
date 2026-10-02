/**
 * Colour step for a remaining percentage — shared by QuotaMeter (card view,
 * Routing meters) and the Ledger's segments. Kept out of the component file so
 * it can be imported by React-free model code and tests.
 */

export const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
export const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;

export interface QuotaMeterThresholds {
  /** Remaining % at or above which the fill is green. */
  high: number;
  /** Remaining % at or above which the fill is amber; below is red. */
  medium: number;
}

export const QUOTA_METER_DEFAULT_THRESHOLDS: QuotaMeterThresholds = {
  high: QUOTA_PROGRESS_HIGH_THRESHOLD,
  medium: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
};

export type QuotaMeterLevel = 'high' | 'medium' | 'low' | 'unknown';

export const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/** `unknown` for null/NaN (draws nothing); otherwise one of the three steps. */
export function resolveQuotaMeterLevel(
  percent: number | null,
  thresholds: QuotaMeterThresholds = QUOTA_METER_DEFAULT_THRESHOLDS
): QuotaMeterLevel {
  if (percent === null || !Number.isFinite(percent)) return 'unknown';
  const normalized = clampPercent(percent);
  if (normalized >= thresholds.high) return 'high';
  if (normalized >= thresholds.medium) return 'medium';
  return 'low';
}
