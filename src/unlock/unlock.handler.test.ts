import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/__mocks__/chrome';

vi.mock('@/shared/webauthn', () => ({ verifyAssertion: vi.fn() }));
vi.mock('@/credential/credential.storage', () => ({
  getCredential: vi.fn(),
  setCredential: vi.fn(),
}));

import { verifyAssertion } from '@/shared/webauthn';
import { getCredential, setCredential } from '@/credential/credential.storage';
import {
  handleGetAssertionChallenge,
  handleVerifyAssertion,
  handleGetUnlockSession,
} from '@/unlock/unlock.handler';
import type { RequestMessage } from '@/core/messages';

const mockVerifyAssertion = vi.mocked(verifyAssertion);
const mockGetCredential = vi.mocked(getCredential);
const mockSetCredential = vi.mocked(setCredential);

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
  vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mockResolvedValue(undefined);
  vi.mocked(chrome.alarms.create).mockReturnValue(undefined);
  vi.mocked(chrome.alarms.clear).mockReturnValue(undefined);
  mockGetCredential.mockReset();
  mockSetCredential.mockReset();
  mockVerifyAssertion.mockReset();
});

const FAKE_CREDENTIAL = {
  credentialId: new Uint8Array(16).fill(1),
  publicKey: new ArrayBuffer(32),
  signCounter: 5,
  aaguid: '2fc0579f-8113-47ea-b116-bb5a8db9202a',
};

// ---------------------------------------------------------------------------
// handleGetAssertionChallenge
// ---------------------------------------------------------------------------

