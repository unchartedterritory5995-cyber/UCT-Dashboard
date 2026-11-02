# Status — agent-md (A · Market Intelligence & Data (MD-1))

Only agent-md edits this file. Update it in every PR.

## In flight
- **PR 1 — `quote`, `quotes`** — ✅ INTEGRATED into agent/int as #569 (`76a45af859`). Follow-up PR 1b
  (extended-hours by timestamp, per-row `last_source`, MD-1 v1.1) requested by agent-lead — next.
  **PR 1b** (branch `agent/md/pr1b-quote-freshness`, MD-1 **v1.1**, additive): session classified from the
  ET clock + trading-day helper + early closes (not `_detect_session`); extended hours `live` when the oldest
  live vendor stamp is ≤ 15 min old, else `historical`; one note, never both; per-row `last_source`
  (trade | minute | day_close | prev_close); a close-priced row in a live read -> `partial` + note, and its
  stamp is excluded from `as_of`; `data.session` = regular | extended | closed. Doc §4.1 + §9 changelog;
  a rail keeps the doc's note strings identical to the code's. Tests 37, mutation-checked.
  Original PR 1 scope (contract MD-1 v1.0): Adapter over
  `services/massive.py` `_MassiveRestClient.get_batch_quotes`, read-only; NOT `/api/live-prices` (its cache miss
  runs `run_alert_check`). Live in the regular session (stale after 60 s), historical with a note otherwise;
  `as_of` = vendor observation time, the oldest in a set; `provider_calls` = 1 per batch request.
  Tests: `tests/test_uct_agent_data_quotes.py` (18), incl. a no-alert-check rail with a non-vacuity control.
- **PR 2 — `bars.daily`** — ✅ INTEGRATED into agent/int as #576 (`862b0fa5ed`). Reads the canonical bars store
  read-only (`bars_sqlite.get_bars_before` + `bars_fetch._fmt_sqlite_bars` inside
  `bars_sanitize.suppress_meta_warm()`), NOT `_get_bars_inner` (records requests, kicks deep-fill/cold
  fetch, writes the cache). Completed sessions only (window ends at the last closed session, or `to`),
  `historical`; `as_of` = the newest bar's own session close (early closes honoured); stale when the
  store is behind the newest completed session; `provider_calls` = 0. A symbol not in the store is
  `unavailable` — never fetched. Tests: `tests/test_uct_agent_data_bars_daily.py` (18), mutation-checked.
- **Pre-admission validation** — ✅ INTEGRATED into agent/int as #583 (`7ca746dd5f`). `quote`, `quotes`, `bars.daily` each register a pure `validate=` (gateway #575): a malformed
  request is `refused` BEFORE admission and spends no read or provider budget. The adapters re-ask the same
  check, so a direct call cannot bypass it. `quotes` with SOME invalid symbols stays admitted and `partial`.
  No admission limit or authorization check changed. Mutation-checked.
