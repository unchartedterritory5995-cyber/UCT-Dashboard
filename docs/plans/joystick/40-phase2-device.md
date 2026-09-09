# Phase 2 — Device Verification (BrowserStack Live run script)

This is a script for a human operator (or a browser-driving assistant acting on the
owner's behalf) who can click through BrowserStack Live and read its screen, but does
not know this codebase. It does not run itself, and nothing in it has been executed —
see docs/plans/joystick/00-master-spec-v1.4.md §5's acceptance line ("on a real phone,
ten consecutive fan selections land on the intended target...") for what this script
exists to prove.

⛔ **RESULTS FROM RUN 1 ARE NOW RECORDED** in the RESULTS section below, gathered from
real BrowserStack Automate sessions (every claim carries its session id). Every "Result"
cell in the hand-run script that follows is still blank on purpose. Do not fill one in from an emulator, from jsdom, from reading the code, or
from guessing what "should" happen — only from actually operating the listed
BrowserStack device. A cell left blank means "not yet run," which is honest; a cell
filled in with an assumed answer is not.

There is no BrowserStack MCP server or SDK available in this session (checked once;
none exists), and none is to be installed — that would be a new dependency this build
forbids (master spec §2, "No new dependencies"). This script is written for the
owner's existing paid BrowserStack account, driven by hand through
`https://live.browserstack.com`.

## RUN 3 — pass A, 2026-09-09 00:31, dedicated port 8099

**Port guard verified first:** a throwaway listener was bound to 8077 and the launcher
**refused to boot** (exit 1, naming the command to find the owner) before the clean boot on
8099. **Snapshot-compare CLEAN** — 53 databases byte-identical, first line of the run and
again after the suite.

Sessions — iPhone 15 Pro `0dfcc0f140581df97d7bf0d3c3fab58a848887d8` · iPhone SE 3rd gen
`b0433165257767a00d92938656f055002f0ba063` · Galaxy S24
`654931574d08ae3d4d14cac3092c242c2c7f9d2e` · Pixel 8
`861b43cecf96c51b3f546477c66973d03f583976`.

| Check | iPhone 15 Pro (iOS 17) | iPhone SE 3rd (iOS 16) | Galaxy S24 | Pixel 8 |
|---|---|---|---|---|
| Hub mounts | ✅ | ✅ | ✅ | ✅ |
| Ring 0 — 10/10 | ⛔ blocked | ⛔ blocked | ✅ **10/10** | ✅ **10/10** |
| Ring 1 — 10/10 | ⛔ blocked | ⛔ blocked | ✅ **10/10** | ✅ **10/10** |
| Sticky fan 10/10 | 🔴 0/10 | ✅ **10/10** | ✅ **10/10** | ✅ **10/10** |
| Flick ≥8/10 | 🔴 0/10 | ✅ **10/10** | ✅ **10/10** | ✅ **10/10** |
| Right-edge swipe → 0 actions | ✅ | ✅ | ✅ | ✅ |
| Keyboard hides hub | ⛔ threw | ⛔ threw | ⬜ inconclusive | ⬜ inconclusive |
| `/charts` scrim band | ⬜ inconclusive | ⬜ inconclusive | ⬜ inconclusive | ⬜ inconclusive |
| Actions → Feedback → `/support` | ✅ | ✅ | ✅ | ✅ |
| Toolbar clearance ≥68px | ✅ 68px | ✅ 68px | ✅ 68px | ✅ 92px |
| Frame rate | ✅ 58.8 | ✅ 59.5 | ✅ **30.0 (see below)** | ✅ 57.5 |
| **Role gating — admin sees, member does not** | ✅ | ✅ | ✅ | ✅ |

### What is settled

- **Reach mode works on every Android device tested: ring 0 and ring 1 both 10/10.** The
  inner ring — unreachable before F-2 — is now as reliable as the outer.
- **Sticky fan 10/10** on three of four devices, scrim-keyed.
- **Role gating passes on all four**: `hubtest@local.dev` (admin) sees the hub,
  `hubmember@local.dev` (member) does not. This is Phase 2.5 **Step 1** verified on hardware.
- **Galaxy S24 frame rate PASSES under the ruled criterion.** 30.0 fps fan-open against a
  measured **30.1 fps idle baseline** on the same device = **99.7%**, well over the 90%
  bar. ⚠️ The runner printed `FAIL` because it still applied the old absolute ≥45 rule; the
  step has since been rewritten to measure the idle baseline in-session and gate on the
  ratio. **The row above is the ruling applied to measured numbers, not a re-run** — run 4
  will produce it directly.

### 🔴 Still open — all harness, none product

1. **iOS gesture rows blocked by a Selenium input-source bug.** Both iPhones fail the two
   10× ring rows with
   `WebDriverAgent Code=1 "Only actions of '(...)' types are supported ... 'wheel' is given
   instead for action with id 'default wheel'"`. `driver.actions()` in selenium-webdriver
   emits a **wheel** input source alongside the pointer, and iOS WDA rejects the whole
   sequence. Android ignores it. **Fix for run 4:** drive iOS through Appium's
   `mobile: dragFromToForDuration` instead of the W3C actions builder, or strip the wheel
   device before `perform()`.
   ⚠️ The iPhone 15 Pro's sticky 0/10 and flick 0/10 are almost certainly the same cause —
   the SE, same OS family, scored 10/10 on both — but that is **inference, not measurement**,
   and it is recorded as unresolved rather than assumed.
2. **Keyboard step** — the soft keyboard does not raise from a synthetic tap on any device.
   Inconclusive everywhere; needs a real input on a real page, or an Appium keyboard command.
3. **`/charts` scrim** — the fan does not open on `/charts` on any device. Inconclusive on
   all four, and it is the one item that could still be a product issue: the open gesture
   behaves differently on that route. **Investigate before the preview ships**, since
   `/charts` is one of the four preview destinations.
4. **Screenshots not captured.** The five per device are still to do.
5. **Kill-switch pass (pass B) not run.** The flag is built and railed in both directions
   (14 backend + 5 frontend tests, including a per-request-read rail), and the device-level
   confirmation needs a second boot with `HUB_PREVIEW_ENABLED=0`.

### Manual, pending — not automatable here

- **VoiceOver** (iOS) Actions-sheet path — Block C.
- **TalkBack** (Android) Actions-sheet path — Block D.
- Both need a human on a real device; the automated suite verifies the button's accessible
  name and its `/support` destination, which is **not** the same claim.

---

## Gate criterion — frame rate is RELATIVE, not absolute (ruled 2026-09-09)

> **Gate criterion is hub cost relative to the device's idle baseline, not an absolute fps.
> Pass = fan-open fps >= 0.9 x idle baseline on the same device.**

**Galaxy S24: WAIVED at 29.9 fps.** Measured baseline with the hub idle and no fan open:
**30.1 fps** (session `9c6649862a1e14ac226f038584a9bd3335eef895`). Pixel 8 on the identical
build: **60.3 fps**. The S24 unit is an **Exynos 2400 / Xclipse 940** under
`ANGLE ... on Vulkan 1.3.231`, Chrome 149 — a 30 Hz ceiling that exists before any hub
surface is drawn. An absolute >=45 gate would have recorded a device characteristic as a
product regression.

⚠️ Isolation conditions ii-v (blur on/off, canvas hidden) remain **INCONCLUSIVE** — the
harness's own fan-open check failed on all four, so they did not hold the condition they
name. Re-run in run 3 only if that check can be made to hold; otherwise drop them. Detail in
`41-phase2-diagnostics.md`.

---

## RUN 4 pass A (2026-09-09 05:52) — INCOMPLETE: BrowserStack quota exhausted

⛔ **Three of four devices could not start a session: `Automate testing time expired.`**
`GET /automate/plan.json` reports `automate_plan: "Free"` with `parallel_sessions_running: 0` —
so this is the plan's **total Automate minutes** allowance, not a concurrency limit. It is an
account limit and cannot be worked around from here: run 4 needs either a plan upgrade or the
quota window to roll over.

Only **iPhone 15 Pro** got a session. Recorded as INCOMPLETE, never as a matrix.

Port guard verified first; **snapshot-compare CLEAN** as the first line and again after.

| Check | iPhone 15 Pro (iOS 17) | SE 3rd · S24 · Pixel 8 |
|---|---|---|
| Hub mounts | ✅ | ⛔ no session |
| Ring 0 — 10/10 | 🔴 **9/10** (miss #1 stayed on `/dashboard`) | ⛔ |
| **Ring 1 — 10/10** | ✅ **10/10** — first inner-ring pass ever recorded on iOS | ⛔ |
| Sticky fan 10/10 | 🔴 0/10 | ⛔ |
| Flick ≥8/10 | 🔴 0/10 | ⛔ |
| Right-edge swipe → 0 actions | ✅ (and no longer vacuous — the gesture now lands) | ⛔ |
| Keyboard hides hub | 🔴 threw (stale element) | ⛔ |
| **`/charts` pad hit-testable** | ✅ **topmost at 0/500/2000/7000 ms AND after a 100px pan** (canvases 15→15) | ⛔ |
| `/charts` scrim band | ✅ scrim bottom 482px of 659px; clearance 177px | ⛔ |
| Actions → Feedback → `/support` | ✅ | ⛔ |
| Toolbar clearance ≥68px | ✅ 68px | ⛔ |
| Frame rate (relative gate) | ✅ **59.9 fan-open vs 56 idle = 107%** (pass ≥90%) | ⛔ |
| Role gating — admin sees, member does not | ✅ | ⛔ |
| Five screenshots | ✅ captured | ⛔ |

Session: `iphone-15-pro` — see `results/iphone-15-pro.json`. Pointer calibration for this
session measured `{dx: 0, dy: 59}`.

### What this run does settle

- **The `/charts` fix holds on a real device, including through re-composition.** The pad is
  topmost at every sample **and after a 100px canvas pan** — precisely the case flagged as able
  to pass every earlier check and still fail for real users. It does not fail.
- **The iOS transport works.** Ring 1 at 10/10 is the first inner-ring pass ever recorded on
  iOS; ring 0 reached 9/10.
- **The relative FPS gate behaves as intended** — 59.9 against a 56 idle baseline measured in
  the same session.

### Still open on iPhone 15 Pro — and NOT attributed

- **Sticky fan 0/10 and flick 0/10**, while the iPhone SE scores 10/10 on both. Both now run the
  same calibrated pointer path, so the wheel-bug explanation no longer covers them.
  ⚠️ **Unexplained. It needs its own trace**, the way the sticky-fan 5/10 did — guessing here is
  how the previous wrong diagnoses started.
- **Ring 0 miss #1** — the first iteration stayed on `/dashboard`, the other nine passed. Smells
  like harness warm-up rather than product, **recorded as a guess, not a finding**.
- **Keyboard step threw** a stale-element error. It is the last step still using
  `driver.findElements` + an element handle — the exact pattern deleted everywhere else. Known
  harness defect.

### Harness defect found this run

**Five screenshots were written to `C:/uct-worktrees/...`, a directory that did not exist.** The
path walked up three levels from `__dirname`, but the harness lives in `C:/tools/hub-devicetests`,
which is **not** a sibling of the worktree, so the files landed outside the repo silently. The
path is now explicit and `HUB_REPO`-overridable, and the captured screenshots have been moved to
`docs/plans/joystick/screens/phase2/iphone-15-pro/`.

---

## RUN 2 (2026-09-08 23:40) — VOID. Not a result set.

⛔ **A SECOND SERVER WAS ON THE TEST PORT FOR PART OF THIS RUN.** At 23:52:03 a concurrent
session started `tools/local_backend_sandbox.py --port 8077` while the hub sandbox was
already serving on 8077; Windows allowed the second bind, and the phones were driving an
unknown server through the tunnel from that moment. Run 2 spans 23:40–23:54.

**No row from run 2 is reported as a finding.** Full analysis, including the per-device
timeline and the tells, is in `41-phase2-diagnostics.md`.

What survives from run 2, because it was measured BEFORE the collision and is corroborated
elsewhere:

| claim | evidence |
|---|---|
| **F-1 fixed — the hub mounts on iPhone** | iPhone 15 Pro / iOS 17.3.1 `3e883f42…` and iPhone SE 3rd gen / iOS 16 `165bd12d…`, both `hub expected to mount: mounted` |
| **iOS 16 version floor verified POSITIVELY** | the iOS 16 device mounts; run 1's iOS 15 check was vacuous under F-1 |
| **F-2 fixed — the inner ring is reachable** | Galaxy S24 `00441e0a…`: ring 0 **10/10**, ring 1 **10/10**, flick **10/10** — the first inner-ring selections this project has ever recorded |

Everything else awaits **run 3** on a dedicated port. The guard that makes run 3 trustworthy
(`hub_sandbox_boot.py` refuses a busy port) did not exist when run 2 ran.

---

## RESULTS — run 1, 2026-09-08 (Selenium/Appium via BrowserStack Automate)

**Transport: Selenium, not Playwright.** BrowserStack's real-device cloud is
Appium/Selenium-backed; Playwright there reaches desktop and *emulated* mobile only, and
an emulator cannot answer these questions — it has no collapsing Safari toolbar, does not
apply `env(safe-area-inset-*)` against real hardware, and does not reproduce Android's
edge-gesture claim. The spec's acceptance line says "on a real phone", so the device list
chose the transport.

**Data-root integrity: CLEAN for every run below** (53 databases content-hashed before
boot, at +15 s, at +120 s and after the suite). Logs in `sandbox-runs/`.

Harness: `C:\tools\hub-devicetests\tests\` · orchestrator `scripts/run-phase2.ps1` ·
raw JSON per device in `C:\tools\hub-devicetests\results\`.

### 🔴 F-1 (BLOCKER) — the hub never mounts on ANY iPhone

**Session:** `4698156a4117c298272974663583bc359eea4e0d` (iPhone 15 Pro, iOS 17.3.1)

`useHubActive()` gates on `CSS.supports('backdrop-filter', 'blur(1px)')`. Measured on the
device:

| gate | iPhone 15 Pro (iOS 17.3.1) | Pixel 8 (Chrome 149) |
|---|---|---|
| `backdrop-filter` (unprefixed) | **`false`** | `true` |
| `-webkit-backdrop-filter` | `true` | `false` |
| `visualViewport` | `true` | `true` |
| `(max-width:1023px) and (pointer:coarse)` | `true` (393×659) | `true` (411×808) |

**Every other gate passes.** iOS Safari implements the property only under the `-webkit-`
prefix, so the capability floor rejects the entire iOS platform — for a control that is
**mobile-only by design**. `hub-root` count on iOS: **0**.

⛔ **This also makes the iPhone SE 2022 (iOS 15) check vacuous.** That device's assertion is
inverted — the hub must *not* mount below the iOS 16 floor — and it "passes" today for the
wrong reason: the hub is absent because of F-1, not because of the version floor. A test
that cannot distinguish the two proves neither, so **the iOS 15 floor remains UNVERIFIED**
and is recorded that way rather than as a pass.

*Not fixed in this run — the gate rule is "if any step fails, do not modify hub code".*

### 🔴 F-2 — the ring boundary is 19.2px; the bubbles are painted at 96px and 150px

**Session:** `538bc4785e17d6bebd1580a9ad51c7debe8426e7` (Pixel 8). Measured, firing three
Home actions with a continuous drag along each action's own rendered angle:

| aimed at | ring | landed on | |
|---|---|---|---|
| `home.scan` | 0 | `/screener` | ✅ |
| `home.chart` | 0 | `/charts` | ✅ |
| `home.journal` | **1** | **`/screener`** | ❌ |

The arithmetic behind it:

```
ringSplitPx = TRAVEL_PX × RING_SPLIT = 24 × 0.8 = 19.2 px
ringForDistance(d) = d >= 19.2 ? 0 (outer) : 1 (inner)

FAN_RADIUS_INNER = 96 px      <- where ring-1 bubbles are DRAWN
FAN_RADIUS_OUTER = 150 px     <- where ring-0 bubbles are DRAWN
```

Selecting an inner-ring action requires releasing inside a **9.2px-wide annulus**
(`openAtPx` 10 → 19.2), while the bubble the user is aiming at is painted **five times
farther out**. Drag toward the Journal bubble — the obvious interaction — and you get
Screener, silently and repeatably.

This is not a crash; the model is coherent (distance = *knob* travel, not fan radius, and
`fanGeometry.js:4` is explicit that selection is by wedge angle, never by hit-testing a
bubble). But **the visual affordance and the control model disagree**, and the three
ring-1 Home actions — Journal, Notebook, Calendar — are the ones that pay for it.

⚠️ **Owner decision, not an engineering one**, which is why it is recorded rather than
patched: either the ring bands scale to the drawn radii, or the bubbles move to the bands.
A 9.2px target is also hard to reconcile with the motor-accessibility settings in §C2 —
the tremor user who *lowers* `travelPx` to 16 gets a band of 6.7 → 12.8px.

### Pixel 8 — Google Pixel 8, Android 14, Chrome 149

**Session:** `36a8370467f33da86116f04f3ad170b85f7691f8`

| # | Check | Result | Evidence |
|---|---|---|---|
| B1 | Hub mounts on a supported device | ✅ PASS | `hub-root` present and displayed |
| B2 | 10× consecutive — ring 0 (`home.scan`) | ⚠️ see note | fires correctly (probe: → `/screener`); the 10× loop's own assertion is unsound — see H-3 |
| B3 | 10× consecutive — ring 1 | 🔴 FAIL | F-2: aiming at a ring-1 bubble fires a ring-0 action |
| B4 | Sticky fan survives jitter ×10 | 🔴 FAIL | **5/10** stayed open |
| B5 | Flick selects (≥8/10) | ⚠️ UNSOUND | same assertion defect as B2 (H-3) |
| B6 | Right-edge swipe fires nothing | ✅ PASS | `data-hub-last-action` empty after a 120px inward swipe from x=w−2 |
| B7 | Hub hides while keyboard is open | ⬜ INCONCLUSIVE | soft keyboard never raised (`visualViewport` 464 vs `innerHeight` 463) — harness could not create the condition |
| B8 | `/charts` scrim excludes the bottom band | ⬜ INCONCLUSIVE | the fan did not open on `/charts`; the scrim was never tested. Open gesture on that route needs its own investigation |
| B9 | Actions sheet → Feedback → `/support` | ✅ PASS | reached `http://bs-local.com:8077/support` |
| B10 | Pad clears bottom chrome ≥68px | ✅ PASS | **92px** below the pad (808px viewport) |
| B11 | Frame rate during a sustained drag | ✅ PASS | **59.6 fps** (target ≥55, gate floor 45) |

### iPhone 15 Pro — iOS 17.3.1 Safari

**Session:** `4698156a4117c298272974663583bc359eea4e0d`. **All checks BLOCKED by F-1** — the
hub does not mount, so nothing downstream is measurable. No result is recorded for B2–B11
on iOS; they are untested, not passed.

### iPhone SE 2022 (iOS 15) · Samsung Galaxy S24 (Android 14)

**NOT RUN.** Deferred deliberately: the SE's only assertion is vacuous while F-1 stands
(see above), and re-running the S24 before F-1/F-2 are ruled on would spend sessions
re-measuring a fan whose selection model is under review. Both run in the next pass.

---

## Harness defects found and fixed during this run

Recorded because each one initially presented as a product failure, and reporting any of
them as such would have been a false finding.

- **H-1 · stale element handles.** The pad element was captured once outside a loop whose
  every pass ends in a page reload, producing ten `StaleElementReference` throws that read
  exactly like a broken gesture. Re-found every iteration.
- **H-2 · a vacuous open-check that scored a false PASS.** "Is the fan open" was
  `document.querySelectorAll('[data-action-id]').length > 0`. `HubFan`'s own JSDoc says
  *"Bubbles are always in the DOM … `open` only toggles the wedge backdrop's opacity"* — so
  that predicate answers *"is the hub mounted"* and is **true whether the fan is open or
  shut**. It scored sticky-fan **10/10**; the honest signal (`HubScrim`, the only piece
  that returns `null` when closed) scores it **5/10**. ⭐ The first number was not a
  measurement, and it was the one that looked good.
- **H-3 · reading the evidence after it was destroyed.** `data-hub-last-action` is read
  *after* the gesture, but a `navigate` action replaces the document — so the attribute is
  `null` on a **successful** fire. The 0/10 results were the assertion failing, not the
  product: firing `home.scan` and `home.chart` demonstrably lands on `/screener` and
  `/charts`. **The B2/B5 assertions must key off the resulting URL** (or read the attribute
  synchronously before navigation) before those rows mean anything. Not yet rewritten.
- **H-4 · a split gesture delivers no movement.** Opening and aiming in two separate
  `perform()` calls left `useJoystick` holding the position from the opening push (~42px at
  45°, outside `QUADRANT_DEG` [60,210]) — so `resolveTarget` returned `null`, nothing fired,
  and `stickyFan` left the fan open, which is indistinguishable from "the product ignored
  the selection". One continuous sequence with ten interpolated moves; Appium delivered only
  **two** `pointermove` events for a single long move.
- **H-5 · a scripted `focus()` does not raise a soft keyboard.** Mobile browsers require a
  real gesture. The step now taps the input, and reports INCONCLUSIVE when
  `visualViewport` shows the keyboard never came up rather than scoring a failure.
- **H-6 · login died with "unknown server-side error" on iOS.** A successful login redirects
  off `/login`, destroying the execution context an open `executeAsyncScript` callback
  belongs to. Reworked to fire-and-poll.

⭐ **INCONCLUSIVE is now a first-class outcome** in the runner, separate from PASS and
FAIL. Counting a harness limitation as a product failure is how a test defect gets "fixed"
in product code; counting it as a pass hides an untested claim.

---

## 0. Preconditions — resolve these BEFORE running any block

### 0.0 ⛔ INCIDENT (2026-09-08) — the first sandbox boot wrote to LIVE `C:\data`

**Read this before running the sandbox. It is fixed and verified, but the failure shape
is the reason every step below insists on evidence rather than assumption.**

The first `hub-sandbox.ps1` boot at 22:04 wrote into the owner's production data while
reporting a clean startup and a healthy `/api/health`:

| Live file | Written at | What it is |
|---|---|---|
| `C:\data\auth.db` | 22:04:46 | 1.01 GB, ~20,640 real members |
| `C:\data\desk.db` | 22:04:23 | Desk sessions |
| `C:\data\flow.db-shm` / `-wal` | 22:04:16 | Options flow tape |
| `C:\data\buzz.db-shm` | 22:04:16 | Ticker-mention board |

**Root cause: `DATA_DIR` is not the authority, and the script set only `DATA_DIR`.**
There are **72** environment variables naming paths inside the shared root, and they
resolve *independently*. `api/services/auth_db.py:10` is the whole class in one line:

```python
_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")
```

No `DATA_DIR` in it. `/data` is a real directory on this box, so the default resolved to
`C:\data\auth.db`. **Nothing failed and nothing warned** — which is precisely the hazard
the script's own header claimed to defend against. The guard it *did* have (refusing
`-DataDir C:\data`) was real, and irrelevant: the sandbox path was correct and 71 of the
72 vars ignored it.

A second defect in the same file: the kill-list set **`BARS_PREWARM_DISABLED=1`, a name
that matches nothing in the codebase** — invented, never verified. The bars seeder is
gated only by `USE_REMOTE_BARS`, so it ran (`[seeder/t2-D] starting — 3160 jobs`).

#### The fix — derived, not typed

`scripts/hub-sandbox.ps1` now builds the frontend and hands off to
**`scripts/hub_sandbox_boot.py`**, which:

1. **Derives all 72 pins by AST** from `api/**` via `conftest.shared_data_root_census()`
   — the same census the pytest suite has used since `e86ad6d5`, with its own rails in
   `tests/test_shared_data_root_guard.py`. The sandbox and the test suite now cannot
   drift, and a `/data` literal added tomorrow is pinned the day it lands. ⛔ Restating
   the list here would recreate the second-authority defect that caused the incident.
2. **Arms the tripwire.** Importing that conftest wraps `sqlite3.connect`, `open`,
   `io.open` and `os.makedirs/mkdir/remove/unlink/rename/replace` so any write inside
   `C:\data` raises *and is recorded*. A redirect alone cannot cover default-argument
   sites (`def __init__(self, db_path="/data/flow.db")`) — they read no env var, so
   there is nothing for a pin to move.
3. **Reports the records.** A daemon thread's raise goes to `threading.excepthook` and
   vanishes, leaving a server that looks healthy — so the launcher prints a
   `SHARED-ROOT WRITE BLOCKED` banner with the thread and stack. The record is the
   guard; the raise is not.
4. Sets `USE_REMOTE_BARS=1` (the *only* gate on the seeder) and `BARS_PREWARM_ENABLED=0`.

#### Verification — measured, not assumed

Snapshotted all **8,626** files under `C:\data` (path, size, mtime), booted the fixed
launcher, and re-compared **155 s after boot** so the ~60 s and ~75 s darkpool /
industry-map / ticker-logos prewarms had all fired:

```
NEW files     : 0
CHANGED files : 0
  C:\data IS STILL UNTOUCHED.
```

Zero `SharedDataRootWrite` records — the redirect was complete enough that the tripwire
never had to fire. Positive control that the sandbox is genuinely in use: the launcher
logged `[auth] Migrated: added email_verified column to users` (a fresh-schema path) and
`C:\data-hubtest\auth.db` is **2.3 MB**, not the live 1.01 GB.

**Damage assessment on the live files:** `PRAGMA quick_check` = `ok` on `auth.db`,
`desk.db`, `flow.db`, `buzz.db`. `users` = 20,664 with the newest row dated 2026-09-05,
three days before the incident, and **0 rows matching `hubtest`** — the writes were
idempotent schema-init (`CREATE TABLE IF NOT EXISTS` + `ALTER`) and WAL churn, not data
mutation. No member data was altered.

⚠️ Note for anyone probing live SQLite: opening a WAL database **read-only still rewrites
its `-shm` index**, so a `mode=ro` probe changes mtimes. Judge a leak by the *main* `.db`
file, not by `-shm`.

---

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

---

## MANUAL SCREEN-READER CHECKLIST — for Patrick, in BrowserStack Live

⛔ **These cannot be automated and are not covered by any row above.** The suite checks the
Actions button's **accessible name** (`aria-label` ending `" actions"`) and that it reaches
`/support`. That is not the same claim as "a screen-reader user can operate the hub" — it says
the label exists, not that the reading order, focus handling and gestures work. Everything below
is unverified until a human runs it.

Run these in **BrowserStack Live** (not Automate — Live is the interactive one), against the
same local sandbox through the tunnel.

### A. VoiceOver — iPhone 15 Pro, iOS 17

**Turn it on:** in the Live session, tap the **device settings / gear** icon in the left toolbar
→ **Accessibility** → **VoiceOver** → On. (If the toolbar has no Accessibility entry on this
device, use the device itself: **Settings → Accessibility → VoiceOver → On**.)

1. With VoiceOver on, load `/dashboard` and **swipe right** repeatedly from the top of the page
   until focus reaches the hub. **Record how many swipes it takes** — the hub should be reachable
   without exhausting the page.
2. Confirm the Actions button announces as **"&lt;mode&gt; actions"** (e.g. "Home actions") and as a
   **button**, not as an unlabelled element.
3. **Double-tap** to activate it. The Actions sheet must open and VoiceOver focus must move
   **into** the sheet.
4. Swipe through the sheet and confirm **every action announces its label**, and that a disabled
   action announces as **dimmed / unavailable** (this is what `aria-disabled` is for — a CSS-only
   dim would be silent here).
5. Find **Feedback**, double-tap, and confirm it lands on `/support`.
6. **Escape gesture** (two-finger Z scrub) and confirm the sheet closes and focus returns
   somewhere sensible, not to the top of the page.
7. Confirm the **pad itself is not announced as an interactive control** the user is invited to
   double-tap — it is a gesture surface, and the Actions sheet is the accessible door to it
   (spec §C2, the WCAG 2.5.1 single-pointer path).
8. Turn VoiceOver **off** before ending the session.

### B. TalkBack — Google Pixel 8, Android 14

**Turn it on:** device settings → **Accessibility** → **TalkBack** → On. (On BrowserStack Live,
the gear icon in the left toolbar exposes the device Settings app.)

1. With TalkBack on, load `/dashboard` and **swipe right** repeatedly until focus reaches the hub.
   **Record the swipe count.**
2. Confirm the Actions button announces as **"&lt;mode&gt; actions", button**.
3. **Double-tap** to activate. The sheet opens; confirm focus moves into it.
4. Swipe through and confirm **every action announces its label**, and a disabled action
   announces as **disabled**.
5. **Feedback → double-tap →** confirm `/support`.
6. **Back gesture** (swipe down-then-left) closes the sheet; confirm focus is not lost to the top
   of the page.
7. Confirm the pad is not presented as a double-tappable control (same reasoning as A7).
8. Turn TalkBack **off** before ending the session.

### Recording the result

Write **PASS / FAIL / NOTES** per numbered step directly under this checklist, with the device
and OS version. ⚠️ A step you did not run is **blank**, never a pass — the whole point of this
section is that the automated rows above cannot speak for it.
