---
name: swarm-test
description: Use when the user asks to test, validate or smoke-check a web feature they just implemented ("run the swarm", "test this feature", "check it in the browser", "/swarm-test", a cahier de recette), or wants a before/after video of a change or fix. Plans all cases, then fans out parallel subagents running Playwright specs with screenshot review, merged into one report. Needs a web frontend.
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

If you cannot recall a concrete user-visible change from this conversation and no cahier de recette was given (see Recette mode), STOP and ask the user what to test. Don't crawl the app at random.

## Recette mode — test against a cahier de recette

Triggered when the user hands you a test plan instead of a fresh change: "swarm-test this recette", "run the swarm on this fiche", a pasted/attached cahier de recette, or a path to one. One-shot acceptance of a whole module, not a regression suite — nothing is kept for later.

In this mode the conversation-change rule above does not apply: the **cahier is the scope**. Phases 1, 3, 5 and 6-7 change as follows; everything else is unchanged.

**The cahier is the only oracle.** Read the code freely for the *how* — routes, selectors, test accounts, seed data, feature flags. Never for the *what*: an expected result comes from the cahier alone. If the code disagrees with the cahier, that is a finding (✗), not a reason to adjust the expectation. A tester who derives expectations from the implementation will only ever confirm that the code does what the code does.

- **Phase 1 (recap):** list the cahier's cases as you parsed them — ID, action, expected result. Flag any case whose expected result is not observable on screen ("check it works", "data is saved") as `non testable` and ask the user to make it concrete before running. Do not invent the expectation.
- **Phase 3 (plan):** the cahier IS the case matrix — do not invent extra journeys. One journey per cahier section (or per group of cases sharing a precondition); its steps are the cahier lines, in order, labelled with their case IDs (`RC-03-create-project`). The 3-6 journey and 3-8 step caps do not apply; split a journey past ~15 steps. Mutating-journey rules still hold.
- **Phase 5 (briefs):** copy each case's expected result **verbatim** from the cahier into the brief, and tell the agent to assert it explicitly (`expect(...)`), not rely on the screenshot alone. The agent reports `expected` as the cahier wording.
- **Phases 6-7 (merge + report):** every cahier case gets a verdict — **OK**, **KO** (quote expected vs observed), **non testable** (why) or **non exécuté** — shown in the terminal matrix and in each step block. The report uses the `recette` mode (phase 7). UX findings outside the cahier go under General findings, clearly separated from the verdicts: the cahier decides pass/fail, not your taste.

## Workflow

Follow these phases in order. Skip none. The structure exists to keep you honest.

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

  > Your dev server is not responding on http://localhost:3000. Run `pnpm run dev` from `/Users/.../your-app` in another terminal, wait for it to be ready, then say "go".

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

Vidéo avant/après : oui — avant = <ref> sur :<port> (réponds « sans vidéo » pour la retirer)

