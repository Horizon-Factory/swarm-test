---
name: swarm-mobile
description: Use when the user asks you to test, validate, verify, or smoke-check a feature they just implemented in a mobile app running in the iOS Simulator or Android Emulator. Triggers on phrases like "run the mobile swarm", "swarm the simulator", "test this in the simulator", "test this on the iPhone sim", "test this on the emulator", "swarm-mobile", "/swarm-mobile". Drives the app with a focused Maestro flow on a booted simulator/emulator, captures a screenshot per step, visually analyzes them for UX and business issues, and reports findings as an HTML timeline. Works for Flutter and native (Swift/iOS, Kotlin/Android) apps. macOS only for iOS. Skip if the project has no mobile app.
---

# swarm-mobile: validate the mobile feature you just shipped

You just helped the user implement (or modify) a feature in a **mobile app**. Now you validate it end-to-end on a real simulator/emulator. Your goal: catch bugs the user would only notice by tapping through the flow themselves — including the mobile-specific ones (safe-area clipping, keyboard covering inputs, truncation, tap targets, dark mode).

This is the mobile sibling of `swarm-test`. The **back half is identical** — screenshot-per-step, visual analysis, the HTML timeline report, and the memory files all behave exactly as in `swarm-test`. Only the *driver* (Maestro instead of Playwright) and the *"is the target ready"* check (a booted simulator with the app installed, instead of a dev server) differ.

## Mental model

You are NOT running a generic test suite. You are testing **the specific thing you just changed in this conversation** — the screen, widget, or flow you edited. Use the file edits, diffs, and intent from earlier turns to focus the flow.

If you cannot recall a concrete user-visible change from this conversation, STOP and ask the user what to test. Don't crawl the app at random.

**Environment reality:** the iOS Simulator only exists on **macOS with Xcode**. This skill is meant to run from the Claude Code CLI **on the user's Mac**, not from a remote/Linux session. The Android Emulator can run on Linux but needs hardware acceleration. If you are not on macOS and the target is iOS, say so and stop.

## Driver: Maestro

Maestro is black-box — it drives the UI through the accessibility tree, so the same flow language works for **Flutter and native (Swift/Kotlin)** apps on both platforms. Flows are YAML and map 1:1 onto "step + screenshot".

If `maestro` is not installed, tell the user:
> Maestro isn't installed. Run `curl -Ls "https://get.maestro.mobile.dev" | bash` (needs Java 11+), then say "go".

## Workflow

Follow these steps in order. Skip none.

### 0. Version check (best-effort, non-blocking)

```bash
D=~/.claude/skills/swarm-test; [ -d "$D/.git" ] && git -C "$D" fetch --quiet origin main 2>/dev/null && \
  LOCAL=$(git -C "$D" rev-parse HEAD) && REMOTE=$(git -C "$D" rev-parse origin/main) && \
  [ "$LOCAL" != "$REMOTE" ] && echo "OUTDATED" || echo "OK"
```

If `OUTDATED`, mention in one line that `~/.claude/skills/swarm-test/install.sh --update` is available, then continue. If the path doesn't exist, skip silently.

### 1. Recap what you changed (output to user)

In 3-5 lines, tell the user:

- Files touched in this conversation (Dart widgets, Swift views, etc.)
- Screens / routes / widgets affected
- The user journey that should now work (or work differently)
- Any auth / preconditions required to exercise it

Confirm with the user if the journey is ambiguous. **Do not proceed silently.**

### 2. Make sure the target is up (booted simulator + installed app)

