---
id: E-03
title: Real-Time and Exchange-Fee Classification
role: Real-time and exchange-fee classifier
wave: 1
group: E
category: licensing
scope: uct-dashboard (terminal-research worktree) + OPRA / CTA / UTP plan documents + Massive(Polygon), Finnhub, Schwab, FMP vendor terms
confidence: 🟡 medium overall (code inventory 🟢; external plan/vendor rules 🟢; which CONTRACTS UCT actually holds 🔴 — owner facts, not inspectable)
evidence_ceiling: No executed agreement, invoice, plan tier or vendor account page was inspectable. Every "which licence do we hold" question is NOT DETERMINED and is listed in OWNER QUESTIONS. Production logs, Railway variables and the Schwab developer portal (HTTP 403) were also out of reach.
sources: api/services/realtime_stream.py, api/routers/stream.py, api/routers/live_prices.py, api/services/massive.py, api/services/bar_stream.py, api/massive_ws_worker.py, api/routers/massive_stream_router.py, api/live_massive_router.py, api/gex_service.py, api/schwab_service.py, api/services/breadth_live.py, api/services/discord_index_close.py, api/services/discord_close_note.py, api/routers/render_panels.py, api/darkpool_flatfile_ingest.py, app/src/components/AuthGuard.jsx, app/src/pages/Settings.jsx, cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf, ctaplan.com Nonprofessional Subscriber Policy, ctaplan.com Exhibit_A_CTA_Internal_and_External_Distribution.pdf, nyse.com Schedule Of Market Data Charges.pdf, utpplan.com/DOC/datapolicies.pdf, massive.com/terms/market_data_terms.pdf, massive.com/stocks, massive.com/business, finnhub.io/terms-of-service, site.financialmodelingprep.com/terms-of-service, marketdata.app/education/options/opra-fees/
uct_relevance: high
status: draft
date: 2026-09-02
---

# E-03 — Real-Time and Exchange-Fee Classification

> **Scope boundary.** E-01 owns full vendor ToS reading; E-04 owns derived-data
> rights; E-05 owns cost modelling. This artifact answers only: *what real-time
> data does UCT put in front of members today, what do the exchange plans and the
> vendor contracts say about that, and which surfaces are Allowed / Likely Allowed
> / Restricted / Unknown.* Where a derived-data or cost question is load-bearing
> for a classification I state the rule and hand the depth to E-04 / E-05.

> **This artifact classifies risk, not law.** It is a research read of public plan
> documents and public vendor terms against inspectable code. It is not legal
> advice and it cannot see a single executed contract. Every classification is
> conditional on an owner fact named in the row.

---

## 0. THE ONE-PARAGRAPH READ

UCT displays **real-time, un-delayed, consolidated US equity last-sale and quote
data, real-time OPRA options prints, and Schwab-sourced option-chain greeks** to a
paying member base, from **retail/self-serve vendor accounts whose published terms
license the data for the account holder's own personal, non-business use only**.
The market-data endpoints that serve those surfaces (`/api/live-prices`,
`/api/bars/{ticker}`, `/api/snapshot`, `/api/movers`, `/api/stream/prices`,
`/api/stream/bars`, `/api/gex/data`) carry **no authentication dependency at all**,
so the redistribution is not merely to members — it is to anyone who calls the
URL. There is **no non-professional attestation anywhere in the codebase**, no
entitlement/subscriber reporting system, and no exchange-form delay notice. The
single strongest mitigant available to Terminal-Next is the **UTP delayed-data
policy**, which makes 15-minute-delayed Nasdaq-listed equity display **fee-free
and subscriber-agreement-free** on a controlled product, and the
**multiple-security derived-data carve-out**, which makes UCT's breadth/RS/
correlation lane **not fee liable** — meaning a large fraction of the Terminal-Next
surface area can be built with no per-member exchange cost at all, if the real-time
single-symbol quote is treated as the one expensive primitive rather than the
default.

---

# PART 1 — INVENTORY: WHAT UCT SHOWS TODAY (Question 1)

## 1.1 The master inventory

### OBSERVATION

Fifteen distinct member-or-public-facing surfaces carry intraday or real-time
market data. The table below is assembled from the routers and services, not from
`CLAUDE.md`.