4 journeys → 4 parallel agents. Reply "go" to swarm, "swarm auto" to skip this confirm next time, or edit the list.
```

Rules for the plan:
- **Default 3-6 journeys.** Pick the highest-value ones. Quality of coverage over raw count.
- **No silent truncation.** If the feature is big enough to warrant more, cap it but say explicitly what you left out (e.g. _"Skipped i18n + mobile-viewport variants — say 'go deeper' to add them."_).
- **Modal depth is mandatory**, not optional — if a journey touches a modal/sub-flow, its depth requirement must describe the interaction inside it.
- **Flag mutating journeys.** Mark any journey that changes shared backend state (subscribe, cancel, delete, edit a setting); these need distinct data or serialization so parallel agents don't corrupt each other — see the shared-state note in phase 5.
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

e.g. `.swarm-test/runs/2026-06-29T17-40-00/`. Record the exact code the swarm tests — a fix after the swarm films against it (see **Fix after the swarm**). This snapshots the working tree, uncommitted and untracked files included (`.gitignore` respected), as a commit, without touching the working tree, the index or any branch:

```bash
T=$(mktemp); cp "$(git rev-parse --git-path index)" "$T"; GIT_INDEX_FILE="$T" git add -A
git commit-tree "$(GIT_INDEX_FILE="$T" git write-tree)" -p HEAD -m swarm-tested > .swarm-test/runs/<ts>/tested-ref; rm "$T"
```

 Each journey gets its own subdir so parallel agents never collide on screenshot filenames. If the feature is behind auth, resolve the auth strategy now (see **Handling authentication**) so every agent can share the same `storageState`.

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

**Shared backend state (important).** Parallel agents hit the SAME dev server and DB. Read-only journeys are safe to run together. Journeys that **mutate shared state** (subscribe, cancel, delete, change a setting) can corrupt each other's preconditions — e.g. a "subscribe" journey and an "already-subscribed" journey racing on the same account. At plan time, flag mutating journeys and pick one:
- **Distinct data per journey** — give each its own account / record / test user (best; keeps full parallelism). Note it in the brief.
- **Serialize the mutators** — run read-only and independent journeys in parallel, but run mutating journeys that share a resource one after another.
- If neither is possible, say so in the plan and let the user decide.

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

Copy `templates/report.html` (in this skill dir) to `.swarm-test/runs/<ts>/report.html` and fill every `{{…}}` placeholder. Don't restyle it — the CSS, the Horizon Factory branding, dark mode, the lightbox and the collapse behaviour are all in the template. The report is written in **French**, and it can go to a client: no internal jargon in the visible text.

This run report is the per-journey log. When several runs together answer a list of points (a client's remarks, a weekly's action items), add a summary page on top that links to each run's `report.html` and reuses its screenshots as evidence.

**Pick the mode first.** Recette mode (a cahier was given) and feature mode share the layout; only the vocabulary changes.

| | `recette` | `feature` |
|---|---|---|
| `{{SKILL}}` | `swarm-test · recette` | `swarm-test` |
| `{{TABLE_TITLE}}` | `Tous les cas` | `Parcours testés` |
| `{{TABLE_HEAD}}` | `<th>Cas</th><th>Intitulé</th><th>Parcours</th><th>Verdict</th>` | `<th>#</th><th>Parcours</th><th>Type</th><th>Verdict</th>` |
| Table rows | one per cahier case, in cahier order | one per journey, in plan order |
| Pill `ok` | `OK` | `OK` |
| Pill `warn` | `OK · remarque` | `Friction` |
| Pill `ko` | `KO` | `Cassé` |
| Pill `nt` | `Non testable` | — |
| Pill `nx` | `Non exécuté` | `Non exécuté` |
| What makes it `ko` | the cahier only | a `bad` finding |

A step's class is its verdict; in feature mode map the agent's severity `bad → ko`, `warn → warn`, `ok → ok`. A journey's pill is its worst step: `ko` > `nx` > `warn` > `ok`.

**Verdict block** — `{{VERDICT_CLASS}}` is `ko`, `warn` or `ok`:

| Worst result | Recette headline | Feature headline | Class |
|---|---|---|---|
| any `ko` | `Recette non validée` | `Feature bloquante` | `ko` |
| any `nx` or `nt` | `Recette incomplète` | `Tests incomplets` | `warn` |
| any `warn` | `Recette validée avec remarques` | `Feature OK avec frictions` | `warn` |
| all `ok` | `Recette validée` | `Feature OK` | `ok` |

`{{VERDICT_SUMMARY}}` is one line of counts, KO first and bold, zero counts dropped — recette: `<b>1 KO</b> · 5/8 cas OK · 3 remarques · 1 non testable · 1 non exécuté`; feature: `<b>1 cassé</b> · 2 frictions · 4 parcours · 12/13 étapes Playwright`.

**Other placeholders:**
- `{{TITLE}}` — `Recette <module>` or `Feature — <what changed>`.
- `{{META}}` — `27 septembre 2026, 14:32 · http://localhost:3000 · run 2026-09-27T14-32-00`.
- `{{TABLE_ROWS}}` — the link target is the step's `id` (recette: the case ID; feature: the journey's first step), so a click opens it:
  ```html
  <tr><td class="mono">RC-04</td><td><a href="#RC-04">Bulle de son propre pal</a></td><td class="dim">Île et interactions</td><td><span class="pill ko">KO</span></td></tr>
  ```
