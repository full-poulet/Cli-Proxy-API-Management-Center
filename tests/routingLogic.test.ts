/**
 * Routing page logic: payload normalization, countdown labels and rank chips.
 */

import { describe, expect, test } from 'bun:test';
import { normalizeRoutingPayload, resolveRoutingBase } from '@/services/api/routing';
import {
  buildRankIndex,
  countAccounts,
  formatCountdown,
  resolveRankBadge,
} from '@/features/routing/logic';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

const NOW = new Date(2026, 9, 2, 12, 0, 0).getTime();

const RAW = {
  generated_at: 1_790_956_569,
  throttled: false,
  proxy: {
    strategy: 'fill-first',
    session_affinity: true,
    session_affinity_ttl: '1h',
    reachable: true,
  },
  providers: [
    {
      id: 'claude',
      label: 'Claude',
      accounts: [
        {
          name: 'claude-a.json',
          email: 'a@example.ch',
          rank: 1,
          priority: 100,
          state: 'active',
          reason: 'soonest',
          windows: [
            {
              id: 'seven_day',
              label: '7-day limit',
              weekly: true,
              remaining_pct: 68,
              resets_at: 1_791_190_800,
            },
          ],
        },
        { name: 'claude-b.json', rank: 2, state: 'standby', windows: 'not-a-list' },
        { name: 'claude-c.json', rank: null, state: 'exhausted' },
        { name: 'claude-d.json', state: 'something-new' },
      ],
    },
  ],
  events: [
    { at: 100, provider: 'claude', text: 'older' },
    { at: 200, provider: 'claude', text: 'newer' },
    { at: 300 }, // no text → dropped
  ],
};

describe('normalizeRoutingPayload', () => {
  test('converts unix seconds to ms and tolerates missing or malformed fields', () => {
    const payload = normalizeRoutingPayload(RAW);
    expect(payload.generatedAtMs).toBe(1_790_956_569_000);
    expect(payload.proxy.sessionAffinityTtl).toBe('1h');
    expect(payload.proxy.reachable).toBe(true);
    const [a, b, , d] = payload.providers[0].accounts;
    expect(a.windows[0].resetsAtMs).toBe(1_791_190_800_000);
    expect(b.windows).toEqual([]);
    expect(b.email).toBeNull();
    expect(d.state).toBe('unknown');
  });

  test('orders events newest first and drops entries without text', () => {
    const payload = normalizeRoutingPayload(RAW);
    expect(payload.events.map((event) => event.text)).toEqual(['newer', 'older']);
  });

  test('carries the estimated flag and defaults it to false', () => {
    const payload = normalizeRoutingPayload({
      providers: [
        {
          id: 'claude',
          accounts: [
            {
              name: 'a.json',
              windows: [
                { id: 'seven_day', resets_at: 1, estimated: true },
                { id: 'five_hour', resets_at: 2 },
              ],
            },
          ],
        },
      ],
    });
    expect(payload.providers[0].accounts[0].windows.map((w) => w.estimated)).toEqual([true, false]);
  });

  test('keeps a proxy error even when the proxy is reachable (failed priority update)', () => {
    expect(
      normalizeRoutingPayload({ proxy: { reachable: true, error: 'PATCH 500' } }).proxy
    ).toMatchObject({ reachable: true, error: 'PATCH 500' });
  });

  test('defaults reachable to true only when the proxy block is absent', () => {
    expect(normalizeRoutingPayload({}).proxy.reachable).toBe(true);
    expect(
      normalizeRoutingPayload({ proxy: { reachable: false, error: 'down' } }).proxy
    ).toMatchObject({ reachable: false, error: 'down' });
  });
});

describe('resolveRoutingBase', () => {
  test('appends /usage-api to the normalized proxy origin', () => {
    expect(resolveRoutingBase('127.0.0.1:8317/')).toBe('http://127.0.0.1:8317/usage-api');
    expect(resolveRoutingBase('https://bb1.example.ts.net:8444/v8/management')).toBe(
      'https://bb1.example.ts.net:8444/usage-api'
    );
    expect(resolveRoutingBase('')).toBe('');
  });
});

describe('formatCountdown', () => {
  test('uses at most two units and truncates', () => {
    expect(formatCountdown(NOW + DAY_MS + 4 * HOUR_MS + 59 * MINUTE_MS, NOW)).toBe('1 d 4 h');
    expect(formatCountdown(NOW + 2 * DAY_MS, NOW)).toBe('2 d');
    expect(formatCountdown(NOW + 3 * HOUR_MS + 11 * MINUTE_MS, NOW)).toBe('3 h 11 m');
    expect(formatCountdown(NOW + 12 * MINUTE_MS, NOW)).toBe('12 m');
    expect(formatCountdown(NOW + 20_000, NOW)).toBe('1 m');
  });

  test('returns null for instants in the past', () => {
    expect(formatCountdown(NOW - 1, NOW)).toBeNull();
  });
});

describe('rank badges and chips', () => {
  test('ranked states carry their rank, the rest do not', () => {
    expect(resolveRankBadge('active', 1)).toEqual({ key: 'next_up', rank: 1, tone: 'active' });
    expect(resolveRankBadge('standby', 2)).toEqual({ key: 'standby', rank: 2, tone: 'standby' });
    expect(resolveRankBadge('exhausted', 7)).toEqual({
      key: 'exhausted',
      rank: null,
      tone: 'exhausted',
    });
    expect(resolveRankBadge('unknown', null).key).toBe('unknown');
  });

  test('buildRankIndex only lists active and standby logins by file name', () => {
    const payload = normalizeRoutingPayload(RAW);
    const index = buildRankIndex(payload);
    expect([...index.keys()]).toEqual(['claude-a.json', 'claude-b.json']);
    expect(index.get('claude-a.json')).toEqual({ rank: 1, state: 'active' });
    expect(buildRankIndex(null).size).toBe(0);
    expect(countAccounts(payload)).toBe(4);
  });
});
