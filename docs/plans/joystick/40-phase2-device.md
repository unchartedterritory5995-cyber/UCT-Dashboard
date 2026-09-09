# Phase 2 — Device Verification (BrowserStack Live run script)

This is a script for a human operator (or a browser-driving assistant acting on the
owner's behalf) who can click through BrowserStack Live and read its screen, but does
not know this codebase. It does not run itself, and nothing in it has been executed —
see docs/plans/joystick/00-master-spec-v1.4.md §5's acceptance line ("on a real phone,
ten consecutive fan selections land on the intended target...") for what this script
exists to prove.

⛔ **NO RESULTS ARE RECORDED IN THIS FILE.** Every "Result" cell below is blank on
purpose. Do not fill one in from an emulator, from jsdom, from reading the code, or
from guessing what "should" happen — only from actually operating the listed
BrowserStack device. A cell left blank means "not yet run," which is honest; a cell
filled in with an assumed answer is not.

There is no BrowserStack MCP server or SDK available in this session (checked once;
none exists), and none is to be installed — that would be a new dependency this build
forbids (master spec §2, "No new dependencies"). This script is written for the
owner's existing paid BrowserStack account, driven by hand through
`https://live.browserstack.com`.

---

## 0. Preconditions — resolve these BEFORE running any block

### 0.1 The URL — RESOLVED: local sandbox + BrowserStack Local tunnel

**Decision (owner, Phase 2 gate): device testing runs against a LOCAL sandbox build on the
owner's Windows machine, reached by the four BrowserStack devices over a BrowserStack Local
tunnel.** No per-branch Railway preview exists, and production is never a target.

Why this and not a cloud preview: Railway has one environment and the data layer is SQLite on a
volume, which cannot be cloned — a PR environment would be data-empty *and* would inherit env vars
that arm live schedulers (Discord posts to a ~750-member channel, YouTube publishes, member email).
Full reasoning is in `CLAUDE.md` → "Preview environments for a feature branch".

⛔ **Never substitute `uctintelligence.com`.** It serves `master`, which contains none of this code.

#### Run this checklist first, in order

**1. Start the sandbox.** From the repo root, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\hub-sandbox.ps1
```

It pins `DATA_DIR` to `C:\data-hubtest`, seeds a synthetic `wire_data.json` so Dashboard /
Morning Wire / Breadth render something, sets `ADMIN_EMAILS=hubtest@local.dev`, zeroes every
scheduler, blanks every outbound webhook, builds the frontend, and serves on **port 8077**.
It prints every flag it set — **read that list before continuing.**
⛔ The script hard-exits if `DATA_DIR` would resolve to `C:\data` or `/data`. `C:\data` is the
owner's LIVE data on this machine; a run against it would not fail, it would succeed against
production files.

**2. Start BrowserStack Local.** Download the BrowserStack Local binary from the BrowserStack
dashboard (Live → "Local Testing"), and run it with the account's default access key:

```
BrowserStackLocal.exe --key <ACCESS_KEY_FROM_DASHBOARD>
```

Wait for it to report a connected tunnel. This binary is an **operator tool**, not a project
dependency — do not add it to `package.json` or `requirements.txt`.

**3. Open the device and load the URL.** In BrowserStack Live, pick the device for the block you
are running (§0.4), enable **"Local Testing"** for the session, then load:

> **`http://bs-local.com:8077`**

⚠️ **Use `bs-local.com`, not `localhost`.** On iOS devices in BrowserStack, `localhost` resolves to
the *device itself*, not through the tunnel, so it fails to connect. `bs-local.com` is
BrowserStack's own alias that routes to the tunnelled host, and it works on both platforms — so use
it everywhere rather than remembering which platform needs which.

**4. Mint the admin account.** Sign up at `/signup` with **`hubtest@local.dev`** (any password).
`ADMIN_EMAILS` promotes that address to admin on creation, which both skips email verification and
turns the hub on by default. Never sign in as the owner or any real member.

**5. Confirm the hub renders before starting the numbered steps.** You should see a small round
glass knob in the **bottom-right**, about 84px across, sitting clear of the home indicator, with a
small "Actions" button to its left. If it is absent, stop — every block below is meaningless — and
check §0.2.

⚠️ **Expected at the time of writing:** the voice orb may ALSO still be visible in the
bottom-right, overlapping the hub. That is a known, filed gap (`requests.md` R-03: the orb mounts
outside `Layout.jsx` and cannot be gated from there), not a bug you have found. Note it on the
rest-state screenshot and continue.

Resolved URL for this run: `http://bs-local.com:8077` (confirm the tunnel is up): `__________`

### 0.2 Turning the hub on

The hub is **off by default** (`useHubSettings.js`, `HUB_SETTINGS_DEFAULTS.enabled =
false`). It resolves to **on** automatically only when the signed-in account has
`role === 'admin'`.

- **Simplest path:** sign in with an admin test account. Nothing further to do.
- **Non-admin test account:** there is no Settings-page toggle yet (that ships in
  Phase 4). Set the preference directly — after signing in, on the loaded page, open
  the browser's own devtools console (BrowserStack Live exposes the remote device's
  console) and run:

  ```js
  fetch('/api/auth/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ joystick_hub: { enabled: true } }),
  }).then((r) => r.json()).then(console.log)
  ```

  Then reload the page. The same mechanism sets handedness for the left-handed
  mirroring step (§A14/§B14 below): `{"joystick_hub": {"handedness": "left"}}`
  merges over whatever is already stored (it is a JSON-patch merge, not a replace —
  `useHubSettings.js`), and `{"joystick_hub": {"handedness": "right"}}` reverts it.

