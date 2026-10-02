/**
 * Ledger model: per-credential flattening, provider roll-up, email masking.
 */

import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  buildLedgerCredential,
  groupByProvider,
  hasSecondaryColumn,
  resolveLedgerLevel,
  summarizeProvider,
} from '@/features/quota/ledger/ledgerModel';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import { maskCredentialName, maskEmail } from '@/utils/quota';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';

const t = ((key: string) => key) as TFunction;
const NOW = new Date(2026, 9, 2, 12, 0, 0).getTime();

const entry = (type: QuotaFileEntry['type'], name: string, email?: string): QuotaFileEntry => ({
  type,
  file: { name, email, auth_index: name },
});

const claudeState = (
  fable: number | null,
  sevenDay: number,
  fiveHour: number,
  resetMs: number
): ClaudeQuotaState => ({
  status: 'success',
  planType: 'plan_max',
  windows: [
    {
      id: 'five-hour',
      label: '',
      labelKey: 'claude_quota.five_hour',
      usedPercent: fiveHour,
      resetLabel: '-',
      resetAtMs: null,
      periodHours: 5,
    },
    {
      id: 'seven-day',
      label: '',
      labelKey: 'claude_quota.seven_day',
      usedPercent: sevenDay,
      resetLabel: 'x',
      resetAtMs: resetMs,
      periodHours: 168,
    },
    ...(fable === null
      ? []
      : [
          {
            id: 'seven-day-fable',
            label: '',
            labelKey: 'claude_quota.seven_day_fable',
            usedPercent: fable,
            resetLabel: 'x',
            resetAtMs: resetMs,
            periodHours: 168,
          },
        ]),
  ],
});

describe('ledger levels', () => {
  test('uses the 75 / 40 steps and splits out empty and unknown', () => {
    expect(resolveLedgerLevel(100)).toBe('high');
    expect(resolveLedgerLevel(75)).toBe('high');
    expect(resolveLedgerLevel(74)).toBe('medium');
    expect(resolveLedgerLevel(40)).toBe('medium');
    expect(resolveLedgerLevel(39)).toBe('low');
    expect(resolveLedgerLevel(0)).toBe('empty');
    expect(resolveLedgerLevel(null)).toBe('unknown');
  });
});

describe('buildLedgerCredential', () => {
  test('orders Claude windows Fable → 5-hour → 7-day and marks the general week secondary', () => {
    const credential = buildLedgerCredential(
      entry('claude', 'claude-a.json'),
      claudeState(42, 21, 0, NOW + DAY_MS),
      t
    );
    expect(credential.windows.map((w) => w.id)).toEqual([
      'seven-day-fable',
      'five-hour',
      'seven-day',
    ]);
    expect(credential.windows.map((w) => w.remainingPct)).toEqual([58, 100, 79]);
    expect(credential.windows.map((w) => w.secondary)).toEqual([false, false, true]);
    expect(credential.primaryWindowId).toBe('seven-day-fable');
    expect(credential.planLabel).toBe('claude_quota.plan_max');
  });

  test('without a Fable window the general 7-day leads and nothing is secondary', () => {
    const credential = buildLedgerCredential(
      entry('claude', 'claude-a.json'),
      claudeState(null, 21, 0, NOW + DAY_MS),
      t
    );
    expect(credential.primaryWindowId).toBe('seven-day');
    expect(hasSecondaryColumn([credential])).toBe(false);
  });

  test('Codex: weekly leads, credits and renewal come through', () => {
    const codex: CodexQuotaState = {
      status: 'success',
      planType: 'pro',
      subscriptionActiveUntil: '2026-10-03T15:02:00Z',
      rateLimitResetCreditsAvailableCount: 2,
      rateLimitResetCredits: [
        { id: 'c1', status: 'available', grantedAt: '', expiresAt: '2026-10-24T10:00:00Z' },
      ],
      rateLimitResetCreditsError: '',
      windows: [
        {
          id: 'five-hour',
          label: '',
          labelKey: 'codex_quota.primary_window',
          usedPercent: 10,
          resetLabel: 'a',
          resetAtMs: NOW + 2 * HOUR_MS,
          periodHours: 5,
        },
        {
          id: 'weekly',
          label: '',
          labelKey: 'codex_quota.secondary_window',
          usedPercent: 83,
          resetLabel: 'b',
          resetAtMs: NOW + 2 * DAY_MS,
          periodHours: 168,
        },
      ],
    };
    const credential = buildLedgerCredential(entry('codex', 'codex-a.json'), codex, t);
    expect(credential.windows.map((w) => w.id)).toEqual(['weekly', 'five-hour']);
    expect(credential.primaryWindowId).toBe('weekly');
    expect(credential.planLabel).toBe('codex_quota.plan_pro');
    expect(credential.renewalMs).toBe(Date.parse('2026-10-03T15:02:00Z'));
    expect(credential.creditsAvailable).toBe(2);
    expect(credential.credits[0].expiresAtMs).toBe(Date.parse('2026-10-24T10:00:00Z'));
  });

  test('idle / error credentials keep their status and carry the error', () => {
    const idle = buildLedgerCredential(entry('claude', 'a.json'), undefined, t);
    expect(idle.status).toBe('idle');
    const failed = buildLedgerCredential(
      entry('claude', 'a.json'),
      { status: 'error', error: 'boom', errorStatus: 429 },
      t
    );
    expect(failed.status).toBe('error');
    expect(failed.error).toBe('boom');
    expect(failed.windows).toEqual([]);
  });
});

