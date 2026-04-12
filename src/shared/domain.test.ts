import { describe, it, expect } from 'vitest';
import { normalizeDomain, isValidDomain } from '@/shared/domain';

describe('normalizeDomain', () => {
  it('returns bare domain unchanged', () => {
    expect(normalizeDomain('reddit.com')).toBe('reddit.com');
  });

  it('strips www. prefix', () => {
    expect(normalizeDomain('www.reddit.com')).toBe('reddit.com');
  });

  it('strips https scheme', () => {
    expect(normalizeDomain('https://reddit.com')).toBe('reddit.com');
  });

  it('strips https scheme and www.', () => {
    expect(normalizeDomain('https://www.reddit.com')).toBe('reddit.com');
  });

  it('strips path', () => {
    expect(normalizeDomain('https://www.reddit.com/r/programming')).toBe('reddit.com');
  });

  it('strips path, query string, and hash', () => {
    expect(normalizeDomain('https://www.reddit.com/r/programming?foo=bar#section')).toBe(
      'reddit.com',
    );
  });

  it('lowercases the result', () => {
    expect(normalizeDomain('HTTP://REDDIT.COM')).toBe('reddit.com');
  });

  it('throws on an unparseable input', () => {
    expect(() => normalizeDomain('not a domain!!')).toThrow();
  });

  it('preserves non-www subdomain', () => {
    expect(normalizeDomain('news.reddit.com')).toBe('news.reddit.com');
  });

  it('strips port', () => {
    expect(normalizeDomain('https://reddit.com:8080/path')).toBe('reddit.com');
  });
});

describe('isValidDomain', () => {
  it('accepts reddit.com', () => {
    expect(isValidDomain('reddit.com')).toBe(true);
  });

  it('accepts news.reddit.com', () => {
    expect(isValidDomain('news.reddit.com')).toBe(true);
  });

  it('accepts full URL input', () => {
    expect(isValidDomain('https://www.reddit.com/path?q=1')).toBe(true);
  });

  it('accepts example.co.uk', () => {
    expect(isValidDomain('example.co.uk')).toBe(true);
  });

  it('accepts short labels like a.io', () => {
    expect(isValidDomain('a.io')).toBe(true);
  });

  it('rejects keyboard smash without dot', () => {
    expect(isValidDomain('fdjkfjdakjlfjalfjdklsa')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidDomain('')).toBe(false);
  });

  it('rejects IPv4 literal', () => {
    expect(isValidDomain('1.2.3.4')).toBe(false);
  });

  it('rejects unparseable input', () => {
    expect(isValidDomain('not a domain!!')).toBe(false);
  });
});
