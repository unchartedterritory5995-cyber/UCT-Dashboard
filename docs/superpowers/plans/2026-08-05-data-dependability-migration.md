# Data Dependability Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the platform from "working" to "dependable and dominant." Today the most-depended-on market-data provider is the one we do **not** pay for (Finnhub, free, 60/min), and the strongest one we **do** pay for (FMP Premium) is used in less than half as many places. This plan re-points every field that has a paid equivalent, removes the places a failure gets cached as if it were data, and adds a coverage monitor so a blank field reaches a dashboard before it reaches a user.

**Architecture:** Three independent workstreams that can run in parallel after Phase 0. **Phase 0/1** fix things that are broken in production *right now* (two Finnhub endpoints return 403 on every call; the implied-move MOAT's pairing key is NULL on its primary path). **Phase 2/3** re-point Finnhub and AlphaVantage call sites at FMP. **Phase 4** is the systematic cache-poison sweep. **Phase 5** adds the monitor. No task depends on a later task.

**Tech Stack:** FastAPI, `requests`, pytest, SQLite, APScheduler. React 19 + SWR on the read side (mostly untouched). **Zero new dependencies.**

---

## Global Constraints

Read every bullet before Task 1. These are verbatim, already-verified facts measured in this worktree on 2026-08-05 — **do not re-derive them.**

### Where / how to work

- Worktree: `C:\Users\Patrick\uct-worktrees\research-redesign`, branch `feat/research-calendar-redesign`, clean at `2916eb4e`. **This branch is identical to master and is LIVE in production for ~200 paying users.** Every change ships to real users.
- **Backend test command (from the worktree ROOT, never from `app/`):**
  ```
  python -m pytest tests/<file> -q
  ```
  Running pytest from `api/` or `app/` silently reports "no tests ran" — a green that means nothing. **`pytest-timeout` is NOT installed**; do not add `--timeout=` flags, they will error.
- **Frontend test command:** `cd app && npx vitest run <path>` (fallback `--pool=threads` on OOM). `app/node_modules` is a **junction** — never delete it.
- Commit after every task. **Never `git add -A`** — shared worktree; `git add` only the files the task names. **Do not push** without explicit owner approval.
- **Deploy window: ≥4:20 PM ET or <9:15 AM ET** (`.git/hooks/pre-push` enforces it). Nothing in this plan ships mid-session.
- Partner-owned, untouchable: `app/src/pages/OptionsFlow.jsx`, `api/routers/schwab_router.py`, `api/routers/live_massive_router.py`, `api/massive_ws_worker.py`, `api/services/massive_processor.py`.
- **Never print an API key value.** Keys live in `C:\Users\Patrick\morning-wire\.env` (`FMP_API_KEY`, `FINNHUB_API_KEY`, `MASSIVE_API_KEY`, `FINVIZ_API_KEY`, `ALPHAVANTAGE_API_KEY`). Probe scripts must print status codes and row counts only.

### Runtime law — where things are allowed to run

- The web pod is **ONE uvicorn process = one event loop + one shared anyio threadpool (64)**. An unbounded or slow external call on the request path is the documented **524-outage class** here.
- **Every task below states where its code runs.** A task that adds a provider call must state: request path (must be bounded + timeout) or background (scheduler / daemon thread).
- **Never sleep on the request path to wait for rate-limit budget.** `finnhub_client._fh_take_token()` returns `True`/`False` immediately and never blocks — that is deliberate (`api/services/finnhub_client.py:101-108`). Copy that contract, not a sleep.
  - ⚠️ **`engine._av_get` violates this today** — `api/services/engine.py:172-178` sleeps up to **13 s while holding `_av_lock`**, and it is reachable from `GET /api/earnings-analysis/{sym}`. Task 12 removes it from the request path.

### Honest-degradation law

- **Absent renders as absent — never a fabricated or zero value.** `Number(null) === 0` has bitten this repo **nine** times. Python side: explicit `is None` checks, never truthiness (a real `0.0` surprise is data). JS side: `const num = (v) => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }`.
- **Never cache a failed or partial fetch as if complete.** The canonical correct implementation already in-repo is `api/services/earnings_table.py:443-466`:
  ```python
  partial = not result["annual"] or not result["quarterly"]
  if partial:
      cache.set(ckey, result, _EMPTY_TTL)   # short — self-heals in minutes
      return result                          # NOT persisted
  cache.set(ckey, result, ttl)
  snap_store.put(_SNAP_KIND, ticker, result, ttl, now=now)
  ```
  Its three properties are the rule for **every** cache write in Phase 4: **(1)** a partial is still *served*; **(2)** it gets the failure TTL, not the success TTL; **(3)** it never reaches a persistent store.
- A **short, separately-named negative-cache TTL is CORRECT** (`bars_sanitize.py:53-54`, `calendar_sector_read.py:34-35`). Reusing the *success* TTL for a `_miss` sentinel is the bug. Distinguish these; do not "fix" a correct negative cache.

### Test-oracle law

- **A check is real only if something FAILS on it.** Every task's verification names an assertion that must fail when the guarded behaviour is removed.
- **Mutation control is mandatory for any test-change claim:** break the implementation deliberately, confirm the test FAILS (**read the exit code, not a grep of output**), restore **in place** (never `git stash` — `lesson_git_stash_keep_index_mutation_harness`), confirm it passes. A runner that never starts scores a perfect "KILLED" — always include an unmutated control.
- **No test may depend on the day it runs.** Pass an explicit `now`/`nowMs`. Eight tests once failed weekend-only.
- **Coverage numbers are the acceptance standard**, matching the two migrations already landed: price-target coverage went **0/10 → 6/6** (`fb0fa7d9`), earnings-calendar capture went **0 rows → 4,666 rows / 739 captured** (`2916eb4e`). Every migration task below must produce a before/after number of that kind.

---

## The measured picture (do not re-derive)

| provider | modules | tier | reality |
|---|---|---|---|
| Massive | 105 | paid | solid |
| yfinance | 96 | free / unofficial | works, no SLA |
| **Finnhub** | **40** | **free, 60 calls/min** | **most-used, weakest** |
| Finviz | 20 | paid Elite | fine |
| **FMP** | **18** | **paid Premium** | **strongest, underused** |
| **AlphaVantage** | **10** | **free, 25 req/DAY** | **exhausted every day observed** |

### Live probe, 2026-08-05 — FMP plan capability

**38 FMP `stable/*` endpoints probed. All 38 returned HTTP 200 with real rows.** There is no endpoint in this plan that is speculative. Verified working and on-plan:

`profile` · `quote` · `batch-quote-short` · `grades-consensus` · `grades` · `grades-historical` · `price-target-consensus` · `price-target-news` · `earnings` · `earnings-calendar` · `earnings-surprises-bulk` · `ipos-calendar` · `ipos-disclosure` · `insider-trading/search` · `insider-trading/latest` · `insider-trading/statistics` · `key-metrics-ttm` · `ratios-ttm` · `financial-growth` · `earning-call-transcript` · `earning-call-transcript-dates` · `earning-call-transcript-latest` · `earnings-transcript-list` · `company-notes` · `stock-peers` · `market-capitalization` · `shares-float` · `dividends` · `splits` · `dividends-calendar` · `splits-calendar` · `news/stock` · `news/general-latest` · `news/press-releases` · `analyst-estimates` · `institutional-ownership/symbol-positions-summary` · `economic-calendar` · `company-screener` · `sector-performance-snapshot`

### Live probe, 2026-08-05 — Finnhub plan capability

Probed **three rounds, 10 s apart**, to separate a plan refusal from a transient throttle:

| endpoint | round 1 | round 2 | round 3 | verdict |
|---|---|---|---|---|
| `/stock/upgrade-downgrade` | **403** | **403** | **403** | **PERMANENTLY FORBIDDEN** |
| `/stock/transcripts/list` | **403** | **403** | **403** | **PERMANENTLY FORBIDDEN** |
| `/stock/price-target` | 403 | — | — | PERMANENTLY FORBIDDEN (known, `fb0fa7d9`) |
| `/stock/recommendation` | 429 | 200 | 200 | works; throttles |
| `/stock/earnings` | 429 | 200 | 200 | works; throttles |
| `/calendar/earnings` | 429 | 200 (549 rows) | 200 (549 rows) | works; throttles |
| `/stock/profile2` · `/quote` · `/stock/metric` · `/calendar/ipo` · `/stock/insider-transactions` | 200 | — | — | work |

> **Honesty note for implementers:** the round-1 429s above were **self-induced by my own probe burst**, not proof of a production throttle at that moment. The production throttle evidence is the separately-observed incident: `/calendar/earnings` returned **HTTP 429, 0 rows at 17:15 ET**, silently producing `{'captured': 0}` for a permanent-data job. Treat the 403s as hard facts and the 429s as a demonstrated-but-intermittent risk. Do not overstate either.

### The field that has no second source

`GET /calendar/earnings` (Finnhub) returns per row:
```json
{"symbol":"AAOI","date":"2026-08-06","hour":"amc","quarter":2,"year":2026,
 "epsEstimate":0.0153,"epsActual":null,"revenueEstimate":194287968,"revenueActual":null}
```
Measured on 2026-08-06: **549 rows; `hour` non-empty on 423 (77%); `quarter`+`year` present on 549/549 (100%).**

`GET stable/earnings-calendar` (FMP) union-of-keys across 2,197 rows for the same day:
```
['date','epsActual','epsEstimated','lastUpdated','revenueActual','revenueEstimated','symbol']
```
**No `hour`. No `quarter`. No `year`.** Confirmed also for `stable/earnings` (per-symbol). `stable/earnings-calendar-confirmed` and `stable/earning-calendar-confirmed` both **404**. See §"What cannot be fixed."

---

## Section A — Complete Finnhub call-site inventory

40 source modules reference Finnhub. Of those, **21 make a network call**; the rest are comments, tests, prewarm wrappers, or frontend consumers of a Finnhub-derived field. All REST callers now route through `api/services/finnhub_client.fh_get` (`6f5dd96a`) — that rations the budget fairly; **it does not create capacity, and it cannot rescue a 403.**

### A1 — Endpoints in use, with a viable paid equivalent

| # | file:line | Finnhub endpoint | feeds | path | FMP equivalent (probed 200) | task |
|---|---|---|---|---|---|---|
| 1 | `api/services/catalyst/analyst_actions.py:84` | `/stock/upgrade-downgrade` **403** | `analyst_meta` on catalyst rows → CatalystTable thesis | background (catalyst engine) | `stable/grades` | **T1** |
| 2 | `api/services/transcripts.py:40` | `/stock/transcripts/list` **403** | transcript summary → EarningsModal | request `/api/transcripts/{sym}` | `stable/earning-call-transcript-dates` | **T2** |
| 3 | `api/services/transcripts.py:54` | `/stock/transcripts` | transcript body → Claude summarizer | request | `stable/earning-call-transcript` | **T2** |
| 4 | `api/routers/earnings.py:199` | `/stock/transcripts/list` **403** | diagnostic probe | request (debug) | same as #2 | **T2** |
| 5 | `api/services/earnings_estimates.py:191` | `/stock/price-target` **403** | `price_target` in earnings intel | request `/api/earnings/intel/{sym}` | `stable/price-target-consensus` | **T6** |
| 6 | `api/services/earnings_estimates.py:177` | `/stock/recommendation` | `consensus` in earnings intel | request | `stable/grades-consensus` | **T5** |
| 7 | `api/services/call_recap.py:342` | `/stock/recommendation` | rating-change context in AI call recap | request `/api/earnings/call-recap/{t}` | `stable/grades-consensus` | **T5** |
| 8 | `api/services/earnings_enrichment.py:194` | `/stock/recommendation` | `revisions` leg of EarningsModal | background prewarm + request | `stable/grades-consensus` | **T5** |
| 9 | `api/services/earnings_estimates.py:152` | `/stock/earnings` (limit 4) | `beat_history` in earnings intel | request | `stable/earnings` | **T7** |
| 10 | `api/services/earnings_estimates.py:455` | `/stock/earnings` (`_history_limit`) | `get_year_earnings` EPS-only fill | request + background | `stable/earnings` | **T7** |
| 11 | `api/services/earnings_estimates.py:843` | `/stock/earnings` (limit 16) | chart earnings markers | background (12 h + disk) | `stable/earnings` | **T7** |
| 12 | `api/services/ticker_meta.py:62` | `/stock/profile2` | name / sector / industry → chart watermark, ticker search | request + prewarm daemon | `stable/profile` | **T8** |
| 13 | `api/services/ticker_logos.py:94` | `/stock/profile2` | `logo` URL (4th in the source chain) | background prewarm | `stable/profile` | **T8** |
| 14 | `api/services/industry_map.py:183` | `/stock/profile2` | sector/industry SQLite fallback | background (weekly) | `stable/profile` | **T8** |
| 15 | `api/routers/fundamentals.py:43` | `/stock/metric?metric=all` | fwd-PE, 52w range, margins → Fundamentals strip | **request path** | `stable/key-metrics-ttm` + `stable/ratios-ttm` + `stable/quote` | **T9** |
| 16 | `api/services/insider.py:35` | `/stock/insider-transactions` | Insider Activity tile + TickerPopup | request (4 h cache) + 10-wide background feed | `stable/insider-trading/search` | **T10** |
| 17 | `api/services/ipo_calendar.py:29` | `/calendar/ipo` | IPO chips on Calendar | request (cached) | `stable/ipos-calendar` | **T11** |

### A2 — Endpoints in use with **no** full equivalent (must stay Finnhub)

| # | file:line | endpoint | why it must stay | mitigation |
|---|---|---|---|---|
| 18 | `api/routers/calendar.py:435` (`_backfill_past_days`) | `/calendar/earnings` | needs `hour` for BMO/AMC bucketing of finished days | **T13** dual-source |
| 19 | `api/routers/calendar.py:566` → `:615`, `:876` (`_fh_get_month`) | `/calendar/earnings` | month + range week; `hour` drives `date_est` | **T13** |
| 20 | `api/services/calendar_alerts.py:107` | `/calendar/earnings` | pre-report alerts keyed on session | **T13** |
| 21 | `api/services/implied_store.py:605` (`_finnhub_today_enrichment`) | `/calendar/earnings` | **the only source of `quarter`/`year`** | **T4** — widen it |
| 22 | `api/services/implied_store.py:441` (`_finnhub_reporters`) | `/calendar/earnings` | fallback reporter list w/ fiscal identity | **T4** |
| 23 | `api/services/earnings_table.py:105` | `/calendar/earnings` | forward-quarter strip | **T13** |
| 24 | `api/services/engine.py:753`, `:793` | `/calendar/earnings` | BMO/AMC dashboard buckets | **T13** |
| 25 | `api/services/engine.py:1022`, `:1374` | `/company-news` | per-symbol news sweep | keep (FMP `news/stock` added as merge source in **T14**) |
| 26 | `api/services/realtime_stream.py:24` | `wss://ws.finnhub.io` | live tick prices | **keep** — Massive push already covers *bars*; the Finnhub poll is the arbitrated fallback (`barsStreamManager` design). Do not touch. |
| 27 | `tools/theme_curation/liveness.py:26` | `/quote` | offline curation tool, not user-facing | leave |

### A3 — Modules that reference Finnhub but make no call

`api/main.py` (env + startup log) · `api/routers/admin_api_health.py:31` (key registry) · `api/routers/bars.py`, `api/routers/stream.py`, `api/routers/modelbook.py`, `api/services/bar_broadcaster.py`, `api/services/trade_conditions.py` (comments / SSE plumbing) · `api/services/calendar_date_integrity.py`, `api/services/calendar_week_poster.py`, `api/services/awareness/engine.py`, `api/services/journal_two/coach_chat_tools.py`, `api/services/research/ownership.py`, `api/services/voice_agents.py`, `api/services/voice_market_tools.py`, `api/services/voice_tool_impls.py`, `api/services/ticker_logos_prewarm.py`, `api/services/ticker_names_prewarm.py`, `api/services/catalyst/engine.py`, `api/services/catalyst/sources.py` (all consume a Finnhub-derived field via another service, or name it in a docstring) · `tools/implied_backfill_probe.py`, `tools/market_open_chart_check.py` (diagnostics) · 12 frontend files consume Finnhub-derived JSON but never call Finnhub.

---

## Section B — AlphaVantage inventory (25 requests/DAY)

**7 network call sites in 5 modules.** There is **no shared AV client** analogous to `finnhub_client.py`. `engine._av_get` (`api/services/engine.py:172`) serializes at ≥13 s — tuned for the *5/min* limit, **not** the 25/day limit — and **only one of the seven sites uses it**. The other six issue bare `requests.get` with no quota accounting, all against the same daily budget.

**AV returns HTTP 200 with a `Note`/`Information` body on throttle.** Sites that do **not** check for that treat a rate-limit as "no data":

| # | file:line | `function=` | feeds | path | fallback chain | throttle-aware? | verdict |
|---|---|---|---|---|---|---|---|
| B1 | `api/services/engine.py:281` | `EARNINGS` | `yoy_eps_growth`, `beat_streak`, `beat_history` → EarningsModal Key Takeaways; `hist_stats` → Calendar reactions; `setup_grade.avg_abs_move_pct` | **request** `/api/earnings-analysis/{sym}` + 4 scheduled warms | FMP `stable/earnings` first, AV second | ✅ raises | **T12** — drop AV leg; kill the 13 s request-path sleep |
| B2 | `api/services/earnings_estimates.py:504` | `EARNINGS` | `get_year_earnings` → Fundamentals quarter strip, Model Book, `/r/earnings-history` | request + `fundamentals_monitor` cold tail | FMP → Finnhub → **AV** → yfinance; gated to closed years | ❌ `if "quarterlyEarnings" not in j: return []` | **T12** — delete the leg |
| B3 | `api/services/engine.py:1912` | `NEWS_SENTIMENT` | `/api/news` dashboard tile, `/api/chart-news/{t}` markers, voice `get_news` | stale-while-revalidate; first cold call blocks | AV + EDGAR → RSS | ✅ sets `_av_rate_limited` but **logs nothing** | **T14** — FMP `news/stock` + `news/general-latest` |
| B4 | `api/services/av_transcripts.py:96` | `EARNINGS_CALL_TRANSCRIPT` | verbatim transcript + keyword search + TTS in EarningsModal | **request** `/api/earnings/transcript/{t}` | FMP `fmp_transcripts` **first**, AV second | ✅ `_THROTTLED` sentinel | **T3** — demote to disabled-by-default |
| B5 | `api/services/catalyst/sources.py:807` | `NEWS_SENTIMENT` | `av_news` signal → catalyst score + Opus thesis | background; **off by default** (`CATALYST_AV_NEWS_ENABLED`) | none | ❌ | **T14** — repoint if ever enabled |
| B6 | `api/routers/earnings.py:142` | `EARNINGS` | `/api/debug/earnings-sources/{sym}` JSON only | **request, UNAUTHENTICATED** | none | ❌ | **T3** — admin-gate |
| B7 | — | — | `api/routers/admin_api_health.py:31` is a key-presence registry entry, not a call | — | — | — | — |

**What each one actually needs, and where it should come from:**

- B1 / B2 — quarterly EPS + revenue actual vs estimate. **FMP `stable/earnings` supplies both** (probe: `{"symbol":"AAPL","date":"2026-07-30","epsActual":2.02,"epsEstimated":1.89,"revenueActual":109417000000,"revenueEstimated":109038900000}`). AV supplies EPS only and is strictly worse. **Delete both AV legs.**
- B3 / B5 — market news with per-ticker relevance. **FMP `stable/news/stock?symbols=` + `stable/news/general-latest` + `stable/news/press-releases`** all return 200 with `symbol`, `publishedDate`, `publisher`, `title`, `text`, `site`, `image`. AV's sentiment score has no FMP equivalent; it is used only as a soft nudge in `catalyst/scoring.py:136-138` and is off by default. Drop the sentiment field rather than keep a 25/day dependency for it.
- B4 — verbatim transcript text. **FMP `stable/earning-call-transcript?symbol=&year=&quarter=` returns full content** (probe: AAPL Q4 2025, full body) and `stable/earning-call-transcript-dates` returns 84 historical quarters. FMP is already primary here; AV is a legacy second leg burning up to **4 calls per cold ticker** (`_MAX_PROBE = 4`).
- B6 — nothing. It is a diagnostic that any anonymous caller can use to drain the daily budget from outside.

**Conclusion: AlphaVantage is not required for any user-facing field.** After T3, T12 and T14 the only remaining AV call is B5, which is disabled by default.

---

## Section C — Partial/failed-cache audit

Three instances were found and fixed on 2026-08-04/05 (`get_earnings_intel`, `earnings_table`, and the earlier market-cap poison). A systematic sweep of every `TTLCache` / module-dict cache / `lru_cache` / persistent store in `api/` found **26 more**. Bug shapes: **(a)** `except → {}` then cached; **(b)** N-leg aggregate cached at the success TTL when some legs failed; **(c)** a budget/deadline-shed partial batch cached as complete; **(d)** `result or []` erasing the failed/empty distinction; **(e)** partial written to a **persistent** store; **(f)** a negative cache reusing the *success* TTL.

### HIGH

| # | cache write | failure path | cache / TTL | what the user sees | shape | task |
|---|---|---|---|---|---|---|
| C1 | `api/services/research/financials.py:166` | `:121-125` (12 s pool timeout → `None`), `:142-145` | `research_fin::{SYM}`, **48 h** | Research → Financials tab **entirely blank for two days** | a+b | **T15** |
| C2 | `api/services/earnings_estimates.py:751` **+ `:752` disk write** | `:863-864`, `:914-915`, `:963-964`, `:924` (`bounded_call` → `([], [])`) | mem 12 h **+ `/data/chart_markers/{T}.json`** | no earnings/split/dividend markers on that chart ≥24 h, survives redeploy | b+e | **T18** |
| C3 | `api/services/analyst_grades.py:141` | `:123-138` four legs → `None` | `{"_miss": True}` at **`_TTL` = 6 h** (`:26`) | Analyst Grades blank 6 h after a 30-second FMP blip | f (+b at `:151`) | **T16** |
| C4 | `api/services/analyst_intel.py:148` | `:115-125`; `:144` `actions or []` | `analyst_intel::{SYM}`, 6 h | "no analyst coverage" on a mega-cap | a+b+d | **T16** |
| C5 | `api/services/research/ownership.py:204` | `:165-169`, `:186-195` | `research_own::{SYM}`, 12 h | Ownership tab blank 12 h | a+b | **T15** |
| C6 | `api/services/research/estimates.py:163` | `:133` `_fetch(sym) or {}`; `:146-149` | 12 h | no forward EPS/rev, no revisions | b+d | **T15** |
| C7 | `api/services/research/ratings.py:343` | `:239,:245,:256,:264,:292` | 12 h | composite + component grades blank 12 h | b | **T15** |
| C8 | `api/routers/calendar.py:1890` | `:1875-1888` (Finviz then Massive both fail; also `FINVIZ_API_KEY` unset → `fv_ok` always False at `:1818`) | **24 h on a past date** | price/avg-vol/mcap blank all day; vol/price/mcap **filters silently exclude everything**; importance hierarchy flattens | a+b | **T17** |
| C9 | `api/services/ticker_logos.py:285` | every source swallows to `None` (`:100,:110,:160,:195`) | `/data/logo_cache/{SYM}.miss`, **`_MISS_TTL` = 7 days** (`:19`) | monogram instead of logo across Calendar/EarningsModal for a **week**; `run_miss_retry` has **no scheduler entry** | e+f | **T18** |
| C10 | `api/services/dividends_calendar.py:186` | `:175-180` 25 s wall-clock deadline, `except: pass` per future | 12 h | dividend/split chips missing for the shed tail, indistinguishable from "pays no dividend" | c | **T20** |
| C11 | `api/routers/modelbook.py:385` | `:382-383` bare `except: pass` | 24 h | Model Book year stats "—" for a day. **`:552-553` in the same file does it correctly** (`ttl=86400*30 if bars else 1800`) | a | **T19** |

### MED

| # | location | issue | task |
|---|---|---|---|
| C12 | `api/routers/calendar.py:1245` | unconditional `cache.set("calendar_weekly", …, 600)`. `_WEEKLY_STALE.serve` checks `fresh()` **first** (`serve_stale.py:127-129`), so the poisoned empty week is served **in preference to** the known-good stale payload. `_weekly_payload_is_good` (`:1085-1095`) gates the slot, not the cache. | **T17** |
| C13 | `api/services/theme_performance.py:338` + `:340` `_save_to_disk` | no completeness check; `:333-337` stamps `status:"ok"` regardless; `_load_from_disk` accepts up to **26 h** and the background recompute only fires when disk is *empty* | **T18** |
| C14 | `api/services/massive.py:377` | `except → result = False` cached 24 h; consumer `:834-835` then shows **TQQQ/SQQQ/SOXL in Top Movers as ordinary stocks** | **T19** |
| C15 | `api/services/groups.py:436`, `:456` | `cache.set(key, [], _AI_PEERS_TTL)` at 6 h on a transient refusal; `ticker_meta._base_meta:87-117` returns `{name: None}` uncached when yfinance **and** Finnhub both fail, so a double-provider blip is indistinguishable from a nameless ticker | **T19** |
| C16 | `api/routers/calendar.py:2200` | universe-wide `_bounded_em` failure (`:2131-2134`) pinned up to **4 h**. The sibling Finnhub-budget case at `:2174-2184` is **already correct** — extend the same `throttled` idea to `with_em == 0 and total > 0` | **T17** |
| C17 | `api/services/engine.py:1279`/`:1281`, `:1639`/`:1642` | TTL + `_ai_store.put` decide on the **AI leg only**; `pre_earnings`/`hist_moves`/`revisions`/`beat_surprises`/`implied_move`/`key_quotes` can each be `None` and still be persisted for 12 h. `signals_hash` then makes it **sticky indefinitely** | **T20** |
| C18 | `api/services/insider.py:61`, `:101` | `:61` caches `{"data": []}` (the plan-forbidden/throttled shape) for 4 h; `:101` caches an empty feed for 1 h when the budget is exhausted | **T20** |
| C19 | `api/services/research/snapshot.py:164`, `api/routers/fundamentals.py:197` | disk write is correctly guarded (`:165-170`, `:198-201`), the preceding `cache.set` is not | **T15** |
| C20 | `api/services/engine.py:2102` | `_ttl = 1800 if (result and not result[0].get("error")) else 600` — an **RSS-only** fallback has no `error` key on item 0, so a rate-limited AV run caches the degraded feed for the **full 30 min**. `_store_news` (`:1834`) also promotes it into `_news_stale`. (CLAUDE.md's "600s on RSS fallback" does not match the code.) | **T14** |

### LOW

| # | location | issue | task |
|---|---|---|---|
| C21 | `api/services/engine.py:496-498` | `except → cache.set(result_with_error, 3600)`; local-dev-only reachability | **T19** |
| C22 | `api/services/engine.py:442`, `:468` | `snap_fn(real) or {}` → `snap.get(ticker, 0.0)` renders **every** theme at exactly `+0.00%`. The pseudo-ticker branch at `:466` already defaults to `None` correctly | **T19** |
| C23 | `api/services/stock_brief/service.py:118`, `:164` | `except → cache partially-built` at 120 s / 900 s | **T20** |
| C24 | `api/services/watchlist_performance.py:59-63` | per-ticker failure writes an all-`None` row into a 5-min map | **T20** |
| C25 | `api/services/awareness/engine.py:119-123` | per-day `except → continue` then `_EARNINGS_MEMO[key] = …` for 1 h | **T20** |
| C26 | `api/services/industry_map.py:146-148` + `:125-129` | weekly Finviz bulk `ON CONFLICT DO UPDATE SET sector = excluded.sector` clobbers a good yfinance-resolved sector with `None`. Adjacent class (destructive overwrite) | **T19** |
| C27 | `api/routers/calendar.py:2696` | empty most-anticipated PNG cached 1800 s (6 h for a past week) | **T17** |

### Already correct — the patterns to standardize on

`earnings_table.py:443-466` (canonical) · `earnings_estimates.py:213-218`, `:225-248`, `:686-687`, `:705-714` · `bars_sanitize.py:53-54` + `:107-111` · `calendar_sector_read.py:34-35` · `transcripts.py:18-19` · `fmp_transcripts.py:38-39` · `sector_strength.py:121-140` · `industry_map.py:137-139`, `:202-203`, `:354-356` · `theme_performance.py:84-85` · `research/snapshot.py:165-170` · `routers/fundamentals.py:198-201` · `routers/modelbook.py:552-553` · `calendar.py:972-977`, `:1069-1072`, `:1730-1737` · **`calendar.py:2151-2184`** (best-in-class: snapshot a provider-denial counter *before* the fan-out and force a short TTL if it moved — mechanical detection of "shed, not absent") · `serve_stale.py:151-166` · `implied_store.py:374-423`, `:735-738`.

---

## Section D — What CANNOT be fixed with current subscriptions

The owner's premise is that the data is obtainable between the existing APIs. **It is true for every field in this plan except two.** Both are on the same endpoint.

### D1 — BMO/AMC session (`hour`) — **no paid second source**

- **Finnhub `/calendar/earnings` is the only API on the stack that returns it** (77% non-empty; free tier).
- FMP: absent from `earnings-calendar` and `earnings`; `earnings-calendar-confirmed` **404s**.
- Massive/Polygon: a market-data feed; no earnings-session field.
- Finviz Elite: the screener export carries an `Earnings` column with a `a`/`b` suffix for the **forward schedule only** — it rolls to next quarter the moment a company reports, so it cannot fill a finished day (this is exactly the failure `_backfill_past_days` was written to fix, 2026-07-30).
- **EarningsWhispers is the real second source and is already in use** for today + future days — it owns the session and the anticipation rank (`api/routers/calendar.py:600`). It is a scraped forward schedule, not an archive, and is not a subscription we can escalate.
- **Net:** for **past** days the session comes from Finnhub or nowhere. **Mitigation, not a fix:** T13 keeps Finnhub as the session oracle but stops the *rest* of the calendar from failing with it, and renders an unknown session as **`tbd`** — never coerced into `amc` (`calendar.py:80` already states this rule; do not weaken it).
- **Tier upgrade that would close it:** Finnhub paid plans expose `/calendar/earnings` with higher limits but do not add a field we lack — the field is already there. The gap is **rate limit, not data**. A Finnhub paid tier (~$50–100/mo) would remove the throttle risk on the one endpoint we genuinely cannot replace. **Recommendation: do not buy it yet.** T13 + T21 make the throttle *visible* and *survivable*; revisit only if the coverage monitor shows session coverage dropping below its threshold on real traffic. That is a decision with data behind it rather than a guess.

### D2 — fiscal `quarter` / `year` on the earnings calendar — **no bulk second source**

- Finnhub returns it on **100%** of rows. FMP returns it on **zero**.
- **Partially recoverable:** FMP `stable/earning-call-transcript-dates?symbol=` returns `{"quarter":3,"fiscalYear":2026,"date":"2026-07-30"}` — the correct fiscal identity, but **one call per symbol**, so it cannot back a 549-row day. It is a viable *per-symbol repair* for the handful of rows that matter (T4 uses this as leg 3).
- **Net:** for a bulk calendar sweep, Finnhub or nothing. T4's fix is to spend **2 Finnhub calls per night** (one per day in the capture window) instead of the current one, which closes the gap for the only consumer that needs it.

### D3 — AlphaVantage NEWS_SENTIMENT score

The numeric sentiment score has no equivalent on FMP, Finviz, or Massive. It feeds one soft scoring nudge (`catalyst/scoring.py:136-138`) behind a flag that is **off in production**. **Recommendation: drop the field rather than pay.** AV's paid tier is ~$50/mo for a signal nothing currently consumes.

### D4 — Everything else is obtainable

Price targets, analyst grades + grade history, consensus, EPS/revenue actual-vs-estimate, company profile, key metrics + ratios, insider transactions, IPO calendar, transcripts (full text **and** the quarter index), dividends, splits, institutional ownership, economic calendar, news — **all verified 200 on the current FMP Premium plan today.** No new spend is required for any of them.

---

## Phase 0 — Dead endpoints (fix what is broken right now)

These three tasks fix fields that are **blank in production today** and will stay blank forever without a code change. Highest impact ÷ lowest effort in the plan.

### Task 1 — `catalyst/analyst_actions.py`: `/stock/upgrade-downgrade` 403 → FMP `stable/grades`

- **Runs:** background only (catalyst engine refresh, `api/main.py:3123-3168`). Never on a request path.
- **Impact × frequency:** every catalyst refresh, every day, since the plan changed. `finnhub_recent_action()` has been returning `None` **100% of the time**.

**Steps**
- [ ] Read `api/services/catalyst/analyst_actions.py` fully. The call is `api/services/catalyst/analyst_actions.py:84`:
      `rows = fh_get("/stock/upgrade-downgrade", {"symbol": ticker.upper()}, timeout=_TIMEOUT)`
- [ ] Add `_fmp_recent_action(ticker, within_hours)` using `GET https://financialmodelingprep.com/stable/grades?symbol={T}` (verified 200, 1,784 rows for AAPL).
- [ ] **Field-shape mapping** (Finnhub → FMP), verified against live payloads:
      | consumer field | Finnhub `/stock/upgrade-downgrade` | FMP `stable/grades` |
      |---|---|---|
      | `action` | `action` (`"up"`/`"down"`/`"main"`) | `action` (`"upgrade"`/`"downgrade"`/`"maintain"`/`"initialise"`) — **normalize to the existing vocabulary in `_norm_meta`** |
      | `company` | `company` | `gradingCompany` |
      | `fromGrade` | `fromGrade` | `previousGrade` |
      | `toGrade` | `toGrade` | `newGrade` |
      | recency sort | `gradeTime` (unix int) | `date` (`"2026-07-31"`, **ISO date string, no time**) |
- [ ] ⚠️ **The sort key changes type.** `:87` is `rows.sort(key=lambda x: x.get("gradeTime", 0), reverse=True)`. FMP has no `gradeTime`. Parse `date` to a date and compare dates; **do not** `Number()`-coerce or default a missing date to `0` — a row with no date must be **excluded**, not sorted to the bottom as epoch-zero.
- [ ] ⚠️ **`within_hours` becomes coarser.** FMP gives day granularity; a 36 h window over ISO dates must be implemented as "date within the last 2 calendar days," and the docstring must say so. Do not silently pretend to hour precision.
- [ ] Keep the Finnhub path as a **fallback after** FMP (it costs nothing — `fh_get` short-circuits on the cached 403 for 24 h, `finnhub_client.py:239-240`).
- [ ] Return `None` on total failure. Do **not** return an empty `_norm_meta` dict.

**Verification**
- [ ] Write `tests/test_analyst_actions_fmp.py`: a fake `requests.get` returning the real FMP row shape asserts `action`/`company`/`fromGrade`/`toGrade` map correctly; a row with `date: None` is **excluded**; an all-`maintain` set older than the window returns `None`.
- [ ] **Coverage number (the acceptance gate):** write `tools/probe_analyst_actions.py` that calls `finnhub_recent_action` for 10 large caps with recent activity. **Before: expect 0/10** (403). **After: require ≥6/10.** Record both numbers in the task report.
- [ ] Mutation control: revert the `previousGrade`→`fromGrade` mapping, confirm the shape test **exits non-zero**, restore in place, confirm green.
- [ ] `python -m pytest tests/test_analyst_actions_fmp.py -q` from the worktree root.

---

### Task 2 — `transcripts.py`: `/stock/transcripts*` 403 → FMP transcripts

- **Runs:** request path (`GET /api/transcripts/{sym}` → EarningsModal). Both legs must keep their existing timeouts.
- **Impact:** the EarningsModal transcript section has been **permanently hidden** for every user. CLAUDE.md documents this as "Requires Finnhub premium — section hides when unavailable." **FMP closes it at no additional cost.**

**Steps**
- [ ] `api/services/transcripts.py:37-60` — replace both legs:
      - Leg 1 `fh_get("/stock/transcripts/list", {"symbol": symbol})` → `GET stable/earning-call-transcript-dates?symbol={S}` → `[{"quarter":3,"fiscalYear":2026,"date":"2026-07-30"}, …]` (84 rows for AAPL, **newest first**).
      - Leg 2 `fh_get("/stock/transcripts", {"id": transcript_id})` → `GET stable/earning-call-transcript?symbol={S}&year={fiscalYear}&quarter={quarter}` → `[{"symbol","period","year","date","content"}]`.
- [ ] **Field-shape mapping:** the existing return contract is `{text, quarter, year, title}`. Build `text` from FMP's single `content` string — **not** from a `parts` list. Finnhub returned `detail["transcript"]` as a list of speech entries concatenated at `:57+`; FMP returns one pre-joined string. Delete the join, keep the downstream truncation (first 3 K + last 4 K) unchanged.
- [ ] `quarter` ← `period` (`"Q4"` → int 4) or the index row's `quarter`; `year` ← `fiscalYear`; `title` ← synthesize `f"{symbol} Q{quarter} {year}"` (FMP has no title field).
- [ ] `api/routers/earnings.py:199` — same swap for the diagnostic probe.
- [ ] Preserve the existing negative-cache TTLs at `transcripts.py:18-19` (they are already correct — a short fail TTL distinct from the success TTL). Do **not** widen them.
- [ ] **Do not remove the "section hides when unavailable" behaviour.** A symbol with genuinely no transcript must still render absent, not an empty transcript box.

**Verification**
- [ ] `tests/test_transcripts_fmp.py`: index→detail happy path; empty index → `None` (not `{}`); a `content: ""` detail → `None`; assert the 3 K/4 K truncation still applies at the same boundaries.
- [ ] **Coverage number:** `tools/probe_transcripts.py` over 10 recent reporters. **Before: 0/10** (403). **After: require ≥8/10** — FMP returned 84 quarters for AAPL and a full body for Q4 2025.
- [ ] Mutation control on the `content`-vs-`parts` change: restore the list-join, confirm the test fails, restore in place.
- [ ] `python -m pytest tests/test_transcripts_fmp.py -q`

---

### Task 3 — Stop the AlphaVantage budget bleed

- **Runs:** B6 is a **request path with no auth**; B4 is a request path.

**Steps**
- [ ] `api/routers/earnings.py:54` — `debug_earnings_sources` has **no auth dependency** while its sibling routes do. Add `Depends(require_admin)` (`api.middleware.auth_middleware`). An anonymous caller can currently drain the 25/day budget from outside. ⚠️ Related standing lesson: `lesson_never_probe_a_mutating_endpoint_to_test_auth` — this route is read-only, so probing it is safe; do not generalize.
- [ ] `api/services/av_transcripts.py` — set the module default to **disabled** behind `AV_TRANSCRIPTS_ENABLED` (default `"0"`). FMP is already primary at `api/routers/earnings_intel.py:118-126`; after Task 2 + FMP's verified full-text coverage, AV is a legacy second leg costing up to **4 calls per cold ticker** (`_MAX_PROBE = 4`).
- [ ] `api/services/av_transcripts.py:187`, `:240`, `:244` — a **throttle** and a **genuine miss** both write the same `{"_throttle": True}` marker at `_CACHE_TTL_THROTTLE = 300`. Split them: a throttle must be retryable sooner (or not cached at all), a genuine miss may keep 300 s. This is bug shape (f).
- [ ] Delete the dead `_is_throttle` at `api/services/av_transcripts.py:143-147` — it always returns `False` and has no callers.
- [ ] `api/services/engine.py:1921-1923` — the NEWS_SENTIMENT rate-limit branch sets `_av_rate_limited = True` and **emits no log line at all**. Add a `_logger.warning("AV rate limit hit for NEWS_SENTIMENT: %s", …)`. The monitor in T21 needs this signal to exist.

**Verification**
- [ ] `tests/test_av_budget_guards.py`: anonymous `GET /api/debug/earnings-sources/AAPL` returns **401/403**; `AV_TRANSCRIPTS_ENABLED` unset makes `av_transcripts.get_transcript` return `None` **without a network call** (assert the fake `requests.get` was never called); a throttled response and a genuine miss produce **different** cache TTLs.
- [ ] Mutation control: remove the auth dependency, confirm the 401 assertion fails (exit code), restore in place.
- [ ] `python -m pytest tests/test_av_budget_guards.py -q`

---

## Phase 1 — The MOAT regression

### Task 4 — `implied_store`: fiscal identity is NULL on the primary path

**This is the highest-value finding in the plan.** Task 8b (`..d20417af`) resurrected the implied-vs-realized RICH/CHEAP chip by pairing on the provider's own `quarter`/`year` instead of `report_date` (which is a fiscal *period end*, not the announcement date). Then `2916eb4e` made **FMP the primary reporter list** — and FMP does not carry `quarter`/`year`.

- `api/services/implied_store.py:368-370` (the primary path) emits, for **every** row:
  ```python
  out.append({"sym": sym, "report_date": rd, "hour": "",
               "fiscal_year": None, "fiscal_quarter": None,
               "eps_estimate": _float_or_none(row.get("epsEstimated"))})
  ```
- `run_nightly_capture` calls `record_implied(..., fiscal_year=rep.get("fiscal_year"), fiscal_quarter=rep.get("fiscal_quarter"))` at `api/services/implied_store.py:739-741`.
- The repair `_finnhub_today_enrichment` / `_merge_today_enrichment` (`:587`, `:645`) exists — but **only for rows dated today**: `hint = hints.get(r.get("sym")) if r.get("report_date") == today_iso else None` (`:648`).
- `IMPLIED_CAPTURE_WINDOW_DAYS` defaults to `1`, so the window is `[today, today+1]`, and a **today**-dated row is *skipped* unless `hour == "amc"` (`:729-732`). **The normal capture is the T-1 row dated `today+1` — which is exactly the row the enrichment does not touch.**

**Net effect: the majority of permanent implied snapshots will be written with `fiscal_year = NULL, fiscal_quarter = NULL`, and the pairing key Task 8b introduced will not match.** This compounds with the known **ZERO-MIGRATION WINDOW**: `implied_snapshots` has 0 rows until ship + `IMPLIED_STORE_ENABLED=1`. Once it ships, this history is written wrong and is **UNRECONSTRUCTABLE** — the implied value at a past moment cannot be recomputed later.

- **Runs:** background only (nightly capture). The extra calls are 1 per day in the window — **2 Finnhub calls per night total.**
- **Ship before `IMPLIED_STORE_ENABLED=1`. This task gates that flag flip.**

**Steps**
- [ ] Generalize `_finnhub_today_enrichment(day_iso)` (`:587`) to `_finnhub_day_enrichment(day_iso)` — the body is already day-scoped and needs no change; only the name and docstring do.
- [ ] Generalize `_merge_today_enrichment(in_window, today_iso, hints)` (`:645`) to take a **`{day_iso: hints}` map** and match each row against its own `report_date`, not a single `today_iso`. Keep both existing invariants verbatim: **never overwrite a value the primary source already supplied**, and **never mutate the input dicts in place** (they are shared with `_REPORTERS_CACHE`).
- [ ] In `run_nightly_capture` (`:684-698`), replace the today-only trigger with: for **each distinct `report_date` in `in_window`** that has at least one row missing `fiscal_year` **or** `fiscal_quarter` **or** `hour`, fetch that day's enrichment once. Cap at `window_days + 1` calls (2 by default).
- [ ] **Leg 3 (per-symbol repair, bounded):** if after the merge a row destined for capture *still* has `fiscal_year is None`, call `GET stable/earning-call-transcript-dates?symbol={S}` once and take the row whose `date` is nearest the `report_date`. Verified shape: `{"quarter":3,"fiscalYear":2026,"date":"2026-07-30"}`. **Hard-cap this at 20 symbols per night** and skip entirely if the merge already resolved everything.
- [ ] **Refuse to write an unpaired permanent row.** If `fiscal_year` or `fiscal_quarter` is still `None` after all three legs, **do not `record_implied`** — count it as `summary["skipped_no_fiscal"]` and log it. A permanent row that can never pair is worse than an absent one, and this store is append-only. Do **not** default either field to `0` (`Number(null) === 0` class).
- [ ] Add `skipped_no_fiscal` to the `summary` dict at `:717` and to the log line at `:745`.

**Verification**
- [ ] `tests/test_implied_store_fiscal_identity.py`:
      - a `today+1` row from the FMP path with `fiscal_year=None` **gets enriched** from a stubbed day-enrichment and IS captured with the right `(fiscal_year, fiscal_quarter)`;
      - the same row with **both** Finnhub legs and the transcript-dates leg failing is **NOT written** and increments `skipped_no_fiscal`;
      - `_merge_today_enrichment` **does not mutate** its input list (assert object identity of the originals);
      - a row whose primary source already supplied `fiscal_quarter=2` is **not** overwritten by a hint saying `3`.
      - Every test passes an explicit `now` (weekday-clock law).
- [ ] **Coverage number:** run `run_nightly_capture` against the live providers with `IMPLIED_STORE_ENABLED` still off, via `tools/implied_backfill_probe.py`, and report `captured` split by `fiscal_year is not None`. **Before: expect ~0% of `today+1` rows to carry a fiscal identity. After: require ≥90%.**
- [ ] Mutation control: restore the `== today_iso` guard at `:648`, confirm the enrichment test **exits non-zero**, restore in place.
- [ ] `python -m pytest tests/test_implied_store.py tests/test_implied_store_fiscal_identity.py -q`

---

## Phase 2 — Finnhub → FMP migration

Every task in this phase follows the same shape: add an FMP-primary leg, keep Finnhub as an explicit fallback, map fields against the probed payloads below, and prove a coverage number. **Do not delete the Finnhub leg** — it costs nothing once FMP succeeds first, and it is the fallback if FMP has an outage.

### Task 5 — `/stock/recommendation` → FMP `stable/grades-consensus` (3 call sites)

- **Runs:** all three are reachable from a request path.
- **Sites:** `api/services/earnings_estimates.py:177` · `api/services/call_recap.py:342` · `api/services/earnings_enrichment.py:194`

**Field-shape mapping** (probed):

| consumer need | Finnhub `/stock/recommendation` (list, newest first) | FMP `stable/grades-consensus` (list of 1) |
|---|---|---|
| strong buy | `strongBuy` | `strongBuy` |
| buy | `buy` | `buy` |
| hold | `hold` | `hold` |
| sell | `sell` | `sell` |
| strong sell | `strongSell` | `strongSell` |
| label | *derived* | `consensus` (`"Buy"`) — **use FMP's own label** |
| period | `period` (month string) | **absent** — use `stable/grades-historical` for a dated series |

- [ ] ⚠️ **Finnhub returns a monthly time series; FMP `grades-consensus` returns a single current snapshot.** Any consumer using more than `[0]` needs `stable/grades-historical?symbol=` instead (probed: `[{"symbol","date","analystRatingsStrongBuy","analystRatingsBuy","analystRatingsHold","analystRatingsSell","analystRatingsStrongSell"}, …]`, monthly). Check each of the three call sites: `earnings_enrichment.py:194` computes `revisions` and **does** use history → route it to `grades-historical`; the other two use the current snapshot → `grades-consensus`.
- [ ] Note the **key names differ between the two FMP endpoints** (`buy` vs `analystRatingsBuy`). Do not share one parser.
- [ ] Return `None` on failure; never a zero-filled counts dict (a real all-zero consensus is indistinguishable otherwise).

**Verification**
- [ ] `tests/test_recommendation_fmp.py` — shape tests for both endpoints; assert a failed fetch yields `None`, **not** `{"buy":0,"hold":0,…}`.
- [ ] **Coverage:** probe `get_earnings_intel` `consensus` for 10 large caps. **Record before/after; require ≥9/10 after.**
- [ ] `python -m pytest tests/test_recommendation_fmp.py tests/test_analyst_intel.py -q`

### Task 6 — Remove the dead `/stock/price-target` leg

- **Runs:** request path (`api/services/earnings_estimates.py:191`).
- `fb0fa7d9` already migrated the field to FMP `stable/price-target-consensus` (0/10 → 6/6). The Finnhub call at `:191` still fires, still 403s, and pays the `_FH_FORBIDDEN_TTL` re-probe once per 24 h per process.
- [ ] Reorder so FMP runs first; keep Finnhub only behind an `if fmp_result is None` guard, or delete the leg if `:203`'s comment confirms it is unreachable value.
- [ ] **Field mapping:** FMP `{"targetHigh":400,"targetLow":245,"targetConsensus":341.11,"targetMedian":355}`.
- [ ] Verification: assert the Finnhub URL is **not requested** when FMP returns a payload. `python -m pytest tests/test_earnings_intel_price_target_fallback.py -q` must stay green.

### Task 7 — `/stock/earnings` → FMP `stable/earnings` (3 call sites)

- **Sites:** `api/services/earnings_estimates.py:152` (request), `:455` (request + background), `:843` (background, 12 h + disk).
- FMP is **already** the primary in `_year_earnings_from_fmp`; these three are separate legs that still lead with Finnhub.

**Field-shape mapping** (probed):

| need | Finnhub `/stock/earnings` | FMP `stable/earnings` |
|---|---|---|
| EPS actual | `actual` | `epsActual` |
| EPS estimate | `estimate` | `epsEstimated` |
| revenue actual | **absent** | `revenueActual` ✅ |
| revenue estimate | **absent** | `revenueEstimated` ✅ |
| date | `period` | `date` |
| ordering | newest first | **newest first** |

- [ ] ⚠️ **`last_n` ordering is a landmine here.** A prior bug (T9 of the P2 plan) shipped `last_n` **oldest-first** while the model assumed newest-first — every reaction was attributed to the **wrong quarter**. Both APIs return newest-first; assert it explicitly in a test rather than assuming.
- [ ] FMP is strictly richer (adds revenue). Where a consumer only had EPS, **do not** synthesize a revenue of `0` — leave absent.
- [ ] Keep `_history_limit(year)` logic at `:455` (`min(400, (now−year+2)*4 + 16)`) — it exists because `stable/earnings` returns newest-first and a fixed limit dropped old years.
- [ ] **Coverage:** `beat_history` length for 10 symbols. Require **≥9/10 with 4 quarters** after.
- [ ] `python -m pytest tests/test_earnings_estimates_fiscal_key.py tests/test_year_earnings_window.py tests/test_earnings_table.py -q`

### Task 8 — `/stock/profile2` → FMP `stable/profile` (3 call sites)

- **Sites:** `api/services/ticker_meta.py:62` (request + prewarm daemon) · `api/services/ticker_logos.py:94` (background) · `api/services/industry_map.py:183` (background, weekly).

**Field-shape mapping** (probed — note the **unit change**):

| need | Finnhub `/stock/profile2` | FMP `stable/profile` |
|---|---|---|
| name | `name` (`"Apple Inc"`) | `companyName` (`"Apple Inc."`) |
| industry | `finnhubIndustry` (`"Technology"` — coarse) | `industry` (`"Consumer Electronics"` — **finer**) + `sector` |
| exchange | `exchange` (`"NASDAQ NMS - GLOBAL MARKET"`) | `exchange` (`"NASDAQ"`) + `exchangeFullName` |
| market cap | `marketCapitalization` = **4515147.38 (MILLIONS)** | `marketCap` = **4567767716000 (UNITS)** |
| website | `weburl` | `website` |
| logo | `logo` | *(no logo)* — logo chain keeps logo.dev/Parqet/FMP-logo/Clearbit |
| shares out | `shareOutstanding` (**thousands**) | via `stable/shares-float` → `outstandingShares` (units) |

- [ ] 🔴 **The market-cap unit differs by 10⁶.** `lesson_market_cap_cache_poison_and_finnhub_currency` is already on record here. Convert explicitly and assert the magnitude in a test. Also note Finnhub caps in **local currency**; FMP returns USD.
- [ ] `industry_map.py` currently stores Finnhub's coarse `finnhubIndustry` as an industry. FMP gives `sector` **and** `industry` separately — map them to the right columns, and see **C26 (T19)**: the weekly bulk refresh must stop clobbering a good value with `None`.
- [ ] `ticker_meta._base_meta:114-116` already has the correct partial-success guard (`if any(data.values())`) — preserve it.
- [ ] **Coverage:** name + sector + industry resolution over 200 cap_universe symbols. Record before/after; require **≥95% name, ≥90% industry** after.
- [ ] `python -m pytest tests/test_ticker_meta.py tests/test_ticker_logos.py tests/test_breadth_industries.py -q`

### Task 9 — `/stock/metric?metric=all` → FMP metrics trio

- **Runs: request path** (`api/routers/fundamentals.py:43`). Keep the existing `_TIMEOUT`.
- Finnhub `/stock/metric` returns one flat `metric` dict with ~150 keys. FMP splits it across three probed-200 endpoints: `stable/key-metrics-ttm` (EV multiples, current ratio, Graham number), `stable/ratios-ttm` (margins: `grossProfitMarginTTM`, `netProfitMarginTTM`, …), `stable/quote` (`yearHigh`, `yearLow`, `priceAvg50`, `priceAvg200`, `marketCap`).
- [ ] Enumerate **exactly which `metric` keys the frontend reads** before writing any code — grep `app/src/` for the consuming component and list them in the task report. Do not port all 150.
- [ ] Three calls where there was one. **Fan them out with a bounded pool and a hard total timeout**, or move the whole thing behind the existing warm/cache layer. State which in the task report. This is the 524 class — an unbounded 3× fan-out on the request path is not acceptable.
- [ ] Any metric with no FMP equivalent renders **absent**, not `0`.
- [ ] **Coverage:** count non-null fields in the `/api/fundamentals` response for 10 symbols. Require **no regression** vs. the Finnhub baseline; record both.
- [ ] `python -m pytest tests/test_fundamentals_router.py -q`

### Task 10 — `/stock/insider-transactions` → FMP `stable/insider-trading/search`

- **Runs:** request (4 h per-ticker cache, `api/services/insider.py:35`) + a 10-wide background feed (`:86-89`).

**Field-shape mapping** (probed):

| need | Finnhub (`data[]`) | FMP (top-level list) |
|---|---|---|
| person | `name` | `reportingName` |
| shares Δ | `change` (signed) | `securitiesTransacted` + `acquisitionOrDisposition` (`"A"`/`"D"`) — **sign must be derived** |
| shares held | `share` | `securitiesOwned` |
| price | `transactionPrice` | `price` |
| txn code | `transactionCode` (`"S"`,`"G"`,`"M"`) | `transactionType` (`"M-Exempt"`,`"F-InKind"`,`"S-Sale"`) — **remap `_classify_txn`** |
| dates | `transactionDate`, `filingDate` | `transactionDate`, `filingDate` |
| role | *absent* | `typeOfOwner` ✅ richer |

- [ ] 🔴 **The sign is not carried in FMP's quantity field.** Finnhub's `change` is signed; FMP gives a magnitude plus a direction letter. Deriving this wrong inverts buy/sell on the Insider Activity tile. Assert both directions in a test (`Number(null) === 0` family: an absent `acquisitionOrDisposition` must yield **exclusion**, not a default of "acquire").
- [ ] `_classify_txn` (`api/services/insider.py`) keys on Finnhub's single-letter codes — rewrite for FMP's hyphenated `transactionType` vocabulary and keep the Finnhub branch for the fallback path.
- [ ] Fix **C18** here (`:61` caches `{"data": []}` for 4 h; `:101` caches an empty feed for 1 h) — see T20's helper.
- [ ] **Coverage:** transaction rows for 15 large caps. Record before/after; require **≥12/15 non-empty** after.
- [ ] `python -m pytest tests/test_misc_endpoints.py -q` plus a new `tests/test_insider_fmp.py`.

### Task 11 — `/calendar/ipo` → FMP `stable/ipos-calendar`

- **Runs:** request, cached (`api/services/ipo_calendar.py:29`).

| need | Finnhub (`{"ipoCalendar":[…]}`) | FMP (top-level list) |
|---|---|---|
| symbol | `symbol` | `symbol` |
| company | `name` | `company` |
| date | `date` | `date` |
| exchange | `exchange` | `exchange` |
| status | `status` (`"expected"`/`"priced"`) | `actions` (`"Expected"` — **case differs**) |
| shares | `numberOfShares` | `shares` (**often `null`**) |
| price | `price` (`"10.00"` string) | `priceRange` (**often `null`**) |
| value | `totalSharesValue` | `marketCap` (**often `null`**) |

- [ ] ⚠️ **FMP's IPO rows are sparser** — `shares`/`priceRange`/`marketCap` were `null` on the sampled rows while Finnhub populated them. **Merge, do not replace:** FMP for breadth (173 rows for the sampled range), Finnhub for the numeric detail. `/calendar/ipo` is **not** 403 — it is one of the Finnhub endpoints that works.
- [ ] Normalize `actions` case before comparing to the existing status vocabulary.
- [ ] **Coverage:** IPO rows for a 30-day window with a non-null price. Record before/after; require **no regression** in populated-field count.
- [ ] `python -m pytest tests/test_ipo_calendar.py -q`

---

## Phase 3 — AlphaVantage retirement + calendar hardening

### Task 12 — Delete both AV `EARNINGS` legs and un-block the request path

- [ ] `api/services/engine.py:274-288` — delete the AV fallback in `_fetch_quarterly_history`. FMP `stable/earnings` (already leg 1) returns EPS **and** revenue; AV returns EPS only. Keep the `return []` honest-empty contract at `:288`.
- [ ] `api/services/earnings_estimates.py:494-516` — delete `_year_earnings_from_av` and its entry in the merge chain at `:661-670`. ⚠️ `:514-516` cannot tell a rate-limit from "no data" (its own comment admits it) — deleting it removes a silent-wrong-answer path, not just a call.
- [ ] 🔴 **Delete `engine._av_get`'s 13 s sleep-under-lock** (`api/services/engine.py:172-178`) once its only caller is gone. This is a request-path blocking sleep on the shared anyio threadpool — the documented 524 class.
- [ ] Fix **C17** while in `engine.py`: `:1277-1281` and `:1638-1642` choose TTL + `_ai_store.put` on the **AI leg alone**. Extend the predicate to the enrichment legs (`pre_earnings`, `hist_moves`, `revisions`, `beat_surprises`, `implied_move`, `key_quotes`). ⚠️ `signals_hash` (`:966-970`, `:1320-1324`) makes a partial **sticky indefinitely** — a partial must not be persisted at all.
- [ ] **Coverage:** `yoy_eps_growth` + `beat_streak` + `beat_history` non-null rate over 20 symbols. Require **no regression**, and record that the AV dependency count drops from 7 call sites to 2.
- [ ] `python -m pytest tests/test_earnings_analysis.py tests/test_hist_stats.py tests/test_year_earnings_window.py -q`

### Task 13 — Calendar: dual-source so a Finnhub throttle stops being fatal

- **Runs:** background builds + request reads. Sites: `api/routers/calendar.py:435`, `:566`; `api/services/calendar_alerts.py:107`; `api/services/earnings_table.py:105`; `api/services/engine.py:753`, `:793`.
- **Finnhub stays the session (`hour`) oracle — see §D1.** This task makes everything *else* survive its absence.

**Steps**
- [ ] Add an FMP breadth leg: `stable/earnings-calendar` **one call per calendar day** for symbol coverage + `epsEstimated`/`revenueEstimated`.
- [ ] 🔴 **Never span more than one day in a single FMP calendar call.** Already documented at `api/services/implied_store.py:384-398` from live measurement: a 2-day call returned exactly **4,000 rows with zero of them dated day 1**, and a 14-day call dropped days 0–1 entirely. Truncation is **not date-fair**. Reuse `_fmp_reporters_for_day`'s chunking idiom.
- [ ] Merge rule: **Finnhub row wins on `hour`, `quarter`, `year`; FMP fills any symbol Finnhub did not return, and fills a null estimate.** A symbol present only in FMP gets `hour = ""` → bucket **`tbd`**.
- [ ] ⚠️ **`tbd` must never be coerced into `amc`.** `api/routers/calendar.py:80` states this rule; `:669` and `:886` implement it. Preserve verbatim.
- [ ] When Finnhub returns nothing, the day must still render with FMP symbols and an honest "Time TBD" bucket — **not** an empty day.
- [ ] Fix **C8**, **C12**, **C16**, **C27** in this file as part of T17; do not duplicate them here.
- [ ] **Coverage:** symbols per day and `hour`-resolved fraction for a heavy day. Baseline measured today: Finnhub 549 rows / 423 with a session (77%); FMP 2,197 rows / 943 US-looking. **Require: total symbols ≥ Finnhub's count, session-resolved fraction unchanged, and a simulated Finnhub-429 run still yields ≥ 900 US symbols** (today it yields 0).
- [ ] `python -m pytest tests/test_calendar_month.py tests/test_calendar_paging.py tests/test_calendar_past_day_backfill.py tests/test_calendar_enrichment_throttle.py tests/test_calendar_actuals_patch.py -q`

### Task 14 — News: FMP as the primary, AV demoted

- **Runs:** background refresh thread (`_kick_news_refresh`); only the first cold call blocks.
- [ ] `api/services/engine.py:1911-1924` — add `stable/news/stock?symbols=` + `stable/news/general-latest` ahead of AV `NEWS_SENTIMENT`. Both probed 200 with `{symbol, publishedDate, publisher, title, image, site, text}`.
- [ ] Keep EDGAR (always merged, parallel) and the RSS chain unchanged.
- [ ] Drop the AV sentiment score (§D3) rather than keep a 25/day dependency for a flag-gated nudge. Update `catalyst/scoring.py:136-138` and `catalyst/synthesize.py:209-214` to treat `av_news` as optional-absent.
- [ ] Fix **C20**: `api/services/engine.py:2102` — `_ttl = 1800 if (result and not result[0].get("error")) else 600` gives an **RSS-only** payload the full 30-minute success TTL because item 0 has no `error` key. Decide the TTL on the **source that actually produced the payload**, not on the absence of an error key. Also gate `_store_news`'s promotion into `_news_stale` (`:1834`) on the same predicate.
- [ ] Fix `api/routers/chart_news.py:132` — it caches `[]` for 1800 s.
- [ ] **Coverage:** headline count + per-ticker match rate for 10 tickers. Require **≥ the AV baseline**, and confirm a forced AV failure no longer degrades to RSS-only.
- [ ] `python -m pytest tests/test_catalyst_finviz_av_news.py -q` plus a new `tests/test_news_fmp.py`.

### Task 15 — Shared AlphaVantage budget client (for what remains)

- [ ] Create `api/services/alphavantage_client.py` modelled on `api/services/finnhub_client.py`: a **daily** token bucket (25/day, not 5/min), a shared cooldown, a `Note`/`Information` detector that **every** caller shares, `av_budget_denied_total()`, and a **non-blocking** `av_get` that returns `None` immediately when the budget is spent.
- [ ] 🔴 **Non-blocking is the whole point.** Do not port `engine._av_get`'s sleep. `finnhub_client.py:101-108` explains why: sleeping to wait for a slot moves the 524 surface from "burst of 429s" to "burst of hung request threads."
- [ ] Route the remaining AV callers through it (after T3/T12/T14 that is `catalyst/sources.py:807` and any surviving `av_transcripts` path).
- [ ] Verification: `tests/test_av_client.py` — the 26th call in a day returns `None` **without a network call**; a `{"Note": …}` 200 body is classified as a throttle by the shared detector; `av_get` never sleeps (assert wall-clock).
- [ ] `python -m pytest tests/test_av_client.py -q`

---

## Phase 4 — Partial/failed-cache sweep

Every task here starts by adding **one shared helper** and then applying it. Do not write six variants.

### Task 16 — The shared helper + the four `research/*` modules (C1, C5, C6, C7, C19)

- [ ] Add to `api/services/cache.py` (or a new `api/services/cache_policy.py`):
  ```python
  def set_by_completeness(key, value, *, complete: bool, ttl_ok: int, ttl_partial: int,
                          persist=None) -> None:
      """Cache `value` either way — a partial is still SERVED — but a partial
      gets `ttl_partial` and NEVER reaches `persist`. See earnings_table.py:443."""
  ```
- [ ] Apply to `research/financials.py:166` (48 h → short on partial), `research/ownership.py:204`, `research/estimates.py:163`, `research/ratings.py:343`, `research/snapshot.py:164`, `routers/fundamentals.py:197`.
- [ ] Each module needs an explicit `complete` predicate over its legs — **not** a truthiness check on the merged dict.
- [ ] Verification: one test per module asserting a single-leg failure yields the **short** TTL and a full success yields the long one. **Mutation control:** flip `complete` to a constant `True`, confirm each test fails.
- [ ] `python -m pytest tests/ -q -k "research or fundamentals"`

### Task 17 — The analyst pair (C3, C4)

- [ ] `api/services/analyst_grades.py:141` — give the `_miss` sentinel its own short `_FAIL_TTL` (minutes), **not** `_TTL = 6*3600` (`:26`). Precedent: `earnings_estimates.py:213-218` uses `_INTEL_FAIL_TTL = 600`. Also fix `:151` (partial payload at full TTL).
- [ ] `api/services/analyst_intel.py:148` — add a `partial` predicate over the three FMP legs (`:115-117`) and the Finnhub fallback (`:118-125`). Change `:144` `"recent_actions": actions or []` — an empty list from a **failure** must be distinguishable from a genuinely empty one.
- [ ] ⚠️ C6 (`research/estimates.py:146-149`) **re-caches** analyst_grades' 6 h `_miss` for another 12 h. Fixing C3 alone is not enough — verify the compound case.
- [ ] Verification: `tests/test_analyst_cache_policy.py` — an FMP failure yields a short TTL; assert the compound estimates-over-grades case does not extend a `_miss`.
- [ ] `python -m pytest tests/test_analyst_intel.py tests/test_analyst_cache_policy.py -q`

### Task 18 — Calendar (C8, C12, C16, C27)

- [ ] `api/routers/calendar.py:1890` — a Finviz+Massive double failure must not get the **24 h** past-date TTL. Note `fv_ok` is **always False when `FINVIZ_API_KEY` is unset** (`:1818`) — assert that case explicitly.
- [ ] `:1245` — the `calendar_weekly` write bypasses `_weekly_payload_is_good`. Either gate the `cache.set` on the same predicate, or stop `_build_current_week` from writing the TTL cache itself so `serve_stale`'s `fresh()`-first ordering (`serve_stale.py:127-129`) cannot prefer a poisoned week over a known-good stale one.
- [ ] `:2200` — extend the **already-correct** `throttled` mechanism at `:2174-2184` to `with_em == 0 and total > 0`. Copy that pattern; it is the best-in-class example in the repo.
- [ ] `:2696` — an empty most-anticipated PNG must not get 1800 s / 6 h.
- [ ] Verification: `tests/test_calendar_cache_policy.py` — four cases, each asserting the **short** TTL. Mutation control on the `throttled` extension.
- [ ] `python -m pytest tests/test_calendar_load_latency.py tests/test_calendar_cache_policy.py tests/test_calendar_week_post.py -q`

### Task 19 — Persistent-store guards (C2, C9, C13)

**These are the worst three: they survive redeploys.**

- [ ] `api/services/earnings_estimates.py:752` — the initial `_markers_disk_write` has **no** guard, while the background refresh at `:88` already has the right one (`if data and (earnings or splits or dividends)`). Apply the same guard to `:752`.
- [ ] `api/services/ticker_logos.py:285` — a transient fetch failure writes a **7-day** `.miss` file. Split: a genuine "no logo exists" keeps `_MISS_TTL`; a network/429 failure gets minutes, or is not written at all. Also: `run_miss_retry` (`:345`) has **no scheduler entry** — either register one or document that the 7-day file is the only retry.
- [ ] `api/services/theme_performance.py:338`/`:340` — add a completeness predicate before `_save_to_disk`; `:333-337` currently stamps `status:"ok"` unconditionally and `_load_from_disk` accepts it for **26 h** with no recompute trigger.
- [ ] Verification: for each, assert the failure path **does not create the file** (`os.path.exists` is the oracle — the artifact, not a proxy).
- [ ] `python -m pytest tests/test_ticker_logos.py tests/test_chart_markers.py -q`

### Task 20 — `except → value` (C11, C14, C15, C21, C22, C26)

- [ ] `api/routers/modelbook.py:385` — bare `except: pass` → all-`None` stats cached 24 h. Copy `:552-553` from the same file (`ttl=86400*30 if bars else 1800`).
- [ ] `api/services/massive.py:377` — `except → False` cached 24 h means **TQQQ/SQQQ/SOXL render as ordinary stocks in Top Movers** for a day. A failure must not become a semantically meaningful `False`.
- [ ] `api/services/groups.py:436`, `:456` — 6 h negative cache on a transient refusal. The comment ("cheap, avoids re-calling") is right in intent, wrong in TTL.
- [ ] `api/services/engine.py:496-498` — short TTL for the error payload.
- [ ] `api/services/engine.py:442`, `:468` — `snap_fn(real) or {}` → `snap.get(ticker, 0.0)` renders **every theme at exactly +0.00%**. Default to `None` as the pseudo-ticker branch at `:466` already does. **This is the `Number(null) === 0` bug in Python form.**
- [ ] `api/services/industry_map.py:146-148` — `ON CONFLICT DO UPDATE SET sector = excluded.sector` clobbers a good yfinance-resolved sector with `None`. Use `COALESCE(excluded.sector, sector)`.
- [ ] Verification: one assertion per site that the failure path yields **absent**, never a value. Mutation control on the `+0.00%` fix specifically — it is the most user-visible fabrication in the list.
- [ ] `python -m pytest tests/ -q -k "theme or modelbook or groups"`

### Task 21 — Partial-batch (C10, C17, C18, C23, C24, C25)

- [ ] `api/services/dividends_calendar.py:186` — the 25 s deadline shed (`:175-180`) is **correct**; caching the shed result at the 12 h success TTL is not. Count completed futures and choose the TTL on that.
- [ ] `api/services/insider.py:61`, `:101` — see T10.
- [ ] `api/services/stock_brief/service.py:118`, `:164`; `api/services/watchlist_performance.py:59-63`; `api/services/awareness/engine.py:119-123` — apply T16's helper.
- [ ] C17 (`engine.py` enrichment legs) is handled in T12; verify it here rather than duplicating.
- [ ] **Adopt the `calendar.py:2151-2184` idiom wherever a provider budget is involved:** snapshot the denial counter before the fan-out, force the short TTL if it moved. That mechanically distinguishes "shed" from "absent" instead of guessing.
- [ ] `python -m pytest tests/ -q -k "dividend or insider or watchlist or awareness"`

---

## Phase 5 — Coverage monitoring

### Task 22 — `api/services/provider_coverage_monitor.py`

Model it **exactly** on `api/services/fundamentals_monitor.py` — same skeleton, same idioms. Do not invent a new pattern.

- **Runs: web pod, daemon `threading.Thread`**, started in the `lifespan` context manager **before the `yield`**, next to `fundamentals_monitor.start()` at `api/main.py:1522-1529`. Not an APScheduler job — the heal is a cache invalidation and the cache users read is web-local.
- [ ] Copy the skeleton: module-level `_state` dict + `threading.Lock`, env constants read at import, idempotent `start()` via a function attribute, `_run_forever()` with `_STARTUP_DELAY` then 10 s-increment sleeps, `run_cycle()`, `get_state()`.
- [ ] **Env (all default OFF/safe):** `PROVIDER_COVERAGE_MONITOR_ENABLED` (default `"0"`) · `_CYCLE_SECONDS` (default `3600`) · `_SAMPLE` (default `25`) · `_STARTUP_DELAY` (default `240` — after `fundamentals_monitor`'s 180 so they do not contend at boot).
- [ ] **Sampling:** reuse `_sample_tickers`' three-tier idiom — a hardcoded priority tuple, then `cache.keys_with_prefix(...)` for warm/what-users-are-viewing, then a small bounded cold tail from `api/data/cap_universe.json`.
- [ ] **Fields checked, with thresholds** (these are the concrete coverage contracts; a field below its floor is a defect):

  | field | source of truth | floor | why |
  |---|---|---|---|
  | `price_target` | `/api/earnings/intel/{sym}` | **≥80%** of sampled | measured 6/6 post-`fb0fa7d9` |
  | `consensus` | same | ≥80% | T5 target ≥9/10 |
  | `beat_history` length ≥4 | same | ≥85% | T7 target |
  | `transcript` resolvable | `transcripts.get_summary` | ≥70% | T2 target ≥8/10 |
  | `analyst_actions` | `finnhub_recent_action`/FMP | ≥50% | not every name has recent activity |
  | ticker `name` + `industry` | `ticker_meta` | ≥95% / ≥90% | T8 target |
  | calendar `hour` resolved | `/api/admin/calendar-enrichment-status` | **≥60%** | measured 77% today; below 60% = Finnhub degraded |
  | enrichment `with_em` | same | **>0 when `total > 0`** | the existing docstring at `calendar.py:2206` already names this exact signal |
  | implied `fiscal_year` non-null | `implied_snapshots` | **≥90%** | T4's gate |

- [ ] **Defect record:** `{"field": str, "observed": float, "floor": float, "sample": int, "provider": str}`. **Never report a rate as `0` when the sample was empty** — emit `None`/absent. `Number(null) === 0` applies to the dashboard too.
- [ ] **Provider-attribution:** snapshot `finnhub_client.fh_budget_denied_total()` and (after T15) `av_budget_denied_total()` **before and after** each cycle. If a counter moved, tag the defect `provider_throttled` rather than `data_missing`. This is the `calendar.py:2151-2184` idiom and it is what makes the alert actionable.
- [ ] **Do not self-heal by re-fetching on the request path.** `fundamentals_monitor` heals by cache invalidation only; do the same.
- [ ] Verification: `tests/test_provider_coverage_monitor.py` — a stubbed sample below a floor produces a defect; **at or above the floor produces none**; an empty sample produces `None`, not `0.0`; a moved denial counter tags `provider_throttled`. Mutation control: raise a floor above the stub value and confirm the "no defect" test fails.
- [ ] `python -m pytest tests/test_provider_coverage_monitor.py -q`

### Task 23 — Alert routing + status endpoint

- [ ] **Status endpoint:** `GET /api/admin/provider-coverage` returning `get_state()` directly, **no auth** — matching the deliberate convention for read-only status dashboards (`api/middleware/admin_guard.py:9-13` names `reconciliation-status` and `fundamentals-health` as intentionally anonymous). Put it next to `GET /api/admin/fundamentals-health` (`api/routers/fundamentals.py:69`).
- [ ] ⚠️ **Do not leak private state keys.** `fundamentals_monitor.get_state()` returns a shallow `dict(_state)` and leaks `_prev_flagged_syms` into public JSON. Filter `_`-prefixed keys in the new one.
- [ ] **Alerting — copy `fundamentals_monitor._alert()` (`:237-271`) exactly:**
      - `chart_health_alerts.emit(alert_key, severity, message, metadata)` — in-memory ring buffer, 10-minute per-key throttle (`chart_health_alerts.py:18-19`). It does **not** post to Discord itself.
      - `discord_notify._send_webhook({...})` → **`DISCORD_WEBHOOK_URL`** = the **admin/owner** channel (`api/services/discord_notify.py:11`).
      - 🔴 **Never route to `DISCORD_TSDR_WEBHOOK_URL`** — that is the **PUBLIC** community channel guarded by an allowlist precisely because most content is paywalled (`api/services/desk_session_announce.py:13-22`).
      - Both calls wrapped in `try/except: pass` — an alert failure must never break the cycle.
- [ ] **Alert-on-change only.** Keep a `_prev_defect_fields` set in `_state`; alert on **newly** breached fields. A persistent breach stays visible in the endpoint without re-spamming hourly. ⚠️ This state is in-memory and **lost on redeploy** — a standing breach re-alerts once per restart. Document it; do not add a DB table for v1.
- [ ] **Extend `api/routers/admin_api_health.py`** (`:18-52`): add `FUNDAMENTALS_MONITOR_ENABLED` and `PROVIDER_COVERAGE_MONITOR_ENABLED` to the `feature_flags` group. The `market_data` group already enumerates exactly the providers this monitor reports on.
- [ ] Verification: `tests/test_provider_coverage_alerts.py` — a newly-breached field alerts **once**; the same breach on the next cycle does **not** re-alert; a newly-*recovered* field clears from `_prev`; the status payload contains **no** `_`-prefixed key. Mutation control: remove the `newly` filter and confirm the no-re-alert test fails.
- [ ] `python -m pytest tests/test_provider_coverage_alerts.py -q`

---

## Execution order and parallelism

**Sequential gate:** Task 4 must ship **before** `IMPLIED_STORE_ENABLED=1`. Nothing else is ordered.

Three independent lanes after Phase 0 (which should land first — those fields are blank right now):

| lane | tasks | owns |
|---|---|---|
| **A — providers** | T1, T2, T3, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15 | `api/services/{catalyst/analyst_actions,transcripts,earnings_estimates,call_recap,earnings_enrichment,ticker_meta,ticker_logos,industry_map,insider,ipo_calendar,av_transcripts,alphavantage_client}.py`, `api/routers/{fundamentals,earnings,calendar}.py` |
| **B — cache policy** | T16, T17, T18, T19, T20, T21 | `api/services/{cache,research/*,analyst_grades,analyst_intel,massive,groups,theme_performance,dividends_calendar,stock_brief/*,watchlist_performance,awareness/*}.py`, `api/routers/modelbook.py` |
| **C — the MOAT + monitoring** | T4, T22, T23 | `api/services/{implied_store,provider_coverage_monitor}.py`, `api/main.py`, `api/routers/admin_api_health.py` |

⚠️ **File-ownership collisions to arbitrate before dispatching in parallel** (this is the technique that made Phase B4 ~3× faster — partition on *file ownership*, with an explicit must-not-touch list):
- `api/routers/calendar.py` — lane A (T13) **and** lane B (T18). Give it **one** owner; hand back line ranges.
- `api/services/engine.py` — lane A (T12, T14) **and** lane B (T20 C21/C22). One owner.
- `api/services/insider.py` — lane A (T10) **and** lane B (T21 C18). One owner.
- `api/services/earnings_estimates.py` — lane A (T6, T7, T12) **and** lane B (T19 C2). One owner.
- One owner per shared **test** file too.

---

## Definition of done

- [ ] Every migration task reports a **before/after coverage number** measured against live providers, in the format of the two landed migrations (`0/10 → 6/6`, `0 rows → 4,666 rows / 739 captured`).
- [ ] Every task reports the **exit code** of its pytest run, plus the exit code of its mutation control **and** of an unmutated control (`lesson_mutation_harness_needs_a_control` — a runner that never starts scores a perfect "KILLED").
- [ ] `GET /api/admin/provider-coverage` returns every field in T22's table with a real observed rate.
- [ ] No new dependency in `requirements.txt`.
- [ ] `grep -c broker_sync api/main.py` still **≥ 7** (the standing merge invariant — verify after any master merge, before any push).
- [ ] Nothing pushed outside the deploy window (≥4:20 PM ET or <9:15 AM ET).

## Rollback posture

Every provider migration keeps its Finnhub/AV leg as an explicit fallback, so rollback is reordering two calls, not reverting a task. The cache-policy tasks only shorten TTLs on failure paths — the worst case of a bad TTL choice is more provider calls, never a wrong value. T22/T23 ship **dark** behind `PROVIDER_COVERAGE_MONITOR_ENABLED=0`; rollback is unsetting one env var with no redeploy.
