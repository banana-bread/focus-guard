import { normalizeDomain } from 'lib/normalize.js';

describe('normalizeDomain', () => {
  it('strips https:// protocol', () => {
    expect(normalizeDomain('https://example.com')).toBe('example.com');
  });

  it('strips http:// protocol', () => {
    expect(normalizeDomain('http://example.com')).toBe('example.com');
  });

  it('strips www. prefix', () => {
    expect(normalizeDomain('www.example.com')).toBe('example.com');
  });

  it('strips both protocol and www.', () => {
    expect(normalizeDomain('https://www.example.com')).toBe('example.com');
  });

  it('strips port number', () => {
    expect(normalizeDomain('example.com:8080')).toBe('example.com');
  });

  it('strips port with protocol', () => {
    expect(normalizeDomain('https://example.com:443')).toBe('example.com');
  });

  it('strips path', () => {
    expect(normalizeDomain('example.com/some/path')).toBe('example.com');
  });

  it('strips query string', () => {
    expect(normalizeDomain('example.com?q=1')).toBe('example.com');
  });

  it('strips hash fragment', () => {
    expect(normalizeDomain('example.com#section')).toBe('example.com');
  });

  it('strips trailing dot', () => {
    expect(normalizeDomain('example.com.')).toBe('example.com');
  });

  it('strips multiple trailing dots', () => {
    expect(normalizeDomain('example.com...')).toBe('example.com');
  });

  it('returns already-normalized input unchanged', () => {
    expect(normalizeDomain('example.com')).toBe('example.com');
  });

  it('lowercases mixed-case input', () => {
    expect(normalizeDomain('Example.COM')).toBe('example.com');
  });

  it('lowercases mixed-case with protocol', () => {
    expect(normalizeDomain('HTTPS://WWW.Example.COM/Path')).toBe('example.com');
  });

  it('handles full URL with all components', () => {
    expect(normalizeDomain('https://www.example.com:443/path?q=1#hash')).toBe('example.com');
  });

  it('returns null for empty string', () => {
    expect(normalizeDomain('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizeDomain(null)).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(normalizeDomain(42)).toBeNull();
  });

  it('returns null for domain without dot', () => {
    expect(normalizeDomain('localhost')).toBeNull();
  });

  it('returns null for input with spaces', () => {
    expect(normalizeDomain('exam ple.com')).toBeNull();
  });

  it('returns null for input with wildcard *', () => {
    expect(normalizeDomain('*.example.com')).toBeNull();
  });

  it('returns null for input with pipe |', () => {
    expect(normalizeDomain('example.com|other.com')).toBeNull();
  });

  it('returns null for input with caret ^', () => {
    expect(normalizeDomain('example.com^')).toBeNull();
  });

  it('handles subdomain correctly', () => {
    expect(normalizeDomain('sub.example.com')).toBe('sub.example.com');
  });

  it('strips www. but preserves other subdomains', () => {
    expect(normalizeDomain('news.bbc.co.uk')).toBe('news.bbc.co.uk');
  });
});
