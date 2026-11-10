/**
 * Fleet router endpoints (`<apiBase>/usage-api/*`).
 *
 * Deliberately NOT routed through `apiClient`: that client prefixes
 * `/v8/management` and attaches the management key as a bearer token. The
 * router is a separate, unauthenticated local service and must never receive
 * the key. Raw snake_case JSON is normalized here so components only see
 * `RoutingPayload`.
 */

import type {
  RoutingAccount,
  RoutingAccountState,
  RoutingEvent,
  RoutingMode,
  RoutingPayload,
  RoutingProvider,
  RoutingProxySettings,
  RoutingWindow,
} from '@/types';
import { normalizeApiBase } from '@/utils/connection';

const USAGE_API_PREFIX = '/usage-api';
const FLEET_HEADER = 'X-Fleet-Usage';

const ROUTING_MODES: readonly RoutingMode[] = ['even', 'reset', 'manual'];

const ACCOUNT_STATES: readonly RoutingAccountState[] = [
  'active',
  'standby',
  'exhausted',
  'unknown',
  'disabled',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** Router timestamps are unix seconds; the UI works in ms like every other instant. */
const secondsToMs = (value: unknown): number | null => {
  const seconds = asNumber(value);
  return seconds === null ? null : seconds * 1000;
};

const normalizeWindow = (raw: unknown): RoutingWindow | null => {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (!id) return null;
  return {
    id,
    label: asString(raw.label) ?? id,
    weekly: asBoolean(raw.weekly),
    remainingPct: asNumber(raw.remaining_pct),
    resetsAtMs: secondsToMs(raw.resets_at),
    estimated: asBoolean(raw.estimated),
  };
};

const normalizeState = (value: unknown): RoutingAccountState =>
  ACCOUNT_STATES.find((state) => state === value) ?? 'unknown';

const normalizeAccount = (raw: unknown): RoutingAccount | null => {
  if (!isRecord(raw)) return null;
  const name = asString(raw.name);
  if (!name) return null;
  const authIndex = raw.auth_index;
  return {
    name,
    authIndex: typeof authIndex === 'number' ? String(authIndex) : asString(authIndex),
    email: asString(raw.email),
    plan: asString(raw.plan),
    disabled: asBoolean(raw.disabled),
    unavailable: asBoolean(raw.unavailable),
    rank: asNumber(raw.rank),
    priority: asNumber(raw.priority),
    state: normalizeState(raw.state),
    reason: asString(raw.reason) ?? '',
    windows: Array.isArray(raw.windows)
      ? raw.windows.map(normalizeWindow).filter((item): item is RoutingWindow => item !== null)
      : [],
    source: asString(raw.source),
    reportedAtMs: secondsToMs(raw.reported_at),
    stale: asBoolean(raw.stale),
    error: asString(raw.error),
  };
};

/** Older routers send no mode/order: that is the default "even drain" with no saved order. */
const normalizeMode = (value: unknown): RoutingMode =>
  ROUTING_MODES.find((mode) => mode === value) ?? 'even';

const normalizeOrder = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asString).filter((item): item is string => item !== null) : [];

const normalizeProvider = (raw: unknown): RoutingProvider | null => {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (!id) return null;
  return {
    id,
    label: asString(raw.label) ?? id,
    mode: normalizeMode(raw.mode),
    order: normalizeOrder(raw.order),
    accounts: Array.isArray(raw.accounts)
      ? raw.accounts.map(normalizeAccount).filter((item): item is RoutingAccount => item !== null)
      : [],
  };
};

const normalizeProxy = (raw: unknown): RoutingProxySettings => {
  const source = isRecord(raw) ? raw : {};
  return {
    strategy: asString(source.strategy),
    sessionAffinity: asBoolean(source.session_affinity),
    sessionAffinityTtl: asString(source.session_affinity_ttl),
    sessionAffinitySubagents: asBoolean(source.session_affinity_subagents),
    reachable: asBoolean(source.reachable, true),
    error: asString(source.error),
  };
};

const normalizeEvent = (raw: unknown): RoutingEvent | null => {
  if (!isRecord(raw)) return null;
  const atMs = secondsToMs(raw.at);
  const text = asString(raw.text);
  if (atMs === null || !text) return null;
  return { atMs, provider: asString(raw.provider), text };
};

/** Parse the router's JSON into the UI model; tolerant of missing fields. */
export function normalizeRoutingPayload(raw: unknown): RoutingPayload {
  const source = isRecord(raw) ? raw : {};
  const events = Array.isArray(source.events)
    ? source.events.map(normalizeEvent).filter((item): item is RoutingEvent => item !== null)
    : [];
  return {
    generatedAtMs: secondsToMs(source.generated_at),
    nextPollAtMs: secondsToMs(source.next_poll_at),
    throttled: asBoolean(source.throttled),
    proxy: normalizeProxy(source.proxy),
    providers: Array.isArray(source.providers)
      ? source.providers
          .map(normalizeProvider)
          .filter((item): item is RoutingProvider => item !== null)
      : [],
    // The router already sends newest first; sort defensively so the UI never relies on it.
    events: events.sort((a, b) => b.atMs - a.atMs),
  };
}

/** `<apiBase>/usage-api` — the router sits behind the same origin as the proxy. */
export function resolveRoutingBase(apiBase: string): string {
  const base = normalizeApiBase(apiBase);
  return base ? `${base}${USAGE_API_PREFIX}` : '';
}

async function requestRouting(
  apiBase: string,
  path: '/routing' | '/refresh' | '/preferences',
  init: RequestInit,
  signal?: AbortSignal
): Promise<RoutingPayload> {
  const base = resolveRoutingBase(apiBase);
  if (!base) throw new Error('Routing API base is not configured');
  const response = await fetch(`${base}${path}`, {
    ...init,
    // Same-origin only: the router has no CORS headers and must not see the management key.
    credentials: 'omit',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(`Routing API responded with HTTP ${response.status}`);
  }
  return normalizeRoutingPayload(await response.json());
}

export const routingApi = {
  /** Current ranking, settings and recent events. */
  getRouting: (apiBase: string, signal?: AbortSignal) =>
    requestRouting(apiBase, '/routing', { method: 'GET' }, signal),

  /** Ask the router to re-poll and re-decide now; the reply is the same payload. */
  refresh: (apiBase: string, signal?: AbortSignal) =>
    requestRouting(
      apiBase,
      '/refresh',
      { method: 'POST', headers: { [FLEET_HEADER]: 'refresh' } },
      signal
    ),

  /**
   * Save a provider's ordering mode and manual order; the reply is the full
   * payload, already re-ranked (not subject to the refresh throttle). Send the
   * current order along with `even` / `reset` so the manual list survives.
   */
  savePreference: (
    apiBase: string,
    provider: string,
    mode: RoutingMode,
    order: string[],
    signal?: AbortSignal
  ) =>
    requestRouting(
      apiBase,
      '/preferences',
      {
        method: 'POST',
        headers: { [FLEET_HEADER]: 'preferences', 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, mode, order }),
      },
      signal
    ),
};
