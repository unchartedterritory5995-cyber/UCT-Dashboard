# Pine runtime lane, wave 1 — the "RVOL slice"

**Status:** design approved by the owner in chat, 2026-09-19. Spec written the same day.
**Base:** `origin/master` `f34b1830c`.
**Branch:** `feat/pine-runtime-rvol-slice`.
**Relationship to the wave sequence:** this is the first wave that wires the C4 runtime lane
to a product surface. It does not renumber C0–C4, and it does not change the columnar
translator's behaviour for any script that translator already accepts.

---

## 1. What the owner asked for

> *"We need our system to be able to analyze and read pinescreener like this and build the
> indicator."* — owner, 2026-09-19, of a v6 multi-symbol watchlist dashboard
> (**RVOL + ATR Dashboard**, 594 lines) that draws one table and no plots.

Settled in the same conversation:

| question | ruling |
|---|---|
| Execute the Pine, or generate a UCT-native equivalent? | **Execute the Pine.** UCT runs the script itself; TradingView stays the source of truth. |
| Wave shape | **Vertical slice first**, then a census cohort, then horizontal completion. All three eventually. |
| Live or closed bars? | **Live during the session.** The script only means anything intraday. |
| The owner's friend's script | **Local only, never committed.** The repo is public. |
| D1/D2 defects found on the way | Fixed first, separately (`fix/secondary-bars-denial-storm`). |

The endzone this serves is unchanged: *complete, total, faithful transferability of
legitimate complex TradingView Pine indicators and Pine-based screeners into UCT* — with no
known wrong values, no silent approximations, and no benchmark-only fixes.

## 2. The two acceptance scripts

| id | script | licence | committed? |
|---|---|---|---|
| **F1** | RVOL + ATR Dashboard (owner's friend's) | none stated | **NO — local only**, `sha256 4863812b…6aed`, 594 lines |
| **F2** | `corpus/committed/strong-start-rvol-dashboard__36140b1cbe.pine` | MPL-2.0, © finallynitin | already in the repo |
| **S\*** | small synthetic scripts, one per construct | ours | yes — these are the real rails |

F1 and F2 are near-twins: both paste a watchlist into `input.text_area`, split it, loop over
the symbols calling `request.security` per symbol, rank the rows, and draw one table.
F2 additionally uses `array.set`, `array.copy`, `str.startswith`, `input.bool`/`input.float`,
`syminfo.tickerid`, two tables, and the `"1D"` spelling of the daily timeframe.

**Why two.** One script invites script-shaped fixes, which the endzone forbids. Every
capability below is built to its general Pine meaning and railed on synthetic scripts; F1 and
F2 are the end-to-end acceptance, not the unit of work.

## 3. Where the script stands today (measured 2026-09-19, `307d7e2fb`)

Through the **translator** (the lane live in production):

- `pine:no-output` — *"the pasted script offers no plot and no alert condition to filter on"*,
  returned **before** the object pass that reads tables. A script with no `plot()` never
  reaches the table reader.
- With a placeholder plot added (diagnostic only), the object pass reports
  `loopBlocked: 15` (`table.cell`, `array.push`), `unsupported: ['table.clear']`,
  11 unbound locals, `text_size` dropped on 6 cells. Only the header row survives.

Through the **runtime lane**: refused at `table.new` (`pine:drawing`).

Isolated capability probes: own-ticker daily requests, daily `ta.atr`, `high[1]`,
`barstate.islast` and tuple requests all translate; `request.security(exch + ":AAPL", "D", …)`
refuses `pine:request`; `"30"` refuses (not a servable timeframe); `hour(time, tz)` and
`time(tf, session, tz)` refuse `pine:function`.

**Demand is broad, not exotic.** Across the 266 licence-cleared published scripts in
`corpus/committed`: `for` 45.9%, arrays 40.2%, `table.new` 25.6%, **no plot at all 31.2%**,
`request.security` 24.8%, `barstate.islast` 32.0%. The watchlist-request shape itself is rare
(1/266) — that one is F2.

## 4. Architecture

### 4.1 Two lanes at one door, routed by verdict

The member door runs the host translator first. If it accepts, **nothing changes** — that is
the path Volume v2, Uncharted Clouds and every saved definition already take, and this wave
must not move it. If it refuses, the source is offered to the **runtime lane**. The pane then
reports whichever lane ran; if both refuse, the member sees the refusal with construct and
line.

Rejected alternatives:

