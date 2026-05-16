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

### 0. Version check (best-effort, non-blocking)

Run this once, ignore any error, never let it block the run:

```bash
D=~/.claude/skills/swarm-test; [ -d "$D/.git" ] && git -C "$D" fetch --quiet origin main 2>/dev/null && \
  LOCAL=$(git -C "$D" rev-parse HEAD) && REMOTE=$(git -C "$D" rev-parse origin/main) && \
  [ "$LOCAL" != "$REMOTE" ] && echo "OUTDATED" || echo "OK"
```

If it prints `OUTDATED`, mention to the user in one line: _"A newer swarm-test exists — run `~/.claude/skills/swarm-test/install.sh --update` when convenient."_ Then continue normally. If the path doesn't exist (skill installed elsewhere / vendored), skip silently.

### 1. Recap what you changed (output to user)

In 3-5 lines, tell the user:

- Files touched in this conversation
- Routes / pages / components affected
- The user journey that should now work (or work differently)
- Any auth / preconditions required to exercise it

Confirm with the user if the journey is ambiguous. **Do not proceed silently** — they should see what you're about to test before you spend tokens running it.

### 2. Make sure the dev server is up

Determine the target URL:
- Read the nearest ancestor `package.json` with the Read tool.
- Look at `scripts.dev`. Extract the port from `--port N`, `--port=N`, `-p N`, or `-p=N`. Default to 3000 if absent.
- Target URL is `http://localhost:<port>`.

Probe with curl:

```bash
curl -fsS --max-time 3 http://localhost:<port>/ >/dev/null && echo READY || echo DOWN
```

- **READY** → proceed.
- **DOWN** → **do NOT spawn the server yourself.** Tell the user the exact command to run, derived from the detected package manager (look at the lockfile in the same directory or above: `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lockb` → `bun`, `package-lock.json` → `npm`; or read `packageManager` field in package.json). Example:

  > Your dev server is not responding on http://localhost:3000. Run `pnpm run dev` from `/Users/.../apps/uca` in another terminal, wait for it to be ready, then say "go".

  Wait for the user's explicit confirmation. Server lifecycle is the user's concern, not yours.

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
- If the feature is behind auth, follow the **Handling authentication** section below before writing the spec.

The spec should be **3-8 steps**. If you're writing 15 steps, you're testing too much — focus on the user journey for the change.

### 5. Execute

Run the spec directly with Playwright's CLI. From the project root that has Playwright installed:

```bash
npx playwright test .swarm-test/runs/<ts>/feature.spec.ts --reporter=line
```

Capture the exit code and the stdout — Playwright reports per-step pass/fail and timings.

If a step fails:
- **Retry once** with a corrected selector or a more specific wait condition.
- Never modify the application source code from this skill.
- If it still fails, capture the failure and continue analysis with whatever screenshots exist.