describe('summarizeProvider', () => {
  test('sums remaining over loaded credentials, keeps capacity for all, picks the soonest reset', () => {
    const credentials = [
      buildLedgerCredential(entry('claude', 'a.json'), claudeState(42, 21, 0, NOW + 3 * DAY_MS), t),
      buildLedgerCredential(entry('claude', 'b.json'), claudeState(0, 0, 0, NOW + DAY_MS), t),
      buildLedgerCredential(entry('claude', 'c.json'), undefined, t),
    ];
    const summary = summarizeProvider('claude', credentials, NOW, t);
    expect(summary.credentialCount).toBe(3);
    expect(summary.loadedCount).toBe(2);
    expect(summary.capacity).toBe(300);
    expect(summary.remainingSum).toBe(158);
    expect(summary.primaryLabel).toBe('claude_quota.seven_day_fable');
    expect(summary.soonestResetMs).toBe(NOW + DAY_MS);
    expect(summary.segments.map((s) => s.level)).toEqual(['medium', 'high', 'unknown']);
    expect(summary.secondary).toEqual({ label: 'claude_quota.seven_day', remainingSum: 179 });
  });

  test('nothing loaded → "--" (null sum) but the default window label still shows', () => {
    const summary = summarizeProvider(
      'codex',
      [buildLedgerCredential(entry('codex', 'a.json'), undefined, t)],
      NOW,
      t
    );
    expect(summary.remainingSum).toBeNull();
    expect(summary.primaryLabel).toBe('codex_quota.secondary_window');
    expect(summary.soonestResetMs).toBeNull();
  });

  test('a reset in the past does not count as pending', () => {
    const summary = summarizeProvider(
      'claude',
      [buildLedgerCredential(entry('claude', 'a.json'), claudeState(10, 10, 0, NOW - HOUR_MS), t)],
      NOW,
      t
    );
    expect(summary.soonestResetMs).toBeNull();
  });
});

describe('groupByProvider', () => {
  test('keeps incoming order inside a group and drops empty providers', () => {
    const groups = groupByProvider(
      [
        buildLedgerCredential(entry('codex', 'c2.json'), undefined, t),
        buildLedgerCredential(entry('claude', 'a.json'), undefined, t),
        buildLedgerCredential(entry('codex', 'c1.json'), undefined, t),
      ],
      ['claude', 'antigravity', 'codex']
    );
    expect(groups.map((g) => g.type)).toEqual(['claude', 'codex']);
    expect(groups[1].credentials.map((c) => c.entry.file.name)).toEqual(['c2.json', 'c1.json']);
  });
});

describe('email masking', () => {
  test('keeps the first letter of the local part, the domain initial and the TLD', () => {
    expect(maskEmail('tester@1password.dev')).toBe('t•••@1•••.dev');
    expect(maskEmail('service@spiegel.ch')).toBe('s•••@s•••.ch');
    expect(maskEmail('no-address-here')).toBe('no-address-here');
  });

  test('masks the known address inside a file name and keeps the provider prefix', () => {
    expect(maskCredentialName('claude-tester@1password.dev.json', 'tester@1password.dev')).toBe(
      'claude-t•••@1•••.dev.json'
    );
    expect(maskCredentialName('codex-ae5d455f-dev@example.ch-pro.json')).toBe(
      'codex-ae5d455f-d•••@e•••.ch-pro.json'
    );
    // Hyphenated local part is masked as one unit when the email is known.
    expect(maskCredentialName('claude-a-b@x.io.json', 'a-b@x.io')).toBe('claude-a•••@x•••.io.json');
  });
});
