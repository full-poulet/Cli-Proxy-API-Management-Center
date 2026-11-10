/**
 * One provider block: brand icon + label + login count, the ordering-mode
 * switch (even drain / reset soonest / my order) with a one-line hint, then
 * the ranked rows. In "my order" mode the rows follow the editable order and
 * carry move up / down buttons; every change is saved to the router at once.
 */

import { useCallback, useId, useMemo, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaClassMap } from '@/features/quota/types';
import type { ResolvedTheme, RoutingMode, RoutingProvider } from '@/types';
import { ROUTING_MODES, buildEditableOrder, moveInOrder } from '../logic';
import { RoutingAccountRow } from './RoutingAccountRow';
import styles from './RoutingProviderSection.module.scss';

export type RoutingProviderSectionProps = {
  provider: RoutingProvider;
  resolvedTheme: ResolvedTheme;
  quotaClasses: QuotaClassMap;
  /** True while this provider's preference is being saved; controls go inert. */
  saving: boolean;
  /** Message of the last failed save for this provider, shown inline. */
  saveError: string | null;
  disableControls: boolean;
  onSavePreference: (mode: RoutingMode, order: string[]) => void;
};

export function RoutingProviderSection(props: RoutingProviderSectionProps) {
  const { provider, resolvedTheme, quotaClasses, saving, saveError, disableControls } = props;
  const { onSavePreference } = props;
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(provider.id, resolvedTheme);
  const label = provider.label || getTypeLabel(t, provider.id);
  const modeLabelId = useId();
  const manual = provider.mode === 'manual';
  const inert = saving || disableControls;

  // The order shown / edited in manual mode; also what gets sent along with any mode change.
  const editable = useMemo(
    () => buildEditableOrder(provider.accounts, provider.order),
    [provider.accounts, provider.order]
  );
  const editableNames = useMemo(() => editable.map((account) => account.name), [editable]);
  const rows = manual ? editable : provider.accounts;

  const selectMode = useCallback(
    (mode: RoutingMode) => {
      if (inert || mode === provider.mode) return;
      onSavePreference(mode, editableNames);
    },
    [editableNames, inert, onSavePreference, provider.mode]
  );

  const handleMove = useCallback(
    (name: string, direction: -1 | 1) => {
      if (inert) return;
      const next = moveInOrder(editableNames, name, direction);
      if (next === editableNames) return;
      onSavePreference('manual', [...next]);
    },
    [editableNames, inert, onSavePreference]
  );

  // Roving radio group: arrows move the selection, Home / End jump to the ends.
  const handleRadioKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = ROUTING_MODES.indexOf(provider.mode);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % ROUTING_MODES.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + ROUTING_MODES.length) % ROUTING_MODES.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = ROUTING_MODES.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const target = event.currentTarget.parentElement?.children.item(nextIndex);
    if (target instanceof HTMLElement) target.focus();
    selectMode(ROUTING_MODES[nextIndex]);
  };

  return (
    <section className={styles.section} aria-label={label} aria-busy={saving || undefined}>
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
        {provider.mode !== 'even' && (
          <span className={styles.modeBadge} title={t('routing.mode_set_hint')}>
            {t(`routing.mode_${provider.mode}`)}
          </span>
        )}
        <div className={styles.modeControl}>
          <span className={styles.modeLabel} id={modeLabelId}>
            {t('routing.mode_label')}
          </span>
          <div className={styles.segmented} role="radiogroup" aria-labelledby={modeLabelId}>
            {ROUTING_MODES.map((mode) => {
              const checked = mode === provider.mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-disabled={inert || undefined}
                  tabIndex={checked ? 0 : -1}
                  className={`${styles.segment} ${checked ? styles.segmentActive : ''}`}
                  onClick={() => selectMode(mode)}
                  onKeyDown={handleRadioKeyDown}
                >
                  {t(`routing.mode_${mode}`)}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <p className={styles.modeHint}>
        {saving ? t('routing.mode_saving') : t(`routing.mode_hint_${provider.mode}`)}
        {provider.mode !== 'even' && (
          <span className={styles.affinityNote}> {t('routing.affinity_note')}</span>
        )}
      </p>

      {saveError && (
        <p className={styles.saveError} role="alert">
          {t('routing.mode_save_failed', { message: saveError })}
        </p>
      )}

      {rows.length === 0 ? (
        <p className={styles.empty}>{t('routing.provider_empty')}</p>
      ) : (
        <div className={styles.rows}>
          {rows.map((account, index) => (
            <RoutingAccountRow
              key={account.name}
              account={account}
              quotaClasses={quotaClasses}
              reorder={
                manual
                  ? {
                      canMoveUp: index > 0,
                      canMoveDown: index < rows.length - 1,
                      inert,
                      onMove: (direction) => handleMove(account.name, direction),
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
