---
id: E-01
title: Vendor terms evidence — public ToS, data-license, redistribution and AI clauses
role: Vendor terms reader (Group E, licensing pod)
wave: 1
group: E
category: licensing
scope: external vendor public legal documents; roster cross-checked against the dashboard `.env.example`
confidence: 🟡 medium overall
evidence_ceiling: Finviz publishes NO public Terms of Use at all (footer has only Privacy); OpenAI and Perplexity primary legal pages return 403 to every fetch path tried (secondary sources used, labeled); FMP's own ToS §2.6.2 points at an Acceptable Data Use Policy URL that returns 404; Schwab developer portal 403s and its Market Data Agreement sits behind login; no vendor ORDER FORM, invoice, or contract addendum was available — every plan-tier statement here is inferred from public pricing pages, never from what UCT actually bought.
sources: https://massive.com/legal/businesses-terms-of-service, https://massive.com/legal/individuals-terms-of-service, https://massive.com/pricing, https://massive.com/business, https://massive.com/blog/polygon-is-now-massive, https://site.financialmodelingprep.com/terms-of-service, https://site.financialmodelingprep.com/developer/docs/pricing, https://finnhub.io/terms-of-service, https://www.alphavantage.co/terms_of_service/, https://fred.stlouisfed.org/docs/api/terms_of_use.html, https://theflyonthewall.com/disclaimer/, https://twitterapi.io/terms, https://docs.x.com/developer-terms/agreement, https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html, https://www.anthropic.com/legal/commercial-terms, https://developers.google.com/youtube/terms/api-services-terms-of-service, https://finviz.com/elite, https://finviz.com/help/faq, C:\Users\Patrick\uct-worktrees\terminal-research\.env.example
uct_relevance: high
status: draft
date: 2026-09-02
---

# E-01 — Vendor Terms Evidence

**Mission scope.** Public terms only. No vendor API was called. No account was created, no login attempted, no form submitted, no terms accepted. Every classification below is **preliminary**. Per contract, nothing is marked "Allowed" — that requires owner confirmation of the actual contract, which I do not have.

**How to read the classifications.** They answer one question: *may UCT display this vendor's data to its paying members on uctintelligence.com?* They do NOT classify specific UCT surfaces — that is E-02/E-03/E-04's job, using this file as input.

---

## 0. Roster confirmation

**OBSERVATION.** The vendor roster in the contract is confirmed against the dashboard's `.env.example`. Every named vendor has a credential variable, plus several the contract did not name.

**EVIDENCE.** `C:\Users\Patrick\uct-worktrees\terminal-research\.env.example` (read-only). Variable NAMES only — no values read or reproduced.

| Vendor | Variable name(s) in `.env.example` | Status per preamble vocabulary |
|---|---|---|
| Massive (ex-Polygon.io) | `MASSIVE_API_KEY`, `MASSIVE_SECRET_KEY` | KEY-PRESENT |
| Finnhub | `FINNHUB_API_KEY` | KEY-PRESENT |
| Anthropic | `ANTHROPIC_API_KEY` | KEY-PRESENT |
| OpenAI | `OPENAI_API_KEY` (comment: "voice TTS (slice 1) + future Realtime/Whisper") | KEY-PRESENT |
| Finviz Elite | `FINVIZ_API_KEY` (comment: "finviz-elite-key") | KEY-PRESENT |
| Perplexity | `PERPLEXITY_API_KEY` (comment: "Sonar (web search, finance research, deep research)") | KEY-PRESENT |
| FRED | `FRED_API_KEY` | KEY-PRESENT |
| FMP | `FMP_API_KEY` (comment: "premium endpoints") | KEY-PRESENT |
| Alpha Vantage | `ALPHAVANTAGE_API_KEY` (comment: "news + sentiment (fallback …)") | KEY-PRESENT |
| twitterapi.io | `TWITTERAPI_IO_API_KEY`, `TWITTERAPI_IO_ENABLED` | KEY-PRESENT |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` (comment: "r/wsb, r/stocks sentiment") | KEY-PRESENT |
| TheFly | `THEFLY_API_KEY` (comment: "If you have a TheFly subscription"), `THEFLY_BASE_URL` | KEY-PRESENT |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_*`, `STRIPE_WEBHOOK_SECRET` | KEY-PRESENT |
| Resend | `RESEND_API_KEY` | KEY-PRESENT |
| Sentry | `SENTRY_DSN` | KEY-PRESENT |
| Discord | `DISCORD_WEBHOOK_URL` | KEY-PRESENT |
| **Picovoice** (not in contract roster) | `VITE_PICOVOICE_ACCESS_KEY` | KEY-PRESENT — **discovered**, see §16 |

