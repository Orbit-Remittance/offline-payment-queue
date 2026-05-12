export type TransactionStatus =
  | 'pending'
  | 'submitting'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'expired'
  | 'duplicate';

export interface QueuedTransaction {
  id: string;               // client-generated UUID
  xdr: string;              // base64-encoded signed Stellar XDR
  hash: string;             // SHA-256 of XDR (dedup key)
  sourceAccount: string;    // Stellar account address
  sequence: string;         // account sequence number (bigint as string)
  maxLedger: number;        // transaction timeBounds maxLedger
  createdAt: number;        // unix ms
  updatedAt: number;        // unix ms
  status: TransactionStatus;
  retryCount: number;
  lastError?: string;
  submittedAt?: number;
  confirmedAt?: number;
}

export interface SubmitRequest {
  id: string;
  xdr: string;
  hash: string;
  sourceAccount: string;
  sequence: string;
  maxLedger: number;
  createdAt: number;
}

export interface SubmitResponse {
  id: string;
  status: TransactionStatus;
  stellarHash?: string;
  error?: string;
}

export interface ReconcileRequest {
  ids: string[];
}

export interface ReconcileResponse {
  results: Array<{
    id: string;
    status: TransactionStatus;
    stellarHash?: string;
    error?: string;
  }>;
}

export interface SyncState {
  online: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  pendingCount: number;
  failedCount: number;
}
