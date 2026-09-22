# The presentation contract

> **SOURCE SEMANTICS → PRESENTATION CAPABILITIES → DEFAULT PRESENTATION → USER CHOICE**
>
> and never `ticker → chart style`.

A candlestick is a **claim**: that four numbers describe one auction period. A survey
produces one number a week. So "may this be drawn as candles" is a question about what
the source **means**, it is answered from metadata, and no part of the renderer is
allowed to learn that `NAAIM` or `AAII:BULLS` is special.

This note is the durable statement of that contract, so the next additions — TRIN,
put/call, NYMO/NYSI/NAMO/NASI, another sentiment survey, a new breadth percentage —
arrive into it instead of growing ticker-specific UI.

---

## The four stages

### 1. Source semantics — what the data IS

Declared **once, server-side**, in whichever catalogue owns the series:

| Field | Where | What it says |
|---|---|---|
| `source_type` | `market_indicators/registry.py` | `security` · `volatility` · `breadth_derived` · `survey` · `external_indicator` |
| `has_ohlc` | same | whether *this* series carries a real auction period |
| `presentation` | both catalogues | `line` · `histogram` · `step` — how the data wants to be drawn |
| `unit` / `domain` | both catalogues | `percent` / `count` / `ratio` …, and `pct_0_100` / `signed` / … |

`ohlc_capable` is the **conjunction**: `source_type in OHLC_CAPABLE and has_ohlc`. It is
per series and not per family, because Cboe publish VIX as `DATE,OPEN,HIGH,LOW,CLOSE`
and VVIX as `DATE,VVIX`. Both are volatility indices; only one has bars that mean an
auction period.

### 2. Presentation capabilities — what it MAY be drawn as

Two modules, and keeping them apart is load-bearing:

- **`engine/ohlcCapability.js`** — the candle question, and the **only** authority on
  it. Fail-closed across three dimensions: *identity* (is this row the instrument or a
  calculation over it — `passthrough`), *structural* (are there usable `o/h/l/c` in the
  loaded bars), *semantic* (does this provider family mean an auction period).
- **`engine/sourceCapability.js`** — the other half nobody had a seam for:
  `{ defaultStyle, allowedStyles }`. It takes the candle answer as an **input** and
  never recomputes it.

```
SCALAR_STYLES = every user style except candles      (derived, not hand-listed)
OHLC_STYLES   = SCALAR_STYLES + candles
```

### 3. Default presentation — what it STARTS as

`PRESENTATION_DEFAULT_STYLE` maps the catalogue's `presentation` to a starting style:

| declared | default | why |
|---|---|---|
| `line` | `line` | |
| `histogram` | `histogram` | a signed count reads as bars around zero |
| `step` | **`line`** | ⭐ product ruling (owner, 2026-09-21): a weekly survey *defaults* to a line; `step` stays **offered**. The metadata describes the observations honestly; this table decides the first impression. |

⛔ **An OHLC source still defaults to `line`.** Capability and default are different
questions. Making candles the default for anything candle-capable would silently redraw
every secondary symbol members already have on their charts.

⛔ **The source default outranks the definition's style only for a `passthrough` row.**
`dataSeries` declares `style: 'line'` for *every* source it plots — that string is a
placeholder, not an authored choice. MACD's histogram is an authored choice and no
source may repaint it. The gate is the same `passthrough` claim the candle gate uses,
so the two cannot disagree about "is this row its source".

### 4. User choice — what the member picked

The resolution order in `resolvePlotStyle`:

```
1. presentation.plots[plotKey].style   the member, for this output
2. presentation.plotStyle              the member, for this instance
3. ctx.sourceDefaultStyle              the SOURCE          (passthrough rows only)
4. plot.style                          the definition's author
5. DEFAULT_PLOT_STYLE                  'line'
```

A member's valid choice **persists and is never reset to the default**.

An invalid one is **clamped at read time and never rewritten**:

```js
if (allowed.length && !allowed.includes(chosen)) return allowed[0]
```

So a NAAIM instance persisted as `candles` by an older build comes back as a line, the
stored value is untouched, nothing migrates, and a source that later gains the
capability restores the member's choice. ⛔ **The clamp binds the renderer, not just the
menu** — it runs in `planBindings` too, because `poolKey` picks the series type from the
restyled plot. A capability model that only filters a `<select>` is a suggestion.

⛔ **Intersection, never union.** Placement rules (the volume pane refuses `histogram`
and `area`) and source rules both apply; a permissive source may not re-grant what
placement refused.

---

## Worked examples

