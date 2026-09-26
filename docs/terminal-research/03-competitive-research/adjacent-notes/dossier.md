---
id: B-ADJ-01
title: Adjacent light note — TIKR, YCharts, S&P Capital IQ Pro
role: benchmark product dossier author (light/merged)
wave: 1b
group: B
category: competitor
scope: TIKR (prosumer fundamentals terminal) · YCharts (advisor/analyst charting platform) · S&P Capital IQ Pro (enterprise research platform)
confidence: 🟡 overall
evidence_ceiling: "All three products' official marketing/pricing pages were reached and read directly (primary), which is the strongest evidence this LIGHT pass targets. The genuine ceiling is depth: no logged-in trial/account for any of the three, so AI-feature behavior (TIKR: none advertised; YCharts: 'Y' agent; CIQ Pro: ChatIQ/Document Intelligence/Chart Explainer) is marketing-page description only, not observed. YCharts and CIQ Pro publish no self-serve numeric pricing at all — those figures are reported/secondary and, for YCharts, internally inconsistent across sources. Raising the ceiling: a sales quote call (YCharts, CIQ Pro), a trial account (all three), or a recorded demo transcript for the AI features."
sources: 6 primary (official product/pricing pages); 6 secondary (review aggregators, comparison blogs, cited only for pricing triangulation and flagged as unverified)
uct_relevance: medium
status: draft
date: 2026-09-02
---

# Adjacent light note — TIKR, YCharts, S&P Capital IQ Pro (B-ADJ-01)

