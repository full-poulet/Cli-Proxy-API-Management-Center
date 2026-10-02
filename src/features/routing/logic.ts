/**
 * Pure helpers for the Routing page — clock-free so they are directly testable.
 */

import type { RoutingAccount, RoutingAccountState, RoutingPayload } from '@/types';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

/**
 * Compact countdown for a reset instant: `1 d 4 h`, `4 h 12 m`, `12 m`.
 * Past instants return null so the caller can say "now" instead of "-3 m".
 */
export function formatCountdown(targetMs: number, nowMs: number): string | null {
  const delta = targetMs - nowMs;
  if (delta <= 0) return null;
  const days = Math.floor(delta / DAY_MS);
  const hours = Math.floor((delta % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((delta % HOUR_MS) / MINUTE_MS);
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} m` : `${hours} h`;
  return `${Math.max(1, minutes)} m`;
}

/**
 * Wall-clock half of a reset label: `Sat 13:00` when the instant is within a
 * week, otherwise `10-14 13:00` so the weekday cannot be mistaken for the wrong week.
 */
export function formatResetClock(targetMs: number, nowMs: number, locale?: string): string {
  const withinWeek = Math.abs(targetMs - nowMs) < 7 * DAY_MS;
  const date = new Date(targetMs);
  try {
    return date.toLocaleString(
      locale,
      withinWeek
        ? { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
        : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    );
  } catch {
    return date.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
}

/** Display name for an account row: email first, file name as fallback. */
export function accountDisplayName(account: Pick<RoutingAccount, 'email' | 'name'>): string {
  return account.email?.trim() || account.name;
}

export type RankBadge = {
  /** i18n key under `routing.badge_*`. */
  key: 'next_up' | 'standby' | 'exhausted' | 'unknown' | 'disabled';
  /** Rank to interpolate (`#1`, `#2`); null for states without a rank. */
  rank: number | null;
  tone: 'active' | 'standby' | 'exhausted' | 'muted';
};

/** Badge text + tone for a row, derived from state (rank only decorates ranked states). */
export function resolveRankBadge(state: RoutingAccountState, rank: number | null): RankBadge {
  switch (state) {
    case 'active':
      return { key: 'next_up', rank: rank ?? 1, tone: 'active' };
    case 'standby':
      return { key: 'standby', rank, tone: 'standby' };
    case 'exhausted':
      return { key: 'exhausted', rank: null, tone: 'exhausted' };
    case 'disabled':
      return { key: 'disabled', rank: null, tone: 'muted' };
    default:
      return { key: 'unknown', rank: null, tone: 'muted' };
  }
}

export type RoutingRankChip = { rank: number; state: 'active' | 'standby' };

/**
 * Auth-file name → rank chip for the Quota page. Only ranked logins (active /
 * standby) get a chip; exhausted, unknown and disabled rows are left alone.
 */
export function buildRankIndex(payload: RoutingPayload | null): Map<string, RoutingRankChip> {
  const index = new Map<string, RoutingRankChip>();
  if (!payload) return index;
  payload.providers.forEach((provider) => {
    provider.accounts.forEach((account) => {
      if (account.rank === null) return;
      if (account.state !== 'active' && account.state !== 'standby') return;
      index.set(account.name, { rank: account.rank, state: account.state });
    });
  });
  return index;
}

/** Total number of logins across providers, for the header meta line. */
export function countAccounts(payload: RoutingPayload | null): number {
  return payload?.providers.reduce((sum, provider) => sum + provider.accounts.length, 0) ?? 0;
}
