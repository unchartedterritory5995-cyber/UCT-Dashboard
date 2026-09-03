# Provider Abstraction Layer (D1) — Implementation Log

Tracks the D1 implementation authorized 2026-09-02 ("Approved: proceed with
Provider Abstraction Layer (D1) implementation"), immediately following
Entity Master (S3)'s acceptance-with-conditions. Source of truth:
`docs/terminal-research/05-product-strategy/prds/provider-abstraction-prd.md`
and `.../07-technical-architecture/specs/provider-abstraction-spec.md` (both
in the `terminal-research` worktree), Entity Master's own implementation
(this worktree), and direct reads of the real codebase.

Entity Master's three tracked conditions (admin routes, reconciliation
scheduling disabled, cap_universe.json refresh) remain in force and are not
touched by this work — see `entity-master-implementation-log.md`'s
"ACCEPTED WITH CONDITIONS" section.

---

## Section 1 — Current direct-provider surface (2026-09-02)

Per the authorization's explicit instruction to verify against files, not
conversational memory, before designing anything. All checks run directly
in this worktree (`entity-master`), not assumed from the D1 spec's own
citations (written against the separate `terminal-research` worktree).

### FMP

**The PRD/spec's own investigation undercounted the true scope — corrected
here, evidence wins.** The spec named 8 call sites (6 from the PRD +
`analyst_grades.py` and `engine.py::_fmp_get`, "found by the spec's own
pass"). Direct re-verification in this worktree:

- `grep -n "^def _fmp_get\|^def _fmp\b" <the 6 PRD-named files>` — confirms
  all 6 exactly as cited: `fundamentals.py:111`, `catalyst/analyst_actions.py:96`,
  `earnings_estimates.py:344`, `transcript_indexer.py:25` (delegates to
  `earnings_estimates._fmp_get`), `insider.py:89` (`_fmp_get_insider`,
  single hardcoded endpoint), `research/financial_history.py:38` (`_fmp`,
  delegates).
- **`analyst_grades.py` does NOT define its own `_fmp_get`** (the spec's
  claim) — it imports `earnings_estimates as ee` and calls `ee._fmp_get(...)`
  directly (confirmed: `from api.services import earnings_estimates as ee`,
  line 19). It is a THIRD delegator, not an independent implementation.
- **`engine.py` has no function named `_fmp_get` at all** (the spec's other
  claim). What actually exists: `engine.py::_fetch_quarterly_history` (line
  287) does an inline `import requests as _r; ... _r.get(f"https://
  financialmodelingprep.com/stable/earnings?...")` — a genuinely independent
  direct call, just not shaped like the other helpers or named what the spec
  said. `engine.py::_fmp_calendar_actuals_for_day` (line 869) is a second,
  separate inline FMP call in the same file.
- **`grep -rl "financialmodelingprep.com" api/` (excluding `.pyc`) finds
  15 files, not 8:** the 6 in-scope files above (via their own literal or,
  for `engine.py`, its two inline calls) PLUS **10 files neither the PRD nor
  the spec named**: `api/routers/calendar.py`, `api/routers/earnings.py`,
  `api/services/bars_fetch.py`, `api/services/calendar_alerts.py`,
  `api/services/catalyst/sources.py`, `api/services/econ_calendar_fmp.py`,
  `api/services/implied_store.py`, `api/services/index_constituents.py`,
  `api/services/screener/fundamentals_bulk.py`, `api/services/ticker_logos.py`
  — each independently confirmed to construct its own literal
  `https://financialmodelingprep.com/...` URL, covering genuinely different
  data classes (earnings/economic calendars, historical bars, analyst-grade
  news, transcript-availability dates, ticker logo images, bulk fundamentals).

**Decision (anti-scope-creep, per the authorization's explicit rules):**
this build's FMP adapter and migration cover the **originally-named 6
call sites** (the PRD's own scope) — not the additionally-discovered 10.
Building `fmp_client.py` to serve 16 files' worth of endpoints in one pass
would be exactly the "flag-day cutover" and "migrate unrelated features
simply because they contain a provider call" the authorization forbids.
The AST census tool (§21.1 of the spec) is built to find the TRUE, full set
(all 15+ files) — with the 10 newly-discovered files in an explicit, named
`QUARANTINE` list (the exact mechanism spec §22 already designs for a
multi-PR migration), not silently exempted or silently expanded into scope.

**Addendum (found while migrating `earnings_estimates.py`'s own 6 call
sites onto `fmp_client`): the true FMP surface is larger still, and a
`financialmodelingprep.com` string grep structurally cannot find the rest
of it.** `earnings_estimates._fmp_get` is not private to that module — this
Section already noted `transcript_indexer.py` and `analyst_grades.py` as
delegators, but tracing every import of `earnings_estimates._fmp_get`
(`grep -rn "from api.services.earnings_estimates import _fmp_get\|earnings_estimates\._fmp_get"`)
finds **7 more**, none of which construct their own
`financialmodelingprep.com` URL and so are invisible to the grep the 15-file
count above is built on: `api/routers/research.py` (2 call sites),
`api/services/bars_sanitize.py` (`/stable/profile`, `/stable/splits`),
`api/services/call_recap_warmer.py`, `api/services/fundamentals.py` (the
*services* one — distinct from the already-migrated `api/routers/
fundamentals.py`), `api/services/ipo_calendar.py`, `api/services/ir_webcast.py`,
`api/services/screener/earnings_dates.py`. A generic low-level HTTP helper
being imported and called directly by other modules is a call-site-discovery
blind spot a literal-URL grep cannot see by construction — the AST census
tool (§21.1) must resolve `_fmp_get` imports/call sites too, not just
`financialmodelingprep.com` literals, or it will undercount again the same
way this Section's own first pass did.

**Consequence for this build:** `earnings_estimates._fmp_get` stays
defined, byte-for-byte unchanged, rather than deleted — it is now confirmed
load-bearing for at least 9 external modules outside this build's approved
scope. Only the 6 originally-scoped call sites *inside* `earnings_estimates.py`
itself were migrated onto `fmp_client` (via a new internal `_fmp_rows`
wrapper); every external consumer of `_fmp_get` is untouched, per the same
anti-scope-creep boundary as the 10-file quarantine above. See commit
`c0a6a5dae`.

### Massive

**The spec's count is accurate — confirmed, no correction needed.**
`grep -rl "api.massive.com" api/` (excluding `.pyc`) returns exactly the 20
files the spec names, including the 2 partner-owned files
(`api/massive_ws_worker.py`, `api/massive_processor.py`) this build does not
touch, per `GOVERNING_PRINCIPLES.md` §5 and the boundary this codebase
already established for those two files. `_MassiveRestClient` at
`massive.py:73` (line 73 in this worktree vs. the spec's cited `76` — a
3-line drift, immaterial), the shared `_http` client at line 61, and
`to_polygon_symbol()` at line 40 all confirmed present exactly as the spec
describes.

### Existing normalized/shared models, caching, retry, config precedents (confirmed, not re-derived)

- `finnhub_client.py`, `alphavantage_client.py`, `journal_two/broker/
  snaptrade_client.py` — all read in full this pass, matching the spec's
  own citations exactly (token-bucket shape, typed-exception shape,
  cached-forbidden idiom).
- `api/services/cache.py` (TTLCache) and `api/services/provider_coverage_
  monitor.py` — confirmed present, to be reused/extended per spec §5.1.
- `FMP_API_KEY`/`MASSIVE_API_KEY` env vars — confirmed as the existing
  configuration boundary (`os.environ.get(...)`), reused, not duplicated.

---
