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
- **Open measurement:** `news.company`'s `store.health_snapshot()` runs COUNT(*) over news_items/news_tickers per
  read — cost on the production DB size must be measured and recorded here before any flag goes on (agent-lead).
- PR 4b is ✅ INTEGRATED as #596 (`e242740211`), live dark in production `c3ba71c343` (QA GREEN r2 `0da44001b8`).
- **Sprint 2 (flags off), agreed order A → B → D → C with agent-lead:**
  - **A — phrasings list** (branch `agent/md/phrasings`): `contracts/MD-1-phrasings.md`, 30 phrasings with their
    deterministic handling, ambiguous-ticker rule, answer obligations. Docs only.
  - **B — `stock.quote`** (`capabilities/marketDataQuote.js` + additive `session` field, MD-1 v1.5). Pending.
  - **D — freshness corpus (#598)** refreshed onto `c3ba71c343` with per-session fixture clocks. Pending.
  - **C — `bars.daily` answers** (`capabilities/marketDataBars.js`). Pending.
  - Lead-owned dependencies: `builtins.js` registration line, `UCT_AGENT_DATA_KINDS` allowlist (fail closed),
    `fastPath.js` wiring of `match()`.

## Blockers
- (none) — the Sprint-0 gateway test was updated by agent-lead in #571.

## Handoffs (to / from)
- From agent-lead: gateway test fixed (#571); #569 integrated. PR 1b quote-freshness follow-up requested.
- To agent-qa: `quote`/`quotes` ready for conformance fixtures; envelope shapes are documented in `quotes.py`.
- To agent-qa: `bars.daily` historical fixtures wanted — a weekend/holiday `to`, an early-close session,
  a store one session behind (stale), and a store row for today's developing bar (must be excluded).

## Ready for integration
- PR A phrasings list (docs only)
