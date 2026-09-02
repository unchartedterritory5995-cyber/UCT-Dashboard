---
id: D-03
title: Provider inventory — dashboard repository
role: Existing Data/API Archaeologist (dashboard providers)
wave: 1
group: D
category: data-providers
scope: uct-dashboard worktree `C:\Users\Patrick\uct-worktrees\terminal-research` (api/, app/, services/, tools/, scripts/, docs/)
confidence: 🟡 medium-high overall (roster 🟢; per-provider live status 🟡; OBSERVED-CALLED 🔴 none reached)
evidence_ceiling: "No production logs, no Railway variable read, no provider calls permitted. Every status below tops out at CODE-REFERENCED plus in-repo dated CLAIMS. `docs/feature_flags.json` records which gates were set on Railway when it was last generated — that is configuration, not traffic. Five read-only admin endpoints (§2) would upgrade ~25 rows in one pass."
sources: .env.example, api/**, app/src/**, services/chart_renderer/, requirements.txt, railway.json, docs/feature_flags.json, docs/screener-finviz-id-map.md, docs/perf-baseline.md, docs/runbooks/*, CLAUDE.md
uct_relevance: high
status: draft
date: 2026-09-02
---

# D-03 — Provider inventory (dashboard repository)

**Read this first.** Everything below is derived by measurement over the worktree, not
retyped from `CLAUDE.md`. Where `CLAUDE.md` is cited it is labelled CLAIM. No provider
was called; no production endpoint was touched; no git command was run. `.env.example`
was the *starting* list only — the measured roster is **larger than `.env.example` and
larger than the repo's own "every external API key" list** (see §9.1).

Method: an AST/regex census of `os.environ.get|os.getenv|os.environ[...]` over
`api/`, `services/`, `scripts/`, `tools/` (**1,054 distinct environment variables**),
filtered to credential-shaped names; plus a census of every `http(s)://<host>` literal
in the same tree; plus `import.meta.env.*` over `app/src`.

---

## 0. Executive summary

**OBSERVATION.** The dashboard talks to **30 distinct external providers** across market
data, AI, media and infrastructure. Exactly **one** of them (Finnhub) has a process-wide
client with a rate budget; a second (AlphaVantage) copied that pattern in Aug-2026; a
third (yfinance) has a single hard chokepoint. **The other 27 have no abstraction at
all** — 66 modules, including three FastAPI *routers*, build vendor base URLs inline.
FMP, the single most-used provider (28 modules, 42 URL literals, ~45 distinct
endpoints), has **six independent `_fmp_get` implementations** and no shared budget.

**INTERPRETATION.** For Terminal-Next the load-bearing facts are: (a) **Massive.com is
the spine** — bars, quotes, movers, snapshots, options chain/Greeks, options flow (OPRA
WS), dark pool, splits/dividends, news, flat files — and it is Polygon.io-protocol
compatible (`api.massive.com`, `wss://socket.massive.com`, `files.massive.com`);
(b) **FMP Premium is the fundamentals/estimates/calendar spine** and carries three
measured, silent failure modes; (c) **Finnhub is a degraded legacy leg** with two
endpoints returning 403 on every call for months before anyone noticed; (d) three
providers are **KEY-PRESENT-only or retired** (Bullflow, Polygon direct, Unusual Whales
partially); (e) there is **no provider** for order book, corporate credit, FX/crypto
bars, whisper numbers, or consensus-revision timelines, and short interest is
single-sourced to a nightly Finviz export.

**CONFIDENCE.** 🟢 on the roster and call sites. 🟡 on "is it actually used in production
today" — see the EVIDENCE CEILING in frontmatter.

---

## 1. Provider roster (Q1)

Status vocabulary per the shared preamble. **KP** = KEY-PRESENT, **CR** =
CODE-REFERENCED, **OC** = OBSERVED-CALLED. **No provider below reaches OC from
repository evidence alone**; the strongest available in-repo evidence is a dated
live-probe note in a module docstring, which is a CLAIM about a past run, not a log line
(see §2).

### 1.1 Market data

| # | Provider | Category | Env var NAMES | Strongest call site (path:line, symbol) | Endpoints / SDK consumed | Data classes | Cadence + caching | Rate-limit handling | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Massive.com** (Polygon.io-compatible REST) | bars/quotes, snapshots, options, news, corporate actions | `MASSIVE_API_KEY`, `MASSIVE_SECRET_KEY` | `api/services/massive.py:76 _MassiveRestClient`; `_REST_BASE = "https://api.massive.com"` (`massive.py:19`) | `/v2/aggs/ticker/{sym}/range/...`, `/v2/aggs/grouped/locale/us/market/stocks/{d}`, `/v2/snapshot/locale/us/markets/stocks/{gainers\|losers\|tickers/{t}}`, `/v2/snapshot/locale/global/markets/{forex,crypto}/tickers/{s}`, `/v2/reference/news`, `/v3/reference/{tickers,splits,dividends,conditions,options/contracts}`, `/v3/snapshot/options/{underlying}[/{contract}]`, `/v3/snapshot/indices`, `/v3/trades`, `/v3/quotes` | daily/weekly/monthly + 1/5/15/30/60m bars, live quotes, movers, ETF snapshots, option chain + Greeks + IV + OI, option trades/quotes, index snapshots, splits, dividends, news + sentiment | 3-layer: TTLCache 5–15 min → SQLite `bars.db` → disk `/data/bars_cache` → REST delta → REST full (`api/services/bars_fetch.py:11-20`). Live prices 15 s (30 s mobile) on a shared per-ticker key `live_px1_{TK}` (`api/routers/live_prices.py`). Movers 30 s, snapshot 15 s | shared `httpx.Client`, connect 3 s / read 25 s, `max_connections=60` (`massive.py:66-72`); **no token bucket** | **CR** 🟢 |
| 2 | **Massive OPRA WebSocket** | options flow (tape) | `MASSIVE_WS_ENABLED`, `MASSIVE_WS_URL`, `MASSIVE_OPTIONS_WS_URL` | `api/massive_ws_worker.py:74` (`wss://socket.massive.com/options`) — **partner-owned**; `api/services/bar_stream.py:35` (`wss://socket.massive.com/stocks`) | Polygon-protocol WS: `T.*` trades, `AM.*` minute aggregates | live option prints; developing bars pushed to charts | continuous; per-(sym,tf) fan-out queue maxsize 64, drop-oldest (`bar_broadcaster`) | ~1 connection per key (CLAIM, `CLAUDE.md`); **no replay — every gap permanent until the T+1 flat file** | **CR** 🟢 · `MASSIVE_WS_ENABLED` recorded **armed** (`docs/feature_flags.json`) |
| 3 | **Massive flat files (S3)** | bulk historical trades/quotes | `MASSIVE_S3_ENDPOINT` (default `https://files.massive.com`), `MASSIVE_S3_BUCKET` (default `flatfiles`), `MASSIVE_S3_ACCESS_KEY`, `MASSIVE_S3_SECRET`; aliases `MASSIVE_ACCESS_KEY` / `MASSIVE_SECRET_KEY` | `api/massive_flatfiles_worker.py:49-50`; `api/darkpool_flatfile_ingest.py:58-61`; `api/services/breadth_wick_recon.py:143-145` | boto3 S3 GET | T+1 options tape, dark-pool prints, breadth wick reconciliation | `darkpool_flatfile_ingest` Mon–Sat 11:45 ET | boto3 client against a non-AWS S3 endpoint | **CR** 🟢 |
| 4 | **FMP (Financial Modeling Prep) Premium** | fundamentals, estimates, earnings, calendars, ownership, insiders, news, transcripts, ETF holdings, index constituents, intraday bars fallback | `FMP_API_KEY` | 28 modules; e.g. `api/services/earnings_estimates.py:344 _fmp_get`, `api/routers/earnings.py` (20 URL literals), `api/services/econ_calendar_fmp.py` | `stable/`: `earnings`, `earnings-calendar`, `historical-earning-calendar`, `earnings-surprises`, `profile`, `profile-bulk`, `quote`, `grades`, `grades-consensus`, `grades-historical`, `grades-news`, `grades-latest-news`, `analyst-estimates`, `price-target-consensus`, `price-target-summary`, `price-target-news`, `income-statement`, `ratios-ttm[-bulk]`, `ratios-bulk`, `key-metrics-ttm[-bulk]`, `shares-float`, `splits`, `ipos-calendar`, `economic-calendar`, `company-screener`, `etf/holdings`, `institutional-ownership/{symbol-ownership,symbol-positions-summary,extract-analytics/holder,latest}`, `insider-trading/search`, `news/{stock,general-latest,press-releases}`, `earning-call-transcript[-dates,-latest]`, `sp500-constituent`, `nasdaq-constituent`, `dowjones-constituent`, `historical-chart/{interval}` | EPS/revenue actual + estimate, analyst grades/PT, earnings + IPO + economic calendars, insider trades, institutional ownership, float, statements, transcripts, ETF holdings, index membership, intraday bars | per-surface TTLCache; earnings table 30 d for closed years; calendar day cache 24 h for past dates; `screener_snapshot_nightly` 03:00 ET; `screener_earnings_dates` 02:50 ET | **none shared** — six separate `_fmp_get`/`_fmp` helpers, each with its own timeout and error policy | **CR** 🟢 |
| 5 | **Finnhub** | earnings calendar, estimates, recommendations, profiles, insiders, transcript index, IPO calendar, realtime WS | `FINNHUB_API_KEY` | `api/services/finnhub_client.py:233 fh_get` — the ONE coordination point; WS `realtime_stream.py:24` (`wss://ws.finnhub.io`) | `/calendar/earnings`, `/calendar/ipo`, `/stock/earnings`, `/stock/recommendation`, `/stock/price-target`, `/stock/upgrade-downgrade`, `/stock/profile2`, `/stock/metric`, `/stock/insider-transactions`, `/stock/transcripts/list`, `/stock/transcripts` | earnings dates + session, consensus, PT, analyst actions, company profile + logo, insider transactions, transcript index, IPO calendar, tick trades | earnings intel 6 h/ticker; insider 4 h/ticker; profile 24 h disk (`/data/ticker_meta_cache`) | **token bucket + reactive cooldown + REST-over-WS priority reserve** (`finnhub_client.py:44-56`); 403 → endpoint cached forbidden 24 h (`:254`); 429 → `fh_note_429` shared cooldown | **CR** 🟢 (two endpoints permanently 403 — see §5) |
| 6 | **Finviz Elite** | screener universe, float/short/ownership, industry map, news export, chart images | `FINVIZ_API_KEY` (alias `FINVIZ_TOKEN` accepted **only** at `api/routers/calendar.py:733,2838`) | `api/services/screener/finviz_universe.py:300`; `api/services/industry_map.py:103`; `api/services/massive.py:1147`; `api/services/single_stock_etfs.py:59` | `https://elite.finviz.com/export.ashx?v=152&c=<ids>&auth=…`, `news_export.ashx`, `chart.ashx` | shares outstanding/float, insider + institutional ownership, short float, short ratio, sector/industry, earnings-date column, news, static chart PNGs | one whole-market export nightly **02:45 ET** (`screener_finviz_universe`); never on a request path (90 s-class fetch) | 90 s timeout, follow-redirects, browser UA; **no retry, no budget** | **CR** 🟢 |
| 7 | **yfinance / Yahoo Finance** | bars fallback, index/futures/crypto snapshots, dividends calendar, options chain (legacy), `.info` fundamentals | *(none — unauthenticated)*; guard knobs only | `api/services/yf_util.py bounded_call` — THE chokepoint; `api/services/bars_fetch.py:1095 _fetch_intraday_yfinance`; direct `query1/query2.finance.yahoo.com` in `api/schwab_router.py`, `api/schwab_service.py`, `api/massive_ws_worker.py` (partner-owned) | `yfinance` package; `/v8/finance/chart/{sym}`, `/v7/finance/quote`, `/v1/test/getcrumb` | intraday + daily bars fallback, pre-2003 IPO tail for D/W/M, `^GSPC/^NDX/^DJI/^RUT/^VIX`, BTC/futures, dividends + splits | on demand behind the bars cache hierarchy | **one pool, one deadline, one circuit breaker** (`yf_util.py:1-30`); `YFRateLimitError` trips a breaker returning defaults **without network and without logging**; AST census rail `tests/test_yf_guard_census.py` fails by file:line on any un-guarded reach | **CR** 🟢 |
| 8 | **AlphaVantage** | news + sentiment (legacy), verbatim earnings-call transcripts | `ALPHAVANTAGE_API_KEY`, `CATALYST_AV_NEWS_KEY` | `api/services/alphavantage_client.py av_get`; `api/services/av_transcripts.py` | `query?function=NEWS_SENTIMENT`, `query?function=EARNINGS_CALL_TRANSCRIPT` | market news + sentiment; verbatim transcripts | news 1800 s when AV works / 600 s on RSS fallback; transcripts 24 h per (ticker, quarter), ≤4 candidate probes | **daily token bucket, 25 req/DAY, ET-midnight reset, never sleeps** (`alphavantage_client.py:8-48`); throttle response short-cached 5 min | **CR** 🟡 — `CATALYST_AV_NEWS_ENABLED` recorded **pending, set on no service** |
| 9 | **CFTC (public)** | futures positioning (COT) | *(none)* | `api/services/cot_service.py` → `https://www.cftc.gov/files/dea/history/deacot{YEAR}.zip` | public ZIP download | Commitments of Traders, 62 symbols, 10 y history | Fri 15:50 ET + retries 16:15 / 16:45 + daily 18:00 catch-up + request-driven self-heal | none needed | **CR** 🟢 |
| 10 | **SEC EDGAR (public)** | filings | *(none — UA required)* | `api/services/sec_filings.py:22-25`; `api/services/edgar.py` | `www.sec.gov/files/company_tickers.json`, `data.sec.gov/submissions/CIK{cik}.json`, `efts.sec.gov/LATEST/search-index`, 8-K RSS | 10-K / 10-Q / 8-K / S-1 / DEF 14A, full-text search | CIK map cached daily; filings TTLCache | UA header identifying the requester (SEC mandate) | **CR** 🟢 |
| 11 | **FRED (St. Louis Fed)** | economic series | `FRED_API_KEY` | `api/services/fred_economic.py:105` → `https://api.stlouisfed.org/fred/series/observations` | series observations | yields, spreads, Fed policy, CPI, unemployment (named catalog) | 30 min TTLCache | none | **CR** 🟡 — reachable only via voice tool `get_series` (`voice_tool_impls.py:442,453`) and the risk-free rate in `options_chain.py:32` |
| 12 | **ForexFactory / faireconomy** | economic calendar (current week) | *(none)* | `api/routers/calendar.py:2230-2231` | `nfs.faireconomy.media/ff_calendar_thisweek.json` + `…_nextweek.json` | econ event overlay | calendar cache | none | **CR** 🔴 **DEGRADED — `ff_calendar_nextweek.json` 404s**, verified against prod 2026-07-30 (`api/services/econ_calendar_fmp.py:1-8`); FMP `stable/economic-calendar` is the replacement for non-current weeks |
| 13 | **EarningsWhispers** | forward earnings schedule + BMO/AMC + anticipation rank | *(none — scraped)* | `api/services/engine.py` → `www.earningswhispers.com` | scrape | forward earnings schedule, session, ordering rank | wire push + live build | none | **CR** 🟡 |
| 14 | **openinsider.com** | insider clusters | *(none)* | `api/services/insider_clusters.py` | scrape | clustered insider buying | TTLCache | none | **CR** 🟡 |
| 15 | **Stocktwits (public)** | social sentiment | *(none)* | `api/services/stocktwits_sentiment.py:21` → `api.stocktwits.com/api/2` | `/streams/symbol/{T}.json` | user-tagged bull/bear ratio + messages | 5 min TTLCache | 200 req/hr per IP unauthenticated; **403s on the default python UA**, so a browser UA is hardcoded | **CR** 🟡 — voice tool only (`voice_agents.py:396`) |
| 16 | **Reddit (PRAW)** | social sentiment | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | `api/services/reddit_sentiment.py:38-39`; `praw>=7.7.0` | PRAW search across r/wallstreetbets, stocks, options, investing, thetagang | 24 h mention counts + bull/bear language score | 10 min TTLCache | graceful "not configured" when creds absent | **CR** 🟡 — voice tool only (`voice_agents.py:395`) |
| 17 | **TwitterAPI.io** | curated trader / news feed | `TWITTERAPI_IO_API_KEY`, `TWITTERAPI_IO_ENABLED`, `TWITTERAPI_IO_BASE_URL` | `api/services/twitterapi_io.py:55` → `api.twitterapi.io` | account timelines + `advanced_search` | breaking cashtag tweets, catalyst signals | burst `*/2` pre/post-market, `*/15` midday, hourly safety net, 03:00 ET cleanup (7 `tweet_poll_*` jobs) | `since_id` pagination bounds billable count; structured `TwitterApiAuthError` / `PaymentRequired` / `RateLimited` / `TransientError` | **CR** 🟢 · `TWITTERAPI_IO_ENABLED` recorded **armed** |
| 18 | **Perplexity (Sonar)** | web / finance research | `PERPLEXITY_API_KEY` | `api/services/perplexity_search.py:321` → `api.perplexity.ai` | chat completions; models `sonar`, `sonar-pro`, `sonar-reasoning-pro`, `sonar-deep-research` | catalyst discovery, AI Search web answers, earnings deep-dive, sector framing | per-surface caches; catalyst engine ~10–15 queries/refresh (CLAIM, `CLAUDE.md`) | **401/403 → `_notify_auth_failure` pages the admin Discord** with an hourly memo (`perplexity_search.py:165-185`) | **CR** 🟢 |
| 19 | **TheFly** | analyst squawk wire | `THEFLY_API_KEY`, `THEFLY_BASE_URL` (default `https://api.thefly.com/v1`) | `api/services/thefly_news.py:28,58`; also read from `catalyst/analyst_actions.py:80` | generic REST squawk shape | analyst calls, syndicate pricings, M&A flashes, hot-mover alerts | 5 min TTLCache | absent key → empty, never raises | **KP/CR** 🔴 — the module's own docstring says *"The API surface varies by subscription tier — this wrapper hits a generic REST shape"*: the endpoint shape is **assumed, not verified** |
| 20 | **Unusual Whales** | option contract history + live flow alerts | `UW_API_KEY` | `api/uw_service.py:31-38`; `api/uw_live_flow.py:38` | `/api/option-contract/{occ}/historic`, `/…/intraday`, `/api/stock/{t}/option-contracts`, flow-alerts | per-contract OI/vol/price history, live flow alerts | n/a | `Authorization: Bearer` + `UW-CLIENT-API-ID` header | **KP/CR** 🟡 — `uw_service` imported **only** from partner-owned `api/schwab_router.py:144,844`; `uw_live_flow` has **zero importers** ⇒ dormant. See §3.3 |
| 21 | **Polygon.io (direct)** | option contract daily aggregates backfill | `POLYGON_API_KEY` | `api/daily_tracker.py:332` → `api.polygon.io/v2/aggs/ticker/{occ}/range/1/day/...` | one endpoint | option daily volume + close backfill | on-demand backfill only | free-tier note in docstring (15-min delayed, 5 calls/min) | **KP-only** 🟡 — **same vendor family as Massive**; see §3.2 |
| 22 | **Bullflow** | live options flow (pre-Massive) | `BULLFLOW_API_KEY` | `api/liveflow_worker.py:89`; SSE `api.bullflow.io` | SSE alert stream | live flow alerts | — | terminal auth statuses raise `LiveflowAuthError` (`liveflow_worker.py:2938-2947`) | **RETIRED 2026-08-29** 🟢 — see §3.1 |
| 23 | **Schwab** | broker market data / option chains | `SCHWAB_APP_KEY`, `SCHWAB_APP_SECRET`, `SCHWAB_CALLBACK_URL`, `SCHWAB_TOKEN_JSON`, `SCHWAB_TOKEN_PATH` | `api/schwab_service.py:22-37` → `api.schwabapi.com`; `api/gex_service.py` | OAuth + quotes / chains | option chains for GEX, quotes | — | — | **CR** 🟡 — **PARTNER-OWNED**; noted for existence and mounting only (`api/main.py:7038 app.include_router(schwab_router)`) |
| 24 | **SnapTrade** | brokerage aggregation (30+ brokers) | `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`, `SNAPTRADE_WEBHOOK_SECRET`, `BROKER_ENCRYPTION_KEY`, `BROKER_SYNC_ENABLED` | `api/services/journal_two/broker/snaptrade_client.py:102`; SDK `snaptrade-python-sdk>=11.0.0,<12` | SDK (sync, via `asyncio.to_thread`) | positions, activities, balances, option holdings | 20-min incremental + 02:30 ET nightly reconcile; `broker_recent_orders_poll` 5 min | **partner-wide async token bucket** (`broker/rate_limit.py:1-24`) + contractual ≤1 poll/5 min/account | **CR** 🟢 · `BROKER_SYNC_ENABLED` recorded **armed** |

