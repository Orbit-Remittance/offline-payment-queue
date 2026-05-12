import React from 'react';
import { SyncState, QueuedTransaction, TransactionStatus } from '@stellar-queue/shared';

// ── Sync Indicator ──────────────────────────────────────────────────────────

export function SyncIndicator({ state, onSync, onRetry }: {
  state: SyncState;
  onSync: () => void;
  onRetry: () => void;
}) {
  const dot = state.online ? (state.syncing ? '🔄' : '🟢') : '🔴';
  return (
    <div className="sync-bar" role="status" aria-live="polite">
      <span>{dot} {state.online ? (state.syncing ? 'Syncing…' : 'Online') : 'Offline'}</span>
      <span className="counts">
        {state.pendingCount > 0 && <span className="badge pending">{state.pendingCount} pending</span>}
        {state.failedCount > 0 && <span className="badge failed">{state.failedCount} failed</span>}
      </span>
      {state.lastSyncAt && (
        <span className="last-sync">Last sync: {new Date(state.lastSyncAt).toLocaleTimeString()}</span>
      )}
      <div className="actions">
        {state.online && !state.syncing && (
          <button onClick={onSync} aria-label="Sync now">Sync now</button>
        )}
        {state.failedCount > 0 && (
          <button onClick={onRetry} aria-label="Retry failed transactions">Retry failed</button>
        )}
      </div>
    </div>
  );
}

// ── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<TransactionStatus, string> = {
  pending: 'Pending',
  submitting: 'Submitting',
  submitted: 'Submitted',
  confirmed: 'Confirmed ✓',
  failed: 'Failed ✗',
  expired: 'Expired',
  duplicate: 'Duplicate',
};

function StatusBadge({ status }: { status: TransactionStatus }) {
  return <span className={`status-badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

// ── Transaction Row ───────────────────────────────────────────────────────────

function TxRow({ tx }: { tx: QueuedTransaction }) {
  return (
    <tr>
      <td title={tx.id}>{tx.id.slice(0, 8)}…</td>
      <td title={tx.sourceAccount}>{tx.sourceAccount.slice(0, 8)}…</td>
      <td>{tx.sequence}</td>
      <td><StatusBadge status={tx.status} /></td>
      <td>{tx.retryCount}</td>
      <td>{new Date(tx.createdAt).toLocaleString()}</td>
      {tx.lastError && <td className="error" title={tx.lastError}>{tx.lastError.slice(0, 40)}</td>}
    </tr>
  );
}

// ── Transaction List ──────────────────────────────────────────────────────────

export function TransactionList({ transactions }: { transactions: QueuedTransaction[] }) {
  if (!transactions.length) {
    return <p className="empty">No transactions in queue.</p>;
  }
  return (
    <div className="tx-list" role="region" aria-label="Transaction queue">
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Source</th><th>Sequence</th><th>Status</th><th>Retries</th><th>Created</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map(tx => <TxRow key={tx.id} tx={tx} />)}
        </tbody>
      </table>
    </div>
  );
}

// ── Transaction Form ──────────────────────────────────────────────────────────

interface TxFormProps {
  onSubmit: (params: { id: string; xdr: string; sourceAccount: string; sequence: string; maxLedger: number }) => Promise<QueuedTransaction | null>;
}

export function TransactionForm({ onSubmit }: TxFormProps) {
  const [xdr, setXdr] = React.useState('');
  const [sourceAccount, setSourceAccount] = React.useState('');
  const [sequence, setSequence] = React.useState('');
  const [maxLedger, setMaxLedger] = React.useState('');
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!xdr || !sourceAccount || !sequence || !maxLedger) {
      setError('All fields are required');
      return;
    }
    setSubmitting(true);
    try {
      const id = crypto.randomUUID();
      const result = await onSubmit({ id, xdr, sourceAccount, sequence, maxLedger: Number(maxLedger) });
      if (!result) {
        setError('Duplicate transaction (same XDR already queued)');
      } else {
        setXdr(''); setSourceAccount(''); setSequence(''); setMaxLedger('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="tx-form" aria-label="Queue transaction">
      <h2>Queue Transaction</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      <label>
        Signed XDR
        <textarea value={xdr} onChange={e => setXdr(e.target.value)} rows={4} placeholder="Base64-encoded signed XDR" required />
      </label>
      <label>
        Source Account
        <input value={sourceAccount} onChange={e => setSourceAccount(e.target.value)} placeholder="G…" required />
      </label>
      <label>
        Sequence Number
        <input value={sequence} onChange={e => setSequence(e.target.value)} placeholder="e.g. 1234567890" required />
      </label>
      <label>
        Max Ledger
        <input type="number" value={maxLedger} onChange={e => setMaxLedger(e.target.value)} placeholder="e.g. 50000000" required />
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Queuing…' : 'Queue Transaction'}</button>
    </form>
  );
}
