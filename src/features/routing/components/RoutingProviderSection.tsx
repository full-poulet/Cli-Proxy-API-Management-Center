/**
 * One provider block: brand icon + label + login count, then the ranked rows.
 */

import { useTranslation } from 'react-i18next';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaClassMap } from '@/features/quota/types';
import type { ResolvedTheme, RoutingProvider } from '@/types';
import { RoutingAccountRow } from './RoutingAccountRow';
import styles from './RoutingProviderSection.module.scss';

export type RoutingProviderSectionProps = {
  provider: RoutingProvider;
  resolvedTheme: ResolvedTheme;
  quotaClasses: QuotaClassMap;
};

export function RoutingProviderSection(props: RoutingProviderSectionProps) {
  const { provider, resolvedTheme, quotaClasses } = props;
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(provider.id, resolvedTheme);
  const label = provider.label || getTypeLabel(t, provider.id);

  return (
    <section className={styles.section} aria-label={label}>
      <header className={styles.head}>
        <span className={styles.iconWrap} aria-hidden="true">
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.icon} />
          ) : (
            <span className={styles.iconFallback}>{label.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <h2 className={styles.title}>{label}</h2>
        <span className={styles.count}>
          {t('routing.provider_logins', { count: provider.accounts.length })}
        </span>
      </header>
      {provider.accounts.length === 0 ? (
        <p className={styles.empty}>{t('routing.provider_empty')}</p>
      ) : (
        <div className={styles.rows}>
          {provider.accounts.map((account) => (
            <RoutingAccountRow key={account.name} account={account} quotaClasses={quotaClasses} />
          ))}
        </div>
      )}
    </section>
  );
}
