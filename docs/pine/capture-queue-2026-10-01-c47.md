# Capture queue — 2026-10-01 C47

Branch `pine/c47-buildable`. Captures for the parent session to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js` — same procedure as `docs/pine/capture-queue-2026-09-28.md`
(visibility gate, **Create new ▸ Indicator**, "Add to chart" binding gate, `__uctVH.capture({...})`,
chunks, `verify_capture.mjs --assemble`).

What each would settle is in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` § C47.

## Q-C47-1 — `time("W")` in the listing's own partial week, on an equity

**Probe:** `tools/visual_conformance/probes/vw-time-tf.pine` (existing — no new probe).
**Chart:** `NYSE:RDDT` **1D**, history scrolled back until `requestMoreData` stops growing (the
listing day, Thursday 2024-03-21, must be bar 0 — record `history.startsAtBar0: true`).

**Why.** `high-low-open-mid-ranges` draws a session divider on every bar where
`ta.change(time(higherTF))` is non-zero. On the first Monday of RDDT's history (bar 2) that needs
`time("W")` on bar 1 — the anchor of a week whose calendar-first session (Monday 2024-03-18) has no
bar. The engine withholds that value (`time-anchor:session-open-missing`), so the divider on bar 2 is
not drawn, and one line of 504 is missing at the far end of the collected history
(`vendorHarness.c47OhlmDivider.test.js` holds the arithmetic: TradingView's ids are ours + 46 = the
45 table cells + exactly one more object, and one more line on bar 2 makes the run 504 of 504).

**What we must read off it.**

| row, on bars 0 and 1 (Thu 2024-03-21, Fri 2024-03-22) | shipped | what each answer means |
|---|---|---|
| T01 `time("W") - time` (days) | withheld | `-3` / `-4` ⇒ the calendar's Monday 09:30 even with no bar for it; `0` / `-1` ⇒ the first bar of the listing; `na` ⇒ no anchor before the first full week (then the divider on bar 2 would NOT fire, and the 504th line is something else) |
| T07 `newWeek` on bar 2 (Mon 2024-03-25) | not computable (needs bar 1's anchor) | `1` ⇒ `ta.change(time("W"))` is known and non-zero on the first week boundary of a listing |
| T02 / T03 `time("M")` / `time("3M")` on bar 0 | withheld | the same question for the month (opens Fri 2024-03-01) and the quarter (opens Tue 2024-01-02) |

**What it would move.** Lifts `time-anchor:session-open-missing` for the listing's first partial
period (or re-rules it), which is the last object `high-low-open-mid-ranges` is missing: lines
503 → 504 of 504, the script's objects verdict DIVERGE → MATCH.

## Q-C47-2 — a user function's default parameter value

**Probe:** `tools/visual_conformance/probes/vw-default-param.pine` (new).
**Chart:** `AMEX:SPY` **1D**, >= 200 bars. No inputs.

**Why.** C47 serves, in the drawing lane only, a trailing parameter that declares one literal
default and a call that leaves it off the end (`pine.js::functionParamDefaults`). The rule is Pine's
reference. The one committed capture that exercises it — pro-trading-art, `drawLL(..., style =
label.style_label_down)` called without the style — is consistent with it and does not separate it:
the declared default there is also `label.new`'s own. This probe uses defaults no built-in shares.

**What we must read off it.**

| row | shipped | what would falsify it |
|---|---|---|
| D01 / D02 `f_num(close)` vs `f_num(close, 7)` | `close * 7` on both | any other multiplier, or `na` |
| D03 / D04 negative default | `close - 3` on both | the sign lost |
| D05 / D06 `bool` default `false` | `-close` on both | `false` read as `na` or `true` |
| D07 / D08 string default | `close * 2` on both | the default not equal to its own text |
| D09 / D10 `na` default | `close` on both | `na` not `na` in the body |
| D11 / D12, D13 / D14 two defaults | `close * 2 + 3`; `close * 9 + 3` | the second default bound to the first's value; a given argument not winning |
| D15 | `0` on every bar | any pair differing |

**What it would move.** Nothing in the 47 by itself (liquidity-heatmap's labels stop next on a
lower-timeframe request). It turns the rule from "Pine's reference" into a measured one, which is
what would let the PLOT lane take such a function (today it stays `pine:function-def` there, so no
saved parameter id can move).
