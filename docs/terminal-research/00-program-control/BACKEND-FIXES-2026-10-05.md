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
