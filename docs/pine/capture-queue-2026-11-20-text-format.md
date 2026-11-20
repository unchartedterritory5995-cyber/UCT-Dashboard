# Capture queue: text a script formats - a format string it builds, a date in `str.format`, a number pattern, a request value in a cell (2026-11-20)

Coordinator brief 2026-11-19 (the Pine language agent: the three text walls W1 / W2 / W4 the libraries agent
measured through the member door; design first, no engine change). Same procedure as
`docs/pine/capture-queue-2026-09-28.md`: capture from the listing, read every table cell character by character, and
record each capture's own `capturedAtUTC`. Every probe below is ours (licence `probe`) and was never compiled: a line
that does not compile, or a runtime error, IS a reading (record the error text and the line it names).

## Why: where each wall stands today

A cell whose text the engine cannot settle is never drawn with a guess: it is withheld and the drawing note says so.
Measured on this branch's base (master 4af5d417bd) with the translator and the member door:

- **W1, a format the script builds.** `str.tostring(x, f)` reads `f` only when it is a string literal written in the
  call. Anything else (`f_tickFormat()`, a name holding `"#.##"`, `"#." + "##"`, a `?:` of literals, a string built
  from an input) is carried as `fmtUnread` (`pine.js`, the `str.tostring` branch of the text reader) and the object
  runtime prints only `na` through it ("NaN", witnessed: position-size-calculator RDDT `"Position Size : NaN"`); every
  finite value is withheld (`objectRuntime.js` `textOf`). On the runtime lane the same call is refused by name
  (`runtime:call-text-state`, "a format computed while the bar runs", `pineRuntimeFrontend.js`). Measured on the
  served committed script position-size-calculator: at its defaults the label prints "Position Size : NaN"; with
  Entry / Stop / Target set (150 / 140 / 170) the whole label is withheld (`unplaced.label` 1), so a member loses the
  script's own answer the moment they use it.
- **W2, a date or time inside `str.format`.** `compileMessagePattern` (`pineTextFormat.js`) refuses every
  `{N,date,...}` / `{N,time,...}` element by name (`format:element:date`, `format:element:time`); the cell is dropped
  at translate time (`cell:text`, `pine:text-value`). The runtime lane serves no `str.format` at all.
- **W4, a request value in a cell.** The text is NOT the wall: through the member door an `AMEX:SPY` close read with
  `request.security` prints in a last-bar cell exactly as a plot of it would ("S 98.5" on a finished newest bar). What
  withholds such a cell is the VALUE: a weekly read on the newest bar (`request:htf-newest-unconfirmed`, Q-HTF-FORM),
  a forming chart (`request-other` is admitted for closed-bar history only), a symbol no bar store holds
  (`TVC:US10Y` is refused as `other-symbol:venue-foreign`; Black-Scholes' bare `'US10Y'` as `other-symbol:bare`), and
  on the runtime lane's object door any script with a request (`runtime:request`, "the script requests other bars",
  `runtime/runtimeColumns.js`, kept by RS RATING L5).

## What is already held

| settled | by | what it leaves open |
|---|---|---|
| `str.tostring` with a LITERAL `#` / `0` pattern: ten-decimal default, `#` optional and `0` required digits with no cap, ties half-up on the shortest decimal, no sign on a value that rounds to zero, grouping by three | CBC-FMT F1-F9 (`vw-fmt-tie-readings-rddt-1d-2026-11-15`, `w3-format-spy-1d-2026-09-22` and the vw-int-array-avg rows), `pineTextFormat.js` | whether a format the script BUILDS prints as the same literal does (W1); an empty format; a literal `+` before the digits over a negative value |
| `format.mintick`: rounds `n / tick` in binary, keeps the tick's decimals and trailing zeros | `vw-fmt-tie-readings` T08-T12, trend-targets-algoalpha RDDT | nothing W1 needs; it is the control in Q-TF-W1-b to -d |
| `str.format("{0,date,...}")` / `{0,time,...}` in UTC, not the exchange's zone: 2024-03-05 14:07:09 UTC prints "05 March 2024, 14:07:09" on AMEX:SPY; `yyyy-MM-dd`, `HH:mm:ssZ` = "14:07:09+0000", `short` = "3/5/24", `MMM d, yy` = "Nov 16, 26" | `vw-w3-format-date-spy-1d-2026-11-16` (6 cells) | month names other than March and November, one-digit hours, `a` / `h` / `E` / `z` / `X` / `S`, the named styles, quotes, an instant before 1970, `na`, a crypto symbol |
| `{N}` rounds the exact binary value to three decimals, an exact tie half-even | liquidation-levels RDDT 120.42566 -> "120.426"; `vw-fmt-tie-readings` T24 1.0005 -> "1", T25 2.0625 -> "2.062" | grouping at 1000 and more; whether 2.1875 is "2.188" (half-even) or "2.187" (half-down) |
| `{N,number,#.##}` has the length of `str.tostring(x, "#.##")` | `w3-format-spy-1d-2026-09-22` F12, 300 SPY closes, none a tie | ⛔ a DECIMAL tie: see Q-TF-N-a |

