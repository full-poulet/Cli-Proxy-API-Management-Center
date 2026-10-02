/**
 * Routing page: which login the proxy will serve next, per provider, and why.
 *
 * Data comes from the Fleet router (`<apiBase>/usage-api/routing`), polled
 * every 60 s while mounted (see useRoutingPayload). The header refresh slot is
 * registered too, so the global refresh button re-fetches the ranking.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useThemeStore } from '@/stores';
import type { ResolvedTheme } from '@/types';
import { bindQuotaClasses } from '@/features/quota/types';
import quotaBodyStyles from '@/features/quota/components/QuotaBody.module.scss';
import { RoutingHeader } from './components/RoutingHeader';
import { RoutingProviderSection } from './components/RoutingProviderSection';
import { RoutingExplainer } from './components/RoutingExplainer';
import { RoutingEvents } from './components/RoutingEvents';
import { useRoutingPayload } from './hooks/useRoutingPayload';
import { countAccounts } from './logic';
import styles from './RoutingPage.module.scss';

/** Meters wear the Quota page coat so both pages render windows identically. */
const quotaClasses = bindQuotaClasses(quotaBodyStyles, 'QuotaBody.module.scss (routing)');

const SKELETON_ROW_COUNT = 3;

export function RoutingPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const revealRef = useRevealGroup<HTMLDivElement>();
  const connected = connectionStatus === 'connected';

  const { payload, loading, refreshing, error, throttled, refresh } = useRoutingPayload(connected);

  const handleRefresh = useCallback(() => {
    if (!connected) return;
    void refresh();
  }, [connected, refresh]);

  useHeaderRefresh(handleRefresh);

  const providers = payload?.providers ?? [];
  const isEmpty = !loading && providers.length === 0;

  return (
    <div className={styles.page} ref={revealRef}>
      <RoutingHeader
        payload={payload}
        accountCount={countAccounts(payload)}
        refreshing={refreshing}
        throttled={throttled}
        disableControls={!connected}
        onRefresh={handleRefresh}
      />

      {error && (
        <div className={styles.errorBanner} role="alert">
          {t('routing.load_failed', { message: error })}
        </div>
      )}

      {loading ? (
        <div className={styles.skeletons} aria-hidden="true">
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
            <Skeleton key={index} height={132} rounded={14} />
          ))}
        </div>
      ) : isEmpty ? (
        <EmptyState title={t('routing.empty_title')} description={t('routing.empty_desc')} />
      ) : (
        <div className={styles.providers}>
          {providers.map((provider) => (
            <RoutingProviderSection
              key={provider.id}
              provider={provider}
              resolvedTheme={resolvedTheme}
              quotaClasses={quotaClasses}
            />
          ))}
        </div>
      )}

      <RoutingExplainer />

      {!loading && <RoutingEvents events={payload?.events ?? []} />}
    </div>
  );
}
