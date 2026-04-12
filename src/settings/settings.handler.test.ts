import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/__mocks__/chrome';
import { handleGetSettings, handleSetSettings } from '@/settings/settings.handler';
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
});

describe('handleGetSettings', () => {
  it('returns defaults when no settings stored', async () => {
    const resp = await handleGetSettings('t1');
    expect(resp.ok).toBe(true);
    const data = (resp as { ok: true; data: { defaultUnlockDurationMs: number } }).data;
    expect(data.defaultUnlockDurationMs).toBe(1_800_000);
  });

  it('returns stored settings', async () => {
    storageMap.set('settings', { defaultUnlockDurationMs: 300_000 });
    const resp = await handleGetSettings('t1');
    expect(resp.ok).toBe(true);
    const data = (resp as { ok: true; data: { defaultUnlockDurationMs: number } }).data;
    expect(data.defaultUnlockDurationMs).toBe(300_000);
  });
});

describe('handleSetSettings', () => {
  it('updates duration and persists', async () => {
    const msg: Extract<RequestMessage, { type: 'SET_SETTINGS' }> = {
      type: 'SET_SETTINGS',
      settings: { defaultUnlockDurationMs: 900_000 },
      trace_id: 't1',
    };
    const resp = await handleSetSettings(msg, 't1');
    expect(resp.ok).toBe(true);
    expect(storageMap.get('settings')).toEqual({ defaultUnlockDurationMs: 900_000 });
  });

  it('partial merge preserves existing fields', async () => {
    storageMap.set('settings', { defaultUnlockDurationMs: 300_000 });
    const msg: Extract<RequestMessage, { type: 'SET_SETTINGS' }> = {
      type: 'SET_SETTINGS',
      settings: { defaultUnlockDurationMs: 3_600_000 },
      trace_id: 't2',
    };
    const resp = await handleSetSettings(msg, 't2');
    expect(resp.ok).toBe(true);
    expect(storageMap.get('settings')).toEqual({ defaultUnlockDurationMs: 3_600_000 });
  });
});
