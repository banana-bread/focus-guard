import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/__mocks__/chrome';

vi.mock('@/shared/webauthn', () => ({
  verifyRegistration: vi.fn(),
}));

import { verifyRegistration } from '@/shared/webauthn';
import {
  handleGetRegistrationChallenge,
  handleRegisterCredential,
  handleGetCredentialStatus,
} from '@/credential/credential.handler';
import type { RequestMessage } from '@/core/messages';

const mockVerifyRegistration = vi.mocked(verifyRegistration);

const storageMap = new Map<string, unknown>();
beforeEach(() => {
  storageMap.clear();
  vi.mocked(chrome.storage.local.get).mockImplementation(((key: string) =>
    Promise.resolve({ [key]: storageMap.get(key) })) as typeof chrome.storage.local.get);
  vi.mocked(chrome.storage.local.set).mockImplementation(((obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) storageMap.set(k, v);
    return Promise.resolve();
  }) as typeof chrome.storage.local.set);
  vi.mocked(chrome.storage.local.remove).mockImplementation(((key: string) => {
    storageMap.delete(key);
    return Promise.resolve();
  }) as typeof chrome.storage.local.remove);
  mockVerifyRegistration.mockReset();
});

describe('handleGetRegistrationChallenge', () => {
  it('returns 32-element number[] challenge', () => {
    const resp = handleGetRegistrationChallenge('t1');
    expect(resp.ok).toBe(true);
    const data = (resp as { ok: true; data: { challenge: number[] } }).data;
    expect(Array.isArray(data.challenge)).toBe(true);
    expect(data.challenge).toHaveLength(32);
  });
});

describe('handleRegisterCredential', () => {
  it('succeeds with valid registration', async () => {
    mockVerifyRegistration.mockResolvedValueOnce({
      credentialId: new Uint8Array(16),
      publicKey: new ArrayBuffer(32),
      signCounter: 0,
      aaguid: '2fc0579f-8113-47ea-b116-bb5a8db9202a',
    });

    handleGetRegistrationChallenge('t0'); // generate pending challenge

    const msg: Extract<RequestMessage, { type: 'REGISTER_CREDENTIAL' }> = {
      type: 'REGISTER_CREDENTIAL',
      attestation: Array.from(new Uint8Array(64)),
      clientDataJSON: Array.from(new Uint8Array(64)),
      trace_id: 't1',
    };
    const resp = await handleRegisterCredential(msg, 't1');
    expect(resp.ok).toBe(true);
  });

  it('rejects unknown AAGUID', async () => {
    mockVerifyRegistration.mockResolvedValueOnce({
      credentialId: new Uint8Array(16),
      publicKey: new ArrayBuffer(32),
      signCounter: 0,
      aaguid: 'bad-aaguid-0000-0000-0000-000000000000',
    });

    handleGetRegistrationChallenge('t0');

    const msg: Extract<RequestMessage, { type: 'REGISTER_CREDENTIAL' }> = {
      type: 'REGISTER_CREDENTIAL',
      attestation: Array.from(new Uint8Array(64)),
      clientDataJSON: Array.from(new Uint8Array(64)),
      trace_id: 't1',
    };
    const resp = await handleRegisterCredential(msg, 't1');
    expect(resp.ok).toBe(false);
    expect((resp as { ok: false; error: string }).error).toContain('AAGUID');
  });

  it('rejects with no pending challenge', async () => {
    const msg: Extract<RequestMessage, { type: 'REGISTER_CREDENTIAL' }> = {
      type: 'REGISTER_CREDENTIAL',
      attestation: Array.from(new Uint8Array(64)),
      clientDataJSON: Array.from(new Uint8Array(64)),
      trace_id: 't1',
    };
    const resp = await handleRegisterCredential(msg, 't1');
    expect(resp.ok).toBe(false);
    expect((resp as { ok: false; error: string }).error).toContain('challenge');
  });
});

describe('handleGetCredentialStatus', () => {
  it('returns false when no credential stored', async () => {
    const resp = await handleGetCredentialStatus('t1');
    expect(resp.ok).toBe(true);
    const data = (resp as { ok: true; data: { registered: boolean } }).data;
    expect(data.registered).toBe(false);
  });

  it('returns true after registration', async () => {
    mockVerifyRegistration.mockResolvedValueOnce({
      credentialId: new Uint8Array(16),
      publicKey: new ArrayBuffer(32),
      signCounter: 0,
      aaguid: '2fc0579f-8113-47ea-b116-bb5a8db9202a',
    });

    handleGetRegistrationChallenge('t0');
    await handleRegisterCredential(
      {
        type: 'REGISTER_CREDENTIAL',
        attestation: Array.from(new Uint8Array(64)),
        clientDataJSON: Array.from(new Uint8Array(64)),
        trace_id: 't1',
      },
      't1',
    );

    const resp = await handleGetCredentialStatus('t2');
    expect(resp.ok).toBe(true);
    const data = (resp as { ok: true; data: { registered: boolean } }).data;
    expect(data.registered).toBe(true);
  });
});
