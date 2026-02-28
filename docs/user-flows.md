# User Flows

This document traces each main user action through the codebase, showing which files and functions are called in order. Sequence diagrams use actual file and function names.

## Overview

1. [Add Domain to Blocklist](#1-add-domain-to-blocklist)
2. [Remove Domain from Blocklist](#2-remove-domain-from-blocklist)
3. [Register a Security Key](#3-register-a-security-key)
4. [Unlock a Blocked Site](#4-unlock-a-blocked-site)
5. [Auto-Relock on Expiry](#5-auto-relock-on-expiry)
6. [Browser Startup Cleanup](#6-browser-startup-cleanup)
7. [Change Unlock Duration](#7-change-unlock-duration)

---

## 1. Add Domain to Blocklist

The user types a domain or URL into the popup input and clicks **Add**. `popup.js` normalizes the input, sends it to the service worker, which persists it and rebuilds the block rules.

```mermaid
sequenceDiagram
    actor User
    participant popup.js
    participant normalize.js
    participant service-worker.js
    participant storage.js
    participant blocker.js

    User->>popup.js: clicks Add (or presses Enter)
    popup.js->>normalize.js: normalizeDomain(rawInput)
    normalize.js-->>popup.js: "reddit.com" (or null if invalid)
    popup.js->>service-worker.js: sendMessage({type:"ADD_DOMAIN", payload:{domain}})
    service-worker.js->>storage.js: getBlocklist()
    storage.js-->>service-worker.js: ["youtube.com", ...]
    service-worker.js->>storage.js: setBlocklist([...,"reddit.com"])
    Note over service-worker.js: If domain was unlocked,<br/>relockDomain() + removeUnlock() + alarms.clear()
    service-worker.js->>storage.js: getUnlocks()
    storage.js-->>service-worker.js: current unlocks
    service-worker.js->>blocker.js: syncBlockRules(blocklist, unlocks)
    Note over blocker.js: Removes old block rules,<br/>adds new rules for all<br/>non-unlocked domains
    blocker.js-->>service-worker.js: done
    service-worker.js-->>popup.js: {blocklist:[...]}
    popup.js->>User: re-renders list, shows "Added reddit.com"
```

**Key functions:**
- `popup.js:121` — `addDomain()`
- `lib/normalize.js:9` — `normalizeDomain()`
- `service-worker.js:91` — `ADD_DOMAIN` handler
- `lib/blocker.js:52` — `syncBlockRules()`

---

## 2. Remove Domain from Blocklist

The user clicks the × button next to a domain. The service worker removes it from the list, cleans up any active unlock for that domain, and rebuilds the block rules.

```mermaid
sequenceDiagram
    actor User
    participant popup.js
    participant service-worker.js
    participant storage.js
    participant blocker.js

    User->>popup.js: clicks × next to domain
    popup.js->>service-worker.js: sendMessage({type:"REMOVE_DOMAIN", payload:{domain}})
    service-worker.js->>storage.js: getBlocklist()
    storage.js-->>service-worker.js: current list
    service-worker.js->>storage.js: setBlocklist(filtered list)
    service-worker.js->>storage.js: getUnlocks()
    alt domain is currently unlocked
        service-worker.js->>blocker.js: relockDomain(domain)
        service-worker.js->>storage.js: removeUnlock(domain)
        service-worker.js->>chrome.alarms: clear("relock:domain")
    end
    service-worker.js->>blocker.js: syncBlockRules(newBlocklist, currentUnlocks)
    service-worker.js-->>popup.js: {blocklist:[...]}
    popup.js->>User: re-renders list without removed domain
```

**Key functions:**
- `popup.js:140` — `removeDomain()`
- `service-worker.js:110` — `REMOVE_DOMAIN` handler
- `lib/blocker.js:88` — `relockDomain()`
- `lib/blocker.js:52` — `syncBlockRules()`

---

## 3. Register a Security Key

The user clicks **Register Security Key** in the popup. The browser's WebAuthn API prompts the user to touch their key. The extension enforces hardware-only usage via four layers before storing the credential.

### Hardware Enforcement Layers

```mermaid
flowchart TD
    A[navigator.credentials.create] --> B{Layer 1:<br/>authenticatorAttachment<br/>= cross-platform?}
    B -- "enforced in options" --> C{Layer 2:<br/>hints: security-key<br/>(Chrome 129+ UI)}
    C --> D[User touches key]
    D --> E{Layer 3:<br/>getTransports() check<br/>hybrid/internal rejected?}
    E -- "has hybrid or internal" --> F[throw Error: Non-hardware key detected]
    E -- "only usb/nfc/ble or empty" --> G{Layer 4:<br/>AAGUID extracted<br/>from attestation}
    G --> H[Store credential in storage.js]
    H --> I[Return credentialData to popup.js]
```

### Full Sequence

```mermaid
sequenceDiagram
    actor User
    participant popup.js
    participant webauthn.js
    participant cbor.js
    participant storage.js

    User->>popup.js: clicks "Register Security Key"
    popup.js->>webauthn.js: registerCredential()
    webauthn.js->>webauthn.js: crypto.getRandomValues(32 bytes) → challenge
    webauthn.js->>Browser: navigator.credentials.create({publicKey, authenticatorAttachment:"cross-platform"})
    Browser->>User: prompts to touch security key
    User->>Browser: touches key
    Browser-->>webauthn.js: PublicKeyCredential
    webauthn.js->>webauthn.js: Layer 3: response.getTransports() — reject hybrid/internal
    webauthn.js->>cbor.js: cborDecode(attestationObject)
    cbor.js-->>webauthn.js: decoded map with authData
    webauthn.js->>webauthn.js: extractAAGUID(authData bytes 37–52)
    webauthn.js->>webauthn.js: importPublicKey(spkiBytes) — verifies key is usable
    webauthn.js->>webauthn.js: read signCount from authData bytes 33–36
    webauthn.js->>storage.js: setCredential({credentialId, publicKeySpki, transports, signCount, aaguid, createdAt})
    webauthn.js-->>popup.js: credentialData
    popup.js->>User: renders "Registered" state with AAGUID + date
```

**Key functions:**
- `popup.js:148` — `handleRegister()`
- `lib/webauthn.js:101` — `registerCredential()`
- `lib/webauthn.js:64` — `extractAAGUID()`
- `lib/cbor.js:4` — `cborDecode()`
- `lib/storage.js:29` — `setCredential()`

---

## 4. Unlock a Blocked Site

This is the most complex flow. The user navigates to a blocked domain, is redirected to `blocked.html`, clicks **Unlock with Security Key**, and completes a WebAuthn assertion. The service worker then adds a temporary allow rule and schedules a re-lock alarm.

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant blocked.js
    participant webauthn.js
    participant service-worker.js
    participant storage.js
    participant blocker.js
    participant chrome.alarms

    User->>Browser: navigates to reddit.com
    Browser->>Browser: declarativeNetRequest block rule (priority 1) fires
    Browser->>blocked.js: redirects to blocked.html?domain=reddit.com
    blocked.js->>service-worker.js: sendMessage({type:"GET_STATE"})
    service-worker.js-->>blocked.js: {credential: {...}}
    blocked.js->>blocked.js: enables Unlock button (credential exists)

    User->>blocked.js: clicks "Unlock with Security Key"
    blocked.js->>webauthn.js: verifyWithCredential()
    webauthn.js->>storage.js: getCredential()
    storage.js-->>webauthn.js: {credentialId, publicKeySpki, signCount, transports, ...}
    webauthn.js->>webauthn.js: crypto.getRandomValues(32 bytes) → fresh challenge
    webauthn.js->>Browser: navigator.credentials.get({challenge, allowCredentials:[credentialId]})
    Browser->>User: prompts to touch security key
    User->>Browser: touches key
    Browser-->>webauthn.js: AuthenticatorAssertionResponse

    Note over webauthn.js: Reconstruct signed data:<br/>authenticatorData + SHA-256(clientDataJSON)
    webauthn.js->>webauthn.js: importPublicKey(spkiBytes)
    webauthn.js->>webauthn.js: derToIEEEP1363(signature) — DER → raw r||s
    webauthn.js->>webauthn.js: crypto.subtle.verify(ECDSA/SHA-256, publicKey, sig, signedData)
    Note over webauthn.js: throws if invalid signature
    webauthn.js->>webauthn.js: check newSignCount > stored signCount
    Note over webauthn.js: throws if counter didn't increase<br/>(clone detection)
    webauthn.js->>storage.js: setCredential({...credentialData, signCount: newSignCount})
    webauthn.js-->>blocked.js: {verified: true}

    blocked.js->>service-worker.js: sendMessage({type:"UNLOCK_DOMAIN", payload:{domain:"reddit.com"}})
    service-worker.js->>storage.js: getSettings()
    storage.js-->>service-worker.js: {unlockDurationMinutes: 30}
    service-worker.js->>blocker.js: unlockDomain("reddit.com")
    blocker.js->>blocker.js: add allow rule (priority 2, ID ≥ 10001)
    service-worker.js->>storage.js: setUnlock("reddit.com", {unlockedAt, expiresAt})
    service-worker.js->>chrome.alarms: create("relock:reddit.com", {delayInMinutes: 30})
    service-worker.js-->>blocked.js: {success: true}

    blocked.js->>Browser: window.location.href = "https://reddit.com"
    Browser->>Browser: allow rule (priority 2) overrides block rule
    Browser->>User: loads reddit.com
```

**Key functions:**
- `blocked.js:23` — click handler
- `lib/webauthn.js:169` — `verifyWithCredential()`
- `lib/webauthn.js:33` — `derToIEEEP1363()`
- `service-worker.js:127` — `UNLOCK_DOMAIN` handler
- `lib/blocker.js:72` — `unlockDomain()`
- `lib/storage.js:41` — `setUnlock()`

---

## 5. Auto-Relock on Expiry

When the unlock duration expires, Chrome fires the alarm created during the unlock flow. The service worker removes the allow rule and clears the unlock record.

```mermaid
sequenceDiagram
    participant chrome.alarms
    participant service-worker.js
    participant blocker.js
    participant storage.js

    chrome.alarms->>service-worker.js: onAlarm fires: {name: "relock:reddit.com"}
    service-worker.js->>service-worker.js: alarm.name.startsWith("relock:") → domain = "reddit.com"
    service-worker.js->>blocker.js: relockDomain("reddit.com")
    blocker.js->>blocker.js: find allow rule with urlFilter "||reddit.com/"
    blocker.js->>blocker.js: updateDynamicRules({removeRuleIds:[ruleId]})
    service-worker.js->>storage.js: removeUnlock("reddit.com")
    storage.js->>storage.js: delete unlocks["reddit.com"], save
```

Note: the block rule for `reddit.com` was never removed — only the allow rule (which was overriding it) is removed. The domain is immediately blocked again for the next navigation.

**Key functions:**
- `service-worker.js:62` — `onAlarm` listener
- `lib/blocker.js:88` — `relockDomain()`
- `lib/storage.js:47` — `removeUnlock()`

---

## 6. Browser Startup Cleanup

When Chrome starts, the service worker checks for unlocks that expired while the browser was closed (alarms do not fire for missed events). Expired unlocks are cleaned up, and block rules are re-synced to match current state.

```mermaid
sequenceDiagram
    participant Chrome
    participant service-worker.js
    participant storage.js
    participant blocker.js
    participant chrome.alarms

    Chrome->>service-worker.js: onStartup fires
    service-worker.js->>storage.js: getUnlocks()
    storage.js-->>service-worker.js: {domain: {expiresAt, unlockedAt}, ...}
    loop for each unlock
        service-worker.js->>service-worker.js: check expiresAt <= Date.now()
        alt expired
            service-worker.js->>blocker.js: relockDomain(domain)
            service-worker.js->>storage.js: removeUnlock(domain)
            service-worker.js->>chrome.alarms: clear("relock:domain")
        end
    end
    service-worker.js->>storage.js: getBlocklist()
    service-worker.js->>storage.js: getUnlocks() (post-cleanup)
    service-worker.js->>blocker.js: syncBlockRules(blocklist, currentUnlocks)
```

**Key functions:**
- `service-worker.js:40` — `onStartup` listener
- `lib/blocker.js:52` — `syncBlockRules()`

---

## 7. Change Unlock Duration

The user selects a new duration from the dropdown in the popup. The change is sent directly to the service worker, which merges it into the settings object.

```mermaid
sequenceDiagram
    actor User
    participant popup.js
    participant service-worker.js
    participant storage.js

    User->>popup.js: selects new value in unlock-duration dropdown
    popup.js->>popup.js: unlockDurationSelect change event fires
    popup.js->>service-worker.js: sendMessage({type:"UPDATE_SETTINGS", payload:{unlockDurationMinutes:60}})
    service-worker.js->>storage.js: updateSettings({unlockDurationMinutes:60})
    storage.js->>storage.js: merge partial into current settings, save
    service-worker.js->>storage.js: getSettings()
    storage.js-->>service-worker.js: {unlockDurationMinutes:60}
    service-worker.js-->>popup.js: {settings:{unlockDurationMinutes:60}}
```

The new duration takes effect for the next unlock. Active unlocks are not modified.

**Key functions:**
- `popup.js:107` — `saveDuration()`
- `service-worker.js:158` — `UPDATE_SETTINGS` handler
- `lib/storage.js:57` — `updateSettings()`
