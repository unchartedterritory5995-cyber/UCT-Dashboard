---
id: E-04
title: Derived-Data Rights — what UCT computes from licensed data, and whether it may
role: Derived-data rights specialist
wave: 1
group: E
category: licensing
scope: uct-dashboard (terminal-research worktree), uct-intelligence, morning-wire, uct-sunday-scan; external vendor + exchange documents
confidence: 🟡 medium
evidence_ceiling: Vendor and exchange CLAUSE TEXT is strong (verbatim from dated public documents). The blocking unknown is WHICH TIER UCT holds with Massive (Individuals vs Businesses) — not knowable from the repo, and it re-classifies twenty of twenty-nine inventory rows. No signed agreement, order form, invoice or account page was inspected for any vendor. FMP's binding Acceptable Data Use Policy returns 404; Finnhub's pricing page is JS-only; Schwab's developer terms and TwitterAPI.io's terms were not researched.
sources: api/services/massive.py, api/services/polygon_options.py, api/darkpool_flatfile_ingest.py, api/gex_service.py, api/dealer_positioning.py, api/flow_scoreboard.py, api/services/screener/finviz_universe.py, api/services/screener/snapshot_builder.py, api/services/breadth_live.py, api/services/rs_ranking.py, api/services/implied_move.py, api/services/screener/base_catalog.py, api/services/discord_index_close.py, api/services/discord_close_note.py, api/services/discord_chart_render.py, api/services/discord_interactions.py, api/services/fred_economic.py, api/services/transcripts.py, api/services/av_transcripts.py, api/services/buzz_store.py, api/flow_db.py, api/darkpool_records.py, morning-wire/finviz_client.py, morning-wire/analyst_feed.py, morning-wire/thefly.py, morning-wire/substack/charts.py, uct-sunday-scan/sunday_scan/charts.py, https://massive.com/legal/market-data-terms-of-service, https://massive.com/terms/market_data_terms.pdf, https://massive.com/legal/businesses-terms-of-service, https://site.financialmodelingprep.com/terms-of-service, https://finnhub.io/terms-of-service, https://www.utpplan.com/DOC/datapolicies.pdf, https://cdn.cboe.com/resources/membership/Market_Data_Policies.pdf, https://www.nasdaqtrader.com/content/AdministrationSupport/Policy/USEquitiesandOptionsDataPolicies.pdf
uct_relevance: high
status: draft
date: 2026-09-02
---

# E-04 — Derived-Data Rights

**Read first:** the general vendor-terms evidence base is E-01's file,
`docs/terminal-research/09-security-licensing-cost/vendor-terms-evidence.md`
(not yet written at the time of this report). Real-time display rules are
E-03's, `…/realtime-and-exchange-classification.md`. This file extracts ONLY the
derived-data, AI-processing, storage and publication clauses, and maps them onto
the things TERMINAL-CURRENT actually computes.

---

## 0. THE FINDINGS THAT MATTER

*Three structural, then five that are fixable this week.*

**1. Everything reduces to one unanswered binary.** TERMINAL-CURRENT computes at
least **28 distinct derived products**, and the dominant input to twenty of them
— bars, snapshots, the OPRA options tape, the off-exchange trade tape, options
chains and Greeks — comes from ONE vendor: **Massive, which is Polygon.io
renamed** (`polygon.io/terms` 301s to `massive.com/legal/terms`). Massive
publishes two mutually exclusive terms documents. On the **Individuals** tier the
grant is *"personal, non-business, and non-commercial"* and *"display use only"* —
a paid product serving ~200 members cannot live there. On the **Businesses** tier
there is an **"Edge Users"** carve-out defined as *"individuals or entities that
are users of Customer's products and services"* — which is exactly UCT's members
— plus an express right to `store`. **Which tier UCT holds is not knowable from
the repo, and it re-classifies twenty inventory rows by itself.** Get that fact
first; everything else in this file is downstream of it.

