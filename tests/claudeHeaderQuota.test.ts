import { expect, spyOn, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { apiCallApi, authFilesApi } from '@/services/api';
import { CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { claudeUsageFromHeaders } from '@/features/quota/providers/claude/headerQuota';

const now = Date.parse('2026-10-29T14:30:00Z');
const reset = now / 1000 + 3600;
const observation = (at = now - 60_000, used = '0.22') => ({
  observed_at: new Date(at).toISOString(),
  signals: {
    'Anthropic-Ratelimit-Unified-5h-Utilization': used,
    'Anthropic-Ratelimit-Unified-5h-Reset': String(reset),
    'Anthropic-Ratelimit-Unified-7d-Utilization': '0.03',
    'Anthropic-Ratelimit-Unified-7d-Reset': String(reset + 86400),
  },
});

test('uses the newest inference observation and converts fractions to percent used', () => {
  expect(
    claudeUsageFromHeaders(
      { older: observation(now - 120_000, '0.18'), latest: observation() },
      now
    )
  ).toEqual({
    five_hour: { utilization: 22, resets_at: new Date(reset * 1000).toISOString() },
    seven_day: { utilization: 3, resets_at: new Date((reset + 86400) * 1000).toISOString() },
  });
});

test('keeps an old reading while its window has not reset (throttled login, no new requests)', () => {
  expect(
    claudeUsageFromHeaders({ model: observation(now - 90 * 60_000, '1.0') }, now)?.five_hour
  ).toEqual({
    utilization: 100,
    resets_at: new Date(reset * 1000).toISOString(),
  });
});

test('rejects missing or future observations and expired windows', () => {
  expect(claudeUsageFromHeaders(undefined, now)).toBeNull();
  expect(claudeUsageFromHeaders({ model: observation(now + 60_000) }, now)).toBeNull();
  const expired = observation();
  expired.signals['Anthropic-Ratelimit-Unified-5h-Reset'] = String(now / 1000 - 1);
  expired.signals['Anthropic-Ratelimit-Unified-7d-Utilization'] = 'invalid';
  expect(claudeUsageFromHeaders({ model: expired }, now)).toBeNull();
});

test('keeps over-limit utilization rather than dropping the exhausted window', () => {
  expect(
    claudeUsageFromHeaders({ model: observation(now - 1000, '1.01') }, now)?.five_hour
  ).toEqual({ utilization: 101, resets_at: new Date(reset * 1000).toISOString() });
});

test('uses the newest observation per window when another model omits a scoped limit', () => {
  const scoped = {
    ...observation(now - 120_000, '0.77'),
    signals: {
      ...observation().signals,
      'Anthropic-Ratelimit-Unified-7d_oi-Utilization': '0.05',
      'Anthropic-Ratelimit-Unified-7d_oi-Reset': String(reset + 86400),
    },
  };
  expect(claudeUsageFromHeaders({ scoped, latest: observation(now - 1000, '1.01') }, now)).toEqual({
    five_hour: { utilization: 101, resets_at: new Date(reset * 1000).toISOString() },
    seven_day: { utilization: 3, resets_at: new Date((reset + 86400) * 1000).toISOString() },
    seven_day_opus: { utilization: 5, resets_at: new Date((reset + 86400) * 1000).toISOString() },
  });
});

test('does not resurrect an older window or combine incomplete observations', () => {
  const latest = observation();
  latest.signals['Anthropic-Ratelimit-Unified-5h-Reset'] = String(now / 1000 - 1);
  expect(
    claudeUsageFromHeaders({ older: observation(now - 120_000), latest }, now)?.five_hour
  ).toBeUndefined();
  expect(
    claudeUsageFromHeaders(
      {
        older: observation(now - 120_000),
        latest: {
          observed_at: new Date(now - 1000).toISOString(),
          signals: {
            'anthropic-ratelimit-unified-5h-utilization': '0.5',
          },
        },
      },
      now
    )?.five_hour
  ).toBeUndefined();
});

test('the card uses fresh credential headers when the usage endpoint is throttled or scope-blocked', async () => {
  const file = { name: 'claude-test.json', authIndex: 'test-index' };
  const t = ((key: string) => key) as TFunction;
  const requests = spyOn(apiCallApi, 'request');
  const recent = observation(Date.now() - 1000);
  recent.signals['Anthropic-Ratelimit-Unified-5h-Reset'] = String(Date.now() / 1000 + 3600);
  recent.signals['Anthropic-Ratelimit-Unified-7d-Reset'] = String(Date.now() / 1000 + 86400);
  const credentials = spyOn(authFilesApi, 'list').mockResolvedValue({
    files: [
      {
        ...file,
        model_quotas: { model: recent },
      },
    ],
  });
  try {
    for (const statusCode of [429, 403]) {
      requests.mockResolvedValue({ statusCode, header: {}, body: null, bodyText: 'Unavailable' });
      const data = await CLAUDE_CONFIG.fetchQuota(file, t);
      expect(data.windows.map((window) => window.usedPercent)).toEqual([22, 3]);
    }
  } finally {
    requests.mockRestore();
    credentials.mockRestore();
  }
});

test('preserves a successful profile when usage falls back to inference headers', async () => {
  const file = { name: 'claude-test.json', authIndex: 'test-index' };
  const recent = observation(Date.now() - 1000);
  recent.signals['Anthropic-Ratelimit-Unified-5h-Reset'] = String(Date.now() / 1000 + 3600);
  recent.signals['Anthropic-Ratelimit-Unified-7d-Reset'] = String(Date.now() / 1000 + 86400);
  const requests = spyOn(apiCallApi, 'request').mockImplementation(async ({ url }) =>
    url.endsWith('/profile')
      ? { statusCode: 200, header: {}, body: { account: { has_claude_max: true } }, bodyText: '' }
      : { statusCode: 429, header: {}, body: null, bodyText: 'Unavailable' }
  );
  const credentials = spyOn(authFilesApi, 'list').mockResolvedValue({
    files: [{ ...file, model_quotas: { model: recent } }],
  });
  try {
    const data = await CLAUDE_CONFIG.fetchQuota(file, ((key: string) => key) as TFunction);
    expect(data.planType).toBe('plan_max');
    expect(data.windows.map((window) => window.usedPercent)).toEqual([22, 3]);
  } finally {
    requests.mockRestore();
    credentials.mockRestore();
  }
});

test('a login with a rejected refresh token says so instead of calling usage', async () => {
  const file = {
    name: 'claude-test.json',
    authIndex: 'test-index',
    status: 'error',
    statusMessage: 'invalid grant (retrying)',
  };
  const requests = spyOn(apiCallApi, 'request');
  try {
    await expect(
      CLAUDE_CONFIG.fetchQuota(file, ((key: string) => key) as TFunction)
    ).rejects.toThrow('claude_quota.login_expired');
    expect(requests).not.toHaveBeenCalled();
  } finally {
    requests.mockRestore();
  }
});
