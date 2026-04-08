/**
 * Domain normalisation utilities shared across feature slices.
 */

/**
 * Normalises a raw user input string to a bare hostname.
 * Strips scheme, `www.` prefix, path, query string, and hash.
 *
 * @param input - Raw string e.g. `"https://www.reddit.com/r/programming?foo=bar"`
 * @returns Normalised hostname e.g. `"reddit.com"`
 * @throws {TypeError} If `input` cannot be parsed as a URL (propagated from `new URL()`).
 */
export function normalizeDomain(input: string): string {
  // Prepend scheme if missing so URL() can parse bare hostnames
  const withScheme = input.includes('://') ? input : `https://${input}`;
  const { hostname } = new URL(withScheme);
  return hostname.replace(/^www\./, '').toLowerCase();
}
