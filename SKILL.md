---
name: swarm-test
description: Use when the user asks you to test, validate, verify, or smoke-check a feature they just implemented in this conversation. Triggers on phrases like "run the swarm", "run the swarm test", "test what we just did", "test this feature", "validate this", "smoke test this", "check if it works in the browser", "swarm-test", "/swarm-test". Plans ALL cases for the feature (happy + edge + error + empty-state + modal-depth), shows that plan, then fans out a swarm of parallel subagents — each writes and runs its own focused Playwright spec, captures screenshots, visually analyzes them for UX and business issues, and reports back. Findings are merged into one report. Skip if the project has no web frontend or no dev server.
---

# swarm-test: plan every case, then swarm it

You just helped the user implement (or modify) a feature. Now you validate it end-to-end in a real browser — not with one happy-path click-through, but by planning **every case that matters** and running them as a swarm of parallel agents.

## Mental model

You are NOT running a generic test suite, and you are NOT writing one shallow happy-path spec. You are:

1. **Planning all the cases** for the specific thing you just changed in this conversation — happy path, edges, errors, empty states, and the modal/sub-flow depth each one needs.
2. **Showing that plan** to the user before spending tokens.
3. **Swarming** — one parallel subagent per journey, each owning its journey end-to-end (spec → run → screenshots → visual analysis).
4. **Merging** every agent's findings into one report.

The planning happens in the main conversation because **you** have the context — the file edits, diffs, and intent from earlier turns. The subagents start fresh, so everything they need goes into their brief.

If you cannot recall a concrete user-visible change from this conversation, STOP and ask the user what to test. Don't crawl the app at random.

## Workflow

Follow these phases in order. Skip none. The structure exists to keep you honest.

### 0. Version check (best-effort, non-blocking)

Run this once, ignore any error, never let it block the run:

```bash
D=~/.claude/skills/swarm-test; [ -d "$D/.git" ] && git -C "$D" fetch --quiet origin main 2>/dev/null && \
  LOCAL=$(git -C "$D" rev-parse HEAD) && REMOTE=$(git -C "$D" rev-parse origin/main) && \
  [ "$LOCAL" != "$REMOTE" ] && echo "OUTDATED" || echo "OK"
```

If it prints `OUTDATED`, mention in one line: _"A newer swarm-test exists — run `~/.claude/skills/swarm-test/install.sh --update` when convenient."_ Then continue. If the path doesn't exist (skill vendored elsewhere), skip silently.

### 1. Recap what you changed (output to user)

In 3-5 lines, tell the user:

- Files touched in this conversation
- Routes / pages / components affected
- The user journey(s) that should now work (or work differently)
- Any auth / preconditions required to exercise it

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
- **DOWN** → **do NOT spawn the server yourself.** Tell the user the exact command, derived from the detected package manager (lockfile in the same dir or above: `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lockb` → `bun`, `package-lock.json` → `npm`; or `packageManager` in package.json):

  > Your dev server is not responding on http://localhost:3000. Run `pnpm run dev` from `/Users/.../apps/uca` in another terminal, wait for it to be ready, then say "go".

  Wait for explicit confirmation. Server lifecycle is the user's concern.

Also confirm Playwright is available — if `npx playwright test --version` fails, tell the user:
> Playwright is not installed. Run `pnpm add -D @playwright/test && npx playwright install chromium` then say "go".

### 3. Plan the case matrix (the heart of the swarm) — then CONFIRM

This is where swarm-test earns its name. Using everything you know from this conversation, enumerate **every case that matters for the feature** — not just the happy path. Think across these journey types:

- **happy** — the primary path works end to end.
- **edge** — boundary / variant states (already-subscribed user, max length, second visit, different role).
- **error** — the path fails the way it should (declined card, validation error, network failure) and the UI recovers.
- **empty-state** — no data / nothing configured yet; no dead ends.
- **modal-deep** — a modal, dropdown, drawer, or expander opens; you go **inside** it and interact, not just screenshot the trigger.
- **permission** — an unauthorized/unauthenticated user is handled correctly.

For each journey produce a row with: a numbered slug (`01-subscribe-happy`), title, type, auth precondition, and the **explicit depth requirement** (what must be interacted with inside any modal/sub-flow). Present it as a matrix:

