import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock.js';

describe('Test infrastructure', () => {
  let chrome;

  beforeEach(() => {
    chrome = setupChromeMock();
  });

  it('provides chrome.storage.local mock', () => {
    expect(chrome.storage.local.get).toBeDefined();
    expect(chrome.storage.local.set).toBeDefined();
    expect(chrome.storage.local.remove).toBeDefined();
  });

  it('provides chrome.runtime mock', () => {
    expect(chrome.runtime.sendMessage).toBeDefined();
    expect(chrome.runtime.getURL).toBeDefined();
  });

  it('provides chrome.declarativeNetRequest mock', () => {
    expect(chrome.declarativeNetRequest.getDynamicRules).toBeDefined();
    expect(chrome.declarativeNetRequest.updateDynamicRules).toBeDefined();
  });

  it('provides chrome.alarms mock', () => {
    expect(chrome.alarms.create).toBeDefined();
    expect(chrome.alarms.clear).toBeDefined();
    expect(chrome.alarms.onAlarm.addListener).toBeDefined();
  });

  it('provides chrome.tabs mock', () => {
    expect(chrome.tabs.query).toBeDefined();
    expect(chrome.tabs.update).toBeDefined();
  });

  it('chrome.storage.local.get returns stored values', async () => {
    await chrome.storage.local.set({ testKey: 'testValue' });
    const result = await chrome.storage.local.get('testKey');
    expect(result.testKey).toBe('testValue');
  });

  it('chrome.storage.local.remove deletes keys', async () => {
    await chrome.storage.local.set({ toDelete: 'value' });
    await chrome.storage.local.remove('toDelete');
    const result = await chrome.storage.local.get('toDelete');
    expect(result.toDelete).toBeUndefined();
  });

  it('global chrome is set by setupChromeMock', () => {
    expect(global.chrome).toBe(chrome);
  });

  it('lib/ alias resolves correctly', async () => {
    // If the alias is broken this import will throw
    const { normalizeDomain } = await import('lib/normalize.js');
    expect(typeof normalizeDomain).toBe('function');
  });
});
