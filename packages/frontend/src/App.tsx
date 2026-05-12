import React from 'react';
import { useQueue } from './QueueContext';
import { SyncIndicator, TransactionList, TransactionForm } from './components';

export function App() {
  const { transactions, syncState, enqueue, retryFailed, sync, ready } = useQueue();

  if (!ready) return <div className="loading" role="status">Initializing secure storage…</div>;

  return (
    <main className="app">
      <header>
        <h1>Stellar Offline Payment Queue</h1>
        <SyncIndicator state={syncState} onSync={sync} onRetry={retryFailed} />
      </header>
      <TransactionForm onSubmit={enqueue} />
      <section>
        <h2>Queue ({transactions.length})</h2>
        <TransactionList transactions={transactions} />
      </section>
    </main>
  );
}