- `{{JOURNEYS_HTML}}` — one section per journey. OK steps are collapsed (no `open`); every other step is `open`:
  ```html
  <section class="journey">
    <header class="j-head"><h3><span class="dim">01</span> Île et interactions</h3><span class="pill ko">KO</span></header>
    <p class="j-meta">Playwright 5/6 · <code>01-ile/</code></p>
    <details class="step ko" id="RC-04" open>
      <summary><span class="dot"></span><span class="mono sid">RC-04</span><span class="st">Bulle de son propre pal</span><span class="pill ko">KO</span></summary>
      <div class="body"><div class="txt">
        <p class="action"><span class="k">Action</span>Clique sur l'étiquette de « Pixel ».</p>
        <div class="cmp">
          <div class="box exp"><span class="k">Attendu</span>Un bouton « Caresser » et un bouton « Ma chambre ».</div>
          <div class="box obs"><span class="k">Observé</span>Seul « Ma chambre » est présent.</div>
        </div>
        <div class="finding ko"><div class="f-head"><span class="f-lbl">Règle métier</span><span class="seen">vu dans 2 parcours</span></div>
          <p>Observation factuelle, texte visible cité.</p><p class="fix">→ Correction concrète.</p></div>
      </div>
      <button class="thumb" data-src="01-ile/03-bulle.png" aria-label="Agrandir la capture RC-04"><img src="01-ile/03-bulle.png" alt="Capture RC-04"></button>
      </div>
    </details>
  </section>
  ```
  - Step ids: recette uses the case ID (`RC-04`); feature uses `<journey>-<step>` (`01-03`). Ids must be unique.
  - Screenshot paths are relative to the report: `<journey-subdir>/<file>.png`. No screenshot → `<div class="thumb none">Pas de capture</div>` in place of the button, and say why in *Observé*.
  - Always fill *Action / Attendu / Observé*, even on a clean step — that is what makes the run verifiable. In recette mode *Attendu* is the cahier's wording, verbatim.
  - Finding labels in French: `Règle métier`, `UX`, `Libellé`, `Impasse`, `Message d'erreur`, `Info manquante`. `vu dans N parcours` only on deduped findings (N > 1). Finding class: `ko`, `warn`, `ok` (informational) or `nt`.
- `{{EXTRA_SECTIONS}}` — optional blocks after the journeys, empty string if none:
  - recette, cases flagged non testable: `<h2 class="sec">Non testable</h2>` then per case `<div class="finding nt" id="RC-03"><div class="f-head"><span class="mono">RC-03</span> <b>Intitulé</b></div><p>Pourquoi.</p><p class="fix">→ Attendu à préciser.</p></div>` — and list those cases in the table too.
  - cross-cutting findings: `<h2 class="sec">Remarques générales</h2>` then `.finding` blocks.
- `{{FOOTER}}` — `Specs : <code>.swarm-test/runs/<ts>/&lt;parcours&gt;/journey.spec.ts</code> · Mémoire : <code>.swarm-test/memory/</code>`.

Before opening it, check nothing is left unfilled: `grep -o '{{[A-Z_]*}}' <report>` must print nothing.

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

**Then propose the fix yourself — never end a swarm with findings and no offer.** If any finding is ✗ broken or ⚠ friction, close the summary with a numbered fix proposal, worst first, one line each (what you would change, where), and the video line:

```
Je propose de corriger :
 1. ✗ 03 — message d'erreur de carte refusée non actionnable → copie + bouton « Réessayer » (CheckoutForm.tsx)
 2. ⚠ 02 — « Gérer » mène à une page vide → lien vers /billing (PlanCard.tsx)
Vidéo avant/après du fix : oui
Réponds « go fix » (tout), « fix 1 », ou « sans vidéo ».
```

