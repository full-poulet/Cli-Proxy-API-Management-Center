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

test('rejects old, missing or future observations and expired windows', () => {
  expect(claudeUsageFromHeaders(undefined, now)).toBeNull();
  expect(claudeUsageFromHeaders({ model: observation(now - 16 * 60_000) }, now)).toBeNull();
  expect(claudeUsageFromHeaders({ model: observation(now + 60_000) }, now)).toBeNull();
  const expired = observation();
  expired.signals['Anthropic-Ratelimit-Unified-5h-Reset'] = String(now / 1000 - 1);
  expired.signals['Anthropic-Ratelimit-Unified-7d-Utilization'] = 'invalid';
  expect(claudeUsageFromHeaders({ model: expired }, now)).toBeNull();
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
