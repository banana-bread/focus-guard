import { normalizeDomain } from "./lib/normalize.js";
import { registerCredential } from "./lib/webauthn.js";

const listEl = document.getElementById("blocklist");
const inputEl = document.getElementById("domain-input");
const addBtn = document.getElementById("add-btn");
const errorEl = document.getElementById("error-msg");

const keyUnregistered = document.getElementById("key-unregistered");
const keyRegistered = document.getElementById("key-registered");
const keyInfo = document.getElementById("key-info");
const keyError = document.getElementById("key-error");
const registerBtn = document.getElementById("register-btn");
const removeKeyBtn = document.getElementById("remove-key-btn");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
}

function showKeyError(msg) {
  keyError.textContent = msg;
  keyError.hidden = false;
}

function clearKeyError() {
  keyError.hidden = true;
}

function renderList(blocklist) {
  listEl.innerHTML = "";
  for (const domain of blocklist) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = domain;
    const btn = document.createElement("button");
    btn.textContent = "\u00d7";
    btn.title = "Remove";
    btn.addEventListener("click", () => removeDomain(domain));
    li.appendChild(span);
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

function renderKeyState(credential) {
  clearKeyError();
  if (credential) {
    keyUnregistered.hidden = true;
    keyRegistered.hidden = false;
    const date = new Date(credential.createdAt).toLocaleDateString();
    keyInfo.innerHTML = "";
    const aaguidSpan = document.createElement("span");
    aaguidSpan.textContent = `AAGUID: ${credential.aaguid}`;
    const dateSpan = document.createElement("span");
    dateSpan.textContent = `Registered: ${date}`;
    keyInfo.appendChild(aaguidSpan);
    keyInfo.appendChild(dateSpan);
  } else {
    keyUnregistered.hidden = false;
    keyRegistered.hidden = true;
  }
}

async function loadState() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  renderList(response.blocklist);
  renderKeyState(response.credential);
}

async function addDomain() {
  clearError();
  const raw = inputEl.value;
  const domain = normalizeDomain(raw);
  if (!domain) {
    showError("Invalid domain. Enter something like reddit.com");
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "ADD_DOMAIN",
    payload: { domain },
  });
  renderList(response.blocklist);
  inputEl.value = "";
}

async function removeDomain(domain) {
  const response = await chrome.runtime.sendMessage({
    type: "REMOVE_DOMAIN",
    payload: { domain },
  });
  renderList(response.blocklist);
}

async function handleRegister() {
  clearKeyError();
  registerBtn.disabled = true;
  registerBtn.textContent = "Registering...";
  try {
    const credential = await registerCredential();
    renderKeyState(credential);
  } catch (err) {
    const msg = err.name === "NotAllowedError"
      ? "Registration cancelled."
      : err.message || "Registration failed.";
    showKeyError(msg);
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = "Register Security Key";
  }
}

async function handleRemoveKey() {
  if (!confirm("Remove your registered security key? You will need to re-register to unlock sites.")) {
    return;
  }
  await chrome.runtime.sendMessage({ type: "CLEAR_CREDENTIAL" });
  renderKeyState(null);
}

addBtn.addEventListener("click", addDomain);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addDomain();
});
registerBtn.addEventListener("click", handleRegister);
removeKeyBtn.addEventListener("click", handleRemoveKey);

loadState();