Wait for the answer — a fix changes code, the user picks what ships. Leave out what is not yours to fix (a backend you don't own, a finding the user already dismissed) and say why in one line. Recette mode: propose only for KO cases and remarks; never "fix" the cahier. All ✓ ok → no proposal.

### 8. Learn from the user's reaction

After you report, the user may confirm or dismiss findings:
- **Confirms** ("yes that's wrong, fix it") → append a one-liner to `.swarm-test/memory/learned-rules.md` describing the pattern, so future runs are more sensitive to it.
- **Dismisses** ("nah that's intentional") → append to `.swarm-test/memory/known-false-positives.md` describing the pattern, so future runs (and the agents' analysis) skip it.

One line each, date prefix. Don't accumulate noise.

### 9. Fix after the swarm — with its before/after video

When the user accepts the fix proposal (phase 7) or asks to fix findings ("go fix", "fix 1", "corrige"), the fix gets its own before/after video, **proposed by default** like the swarm's: announce it with the fix (`Vidéo avant/après du fix : oui — réponds « sans vidéo » pour la retirer`) and make it unless the user declines.

- **Before** = the code the swarm tested, `.swarm-test/runs/<ts>/tested-ref` (phase 4). **After** = the dev server with the fix.
- Before server: reuse the swarm's before worktree — `git -C ../<repo>-before checkout --detach $(cat .swarm-test/runs/<ts>/tested-ref)`; its dev server hot-reloads. No worktree yet → give the user the commands from **Before/after video** with that ref.
- One script per fixed finding, `.swarm-test/runs/<ts>/fix-<NN>/video.mjs`, following the same **Script** rules (its `title` names the finding and the fix): it replays the finding's repro, and its last step asserts the expected behaviour quoted in the report (it fails before the fix, passes after). Check on after alone, then film with both sides.
- Re-run the failing journey's spec too: the video shows the fix, the spec proves nothing else broke.
- In the reply, list each finding with its video path (`fix-<NN>/video/video.mp4`) and the before/after console lines (`before: FAILED — <step>` / `after: ok`). A finding whose after side still fails is **not fixed** — say so.

## Before/after video (proposed by default)

Each journey that shows the change can be filmed **side by side**: the app before the change (left, grey header) and after it (right, green header), the same script replayed on both, a red/green banner on the step that fails or passes. The harness is in `video/` in this skill.

**On by default — always propose it.** Every phase-3 plan carries the line `Vidéo avant/après : oui — avant = <ref> sur :<port> (réponds « sans vidéo » pour la retirer)`, and so does every fix after a swarm (phase 9). Drop it only when the user says so ("sans vidéo"), or when no journey changes what the screen shows (nothing to compare). Recette mode tests a module, not a change: propose it there only when the cahier covers a change with a known base ref. With "swarm auto", keep it on but never wait for the before server: if it is not up when the swarm starts, film the after side alone and say so.

**The "before" server (phase 2).** The before side is the same app at the base ref — the commit before the change (`HEAD` if the change is still uncommitted, else `git merge-base HEAD origin/<base>`). As with the dev server, **do not start it yourself**; give the user the commands:

```bash
git worktree add ../<repo>-before <base-ref>
cd ../<repo>-before && <pm> install && cp <path-to-app>/.env <app>/.env   # same env, same DB
PORT=3100 <pm> run dev                                                # note the port
```

**Point the copied `.env` at its own port.** A URL baked into the env (`AUTH_URL`, `NEXTAUTH_URL`, `APP_URL`, `NEXT_PUBLIC_*_URL`) still names the main server's port: login and redirects then bounce the before side onto the after server, and both halves of the video show the same code. Set them to the before port, and check `page.url()` on the before side once. Watch the DB too: a copied `.env` may point at a shared dev database (an SSH tunnel), not a local one — then every journey and video script stays read-only.

**Docker stacks are torn down after the run.** When a side runs as a Docker Compose stack (a repo's `qa/compose.yml`, before and after as two projects), name each project after the run (`-p <repo>-<ts>-before`), list both in the reply, and remove them with `docker compose -p <project> down -v` once the report is delivered and no fix is pending — or tell the user the exact commands if you cannot run them. Stacks left up pile across sessions and fill the Docker disk; each can also reserve far more than it stores (an S3 stand-in preallocating its volumes).

No before server (the user declines, or the base ref cannot run) → film the after side alone; the video still shows the change working. Both sides share the DB: a script that creates data must not collide with itself (unique names, e.g. `Date.now()` in the label).

**Script (phase 5).** Add the brief's *Video script* section to every journey whose last step shows the change. The agent writes `<subdir>/video.mjs`:

```js
export const title = "Dans Juliette, la fenêtre « Nouveautés » s’affichait en sombre. Elle est maintenant claire et lisible.";
export const start = "/path";   // first page, opened already logged in
export default async ({ page, step, expect }) => {
  await step("Short label of the action", async () => { /* … */ });
  await step("Short label of the expected behaviour", async () => { await expect(/* locator */).toBeVisible(); });
};
```

- `title` is mandatory: one or two sentences, in the language of the app's UI, saying where the problem was and what changed (`<where>, <what was wrong>. <what it does now>.`). It opens the video on a 3-second card with the side legend: without it a viewer does not know what to look at.
- At most 8 steps. Labels are short, in the language of the app's UI: they become the subtitles.
- `getByRole` / `getByLabel` / `getByText` only. Never `waitForTimeout`. No login inside the steps.
- The last step asserts the new behaviour — it is meant to fail on the before side.
- One visible gesture per step: click a control before changing it; open a list in its own step, then choose in the next one (native `<select>`: `click()` it, then `selectOption` — the harness draws the list, the OS one is never filmed); click a field before `fill`. The step that fails on the before side leaves the problem on screen.
- Each action fails after 5 s: never wait on purpose.
- Stable paths only in `start` and URLs (no generated ids): reach the page by clicking, as a user would.
- The agent checks it on the after side alone, from the dir where Playwright is installed, and keeps it only if it prints `after: ok`:
  ```bash
  node ~/.claude/skills/swarm-test/video/record.mjs <subdir>/video.mjs <subdir>/video-check --storage=.swarm-test/auth/storage.json after=<url>
  ```

**Film (after phase 6).** For every journey with a checked `video.mjs`, run — one at a time, each launches two browsers:

```bash
node ~/.claude/skills/swarm-test/video/record.mjs <subdir>/video.mjs <subdir>/video \
  --storage=.swarm-test/auth/storage.json before=<before-url> after=<after-url>
# one-sided: after=<url> --video
```

It prints `before: FAILED — <step>` / `after: ok`, then `video: <subdir>/video/video.mp4`: a 3-second title card, then both sides at full size (1280×800 each). No mp4 when the after side failed a step (nothing to show) — report that, don't retry blindly. Each side's raw `video.webm` and `last.png` stay in `<subdir>/video/<side>/`.

- **ffmpeg** is required. Homebrew's default `ffmpeg` has no `drawtext`, so the video comes out without labels or subtitles (colours only) and the harness says so; `brew install ffmpeg-full` (keg-only, found automatically) adds them. `FFMPEG=<bin>` forces one.
- **Auth:** `--storage` loads the saved session on both sides. Cookies on `localhost` ignore the port, so a cookie session works on both servers; a session kept in `localStorage` is per port and will not — then export `login({ page, email, password })` from the script and pass `QA_LOGIN=email:password` in the env instead of `--storage` (never echo it).

**Report.** Put the video at the top of its journey section, before the first step:
`<video class="clip" controls muted playsinline src="01-slug/video/video.mp4"></video>`

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
- ❌ Leave a run's Docker stacks up once its report and fixes are done. `down -v` them.

## Conventions

- One run = one feature. If the user shipped two unrelated things, do two runs.
- All artifacts under `.swarm-test/runs/<ISO-timestamp>/`, with a subdir per journey. Gitignored.
- Memory files (`.swarm-test/memory/*.md`) ARE committed — accumulated test knowledge.
- No required config file. Reads `package.json`, `CLAUDE.md`, lockfiles, and the conversation.
- Default 3-6 journeys. "go deeper" expands; "swarm auto" skips the plan-confirm pause; the before/after video is on unless the user says "sans vidéo".
