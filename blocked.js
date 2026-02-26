import { verifyWithCredential } from './lib/webauthn.js';

const params = new URLSearchParams(window.location.search);
const domain = params.get('domain');
const domainDisplay = document.getElementById('domain-display');
const unlockBtn = document.getElementById('unlock-btn');
const statusMsg = document.getElementById('status-msg');

if (domain) {
  domainDisplay.textContent = domain;
  document.title = `${domain} — Blocked`;
} else {
  domainDisplay.textContent = 'Unknown site';
}

// Enable unlock button only if a credential is registered
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (response && response.credential) {
    unlockBtn.disabled = false;
  }
});

unlockBtn.addEventListener('click', async () => {
  if (!domain) return;

  unlockBtn.disabled = true;
  unlockBtn.textContent = 'Verifying…';
  statusMsg.textContent = '';

  try {
    await verifyWithCredential();

    // Send unlock request to service worker
    const response = await chrome.runtime.sendMessage({
      type: 'UNLOCK_DOMAIN',
      payload: { domain },
    });

    if (response && response.error) {
      throw new Error(response.error);
    }

    // Redirect to the unlocked site
    window.location.href = `https://${domain}`;
  } catch (err) {
    unlockBtn.disabled = false;
    unlockBtn.textContent = 'Unlock with Security Key';
    statusMsg.className = 'status error';
    statusMsg.textContent = err.name === 'NotAllowedError'
      ? 'Verification cancelled.'
      : `Error: ${err.message}`;
  }
});
