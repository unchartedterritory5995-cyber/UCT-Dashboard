# Options Flow — Competitive Roadmap (UCT vs Unusual Whales / BlackBox / field)

Date: 2026-07-06 · Inputs: live competitor research (UW/BBS/FlowAlgo/Cheddar/Tradytics) + full repo inventory. Companion research below the roadmap.


## 1. Gap Matrix — honest assessment (July 2026)

Legend: MISSING = table-stakes feature UCT lacks or fakes · PARITY = present and credible (caveats noted) · ADVANTAGE = something no competitor (UW, BlackBox, FlowAlgo, Cheddar, InsiderFinance, Tradytics) matches.

### MISSING (table stakes — these read as "toy" in 2026 if unaddressed)

| Feature | Competitor baseline | UCT reality |
|---|---|---|
| **Per-user custom alerts** | All 5 competitors have some form; UW: 25–100 rules across flow/price/OI/news with Discord+WS delivery; FlowAlgo: push/email/SMS/webhooks | **None.** Discord pushes exist but are UCT-curated broadcasts to UCT's own webhook (Filter Engine rules hardcoded in `liveflow_worker.py`). Zero user configurability, no in-app, no email, no push. Single biggest gap. |
| **Real-time dark pool feed** | Baseline everywhere (3/5 include it, 2/5 gate to top tier) | **Fake-live.** `darkpool_db` is admin-CSV-upload-driven with boot seeding — no live rail. Levels-on-chart overlay is good, but the underlying data is stale-by-design. |
| **Live feed at live cadence, in the nav** | Sub-second to few-second tapes are the product | **Degraded.** `/live-flow` and `/live-massive` poll at 20s (flow.db query took 43s for 11K rows, 2026-07-01), are URL-only (no nav), and self-label as "test/validation." The hardened Massive rail deserves better than a hidden test page. |
| **Market-wide sentiment chart** (Market Tide equivalent) | UW's category-defining visual; imitated widely | **Partial.** Market Read has AI narrative + per-ticker net charts, but no single intraday market-wide net-premium line users screenshot daily. |
| **Server-side saved filters / mobile push** | UW: 10–unlimited saved filter sets, AI filter builder; BBS/UW: native app push | **Partial/none.** Filter chips persist to localStorage only; mobile is a 165-line CSS shim; no push channel of any kind. |
| **Endpoint auth** (internal, but pre-competitive-push it's a liability) | n/a | `/api/flow/upload`, `/api/darkpool/clear`, `/api/dealer-positioning/backfill`, `/api/notable-flow/post` are unauthenticated; `bullflow_mcp_probe.py` (self-labeled DELETE-ME) still registered. |

### PARITY (present and credible)

| Feature | UCT status | Honest maturity |
|---|---|---|
| Real-time full-tape options flow | Massive OPRA WS → FlowDB → pages; NBBO Lee-Ready side classification (~95% coverage), $10k/50-contract floors, OI + spot enrichment | **Strong.** Ingest just hardened (deploy-survival LOCKED, independent monitor, T+1 gap-fill landing). Caveat: front-of-house doesn't reflect back-of-house quality yet (see MISSING row 3). |
| Unusual-activity detection & grading | A+–D cluster grades, pattern detection, UOA filters, Bullflow tier taxonomy | Parity; grading logic is client-side in a 9,206-line page — fine for now. |
| Sweep/block classification | WS aggregation into SWEEP/BLOCK events | Parity. |
| Historical flow lookup | Search tab, contract history, backfill, ?days=1–365/all | Parity. |
| Dark pool **levels on chart** | `clusterDarkPoolPrintsForOverlay` + StockChart overlay | Parity-plus (Cheddar-grade), undermined by stale source data. |
| Filtering breadth | C/P, DTE, cap bands, activity, sectors/themes | Parity-minus vs UW's delta/IV/skew/vol>OI depth — acceptable; don't chase filter-count. |
| Free tier funnel | `/options-flow` free with near-real-time data | Parity-plus vs InsiderFinance's 30-min-delay funnel — arguably **too** generous (see T2-5 packaging). |
| GEX per ticker | `gex_service` from Schwab chains, DTE windows, walls, semantic labels, chart price-lines | Parity with UW/Tradytics on naive GEX; crosshair lag open issue. |

### ADVANTAGE (nobody in the set has this)

| Feature | Why it's an advantage | Maturity |
|---|---|---|
| **Platform integration** — flow one login away from charts, journal+live positions (SnapTrade), Compass AI coach, scanner, breadth, morning wire | Research names "flow lives in a silo" as a category-wide opening; no competitor connects a print to *your* position, *your* chart, *your* journal | Exists structurally, **almost entirely unexploited** — flow barely cross-links today |
| **Top Flow Tracker** — persistent pick performance with daily price/OI/spot snapshots | Attacks the #1 trust gap: *none of the 5 competitors track whether their flagged flow worked* | Shipped and running — but buried in a tab, invisible as a trust asset |
| **OI next-day confirmation** (ΔOI/volume ≥ 0.50 verdict on prior flow) | UW has an OI-change *feed*; nobody renders next-day OI as a confirmation verdict on specific prior prints | Shipped (OI Check tab, 5:30 AM cron) |
| **Trade-aware GEX** — dealer positioning attributed from actual tape (`est_customer_net`), not the everyone-is-long assumption | Beyond naive GEX peers; comparable in spirit to UW Periscope, but Periscope is SPX-only — UCT's is per-ticker | Validation in progress (`/api/gex/compare` still in place) — do not market until validated |
| **Claude-powered interpretation** (market-narrative endpoint live; Compass + catalyst engine adjacent) | The "overwhelming tape / not for beginners" complaint is universal; UW's Mr. Whale is a bolt-on chatbot — UCT can do per-print, per-position AI | Beachhead live; per-print explainer not built |
| **Curated conviction gating** (Filter Engine grades, follow-through counting, per-ticker caps) | The anti-firehose stance is the right side of the category's loudest complaint | Shipped, hardcoded, UCT-Discord-only |
| **Ingest ops receipts** — deploy-survival invariants, independent monitor, status telemetry | "Latency honesty" is a stated market opening (FlowAlgo's 15-min-delay complaints) | Just built — receipts exist, not surfaced to users |

## 2. Prioritized Roadmap

**Owner-fit ground rules:** Ravi owns `OptionsFlow.jsx`, `schwab_router.py`, `massive_ws_worker.py` (rebase-safe co-edit protocol; additive CSS / `of-*` hooks only from Patrick's side). Patrick owns everything else — backend routers, `flow_db`, LiveFlow pages, charts, journal, Compass, wire, dashboard. Items below route accordingly; anything touching Ravi's three files is flagged. All live-rail deploys respect the ≥4:20 PM ET window (WS gaps permanent until T+1).

**Strategy in one line:** don't out-tape Unusual Whales — out-*answer* them. Close the three embarrassing gaps (cadence, alerts, dark-pool honesty), then spend everything else on the two things structurally unavailable to competitors: outcome accountability and flow-in-your-workflow, both amplified by Claude.

---

## Tier 1 — 2-week wins (ship all five inside ~2 weeks)

### T1-1. Fix flow.db hot-window perf → restore 5s polling → promote `/live-flow` into the nav
- **What:** Kill the 43s/11K-row query (index the time/dedup columns, add a hot-window table or in-RAM ring for last-N-hours reads), restore both live pages' 5s cadence, remove the "test/validation" AuthGuard comment, give `/live-flow` a nav entry.
- **Why it wins users:** A "live" feed polling at 20s loses a side-by-side against every competitor's tape. This is the single most embarrassing gap and it's a perf bug, not a build. The ingest is already best-in-class hardened — the front of house just has to stop hiding it.
- **Effort:** 3–5 days. **Owner:** Patrick (`flow_db.py`, `live_massive_router.py`, `liveflow_router.py`, AuthGuard/NavBar — none partner-owned; give Ravi a heads-up on nav placement).
- **Reuses:** existing `/diagnostic` endpoints that already isolated the slow query; both pages carry "restore to 5000ms once sub-second" comments — the finish line is pre-marked.

### T1-2. Flow Scoreboard — make the Top Flow Tracker public and loud
- **What:** A public scoreboard page + dashboard tile: rolling hit rate, average/max gain since alert, per-grade calibration (do A+ picks beat B?), "picked Tuesday, +42% now" cards, OI-confirmed badge on winners, shareable Discord image push.
- **Why it wins users:** Attacks the #1 category-wide trust gap — *no competitor tracks whether their flagged flow worked* (research opening #2). It converts skeptics UW can't: "here's our record, verified against next-day OI" is an unanswerable marketing asset, and the data already exists.
- **Effort:** 4–6 days. **Owner:** Patrick (new endpoint over `top_flow_tracker.py` history + new page/tile; the Tracker tab inside OptionsFlow.jsx stays Ravi's).
- **Reuses:** `top_flow_tracker.py` daily snapshots (price/OI/spot per pick), `oi_snapshots` confirmation map, `flow_summary.py` endpoint pattern, `/api/discord/push-image`.

### T1-3. AI Print Explainer — "Why this print matters" (Claude)
- **What:** Click any flow row → 3–5 sentence Claude verdict: likely opening vs closing (volume vs OI + prior snapshots), likely hedge vs directional (GEX/dealer-positioning context), earnings proximity, moneyness/DTE framing, plain-English so-what. Cache per contract-cluster; ship first in `LiveFlow.jsx` (Patrick-owned), then Ravi ports the modal into OptionsFlow.jsx.
- **Why it wins users:** Every review of every competitor says the same thing: overwhelming, steep learning curve, not for beginners (research opening #1). Mr. Whale is a generic chatbot bolted on; this is interpretation embedded at the point of confusion — and it's the Anthropic lever nobody else can credibly match.
- **Effort:** 5–8 days. **Owner:** Patrick (backend + LiveFlow UI); Ravi for the OptionsFlow.jsx touchpoint later.
- **Reuses:** `market-narrative` Claude plumbing in `schwab_router.py` (pattern, not the file), `contract-history`/`backfill-contract`, `/api/oi/confirmation-map`, `gex_service.classify_gex_state()`, `dealer_positioning` confidence.

### T1-4. Lock down mutating endpoints + delete the probe router
- **What:** Auth-gate `/api/flow/upload`, `/api/darkpool/upload|clear|prune`, `/api/dealer-positioning/*`, `/api/notable-flow/post`, `/api/top-flow/wipe|migrate`; delete `bullflow_mcp_probe.py`.
- **Why:** Becoming a declared UW competitor means hostile attention; an unauthenticated `/api/darkpool/clear` is a one-curl data wipe. Cheap insurance before any marketing push.
- **Effort:** 1–2 days. **Owner:** Patrick. **Reuses:** the auth dependency pattern already used on gated routers elsewhere in `api/main.py`.

### T1-5. Flow Status + latency-honesty badge
- **What:** UW-style green/yellow/red feed-health chip on the live pages + "median print latency: Xs" and "gap-free since HH:MM" driven by `massive-ws-status` telemetry and the new independent monitor; a short public "how our feed works" note.
- **Why:** Latency honesty is a stated market opening (FlowAlgo advertises real-time, draws 15-minute-delay complaints; nobody publishes an SLA). UCT just built the receipts this week — surface them.
- **Effort:** 2–3 days. **Owner:** Patrick (telemetry endpoint exists at `main.py:2950`; chips go in Patrick-owned live pages).

---

## Tier 2 — 1–2 month builds (parity on table stakes + the moat)

### T2-1. Per-user custom alert builder v1
- **What:** Per-user rules — ticker/watchlist, premium floor, C/P, side, DTE range, grade, OI-confirmed-only — evaluated inside the 2s WS flush path; delivery to in-app inbox + user's own Discord webhook/DM + email (Resend). Caps like UW (e.g., 10 rules free-adjacent tier, 100 paid).
- **Why it wins users:** The only true table-stakes MISS. FlowAlgo charges $149/mo largely for programmable alerting; InsiderFinance's weakest area is exactly this; "good rule-based alerting at a mid price" is research opening #6, an explicitly open slot.
- **Effort:** 3–4 weeks. **Owner:** Patrick (engine + rules CRUD + new alerts page); "create alert from this row" entry points in OptionsFlow.jsx via Ravi.
- **Reuses:** `liveflow_worker.py` Filter Engine gate logic generalized from hardcoded constants to per-user rule records (premium tiers, dedup windows, per-ticker caps, follow-through counting all already written), Discord embed builders, Resend email infra, `/api/watchlist/*`.

### T2-2. UCT Market Tide
- **What:** Intraday cumulative net call-vs-put premium line, market-wide + per-sector + 0DTE toggle, computed server-side from FlowDB live rows; historical lookback. (Replay mode deferred to T3-5.)
- **Why:** UW's category-defining visual and the thing subscribers screenshot daily; it's also the natural home-screen anchor for the flow area. UCT's tape is already flowing in real time — this is aggregation, not ingestion.
- **Effort:** 2–3 weeks. **Owner:** Patrick (aggregation endpoint + caching per `flow_router` LRU pattern); chart placement in Market Read tab coordinated with Ravi, or on the new scoreboard/home surface Patrick owns.
- **Reuses:** `flow_summary.py` server-side direction logic, sector metadata already in FlowDB rows, `/day-stats` day-scoping, dataviz/chart stack from breadth pages.

### T2-3. Live dark pool rail
- **What:** Replace admin-CSV dark pool with a real-time off-exchange equity prints source (evaluate Massive's stocks feed first — one vendor bill, reuse auth — else FINRA ATS-capable vendor), streaming into the existing `darkpool_db`; levels overlay then updates live.
- **Why:** Dark pool prints are baseline in all five competitors; UCT's upload-driven version collapses under the first "is this live?" question. Fixing it also feeds T3-2 (direction engine), the real prize.
- **Effort:** 3–4 weeks including vendor eval. **Owner:** Patrick for ingest worker (clone `massive_ws_worker` hardening playbook: reconnect ladder, scheduler lock, monitor, DRY_RUN); `DarkPool.jsx` surface stays Ravi's.
- **Reuses:** `darkpool_db`/`darkpool_router` (already architected to mirror flow_router: stream-gzip, LRU, CF-cacheable), `darkpool_aggregator` prebuilds, deploy-survival invariants just LOCKED.

### T2-4. Flow-everywhere integration pass (the moat, phase 1)
- **What:** (a) Flow markers on the main Charts page — significant prints rendered at price/time on the user's actual chart; (b) Journal panel: "institutional flow in your open positions" using SnapTrade holdings; (c) morning wire gets a flow-recap paragraph from yesterday's tape + scoreboard results; (d) dashboard tile upgraded with tide + top conviction.
- **Why it wins users:** This is the structural advantage no standalone tape can copy and research opening #5 verbatim ("no one connects flow print to your open position / your chart / your journal"). A UW subscriber who also journals and holds positions gets something UW cannot build without becoming a broker-connected platform.
- **Effort:** 3–4 weeks rolling, shippable in slices. **Owner:** Patrick end-to-end — charts, journal, wire, dashboard are all his surfaces; zero partner-file conflict.
- **Reuses:** the StockChart overlay pattern already proven twice (gexPriceLines + dark-pool levels), `broker_sync` positions (⛔ never filter imported data), journal API, morning-wire engine, `flow_summary` top-conviction endpoint.

### T2-5. Packaging: monetize the rail (free-delayed / paid-realtime split)
- **What:** Free tier keeps `/options-flow` with a 15-min-delayed feed + delayed alerts (InsiderFinance funnel model); paid tier = real-time cadence, custom alerts, scoreboard detail, dark pool. Server-side delay parameter, not a separate dataset.
- **Why:** The entire category monetizes exactly this split at $55–150/mo; UCT currently gives near-real-time flow away on the free tier. Also the honest-billing counterpunch: transparent pricing, true free tier, easy cancel — research opening #4 says FlowAlgo/Tradytics bleed trust here.
- **Effort:** ~1 week eng + a pricing decision with Ravi. **Owner:** Patrick (AuthGuard/FREE_PAGES + delay param in flow/live routers).

### T2-6. Flat-file V2 + unify the live pages
- **What:** Add side/spot enrichment to the T+1 flat-file path (quotes-file integration) so gap-healed rows match WS fidelity; merge `LiveFlow.jsx` + `LiveFlowMassive.jsx` into one canonical live page; retire the two ~10K-line unrouted `_admin` workbench copies (move CSV-upload UI to a small real admin page).
- **Why:** Data completeness underwrites every accountability claim above (a scoreboard built on gappy data gets audited by Twitter); the test-page debt blocks promotion.
- **Effort:** 1–2 weeks. **Owner:** Ravi (massive workers) + Patrick (page merge). **Reuses:** `massive_flatfiles_worker` V1, `massive_processor`, tonight's T+1 auto gap-fill.

---

## Tier 3 — moonshots / durable differentiators (2+ months, sequenced after T2)

### T3-1. Flow-signal backtester
- **What:** "Run this filter/alert-rule over the last 90–365 days" → hit rate, average return by horizon, equity curve, per-grade calibration. Wire it to the custom alert builder (backtest before you save a rule).
- **Why:** UW's admitted gap (portfolio backtester only); Tradytics claims it with opaque methodology. Combined with the Scoreboard, UCT becomes the only *self-auditing* flow product — the accountability story end-to-end.
- **Effort:** 4–6 weeks. **Owner:** Patrick. **Reuses:** FlowDB history, replay-through-gates functions already written in `liveflow_worker.py` (lines ~924/1029), `?backtest=` mode in LiveFlow.jsx, bars cache for outcome pricing, tracker outcome data.

### T3-2. Dark-pool direction engine
- **What:** Infer probable direction of dark pool prints from subsequent lit-tape behavior, level context, and next-day drift; publish the calibration numbers (hit rate by confidence bucket) rather than hand-waving.
- **Why:** Unsolved category-wide — Cheddar openly admits prints show placement, not direction (research opening #3). "Any model that infers probable direction differentiates immediately," and UCT already invented the template with OI next-day confirmation.
- **Effort:** 4–8 weeks, research-shaped; ship behind a confidence label. **Owner:** Patrick (modeling + backend), Ravi (DarkPool.jsx surface). **Requires:** T2-3 live rail first.

### T3-3. Compass Flow Copilot
- **What:** Conversational flow analyst with tool access to FlowDB, GEX, OI snapshots, dark pool, scoreboard — *and the user's journal + live positions*: "What's smart money doing in semis today, and does it agree with my NVDA calls?" Internal MCP-style tool registry over the existing routers.
- **Why:** Beats Mr. Whale on the only axis that matters — it knows *your* book. This is the integration moat weaponized through the Anthropic lever, and it turns every flow feature above into conversational surface area.
- **Effort:** 4–6 weeks. **Owner:** Patrick (Compass is his; brain bridge already shipped dark). **Reuses:** Compass chat + brain bridge, T1-3 explainer prompts, all flow routers as tools, broker_sync positions.

### T3-4. Trade-aware GEX as a headline product
- **What:** Finish `/api/gex/compare` validation, publish the methodology page ("positioning attributed from the actual tape, not the everyone-is-customer-long assumption"), add per-ticker dealer-positioning time series, fix the crosshair lag (DevTools trace per playbook).
- **Why:** UW's Periscope (1-min actualized SPX MM positioning) anchors their new $120/mo Max tier — but it's SPX-only. Validated per-ticker trade-aware GEX is a genuinely stronger claim. Marketing an unvalidated model, however, would burn the accountability brand — validation gates the launch.
- **Effort:** 3–5 weeks. **Owner:** Ravi (gex/dealer area + OptionsFlow GEX mode) with Patrick building the validation harness.

### T3-5. Market Tide Replay + UCT Discord bot commands
- **What:** Tick-by-tick replay of any past session's tide/feed; slash-command bot (/flow, /tide, /gex, /scoreboard) for the UCT community Discord, with auto-posting configurable per channel.
- **Why:** Replay is a beloved UW retention feature that's cheap once T2-2 exists (FlowDB rows are timestamped); the bot converts UCT's community into a distribution channel the way Tradytics' bots do — without selling bots as a product.
- **Effort:** 3–4 weeks combined. **Owner:** Patrick. **Reuses:** T2-2 aggregation, existing Discord webhook/embed infra, day-scoped FlowDB queries.

---

**Sequencing note:** T1 is two calendar weeks of Patrick with one Ravi sync (nav + modal port). T2-1/T2-2/T2-4 can interleave with Ravi driving T2-6 and later T3-4. Every T1/T2 item reuses a shipped subsystem — nothing above requires new vendor data except T2-3.

## 3. Positioning — the switcher pitch

Unusual Whales shows you every print; UCT Intelligence tells you which ones mattered — every flagged trade is graded, verified against next-day open interest, and scored on a public hit-rate scoreboard, so you can audit us before you trust us. It's the only flow feed that lives inside your actual trading workflow: one login holds your charts with the flow and dealer positioning drawn on them, your journal and live broker positions, an AI coach that reads all of it, plus the scanner, breadth, and the morning wire — a print stops being a row in a table and becomes context on the trade you're already in. And it's one honest subscription: real-time full-tape flow with published feed-health receipts, no add-on ladder, no auto-renewing paid trial, cancel in one click.

## 4. What NOT to build

1. **Congress / politician / insider tracking.** UW's flagship differentiator, brand halo (2.5M-follower funnel, NANC/KRUZ ETFs), and it's 45-day-lagged commodity disclosure data. A clone would be strictly worse, advertise UW's home turf, and produce near-zero trading alpha. Cede it entirely.
2. **Public data API / Kafka / MCP resale.** UW's API is a real business with redistribution licensing, rate-limit ops, and enterprise support — a two-person team cannot run a data-vendor sideline, and Massive's license almost certainly forbids redistribution anyway. Build MCP-style tools *internally* for Compass (T3-3) and capture the benefit without the business.
3. **Native iOS/Android apps.** At ~200 users, app-store maintenance would consume Patrick for months to reach "limited feature parity" (the same criticism UW's own app draws). Responsive web now, PWA push alongside T2-1 later; revisit natively at 1–2k paying users.
4. **Live trading rooms / moderator "Team Trades."** BlackBox's entire $149/mo moat is salaried humans on camera — a headcount business, not software. UCT's Desk video pipeline + Discord community already covers the retention job without payroll or the regulatory exposure of live trade callouts.
5. **Vanna/charm and full vol-surface analytics.** Specialist-shop turf (SpotGamma, Menthor Q) serving a tiny sophisticated slice. Shipping half-validated Greeks would damage the accountability brand that T1-2/T3-1 are built on. Finish and validate trade-aware GEX first; reconsider only if it becomes the headline product.
6. **Prediction-market screeners, Trump tracker, seasonality/tourism datasets.** UW breadth-flexes that make sense at their scale as top-of-funnel content. For a focused challenger they're pure dilution — every one is a page to maintain and a distraction from the accountability + integration story.
7. **A raw full-OPRA firehose UI.** The loudest complaint across all six competitors is overwhelm. UCT's $10k/50-contract floors and graded, curated feed are the correct side of that complaint — matching UW's wall-of-prints aesthetic would be regression marketed as parity. Keep curation the identity; offer a "show more" depth toggle at most.
8. **SMS alerting.** A2P 10DLC compliance, per-message cost, and only FlowAlgo does it — with no reviewer ever citing it as a reason to subscribe. Discord + email + (later) web push covers every real use case.
9. **Unilateral rebuilds inside Ravi's files.** `OptionsFlow.jsx`, `schwab_router.py`, `massive_ws_worker.py` are partner-owned; the roadmap deliberately routes new surfaces (scoreboard, alerts page, integrations, copilot) around them. A refactor-the-9,206-line-page project is explicitly out of scope — additive hooks and coordinated ports only.


---

# Appendix — Research inputs

### BlackBox Stocks (blackboxstocks.com) — primary subject

**Positioning:** All-in-one scanner + community platform, launched 2016, publicly traded (NASDAQ: BLBX). Browser-based plus iOS/Android apps. The most community-centric product in the category.

**Core flow-feed features**
- Real-time options flow scanner with proprietary logic flagging *aggressive* institutional buying; claims to analyze 8,000+ stocks and up to 1.3M options contracts multiple times per second across NASDAQ/NYSE/CBOE and dark pools
- Options heatmap, volume-ratio scanner, delta/gamma exposure tracking, volume-profile charts
- Historical options data (Options Plus and above)
- Equities side: algo scanners across ~11,000 stocks for volatility/momentum, pre/post-market scanners

**Known for:** the live-trading-room + "Team Trades" moderator-callout model — three live rooms (Teah's Stock Plays for low-float, BlackBox Start flagship options room, Road House second options room) with live audio/video, plus a free 3-hour "BlackBox Bootcamp" for all subscribers. One reviewer noted its "Most Active and Flow" view is the weak spot — the community, not the raw tape, is the moat.

**Alerting:** algo-generated stock/options alerts; real-time mobile push for stocks, options, flow trades, and Team Trades; customizable alerts.

**Dark pool:** yes — real-time dark pool scanner (ticker, price, volume), but gated to Plus tiers and above, not Options Basic.

**Community:** strongest of any competitor — live rooms, moderator trades, Discord, education program.

**Pricing (mid-2026):** Options Basic $59/mo ($449/yr) — flow + alerts only, no dark pool. Options Plus $79/mo ($659/yr) — adds dark pool, historical options data, options rooms. Equities Plus $89/mo ($749/yr). Premium (Equities & Options) $149/mo (~$858/yr; running promo $250 for 3 months). No free trial.

**Weak spots:** no free trial; busy, dense UI with a real learning curve; the flow feed itself is considered mid-pack — value skews toward rooms/alerts; premium tier is the second-priciest in the set.

### FlowAlgo

**Positioning:** The original pure-play "smart money tape" — a focused feed of institutional order flow for retail, no frills around it.

**Core flow-feed features:** unusual options activity tape; intermarket sweep order detection (orders split across exchanges to hide size); option block trades (privately negotiated size); equity blocks; dark pool prints; on-demand historical flow by ticker/date; web dashboard. Scores "smart money" by order type, size, execution speed, and fill patterns.

**Known for:** being the pure institutional-flow tape and one of the earliest brands in the space; dark-pool + sweep detection is the signature.

**Alerting:** the deepest delivery stack in the group — real-time alerts via push, email, SMS, Telegram/Discord integration, and webhook/API routing on higher tiers; rule-based configuration (premium thresholds, Greeks, dark-pool size).

**Dark pool:** yes — dark pool prints and equity block trades in real time, a core feature not an add-on.

**Community:** essentially none — no trading rooms or chat; it is a data terminal.

**Pricing (mid-2026):** $37 paid 2-week trial that auto-renews; then $149/mo (list $199), $387/quarter, $1,188/yr (~$99/mo). Most expensive of the five.

**Weak spots:** priciest with the least breadth; reviewers report ~15-minute delay on some data; overwhelming raw tape with weak historical visualization; steep learning curve ("needs 6-12 months options experience"); support/billing complaints; auto-renewing paid trial breeds distrust; zero community or education.

### Cheddar Flow

**Positioning:** The clean-UI mid-market option — "institutional-level data in a simple, easy-to-use format."

**Core flow-feed features:** real-time flow feed processing 500k+ contracts/day with sub-second updates; calls green/puts red; filters on time, ticker, spot, size, strike, premium, volume, order type; unusual-volume detection; sweep grouping; put/call ratio; bullish/bearish flow-sentiment visuals; historical flow on demand; interactive charting; custom watchlists; "Cheddar AI" sentiment analysis.

**Known for:** usability — the easiest-to-read flow tape of the group; dark pool *levels* (aggregated price levels from prints) plus real-time sentiment tracking.

**Alerting:** AI-powered alerts and notifications — but gated to the Professional tier.

**Dark pool:** yes — prints and dark pool levels, Professional tier only.

**Community:** minimal; no trading rooms, small footprint (Trustpilot 4.0 on only ~15 reviews).

**Pricing (mid-2026):** Standard $85/mo (flow, charting, unusual volume, filters, historical flow); Professional $99/mo (adds dark pool, watchlists, AI alerts); annual ~$75/mo ($900/yr). 7-day free trial.

**Weak spots:** no community/education layer; AI alerts and dark pool locked behind top tier; own docs concede dark pool prints show placement, not direction; small company/support surface; not positioned as a standalone decision tool.

### InsiderFinance

**Positioning:** The value/breadth play — widest data scope at the lowest price, with an AI "smart score" ranking every order.

**Core flow-feed features:** flow dashboard surfacing unusual options activity, intermarket sweeps, private blocks, and dark pool prints, each ranked by a proprietary significance algorithm; gamma exposure (GEX) tool — notably **free to the public** (Net/Call/Put GEX, gamma by expiry) as lead-gen; open-interest levels; automated technical analysis with trend detection; options profit calculator; S&P 500 heatmap; congressional + insider trade tracking; news sentiment from 100+ sources; crypto/forex scanners; hourly free AI flow analysis. Free tier gets 30-minute-delayed flow.

**Known for:** bundling flow + dark pool + GEX + congressional/insider data at ~$55/mo annual — its marketing claim is replacing ~$138/mo of separate tools.

**Alerting:** real-time alerts via email and Discord — but reviewers call flow alerting its weakest area: limited/no custom alert configuration and no saved scans.

**Dark pool:** yes, included in the ranked feed.

**Community:** members' Discord + free daily newsletter; site advertises iOS/Android apps (older reviews said no mobile app — appears recently added, treat as improving but immature).

**Pricing (mid-2026):** $75/mo, $195/quarter (~$65/mo), $660/yr (~$55/mo). No free trial (free delayed tier instead).

**Weak spots:** flow analytics less robust than rivals (weak custom alerting, limited scan saving, sparse color-coding/interpretation aids); AI scoring methodology opaque; undercut on breadth-per-dollar by Unusual Whales (~$50/mo); requires baseline options knowledge.

### Tradytics

**Positioning:** The AI/analytics maximalist — "one stop shop" whose stated differentiator is that competitors "mostly focus on a single theme." Also the only one with a real B2B2C channel via Discord bots.

**Core flow-feed features:** live options flow and sweeps; dark pool analytics; AI trade ideas and AI portfolios; proprietary algo-flow indicators; daily/intraday/premium scanners; GEX/DEX dealer-positioning analytics rendered as a strike-by-strike heatmap (magnetic levels, acceleration zones); earnings research; hedge-fund 13F data; congress/insider tracking; crypto data; AI news feed with stock summaries.

**Known for:** the broadest analytics + AI layer per dollar, GEX/DEX visualization, and its Discord bot ecosystem (10+ bots) sold to trading-server owners; ~16,000+ member Discord community.

**Alerting:** in-platform alerts plus Discord-bot-delivered alerts and AI signals — Discord is effectively its alert rail.

**Dark pool:** yes, dedicated dark pool tool.

**Community:** large Discord (16k+); bots let other communities embed Tradytics data.

**Pricing (mid-2026):** Free tier (delayed data, market overview); Pro $69/mo or $420/yr, with a $15/15-day trial; Discord Bots plan $199/mo or $900/yr for server owners.

**Weak spots:** overwhelming for beginners with thin learning resources; repeated billing/cancellation complaints (double-charged trials, charges continuing after cancel, no-refund policy); long-time users report slowing update cadence and rivals outpacing it; sheer tool sprawl dilutes signal quality.

### Cross-competitor summary: table stakes

Features present in **every** serious flow product (all 5/5 unless noted) — the minimum bar for credibility:

1. **Real-time options flow tape** with call/put color coding, premium size, and sweep-vs-block classification
2. **Unusual-activity detection** (volume vs. open interest, aggressiveness at the ask, size thresholds)
3. **Filtering** by ticker/premium/size/order type/expiry, plus watchlists
4. **Dark pool prints / off-exchange block feed** — now baseline, though 3 of 5 gate it behind a higher tier (BlackBox Plus, Cheddar Professional; FlowAlgo/InsiderFinance/Tradytics include it)
5. **Historical flow lookup** by ticker and date range
6. **Some real-time alerting** (push, email, and/or Discord)
7. **Web-based dashboard**, subscription priced in the **$55–$150/mo** band, cancel-anytime

Anything a new entrant ships must clear this bar before differentiation matters — a flow product without dark pool prints or historical lookup reads as a toy in 2026.

### Cross-competitor summary: premium differentiators

Features that only 1–2 players have, and that anchor their premium pricing:

- **Live trading rooms + moderator "Team Trades"** — BlackBox only. Its entire $149/mo premium tier is justified by humans, not data
- **GEX/DEX dealer-positioning analytics** — Tradytics (strike heatmap) and InsiderFinance (free GEX tool); BlackBox has lighter gamma tracking. Fast-growing expectation, not yet table stakes
- **AI scoring / AI trade signals** — InsiderFinance smart-score ranking, Tradytics AI trade ideas/portfolios, Cheddar AI alerts. Everyone claims "AI"; nobody shows methodology
- **Deep programmable alerting** (SMS, Telegram, webhooks/API, rule builders) — FlowAlgo clearly leads; most rivals stop at push/email/Discord
- **Discord bot distribution** — Tradytics only; turns other communities into a sales channel at $199/mo
- **Congressional + insider + 13F data bundling** — InsiderFinance and Tradytics
- **Native mobile apps with push** — BlackBox strongest; InsiderFinance recently added; FlowAlgo/Cheddar are web-first
- **Structured education** (free bootcamp) — BlackBox only
- **Free/delayed tier as funnel** — InsiderFinance (30-min delay + free GEX) and Tradytics (free delayed tier); the others use paid trials or none

### Cross-competitor summary: openings (where everyone is weak)

1. **Interpretation, not tape.** Every product dumps raw prints and every review says the same thing: overwhelming, steep learning curve, "not for beginners," "alerts don't equal trades." No one explains *why* a print matters (opening vs. closing, hedge vs. directional, tied stock legs) in plain language, or distills the day into a small conviction-ranked list. A curated top-N conviction feed with reasoning attacks the single loudest complaint in the category.
2. **No outcome accountability.** None of the five tracks whether their flagged flow actually worked — no hit-rate scoreboard, no calibration, no "this alert from Tuesday is now +40%." A performance feedback loop would be a unique trust asset.
3. **Dark pool direction is unsolved.** All five print dark pool blocks; Cheddar openly admits prints show placement not sentiment. Any model that infers probable direction (subsequent tape behavior, level context) differentiates immediately.
4. **Trust and billing hygiene.** FlowAlgo and Tradytics carry recurring complaints: auto-renewing paid trials, double-charged trials, charges after cancellation, no-refund policies, unresponsive support. Transparent pricing + genuinely free trial + easy cancel is a cheap credibility win.
5. **Flow lives in a silo.** Weak integration between the flow feed and the user's own charts, watchlists, journal, and positions everywhere — Cheddar/BlackBox have basic charting, but no one connects "flow print" to "your open position / your chart / your journal." A platform that already owns charts + journal + portfolio (as UCT does) can contextualize flow in a way none of these standalone tapes can.
6. **Uneven alerting.** InsiderFinance effectively lacks custom flow alerts; Cheddar gates AI alerts to its top tier; only FlowAlgo does multi-channel rules well — and it has no community and costs the most. Good rule-based alerting at a mid price is an open slot.
7. **Latency honesty.** FlowAlgo draws 15-minute-delay complaints while advertising "real-time"; free tiers are delayed 30 min. Verifiably low-latency data, stated plainly, is a marketable claim.
8. **Community is binary.** BlackBox has rich rooms at $149/mo; FlowAlgo/Cheddar have essentially none. There is no mid-priced product pairing a strong flow feed with a lightweight community/callout layer.

### Sources and caveats

**Vendor pages fetched directly (mid-2026):** blackboxstocks.com/pricing, flowalgo.com, insiderfinance.io, tradytics.com. cheddarflow.com/pricing returned 403; Cheddar Flow details are from the 2026 BullishBears review plus search snippets from optionsscanners.com, quantvps.com, and optionstradingiq.com — treat Cheddar pricing ($85/$99/$900yr, 7-day trial) as review-sourced, not vendor-confirmed.

**Review/comparison sources:** bullishbears.com (BlackBox, FlowAlgo, Cheddar reviews), daytradingz.com (BlackBox, InsiderFinance), thestockdork.com, optionsscanners.com (BlackBox, Tradytics, InsiderFinance, best-flow-scanners roundup), tradealgo.com comparison guides, tradingtoolshub.com (FlowAlgo guide/alerting detail), purepowerpicks.com (Tradytics 3.5/5), daytradereview.com (InsiderFinance cons), techjockey/sourceforge/slashdot user reviews (billing complaints), unusualwhales.com competitor pages (pricing counterpoints).

**Caveats:** (1) Several "2026" reviews are affiliate-driven and lean positive; complaint data comes from user-review aggregators and is anecdotal. (2) InsiderFinance mobile apps: own site advertises iOS/Android but a recent review says no mobile app — likely recently launched. (3) FlowAlgo alerting detail (webhooks, Telegram) comes from a third-party guide, not the vendor page. (4) Unusual Whales (~$50/mo) recurred across sources as the price-pressure benchmark for the whole category and would be the logical next competitor to profile.

### Executive summary — what exists today

UCT already has a **full options-flow product suite** spanning three data rails plus derivatives analytics:

1. **Historical/EOD flow rail** — BBS-format CSV rows in SQLite (`/data/flow.db`), served as gzipped CSV to a 9,206-line client-side analytics page (`OptionsFlow.jsx`) that parses/scores everything in the browser.
2. **Live OPRA rail (Massive)** — real-time WebSocket trade consumer (`api/massive_ws_worker.py`, 2,508 lines) + T+1 flat-file backfill (`api/massive_flatfiles_worker.py`) writing into the SAME FlowDB, so the page picks live prints up automatically. Mature: NBBO side classification, OI enrichment, spot backfill, deploy-survival hardening (LOCKED invariants in CLAUDE.md, shipped 2026-07-06).
3. **Bullflow alert rail** — third-party SSE consumer (`api/liveflow_worker.py`, 3,101 lines) with a hardcoded conviction Filter Engine and Discord forwarding, rendered at `/live-flow`.

On top: **GEX/dealer-positioning analytics** (Schwab chains + trade-aware attribution), **dark-pool prints** (parallel CSV DB + page + chart overlay), **daily OI snapshots** for retroactive direction confirmation, and a **persistent Top Flow picks tracker**. All backend routers are mounted in `api/main.py` (lines ~2886–2926). Notably, `massive_ws_worker.py`, `schwab_router.py`, and `OptionsFlow.jsx` are **partner-owned** surfaces (per CLAUDE.md/memory) — rebase-safe editing rules apply.

### OptionsFlow.jsx — the main page (/options-flow)

**File:** `app/src/pages/OptionsFlow.jsx` (9,206 lines, all inline styles, partner-owned). Routed in `app/src/App.jsx:161` inside `AuthGuard`+`Layout`; **FREE-tier** (`FREE_PAGES` includes `/options-flow` — `AuthGuard.jsx:86`, `NavBar.jsx:33`).

**Top-level data modes** (line ~3758/4098 switcher): `Stocks | Indexes/ETF's | Live Flow | Dark Pool | GEX`. "Live Flow" opens `/live-flow` in a new tab; "Dark Pool" renders the imported `DarkPool` component inline (line 4); GEX is its own mode (`dataMode==="gex"`, line 3324).

**Tabs within Stocks/Index modes** (line 1949): `TABS = ["Market Read","Top Flow","Leaderboard","Search","OI Check","Tracker","Watchlist"]`.
- **Market Read** — market indices + AI narrative via `/api/schwab/market-summary` + `/api/schwab/market-narrative` (Claude Sonnet 4.6 + web search, `api/schwab_router.py:120-153`); sector/theme aggregation (`THEMES_DEF`, `resolveSector`, `sectorView` state), net-by-ticker charts (`buildCharts`, line 869).
- **Top Flow** — conviction picks with C/P filters, DTE filter, activity filters (new/UOA), 90/80% bull-bear buckets; saves picks to `/api/top-flow/save`; Discord push (`/api/discord/push`, `/api/discord/push-image`).
- **Leaderboard** — per-ticker net premium board with YTD/52-week-off overlays (`/api/schwab/ytd-performance`), OI-change batch (`/api/schwab/oi-change-batch`), sortable.
- **Search** — per-ticker + batch watchlist scan (paste tickers or upload CSV watchlist), DTE filters, contract drill-down with live quotes (`/api/schwab/options-quotes`), contract history (`/api/schwab/contract-history`, `/api/schwab/backfill-contract`).
- **OI Check** — OI-confirmed-only toggle using `/api/oi/confirmation-map` (confirmation window 1-5 days), sortable by ΔOI/premium.
- **Tracker** — the persistent Top Flow performance tracker (`/api/top-flow/history`, `/api/top-flow/snapshot`).
- **Watchlist** — saved watchlists (`/api/watchlist/save|load|dates`).

**Client-side pipeline:** the page fetches raw CSV from `/api/flow/data` / `/api/flow/indexes-data` (with `?v=` cache-busting from `/api/flow/version`), parses it (`parseCSV`, line 384) and runs `processFlowData` (line 1152) — direction classification (Call+Ask→BULL etc.), cap-band filters, ETF detection (`KNOWN_ETF_TICKERS`), grade scoring (`gradeCluster` A+..D, line 147), pattern detection (line 161), cancelled-print stripping (line 15).

**Chart modal:** real `StockChart` with GEX price-lines overlay (`gexPriceLines`, line 3328 — Ceiling/Support/Bounce/Resistance semantics) and a **dark-pool level overlay** (`clusterDarkPoolPrintsForOverlay` line 74, `/api/darkpool/ticker-detail`, `showDarkPool` persisted in localStorage line 2009).

**Mobile:** deliberately thin — additive `OptionsFlow.mobile.css` (165 lines, `@media ≤640px` + `!important` riding on `of-*` className hooks; never edits the inline styles — rebase-safe technique per CLAUDE.md). Desktop-first dense UI; phone gets scrollable chip rows + 44px targets, not a redesign. **`OptionsFlow_admin.jsx` (9,997 lines) and `LiveFlow_admin.jsx` are NOT routed** — they are Claude-artifact workbench copies with stubbed StockChart/TickerPopup (diff at head confirms); the real routes use the public files.

### Historical flow DB + CSV serving (flow_router.py / flow_db.py / flow_summary.py / notable_flow)

**`api/flow_db.py` (441 lines):** SQLite at `/data/flow.db` (env `FLOW_DB_PATH`), WAL. One `flow` table in BBS-export column order (22 cols incl. Symbol/Type SWP-BLK/Side/CallPut/Strike/Spot/Premium/IV/Dte/ER/Sector/Uoa/MktCap/OI — lines 29-34). Dedup on a 10-column trade fingerprint (lines 41-44). Streams CSV in 2,000-row batches; auto-prunes expired contracts.

**`api/flow_router.py` (338 lines):** `/api/flow/*` — `POST /upload` (raw CSV body, stocks|indexes source), `GET /data` + `/indexes-data` (?days=1..365 or all_data), `GET /stats`, `GET /version`, `POST /bump-version`, `POST /prune`, `GET /dates`. Mature 3-layer perf design documented in the docstring: stream-gzip level 1 + mtime=0 deterministic output, 8-entry LRU in-RAM response cache keyed by (source, days, version), buffered (not chunked) responses so Cloudflare edge-caches (headers line 52: `max-age=300, stale-while-revalidate=86400`). Version = DB row count + manual bump offset (handles in-place admin mutations, lines 65-118). **No auth on these endpoints** (relies on obscurity + CF; upload is unauthenticated at API layer). CSV upload UI lives only in the unrouted `OptionsFlow_admin.jsx` workbench.

**`api/flow_summary.py` (409 lines):** `GET /api/flow/top-conviction?limit=10` — compact per-ticker |net premium| leaderboard for the **Dashboard Options Flow preview tile** (memory: `project_options_flow_dashboard_preview_2026_06_18`). Mirrors the page's direction logic server-side; 60s TTL cache.

**`api/notable_flow_router.py` (97 lines) + `api/notable_flow.py`:** Discord "Notable Flow" alerts — `POST /post` (pulse + hot tickers, fired after admin CSV upload from the admin workbench), `POST /post-single` (manual button, bypasses 24h dedupe), settings/dedupe CRUD. Separate webhook `DISCORD_NOTABLE_WEBHOOK_URL`. Maturity: shipped, admin-driven, no auth gate at the API layer.

### Live OPRA ingest — massive_ws_worker.py + flat files + /live-massive

**`api/massive_ws_worker.py` (2,508 lines, partner-owned):** real-time Massive Options WS consumer (`wss://socket.massive.com/options`, `T.*` all trades) on a dedicated daemon thread with its own asyncio loop; scheduler-lock guarded (one instance). Aggregates ticks into SWEEP/BLOCK events, flushes every 2s (`MASSIVE_FLUSH_INTERVAL`) as BBS CSV via `FlowDB.insert_csv()` — same dedup/read path as uploads, so OptionsFlow.jsx sees live prints with zero frontend change.
- **Filters:** `MIN_PREMIUM=$10,000`, `MIN_VOLUME=50` contracts (env-tunable, lines 78-79).
- **Side classification (Phase 2c/2h):** Tier 1 = Lee-Ready vs live NBBO from `Q.*` subscriptions (dynamic per-contract subscribe pool; `NBBO_STALENESS_NS=5s`, tightened from 60s after a 30% mislabel audit — lines 180-196); Tier 2 = tick-test fallback (~95% coverage) (`_classify_events_side`, line 539).
- **Enrichment:** OI per event (`_load_oi_for_events`, line 264), ticker metadata/sector/mktcap from prior FlowDB rows (`_load_ticker_metadata`, line 461), spot map per flush + Phase 3 startup retroactive spot backfill for pre-warm-stranded rows (line 151-155). Extensive `get_status()` telemetry served at `/api/admin/massive-ws-status` (main.py:2950).
- **Ops hardening (LOCKED, 2026-07-06):** reconnect discipline (30s min gap, max_connections backoff ladder 30→600s with young-process cap, lines 91-102), graceful `stop()` wired into the lifespan shutdown, deploy window rule (ship ≥4:20 PM ET), DRY_RUN mode — feed gaps are permanent until T+1 (no replay). Runs on the **web** service (`MASSIVE_WS_ENABLED=1`).

**`api/massive_flatfiles_worker.py`:** T+1 daily OPRA trades CSV from Massive S3 (`files.massive.com`, published ~11 AM ET; cron 11:30/12:00/12:30 retries) through the same validated `massive_processor` aggregator into FlowDB — dedup absorbs overlap with the WS rail. V1 docstring notes side/spot enrichment stubbed on this path. Status/manual-run admin endpoints in main.py (~2965-2991).

**`api/live_massive_router.py` (`/api/live/massive/*`, ~3,200 lines):** serves FlowDB-backed live feed to **`LiveFlowMassive.jsx`** (2,461 lines, `/live-massive`): `/recent`, `/curated`, `/day-stats` (day-scoped BULL/BEAR/NET), `/thresholds` CRUD, plus a big diagnostic surface (`/diagnostic`, `/side-diagnostic`, `/contract-debug`, `/spot-check`, `/worker-history`, `/restart-log`, `/enrich-oi`, `/backfill-spot`). Frontend header comment self-describes as **"TEST PAGE"** — stripped vs LiveFlow (no history/backtest/Discord push). Known perf gap: poll interval bumped 5s→20s on 2026-07-01 because a FlowDB query took 43s for 11K rows ("restore to 5000 once sub-second" — comment in both LiveFlow pages).

**`api/massive_oi_snapshots.py`** — Massive-chain-based OI fetcher as fallback/alternative to the Schwab OI path (one call per underlying; docstring flags "ASSUMPTIONS — verify against current Massive docs": semi-mature).
**`api/uw_live_flow.py`** — Unusual Whales flow-alerts → BBS-CSV row adapter (alternate source into the same pipeline; auxiliary).

### Bullflow alerts rail — liveflow_worker.py + LiveFlow.jsx (/live-flow)

**`api/liveflow_worker.py` (3,101 lines):** consumes Bullflow SSE (`api.bullflow.io/v1/streaming/alerts`, `BULLFLOW_API_KEY`), buffers in memory (MAX_BUFFER=1000; SQLite persistence via `live_alerts_db` for history), runs it through **Filter Engine v1** (rules hardcoded in-module by design — "edit code, push" lines 14-17):
- **Table filter:** premium ≥ $250K, large ETF/leveraged-ETF ticker blocklist (~50 tickers, lines 90-118), alertName block substrings (grenade/urgent/repeater).
- **Conviction gates for Discord** (`ALERT_CONVICTION_GATES` line 543 + `_passes_alert_gates` line 832): per-tier premium requirements (line 208), `MIN_DISCORD_GRADE=B` (env), `HIGH_PREMIUM_OVERRIDE=$2M`, mega-cap per-alert blocklists (line 124-156), earnings-window block (`EARNINGS_MAX_DTE_BLOCK=15`), max 3 posts/ticker/day (line 247), 12h repeat window + follow-through counting, 60s dedup with priority resolution, weeklies retag logic.
- **Enrichment:** prior-OI lookup from `contract_oi_snapshots` (line 1792, walks back ≤5 days), spot cache (120s TTL) + `_calc_moneyness` (line 1948), OCC symbol parsing (line 2146).
- **Delivery:** rich Discord embeds (UCT logo, matches discord_watchlist pattern) to `DISCORD_LIVE_FLOW_WEBHOOK_URL`||`DISCORD_WEBHOOK_URL` after a 2s delay; runs in an isolated daemon thread (`liveflow_worker_threaded.start()`, main.py:1080). User-editable ticker blocklist persisted to disk (line 258-337). Replay-through-gates functions for backtests (lines 924, 1029).

**`api/liveflow_router.py` (`/api/live/*`):** `/alerts/recent`, `/alerts/history`, `/user-blocklist` GET/PUT, admin `force-push-discord`, baseline refresh/summary endpoints, `debug-retag`. Plus `api/routers/liveflow_health.py` → `/consumer-state`.

**`app/src/pages/LiveFlow.jsx` (2,288 lines, `/live-flow`):** subscriber-facing feed — 5s→20s polling (same FlowDB-perf bridge note), 6 tier groups (Alpha/Mega → Whale → Bullish/Bearish → LEAPS → Unusual → Algo) derived from alertName, colored tier borders, multi-select filter chips persisted in localStorage (`uct_liveflow_filters_v3`), collapsible groups, 🔔 badge on Discord-forwarded rows, **backtest mode** via `?backtest=YYYY-MM-DD` (`/api/admin/bullflow/backtest`, capped at 100 alerts by Bullflow MCP). Own full-page layout (no sidebar — App.jsx:145-147).

**Auth/visibility:** `/live-flow` and `/live-massive` are reachable by **any logged-in user via direct URL only** — deliberately no nav entry, explicitly "test/validation phase" (`AuthGuard.jsx:107-116`). `api/bullflow_mcp_probe.py` is a self-labeled DELETE-ME exploration router (no API-layer auth) still registered.

### GEX + dealer positioning (gex_router.py / gex_service.py / dealer_positioning*.py)

**`api/gex_service.py`:** computes gamma exposure from **Schwab `/chains`** (greeks + OI). Two modes: naive (all OI customer-long, SpotGamma convention) and **trade-aware** (`adjusted=true`) which scales each contract by `est_customer_net / OI` from the `dealer_positioning` table. Includes `classify_gex_state()` — semantic level labels (call wall above spot = Ceiling, below = Pull Up; put wall = Floor/Magnet; zero-gamma = Danger Line only when spot is near/below) to keep card/chart/AI-summary naming consistent.

**`api/gex_router.py` (49 lines):** `GET /api/gex/data?ticker=&dte=0dte|week|month|all&adjusted=` (returns adjusted flag, attributionDays, avgConfidence, coveragePct) and `GET /api/gex/compare` (naive-vs-adjusted per-strike deltas, zeroGammaShift/wall shifts/sign-flipped strike counts — validation endpoint). **No auth dependency on the router.**

**`api/dealer_positioning.py` (903-line family):** flow-attributed dealer positioning per contract per day — reads today's OI from `contract_oi_snapshots`, computes ΔOI, attributes it BTO/STO from ASK-vs-BID flow premium in the `flow` table, maintains cumulative `est_customer_net` + `flow_confidence` per contract. Cold-start hybrid seed `SEED_RATIO=0.5`; confidence floor 0.05; saturates when day-flow ≥10% of OI notional. Runs at the end of the daily OI snapshot job. Covers stocks AND indexes sources.

**`api/dealer_positioning_router.py`:** `/api/dealer-positioning` — `GET /status`, `POST /backfill` (fire-and-forget thread, ~1-3s/date), `POST /compute/{date}`. Docstring self-describes as **admin endpoints but has no auth-layer gate** (module-level flag prevents parallel backfills, acknowledged "not perfectly multi-worker-safe").

**Frontend:** GEX is a full data mode inside OptionsFlow.jsx (default SPY, DTE filter, GEX summary card, GEX chart with D/W TFs, per-strike walls, price-line overlays on StockChart, plus `ideaGex` popups on Top-Flow picks). Known open issue: **GEX crosshair lag unresolved** (memory `project_optionsflow_gex_crosshair_lag_unresolved`). Maturity: shipped and functional; trade-aware mode is validated-in-progress (the /compare endpoint exists specifically to eyeball it).

### Dark pool (darkpool_router.py / darkpool_db.py / darkpool_aggregator.py / DarkPool.jsx)

**`api/darkpool_router.py` (349 lines):** `/api/darkpool/*` — `GET /data` (gzipped CSV windows 1d/5d/20d/60d/90d/all), `GET /aggregated` (pre-aggregated payloads via `darkpool_aggregator` with background prebuild of all windows), `GET /dates|/version|/stats`, `POST /upload` + `/upload-text` (CSV in), `POST /prune` (120-day retention), `DELETE /clear`, `GET /ticker-detail` (feeds the OptionsFlow chart overlay). Architecture "mirrors flow_router.py exactly" — same stream-gzip + LRU + CF-cacheable buffered responses, sized for ~3M rows/250MB raw at 90d (an earlier build-full-string approach OOM-killed the Railway worker — docstring). Startup seeding + auto-prune in main.py (lines 1880-1909).

**Data source:** admin CSV uploads (BBS-style dark-pool print exports) — no live dark-pool feed; seeded on boot from bundled files if the DB is empty.

**Frontend:** `app/src/pages/DarkPool.jsx` (3,318 lines) — standalone `/dark-pool` route (App.jsx:162; **NOT in FREE_PAGES → paid/admin only**, and not in the nav) AND embedded as the "Dark Pool" data mode inside OptionsFlow.jsx (import line 4). OptionsFlow's chart modal reuses its print-clustering logic (`clusterDarkPoolPrintsForOverlay`, 2% zones, cancelled-print stripping) to draw dark-pool levels on charts. Realtime streaming coverage explicitly EXCLUDES OptionsFlow and DarkPool (CLAUDE.md). ⛔ Memory note: launch-readiness declared "no options-flow/dark-pool area" for cold-start hardening work — treat as a lower-traffic surface.

### OI snapshots + Top Flow tracker (oi_snapshots.py / oi_snapshot_router.py / top_flow_tracker.py / top_flow_router.py)

**`api/oi_snapshots.py` (903 lines):** daily OI snapshot collection + retroactive direction confirmation. Premise: B-side trades are ambiguous same-day; next-day OI growth proves real positioning. `contract_oi_snapshots` (contract, date, oi) + `oi_snapshot_runs` tables in flow.db; 5:30 AM ET weekday cron (main.py:2495-2510) snapshots every contract with flow in the past 30 days (90-day retention). **Confirmation rule:** `(oi_t+1 − oi_t) / volume_t ≥ 0.50` → confirmed positioning. OI sourced via in-process `schwab_router.options_quotes_batch()` (one chain call per symbol, UW fallback); `massive_oi_snapshots.py` exists as a Massive-based alternative.

**`api/oi_snapshot_router.py` (`/api/oi/*`):** `POST /run|/run-sync|/cancel`, `GET /run-status|/status|/lookup|/history`, `POST /confirm` (batch cluster confirmation — powers the OI Check tab's `/api/oi/confirmation-map` consumption), `POST /bulk-fetch`, `GET /test-massive/{ticker}`.

**`api/top_flow_tracker.py` (558 lines):** persistent Top Flow picks tracker at `/data/top_flow_picks.json` (atomic writes). Picks keyed `SYM|C/P|strike|exp` with entry price, grade, direction, hits, premium, and a per-day `history` array of {price, oi, spot} snapshots. Auto-saves when new CSV loads (`save_picks` merges/updates), daily price snapshot job, auto-archives expired contracts at startup (main.py:1818-1820).

**`api/top_flow_router.py` (`/api/top-flow/*`):** `POST /save|/snapshot|/migrate-entries|/archive-now|/wipe`, `GET /history`, `GET /purge-old/{keep_days}`. Feeds the page's **Tracker** tab (active + archived pick performance). Maturity: shipped and running (startup log prints active/archived counts); JSON-file storage (not SQLite) is the one architectural oddity.

### Maturity, auth gating, and known gaps

**Maturity ladder (most → least mature):**
- **Production, hardened:** flow_router/flow_db CSV rail (CF-edge caching, LRU, version-bump discipline); OptionsFlow.jsx page (huge feature surface, FREE tier, in nav); massive_ws_worker (Phase 2c/2h/3 enrichment complete, deploy-survival LOCKED invariants, status telemetry); notable-flow + liveflow Discord pipelines (proven in daily use); top_flow_tracker; oi_snapshots + confirmation.
- **Production but explicitly transitional:** LiveFlow (/live-flow) — subscriber-facing but URL-only, no nav, "test/validation phase" comment in AuthGuard; poll interval degraded 5s→20s pending flow.db query perf fix (43s/11K rows diagnostic, 2026-07-01 bridge comment in both LiveFlow pages).
- **Test/validation:** LiveFlowMassive (/live-massive) — self-labeled TEST PAGE, feature-stripped, exists to validate the Massive rail before promotion; massive_flatfiles_worker V1 (side/spot stubbed on the flat-file path); trade-aware GEX (validation /compare endpoint still in place); massive_oi_snapshots (unverified-assumptions docstring).
- **Workbench/leftover:** `OptionsFlow_admin.jsx` (9,997 lines) + `LiveFlow_admin.jsx` — unrouted Claude-artifact copies (the admin CSV-upload UI lives here); `bullflow_mcp_probe.py` — self-labeled "DELETE THIS FILE" exploration router, still registered.

**Auth gating:** `/options-flow` = free tier, in nav. `/dark-pool` = paid-only (not FREE_PAGES), not in nav, but the same DarkPool component is embedded inside the free OptionsFlow page. `/live-flow` + `/live-massive` = any logged-in user, direct URL only. **Backend flow/gex/darkpool/dealer-positioning/notable-flow routers have no per-route auth dependency** — including mutating endpoints (`/api/flow/upload`, `/api/darkpool/clear`, `/api/dealer-positioning/backfill`, `/api/notable-flow/post`); protection is de-facto (obscurity + Cloudflare), unlike auth-gated routers elsewhere in the app.

**Known gaps / open items:**
- flow.db query performance (the 43s diagnostic) is the active bottleneck degrading both live pages' poll cadence.
- Massive OPRA has **no replay** — WS gaps are permanent until the T+1 flat file; shipping window + graceful-shutdown invariants exist to mitigate (CLAUDE.md "Live Options Flow — Deploy Survival").
- Flat-file rail V1 lacks side/spot enrichment (quotes-file integration = V2).
- GEX crosshair lag unresolved (memory playbook: needs DevTools Performance trace).
- OptionsFlow/DarkPool are the only surfaces excluded from the realtime SSE price streaming coverage.
- Mobile is an additive CSS shim (165 lines), not a real mobile experience; page is desktop-dense by design.
- 3 voice-metering findings deferred is unrelated; but memory notes ⛔ launch-readiness explicitly excluded options-flow/dark-pool from hardening — concurrency behavior at ~200 users on these CSV endpoints leans entirely on the CF cache.

### Snapshot & Positioning (as of July 2026)

Unusual Whales (UW) has evolved from an options-alert tool into a broad retail 'financial data terminal': live options flow + dark pool + Greek exposure analytics + congress/insider tracking + news + API/MCP + Discord distribution + mobile apps + an AI analyst ('Mr. Whale', May 2026) + a Polymarket prediction-market product. Products are sold as separate subscriptions (Platform, API, Platform+API Bundle, Predictions, Discord Bot) with bundles at a discount. Verified live from unusualwhales.com/pricing on 2026-07-06 (July 4th sale running, 10% off for 1 year). Their marketing claim: 'Real time trade data for every options trade across all US exchanges' (full OPRA tape, not a sampled feed). Free tier exists but is delayed/limited. Notable: UW serves an AI-agent stub + skill.md to LLM crawlers — they are actively courting AI-agent integration (MCP server launched 2026-03-12).

### Live Flow Feed

**Columns (official docs, docs.unusualwhales.com/features/2-options-flow):** Time (timezone-adjustable), Ticker (hover tooltip + click-through), Side (BUY=ask-side / SELL=bid-side; mid-price defaults BUY), Contract, DTE, Stock price at trade, % Diff (stock vs strike), Bid-Ask (NBBO at execution), Spot (fill price), Size, Premium, Open Interest, Volume, IV, Code (exchange trade code), Flags, Legs (multi-leg count), days-to-earnings, emoji tags. Columns are reorderable/customizable; rows link to a 'flow popup' with contract charts, historical vol/OI, 5-min candles.

**Filters:** ticker/watchlist, sector/index, premium, size, DTE/expiration range, strike distance/% OTM, stock price, bid/ask aggressiveness, bullish/bearish, sweep/block/cross trade codes, multi-leg, delta/theta/gamma, IV & IV change, skew, vol>OI conditional logic, days-to-earnings, hide expired, cancelled/modified trades, 'Repeated Hits'. AI filter builder (natural language → filter) since Apr 2025. Saved filters: 10 per feed on Basic, unlimited on Pro+.

**Mechanics:** Live Flow toggle, 50–250 results/page, sort by Time/Size/Premium (non-time sort gated to ≥$25k premium or ≥150 contracts), Flow Status indicator (green/yellow/red), saved trades (heart), bid/ask/fill visualization (added 2026-03-09), known-position identification (Sept 2025), index price approximation, 'My Trades'.

**Latency claims:** 'real-time' for all paid tiers (no ms-level SLA published); free tier delayed. **Rating: table-stakes** feed with **differentiator-grade** filter depth, transparency (NBBO shown per print) and full-tape coverage.

### Alerts

**Three layers:**
1. **Unusual/Flow Alerts (algorithmic):** curated unusual-activity alerts feed, active 10am–4pm ET (first 30 min suppressed as noise). Each alert: contract, expiry, OI/volume, underlying, max gain/loss since alert, IV, sector, original ask, daily $ vol, % diff, emoji tags. Free users get them 5–12 min delayed; paid = no delay. Legacy 'Unusual Alerts' feed superseded by the Flow Alerts feed. Kodak-Moment stock-volume-anomaly alerts and SPAC alerts also exist.
2. **Custom Alert builder:** alerts on options flow (any flow-feed filter set, incl. Interval Flow filters loaded directly), price moves, volume spikes, OI change on individual contracts, IV change, news, analyst ratings, insider trades, SEC filings, Market Tide thresholds, earnings (email added 2026-03-10), Truth Social posts, FDA/halts. Absolute-value conditions supported; preset alert templates; create-alert-from-any-feed shortcuts. Limits: 25 custom alerts (Basic) / 100 (Pro, Max, Professional).
3. **Per-trade notifications:** push for individual flow prints (all flow subscriptions since Sept 2025).

**Delivery channels:** website feed, iOS/Android push, Discord (server bot auto-posts via /configure; custom alerts enabled Oct 2025), API WebSocket channel for custom alerts. Officially **no SMS or email** for flow alerts (email only for earnings). **Rating:** basic flow alerts = table-stakes; the cross-domain custom alert builder with Discord + WebSocket delivery = **differentiator**.

### Flow Analysis & Aggregations

- **Market Tide** — market-wide net call vs put premium intraday, ALL vs OTM-only views, historical lookback + Replay mode (replay a past day tick-by-tick; included in all flow subs since Sept 2025). **Differentiator** (widely imitated since, but UW's is the reference).
- **Net Flow charts** — per-ticker net premium ticks, by strike/expiration, 2–3 day lookbacks; SPDR sector-ETF HOLDINGS net-flow views (XLE/XLF/XLY…). 
- **Sector Flow page** with sector net-flow charts; **0DTE Flow** page + 0/Weekly-DTE Tide; **Interval Flow** (aggregated flow per contract over intervals, %OTM, IV-change, preset filters Jan 2026); **Hottest Contracts/Chains** (most-active contracts, new-strike toggle); **Super Flow** — multi-window custom flow dashboards (greeks, contract charts, heat map, Market Tide/Net Flow panes, keyboard shortcuts; 5 dashboards Basic / unlimited Pro+); **Intraday Analyst**; **Options Dashboard**; heatmaps (sector/industry); **Market Maps** with GEX visualization (Nov 2025) + Dark Pool overlays (May 2026); Correlations Explorer; Whales/'Dark Flow' equity feeds; options + stock screeners (premium, IV, greeks, OI, unusual volume, fundamentals, low/high/last-fill indicator added 2026-03-11). **Rating:** net-premium/sentiment aggregation = table-stakes among flow tools; Market Tide Replay, Super Flow dashboards, sector-ETF holdings flow = **differentiators**.

### Dark Pool

Dark pool prints feed (FINRA ATS/off-exchange) with ticker, size, price, time, settlement data, volume-% context; separate lit vs off-lit feeds; pushes trades of lesser value too (not only mega-blocks); 'Dark Pool/Options by Price' combined feed; dark-pool levels in the mobile app and as chart studies; dark-pool data included in daily downloadable files; May 2026 update integrated dark pool into Market Maps. One 2026 review claims '50+ dark pool feeds'. **Rating: table-stakes** (every competitor has DP prints) with **differentiator** touches (levels-on-chart, by-price aggregation, downloads).

### GEX / Greek Exposure / Periscope

- **Greek Exposure pages per ticker** (unusualwhales.com/stock/{T}/greek-exposure): GEX, DEX (delta exposure), **Vanna and Charm**, by strike and by expiration; spot exposures over time with directional volume; interpolated IV / vol smile, skew, reversal skew, term structure; Spot Gamma by Strike/DTE; GEX Strike Profile as a chart study; GEX charts on mobile; GEX in API.
- **Periscope** — SPX **actualized market-maker positioning** (not the usual dealer-assumption model): net gamma exposure, Delta Flow, straddle-breakeven cone, heat-map view, multi-chart, audible chime, historical data. Launched Mar 2025 as a $5→$10/mo add-on; now bundled — 10-minute updates on Retail Pro, **1-minute Periscope on Retail Max/Professional** (July 1, 2026).
**Rating: strong differentiator** — vanna/charm per ticker and 1-minute actualized SPX MM positioning is beyond what flow-tool peers (FlowAlgo, Cheddar Flow, BlackBox) offer; comparable only to specialist vol shops (SpotGamma, Menthor Q).

### OI Change Tracking

Dedicated **Open Interest Change feed**: largest OI deltas vs prior close across the market, updated early premarket, historical OI changes, 10-minute candles on the feed (Feb 2025), bid/ask + bullish/bearish filters, preset filters (Jan 2026), plus an **Open Interest Explorer**, ticker OI heatmap views, and per-contract 'Change in OI' custom-alert notifications. Incorrectly-reported-OI tooltip shows data-quality awareness. **Rating: differentiator** — most flow competitors have no first-class OI-change feed; this is a core institutional-footprint workflow UW owns.

### Historical Flow, Search & Backtesting

- **Contract Look-Up** — search any historical contract, mirrored to watchlists, full trade history.
- **Historical options data** — past + present data for all active contracts; historical contract charts (incl. historical IV, volume/OI charting); nullified/modified-trade indicators; premarket equity prices in historical tables.
- **Downloads/Data Shop** — daily option + dark pool file downloads (all platform tiers per current pricing matrix; flow-data download historically a Lifetime/annual perk), Data Shop with credit accrual for bulk historical purchases; separate 'Historical Option Trades' data product (~$250/mo per one review).
- **Backtesting** — Portfolio Backtester (live Oct 2024) + paper trading; **not** a per-flow-signal backtester à la Tradytics.
- API: 90-day lookback (trial) to **2-year lookback** (paid tiers, raised July 2, 2026).
**Rating:** historical contract charts/search = table-stakes-plus; raw daily file downloads + data shop = **differentiator**; flow-signal backtesting = **gap** (weaker than Tradytics/InsiderFinance claims).

### Charts & Options Profit Calculator

**Charting:** TradingView-style live charts for all US stocks with technical indicators (VWAP, Bollinger, etc.), options-derived studies overlaid — options volume, dark-pool studies, GEX strike profile, strike premium, dark-pool levels; ticker comparison; enlargeable charts; volume candles on options contracts (web + mobile). Nasdaq real-time equities data included in all tiers. **Rating: table-stakes** as a chart, **differentiator** for flow/GEX-on-chart studies.

**Options Profit Calculator (OPC):** interactive strategy P&L across price × date with time decay, pre-built strategies, deep-linked from any multi-leg trade in the flow feed (click a multileg print → loads into OPC). **Rating: table-stakes** (free OPC sites exist), but flow→OPC one-click integration is a nice **differentiator** detail.

### Congress / Insider / Institutional Tracking

The feature UW is publicly famous for. **Congressional trading reports** (members, governors, officials; disclosure-based, up to 45-day statutory lag), politician portfolios and trade feed (web + mobile + Discord bot auto-posts since Mar 2024), original research reports; the NANC/KRUZ ETFs were built on UW's data (brand halo). 'Politician Trade Information' now included in **all four** platform tiers. Plus: insider transaction feed (filters, Nov 2024), institutional holdings/13F pages, hedge-fund portfolios ('Portfolios' product, historically a $10/mo add-on), **Trump Tracker** (schedule/feed + Truth Social push alerts), analyst ratings with performance tracking. **Rating: flagship differentiator** — no options-flow competitor has an equivalent; it is also UW's top-of-funnel via the 2.5M-follower Twitter account.

### News, Calendars & Community

**News Flow** real-time headline feed with ticker prices attached; economic calendar, earnings calendar (with implied moves), trading calendar, FDA calendar, dividends feed, halts/pause-unhalt feed, IPO calendar (API), seasonality suite (15 yrs, month-to-month, day-of-week, sector seasonality), FED-speaker market impact dataset, US tourism data, Ticker Performance tracker, financials pages, risk pages. **Community:** UW Discord server access + sub-only channels, on-site chat rooms, Community page (live chat + community flow), Stock Talk threads, podcast, blog/research. **Rating:** news/calendars = table-stakes (breadth is above average); community/Discord = **differentiator** for retention.

### Discord Bot, Telegram, API & Mobile

**Discord bot** (separate product tab: 'Live options flow data in your Discord'): free bot + premium/server subscription; slash commands (/flow, /chart with remembered indicators, /screener, /options_screener, /market_tide, /financials, /net impact, futures, greeks, live spot gamma, FDA calendar, analyst ratings, insider + crypto, 0DTE/weekly charts); /followtheflow + /configure auto-posting of flow, OI changes, halts, congress trades, news, top contracts; custom alerts pushed into servers (Oct 2025). **Telegram bot** also listed. **Rating: differentiator** — deepest Discord distribution in the category.

**API** (verified pricing 2026-07-06, sale prices in parens): Trial $50/wk with a first-week-free promo, 30k req/day, 90-day lookback; **Basic $150/mo ($113, $1,350/yr)** 40k/day monthly, 80k/day annual, 2-yr lookback; **Advanced $375/mo ($284, $3,402/yr)** 100k/day monthly, 160k/day annual; **Startup $625/mo**, **Startup+Kafka $2,500/mo**; Professional/Enterprise custom (160k/day REST, commercial use, Kafka, custom S3 pipeline, redistribution licensing, delayed-data option); enterprise 'start building' $750/mo. Personal-use-only below Professional. WebSockets on all paid API tiers (incl. a custom-alerts channel); premium endpoints for forex, commodities, econ indicators, crypto, IPOs, fundamentals. **MCP server** (Mar 2026) + published skill.md for AI agents. **Rating: major differentiator** — none of the retail flow competitors ship an API of this scope, let alone MCP/Kafka.

**Mobile:** iOS + Android, push notifications (incl. per-trade and preset alerts), flow presets + Super Flow windows (Feb 2026), Periscope, GEX charts, contract look-up, options chains, market tide + replay history, dark-pool levels, politician feed, 13F data, community chat, customizable menu, spark charts, iPad table view. Reviews still call feature parity 'limited' vs desktop. **Rating:** app existence = table-stakes; depth (Periscope/GEX on mobile) = mild differentiator.

### Pricing (verified live 2026-07-06)

**Platform tiers** (monthly list / July-4-sale effective / annual billed):
- **Retail Basic** — $50/mo; sale $38/mo, $454/yr. 25 custom alerts, 5 watchlists (50 items), 5 dashboards, 10 saved filters/feed, real-time flow, Nasdaq real-time equities, Greeks & volatility dashboards, historical feeds, insider/institutional data, politician trades, base Periscope, Mr. Whale (low usage), Unusual Predictions, daily option+DP downloads, Discord access/chat/bot commands.
- **Retail Pro** (MOST POPULAR) — $75/mo; sale $57/mo, $681/yr. Everything unlimited (alerts→100, watchlists/dashboards/filters unlimited), 10-minute Periscope, more Mr. Whale usage.
- **Retail Max** (NEW, ~mid-2026) — $120/mo; sale $92/mo, $1,102/yr. Everything in Pro + **1-minute Periscope**, 3x Mr. Whale usage.
- **Professional** — $200/mo; sale $153/mo, $1,836/yr. For SEC/FINRA/CFTC-registered persons; enterprise-grade support; 1-min Periscope; Mr. Whale 'coming soon'.
- **Free tier** — delayed/limited flow, delayed alerts.
- **Predictions (Polymarket screeners)** — $20/mo (sale $17, $184/yr) + free tier: insider/smart-money/whale tracking in prediction markets, smart score, unusual market scanner.
- **Platform+API Bundle** — includes Retail Max + API access (price behind tab).
- Annual saves up to 15%; no API access in platform plans; all sales final; Lifetime tier (legacy) gets flow downloads + API perks. Note: 2023–2025 era pricing was a single ~$48/mo tier + $10 add-ons — the 4-tier Basic/Pro/Max/Professional structure and bundled Periscope/AI is the 2026 repricing (roughly +50–150% ARPU move).

### Table-Stakes vs Differentiator Scorecard

| Feature | Rating |
|---|---|
| Live flow feed (full OPRA, NBBO-per-print, 15+ columns) | Table-stakes feed, differentiator-grade transparency/filters |
| Algorithmic unusual alerts | Table-stakes |
| Custom alert builder (flow+price+OI+news+filings) w/ Discord+WS delivery | **Differentiator** |
| Market Tide + Replay | **Differentiator** (category-defining) |
| Net flow / sector / 0DTE aggregations | Table-stakes-plus |
| Super Flow custom dashboards | **Differentiator** |
| Dark pool prints/feeds | Table-stakes; levels-on-chart a plus |
| GEX/DEX/Vanna/Charm per ticker | **Differentiator** |
| Periscope 1-min SPX MM positioning | **Strong differentiator** |
| OI-change feed + explorer | **Differentiator** |
| Historical contract search/charts | Table-stakes |
| Daily file downloads / Data Shop | **Differentiator** |
| Flow-signal backtesting | **Gap** (portfolio backtester only) |
| Charting w/ flow/GEX/DP studies | Table-stakes chart, differentiator studies |
| Options profit calculator (flow-linked) | Table-stakes |
| Congress/politician tracker | **Flagship differentiator** |
| Insider/13F/hedge-fund portfolios | Table-stakes-plus |
| News feed + calendars (FDA, econ, seasonality) | Table-stakes |
| Discord bot + auto-posting + Telegram | **Differentiator** |
| API + WebSocket + Kafka + MCP + skill.md | **Major differentiator** |
| Mobile apps (iOS/Android) | Table-stakes |
| Mr. Whale AI analyst + AI filter builder | Emerging **differentiator** (2026) |
| Prediction-market (Polymarket) screeners | Novel **differentiator** / optionality |
| Community (Discord, chat, Stock Talk) | Differentiator for retention |

### Sources & Caveats

**Primary (live-verified 2026-07-06):** [pricing page](https://unusualwhales.com/pricing) + [API tab](https://unusualwhales.com/pricing?product=api) + [Predictions tab](https://unusualwhales.com/pricing?product=predictions), [features page](https://unusualwhales.com/features), [full changelog](https://unusualwhales.com/changelog) (Jan 2023 → Jul 2, 2026), [flow-feed docs](https://docs.unusualwhales.com/features/2-options-flow/), [alerts docs](https://docs.unusualwhales.com/features/4-unusual-alerts/), [A-Z tools](https://docs.unusualwhales.com/features/3-subscription-tooling/), [Discord bot docs](https://docs.unusualwhales.com/features/4-discord-bot/), [skill.md / API surface](https://unusualwhales.com/skill.md), [Greek-exposure pages](https://unusualwhales.com/stock/SPY/greek-exposure), Periscope launch posts ([X](https://x.com/unusual_whales/status/1898846172456120341), [Threads](https://www.threads.com/@unusualwhales/post/DG3qNbwyUGJ/)).
**Secondary reviews (cross-checks):** [OptionsTradingIQ](https://optionstradingiq.com/unusual-whales-review/), [Tradewink](https://tradewink.com/learn/unusual-whales-review), [PurePowerPicks](https://purepowerpicks.com/unusual-whales-review/), [FindMyMoat](https://www.findmymoat.com/tools/unusual-whales), [BullishBears](https://bullishbears.com/unusual-whales-review/), [TraderHQ](https://traderhq.com/unusual-whales-review-options-trading-platform/), [Forbes](https://www.forbes.com/sites/investor-hub/article/what-is-unusual-whales/).
**Caveats:** (1) Third-party review pricing ($48/mo Standard, $110 Premium, etc.) is stale — the live 4-tier structure above supersedes it. (2) '50+ dark pool feeds' and 'rivals platforms 10x the cost' are review-marketing claims, not UW statements. (3) Discord-bot and Bundle tab card prices didn't render server-side; bot premium/server pricing unconfirmed this session. (4) UW publishes no millisecond latency SLA — 'real-time' is the only claim. (5) unusualwhales.com serves AI crawlers a minimal stub, so WebFetch alone under-reports their site; browser rendering was required. (6) Reminder from project memory: UCT has a partner-owned options-flow/dark-pool area (⛔ do-not-build zone) — this research is for competitive awareness, not a build directive.