### 1.2 AI / LLM (Q4)

| Provider | Env vars | Models measured in code | Lanes (module → surface) | Batch / caching flags |
|---|---|---|---|---|
| **Anthropic** | `ANTHROPIC_API_KEY` (22 read sites) | `claude-opus-5` ×9, `claude-opus-4-8` ×16, `claude-opus-4-7` ×4, `claude-sonnet-5` ×15, `claude-sonnet-4-6` ×22, `claude-haiku-4-5` ×10 | **53 modules.** Named lanes: **AI Search** (`routers/ai_search.py`, `ai_search_{agent,deep,dossier,personal}.py`) · **Compass coach** (`journal_two/coach*.py`, `pre_trade_verdict.py`, `trade_review.py`) · **Catalysts** (`catalyst/{synthesize,curator,hunter,rule_learner}.py`) · **Desk** (`desk_creative.py`, `desk_session_{insights,recap}.py`) · **Calendar/earnings** (`call_recap*.py`, `earnings_enrichment.py`, `earnings_preview_warm.py`, `transcripts.py`, `company_about.py`) · **COT** (`cot_narrative.py`) · **Themes** (`theme_engine/{orphans,improve}.py`) · **Model Book** (`routers/modelbook.py`) · **Community** (`community_ask.py`) · **Indicators** (`indicator_from_image.py`, `pattern_vision/*`) · **Voice** (`voice_deep_research.py`) | `LLM_BATCH_ENABLED` default **"1"** (`api/services/llm_batch.py:52`), `LLM_BATCH_MAX_AGE_HOURS` 24, `LLM_BATCH_LEDGER_PATH`. Shared client `timeout=60` (`engine.py:72 _get_anthropic_client`); `desk_session_insights` overrides via `DESK_CHAPTERS_LLM_TIMEOUT_SECS` default 300. SDK pinned `anthropic>=0.49.0,<1` — 1.0.0 dropped `temperature=` and 10 call sites pass it. |
| **OpenAI** | `OPENAI_API_KEY` | `whisper-1`, `gpt-4o-mini`, `gpt-4o`, `gpt-realtime`, `gpt-image-1`, `text-embedding-3-small` | Voice + one image lane only: `voice_openai.py` (Whisper `/api/voice/transcribe`, TTS, Realtime `/v1/realtime/{sessions,client_secrets}`, `cleanup_transcript` on gpt-4o-mini), `voice_prewarm.py`, `voice_embeddings_service.py:25`, `brain_kb_service.py:23` (KB semantic index), `ai_search_memory.py:162`, `desk_creative.py:727` (gpt-image-1 covers) | none |
| **Perplexity** | `PERPLEXITY_API_KEY` | `sonar`, `sonar-pro`, `sonar-reasoning-pro`, `sonar-deep-research` | `perplexity_search.py` → AI Search; `catalyst/{sources,engine}.py` (discovery A1 always-on, D1 pre-market, F1 evening; per-candidate fallback / earnings / top-3 / sector enrichment); morning-wire enrichment shares the same key | `CATALYST_PERPLEXITY_ENABLED` default **"1"** (`catalyst/engine.py:40`); `CATALYST_TWITTER_SEARCH_ENABLED` default **"1"** (`:767`) |