```
swarm-test plan — <feature, 1 line>   ·   target http://localhost:<port>

 #   Journey                  Type         Auth   Goes deep into
 01  Subscribe happy path     happy        yes    opens modal AND fills card, asserts confirmation
 02  Already-subscribed user  edge         yes    modal shows "Manage", not "Subscribe"
 03  Declined card            error        yes    inline error copy is actionable, retry works
 04  Empty pricing (no plans) empty-state  no     empty state renders, no dead end

4 journeys → 4 parallel agents. Reply "go" to swarm, "swarm auto" to skip this confirm next time, or edit the list.
```

Rules for the plan:
- **Default 3-6 journeys.** Pick the highest-value ones. Quality of coverage over raw count.
- **No silent truncation.** If the feature is big enough to warrant more, cap it but say explicitly what you left out (e.g. _"Skipped i18n + mobile-viewport variants — say 'go deeper' to add them."_).
- **Modal depth is mandatory**, not optional — if a journey touches a modal/sub-flow, its depth requirement must describe the interaction inside it.
- **Stay feature-scoped.** Every journey exercises the thing you just changed. Never pad with unrelated routes.

**Pause and wait for the user** unless they have already said "swarm auto" (or equivalent) — then show the plan and proceed without waiting. If the user trims, adds, or reorders, honor it. This pause is the "plan all cases before going" guarantee; do not skip it on the first run of a session.

### 4. Prepare the run directory

Create one run dir, with a subdir per journey:

```
.swarm-test/runs/<ISO-timestamp>/            ← report.html lands here
.swarm-test/runs/<ISO-timestamp>/01-subscribe-happy/    ← agent 1: spec + screenshots
.swarm-test/runs/<ISO-timestamp>/02-already-subscribed/ ← agent 2
...
```

e.g. `.swarm-test/runs/2026-06-29T17-40-00/`. Each journey gets its own subdir so parallel agents never collide on screenshot filenames. If the feature is behind auth, resolve the auth strategy now (see **Handling authentication**) so every agent can share the same `storageState`.

### 5. Fan out the swarm

