# Capture queue — 2026-10-04, RT16 (clock, session and timeframe)

Branch `pine/rt16-clock-timeframe` (base `integrate/wave17-2026-10-03`, `6c557c3308`). What RT16
served is in the triage doc, section RT16. This file holds (1) the manual text RT16 W1 rests on,
quoted from TradingView's own reference data, and (2) the probes that would settle what RT16
left refused. Procedure: `docs/pine/VENDOR-HARNESS.md` (visibility gate, **Create new ▸
Indicator**, "Add to chart" binding gate, `__uctVH.capture`), inputs at defaults.

## Manual — the empty timeframe of `time()` (RT16 W1's only authority beyond the captures)

Extracted 2026-10-04 with the recipe in `docs/pine/pine-reference-extraction.md` (its script,
verbatim, into a scratch directory; the final assembly step failed — `a.t is not a function`, a
renamed minified export — so the strings were read straight out of the downloaded bundles, and
each string was tied to its function through the structural chunk's `args` entry for that
function). Nothing is paraphrased:

| version | function, parameter | text | bundles (string id) |
|---|---|---|---|
| v4 | `time(resolution, …)`, `time_close(resolution, …)`, `security(…, resolution, …)` | "Resolution. An empty string is interpreted as the current resolution of the chart." | `en.26771.d93d4d04181ebca94978.js` (172747) used in `13447.941cb30cbc7f08facdb1.js` |
| v5 | `time(timeframe, …)` (three overloads) | "Timeframe. An empty string is interpreted as the current timeframe of the chart." | `en.1576.7bdad2a21a705719d84a.js` (466489) |
| v6 | `time(timeframe, …)`, `time_close(timeframe, …)` (two overloads each) | "The timeframe of the timestamp calculation. If the value is an empty string, the function uses the script's main timeframe." | `en.60766.8202564bc36b553b0369.js` (45292) used in `42609.5cfad5ccc2c189932b0a.js` |

Also read, not acted on: v5 `time`'s session parameter — "Optional argument, session of the
symbol is used by default. An empty string is interpreted as the session of the symbol." (an
empty SESSION is unmeasured and stays refused); v4's own `time` example
`t1 = time(timeframe.period, "0000-0000:1234567")` titled "Time - days" (an example, not a
reading — Q-RT16a measures the whole-day / wrapping windows instead).

⛔ What this text does NOT license, and RT16 did not serve: `time_close("")` (its
`timeframe.period` form is itself unmeasured and refused), `timeframe.in_seconds("")`, and an
`input.timeframe("")` read as TEXT (C48 measured that it prints the empty string).

## Probes owed

None of these needs market hours: every one is read off historical bars. Where an intraday
chart is named, a capture on a weekend is as good as one at the open.

