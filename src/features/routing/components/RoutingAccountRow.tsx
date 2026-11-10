/**
 * One login in the ranking: rank badge, identity, plan, compact meters per
 * window, the router's reason sentence, and stale / error markers.
 *
 * Meters reuse the Quota page's QuotaMeter + QuotaBody coat so both pages
 * read identically (same track, same three-step fill colours).
 *
 * With `reorder` set (manual mode) the head also carries move up / down
 * buttons. They use aria-disabled rather than disabled so the focused button
 * keeps focus across the re-render that follows a save.
 */

import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronUp } from '@/components/ui/icons';
import { QuotaMeter } from '@/features/quota/components/QuotaMeter';
import type { QuotaClassMap } from '@/features/quota/types';
import { useNow } from '@/hooks/useNow';
import { useQuotaViewStore } from '@/stores';
import type { RoutingAccount } from '@/types';
import { maskEmail } from '@/utils/quota';
import { accountDisplayName, formatCountdown, formatResetClock, resolveRankBadge } from '../logic';
import styles from './RoutingAccountRow.module.scss';

export type RoutingReorderControls = {
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** True while a save is in flight or the connection is down: clicks are ignored. */
  inert: boolean;
  onMove: (direction: -1 | 1) => void;
};

export type RoutingAccountRowProps = {
  account: RoutingAccount;
  quotaClasses: QuotaClassMap;
  /** Present only in "my order" mode. */
  reorder?: RoutingReorderControls;
};

const TONE_CLASS = {
  active: styles.badgeActive,
  standby: styles.badgeStandby,
  exhausted: styles.badgeExhausted,
  muted: styles.badgeMuted,
} as const;

export function RoutingAccountRow({ account, quotaClasses, reorder }: RoutingAccountRowProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const showEmails = useQuotaViewStore((state) => state.showEmails);
  const badge = resolveRankBadge(account.state, account.rank);
  const rawName = accountDisplayName(account);
  const displayName = showEmails ? rawName : maskEmail(rawName);
  const dimmed = account.state === 'exhausted' || account.state === 'disabled';

  return (
    <article className={`${styles.row} ${dimmed ? styles.rowDimmed : ''}`}>
      <header className={styles.head}>
        <span className={`${styles.badge} ${TONE_CLASS[badge.tone]}`}>
          {t(`routing.badge_${badge.key}`, { rank: badge.rank ?? '' }).trim()}
        </span>
        <span className={styles.identity} title={showEmails ? account.name : undefined}>
          {displayName}
        </span>
        {account.plan && <span className={styles.plan}>{account.plan}</span>}
        <span className={styles.tags}>
          {account.stale && (
            <span className={styles.tagStale} title={t('routing.stale_hint')}>
              {t('routing.stale')}
            </span>
          )}
          {account.source && <span className={styles.tagSource}>{account.source}</span>}
        </span>
        {reorder && (
          <span className={styles.reorder}>
            <button
              type="button"
              className={styles.moveButton}
              aria-label={t('routing.move_up', { name: displayName })}
              aria-disabled={reorder.inert || !reorder.canMoveUp || undefined}
              onClick={() => {
                if (!reorder.inert && reorder.canMoveUp) reorder.onMove(-1);
              }}
            >
              <IconChevronUp size={14} />
            </button>
            <button
              type="button"
              className={styles.moveButton}
              aria-label={t('routing.move_down', { name: displayName })}
              aria-disabled={reorder.inert || !reorder.canMoveDown || undefined}
              onClick={() => {
                if (!reorder.inert && reorder.canMoveDown) reorder.onMove(1);
              }}
            >
              <IconChevronDown size={14} />
            </button>
          </span>
        )}
      </header>

      {account.windows.length > 0 && (
        <div className={styles.meters}>
          {account.windows.map((window, index) => {
            const remaining = window.remainingPct;
            const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
            const countdown =
              window.resetsAtMs === null ? null : formatCountdown(window.resetsAtMs, now);
            return (
              <div key={window.id} className={quotaClasses.quotaRow}>
                <div className={quotaClasses.quotaRowHeader}>
                  <span
                    className={`${quotaClasses.quotaModel} ${window.weekly ? styles.weeklyLabel : ''}`}
                  >
                    {window.label}
                  </span>
                  <div className={quotaClasses.quotaMeta}>
                    <span className={quotaClasses.quotaPercent}>{percentLabel}</span>
                    {window.resetsAtMs !== null && (
                      <span className={quotaClasses.quotaResetRelative}>
                        {countdown
                          ? t('routing.resets_in', { countdown })
                          : t('routing.resets_now')}
                        <span className={quotaClasses.quotaReset}>
                          {' · '}
                          {formatResetClock(window.resetsAtMs, now, i18n.resolvedLanguage)}
                        </span>
                        {window.estimated && (
                          <span className={styles.estimated} title={t('routing.estimated_hint')}>
                            {t('routing.estimated')}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <QuotaMeter percent={remaining} classes={quotaClasses} index={index} />
              </div>
            );
          })}
        </div>
      )}

      {account.reason && (
        <p className={styles.reason}>{showEmails ? account.reason : maskEmail(account.reason)}</p>
      )}
      {account.error && (
        <p className={styles.error} role="alert">
          {account.error}
        </p>
      )}
    </article>
  );
}