### 0.3 Picking a BrowserStack device

For each block below, start (or switch to, via the device picker inside an existing
session) a **real device** session at `https://live.browserstack.com` — not the
BrowserStack emulator: screen-reader fidelity (VoiceOver/TalkBack) and true touch
gesture behavior both need a real device. Enabling VoiceOver/TalkBack is done from
BrowserStack Live's own in-session device settings panel (the gear/settings icon in
the session toolbar → Accessibility → toggle the screen reader on), not from anything
in this app.

**Device matrix — exactly these four:**

| Device | OS / Browser | Why this one |
|---|---|---|
| iPhone 15 Pro | Latest iOS, Safari | Primary iOS device — full-size modern viewport |
| iPhone SE (3rd gen) | Latest iOS, Safari | Smallest current iOS viewport BrowserStack offers |
| Samsung Galaxy S24 | Latest Android, Chrome | Primary Android device |
| Google Pixel 8 | Latest Android, Chrome | Second Android device/OEM (stock Android + gesture nav) |

Pick "latest" for OS version in BrowserStack's picker for all four — the exact number
drifts as BrowserStack rotates its fleet, so pin to whatever it currently offers
rather than a version written here going stale.

**Scoping note (read once, applies to every block below):** the fan-selection,
jitter, flick, and safety-case steps are specified "on each device" and are run on
**all four** devices, because those are the tests most likely to vary with screen size
and touch-digitizer behavior. Keyboard-hide/return, left-handed mirroring, and the
portrait-chart scrim are largely CSS/JS-driven rather than device-model-specific, so
each of those runs **once per platform** (iPhone 15 Pro representing iOS, Galaxy S24
representing Android) rather than on all four — noted per-step where this applies.

### 0.4 The five screenshots

Save each as the exact filename below, under `docs/plans/joystick/screens/phase2/`
(create the directory if it does not exist). Each is called out again at the step
where it is captured.

| # | Filename | Captured during |
|---|---|---|
| 1 | `01-rest-state.png` | Block A, step A0 |
| 2 | `02-fan-open-home.png` | Block A, step A1 |
| 3 | `03-fan-open-charts-portrait-scrim.png` | Block A, step A15 |
| 4 | `04-actions-sheet.png` | Block C, step C2 |
| 5 | `05-left-handed-mirror.png` | Block A, step A14 |

### 0.5 Reading the tables below

Every row is one action, one expected result, one blank Result box, and (where
applicable) one screenshot filename. Result boxes use this shape — check exactly one:

> Result: [ ] PASS  [ ] FAIL

Leave every Result box unchecked until the step has actually been performed on the
named device.

---

## Block A — iPhone Safari gestures

Session: iPhone 15 Pro or iPhone SE (3rd gen) as named per row, Safari, hub enabled
(§0.2).

