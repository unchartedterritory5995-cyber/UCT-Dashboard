# Owner capture packet — every open vendor measurement, in one sitting

> **Ruled 2026-09-23.** These are the only things in the Pine parity programme
> that are blocked on a person rather than on code. They needed a live
> TradingView session each; this packet makes them **one** session.

⛔ **NOTHING HERE IS GUESSED AT IN THE MEANTIME.** `symbolScope.json` says it in
its own words — *"an unconfirmed spelling is never served"* — and each pending
field's refusal tells a member it is a **measurement** gap rather than a grammar
gap, so an author reading it does not rewrite a script that will work unchanged
the day a witness lands.

---

## Before you start — the two gates

1. **The visibility gate.** `docs/pine/capture-procedure.md`, top of file. Adding
   a study to a hidden tab returns cleanly and inserts **nothing**; verify by
   re-reading `model().dataSources()`, never by the absence of a throw.
2. ⛔⛔ **Assert `isFailed === false` before reading any roster.** A study that
   fails to compile keeps a one-plot stub titled "Plot" with an **empty**
   `_data._items`. A capture that skips this records a study that never
   evaluated as though it had answered. This is not hypothetical — it is how
   `syminfo.exchange` (an identifier that does not exist in Pine v6) survived in
   a probe until 2026-09-10.

Once a study is on the chart these are all **value** captures, so they survive a
hidden tab. Read `study._data._items`.

---

## The three probes, all committed

| # | Probe | Settles | Witnesses |
|---|---|---|---|
| **1** | `tools/visual_conformance/probes/syminfo-roster.pine` | the 8 refused `syminfo.*` fields | **5** — SPY · AAPL · BRK.B · F · **BITSTAMP:BTCUSD** |
| **2** | `tools/visual_conformance/probes/w4-cross-round.pine` | crosses, `rising`/`falling`, `math.sign(0)`, timeframe scalars | 1 — SPY, 1D |
| **3** | `tools/visual_conformance/probes/request-realtime-alignment.pine` ⚠️ **OPEN MARKET ONLY** | `lookahead` at a timeframe ABOVE the chart's | SPY, **5m**, during RTH, newest bar forming |

### ✅ ALREADY TAKEN — DO NOT RE-RUN

⚰️ **`exchange-spelling.pine` IS DONE, and this packet said it was pending.**
Corrected 2026-09-23 after reading `symbolScope.json` rather than the sentence
next to it. The capture is **2026-09-10**, receipt-verified
(`tests/fixtures/vendor/exchange-spelling-seven-witnesses-2026-09-10.json`,
`receipt.verified: true`), with **all seven** witnesses including ADDYY, and
`confirmed` carries **6 exchange rows** — `NYSE Arca → AMEX` (witness `AMEX:SPY`)
among them, which is the flagship divergence the probe existed to settle.

⛔ **`pending_measurement` IS NOT A TO-DO LIST.** It holds the SENTENCE the fold
quotes when a symbol's exchange is *not* in `confirmed` — that is why `tickerid`
and `prefix` appear there while both are served for the six confirmed exchanges.
Reading it as outstanding work is what produced the error above.

### 1 — the syminfo roster

⛔ **BITSTAMP:BTCUSD IS NOT OPTIONAL AND IS NOT A CURIOSITY.** `basecurrency` is
defined as the left half of a pair. On an equity, `basecurrency == ""` is
ambiguous between *"the vendor returns empty for equities"* and *"this probe
cannot read the field"*. **The crypto row is the only thing that discriminates
them.** Without it the capture cannot answer the question it was taken for.

⚠️ **`syminfo.mintick` and `syminfo.pointvalue` need every witness**, not one.
Their refusal reason is *"differs per symbol"*, so a single row cannot settle
them — the question is whether the witnesses **agree**. (`F` is in the list in
case mintick tiers below some price.)

### 2 — W4

⚰️ **ITS ROUNDING BLOCK IS ALREADY ANSWERED — DO NOT RE-ASK IT.** X06–X09 ask
`math.round`'s half-rule, and
`tests/fixtures/vendor/groupb-readings-spy-1d-2026-09-11.json` has carried the
verdict since 2026-09-11: **HALF AWAY FROM ZERO, not bankers' rounding.** That
reading has already been acted on — it is what the 2026-09-23 vendor ruling
served. Recorded here because this programme has now twice found a question
filed as OPEN whose answer was already in the repo.

⚠️ **X12/X13 duplicate probe 2's S17/S18.** Take them once, on whichever probe
you run first, and note which.

