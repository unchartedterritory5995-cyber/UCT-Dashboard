# Capture queue — 2026-10-31 P3 WS-F, the realtime model on a forming bar

Branch `feat/pine-p3-wsf`. One new probe (never compiled here). It needs the **owner during
market hours**: no historical capture can show a tick, because history runs each bar once.
Rig: `tools/vendor_harness/tv_capture.js` does not read intrabar updates, so this one is read
off the data window by hand (or by a capture script that polls it), as below.

## Why

WS-F made `varip` lower on this lane and added the producer for `barstate.isnew`
(`runtimeColumns.js`, the realtime ledger; `pineRuntimeClock.js::isNewByBar`). The rules it
implements are railed by replaying a chart's life (`runtimeRealtimeTicks.test.js`), but each
rule is pinned **by reading the Pine manual, not by a capture**:

| rule (PHASE3-RUNTIME-PLAN.md 3.2) | lane | witnessed? |
|---|---|---|
| `var` and plain variables roll back to the previous close on every tick | the checkpoint resume (never checkpoints a forming bar) | **unverified**: no realtime capture |
| `varip` keeps each update of the forming bar | the ledger restores `varip` slots from the previous update | **unverified** |
| the bar CLOSE is one more execution of the closed bar | the lane learns the bar closed from the next fetch and runs it confirmed once | **unverified** |
| `varip [1]` on the next bar is the closed bar's last value | as above | **unverified** |
| `barstate.isnew` is 1 on history and on a bar's first tick only | `isNewByBar` (the name stays refused: `closedTable.json::_barstate.refused.isnew`, an owner ruling) | **unverified**, and not served |

On history `varip` equals `var` (each bar runs once), so a historical capture of a script with a
top-level `varip` grades like any other; only the forming bar needs this probe.

## Q-WSF

| # | capture | settles |
|---|---|---|
| Q-WSF1 | `tools/visual_conformance/probes/vw-wsf-realtime-var-varip.pine`, a liquid symbol, **1m**, market hours, mid-bar (forming): data window for the last 4 bars | R01 rolls back (== bar_index + 1 on every bar, forming included); R02 on the forming bar = R02 of the previous bar + the number of updates so far; R03 = 0 after the first tick |
| Q-WSF2 | same chart, right after a bar closes | R02 of the closed bar counts its closing update (one more than its last mid-bar reading, or not); R04 = 1 on it |
| Q-WSF3 | same chart, the next bar's first tick | R05 = the closed bar's final R02; R03 = 1 |
| Q-WSF4 | reload the chart (F5) and read the same bars | R02 history is recomputed as `var` (== R01) after a reload |

Record the tick count per bar where the rig can (TradingView's "Bar replay" does not stream
ticks; it must be the live chart). A reload inside the window (Q-WSF4) is itself a reading.

## What lands when it is captured

- Q-WSF1 to Q-WSF3 match: the realtime rows of PHASE3-RUNTIME-PLAN.md 3.2 move from "holds by
  construction" to witnessed, and `runtimeRealtimeTicks.test.js` cites the capture instead of
  the manual.
- Q-WSF2 shows the close is NOT a separate execution: the ledger's `confirmed` entry must stop
  counting the closing run (`runtimeColumns.js::realtimeRun`, `commit`).
- Q-WSF3 matches: `barstate.isnew` can be offered to the owner for un-refusing (WS-B owns the
  name, this workstream its semantics).
- The lane's tick cadence is whatever the bars feed delivers (one update per fetch): a capture
  with more ticks per bar than this app's feed delivers will show a larger R02 on TradingView.
  That is a feed difference, not a lane defect, and is stated rather than graded.

## Known limits to review before arming (not capture-dependent)

- The realtime ledger is bounded at 32 MB across all scripts (`runtimeColumns.js`,
  `LEDGER_BYTE_CAP`). A script whose ledger is evicted resets SILENTLY: its pane shows the
  `var` value again on the next run, with no notice to the member.
- A forming bar remembers at most 1,024 prices or 4 MB of `varip` snapshots (`SEEN_CAP`,
  `SEEN_BYTE_CAP`). With very large `varip` values (a big array) only a few prices fit, so the
  protection against a lagging pane or a stale refetch shrinks to those few.
- A price that truly returns to an earlier value on the same bar is read as a replay of that
  earlier update (shows its old value, not counted); past the caps a forgotten price counts once
  more than Pine would.
- `varip` is refused by name on a sliding window: a `calc_bars_count` window and an indicator
  computed on another timeframe's bars (a framed instance).
