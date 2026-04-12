import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/__mocks__/chrome';

vi.mock('@/unlock/unlock.service', () => ({
  verifyAssertionGeneric: vi.fn(),
  endSession: vi.fn(),
}));

import { verifyAssertionGeneric, endSession } from '@/unlock/unlock.service';
import {
  handleAddDomain,
  handleRemoveDomain,
  handleGetBlocklist,
} from '@/blocklist/blocklist.handler';
import type { RequestMessage } from '@/core/messages';

const mockVerifyAssertionGeneric = vi.mocked(verifyAssertionGeneric);
const mockEndSession = vi.mocked(endSession);

const storageMap = new Map<string, unknown>();

beforeEach(() => {
  storageMap.clear();
  vi.mocked(chrome.storage.local.get).mockImplementation(((key: string) =>
    Promise.resolve({ [key]: storageMap.get(key) })) as typeof chrome.storage.local.get);
  vi.mocked(chrome.storage.local.set).mockImplementation(((obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) storageMap.set(k, v);
    return Promise.resolve();
  }) as typeof chrome.storage.local.set);
  vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mockResolvedValue(undefined);
  vi.mocked(chrome.declarativeNetRequest.getDynamicRules).mockResolvedValue([] as unknown as void);
  vi.mocked(chrome.alarms.clear).mockReturnValue(undefined);
  vi.mocked(chrome.tabs.query).mockResolvedValue([] as unknown as void);
  vi.mocked(chrome.tabs.update).mockResolvedValue({} as unknown as void);
  mockVerifyAssertionGeneric.mockReset();
  mockEndSession.mockReset();
  mockEndSession.mockResolvedValue(undefined);
});

describe('handleAddDomain', () => {
  it('calls updateDynamicRules with correct rule shape', async () => {
    const msg: Extract<RequestMessage, { type: 'ADD_DOMAIN' }> = {
      type: 'ADD_DOMAIN',
      domain: 'reddit.com',
      trace_id: 't1',
    };
    const resp = await handleAddDomain(msg, 't1');
    expect(resp.ok).toBe(true);

    const calls = vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1]![0] as {
      addRules: chrome.declarativeNetRequest.Rule[];
    };
    expect(lastCall.addRules).toHaveLength(1);
    const rule = lastCall.addRules[0]!;
    expect(rule.action.type).toBe('redirect');
    expect(rule.action.redirect?.regexSubstitution).toContain('reddit.com');
    expect(rule.condition.regexFilter).toContain('reddit\\.com');
  });

  it('normalises URL input', async () => {
    const msg: Extract<RequestMessage, { type: 'ADD_DOMAIN' }> = {
      type: 'ADD_DOMAIN',
      domain: 'https://www.twitter.com/home',
      trace_id: 't1',
    };
    const resp = await handleAddDomain(msg, 't1');
    expect(resp.ok).toBe(true);
    const calls = vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mock.calls;
    const lastCall = calls[calls.length - 1]![0] as {
      addRules: chrome.declarativeNetRequest.Rule[];
    };
    expect(lastCall.addRules[0]?.condition.regexFilter).toContain('twitter\\.com');
    expect(lastCall.addRules[0]?.condition.regexFilter).not.toContain('www\\.');
  });

  it('ignores duplicates', async () => {
    const msg: Extract<RequestMessage, { type: 'ADD_DOMAIN' }> = {
      type: 'ADD_DOMAIN',
      domain: 'reddit.com',
      trace_id: 't1',
    };
    await handleAddDomain(msg, 't1');
    const callsBefore = vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mock.calls
      .length;

    await handleAddDomain({ ...msg, trace_id: 't2' }, 't2');
    expect(vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mock.calls.length).toBe(
      callsBefore,
    );
  });

  it('rejects invalid domain input and does not update rules', async () => {
    const msg: Extract<RequestMessage, { type: 'ADD_DOMAIN' }> = {
      type: 'ADD_DOMAIN',
      domain: 'fdjkfjdakjlfjalfjdklsa',
      trace_id: 't1',
    };
    const callsBefore = vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mock.calls
      .length;
    const resp = await handleAddDomain(msg, 't1');
    expect(resp.ok).toBe(false);
    if (!resp.ok) expect(resp.error).toMatch(/not a valid domain/i);
    expect(vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mock.calls.length).toBe(
      callsBefore,
    );
  });
});

