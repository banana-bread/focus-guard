import { normalizeDomain } from "./lib/normalize.js";

const listEl = document.getElementById("blocklist");
const inputEl = document.getElementById("domain-input");
const addBtn = document.getElementById("add-btn");
const errorEl = document.getElementById("error-msg");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
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

async function loadBlocklist() {
  const response = await chrome.runtime.sendMessage({ type: "GET_BLOCKLIST" });
  renderList(response.blocklist);
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

addBtn.addEventListener("click", addDomain);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addDomain();
});

loadBlocklist();
