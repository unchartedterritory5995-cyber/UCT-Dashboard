# W34-I6 spec: W4 residue on drawing scripts (`runtime:block-value`, `runtime:history-dynamic-offset`)
> Status as of 2026-11-07: see docs/pine/W9-DECISIONS-2026-11-07.md / landed lanes. Landed: engines 22-32 and W9-T11/T14/T15.

Source task: section "I6 W4 residue on drawing scripts" of `docs/pine/W3W4-NEXT-BREAKDOWN.md`
(`origin/docs/pine-w3w4-next-breakdown` @ `fe4f84b78c`). This is a spec. Nothing is built here.

Line references are to `origin/master` @ `3e8dc3fae5`. `FE` = `app/src/components/chart/engine/ast/pineRuntimeFrontend.js`.

## 0. How the shapes were named

- **Census (committed):** `docs/pine/census/wall-detail-2026-11-05.json` on master (W34-T0 item 5,
  schema `uct.pine-wall-detail/v1`, measured at `c855e8cadf`). Each runtime-on step has
  `runtimeDeclined` and `probe {guard, token, line}`. The 6 + 3 drawing-script touches are the
  `[drawing-objects]`-sole scripts whose runtime-on walls include each token
  (`coverage-map.json` + `coverage-targets-2026-11-05.json`, as in the breakdown's Appendix A).
- **Local spike:** `buildRuntimeIr(source, {})` from FE on master, Node 20.20.2, one script at a
  time. Script sources were read locally from the corpus and are **not** committed. Scripts are
  named by key and by the first 16 hex characters of the sha256 of the local `.pine` file.
- **Synthetic probes** (written for this spec, no licence-held text) discriminated each shape:
  they are described in words under each shape below. The build writes them as rails.
- The spike reports the **first** refusal only. Where the census step and the spike's first
  refusal differ (another wall comes first in the spike's lane), the shape is named from the
  census line plus a reading of that line, and marked "read, not spiked".

## 1. The shapes

### 1.1 `runtime:block-value` (1 sole, 6 drawing touches)

| script (key, sha256/16, version) | census line(s), token | shape | W4 owner |
|---|---|---|---|
| `fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated__578addf606` (`c3b3e97846fe9bbc`, v5) **SOLE** | 56, 58, 69, 71 (token `null`) | **B1. A `switch` arm whose expression wraps onto a continuation line.** The script assigns `X = if … else if … ⏎ switch t` inside a function; two of four arms continue on a line indented one space past the arm. The splitter takes the continuation as a sub-block of the arm, so `lowerBlockValueIn` refuses with "a branch of `… = if …` ends in a block this lane reads no value from" (`FE:9172-9174`). Spiked. | **New.** Not a W4 remainder. |
| `ict-institutional-order-flow-fadi__25d4834579` (`076a507200dae163`, v6) | 477, `if` | **B2. v6 function tail `if c` (no `else`) whose arm is a nested `if … else false`; the value is read** (`x = f()`). The typer does not recurse into the nested `if`, so the arm is "not provably bool" and `refuseV6UnmatchedBool` (`FE:9645`) refuses. Synthetic probe: same shape refuses in v6, serves in v5. Read, then spiked synthetically. | **T14** (v6 bool typing) |
| `fibonacci-retracement-statistics-by-volprofex__999c924fce` (`7e204569929d9b38`, v6) | 593, 719, `if` | **B3. v6 function whose body ends in an `if` (no `else`) of side effects, called only as a statement** (both functions' call sites are bare statements). The value is never read, yet the v6 unmatched-bool rule refuses. Synthetic probe (tail `if` whose arm ends in a float `:=`, call as statement) refuses with the Q-A3 sentence. | **T14** |
| `tehthomas-aligned-timeframe-fair-value-gaps__f843e207ca` (`c040a08a4eacec17`, v6) | 239, `if` | **B3** (`addFVG(…)`: tail `if` of `pop`/`delete` calls; both call sites are statements). Read, not spiked (the spike stops at `runtime:request` first). | **T14** |
| `volume-delta-oi-delta-kioseff-trading__9056fd6b37` (`2fc8364db521bf6b`, v6) | 63, `switch` | **B4a. v6 `switch` with no default, arms are `?:` / `and` expressions.** Bool by construction; the typer does not read a ternary of comparisons as bool. Read. | **T14** |
| same | 69, `switch` | **B4b. v6 `switch` with no default whose arms are `size.*` constants** (blank line after the header). Synthetic probe: refuses with the Q-A3 sentence; `size.*` is not typed as a string, so "not provably a number, a string or a colour". | **T14** (type table), no bool involved |
| `edufx-amd__0ca9b3c747` (reference, v6) | 61, `if` | **Unread.** Source is not on this machine (`cached_source` absent). By version and token, likely B2/B3. The build's first step reads it. | probably **T14** |

Off the drawing list but the same shapes (for the build's measure-pair): `volatility-stop`
(built-in, `if` line 7, the T14 measure-pair witness), `nadaraya-watson-trend-quantalgo`
(`switch`), `seasonality` (`switch`), `volatility-coil-edge-bullbyte` (`if`).
`supply-demand-mtf-flux-charts` (UDT field tokens) and `neural-network-…`/`fx-market-sessions`
(function-name tokens) are other shapes and are out of scope here.

**Not the cause (ruled out by probe):** the `/` inside the fvg arms (a one-line `switch` arm with
`math.abs((a - b) / (c - d))` inside a function serves); a wrapped expression in an `if` branch
(serves); a nested `switch` inside `else if` with one-line arms (serves).

### 1.2 `runtime:history-dynamic-offset` (1 sole, 3 drawing touches)

| script (key, sha256/16, version) | census line(s), token | shape | W4 owner |
|---|---|---|---|
| `zigzag-multi-time-frame-with-fibonacci-retracement__ppvz14qunp` (`4e94f5fddb872f8f`, v4) **SOLE** | 29, 30, `highestbars` / `lowestbars` | **O1. A v4 window length known only per bar:** `highestbars(high, nz(len, 1))` with `len = bar_index - valuewhen(newbar, bar_index, prd - 1) + 1`. Spiked: "the length of `highestbars` is only known while the bar is running". Synthetic probes with `w = bar_index % 7 + 1`: `ta.highest`/`ta.highestbars` **serve in v5 and v6** (T8 landed, `0a590115ce`), and refuse in v4 (`highest`: `pine:window`; `highestbars`: `resolve:window`). The script declares `max_bars_back = 1000`. After these two walls the census shows the run clean. | **T8 remainder** (the version gate: v4) |
| `support-and-resistance__c4792aabd0` (`7538ddd8f9d02261`, v5) | 30 (token `null`) | **O2. `x[i]` where `i` is a loop counter bounded by a series:** `for i = 1 to ta.barssince(r)` reading `ass[i]`. Spiked: "`i` is given a value by this script, but not one the engine can read before bar 0". `forCounterRange` (`FE:5641`) folds only constant / `simple` / frame-name bounds. No `max_bars_back` is declared, so Pine's own bound is its buffer rule. | **T9 remainder** (series bound) **+ T17** (buffer rule) |
| `volume-profile-v054beta__PNSKf75832` (`5782c2554dfccaeb`, v4) | 212, 235, 242, `getLevelVolumeOP` | **O3. In a function, `for bar = totalBars to 0` reads `local[bar]`, where `totalBars` is a parameter passed a series, and each local carries `max_bars_back(local, 1340)`.** The directive is the bound. Read, not spiked (the spike stops at `runtime:realtime-untold` first); the same script carries `runtime:directive` (`max_bars_back`). | **T17** (`max_bars_back`) **+ T9** (frame-parameter bound) |

## 2. Tasks

Three buildable tasks and one routed residue. The two sole scripts are I6a and I6c.

### I6a A `switch` arm that wraps onto a continuation line | S | Sonnet | not capture-gated

- **Owns:**
  - the arm reader in `lowerSwitchInto` (`FE:9786`) and the line splitter it uses
    (`splitStatementCommas` / the `sub` attachment that feeds `lowerBlockValueIn`, `FE:9115-9174`);
  - new rail `RT/__tests__/w34I6SwitchArmWrap.test.js`.
- **Delivers:**
  - An arm line followed by lines indented deeper than the arm and **not** a multiple of the
    block indent is one wrapped expression, joined before the arm's value is lowered. This is the
    rule the `if` branch already follows (a wrapped `if` branch serves today).
  - A true sub-block under an arm (indented by a full block step) keeps today's reading.
  - Unblocks `fvg-detector-tradingfinder-…` (sole).
- **Pine semantics:** line wrapping: a continuation line is indented by any number of spaces that
  is not a multiple of four.
  https://www.tradingview.com/pine-script-docs/language/script-structure/#line-wrapping
- **Rails:**
  - differential: a `switch` value with each arm on one line equals the same `switch` with two
    arms wrapped, over 5,000 bars, top-level and nested in `if … else if`, inside a function;
  - control: an arm with a real 4-space sub-block still lowers as a block (or keeps its refusal);
  - the fvg script's runtime-on wall set goes from `{runtime:block-value}` to empty in the local
    census step.
- **Mutations:**
  - join on any deeper indent (including multiples of four): the sub-block control goes red;
  - do not join: the differential goes red;
  - plus the no-op control.
- **Capture-gating:** none: syntax, not semantics. The script then joins track A (its own
  capture on `AMEX:SPY 1D` grades the drawings before arming).
- **Depends:** none. Adjacent to W6-T3b only if its `:3111-3660` hunks moved the splitter; rebase.

### I6b The T14 residue: tail `if`/`switch` the typer does not reach | S | Sonnet | partly capture-gated

- **Owns:** `provablyNonBoolToks` (`FE:9535`), `refuseV6UnmatchedBool` (`FE:9645`), the
  type tables T14 introduced; rail `RT/__tests__/w34I6V6BoolResidue.test.js`.
- **Delivers:**
  1. **B3, value never read.** A function whose tail is an unmatched-able `if`/`switch`, and every
     call site of which is a statement, needs no value type: lower it valueless. A function also
     called as a value keeps the rule. (fib-stats, tehthomas.)
  2. **B2, nested arms.** An arm that is itself an `if … else` / `switch` with a default is typed by
     recursion over its arms. (ict.)
  3. **B4a, ternary and logical arms.** `c ? a : b` is bool when both branches are; `and`/`or`/`not`
     are bool. (kioseff line 63.)
  4. **B4b, named constants.** `size.*`, `text.align_*`, `xloc.*`, `yloc.*`, `extend.*`,
     `label.style_*`, `line.style_*` are typed string from the extracted reference
     (`tools/pine_survey/pine_reference_extract.js`), never by hand. (kioseff line 69.)
  5. Read `edufx-amd` first and place it in 1-4, or name it.
- **Pine semantics:** as T14 (`W4-BREAKDOWN.md`): v6 bool is never `na`; an unmatched `if`/`switch`
  yields `false` for bool, `na` for other types.
- **Rails:**
  - per item, a v6 case and its v5 control (`na`), and an untypable control that still refuses;
  - item 1: the same function also called as a value refuses.
- **Mutations:**
  - item 1: treat a value call site as a statement: the mixed-call rail goes red;
  - item 2: stop the recursion: the nested rail refuses again;
  - item 4: type `size.*` as number: the string rail goes red;
  - plus the no-op control.
- **Capture-gating:**
  - items 2 and 3 (a bool value is read): **inherit Q-A3** (`capture-queue-2026-10-31-wsa-for-bound.md`).
    Before Q-A3 MATCHes, serve them only as T14 does (refusal kept for the untyped case).
  - item 1 (value discarded) and item 4 (a string's unmatched value is `na` in every version):
    no capture; the object door still keeps Q-A3 (`objectDoorRefuses`).
- **Depends:** T14 landed (it has). None of these scripts is sole for this wall, so this moves
  first walls, not production unblocks.

### I6c v4 per-bar window lengths (`highestbars`/`lowestbars`, then the T8 family) | S | Sonnet | capture-gated

- **Owns:** the T8 version gate in FE window lowering and the v4 resolver path that raises
  `pine:window` / `resolve:window` for a non-literal length; extend `RT/__tests__/w4SeriesLength.test.js`.
- **Delivers:**
  - T8's per-bar length for v4 scripts, for the functions T8 serves, read from the v4 reference
    entries (v4 names without `ta.`), starting with `highestbars` and `lowestbars`.
  - The ring is bounded by the script's declared `max_bars_back` where present (zigzag: 1000),
    else by T8's ceiling; beyond it, the by-name refusal stands. An `na` length keeps the refusal
    (zigzag guards it with `nz(…, 1)`).
  - Unblocks `zigzag-multi-time-frame-with-fibonacci-retracement` (sole).
- **Rails:** T8's reference-formula rail run under v4 for `highestbars`/`lowestbars`/`highest`/`lowest`;
  a v4 length that exceeds the ring refuses by name.
- **Mutations:** gate back to v5+: the v4 rail goes red; read the span once at bar 0: the varying
  rail goes red; plus the no-op control.
- **Capture-gating:** **new row W4-S1-v4**: the W4-S1 probe (`vw-w4-series-length.pine`) as a v4
  sibling file `-v4`, adding `highestbars`/`lowestbars`, on `AMEX:SPY 1D` and `NYSE:RDDT 1D`. W4-S1
  itself is inherited for the v5/v6 reference. v4's reference types `length` as `integer`; whether
  v4 accepts a per-bar value there is exactly what the row settles (the zigzag script compiles on
  TradingView, which says it does, but not what it reads on bar 0).
- **Depends:** T8 landed (it has).

### I6d Series-bounded loop history (O2, O3) | routed, not a new task

- **O3** belongs to **T17**: once `max_bars_back(x, n)` is served, `n` bounds `x[bar]`, and T9's
  frame carry lets the call site's series argument pass under that bound. It inherits **M1-M5**
  (`vw-w4-max-bars-back.pine`). Add `volume-profile-v054beta` to T17's measure-pair.
- **O2** is a series bound with no declared buffer. Pine's answer is its default buffer rule
  (auto-sized history, runtime error on overrun). It inherits **M1-M5** and needs **new row
  W34-I6-L1**: probe `vw-w34-i6-series-loop-history.pine`, v5, on `AMEX:SPY 1D`:
  `for i = 1 to ta.barssince(cond)` reading `flag[i]`, with `cond` rare enough that the bound
  passes 500 bars. Serve after T17 with the buffer rule the capture shows; until then the refusal
  stands. Owner: T9's follow-up after T17.

## 3. Summary

| shape | scripts (drawing) | owner | build | capture |
|---|---|---|---|---|
| B1 wrapped `switch` arm | fvg (sole) | new: I6a | S | none |
| B2 / B3 / B4a / B4b | ict; fib-stats, tehthomas; kioseff ×2; edufx (unread) | T14 residue: I6b | S | Q-A3 for B2/B4a; none for B3/B4b |
| O1 v4 per-bar length | zigzag (sole) | T8 remainder: I6c | S | new W4-S1-v4 (+ W4-S1) |
| O2 series-bounded loop | support-and-resistance | T9 + T17: I6d | after T17 | M1-M5 + new W34-I6-L1 |
| O3 `max_bars_back`-bounded loop | volume-profile-v054beta | T17 (+T9): I6d | in T17 | M1-M5 |

T17's D1 row (integer division) is **not** involved: the one division present (fvg arms) serves.

Order: I6a first (the only uncaptured sole unblock), then I6b, then I6c when W4-S1-v4 is taken.
