# `barstate.*` on UCT — defined from our clock and our data

> **barstate on UCT reflects UCT's clock and data; on TradingView the same flags depend on
> when the viewer opened the chart.**

That sentence is the whole page, and it is a deliberate divergence rather than a gap. This
document is the authority for what each flag means here.

---

## Why we do not match the vendor

Measured on a live TradingView chart across the 2026-09-09 US open
(`tests/fixtures/vendor/barstate-realtime-spy-2026-09-09.json`):

1. **The current bar flips at the open.** Pre-open on SPY 1D the newest bar is *yesterday's*,
   carrying `isconfirmed=1`, `islast=1` and `ishistory=1` **simultaneously**. At 09:30:14 a new
   bar appeared and both `isconfirmed` and `ishistory` went to 0.
2. ⛔⛔ **A closed bar is not stable.** Forty-six seconds *after* the 09:31 bar closed it still
   read `isconfirmed=1, islast=1, ishistory=0`, while the 09:30 bar — which arrived as
   server-side history — read `1, 0, 1`. **A bar that formed live keeps its realtime barstate
   after closing.**

So on the vendor these flags, on a *closed* bar, are a function of **when the viewer arrived**,
not of the bar. Two members opening the same script minutes apart get different columns for the
same historical bar.

⭐ **Matching that is impossible by construction and would be wrong to attempt.** A screener
column has no viewer and no arrival time. We define the flags from our own clock and our own
fetch, and we say so.

---

## The definitions

Per binding, per bar. `N` is the number of bars delivered by the fetch; bar 0 is the oldest.

| name | definition | window-dependent? |
|---|---|---|
| `barstate.islast` | true on the **newest delivered bar** | **no** — see below |
| `barstate.isrealtime` | true **iff** the newest bar's scheduled close time is `>` now | no |
| `barstate.isconfirmed` | `!isrealtime` | no |
| `barstate.ishistory` | `!isrealtime` — an **alias** of `isconfirmed` | no |
| `barstate.islastconfirmedhistory` | true on the newest bar whose `isconfirmed` is true | no |
| `barstate.isfirst` | true on **bar 0** of the delivered fetch | **yes** |
| `barstate.isnew` | ⛔ **refused** — see below | — |

**Only the newest bar can ever be realtime.** Every other bar is `isrealtime=false`,
`isconfirmed=true`, `ishistory=true`.

### ⭐⭐ Why `islast` is NOT window-dependent, and `isfirst` is

This corrects a ruling made in this file's own code. `BUILTIN_REQUEST_DEPENDENT` refused
`islast` on the grounds that *"a scan over 500 bars and the same scan over 5,000 disagree about
which bar is the last one"*. **That is false, and it conflated the two ends of the fetch.**

A fetch reaches **backwards from now**. Deepening it adds bars to the *old* end and never
changes which bar is newest:

```
500-bar fetch:            [older ......................... NEWEST]
5,000-bar fetch:  [much older ........................... NEWEST]   ← same bar
```

So `islast` names the same bar at any depth and is **not** window-dependent. `isfirst` names the
*oldest* bar, which moves with every change of depth, and **is** window-dependent — it carries
`window_dependent`, is refused by the five comparability consumers, and is permitted on the pane
with the disclosure.

⚠️ **The withdrawal is recorded, not silently reversed.** `islast` and `islastconfirmedhistory`
were refused by ruling; the refusal is withdrawn because the reasoning was wrong about which end
of the series moves. The fixture that motivated the re-examination is the vendor capture above.

### ⛔ `barstate.isnew` is refused, by name

> *requires per-tick evaluation; UCT evaluates once per bar.*

`isnew` is true on the **first tick** of a bar. There is no tick here — this engine evaluates a
bar once, when it has it. Any value we returned would be a claim about an event we never
observe. Revisit when realtime updates land.

⚠️ It previously folded to the constant `1`, which was wrong in the way that is hardest to see:
on a once-per-bar model *every* evaluation is arguably "the first", so `1` looked defensible and
would have been silently unfalsifiable.

### `ishistory` is an alias, deliberately

TradingView distinguishes `ishistory` from `isconfirmed` **by viewer arrival** — a bar that
formed under your session is confirmed but not history. We do not have viewers, so the
distinction has no referent here and the two are the same predicate. Documented rather than
faked.

---

## The clock and the calendar

**"Now" is the server clock in UTC.** A bar's scheduled close is computed from the symbol's
exchange session and the timeframe.

⭐ **The pipeline already owns the calendar, and the census found exactly one authority for each
half — no second authority to reconcile:**

| | authority | coverage | who defers to it |
|---|---|---|---|
| full closures | `api/services/bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD` | 2025 · 2026 · 2027 | `liveflow_monitor._full_closures`, `flow_gap_autofill`, `routers/market_calendar` |
| early closes (13:00 ET) | `api/services/liveflow_monitor.py::_NYSE_EARLY_CLOSES_YYYYMMDD` | 2025 · 2026 · 2027 | `flow_gap_autofill._session_end_min`, `voice_temporal_awareness` |

