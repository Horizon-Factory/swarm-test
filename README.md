# swarm-test

A Claude Code **skill** that validates a feature you just coded. It plans **every case** for the feature (happy + edge + error + empty-state + modal-depth), shows you that plan, then fans out a **swarm of parallel agents** — each writes and runs its own focused Playwright spec against your local dev server, captures screenshots, and visually analyzes them for UX and business issues. Findings are merged into one step-by-step HTML report grouped by journey.

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

## Mobile setup (`swarm-mobile`)

For testing **iOS Simulator / Android Emulator** instead of the browser. Runs from the Claude Code CLI **on macOS** (the iOS Simulator is macOS-only; Android also works).

```bash
# 1. Install the skills (once). install.sh links swarm-mobile next to swarm-test
#    so Claude Code discovers it as its own skill.
git clone https://github.com/Horizon-Factory/swarm-test.git ~/.claude/skills/swarm-test
~/.claude/skills/swarm-test/install.sh

# 2. Install Maestro (once, machine-wide). Needs Java 11+.
curl -Ls "https://get.maestro.mobile.dev" | bash

# 3. Boot a device before you run:
#    iOS     — open -a Simulator   (or: xcrun simctl boot "iPhone 15")
#    Android — start an AVD from Android Studio, or: emulator -avd <name>
```

Then, in a Claude Code conversation inside your **Flutter or native (Swift/Kotlin)** app, code something and say:

> swarm the simulator

Claude builds + installs your app onto the booted device, drives the flow with Maestro, and produces **the same HTML timeline report** as the web skill. There's no config file.

**Mobile prerequisites**

- macOS with **Xcode** (for iOS) and/or **Android Studio + an AVD** (for Android)
- **Maestro** (`curl -Ls "https://get.maestro.mobile.dev" | bash`) and **Java 11+**
- A built-able app: Flutter project (`flutter` on PATH) or a native Xcode/Gradle project
- Your app's accessible elements should expose ids/labels — `accessibilityIdentifier` (Swift), widget `Key`/`Semantics(label:)` (Flutter) — so flows use stable selectors

If `~/.claude/skills/swarm-mobile` didn't get linked (e.g. you copied the repo manually), create it yourself:

```bash
ln -s ~/.claude/skills/swarm-test/swarm-mobile ~/.claude/skills/swarm-mobile
```

See [`swarm-mobile/SKILL.md`](swarm-mobile/SKILL.md) for the full workflow, the mobile-specific visual checks, and native auth strategies.

---

## What it does

After you code a feature with Claude, say "run the swarm" / "test what we just did" / "test this feature". Claude will:

1. **Recap** what it just changed in this conversation.
2. **Check** the dev server is up (it tells you the command to run if not — it never spawns a server behind your back).
3. **Plan the case matrix** — enumerate every journey worth testing (happy, edge, error, empty-state, modal-depth) and **show it to you before running**. Reply "go" to swarm, edit the list, or say "swarm auto" to skip the confirm next time.
4. **Fan out the swarm** — one parallel agent per journey, each writing and running its own focused Playwright spec in its own subdir under `.swarm-test/runs/<timestamp>/`, capturing a screenshot per step.
5. **Analyze** — each agent reads its own screenshots and flags wording, UX, business-rule, dead-end, and error-message issues. Journeys that open modals/sub-flows are driven **inside** them, not just screenshotted.
6. **Merge & report** — dedup findings across journeys and produce one step-by-step HTML timeline grouped by journey (`.swarm-test/runs/<ts>/report.html`), each step showing the action, screenshot, and findings together so the run is easy to verify.
7. **Learn** from your reactions — confirmed issues go to `.swarm-test/memory/learned-rules.md`, dismissals to `.swarm-test/memory/known-false-positives.md`.

## Authentication

If the feature is behind auth, the skill prefers reusing a saved browser session. This is **auth-agnostic** — `storageState` snapshots cookies + localStorage for the app origin, which covers virtually every scheme: server-side sessions, JWT-in-cookie, token-in-localStorage, OAuth/OIDC (Auth0, Keycloak, Authentik, Okta…), NextAuth, SAML.

```bash
npx playwright open --save-storage=.swarm-test/auth/storage.json <your-dev-url>
```

Sign in once in the launched browser, close it. The skill loads that state in its specs. `.swarm-test/auth/` is auto-gitignored so your (per-person) session never gets committed.

Doesn't cover: sessions stored in IndexedDB (e.g. Firebase Auth), short-lived tokens (re-capture often), IP/device-bound sessions, client-TLS-cert auth. Fallbacks for those are in `SKILL.md` → "Handling authentication".

## Prerequisites (web)

- Claude Code (`claude` CLI)
- Node 18+
- In the project under test: `@playwright/test` + a `dev` script in `package.json`

For mobile prerequisites, see [Mobile setup](#mobile-setup-swarm-mobile) above.

## Files

```
swarm-test/
├── SKILL.md                # The web workflow Claude follows (Playwright)
├── README.md               # This file
├── install.sh              # Clone/update helper + prerequisite check (links swarm-mobile too)
├── templates/
│   ├── spec-template.ts    # Reference structure for one journey's Playwright spec
│   └── journey-brief.md    # Self-contained brief handed to each parallel swarm agent
├── docs/
│   └── swarm-v2-design.md  # Design record for the parallel-journey-swarm architecture
└── swarm-mobile/           # Sibling skill: iOS Simulator / Android Emulator (Maestro)
    ├── SKILL.md            # The mobile workflow Claude follows
    └── templates/
        └── flow-template.yaml  # Reference structure for a generated Maestro flow
```

All operational logic (server probing, spec execution, auth, the HTML report) is inlined in `SKILL.md` — no external scripts invoked at runtime, so the skill works regardless of where it's installed.

## License

MIT.
