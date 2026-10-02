/**
 * Routing payload served by the Fleet router at `<apiBase>/usage-api/routing`.
 *
 * The router ranks the proxy's OAuth logins by soonest weekly reset and writes
 * the ranking back as credential priorities. This is the normalized, camelCase
 * shape the Routing page renders; `services/api/routing.ts` parses the raw JSON.
 */

export type RoutingAccountState = 'active' | 'standby' | 'exhausted' | 'unknown' | 'disabled';

export interface RoutingWindow {
  id: string;
  label: string;
  /** True for the window the ranking is based on (7-day / weekly). */
  weekly: boolean;
  remainingPct: number | null;
  /** Instant the window resets, in ms; null when the reader had no reset time. */
  resetsAtMs: number | null;
}

export interface RoutingAccount {
  /** Auth file name — the same identity the Quota page uses for its cards. */
  name: string;
  authIndex: string | null;
  email: string | null;
  plan: string | null;
  disabled: boolean;
  unavailable: boolean;
  rank: number | null;
  priority: number | null;
  state: RoutingAccountState;
  reason: string;
  windows: RoutingWindow[];
  source: string | null;
  reportedAtMs: number | null;
  stale: boolean;
  error: string | null;
}

export interface RoutingProvider {
  id: string;
  label: string;
  accounts: RoutingAccount[];
}

export interface RoutingProxySettings {
  strategy: string | null;
  sessionAffinity: boolean;
  sessionAffinityTtl: string | null;
  sessionAffinitySubagents: boolean;
  reachable: boolean;
  error: string | null;
}

export interface RoutingEvent {
  atMs: number;
  provider: string | null;
  text: string;
}

export interface RoutingPayload {
  generatedAtMs: number | null;
  nextPollAtMs: number | null;
  /** Set by POST /refresh when the router answered from cache (≤ 1 refresh / 60 s). */
  throttled: boolean;
  proxy: RoutingProxySettings;
  providers: RoutingProvider[];
  /** Newest first. */
  events: RoutingEvent[];
}