So **early closes and holidays are represented** and we use that source. Nothing is invented
here and no calendar is duplicated.

⛔⛔ **AND IT MUST NOT BE COPIED INTO JAVASCRIPT.** The engine's runtime is JS and the calendar is
Python. Restating the holiday set in JS would be a second authority over a value — the defect
this repo has paid for repeatedly. Instead the boundary carries **one boolean per fetch**:

```
newestBarIsForming  :=  scheduled_close(newest_bar, tf)  >  now
```

computed where the calendar already lives, and handed to the runtime. Every flag above is then a
pure function of `(bar index, N, newestBarIsForming)` — no clock and no calendar inside the
runtime at all.

### Scheduled close, by timeframe

- **intraday** (`1`, `5`, `15`, `30`, `60`): `bar_open + interval`. Needs no calendar — an early
  close simply produces no further bars.
- **daily**: the session end on that bar's ET date — `16:00` ET, or `13:00` on an early close.
- **weekly / monthly**: the session end of the **last trading day** of that period, which is
  where the full-closure set is required.

### Known gap, named rather than papered over

⚠️ The closure sets run to **2027**. Past that, `isrealtime` on a D/W/M bar falls back to the
regular session and may read `true` for up to one session on a holiday or early close. The sets
carry a standing instruction to refresh annually from `nyse.com/markets/hours-calendars`; this
page is a second consumer of that instruction.

### Extended hours

The bars pipeline delivers regular-session bars. That is an **assumption with a test**, not a
belief: if extended-hours bars ever appear, the session-boundary logic is wrong, and the test
that pins it fails loudly on that day rather than silently mis-flagging the newest bar.

---

## Static fetch vs live pane

The pane today renders a **static fetch with no realtime updates**. Under these semantics the
newest bar is `isrealtime` if fetched mid-session and `isconfirmed` if fetched after the close —
**correct at fetch time**, and it goes stale as the session progresses.

✅ Accepted for this wave, and recorded rather than hidden. The pane **re-evaluates barstate on
any refetch**. When realtime bar updates land, `isrealtime` flips per update with no change to
any definition on this page.

---

## ⭐⭐ The stability property — what makes ours better, not merely different

Two properties the vendor does not have. Both are tested.

1. **Time-invariance on closed bars.** Two evaluations of the same closed bar at different
   wall-clock times return identical flags.
2. **Arrival-invariance.** Two bindings of the same fetch — one "arrived early", one "arrived
   late" — produce identical flags on every closed bar.

⛔ These are the tests that prove we are *better* than the vendor here rather than just
different. Without them "we diverge" is an excuse; with them it is a guarantee.

---

## The screener path is unchanged

On a screener sweep every bar is closed at scan time, so `isrealtime` is false everywhere and
`isconfirmed` folds to `true` exactly as it does today. **That path and its tests are kept
verbatim** — the fold is not an approximation there, it is the correct answer, and it is
expressed by passing no `now` at all rather than by a special case.

## Disclosure

- `divergences.json` carries `barstate-viewer-dependent-on-vendor`, **accepted**, with the
  fixture.
- The pane's data-notes affordance shows the sentence at the top of this page whenever a script
  references `barstate.*`.

---

## Outcome on Uncharted Volume — measured 2026-09-09

The member script has five `barstate.*` sites: `isconfirmed` at **296, 299, 399** and `islast`
at **429, 450**. All five now translate. They were not "flipped" in a status column — the
engine serves the names, so they stopped refusing by construction.

| contract | refusals | what remains |
|---|---:|---|
| screener (default) | 5 | 4 × `pine:function` **225** `ta.cum` · 1 × `pine:window` **233** `isWeekly` |
| host / pane (`strict`) | 4 | 3 × `pine:window` **233** `isWeekly` · 1 × `pine:reassign` **250** `:=` |

⭐ **`ta.cum` at 225 refusing for a screen and not for a pane is the ruling working**, not a
gap: `_functions_cumulative` permits a pane to draw a running total and never a screen.

⚠️ **`pine:reassign` at 250 is NEW, and it is the expected shape rather than a regression.**
It was always there; translation simply never reached it, because `barstate` refused first.
Removing a wall reveals the next one, and a refusal count that goes *down* by less than the
number of walls removed is the normal reading — not evidence the removal failed.

⛔ **`pine:window` at 233 is the bind-time fold and is NOT ours to close** — it is the other
session's in-flight work. What this wave contributed to it is a measurement rather than a
patch: the vendor **accepts and runs** a timeframe-conditional length, witnessed on Uncharted
Volume itself computing on both 1D and 1W, so 233 is a capability gap and not a correctness
guard. The numeric half (that the folded window is 5 on 1W and 20 on 1D) is still unmeasured.
