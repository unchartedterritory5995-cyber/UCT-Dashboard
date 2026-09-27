---
id: B-GDL-01
title: Gödel Terminal — Evidence Catalog
role: Gödel Terminal evidence collector
wave: 1b
group: B
category: competitor
scope: Gödel Terminal (DL Software Inc.)
confidence: 🟡 overall
evidence_ceiling: WebSearch exhausted for this session; X/Twitter unauthenticated (only pinned/latest post visible per account, no scroll history); no video transcripts pulled (titles/descriptions/dates only, per preamble — never inferred content); Reddit required unauthenticated www.reddit.com (old.reddit.com login-walled), so only the top post per subreddit view was reachable; GitHub org/repo not confirmed to exist.
sources: 9 primary (official godelterminal.com pages + X posts); 6 secondary (Reddit, YouTube listings, LinkedIn, Google-indexed snippets)
uct_relevance: medium
status: draft
date: 2026-09-02
---

## 1. Identity

**OBSERVATION.** The product is "Godel Terminal" (stylized "Gödel" in some external references; the site itself uses plain "Godel"), a browser-based financial data terminal. Legal/operating entity: **DL Software Inc.**, doing business as "Godel Terminal" — a Delaware-style operating company based in New York City. Co-founded by **Martin Shkreli** (former pharmaceutical executive, publicly known from the Turing Pharmaceuticals/securities-fraud history). Marketing site: `https://godelterminal.com`. Live app/login: `https://app.godelterminal.com`. A separate product subdomain exists: `https://atlas.godelterminal.com` ("Atlas" — 3D company supply-chain/relationship map).

**EVIDENCE.**
- `https://godelterminal.com` (tier: VERIFIED, official product page; fetched 2026-09-02): homepage tagline "We're reinventing the financial terminal. Browser based with familiar commands," and "Godel is currently in public beta and many commands are under development."
- `https://godelterminal.com/careers` (tier: VERIFIED; fetched 2026-09-02): company timeline module ("Our Story," tabs 2024/2025/2026) — "Founded: Martin Shkreli starts Godel after a career on Wall Street... Martin set out to build the terminal he wished he had. We close our $2M pre-seed round." Company is described as "a growing NYC team," all open roles "based in our New York office." Footer: "DL Software © 2026. All rights reserved." Legal disclaimer identifies the entity as "DL Software dba Godel Terminal," explicitly "not a broker or registered investment advisor... not registered with any financial or securities regulatory authority."
- `https://godelterminal.com/news` (tier: VERIFIED; fetched 2026-09-02): two press releases — "DL Software Completes $2 million Pre-Seed Investment Round" (July 22, 2024; led by dao5, Naval [Ravikant], and Evolve Ventures; other participants "Kevin Zhou, Meltem Demirors, Balaji, and co-founders from Anduril, Rippling, Flexport, Intercom, Lambda, Replit, and Ankr") and "DL Software Completes $5 million Seed Investment Round" (January 22, 2026; led by Infinitum, with Flex Capital, continued dao5 support, "and many Godel users"). Cumulative disclosed funding: **$7M** across two rounds.
- LinkedIn (tier: REPORTED, third-party profile page, via Google snippet, fetched 2026-09-02): "Martin Shkreli · Co-Founder · DL Software Inc. ... DL Software is the parent company of Dr. Gupta, Godel Terminal and Druglike." (Confirms DL Software is a multi-product holding company, not Godel-exclusive — an OPEN QUESTION for how much engineering/company attention Godel gets vs. siblings.)
- LinkedIn — "Daniel Dietzel - Frontend Lead @ Godel Terminal" (tier: REPORTED, via Google snippet, fetched 2026-09-02): corroborates a small in-house engineering team exists (consistent with the 3 open engineering roles + 1 ops role on the careers page at fetch time: Senior Full Stack Engineer, Frontend Engineer, Backend Engineer, Data Entry & Research Associate).

**INTERPRETATION.** Godel Terminal is a young (founded 2024), venture-backed ($7M total, seed-stage), small-team (implied single-digit-to-low-double-digit engineering headcount) startup explicitly positioning itself as a cheaper alternative to Bloomberg/LSEG/FactSet. It is still labeled "public beta" on its own homepage as of the fetch date. The founder's public persona (Martin Shkreli, convicted of securities fraud, released from federal prison, now a media personality) is central to its marketing — nearly all discovered video/social content is Shkreli demoing or discussing the product himself, not a separate corporate voice.

**RELEVANCE TO UCT.** Terminal-Next benchmarking: Godel is a useful "how does a scrappy team ship a Bloomberg-alternative at 1/30th the price" case study, not a governance or compliance model (it explicitly disclaims being a regulated entity).

