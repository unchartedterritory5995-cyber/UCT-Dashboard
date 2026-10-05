# Capture round 6 (CAP6) - 2026-10-05 00:14 local (Sunday night), branch `pine/cap6-captures`

Base `origin/pine/h11-cap5-findings` (`6f0d4f5326`). Procedure: `capture-round-5-runbook.md` § 1 and § 6
(source by sha from raw.githubusercontent at a pinned commit, `tv_capture.js` as a `blob:` script, clipboard
chunk + id check, `verify_capture.mjs --assemble`). The market-hours block is not run (Sunday night).

## Status: STOPPED AT THE VISIBILITY GATE - no capture taken

| reading (the new tab, 603438063) | value |
|---|---|
| `document.visibilityState` | `"hidden"` (4 reads over ~3 min) |
| `document.hasFocus()` | `true` |
| `requestAnimationFrame` | never fired within 1,500 ms (2 reads) |
| `screenX / screenY`, `outerWidth x outerHeight` | -24 / -1080, 1934 x 1039 (a maximised window) |
| `screen.availLeft / availTop / availWidth / availHeight` | -1937 / -1080 / 3840 / 1032, `isExtended` true |
| chart | `AMEX:SPY`, `5`, 300 bars, 0 studies, no "Session disconnected" text |

This is the "hidden AND hasFocus" row of `capture-procedure.md` § "A THIRD WAY A CAPTURE WINDOW GOES
DARK": the window geometry is on the upper display (y -1080 .. -41, the usual 7-8 px of a maximised frame),
so the likely cause is the display itself being off / asleep or the window occluded - neither can be
fixed from this side, and the runbook's gate (§ 1 item 2) says nothing is clicked on a hidden tab
(CAP3 / CAP4 / CAP5 all lost adds to it). One click was spent before the read: the layout menu (below).

**Layout.** `tradingview.com/chart/` opened the rig layout `01f1AcIj` itself (a second tab on it; the
stuck tab 603438012 was not touched). The layout menu's "Create new layout..." opens a naming dialog, so it
was not used; the menu was closed with Escape and nothing on the layout was changed (symbol, resolution,
session, studies, editor all as loaded). The rig loads as **AMEX:SPY 5**, ETH control shown in the bottom bar,
editor holding the default `My script` template - that is the state to restore to after a CAP6 run.

**Owner:** bring the Chrome window holding the extension's tab group to the front on a display that is on
(the tab must read `visibilityState "visible"`), and leave it there; then the round below can run as-is.

## Prepared for the run (committed `624ded9b82`)

| probe | source | queue row |
|---|---|---|
| `vw-rt16-wrap-sessions.pine` (v6, NEW) | written from the row | Q-RT16a: SPY 60 ext ON, SPY 1D, a 24h symbol 60 |
| `vw-h10-frac-length-v5.pine` (NEW) | written from the row | Q-H10a: SPY 1D |
| `vw-h10-frac-length-v6.pine` (NEW) | written from the row | Q-H10b: SPY 1D |
| `vw-h10-whole-frac-length.pine` (NEW) | written from the row | Q-H10c: SPY 1D |
| `vw-rt12-statements-history-no-l03-l04.pine` | CAP5 probe minus rows L03 / L04 only | Q-RT12a/b re-capture: RDDT 1D, SPY 1D |
| `vw-rt14-language.pine`, `vw-rt14-legacy-max.pine` | byte-exact from `origin/pine/rt14-language` (sha `d8dd3974...`, `b592bfed...`) | Q-RT14a-c: RDDT 1D |

Corpus scripts named by the queues are already committed under `corpus/committed/`
(`ict-killzone-index-version__28962c02dd`, `volume-profile-auto-line-v2__b0e947fd20`,
`support-and-resistance__1505`, `rolling-vwap__043320bb57`, plus the RT14 d-g files).

No `capture-queue-2026-10-05-w19-*.md` and no `origin/pine/w19-*` branch existed at 00:20.

## Results table

| # | item | id written | bars | `startsAtBar0` | `verify_capture` | error (verbatim) | notes |
|---|---|---|---|---|---|---|---|
| S5-1 | M2 run A (ext ON) | NOT TAKEN | | | | | visibility gate |
| S5-2 | M8 part B | NOT TAKEN | | | | | visibility gate |
| S5-3 | M2 run B (ext OFF) | NOT TAKEN | | | | | visibility gate |
| S5-4 | rolling-vwap SPY 5 (optional) | NOT TAKEN | | | | | visibility gate |
| RT16a | wrap sessions x3 charts | NOT TAKEN | | | | | probe committed |
| RT16g | ict-killzone-index-version SPY 60 / 1D | NOT TAKEN | | | | | |
| RT16h | volume-profile-auto-line-v2 RDDT 1D / SPY 60 | NOT TAKEN | | | | | |
| H10a-c | fractional length | NOT TAKEN | | | | | probes committed |
| RT14a-g | language probes + 4 corpus | NOT TAKEN | | | | | probes copied |
| RT12 | re-capture without L03/L04 | NOT TAKEN | | | | | probe committed |