| # | Surface | Route / entry point | Data type | Provider (code-referenced) | Real-time or delayed | Audience | Auth on the data endpoint |
|---|---|---|---|---|---|---|---|
| 1 | Live quote tiles / watchlist / position marks | `GET /api/live-prices` | Equity last trade + day change + volume (full-market snapshot rows) | Massive REST `/v2/snapshot/locale/us/markets/stocks/tickers` | **Real-time** (15 s cache) | Members (all pages) | **NONE** |
| 2 | Tick price stream | `GET /api/stream/prices` (SSE) | Equity trade ticks | **Finnhub WebSocket** `wss://ws.finnhub.io` | **Real-time** | Members | **NONE** |
| 3 | Developing-bar push | `GET /api/stream/bars` (SSE) | Per-minute aggregates rolled to 5/15/30/60 | Massive WS `wss://socket.massive.com/stocks` | **Real-time** | Members (100 % rollout) | **NONE** |
| 4 | Chart bars (all TFs) | `GET /api/bars/{ticker}`, `/api/bars-history/{ticker}` | OHLCV aggregates, 1m→M, 5 000 bars | Massive REST; yfinance/FMP fallback | Intraday bars **real-time to the last closed bar** | Members | **NONE** (only `POST /api/bars/warm` requires a user) |
| 5 | Index/ticker snapshot | `GET /api/snapshot`, `/api/snapshot/{ticker}` | Last price, change % | Massive | **Real-time** | Members | **NONE** |
| 6 | Movers rails | `GET /api/movers`, `/api/extended-movers` | Gainers/losers snapshot | Massive gainers/losers snapshot | **Real-time** | Members | **NONE** |
| 7 | Live options flow tape | `/api/live/massive/recent`, `/curated`, `/by-contract`, SSE `/api/live/massive/stream` | **OPRA options trades**, per-print, classified | Massive OPRA WS `wss://socket.massive.com/options`, subscription `T.*` | **Real-time push** | Members (`/live-massive`) | Proxy-vouched (`api/flow_proxy.py`) |
| 8 | NBBO histogram / current quotes | `/api/live/massive/nbbo-histogram`, `POST /current-quotes` | **Options NBBO quote data** | Massive OPRA | Real-time | Members | Proxy-vouched |
| 9 | GEX / dealer positioning | `GET /api/gex/data`, `/compare` | Option-chain **greeks + open interest**, strike aggregation | **Schwab** `api.schwabapi.com/marketdata/v1/chains` | Real-time chain | Members (OptionsFlow) | **NONE** |
| 10 | Dark-pool prints | `/api/darkpool/data`, `/aggregated`, `/records` | **SIP consolidated trades**, off-exchange (exchanges 4/9) ≥ $4 M | Massive S3 flat file `us_stocks_sip/trades_v1/…` (T+1) + per-ticker `/v3/trades` same-day path | **T+1 historical** for the all-symbols lane; same-day for the per-ticker lane | Members | Proxy-vouched |
| 11 | Intraday breadth | `/api/breadth-monitor/live`, `…/live/drill/{k}` | **Derived**: % above N-MA, new highs/lows, up/down counts over ~3 700 names | One Massive full-market snapshot + bars.db reference levels | Real-time inputs, derived output | Members | Not checked per-route |
| 12 | Discord into-the-close charts | `discord_index_close.py`, 15:45 ET | Rendered candle charts, QQQ/SPY/IWM/DIA + 4 ETFs, incl. the developing session | Massive bars via `/r/chart` | **Real-time to ~15 min before the close** | **PUBLIC #TSDR Discord channel** | Webhook post |
| 13 | Discord `/chart` command | `discord_chart_house.py` → `/r/chart` | Candles + volume + MAs, TFs D/W/60/30/15/**5** | Massive bars | Real-time | Discord; app defaults **PUBLIC + USER_INSTALL** | Slash command |
| 14 | Headless render panels | `/r/chart`, `/r/flow`, `/r/movers`, `/r/breadth`, `/r/internals`, `/r/econ`, `/r/earncards`, … | Whatever the panel shows, incl. prices and flow | Massive et al. | Real-time | **"EFFECTIVELY PUBLIC"** by the router's own docstring | `CHART_RENDER_TOKEN`, **inlined into the JS bundle** |
| 15 | Substack / newsletter renders | consumers of `/r/*` panels | Screenshotted panels | as above | Real-time at capture | Newsletter audience | n/a |

### EVIDENCE

* Row 1 — `api/routers/live_prices.py` module docstring: *"Live batch pricing
  endpoint — returns real-time price data for up to 250 tickers. Uses Massive.com
  batch snapshot API (Polygon-compatible)."* The endpoint signature takes no
  `Depends(get_current_user)`. **CONFIRMED by source.**
* Row 2 — `api/services/realtime_stream.py:1-24`: *"Real-time price streaming via
  Finnhub WebSocket (primary) + Massive REST (fallback). Connects to
  wss://ws.finnhub.io for tick-by-tick trade data"*; `_WS_URL =
  f"wss://ws.finnhub.io?token={_FINNHUB_KEY}"`. `api/routers/stream.py:25`:
  `MAX_SSE_TICKERS = 50  # Finnhub free tier cap`.
  ⚠️ **`CLAUDE.md` says the price stream is "Massive/Polygon WebSocket". The code
  says Finnhub.** Treat the CLAUDE.md line as a CLAIM; `realtime_stream.py` is the
  artifact. This matters because Finnhub's terms are the strictest in the stack.
* Row 3 — `api/services/bar_stream.py:3,35`: *"Connects to
  wss://socket.massive.com/stocks (Polygon-protocol-compatible)"*;
  `_WS_URL = os.environ.get("MASSIVE_WS_URL", "wss://socket.massive.com/stocks")`.
* Row 4 — `api/routers/bars.py:317 get_bars` / `:691 get_bars_history`. The only
  auth import in the file (`from api.middleware.auth_middleware import
  get_current_user, require_admin`, line 14) is used at `:288 warm_bars_endpoint`
  and on the `/api/admin/*` routes. **CONFIRMED by source: the read path is open.**
* Rows 5, 6 — `api/routers/snapshot.py` and `api/routers/movers.py` are ~20 and
  ~35 lines, import only the Massive service, and declare no dependency.
* Row 7 — `api/massive_ws_worker.py:74` `"wss://socket.massive.com/options"`; `:78`
  `MASSIVE_WS_SUBSCRIBE = os.environ.get("MASSIVE_WS_SUBSCRIBE", "T.*")` — a
  wildcard subscription to **every OPRA trade**.
  `api/routers/massive_stream_router.py` docstring: *"GET /api/live/massive/stream
  — pushes newly-classified OPRA prints to the browser the instant the tailer sees
  them."*
* Row 9 — `api/gex_service.py:33`
  `CHAINS_URL = "https://api.schwabapi.com/marketdata/v1/chains"`, docstring
  *"Fetches Schwab /chains for greeks + OI"*; `api/gex_router.py:11`
  `@router.get("/data")` with no `Depends`; consumed at
  `app/src/pages/OptionsFlow.jsx:3426` (`fetch('/api/gex/data?ticker=…')`).
  `api/schwab_service.py:28-37` — `CHAINS_URL`/`QUOTES_URL` plus a **single
  process-wide OAuth token persisted at `/data/schwab_token.json`**. There is one
  Schwab identity behind every member's GEX view.
* Row 10 — `api/darkpool_flatfile_ingest.py:1-30`: *"scans the WHOLE day's equity
  tape once — `us_stocks_sip/trades_v1/YYYY/MM/YYYY-MM-DD.csv.gz`"*. The prefix
  names it: this is **SIP** (CTA/UTP consolidated) trade data.
* Row 11 — `api/services/breadth_live.py:1-16`: *"reference levels from bars.db,
  ONE windowed query … live comparison one full-market snapshot ~0.6 s, per
  refresh"*.
* Row 12 — `api/services/discord_index_close.py:1-17`: *"Into-the-close index + ETF
  charts, posted to the community #TSDR channel … Do those 15 minutes before market
  close"*; *"⛔ #TSDR IS THE PUBLIC COMMUNITY CHANNEL."*
* Row 14 — `api/routers/render_panels.py:1-9`: *"gated only by a shared render token
  (CHART_RENDER_TOKEN). That token is inlined into the frontend JS bundle, so treat
  these as **EFFECTIVELY PUBLIC**."*
* Audience — `app/src/components/AuthGuard.jsx:112`:
  `const FREE_PAGES = ['/morning-wire']`. Every other page is paid-gated **in the
  SPA**. ⚠️ That is a client-side route guard; the data endpoints in rows 1–6 and 9
  are not behind it.

Provider status, using the preamble's ladder:

| Provider | Status | Basis |
|---|---|---|
| Massive (formerly Polygon.io) | **CODE-REFERENCED** | `api/services/massive.py:17` `_REST_BASE = "https://api.massive.com"`; WS URLs above. Seed facts assert live production flow, which would make it OBSERVED-CALLED, but I could not read logs. |
| Finnhub | **CODE-REFERENCED** | `realtime_stream.py:24`; also insider/earnings/IPO calendars elsewhere. |
| Schwab | **CODE-REFERENCED** | `schwab_service.py`, `gex_service.py`. Partner-owned integration. |
| FMP | **CODE-REFERENCED** | earnings tables, fundamentals, intraday fallback in `bars_fetch`. |
| yfinance | **CODE-REFERENCED** | VIX/BTC/futures snapshots, split-adjusted bar fallback. |

### INTERPRETATION

Three things fall out of the inventory that a licensing review has to hold at once:

1. **The perimeter is not the paywall.** UCT's commercial control is a React route
   guard. The market-data primitives are open HTTP. From an exchange plan's point
   of view there is no meaningful difference between "we display to 200 paying
   members" and "we operate an unauthenticated public quote API" — the second is
   what the code implements, and it is the harder posture to defend.
2. **The most-restricted provider is on the least-visible surface.** Finnhub — the
   provider whose terms flatly say *"strictly for personal use"* and *"not
   redistribute or share access to data or derived results … with anyone or any 3rd
   party"* — powers the always-on tick stream every page's quote tiles read, and it
   is doing so on the **free tier** (the code's own cap comment).
3. **Two surfaces leave the member perimeter entirely** — the 15:45 ET public
   Discord chart post and the `/r/*` panels whose token ships in the bundle. Those
   are redistribution to the public, not display to subscribers, and they are the
   surfaces where "display to your users" language stops helping.

### RELEVANCE TO UCT

Terminal-Next inherits all fifteen rows unless it deliberately re-scopes them.
Whatever the product decides, the licensing shape of Terminal-Next is set by **four
primitives**, not fifteen surfaces: (a) the real-time single-symbol equity quote,
(b) the real-time options print, (c) the option chain/greeks, (d) everything
derived. (a)–(c) are expensive and contract-gated; (d) is largely free. That is the
whole design lever.

### CONFIDENCE

🟢 high on the inventory itself — every row is a file I read.
🟡 medium on "real-time vs delayed" for the Massive-sourced rows: the endpoints UCT
calls return real-time data **on a real-time-entitled plan** and 15-minute delayed
data **on a delayed plan**, from the same URL. Which one arrives is a function of
the account tier, which I cannot see.
**EVIDENCE CEILING:** no Massive account page, invoice, or production response
payload was reachable, so freshness was never measured empirically. What would
raise it: one owner statement of the plan tier, or a single timestamped sample
response compared against a known-real-time reference.

### RECOMMENDATION

Before any Terminal-Next decision, measure freshness rather than assume it: take one
snapshot response for a liquid name during RTH and compare its trade timestamp to
wall clock. A 15-minute skew moves several rows below from Restricted to Likely
Allowed at a stroke, and it is a one-command measurement.

### OPEN QUESTION

Which Massive plan tier is in force — Basic (EOD), Starter/Developer (15-min
delayed), Advanced (real-time), or Business? The public tier list is in §3.1.

---

## 1.2 The 15:45 ET "no numerals" rule is NOT licensing-driven

### OBSERVATION

The contract asked whether the Discord index-close post's no-numerals rule might be
licensing-driven. It is not. The rule is an anti-hallucination guard on the
LLM-written *note*, and the same job **computes and renders the numbers** on the
chart image beside it.

### EVIDENCE

`api/services/discord_close_note.py:11-16`, verbatim:

> *"⛔ THE NOTE CONTAINS NO NUMERALS. Not a style rule, a safety one: a model
> writing market prose will happily invent "SPY closed at 645" and this posts
> unattended to a PUBLIC channel. Forbidding digits outright removes the entire
> class rather than policing it — there is nothing left to fact-check. Every number
> a member sees is computed by `discord_index_close` and rendered on the chart."*

Enforced mechanically at `:39` `_DIGIT_RE = re.compile(r"\d")` and in `validate()`
at `:63`. **CONFIRMED by source.**

### INTERPRETATION

So the licensing question the no-numerals rule *appears* to answer is in fact wide
open: the post carries a **rendered price chart of QQQ/SPY/IWM/DIA plus four ETFs,
built from real-time bars, into a public Discord channel, fifteen minutes before the
close**. Prose without digits is not a data-licensing control; the picture is the
data.

### RELEVANCE TO UCT

This is the clearest example in the codebase of a control that reads as licensing
hygiene and is not. If Terminal-Next inherits public chart posting, the control it
needs is a *delay or an aggregation rule on the image*, not a digit filter on the
caption.

### CONFIDENCE

🟢 high. The docstring states the intent and the regex enforces it.

### RECOMMENDATION

Treat the public Discord chart post as a **redistribution surface** in its own row
of any licensing register, separate from the member app. The cheapest compliant form
is the one the exchanges already bless: a chart whose last bar is ≥15 minutes old,
with a prominent "Data delayed 15 minutes" burned into the image (see §2.3).

### OPEN QUESTION

Is the 15:45 ET post considered marketing (public, must be delayed or aggregated) or
member content that merely happens to sit in a public room?

---

# PART 2 — EXCHANGE-LEVEL RULES (Question 2)

## 2.1 "Non-Professional Subscriber" — the definition every plan shares

### OBSERVATION

CTA, UTP, OPRA and every vendor that resells them use one substantially identical
definition, and all of them place the **qualification duty on the vendor**, not the
end user.

### EVIDENCE

CTA Nonprofessional Subscriber Policy (ctaplan.com, published November 2016 — still
the posted policy), verbatim:

> *"'Nonprofessional Subscriber' refers to any **natural person** who receives
> market data **solely for his/her personal, non-business use** and who is not a
> 'Securities Professional,' meaning that the person is: (a) not registered or
> qualified in any capacity with the Securities and Exchange Commission, the
> Commodities Futures Trading Commission, any state securities agency, any
> securities exchange/association, or any commodities/futures contract
> market/association; and (b) not engaged as an 'investment advisor,' as that term
> is defined in Section 202(a)(11) of the Investment Advisers Act of 1940 (whether
> or not registered or qualified under that Act); and (c) not employed by a bank or
> other organization exempt from registration … to perform functions that would
> require him/her to be so registered."*

And the enforcement teeth:

> *"Distributors are required to verify the status of any subscriber applying to
> receive data at the Nonprofessional Subscriber rate. **If NYSE finds that the
> vendor has incorrectly qualified a professional subscriber as nonprofessional,
> the vendor will be liable for retroactive fees billed by NYSE for the subscriber
> at the professional rate.**"*

> *"Subscriber may not receive Market Data as a 'Nonprofessional Subscriber' unless
> the **vendor providing that data to Subscriber first determines** that the
> individual falls within the above definition."*

Edge cases the same policy settles, all directly relevant to a trading-education
member base:

* **Account in an organisation's name ⇒ Professional**, even for genuinely personal
  use: *"if the market data is received through an organization's account, this
  individual is classified as a Professional Subscriber … because the account
  through which the market data is received is not registered to a natural person."*
* **Day traders CAN be Non-Professional** — *"A day-trader can qualify as a
  Nonprofessional if he/she is managing his/her own money AND: Does not assist any
  other person with investment decisions, nor he/she share profits; and is not a
  'Securities Professional.'"* This is the single most important line for UCT's
  population.
* **Large traders keep non-pro status** (SEC Rule 13h-1 does not disqualify).
* **Retired/inactive professionals** may qualify but must **re-verify semi-annually**.

### INTERPRETATION

Two consequences shape any Terminal-Next design:

1. **A member who trades a strategy UCT teaches is very likely a legitimate
   Non-Professional.** The cheap rate is genuinely available to this population.
   The risk is not that members are professionals; it is that **nobody has asked
   them**, and the vendor of record eats the difference retroactively at the
   professional rate ($27–45/device/month on Network A alone) for anyone
   mis-qualified.
2. **"Is UCT the vendor?" decides everything else.** If UCT redistributes exchange
   data to members under its own vendor agreements, UCT owes the qualification, the
   reporting, the entitlement system and the audits. If UCT's upstream vendor holds
   a redistribution licence that *covers* UCT's members as its own subscribers, most
   of that machinery is the upstream's — but UCT's member count and their pro/non-pro
   split still flow through to the upstream's bill (see §3.1).

### RELEVANCE TO UCT

There is **no non-professional attestation anywhere in the product**. A
case-insensitive sweep of `app/` and `api/` for `non-professional`,
`nonprofessional`, `non professional`, `subscriber agreement` and
`professional subscriber` returns **zero hits**. Signup collects email, password and
display name; it collects no status representation and presents no exchange
subscriber agreement.

### CONFIDENCE

🟢 high on the definition (primary plan document, quoted).
🟢 high on the absence of an attestation in code (a negative grep across both trees).

### RECOMMENDATION

If Terminal-Next ships real-time single-symbol quotes to members, the
non-professional click-through is not optional decoration — the CTA Exhibit A form
lists it as a **required contract artifact** (Exhibit B for nonprofessional
subscribers, Exhibit C for the "click-on" agreement). It is also cheap: a signup
checkbox carrying the (a)/(b)/(c) test, a stored timestamped attestation, a
semi-annual re-verify for anyone who declared retired-professional, and a monthly
count.

### OPEN QUESTION

Does UCT intend to be a **vendor of record** with the SIPs, or to stay entirely
downstream of a vendor whose redistribution licence names UCT's members?

---

## 2.2 US equities — CTA/CQ (Tapes A & B): the fee stack and the vendor obligations

### OBSERVATION

CTA publishes both the money and the machinery. The money is small per member; the
machinery is the expensive part.

### EVIDENCE

**CTA Schedule of Market Data Charges** (nyse.com/publicdocs/ctaplan), extracted
verbatim from the PDF:

| Line item | Network A (NYSE) | Network B (NYSE American / regionals) |
|---|---|---|
| Professional Subscriber, per device/month, 1–2 devices | **$45.00** | **$23.00** |
| Professional, 3–999 devices | $27.00 | $23.00 |
| Professional, 1 000–9 999 | $23.00 | $23.00 |
| Professional, 10 000+ | $19.00 | $23.00 |
| **Nonprofessional Subscriber, per month per subscriber** | **$1.00** | **$1.00** |
| Per-quote-packet (alternative to display charge) | $0.0075 (or $0.0025 for BDs with 500 k+ nonpros) | same |
| Nonpro per-quote-packet **monthly cap** | $1.00 | $1.00 |
| **Redistribution charge, per month** | **$1,000** | **$1,000** |
| Non-display use — last sale / quotation | $2,000 / $2,000 | $1,000 / $1,000 |
| Data access, indirect (through a vendor) — last sale / bid-ask | $750 / $1,250 | $400 / $600 |
| Late quote-meter audit | $3,000/month past due | — |

The redistribution trigger, verbatim (note 7):

> *"The Redistribution Charges apply to **any entity that makes last sale
> information or quotation information available to any other entity or to any
> person other than its employees, irrespective of the means of transmission or
> access**."*

Display vs non-display, verbatim (notes 2 and 8):

> *"display data use subject to the Network A and Network B Subscriber charges shall
> mean **only data that is visibly available to the data recipient**; any other data
> use on a Device shall be considered Non-Display Use."*
> *"Non-Display Use … **does not apply to the creation and use of derived data**."*

**CTA Exhibit A** — the vendor questionnaire every external redistributor files —
sets out the operational obligations. Verbatim:

* *"Every external (non-employee) firm or nonprofessional subscriber must sign or
  electronically agree to the appropriate NYSE agreement **before gaining access to
  real-time data**. Nonprofessional subscribers may sign up and agree via an
  electronic click-on agreement."*
* *"Vendors are required to qualify an end-user as a nonprofessional user **prior
  to** their gaining access to CTA data."*
* Delayed service: *"In a delayed service, Last Sale and Bid-Asked prices must be
  **delayed at least 15 minutes**."* and *"Phrases such as 'Prices delayed 15
  minutes' must be **conspicuously displayed on all screens** displaying delayed
  data."*
* Entitlement system, required capabilities: *"Separate and unique ID/Passwords for
  each user which are not shared; Prevent simultaneous access to the data by the
  same user ID/Password; Generate monthly entitlement reports …; Provide an audit
  trail identifying each entitlement transaction"*, retained **no less than three
  years**.
* The stick: *"**Unless the entitlement system is able to provide accurate
  historical/audit information, NYSE reserves the right to bill for all devices on
  your network.**"*
* Reporting: nonprofessional vendors *"maintain records of the **name, address,
  employer and job function** of their nonprofessional subscribers and only report
  the **total number** of nonprofessional subscribers who accessed Real-time data at
  least once during that month."* Monthly, by the second-to-last business day.

### INTERPRETATION

The per-member number is trivially small — **$2.00/member/month** buys Tapes A and B
at the non-professional rate. The *fixed* and *operational* costs dominate: $1,000 +
$1,000/month redistribution, access charges, an entitlement system with per-user IDs
and three-year audit trails, monthly reporting, and quote-meter audits if the
per-quote model is chosen.

Set that against what UCT has: **no per-user entitlement on the data endpoints at
all**. `GET /api/live-prices?tickers=AAPL` is answerable by an unauthenticated
caller. Under the Exhibit A language, an entitlement system that cannot produce
accurate historical information licenses NYSE to *"bill for all devices on your
network."* An open endpoint has no bounded device count.

The derived-data carve-out cuts the other way and is genuinely favourable: CTA states
plainly that non-display fees *"do not apply to the creation and use of derived
data"* and that display charges attach only to data *"visibly available to the data
recipient."* UCT's breadth engine consumes a full-market snapshot and displays a
**percentage**, not the quotes. (E-04 owns the depth; §4.4 states the design
consequence.)

### RELEVANCE TO UCT

Terminal-Next's cost driver is not the tape fee. It is whether the product must build
subscriber entitlement, attestation, monthly reporting and audit retention — a real
engineering programme — or whether it can stay downstream of a vendor who already
runs all of it.

### CONFIDENCE

🟢 high on the quoted figures and clauses (primary CTA/NYSE documents).
🟡 medium on currency: the Schedule of Market Data Charges PDF carries no visible
effective date in the extracted text, and the Nonprofessional Policy is dated
November 2016. Rates move.
**EVIDENCE CEILING:** the current published schedule should be re-pulled from
ctaplan.com before any number here reaches a budget. E-05 should treat these as
order-of-magnitude, not quotable.

### RECOMMENDATION

If UCT ever becomes a vendor of record, budget the *machinery* first: entitlement
with unique non-shared credentials, concurrent-session prevention, monthly
entitlement reports, three-year audit retention, and a monthly nonpro count. Those
are architecture decisions, not line items, and retrofitting them onto an open
endpoint is the expensive path.

### OPEN QUESTION

Does UCT hold, or intend to hold, an NYSE Vendor Agreement + Exhibit A? If not, which
upstream vendor's agreement is UCT relying on to reach members?

---

## 2.3 US equities — UTP (Tape C, Nasdaq-listed): the delayed-data gift

### OBSERVATION

The UTP Plan's Data Policies contain the single most useful rule in this artifact for
Terminal-Next: **15-minute-delayed Nasdaq-listed data on a controlled product is free
and needs no subscriber agreement.**

### EVIDENCE

UTP Data Policies (utpplan.com, published September 2023), verbatim:

> **Delay Interval.** *"A period of time after which Information becomes Delayed
> Information. For UTP Information, the Delay Interval is **15 minutes**."*

> **Fees.** *"Vendors are permitted to delay UTP Information and **there is no charge
> for UTP Delayed Information distributed on Controlled Products**, if delayed for
> the appropriate timeframe. Fees may apply for the receipt/distribution of the UTP
> Delayed Information on an **Uncontrolled Product**."*

> **Subscriber agreements.** *"Vendors are currently **not required to obtain
> Subscriber Agreements** from Subscribers of Delayed and/or End-of-Day Information
> on Controlled Products."*

> **Prominent delay message.** *"The delay message must **prominently appear on all
> displays containing Delayed Data, such as at or near the top of the page**. In the
> case of a ticker, the delay message should be interspersed with the Information at
> least every 90 seconds. Examples … 'Data Delayed 15 minutes', 'Data Delayed 24
> hours', 'Delayed Data', 'Del-15'."*

> **Display requirements (real-time AND delayed).** *"FINANCIAL STATUS INDICATOR:
> Vendors must display the Financial Status Indicator for all intraday single
> security quotes or trade displays."* Plus a Consolidated Volume Message wherever
> consolidated volume appears alongside non-UTP data.

And the derived-data taxonomy, verbatim:

> *"**DERIVED DATA: SINGLE SECURITY [FEE LIABLE]**: UTP does not offer discounts for
> Single Security Derived Data, so Derived Data that contains price data and is based
> upon a single UTP security symbol is generally fee liable at the underlying product
> rates."*
> *"**DERIVED DATA: MULTIPLE SECURITY [NOT FEE LIABLE]**: Derived Data that contains
> price and/or volume data is based upon multiple UTP security symbols is currently
> not fee liable. Examples … Total Portfolio Valuations, Creation of Indexes."*
> *"**DERIVED DATA: REAL-TIME VOLUME ONLY DATA [NOT FEE LIABLE]**: Vendors are
> permitted to distribute each issue's **Real-Time volume information which may be
> provided along with Delayed Last Sale Information or Delayed Quotation information
> at no additional charge**."*

Plus the qualifying test for "Derived Data" at all: *"1) The Derived Data cannot be
reverse engineered to recreate the Information, and 2) The Derived Data cannot be
used to create other data that is recognized to be a reasonable facsimile for the UTP
Information."*

Separately, from a UTP vendor-alert summary: delayed UTP for internal use carries a
**$250 annual administrative fee**; external delayed distribution carries **$250
annual + $250/month external delayed redistributor fee**.

### INTERPRETATION

Three distinct design levers fall straight out of this:

1. **Delayed + controlled ⇒ no per-user fee, no subscriber agreement.** A logged-in
   member area *is* a controlled product. If Terminal-Next's default quote is
   15-minute delayed with a prominent delay message, the entire Tape C per-member
   cost and the entire Tape C subscriber-agreement burden vanish.
2. **Real-time VOLUME may accompany delayed PRICE, free.** Better than it sounds:
   volume surge, relative volume and unusual-volume detection — the signals a
   momentum desk actually reacts to — stay live while the price is delayed. A
   "delayed price, live volume" tape is a legitimate, fee-free, exchange-blessed
   design.
3. **Multiple-security derived data is not fee liable.** Breadth, RS ranking, sector
   flow, correlation matrix, theme returns, the exposure score — all multi-symbol
   aggregates — sit outside the fee net *provided* they pass the
   no-reverse-engineering test. A percentage across 3 700 names does. A "live price
   for one ticker, computed from the snapshot" does not: that is single-security
   derived data, explicitly **fee liable at the underlying rates**.

Note the trap in (3): calling something "derived" does not make it free. UCT's live
quote tile is derived from a snapshot and sits squarely in the fee-liable
single-security bucket. The distinction is *aggregation across symbols*, not
*transformation*.

### RELEVANCE TO UCT

The `Del-15` posture is not a downgrade for most of the product. Of the fifteen
inventory rows, the ones that genuinely need un-delayed single-symbol prices are rows
1–6 and the live candle in rows 12/13. Rows 10, 11 and the entire analytics / breadth
/ screener / wire / journal surface are either multi-symbol derived data, T+1
historical, or end-of-day.

### CONFIDENCE

🟢 high — primary plan document, quoted, September 2023 publication.
🟡 medium on the $250/$250 delayed-redistributor figures (secondary summary of a
vendor alert, not the fee schedule itself).
**EVIDENCE CEILING:** current UTP Level 1 nonprofessional per-subscriber pricing is
**NOT DETERMINED** — searches returned only historical alerts. E-05 must pull it from
utpplan.com before modelling Tape C real-time cost.

### RECOMMENDATION

Prototype the delay boundary before deciding the product: build the delayed-price /
live-volume tape and put it in front of the owner. If it reads as adequate for the
teaching workflow, the licensing programme for Terminal-Next collapses to a much
smaller thing. Note that the Financial Status Indicator requirement applies to
**delayed intraday single-security displays too** — the delay does not exempt it.

### OPEN QUESTION

Is the member app a **Controlled Product** in plan terms (entitled, per-user, not a
raw feed)? Almost certainly yes as designed — but the open `/api/live-prices`
endpoint arguably makes it an *Uncontrolled* one, which is the fee-liable category.

---

## 2.4 Options — OPRA: delayed does NOT get you off the hook

### OBSERVATION

OPRA's structure is materially harsher than the equity plans in one specific way: the
**redistribution fee applies to delayed data too**, and it is a fixed monthly cost
with no small-scale exemption.

### EVIDENCE

**OPRA Fee Schedule** (cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf), extracted
verbatim:

| Line item | Amount |
|---|---|
| Professional Subscriber, per display device/month | $30.50 (from 2017-01-01); **$31.50** (from 2018-01-01) |
| **Nonprofessional Subscriber fees, per nonpro/month** | **up to 75 000: $1.25**; 75 001–150 000: $1.15; 150 001–250 000: $1.00; 250 001–500 000: $0.75; 500 001+: $0.60 |
| Usage-based vendor fee | $0.0075 per quote packet or $0.03 per options chain; nonpro monthly cap **$1.25** |
| **Redistribution fee** | **$1,500/month**; $650 query-service-only |
| Subscriber indirect access fee (professional, via a vendor feed) | $600/month |
| Direct access fee | $1,000/month |
| Non-display, Categories 1/2/3 | $2,000 each |
| Hosted solution — current data | $100 per solution, or $10,000 enterprise |
| Hosted solution — **delayed** data | $50 per solution, or $5,000 enterprise |

The redistribution trigger, verbatim:

> *"**Redistribution Fee**: Monthly fee payable by every vendor that redistributes
> OPRA Data to any person, **whether on a current or delayed basis**, except that
> this fee does not apply to a Vendor whose redistribution of OPRA Data is limited
> solely to 'historical' OPRA Data."*

And on the usage-based side, verbatim: *"All inquiries are counted for purposes of
calculating usage-based fees, **except that requests for 'delayed' and 'historical'
OPRA Data are not counted**."*

Corroborated by a practitioner summary (marketdata.app, *OPRA Fees & Licensing
Explained for Developers*): *"if you're showing OPRA data externally in an app, tool,
or website, you're considered a redistributor and this fee is required"*; and *"if
you only display delayed or historical options data (older than 15 minutes), OPRA
does not charge per-user display fees"* — **but the $1,500/month redistribution fee
still applies**. The same source gives current per-user rates as nonpro *"starting at
$1.25/month per user, with volume discounts"* and professional *"$31.50/month per
user or per device"* — matching the primary schedule exactly, which is good evidence
the 2018 figures are still live.

### INTERPRETATION

The economics of the options tape are step-shaped, not linear:

* **Historical-only options data ⇒ no redistribution fee, no per-user fee.**
* **Delayed (≥15 min) options display ⇒ $1,500/month floor, zero per-user.**
* **Real-time options display ⇒ $1,500/month floor + $1.25/member/month.**

For a ~200-member base the real-time premium over delayed is ~$250/month — small. The
step from *historical-only* to *any live-or-delayed redistribution* is $1,500/month —
large, and it is the step UCT has already taken with `/live-massive`.

Note also that UCT's OPRA consumption is a **wildcard `T.*` subscription — every
options trade on the tape** (`api/massive_ws_worker.py:78`). That is a full-tape
consumption profile, and the flow-worker persists it to `flow.db` with T+1 flat-file
gap-fill. Whether the stored tape counts as "historical OPRA Data" after the fact,
and whether serving `/by-contract` history from it is the exempt historical case or
ongoing redistribution, is a question the fee schedule does not answer on its face —
it turns on the vendor agreement.

### RELEVANCE TO UCT

`/live-massive` is UCT's most licensing-exposed member surface and also, per the seed
facts and the nav, one of its most distinctive. Terminal-Next should not assume it is
free to carry forward, and should not assume delaying it makes it free — delaying
removes the per-member fee, not the floor.

### CONFIDENCE

🟢 high on the fee lines (primary OPRA schedule, quoted).
🟡 medium on currency: the extracted schedule's newest stated rates are 2018. The
independent 2026-era practitioner summary reproducing the same $31.50 / $1.25 /
$1,500 figures is decent corroboration, but it is secondary.
**EVIDENCE CEILING:** opradata.com did not resolve from this machine (DNS timeout).
The current schedule should be re-pulled before budgeting.

### RECOMMENDATION

Decide the options tape's tier explicitly and early — it is the only surface where the
*fixed* cost is big enough to be a product decision rather than a line item: (i)
retire it, (ii) historical-only, (iii) delayed, (iv) real-time. (ii) is the only one
that is free.

### OPEN QUESTION

Does the Massive agreement UCT holds cover OPRA redistribution to UCT's members —
i.e. is Massive the vendor of record paying the $1,500 and reporting UCT's members as
its nonpros — or is UCT a subscriber whose own redistribution is unlicensed?

---

## 2.5 How the plans treat aggregates and bars differently from top-of-book

### OBSERVATION

All three plans draw the same line, and it is not the line an engineer would guess.
The distinction is **not** raw-vs-processed. It is **single-symbol price vs
multi-symbol aggregate**, and **displayed vs consumed**.

### EVIDENCE

| Category | Plan treatment | Source |
|---|---|---|
| Top-of-book quote, single symbol, displayed | Full display/subscriber fee | CTA Schedule note 2; OPRA Basic Service |
| Last sale, single symbol, displayed | Full display/subscriber fee | as above |
| **Derived, single security, containing price** | **Fee liable at underlying rates** | UTP Derived Data Policy §1 |
| **Derived, multiple securities** | **Not fee liable** | UTP Derived Data Policy §2 |
| **Real-time volume only** (alongside delayed price) | **Not fee liable** | UTP Derived Data Policy §3 |
| Non-display use (algo, risk, valuation, order routing, surveillance) | Separate $1,000–$2,000/month per category | CTA note 8; OPRA note 10 |
| Derived data generally | *"does not apply to the creation and use of derived data"* — non-display fees do not reach it | CTA Schedule note 8 |
| Delayed (≥15 min), equities, controlled product | UTP: free, no subscriber agreement. CTA: contracted delayed service + conspicuous notice | UTP Delayed Data Policy; CTA Exhibit A §3 |
| Delayed, options | No per-user fee, **but $1,500/mo redistribution still applies** | OPRA Fee Schedule, Redistribution line |
| Historical only, options | **Exempt from redistribution fee** | OPRA Fee Schedule, Redistribution line |
| Bars/aggregates | Not separately named in the plans. Aggregates are built from last-sale prints; a single-symbol intraday bar is single-security data derived from Information | inference — see CONFIDENCE |

### INTERPRETATION

**Bars are the ambiguous case, and UCT's product rests on them.** The plans define
Information, Delayed Information, End-of-Day Information and Derived Data; they do not
carve out "OHLCV aggregates". A daily bar published after the close is End-of-Day
Information and is the cheapest thing in the taxonomy. A **developing intraday bar
streamed tick-by-tick is functionally a real-time last-sale display for a single
symbol**, and would fail UTP's own derived-data test 2 — it *is* a reasonable
facsimile of the Information. `/api/stream/bars` at 250 ms cadence is not meaningfully
different from a quote feed and should not be argued as derived.

Conversely a **5 000-bar daily history** is the safest data in the product, and UCT's
charts are mostly that.

### RELEVANCE TO UCT

The chart is the heart of Terminal-Next and it is *mostly* cheap. What is expensive is
precisely the last bar. A design that renders complete history plus a
15-minute-delayed developing bar, with live volume overlaid, is close to free — and
close to what a swing-trading workflow actually needs.

### CONFIDENCE

🟡 medium on the bars row specifically — my inference from the plans' structure, not a
quoted rule. No plan document I reached names OHLCV aggregates.
🟢 high on every other row (all quoted above).
**EVIDENCE CEILING:** the authoritative answer on aggregates lives in the vendor
agreement's data-product definitions and in the SIP administrators' interpretive
guidance, neither of which I could reach. A market-data counsel or the vendor's
compliance desk settles it in one email.

### RECOMMENDATION

Do not build a Terminal-Next licensing story on "bars are derived, therefore free".
Build it on the two rules that *are* written down: multi-symbol aggregates are not fee
liable, and delayed single-symbol display is fee-free on Tape C.

### OPEN QUESTION

How does UCT's vendor classify intraday aggregates — as Information, or as a separate
licensed product with its own terms?

---

# PART 3 — VENDOR-LEVEL RULES (Question 3)

## 3.1 Massive (formerly Polygon.io) — the account this product runs on

### OBSERVATION

Polygon.io **rebranded to Massive in early 2026**. `api.massive.com` and
`socket.massive.com` are the same platform whose Polygon-protocol compatibility the
code comments repeatedly note. The self-serve terms license the data for the
**account holder's own personal, non-business use** and prohibit building an
application for use by anyone but the account holder.

### EVIDENCE

**Polygon.io / Massive Market Data Terms of Service, Last Updated October 9, 2024**
(massive.com/terms/market_data_terms.pdf), verbatim:

§1 Permission to Use Market Data:
> *"Polygon hereby grants you a nonexclusive, nontransferable, non-sublicensable,
> revocable, limited license to use Market Data **exclusively for your personal,
> non-business, and non-commercial purposes**. For the avoidance of doubt, you may
> not use the Market Data for any business or commercial purpose, and **you may not
> use the Market Data to build an application intended for use by end users other
> than you**."*

§2:
> *"The Market Data may not be copied, reproduced, republished, uploaded, posted,
> publicly displayed, encoded, translated, transmitted, or distributed in any way
> (including 'mirroring') to any other computer, server, website, or other medium for
> publication or distribution or for any business or commercial enterprise, without
> Polygon's express prior written consent … **any and all Market Data is strictly for
> display use only**."*

§3 Subscriber Classification:
> *"Market Data is made available to you on the basis that you represent and warrant
> to us that you are a Non-Professional … and that you will use the Market Data solely
> for your personal, non-business use … **Any use of Market Data for business,
> professional, or other commercial purposes is incompatible with Non-Professional
> status**, even if the business or commercial use is on behalf of an organization not
> in the securities industry."*
> *"You will **indemnify** Polygon for any fees, costs, losses, liabilities, or
> expenses that Polygon may incur … in connection with any such representation or
> warranty being incorrect."*

§5 Restrictions — the governing clause, with its own escape hatch:
> *"**Absent prior express written consent from Polygon or to the extent permitted by
> an agreement with a Third Party Provider**, you may not: … (c) Redistribute,
> display, disseminate, duplicate, license, sublicense, publish, broadcast, transmit,
> distribute, redistribute, perform, display, sell, resell, rebrand, or otherwise
> transfer the Market Data — **or any data, charts, analytics, research, or other
> works based on, referring to, or derived from the Market Data ('Derived Works')** —
> to any third party or use the Market Data for business or commercial purposes; (d)
> Use Market Data for non-display use or to create derivative works … unless you are
> licensed to do so."*

§4 Third Party Providers — the account holder is **deemed to enter the exchange
subscriber agreements personally**: the OPRA Non-Professional Subscriber Agreement
(Schedule 1), the UTP Plan Subscriber Agreement, and the NYSE Agreement for Market
Data Display Services (Schedule 2). The OPRA schedule's ¶2, verbatim:

> *"You shall receive the Service and the OPRA Data included therein **solely for your
> own business or personal use, and you shall not retransmit or otherwise furnish the
> OPRA Data to any person, other than your own employees on devices that are subject
> to the control of Vendor**."*

**Plan tiers** (massive.com/stocks and massive.com/business, read 2026-09-02):

| Plan | Price | Freshness | Licence |
|---|---|---|---|
| Basic | Free | End-of-day | Personal and non-professional use |
| Starter | $29/mo | **15-min delayed** | Personal and non-professional use |
| Developer | $79/mo | **15-min delayed** | Personal and non-professional use |
| Advanced | $199/mo | **Real-time** | Personal and non-professional use |
| **Business** | **from $2,499/mo (stocks)** | Real-time | **Commercial and display rights** |

Massive's own gate, verbatim: *"Individual plans (Basic → Advanced) are licensed for
personal and non-professional use. For **brokerage, redistribution, customer-facing
display, or 200+ users, you'll need a Business plan**."* And on the business-options
page: *"Additional exchange fees apply to these products. Our experts will help you
understand their fees and guide you through exchange approval."*

### INTERPRETATION

This is the decisive vendor clause for UCT, and it cuts three ways:

1. **On an individual plan (Basic/Starter/Developer/Advanced), essentially every
   member-facing surface in Part 1 is prohibited** — not only the raw quote but
   *"charts, analytics, research, or other works based on, referring to, or derived
   from"* the data. §5(c)'s Derived Works clause is far broader than the exchange
   plans' derived-data carve-out, which means **the vendor contract, not the exchange
   plan, is the binding constraint on UCT's breadth and analytics lane too.** That is
   a genuinely counter-intuitive result: the exchanges would let UCT publish
   market-wide breadth for free; the self-serve vendor terms would not.
2. **On a Business plan, the same §5 opens** — *"Absent prior express written consent
   from Polygon or to the extent permitted by an agreement with a Third Party
   Provider"* — and the Business tier is explicitly sold as covering *"redistribution,
   customer-facing display"*. So the single owner fact that settles roughly half this
   artifact is: **which Massive plan is in force?**
3. **"200+ users" is an explicit numeric trigger** in the vendor's own words, and the
   seed facts describe a ~200-member base with growth ambitions. Cost scales with
   member count both at the vendor tier boundary and, downstream, at the exchange
   nonpro per-member rate.

### RELEVANCE TO UCT

`_REST_BASE = "https://api.massive.com"` (`api/services/massive.py:17`) is the single
most load-bearing line of configuration in the product's licensing posture.
Terminal-Next's cost model (E-05) should start from the Business floor of $2,499/month
for stocks, plus separate options business pricing, plus pass-through exchange fees —
not from the $199 Advanced tier.

### CONFIDENCE

🟢 high on the terms text (primary PDF, quoted, dated).
🟢 high on the plan tiers and the "200+ users / Business plan" gate (vendor's own
pages).
🔴 low on **which plan UCT holds** — NOT DETERMINED. Nothing in the repository states
a tier; the key name `MASSIVE_API_KEY` reveals nothing about entitlement.
**EVIDENCE CEILING:** one look at the Massive account dashboard, or one invoice,
resolves this and would move six rows of §4's classification table.

### RECOMMENDATION

Answer the plan-tier question before any other licensing work. It is a single lookup,
and until it is answered every classification below that depends on it is Unknown
rather than Restricted — and the difference between those two words is the difference
between a compliance finding and a research note.

### OPEN QUESTION

Is there an executed Massive Business/Enterprise agreement, and does it name
**customer-facing display of OPRA data** as well as equities?

---

## 3.2 Finnhub — the strictest terms, on the free tier, powering the tick stream

### OBSERVATION

The live tick stream feeding every quote tile runs on Finnhub, and the code itself
identifies the tier as free. Finnhub's terms are the most restrictive of any provider
in the stack.

### EVIDENCE

Finnhub Terms of Service (finnhub.io/terms-of-service), verbatim:

> *"All plan listed on Finnhub website is **strictly for personal use** unless
> explicitly stated otherwise."*
> *"**Personal plan can't be used by any business even internally** without a written
> approval."*
> *"You hereby agree to **not redistribute or share access to data or derived results
> from the data** obtained from Finnhub with anyone or any 3rd party **without written
> approval** from Finnhub."*

Code: `api/services/realtime_stream.py:1-24` (Finnhub WS is the primary live-price
source); `api/routers/stream.py:25` `MAX_SSE_TICKERS = 50  # Finnhub free tier cap` —
the cap comment is the tell that the free tier is what is configured.

### INTERPRETATION

Note the phrase *"or derived results from the data"*. Like Massive's Derived Works
clause, it reaches past the raw tick into anything computed from it. And unlike the
exchange plans there is no non-professional rate, no delayed carve-out and no
aggregate exemption — only *"written approval"*.

There is a second, quieter risk: a free-tier dependency in a member-facing production
path is a **continuity** exposure as much as a licensing one. A vendor enforcing its
own terms does so by cutting the key, and the quote tiles across the entire product
read from this stream.

### RELEVANCE TO UCT

Of all fifteen inventory rows, row 2 has the cleanest, least ambiguous conflict
between what the code does and what the published terms permit. It is also, at 50
tickers per connection, the easiest to replace: the same data is already available
from Massive's WS (`bar_stream.py`) and its snapshot API, both of which UCT already
calls.

### CONFIDENCE

🟢 high on the terms (quoted from the vendor's own page).
🟡 medium on the tier — the free-tier cap comment is strong circumstantial evidence,
but a paid Finnhub plan could carry the same 50-symbol code path.
**EVIDENCE CEILING:** the Finnhub account page settles the tier; only Finnhub can
confirm whether a written approval exists.

### RECOMMENDATION

For Terminal-Next, consolidating live quotes onto the one vendor that will hold the
redistribution agreement removes a whole provider's terms from the surface area at no
product cost. The code notes the two-feed split as a deliberate isolation choice —
worth preserving the isolation *pattern* while reducing the *vendor count*.

### OPEN QUESTION

Is there a paid Finnhub plan or a written commercial approval on file?

---

## 3.3 Schwab — account-holder-only, on one shared token

### OBSERVATION

GEX, dealer positioning and the option-chain greeks are served from Schwab's Market
Data Production API using **one OAuth token belonging to one Schwab account holder**,
and displayed to every member.

### EVIDENCE

Code: `api/schwab_service.py:3` *"Endpoints used: Market Data Production (read-only,
no trading)"*; `:28-29` `CHAINS_URL`, `QUOTES_URL`; `:33-37` the token persists to
`/data/schwab_token.json` — a **single, process-wide** credential.
`api/gex_service.py:33` uses the same chains URL; `api/gex_router.py:11`
`@router.get("/data")` has **no auth dependency**;
`app/src/pages/OptionsFlow.jsx:3426` is the member-facing caller.

Schwab's market-data subscriber terms, the operative sentences:

> *"Non-professional subscribers shall receive market information **solely for their
> personal, non-business use**. Subscribers shall **not furnish market data to any
> other person or entity**."*

Schwab's developer programme distinguishes an **Individual Developer** tier (free API
access for Schwab brokerage account holders building applications for personal or
limited-distribution use) from a **Commercial / Redistribution** tier, where
*"commercial use, market-data redistribution, and large-scale integrations require
Schwab review and exchange-data agreements."*

### INTERPRETATION

The shared-token architecture makes the licensing question unusually crisp: there is
no sense in which each member is "the account holder". One person's entitlement is
being fanned out to the whole membership. If the app is registered under the
Individual Developer tier, that is the textbook shape of the restriction Schwab's
subscriber terms describe.

### RELEVANCE TO UCT

GEX is a differentiated surface, and its provider has the least negotiating
flexibility — Schwab does not sell a market-data redistribution product to a
media/education business the way Massive does. If Terminal-Next wants dealer
positioning, the realistic path is **re-source the chain from the redistribution
vendor** (Massive sells options chains and greeks) rather than to license Schwab.

### CONFIDENCE

🟡 medium. The code facts are 🟢 (I read them); the terms are 🟡 because
**developer.schwab.com returned HTTP 403** to my fetch and I am relying on Schwab's
public market-data subscriber language plus secondary descriptions of the developer
tiers.
**EVIDENCE CEILING:** the executed Schwab API Developer Agreement and the app's
registered tier. Both are visible from inside the developer portal.

### RECOMMENDATION

`schwab_router.py` is partner-owned. This finding should reach the owner as a sourcing
question — *"can GEX be rebuilt on the redistribution vendor's chains?"* — not as a
change request against a partner file.

### OPEN QUESTION

Under which Schwab developer tier is the app registered, and does any Schwab agreement
contemplate display to non-account-holders?

---

## 3.4 FMP — individual plans explicitly forbid display to end users

### OBSERVATION

FMP's terms are unusually explicit about the exact thing UCT does, and they name the
product that fixes it.

### EVIDENCE

FMP Terms of Service, the operative language:

> *"Personal use licenses may only be used by individuals for their own personal,
> non-business and non-commercial purposes, and may not be used on behalf of a
> company, partnership, organization, or any other third party. More specifically,
> **individual plans don't allow the display or distributing of the data to end users
> or the public**."*
> *"Without prior written approval … customers may not distribute, publicly perform or
> display, lease, sell, transmit, transfer, publish, edit, copy, create derivative
> works, rent, sub-license, or otherwise make unauthorized use of the Services."*
> *"**Displaying or redistributing data sourced from FMP requires a specific Data
> Display and Licensing Agreement with FMP.**"*
> *"Access to real-time or delayed data may be subject to **additional agreements with
> the relevant exchange**, and applicable licensing fees may be required."*

FMP in the code: the Model Book earnings table (`stable/earnings`), fundamentals, and
an intraday bars fallback in `bars_fetch` — mostly fundamental/historical rather than
real-time, which is the lower-risk end of its catalogue.

### INTERPRETATION

FMP's exposure is narrower than Massive's or Finnhub's because most of what UCT takes
from it is fundamentals and historical earnings, not live prices. But the *intraday
bars fallback* means FMP data can reach a live chart, and the named remedy — a **Data
Display and Licensing Agreement** — is a discrete, purchasable artifact rather than a
negotiation.

### RELEVANCE TO UCT

E-01 owns the full FMP read. For this artifact the relevant point is only that the
intraday fallback path puts FMP data on a real-time-feeling surface, so FMP belongs in
the display-licence conversation even though it is not a quote vendor.

### CONFIDENCE

🟡 medium — the terms text comes from a search-result rendering rather than a verbatim
fetch (site.financialmodelingprep.com returned HTTP 403). The quoted sentences are
consistent across two of FMP's own pages.
**EVIDENCE CEILING:** re-fetch the ToS from a context that is not blocked, or read it
in a browser.

### RECOMMENDATION

Ask FMP for the Data Display and Licensing Agreement quote at the same time as the
Massive Business quote — the two together give E-05 a real number for "what does
compliant Terminal-Next data cost".

### OPEN QUESTION

Does UCT hold an FMP plan above the individual tier, and does it include a Data
Display and Licensing Agreement?

---

# PART 4 — CLASSIFICATION (Question 4)

## 4.1 How to read the classes

* **Allowed** — permitted on any plausible reading of the plan and vendor terms.
* **Likely Allowed (verify contract)** — permitted *if* the named owner fact holds;
  the fact is the whole question.
* **Restricted** — prohibited on the published self-serve terms; requires a specific
  contract for which I found no evidence.
* **Unknown** — I could not determine enough to classify.

Every row's "what moves it" column names the **one owner fact** that changes the
class. Nothing here is a finding of breach; a Business/redistribution agreement I
cannot see would move most Restricted rows to Allowed in one step.

## 4.2 Current surfaces

| # | Surface | Class | Driver clause | What owner fact moves it | Cost scales with members? |
|---|---|---|---|---|---|
| 1 | `/api/live-prices` real-time quotes to members | **Restricted** | Massive ToS §1 *"may not … build an application intended for use by end users other than you"*; §5(c) Derived Works | Massive **Business** plan with customer-facing display | **Yes** — nonpro/member/month + Business tier at 200+ users |
| 1a | …served **unauthenticated** | **Restricted** (independently) | CTA Exhibit A entitlement requirements; *"NYSE reserves the right to bill for all devices on your network"* | Nothing contractual fixes this — it is an engineering gap | Unbounded by construction |
| 2 | `/api/stream/prices` Finnhub tick stream | **Restricted** | Finnhub ToS *"strictly for personal use"*; *"not redistribute or share access to data or derived results … with anyone or any 3rd party"* | Written Finnhub commercial approval | Yes (or a vendor swap removes the row) |
| 3 | `/api/stream/bars` developing-bar push | **Restricted** | Massive §5(c); a 250 ms developing bar is a real-time single-symbol display, not derived data (UTP derived test 2) | Massive Business plan | Yes |
| 4 | `/api/bars/{ticker}` **daily/weekly/monthly history** | **Likely Allowed** | End-of-Day Information is the cheapest class; multi-day history is not a facsimile of live Information | Massive plan permits commercial display | No |
| 4a | `/api/bars/{ticker}` **intraday, current session** | **Restricted** | as row 3 | Massive Business plan | Yes |
| 5 | `/api/snapshot`, `/api/snapshot/{ticker}` | **Restricted** | as row 1 | Massive Business plan | Yes |
| 6 | `/api/movers`, `/api/extended-movers` | **Likely Allowed** | Multi-symbol ranked list; UTP Derived Data §2 multiple-security **not fee liable**. ⚠️ but it prints each name's live % change — single-security price data — so it is arguably §1 fee-liable | Vendor confirmation of how a movers list is classified | Possibly |
| 7 | `/live-massive` real-time OPRA tape to members | **Restricted** | OPRA NonPro Subscriber Agreement ¶2 *"shall not retransmit or otherwise furnish the OPRA Data to any person"*; OPRA Redistribution Fee $1,500/mo | Massive Business **options** agreement naming customer-facing display | **Yes** — $1.25/member/mo + $1,500/mo floor |
| 8 | Options NBBO histogram / current quotes | **Restricted** | as row 7 (quote data is Basic Service) | as row 7 | Yes |
| 9 | GEX from Schwab chains, one shared token | **Restricted** | Schwab subscriber terms *"shall not furnish market data to any other person or entity"*; Individual Developer tier is personal/limited-distribution | A Schwab Commercial/Redistribution registration, **or** re-source chains from the redistribution vendor | No (fixed) |
| 10 | Dark-pool prints, T+1 SIP flat file | **Likely Allowed** | Historical/EOD is the cheapest class in every plan; OPRA's historical exemption is the analogue | Massive flat-file product licence permits display | No |
| 10a | Dark-pool **same-day** per-ticker `/v3/trades` lane | **Unknown** | Same-day trade prints past the delay interval are Delayed Information; inside it they are Information | Whether the same-day lane runs inside or outside the 15-min interval — measurable in code | Possibly |
| 11 | Intraday breadth (% above MA, NH/NL, over ~3 700 names) | **Likely Allowed** | UTP Derived Data §2 *"multiple UTP security symbols is currently **not fee liable**"*; CTA note 8 non-display *"does not apply to … derived data"* | ⚠️ Massive §5(c) Derived Works is **broader than the plans** and would still bar it on an individual plan | **No** — this is the free lane |
| 11a | Breadth **drill-down lists** (the names behind a cell) | **Likely Allowed** | A symbol list carries no price; not Information | Confirm the drill payload carries no live price | No |
| 12 | 15:45 ET public Discord index/ETF charts | **Restricted** | Redistribution to the **public**, not to subscribers. OPRA/CTA redistribution language reaches *"any person other than its employees"* | A redistribution agreement **plus** a delay + conspicuous notice on the image | No (fixed) |
| 13 | Discord `/chart` (public + user-install), incl. 5-min TF | **Restricted** | as row 12, and the install scope makes the surface unbounded | Delay the image and burn in the notice; or restrict install scope | No |
| 14 | `/r/*` panels behind a bundle-inlined token | **Restricted** | The router's own docstring says *"EFFECTIVELY PUBLIC"*; public real-time display is redistribution | Real auth on `/r/*`, or delay the panels | No |
| 15 | Substack/newsletter screenshots of `/r/*` | **Unknown** | Depends whether the capture is delayed and whether the newsletter is public | Whether captures are ≥15 min old at publish; audience | No |
| — | Morning Wire, UCT20, screener, calendar, journal, model book, COT | **Allowed** | End-of-day / historical / CFTC public data / user-entered data | — | No |

## 4.3 Likely Terminal-Next surfaces

| Terminal-Next surface | Class as commonly built | Driver clause | Cheaper compliant form |
|---|---|---|---|
| Watchlist with real-time quotes | **Restricted** without a display licence | Massive §5(c); CTA/UTP/OPRA display fees | 15-min delayed price **+ real-time volume** (UTP Derived Data §3, explicitly free), prominent `Del-15` |
| Security header live price | **Restricted** | single-security real-time display | delayed price + live volume + live % of ADV |
| News with a price attached | **Likely Allowed** if the price is delayed or EOD | the headline is not exchange data | attach a delayed or prior-close price |
| Price alerts (server-side evaluation) | ⚠️ **Non-display use** — a separate fee category | CTA note 8 / OPRA note 10: alerting/surveillance is named Non-Display | Category 1 non-display is **$2,000/mo (CTA A)**; check whether the vendor licence covers it. The surface most likely to be missed. |
| Alert **delivery** to a member (email/Discord carrying a price) | **Restricted** if the price is real-time | redistribution outside the controlled product | send the level and the direction, not a live quote; or delay |
| Screener / scan results with live price columns | **Likely Allowed** at the aggregate; single-symbol price columns are fee-liable | UTP Derived §1 vs §2 | rank on multi-symbol derived metrics; show delayed price |
| Breadth, RS, correlation, sector flow, theme returns | **Allowed** on the plans, **Restricted** on individual vendor terms | UTP Derived §2 free; Massive §5(c) still bites | Business plan removes the vendor bar; the plans never charged |
| Charts (history) | **Likely Allowed** | EOD/historical | — |
| Charts (developing bar) | **Restricted** | real-time single-symbol | delayed last bar; live volume bar |
| Options flow tape | **Restricted** | OPRA redistribution + per-user | historical-only is the **only free** option; delayed still costs $1,500/mo |
| AI narrative over market data (the wire, stock briefs) | **Likely Allowed** if grounded on EOD/derived inputs | prose about multi-symbol aggregates is not Information | ground on EOD + multi-symbol derived facts, never on a live quote |
| Community chat with pasted charts | **Unknown** | member-generated redistribution | a terms-of-use clause; the images are member-posted |

## 4.4 Two cross-cutting findings the table cannot express

### OBSERVATION A — the vendor contract binds tighter than the exchange plan

### EVIDENCE

UTP Derived Data Policy §2: multiple-security derived data is *"currently not fee
liable"*. Massive ToS §5(c): the prohibition extends to *"any data, charts, analytics,
research, or other works based on, referring to, or derived from the Market Data
('Derived Works')"*.

### INTERPRETATION

UCT's breadth engine, RS rankings, correlation matrix and theme returns are exactly
the thing the exchanges declared free — and exactly the thing the self-serve vendor
terms forbid. **Reasoning from the exchange plans alone would produce the wrong answer
for UCT's most defensible lane.**

### RELEVANCE TO UCT

The analytics lane — the part of Terminal-Next with the best margin, the least
per-member cost and the clearest differentiation — is gated by a vendor tier decision,
not by exchange economics. That is a good problem: it is solved by one purchase, not
by a product compromise.

### CONFIDENCE

🟢 high — both clauses quoted from primary documents.

### RECOMMENDATION

Frame the Massive Business conversation around **derived-works rights**, not just
display rights. A display licence that does not clearly permit publishing multi-symbol
analytics would leave UCT's best lane exactly where it is now.

### OPEN QUESTION

Does the Business agreement's grant explicitly reach Derived Works, or only display of
the underlying data?

---

### OBSERVATION B — server-side alerting is non-display use and is separately priced

### EVIDENCE

OPRA Fee Schedule note 10, verbatim: Non-Display Use *"includes, without limitation,
trading …; automated order or quote generation …; price referencing for algorithmic
trading; operations control programs; investment analysis; order verification;
**surveillance programs**; risk management; compliance; and portfolio valuation."*
CTA Schedule note 8: *"any use of the data that does not make the data visibly
available to the data recipient on a device is a Non-Display Use."* Category 1 (own
behalf) is $2,000/month on CTA Network A and $2,000/month on OPRA.

UCT already runs several of these shapes: `watchlist_alert_service` price alerts
piggybacked on the 15 s live-price poll, `api/services/awareness/rules.py` stop-hit and
stop-proximity watching, indicator alerts, and the flow-worker's threshold
classification.

### INTERPRETATION

Alerting is not a display surface, so it does not appear anywhere in the display-fee
reasoning above — and it is the category most likely to be omitted from a licensing
review precisely because nothing is on screen. A member-facing alert engine evaluating
live prices server-side sits close to the plans' *"surveillance programs"* and
*"operations control programs"* language.

### RELEVANCE TO UCT

Terminal-Next's alert engine is a headline feature in most terminal designs. It should
enter the cost model as a **fixed non-display line**, not as a free by-product of a
display licence.

### CONFIDENCE

🟡 medium. The plan language is quoted and 🟢; whether a member price alert is Category
1 non-display or an incident of display is an interpretive question I cannot settle
from the documents alone. Both plans reserve *"the sole determination"* to themselves.
**EVIDENCE CEILING:** vendor compliance desk or market-data counsel.

### RECOMMENDATION

Put the question to the vendor in writing early. If alerting is covered by the Business
licence, that is worth knowing before designing around it; if it is a separate
$2,000+/month category, that is a product-scope decision, not a surprise invoice.

### OPEN QUESTION

Does an alert that a member configured, evaluated server-side, count as that member's
display or as the platform's non-display use?

---

# PART 5 — DELAYED-DATA DESIGN IMPLICATIONS (Question 5) 🟡

### OBSERVATION

Sorting the Terminal-Next workflows by whether they actually need un-delayed data
produces a much shorter "expensive" list than the current architecture implies.

### EVIDENCE + INTERPRETATION

**Fine on 15-minute delayed or end-of-day data:**

| Workflow | Why delay is harmless |
|---|---|
| Morning Wire, pre-market prep, UCT20 leadership | Runs at 07:35 ET off the prior close |
| Breadth monitor, exposure score, analogues | Multi-symbol derived; the authoritative EOD row already exists |
| Screener / scan definitions | `scan_evaluator.cadence_ceiling` already proves every declared scalar is `cadence: nightly` — the whole tree is EOD by construction |
| Model Book, setup library, charted examples | Historical years |
| Journal, broker sync, analytics, Compass coaching | Fills are user/broker-sourced; marks tolerate delay |
| Calendar, earnings, filings, transcripts | Event data, not market data |
| COT positioning | CFTC public weekly data — outside all three plans entirely |
| Dark-pool records / EOD summary | T+1 by design already |
| AI search, stock briefs, wire narrative | Grounded on derived + EOD facts |
| Chart history, drawings, multi-chart grids | Everything but the last bar |

**Genuinely needs un-delayed data:**

| Workflow | Why | Cheapest compliant shape |
|---|---|---|
| Live options flow tape | The product *is* the timing of the print | Historical-only is free; delayed costs the $1,500/mo floor with no per-member fee |
| Intraday entry/stop management on an open position | A 15-minute-old price is the wrong number for a stop | Delayed price + **real-time volume** + live % change vs prior close is a surprisingly complete surface |
| Session-shape breadth (`breadth_intraday`) | The *shape* argument requires now | Multi-symbol derived ⇒ free under UTP §2; delay is unnecessary |
| Movers rails at the open | The point is the first fifteen minutes | Multi-symbol list; the ranking is free, the per-name % is the fee-liable part |
| Alerts on price | Latency is the feature | Non-display category regardless of delay (§4.4B) |

**The load-bearing lever, stated once:** UTP Derived Data Policy §3 permits
**real-time volume alongside delayed price at no additional charge**. For a
momentum/relative-strength desk — which is what UCT teaches — volume surge, relative
volume and unusual-volume detection carry much of the intraday signal. A "delayed
price, live volume, live breadth" terminal is a coherent, differentiated product, not
a degraded one, and it is close to free on the equity side.

### RELEVANCE TO UCT

This reframes the Terminal-Next data decision from *"can we afford real-time?"* to
*"which two or three surfaces genuinely need it, and is the options tape one of
them?"* The answer determines whether the licensing programme is a $2,499+/month
vendor contract plus an entitlement build, or a delay banner and a volume overlay.

### CONFIDENCE

🟡 medium, as the contract requested. The plan rules behind it are 🟢 (quoted); the
product judgement about which workflows tolerate delay is my reading of the codebase's
own cadences, not an owner decision, and it is offered as evidence for the product
roles rather than as a recommendation.

### RECOMMENDATION

Give the delayed-price / live-volume shape to the product roles as a **testable
hypothesis with a cheap experiment**: one surface, one week, owner verdict. If it
survives, it removes the largest single cost and compliance obligation from
Terminal-Next. If it fails, the failure is specific and tells you exactly what you are
buying real-time for.

### OPEN QUESTION

Does the owner's own trading workflow tolerate a 15-minute price delay when live
volume and live breadth are preserved?

---

# PART 6 — OWNER QUESTIONS, RANKED

The first three settle most of the classification table.

1. **Which Massive plan is in force** — Basic / Starter / Developer / Advanced /
   Business? Is there an executed Business or Enterprise agreement, and does its grant
   cover (a) customer-facing display, (b) OPRA options display, (c) **Derived Works**
   (charts, analytics, breadth)?
2. **Who is the vendor of record with the SIPs and OPRA?** Is Massive reporting UCT's
   members as its nonprofessional subscribers, or does UCT hold (or need) its own NYSE
   Vendor Agreement + Exhibit A, UTP Vendor Agreement, and OPRA Vendor Agreement?
3. **Is the Finnhub tick stream on a free/personal plan**, and is there any written
   commercial approval? (Simplest remediation in the whole artifact: consolidate quotes
   onto the vendor that will hold the redistribution licence.)
4. **Under which Schwab developer tier is the app registered**, and is any Schwab
   agreement compatible with displaying chain data to non-account-holders?
5. **Are members ever asked to attest non-professional status?** (Code says no.) If
   real-time display is in Terminal-Next's future, is UCT willing to add the
   attestation, the monthly count, and the semi-annual re-verify?
6. **Should the data endpoints be authenticated?** `/api/live-prices`,
   `/api/bars/{ticker}`, `/api/snapshot`, `/api/movers`, `/api/stream/*` and
   `/api/gex/data` are open today. Under CTA Exhibit A, an entitlement system that
   cannot produce accurate historical information licenses NYSE to bill for every
   device on the network.
7. **Is the public Discord chart post marketing or member content?** It carries
   real-time index charts into a public room fifteen minutes before the close.
8. **Should `/r/*` get real auth?** The token is inlined in the JS bundle and the
   router says so itself.
9. **Is server-side price alerting covered by the display licence, or is it Category 1
   non-display?**
10. **Is the same-day dark-pool `/v3/trades` lane inside or outside the 15-minute delay
    interval?** This is measurable in code and I did not measure it.

---

# GAPS

* **No contract, invoice, plan tier or account page was inspectable.** Every
  "Restricted" class in §4 is conditional on the absence of an agreement I cannot see.
  This is the single largest gap and it is not closable from the repository.
* **No production evidence.** I did not read Railway logs, variables, or any live
  response, so no provider rose above CODE-REFERENCED on the preamble's ladder, and I
  could not empirically test whether Massive-sourced prices are real-time or
  15-minute delayed — the measurement that would reclassify six rows.
* **Current fee schedules not re-verified.** The OPRA schedule I extracted states
  2017/2018 rates (corroborated as still-current by a 2026 secondary source but not by
  the primary); the CTA charges PDF carries no visible effective date in the extracted
  text; the CTA Nonprofessional Policy is dated November 2016. opradata.com did not
  resolve (DNS timeout). **UTP Level 1 nonprofessional per-subscriber pricing is NOT
  DETERMINED** — searches returned only historical vendor alerts. E-05 must re-pull all
  four before modelling.
* **Schwab developer terms are second-hand.** developer.schwab.com returned HTTP 403.
  FMP's ToS likewise (403); its quoted language comes from a search-result rendering of
  FMP's own pages, consistent across two of them.
* **Bars/aggregates are unresolved in the plans.** No plan document I reached names
  OHLCV aggregates as a category. §2.5's bars row is inference, flagged 🟡.
* **Per-route auth not exhaustively swept.** I confirmed the absence of auth
  dependencies on the specific routers in the inventory by reading them. I did not
  enumerate all ~986 routes; `api/routers/breadth_monitor.py` and the darkpool routers
  were not individually checked for gating.
* **Non-US data not considered.** Any non-US listing surfaced in themes/holdings
  carries its own exchange terms; entirely out of scope here.
* **Cost modelling deliberately not attempted** (E-05). Figures here are inputs.
* **Derived-data depth deliberately not attempted** (E-04). §2.5, §4.4A and Part 5
  state only what is load-bearing for classification. E-04 should treat the UTP
  three-way derived taxonomy and the Massive §5(c) Derived Works clause as its starting
  pair, since they disagree.
* **Full vendor ToS reading deliberately not attempted** (E-01). I read only the
  real-time / redistribution / subscriber-classification clauses.

# NOT INSPECTED

* **Executed agreements of any kind** — Massive/Polygon, Finnhub, Schwab, FMP,
  NYSE/CTA, UTP, OPRA. Not present in the repository; not reachable from this machine.
* **Vendor account dashboards and invoices** — would settle questions 1, 3 and 4.
  Owner-authenticated; out of reach and out of scope.
* **Railway production environment** — variables, logs, running config. The preamble
  permits read-only `railway variables --json` only where a contract says so; mine does
  not.
* **developer.schwab.com** (HTTP 403) and **site.financialmodelingprep.com** ToS (HTTP
  403) — login/WAF gated.
* **opradata.com** — DNS timeout from this machine; the current OPRA fee schedule was
  therefore taken from the cdn.opraplan.com copy.
* **massive.com/business detailed licence terms** — the public page shows a
  $2,499/month starting price and defers licence specifics to sales.
* **Production API responses** — the preamble forbids probing production and the local
  port-8077 backend; no freshness measurement was attempted.
* **Partner-owned files beyond their mounting** — `OptionsFlow.jsx`,
  `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`,
  `massive_processor.py` were read only far enough to establish which provider and
  which data type each surface carries, per the preamble.
* **The chart-renderer service's own deployment** (`services/chart_renderer`) — it
  serves the `/chart` stand-in; its data path was inferred from
  `discord_chart_house.py` (which reads the dashboard's own `/r/chart`), not read
  directly.
* **The `uct-intelligence`, `uct_intelligence`, `morning-wire` and `uct-sunday-scan`
  repositories** — out of this contract's scope. The wire's and the bot's own provider
  calls may add rows to this inventory and should be checked by whoever owns those
  repos.
