import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useOnlineStatus } from './useOnlineStatus';

export interface QueuedAction {
  id: string;
  kind: 'attendance' | 'sales' | 'daily_report' | 'collection' | 'sales_rep' | 'absence';
  payload: Record<string, any>;
  queuedAt: string;
  label: string;
}

export function useOfflineQueue(userId: number | null, onSynced?: () => void) {
  const isOnline = useOnlineStatus();
  const storageKey = userId ? `pbs_offline_queue_${userId}` : null;
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Load persisted offline queue when user changes
  useEffect(() => {
    if (!storageKey) {
      setQueue([]);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      setQueue(raw ? JSON.parse(raw) : []);
    } catch {
      setQueue([]);
    }
  }, [storageKey]);

  const persistQueue = useCallback(
    (next: QueuedAction[]) => {
      setQueue(next);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Storage quota fallback
        }
      }
    },
    [storageKey]
  );

  const enqueue = useCallback(
    (item: Omit<QueuedAction, 'id' | 'queuedAt'>) => {
      const entry: QueuedAction = {
        ...item,
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        queuedAt: new Date().toISOString(),
      };
      setQueue((prev) => {
        const next = [...prev, entry];
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            // ignore
          }
        }
        return next;
      });
    },
    [storageKey]
  );

  const flushQueue = useCallback(async () => {
    if (!storageKey || syncing || !navigator.onLine) return;
    let current: QueuedAction[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      current = raw ? JSON.parse(raw) : [];
    } catch {
      current = [];
    }
    if (current.length === 0) return;

    setSyncing(true);
    const remaining: QueuedAction[] = [];
    let syncedAny = false;

    for (let i = 0; i < current.length; i++) {
      const item = current[i];
      try {
        if (item.kind === 'attendance') {
          await apiFetch('/api/attendance/record', {
            method: 'POST',
            body: JSON.stringify(item.payload),
          });
        } else if (item.kind === 'sales') {
          await apiFetch('/api/sales', {
            method: 'POST',
            body: JSON.stringify(item.payload),
          });
        } else if (item.kind === 'daily_report') {
          await apiFetch('/api/daily-reports', {
            method: 'POST',
            body: JSON.stringify(item.payload),
          });
        } else if (item.kind === 'collection') {
          await apiFetch('/api/collector/reports', {
            method: 'POST',
            body: JSON.stringify(item.payload),
          });
        } else if (item.kind === 'sales_rep') {
          await apiFetch('/api/sales-rep/reports', {
            method: 'POST',
            body: JSON.stringify(item.payload),
          });
        } else if (item.kind === 'absence') {
          await apiFetch('/api/absence-reports', {
            method: 'POST',
            body: JSON.stringify(item.payload),
          });
        }
        syncedAny = true;
      } catch (err: any) {
        // Keep in queue if network error or 5xx; discard only if 400 validation error
        if (err?.status && err.status >= 400 && err.status < 500 && err.status !== 401) {
          continue;
        }
        remaining.push(...current.slice(i));
        break;
      }
    }

    persistQueue(remaining);
    setSyncing(false);
    if (syncedAny && onSynced) {
      onSynced();
    }
  }, [storageKey, syncing, persistQueue, onSynced]);

  useEffect(() => {
    if (isOnline && queue.length > 0) {
      flushQueue();
    }
  }, [isOnline, queue.length, flushQueue]);

  return {
    isOnline,
    queue,
    syncing,
    enqueue,
    flushQueue,
  };
}
