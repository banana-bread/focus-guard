import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/__mocks__/chrome';
import { handleAddDomain, handleGetBlocklist } from '@/blocklist/blocklist.handler';
import type { RequestMessage } from '@/core/messages';

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
