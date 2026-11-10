/**
 * Routing provider section: the ordering-mode radiogroup and the manual-mode
 * move buttons render with the right ARIA state (static markup only).
 */

import { describe, expect, test } from 'bun:test';
import i18n from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../src/i18n/index';
import { RoutingProviderSection } from '../src/features/routing/components/RoutingProviderSection';
import { normalizeRoutingPayload } from '../src/services/api/routing';
import type { QuotaClassMap } from '../src/features/quota/types';

// Accessible names are asserted in English; the app otherwise picks the browser language.
await i18n.changeLanguage('en');

const quotaClasses = new Proxy({} as QuotaClassMap, { get: (_t, key) => String(key) });

const render = (mode: string, saving = false) => {
  const provider = normalizeRoutingPayload({
    providers: [
      {
        id: 'claude',
        mode,
        order: ['claude-b.json'],
        accounts: [
          { name: 'claude-a.json', rank: 1, state: 'active' },
          { name: 'claude-b.json', rank: 2, state: 'standby' },
        ],
      },
    ],
  }).providers[0];
  return renderToStaticMarkup(
    createElement(RoutingProviderSection, {
      provider,
      resolvedTheme: 'light',
      quotaClasses,
      saving,
      saveError: saving ? null : 'HTTP 503',
      disableControls: false,
      onSavePreference: () => {},
    })
  );
};

describe('routing order mode rendering', () => {
  test('even mode: radiogroup with three radios, no move buttons, no mode badge', () => {
    const markup = render('even');
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g)?.length).toBe(3);
    expect(markup.match(/aria-checked="true"/g)?.length).toBe(1);
    expect(markup).not.toContain('aria-label="Move');
    expect(markup).not.toContain('cursor: help');
    expect(markup).toContain('role="alert"');
  });

  test('manual mode: rows follow the saved order and carry move buttons with names', () => {
    const markup = render('manual');
    const first = markup.indexOf('claude-b.json');
    const second = markup.indexOf('claude-a.json');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
    const labels = markup.match(/aria-label="Move[^"]*"/g) ?? [];
    expect(labels).toEqual([
      'aria-label="Move claude-b.json up"',
      'aria-label="Move claude-b.json down"',
      'aria-label="Move claude-a.json up"',
      'aria-label="Move claude-a.json down"',
    ]);
    // Top row cannot move up, bottom row cannot move down.
    expect(markup.match(/aria-disabled="true"/g)?.length).toBe(2);
  });

  test('saving makes every control inert', () => {
    const markup = render('manual', true);
    expect(markup).toContain('aria-busy="true"');
    // 3 radios + 4 move buttons
    expect(markup.match(/aria-disabled="true"/g)?.length).toBe(7);
    expect(markup).not.toContain('role="alert"');
  });
});
