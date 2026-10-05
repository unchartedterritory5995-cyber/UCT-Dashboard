# Terminal backend fixes: main-machine worklist (2026-10-05)

Source: the 2026-10-05 deep second-pass audit of the UCT Terminal, run read-only against
production master `83e7deb43`. The laptop has no Python, so nothing below was changed or
verified there. The frontend halves of these defects shipped on `fix/research-accuracy` and
`fix/options-accuracy`. Re-read each cited line before acting: line numbers drift.

Verify with scoped pytest on named files only (see CLAUDE.md), then the master deploy gate.

⚠️ **`docs/feature_flags.json` is stale.** The 2026-10-04 night armed ~60 flags on `web`, and
the ledger trueup (`chore/flag-ledger-trueup`) is held for a Python-verified ship. Both audit
agents misread live options panels as dark because of it. **Ship that trueup first.**

## Research panels

| # | Code | Defect | Where | Fix |
|---|---|---|---|---|
| R1 | FA | Fiscal-quarter labels use the calendar year from `date[:4]` alongside FMP's fiscal `period`. AAPL's Dec-2025 quarter reads "Q1 2025", and NVDA's columns look out of order. | `api/services/research/financial_history.py:193-199` `_label` | Use FMP `fiscalYear`, as `earnings_history_fmp.py:159` already does |
| R2 | EE | `GRACE_DAYS=130` keeps already-reported periods as the first "forward" row. | `api/services/research/estimates_consensus.py:51` | Drop a period once its report date has passed |
| R3 | BRKE | The next quarter to report is dropped once its period end has passed (`end < today`), so it vanishes all earnings season. | `api/services/broker_estimates.py` `periods()` | Keep a period until it reports; share one rule with R2 |
| R4 | BRKE | A 403 plan-gated response becomes `rows=[]`, is cached for 6h, and reads "no consensus". This path also skips the `FUNDAMENTALS_FMP_ANALYST_ESTIMATES` gate. | `broker_estimates.py`, `fmp_client._fetch` | Distinct error state, no caching of failures, honor the gate |
| R5 | BRKE | Reads a cache key that only ANR fills. Known since the first audit. | `broker_estimates.py` | Fetch its own data |
| R6 | CATS | Returns 400 on dual-class tickers (BRK.B). Known since the first audit. | `api/routers/catalysts.py` | Normalize `.`/`-` |
| R7 | CF | An SEC outage is returned as HTTP 200 `{"error":...}`. | `api/services/sec_filings.py:133,148` | Return a non-200 (the frontend now handles both) |
| R8 | FEED | The 60-row cap applies across all forms before the form filter runs. That gives false "no 10-K" answers for heavy Form-4 filers. The market-scope 600 cap returns ok with empty rows and no reason. | `api/services/filings_feed.py:211,282-283,386-394` | Cap per form; add a `none_in_scope` state with a reason |
| R9 | FIL | Returns `state:'not_found'` when both filings were found but no section could be located. | `api/services/filing_blackline.py:861-866` | Add a distinct state such as `sections_unlocated` |
| R10 | ANR/OWN/RTG | Exceptions become 200 with an empty body. | `api/routers/research.py:225-228,275-297,305-307` | Return 5xx or `state:'error'` |
| R11 | FA | A transient failure is cached as `periods: []` for 600s. | `financial_history.py:233-244` | Don't cache failures |
| R12 | OWN | Shows the newest 13F quarter while it is still being filed, so ownership reads far too low. | `api/services/research/ownership.py:241-246` | Skip quarters less than ~46 days past their end. Confirm against live FMP first |
| R13 | FA/EE | `reportedCurrency` is never read, so foreign ADRs show home-currency amounts as dollars. | `financial_history.py:255-279` | Pass the currency through. Confirm with TSM/TM first |
| R14 | MOVE | The seen-set is overwritten on every GET, so the NEW count is unreliable and an outage re-flags old facts. | `api/services/terminal_grammar.py:241-258` | Store the union of seen keys; skip the write when intel isn't ok |
| R15 | MOVE | Analyst action is taken from `actions[0]` with no age limit. | `watchlist_intelligence.py` `_analyst_fact` | Apply the same recency window as filings |
| R16 | MOVE | `date.today()` is UTC, so after ~8pm ET tomorrow's report reads "today". | `watchlist_intelligence.py` | Use the ET date |
| R17 | MOVE | The 404 body is identical for flag-off and cohort gap. | `api/routers/terminal_grammar.py` | Distinct body for flag-off, or expose the flag in the auth payload |
| R18 | MOVE | The price-move fact never fires: no client passes `change_pct`. | `watchlist_intelligence.py:65-66` | Look up the change % server-side |
| R19 | TRAN | Rating trend and webcast URL are frozen at warm time. | `api/routers/earnings_intel.py:128-130` | Read `get_rating_changes` live; keep the stored copy as fallback |
| R20 | HIS | Bare-word ticker match gives false Morning Wire mentions (AI, A, IT, NOW, ON). | `api/services/ticker_history.py:111-113` | Require `$TICKER` or wire markup for short/dictionary tickers |
| R21 | EVTS | Room spikes are bucketed by UTC day while ATTN uses ET. "EPS x vs None estimate" can appear. | `events_timeline.py` | Bucket by ET; omit the missing estimate |
| R22 | ERX | A pre-print session can show as "Reaction" between an after-close report and the next session. | `earnings_reaction_panel.py:64-70` | Wait for the next session |

