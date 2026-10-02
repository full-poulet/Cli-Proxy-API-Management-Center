/**
 * "Recent changes": the router's ranking events, newest first.
 */

import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { useQuotaViewStore } from '@/stores';
import type { RoutingEvent } from '@/types';
import { formatRelativeInstant, maskEmail } from '@/utils/quota';
import { formatResetClock } from '../logic';
import styles from './RoutingEvents.module.scss';

export function RoutingEvents({ events }: { events: RoutingEvent[] }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  // Event text names logins by address; honour the same "Show emails" toggle as the rows.
  const showEmails = useQuotaViewStore((state) => state.showEmails);

  return (
    <section className={styles.section} aria-label={t('routing.events_title')}>
      <h2 className={styles.title}>{t('routing.events_title')}</h2>
      {events.length === 0 ? (
        <p className={styles.empty}>{t('routing.events_empty')}</p>
      ) : (
        <ol className={styles.list}>
          {events.map((event) => (
            <li key={`${event.atMs}:${event.text}`} className={styles.item}>
              <span
                className={styles.time}
                title={formatResetClock(event.atMs, now, i18n.resolvedLanguage)}
              >
                {formatRelativeInstant(event.atMs, now, i18n.resolvedLanguage)}
              </span>
              <span className={styles.text}>{showEmails ? event.text : maskEmail(event.text)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
