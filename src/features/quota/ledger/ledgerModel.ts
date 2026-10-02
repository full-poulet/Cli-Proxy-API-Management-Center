/**
 * Ledger layout model: one flat shape per credential, read structurally from
 * the provider-specific quota states, plus the per-provider roll-up for the
 * summary cards.
 *
 * Pure and React-free (`t` and `nowMs` are passed in) so tests/quotaLedger.test.ts
 * can pin the arithmetic — the remaining-sum, the segment colours and the
 * soonest reset are the numbers people glance at before picking a login.
 */

import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import { formatQuotaResetTime, parseIsoToMs, resolveResetMs } from '@/utils/quota';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import { resolveCodexPlanLabel } from '../providers/codex/planLabel';
import { resolveQuotaMeterLevel, type QuotaMeterThresholds } from '../meterLevel';

/** Theo's steps: green ≥ 75, amber 40–74, red < 40 (remaining %). */
export const LEDGER_THRESHOLDS: QuotaMeterThresholds = { high: 75, medium: 40 };

export type LedgerLevel = 'high' | 'medium' | 'low' | 'empty' | 'unknown';

/** Colour step for a remaining percentage, with `empty` split out for 0 (drawn grey). */
export function resolveLedgerLevel(remaining: number | null): LedgerLevel {
  if (remaining === null || !Number.isFinite(remaining)) return 'unknown';
  if (remaining <= 0) return 'empty';
  return resolveQuotaMeterLevel(remaining, LEDGER_THRESHOLDS) as Exclude<
    LedgerLevel,
    'empty' | 'unknown'
  >;
}

export const CLAUDE_FABLE_WINDOW_ID = 'seven-day-fable';
export const CLAUDE_SEVEN_DAY_WINDOW_ID = 'seven-day';

export interface LedgerWindow {
  id: string;
  label: string;
  /** Remaining %, 100 = untouched; null when the provider reported no number. */
  remainingPct: number | null;
  resetAtMs: number | null;
  /** Absolute label baked at fetch time, used when the instant cannot be reproduced. */
  resetLabel: string | null;
  /**
   * Claude: when the model-scoped Fable window exists, the general 7-day window
   * and the other per-model weeklies (Opus, Sonnet, …) are secondary — dimmed
   * and hidden until "Show", so the default row reads Fable / 5-hour.
   */
  secondary: boolean;
}

export interface LedgerCredit {
  id: string;
  expiresAtMs: number | null;
  expiresLabel: string;
}

export interface LedgerCredential {
  entry: QuotaFileEntry;
  status: QuotaCardState['status'];
  /** The store entry this was read from; identity doubles as the refresh token for side reads. */
  source: QuotaCardState | undefined;
  error?: string;
  errorStatus?: number;
  /** Second line under the file name ("Max", "Pro 20x"). */
  planLabel: string | null;
  /** Codex subscription renewal, shown beside the plan. */
  renewalMs: number | null;
  windows: LedgerWindow[];
  /** The window the provider summary is built from; null until loaded. */
  primaryWindowId: string | null;
  /** Codex manual reset credits. */
  creditsAvailable: number | null;
  credits: LedgerCredit[];
}

const clampRemaining = (used: number | null | undefined): number | null =>
  used === null || used === undefined || !Number.isFinite(used)
    ? null
    : Math.max(0, Math.min(100, 100 - Math.max(0, Math.min(100, used))));

const usableMs = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/* ---------- per-provider readers ---------- */

const CLAUDE_ORDER = [CLAUDE_FABLE_WINDOW_ID, 'five-hour', CLAUDE_SEVEN_DAY_WINDOW_ID];

