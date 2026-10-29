# Indicators — overnight expressiveness, stateful foundation, import, visualization (2026-10-29)

Branch `feat/indicators-expressiveness`, from `origin/master` `d7a2605733`. **Draft PR, not merged, not deployed.** No flag, no production setting and no Agent-owned file changed.

Everything here goes through the canonical engine. The parser canonicalises to existing nodes, and the call expansions are mirrored byte for byte by `api/services/call_expansions.py`. No new node type, interpreter or runtime was added. Stored trees, `astHash` and both lanes' evaluators see only names the closed table already declares.

## 1. What a member can now write

| Request | Formula | Before | Now |
|---|---|---|---|
| Percentage distance between two MAs | `(ema(close, 9) - ema(close, 20)) / ema(close, 20) * 100` | worked | worked |
| 9 EMA crosses above 20 EMA | `crossOver(ema(close, 9), ema(close, 20))` | worked | worked |
| Highest high, last 20 bars | `highest(high, 20)` | worked | worked |
| Price vs its 50 SMA, % | `(close - sma(close, 50)) / sma(close, 50) * 100` | worked | worked |
| Volume 50% over its 20-day average | `volume > 1.5 * sma(volume, 20)` | worked | worked |
| **Show a value only when a condition holds** | `close > sma(close, 50) ? close : na` | **refused** (no "no value" word) | **works** — `na` is `0 / 0`, the spelling the Pine translator already writes |
| **Plain-English logic** | `close > open and volume > 1000000`, `not (rsi(close, 14) > 70)` | **refused**: routed to the TC2000 reader, "`close` is not a TC2000 name" (audit P2-8) | **works** — `and`/`or`/`not` (and upper case) are aliases of `&&`/`\|\|`/`!`, same tree, same binding power |
| **Spreadsheet-style condition** | `if(close > open, 1, -1)` | refused (`unknown function "if"`) | **works** — the same `?:` node |
| **Supertrend (stateful)** | `supertrend(3, 10)`, `supertrendDirection(3, 10) == -1`, `close > supertrend(2.5, 7)` | refused ("no self-reference") | **works** — see §2 |

Historical references (`close[1]`, `highest(high, 20)[1]`), rolling aggregates, `barssince`, `valuewhen`, `cum`, `accum` and multi-output definitions already existed and are unchanged.

## 2. Stateful foundation — supertrend as three bounded recurrences

`accum(seed, body, warmup)` already existed in both interpreters. It is a recurrence that reads its own previous value through `self` and re-seeds `warmup` bars back, so a value never depends on how much history was fetched. TradingView's `ta.supertrend(factor, atrPeriod)` is exactly three of these:

- the upper band's ratchet;
- the lower band's ratchet;
- the direction flip, which reads the two bands.

These run over `atrPine` (Pine's own ATR seed) and `hl2`. `callExpansions.js::supertrendTrees` builds them, and `call_expansions.py::supertrend_trees` builds the same tree node for node. The ratchet and the flip are kept, not approximated away.

- **Honest left edge.** The value is withheld (`na`) until both bands were known `W = 200` bars earlier. Before that point, the direction would read bands that did not exist yet.
- **Measured.** Against an independent full-history implementation of Pine's published source (`supertrend.test.js`), 0 bars differ across 12 random-walk series × 3 (factor, period) settings. The probe that chose `W` measured 1 differing bar in 77,820 at W=200, against 11 at W=150. Dropping the first 400 bars changes no published value. Both lanes compute identical values on the conformance corpus (`test_call_expansions_parity.py`).
- **Cost.** 332 tree nodes, about 130 ms per 3,000 bars. The first value appears after about 2W + n bars.
- **Disclosed, never "exact".** A band whose last reset is more than W bars old *can* differ from TradingView's full-history value. The agreement is measured, not proven, which is exactly why user-written `var` supertrends are refused as `pine:state`. So both expansions declare a `vendorNote` (`SUPERTREND_NOTE`). `vendorNotesForTree` finds it by shape in the stored tree, and a `ta.supertrend` import reads "Imported, with disclosed differences" with that sentence.
- **Pine import.** `[st, dir] = ta.supertrend(3, 10)` now translates through the same builder (`PINE_TUPLE_BUILTINS.supertrend`). The bare `st = ta.supertrend(…)` form, which is not valid Pine either, is told to destructure. One blind-corpus script (`multifactor-gap-up-continuation-hold`) left the miss set (19 → 18).
- **The manifest's ruling** `_functions_excluded.supertrend` was replaced by `_supertrend_was_here`, which records why the old ruling was right when it was written.

**What the foundation still cannot do (the next stateful step).** Each `accum` is a closed column. Its body can read other columns, and their past through offsets, but two states cannot read each other's previous value. Parabolic SAR needs exactly that: trend, extreme point and acceleration factor feed one another. So SAR, and any mutually recursive trailing stop, needs a **multi-state accumulator**: one recurrence carrying a small tuple of states, with the same bounded re-seed. That is an engine change in both interpreters (the `accum` planner and stepper, the budget's `MAX_RECURRENCE_STEPS`, the repaint linter and the Python walker). It is deliberately not started tonight.

## 3. Builder reliability — a one-line fix beside every refused formula

`engine/ast/formulaHints.js` reads the engine's refusal. The engine's own message stays verbatim, because it is pinned across both lanes. The formula box draws one short line under it (`data-testid="formula-hint"`). The data lives in `formulaHints.json`.

