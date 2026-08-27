---
name: sl-hol-guard
description: This skill should be used when the user asks to "set up HOL Guard", "protect my coding agent", "guard Claude Code", "guard Codex", "add runtime protection to my agent", "review HOL Guard approvals", "check HOL Guard receipts", or invokes "/sl-hol-guard". It installs and invokes HOL Guard around supported local agent runtimes and verifies protection before declaring success.
version: 0.1.0
targets:
  - claude-code
  - codex
allowed-tools:
  - Bash
  - Read
  - Grep
tags: [security, agent-safety, runtime, hol-guard]
---

# HOL Guard runtime safety

Use the real HOL Guard CLI to put a local coding-agent runtime behind Guard. Do not replace Guard with a prompt-only deny-list or claim protection based on configuration text alone.

## Safety rules

- Never read `.env` files or copy secrets into the conversation.
- Never bypass, auto-approve, or fabricate a Guard approval.
- Do not manually rewrite user-level agent configuration when a `hol-guard` command owns that change.
- Do not say a harness is protected until a Guard command verifies its state.
- Preserve existing user changes and prefer reversible Guard-owned operations.

## Inspect the current machine

Check whether HOL Guard is installed and which supported harnesses are present:

```bash
command -v hol-guard
hol-guard status
hol-guard detect --json
```

If `hol-guard` is missing and runtime protection was requested, install the isolated CLI:

```bash
pipx install hol-guard
```

If `pipx` is unavailable, explain that isolated CLI installation is preferred rather than silently modifying the project's Python environment.

## Protect the selected harness

Use the harness identifier returned by `hol-guard detect --json`; do not guess it from a hard-coded list.

```bash
hol-guard bootstrap
hol-guard install <harness>
hol-guard run <harness> --dry-run
hol-guard run <harness>
hol-guard status
```

Treat any failed install, dry run, or status check as a failed setup. Report the actual error instead of claiming partial protection is equivalent to success.

## Handle approvals without bypassing them

When Guard asks for review, inspect the pending request and let the user make the decision:

```bash
hol-guard approvals
hol-guard approvals open
hol-guard receipts
hol-guard diff <harness>
```

Only run an approval mutation when the user has explicitly chosen the action:

```bash
hol-guard approvals approve <request-id>
hol-guard approvals deny <request-id>
```

Never infer approval from silence or from a benign-looking command.

## Verify evidence

Use Guard-owned evidence surfaces when the user asks what happened or whether protection is active:

```bash
hol-guard receipts
hol-guard inventory
hol-guard events
hol-guard doctor <harness> --json
```

Do not turn a preview or pattern-inspection result into a claim that the full active runtime policy approved an action.

## Optional plugin or skill verification

`plugin-scanner` is a separate distribution. If the user asks to inspect an agent plugin or skill package, check for it independently:

```bash
command -v plugin-scanner
```

If it is missing and package scanning was requested:

```bash
pipx install plugin-scanner
```

Then run the package checks from the package root:

```bash
plugin-scanner lint .
plugin-scanner verify .
```

Treat scanner failures as findings to inspect, not warnings to suppress.

## Completion

Finish with the harness that was protected, the commands that verified it, any pending approval requests, and any check that did not pass. Keep verified setup facts separate from assumptions.
