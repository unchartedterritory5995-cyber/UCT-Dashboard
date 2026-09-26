---
id: B-GDL-02
title: Gödel Terminal — Capability Verification (class per capability)
role: Gödel Terminal capability verifier
wave: 1b
group: B
category: competitor
scope: Gödel Terminal (DL Software Inc.) — which catalogued capabilities are real, on what artifact, and at what class
confidence: 🟡 overall
evidence_ceiling: The DEMONSTRATED tier is STRUCTURALLY UNREACHABLE for this product. Gödel operates no official video channel; every product video found is on an affiliate channel carrying a `?via=` referral code or on the founder's personal channel, both barred as evidence by the preamble. The official docs prose references screenshots ("the screenshot above") but no image element is exposed on the pages read. Net: essentially every capability tops out at VERIFIED = "an official page says it ships," which is a claim about documentation, never about running software or data quality. Only a trial seat (OI-18) breaks this ceiling, and the owner must open it — creating an account is prohibited to this role.
sources: 14 primary (godelterminal.com official pages + per-command docs, all fetched 2026-09-02); 4 secondary (Google result pages, affiliate/third-party video listings, HN hiring)
uct_relevance: high
status: draft
date: 2026-09-02
---

## 0. Method, and the one thing that matters about this table

**OBSERVATION.** B-GDL-01 catalogued Gödel's capabilities from the homepage, `/pricing`
and the `/docs` index. This role went one level deeper: `/docs` turns out to be an
**index of per-command documentation pages** at `https://godelterminal.com/docs/commands/<mnemonic>.html`,
each running several hundred words of genuinely operational detail (column lists,
keyboard shortcuts, instance limits, empty states, debounce timings, permission tiers).
That surface did not exist in the Wave-1 evidence base and it changes the picture
substantially — both by adding ~30 commands B-GDL-01 never saw, and by making the
**absence** of certain capabilities provable rather than merely unobserved.

**The class ladder, per contract:**

| Class | Means | Artifact required |
|---|---|---|
| **VERIFIED** | Official docs/product page describes it as shipped | dated godelterminal.com page |
| **DEMONSTRATED** | Official video/stream transcript or dated screenshot shows it running | transcript / screenshot |
| **CLAIMED** | Founder or marketing statement, no artifact | tweet, homepage banner |
| **REPORTED** | Third party says so | Reddit, review, community repo |
| **SPECULATED** | Inference only | — |

⛔ **The single most important finding in this report is about the ladder itself, not
any capability on it.** For Gödel, **DEMONSTRATED is unreachable from permitted sources.**
There is no official Gödel Terminal YouTube channel. Every product video located is
hosted on an affiliate channel whose description carries a referral link and discount
code (`app.godelterminal.com/?via=shkreliplanet`, `?via=theshkrelipill`, `?via=HARDWARE`)
or on Martin Shkreli's personal channel — both excluded by the preamble's ban on
affiliate content as evidence. The official per-command docs write as though screenshots
accompany them ("Checked items in **the screenshot above** are the defaults" — G docs)
but no image element is exposed on the pages read.

**Consequence, and please carry it into synthesis:** a `VERIFIED` cell below means
*"Gödel's own documentation describes this as shipped, in operational detail."* It does
**not** mean anyone has seen it work, that the data behind it is good, or that it is
competitive with the Bloomberg function it is named after. **Nothing in this report
establishes quality.** A uniform column of 🟢 VERIFIED would be exactly the misleading
artifact the preamble warns about, which is why the "Depth actually documented" column
carries more information than the class column does.

**A mitigating consideration, stated as interpretation not evidence:** documentation
this specific is weak positive evidence that the software exists. Nobody writes that
OMON's navigation controls are "debounced into the window props (≈300 ms) so rapid
adjustments don't fire a flurry of API calls," or that N's source selector uses a
tri-state checkbox cycling empty → ✓ included → ✗ excluded, for software that has not
been built. That is an argument about *existence*, not about *quality*, and it is the
most the public record supports.

---

## 1. Capability × class table

### 1a. Command line and mnemonics