### 3 — the realtime alignment ⚠️ OPEN MARKET ONLY

⛔ **THIS ONE CANNOT BE TAKEN AT THE WEEKEND**, which is why it is called out
separately rather than folded into the others. `pineRuntimeFrontend`'s request
path refuses `lookahead` by name and says why: *"Vendor packet M1 measured the
HISTORICAL half of this alignment on a real chart; the realtime half needs an
open market and is still owed."*

⭐ **AND ITS SCOPE JUST NARROWED.** As of 2026-09-23 a request for the chart's
OWN symbol at the chart's OWN period folds to the expression, so `lookahead` is
inert there and needs no measurement. What is still owed is only the case where
the requested timeframe is genuinely ABOVE the chart's — e.g. a `'D'` request on
an intraday chart, on a forming bar. Take it on an intraday chart during regular
hours, with the newest bar still forming.

---

## What each unblocks, measured on the committed corpus

| Field | Corpus demand | What lands the day it is witnessed |
|---|---|---|
| `syminfo.basecurrency` | **22 uses, 7 files, 6 reaching an output** | the largest single name on the unserved roster |
| `syminfo.timezone` | **13 uses, 6 files, 4 reaching an output** | |
| `syminfo.currency`, `type`, `session` | roster calls each "constant across our universe" | ⭐ that is a **UX** objection, not a parity one — a constant that MATCHES the vendor is identity |
| `syminfo.mintick`, `pointvalue` | mintick appears in **37** scripts | only if the witnesses agree |
| `syminfo.root` | 1 use, reaching no output | rostered at one use deliberately, so a rare name is not mistaken for an oversight |

⛔ **`syminfo.description` IS DELIBERATELY NOT ASKED.** Its refusal is the one a
vendor reading cannot touch: it is free text *from a data vendor*, it differs
between **our** providers for the same symbol, and a script branching on it would
branch on which provider answered. TradingView having one answer does not give us
one. Asking would produce a number that looks like progress and unblocks nothing.

---

## Recording

Every `confirmed` entry needs all four of `{pine, witness, captured, how}` — an
entry without a witness is an assertion wearing a data structure. Name the
invocation in the result JSON so the next reader can reproduce the row rather
than trust it:

```
"_invocation": "tools/visual_conformance/probes/<probe>.pine pasted into the
                TradingView editor; plot values read from study._data._items
                per docs/pine/capture-procedure.md"
```

⛔ And restore symbol, resolution, pane stretch factors and study visibility
afterwards. **The browser is shared with other sessions.**

---

## Results — capture session 2026-09-30 (after the close, ~16:57–17:13 ET)

Owner-authorised session ("go ahead with the TradingView captures"), account
`TSDR_TRADING`, rig layout `01f1AcIj` ("UCT CAPTURE RIG — no studies"), found on
**NYSE:F · 1D · 0 studies** and left there, 0 studies, editor on a fresh
*Untitled script*. Every capture:

- `tools/vendor_harness/tv_capture.js` (loaded from the branch at `648d22bca`);
- census control true, and `status().type === 2` before reading;
- source written through the Monaco handle, its sha256 checked against the committed file;
- chunks moved by clipboard and assembled with `verify_capture.mjs --assemble`.

Result: **17/17 `VERDICT: PASS`**, and every fixture's `source.sha256` equals the
committed file's. Each probe was **saved as a PRIVATE script** (nothing published) and
removed from the chart after its capture.

⚠️ **Two procedure notes.**

1. The visibility gate's geometry term was 18 px off. The window's bottom edge
   (`screenY + outerHeight = -30`) sits below the work area
   (`availTop + availHeight = -48`), i.e. over the taskbar. `visibilityState` read
   `visible` on every read, and every click was confirmed by re-reading state.
2. One unbind missed. A v5 script's menu has *Convert code to v6…*, which moves
   *Create new* down. The keltner source was written into the buffer of this session's
   own saved btc-charlie copy. It was **never saved**, and it was set back to the
   btc-charlie bytes before the correct unbind. After that, the setter refused any
   buffer that was not a fresh *Create new* model.

⚠️ Every 1D capture carries the harness warning that the newest daily bar closed
under 5 h before capture, so its `barstate.isconfirmed` may still read 0. No probe
here reads `barstate`.

### Packet rows

