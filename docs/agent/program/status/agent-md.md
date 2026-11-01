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
- Next: PR 3 fundamentals/earnings/news.company, PR 4 breadth/nhnl/themes/volume.surge/ratings;
  ADR-003 flow/darkpool spike (draft); freshness eval corpus with agent-qa.

## Blockers
- (none) — the Sprint-0 gateway test was updated by agent-lead in #571.

## Handoffs (to / from)
- From agent-lead: gateway test fixed (#571); #569 integrated. PR 1b quote-freshness follow-up requested.
- To agent-qa: `quote`/`quotes` ready for conformance fixtures; envelope shapes are documented in `quotes.py`.
- To agent-qa: `bars.daily` historical fixtures wanted — a weekend/holiday `to`, an early-close session,
  a store one session behind (stale), and a store row for today's developing bar (must be excluded).

## Ready for integration
- PR 1b quote freshness (MD-1 v1.1)
