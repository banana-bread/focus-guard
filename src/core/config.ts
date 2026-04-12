/**
 * Focus Guard extension configuration constants.
 *
 * All security-relevant values (RP ID, AAGUID allowlist, TTLs, transports)
 * are centralised here so feature slices have a single source of truth.
 */

/** WebAuthn Relying Party ID — the full extension origin, used as rpId by Chrome for extensions. */
export const RP_ID: string = `chrome-extension://${chrome.runtime.id}`;

/** Human-readable Relying Party name shown in authenticator dialogs. */
export const RP_NAME = 'Focus Guard';

/**
 * Maximum age of a WebAuthn challenge before it is rejected.
 * Single-use; keyed by domain in service worker memory.
 */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 120_000

/** Default duration a domain stays unlocked after a successful assertion. */
export const DEFAULT_UNLOCK_DURATION_MS = 30 * 60 * 1000; // 30 min

/**
 * Allowlist of trusted authenticator AAGUIDs.
 * Assertions from devices not in this list are rejected.
 */
export const AAGUID_ALLOWLIST: readonly string[] = [
  '2fc0579f-8113-47ea-b116-bb5a8db9202a', // YubiKey 5 series
  // Extend with additional trusted AAGUIDs as needed
];

/**
 * Maps known authenticator AAGUIDs to human-readable device names.
 * Used in popup badge to show the actual key model instead of generic text.
 */
export const AAGUID_NAMES: Record<string, string> = {
  '2fc0579f-8113-47ea-b116-bb5a8db9202a': 'YubiKey 5',
};

/**
 * Authenticator transports that are permitted for hardware key attestation/assertion.
 * Matches physical security keys over USB, NFC, and BLE.
 */
export const ALLOWED_TRANSPORTS: readonly AuthenticatorTransport[] = ['usb', 'nfc', 'ble'];

/**
 * Authenticator transports that must be rejected.
 * Prevents platform authenticators (passkeys) and hybrid flows from bypassing the hardware requirement.
 */
export const REJECTED_TRANSPORTS: readonly AuthenticatorTransport[] = ['internal', 'hybrid'];
