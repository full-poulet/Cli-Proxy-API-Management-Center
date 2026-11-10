/**
 * Routing payload with a 60 s poll while the page is mounted.
 *
 * Stale-request guard: every request takes an id; the id is bumped on unmount,
 * on connection change and before each new request, so a slow old response
 * never overwrites a newer one (same pattern as the Quota page file list).
 *
 * The `refreshing` flag is tracked by a separate token: the 60 s poll bumps the
 * shared request id, and if that happened while a manual refresh was in flight
 * the refresh would otherwise never clear its own spinner.
 *
 * Preference saves (ordering mode / manual order) get their own token too: the
 * reply of the newest save always wins, polls are skipped while one is in
 * flight, and a poll that was already running when the save started is dropped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { routingApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import type { RoutingMode, RoutingPayload } from '@/types';

const POLL_INTERVAL_MS = 60_000;

export interface RoutingPayloadState {
  payload: RoutingPayload | null;
  /** True until the first response (success or error) lands. */
  loading: boolean;
  /** True while a manual "re-evaluate" request is in flight. */
  refreshing: boolean;
  error: string | null;
  /** Last manual refresh was answered from cache (router throttles to once / 60 s). */
  throttled: boolean;
  refresh: () => Promise<void>;
  /** Provider id whose ordering preference is being saved right now, else null. */
  savingProvider: string | null;
  /** Last preference save that failed, so the section can show it inline. */
  saveError: { provider: string; message: string } | null;
  /**
   * Save a provider's ordering mode + manual order. The reply replaces the
   * payload; a poll that was in flight when the save started is discarded.
   */
  savePreference: (provider: string, mode: RoutingMode, order: string[]) => Promise<void>;
}

export function useRoutingPayload(enabled: boolean): RoutingPayloadState {
  const apiBase = useAuthStore((state) => state.apiBase);
  const [payload, setPayload] = useState<RoutingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [throttled, setThrottled] = useState(false);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ provider: string; message: string } | null>(null);
  const savingRef = useRef(false);
  const requestRef = useRef(0);
  const refreshRef = useRef(0);
  const saveRef = useRef(0);
  /** Bumped on unmount / connection change so a late save reply cannot touch a new session. */
  const sessionRef = useRef(0);

  const run = useCallback(
    async (mode: 'poll' | 'refresh') => {
      if (!enabled || !apiBase) return;
      // The save reply carries the fresh ranking; a poll meanwhile could only be older.
      if (mode === 'poll' && savingRef.current) return;
      const requestId = ++requestRef.current;
      const isCurrent = () => requestId === requestRef.current;
      const refreshToken = mode === 'refresh' ? ++refreshRef.current : null;
      if (refreshToken !== null) setRefreshing(true);
      try {
        const next =
          mode === 'refresh'
            ? await routingApi.refresh(apiBase)
            : await routingApi.getRouting(apiBase);
        if (!isCurrent()) return;
        setPayload(next);
        setError(null);
        // A poll that comes back un-throttled clears the flag from an earlier refresh.
        setThrottled(next.throttled);
      } catch (err: unknown) {
        if (!isCurrent()) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isCurrent()) setLoading(false);
        // Cleared by the latest refresh only, regardless of what the poll did meanwhile.
        if (refreshToken !== null && refreshToken === refreshRef.current) setRefreshing(false);
      }
    },
    [apiBase, enabled]
  );

  const savePreference = useCallback(
    async (provider: string, mode: RoutingMode, order: string[]) => {
      if (!enabled || !apiBase) return;
      // Drop any poll / refresh already in flight: its answer predates this save.
      requestRef.current += 1;
      const session = sessionRef.current;
      const saveToken = ++saveRef.current;
      const isCurrent = () => session === sessionRef.current && saveToken === saveRef.current;
      savingRef.current = true;
      setSavingProvider(provider);
      setSaveError(null);
      try {
        const next = await routingApi.savePreference(apiBase, provider, mode, order);
        if (!isCurrent()) return;
        setPayload(next);
        setError(null);
      } catch (err: unknown) {
        if (!isCurrent()) return;
        setSaveError({ provider, message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (isCurrent()) {
          savingRef.current = false;
          setSavingProvider(null);
        }
      }
    },
    [apiBase, enabled]
  );

  useEffect(() => {
    if (!enabled || !apiBase) {
      setPayload(null);
      setLoading(false);
      setSavingProvider(null);
      setSaveError(null);
      return;
    }
    setLoading(true);
    void run('poll');
    const timer = window.setInterval(() => void run('poll'), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      requestRef.current += 1;
      sessionRef.current += 1;
      savingRef.current = false;
    };
  }, [apiBase, enabled, run]);

  const refresh = useCallback(() => run('refresh'), [run]);

  return {
    payload,
    loading,
    refreshing,
    error,
    throttled,
    refresh,
    savingProvider,
    saveError,
    savePreference,
  };
}
