# N01: `str.format("{N,number,#.##}", x)` withholds a decimal tie by name (2026-11-19, engine number pending)

Coordinator ruling (2026-11-19), on the text-format design agent's finding: the engine SERVED
`{N,number,#.##}` over a decimal tie from the binary value, while `str.tostring(x, "#.##")` is witnessed printing the
decimal reading of the same values, and no capture shows which one `str.format`'s pattern draws. Withhold those ties
by name until capture row N01 (queue Q-TF-N-a, PR #2072) is graded. Branch `fix/str-format-number-ties`, on master
`4e148b30bc` (engine 85).

## 1. What was served

`pineTextFormat.js::formatMessageNumber(n, '#.##')` was `trimmedFixed(n, 2)`: `n.toFixed(2)`, the binary reading,
withheld only at an EXACT binary tie (`exactTieAt`). Measured with node on master:

| value | `{0,number,#.##}` (served) | `str.tostring(x, "#.##")` (TradingView, S10 T01-T07) |
|---|---|---|
| 1.005 | "1" | "1.01" |
| 163.265 | "163.26" | "163.27" |
| 145.795 | "145.79" | "145.8" |
| 2.675 | "2.67" | "2.68" |
| 127.705 | "127.7" | "127.71" |
| -1.005 | "-1" | "-1.01" |

F12 (`w3-format-spy-1d-2026-09-22`) pins only the LENGTH of `{0,number,#.##}` on 300 SPY closes, none a tie; T24 pins
the binary reading for the bare `{0}` only. So every one of these cells was unwitnessed and served.

## 2. What was built

- `pineTextFormat.js::decimalTieAt(n, d)`: the shortest round-trip decimal of the double (the text JavaScript prints,
  the reading `str.tostring` rounds, F6) carries exactly `d + 1` decimals and the last is a 5. That is exactly the set
  where some reading TradingView may use (binary, decimal half-up, decimal half-even) parts from the one printed:
  1.005 (binary down, decimal up), 0.025 (binary and half-up "0.03", half-even "0.02"). An exact binary tie is one too
  and keeps its own name.
- `formatMessageNumber`: the `#.##` branch withholds a decimal tie (`null`). The bare `{N}` branch is NOT touched: T24
  witnesses its binary reading (1.0005 -> "1"); its exact binary ties stay withheld until N10 (T25 2.0625 -> "2.062"
  alone does not tell half-even from half-down).
- `messageNumberWhy(n, fmt)` names every `str.format` number withhold. It asks the formatter first (the
  `tickNumberWhy` shape), so the formatter stays the one authority on whether a text is drawn. Names:
  `format:message-decimal-tie` (new), `format:message-exact-tie`, `format:message-grouping`,
  `format:message-negative-zero`, `format:message-na`, `format:message-pattern-unread`, and `percent:*` from
  `percentWithheldWhy`. `objectRuntime.js` records the name in the run's `stats.textsWithheldWhy`; the message path
  used to count `textsWithheld` with no name.
- The member sees the existing text-withheld sentence: the cell or label is not drawn, counted in the render state's
  `unplaced`, and the drawing note says "N of the M drawings this script holds on this chart could not be placed (a
  coordinate with no bar on this chart, or a text this chart could not compute) ...".
- No translator output changes: a saved document already holds `{t:'num', form:'message', fmt:'#.##'}` and the text is
  formatted per bar at draw time. By `scriptEngineVersion.js`'s contract no bump is required; it changes served text,
  so the engine number is the coordinator's (pending).
- `format:` is not a guard namespace: `python tools/support_loop/refusal_codes.py --check` reads "ok: 403 live codes, 1
  retired" and `--write` adds nothing.
- Runtime lane: `str.format` is not lowered there (the `str.` namespace is refused in `callFamily`), so the host
  object lane is the only printer. Python twin: carries no text.

## 3. Rails (`engine/__tests__/strFormatDecimalTie.test.js`)

- A: the six N01 values withheld and named; they are NOT exact binary ties (so the new rule, not the old, catches
  them); negative ties (-1.005, -2.675, -163.265, -0.025) and 999.995 withheld; 0.025 (a tie both readings round up)
  withheld; 0.125 keeps the exact-tie name.
