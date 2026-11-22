# Settings parity for a timeframe input, the run lane only (2026-11-18, engine 77, #1831)

Coordinator ruling 2 (after #1805): build the five-step design, run lane only, on a fresh branch from master
(engine 75, `076cf3a878`), under three conditions: (a) at the DEFAULT every document is byte-identical and no
grade moves, proved on the full corpus on both lanes; (b) a member who moves the setting to a value the supply
cannot serve gets the existing refusal by name, and what they saw at the default is never silently replaced;
(c) the settings panel offers only the author's `options` or TradingView's list. Branch
`feat/pine-timeframe-input-setting`. It rides train e77 (coordinator, 2026-11-18).

## 1. The answer

- **Built as designed**, and the four witness captures grade **DIVERGE** at the moved timeframe on the runtime-on
  lane (PA ZigZag Fibonacci FAN, Alt Timeframe 1W / 1M, NYSE:RDDT and AMEX:SPY 1D from the listing,
  `rozz-2026-11-18`, local): 9 of 10 items on each. The setting reaches the run, and the run computes a different
  picture than TradingView's at that timeframe.
- **So a moved timeframe is drawn only on recorded evidence, and none exists.** The same rule a run half's moved
  settings follow (`runHalfSettingsAdmitted`). On every member surface a timeframe setting moved off its author's
  default is refused by name (`runtimeInputs.js::movedTimeframeRefusal`), never drawn. The runtime-on harness lane
  grades captures at a moved timeframe anyway (`__serveEveryTimeframeSettingForTests`), so the evidence that would
  admit one is measured on every run.
- **(a) holds:** the full vendor-harness corpus (915 captures), both lanes, master `076cf3a878` against the branch
  `764c1c744e`: `verdicts.json` and `summary.md` byte-identical on both.
- **Member-facing today (coordinator UI ruling, 2026-11-18):** a runtime document whose script has an
  `input.timeframe` shows it in its settings READ-ONLY at its default, with one line: "Changing this script's
  timeframe isn't available yet: our weekly and monthly results for it don't match TradingView yet."
  (`TIMEFRAME_LOCKED_SENTENCE`; the projected spec's `locked` becomes the field's `disabled` in
  `indicatorRegistry.fieldFromInput`, so the control is inert on the settings modal, the instance dialog and the
  phone sheet, and the line is its visible tip). It becomes a live menu when the evidence gate opens. A value moved
  anyway (a stored instance, a server call) is refused by name in the run. 7 of the 679 sample scripts are admitted
  by capability with one. A host document, and a run half, show nothing new.

## 2. What was built

1. **The setting, declared on load** (`runtime/runtimeInputs.js::withTimeframeInputs`, from
   `memberDocumentProjection.projectMemberDocument`): each `name = input.timeframe(…)` (and v1-v4's
   `input(…, type = resolution)`) whose default is a timeframe written as text (`isTimeframeText`: `''`, minutes,
   or a count of S / D / W / M) becomes an `enum` setting, `timeframe: true`, `fromTimeframe: true`. Its menu (c):
   the author's `options = […]` when given (every entry a timeframe, the default among them), else TradingView's
   own list (`TIMEFRAME_MENU`: 1, 3, 5, 15, 30, 45 minutes, 1-4 hours, 1D, 1W, 1M, as `[value, label]`), the
   author's default first when the list does not hold it, `''` labelled Chart. Never stored
   (`paramInputs.stripParamInputs` takes `fromTimeframe` off any save). What the member door MINTS is unchanged:
   `runtimeInputSpecsOf(source)` still skips a timeframe input, by name; only `{ timeframes: true }` reads one.
2. **The run reads the member's value as the input's default node** (`pineRuntimeFrontend.js::applyMemberDefault`,
   kind `timeframe`), so the request's host reader (`Resolver.requestTargetOf`, which already reads an
   `input.timeframe` default through its binding) reads it exactly as a literal, and `time(tf)` reads the same text.
   It is taken from `inputs` too, for a caller that hands no declared inputs (the server service's `runArgs`), so a
   run can never read two timeframes. Text that is not a timeframe is refused by name.
3. **The supply decides it with its rules unchanged** (`runtime/requestSupply.js` is not touched): a weekly or monthly
   merge above the chart is served, anything else refused with the supply's own sentence. Rail: with the gate open,
   a moved `"1W"` / `"1M"` equals the script with that timeframe WRITTEN as its default, value for value, and `"60"`
   on a daily chart is refused with the same sentence as `"60"` written in the source.
4. **The evidence gate** (section 1): `movedTimeframeServed()` is false on every member surface.
5. **The alert lane** (`api/services/alert_user_series.py`) computes the STORED document, which declares no timeframe
   setting, so an alert whose timeframe setting is moved is withheld by name (`setting:timeframe-moved`): at arm
   (`_gate_runtime_service`), per cycle (`column`), and never batched (`_prime_runtime_batch`). A reader of the
   source (`runtime_timeframe_inputs`) names each timeframe input and its default; a non-literal default counts any
   value as moved.

## 3. The witness: PA ZigZag at a moved timeframe

Re-graded as captured (patrick-54's run `rozz-2026-11-18`, packet `61a1e407…`; local), the branch at `764c1c744e`:

| capture | production | runtime-on (graded at the moved setting) |
|---|---|---|
| `pa-zigzag-fibonacci-fan-altw-rddt-1d-2026-11-17` (1W) | INCONCLUSIVE: a host document, no setting | DIVERGE, 9 of 10: `zigzag` 48 scattered bars (first bar 6, vendor 74.9, ours na); every fib level 485 bars from bar 22 (`0.000` vendor 34.847, ours 35.95) |
| `…-altw-spy-1d-2026-11-17` (1W) | INCONCLUSIVE | DIVERGE, 9 of 10: `zigzag` 662 bars from bar 15 (vendor 42.81, ours na); fib levels 6,538 bars from bar 16 |
| `…-altm-rddt-1d-2026-11-17` (1M) | INCONCLUSIVE | DIVERGE, 9 of 10: `zigzag` 7 bars from bar 278 (vendor 130.11, ours na); fib levels 305 bars (vendor na, ours a value) |
| `…-altm-spy-1d-2026-11-17` (1M) | INCONCLUSIVE | DIVERGE, 9 of 10: `zigzag` 134 bars from bar 64; fib levels 6,207 bars from bar 65 |

Before this branch all four refused "Alt Timeframe (tf) was moved and is not a setting of our document".

**The cause, named (coordinator ruling 4, 2026-11-18): not the setting, and not U-HTF-CALENDAR.** The setting
reaches the run and the weekly / monthly bars are right; the wall is in the request's evaluation, and it is on the
roadmap as **U-REQ-HOIST-COLUMN** (part of U-REQ). The script requests `zigzag()`, whose `_dir` recurrence makes the
body lower as statements hoisted into the request's region; there, `_isUp[1]` and `_isDown[1]` are lowered as
columns, computed once over the chart's DAILY bars, and the request's sub-run reads them at the requested bar's index
(`vm.js::runRequest` hands it `ctx.columns`; the column guard `carriesColumn` walks the request's value, not its
hoisted statements). Measured on our side with one request per value (RDDT 1W): `_isUp`, `_isDown`, `close[1]`,
`ta.highest(2)`, `ta.lowest(2)` equal TradingView's on 140 / 140 weeks; `_dir` does not (109 / 140); a model in which
only `_isUp[1]` / `_isDown[1]` read the chart's bar j-1 reproduces our `zigzag` on 140 / 140 weeks and 33 / 33 months,
and TradingView's model reproduces the vendor's on 140 / 140, 33 / 33 (RDDT) and 1,765 / 1,765, 407 / 407 (SPY).
Hoisting the request out of the ternary, and writing `_dir`'s comma line as two lines, change nothing. First bar:
RDDT 1W bar 6 (2024-04-01): TradingView's `_isUp[1]` is the previous week's (49.32 >= 46, true), so `zigzag` = 74.9;
ours is chart bar 1's (2024-03-22, 46 >= 50.44, false), so na.

## 4. Rails and mutation proofs

`runtime/__tests__/timeframeInputSetting.test.js` (20), `IndicatorSettingsDialog.timeframeLocked.test.jsx` (1: the
setting listed, inert, at its default, with the line; Length beside it live), `tests/test_runtime_timeframe_alert.py` (4). Mutants, each
restored from a saved copy and checked byte-equal (never `git checkout`), one heavy-lock hold:

| mutant | file | result |
|---|---|---|
| M1 the projection declares nothing | `runtimeInputs.js` | RED, 8 or more rails red, restored byte-equal: yes |
| M2 the run does not read a timeframe input's value as its default | `pineRuntimeFrontend.js` | RED, 7 rails red, restored byte-equal: yes |
| M3 a moved timeframe is drawn without evidence | `pineRuntimeFrontend.js` | RED, 2 rails red, restored byte-equal: yes |
| M4 a value handed only as `inputs` is not taken | `pineRuntimeFrontend.js` | RED, 2 rails red, restored byte-equal: yes |
| M5 a save keeps the projected setting | `paramInputs.js` | RED, 1 rail red, restored byte-equal: yes |
| M6 the door mints the setting | `runtimeInputs.js` | RED, 2 rails red, restored byte-equal: yes |
| M7 the alert lane never withholds a moved timeframe | `alert_user_series.py` | RED, 3 rails red, restored byte-equal: yes |
| M8 a locked setting is not inert (`fieldFromInput` ignores `locked`) | `indicatorRegistry.js` | RED, 2 rails red, restored byte-equal: yes |
| M9 the dialog draws a locked setting live | `IndicatorSettingsDialog.jsx` | RED, 1 rail red, restored byte-equal: yes |
| M10 the projection never locks | `runtimeInputs.js` | RED, 2 rails red, restored byte-equal: yes |

Controls: the JS rail and the Python rail green before the first mutant and after the last restore (CONTROL (no mutant) js 0 / py 0, CONTROL after restore js 0 / py 0), for M1-M7 and again for M8-M10 (their JS rail adds the dialog test).
Not railed: `_prime_runtime_batch` skipping a moved member (a defence: the per-cycle `column` call withholds it by name whatever the batch did).

## 5. Runs

| run | result |
|---|---|
| full corpus, runtime-on, master `076cf3a878` vs branch `764c1c744e` | 915 / 915, `verdicts.json` and `summary.md` byte-identical |
| full corpus, production, the same two | 915 / 915, byte-identical |
| the four `rozz-2026-11-18` captures | section 3 |
| remote tests (GitHub runners), engine + builder + hooks vitest, 6 shards, at `764c1c744e` | green except `src/hooks/usePreferences.additionsOnly.test.js` (`pages/screener/focus/board/useScanBoard.js`: 2 opaque `setPref` sites, 1 baselined), which this branch does not touch |
| remote pytest: the alert, admission, capability, run-half, refusal-code and ledger rails | green |
| the two checks red on #1831's first push (run 44285510851) | fixed: the seam rail matched a MENTION of `__serveEveryTimeframeSettingForTests` (the engine ledger's sentence), so it now matches an import or a call (with controls that a mention passes and an import and a call fail); and `tools/whole_app_engine_rails.txt` lists `timeframeInputSetting.test.js` (its seam rail walks `app/src`) |
| the read-only UI rails, local: `timeframeInputSetting`, `IndicatorSettingsDialog.timeframeLocked`, `runtimeInputs`, `runtimeInputKinds`, the dialog's own tests, the phone sheet's text and groups, the settings modal's a11y names | 8 files, 87 / 87 |