**`DEEP_RESEARCH_MODEL`** is read in exactly **one** place: `api/services/voice_deep_research.py:35`, default `claude-sonnet-4-6`. It is *listed* in `api/routers/admin_api_health.py:24` but is **not** a global model selector. Every other lane has its own: `MODELBOOK_LLM_MODEL`, `COT_NARRATIVE_MODEL` (default `claude-opus-5`), `DESK_CREATIVE_MODEL` (default `claude-opus-5`), `AI_SEARCH_DEEP_MODEL`, `AI_SEARCH_DEEP_PLAN_MODEL`, `AI_SEARCH_AGENT_MODEL`, `AI_SEARCH_DOSSIER_MODEL`, `AI_SEARCH_DEGRADED_MODEL`, `NEWS_LLM_MODEL`, `ABOUT_BRIEF_MODEL`, `CATALYST_OPUS_MODEL`, `CATALYST_HAIKU_FALLBACK_MODEL`.

**RELEVANCE TO UCT.** Terminal-Next inherits ~15 independent model-selection variables; a model migration is 15 edits. A single model-registry indirection makes it one. **CONFIDENCE** 🟢. **OPEN QUESTION.** Which lanes are cost-capped and which are not? Caps found: `CATALYST_COST_CAP_DAILY` 8.00 / `CATALYST_COST_HARD_CAP` 15.00, `AI_SEARCH_{AGENT,DEEP,BRIEF,DOSSIER}_COST_CAP_DAILY`, `COT_NARRATIVE_DAILY_CAP` 300/UTC-day, theme-engine $5/ET-day. Desk, Compass and Model Book lanes have cost guards (`compass_cost_guard.py`, `narrative_cost_guard.py`) but no ledgered daily ceiling I could confirm.

### 1.3 Media / content

| Provider | Env vars | Call site | Purpose |
|---|---|---|---|
| **Zoom** | `ZOOM_S2S_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, `ZOOM_S2S_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN` | `api/services/zoom_client.py:14-16` → `api.zoom.us`; webhook `api/routers/desk_zoom_webhook.py:13` | Desk session recording download + cloud-copy delete |
| **YouTube Data API** | `YT_OAUTH_CLIENT_ID`, `YT_OAUTH_CLIENT_SECRET`, `YT_OAUTH_REFRESH_TOKEN` | `api/services/youtube_client.py:58-60` → `www.googleapis.com` (`/v3/videos`, `/v3/thumbnails/set`, `/v3/liveBroadcasts`), `oauth2.googleapis.com` | Desk session upload + branded thumbnail |
| **EarningsCall.biz** | `EARNINGS_AUDIO_API_KEY` | `api/services/earningscall_timed.py:63` → `v2.api.earningscall.biz`; imported from `api/routers/earnings_intel.py:380,413` | timed transcripts (word start-times) + call audio |
| **EarningsAPI / Quartr** | `EARNINGS_AUDIO_PROVIDER` (`none`\|`earningsapi`\|`earningscall`\|`quartr`, default **`none`**), `EARNINGS_AUDIO_API_KEY` | `api/services/earnings_audio.py:24,43` | pluggable adapter. **EarningsAPI paths carry `TODO: Confirm exact path once subscribed`; Quartr is a stub.** |
| **logo.dev / Clearbit / Parqet** | `LOGODEV_TOKEN` — a hardcoded *publishable* `pk_` default exists at `api/services/ticker_logos.py:229` (value not reproduced here; logo.dev documents this class of key as safe to embed) | `ticker_logos.py:233` (logo.dev by ticker), `:277` (logo.dev by domain), `:297` (Clearbit autocomplete → domain), `:270,:317` (Clearbit logo), Parqet, FMP `stable/profile`, Finnhub `/stock/profile2` | company logos, proxied and cached to `/data/logo_cache/{SYM}.png`; `logo_miss_retry` job 03:25 ET |
| **Discord** | `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHART_{APP_ID,BOT_TOKEN,GUILD_ID,PUBLIC_KEY}`, plus **17 webhook-URL vars** (`DISCORD_WEBHOOK_URL`, `DISCORD_WEBHOOK`, `DISCORD_ADMIN_WEBHOOK`, `DISCORD_ALERT_WEBHOOK`, `DISCORD_TSDR_WEBHOOK_URL`, `DISCORD_FLOW_WEBHOOK_URL`, `DISCORD_LIVE_FLOW_WEBHOOK_URL`, `DISCORD_MASSIVE_WEBHOOK_URL`, `DISCORD_NOTABLE_WEBHOOK_URL`, `DISCORD_RECAP_WEBHOOK_URL`, `DISCORD_EVENT_CALENDAR_WEBHOOK_URL` + `_TEST_`, `BUZZ_DIGEST_WEBHOOK`, `LIVEFLOW_ALERT_WEBHOOK_URL`, `WEEKLY_FLOW_WEBHOOK_URL`, `STANDING_FLOW_WEBHOOK_URL`, `ALPHA_GOLD_EOD_WEBHOOK_URL`, `DARKPOOL_EOD_WEBHOOK_URL`, `OI_MORNING_WEBHOOK_URL`, `COT_WEEKLY_DISCORD_WEBHOOK_URL`) | `api/services/buzz_ingest.py:26-28` (`discord.com/api/v10`, `GET /channels/{id}/messages`, measured bucket limit 5 req/s); `api/routers/discord_interactions.py` | alert fan-out, community message ingest, slash-command interactions |
| **Substack (public)** | *(none)* | `api/services/substack_poller.py` → `pub.substack.com` | own-publication poll (`substack_poll_hourly` :07, Sunday burst) |

### 1.4 Note-sync connectors (Journal 2.0)

| Provider | Env vars | Module | Host |
|---|---|---|---|
| Notion | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_VERSION` | `note_connectors/providers/notion.py` | `api.notion.com` |
| Dropbox | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` | `providers/dropbox.py` | `api.dropboxapi.com`, `content.dropboxapi.com` |
| Microsoft Graph (OneNote + OneDrive) | `MSGRAPH_CLIENT_ID`, `MSGRAPH_CLIENT_SECRET`, `MSGRAPH_{AUTHORIZE,TOKEN}_URL`, `MSGRAPH_HTTP_TIMEOUT_SECONDS`, `MSGRAPH_ONENOTE_{PAGES,MAX_REQUESTS}_PER_TICK`, `MSGRAPH_ONEDRIVE_PAGES_PER_TICK`, `MSGRAPH_WHOLE_ACCOUNT_PROVIDERS` | `providers/{msgraph_base,onenote,onedrive}.py` | `graph.microsoft.com`, `login.microsoftonline.com` |
| Roam Research | graph token (DB-stored per connector) | `providers/roam.py` | `api.roamresearch.com` |
| Craft | graph token; `CRAFT_REGISTRY` | `providers/craft.py` | `connect.craft.do` |

All five are double-gated: `NOTE_SYNC_ENABLED` (recorded **armed**) **AND** per-provider config checked in-endpoint (`api/routers/note_sync.py`). Jobs: `note_sync_due` hourly at :23, `note_sync_full_nightly` 01:47 ET. **CONFIDENCE** 🟢 for wiring; 🔴 for whether any member has connected one.

### 1.5 Infrastructure (Q6)

| Provider | Env vars | Call site | Notes |
|---|---|---|---|
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_ANNUAL`, `STRIPE_WEBHOOK_SECRET` | `api/services/stripe_service.py:18-26` — *"All Stripe interactions isolated here. Nothing else in the codebase touches Stripe."* **The only true provider abstraction in the repo.** | pinned `stripe>=8.0.0,<16`; the pin comment records it had already silently crossed 8→15.3.1 in production before anyone audited |
| **Resend** | `RESEND_API_KEY`, `FROM_EMAIL` | `api/services/email_service.py:20-30` | the SDK wraps `requests` **with no timeout**, so sends run in a 4-worker pool with a 10 s join (`_SEND_POOL`, `_SEND_TIMEOUT_S`) |
| **Sentry** | `SENTRY_DSN` | `api/main.py:148,195-200` | `traces_sample_rate=0.1`, environment from `RAILWAY_ENVIRONMENT`; `sentry-sdk[fastapi]==2.23.1` |
| **Cloudflare R2** | `DATA_SYNC_ENDPOINT_URL`, `DATA_SYNC_ACCESS_KEY`, `DATA_SYNC_SECRET_KEY`, `DATA_SYNC_BUCKET`, `DATA_SYNC_REGION`, `SNAPSHOT_INTERVAL_SECONDS`, `SNAPSHOT_INCLUDE_CACHE`, `SNAPSHOT_DELTA_ENABLED`, `DELTA_WINDOW_{INTRADAY,DAILY,SLOW}_DAYS`, `DELTA_KEEP` | `api/services/data_sync.py:170`, `api/flow_backup.py:75-89`, `api/j2_attachments_backup.py:89-103`, `api/services/brain_sync.py:60`, `api/services/breadth_ohlc_sync.py:59` | **R2 rejects boto3's default CRC32 integrity checksums** ⇒ `request_checksum_calculation="when_required"` + `response_checksum_validation="when_required"`, guarded for botocore <1.36 (`flow_backup.py:85-89`). Region forced `us-east-1`. Same bucket carries the bars snapshots **and** `brain/latest.txt` + `brain/<ts>.tar.gz`. |
| **Railway** | `RAILWAY_ENVIRONMENT`, `RAILWAY_VOLUME_MOUNT_PATH`, `RAILWAY_SERVICE_NAME`, `RAILWAY_REPLICA_ID`, `RAILWAY_DEPLOYMENT_ID`, `RAILWAY_GIT_COMMIT[_SHA]`, `RAILWAY_CACHE`; service selectors `WORKER_ENABLED`, `FLOW_WORKER_ENABLED`, `BARS_API_ENABLED`; `WORKER_INTERNAL_URL`, `KEEPWARM_URL` | `railway.json` `startCommand` branches on the three worker flags; `healthcheckPath: /api/health`, `healthcheckTimeout: 600`, `drainingSeconds: 30`, `--timeout-graceful-shutdown 5` | **one `railway.json` shared by every service** — `watchPatterns` must be set per-service in the dashboard, never in this file |
| **chart-renderer (self-hosted)** | `CHART_RENDERER_SECRET`, `CHART_RENDERER_URL`, `CHART_RENDER_BASE_URL`, `RENDER_ALLOWED_HOSTS` | `services/chart_renderer/app.py` — FastAPI + `playwright==1.47.0` headless Chromium | screenshots the dashboard's own `/r/*` pages because `web` has no browser; every call needs `X-Render-Secret`; returns `X-Chart-Ready` / `X-Chart-Probe` so the caller judges the render by what the page says it drew, not by pixel variance |
| **Webshare proxy / YT proxy** | `WEBSHARE_PROXY_PASSWORD`, `YT_PROXY_URL` | `scripts/backfill_video_insights.py:55,59` | **script-only** — not reached by the served app. A residential-proxy vendor not otherwise in the ledger. |
| **Buffer** | — | — | **NOT PRESENT in this repository.** (Buffer belongs to the clip-factory work in another repo — D-14's scope.) |
| **Vercel** | — | — | **NOT PRESENT.** Zero `VERCEL*` references in `api/`. `.env.example`'s `VERCEL_TOKEN` note in `CLAUDE.md` is legacy (CLAIM). |

---

## 2. Status evidence (Q2) — and why nothing reaches OBSERVED-CALLED

**OBSERVATION.** This repository contains no production log, no deploy log, no monitor
report, and no dated JSON fact-file recording provider responses.
`docs/perf-baseline.md` is dated **2026-05-02** (four months old) and measures latency
and bundle size, not provider calls. The JSON under `api/data/` is static universes
(`cap_universe.json`, `delisted_tickers*.json`, `prebuilt_lists.json`,
`buzz_collisions.json`), not captures.

**EVIDENCE.** Directory listings of `docs/`, `docs/runbooks/`, `docs/operations/`,
`docs/decisions/`, `api/data/`, and a `find app/src -name '*.json'` sweep.

**INTERPRETATION.** **Every provider in §1 therefore stays at CODE-REFERENCED.** Three
evidence classes sit *above* a bare code reference without reaching OBSERVED-CALLED, and
the gate-item-4 ledger should record which one each provider has.

**Class 1 — Railway-configuration evidence.** `docs/feature_flags.json` (104 gates). Its
own `_readme` defines `armed` as *"set on at least one Railway service (its value is the
decision)"* — i.e. it was generated by reading Railway. Provider-touching gates recorded
**armed**: `MASSIVE_WS_ENABLED`, `MASSIVE_STREAM_ENABLED`, `MASSIVE_CURATED_STREAM_ENABLED`,
`MASSIVE_RESTHEAL_ENABLED`, `OI_MASSIVE_ENABLED`, `STREAM_BARS_ENABLED`,
`BARS_PREWARM_ENABLED`, `BARS_UNIVERSE_CRAWLER_ENABLED`, `SNAPSHOT_DELTA_ENABLED`,
`TWITTERAPI_IO_ENABLED`, `BROKER_SYNC_ENABLED`, `NOTE_SYNC_ENABLED`,
`CATALYST_ENGINE_ENABLED` (+ `_HUNTER_`, `_CURATOR_`, `_DIGEST_`, `_RATINGS_SIGNAL_`,
`_MUSTKNOW_ALERTS_`), `DARKPOOL_{MASSIVE_INGEST,FLATFILE,INTRADAY,INTRADAY_TIERED,BIGBLOCK,EOD,RECORDS}_ENABLED`,
`FUNDAMENTALS_{MONITOR,WARM}_ENABLED`, `PROVIDER_COVERAGE_MONITOR_ENABLED`,
`SCREENER_{ANALYST_PASS,LIVE_TIER}_ENABLED`, `SCAN_SWEEP_ENABLED`, `THEME_ENGINE_ENABLED`,
`DESK_DAILY_SESSION_ENABLED`, `DESK_SESSION_CHAPTERS_ENABLED`, `TRANSCRIPT_INDEX_ENABLED`,
`IMPLIED_STORE_ENABLED`, `WIRE_ENABLED`, `WORKER_ENABLED`, `FLOW_READS_PROXY_ENABLED`.
The file's own warning — *"This file records INTENT. It cannot see Railway, so it can
drift from reality: run `tools/flag_ledger_audit.py`"* — keeps this a **CLAIM**.
Provider-touching gates recorded **pending, set on no service**: `CATALYST_AV_NEWS_ENABLED`,
`FMP_BULK_ENABLED`, `FLOW_REST_BACKFILL_ENABLED`, `FLOW_PRUNE_ENABLED`, `OI_MORNING_ENABLED`,
`EARNINGS_PREWARM_ENABLED`, `DEEP_CACHE_ENABLED`, `STANDING_FLOW_ENABLED`,
`SCAN_LIVE_SWEEP_ENABLED`, `SCREEN_BACKTEST_ENABLED`.

