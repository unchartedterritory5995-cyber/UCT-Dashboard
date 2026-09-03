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

---

## Section 4 — FMP call-site migration: COMPLETE (2026-09-02)

All 8 originally-scoped FMP call sites (the 6 PRD-named files plus the 2
the spec's own pass additionally found — `analyst_grades.py` and
`engine.py`) are migrated off ad-hoc `requests.get` onto the typed
`fmp_client` adapter. Commits, in order: `6235cfc2b` (fmp_client.py itself),
`42115935d` (insider.py), `d82f6730a` (routers/fundamentals.py),
`a137a6c7d` (catalyst/analyst_actions.py), `c0a6a5dae` (earnings_estimates.py,
its own 6 internal call sites), `842bd3c52` (log addendum), `3a6dea330`
(transcript_indexer.py), `5c94118bd` (research/financial_history.py),
`9596b6461` (analyst_grades.py), `efa9f0a53` (engine.py, + a new
`fmp_client.get_earnings_calendar` typed function for `/stable/
earnings-calendar`, the one endpoint not ticker-scoped).

**Pattern that repeated across every file:** delete or leave the module's
own ad-hoc `_fmp_get`-shaped helper (kept, unchanged, wherever an
UNSCOPED external module also imports it directly — see the Section 1
addendum above), add a thin per-module wrapper around the relevant
`fmp_client` typed function(s) that preserves that module's OWN existing
"None/[]/{} on any failure, never raises" contract (some modules needed
`FMPNotFound` treated as silent-empty specifically so a genuinely-empty
result doesn't get logged as a failure; `analyst_grades.py` needed EVERY
exception caught silently, matching its own per-leg `all_answered` cache-TTL
accounting, which was written assuming the FMP call itself never raises),
repoint the call site(s), then repoint or rewrite whatever test file mocked
the old helper. Existing tests that mock a module's own high-level function
(not the FMP layer itself) needed no changes at all — confirmed file by
file rather than assumed.

