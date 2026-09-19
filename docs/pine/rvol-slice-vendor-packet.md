# RVOL slice — owner vendor measurement packet

**What this is.** Ten measurements to take at your own signed-in TradingView session,
before the matching code is written. They are the nine listed in
`docs/superpowers/specs/universal-indicator-ecosystem/2026-09-19-pine-runtime-rvol-slice-design.md`
§6, plus one one-line data-feed check that decides whether TradingView's in-session
volume is comparable to ours at all.

**Where the answers go.** `docs/pine/rvol-slice-vendor-answers.json`. One entry per
measurement, keyed `M1`…`M10`. Every entry ships `"status": "unmeasured"` with empty
answers; you fill the fields, set `symbol`/`timeframe` to what was actually on screen,
stamp `measured_at`, and flip `status` to `"measured"`. Nothing in this repo is allowed
to guess these — `app/src/components/chart/engine/ast/vendorAnswers.test.js` fails the
build if an entry wears the word `measured` without a real answer and a timestamp.

**Time:** roughly 45–75 minutes if nothing surprises you. Every measurement is
independent — stop after any one and the rest stay `unmeasured`.

---

## ⛔ Before you start — the hazards, carried over from `capture-procedure.md`

These are not re-derived here. They are the ones that have already cost this programme
real time, restated because this packet is run by hand instead of by the rig.

### 1. The visibility gate

**A study added while the chart tab is not actually visible on a display gets a pane in
the model and no pixels.** It computes perfectly and shows you nothing, and the failure
looks exactly like a broken script. Keep the TradingView tab **in the foreground, on a
monitor that is switched on**, for the whole capture — in particular while you click
**Add to chart**.

If a study ever adds and the pane comes up blank, that is the first thing to check, not
the script. The pass condition, read from the tab you are driving (F12 → Console):

```js
document.visibilityState === 'visible'
  && window.screenY >= screen.availTop
  && (window.screenY + window.outerHeight) <= (screen.availTop + screen.availHeight)
```

⚠️ `visibilityState` is the load-bearing half. The geometry terms cannot detect a hidden
tab — a hidden tab reports `screenY 0` / `outerHeight 0`, which sails through a bound
whose display origin is negative.

### 2. ⛔⛔ Never open one of your own saved scripts for editing

Every snippet here goes into a **new blank indicator**:

> **Pine Editor → the script-title chevron (`∿ Untitled script ⌄`) → Create new ▸ Indicator**
> (or **Open ▸ New blank indicator**), then select all → delete → paste.

A saved user script is account-scoped (`Script$USER;<id>`), **not** layout-scoped —
copying a layout copies the *reference*. Editing one changes it in every layout that uses
it, including your working charts. Nothing in this packet needs an existing script, so
never open one.

Also: **do not Save, do not Publish.** "Add to chart" is the whole interaction. Close the
editor tab without saving when you are done.

### 3. Nothing here is automated with your credentials

Standing ruling, and independently a hard line. No agent drives this session, no script
signs in, no token is minted. You click; you paste the numbers back. That is the entire
protocol, and it is why the packet is written as instructions rather than as code.

### 4. The rig is a scratch chart with zero studies

Use a throwaway layout (the programme's is `UCT CAPTURE RIG — no studies`,
`https://www.tradingview.com/chart/01f1AcIj/`), or any chart you do not mind changing.
**One study at a time** — remove the previous indicator before adding the next, so a
legend never sits over the table you are trying to read.

```
before a measurement   study count = 0
during                 study count = 1
after                  study count = 0, editor closed, nothing saved
```

### 5. Do not correct a number that looks wrong

Record exactly what the screen shows. A value that looks off is the finding; "fixing" it
in transit destroys the measurement. Same for errors: if TradingView refuses a snippet,
**do not edit the Pine yourself** — copy the error text verbatim into the entry's
`notes` (or into the `error_text` answer where one exists) and move on.

⚠️ **Honest gap, stated plainly:** these snippets have not been through a Pine compiler
before reaching you. Every function and signature used is standard documented v6, but a
typo is possible and an error is a legitimate outcome to report rather than a failure on
your part.

### 6. How to read per-bar values

Two readouts are used throughout:

- **The table** — drawn in the indicator's own pane, top-right. It shows the state of the
  **last bar** only.
- **The Data Window** — the right-hand toolbar icon that looks like a small table (or
  right-click the chart → *Data Window*). Hover any bar and it lists every plotted series
  by title for **that** bar. This is how you read a historical bar without changing the
  chart.

---

## How to fill in an answer

Open `docs/pine/rvol-slice-vendor-answers.json` and edit the entry in place — keep the
file's existing formatting (2-space indent), do not run it through a formatter.

```jsonc
{
  "id": "M6",
  "status": "measured",                      // was "unmeasured"
  "measured_at": "2026-09-20T14:31:00-04:00",// when you read it
  "symbol": "NASDAQ:AAPL",                   // what was on screen
  "timeframe": "1D",
  "answers": {
    "tostring_hash_0_5": { "type": "string", "value": "1" },   // was null
    "math_round_rule":   { "type": "enum", "allowed": [...], "value": "half up (away from zero)" }
  }
}
```

**Three statuses, and only three:**

| status | means |
|---|---|
| `unmeasured` | not taken yet. Answers stay `null`. This is how every entry ships. |
| `measured` | taken, and **every** answer field is filled with what the screen said. |
| `blocked` | you tried and could not — a compile error, a missing menu, a plan limit. **`notes` must say why.** |

⛔ **A half-finished entry stays `unmeasured` or becomes `blocked`.** Never `measured`.
The whole point of the fixture is that the word `measured` cannot appear over a guess.

⭐ `na`, `n/a`, `NaN`, `0` and `false` are **real vendor answers** here, not placeholders —
write them literally where that is what the screen said. The validator knows the
difference. What it refuses is `TBD`, `?`, `-`, `unknown`, `pending` and friends.

---

# The ten measurements

---

## M1 — Request merge

**The question.** What value lands on the last bar for `request.security(sym, "D", close)`
on an **intraday** chart, and for `request.security(sym, "30", close)` on a **daily**
chart — historical bar versus realtime bar — what the default `lookahead` and `gaps`
actually do, and what comes back **before** the requested series has its first bar.

**Chart.** `NASDAQ:AAPL`. Run the script **twice**: once on the **5-minute** chart
(`reqTf` input = `D`), once on the **1D** chart (`reqTf` input = `30`).