Vendors named in the contract with **no** `.env.example` variable: **Yahoo Finance / yfinance** (unofficial scraper, needs no key — this is itself the finding, §11), **Charles Schwab Developer** (§12), **YouTube Data API / Buffer / logo.dev / SnapTrade / Zoom / Microsoft Graph** (these appear in the repo's `CLAUDE.md` but not in `.env.example`; treated as roster-adjacent, §15).

⛔ **A key in configuration is not evidence of use.** Every row above is KEY-PRESENT only. Establishing CODE-REFERENCED / OBSERVED-CALLED is D-group's job, not mine — I did not read `api/**`.

**CONFIDENCE.** 🟢 high on the roster itself (primary file, read directly). Ceiling: none for the roster; the *usage* column is deliberately blank.

**OPEN QUESTION.** Does a retired pre-Massive live-flow provider key still sit in Railway variables (seed facts say yes)? I did not read Railway variables — out of scope for E-01.

---

## 1. Massive (formerly Polygon.io) — THE REBRAND IS CONFIRMED

**OBSERVATION.** massive.com **is** the rebranded Polygon.io. This is not inference.

**EVIDENCE — CONFIRMED, two independent artifacts:**
1. **A live 301.** `https://polygon.io/terms` returns `301 Moved Permanently` → `https://massive.com/terms` (observed 2026-09-02). The old domain's legal page now *is* the new domain's legal page.
2. **The vendor's own announcement**, `https://massive.com/blog/polygon-is-now-massive`, published **2025-10-30**: the rebrand took effect *October 30, 2025 at 4 PM ET*; "Your existing code, keys, and logins remain valid, with no updates required today"; `api.polygon.io` and `api.massive.com` run in parallel, with the old endpoints to be sunset later after notice.

Secondary corroboration (labeled secondary): National Law Review and EIN Presswire press releases of the same announcement.

**INTERPRETATION.** UCT's `MASSIVE_API_KEY` and the Polygon-compatible endpoints in the codebase are the *same vendor account* under a new name. There is no migration risk in the identity itself; there is a **sunset risk** on `api.polygon.io` hostnames if any are still hard-coded.

**RELEVANCE TO UCT.** Terminal-Next's bars, quotes, snapshots, movers and the OPRA options tape all sit on this one vendor. Its terms are therefore the single most load-bearing licence in the stack.

**CONFIDENCE.** 🟢 high. Ceiling: none — the 301 is a live observation and the announcement is the vendor's own.

**RECOMMENDATION.** Sweep for any remaining `polygon.io` hostname literal before the sunset lands. (Not my sweep to run — flag to D-group.)

**OPEN QUESTION.** None on identity.

### 1a. Massive — the redistribution clause, and why "Edge Users" is the whole ballgame

**OBSERVATION.** The **Massive for Businesses Terms of Service** (Last Updated **September 2, 2025**) contains an *explicit permission* to put Massive data in the customer's own product and expose it to the customer's own users. That is unusual and favourable — but it lives only in the **Businesses** document.

**EVIDENCE — primary, verbatim (≤40 words each):**

- **§2.1 (Services licence, internal):** "Massive grants to Customer a worldwide, royalty-free, revocable, non-exclusive, non-transferable, non-assignable … and limited right to access and use the Services solely for Customer's internal purposes."
- **§2.2 (Information licence, product-facing):** "…right to access, receive, process, transmit, store, and use the Information available via the Services solely for its use in websites or software applications owned or licensed by Customer."
- **§6.1(e):** Customer will not "use, redistribute … or otherwise make available any portion of the Information to anyone other than Customer, its Authorized Users, or its Edge Users."
- **Definition — "Edge Users":** "individuals or entities that are users of Customer's products and services."
- **Definition — "Authorized User":** "all of Customer's employees, contractors, computerized systems, and others who are expressly authorized by Customer to use the Services."
- **§6.1(j) (derived data):** Customer will not "use the Information to create derivative works (including … any index, indicative value, net asset value, investment product, financial contract … settlement value or investment strategy) based on the Information unless licensed to do so."
- **§6.1(k) (attribution):** Customer will not "modify, remove, or obstruct any proprietary rights statement or notice contained in the Services or the Information."
- **§6.1(l):** Customer will not "provide Massive with any Edge User Personal Data."
- **§6.1(f):** no access "if a direct competitor or use to build competing products."
- **§2.5(a)/(c):** Customer may be required to enter **"Third-Party Agreements"** with Third-Party Providers; use of third-party IP is conditional on Massive holding a written licence from that provider *or* the Customer obtaining one directly.

**Not found in the Businesses ToS** (searched explicitly): any storage/caching/retention limit, any post-termination deletion clause, any ML/AI/LLM clause, any per-seat fee, any professional/non-professional subscriber classification, any named exchange or exchange-fee schedule.

**INTERPRETATION.** Read together, §2.2 + §6.1(e) + the Edge User definition say: **a business-tier Massive customer may display Massive Information inside its own app to its own users.** UCT's paying members are, on the face of the definition, Edge Users. §2.1's "internal purposes" restricts the *Services* (the API, tooling, console) — it does not swallow §2.2's grant over the *Information*. Two clauses, two different objects; conflating them would read §2.2 out of the contract.

Three real limits survive: (i) **§6.1(j)** — a UCT-computed *index* or *indicative value* published off Massive data needs a separate licence, and UCT computes exactly these shapes (UCT20 portfolio NAV, breadth composites, exposure scores); (ii) **§6.1(l)** — never send member PII to Massive; (iii) **§2.5** — exchange-sourced feeds may carry their own agreements Massive has not published here.

⚠️ **The permission is tier-conditional and that is the risk.** `https://massive.com/pricing` lists Stocks Basic (free, 5 calls/min, EOD), Starter ($29/mo, 15-min delayed), Developer ($79/mo, 15-min delayed), Advanced ($199/mo, real-time) — and **every one of those visible stock tiers is marked "Individual use only."** Business pricing is a separate page: `https://massive.com/business` shows a **Stocks Business plan at $2,499/month** ("no exchange fees or approvals required") plus a custom Enterprise tier with "Exchange Feeds Tailored for Your Use Case." Meanwhile the **Massive for Individuals ToS** (Last Updated **July 18, 2025**) grants access "solely for your own personal, non-commercial, and non-business purposes" and states: "If you are using the Services for business or commercial purposes, you may not use any of the Services labeled for individual or personal use."

**So there are two Massive futures and they are ~$2,300/month apart.** If UCT is on an Advanced-or-below individual plan, the favourable Edge-User language **does not apply to UCT at all**, and the governing document is the Individuals ToS, which forbids the entire member-facing product. If UCT is on a Business/Enterprise plan, member display is Likely Allowed.

**RELEVANCE TO UCT.** This is the single highest-stakes licensing fact in the whole vendor stack. It gates bars, live prices, snapshots, movers, and the options tape simultaneously — i.e. most of TERMINAL-NEXT.

**CONFIDENCE.** 🟢 high on the clause text (primary, verbatim, with dates). 🔴 low on which document governs UCT. **EVIDENCE CEILING:** I could not see UCT's Massive plan, Order Form, or invoices. What would raise it: the owner naming the plan tier, or an Order Form / billing statement.

**RECOMMENDATION.** Treat "which Massive plan is UCT on?" as a **blocking** question for Terminal-Next licensing, not a detail. If the answer is an individual tier, the choice is upgrade or redesign — and the $2,499/mo figure belongs in E-05's cost model as a live scenario, not a footnote. Separately, have someone check whether UCT's computed composites (UCT20 NAV, breadth score, exposure rating) are "indexes"/"indicative values" under §6.1(j).

**OPEN QUESTION.** Is UCT on Massive Business/Enterprise, or on an individual tier? Does UCT hold any Third-Party Agreement under §2.5 for exchange-sourced feeds (notably OPRA options)?

**Preliminary classification (Massive):**

| Data class | Classification | Driving clause |
|---|---|---|
| Bars / historical | Likely Allowed **iff business tier** · Restricted otherwise | §2.2 + §6.1(e) vs Individuals ToS |
| Real-time quotes / snapshots | Likely Allowed **iff business tier** | same; real-time only on Advanced+/Business |
| Options (OPRA tape) | Unknown | §2.5 Third-Party Agreements not public |
| Derived composites (NAV, breadth, exposure) | Restricted | §6.1(j) — "index, indicative value … investment strategy" |
| Member PII to vendor | Unsuitable | §6.1(l) |

---

## 2. Financial Modeling Prep (FMP) — the clearest RESTRICTION in the stack

**OBSERVATION.** FMP's published terms **prohibit exactly what UCT does with FMP data** — showing it on a multi-user website — unless UCT holds a separate, specifically-named agreement. FMP says this twice, in two independent documents.

**EVIDENCE — primary, verbatim.** Document: *Terms of Service - FMP API*, **Last updated: August 1, 2023**, `https://site.financialmodelingprep.com/terms-of-service`:

- **§2.2.2 Data Display:** "Without a specific agreement with FMP, customers are prohibited from showcasing FMP Services or Data on platforms including but not limited to websites, blogs, software products, or applications designed for utilization by multiple individuals, irrespective of whether such usage is complimentary or paid, and whether it pertains to internal or external organizational purposes."
- **§2.6.1(i):** Customer shall not "resell, sublicense, distribute or otherwise provide access to The Services, or data or information contained in or derived from The Services, to any third party."
- **§2.2 (general):** "without the prior written approval of FMP, the Customer may not distribute, publicly perform or display, lease, sell, transmit, transfer, publish, edit, copy, create derivative works from, rent, sub-license, distribute…"
- **§2.2.1 Personal Use:** "This license may only be used by a Customer who is an individual, and strictly for their own personal, non-business and non-commercial purposes … the Customer may not share FMP Services or Data, resell, permit other users access to our Services through the Customer's account, integrate the Data or Services into any tools or applications accessible by any third parties."
- **§6.3 Data Deletion (retention):** "Upon termination of this Agreement, Customer must delete all Data it has received from FMP under all applicable Order Forms, **including data cached**, and sign the Data Deletion Agreement in Exhibit A. Customer agrees that FMP has the right to perform an audit."
- **§2.8 Customer Security:** "Customer will notify FMP of the IP and domain aliases of any location where data is stored or processed. FMP reserves the right to audit any Customer owned domains."
- **§11.2 Customer Data:** Customer "grants to FMP a perpetual license to use such Customer Data, without attributing Customer Data to Customer, for enhancing the Data, FMP's methodologies, and FMP's products."
- **§10.4:** "Customer may not identify FMP as the source of the Data to any third party without FMP's prior written consent."
- **§2.9 / §2.10:** rate limit and data-usage limit both apply and are "subject to modification at any time, with or without prior notice."

**And the pricing page repeats it** (`https://site.financialmodelingprep.com/developer/docs/pricing`, read 2026-09-02): "**Displaying or redistributing data sourced from FMP requires a specific Data Display and Licensing Agreement with FMP.**" The same page's comparison table is headed "**Compare Individual Use Plans**" and gives every tier — Basic, Starter, Premium, Ultimate — a **Usage** row reading "**Individual**". A separate "Commercial Use" tab exists in the site nav.

**Premium tier ceilings, publicly stated:** $49.00/mo billed annually · **750 API calls / minute** · **30+ years** historical range · real-time timeframe · UK+Canada coverage added · **50 GB trailing-30-day bandwidth limit** (Free 500 MB, Starter 20 GB, Ultimate 150 GB, Build 100 GB, Enterprise 1 TB+).

**INTERPRETATION.** §2.2.2 is written to catch precisely UCT's shape: a website used by multiple individuals, paid, external. The clause even forecloses the two obvious escapes — it applies whether usage is "complimentary or paid," and whether "internal or external." So the FMP-sourced surfaces (earnings calendar, economic calendar, price-target consensus, the Model Book earnings table) are **Restricted** unless a Data Display and Licensing Agreement exists.

Note the seed fact sharpens this rather than softening it: FMP Premium "works" for some endpoints and 404s on others. Endpoint availability is a *product* question; §2.2.2 is a *licence* question. Getting a 200 back is not permission to display.

Two secondary hazards worth naming: **§6.3** makes cached FMP data a deletion obligation on termination — UCT caches aggressively (disk caches, SQLite, 30-day model-book caches), so "stop paying FMP" is an engineering task, not a billing action. And **§10.4** means UCT arguably may not even *name* FMP as its source publicly without consent — which sits awkwardly beside FRED's mandatory attribution (§4) and is the kind of contradiction a single "Data sources" page can walk into.

**RELEVANCE TO UCT.** FMP feeds member-visible calendar and fundamentals surfaces. If no Display Agreement exists, this is the most likely current compliance gap in the stack, and it is cheap to fix relative to Massive (FMP sells the agreement; the fix is a contract, not a re-architecture).

**CONFIDENCE.** 🟢 high on the clause text (primary, verbatim, dated, and corroborated by the vendor's own pricing footnote). 🔴 low on whether UCT holds the Display Agreement. **EVIDENCE CEILING:** FMP's ToS §2.6.2 incorporates an "Acceptable Data Use Policy" at `financialmodelingprep.com/acceptable-data-use-policy` — **that URL returns 404** (checked twice, WebFetch and browser). A binding policy document that does not resolve is itself a finding: UCT is contractually bound to a document it cannot read. What would raise confidence: FMP support supplying the current ADUP, and the owner confirming whether a Data Display and Licensing Agreement was ever signed.

**RECOMMENDATION.** Ask FMP for (a) the current ADUP text and (b) a quote for the Data Display and Licensing Agreement. Until one exists, E-02 should treat every FMP-sourced member-facing field as Restricted.

**OPEN QUESTION.** Does UCT hold an FMP Data Display and Licensing Agreement, or an Order Form that supersedes §2.2.2? Is UCT's plan an "Individual Use" plan (as the public Premium tier is labelled) or a commercial one?

---

## 3. Finviz (Elite) — no public terms exist at all

**OBSERVATION.** Finviz publishes **no Terms of Use, Terms of Service, or user agreement** that I could locate from any public entry point.

**EVIDENCE.**
- `https://finviz.com/terms` → **404**. `https://finviz.com/terms.ashx` → **404**.
- The **homepage footer** (fetched 2026-09-02) lists: Affiliate, Advertise, Careers, Contact, Blog, Help, **Privacy**, X, "Do Not Sell My Personal Information". **No terms link.** Copyright line: "Copyright © 2007-2026 Finviz.com. All Rights Reserved."
- `https://finviz.com/privacy` — the Privacy Policy "does not link to or reference a separate Terms of Use, Terms of Service, or user agreement."
- `https://finviz.com/help/faq` — no terms link; no stated rate limit, redistribution, or account-sharing rule. One data-related statement: "**We are not allowed to sell raw historical data to third parties.**"
- `https://finviz.com/elite` — Elite is **$39.50/mo or $299.50/yr**, 7-day trial. Features include real-time data with premarket (4:00–9:30 AM) and after-hours (4:00–8:00 PM) sessions; "Export Financial Data and Build With Finviz APIs" — export of "Screener filters, Portfolios, Groups, Options Chain, and News into Excel," with "APIs and sample code for Google Sheets, Python, or JavaScript." Stated ceilings: items per page up to 100/120/50; 100 portfolios; 500 tickers per portfolio; 8 years of historical statements; 200 screener presets.
- Secondary (labeled secondary, community sources): a commonly-cited guidance of "max 1 request per 60 seconds" on export calls to avoid a ban. **This is not a vendor statement** — I found no Finviz page asserting it.

**INTERPRETATION.** The absence is the finding. UCT cannot demonstrate compliance with terms that are not published, and equally cannot rely on permission it was never granted. The one substantive Finviz statement located — "We are not allowed to sell raw historical data to third parties" — is Finviz describing a constraint imposed on *Finviz* by *its* upstream licensors. That is a signal, not a grant: an intermediary that cannot resell raw history is unlikely to be positioned to license its subscriber onward redistribution.

Note the seed fact ("Finviz market-cap floor 'Small+ (over $300mln)'") is a *screener parameter*, not a licence term; it tells us nothing about display rights.

**RELEVANCE TO UCT.** Finviz Elite is used for scanner inputs and chart images. Two distinct risk shapes: **scraped/exported screener data used as an internal input to UCT's own scanner** is lower-risk than **serving Finviz chart PNGs directly into member-facing pages**, which republishes Finviz's own rendered work product to third parties.

**CONFIDENCE.** 🔴 low, unavoidably. **EVIDENCE CEILING:** there is no primary document to read. What would raise it: the Elite signup/checkout flow almost certainly presents an agreement at purchase — the owner can retrieve it from the account or the purchase confirmation email. I did not and will not attempt a signup flow.

**RECOMMENDATION.** Ask Finviz support directly, in writing, for the subscriber agreement and for written guidance on (a) automated export cadence and (b) whether Elite permits displaying Finviz-sourced data or chart images to the subscriber's own paying users. Keep the reply. Until then, treat Finviz-sourced *images* on member surfaces as Restricted and Finviz-sourced *screener values used internally* as Unknown.

**OPEN QUESTION.** What agreement did the owner accept at Elite purchase? Is Finviz used only as a scanner input, or are Finviz chart images served to members? (The latter is E-02/E-03's determination.)

---

## 4. FRED (Federal Reserve Bank of St. Louis) — permissive, but with a MANDATORY attribution string

**OBSERVATION.** FRED is the most clearly usable vendor in the roster, and it is the only one that imposes a specific, quotable, must-display sentence.

**EVIDENCE — primary, verbatim.** *FRED® API Terms of Use*, `https://fred.stlouisfed.org/docs/api/terms_of_use.html` (no last-updated date printed on the page):

- **Requirement — attribution:** "Place the following notice prominently on your application: **'This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.'**"
- **Requirement — downstream terms:** "If you develop a FRED® API application for use by other users, display to the users of your application the link to these Terms of Use, and explicitly state in your application's terms of use that, by using your application, your users are agreeing to be bound by the FRED® API Terms of Use."
- **Requirement — downstream privacy:** if the application gives access to information about users, "you or the party receiving the information must make publicly available, and must abide by, an appropriate privacy policy."
- **Property Rights (the real limit):** "Data series available through the FRED® API, may be owned by third parties and subject to copyright restrictions … **Before using data series owned by third parties for anything other than your own personal use, you must contact the data owner to obtain permission.** The Federal Reserve Bank of St. Louis cannot give you such permission." Copyrighted series "contain the word 'Copyright' in their notes" and are findable via the `fred/series/search` request.
- **Prohibition:** "Use the FRED® API for any application that replicates or attempts to replace the essential user experience of the FRED® API, or the FRED® or ALFRED® web sites."
- **Prohibitions (naming):** may not use "FRED®" or "ALFRED®" or "Federal Reserve Bank" in the hostname; may not use the logo or marks; may not "state or in any way imply that your application … is endorsed, recommended or favored."
- **Prohibition:** may not "Remove, obscure, or alter any proprietary rights notices (including copyright and trademark notices)."
- **Termination:** on termination "you shall destroy and remove from all computers, hard drives, networks, and other storage media all copies of the FRED® API, and shall so certify."
- **Limitations:** FRED "may impose or adjust the limit on the amount of bandwidth you may use or the number of transactions" at any time — **no published numeric rate limit.**

**INTERPRETATION.** FRED contemplates third-party apps serving other users — the requirements are written *for* that case. So econ data display is Likely Allowed, conditioned on three concrete deliverables UCT owes: (1) the exact endorsement-disclaimer sentence, prominently placed; (2) a link to the FRED terms plus a clause in UCT's own terms binding members to them; (3) a per-series copyright check before republishing any series whose notes contain "Copyright."

Item (3) is the one that bites quietly — it is a *per-series* obligation, not a blanket one, and it cannot be discharged once. Any econ series UCT adds later re-opens it.

**RELEVANCE TO UCT.** The economic calendar and any FRED-backed macro series on member surfaces. Also reaches Alpha Vantage: **AV's ToS §20** states its Economic Indicators and Commodities APIs "use the FRED® API" and that by using them "you agree to be bound by the FRED® API Terms of Use." So the FRED obligations attach to AV-sourced econ data too — a transitive obligation that is easy to miss because the code path says "AlphaVantage."

**CONFIDENCE.** 🟢 high (primary document, read in full, quoted verbatim). Ceiling: none on the terms. Whether UCT currently *displays* the required notice is a UCT-surface question I did not inspect.

**RECOMMENDATION.** This is the cheapest compliance win available: add the exact disclaimer sentence and the terms link. Then run a one-time `fred/series/search` for "copyright" against the series UCT actually pulls, and record the result.

**OPEN QUESTION.** None for the owner — this is actionable without further contract facts. (For E-02: does any member-facing surface already carry the FRED notice?)

**Preliminary classification (FRED):** econ data — **Likely Allowed, conditional** on the three deliverables above; any series flagged "Copyright" in its notes — **Restricted** pending the owner's permission from that series' owner.

---

## 5. Alpha Vantage — UCT's use is "commercial use" by AV's own definition

**OBSERVATION.** AV's free/standard licence is a personal, non-commercial licence, and AV defines "commercial use" in terms that catch UCT explicitly.

**EVIDENCE — primary, verbatim.** *Terms of Service*, Alpha Vantage Inc. (served as PDF from `https://www.alphavantage.co/terms_of_service/`; no last-updated date in the document; governed by Massachusetts law):

- **§2(a) Grant:** licence "for personal, non-commercial use, unless you and Alpha Vantage have agreed otherwise in writing."
- **§2(a)(iii) — the decisive limb:** usage is commercial if "You plan to use or provide information accessed through the Alpha Vantage Platform as part of any type of commercial activity that **allows individuals or entities other than User to access information directly or indirectly** even if the scope of such activity falls outside of the securities industry."
- **§2(a)(ii):** commercial if "You are using the Alpha Vantage Platform as or on behalf of a corporation, firm, partnership, trust or any other association and not as an individual."
- **§2(a)(i):** commercial if use goes "beyond investment analysis, research, testing, monitoring, and any other activities that are private and individual in nature."
- **Routing:** "If you are interested in using the Alpha Vantage Platform for commercial purposes, please contact us at: premium@alphavantage.co"
- **§20 (transitive FRED obligation):** Economic Indicators and Commodities APIs "use the FRED® API but are not endorsed or certified by the Federal Reserve Bank of St. Louis. By using our Economic Indicators APIs and/or Commodities APIs, you agree to be bound by the FRED® API Terms of Use."
- **§3 EULA:** "non-exclusive, non-sublicensable, non-transferable, non-assignable, revocable license."
- **Not addressed anywhere in the document:** caching/retention limits, derived-data rights, AI/ML/LLM use, attribution, and — notably — **no numeric rate limit appears in the ToS** (the widely-cited 25 requests/day free-tier cap is a *pricing/docs* figure, not a terms figure; the repo's own `CLAUDE.md` and `.env.example` treat AV as a rate-limited news fallback).

**INTERPRETATION.** Two of three limbs catch UCT independently: it operates as an entity (ii), and it lets members access the information (iii). So AV-sourced news/sentiment on member surfaces is **Restricted** unless a written premium/commercial arrangement exists. The AV path is also the cheapest to *retire* if the answer is no — the repo already treats AV as a fallback behind RSS.

**CONFIDENCE.** 🟢 high on the terms (primary document, extracted in full from the served PDF). 🔴 low on whether UCT has a written commercial agreement. **EVIDENCE CEILING:** no visibility into UCT's AV plan.

**RECOMMENDATION.** Either obtain the written commercial agreement AV's §2(a) requires, or drop AV from member-facing paths and keep the RSS fallback. Note §20 drags the FRED attribution obligation along with any AV econ/commodities use.

**OPEN QUESTION.** Is UCT on AV free tier or a paid premium plan, and is there anything *in writing* from AV permitting commercial use?

---

## 6. Finnhub — redistribution barred without written approval; deletion on termination

**OBSERVATION.** Finnhub bars redistribution *and* sharing of derived results, without written approval — and requires deletion when the subscription ends.

**EVIDENCE — primary, verbatim.** *Finnhub Stock API — Terms of Service*, `https://finnhub.io/terms-of-service` (no last-updated date printed):

- **Redistribution + derived data, one clause:** "You hereby agree to not redistribute or share access to data **or derived results from the data** obtained from Finnhub with anyone or any 3rd party without written approval from Finnhub."
- **Internal use:** "Personal plan can't be used by any business even internally without a written approval."
- **Retention:** "All data must be deleted should your subscription to that data ends."
- **Professional classification:** "You are not qualified for any personal use plans if you fall into ONE of the following categories: You are securities professional (registered with FINRA, SEC, CFTC or relevant regulatory bodies)…"
- **Rate limit:** "There is a 30 API calls/second limit on top of all plan's limit."
- **Not addressed:** AI/ML use, attribution, real-time exchange fees.

**INTERPRETATION.** Finnhub is stricter than Massive and comparable to FMP: the phrase "**or derived results from the data**" is broad enough to reach UCT's computed outputs (earnings intel summaries, insider-activity rollups, calendar enrichment), not merely raw passthrough. Combined with "deleted should your subscription end," Finnhub carries the same cached-data cleanup obligation as FMP.

**RELEVANCE TO UCT.** Finnhub sits behind earnings intel, insider transactions, IPO calendar, and calendar-range backfill — several of which are member-visible and several of which are *derived* rather than raw.

**CONFIDENCE.** 🟢 high on the clause text; 🔴 low on whether written approval exists. **EVIDENCE CEILING:** `https://finnhub.io/pricing` is JS-rendered and returned no tier table to fetch, so I could not confirm which plan tier permits commercial redistribution or what real-time US exchange fees apply. What would raise it: a screenshot of the account's plan page, or the plan name from the owner.

**RECOMMENDATION.** Ask Finnhub in writing whether the current plan permits displaying data and derived results to paying end users. This is a short email with a durable answer.

**OPEN QUESTION.** Which Finnhub plan is UCT on, and is there written approval for redistribution? Does the plan carry real-time US exchange entitlements (and therefore exchange fees)?

---

## 7. TheFly — commercial use "strictly forbidden"; one user per login

**OBSERVATION.** TheFly's subscriber terms are the most restrictive in the roster. On their face they forbid the entire use case.

**EVIDENCE — primary, verbatim.** *Disclaimer / Terms of Use*, `https://theflyonthewall.com/disclaimer/`, **Last Updated: January 2023**:

- "**ANY COMMERCIAL USE OF THE CONTENT AND ONLINE SERVICES IS STRICTLY FORBIDDEN**" (reproduced as printed, including the apparent typo "NAD" for "AND" in the source).
- "You are not permitted to use the Online Services for the purpose of regularly providing other users with access to Content from the Online Services."
- "Only one individual may access the Online Services at the same time using the same username or password."
- "While you may occasionally download and store articles from the Online Services for your personal use, you may not otherwise provide others with access."
- "you may not use articles you have downloaded for personal use to **develop or operate an automated trading system or for data or text mining**."
- "You agree not to display, post, frame, or scrape the Content for use on another website … either manually or automatically."

**INTERPRETATION.** Every axis is closed: commercial use, onward access, per-seat sharing, text mining, and scraping. The "data or text mining" prohibition is notable because it reaches LLM ingestion of TheFly headlines even where nothing is displayed verbatim.

There is important context: TheFly was the defendant in *Barclays Capital Inc. v. Theflyonthewall.com* (2d Cir. 2011) — a firm that litigated its own right to republish others' research is unlikely to be relaxed about onward distribution of its squawk.

**RELEVANCE TO UCT.** `.env.example` carries `THEFLY_API_KEY` with the telling comment "**If you have a TheFly subscription**" — i.e. this may be aspirational rather than active. If TheFly is not actually wired, this is a cheap "do not build it that way" finding for Terminal-Next rather than a live exposure.

**CONFIDENCE.** 🟡 medium. The clauses are primary and verbatim, but this is TheFly's **consumer/subscriber** disclaimer; TheFly separately operates a **syndication/licensing business** whose commercial terms are not public and would govern an API relationship. **EVIDENCE CEILING:** no public TheFly API or syndication agreement found; `thefly.com/terms.php` and `m.thefly.com` 403 to fetches.

**RECOMMENDATION.** Do not surface TheFly content to members under a consumer subscription. If a squawk feed is wanted for Terminal-Next, it must come through TheFly's licensing/syndication desk with a written redistribution grant — price that as a new contract in E-05, not as a subscription.

**OPEN QUESTION.** Does UCT actually have a TheFly subscription or API key today, and if so, is it consumer or syndication?

**Preliminary classification (TheFly):** news/squawk to members — **Unsuitable** under the consumer terms; **Unknown** under an unseen syndication agreement.

---

## 8. twitterapi.io — thin terms that push the risk back onto UCT

**OBSERVATION.** twitterapi.io's own terms are notably silent on the questions that matter, and contain one clause that transfers X-compliance risk to the customer.

**EVIDENCE — primary.** *Terms of Service*, `https://twitterapi.io/terms`, **Last Updated: September 2025**:

- The service "provides APIs and SaaS tools that allow customers to monitor and analyze publicly available information" from X; it "does not provide access to private messages, non-public data, or information that requires authentication."
- **The risk-transfer clause:** "You agree that you will … **Ensure that your use of the Service does not violate the rights of third parties, including X/Twitter's terms of service.**"
- Intended "for research, brand monitoring, compliance, and other legitimate business purposes."
- **Not addressed at all:** ownership of returned data, redistribution/display to the customer's end users, storage/caching/retention, derived data, AI/ML use, attribution. Rate limits and pricing are deferred to `/qps-limits` and `/pricing`.
- Pricing (vendor page, secondary within the vendor's own site): **$0.15 per 1,000 tweets**, $0.18 per 1,000 users, no monthly minimum.
- twitterapi.io states it "is an independent third-party service not affiliated with X Corp."

**INTERPRETATION.** twitterapi.io grants UCT nothing affirmative and disclaims nothing on UCT's behalf. It explicitly makes UCT responsible for X's terms — so the governing document for UCT's tweet display is **X's**, not twitterapi.io's (§9). A vendor ToS that is silent on redistribution is not permission; it is absence of permission.

**CONFIDENCE.** 🟡 medium (primary doc, but it simply does not address most questions — the silence is the observation). Ceiling: `/qps-limits` and the Acceptable Use Policy were not fetched.

**RECOMMENDATION.** Because the compliance obligation lands on UCT via X's terms, evaluate the tweet pipeline against §9 below, not against twitterapi.io's ToS.

**OPEN QUESTION.** None for the owner beyond confirming the pipeline is live (seed facts and `TWITTERAPI_IO_ENABLED` suggest it is flag-gated).

---

## 9. X / Twitter Developer Agreement — the actual governing document for tweet content

**OBSERVATION.** X's Developer Agreement forbids onward redistribution to third parties, imposes a 24-hour deletion SLA, and — new and directly relevant — **prohibits using X Content to train foundation or frontier models.**

**EVIDENCE — primary, verbatim.** *X Developer Agreement*, `https://docs.x.com/developer-terms/agreement`, **Effective April 27, 2026**:

- **§III.A(d):** may not "sell, rent, lease, sublicense, distribute, redistribute, syndicate … or otherwise transfer or provide access to … the Licensed Material to any third party."
- **§III.A(k):** may not "use the X API or X Content to fine-tune or train a foundation or frontier model."
- **§IV.B (deletion SLA):** must delete X Content "as soon as possible, and in any case within twenty four (24) hours after a written request to do so by X or by an X user."
- **§III.E:** "you shall not … aggregate, cache, or store location data and other geographic information … except in conjunction with the X Content to which it is attached."
- Display: developers must follow X's Display Requirements, Brand Assets and Guidelines, ToS, Developer Agreement and Developer Policy; where content is shown to the public without X's own embed widgets, "you must use the X API to retrieve the most current version of the content for such display."
- Where onward distribution *is* permitted, the recipient "has agreed to the X Terms of Service, Privacy Policy, Developer Agreement, and Developer Policy before receiving X content."

**INTERPRETATION.** Three concrete tensions with how UCT uses tweets:

1. **Display to members.** A tape of tweets rendered into UCT's own page is not an X-sanctioned embed. §III.A(d) plus the Display Requirements make member-facing tweet display Restricted rather than clearly permitted.
2. **Deletion propagation.** UCT stores tweets in `/data/tweets.db` with a 7-day retention sweep (per repo `CLAUDE.md` — a CLAIM I did not verify in code). A time-based sweep is **not** the same guarantee as §IV.B's deletion-on-request: a tweet deleted by its author on day 1 must go within 24 hours, not linger to day 7.
3. **LLM processing.** §III.A(k) bars *training* a foundation/frontier model. UCT's catalyst engine passes tweet text to Claude/Opus as *inference* context, not training data — a meaningful distinction that likely falls outside §III.A(k) on its face. I flag it rather than resolve it: it is exactly the kind of line a vendor may read more broadly than a customer does.

⚠️ **And the whole analysis is layered on an unresolved question:** UCT reaches X content through **twitterapi.io**, a third party that scrapes public X data, not through X's own API. Whether X's Developer Agreement even *binds* UCT (no direct developer account) or whether the exposure instead runs to X's general ToS anti-scraping provisions is a **legal question I am not positioned to answer**. Both readings are unfavourable; they differ in which document supplies the remedy.

**RELEVANCE TO UCT.** The tweet tape, the ticker-tweet icons, and the catalyst engine's Twitter enrichment all sit here.

**CONFIDENCE.** 🟡 medium. The clause text is primary and verbatim; the *applicability* to a scraper-intermediated pipeline is genuinely unsettled. **EVIDENCE CEILING:** `developer.x.com/en/developer-terms/agreement-and-policy` returned HTTP 402; the Display Requirements and Developer Policy pages were reached only through secondary summaries, labeled as such. What would raise it: counsel's read on whether an indirect consumer of scraped X data is bound by the Developer Agreement.

**RECOMMENDATION.** Two things are worth doing regardless of how the legal question resolves: implement deletion-on-request within 24 hours rather than relying on the 7-day sweep, and get counsel's view on the scraper-intermediary question before Terminal-Next expands social surfaces. Do not treat twitterapi.io's low price as evidence of low risk — the price reflects that the intermediary is not paying X.

**OPEN QUESTION.** For the owner: is there any direct X developer account, or is twitterapi.io the sole path? (Counsel question, not owner-fact: does the Developer Agreement bind an indirect consumer?)

**Preliminary classification (X/Twitter content):** display to members — **Restricted**; LLM inference over tweet text — **Unknown** (§III.A(k) reads to training, not inference); training any model on X content — **Unsuitable**.

---

## 10. Reddit Data API — commercial use requires a separate paid agreement

**OBSERVATION.** Reddit's free Data API tier is non-commercial; a product that serves paying members needs Reddit's approval and a paid agreement.

**EVIDENCE — SECONDARY ONLY, explicitly labeled.** I could **not** reach `redditinc.com` from any fetch path (the fetch tool refuses the domain; the browser extension's domain permissions did not cover it). The following is from third-party summaries and is *not* verbatim vendor text:

- Free-tier rate limit commonly reported as **100 queries per minute per OAuth client ID**, averaged over a 10-minute window.
- Commercial uses — "mobile apps with ads, services with paywalls, or any monetized products" — reported to require **prior approval and fees**, with a figure of **$0.24 per 1,000 API calls** cited for commercial access and a stated approval lead time of two to four weeks.
- Standard terms reported to prohibit use of Reddit data in commercial products, for **AI model training**, or for commercial redistribution at scale.

**INTERPRETATION.** If accurate, UCT's paywalled product places any Reddit-sourced sentiment squarely in commercial territory, requiring a negotiated agreement. `.env.example` carries `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` with the comment "r/wsb, r/stocks sentiment" — KEY-PRESENT only; I have no evidence the pipeline is live, and the repo `CLAUDE.md` does not describe a shipped Reddit surface.

**CONFIDENCE.** 🔴 low — **secondary sources only.** **EVIDENCE CEILING:** `redditinc.com/policies/data-api-terms` was unreachable from this environment. Every figure above must be re-verified against the primary document before anyone relies on it. What would raise it: fetching the Data API Terms from a machine that can reach redditinc.com.

**RECOMMENDATION.** Re-fetch the primary terms before any decision. If Reddit is not currently wired, the cheapest answer for Terminal-Next is to leave it unwired.

**OPEN QUESTION.** Is the Reddit pipeline live, dormant, or aspirational? Has Reddit ever approved a commercial agreement for UCT?

---

## 11. Yahoo Finance / yfinance — commercially unusable, and there is no licence to buy

**OBSERVATION.** Yahoo's Terms of Service prohibit both automated collection and commercial reuse, in plain terms. `yfinance` is an unofficial scraper with no licence from Yahoo.

**EVIDENCE — primary, verbatim.** *Yahoo Terms of Service*, `https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html` (last updated noted as **May 6, 2025**):

- **§2.5:** "Unless otherwise expressly stated, you may not access or reuse the Services, or any portion thereof, for any commercial purpose."
- **§2.4(ix):** may not "access or collect data, or attempt to access or collect data, from our Services using any automated means, devices, programs, algorithms or methodologies, including but not limited to robots, spiders, scrapers, data mining tools, or data gathering or extraction tools, for any purpose without our express, prior permission."
- **§2.4(x):** may not "use any material or content from, including without limitation any data, (a) to create any database, archive, mobile application, data feed, widget or any other aggregated data source that competes with or constitutes a material substitute for the Services."
- **§2.8:** "Unless you have explicit written permission, you must not reproduce, modify, rent, lease, sell, trade, distribute, transmit, broadcast, publicly perform, create derivative works based on, or exploit for any commercial purposes, any portion or use of, or access to, the Services."
- Yahoo Finance is provided by Yahoo Finance LLC (U.S.).

**INTERPRETATION.** All four clauses are independently violated by a scraper feeding a paid product: §2.4(ix) by the scraping itself, §2.5 and §2.8 by the commercial purpose, and §2.4(x) by building a bars database that substitutes for Yahoo Finance. Unlike FMP or Massive, **there is no upgrade path** — Yahoo does not sell a retail market-data redistribution licence for this, so "buy the right tier" is not available. `yfinance` is also a third-party library whose own licence (Apache-2.0) governs the *code*, not the *data* — a distinction that regularly gets conflated.

**RELEVANCE TO UCT.** Per the repo's `CLAUDE.md` (CLAIM, not verified by me), yfinance is used as a **fallback** for stale intraday bars, for split-adjusted daily data, in `fundamentals`/`dividends_calendar`, in `catalyst/ticker_metadata`, and — notably — behind `api/schwab_router.py`'s `_fetch_earnings_yf`. Fallback paths are the dangerous shape here: they are invisible when the primary works and serve members when it doesn't, so the exposure is intermittent and unmonitored.

**CONFIDENCE.** 🟢 high on the terms (primary, verbatim, dated). 🟡 medium on UCT's dependency depth, which rests on `CLAUDE.md` claims I did not verify in code.

**RECOMMENDATION.** For Terminal-Next, treat yfinance as an **engineering debt with a legal edge**, not a free data source. Since Massive already covers bars, the sane end-state is removing yfinance from any member-facing path — which also removes a silent correctness risk the repo has already been burned by (the FMP/yfinance timezone-shift class). E-02 should enumerate which member-visible fields can be served by yfinance today.

**OPEN QUESTION.** None for the owner — this needs no contract fact. It is a build decision.

**Preliminary classification (Yahoo/yfinance):** every data class — **Unsuitable** for member-facing use.

---

## 12. Charles Schwab Developer (Trader API) — individual vs commercial is a gated approval

**OBSERVATION.** Schwab distinguishes Individual from Commercial Trader API use, and both are approval-gated. Market-data redistribution requires exchange agreements.

**EVIDENCE — SECONDARY, labeled.** `developer.schwab.com` returned **403** to fetch; the Market Data Agreement sits behind a developer login I did not attempt. From secondary sources:

- Schwab offers Trader API for **Individual** use (an app authenticating into your own account) or **Commercial** use (an app distributed, free or paid, for other self-directed brokerage accounts).
- Access is approval-gated: a developer account enters "pending status," and each API product request is separately reviewed.
- "Commercial use, market-data redistribution, and large-scale integrations require Schwab review and exchange-data agreements."
- Schwab's own market-data terms (via the Electronic Services Agreement) apply NYSE / Consolidated Tape Association / Consolidated Quotation / NASDAQ terms, and define a "**Nonprofessional Subscriber**" as a natural person not registered or qualified with the SEC, CFTC, state securities agencies, or securities exchanges.

**INTERPRETATION.** Schwab is the one vendor in the roster where the **professional/non-professional subscriber** classification and **named exchange fees** (NYSE/CTA/CQ/NASDAQ) are squarely in play — because Schwab passes through exchange entitlements. If UCT were ever to display Schwab-sourced market data to members, each member would arguably need their own subscriber classification, which is a per-user compliance model UCT does not have.

**RELEVANCE TO UCT.** Per repo `CLAUDE.md`, `api/schwab_router.py` is **partner-owned** (Ravi). Its `_fetch_earnings_yf` is Yahoo-backed rather than Schwab-market-data-backed, which — if accurate — means the Schwab exposure may be narrower than the router name suggests. I note the file's existence and mounting only; per the preamble I do not describe it at a depth that invites editing.

**CONFIDENCE.** 🔴 low — secondary sources only. **EVIDENCE CEILING:** the Schwab developer portal and its Market Data Agreement require a login. What would raise it: the owner (or Ravi) exporting the accepted agreement text from the Schwab developer account.

**RECOMMENDATION.** Establish first whether any **Schwab market data** (as opposed to a member's own account data) reaches a member surface. If it does not, this vendor drops to low priority. If it does, the exchange-entitlement and non-professional-classification questions become a significant programme item.

**OPEN QUESTION.** Which Schwab API product was approved — Trader API Individual or Commercial? Was a Market Data Agreement accepted, and does it permit display to third parties?

---

## 13. Anthropic — the most permissive AI terms in the stack, and explicitly product-facing

**OBSERVATION.** Anthropic's Commercial Terms assign Output ownership to the customer, bar training on customer content, and expressly contemplate powering the customer's own end-user products.

**EVIDENCE — primary, verbatim.** *Commercial Terms of Service*, `https://www.anthropic.com/legal/commercial-terms`, **Effective June 17, 2025**:

- **§B (Customer Content) — training:** "**Anthropic may not train models on Customer Content from Services.**"
- **§B — ownership:** "Anthropic hereby assigns to Customer its right, title and interest (if any) in and to Outputs."
- **§A.1 (Overview) — end users:** Services may be used "to power products and services Customer makes available to its own customers and end users."
- **§D.4 (Use Restrictions):** Customer "may not … resell the Services except as expressly approved by Anthropic."
- **§L.1 (Warranties) — the clause that matters most for UCT:** "Customer further represents and warrants that it **has all rights and permissions required to submit Inputs to the Services**."
- **§E.4:** Confidential Information destroyed on request, except where retained for law or in automated backups.

**INTERPRETATION.** For UCT's own product, Anthropic is close to unproblematic: outputs are UCT's, inputs are not trained on, and member-facing products are the anticipated use.

⭐ **But §L.1 is the sleeper clause, and it is the one worth carrying forward.** UCT's LLM pipelines feed *third-party vendor data* into Anthropic as Inputs — FMP fundamentals into earnings analysis, tweet text into the catalyst engine, Finnhub transcripts into summaries, TheFly headlines if ever wired, COT facts into the narrative generator. **§L.1 makes UCT warrant it had the right to submit each of those.** So every upstream restriction in this document (§2 FMP, §6 Finnhub, §7 TheFly's text-mining ban, §9 X) re-enters through the AI layer as a warranty UCT has given to Anthropic. The AI vendor is permissive; the AI *pipeline* inherits the strictness of its worst-licensed input.

That is the single most important cross-vendor observation in this report, and it is invisible if each vendor is assessed alone.

**RELEVANCE TO UCT.** Every Compass, wire, catalyst, COT-narrative, and Model Book LLM surface.

**CONFIDENCE.** 🟢 high (primary, verbatim, dated). Ceiling: none on the terms. Which vendor data actually reaches which prompt is a code question for D-group.

**RECOMMENDATION.** When E-02 maps data classes to surfaces, map them to **prompts** as well as to pixels. A restricted field that is never displayed but *is* sent to a model is still a §L.1 exposure.

**OPEN QUESTION.** None for the owner on Anthropic's terms.

**Preliminary classification (Anthropic):** LLM processing and member-facing outputs — **Likely Allowed**, conditioned on §L.1 rights in the inputs.

---

## 14. OpenAI and Perplexity — primary documents unreachable; secondary read

**OBSERVATION.** Both vendors' legal pages returned 403 to every path I tried, including via the browser (openai.com is outside the browser extension's permitted domains). What follows is **secondary and labeled**.

**EVIDENCE — SECONDARY, not verbatim vendor text.**

**OpenAI** (`openai.com/policies/business-terms/` → 403; `help.openai.com` article → 403). From secondary summaries of OpenAI's published position:
- By default OpenAI **does not train** on inputs or outputs from business products, including the API; organisations are opted out unless they explicitly opt in.
- API inputs and outputs are **removed after 30 days** unless legally required to be retained; **zero data retention** is available for eligible endpoints on qualifying use cases.
- Customers own their inputs and outputs; fine-tuned models are not shared with other customers.

**Perplexity** (`perplexity.ai/hub/legal/perplexity-api-terms-of-service` → 403 with and without `www`). From secondary summaries, one clause is quoted consistently and is the relevant one:
- Customers may "submit Input to the Service, receive Output from the Service, and **display such Output solely within Customer Applications** in accordance with the API Documentation."
- Enterprise terms reportedly assign Output ownership to the Customer; the standard consumer ToS reportedly contains no such assignment.
- Customers are "responsible for verifying the accuracy of outputs, including by reviewing sources cited in or in connection with outputs."
- **Rate limits (primary, from `docs.perplexity.ai/guides/usage-tiers`, which *did* fetch):** six spend-based tiers, Tier 0 ($0) through Tier 5 ($5,000+ lifetime spend); "once you reach a tier, you keep it permanently with no downgrade." Sonar ranges from 50 to 4,000 RPM depending on tier; deep-research models 5–100 RPM; leaky-bucket limiter returning 429 with `Retry-After`. **The docs do not state any citation-display requirement.**

**INTERPRETATION.** If the secondary reading holds, Perplexity's "display Output **solely within Customer Applications**" is a workable grant for UCT's use (Output shown in UCT's own app), and OpenAI's default no-training / 30-day retention posture is unproblematic. Neither vendor appears to be a blocker. But note the same §L.1-style transitivity as Anthropic: Perplexity Output frequently *quotes source material*, and citation is not permission — reproducing substantial portions of a cited source can infringe regardless of the AI vendor's terms.

**CONFIDENCE.** 🔴 low for both — **no primary text obtained.** **EVIDENCE CEILING:** openai.com, help.openai.com and perplexity.ai/hub all returned 403 from this environment; openai.com is not in the browser extension's allowlist. What would raise it: fetching both documents from a normal browser session and pasting the clause text.

**RECOMMENDATION.** Re-verify both from a machine with ordinary web access before E-02 relies on them. Neither looks like a blocker, but "looks like" is doing real work in that sentence.

**OPEN QUESTION.** Which Perplexity tier is UCT on (it changes rate ceilings and possibly which ToS — standard vs Enterprise — governs Output ownership)?

---

## 15. Vendors that do not constrain member-facing data display — one line each

Per contract these get one line unless they constrain display. Only two do.

| Vendor | Constrains data display? | Note |
|---|---|---|
| **Stripe** | No | Payments processor; constrains PCI handling and card-data storage, not market-data display. |
| **Resend** | No | Transactional email; constrains sending practice, not display. |
| **Sentry** | No | Error monitoring; a PII-scrubbing concern (member data in stack traces), not a display licence concern. |
| **Discord** | No | Outbound webhooks. But note: posting *vendor-sourced* content into a public Discord is **redistribution to third parties** under FMP §2.6.1(i), Finnhub, Massive §6.1(e) and TheFly — the constraint travels with the payload, not the channel. |
| **YouTube Data API** | **Yes, mildly** | *YouTube API Services Terms of Service*, last updated **2026-04-28**. §10.3: "All API Clients must provide proper attribution in accordance with the YouTube Branding Guidelines." §16.3: "No rights or licenses are granted to reproduce or distribute audiovisual content … other than through the use of the YouTube API Services." §24.3: on termination, "delete all YouTube API Services (including all API Data)." No explicit ML prohibition found. Relevant to The Desk's video surfaces. |
| **Buffer** | No | Scheduling/publishing tool; same travelling-payload caveat as Discord. |
| **logo.dev** | Unknown | `logo.dev/terms` returned **HTTP 429**; not retried within budget. Company logos are third-party **trademarks**; the usual licence shape requires attribution and disclaims trademark rights. Repo `CLAUDE.md` describes a publishable token (`LOGODEV_TOKEN`) and a proxy-and-cache onto `/data` — caching a logo CDN is the kind of thing such terms often restrict. **Worth one follow-up fetch.** |
| **SnapTrade** | **Yes, for member data** | *Developer Terms of Use*, `snaptrade.com/developer-terms-of-use` (secondary summary, labeled): developers are prohibited from mining, re-selling, or re-packaging End User data obtained via the API to third parties **without the express written consent of both the End User and SnapTrade**. Directly relevant — J2 broker sync holds members' brokerage data, and this bars onward use, not merely onward sale. |
| **CFTC (COT)** | No | U.S. Government public-domain data from `cftc.gov` public zips; no licence obstacle. Lowest-risk source in the stack. |
| **SEC EDGAR** | No | U.S. Government public domain; SEC requests a descriptive User-Agent and imposes a fair-access rate limit (~10 req/s), which is an access etiquette rule, not a display restriction. |
| **Picovoice** | Unknown | **Discovered in `.env.example`** (`VITE_PICOVOICE_ACCESS_KEY`), not in the contract roster. Wake-word/voice SDK. Picovoice licensing is typically per-application with free-tier user caps — a **per-user ceiling** that could bind at member scale. Not researched; flagged for a follow-up. |

---

## 16. Cross-vendor synthesis

**OBSERVATION.** Three patterns run across the whole roster and are only visible in aggregate.

**1. The individual-vs-commercial trap is the dominant risk shape.** Massive, FMP, Alpha Vantage, Finnhub and Schwab all sell a cheap tier that is explicitly **individual/personal/non-commercial**, and all five publish terms under which UCT's paid, multi-user product is commercial. A founder-built product naturally starts on the individual tier and never re-reads the terms after scaling. **Five of the roster's most-used vendors have this exact shape, and in each case the vendor sells the compliant tier** — meaning most of this is purchasable, not fatal. The two exceptions are Yahoo (no licence to buy) and Finviz (no published terms to comply with).

**2. Restrictions travel through the AI layer.** Anthropic §L.1 warrants that UCT has the rights to every Input. So FMP's display ban, Finnhub's "derived results" ban, TheFly's text-mining ban and X's content rules all re-attach at the prompt boundary. Any licensing map drawn only over *rendered pixels* will miss this entirely.

**3. Caching is a licence obligation, not just an engineering choice.** FMP §6.3 (delete all Data "including data cached," plus a signed Data Deletion Agreement and audit right), Finnhub ("All data must be deleted should your subscription … ends"), FRED (destroy and certify), YouTube §24.3, X §IV.B (24-hour deletion on request). UCT's architecture is heavily cache-first — memory TTLCache, disk `/data/bars_cache`, SQLite bars/tweets/cot/catalyst DBs, R2 snapshots, browser IndexedDB. **Some of that reaches members' browsers, where UCT cannot delete it on demand.** Exiting a vendor is therefore a multi-store engineering project, and the browser tier may not be fully reachable at all.

**RELEVANCE TO UCT.** For Terminal-Next these argue for a **provenance tag on every data field** — vendor of origin carried alongside the value — so that display eligibility, prompt eligibility, and cache-deletion scope can all be computed rather than remembered. That is a design input, not a requirement; it is E-02/E-04's call whether it earns its cost.

**CONFIDENCE.** 🟡 medium — the individual clause readings are 🟢, but the synthesis depends on how UCT actually uses each vendor, which I did not inspect.

---

## 17. Consolidated preliminary classification

Nothing is "Allowed" — that needs owner confirmation. Data classes UCT does not take from a vendor are omitted.

| Vendor | Bars | Quotes/RT | Options | Fundamentals | Estimates/Earnings | Econ | News | Social | Driving clause |
|---|---|---|---|---|---|---|---|---|---|
| **Massive** | Likely Allowed* | Likely Allowed* | Unknown | Likely Allowed* | — | — | — | — | §2.2+§6.1(e) Edge Users; *iff business tier |
| **FMP** | Restricted | Restricted | — | Restricted | Restricted | Restricted | Restricted | — | §2.2.2 Data Display |
| **Finviz Elite** | Unknown | Unknown | — | Unknown | — | — | Unknown | — | no published terms |
| **Finnhub** | — | Restricted | — | Restricted | Restricted | — | Restricted | — | no redistribution of data "or derived results" |
| **FRED** | — | — | — | — | — | Likely Allowed† | — | — | †attribution + per-series copyright check |
| **Alpha Vantage** | — | — | — | — | — | Restricted | Restricted | — | §2(a)(ii)&(iii) commercial use |
| **TheFly** | — | — | — | — | — | — | Unsuitable | — | "COMMERCIAL USE … STRICTLY FORBIDDEN" |
| **twitterapi.io / X** | — | — | — | — | — | — | — | Restricted | X §III.A(d); training Unsuitable §III.A(k) |
| **Reddit** | — | — | — | — | — | — | — | Restricted | commercial needs paid agreement (secondary) |
| **Yahoo / yfinance** | Unsuitable | Unsuitable | — | Unsuitable | Unsuitable | — | — | — | Yahoo ToS §2.4(ix), §2.5, §2.8 |
| **Schwab** | Unknown | Unknown | Unknown | — | Unknown | — | — | — | approval-gated; exchange agreements |
| **Anthropic** | LLM processing + outputs to members: **Likely Allowed** (§L.1 input-rights warranty) |
| **OpenAI / Perplexity** | LLM processing: **Unknown** — primary terms unreachable, secondary reading favourable |

---

## 18. Questions for the owner → `OWNER_INPUTS_REQUESTED.md`

Facts only the owner has. Per contract I do not answer these. Ordered by how much they change.

1. **Massive plan tier** — Business/Enterprise, or an individual tier (Basic/Starter/Developer/Advanced)? Gates most of TERMINAL-NEXT; the gap between the answers is roughly $2,300/month.
2. **FMP** — is there a signed **Data Display and Licensing Agreement**? Is the plan the public "Individual Use" Premium, or a commercial plan / Order Form?
3. **Finviz Elite** — what agreement was presented at purchase? (Retrievable from the account or purchase email.) Is Finviz used as an internal scanner input, or are Finviz images served to members?
4. **Finnhub** — plan tier, and any **written approval** to redistribute data or derived results to end users?
5. **Alpha Vantage** — free tier or a written premium/commercial agreement?
6. **TheFly** — is there an actual subscription/API key, and is it consumer or syndication/licensing?
7. **Schwab** — Trader API Individual or Commercial approval? Was a Market Data Agreement accepted, and does Schwab market data reach any member surface?
8. **Reddit** — is the pipeline live, and was a commercial agreement ever approved?
9. **Perplexity** — usage tier, and standard vs Enterprise terms?
10. **Any contract addenda, Order Forms, or written vendor exceptions** not visible on public pricing pages — for any vendor above.
11. **Seat counts** — how many people at UT/UCT hold logins to each vendor (bears on per-seat terms: TheFly's one-user rule, FMP's account-sharing ban, Finnhub's personal-plan rule)?
12. **Picovoice** — plan/licence, and is there a per-user or per-application cap that binds at member scale?

---

## GAPS

What my budget did not reach:

- **No primary text for OpenAI or Perplexity.** Both 403 to every fetch path; openai.com is outside the browser extension's domain allowlist. §14 is secondary throughout and labeled as such.
- **No primary text for Reddit's Data API Terms.** `redditinc.com` is unreachable from this environment by both tools. §10 is entirely secondary — treat every number in it as unverified.
- **FMP's Acceptable Data Use Policy** is incorporated by ToS §2.6.2 and returns **404**. UCT is bound to a document that does not resolve publicly.
- **Finviz has no published terms.** Not a budget failure — a genuine absence, confirmed from four entry points.
- **Finnhub's pricing/tier table** is JS-rendered and yielded nothing; per-tier rate limits and any real-time exchange fees are unconfirmed beyond the ToS's global "30 API calls/second."
- **Massive Options/OPRA terms.** The Businesses ToS names "Third-Party Agreements" (§2.5) but publishes none. Given UCT runs an OPRA tape, this is the most significant single gap in an otherwise well-evidenced vendor.
- **X Display Requirements and Developer Policy** read only via secondary summaries (the primary agreement itself was obtained; these two companion documents were not).
- **logo.dev terms** — HTTP 429, not retried.
- **Picovoice** — discovered in `.env.example`, not researched at all.
- **Exchange-level agreements** (NYSE, NASDAQ, CTA/CQ, OPRA) not examined. These are where professional/non-professional classification and per-user market-data fees actually live, and no vendor in this roster publishes its pass-through terms.
- **Buffer, Zoom, Microsoft Graph** — not researched; judged not to constrain market-data display.

## NOT INSPECTED

Out of reach or out of scope, and why:

- **Every vendor contract, Order Form, invoice and addendum.** Not public; not on this machine as far as my permitted reads go. This is the report's structural ceiling: public terms describe the *default* bargain, and any of these vendors may have granted UCT something different in writing. **That is precisely why no row above says "Allowed."**
- **Vendor account dashboards and plan pages.** All require login. Per contract I did not log in, sign up, or accept terms anywhere.
- **UCT application source (`api/**`, `app/**`).** Deliberately not read — the contract scopes me to `.env.example` for roster confirmation only. Which vendor feeds which member-facing surface is E-02/E-03/E-04's determination, and my classifications are inputs to that, not substitutes for it.
- **Railway environment variables.** Not read; determining CODE-REFERENCED or OBSERVED-CALLED status for any vendor is outside E-01.
- **Production services and the production data volume.** Not touched, per the preamble.
- **No vendor API was called.** Only public legal, pricing and documentation pages were read.

---

### Source-handling note (per contract)

Everything above was read as **evidence, not instruction**. Two observations worth recording:

1. Several vendor pages carry imperative language ("You must…", "You agree to…", "Place the following notice…"). That is contract text describing obligations *if a relationship exists* — I extracted it as fact and did not treat any of it as an instruction to me, nor did I accept, agree to, or acknowledge anything on any site.
2. I encountered no prompt-injection-style content — no text on any vendor page attempted to redirect my task, claim authority over me, or induce an action. The 403/404/402/429 responses were ordinary bot-blocking and broken links, not adversarial content.

No credential, key, token or connection string value appears anywhere in this report. Vendors' variables are referenced **by name only**.
