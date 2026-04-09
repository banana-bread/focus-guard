# Code Review: Phase 2 — Blocklist & Credential Slices + UI

**Date:** 2026-04-09
**Branch:** rewrite/vsa-typescript

---

## Stats

- Files Modified: 5
- Files Added: 15 (+ 1 execution report)
- Files Deleted: 0
- New lines: ~1,369
- Deleted lines: ~15

---

## Issues

---

```
severity: high
file: src/credential/credential.service.ts
line: 14
issue: Challenge TTL never enforced — CHALLENGE_TTL_MS exists but is unused
detail: CLAUDE.md states "Challenges are single-use, 2-minute TTL". core/config.ts
  exports CHALLENGE_TTL_MS = 120_000, but credential.service.ts never imports or
  uses it. The pendingChallenge stored at module level has no time-based expiry —
  it persists until the service worker is killed or a new challenge overwrites it.
  A challenge issued hours before the service worker restart could still be accepted.
suggestion: Store a timestamp alongside the challenge:
    let pendingChallenge: { bytes: Uint8Array; issuedAt: number } | null = null;
  In registerCredential(), before using the challenge, check:
    if (Date.now() - challenge.issuedAt > CHALLENGE_TTL_MS) {
      throw new Error('Registration challenge expired');
    }
  Import CHALLENGE_TTL_MS from '@/core/config'.
```

---

```
severity: medium
file: src/credential/credential.storage.ts
line: 16
issue: Return type of getCredential() lies — Uint8Array fields are plain objects after storage round-trip
detail: chrome.storage.local serializes Uint8Array as plain objects ({0:1, 1:2, ...})
  on read-back, but getCredential() declares it returns StoredCredential, which has
  credentialId: Uint8Array and publicKey: ArrayBuffer. The JSDoc acknowledges this
  ("callers must handle deserialisation") but no caller does, and there is no
  deserialization logic anywhere. getCredentialStatus() works today because it only
  checks !== undefined. Phase 3 assertion code that accesses credentialId or publicKey
  from storage will silently receive a plain object and fail with a cryptic runtime error.
suggestion: Either (a) handle deserialization here so getCredential() actually returns
  what its type says, or (b) change the return type to reflect reality. Option (a) is
  cleaner:
    const raw = await storageGet<Record<string, unknown>>(STORAGE_KEYS.CREDENTIAL);
    if (!raw) return undefined;
    return {
      credentialId: new Uint8Array(Object.values(raw.credentialId as Record<number, number>)),
      publicKey: (raw.publicKey as { buffer?: ArrayBuffer }).buffer ?? raw.publicKey as ArrayBuffer,
      signCounter: raw.signCounter as number,
      aaguid: raw.aaguid as string,
    };
  This makes the lie true rather than deferring a runtime crash to Phase 3.
```

---

```
severity: medium
file: src/popup/popup.ts
line: 115
issue: Service worker error silently degrades to "unregistered" state
detail: In init(), if GET_CREDENTIAL_STATUS returns ok: false, the code calls
  setUnregisteredState() and returns. This shows the "Register YubiKey" button to a
  user who already has a key registered. A transient service worker error (SW killed
  mid-restart, runtime.lastError) would trick the user into thinking their key is gone
  and potentially prompt them to register again — which would fail because a credential
  is already stored.
suggestion: Distinguish between "not registered" (ok: true, registered: false) and
  "error" (ok: false). On error, show a neutral error state rather than the register UI:
    if (!statusResp.ok) {
      showError(registerError, 'Could not connect to extension. Try reopening the popup.');
      return;
    }
```

---

```
severity: low
file: src/service-worker.ts
line: 65
issue: message_handled logged even when message was unhandled
detail: The logger.debug('message_handled', ...) on line 65 is outside the switch, so
  it fires for every branch including the default (unhandled) case. A reader tailing
  logs will see message_handled immediately after message_unhandled for unknown types,
  which is misleading.
suggestion: Move the message_handled log inside each case (or restructure with a
  helper), or guard it:
    if (msg.type in handledTypes) {
      logger.debug('message_handled', ...);
    }
  Simplest fix: move the log to before the switch's closing brace but after a
  `handled` flag, or just accept the minor noise and add a comment.
```

---

```
severity: low
file: src/blocklist/blocklist.service.ts
line: 23
issue: Read-modify-write in addDomain() is not concurrency-safe
detail: getBlocklist() reads, duplicate check runs, then syncRules + setBlocklist write.
  Two concurrent ADD_DOMAIN messages processed simultaneously (unlikely but possible if
  the popup sends two before the first completes) would both read the same oldList,
  pass the duplicate check for different domains, then race on write — the second write
  overwrites the first's result. One domain would be silently lost.
suggestion: For the current scale (<100 domains, single popup) this is acceptable risk.
  A comment noting the limitation is sufficient. If it matters later, a module-level
  lock (Promise chain) or optimistic concurrency check on write would solve it.
```

---

## Summary

5 issues found: 1 high, 2 medium, 2 low.

The high issue (missing TTL enforcement) is a CLAUDE.md compliance violation — the spec is explicit that challenges have a 2-minute TTL. The medium issue with storage deserialization is a latent bug that won't surface until Phase 3 but will be hard to debug when it does. Both are worth fixing before the next phase.

The popup degradation issue is a UX correctness bug — low security impact but a confusing user experience. The other two are code quality / minor robustness notes.