⭐ Run this one while the US market is **open**, or the "historical vs realtime" half has
nothing to compare — the last bar has to be a live, forming bar.

### The script

```pine
//@version=6
indicator("uct-M1-request-merge", overlay = false)

// Run A: chart = 5 minutes, reqTf = "D".
// Run B: chart = 1 day,     reqTf = "30".
reqTf   = input.string("D", "Requested timeframe", options = ["D", "30"])
lateSym = input.symbol("NASDAQ:CRWV", "A symbol that listed AFTER this chart starts")

// The DEFAULT call -- no gaps argument, no lookahead argument. Whatever Pine's
// defaults do IS the measurement.
reqDefault = request.security(syminfo.tickerid, reqTf, close)

// Three explicit controls, so "the default behaves like X" is a comparison on the
// same bar and not a memory.
reqLookOn  = request.security(syminfo.tickerid, reqTf, close, gaps = barmerge.gaps_off, lookahead = barmerge.lookahead_on)
reqLookOff = request.security(syminfo.tickerid, reqTf, close, gaps = barmerge.gaps_off, lookahead = barmerge.lookahead_off)
reqGapsOn  = request.security(syminfo.tickerid, reqTf, close, gaps = barmerge.gaps_on,  lookahead = barmerge.lookahead_off)

// A daily request for a symbol that did not exist for most of this chart's history.
// This is the "before the requested series has its first bar" half.
reqLate = request.security(lateSym, "D", close, ignore_invalid_symbol = true)

var int   lateNaBars  = 0
var int   lateFirstTs = na
var float lateAtFirst = na
var bool  lateNaAtFirst = na

if na(reqLate)
    lateNaBars := lateNaBars + 1
if not na(reqLate) and na(lateFirstTs)
    lateFirstTs := time
if barstate.isfirst
    lateAtFirst   := reqLate
    lateNaAtFirst := na(reqLate)

// Plotted so the Data Window can be scrubbed back to a CLOSED historical bar.
plot(close,      "chart_close")
plot(reqDefault, "req_default")
plot(reqLookOn,  "req_lookahead_on")
plot(reqLookOff, "req_lookahead_off")
plot(reqGapsOn,  "req_gaps_on")
plot(reqLate,    "req_late_symbol")

var table t = table.new(position.top_right, 2, 12, border_width = 1)

if barstate.islast
    table.cell(t, 0, 0,  "chart tf",             text_color = color.white)
    table.cell(t, 1, 0,  timeframe.period,       text_color = color.yellow)
    table.cell(t, 0, 1,  "requested tf",         text_color = color.white)
    table.cell(t, 1, 1,  reqTf,                  text_color = color.yellow)
    table.cell(t, 0, 2,  "chart close",          text_color = color.white)
    table.cell(t, 1, 2,  str.tostring(close),    text_color = color.yellow)
    table.cell(t, 0, 3,  "req DEFAULT",          text_color = color.white)
    table.cell(t, 1, 3,  str.tostring(reqDefault), text_color = color.yellow)
    table.cell(t, 0, 4,  "req lookahead_on",     text_color = color.white)
    table.cell(t, 1, 4,  str.tostring(reqLookOn),  text_color = color.yellow)
    table.cell(t, 0, 5,  "req lookahead_off",    text_color = color.white)
    table.cell(t, 1, 5,  str.tostring(reqLookOff), text_color = color.yellow)
    table.cell(t, 0, 6,  "req gaps_on",          text_color = color.white)
    table.cell(t, 1, 6,  str.tostring(reqGapsOn),  text_color = color.yellow)
    table.cell(t, 0, 7,  "barstate.isrealtime",  text_color = color.white)
    table.cell(t, 1, 7,  str.tostring(barstate.isrealtime), text_color = color.yellow)
    table.cell(t, 0, 8,  "late sym na bars",     text_color = color.white)
    table.cell(t, 1, 8,  str.tostring(lateNaBars), text_color = color.yellow)
    table.cell(t, 0, 9,  "late sym @ first bar", text_color = color.white)
    table.cell(t, 1, 9,  str.tostring(lateAtFirst) + " / na=" + str.tostring(lateNaAtFirst), text_color = color.yellow)
    table.cell(t, 0, 10, "late sym 1st value",   text_color = color.white)
    table.cell(t, 1, 10, na(lateFirstTs) ? "never" : str.format_time(lateFirstTs, "yyyy-MM-dd", "America/New_York"), text_color = color.yellow)
    table.cell(t, 0, 11, "chart 1st bar",        text_color = color.white)
    table.cell(t, 1, 11, str.format_time(ta.valuewhen(barstate.isfirst, time, 0), "yyyy-MM-dd", "America/New_York"), text_color = color.yellow)
```

### What to click

1. Symbol `NASDAQ:AAPL`, timeframe **5m**.
2. Pine Editor → **Create new ▸ Indicator** → select all → delete → paste → **Add to chart**.
3. In the indicator's settings (hover the legend → ⚙), set **Requested timeframe** to `D`.
4. Read the table.
5. Open the **Data Window** and hover a bar from **two or three sessions ago** (a bar that
   is definitely closed, mid-session, not the first or last bar of its day). Read
   `req_default`, `req_lookahead_on`, `req_lookahead_off` there.
6. Change the chart timeframe to **1D**, set **Requested timeframe** to `30`, and repeat
   steps 4–5.
7. On the **1D** run, note the oldest bar on which `req_default` has a value at all (scrub
   left in the Data Window until it goes `n/a`).
8. Remove the indicator.

### What to read off, and where it goes

`measurements[id="M1"].answers.*`

