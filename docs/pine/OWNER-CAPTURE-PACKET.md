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
