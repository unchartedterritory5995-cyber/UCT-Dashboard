---
id: B-VAL-01
title: Benchmark Universe Validation — Terminal-Next
role: Benchmark universe validator
wave: 1b
group: B
category: competitor
scope: Candidate benchmark universe (13 named products + ~20 gap candidates) for the Terminal-Next program
confidence: 🟡 overall
evidence_ceiling: Enterprise incumbents (Bloomberg, FactSet, LSEG Workspace, S&P Capital IQ Pro) publish no pricing and offer no trial; their in-product workflows are reachable only via university library terminals, official training content, or a subscription. Every enterprise price in this report is secondary/vendor-benchmark, not primary.
sources: 24 primary; 9 secondary
uct_relevance: high
status: draft
date: 2026-09-02
---

# Benchmark Universe Validation (B-VAL-01)

**Mission.** Validate the candidate benchmark universe against *"unique learning value for a small US equities-and-options desk and its retail-plus members,"* confirm current names/owners/availability/positioning, flag redundancy, and propose substitutions or additions — so the program studies ten to twelve products that each teach something different.

**Headline finding.** The candidate universe is **structurally miscast for UCT's shape**. It contains *four* prosumer-fundamentals products and *three* enterprise research workstations — seven of thirteen slots spent on two clusters — and **zero options-native products**, for a desk whose stated business is US equities *and options* with live options-flow and dark-pool surfaces. Three of the thirteen names also need correcting before any dossier is written: **FinChat is now Fiscal.ai**, **Refinitiv Eikon was sunset 30 June 2025** (so LSEG Workspace is a successor, not a peer), and **AlphaSense's differentiator changed** when it bought Tegus. Recommendation: 12 products at deep/standard/light, dropping TIKR, YCharts and S&P Capital IQ Pro to merged notes, and adding three options-native benchmarks.

**Method note.** All claims below carry a URL and a 2026-09-02 fetch date. Where a vendor's own page was unreachable to an automated fetcher (Cloudflare 403 on bloomberg.com, godelterminal.com, fiscal.ai, benzinga.com/pro, marketchameleon.com), evidence was recovered by **domain-restricted search over the vendor's own domain** — still tier-1/2 (official pages), but read through an index rather than fetched directly. Those are marked *(official domain, via index)*. Nothing in this report is sourced from the affiliate/SEO cluster that dominates several of these queries (see the **Evidence-hygiene warning** under Gödel Terminal).

---

## Part 0 — Three corrections to the candidate list, before any dossier is written

### 0.1 "FinChat (Fiscal.ai?)" — resolved: the company is Fiscal.ai; the product is Fiscal Terminal

**OBSERVATION.** FinChat rebranded to **Fiscal.ai** alongside a $10M Series A led by Portage Ventures. The company frames the rebrand as a pivot from a chat interface to financial *data infrastructure* — "to power modern financial data infrastructure through its Terminal and APIs." The current product names are **Fiscal Terminal** and **Fiscal.ai API**. Free tier plus Pro $49/mo ($39 annual) and Max $99/mo ($79 annual); API free trial is 100 companies / 250 calls per day.

**EVIDENCE.** `https://fiscal.ai/blog/series-a-announcement/`, `https://fiscal.ai/products/terminal/`, `https://fiscal.ai/pricing/`, `https://docs.fiscal.ai/docs/guides/free-trial` — Tier 1 (official product/pricing/dev docs), fetched 2026-09-02 *(official domain, via index; direct fetch returned 403)*. Corroborated by trade press: `https://blog.tmcnet.com/blog/rich-tehrani/financial/finchat-rebrands-as-fiscal-ai-raises-10m-series-a-to-build-the-future-of-financial-data-infrastructure.html` — Tier 8 (practitioner/trade). **Verified** (name, prices, tiers) · **claimed** (350,000 registered users, $13M total funding).

**INTERPRETATION.** The rebrand is not cosmetic. A product that was "ChatGPT for stocks" now sells the *pipes* — an API and MCP surface — with the terminal as one consumer of them. That is a different lesson than "AI chat over fundamentals."

**RELEVANCE TO UCT.** Speaks to whoever owns UCT's AI-search and data-access layer: it is a worked example of a small team deciding its durable asset is the data contract, not the chat box.

**CONFIDENCE.** 🟢 — vendor's own announcement, product page and pricing page all agree. Ceiling: none.

**RECOMMENDATION (hypothesis).** Rename the dossier slot to **Fiscal.ai**; a dossier filed under "FinChat" will be searched for by the wrong name in six months.

**OPEN QUESTION.** Does Fiscal.ai's MCP/API surface get used by third-party agents in practice, or is it a positioning artifact?

### 0.2 LSEG Workspace is Eikon's replacement, not its contemporary

**OBSERVATION.** LSEG withdrew every Eikon variant from sale on 1 January 2024 and **ceased the service at midnight GMT on 30 June 2025**. LSEG Workspace is the flagship successor, positioned as bringing "together trusted data, market-moving news, powerful analytics and AI-powered intelligence in one connected experience." Personas named on the product page: wealth advisors, investment bankers, sales and trading, analysts and PMs, academia. No public pricing; free trial + contact sales.

**EVIDENCE.** `https://www.lseg.com/en/data-analytics/products/workspace` — Tier 3 (official product page), fetched 2026-09-02. Sunset date: `https://community.developers.lseg.com/discussion/111041/eikon-scheduled-to-close` and `https://developers.lseg.com/en/api-catalog/eikon/side-by-side-integration` — Tier 4 (official developer portal), 2026-09-02; corroborated by `https://www.waterstechnology.com/trading-tech/7952541/lseg-officially-sunsets-eikon` — Tier 10 (trade press). **Verified.**

**INTERPRETATION.** Any Eikon screenshot, tutorial, or practitioner account the program finds is now **historical capability**. More usefully: LSEG ran an 18-month forced migration of an entire institutional user base off a beloved incumbent UI. That migration — not Workspace's feature list — is the transferable artifact.

**RELEVANCE TO UCT.** Directly relevant to the TERMINAL-CURRENT → TERMINAL-NEXT question. UCT will at some point ask members to move off a surface they have muscle memory for.

**CONFIDENCE.** 🟢 on the sunset date and successor relationship; 🟡 on what Workspace actually *feels* like (no trial reached, no primary screenshots).

**RECOMMENDATION (hypothesis).** Scope the LSEG dossier to **the migration**, not the feature inventory. Feature-inventorying a product the desk will never buy is the lowest-yield hour in this program.

**OPEN QUESTION.** Did LSEG publish migration-completion or churn figures? WatersTechnology coverage suggests the story is documented; the numbers were not reached.

### 0.3 AlphaSense's differentiator is now expert-call transcripts (Tegus), and its domain is a trap

**OBSERVATION.** AlphaSense positions as "the most trusted AI platform for actionable insights" over 500M+ premium documents — filings, broker research, earnings transcripts — and now **Tegus Expert Insights**, acquired for $930M (announced June 2024, closed July 2024) alongside a $650M raise at a $4B valuation. Named AI features: SuperAnalyst (an "always-on AI agent"), Deep Research, Smart Synonyms, Wall Street Insights, Sentiment Indices. No public pricing, no free tier.

**⚠️ Naming trap.** The financial product is at **alpha-sense.com**. **alphasense.com is a gas-sensor manufacturer owned by AMETEK** — an automated fetch of that domain returns oxygen and carbon-monoxide sensor datasheets. Any agent or teammate researching this product from the obvious domain will confidently write up the wrong company.

