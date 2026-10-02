/**
 * One credential in the ledger: name + plan on the left, window columns in the
 * middle, quiet text actions on the right. No card box — rows are separated by
 * hairlines so a provider group reads as one table.
 *
 * State handling mirrors QuotaCard: idle rows offer a load button, loading
 * rows show a skeleton, failed rows show the error strip and keep "Refresh".
 */

import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay, resolveQuotaErrorMessage } from '@/utils/quota';
import type { RoutingRankChip } from '@/features/routing/logic';
import { QUOTA_ADAPTERS } from '../providers';
import { isQuotaRefreshDisabled } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import type { QuotaClassMap } from '../types';
import { LedgerWindowColumn } from './LedgerWindowColumn';
import type { LedgerCredential } from './ledgerModel';
import styles from './QuotaLedger.module.scss';

export type LedgerRowProps = {
  credential: LedgerCredential;
  /** Already masked or not, decided by the page. */
  displayName: string;
  quotaClasses: QuotaClassMap;
  /** Claude: render the general 7-day column (dimmed) next to the model-scoped one. */
  showSecondary: boolean;
  canRefresh: boolean;
  resetting: boolean;
  routingRank?: RoutingRankChip | null;
  onRefresh: () => void;
  onReset: () => void;
};

export function LedgerRow(props: LedgerRowProps) {
  const {
    credential,
    displayName,
    quotaClasses,
    showSecondary,
    canRefresh,
    resetting,
    routingRank,
    onRefresh,
    onReset,
  } = props;
  const { t, i18n } = useTranslation();
  const now = useNow();
  const { entry, status } = credential;
  const adapter = QUOTA_ADAPTERS[entry.type];
  const loading = status === 'loading';
  const claudeReset = useClaudeResetGrants(
    entry.file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    credential.source,
    onRefresh
  );

  const renewal =
    credential.renewalMs === null
      ? null
      : buildResetDisplay(null, credential.renewalMs, now, i18n.resolvedLanguage);
  const showCodexReset =
    status === 'success' && credential.creditsAvailable !== null && credential.creditsAvailable > 0;
  const visibleWindows = credential.windows.filter((window) => showSecondary || !window.secondary);

  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        <div className={styles.nameLine}>
          <span className={styles.name} title={displayName}>
            {displayName}
          </span>
          {routingRank && (
            <span
              className={`${styles.rankChip} ${routingRank.state === 'active' ? styles.rankChipNext : ''}`}
              title={t('routing.chip_hint')}
            >
              {routingRank.state === 'active'
                ? t('routing.chip_next', { rank: routingRank.rank })
                : t('routing.chip_rank', { rank: routingRank.rank })}
            </span>
          )}
        </div>
        {(credential.planLabel || renewal) && (
          <div className={styles.planLine}>
            {credential.planLabel && <span>{credential.planLabel}</span>}
            {renewal && (
              <>
                {credential.planLabel && (
                  <span className={styles.resetDot} aria-hidden="true">
                    ·
                  </span>
                )}
                <span>{t('quota_ledger.renews', { time: renewal.absolute })}</span>
                {renewal.relative && (
                  <>
                    <span className={styles.resetDot} aria-hidden="true">
                      ·
                    </span>
                    <span>{renewal.relative}</span>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {entry.type === 'claude' && status === 'success' && claudeReset.count !== null && (
          <div className={styles.planLine}>
            {t('quota_ledger.claude_resets', { count: claudeReset.count })}
          </div>
        )}
      </div>

      <div className={styles.windows}>
        {status === 'idle' ? (
          <button
            type="button"
            className={styles.loadButton}
            onClick={onRefresh}
            disabled={!canRefresh}
          >
            <IconRefreshCw size={13} aria-hidden="true" />
            {t(`${adapter.i18nPrefix}.idle`)}
          </button>
        ) : loading ? (
          <div className={styles.skeleton} aria-busy="true">
            <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
            {[0, 1].map((index) => (
              <span key={index} className={styles.skeletonColumn} aria-hidden="true" />
            ))}
          </div>
        ) : status === 'error' ? (
          <div className={styles.errorStrip} role="alert">
            {t(`${adapter.i18nPrefix}.load_failed`, {
              message: resolveQuotaErrorMessage(
                t,
                credential.errorStatus,
                credential.error || t('common.unknown_error')
              ),
            })}
          </div>
        ) : (
          <>
            {visibleWindows.length === 0 && (
              <span className={styles.resetNone}>{t(`${adapter.i18nPrefix}.empty_windows`)}</span>
            )}
            {visibleWindows.map((window) => (
              <LedgerWindowColumn
                key={window.id}
                window={window}
                nowMs={now}
                quotaClasses={quotaClasses}
                dimmed={window.secondary}
              />
            ))}
            {credential.creditsAvailable !== null && (
              <div className={styles.column}>
                <div className={styles.columnHead}>
                  <span className={styles.columnLabel}>{t('codex_quota.reset_credits_label')}</span>
                </div>
                <div className={styles.creditsCount}>
                  <span className={styles.columnPercent}>{credential.creditsAvailable}</span>
                  <span className={styles.creditsAvailable}>
                    {t('quota_ledger.credits_available')}
                  </span>
                </div>
                {credential.credits.map((credit, index) => {
                  const expiry = buildResetDisplay(
                    credit.expiresAtMs === null ? credit.expiresLabel : null,
                    credit.expiresAtMs,
                    now,
                    i18n.resolvedLanguage
                  );
                  return (
                    <div key={credit.id} className={styles.columnReset}>
                      <span className={styles.resetRelative}>
                        {t('codex_quota.reset_credit_number', { index: index + 1 })}
                      </span>
                      {expiry?.relative && (
                        <>
                          <span className={styles.resetDot} aria-hidden="true">
                            ·
                          </span>
                          <span className={styles.resetRelative}>{expiry.relative}</span>
                        </>
                      )}
                      {expiry && (
                        <>
                          <span className={styles.resetDot} aria-hidden="true">
                            ·
                          </span>
                          <span className={styles.resetAbsolute}>{expiry.absolute}</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {status !== 'idle' && (
        <div className={styles.actions}>
          {entry.type === 'claude' && (
            <button
              type="button"
              className={styles.action}
              disabled={claudeReset.blocked}
              onClick={claudeReset.confirm}
              title={t(`claude_reset.${claudeReset.buttonLabel}`)}
            >
              <IconRefreshCw size={12} className={claudeReset.busy ? styles.spinning : undefined} />
              {t(`claude_reset.${claudeReset.buttonLabel}`)}
            </button>
          )}
          {showCodexReset && (
            <button
              type="button"
              className={styles.action}
              onClick={onReset}
              disabled={!canRefresh || loading || resetting}
              title={t('codex_quota.reset_button')}
            >
              <IconRefreshCw size={12} className={resetting ? styles.spinning : undefined} />
              {t('codex_quota.reset_button')}
            </button>
          )}
          <button
            type="button"
            className={styles.action}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
            title={t('auth_files.quota_refresh_hint')}
          >
            <IconRefreshCw size={12} className={loading ? styles.spinning : undefined} />
            {t('auth_files.quota_refresh_single')}
          </button>
        </div>
      )}
    </div>
  );
}
