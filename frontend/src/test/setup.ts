import '@testing-library/jest-dom/vitest';

// jsdom lacks crypto.subtle — the shared signing module needs it.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
if (typeof globalThis.window !== 'undefined' && !globalThis.window.crypto?.subtle) {
  Object.defineProperty(globalThis.window, 'crypto', { value: webcrypto, configurable: true });
}
