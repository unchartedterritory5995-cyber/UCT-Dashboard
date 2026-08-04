# Backend Data Options — Earnings Modal + Equity Research Page Redesign

Date: 2026-08-03 · Worktree inventoried: `C:\Users\Patrick\uct-worktrees\research-redesign`
Method: static code reading + provider docs only. **No live API calls were made; no endpoints were hit; no files edited.**

---

## 0. Hard provider constraints (verified in memory/code — MUST be respected)

- **FMP Premium tier**: `stable/earnings-calendar`, `stable/economic-calendar`, `stable/price-target-consensus` **WORK**; `stable/upgrades-downgrades`, `stable/earnings-surprises`, `stable/general-news` **404 even on Premium**. Never build a widget on those three.
  - ⚠️ **Plan-label discrepancy found in code**: several shipped services carry comments claiming "FMP **Ultimate**" (`analyst_grades.py`, `fmp_transcripts.py`, `ownership.py` 13F block, `earnings_table` docstrings, the fundamentals-monitor CLAUDE.md note "FMP Ultimate rarely falls through to AV"). The endpoints those services use (`stable/grades`, `stable/grades-consensus`, `stable/grades-historical`, `stable/price-target-summary`, `stable/earnings`, `stable/earning-call-transcript`, `stable/institutional-ownership/*`) are *in the production code path today*, so they are empirically live on the current key — but any NEW FMP endpoint (e.g. revenue segmentation) must be probed via the existing diagnostic `GET /api/debug/earnings-sources/{sym}` before a widget depends on it. Do not assume tier from docs; assume only what the debug probe proves.
