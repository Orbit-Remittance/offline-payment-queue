import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { TransactionStatus } from '@stellar-queue/shared';

export interface TxRecord {
  id: string;
  xdr: string;
  hash: string;
  source_account: string;
  sequence: string;
  max_ledger: number;
  created_at: number;
  updated_at: number;
  status: TransactionStatus;
  retry_count: number;
  last_error: string | null;
  stellar_hash: string | null;
  submitted_at: number | null;
  confirmed_at: number | null;
}

// Module-level state
let _SQL: SqlJsStatic | null = null;
let _db: Database | null = null;
let _initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (_db) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!_SQL) _SQL = await initSqlJs();
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'queue.db');
    const inMemory = dbPath === ':memory:';
    if (!inMemory && fs.existsSync(dbPath)) {
      _db = new _SQL.Database(fs.readFileSync(dbPath));
    } else {
      _db = new _SQL.Database();
    }
    migrate(_db);
    _initPromise = null;
  })();
  return _initPromise;
}

export async function getDb(): Promise<Database> {
  await ensureInit();
  return _db!;
}

export function saveDb(): void {
  if (!_db) return;
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'queue.db');
  if (dbPath === ':memory:') return;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(_db.export()));
}

export function closeDb(): void {
  _db?.close();
  _db = null;
  _SQL = null;
  _initPromise = null;
}

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      xdr TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      source_account TEXT NOT NULL,
      sequence TEXT NOT NULL,
      max_ledger INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      stellar_hash TEXT,
      submitted_at INTEGER,
      confirmed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_tx_source ON transactions(source_account, sequence);
    CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(hash);
  `);
}

export function dbGet<T>(db: Database, sql: string, params: any[] = []): T | undefined {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject() as T;
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

export function dbAll<T>(db: Database, sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}

export function dbRun(db: Database, sql: string, params: any[] = []): void {
  db.run(sql, params);
  saveDb();
}
