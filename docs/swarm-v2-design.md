# swarm-test v2 — parallel journey swarm (design)

Status: approved 2026-06-29. Supersedes the single-spec flow in the original `SKILL.md`.

## Problem

The original skill runs **one** linear, happy-path Playwright spec. In real use it:

- tested too shallowly — one journey, often missing the case that mattered;
- never went *inside* modals / sub-flows (screenshotted the trigger, moved on);
- only ever covered the happy case, not edges / errors / empty states;
- left the report blind to issues the green Playwright run hid;
- never lived up to its name — there was no "swarm".

## Goal

Make swarm-test (a) plan **all** cases for a feature explicitly and show that plan
before running, (b) cover happy + edge + error + empty-state + modal-depth journeys,
and (c) run them as a real swarm of parallel subagents.

## Shape

```
RECAP what changed
  -> PLAN the case matrix        (main agent; full conversation context)
       -> SHOW + CONFIRM          (pause by default; "swarm auto" skips)
            -> FAN OUT             (1 parallel subagent per journey)
                 -> MERGE          (one unified report, deduped findings)
                      -> LEARN
```

## Phases

### Plan the case matrix (new, first-class)

The main agent enumerates **every** test case for the feature, grouped/labelled by
type (`happy | edge | error | empty-state | modal-deep | permission`). Each row:
id/slug, title, type, auth precondition, and the explicit depth requirement (what
must be interacted with *inside* a modal/sub-flow). Printed as a matrix and
**confirmed before fan-out**. Default 3–6 journeys; bigger features are capped but the
planner states what it dropped (no silent truncation). "Go deeper" expands.

**Modal depth is a first-class rule:** any journey that opens a modal/dropdown/expander
must act inside it, not just capture the trigger.

### Fan out the swarm (new)

One subagent per journey, dispatched in parallel. Subagents start fresh, so each gets a
**self-contained brief** (see `templates/journey-brief.md`): target URL + route, ordered
steps with depth requirements, auth strategy + `storageState` path, its own output
subdir, the visual-analysis checklist, where business rules live (`CLAUDE.md`), the
known-false-positives file, and a structured JSON return contract.

Each agent: writes its spec -> runs it -> reads its own screenshots -> does its own
visual analysis -> returns structured findings. Failures are isolated; one agent dying
never aborts the swarm. All agents share the one dev server; each writes to
`.swarm-test/runs/<ts>/<NN-slug>/` so screenshots never collide.

### Merge & report (changed)

Main agent collects all structured results, dedups findings recurring across journeys
("seen in N journeys"), and builds **one** `report.html` grouped into journey sections —
each a timeline of its steps (reusing the existing per-step block). KPIs aggregate across
journeys; a top matrix shows journeys x status. Terminal summary mirrors the matrix.

## Return contract (per journey subagent)

```json
{
  "journey": "01-subscribe-happy",
  "title": "Subscribe happy path",
  "type": "happy",
  "playwright": { "passed": 5, "total": 5 },
  "steps": [
    { "n": "01", "label": "navigate-pricing", "action": "...",
      "expected": "...", "observed": "...", "shot": "01-navigate-pricing.png",
      "findings": [
        { "severity": "warn", "label": "missing-info",
          "note": "quote visible text", "fix": "concrete suggestion" }
      ] }
  ],
  "general_findings": []
}
```

## File / template changes

- `SKILL.md` — rewrite the workflow into the phased swarm; elevate modal-depth; keep
  dispatch wording tool-agnostic for cross-platform portability.
- `templates/journey-brief.md` — new; the self-contained per-agent brief.
- `report.html` template (in `SKILL.md`) — add a journey-grouping layer + per-journey
  status header; aggregate KPIs.
- `templates/spec-template.ts` — note it is now per-journey.

## Preserved

Feature-scoped (never crawls the app), dev-server-is-the-user's-job, auth strategies
A/B/C, the memory/learning loop, gitignore handling, the offline `file://` report.
