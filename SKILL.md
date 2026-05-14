---
name: swarm-test
description: Use when the user asks you to test, validate, verify, smoke-check, or "lance le swarm" on a feature they just implemented in this conversation. Triggers on phrases like "lance le swarm", "lance les tests", "teste ce qu'on vient de faire", "swarm-test", "/swarm-test", "test the feature", "validate this", "check if it works in the browser". Generates and executes a focused Playwright spec against the local dev server based on what was just coded, captures screenshots, visually analyzes them for UX and business issues, and reports findings. Skip if the project has no web frontend or no dev server.
---

# swarm-test: validate the feature you just shipped

You just helped the user implement (or modify) a feature. Now you validate it end-to-end in a real browser. Your goal: catch bugs the user would only notice by clicking through the flow themselves.

## Mental model

You are NOT running a generic test suite. You are testing **the specific thing you just changed in this conversation**. Use the file edits, diffs, and intent you remember from earlier turns to focus the test on the right surface area.

If you cannot recall a concrete user-visible change from this conversation, STOP and ask the user what to test. Don't crawl the app at random.

## Workflow

Follow these steps in order. Skip none. The numbered structure exists to keep you honest.

### 1. Recap what you changed (output to user)

In 3-5 lines, tell the user:

- Files touched in this conversation
- Routes / pages / components affected
- The user journey that should now work (or work differently)
- Any auth / preconditions required to exercise it

Confirm with the user if the journey is ambiguous. **Do not proceed silently** — they should see what you're about to test before you spend tokens running it.

### 2. Make sure the dev server is up

Run from the project root (where `package.json` with the dev script lives):

```bash
node $CLAUDE_PROJECT_DIR/.claude/skills/swarm-test/scripts/ensure-dev-server.js
```

(If installed at user level, substitute `~/.claude/skills/swarm-test/`.)

It prints JSON. Two possible shapes:

- `{ "ready": true, "url": "..." }` — proceed
- `{ "ready": false, "suggested_command": "pnpm run dev", "suggested_cwd": "..." }` — **do NOT spawn the server yourself**. Tell the user:
  > Your dev server is not responding on `<url>`. Run `<suggested_command>` from `<cwd>` in another terminal, then say "go".

  Wait for their explicit confirmation. Server lifecycle is the user's concern, not yours.

### 3. Prepare the run directory

Create:
```
.swarm-test/runs/<ISO-timestamp>/
```
e.g. `.swarm-test/runs/2026-05-14T17-40-00/`. This is where the spec, screenshots, and any artifacts go for this run.

### 4. Write a focused Playwright spec

Write `.swarm-test/runs/<ts>/feature.spec.ts`. Use `templates/spec-template.ts` (in this skill dir) as a starting structure if helpful, but always adapt to the change at hand.

Rules:
- **Target the route(s) you just changed.** Never crawl random pages.
- Use `test.step('NN-label', async () => { ... })` for every meaningful user action. The step label is also the screenshot filename, so use `01-`, `02-`, etc. for ordering.
- Take a screenshot at the END of every step:
  ```ts
  await page.screenshot({ path: '<absolute path to .swarm-test/runs/<ts>/NN-label.png>', fullPage: false });
  ```
- Stable selectors only: `getByRole`, `getByLabel`, `getByText`, `getByTestId`. Never `nth-child` / `nth-of-type` / CSS positional selectors.
- Wait for `networkidle` or a specific element. Forbidden: `page.waitForTimeout(<number>)` with arbitrary delays.
- If the feature is behind auth, read the project root `CLAUDE.md` and `.swarm-test/memory/` for test credentials. If none, ask the user — do not invent.

The spec should be **3-8 steps**. If you're writing 15 steps, you're testing too much — focus on the user journey for the change.

### 5. Execute

```bash
node $CLAUDE_PROJECT_DIR/.claude/skills/swarm-test/scripts/run-spec.js .swarm-test/runs/<ts>/feature.spec.ts
```

It returns JSON with exit code, stdout, stderr. If a step fails:
- **Retry once** with a corrected selector or a more specific wait condition.
- Never modify the application source code from this skill.
- If it still fails, capture the failure and continue analysis with whatever screenshots exist.

### 6. Visually analyze the screenshots

List `.swarm-test/runs/<ts>/*.png`. For every screenshot, use the Read tool (it returns images visually). For each one, ask yourself:

1. **Wording vs action** — does visible copy match what's about to happen on click?
2. **Step ordering** — is the journey logical, or does it feel arbitrary?
3. **Business rules** — do the rules in the project root `CLAUDE.md` still hold at this screen?
4. **Dead ends** — can the user always go back, retry, or get help?
5. **Error messages** — actionable, or just "Something went wrong"?
6. **Missing info** — does the user have enough info to make a decision (prices, terms, consequences)?
7. **Inconsistencies** — does what's shown contradict the previous step?

Be specific. Quote visible text. Don't invent rules that aren't documented somewhere.

Before flagging, check `.swarm-test/memory/known-false-positives.md` — if your finding matches a pattern listed there, drop it.

### 7. Report

Print a structured terminal-style summary to the user. Use a compact form:

```
swarm-test — <feature description, 1 line>

Playwright: 5/5 steps passed
Visual review:
  ✓ /pricing renders correctly
  ✓ Subscribe button opens the modal
  ⚠ 03-modal-open: "Continuer" button is greyed out but no help text explains why
  ✗ 04-stripe-iframe: iframe overflows on viewport < 1280px

Artifacts:
  Spec  : .swarm-test/runs/<ts>/feature.spec.ts
  Shots : .swarm-test/runs/<ts>/*.png
```

Severity scale for visual findings:
- ✗ **broken** — user blocked or business rule violated
- ⚠ **friction** — works but degrades the experience
- ✓ **ok**

### 8. Learn from the user's reaction

After you report, the user may confirm or dismiss findings:
- **Confirms a finding** ("yes that's wrong, fix it") → append a one-liner to `.swarm-test/memory/learned-rules.md` describing the pattern, so future runs are more sensitive to it.
- **Dismisses a finding** ("nah that's intentional") → append to `.swarm-test/memory/known-false-positives.md` describing the pattern, so future runs skip it.

Keep entries short (one line each, with date prefix). Don't accumulate noise.

## Anti-patterns — don't do these

- ❌ Maintain a `flows/*.md` catalog. You test what was just coded, not a static catalog.
- ❌ Crawl the entire app to "be thorough". Stay scoped to the change.
- ❌ Skip the screenshot step because "Playwright didn't throw". Visual review is the whole point.
- ❌ Report a feature as passing without the visual analysis (step 6). Playwright green ≠ feature correct.
- ❌ Spawn the dev server with `nohup ... &` or detach hacks. Ask the user to run it.
- ❌ Test things you don't have a clear user journey for. Ask first.

## Conventions

- One run = one feature scope. If the user just shipped two unrelated things, do two runs.
- All artifacts under `.swarm-test/runs/<ISO-timestamp>/`. Gitignored.
- Memory files (`.swarm-test/memory/*.md`) ARE committed — they're the project's accumulated test knowledge.
- This skill has no required config file. It reads `package.json`, `CLAUDE.md`, lockfiles, and the conversation. That's it.

## Optional: when the user wants a broader sweep

If the user explicitly says "run the full swarm" or "test everything", you can:
1. List the project's main routes (read from `app/`, `pages/`, or framework router config).
2. For each, write a minimal smoke spec (navigate, screenshot, assert no console errors).
3. Run them sequentially.

But this is the exception. The default is feature-driven.
