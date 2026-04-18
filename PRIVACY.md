# Privacy Policy

**Last updated:** April 18, 2026

## Summary

Focus Guard does not collect, store, or transmit any user data outside your device. All blocking rules, unlock sessions, and settings are stored locally using the browser's storage API. No data is sent to any server. No telemetry, analytics, or tracking is performed. The extension is open source and auditable at https://github.com/banana-bread/focus-guard.

## What Data We Store

All data is stored **locally on your device** using `chrome.storage.local`:

- **Blocklist** — Domains you've added to block
- **Security Key Credential** — Your registered WebAuthn credential (credential ID, public key, sign counter)
- **Unlock Sessions** — Active unlock timers and durations for blocked domains
- **Settings** — Your preferred unlock duration

## What Data We Don't Collect

Focus Guard does **not**:

- Collect or log the pages you visit (except to match against your blocklist)
- Track your browsing history
- Send any data to our servers (there are no servers)
- Use analytics, tracking, or telemetry
- Store your data in the cloud
- Sync your blocklist across devices
- Require an account or login
- Sell or share your data

## Security Key Data

Your hardware security key (YubiKey, FIDO2, etc.) communicates directly with your browser using the WebAuthn protocol. Focus Guard stores only the **public key** derived from your security key—never your private key. Private keys never leave your security key.

## Open Source

The full source code is available at https://github.com/banana-bread/focus-guard. You can audit exactly what the extension does, verify no data leaves your device, and build it yourself.

## Browser Storage

Focus Guard uses the browser's `chrome.storage.local` API, which:
- Stores data only in your user profile on this device
- Is not synced to the cloud (unless you enable Chrome sync, which is a browser-level setting you control)
- Is deleted if you uninstall the extension

## Changes to This Policy

We may update this privacy policy to reflect changes in the extension. We will notify users of any material changes by updating the "Last updated" date above.

## Questions?

For questions about this privacy policy or the extension's privacy practices, please open an issue at https://github.com/banana-bread/focus-guard/issues.
