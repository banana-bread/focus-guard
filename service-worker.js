import {
  getBlocklist,
  setBlocklist,
  getCredential,
  setCredential,
  clearCredential,
  getUnlocks,
  setUnlock,
  removeUnlock,
  getSettings,
  updateSettings,
} from "./lib/storage.js";
import { syncBlockRules, unlockDomain, relockDomain } from "./lib/blocker.js";
import { verifyAssertionData, base64urlDecode, base64urlEncode } from "./lib/webauthn.js";
import { normalizeDomain } from "./lib/normalize.js";

// In-memory store for pending WebAuthn challenges, keyed by domain.
// Challenges are single-use and consumed on first verification attempt.
const pendingChallenges = new Map();

const DEFAULT_BLOCKLIST = [
  "reddit.com",
  "youtube.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
];

// All event listeners registered synchronously at top level

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const blocklist = await getBlocklist();
    if (blocklist.length === 0) {
      await setBlocklist(DEFAULT_BLOCKLIST);
      await syncBlockRules(DEFAULT_BLOCKLIST, {});
    } else {
      const unlocks = await getUnlocks();
      await syncBlockRules(blocklist, unlocks);
    }
  } catch (err) {
    console.error("Focus Guard: onInstalled error:", err);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    const unlocks = await getUnlocks();
    const now = Date.now();

    // Clean up expired unlocks (including missed alarms while browser was closed)
    for (const [domain, data] of Object.entries(unlocks)) {
      if (data.expiresAt && data.expiresAt <= now) {
        await relockDomain(domain);
        await removeUnlock(domain);
        await chrome.alarms.clear(`relock:${domain}`);
      }
    }

    const blocklist = await getBlocklist();
    const currentUnlocks = await getUnlocks();
    await syncBlockRules(blocklist, currentUnlocks);
  } catch (err) {
    console.error("Focus Guard: onStartup error:", err);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    // Alarm names are formatted as "relock:<domain>"
    if (alarm.name.startsWith("relock:")) {
      const domain = alarm.name.slice("relock:".length);
      await relockDomain(domain);
      await removeUnlock(domain);
    }
  } catch (err) {
    console.error("Focus Guard: onAlarm error:", err);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true; // Keep message channel open for async response
});

async function handleMessage(message) {
  const { type, payload } = message;

  switch (type) {
    case "GET_BLOCKLIST": {
      const blocklist = await getBlocklist();
      return { blocklist };
    }

    case "ADD_DOMAIN": {
      const blocklist = await getBlocklist();
      const domain = normalizeDomain(payload.domain);
      if (!domain) {
        return { error: "Invalid domain." };
      }
      if (!blocklist.includes(domain)) {
        blocklist.push(domain);
        await setBlocklist(blocklist);
      }
      // If domain is currently unlocked, re-lock it
      const unlocks = await getUnlocks();
      if (unlocks[domain]) {
        await relockDomain(domain);
        await removeUnlock(domain);
        await chrome.alarms.clear(`relock:${domain}`);
      }
      const currentUnlocks = await getUnlocks();
      await syncBlockRules(blocklist, currentUnlocks);
      return { blocklist };
    }

    case "REMOVE_DOMAIN": {
      let blocklist = await getBlocklist();
      const domain = normalizeDomain(payload.domain);
      if (!domain) {
        return { error: "Invalid domain." };
      }
      blocklist = blocklist.filter((d) => d !== domain);
      await setBlocklist(blocklist);
      // If domain is currently unlocked, clean up allow rule and alarm
      const unlocks = await getUnlocks();
      if (unlocks[domain]) {
        await relockDomain(domain);
        await removeUnlock(domain);
        await chrome.alarms.clear(`relock:${domain}`);
      }
      const currentUnlocks = await getUnlocks();
      await syncBlockRules(blocklist, currentUnlocks);
      return { blocklist };
    }

    case "GET_CHALLENGE": {
      const domain = normalizeDomain(payload.domain);
      if (!domain) {
        return { error: "Invalid domain." };
      }
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      pendingChallenges.set(domain, challenge);
      return { challenge: base64urlEncode(challenge) };
    }

    case "UNLOCK_DOMAIN": {
      const { clientDataJSON, authenticatorData, signature } = payload;
      const domain = normalizeDomain(payload.domain);
      if (!domain) {
        return { error: "Invalid domain." };
      }

      // Verify the domain is actually in the blocklist
      const currentBlocklist = await getBlocklist();
      if (!currentBlocklist.includes(domain)) {
        return { error: "Domain is not in the blocklist." };
      }

      // Consume the stored challenge (single-use regardless of outcome)
      const challenge = pendingChallenges.get(domain);
      pendingChallenges.delete(domain);
      if (!challenge) {
        return { error: "No pending challenge for this domain. Request a challenge first." };
      }

      // Verify the WebAuthn assertion in the service worker
      const credentialData = await getCredential();
      if (!credentialData) {
        return { error: "No credential registered." };
      }

      const { newSignCount } = await verifyAssertionData(
        {
          authenticatorData: base64urlDecode(authenticatorData),
          clientDataJSON: base64urlDecode(clientDataJSON),
          signature: base64urlDecode(signature),
        },
        challenge,
        credentialData
      );

      // Update the stored sign count after successful verification
      await setCredential({ ...credentialData, signCount: newSignCount });

      const settings = await getSettings();
      const duration = settings.unlockDurationMinutes;

      await unlockDomain(domain);
      await setUnlock(domain, {
        unlockedAt: Date.now(),
        expiresAt: Date.now() + duration * 60 * 1000,
      });

      await chrome.alarms.create(`relock:${domain}`, {
        delayInMinutes: duration,
      });

      return { success: true };
    }

    case "GET_STATE": {
      const blocklist = await getBlocklist();
      const credential = await getCredential();
      const unlocks = await getUnlocks();
      const settings = await getSettings();
      return { blocklist, credential, unlocks, settings };
    }

    case "CLEAR_CREDENTIAL": {
      await clearCredential();
      return { success: true };
    }

    case "UPDATE_SETTINGS": {
      const { unlockDurationMinutes } = payload;
      if (
        !Number.isFinite(unlockDurationMinutes) ||
        !Number.isInteger(unlockDurationMinutes) ||
        unlockDurationMinutes < 1 ||
        unlockDurationMinutes > 1440
      ) {
        return { error: "unlockDurationMinutes must be an integer between 1 and 1440." };
      }
      await updateSettings({ unlockDurationMinutes });
      const settings = await getSettings();
      return { settings };
    }

    default:
      return { error: `Unknown message type: ${type}` };
  }
}