| # | row | status |
|---|---|---|
| 1 | `syminfo-roster.pine` × SPY · AAPL · BRK.B · F · BITSTAMP:BTCUSD | ✅ **DONE** |
| 2 | `w4-cross-round.pine`, SPY 1D | ✅ **DONE** (X12/X13 taken here) |
| 3 | `request-realtime-alignment.pine` | ⏳ **STILL OPEN** — the market was closed |

### 1 — syminfo (`tests/fixtures/vendor/harness/syminfo-roster-{spy,aapl,brk-b,f,bitstamp-btcusd}-1d-2026-09-30.json`)

Every row is constant over all 300 bars of each capture. The S19 control
(`str.length(syminfo.ticker)`) reads 3 / 4 / 5 / 1 / 6, so every witness evaluated.

| field | SPY | AAPL | BRK.B | F | BTCUSD | settles |
|---|---|---|---|---|---|---|
| `basecurrency` | `""` | `""` | `""` | `""` | len 3, not "USD" | **equities return EMPTY**. The crypto row proves the field is readable |
| `currency` | USD | USD | USD | USD | USD | constant USD on all five |
| `type` | len 4, not "stock" | "stock" | "stock" | "stock" | len 6 | ⚠️ **SPY is NOT "stock"**. It is a 4-char type (consistent with `fund`). Equities are "stock", never "equity" |
| `timezone` | America/New_York | same | same | same | **Etc/UTC** | US listings: America/New_York |
| `root` | == ticker | == ticker | == ticker (len 5) | == ticker | == ticker | ✅ **R-R: `root == ticker` on every equity witness** |
| `session` | "regular" | "regular" | "regular" | "regular" | "regular" | constant |
| `mintick` | 0.01 | 0.01 | 0.01 | 0.01 | 1 | the equities agree at 0.01 |
| `pointvalue` | 1 | 1 | 1 | 1 | 1 | all agree |

⭐ **R-R (objects-triage "Rulings"):** the ruling's condition — *root == ticker on
every equity witness* — is MET on SPY/AAPL/BRK.B/F. `syminfo.root` may move from
`unserved` to a served name that folds to the ticker, with these captures as its
witness. That unblocks `position-size-calc`'s cells as far as C10 allows.

⚠️ `type` is NOT constant across "our universe": an ETF answers differently from an
equity. Serving `type` needs a per-instrument-class answer, not a constant.

### 2 — W4 (`w4-cross-round-spy-1d-2026-09-30.json`)

- `math.round`: 2.5 → **3**, 3.5 → **4**, −2.5 → **−3**, −0.5 → **−1**. That is half
  AWAY from zero, the same answer as the 2026-09-11 group-B capture (not re-litigated).
- `math.sign(0.0)` = **0**.
- `timeframe.in_seconds("D")` = **86400**; `timeframe.multiplier` = 1.
- `mintick` 0.01; `pointvalue` 1.
- Crosses: `ta.cross` = crossover OR crossunder on every bar (225 none / 37 over /
  38 under, never both).
- `rising` and `falling` both vary.

### New probes — what each settles (probes committed in `648d22bca`)