- B: the predicate at 0 decimals (2.5, -0.5 ties; 2.51, 2.4, 3 not) and 3 decimals (1.0005, -1.0015 ties; 1.0004,
  1.00051, 1.0006 not); exponent-form doubles (5e-7); `{0,number,#}` and `{0,number,#.###}` still refused at translate
  by name; CONTROL: the bare `{N}` prints T24's "1" for 1.0005 and keeps its exact-tie withhold.
- C: 1.004 -> "1", 1.006 -> "1.01", 163.27, 2.68, 1.0051, -1.0051, 700 unchanged; a sweep of 14,286 values from -50
  to 50 (step 0.007): every non-tie prints the old binary reading, every tie is withheld (both arms counted); the
  named why agrees with the formatter (null iff null) for `{N}`, `#.##`, `percent`, `#`.
- D: CONTROL, `str.tostring`'s witnessed decimal reading unchanged for the six values through the one core, the
  object runtime's `formatNumber` and the runtime VM's `str.tostring/fmt`.
- E: through the object lane: a table with `str.format("F {0,number,#.##}", close)` and `"T " +
  str.tostring(close, "#.##")`; close = 163.265 draws only "T 163.27", `unplaced.cell` 1, `textsWithheldWhy`
  `{format:message-decimal-tie: 1}`; close = 163.27 draws both; close = -1.005 draws only "T -1.01".
- Neighbours run green with the change (remote lane, run 44618107146): `strFormat.vendor` (F12's 300 SPY lengths;
  liquidation-levels MATCH through the member door), `strTostringCore.cbcfmt` (T01-T30), `textRefusalNames`,
  `formatVendorRules`, `strTostringFormat.vendor`, `textValueForms.vendor`.

## 4. Mutants (`ci/mutants/n01-format-decimal-tie.json`)

N1 drop the tie check; N2 every value a tie (`decimalTieAt` true); N3 the formatter treats every value as a tie (F12
goes dark); N4 the tie read one digit early; N5 the withhold reaches the bare `{N}` (T24 lost); N6 the run counts
without naming. Each must turn its rail red and restore byte-equal (`tools/ci_mutant_runner.py`). Result: the
pine heavy mutants dispatch on this branch (see the PR).

## 5. Census

- Committed corpus (`corpus/committed/*.pine`): `{N,number,#.##}` appears in 4 scripts, every one walled
  (coverage map: not clean, not runtime-clean), and none reaches the `#.##` printer before or after this change:
  chart-vwap (`{1, number, #.##}`: the pattern with its leading space, `format:number-pattern: #.##`), cvd candles and
  cvd chart (the pattern is built with `+`: `format:pattern-not-literal`), delta-volume-candles-lucf (its text op is
  dropped before the pattern is read, `cell:text <- pine:reassign`; the pattern also carries `{4,number,percent}`).
  fx-market-sessions (`#.#####`, `#.#`; text ops dropped earlier), heikin-ashi-supertrend (`currency`) and
  ict-killzones (bare `{N,number}`, `percent`) carry other number elements, none served. 0 served committed scripts
  reach the `#.##` printer.
- Committed captures (`tests/fixtures/vendor/harness`, 921): 12 carry a number element in their source. On each,
  master and this branch translate NO `{N,number,#.##}` node, and every one grades INCONCLUSIVE (walled), identically
  before and after (`runs/capture-census.json`; a throwaway test run on the remote lane against master `38a5b2d8d6` and
  this change `24b7c180c5`, runs 44618215078 and 44618107146: the two outputs are equal row for row). No capture grades MATCH on a tie value; no member-visible cell
  on any capture changes.
- `w3-format-spy-1d-2026-09-22` (F12) still prints all 300 closes (none is a tie at two decimals).
- Not censusable here: the reference (271) and builtin (142) populations (`tools/pine_survey/cache` is absent on this
  box), and members' own scripts. What moves for them: a `{N,number,#.##}` text over a decimal tie goes from the
  binary reading (unwitnessed) to withheld, by name.

## 6. Lift

When N01 is graded: if TradingView prints the decimal reading ("1.01 | 163.27 | 145.8 | 2.68 | 127.71 | -1.01"),
`#.##` prints through the `str.tostring` core's decup reading and this withhold goes; if it prints the binary
reading, `decimalTieAt` leaves the `#.##` branch and the old text returns. Either way the lift is a re-grade plus a
one-line change in `formatMessageNumber`, and the rails here move to the captured texts.