| Capability | Class | Artifact | Depth actually documented |
|---|---|---|---|
| Command grammar `<TICKER> <COUNTRY> <ASSETCLASS> <CMD>` | **VERIFIED** | `/docs/commands/g` — "Example: `AAPL US EQ G`: opens a daily chart for Apple" (2026-09-02) | Bloomberg's grammar almost exactly (`AAPL US Equity DES <GO>`). Positional, four slots. |
| Bloomberg alias compatibility | **VERIFIED** | `/docs/commands/g`: "GIP and GP are both aliases for G… If you learned GIP (Intraday Chart) from Bloomberg, keep using it; Godel rewrites it to G internally." `/docs/commands/omon`: "OPT, CALL and PUT are all aliases for OMON." `/docs/commands/n`: "CN and NH both map to N." | Deliberate muscle-memory capture. Aliases are rewritten internally, not merely accepted. |
| Command arguments / modifiers | **VERIFIED** | `/docs/commands/g` — resolution tokens `1m 5m 15m 30m 1h 1d`, e.g. `AAPL US EQ G 1m` | Arguments narrow the launch state, not just the target. |
| Keyboard-first window management | **VERIFIED** | `/docs` shortcut table (2026-09-02) | `` ` `` focus terminal · double-tap Esc close · Tab / Shift+Tab cycle · Shift+arrows move · Ctrl+Shift+arrows snap · Option+arrows resize · Option+Shift+arrows resize-to-edge · Ctrl+Option+↑/↓ resize chrome · **⌘Z undo last window close** · F1 help |
| Window layouts, persisted | **VERIFIED** | `/docs` (Layouts); `/docs/commands/g` — "Settings are saved per chart window… They persist across sessions on your account." | Per-window settings, per-account persistence, multi-screen model ("per screen" limits imply named screens). |
| Window linking by colour | **VERIFIED** | `/docs/commands/g` — "The 🔗 (chain) icon color-links this chart to other windows: any other window linked to the same color will track whichever ticker you switch to here." | Explicitly recommends running G + DES + N + OMON on one colour. **This is UCT's Charts-workspace colour groups A/B/C/D, independently arrived at.** |
| Command as a hypertext primitive | **VERIFIED** | `/docs/commands/chat` — `{TICKER ASSETCLASS G}` embeds a live chart inside a chat message; `/docs/commands/change` — changelog entries carry `{COMMAND}` pills that launch a window and `[EXPR]` pills that evaluate a command string | The grammar is not just an input method; it is a link format that works inside chat and inside release notes. See §4. |
| Single-instance vs multi-instance limits | **VERIFIED** | `/docs/commands/g` — "Up to 30 G windows per screen for every account tier"; CHANGE, CHAT, BROK, ENT each "limited to a single open window" | Instance caps are a documented, tier-aware product surface. |

### 1b. Functions (market data and surveillance)

The `/docs` index groups every command into six sections. Measured 2026-09-02 the index
lists **48 mnemonics** — derive this from the index rather than trusting the number, it
will drift:

- **Company & security analysis (9):** `DES` Description · `FA` Financials · `ERN` Earnings Estimates · `EM` Earnings Matrix · `SI` Short Interest · `GR` Ratio Analysis · `ANR` Analyst Ratings · `EVT` Company Events *(COMING SOON)* · `DVD` Dividend Yield
- **Market data & surveillance (19):** `QM` Quote Monitor · `FOCUS` Focus · `TAS` Time and Sales · `HCP` Historical Change % · `WEI` World Equity Index · `WEIF` World Equity Index Futures · `IMAP` Intraday Market Map *(BETA)* · `HMAP` Market Heatmap *(BETA)* · `GLCO` Global Commodity Futures · `FX` Forex Pairs · `MOST` Most Active · `HDS` Holders · `N` News · `TOP` Top News · `TREND` Trending on Godel · `HALT` Market Halts · `ALLQ` All Quotes · `SECF` Securities Finder · `WJI` Wojak Index
- **Portfolio & risk (6):** `EQS` Equity Screener *(BETA)* · `OMON` Option Chain · `OVME` Black-Scholes · `CALC` Calculator · `BROK` Brokerage · `AUM` Brokerage AUM
- **Charting & technicals (3):** `G` Chart · `HMS` Historical Multiple Security · `HP` Historical Prices
- **Fundamentals & filings (3):** `CF` Filings · `IPO` Initial Public Offerings · `TRAN` Earnings Hub
- **Utilities & system (8):** `HELP` · `CHAT` · `ACM` Account Management · `PDF` Settings · `AL` Alerts · `NOTE` Notes · `ENT` Entitlements · `CHANGE` Changelog

| Capability | Class | Artifact | Depth actually documented |
|---|---|---|---|
| The 48-command surface as a whole | **VERIFIED** (existence + naming) | `/docs` index, 2026-09-02 | Every mnemonic has its own docs page. Beta/coming-soon status is disclosed **on the index pill**, not buried. |
| `QM` Quote Monitor | **VERIFIED** | homepage: "up to 400 tickers per list with batch import," real-time bid/ask, change, volume, latency | Per-list cap stated. Latency displayed as a column — unusual and confident. |
| `TREND` Trending on Godel | **VERIFIED** | `/docs/commands/trend` — "the most-searched tickers in Godel, ranked by search count across all users," 1H/24H/WEEK/MONTH tabs, sparkline of search distribution, auto-refresh 30 s | **A proprietary attention dataset generated by its own userbase, at zero vendor cost.** Delisted tickers render struck-through. |
| `WJI` Wojak Index | **VERIFIED** | `/docs/commands/wji` — "a real-time sentiment gauge built from Pink/Green wojak emoji usage in Godel's #general chat"; 10 named states MANIA (>90% green) → ANNIHILATION (>95% pink) | **A second proprietary dataset synthesised from community behaviour.** `/docs/commands/chat` confirms the wiring: "The #general public chat feed powers the WJI sentiment index." |
| `HALT`, `MOST`, `ALLQ`, `TAS`, `SECF`, `FOCUS`, `HCP` | **VERIFIED** (existence) | `/docs` index | Not opened individually within budget — named and categorised only. |
| `IMAP` / `HMAP` heat maps | **VERIFIED as BETA** | `/docs` index BETA pills | Company's own beta label. |
| `WEI` / `WEIF` / `GLCO` / `FX` global coverage | **VERIFIED** | homepage WEI card: "every major equity index across Americas, EMEA, and Asia/Pacific… change, % change, and YTD" | Breadth claimed by region, not by named venue count. |
| Multi-asset coverage (equities, ETFs, indices, FX, futures, options, bonds) | **CLAIMED** | `/traders` meta description (B-GDL-01). This role re-fetched `/traders` and `/wealth-teams-family-offices` in the browser: **both render as empty shells** under text extraction (only a "Related" link block). | Persona landing pages are JS/animation-driven and yield no extractable body copy. B-GDL-01 hit the same wall. Downgraded from VERIFIED — the claim survives only in a meta description. |

### 1c. Charting

| Capability | Class | Artifact | Depth actually documented |
|---|---|---|---|
| **Charting is TradingView, not in-house** | **VERIFIED** | `/docs/commands/g` — "OHLCV candles, volume, drawing tools, and indicators **powered by TradingView**"; "The top row of the window is Godel's chrome; **everything below it is TradingView**" | The most consequential single sentence in the docs. Gödel builds the chrome and buys the chart. |
| Chart styles | **VERIFIED** | `/docs/commands/g` | Candles, Bars, Line, Area, Baseline, Heikin Ashi, Hollow Candles, Renko, Kagi, Point & Figure, Line Break. |
| Indicators | **VERIFIED** | `/docs/commands/g` — "opens TradingView's full indicator and strategy library. Indicators you add persist per-chart." | Inherited wholesale from the vendor. |
| Drawing tools | **VERIFIED** | `/docs/commands/g` — "pen, trend line, shapes, Fib, etc. follows TradingView's standard layout, hidden by default on narrow windows" | Inherited. Not Gödel-authored. |
| Resolutions | **VERIFIED** | `/docs/commands/g` | 1m/5m/15m/30m/1h/1d + "TradingView's longer intervals where data permits." Default 1d for equities/ETFs/indices/futures/FX/crypto; **1m for options**. |
| Range presets, log/percent/indexed scales, scale lock, invert | **VERIFIED** | `/docs/commands/g` right-click scale menu | 5y·1y·6m·3m·1m·5d·1d presets independent of candle resolution; ⌥L log, ⌥P percent, ⌥I invert; "Indexed to 100" rebase; lock price-to-bar ratio. |
| Alerts from the chart | **VERIFIED** | `/docs/commands/g` — 🔔 bell creates alert at crosshair or last price; right-click y-axis → "Add alert at…"; alerts surface in `AL` and "notify on your desktop when triggered" | Alert creation is anchored to the chart gesture, not a separate form. |
| Data-feed gating on charts | **VERIFIED** | `/docs/commands/g` Notes — "Chart data is gated on the AGGREGATE_RTH feed; if a security is missing that feed, the chart area will render empty" | **A candid failure-mode disclosure**: a missing entitlement produces a blank chart, not an error. Rare honesty in vendor docs; also a real product wart. |
| Chart popout to OS window | **VERIFIED ABSENT** | `/docs/commands/g` Notes — "G does not popout to a native OS window: the chart lives inside the terminal only" | A documented limitation vs. Bloomberg's multi-monitor launchpad. |

### 1d. Fundamentals and filings

| Capability | Class | Artifact | Depth actually documented |
|---|---|---|---|
| `FA` Standardised financials | **VERIFIED** | homepage — "Income statement, balance sheet, and cash flow standardized across every company, annual and quarterly history **with the underlying filings tied to each line item**" | Line-item→filing provenance is claimed. Not independently checkable. |
| `CF` SEC filings from EDGAR | **VERIFIED** | homepage — 10-K, 10-Q, 8-K, S-1, proxies, 13F, "sortable, filterable, and rendered inside the workspace. Pulls direct from EDGAR" | US/EDGAR only. No non-US regulator named anywhere. |
| `EM` Earnings Matrix | **VERIFIED** | homepage — forward EPS/revenue by quarter and year, implied P/E, P/S, P/CF, plus each covering analyst's rating and price target | |
| `HDS` Holders / 13F, `HMS` peer comparison, `ERN`, `SI`, `GR`, `ANR`, `DVD`, `IPO`, `TRAN` | **VERIFIED** (existence) | `/docs` index + `/pricing` "In Godel today" strip | Individual pages not opened within budget. |
| `EVT` Company Events | **VERIFIED as NOT SHIPPED** | `/docs` index — `EVT` carries a **COMING SOON** pill | Disclosed on the index itself. |

### 1e. News — the deepest documented capability in the product

| Capability | Class | Artifact | Depth actually documented |
|---|---|---|---|
| `N` real-time + historical news | **VERIFIED** | `/docs/commands/n` (2026-09-02), ~1,800 words | Two-layer filter model: **per-window** (query, watchlist, ticker scope, date range) vs **global/account-wide** (sources, categories, languages, includes, excludes, class-action). "Both layers are combined on every request." |
| Source/category selector | **VERIFIED** | `/docs/commands/n` | Three-column selector with **tri-state** checkboxes: empty → ✓ include → ✗ exclude → empty. Per-source document counts. Fuzzy source search. |
| Keyword include/exclude | **VERIFIED** | `/docs/commands/n` | Up to **20** include terms and **20** exclude terms. Include = OR-match required; exclude = any-match hides. |
| Class-action spam filter | **VERIFIED** | `/docs/commands/n` | Three-way: Show / Hide / **Only** Class Action. A named, dedicated filter for one specific noise genre. |
| "Set to Recommended" curated defaults | **VERIFIED** | `/docs/commands/n` — "resets your globals to Godel's curated defaults… The exact source list ships with the terminal and can change: **always prefer clicking the button over attempting to replicate the defaults manually**" | The vendor's editorial judgement shipped as a one-click baseline, deliberately not published as a list. |
| Inline match-explanation | **VERIFIED** | `/docs/commands/n` — "inline context snippets: excerpts showing **why** the article matched your keyword include filter" + an Info panel listing every active filter "so you can audit why a given article is (or isn't) showing up" | **Explains its own filtering.** See §4 — this is the strongest transferable idea in the product. |
| Breaking-news alerting | **VERIFIED** | `/docs/commands/n` — red alert banner bottom-right for high-impact stories, "so you catch market-moving headlines even when you are not looking at the News window" | |
| Text-to-speech headlines | **VERIFIED** (paid-only) | `/docs/commands/n` — per-window TTS toggle, voice/speed configured globally, "TTS is subscription-only" | Plausibly powered by DL Software's own sibling product **Neets**, "a generative AI API for text-to-speech" (`/press/pre-seed-round`) — that link is **SPECULATED**, the docs never say so. |
| "News in milliseconds" latency | **CLAIMED** | homepage marketing copy | No methodology, no benchmark, no comparison basis. Marketing. |
| ">$2,000 in media subscriptions consolidated" | **CLAIMED** | homepage N card | Unsourced arithmetic. |
| Documented setup workflows | **VERIFIED** | `/docs/commands/n` ships **six** named workflows: breaking-news-only · watchlist-only · deep single-company research · thematic/macro · noise-floor control · two-window monitor+discovery pattern | Vendor docs teaching *workflow*, not just controls. Notable. |

### 1f. Screening

| Capability | Class | Artifact | Depth actually documented |
|---|---|---|---|
| `EQS` Equity Screener | **VERIFIED as BETA, and thin** | `/docs/commands/eqs` — "Under active development. EQS is in beta, and more filters are coming soon." | |
| — the actual filter set | **VERIFIED** | `/docs/commands/eqs` enumerates it | **Range filters:** Market Cap; P/E, P/S, P/B, P/CF each on Fwd *and* TTM; EPS (Fwd 12mo); Rev (Fwd 12mo, USD). **List filters:** Venue, HQ Country, Sector, Sub-Sector. Toggles: primary-listings-only, hide-no-trades. Currency selector. |
| — **technical screening** | **VERIFIED ABSENT** | Same page — the enumerated field list contains **no price, volume, moving-average, relative-strength, ADR, gap, range, or pattern filter of any kind** | 🔴 **EQS is a fundamentals/valuation screener only.** For a momentum or swing desk it is not a screener at all. Corroborated by `/pricing`, which lists "EQS Deeper screening (v2 & v3)" under **Working on**. |
| Screener export | **VERIFIED** | `/docs/commands/eqs` — "Export to Excel saves the set as CSV or JSON" | |
| `SECF` Securities Finder | **VERIFIED** (existence) | `/docs` index; cross-referenced from EQS "Related commands" | Likely the symbol-lookup counterpart. Page not opened. |

### 1g. Options

| Capability | Class | Artifact | Depth actually documented |
|---|---|---|---|
| `OMON` Option Chain | **VERIFIED** | `/docs/commands/omon` (2026-09-02) | "every strike and expiration with live bid, ask, last, volume, IV, and the full set of Greeks." |
| Greeks | **VERIFIED** | `/docs/commands/omon` column table | Delta, Gamma, Vega, Theta, **Rho, Lambda, Epsilon** — a fuller set than most retail platforms ship. Greeks selection "packed into a compact bitmask and stored per mode." |
| Chain ergonomics | **VERIFIED** | `/docs/commands/omon` | Both/Calls/Puts modes each with independent column order; expiration dropdown + arrow-stepping; months-out; strikes-above/below (default 10 each); drag-reorder and resize columns; highlighted live spot band between ITM and OTM sides. |
| Streaming | **VERIFIED** | `/docs/commands/omon` Notes — "Options data is streamed via websocket, so rows update live as quotes change" | |
| Contract drill-through | **VERIFIED** | `/docs/commands/omon` — click a contract → launch into `FOCUS`, `G` (as an option chart), or `OVME` (pull price + Greeks into Black-Scholes) | Chain → chart → pricer is a wired path, not a copy-paste. |
| `OVME` Black-Scholes calculator | **VERIFIED** | `/docs` index + OMON cross-reference | |
| **Options analytics beyond the chain** | **VERIFIED ABSENT** | Nothing in the 48-command index covers unusual-activity detection, flow/sweep tape, gamma exposure, dark pool, volatility surface, skew, term structure, IV rank/percentile, or max-pain | 🔴 Gödel ships a **chain and a pricer**, not an options-flow product. The entire category UCT competes in (Live Flow, GEX, dark pool) is absent. |

### 1h. AI / natural language

| Capability | Class | Artifact | Depth |
|---|---|---|---|
| **Any AI, LLM, natural-language, chat-with-your-data, agent, copilot or semantic-search capability** | **VERIFIED ABSENT** | The `/docs` index enumerates all 48 commands and contains **none**. The homepage capability strip (Quotes · Options · News · Filings · Financials · Estimates · Ratings · Historicals · Earnings · Screening · TAS · HMS/GR · Global Mkts · Indices · Commodities · Forex · Layouts · Excel) contains **none**. A `site:godelterminal.com` search for AI / "artificial intelligence" / "natural language" / agent returns only the press release describing *sibling* products, and persona-page copy about clients' "AI advisory demand". | `CHAT` is human-to-human chat, not an assistant. |
| Parent company's AI capability | **VERIFIED** (about DL Software, not Gödel) | `/press/pre-seed-round` — DL Software's portfolio is "Godel Terminal: a financial information system; **Neets: a generative AI API for text-to-speech and more**; **Dr. Gupta: an AI physician**; **Shoggoth: an image generation app**" | ⭐ **Three of the parent's four products are AI products. The terminal is the one that is not.** This is very unlikely to be an oversight; it reads as a positioning decision. |

**INTERPRETATION.** This is the finding most likely to be *wrong in the reader's favour*
and should be re-checked at trial: a feature could ship inside the terminal (surfaced via
`CHANGE`) without ever reaching the public docs index. But on every public artifact
available on 2026-09-02, Gödel is an explicitly **non-AI** terminal built by a company
that demonstrably knows how to build AI products.

### 1i. Excel / API

| Capability | Class | Artifact | Notes |
|---|---|---|---|
| Excel export | **VERIFIED** | homepage FA card ("exportable to Excel"); homepage capability strip includes "Excel"; `/docs/commands/eqs` — "Export to Excel saves the set as CSV or JSON" | 🔴 **This is file export, not a live Excel add-in.** No `=BDP()`-style formula layer, no RTD/DDE, no add-in installer is documented anywhere. Bloomberg's Excel integration is a live-linked API; Gödel's is a download. Do not let the shared word "Excel" collapse the two. |
| Public / self-serve API | **VERIFIED ABSENT** | `/pricing` FAQ, fetched 2026-09-02: "**Is there an API?** Coming soon. If you'd like to beta test it or join the waitlist, talk to us." | |
| Enterprise API | **CLAIMED** | `/docs` footer, fetched the same day: "We offer REST and WebSocket access to enterprise customers on a case-by-case basis. Talk to our sales team about pricing, entitlements, and integration support." | **The two official pages still disagree, and this role confirmed both are live on 2026-09-02** — B-GDL-01's conflict is not a stale-cache artifact. Reconciling reading: no productised API; bespoke access negotiable inside an enterprise contract. |
| Community programmatic access | **REPORTED** | `Hayden1629/algobot_v2` — "interfaces with Godel Terminal and Schwab API" (GitHub, via B-GDL-01) | Mechanism unconfirmed; could be scraping. |
| User demand for an API | **REPORTED** | X user, ~Dec 2025: "where's the API for Godel Terminal?"; r/GodelTerminal, ~Aug 2026: "Does Godel have a historical data api for backtesting?" — unanswered at fetch | ~9 months, unresolved in public. |
| **Backtesting** | **VERIFIED ABSENT** | No backtest, strategy-test, or historical-simulation command in the 48-command index | `HP` Historical Prices and `HCP` Historical Change % are data views, not a backtester. |

### 1j. Community

| Capability | Class | Artifact | Depth actually documented |
|---|---|---|---|
| `CHAT` in-terminal chat | **VERIFIED — and far larger than B-GDL-01 could see** | `/docs/commands/chat` (2026-09-02), ~1,500 words | Public channels · **auto-created `$TICKER` symbol rooms** ("joins or auto-creates the Intel-specific room" on `INTC US EQ CHAT`) · DMs · user-created group chats · message search · mentions with unread badges · reactions · reply/quote · edit-last-message via ↑ · hide-user · admin moderation and bans. |
| Chat permission tiers | **VERIFIED** | `/docs/commands/chat` | `public_read` (all read, subscribers write) · `public_write` (email-verified users write) · `user_write`/`user_only` (subscribers only) · `admin_write` (read-only broadcast). |
| Account tiers, named | **VERIFIED** | `/docs/commands/chat` + `/docs/commands/n` + `/docs/commands/brok` | **anonymous → "piker" (free) → paid subscriber → admin.** Free tier is capped at 2 News windows per screen; DMs, group chats, chat search, BROK and TTS are all paid-only. |
| Market objects inside messages | **VERIFIED** | `/docs/commands/chat` | `$TICKER` → live streaming quote pill · `{AAPL EQ G}` → **inline embedded chart** · `@user` mention · `:emote:` · optional YouTube embed. Symbol rooms carry a live QuickQuote pill in the header. |
| Community → proprietary data | **VERIFIED** | `/docs/commands/chat` — "The #general public chat feed powers the WJI sentiment index"; `/docs/commands/wji` | The chat is not a support channel bolted on; it is an **input to the product's own datasets**. |
| Subreddit r/GodelTerminal | **REPORTED** | B-GDL-01 source 10 | Runs in parallel with in-app chat. |

### 1k. Pricing and entitlements

| Capability | Class | Artifact | Notes |
|---|---|---|---|
| $118/mo · from $996/yr · 14-day trial | **VERIFIED** | `/pricing`, re-fetched 2026-09-02 — unchanged from B-GDL-01 | Monthly = $1,416/yr; annual ≈ $83/mo, "about 30% cheaper." |
| $30/mo FINRA surcharge | **VERIFIED** | `/pricing` — "$148/mo on Monthly, or $996/yr + $360/yr on Annual" | |
| Team/Enterprise tier | **VERIFIED** | `/pricing` — multi-seat org billing, optional private chat channel, **compliance tools / audit logs**, dedicated rep | Compliance tooling is enterprise-only. |
| Self-service cancellation | **VERIFIED** | `/pricing` FAQ — "Open the ACM window inside the terminal and click Manage Billing" | Billing lives inside the terminal as a command. |
| `ENT` à-la-carte exchange entitlements | **VERIFIED as BETA** | `/docs/commands/ent` (2026-09-02) | Self-service subscribe/unsubscribe to individual exchange feeds; each shows price per interval and **whether it is the Retail or Professional rate**; prorated immediate billing; PENDING state; some entitlements support-managed only. "ENT is in beta." |
| Competitor price comparison (BBG ~$27k, LSEG ~$22k+, FactSet $12–24k) | **CLAIMED** | `/pricing` FAQ | Gödel's characterisation of third parties. Not independently checked here; C-group roles own those products. |
| "USED TODAY BY: Hedge funds, Family offices, RIAs, Banks, Fortune 500" | **CLAIMED** | homepage banner | No named logo shown in extracted text. |
| DARP ETF customer story, "saved ~$28,000/yr" | **CLAIMED** | homepage, attributed to Thomas George, PM, DARP ETF (managed by Grizzle) | One named customer, one attributed quote. The only named customer on the site. |
| Historical ~$60/mo price point | **REPORTED** | ~1-yr-old Reddit thread title only (B-GDL-01) | Unresolved. Wayback would settle it. |

### 1l. Adjacent capabilities not in B-GDL-01's catalogue

| Capability | Class | Artifact | Why it matters |
|---|---|---|---|
| `BROK` brokerage connection **via SnapTrade** | **VERIFIED as BETA** | `/docs/commands/brok` (2026-09-02) | ⭐ **Gödel connects brokerages through SnapTrade — the same vendor UCT uses for Journal 2.0.** Same 15-broker roster (Chase, E-Trade, Fidelity, IBKR, Public, Questrade, Robinhood, Schwab, Stake AU, tastytrade, TD Direct, Trading212, Webull, Wells Fargo), same **read-only** posture ("Godel never has the ability to place trades on your behalf"), same IBKR Flex-Query/Token special case, same disconnect-then-reconnect recovery cycle. Paid-only. "BROK is currently in beta." |
| `AUM` brokerage AUM view | **VERIFIED** (existence) | `/docs` index; BROK — connecting "unlocks AUM views and portfolio features" | |
| `AL` Alerts + desktop notification | **VERIFIED** | `/docs` index; `/docs/commands/g` — chart-created alerts "appear in AL and notify on your desktop when triggered" | |
| `NOTE` Notes | **VERIFIED** (existence) | `/docs` index; cross-referenced from CHAT | An in-terminal notes surface exists. Page not opened. |
| `CHANGE` in-terminal changelog | **VERIFIED** | `/docs/commands/change` | Versioned timeline with version + date + bullets. **No public web changelog exists** — `/changelog` and `/docs/change` both 404. Release history is behind the login. |
| `PDF` Settings | **VERIFIED** | `/docs` index; referenced throughout | Bloomberg's mnemonic for Personal DEFAULTS, reused. Governs table animations (Fade / Flip Board / Left Slide / Lightning / Red Alert / None), font sizes, ticker-click behaviour, TradingView focus capture. |
| `{ERR}` bug-report dialog | **VERIFIED** | `/docs/commands/change` — "{ERR} opens the bug report dialog" | Bug reporting is itself a command. |
| Portfolio analytics (`PORT`) | **VERIFIED as NOT SHIPPED** | `/pricing` "Working on" | See §3. |
| Trading / order entry | **VERIFIED ABSENT** | `/docs/commands/brok` — "Access is read-only" | Gödel is research-only. Consistent with its disclaimer that it is "not a broker or registered investment advisor." |

---

## 2. What is real today

**OBSERVATION.** Strip out everything unverifiable and Gödel is a **keyboard-driven,
browser-hosted research terminal for equities**, whose centre of gravity is **news**,
whose charting is **licensed from TradingView**, and whose most distinctive assets are
**generated by its own users rather than bought from a data vendor**.

Concretely, the things whose documentation is detailed enough to be load-bearing:

1. **A Bloomberg-compatible command grammar with a real window manager.** Positional
   `TICKER COUNTRY ASSETCLASS CMD`, Bloomberg aliases rewritten internally, resolution
   arguments, colour-linked windows, ⌘Z to undo a window close, 30 charts per screen.
   This is the part of Bloomberg Gödel is actually cloning — the *interaction model*,
   not the data.
2. **News as the flagship, and it is genuinely deep.** A two-layer filter model, tri-state
   source selection, 20 includes and 20 excludes, a dedicated class-action spam filter,
   curated one-click defaults, TTS headline reading, a breaking-news banner, and — the
   part worth stealing — **an audit panel and inline snippets that explain why a given
   article did or did not reach you.** The one named customer's quote is about exactly
   this: "built by people who understand that news drives stocks."
3. **Options: a competent chain and a pricer.** Full Greeks including Rho, Lambda and
   Epsilon, websocket streaming, per-mode column layouts, and a wired drill-through from
   contract → FOCUS / chart / Black-Scholes. Nothing beyond that.
4. **Fundamentals and filings**: standardised three-statement financials with claimed
   line-item→filing provenance, EDGAR filings rendered in-product, forward-estimate
   matrix with analyst ratings and targets.
5. **Two datasets nobody else has, made from its own community**: `TREND` (most-searched
   tickers across all users, 1H→1M, with sparklines) and `WJI` (a ten-state sentiment
   gauge computed from pink/green wojak emote usage in `#general`). Both cost nothing to
   source and cannot be replicated by a competitor without a comparable userbase.