**CONFIDENCE.** 🟢 for company identity/funding/founder (directly sourced from the company's own press page). 🟡 for "no other company/team info exists beyond what's listed" — a fuller cap-table, headcount, or legal-history connection to Shkreli's securities-fraud past and Godel's own past regulatory scrutiny was not searched (out of scope per contract — identity only).

## 2. Evidence Catalog (primary artifacts)

| # | URL | Type | Date fetched | What it shows/claims | Class |
|---|---|---|---|---|---|
| 1 | `https://godelterminal.com` | Product page (official) | 2026-09-02 | Product name, tagline, capability list (hover pills), "$996 a seat" headline claim, customer logo categories, one customer testimonial (DARP ETF) | VERIFIED (page) / CLAIMED (testimonial, pricing headline) |
| 2 | `https://godelterminal.com/pricing` | Pricing page (official) | 2026-09-02 | Full pricing table, FAQ, feature roadmap ("In Godel today" vs "Working on") | VERIFIED |
| 3 | `https://godelterminal.com/docs` | Command reference (official) | 2026-09-02 | Full command/mnemonic list by category, keyboard shortcuts, API statement | VERIFIED |
| 4 | `https://godelterminal.com/careers` | Careers page (official) | 2026-09-02 | Company founding story, funding, team size/roles, values, hiring process | VERIFIED |
| 5 | `https://godelterminal.com/news` | Press page (official) | 2026-09-02 | Funding round announcements w/ dates and investor names | VERIFIED |
| 6 | `https://atlas.godelterminal.com` | Product subdomain (official) | 2026-09-02 | "Atlas" — 3D supply-chain/customer-supplier-competitor relationship map, gated behind login ("Unlock the full terminal") | VERIFIED (existence) / CLAIMED (capability description, page copy not independently confirmed by a demo) |
| 7 | X.com/GodelTerminal (official account) | Social post | 2026-09-02 (viewed unauthenticated; only latest post visible) | Aug 25, 2026 post riffing on a LeBron James CDS news story — brand-voice/engagement content, not a product claim | CLAIMED (brand tone only) |
| 8 | X.com/MartinShkreli (founder's personal account) | Social post, via Google search snippet | 2026-09-02 | Post (~5 days before fetch, so ~Aug 28, 2026): "so happy to release {SPLC} on our godel terminal. check out the insane flight mode/3d visualization we made too" | CLAIMED — corroborates Atlas/{SPLC} (Supply Chain command) as a real, recently shipped feature |
| 9 | `https://x.com/MarkDavidLamb/...` (via Google snippet) | Third-party X post | 2026-09-02 | "Hey @MartinShkreli where's the API for Godel Terminal?" (~9 months before fetch) | REPORTED — corroborates no public self-serve API existed as of ~Dec 2025 |
| 10 | `https://www.reddit.com/r/GodelTerminal/` | Community subreddit (top post at fetch) | 2026-09-02 | "Does Godel have a historical data api for backtesting?" (6 days before fetch) — unanswered at fetch | REPORTED — corroborates #9: no confirmed backtesting/historical-data API as of late Aug 2026 |
| 11 | Google search snippets for `site:reddit.com "Godel Terminal"` | Aggregated secondary | 2026-09-02 | Thread titles: "Godel Terminal Version 4.0+ - New Features for Professional Research and Collaboration" (~1yr old), "Your Experience: Is Godel Terminal Safe? Worth $60/Month?" (~1yr old, implying an earlier/lower price point than today's $996/yr, $118/mo), "why I choose openBB over Gödel" (competitor-comparison thread exists) | REPORTED |
| 12 | YouTube listing snippets (Google video search) | Video titles/dates, no transcript pulled | 2026-09-02 | "Martin Shkreli Shows New Godel Terminal Features" (Shkreli Planet channel, ~2 months old = ~Jul 2026); "Martin Shkreli Gives A Demo Of Godel Terminal" (~1yr old); "Martin Shkreli: 'Gödel Terminal Is Worth Hundreds of Millions...'" (~Oct 2025); one third-party independent review video: "Godel Terminal - A promising new alternative to the Bloomberg Terminal for retail investors" (channel: Objective Trade, ~1yr old, 19.1K views) | DEMONSTRATED (titles/existence only — no transcript read, per preamble ban on inferring video content) |
| 13 | GitHub search snippets | Third-party repos referencing Godel | 2026-09-02 | `Hayden1629/algobot_v2` — "interfaces with Godel Terminal and Schwab API" (community-built integration, mechanism unconfirmed); `Jera-Value/awesome-investing-tools-and-software-directory` lists Godel Terminal as a "web-based, command-line-style financial terminal" | REPORTED — no official Godel Terminal GitHub org/repo found; suggests some community members have found a way to programmatically interface with it despite no public self-serve API (OPEN QUESTION) |

## 3. Capability Inventory (evidence-level, no inference)

Per `docs/pricing` FAQ table ("In Godel today" / "Working on") and `/docs` command reference — this is the ONLY place the product itself distinguishes shipped vs. in-progress:

**Shipped, per official docs/pricing pages (VERIFIED):**
- `QM` Quote Monitor — real-time streaming watchlists, up to 400 tickers/list, batch import (homepage)
- `N` / `TOP` / `TREND` — real-time news, filtered by ticker, "milliseconds" latency claim (homepage: "News in milliseconds... from primary wires, exchange notices, and major outlets")
- `CF` Filings — SEC EDGAR filings (10-K/10-Q/8-K/S-1/proxies/13F), in-product rendering (homepage + pricing)
- `FA` Financials — standardized income statement/balance sheet/cash flow, Excel-exportable (homepage)
- `DES` Security Overview — description, real-time chart, market cap, EPS estimates, ratings, key dates (homepage)
- `WEI`/`WEIF` World Equity Index(+Futures) — global index coverage across Americas/EMEA/Asia-Pacific (homepage, docs)
- `EM` Earnings Matrix — forward EPS/revenue consensus, implied multiples, analyst ratings/targets (homepage)
- `HDS` Holders & 13F, `HMS` Peer comparison — listed as shipped on pricing page
- `OMON` Option Chain, `OVME` Black-Scholes calculator, `CALC` — listed in `/docs` command reference under "Portfolio & Risk"
- `EQS` Equity Screener — tagged **BETA** in `/docs`
- `IMAP`/`HMAP` Intraday Market Map / Market Heatmap — tagged **BETA** in `/docs`
- `{SPLC}` / Atlas — 3D supply-chain/relationship visualization ("flight mode"), per founder's own X post, announced ~Aug 2026 — the newest capability found in this pass
- Multi-asset coverage claimed on `/traders` page (Google-cached meta description, not independently re-verified by direct page read due to a rendering miss in this session): "equities, ETFs, indices, FX, futures, options, and bonds"
- Excel export (mentioned on homepage under Financials)
- Layouts (custom window layouts, keyboard-driven: `` ` `` focus, Tab/Shift+Tab cycle windows, Shift/Ctrl+Shift/Option+arrows for move/snap/resize) — full shortcut table in `/docs`
- Chat (`CHAT` command) — in-terminal community/paid chat channels, referenced on pricing page ("Access to all paid chat channels")

**Explicitly "Working on" per pricing page (VERIFIED, company's own roadmap admission):**
- `PORT` Portfolio analytics
- `MEMB` Index membership
- `EQS` deeper screening (v2 & v3 — beyond the current BETA)
- `GF` / `EQRV` Time series
- ETFs & mutual funds (deeper coverage)
- More private company data
- Podcasts

**API access (evidence conflict — noted, not resolved):**
- `/pricing` FAQ (VERIFIED, fetched same day): "Is there an API? Coming soon. If you'd like to beta test it or join the waitlist, talk to us."
- `/docs` (VERIFIED, fetched same day): "We offer REST and WebSocket access to enterprise customers on a case-by-case basis. Talk to our sales team..."
- These two official pages, fetched the same day, are not phrased identically — `/pricing` reads as "no API yet, waitlist," `/docs` reads as "API exists today for enterprise, ad hoc." Corroborating evidence leans toward **no self-serve API exists**: a third-party X user asked "where's the API" (~Dec 2025) and a Reddit user asked the same (~late Aug 2026, unanswered at fetch), i.e. spanning ~9 months, the question recurs unresolved in public community channels. **INTERPRETATION:** API access likely means bespoke enterprise deals only, not a documented public product — treat "Coming soon" as the operative current state for anyone but a sales-negotiated enterprise account.

**Not evaluated (out of scope per contract):** whether any of the above works well, or is complete relative to Bloomberg's equivalent function.

## 4. Pricing (VERIFIED — `https://godelterminal.com/pricing`, fetched 2026-09-02)

- **Monthly:** $118/month (single seat)
- **Annual:** starting at $996/year (~30% savings vs. monthly; ~$83/mo equivalent)
- **Team & Enterprise:** custom quote, multi-seat org billing, compliance/audit tools, dedicated account rep
- **FINRA surcharge:** +$30/month for users holding an active FINRA registration ("in line with Nasdaq's professional-subscriber data fees") — $148/mo on Monthly, or $996/yr + $360/yr on Annual
- **Free trial:** 14 days, opens "most of Godel": real-time Nasdaq quotes, news, SEC filings, financials, charting, full command set
- Self-positioned against named competitors with specific price figures (company's own claim, not independently verified by this pass): "Bloomberg Terminal runs ~$27,000, LSEG Workspace ~$22,000+, and FactSet $12,000–$24,000."
- A ~1-year-old Reddit thread title ("Your Experience: Is Godel Terminal Safe? Worth $60/Month?") implies an earlier price point around $60/month existed historically — **not confirmed**, only a thread title; flagged as an open question (possible early-beta pricing that has since risen to $118/mo).

## 5. Positioning (VERIFIED, company's own copy)

- Homepage framing device: **"The Problem — A $30,000 terminal can't go on every desk. Today: Most of the team shares one or waits their turn. In Godel: Everyone gets their own. From $996 a seat."** — positions Godel not as a feature-for-feature Bloomberg replacement but as a **per-seat democratization** play: give every analyst their own terminal instead of a shared/rationed Bloomberg seat.
- Customer story (homepage, attributed quote, ≤40 words): **"Godel was not just a good replacement. It's exceptional. It's clearly built by people who understand that news drives stocks."** — Thomas George, Portfolio Manager, DARP ETF (managed by Grizzle). Company claims this customer saved "~$28,000/yr per analyst vs. a legacy terminal."
- Careers page "Why Godel?" (≤40 words): **"For 20 years, legacy terminals haven't kept up with the most consequential changes in global investing... We think every investor deserves a workspace built for what they actually do."**
- Founder design principle, from Careers "Our Story" (≤40 words): **"Martin set out to build the terminal he wished he had."** — no fuller philosophy statement (e.g. a manifesto or FAQ "why we built this") was located within budget.
- "USED TODAY BY" homepage banner claims five customer categories with no named-logo proof shown in the fetched text: Hedge funds, Family offices, RIAs, Banks, Fortune 500 companies (CLAIMED, unverified by name).
- Third-party reviewer framing (REPORTED, YouTube title only): "Godel Terminal - A promising new alternative to the Bloomberg Terminal for retail investors" — note this positions Godel toward **retail**, which sits in tension with the company's own homepage banner emphasizing hedge funds/banks/RIAs/Fortune 500. **OPEN QUESTION for Wave 2:** is Godel actually targeting institutional desks, prosumer/retail traders, or both simultaneously, and does the product differ by audience?

## 6. Ceilings / What Could Not Be Reached

- **WebSearch tool exhausted** (per `_EXTERNAL_PREAMBLE.md`, shared 200/200 cap) — all search in this pass used browser-based Google search in one tab, per the mandated fallback order.
- **X/Twitter unauthenticated limits:** both `@GodelTerminal` and `@MartinShkreli` profile pages, viewed logged-out, surfaced only the single latest/pinned post each — no scrollable timeline. The {SPLC}/Atlas announcement and the "where's the API" question were recovered only via Google's cached search snippets of X content, not by reading the live tweets directly. **What would raise confidence:** a logged-in X session (the owner could authorize `claude-in-chrome` against a logged-in X account) or Nitter-style mirror access to pull a real timeline of the last ~90 days of `@GodelTerminal`/`@MartinShkreli` posts specifically about the product.
- **No video transcripts read.** Per preamble, video content was catalogued by title/channel/approximate date only from Google's video search index — never inferred. At least 4 Shkreli-hosted demo/feature videos and 1 independent third-party review video (Objective Trade, 19.1K views) were identified as DEMONSTRATED-tier candidates for Wave 2 to pull real transcripts from (YouTube auto-captions or the channel's own descriptions).
- **`/about`, `/company`, `/product`, `/customers` paths all 404'd** — the site's information architecture does not use those conventional slugs; the real slugs discovered were `/pricing`, `/docs`, `/careers`, `/news`, `/traders`, `/sec-filings`, `/financial-terminal`, `/equity-research`, `/newsletter`, and the `atlas.` subdomain. A full site crawl (sitemap.xml) was not attempted and would surface the remaining persona/vertical landing pages (e.g. "for hedge funds," "for RIAs" implied by pricing-page related-links but not opened this pass).
- **Reddit required unauthenticated `www.reddit.com`** (old.reddit.com is login-walled); this returns only the top-ranked post per subreddit view in extracted text, not a full thread list or comment bodies — so the "28 answers" / "35 answers" community sentiment referenced in Google snippets was not read directly.
- **No official GitHub org/repo confirmed.** A personal `martinshkreli` GitHub account with "26 repositories" was referenced in a Linktree bio (third-party, unverified whether any repo is Godel-related) — not opened this pass.
- **Pricing-history claim unresolved** ("$60/month" in an old Reddit thread title vs. current $118/month) — would need the thread body/date or a Wayback Machine snapshot of `/pricing` to confirm whether this is historical pricing drift or a misremembering.
- **Search channel used throughout:** browser-based Google search in one tab (`https://www.google.com/search?q=...`), per preamble step 2, since WebSearch was pre-exhausted; WebFetch direct requests to `godelterminal.com` returned HTTP 403 (Cloudflare or similar bot-blocking), so all official-page evidence in this report was captured via the browser tool's `get_page_text`, not WebFetch. No Bing fallback was needed.
- A tab within the same shared browser session appeared to be running other agents' unrelated research (Bloomberg, TradingView, Unusual Whales, Fiscal.ai, Benzinga Pro tabs observed) — none of that content was read or relied upon for this report; noted here only because the environment is shared, not because it affected this evidence.

## 7. Candidate Themes for the Idea Extractor (Wave 2) — headings only

- Per-seat pricing as democratization (vs. Bloomberg's shared/rationed-seat problem)
- Command-line/mnemonic-driven UI on a modern web stack (keyboard-first navigation, window layouts, undo-close)
- 3D supply-chain/relationship graph as a differentiated screen (`{SPLC}` / Atlas)
- Transparent, public, self-serve pricing page with an explicit competitor price table
- Founder-led, personality-driven marketing/demo channel (single visible spokesperson doing product demos)
- "Public beta" transparency: a pricing page that openly lists "Working on" alongside "In Godel today"
- Regulatory-surcharge line item (FINRA users pay a separate fee) as a pricing-model pattern
- Community subreddit as a support/feedback channel run in parallel with an in-app paid chat feature
- No public self-serve API yet, despite recurring user demand — a gap, not a strength, worth flagging as "what NOT to leave unresolved this long"

## SOURCES

1. `https://godelterminal.com` — VERIFIED (official homepage) — fetched 2026-09-02
2. `https://godelterminal.com/pricing` — VERIFIED (official pricing page) — fetched 2026-09-02
3. `https://godelterminal.com/docs` — VERIFIED (official command reference) — fetched 2026-09-02
4. `https://godelterminal.com/careers` — VERIFIED (official careers page) — fetched 2026-09-02
5. `https://godelterminal.com/news` — VERIFIED (official press page) — fetched 2026-09-02
6. `https://atlas.godelterminal.com` — VERIFIED (official product subdomain, existence + login gate only) — fetched 2026-09-02
7. `https://x.com/GodelTerminal` — CLAIMED (official brand account, single latest post, unauthenticated view) — fetched 2026-09-02
8. `https://x.com/MartinShkreli` — CLAIMED (founder's personal account, single pinned post, unauthenticated view; product-relevant post recovered via Google snippet instead) — fetched 2026-09-02
9. Google search results pages (`google.com/search?q=...`, several queries: `"Godel Terminal" about company founder`; `site:godelterminal.com`; `"Godel Terminal" twitter.com OR x.com`; `"Godel Terminal" demo site:youtube.com`; `site:reddit.com "Godel Terminal"`; `"Godel Terminal" github.com`) — SECONDARY aggregator, used only to locate and quote primary-source snippets, each snippet's underlying source tiered individually above — fetched 2026-09-02
10. `https://www.reddit.com/r/GodelTerminal/` — REPORTED (community subreddit, top post only, unauthenticated) — fetched 2026-09-02
11. YouTube video search listings (titles/channels/dates only, no transcripts) — DEMONSTRATED (existence only) — fetched 2026-09-02
12. LinkedIn profile snippets (Martin Shkreli; Daniel Dietzel) via Google cache — REPORTED — fetched 2026-09-02
13. GitHub search snippets (`Hayden1629/algobot_v2`; `Jera-Value/awesome-investing-tools-and-software-directory`) — REPORTED — fetched 2026-09-02

**Explicitly excluded as evidence** (per preamble ban on SEO/affiliate content): `godeldiscount.com` and `godelguide.com` — both read in Google snippets as programmatic SEO/affiliate content (promo-code and "review" blog posts driving signups); their factual claims (e.g. "$7M funding stack," "6-month honest verdict") were directionally consistent with the primary sources above but were not used as citations — noted here only as an observation of the SEO/affiliate ecosystem that has grown around this product, which Wave 2 should also avoid citing as evidence.
