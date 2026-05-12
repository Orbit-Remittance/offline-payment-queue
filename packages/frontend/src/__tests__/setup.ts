import '@testing-library/jest-dom';

// Mock Web Crypto API for jsdom
const mockKey = {} as CryptoKey;

Object.defineProperty(globalThis, 'crypto', {
  value: {
    getRandomValues: (arr: Uint8Array) => { arr.fill(1); return arr; },
    randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
    subtle: {
      importKey: async () => mockKey,
      deriveKey: async () => mockKey,
      encrypt: async (_: any, __: any, data: BufferSource) => {
        const bytes = new Uint8Array(data as ArrayBuffer);
        return bytes.buffer;
      },
      decrypt: async (_: any, __: any, data: BufferSource) => {
        return data as ArrayBuffer;
      },
      digest: async (_: any, data: BufferSource) => {
        // Simple mock: return first 32 bytes or pad
        const bytes = new Uint8Array(data as ArrayBuffer);
        const out = new Uint8Array(32);
        out.set(bytes.slice(0, 32));
        return out.buffer;
      },
    },
  },
  writable: true,
});

// Mock localStorage
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  },
  writable: true,
});
