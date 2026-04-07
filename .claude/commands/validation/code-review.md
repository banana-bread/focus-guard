---
description: Technical code review for quality and bugs that runs pre-commit
---

Perform technical code review on recently changed files.

## Core Principles

Review Philosophy:

- Simplicity is the ultimate sophistication - every line should justify its existence
- Code is read far more often than it's written - optimize for readability
- The best code is often the code you don't write
- Elegance emerges from clarity of intent and economy of expression

## What to Review

Start by gathering codebase context to understand the codebase standards and patterns.

Start by examining:

- CLAUDE.md
- Key files in `src/core/` (logger, messages, storage)
- Architecture patterns in `.agents/reference/vsa-patterns.md`
- Validation standards in `.agents/reference/validation-pyramid.md`

After you have a good understanding

Run these commands:

```bash
git status
git diff HEAD
git diff --stat HEAD
```

Then check the list of new files:

```bash
git ls-files --others --exclude-standard
```

Read each new file in its entirety. Read each changed file in its entirety (not just the diff) to understand full context.

For each changed file or new file, analyze for:

1. **Logic Errors**
   - Off-by-one errors
   - Incorrect conditionals
   - Missing error handling
   - Race conditions

2. **Security Issues**
   - WebAuthn trust boundary violations (state mutations outside service worker)
   - Missing transport filtering or AAGUID allowlist checks
   - Single-use challenge not enforced or TTL not respected
   - Sign counter monotonicity not checked (clone detection)
   - Sensitive data logged (raw assertions, credentials, keys)
   - `chrome.runtime.sendMessage` calls not using typed `RequestMessage`

3. **Performance Problems**
   - N+1 queries
   - Inefficient algorithms
   - Memory leaks
   - Unnecessary computations

4. **Code Quality**
   - Violations of DRY principle
   - Overly complex functions
   - Poor naming
   - Missing type hints/annotations

5. **Adherence to Codebase Standards and Existing Patterns**
   - VSA slice boundaries respected (no cross-slice imports; shared utilities in `shared/` only if used by 3+ slices)
   - Strict TypeScript: no implicit `any`, explicit type annotations on all functions and variables
   - Logging: structured objects (not string interpolation), `snake_case` event names, `trace_id` on cross-boundary logs, `fix_suggestion` on error/warn
   - File size: flag files approaching or exceeding ~300 lines as refactor candidates
   - No default exports; named exports only
   - JSDoc on all exported symbols

## Verify Issues Are Real

- Run specific tests for issues found
- Confirm type errors are legitimate
- Validate security concerns with context

## Output Format

Save a new file to `.agents/code-reviews/[appropriate-name].md`

**Stats:**

- Files Modified: 0
- Files Added: 0
- Files Deleted: 0
- New lines: 0
- Deleted lines: 0

**For each issue found:**

```
severity: critical|high|medium|low
file: path/to/file.ts
line: 42
issue: [one-line description]
detail: [explanation of why this is a problem]
suggestion: [how to fix it]
```

If no issues found: "Code review passed. No technical issues detected."

## Important

- Be specific (line numbers, not vague complaints)
- Focus on real bugs, not style
- Suggest fixes, don't just complain
- Flag security issues as CRITICAL