| answer field | read it from |
|---|---|
| `intraday_chart_tf` | the chart's timeframe on run A, e.g. `5` |
| `intraday_req_D_last_bar` | table row **req DEFAULT**, run A |
| `intraday_req_D_matches_on_last_bar` | compare against table row **chart close** — is the daily request today's still-forming close, or yesterday's? One of: `chart close (today, still forming)` · `previous day's daily close` · `neither` |
| `intraday_req_D_on_a_closed_historical_bar` | step 5, on the closed bar. One of: `that day's own daily close` · `the previous day's daily close` · `neither` |
| `default_lookahead_matches` | which of `req_lookahead_on` / `req_lookahead_off` the DEFAULT equalled on the closed historical bar. One of: `lookahead_off` · `lookahead_on` · `neither` |
| `default_gaps_matches` | whether the DEFAULT tracked `req_gaps_on` (mostly `n/a`, filled only on the requested series' own bar boundaries) or not. One of: `gaps_off` · `gaps_on` · `neither` |
| `daily_chart_tf` | run B's chart timeframe, e.g. `1D` |
| `daily_req_30_last_bar` | table row **req DEFAULT**, run B |
| `daily_req_30_which_30m_bar` | compare against the day's own OHLC. One of: `the LAST 30-minute bar of that day` · `the FIRST 30-minute bar of that day` · `neither / something else` |
| `daily_req_30_oldest_bar_with_a_value` | step 7, as `YYYY-MM-DD` |
| `value_before_requested_series_first_bar` | table row **late sym @ first bar** — write it exactly as shown (`NaN`, `na`, a number…) |
| `na_bars_before_late_symbol_first_bar` | table row **late sym na bars**, as a number |
| `late_symbol_used` | the `lateSym` input you actually used |
| `late_symbol_first_value_date` | table row **late sym 1st value** |

⚠️ If `late sym na bars` is `0` **and** `late sym 1st value` equals the chart's first bar,
the late symbol was not late enough on this chart — pick a more recent listing and rerun.
Note which one you used; a control that could not discriminate is worth recording.

---

## M2 — The session a plain string ticker uses

**The question.** Inside `request.security`, does a plain string ticker (`"NASDAQ:AAPL"`)
resolve to the **regular** session only, or does it carry **extended** hours too — and
does it follow the chart's own session setting?

**Chart.** `NASDAQ:AAPL`, **5 minutes**, with **Extended trading hours ON** for run A and
**OFF** for run B (chart settings ⚙ → *Symbol* → *Extended trading hours*).

⭐ Best taken outside 09:30–16:00 ET, or in the first hour, so there are pre-market bars
on screen to scrub to.

### The script

```pine
//@version=6
indicator("uct-M2-request-session", overlay = false)

// A PLAIN STRING ticker -- the thing under test.
plainTxt = input.string("NASDAQ:AAPL", "Plain string ticker")

plainReq = request.security(plainTxt, timeframe.period, close)

// Controls. Same symbol, session stated explicitly, plus the chart's own tickerid
// (which carries whatever session the chart is set to).
regReq  = request.security(ticker.new(syminfo.prefix, syminfo.ticker, session.regular),  timeframe.period, close)
extReq  = request.security(ticker.new(syminfo.prefix, syminfo.ticker, session.extended), timeframe.period, close)
tidReq  = request.security(syminfo.tickerid, timeframe.period, close)

var int nBars     = 0
var int nPlainNa  = 0
var int nRegNa    = 0
var int nExtNa    = 0
nBars    := nBars + 1
nPlainNa := nPlainNa + (na(plainReq) ? 1 : 0)
nRegNa   := nRegNa   + (na(regReq)   ? 1 : 0)
nExtNa   := nExtNa   + (na(extReq)   ? 1 : 0)

plot(close,    "chart_close")
plot(plainReq, "req_plain_string")
plot(regReq,   "req_session_regular")
plot(extReq,   "req_session_extended")
plot(tidReq,   "req_tickerid")

var table t = table.new(position.top_right, 2, 11, border_width = 1)

if barstate.islast
    table.cell(t, 0, 0,  "syminfo.session",   text_color = color.white)
    table.cell(t, 1, 0,  syminfo.session,     text_color = color.yellow)
    table.cell(t, 0, 1,  "bar: premarket",    text_color = color.white)
    table.cell(t, 1, 1,  str.tostring(session.ispremarket),  text_color = color.yellow)
    table.cell(t, 0, 2,  "bar: market",       text_color = color.white)
    table.cell(t, 1, 2,  str.tostring(session.ismarket),     text_color = color.yellow)
    table.cell(t, 0, 3,  "bar: postmarket",   text_color = color.white)
    table.cell(t, 1, 3,  str.tostring(session.ispostmarket), text_color = color.yellow)
    table.cell(t, 0, 4,  "chart close",       text_color = color.white)
    table.cell(t, 1, 4,  str.tostring(close),     text_color = color.yellow)
    table.cell(t, 0, 5,  "req plain string",  text_color = color.white)
    table.cell(t, 1, 5,  str.tostring(plainReq),  text_color = color.yellow)
    table.cell(t, 0, 6,  "req session.regular",  text_color = color.white)
    table.cell(t, 1, 6,  str.tostring(regReq),    text_color = color.yellow)
    table.cell(t, 0, 7,  "req session.extended", text_color = color.white)
    table.cell(t, 1, 7,  str.tostring(extReq),    text_color = color.yellow)
    table.cell(t, 0, 8,  "req syminfo.tickerid", text_color = color.white)
    table.cell(t, 1, 8,  str.tostring(tidReq),    text_color = color.yellow)
    table.cell(t, 0, 9,  "bars loaded",       text_color = color.white)
    table.cell(t, 1, 9,  str.tostring(nBars), text_color = color.yellow)
    table.cell(t, 0, 10, "na: plain/reg/ext", text_color = color.white)
    table.cell(t, 1, 10, str.tostring(nPlainNa) + " / " + str.tostring(nRegNa) + " / " + str.tostring(nExtNa), text_color = color.yellow)
```

### What to click

1. `NASDAQ:AAPL`, **5m**. Settings ⚙ → *Symbol* → **Extended trading hours ON**. The chart
   should now show pre-market / after-hours bars (usually a shaded band).
2. Add the script. Read the table.
3. Open the **Data Window** and hover a bar that is clearly **pre-market** (before 09:30 ET
   — the crosshair label shows the bar's time). Read all four request series there.
4. Now turn **Extended trading hours OFF** and read the table again (the chart now has only
   regular-session bars).
5. Remove the indicator.

### What to read off, and where it goes

`measurements[id="M2"].answers.*`

| answer field | read it from |
|---|---|
| `syminfo_session_with_chart_eth_on` | table row **syminfo.session**, run A |
| `syminfo_session_with_chart_eth_off` | table row **syminfo.session**, run B |
| `premarket_bar_chart_close` | Data Window `chart_close` on the pre-market bar |
| `premarket_bar_plain_string_req` | Data Window `req_plain_string` on that bar — a number, or `n/a` |
| `premarket_bar_session_regular_req` | `req_session_regular` on that bar |
| `premarket_bar_session_extended_req` | `req_session_extended` on that bar |
| `premarket_bar_tickerid_req` | `req_tickerid` on that bar |
| `na_counts_plain_regular_extended` | table row **na: plain/reg/ext**, run A, verbatim |
| `plain_string_session` | the conclusion. One of: `regular only` · `extended too` · `follows the chart's own session setting` · `inconclusive` |
| `tickerid_session` | same options, for `syminfo.tickerid` |

⭐ The discriminator is the pre-market bar. If `req_plain_string` is `n/a` there while
`req_session_extended` has a number, a plain string is **regular only**. If it matches the
extended series with ETH on and the regular series with ETH off, it **follows the chart**.

---

## M3 — The `time` of a daily bar for a US equity

**The question.** Pine's `time` on a daily bar — **which instant**, in **which timezone**?
Our wire carries a date string; Pine carries milliseconds, and the join between them is
only sound if we know what the milliseconds mean.

**Chart.** `NYSE:JPM`, **1D**.

### The script

```pine
//@version=6
indicator("uct-M3-daily-bar-time", overlay = false)

var table t = table.new(position.top_right, 2, 12, border_width = 1)

if barstate.islast
    table.cell(t, 0, 0,  "symbol",            text_color = color.white)
    table.cell(t, 1, 0,  syminfo.tickerid,    text_color = color.yellow)
    table.cell(t, 0, 1,  "chart tf",          text_color = color.white)
    table.cell(t, 1, 1,  timeframe.period,    text_color = color.yellow)
    table.cell(t, 0, 2,  "syminfo.timezone",  text_color = color.white)
    table.cell(t, 1, 2,  syminfo.timezone,    text_color = color.yellow)
    table.cell(t, 0, 3,  "time (ms)",         text_color = color.white)
    table.cell(t, 1, 3,  str.tostring(time),  text_color = color.yellow)
    table.cell(t, 0, 4,  "time @ UTC",        text_color = color.white)
    table.cell(t, 1, 4,  str.format_time(time, "yyyy-MM-dd HH:mm:ss", "UTC"), text_color = color.yellow)
    table.cell(t, 0, 5,  "time @ New_York",   text_color = color.white)
    table.cell(t, 1, 5,  str.format_time(time, "yyyy-MM-dd HH:mm:ss", "America/New_York"), text_color = color.yellow)
    table.cell(t, 0, 6,  "time @ exchange tz", text_color = color.white)
    table.cell(t, 1, 6,  str.format_time(time, "yyyy-MM-dd HH:mm:ss", syminfo.timezone), text_color = color.yellow)
    table.cell(t, 0, 7,  "time_close (ms)",   text_color = color.white)
    table.cell(t, 1, 7,  str.tostring(time_close), text_color = color.yellow)
    table.cell(t, 0, 8,  "time_close @ NY",   text_color = color.white)
    table.cell(t, 1, 8,  str.format_time(time_close, "yyyy-MM-dd HH:mm:ss", "America/New_York"), text_color = color.yellow)
    // The PREVIOUS bar is definitely closed, so the live forming bar cannot confuse it.
    table.cell(t, 0, 9,  "time[1] (ms)",      text_color = color.white)
    table.cell(t, 1, 9,  str.tostring(time[1]), text_color = color.yellow)
    table.cell(t, 0, 10, "time[1] @ NY",      text_color = color.white)
    table.cell(t, 1, 10, str.format_time(time[1], "yyyy-MM-dd HH:mm:ss", "America/New_York"), text_color = color.yellow)
    table.cell(t, 0, 11, "time[1] @ UTC",     text_color = color.white)
    table.cell(t, 1, 11, str.format_time(time[1], "yyyy-MM-dd HH:mm:ss", "UTC"), text_color = color.yellow)
```

### What to click

1. `NYSE:JPM`, **1D**. Add the script. Read the whole table.
2. Remove the indicator.

### What to read off, and where it goes

`measurements[id="M3"].answers.*` — copy each table row verbatim into the matching field:

| answer field | table row |
|---|---|
| `syminfo_timezone` | **syminfo.timezone** |
| `time_ms_raw` | **time (ms)** |
| `time_utc` | **time @ UTC** |
| `time_america_new_york` | **time @ New_York** |
| `time_exchange_tz` | **time @ exchange tz** |
| `time_close_ms_raw` | **time_close (ms)** |
| `time_close_america_new_york` | **time_close @ NY** |
| `prev_bar_time_america_new_york` | **time[1] @ NY** |
| `prev_bar_time_utc` | **time[1] @ UTC** |
| `instant_the_time_field_names` | the conclusion. One of: `the session OPEN of that day` · `midnight exchange time` · `midnight UTC` · `something else` |

⭐ The `time[1] @ NY` row is the one that settles it. `09:30:00` means the session open;
`00:00:00` means midnight in the exchange's timezone. Both are plausible and they lead to
different code.

---

## M4 — A wrong-exchange spelling

**The question.** Is `NASDAQ:JPM` invalid — JPM is NYSE-listed — and what does
`ignore_invalid_symbol = true` then yield?

**Chart.** any US equity, **1D**. `NYSE:JPM` is convenient.

⛔ **Two parts, run separately. Part A is expected to fail** — that failure, and its exact
wording, is the measurement.

### Part A — no `ignore_invalid_symbol`

```pine
//@version=6
indicator("uct-M4a-wrong-exchange-no-ignore", overlay = false)

// EXPECTED TO FAIL. If it does: copy the error text verbatim and go to part B.
// If it does NOT fail, that is the finding -- record the value it returns.
wrong = request.security("NASDAQ:JPM", "D", close)

plot(wrong, "req_wrong_exchange")

var table t = table.new(position.top_right, 2, 2, border_width = 1)
if barstate.islast
    table.cell(t, 0, 0, "NASDAQ:JPM close", text_color = color.white)
    table.cell(t, 1, 0, str.tostring(wrong), text_color = color.yellow)
    table.cell(t, 0, 1, "is na",             text_color = color.white)
    table.cell(t, 1, 1, str.tostring(na(wrong)), text_color = color.yellow)
```

### Part B — with `ignore_invalid_symbol = true`, plus a control

```pine
//@version=6
indicator("uct-M4b-wrong-exchange-ignored", overlay = false)

wrongIgn = request.security("NASDAQ:JPM",    "D", close, ignore_invalid_symbol = true)
rightIgn = request.security("NYSE:JPM",      "D", close, ignore_invalid_symbol = true)
// CONTROL: a symbol that cannot exist. If this is NOT na, the instrument is broken
// and nothing above it means anything.
bogusIgn = request.security("NYSE:ZZZZQQ99", "D", close, ignore_invalid_symbol = true)

plot(wrongIgn, "req_wrong_ignored")
plot(rightIgn, "req_right_ignored")
plot(bogusIgn, "req_bogus_control")

var table t = table.new(position.top_right, 2, 5, border_width = 1)
if barstate.islast
    table.cell(t, 0, 0, "NASDAQ:JPM (ignored)", text_color = color.white)
    table.cell(t, 1, 0, str.tostring(wrongIgn), text_color = color.yellow)
    table.cell(t, 0, 1, "NYSE:JPM (ignored)",   text_color = color.white)
    table.cell(t, 1, 1, str.tostring(rightIgn), text_color = color.yellow)
    table.cell(t, 0, 2, "CONTROL bogus",        text_color = color.white)
    table.cell(t, 1, 2, str.tostring(bogusIgn), text_color = color.yellow)
    table.cell(t, 0, 3, "wrong is na",          text_color = color.white)
    table.cell(t, 1, 3, str.tostring(na(wrongIgn)), text_color = color.yellow)
    table.cell(t, 0, 4, "wrong == right",       text_color = color.white)
    table.cell(t, 1, 4, str.tostring(wrongIgn == rightIgn), text_color = color.yellow)
```

### What to click

1. Add **Part A**. If a red ⚠ appears on the indicator's legend, hover/click it and copy the
   message **exactly**. If the editor refuses to compile, copy that message instead.
2. Remove Part A. Add **Part B**. Read the table.
3. Remove the indicator.

### What to read off, and where it goes

`measurements[id="M4"].answers.*`

| answer field | read it from |
|---|---|
| `part_a_compiles` | `true` / `false` — did Part A add to the chart at all? |
| `part_a_error_text` | the message, **verbatim**. If there was none, write `no error` |
| `part_a_value` | Part A's **NASDAQ:JPM close** row, if it ran. If it did not run, write `did not run` |
| `wrong_exchange_is_invalid` | one of: `yes - it errors` · `no - TradingView resolves it anyway` · `inconclusive` |
| `part_b_wrong_with_ignore` | Part B table row **NASDAQ:JPM (ignored)** |
| `part_b_right_with_ignore` | Part B table row **NYSE:JPM (ignored)** |
| `part_b_bogus_control_with_ignore` | Part B table row **CONTROL bogus** |
| `ignore_invalid_symbol_yields` | one of: `na for every bar` · `the correct exchange's series` · `something else` |

⛔ **If the CONTROL is not `NaN`, stop and record `blocked`.** A control that cannot
distinguish a real symbol from a nonexistent one makes the whole part-B reading worthless.

---

## M5 — The maximum number of unique `request.*()` calls

**The question.** How many unique `request.*()` calls may a script make **on your plan**?
This directly bounds how many watchlist symbols the RVOL dashboard can ever show.

**Chart.** `NASDAQ:AAPL`, **1D** (the chart barely matters; record what you used).

### The script

```pine
//@version=6
indicator("uct-M5-request-ceiling", overlay = false)

// Raise `n` until TradingView refuses. Pine v6 allows request.* inside a loop,
// so `n` really is `n` separate requests.
n       = input.int(10, "How many unique request.security() calls", minval = 1, maxval = 200)
symsTxt = input.text_area("AAPL,MSFT,NVDA,AMZN,META,GOOGL,GOOG,TSLA,AVGO,BRK.B,JPM,LLY,V,XOM,UNH,MA,COST,HD,PG,JNJ,WMT,NFLX,ABBV,CRM,BAC,ORCL,MRK,CVX,KO,AMD,PEP,ADBE,TMO,LIN,ACN,MCD,CSCO,ABT,WFC,GE,DHR,TXN,NOW,QCOM,PM,DIS,INTU,IBM,VZ,CAT,AMGN,CMCSA,RTX,NEE,UBER,SPGI,PFE,UNP,GS,LOW,HON,ISRG,ELV,BKNG,PGR,T,COP,AXP,BLK,VRTX,SYK,TJX,MS,MDT,C,LMT,SCHW,ADP,BSX,MMC,CB,PLD,DE,ADI,GILD,MDLZ,REGN,AMT,CI,SBUX,BMY,SO,ZTS,MO,DUK,CME,BDX,ITW,CL,EOG", "Symbols (comma separated)")

syms = str.split(symsTxt, ",")

var int   made  = 0
var float total = 0.0
made  := 0
total := 0.0

for i = 0 to n - 1
    if i < array.size(syms)
        v = request.security(array.get(syms, i), "D", close, ignore_invalid_symbol = true)
        total := total + (na(v) ? 0.0 : v)
        made  := made + 1

var table t = table.new(position.top_right, 2, 4, border_width = 1)
if barstate.islast
    table.cell(t, 0, 0, "n requested",   text_color = color.white)
    table.cell(t, 1, 0, str.tostring(n), text_color = color.yellow)
    table.cell(t, 0, 1, "calls made",    text_color = color.white)
    table.cell(t, 1, 1, str.tostring(made),  text_color = color.yellow)
    table.cell(t, 0, 2, "symbols available", text_color = color.white)
    table.cell(t, 1, 2, str.tostring(array.size(syms)), text_color = color.yellow)
    table.cell(t, 0, 3, "sum of closes", text_color = color.white)
    table.cell(t, 1, 3, str.tostring(total), text_color = color.yellow)
```

### What to click

1. Add the script with `n = 10`. Confirm the table appears and **calls made** is `10` — that
   is the non-vacuity control; if it is not 10, the loop is not doing what it claims and
   nothing below means anything.
2. Raise `n` in the indicator's settings, one step at a time, reading the table after each:
   **10 → 39 → 40 → 41 → 63 → 64 → 65 → 80 → 100**.
3. The moment TradingView refuses (a red ⚠ on the legend, or an error banner), copy the
   message **verbatim** and note the `n` that produced it and the largest `n` that did not.
4. Also note your plan name — top-right avatar menu, or
   `https://www.tradingview.com/gopro/` shows your current plan.
5. Remove the indicator.

### What to read off, and where it goes

`measurements[id="M5"].answers.*`

| answer field | read it from |
|---|---|
| `plan_name` | your TradingView plan, e.g. `Premium` |
| `control_calls_made_at_n_10` | the **calls made** row at `n = 10`. Must be `10` |
| `largest_n_that_ran` | a number |
| `smallest_n_that_failed` | a number. If nothing failed up to 100, write `0` and say so in `notes` |
| `error_text` | the refusal message, **verbatim** |

---

## M6 — `str.tostring(x, "#")` and `math.round(x)` at .5

**The question.** Which way do they round at exactly `.5` — and do they agree with each
other? Half-up, half-even and half-away-from-zero are three different answers and our
formatter has to match whichever one TradingView does.

**Chart.** any. This is pure arithmetic; the chart cannot affect it. Record what you used
anyway.

### The script

```pine
//@version=6
indicator("uct-M6-round-at-half", overlay = false)

var table t = table.new(position.top_right, 3, 7, border_width = 1)

if barstate.islast
    table.cell(t, 0, 0, "x",                  text_color = color.white)
    table.cell(t, 1, 0, "str.tostring(x,\"#\")", text_color = color.white)
    table.cell(t, 2, 0, "math.round(x)",      text_color = color.white)

    table.cell(t, 0, 1, "0.5",   text_color = color.white)
    table.cell(t, 1, 1, str.tostring(0.5, "#"),  text_color = color.yellow)
    table.cell(t, 2, 1, str.tostring(math.round(0.5)),  text_color = color.lime)

    table.cell(t, 0, 2, "1.5",   text_color = color.white)
    table.cell(t, 1, 2, str.tostring(1.5, "#"),  text_color = color.yellow)
    table.cell(t, 2, 2, str.tostring(math.round(1.5)),  text_color = color.lime)

    table.cell(t, 0, 3, "2.5",   text_color = color.white)
    table.cell(t, 1, 3, str.tostring(2.5, "#"),  text_color = color.yellow)
    table.cell(t, 2, 3, str.tostring(math.round(2.5)),  text_color = color.lime)

    table.cell(t, 0, 4, "-0.5",  text_color = color.white)
    table.cell(t, 1, 4, str.tostring(-0.5, "#"), text_color = color.yellow)
    table.cell(t, 2, 4, str.tostring(math.round(-0.5)), text_color = color.lime)

    table.cell(t, 0, 5, "-1.5",  text_color = color.white)
    table.cell(t, 1, 5, str.tostring(-1.5, "#"), text_color = color.yellow)
    table.cell(t, 2, 5, str.tostring(math.round(-1.5)), text_color = color.lime)

    table.cell(t, 0, 6, "-2.5",  text_color = color.white)
    table.cell(t, 1, 6, str.tostring(-2.5, "#"), text_color = color.yellow)
    table.cell(t, 2, 6, str.tostring(math.round(-2.5)), text_color = color.lime)
```

### What to click

1. Add the script. Read all twelve cells. **Copy them exactly**, including a leading `-`
   and including `-0` if that is what it says.
2. Remove the indicator.

### What to read off, and where it goes

`measurements[id="M6"].answers.*` — one field per cell:

`tostring_hash_0_5`, `tostring_hash_1_5`, `tostring_hash_2_5`,
`tostring_hash_neg_0_5`, `tostring_hash_neg_1_5`, `tostring_hash_neg_2_5`,
`math_round_0_5`, `math_round_1_5`, `math_round_2_5`,
`math_round_neg_0_5`, `math_round_neg_1_5`, `math_round_neg_2_5`

plus two conclusions:

| answer field | options |
|---|---|
| `tostring_rule` | `half up (away from zero)` · `half even (banker's)` · `half toward +infinity` · `something else` |
| `math_round_rule` | same four |

⭐ The three rules are told apart by `2.5` and `-0.5` together: half-even gives `2`,
half-away-from-zero gives `3` and `-1`, half-toward-+infinity gives `3` and `-0`/`0`.

---

## M7 — `array.sort_indices` tie order

**The question.** When two elements are equal, in what order do their **original indices**
come out? The RVOL dashboard ranks rows by a score; two symbols with identical scores must
land in a defined order or our table and TradingView's disagree on any tie.

**Chart.** any. Pure arithmetic again.

### The script

```pine
//@version=6
indicator("uct-M7-sort-indices-ties", overlay = false)

// Deliberate ties at three different values, planted at spread-out indices.
var float[] a = array.from(5.0, 3.0, 5.0, 1.0, 3.0, 5.0)
// Every element identical -- the purest tie there is.
var float[] b = array.from(7.0, 7.0, 7.0, 7.0)
// Already descending -- separates "stable" from "happens to look stable".
var float[] c = array.from(3.0, 2.0, 1.0)

aAsc  = array.sort_indices(a, order.ascending)
aDesc = array.sort_indices(a, order.descending)
bAsc  = array.sort_indices(b, order.ascending)
bDesc = array.sort_indices(b, order.descending)
cAsc  = array.sort_indices(c, order.ascending)

var table t = table.new(position.top_right, 2, 7, border_width = 1)

if barstate.islast
    table.cell(t, 0, 0, "a = values",        text_color = color.white)
    table.cell(t, 1, 0, array.join(a, ","),  text_color = color.yellow)
    table.cell(t, 0, 1, "a asc indices",     text_color = color.white)
    table.cell(t, 1, 1, array.join(aAsc, ","),  text_color = color.yellow)
    table.cell(t, 0, 2, "a desc indices",    text_color = color.white)
    table.cell(t, 1, 2, array.join(aDesc, ","), text_color = color.yellow)
    table.cell(t, 0, 3, "b = all equal",     text_color = color.white)
    table.cell(t, 1, 3, array.join(b, ","),  text_color = color.yellow)
    table.cell(t, 0, 4, "b asc indices",     text_color = color.white)
    table.cell(t, 1, 4, array.join(bAsc, ","),  text_color = color.yellow)
    table.cell(t, 0, 5, "b desc indices",    text_color = color.white)
    table.cell(t, 1, 5, array.join(bDesc, ","), text_color = color.yellow)
    table.cell(t, 0, 6, "c desc input, asc", text_color = color.white)
    table.cell(t, 1, 6, array.join(cAsc, ","),  text_color = color.yellow)
```

### What to click

1. Add the script. Read all seven rows, **exactly as printed** (comma-separated index
   lists). The `c` row is the control: if it does not read `2,1,0` the sort itself is not
   doing what we think and the tie rows mean nothing.
2. Remove the indicator.

### What to read off, and where it goes

`measurements[id="M7"].answers.*`

| answer field | table row |
|---|---|
| `input_array_a` | **a = values** |
| `asc_indices_a` | **a asc indices** |
| `desc_indices_a` | **a desc indices** |
| `all_equal_indices_asc` | **b asc indices** |
| `all_equal_indices_desc` | **b desc indices** |
| `control_descending_input_asc` | **c desc input, asc** — expected `2,1,0` |
| `tie_order_ascending` | `stable - original index order` · `reverse original index order` · `neither / not stable` |
| `tie_order_descending` | same three |

---

## M8 — `timeframe.period` inside a requested context

**The question.** Inside `request.security(…, "D", <expr>)`, does `timeframe.period`
report the **requested** timeframe or the **chart's**? Scripts read it to label rows and to
branch, and getting this backwards silently mislabels every row.

**Chart.** `NASDAQ:AAPL`, **5 minutes** — the chart timeframe must differ from the
requested one or the question cannot be answered.

⛔ **Two parts.** Part A uses only numeric/boolean expressions and should always run.
Part B requests a **string**, which may not be supported — if it fails, Part A's answer
still stands.

### Part A — numeric and boolean

```pine
//@version=6
indicator("uct-M8a-timeframe-in-request-numeric", overlay = false)

reqMult   = request.security(syminfo.tickerid, "D", timeframe.multiplier)
reqDaily  = request.security(syminfo.tickerid, "D", timeframe.isdaily)
reqIntra  = request.security(syminfo.tickerid, "D", timeframe.isintraday)

var table t = table.new(position.top_right, 2, 7, border_width = 1)
if barstate.islast
    table.cell(t, 0, 0, "chart timeframe.period",     text_color = color.white)
    table.cell(t, 1, 0, timeframe.period,             text_color = color.yellow)
    table.cell(t, 0, 1, "chart timeframe.multiplier", text_color = color.white)
    table.cell(t, 1, 1, str.tostring(timeframe.multiplier), text_color = color.yellow)
    table.cell(t, 0, 2, "chart timeframe.isdaily",    text_color = color.white)
    table.cell(t, 1, 2, str.tostring(timeframe.isdaily),    text_color = color.yellow)
    table.cell(t, 0, 3, "chart timeframe.isintraday", text_color = color.white)
    table.cell(t, 1, 3, str.tostring(timeframe.isintraday), text_color = color.yellow)
    table.cell(t, 0, 4, "req timeframe.multiplier",   text_color = color.white)
    table.cell(t, 1, 4, str.tostring(reqMult),  text_color = color.lime)
    table.cell(t, 0, 5, "req timeframe.isdaily",      text_color = color.white)
    table.cell(t, 1, 5, str.tostring(reqDaily), text_color = color.lime)
    table.cell(t, 0, 6, "req timeframe.isintraday",   text_color = color.white)
    table.cell(t, 1, 6, str.tostring(reqIntra), text_color = color.lime)
```

### Part B — the string itself

```pine
//@version=6
indicator("uct-M8b-timeframe-in-request-string", overlay = false)

// May not compile. If it does not, copy the error and leave part B's fields as
// the error text -- part A already answers the question numerically.
reqPeriod = request.security(syminfo.tickerid, "D", timeframe.period)

var table t = table.new(position.top_right, 2, 2, border_width = 1)
if barstate.islast
    table.cell(t, 0, 0, "chart timeframe.period", text_color = color.white)
    table.cell(t, 1, 0, timeframe.period,         text_color = color.yellow)
    table.cell(t, 0, 1, "req timeframe.period",   text_color = color.white)
    table.cell(t, 1, 1, reqPeriod,                text_color = color.lime)
```

### What to click

1. `NASDAQ:AAPL`, **5m**. Add **Part A**. Confirm **chart timeframe.period** reads `5` —
   the control; if it does not, the chart is not on 5 minutes.
2. Read the three `req …` rows. Remove Part A.
3. Add **Part B**. If it compiles, read its two rows. If it does not, copy the error
   verbatim.
4. Remove the indicator.

### What to read off, and where it goes

`measurements[id="M8"].answers.*`

| answer field | read it from |
|---|---|
| `chart_timeframe_period` | Part A row **chart timeframe.period** — expected `5` |
| `requested_timeframe_multiplier` | Part A row **req timeframe.multiplier** |
| `requested_timeframe_isdaily` | Part A row **req timeframe.isdaily** |
| `requested_timeframe_isintraday` | Part A row **req timeframe.isintraday** |
| `part_b_compiles` | `true` / `false` |
| `requested_timeframe_period` | Part B row **req timeframe.period**, or `did not run` |
| `part_b_error_text` | verbatim, or `no error` |
| `timeframe_period_inside_request_reports` | `the REQUESTED timeframe` · `the CHART's timeframe` · `inconclusive` |

⭐ Part A alone settles it: chart multiplier `5` + requested multiplier `1` with
`isdaily = true` means the expression sees the **requested** context. Requested multiplier
`5` with `isintraday = true` means it sees the **chart's**.

---

## M9 — `hour(time, "America/New_York")` across a DST boundary

**The question.** Does `hour()` with an explicit timezone follow US daylight saving, and
what does it do with the repeated hour in the autumn?

**Chart.** any US equity, any timeframe — the fixed timestamps below are computed, not
read off bars, so the chart affects only the last three rows. `NASDAQ:AAPL` **30 minutes**
is a fine default.

⭐ This is deliberately built on `timestamp()` rather than on chart history: an intraday
chart will not reach back to March, and a measurement that depends on how much history
your plan loaded is not a measurement.

### The script

```pine
//@version=6
indicator("uct-M9-hour-across-dst", overlay = false)

// 2026 US DST: forward Sun 8 Mar (02:00 -> 03:00), back Sun 1 Nov (02:00 -> 01:00).
tMarEst = timestamp("UTC", 2026, 3,  8,  6, 0, 0)   // 06:00Z -- before the jump
tMarEdt = timestamp("UTC", 2026, 3,  8,  7, 0, 0)   // 07:00Z -- after the jump
tNovA   = timestamp("UTC", 2026, 11, 1,  5, 0, 0)   // 05:00Z -- first pass of 01:00
tNovB   = timestamp("UTC", 2026, 11, 1,  6, 0, 0)   // 06:00Z -- second pass of 01:00
tNovC   = timestamp("UTC", 2026, 11, 1,  7, 0, 0)   // 07:00Z
tSummer = timestamp("UTC", 2026, 7,  1, 14, 30, 0)  // 14:30Z mid-summer
tWinter = timestamp("UTC", 2026, 1,  5, 14, 30, 0)  // 14:30Z mid-winter -- SAME clock

hh(ts) => str.tostring(hour(ts, "America/New_York")) + ":" + str.tostring(minute(ts, "America/New_York")) + "  [" + str.format_time(ts, "yyyy-MM-dd HH:mm", "America/New_York") + "]"

var table t = table.new(position.top_right, 2, 11, border_width = 1)

if barstate.islast
    table.cell(t, 0, 0,  "2026-03-08 06:00Z", text_color = color.white)
    table.cell(t, 1, 0,  hh(tMarEst),         text_color = color.yellow)
    table.cell(t, 0, 1,  "2026-03-08 07:00Z", text_color = color.white)
    table.cell(t, 1, 1,  hh(tMarEdt),         text_color = color.yellow)
    table.cell(t, 0, 2,  "2026-11-01 05:00Z", text_color = color.white)
    table.cell(t, 1, 2,  hh(tNovA),           text_color = color.yellow)
    table.cell(t, 0, 3,  "2026-11-01 06:00Z", text_color = color.white)
    table.cell(t, 1, 3,  hh(tNovB),           text_color = color.yellow)
    table.cell(t, 0, 4,  "2026-11-01 07:00Z", text_color = color.white)
    table.cell(t, 1, 4,  hh(tNovC),           text_color = color.yellow)
    table.cell(t, 0, 5,  "2026-07-01 14:30Z", text_color = color.white)
    table.cell(t, 1, 5,  hh(tSummer),         text_color = color.yellow)
    table.cell(t, 0, 6,  "2026-01-05 14:30Z", text_color = color.white)
    table.cell(t, 1, 6,  hh(tWinter),         text_color = color.yellow)
    table.cell(t, 0, 7,  "live bar @ NY",     text_color = color.white)
    table.cell(t, 1, 7,  str.tostring(hour(time, "America/New_York")) + ":" + str.tostring(minute(time, "America/New_York")), text_color = color.lime)
    table.cell(t, 0, 8,  "live bar @ UTC",    text_color = color.white)
    table.cell(t, 1, 8,  str.tostring(hour(time, "UTC")) + ":" + str.tostring(minute(time, "UTC")), text_color = color.lime)
    table.cell(t, 0, 9,  "live bar @ default", text_color = color.white)
    table.cell(t, 1, 9,  str.tostring(hour(time)) + ":" + str.tostring(minute(time)), text_color = color.lime)
    table.cell(t, 0, 10, "syminfo.timezone",  text_color = color.white)
    table.cell(t, 1, 10, syminfo.timezone,    text_color = color.yellow)
```

### What to click

1. Add the script. Read all eleven rows, verbatim, including the bracketed formatted time.
2. Remove the indicator.

### What to read off, and where it goes

`measurements[id="M9"].answers.*`

| answer field | table row |
|---|---|
| `hour_2026_03_08_0600Z_ny` | **2026-03-08 06:00Z** |
| `hour_2026_03_08_0700Z_ny` | **2026-03-08 07:00Z** |
| `hour_2026_11_01_0500Z_ny` | **2026-11-01 05:00Z** |
| `hour_2026_11_01_0600Z_ny` | **2026-11-01 06:00Z** |
| `hour_2026_11_01_0700Z_ny` | **2026-11-01 07:00Z** |
| `hour_2026_07_01_1430Z_ny` | **2026-07-01 14:30Z** |
| `hour_2026_01_05_1430Z_ny` | **2026-01-05 14:30Z** |
| `live_bar_hour_ny` | **live bar @ NY** |
| `live_bar_hour_utc` | **live bar @ UTC** |
| `live_bar_hour_default_tz` | **live bar @ default** |
| `dst_is_respected` | `yes - the same UTC instant maps to a different NY hour across the boundary` · `no - a fixed offset` · `inconclusive` |
| `repeated_hour_behaviour` | what the two 2026-11-01 rows did, in one sentence |

⭐ The cleanest discriminator is the summer/winter pair: `14:30Z` is `10:30` in July and
`09:30` in January if DST is respected, and the same number in both if it is not.

---

## M10 — What the chart legend says the data feed is

**The question.** For a US stock on **your** account, is the price feed a **real-time
exchange feed**, **Cboe BZX**, or **delayed**? This decides whether TradingView's
in-session volume is comparable to ours at all — a consolidated real-time feed and a single
venue's feed report different volume for the same minute, and a comparison across the two
is a difference in data, not in code.

**No Pine needed.**

### What to click

1. Open `NASDAQ:AAPL` (or any US stock), **any intraday timeframe**, during US market hours.
2. Look at the **status line** at the top-left of the chart — the row with the symbol,
   timeframe and exchange. The exchange label sits just after the symbol.
3. **Hover that exchange label.** A tooltip names the feed and its real-time / delayed
   state. Copy it **verbatim**.
4. If a **clock icon** or a `D` badge appears beside the symbol, it is a delayed feed —
   hover it and record the delay it names.
5. Open the symbol info dialog for a second reading: click the symbol name → the search
   result's ⓘ, or right-click the chart → *Symbol info*. Record the exchange / data
   provider line there too.
6. Note your plan name (top-right avatar menu).

### What to read off, and where it goes

`measurements[id="M10"].answers.*`

| answer field | read it from |
|---|---|
| `legend_feed_label` | step 3, **verbatim** |
| `symbol_info_feed_label` | step 5, verbatim |
| `delayed_badge_present` | `true` / `false` |
| `delay_minutes` | the delay it names, or `0` if real-time |
| `plan_name` | your TradingView plan |
| `feed_kind` | `real-time exchange feed` · `Cboe BZX` · `delayed` · `inconclusive` |
| `in_session_volume_comparable` | your call, given the above: `yes` · `no` · `inconclusive` |

---

## When you are finished

1. Remove any remaining indicator — the rig should be back to **zero studies**.
2. Close the Pine Editor tab **without saving**. Nothing in this packet is meant to persist
   in your account.
3. Save `docs/pine/rvol-slice-vendor-answers.json` with whatever you measured. Entries you
   did not get to stay `"unmeasured"` — that is a correct state, not an omission.
4. Anything odd, surprising or that did not work goes in that entry's `notes`, in your own
   words. A recorded surprise is worth more than a tidy blank.
