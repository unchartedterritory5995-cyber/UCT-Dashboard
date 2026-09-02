---
id: E-02
title: Data-use classification — every provider × data class × use, with the driving clause and the owner fact that flips it
role: Storage, caching, and AI-use classifier (Group E, licensing pod)
wave: 1
group: E
category: licensing
scope: read-only synthesis over E-01, E-03, E-04, D-03, D-12, D-13 and the orchestrator's Railway flag read; dashboard worktree consulted only to confirm a use exists
confidence: 🟡 medium overall (clause text 🟢 via E-01/E-03/E-04; production flag state 🟢 via the orchestrator's read; which CONTRACTS UCT holds 🔴 — owner facts, not inspectable)
evidence_ceiling: No vendor contract, order form, invoice or account page was seen by any agent in this pod. The Massive tier (Individuals vs Businesses) is UNKNOWN and re-classifies roughly two thirds of this table by itself; the FMP Data Display and Licensing Agreement is UNKNOWN and re-classifies the second largest block. Finviz publishes no terms at all, so its rows cannot be raised above Unknown by any research. Schwab's and TheFly's terms are login-gated / client-rendered. No production endpoint was called by me; all production state comes from the orchestrator's read-only Railway pass (ORCH-RAILWAY-01).
sources: docs/terminal-research/09-security-licensing-cost/vendor-terms-evidence.md (E-01), .../realtime-and-exchange-classification.md (E-03), .../derived-data-rights.md (E-04), docs/terminal-research/02-data-providers/provider-inventory-dashboard.md (D-03), .../railway-flag-state.md (ORCH-RAILWAY-01), docs/terminal-research/08-ai/existing-ai-systems.md (D-12), docs/terminal-research/05-product-strategy/proprietary-asset-inventory-raw.md (D-13), api/services/desk_daily_session.py, api/services/fred_economic.py, api/routers/waitlist.py, app/src/utils/comingSoon.js
uct_relevance: high
status: draft
date: 2026-09-02
---

# E-02 — Data-Use Classification

This is the input to the licensing register (gate item 5). It takes the licensing
pod's evidence and answers one question per cell: **may UCT do THIS with THAT
vendor's data?** Every cell carries a class, the driving clause, and the single
owner fact that would move it.

**This artifact classifies risk, not law.** It is a research read of public terms
against inspectable code and a read-only production configuration pass. It is not
legal advice and no agent in this pod has seen a single executed contract.

> **Verification pass, 2026-09-02.** This file was re-read in full against all six
> KNOWN-FACTS sources and its own self-made code claims were re-checked at source.
> Everything inherited from E-01 / E-03 / E-04 / D-03 / D-12 / D-13 / ORCH-RAILWAY-01
> traced correctly. Four of my own claims were re-confirmed by direct read
> (`privacy_for_section`'s `"*"` short-circuit; `polygon_extras.py:4`'s *"$200/mo
> `MASSIVE_API_KEY` tier"*; `fred_economic.py:105-111`'s keyless error return;
> `comingSoon.js`'s deliberate `/r/*` exemption), and the zero-hit sweep for delay
> notices, non-professional attestation and the FRED notice re-ran empty. **Three
> corrections were made and are marked in place**: the `DESK_PUBLIC_SHOWS=*`
> wildcard is documented in code as an **owner decision** rather than a
> misconfiguration (§1 finding 1, §6, §8 OI-E02-04, §9 row 1); §9 row 10 had
> **misattributed** a "30 structures" count to E-04, which says no such thing
> (retracted in place); and a broken table cell in §2.6 was repaired. No
> classification in §2 changed.

---

## 0. HOW TO READ THIS TABLE

### The five classes

| Code | Class | Meaning |
|---|---|---|
| **A** | Allowed | Used **only** where there is no vendor licence anywhere in the path — US Government public-domain data and UCT's own content. Per contract, **no row is classified Allowed on the strength of a vendor contract**, because no vendor contract was seen. Even an **A** here is a statement about the *absence of a vendor constraint*, not a contract confirmation. |
| **LA** | Likely Allowed (verify contract) | Nothing public forbids it *and* the use is internal or member-gated *and* the named owner fact is expected to hold. A signed order form could still say otherwise. |
| **R** | Restricted | A public clause on its face prohibits or conditions it. **Not a finding of breach** — a flag that the clause and the behaviour collide and an owner fact is needed. |
| **U** | Unknown | The governing clause could not be reached, or the vendor tier is itself unresolved. |
| **X** | Unsuitable | Prohibited with no purchasable remedy. Only Yahoo/yfinance and TheFly-direct reach this. |

### The seven uses

1. **Desk display** — raw display to the owner and staff only, inside the firm.
2. **Member display** — display on a paid, logged-in member surface.
3. **Storage / history** — persisting the data beyond the request that fetched it.
4. **Caching** — short-lived TTL / disk caching on the serving path.
5. **Derived analytics** — computing and showing a number, label or image UCT derives.
6. **AI processing** — sending the data or a derivative of it to an LLM as an Input.
7. **External publication** — Discord, Substack, YouTube, or an unauthenticated web route.

### The two binaries that own this document

Everything else is downstream of two owner facts:

* **The Massive tier.** Individuals ToS grants *"personal, non-business, and
  non-commercial"* use, *"display use only"*, and a Derived Works bar reaching
  *"any data, charts, analytics, research"*. Businesses ToS grants an **Edge Users**
  carve-out (*"individuals or entities that are users of Customer's products and
  services"*) plus an express right to **`store`**. E-01 §1a, E-04 §3.1. The in-repo
  claim of *"Polygon Advanced tier, $200/mo"* (`api/services/polygon_extras.py:4`,
  same string at `api/services/polygon_options.py:5`) names an **individual product
  plan** and is a comment, not a receipt.
* **The FMP Data Display and Licensing Agreement.** §2.2.2 prohibits showcasing FMP
  Data on any application *"designed for utilization by multiple individuals"*,
  *"irrespective of whether such usage is complimentary or paid, and whether it
  pertains to internal or external organizational purposes"*. FMP's own pricing page
  names the remedy. E-01 §2, E-04 §3.2.

Where a cell depends on one of these, the table shows the **Individual-tier /
without-DDLA** class first and the **Business-tier / with-DDLA** class after a
slash, e.g. `R / LA`.

---

## 1. THE SIX FINDINGS THAT MOVE THIS TABLE

*Three come from cross-reading the pod; three are new production facts.*

**1. `DESK_PUBLIC_SHOWS=*` — every Desk session uploads to YouTube as PUBLIC,
including the paywalled Live Trading Sessions.** E-04 §8 recorded the code default
(`sunday scans` only, *"blank makes NOTHING public"*) and treated the surface as
narrow. The live value inverts it. `api/services/desk_daily_session.py:117-123
privacy_for_section()` returns `"public"` for **every** section the moment `"*"` is
in the list, before the per-show matching runs at all. A Desk session is a screen
recording of the dashboard — Massive bars, Schwab-derived GEX, FMP tables — so this
is the widest vendor-data redistribution surface in the product, it is public, and
it is one variable. **CONFIRMED** (code read by me; value from ORCH-RAILWAY-01).

⭐ **And it is deliberate — which makes it a sharper finding, not a softer one.** The
comment directly above the constant (`api/services/desk_daily_session.py:106-109`)
reads: *"The single value `*` makes EVERY show public (**owner decision
2026-08-19**) — the wildcard must be the whole entry, so no section name can drift
into matching it by substring."* So this is **not** a misconfiguration to be quietly
corrected, and the register must not file it as one. It is a recorded product
decision, made three weeks before this report, whose **licensing consequence was
never part of the decision record** — because no licensing register existed to put it
in. The correct entry is *"deliberate owner decision; the vendor-data redistribution
cost was not weighed"*, and the ask in §8 is a **re-confirmation with the cost now
visible**, not a bug report.

**2. FRED, Reddit and TheFly are inert in production — so three of E-04's five
"fixable this week" collisions are dormant, not live.** `FRED_API_KEY`,
`REDDIT_CLIENT_ID`/`_SECRET` and `THEFLY_API_KEY` are absent on **every** Railway
service (ORCH-RAILWAY-01 §Two admin reads). `api/services/fred_economic.py:105-111`
returns `{"error": "FRED_API_KEY not configured"}` without the key, so the FRED
caching collision (`:24,158`), the FRED-into-an-LLM collision and the missing
attribution notice describe a code path that **currently returns nothing**. This
does not make them safe to arm; it makes them a *design decision pending*, which is
a materially different register entry from a live exposure.

**3. The product is in pre-launch COMING SOON mode, and the `/r/*` renderers are
deliberately exempt from it.** `COMING_SOON_MODE=1` and `VITE_COMING_SOON=1` are set
on `web`. `api/routers/waitlist.py:7,33-39` — *"signup stays closed while
COMING_SOON_MODE is on"*; `app/src/utils/comingSoon.js:1-20` — the gate covers
`/landing`, `/pricing`, `/compare`, `/brokers`, `/signup`, `/subscribe`, and is
*"deliberately NOT"* applied to `/login`, `/terms`, `/privacy` or **"the token-gated
`/r/*` renderers the Morning Wire → Substack pipeline depends on"**. So today's
member population is the existing base, not a growing signup — and the one surface
E-03 and E-04 both call effectively public is the one the pre-launch gate exempts by
design.

**4. Under the Individual-tier assumption, no delayed / aggregated / desk-only
design rescues the product — because the vendor contract binds tighter than the
exchange plans, and it binds on PURPOSE rather than audience.** The exchanges give
UCT three genuine escapes (delayed-plus-live-volume, multi-security derived data,
historical-only options). Massive P1 §5(c) bars *"any data, charts, analytics,
research, or other works based on, referring to, or derived from the Market Data"*
regardless of delay or aggregation, and P1 §3 says commercial use *"is incompatible
with Non-Professional status, even if the business or commercial use is on behalf of
an organization not in the securities industry."* FMP §2.2.2 says *"internal or
external"*. Finnhub says *"even internally"*. **The desk-only escape route the
contract asked me to evaluate does not exist at three of the four self-serve
vendors.** See §7.

**5. `FLOW_PRUNE_ENABLED` is unarmed in production, so the largest stored artifact
of licensed vendor data in the system grows without bound.** E-04 §6 found the prune
written, wired and defaulting off (`api/flow_db.py:58`). The flow-worker's variable
list (ORCH-RAILWAY-01) contains `FLOW_BACKUP_ENABLED`, `FLOW_CSV_CAP_DAYS`,
`FLOW_TAPE_SPOOL_RETENTION_HOURS` and seven other `FLOW_*` names — **and no
`FLOW_PRUNE_ENABLED`**. The code-level finding is now a configuration-level one: a
full-tape `T.*` OPRA archive of unbounded age, on a vendor whose public terms
contain no storage clause at all.

**6. `AI_SEARCH_CLAUDE_SYNTH=1` in production, so the AI surface is wider than
D-12 could establish.** D-12 §2a recorded the code default `"0"` and flagged the
consequence: if off, *"every member AI-Search answer today is written by Perplexity
`sonar-pro`, not by Claude — which changes … the licensing analysis (E-02)
materially."* It is on. Desk context packs — Massive quotes, regime, flow, FMP
fundamentals, analyst, insider, earnings — reach Anthropic on the default member
lane, not only on the opt-in agent lane. Combined with Anthropic §L.1 (UCT warrants
it has the rights to every Input), this widens the warranty surface to the busiest
AI lane in the product.

**And the one negative I measured myself.** A case-insensitive sweep of `app/src/`
and `api/` for `delayed 15` · `15 minutes delayed` · `Del-15` · `data delayed` ·
`nonprofessional` · `non-professional` · `subscriber agreement` returns **zero
files**. The same sweep for `not endorsed or certified` and `Federal Reserve Bank of
St` returns **zero files**. So: the UTP delayed-data escape route (§7) requires UI
that does not exist, there is no non-professional attestation anywhere (reproducing
E-03 §2.1), and FRED's mandatory notice is absent (reproducing E-04 §3.4b). All
three are new-build items, not toggles.

---

## 2. THE MASTER TABLE (Q1)

Rows are (provider, data class). Cells are the class codes from §0. Where a cell
depends on the Massive tier or the FMP DDLA it reads `without / with`.

### 2.1 Massive (ex-Polygon.io) — 20 of 29 derived products depend on this one vendor

| Data class | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| Equities trades / last sale | R / LA | R / LA | R / LA | R / LA | R / LA | R / LA | **R / R** |
| Equities quotes (NBBO, snapshots) | R / LA | R / LA | R / LA | R / LA | R / LA | R / LA | **R / R** |
| Equities aggregates (bars, all TFs) | R / LA | R / LA | R / LA | R / LA | R / LA | R / LA | **R / R** |
| — of which: **developing intraday bar** (`/api/stream/bars`) | R / LA | R / LA | R / LA | R / LA | n/a | R / LA | **R / R** |
| — of which: **daily/weekly/monthly history** | R / LA | R / LA | R / LA | R / LA | R / LA | R / LA | **R / R** |
| Options trades — **OPRA tape** (`T.*` wildcard) | R / **U** | R / **U** | R / **U** | R / **U** | R / **U** | R / **U** | **R / R** |
| Options quotes / NBBO histogram | R / **U** | R / **U** | R / **U** | R / **U** | R / **U** | R / **U** | **R / R** |
| Options chain + Greeks + IV | R / LA | R / LA | R / LA | R / LA | R / LA | R / LA | **R / R** |
| Dark pool — T+1 SIP flat files | R / LA | R / LA | R / LA | R / LA | R / LA | R / LA | **R / R** |
| Dark pool — same-day `/v3/trades` lane | R / **U** | R / **U** | R / **U** | R / **U** | R / **U** | R / **U** | **R / R** |
| Snapshots (movers, gainers/losers, index) | R / LA | R / LA | R / LA | R / LA | R / LA | R / LA | **R / R** |
| Reference (tickers, splits, dividends, conditions) | R / LA | R / LA | R / LA | R / LA | R / LA | R / LA | R / LA |
| Massive news (`/v2/reference/news`) | R / LA | R / LA | R / LA | R / LA | R / LA | R / LA | **R / R** |
| **Composites that name §6.1(j) shapes** — UCT20 portfolio **NAV**, Exposure Rating (an *index* / *indicative value*), published entry/stop/target (an *investment strategy*) | R / **R** | R / **R** | R / **R** | R / **R** | R / **R** | R / **R** | **R / R** |

**Driving clauses.** Individuals: P1 §1 (*"personal, non-business, and
non-commercial"*), §2 (*"may not be … publicly displayed … or distributed in any
way"*, *"strictly for display use only"*), §3 (Non-Professional warranty **plus an
indemnity**), §5(c) Derived Works, §5(d) non-display + derivative works, §4 (the
account holder is deemed to enter the OPRA / UTP / NYSE subscriber agreements
personally). Businesses: P3 §2.2 (access, receive, process, transmit, **store**, use
*"solely for its use in websites or software applications owned or licensed by
Customer"*), §6.1(e) + the Edge Users definition, §6.1(j) enumerated derivative-works
bar, §6.1(k) proprietary-notice preservation, §6.1(l) no Edge User PII to Massive,
§2.5 Third-Party Agreements. Deletion on termination: P1 §10 / P3 §11.4. **No caching
clause and no AI/ML clause exists in P1–P6** (E-04 §3.1) — AI use is governed by the
derivative-works clauses, and storage is governed by §2.2's express grant at the
Business tier and by nothing at all at the Individual tier.

**What flips it.** One fact: **the Massive plan tier**, from the billing account.
Secondarily, for the four **U** rows: whether the Business agreement's grant names
**customer-facing display of OPRA data** (§2.5 Third-Party Agreements are not
published) and whether the same-day `/v3/trades` lane runs inside or outside the
15-minute delay interval (measurable in code; not measured by this pod).

**Why the external-publication column stays R even at the Business tier.** Edge
Users are *"users of Customer's products and services"*. A viewer of an
unauthenticated `GET /api/flow-scoreboard`, a member of the public Discord `#TSDR`
channel, a public YouTube viewer and a free-tier Substack reader are users of
nothing. **This column survives the tier answer, which is what makes it the
actionable half of this table.**

**Why the composites row stays R even at the Business tier.** §6.1(j) enumerates
*"any index, indicative value, net asset value, investment product, financial
contract … settlement value or investment strategy"*. UCT computes a portfolio
**NAV** (`api/services/uct20_nav.py compute_portfolio_returns()`), a 0–150 exposure
**score** that behaves as an indicative value, and publishes entry/stop/target on
named tickers. Those three are closer to the enumerated list than to "analytics",
and they are exactly the outputs the product is organised around. This is a
**specific written question**, not an assumption either way.

**CONFIDENCE.** 🟢 on the clause text (E-01/E-04 quoted primary, dated documents).
🔴 on the tier. **EVIDENCE CEILING:** the account page or one invoice. **That single
lookup re-classifies more of this document than any other action available.**

**OPEN QUESTION.** Does the Business agreement's grant reach **Derived Works**
(charts, analytics, breadth) or only display of the underlying data? E-03 §4.4A is
right that a display licence which does not clearly cover multi-symbol analytics
would leave UCT's best-margin lane exactly where it is now.

### 2.2 FMP — the clause that does not care about derivation

| Data class | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| Statements / fundamentals / ratios | **R** / LA | **R** / LA | R / LA¹ | R / LA¹ | R / LA | U / U | R / **R**² |
| Analyst estimates, grades, price targets | **R** / LA | **R** / LA | R / LA¹ | R / LA¹ | R / LA | U / U | R / **R**² |
| Earnings calendar (forward) | **R** / LA | **R** / LA | R / LA¹ | R / LA¹ | R / LA | U / U | R / **R**² |
| Earnings history / surprises | **R** / LA | **R** / LA | R / LA¹ | R / LA¹ | R / LA | U / U | R / **R**² |
| Economic calendar | **R** / LA | **R** / LA | R / LA¹ | R / LA¹ | R / LA | U / U | R / **R**² |
| News / press releases | **R** / LA | **R** / LA | R / LA¹ | R / LA¹ | R / LA | U / U | R / **R**² |
| **Earnings-call transcripts (verbatim body)** | **R** / LA | **R** / LA | **R** / U¹ | **R** / U¹ | R / LA | **U — the sharpest AI row** | R / **R**² |
| Intraday bars fallback (`historical-chart/{interval}`) | **R** / LA | **R** / LA | R / LA¹ | R / LA¹ | R / LA | U / U | R / **R**² |
| Institutional ownership / insider trading | **R** / LA | **R** / LA | R / LA¹ | R / LA¹ | R / LA | U / U | R / **R**² |
| ETF holdings / index constituents | **R** / LA | **R** / LA | R / LA¹ | R / LA¹ | R / LA | U / U | R / **R**² |
| **Analyst actions of TheFly origin, via `grades-latest-news`** | **R** / U | **R** / U | R / U | R / U | R / U | U / U | **R / U** — see §2.9 |

¹ Even with a DDLA, storage and caching carry live obligations rather than a clean
grant: **§6.3** requires deleting all FMP Data on termination *"including data
cached"*, signing a **Data Deletion Agreement (Exhibit A)**, and submitting to an
**audit right**; **§2.8** requires UCT to *"notify FMP of the IP and domain aliases
of any location where data is stored or processed"*. Nothing in this pod suggests
that notification has ever been made.
² **Attribution is not available as the remedy.** §10.4: *"Customer may not identify
FMP as the source of the Data to any third party without FMP's prior written
consent."* The instinctive fix for a display concern is closed off by the same
contract.

**Driving clauses.** §2.2.2 Data Display (the sharpest single clause in the pod's
evidence — it turns on *display to multiple individuals*, not on derivation, and
forecloses both the "it's free" and the "it's internal" escapes); §2.2.1 Personal
Use; §2.6.1(i) no providing *"data or information contained in or **derived from**
The Services"* to any third party; §11.1 FMP claims the IP in derived information;
§6.3 deletion incl. cache; §2.8 storage-location notification; §10.4 attribution
restriction; §2.6.2 incorporates an **Acceptable Data Use Policy whose URL 404s**.

**Why desk display is R and not LA.** §2.2.2 says *"whether it pertains to internal
or external organizational purposes"*, and §2.2.1 says a personal-use licence *"may
not be used on behalf of a company, partnership, organization"*. There is no
internal-use carve-out to retreat to.

**What flips it.** One artifact: a signed **Data Display and Licensing Agreement**.
FMP sells it; the remedy here is a contract, not a re-architecture — which makes FMP
the cheapest large block in this table to convert. Ask for the ADUP text in the same
email (a term incorporated by reference, whose breach is defined as material, and
whose text does not resolve publicly, cannot be complied with by reading).

**CONFIDENCE.** 🟢 on clause text. 🔴 on whether a DDLA exists.

### 2.3 Finviz Elite — the register's largest irreducible Unknown

| Data class | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| Screener export — universe rows | U | U | U | U | U | U | U |
| Screener export — **float / short interest / ownership columns** | U | **U (single-sourced)** | U | U | U | U | U |
| Sessions / real-time Elite data | U | U | U | U | U | U | U |
| **Chart images (`chart.ashx` PNGs) served to members** | U | **U, leaning R** | U | U | n/a | n/a | **U, leaning R** |
| Industry map / news export | U | U | U | U | U | U | U |

**Driving clause: there isn't one.** Finviz publishes **no Terms of Use, Terms of
Service or user agreement** from any public entry point — confirmed from four
(E-01 §3) plus a Wayback check showing zero historical snapshots of
`finviz.com/terms.ashx` (E-04 §3.4b), which suggests the URL never existed rather
than having been retired. The two machine-readable signals both point away from
permission: `robots.txt` disallows `/export`, `/chart`, `/image` and
`/api/v1/screener-export-csv` — **the exact four path families UCT uses** — and the
one substantive Finviz statement located is *"We are not allowed to sell raw
historical data to third parties"*, which is Finviz describing a constraint imposed
on **Finviz** by **its** licensors. An intermediary that cannot resell raw history
is unlikely to be positioned to license its subscriber's onward redistribution.

**Reachability is not a licence.** The export endpoint answering a key is not a
grant. `robots.txt` binds crawlers rather than authenticated API clients, so this is
a signal about intent, not a breach — but combined with the total absence of terms
it means the **Elite subscription agreement is the only place a grant could live,
and nobody in this pod has seen it.**

**Two different shapes, and they should not share a register row.** (a) Finviz
export values used as an **internal input** to UCT's own scanner is the lower-risk
half. (b) Serving Finviz's **rendered chart PNGs** into member-facing pages
republishes Finviz's own work product to third parties, which is the higher-risk
half and the one to retire first if the answer is unfavourable.

**The coverage consequence, which is the part a product plan must price.**
`api/services/screener/finviz_universe.py` is the **only** source of short interest
in the product (D-03 §5: *"single-sourced, nightly-only, and known-sparse"*, no
history at all, with `ai_search._short_interest_missing` existing to route around
the sparseness). A Finviz "no" is therefore not a swap — it is a **capability
deletion** with no second vendor in the stack.

**What flips it.** The agreement presented at Elite purchase — retrievable by the
owner from the account or the purchase-confirmation email. Nothing else in this
document has so large a class-change riding on so cheap an action.

### 2.4 Finnhub — the broadest "derived results" bar, on what the code calls the free tier

| Data class | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| Real-time trade ticks (WebSocket) | **R** | **R** | R | R | R | R | **R** |
| Earnings calendar / past-day backfill | **R** | **R** | R | R | R | R | **R** |
| Company profile / metrics / logo | **R** | **R** | R | R | R | R | **R** |
| Insider transactions | **R** | **R** | R | R | R | R | **R** |
| IPO calendar | **R** | **R** | R | R | R | R | **R** |
| Recommendations / price targets (**403 on this plan**) | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Transcript index (**403 on this plan**) | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

**Driving clauses.** *"You hereby agree to not redistribute or share access to data
**or derived results from the data** obtained from Finnhub with anyone or any 3rd
party without written approval"*; *"All plan listed on Finnhub website is strictly
for personal use unless explicitly stated otherwise"*; *"Personal plan can't be used
by any business **even internally** without a written approval"*; *"All data must be
deleted should your subscription to that data ends"*; plus a securities-professional
disqualifier.

**Why desk display is R.** *"even internally"* closes the internal escape
explicitly. Finnhub is one of the three vendors where a desk-only design does not
help.

**"Derived results" is undefined and unbounded** — no non-reversibility test, no
aggregation threshold, no materiality carve-out. On its face it reaches a computed
score as readily as a raw quote.

**The row that matters most is row 1.** `api/services/realtime_stream.py:24`
(`wss://ws.finnhub.io`) is the primary live-price tick source for every quote tile,
and `api/routers/stream.py:25` reads `MAX_SSE_TICKERS = 50  # Finnhub free tier cap`
— the code's own tell about the tier. **The most-restricted provider in the stack is
on the least-visible, always-on surface.** ⚠️ Note that `CLAUDE.md` claims this
stream is Massive/Polygon; the code says Finnhub (E-03 §1.1 EVIDENCE row 2). The
register must carry the code, not the doc.

**What flips it.** A written Finnhub commercial approval, or a paid plan that says
otherwise in writing. **But the cheapest resolution is retirement, not
negotiation** — E-03 §3.2 and E-04 §3.3 converge independently on this: the same
tick data already comes from Massive (`api/services/bar_stream.py`, snapshot API),
and D-03 §5 shows Finnhub is already a degrading leg carrying two permanently-403
endpoints. Consolidating quotes onto the vendor that will hold the redistribution
agreement removes an entire vendor's terms from the surface area at no product cost.

### 2.5 Alpha Vantage — settled at the licence-grant level; no tier to look up

| Data class | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| News + sentiment (`NEWS_SENTIMENT`) | **R** | **R** | **R** | **R** | **R** | **R** | **R** |
| **Earnings-call transcripts (verbatim body)** | **R** | **R** | **R** | **R** | **R** | **R** | **R** |
| Economic indicators / commodities | **R** + FRED flow-down | **R** | **R** | **R** | **R** | **R** | **R** |

**Driving clause.** §2(a): the licence is *"for personal, non-commercial use, unless
you and Alpha Vantage have agreed otherwise in writing"*, and commercial use is
defined to include **(ii)** using the platform *"as or on behalf of a corporation,
firm, partnership, trust or any other association and not as an individual"* and
**(iii)** *"any type of commercial activity that allows individuals or entities
other than User to access information directly or indirectly"*. **Two limbs catch
UCT independently.** §20 imports the FRED API Terms onto AV's economic and
commodities endpoints — a transitive obligation that is easy to miss because the
code path says "AlphaVantage".

**The free tier is not a mitigating fact here; it is the statement of the problem.**
`api/services/alphavantage_client.py` exists as a 25-request-per-**day** budget
broker because seven call sites were spending one personal-tier allowance — the
engineering note and the licensing fact are the same fact from two angles.

**What flips it.** A written commercial agreement (`premium@alphavantage.co`) — **or
retirement, which is close to free**: FMP is already primary for transcripts
(`api/services/transcripts.py:12-20`, promoted 2026-08-05) and RSS already backs the
news feed. This is the cheapest fully-resolvable row in the register.

### 2.6 FRED — two documents in tension, and currently inert in production

| Data class | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| Public-domain series (*Citation requested*) | LA† | LA† | **R** | **R** | LA† | **U** | LA† (newsletters expressly permitted) |
| *Citation required* copyright tier | LA† | LA† | **R** | **R** | LA† | **U** | LA† (newsletters expressly permitted) |
| *Pre-approval required* copyright tier (e.g. Visa SMI) | **R** | **R** | **R** | **R** | **R** | **R** | **R** |
| **Which of UCT's ~30 catalog series sit in which tier** | **NOT DETERMINED** | NOT DETERMINED | NOT DETERMINED | NOT DETERMINED | NOT DETERMINED | NOT DETERMINED | NOT DETERMINED |

† Conditional on three concrete deliverables UCT owes and does not currently
provide: (1) the exact sentence *"This product uses the FRED® API but is not
endorsed or certified by the Federal Reserve Bank of St. Louis"* placed
*"prominently"*; (2) a link to the FRED Terms plus a clause in UCT's own terms
binding members to them; (3) a **per-series** copyright check before republishing
any series whose notes contain "Copyright". Item (3) cannot be discharged once —
every series added later re-opens it.

**The tension, which should not be resolved by picking the favourable side.** The
Legal Notices §Prohibitions ban storing, caching or archiving *"any portion"* of
FRED Content and ban use *"in connection with the development or training of any
software program or system or machine learning, including … large language
models"*, with the framing sentence *"All use of FRED data—including
non-commercial, educational, and personal use—is subject to the following
prohibitions."* The FRED® Graphs License simultaneously grants a right to *"display
and reproduce the charts and graphs, and to permit others to, publish, reproduce and
distribute"* them, and §IV Commercial Use expressly permits newsletters for two of
the three copyright tiers with attribution.

**Production state changes the register entry.** `FRED_API_KEY` is absent on every
Railway service (ORCH-RAILWAY-01), and `api/services/fred_economic.py:105-111`
returns an error dict without it. D-03 §3.4 independently records FRED as reachable
only from a voice tool and an options risk-free-rate fallback, with **no page
consuming it**. So the caching collision, the LLM collision and the missing notice
describe a **dormant** lane. Register this as *"code path Restricted if armed;
currently not in use"* — and note that arming it is a one-variable action that would
make three collisions live simultaneously.

**What flips it.** (a) An owner decision to arm or retire the lane deliberately;
(b) thirty `fred/series/search` lookups, which settle the copyright tier of the whole
catalog properly (⚠️ E-04 §7 records and **retracts** an earlier guess at three
specific series — do not reintroduce it); (c) counsel's read on whether *"in
connection with … development or training"* reaches inference-time prompting.

### 2.7 twitterapi.io / X — a reseller that grants nothing, and three measurable collisions

| Data class | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| Tweet text (curated accounts) | **R** | **R** — display requirements **measurably unmet** | **R** — no deletion-sync | R | LA | **U** (inference) | **R** |
| Tweet text (`advanced_search` per candidate) | **R** | **R** | **R** | R | LA | **U** | **R** |
| Cashtag-derived counts / signals (no text) | LA | LA | LA | LA | LA | LA | LA |
| **Training any model on X content** | **X** | **X** | **X** | **X** | **X** | **X** | **X** |

**Driving clauses.** twitterapi.io §4 grants no content licence and pushes
compliance downstream: *"Ensure that your use of the Service does not violate the
rights of third parties, including X/Twitter's terms of service."* **A reseller
cannot grant more than it holds, and this one does not claim to.** So the governing
document is X's: Developer Agreement §III.A(d) (no redistribution to third parties),
§III.A(k) (no using X API or X Content *"to fine-tune or train a foundation or
frontier model"*), §IV.B / Developer Policy (delete or modify stored content *"as
soon as reasonably possible, or within 24 hours"* of it being deleted or modified on
X; if providing X Content to third parties, *"you may only distribute Post IDs …
and/or User IDs"*), and the Display Requirements (author avatar, @username, display
name linking to the profile; timestamp linking to the permalink; the X logo).

⚠️ **Applicability is genuinely unsettled** and both readings are unfavourable: UCT
has no direct X developer account and reaches X content through a scraper. Whether
the Developer Agreement binds an indirect consumer, or whether the exposure instead
runs to X's general anti-scraping provisions, is a counsel question this pod cannot
answer.

**Three collisions, all CONFIRMED in code by E-04 §3.4b, all live** (`TWITTERAPI_IO_ENABLED=1`
on `web` per ORCH-RAILWAY-01):
1. **Display requirements unmet** — `app/src/components/tiles/TapeFeed.jsx:53-68`
   renders the text, a *relative* time, and a `↗`. No @username, no display name, no
   avatar, no X logo, no permalink timestamp. A UI fix, not an architectural one.
2. **No deletion-sync** — `api/services/tweet_cleanup.py:12` implements only
   `delete_tweets_older_than(days=7)`. A time sweep is not the same guarantee as
   delete-within-24-hours-of-deletion-on-X. The 7-day window bounds the exposure to a
   week, which is a real mitigation — but it is a coincidence of the retention design,
   not a response to the obligation.
3. **The window is defeated downstream** — `api/services/catalyst/engine.py:1163-1165`
   writes verbatim tweet bodies (and third-party RSS items) into `catalysts.db`'s
   `raw_signals` column, and `catalysts.db` never prunes. **One store honours the
   7-day window and another quietly keeps the same bodies forever.** This needs no
   vendor's answer to be worth fixing.

**AI processing is U, not R.** §III.A(k) reads to *training*, and UCT's catalyst
engine passes tweet text to Claude as inference context. That is the better side of
the line on the clause's face — but it is exactly the line a vendor may read more
broadly than a customer does, so it is flagged rather than resolved.

**What flips it.** For the three collisions: nothing external — they are code
decisions available today. For the display and redistribution questions: counsel's
read on whether the Developer Agreement binds an indirect consumer, and whether any
direct X developer relationship is wanted.

### 2.8 Reddit — commercial use needs a separate agreement; dormant in production

| Data class | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| Subreddit posts / comments (PRAW) | R | R | R | R | R | **U** (inference) / **X** (training) | R |

**Driving clauses.** Data API Terms §3.1: commercial purposes *"will need to enter
into a separate agreement with Reddit"*. §2: no right to use User Content *"for
other purposes, such as for training a machine learning or AI model, without the
express permission of rightsholders"*. §Termination reaches *"any data or models
that were derived from User Content"*. `reddit.com/robots.txt` is a blanket
`Disallow: /`, so the Data API is the only permitted channel.

**Production state.** `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` are absent on
every Railway service (ORCH-RAILWAY-01); `api/services/reddit_sentiment.py`
degrades to *"not configured"*; D-03 §3.4 finds the lane reachable only from a voice
tool with **no page surface**. Register as *"Restricted if armed; not in use"*.

**What flips it.** Whether a Reddit commercial agreement exists (almost certainly
not). **Default: leave it unwired.** The cheapest answer for Terminal-Next is that
this row never becomes live.

### 2.9 TheFly — Unsuitable direct, and a live sublicence chain nobody named

| Path | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| **Direct** (`THEFLY_API_KEY`, consumer subscription) | **X** | **X** | **X** | **X** | **X** | **X** | **X** |
| Direct under an unseen **syndication/licensing** agreement | U | U | U | U | U | U | U |
| **Indirect: TheFly-origin analyst actions arriving via FMP `grades-latest-news`** | **R / U** | **R / U** | R / U | R / U | R / U | U | **R / U** — published to the paid Substack today |

**Driving clauses (direct).** *"ANY COMMERCIAL USE OF THE CONTENT AND ONLINE
SERVICES IS STRICTLY FORBIDDEN"*; *"not permitted to use the Online Services for the
purpose of regularly providing other users with access to Content"*; *"Only one
individual may access the Online Services at the same time using the same username
or password"*; *"you may not use articles you have downloaded for personal use to
develop or operate an automated trading system or **for data or text mining**"*; no
displaying, posting, framing or scraping for use on another website. `thefly.com/robots.txt`
sets `Content-Signal: search=yes,ai-train=no,use=reference` and gives `ClaudeBot`,
`GPTBot`, `CCBot`, `Google-Extended` and `meta-externalagent` each `Disallow: /`
(with `ai-input` **unset**, which under the file's own vocabulary leaves
summarization/RAG neither granted nor restricted).

**Production state, and the finding that matters.** `THEFLY_API_KEY` is absent on
every Railway service, and `morning-wire/thefly.py:5-11` states in-file that
`fetch_analyst_actions()` was removed on 2026-07-29 because the vars were never
populated. **But the data still arrives**: *"TheFly's data still reaches the wire:
FMP's grades feed is sourced from thefly.com"*, via `morning-wire/analyst_feed.py:19-20`
(*"FMP `/stable/grades-latest-news` … aggregates TheFly + StreetInsider. ★
backbone"*). So analyst upgrades/downgrades originate at TheFly, arrive through FMP,
are summarized by an LLM, and are published to a paid Substack. **UCT's licence is
with FMP; FMP's licence is with TheFly; UCT cannot see the middle link.**

**What flips it.** Ask FMP, in the same email as the DDLA and the transcript
question: *does FMP's licence to UCT cover redistributing TheFly-sourced analyst
actions in a paid newsletter?* This is normal aggregator business and is usually
fine — the point is that it should be **named** rather than discovered later.

### 2.10 Yahoo / yfinance — the only rows where "verify the contract" is not a move

| Data class | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| Intraday + daily bars fallback | **X** | **X** | **X** | **X** | **X** | **X** | **X** |
| Index / futures / crypto snapshots (`^GSPC`, `^VIX`, BTC, NQ/ES/RTY) | **X** | **X** | **X** | **X** | **X** | **X** | **X** |
| `.info` fundamentals, ownership, short interest, dividends, estimates | **X** | **X** | **X** | **X** | **X** | **X** | **X** |
| Options chain + locally-computed Black-Scholes Greeks | **X** | **X** | **X** | **X** | **X** | **X** | **X** |
| **EOD breadth row — the authoritative daily record** | **X** | **X** | **X** | **X** | **X** | **X** | **X** |

**Driving clauses.** Yahoo ToS §2.4(ix) (no automated collection *"using any
automated means … robots, spiders, scrapers, data mining tools"*), §2.5 (no
commercial reuse), §2.8 (no reproduction, distribution or derivative works for
commercial purposes), §2.4(x) (no using content *"to create any database, archive …
data feed, widget or any other aggregated data source that competes with or
constitutes a material substitute for the Services"*). **All four are independently
engaged by a scraper feeding a paid product.**

**Why X and not R.** Every other vendor here has a purchasable commercial tier; the
question there is *which* tier. **Yahoo does not sell a retail market-data
redistribution licence for this at any price**, and `yfinance` is an unofficial
third-party library whose own Apache-2.0 licence governs the **code**, not the
**data** — a distinction that regularly gets conflated. There is no agreement to get
on the right side of.

**Blast radius, which is the part that makes this a programme rather than a
cleanup.** 24 modules in `api/**` import `yfinance` directly (E-04 §9 Observation B,
`grep -rln` count). The member-facing ones include `fundamentals.py`,
`research/{estimates,financials,ownership}.py`, `institutional_holdings.py`,
`short_interest.py`, `earnings_table.py`, `dividends_calendar.py`,
`options_chain.py` and `setup_grade.py`. And **the authoritative EOD breadth row —
the input to the Exposure Rating the whole product is organised around — is built
from `yf.download(..., auto_adjust=True)`** in `uct-intelligence/scripts/breadth_collector.py:377,776,1986`.
The existing guard (`api/services/yf_util.py` bounded calls + circuit breaker, with
an AST census rail) is a **reliability** guard, not a licensing one.

**Also a silent-exposure shape.** The bars path is a *fallback*: invisible when
Massive works, serving members when it doesn't. Intermittent and unmonitored is the
worst combination for a use you would have to describe accurately in an audit.

**What flips it.** Nothing contractual — this is a build decision. Most of the 24
call sites fetch reference data FMP already serves in the same codebase
(`api/services/screener/fundamentals_bulk.py` pulls ten whole-market columns in six
requests). **The genuinely hard one is the breadth collector's dividend-adjusted
history**, because the adjustment basis is baked into every stored level and
`bars.db` is split-adjusted only. Treat that as its own project, not as part of a
sweep.

### 2.11 Schwab — one account holder's entitlement, fanned out to the membership

| Data class | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| Option chains + Greeks + OI | U | **U, leaning R** | U | U | **U, leaning R** | U | **U, leaning R** |
| Quotes | U | **U, leaning R** | U | U | U | U | **U, leaning R** |
| **Member account data** (positions, activities, balances) — *arrives via SnapTrade, not Schwab's API* | LA | LA (the member's own data, to that member) | LA | LA | LA | LA | **R** — SnapTrade Developer Terms |

**Why "leaning R" rather than a clean class.** The terms are **NOT DETERMINED**:
`developer.schwab.com` returned HTTP 403 to every fetch and the Market Data
Agreement sits behind a developer login no agent attempted. What *is* known is the
architecture, and it makes the question unusually crisp: `api/schwab_service.py:33-37`
persists **one process-wide OAuth token** at `/data/schwab_token.json`, and
`api/gex_service.py:33` + `api/gex_router.py:11` serve chain-derived analytics from
it to every member with **no auth dependency on the route**. There is no sense in
which each member is "the account holder". Schwab's public subscriber language —
non-professional subscribers receive data *"solely for their personal, non-business
use"* and *"shall not furnish market data to any other person or entity"* — describes
exactly this shape, and Schwab's developer programme separates an **Individual
Developer** path (free, tied to a personal brokerage account) from a **Commercial /
Redistribution** path requiring Schwab review **and exchange-data agreements**.

**Schwab is also the one vendor where the professional/non-professional subscriber
classification and named exchange fees (NYSE / CTA / CQ / NASDAQ) are squarely in
play**, because Schwab passes through exchange entitlements. If Schwab market data
reached a member surface under those terms, each member would arguably need their own
subscriber classification — a per-user compliance model UCT does not have and has
never asked for (§1, the zero-hit attestation sweep).

**The realistic path is re-sourcing, not licensing.** Schwab does not sell a
market-data redistribution product to a media/education business the way Massive
does. Massive sells options chains and Greeks, and `api/services/polygon_options.py`
already implements that path natively. E-03 §3.3 and D-03 §5 reach this conclusion
independently.

⚠️ `api/schwab_router.py` and `OptionsFlow.jsx` are **partner-owned**. This belongs
to the owner as a **sourcing question** — *"can GEX be rebuilt on the redistribution
vendor's chains?"* — not as a change request against a partner file.

**SnapTrade caveat on the account-data row.** SnapTrade's Developer Terms prohibit
mining, re-selling or re-packaging End User data obtained via the API to third
parties *"without the express written consent of both the End User and SnapTrade"*.
That bars onward **use**, not merely onward sale — so any Terminal-Next surface that
aggregates member broker data across members (a leaderboard, a "what the room owns"
tile, an AI trained on member fills) is **R** until both consents exist.

### 2.12 CFTC COT, SEC EDGAR, and UCT's own Discord content

| Source | Desk display | Member display | Storage / history | Caching | Derived analytics | AI processing | External publication |
|---|---|---|---|---|---|---|---|
| **CFTC COT** (public zips) | **A** | **A** | **A** | **A** | **A** | **A** | **A** |
| **SEC EDGAR** (filings, full-text search) | **A** | **A** | **A** | **A** | **A** | **A** | **A** |
| **Discord — `/buzz` counts + jump links (no text stored)** | **A** | **A** | **A** | **A** | **A** | **A** | **A** |
| **Discord — the 7,766-message classified `#tsdr` corpus (text + author ids)** | LA | **U** | **U** | LA | LA | **U** | **U** |
| **The Floor / community board content (member-authored)** | LA | LA | LA | LA | LA | **U** | **U** |

**Why A.** CFTC and SEC are US Government works in the public domain. SEC's
descriptive-User-Agent requirement and ~10 req/s fair-access limit are access
etiquette, not display restrictions. `api/services/buzz_store.py:3-6` stores
**no message text** by design — *"`message_id` + `channel_id` reconstruct a Discord
jump link, which stays true when a member edits or deletes; a stored copy would not"*.
**This is the one deliberate data minimisation in the codebase, and it is on the only
input that is not a licensed vendor feed** — a symmetry worth naming, because the
same instinct applied to `catalysts.db`'s `raw_signals` would close §2.7's third
collision.

**The COT lane is the cleanest AI surface in the product** and should be the
template: public-domain input, a facts module that is *"the ONLY numbers the LLM may
cite"* (`app/src/pages/cot/cotFacts.js`), and a grounding gate that stores nothing
when a number in the prose is not in the facts. No vendor licence is engaged at any
step.

**Why the `#tsdr` corpus is U.** The constraint here is **not** a market-data
licence — it is member consent, privacy, and Discord's own terms. The export carries
message text and author ids (D-13 §9a: 7,766 classified messages, 2024-03-11 →
2026-02-20, plus a derived rules corpus), 591 rows of it are already promoted into
the engine KB (`intake:discord_tsdr`), and **the engine KB ships to Railway as the
Brain Pack**, which means member-authored text rides into a member-facing RAG. D-13's
open question is the right one and it is unanswered: *what consent basis covers the
export, and does it extend to using member messages in a product surface rather than
an internal RAG?*

### 2.13 The LLM providers as processors

| Provider | Role | Class | Driving clause |
|---|---|---|---|
| **Anthropic** | Every Claude lane: catalysts, transcripts, call recap, AI Search synth/agent/deep, Compass, COT, wire, Desk, theme engine, Model Book | **LA — conditioned on §L.1** | §B *"Anthropic may not train models on Customer Content from Services"*; §B assigns Output to Customer; §A.1 expressly contemplates *"power[ing] products and services Customer makes available to its own customers and end users"*; §D.4 no resale of the Services; **§L.1 Customer *"has all rights and permissions required to submit Inputs"*** |
| **OpenAI** | Whisper STT, `gpt-4o-mini` cleanup/intent, `gpt-realtime`, `gpt-4o` chart vision, `tts-1`, `text-embedding-3-small`, `gpt-image-1` covers | **U** | Primary terms unreachable (403 to every path). Secondary: no training on business/API inputs by default; inputs/outputs removed after 30 days unless legally required; ZDR available for eligible endpoints. Nothing looks like a blocker; "looks like" is doing real work in that sentence |
| **Perplexity** | Catalyst discovery + enrichment (3 query variants + 4 enrichment shapes), AI Search fast lane (`sonar-pro`), earnings deep-dive, sector framing, morning-wire enrichment | **U — and one specific R** | Secondary: customers may *"display such Output solely within Customer Applications"*. In-app display fits. **Perplexity-derived text that leaves the app** — into the paid Substack wire, the Sunday Scans free tier, or a Discord post — is not obviously *"within Customer Applications"*, and Perplexity Output routinely quotes source material where **citation is not permission** |
| **Anthropic *subscription seat*** (`claude -p`, off-box) | `C:\Users\Patrick\uct-recaps\desk_insights_polish.py` rewrites Desk headline / summary / chapter titles, pushed to the YouTube description and the Desk player | **U — owner question** | The product already knows the rule: `api/services/discord_close_note.py:17-25` records that the index-close note *"RUNS ON THE API KEY, NEVER THE SUBSCRIPTION SEAT … Anthropic's legal terms … do not permit routing requests through Pro/Max plan credentials on behalf of your users."* The polish script is **not member request traffic** (nobody waits on it), so it does not breach that rule as stated — but it **produces artifacts the public consumes**. Two lanes, one doctrine, opposite answers |

**⭐ §L.1 is the single most important cross-vendor clause in this document, and it
is invisible if each vendor is assessed alone.** Anthropic is permissive about its
own service and then makes UCT warrant that it had the right to submit every Input.
So FMP's display ban, Finnhub's *"derived results"* ban, TheFly's text-mining ban,
X's content rules and AV's commercial-use definition **all re-attach at the prompt
boundary**. The AI vendor is permissive; **the AI pipeline inherits the strictness of
its worst-licensed input.**

**Consequence for the register, stated once:** a field that is never rendered but
*is* sent to a model is still a §L.1 exposure. Any map drawn over rendered pixels
alone will miss the entire AI column of this table.

---

## 3. THE TWO SCENARIOS (Q2) — what each owner answer actually buys

### 3.1 Massive: Individual tier vs Business tier

| | **If Individual (Basic / Starter / Developer / Advanced)** | **If Business / Enterprise** |
|---|---|---|
| Member display of quotes, bars, snapshots, chains | **R** — P1 §1 + §2; no reading works for a paid multi-user product | **LA** — §6.1(e) Edge Users |
| Storage of `bars.db`, `flow.db`, R2 snapshots | **R / no grant** — P1 is silent on storage and §2 is display-only | **LA** — §2.2 expressly grants `store`; **the only express storage right at any vendor in this stack** |
| Caching (memory, disk, SQLite, browser IDB) | **R / no grant** | **LA** — same clause |
| Derived analytics (breadth, RS, correlation, patterns, base structures, sector flow) | **R** — §5(c) reaches *"charts, analytics, research"*; **broader than the exchange plans, which make multi-security derived data fee-free** | **LA** — §6.1(j) is enumerated and narrow, and most of the inventory sits outside it |
| UCT20 NAV · Exposure Rating · published entry/stop/target | **R** | **R** — §6.1(j) names *net asset value*, *index*, *indicative value*, *investment strategy*. Needs a specific written answer either way |
| AI processing over Massive data | **R** — an LLM output over the data is a work *"derived from"* it | **LA** — plus the §L.1 warranty |
| External publication (public Discord, public YouTube, free Substack, unauthenticated `/api/flow-scoreboard`, `/r/*`) | **R** | **R** — Edge Users are *users of Customer's products*; the public is not |
| Desk-only raw display | **R** — §3 makes commercial **purpose** the disqualifier, *"even if … on behalf of an organization not in the securities industry"*, **and** attaches an indemnity | **LA** — Authorized Users under §2.1 |
| Exchange-fee exposure | Deemed to have entered the OPRA / UTP / NYSE subscriber agreements **personally** (P1 §4) | Business page: *"no exchange fees or approvals required"* on the stocks plan; options business pricing carries *"Additional exchange fees"* |
| Rough public price point | $0 – $199/mo | Stocks Business **from $2,499/mo**; options priced separately |
| **What it means for Terminal-Next** | **Stop and re-plan.** No delay banner, no aggregation and no desk-only design fixes this — the constraint is the licence, not the exchange fee | **The remaining work is narrow and specific**: the public surfaces (§6), the §6.1(j) composites question, and the OPRA sub-agreement (§2.5) |

⭐ **The counter-intuitive result worth carrying into the vendor conversation.** The
exchanges would let UCT publish market-wide breadth for **free** (UTP Derived Data
§2: multiple-security derived data *"is currently not fee liable"*; CTA note 8:
non-display fees *"do not apply to the creation and use of derived data"*). The
self-serve **vendor** terms would not. So UCT's best-margin, most-differentiated,
least-per-member-cost lane is gated by a **tier decision, not by exchange
economics** — which is a good problem, because it is solved by one purchase rather
than by a product compromise. Frame the Massive conversation around **Derived Works
rights**, not display rights alone.

### 3.2 FMP: with vs without a Data Display and Licensing Agreement

| | **Without a DDLA** | **With a DDLA** |
|---|---|---|
| Screener composite rows (float, short, ownership, ratios, bulk columns) | **R** — §2.2.2 | **LA**, subject to the agreement's own scope |
| Calendar earnings rows, research estimates / financials / ownership, Model Book earnings table | **R** — §2.2.2 reaches these even though they are barely derived | **LA** |
| Economic calendar, news, price targets, grades | **R** | **LA** |
| Transcript **bodies** stored, summarized and displayed | **R** on display; **U** on the AI derivative (§2.6.1(i) + §11.1; no AI clause exists) | **U** — still needs a specific written answer; a DDLA about *display* may not speak to *summarizing copyrighted prose* |
| Caching + storage | **R**, and §6.3 makes exit an engineering project (delete *"including data cached"* + signed Deletion Agreement + audit right) | **LA**, with §6.3 and §2.8 as **live obligations**: notify FMP of every IP and domain where data is stored or processed |
| Naming FMP as the source | **R** — §10.4 forbids it without written consent | Governed by the agreement |
| TheFly-origin analyst actions in the paid Substack | **R / U** | **U** — ask in the same email (§2.9) |
| **What it means for Terminal-Next** | The second-largest block of the product is Restricted, and yfinance is **not** an available fallback (§2.10) | The block converts on one artifact. **This is the cheapest large conversion available** |

### 3.3 The two answers, crossed

|  | **FMP without DDLA** | **FMP with DDLA** |
|---|---|---|
| **Massive Individual** | Terminal-Next as designed is not licensable. Retire, re-source or upgrade. | Fundamentals/calendar survive; every price, chart, analytic and options surface still Restricted. |
| **Massive Business** | Prices, charts and analytics convert; fundamentals, calendar, research pages and the Model Book earnings table stay Restricted. | The register reduces to: the **public** surfaces (§6), the **§6.1(j) composites** question, the **OPRA** sub-agreement, **Finviz** (no document), **yfinance** (Unsuitable, unbuyable), **Finnhub**/**AV** (retire or get written approval), and the **AI/transcript** lane. That is a tractable list. |

---

## 4. STORAGE AND HISTORY (Q3)

### OBSERVATION

Retention today, by store, with the licence that governs it. Retention rules are
source-confirmed by E-04 §6; the production arming state is from ORCH-RAILWAY-01.

| Store | Vendor content it holds | Retention | Covered? | Governing clause |
|---|---|---|---|---|
| `bars.db` (`/data`) | Massive OHLCV, all TFs, ≤5,000 bars/series, D/W capped at 30 years | **No prune found — effectively indefinite** | **Tier-conditional**: no grant at Individual; §2.2 `store` at Business | Massive P1 §2 / P3 §2.2; deletion on termination P1 §10 / P3 §11.4 |
| `bars_disk_cache` | Massive bars | TTL D=48h · W=72h · 60m=8h · 30m=4h · 5m=2h | Tier-conditional | as above; **no caching clause exists in P1–P6** |
| R2 `uct-bars-snapshots` (+ `brain/` packs) | Tarballed `bars.db`; brain packs pruned to newest 5, bar snapshots not observed pruned | Indefinite | **U** | Massive; **plus an unanswered question: if the bucket is not UCT's own account, "storage" quietly becomes "redistribution"** |
| **`flow.db`** | Massive **OPRA** prints / SWEEP-BLOCK events, from a `T.*` wildcard subscription | **Unbounded — `FLOW_PRUNE_ENABLED` written, wired and NOT SET on any service** | **U** | OPRA sub-agreement (unpublished); whether a stored tape is *"historical OPRA Data"* (the fee-exempt case) is not answered by the fee schedule on its face |
| flow tape spool | Raw tape files | `FLOW_TAPE_SPOOL_RETENTION_HOURS=72` (production; code default 26h) | Tier-conditional | as above |
| flow gap-fill archive | T+1 backfill artifacts | `ARCHIVE_PRUNE_DAYS = 30` | Tier-conditional | as above |
| `darkpool.db` | Off-exchange SIP prints ≥ $4M notional | `darkpool_trades` ~120 trading days; **`darkpool_records` never pruned by design** | Tier-conditional | Massive; the records table is the accretive asset (D-13 §7) |
| `tweets.db` | **Verbatim X post bodies** | `TWEET_RETENTION_DAYS` default **7** | **R** — and see the collision below | X Developer Policy: delete/modify within ~24h of change on X |
| **`catalysts.db`** | Derived rows + LLM theses + **`raw_signals` containing verbatim tweet bodies and RSS items** | **Indefinite; no prune in the module** | **R** | **This is the 7-day-window collision E-04 found**: `api/services/catalyst/engine.py:1163-1165` copies the same bodies into a store that keeps them forever |
| Transcript stores + summaries | **FMP / AlphaVantage / Finnhub verbatim transcript bodies** and their LLM derivatives | Per-surface caches; `transcript_index.py` FTS5 on the volume; 24h per (ticker, quarter) for AV | **R** | FMP §6.3 (delete on termination *including cached*), §2.6.1(i), §11.1; Finnhub *"all data must be deleted"*; AV Restricted at source |
| `earnings_analytics` (engine KB, 40,731 rows) | FMP/Finnhub-sourced EPS/revenue actual+estimate+surprise, 25,449 symbols | Grows | **R without a DDLA** | FMP §2.2.2/§2.6.1(i). ⚠️ **The engine KB ships to Railway as the Brain Pack**, so vendor-derived rows ride into a member-facing RAG |
| `news_archive` (22,562 rows) | Third-party article bodies | Grows | **U** | Mixed provenance (AV, RSS, Massive, FMP) — no single clause |
| `screener` snapshot DB | Massive + **Finviz** + FMP columns, one row per ticker | Nightly rebuild | **U** (Finviz) / **R** (FMP) | §2.3, §2.2 |
| `cot.db` | CFTC history (10 years) + LLM narratives | Grows | **A** | Public domain |
| `buzz` store | ticker + `message_id` + `channel_id`, **no text** | Not pruned | **A** | Own content; minimised by design |
| **Browser IndexedDB (`barsIDB`)** | Massive bars, on members' devices | `CACHE_LOGIC_VERSION` + 26h intraday freshness eviction | **U — and UCT cannot delete it on demand** | Every deletion obligation below |

### The deletion obligations, collected

Exiting a vendor is a **multi-store engineering project**, not a billing action:
FMP §6.3 (all Data *"including data cached"*, plus a signed Data Deletion Agreement
in Exhibit A and an audit right) · Finnhub (*"All data must be deleted should your
subscription to that data ends"*) · FRED (*"destroy and remove from all computers,
hard drives, networks, and other storage media all copies … and shall so certify"*) ·
X §IV.B (24 hours on request) · YouTube API ToS §24.3 (delete all API Data on
termination) · Massive P1 §10 / P3 §11.4. **And some of it reaches members'
browsers, where UCT has no delete primitive at all.**

### INTERPRETATION

Three things stand out and they point in different directions.

**Storage is the least-documented clause family in the entire stack.** Massive's
Market Data ToS — the most complete document any agent in this pod reached —
contains no clause on caching, storage or retention. Absence of a prohibition is not
permission, but it does mean **the storage question will most likely be settled by
an order form, not by public terms.** That is an argument for asking the question
explicitly rather than inferring an answer.

**The retention discipline is both aimed at the wrong tape and undercut on the tape
it does aim at.** `buzz_store` refuses to keep member-authored Discord text — the
content the firm arguably has the most latitude with — while `tweets.db` keeps
third-party X bodies for seven days and `catalysts.db` keeps the same bodies
forever. Neither is a bug anyone introduced deliberately; both are what happens when
nobody owns the question.

**Retention is a product requirement here, not an accident.** Implied-capture pairs,
base-structure statistics, flow scoreboards and breadth analogues all need years of
retained derived data (D-13 §5, §6, §7). That makes it worth **licensing
explicitly** rather than discovering later — and it is the strongest argument for
the Business tier independent of display rights, because §2.2 is the only express
`store` grant available anywhere in this stack.

### RECOMMENDATION

Decide each store deliberately — *how far back do we need this, and is holding it
that long inside the agreement?* — then arm `FLOW_PRUNE_ENABLED` to that answer
rather than leaving it at "forever by default". **A retention window nobody chose is
a retention window nobody can defend.** Separately, stop persisting tweet and RSS
bodies in `raw_signals` (or extend the sweep to reach them): that one needs no
vendor's answer.

### CONFIDENCE

🟢 on what is stored and on the prune constants (E-04 source-read). 🟢 on
`FLOW_PRUNE_ENABLED` being unset in production (ORCH-RAILWAY-01's flow-worker key
list). 🟡 on *"no prune found"* for `bars.db` — a scheduler-side sweep outside the
inspected files cannot be excluded. **EVIDENCE CEILING:** no store's size or row
count was measured; that needs the production volume, which the preamble forbids.

### OPEN QUESTION

Is the R2 bucket UCT's own account, and can any third party read it?

---

## 5. AI PROCESSING (Q4)

### OBSERVATION

Fourteen production paths pass vendor-sourced data through an LLM (E-04 §5). Sorted
by whether the **input** is restricted, and cross-checked against the production
flag state.

| Lane | Vendor data entering the model | Input class | Production state | Output leaves the app? |
|---|---|---|---|---|
| **Earnings-call transcript summary** | **FMP** `stable/earning-call-transcript` primary, Finnhub fallback — **FULL verbatim body** | **R** (FMP §2.6.1(i) + §11.1; Finnhub *"derived results"*) | `TRANSCRIPT_INDEX_ENABLED=1` | No — member app |
| **AlphaVantage transcript path** | **AV** `EARNINGS_CALL_TRANSCRIPT` verbatim body | **R** (AV §2(a) — settled, no tier to check) | Lane exists; AV key set | No |
| **Call recap / sentiment / guidance** | Transcripts + Perplexity | **R** / U | `CALL_RECAP_WARM_ENABLED=1` | No |
| **Catalyst thesis** | Massive movers/snapshots + **verbatim X tweet text** + RSS + Perplexity | **R** (X) + tier-conditional (Massive) | `CATALYST_ENGINE_ENABLED=1`, `TWITTERAPI_IO_ENABLED=1`, `CATALYST_OPUS_MODEL=claude-sonnet-4-6` | No |
| **AI Search fast lane + Claude synthesis** | Desk context packs: Massive quotes/regime/flow, FMP fundamentals/analyst/earnings, insider, patterns | tier-conditional + **R** (FMP) | **`AI_SEARCH_CLAUDE_SYNTH=1`** — see §1 finding 6 | No |
| **AI Search agent / deep / briefings / dossier** | 16-tool read-only allowlist over the shared 154-tool registry | tier-conditional + **R** | `AI_SEARCH_DOSSIER/MEMORY/PERSONAL_ENABLED=1`, `AI_SEARCH_DAILY_LIMIT=40` | No |
| **Compass chat / voice / brain tools** | Same registry: Massive quotes, FMP fundamentals, Finnhub, Stocktwits, patterns, brain KB | tier-conditional + **R** | `BRAIN_TOOLS_ENABLED=1`, `COMPASS_MENTOR_MODE=admin`, `COMPASS_AUTOMATION_ENABLED=1` | Email/Discord at importance ≥8 |
| **Voice chart vision** (`gpt-4o`) | **A screenshot of a chart** — i.e. a rendering of Massive bars — to OpenAI | tier-conditional | Voice lane live | No |
| **Stock brief / dossier** | Massive bars + FMP earnings rows | tier-conditional + **R** | `AI_SEARCH_DOSSIER_ENABLED=1` | No |
| **Significant catalysts / Model Book recaps** | Massive daily bars, curated leaders | tier-conditional | `MODELBOOK_SETUP_DESC_MODEL` set | No |
| **Theme engine (orphans / improve)** | Massive-derived co-movement + RS | tier-conditional | `THEME_ENGINE_ENABLED=1` | Admin Discord digest |
| **Morning Wire rundown + Top 5** | Massive bars, **Finviz** scans, **FMP grades (TheFly origin)**, AV news | **U** (Finviz) + **R** (FMP/TheFly chain) | `WIRE_ENABLED=1` | **YES — paid Substack** |
| **Sunday Scans prose** | Wire + scan data (Massive bars) | tier-conditional | (uct-sunday-scan) | **YES — Substack incl. a free tier** |
| **COT weekly narrative** | **CFTC public zips** | **A** | `COT_NARRATIVE_MODEL=claude-opus-5` | Optional Discord (blank posts nothing) |
| **Index-close note** | *No numerals permitted* — the numbers are on the chart beside it | tier-conditional (the **chart** is the data) | `DISCORD_INDEX_CLOSE_ENABLED=1` | **YES — public Discord** |
| **Desk session insights / chapters** | Zoom VTT (own content) | **A** | `DESK_SESSION_CHAPTERS_ENABLED=1` | **YES — YouTube description** |

### INTERPRETATION

**Two exposure classes, and a single "we use AI on vendor data" risk line would
over-state one and under-state the other.**

**(a) Copyrighted TEXT into a model — the sharp one.** The transcript lane (rows
1–3) feeds **verbatim third-party earnings-call transcripts** into an LLM and stores
and displays the summary. Transcript text is a licensed *content* product, not a
price feed, and content licences are the ones that most often name AI processing
explicitly. This is **the only lane where UCT stores and displays a derivative of a
vendor's copyrighted prose rather than of its numbers.** The catalyst lane feeds
**tweet text** the same way. Settle these before scaling them.

**(b) Numeric vendor data into a model.** Rows 4–13 pass numbers. Numbers as inputs
to a summarizer are a much weaker claim than reproducing copyrighted prose, and the
COT row's input is US Government public domain outright.

**No vendor in the stack has a dedicated AI clause except FRED** (an explicit, absolute
ML/LLM prohibition — currently inert, §2.6). Everywhere else, AI use is governed by
the **derived-works clauses**, which is why the tier answer and the DDLA answer
determine the AI column as much as they determine the display column.

**At the exchange layer, the direction of travel is already visible.** Cboe's Market
Data Policies, **effective 2026-09-01 — the day before this report** — create a
declarable Non-Display **Category 4 "Enterprise Derived"** for using market data *"to
develop, train, operate, or enhance a system, product, or platform — including …
artificial intelligence systems, machine learning models, large language models"*
whose outputs are *"distributed externally"*. Nasdaq's AI Policy points the same way
from a different angle. **Terminal-Next is, by its own charter, exactly the product
that category describes.** UCT does not hold exchange agreements — these bind
Massive and shape what Massive can grant downstream — but if the other plans follow
Cboe, "we run an LLM over market data and publish the output" becomes a separately
priced licence category. That deserves a calendar reminder, not a footnote.

**Two structural mitigations already exist and should be recognised rather than
rebuilt.** The COT narrative is behind a **grounding gate** (every number in the
prose must appear in the supplied facts, else nothing is stored) and the index-close
note **forbids digits entirely** — both reduce the chance of a model *reproducing* an
input it should not, as distinct from *summarizing* it. `api/flow_explain.py`
computes the facts deterministically and lets the model only narrate them. These are
the right shape and they generalise.

**And the one clause that ties the whole column together.** Anthropic §L.1 makes UCT
warrant it has the rights to every Input. Every **R** in the "Input class" column
above is therefore also a warranty UCT has given to its AI vendor. That is why §2.13
says a restricted field that is never displayed but *is* sent to a model is still an
exposure.

### RECOMMENDATION

Ask FMP and AlphaVantage, in writing, whether **summarizing and storing a derivative
of a transcript body, displayed to paying subscribers**, is within the plan. One
email; the cost of assuming is a content-licensing dispute. Separately, when the
register maps data classes to surfaces, **map them to prompts as well as to pixels**.

### CONFIDENCE

🟢 that these paths exist and what enters them (E-04/D-12 source-read; production
arming from ORCH-RAILWAY-01). 🔴 on whether any of them breaches a term — that needs
the contracts.

### OPEN QUESTION

Does TwitterAPI.io's own agreement purport to pass through rights X does not grant
it? A reseller cannot grant more than it holds — and this one expressly does not try.

---

## 6. EXTERNAL PUBLICATION (Q5)

### OBSERVATION

Every surface on which vendor-derived content leaves the member paywall, with its
gate and its class. Gates are from E-04 §8 (source-read); **arming state is from
ORCH-RAILWAY-01**, and it changes three rows.

| # | Surface | Vendor content that leaves | Gate | Production | Class |
|---|---|---|---|---|---|
| 1 | **Desk sessions → YouTube** | A screen recording of the dashboard: Massive bars and quotes, Schwab-derived GEX, FMP tables — whatever was on screen | `privacy_for_section()`; code default `sunday scans` only | **`DESK_PUBLIC_SHOWS=*` ⇒ EVERY show uploads PUBLIC**, incl. paywalled Live Trading Sessions — and the code records this as an **owner decision dated 2026-08-19**, not a slip | **R** — widest surface in the product, and deliberately so |
| 2 | **`GET /api/flow-scoreboard`** | Hit rates, grade calibration, recent picks, **contract-price gains from the OPRA tape** | **None** — *"No auth on the GET — read-only, cacheable, public"*; mounted unconditionally | Live | **R** — survives even the Business tier; viewers are not Edge Users |
| 3 | **`/r/*` render panels** | Whatever the panel draws: prices, flow, breadth, movers, econ, earnings cards | `CHART_RENDER_TOKEN`, **inlined into the JS bundle**; the router's own docstring says *"treat these as EFFECTIVELY PUBLIC"* | Live, **and deliberately exempt from the COMING SOON gate** | **R** |
| 4 | **Discord `#TSDR` index-close charts, 15:45 ET** | 8 rendered charts/day from Massive bars — QQQ/SPY/IWM/DIA + 4 ETFs, including the developing session | Fails closed 3 ways (flag, blank webhook, non-trading day) | **`DISCORD_INDEX_CLOSE_ENABLED=1`** | **R** — public channel by the code's own docstring |
| 5 | **Sunday Scans → Substack** | Charts rendered through `/r/chart` (Massive bars) | **A free mid-week newsletter exists** | Live | **R** — a free tier is public |
| 6 | **Morning Wire → Substack** | Charts, levels, exposure, book, FMP grades (TheFly origin), AV news, Finviz-derived scans | Paid; `send_gate.clear_to_send` off by default, fails closed | `WIRE_ENABLED=1` | **R / U** — a paid newsletter audience is arguably not *"users of Customer's products and services"* in the app sense; worth a specific question |
| 7 | **Dark-pool record Discord alerts** | Ticker + notional of record off-exchange prints (Massive/SIP-derived) | `DARKPOOL_RECORDS_ENABLED`, code default `"0"` | **`DARKPOOL_RECORDS_ENABLED=1`** — armed | **R** — is a single print's ticker + notional Market Data or a Derived Work? |
| 8 | **Discord `/chart` command** | House chart images from Massive bars | **Guild-locked** to two UCT servers; user-installs and DMs refused (`discord_interactions.py:863-897`) | Live | **R / LA** — community display, not public redistribution. ⚠️ E-03 row 13 calls this *"public + user-install"*; E-04 §8 and D-13 record the guild lock. **The register must carry one answer** — see §8 |
| 9 | **TSDR session announce** | Embed + branded thumbnail + recap | `DESK_TSDR_ANNOUNCE_SHOWS`, blank announces nothing; code default `evening update` | **`=evening update,sunday scans`** — widened | **R** for the vendor-derived thumbnail/recap content |
| 10 | **Buzz digest → Discord** | Ticker mention counts over UCT's own community | `BUZZ_DIGEST_ENABLED` | `=1` | **A** — own content, no text stored |
| 11 | **COT weekly Discord post** | LLM read over CFTC public-domain data | `COT_WEEKLY_DISCORD_WEBHOOK_URL`; blank posts nothing | Optional | **A** |

### INTERPRETATION

**A chart is display, not derived data — and that is the clearest answer in the
whole pod.** Cboe says it outright (Historical Data must not be redistributed
*"including in charts, graphs and other presentations"* unless approved as Derived
Data) and UTP counts a charting page as a fee-liable query. The reason is
structural rather than arbitrary: **a candlestick chart fails the
reverse-engineering prong by construction — you can read the OHLC values off it.** A
chart of vendor bars is the vendor's prices in a different font. So rows 1, 4, 5 and
8 are *display of the underlying data* to whoever can see them, and the audience is
the whole question.

**The codebase already has an excellent fail-closed instinct, and it is aimed
entirely at the wrong risk.** Every gate above exists to prevent accidentally
leaking **paywalled content to non-payers**. Not one was designed to prevent
**redistributing a vendor's data**. They are the same mechanism pointed at a
different threat — which means the retrofit cost is low: the gates exist, the
allowlists exist, the blank-means-nothing contract is the house idiom. What is
missing is a second reason to consult them.

**And the production read shows exactly why a code default must never be treated as
a flag state.** Row 1's default is `sunday scans` (a deliberately narrow, paywall-aware
choice with a rail deriving the show list from `_RULES` so a new show defaults to
unlisted). The live value is `*`, which short-circuits the whole mechanism at
`privacy_for_section:120-121` before any show matching happens. **The most carefully
reasoned publication control in the product is currently bypassed by one character**,
and E-04 §8 — reading the code alone — recorded it as the narrow, safe row.

⚠️ **But do not read "bypassed" as "broken".** The comment above the constant
(`desk_daily_session.py:106-109`) records `*` as an **owner decision dated
2026-08-19** and even explains the wildcard's exact-match rule so no section name can
drift into it by substring. The mechanism is working as its author intended; what is
missing is not a guard but a **second question** — the gate was designed to ask *"is
this paywalled content leaking to non-payers?"* and was answered deliberately for
that question. It was never asked *"whose vendor data is inside the recording, and
may it go out?"* That is the general shape of every row in this table, and it is why
the recommendation below is a chokepoint rather than a flag change.

**Two surfaces have no gate at all, and they differ in kind.** The Flow Scoreboard is
ungated *deliberately*, for a good product reason (public proof of honesty; losers
never excluded; it is described in-file as *"a public trust asset"*) — a defensible
trade that has simply never been weighed against a licensing cost, because nobody had
written the licensing cost down. `/api/gex/*` and `/api/dealer-positioning/*` appear
ungated **by omission**: the auth middleware's own docstring explains why that is easy
to do accidentally (*"Does NOT block any existing endpoints. Only used by routes that
explicitly depend on it"*), and the same defect class was already remediated once on
the flow admin routes. That one is a security observation as much as a licensing one
and deserves its own look.

### RECOMMENDATION

**One publication chokepoint that asks "whose data is in this, and may it go out?"
once**, rather than a per-surface gate written by whoever shipped that surface. Add
**vendor-of-origin** as a field on anything that reaches it — it costs a string and
it makes the question answerable. On row 1, the ask is **not** to narrow
`DESK_PUBLIC_SHOWS`: the wildcard is a recorded owner decision (2026-08-19) and this
register has no standing to reverse it. The ask is to **re-confirm it now that the
redistribution cost is written down**, and to move it from a code comment into
`OWNER_DECISIONS.md` as an accepted risk — the same treatment OI-E02-05 gives the
Flow Scoreboard.

### CONFIDENCE

🟢 on the gates (E-04 source-read) and on the arming state (ORCH-RAILWAY-01).
🟢 on `privacy_for_section`'s `"*"` short-circuit (I read the function).
🟡 on row 6 (whether a paid Substack audience counts as Edge Users is a reading, not
a clause).

### OPEN QUESTION

Does the owner want the Flow Scoreboard to stay public? If the answer is *"yes, it is
a marketing asset"*, that is a deliberate accepted risk and belongs in
`OWNER_DECISIONS.md` — not left implicit in a docstring.

---

## 7. THE ESCAPE ROUTES, AND THE SAFEST DESIGN PER SURFACE (Q6)

### 7.1 What each escape route actually buys — and what it does not

| Escape route | What it solves | What it does **not** solve | Source |
|---|---|---|---|
| **15-min delayed + real-time volume (UTP)** | Tape C per-member fee **and** the subscriber-agreement burden vanish on a controlled product. Real-time **volume** may accompany delayed price **at no additional charge** | **Nothing at the vendor layer.** Massive P1 §5(c) bars derived works regardless of delay; P1 §1 bars the commercial purpose regardless of freshness | UTP Data Policies (Sept 2023): *"there is no charge for UTP Delayed Information distributed on Controlled Products"*; *"Vendors are currently not required to obtain Subscriber Agreements"* |
| **Multi-security derived data** | Not fee liable under UTP §2 and Nasdaq Note 3; CTA note 8 says non-display fees *"do not apply to the creation and use of derived data"* | **Massive §5(c) is broader than the plans** and still bars it at the Individual tier. Single-security price derivations (implied move in dollars, entry/stop/target) remain fee-liable under both UTP §1 and Cboe §15 | E-03 §2.3, §4.4A; E-04 §4 |
| **Historical-only options** | The **only** free options shape: exempt from OPRA's redistribution fee **and** from per-user fees | Delayed options still owe **$1,500/month**; real-time adds ~$1.25/member/month on top | OPRA Fee Schedule: the Redistribution Fee applies *"whether on a current or delayed basis"*, excepting historical-only |
| **Desk-only raw display** | Nothing at three of four self-serve vendors | Massive P1 §3 (commercial **purpose** disqualifies, *"even if … on behalf of an organization not in the securities industry"*, **with an indemnity**); FMP §2.2.2 (*"internal or external"*); Finnhub (*"even internally"*) | E-01 §1a, §2, §6 |

⛔ **State this once, plainly, because it is the answer to the contract's question.**
Under the **Individual-tier assumption**, the escape routes do not rescue
Terminal-Next. They solve the *exchange-fee* problem; the *vendor-licence* problem is
untouched by delay, by aggregation, and by restricting the audience to the desk. The
delayed / aggregated designs below are what you build **after** the tier answer, to
control per-member exchange cost and residual risk — **not as a substitute for the
licence.**

⚠️ And the delayed route is a **new build, not a toggle**: my sweep of `app/src/` and
`api/` found **zero** occurrences of any delay-notice string, and UTP requires the
message to *"prominently appear on all displays containing Delayed Data, such as at
or near the top of the page"*, plus a **Financial Status Indicator** on all intraday
single-security quote or trade displays — *including delayed ones*.

### 7.2 Safest design per Terminal-Next candidate surface

Assuming the tier question is answered by upgrading (because under the Individual
assumption the honest answer for every row is *retire, re-source, or upgrade*), this
is the shape that minimises exchange cost, per-member cost and residual licensing
risk.

| Surface | Expensive primitive it reaches for | Safest design | Residual risk after the redesign |
|---|---|---|---|
| **Security page quote** | Real-time single-symbol last sale — the single most expensive primitive in the product | 15-min delayed last price + **real-time volume** + live % of ADV + prior close; `Del-15` at the top of the page; Financial Status Indicator | Vendor tier only. The exchange cost goes to zero on Tape C |
| **Watchlist quotes** | The same primitive × N rows | Same as above; **rank and sort on multi-symbol derived metrics** (RS rank, relative volume, breadth context), which are fee-exempt | Vendor tier |
| **Options flow** | Real-time OPRA prints | Decide the tier explicitly — (i) retire, (ii) **historical-only (the only free one)**, (iii) delayed, (iv) real-time. Delayed removes the per-member fee, **not** the $1,500/mo floor | OPRA sub-agreement (§2.5) — the largest single **U** in this document |
| **Fundamentals** | FMP display | **An FMP DDLA is the single artifact that unlocks it.** Without it: re-source, or drop. **yfinance is not a fallback** (§2.10). SEC EDGAR is the free, unrestricted substitute for filings-derived fundamentals | Transcript bodies stay a separate question (§5) |
| **Calendar** | Nothing — event data is not market data, and this is the lowest-risk surface in the product | Consolidate. Today one field (the earnings date + session) is assembled from **four** Restricted/Unknown providers — EarningsWhispers (scraped), Finnhub, FMP and a Finviz column. Prefer the licensed vendor + EDGAR 8-K | Provider sprawl is the risk here, not the licence |
| **News** | AV (Restricted), X (Restricted, display requirements unmet), TheFly (Unsuitable direct) | RSS + SEC EDGAR + the licensed vendor's own news endpoint are the cleanest combination already in the codebase; retire AV onto the existing RSS fallback | X display-requirements fix if the tape stays |
| **Charts (the heart of the product)** | The **last bar** | Complete history + a 15-minute-delayed developing bar + a **live volume bar**. Multi-day history is the cheapest data in the taxonomy; only the developing bar is expensive | Vendor tier. **Do not build the story on "bars are derived, therefore free"** — no plan document names OHLCV aggregates, and a 250ms developing bar is a real-time single-symbol display by any reading |
| **Alerts (server-side price evaluation)** | ⚠️ **Non-display use — a separately priced category nobody has counted** | Send the level and the direction, not a live quote; delay the delivered price | CTA note 8 / OPRA note 10 name *surveillance programs* and *operations control programs*. Category 1 is **$2,000/mo** on CTA Network A and again on OPRA. **This is the surface most likely to be omitted from a licensing review precisely because nothing is on screen** |
| **AI narrative over market data** | The inputs, not the output | Ground on EOD + **multi-symbol derived** facts, never on a live single-symbol quote. Copy the COT lane's shape: a facts module that is the only thing the model may cite, plus a grounding gate | Anthropic §L.1 — the warranty is only as good as the worst-licensed input |

⭐ **The load-bearing lever, stated once.** For a momentum / relative-strength desk —
which is what UCT teaches — **volume surge, relative volume and unusual-volume
detection carry much of the intraday signal**, and UTP permits real-time volume
alongside delayed price at no charge. A *"delayed price, live volume, live breadth"*
terminal is a coherent, differentiated product rather than a degraded one, and it is
close to free on the equity side. Give it to the product roles as a **testable
hypothesis with a cheap experiment**: one surface, one week, owner verdict. If it
survives, it removes the largest cost and compliance obligation from Terminal-Next.
If it fails, the failure is specific and tells you exactly what you are buying
real-time for.

---

## 8. OWNER QUESTIONS THIS TABLE CANNOT RESOLVE (Q7)

OI-style, with a **default** — the position the register should record if the
question goes unanswered. Ordered by how many cells move.

| ID | Question | Cells it moves | Default if unanswered |
|---|---|---|---|
| **OI-E02-01** | **Which Massive plan is in force** (Basic / Starter / Developer / Advanced / **Business / Enterprise**), and does its grant cover (a) customer-facing display, (b) **OPRA options** display, (c) **Derived Works** — charts, analytics, breadth? | ~2/3 of §2 | **Assume Individual.** Every Massive row is Restricted; Terminal-Next planning proceeds on "upgrade or re-scope", not on delayed-design mitigations |
| **OI-E02-02** | **Does UCT hold an FMP Data Display and Licensing Agreement?** And please obtain the **Acceptable Data Use Policy** text (ToS §2.6.2 makes it binding; the URL 404s) | The whole of §2.2 + the screener/calendar/research/Model Book surfaces | **Assume no DDLA.** Treat every FMP-sourced member-facing field as Restricted; do not add new ones |
| **OI-E02-03** | **What agreement was presented at Finviz Elite purchase?** (Retrievable from the account or the purchase-confirmation email.) And: is Finviz an internal scanner input only, or are Finviz-rendered chart images served to members? | All of §2.3, plus short interest — the product's only source | **Assume no grant.** Internal scanner input stays Unknown; retire Finviz **images** from member surfaces first; price short interest as a coverage gap with no second vendor |
| **OI-E02-04** | **`DESK_PUBLIC_SHOWS=*` is recorded in code as an owner decision dated 2026-08-19** (`api/services/desk_daily_session.py:106-109`). It publishes every Desk session — including paywalled Live Trading Sessions — publicly on YouTube, each one a screen recording of Massive bars, Schwab-derived GEX and FMP tables. **Does the decision still hold with that redistribution cost written down?** | §6 row 1 | **Assume it stands** — it is a deliberate decision, not a slip, and this register has no standing to reverse it. Record it in `OWNER_DECISIONS.md` as an **accepted risk with a now-stated licensing cost**, exactly as OI-E02-05 handles the Flow Scoreboard. Do not "fix" it by narrowing the variable |
| **OI-E02-05** | **Is the Flow Scoreboard's public, unauthenticated exposure a deliberate accepted risk?** | §6 row 2 | **Assume deliberate but unweighed.** Record it as an accepted risk with the licensing cost now written down |
| **OI-E02-06** | **Finnhub**: plan tier, and is there **written approval** to redistribute data or derived results to end users? | All of §2.4 | **Assume free/personal, no approval.** Plan the retirement onto Massive rather than a negotiation |
| **OI-E02-07** | **Alpha Vantage**: free key, or a written commercial agreement? | All of §2.5 | **Assume free.** Retire both call sites onto their existing fallbacks (RSS for news, FMP for transcripts) — close to free |
| **OI-E02-08** | **Schwab**: which developer tier is the app registered under, and does any accepted agreement contemplate display to non-account-holders? | All of §2.11 | **Assume Individual Developer.** Scope the GEX/dealer-positioning re-source onto the redistribution vendor's chains |
| **OI-E02-09** | **Is UCT willing to become a vendor of record with the SIPs** (attestation, entitlement with unique non-shared credentials, monthly non-pro counts, three-year audit trails) — or to stay entirely downstream of a vendor whose redistribution licence names UCT's members? | §7 and the whole cost shape | **Assume downstream.** Do not design surfaces that require UCT to run subscriber entitlement |
| **OI-E02-10** | **Should the market-data endpoints be authenticated?** `/api/live-prices`, `/api/bars/{ticker}`, `/api/snapshot`, `/api/movers`, `/api/stream/*`, `/api/gex/*`, `/api/dealer-positioning/*` declare no auth dependency and no global gate covers `/api/*` | Every "member display" cell — an open endpoint is not member display, it is public redistribution | **Assume yes.** Under CTA Exhibit A, an entitlement system that cannot produce accurate historical information licenses NYSE to *"bill for all devices on your network"*, and an open endpoint has no bounded device count |
| **OI-E02-11** | **Is the Sunday Scans free Substack tier active, and does it carry charts?** | §6 row 5 | **Assume yes.** Treat it as a public redistribution surface |
| **OI-E02-12** | **What consent basis covers the 7,766-message `#tsdr` export**, and does it extend to a product surface rather than an internal RAG? (591 rows are already in the KB, which ships to Railway as the Brain Pack) | §2.12 rows 4–5 | **Assume internal-RAG consent only.** Do not surface member message text in a product until answered |
| **OI-E02-13** | **The Anthropic subscription seat**: is `desk_insights_polish.py` (`claude -p`) producing publicly-consumed YouTube artifacts inside the seat's terms? The product's own doctrine says the API key, never the seat | §2.13 row 4 | **Assume not covered.** Move that lane to the API key, matching `discord_close_note.py`'s written rule |
| **OI-E02-14** | **FRED / Reddit**: arm deliberately, or retire? Both are keyless in production today | §2.6, §2.8 | **Assume retire.** Arming FRED makes three collisions live at once |
| **OI-E02-15** | **Seat counts** — how many people hold logins to each vendor? (TheFly's one-concurrent-user rule, FMP's account-sharing ban, Finnhub's personal-plan rule all bind per seat) | Cross-cutting | **Assume one owner seat per vendor.** Flag any shared login as a separate finding |
| **OI-E02-16** | **Any contract addenda, order forms or written vendor exceptions** not visible on public pricing pages, for any vendor above | Everything | **Assume none.** This is the structural ceiling on the whole pod |

---

## 9. DISCREPANCIES AND PRODUCTION-STATE CORRECTIONS

*A register cannot carry two authorities over one value. These are the places where
the pod's files disagree, or where the production read overturns a code-default
reading. Each names which side the register should take and why.*

| # | The disagreement | Take this side, and why |
|---|---|---|
| 1 | **`DESK_PUBLIC_SHOWS`** — E-04 §8 records the code default (`sunday scans`, *"blank makes NOTHING public"*) and classes the surface narrow. ORCH-RAILWAY-01 reads `*` | **Take the production value.** `privacy_for_section:120-121` returns `"public"` for every section when `"*"` is present, before any matching. This is `lesson_a_flag_state_is_not_a_code_default` in its exact canonical shape. ⭐ **Second correction, from a 2026-09-02 verification pass:** the wildcard is documented in code as an **owner decision dated 2026-08-19** (`desk_daily_session.py:106-109`), so the register must file it as a *deliberate decision whose licensing cost was never weighed* — **not** as a misconfiguration. Both halves matter: the code default understates the exposure, and calling the live value a mistake would misrepresent an owner call |
| 2 | **Discord `/chart` scope** — E-03 §1.1 row 13 says *"app defaults PUBLIC + USER_INSTALL"*; E-04 §8 and D-13 cite `discord_interactions.py:863-897` (`DEFAULT_ALLOWED_GUILDS`, `guild_allowed()`) refusing user-installs and DMs | **Take the guild lock**, which is a specific code citation rather than an app-registration default; the register should note the app-level default separately, because a registration default that is not enforced in code is a latent re-opening |
| 3 | **The tick stream's provider** — `CLAUDE.md` says Massive/Polygon WebSocket; `api/services/realtime_stream.py:24` is `wss://ws.finnhub.io` | **Take the code.** It matters because Finnhub's terms are the strictest in the stack, so the doc's version understates the exposure |
| 4 | **FRED's class** — E-04 §7 classes the whole ~30-series catalog Restricted on live collisions | **Qualify it**: the code path is Restricted **if armed**; `FRED_API_KEY` is absent on every service, so the lane returns an error dict and the collisions are dormant |
| 5 | **`FLOW_PRUNE_ENABLED`** — E-04 §6 finds it unarmed by code default | **Confirmed at the configuration level**: the flag appears on **no** service's variable list, so `flow.db` grows without bound in production |
| 6 | **`AI_SEARCH_CLAUDE_SYNTH`** — D-12 §2a records the default `"0"` and flags that if so, no member answer is written by Claude | **It is `=1`.** Desk context reaches Anthropic on the default member lane; the AI column of §2 is wider than the code default implied |
| 7 | **`DESK_TSDR_ANNOUNCE_SHOWS`** — code default `evening update`; production `evening update,sunday scans` | Take production; the announce surface is wider than the default, though still opt-in and fail-closed |
| 8 | **`MASSIVE_WS_ENABLED`** — `=0` on `web`, **`=1` on `flow-worker`** | Both are true; the OPRA tape lives on the flow-worker and `web` proxies reads (`FLOW_READS_PROXY_ENABLED=1`). A register row that names only `web` would read as "the tape is off" |
| 9 | **E-04 §7's FRED copyright-series list** — an earlier draft named three specific series from general knowledge and **retracted** them | **Do not reintroduce the guess.** FRED publishes the test (*"Copyrighted series contain the word 'Copyright' in their notes"*), not the list. Thirty lookups closes it properly |
| 10 | **The base-structure count** — D-13 §5 measures the ledger at **25 structures, 3 published** (`docs/base_lift_ledger.json`, `measured_at: 2026-09-01`). A "30 structures" figure circulates in session notes | **Take the ledger.** ⚠️ *A verification pass on 2026-09-02 corrected this row: an earlier draft attributed the "30" to **E-04 §0**, and E-04 says no such thing — a grep of `derived-data-rights.md` for "structure" returns only prose references. The misattribution is retracted.* The count itself is out of E-02's scope; it is flagged only so the register does not inherit a stale number or a phantom source |

---

## GAPS

What this contract's budget and scope did not reach.

* **No contract, order form, invoice or vendor account page** — for any vendor, by
  any agent in this pod. This is the structural ceiling on the entire licensing
  workstream, and it is why nothing in §2 is Allowed on the strength of a vendor
  relationship. Sixteen owner questions in §8 are the closure path.
* **The Massive tier and the FMP DDLA remain UNKNOWN.** Between them they own the
  class of roughly two thirds of §2. Every remediation ranked below them is work done
  in the dark.
* **OPRA's downstream treatment is unanswerable by reading.** OPRA publishes **no**
  definition of derived data, **no** substitutability test, and **no** fee treatment
  of derived/aggregate products anywhere in an eleven-document public corpus; the
  treatment is decided administratively from a free-text description on Exhibit A.
  Given that the OPRA-derived Flow Scoreboard is public and unauthenticated, this is
  the highest value-per-email question in the register.
* **No freshness measurement.** Whether Massive-sourced prices arrive real-time or
  15-minute delayed is a function of the account tier and returns from the same URL
  either way. One timestamped sample during RTH compared to wall clock would move
  several §2 rows at a stroke; the preamble forbids probing production and I did not.
* **Current exchange fee schedules were not re-verified by me.** E-03's extracted
  OPRA schedule states 2017/2018 rates, the CTA charges PDF shows no effective date,
  and the CTA Nonprofessional Policy is dated November 2016. UTP Level 1
  nonprofessional per-subscriber pricing is **NOT DETERMINED**. E-05 must re-pull all
  four before any figure reaches a budget; I have deliberately quoted none as a cost.
* **Whether `/api/gex/*` and `/api/dealer-positioning/*` are actually reachable
  unauthenticated on production.** The routers declare no auth dependency and no
  global gate covers them (E-04 §8, CONFIRMED from source), but no agent has run the
  single unauthenticated GET that settles it. It should be run.
* **Which of UCT's ~30 FRED series carry a third-party copyright tier** — thirty
  `fred/series/search` lookups, not done.
* **Store sizes and row counts** — every `/data/*.db` is on the Railway volume. §4
  is complete on schema and retention rule and empty on volume.
* **Non-US listings.** Theme holdings include international tickers (the taxonomy
  counts them and drops them from US-only surfaces); any non-US listing carries its
  own exchange terms. Entirely out of scope here.
* **Cost modelling** — deliberately not attempted (E-05/E-06). Every figure quoted in
  §3 and §7 is a licence fact from a sibling report, not a cost model.
* **No new web research.** Per contract I re-read no vendor page; every clause quoted
  here is E-01's, E-03's or E-04's, cited to their section so the reader can trace it
  to the primary document those agents fetched.

## NOT INSPECTED

* **Executed agreements of any kind** — Massive/Polygon, FMP, Finviz, Finnhub, AV,
  Schwab, SnapTrade, NYSE/CTA, UTP, OPRA. Not present in any repository; not
  reachable from this machine.
* **Vendor account dashboards, invoices and plan pages** — all require login. No
  agent in this pod signed up, logged in, accepted terms or submitted any form
  anywhere, and I did not either.
* **Any vendor API** — none was called.
* **Production services and the production `/data` volume** — not touched. All
  production state in this report is second-hand from the orchestrator's read-only
  Railway pass (ORCH-RAILWAY-01) and is labelled as such.
* **The local backend on port 8077** — the preamble forbids probing it and forbids
  treating it as truth.
* **`C:\data`** — the live shared data root on this box; contract-forbidden.
* **Partner-owned files** — `OptionsFlow.jsx`, `schwab_router.py`,
  `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`. Named
  only for which provider and which data class each carries, per the preamble; the
  Schwab finding is routed to the owner as a **sourcing question**, never as a change
  request against a partner file.
* **The `uct-intelligence`, `uct_intelligence`, `morning-wire` and `uct-sunday-scan`
  repositories** — outside this contract's scope. Their provider calls reach this
  table only through what E-04 and D-13 already established (the yfinance breadth
  collector, the FMP→TheFly grades chain, the Sunday Scans free tier, the
  subscription-seat polish script), and each of those is cited to the sibling that
  read it.
* **`git`** — not run.

---

### Source-handling note (per contract)

Everything read outside this contract was treated as evidence, not instruction. Two
observations worth recording:

1. `api/services/desk_daily_session.py` and the sibling reports contain operational
   text describing which flags to set (`DESK_PUBLIC_SHOWS`, `FLOW_PRUNE_ENABLED`,
   `DESK_TICKER_MOMENTS_ENABLED=0`). **Nothing was set, armed, disarmed or run.** The
   values in §1, §6 and §9 are reported from the orchestrator's read-only pass and
   from code I read; every recommendation about them is addressed to the owner.
2. `api/earnings_router.py`'s docstring instructs a reader to mount it in `main.py`.
   It is unmounted and superseded, the repository's own `CLAUDE.md` says not to
   follow it, and I did not.

No credential, key, token or connection string **value** appears anywhere in this
report. Every variable is referenced by **name only**.
