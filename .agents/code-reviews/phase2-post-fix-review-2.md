# Code Review: Phase 2 — Post-Fix Review (Round 2)

**Date:** 2026-04-09
**Branch:** rewrite/vsa-typescript
**Files reviewed:** src/popup/popup.ts, src/credential/credential.storage.ts, src/credential/credential.handler.test.ts, src/blocklist/blocklist.handler.test.ts

---

## Stats

- Files Modified: 4
- Files Added: 0
- Files Deleted: 0
- New lines: ~77
- Deleted lines: ~26

---

## Issues

---

```
severity: low
file: src/popup/popup.ts
line: 131
issue: init() still generates a fresh trace_id for GET_BLOCKLIST, undoing the trace correlation fix
detail: The previous review fixed trace_id scoping in handleRegister() and handleAddDomain(),
  but init() was missed. Line 119 generates a trace_id for GET_CREDENTIAL_STATUS, but line 131
  passes `trace_id: crypto.randomUUID()` for the subsequent GET_BLOCKLIST fetch. These two
  messages form one logical startup flow, but the new UUID breaks the correlation in logs.
suggestion: Reuse the same trace_id:
    const listResp = await sendMessage({ type: 'GET_BLOCKLIST', trace_id });
```

---

```
severity: low
file: src/credential/credential.storage.ts
line: 4-6
issue: Module-level JSDoc is stale after the serialization approach changed
detail: The module doc still reads "Handles deserialisation of `Uint8Array` / `ArrayBuffer`
  fields that `chrome.storage.local` serialises as plain objects on read-back." The fix
  changed the approach entirely — binary fields are now stored as `number[]` wire format,
  so chrome.storage never sees Uint8Array or ArrayBuffer, and no plain-object deserialisation
  occurs. The doc describes the problem we solved, not the approach used.
suggestion: Update the module doc to reflect the current design:
    /**
     * Storage accessors for the registered WebAuthn credential.
     *
     * Binary fields (credentialId, publicKey) are serialised as `number[]` in the wire
     * format so they survive chrome.storage.local's JSON round-trip without data loss.
     */
```

---

```
severity: low
file: src/credential/credential.handler.test.ts
line: 97-130
issue: Storage round-trip tests belong in a credential.storage.test.ts, not the handler test
detail: The new "credential storage round-trip" describe block imports and calls
  getCredential/setCredential directly — it tests credential.storage.ts, not the handlers.
  Placing storage-layer tests in a handler test file misrepresents coverage and makes
  storage tests harder to find. The handler test file should only test handler behaviour.
suggestion: Move the two storage round-trip tests to a new
  src/credential/credential.storage.test.ts file. This keeps test files aligned with the
  module they test, consistent with the existing pattern (blocklist.handler.test.ts tests
  handlers, not blocklist.storage.ts directly).
```

---

## Summary

3 low-severity issues. No bugs, security issues, or correctness problems.

The high and medium issues from the previous rounds are all correctly fixed. The changes are
clean and the logic is sound. The three items above are polish — one missed trace_id
propagation, one stale doc string, and one test file organization note.