## Options

| # | Code | Defect | Where | Fix |
|---|---|---|---|---|
| O1 | OMON/OVS | The expiration walk caps at 12×1000 contracts / 40 dates, so SPY/QQQ lists end about 7 weeks out with no later monthlies or LEAPS. | `api/services/polygon_options.py:35-36,83-103` | List expirations from a narrow strike band or calls only |
| O2 | OVS/RR-BF | Only ±10 strikes per side (about ±1.5% on $1-strike names), so 25Δ/10Δ are unreachable. The note blames wide-strike names, which is backwards. | `vol_surface.py:37`, `polygon_options.py:249-254`, `vol_skew.py:89-90` | Fetch by moneyness band (±25%) or delta |
| O3 | OMON | The default expiry is `all_exps[0]` (0DTE), though the comment says non-zero-DTE. | `polygon_options.py:241-244` | Skip expiries ≤ today (≤ today after 16:00 ET) |
| O4 | Backtest/IV crush | `reportTime` is always `""`, so the earnings anchor yields 0 trades and crush measures the wrong day for after-close names. The frontend now hides the anchor. | `api/services/engine.py:370`, `options_backtest.py:700,773-775`, `log_history.py:177,192`, `iv_history.py:~398` | Feed BMO/AMC from the earnings calendar; blank crush when timing is unknown |
| O5 | GEX/POS | "Zero Gamma" falls back silently to the first negative strike, a threshold, or the Put Wall. | `api/gex_service.py:589-637` | Return `zeroGammaMethod`, or compute a true flip over a spot grid |
| O6 | POS Levels | The 1-day/5-day implied move uses the nearest (0DTE) IV; max pain has no expiry. | `positioning.py:368,413-415` | Use 30-day constant-maturity IV; include the max-pain expiry |
| O7 | Screens | `ORDER BY oi DESC LIMIT 3000` runs before the yield sort, so high-yield low-OI contracts never rank. | `strategy_screens.py:94,128`, `more_screens.py:52` | Sort on the key in SQL |
| O8 | Screens | `SUM(COALESCE(vol,0))` turns unknown volume into 0. | `more_screens.py:92-93` | Keep NULL; fall back to the flow tape as `unusual_volume` does |
| O9 | Stance/drill | OCC root `BRKB` ≠ `BRK.B`, causing 422 errors. | `chain_tools.py:107`, `stance.py:95` | Compare with `.`/`-` stripped; allow a trailing digit |
| O10 | GEX vs POS | `datetime.now()` is UTC on Railway while positioning uses ET. | `gex_service.py:420` | Use ET |
| O11 | One-day move | Levels uses √(1/252) while Probability uses √(days/365), about 20% apart. | `positioning.py:414`, `log_history.py:121`, `chain_tools.py:59` | Pick one convention and state it |
| O12 | IVH/STRS | Panels are reachable while their switches are off (`IV_HISTORY_ENABLED` and `OPTIONS_STRATEGY_SCREENS_ENABLED` are unset on web). | auth payload | Expose the per-feature flags in `/api/auth/me` and gate the codes in `functions.js` on them |

