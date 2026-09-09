# The inherited-red ledger — the full frontend suite on `master`

**Measured 2026-09-09** on `notebook-primary-platform`, whose only difference
from `origin/master` (`78ac8016b`) is Wave Q1 work.

```
Test Files   8 failed | 1164 passed | 1 skipped  (1173)
     Tests   9 failed | 16899 passed | 9 skipped (16917)
journal-2-0 alone: 227 files / 2365 tests — ALL GREEN
```

## Why this file exists

The last two Wave Q sessions each spent real time proving their own work was not
the cause of a red they inherited — and the `NoteEditorPage.durable.test.jsx`
red had been sitting on `master` since the activation rollback with **nobody
owning it**, because there was nowhere to write it down. A list is cheap. A
mystery is not.

⛔ **"Did my change cause this?" is answered with `git show <sha>:<file>` and
`git log -1 -- <file>`, never with `git status`.** Every row below was blamed
that way. Note that one offender (`CaptureDialog.module.css`) sits *inside*
`journal-2-0` and is still not Wave Q's — a working-set argument would have
mis-assigned it.

⛔ **Repo-green must never be claimed.** Report `journal-2-0` and the full suite
as two separate numbers, always.

## The ledger

| # | Failing test | Offending file | Blamed to | Wave Q? |
|---|---|---|---|---|
| 1 | `src/__tests__/sourcesAreText.test.js` — "contains no NUL or other C0 control byte" | `pages/optionsFlow/wiring.guard.test.js` — two `0x08` bytes at 18747 / 18773 | `9dff9dae0` (2026-09-08) *"fix: the post-paint fetch was disabled by its own guard"* | **No** — OptionsFlow, partner-owned area |
| 2 | `src/components/screener/reachable.test.js` — "every module under app/src is REACHABLE" | 19 modules: `floor2/main.jsx`, `hub/contracts.js`, `lib/chatStreamManager.js`, `charts/widgets/DockFundamentals.jsx`, `pages/community/AckGate.jsx`, … | `cc195e888` (The Floor, 2026-09-03) · `2d8373449` (joystick hub PR #100, 2026-09-09) · `1a1066a23` (2026-07-11) | **No** — community redesign + joystick hub |
| 3 | `src/styles/tapFloor.test.js` — "no stylesheet declares a finger target on the PHONE only" | `journal-2-0/components/notebook/CaptureDialog.module.css: .actions` | `5d3f5f1be` (2026-09-08) *"Wave L Slice 2 CLOSED: phone-width certified"* | **No** — Wave L, and **byte-identical to `origin/master`** |
| 4 | `src/hooks/pollingSites.rail.test.js` — "no NEW bare polling site" | `chart/useBoundDrawingAlerts.js` (1) · `floor2/hooks/useFloor.js` (5) · `hooks/useWatchlistIntelligence.js` (1) | `2d3b2d555` (MOB-05, 2026-09-08) · `cc195e888` (The Floor) · `22452cff7` (Seam 8, 2026-09-07) | **No** — charts / community / evidence seams |
| 5 | `src/components/chart/engine/ast/manifestProse.test.js` — "every key the product READS survives the strip" | manifest key `_session` | `b280131b8` (2026-08-29) | **No** — Pine manifest |
| 6 | `src/components/chart/engine/ast/pine.blindCorpus.test.js` — "the accepted floor moves one way too" | 21 accepted vs `ACCEPT_FLOOR` 28 — a **ratchet threshold**, not a broken file | `b1a901970` (2026-09-04) | **No** — Pine corpus ratchet |
| 7 | `src/pages/ThemeTrackerPage.chartmount.test.jsx` — 2 tests, "Unable to find an element with the text: AAPL" | `pages/ThemeTrackerPage.jsx` render path | test last touched `7adfdda2b` (2026-08-05) | **No** — Theme Tracker |
| 8 | `src/components/chart/builder/ImportBox.thinkscript.test.jsx` — "it DECLINES while the box is one keystroke behind" | ⚠️ **line endings**: the committed test asserts `\r\n`, the code produces `\n` | `d4d5ec00f` (2026-09-01) | **No** — and likely **environment-specific**, see below |

## Two notes worth carrying forward

**Row 8 is probably not a real defect.** The committed test source contains
literal CR bytes, so it asserts CRLF while the code under test emits LF. That is
a Windows-checkout artifact (`core.autocrlf`), and it may well be green in a
Linux CI. ⛔ Do not "fix" it by changing the code to emit CRLF — check the
checkout first.

**Row 6 is a ratchet, not a breakage.** `ACCEPT_FLOOR` is a floor somebody
raised to 28 while the corpus currently accepts 21. It fails by design when the
number regresses; whether 21 is a regression or the floor was set optimistically
is the Pine wave's call, not this one's.

## Does any of these block the Wave Q1 canary?

**No.** The §15 canary exercises the Notebook's offline sync path in a
production browser. None of the eight touches that path — the closest,
row 3, is a touch-target rule on a different Notebook dialog. They are also
**already red on `master`**, so deploying Wave Q1 neither creates nor worsens
them.

⚠️ What that does mean: **a green full-suite run is not available as a deploy
gate on this branch.** The gate is `journal-2-0` green (227 / 2365) plus this
ledger being unchanged — same eight, same offenders.
