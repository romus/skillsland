# Shared principles — context engineering for Claude 5 generation models

Source: "The new rules of context engineering for Claude 5 generation models",
Thariq Shihipar (Anthropic), 2026-07-24. The post behind removing over 80% of Claude
Code's system prompt "for models like Claude Opus 5 and Claude Fable 5 with no
measurable loss on our coding evaluations."

Every reviewer in the `skill` profile shares this vocabulary. It is stated once here
so the six reviewer prompts don't each restate it — which is principle 4 applied to
this file set.

## The thesis

A prompt is written for one request. Context — system prompt, skills, CLAUDE.md,
memory — is reused across requests you cannot predict:

> "Unlike a prompt, context is used generally across many requests, so it cannot be as
> specific."

So the cost of a bad rule is not just tokens. From "Unhobbling Claude":

> "we see several conflicting messages in a single request like 'leave documentation as
> appropriate,' or 'DO NOT add comments' as our system prompt, skills, and user requests
> clash with each other. Generally, Claude can interpret the user's intent to get to the
> right answer, but Claude must think more carefully about these overlapping and
> conflicting messages before deciding what to do."

Reasoning spent reconciling the author's own contradictions is the headline waste.

## The six Then → Now principles

1. **Give rules → Let Claude use judgement.** Strong guidance "might not always be true."
   The article's own before/after:
   - Before: *"In code: default to writing no comments. Never write multi-paragraph
     docstrings or multi-line comment blocks — one short line max. Don't create planning,
     decision, or analysis documents unless the user asks for them."*
   - After: *"Write code that reads like the surrounding code: match its comment density,
     naming, and idiom."*

   State the intent the rule was protecting, in a form that lets the model read
   surrounding context and decide.

2. **Give examples → Design interfaces.** Examples were "the number one rule for tool
   usage"; now they "actually constrain them to a certain exploration space." Instead:
   "think more about the design of your tools, scripts and files — what parameters does
   Claude have and how can they be more expressive?" The Todo tool is the counter-example:
   a `pending` / `in_progress` / `completed` enum "hints to Claude about how to use it",
   and one behavioural line ("keeping one item `in_progress`") pins the rest down.

3. **Put it all upfront → Use progressive disclosure.** Load the right context at the
   right time. Claude Code moved verification and code review into their own skills; some
   tools are deferred-loading behind `ToolSearch` so they "don't take up context until
   they're needed." The named myth:

   > "A common myth is that you want to make these a central repository for every known
   > practice that you might run into, because Claude would not find it otherwise. Instead,
   > consider having a tree of files that can be loaded at the right time."

   The test for what belongs behind disclosure rather than deleted: content that is "not
   always needed, but when they were, it was crucial information."

4. **Repeat yourself → Simple tool descriptions.** Instructions for using a tool live in
   that tool's description, once — not in the tool description *and* the prompt body. Two
   beliefs are retired as "earlier Claude models" properties: that repeated instructions
   are needed, and that Claude is "more likely to listen to instructions at the end of
   their context window than at the start."

5. **Memory in CLAUDE.md → Auto-memory.** The `#`-hotkey-writes-to-CLAUDE.md workflow is
   obsolete: "Claude now automatically saves memories that are relevant to the work and to
   you."

6. **Simple specs → Rich references.** Markdown plans are not the ceiling. A reference may
   be an HTML artifact, code, "a detailed test suite, or a function in a different codebase
   that Claude might port." Rubrics count too — they let Claude "verify your taste in a
   particular field (e.g. what does a good API design look like)".

## The four context layers

- **System prompt** — product context: what product Claude is in and what it's doing.
- **CLAUDE.md** — "Keep your CLAUDE.md lightweight and briefly describe what your repo is
  for, but spend most of the tokens on gotchas inside of the codebase." And: "Avoid stating
  'the obvious' things Claude should know by looking at your file system or your repo."
- **Skills** — three rules, quoted:
  - "Think of skills as lightweight guides to let Claude find information when needed."
  - "Avoid making them overconstrained, except in highly important areas."
  - "For long skills, try and use progressive disclosure as much as possible - divide it
    into many files and split them out."
  - Content test: "It's best when skills encode particular opinions, knowledge, or best
    practices that are particular to you, your team, or product."
- **References** — prefer code over prose: it "provides clear, high-fidelity instructions
  to Claude in a language it knows very well." Explicit ranking: an HTML mockup of a design
  beats a prose description beats a screenshot.

## Two caveats — honour these or the review misfires

1. **Over-constraint is permitted in high-stakes areas.** Stated twice: skills should avoid
   being overconstrained "except in highly important areas", and the old guardrails existed
   to "avoid worst case scenarios, such as deleting files." A read-only guarantee, a
   confirm-before-write gate, a no-commit or no-publish rule, credential handling — these
   are correct, not findings. Ask what the constraint prevents before flagging it; if
   removing it admits an irreversible action, it stays.

2. **The anti-examples rule is scoped to tool usage**, not to all examples: "The number one
   rule for *tool usage*…", "the design of your tools, scripts and files." Principle 6 runs
   the other way — test suites, mockups and rubrics as references are functionally worked
   examples and are recommended. Do not generalise principle 2 into "delete every example."

## Absent from the article — do not assert these as rules

The article says nothing about XML tags versus markdown, compaction, numeric token
budgets, how an agent should format its output, or under-prompting. It is one-directional:
cut, don't add. It also never discusses frontmatter, `description` fields, or how a skill
gets selected — the `skill-discovery` and `skill-catalogue-integrity` reviewers draw on this
repo's conventions (`CLAUDE.md`) instead, and say so.
