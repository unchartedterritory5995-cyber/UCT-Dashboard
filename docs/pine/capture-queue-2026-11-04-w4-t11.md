# Capture queue: 2026-11-04, W4-T11 text builtins over runtime values

Branch `feat/pine-w4-t11-runtime-text`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`:
visibility gate, **Create new > Indicator**, the "Add to chart" binding gate,
`__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`. Inputs at defaults. SPY 1D.

The runtime lane serves these names today from TradingView's PUBLISHED reference, not from a capture
(`runtime/text.js`, rail `runtime/__tests__/w4TextFns.test.js`). Where a row says "raised", this lane
STOPS the script with `runtime.error` (one authority: `PineRuntimeError`); if a row below shows `na`
instead, change that one function. The object door keeps master's answer for all of them
(`objectDoorGate.test.js`) until a MATCH here.

Every probe plots one number per case so a stop shows as an absent series; a script that stops on
TradingView shows the error banner instead of the plots, which is itself the datum (note the banner text).

## W4-T11-a: `str.substring` with a bad position (raised here)

```pine
//@version=6
indicator("vw-w4t11-a-substring")
string s = "abcdef"
plot(str.length(str.substring(s, 1, 3)), "A01_inrange_expect_2")
plot(str.length(str.substring(s, 4)), "A02_two_arg_expect_2")
// one case per run; uncomment ONE at a time and capture each
// plot(str.length(str.substring(s, 0, 9)), "A03_end_past_length")
// plot(str.length(str.substring(s, 5, 2)), "A04_end_before_begin")
// plot(str.length(str.substring(s, -1, 2)), "A05_negative_begin")
// plot(str.length(str.substring(s, 0.5, 2)), "A06_fractional_begin")
```

| row | probe | what it settles |
|---|---|---|
| A01/A02 | `vw-w4t11-a-substring.pine`; AMEX:SPY 1D | the 0-based, end-exclusive rule and the 2-argument form (expected 2 and 2) |
| A03-A06 | one file per case: `vw-w4t11-a03-substring-end-past-length.pine`, `vw-w4t11-a04-substring-end-before-begin.pine`, `vw-w4t11-a05-substring-negative-begin.pine`, `vw-w4t11-a06-substring-fractional-begin.pine`; AMEX:SPY 1D | runtime error (script stops, banner text) vs `na` (str.length of na) vs a clamp, per bad position |

## W4-T11-b: `str.tonumber`, `str.replace` edge texts

```pine
//@version=6
indicator("vw-w4t11-b-tonumber-replace")
plot(str.tonumber("  5 "), "B01_padded")
plot(str.tonumber("+5"), "B02_plus_sign")
plot(str.tonumber("5."), "B03_trailing_dot")
plot(str.tonumber(".5"), "B04_leading_dot")
plot(str.tonumber("1e5"), "B05_exponent")
plot(str.tonumber(""), "B06_empty")
plot(str.length(str.replace("aaaa", "aa", "X", 1)), "B07_overlap_expect_3_if_non_overlapping")
plot(str.length(str.replace("abc", "b", "XY", 3)), "B08_missing_occurrence_expect_3")
// one case per run: plot(str.length(str.replace("abc", "", "X")), "B09_empty_target")
```

| row | probe | what it settles |
|---|---|---|
| B01-B06 | `vw-w4t11-b-tonumber-replace.pine`; AMEX:SPY 1D | which texts read as numbers (this lane: B02-B05 are numbers, B01 and B06 are `na`) |
| B07/B08 | `vw-w4t11-b-tonumber-replace.pine`; AMEX:SPY 1D | occurrences count non-overlapping from 0; a missing occurrence leaves the text unchanged |
| B09 | `vw-w4t11-b09-replace-empty.pine` (its own file: one case per run); AMEX:SPY 1D | empty target: raised here; if TradingView returns the source or inserts, change `replaceNth` |

## W4-T11-c: `str.format_time` letters, zones, `na` time

```pine
//@version=6
indicator("vw-w4t11-c-format-time")
t = time
plot(str.length(str.format_time(t, "yyyy-MM-dd HH:mm:ss")), "C01_basic_expect_19")
plot(str.length(str.format_time(t, "hh:mm a")), "C02_twelve_hour")
plot(str.length(str.format_time(t, "EEE MMM")), "C03_names")
plot(str.length(str.format_time(t, "HH:mm Z")), "C04_zone_letter")
plot(str.length(str.format_time(t, "HH:mm", "UTC")), "C05_other_zone")
plot(str.length(str.format_time(na, "yyyy")), "C06_na_time")
```

| row | probe | what it settles |
|---|---|---|
| C01 | `vw-w4t11-c-format-time.pine`; AMEX:SPY 1D | the served letters `yyyy yy MM M dd d HH H mm m ss s` in the exchange zone |
| C02-C05 | `vw-w4t11-c-format-time.pine`; AMEX:SPY 1D | letters and zones this lane REFUSES by name until captured |
| C06 | `vw-w4t11-c-format-time.pine`; AMEX:SPY 1D | the answer for an `na` time: this lane returns the empty text; unproven |
