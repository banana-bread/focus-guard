# Agent Workflow Guide

A reference for how the slash commands fit together into a repeatable development loop.

---

## The Core Loop: Plan → Execute → Validate → Review

```
/create-prd        (optional, for new features from scratch)
       ↓
/plan-feature      → produces: .agents/plans/<feature>.md
       ↓
/prime             (optional, when starting a fresh session)
       ↓
/execute           → consumes: .agents/plans/<feature>.md
       ↓
/execution-report  → run immediately after execute, SAME conversation context
       ↓            (agent still has fresh memory of implementation decisions)
/validate          → runs: typecheck + lint + tests + build
       ↓
/code-review       → produces: .agents/code-reviews/<name>.md
       ↓
/code-review-fix   → consumes: .agents/code-reviews/<name>.md
       ↓
/commit
       ↓
/system-review     → consumes: plan + execution-report
```

---

## Command Reference

### Pre-planning

| Command | Input | Output | Purpose |
|---------|-------|--------|---------|
| `/create-prd [filename]` | Conversation context | `$ARGUMENTS` (default `PRD.md`) | Turn a discussion into a formal PRD before planning begins |
| `/prime` | Codebase | Console summary | Load project context at the start of a session — run this when the agent is cold |

### Planning

| Command | Input | Output | Purpose |
|---------|-------|--------|---------|
| `/plan-feature <description>` | Feature description + codebase | `.agents/plans/<kebab-name>.md` | Produce a context-rich implementation plan ready for one-pass execution |

The plan contains: user story, affected files, patterns to follow, ordered tasks with `VALIDATE` commands, testing strategy, and acceptance criteria.

### Execution

| Command | Input | Output | Purpose |
|---------|-------|--------|---------|
| `/execute <path-to-plan>` | `.agents/plans/<name>.md` | Working code + test files | Implement every task in the plan in order, running per-task validation as it goes |

### Validation

| Command | Input | Output | Purpose |
|---------|-------|--------|---------|
| `/validate` | Current codebase | Console report | Run `typecheck → lint → tests → build` and surface any failures |
| `/code-review` | `git diff HEAD` | `.agents/code-reviews/<name>.md` | Technical review of changed files: bugs, security, quality, pattern compliance |
| `/code-review-fix <review-file-or-description> [scope]` | Code review output | Fixed code | Fix each issue from the review, run tests per fix, then re-validate |

### Retrospective

| Command | Input | Output | Purpose |
|---------|-------|--------|---------|
| `/execution-report` | Completed implementation | `.agents/execution-reports/<feature>.md` | Reflect on what was built, what diverged from the plan, and why |
| `/system-review <plan-path> <report-path>` | Plan + execution report | `.agents/system-reviews/<feature>-review.md` | Meta-analysis of process quality — not code bugs, but workflow gaps |

### Commit

| Command | Input | Output | Purpose |
|---------|-------|--------|---------|
| `/commit` | Unstaged changes | Git commit | Stage all changes and create a conventional commit message |

---

## Chaining Rules

Commands produce artifacts that downstream commands consume. The chain only works when each artifact is in the expected location.

```
/plan-feature  →  .agents/plans/<name>.md
/execute       consumes  .agents/plans/<name>.md
/execution-report  →  .agents/execution-reports/<name>.md
/system-review consumes  .agents/plans/<name>.md + .agents/execution-reports/<name>.md
/code-review   →  .agents/code-reviews/<name>.md
/code-review-fix  consumes  .agents/code-reviews/<name>.md
```

**Key constraint:** `/execute` must receive the exact path to the plan file as its argument.  
**Key constraint:** `/system-review` requires both the plan path ($1) and the execution report path ($2).  
**Key constraint:** `/code-review-fix` takes the review file path as $1 and an optional scope as $2.

---

## Common Flows

### Full feature from scratch
```
/create-prd
/plan-feature <feature>
/execute .agents/plans/<feature>.md
/execution-report                                   ← same session, before validation
/validate
/code-review
/code-review-fix .agents/code-reviews/<name>.md
/commit
/system-review .agents/plans/<feature>.md .agents/execution-reports/<feature>.md
```

### Quick fix or small change
```
/execute .agents/plans/<feature>.md   ← skip planning if plan already exists
/validate
/commit
```

### Post-implementation retrospective only
```
/execution-report
/system-review .agents/plans/<feature>.md .agents/execution-reports/<feature>.md
```

### Starting a cold session
```
/prime                                ← load context first
/execute .agents/plans/<feature>.md  ← then continue work
```

---

## Artifact Locations

| Artifact | Location |
|----------|----------|
| Plans | `.agents/plans/<kebab-name>.md` |
| Execution reports | `.agents/execution-reports/<feature>.md` |
| System reviews | `.agents/system-reviews/<feature>-review.md` |
| Code reviews | `.agents/code-reviews/<name>.md` |
| PRDs | `.agents/prds/<name>.md` (or project root) |
