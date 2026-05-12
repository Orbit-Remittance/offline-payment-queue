import request from 'supertest';
import { createApp } from '../server';
import { closeDb, getDb, dbRun } from '../db';

// ── Mock fetch ────────────────────────────────────────────────────────────────
// Horizon submit: POST /transactions  → horizonSubmitResult
// Ledger check:   GET  /             → { core_latest_ledger }

interface HorizonResult { ok: boolean; body: any }
let horizonSubmit: HorizonResult = { ok: true, body: { hash: 'stellar-hash-001' } };
let currentLedger = 1000;

global.fetch = jest.fn().mockImplementation((url: string, opts?: any) => {
  const isPost = opts?.method === 'POST';
  if (isPost) {
    // Horizon transaction submit
    return Promise.resolve({ ok: horizonSubmit.ok, json: () => Promise.resolve(horizonSubmit.body) });
  }
  // Ledger check (GET /)
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ core_latest_ledger: currentLedger }) });
}) as any;

// ── App ───────────────────────────────────────────────────────────────────────
const app = createApp();

const BASE_TX = {
  id: 'tx-001',
  xdr: 'AAAAAQAAAA==',
  hash: 'abc123',
  sourceAccount: 'GABC',
  sequence: '100',
  maxLedger: 99999999,
  createdAt: Date.now(),
};

beforeEach(() => {
  process.env.DB_PATH = ':memory:';
  closeDb();
  horizonSubmit = { ok: true, body: { hash: 'stellar-hash-001' } };
  currentLedger = 1000;
});

afterAll(() => closeDb());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/transactions', () => {
  it('submits a valid transaction', async () => {
    const res = await request(app).post('/api/transactions').send(BASE_TX);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
    expect(res.body.stellarHash).toBe('stellar-hash-001');
  });

  it('returns 400 for missing fields', async () => {
    const res = await request(app).post('/api/transactions').send({ id: 'x' });
    expect(res.status).toBe(400);
  });

  it('prevents duplicate XDR hash — returns existing status', async () => {
    await request(app).post('/api/transactions').send(BASE_TX);
    const res = await request(app).post('/api/transactions').send(BASE_TX);
    expect(res.body.status).toBe('submitted');
  });

  it('marks failed when Horizon rejects with tx_bad_seq', async () => {
    horizonSubmit = {
      ok: false,
      body: { title: 'Transaction Failed', extras: { result_codes: { transaction: 'tx_bad_seq' } } },
    };
    const tx = { ...BASE_TX, id: 'tx-bad', hash: 'hash-bad' };
    const res = await request(app).post('/api/transactions').send(tx);
    expect(res.body.status).toBe('failed');
    expect(res.body.error).toContain('tx_bad_seq');
  });

  it('prevents sequence replay after confirmed', async () => {
    await request(app).post('/api/transactions').send(BASE_TX);
    const db = await getDb();
    dbRun(db, `UPDATE transactions SET status='confirmed' WHERE id=?`, [BASE_TX.id]);

    const tx2 = { ...BASE_TX, id: 'tx-002', hash: 'different-hash' };
    const res = await request(app).post('/api/transactions').send(tx2);
    expect(res.body.status).toBe('duplicate');
  });
});

describe('POST /api/transactions/reconcile', () => {
  it('returns status for known transactions', async () => {
    await request(app).post('/api/transactions').send(BASE_TX);
    const res = await request(app).post('/api/transactions/reconcile').send({ ids: [BASE_TX.id] });
    expect(res.status).toBe(200);
    expect(['submitted', 'confirmed']).toContain(res.body.results[0].status);
  });

  it('returns error for unknown ids', async () => {
    const res = await request(app).post('/api/transactions/reconcile').send({ ids: ['unknown'] });
    expect(res.body.results[0].error).toBe('Not found');
  });

  it('rejects empty ids', async () => {
    const res = await request(app).post('/api/transactions/reconcile').send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it('rejects more than 100 ids', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const res = await request(app).post('/api/transactions/reconcile').send({ ids });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/transactions/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/transactions/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns transaction status', async () => {
    await request(app).post('/api/transactions').send(BASE_TX);
    const res = await request(app).get(`/api/transactions/${BASE_TX.id}`);
    expect(res.status).toBe(200);
    expect(['submitted', 'confirmed']).toContain(res.body.status);
  });
});

describe('Expiration', () => {
  it('marks transaction expired when ledger exceeds maxLedger', async () => {
    currentLedger = 100_000_000; // past maxLedger
    const tx = { ...BASE_TX, id: 'tx-expire', hash: 'hash-expire', maxLedger: 1 };
    const res = await request(app).post('/api/transactions').send(tx);
    expect(res.body.status).toBe('expired');
  });
});

describe('Sequence integrity', () => {
  it('allows same source with different sequences', async () => {
    const tx1 = { ...BASE_TX, id: 'tx-s1', hash: 'hash-s1', sequence: '100' };
    const tx2 = { ...BASE_TX, id: 'tx-s2', hash: 'hash-s2', sequence: '101' };
    const r1 = await request(app).post('/api/transactions').send(tx1);
    const r2 = await request(app).post('/api/transactions').send(tx2);
    expect(['submitted', 'confirmed']).toContain(r1.body.status);
    expect(['submitted', 'confirmed']).toContain(r2.body.status);
  });

  it('rejects same source+sequence from different accounts after submission', async () => {
    await request(app).post('/api/transactions').send(BASE_TX);
    const db = await getDb();
    dbRun(db, `UPDATE transactions SET status='submitted' WHERE id=?`, [BASE_TX.id]);

    const tx2 = { ...BASE_TX, id: 'tx-replay', hash: 'hash-replay' };
    const res = await request(app).post('/api/transactions').send(tx2);
    expect(res.body.status).toBe('duplicate');
  });
});
