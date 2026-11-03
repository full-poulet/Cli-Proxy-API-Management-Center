import type { ClaudeUsagePayload } from '@/types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reuse limits observed on this credential's real inference responses.
 * A reading stays valid until its window resets: a throttled login gets no new
 * requests (so no fresh headers) until then, and its last reading is the truth.
 */
export function claudeUsageFromHeaders(
  modelQuotas: unknown,
  now = Date.now()
): ClaudeUsagePayload | null {
  if (!isRecord(modelQuotas)) return null;
  const observations = Object.values(modelQuotas)
    .filter(isRecord)
    .map((item) => ({ item, at: Date.parse(String(item.observed_at ?? '')) }))
    .filter(({ at }) => Number.isFinite(at) && at <= now)
    .sort((a, b) => b.at - a.at)
    .flatMap(({ item }) =>
      isRecord(item.signals)
        ? [
            Object.fromEntries(
              Object.entries(item.signals).map(([key, value]) => [key.toLowerCase(), value])
            ),
          ]
        : []
    );
  const payload: ClaudeUsagePayload = {};
  for (const [bucket, key] of [
    ['5h', 'five_hour'],
    ['7d', 'seven_day'],
    ['7d_oi', 'seven_day_opus'],
  ] as const) {
    const prefix = `anthropic-ratelimit-unified-${bucket}`;
    // Responses can omit model-specific windows. Read each window from its
    // newest observation, keeping utilization and reset from the same response.
    const headers = observations.find(
      (signals) => `${prefix}-utilization` in signals || `${prefix}-reset` in signals
    );
    if (!headers) continue;
    const rawUsed = headers[`${prefix}-utilization`];
    const rawReset = headers[`${prefix}-reset`];
    if (typeof rawUsed !== 'string' || !rawUsed.trim() || typeof rawReset !== 'string') continue;
    const used = Number(rawUsed);
    const reset = Number(rawReset) * 1000;
    // Anthropic can report over-limit utilization such as 1.01 (101%).
    if (!Number.isFinite(used) || used < 0 || !Number.isFinite(reset) || reset <= now) {
      continue;
    }
    payload[key] = { utilization: used * 100, resets_at: new Date(reset).toISOString() };
  }
  return Object.keys(payload).length ? payload : null;
}
