# Calendar Phase 2 — Full EarningsHub Competitor

**Date:** 2026-06-01
**Status:** Approved scope, pending implementation plan
**Surface:** `/calendar` + new `/calendar/mystocks` hub + `api/routers/calendar.py` (+ new routers)
**Builds on:** `2026-06-01-calendar-dominant-feed-design.md` (Phase 1, shipped)

---

## 1. Goal

Make UCT's Calendar a head-to-head EarningsHub competitor and ship-ready. Phase 1 delivered the personalized logo feed (Feed/Week/Month) with expected move + surprise history. Phase 2 closes every remaining EarningsHub feature gap that fits UCT's product, plus finishes the deferred Phase-1 items.

**Scope decision (user, 2026-06-01):** include AI sentiment panel, "My Stocks" multi-tab hub, and listen-to-call (TTS). **Skip** the social layer (public profiles, follow, Savvy-Trader portfolio sharing) — off-product.

---

## 2. Data-source reality (audited + tier-probed 2026-06-01)

| Feature | Source decision |
|---|---|
| IPO calendar | **Finnhub `/calendar/ipo`** — ✅ works on our tier (verified). |
| Forward dividends / splits | **yfinance** `.calendar`/`.dividends`/`.splits` (forward ex-div); historical already in `earnings_estimates.get_chart_markers`. |
| Month earnings | **Finnhub `/calendar/earnings?from=&to=`** (month batch, fast) + existing weekly EW enrich for the visible week. |
| SEC filings | **`api/services/sec_filings.py`** (SEC EDGAR, free) — already built, expose + UI. |
| Fundamentals / forward P/E | **`api/services/fundamentals.py`** (yfinance) + **Finnhub `/stock/metric`** (✅ works) for ADV/extras. |
| Extended-hours price | **Massive snapshot `lastTrade.p`** — surface the existing field. |
| Earnings-call recap ("listen") | **Finnhub transcripts ❌ no access.** Use **Perplexity + our LLM** to build an AI call recap (highlights/quotes/guidance/Q&A). TTS read-aloud via browser `speechSynthesis` (same pattern as the Voice Bridge / Read Aloud). Verbatim transcript = drop-in later via env-gated API-Ninjas/FMP key. |
| Pre-report alerts | Reuse **`watchlist_alert_service.deliver_alert_payload`** (bell + email + Discord) + APScheduler job. |
| Logo coverage boost | Slow Finnhub-logo retry over `.miss` + domain-derived logo (Clearbit via `fundamentals` website). |
| AI sentiment | Our LLM + Perplexity (same infra as catalyst enrichment). |

---

## 3. Features

### 3A. True Month view
- New `GET /api/calendar/month?year=&month=`: Finnhub `/calendar/earnings` for the full month → normalized day map (sym, timing, eps_est, rev_est, mc filter via cap_universe), cached 30 min. The current week is upgraded with EW data when it overlaps.
- Frontend `MonthView` consumes a real 4–6 week grid (leading/trailing days greyed). `buildMonthGrid` rewritten to fill the actual month; logos + gold-ring (mine) + `+N` overflow + ★ macro markers per cell. Click a day → existing `DayDetailDrawer`.
- Month nav (‹ ›) in the header when in Month view; persists current month in component state.

### 3B. IPO calendar
- New `api/services/ipo_calendar.py::get_ipos(from, to)` → Finnhub `/calendar/ipo`, normalized `{sym, name, date, exchange, price_range, shares, value, status}`, cached 6 h.
- `GET /api/calendar/ipos?from=&to=`. Surfaced as: (a) an **event-type filter chip** "IPOs" that injects IPO cards into the relevant day groups, and (b) inside Month cells as a distinct marker.
- IPO card variant in `EarningsCard` (or sibling `IpoCard`): logo (if available) + name + price range + shares + exchange + status pill.

### 3C. Dividends & splits
- New `api/services/dividends_calendar.py::get_events(syms|range)` → yfinance forward ex-div + splits, cached 12 h.
- Event-type filter chips "Dividends" / "Splits"; card variant shows ex-div date + amount (or split ratio). For "My Stocks" these are most useful, so default to the user's set.

### 3D. Pre-report alerts for My Stocks
- New `api/services/calendar_alerts.py` + APScheduler job (evening ~6 PM ET + morning ~7 AM ET): for each `compass`/alert-enabled user, intersect their personalization set with tomorrow's + today's reporters; fire via `watchlist_alert_service.deliver_alert_payload`. Dedup table `calendar_alerts_fired (user_id, ticker, market_date)` (PK 3-col, mirror catalyst pattern). Gated `CALENDAR_ALERTS_ENABLED=1`.
- Settings toggle (reuse existing alert settings surface) — opt-in.