describe('handleGetBlocklist', () => {
  it('returns list after adding domains', async () => {
    await handleAddDomain({ type: 'ADD_DOMAIN', domain: 'reddit.com', trace_id: 't1' }, 't1');
    await handleAddDomain({ type: 'ADD_DOMAIN', domain: 'twitter.com', trace_id: 't2' }, 't2');

    const resp = await handleGetBlocklist('t3');
    expect(resp.ok).toBe(true);
    const data = (resp as { ok: true; data: string[] }).data;
    expect(data).toContain('reddit.com');
    expect(data).toContain('twitter.com');
  });

  it('returns empty array when nothing blocked', async () => {
    const resp = await handleGetBlocklist('t1');
    expect(resp.ok).toBe(true);
    const data = (resp as { ok: true; data: string[] }).data;
    expect(data).toEqual([]);
  });
});

describe('handleRemoveDomain', () => {
  function makeRemoveMsg(domain: string): Extract<RequestMessage, { type: 'REMOVE_DOMAIN' }> {
    return {
      type: 'REMOVE_DOMAIN',
      domain,
      authenticatorData: Array.from(new Uint8Array(37)),
      clientDataJSON: Array.from(new Uint8Array(64)),
      signature: Array.from(new Uint8Array(64)),
      trace_id: 't-remove',
    };
  }

  it('removes domain from blocklist after assertion verification', async () => {
    // Add a domain first
    await handleAddDomain({ type: 'ADD_DOMAIN', domain: 'reddit.com', trace_id: 't1' }, 't1');
    await handleAddDomain({ type: 'ADD_DOMAIN', domain: 'twitter.com', trace_id: 't2' }, 't2');

    mockVerifyAssertionGeneric.mockResolvedValueOnce(undefined);

    const resp = await handleRemoveDomain(makeRemoveMsg('reddit.com'), 't-remove');
    expect(resp.ok).toBe(true);

    const listResp = await handleGetBlocklist('t3');
    const data = (listResp as { ok: true; data: string[] }).data;
    expect(data).toEqual(['twitter.com']);
    expect(data).not.toContain('reddit.com');
  });

  it('returns error when assertion verification fails', async () => {
    await handleAddDomain({ type: 'ADD_DOMAIN', domain: 'reddit.com', trace_id: 't1' }, 't1');
    mockVerifyAssertionGeneric.mockRejectedValueOnce(new Error('Assertion failed'));

    const resp = await handleRemoveDomain(makeRemoveMsg('reddit.com'), 't-remove');
    expect(resp.ok).toBe(false);
    expect((resp as { ok: false; error: string }).error).toContain('Assertion failed');

    // Domain should still be in blocklist
    const listResp = await handleGetBlocklist('t3');
    const data = (listResp as { ok: true; data: string[] }).data;
    expect(data).toContain('reddit.com');
  });

  it('calls endSession for removed domain', async () => {
    await handleAddDomain({ type: 'ADD_DOMAIN', domain: 'reddit.com', trace_id: 't1' }, 't1');
    mockVerifyAssertionGeneric.mockResolvedValueOnce(undefined);

    await handleRemoveDomain(makeRemoveMsg('reddit.com'), 't-remove');
    expect(mockEndSession).toHaveBeenCalledWith('reddit.com', 't-remove');
  });

  it('redirects blocked-page tabs back to original URL after removal', async () => {
    await handleAddDomain({ type: 'ADD_DOMAIN', domain: 'reddit.com', trace_id: 't1' }, 't1');
    mockVerifyAssertionGeneric.mockResolvedValueOnce(undefined);

    const blockedUrl =
      'chrome-extension://test-extension-id/blocked/blocked.html?domain=reddit.com&url=https%3A%2F%2Freddit.com%2Fr%2Ftest';
    // unblockBlockedPageTabs queries for extension blocked-page tabs
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 42, url: blockedUrl },
    ] as unknown as void);
    vi.mocked(chrome.tabs.update).mockClear();

    await handleRemoveDomain(makeRemoveMsg('reddit.com'), 't-remove');

    expect(chrome.tabs.update).toHaveBeenCalledWith(42, {
      url: 'https://reddit.com/r/test',
    });
  });
});

describe('addDomain tab blocking', () => {
  it('redirects open tabs on domain to blocked page after adding', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 10, url: 'https://reddit.com/r/programming' },
    ] as unknown as void);
    vi.mocked(chrome.tabs.update).mockClear();

    await handleAddDomain({ type: 'ADD_DOMAIN', domain: 'reddit.com', trace_id: 't1' }, 't1');

    expect(chrome.tabs.update).toHaveBeenCalledWith(10, {
      url: expect.stringContaining('blocked.html?domain=reddit.com'),
    });
  });

  it('does not call tabs.update when domain is invalid', async () => {
    vi.mocked(chrome.tabs.update).mockClear();

    await handleAddDomain({ type: 'ADD_DOMAIN', domain: 'not-valid-thing', trace_id: 't1' }, 't1');
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});