Dispatch **one subagent per journey, in parallel** (one message, multiple agent calls — use the Task tool / your platform's parallel-subagent mechanism). Each subagent runs the SAME end-to-end loop on its own journey, isolated from the others.

Because subagents have **none** of this conversation's context, give each a **self-contained brief**. Fill `templates/journey-brief.md` (in this skill dir) — it carries: target URL + exact route, the ordered steps with depth requirements, auth strategy + `storageState` path, the agent's own output subdir, the visual-analysis checklist, where business rules live (project `CLAUDE.md`), the known-false-positives file, and the structured return contract.

Each subagent MUST:

1. **Write its spec** to `<subdir>/journey.spec.ts`. Use `templates/spec-template.ts` as structure. Rules:
   - Target only its journey's route(s). One journey, deeply — never crawl.
   - `test.step('NN-label', …)` per meaningful action; the label is the screenshot filename (`01-`, `02-`, …).
   - Screenshot at the END of every step: `await page.screenshot({ path: '<subdir>/NN-label.png', fullPage: false });`
   - Stable selectors only (`getByRole`, `getByLabel`, `getByText`, `getByTestId`). Never `nth-child`/CSS positional.
   - Wait for `networkidle` or a specific element. Never `page.waitForTimeout(<arbitrary>)`.
   - **Modal depth:** if the journey opens a modal/dropdown/drawer, the spec must interact INSIDE it (fill fields, click the inner CTA, assert inner state) — not screenshot the trigger and stop.
   - 3-8 steps. More than ~10 means the journey is too broad — it should have been split at plan time.
2. **Run it:** `npx playwright test <subdir>/journey.spec.ts --reporter=line`. Capture exit code + stdout. If a step fails, retry ONCE with a corrected selector or wait; never edit application source; if it still fails, capture the failure and analyze whatever screenshots exist.
3. **Visually analyze** its own screenshots — Read each `.png` (the Read tool returns images). For each, ask:
   1. **Wording vs action** — does copy match what a click does?
   2. **Step ordering** — logical, or arbitrary?
   3. **Business rules** — do the rules in project `CLAUDE.md` still hold here?
   4. **Dead ends** — can the user go back, retry, or get help?
   5. **Error messages** — actionable, or "Something went wrong"?
   6. **Missing info** — enough to decide (prices, terms, consequences)?
   7. **Inconsistencies** — does this contradict the previous step?

   Quote visible text. Don't invent undocumented rules. Drop any finding matching `.swarm-test/memory/known-false-positives.md`.
4. **Return structured findings** (its final message IS the data, not prose) per the return contract below.

**Return contract** — each agent returns exactly this shape:

```json
{
  "journey": "01-subscribe-happy",
  "title": "Subscribe happy path",
  "type": "happy",
  "playwright": { "passed": 5, "total": 5 },
  "steps": [
    { "n": "01", "label": "navigate-pricing", "action": "what you did",
      "expected": "what should happen", "observed": "what the shot shows",
      "shot": "01-navigate-pricing.png",
      "findings": [
        { "severity": "warn", "label": "missing-info",
          "note": "quote the visible text", "fix": "concrete suggestion" }
      ] }
  ],
  "general_findings": []
}
```

`severity` ∈ `ok | warn | bad`. `label` ∈ `wording | ux | business | dead-end | error | missing-info`.

**Isolation:** agents are independent. If one agent's journey fails to run, the others continue — collect whatever each returns. A dead agent never aborts the swarm.

### 6. Merge

Collect every agent's structured result. Then:

- **Dedup across journeys.** If the same finding appears in multiple journeys, keep one and annotate it (_"seen in 3 journeys"_). Cross-cutting findings (a business-rule violation visible everywhere) go to general findings.
- **Aggregate counts** across all journeys for the KPIs.
- **Print a terminal matrix** — one row per journey:

```
swarm-test — <feature, 1 line>

 #   Journey                  Playwright   Visual
 01  Subscribe happy path     5/5          ✓ ok
 02  Already-subscribed user  3/3          ⚠ 1 friction
 03  Declined card            4/4          ✗ 1 broken — error copy not actionable
 04  Empty pricing            2/2          ✓ ok

Findings: 1 broken · 1 friction · deduped 2 repeats
Report: .swarm-test/runs/<ts>/report.html
```

Severity scale: ✗ **broken** (user blocked / business rule violated) · ⚠ **friction** (works but degrades) · ✓ **ok**.

### 7. Generate the visual report

Write a self-contained `report.html` to `.swarm-test/runs/<ts>/report.html` — chronological, grouped **by journey**, so the user can verify exactly what each agent tested. No external CSS/JS, no CDNs; must work offline via `file://`.

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
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:28px}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px}
.kpi-l{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.kpi-v{font-size:22px;font-weight:600}.kpi.ok .kpi-v{color:var(--green)}.kpi.warn .kpi-v{color:var(--yellow)}.kpi.bad .kpi-v{color:var(--red)}
.journey{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin-bottom:18px}
.journey-head{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.journey-title{font-size:16px;font-weight:600}
.jtype{font-size:10px;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.04em;background:var(--panel2);color:var(--accent);border:1px solid var(--border)}
.jstatus{margin-left:auto;font-size:11px;padding:2px 10px;border-radius:10px;text-transform:uppercase;letter-spacing:.04em;background:var(--border);color:var(--dim)}
.jstatus.ok{background:var(--green);color:#000}.jstatus.warn{background:var(--orange);color:#fff}.jstatus.bad{background:var(--red);color:#fff}
.journey-sub{color:var(--dim);font-size:12px;margin-bottom:16px}
.timeline{position:relative;margin-left:6px;padding-left:24px;border-left:2px solid var(--border)}
.step{position:relative;margin-bottom:24px}
.step::before{content:'';position:absolute;left:-33px;top:2px;width:14px;height:14px;border-radius:50%;border:3px solid var(--panel);background:var(--dim)}
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
.finding{background:var(--panel2);border-left:3px solid var(--yellow);border-radius:4px;padding:10px 14px;margin-top:10px;font-size:13px}
.finding.bad{border-left-color:var(--red)}.finding.warn{border-left-color:var(--orange)}.finding.ok{border-left-color:var(--green)}
.finding .lbl{display:inline-block;font-size:10px;padding:1px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.04em;margin-right:8px;background:var(--border);color:var(--dim);vertical-align:middle}
.finding.bad .lbl{background:var(--red);color:#fff}.finding.warn .lbl{background:var(--orange);color:#fff}.finding.ok .lbl{background:var(--green);color:#000}
.finding .sugg{color:var(--dim);font-size:12px;margin-top:4px}
.finding .seen{color:var(--dim);font-size:11px;font-style:italic;margin-left:6px}
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
    <div class="kpi"><div class="kpi-l">Journeys</div><div class="kpi-v">{{JOURNEY_COUNT}}</div></div>
    <div class="kpi"><div class="kpi-l">Steps</div><div class="kpi-v">{{STEP_COUNT}}</div></div>
    <div class="kpi ok"><div class="kpi-l">OK</div><div class="kpi-v">{{OK_COUNT}}</div></div>
    <div class="kpi warn"><div class="kpi-l">Friction</div><div class="kpi-v">{{WARN_COUNT}}</div></div>
    <div class="kpi bad"><div class="kpi-l">Broken</div><div class="kpi-v">{{BAD_COUNT}}</div></div>
    <div class="kpi"><div class="kpi-l">Playwright</div><div class="kpi-v" style="font-size:15px">{{PW_STATUS}}</div></div>
  </div>

  {{JOURNEYS_HTML}}

  {{GENERAL_FINDINGS_BLOCK}}

  <footer>
    <div>Specs: <code>.swarm-test/runs/{{RUN_TS}}/&lt;journey&gt;/journey.spec.ts</code></div>
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
- `{{TIMESTAMP}}` — human date (`2026-06-29 17:40`)
- `{{RUN_TS}}` — the ISO timestamp of the run dir
- `{{TARGET_URL}}`
- `{{JOURNEY_COUNT}}` — number of journeys in the swarm
- `{{STEP_COUNT}}` — total steps across all journeys
- `{{OK_COUNT}}`, `{{WARN_COUNT}}`, `{{BAD_COUNT}}` — finding counts by severity (after dedup)
- `{{PW_STATUS}}` — aggregate, e.g. `14/15 passed`
- `{{JOURNEYS_HTML}}` — one `<section class="journey …">` per journey, in plan order. Per-journey template:

  ```html
  <section class="journey">
    <div class="journey-head">
      <span class="journey-title">01 · Subscribe happy path</span>
      <span class="jtype">happy</span>
      <span class="jstatus <ok|warn|bad>"><passed | 1 friction | 1 broken></span>
    </div>
    <div class="journey-sub">Playwright 5/5 · subdir <code>01-subscribe-happy/</code></div>
    <div class="timeline">
      <!-- one .step per step of THIS journey -->
      <div class="step <ok|warn|bad>">
        <div class="step-head">
          <span class="step-n">Step 01</span>
          <span class="step-title">Navigate to /pricing</span>
          <span class="tag <ok|warn|bad>"><passed | friction | broken></span>
        </div>
        <div class="step-action">
          <b>Action:</b> what the agent did.<br>
          <b>Expected:</b> what should happen. <b>Observed:</b> what the screenshot shows.
        </div>
        <img class="shot" src="01-subscribe-happy/01-navigate.png" alt="Step 01">
        <!-- if no screenshot: <div class="no-shot">No screenshot — step did not execute (blocked at step N)</div> -->
        <div class="finding <ok|warn|bad>">
          <span class="lbl"><wording|ux|business|dead-end|error|missing-info></span>
          Factual observation, quote visible text.
          <span class="seen">seen in 2 journeys</span>
          <div class="sugg">Suggestion: concrete fix.</div>
        </div>
      </div>
    </div>
  </section>
  ```

  Rules for `{{JOURNEYS_HTML}}`:
  - The image `src` is `<journey-subdir>/<filename>.png` — the report sits at the run root, screenshots live in each journey's subdir.
  - A journey's status = its worst step (`bad` > `warn` > `ok`); a step's severity = its worst finding.
  - Always include the **Action / Expected / Observed** line, even for clean steps — that's what makes the run verifiable.
  - A journey that failed to execute still gets its section, with `no-shot` and a one-line reason.
  - Add the `seen in N journeys` span only on deduped findings (N > 1).

- `{{GENERAL_FINDINGS_BLOCK}}` — cross-cutting findings not tied to one step. Empty string if none. Otherwise:
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

Tell the user the report path in the terminal summary.

### 8. Learn from the user's reaction

After you report, the user may confirm or dismiss findings:
- **Confirms** ("yes that's wrong, fix it") → append a one-liner to `.swarm-test/memory/learned-rules.md` describing the pattern, so future runs are more sensitive to it.
- **Dismisses** ("nah that's intentional") → append to `.swarm-test/memory/known-false-positives.md` describing the pattern, so future runs (and the agents' analysis) skip it.

One line each, date prefix. Don't accumulate noise.

## Handling authentication

Many apps gate the feature behind auth. Resolve this once in phase 4 so every parallel agent shares the same session. Strategies in order of preference:

### Strategy A — reuse a pre-authenticated browser session (best)

**Auth-agnostic.** `storageState` snapshots the browser's cookies + localStorage for the app's origin — where almost every scheme persists the session: server-side sessions (Rails/Django/Express-session), JWT-in-cookie, token-in-localStorage, OAuth/OIDC (Auth0, Keycloak, Authentik, Okta, Google…), NextAuth, SAML.

Ask the user to sign in once and export the state:

1. One-time command (point them to the right dev URL):
   ```bash
   npx playwright open --save-storage=.swarm-test/auth/storage.json <dev-url>
   ```
   They sign in however the app requires, then close it.
2. Every agent's spec loads that state:
   ```ts
   test.use({ storageState: '.swarm-test/auth/storage.json' });
   ```

`.swarm-test/auth/` MUST be gitignored. The skill auto-adds it:
```bash
grep -q '^\.swarm-test/auth/' .gitignore || echo '.swarm-test/auth/' >> .gitignore
```

**Caveats where Strategy A is NOT enough** — fall back to B:
- **Session in IndexedDB** (e.g. Firebase Auth). `storageState` captures cookies + localStorage only. Use a programmatic login fixture.
- **Short-lived tokens.** Stale fast; if older than a few hours, re-capture.
- **Session bound to IP / device fingerprint.** Backend may reject a replayed session.
- **Client TLS certificate auth.** Not covered by storageState.

### Strategy B — programmatic test credentials

Look for test credentials in:
1. Project root `CLAUDE.md` ("Test accounts" / "Test credentials")
2. `.swarm-test/memory/learned-rules.md`
3. `.env.test` or `.env.local`

If found, the brief passes them to each agent to hardcode the login flow (`getByLabel('Email').fill(...)`). Never log the password. If none documented, ASK the user. Don't invent credentials.

### Strategy C — bypass the auth wall

If the feature is reachable via a public route or feature flag, ask the user if a journey may hit it directly (e.g. `?test_mode=1`). Only if the user says it's safe.

### When all else fails

If auth can't be solved this run, the relevant journeys' agents stop at the login screen and screenshot it. Tell the user:
> The swarm reaches the login screen but can't go further without test credentials or a saved session. Choose strategy A or B and re-run.

Still useful: entry route renders, login UI captured, no long run wasted on a doomed flow.

## Anti-patterns — don't do these

- ❌ Fan out before showing the case plan. Plan all cases, show them, THEN swarm (unless "swarm auto").
- ❌ Write one happy-path spec and call it done. The point is breadth (cases) AND depth (inside modals).
- ❌ Screenshot a modal's trigger and move on. Go INSIDE the modal/sub-flow.
- ❌ Let one agent's failure abort the swarm. Agents are isolated; collect what each returns.
- ❌ Share a screenshot subdir between agents. One subdir per journey.
- ❌ Crawl the entire app to "be thorough". Every journey stays scoped to the change.
- ❌ Maintain a `flows/*.md` catalog. You plan from what was just coded, not a static catalog.
- ❌ Report Playwright-green as "passing" without the visual analysis. Green ≠ correct.
- ❌ Spawn the dev server yourself (`nohup … &`). Ask the user to run it.

## Conventions

- One run = one feature. If the user shipped two unrelated things, do two runs.
- All artifacts under `.swarm-test/runs/<ISO-timestamp>/`, with a subdir per journey. Gitignored.
- Memory files (`.swarm-test/memory/*.md`) ARE committed — accumulated test knowledge.
- No required config file. Reads `package.json`, `CLAUDE.md`, lockfiles, and the conversation.
- Default 3-6 journeys. "go deeper" expands; "swarm auto" skips the plan-confirm pause.
