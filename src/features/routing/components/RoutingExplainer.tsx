/**
 * Collapsible "How the order is decided" note; closed by default.
 */

import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import styles from './RoutingExplainer.module.scss';

const POINTS = ['priority', 'soonest_reset', 'affinity', 'exhausted'] as const;

export function RoutingExplainer() {
  const { t } = useTranslation();
  return (
    <Collapsible label={t('routing.explainer_title')} className={styles.root}>
      <ul className={styles.list}>
        {POINTS.map((key) => (
          <li key={key} className={styles.item}>
            {t(`routing.explainer_${key}`)}
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}
