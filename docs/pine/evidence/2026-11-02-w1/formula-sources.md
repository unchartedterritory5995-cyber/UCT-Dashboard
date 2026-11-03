# W1 formula sources (2026-11-02)

Branch `feat/pine-w1-names`. The W1 re-review found `ta.iii` built from a wrong quote,
and a rail written from the same quote passed it. So every formula W1 adds was
checked again, name by name, against TradingView's own published text, with a
second, independent witness. One formula line per name only; the reference pages
are not copied here.

## How the published text was read

The Pine reference manual pages render in the browser. The text below was read on
2026-11-02 from the data those pages load (TradingView's own reference bundles):

| manual | page | data the page renders (sha256) |
|---|---|---|
| v6 | https://www.tradingview.com/pine-script-reference/v6/ | `static.tradingview.com/static/bundles/11967.e462a7c00ae7adac7b56.js` (`d1e68fa69b95e0e1fbdcdf64940e7aa2f1faf33f41b2a8c5bd7c9abc5be57d79`) |
| v5 | https://www.tradingview.com/pine-script-reference/v5/ | `static.tradingview.com/static/bundles/68136.6faf2783e02bb4e94c76.js` (`ca638cc74028518be38b7ba599055ab4e4c59b69357fe802b06d6b067e7d3459`) |
| v4 | https://www.tradingview.com/pine-script-reference/v4/ | `static.tradingview.com/static/bundles/86217.d71114366324d00688b3.js` (`0eccc7061971566b82fe2bd7f98ed3db8c99253e0318674367ea22d51d777651`) |

Entry anchors: `#var_ta.obv`, `#var_ta.pvt`, `#var_ta.iii`, `#var_ta.wvad`,
`#var_ta.wad`, `#fun_ta.cmo`, `#fun_ta.cog`, `#fun_ta.barssince` (v5/v6); `#var_obv`,
`#var_pvt`, `#var_iii`, `#var_wvad`, `#var_wad`, `#fun_cmo`, `#fun_cog`,
`#fun_barssince` (v4). Each body below is the "the same on pine" half of that entry's
own example.

The second witness is PyneCore (Apache-2.0; its README: "validated against
TradingView on real published scripts"), `src/pynecore/lib/ta.py` at commit
`fe29d4a4c56c1da56de3a4880f23e7a39cb95d09`:
https://github.com/PyneSys/pynecore/blob/fe29d4a4c56c1da56de3a4880f23e7a39cb95d09/src/pynecore/lib/ta.py

A third check, TradingView's own numbers: PyneCore's test fixtures
`tests/t01_lib/t20_ta/data/iii+nvi+obv.csv` (sha256 `c101184ebbdce31305d134139b08dba052d14ababcecc63b1f50d5aaa8932fb6`),
`accdist+pvi+pvt+wad+wvad.csv` (`dc1434af5198537778dba31634a80a9d1adac70f8536975830ca27f9588ca81b`) and `cci+cmo+cog.csv`
(`4b2b0065ac6643211486a049c41d28b32f721947288d9ed2402540704112041c`), same commit, are TradingView chart-data exports by their format
(TradingView's export header, JavaScript number formatting, `NaN`). Each published
body was computed over their OHLCV in plain float arithmetic and compared with the
exported column, `na` positions included (relative tolerance 1e-9; 1e-12 for `cog`).
These are not our captures: they turn no REFERENCE rail into VENDOR, and the capture
queue still owes our own rows.

## Per name

| name | published body (one line) | where published | second witness | TradingView export check | ours | verdict |
|---|---|---|---|---|---|---|
| `ta.obv` | `ta.cum(math.sign(ta.change(close)) * volume)` | v6 and v5 `ta.obv`; v4 `obv` (`cum(sign(change(close)) * volume)`) | PyneCore `obv`, ta.py:1720 (sign of the change; an `na` change is `na`; then `cum`) | 99 of 99 finite rows equal; bar 0 `na` in both | `app/src/components/chart/engine/ast/pine.js:1472` (`BUILTIN_SERIES_TREE.obv`) | MATCHES |
| `ta.pvt` | `ta.cum((ta.change(close) / close[1]) * volume)` | v6/v5 `ta.pvt`; v4 `pvt` | PyneCore `pvt`, ta.py:2418 | 149 of 149 finite rows equal; bar 0 `na` in both | `pine.js:1473` | MATCHES |
| `ta.wad` | `ta.cum(mom > 0 ? close - math.min(low, close[1]) : mom < 0 ? close - math.max(high, close[1]) : 0)`, `mom = ta.change(close)` | v6/v5 `ta.wad` (written with `trueHigh` / `trueLow` / `gain`); v4 `wad` | PyneCore `wad`, ta.py:3175 | 150 of 150 rows equal; bar 0 is 0 in both | `pine.js:1506` | MATCHES |
| `ta.wvad` | `(close - open) / (high - low) * volume` | v6/v5 `ta.wvad`; v4 `wvad` | PyneCore `wvad`, ta.py:3283 | 150 of 150 rows equal | `pine.js:1502` | MATCHES |
| `ta.iii` | `(2 * close - high - low) / ((high - low) * volume)` | v4 `iii`. ⚠️ The v6 and v5 pages print `((2 * close - high - low) / (high - low)) * volume` | PyneCore `iii`, ta.py:1017: the volume divides | dividing: 100 of 100 rows equal; the v5/v6 page's multiplying: 0 of 100 (row 1: TradingView -0.008536585365854584, multiplying -85.366) | `pine.js:1498` | FIXED (was the v5/v6 page's multiplying body) |
| `ta.cmo` | `100 * (sm1 - sm2) / (sm1 + sm2)`, `sm1 = math.sum(mom >= 0 ? mom : 0.0, length)`, `sm2 = math.sum(mom >= 0 ? 0.0 : -mom, length)`, `mom = ta.change(src)` | v6/v5 `ta.cmo` (`f_cmo`); v4 `cmo` | PyneCore `cmo`, ta.py:314: the same sums, with a TOLERANT sign test and `na` handling of its own (open item 2) | `ta.cmo(close, 20)`: 130 of 130 finite rows equal; first value on bar 20 (`length`) in both | `pine.js:2599` (`BUILTIN_CALL_TREE.cmo`); the source gate `pine.js:1646` (`cmoSourceCannotGap`) | MATCHES on `close` and every price the bar holds; a source that can be `na` after its first value is refused by name since the W1 fix; derived sources open (item 2) |
| `ta.cog` | `-num / math.sum(source, length)`, `num = Σ source[i] * (i + 1)` for i = 0 … length − 1, in that order | v6/v5 `ta.cog` (`pine_cog`); v4 `cog` | PyneCore `cog`, ta.py:342: the same loop order (its note: "MEASURED … bit-exact"), with `na` handling of its own (open item 3) | `ta.cog(close, 21)`: 130 of 130 finite rows equal; first value on bar 20 (`length - 1`) in both | `pine.js:2618` (`BUILTIN_CALL_TREE.cog`) | MATCHES on `close`; gappy sources open (item 3) |
| v1-v4 bare `barssince(cond)` | `barssince(condition) → series[integer]` (v4); `ta.barssince(condition) → series int` (v5/v6) | v4 `barssince` and v5/v6 `ta.barssince` carry the same description, return and remark texts word for word ("Counts the number of bars since the last time the condition was true."; "If the condition has never been met prior to the current bar, the function returns na."); the v5 migration guide's rename table lists it, spelled `barsince()` → `ta.barsince()` there: https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-5/ | PyneCore `barssince`, ta.py:196: 0 on a true bar, `na` before the first, +1 on each bar after | not in the fixtures; our own capture of the v6 spelling: `tests/fixtures/vendor/r11-barssince-spy-1d-2026-09-11.json` | the route, `pine.js:13443`, to master's `ta.barssince` on a pane, `pine.js:13896` (`barindex − valuewhenOccurrence(cond, barindex, 0)`) | MATCHES (W1 adds the route only) |

Rails, each computed in plain loops from the body above and sharing nothing with the
engine: `app/src/components/chart/engine/ast/pineW1Builtins.test.js`, one `describe`
per name. `ta.iii`'s adds a bar computed by hand (high 772.00, low 765.00, close
769.64, volume 46,335,000: 2.28 / (7 × 46,335,000) = 7.0296e-9), a `high == low` bar
and two zero-volume bars, which follow the engine's division-by-zero rule (IEEE
division, `interpret.js::BINARY['/']` and `ast_interpret._binary_div`; a non-finite
value is `na` at the column, `interpret.js::toColumn`), and three of TradingView's
exported rows. The bare `barssince` route in a `?:` arm:
`app/src/components/chart/engine/runtime/__tests__/w1BareConditionalHistory.test.js`.