## Speed (audit slice 5, 2026-10-05)

The web pod is one process with one shared thread pool, so each of these is a slow-page or outage risk under load, not just a slow call. Frontend halves already shipped in `5ecf9ef39` (DES reads the analysis `cached_only`, no 4xx retries, no refetch on focus, `lazyWithRetry` panels). Locations without a line number were not pinned by the audit; grep the named function.

| # | Code | Defect | Where | Fix |
|---|---|---|---|---|
| S1 | DES | `/api/earnings-analysis/{sym}` without `cached_only` or `background` generates with an LLM inside the request. The terminal no longer calls it that way; other callers still can. | `api/routers/earnings.py` `earnings_analysis` (~499-542) | Make the synchronous branch refuse to generate, or route it through `_kick_generation` |
| S2 | TRAN | `/api/earnings/sentiment/{sym}` is a plain `def` that can run a Perplexity call plus an Opus call on the request path, with no single-flight. Mounted on every Calls tab. | `api/routers/earnings_intel.py:213` → `call_recap.get_sentiment` (~402) | Single-flight per symbol; generate in the background and return a pending state |
| S3 | OMON/OVS | Options chain cold-cache stampede: the cache key includes `n` although `n` only trims an identical vendor walk, and there is no single-flight on `get_chain` / `list_expirations` or the surface. | `polygon_options.py:182` | Key without `n` (trim after); single-flight both; cache errors 15-30 s |
| S4 | OMON | `list_expirations` has no overall time budget, and a per-call `timeout=` override bypasses the client's connect/pool limits. | `polygon_options.py` | 20 s budget; drop the per-call override |
| S5 | DES/FA | `get_fundamentals` caches results but has no in-flight single-flight, so N members opening one cold name each run the yfinance walk (2-3 of the 8 shared yfinance slots per open). | `api/services/fundamentals.py:111-127` | Lock + future map per symbol, like `_refresh_inflight` |
| S6 | Research | Financials, estimates, ownership, ratings and news composers have no single-flight; `get_ratings` runs its 3 legs one after another. | research services | Single-flight per symbol; run the ratings legs in parallel |
| S7 | Any | An R2 sync can run on the request path. | data sync call sites | Move it to a background job |
| S8 | MOVE | The earnings window is recomputed on every request. | MOVE service | Memoize per day (as `awareness/engine.py::_EARNINGS_MEMO` does) |
| S9 | FSRC | Mention lookups scan the 90-day window on each request without an index. | `mention_series.py:76` | Add an index on (ticker, ts) |
| S10 | IVH | The IV row cache is unbounded. | `iv_history.py` | LRU cap |
| S11 | DPTH | Fans out to 7 GETs per open (cheap local reads). | frontend DepthTab | Optional: one `/api/research/depth/{sym}` batch endpoint |

## Live terminal test (2026-10-05, ~15:00-16:10 ET, owner's Chrome, read-only)

Measured by driving the deployed terminal (owner account, `terminal-next` cohort, paid), not
by reading code. The frontend halves shipped on branch `fix/terminal-live-audit`
(`0365a879b`, `8ce411a16`, `1e9c23861`, `c1009dfe4`, `60b8ba0b4`); everything below needs the
server. Times are wall-clock from the browser.

