# Computed number formats: folded where fixed, named where withheld (train e95, unit 1, 2026-11-22)

Train e95, unit 1. Engine number: NUMBER PENDING (the coordinator numbers the train). Counts and verdicts only: no
corpus script is named, and every TradingView value stays in the local capture store.

## The defect (member-facing, silent)

`str.tostring(x, fmt)` with `fmt` not a string literal was carried as `fmtUnread`, and every finite value was
WITHHELD: the member saw an EMPTY table cell, or a LABEL NOT DRAWN AT ALL, with the script attached and no word.
The studio's minimal script: `fmt = "#.##"; table.cell(t, 0, 0, str.tostring(high[1], fmt))`.

**Exposure, measured first** (the corpus: 5,091 population scripts + 288 TradingView reference examples):
- 169 scripts write a non-literal format somewhere (98 `format.percent`, 37 a name, 16 a ternary, 10 a call, 9 a join,
  1 `format.price`);
- 36 reach `textFormatUnread` through the member door (21 a name, 11 `format.percent`, 4 a call); **13 of the 36
  attach today**, so their members see a blank where a value belongs.
- By reading, about 10 are foldable (an alias of a literal, a ternary on an input, a function's format parameter,
  `str.repeat` on an input); about 9 are per symbol (a format built from `syminfo.mintick`, ticker ladders, a
  `syminfo.type` ternary); 11 are `format.percent`.

## The change

**(b) Served.** A format that is a pure function of literals and inputs is folded, at translate time, to the text it is,
and printed through the SAME one formatter a literal is (`objectRuntime.formatNumber`), which still withholds a
pattern it does not read:

| lane | where |
|---|---|
| host | `pine.js::Resolver.formatTextOf` (and `formatSwitchOf`), asked by the object pass's `str.tostring` reader before `fmtUnread` |
| runtime | `pineRuntimeFrontend.js::fixedFormatOf`, asked before `runtime:call-text-state` |
| both | `pine.js::formatTextCall`: `str.substring` / `str.replace_all` / `str.repeat` of fixed texts, ONE reading (an index outside the text, an empty target, a count past 64: not folded, never guessed) |

Folded: a literal; a name bound once (on the host, a function's parameter too); `a + b`; the three text calls; a
ternary whose test is fixed (a constant, or an input at the value the lane holds it at); a `switch` on a fixed subject
(host); an alias of `format.mintick` / `format.volume`, which then take their own paths. A text input the member door
declares as a live knob is not folded (it moves without a re-translation). Limit, recorded: a `switch`-held format
stays refused on the runtime lane (a `switch` value is a slot there); the host lane folds it.

**(a) Named.** A text still withheld for its format says so in the drawing note (`objectRuntime.js`,
`FORMAT_WITHHELD_KEY`), only for an object or cell whose CURRENT text is withheld (a later clean write clears it):
- a computed format: "A value in this table is not shown: its number format is computed by the script. UCT shows it
  when the format is written out." / "A label is not drawn: its number format is computed by the script. UCT draws it
  when the format is written out.";
- `format.percent` (and `format.price`, `format.inherit`): "...: it is written with format.percent, which UCT does not
  print yet.";
- a written-out pattern the formatter does not print yet (e.g. `"#.##%"`, an unmeasured tie): "...: UCT does not print
  this number in its format yet." (coordinator ruling: the same silent-blank class).

`format.percent` stays withheld until a TradingView capture settles it: probe
`tools/visual_conformance/probes/vw-format-percent.pine` (UCTPROBE_VW_FORMAT_PERCENT, 12 values beside `"#.##"`,
NYSE:RDDT 1D and AMEX:SPY 1D), scheduled by the coordinator.

**The assistant.** Rule 13 (`pine_authoring.FORMAT_LITERAL_RULE`, interim) came out in this commit, as its tripwire
demanded; rule 13 is now the percent sentence alone (`PERCENT_FORMAT_RULE`, coordinator ruling), with
`tests/test_script_format_is_a_literal.py` as ITS tripwire. `tools/value_cases/script_lane.mjs` carries the run's
sentences as `drawn.why` (additive: a case with nothing withheld has exactly its old keys, railed).

## Rails and mutants

- `engine/__tests__/formatFold.test.js` (27): each folded shape on both lanes against the written-out format; a label;
  a function's format parameter; an alias of `format.mintick`; a member's input value reaching the runtime fold; each
  sentence; `na` prints "NaN" and is not named; a later clean write clears the mark; a write withheld for another
  reason is not called a format; what is not folded (out-of-range substring, a declared text knob, an unread pattern).
- `tests/test_script_format_is_a_literal.py` (19) and `tests/test_script_higher_timeframe_last_bar.py`.
- Mutants `ci/mutants/e95-format-fold.json`, FF1-FF9, each KILLED locally with a byte-identical restore (FF7 first
  survived; its rail was added).

CENSUS_AND_GRADE_PENDING

## Findings outside this unit

- Per-symbol formats (`f_tickFormat()` from `syminfo.mintick`, ticker ladders, `syminfo.type` ternaries) are known at
  bind for a chart's symbol, so they may be foldable per chart: a candidate fold, not this unit.
- On bar 0 the host lane draws `timeframe.change(...)` as `na` where the run draws 0 (from #2474's evidence; not
  changed here).
- `var int len = input(14)` builds on the runtime lane in isolation; the corpus row that reported it "never given a
  value" is one of 5 rows with a `var` numeric input, to be measured.
