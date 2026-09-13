# B3/B5 Journal device matrix (D1–D5) — RUN MANIFEST

**STATUS: BLOCKED. NO DEVICE EVIDENCE WAS GATHERED.** Not one check ran, and nothing below may be
read as a result about the product.

| | |
|---|---|
| Date | 2026-09-09 |
| Build under test | `e6e760950` (B5) — worktree clean at attempt time |
| Target | local hub sandbox, `http://127.0.0.1:8077`, over BrowserStack Local |
| Sandbox data dir | `C:\data-hubtest` (73 AST-derived env pins, tripwire `enforce`) |
| Suite | `C:\tools\hub-devicetests\tests\hubSuite.js` — `stepJournal*`, mirrored at `device-steps/journalSteps.copy.js` |
| Runner | `tests/run.js` with `HUB_JOURNAL_ONLY=1` |

## What happened

| Device | Session | Result |
|---|---|---|
| iPhone 15 Pro · iOS 17 Safari | never started | `Automate testing time expired.` |
| iPhone SE 3rd gen · iOS 16 Safari | never started | `Automate testing time expired.` |
| Samsung Galaxy S24 · Android 14 Chrome | never started | `Automate testing time expired.` |
| Google Pixel 8 · Android 14 Chrome | never started | `Automate testing time expired.` |

**The BrowserStack account's Automate allowance is exhausted.** Every device returned the same
message at session-creation time, so no browser opened, no gesture was performed, and no device
minute was spent on a real session. Credentials are present and valid — this is a plan/quota
condition, not an auth failure.

⚠️ **Live ≠ Automate.** `docs`-level guidance in CLAUDE.md describes BrowserStack **Live** (manual,
driven through a browser). This suite is **Automate** (selenium-webdriver against the BrowserStack
hub), which is a separately metered product. A Live seat does not fund Automate sessions.

## What this does NOT block

The B3 claim — one gesture, one sheet — is proved in jsdom through the **real HubRoot dispatch** by
`app/src/hub/journalSheetStacking.test.jsx`, mutation-proved (reintroducing `kind:'confirm'` on
`journal.moveStop` alone turns 3 of 5 red and leaves the other two green). The B5 claim — the
commit haptic — is proved through the **real `fireTarget` path** by `useJoystick.test.js`, one test
per action, mutation-proved per action.

## What it DOES block, and why it matters

**D4 is the check that has no substitute.** `journal.close` is `flickable: false`, and jsdom's
synthetic pointer cannot answer whether a real touch surface honours that guard. A gesture engine
that behaves under `dispatchEvent` can misfire on glass, and Close firing instead of fanning on a
phone is the failure this whole guard exists to prevent. **It remains unmeasured.**

⭐ Recorded before any run, so a later result confirms a prediction rather than rationalising an
outcome:

- **D4** — a flick at `journal.close` opens the fan, fires nothing, opens no modal.
- **D5** — a flick at `journal.moveStop` / `journal.breakeven` **fires**. Neither carries a
  `flickable` key (verified at `3ee5025af` and now), so `flickable !== false` is true. B3 changed
  *which* sheet a fire opens, never *whether* a flick fires.

## Collateral, disclosed

Loading `tests/run.js` to syntax-check it **executed** it — the file has no `require.main === module`
guard. That attempt overwrote `C:\tools\hub-devicetests\results\*.json` with the four expired-session
records above. Those were intermediate artifacts; the Phase 2 **record of record** is
`docs/plans/joystick/40-phase2-device.md`, which is intact and untouched (42 recorded PASS entries).
A `require.main` guard on that runner is filed as an open item.

## To run this when Automate is funded

```
# 1. sandbox (prints the snapshot-compare result FIRST; read it before anything else)
powershell -ExecutionPolicy Bypass -File scripts\hub-sandbox.ps1 -DataDir C:\data-hubtest -Port 8077
# 2. seed three positions (two real stops, one broker placeholder) — see the seed definition in the
#    session report; it writes only to C:\data-hubtest\auth.db and makes no external request
# 3. tunnel
powershell -ExecutionPolicy Bypass -File C:\tools\hub-devicetests\start-tunnel.ps1 -Port 8077
# 4. the matrix
cd C:\tools\hub-devicetests && set HUB_JOURNAL_ONLY=1 && node tests/run.js
```
