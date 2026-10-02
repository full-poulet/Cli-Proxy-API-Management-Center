/**
 * Ledger layout for the Quota page: provider summary cards in a row, then one
 * group per provider ("Claude 5") with hairline-separated credential rows.
 *
 * Summaries are built from every credential that passed the tab/search filter
 * (not only the current page) so the big numbers describe the whole pool;
 * rows follow the page. Data flows through the same store, actions and rank
 * chips as the card view — this is purely another projection of it.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { useQuotaViewStore } from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { RoutingRankChip } from '@/features/routing/logic';
import { QUOTA_TAB_ORDER } from '../constants';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaAdapter, type QuotaCardState } from '../providers';
import { bindQuotaClasses } from '../types';
import bodyStyles from '../components/QuotaBody.module.scss';
import { LedgerRow } from './LedgerRow';
import { LedgerSummaryCard } from './LedgerSummaryCard';
import {
  buildLedgerCredential,
  groupByProvider,
  hasSecondaryColumn,
  summarizeProvider,
} from './ledgerModel';
import styles from './QuotaLedger.module.scss';

/** Row meters wear the Quota page coat so the two layouts draw bars identically. */
const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss (ledger)');

export type QuotaLedgerProps = {
  /** Rows to render (the current page, already sorted). */
  pageEntries: QuotaFileEntry[];
  /** Everything behind the summary cards (all pages of the current filter). */
  allEntries: QuotaFileEntry[];
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  displayNameFor: (file: AuthFileItem) => string;
  resolvedTheme: ResolvedTheme;
  canUseActions: boolean;
  resettingQuotaName: string | null;
  routingRanks: Map<string, RoutingRankChip>;
  onRefresh: (file: AuthFileItem, adapter: QuotaAdapter) => void;
  onReset: (file: AuthFileItem, adapter: QuotaAdapter) => void;
};

export function QuotaLedger(props: QuotaLedgerProps) {
  const {
    pageEntries,
    allEntries,
    getQuota,
    displayNameFor,
    resolvedTheme,
    canUseActions,
    resettingQuotaName,
    routingRanks,
    onRefresh,
    onReset,
  } = props;
  const { t } = useTranslation();
  const now = useNow();
  const showGeneralWeekly = useQuotaViewStore((state) => state.showGeneralWeekly);
  const toggleShowGeneralWeekly = useQuotaViewStore((state) => state.toggleShowGeneralWeekly);

  const allCredentials = useMemo(
    () => allEntries.map((entry) => buildLedgerCredential(entry, getQuota(entry), t)),
    [allEntries, getQuota, t]
  );
  const summaries = useMemo(
    () =>
      groupByProvider(allCredentials, QUOTA_TAB_ORDER).map(({ type, credentials }) =>
        summarizeProvider(type, credentials, now, t)
      ),
    [allCredentials, now, t]
  );

  const pageCredentials = useMemo(
    () => pageEntries.map((entry) => buildLedgerCredential(entry, getQuota(entry), t)),
    [pageEntries, getQuota, t]
  );
  const groups = useMemo(
    () => groupByProvider(pageCredentials, QUOTA_TAB_ORDER),
    [pageCredentials]
  );

  return (
    <div className={styles.ledger}>
      {summaries.length > 0 && (
        <div className={styles.summaries}>
          {summaries.map((summary) => (
            <LedgerSummaryCard
              key={summary.type}
              summary={summary}
              resolvedTheme={resolvedTheme}
              secondaryShown={showGeneralWeekly}
              onToggleSecondary={summary.secondary ? toggleShowGeneralWeekly : undefined}
            />
          ))}
        </div>
      )}

      {groups.map(({ type, credentials }) => {
        const label = getTypeLabel(t, type);
        // Only Claude groups with a model-scoped window hide the general column.
        const showSecondary = showGeneralWeekly || !hasSecondaryColumn(credentials);
        return (
          <section key={type} className={styles.group} aria-label={label}>
            <h2 className={styles.groupTitle}>
              {label}
              <span className={styles.groupCount}>{credentials.length}</span>
            </h2>
            <div className={styles.rows}>
              {credentials.map((credential) => {
                const file = credential.entry.file;
                const cacheKey = getQuotaCacheKey(file);
                const adapter = QUOTA_ADAPTERS[credential.entry.type];
                return (
                  <LedgerRow
                    key={`${credential.entry.type}:${cacheKey}`}
                    credential={credential}
                    displayName={displayNameFor(file)}
                    quotaClasses={quotaClasses}
                    showSecondary={showSecondary}
                    canRefresh={canUseActions && !file.disabled}
                    resetting={resettingQuotaName === cacheKey}
                    routingRank={routingRanks.get(file.name) ?? null}
                    onRefresh={() => onRefresh(file, adapter)}
                    onReset={() => onReset(file, adapter)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