## Open items

1. **Phase 1's `ta.accdist`, `ta.nvi`, `ta.pvi` still reach DRAWINGS (master behaviour,
   unchanged here on purpose).** On this tip a `label.new(…, str.tostring(ta.nvi))` is
   carried into the host object program (its trees call `cum`), and a runtime build that
   draws its own objects builds it; W1's three (`obv`, `pvt`, `wad`) are refused by name
   at every drawing door. Not held, because holding could stop drawing values that match
   TradingView: `ta.nvi` / `ta.pvi` are VENDOR-matched over SPY's full history from the
   listing (`vw-nvi-pvi-spy-1d-full-2026-09-27`, `pinePhase1Builtins.test.js:178`), so on
   a chart that starts at the listing a drawing of the level prints TradingView's number,
   and `ta.accdist`'s per-bar money flow is VENDOR-matched (`ta-accdist-delta5-2026-09-06`).
   The gap: on a chart that does not start at the listing, a table cell or a label of the
   level prints a number that moves with the fetch and carries no history-depth badge
   (since the W1 re-review a PAINT or a COLOUR that reads one carries it,
   `memberPaneDefinition.js::requirementTagsRaised`; a drawing still does not). Owner
   decision.
2. **`ta.cmo` on derived and gappy sources.** (a) PyneCore tests the momentum's sign
   tolerantly (within 1e-10 of zero counts as up; "measured on TradingView (probe
   m548)"), and its `core/pine_compare.py` says TradingView's float comparisons are
   tolerant at 1e-10 in general; ours is the published `mom >= 0`, exactly. (b)
   TradingView's v5/v6 remark for `ta.cmo` says "`na` values in the `source` series are
   ignored", which the literal body does not do. On a source with an `na` after its
   first value, the literal body draws a value on that bar and on the next `length` bars
   (an `na` momentum adds 0.0 to `sm1` and is skipped by `sm2`), where PyneCore returns
   `na` on that bar and advances neither sum.
   ⛔ W1 FIX (coordinator ruling, 2026-11-02) for (b): what TradingView draws there is
   unknown, and a remark does not settle it (the captures behind `interpret.js::NA` found
   the windowed family treating a gap three ways: `sum` skips, `dev` propagates,
   `highest`/`lowest` restart). So `ta.cmo` is served only over a source that cannot be
   `na` after its first value, and refused by name, `pine:arity`, over any other
   (`pine.js::cmoSourceCannotGap`). The test asks the engine's two existing authorities,
   never a list of its own: `isBarPriceSource` (a price the bar holds, `open` / `high` /
   `low` / `close`, or one of Pine's means of them, the rule `ta.vwap(source)` already
   used, now shared) and `neverNaTree` (a number, a comparison, `na(...)`). A computed
   source with no gap in fact (`ta.sma(close, 5)`, `close - open`, `close[1]`) and `volume`
   (a bar may carry none) are refused too: the rule is a whitelist. A warm-up is not a gap,
   so `ta.cmo(close, n)` is unchanged, and on master `ta.cmo` is refused entirely, so the
   gate stops drawing nothing that matched TradingView. Rails: `pineW1Builtins.test.js`.
   Capture queue W1-E: rows E01-E03 settle (a) (E02 and E03 are computed sources, refused
   today); rows E04/E05 decide whether the refusal in (b) can lift.
3. **`ta.cog` on gappy sources.** The same remark ("`na` values in the `source` series
   are ignored"); PyneCore skips the `na` and holds the last value. Ours, the literal
   body, is `na` while an `na` is in the window: it fails to draw there, and never draws
   a different number. Capture queue W1-E rows E06-E07.
4. **`ta.iii`'s printed bodies disagree with each other.** The v5/v6 pages print the
   volume multiplying; the v4 page, PyneCore and TradingView's exported values have it
   dividing, and ours now divides. Our own capture is still owed: W1-C rows C02 (must
   read 0 on every bar) and C12 (the v5/v6 page's body, must not). A zero-volume bar is
   a division by zero, `na` (a gap) by the engine's rule; TradingView's answer there is
   unmeasured (row C13 marks such bars).
