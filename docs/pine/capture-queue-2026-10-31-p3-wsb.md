# Capture queue — 2026-10-31, Phase 3 WS-B (builtins over runtime state)

Branch `feat/pine-p3-wsb`. WS-B serves these on the RUNTIME lane only (the lane is dark): `ta.rsi`
and `ta.hma` over a mutable value, `int(x)`/`float(x)` over any computed value, `str.tostring` in a
run that does not draw, tuple built-ins (`ta.macd/bb/kc/supertrend`) destructured, and Pine's clock
over a computed instant (`timestamp(...)`, `year/month/dayofmonth/dayofweek/hour/minute/second(t[, zone])`,
`time("", session[, zone])`). Each probe below is a semantic the code chose without a committed
capture. Standing ruling 2: until a probe is captured, the chosen rule is the one in the code and
the row stays named here. Probes are written inline and were never compiled on TradingView; run
them on the live rig with `tools/vendor_harness/tv_capture.js`, same procedure as
`docs/pine/capture-queue-2026-09-28.md`.

## B-CLK — `timestamp` edge cases (`runtime/clockFns.js`)

```pine
//@version=5
indicator("b-clk", overlay=false)
plot(timestamp("America/New_York", 2024, 1, 32, 9, 30), "C01 day 32")
plot(timestamp("America/New_York", 2024, 1, 2, 9, 75), "C02 minute 75")
plot(timestamp("America/New_York", 2024, 3, 10, 2, 30), "C03 spring-forward gap")
plot(timestamp("America/New_York", 2024, 11, 3, 1, 30), "C04 fall-back overlap")
plot(timestamp("GMT+5:30", 2024, 1, 2, 9, 30), "C05 fixed offset with minutes")
plot(timestamp(2024, 1, 2, 9, 30), "C06 no zone = syminfo.timezone")
plot(timestamp("2024-01-02"), "C07 date string, no zone")
plot(dayofweek(time + 15 * 3600000), "C08 field of a computed instant")
plot(hour(time, "UTC"), "C09 field in a fixed zone")
```

Settles: C01/C02 whether out-of-range components normalise like `Date.UTC` (the code does);
C03 which instant a non-existent New York wall time maps to (the code: the standard-time reading);
C04 which of the two instants an ambiguous one maps to (the code: the EARLIER, EDT); C05 the
`GMT+H:MM` spelling; C06/C07 the documented defaults; C08/C09 controls. Any symbol, 1D and 60.

## B-RSI — `ta.rsi` over a series with a hole in the middle

```pine
//@version=5
indicator("b-rsi")
var float x = 0.0
x := bar_index % 40 == 20 ? na : close
plot(ta.rsi(x, 14), "R01 rsi over a mutable value with holes")
plot(ta.rsi(close, 14), "R02 control")
```

Settles: the runtime's `CARRIED.rsiPine` HOLDS its state across an `na` (emits `na` on the hole and
the bar after, then resumes), the vendor rule `smoothStep` pins for ema/rma. The columnar lane
instead restarts after the last hole (it hands `computeRSI` only the finite tail). If TradingView
restarts, `rsiPine` is wrong over gappy sources; if it holds, the columnar lane is.

## B-CAST — declared-type coercion and `int()` (plan §3.4 "WS-B adds a probe")

```pine
//@version=5
indicator("b-cast")
float f = 3
var int k = 0
k := int(close / 7)
plot(f / 2, "T01 an int literal in a float slot divides as float")
plot(int(-0.4), "T02 int of a negative fraction")
plot(int(close / 7) - k, "T03 control: 0")
plot(int(na) , "T04 int of na")
```

Re-run with `//@version=6` adding `bool b = na` / `plot(b ? 1 : 0, "T05 v6 bool never na")`.
Settles: T02 the sign of the zero (the runtime answers +0 via `idiv(x, 1) + 0`); the runtime
truncates a non-whole `int()` where the host lane refuses it as unpinned (plan §3.6 item 5).

## B-STR — `str.tostring` default format in a run that does not draw

```pine
//@version=5
indicator("b-str")
var float y = 0.0
y := close / 3
plot(str.length(str.tostring(y)), "S01 length of the default format")
plot(str.tostring(1.0 / 3) == "0.33333333" ? 1 : 0, "S02 eight decimals")
plot(str.tostring(2.50) == "2.5" ? 1 : 0, "S03 trailing zero dropped")
```

Settles: the host formatter (`objectRuntime.js::formatNumber`) is what the runtime now uses in every
run, not only in a drawing run.

## B-CLK-CRYPTO — the exchange zone on a symbol that is not New York (review M2)

The runtime lane answers "the exchange's zone" (no zone argument, or `syminfo.timezone`) only on
a symbol whose zone is witnessed as America/New_York (`symbolScope.json::listing_fields`: NYSE,
NASDAQ, NYSE Arca). Everywhere else it declines by name (`runtime:clock-zone`). This probe is what
would let it answer crypto and FX:

```pine
//@version=6
indicator("b-clk-crypto")
plot(timestamp(2024, 1, 2, 0, 0), "Z01 no zone = syminfo.timezone")
plot(timestamp(syminfo.timezone, 2024, 1, 2, 0, 0), "Z02 syminfo.timezone named")
plot(hour(time + 3600000), "Z03 field of a computed instant, no zone")
plot(hour(time), "Z04 the bar's own hour")
plot(str.length(syminfo.timezone), "Z05 length of the zone name")
```

On BITSTAMP:BTCUSD 1D and 60, FX:EURUSD 1D, and AMEX:SPY 1D as the control. It settles each
exchange's zone (expected Etc/UTC for BITSTAMP), and whether the bar's own `hour(time)` is read in it
too. Today both lanes read `hour(time)` in New York on every symbol.

## Deferred, owed before serving (not built on this branch)

- **`weekofyear(t)`** over a computed instant (`previous-day-high-and-low-separators`,
  `woy = weekofyear(time + utcOffsetInMs)`): Pine's week numbering (ISO 8601 vs a Sunday-start US
  week) is not documented precisely. Probe: `plot(weekofyear(timestamp(2024, 12, 30, 9, 30)))`,
  `plot(weekofyear(timestamp(2023, 1, 1, 9, 30)))`, `plot(weekofyear(timestamp(2021, 1, 3, 9, 30)))`.
- **WS-G, `na` conditions below v4** (`runtime:na-test`): the rule per version is still the open
  question of `capture-queue-2026-10-02-rt1-na-test.md` (Q-NA-b for v4; v1 to v3 need the same
  probe with `//@version=3` and `study(`). `naConditionIsFalse` in `interpret.js` was not changed.
