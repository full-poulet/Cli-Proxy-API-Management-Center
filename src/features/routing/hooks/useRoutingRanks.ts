/**
 * One-shot routing ranks for the Quota page chips (`#1 next`, `#2`).
 *
 * Loads the payload once per mount; a missing router is not an error for the
 * Quota page, so failures just leave the map empty and no chip is rendered.
 */

import { useEffect, useState } from 'react';
import { routingApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import { buildRankIndex, type RoutingRankChip } from '../logic';

const EMPTY: Map<string, RoutingRankChip> = new Map();

export function useRoutingRanks(enabled: boolean): Map<string, RoutingRankChip> {
  const apiBase = useAuthStore((state) => state.apiBase);
  const [ranks, setRanks] = useState<Map<string, RoutingRankChip>>(EMPTY);

  useEffect(() => {
    if (!enabled || !apiBase) {
      setRanks(EMPTY);
      return;
    }
    const controller = new AbortController();
    routingApi
      .getRouting(apiBase, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setRanks(buildRankIndex(payload));
      })
      .catch(() => {
        if (!controller.signal.aborted) setRanks(EMPTY);
      });
    return () => controller.abort();
  }, [apiBase, enabled]);

  return ranks;
}