describe('handleGetAssertionChallenge', () => {
  it('returns ok:false with "No credential registered" when no credential', async () => {
    mockGetCredential.mockResolvedValueOnce(undefined);
    const msg: Extract<RequestMessage, { type: 'GET_ASSERTION_CHALLENGE' }> = {
      type: 'GET_ASSERTION_CHALLENGE',
      operation: 'unlock',
      domain: 'reddit.com',
      trace_id: 't1',
    };
    const resp = await handleGetAssertionChallenge(msg, 't1');
    expect(resp.ok).toBe(false);
    expect((resp as { ok: false; error: string }).error).toContain('No credential registered');
  });

  it('returns ok:true with challenge, credentialId, rpId when credential exists', async () => {
    mockGetCredential.mockResolvedValueOnce(FAKE_CREDENTIAL);
    const msg: Extract<RequestMessage, { type: 'GET_ASSERTION_CHALLENGE' }> = {
      type: 'GET_ASSERTION_CHALLENGE',
      operation: 'unlock',
      domain: 'reddit.com',
      trace_id: 't1',
    };
    const resp = await handleGetAssertionChallenge(msg, 't1');
    expect(resp.ok).toBe(true);
    const data = (
      resp as { ok: true; data: { challenge: number[]; credentialId: number[]; rpId: string } }
    ).data;
    expect(Array.isArray(data.challenge)).toBe(true);
    expect(data.challenge).toHaveLength(32);
    expect(Array.isArray(data.credentialId)).toBe(true);
    expect(typeof data.rpId).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// handleVerifyAssertion
// ---------------------------------------------------------------------------

describe('handleVerifyAssertion', () => {
  function makeVerifyMsg(
    domain = 'reddit.com',
    transport?: string,
  ): Extract<RequestMessage, { type: 'VERIFY_ASSERTION' }> {
    return {
      type: 'VERIFY_ASSERTION',
      authenticatorData: Array.from(new Uint8Array(37)),
      clientDataJSON: Array.from(new Uint8Array(64)),
      signature: Array.from(new Uint8Array(64)),
      ...(transport !== undefined ? { transport } : {}),
      operation: 'unlock',
      domain,
      durationMs: 300000,
      trace_id: 't2',
    };
  }

  it('returns ok:false when no pending challenge for domain', async () => {
    mockGetCredential.mockResolvedValueOnce(FAKE_CREDENTIAL);
    const resp = await handleVerifyAssertion(makeVerifyMsg('no-challenge.com'), 't2');
    expect(resp.ok).toBe(false);
  });

  it('returns ok:true, creates alarm and allow rule on success', async () => {
    // Issue a challenge first
    mockGetCredential.mockResolvedValue(FAKE_CREDENTIAL);
    mockSetCredential.mockResolvedValue(undefined);
    mockVerifyAssertion.mockResolvedValueOnce({ newSignCounter: 6 });

    await handleGetAssertionChallenge(
      {
        type: 'GET_ASSERTION_CHALLENGE',
        operation: 'unlock',
        domain: 'reddit.com',
        trace_id: 't0',
      },
      't0',
    );

    const resp = await handleVerifyAssertion(makeVerifyMsg('reddit.com'), 't2');
    expect(resp.ok).toBe(true);
    expect(mockSetCredential).toHaveBeenCalledWith(expect.objectContaining({ signCounter: 6 }));
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      expect.stringContaining('relock:reddit.com'),
      expect.any(Object),
    );
    expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith(
      expect.objectContaining({
        addRules: expect.arrayContaining([
          expect.objectContaining({ action: expect.objectContaining({ type: 'allow' }) }),
        ]),
      }),
    );
  });

  it('returns ok:false with "Transport not allowed" for rejected transport', async () => {
    mockGetCredential.mockResolvedValue(FAKE_CREDENTIAL);

    await handleGetAssertionChallenge(
      {
        type: 'GET_ASSERTION_CHALLENGE',
        operation: 'unlock',
        domain: 'reddit.com',
        trace_id: 't0',
      },
      't0',
    );

    const resp = await handleVerifyAssertion(makeVerifyMsg('reddit.com', 'internal'), 't2');
    expect(resp.ok).toBe(false);
    expect((resp as { ok: false; error: string }).error).toContain('Transport not allowed');
    expect(mockVerifyAssertion).not.toHaveBeenCalled();
  });

  it('returns ok:false when verifyAssertion rejects (sign counter violation)', async () => {
    mockGetCredential.mockResolvedValue(FAKE_CREDENTIAL);
    mockVerifyAssertion.mockRejectedValueOnce(
      new Error('sign_counter_violation: possible cloned authenticator'),
    );

    await handleGetAssertionChallenge(
      {
        type: 'GET_ASSERTION_CHALLENGE',
        operation: 'unlock',
        domain: 'reddit.com',
        trace_id: 't0',
      },
      't0',
    );

    const resp = await handleVerifyAssertion(makeVerifyMsg('reddit.com'), 't2');
    expect(resp.ok).toBe(false);
    expect((resp as { ok: false; error: string }).error).toContain('sign_counter_violation');
  });
});

// ---------------------------------------------------------------------------
// handleGetUnlockSession
// ---------------------------------------------------------------------------

describe('handleGetUnlockSession', () => {
  it('returns ok:true, data:null when no session', async () => {
    const msg: Extract<RequestMessage, { type: 'GET_UNLOCK_SESSION' }> = {
      type: 'GET_UNLOCK_SESSION',
      domain: 'reddit.com',
      trace_id: 't3',
    };
    const resp = await handleGetUnlockSession(msg, 't3');
    expect(resp.ok).toBe(true);
    expect((resp as { ok: true; data: null }).data).toBeNull();
  });

  it('returns session with expiresAt, duration, allowRuleId when session exists', async () => {
    const session = { expiresAt: Date.now() + 300000, duration: 300000, allowRuleId: 2001 };
    storageMap.set('unlock_sessions', { 'reddit.com': session });

    const msg: Extract<RequestMessage, { type: 'GET_UNLOCK_SESSION' }> = {
      type: 'GET_UNLOCK_SESSION',
      domain: 'reddit.com',
      trace_id: 't3',
    };
    const resp = await handleGetUnlockSession(msg, 't3');
    expect(resp.ok).toBe(true);
    const data = (resp as { ok: true; data: typeof session }).data;
    expect(data.expiresAt).toBe(session.expiresAt);
    expect(data.duration).toBe(session.duration);
    expect(data.allowRuleId).toBe(session.allowRuleId);
  });
});