function readClaude(quota: ClaudeQuotaState, t: TFunction) {
  const hasFable = quota.windows.some((window) => window.id === CLAUDE_FABLE_WINDOW_ID);
  const windows: LedgerWindow[] = quota.windows
    .map((window) => ({
      id: window.id,
      label: window.labelKey ? t(window.labelKey) : window.label,
      remainingPct: clampRemaining(window.usedPercent),
      resetAtMs: usableMs(window.resetAtMs),
      resetLabel: window.resetLabel,
      secondary: hasFable && window.id !== CLAUDE_FABLE_WINDOW_ID && window.id !== 'five-hour',
    }))
    .sort((a, b) => {
      const ai = CLAUDE_ORDER.indexOf(a.id);
      const bi = CLAUDE_ORDER.indexOf(b.id);
      return (ai === -1 ? CLAUDE_ORDER.length : ai) - (bi === -1 ? CLAUDE_ORDER.length : bi);
    });
  const primary = hasFable
    ? CLAUDE_FABLE_WINDOW_ID
    : windows.some((window) => window.id === CLAUDE_SEVEN_DAY_WINDOW_ID)
      ? CLAUDE_SEVEN_DAY_WINDOW_ID
      : (windows[0]?.id ?? null);
  return {
    windows,
    primaryWindowId: primary,
    planLabel: quota.planType ? t(`claude_quota.${quota.planType}`) : null,
  };
}

function readCodex(quota: CodexQuotaState, t: TFunction) {
  const windows: LedgerWindow[] = quota.windows.map((window) => ({
    id: window.id,
    label: window.labelKey
      ? t(window.labelKey, window.labelParams as Record<string, string | number>)
      : window.label,
    remainingPct: clampRemaining(window.usedPercent),
    resetAtMs: usableMs(window.resetAtMs),
    resetLabel: window.resetLabel,
    secondary: false,
  }));
  // Weekly (or the Team monthly) leads; the 5-hour window follows it.
  const rank = (id: string) =>
    id === 'weekly' || id === 'monthly' ? 0 : id === 'five-hour' ? 1 : 2;
  windows.sort((a, b) => rank(a.id) - rank(b.id));
  const primary =
    windows.find((window) => window.id === 'weekly' || window.id === 'monthly')?.id ??
    windows[0]?.id ??
    null;
  const credits: LedgerCredit[] = (quota.rateLimitResetCredits ?? []).map((credit, index) => ({
    id: credit.id || `${credit.expiresAt}-${index}`,
    expiresAtMs: parseIsoToMs(credit.expiresAt),
    expiresLabel: credit.expiresAt,
  }));
  return {
    windows,
    primaryWindowId: primary,
    planLabel: resolveCodexPlanLabel(t, quota.planType),
    renewalMs: resolveResetMs([quota.subscriptionActiveUntil]),
    creditsAvailable: quota.rateLimitResetCreditsAvailableCount ?? null,
    credits,
  };
}

function readAntigravity(quota: AntigravityQuotaState) {
  const windows: LedgerWindow[] = quota.groups.flatMap((group) =>
    group.buckets.map((bucket) => ({
      id: `${group.id}:${bucket.id}`,
      label: bucket.label,
      remainingPct: Number.isFinite(bucket.remainingFraction)
        ? Math.max(0, Math.min(100, Math.round(bucket.remainingFraction * 100)))
        : null,
      resetAtMs: usableMs(bucket.resetAtMs),
      resetLabel: null,
      secondary: false,
    }))
  );
  const longest = quota.groups
    .flatMap((group) => group.buckets.map((bucket) => ({ group, bucket })))
    .sort((a, b) => (b.bucket.periodHours ?? 0) - (a.bucket.periodHours ?? 0))[0];
  return {
    windows,
    primaryWindowId: longest ? `${longest.group.id}:${longest.bucket.id}` : null,
    planLabel: quota.subscription?.tierName ?? quota.subscription?.plan ?? null,
  };
}

function readKimi(quota: KimiQuotaState, t: TFunction) {
  const windows: LedgerWindow[] = quota.rows.map((row) => {
    const remaining =
      row.limit > 0
        ? Math.max(0, Math.min(100, Math.round(((row.limit - row.used) / row.limit) * 100)))
        : row.used > 0
          ? 0
          : null;
    return {
      id: row.id,
      label: row.labelKey
        ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
        : (row.label ?? row.id),
      remainingPct: remaining,
      resetAtMs: usableMs(row.resetAtMs),
      resetLabel: null,
      secondary: false,
    };
  });
  const longest = [...quota.rows].sort((a, b) => (b.periodHours ?? 0) - (a.periodHours ?? 0))[0];
  return { windows, primaryWindowId: longest?.id ?? windows[0]?.id ?? null, planLabel: null };
}

