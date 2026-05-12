import { TransactionStatus, SubmitRequest, SubmitResponse, ReconcileResponse } from '@stellar-queue/shared';
import { getDb, dbGet, dbAll, dbRun, TxRecord } from './db';

const MAX_RETRIES = 5;
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';

async function submitToHorizon(xdr: string): Promise<{ stellarHash: string }> {
  const res = await fetch(`${HORIZON_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `tx=${encodeURIComponent(xdr)}`,
  });
  const body = await res.json() as any;
  if (!res.ok) {
    const extras = body?.extras?.result_codes;
    throw new Error(extras ? JSON.stringify(extras) : (body?.title || 'Horizon error'));
  }
  return { stellarHash: body.hash };
}

export async function submitTransaction(req: SubmitRequest): Promise<SubmitResponse> {
  const db = await getDb();
  const now = Date.now();

  const existing = dbGet<TxRecord>(db, 'SELECT * FROM transactions WHERE hash = ?', [req.hash]);
  if (existing) {
    return { id: req.id, status: existing.status, stellarHash: existing.stellar_hash ?? undefined };
  }

  const conflict = dbGet<{ id: string }>(db,
    `SELECT id FROM transactions WHERE source_account = ? AND sequence = ? AND status IN ('submitted','confirmed')`,
    [req.sourceAccount, req.sequence]
  );
  if (conflict) {
    dbRun(db,
      `INSERT INTO transactions (id,xdr,hash,source_account,sequence,max_ledger,created_at,updated_at,status,retry_count,last_error)
       VALUES (?,?,?,?,?,?,?,?,'duplicate',0,?)`,
      [req.id, req.xdr, req.hash, req.sourceAccount, req.sequence, req.maxLedger, req.createdAt, now, `Sequence already used by ${conflict.id}`]
    );
    return { id: req.id, status: 'duplicate', error: `Sequence already used by ${conflict.id}` };
  }

  dbRun(db,
    `INSERT OR IGNORE INTO transactions (id,xdr,hash,source_account,sequence,max_ledger,created_at,updated_at,status,retry_count)
     VALUES (?,?,?,?,?,?,?,?,'pending',0)`,
    [req.id, req.xdr, req.hash, req.sourceAccount, req.sequence, req.maxLedger, req.createdAt, now]
  );
  return { id: req.id, status: 'pending' };
}

export async function processTransaction(id: string): Promise<SubmitResponse> {
  const db = await getDb();
  const now = Date.now();
  const tx = dbGet<TxRecord>(db, 'SELECT * FROM transactions WHERE id = ?', [id]);
  if (!tx) return { id, status: 'failed', error: 'Not found' };
  if (tx.status === 'confirmed' || tx.status === 'duplicate') return { id, status: tx.status };

  const currentLedger = await getCurrentLedger();
  if (currentLedger > tx.max_ledger) {
    dbRun(db, `UPDATE transactions SET status='expired', updated_at=? WHERE id=?`, [now, id]);
    return { id, status: 'expired', error: 'Transaction expired' };
  }

  dbRun(db, `UPDATE transactions SET status='submitting', updated_at=? WHERE id=?`, [now, id]);

  try {
    const { stellarHash } = await submitToHorizon(tx.xdr);
    dbRun(db,
      `UPDATE transactions SET status='submitted', stellar_hash=?, submitted_at=?, updated_at=? WHERE id=?`,
      [stellarHash, now, now, id]
    );
    return { id, status: 'submitted', stellarHash };
  } catch (err: any) {
    const msg: string = err.message || 'Unknown error';
    const isFatal = msg.includes('tx_bad_seq') || msg.includes('tx_bad_auth') || msg.includes('tx_insufficient_balance');
    const newRetry = tx.retry_count + 1;
    const newStatus: TransactionStatus = (isFatal || newRetry >= MAX_RETRIES) ? 'failed' : 'pending';
    dbRun(db,
      `UPDATE transactions SET status=?, retry_count=?, last_error=?, updated_at=? WHERE id=?`,
      [newStatus, newRetry, msg, now, id]
    );
    return { id, status: newStatus, error: msg };
  }
}

export async function reconcileTransactions(ids: string[]): Promise<ReconcileResponse> {
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = dbAll<TxRecord>(db, `SELECT * FROM transactions WHERE id IN (${placeholders})`, ids);
  const map = new Map(rows.map(r => [r.id, r]));
  return {
    results: ids.map(id => {
      const r = map.get(id);
      if (!r) return { id, status: 'failed' as TransactionStatus, error: 'Not found' };
      return { id, status: r.status, stellarHash: r.stellar_hash ?? undefined, error: r.last_error ?? undefined };
    }),
  };
}

export async function getPendingTransactions(): Promise<TxRecord[]> {
  const db = await getDb();
  return dbAll<TxRecord>(db,
    `SELECT * FROM transactions WHERE status IN ('pending','submitting') ORDER BY sequence ASC, created_at ASC`
  );
}

async function getCurrentLedger(): Promise<number> {
  try {
    const res = await fetch(`${HORIZON_URL}/`);
    const body = await res.json() as any;
    return body?.core_latest_ledger ?? 0;
  } catch {
    return 0;
  }
}
