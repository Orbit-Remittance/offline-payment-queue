import { QueuedTransaction } from '@stellar-queue/shared';
import { deriveKey, encrypt, decrypt } from './crypto';

const STORE_KEY = 'stellar_queue_v1';
const SALT_KEY = 'stellar_queue_salt_v1';

function getSalt(): Uint8Array {
  const stored = localStorage.getItem(SALT_KEY);
  if (stored) return Uint8Array.from(atob(stored), c => c.charCodeAt(0));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(SALT_KEY, btoa(String.fromCharCode(...salt)));
  return salt;
}

export class EncryptedStore {
  private key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.key = key;
  }

  static async open(password: string): Promise<EncryptedStore> {
    const salt = getSalt();
    const key = await deriveKey(password, salt);
    return new EncryptedStore(key);
  }

  async load(): Promise<QueuedTransaction[]> {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    try {
      const json = await decrypt(this.key, raw);
      return JSON.parse(json) as QueuedTransaction[];
    } catch {
      // Corrupted or wrong key — return empty (don't wipe, let caller decide)
      return [];
    }
  }

  async save(txs: QueuedTransaction[]): Promise<void> {
    const json = JSON.stringify(txs);
    const encoded = await encrypt(this.key, json);
    localStorage.setItem(STORE_KEY, encoded);
  }

  clear(): void {
    localStorage.removeItem(STORE_KEY);
  }
}