| # | Device | Action | Expected result | Screenshot | Result |
|---|---|---|---|---|---|
| A0 | iPhone 15 Pro | Load the URL, sign in, confirm the hub pad renders bottom-right at rest (no fan open). Capture a screenshot. | Pad renders bottom-right, fan closed, chip visible. | `01-rest-state.png` | [ ] PASS  [ ] FAIL |
| A1 | iPhone 15 Pro | Press-and-hold the pad past the fan-open threshold on Home mode. Capture a screenshot with the fan open. | Fan opens showing Home's outer + inner ring bubbles. | `02-fan-open-home.png` | [ ] PASS  [ ] FAIL |
| A2 | iPhone 15 Pro | Perform 10 consecutive fan selections targeting the **outer ring**, one at a time (open fan → push toward a specific outer bubble → release → confirm it fired → repeat). | All 10 land on the intended outer target, no misfires. | — | [ ] PASS  [ ] FAIL |
| A3 | iPhone 15 Pro | Repeat, 10 consecutive selections targeting the **inner ring**. | All 10 land on the intended inner target, no misfires. | — | [ ] PASS  [ ] FAIL |
| A4 | iPhone SE (3rd gen) | Repeat A2 (10 consecutive **outer ring** selections) on the small-viewport device. | All 10 land on the intended outer target, no misfires. | — | [ ] PASS  [ ] FAIL |
| A5 | iPhone SE (3rd gen) | Repeat A3 (10 consecutive **inner ring** selections) on the small-viewport device. | All 10 land on the intended inner target, no misfires. | — | [ ] PASS  [ ] FAIL |
| A6 | iPhone 15 Pro | With `stickyFan` on (default — `HUB_SETTINGS_DEFAULTS.stickyFan = true`), perform 10 fan selections while deliberately introducing a 3-5px thumb tremor throughout each drag (small continuous wobble, not a clean line to the target). | 10 of 10 still land on the intended target despite the jitter. | — | [ ] PASS  [ ] FAIL |
| A7 | iPhone SE (3rd gen) | Repeat A6 (jitter test, 10/10) on the small-viewport device. | 10 of 10 land on the intended target despite the jitter. | — | [ ] PASS  [ ] FAIL |
| A8 | iPhone 15 Pro | Perform 10 quick flicks (press, short fast drag past the open threshold, release within the flick window) each toward the same flickable outer action. | The intended outer action fires directly (no fan lands open) at least 8 of the 10 times. | — | [ ] PASS  [ ] FAIL |
| A9 | iPhone SE (3rd gen) | Repeat A8 (flick-fires-action, 8/10 minimum) on the small-viewport device. | At least 8 of 10 flicks fire the intended outer action directly. | — | [ ] PASS  [ ] FAIL |
| A10 | iPhone 15 Pro | **Safety case.** Navigate to Journal mode (`/journal/trades`). Perform a quick flick toward Close (`journal.close` — the action that writes a permanent trade row and is `flickable: false`). | The fan **opens** (does not fire Close). No trade is written. Confirm nothing changed in the trade log. | — | [ ] PASS  [ ] FAIL |
| A11 | iPhone SE (3rd gen) | Repeat A10 (Journal Close safety case) on the small-viewport device. | The fan opens; Close never fires from a flick. | — | [ ] PASS  [ ] FAIL |
| A12 | iPhone 15 Pro | With Safari's bottom toolbar **expanded** (scroll to top / fresh page load), measure the gap between the bottom of the hub pad and the top of the home indicator bar. | Gap is **≥68px**. | — | [ ] PASS  [ ] FAIL |
| A13 | iPhone 15 Pro | Scroll the page to collapse Safari's bottom toolbar, then re-measure the same gap. | Gap is still **≥68px** with the toolbar collapsed. | — | [ ] PASS  [ ] FAIL |
| A14 | iPhone 15 Pro | Enable left-handed mirroring (via the settings mechanism in §0.2, or the Settings UI once it exists — `handedness: 'left'`). Reload. Capture a screenshot. | Pad, fan quadrant, chip, and the Actions button all move to the mirrored (left) side **together** — none stays on the original side. | `05-left-handed-mirror.png` | [ ] PASS  [ ] FAIL |
| A15 | iPhone 15 Pro | Set handedness back to `right`. Navigate to `/charts` in portrait orientation with a symbol loaded (volume visible on the chart). Open the fan. Capture a screenshot. | The scrim does not cover the volume band at the bottom of the chart, and the back-to-live chip (if shown) remains tappable — not covered by the hub's hit area. | `03-fan-open-charts-portrait-scrim.png` | [ ] PASS  [ ] FAIL |
| A16 | iPhone 15 Pro | Tap into any text field that raises the keyboard (e.g. a Notebook note body). Observe the hub. Then dismiss the keyboard. | Hub hides while the keyboard is open; hub returns once the keyboard closes. | — | [ ] PASS  [ ] FAIL |