**EVIDENCE.** `https://www.alpha-sense.com/` — Tier 3 (official), fetched 2026-09-02. Wrong-company control: `https://www.alphasense.com/products/` — fetched 2026-09-02, returns AMETEK gas sensors. Acquisition: `https://www.prnewswire.com/news-releases/alphasense-completes-acquisition-of-tegus-302190934.html` — Tier 3 (official press release); `https://www.fintechfutures.com/m-a/alphasense-acquires-rival-tegus-for-930m-valuation-tops-4bn` — Tier 10. **Verified** (positioning, content universe, acquisition) · **claimed** (500M+ documents, 100,000+ expert transcripts).

**INTERPRETATION.** Pre-2024 AlphaSense taught *AI search over public documents*. Post-Tegus it teaches *owning a proprietary corpus no competitor can license* — the expert-call library is the moat, and the AI is the interface to it. That is a materially different lesson and it reframes the dossier.

**RELEVANCE TO UCT.** UCT's AI-search layer sits on top of a corpus. The question AlphaSense answers is whether the defensible asset is the retrieval quality or the corpus itself.

**CONFIDENCE.** 🟡 — positioning and the acquisition are verified; the *workflow* (what SuperAnalyst actually returns, how citations render) is marketing-claimed only, with no trial or public demo transcript reached.

**RECOMMENDATION (hypothesis).** Pin the correct domain in the program's source register with the AMETEK collision noted explicitly, or this error will be made again.

**OPEN QUESTION.** What does an AlphaSense answer's citation UX look like in practice — inline spans, document cards, or a source list? That is the transferable detail and it is behind the paywall.

---

## Part 1 — The thirteen candidates: name, owner, availability, positioning, persona, price, and the one thing each teaches

Format per row: **Exact current name · Owner · Availability · Their positioning (quoted ≤40 words) · Primary persona · Price posture · THE ONE THING IT TEACHES.**

### 1. Bloomberg Terminal · Bloomberg L.P. · GA

> "The most powerful, flexible tool for financial professionals who need real-time data, news, and analytics."

Persona: buy-side, sell-side and corporate professionals — traders, analysts, PMs, compliance, IR. Bloomberg names a network of "more than 350,000" users. Now includes **ASKB**, a conversational AI interface layered onto existing Terminal workflows. **Price: not published by Bloomberg.** Secondary vendor-benchmark reporting puts a single seat at ~$2,665/mo (~$31,980/yr), falling to ~$28,320/yr on multi-seat contracts.

**THE ONE THING IT TEACHES:** *the function-code grammar* — a mnemonic command vocabulary (`DES`, `GP`, `HELP HELP`) that turns a workstation into a language its users think in. Every alternative in this universe positions against Bloomberg's price; only Gödel copies its grammar. That grammar, not the data, is why the seat is sticky.

**EVIDENCE.** `https://professional.bloomberg.com/products/bloomberg-terminal/` and `https://www.bloomberg.com/professional/insights/series/terminal-essentials/` — Tier 3/5 (official product page + official training series), 2026-09-02 *(official domain, via index; direct fetch 403)*. **Verified** positioning/persona · **reported** pricing (`https://costbench.com/software/financial-data-terminals/bloomberg-terminal/`, `https://www.vendr.com/marketplace/bloomberg` — Tier 12/13, vendor-benchmark aggregators).
**CONFIDENCE.** 🟢 on identity and positioning; **🔴 on price and on any in-product workflow claim.** Ceiling: no public pricing, no trial, no public demo. Named lift: a university library terminal session (Montclair State, UW, NYU Law and John Cabot all publish access guides) plus **Bloomberg Market Concepts**, Bloomberg's own free e-learning course. The owner could plausibly reach a terminal through a local university library — that is the single highest-value evidence upgrade available in this program.
**RELEVANCE TO UCT.** The desk-first persona. UCT is building a workstation, and Bloomberg is the archetype of "the vocabulary is the product."
**OPEN QUESTION.** What does ASKB actually do — retrieval over Terminal data, or an agent that drives functions? That distinction is exactly the TERMINAL-NEXT AI question.

### 2. LSEG Workspace · London Stock Exchange Group · GA (Eikon sunset 30 Jun 2025)

See §0.2. **Price: not published; free trial + contact sales.**
**THE ONE THING IT TEACHES:** *a forced platform migration executed to a published deadline* — withdraw from sale, run 18 months of side-by-side, then cease the old service on a stated date.
**CONFIDENCE.** 🟢 identity/migration · 🟡 workflow. Ceiling: no trial reached.

### 3. FactSet Workstation · FactSet Research Systems · GA

> "Real-time financial data, AI-powered research, investment analytics and automated workflows across 800+ data sources in one platform."

Persona: buy-side and sell-side analysts, PMs, bankers, and corporates. Named AI architecture: the **Intelligent Platform** initiative, **FactSet Mercury** (a "conversational knowledge engine") reached through a *global assistant*; **IRN 2.0** as a Mercury-backed research-management layer; an **agent registry** for FactSet-built, client-built and third-party agents; and **MCP** as the data-access protocol ("ensures that FactSet data flows in with full precision and traceability"). **Price: not published.**

**THE ONE THING IT TEACHES:** *the only enterprise incumbent publicly documenting an agent platform architecture* — a registry of first- and third-party agents plus MCP as the traceable data interface. That is the shape of the problem UCT's own AI layer has, described by a vendor with 800+ data sources to keep straight.

**EVIDENCE.** `https://www.factset.com/marketplace/catalog/product/factset-workstation`, `https://www.factset.com/ai`, `https://investor.factset.com/news-releases/news-release-details/factset-unveils-intelligent-platform-initiative-supercharge` — Tier 3/4 (official catalog, official AI page, official investor release), 2026-09-02 *(official domain, via index)*. **Claimed** (marketing) for capability; **verified** for the existence and naming of the architecture.
**CONFIDENCE.** 🟡 — the architecture is officially described but nothing demonstrates it. Ceiling: no pricing, no trial; FactSet does publish a public product-tour page (`factset.com/tour`) which is the named lift.
**RELEVANCE TO UCT.** The AI-search/coaching layer, and the "one engine, three doors" indicator platform question.

### 4. S&P Capital IQ Pro · S&P Global Market Intelligence · GA (launched Sep 2021)

Positioned as S&P Global's "most comprehensive desktop solution with a vastly expanded range of datasets." Coverage claimed at launch: 62,000 public and **18 million private** companies, S&P Global Ratings credit research, Dow Jones Newswires. **Capital IQ Pro Labs** is a public-facing beta channel where users test pre-release apps (Topical Key Phrases, Trending Topics, News Sentiment, Kensho NERD/Classify). **Price: not published.**

**THE ONE THING IT TEACHES:** *private-company breadth as the bundling argument*, and **Labs as a shipped-beta channel** — a vendor-run surface where customers opt into unfinished features. That second one is the transferable idea; UCT ships dark and flag-gated, which is the same instinct without the customer-visible door.

