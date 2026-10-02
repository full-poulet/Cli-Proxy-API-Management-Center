/**
 * One window column in a ledger row: label left, remaining % right, thin bar,
 * then the reset line ("in 1 day · 09/13, 13:00" or "No reset pending").
 *
 * The relative half leads here (unlike the card view, which leads with the
 * absolute instant): in a wide row the countdown is the number you scan for.
 */

import { useTranslation } from 'react-i18next';
import { buildResetDisplay } from '@/utils/quota';
import { QuotaMeter } from '../components/QuotaMeter';
import type { QuotaClassMap } from '../types';
import { LEDGER_THRESHOLDS, type LedgerWindow } from './ledgerModel';
import styles from './QuotaLedger.module.scss';

export type LedgerWindowColumnProps = {
  window: LedgerWindow;
  nowMs: number;
  quotaClasses: QuotaClassMap;
  /** Grey the whole column (Claude's general 7-day bucket). */
  dimmed?: boolean;
};

export function LedgerWindowColumn({
  window,
  nowMs,
  quotaClasses,
  dimmed,
}: LedgerWindowColumnProps) {
  const { t, i18n } = useTranslation();
  const remaining = window.remainingPct;
  const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
  // A reset that already passed is not pending either; the window has refilled.
  const pending = window.resetAtMs !== null && window.resetAtMs > nowMs;
  const display = pending
    ? buildResetDisplay(window.resetLabel, window.resetAtMs, nowMs, i18n.resolvedLanguage)
    : null;

  return (
    <div className={`${styles.column} ${dimmed ? styles.columnDimmed : ''}`}>
      <div className={styles.columnHead}>
        <span className={styles.columnLabel}>{window.label}</span>
        <span className={styles.columnPercent}>{percentLabel}</span>
      </div>
      <QuotaMeter percent={remaining} classes={quotaClasses} thresholds={LEDGER_THRESHOLDS} />
      <div className={styles.columnReset}>
        {display ? (
          <>
            {display.relative && <span className={styles.resetRelative}>{display.relative}</span>}
            {display.relative && (
              <span className={styles.resetDot} aria-hidden="true">
                ·
              </span>
            )}
            <span className={styles.resetAbsolute}>{display.absolute}</span>
          </>
        ) : (
          <span className={styles.resetNone}>{t('quota_ledger.no_reset_pending')}</span>
        )}
      </div>
    </div>
  );
}
