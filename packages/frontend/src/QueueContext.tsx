import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { QueuedTransaction, SyncState } from '@stellar-queue/shared';
import { EncryptedStore } from './store';
import { TransactionQueue } from './queue';
import { SyncEngine } from './syncEngine';

interface QueueContextValue {
  transactions: QueuedTransaction[];
  syncState: SyncState;
  enqueue: (params: {
    id: string; xdr: string; sourceAccount: string; sequence: string; maxLedger: number;
  }) => Promise<QueuedTransaction | null>;
  retryFailed: () => Promise<void>;
  sync: () => Promise<void>;
  ready: boolean;
}

const QueueContext = createContext<QueueContextValue | null>(null);

export function QueueProvider({ password, children }: { password: string; children: React.ReactNode }) {
  const [transactions, setTransactions] = useState<QueuedTransaction[]>([]);
  const [syncState, setSyncState] = useState<SyncState>({ online: navigator.onLine, syncing: false, lastSyncAt: null, pendingCount: 0, failedCount: 0 });
  const [ready, setReady] = useState(false);
  const queueRef = useRef<TransactionQueue | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);

  const refresh = useCallback(() => {
    if (queueRef.current) setTransactions(queueRef.current.getOrdered());
  }, []);

  useEffect(() => {
    let engine: SyncEngine;
    (async () => {
      const store = await EncryptedStore.open(password);
      const queue = new TransactionQueue(store);
      await queue.load();
      queueRef.current = queue;
      engine = new SyncEngine(queue);
      engineRef.current = engine;
      engine.subscribe(state => {
        setSyncState(state);
        refresh();
      });
      refresh();
      setReady(true);
      if (navigator.onLine) engine.sync();
    })();
    return () => { engine?.destroy(); };
  }, [password, refresh]);

  const enqueue = useCallback(async (params: Parameters<TransactionQueue['enqueue']>[0]) => {
    const q = queueRef.current;
    if (!q) return null;
    const tx = await q.enqueue(params);
    refresh();
    if (tx && navigator.onLine) engineRef.current?.scheduleSyncIn(500);
    return tx;
  }, [refresh]);

  const retryFailed = useCallback(async () => {
    await queueRef.current?.retryFailed();
    refresh();
    engineRef.current?.scheduleSyncIn(500);
  }, [refresh]);

  const sync = useCallback(() => engineRef.current?.sync() ?? Promise.resolve(), []);

  return (
    <QueueContext.Provider value={{ transactions, syncState, enqueue, retryFailed, sync, ready }}>
      {children}
    </QueueContext.Provider>
  );
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error('useQueue must be used within QueueProvider');
  return ctx;
}
