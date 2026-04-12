import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shouldBlockNavigation } from './spa-navigation-guard';
import type { UnlockSession } from '@/core/storage';

const NOW = 1_700_000_000_000;

const future = (): UnlockSession => ({
  expiresAt: NOW + 60_000,
  duration: 60_000,
  allowRuleId: 2001,
});

const past = (): UnlockSession => ({
  expiresAt: NOW - 1_000,
  duration: 60_000,
  allowRuleId: 2001,
});

describe('shouldBlockNavigation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
  it('allows URL not on blocklist', () => {
    const result = shouldBlockNavigation('https://example.com/', ['youtube.com'], {});
    expect(result.block).toBe(false);
  });

  it('blocks URL on blocklist with no session', () => {
    const result = shouldBlockNavigation('https://youtube.com/watch', ['youtube.com'], {});
    expect(result).toEqual({ block: true, domain: 'youtube.com' });
  });

  it('allows URL on blocklist with active session', () => {
    const result = shouldBlockNavigation('https://youtube.com/watch', ['youtube.com'], {
      'youtube.com': future(),
    });
    expect(result.block).toBe(false);
  });

  it('blocks URL on blocklist with expired session', () => {
    const result = shouldBlockNavigation('https://youtube.com/watch', ['youtube.com'], {
      'youtube.com': past(),
    });
    expect(result).toEqual({ block: true, domain: 'youtube.com' });
  });

  it('normalises www. prefix', () => {
    const result = shouldBlockNavigation('https://www.youtube.com/watch?v=x', ['youtube.com'], {});
    expect(result).toEqual({ block: true, domain: 'youtube.com' });
  });

  it('allows non-http scheme', () => {
    const result = shouldBlockNavigation(
      'chrome-extension://abc/blocked.html',
      ['youtube.com'],
      {},
    );
    expect(result.block).toBe(false);
  });

  it('allows invalid URL without throwing', () => {
    const result = shouldBlockNavigation('not a url', ['youtube.com'], {});
    expect(result.block).toBe(false);
  });

  it('matches subdomains of blocklisted root domain', () => {
    const result = shouldBlockNavigation('https://music.youtube.com/', ['youtube.com'], {});
    expect(result).toEqual({ block: true, domain: 'youtube.com' });
  });
});