function readXai(quota: XaiQuotaState, t: TFunction) {
  const billing = quota.billing;
  if (!billing) return { windows: [], primaryWindowId: null, planLabel: null };
  const weekly = billing.periodType === 'weekly';
  const windows: LedgerWindow[] = [
    {
      id: weekly ? 'weekly' : 'monthly',
      label: t(weekly ? 'xai_quota.weekly_limit' : 'xai_quota.monthly_credits'),
      remainingPct: clampRemaining(billing.usedPercent),
      resetAtMs: usableMs(billing.resetAtMs),
      resetLabel: billing.periodEnd ? formatQuotaResetTime(billing.periodEnd) : null,
      secondary: false,
    },
  ];
  return { windows, primaryWindowId: windows[0].id, planLabel: billing.planLabel ?? null };
}

function readDevin(quota: DevinQuotaState, t: TFunction) {
  const windows: LedgerWindow[] = quota.windows.map((window) => ({
    id: window.id,
    label: t(`devin_quota.${window.id}`),
    remainingPct:
      window.remainingPercent === null ? null : Math.max(0, Math.min(100, window.remainingPercent)),
    resetAtMs: usableMs(window.resetAtMs),
    resetLabel: null,
    secondary: false,
  }));
  const primary = windows.find((window) => window.id === 'weekly')?.id ?? windows[0]?.id ?? null;
  return { windows, primaryWindowId: primary, planLabel: quota.plan };
}

function readMeta(quota: MetaQuotaState, t: TFunction) {
  const data = quota.data;
  if (!data) return { windows: [], primaryWindowId: null, planLabel: null };
  const windows: LedgerWindow[] = data.windows.map((window) => ({
    id: window.id,
    label:
      window.id === 'window' && window.durationMinutes
        ? t('meta_quota.window_duration', { minutes: window.durationMinutes })
        : t(`meta_quota.${window.id}`),
    remainingPct: clampRemaining(window.usedPercent),
    resetAtMs: window.resetAt === undefined ? null : window.resetAt * 1000,
    resetLabel: null,
    secondary: false,
  }));
  const primary = windows.find((window) => window.id === 'weekly')?.id ?? windows[0]?.id ?? null;
  return { windows, primaryWindowId: primary, planLabel: data.planName ?? null };
}

/** Flatten one credential's provider state into the ledger shape. */
export function buildLedgerCredential(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  t: TFunction
): LedgerCredential {
  const base: LedgerCredential = {
    entry,
    status: quota?.status ?? 'idle',
    source: quota,
    error: quota?.error,
    errorStatus: quota?.errorStatus,
    planLabel: null,
    renewalMs: null,
    windows: [],
    primaryWindowId: null,
    creditsAvailable: null,
    credits: [],
  };
  if (!quota || quota.status !== 'success') return base;

  switch (entry.type) {
    case 'claude':
      return { ...base, ...readClaude(quota as ClaudeQuotaState, t) };
    case 'codex':
      return { ...base, ...readCodex(quota as CodexQuotaState, t) };
    case 'antigravity':
      return { ...base, ...readAntigravity(quota as AntigravityQuotaState) };
    case 'kimi':
      return { ...base, ...readKimi(quota as KimiQuotaState, t) };
    case 'xai':
      return { ...base, ...readXai(quota as XaiQuotaState, t) };
    case 'devin':
      return { ...base, ...readDevin(quota as DevinQuotaState, t) };
    case 'meta':
      return { ...base, ...readMeta(quota as MetaQuotaState, t) };
    default:
      return base;
  }
}

export const primaryWindow = (credential: LedgerCredential): LedgerWindow | null =>
  credential.windows.find((window) => window.id === credential.primaryWindowId) ?? null;

/* ---------- provider summary ---------- */

export interface LedgerSegment {
  key: string;
  level: LedgerLevel;
  remainingPct: number | null;
}

