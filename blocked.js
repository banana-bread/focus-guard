const params = new URLSearchParams(window.location.search);
const domain = params.get('domain');
const domainDisplay = document.getElementById('domain-display');
const unlockBtn = document.getElementById('unlock-btn');

if (domain) {
  domainDisplay.textContent = `${domain} is blocked by Focus Guard`;
  document.title = `${domain} — Blocked`;
} else {
  domainDisplay.textContent = 'This site is blocked by Focus Guard';
}

// Enable unlock button only if a credential is registered
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (response && response.credential) {
    unlockBtn.disabled = false;
  }
});
