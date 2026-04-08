# Code Review — Phase 1a: Core Infrastructure

**Date:** 2026-04-07
**Branch:** rewrite/vsa-typescript
**Reviewer:** automated (code-review skill)

---

## Stats

- Files Modified: 2 (`manifest.json`, `vite.config.ts`)
- Files Added: 6 (`src/core/config.ts`, `src/core/messages.ts`, `src/core/storage.ts`, `src/service-worker.ts`, `src/shared/domain.ts`, `src/shared/domain.test.ts`)
- Files Deleted: 0
- New lines: ~200
- Deleted lines: ~5

---

## Issues

---

```
severity: high
file: src/core/messages.ts
line: 20
issue: ArrayBuffer fields are not serializable over chrome.runtime.sendMessage
detail: `REGISTER_CREDENTIAL.attestation: ArrayBuffer` and `VERIFY_ASSERTION.assertion: ArrayBuffer` will not survive the structured-clone serialization that chrome.runtime.sendMessage uses. ArrayBuffers are transferable (neutered on send) and are not reliably round-tripped as ArrayBuffers — they arrive as plain objects in the receiving end. This will silently corrupt the WebAuthn data before it reaches the service worker.
suggestion: Change both fields to `Uint8Array`. Uint8Arrays serialize cleanly over the message channel and can be converted back to ArrayBuffer in the service worker with `.buffer`. Update the JSDoc accordingly.
```

---

```
severity: medium
file: src/core/storage.ts
line: 54-86
issue: chrome.runtime.lastError is never checked in storage callbacks — errors are silently swallowed
detail: The callback-style chrome.storage.local API sets `chrome.runtime.lastError` on failure (e.g., quota exceeded, storage unavailable). Because none of the three helpers read it, a failing write or read will call resolve() with undefined and the caller will never know. This can lead to silent data loss — e.g., a blocklist write appears to succeed but nothing was persisted.
suggestion: Either switch to the Promise-based API (Chrome 88+, MV3-safe): `await chrome.storage.local.get(key)` returns the result object directly; or add error checks in each callback: `if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }`.
```

---

```
severity: low
file: src/service-worker.ts
line: 55
issue: "message_handled" debug log executes on the error path too, logging misleadingly after an error was caught
detail: The `logger.debug('message_handled', ...)` call on line 55 is outside the try/catch block, so it runs regardless of whether the catch branch fired. A caller reading the logs will see both `message_handler_threw` and `message_handled` for the same trace_id, which implies successful handling.
suggestion: Move the success log inside the try block, just before the end. Add a separate `duration_ms` measurement in the catch block, or simply omit the "handled" log on the error path.
```

---

```
severity: low
file: src/service-worker.ts
line: 39, 43
issue: Redundant `(msg as RequestMessage).type` cast — msg is already RequestMessage
detail: Inside the `default:` branch of a switch on `msg.type`, `msg` is already typed as `RequestMessage`. The `as RequestMessage` cast is noise.
suggestion: Replace `(msg as RequestMessage).type` with `msg.type` on both lines.
```

---

```
severity: low
file: src/shared/domain.test.ts
line: 1-36
issue: Missing test cases for port stripping and non-www subdomain preservation
detail: (1) `normalizeDomain('https://reddit.com:8080/path')` should return `'reddit.com'` — the URL parser includes the port in `hostname` only if it's non-standard; this is fine, but a test documents the behaviour. (2) A subdomain like `news.reddit.com` should NOT be stripped to `reddit.com` — there is no test confirming that only `www.` is removed, not arbitrary subdomains.
suggestion: Add:
  it('preserves non-www subdomain', () => {
    expect(normalizeDomain('news.reddit.com')).toBe('news.reddit.com');
  });
  it('strips port', () => {
    expect(normalizeDomain('https://reddit.com:8080/path')).toBe('reddit.com');
  });
```

---

## Summary

The overall structure is clean and well-typed. The VSA boundaries are respected, logging follows the structured pattern, and JSDoc is present on all exported symbols. The critical issue to resolve before wiring up UI contexts is the `ArrayBuffer` serialization problem in `messages.ts` — it will silently break the WebAuthn data flow. The storage error-handling gap is the next most important fix to avoid silent data loss.
