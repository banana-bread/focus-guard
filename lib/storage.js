const DEFAULTS = {
  blocklist: [],
  credential: null,
  unlocks: {},
  settings: { unlockDurationMinutes: 30 },
};

async function get(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? DEFAULTS[key];
}

async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function getBlocklist() {
  return get("blocklist");
}

export async function setBlocklist(domains) {
  await set("blocklist", domains);
}

export async function getCredential() {
  return get("credential");
}

export async function setCredential(cred) {
  await set("credential", cred);
}

export async function clearCredential() {
  await chrome.storage.local.remove("credential");
}

export async function getUnlocks() {
  return get("unlocks");
}

export async function setUnlock(domain, data) {
  const unlocks = await getUnlocks();
  unlocks[domain] = data;
  await set("unlocks", unlocks);
}

export async function removeUnlock(domain) {
  const unlocks = await getUnlocks();
  delete unlocks[domain];
  await set("unlocks", unlocks);
}

export async function getSettings() {
  return get("settings");
}

export async function updateSettings(partial) {
  const current = await getSettings();
  await set("settings", { ...current, ...partial });
}