**Total test surface exercised across the 8 migrations:** the full
`earnings_estimates.py`-adjacent sweep (502/504, 2 pre-existing/unrelated
failures — see Section 1 addendum's neighbor above) plus the ~46-file
broader `engine.py`-adjacent sweep (801 passed, 6 errors all a pre-existing
missing-npm-package Node environment gap in `test_definition_concierge.py`,
unrelated) plus every migrated file's own direct test suite. No regression
found outside the two confirmed-pre-existing, confirmed-unrelated failures.

**Not done, deliberately out of scope for this build (per the same
anti-scope-creep boundary, tracked for the AST census's QUARANTINE list):**
the 10 files Section 1 found via the `financialmodelingprep.com` string
grep that neither the PRD nor the spec named, PLUS the (larger) set found
via the Section 1 addendum's `_fmp_get`-import trace (9 external consumers
of `earnings_estimates._fmp_get`) minus the 2 of those 9 that this pass
migrated anyway because they were on the original 8-file list
(`transcript_indexer.py`, and — via `earnings_estimates.py` itself already
counting — nothing else double-counts). `engine.py`'s own 2 remaining
inline FMP calls (`/stable/news/general-latest`, `/stable/news/stock`,
lines ~2342/2376) are likewise untouched.

**Not yet done — the Massive adapter, Entity Master integration, guard
census tools, admin status endpoints, and the mandatory real-provider
validation checkpoint required before any further broad migration.** See
the D1 authorization's Implementation Checkpoint section — this is
reported to the user as the next decision point, not assumed.

---

## Section 5 — Real-Provider Validation Checkpoint: COMPLETE (2026-09-02)

Per the user's explicit checkpoint authorization, before any broader D1
migration. Commits: `2d5d0ddb3` (minimum-scope `massive_client.py`),
`0616369aa` (a real defect the validation itself found and fixed).

**Built for this checkpoint only** (not a `_MassiveRestClient` migration —
that class and every one of its own call sites stay untouched):
`api/services/massive_client.py` — typed errors, a non-blocking rate
limiter, the cached-forbidden idiom, one typed function `get_quote(ticker,
*, entity_id=None)` that prefers Entity Master's `vendor_symbol(entity_id,
"massive")` and falls back to `to_polygon_symbol()`. Reuses `massive.py`'s
existing shared `httpx.Client` rather than opening a second connection
pool. 15 unit tests, all mocked.

**Live validation run** (bounded, read-only; 16 real FMP calls across 10
endpoints, 8 real Massive calls; both API keys loaded from
`uct-intelligence/.env` and never printed): 7 representative
cases — AAPL (ordinary large-cap), BRK-B (dual-class symbol translation),
SPY (ETF), SPX (index-type entity), ATLQ (active equity, no FIGI on
record), AMWD (delisted equity), ZZZNOTREAL (no such entity/symbol).

**A real defect found and fixed**: Massive's snapshot endpoint answered a
bare HTTP 404 (not the 200-body-with-non-OK-status shape the adapter's
not-found detection was designed around) for AMWD, SPX, and ZZZNOTREAL —
`massive_client.py` classified all three as `MassiveTransient` instead of
`MassiveNotFound`. Fixed with an explicit 404 branch (commit `0616369aa`);
re-run confirmed all three now classify correctly against live data. This
is exactly the class of defect the checkpoint exists to catch before it
reaches a broadly-migrated call site.

**Real semantic differences surfaced, deliberately NOT forced into a false
shared representation:**
- FMP still serves a stale/last-known quote (price=48.09, volume=0,
  dayLow==dayHigh==price) for AMWD, a name Entity Master's own
  `lifecycle_state` already marks `delisted` — while Massive correctly
  returns nothing (404/NotFound) for the same symbol. The two providers
  disagree on what "no data" means for a delisted name; Entity Master's
  lifecycle flag is not contradicted by either, but a caller must check it
  rather than trust either provider's silence/non-silence alone.
- FMP is confirmed 15-minute delayed vs Massive's real-time feed on a live
  price delta (BRK-B: FMP 505.09 vs Massive day-close 505.24 at the same
  moment) — the existing `freshness` field (`delayed_15` vs `real_time`)
  already represents this correctly; not a bug, a confirmation the field
  is meaningful.
- Index-type entities (SPX) are NOT resolvable via either adapter's
  `get_quote` in its current form — FMP needs a different index symbol
  convention and Massive needs an `"I:"` prefix neither adapter
  implements. Correctly surfaced as a capability gap (both `get_quote`
  calls cleanly raised `NotFound`) rather than silently working around it.
  Not fixed — out of scope for this checkpoint; a future index capability
  needs its own per-vendor symbol-formatting rule.

**Entity Master boundary, confirmed working end-to-end**: `resolve()`
correctly resolved all 6 real tickers and returned `not_found` for
ZZZNOTREAL; `vendor_symbol(entity_id, "massive")` returned the correct
`BRK.B` mapping for the one seeded dual-class case, and the Entity
Master-routed path and the `to_polygon_symbol()` fallback path produced
BYTE-IDENTICAL live Massive responses for BRK-B, confirming they agree.
`vendor_symbol(entity_id, "fmp")` returned `None` for every entity tested
— **Entity Master currently has ZERO fmp vendor-symbol rows seeded**
(confirmed by direct query: 141 `entity_vendor_symbols` rows, all
`vendor='massive'`, none `vendor='fmp'`). Live FMP responses confirm this
is NOT a gap: FMP's own `get_quote(BRK-B)` response carries
`"symbol": "BRK-B"` — FMP already speaks the app's native hyphen form
natively, so no FMP-side Entity Master translation was ever needed for
this case.

**Shared `_fmp_get` compatibility path (Section 1 addendum) reconfirmed
safe**: all 9 external consumers still import cleanly, no circular import,
`earnings_estimates._fmp_get` still present and byte-unchanged, and the
module's own 6 internal call sites correctly route through `_fmp_rows`/
`fmp_client` instead. Those 9 external migrations remain explicitly
deferred, not touched by this checkpoint.

**Test baseline**: 460/462 across the consolidated sweep of every file this
whole D1 program has touched (both new client modules, `provider_errors.py`,
`provider_licensing_class.py`, Entity Master's own suite, all 8 migrated
FMP call sites' test suites). The only 2 failures are the exact same
pre-existing `test_implied_backfill.py::TestFiscalJoin` names already
identified and confirmed unrelated (a hardcoded near-future fixture date
real time has since passed) — zero new failures introduced by this
checkpoint.

**Verdict**: `REAL-PROVIDER VALIDATION — PASS WITH CONDITIONS`. FMP's
already-migrated 8 call sites are validated end-to-end against live data
with no further changes needed. Massive validation is narrower — one typed
function (`get_quote`) against real data, no live 401/403/429 exercise (both
keys valid, no error organically triggered), no coverage of the broader
capability set `_MassiveRestClient` actually serves in production (movers,
batch snapshots, daily OHLCV). Recommendation given to the user:
`PROCEED WITH LIMITED D1 MIGRATION` — the FMP migration work already done
stands as validated; broader Massive call-site migration should wait for a
fuller Massive adapter build validated with the same rigor.

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