- **Names the table has ruled on:**
  - `hl2` → `(high + low) / 2`;
  - `variance` → `stdev(close, 20) * stdev(close, 20)`;
  - `bbUpper` → `sma(close, 20) + 2 * stdev(close, 20)`;
  - `obv` → `obvN(50)`;
  - `sar` explains why it isn't available, and names `supertrend`.
- **Other platforms' spellings:** `avg` / `average` / `ma` → `sma`, `smma` → `rma`, `stddev` → `stdev`, `hhv` / `llv`, `iif`, `ref`.
- **Wrong argument counts get the signature**, read from the table's `argRoles`. For example, `atr(14)` → `atr(high, low, close, period)`. There is a specific sentence for `change(x, n)` and for a 4-argument `macd`.
- **A non-literal length** says "write a number, or add it under Inputs". Lengths can already be inputs (`INPUTS_ARE_FOLDED`).
- **Did-you-mean** on everything else, and silence when nothing honest applies.
- **Every formula the hints suggest is evaluated** at the formula sheet by the rail, so a suggestion that stops working fails by name.

## 4. Visualization — "Last value horizontal" (audit P0-5) — **separate draft PR**, branch `feat/indicators-last-value-horizontal`

The style was offered in Settings and drew an ordinary line, because `presentation.drawsHistory` had no caller.

- `presentedPlot` now marks the plot `levelOnly`.
- `pool.seriesOptionsForPlot` hides the line's ink (`lineVisible: false`) and shows the price line and value tag at the latest value.
- The series keeps every value, so the crosshair and legend still read each bar.
- `lineVisible: true` (LWC's own default) is now restated on every line-family bind, per the pool's key-set rule. The eight built-in flip-parity rails list it among their restated defaults.

Conditional colouring, background shading, markers for crosses, histogram+line combinations and multiple plots already exist (Batch 2: `set_color_states`, `set_marker`, tables). They are unchanged.

## 5. Import

| Format | Status tonight |
|---|---|
| Pine Script | `ta.supertrend` tuple translates (new). `ta.change(source, length)` on a number translates to Pine's own definition `source - source[length]`, the same tree as `ta.mom` (new; a bool source and a computed length stay refused by name). Its own commit, so it can be dropped on review. The rest of the translator is unchanged |
| thinkScript | one-liner scans already translate (`close > Average(close, 50) and volume > …` → `exact`); audit P1-16 is closed on master |
| TC2000 PCF | unchanged, and **stays on its own door**: `c > avgc50 and v > 1000000` and `C > AVGC20 AND V > 100000` still read as PCF. Only a source that writes a whole lower-case price word (`close`, `volume`, …) moves to the native reader, because TC2000 refuses those names itself |

No imported code is executed. Every import becomes a canonical tree and passes the same budget, lint and save gates.

## 6. Tests

New rails:
- `supertrend.test.js` (differential, window independence, warm-up, slots);
- `nativeSpellings.test.js` (same tree, precedence, refusals, dialect door);
- `formulaHints.test.js`;
- `FormulaField.hint.test.jsx` (rendered text);
- `lastValueHorizontal.test.js` (visualization PR);
- the Python parity cases (trees, binding, values) in `test_call_expansions_parity.py`;
- `pine.arityHints.test.js` (`ta.change` = `ta.mom`, and the bool refusal).

Updated deliberately, each with a dated comment:
- **Behaviour now supported:** the parser's operator-set rail, the refusal-count rails (17 → 18, 41 → 42), the P2-8 truth test (now asserts support), and the Pine decomposition cases (supertrend now translates; misses 19 → 18).
- **Probes moved off `and`, which is no longer an offence:** the `let` marker probe and the concept vocabulary's planted probe.
- **Defaults restated:** the pool key set and the flip-parity defaults gain `lineVisible`.

Mutation checks: removing supertrend's warm-up guard turns 8 rail cases red, and breaking the upper band's ratchet turns 4 red. The file was restored and verified by sha256.

## 7. Agent handoff (Indicators → Agent; nothing Agent-owned was changed)

- `/converse` admits `supertrend(factor, atrPeriod)` and `supertrendDirection(factor, atrPeriod)` in any tree, through the same `call_expansions` enum the Agent's builder door already uses. The model's description says they are bounded recurrences with a ~400-bar warm-up. Slot ids: factor `<key>#…0`, period `…1`. `slotIdCases.json` pins both lanes.
- The chart-door planner now treats "supertrend" / "super trend" as a function term (`preflightRules.json::chartFunctionWords`).
- `and` / `or` / `not`, `if(…)` and `na` are *typed-formula* spellings only. Model trees keep using `&&`, `?:` and `0/0`. Nothing changes in the patch contract.
- Agent-side follow-up, if wanted: when a member asks for "supertrend" in Agent chat, the existing indicator-create path can seed `supertrend(3, 10)`.

## 8. Remaining, recommended next

1. **Multi-state accumulator** (§2) → Parabolic SAR, chandelier/ATR trailing stops with dual state.
2. **Read-back of `0 / 0` as "no value"** in `sentence.js`. This is the manifest owner's call, because it moves saved descriptions and Pine fixtures.
3. Native `tr`/`hl2` names stay refused by ruling. The hint now gives the spelling instead.
4. Audit P0-1 (TC2000 `STOC` argument order) still needs the owner-gated migration plan for saved definitions.