---

## Block B — Android Chrome gestures + right-edge back swipe

Session: Samsung Galaxy S24 or Google Pixel 8 as named per row, Chrome, hub enabled
(§0.2), gesture-nav width set to **"wide"** in the device's Android system settings
(master spec §2c calls this out specifically for the back-swipe mitigation check).

| # | Device | Action | Expected result | Screenshot | Result |
|---|---|---|---|---|---|
| B1 | Galaxy S24 | Perform 10 consecutive fan selections targeting the **outer ring**. | All 10 land on the intended outer target, no misfires. | — | [ ] PASS  [ ] FAIL |
| B2 | Galaxy S24 | Repeat, 10 consecutive selections targeting the **inner ring**. | All 10 land on the intended inner target, no misfires. | — | [ ] PASS  [ ] FAIL |
| B3 | Pixel 8 | Repeat B1 (10 consecutive **outer ring** selections). | All 10 land on the intended outer target, no misfires. | — | [ ] PASS  [ ] FAIL |
| B4 | Pixel 8 | Repeat B2 (10 consecutive **inner ring** selections). | All 10 land on the intended inner target, no misfires. | — | [ ] PASS  [ ] FAIL |
| B5 | Galaxy S24 | Sticky-fan jitter test: 10 selections with a deliberate 3-5px thumb tremor throughout each drag. | 10 of 10 land on the intended target. | — | [ ] PASS  [ ] FAIL |
| B6 | Pixel 8 | Repeat B5 (jitter test, 10/10). | 10 of 10 land on the intended target. | — | [ ] PASS  [ ] FAIL |
| B7 | Galaxy S24 | 10 quick flicks toward the same flickable outer action. | The intended action fires directly at least 8 of 10 times. | — | [ ] PASS  [ ] FAIL |
| B8 | Pixel 8 | Repeat B7 (flick-fires-action, 8/10 minimum). | At least 8 of 10 flicks fire the intended action directly. | — | [ ] PASS  [ ] FAIL |
| B9 | Galaxy S24 | **Safety case.** On `/journal/trades`, flick toward Close. | The fan opens; Close never fires from a flick. No trade written. | — | [ ] PASS  [ ] FAIL |
| B10 | Pixel 8 | Repeat B9 (Journal Close safety case). | The fan opens; Close never fires from a flick. | — | [ ] PASS  [ ] FAIL |
| B11 | Galaxy S24 | With the pad at rest (fan closed), perform a system back-swipe starting within roughly 20px of the right screen edge, dragging leftward — the Android edge-swipe-back gesture, from the side the hub occupies. | The swipe is intercepted as a system back gesture (or cancelled by the browser); the hub fires **no** action, and no half-open fan is left visually stuck on screen afterward. | — | [ ] PASS  [ ] FAIL |
| B12 | Pixel 8 | Repeat B11 (right-edge back swipe). | Same: no hub action fires, no half-open fan remains. | — | [ ] PASS  [ ] FAIL |
| B13 | Galaxy S24 | Tap into a text field that raises the keyboard, observe the hub, then dismiss the keyboard. | Hub hides while the keyboard is open; returns once closed. | — | [ ] PASS  [ ] FAIL |
| B14 | Galaxy S24 | Enable left-handed mirroring (§0.2), reload. | Pad, fan quadrant, chip, and Actions button all move to the mirrored side together. | — | [ ] PASS  [ ] FAIL |
| B15 | Galaxy S24 | Set handedness back to `right`. Open `/charts` in portrait with a symbol loaded (volume visible), open the fan. | Scrim leaves the volume band visible; back-to-live chip (if shown) stays tappable. | — | [ ] PASS  [ ] FAIL |

---

## Block C — VoiceOver Actions-sheet path (iOS)