- **PR 3 — `fundamentals`, `earnings`, `news.company`** (branch `agent/md/pr3-fundamentals-earnings-news`,
  — ✅ INTEGRATED into agent/int as #585 (QA's F-6 removal #589 after it). Sources ruled by agent-lead:
  `financial_statements.get_statements` (Yahoo Finance; as_of = newest period end; stale > 135 d; 6 calls on a
  synchronous build else 0), `earnings_table.get_earnings_table` (as_of null + note — reported rows carry no
  date; stale when `stale_quarters` ≥ 2; `next_report` = scheduled event from the same payload, never as_of;
  1 call per read), `news/store.feed` (≤ 25, no body text; stale on INGEST health, never company quietness;
  0 calls). All `periodic`. MD-1 **v1.2** (§4 rows + §4.2, constants quoted from the modules). Tests 36,
  mutation-checked; clock-clean (fixed NOW_TS literal, adapters' clocks frozen — agent-qa F-8); exact news-ingest
  boundary (exclusive) and UTC-midnight flip for fundamentals pinned.
- **PR 4a — `themes`** — ✅ INTEGRATED into agent/int as #591 (`d51f73b75e`). MD-1 §4.3's relative-volume
  pointer targets SC-1 §2c (#592, integrated). Reads
  the theme overlay WITHOUT building it (shared cache, then the route's last complete overlay, else
  "theme data is warming", 0 calls — a cold build is ~22 Massive calls). While prices move `as_of` is null and
  `live_applied_at` is UCT's apply time (never live); otherwise the last session close. MD-1 **v1.3**:
  `volume.surge` removed (relative volume = screener `rvol_live`/`vol_ratio` via SC-1), `nhnl` folded into
  `breadth.current` metrics, `nhnl_live` not exposed. Tests 15, mutation-checked.
- **PR 4b — `breadth.current` (+ NH/NL metrics) and `ratings`**: rulings received; both MODEL-ISOLATED
  (purpose "answer" only, gateway #588). Branch `agent/md/pr4b-breadth-ratings`, based on agent/int `d51f73b75e`
  (after #591). `breadth.current` = `breadth_current.reading()` (intraday → periodic, completed → historical;
  as_of = vendor `observed_at`, never `computed_at`; stale = not current; label always a note; `stale_reason`
  logged, not returned; NH/NL measures included). `ratings` = `research/ratings.get_ratings` (UCT-derived 1–99;
  as_of = price session close; undated legs noted; incomplete → partial; 3 calls). MD-1 **v1.4** §4.4.
  Tests 39, mutation-checked (dropping isolation reds 4; as_of from computed_at reds 3). Refreshed for #599:
  DORMANT unless `UCT_AGENT_ISOLATED=1` — refused for every purpose, `answer` included; active-behaviour tests set the flag.
- PR 4b is ✅ INTEGRATED as #596 (`e242740211`), live dark in production `c3ba71c343` (QA GREEN r2 `0da44001b8`).
- **Sprint 2 (flags off), agreed order A → B → D → C with agent-lead:**
  - **A — phrasings list** (branch `agent/md/phrasings`): `contracts/MD-1-phrasings.md`, 30 phrasings with their
    deterministic handling, ambiguous-ticker rule, answer obligations. Docs only.
  - **B — `stock.quote`** (branch `agent/md/stock-quote`, includes A): `capabilities/marketDataQuote.js` (answer +
    `match()` + idempotent registration that is a no-op while `data` is false) over the shared pure parser
    `capabilities/marketDataPhrases.js`. `quotes.py` gains the additive `data.session_detail` (regular · premarket
    · after-hours · overnight · closed); `session` is derived from it. MD-1 **v1.5** §4.5. Flags off = stock.profile
    byte for byte (rail), also while `data_kinds` (#621) lacks `quote`/`quotes`. The turn id comes from
    `currentTurnId()` at the read (agent-qa's rail). Vitest 66, mutation-checked 6 ways (kinds gate dropped, flag
    ignored, stale-as-live, fallback removed, ambiguous rule dropped, veto dropped: each red).
  - A ✅ #620 and B ✅ #624 INTEGRATED into agent/int (`25979607eb`).
  - **B2 — fast-path hook** ✅ #632 INTEGRATED with agent-lead's wiring #633 (`40185db069`): `fastWhole` + `fast()` +
    `fastCorrect: false` on the stock.quote registration. `agentDataQuoteFast.test.js`, with every builtin registered:
    zero model turns when served, sole claimant for every quote row, a rival claimant goes to the model, dark in every
    config shape, and no claim after the server goes dark. Mutation-checked 3 ways.
  - **QA findings on #624 (MD-2 harness #635)**, fixed on branch `agent/md/quote-fixes`:
    - **F-19:** `quotes._session_detail` read today's trading day from the wall clock even when given `now`. It now
      derives weekday and holiday from `now`'s ET date; the tests no longer patch a hand-picked trading flag.
    - **F-20:** a no-price answer echoed `env.notes[0]` (a budget refusal stated a number). It now uses fixed words
      keyed on status.
    - **O-1:** on a half day, after-hours now ends at 17:00 ET, then overnight.
    - Mutation-checked 3 ways (each fix reverted: red).
  - **D — freshness corpus** ✅ #598 INTEGRATED into agent/int (`b7f7e24cc4`, with QA's MD-2 harness #635). Now 34 questions (corpus
    v1.1, contract MD-1.5). Nine **session-clock** questions are generated by running the REAL `quote` adapter at a
    frozen ET clock against a fake snapshot, not hand-built: regular · premarket (fresh) · premarket (no trade in
    15 min) · after-hours · overnight · weekend · holiday · early close before and after 13:00. A gated test
    re-derives each clock's `session_detail` and freshness independently. The refusal rail activates the kind under
    test (#621). Tests 86, mutation-checked 2 ways (after-hours misread as premarket; overnight boundary moved).
  - **C — `stock.dailyBars`** (branch `agent/md/bars-answers`): `capabilities/marketDataBars.js` over `bars.daily`.
    It answers last close (2 bars), N-session change (n + 1), and 52-week range (252 bars, highs/lows with dates),
    from completed sessions only. Stale and short windows are stated plainly; no-bars answers use fixed words.
    Registered only while `bars.daily` is in `data_kinds`, through `registerMarketDataCapabilities()`. Shared
    formatting is in `capabilities/marketDataFormat.js`. My test stand-ins for `serverDataKinds` are removed; the
    tests send `data_kinds` in the config. MD-1 v1.5 §4.6. Vitest 26, mutation-checked 8 ways (each red).
  - Lead-owned dependencies: `builtins.js` registration line, `UCT_AGENT_DATA_KINDS` allowlist (fail closed),
    `fastPath.js` wiring of `match()`.
- **Freshness regression corpus** (branch `agent/md/freshness-corpus`, **stacked on #596**: it quotes the
  breadth/ratings note constants). `api/services/uct_agent/marketdata/eval/freshness.json`: 25 present-tense
  questions, each with a fixture MD-1 envelope (built by `make_envelope`, so valid by construction) and
  mechanical expectations: freshness class, accepted `as_of` renderings, whether "live/now" wording is allowed,
  stale and unavailable disclosure, no invented value, required phrases. Generated by `eval/build_freshness.py`
  from the adapters' own constants and railed byte-for-byte. Scripted scoring is agent-qa's (no model, no cost).
  Each question names the gateway `flags` it runs under; isolated-kind refusals cover BOTH the dormant default
  (no flag → refused for every purpose) and the purpose gate (flag on, `research` → refused). Validity tests:
  `tests/test_uct_agent_data_freshness_corpus.py` (56).
- **Measured 2026-11-01 — `news.company` ingest health (`store.health_snapshot(days=1)`), SYNTHETIC only.**
  Scratch sandbox (DATA_DIR + COMPANY_NEWS_DB_PATH pinned to the session scratchpad; `C:\data` checked before and
  after: no news DB exists there). Built through the store's own schema init (FTS triggers on), sqlite 3.49.1,
  warm page cache, median of 7 (max in brackets). No production access.

  | items | links | DB | `health_snapshot` | `newest_published("")` | `feed(…, 10)` | its 2 × COUNT(*) |
  |---|---|---|---|---|---|---|
  | 100k | 175k | 55 MB | 63 ms (74) | 3.0 ms | 2.8 ms | 14 ms |
  | 500k | 877k | 280 MB | 183 ms (204) | 1.5 ms | 3.4 ms | 48 ms |
  | 1M | 1.75M | 561 MB | 421 ms (561) | 1.5 ms | 4.9 ms | 127 ms |
  | 2M | 3.5M | 1.1 GB | 454 ms (462) | 0.9 ms | 5.0 ms | 129 ms |

  Reading: the health read grows with the table and dominates the kind's cost. The feed is ~5 ms, the health
  read up to ~0.45 s, on the web pod's shared threadpool, PER Agent read, and `direct` news is retained forever
  (`RETENTION_DAYS`), so it only grows. A cold page cache would be slower; the 1M→2M flattening reflects the
  synthetic `ingested_at` spread (2 years), not a production property. **Recommendation, before any flag:** do
  NOT ship `news.company` on `health_snapshot`. Ask the news-store owner for a one-line public read of
  `MAX(news_source_health.last_ok)` (an 8-row table, O(1)); `newest_published("")` is fast but judges overnight
  quiet as stale, so it is not a substitute. Until then the kind stays dark (it is). **Known limitation and pre-activation requirement** (agent-lead,
  2026-11-01): agent-lead routes the O(1) `MAX(last_ok)` read to the news owner; `news.company` must not be
  activated on `health_snapshot`.

## Blockers
- (none) — the Sprint-0 gateway test was updated by agent-lead in #571.

## Handoffs (to / from)
- From agent-lead: gateway test fixed (#571); #569 integrated. PR 1b quote-freshness follow-up requested.
- To agent-qa: `quote`/`quotes` ready for conformance fixtures; envelope shapes are documented in `quotes.py`.
- To agent-qa: `bars.daily` historical fixtures wanted — a weekend/holiday `to`, an early-close session,
  a store one session behind (stale), and a store row for today's developing bar (must be excluded).

## Ready for integration
- PR A phrasings list (docs only), #620
- PR B `stock.quote` (needs agent-lead: `builtins.js` line, `UCT_AGENT_DATA_KINDS`, `fastPath.js` wiring)