**2. The safe harbour UCT would pass does not exist in the contracts UCT holds.**
The exchanges and SIPs (UTP, Nasdaq, Cboe) all define derived data by a
*non-reversibility / non-substitutability* test, and UCT's genuinely derived
products — base structures, RS ranks, breadth percentages, pattern detections —
would pass it comfortably. **Massive, FMP and Finnhub contain that test zero
times across nine public documents.** They use flat prohibitions gated only by
written consent. So the intuitive defence ("our analytics are transformative
enough") has no contractual purchase at the vendor layer, and effort spent
building it is wasted.

**3. Computation is not the risk; publication is.** Every member-gated derived
product sits at "Likely Allowed (verify)". Every *Restricted* row is either
published beyond the paywall — the unauthenticated `GET /api/flow-scoreboard`,
the charts posted to a channel the code itself calls *"THE PUBLIC COMMUNITY
CHANNEL"*, the Sunday Scans free Substack tier — or sourced from a vendor whose
default grant is personal and non-commercial: **AlphaVantage**, whose ToS defines
commercial use to include *"any type of commercial activity that allows
individuals or entities other than User to access information"*, and
**yfinance**, where no commercial licence exists to buy at any price (**24
importing modules**, including the authoritative EOD breadth row). And on the
exchanges' own test, **a chart of vendor bars is display of the underlying data,
not a derived work**, because the prices are readable off it.

**And five collisions that need no vendor conversation at all**, found by
reading the clauses against the code (§3.4b): FRED's mandatory attribution
notice (*"This product uses the FRED® API but is not endorsed or certified by
the Federal Reserve Bank of St. Louis"*) appears **nowhere in the codebase**;
FRED's flat ban on storing or caching *"any portion"* of its content sits
against a 30-minute cache in `fred_economic.py:24,158`; X's display requirements
(author @username, display name, avatar, permalink timestamp, X logo) are **not
met** by `TapeFeed.jsx:53-68`; X's 24-hour delete-if-deleted-on-X duty has **no
implementation** (only an age sweep); and `catalysts.db` persists tweet and RSS
bodies **indefinitely**, defeating the 7-day window the tweet store honours.
Three of those five are a few hours of engineering.

⚠️ **One thing found along the way that is a security observation as much as a
licensing one:** `/api/gex/*` and `/api/dealer-positioning/*` declare no auth
dependency, and there is no global gate over `/api/*` — the auth middleware's
own docstring says it *"does NOT block any existing endpoints"*. So the
Schwab-derived gamma and dealer-positioning analytics appear to be served
unauthenticated. See §8; it deserves a look independent of anything in this
report.

---

## 1. HOW TO READ THE CLASSIFICATIONS

Per the preamble's evidence standard and `OWNER_SEED_FACTS.md:57` ("Contract
terms (redistribution, storage, AI-use) for FMP, Massive, Finviz: DEFAULT =
unknown; classify every dependent use 'Likely Allowed / verify contract' or
'Unknown' until the owner answers"), the four buckets are:

| Bucket | Meaning |
|---|---|
| **Allowed** | A public clause or public-domain status positively permits it. Rare here. |
| **Likely Allowed (verify contract)** | Nothing public forbids it *and* the use is internal / member-gated / small; a signed order form could still say otherwise. |
| **Restricted** | A public clause on its face prohibits or conditions it. Not a legal conclusion — a flag that the clause and the behaviour collide and an owner fact is needed. |
| **Unknown** | The governing clause could not be reached, or the vendor's identity/tier is itself unresolved. |

**No row in this file is a legal opinion.** Each says: here is the code, here is
the clause, here is the fact that would settle it.

---

## 2. Q1 — DERIVED-PRODUCT INVENTORY

### OBSERVATION

Twenty-eight derived products, their computation site, and the vendor whose data
they consume. "Derived" here means *a number, label, image or sentence UCT
computes that does not exist in the vendor's response*.

| # | Derived product | Computation site (path:line / symbol) | Input vendor(s) | Published where |
|---|---|---|---|---|
| 1 | Intraday breadth statistics (~40 metrics) | `api/services/breadth_live.py:719 compute_metrics()`; frame loaders `_load_frame():438`, `_rolling_tail():474` | Massive bars via `bars_sqlite`; reference levels from yfinance-sourced collector | Member app |
| 2 | EOD breadth row (authoritative) | `uct-intelligence/scripts/breadth_collector.py` (`yf.download(..., auto_adjust=True)` L377, L776, L1986) | **yfinance / Yahoo** | Member app; pushed to dashboard |
| 3 | Breadth analytical lenses | `api/services/breadth_analogues.py`, `api/routers/breadth_monitor.py` | Massive + yfinance derivatives of #1/#2 | Member app |
| 4 | UCT Exposure Rating (0–150) + regime/phase | `morning-wire/morning_wire_engine.py` → `wire_data["exposure"]`; normalised at `api/services/engine.py:574 _normalize_exposure()` | Derived from #1–#3 (Massive/yfinance) + LLM | Member app; **Substack** (paid); Discord |
| 5 | GEX / gamma walls / zero-gamma / state labels | `api/gex_service.py` (`classify_gex_state():70`), chains via `CHAINS_URL = "https://api.schwabapi.com/marketdata/v1/chains"` | **Schwab** market-data API (OAuth, read-only) | Member app |
| 6 | Dealer net positioning (trade-aware GEX) | `api/dealer_positioning.py` — ΔOI × flow-side attribution, `est_customer_net`, `flow_confidence` | Schwab OI snapshots + **Massive OPRA** flow | Member app |
| 7 | Dark-pool aggregates (per-day, per-ticker) | `api/darkpool_aggregator.py` (server port of `DarkPool.jsx parseCSVtoD`) | **Massive** `/v3/trades` + `us_stocks_sip/trades_v1` flat files (`api/darkpool_flatfile_ingest.py:58 files.massive.com`) | Member app |
| 8 | Dark-pool all-time records + alerts | `api/darkpool_records.py`; `_alert():199` → Discord webhook | Massive trade tape | **Discord** (channel per `darkpool_eod._webhook`) |
| 9 | Options-flow SWEEP/BLOCK events | `api/massive_ws_worker.py` (partner-owned) — tick aggregation to events | **Massive OPRA WebSocket** | Member app |
| 10 | Options-flow server-side analytics | `api/services/flow_aggregate.py` → shells `app/dist/flow-facts.cjs` (`parseCSV` + `processFlowData`) | Massive OPRA | Member app |
| 11 | Top-Flow picks + grades | `api/top_flow_tracker.py` (`/data/top_flow_picks.json`, grade/dir/entry per contract) | Massive OPRA | Member app |
| 12 | **Flow Scoreboard (public, unauthenticated)** | `api/flow_scoreboard.py:234 compute_scoreboard()`, route `:328 @router.get("")` — docstring: *"No auth on the GET — read-only, cacheable, public."* | Massive OPRA (contract-price gains) | **Public web** |
| 13 | Expected / implied move (ATM straddle) | `api/services/implied_move.py:255 evaluate_straddle()`, `:337 compute_expected_move_result()` | **Massive options chains** (`api/services/polygon_options.py:26 _BASE="https://api.massive.com"`) | Member app; calendar; Substack |
| 14 | Implied-capture history (nightly pre-report snapshots) | `api/services/implied_store.py` | Massive chains + Finnhub/FMP reporter list | Member app |
| 15 | Options chain + Black-Scholes Greeks (voice lane) | `api/services/options_chain.py` — `import yfinance as yf`, `scipy.stats.norm` | **yfinance / Yahoo** | Member app (voice) |
| 16 | Base-structure library (shape + relations + stats) | `api/services/screener/base_catalog.py`, `api/services/screener/bases.py:208 classify()`, `base_count.py` | Massive bars | Member app |
| 17 | Candle library detections | `api/services/screener/candle_catalog.py`, `candles.py`, `candle_backtest.py` | Massive bars | Member app |
| 18 | Pattern-engine detections (50 detectors) | `api/services/pattern_engine/` → `pattern_detections` table | Massive bars | Member app; Compass tools |
| 19 | Server-side technical indicators | `api/services/indicator_compute.py` (mirrors `app/src/components/chart/indicators.js`) | Massive bars | Member app; alerts |
| 20 | Pine-parity indicator outputs | `app/src/components/chart/engine/ast/pine*.js` + tests | Massive bars | Member app |
| 21 | RS line / RS rank (IBD-style 1–99) | `api/services/rs_ranking.py:157 compute_rs_scores()`, weights in `rs_weighted_return.RS_TERMS` | Massive 6-month bars | Member app; screener |
| 22 | Screener composite rows (~one per ticker) | `api/services/screener/snapshot_builder.py build_row()` | Massive bars/mktcap + **Finviz Elite export** + **FMP bulk** + research ratings + RS | Member app |
| 23 | Float / short / ownership columns | `api/services/screener/finviz_universe.py` — `elite.finviz.com/export.ashx?v=152&c=...&auth=FINVIZ_API_KEY` | **Finviz Elite** | Member app |
| 24 | UCT20 book / portfolio NAV + stats | `api/services/uct20_nav.py compute_portfolio_returns()`; `uct-intelligence/uct_intelligence/book/` | Massive bars | Member app; Substack |
| 25 | Catalyst rows: score, tag, quota-selected top-20, thesis | `api/services/catalyst/{scoring,tagging,selection,synthesize}.py` | Massive movers/snapshots + **TwitterAPI.io** + RSS + **Perplexity** + yfinance meta | Member app |
| 26 | Significant-catalyst dating (biggest-move ranking → LLM) | `api/services/significant_catalysts.py` | Massive bars → Claude | Member app |
| 27 | Buzz counts (`/buzz`) | `api/services/buzz_store.py`, `buzz_extract.py` — *"Deliberately stores NO message text"* | **Discord** member messages (not a licensed market-data vendor) | Discord (member servers) |
| 28 | Index-close chart posts + written note | `api/services/discord_index_close.py:240 render_charts()`, `:326 build_messages()`; note by `api/services/discord_close_note.py` | Massive bars via `/api/bars` | **Discord #TSDR — the docstring calls it "THE PUBLIC COMMUNITY CHANNEL"** |
| 29 | House chart images (`/chart`, Substack, Sunday Scans) | `api/services/discord_chart_render.py` (matplotlib) and `api/services/discord_chart_house.py` (screenshot of `/r/chart`); `morning-wire/substack/charts.py`; `uct-sunday-scan/sunday_scan/charts.py` | Massive bars | Discord (guild-locked), **Substack (incl. a free tier)**, YouTube |

*(The table is 29 rows; the "at least 28" in §0 is the count of distinct
products excluding #27, which consumes no licensed market data.)*

### EVIDENCE

All rows above are **CONFIRMED by source inspection** (the file exists, the
symbol exists, the vendor base URL is a literal in the file). Production
*execution* of each is a separate question this contract did not test; where a
row is flag-gated the flag is named in §5.

Vendor base URLs, verbatim from source:
- `api/services/massive.py:19` — `_REST_BASE = "https://api.massive.com"`; the module docstring at `:4` says *"Calls https://api.massive.com using MASSIVE_API_KEY env var"* and `:76` calls it a *"Polygon.io-compatible API"*.
- `api/services/polygon_options.py:26` — `_BASE = "https://api.massive.com"`; docstring: *"Uses the existing MASSIVE_API_KEY (Polygon Advanced tier, $200/mo gives real-time NBBO + Greeks + IV + options trade flow)"* — **this is the single strongest in-repo statement of the plan tier, and it is a CLAIM in a comment, not a receipt.**
- `api/darkpool_flatfile_ingest.py:58` — `S3_ENDPOINT = os.environ.get("MASSIVE_S3_ENDPOINT", "https://files.massive.com")`, bucket `flatfiles`, key `us_stocks_sip/trades_v1/...`.
- `api/gex_service.py` — `CHAINS_URL = "https://api.schwabapi.com/marketdata/v1/chains"`.
- `api/services/screener/finviz_universe.py` — `https://elite.finviz.com/export.ashx?v=152&c=...&auth=...`, env `FINVIZ_API_KEY`.

### INTERPRETATION

Three structural facts dominate the licensing picture:

1. **Concentration.** Remove Massive and 20 of the 29 rows stop existing. A
   single vendor's derived-data clause governs most of the product's
   proprietary-advantage surface.
2. **The derived products are not thin.** `bases.py`, `base_catalog.py`,
   `rs_weighted_return.RS_TERMS`, `indicator_compute.py`, the pattern engine and
   `flow_aggregate` embody genuine methodology. Vendor terms that speak of
   "Derived Works" reach these regardless of how much UCT method is in them —
   the "UCT way" being proprietary process (per the contract's KNOWN FACTS) is a
   claim about *ownership of the method*, not a licence to publish the *output*.
3. **Publication is where the risk concentrates, not computation.** Internal
   computation is invisible to a vendor. Rows 8, 12, 28 and 29 are the ones that
   leave the building.

### RELEVANCE TO UCT

TERMINAL-NEXT will multiply derived surfaces (that is the point of the
programme). Every proprietary-advantage claim that rests on rows 1–26 rests on
the Massive agreement. **A proprietary-advantage claim and a licensing exposure
are the same sentence read twice.**

### CONFIDENCE

🟢 high on the inventory itself (source-inspected). 🟡 medium on completeness —
the repo has ~300 service modules and this is a 75-minute sweep.

**EVIDENCE CEILING:** no Massive/FMP/Finviz/Finnhub order form, invoice, plan
page or account screen was reachable. The `polygon_options.py` "Polygon Advanced
tier, $200/mo" comment is the only tier statement anywhere in the repo and it is
a comment.

### RECOMMENDATION

Maintain this inventory as a living artifact keyed on **input vendor**, not on
feature. A feature-keyed list cannot answer "what breaks if Massive's terms
change", which is the only question that matters here.

### OPEN QUESTION

Which of rows 1–29 does the owner consider load-bearing for TERMINAL-NEXT's
differentiation? That set is the one to license deliberately.

---

## 3. Q2 — VENDOR CLAUSES ON DERIVED DATA

### 3.1 THE FINDING THAT REFRAMES EVERYTHING: Massive **is** Polygon.io

#### OBSERVATION

`https://polygon.io/terms` now **301-redirects** to `https://massive.com/legal/terms`,
and every `polygon.io/legal/*` path redirects to `massive.com/legal/*`. Massive
is not a Polygon reseller — **it is Polygon.io, renamed.** The Market Data Terms
PDF still carries the pre-rebrand entity name.

This matters because the repo has been reasoning about "Massive" as an
independent vendor. It is the same company whose Polygon-compatible endpoints
`api/services/massive.py:76` already names.

#### EVIDENCE

Search result summary, Massive docs: *"All Polygon.io endpoints continue to work
as-is, as Massive is the same platform under a new name."* Redirect behaviour
CONFIRMED by the research pass. Massive's own docs describe consolidating data
*"directly from regulated Securities Information Processors (SIPs)"*.

**A documentary discrepancy worth recording rather than resolving away:** the
HTML page `https://massive.com/legal/market-data-terms-of-service` reads **"Last
Updated: August 28, 2025"** with the entity **"Massive.com, Inc."**; the PDF at
`https://massive.com/terms/market_data_terms.pdf` reads **"POLYGON.IO, INC.
MARKET DATA TERMS OF SERVICE — Last Updated: October 9, 2024."** Both were
fetched in this research. **Two renderings of nominally the same document
disagree on entity and date.** Cite the URL you actually read; do not treat them
as interchangeable.

#### The document set (all public, all read-only GET)

| Ref | Title | URL | Date shown |
|---|---|---|---|
| P1 | Market Data Terms of Service | `massive.com/terms/market_data_terms.pdf` | Oct 9, 2024 (entity: Polygon.io, Inc.) |
| P1-html | Market Data Terms of Service | `massive.com/legal/market-data-terms-of-service` | Aug 28, 2025 (entity: Massive.com, Inc.) |
| P2 | Massive for **Individuals** ToS | `massive.com/legal/individuals-terms-of-service` | Jul 18, 2025 |
| P3 | Massive for **Businesses** ToS | `massive.com/legal/businesses-terms-of-service` | **Sep 2, 2025** — the most current |
| P4 | Website ToS | `massive.com/legal/website-terms-of-service` | Oct 15, 2024 |
| P5/P6 | OPRA + NYSE schedules inside P1 | same PDF, pp.7, 11 | no separate date |

#### The clauses

**Definition of Derived Works — P1 §5(c):**

> "any data, charts, analytics, research, or other works based on, referring to, or derived from the Market Data"

**The prohibition it attaches to — P1 §5(c):**

> "Redistribute, display, disseminate, duplicate, license, sublicense, publish, broadcast, transmit, distribute, redistribute, perform, display, sell, resell, rebrand, or otherwise transfer the Market Data"

**Non-display / derivative works — P1 §5(d):**

> "Use Market Data for non-display use or to create derivative works (including, without limitation, any index, indicative value, net asset value, investment product, financial contract…) based on the Market Data unless you are licensed to do so"

**The Individuals licence grant — P1 §1:**

> "Polygon hereby grants you a nonexclusive, nontransferable, non-sublicensable, revocable, limited license to use Market Data exclusively for your personal, non-business, and non-commercial purposes."

**P1 §2:**

> "The Market Data may not be copied, reproduced, republished, uploaded, posted, publicly displayed, encoded, translated, transmitted, or distributed in any way (including 'mirroring') to any other computer, server, website, or other medium for publication or distribution"

> "Unless otherwise stated in a subsequent agreement with us or a Third Party Provider, any and all Market Data is strictly for display use only."

**⭐ The Businesses tier — and the clause the whole audit turns on. P3 §6.1(e)
prohibits making Information available to anyone…**

> "…other than Customer, its Authorized Users, or its Edge Users"

**P3 Definitions:**

> "'Edge Users' means individuals or entities that are users of Customer's products and services."

**P3 §2.2 — an express storage right, the only one at any vendor:**

> "limited right to access, receive, process, transmit, store, and use the Information available via the Services solely for its use in websites or software applications owned or licensed by Customer."

**P3 §6.1(j) — the derivative-works bar at the business tier, narrower than P1's:**

> "use the Information to create derivative works (including, without limitation, any index, indicative value, net asset value, investment product, financial contract … settlement value or investment strategy) based on the Information unless licensed to do so"

**Deletion on termination — P1 §10 / P3 §11.4:**

> "if the Agreement or your account are terminated or suspended for any reason, you agree to cease all use of the Market Data and delete all Market Data in your possession."

**Massive's rights over UCT's usage data — P3 §4.3:**

> "Massive has a perpetual and irrevocable right to collect, analyze, use, and evaluate all Usage Data for Massive's own purposes without accounting or compensation to Customer."

**AI / ML: NOT FOUND on public pages.** The words "artificial", "machine
learning", "LLM" and "train" (as a verb) appear in none of P1–P6. Massive's
*marketing* promotes the data as an ML training corpus ("350B+ events as a
training corpus"; an MCP server for LLMs) — **marketing is not a licence grant.**
AI use is governed by the derivative-works clauses, not by a dedicated clause.

**Caching: NOT FOUND.** The word does not appear in P1–P4.

#### INTERPRETATION

**Everything reduces to one binary: Individuals tier or Businesses tier.**

On the **Individuals** tier (P1/P2), UCT's product is not merely at risk — it is
squarely outside the grant. "Personal, non-business, and non-commercial",
"display use only", "may not be… publicly displayed… or distributed in any way"
cannot be reconciled with a paid subscription product serving ~200 members with
charts on Discord, Substack and YouTube. There is no reading that works.

On the **Businesses** tier (P3), the picture inverts and becomes broadly
comfortable: **"Edge Users" — "individuals or entities that are users of
Customer's products and services" — is precisely UCT's members.** §2.2 expressly
grants `store`. §6.1(j)'s derivative-works bar is enumerated and narrow (index,
NAV, investment product, financial contract, settlement value, investment
strategy) rather than P1's sweeping "any data, charts, analytics, research". Most
of the inventory in §2 sits comfortably outside that list.

**Two things survive even on the Businesses tier and should not be waved through:**

1. **Public surfaces.** "Edge Users" are *users of Customer's products*. An
   unauthenticated `GET /api/flow-scoreboard` and a public Discord channel serve
   people who are not users of anything. That is the gap, and it is narrow and
   fixable.
2. **"Investment strategy"** is in §6.1(j)'s enumerated list. A published
   entry/stop/target on a named ticker is arguably closer to that phrase than to
   "analytics". Worth a specific question rather than an assumption.

#### ⭐ The negative finding that matters most

**No non-reversibility safe harbour exists at any of these vendors.** The terms
"non-reversible", "irreversible", "non-substitutable", "substitutable" and
"cannot be reverse-engineered" appear **zero times** across the nine documents
retrieved from Massive, FMP and Finnhub.

This is the direct opposite of the exchange layer (§4), where UTP, Nasdaq and
Cboe *all* define derived data by exactly that test. **The industry-standard safe
harbour UCT's derived engine would comfortably pass does not exist in the
contracts UCT actually holds.** These three vendors use flat prohibitions gated
only by prior written consent — or, at Massive Businesses, by Edge Users.

So the question "are our derived products transformed enough?" — the natural
question, and the one the exchange documents invite — **has no contractual answer
at the vendor layer.** The only questions with answers are: *which tier are we
on*, and *do we have written consent*.

#### RELEVANCE TO UCT

This single fact should reshape how TERMINAL-NEXT's licensing work is scoped.
Effort spent arguing that UCT's base-structure library or RS ranks are
sufficiently transformative is effort spent against a test no vendor applies.
Effort spent confirming the plan tier settles twenty inventory rows in one email.

#### CONFIDENCE

🟢 high on the clause text (public documents, verbatim, dated). 🔴 low on which
tier UCT holds — **that is not knowable from the repo**, and it is the pivot.

**EVIDENCE CEILING:** the account page, order form and invoice are all outside
this contract's reach. The only in-repo signal is a comment at
`api/services/polygon_options.py:5` reading *"Polygon Advanced tier, $200/mo"* —
which names a *product plan*, not a *terms tier*, and is a comment rather than a
receipt. Per the preamble, that is a CLAIM.

#### RECOMMENDATION

**This is the one action item that dominates the report.** Confirm the Massive
tier — from the billing account, not from a comment. If Individuals: stop and
re-plan, because TERMINAL-NEXT cannot be built on it. If Businesses: the
remaining work is narrow and specific (the public surfaces, and a written
question about "investment strategy").

#### OPEN QUESTION

Did the Polygon→Massive rebrand carry the old agreement across unchanged? The
legal index states the "Commercial Use Terms of Service" has been **renamed** to
"Massive for Businesses Terms of Service" *"and such terms will apply"* — so a
signed order form referencing the old title now points at a document whose text
UCT has never read.

---

### 3.2 FMP — the clause that hits the member-facing pages

#### OBSERVATION

FMP's ToS (`https://site.financialmodelingprep.com/terms-of-service`, **"Last
updated: August 1, 2023"**) contains a display restriction that reaches further
than a derived-data clause would, and its binding Acceptable Data Use Policy is
**404 on the public web**.

#### EVIDENCE

**§2.2.2 Data Display** — verbatim:

> "Without a specific agreement with FMP, customers are prohibited from showcasing FMP Services or Data on platforms including but not limited to websites, blogs, software products, or applications designed for utilization by multiple individuals"

…and it forecloses the internal-use reading: *"irrespective of whether such usage
is complimentary or paid, and whether it pertains to internal or external
organizational purposes."*

**§2.2.1** defines Commercial Use to include analytics:

> "Collecting, aggregating, or analyzing data using FMP Services or Data for commercial purposes or to support commercial activities, including market research, business intelligence, or data-driven decision-making."

**§2.6.1(i):**

> "resell, sublicense, distribute or otherwise provide access to The Services, or data or information contained in or derived from The Services, to any third party or use The Services outside the scope of the license granted herein"

**§11.1 — FMP claims the derived layer:**

> "Customer agrees that, as between the parties, FMP owns all intellectual property rights and all other proprietary interests that are embodied in or practiced by The Services and all Data or information contained in or derived from the Data"

**§6.3 — the only express *caching* clause found at any vendor:**

> "Upon termination of this Agreement, Customer must delete all Data it has received from FMP under all applicable Order Forms, including data cached, and sign the Data Deletion Agreement in Exhibit A."

**§2.8 — a storage-location notification duty most licensees never notice:**

> "Customer will notify FMP of the IP and domain aliases of any location where data is stored or processed. FMP reserves the right to audit any Customer owned domains to ensure security compliance."

**§10.4 — attribution is restricted, not required:**

> "Customer may not identify FMP as the source of the Data to any third party without FMP's prior written consent"

**Pricing page** (no date shown): *"Displaying or redistributing data sourced
from FMP requires a specific Data Display and Licensing Agreement with FMP."*

**AI / ML: NOT FOUND on public pages.** Zero occurrences of "artificial",
"machine", "LLM" or "train" in an AI sense. A marketing FAQ says the API "is
compatible with Open AI" — **marketing, not a grant.**

**Access gap, and it is a finding rather than a gap:** ToS §2.6.2 makes
compliance with an **Acceptable Data Use Policy** mandatory and calls its
violation *"a material breach of the Agreement"*, citing
`financialmodelingprep.com/acceptable-data-use-policy`. **That URL and its
`site.` variant both return HTTP 404.** A binding, incorporated-by-reference
policy is not publicly available.

#### INTERPRETATION

**§2.2.2 is the sharpest single clause in this report.** It does not turn on
derivation at all — it prohibits *showcasing FMP Data* on any application "designed
for utilization by multiple individuals" absent a specific agreement. UCT's
screener columns (`fundamentals_bulk`, six FMP bulk requests for the whole
market), the calendar's earnings rows, the research page's estimates and
financials, and the Model Book earnings table are all exactly that. And unlike
Massive, there is **no Edge Users equivalent** in the public text — the escape is
a separate "Data Display and Licensing Agreement", which is not published and
which UCT may or may not hold.

**§10.4 quietly forbids the obvious mitigation.** The instinctive fix for a
display concern is to attribute the source. FMP prohibits naming them as the
source without written consent. Attribution is not available as a remedy here.

**The 404'd ADUP is a real defect on FMP's side**, not just an inconvenience.
A term incorporated by reference, whose breach is defined as material, and whose
text is unreachable, cannot be complied with by reading. Record it; ask for a
copy in writing; keep the reply.

#### RELEVANCE TO UCT

FMP is the second-widest vendor after Massive and yfinance, and it is the one
whose data most directly *appears as itself* on screen (earnings figures,
estimates, grades, transcripts) rather than as a UCT-computed derivative. Display
clauses bite hardest exactly there.

#### CONFIDENCE

🟢 high on clause text. 🟡 medium on applicability — a signed Data Display and
Licensing Agreement, if one exists, would supersede much of this.

#### RECOMMENDATION

Ask FMP three things in one email: (1) a copy of the Acceptable Data Use Policy;
(2) whether the current plan includes a Data Display and Licensing Agreement;
(3) whether summarizing and storing earnings-call transcript bodies for paying
subscribers is within it (see §5). Keep the reply — it is the artifact that
converts every "Likely Allowed (verify)" row involving FMP.

#### OPEN QUESTION

Does UCT hold a Data Display and Licensing Agreement with FMP? If yes, its text
supersedes §2.2.2 and this section should be re-read against it.

---

### 3.3 Finnhub — the broadest derived-results prohibition, in the shortest document

#### OBSERVATION

Finnhub's entire public licence is a **single ~5,300-character page with no
section numbers and no date**, which reserves the right to change "without
notice". It nonetheless contains the only clause at any vendor that names
"derived results" explicitly.

#### EVIDENCE

`https://finnhub.io/terms-of-service` · **no date shown**

> "You hereby agree to not redistribute or share access to data or derived results from the data obtained from Finnhub with anyone or any 3rd party without written approval from Finnhub."

> "All plan listed on Finnhub website is strictly for personal use unless explicitly stated otherwise. Personal plan can't be used by any business even internally without a written approval."

> "All data must be deleted should your subscription to that data ends."

**Storage during the subscription is neither granted nor prohibited — it is
unaddressed.** No caching clause, no retention period.

**AI / ML: NOT FOUND on public pages.**

**Access gap:** `finnhub.io/pricing` and `/faq` are JS-only React shells (~99
characters of extractable text); any tier-specific redistribution language there
is unreadable without a rendering browser.

#### INTERPRETATION

"Derived results from the data" is **undefined and unbounded** — no
non-reversibility test, no aggregation threshold, no materiality carve-out. On
its face it reaches a computed score as readily as a raw quote.

The practical exposure is smaller than that sounds, and the reason is worth
recording: **UCT's Finnhub dependency has already contracted on its own.**
`api/services/transcripts.py:12-20` records a live probe finding Finnhub's
`/stock/transcripts/list` returning **403 on every call** — that plan does not
carry the endpoint — and FMP was promoted to primary on 2026-08-05 with Finnhub
kept only as a fallback. `api/services/implied_store.py` records a 2026-08-05
incident where Finnhub's free-tier 60-calls/min limit, shared across every
Finnhub caller in the process, starved the reporter list. Finnhub reads as a
**free-tier, degrading dependency** in this codebase — which makes "personal use
only unless explicitly stated" a live question, not a hypothetical one.

#### RELEVANCE TO UCT

Finnhub's remaining roles (earnings calendar, insider transactions, IPO
calendar, transcript fallback) are all replaceable by vendors already paid for.
Given a flat prohibition on "derived results" and a personal-use default, the
cheapest resolution is probably **retirement rather than negotiation**.

#### CONFIDENCE

🟢 high on the clause text. 🟡 medium on which plan UCT is on — the pricing page
could not be read.

#### RECOMMENDATION

Enumerate what still genuinely depends on Finnhub, then decide retire-or-upgrade.
Do not leave a personal-tier dependency inside a paid product by default.

#### OPEN QUESTION

Is the Finnhub account a free/personal plan? If so, the clause "Personal plan
can't be used by any business even internally without a written approval" is
already in play for every use, derived or not.

---

### 3.4 AlphaVantage — commercial use is defined, and UCT is inside the definition

#### OBSERVATION

AlphaVantage's Terms of Service contain **no redistribution clause, no derived-data
clause, no storage clause and no AI clause** — and do not need them, because §2(a)
resolves the whole question at the licence-grant level by defining "commercial
use" in a way that unambiguously includes UCT.

#### EVIDENCE

`https://www.alphavantage.co/terms_of_service/` — served as a PDF; text extracted
locally. **No last-updated or effective date appears anywhere in the document**
(the only "Effective Date" is defined as *"the date User clicks 'Get Free API
Key'"*). Entity: Alpha Vantage Inc.

**§2(a) Grant of License** — verbatim:

> "Alpha Vantage grants the right to install, use, access, display and run the software on any computer or mobile device, where applicable, that you own or control, for personal, non-commercial use, unless you and Alpha Vantage have agreed otherwise in writing"

**The definition of commercial use, same clause** — the third criterion is the
one that matters here, verbatim:

> "You plan to use or provide information accessed through the Alpha Vantage Platform as part of any type of commercial activity that allows individuals or entities other than User to access information directly or indirectly even if the scope of such activity falls outside of the securities industry."

And the second:

> "You are using the Alpha Vantage Platform as or on behalf of a corporation, firm, partnership, trust or any other association and not as an individual."

The clause closes: *"If you are interested in using the Alpha Vantage Platform for
commercial purposes, please contact us at: premium@alphavantage.co"*.

**Confirmed absent:** the extracted text (9,882 characters, complete) contains no
occurrence of "redistribut", "derivative", "derive", "cache", "machine learning",
"artificial", or "train". **Derived data: NOT ADDRESSED. Storage: NOT ADDRESSED.
AI: NOT ADDRESSED.**

#### INTERPRETATION

Unlike every other vendor in this report, there is nothing to interpret and no
tier to look up. **AlphaVantage defines commercial use as including "any type of
commercial activity that allows individuals or entities other than User to access
information directly or indirectly", and UCT is a paid product whose members
access AV-sourced information.** Criterion (iii) is met on its face; criterion
(ii) is met independently (the platform is used on behalf of a business, not as
an individual). Absent a written agreement, the licence granted is
personal/non-commercial and does not cover this use.

The exposure is *narrow but real*. AV's role in the codebase has already been
squeezed by its own free-tier limit: `api/services/av_transcripts.py:5-7` records
*"AV free tier: 25 requests/day — this service is lazy / on-demand only"*, and
`api/services/alphavantage_client.py` exists specifically because *"up to seven AV
call sites in this codebase [were] spending the SAME 25/day account budget with
zero visibility to each other"*. **A 25/day budget is the free tier, which is the
personal/non-commercial licence.** The engineering note and the licensing fact
are the same fact seen from two angles: the reason the code has an elaborate
budget broker is that UCT is on the tier AV grants to individuals.

Two live consumers: verbatim earnings-call transcripts (§5 row 3) and the news
feed used by `api/services/engine.py`'s `get_news()` as the AlphaVantage
NEWS_SENTIMENT primary.

#### RELEVANCE TO UCT

This is the clearest, cheapest-to-fix row in the report: one email to
`premium@alphavantage.co`, or retire the two call sites (both have working
fallbacks — RSS for news, FMP for transcripts). It should not be left as-is,
because "we are on the free tier" is not a mitigating fact here; **it is the
statement of the problem.**

#### CONFIDENCE

🟢 high — verbatim from the complete document text, and the code corroborates the
tier independently.

**EVIDENCE CEILING:** whether a written commercial agreement exists is unknown, as
with every vendor. The undated ToS means no snapshot of it can be cited as-of a
date.

#### RECOMMENDATION

Decide between (a) a paid AV commercial agreement, or (b) retiring the two AV
call sites onto their existing fallbacks. Given that FMP is already primary for
transcripts (`api/services/transcripts.py:12-20`) and RSS already backs the news
feed, **(b) is close to free.**

#### OPEN QUESTION

Is the AlphaVantage key a free key? If yes, criterion (ii) alone settles it and
no further research is needed before acting.

---

### 3.4b Finviz, FRED, TheFly, X/Twitter, Reddit

#### OBSERVATION

Four of these five produced clause text on a second research pass; Finviz
produced something more interesting than a clause — **the absence of any terms
document at all.** FRED turns out to carry the two hardest prohibitions in the
entire audit, and X's display requirements collide with a live UI component.

#### EVIDENCE — usage, confirmed from source

| Source | How UCT uses it | Evidence |
|---|---|---|
| **Finviz Elite** | Whole-market CSV export, one request nightly, ~7 float/short/ownership columns joined into the member-facing screener row; a second client in morning-wire | `api/services/screener/finviz_universe.py` — `https://elite.finviz.com/export.ashx?v=152&c=...&auth=...`, env `FINVIZ_API_KEY`; `api/services/industry_map.py:107`; `morning-wire/finviz_client.py:1-13` (*"Unified Finviz Elite API client… Authenticates with FINVIZ_API_KEY"*) |
| **Finviz chart images** | `elite.finviz.com/chart.ashx` and `finviz.com/chart.ashx` are fetched in `api/schwab_router.py:424,440` (partner-owned; header depth only). CLAUDE.md also describes Finviz PNGs in the Breadth DrillModal and Theme Tracker panels | `api/schwab_router.py:424,440` |
| **FRED** | ~30-series catalog read by the voice/Compass lane and for a risk-free rate | `api/services/fred_economic.py`; consumers `api/services/voice_tool_impls.py:442,453`, `api/services/options_chain.py:32` |
| **TheFly** | Live wrapper exists (`THEFLY_API_KEY`, no-ops when unset); the real path is indirect, via FMP's grades feed | `api/services/thefly_news.py`; `morning-wire/thefly.py:5-11`; `morning-wire/analyst_feed.py:19-20`. See §9 Observation C |
| **X / Twitter (via TwitterAPI.io)** | Four curated accounts polled; **`tweets.text` is stored verbatim** (`TEXT NOT NULL`) for **7 days**, and rendered on the Dashboard tape tile with a link back to the source | `api/services/twitterapi_io.py:1-5` (*"Auth: x-api-key header (no OAuth). Pricing: $0.15 per 1,000 tweets"*); `api/services/tweet_store.py:41-45,123-134`; `app/src/components/tiles/TapeFeed.jsx:53-61`; `TWEET_RETENTION_DAYS` default 7 |
| **Reddit** | PRAW over five subreddits; bull/bear ratio + sample posts, voice lane only | `api/services/reddit_sentiment.py:1-10`; `api/services/sentiment_aggregator.py:70` |

#### EVIDENCE — Finviz: there is no terms document

- `https://finviz.com/terms.ashx` → **HTTP 404** (redirects to `/terms`, also 404). Probed and 404: `/terms/`, `/help/terms`, `/disclaimer`, `elite.finviz.com/terms.ashx`.
- The rendered site footer (`/`, `/privacy`, `/elite`) links only `/privacy` and `/privacy_california` — **no Terms of Service link anywhere.**
- **The Wayback Machine has zero snapshots of `finviz.com/terms.ashx`** (CDX and availability APIs both empty), which suggests the URL never existed rather than being recently retired.
- `https://finviz.com/privacy` (HTTP 200, **no date shown**) contains no IP, licensing, redistribution, derived-data, scraping or AI language.

**Derived data: NOT FOUND. Storage: NOT FOUND. Redistribution: NOT FOUND in any
terms document. AI: NOT FOUND.**

The one machine-readable Finviz restriction is `https://finviz.com/robots.txt`
(**no date shown**), which is a crawler directive, not a contractual term:

> ```
> User-agent: *
> Disallow: /export
> Disallow: /chart
> Allow: /charts
> Disallow: /image
> Disallow: /api/v1/screener-export-csv
> ```

(also `Disallow: /grp_export`, `/portfolio_export`, `/screener?*`, `/fut_chart`,
`/fut_image`, `/fx_image`, `/mktstats_image`, `/publish`, `/search`, followed by
a whitelist of ~35 specific screener preset URLs.)

**On the chart-image question specifically:** `finviz.com/chart.ashx?t=AAPL&…`
returns **HTTP 301 → `charts2-node.finviz.com/chart?…` → HTTP 200,
`image/png`**, with no auth and no observed hotlink referer check. **No
permission to republish it is granted anywhere, because there is no document to
grant one.**

#### EVIDENCE — FRED: the two hardest prohibitions in the audit

`https://fred.stlouisfed.org/legal/` · "Legal Notices, Information and
Disclaimers" · **no date shown**

**AI/ML — explicit, absolute, and stated twice:**

> "Use the FRED® Services or FRED® Content in connection with the development or training of any software program or system or machine learning, including, but not limited to, large language models, deep learning, generative artificial intelligence…"

…and the framing sentence leaves no tier exempt:

> "All use of FRED data—including non-commercial, educational, and personal use—is subject to the following prohibitions."

**Storage/caching — explicit and absolute:**

> "Store, cache, or archive any portion of the FRED® Services or FRED® Content; provide any stored, cached, or archived portion of the FRED® Services or FRED® Content to any third party; or incorporate any FRED® Content in any database, compilation…"

**Derived works:**

> "Modify, copy, distribute, create derivative works of, reverse engineer, decompile or disassemble the FRED® Services or any portion thereof."

**The three copyright tiers** (§III "Use of Data with Copyright Restrictions") —
note that FRED does **not** assert blanket public-domain status even for tier 3:

> "These series may be under copyright or in the public domain and may be used without permission, provided you do not engage in any prohibited use." — *Public Domain: Citation requested*

> "These series are under copyright by a third party. Without first obtaining the express written permission of the copyright holder, the information may only be, these series may only be used for non-commercial educational or personal use." — *Copyrighted: Pre-approval required* (drafting error in the original)

> "Copyrighted series contain the word 'Copyright' in their notes. The list of copyrighted series can be found by either searching for the word 'copyright' on the FRED® website or searching… using the fred/series/search api request." — FRED® API Terms of Use

⚠️ **The tier of UCT's ~30 catalog series was NOT measured.** FRED names exactly
one provider in its terms — **Visa**, for the Spending Momentum Index (*"You may
not distribute, modify, copy, publish, transmit, display, sell, license, use,
reuse or create derivative works of SMI… for any public or commercial purpose
without the written consent of Visa"*) — and does not enumerate the rest. Any
statement about which specific series are restricted must come from the
copyright-in-notes test above, not from assumption; an earlier draft of this
file made exactly that mistake and it is retracted in §7.

**A mandatory display notice** — FRED® API Terms of Use, §Requirements:

> "Place the following notice prominently on your application: 'This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.'"

**Newsletters are expressly allowed for two of the three tiers** (§IV Commercial Use):

> "Series with the following copyright labels—Public Domain: Citation requested and Copyrighted: Citation required—may be used for internal commercial uses and may be displayed in textbooks, newsletters, or reports to clients provided that appropriate attribution is given"

⚠️ **Two FRED clauses are in visible tension** and should not be resolved by
picking the favourable one: §Prohibitions (q) bans all caching, while the
§FRED® Graphs License grants a right to *"display and reproduce the charts and
graphs, and to permit others to, publish, reproduce and distribute"* them.

**Flow-down:** Alpha Vantage §20 imports the FRED terms onto AV's economic and
commodities endpoints: *"By using our Economic Indicators APIs and/or Commodities
APIs, you agree to be bound by the FRED® API Terms of Use…"*

#### EVIDENCE — X / Twitter

**X Developer Agreement** (`developer.x.com/en/developer-terms/agreement`,
**Last Updated: April 27, 2026**):

> "use the X API or X Content to fine-tune or train a foundation or frontier model" — §III.A(k) Restrictions on Use

> "'X Content' means Posts… and any other data and information made available to you through the X API… and any copies and derivative works thereof." — §I Definitions

**X Developer Policy** (`docs.x.com`-hosted; HTML metadata
`"dateModified":"2026-07-14"`):

> "If you provide X Content to third parties, including downloadable datasets or via an API, you may only distribute Post IDs, Direct Message IDs, and/or User IDs"

> "If you store X Content offline, you must keep it up to date with the current state of that content on X. Specifically, you must delete or modify any content you have if it is deleted or modified on X."

> "This must be done as soon as reasonably possible, or within 24 hours after receiving a request to do so by X or the applicable X account owner…"

**X Display Requirements** (`developer.x.com/en/developer-terms/display-requirements`,
**no date shown**) — online display:

> "The post author's profile picture, @username, and display name must always be displayed and link to the user's X profile."

> "The post timestamp must be displayed and link to the post's permalink."

> "The official X logo must always be reasonably visible and displayed on the upper-right corner of an individual post or directly attached to the timeline…"

**TwitterAPI.io** (`twitterapi.io/terms`, **Last updated: September 2025**) grants
**no licence to X content** and pushes compliance downstream:

> "Ensure that your use of the Service does not violate the rights of third parties, including X/Twitter's terms of service." — §4 Customer Responsibilities

**Derived data, storage and AI: NOT FOUND** in TwitterAPI.io's terms — it is
silent on all three.

#### EVIDENCE — Reddit and TheFly

**Reddit Data API Terms** (`redditinc.com/policies/data-api-terms`, **Effective
June 19, 2023 · Last Revised July 20, 2026**):

> "…no other rights or licenses are granted or implied, including any right to use User Content for other purposes, such as for training a machine learning or AI model, without the express permission of rightsholders in the applicable User Content." — §2

> "If you are interested in using the Data APIs for commercial purposes, research in excess of rate limits… you will need to enter into a separate agreement with Reddit." — §3.1 Fees

> "This includes any data or models that were derived from User Content and Materials that were accessed from the Data APIs or our other Services." — §Termination

`reddit.com/robots.txt` is a blanket `User-agent: * / Disallow: /`, and the User
Agreement conditions crawl permission on it — so the Data API is the only
permitted channel.

**TheFly**: `thefly.com/terms` returns HTTP 200 but is a client-rendered SPA
whose legal body is absent from the delivered HTML — **the contractual terms are
NOT RETRIEVABLE by machine and need a human with a browser.** What *is*
machine-readable is `thefly.com/robots.txt` (**no date shown**):

> ```
> User-agent: *
> Content-Signal: search=yes,ai-train=no,use=reference
> ```

…with `CCBot`, **`ClaudeBot`**, `Google-Extended`, `GPTBot` and
`meta-externalagent` each given `Disallow: /`, and the file asserting that
*"ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF
RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790…"*. Note
`ai-input` is **unset**, which under the file's own vocabulary means
summarization/RAG is neither granted nor restricted.

#### INTERPRETATION — and four concrete collisions with live code

**Finviz: reachability is not a licence.** The natural reading of "the export
endpoint answers my key, so I'm licensed" is exactly backwards. There is no
affirmative grant because there is no document. What there *is* is a
`robots.txt` explicitly disallowing `/export`, `/chart`, `/image` and
`/api/v1/screener-export-csv` — the four path families UCT uses
(`elite.finviz.com/export.ashx` nightly, `chart.ashx` images). robots.txt binds
crawlers rather than authenticated API clients, so this is a signal about intent,
not a breach; but combined with the total absence of terms it means the Elite
subscription agreement is the *only* place a grant could live, and nobody in this
research has seen it. **This is the single largest documentary gap in the audit.**

Four collisions with code, each CONFIRMED and each small enough to act on:

**1. The FRED attribution notice is not displayed anywhere.** The API Terms
require it *"prominently on your application"*. A grep for "not endorsed or
certified", "Federal Reserve Bank of St. Louis" and "FRED®" across `api/**` and
`app/src/**` returns **zero hits**. This is the cheapest compliance fix in the
entire report — one line of UI text.

**2. FRED content is cached, and passed to an LLM.**
`api/services/fred_economic.py:24` sets `_CACHE_TTL = 1800` and `:158` writes to
a TTLCache — against a clause that prohibits caching *"any portion"*. And the
consumers (`voice_tool_impls.py:442`) feed FRED values into Compass answers,
against a clause prohibiting use *"in connection with the development or
training of any… machine learning, including… large language models"*. Whether
"in connection with" reaches inference-time prompting rather than training is a
genuine question — but it is a question, and the current position assumes the
favourable answer without having read the clause.

**3. `TapeFeed.jsx` does not meet X's display requirements.** X mandates the
author's **profile picture, @username and display name** linking to the profile,
and the **post timestamp linking to the permalink**, and the **X logo**. The
component (`app/src/components/tiles/TapeFeed.jsx:53-68`) renders the tweet text,
a *relative* time (`timeAgo(t.created_at)`), and a `↗` link. **No @username, no
display name, no avatar, no X logo, and a relative time rather than the
timestamp.** This is a straightforward UI fix, not an architectural one.

**4. There is no deletion-sync for tweets.** X requires deleting or modifying
stored content within ~24 hours of it being deleted or modified on X.
`api/services/tweet_cleanup.py:12` implements only an age sweep
(`delete_tweets_older_than(days=7)`); nothing re-checks whether a stored post
still exists. The 7-day window bounds the exposure to at most a week, which is a
real mitigation — but it is a coincidence of the retention design, not a
response to the obligation.

**5. And the retention window is itself defeated downstream.**
`api/services/catalyst/engine.py:1163-1165` writes the `raw_signals` column as:

```python
"raw_signals": json.dumps({
    "tweets": c.get("tweets", []),
    "rss":    c.get("rss", []),
    ...
```

`catalysts.db` never prunes (§6). So tweet bodies subject to the 7-day sweep in
`tweets.db` are copied into a store that keeps them forever — **the catalyst row
is a back door around the tweet retention window** — and the same is true of
third-party RSS items. This needs no vendor's terms to be worth fixing.

**On the reseller:** sourcing tweets through TwitterAPI.io does not soften any of
this. Its terms grant no content licence and expressly make the customer
responsible for X ToS compliance. **A reseller cannot grant more than it holds**,
and this one does not claim to.

**Reddit and TheFly are lower-stakes but should not be assumed clean.** Reddit's
AI clause bars using User Content to train a model absent rightsholder consent —
UCT does inference, not training, which is the better side of that line, but
commercial use requires a separate agreement and UCT is commercial. TheFly's
`ai-train=no` is likewise a training signal; UCT's exposure is indirect (via
FMP's grades feed, §9 Observation C) rather than direct.

#### RELEVANCE TO UCT

Items 1, 3 and 5 are fixable this week by an engineer with no vendor
conversation required, and they are the kind of thing that is much cheaper to fix
before an audit than during one. Finviz is the one that needs a document nobody
has.

#### CONFIDENCE

🟢 high on the clause text (verbatim from public pages, dated where the pages are
dated) and 🟢 high on all five code collisions (source-read). 🔴 low on TheFly's
contractual terms — **NOT RETRIEVABLE by machine.**

**EVIDENCE CEILING:** Finviz's Elite subscription agreement (the only place a
grant could exist) was not seen. TheFly's terms need a human with a browser.
FRED, X and Reddit pages required a full browser header set; a plain fetch got
403/402.

#### RECOMMENDATION

Split this into two tracks so neither blocks the other. **Engineering, this
week:** add the FRED notice; bring `TapeFeed.jsx` to X's display requirements;
stop persisting tweet and RSS bodies in `raw_signals` (or extend the sweep to
reach them). **Owner, when convenient:** obtain the Finviz Elite subscription
terms; have someone open `thefly.com/terms` in a browser.

#### OPEN QUESTION

Does the Finviz Elite subscription agreement — the only document that could
grant anything — permit export output to be redisplayed to a subscriber base?

---

### 3.5 Schwab — NOT DETERMINED, and it gates a flagship product

#### OBSERVATION

GEX and dealer positioning (inventory #5, #6) are built entirely on
`https://api.schwabapi.com/marketdata/v1/chains`. **The Schwab Developer Portal's
terms of use are behind registration and could not be read in this research.**

#### EVIDENCE

`api/gex_service.py` — `CHAINS_URL = "https://api.schwabapi.com/marketdata/v1/chains"`;
`api/schwab_service.py:1-3` — *"Schwab API Integration — OAuth2 + Option Chain
Quotes. Endpoints used: Market Data Production (read-only, no trading)"*, with
`SCHWAB_APP_KEY` / `SCHWAB_APP_SECRET`. **CONFIRMED by source.**

Public secondary sources describe the Developer Portal's access path as an
"Individual Developer" registration tied to a personal Schwab brokerage account,
with API access free of charge to account holders building approved
applications. **This is a secondary source, recorded as a lead. NOT DETERMINED.**

#### INTERPRETATION

The shape described — free access, tied to a personal brokerage account,
"Individual Developer" — is the shape of a **personal-use grant**, and it is the
same shape that made the Massive Individuals tier a problem. If it holds, GEX and
dealer positioning would be built on a personal developer credential and served
to ~200 paying members through unauthenticated routes.

**That is a hypothesis, not a finding.** It is stated here because the
combination (flagship differentiated product + unreadable terms + unauthenticated
routes) is worth an hour of someone's attention, not because the terms are known.

#### RELEVANCE TO UCT

Dealer positioning is one of the few things in the inventory a competitor cannot
trivially replicate. It would be an expensive thing to discover a licensing
problem with late.

#### CONFIDENCE

🔴 low — **EVIDENCE CEILING: the governing document was not read.** It is
reachable in minutes by anyone with the portal login; this research could not
register or log in.

#### RECOMMENDATION

Whoever holds the Schwab developer account should open the portal and read the
terms of use for the Market Data API, specifically for (a) personal vs
commercial scope and (b) display to third parties. One session settles it.

#### OPEN QUESTION

Is the Schwab developer registration under an individual account or a business
entity?

---

### 3.6 Social sources — Reddit and Stocktwits

#### OBSERVATION

Two social sentiment sources sit behind the voice/Compass lane and produce
derived bull/bear ratios plus sample posts.

#### EVIDENCE

- `api/services/reddit_sentiment.py:1-10` — PRAW over r/wallstreetbets, r/stocks, r/options, r/investing, r/thetagang; *"Requires REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET… create as 'script' type"*.
- `api/services/stocktwits_sentiment.py:1-8` — *"Free public API (no auth) at api.stocktwits.com/api/2/streams/symbol/{TICKER}.json… Rate limit: 200 req/hr per IP without auth."*
- Consumers: `api/services/sentiment_aggregator.py:70,78` and `api/services/voice_tool_impls.py:579`; registered in the Compass tool union at `api/services/voice_agents.py:395-396`. **Member-gated (paid voice lane) — CONFIRMED by source.**

#### INTERPRETATION

Two different shapes of exposure. **Reddit** is accessed through registered API
credentials, so the Data API Terms apply and are quoted in §3.4b — the operative
ones being that commercial use *"will need… a separate agreement with Reddit"*
and that AI/ML training on User Content requires rightsholder permission. UCT
does inference, not training, which is the better side of that line; UCT is
commercial, which is the worse side of the other. **Stocktwits** is accessed
with **no authentication at all** against
an undocumented JSON endpoint — there is no agreement, and "no auth required" is
not the same as "permitted". The module's own comment about the anonymous
200/hr rate limit shows the constraint was read as a *technical* budget rather
than a *permission* question. That is the same conflation as the yfinance case:
an endpoint that answers is not an endpoint that licenses.

The mitigating fact is scope — both are behind the paid voice lane, neither
reaches a public surface, and both degrade gracefully when unconfigured.

#### RELEVANCE TO UCT

Low individually. Worth naming because TERMINAL-NEXT will be tempted to surface
social sentiment more prominently, and the moment it moves from a spoken answer
to a displayed tile it becomes a display question.

#### CONFIDENCE

🟢 high on the code and on Reddit's clause text (§3.4b). 🔴 low on Stocktwits —
its terms were not researched.

#### RECOMMENDATION

If social sentiment graduates to a visible surface in TERMINAL-NEXT, replace the
unauthenticated Stocktwits path with a credentialed one first — an agreement is
cheaper to obtain before a product depends on it.

#### OPEN QUESTION

Does the Reddit app registration ("script" type, per the module docstring)
correspond to a tier that permits commercial use?

---

## 4. Q3 — EXCHANGE CLAUSES ON DERIVED DATA

### OBSERVATION

**The three SIPs do not share a doctrine.** UTP has a full formal Derived Data
policy with a two-prong test; CTA/CQ has **no Derived Data definition at all**
and instead sweeps derived information *into* the definition of Market Data;
OPRA has **nothing published on derived data anywhere in its document set**. The
clearest tests come from the exchanges (Nasdaq, Cboe), not from the plans.

### EVIDENCE

#### UTP Plan — the fullest SIP treatment

`https://www.utpplan.com/DOC/datapolicies.pdf` · "UTP Data Policies Published
September 2023" (page footer) · §"DERIVED DATA POLICY", p.10

> "Derived Data consists of pricing data or other information that is created in whole or in part from the UTP Information."

The two-prong test, verbatim:

> "To be considered Derived Data: 1) The Derived Data cannot be reverse engineered to recreate the Information, and"

> "2) The Derived Data cannot be used to create other data that is recognized to be a reasonable facsimile for the UTP Information."

Fee treatment:

> "DERIVED DATA: SINGLE SECURITY [FEE LIABLE]: UTP does not offer discounts for Single Security Derived Data, so Derived Data that contains price data and is based upon a single UTP security symbol is generally fee liable at the underlying product rates."

> "DERIVED DATA: MULTIPLE SECURITY [NOT FEE LIABLE]: Derived Data that contains price and/or volume data is based upon multiple UTP security symbols is currently not fee liable."

— listed examples include "Total Portfolio Valuations" and "Creation of Indexes".

> "Distribution of non-fee liable Derived Data does not require the Recipient to sign the applicable Agreements, but note, if a Vendor opts not to administer an Agreement, then the Vendor is required to indemnify in the event of a claim."

**On charts**, same document, Per Query Policy:

> "If the data delivered includes time and sales information, charting or other relevant data for a single security, the Vendor will not need to count each embedded quote... but may count the entire page [including any charts and tables] as a single query."

#### CTA / CQ Plan — the inverse construction

NYSE Professional Subscriber Agreement (CTA Network A),
`https://www.nyse.com/publicdocs/nyse/data/Professional_Subscriber_Agreement.pdf`
· "Form 2-207 Rev. 3/22" · ¶1(c):

> "Each of the above categories includes all information that derives from the category's information. Stock and bond last sale prices and information deriving from those prices cease to be 'Market Data' 15 minutes after the Authorizing SRO(s) make the prices available..."

The same construction appears in the Click-On Vendor–Subscriber Agreement
(`https://www.ctaplan.com/publicdocs/ctaplan/notifications/trader-update/Click-On_Version_Network_A_Vendor-Subscriber_Agreement_Document_1B.pdf`,
"Dated: 10/17/06").

CTA Schedule of Market Data Charges
(`https://www.ctaplan.com/publicdocs/ctaplan/Schedule_of_Market_Data_Charges.pdf`,
**no effective date shown**), footnote 8:

> "Non-Display Use refers to accessing, processing or consuming data... for a purpose other than in support of the datafeed recipient's display or further internal or external redistribution. It does not apply to the creation and use of derived data."

**A formal CTA/CQ "Derived Data" definition is NOT FOUND on public pages.** The
term appears undefined in both Vendor Guides' glossary entry for "Use".

#### OPRA — nothing published

Eleven OPRA public documents were downloaded and text-searched (Vendor
Agreement, Exhibit A, Electronic and Professional Subscriber Agreements, Usage
Based Fee Policy, Device Based Fee Policies, Datafeed Policy, Non-Display
Declaration, Hosted Solutions Policy, Fee Schedule, FAQs). **A formal OPRA
definition of "Derived Data" is NOT FOUND on public pages. An OPRA
"non-substitutable" test is NOT FOUND. OPRA fee treatment of derived
index/aggregate products is NOT FOUND.**

The only occurrence is a blank intake field, OPRA Exhibit A §12(B):

> "Will you be distributing a feed with derived data? Yes / No — If yes, please describe the data that will be distributed:"

#### Nasdaq — explicit substitutability test

`https://www.nasdaqtrader.com/content/AdministrationSupport/Policy/USEquitiesandOptionsDataPolicies.pdf`
· Version 2.6, update log last entry "June 1, 2024" · §3 DERIVED DATA:

> "Derived Data is any information generated in whole or in part from Exchange Information such that the information generated cannot be reverse engineered to recreate Exchange Information"

> "or be used to create other data that is recognizable as a reasonable substitute for such Exchange Information."

> "Note 3: For equities: creation of multiple security information, such as an index, is exempt from subscriber fees. However, the Distributor must report the Non-Display devices."

Nasdaq **AI Policy**,
`https://www.nasdaqtrader.com/content/AdministrationSupport/AgreementsData/Data_AI_Policy.pdf`
(© 2024):

> "Distribution of any derivative work, including but not limited to Derived Data... or Nasdaq Information that has been combined, commingled, aggregated, merged or otherwise amalgamated with other data... is strictly prohibited without first entering into an appropriate license agreement."

#### Cboe — the strictest and most current

`https://cdn.cboe.com/resources/membership/Market_Data_Policies.pdf` ·
**"Effective September 1, 2026"** (footer) · §15:

> "'Derived Data' is pricing data or other data that (i) is created in whole or in part from Data, (ii) is not an index or financial product as described below,"

> "and (iii) cannot be readily reverse-engineered to recreate Data or used to create other data that is a reasonable facsimile or substitute for Data."

> "However, Derived Data that (i) contains price data, (ii) is analogous to price data, (e.g. returns, percentage change, and performance data),"

> "(iii) and/or is based upon a single security, futures contract, currency pair, or index is generally fee liable at the underlying product rates."

**On charts**, §6 Historical Data:

> "it must no longer redistribute Historical Data (including in charts, graphs and other presentations) unless the Historical Data is Cboe approved Derived Data"

**On AI**, new Non-Display Category 4 "Enterprise Derived":

> "Category 4 applies when a Data Recipient uses Cboe Data as an input to develop, train, operate, or enhance a system, product, or platform - including but not limited to artificial intelligence systems, machine learning models, large language models (LLMs), or other enterprise analytical tools"

> "This category captures use cases where Cboe Data becomes embedded in a Data Recipient's commercial value proposition through direct AI-generated outputs, derived data products, or analytical services that are distributed externally"

#### NYSE proprietary — the direct contradiction of CTA

`https://www.nyse.com/publicdocs/nyse/data/NYSE_Proprietary_Market_Data_Comprehensive_Policy_Package.pdf`
· "March 21, 2022":

> "Category 1 applies when a data recipient's Non-Display Use of real-time NYSE Market Information is for its own behalf as opposed to use on behalf of its clients, including the creation of derived data (e.g., indices, financial products etc.) for internal use."

All of the above is **CONFIRMED** — public PDFs, retrieved and text-extracted.

### INTERPRETATION

Four things matter for UCT, and only one of them is the obvious one.

**1. A chart is display, not derived data.** This is the clearest answer in the
whole report, and it answers the contract's flagged question directly. Cboe says
it outright (charts are redistribution of Historical Data unless separately
approved as Derived Data); UTP counts a charting page as a fee-liable query. And
the reason is structural, not arbitrary: **a candlestick chart fails the
reverse-engineering prong by construction** — you can read the OHLC values off
it. A chart of vendor bars is the vendor's prices in a different font. Every
chart UCT posts to Discord, Substack or YouTube (inventory rows #28, #29) is
therefore *display of the underlying data*, not a derived work, on the exchanges'
own test.

**2. UCT's genuinely derived products would pass the test comfortably.** Base
structures, candle labels, pattern detections, RS ranks, breadth percentages,
GEX walls and the Exposure Rating cannot be reverse-engineered back into a price
series and are not a reasonable facsimile of one. On the UTP/Nasdaq framing,
most are also *multi-security*, which is the fee-exempt category. **The engine is
in a much better position than the publication surfaces are.** Two exceptions
worth naming: Cboe's "analogous to price data (returns, percentage change, and
performance data)" language would catch the Flow Scoreboard's contract-price
gains and the theme-tracker returns, and any *single-security* price derivation
(implied move in dollars, entry/stop/target levels) is the fee-liable shape
under both UTP and Nasdaq.

**3. OPRA is the single largest audit gap, and it is a gap by design.** The
options-flow family (#9–#12) is the most differentiated thing UCT does with
market data, and OPRA publishes **no standard to self-assess against** — the
treatment is decided administratively from a free-text description on Exhibit A.
There is no way to be confidently compliant here by reading; the only path is
asking. Given that #12 is public and unauthenticated, this is the highest
value-per-email question in the report.

**4. Cboe's Category 4 is the shape of the next five years.** Effective
2026-09-01 — *yesterday, relative to this report* — Cboe created a declarable
Non-Display fee category for using market data to build AI systems whose outputs
are "distributed externally". No plan or other exchange has an equivalent yet.
TERMINAL-NEXT is, by its own charter, exactly the product that category
describes. Nasdaq's AI Policy points the same direction from a different angle
(commingling exchange data with other data is a derivative work needing a
separate licence).

**One caution against over-reading all of this:** UCT does not hold SIP or
exchange agreements. It holds a *vendor* agreement with Massive. These plan
documents bind Massive and shape what Massive's contract can permit downstream —
they are the ceiling on what any vendor can grant, not a set of terms UCT signed.
Read them as *why Massive's terms say what they say*, not as UCT's obligations.

### RELEVANCE TO UCT

The exchange layer supplies the vocabulary the vendor negotiation will be
conducted in. Walking into a conversation with Massive able to say "our outputs
are multi-security, non-reverse-engineerable derived data; the exceptions are X
and Y; the charts we publish we understand to be display" is a materially
stronger position than asking "are we allowed to do this?"

### CONFIDENCE

🟢 high — every quote is from a dated public PDF, and the negative findings
(CTA, OPRA) come from an exhaustive text search of the published corpus, not
from a failed search.

**EVIDENCE CEILING:** dating is uneven and should be re-checked before relying
on it. Cboe is 2026-09-01 and Nasdaq 2024-06-01, but UTP is 2023-09, the
governing CTA subscriber language traces to a **2006** document, and the CTA
Schedule of Market Data Charges **shows no effective date at all**.

### RECOMMENDATION

Do not build a compliance position on the SIP documents directly — UCT is not a
SIP subscriber. Use them for two things: (a) the vocabulary above, and (b) an
early warning system. **Cboe Category 4 is worth a calendar reminder**: if the
other plans follow it, "we run an LLM over market data and publish the output"
becomes a separately-priced licence category, and TERMINAL-NEXT should know that
before it prices itself.

### OPEN QUESTION

Massive resells SIP data (its docs say it consolidates "directly from regulated
Securities Information Processors"). Does Massive's downstream agreement pass
through the UTP Derived Data carve-out to its subscribers, or does its own
narrower Market Data ToS (§3) govern instead? A vendor may contract *more*
tightly than the plan requires, and on the public evidence Massive has.

---

## 5. Q4 — AI SUMMARIZATION OF LICENSED INPUTS

### OBSERVATION

Fourteen production paths pass vendor-sourced data through an LLM. The vendor
input, the model, and whether the output is published externally:

| # | Path | Vendor data entering the model | Model | Output published externally? |
|---|---|---|---|---|
| 1 | Catalyst thesis | Massive movers/snapshots, **TwitterAPI.io tweet text**, RSS headlines, Perplexity results | `CATALYST_OPUS_MODEL` default `claude-sonnet-4-6` (`api/services/catalyst/synthesize.py:26`) | No — member app |
| 2 | Earnings-call transcript summary | **FMP** `stable/earning-call-transcript` primary, **Finnhub** `/stock/transcripts` fallback — FULL transcript text | Claude Haiku/Sonnet (`api/services/transcripts.py`) | No — member app |
| 3 | AlphaVantage transcript path | **AlphaVantage** `EARNINGS_CALL_TRANSCRIPT` verbatim body | Claude (`api/services/av_transcripts.py`) | No |
| 4 | Call recap / sentiment / guidance | Transcripts + **Perplexity** | Opus + Perplexity (`api/services/call_recap.py`) | No |
| 5 | COT weekly narrative | **CFTC public zips** (US Government, public domain) | `COT_NARRATIVE_MODEL` default `claude-opus-5` (`api/services/cot_narrative.py`) | Optional **Discord** post via `COT_WEEKLY_DISCORD_WEBHOOK_URL` (blank posts nothing) |
| 6 | Significant catalysts | Massive daily bars (biggest-move ranking) | Claude (`api/services/significant_catalysts.py`) | No |
| 7 | Model Book year recap | Massive/provider index history + curated leaders | `MODELBOOK_LLM_MODEL` | No |
| 8 | Stock brief / dossier | Massive bars + FMP earnings rows | Claude (`api/services/stock_brief/service.py`) | No |
| 9 | AI Search agent lane | Every desk tool's output (Massive, FMP, Finnhub, FRED…) + Perplexity web | Claude, capped `AI_SEARCH_AGENT_COST_CAP_DAILY` $15/day (`api/services/ai_search_agent.py`) | No |
| 10 | Compass chat / voice / brain | Same tool registry + KB | Claude | No |
| 11 | Morning Wire rundown + Top 5 picks | Wire data (Massive bars, Finviz scans, FMP grades, AV news) | Claude | **Substack** (paid tier) |
| 12 | Index close note | *No numerals permitted* — see below | Claude | **Discord #TSDR, public** |
| 13 | Desk session insights / chapters | Zoom VTT transcripts (own content) | Opus | YouTube description |
| 14 | Sunday Scans prose | Wire + scan data (Massive bars) | Claude | **Substack — including a FREE tier** (`uct-sunday-scan/sunday_scan/boilerplate.py:323` refers to "the Free Substack mid week newsletter") |

### EVIDENCE

- `api/services/catalyst/synthesize.py:26` — `OPUS_MODEL = os.environ.get("CATALYST_OPUS_MODEL", "claude-sonnet-4-6")`.
- `api/services/transcripts.py:1-11` — docstring names FMP `stable/earning-call-transcript` as PRIMARY (2026-08-05) with Finnhub fallback and *"Claude Haiku/Sonnet summarization → structured bullets + sentiment"*. **CONFIRMED by source; the 403 on Finnhub's transcript endpoint is recorded there as a live probe result.**
- `api/services/av_transcripts.py:1-6` — AlphaVantage `EARNINGS_CALL_TRANSCRIPT`, free tier 25 req/day, budget-gated through `alphavantage_client`.
- `api/services/discord_close_note.py:11-16` — **the "no numerals" rule is a HALLUCINATION-SAFETY rule, not a licensing one.** Verbatim: *"THE NOTE CONTAINS NO NUMERALS. Not a style rule, a safety one: a model writing market prose will happily invent 'SPY closed at 645' and this posts unattended to a PUBLIC channel."* The contract asked whether licensing motivated it: **it did not.** The same docstring at `:17-25` records a *separate* legal constraint — *"IT RUNS ON THE API KEY, NEVER THE SUBSCRIPTION SEAT… Anthropic's legal terms… do not permit routing requests through Pro/Max plan credentials on behalf of your users"* — which is E-01's territory and is already handled correctly here.
- `api/services/ai_search_agent.py:16-19` — cost rails and the Perplexity web leg.

### INTERPRETATION

Two distinct exposure classes, and they are not the same problem:

**(a) Copyrighted TEXT into a model.** Rows 2, 3, 4 feed **verbatim third-party
earnings-call transcripts** (FMP / Finnhub / AlphaVantage) into an LLM and store
the summary. Transcript text is a licensed content product, not a price feed —
the applicable clause is a *content* clause, and content licences are the ones
that most often name AI processing explicitly. Row 1 feeds **tweet text** from
TwitterAPI.io (a third-party X reseller) into a model; X's developer policy is
the strictest AI clause in the whole stack in the general case.

**(b) Numeric vendor data into a model.** Rows 5–11 pass numbers, not text.
Numbers as inputs to a summarizer are a much weaker claim than reproducing
copyrighted prose, and row 5's input (CFTC) is US Government public domain
outright.

The distinction matters because a single "we use AI on vendor data" risk line
would over-state (b) and under-state (a).

**A structural mitigation is already in place and should be recognised:** the
COT narrative is behind a **grounding gate** — every number in the prose must
appear in the supplied facts, else nothing is stored — and the index-close note
forbids digits entirely. Both reduce the chance of the model *reproducing* an
input it should not, as opposed to *summarizing* it.

### RELEVANCE TO UCT

TERMINAL-NEXT is explicitly an AI-forward product. The transcript-summarization
lane (rows 2–4) is the one to settle before it is scaled, because it is the only
lane where UCT stores and displays a derivative of a vendor's **copyrighted
prose** rather than of its numbers.

### CONFIDENCE

🟢 high that these paths exist and what enters them. 🔴 low on whether any of
them breaches a term — that requires the contracts.

**EVIDENCE CEILING:** LLM-provider retention terms are deliberately out of scope
here; see E-01's file. Vendor-side AI clauses are in §3.

### RECOMMENDATION

Treat the transcript lane as a **named licensing question**, separate from
"market data". Ask FMP and AlphaVantage in writing whether summarizing and
storing a derivative of a transcript body, displayed to paying subscribers, is
within the plan. The cost of asking is one email; the cost of assuming is a
content-licensing dispute.

### OPEN QUESTION

Does TwitterAPI.io's own agreement pass through X's developer-policy AI
restrictions, or does it purport to grant rights X does not grant it? A reseller
cannot grant more than it holds.

---

## 6. Q5 — STORAGE OF DERIVED RESULTS AND HISTORY

### OBSERVATION

Retention today, by store. Everything below is source-confirmed.

| Store | What it holds | Retention | Source |
|---|---|---|---|
| `bars.db` (`/data`) | Massive/Polygon OHLCV, all TFs, up to 5,000 bars/series; daily/weekly capped at 30 years | **No prune found — effectively indefinite** | `api/services/bars_sqlite.py`, `bars_fetch.py` |
| `bars_disk_cache` | Massive bars, per-TF TTL (D=48h, W=72h, 60m=8h, 30m=4h, 5m=2h) | TTL-bounded | `api/services/bars_disk_cache.py` |
| R2 bucket `uct-bars-snapshots` | Tarballed `bars.db` snapshots + `brain/` packs | Brain packs pruned to newest 5; bar snapshots not observed pruned | `api/services/data_sync.py:9-12` (`DATA_SYNC_BUCKET`) |
| `flow.db` | Massive OPRA option prints / SWEEP-BLOCK events | Prune exists but **UNARMED** — `FLOW_PRUNE_ENABLED` defaults `"0"` (`api/flow_db.py:58`); `FLOW_PRUNE_MAX_DAYS_PER_RUN=5` (`:63`) | `api/flow_db.py` |
| flow tape spool | Raw tape files | `FLOW_TAPE_SPOOL_RETENTION_HOURS` = **26h** | `api/flow_tape_spool.py:67` |
| flow gap-fill archive | T+1 backfill artifacts | `ARCHIVE_PRUNE_DAYS = 30` | `api/flow_gap_autofill.py:68` |
| `darkpool.db` | Off-exchange prints ≥ $4M notional | `darkpool_trades` pruned to ~120 trading days; **`darkpool_records` never pruned by design** | `api/darkpool_records.py:1-9` |
| `tweets.db` | X/Twitter post bodies via TwitterAPI.io | `TWEET_RETENTION_DAYS` default **7** | `api/services/tweet_cleanup.py:11` |
| `catalysts.db` | Derived rows + LLM theses + **`raw_signals` JSON containing verbatim tweet bodies and RSS items** | **Indefinite retention (stated in CLAUDE.md; no prune in the module)** | `api/services/catalyst/store.py:40,197`; the payload at `api/services/catalyst/engine.py:1163-1165` |
| `screener` snapshot DB | One composite row per ticker (Massive + Finviz + FMP columns) | Nightly rebuild | `api/services/screener/snapshot_db.py` |
| `cot.db` | CFTC history + LLM narratives | 10 years seeded, grows | `api/services/cot_service.py` |
| `buzz` store | ticker + `message_id` + `channel_id`, **no message text** | Not pruned | `api/services/buzz_store.py:1-7` |
| `top_flow_picks.json` | Contract-level picks + daily price history | Active + archived, never pruned | `api/top_flow_tracker.py` |

### EVIDENCE

Verbatim, `api/flow_db.py:58`:

```
FLOW_PRUNE_ENABLED = os.environ.get("FLOW_PRUNE_ENABLED", "0").lower() in ("1", "true", "yes")
```

Verbatim, `api/services/buzz_store.py:3-6` — *"Deliberately stores NO message
text. `message_id` + `channel_id` reconstruct a Discord jump link, which stays
true when a member edits or deletes; a stored copy would not."*

Verbatim, `api/darkpool_records.py:4-5` — *"`darkpool_trades` is pruned to ~120
trading days, so an all-time record must live in its OWN table that only ever
grows."*

### INTERPRETATION

Three things stand out.

**The one deliberate minimisation in the codebase is on the ONLY input that is
not a licensed vendor feed.** `buzz_store` refuses to keep Discord message text
— member-authored content the firm arguably has the most latitude with — while
`tweets.db` keeps third-party X post bodies for seven days and `catalysts.db`
keeps `raw_signals` **indefinitely**, and `raw_signals` contains *those same
tweet bodies plus RSS items* (`api/services/catalyst/engine.py:1163-1165`). So
the 7-day tweet sweep does not actually bound how long a tweet body is held:
**one store honours the window and another quietly defeats it.** The retention
discipline is both aimed at the wrong tape and undercut on the tape it does
aim at. Neither is a bug anyone introduced deliberately; both are what happens
when nobody owns the question.

**`flow.db` grows without bound.** The prune is written, wired and **unarmed**.
A raw OPRA print archive of unbounded age is the single largest stored artifact
of licensed vendor data in the system, and its size is a disk-cost problem
today and a "how much of the vendor's tape do you hold" question the moment
anyone asks.

**Storage clauses are the least-documented clause family across all vendors.**
Even Massive's public Market Data ToS — the most complete document reached in
this research — contains **no clause on caching, storage or retention** (see
§3). Absence of a prohibition is not permission, but it does mean the storage
question will most likely be settled by an order form, not by the public terms.

### RELEVANCE TO UCT

TERMINAL-NEXT's differentiation depends on *history* — implied-capture pairs,
base-structure statistics, flow scoreboards, breadth analogues all need years of
retained derived data. **Retention is a product requirement here, not an
accident**, which makes it worth licensing explicitly rather than discovering
later.

### CONFIDENCE

🟢 high on what is stored and the prune constants (source-read). 🟡 medium on
"no prune found" for `bars.db` — a scheduler-side prune could exist outside the
files inspected.

**EVIDENCE CEILING:** actual on-disk sizes and row counts were not measured —
that would require touching the production volume, which the preamble forbids.

### RECOMMENDATION

Before TERMINAL-NEXT, decide deliberately for each store: *how far back do we
need this, and is holding it that long inside the agreement?* Then arm
`FLOW_PRUNE_ENABLED` to that answer rather than leaving it at "forever by
default". **A retention window nobody chose is a retention window nobody can
defend.**

### OPEN QUESTION

Is the R2 bucket (`uct-bars-snapshots`) UCT's own account? If a vendor's data
sits in a bucket a third party can read, "storage" quietly becomes
"redistribution".

---

## 7. Q6 — CLASSIFICATION TABLE

### How to read it after §3.1

Every Massive-sourced row below is **conditional on the tier**, and the condition
is stated once here rather than repeated twenty times:

- **On the Individuals tier**, every Massive row is **Restricted** — P1 §1's
  *"personal, non-business, and non-commercial"* grant admits no reading under
  which a paid product qualifies. The table below would collapse to one row.
- **On the Businesses tier**, every *member-gated* Massive row becomes **Likely
  Allowed** under the Edge Users carve-out (P3 §6.1(e) + §2.2's `store` right),
  and only the *publicly-reachable* rows stay Restricted, because a member of
  the public is not a "user of Customer's products and services".

The table is written **assuming the Businesses tier**, because that is the
assumption a paid product would have been built on. If that assumption is wrong,
§3.1 is the only section that matters.

### The table

Driver clause references point at §3/§4. "Owner fact that would settle it" is
the single question whose answer moves the row.

| Derived product | Class | Driver clause | Owner fact that would settle it |
|---|---|---|---|
| Breadth statistics + lenses (#1, #3) | **Likely Allowed (verify)** | Massive display-only + Derived Works | Massive plan tier + any business agreement |
| EOD breadth row (#2) | **Restricted** | Yahoo/yfinance terms — personal, non-commercial use; no API licence exists for yfinance | Does UCT accept yfinance-sourced numbers in a paid product? |
| UCT Exposure Rating / regime (#4) | **Likely Allowed (verify)** | Derived from #1–#3; heavily transformed, non-substitutable on its face | Same as #1; plus whether Substack publication is in scope |
| GEX / dealer positioning (#5, #6) | **Unknown, and the routes are unauthenticated** | Schwab Market Data API developer terms — **login-gated, not readable in this research**. Public sources describe an "Individual Developer" registration path tied to a Schwab brokerage account, which is the shape of a personal-use grant. Compounding it: `/api/gex/*` and `/api/dealer-positioning/*` carry no auth dependency (§8) | The Schwab developer agreement text, and whether display of Schwab-derived analytics to third parties is within it |
| Dark-pool aggregates (#7) | **Likely Allowed (verify)** | Massive Derived Works clause | Massive tier |
| **Dark-pool record Discord alerts (#8)** | **Restricted** | Massive prohibition on republishing/transmitting Market Data | Massive tier; and whether a single print's ticker + notional is Market Data or Derived Work |
| Options-flow events + analytics (#9, #10, #11) | **Likely Allowed (verify)** | Massive Derived Works; OPRA vendor treatment (§4) | Massive tier + whether OPRA options data carries its own downstream terms |
| **Flow Scoreboard, public + unauthenticated (#12)** | **Restricted** | Massive display/redistribution clause; public = "any third party" | Massive tier; is the scoreboard's contract-price-gain statistic a Derived Work? |
| Expected / implied move (#13, #14) | **Likely Allowed (verify)** | Massive Derived Works; option quotes are the input | Massive tier |
| yfinance options chain + Greeks (#15) | **Restricted** | Yahoo terms | Same as #2 |
| Base structures, candles, patterns, indicators, Pine parity (#16–#20) | **Likely Allowed (verify)** | Massive Derived Works — but these are the most transformed and least substitutable outputs in the system | Massive tier |
| RS rank / RS line (#21) | **Likely Allowed (verify)** | Massive Derived Works | Massive tier |
| **Screener composites incl. Finviz + FMP columns (#22, #23)** | **Restricted** | Two independent drivers: Finviz Elite terms (§3.4) *and* **FMP §2.2.2**, which prohibits "showcasing FMP Services or Data on platforms including but not limited to websites… or applications designed for utilization by multiple individuals" without a specific agreement | Finviz Elite plan type; **and** whether UCT holds an FMP Data Display and Licensing Agreement |
| **FMP-sourced display surfaces (calendar earnings rows, research estimates/financials/ownership, Model Book earnings table)** | **Restricted** | FMP §2.2.2 — the clause turns on *display to multiple individuals*, not on derivation, so it reaches these even though they are barely derived | Same FMP agreement question |
| UCT20 book stats (#24) | **Likely Allowed (verify)** | Massive Derived Works | Massive tier; plus Substack publication scope |
| Catalyst tiers + theses (#25, #26) | **Likely Allowed (verify)** | Massive + TwitterAPI.io + Perplexity + AV; multi-vendor. **X's terms bind the stored tweet text** — TwitterAPI.io grants no content licence and pushes X ToS compliance to the customer (§3.4b) | Nothing external — the `raw_signals` retention question below is answerable in code |
| **Reddit / Stocktwits sentiment (voice lane)** | **Likely Allowed (verify)** for Reddit, **Unknown** for Stocktwits | Reddit Data API Terms §3.1 (*"commercial purposes… will need to enter into a separate agreement with Reddit"*); Stocktwits is accessed unauthenticated against an undocumented endpoint with no terms researched (§3.6) | Whether a Reddit commercial agreement exists; Stocktwits' terms |
| **AlphaVantage-sourced news + transcripts** | **Restricted** | AV ToS §2(a): licence is "for personal, non-commercial use, unless… agreed otherwise in writing", and commercial use expressly includes "any type of commercial activity that allows individuals or entities other than User to access information directly or indirectly" (§3.4) | Is there a written AV commercial agreement? If not, the row is settled — and both call sites have working fallbacks |
| Buzz counts (#27) | **Allowed** | Discord content, member-authored, no text stored | None — this row is clean |
| **Stored tweet + RSS bodies inside `catalysts.db` `raw_signals`** | **Restricted** | Verbatim third-party content persisted indefinitely, defeating the 7-day `tweets.db` window (`api/services/catalyst/engine.py:1163-1165`; §6) | None needed — this is a code decision, actionable today |
| **Index-close charts + note to the PUBLIC channel (#28)** | **Restricted** | Massive republication clause; the channel is public by the code's own docstring | Massive tier; is the public channel intended to stay public? |
| **Chart images to Substack / Sunday Scans free tier / YouTube (#29)** | **Restricted** | Massive republication clause | Massive tier; is the Sunday Scans Substack genuinely free-to-public? |
| FRED economic series — US Gov series | **Allowed** | US Government works, public domain | None |
| **FRED — the whole catalog, all ~30 series** | **Restricted** | Not the third-party carve-out — the *general* prohibitions. FRED §Prohibitions (q) bans storing/caching *"any portion"* (`fred_economic.py:24,158` caches 30 min) and (p) bans use *"in connection with the development or training of any… machine learning, including… large language models"* (values are fed to Compass). The mandatory API notice is **absent from the codebase** (§3.4b). **Consumer census done:** only `voice_tool_impls.py:442,453` and `options_chain.py:32` read it, so nothing reaches a public surface | Whether "in connection with" reaches inference-time prompting or only training — and, separately, which of the ~30 catalog series carry a third-party copyright tier |
| **FRED — which specific series are copyright-restricted** | **NOT DETERMINED** | ⚠️ **An earlier draft of this file asserted that VIXCLS, UMCSENT and the London gold fixing are third-party copyrighted series. That was inference from general knowledge, not measurement, and it is retracted.** FRED names exactly one provider in its terms (**Visa**, Spending Momentum Index). The tier of any other series is discoverable only at runtime | Run FRED's own test — *"Copyrighted series contain the word 'Copyright' in their notes"*, checkable per series via `fred/series/search`. Thirty lookups settles the whole catalog |
| Transcript summaries (§5 rows 2–4) | **Unknown** | FMP §2.6.1(i) ("data or information contained in or **derived from** The Services") + §11.1 (FMP claims IP in derived information); Finnhub's "derived results" clause; AlphaVantage (see §3.4). **No vendor has an AI clause at all** — the derived-works clauses are the operative constraint | Written answer from FMP and AlphaVantage on summarizing transcript bodies |

### The five rows to act on first

Ranked by (publication reach × clause directness). Note that #1 and #2 survive
*even on the Businesses tier*, which is what makes them the actionable ones:

1. **#12 Flow Scoreboard** — public, unauthenticated, derived from the OPRA tape, and the module's own docstring calls it *"a public trust asset"*. Its viewers are not Edge Users, so the Massive Businesses carve-out does not reach it. Highest reach of any derived surface.
2. **#28 / #29 chart publication** — Massive-sourced bars rendered and posted to a public Discord channel, a Substack with a free tier, and YouTube. On Cboe's and UTP's own framing a chart is *display of the underlying data*, and the audience is public. This is the "derived visual redistribution" the contract asked to flag, and it is real.
3. **FMP §2.2.2 display surfaces (#22 + calendar + research pages)** — the clause does not care about derivation; it prohibits showcasing FMP Data on an application "designed for utilization by multiple individuals" absent a specific agreement. Settled by one artifact: the Data Display and Licensing Agreement, if it exists.
4. **#23 Finviz Elite** — a paid single-account export product whose columns are joined into a member-facing screener row for ~200 paying users.
5. **#2 / #15 yfinance** — Yahoo has no commercial API licence at any price, so this is the one row where "verify the contract" is not an available move. The *authoritative* EOD breadth row and the voice options chain both depend on it. See §9 Observation B.

### EVIDENCE

Every "Restricted" above is restricted **on the face of a public clause quoted
in §3**, not on a legal conclusion. Every "Likely Allowed (verify)" follows
`OWNER_SEED_FACTS.md:57`'s default.

### INTERPRETATION

The pattern is clean and worth stating plainly: **computation is almost never
the problem; publication is.** Fourteen of the products are member-gated and
sit at "Likely Allowed (verify)". Every "Restricted" row is either (a) published
beyond the paywall, or (b) sourced from a vendor with a personal-use-only shape
(yfinance, Finviz Elite).

### RELEVANCE TO UCT

TERMINAL-NEXT can safely assume the *internal* derived engine is licensable. The
design question it must answer up front is: **which derived outputs leave the
paywall, and under whose licence?** That is a product decision with a licensing
consequence, and it is cheapest to make now.

### CONFIDENCE

🟡 medium. The classification logic is sound and traceable; the inputs (plan
tiers, signed terms) are all missing.

**EVIDENCE CEILING:** every row would move to a firm class with two artifacts —
the Massive order form and the Finviz Elite plan page. Neither was reachable.

### RECOMMENDATION

Do not remediate on this file alone. **Get the Massive plan tier first** — it
alone re-classifies 20 rows. Chasing individual rows before that is work done in
the dark.

### OPEN QUESTION

Does the owner want the Flow Scoreboard to stay public? If the answer is "yes,
it is a marketing asset", that is a deliberate accepted risk and should be
recorded as such in `OWNER_DECISIONS.md` — not left implicit in a docstring.

---

## 8. PUBLICATION SURFACES — THE REDISTRIBUTION REGISTER

### OBSERVATION

Every surface on which UCT-derived data built from vendor inputs leaves the
member paywall, with its gate:

| Surface | What leaves | Gate on it | Source |
|---|---|---|---|
| `GET /api/flow-scoreboard` | Hit rates, grade calibration, recent picks, contract-price gains from the OPRA tape | **None** — explicitly public and unauthenticated, and **mounted unconditionally** (no flag, no auth dependency) | `api/flow_scoreboard.py:19-20,36`; imported `api/main.py:59`, `app.include_router(flow_scoreboard_router)` at `api/main.py:7036` |
| `GET /api/gex/*` and `GET /api/dealer-positioning/*` | Gamma walls, zero-gamma level, dealer net positioning — **derived from Schwab chain data** | **None found.** Neither router declares `Depends(get_current_user)` or a `dependencies=` list; both are mounted unconditionally at `api/main.py:7087-7088`. There is **no global auth middleware over `/api/*`** — `api/middleware/auth_middleware.py:3` states in-file: *"Does NOT block any existing endpoints. Only used by routes that explicitly depend on it."* `_AdminGuard` covers only enumerated `/api/admin/*` and `/api/live/admin/*` prefixes | `api/gex_router.py:8`, `api/dealer_positioning_router.py:45`, `api/main.py:7087-7088`, `api/middleware/admin_guard.py:26-31` |
| Discord `#TSDR` index-close posts | 8 charts/day rendered from Massive bars + a no-numerals note | Flag off unless armed · blank webhook posts nowhere · non-trading day skipped. **Fails CLOSED three ways** | `api/services/discord_index_close.py:14-18` |
| Discord dark-pool record alerts | Ticker + notional of record off-exchange prints | `DARKPOOL_RECORDS_ENABLED` default `"0"` | `api/darkpool_records.py:12,28` |
| Discord `/chart` command | House chart images from Massive bars | **Guild-locked** to two UCT servers; user-installs and DMs refused | `api/services/discord_interactions.py:863-897` (`DEFAULT_ALLOWED_GUILDS`, `guild_allowed()`) |
| Substack — Morning Wire | Charts, levels, exposure, book | Paid; `send_gate.clear_to_send` off by default, fails CLOSED | `morning-wire/substack/send_gate.py:1-17` |
| Substack — Sunday Scans | Charts rendered through `/r/chart` | **A free mid-week newsletter exists** | `uct-sunday-scan/sunday_scan/boilerplate.py:323` |
| YouTube — The Desk | Session video + AI thumbnail + description | Per-show privacy; `DESK_PUBLIC_SHOWS` default `sunday scans` only; **blank makes NOTHING public** | dashboard `CLAUDE.md` "Desk" section, `privacy_for_section` |
| Discord `#TSDR` session announce | Embed + thumbnail + recap | `DESK_TSDR_ANNOUNCE_SHOWS` default `evening update`; **blank announces nothing** | dashboard `CLAUDE.md` |

### EVIDENCE

Verbatim, `api/flow_scoreboard.py:19-20` — *"No auth on the GET — read-only,
cacheable, public."* And `:11` — *"Honesty rules (LOCKED — this is a public
trust asset)"*. **CONFIRMED by source.**

Verbatim, `api/services/discord_index_close.py:14-18` — *"#TSDR IS THE PUBLIC
COMMUNITY CHANNEL. Everything here fails CLOSED, three ways… The failure
direction is silence - never an unintended public post."* **CONFIRMED by
source.**

### INTERPRETATION

**This codebase already has an excellent instinct for fail-closed publication —
and it is aimed entirely at the wrong risk.** Every gate quoted above exists to
prevent *accidentally leaking paywalled content to non-payers*. Not one of them
was designed to prevent *redistributing a vendor's data*. They are the same
mechanism pointed at a different threat, which means the retrofit cost is very
low: the gates exist, the allowlists exist, the blank-means-nothing contract is
already the house idiom. What is missing is a second reason to consult them.

**Two surfaces have no gate at all, and they are different in kind.** The Flow
Scoreboard is ungated *deliberately*, for a good product reason (public proof of
honesty, losers never excluded) — a defensible trade that simply has not been
weighed against a licensing cost, because nobody had written the licensing cost
down. This file is that writing-down.

`/api/gex/*` and `/api/dealer-positioning/*` appear ungated *by omission*. The
auth middleware's own docstring explains why this is easy to do accidentally —
*"Does NOT block any existing endpoints. Only used by routes that explicitly
depend on it"* — so a router that never adds the dependency is public by
default, and nothing anywhere reports that it happened. The same pattern is what
`api/middleware/admin_guard.py` was written to retrofit onto the flow admin
routes, which were *"completely unauthenticated"* with *"each carrying its own
unfulfilled `TODO: require_admin`"*. **This is a known, previously-remediated
defect class in this codebase, and it has recurred on the GEX family.**

⚠️ Stated carefully: the *routes* carry no auth dependency and no global gate
covers them — that is CONFIRMED from source. Whether they are reachable from
the open internet on production was not tested (the contract forbids probing
production), and a frontend paywall would not change the answer, because the
API is the surface. Verifying this is a single unauthenticated GET that E-03 or
the owner can run; it should be run.

### RELEVANCE TO UCT

If TERMINAL-NEXT adds public marketing surfaces (a landing page with live
statistics, an open leaderboard, a public scan of the day), each one is a new
redistribution question. **The cheap move is a single publication chokepoint
that asks "whose data is in this, and may it go out?" once — rather than a
per-surface gate written by whoever shipped that surface.**

### CONFIDENCE

🟢 high — every gate above was read in source.

### RECOMMENDATION

Add "vendor of origin" as a field on anything that reaches a publication
chokepoint. It costs a string and it makes the question answerable.

### OPEN QUESTION

Is the Sunday Scans free Substack tier still active, and does it carry charts?
`boilerplate.py` describes a free mid-week newsletter; whether charts ride it
was not determined.

---

## 9. THREE CROSS-CUTTING OBSERVATIONS

### OBSERVATION A — the repo has no licensing memory at all

`CLAUDE.md` in the dashboard worktree is 249 KB of accumulated engineering
knowledge. A case-insensitive grep for `licens`, `redistribut`, `derived data`,
`terms of service` and `ToS` across the whole file returns **one hit, and it is
a false positive** (the word "Selection" in a catalyst quota line). There is no
section on data rights, no note on any vendor's terms, and no record of a
licensing decision ever having been made.

**EVIDENCE:** `grep -rn -i "licens\|redistribut\|derived data\|terms of
service\|ToS" CLAUDE.md` → `2345:- **Selection** (...)`. **CONFIRMED.**

**INTERPRETATION:** this is not negligence — it is a document that grew out of
debugging sessions, and licensing never caused an outage. But it means every
engineer and agent who has ever worked in this repo has made data-publication
decisions with **zero** available context on data rights. The `discord_close_note.py`
docstring is the sole counter-example: it correctly identifies and handles an
Anthropic *seat-vs-API* legal constraint. One file out of ~300 knew a legal fact,
and it knew it because someone had audited that specific question in August.

**RECOMMENDATION:** whatever TERMINAL-NEXT decides, the decision belongs in a
place an agent will read *before* shipping a public surface. A `docs/` file
nobody greps is not that place; the publication chokepoint in §8 is.

### OBSERVATION B — yfinance is the second-largest vendor and the only one with no purchasable licence

**OBSERVATION.** Twenty-four modules in `api/**` import `yfinance` directly, and
the EOD breadth row — the *authoritative* daily breadth record, the one the
intraday lane reconciles against — is built entirely from it.

**EVIDENCE.** `grep -rln "import yfinance" api/ --include=*.py | wc -l` → **24**.
The member-facing ones include `api/services/fundamentals.py`,
`api/services/research/{estimates,financials,ownership}.py`,
`api/services/institutional_holdings.py`, `api/services/short_interest.py`,
`api/services/earnings_table.py`, `api/services/dividends_calendar.py`,
`api/services/options_chain.py` (chain + Black-Scholes Greeks) and
`api/services/setup_grade.py`. In `uct-intelligence`,
`scripts/breadth_collector.py` calls `yf.download(..., auto_adjust=True)` at
lines 377, 776 and 1986. **CONFIRMED by source.** There is a technical guard
(`api/services/yf_util.py` bounded calls + circuit breaker, status at
`api/routers/yf_guard.py`) — it is a *reliability* guard, not a licensing one.

**INTERPRETATION.** Every other vendor in this stack has a purchasable
commercial tier; the question there is *which* tier. Yahoo Finance has **no
public commercial data licence at any price**, and `yfinance` is an unofficial
third-party scraper of a consumer web endpoint — there is no agreement to be on
the right side of. That makes this the one dependency where "verify the
contract" is not an available move.

The exposure is asymmetric in a useful way, though: yfinance data here is mostly
**fundamentals, ownership, dividends and estimates** — slower-moving reference
data that FMP already serves elsewhere in the same codebase (see
`api/services/fundamentals_bulk.py`, which pulls ten whole-market columns from
three FMP bulk endpoints in six requests). The breadth collector's
dividend-adjusted history is the genuinely hard one to replace, because the
adjustment basis is baked into every stored level (`api/services/breadth_live.py`
documents this collision explicitly: the collector is dividend-adjusted, bars.db
is split-adjusted only).

**RELEVANCE TO UCT.** A TERMINAL-NEXT built on a scraper of a consumer endpoint
inherits both a licensing question with no answer and an availability risk with
no SLA. This is the cheapest large risk to retire in the whole report, because
the replacement vendor is already paid for.

**CONFIDENCE.** 🟢 high on the usage census. 🟡 medium on "no commercial licence
exists" — that is well-established but was not re-verified against Yahoo's
current terms in this research (E-01's scope).

**RECOMMENDATION.** Inventory the 24 call sites by *what they fetch*, then move
everything FMP already covers. Treat the breadth collector's adjusted history as
its own project, not as part of a sweep.

**OPEN QUESTION.** Is the owner aware that the authoritative EOD breadth row —
the input to the Exposure Rating that the whole product is organised around —
comes from yfinance rather than from the paid Massive feed?

### OBSERVATION C — a sublicensing chain nobody named

TheFly's data reaches the Morning Wire, but **not through a TheFly key**.

**EVIDENCE:** `morning-wire/thefly.py:5-11` — verbatim: *"the module is no longer
a TheFly client. `fetch_analyst_actions()` was removed on 2026-07-29 —
THEFLY_API_KEY/THEFLY_BASE_URL were never populated… TheFly's data still reaches
the wire: FMP's grades feed is sourced from thefly.com (see
analyst_feed.fetch_fmp_grades)."* And `morning-wire/analyst_feed.py:19-20` —
*"FMP /stable/grades-latest-news … aggregates TheFly + StreetInsider. ★
backbone"*. Separately, `api/services/thefly_news.py` in the dashboard is a
live TheFly wrapper that no-ops without `THEFLY_API_KEY` — **KEY-PRESENT status
unknown; CODE-REFERENCED confirmed.**

**INTERPRETATION:** analyst upgrades/downgrades published in the Morning Wire
originate at TheFly, arrive via FMP, and are then summarized by an LLM and sent
to Substack. UCT's licence is with FMP; FMP's licence is with TheFly. **A
sublicence chain is only as strong as its weakest link, and UCT cannot see the
FMP–TheFly link.** This is normal and usually fine — it is precisely what a data
aggregator sells — but it should be *named* rather than discovered later.

**RECOMMENDATION:** when asking FMP about transcript summarization (§5), ask the
same question about the grades feed: does FMP's licence to UCT cover
redistributing TheFly-sourced analyst actions in a paid newsletter?

**CONFIDENCE:** 🟢 high on the chain's existence (both docstrings are explicit).
🔴 low on its legal shape.

---

## GAPS

Things the budget reached but could not close:

1. **The Massive tier — Individuals vs Businesses.** The single highest-value
   unknown in the whole report. One comment in `polygon_options.py:5` says
   "Polygon Advanced tier, $200/mo", which names a *product plan*, not a *terms
   tier*, and is a comment rather than a receipt. Twenty of 29 inventory rows
   re-classify on this fact alone.
2. **No signed agreement, order form, invoice or account page** for any vendor
   was inspected — the preamble forbids production access and none are in the
   repos.
3. **FMP's Acceptable Data Use Policy is 404 on the public web** while ToS
   §2.6.2 makes compliance mandatory and its breach "a material breach of the
   Agreement". FMP's "Data Display and Licensing Agreement" and "Exhibit A —
   Data Deletion Agreement" are likewise referenced but unpublished. **These are
   findings about FMP's documentation, not merely gaps in this research.**
4. **Finnhub's pricing and FAQ pages are JS-only React shells** (~99 characters
   of extractable text); any tier-specific redistribution language there could
   not be read without a rendering browser.
5. **Schwab's developer terms could not be read** — the Developer Portal's terms
   are behind registration. Public secondary sources describe an "Individual
   Developer" path tied to a personal Schwab brokerage account, which is the
   shape of a personal-use grant, but that is a secondary source and is recorded
   here as a lead, not a finding. GEX and dealer positioning — two of the most
   differentiated products — depend on it entirely, and their routes are
   unauthenticated (§8). **This is the second-highest-value gap after the
   Massive tier.**
4. **TwitterAPI.io's own terms** (as distinct from X's developer policy) were
   not reached; the pass-through question in §5 is open.
5. **Whether each derived product actually RUNS in production.** This report is
   source-inspected, not log-verified. Several rows are flag-gated
   (`DARKPOOL_RECORDS_ENABLED`, `FLOW_PRUNE_ENABLED`, `THEFLY_API_KEY`) and
   their live state is unknown — the preamble's `KEY-PRESENT →
   CODE-REFERENCED → OBSERVED-CALLED` ladder stops at CODE-REFERENCED for all
   of them.
6. **`bars.db` retention** — no prune was found, but a scheduler-side sweep
   outside the inspected files cannot be excluded.
7. **Quantities.** No store's size or row count was measured; that needs the
   production volume.
8. **Whether `/api/gex/*` and `/api/dealer-positioning/*` are actually reachable
   unauthenticated on production.** The routers declare no auth dependency and
   no global gate covers them (CONFIRMED from source, §8), but the contract
   forbids probing production, so the live behaviour is untested. **One
   unauthenticated GET settles it** — worth running.
9. **Stocktwits' terms** were not researched (§3.6).
10. **Which of UCT's ~30 FRED series carry a third-party copyright tier.** FRED
    publishes the test (*"Copyrighted series contain the word 'Copyright' in
    their notes"*, via `fred/series/search`) but not the list. ⚠️ An earlier
    draft of this file guessed at three of them from general knowledge; that
    guess is retracted in §7 and should not be reintroduced. **Thirty lookups
    closes this gap properly.**
11. **TheFly's contractual terms** — `thefly.com/terms` returns HTTP 200 but the
    legal body is client-rendered and absent from the delivered HTML. Its
    `robots.txt` disallows AI crawlers (`ClaudeBot` among them), so this was not
    worked around. **A human with a browser closes it in two minutes.**
12. **Finviz's Elite subscription agreement** — the only document in which a
    grant could exist, since no public terms document does (§3.4b).

## NOT INSPECTED

- Production services, the production `/data` volume, Railway variables, and any
  vendor API — all forbidden by the contract and the preamble.
- `api/live_massive_router.py`, `api/massive_ws_worker.py`,
  `api/massive_processor.py`, `OptionsFlow.jsx`, `schwab_router.py` beyond their
  headers — partner-owned (Ravi); read at docstring depth only, per the
  preamble's instruction not to describe them at a depth that invites editing.
- The full text of E-01's and E-03's findings — those files did not exist when
  this was written (`ls` on `09-security-licensing-cost/` returned only
  `.gitkeep`). Any general ToS clause, LLM-provider retention term, or
  real-time display rule referenced here should be re-read against their files
  once written.
- `app/src` frontend rendering of derived data (E-03's display question, not
  this contract's).
- The `uct_intelligence` Discord-bot repo at `C:\Users\Patrick\uct_intelligence`
  — buzz was inspected from the dashboard side only.
- Cost (explicitly out of scope).
