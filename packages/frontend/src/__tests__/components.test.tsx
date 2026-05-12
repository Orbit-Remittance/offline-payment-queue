import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { SyncIndicator, TransactionList, TransactionForm } from '../components';
import { SyncState, QueuedTransaction } from '@stellar-queue/shared';

const ONLINE_STATE: SyncState = { online: true, syncing: false, lastSyncAt: null, pendingCount: 2, failedCount: 1 };
const OFFLINE_STATE: SyncState = { online: false, syncing: false, lastSyncAt: null, pendingCount: 0, failedCount: 0 };

describe('SyncIndicator', () => {
  it('shows online status', () => {
    render(<SyncIndicator state={ONLINE_STATE} onSync={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/Online/)).toBeInTheDocument();
    expect(screen.getByText(/2 pending/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it('shows offline status', () => {
    render(<SyncIndicator state={OFFLINE_STATE} onSync={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it('calls onSync when Sync now clicked', () => {
    const onSync = vi.fn();
    render(<SyncIndicator state={ONLINE_STATE} onSync={onSync} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByText('Sync now'));
    expect(onSync).toHaveBeenCalledOnce();
  });

  it('calls onRetry when Retry failed clicked', () => {
    const onRetry = vi.fn();
    render(<SyncIndicator state={ONLINE_STATE} onSync={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(screen.getByText('Retry failed'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows syncing state', () => {
    render(<SyncIndicator state={{ ...ONLINE_STATE, syncing: true }} onSync={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/Syncing/)).toBeInTheDocument();
  });
});

describe('TransactionList', () => {
  const TX: QueuedTransaction = {
    id: 'abc12345-0000-0000-0000-000000000000',
    xdr: 'AAAAAQAAAA==',
    hash: 'hash1',
    sourceAccount: 'GABC1234567890',
    sequence: '100',
    maxLedger: 99999,
    createdAt: 1715000000000,
    updatedAt: 1715000000000,
    status: 'pending',
    retryCount: 0,
  };

  it('shows empty message when no transactions', () => {
    render(<TransactionList transactions={[]} />);
    expect(screen.getByText(/No transactions/)).toBeInTheDocument();
  });

  it('renders transaction rows', () => {
    render(<TransactionList transactions={[TX]} />);
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });
});

describe('TransactionForm', () => {
  it('calls onSubmit with correct params', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ id: 'new-id', status: 'pending' });
    render(<TransactionForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText(/Base64/), { target: { value: 'AAAAAQAAAA==' } });
    fireEvent.change(screen.getByPlaceholderText(/G…/), { target: { value: 'GABC' } });
    fireEvent.change(screen.getByPlaceholderText(/1234567890/), { target: { value: '100' } });
    fireEvent.change(screen.getByPlaceholderText(/50000000/), { target: { value: '99999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue Transaction' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const args = onSubmit.mock.calls[0][0];
    expect(args.xdr).toBe('AAAAAQAAAA==');
    expect(args.sourceAccount).toBe('GABC');
    expect(args.sequence).toBe('100');
    expect(args.maxLedger).toBe(99999999);
  });

  it('shows error for duplicate transaction', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<TransactionForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText(/Base64/), { target: { value: 'AAAAAQAAAA==' } });
    fireEvent.change(screen.getByPlaceholderText(/G…/), { target: { value: 'GABC' } });
    fireEvent.change(screen.getByPlaceholderText(/1234567890/), { target: { value: '100' } });
    fireEvent.change(screen.getByPlaceholderText(/50000000/), { target: { value: '99999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue Transaction' }));

    await waitFor(() => expect(screen.getByText(/Duplicate transaction/)).toBeInTheDocument());
  });

  it('shows validation error when fields missing', async () => {
    const onSubmit = vi.fn();
    render(<TransactionForm onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(screen.getByText(/All fields are required/)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