export interface LedgerProviderSummary {
  type: QuotaProviderType;
  credentialCount: number;
  loadedCount: number;
  /** Label of the window the big number is built from ("7-day Fable 5"). */
  primaryLabel: string | null;
  /** Sum of remaining % over loaded credentials; null when nothing is loaded. */
  remainingSum: number | null;
  /** credentials × 100. */
  capacity: number;
  /** One per credential, in row order; unloaded ones are `unknown`. */
  segments: LedgerSegment[];
  /** Soonest upcoming reset among the primary windows. */
  soonestResetMs: number | null;
  /** Claude only: the general 7-day sum when the model-scoped window leads. */
  secondary: { label: string; remainingSum: number } | null;
}

/** Window label the summary falls back to before any credential of that provider has loaded. */
const DEFAULT_PRIMARY_LABEL_KEY: Partial<Record<QuotaProviderType, string>> = {
  claude: 'claude_quota.seven_day',
  codex: 'codex_quota.secondary_window',
  xai: 'xai_quota.weekly_limit',
  devin: 'devin_quota.weekly',
  meta: 'meta_quota.weekly',
};

export function summarizeProvider(
  type: QuotaProviderType,
  credentials: readonly LedgerCredential[],
  nowMs: number,
  t: TFunction
): LedgerProviderSummary {
  let loadedCount = 0;
  let remainingSum: number | null = null;
  let soonest: number | null = null;
  let primaryLabel: string | null = null;
  let secondarySum: number | null = null;
  let secondaryLabel: string | null = null;

  const segments: LedgerSegment[] = credentials.map((credential) => {
    const key = credential.entry.file.name;
    if (credential.status !== 'success') return { key, level: 'unknown', remainingPct: null };
    loadedCount += 1;
    const window = primaryWindow(credential);
    const remaining = window?.remainingPct ?? null;
    if (window && primaryLabel === null) primaryLabel = window.label;
    if (remaining !== null) remainingSum = (remainingSum ?? 0) + remaining;
    if (window?.resetAtMs !== null && window?.resetAtMs !== undefined && window.resetAtMs > nowMs) {
      soonest = soonest === null ? window.resetAtMs : Math.min(soonest, window.resetAtMs);
    }
    const general = credential.windows.find(
      (item) => item.secondary && item.id === CLAUDE_SEVEN_DAY_WINDOW_ID
    );
    if (general && general.remainingPct !== null) {
      secondarySum = (secondarySum ?? 0) + general.remainingPct;
      secondaryLabel = general.label;
    }
    return { key, level: resolveLedgerLevel(remaining), remainingPct: remaining };
  });

  const fallbackKey = DEFAULT_PRIMARY_LABEL_KEY[type];
  return {
    type,
    credentialCount: credentials.length,
    loadedCount,
    primaryLabel: primaryLabel ?? (fallbackKey ? t(fallbackKey) : null),
    remainingSum: remainingSum === null ? null : Math.round(remainingSum),
    capacity: credentials.length * 100,
    segments,
    soonestResetMs: soonest,
    secondary:
      secondarySum !== null && secondaryLabel !== null
        ? { label: secondaryLabel, remainingSum: Math.round(secondarySum) }
        : null,
  };
}

/** Whether any loaded Claude credential in the group carries the model-scoped window. */
export const hasSecondaryColumn = (credentials: readonly LedgerCredential[]): boolean =>
  credentials.some((credential) => credential.windows.some((window) => window.secondary));

/** Group ledger credentials by provider, keeping the incoming (sorted) order inside each group. */
export function groupByProvider(
  credentials: readonly LedgerCredential[],
  order: readonly QuotaProviderType[]
): { type: QuotaProviderType; credentials: LedgerCredential[] }[] {
  const groups = new Map<QuotaProviderType, LedgerCredential[]>();
  credentials.forEach((credential) => {
    const list = groups.get(credential.entry.type) ?? [];
    list.push(credential);
    groups.set(credential.entry.type, list);
  });
  return order
    .filter((type) => groups.has(type))
    .map((type) => ({ type, credentials: groups.get(type) ?? [] }));
}