| capture | triage item | TradingView's answer |
|---|---|---|
| `vw-bar-counters-rddt-1d` (from listing, `startsAtBar0: true`, 634 bars) | § C12w bar counters | `var n=0; n:=n+1` = **bar_index + 1** from bar 0 (C06 ≡ 1). `n := na(n[1]) ? 0 : n[1]+1` = **bar_index** (C07 ≡ 0). `var n3 += 1` = bar_index + 1. `var n4 = na; n4 := na(n4)?0:n4+1` = bar_index. `ta.cum(1)` = bar_index + 1. No `na` on bar 0 in any row. The two spellings are a fixed ±1 apart, so they need the mark § C12w names |
| `vw-other-symbol-rddt-1d` (from listing) | § C26 `other-symbol:bare`, `class-share`, and the served-case witness | bare `"SPY"` == `"AMEX:SPY"` on **all 634 bars**; bare `"BRK.B"` == `"NYSE:BRK.B"` on all 634. The last-bar label prints **`762.63`** (SPY's close, equal to the committed SPY capture's last close) — the composite reading § C26 asked for |
| `vw-gradient-spy-1d` | § C20 `color.from_gradient` and `color.new(c, 70.5)` | **Linear per channel, then TRUNCATED to an integer** (v=0.5: r 127.5 → 127, b 125; v=0.01: 2.55 → 2, 99.5 → 99, 198.5 → 198). **Clamped** outside [0,1] (w<0 → endpoint A, w>1 → endpoint B). Transparency interpolates too (0 → 100 gives t = 100·v). `color.new` on top replaces t (30). `color.t(color.new(c, 70.5))` = **70**, and 70.4 also reads 70. The drawn plot's colorer packs **0xAABBGGRR** (endpoint A `#0064C84D` → `0x4dc86400`) |
| `vw-tf-period-spy-{1d,1w,1m}` | § C15 (a) v6 `timeframe.period` spelling | **`"1D"`, `"1W"`, `"1M"`**: label text `[1D]`/`[1W]`/`[1M]`, length 2, and `== "D"`/`"W"`/`"M"` are all FALSE. `multiplier` 1; `isdaily`/`isweekly`/`ismonthly` as expected |
| `vw-ne-na-spy-1d` | § C14 `!=` with an `na` operand | With `x` na: `x != close` **false**, `x == close` false, `x != x` false, `x == x` false, `i != 1` (int na) false, `x > 0` false, `not (x == close)` **true**. With `float y = na`: `y != close` false. **Every comparison with an na operand is false, `!=` included** |
| `vw-offset-na-spy-1d` | § C9 `x[na]` | Runs with no runtime error. **`close[na]` reads the CURRENT bar's close** (offset na acts as 0) on all 100 na-offset bars — never `na` |
| `vw-mbb-auto-spy-1d` | § C9 no `max_bars_back` declared | Compiles and runs with a dynamic offset up to **399** and **no error**. `close[k]` is never na, and on all 75 bars where the offset lands inside the captured window it equals the vendor's own bar. The vendor's automatic buffer sizing covers ≥ 400 |
| `btc-charlie-trader-xo-macro-trend-scanner-rddt-1d` (from listing) | § C12s | Captured: 19 plots, 634 bars. Not graded here — the integrator runs the harness |
| `keltner-center-of-gravity-channel-rddt-1d` (from listing) | § C12s | Captured (study title `KeltCOG`): 21 plots, 634 bars, 2 tables / 3 cells. Not graded here |

### Saved private scripts (account `TSDR_TRADING`, none published)

| script | id |
|---|---|
| `UCTPROBE_SYMINFO` | `USER;edb497ebfb9f42698089cace49016154` |
| `UCTPROBE_W4_CROSS_ROUND` | `USER;33325fc91b58477b8fd346f680a5626c` |
| `UCTPROBE_BAR_COUNTERS` | `USER;b7b601a5e3ba4a22808dfcf4ddb4bce7` |
| `UCTPROBE_OTHER_SYMBOL` | `USER;59eda02370e1488fb592fd18a4d5c6ba` |
| `[@btc_charlie] Trader XO Macro Trend Scanner` (private copy) | `USER;ae6d69ad12b146129791fdf17512f814` |
| `Keltner Center Of Gravity Channel` (private copy) | `USER;8b2bd7f054fe4d40aef3646166abe0d0` |
| `UCTPROBE_GRADIENT` | `USER;782efc2e2d10482abbf5c93217b8c303` |
| `UCTPROBE_TF_PERIOD` | `USER;1d6e17d08a3f4717a7aedb380918a9e6` |
| `UCTPROBE_NE_NA` | `USER;6bd5a6a8ddcf4368b7a6f831a5fc07a3` |
| `UCTPROBE_OFFSET_NA` | `USER;ae12bb26cf734cf69ed0f1462bf9d401` |
| `UCTPROBE_MBB_AUTO` | not read |

They are the owner's to delete.

---

## Results — capture session 2026-09-30 (evening)

Owner-authorised retry ("go ahead with the TradingView captures"), account
`TSDR_TRADING`, rig layout `01f1AcIj`, 23:04–23:24 ET (03:04–03:24 UTC, 2026-10-01).
Found on **NYSE:F · 1D · 0 studies**, editor on a fresh *Untitled script*; left the
same way, no `__uct*` global and no injected node on the page, tab closed.

⚰️ **The first attempt the same evening took nothing**: the connected Chrome opened the
rig as `Guest` ("Can't open this chart layout"), the tab `hidden`, outer size 0 × 0. It
stopped there with no sign-in attempted. The retry found `window.user.username`
`TSDR_TRADING`, `visibilityState` `visible` on every read.

Every capture below: `tools/vendor_harness/tv_capture.js` and the probe sources reached
the page byte-exact (sha256 checked in the page against the committed files); source
written through the Monaco handle into a fresh **Create new ▸ Indicator** buffer and its
sha256 re-checked before the add; binding gate (one `Add to chart`, zero `Update on
chart`) and `visible` asserted in the same evaluation as each write; census control true
and `status().type === 2` before reading; one chunk per capture moved by clipboard and
assembled with `verify_capture.mjs --assemble`.

