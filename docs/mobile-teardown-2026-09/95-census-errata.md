# Errata against the frozen census

`ledger/TV_IOS_CENSUS_V1_FROZEN_2026-09-07.jsonl` is **frozen and is not edited**. That is the
point of freezing it: later verification lands in a V2 lane rather than silently moving V1's
denominator. Corrections therefore live here.

The independent adversarial review (`90-independent-validation.md`) confirmed the census's
**arithmetic is clean** — 434 rows, 0 parse failures, 0 duplicate ids, all four confidence
buckets and all eighteen per-area native/total pairs exact. Everything below is about **claims
inside rows**, not about counts of rows.

---

## E1 · Two non-TradingView rows sit inside the TradingView census

`UCT-TYPE-0001` and `UCT-REPLAY-0001` carry `census: TV_IOS_CENSUS_V1_FROZEN_2026-09-07` and
`conf: OFFICIAL_DOC_VERIFIED`, and they land in the TYPE and REPLAY denominators.

| stated in `20-census-freeze-v1.md` | TradingView-only recount |
|---|---|
| TYPE 5 / 14 = 35.7% | **5 / 13 = 38.5%** |
| REPLAY 12 / 19 = 63.2% | **12 / 18 = 66.7%** |
| core 133 / 372 = 35.7% | **133 / 371 = 35.9%** |
| evidenced 246 / 372 = 66.0% | **244 / 371 = 65.8%** |

**"434 rows" remains a true statement about the file.** The distinction that matters is
*432 TradingView interactions + 2 UCT comparison rows*, and per-area TradingView coverage should
be quoted from the right-hand column above.

## E2 · `UCT-REPLAY-0001` states a false universal negative

> *"UCT HAS NO BAR REPLAY ON ANY PLATFORM"* — `conf: OFFICIAL_DOC_VERIFIED`, sourced from three greps.

**False.** `origin/master:app/src/components/chart/ChartToolbar.jsx` ships replay. The correct
classification is **`DESKTOP_ONLY`** — the capability exists and the phone has no door to it
(`CMP-079`). ⛔ A universal negative ("on any platform") reached by grep is exactly the shape of
claim that needs an AST or a running product, and this one was wrong.

## E3 · `TV-IOS-SYMBOL-0054`'s UCT note is a phantom backlog item

> *"UCT's `MobileSymbolSheet` … does NOT set `autoCapitalize=characters` — a genuinely free win, effort ~1 line."*

**False.** `app/src/pages/charts/mobile/MobileSymbolSheet.jsx:108` sets
`autoCapitalize="characters"` (with `autoCorrect="off"`, `autoComplete="off"`,
`spellCheck={false}`, `enterKeyHint="go"`). `06-uct-current-mobile-baseline.md:86` reads the
same file correctly — the census row and the baseline doc disagreed and nobody diffed them.

## E4 · `TV-IOS-REPLAY-0008`'s paper-trading claim was never exercised

The row is `steps: 0`, `gesture: system`, action *"Observe the strip"*, and its own notes say
**"NOT EXERCISED - no buy or sell was pressed."** The freeze document's reversal #5 nevertheless
read *"Bar replay exists on mobile, **with paper trading**"*. **Established:** a
Sell/qty/Buy/Flatten strip renders during replay and changes enabled-state. **Not established:**
that it paper-trades.

## E5 · `TV-IOS-DRAW-0043` and `TV-IOS-ALERT-0024` are presence observations

Both are `NATIVE-VERIFIED (presence)` with the action *"observe the first item of the … menu."*
The alert was **never activated** from a drawing or an indicator. The only committed TradingView
alert (`TV-IOS-ALERT-0021`) is a **landscape** measurement, and the v1 parity matrix compared its
tap count against a UCT **portrait** measurement.

## E6 · "NATIVE_VERIFIED" often means *seen*, not *done*

Recounted across the 137 native rows: **74** have an action verb of *Observe / Read / Note*;
**31** are self-labelled `(presence)`; the gesture mix is `tap 88 · system 41 · typing 2 ·
long_press 2 · rotate 2 · drag 1 · swipe_v 1` — **6 of 137 exercise a non-tap gesture.**

This does not invalidate the census: a menu item observed on a real device *is* evidence the menu
item exists on a real device, and that was the census's stated job. It does mean **"native" is a
claim about where the observation happened, not about whether the task was completed**, and any
flow-level timing or completion claim built on such a row must say so.

## E7 · The `conf` field carried two products' tiers

The census's `conf` describes the **TradingView** observation, while many rows' `notes` carry a
**UCT** verdict — read from source — at the same apparent tier. Three of those UCT-side claims
are now known false: the alert pre-fill (the original ERRATUM in `20-census-freeze-v1.md`),
`autoCapitalize` (E3 above), and the `charts_mobile_sym` / no-named-layout family that carried
P9 (`60-p9-workspace-architecture.md`, `UCT-P9-DOCDRIFT`).

⭐ **This is the single structural lesson of the study.** One enum field was made to carry two
products' evidence, and UCT verdicts silently inherited TradingView's tier. The comparison
ledger built for deliverable B (`ledger/PARITY_COMPARISONS_V2.jsonl`) separates `tv_tier` from
`uct_tier` for exactly this reason — but it arrived at the end of the study rather than the
beginning.

## E8 · The 39-row must-verify queue is stale by at least seven

The V2 native session (`lanes/v2-native-iphone17-ios26.jsonl`,
`lanes/v2b-native-gestures-and-p2.jsonl`) natively resolved `CHART-0018`, `CHART-0023`,
`UNDO-0001`, `UNDO-0002`, `UNDO-0011`, `DRAW-0020` and `DRAW-0042`. `UNDO-0011` is the row §3
singles out as *"a contested row … worth more than five confirmations elsewhere"*, and V2
records it as a false negative. The parity matrix's §5 nevertheless still describes the 39 as
concentrated in *"the gesture layer … and the undo model"* — precisely the ones already closed.

## E9 · `ACCESS_BLOCKED = 0` in the freeze is falsified by the corpus

`20-census-freeze-v1.md` reports `ACCESS_BLOCKED | 0 | 0%` and calls A11Y *"testable … simply not
reached."* The V2 lane contains `TV-IOS-A11Y-0003` at `conf: ACCESS_BLOCKED` —
*"ACCESS_LIMITED ON THIS DEVICE - VoiceOver could not be exercised."* True of the frozen file;
false of the study.

## E10 · "One device, one session" is true of the file and false of the study

Every device string in the frozen file is iPhone 15 / iOS 17.5 / v2.139. But
`13-mobile-primitives-register.md`'s Addendum 1 is explicitly a **second** device (iPhone 17 Pro
/ iOS 26.6, landscape) and is used there to correct P1 and P8. The limitation should be stated as
*"the frozen census is single-device; the study is not."*