| id | probe / chart | what it settles | scripts it would move |
|---|---|---|---|
| Q-RT16a | new probe `vw-rt16-wrap-sessions`: rows `na(time(timeframe.period, s)) ? 1 : 0` and `(t - time) / 1000` for s = `"2000-0000"`, `"1900-0001"`, `"2000-0400:1234567"`, `"1700-0200:1234567"`, `"0000-0000:7"`, `"0000-0000:1234567"`, `"1800-1500"`, `"1800-1500:23456"` + `dayofweek`, `hour`, `minute` controls. **AMEX:SPY 60 extended ON** (bars 04:00-19:55: the 19:00 bars are inside `"1900-0001"` or not), **AMEX:SPY 1D** (≥ 300 bars), and **BITSTAMP:BTCUSD 60** (bars after 20:00 and on weekends — the only way to tell "never" from "20:00-24:00", and Sunday bars for `:7`) | the wrapping / whole-day session the host refuses by name (`sessionClockOf`: "wraps past midnight (or spans the whole day)") | **sessions** — its SOLE wall: with its two wrapping defaults replaced by non-wrapping windows (scratch substitution through `enterMemberDoor`, runtime state, 50-library store) it ATTACHES on the host lane. Behind other walls, measured the same way: asianrange-and-killzones (`"1900-0001"`; next `time("1440", sess)` — Q-RT16i), session-highs-and-lows-indicator-smc-sessions-dst-safe (`"2000-0000"`; next the runtime lane's `input.session` / session-parameter walls, its host outputs are hidden), chart-champions-part-1 (`"0000-0000:1..7"`; next the install budget, `vwap()` 961 > 960), session-hilo (`"1800-1500"`; next `input.time`), power-of-3-ict-01 (`"1900-0100"`, behind `str.tonumber`), atr-god (behind `ta.swma`, `ta.hma`) |
| Q-RT16b | `vw-time-session` re-run as `//@version=4` (rows S03/S05/S09 with the session UNSUFFIXED) on **BITSTAMP:BTCUSD 1D** and **AMEX:SPY 1D** | Pine v4's default days for an unsuffixed session (`pine-version-evolution.md` row 31 says the default changed `"23456"` → `"1234567"`; nothing measured which version) | volume-profile-v054beta (`"0930-1600"`, v4) — then its `syminfo.timezone == "America/New_York"` comparison, which is unserved by design |
| Q-RT16c | new rows `time_close(timeframe.period, 1)`, `time_close("D", 1)`, `time_close("W", 1)` (v6 `bars_back`) and `time_close(timeframe.period)` on **AMEX:SPY 1D** and **AMEX:SPY 60** | `time_close` with its second argument, and the chart's own `time_close(timeframe.period)` — both refused by name today (`clockCloseCallOf`) | higher-time-frame-fair-value-gap-zeroherotrading (behind `session.isfirstbar`, Q-RT16d) |
| Q-RT16d | rows `session.isfirstbar`, `session.islastbar`, `session.isfirstbar_regular`, `session.islastbar_regular`, `session.ismarket`, `session.ispremarket`, `session.ispostmarket` on **AMEX:SPY 5 extended ON**, **AMEX:SPY 5 RTH** and **AMEX:SPY 1D** | the `session.*` bar flags (unheld names, `pine:builtin`) | higher-time-frame-fair-value-gap-zeroherotrading (then Q-RT16c) |
| Q-RT16e | rows `timestamp("America/New_York", year(time, "America/New_York"), month(time, "America/New_York"), dayofmonth(time, "America/New_York") + 1, 9, 0, 0)` − `time`, and `hour(time_close, "America/New_York")` on **AMEX:SPY 1D** spanning both DST changes and a month end | `timestamp(tz, …)` with a day that overflows the month, and the clock fields over an instant other than `time` | smt-divergence-ict-killzones (its next wall after a served session clock; behind arrays / UDT walls RT14 owns) |
| Q-RT16f | rows `timeframe.from_seconds(n)` for n = 30, 60, 300, 3600, 14400, 86400, 172800, 604800, 2628003, 31622400, 31622401 on **AMEX:SPY 1D** | the text `timeframe.from_seconds` returns (the v6 reference states only "All values above 31,622,400 (366 days) return \"12M\"") | volatility-stop-mtf, cvd-cumulative-volume-delta-candles (library `PineCoders/lower_tf`) — both then meet `input.timeframe` in a value position and lower-timeframe requests (R-LTF), so neither completes |
| Q-RT16g | `corpus/committed/ict-killzone-index-version__28962c02dd.pine` as written on **AMEX:SPY 60** (RTH) and **AMEX:SPY 1D** | grades the script RT16 W1 attaches (host lane): its two killzone windows `"0830-1201"` / `"1300-1631"` America/New_York | itself |
| Q-RT16i | rows `time("1440", "0200-0600")`, `time("1440")`, `time("D", "0200-0600")` (`na ? 1 : 0` and `(t - time) / 1000`) on **AMEX:SPY 60 extended ON** and **AMEX:SPY 5 extended ON** | a session read on ANOTHER timeframe (`"1440"` minutes against the daily session) — refused by name ("read here on the chart's OWN timeframe") | asianrange-and-killzones (after Q-RT16a) |
| Q-RT16h | `corpus/committed/volume-profile-auto-line-v2__b0e947fd20.pine` as written on **NYSE:RDDT 1D** (from the listing) and **AMEX:SPY 60**, runtime pane permitted | grades the script RT16 W2 attaches (runtime lane; stays behind GT's starter allowlist until graded) | itself |

A runtime or compile error is a reading: record the message and the row.
