import { QueuedTransaction, TransactionStatus } from '@stellar-queue/shared';
import { sha256hex } from './crypto';
import { EncryptedStore } from './store';

export class TransactionQueue {
  private txs: Map<string, QueuedTransaction> = new Map();
  private store: EncryptedStore;

  constructor(store: EncryptedStore) {
    this.store = store;
  }

  async load(): Promise<void> {
    const list = await this.store.load();
    this.txs = new Map(list.map(t => [t.id, t]));
  }

  async persist(): Promise<void> {
    await this.store.save(this.getOrdered());
  }

  /** Add a new transaction. Returns false if duplicate XDR hash detected. */
  async enqueue(params: {
    id: string;
    xdr: string;
    sourceAccount: string;
    sequence: string;
    maxLedger: number;
  }): Promise<QueuedTransaction | null> {
    const hash = await sha256hex(params.xdr);
    // Duplicate check
    for (const tx of this.txs.values()) {
      if (tx.hash === hash) return null;
    }
    const now = Date.now();
    const tx: QueuedTransaction = {
      ...params,
      hash,
      createdAt: now,
      updatedAt: now,
      status: 'pending',
      retryCount: 0,
    };
    this.txs.set(tx.id, tx);
    await this.persist();
    return tx;
  }

  update(id: string, patch: Partial<QueuedTransaction>): void {
    const tx = this.txs.get(id);
    if (!tx) return;
    this.txs.set(id, { ...tx, ...patch, updatedAt: Date.now() });
  }

  async updateAndPersist(id: string, patch: Partial<QueuedTransaction>): Promise<void> {
    this.update(id, patch);
    await this.persist();
  }

  get(id: string): QueuedTransaction | undefined {
    return this.txs.get(id);
  }

  /** Returns transactions ordered by sequence ASC, then createdAt ASC (deterministic) */
  getOrdered(): QueuedTransaction[] {
    return [...this.txs.values()].sort((a, b) => {
      const seqDiff = BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0;
      return seqDiff !== 0 ? seqDiff : a.createdAt - b.createdAt;
    });
  }

  getPending(): QueuedTransaction[] {
    return this.getOrdered().filter(t => t.status === 'pending');
  }

  getFailed(): QueuedTransaction[] {
    return this.getOrdered().filter(t => t.status === 'failed');
  }

  /** Mark expired transactions based on current ledger */
  async markExpired(currentLedger: number): Promise<string[]> {
    const expired: string[] = [];
    for (const tx of this.txs.values()) {
      if ((tx.status === 'pending' || tx.status === 'failed') && currentLedger > tx.maxLedger) {
        this.update(tx.id, { status: 'expired' });
        expired.push(tx.id);
      }
    }
    if (expired.length) await this.persist();
    return expired;
  }

  async retryFailed(): Promise<void> {
    let changed = false;
    for (const tx of this.txs.values()) {
      if (tx.status === 'failed' && tx.retryCount < 5) {
        this.update(tx.id, { status: 'pending', lastError: undefined });
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  setStatus(id: string, status: TransactionStatus, extra?: Partial<QueuedTransaction>): void {
    this.update(id, { status, ...extra });
  }

  size(): number { return this.txs.size; }
}
