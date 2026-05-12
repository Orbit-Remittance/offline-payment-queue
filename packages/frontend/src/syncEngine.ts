import { QueuedTransaction, SyncState, SubmitRequest, SubmitResponse, ReconcileResponse } from '@stellar-queue/shared';
import { TransactionQueue } from './queue';

const API = '/api';
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000]; // exponential backoff ms

export type SyncListener = (state: SyncState) => void;

export class SyncEngine {
  private queue: TransactionQueue;
  private listeners: Set<SyncListener> = new Set();
  private syncing = false;
  private lastSyncAt: number | null = null;
  private online = navigator.onLine;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(queue: TransactionQueue) {
    this.queue = queue;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  destroy(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }

  subscribe(fn: SyncListener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const state = this.getState();
    this.listeners.forEach(fn => fn(state));
  }

  getState(): SyncState {
    return {
      online: this.online,
      syncing: this.syncing,
      lastSyncAt: this.lastSyncAt,
      pendingCount: this.queue.getPending().length,
      failedCount: this.queue.getFailed().length,
    };
  }

  private handleOnline = (): void => {
    this.online = true;
    this.emit();
    this.sync();
  };

  private handleOffline = (): void => {
    this.online = false;
    this.emit();
  };

  /** Trigger a full sync cycle */
  async sync(): Promise<void> {
    if (!this.online || this.syncing) return;
    this.syncing = true;
    this.emit();

    try {
      const pending = this.queue.getPending();
      // Submit in sequence order (already ordered by queue.getPending())
      for (const tx of pending) {
        await this.submitOne(tx);
      }
      // Reconcile submitted transactions to check for confirmations
      await this.reconcileSubmitted();
      this.lastSyncAt = Date.now();
    } finally {
      this.syncing = false;
      this.emit();
    }
  }

  private async submitOne(tx: QueuedTransaction, attempt = 0): Promise<void> {
    const req: SubmitRequest = {
      id: tx.id,
      xdr: tx.xdr,
      hash: tx.hash,
      sourceAccount: tx.sourceAccount,
      sequence: tx.sequence,
      maxLedger: tx.maxLedger,
      createdAt: tx.createdAt,
    };

    try {
      const res = await fetch(`${API}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const data: SubmitResponse = await res.json();
      await this.queue.updateAndPersist(tx.id, {
        status: data.status,
        lastError: data.error,
        retryCount: tx.retryCount + (data.status === 'failed' ? 1 : 0),
        submittedAt: data.status === 'submitted' ? Date.now() : tx.submittedAt,
      });
      this.emit();
    } catch (err: any) {
      // Network error — retry with backoff if attempts remain
      if (attempt < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[attempt]);
        return this.submitOne(tx, attempt + 1);
      }
      await this.queue.updateAndPersist(tx.id, {
        status: 'failed',
        lastError: err.message || 'Network error',
        retryCount: tx.retryCount + 1,
      });
      this.emit();
    }
  }

  private async reconcileSubmitted(): Promise<void> {
    const submitted = this.queue.getOrdered().filter(t => t.status === 'submitted');
    if (!submitted.length) return;
    try {
      const res = await fetch(`${API}/transactions/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: submitted.map(t => t.id) }),
      });
      const data: ReconcileResponse = await res.json();
      for (const r of data.results) {
        await this.queue.updateAndPersist(r.id, {
          status: r.status,
          lastError: r.error,
          confirmedAt: r.status === 'confirmed' ? Date.now() : undefined,
        });
      }
      this.emit();
    } catch {
      // Non-fatal — will retry on next sync
    }
  }

  /** Schedule a sync after a delay (debounced) */
  scheduleSyncIn(ms: number): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync(), ms);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