- **Runtime for every import.** It would move shipped scripts onto a lane that has no
  presentation vocabulary yet (`runtime:presentation`), regressing Clouds. This becomes the
  end state later, once a differential rail proves the lanes agree.
- **Server-side runtime (Node sidecar) for the chart.** Contradicts the C4 ruling (browser for
  the chart, sidecar for the screener) and puts per-member live compute on the pod, which has
  twice caused member-visible OOM outages. The sidecar remains the screener's future path.

### 4.2 Execution moves off the main thread

The binder computes synchronously inside a paint, with no worker and no watchdog; the object
lane re-evaluates and rebuilds the table DOM on every chart update (about once a second in
extended hours); the runtime's own `WALL_TIME` is 5 s; and 12 published scripts are known to
hang or exhaust memory in the shared parser.

So the runtime lane **compiles and executes in a Web Worker**, terminated at a hard deadline.
Results reach the chart through the cache-and-subscribe seam `secondaryBars.js` already
establishes: a synchronous read that never computes, an `ensure` that schedules work, and a
subscription that repaints when a result lands. Results are memoised on
`(source hash, input values, data versions)`.

This is also the only structural answer to the 2026-09-10 app-wide freeze (a render loop in a
shared component froze navigation for ~4.5 h): a member's pasted script must not be able to
block the app's main thread, whatever it contains.

### 4.3 Data

| need | channel | why |
|---|---|---|
| history, any symbol, D and intraday | `GET /api/bars/{t}?tf=&bars=` via the shared `secondaryBars` cache | already serves this; one fetch shared across panes |
| developing **daily** bar, in session | `/api/bars-today-pack` | whole market in one request, ~30 s refresh, **zero provider calls** |
| developing **intraday** bar, in session | `/api/stream/bars` (SSE) via `barsStreamManager` | `/api/bars` freezes the current 30m bar until the next boundary |

**Decision — the today-pack is used as an indicator input, which its own contract discourages.**
`todayPackClient.js` calls itself *"a seed, not a source of truth"* and is deliberately kept out
of `filteredBars` so indicators never see it. This wave feeds it to the runtime lane anyway,
for reasons that do not apply to the candle series: (a) the alternative is polling `/api/bars`
for up to 20 symbols per cycle, and cold fetches share a **pod-wide cap of 3 concurrent / 12
queued**, so one member's watchlist could starve every other member's chart; (b) `/api/bars`'s
own developing daily bar is typically ~5 minutes old, which is *worse* than the pack's ~30 s;
(c) the consumer is a ranked dashboard table, not a price series a member scalps from. The
staleness is **disclosed in the pane**, and the after-close parity run — the binding one — uses
completed bars where the question does not arise.

**Session filtering.** Our intraday bars include pre- and post-market and the endpoint has no
session parameter; Pine's `request.security` on a string ticker is regular-session by default
(to be measured, §6). Requested intraday series are therefore filtered to the regular session
on the client, using the **exchange calendar** — a fixed 09:30–16:00 window is wrong on half
days, which would silently corrupt an opening-range column on exactly the days a member cares
about.