| # | Code | Defect (measured) | Where | Fix |
|---|---|---|---|---|
| L1 | FLOW | `GET /api/live/massive/ticker-flow?symbol=NVDA&days=5` and `…AAPL…` gave **no answer in 90 s** (the gateway later answered 502); SOFI took 11.6 s. `/api/health` answered in 0.3 s at the same time, so it is this endpoint, not the site. The large names are the ones that time out. The panel now gives up at 30 s and says so. | partner-owned `api/live_massive_router.py` ticker-flow (via `flow_proxy` to flow-worker) | Bound the scan (index on symbol + session; cap rows read), cache per (symbol, days) for ~60 s, single-flight |
| L2 | TIDE | Market tide `scope=all` stopped at 15:07 ET while `computed_at` read 15:27 and the feed was live; at 15:40 it was `stale: true` with `cache_age_s` 739, then caught up to 15:41. The recompute lags 20-35 min in the last hour. | `api/services/options_analytics/market_tide.py` refresh | Recompute on a fixed 1-2 min cadence in RTH off the minute rollup, never on request; alert if `cache_age_s` > 300 in RTH |
| L3 | TIDE | `scope=etfs` served the **2026-10-02** session on Monday 2026-10-05 at 15:40 with no today rows (and was `stale: false` earlier). Either ETF prints are not reaching the tape's ETF bucket today or the scope filter is wrong. The panel now says "not today" in words. | same | Check the ETF source (`sources.etfs`) for today; if it is genuinely empty, return `session: today` with zero minutes instead of an old session |
| L4 | ERN / modal | `/api/live-prices` returns `price` (last trade) and `change_pct` from a different reading (the minute bar's close): NVDA price 239.81, prev_close 233.95 → 2.505 %, but `change_pct` 2.5198 (`change` 5.895 = 239.845 − 233.95); AAPL 0.036 % vs 0.054 %. The earnings window now computes % from the shown price. | `api/routers/live_prices.py` / `massive.get_batch_rich_snapshots` | Derive `change` and `change_pct` from the same `price` field the payload returns |
| L5 | CATS / MOVE | The catalyst engine stores its own failure sentence as the thesis ("Synthesis temporarily unavailable…", "Synthesis returned malformed output…"). AMD carried it on Oct 5, Oct 2 and Sep 28, so it is recurring for that name, not a one-off. The UI now labels these rows "No write-up for this day". | `api/services/catalyst/synthesize.py:467` and `:500` | Store `thesis_text = NULL` plus a `thesis_status` ('failed' / 'malformed') instead of prose; log AMD's malformed raw output (first 300 chars are already logged) and fix the prompt/parse cause |
| L6 | Autocomplete | `/api/ticker-search` ranks prefix matches by length then A-Z, so "NV" → NVA NVC NVD NVG NVO NVR (NVDA 16th); "TS", "AA", "MS", "AM" lose TSLA, AAPL, MSFT, AMZN. The terminal now asks for 20 and breaks ties with the popular list, but every other caller (palette, chart search) still gets the A-Z six. | `api/routers/ticker_search.py` | Order equal-class matches by market cap or 30-day dollar volume (both already cached in `ticker_meta` / catalyst metadata) |
| L7 | CATS | `GET /api/catalysts/explain/{sym}` took 6-26 s, is uncached, runs the full 8-source pull including Perplexity on every request, and refuses `BRK.B` (`sym.isalpha()`). | `api/routers/catalysts.py:227-274` | Cache per (sym, market_date) ~10 min; single-flight; allow `.` and `-` in symbols |
| L8 | SEAS | A cold `/api/research/seasonality` (~21 s) returned partial history (`covered_from` 2024-09-16, n=2) instead of the 2021+ history the warm call returns. | `api/routers/seasonality.py` → `serve_bars(sym, "D", 8000, …)` | Do not compute from a partial cold read: wait for the full daily series or return `pending` |
| L9 | Speed | Measured first-open times above 5 s: HIS `/api/research/history` ~21 s; SEAS ~21 s cold; `/api/research/mention-series` 7-21 s; ERN `/api/calendar/my-sets` 14 s and `/api/calendar/next-report` 9.9 s; `/api/calendar` 5.2 s; SCR `/api/screener/meta` 8.3 s; RTG 6.4 s; market tide ~5.4 s; FREC 5.1 s; CATH 5.6 s. | named routes | Warm on boot or cache per symbol; each is a request-path compute today |
| L10 | Live prices | `/api/live-prices?tickers=DAWN` (one unknown/delisted ticker) answers **503 "Pricing service unavailable"**, which reads as an outage. | `api/routers/live_prices.py` (empty-result branch) | Return 200 with the ticker absent (or a per-ticker `not_found`), keep 503 for a real provider failure |
| L11 | Live Flow | After a web restart the Live Flow "warming" state shows 0 alerts for a long time. | flow-worker warm-up / `flow_proxy` | Serve the last persisted alerts while warming, labelled as such |
| L12 | DES | Two intel endpoints answer the same question (`/api/earnings-intel` and `/api/earnings/intel`). | routers | Keep one; redirect the other |
| L13 | Startup | About 15 requests fire at once when the terminal loads, each 1.5-2.2 s (they queue on the single web process). | frontend boot + web pool | Batch the L0/boot reads or warm them server-side |

## Speed lane status (branch `fix/terminal-backend-speed`, 2026-10-05)

| # | State | What changed, or why nothing did |
|---|---|---|
| S1 | Fixed `3e6a2930b` | A bare `/api/earnings-analysis/{sym}` never generates inside the request; it kicks the background job and answers `generating`. |
| S2 | Fixed `2cb101ee1` | Web-grounded sentiment runs on the warm pool (one in flight per symbol); the request answers null and `useSentiment` re-asks in 60 s while null. |
| S5 | Fixed `4289bea23` | `get_fundamentals` builds a cold name once however many members open it; a follower that waits past 30 s gets "still loading", not a second build. |
| S7 | No change | Checked every R2 call site. No R2 sync runs on a request path: the bars corruption recovery runs on its own thread and is OFF (`R2_RECOVERY_ENABLED`); the request-path R2 reads (`econ/serving`, `fundamentals_pit/serving`) sit behind in-process TTL caches; `intradaypack` shards are one GET by design (TERM-040). |
| S9 | Fixed `717f1899b` | The (ticker, ts) and (ts) indexes already existed (`buzz_store.py:68-69`). The cost was walking every room mention in Python for the per-day totals; finished days are now cached 10 min, today is read live. |
| L6 | Fixed `619cd083e` | Ticker search breaks ties inside a match rank by 20-session dollar volume from bars.db (`TICKER_SEARCH_RANK_BY_DOLLAR_VOLUME`, default on). |
| L9 screener | Fixed `9daa8b4d2` | `/api/screener/meta`'s bands are computed by the boot warm and after each nightly build. |
| L9 calendar | No change | `my-sets` is four local reads (watchlists, flagged, open positions, cached wire data); its 14 s was queueing behind the boot burst (L13), not compute. `next-report` is one FMP/Finnhub call per symbol, cached 6 h and fired on selection only. |
| L9 research | Research lane | `research/history`, seasonality, RTG are on `fix/terminal-backend-research`. |
| L13 | Not built | The shared reads are already warmed on boot; the per-member ones cannot be. A single boot endpoint would change every panel's data hook, so it is a design decision, not a speed fix. |
| S6, S8, S10 | Held | Not assigned to either agent, but S6 and S8 touch the research lane's files and S10 the options lane's, so they wait until those branches are merged. |
