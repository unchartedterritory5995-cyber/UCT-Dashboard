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