If `npx playwright` is not installed in the project, tell the user:
> Playwright is not installed. Run `pnpm add -D @playwright/test && npx playwright install chromium` then say "go".

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
  Report: .swarm-test/runs/<ts>/report.html   (opens in browser)
  Spec  : .swarm-test/runs/<ts>/feature.spec.ts
  Shots : .swarm-test/runs/<ts>/*.png
```

Severity scale for visual findings:
- ✗ **broken** — user blocked or business rule violated
- ⚠ **friction** — works but degrades the experience
- ✓ **ok**

### 8. Generate the visual report

After the terminal summary, write a self-contained HTML report so the user can verify, **step by step**, exactly what you tested. The report is a chronological timeline: one block per step, each block showing the action you performed, the screenshot you captured, and the findings tied to that specific step — all together so nothing has to be cross-referenced.

Write it to `.swarm-test/runs/<ts>/report.html` using exactly this structure (substitute the placeholders, no external CSS/JS, no CDNs — must work offline via `file://`):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>swarm-test · {{FEATURE_TITLE}}</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--panel2:#1f2630;--border:#30363d;--text:#e6edf3;--dim:#8b949e;--green:#3fb950;--yellow:#d29922;--red:#f85149;--orange:#db6d28;--accent:#58a6ff}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:24px}
header{padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:20px}
h1{font-size:18px;margin:0 0 4px}.sub{color:var(--dim);font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:28px}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px}
.kpi-l{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.kpi-v{font-size:22px;font-weight:600}.kpi.ok .kpi-v{color:var(--green)}.kpi.warn .kpi-v{color:var(--yellow)}.kpi.bad .kpi-v{color:var(--red)}
.timeline{position:relative;margin-left:14px;padding-left:28px;border-left:2px solid var(--border)}
.step{position:relative;margin-bottom:28px}
.step::before{content:'';position:absolute;left:-37px;top:2px;width:14px;height:14px;border-radius:50%;border:3px solid var(--bg);background:var(--dim)}
.step.ok::before{background:var(--green)}.step.warn::before{background:var(--yellow)}.step.bad::before{background:var(--red)}
.step-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.step-n{font-variant-numeric:tabular-nums;color:var(--dim);font-size:13px}
.step-title{font-weight:600;font-size:15px}
.tag{margin-left:auto;font-size:10px;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.04em;background:var(--border);color:var(--dim)}
.tag.ok{background:var(--green);color:#000}.tag.warn{background:var(--orange);color:#fff}.tag.bad{background:var(--red);color:#fff}
.step-action{color:var(--dim);font-size:13px;margin-bottom:10px}
.step-action b{color:var(--text);font-weight:500}
.shot{width:100%;display:block;border:1px solid var(--border);border-radius:8px;background:var(--panel2);cursor:zoom-in}
.no-shot{padding:16px;border:1px dashed var(--border);border-radius:8px;color:var(--dim);font-size:13px;text-align:center}
.finding{background:var(--panel);border-left:3px solid var(--yellow);border-radius:4px;padding:10px 14px;margin-top:10px;font-size:13px}
.finding.bad{border-left-color:var(--red)}.finding.warn{border-left-color:var(--orange)}.finding.ok{border-left-color:var(--green)}
.finding .lbl{display:inline-block;font-size:10px;padding:1px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.04em;margin-right:8px;background:var(--border);color:var(--dim);vertical-align:middle}
.finding.bad .lbl{background:var(--red);color:#fff}.finding.warn .lbl{background:var(--orange);color:#fff}.finding.ok .lbl{background:var(--green);color:#000}
.finding .sugg{color:var(--dim);font-size:12px;margin-top:4px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:28px 0 12px}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:100;cursor:zoom-out}
.lightbox.on{display:flex}.lightbox img{max-width:96%;max-height:96%;border:1px solid var(--border);border-radius:4px}
footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--border);color:var(--dim);font-size:12px}
code{background:var(--panel2);padding:2px 5px;border-radius:3px;font-size:12px;color:var(--text)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>{{FEATURE_TITLE}}</h1>
    <div class="sub">{{TIMESTAMP}} · {{TARGET_URL}} · run {{RUN_TS}}</div>
  </header>

  <div class="kpis">
    <div class="kpi"><div class="kpi-l">Steps</div><div class="kpi-v">{{STEP_COUNT}}</div></div>
    <div class="kpi ok"><div class="kpi-l">OK</div><div class="kpi-v">{{OK_COUNT}}</div></div>
    <div class="kpi warn"><div class="kpi-l">Friction</div><div class="kpi-v">{{WARN_COUNT}}</div></div>
    <div class="kpi bad"><div class="kpi-l">Broken</div><div class="kpi-v">{{BAD_COUNT}}</div></div>
    <div class="kpi"><div class="kpi-l">Playwright</div><div class="kpi-v" style="font-size:15px">{{PW_STATUS}}</div></div>
  </div>

  <div class="timeline">
    {{STEPS_HTML}}
  </div>

  {{GENERAL_FINDINGS_BLOCK}}

  <footer>
    <div>Spec: <code>{{SPEC_PATH}}</code></div>
    <div>Memory: <code>.swarm-test/memory/</code></div>
  </footer>
</div>

<div class="lightbox" id="lb" onclick="this.classList.remove('on')"><img id="lbi" src=""></div>
<script>
document.querySelectorAll('.shot').forEach(img=>{
  img.addEventListener('click',()=>{document.getElementById('lbi').src=img.getAttribute('src');document.getElementById('lb').classList.add('on')})
});
</script>
</body>
</html>
```

Substitutions:

- `{{FEATURE_TITLE}}` — one-line description of what was tested
- `{{TIMESTAMP}}` — human date (`2026-05-16 14:20`)
- `{{RUN_TS}}` — the ISO timestamp of the run dir
- `{{TARGET_URL}}`
- `{{STEP_COUNT}}` — total number of steps
- `{{OK_COUNT}}`, `{{WARN_COUNT}}`, `{{BAD_COUNT}}` — counts of findings by severity
- `{{PW_STATUS}}` — e.g. `2/3 passed`
- `{{SPEC_PATH}}` — relative path to the spec file
- `{{STEPS_HTML}}` — the heart of the report: one `<div class="step …">` per step, **in execution order**. For every step you must fill all three parts (action, screenshot, findings) so the user can verify without cross-referencing. Per-step template:

  ```html
  <div class="step <ok|warn|bad>">
    <div class="step-head">
      <span class="step-n">Step 01</span>
      <span class="step-title">Navigate to /pricing</span>
      <span class="tag <ok|warn|bad>"><passed | friction | broken></span>
    </div>
    <div class="step-action">
      <b>Action:</b> what you actually did in this step (the click/fill/navigation), in plain language.<br>
      <b>Expected:</b> what should happen. <b>Observed:</b> what the screenshot shows.
    </div>
    <img class="shot" src="01-navigate.png" alt="Step 01">
    <!-- if no screenshot exists for this step: -->
    <!-- <div class="no-shot">No screenshot — step did not execute (blocked at step N)</div> -->
    <!-- zero or more findings tied to THIS step: -->
    <div class="finding <ok|warn|bad>">
      <span class="lbl"><wording|ux|business|dead-end|error|missing-info></span>
      Factual observation, quote visible text from the screenshot when relevant.
      <div class="sugg">Suggestion: concrete fix.</div>
    </div>
  </div>
  ```

  Rules for `{{STEPS_HTML}}`:
  - The image `src` is just the filename (report and screenshots share the run dir).
  - The step's severity class = the worst finding on it (`bad` > `warn` > `ok`). No findings = `ok`.
  - Always include the **Action / Expected / Observed** line, even when the step passed cleanly — that's what makes the run verifiable.
  - If a step failed to execute (blocked earlier), still emit the block with the `no-shot` div and a one-line reason.

- `{{GENERAL_FINDINGS_BLOCK}}` — only for findings NOT tied to a specific step (e.g. cross-cutting business-rule observations). If there are none, substitute an empty string. Otherwise:
  ```html
  <h2>General findings</h2>
  <div class="finding warn"><span class="lbl">business</span> … <div class="sugg">Suggestion: …</div></div>
  ```

Then open it:

```bash
REPORT=".swarm-test/runs/<ts>/report.html"
case "$(uname)" in
  Darwin) open "$REPORT" ;;
  Linux)  xdg-open "$REPORT" 2>/dev/null || echo "Open manually: $REPORT" ;;
  *)      echo "Open manually: $REPORT" ;;
esac
```

Tell the user the report path in the terminal summary so they know where to find it later.

### 9. Learn from the user's reaction

After you report, the user may confirm or dismiss findings:
- **Confirms a finding** ("yes that's wrong, fix it") → append a one-liner to `.swarm-test/memory/learned-rules.md` describing the pattern, so future runs are more sensitive to it.
- **Dismisses a finding** ("nah that's intentional") → append to `.swarm-test/memory/known-false-positives.md` describing the pattern, so future runs skip it.

Keep entries short (one line each, with date prefix). Don't accumulate noise.

## Handling authentication

Many apps gate the feature you just shipped behind auth. Driving a full sign-in flow from a Playwright spec is fragile. Strategies in order of preference:

### Strategy A — reuse a pre-authenticated browser session (best)

This is **auth-agnostic**. `storageState` snapshots the browser's cookies + localStorage for the app's origin — that's where almost every auth scheme persists the session. It works regardless of the provider: classic server-side sessions (Rails/Django/Express-session), JWT-in-cookie, JWT/token in localStorage, OAuth/OIDC (Auth0, Keycloak, Authentik, Okta, Google…), NextAuth, SAML. Whatever the login mechanism, the end result is a session in the browser on the app domain — that's what gets captured.

Ask the user to sign in once and export the state:

1. One-time command (point them to the right dev URL):
   ```bash
   npx playwright open --save-storage=.swarm-test/auth/storage.json <dev-url>
   ```
   They sign in in the launched browser however the app requires, then close it. Cookies + localStorage are saved.
2. In your spec, load that state:
   ```ts
   test.use({ storageState: '.swarm-test/auth/storage.json' });
   ```

The `.swarm-test/auth/` directory MUST be gitignored (the session is per-person and sensitive). The skill auto-adds it on first use:
```bash
grep -q '^\.swarm-test/auth/' .gitignore || echo '.swarm-test/auth/' >> .gitignore
```

**Caveats where Strategy A is NOT enough** — fall back to Strategy B:
- **Session stored in IndexedDB** (e.g. Firebase Auth). `storageState` captures cookies + localStorage only, NOT IndexedDB — the saved state won't carry the session. Use a programmatic login fixture instead.
- **Short-lived tokens.** State goes stale fast; if it's older than a few hours, ask the user to re-capture.
- **Session bound to IP / device fingerprint.** The backend may reject a replayed session.
- **Client TLS certificate auth.** Not covered by storageState.

### Strategy B — programmatic test credentials

Look for test credentials in:
1. The project root `CLAUDE.md` (look for a "Test accounts" or "Test credentials" section)
2. `.swarm-test/memory/learned-rules.md`
3. `.env.test` or `.env.local` in the project

If found, hardcode the flow in the spec (`getByLabel('Email').fill(...)` etc.). Never log the password to stdout.

If no credentials are documented, ASK the user. Do not invent credentials.

### Strategy C — bypass the auth wall

If the feature is reachable via a public route or behind a feature flag, ask the user if the test should hit it directly (e.g. with a magic query param like `?test_mode=1`). Only do this if the user explicitly says it's safe.

### When all else fails

If auth can't be solved in this run, write the spec anyway but stop at the login screen. Take a screenshot of the login page. Tell the user:
> The spec gets to the login screen but can't go further without test credentials or a saved session. Choose strategy A or B from the swarm-test skill and re-run.

This is still useful: you've validated that the entry route renders, you've captured the login UI for visual review, and you've not wasted a long Playwright run on a flow that was always going to fail.

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