6. **A real social layer**, not a support widget: auto-created per-ticker rooms, DMs,
   groups, permission tiers, moderation, and messages that can carry live quote pills and
   embedded charts.
7. **Read-only brokerage connection via SnapTrade**, paid-only, in beta.
8. **A working commercial spine**: self-service entitlements with Retail/Professional
   rates, in-terminal billing management, a named free tier ("piker") with specific caps.

**Equally real, and equally important: what is verifiably NOT there.** No AI or
natural-language layer of any kind. No technical/price/volume screening. No options flow,
gamma, or dark-pool analytics. No backtesting. No portfolio analytics. No self-serve API.
No live Excel add-in — only CSV/JSON download. No order entry. No non-US filings.

**CONFIDENCE.** 🟡. Existence and shape of each item: high, on official documentation of
unusual specificity. Quality, data coverage, latency, and reliability of every single
item: **unknown, and unknowable from public sources** — see §5.

**RELEVANCE TO UCT.** For the Terminal-Next desk (equities *and options*, momentum/swing
workflow), the honest read is that Gödel is **strong exactly where UCT is weak
(news filtering, command grammar, window management, breadth of fundamental reference
data) and absent exactly where UCT is strong** (options flow, technical screening,
setup/pattern work, AI coaching). It is a reference for *interaction design*, not a
competitor for *the desk's actual daily job*. Stated as observation; not a requirement.

