/**
 * Quota page view preferences, persisted in localStorage (unlike the
 * session-scoped tab/sort state in features/quota/uiState.ts).
 *
 * `showEmails` is shared with the Routing page so one toggle masks addresses
 * on both pages — the reason it lives in a store rather than in page state.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEY_QUOTA_VIEW } from '@/utils/constants';

export const QUOTA_LAYOUTS = ['ledger', 'cards'] as const;
export type QuotaLayout = (typeof QUOTA_LAYOUTS)[number];

interface QuotaViewState {
  layout: QuotaLayout;
  /** False = addresses in file names are masked (`t•••@1•••.dev`). */
  showEmails: boolean;
  /** Ledger only: reveal Claude's general 7-day column next to the model-scoped one. */
  showGeneralWeekly: boolean;
  setLayout: (layout: QuotaLayout) => void;
  toggleShowEmails: () => void;
  toggleShowGeneralWeekly: () => void;
}

export const useQuotaViewStore = create<QuotaViewState>()(
  persist(
    (set) => ({
      layout: 'ledger',
      showEmails: true, // Fleet default: tailnet-only panel, and our two logins mask to the same string
      showGeneralWeekly: false,
      setLayout: (layout) => set({ layout }),
      toggleShowEmails: () => set((state) => ({ showEmails: !state.showEmails })),
      toggleShowGeneralWeekly: () =>
        set((state) => ({ showGeneralWeekly: !state.showGeneralWeekly })),
    }),
    { name: STORAGE_KEY_QUOTA_VIEW }
  )
);