**Scope note.** This is a LIGHT, merged dossier per DL-017: sections A (Executive summary),
D (Capability map), L (Pricing/business model), M (Best ideas for UCT), N (Bad ideas for
UCT) and P (Confidence) only, for each of three products, to keep the coverage map complete
for prosumer fundamentals / advisor charting / enterprise research without duplicating the
deeper Koyfin, Fiscal.ai (FinChat) and FactSet dossiers. All fetches below: **2026-09-02**.
Labels follow the program standard: **verified** (read directly on the vendor's own page),
**claimed** (vendor marketing about itself), **reported** (third party, unverified). Nothing
here is a requirement — "product X does Y" never implies "UCT should build Y." TERMINAL-NEXT
is the program under design; TERMINAL-CURRENT is the existing `/calendar` surface.

---

## 1. TIKR (`tikr.com`)

### A. Executive summary
**OBSERVATION.** TIKR is a prosumer stock-research and portfolio-monitoring terminal.
Its own positioning line is *"Invest like Wall Street with TIKR Terminal"* — the product
consolidates deep global financials, analyst estimates, transcripts, a valuation-model
builder and "superinvestor" (13F-style) portfolio tracking into one browser workflow, sold
as a spreadsheet replacement rather than a data feed. It serves retail investors, students/
aspiring analysts, and investment professionals who want institutional-depth fundamentals
at a consumer price. **Philosophy, one sentence:** deep, long-history global fundamentals
and "what are the pros holding" transparency, priced and packaged for an individual, not a
firm. [EVIDENCE: https://www.tikr.com/ — official homepage — verified — 2026-09-02]

### D. Capability map (Part XIII taxonomy)
- **Fundamentals:** up to 30 years of financials across 100,000+ global stocks (top tier).
- **Estimates:** Wall Street analyst forecasts/consensus, tier-gated depth.
- **Earnings/News:** earnings-call and conference transcripts; higher tiers add audio/slides
  and full-text transcript search plus management-guidance tracking.
- **Screening:** filters by country, industry, financials, ratios, analyst forecasts, and
  valuation.
- **Watchlist/Portfolio:** watchlist news feed (earnings, filings, company events); unlimited
  watchlists from the Plus tier up.
- **Ownership — signature feature:** "Superinvestor" tracking of 10,000+ institutional/hedge
  fund/insider portfolios, tier-gated from "top 40 funds" (Plus) to full universe (Ultimate).
- **Valuation tools:** a custom DCF/model builder for forecasting.
- **Charting:** up to 20 years of charting data at the Pro tier.
- **AI:** NOT DETERMINED — no AI feature was named or shown on the fetched marketing pages;
  evidence ceiling is the homepage/pricing copy only, no feature-tour or trial page checked.
[EVIDENCE: https://www.tikr.com/ and https://www.tikr.com/pricing — official — verified —
2026-09-02]

### L. Pricing / business model
Four flat, self-serve, per-seat consumer tiers, no enterprise/firm tier disclosed publicly:
- **Free** — $0/mo — US stocks only, 5yr/8-quarter history, basic screener, 1 watchlist.
- **Plus** — $24.95/mo — global data, 10yr/20-quarter history, analyst estimates, top 40
  funds, 1-year transcript history, 5 custom newsfeeds, unlimited watchlists.
- **Pro** ("Most Popular") — $54.95/mo — 10yr/40-quarter history, 20-year charting, 10-year
  transcript history with audio/slides, top 150 funds, 30 saved screens.
- **Ultimate** — $119.95/mo — 30yr/40-quarter history, full transcript history + audio/
  slides, 10,000+ funds, transcript search, management guidance, unlimited saved screens.
All plans carry a 14-day money-back guarantee. This is a pure B2C SaaS ladder — no
"contact sales," no per-firm/professional-vs-non-professional split visible on the public
page. [EVIDENCE: https://www.tikr.com/pricing — official — verified — 2026-09-02]

### M. Best ideas for UCT (hypotheses)
1. **Superinvestor/13F ownership panel.** Hypothesis: a "who else owns this" panel on a
   UCT ticker page, sourced from institutional/insider ownership data, would give the desk
   a fast institutional-conviction check the way TIKR gives retail fundamental investors —
   serving the "research this company from scratch" and UCT20 watchlist workflows.
2. **Tiered transcript search, not just transcript access.** TIKR gates full-text search
   across transcript *history* (not just the current quarter) to its top tier. Hypothesis:
   extending UCT Calendar's AV-transcript feature with cross-quarter keyword search would
   deepen the "prepare me for earnings" workflow beyond a single-quarter read.
3. **Flat, self-serve pricing as a trust pattern.** Hypothesis: TIKR's four transparent
   consumer tiers (vs. YCharts'/CIQ Pro's quote-only opacity below) is the right reference
   pattern if UCT ever adds a paid research tier aimed at members, not firms.

### N. Bad ideas for UCT / anti-patterns
1. **Free-tier's US-only, 5-year hard cliff.** A steep history/coverage wall at the entry
   tier risks frustrating discovery-stage users. TERMINAL-NEXT's desk persona needs
   longer lookback even for quick triage; an aggressively narrow free equivalent would be
   a regression from UCT's current FREE_PAGES model.
2. **No visible AI-grounding discipline to imitate or avoid** — genuinely NOT DETERMINED
   here (no AI feature was found at all), so there is nothing concrete to warn against;
   flagged as a gap rather than a finding.

### P. Confidence
🟢 A and D (official homepage + official pricing page, primary, directly fetched,
2026-09-02). 🔴 AI-feature depth — ceiling: nothing AI-branded appeared on the fetched
pages; would need a feature-tour page or trial account to confirm presence/absence. 🟡 M/N
(hypotheses derived from the primary data above; not independently practitioner-verified).

---

## 2. YCharts (`ycharts.com` / `get.ycharts.com`)

### A. Executive summary
**OBSERVATION.** YCharts is an advisor/analyst research, charting, and client-proposal
platform. Its stated line is *"Intelligence Embedded. Insights Delivered. Growth
Unlocked."* It serves financial advisors, wealth managers, large RIAs, asset managers/
wholesalers, banks/trust companies, and (a smaller lane) individual investors/educators.
**Philosophy, one sentence:** turn deep fundamental-and-macro time-series data and
portfolio tooling into *client-facing collateral* as much as into internal research — it
is as much an advisor sales-enablement tool (proposals, firm-branded reports, talking
points) as a data terminal. [EVIDENCE: https://ycharts.com/ — official homepage —
verified — 2026-09-02]

### D. Capability map
- **Charting — signature strength:** "Timeseries Analysis," deep historical multi-metric
  charting across company fundamentals and macro/economic indicators; independently
  corroborated by third-party comparison coverage as YCharts' best-known strength.
  [EVIDENCE: get.ycharts.com official blog snippet (via search) — claimed/reported —
  2026-09-02; corroborating: Barchart.com "Platforms for investment research" — reported
  — 2026-09-02]
- **Screening:** Screeners + Scoring Models, present from the Analyst tier up.
- **Watchlists/Dashboards/Alerts:** live dashboard, watchlists, price/news alerts, a live
  news feed, "Quickflows."
- **Portfolio:** Portfolios, Dynamic Model Portfolios, a Portfolio Optimizer, Householding,
  and "Quick Extract" (converts a client's brokerage statement into a structured portfolio).
- **Reports/collaboration (advisor-specific):** Report Builder, Talking Points, Proposals,
  firm-branded reports with custom colors/logo/disclosures, firm-wide sharing.
- **Excel add-in:** available as a paid add-on ("+$"), not bundled by default.
- **AI:** "Y," a named AI agent for fund comparison, screening, analysis and task
  automation — appears gated to Professional tier and above on the plans grid (claimed).
- **Data breadth:** 4,000+ metrics, 100,000+ securities; stocks/ETFs/CEFs bundled broadly,
  but mutual funds, bond data, alternatives data, and SMAs are each marked as extra-cost
  add-ons ("+$") even on disclosed top tiers; economic, sector/industry and ESG data
  included.
[EVIDENCE: https://ycharts.com/ + https://get.ycharts.com/plans/ — official — verified —
2026-09-02]

### L. Pricing / business model
No numeric self-serve pricing exists on the official site — the plans page is entirely
quote-gated ("Call ... to speak with a team member regarding pricing"). Four named tiers,
capability-differentiated (not $-labeled) on the official page:
- **Analyst** — entry tier: screeners/tables, dashboard/watchlist/alerts, charting, "most
  data."
- **Presenter** — proposal generation and select tools, basic equity/fund/index data,
  receive-shared-items only (no firm-wide sharing).
- **Professional** ("Most Popular") — all tools, fund/stock/economic data, firm-wide
  sharing, proposals & talking points, "Y" AI agent.
- **Enterprise** — for broker-dealers/OSJs/advisor networks: adds compliance controls,
  proprietary-model positioning, firm-wide implementation support.
[EVIDENCE: https://get.ycharts.com/plans/ — official — verified — 2026-09-02, no $ figures
present]

Secondary/practitioner figures (reported, unverified, gathered via browser search per the
program's search-budget fallback): G2 lists "YCharts Professional — $6,000/first user/
year"; Zoftware cites an "Analyst" tier "starting at approximately $3,600/year"; Moneywise
independently reports Standard $300/mo ($3,600/yr) and Professional $500/mo ($6,000/yr);
TraderHQ reports "$3,600–6,000/year." These four converge reasonably. One outlier,
WallStreetZen, cites much lower monthly consumer-style pricing (Basic $15/mo, Plus $35/mo,
Pro $70/mo) that could not be reconciled with the others — possibly a different/legacy
consumer product line or stale review content; flagged unresolved rather than averaged in.
[EVIDENCE: G2, Zoftware, Moneywise, TraderHQ, WallStreetZen — professional-review/
comparison tier — reported — 2026-09-02, via Google search snippets]

### M. Best ideas for UCT (hypotheses)
1. **Share-ready client collateral.** A one-click "export this chart/screen as
   branded, shareable content" (YCharts' Report Builder/Talking Points) could extend
   UCT's Community/Discord sharing into member-facing collateral — a "prepare a
   share-out" workflow UCT does not currently name.
2. **"Quick Extract" statement-to-portfolio onboarding.** Hypothesis: an analogous
   "paste/upload a broker statement or CSV → auto-populate Journal 2.0 positions" flow
   could lower onboarding friction for brokers not covered by the existing SnapTrade sync.
3. **AI gated to paid tiers, not free.** YCharts' "Y" agent is a Professional+ feature
   only — precedent that AI cost-gating by paid tier is an accepted norm in this market,
   relevant to any future Compass tiering decision.

### N. Bad ideas for UCT / anti-patterns
1. **Per-feature "+$" add-on lattice.** Even top disclosed tiers surcharge for mutual-fund
   data, bond data, alternatives data, SMAs, and the Excel add-in. Anti-pattern: a maze of
   hidden add-on costs erodes trust and multiplies support burden; UCT's flatter paid-gate
   model should not fragment this way.
2. **Fully phone-only, opaque pricing.** No self-serve numbers exist anywhere in the
   funnel. This fits a B2B advisor sales motion but is the wrong model if UCT ever sells a
   member-facing paid research tier, where self-serve Stripe checkout is the existing norm.

### P. Confidence
🟢 A and D (official homepage + official plans page, primary, directly fetched,
2026-09-02, richly detailed capability/data grid). 🟡 L pricing figures — ceiling: the
official page carries zero numbers; all $ figures are reported/secondary and one source
conflicts materially with the rest; a live sales quote or a screenshot of a logged-in
checkout would resolve. 🟡 M/N (hypotheses).

---

## 3. S&P Capital IQ Pro (`spglobal.com/market-intelligence`)

### A. Executive summary
**OBSERVATION.** S&P Capital IQ Pro is an enterprise financial-market-intelligence
platform — *"Transform Market Intelligence into Your Decisive Advantage."* It serves
investment banking, equity research, corporate strategy/development, private equity/VC,
and credit/risk professionals at large financial institutions. **Philosophy, one
sentence:** be the single integrated platform spanning public *and* private company data,
sell-side consensus estimates (via Visible Alpha), fixed income (via Markit), and
AI-assisted workflow tools — a data-breadth-and-workflow play for large teams, not a lean
or fast trading terminal. [EVIDENCE:
https://www.spglobal.com/market-intelligence/en/solutions/products/sp-capital-iq-pro —
official product page — verified — 2026-09-02]

### D. Capability map
- **Fundamentals/company coverage:** 109,000+ public companies (49,000 active with
  current financials) + 60M+ private companies (16M+ with recent financials, 1.3M+
  early-stage).
- **Estimates:** 140+ proprietary Capital IQ estimate metrics across 19,200+ companies in
  110+ countries, plus Visible Alpha integration (200M+ data points, 1M+ consensus line
  items sourced from 200+ broker analyst models) — the deepest estimates claim of the
  three products in this note.
- **Fixed income/credit:** 29M+ government/supranational/agency/corporate securities via
  Markit (pricing, analytics, reference data); 1.6M+ loan facilities (5,500+ with
  current-day live prices); RatingsDirect® is a related credit-ratings solution on the
  same platform.
- **Ownership:** 49,000+ public companies, 35,000+ institutions, 51,000+ funds, 337,000+
  insiders, 12,000+ activism campaigns.
- **Transactions/M&A:** 1.2M+ M&A deals (incl. 4,000+ spin-offs), 340K equity offerings,
  330K debt offerings, 907K+ funding rounds, 104K+ buybacks.
- **Macro/country risk:** major indicators (inflation, employment, GDP) plus country-risk
  coverage for 236 countries/territories.
- **Document intelligence/search:** AI-powered search across 1,800+ investment-research
  contributors — keyword locate, annotate, collaborate, export tables to Excel.
- **AI (named, scoped features):** ChatIQ (generative-AI assistant), Document Intelligence
  (filing/research search), Chart Explainer — explicitly marketed as "significant
  investments in Generative AI," each named for a distinct job rather than one generic
  "AI button."
- **Office tools:** a Capital IQ Pro Office Tools suite (Excel-plug-in family, implied by
  the page's "Office Tools" section header; exact Excel-plug-in feature list not itemized
  on this page).
- **Mobile:** a dedicated Capital IQ Pro mobile app.
- **Sector depth:** authoritative coverage named for Banking, Insurance, Real Estate,
  Energy, Metals & Mining, Media & Telecom, and Technology.
- **Sustainability/ESG:** a dedicated ESG data + visualization solution on the platform.
- **Support/certification:** 24x7x365 global support; a "Capital IQ Pro Academy"
  certification track.
[EVIDENCE: https://www.spglobal.com/market-intelligence/en/solutions/products/sp-capital-iq-pro
— official — verified — 2026-09-02]

### L. Pricing / business model
Entirely enterprise/quote-gated — the official page has no self-serve checkout and no
numeric pricing anywhere; every call to action is "Get in Touch," "Request Access,"
"Request a Demo," or "Request Follow Up" behind a sales-qualification form (business
email, company, industry, country, "what business challenges can we help you solve").
This is the strongest opaque-pricing posture of the three products here — by design, not
by omission. [EVIDENCE: same official page — verified — 2026-09-02]

Secondary/practitioner estimates (unverified, comparison/alternative-recommendation
sites — the evidence standard flags this tier as lower-quality and to be used cautiously,
included only because no primary figure exists at all): one comparison site estimates
roughly $12,000/user/year (an "Essentials" tier) rising to ~$20,000–25,000/user/year
("Standard"/"Advanced"); an independent comparison site separately estimates "$10,000+ per
user per year with mandatory long-term enterprise contracts." The two are directionally
consistent (five-figure-per-seat annual cost, multi-year contracts) but neither is
verifiable and exact figures should be treated as reported, not fact.
[EVIDENCE: GeminIQ blog and Amsflow comparison page — SEO/comparison tier — reported,
low-confidence — 2026-09-02, via Google search snippets]

### M. Best ideas for UCT (hypotheses)
1. **One company profile, unified across data provenance.** CIQ Pro's model puts public
   estimates, private-company data, ownership, and deal/transaction history on one company
   page regardless of source system. Hypothesis: a future UCT ticker/company detail page
   that unifies TickerPopup + fundamentals + ownership + Calendar earnings without separate
   modals would better serve the "research this company from scratch" workflow.
2. **Narrowly named, scoped AI features.** ChatIQ / Document Intelligence / Chart Explainer
   are each named for one job. Hypothesis: Compass/AI Search surfaces should be similarly
   named and scoped (rather than one generic "Ask AI" button) so users know what each tool
   is actually for and grounding expectations are clear per surface.
3. **Certification/onboarding track for a complex tool.** "Capital IQ Pro Academy" /
   "Get Certified" is an adoption device for a wide, complex feature set. Hypothesis: a
   lightweight "UCT power-user" onboarding track for Journal 2.0/Compass could raise
   feature-adoption depth, at a much smaller scale than CIQ Pro's enterprise academy.

### N. Bad ideas for UCT / anti-patterns
1. **Fully sales-gated pricing with zero self-serve tier.** Anti-pattern for TERMINAL-NEXT:
   its near-term audience is an internal desk and existing paying members who already
   expect self-serve Stripe checkout; a CIQ-Pro-style "talk to sales" wall for any UCT
   surface would be a regression from the current model.
2. **Breadth-over-speed positioning.** Nothing on the fetched page makes any real-time or
   low-latency claim — the entire pitch is coverage counts and AI-assisted research depth.
   Anti-pattern: a desk-trading terminal cannot copy a research-breadth-first philosophy at
   the expense of live/streaming performance; CIQ Pro is optimized for banking/research
   workflows, not intraday execution decisions, and TERMINAL-NEXT's primary persona is the
   opposite of that.

### P. Confidence
🟢 A and D (single official S&P Global product page, primary/tier-1, fetched 2026-09-02,
unusually rich and specific). 🔴 L pricing — evidence ceiling: no primary numeric pricing
exists publicly, by design; only unverified third-party estimates were found, and this
program's DO-NOT list forbids submitting the vendor's sales-qualification form to obtain a
real quote, so this ceiling cannot be raised within the current mandate — raising it would
require the owner independently requesting a quote. 🟡 M/N (hypotheses); the AI-feature
descriptions (ChatIQ etc.) are 🟡 claimed-only — no trial/demo was observed, only marketing
copy naming and one-line-describing each tool.

---

## GAPS (budget not reached / explicit ceilings)

- **Search channel used, per the preamble's fallback order:** WebFetch on known/guessed
  official URLs first (succeeded for TIKR homepage+pricing, YCharts homepage, YCharts
  official plans page; failed/403 or 404 for `ycharts.com/pricing` and the first two guessed
  S&P Global URLs); then ONE browser tab, opened and closed, running Google-search queries
  for (a) S&P Capital IQ Pro pricing, (b) the correct S&P Global product-page URL, (c)
  YCharts pricing triangulation, (d) YCharts "Timeseries Analysis" confirmation. No Bing
  fallback was needed. WebSearch itself was not attempted (confirmed exhausted per the
  program preamble).
- **TIKR:** no AI-feature page or trial/login was found or attempted; a professional vs.
  non-professional/institutional pricing split (common in this market) is NOT DETERMINED —
  only one consumer ladder is public.
- **YCharts:** no numeric self-serve pricing exists; the WallStreetZen low-dollar figures
  could not be reconciled with four converging higher figures and are flagged unresolved,
  not averaged in. The "Y" AI agent's actual behavior was not observed (claimed-only).
- **S&P Capital IQ Pro:** no self-serve pricing exists by design (evidence ceiling, see
  section 3.P); no demo/trial account was used, so ChatIQ, Document Intelligence, Chart
  Explainer, the Excel plug-in, and the mobile app are all described from marketing copy
  only, not observed directly. No official screenshots, demo pages, or video transcripts
  were consulted for any of the three products in this LIGHT pass (Section O — Screenshots
  — is out of scope for this appendix per the LIGHT-coverage instruction, sections A/D/L/M/
  N/P only).
- No practitioner interviews, Reddit/forum discussion, or video demo transcripts were
  consulted for any of the three products, consistent with the LIGHT/two-page-per-product
  budget for this merged appendix.

## SOURCES

1. TIKR homepage — https://www.tikr.com/ — official/tier-1 — verified — 2026-09-02
2. TIKR pricing — https://www.tikr.com/pricing — official/tier-1 — verified — 2026-09-02
3. YCharts homepage — https://ycharts.com/ — official/tier-1 — verified — 2026-09-02
4. YCharts official plans page — https://get.ycharts.com/plans/ — official/tier-1 —
   verified — 2026-09-02
5. S&P Capital IQ Pro product page —
   https://www.spglobal.com/market-intelligence/en/solutions/products/sp-capital-iq-pro —
   official/tier-1 — verified — 2026-09-02
6. Google search results page, query `"S&P Capital IQ Pro" pricing cost` (Bing/Google
   fallback per preamble) — aggregator, secondary — 2026-09-02 — surfaced GeminIQ and
   Amsflow pricing estimates (both SEO/comparison tier, low confidence)
7. Google search results page, query `YCharts pricing plans Basic Pro cost` — aggregator,
   secondary — 2026-09-02 — surfaced G2, Zoftware, Moneywise, TraderHQ, WallStreetZen
   pricing figures (review/comparison tier, reported)
8. Google search results page, query `"YCharts" "Timeseries Analysis" feature macro
   economic data` — aggregator, secondary — 2026-09-02 — corroborated the Timeseries
   Analysis feature name via an official YCharts blog snippet and Barchart.com/Globe and
   Mail syndicated coverage
9. G2 — YCharts Pricing 2026 (`g2.com`) — professional review site, reported — 2026-09-02
10. Zoftware — YCharts Pricing (`zoftwarehub.com`) — comparison/reported — 2026-09-02
11. Moneywise — YCharts review (`moneywise.com`) — professional review, reported —
    2026-09-02
12. TraderHQ — YCharts review (`traderhq.com`) — comparison/reported — 2026-09-02
13. GeminIQ — S&P Capital IQ pricing blog (`geminiq.com`) — SEO/comparison, low-confidence,
    reported — 2026-09-02
14. Amsflow — S&P Capital IQ Pro alternatives (`amsflow.com`) — SEO/comparison,
    low-confidence, reported — 2026-09-02

**Note on observed injected instructions:** no page fetched for this appendix contained
text directed at the agent (no prompt-injection attempts observed) — all content was
ordinary marketing/pricing/review copy.