### 3E. Filters: market-cap / avg-vol / price range
- Wire the dormant `/api/calendar/day-metrics` (price, avg_vol, mc_b) into the feed: a `useDayMetrics(ds)` overlay merged onto entries. Extend `filterLogic` with `minAvgVol`, `priceMin`, `priceMax`. Header gets compact numeric filter controls (a "Filters ▾" popover to avoid clutter).

### 3F. Precise countdown
- EW payload sometimes carries a report time; thread it through (`_build_live` → entry `when`/`time_et`). When present, card shows `⏱ in ~6h · 4:20p ET`; otherwise fall back to `Tue · after close`. Best-effort, never blocks.

### 3G. iCal / calendar export
- `GET /api/calendar/export.ics?scope=mine|all&token=<userToken>`: generate a VCALENDAR of earnings (and optionally dividends) for the scope, one VEVENT per reporter (all-day or session-timed). Also expose a **webcal subscription URL** so users can subscribe in Google/Apple Calendar and get auto-updates. Header "Export ▾" → Download .ics / Copy subscribe URL.

### 3H. SEC filings
- `GET /api/filings/{ticker}` wrapping `sec_filings.recent_filings`. Shown in **EarningsModal** (new "Filings" section: form · date · link) and in the My-Stocks hub "Filings" tab. Read/unseen aware (3M).

### 3I. Earnings-call recap + Listen (TTS) + pluggable LIVE audio
- New `api/services/call_recap.py`: Perplexity + LLM build a structured recap for a ticker's latest reported quarter `{headline, sentiment, bullets[], quotes[], guidance, qa_highlights[]}`, cached 24 h, cost-guarded (reuse catalyst cost-guard pattern). `GET /api/earnings/call-recap/{ticker}`.
- EarningsModal gains a **"Earnings Call" section** (reported tickers): recap + a **"🔊 Listen"** button that TTS-reads the recap via browser `speechSynthesis` (reuse the Voice Bridge pattern; zero backend). **Keyword search** box filters/highlights within the recap text.
- **Pluggable audio + verbatim transcript provider** (`api/services/earnings_audio.py`): a provider interface gated by `EARNINGS_AUDIO_PROVIDER` (`none` default | `earningsapi` | `earningscall` | `quartr`) + `EARNINGS_AUDIO_API_KEY`. `GET /api/earnings/audio/{ticker}` returns `{stream_url, kind: live|recorded, transcript_url}` or null. Providers (pricing 2026-06-01): **EarningsAPI** ($24.99 Pro / $39.99 Ultra, recorded audio + transcripts + FTS), **EarningsCall**, **Quartr** (enterprise, real-time HLS live). When a key is present: EarningsModal + My-Stocks "Calls" tab show an HLS audio player (hls.js / native) with **🔴 Listen Live** (when `kind=live`) or **▶ Replay**, plus verbatim transcript + keyword search. When absent: recap + TTS only, and a **"Listen live ↗"** link to the company's official IR webcast (sourced via Perplexity `_find_webcast_url(ticker)`, cached 24 h).
- **No code changes needed to enable**: subscribe → set the two env vars → live audio + verbatim transcripts light up app-wide.

### 3I-bis. Extra depth (no new vendor)
- **Historical post-earnings reaction stats** on reported cards/modal ("avg move ±X% over last N prints; gapped up M/N") from existing `hist_moves`.
- **Guidance** (raised / cut / inline) surfaced explicitly in the call recap structure.
- **Analyst rating changes** (recent upgrades/downgrades) in EarningsModal via Finnhub `/stock/recommendation` deltas (already on our tier).

### 3J. Forward P/E + fundamentals
- `GET /api/fundamentals/{ticker}` wrapping `fundamentals.get_fundamentals` (+ Finnhub `/stock/metric` for ADV/extras). Card gets a compact **Fwd P/E** chip; EarningsModal gets a fundamentals strip (mkt cap, fwd P/E, beta, 52w range, avg vol, div yield).

### 3K. Extended-hours price
- Surface `lastTrade.p` (+ session flag) from the Massive snapshot in `/api/live-prices` / reactions path. Card shows an `EXT $x (±y%)` line during pre/post-market when regular session is closed.

### 3L. Read / unseen state
- New `api/services/calendar_seen.py` + table `calendar_seen (user_id, item_type, item_key, seen_at)` (item_type ∈ earnings|filing|ipo|recap). `GET /api/calendar/seen` + `POST /api/calendar/seen`. UI: unseen items get a subtle dot/brighter treatment; opening/clicking marks seen. Applies in feed + My-Stocks hub.

### 3M. AI sentiment panel
- `GET /api/earnings/sentiment/{ticker}` → LLM/Perplexity-derived `{score -100..100, label, rationale, drivers[]}`, cached 12 h, cost-guarded. Shown as a compact gauge in EarningsModal + the hub "Insights" tab. Reuses our existing AI client; no new vendor.