| Source | Class | Default | Candles |
|---|---|---|---|
| Ordinary equity / index (`QQQ`) | OHLC | `line` | ✅ offered |
| `CBOE:VIX9D`, `CBOE:VXN` (real daily OHLC) | OHLC | `line` | ✅ offered |
| `CBOE:VVIX`, `CBOE:SKEW` (close-only at source) | scalar | `line` | ⛔ never |
| `SENT:NAAIM` (weekly survey) | scalar | `line` | ⛔ never |
| `AAII:BULLS/BEARS/NEUTRAL` | multi-output scalar | `line` | ⛔ never |
| `US:MCO`, `US:MCS`, `US:AD`, `US:ZBT` | scalar | `line` | ⛔ never |
| `US:NETHL` (signed count) | scalar | `histogram` | ⛔ never |
| `MA(sym:QQQ:close)` | calculation | `line` | ⛔ never (not `passthrough`) |

---

## Multi-output products

> **ONE DATASET → MULTIPLE RELATED OUTPUT SERIES → ONE COHERENT CHART**

A **product** is one member-facing thing made of several canonical series. AAII
Sentiment Survey is the first: `AAII:BULLS`, `AAII:BEARS`, `AAII:NEUTRAL`.

```
REGISTRY      AAII:BULLS   AAII:BEARS   AAII:NEUTRAL   ← three real canonical series
                    \           |           /
DISCOVERY        [ AAII Sentiment Survey ]             ← ONE catalogue row
                            | add
CHART         one pane, hosted by the first component
                dataSeries(sym:AAII:BULLS:close)    Bullish
                dataSeries(sym:AAII:BEARS:close)    Bearish
                dataSeries(sym:AAII:NEUTRAL:close)  Neutral
```

⭐ **A product is a DISCOVERY fact, not an identity.** Each component is a real series
with its own id, its own `/api/bars` door and its own formula address. The product says
only that a member who asks for one wants all of them, together, in one pane.

⭐⭐ **It builds nothing new.** `createProductSeries` creates ordinary `dataSeries`
instances through the ordinary door and points components 2..N at the pane the first one
hosts (`@<instanceId>`). That is exactly what a member could do by hand — which is
*why* the pane, the pane-owned legend, the micro-rails, per-output styling, show/hide,
scale sharing, formula addressability and saved-chart reconstruction all work with no
code that knows a product exists. `productSeries.test.js` asserts that equivalence
directly.

⛔ **Components are hidden from the catalogue LIST, not from resolution.** Searching
"AAII" must return one row; `/api/bars/AAII:BULLS` must still serve. Different questions.

⛔ **A product refuses to exist if its components disagree** about `unit` / `domain`
(`discovery.product_row`). Three outputs sharing one pane and one scale is a claim about
the data, and it is checked.

### Adding the next product

1. Register the component series (`registry.py`), each with its own `survey_key` or
   producer.
2. Add a `Product` naming them in order — that order is the draw and legend order.
3. Nothing else. Discovery, search, the add path, the pane and the legend already work.

---

## Rules that must not be relaxed

- **Candles require real OHLC semantics.** No synthetic OHLC, ever. `scalar_to_bars`
  produces close-to-close bodies whose "open" is yesterday's value; that shape is honest
  *only* because the capability gate refuses to draw it as a candlestick.
- **Presentation metadata may never feed a capability gate.** `canonicalPresentation`
  says how a source prefers to be drawn; `ohlcCapability` says what it may mean.
  Routing the first into the second would let a catalogue string grant a candle.
- **Fail closed.** An unclassified source is not candle-capable. The registries arrive
  over the network, and "we have not been told yet" must never read as "ordinary
  security".
- **One contract, two readers.** The dropdown (`ChartSettingsIndicators`) and the
  renderer (`binder` → `planBindings`) compute the source capability from the same two
  functions over the same inputs. A menu that offers what the resolver clamps, or hides
  what it would have honoured, is the same bug: two implementations of one rule.
- **No ticker lists, no prefix tests, in any renderer.**

## Where the code is

| Concern | File |
|---|---|
| Candle capability | `app/src/components/chart/engine/ohlcCapability.js` |
| Source capability (default + allowed) | `app/src/components/chart/engine/sourceCapability.js` |
| Style vocabulary, resolution, clamp | `app/src/components/chart/engine/presentation.js` |
| Registry → capability, per symbol | `app/src/hooks/useMarketIndicators.js` |
| Renderer wiring | `engine/binder.js` → `engine/pool.js` (`planBindings`) |
| Menu wiring | `app/src/components/chart/ChartSettingsIndicators.jsx` |
| Products: rows, results, creation | `app/src/components/chart/discoveryCatalog.js` |
| Products: registry | `api/services/market_indicators/registry.py` (`Product`) |
| AAII components | `api/services/market_indicators/aaii_store.py` |
| Tests | `engine/__tests__/sourcePresentation.test.js`, `chart/__tests__/productSeries.test.js` |