The published sentences, read 2026-11-19 from the Pine user manual's Strings page
(https://www.tradingview.com/pine-script-docs/concepts/strings/, "Formatting strings" and "Converting values to
strings"), quoted here so the repo holds them; an automated reader returned them, so re-read the page before a unit
cites one as its only licence:

- `str.format` can format "an "int" UNIX timestamp into a UTC date or time" and "It uses UTC+0 exclusively." The
  committed SPY capture agrees.
- "The possible numeric formatting patterns are similar to those for the format parameter of str.tostring()." Similar
  is not the same: Q-TF-N-a asks where they part.
- ⛔ Two sentences on the same page are contradicted by committed captures, which is why no unit here rests on the
  manual alone: "The default numeric format is "#.########", which rounds fractional digits to eight decimal places"
  (TradingView prints ten: `vw-int-array-avg-spy-1d-2026-09-30`, C43), and `format.mintick` "rounded to the minimum
  tick without trailing zeros" (it keeps them: "222.80", "263.50").

## The rows

No row needs a session except Q-TF-W4-a. Rows on one probe and one chart take one capture; the W4 pair is held apart
by its phase.

| id | probe | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-TF-W1-a | `vw-tf-tostring-built-fmt.pine` | AMEX:SPY 1D | B01-B14: does each pattern print the same through a series `?:`, a string built by `str.replace_all` and a name holding it as it does written as a literal (columns 2-4 against column 1)? B15-B19: an empty format, a literal "+" before the digits over a negative value, grouped patterns with required decimals, and the format picked per value by a `?:` (the shapes of 4c-nyse-market-breadth-ratio__722410befd, volume-delta-oi-delta-kioseff-trading__9056fd6b37 and volume-delta-hapharmonic__d5748870fd) | no | |
| Q-TF-W1-b | `vw-tf-tick-format-idiom.pine` | AMEX:SPY 1D, BITSTAMP:BTCUSD 1D, OANDA:EURUSD 1D | the tick printed with no format (I01), the format the tick idiom builds from it (I02), values through it (I03) beside `format.mintick` (I04), and the other idiom, a format of `str.length(tick text) - 2` decimals (I05-I07); the shape of black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2's three price cells | no | |
| Q-TF-W1-c | `vw-tf-tick-format-idiom-v5.pine` | AMEX:SPY 1D, OANDA:EURUSD 1D | I01-I04 at //@version=5, the version black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2 is written in: does the tick print the same as at v6? | no | |
| Q-TF-W1-d | `vw-tf-tick-format-idiom-v4.pine` | AMEX:SPY 1D, OANDA:EURUSD 1D | I01-I04 at //@version=4 with the helper ending on its last `:=`, the shape of the served position-size-calculator: what its Position Size line prints once a member sets Entry and Stop | no | |
| Q-TF-W2-a | `vw-tf-format-date-tokens.pine` | AMEX:SPY 1D, BITSTAMP:BTCUSD 1D | D01-D25: the common pattern letters at six fixed instants (one-digit fields, noon, midnight, year end, before 1970) and on the bar's `time` / `time_close`; the twelve month names and seven weekday names (table 2); UTC on both symbols, and whether a daily bar's `time` prints the session open in UTC (14:30 on a New York equity in November); D22 is the pattern of black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2's expiry cell | no | |
| Q-TF-W2-b | `vw-tf-format-date-tokens.pine` | AMEX:SPY 60 | the same battery on an intraday chart, where `time` and `time_close` are an hour apart | no | |
| Q-TF-W2-c | `vw-tf-format-date-rare.pine` | AMEX:SPY 1D, BITSTAMP:BTCUSD 1D | R01-R21: era, week-year, day of year, week of year, day-of-week number, the 1-24 and 0-11 hours, fractions of a second, the zone letters `z` and `X`; a letter TradingView does not hold may stop the script, and that error is the reading | no | |
| Q-TF-W2-d | `vw-tf-format-date-styles.pine` | AMEX:SPY 1D, BITSTAMP:BTCUSD 1D | S01-S10 the element with no pattern and the four named styles; S11-S13 quotes inside an element and around a brace; S14 / S15 the instant as a number; X01 an int `na`, X02 a float instant (milliseconds), X03 `timenow` (its shape only) | no | |
| Q-TF-N-a | `vw-tf-format-number-patterns.pine` | AMEX:SPY 1D | N01 decimal ties through `{N,number,#.##}` (served today: see below); N02 / N04 exact binary ties and halves; N03 a value that rounds to zero from below and one that rounds up to 1000; N05-N08 other patterns; N09 grouping under `{N}`; N10 the direction of an exact tie under `{N}`; N11-N12 small values, text, bool and int; N13 a pattern built while the bar runs; N14 one held in a name; N15 `close` (continuity with F12) | no | |
| Q-TF-W4-a | `vw-tf-request-text.pine` | NASDAQ:QQQ 1D | during regular hours, the newest daily bar forming: is each printed value (T01-T10) the plotted one (Q01-Q05) on the same bar, the other symbol's close and the weekly close included; and what the 10-year yield reads with its exchange prefix and without it (T06 / T07, Q03 / Q04) | yes | insession |
| Q-TF-W4-b | `vw-tf-request-text.pine` | NASDAQ:QQQ 1D | the next morning before the open, a fresh load: the same comparison on a finished newest bar, `T05` (the weekly `[1]`) and `T02` (the `[1]` of a same-timeframe read) included | no | preopen |

## What each answer moves

- **Q-TF-W1-a** grading columns 2-4 MATCH column 1 on B01-B14 licenses the W1 unit: a format the script builds is
  read as a TEXT expression (a name, a `?:`, `+`, `str.replace_all`), and its value is printed by the one formatter
  exactly where the literal would be, withheld by name where the literal would be. B15-B19 decide three grammar
  corners the unit refuses by name until then.
- **Q-TF-W1-b to -d** settle the tick idiom per symbol and per version. With W1-a they free the three price cells of
  black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2 (469, 470, 479; the script has other walls first,
  `pine:library-denied`) and keep position-size-calculator's Position Size line drawn when a member sets its inputs
  (served today; the line is withheld then).
- **Q-TF-W2-a to -d** license the date element: Q-TF-W2-a alone covers the Black-Scholes expiry cell's pattern
  (`MMMM dd, yyyy - HH:mm:ss`, line 476); its "Time Now" cell (line 475) reads `timenow`, which no capture can match,
  and stays withheld whatever the rows say.
- **Q-TF-N-a, row N01, is about a path the engine SERVES today.** `{N,number,#.##}` over a decimal tie prints the
  binary reading (1.005 -> "1", 163.265 -> "163.26", 2.675 -> "2.67") where `str.tostring(x, "#.##")` is witnessed
  printing the shortest-decimal reading ("1.01", "163.27", "2.68"). No capture shows which one `str.format` draws.
  If N01 grades the decimal reading, every such cell the engine draws today is wrong; until it is graded the safe
  move is to withhold a decimal tie there by name, as an exact binary tie already is.
- **Q-TF-W4-a / -b** grade a request value printed as text against the same value plotted, in both states of the
  newest bar. They move no script by themselves: the text follows the value, so what frees a request cell is what
  frees the request (Q-HTF-FORM, `docs/pine/capture-queue-2026-11-19-htf-forming.md`, and the closed-bar-history
  admission). `TVC:US10Y` stays refused by name whatever TradingView prints: no bar store holds it.