**Class 2 — dated live-probe notes in module docstrings.** The strongest
provider-liveness evidence the repository contains, and for the August set it is within
30 days of today:

| Date | Provider | Note | Path |
|---|---|---|---|
| 2026-08-22/23 | Finviz Elite | *"measured LIVE against elite.finviz.com"*; full 125–153 and 71–94 id walks | `docs/screener-finviz-id-map.md:1`; `screener/finviz_universe.py:58,114` |
| 2026-08-29 | Massive flat files | arrival window *"verified 2026-08-29 — absent at 01:00 ET, present by ~12:15 ET"* | `massive_flatfiles_worker.py:641` |
| 2026-08-24 | Massive OI | *"VERIFIED 2026-08-24: our latest snap for PFE 27P 9/18 = 53,028"* | `oi_massive_snapshots.py:4` |
| 2026-08-21 | Massive quotes | *"verified live 2026-08-21; overnight the quote side is zeroed"* | `massive.py:860` |
| 2026-08-17 | EW vs FMP calendar | *"measured on the live week of 2026-08-17"* | `routers/calendar.py:1176` |
| 2026-08-06/08 | FMP earnings | *"verified live 2026-08-06 across four fiscal shapes"*; *"Re-measured over 180 joins across 15 tickers (2026-08-08)"* | `earnings_history_fmp.py:49,83` |
| 2026-08-06 | FMP growth | *"Sampled live 2026-08-06 across 40 liquid names, 8 (20%) had no…"* | `earnings_growth_fmp.py:7` |
| 2026-08-05 | Finnhub | *"Verified live 2026-08-05 against stable/quote"*; IPO calendar *"Live-probed 2026-08-05"* | `routers/fundamentals.py:285`; `ipo_calendar.py:8,108` |
| 2026-08-05 | FMP insiders | *"probed 2026-08-05, 500 market-wide rows"* | `insider.py:19` |
| 2026-07-30 | ForexFactory | `ff_calendar_nextweek.json` 404 *"verified against prod 2026-07-30"* | `econ_calendar_fmp.py:4-7` |
| 2026-07-23 | Massive dark pool | *"VALIDATED 7/23/2026 against a BBS reference export (12 tickers)"* | `darkpool_massive_ingest.py:6-19` |

These are prose about a past run ⇒ **CLAIM**, not CONFIRMED.

**Class 3 — runtime status surfaces that produce nothing at rest.** The routes that
would convert this ledger in one read, all read-only:
`GET /api/admin/api-health` (`api/routers/admin_api_health.py` — boolean set/not-set per
key, never values), `GET /api/admin/provider-coverage`
(`api/routers/provider_coverage.py:17`, no auth), `GET /api/admin/fundamentals-health`,
`GET /api/admin/reconciliation-status`, `GET /api/admin/bars-stream-status`,
`GET /api/admin/twitter-stats`, `GET /api/admin/catalyst-stats`,
`GET /api/desk/sessions-status`, `GET /api/desk/session-audit`. **None was called — the
contract forbids production endpoints.**

**RECOMMENDATION.** Give the gate-item-4 ledger a fourth column, *evidence class*
(`code-only` / `config-recorded` / `dated-probe` / `live-read`), and one follow-up task:
with the owner present, read `/api/admin/api-health` + `/api/admin/provider-coverage`
once and stamp the ledger. That is a ~2-minute, zero-cost action converting ~25 rows.
**CONFIDENCE** 🟢 on the reasoning, 🔴 on any live status.
**OPEN QUESTION.** Is anyone in this program authorised to make that single read?

### 2.1 The one monitor that measures provider truth

**OBSERVATION.** `api/services/provider_coverage_monitor.py` is the only module that
measures **fill rate rather than HTTP status**, and its docstring records the incident
that created it.

**EVIDENCE.** `provider_coverage_monitor.py:8-18` (CLAIM, dated 2026-08-05):
> *"two Finnhub endpoints (`/stock/upgrade-downgrade`, `/stock/transcripts/list`) were
> found to have been returning HTTP 403 on EVERY call for months — 100% blank in
> production — discovered only because a human happened to look. The same night also
> turned up a 48h-cached blank Financials tab, a 7-day logo-miss retry job with no
> scheduler caller, and a nightly implied-move capture silently returning
> `{'captured': 0}`. Every one of those was a **200 response with an empty/null
> field**, which no uptime check or 'did the endpoint 200' probe would ever catch."*