Result: **13/13 `VERDICT: PASS`**, every fixture's `source.sha256` equal to the
committed probe's, no harness warning on any. Plus one hand-sealed reading (the reached
`runtime.error`, which the harness refuses to stage because the study is failed).

⚠️ **Procedure notes.**

1. The visibility gate's geometry term was 7 px over: window bottom
   (`screenY + outerHeight = -41`) against the work area's (`-48`), i.e. over the
   taskbar, as in the afternoon session. `visibilityState` read `visible` throughout and
   every click was confirmed by re-reading state.
2. The v5 menu trap fired again (`UCTPROBE_VW_FN_SERIES_HISTORY` is v5): *Convert code
   to v6…* sits where *Create new* is on a v6 script. It was HOVERED, never clicked; the
   row was re-located from the DOM and the unbind completed. The source setter refuses
   any buffer that is not the fresh *Create new* template.
3. ⛔ **`USER;787899e263ad483c9c48748c6b6db574` IS NOW A SAVED SCRIPT.**
   `capture-procedure.md` calls that id TradingView's shared unsaved-buffer slot.
   `vw-int-array-avg.pine` was added unsaved first (to see whether it compiled), then
   saved — and the save kept that id: the account's saved list now holds
   `UCTPROBE_VW_INT_ARRAY_AVG` at `787899e2…`. So `id != 787899e2…` no longer means
   "genuinely saved", and the next unsaved add rides a different slot id
   (`vw-time-close-tf.pine`, added unsaved then saved, came out as `f6580dac…`).
   Nothing of the owner's was touched; the assertion in the procedure needs re-wording.
4. `eval` of a string is CSP-blocked on the page after any `await`; it works in the
   synchronous part of an evaluation. Files reach the page through a temporary
   `<input type=file>` (removed after loading), not through typed text.
5. The harness was NOT run on these fixtures (no engine in this lane); the integrator
   grades them.

### 1 — Q-L1, a timeframe below the chart's (`vw-lower-tf-{spy-1d,spy-1w,rddt-1d}-2026-09-30.json`)