This replaces the dev-server check. The **booted simulator/emulator is the thing the user owns** — keep it warm, never reset it behind their back. You may build and install the app yourself (it's deterministic), but ask before booting/erasing a device.

First decide the **platform** to run on. If the user didn't say and the app is iOS-only (Swift), use iOS. If Flutter and unspecified, ask which platform (or default to iOS on macOS).

**iOS:**
```bash
xcrun simctl list devices booted
```
- A device is booted → proceed.
- None booted → ask the user which sim to boot, then (only on confirmation):
  ```bash
  xcrun simctl boot "iPhone 15"   # or the device they name
  open -a Simulator
  ```

Build & install (do NOT use attached `flutter run` — it's the hot-reload "dev server" equivalent, not a test harness):
- **Flutter:** `flutter build ios --debug --simulator` → produces `build/ios/iphonesimulator/Runner.app` → `xcrun simctl install booted build/ios/iphonesimulator/Runner.app`
- **Native Swift:** `xcodebuild -scheme <Scheme> -sdk iphonesimulator -configuration Debug -derivedDataPath build build` → install the resulting `<App>.app`: `xcrun simctl install booted "$(find build -name '*.app' -maxdepth 4 | head -1)"`

**Android:**
```bash
adb devices            # expect a "device" line; if empty, list AVDs:
emulator -list-avds    # ask the user to start one, or start on confirmation
```
Build & install:
- **Flutter:** `flutter build apk --debug` → `adb install -r build/app/outputs/flutter-apk/app-debug.apk`
- **Native Kotlin:** `./gradlew installDebug`

**Determine the appId** (bundle id / package) — you need it for the Maestro flow's `appId:`. Read it from `ios/Runner.xcodeproj` / `android/app/build.gradle` (`applicationId`) / Info.plist (`CFBundleIdentifier`), or ask. Example: `com.example.myapp`.

### 3. Prepare the run directory

```
.swarm-mobile/runs/<ISO-timestamp>/
```
e.g. `.swarm-mobile/runs/2026-06-21T14-40-00/`. Spec, screenshots, and artifacts for this run go here. (Mirrors `.swarm-test/` — keep mobile runs separate.)

### 4. Write a focused Maestro flow

Write `.swarm-mobile/runs/<ts>/feature.flow.yaml`. Use `templates/flow-template.yaml` (in this skill dir) as a starting structure, always adapted to the change at hand.

Rules:
- **Target the screen(s) you just changed.** Never crawl random screens.
- Set `appId:` to the bundle id / package from step 2.
- One logical user action per `takeScreenshot`. Name screenshots `01-label`, `02-label`, … so they order correctly and the name describes the action.
- Take a screenshot at the END of every meaningful step:
  ```yaml
  - takeScreenshot: ${SHOTDIR}/01-launch
  ```
  Maestro appends `.png`. Pass `${SHOTDIR}` as an absolute path to the run dir via `-e SHOTDIR=...` at run time (step 5).
- **Stable selectors only.** Prefer accessibility ids / widget keys / `testID`:
  - Flutter: match on a `Semantics(label:)` or a widget `Key`. Plain `Text` is only matchable when semantics expose it — prefer explicit labels. Tell the user if a target needs an accessibility label added.
  - Swift: `accessibilityIdentifier`. Match with `id:` in Maestro (`- tapOn: { id: "submitButton" }`).
  - Last resort: visible `text:`. Never tap by raw coordinates.
- Use `assertVisible` / `extendedWaitUntil` to wait for state. Avoid blind `- wait` with arbitrary durations.
- If the feature is behind auth, follow **Handling authentication** below before writing the flow.

The flow should be **3-8 steps**. If you're writing 15, you're testing too much.

### 5. Execute

From the project root, with the simulator booted and app installed:

```bash
maestro test .swarm-mobile/runs/<ts>/feature.flow.yaml \
  -e SHOTDIR="$(pwd)/.swarm-mobile/runs/<ts>" \
  --format junit --output .swarm-mobile/runs/<ts>/report.xml
```

Capture the exit code and stdout — Maestro prints per-command pass/fail.

If a step fails:
- **Retry once** with a corrected selector or an `extendedWaitUntil`.
- Never modify the application source code from this skill (you may *suggest* an accessibility label, but don't add it silently).
- If it still fails, capture the failure and continue analysis with whatever screenshots exist.

### 6. Visually analyze the screenshots

List `.swarm-mobile/runs/<ts>/*.png`. For every screenshot, use the Read tool (it returns images visually). For each one, ask:

1. **Wording vs action** — does visible copy match what's about to happen on tap?
2. **Step ordering** — is the journey logical?
3. **Business rules** — do the rules in the project root `CLAUDE.md` still hold at this screen?
4. **Dead ends** — can the user always go back, retry, or get help?
5. **Error messages** — actionable, or just "Something went wrong"?
6. **Missing info** — enough info to decide (prices, terms, consequences)?
7. **Inconsistencies** — does what's shown contradict the previous step?

Mobile-specific checks (the reason you're on a simulator at all):

8. **Safe area / notch / status bar** — is content clipped by the notch, Dynamic Island, or home indicator?
9. **Keyboard** — when a field is focused, does the on-screen keyboard cover the input or the submit button?
10. **Tap targets** — are interactive elements large enough (~44pt) and not overlapping?
11. **Truncation / overflow** — is text cut off ("…") or overflowing its container at this device size?
12. **Dark mode / contrast** — is anything unreadable in the current appearance?

Be specific. Quote visible text. Don't invent rules. Before flagging, check `.swarm-mobile/memory/known-false-positives.md` — if your finding matches, drop it.

### 7. Report (terminal summary)

```
swarm-mobile — <feature description, 1 line>

Maestro: 5/5 steps passed   (iPhone 15 · iOS 17 · com.example.myapp)
Visual review:
  ✓ Login screen renders correctly
  ✓ Tapping "Continue" advances to OTP
  ⚠ 03-otp: numeric keyboard covers the "Verify" button on iPhone SE size
  ✗ 04-home: greeting text truncates "Bonjour Alexandr…" — overflow

Artifacts:
  Report: .swarm-mobile/runs/<ts>/report.html   (opens in browser)
  Flow  : .swarm-mobile/runs/<ts>/feature.flow.yaml
  Shots : .swarm-mobile/runs/<ts>/*.png
```

Severity scale:
- ✗ **broken** — user blocked or business rule violated
- ⚠ **friction** — works but degrades the experience
- ✓ **ok**

### 8. Generate the visual report

Write a self-contained HTML timeline to `.swarm-mobile/runs/<ts>/report.html`, **reusing the exact template and per-step structure from `swarm-test`** — read `~/.claude/skills/swarm-test/SKILL.md` → step 8 and use that `<!DOCTYPE html>…</html>` block verbatim. Same dark theme, same KPI cards, same timeline of one block per step with **Action / Expected / Observed** + screenshot + findings.

Mobile substitution differences:
- `{{PW_STATUS}}` → the Maestro result, e.g. `5/5 passed`.
- `{{TARGET_URL}}` → the device + appId, e.g. `iPhone 15 · iOS 17 · com.example.myapp`.
- `{{SPEC_PATH}}` → the `.flow.yaml` path.
- The footer "Memory" line → `.swarm-mobile/memory/`.

Then open it:
```bash
REPORT=".swarm-mobile/runs/<ts>/report.html"
case "$(uname)" in
  Darwin) open "$REPORT" ;;
  Linux)  xdg-open "$REPORT" 2>/dev/null || echo "Open manually: $REPORT" ;;
  *)      echo "Open manually: $REPORT" ;;
esac
```

### 9. Learn from the user's reaction

- **Confirms a finding** → append a one-liner to `.swarm-mobile/memory/learned-rules.md`.
- **Dismisses a finding** → append to `.swarm-mobile/memory/known-false-positives.md`.

Keep entries short (one line each, date-prefixed).

## Handling authentication

There's no `storageState` for native apps — sessions live in the iOS Keychain / Android secure storage, which don't snapshot cleanly. Strategies in order of preference:

### Strategy A — keep a warm, signed-in simulator (best)

Sign in once **by hand** in the booted simulator, then never erase/reset that device between runs. The app's stored session persists across app relaunches, so your flow can start `- launchApp` already authenticated. Use `clearState: false` (the default) — do NOT `clearState` or `--clear-state`, which would wipe the session.

### Strategy B — programmatic login in the flow

Look for test credentials in: project root `CLAUDE.md` ("Test accounts"), `.swarm-mobile/memory/learned-rules.md`, or `.env.test`/`.env.local`. If found, drive the login in the flow (`- tapOn`, `- inputText`). Never print the password to stdout. If none are documented, ASK — don't invent credentials.

### Strategy C — deep-link past the wall

If the app registers a URL scheme / universal link and supports a route into the authed area, jump straight there (only if the user confirms it's safe):
```bash
xcrun simctl openurl booted "myapp://home"                      # iOS
adb shell am start -a android.intent.action.VIEW -d "myapp://home"  # Android
```
or in the flow: `- openLink: myapp://home`.

### When all else fails

Write the flow anyway but stop at the login screen, screenshot it, and tell the user:
> The flow reaches the login screen but can't go further without a signed-in simulator or test credentials. Use strategy A or B and re-run.

## Anti-patterns — don't do these

- ❌ Use attached `flutter run` as the test harness. Build + install, then drive with Maestro.
- ❌ Erase/reset or boot a device without asking — that's the user's hardware state.
- ❌ Tap by raw coordinates. Use ids / keys / accessibility labels.
- ❌ Crawl the whole app to "be thorough". Stay scoped to the change.
- ❌ Report passing without the visual analysis (steps 6, including the mobile-specific checks). Maestro green ≠ feature correct.
- ❌ `clearState` on a warm authed simulator — you'll wipe the session you rely on.

## Conventions

- One run = one feature scope. Two unrelated changes → two runs.
- All artifacts under `.swarm-mobile/runs/<ISO-timestamp>/`. Gitignore it:
  ```bash
  grep -q '^\.swarm-mobile/runs/' .gitignore || echo '.swarm-mobile/runs/' >> .gitignore
  ```
- Memory files (`.swarm-mobile/memory/*.md`) ARE committed — accumulated test knowledge.
- No required config file. Reads `package.json`/`pubspec.yaml`, `CLAUDE.md`, the app's bundle id, and the conversation.
