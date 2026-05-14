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

After the terminal summary, write a self-contained HTML report so the user can browse the screenshots and findings visually. Write it to `.swarm-test/runs/<ts>/report.html` using exactly this structure (substitute the placeholders, do NOT add external CSS/JS, do NOT pull from CDNs — must work offline via `file://`):

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
.wrap{max-width:1200px;margin:0 auto;padding:24px}
header{padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:24px}
h1{font-size:18px;margin:0 0 4px}.sub{color:var(--dim);font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px}
.kpi-l{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.kpi-v{font-size:22px;font-weight:600}.kpi.ok .kpi-v{color:var(--green)}.kpi.warn .kpi-v{color:var(--yellow)}.kpi.bad .kpi-v{color:var(--red)}
section{margin-bottom:32px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:0 0 12px}
.finding{background:var(--panel);border-left:3px solid var(--yellow);border-radius:4px;padding:12px 16px;margin-bottom:8px}
.finding.bad{border-left-color:var(--red)}.finding.warn{border-left-color:var(--orange)}.finding.ok{border-left-color:var(--green)}
.f-head{display:flex;gap:8px;align-items:center;margin-bottom:6px}
.badge{font-size:10px;padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.04em;background:var(--border);color:var(--dim)}
.badge.bad{background:var(--red);color:#fff}.badge.warn{background:var(--orange);color:#fff}.badge.ok{background:var(--green);color:#000}
.steps{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.step{background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden;cursor:zoom-in}
.step img{width:100%;display:block;border-bottom:1px solid var(--border);background:var(--panel2)}
.step-meta{padding:10px 12px}.step-label{font-weight:500}.step-note{color:var(--dim);font-size:12px;margin-top:2px}
.step-status{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.step-status.ok{background:var(--green)}.step-status.warn{background:var(--yellow)}.step-status.bad{background:var(--red)}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.9);display:none;align-items:center;justify-content:center;z-index:100;cursor:zoom-out}
.lightbox.on{display:flex}.lightbox img{max-width:95%;max-height:95%;border:1px solid var(--border);border-radius:4px}
footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--border);color:var(--dim);font-size:12px}
code{background:var(--panel2);padding:2px 5px;border-radius:3px;font-size:12px;color:var(--text)}
a{color:var(--accent)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>{{FEATURE_TITLE}}</h1>
    <div class="sub">{{TIMESTAMP}} · {{TARGET_URL}} · run {{RUN_TS}}</div>
  </header>

  <section class="kpis">
    <div class="kpi ok"><div class="kpi-l">OK</div><div class="kpi-v">{{OK_COUNT}}</div></div>
    <div class="kpi warn"><div class="kpi-l">Friction</div><div class="kpi-v">{{WARN_COUNT}}</div></div>
    <div class="kpi bad"><div class="kpi-l">Broken</div><div class="kpi-v">{{BAD_COUNT}}</div></div>
    <div class="kpi"><div class="kpi-l">Playwright</div><div class="kpi-v" style="font-size:16px">{{PW_STATUS}}</div></div>
  </section>

  <section>
    <h2>Findings</h2>
    {{FINDINGS_HTML}}
  </section>

  <section>
    <h2>Screenshots</h2>
    <div class="steps">{{SCREENSHOTS_HTML}}</div>
  </section>

  <footer>
    <div>Spec: <code>{{SPEC_PATH}}</code></div>
    <div>Memory: <code>.swarm-test/memory/</code></div>
  </footer>
</div>

<div class="lightbox" id="lb" onclick="this.classList.remove('on')"><img id="lbi" src=""></div>
<script>
document.querySelectorAll('.step img').forEach(img=>{
  img.parentElement.addEventListener('click',()=>{document.getElementById('lbi').src=img.src;document.getElementById('lb').classList.add('on')})
});
</script>
</body>
</html>
```

Substitutions:

- `{{FEATURE_TITLE}}` — one-line description of what was tested
- `{{TIMESTAMP}}` — human date (`2026-05-14 20:00`)
- `{{RUN_TS}}` — the ISO timestamp of the run dir
- `{{TARGET_URL}}`
- `{{OK_COUNT}}`, `{{WARN_COUNT}}`, `{{BAD_COUNT}}` — counts of findings by severity
- `{{PW_STATUS}}` — e.g. `2/3 passed`
- `{{SPEC_PATH}}` — relative path to the spec file
- `{{FINDINGS_HTML}}` — concatenated `<div class="finding ok|warn|bad">…</div>` blocks, one per finding. Template per finding:
  ```html
  <div class="finding <ok|warn|bad>">
    <div class="f-head"><span class="badge <ok|warn|bad>"><label></span></div>
    <div><strong>step-label</strong> — factual constat (quote visible text if relevant)</div>
    <div style="color:var(--dim);font-size:12px;margin-top:4px">Suggestion: …</div>
  </div>
  ```
- `{{SCREENSHOTS_HTML}}` — concatenated `<div class="step">…</div>` blocks, one per screenshot, in order. Template per step (image path is RELATIVE to the report file — both live in the same run dir, so just use the filename):
  ```html
  <div class="step">
    <img src="01-navigate.png" alt="01-navigate">
    <div class="step-meta">
      <div class="step-label"><span class="step-status <ok|warn|bad>"></span>01-navigate</div>
      <div class="step-note">optional one-line observation</div>
    </div>
  </div>
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

Many apps gate the feature you just shipped behind auth (OIDC, magic links, OAuth, Authentik, NextAuth…). Going through a real OIDC flow from a Playwright spec is fragile. Strategies in order of preference:

### Strategy A — reuse a pre-authenticated browser session (best)

Ask the user to open the app in Chrome, sign in once with their real account, then export storage state:

1. Tell the user to run this one-time command to capture their session (point them to the right URL):
   ```bash
   npx playwright open --save-storage=.swarm-test/auth/storage.json http://localhost:3000
   ```
   They sign in in the launched browser, then close it. The cookies/localStorage are saved.
2. In your spec, load that state:
   ```ts
   test.use({ storageState: '.swarm-test/auth/storage.json' });
   ```

The `.swarm-test/auth/` directory MUST be in `.gitignore`. The skill auto-adds it on first use:
```bash
grep -q '^\.swarm-test/auth/' .gitignore || echo '.swarm-test/auth/' >> .gitignore
```

If the saved state is older than a few hours (sessions expire), ask the user to refresh it.

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