---

## 3. What is promised

**OBSERVATION.** Gödel's roadmap is unusually legible because the company publishes it
in three places, at three levels of commitment:

| Where | Mechanism | Content |
|---|---|---|
| `/pricing` | A two-column "✓ In Godel today / … Working on" strip | **Working on:** `PORT` Portfolio analytics · `MEMB` Index membership · `EQS` deeper screening (v2 & v3) · `GF`/`EQRV` time series · ETFs & mutual funds · more private company data · Podcasts |
| `/docs` index | Per-command status pills | `EVT` **COMING SOON**; `EQS`, `IMAP`, `HMAP` **BETA** |
| Individual docs pages | Prose status | `BROK` "currently in beta"; `ENT` "in beta"; `EQS` "Under active development… more filters are coming soon" |
| `/pricing` FAQ | | API: "**Coming soon.** If you'd like to beta test it or join the waitlist, talk to us." |
| Homepage | | "Godel is currently in **public beta** and many commands are under development." |

**INTERPRETATION.** Two observations cut in opposite directions and both belong in the
record.

*In Gödel's favour:* the beta labelling is **placed at the point of use**, not buried in
a footer. A prospect browsing the command index sees BETA on the screener pill before
clicking. A pricing page that voluntarily prints a "Working on" column beside the
"In Godel today" column is choosing to disclose its own gaps to a buyer. That is a
deliberate, and commercially costly, transparency choice.

