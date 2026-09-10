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
this repo has paid for repeatedly. Instead the boundary carries **one TRI-STATE per fetch**:

```
newestBarIsForming  :=  bar_close_state(bars, tf, now, holidays, early_closes)
                     ->  true | false | null      # null = nobody told me
```

computed where the calendar already lives, and handed to the runtime. Every flag above is then a
pure function of `(bar index, N, newestBarIsForming)` — no clock and no calendar inside the
runtime at all.

### ⭐⭐ The seam carries a TRI-STATE, and `null` is not `false`

`newestBarIsForming` is **`true` / `false` / `null`**, and `null` means *nobody told
me* — never *not forming*.

| handed in | the two EXTENT columns | the four REALTIME columns |
|---|---|---|
| `true` | answer | answer; the newest bar is realtime |
| `false` | answer | answer; every bar is confirmed |
| `null` | **still answer** | **blank** |

⛔ **Collapsing `null` onto `false` is the one wrong answer these columns exist to
prevent.** It would put a confident `isconfirmed = 1` on a bar that may still be
open, and it is invisible: it looks exactly like a correctly-closed bar. The
default is therefore `null`, not `false` — a caller who knows nothing gets blanks
rather than a guess, and a caller who does know says so.

⭐ **The extent pair never blanks**, because it reads only the fetch's shape:
which bar is newest, which is oldest. There is no input it could be missing. That
asymmetry is why the roster is two groups rather than one — `CLOCK_EXTENT` and
`CLOCK_REALTIME` — with `CLOCK_BARSTATE` derived from the two rather than typed a
third time.

**Produced once, on the Python side**, by
`api/services/indicator_compute.py::bar_close_state(bars, tf, now, holidays, early_closes)`
— the only place either NYSE set is read. The browser is handed the tri-state and
never a date set.

### Gap — the calendar sets have to be handed in

`scheduled_close_seconds` takes both sets as **parameters** and imports neither: a
second list of exchange dates is exactly the defect `/api/market-calendar` was
written to prevent. **Absent the closure set, a holiday-shortened week reads
`isrealtime` for a day longer than it should** — a week ending on Good Friday
actually ended on the Thursday. **Absent the early-close set, a half-day reads
long by three hours.** Both are wired in at the one call site
(`ast_interpret._nyse_full_closures()` / `._nyse_early_closes()`), so the absent
case is a programming error rather than a shipped state.

⚰️ **A "Gap 1 — early closes are not known" once stood here** and is gone. It
reasoned from `bars_fetch`'s own comment that half-days are *"intentionally NOT"*
included — true of that set, false of the repo:
`liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD` is a real frozenset with five read
sites and the parity rail `tests/test_nyse_calendar_parity.py`. Wiring it in is
what closed the gap; naming it is what kept it open.

---

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

### Extended hours — RE-MEASURED 2026-09-09, and this section was wrong twice

⛔ This page used to say *"The bars pipeline delivers regular-session bars. That is an
**assumption with a test**."* **Both halves were false.** The assumption is wrong, and the test
it leaned on for safety does not exist — `pine.barstate.test.js` contains no assertion about
sessions, extended hours, holidays or early closes. The sentence justified accepting an
assumption by naming a safety net that was never built.

Read from the code instead of from belief:

- **Intraday fetches DO carry extended-hours prints.** `bars_fetch._fetch_intraday_yfinance`
  asks `prepost=True` — *"Include premarket (4-9:30 AM) + after-hours (4-8 PM)"*. The
  serve-time filter keeps them deliberately: *"Zero volume is legitimate (illiquid /
  extended-hours) and is kept."* The freshness gate names 04:00–20:00 ET as the window where
  *"extended-hours and RTH coexist"*.
- **Daily and above do NOT.** `prepost=True` occurs at exactly one site in the repo, and it
  reads `_YF_CONFIG`, which is intraday-only (`1/5/15/30/60`). The daily path passes no
  `prepost`; the only other site in the tree, `api/index_bars.py`, passes `prepost=False`.
- **Railed, not merely written down** — `tests/test_bars_extended_hours_scope.py` pins
  all three halves: the intraday site asks, the daily and index lanes do not, and a
  zero-volume extended-hours print survives the serve-time filter. It also asserts
  `prepost=True` occurs at exactly ONE site, so the scope claim above cannot go stale
  silently.

**The formulas survive; their justification does not.** Intraday is `bar_open + interval`
because interval arithmetic is indifferent to session — **not** because the regular session was
open. D/W/M may keep a scheduled close on the ET calendar because no extended-hours print ever
forms a daily bar in this pipeline.

⛔ **Never restate the regular-session premise.** It is a wrong reason for a right answer, and
the next person to lean on it will lean on it somewhere it does not hold.

⭐⭐ Reached independently by `worktree-indicator-ecosystem` at `ae2ed68ec` — from a
measurement, while this branch reached the opposite from an assumption. On this point theirs is
the one to trust, and this correction adopts it.

---

## ⛔⛔ GATE — the JS pane lane is not wired, and may not be

**`pineRuntimeFrontend.js` may not be wired to any route until a producer feeds
`opts.newestBarIsForming` from Python's `bar_close_state`. Until then the JS lane
renders CLOCK_REALTIME blank by design. Measured: at `35ba654da` the lane was
already blank; at `3a1d9d4a3` it was confidently wrong.**

⭐ The blank is the fail-closed contract working, not a defect — but it is only
safe while nobody can see it. The module has zero importers today, so no route
reaches it and no member meets the blanks.

⛔ The gate is a TEST, not this paragraph:
`app/src/components/chart/engine/__tests__/pineRuntimeFrontendGate.test.js`
asserts the module has no importer outside its own tests, with a control proving
the scan can find a referrer when one exists. **When someone wires it, that test
goes red BY NAME, and the correct edit is to build the producer and then delete
the test in the same commit** — never to edit the test to keep it passing.

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

## What a member is told

The manifest's `_barstate.vendorNote` reaches the paste box through the same walk
that surfaces `atr`'s note, and the pane's data notes carry the scope limit.

> This engine defines `barstate.*` from our clock and our fetch. Two consequences
> for a member porting a script: `barstate.ishistory` here means exactly
> `barstate.isconfirmed` — the bar's period has ended — while on TradingView the
> two differ by whether the chart LOADED the bar or WATCHED it form. And these
> flags are correct at fetch time rather than live, so a bar that closes while
> this pane sits open does not flip until the next fetch.

Ledger row: `tests/fixtures/vendor/divergences.json::barstate-viewer-dependent-on-vendor`,
status **accepted**, confidence **measured** — captured on a live chart across the
2026-09-09 US open, fixture
`tests/fixtures/vendor/barstate-realtime-spy-2026-09-09.json`.

---

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
