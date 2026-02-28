/**
 * Normalizes user input into a clean domain string.
 * Strips protocol, www prefix, paths, query strings, ports.
 * Lowercases and validates the result.
 *
 * @param {string} input - Raw user input (URL or domain)
 * @returns {string|null} Normalized domain, or null if invalid
 */
export function normalizeDomain(input) {
  if (!input || typeof input !== "string") return null;

  let domain = input.trim().toLowerCase();

  // Strip protocol
  domain = domain.replace(/^https?:\/\//, "");

  // Strip path, query string, hash
  domain = domain.split(/[/?#]/)[0];

  // Strip port
  domain = domain.replace(/:\d+$/, "");

  // Strip www. prefix
  domain = domain.replace(/^www\./, "");

  // Strip URL filter special characters (* ^ |) that could create overly broad
  // declarativeNetRequest URL filter rules
  domain = domain.replace(/[*^|]/g, "");

  // Validate: must contain at least one dot, no spaces, non-empty
  if (!domain || domain.includes(" ") || !domain.includes(".")) {
    return null;
  }

  return domain;
}