- **Finnhub `/quote` is REGULAR-SESSION only** — pre-open it returns the PRIOR session. Never use it for pre-market reaction numbers (use Massive snapshot/lastTrade instead).
- **Finnhub market caps are in LOCAL currency** (ADRs etc.) — never mix into USD screens unconverted.
- **Finnhub `/stock/price-target` 403s on the current plan** (code already auto-skips 403'd endpoints for 24h via `fh_forbidden_*` cache). Finnhub free tier = 60 calls/min; the shared 20s cooldown after any 429 is load-bearing (`earnings_estimates._fh_get`).
- **yfinance 1.2.0 is the chosen source for statements/estimates** — `earnings_estimate`, `revenue_estimate`, `eps_trend`, `eps_revisions`, `upgrades_downgrades` confirmed available and already in prod (`api/services/research/estimates.py`). All yfinance calls MUST ride the bounded pool (`yfinance_pool.run_in_pool` / `yf_util.bounded_call`) — unbounded yf calls caused the 2026-07-01 524 outage class.
- **AlphaVantage free tier = 25 req/day** — transcripts + deep EPS history are lazy/budgeted; never put AV on a fan-out path.
- **Massive.com** = Polygon-compatible REST + WS + S3 flat files, already paid ($200/mo Advanced per `polygon_options.py` comment: real-time NBBO + Greeks + IV + options flow). S3 boto3 needs the checksum work-around params. `MASSIVE_WS_DRY_RUN` does NOT protect the prod WS slot.
- **ForexFactory** econ scraping: JSON clock is US **CENTRAL**, not ET (verified 7/31).
- **Finviz Elite**: silently DROPS invalid filter tokens (200 + plausible rows); `v=152` = custom view, pin `c=`; Mkt Cap = raw MILLIONS, Avg Vol = THOUSANDS; 403s non-browser UAs.
- **EarningsWhispers + Finviz are forward-looking SCHEDULES, not archives** — a reported company disappears; only Finnhub's range endpoint retains history (this is why `_backfill_past_days` exists).

---

## Part 1 — Inventory: every existing internal endpoint relevant to a ticker research page

### A. Research page family — `api/routers/research.py` + `api/services/research/`

| Endpoint | Fields | Upstream source(s) | Cache TTL |
|---|---|---|---|
| `GET /api/research/financials/{sym}` | `annual[]` (5y) + `quarterly[]` (8q): period, revenue, net_income, eps, gross/operating/net margin, revenue_yoy, eps_yoy; `balance` {cash, total_debt, debt_to_equity, current_ratio, fcf}; `metrics` {roe, roa, margins} | yfinance `income_stmt` / `quarterly_income_stmt` (bounded pool, 12s timeout); balance/metrics from `get_fundamentals` (yf `.info`) | 48h (`research_fin::`) |
| `GET /api/research/estimates/{sym}` | `forward[]` (Current Qtr/Next Qtr/Current Yr/Next Yr: eps avg/low/high, num_analysts, eps_growth, rev_avg); `revisions[]` (eps_trend current/30d/90d + up30/down30 revision counts); `rating_changes[]` (date, firm, from/to grade, action); `consensus` (buy/hold/sell buckets + label); `price_target` (high/low/median/consensus + recency-weighted month/qtr/yr avgs) | yfinance `earnings_estimate`/`revenue_estimate`/`eps_trend`/`eps_revisions`/`upgrades_downgrades` (pool, 15s); consensus + PT + richer rating feed from FMP via `analyst_grades` (overrides yf actions when FMP returns any) | 12h (`research_est::`) |
| `GET /api/research/ownership/{sym}` | `institutional` {pct_held, top-8 holders w/ shares, pct_out, value, date}; `short` {shares_short, short_pct_float, days_to_cover, float_shares, shares_outstanding, prior_month_short}; `insider[]` (top 10 txns); `thirteen_f` {quarter, summary: investors_holding/±, ownership_pct/±, total_invested/±, new/increased/reduced/closed positions, put_call_ratio; holders: top-12 w/ change_shares, change_pct, is_new, is_sold_out} | yfinance `.info` + `institutional_holders` (pool, 15s); insider = Finnhub `/stock/insider-transactions` (via `insider.py`); 13F = FMP `stable/institutional-ownership/symbol-positions-summary` + `extract-analytics/holder` (walks 4 quarters newest-first for the latest filed) | 12h (`research_own::`); insider sub-cache 4h |
| `GET /api/research/ratings/{sym}` | `composite` 0-99 + `components` (EPS, RS, Growth, Value, SMR, Acc/Dis, Sponsorship letters/scores) + `checkup[]` (8 CANSLIM-ish pass/fails) + `method`/`basis`/`universe_n`/`group_rs` | Computed from `get_fundamentals` + `get_ownership` + 1y price/volume history (`yfinance_pool.fetch_history`); percentile vs nightly cap-universe distributions (`ratings_db`) when warmed, else absolute bands | 12h (`research_rat::`) |
| `GET /api/research/snapshot/{sym}` | name/sector/industry/about/next_earnings + composite/components/checkup + ~22 curated metrics (valuation, growth, profitability, balance, price context, analyst) | Pure composition of ratings + fundamentals; disk SWR store (`fundamentals_snapshot_store`) | 30min mem; stale-serve ≤2d w/ bg rebuild |
| `POST /api/research/snapshot-batch` | per-sym {market_cap, next_earnings, composite, sector, industry}, ≤100 syms | `get_snapshot` fan-out, 6 workers | inherits snapshot caches |
| `GET/POST /api/research/ratings-percentile/*` | universe percentile coverage status / admin refresh | `ratings_db` + `ratings_universe` | — |

### B. Fundamentals / meta / insider / filings

| Endpoint | Fields | Source | TTL |
|---|---|---|---|
| `GET /api/fundamentals/{ticker}` | market_cap (formatted), forward_pe, beta, week52 high/low, avg_vol, div_yield, name | yf `.info` (bounded) + Finnhub `/stock/metric?metric=all` | 1h mem; disk SWR stale ≤7d |
| `GET /api/fundamentals/earnings-table?sym=` | `annual[]` EPS/Sales table + `quarterly[]` actual-vs-estimate strip incl. forward estimate rows | **Merged by fiscal quarter**: FMP `stable/earnings` (EPS+revenue, richest) → Finnhub `/stock/earnings` (EPS gap-fill) → AlphaVantage `EARNINGS` (deepest free EPS history); annual via `annual_financials` | 6h normal, **5 min inside earnings window**, empty 2 min; disk SWR ≤3d; watched by `fundamentals_monitor` |
| `GET /api/ticker-meta/{ticker}` | name, sector, industry | yf `.info` + Finnhub `profile2` fallback | 24h mem + disk (`/data/ticker_meta_cache`) |
| `GET /api/insider/{ticker}` | insider txns: name, title, buy/sell (P/S codes only), shares, price, amount, date, filing_date | Finnhub `/stock/insider-transactions` | 4h |
| `GET /api/insider/feed` · `/{ticker}/has-buy` | notable buys, 7d, cross-market (~55 tickers) | same, 10-wide pool | 1h |
| `GET /api/filings/{ticker}?count=` | recent 10-K/10-Q/8-K/S-1/DEF 14A: form, filed, period, accession, url | **SEC EDGAR free** (`company_tickers.json` CIK map + `data.sec.gov/submissions`), UA header required | 30 min (CIK map 24h) |

### C. Earnings & calendar family

| Endpoint | Fields | Source | TTL |
|---|---|---|---|
| `GET /api/earnings` | today's bmo/amc/amc_tonight rows: sym, reported_eps, eps_estimate, surprise_pct, rev_actual, rev_surprise_pct, verdict | wire_data push (engine: EarningsWhispers) + Finnhub actuals patch | wire-cadence |
| `GET /api/earnings-gaps` | live change_pct per reporting sym | Massive batch snapshots | 30s |
| `GET /api/earnings/intel/{ticker}` | `beat_history` (last 4q period/actual/estimate/beat/surprise), `consensus` (rec buckets), `price_target` (usually null — Finnhub PT is 403 plan-forbidden) | Finnhub `/stock/earnings`, `/stock/recommendation`, `/stock/price-target` | 6h; total-failure negative cache 10 min |
| `GET /api/earnings-analysis/{sym}` | AI preview (pending) or analysis (reported): headline, bullets, beat_history, yoy_eps_growth, beat_streak, news + enrichment | Claude (engine) + `earnings_enrichment` fan-out (below) | per-sym engine caches |
| `GET /api/chart-markers/{ticker}` | earnings beat/miss + surprise (5y), splits (45y, ratio), dividends | earnings: FMP `stable/earnings` join; splits+dividends: **yfinance** (Finnhub versions premium-gated) | 12h mem + **persistent disk forever** w/ daily bg refresh |
| `GET /api/earnings/call-recap/{ticker}` | recap {headline, sentiment, bullets, quotes, **guidance**, qa_highlights}, webcast_url, rating_changes | **Perplexity web search (finance pack, month recency) + Claude Opus synthesis**; cost-guarded (catalyst daily cap) | 24h |
| `GET /api/earnings/sentiment/{ticker}` | {score −100..100, label, rationale, drivers} | same AI stack | 12h |
| `GET /api/earnings/transcript/{ticker}?quarter=` | verbatim segments [{speaker, title, content, sentiment}] | **FMP `stable/earning-call-transcript` primary** (30d cache, "83+ quarters"); AlphaVantage `EARNINGS_CALL_TRANSCRIPT` fallback (25/day, lazy, per-ticker locks) | 30d hit / 6h miss |
| `GET /api/earnings/analyst-grades/{ticker}` | consensus buckets+label, price_target {high/low/median/consensus + last month/qtr/yr avg&count}, recent_actions (12), trend (6 monthly bucket snapshots) | FMP `stable/grades-consensus`, `price-target-consensus`, `price-target-summary`, `grades`, `grades-historical` | 6h |
| `GET /api/earnings/audio/{ticker}` | {stream_url, kind, transcript_url} or null | env-pluggable (`EARNINGS_AUDIO_PROVIDER`; EarningsAPI adapter concrete, Quartr/EarningsCall stubs) | — |
| `GET /api/calendar` (+`?week=`) / `/month` | weekly/monthly earnings buckets w/ session, estimates, actuals, EW anticipation rank, econ events | live: **EarningsWhispers + Finviz Elite** merge; past days of current week: **Finnhub** backfill (cap 150); month: Finnhub range; econ: **ForexFactory** (CENTRAL-clock gotcha) | week cache ~10 min rebuild cadence |
| `GET /api/calendar/reactions?date=` | post-print reaction % per reported sym | today: **Massive batch snapshot**; past: **Massive daily bars** (internal) | 30s live / 24h settled / 10 min unsettled |
| `GET /api/calendar/enrichment?date=` (+`-batch`) | per-sym {`expected_move` {pct, dollar, expiry, strike, spot, call_mark, put_mark}, `beat_history`, `hist_stats` {avg_abs_move, up_count, total, last_n}} | expected_move: **yfinance ATM straddle** (`get_implied_move`, isolated bounded pool, skipped for past dates); beat_history: Finnhub; hist_stats: yf daily bars × FMP/AV quarter dates | 5 min current week / 4h future weeks / 12h past; ±14d compute gate |
| `GET /api/calendar/day-metrics(-batch)` | price, avg_vol, mc_b per sym | Finviz Elite bulk primary, Massive snapshot fallback | 2 min today / 1h future / 24h past |
| `GET /api/calendar/next-report?sym=` | next scheduled report date | calendar caches + Finnhub | — |
| `GET /api/calendar/ipos` · `/dividends` | IPO events (Finnhub), dividends/splits (yfinance) | — | — |
| `GET /api/earnings/… (transcripts.py service)` | Finnhub transcript + Sonnet summary (used by EarningsModal + key-quotes) | Finnhub `/stock/transcripts` (premium-dependent) | 24h/1h |

**Enrichment fan-out already built** (`api/services/earnings_enrichment.py`, all best-effort, parallel): pre-earnings 5d/30d returns (yf), historical earnings-day moves (AV/FMP dates × yf bars, BMO/AMC-aware gap math), Finnhub recommendation-trend revisions proxy, beat-magnitude history, implied move (yf straddle), AI key quotes from prior call (Finnhub transcript + Claude).

### D. In-house options data (the sleeper assets)

| Asset | What it has | Where |
|---|---|---|
| **`api/services/polygon_options.py`** | Massive `/v3/snapshot/options/{sym}` full chain: **NBBO bid/ask, last, day OHLCV, IV, delta/gamma/theta/vega, OI, underlying price, break-even**; expirations list; single-contract lookup. 1-min chain cache. **Currently wired ONLY into voice tools** (`voice_tool_impls.py`) — NOT the research page or calendar enrichment | already-paid Massive Advanced |
| **flow.db `flow` table** (flow-worker service) | Real-time OPRA trade prints: Symbol, C/P, Strike, Spot, Premium, Volume, Side, IV, DTE, OI, ER flag, Sector, MktCap, ts_ns; Massive WS live + T+1 S3 flat files backfill; dedup-keyed | own database; read via `/api/flow/*` (proxied web→flow-worker). ⚠️ `/api/flow/data` caps at 50k BY PREMIUM for days≥2 — use `days=1` |
| **`massive_oi_snapshots.py`** | per-underlying OI snapshot (one call returns all strikes/expiries), auth = `?apiKey=` query param (Bearer REJECTED) | same key |
| **Bars infra** `/api/bars/{ticker}` | 5,000 bars all TFs, 3-layer cache, 3,685-ticker prewarmed universe → internal price-reaction/AVAT computation for any ticker/date at zero marginal cost | internal |

**Relevant-endpoint count: ~30 distinct ticker-research endpoints** (7 research, 3 fundamentals/meta, 4 ownership/insider/filings, 10 earnings-family, ~7 calendar-family), plus the un-surfaced options chain service.

---

## Part 2 — Data-need catalog: what COULD power richer widgets

Ranking order used: **existing internal > free > already-paid provider (Massive/FMP/Finnhub/Finviz/AV/Perplexity+Claude) > new cost**.

### 1. Expected move (straddle-derived)
- **Today**: yfinance ATM straddle (`get_implied_move`) — slow (~1-3s/sym), hang-prone (needed its own isolated bounded pool), quotes are delayed, only computed for today/future calendar dates.
- **⭐ Best option — already-paid, in-house**: `polygon_options.get_chain()` already returns real-time NBBO bid/ask + IV for every strike at the front expiry in ONE cached call. Expected move = ATM call mid + put mid (or IV-based `spot × IV × √(T/365)` as cross-check — IV is exchange-derived in the same payload). Latency ~200-500ms uncached, 1-min cache; no per-strike fan-out. This **replaces the yfinance straddle wholesale** and also unlocks: term-structure expected move (this-week vs next-month), IV rank inputs, and post-earnings IV-crush display. Rate limits: Massive/Polygon Advanced tier is effectively unmetered for this call volume (one call per underlying); the existing 1-min TTLCache bounds it. Caveat: verify the snapshot endpoint's per-request `limit=250` pagination on mega-chains (SPY/QQQ — code notes `next_url` pagination exists in the OI fetcher; `get_chain` does not paginate — fine for single-expiry ATM use).
- 2nd: keep yfinance as fallback only.
- Do NOT use flow.db for this — trade prints ≠ current NBBO mid.

### 2. Earnings history with beat/miss + price reaction
- **Existing pieces (all internal, zero new cost)**: beat/miss + surprise per quarter (FMP `stable/earnings` via `get_year_earnings`/`get_chart_markers`, Finnhub 4q via `get_earnings_intel`, AV deep history); reaction % (calendar `_past_reactions` off Massive bars; `get_historical_earnings_moves` BMO/AMC-aware gap math off yf bars).
- **⭐ Gap is composition, not data**: no single endpoint returns "last 8-12 quarters: date, session, EPS/rev vs est, surprise %, next-day reaction %, close-to-close %". Build one service that joins `get_chart_markers.earnings` (dates+surprise, disk-persisted forever) × internal Massive bars (reaction) — swap the yf bars call in `get_historical_earnings_moves` for `/api/bars` internals to kill the yf dependency. Massive bars are split-adjusted-fresh (stale-intraday yf fallback already exists). AV `reportTime` or EW session tags give BMO/AMC.
- Deep history (>5y): AV EARNINGS (25/day budget — persist forever like chart_markers does) or lift `get_chart_markers`'s 5y lookback.

### 3. Whisper numbers
- **No legitimate API exists.** EarningsWhispers has no official API (searched; only scrape-able pages, and the site connection-drops rapid/parallel bursts — the calendar already paces it). The whisper number itself appears on EW per-stock pages the current scraper does NOT parse (calendar scrapes the daily calendar pages only).
- Options ranked: (a) **extend the existing EW scraper** to pull the whisper field for the ~40/day curated reporters — fragile, ToS-gray, low volume so probably survivable; (b) **synthesize a "street expectation" proxy in-house**: yfinance `eps_trend` (7d/30d/60d/90d estimate drift) + `eps_revisions` (up/down counts) + beat-streak → "estimates rising into the print" badge — free, defensible, already fetched; (c) Estimize — **new cost** (B2B pricing, quote-only) — not recommended. Recommendation: (b) now, (a) only if the owner explicitly wants the literal whisper number.

### 4. Guidance extraction
- **Existing**: `call_recap` already returns a `guidance` field (Perplexity + Opus, cost-guarded, 24h cache) — the modal can surface it today.
- **⭐ Upgrade path (already-paid)**: run the extraction over the **FMP verbatim transcript** (`fmp_transcripts`, unlimited on current key, 30d cache) instead of/alongside Perplexity web context — deterministic source, quotable verbatim, works for any of 83+ quarters, and enables guidance-vs-guidance QoQ comparison ("raised/maintained/cut" timeline) as a small structured LLM pass cached forever per (sym, quarter). Cost: one Opus/Sonnet call per sym-quarter, cost-guarded like call_recap.
- No structured guidance feed exists at FMP/Finnhub/yfinance tiers in use; Benzinga/S&P guidance datasets = new cost, skip.

### 5. Transcripts (what feeds call-recap today)
- Call-recap feed = **Perplexity search** (not a transcript). Verbatim = **FMP primary / AV fallback** (both wired). Finnhub transcripts service exists but the plan's transcript access is shaky (`/stock/price-target` already 403; transcripts/list is probed in the debug endpoint).
- Enhancements at zero new cost: per-segment keyword search (already shipped in EarningsModal), Q&A-only view (FMP segments have speaker labels), prepared-remarks vs Q&A sentiment split (AV returns per-segment sentiment).
- Live audio remains env-gated stubs (Quartr/EarningsCall = **new cost**, adapters half-built in `earnings_audio.py`).

### 6. Institutional 13F trends
- **Existing**: `ownership.py::_thirteen_f` (FMP institutional-ownership summary + top-12 holder deltas, newest filed quarter) — already returns QoQ flow (new/increased/reduced/closed, ownership ±, put/call ratio). yfinance `institutional_holders` top-8 as fallback.
- **Trend (multi-quarter) widget**: loop `symbol-positions-summary` over the last 4-8 (year, quarter) pairs — same endpoint already proven per-quarter; cache each quarter forever (13F history is immutable). Free alternative: SEC EDGAR 13F raw filings — free but requires cross-fund aggregation infra (thousands of filings/quarter); not worth building while the FMP endpoint answers.
- Caveats: 13F lags ~45 days; FMP quarter probing already handles "newest filed". Verify the endpoints live via the debug probe before shipping (Ultimate-labeled).

### 7. Short interest history
- **Existing**: point-in-time only — yf `.info` (shares_short + prior_month). No history anywhere internal.
- **⭐ Best free**: **FINRA Equity Short Interest API** — `https://api.finra.org/data/group/otcMarket/name/EquityShortInterest` (bi-monthly, all listed + OTC, CSV/JSON, filterable by symbol, free with API registration; settlement-date lag ~9 business days). One nightly/weekly pull into a small SQLite (mirrors the COT pattern) gives a full short-interest history chart + days-to-cover trend. Rate limits generous; batch by settlement date, not per-symbol.
- Bonus free layer: FINRA **daily short-sale volume** files (Reg SHO, no key) for a daily short-volume-% overlay — noisier, but daily.
- Finnhub `/stock/short-interest` = premium (likely 403 like price-target); FMP has no short-interest endpoint on this plan. Do not buy S3/Ortex.

### 8. Peer / comparables lists
- **Existing**: `compare_fundamentals(tickers)` (≤6, parallel) exists but nothing GENERATES the peer list. Internal candidates: `theme_db` (111 themes / 2,049 holdings — same-theme peers), sector/industry from `ticker_meta` × cap_universe (same-industry screen), RS-ranking service for ordering.
- Ranked: (a) **internal theme/industry join — zero cost, on-brand** (peers = same industry, sorted by RS or market cap, via already-cached snapshot-batch); (b) Finnhub `/stock/peers` — free tier, one call, decent GICS-based list (works on current key — worth the probe); (c) FMP `stable/stock-peers` — probe needed. Recommendation: (a) with (b) as seed/sanity.

### 9. Segment revenue (product & geography)
- **Nothing internal.** Options: (a) **FMP `stable/revenue-product-segmentation`** + `revenue-geographic-segmentation` — cleanest structured feed; tier-gated (docs don't pin the tier — **must probe with the debug endpoint**; if the current key 404s/402s this dies quietly like upgrades-downgrades did); (b) **SEC EDGAR XBRL — free but hard**: `companyfacts` does NOT expose dimensional (segment-axis) facts; getting segments means parsing full XBRL instances per filing (edgartools-style `include_dimensions=True`) — real engineering cost, inconsistent tags across issuers; (c) LLM extraction from 10-Q/10-K via existing EDGAR filings endpoint + Claude — cacheable per filing, cost-guarded, but needs a hallucination-guard (cite exact XBRL numbers). Recommendation: probe (a); if unavailable, (c) as a curated-ticker-only feature; skip (b).

### 10. Analyst price-target distributions
- **Existing**: consensus high/low/median/consensus + month/qtr/yr recency-weighted avgs (`analyst_grades`, FMP) — enough for a range bar vs price today.
- **Per-analyst distribution/histogram**: FMP `stable/price-target-news` (individual analyst actions with targets — the debug endpoint already probes it) → build the distribution + "most recent 12 targets" strip internally. yfinance `analyst_price_targets` (confirmed in 1.x docs) gives mean/high/low/current as a free cross-check. Benzinga = new cost, skip.
- Constraint reminder: `stable/price-target-consensus` is a proven-WORKS endpoint; `stable/upgrades-downgrades` is a proven-404 — the rating-change feed must stay on `stable/grades` (works) + yfinance `upgrades_downgrades`.

### 11. Insider transactions
- **Existing**: Finnhub per-ticker (P/S only, 4h cache) + market feed. Weaknesses: no officer titles (service hardcodes "Officer/Director"), silently drops 10b5-1 vs discretionary distinction.
- Upgrades: (a) **yfinance `insider_transactions` / `insider_purchases` / `insider_roster_holders`** — free, includes names+titles, already inside the chosen library; (b) **SEC EDGAR Form 4 直接** (free, real-time, titles + transaction codes + 10b5-1 flag; submissions API already integrated for filings — extend `sec_filings.py` to parse Form 4 XML) — best fidelity, moderate build; (c) FMP insider endpoints — probe needed. Recommendation: blend (a) into the existing ownership payload now; (b) if the modal wants a "cluster buy" signal with titles.

### 12. Earnings-day live reaction / after-hours print move (modal header)
- Internal only: Massive snapshot `todaysChangePerc` + `lastTrade.p` extended-hours (calendar already does exactly this). **Never Finnhub `/quote` pre-open** (prior-session trap). Zero new cost.

---

## Part 3 — Ranked summary per gap (cost lens)

| Data need | Best source | New cost? | Build size |
|---|---|---|---|
| Expected move | Massive options chain (`polygon_options`, already built, un-surfaced) | **$0** | S — new thin service + swap into enrichment |
| Earnings history + reaction | chart_markers × internal Massive bars join | **$0** | S/M — composition service |
| Whisper proxy | yf eps_trend/eps_revisions drift badge | **$0** | S |
| Literal whisper number | EW per-stock scrape | $0 but fragile/ToS-gray | M |
| Guidance extraction | FMP verbatim transcript + Claude (cost-guarded) | ~$0 (existing budget) | M |
| Transcripts | FMP primary / AV fallback (shipped) | $0 | — (surface more) |
| 13F trends | FMP institutional-ownership per-quarter loop (probe first) | $0 if live on key | S |
| Short interest history | FINRA Equity Short Interest API → SQLite (COT pattern) | **$0** (free API) | M |
| Peers | theme_db/industry join + Finnhub /stock/peers seed | **$0** | S |
| Segment revenue | FMP revenue segmentation (PROBE) else LLM-from-10-Q | probe / LLM budget | M/L |
| PT distribution | FMP price-target-news histogram + yf analyst_price_targets | $0 (probe price-target-news) | S |
| Insider quality | yf insider_* now; EDGAR Form 4 later | **$0** | S then M |
| Options positioning color (flow around earnings) | own flow.db (`days=1` cap gotcha) + OI snapshots | **$0** | M |

## Hard blockers / risks
1. **FMP tier ambiguity** — Premium-vs-Ultimate labels conflict in code; three endpoints are KNOWN-404 (`stable/upgrades-downgrades`, `stable/earnings-surprises`, `stable/general-news`); every NEW FMP endpoint (segmentation, price-target-news, stock-peers, institutional loops) must pass the `GET /api/debug/earnings-sources/{sym}` probe before UI depends on it.
2. **No whisper-number API exists anywhere** at any already-paid provider — literal whispers require scraping EW detail pages.
3. **Finnhub plan wall**: price-target 403 (handled), transcripts/short-interest likely premium — treat Finnhub as: earnings EPS 4q + recommendations + insider + peers, nothing more.
4. **AV 25/day** budget — anything AV-sourced must stay lazy + persisted (transcripts, deep EPS history already comply).
5. **Segment revenue via SEC XBRL** is genuinely hard (dimensional data absent from companyfacts) — don't promise it until the FMP probe answers.
6. **yfinance fragility** — every new yf property must ride the bounded pools; `.info` is the hang-prone call; a yfinance upstream break degrades estimates/ownership/financials simultaneously (single-provider concentration is the page's biggest systemic risk — the Massive/FMP alternates above also serve as de-concentration).

## Sources
- yfinance Ticker API reference: https://ranaroussi.github.io/yfinance/reference/api/yfinance.Ticker.html (confirmed: earnings_dates, earnings_estimate, revenue_estimate, eps_trend, eps_revisions, analyst_price_targets, recommendations, upgrades_downgrades, growth_estimates, insider_transactions, insider_purchases, institutional_holders, major_holders, sec_filings, calendar, options, shares, sustainability)
- FINRA Equity Short Interest: https://www.finra.org/finra-data/browse-catalog/equity-short-interest · API metadata PDF: https://www.finra.org/sites/default/files/Equity_Short_Interest_Data_File_Download_API.pdf · Developer catalog: https://developer.finra.org/catalog
- FMP pricing/plans: https://site.financialmodelingprep.com/pricing-plans · Revenue Product Segmentation doc: https://site.financialmodelingprep.com/developer/docs/stable/revenue-product-segmentation
- SEC EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces · XBRL/dimensional limits: https://edgartools.readthedocs.io/en/latest/getting-xbrl/
- EarningsWhispers (no official API found): https://www.earningswhispers.com/