**Symbols.** `"NASDAQ:AAPL"` is currently sent to the bars endpoint verbatim and comes back
empty. The runtime resolves `EXCH:TICKER` against the six witnessed rows in
`symbolScope.json::confirmed` (our exchange string → TradingView's `syminfo.prefix`) plus the
stored listing exchange per ticker. Whether TradingView rejects a wrong-exchange spelling such
as `NASDAQ:JPM` is **measured before it is implemented** — F1 prefixes every bare ticker with
`NASDAQ`, so this decides whether NYSE-listed rows appear at all.

### 4.4 The value model — decided first, with a benchmark

The VM holds `Float64Array` series and outputs; strings, arrays, booleans and object handles
have no representation. C4 left "value tags vs NaN-boxing" open. **Nothing else in this wave
can be built until it is settled**, because every capability below sits on it. The decision is
made the way C4's runtime choice was made: two implementations of one assembled program,
measured, with an agreement control run first.

## 5. Capabilities built (general Pine meaning, not script-shaped)

**Language.** `for … to … [by]`, `break`, `continue` · typed arrays (`int/float/bool/string`):
`new`, `from`, `push`, `get`, `set`, `size`, `copy`, `sort_indices`, with Pine's own
out-of-range error behaviour · string values, concatenation, comparison, `str.replace_all`,
`split`, `trim`, `contains`, `startswith`, `tostring(value[, format])` · tuple destructuring ·
`math.min/max/round` · `barstate.islast` · `hour`/`minute(time, tz)` · `time(tf, session, tz)` ·
`const` · user functions returning strings and arrays.

**Parser (both lanes, one authority).** Typed parameters `f(float a)` — today the translator
reads them and the runtime front end does not, which is two parsers for one grammar; default
parameter values `f(int n = 2)` — refused by both; generic syntax `array.new<string>()` and
`array<string> x` — refused by both at parse.

**Requests.** `request.security` with: another symbol; `"D"`/`"1D"` and intraday timeframes;
tuple results; an expression evaluated in the requested context, including a user function
carrying its own `var` state per call site per symbol; `calc_bars_count`;
`ignore_invalid_symbol`. Symbols that are only known while the script runs are handled by
**fixed-point discovery** — execute, collect the `(symbol, timeframe)` set that was requested,
fetch, re-execute, until the set stops growing, bounded by Pine's own request ceiling. The
runtime's `REQUEST_COUNT` limit rises from **16** to the measured TradingView limit; F1 needs
40 and F2 documents 40.

**Tables.** The VM executes `table.new`/`cell`/`clear` and the `cell_set_*` setters as object
ops, emitting the same live-object list the C3B object runtime already produces, which
`toRenderState` and `objectTableDom` already paint. Adds `text_formatting` (dropped silently
today) and `table.clear` (never executed today — F1 clears every bar, so without it a shrinking
watchlist would leave stale rows on screen).

**Inputs.** `input.text_area` (new schema type), `input.string` with and without `options`,
`input.int`/`float` with bounds, `input.bool` as a real boolean, `group` and `tooltip`.
Parameter ids for the new kind are keyed by **Pine variable name**, not by position — the
deferred H.11 idea, applied only to definitions this lane creates, so nothing existing needs
migrating.

**Out of scope, refused by name with the line:** `matrix`, `map`, user-defined types and
methods, `while`, `switch`, `varip`, `polyline`, `request.*` other than `request.security`,
and method-call syntax (`arr.get(i)`) — the last is the cohort rung's first job.

## 6. Vendor measurements taken BEFORE the matching code is written

The standing rule from the transferability resume doc is to measure on TradingView first.
Each of these changes what gets built, and each is pinned as a fixture:

1. **Request merge** — a `"D"` request on an intraday chart and a `"30"` request on a daily
   chart: what lands on the last bar, historical vs realtime, `lookahead`/`gaps` defaults, and
   `na` before the first bar of the requested series.
2. **Session default** for a string ticker inside `request.security` (regular vs extended).
3. **Daily bar `time`** for a US equity (our wire carries a date string, Pine carries ms).
4. **Wrong-exchange spelling** — is `NASDAQ:JPM` invalid?
5. **Request ceiling** — 40, or more on some plans.
6. **`str.tostring(x, "#")` rounding** and **`math.round` at .5**.
7. **`array.sort_indices` tie order.**
8. **`timeframe.period` inside a requested context.**
9. **DST** behaviour of `hour(time, tz)` across a change.

Capture runs on the owner's signed-in TradingView per `docs/pine/capture-procedure.md`
(desktop visible, email sign-in route, scratch layout). Nothing on the vendor side is
automated with the owner's credentials — a standing ruling, and independently a hard line.

## 7. Product wiring

- **Its own gate.** The member Pine door went live in production on 2026-09-19 04:01Z
  (`VITE_PINE_MEMBER_PANE_ENABLED`, commit `c2c048653`), and it is build-time only with no
  per-user override — so any door change reaches every paying member on the next deploy. The
  runtime lane therefore ships behind its own build flag, default **off**, plus a **per-user
  cohort tag** so the owner can exercise it live in production while members see nothing.
  Flags stay env vars; cohorts stay tags.
- **A new compute kind, `pine`**, storing the Pine source, the Pine version and the member's
  input values. The program is re-derived on load, never serialised — deriving beats restating,
  and there is no second artifact to drift. `compute.fn` is the source hash. The server today
  refuses any kind but `ast` and caps a stored document at 64 KiB; both change for this kind
  (sources run 17–60 KB). Every other server reader already refuses an unknown kind by name
  without crashing, which is what makes this safe to add.
- **Object-only definitions become valid.** A zero-plot script is refused in four places today
  (`paneGate`, `memberPaneDefinition`, `defSchema`'s "at least one plot or one event", and the
  ast-lane install check). A definition whose output is an object program is drawable.
- **Install moves off the render path.** Definitions install inside a render-phase `useMemo`
  that can call `translatePine` up to six times, each with a 10 s budget, on every chart mount.
- **Placement** follows `indicator(overlay = …)`, which the member path already supports.
- **Refusals name the construct and the line**, never a lane.

## 8. Verification

- **Synthetic rails per construct**, with vendor-pinned expected values. These are the
  committed evidence; F1 is not committed and F2 alone cannot cover a grammar.
- **Differential rail** — runtime vs translator on every corpus script both lanes run,
  bit-identical, following `graphRuntimeDifferential.test.js` (one tree, two lanes; 1e-9 would
  hide an off-by-one in a slowly varying series).
- **Shipped-behaviour rail** — the translator's verdict for every corpus script is unchanged by
  this wave. This is the rail that protects production.
- **Parity split, ENGINE vs DATA.** Before any cell is judged, our bars for that symbol are
  compared against TradingView's. An engine mismatch is a defect. A data mismatch (vendor
  volume, extended-hours composition, a missing interior 30m bar) is reported with bar-level
  evidence and never "fixed" in the engine.
