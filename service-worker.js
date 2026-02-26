import {
  getBlocklist,
  setBlocklist,
  getUnlocks,
  setUnlock,
  removeUnlock,
  getSettings,
} from "./lib/storage.js";
import { syncBlockRules, unlockDomain, relockDomain } from "./lib/blocker.js";

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
  const blocklist = await getBlocklist();
  if (blocklist.length === 0) {
    await setBlocklist(DEFAULT_BLOCKLIST);
    await syncBlockRules(DEFAULT_BLOCKLIST, {});
  } else {
    const unlocks = await getUnlocks();
    await syncBlockRules(blocklist, unlocks);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const unlocks = await getUnlocks();
  const now = Date.now();

  // Clean up expired unlocks
  for (const [domain, data] of Object.entries(unlocks)) {
    if (data.expiresAt && data.expiresAt <= now) {
      await relockDomain(domain);
      await removeUnlock(domain);
    }
  }

  const blocklist = await getBlocklist();
  const currentUnlocks = await getUnlocks();
  await syncBlockRules(blocklist, currentUnlocks);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Alarm names are formatted as "relock:<domain>"
  if (alarm.name.startsWith("relock:")) {
    const domain = alarm.name.slice("relock:".length);
    await relockDomain(domain);
    await removeUnlock(domain);
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
      const domain = payload.domain;
      if (!blocklist.includes(domain)) {
        blocklist.push(domain);
        await setBlocklist(blocklist);
      }
      const unlocks = await getUnlocks();
      await syncBlockRules(blocklist, unlocks);
      return { blocklist };
    }

    case "REMOVE_DOMAIN": {
      let blocklist = await getBlocklist();
      const domain = payload.domain;
      blocklist = blocklist.filter((d) => d !== domain);
      await setBlocklist(blocklist);
      const unlocks = await getUnlocks();
      await syncBlockRules(blocklist, unlocks);
      return { blocklist };
    }

    case "UNLOCK_DOMAIN": {
      const domain = payload.domain;
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
      const unlocks = await getUnlocks();
      const settings = await getSettings();
      return { blocklist, unlocks, settings };
    }

    default:
      return { error: `Unknown message type: ${type}` };
  }
}