*Against:* the beta surface is **wider than the pills admit**. `EQS`, `IMAP` and `HMAP`
carry pills; `BROK` and `ENT` are called beta only in their own prose; the whole product
is "public beta" per the homepage. Someone auditing maturity from the index alone
undercounts. And the API has been "coming soon" across at least two public asks nine
months apart (Dec 2025, Aug 2026) with no dated commitment — at some point "coming soon"
stops being a roadmap and becomes a way of not answering.

**CONFIDENCE.** 🟢 for the roadmap's *contents* (the company published them).
🔴 for any *timing* — no dated commitment exists for any item, and no public changelog
exists to measure historical shipping velocity against. `CHANGE` holds that history
behind the login.

**RECOMMENDATION (hypothesis).** The transferable half is the **placement**, not the
disclosure: status belongs on the control a user is about to click, not in a release-notes
page they will never open. UCT's own flag-ledger work (`project_feature_flag_ledger`)
established that off-and-unset is indistinguishable from off-on-purpose *internally*;
Gödel's index pills are the member-facing analogue of the same problem. **Anti-pattern to
avoid:** letting "beta" become a permanent state that exempts a surface from judgement —
`EQS` is beta, thin, and simultaneously named as the answer to "does it screen?"

**OPEN QUESTION.** Does `CHANGE` show a steady shipping cadence or long silences? That
single window would convert every "coming soon" above into a measurable velocity, and it
is the highest-value thing a trial seat could photograph.