SPY 1D: 4,800 bars 2007-08-31 → 2026-09-30. SPY 1W: 1,758 bars from the listing week.
RDDT 1D (not in the queue, taken because it grades ema-ribbon's symbol directly): 634
bars from the listing. Graded against TradingView's own intraday bars: the committed
`vw-bool-cast-spy-60-2026-09-28` (2,950 days in both) and tonight's RDDT 60 / 15 / 5 /
240 captures (633 days in both; 257 for 5m).

| row | what TradingView answers | measured |
|---|---|---|
| L02 `request.security(tickerid, "60", close)` on 1D | **the close of the day's LAST regular-session 60m bar** — not the daily close | SPY 2,950 / 2,950, RDDT 633 / 633. Equal to the first 60m close on 7 / 2,950 and 0 / 633. Equal to the chart's own `close` on only 339 / 4,800 SPY days and 84 / 634 RDDT days |
| L03 `… "60", time` | the last 60m bar's open: **15:30 ET** on 4,785 of 4,800 days; 12:30 on the 13 four-bar half-days (13:00 close), 13:30 / 14:30 on two older short days; always on the chart bar's own date | time equal 2,950 / 2,950 |
| L04 `… "60", ta.ema(close, 9)` | Pine's EMA run over the **60m closes**, read at the day's last 60m bar | 2,665 / 2,665 after 2,000 bars of warm-up, max abs diff 4.5e-13; equal to a daily EMA(9) on 0 / 4,599 |
| L05 `"15"`, L06 `"5"` | the close of the day's last 15m / 5m bar | RDDT 633 / 633 and 257 / 257; on SPY both equal L02 wherever they are not `na` |
| L07 / L08 look-ahead ON | **the day's FIRST 60m bar**: its close and its time (09:30) | close 2,950 / 2,950 (SPY), 633 / 633 (RDDT); time 09:30 on 4,800 / 4,800. Equal to the last 60m close on 7 / 2,950 |
| L09 `array.size(security_lower_tf(…, "60", close))` | **7** — the regular session; 4 on a 13:00 half-day | equals the number of RTH 60m bars that day 2,950 / 2,950; never 16 |
| L10 first element's time | **09:30** | 4,800 / 4,800 (never 04:00) |
| L11 last element, L12 volume sum | the last 60m close; the sum of the day's seven 60m volumes | 2,950 / 2,950 each |
| L15 / L16 `"240"` | two buckets, **09:30 and 13:30** (the second is 13:30–16:00); a 4-bar half-day has only 09:30. Each 240m bar is the aggregate of the 60m bars inside it | L15 13:30 on 4,787 days, 09:30 on 13; RDDT 240m bars open 09:30 ×634 and 13:30 ×628; L16 equals the last 240m close 633 / 633; 240m = aggregated 60m OHLCV on 1,260 / 1,260 buckets |

So rule (i) is **the last intrabar, look-ahead off** and rule (ii) is **the regular
session** — both as `lowerTf.js` assumed; look-ahead on is the FIRST intrabar.

⚠️ **The explicit extended-session control did not discriminate.** L13 / L14
(`ticker.modify(tickerid, session.extended)`) on a 1D chart read the same as the
regular rows: L14 is 7, not 16 (it differs from L09 on one day, 2007-12-24: 7 against
6), and L13 equals L02 on 4,800 / 4,800. Rule (ii) is therefore read from L03 / L09 /
L10 / L12 directly, not from the control. Why `session.extended` yields regular-session
intrabars on a daily chart is not answered here.

**How far back.** On 1D the 60m rows are non-`na` on all 4,800 loaded days (2007 →);
15m from 2011-06-06 (3,853 days), 5m from 2021-08-16 (1,287 days); before that the
request is `na`. On 1W the 60m rows start 2000-01-03; the 362 earlier weeks read `na`
and an intrabar array of size **0** (not `na`).

**1W.** L02 is the close of the WEEK's last 60m bar, L03 its time, L09 the number of 60m
bars in the week (35 in a full week), L07 / L08 the week's first 60m bar: each 612 / 612
complete weeks against the committed 60m bars. ⚠️ On 1W the extended control DOES
differ in size (L14 is 71 in a full week against 35) while L13 still equals L02 on
1,394 / 1,396 weeks (the two exceptions: 2001-09-10 and the forming week) — recorded,
not explained.

### 2 — Q-L2 / Q-L3, RDDT intraday bars (`vw-bar-counters-rddt-{15,60,240,5}-2026-09-30.json`)

Extended hours OFF on all four (`symbol.session` `0930-1600`); the study is the
committed `vw-bar-counters.pine` (any study would do — the bars are the capture).

| tf | bars | from | note |
|---|---|---|---|
| 15 | 16,397 | the listing day, 2024-03-21 (first bar 13:15 ET) | `startsAtBar0: true`; 26 bars a day, opens 09:30 … 15:45 |
| 60 | 4,417 | the listing day (12:30 ET bucket) | `startsAtBar0: true`; opens 09:30, 10:30 … 15:30 |
| 240 | 1,262 | the listing day | `startsAtBar0: true`; opens 09:30 and 13:30 |
| 5 | 20,052 | **2025-09-22** — the plan's depth limit, not the listing | `startsAtBar0: false`; 78 bars a day |

TradingView's 60m bars are its 15m bars bucketed from 09:30 (OHLCV equal on 4,413 /
4,413 buckets), its 15m bars are its 5m bars (6,658 / 6,658), its 240m bars are its 60m
bars (1,260 / 1,260).

### 3 — C34, whose history a conditional call reads (`vw-fn-series-history-rddt-1d-2026-09-30.json`)

634 bars from the listing, 25 labels, all made on the last bar.

| rows | TradingView's answer |
|---|---|
| S01 `volume[k]`, S03 `time[k]`, S04 `hl2[k]`, S05 `hlc3[k]`, S06 `ohlc4[k]` | **the chart's own value `k` bars back** at k = 5, 40 and 200 — 15 / 15 labels equal the capture's bars (hlc3 printed to 10 decimals) |
| S07 `close[k]` (control) | equal at all three offsets — the capture is read |
| ⛔ S02 `bar_index[k]` | **`NaN` at all three offsets** — NOT the chart's value (628 / 593 / 433). `bar_index` at an offset inside a helper called only on the last bar is `na` |
| C01 local `x[1]` (`x = close * 2`) | `NaN` (the every-bar value is 290.72) |
| C02 parameter `src[1]` | `NaN` (every-bar: 145.36) |
| C03 `ta.sma(close, 3)` | `NaN` (every-bar: 143.6267) |
| C04 `ta.highest(high, 10)` | **151.8899 — the last bar's own high**: a window of the one bar the call has run on (every-bar: 161.67) |

