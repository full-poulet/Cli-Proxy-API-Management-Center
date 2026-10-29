import type { ClaudeUsagePayload } from '@/types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reuse recent limits observed on this credential's real inference responses. */
export function claudeUsageFromHeaders(
  modelQuotas: unknown,
  now = Date.now()
): ClaudeUsagePayload | null {
  if (!isRecord(modelQuotas)) return null;
  const latest = Object.values(modelQuotas)
    .filter(isRecord)
    .map((item) => ({ item, at: Date.parse(String(item.observed_at ?? '')) }))
    .filter(({ at }) => Number.isFinite(at) && at <= now)
    .sort((a, b) => b.at - a.at)[0];
  if (!latest || now - latest.at > 15 * 60_000 || !isRecord(latest.item.signals)) {
    return null;
  }
  const headers = Object.fromEntries(
    Object.entries(latest.item.signals).map(([key, value]) => [key.toLowerCase(), value])
  );
  const payload: ClaudeUsagePayload = {};
  for (const [bucket, key] of [
    ['5h', 'five_hour'],
    ['7d', 'seven_day'],
    ['7d_oi', 'seven_day_opus'],
  ] as const) {
    const prefix = `anthropic-ratelimit-unified-${bucket}`;
    const rawUsed = headers[`${prefix}-utilization`];
    const rawReset = headers[`${prefix}-reset`];
    if (typeof rawUsed !== 'string' || !rawUsed.trim() || typeof rawReset !== 'string') continue;
    const used = Number(rawUsed);
    const reset = Number(rawReset) * 1000;
    if (!Number.isFinite(used) || used < 0 || used > 1 || !Number.isFinite(reset) || reset <= now) {
      continue;
    }
    payload[key] = { utilization: used * 100, resets_at: new Date(reset).toISOString() };
  }
  return Object.keys(payload).length ? payload : null;
}