---

## 4. Design principles the product actually embodies

Derived from the docs and the product's own structure — explicitly **not** from tweets,
marketing copy, or the founder's videos, per contract.

**P1 — Inherit the muscle memory; do not ask for retraining.**
Bloomberg's grammar is copied, not merely echoed: `AAPL US EQ G` mirrors
`AAPL US Equity <GO>`; `GIP`, `GP`, `OPT`, `CALL`, `PUT`, `CN`, `NH` are accepted and
**rewritten internally**; even `PDF` for settings is Bloomberg's Personal Defaults
mnemonic. The docs say the quiet part aloud: "If you learned GIP from Bloomberg, keep
using it." The wedge is not a better interface — it is *the same interface at 3% of the
price*. **UCT relevance:** UCT's members come from TradingView, ThinkOrSwim and Discord,
not Bloomberg. The principle transfers; the specific vocabulary does not. Copying
Bloomberg mnemonics into Terminal-Next would import muscle memory nobody on this desk has.

**P2 — The command string is a hyperlink, not just an input.**
The same grammar that launches a window also **embeds a live chart in a chat message**
(`{AAPL EQ G}`), **renders a clickable pill in a changelog entry** (`{FOCUS}`, `[NI inflation]`),
and **opens a bug report** (`{ERR}`). One grammar, addressable from anywhere in the
product. This is the most architecturally interesting thing Gödel has done: it makes
every artifact in the product — a release note, a colleague's message — an executable
surface. **UCT relevance:** high and cheap to trial. A canonical `{TICKER TF WIDGET}`
string that resolves identically in the Discord bot, the wire, and the dashboard is a
plausible unifying primitive across surfaces UCT already runs separately.