- **Acceptance**, for F1 and F2: zero edits, zero refusals, the table draws, it updates live,
  and after the close every cell matches TradingView — text, text colour, background, row
  order — on a fixed watchlist that includes an invalid symbol, a bare NYSE ticker under the
  default NASDAQ prefix, blank lines, stray whitespace, duplicates, and more than 20 symbols.
  Plus one in-session spot check with a stated timing tolerance.
- **Render stability** — commits per second on the chart surface, because the table lane
  re-renders on every chart update and a render loop here is the 2026-09-10 failure again.
- **Flag-off non-vacuity** — with the flag off: no pane, no instance, nothing in the DOM, each
  measured separately.
- **R-27 app-wide client smoke** is owed at any flag flip, not at merge.

## 9. Risks

| risk | handling |
|---|---|
| Value model is load-bearing for everything | decided first, by benchmark, before other work starts |
| A member's script hangs the app | worker + hard terminate; 12 known hostile scripts as fixtures |
| 20 cold symbols starve the pod's 3-concurrent cold-fetch queue | client concurrency cap, backoff, today-pack and stream preferred; measured before any batch endpoint |
| TradingView's own feed differs from ours (volume, extended hours) | ENGINE vs DATA parity split; owner's feed confirmed from the chart legend at capture |
| Massive's 30m aggregate intermittently drops interior bars | a missing 09:30 bar changes an ORB column — detect, disclose, consider composing 30m from 5m |
| Door changes reach live members | own flag + cohort tag; shipped-behaviour rail |
| Saved scripts silently change meaning when the engine changes | the differential rail plus name-keyed parameter ids |

## 10. The ladder after this wave

1. **This slice** — F1 and F2, end to end, live, matching TradingView.
2. **Cohort** — the 68 table scripts in `corpus/committed`, with a measured share importing and
   matching. Method-call syntax and the v4/v5 dialects land here.
3. **Horizontal completion** — every remaining runtime family, census-ordered.
4. **Consolidation** — translator-accepted scripts move to the runtime once the differential
   rail proves the lanes agree; then Pine-as-screener through the Node sidecar.

## 11. Rulings to record (next free number: R40)

- **R40** — the runtime lane is admitted to the member door as a second lane, routed by the
  host translator's verdict. This revisits D2's host-only rule; D2's reasoning (one place
  decides what a pane may draw) is preserved, because `paneGate` remains that place.
- **R41** — the runtime lane executes in a worker with a hard deadline; the chart never
  computes a member's script on the main thread.
- **R42** — a new compute kind `pine` stores source, version and input values; the program is
  derived, never stored.
- **R43** — parameter ids for kind `pine` are keyed by Pine variable name.
- **R44** — the today-pack may be an input to the runtime lane, disclosed, for the reasons in
  §4.3. It remains out of `filteredBars` for every other consumer.

## 12. Open questions for the owner

1. Which market data does the TradingView account carry for US stocks? Answered "all data" in
   chat; confirmed from the chart legend at the first capture, because a Cboe-BZX-only feed
   would make TradingView's own in-session RVOL low and the live spot check would be judged
   against the wrong truth.
2. Deploy sequencing for the D1/D2 fixes, which are ready ahead of this wave.
