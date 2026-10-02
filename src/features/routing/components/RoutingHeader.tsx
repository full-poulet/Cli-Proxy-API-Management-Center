/**
 * Routing page header: title + mono status line + ink pill "Re-evaluate now".
 * Same vocabulary as the Quota header (terminal cursor on the meta line, pill action).
 */

import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { RoutingPayload } from '@/types';
import { formatRelativeInstant } from '@/utils/quota';
import styles from './RoutingHeader.module.scss';

export type RoutingHeaderProps = {
  payload: RoutingPayload | null;
  accountCount: number;
  refreshing: boolean;
  throttled: boolean;
  disableControls: boolean;
  onRefresh: () => void;
};

export function RoutingHeader(props: RoutingHeaderProps) {
  const { payload, accountCount, refreshing, throttled, disableControls, onRefresh } = props;
  const { t, i18n } = useTranslation();
  const now = useNow();
  const proxy = payload?.proxy ?? null;

  const updatedLabel =
    payload?.generatedAtMs !== null && payload?.generatedAtMs !== undefined
      ? t('routing.meta_updated', {
          time: formatRelativeInstant(payload.generatedAtMs, now, i18n.resolvedLanguage),
        })
      : t('routing.meta_updated_never');

  const affinityLabel = proxy
    ? !proxy.sessionAffinity
      ? t('routing.meta_affinity_off')
      : proxy.sessionAffinityTtl
        ? t('routing.meta_affinity_on_ttl', { ttl: proxy.sessionAffinityTtl })
        : t('routing.meta_affinity_on')
    : null;

  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        <h1 className={styles.title} data-reveal>
          {t('routing.title')}
        </h1>
        <p className={styles.subtitle} data-reveal>
          {t('routing.subtitle')}
        </p>
        <p className={styles.meta} data-reveal>
          <span className={payload ? styles.metaLive : styles.metaMuted}>{updatedLabel}</span>
          {accountCount > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span>{t('routing.meta_logins', { count: accountCount })}</span>
            </>
          )}
          {proxy?.strategy && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span>{t('routing.meta_strategy', { strategy: proxy.strategy })}</span>
            </>
          )}
          {affinityLabel && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span>{affinityLabel}</span>
            </>
          )}
          {throttled && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaAttention}>{t('routing.meta_throttled')}</span>
            </>
          )}
        </p>
        {proxy && !proxy.reachable && (
          <p className={styles.proxyError} role="alert">
            {t('routing.proxy_unreachable', { error: proxy.error ?? t('common.unknown_error') })}
          </p>
        )}
      </div>
      <div className={styles.actions} data-reveal>
        <button
          type="button"
          className={styles.primaryAction}
          onClick={onRefresh}
          disabled={disableControls || refreshing}
          title={t('routing.refresh_hint')}
        >
          <IconRefreshCw size={14} className={refreshing ? styles.spinning : undefined} />
          {refreshing ? t('routing.refreshing') : t('routing.refresh')}
        </button>
      </div>
    </header>
  );
}
