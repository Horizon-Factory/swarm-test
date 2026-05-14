# swarm-test

A Claude Code **skill** that validates a feature you just coded by generating and running a targeted Playwright spec against your local dev server, then visually analyzing the screenshots for UX and business issues.

This is not a CLI or an npm package. It's a skill that Claude Code loads and follows when you ask it to test what you just shipped.

## Install

For a single project:
```bash
mkdir -p .claude/skills
cd .claude/skills
git clone git@github.com:Horizon-Factory/swarm-test.git
```

For all projects (user-level):
```bash
mkdir -p ~/.claude/skills
cd ~/.claude/skills
git clone git@github.com:Horizon-Factory/swarm-test.git
```

Restart Claude Code (or open a new conversation). The skill is auto-discovered via its `SKILL.md` frontmatter.

## Prerequisites in the project under test

- `@playwright/test` installed:
  ```bash
  pnpm add -D @playwright/test
  ```
- Chromium downloaded:
  ```bash
  npx playwright install chromium
  ```
- A `dev` script in `package.json` that boots a local server.

## Usage

After coding a feature with Claude, just say one of:

- "lance le swarm"
- "teste ce qu'on vient de faire"
- "swarm-test"
- "test the feature"
- "validate this in the browser"

Claude will:

1. **Recap** what you just changed in the conversation.
2. **Check** the dev server is up (it tells you what to run if not — it won't spawn a server behind your back).
3. **Write** a focused Playwright spec at `.swarm-test/runs/<timestamp>/feature.spec.ts`.
4. **Run** it via `node scripts/run-spec.js`.
5. **Read** every screenshot and analyze it for wording, UX, business rule, dead-end, and error-message issues.
6. **Report** findings with severity (`✓ ok` / `⚠ friction` / `✗ broken`).
7. **Learn** from your reactions — confirmed issues go to `.swarm-test/memory/learned-rules.md`, dismissals go to `.swarm-test/memory/known-false-positives.md`.

## Why not a CLI?

The Claude that just coded your feature already knows what it did, why, and what should happen. A separate CLI would re-discover all that from scratch (parsing diffs, maintaining a flow catalog, etc.). A skill lets that same Claude orchestrate the test directly.

## Files in this skill

```
swarm-test/
├── SKILL.md                          # Workflow Claude follows
├── README.md                         # This file
├── scripts/
│   ├── ensure-dev-server.js          # Probes target URL, returns ready/not-ready + suggested command
│   └── run-spec.js                   # Runs a single Playwright spec, returns structured JSON
└── templates/
    └── spec-template.ts              # Reference structure for a generated spec
```

## Memory

Two markdown files accumulate the project's learned testing knowledge — they live in the project under test, not in this skill:

- `.swarm-test/memory/learned-rules.md` — confirmed business / UX rules
- `.swarm-test/memory/known-false-positives.md` — patterns to ignore

These are committed alongside the project, so the team's knowledge persists. The per-run artifacts (`.swarm-test/runs/`) are gitignored.

## License

MIT — internal Horizon-Factory tool.