### 3N. "My Stocks" multi-tab hub
- New route `/calendar/mystocks` (also reachable from a header button). Tabs: **Earnings · News · Calls · Filings · Insights**, all scoped to the user's personalization set (with the same ⚙ source customizer).
  - Earnings: upcoming + recently-reported for your stocks (rich cards).
  - News: `news_aggregator` filtered to your syms.
  - Calls: AI call recaps for your recently-reported stocks (+ Listen).
  - Filings: SEC filings stream for your stocks.
  - Insights: AI sentiment + expected move + surprise-history roll-up per stock.
- Read/unseen badges per tab (count of unseen). Mobile = stacked.

### 3O. Logo coverage boost
- `ticker_logos`: add a 4th source (Clearbit by company domain from `fundamentals.website`). A slow, low-concurrency **miss-retry pass** (`run_miss_retry()`): re-attempt `.miss` tickers via Finnhub-logo + Clearbit at ≤2 workers with sleeps (respects Finnhub rate limit). Triggerable via `POST /api/logos/prewarm?misses=1`. Target ≥95% coverage.

---

## 4. Backend summary

**New services:** `ipo_calendar.py`, `dividends_calendar.py`, `calendar_alerts.py`, `call_recap.py`, `calendar_seen.py`, `earnings_sentiment.py` (may fold into call_recap). **Expose existing:** `sec_filings.py`, `fundamentals.py`.
**New/extended endpoints (all under existing routers where sensible):** `/api/calendar/month`, `/api/calendar/ipos`, `/api/calendar/dividends`, `/api/calendar/export.ics`, `/api/calendar/seen` (GET/POST), `/api/filings/{ticker}`, `/api/fundamentals/{ticker}`, `/api/earnings/call-recap/{ticker}`, `/api/earnings/sentiment/{ticker}`, `/api/logos/prewarm?misses=1`. Extend `/api/live-prices` snapshot with extended-hours fields.
**Scheduler:** calendar pre-report alert job (gated). **Tables:** `calendar_alerts_fired`, `calendar_seen`.

## 5. Frontend summary

**New:** `MonthView` (true grid + month nav), `IpoCard`/event-variant cards, `MyStocksHub` page + tabs, `CallRecapSection` (+ Listen + search), `FundamentalsStrip`, `SentimentGauge`, `FiltersPopover`, `ExportMenu`, `useDayMetrics`/`useSeen`/`useFundamentals`/`useCallRecap` hooks, `SeenDot`. **Extend:** `EarningsCard` (fwd-P/E chip, ext-hours line, seen state, event variants), `CalendarHeader` (month nav, Filters/Export menus, My-Stocks hub link, event-type chips enabled), `filterLogic` (vol/price), `Calendar.module.css`.

## 6. Invariants & cost

- Every new field degrades gracefully to null/hidden — page fully usable with all of them empty.
- LLM features (call recap, sentiment) are cached (12–24 h) + cost-guarded (reuse catalyst `cost_guard` daily caps) + skip-if-stable. Per `feedback_opus_for_synthesis`, recap/sentiment synthesis uses Opus; cheap paths cached.
- Enrichment/overlays stay lazy + bounded (current-view scope only), never block first paint.
- Alerts deduped per (user, ticker, day); opt-in; gated by env.
- Prewarm/miss-retry polite (≤2 workers for Finnhub/Clearbit paths).
- No social/Savvy-Trader. No paid transcript/audio vendor (recap+TTS instead).

## 7. Phasing (implementation order)

1. **Calendar essentials**: month view + month-range backend; vol/price filters; precise countdown; extended-hours price.
2. **Event calendars**: IPO + dividends/splits (services, endpoints, chips, card variants).
3. **Per-ticker depth**: fundamentals strip + fwd-P/E chip; SEC filings section; AI call recap + Listen + search; AI sentiment gauge.
4. **My Stocks hub**: `/calendar/mystocks` with 5 tabs + read/unseen state.
5. **Alerts + export + logo boost**: pre-report alert job; iCal/webcal export; logo miss-retry/coverage.

## 8. Testing
Backend pytest per new service (mock external sources): ipo normalize, dividends forward, month range, seen CRUD, alert dedup, recap/sentiment shape + cost-guard, fundamentals shape, filings passthrough, ics generation. Frontend vitest: month-grid builder, filter logic (vol/price), seen reducer, TTS-availability guard, event-card variant rendering. `npm run build` gate before each push.

## 9. Explicitly out of scope
Social profiles / follow / portfolio-sharing (Savvy-Trader) — off-product. Live + verbatim audio/transcripts are **built pluggable** (§3I) and activate on adding an `EARNINGS_AUDIO_PROVIDER` key (EarningsAPI ~$25–40/mo, or Quartr enterprise for true real-time live); until then, AI recap + TTS + IR-webcast link cover the listening experience.
