# Calendar Phase 2 — EarningsHub Competitor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Each task: write test → implement (follow existing patterns) → run test → `npm run build` (for FE) → commit. Never weaken a test to pass. Do NOT push (controller pushes per phase). Every new field degrades gracefully to null/hidden.

**Goal:** Close every remaining EarningsHub gap + finish deferred Phase-1 items, making `/calendar` a ship-ready competitor.

**Spec:** `docs/superpowers/specs/2026-06-01-calendar-phase2-competitor-design.md` (read it; it has the data-source decisions).

**Reference patterns (match these):**
- Finnhub fetch + cache: `api/services/earnings_estimates.py` (`_fh_get`, `cache.get/set`, TTLs)
- Disk/TTL service: `api/services/ticker_meta.py`; cost-guard: `api/services/catalyst/cost_guard.py`; LLM client: `api/services/engine._get_anthropic_client()`; Perplexity: `api/services/catalyst/sources.py` / `engine._enrich_with_perplexity`
- Already-built to expose: `api/services/sec_filings.py::recent_filings`, `api/services/fundamentals.py::get_fundamentals`
- Already-built data: `earnings_estimates.get_chart_markers` (historical div/splits), `earnings_enrichment.get_implied_move`, `hist_moves` (historical earnings-day moves — find where it's computed and reuse)
- Auth dep: `from api.middleware.auth_middleware import get_current_user`, `user["id"]`
- Alerts delivery: `api/services/watchlist_alert_service.deliver_alert_payload`; dedup pattern: catalyst `catalyst_alerts_fired`
- Scheduler: APScheduler blocks in `api/main.py` (next to COT/Twitter/Catalyst)
- Router register: `api/main.py` ~line 42 import, ~line 1740 include_router
- FE prefs: `usePreferences()` → `{prefs, setPref}`; calendar dir: `app/src/pages/calendar/`; logo: `app/src/components/CompanyLogo.jsx`; CSS module `Calendar.module.css`
- TTS pattern: browser `speechSynthesis` as used in the Voice Bridge (`app/src/components/voice/` / Compass voice) — reuse, zero backend

---

## PHASE A — Calendar essentials (month view, filters, countdown, ext-hours)

### Task A1 — Month-range earnings backend
**Files:** modify `api/routers/calendar.py`; test `tests/test_calendar_month.py`
- [ ] Test: mock Finnhub `/calendar/earnings?from=&to=` → assert `GET /api/calendar/month?year=2026&month=6` returns `{month, days: {YYYY-MM-DD: {bmo:[...], amc:[...]}}}` with cap_universe filtering and 30-min cache; empty-safe.
- [ ] Implement `get_month_calendar(year, month)`: compute first/last day, call Finnhub `/calendar/earnings` (reuse the `requests` pattern already in `_patch_today_actuals`), normalize each row → `{sym, eps_est, rev_est, timing}` bucketed by date into bmo/amc (hour field bmo/amc/dmh→amc), filter to cap_universe, cache key `calendar_month_{year}_{month}` TTL 1800. Never raise → `{}` on failure.
- [ ] Commit: `feat(calendar): /api/calendar/month full-month earnings range`

### Task A2 — True MonthView (frontend)
**Files:** rewrite `app/src/pages/calendar/MonthView.jsx`; modify `Calendar.jsx`, `CalendarHeader.jsx`, `useCalendarData.js`, `Calendar.module.css`; test `app/src/pages/calendar/monthGrid.test.js`
- [ ] Test: pure `buildMonthGrid(year, month, daysMap, mySetsSources)` returns a 5-col weekday grid with leading/trailing greyed cells, correct dayNum/isToday/inMonth/syms/mineSyms/hasMacro.
- [ ] Implement: extract `buildMonthGrid` into a pure helper (full month, weekday-only columns Mon–Fri); add `useMonthCalendar(year,month)` SWR hook; `MonthView` renders real grid with logos + gold-ring + `+N` + ★, click day → `DayDetailDrawer`; header shows `‹ June 2026 ›` month nav only in Month view (component state `monthCursor`). Mobile: agenda list fallback.
- [ ] `npm run build` + vitest; Commit: `feat(calendar): true month grid + month navigation`

### Task A3 — Market-cap / avg-vol / price filters
**Files:** modify `filterLogic.js`, `CalendarHeader.jsx` (new `FiltersPopover`), `useCalendarData.js` (`useDayMetrics`), `FeedView.jsx`, `Calendar.module.css`; extend `filterLogic.test.js`
- [ ] Test: extend filter tests for `minAvgVol`, `priceMin`, `priceMax` (rows with metrics) incl. null-safe passthrough.
- [ ] Implement: `useDayMetrics(ds)` SWR over existing `/api/calendar/day-metrics?date=`; merge `{price, avg_vol, mc_b}` onto entries in DayGroup; extend `applyFilters` with the three numeric bounds; `FiltersPopover` ("Filters ▾") with cap/vol/price inputs persisted in `calendar_filters`.
- [ ] build + vitest; Commit: `feat(calendar): market-cap / avg-volume / price filters`

### Task A4 — Extended-hours price
**Files:** modify `api/services/massive.py` (surface `lastTrade.p`+session) and the live-prices/reactions path; `EarningsCard.jsx`, `Calendar.module.css`; test `tests/test_massive_extended_hours.py`
- [ ] Test: mock a Massive snapshot incl. `lastTrade` → assert the snapshot dict now includes `ext_price` + `ext_session` (pre|post|null) without breaking existing `close/change_pct` fields.
- [ ] Implement: add `ext_price`/`ext_session` to `get_single_ticker_snapshot`/batch (derive session from clock/market state); surface through the prices the card already consumes. Card shows `EXT $x (±y%)` line only when regular session closed and `ext_price` present.
- [ ] build; Commit: `feat(calendar): extended-hours price on cards`

### Task A5 — Precise countdown
**Files:** modify `api/routers/calendar.py` (`_build_live` thread report time), `EarningsCard.jsx`
- [ ] Implement (best-effort, no test needed beyond build): thread any EW report-time field into entry `time_et`; card computes `⏱ in ~Nh · h:mm a ET` when present, else `Day · BMO/AMC`. Pure display, null-safe.
- [ ] build; Commit: `feat(calendar): precise per-ticker countdown when report time known`
- [ ] **End of Phase A:** controller runs full FE+BE calendar tests + build, then pushes.

---

## PHASE B — Event calendars (IPO, dividends/splits)

### Task B1 — IPO calendar service + endpoint
**Files:** create `api/services/ipo_calendar.py`, test `tests/test_ipo_calendar.py`; modify `api/routers/calendar.py`
- [ ] Test: mock Finnhub `/calendar/ipo` → `get_ipos(from,to)` returns normalized `[{sym,name,date,exchange,price_range,shares,value,status}]`, cached 6h, empty-safe.
- [ ] Implement service (Finnhub `/calendar/ipo`, verified on our tier) + `GET /api/calendar/ipos?from=&to=`.
- [ ] Commit: `feat(calendar): IPO calendar service + endpoint`

### Task B2 — Dividends/splits forward service + endpoint
**Files:** create `api/services/dividends_calendar.py`, test `tests/test_dividends_calendar.py`; modify `api/routers/calendar.py`
- [ ] Test: mock yfinance `.calendar`/`.dividends`/`.splits` → `get_events(syms)` returns `[{sym, type: dividend|split, date, amount|ratio}]` forward-looking, cached 12h, empty-safe.
- [ ] Implement + `GET /api/calendar/dividends?syms=` (default to caller's My-Stocks when authed).
- [ ] Commit: `feat(calendar): forward dividends + splits calendar`

### Task B3 — Event-type chips + card variants (frontend)
**Files:** `CalendarHeader.jsx` (enable Earnings/Macro/IPOs/Dividends chips), new `app/src/pages/calendar/EventCard.jsx`, `FeedView.jsx`, hooks, `Calendar.module.css`; test `app/src/pages/calendar/eventCard.test.jsx`
- [ ] Test: `EventCard` renders IPO variant (name/price range/shares/exchange/status) and dividend variant (ex-date/amount) with logo + monogram fallback.
- [ ] Implement: event-type chips now functional (filter which event types show); fetch IPOs/dividends for the visible range; interleave EventCards into day groups; Month cells get IPO/div markers.
- [ ] build + vitest; Commit: `feat(calendar): IPO + dividend event cards and type filters`
- [ ] **End of Phase B:** controller tests + build + push.

---

## PHASE C — Per-ticker depth (fundamentals, filings, call recap+listen+audio, sentiment, rating changes)

### Task C1 — Fundamentals endpoint + card chip + modal strip
**Files:** create `api/routers/fundamentals.py` (wrap `fundamentals.get_fundamentals` + Finnhub `/stock/metric` for ADV), register in main.py; test `tests/test_fundamentals_router.py`; FE `useFundamentals.js`, `FundamentalsStrip.jsx`, `EarningsCard.jsx` (Fwd P/E chip), modal integration
- [ ] Test: `GET /api/fundamentals/{ticker}` returns `{market_cap, forward_pe, beta, week52_high, week52_low, avg_vol, div_yield}` shape; null-safe.
- [ ] Implement endpoint + `FundamentalsStrip` in EarningsModal + compact `Fwd P/E` chip on cards (lazy, hidden if null).
- [ ] build + tests; Commit: `feat(calendar): fundamentals endpoint + forward P/E chip + modal strip`

### Task C2 — SEC filings endpoint + modal section
**Files:** create `api/routers/filings.py` (wrap `sec_filings.recent_filings`), register; test `tests/test_filings_router.py`; FE `useFilings.js`, modal "Filings" section
- [ ] Test: `GET /api/filings/{ticker}?count=10` returns `{ticker, filings:[{form,filed,url,...}]}`; empty-safe.
- [ ] Implement endpoint + EarningsModal "SEC Filings" section (form · date · link).
- [ ] build + tests; Commit: `feat(calendar): SEC filings endpoint + modal section`

### Task C3 — AI call recap + sentiment + guidance + rating changes (backend)
**Files:** create `api/services/call_recap.py`, `api/services/earnings_sentiment.py` (may share a module), test `tests/test_call_recap.py`; modify `api/routers` (earnings router or calendar)
- [ ] Test: mock LLM/Perplexity + cost-guard → `get_call_recap(ticker)` returns `{headline, sentiment, bullets[], quotes[], guidance, qa_highlights[]}` cached 24h, skip-if-stable, cost-guarded; `get_sentiment(ticker)` returns `{score,label,rationale,drivers[]}` cached 12h. Both null-safe + respect daily cost cap.
- [ ] Implement using `engine._get_anthropic_client()` (Opus per `feedback_opus_for_synthesis`) + Perplexity for web-sourced call highlights; reuse catalyst `cost_guard`. Endpoints `GET /api/earnings/call-recap/{ticker}`, `GET /api/earnings/sentiment/{ticker}`. Add `_find_webcast_url(ticker)` (Perplexity, cached 24h) for the IR "Listen live" link. Rating-changes: derive recent up/downgrades from Finnhub `/stock/recommendation` month-over-month deltas (add to sentiment or a small helper).
- [ ] Commit: `feat(calendar): AI call recap + sentiment + guidance + webcast link`

### Task C4 — Pluggable live/recorded audio provider (backend)
**Files:** create `api/services/earnings_audio.py`, test `tests/test_earnings_audio.py`; endpoint in earnings router
- [ ] Test: with `EARNINGS_AUDIO_PROVIDER=none` → `get_audio(ticker)` returns None; with a mocked provider → returns `{stream_url, kind, transcript_url}`. Provider dispatch by env; never raises.
- [ ] Implement provider interface (`none`|`earningsapi`|`earningscall`|`quartr`) gated by `EARNINGS_AUDIO_PROVIDER` + `EARNINGS_AUDIO_API_KEY`; `GET /api/earnings/audio/{ticker}`. Implement the `earningsapi` adapter concretely (REST per their docs) so it works the instant a key is set; stub `quartr`/`earningscall` adapters with clear TODO + the documented endpoint shape.
- [ ] Commit: `feat(calendar): pluggable earnings-call audio provider (env-gated)`

### Task C5 — Call/recap/sentiment/audio UI (frontend)
**Files:** create `CallRecapSection.jsx` (recap + 🔊 Listen TTS + keyword search + HLS player when audio present + "Listen live ↗" link), `SentimentGauge.jsx`, hooks `useCallRecap/useSentiment/useEarningsAudio`; integrate into `EarningsModal`; `Calendar.module.css`; test `app/src/pages/calendar/callRecap.test.jsx`
- [ ] Test: CallRecapSection renders recap bullets, Listen button guarded on `speechSynthesis` availability, keyword search filters/highlights; SentimentGauge renders score/label; audio player renders only when `audio.stream_url` present (use hls.js or native `<audio>`); else shows webcast link.
- [ ] Implement; add `hls.js` dep only if needed (check package.json; prefer native HLS where possible). Reuse the Voice Bridge TTS pattern.
- [ ] build + vitest; Commit: `feat(calendar): earnings-call recap, Listen (TTS), sentiment, audio player`

### Task C6 — Historical post-earnings reaction stats
**Files:** modify recap/enrichment to include `hist_moves` summary; `EarningsCard.jsx`/modal
- [ ] Implement (build-verified): surface "avg move ±X% over last N · up M/N" from existing `hist_moves` on reported cards + modal. Null-safe.
- [ ] Commit: `feat(calendar): historical post-earnings reaction stats`
- [ ] **End of Phase C:** controller tests + build + push.

---

## PHASE D — My Stocks hub + read/unseen

### Task D1 — Read/unseen state (backend)
**Files:** create `api/services/calendar_seen.py` + table `calendar_seen` (migration in auth_db init like other j2/calendar tables), test `tests/test_calendar_seen.py`; endpoints in calendar router
- [ ] Test: `mark_seen(user, item_type, item_key)` + `get_seen(user, item_type)`; idempotent; `GET/POST /api/calendar/seen` authed.
- [ ] Implement table `calendar_seen(user_id,item_type,item_key,seen_at)` (PK user_id+item_type+item_key) + service + endpoints.
- [ ] Commit: `feat(calendar): read/unseen state service + endpoints`

### Task D2 — My Stocks hub page (frontend)
**Files:** create `app/src/pages/calendar/MyStocksHub.jsx` + tab components (Earnings/News/Calls/Filings/Insights), route in router, nav link from `CalendarHeader`; hooks `useSeen`; `Calendar.module.css`; test `app/src/pages/calendar/myStocksHub.test.jsx`
- [ ] Test: hub renders 5 tabs; tab switching; unseen badge counts; respects My-Stocks source customizer.
- [ ] Implement `/calendar/mystocks` route: Earnings (reuse cards filtered to mine), News (`news_aggregator` filtered to mine — reuse existing news hook/endpoint, filter client-side by sym), Calls (call recaps + Listen for recently-reported mine), Filings (SEC filings stream), Insights (sentiment + expected move + surprise roll-up). Unseen dots via `useSeen`; opening marks seen. Mobile stacked.
- [ ] build + vitest; Commit: `feat(calendar): My Stocks multi-tab hub + read/unseen UI`
- [ ] **End of Phase D:** controller tests + build + push.

---

## PHASE E — Alerts, export, logo coverage

### Task E1 — Pre-report alerts (backend + scheduler)
**Files:** create `api/services/calendar_alerts.py` + table `calendar_alerts_fired`, test `tests/test_calendar_alerts.py`; scheduler block in `api/main.py`
- [ ] Test: given a user's My-Stocks set ∩ tomorrow's reporters, `run_prereport_alerts(market_date)` fires `deliver_alert_payload` once per (user,ticker,day) (dedup), gated `CALENDAR_ALERTS_ENABLED`.
- [ ] Implement service + APScheduler jobs (evening ~6 PM ET, morning ~7 AM ET) + dedup table. Opt-in per existing alert settings.
- [ ] Commit: `feat(calendar): pre-report earnings alerts for My Stocks`

### Task E2 — iCal / webcal export
**Files:** modify `api/routers/calendar.py` (`/api/calendar/export.ics`), test `tests/test_calendar_ics.py`; FE `ExportMenu` in `CalendarHeader.jsx`
- [ ] Test: `GET /api/calendar/export.ics?scope=mine&token=` returns valid `text/calendar` VCALENDAR with one VEVENT per reporter (sym, date, session-timed), correct headers; empty-safe.
- [ ] Implement .ics generation (no external dep — emit the text) + a stable per-user `token` (reuse existing user token mechanism or a signed value) so a **webcal subscribe URL** works; `ExportMenu` → Download .ics / Copy subscribe URL.
- [ ] build + tests; Commit: `feat(calendar): iCal download + webcal subscription export`

### Task E3 — Logo coverage boost
**Files:** modify `api/services/ticker_logos.py` (Clearbit-by-domain source via fundamentals.website; `run_miss_retry()`), `api/services/ticker_logos_prewarm.py`, `api/routers/ticker_logos.py` (`?misses=1`), test extension `tests/test_ticker_logos.py`
- [ ] Test: `run_miss_retry()` re-attempts only `.miss` tickers at low concurrency, removing `.miss` + writing `.png` when a source now resolves; Clearbit source tried via domain.
- [ ] Implement + `POST /api/logos/prewarm?misses=1` triggers the slow retry pass (≤2 workers). Target ≥95% coverage.
- [ ] Commit: `feat(calendar): logo coverage boost (Clearbit domain + miss-retry)`
- [ ] **End of Phase E:** controller tests + build + push. Trigger `POST /api/logos/prewarm?misses=1` on prod.

---

## Final
- [ ] Full backend test sweep (all new `tests/test_calendar_*`, `test_ipo_*`, `test_dividends_*`, `test_fundamentals_*`, `test_filings_*`, `test_call_recap*`, `test_earnings_audio*`, `test_ticker_logos*`) + full FE vitest on `src/pages/calendar/` + `npm run build`.
- [ ] Update CLAUDE.md Calendar section + user memory.
- [ ] Final push; verify on prod; document the two env vars to enable live audio.

## Self-review vs spec
Every §3 feature (3A–3O) maps to a task above. Out-of-scope (social) excluded. Live audio = pluggable (C4/C5). Cost-guard + caching on all LLM features (C3). Graceful-null everywhere. Logo boost (E3) + alerts opt-in (E1).