**EVIDENCE.** `https://press.spglobal.com/2021-09-07-S-P-Global-Market-Intelligence-launches-S-P-Capital-IQ-Pro,-a-new-brand-for-its-most-comprehensive-desktop-solution` — Tier 3 (official press release), 2026-09-02; `https://library.uncw.edu/eresources/sp_capital_iq_pro` — Tier 9 (university library guide). **Claimed** (coverage figures are the vendor's).
**CONFIDENCE.** 🔴 — the strongest evidence is a five-year-old launch release. Ceiling: no pricing, no trial, no current public product page reached. Named lift: a university library guide walkthrough or a subscriber screenshot.

### 5. Koyfin · Koyfin Inc. · GA

> "The industry's leading tools at a price to suit everyone."

Persona: individual investors → advisors. **Public, complete price ladder:** Free $0 · Plus $39/mo · Premium $79/mo · Advisor Core $209/mo · Advisor Pro $299/mo, with annual discounts to ~30%. Public help centre with **release notes**, FAQ, functionality docs and a community forum.

**THE ONE THING IT TEACHES:** *the cleanest published free→prosumer→advisor ladder in the universe*, with the gates chosen deliberately — the free tier gives 2 years of financials, 2 watchlists, 2 dashboards; Plus buys **history depth** (10Y) and **unlimited objects**; Advisor tiers buy **client reporting and custodian integrations**. Depth and count are the levers, not feature removal.

**EVIDENCE.** `https://www.koyfin.com/pricing/` and `https://www.koyfin.com/help/` — Tier 3/1 (official pricing + official help centre), fetched 2026-09-02. **Verified.**
**CONFIDENCE.** 🟢. Ceiling: none — free tier plus public docs make this fully checkable.
**RELEVANCE TO UCT.** Directly informs member tiering: UCT already runs a free-pages whitelist and a paid tier, and Koyfin is the worked example of what to gate.

### 6. TradingView · TradingView Inc. · GA

> "Always an informed decision." · "Look first / Then leap." · a charting platform and social network used by "100M+ traders and investors."

**Public price ladder:** Free $0 forever · Essential $12.95 · Plus $29.95 · Premium $59.95 · Ultimate $199.95 (monthly-equivalent, annual billing). Gates are **charts per tab (1/2/4/8/16), indicators per chart (5/10/25/50), alerts (2/20/100/400/1000), historical bars (10K/20K/40K)** and intraday history depth. **Supercharts** is the charting surface; brokerage integration is native.

**THE ONE THING IT TEACHES:** *quantity-metered gating on a free-forever base* — nothing is removed, everything is counted. Plus a **community as a product surface** (published ideas attached to symbols), which no other candidate has.

**EVIDENCE.** `https://www.tradingview.com/pricing/` — Tier 3, fetched 2026-09-02; `https://www.tradingview.com/about/` — Tier 3, 2026-09-02 *(via index)*. **Verified.**
**CONFIDENCE.** 🟢. Ceiling: none.
**RELEVANCE TO UCT.** Both a benchmark and a desk tool; the chart-widget and alert-quota questions land here.

### 7. AlphaSense · AlphaSense Inc. · GA — see §0.3

**THE ONE THING IT TEACHES:** *a proprietary corpus (Tegus expert calls) as the moat, with AI as its interface.* **CONFIDENCE 🟡**, ceiling: paywalled, no trial.

### 8. Fiscal.ai (formerly FinChat) · GA — see §0.1

**THE ONE THING IT TEACHES:** *the pivot from an AI chat product to a data-infrastructure product*, with the terminal demoted to one client of the API.

### 9. TIKR · TIKR.com · GA

Free $0 · Plus $24.95 · Pro $54.95 · Ultimate $119.95 (monthly). Positioning: help investors "supercharge their investment analysis." **Data is licensed, and TIKR says so publicly**: S&P Global Capital IQ as the main dataset (20 years of history on Pro), Morningstar, plus Financial Modeling Prep as a secondary set — coverage stated as 100,000+ stocks across 92 countries.

**THE ONE THING IT TEACHES:** *a thin workflow over licensed institutional data, priced at 1/500th of the source* — and, unusually, **naming its vendors in a public support article**, including the caveat that CapIQ recategorises line items for comparability.

**EVIDENCE.** `https://www.tikr.com/pricing`, `https://support.tikr.com/hc/en-us/articles/5403705233947-What-is-the-source-of-your-data-Why-is-there-a-potential-error-in-the-financial-data` — Tier 3/1, fetched 2026-09-02. **Verified.**
**CONFIDENCE.** 🟢. Ceiling: none.
**⚠️ Redundancy.** Its *workflow* is Koyfin's with a different price. See Part 2.

### 10. Quartr · Quartr AB · GA

Products: **Quartr Pro** (desktop + mobile, contact sales), **Quartr API** ("The world's leading IR data layer," "AI-ready," 65 markets), and a **free mobile app** covering 15,000+ public companies with live calls and near-zero-delay real-time transcripts, plus a free mobile AI chat over IR material. Named customers on the pricing page include Morningstar, Stifel, Yahoo, Janus Henderson — and **Perplexity**.

**THE ONE THING IT TEACHES:** *a free consumer app funded by an institutional data API* — the app is the corpus's shop window, and the same transcripts are sold as an AI-ready feed. Note the Perplexity relationship: Quartr is the live-transcript supplier inside a competitor's AI finance product.

**EVIDENCE.** `https://quartr.com/pricing`, `https://quartr.com/products/mobile-app`, `https://quartr.com/products/quartr-api` — Tier 3, fetched 2026-09-02. **Verified** (free app, coverage claims are the vendor's).
**CONFIDENCE.** 🟢 on the model; 🟡 on Pro (no pricing, no trial).

### 11. YCharts · YCharts Inc. · GA

> "Transforming how advisors and asset managers operate with intelligent automation that accelerates insights, personalizes engagement, and drives growth."

Persona: **financial advisors, large RIAs, asset managers and wholesalers** — proposal generation, client reporting, CRM integrations (Orion, Redtail, Salesforce). An AI agent named **"Y."** Public *plans* page exists (Fundamental / Analyst & Presenter / Professional) but **no public prices**.

**THE ONE THING IT TEACHES:** *the advisor-proposal workflow* — building a client-facing document out of market data. **This is a different persona from UCT's.** UCT's members are traders, not advisors preparing suitability proposals.

**EVIDENCE.** `https://ycharts.com/`, `https://get.ycharts.com/plans/` — Tier 3, fetched 2026-09-02. **Verified** persona · **claimed** capability.
**CONFIDENCE.** 🟡. Ceiling: no public prices.
**⚠️ Persona mismatch.** See Part 2.

### 12. Benzinga Pro · Benzinga · GA

Public tiers: **Free · Basic (~$27–37/mo) · Essential $197/mo ($1,997/yr ≈ $166.42/mo, ~17% off) · Options Mentorship ~$457/mo**; 14-day trial, no card. Essential modules: real-time Nasdaq Basic quotes, **Audio Squawk**, real-time Scanner over 3,000+ stocks, Calendar Suite, Signals, Sentiment Indicators, seven chat rooms, Benzinga AI, Benzinga Edge research. Public help centre at help.benzinga.com.

**THE ONE THING IT TEACHES:** *the news-terminal-plus-community bundle for the retail-plus trader* — a squawk feed, moderated chat rooms with named traders, and a mentorship upsell. **This is the closest persona match in the entire universe to UCT's paying members**, and the closest business-model match to UCT's own trading room + Discord + wire.

**EVIDENCE.** `https://www.benzinga.com/pro/pricing`, `https://help.benzinga.com/en/articles/2067149-what-is-the-difference-between-subscription-levels`, `https://www.benzinga.com/pro/feature/trading-mentorship/` — Tier 3/1, 2026-09-02 *(official domain, via index; direct fetch 403)*. **Verified** tiers and modules; the $27 vs $37 Basic figure varies between sources → **reported**, needs a trial to settle.
**CONFIDENCE.** 🟡 (🟢 on structure, 🟡 on the exact Basic price). Ceiling: a 14-day trial would resolve everything — cheap, and the owner could supply it.

### 13. Gödel Terminal · Gödel Terminal · GA

> "A financial terminal for modern research teams" · "Institutional-grade information at 5% of the cost of the big boys."

**Public price:** $118/mo or **$996/yr per seat**; 14-day free trial opening "most of Gödel"; team/enterprise on request; **FINRA-licensed users pay a $30/mo regulatory surcharge** ($148/mo, or $996 + $360/yr). Persona: hedge funds, RIAs, family offices, research teams, and individual traders. Command bar opened with **backtick**, then a Bloomberg-style mnemonic (`DES AAPL`). Data: real-time **Nasdaq TotalView** with Level 2 depth-of-book, SEC filings from inception via EDGAR, financials, global equities, options chains, FX and commodities. **Public documentation at docs.godelterminal.com.**

**THE ONE THING IT TEACHES:** *this is the closest structural analog to TERMINAL-NEXT in the universe* — a small team shipping a web terminal that deliberately borrows the incumbent's command grammar so buy-side users arrive already fluent, priced two orders of magnitude below it, with a self-serve trial and public docs. Also note the **FINRA surcharge as a price line**: professional-status data licensing is passed through explicitly rather than hidden.

**EVIDENCE.** `https://godelterminal.com/pricing/`, `https://godelterminal.com/`, `https://godelterminal.com/traders/`, `https://docs.godelterminal.com/`, `https://start.godelterminal.com/` — Tier 3/1, 2026-09-02 *(official domain, via index; direct fetch 403)*. **Verified** pricing/positioning · **claimed** data coverage.
**CONFIDENCE.** 🟢 on price/positioning/availability; 🟡 on data coverage and on how good the product actually is.

**⚠️ EVIDENCE-HYGIENE WARNING — read before writing this dossier.** Gödel Terminal's search surface is **dominated by affiliate content**. A generic query returns `godeldiscount.com` (a discount-code site publishing "reviews," "commands" and "data-coverage" pages), `godelguide.com` ("Godel Guide — Learn To Use Godel Terminal"), plus SEO review farms — **eight of nine results on the first generic query were non-primary, and several read as first-party documentation.** These are the exact source class the preamble bars. Every Gödel fact above was re-derived from `godelterminal.com` / `docs.godelterminal.com` only. **Any Gödel dossier that cites godeldiscount.com or godelguide.com should be rejected and re-run.** Note also that these pages were the origin of a widely-repeated "$31,980/yr Bloomberg" comparison table — a number that traces to affiliate content, not to Bloomberg.

**OPEN QUESTION (highest value in this report).** Gödel's 14-day trial is free and self-serve. **Can the program take it?** That converts the single most instructive benchmark from 🟡 to 🟢 — direct demonstration of a command-grammar terminal, at zero cost, with no purchase.

---

## Part 2 — Redundancy analysis

**OBSERVATION.** Seven of thirteen candidate slots sit in two clusters that teach one lesson each.

**Cluster A — prosumer fundamentals (four products): Koyfin · TIKR · Fiscal.ai · YCharts.**
All four are web apps over licensed fundamentals with dashboards, screeners and charts. Koyfin and TIKR are near-identical in workflow and differ mainly in price ladder and data vendor. Fiscal.ai is genuinely differentiated *only* by the AI-native + API/MCP angle. YCharts is differentiated by persona (advisor proposals) — which is the wrong persona for a trading desk.

**Cluster B — enterprise research workstations (three products): LSEG Workspace · FactSet · S&P Capital IQ Pro.**
Same persona (institutional analyst/PM), same bundling logic (one desktop, many datasets), same evidence ceiling (no pricing, no trial), and — for a small desk — the same conclusion: unreachable and mostly irrelevant. Three dossiers here buy one lesson three times.

**Cluster C — a two-product cluster nobody flagged: Bloomberg · Gödel Terminal.**
These overlap *deliberately* — Gödel copies Bloomberg's command grammar. **This overlap is the point and should be preserved at full depth**, because the pair is a natural experiment: same interaction model, 30× price difference, one built by a giant and one by a small team. That is the single most program-relevant comparison available.

**INTERPRETATION.** Redundancy is only a problem when the overlap teaches nothing. A/B are redundant; C is a designed contrast.

**RECOMMENDATION (hypothesis).**
- **Keep at full depth:** Koyfin (Cluster A's best-documented tiering example, free tier, public help centre).
- **Downgrade to light:** Fiscal.ai — one dossier, scoped to the API/MCP pivot, not a feature tour.
- **Merge into Koyfin's dossier, no standalone slot:** **TIKR** — one paragraph on its price ladder and its public naming of S&P CapIQ/Morningstar/FMP as vendors. Nothing else it does is distinguishable from Koyfin at this altitude.
- **Drop from the terminal study:** **YCharts** — advisor-proposal persona. Retain the name for a *later* study of member-facing reporting, if the program ever runs one.
- **Cluster B:** keep **FactSet at standard** (the only one publicly documenting an agent/MCP architecture — the differentiated lesson), **LSEG Workspace at light** scoped to the Eikon migration, and **merge S&P Capital IQ Pro into FactSet's dossier** as a comparison paragraph on private-company breadth and the Labs beta channel. Its own evidence ceiling (🔴, best source a 2021 press release) does not justify a slot.
- **Cluster C:** both stay deep.

**RELEVANCE TO UCT.** This frees four slots for the gap identified in Part 3.

**CONFIDENCE.** 🟡 — the redundancy judgement rests on published positioning and pricing, which is solid; the claim that TIKR's *workflow* is indistinguishable from Koyfin's is inferred from feature lists, not from side-by-side use. Ceiling: both have free tiers, so a one-hour side-by-side would settle it.

**OPEN QUESTION.** Is there a Koyfin/TIKR difference in **screener expressiveness** (custom formulas) material enough to justify both? Koyfin gates "unlimited custom data/formulas" at Premium; TIKR's equivalent was not established.

---

## Part 3 — Gaps in the universe, and three recommended additions

**OBSERVATION.** The candidate list contains **no options product at all** — not flow, not volatility, not positioning, not structure. UCT is described as running live options-flow and dark-pool surfaces and an internal desk trading US equities *and options*. This is the largest and most consequential gap, and it is not close.

I surveyed the contract's gap list. Findings, grouped:

**(a) Options flow / unusual activity — the real gap.**
- **Unusual Whales** — Retail Basic $34/mo · Retail Pro $51/mo · Retail Max $82/mo (annual $404/$605/$980); **free tier with 15-minute-delayed flow**; options flow across all US exchanges, dark-pool prints, GEX heatmaps, Greeks dashboards. Positioning: "the tools and data behind the internet's largest options trading community." Ships a **Discord bot** for live flow alerts, a public API with **OpenAPI spec**, a **public MCP server**, and a `skill.md`. Source: `https://unusualwhales.com/pricing` — Tier 3, fetched 2026-09-02. **Verified.**
- **SpotGamma** (TenTen Capital LLC) — Essential $99/mo ($891/yr) · Alpha $299/mo ($2,691/yr). Dealer-positioning analytics: Equity Hub (3,500+ names), TAPE, and **HIRO** ("Hedging Impact Real-Time Options," gated to Alpha), Volatility Dashboard, TRACE. Positioning: "Where options flow the markets go" / "See what the professionals see." Sources: `https://spotgamma.com/`, `https://spotgamma.com/subscribe-to-spotgamma/`, `https://support.spotgamma.com/hc/en-us/articles/50272097356819-What-is-included-in-each-SpotGamma-subscription-plan-Essentials-vs-Alpha` — Tier 3/1, 2026-09-02. **Verified.**
- **Market Chameleon** — free tier plus Premium (7-day trial; Premium adds bulk downloads, 25/rolling-24h). Core: **earnings implied moves vs historical benchmarks**, ATM straddle screeners, IV movers, per-ticker "implied move and IV crush" pages, peer volatility comparison. Public welcome guide. Sources: `https://marketchameleon.com/Premium`, `https://marketchameleon.com/Subscription/Compare`, `https://marketchameleon.com/upcoming-earnings-implied-moves-and-historical-benchmarks` — Tier 3, 2026-09-02. **Verified.**
- **OptionStrat** — free tier (15-min delayed, ~10% of flow) · ~$50/mo for live flow, filters, alerts, performance tracking, plus the profit calculator and strategy **Optimizer** (pick sentiment + target date, rank strategies by return or probability). Sources: `https://optionstrat.com/membership`, `https://optionstrat.com/flow`, `https://optionstrat.com/faq` — Tier 3, 2026-09-02. **Verified.**
- **Cheddar Flow / FlowAlgo** — no primary evidence reached. Secondary reporting puts Cheddar Flow at ~$85–99/mo and FlowAlgo at ~$149/mo, but **one source explicitly could not confirm FlowAlgo's pricing or service status as of July 2026**. **Do not add either**: Cheddar Flow is redundant with Unusual Whales, and FlowAlgo's status is unverified. Source: `https://bullishbears.com/flowalgo-review/`, `https://bullishbears.com/cheddar-flow-review/` — Tier 11 (professional review), 2026-09-02. **Reported only.**

**(b) AI-native research beyond AlphaSense/Fiscal.ai — mostly the wrong persona.**
- **Rogo** (rogo.ai → **rogo.com**) — "AI for the most ambitious firms in finance"; investment banks and institutional investors; named customers Truist Securities, Nomura, Baird; outputs Excel models, investment memos, diligence materials, slide decks. Claims 50,000+ bankers/investors, 350+ institutions. Enterprise, no pricing. Source: `https://rogo.com/` — Tier 3, 2026-09-02.
- **Hebbia** — products **Max** and **Matrix**; "AI built for the rigor of finance"; connectors to FactSet, S&P Capital IQ, PitchBook, Preqin, Third Bridge, Guidepoint, Snowflake, Databricks. Enterprise, no pricing. Source: `https://www.hebbia.com/` — Tier 3, 2026-09-02.
- **Daloopa** — "The Platform Powering Public Equity Professionals"; extracts and validates fundamentals/KPIs for 6,000+ companies with 14 years of history, **source-linked and auditable**; products include Daloopa Scout, **Daloopa MCP**, API, Excel Add-In. Claims 185+ hedge funds/mutual funds/banks. Source: `https://www.daloopa.com/` — Tier 3, 2026-09-02.
- **Fintool** — ⚠️ **fintool.com 301-redirects to microsoft.com/en-us/microsoft-365**, so the obvious domain is *not* the product. Fintool the AI equity-research copilot (formerly **Blocktool**, founded 2022, San Francisco) works over SEC filings and earnings/conference transcripts with cited answers; pricing undisclosed. **No primary page reached.** Sources: `https://www.welcome.ai/solution/fintool` (Tier 12), `https://www.perplexity.ai/api-platform/case-studies/fintool` (Tier 8, a partner case study) — 2026-09-02. **Reported.**
- **Perplexity Finance** — a free finance vertical (ticker pages, live quotes, candlestick charts, heatmaps, options and crypto, an Earnings Hub that transcribes and summarises calls near-real-time), with **Plaid** account linking. Its **data-partner map is the interesting artifact**: SEC/EDGAR, FactSet, S&P Global, Morningstar, LSEG, Financial Modeling Prep, **Quartr** (live transcripts), Coinbase, Polymarket. Sources: secondary only (Tier 8/11/12) — `https://sidsaladi.substack.com/p/perplexity-finance-101-2026-the-complete`, `https://helmterminal.dev/blog/perplexity-stock-research`. **Reported.**
- **Fey** — ⚠️ **DO NOT ADD. Fey was acquired by Wealthsimple (announced 27 Aug 2025) and sign-ups are closed**; fey.com now reads "Fey joined Wealthsimple." It was a Montreal design-led research tool with natural-language screening and a command palette. It is **historical capability**. Sources: `https://newsroom.wealthsimple.com/wealthsimple-acquires-investment-research-platform-fey` (Tier 3, official), `https://betakit.com/wealthsimple-acquires-fey-to-bolster-its-investment-research-capabilities/` (Tier 10), `https://fey.com/` (Tier 3) — 2026-09-02. **Verified.**

**(c) Trader-desk platforms.** **thinkorswim** (Charles Schwab) runs as Desktop / Web / Mobile, free to Schwab clients, with thinkScript, OnDemand replay and full options chains — already a named desk-tool slot; Schwab announced further 2026 enhancements including near-24/7 crypto futures. **Trade Ideas** — TI Basic $89/mo ($1,068/yr), TI Premium $178/mo ($2,136/yr); AI scanner, 500+ data points, backtesting, paper trading, auto-trading. **Sierra Chart** ~$36/mo platform + ~$11/mo Denali data (futures-centric). **DAS Trader Pro** ~$120/mo (waived above 200k shares/mo) + $18–68/mo data (equities day-trading execution). Sources: `https://www.schwab.com/trading/thinkorswim/desktop` and `https://pressroom.aboutschwab.com/press-releases/press-release/2026/Schwab-Announces-Latest-Round-of-Enhancements-to-Retail-Trading-Experience/default.aspx` (Tier 3, official), `https://www.trade-ideas.com/pricing/` (Tier 3), Sierra/DAS via Tier 11/12 reviews — 2026-09-02.

**(d) Event/catalyst.** **Wall Street Horizon** — ⚠️ **owned by TMX Group, not LSEG** (acquisition announced 7 Nov 2022); 11,000+ companies, 40+ forward-looking corporate event types; distributed through Open:FactSet and Interactive Brokers. It is a **data vendor, not a workstation** — a source reference, not a benchmark. **EarningsWhispers** — whisper numbers, earnings calendar, sentiment/grades, implied volatility and average moves; free through ~$49.95/mo. Also a data/content source more than a workflow to study. Sources: `https://www.wallstreethorizon.com/`, `https://s21.q4cdn.com/671813756/files/doc_news/2022/11/1/TMX-Group-Announces-Acquisition-of-Wall-Street-Horizon-2022.pdf` (Tier 3, official), `https://www.earningswhispers.com/` (Tier 3) — 2026-09-02.

**(e) Macro.** **Trading Economics** — "20 million indicators from 196 countries," free web tier, paid data/API, Excel add-in. **MacroMicro** — MM Prime / **MM Max ~US$27/mo** for individuals, MM Business / API / custom for enterprise; the differentiator is **500+ proprietary indicators built by an in-house macro team** plus a chart-first product and a subscriber price-lock. Sources: `https://tradingeconomics.com/` (Tier 3), `https://support.macromicro.me/hc/en-001/articles/15554535025423-Subscription-Plans-for-Individuals-MM-Prime-MM-Max` (Tier 1, official help centre) — 2026-09-02.

**INTERPRETATION.** The AI-native cluster (Rogo, Hebbia, Fintool, Daloopa) all serve **deal work and model building at institutions** — memos, diligence, Excel. None of them is a trading desk's tool, and none teaches a workflow a UCT member would recognise. Their transferable idea is a *single sentence*, best absorbed into an existing dossier rather than given a slot: **Daloopa's "source-linked, auditable" framing** is the same instinct as a groundedness rail — every number traceable to the filing it came from. Similarly, Perplexity Finance's value here is its **partner map**, which shows what a free AI finance surface must license (and that Quartr sits inside it).

**RECOMMENDATION — at most three additions, in priority order (hypotheses).**

1. **Unusual Whales — ADD at DEEP.** The single closest product to UCT's own shape in the entire surveyed set: options flow *and* dark pool *and* GEX, distributed partly **through Discord**, priced at retail-plus ($34–82/mo) with a delayed free tier. And it is the **only benchmark found that ships an agent-readable product surface** — OpenAPI spec, a public MCP server, and a `skill.md`. For a program designing a workstation with an AI layer, a competitor publishing "here is how an agent uses us" is a primary artifact, not a footnote.
2. **SpotGamma — ADD at STANDARD.** Productised dealer positioning. Two things to learn: how you *explain* gamma/dealer-hedging to a retail-plus audience without lying, and a tiering decision worth studying — the **real-time** indicator (HIRO) is the entire jump from $99 to $299. Real-time-as-the-upsell is a pricing hypothesis UCT can test.
3. **Market Chameleon — ADD, in the fourth DESK-TOOL slot.** Earnings implied move vs historical benchmark, IV crush, straddle screeners — the analytics layer around an earnings calendar, which is a workflow UCT visibly has. Free tier plus a public guide makes it cheap to verify. **Runner-up: OptionStrat** ($50/mo, free delayed tier), which is the better choice *if* the program decides the missing desk workflow is **structure selection** (payoff diagrams, the Optimizer) rather than **earnings/vol analytics**. Pick one; both is redundancy.

**Explicitly NOT added, with reasons:** Fey (acquired, closed — historical); FlowAlgo (status unverified); Cheddar Flow (redundant with Unusual Whales); Rogo / Hebbia / Fintool / Daloopa (institutional deal-work persona; Daloopa's auditability idea absorbed into the AlphaSense dossier); Perplexity Finance (free, general-purpose; its partner map absorbed into the Quartr dossier); Wall Street Horizon and EarningsWhispers (data vendors, not workstations — log in the source register); Trading Economics and MacroMicro (macro-data breadth; UCT's macro surface is its own breadth/COT rails, and neither product teaches a workstation lesson — MacroMicro is the more interesting of the two if a slot ever opens, for its proprietary-indicator model); Sierra Chart and DAS Trader (futures/equities execution platforms; wrong asset emphasis for an options-inclusive desk).

**CONFIDENCE.** 🟢 that the options gap exists and that the three additions are options-native and differentiated from each other (flow/dark-pool · dealer positioning · earnings-vol analytics). 🟡 on the *ranking* between them and on whether Market Chameleon or OptionStrat is the better fourth desk tool — that depends on a UCT workflow decision this role cannot make. Ceiling on the three additions: **none** — all have free or trial tiers and public docs.

**OPEN QUESTION.** Does UCT's desk actually trade options *structures* (spreads, condors) or primarily directional single-legs? The answer decides Market Chameleon vs OptionStrat and this role has no basis to guess.

---

## Part 4 — Evidence accessibility and likely ceiling per product

Rating: 🟢 documented publicly (free tier and/or public docs → claims are checkable) · 🟡 partial (public marketing/pricing but the product is behind a wall) · 🔴 paywalled (no pricing, no trial, no public workflow evidence).

| Product | Public docs / help centre | Free tier | Trial | Public pricing | **Ceiling** | Named lift |
|---|---|---|---|---|---|---|
| Bloomberg Terminal | Official *Terminal Essentials* series; Bloomberg Market Concepts e-learning | No | No | **No** | **🔴** | University library terminal session + BMC course |
| LSEG Workspace | developers.lseg.com (public) | No | Yes (sales-gated) | No | 🟡 | Sales trial; or migration coverage in trade press |
| FactSet Workstation | Marketplace catalog, `factset.com/ai`, `factset.com/tour` | No | Demo only | No | 🟡 | Public product tour; official AI architecture pages |
| S&P Capital IQ Pro | 2021 launch release; university library guides | No | No | No | **🔴** | Library guide walkthrough or subscriber screenshot |
| Koyfin | **Full help centre + release notes + forum** | **Yes** | Yes | **Yes, complete** | **🟢** | — |
| TradingView | Extensive public docs + Pine docs | **Yes (forever)** | 14–30 days | **Yes, complete** | **🟢** | — |
| AlphaSense | Rich public resource library; no product docs | No | Demo only | No | 🟡 | Demo or a practitioner interview |
| Fiscal.ai | Help centre + **public API docs** | **Yes** | API free trial | **Yes** | **🟢** | — |
| TIKR | Public support centre (incl. data-source article) | **Yes** | — | **Yes** | **🟢** | — |
| Quartr | Public feature pages | **Yes (mobile app)** | — | Pro/API: no | 🟡 (🟢 for the free app) | Free app covers the consumer half |
| YCharts | Public plans page, no prices | No | Yes | No | 🟡 | Free trial |
| Benzinga Pro | **help.benzinga.com** (public) | Yes (Free tier) | **14 days, no card** | **Yes** | 🟡→🟢 | **Take the 14-day trial** |
| Gödel Terminal | **docs.godelterminal.com** (public) | No | **14 days, self-serve** | **Yes** | 🟢 | **Take the 14-day trial** ⚠️ affiliate-source hazard |
| *Unusual Whales* (add) | **OpenAPI spec + MCP server + skill.md** | **Yes (15-min delayed)** | API 1 week | **Yes** | **🟢** | — |
| *SpotGamma* (add) | Public support centre | No | — | **Yes** | 🟢 | — |
| *Market Chameleon* (add) | Public welcome guide | **Yes** | 7 days | Partial | 🟢 | — |
| *OptionStrat* (alt) | Public tutorials + FAQ | **Yes (delayed, ~10% flow)** | — | **Yes** | **🟢** | — |
| thinkorswim (desk) | Schwab learning centre (public) | **Free to Schwab clients** | — | Free | **🟢** | — |
| Finviz (desk) | **Public knowledge base + help** | **Yes** | 7 days | **Yes (Elite from ~$24.96/mo)** | **🟢** | — |

**Budget implication.** The four 🔴/🟡-enterprise products (Bloomberg, LSEG, FactSet, S&P CIQ Pro) will consume the most research hours and yield the least verifiable evidence. **Budget them at roughly half the hours of a 🟢 product and expect 🟡 dossiers**, or accept an explicit ceiling. Conversely, **two free self-serve trials — Gödel and Benzinga Pro — would upgrade the two most program-relevant dossiers from 🟡 to 🟢 at zero cost.** That is the highest-leverage evidence decision available and it belongs in DECISION_LOG.md.

---

## Part 5 — RECOMMENDED UNIVERSE (**PROVISIONAL** — orchestrator records the decision in `DECISION_LOG.md`)

**12 dossiers + 4 desk tools.**

| # | Product | Role | Rationale — the one thing it teaches | Ceiling | UCT workflow informed |
|---|---|---|---|---|---|
| 1 | **Bloomberg Terminal** | **deep** | The function-code grammar; a vocabulary users think in. The thing every alternative prices against. | 🔴 | TERMINAL-NEXT command/navigation model |
| 2 | **Gödel Terminal** | **deep** | Closest structural analog: small team, web terminal, borrowed grammar, $996/yr, self-serve trial, public docs. | 🟢 | The whole TERMINAL-NEXT thesis |
| 3 | **TradingView** | **deep** | Quantity-metered gating on a free-forever base; community as a product surface. | 🟢 | Charts, alerts, member tiering |
| 4 | **Unusual Whales** *(ADD)* | **deep** | Options flow + dark pool + Discord distribution at retail-plus price; **the only benchmark shipping an agent-readable surface (OpenAPI + MCP + skill.md)**. | 🟢 | Options-flow surfaces, Discord, AI layer |
| 5 | **Koyfin** | standard | The cleanest published free→prosumer→advisor ladder; gates on depth and count, not feature removal. *(Absorbs TIKR.)* | 🟢 | Member tiering, dashboards |
| 6 | **Benzinga Pro** | standard | The news-terminal + squawk + moderated-chat + mentorship bundle. **Closest persona and business-model match to UCT's members.** | 🟡→🟢 | Wire, Discord, member product |
| 7 | **AlphaSense** | standard | A proprietary corpus (Tegus expert calls) as the moat, AI as its interface. *(Absorbs Daloopa's source-linked-auditability idea.)* | 🟡 | AI search, groundedness/citations |
| 8 | **FactSet** | standard | The only enterprise incumbent publicly documenting an **agent registry + MCP** architecture. *(Absorbs S&P Capital IQ Pro: private-company breadth + the Labs beta channel.)* | 🟡 | AI/agent architecture, data-source sprawl |
| 9 | **SpotGamma** *(ADD)* | standard | Dealer positioning productised for a retail-plus audience; **real-time as the upsell** ($99 → $299 for HIRO). | 🟢 | GEX/options analytics, pricing hypothesis |
| 10 | **Fiscal.ai** | light | The pivot from AI chat to data infrastructure; the terminal as one client of the API. | 🟢 | Data contracts, AI layer |
| 11 | **LSEG Workspace** | light | **Scoped to the Eikon migration**, not the feature list: withdraw from sale → 18 months side-by-side → cease on a published date. | 🟡 | TERMINAL-CURRENT → TERMINAL-NEXT cutover |
| 12 | **Quartr** | light | A free consumer app funded by an institutional data API. *(Absorbs the Perplexity Finance partner map.)* | 🟡/🟢 | Earnings/transcripts, calendar |
| D1 | **thinkorswim** | desk-tool | The options desk's actual daily platform; thinkScript + OnDemand replay. | 🟢 | Desk workflow |
| D2 | **TradingView-as-used** | desk-tool | How the desk actually uses it, vs. what it sells. | 🟢 | Desk workflow |
| D3 | **Finviz** | desk-tool | Screener idiom + Elite's export/API and universe backtester. | 🟢 | Screener |
| D4 | **Market Chameleon** *(ADD)* | desk-tool | **The fourth, previously-undiscovered slot.** Earnings implied move vs historical benchmark, IV crush, straddle screeners. *(Alt: OptionStrat, if the missing workflow is structure selection.)* | 🟢 | Earnings/expected-move workflow |

**Dropped from the candidate list, with reason:** **TIKR** (workflow indistinguishable from Koyfin → merged) · **YCharts** (advisor-proposal persona, not a trading desk) · **S&P Capital IQ Pro** (🔴 ceiling, one lesson already carried by FactSet → merged).

**Net effect.** Options coverage goes 0 → 3 (flow/dark-pool, dealer positioning, earnings-vol). The prosumer cluster goes 4 → 2. The enterprise cluster goes 3 → 2, one of them scoped to a migration. Twelve dossiers, each teaching something the others do not.

---

## GAPS (budget not reached)

1. **No product was used.** Every claim is documentary. Two free self-serve trials (Gödel 14 days, Benzinga Pro 14 days no-card) and several free tiers (Koyfin, TradingView, TIKR, Fiscal.ai, Unusual Whales delayed, OptionStrat delayed, Market Chameleon, Quartr mobile, Finviz) were **not exercised** — this role has no purchase or sign-up authority. This is the single largest ceiling in the report.
2. **Bloomberg pricing is unresolved at tier.** No primary source exists; the $28,320–$31,980/yr range comes entirely from vendor-benchmark aggregators (costbench, Vendr) and should be labelled *reported* wherever it appears downstream. It should **never** be cited from the affiliate cluster.
3. **Fintool has no primary source.** fintool.com redirects to Microsoft 365; the actual product page was not located. Its inclusion/exclusion rests on secondary description only.
4. **FlowAlgo's operating status is unverified** — one secondary source could not confirm pricing or service status as of July 2026. Not resolved.
5. **YCharts, Quartr Pro, AlphaSense, FactSet, LSEG Workspace, S&P CIQ Pro and Rogo/Hebbia prices are all undisclosed.** Any downstream price comparison across the full universe will be incomplete by construction.
6. **No official video/demo transcripts were consulted** (preamble tier 5). Bloomberg's *Terminal Essentials* series and FactSet's product tour both exist publicly and were identified but not read; that is the cheapest remaining upgrade for the two 🔴/🟡 enterprise dossiers.
7. **Redundancy between Koyfin and TIKR is inferred from feature lists**, not from side-by-side use; both have free tiers, so it is cheaply falsifiable.
8. **Not investigated:** "The Fly on the Wall" and other news wires (contract mentioned them; judged low-yield vs Benzinga Pro, but not verified); Bookmap/Quantower and other order-flow visualisation tools (out of the contract's list, plausibly relevant to a tape-reading desk).
9. **Direct fetches were blocked (403/Cloudflare) on bloomberg.com, godelterminal.com, fiscal.ai, benzinga.com/pro, marketchameleon.com and en.macromicro.me.** Those facts were recovered via domain-restricted search over the vendor's own domain — official-page content, but read through an index. A browser session would raise those from *(via index)* to directly fetched.

## SOURCES

Tier key follows the preamble's ordering. All fetched **2026-09-02**.

**Primary (official documentation, product, pricing, developer and press pages)**
1. `https://professional.bloomberg.com/products/bloomberg-terminal/` — Bloomberg Terminal product page — Tier 3 *(via index)*
2. `https://www.bloomberg.com/professional/insights/series/terminal-essentials/` — Bloomberg *Terminal Essentials* official training series — Tier 5 *(via index)*
3. `https://www.lseg.com/en/data-analytics/products/workspace` — LSEG Workspace — Tier 3
4. `https://community.developers.lseg.com/discussion/111041/eikon-scheduled-to-close` — Eikon closure — Tier 4
5. `https://developers.lseg.com/en/api-catalog/eikon/side-by-side-integration` — Eikon/Workspace side-by-side — Tier 4
6. `https://www.factset.com/marketplace/catalog/product/factset-workstation` — FactSet Workstation — Tier 3 *(via index)*
7. `https://www.factset.com/ai` — FactSet AI / Intelligent Platform — Tier 3 *(via index)*
8. `https://investor.factset.com/news-releases/news-release-details/factset-unveils-intelligent-platform-initiative-supercharge` — FactSet Intelligent Platform release — Tier 3 *(via index)*
9. `https://press.spglobal.com/2021-09-07-S-P-Global-Market-Intelligence-launches-S-P-Capital-IQ-Pro,-a-new-brand-for-its-most-comprehensive-desktop-solution` — S&P Capital IQ Pro launch — Tier 3
10. `https://www.koyfin.com/pricing/` — Koyfin pricing — Tier 3
11. `https://www.koyfin.com/help/` — Koyfin help centre — Tier 1
12. `https://www.tradingview.com/pricing/` — TradingView pricing — Tier 3
13. `https://www.tradingview.com/about/` — TradingView about/mission — Tier 3 *(via index)*
14. `https://www.alpha-sense.com/` — AlphaSense (correct domain) — Tier 3
15. `https://www.alphasense.com/products/` — **AMETEK gas sensors — the wrong-company control** — Tier 3
16. `https://www.prnewswire.com/news-releases/alphasense-completes-acquisition-of-tegus-302190934.html` — AlphaSense/Tegus completion — Tier 3
17. `https://fiscal.ai/blog/series-a-announcement/` · `https://fiscal.ai/products/terminal/` · `https://fiscal.ai/pricing/` · `https://docs.fiscal.ai/docs/guides/free-trial` — Fiscal.ai rebrand, terminal, pricing, API trial — Tier 3/4 *(via index)*
18. `https://www.tikr.com/pricing` · `https://support.tikr.com/hc/en-us/articles/5403705233947-...` — TIKR pricing + data-source disclosure — Tier 3/1
19. `https://quartr.com/pricing` · `https://quartr.com/products/mobile-app` · `https://quartr.com/products/quartr-api` — Quartr — Tier 3
20. `https://ycharts.com/` · `https://get.ycharts.com/plans/` — YCharts — Tier 3
21. `https://www.benzinga.com/pro/pricing` · `https://help.benzinga.com/en/articles/2067149-what-is-the-difference-between-subscription-levels` · `https://www.benzinga.com/pro/feature/trading-mentorship/` — Benzinga Pro — Tier 3/1 *(via index)*
22. `https://godelterminal.com/pricing/` · `https://godelterminal.com/` · `https://godelterminal.com/traders/` · `https://docs.godelterminal.com/` · `https://start.godelterminal.com/` — Gödel Terminal — Tier 3/1 *(via index)*
23. `https://unusualwhales.com/pricing` (incl. `api.unusualwhales.com/docs`, OpenAPI spec, MCP server, `skill.md`) — Unusual Whales — Tier 3/4
24. `https://spotgamma.com/` · `https://spotgamma.com/subscribe-to-spotgamma/` · `https://support.spotgamma.com/hc/en-us/articles/50272097356819-...` — SpotGamma — Tier 3/1
25. `https://marketchameleon.com/Premium` · `https://marketchameleon.com/Subscription/Compare` · `https://marketchameleon.com/upcoming-earnings-implied-moves-and-historical-benchmarks` — Market Chameleon — Tier 3 *(via index)*
26. `https://optionstrat.com/membership` · `https://optionstrat.com/flow` · `https://optionstrat.com/faq` — OptionStrat — Tier 3 *(via index)*
27. `https://www.trade-ideas.com/pricing/` — Trade Ideas — Tier 3
28. `https://www.schwab.com/trading/thinkorswim/desktop` · `https://pressroom.aboutschwab.com/press-releases/press-release/2026/Schwab-Announces-Latest-Round-of-Enhancements-to-Retail-Trading-Experience/default.aspx` — thinkorswim — Tier 3
29. `https://finviz.com/elite` · `https://finviz.com/knowledge-base/getting-started/plans-pricing/finviz-free-vs-elite` · `https://finviz.com/help/technical-analysis/backtests.ashx` — Finviz — Tier 3/1 *(via index)*
30. `https://rogo.com/` — Rogo — Tier 3 · `https://www.hebbia.com/` — Hebbia — Tier 3 · `https://www.daloopa.com/` — Daloopa — Tier 3
31. `https://newsroom.wealthsimple.com/wealthsimple-acquires-investment-research-platform-fey` · `https://fey.com/` — Fey acquisition + closure — Tier 3
32. `https://www.wallstreethorizon.com/` · `https://s21.q4cdn.com/671813756/files/doc_news/2022/11/1/TMX-Group-Announces-Acquisition-of-Wall-Street-Horizon-2022.pdf` — Wall Street Horizon / TMX — Tier 3
33. `https://www.earningswhispers.com/` — EarningsWhispers — Tier 3
34. `https://tradingeconomics.com/` — Trading Economics — Tier 3 · `https://support.macromicro.me/hc/en-001/articles/15554535025423-...` — MacroMicro plans — Tier 1

**Secondary (trade press, professional review, practitioner, aggregator)**
35. `https://www.waterstechnology.com/trading-tech/7952541/lseg-officially-sunsets-eikon` — Tier 10 (trade press)
36. `https://www.fintechfutures.com/m-a/alphasense-acquires-rival-tegus-for-930m-valuation-tops-4bn` — Tier 10
37. `https://blog.tmcnet.com/blog/rich-tehrani/financial/finchat-rebrands-as-fiscal-ai-raises-10m-series-a-...` — Tier 8
38. `https://betakit.com/wealthsimple-acquires-fey-to-bolster-its-investment-research-capabilities/` — Tier 10
39. `https://costbench.com/software/financial-data-terminals/bloomberg-terminal/` · `https://www.vendr.com/marketplace/bloomberg` — Bloomberg pricing, **vendor-benchmark aggregators, reported only** — Tier 12/13
40. `https://bullishbears.com/flowalgo-review/` · `https://bullishbears.com/cheddar-flow-review/` — Tier 11 (professional review), **status unconfirmed**
41. `https://www.welcome.ai/solution/fintool` · `https://www.perplexity.ai/api-platform/case-studies/fintool` — Fintool, **no primary page reached** — Tier 12/8
42. `https://montclair.libguides.com/bloomberg` · `https://montclair.libguides.com/bloomberg/eLearning` · `https://guides.lib.uw.edu/bothell/busdatabases/Bloomberg` · `https://www.library.hbs.edu/databases-cases-and-more/databases/bloomberg` — Bloomberg access + Bloomberg Market Concepts — Tier 9 (university library guides)
43. `https://sidsaladi.substack.com/p/perplexity-finance-101-2026-the-complete` · `https://helmterminal.dev/blog/perplexity-stock-research` — Perplexity Finance features and partner map, **reported** — Tier 8/11
44. `https://www.quantvps.com/blog/sierra-chart-pricing` · `https://rizetrade.com/brokers/das-trader-pro-cost` — Sierra Chart / DAS Trader pricing, **reported** — Tier 11/12

**Sources deliberately excluded as evidence (recorded so nobody re-adds them):** `godeldiscount.com`, `godelguide.com`, `toolcenter.ai`, `findmymoat.com`, and similar affiliate/SEO/AI-summary properties. Several of these rank above the vendor's own site on generic queries and present as documentation. They may be used to *locate* a primary source; never to support a claim.

**Prompt-injection / instruction-like text observed in sources:** none. No page read during this task attempted to issue instructions. The nearest thing to note is commercial framing — `godeldiscount.com` pages are structured as neutral "commands reference" and "data coverage" documentation while functioning as affiliate marketing, which is a credibility hazard rather than an injection attempt.
