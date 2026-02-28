# Focus Guard

**Block distracting websites and require a physical hardware security key (WebAuthn/FIDO2) to unlock them.**

Focus Guard is a Chrome/Chromium extension that makes it genuinely hard to visit distracting sites. Unlike password-based blockers that you can bypass by just typing the password, unlocking requires you to physically tap a USB, NFC, or Bluetooth security key. No key in hand — no unlock.

---

## Features

- Block any domain with one click
- Unlock temporarily with a hardware security key (YubiKey, etc.)
- Configurable unlock duration (5, 15, 30, or 60 minutes) — re-locks automatically
- Full client-side WebAuthn verification — no server, no account, no network requests
- Clone detection via sign counter monitoring
- Zero external dependencies

## Requirements

- Chrome or Chromium 120+
- A FIDO2/WebAuthn hardware security key (USB, NFC, or BLE)

## Installation

Focus Guard is not on the Chrome Web Store. Load it manually:

1. Clone or download this repository
2. Go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select this directory

## Usage

1. **Register your security key** — open the extension popup and click "Register Security Key", then touch your key when prompted
2. **Add domains to block** — type a domain (e.g. `reddit.com`) in the popup and click Add
3. **Unlock a site** — when blocked, click "Unlock with Security Key" and touch your key; the site is accessible for the configured duration, then re-locks automatically

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — runtime contexts, module overview, storage schema, Chrome APIs
- [`docs/user-flows.md`](docs/user-flows.md) — each user action traced through the code with sequence diagrams
- [`docs/security.md`](docs/security.md) — WebAuthn hardware enforcement, clone detection, signature conversion, rule layering

## Project Structure

```
focus-guard/
├── manifest.json          # MV3 extension manifest
├── service-worker.js      # Background service worker — all message handling and state
├── popup.html / popup.js  # Extension popup UI
├── blocked.html / blocked.js  # Page shown when visiting a blocked site
└── lib/
    ├── storage.js         # chrome.storage.local wrapper
    ├── blocker.js         # declarativeNetRequest rule management
    ├── webauthn.js        # WebAuthn registration and verification
    ├── normalize.js       # Domain input normalization
    └── cbor.js            # CBOR decoder for WebAuthn attestation
```

## Acknowledgements

This project was prototyped using [Chief](https://github.com/MiniCodeMonkey/chief), a TUI tool that automates coding projects by breaking them into tasks and running Claude Code in a loop until they're done — inspired by the Ralph Wiggum loop pattern.

## License

MIT