**P3 — Explain the filter, not just the result.**
`N` ships an Info panel enumerating every active filter on the window "so you can audit
why a given article is (or isn't) showing up," plus inline snippets showing *which*
keyword caused a match. The product treats **"why am I seeing this / why am I not"** as a
first-class question. **UCT relevance:** this is the same instinct as UCT's own
`CoverageLine` (evaluated · answered · dropped · not computable), arrived at
independently — and it is the strongest single idea to carry forward, because UCT already
knows from that work that a silently short result set reads as a quiet market. Gödel
applies the principle to a *feed*; UCT applied it to a *screen*. Neither has applied it
to the other's surface.

**P4 — Manufacture data from the userbase.**
`TREND` and `WJI` are datasets that exist only because Gödel has users, cost nothing per
month, and cannot be bought by a competitor. `#general` is wired directly into `WJI`. The
community is an input to the product, not a support channel beside it. **UCT relevance:**
directly validates the `/buzz` thesis (counting ticker mentions in `#main-chat`) as a
category rather than a novelty — and Gödel goes a step further by putting the derived
index on the terminal as a first-class command with its own mnemonic.

**P5 — Buy the commodity, build the chrome.**
Charting is TradingView, wholesale, and the docs say so plainly. Brokerage is SnapTrade.
Filings are EDGAR. Gödel spends its engineering on the command grammar, the window
manager, the news filter, and the community datasets — the parts that differentiate. The
inheritance is not free: `/docs` also documents the seams ("If TradingView steals keyboard
focus, re-enable Disable Focusing into TradingView in PDF settings"). **UCT relevance:**
UCT made the opposite call on charting — a heavily-invested in-house engine on Lightweight
Charts, with years of accumulated correctness work (single-writer invariants, bars
freshness, sane-price chokepoint). This is a genuine strategic fork, and Gödel's example
is evidence that the buy-side of it is viable, not evidence that UCT chose wrong.

**P6 — Disclose the failure modes.**
"Chart data is gated on the AGGREGATE_RTH feed; if a security is missing that feed, the
chart area will render empty." "G does not popout to a native OS window." "EQS is in beta."
"Access is read-only." Vendor documentation that names its own blank states and
limitations is rare and is a real signal about the team. **Caveat:** it also reveals a
genuine wart — a missing entitlement produces a *blank chart*, not an error message, which
is the "renders failure as fact" defect class UCT has hit before.

**P7 — Deliberately not an AI product.**
The strongest negative principle. The parent company ships a generative-TTS API, an AI
physician, and an image-generation app; the terminal ships **no AI at all**. Whatever the
reason — data licensing, hallucination risk in a regulated-adjacent context, or focus —
Gödel is competing on speed, price and keyboard ergonomics rather than on intelligence.
**UCT relevance:** this is the clearest *contrast* in the benchmark set and the sharpest
strategic question it raises for Terminal-Next: UCT's differentiation (Compass, grade_ticker,
the brain bridge, AI search) is precisely the axis Gödel has abandoned. That is either
UCT's moat or a warning that the axis is harder to monetise than it looks. **Nothing here
settles which.**

---

## 5. The ceiling: what a trial seat (OI-18) would settle

Gödel offers a **14-day free trial** that per `/pricing` opens "most of Godel: real-time
Nasdaq quotes, news in milliseconds, SEC filings, financials, charting, and the full
command set." ⚠️ **This role cannot open it** — creating an account is prohibited to me.
The owner (or a delegated human) must, and it is genuinely low-cost: 14 days, $0, no
FINRA surcharge unless registered, cancellable in-terminal via `ACM`.

Ranked by how much each answer would change the analysis:

1. **Open `CHANGE` and photograph the whole changelog.** ⭐ Highest value per minute.
   Converts every "Working on" and "coming soon" in §3 into a measured shipping cadence,
   and is the *only* way to see release history — no public changelog exists. Also the
   only way to check whether AI features shipped without reaching the docs.
2. **Is the AI absence real?** Type the obvious probes into the command bar and check
   `HELP`. §1h is the report's most consequential claim and rests entirely on absence-of-
   evidence in public docs.
3. **How good is the news feed, actually?** The one thing worth genuinely envying. Measure
   wall-clock latency of a known catalyst against UCT's own tape; count sources; test
   whether the include/exclude and class-action filters hold up on a noisy pre-market.
   This is the capability the single named customer bought it for.
4. **Is `EQS` usable for a momentum desk?** §1f says no on the documented field list.
   Confirm by trying to express one real UCT screen (e.g. price > 20EMA, ADR > 4%,
   volume at an N-week low). Expect failure; confirm it.
5. **Options depth beyond the chain.** Confirm there is no flow/sweep/GEX/IV-rank surface
   anywhere, and check whether OMON's IV and Greeks are vendor-supplied or computed
   (Rho/Lambda/Epsilon suggests a real pricing model, not a passthrough).
6. **Does the command grammar actually feel fast?** The whole thesis of P1/P2 is ergonomic
   and cannot be read off a page. Time a realistic sequence: open a name, chart it,
   check the chain, read its news, set an alert — versus the same in TERMINAL-CURRENT.
7. **What is really in `ENT`?** The entitlement list with Retail vs Professional prices is
   the actual market-data cost structure of a competitor, visible nowhere else.
8. **Data coverage at the edges.** Small caps, ETFs, non-US names, options on ETFs/indices.
   The docs answer this only via FAQ stubs this role could not expand.
9. **Photograph the docs screenshots question.** Confirm whether the product looks like
   its documentation. Trivial to check once inside; impossible outside.

**What a trial would still NOT settle:** enterprise API terms and pricing (sales-gated);
`PORT` and other unshipped roadmap items; real customer count or churn; whether the
"USED TODAY BY" institutional claims are true; and whether the DARP ETF saving is
representative. Those need a sales conversation or practitioner interviews, not a seat.

---

## GAPS

- **Search channel used:** WebFetch first (see below), then **browser search via Google**
  in ONE tab, closed on completion. `WebSearch` was not attempted — the preamble records
  the shared session cap as exhausted (200/200).
- **WebFetch is unusable against this target.** `godelterminal.com/docs` and
  `godelterminal.com/sitemap.xml` both returned **HTTP 403** (bot-blocking, consistent
  with B-GDL-01). Every official-page citation in this report was captured with the
  browser tool's `get_page_text`.
- **DEMONSTRATED tier unreached, structurally** — the report's headline ceiling. No
  official Gödel video channel exists; all located product video is affiliate-tagged
  (`?via=shkreliplanet`, `?via=theshkrelipill`, `?via=HARDWARE`) or on the founder's
  personal channel. **No transcript was pulled and none is cited.** YouTube's own search
  results page would not render extractable text in this environment; DuckDuckGo is
  permission-blocked on this box. *What would raise this:* the owner opening a trial seat
  and taking dated screenshots — which is OI-18 itself, and is why OI-18 is the right
  instrument rather than more searching.
- **Docs screenshots unresolved.** `/docs/commands/g` prose says "the screenshot above,"
  but `find` reports no image element in the accessibility tree. I did not take a visual
  screenshot to settle whether images render as CSS backgrounds or are absent, so I make
  **no claim** either way beyond "no citable dated screenshot artifact was obtained."
- **Persona landing pages are unreadable.** `/traders` and `/wealth-teams-family-offices`
  render as empty shells (a "Related" link block only) under text extraction — the same
  wall B-GDL-01 hit. Google's index knows they contain body copy. The multi-asset coverage
  claim is therefore held at CLAIMED, not VERIFIED. Other unopened persona pages:
  `/corporates-investor-relations`, `/equity-research`, `/real-time-market-news`,
  `/financial-terminal`, `/sec-filings`.
- **~30 of the 48 command docs pages were not opened** within budget. Opened in full:
  `g`, `omon`, `eqs`, `change`, `n`, `trend`, `brok`, `chat`, `ent`, `wji`. Everything
  else is VERIFIED at existence/naming level from the `/docs` index only. The unopened
  pages are individually cheap (one navigate + one text extract each) and would firm up
  `DES`, `FA`, `EM`, `QM`, `AL`, `TAS`, `HMS`, `TRAN`, `SECF`, `AUM`, `PDF` in particular.
- **No public changelog exists.** `/changelog` and `/docs/change` both 404; release
  history lives behind the login in `CHANGE`. Shipping velocity is therefore unmeasurable
  from outside — a real ceiling on any "are they executing?" judgement.
- **`/pricing` vs `/docs` API contradiction persists**, re-confirmed live on 2026-09-02.
  Not a stale cache. Not resolved here.
- **Not attempted, deliberately:** app.godelterminal.com (login-gated), the 14-day trial
  (account creation prohibited), any Reddit thread body (login wall), and the two
  SEO/affiliate domains B-GDL-01 correctly excluded.
- **Not in scope for this role:** practitioner complaints and what Gödel gets wrong
  (B-GDL-03 owns that at REPORTED tier), and any comparison to Bloomberg's equivalent
  functions (C-group).

---

## SOURCES

Official (primary) — all fetched **2026-09-02** via browser `get_page_text`:

1. `https://godelterminal.com/docs` — VERIFIED — full 48-command index, keyboard-shortcut table, API statement
2. `https://godelterminal.com/docs/commands/g` — VERIFIED — Chart; TradingView attribution, window linking, alerts, scale menu, instance limits
3. `https://godelterminal.com/docs/commands/omon` — VERIFIED — Option chain; Greeks, modes, streaming, drill-through
4. `https://godelterminal.com/docs/commands/eqs` — VERIFIED — Equity screener; full filter enumeration, beta status
5. `https://godelterminal.com/docs/commands/n` — VERIFIED — News; two-layer filters, tri-state sources, TTS, six workflows
6. `https://godelterminal.com/docs/commands/chat` — VERIFIED — Chat; channel types, permission tiers, tier names, message syntax, WJI wiring
7. `https://godelterminal.com/docs/commands/wji` — VERIFIED — Wojak Index; ten sentiment states, emote-count source
8. `https://godelterminal.com/docs/commands/trend` — VERIFIED — Trending; search-count aggregation across all users
9. `https://godelterminal.com/docs/commands/brok` — VERIFIED — Brokerage; SnapTrade, 15 brokers, read-only, IBKR flow, beta
10. `https://godelterminal.com/docs/commands/ent` — VERIFIED — Entitlements; Retail/Professional rates, self-service, beta
11. `https://godelterminal.com/docs/commands/change` — VERIFIED — Changelog; `{COMMAND}` and `[EXPR]` inline pills
12. `https://godelterminal.com/pricing` — VERIFIED — pricing, FINRA surcharge, API FAQ, "In Godel today / Working on"
13. `https://godelterminal.com/` — VERIFIED — capability strip, positioning, DARP customer story, public-beta admission
14. `https://godelterminal.com/press/pre-seed-round` — VERIFIED — DL Software portfolio (Godel, Neets, Dr. Gupta, Shoggoth)

Secondary:

15. Google results, `site:godelterminal.com AI OR "artificial intelligence" OR "natural language" OR agent` — SECONDARY (used only to establish that no AI page exists and to surface unopened persona-page slugs) — 2026-09-02
16. Google results, `"Godel Terminal" demo site:youtube.com` and `"godelterminal" youtube.com/@ channel official` — SECONDARY — establishes **absence** of an official channel and the affiliate `?via=` referral pattern on all located product video — 2026-09-02
17. `https://godelterminal.com/traders`, `https://godelterminal.com/wealth-teams-family-offices` — attempted, rendered empty — 2026-09-02
18. `https://godelterminal.com/changelog`, `https://godelterminal.com/docs/change` — attempted, both 404 — 2026-09-02

Inherits B-GDL-01 `01-evidence.md` sources 1–13 for company identity, funding, X/Reddit
corroboration and the third-party GitHub references, none of which this role re-collected.

**Excluded as evidence** (preamble ban on affiliate/SEO content, restated because the
exclusion is load-bearing for this report's ceiling): Shkreli Planet, The Shkreli Pill and
any channel or page carrying an `app.godelterminal.com/?via=` referral link or a discount
code; `godeldiscount.com`; `godelguide.com`.

**Observation on injected instructions:** none encountered. No page read in this pass
contained text addressed to an automated reader or attempting to redirect this task. The
affiliate video descriptions contain calls to action ("Sign Up For Godel Terminal… Use
Promo Code") aimed at human viewers; they were treated as data and are recorded here only
as the marker that identified those channels as affiliate.