Monitored fields and floors (`_FIELD_SPECS`, `:197-224`): `price_target` .80,
`consensus` .80, `beat_history` .85, `transcript` .70, `analyst_actions` .80,
`ticker_name` .95, `ticker_industry` .90, `calendar_hour_resolved` .60,
`calendar_forward_multisource` **1.0**, `enrichment_with_em` (drop-detection only),
`implied_fiscal_year` .90, `market_cap` .70, `avg_vol` .70. Cycle 3600 s, sample 25,
cold tail 6, startup delay 240 s. Defect kinds: `blank` (0 % with a non-empty sample),
`floor_breach`, `drop` (≥30 pp below its own median baseline **and** ≤half of it).
Self-heal is cache **invalidation only** — exact keys `earnings_intel_{SYM}`,
`tmeta_{SYM}`, `transcript_summary_{SYM}`, never a prefix sweep. Gated
`PROVIDER_COVERAGE_MONITOR_ENABLED` (**armed**), state persisted to
`{DATA_DIR}/provider_coverage.db`.

**INTERPRETATION.** Every provider integration in this repo returns `None`/`[]`/`{}` on
failure by design. That makes the whole surface **silently degradable** — a dead provider
looks exactly like a quiet market. This monitor covers **13 fields**; there are ~20 data
classes in §5.

**RELEVANCE TO UCT.** 🟢 high. Terminal-Next should treat fill-rate monitoring as a
platform requirement: every new provider lane ships with a field spec and a floor, or it
does not ship. **RECOMMENDATION.** Adopt `_FIELD_SPECS` as the ledger's "what we promise
to fill" contract and extend it to the uncovered classes (short interest, dark pool,
options chain, breadth). **OPEN QUESTION.** Does the monitor currently report green? NOT
DETERMINED — `GET /api/admin/provider-coverage` answers it.

---

## 3. Retired / dormant providers (Q3)

### 3.1 Bullflow — RETIRED; the key may still be set

**OBSERVATION.** The pre-Massive live-flow provider is **Bullflow** (`api.bullflow.io`,
SSE). It is retired in code and deliberately **not** gated on its key being absent.

**EVIDENCE — CONFIRMED by code, `api/main.py:3006-3038`:**
> *"⚰️ Live Flow (Bullflow) worker — RETIRED 2026-08-29. DO NOT RE-ENABLE. Bullflow is
> no longer used … Left running, it dialled a dead endpoint forever on the pod that
> serves every member, logging `403 API subscription inactive` every 30 s. That is not a
> lapsed account to renew; it is a retired integration with nobody on the other end.
> Both prior reads of it (including mine, twice) mistook the symptom for a billing
> problem, so the reason is written here rather than left to be re-derived from the log
> line. ⛔ NOT gated on `BULLFLOW_API_KEY` being unset. That works — `run_forever`
> early-returns without a key — but it makes a retired integration's silence depend on a
> Railway variable staying absent, and a variable that must stay unset is not a decision
> anyone can see in the code."*

The same comment states the two rails explicitly:
`DEAD: Bullflow SSE → liveflow_worker → /api/live/alerts/recent → LiveFlow.jsx` vs
`LIVE: Massive WS → massive_ws_worker → FlowDB → /api/live/massive/recent → LiveFlowMassive.jsx`.
Startup now only logs (`main.py:3035-3038`); `liveflow_worker.start()` is never called.

**`/live-flow` vs `/live-massive`.** The NAV entry labelled "Live Flow" points at
**`/live-massive`** (`CLAUDE.md` nav section, CLAIM — the route is what to trust, not the
label). `api/liveflow_router.py` is **still mounted** (`api/main.py:7109`), so
`/api/live/alerts/*` answers — with an empty buffer, because the producer never starts.
`api/liveflow_worker*.py` are kept as rollback backup (the `trades.py` retirement idiom);
full removal is flow-family work to coordinate with the partner.

**Status: KEY-PRESENT-only.** **CONFIDENCE** 🟢.
**RELEVANCE TO UCT.** This is the canonical shape for a "retired" ledger row: the code
says *why*, the key may linger, and a 403 from it must never be re-read as billing.
**RECOMMENDATION.** The provider ledger needs a **retired** section whose entries name
the replacement rail, not just a retirement date. **OPEN QUESTION.** Is
`BULLFLOW_API_KEY` still set on Railway, and is the subscription still being billed?

### 3.2 Polygon.io direct — KEY-PRESENT-only, and a duplicate-vendor trap

**OBSERVATION.** `POLYGON_API_KEY` is read in exactly **one** place
(`api/daily_tracker.py:332`) for option-contract daily aggregates — a data class Massive
already serves under `MASSIVE_API_KEY` **on the same Polygon protocol**.

**EVIDENCE.** `daily_tracker.py:319-346`. Meanwhile `api/services/polygon_options.py:1-11`
states *"Uses the existing MASSIVE_API_KEY (Polygon Advanced tier, $200/mo …)"* and
`polygon_extras.py`, `polygon_news.py`, `polygon_options.py` all set `_BASE =
"https://api.massive.com"` despite their names.

**INTERPRETATION.** A second credential for the same vendor family exists to serve one
backfill helper. **This is exactly the duplicate-vendor recommendation the contract asks
me to prevent.** **CONFIDENCE** 🟢.
**RECOMMENDATION.** Ledger it KEY-PRESENT-only with the note *"Polygon direct is the
same vendor family as Massive; never procure Polygon separately."* Also rename the three
`polygon_*.py` modules or add a header line — a module named `polygon_news` that calls
`api.massive.com` is the stale-name defect this repo repeatedly pays for.

### 3.3 Unusual Whales — partially dormant

**OBSERVATION.** Two UW modules exist. `api/uw_service.py` is imported **only** from the
partner-owned `api/schwab_router.py:144` (`get_batch_quotes`) and `:844` (`get_oi_change`).
`api/uw_live_flow.py` has **zero importers anywhere** — it is a BBS-CSV-shape adapter for
a flow pipeline Massive replaced.

**EVIDENCE.** Repo-wide grep for `uw_service|uw_live_flow` outside those files returns
only those two `schwab_router.py` lines.

