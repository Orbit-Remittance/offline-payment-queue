import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionQueue } from '../queue';
import { EncryptedStore } from '../store';
import { QueuedTransaction } from '@stellar-queue/shared';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(): EncryptedStore {
  // Bypass encryption for unit tests
  const txs: QueuedTransaction[] = [];
  return {
    load: async () => [...txs],
    save: async (list) => { txs.length = 0; txs.push(...list); },
    clear: () => { txs.length = 0; },
  } as unknown as EncryptedStore;
}

async function makeQueue(): Promise<TransactionQueue> {
  const q = new TransactionQueue(makeStore());
  await q.load();
  return q;
}

const BASE_PARAMS = {
  id: 'tx-1',
  xdr: 'AAAAAQAAAA==',
  sourceAccount: 'GABC',
  sequence: '100',
  maxLedger: 99999999,
};

// ── Queue Tests ───────────────────────────────────────────────────────────────

describe('TransactionQueue', () => {
  it('enqueues a transaction', async () => {
    const q = await makeQueue();
    const tx = await q.enqueue(BASE_PARAMS);
    expect(tx).not.toBeNull();
    expect(tx!.status).toBe('pending');
    expect(q.size()).toBe(1);
  });

  it('prevents duplicate XDR (same hash)', async () => {
    const q = await makeQueue();
    await q.enqueue(BASE_PARAMS);
    const dup = await q.enqueue({ ...BASE_PARAMS, id: 'tx-2' });
    expect(dup).toBeNull();
    expect(q.size()).toBe(1);
  });

  it('allows different XDR with same source+sequence', async () => {
    const q = await makeQueue();
    await q.enqueue(BASE_PARAMS);
    const tx2 = await q.enqueue({ ...BASE_PARAMS, id: 'tx-2', xdr: 'DIFFERENT==' });
    expect(tx2).not.toBeNull();
    expect(q.size()).toBe(2);
  });

  it('orders by sequence ASC then createdAt ASC', async () => {
    const q = await makeQueue();
    await q.enqueue({ ...BASE_PARAMS, id: 'tx-3', sequence: '300', xdr: 'XDR3==' });
    await q.enqueue({ ...BASE_PARAMS, id: 'tx-1', sequence: '100', xdr: 'XDR1==' });
    await q.enqueue({ ...BASE_PARAMS, id: 'tx-2', sequence: '200', xdr: 'XDR2==' });
    const ordered = q.getOrdered();
    expect(ordered.map(t => t.sequence)).toEqual(['100', '200', '300']);
  });

  it('marks expired transactions', async () => {
    const q = await makeQueue();
    await q.enqueue({ ...BASE_PARAMS, maxLedger: 10 });
    const expired = await q.markExpired(100);
    expect(expired).toHaveLength(1);
    expect(q.get('tx-1')!.status).toBe('expired');
  });

  it('does not expire confirmed transactions', async () => {
    const q = await makeQueue();
    await q.enqueue({ ...BASE_PARAMS, maxLedger: 10 });
    q.setStatus('tx-1', 'confirmed');
    const expired = await q.markExpired(100);
    expect(expired).toHaveLength(0);
  });

  it('retryFailed resets failed transactions to pending', async () => {
    const q = await makeQueue();
    await q.enqueue(BASE_PARAMS);
    q.setStatus('tx-1', 'failed');
    await q.retryFailed();
    expect(q.get('tx-1')!.status).toBe('pending');
  });

  it('does not retry transactions with retryCount >= 5', async () => {
    const q = await makeQueue();
    await q.enqueue(BASE_PARAMS);
    q.update('tx-1', { status: 'failed', retryCount: 5 });
    await q.retryFailed();
    expect(q.get('tx-1')!.status).toBe('failed');
  });

  it('persists and reloads state', async () => {
    const store = makeStore();
    const q1 = new TransactionQueue(store);
    await q1.load();
    await q1.enqueue(BASE_PARAMS);

    const q2 = new TransactionQueue(store);
    await q2.load();
    expect(q2.size()).toBe(1);
    expect(q2.get('tx-1')!.status).toBe('pending');
  });
});

// ── Sync Engine Tests ─────────────────────────────────────────────────────────

import { SyncEngine } from '../syncEngine';

describe('SyncEngine', () => {
  let queue: TransactionQueue;
  let engine: SyncEngine;

  beforeEach(async () => {
    queue = await makeQueue();
    // Simulate online
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
    engine = new SyncEngine(queue);
  });

  it('emits sync state to subscribers', () => {
    const states: any[] = [];
    engine.subscribe(s => states.push(s));
    expect(states.length).toBeGreaterThan(0);
    expect(states[0]).toHaveProperty('online');
    engine.destroy();
  });

  it('submits pending transactions in order', async () => {
    await queue.enqueue({ ...BASE_PARAMS, id: 'tx-a', sequence: '200', xdr: 'XDR_A==' });
    await queue.enqueue({ ...BASE_PARAMS, id: 'tx-b', sequence: '100', xdr: 'XDR_B==' });

    const submitted: string[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
      if (url.includes('/api/transactions') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        if (body.ids) {
          // reconcile
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
        }
        submitted.push(body.id);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: body.id, status: 'submitted' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
    });

    await engine.sync();
    // tx-b (seq 100) should be submitted before tx-a (seq 200)
    expect(submitted[0]).toBe('tx-b');
    expect(submitted[1]).toBe('tx-a');
    engine.destroy();
  });

  it('retries on network error with backoff', async () => {
    await queue.enqueue(BASE_PARAMS);
    let attempts = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      attempts++;
      if (attempts < 2) return Promise.reject(new Error('Network error'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'tx-1', status: 'submitted' }) });
    });

    // Speed up backoff for test
    vi.useFakeTimers();
    const syncPromise = engine.sync();
    await vi.runAllTimersAsync();
    await syncPromise;
    expect(attempts).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
    engine.destroy();
  });

  it('does not sync when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const offlineEngine = new SyncEngine(queue);
    await offlineEngine.sync();
    expect(fetchSpy).not.toHaveBeenCalled();
    offlineEngine.destroy();
  });

  it('reconciles submitted transactions', async () => {
    await queue.enqueue(BASE_PARAMS);
    queue.setStatus('tx-1', 'submitted');

    global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.ids) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ results: [{ id: 'tx-1', status: 'confirmed' }] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
    });

    await engine.sync();
    expect(queue.get('tx-1')!.status).toBe('confirmed');
    engine.destroy();
  });
});
