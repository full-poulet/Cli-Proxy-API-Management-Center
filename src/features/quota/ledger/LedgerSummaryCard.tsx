/**
 * Provider roll-up at the top of the ledger: icon + name, credential count,
 * the leading window's name, the big "409% of 500%", one bar segment per
 * credential, and the soonest reset. Claude adds a footer with the general
 * 7-day sum and a Show/Hide toggle for that column in the rows.
 */

import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { LedgerProviderSummary } from './ledgerModel';
import styles from './QuotaLedger.module.scss';

export type LedgerSummaryCardProps = {
  summary: LedgerProviderSummary;
  resolvedTheme: ResolvedTheme;
  /** Only for providers with a secondary bucket (Claude's general 7-day). */
  secondaryShown?: boolean;
  onToggleSecondary?: () => void;
};

const SEGMENT_CLASS = {
  high: styles.segmentHigh,
  medium: styles.segmentMedium,
  low: styles.segmentLow,
  empty: styles.segmentEmpty,
  unknown: styles.segmentUnknown,
} as const;

export function LedgerSummaryCard(props: LedgerSummaryCardProps) {
  const { summary, resolvedTheme, secondaryShown, onToggleSecondary } = props;
  const { t, i18n } = useTranslation();
  const now = useNow();
  const label = getTypeLabel(t, summary.type);
  const iconSrc = getAuthFileIcon(summary.type, resolvedTheme);
  const soonest =
    summary.soonestResetMs === null
      ? null
      : buildResetDisplay(null, summary.soonestResetMs, now, i18n.resolvedLanguage);

  return (
    <article className={styles.summary} aria-label={label}>
      <header className={styles.summaryHead}>
        <span
          className={styles.summaryIcon}
          aria-hidden="true"
          style={
            isThemeSurfaceIconProvider(summary.type)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" />
          ) : (
            <span className={styles.summaryIconFallback}>{label.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className={styles.summaryName}>{label}</span>
        <span className={styles.summaryCount}>
          {t('quota_ledger.credentials', { count: summary.credentialCount })}
        </span>
      </header>

      {summary.primaryLabel && <div className={styles.summaryWindow}>{summary.primaryLabel}</div>}
      <div className={styles.summaryFigure}>
        <span className={styles.summaryBig}>
          {summary.remainingSum === null ? '--' : `${summary.remainingSum}%`}
        </span>
        <span className={styles.summaryOf}>
          {t('quota_ledger.of_capacity', { capacity: summary.capacity })}
        </span>
      </div>
      <div className={styles.segments} aria-hidden="true">
        {summary.segments.map((segment) => (
          <span key={segment.key} className={`${styles.segment} ${SEGMENT_CLASS[segment.level]}`}>
            <span
              className={styles.segmentFill}
              style={{ width: `${Math.round(segment.remainingPct ?? 0)}%` }}
            />
          </span>
        ))}
      </div>
      <div className={styles.summaryReset}>
        {soonest ? (
          <>
            {soonest.relative && <span className={styles.resetRelative}>{soonest.relative}</span>}
            {soonest.relative && (
              <span className={styles.resetDot} aria-hidden="true">
                ·
              </span>
            )}
            <span className={styles.resetAbsolute}>{soonest.absolute}</span>
          </>
        ) : (
          <span className={styles.resetNone}>
            {summary.loadedCount === 0
              ? t('quota_ledger.not_loaded')
              : t('quota_ledger.no_reset_pending')}
          </span>
        )}
      </div>

      {summary.secondary && onToggleSecondary && (
        <footer className={styles.summaryFoot}>
          <span className={styles.summaryFootLabel}>{summary.secondary.label}</span>
          <span className={styles.summaryFootValue}>{summary.secondary.remainingSum}%</span>
          <button
            type="button"
            className={styles.summaryToggle}
            onClick={onToggleSecondary}
            aria-pressed={secondaryShown}
          >
            {secondaryShown ? t('quota_ledger.hide_column') : t('quota_ledger.show_column')}
          </button>
        </footer>
      )}
    </article>
  );
}
