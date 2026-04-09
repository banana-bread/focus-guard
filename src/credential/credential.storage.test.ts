import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/__mocks__/chrome';
import { getCredential, setCredential } from '@/credential/credential.storage';

const storageMap = new Map<string, unknown>();

beforeEach(() => {
  storageMap.clear();
  vi.mocked(chrome.storage.local.get).mockImplementation(((key: string) =>
    Promise.resolve({ [key]: storageMap.get(key) })) as typeof chrome.storage.local.get);
  vi.mocked(chrome.storage.local.set).mockImplementation(((obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) storageMap.set(k, v);
    return Promise.resolve();
  }) as typeof chrome.storage.local.set);
});

describe('credential storage round-trip', () => {
  it('correctly deserialises credentialId and publicKey after a storage restart simulation', async () => {
    // Simulate what chrome.storage does: store as number[], read back as number[]
    // (this is what JSON serialization produces for our wire format)
    const originalCredentialId = new Uint8Array([1, 2, 3, 4, 5]);
    const originalPublicKey = new Uint8Array([10, 20, 30, 40]).buffer;

    await setCredential({
      credentialId: originalCredentialId,
      publicKey: originalPublicKey,
      signCounter: 42,
      aaguid: '2fc0579f-8113-47ea-b116-bb5a8db9202a',
    });

    const retrieved = await getCredential();
    expect(retrieved).toBeDefined();
    expect(Array.from(retrieved!.credentialId)).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(new Uint8Array(retrieved!.publicKey))).toEqual([10, 20, 30, 40]);
    expect(retrieved!.signCounter).toBe(42);
    expect(retrieved!.aaguid).toBe('2fc0579f-8113-47ea-b116-bb5a8db9202a');
  });

  it('returns undefined when no credential stored', async () => {
    const result = await getCredential();
    expect(result).toBeUndefined();
  });
});