So `volume`, `time`, `hl2`, `hlc3`, `ohlc4` may move to the witnessed set;
**`bar_index` must not** (it answers like the call's own history); `time_close` and
`hlcc4` were not asked. The per-call-site rule is as documented: a local, a parameter
and `ta.sma` are `na` on the call's first execution, and `ta.highest` returns a
one-execution window, not `na`.

⚠️ The study holds 633 plot rows for 634 bars: bar 0, where all four plots are `na`,
has no row.

### 4 — Q-E1, a reached `runtime.error` (`vw-runtime-error-spy-1d-2026-09-30.json` + `tests/fixtures/vendor/runtime/vw-runtime-error-reached-spy-1d-2026-09-30.json`)

- **Control (defaults, `Stop at bar` = 0):** 4,800 rows, E00 runs 3,675 → 8,474, E01
  equals the close on 4,800 / 4,800, 50 labels held (the `max_labels_count` cap).
- **`Stop at bar` = 100** (set with `setInputValues` on the same study): **the study
  holds NOTHING.** `dataLength()` 0, 0 data rows, 0 labels, 0 lines, `isFailed` true —
  bars 0–99 carry no E00 / E01 and no label, although the error is on bar 100 and the
  chart window starts 3,575 bars after it. The pane is empty; the legend row shows the
  title with empty (∅) values and an error button labelled
  `User-defined error: RE10142 · Opened in Pine Editor`. `status()`, verbatim:

```
{"type":3,"errorDescription":{"ctx":{"bar_index":100,"code":"RE10142"},
 "error":"Error on bar {bar_index}: UCTPROBE stop at bar 100","is_user_defined":true,
 "stack_trace":[{"n":"#main","p":33}],"title":"User-defined error",
 "showReportItButton":false,"studyAccessBlocked":false}}
```

  The text a member sees is the template with `ctx.bar_index` substituted: *"Error on
  bar 100: UCTPROBE stop at bar 100"*. ⚠️ `tv_capture.js` throws on a `type: 3` study
  ("failed to compile"), so this half is a hand-sealed reading with its own FNV-1a
  receipt, in `tests/fixtures/vendor/runtime/`, not a v1 capture.

### 5 — Q-C32-1, `array.avg` of an `array<int>` (`vw-int-array-avg-spy-1d-2026-09-30.json`)

The probe compiled first time — `l.set_x2(l.get_x1() + a.avg() + 1)` is accepted for an
`array<int>` — so nothing was split out. Every plot row is constant over 4,800 bars.

| question | TradingView's answer |
|---|---|
| the value | **a float, the exact mean**: 1.5, 1.3333…, 1.6667…, 2.5, −1.5, −1.3333…, −1.6667… (A01–A07), equal to the `array<float>` control (B01–B03); ×2 / ×3 gives 3, 4, 5 (D01–D03). A `var` array filled by `push` reads the same (P01–P03). No rounding inside `avg` |
| `str.tostring(a.avg())`, no format | `1.5`, `1.3333333333`, `1.6666666667`, `2.5`, `-1.5` — the float, 10 decimals |
| `str.tostring(a.avg(), "##")` | `2`, `1`, `2`, `3`, `-2` for 1.5, 1.33, 1.67, 2.5, −1.5 — **round half away from zero**, identical to the float control (R14–R17: 1.5 → `2`, 2.5 → `3`). So C22's served cells are a float mean formatted by `"##"`; a ceiling would have printed `2` for 1.33 |
| `l.set_x2(l.get_x1() + a.avg() + 1)` then `l.get_x2() - l.get_x1()` | **2, 2, 2** for means 1.5, 1.33, 1.67 and **3** for 2.5 — the float sum is **truncated** to the int (2.5 → 2, 2.33 → 2, 2.67 → 2, 3.5 → 3), not rounded |

For trend-duration: `x2 = x1 + int(avg + 1)` with `int` dropping the fraction (22.6 →
x1 + 23, 18.5 → x1 + 19). ⚠️ Truncation toward zero and floor are the same on every
value measured (all positive); a negative sum was not asked.

### 6 — weekend bars and `time_close(<tf>)`

**`vw-time-tf-bitstamp-btcusd-1d-2026-09-30.json`** — 5,491 daily bars, 2011-08-18 →
2026-10-01 (forming), session `24x7`, timezone `Etc/UTC`, bars at 00:00 UTC.

- **The week starts MONDAY.** `time("W") - time` is 0 on every Monday bar (785) and −1 …
  −6 through Tuesday … **Sunday (−6, 782 bars)**; Saturday reads −5. `ta.change(time("W"))
  != 0` fires on Monday 785 times and on Tuesday 4 times (weeks whose Monday bar is
  missing — 19 bars in the capture are not one day after the previous). This settles the
  surviving Sunday-first mutation in § C30.
- `time("M")` is the 1st of the month at 00:00 UTC, `time("3M")` the first day of
  Jan / Apr / Jul / Oct, `time("12M")` Jan 1 — each 5,091 / 5,091 after the first 400
  bars. New-month fires on the 1st 181 times and on the 3rd once.
- The first partial periods answer the REAL open (bar 0, Thu 2011-08-18: −3 / −17 / −48 /
  −229 days), as on SPY.
- `time(timeframe.period)` and `time("60")` equal `time` on every bar.
  `timeframe.in_seconds`: 60, 3600, 86400, 604800, **2628003** (`"M"`), **31536036**
  (`"12M"`).

**`vw-time-close-tf-{spy-1d,bitstamp-btcusd-1d}-2026-09-30.json`** — the new probe
compiled first time.

| | AMEX:SPY 1D (4,800 bars) | BITSTAMP:BTCUSD 1D (5,491 bars) |
|---|---|---|
| `time_close("W")` | **the close of the week's LAST session**: Fri 16:00 (4,344 of the 4,500 bars after the first 300), Thu 16:00 when Friday is a holiday (128), 13:00 on a half-day (28). Equal to the `time_close` of the week's last chart bar 4,490 / 4,490; equal to the next week's open 0 / 4,490 | next Monday 00:00 UTC — which is both the last bar's `time_close` and the next week's open (5,181 / 5,181 each) |
| `time_close("M")` | the close of the month's last trading day (16:00, or 13:00), 4,460 / 4,460; never the next month's open | the 1st of the next month, 00:00 UTC |
| `time_close("3M")` / `("12M")` | the close of the quarter's / year's last trading day (12/31, or 12/30, 12/29 when the 31st is not a session) | the next quarter's / year's first day, 00:00 UTC |
| a forming period | the SCHEDULED close: on Wed 2026-09-30 the week reads Fri 2026-10-02 16:00, the year Thu 2026-12-31 16:00 | on Thu 2026-10-01: week Mon 10-05, month 11-01, quarter and year 2027-01-01 |
| `time_close(timeframe.period)`, `time_close("D")` | equal to `time_close` on every bar | same |
| the bar's own span `time_close - time` | 0.2708 d (6.5 h) on 4,787 bars, 0.1458 d (3.5 h) on 13 half-days | 1 day on every bar |
| `ta.change(time_close("W")) != 0` | fires on the week's first bar (Mon 901, Tue 94, Wed 1) | Mon 785, Tue 4 |

So on an exchange with sessions `time_close(<tf>)` is the period's last session close,
never a calendar boundary and never the next open; on a 24×7 symbol the two coincide.

### Saved private scripts (account `TSDR_TRADING`, none published)

| script | id |
|---|---|
| `UCTPROBE_VW_LOWER_TF` | `USER;bace59196de14f43ae90b15016df3735` |
| `UCTPROBE_VW_FN_SERIES_HISTORY` | `USER;6442cb42a16a467ca4bbb84a3c8d7b09` |
| `UCTPROBE_VW_RUNTIME_ERROR` | `USER;ab959255d7c34046a643ce6ea0c8d8ba` |
| `UCTPROBE_VW_INT_ARRAY_AVG` | `USER;787899e263ad483c9c48748c6b6db574` (⚠️ procedure note 3) |
| `UCTPROBE_VW_TIME_CLOSE_TF` | `USER;f6580dac04a544aca0158773c1f32ac8` |

Each is version 1.0, read back from the account's saved list (25 scripts in all).
`vw-bar-counters.pine` and `vw-time-tf.pine` were added from unsaved buffers and not
saved again. They are the owner's to delete.

### Still owed

| what | why |
|---|---|
| packet #3 `request-realtime-alignment.pine` | needs an open market |
| RDDT 5m bars before 2025-09-22 | the account's intraday depth stops at ~20,000 bars |
| why `ticker.modify(…, session.extended)` reads regular-session intrabars on a 1D chart, and 71 a week on 1W | not asked by any probe |
| `bar_index[k]` in a conditional call reading `na` | measured, surprising; a second probe (e.g. `bar_index[k]` beside `bar_index - k`, and `time_close[k]` / `hlcc4[k]`) would bound it |
| a negative `x1 + avg + 1` | truncation and floor not told apart |