**INTERPRETATION.** UW is CODE-REFERENCED through a partner-owned file (its live status
is the partner's to state) and its live-flow half is dormant.
**CONFIDENCE** 🟡 · **EVIDENCE CEILING:** whether `schwab_router`'s UW branches execute in
production is not determinable from the repo; a live read of the options-flow surface or
partner confirmation would settle it.
**OPEN QUESTION for owner/partner.** Is `UW_API_KEY` still on a paid plan, and is the UW
leg reached at all now that `/live-massive` is the live surface?

### 3.4 Other dormant-shaped entries

| Provider | Why it may be dormant | Evidence |
|---|---|---|
| **TheFly** | wrapper "hits a generic REST shape", explicitly no-ops without a key, endpoint shape never confirmed against a subscription | `thefly_news.py:1-15` |
| **EarningsAPI / Quartr** | adapter default is `"none"`; EarningsAPI paths carry `TODO: Confirm exact path once subscribed` | `earnings_audio.py:24,33-42` |
| **AlphaVantage news** | superseded by RSS + Massive news + Perplexity; `CATALYST_AV_NEWS_ENABLED` recorded **pending, "indistinguishable from forgotten"** | `docs/feature_flags.json`; `news_aggregator.py` |
| **FRED** | reachable only from a voice tool and an options risk-free-rate fallback; no page consumes it | `voice_tool_impls.py:442,453`; `options_chain.py:32` |
| **Reddit / Stocktwits** | voice-tool-only (`voice_agents.py:395-396`); no page surface found in `app/src` | grep of `app/src` |
| **`api/earnings_router.py`** (Finviz-scraping earnings) | present, **unmounted**, superseded by `schwab_router`'s `POST /api/schwab/earnings`; the sole live row in `CLAUDE.md`'s "DOCUMENTED BUT UNREACHABLE" table | absent from `api/main.py` include_router list |
| **`api/services/options_chain.py`** (yfinance + Black-Scholes) | superseded by `polygon_options.py` (native Greeks/IV from Massive) but both still exist | `options_chain.py:1-7`; `polygon_options.py:1-11` |

---

## 4. Browser-side keys (Q5)

**OBSERVATION.** Sixteen distinct `import.meta.env.*` reads exist in `app/src`. Only
**two** are credentials.

| Variable | Reads | Why it ships to the client | Risk posture |
|---|---|---|---|
| `VITE_PICOVOICE_ACCESS_KEY` | 1 — `app/src/hooks/useWakeWord.js:52` | Picovoice Porcupine runs the "Hey Compass" wake-word model **entirely in the browser** as base64 WASM; the access key is a client-side SDK key by design. Missing key ⇒ `console.warn` + wake word disabled, no crash (`:54`). | The `@picovoice/*` imports are **dynamic, and that is load-bearing** (`useWakeWord.js:17-18`) — the model is inlined as base64 WASM, so a static import would put it in the main bundle. Rail: `useWakeWord.lazy.test.js` walks the Rollup chunk graph and fails if any file statically imports picovoice. |
| `VITE_CHART_RENDER_TOKEN` | 14 — all `app/src/pages/*Render.jsx` (`BookRender`, `BreadthRender`, `BuzzRender`, `CalendarRender`, `CatalystsRender`, `ChartRender`, `EarnCardsRender`, `EarnResultsRender`, `EconRender`, `FlowRender`, …) | The `/r/*` headless-render pages are screenshotted in a **logged-out** browser, so the only gate is a shared token. | **`api/routers/render_panels.py:1-8` says it plainly: *"That token is inlined into the frontend JS bundle, so treat these as EFFECTIVELY PUBLIC: return only fields safe to expose … and rate-limit so they can't be abused to drive unbounded provider calls."*** Backend `_check_token` (`:60-65`) fails **closed** when unset and uses `hmac.compare_digest`, plus per-bucket rate limiting. |

Non-credential `VITE_*`: `VITE_REALTIME_BARS`, `VITE_MASSIVE_STREAM`,
`VITE_MASSIVE_CURATED_STREAM`, `VITE_GRID_WARM_ENABLED`, `VITE_TWITTER_UI_ENABLED`,
`VITE_CATALYST_UI_ENABLED`, `VITE_DESK_BG_AUDIO_ENABLED`, `VITE_COMING_SOON`,
`VITE_LAUNCH_DATE`, `VITE_DISCORD_CHART_APP_ID`, `VITE_WS_HOST` (dev-only, referenced in
`app/src/LiveFlow_integration_guide.jsx:127`).

**INTERPRETATION.** The browser credential surface is small and both entries are
deliberate. `CHART_RENDER_TOKEN`'s design — *a public token guarding a
deliberately-public-safe payload, rate-limited so it cannot become a provider-cost
amplifier* — is the right pattern.
**CONFIDENCE** 🟢.
**RECOMMENDATION.** Keep both, and add a rail that fails when a **new** `VITE_*` name
matches `/KEY|SECRET|TOKEN|PASSWORD/` without an entry in an explicit allowlist.
**OPEN QUESTION.** Does Terminal-Next intend to keep in-browser wake-word detection, or
move it server-side (which would retire the Picovoice dependency entirely)?

---

## 5. Data-class coverage table (Q7)

Rows = the classes a terminal needs. Everything is **CR** unless marked. "No provider"
is marked honestly.

| Data class | Provider(s) used today | Status | Evidence (path:line) | Known limits |
|---|---|---|---|---|
| **Quotes (live)** | Massive REST snapshot; Finnhub WS ticks | CR | `routers/live_prices.py`; `services/realtime_stream.py:24` | 15 s poll (30 s mobile); the Finnhub WS reconnect loop spends the **same 60/min account budget as REST** and must yield first (`finnhub_client.py:44-56`) |
| **Bars — intraday** | Massive → **FMP** → **yfinance** | CR | `bars_fetch.py:7`, `:902`, `:1044`, `:1095` | FMP returns **ET local text** and must be parsed as ET (a naive parse shifted every FMP-sourced bar by 4–5 h); Yahoo caps 1m=7 d, 5/15/30m=60 d, 60m=730 d (`bars_fetch.py:841`) |
| **Bars — daily / weekly / monthly** | Massive `get_agg_bars`; yfinance for the pre-2003 IPO tail and for `^GSPC/^NDX/^DJI/^RUT/^VIX` | CR | `bars_fetch.py:478`, `:861` | Massive/Polygon daily floor ≈2003; `BRK-B`→`BRK.B` applies **only** at the Massive REST boundary (`massive.py:40`) |
| **Options chain + Greeks + IV** | **Massive** `/v3/snapshot/options/*` primary; yfinance + Black-Scholes legacy | CR | `polygon_options.py:1-11`; `options_chain.py:1-7` | **two independent implementations of one data class coexist**; the yfinance path computes Greeks locally with a FRED-or-4.5 % risk-free rate |
| **Options flow (tape)** | Massive OPRA WS (partner-owned consumer) + T+1 flat files | CR, gate armed | `massive_ws_worker.py:74`; `massive_flatfiles_worker.py` | **OPRA does NOT replay — every feed gap is permanent until the T+1 flat file**; a flow-worker deploy costs a 15–60 s single-slot handoff |
| **Dark pool** | Massive trades tape, filtered client-side | CR, gates armed | `darkpool_massive_ingest.py:1-25` | off-exchange = exchange **4 AND 9** (4 alone reproduced only 88.3 % of the BBS reference; five of six misses incl. a 1 M-sh SPY block sat on exchange 9 — with both, 97.8 %); notional floor **$4.0 M**; window **07:00–19:00 ET, not RTH** (42.3 % of rows and 50.9 % of notional print at/after 16:00) |
| **Fundamentals / statements** | FMP `stable/{income-statement,ratios-ttm,key-metrics-ttm,profile,shares-float}`; Finnhub `/stock/metric` | CR | `routers/fundamentals.py:103,111`; `screener/fundamentals_bulk.py` | FMP legacy `api/v3/ratios-ttm/{sym}` → **403 "Legacy Endpoint … only available for"** (`fundamentals_bulk.py:27`); `avg_vol` is Finnhub-only (`routers/fundamentals.py:285`) |
| **Estimates / analyst actions** | FMP `stable/{analyst-estimates,grades,grades-consensus,grades-historical,price-target-*}`; Finnhub `/stock/recommendation`, `/stock/price-target` | CR ⚠️ | `catalyst/analyst_actions.py:19,96,194`; `earnings_estimates.py:145,224,235` | **Finnhub `/stock/upgrade-downgrade` returns 403 on every call on this plan** (2026-08-05), kept only because `fh_get` caches the 403 for 24 h and costs nothing once FMP succeeds; **Finnhub `/stock/price-target` also 403s plan-forbidden** |
| **Earnings calendar (forward)** | EarningsWhispers (schedule + BMO/AMC + anticipation rank) + Finnhub `/calendar/earnings` + FMP `stable/earnings-calendar` + Finviz `Earnings` column | CR | `routers/calendar.py:396,688,733`; `screener/earnings_dates.py` | **FMP `earnings-calendar` silently truncates at ~4,000 rows and is NOT date-fair** — a `[today, today+1]` call returned **exactly 4000 rows with ZERO dated `today`**, and a 14-day call dropped days 0–1 entirely ⇒ **one day per call is mandatory** (`screener/earnings_dates.py:1-24`; `implied_store.py:544-547`). The coverage monitor floors `calendar_forward_multisource` at **1.0** |
| **Earnings history / surprises** | FMP `stable/earnings` (of record) → Finnhub `/stock/earnings` (EPS only) | CR | `earnings_estimates.py:526,578` | legacy FMP v3 earnings endpoints **403 after Aug-2025**; FMP sometimes emits **two rows for one report** (deduped by `_earn_row_preferred`, estimate-bearing row wins); the history limit must scale with the book year's age (`_history_limit`) or an old year falls off the newest-first window |
| **Earnings reactions / past days** | Finnhub `/calendar/earnings` backfill (past days of the current week) | CR | `routers/calendar.py:396` | EW and Finviz are **forward-looking schedules** — once a company reports, EW drops it and Finviz's Earnings column rolls to next quarter, which progressively emptied past days of an open week (CLAIM, `CLAUDE.md`); Finnhub carries `hour` for ~90 % of past rows, the rest land in "Time TBD" — a genuine provider gap |
| **Economic calendar** | ForexFactory `ff_calendar_thisweek.json` (current week) + **FMP `stable/economic-calendar`** (arbitrary weeks) | CR 🔴 | `routers/calendar.py:2230-2231`; `econ_calendar_fmp.py:1-15` | **`ff_calendar_nextweek.json` 404s** (verified vs prod 2026-07-30); FMP's `date` is **UTC** and must be converted through a real timezone, never a fixed offset, or times are an hour off half the year |
| **News** | AlphaVantage `NEWS_SENTIMENT` → 7 RSS feeds (CNBC, MarketWatch, PRNewswire, SeekingAlpha, Yahoo, Benzinga, MotleyFool) → Massive `/v2/reference/news` → FMP `stable/news/*` → Finviz `news_export.ashx` → Google News RSS | CR | `news_aggregator.py:46-76`; `polygon_news.py`; `news_search.py:1-13` | AV free tier **25 req/DAY**, and a rate-limited AV response is a **200 with an `Information`/`Note` key**; RSS fallback cache 600 s (was 300 s — it burned quota) |
| **Social** | TwitterAPI.io (4 curated accounts + `advanced_search`), Stocktwits (public), Reddit (PRAW) | CR (Twitter gate armed) | `twitterapi_io.py`; `stocktwits_sentiment.py`; `reddit_sentiment.py` | cashtag extraction is **regex-only** (`\$[A-Z]{1,5}\b` minus forex pairs), no universe validation; Stocktwits 200/hr per IP and 403s on a python UA |
| **Filings** | SEC EDGAR (free) | CR | `sec_filings.py:22-25`; `edgar.py` | UA header mandatory; full-text search is EFTS-only; CIK map cached daily |
| **Transcripts** | **FMP `stable/earning-call-transcript*` (of record)** → AlphaVantage `EARNINGS_CALL_TRANSCRIPT` (verbatim, lazy) → earningscall.biz (word-timed) → Finnhub `/stock/transcripts*` (safety net) | CR ⚠️ | `transcripts.py:15,24,99`; `av_transcripts.py:1-22`; `earningscall_timed.py:1-27` | **Finnhub `/stock/transcripts/list` returns 403 on every call on this plan**; AV budget 25/day; earningscall.biz requires `exchange` **by NAME** (`exchange=9` → 403) and `level=3` for word timings, coverage ≈ S&P 500; **its audio URL embeds our API key and must never reach the browser** — the router proxies bytes |
| **Corporate actions (splits / dividends)** | Massive `/v3/reference/{splits,dividends}`; FMP `stable/splits`; yfinance dividends calendar | CR | `massive.py:1002-1012`; `polygon_extras.py:204,252`; `breadth_dividends.py:60` | `breadth_dividends_refresh` 04:40 ET |
| **Ownership / insiders** | FMP `stable/institutional-ownership/*` + `insider-trading/search`; Finnhub `/stock/insider-transactions`; openinsider.com (clusters); Finviz insider + institutional ownership columns | CR | `institutional_holdings.py:140-148`; `insider.py:89,133`; `insider_clusters.py` | **FMP `stable/institutional-ownership/symbol-ownership` 404s** — must use `extract-analytics/holder` (`institutional_holdings.py:140-142`); the Finnhub insider endpoint is *not* known-403 (`insider.py:8`) |
| **Short interest** | **Finviz Elite export ONLY** (`Float Short` c=30, `Short Ratio` c=31, `Short Interest` c=84) | CR 🔴 | `screener/finviz_universe.py:38-45`; `docs/screener-finviz-id-map.md` | **single-sourced, nightly-only, and known-sparse**: `routers/ai_search.py:1361-1377 _short_interest_missing` exists precisely because *"the nightly Finviz snapshot leaves `short_float_pct` NULL for plenty of"* names. **No history at all.** |
| **Analyst ratings history** | FMP `stable/grades-historical`, `grades-consensus`, `price-target-summary` | CR | 9 + 10 + 4 URL literals | Finnhub's equivalent is 403; no vendor-neutral revision timeline |
| **Breadth** | computed in-house from Massive bars + pushed `breadth_collector` snapshots | CR | `breadth_monitor.py`; `POST /api/breadth-monitor/push` | the collector runs on the owner's PC (out of this repo — D-14) |
| **Futures / COT** | CFTC public zips; futures quotes via yfinance | CR | `cot_service.py`; `massive.py` `_bounded_yf` | CFTC publish time varies after 15:30 ET Friday; **futures (NQ/ES/RTY/BTC) are not in Massive's equities API** |
| **ETF holdings / index membership** | FMP `stable/etf/holdings`, `{sp500,nasdaq,dowjones}-constituent`; Massive | CR | `etf_holdings.py`; `index_constituents.py` | — |
| **Company logos** | logo.dev (primary) → Parqet → Clearbit (+ Clearbit autocomplete for domain) → FMP `stable/profile` → Finnhub `/stock/profile2` | CR | `ticker_logos.py:229-317` | the FMP leg is *"a real but currently always-empty attempt"* (no logo field on that endpoint); miss sentinels distinguish a genuine "no logo" (7 d retry) from a provider blip (30 min) |
| **Implied move / options-derived earnings expectations** | Massive options snapshot + FMP reporters, stored in `implied_snapshots` | CR, `IMPLIED_STORE_ENABLED` armed | `implied_store.py:544-547,599,770` | the same FMP 4,000-row truncation applies to the reporters query |
| **Level 2 / order book** | **NO PROVIDER** | — | — | not referenced anywhere in the repo |
| **Fixed income / credit** | **NO PROVIDER** beyond FRED yield series | — | `fred_economic.py` catalog | no corporate credit, no CDS, no bond quotes |
| **FX / crypto beyond a snapshot** | Massive global snapshot endpoints only | CR 🔴 | `/v2/snapshot/locale/global/markets/{forex,crypto}/tickers/{s}` | **no FX or crypto bars, no depth** |
| **Whisper numbers** | **NO PROVIDER** — EarningsWhispers is used for *schedule + anticipation rank*, not whisper EPS | — | `engine.py` EW usage | — |
| **Consensus-revision timeline** | **NO PROVIDER** (partial via FMP `price-target-summary` / `grades-historical`) | 🟡 | — | — |

---

## 6. Refresh-cadence map

Measured from the **144 `add_job` sites** in `api/main.py`. Provider-touching jobs only;
all `timezone=_ET` unless noted.

| Provider | Job id(s) | Cadence |
|---|---|---|
| **Finviz Elite** | `screener_finviz_universe` | 02:45 daily (one whole-market export) |
| **FMP** | `screener_earnings_dates` 02:50 · `screener_analyst_pass` 02:00 · `ratings_percentile_nightly` 02:30 · `fundamentals_warm` 05:30 · `fundamentals_reporters_warm` Mon–Fri `*/15` in 06–09 and 16–19 · `earnings_preview_warm` 06/10/14/18 :20 · `earnings_analysis_warm` Mon–Fri 08,09,11,16,17,20 :35 | — |
| **Massive** | `screener_snapshot_nightly` 03:00 · `bars_nightly_refresh` Mon–Fri 16:15 · `breadth_live_intraday_sample` Mon–Fri 09–16 every minute · `breadth_dividends_refresh` 04:40 · `breadth_ohlc_intraday_agg` Mon–Fri 17:15 · `darkpool_massive_ingest` Mon–Fri 19:20 · `darkpool_intraday_ingest` Mon–Fri 07–16 `*/3` · `darkpool_intraday_scanner` `*/5` · `darkpool_intraday_warm` `*/12` · `darkpool_flatfile_ingest` Mon–Sat 11:45 · `oi_snapshot_daily` Mon–Fri 05:30 · `implied_move_nightly` · `ticker_types_daily_sync` 05:30 · `ssetf_nightly_rebuild` Mon–Fri 20:30 · `prebuilt_watchlists_refresh` monthly | — |
| **Finnhub** | reached through `calendar_alerts_morning` 07:00 / `calendar_alerts_evening` 18:00 · `ipo_maintenance_weekly` Sun 08:30 · `logo_miss_retry` 03:25 · the coverage monitor's own hourly sample | — |
| **TwitterAPI.io** | `tweet_poll_burst_premarket` `*/2` 04–09 · `_open` 09:30–58 `*/2` · `_close` 15:30–58 `*/2` · `_amc` 16–19 `*/2` · `tweet_poll_regular_midday` `*/15` 10–15 · `tweet_poll_slow` hourly · `tweet_cleanup_daily` 03:00 | — |
| **Perplexity + Anthropic (catalysts)** | `catalyst_premarket` 06–07 :00/:30 · `catalyst_premarket_hunt` 08 :00/:30/:45 · `catalyst_premarket_late` 09 :00/:30 · `catalyst_preopen` 09 :10/:20 · `catalyst_amc_burst[_hunt]` 16:xx · `catalyst_eod_final_hunt` 17:00 · `catalyst_coverage_audit` 20:15 · `catalyst_rule_learner` 20:30 · `catalyst_autotune` 05:00 · `catalyst_morning_digest` 08:00 | — |
| **Anthropic (other)** | `cot_narrative_prewarm` Fri 17:05 + Sat 09:00 retry · `ai_search_briefings_premarket` 08:20 / `_postmarket` 16:45 · `ai_search_weekly_deep` Sun 10:00 · `theme_engine_orphans` Mon–Fri 23:00 · `theme_engine_improve` Sat 10:00 · `transcript_keyword_alerts` Mon–Fri 18:30 · `call_recap_batch_reap` `*/20` | — |
| **CFTC** | `cot_weekly_refresh` Fri 15:50 · `cot_weekly_retry_1` 16:15 · `_retry_2` 16:45 · `cot_daily_catchup` 18:00 | — |
| **SnapTrade** | `broker_sync_due` interval (jitter 120 s) · `broker_recent_orders_poll` 5 min · `broker_sync_nightly_reconcile` 02:30 · `broker_sync_warming` · `broker_fleet_monitor` :37 · `broker_canary_sync` 03:10 · `broker_fidelity_audit` 03:40 · `broker_live_sentinel` :11/:41 (+ weekly/daily/drill variants) | — |
| **Note connectors** | `note_sync_due` hourly at :23 · `note_sync_full_nightly` 01:47 | — |
| **Zoom / YouTube** | `desk_daily_session_process` `*/5` · `desk_session_insights` `7/15` · `desk_cover_retry` `2/15` · `desk_session_audit` 09:00 · `desk_daily_session_safety` Mon–Fri 18:00 | — |
| **Cloudflare R2** | `authdb_backup_6h` (interval) · `authdb_backup_nightly` 02:55 · snapshot/delta at `SNAPSHOT_INTERVAL_SECONDS` (default 1200 s) | — |
| **Substack** | `substack_poll_hourly` :07 · `substack_poll_sunday_burst` Sun 13–17 `*/10` | — |

**INTERPRETATION.** ~40 scheduled provider touches, most of them on a **single-process
web pod** (plus a bars worker and a flow-worker).
**RELEVANCE TO UCT.** 🟢 high — Terminal-Next needs an explicit *provider call budget per
hour per pod*. Today only two budgets exist: Finnhub's 60/min and AlphaVantage's 25/day.
**CONFIDENCE** 🟢 on the schedule; 🟡 on the implied call volume (not measured).

---

## 7. Rate-limit and failure handling — the shapes that exist

| Shape | Provider(s) | Mechanism | Where |
|---|---|---|---|
| **Token bucket + shared cooldown + priority reserve** | Finnhub | `_fh_take_token`, `fh_note_429`, `fh_in_cooldown`, `fh_ws_reconnect_allowed` (WS yields before REST); 403 → 24 h forbidden-endpoint cache | `finnhub_client.py:44-56, 233-260` |
| **Daily allotment, never sleeps** | AlphaVantage | 25/day bucket, ET-midnight rollover, `av_get` returns `None` immediately once spent — *"Sleeping here would just move the 524-outage class from 'burst of AV throttle responses' to 'burst of hung request threads'"* | `alphavantage_client.py:1-48` |
| **One pool, one deadline, one circuit breaker** | yfinance | `bounded_call`; `YFRateLimitError` trips a breaker returning defaults **without network and without logging**; AST census rail fails by file:line on any un-guarded reach; `⚠️ IMPORT THE MODULE, NEVER THE FUNCTION` (a `from`-import escapes every monkeypatch of the guard) | `yf_util.py:1-40` |
| **Partner-wide async token bucket** | SnapTrade | `acquire(n)` under a lock, sleeping outside the lock; the SnapTrade limit is shared across **all** UCT users, so a per-account semaphore cannot protect it | `broker/rate_limit.py:1-24` |
| **Alert-on-auth-failure** | Perplexity | 401/403 → `chart_health_alerts.emit(..., "critical")` pages the admin Discord, hourly memo — *"the SHARED key is dead for the whole product (this surface + morning-wire + catalyst enrichment)"* | `perplexity_search.py:165-185` |
| **Structured exception classes** | TwitterAPI.io, SnapTrade, note connectors | `TwitterApiAuthError` / `PaymentRequired` / `RateLimited` / `TransientError`; `SnapNotConfigured` / `SnapAuthError` / `SnapUserSecretInvalid` / `SnapRateLimited` / `SnapTransient`; `NoteConnAuthError` / `NoteConnTokenExpired` | respective modules |
| **Terminal-vs-transient status split** | Bullflow (retired) | 401/402/403 raise `LiveflowAuthError` instead of reconnecting forever — added **because** the retired feed reconnected every 30 s on the member-serving pod | `liveflow_worker.py:2938-2947` |
| **NOTHING beyond a timeout + blanket `except → None`** | **FMP, Massive REST, Finviz, TheFly, Stocktwits, Reddit, FRED, SEC, the logo chain, earningscall.biz** | — | — |

**INTERPRETATION.** The busiest provider in the codebase — **FMP, 28 modules, 42 URL
literals** — has **no budget, no breaker, and no shared client**. A burst in one FMP
consumer is invisible to every other FMP consumer. That is precisely the condition that
produced the Finnhub 2026-08-04 incident (three legs failing together for one symbol but
not another = an account-level cooldown), which is what forced `finnhub_client.py` to be
extracted.
**RELEVANCE TO UCT.** 🟢 high. **RECOMMENDATION.** Require every provider to route through
a shared client with a budget **before its second consumer ships**; `finnhub_client.py`
and `alphavantage_client.py` are the two working templates and one is explicitly modelled
on the other. **OPEN QUESTION.** Does the FMP Premium/Ultimate plan publish a rate limit
we are simply not tracking, or is it effectively unlimited? That answer decides whether a
shared FMP client is a cost control or only a correctness one.

---

## 8. Failure direction: everything degrades silently, by design

**OBSERVATION.** Nearly every provider wrapper advertises *"never raises"* and returns
`None` / `[]` / `{}`.

**EVIDENCE.** `thefly_news.py:1-15` · `econ_calendar_fmp.py:15` (*"Never raises: returns
{} on any failure, and the caller decides"*) · `earnings_audio.py:10` (*"All providers
are null-safe; never raises"*) · `reddit_sentiment.py:9-11` · `fh_get` (returns `None` on
every failure path incl. a missing key) · `massive._bounded_yf` (returns `default`) ·
`ticker_logos.py` (*"Never raises"*).

**INTERPRETATION.** This is deliberate and correct for a member-facing single-process
pod: a dead provider must not 500 the page. Its cost is that **provider death is
indistinguishable from a quiet market at every call site** — the exact failure that hid
two Finnhub 403s for months. Four mitigations exist: `provider_coverage_monitor`,
`fundamentals_monitor`, `bars_reconciliation`, and — importantly — the **UI-level**
counterpart, `app/src/components/screener/CoverageLine.jsx`, which reports **four**
counts (evaluated · answered · dropped · not-computable) and refuses to render "0
matches" when the honest answer is *"that is a gap in what we hold, not a quiet market"*.

**RELEVANCE TO UCT.** 🟢 high. `CoverageLine`'s four-count receipt should be a
Terminal-Next **platform primitive**, not a screener-only component: every surface that
can be short must be able to say *why* it is short.
**CONFIDENCE** 🟢. **RECOMMENDATION.** Pair each ledger row with (a) a coverage field +
floor and (b) a named UI receipt, or accept that the row can go blank unnoticed.

---

## 9. Provider-facing code quality (Q8)

### 9.1 There is no provider abstraction

**OBSERVATION.** A census of vendor-host literals across `api/**` (tests excluded) finds
**66 modules** constructing provider base URLs inline — including **three FastAPI
routers**: `api/routers/calendar.py` (Finviz ×2, FMP ×1), `api/routers/earnings.py`
(**FMP ×20**, AlphaVantage ×1), `api/routers/fundamentals.py` (FMP ×1). A router is the
request path; a vendor URL there is a vendor schema one layer from the wire.

**EVIDENCE.** Host-literal census (method, §0). Duplicated FMP helpers — **six
independent implementations**, each with its own timeout and error policy:
`api/routers/fundamentals.py:111 _fmp_get` · `api/services/catalyst/analyst_actions.py:96
_fmp_get` · `api/services/earnings_estimates.py:344 _fmp_get` ·
`api/services/transcript_indexer.py:25 _fmp_get` · `api/services/insider.py:89
_fmp_get_insider` · `api/services/research/financial_history.py:38 _fmp`.

Partial abstractions that **do** work: `stripe_service.py` (*"Nothing else in the
codebase touches Stripe"*), `finnhub_client.fh_get` (the one true chokepoint, extracted
after an incident), `alphavantage_client.av_get` (modelled on it), `yf_util.bounded_call`
(with an AST rail), `massive._MassiveRestClient` — imported by 56 modules, but **20+
modules still build `api.massive.com` URLs themselves**.

**The repo's own key roster is incomplete.** `api/routers/admin_api_health.py:18` declares
`_KEYS` as *"Every external API key the codebase references"* and then omits
`FINVIZ_API_KEY`, `LOGODEV_TOKEN`, `UW_API_KEY`, `BULLFLOW_API_KEY`, `POLYGON_API_KEY`,
`SNAPTRADE_*`, `SCHWAB_*`, `ZOOM_*`, `YT_OAUTH_*`, `EARNINGS_AUDIO_API_KEY`, `DROPBOX_*`,
`NOTION_*`, `MSGRAPH_*`, `DATA_SYNC_*`, `MASSIVE_S3_*`, `CHART_RENDERER_SECRET`,
`CHART_RENDER_TOKEN`, `DISCORD_BOT_TOKEN` and 16 of the 17 Discord webhook vars. **A
hand-typed roster beside the source that owns it** — the defect class this repo
documents repeatedly. It is also the natural home for the ledger's live-read.

**INTERPRETATION.** A Terminal-Next provider swap today is a 66-file change with six FMP
error policies to reconcile. **CONFIDENCE** 🟢.
**RECOMMENDATION.** One client module per vendor, enforced by an AST rail of the shape
that already exists for yfinance (`tests/test_yf_guard_census.py`, which fails **by
file:line**), and **derive `admin_api_health._KEYS` from that census rather than typing
it**. **OPEN QUESTION.** Is FMP consolidation in scope for Terminal-Next, or is FMP
itself a candidate for replacement (in which case consolidate first, so the swap is one
file)?

### 9.2 Where vendor formats leak

| Format | Owner | Leak |
|---|---|---|
| **Polygon dot-notation class shares** (`BRK.B`) | `massive.to_polygon_symbol` (`massive.py:40`) — its own docstring says *"Apply ONLY at the Massive REST boundary"* | **41 call sites across 15 modules**, including `journal_two/broker/snaptrade_adapter.py` and `journal_two/excursion_engine.py` — the Massive symbol form has crossed out of the market-data layer into the **journal/broker** domain |
| **OCC option symbols** | **no owner** | **five independent builders**: `api/backfill_rest.py:76 _occ` · `api/backfill_side_heal.py:41 _occ` · `api/massive_oi_snapshots.py:356 _occ_symbol` · `api/oi_morning.py:161 _occ` · `api/services/journal_two/broker/historical_equity.py:42 occ_symbol`; plus `api/daily_tracker.py:293 _poly_ticker` building the Polygon `O:` form. **An OCC mismatch returns an empty contract, not an error** — it degrades silently. |
| **Yahoo index symbols** (`^GSPC`, `^NDX`, `^DJI`, `^RUT`, `^VIX`, `XSP→^GSPC`) | **no owner** | `YF_INDEX_MAP` is defined **three times**: `api/schwab_router.py:19` and twice inside `api/massive_ws_worker.py` (`:2553`, `:3752`) — the latter's own comment says *"matches schwab_router.py exactly"*, i.e. a second authority over one value **by admission**. Both files are partner-owned; noted, not touched. |
| **SnapTrade option units** | `broker/_holding_contract` | holding `price` is per-share but `average_purchase_price` is per-**contract** (premium ×100); normalised in one place (CLAIM, `CLAUDE.md`) |
| **Finviz export column ids** | `docs/screener-finviz-id-map.md` + `finviz_universe._C_IDS` | **correctly NOT load-bearing** — parsing is by **header NAME**, so a wrong id degrades to a `missing_headers` receipt rather than a wrong value: *"THIS WAS SAFE BY CONSTRUCTION, NOT BY LUCK"* (`finviz_universe.py:51-56`). **The best vendor-format containment in the repo and the pattern to copy.** |

**CONFIDENCE** 🟢.
**RECOMMENDATION.** Define one internal symbol type and push every vendor form to a
single adapter boundary per vendor. The OCC builder and the Yahoo index map are the two
easiest consolidations and the highest-risk divergences today.
**OPEN QUESTION.** Two of the five OCC builders and all three `YF_INDEX_MAP` copies sit
in partner-owned files — who owns consolidating them?

---

## 10. The seven findings that most affect the provider ledger

1. **Massive.com IS Polygon.io.** `polygon_options.py:1-11` names it as *"Polygon Advanced
   tier, $200/mo"* under `MASSIVE_API_KEY`; `polygon_news.py` and `polygon_extras.py` set
   `_BASE = "https://api.massive.com"`; `to_polygon_symbol` exists because Massive speaks
   the Polygon symbology; `bar_stream.py` uses the Polygon WS message shape. **Never
   procure a second Polygon-family vendor.** 🟢
2. **Three separate "cheap fallback" chains exist** — bars (Massive → FMP → yfinance),
   transcripts (FMP → AV → earningscall → Finnhub), logos (logo.dev → Parqet → Clearbit →
   FMP → Finnhub). Each is correct in isolation; **none is expressed as declared policy**
   — the ordering lives in control flow. 🟢 **RECOMMENDATION:** make fallback order data,
   not code, so the ledger and the runtime cannot disagree.
3. **Finnhub is a degraded leg carrying two permanently-403 endpoints**, kept only because
   `fh_get` caches the 403 for 24 h and it costs nothing once FMP succeeds. A ledger entry
   for Finnhub must state **which endpoints this plan actually carries**. 🟢
4. **FMP has three measured silent failure modes** — the ~4,000-row non-date-fair
   truncation, legacy-v3 403s, and `institutional-ownership/symbol-ownership` 404s. All
   three are *200-shaped* or *quietly empty*. 🟢
5. **Short interest is single-sourced to a nightly Finviz export, known-sparse, and has no
   history.** For a terminal this is a genuine coverage gap;
   `ai_search._short_interest_missing` already exists to route around it. 🟢
6. **No provider at all for** order book / L2, corporate credit, FX-crypto bars, whisper
   numbers, or consensus-revision timelines. Marked honestly in §5. 🟢
7. **The retirement idiom is good and should be kept**: stop calling it, leave the module
   as rollback, write *why* at the call site, and **do not** make the silence depend on an
   absent env var (`main.py:3006-3033`). 🟢

---

## GAPS

* **No live status read.** The contract forbade calling providers, and I did not read
  Railway variables or production endpoints. Everything stays CODE-REFERENCED; §2 names
  the five read-only admin endpoints that would upgrade ~25 rows in one pass.
* **Per-provider cost is NOT DETERMINED.** Cost caps exist in code
  (`CATALYST_COST_CAP_DAILY` 8.00 / `CATALYST_COST_HARD_CAP` 15.00,
  `AI_SEARCH_{AGENT,DEEP,BRIEF,DOSSIER}_COST_CAP_DAILY`, `COT_NARRATIVE_DAILY_CAP` 300,
  theme-engine $5/ET-day) and `CLAUDE.md` carries forecasts (CLAIM: Twitter $13–22/mo,
  catalysts ~$80–100/mo all-in, Massive/Polygon Advanced $200/mo), but **no measured
  spend artifact exists in this repo**. E-01..E-04 own licensing; D-03 could not price
  usage.
* **Partner-owned files read only at surface depth** per the preamble: `OptionsFlow.jsx`,
  `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`,
  `massive_processor.py`. Their provider usage is named (Schwab, Unusual Whales, Yahoo,
  Massive) but not characterised in detail.
* **Frontend provider surface sampled, not exhausted.** I censused `import.meta.env.*` and
  external hosts in `app/src` but did not walk every component for vendor field names.
* **`tools/` and `scripts/` providers** were included in the env census but not read
  individually beyond names. `WEBSHARE_PROXY_PASSWORD` / `YT_PROXY_URL`
  (`scripts/backfill_video_insights.py:55,59`) indicate a residential-proxy vendor not
  otherwise in the ledger; its terms and status are unexamined.
* **Caching column is complete for scheduled jobs, partial for request-path TTLs** —
  dozens of per-surface `TTLCache` instances were not enumerated one by one.
* **1,054 environment variables exist**; I characterised the ~120 credential- and
  provider-shaped ones. The remaining ~930 are tuning knobs and feature gates (the flag
  ledger owns those).
* **Voice-tool provider reach not fully mapped.** `voice_tool_impls.py` is ~2,750 lines
  and registers providers (FRED, Reddit, Stocktwits, TheFly, SEC) that no page consumes;
  I confirmed registration but not per-tool reachability from a real session.

## NOT INSPECTED

* **Railway dashboard / `railway variables`** — out of scope for this contract; it is the
  authority on which keys are actually set and on which service.
* **Production logs, deploy logs, Railway metrics** — unreachable; the only path to
  OBSERVED-CALLED.
* **The live admin endpoints** — `/api/admin/api-health`, `/api/admin/provider-coverage`,
  `/api/admin/fundamentals-health`, `/api/admin/reconciliation-status`,
  `/api/admin/bars-stream-status`, `/api/admin/twitter-stats`,
  `/api/admin/catalyst-stats`, `/api/desk/sessions-status`, `/api/desk/session-audit`.
  Read-only and free, but they are production endpoints.
* **The local backend on port 8077** — the preamble forbids probing it and forbids
  treating it as truth.
* **`C:\data`** — the live volume; not touched. `provider_coverage.db`, `bars.db`,
  `flow.db`, `catalysts.db`, `tweets.db`, `cot.db` each carry real timestamps that would
  answer "when did this provider last deliver".
* **Other repositories** — `uct-intelligence`, `uct_intelligence`, `morning-wire`,
  `uct-sunday-scan` are **D-14's**. Note for the synthesis: `morning-wire` shares
  `PERPLEXITY_API_KEY` and `ANTHROPIC_API_KEY` with this repo
  (`perplexity_search.py:167` calls it *"the SHARED key … for the whole product"*), so
  the two ledgers must be reconciled or a per-repo quota will be double-counted.
* **`external/morning-wire`, `external/uct-intelligence`** submodules — not initialised in
  this worktree.
* **The test suite** — not run (not authorised; repo-root `conftest.py` pins shared-data
  paths).
* **`git`** — not run.