Session: iPhone 15 Pro, Safari, hub enabled. Enable VoiceOver from BrowserStack
Live's device settings panel (gear icon in the session toolbar → Accessibility →
VoiceOver → On) before C1.

| # | Action | Expected result | Screenshot | Result |
|---|---|---|---|---|
| C1 | With VoiceOver on, swipe to focus the hub's always-visible **Actions** button (labelled "{Mode} actions" — spec §5) and double-tap to activate it. Perform this with **no drag anywhere** — VoiceOver focus-swipes and a double-tap only. | The Actions sheet (Peek) opens. | — | [ ] PASS  [ ] FAIL |
| C2 | Capture a screenshot of the open Actions sheet. | — | `04-actions-sheet.png` | [ ] PASS  [ ] FAIL |
| C3 | On Home mode's Actions sheet, using VoiceOver's swipe-to-next-element + double-tap-to-activate for each, activate **every** listed action in turn — Scan, Chart, Breadth, Wire, Flow, Journal, Notebook, Calendar, Voice — returning to the sheet (or re-opening it) between navigations as needed. At no point drag a finger across the screen. | Every action activates its target (navigates to the section, or opens the Voice connect flow) purely from VoiceOver focus + double-tap. None requires a drag. | — | [ ] PASS  [ ] FAIL |

---

## Block D — TalkBack Actions-sheet path (Android)

Session: Samsung Galaxy S24, Chrome, hub enabled. Enable TalkBack from BrowserStack
Live's device settings panel (gear icon → Accessibility → TalkBack → On) before D1.

| # | Action | Expected result | Screenshot | Result |
|---|---|---|---|---|
| D1 | With TalkBack on, swipe to focus the hub's **Actions** button and double-tap to activate it. No drag anywhere. | The Actions sheet opens. | — | [ ] PASS  [ ] FAIL |
| D2 | On Home mode's Actions sheet, using TalkBack's swipe-to-next-element + double-tap for each, activate **every** listed action in turn (Scan, Chart, Breadth, Wire, Flow, Journal, Notebook, Calendar, Voice), with no drag at any point. | Every action activates its target purely from TalkBack focus + double-tap. | — | [ ] PASS  [ ] FAIL |

---

## Block E — FPS read while dragging over `/charts`

For each device, load `/charts` with a symbol on screen, start the FPS instrument
named for that platform, then drag the hub's knob continuously for **5 seconds**
(open the fan and sweep the knob around inside it, or drag it pre-open — either way,
keep it moving for the full 5 seconds).

**Reading FPS:**
- **Safari (iPhone 15 Pro, iPhone SE):** open BrowserStack Live's remote **Web
  Inspector** for the session → **Timelines** tab → **Rendering** → start a
  recording, perform the 5-second drag, stop the recording, read the frame-rate
  graph/summary for that window.
- **Chrome (Galaxy S24, Pixel 8):** open remote **DevTools** for the session →
  **Performance** panel → enable the **FPS meter** (or record a performance trace
  and read the FPS track) → perform the 5-second drag → read the observed FPS.

**Gate: PASS at ≥55fps sustained during the drag. FAIL below 45fps.** Between 45 and
55, mark FAIL and note it — the gate is meant to be met cleanly, not scraped.

| # | Device | Instrument | Observed FPS (blank) | Result |
|---|---|---|---|---|
| E1 | iPhone 15 Pro | Safari Web Inspector → Timelines → Rendering | ______ | [ ] PASS  [ ] FAIL |
| E2 | iPhone SE (3rd gen) | Safari Web Inspector → Timelines → Rendering | ______ | [ ] PASS  [ ] FAIL |
| E3 | Samsung Galaxy S24 | Chrome DevTools → Performance → FPS meter | ______ | [ ] PASS  [ ] FAIL |
| E4 | Google Pixel 8 | Chrome DevTools → Performance → FPS meter | ______ | [ ] PASS  [ ] FAIL |

---

## After running this script

- If every Result box above is checked PASS, the Phase 2 device gate (master spec §5
  acceptance line) is met.
- Any FAIL, or anything this script did not anticipate (a gesture conflict with new
  chart indicator UI in particular — that surface is owned by a separate session
  building custom indicators and is off-limits to this build; log a conflict there,
  never fix it here), goes into `docs/plans/joystick/requests.md`, not into an edit
  of this file's results.
