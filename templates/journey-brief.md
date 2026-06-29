# Journey brief — swarm-test agent

The main agent fills this and hands ONE to each parallel subagent. The subagent has
**no** conversation context, so everything it needs is here. Delete the angle-bracket
hints when filling.

---

You are a swarm-test agent. Test exactly ONE user journey, end to end, in a real
browser, then return structured findings. Do not test anything outside this journey.
Do not edit application source code.

## Journey

- **Slug:** `<NN-slug>`   (e.g. `01-subscribe-happy`)
- **Title:** <one line>
- **Type:** <happy | edge | error | empty-state | modal-deep | permission>
- **Why it matters:** <the risk this journey covers>

## Target

- **Base URL:** http://localhost:<port>
- **Route(s):** <the exact path(s) this journey touches>
- **Output subdir (yours alone):** `.swarm-test/runs/<ts>/<NN-slug>/`
  - Write your spec to `<subdir>/journey.spec.ts`
  - Write screenshots to `<subdir>/NN-label.png`

## Steps to perform (ordered)

1. <action> — <what to assert / observe>
2. <action> …
<!-- 3-8 steps. If a step opens a modal/dropdown/drawer, you MUST interact INSIDE it
     (fill fields, click the inner CTA, assert inner state) — never screenshot the
     trigger and stop. -->

## Depth requirement

<Spell out the modal/sub-flow interaction this journey must exercise. e.g. "Open the
Subscribe modal, fill the Stripe test card 4242…, submit, assert the success state.">

## Auth

- **Strategy:** <A storageState | B credentials | C bypass | none>
- **storageState path:** `.swarm-test/auth/storage.json`  (load via `test.use({ storageState })`)
- **Credentials (if strategy B):** <where they came from; never log the password>

## Analysis checklist

After running, Read each screenshot and check: wording vs action · step ordering ·
business rules (project `CLAUDE.md`: <path>) · dead ends · error messages ·
missing info · inconsistencies. Quote visible text. Don't invent undocumented rules.
Drop any finding matching `.swarm-test/memory/known-false-positives.md`.

## Spec rules

- `test.step('NN-label', …)` per action; label = screenshot filename.
- Screenshot at the END of every step, `fullPage: false`.
- Stable selectors only (`getByRole`/`getByLabel`/`getByText`/`getByTestId`).
- Wait for `networkidle` or a specific element; never `waitForTimeout(<arbitrary>)`.
- Run: `npx playwright test <subdir>/journey.spec.ts --reporter=line`.
- A step fails → retry ONCE with a better selector/wait, then continue with what you have.

## Return contract — your final message is THIS JSON, nothing else

```json
{
  "journey": "<NN-slug>",
  "title": "<title>",
  "type": "<type>",
  "playwright": { "passed": 0, "total": 0 },
  "steps": [
    { "n": "01", "label": "navigate", "action": "...", "expected": "...",
      "observed": "...", "shot": "01-navigate.png",
      "findings": [
        { "severity": "ok|warn|bad", "label": "wording|ux|business|dead-end|error|missing-info",
          "note": "quote visible text", "fix": "concrete suggestion" }
      ] }
  ],
  "general_findings": []
}
```
