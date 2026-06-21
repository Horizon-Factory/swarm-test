# swarm-test

A Claude Code **skill** that validates a feature you just coded — it generates and runs a focused Playwright spec against your local dev server, captures screenshots, visually analyzes them for UX and business issues, and produces a step-by-step HTML report.

It is not a CLI or an npm package. It's a skill Claude Code loads and follows when you ask it to test what you just shipped.

This repo also ships a **sibling skill, `swarm-mobile`**, that runs the same loop against the **iOS Simulator / Android Emulator** using [Maestro](https://maestro.mobile.dev) instead of Playwright — for Flutter and native (Swift/Kotlin) apps. Same screenshot-per-step, visual analysis, and HTML timeline report. See [`swarm-mobile/SKILL.md`](swarm-mobile/SKILL.md). It runs from the Claude Code CLI **on your Mac** (iOS Simulator is macOS-only). Trigger it with _"swarm the simulator"_ / _"test this on the iPhone sim"_.

---

## Onboarding (new collaborator — 2 commands)

```bash
# 1. Install the skill (once, for all your projects)
git clone https://github.com/Horizon-Factory/swarm-test.git ~/.claude/skills/swarm-test

# 2. In the project you want to test, add Playwright (once per project)
pnpm add -D @playwright/test && npx playwright install chromium
```

Then open a new Claude Code conversation in any web project, code something, and say:

> run the swarm

That's it. There is no config file to set up.

### Update later

```bash
cd ~/.claude/skills/swarm-test && git pull
```

Or run the bundled script from anywhere:

```bash
~/.claude/skills/swarm-test/install.sh --update
```

---

## What it does

After you code a feature with Claude, say "run the swarm" / "test what we just did" / "test this feature". Claude will:

1. **Recap** what it just changed in this conversation.
2. **Check** the dev server is up (it tells you the command to run if not — it never spawns a server behind your back).
3. **Write** a focused Playwright spec at `.swarm-test/runs/<timestamp>/feature.spec.ts`.
4. **Run** it via `npx playwright test`.
5. **Read** every screenshot and analyze it for wording, UX, business-rule, dead-end, and error-message issues.
6. **Report** a step-by-step HTML timeline (`.swarm-test/runs/<ts>/report.html`) — each step shows the action, screenshot, and findings together so the run is easy to verify.
7. **Learn** from your reactions — confirmed issues go to `.swarm-test/memory/learned-rules.md`, dismissals to `.swarm-test/memory/known-false-positives.md`.

## Authentication

If the feature is behind auth, the skill prefers reusing a saved browser session. This is **auth-agnostic** — `storageState` snapshots cookies + localStorage for the app origin, which covers virtually every scheme: server-side sessions, JWT-in-cookie, token-in-localStorage, OAuth/OIDC (Auth0, Keycloak, Authentik, Okta…), NextAuth, SAML.

```bash
npx playwright open --save-storage=.swarm-test/auth/storage.json <your-dev-url>
```

Sign in once in the launched browser, close it. The skill loads that state in its specs. `.swarm-test/auth/` is auto-gitignored so your (per-person) session never gets committed.

Doesn't cover: sessions stored in IndexedDB (e.g. Firebase Auth), short-lived tokens (re-capture often), IP/device-bound sessions, client-TLS-cert auth. Fallbacks for those are in `SKILL.md` → "Handling authentication".

## Prerequisites

- Claude Code (`claude` CLI)
- Node 18+
- In the project under test: `@playwright/test` + a `dev` script in `package.json`

## Files

```
swarm-test/
├── SKILL.md                # The web workflow Claude follows (Playwright)
├── README.md               # This file
├── install.sh              # Clone/update helper + prerequisite check (links swarm-mobile too)
├── templates/
│   └── spec-template.ts    # Reference structure for a generated Playwright spec
└── swarm-mobile/           # Sibling skill: iOS Simulator / Android Emulator (Maestro)
    ├── SKILL.md            # The mobile workflow Claude follows
    └── templates/
        └── flow-template.yaml  # Reference structure for a generated Maestro flow
```

All operational logic (server probing, spec execution, auth, the HTML report) is inlined in `SKILL.md` — no external scripts invoked at runtime, so the skill works regardless of where it's installed.

## License

MIT.
