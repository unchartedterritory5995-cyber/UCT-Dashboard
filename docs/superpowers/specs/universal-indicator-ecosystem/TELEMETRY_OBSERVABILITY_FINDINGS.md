# Telemetry + Observability Current-State Audit (P6)

Per P6: establish what actually exists TODAY (not the master prompt's proposed events), then compare
against the master prompt's 5-event minimum (§37). Produced by the same research pass as
`TEST_CREDIBILITY_FINDINGS.md`; convergence-verified (see that document's "Confidence" section — Part B
upgraded to High across all six questions after two independent passes reproduced identical file:line
citations and full-suite test numbers).

## Q1 — Structured logging

Real, structured logging exists on exactly one lane: `api/services/screener/scan_evaluator.py` (the nightly
AST-scan sweep) uses `logging.getLogger(__name__)` with a consistent `[scan]`/`[scan-live]` prefix and
parameterized calls (`log.info("[scan] sweep done as_of=%s handed=%s distinct=%s swept=%s ...")`);
`api/services/signature/sweep.py` has comparable logging, confirmed via test names like
`test_a_refusal_is_logged_loudly`.

By contrast: **`api/routers/user_definitions.py` (543 lines — the entire save/list/get/update/delete/share/
propose HTTP surface) has zero logging calls and does not import `logging`.** `api/services/user_definitions.py`
(700+ lines, the persistence layer) also has none — every error becomes only an `HTTPException` returned to
the one caller. `api/services/definition_concierge.py` (the AI/plain-language door) has exactly one log
line in the entire file, firing only on an LLM-call failure — nothing logs a compile start, a success, or
an ordinary translation failure. Frontend: `app/src/components/chart/builder/` (`BuilderSheet.jsx` and
siblings) has zero `console.*` calls of any kind.

**Net: logging exists where an operator already had to debug a silent batch job; it is essentially absent
on the interactive save/import/translate path** — the exact path master-prompt §37 wants instrumented
first.

## Q2 — Traces/correlation IDs

**Do not exist.** `api/main.py`'s middleware stack (`MaintenanceMiddleware`, `CompassPaywallMiddleware`,
`AdminGuardMiddleware`, plus CORS/GZip) stamps no request-scoped ID; no `X-Request-Id` handling found
anywhere. A saved definition gets a stable `def_id`/`ast_hash` at save time, and `ast_hash` (truncated)
appears in some sweep log lines — an incidental, log-greppable thread once something reaches the sweep —
but nothing connects an (unlogged) save/translate event to anything downstream. Master-prompt §27's full
`request → door_detect → parse → translate → canonicalize → typecheck → static_analyze → requirements →
fetch_data → evaluate → deliver` trace does not exist, even partially, on the interactive path today.

## Q3 — Error reporting

`sentry-sdk[fastapi]==2.23.1` is a real dependency, initialized in `api/main.py` (`sentry_sdk.init(dsn=...,
traces_sample_rate=0.1, environment=...)`), gated on `SENTRY_DSN` — actual production value **not checked**
(source-only audit scope; would need a `railway variables` read). More importantly, this is structurally
weaker than it looks for this feature specifically: every failure path in `user_definitions.py` is a
deliberately-caught `ValueError` re-raised as `HTTPException(400/404/402)` — expected, by-design control
flow, not a crash — so Sentry's default unhandled-exception capture would not see it even if perfectly
configured. No dedicated `translation_errors`/`compile_failures` table exists anywhere in the schema. A
save/translate/validation failure today is invisible to structured logs (nearly none exist on this path)
and to Sentry (handled, by design) — it exists only in the HTTP response body sent to the one browser that
hit it, once.

## Q4 — Frontend analytics

**Does not exist**, confirmed independently twice: `app/package.json` has zero analytics dependencies
(PostHog, Segment, Mixpanel, Amplitude, GA/gtag all checked). A repo-wide grep for
`posthog|segment\.|analytics\.track|gtag\(|mixpanel|amplitude|dataLayer|trackEvent` across all of
`app/src` returns only false positives (e.g. `StockChart.jsx`'s "post-setup **segment**," a charting term).
No custom `trackEvent`/`logEvent` helper exists anywhere in the frontend. This is not "analytics exists but
isn't wired to this feature" — there is no analytics layer anywhere in this frontend, for any feature.

## Q5 — Persistence/debug IDs

The real `user_definitions` schema (read directly, `api/services/user_definitions.py:201-213`):
```
id, user_id, def_id, version, rev, ast_hash, definition (JSON), repaint,
deleted_at, created_at   —   unique on (user_id, def_id, version)
```
`def_id` is a stable cross-version artifact ID; `ast_hash` is a real, reusable content fingerprint;
`repaint` is frozen at save time (verified by a dedicated test proving it isn't silently re-derived on
read). **Missing**, relative to master-prompt §16/§52: no `source_dialect`/door field, no
parser/translator/compiler-version stamp, and — a deliberate architectural choice per
`CURRENT_ARCHITECTURE.md` ("raw source text is transient, never saved"), not an oversight — the original
pasted source text is never persisted at all. Practical consequence: telemetry added tomorrow could not be
backfilled from existing rows, and there is no way to reconstruct which door produced an already-saved
artifact from the row alone.

## Q6 — Comparison against the master prompt's 5-event minimum (§37)

| Event | Status | Evidence |
|---|---|---|
| `import_submitted` | **DOES NOT EXIST** | No log line, event, or DB row captures door/dialect/version/size/intent at import time on either side — frontend has no analytics layer at all; backend logs nothing on this path |
| `compile_finished` | **PARTIALLY EXISTS, weakly** | Result computed inline, returned as a transient HTTP response; nothing persists it. 1 log line in all of `definition_concierge.py`, firing only on LLM-call failure — the deterministic Pine/thinkScript/PCF path logs nothing |
| `import_accepted` | **DOES NOT EXIST** | Nothing distinguishes unchanged / suggested-edit-accepted / manual-edit / abandoned; only a final saved row (if any) ever persists, without even a source-door field |
| `delivery_configured` | **DOES NOT EXIST** | No event when a member wires a definition to chart/scanner/alert/threshold/timeframe; DB captures resulting *state*, never the act or timing of the choice |
| `execution_finished` | **PARTIALLY EXISTS, one-sided** | Nightly sweep logs real structured success/failure/counts, operator-facing via Railway logs — not a persisted, per-definition-queryable event. Chart-preview and alert evaluation are not logged at all. For the scan lane specifically, this event is architecturally forbidden from existing on a request path at all (enforced by `test_scan_evaluator_off_request_path.py`) |

## The most actionable finding: reusable telemetry plumbing already exists and simply isn't wired here

Sentry is generic, indicator-agnostic crash reporting, structurally blind to by-design refusals, with
production activation unconfirmed. But **`landing_events`** (`api/services/auth_db.py`) is an
almost-perfectly-shaped, **already-live-in-production** generic event table: `visitor_id, event (TEXT),
props (JSON), referrer, path, user_agent, created_at`, indexed on `(visitor_id, created_at)` and `(event,
created_at)`. `ai_search_log`/`ai_search_usage`/`ai_search_feedback` is a second, independent precedent for
instrumenting a comparable AI-touching feature. **Nothing in the indicator/screener code path currently
calls into either.** This changes recommendation priority materially: the cheapest path to real telemetry
is wiring into existing storage, not designing new infrastructure.

**A second, better-fit precedent, surfaced later in the same audit**: `api/services/signature/ledger.py`'s
`record_coverage`/`latest_coverage` (tested by `test_signature_coverage_receipt.py`) already solves exactly
the "evaluated but found nothing" vs. "never evaluated" disambiguation `execution_finished` needs — its own
docstring: *"Absence of a signal is not proof of evaluation... A reader that has [a receipt] can say
'evaluated, nothing found'. A reader that has none must not."* Scoped today to the signature (proprietary)
sweep, not the user-authored AST scan pipeline — but a stronger, more directly on-point existing pattern to
extend for `execution_finished` specifically than `landing_events` alone. **Between the two, existing,
already-tested infrastructure covers the full 5-event minimum's storage needs** — `landing_events` for the
lighter-weight `import_submitted`/`compile_finished`/`import_accepted`/`delivery_configured` events,
`ledger.py`'s coverage-receipt pattern extended for `execution_finished`.

## Findings (synthesis)

1. Telemetry as the master prompt defines it does not exist for this product surface.
2. What exists is generic crash reporting that structurally cannot see the by-design-refusal failures this
   program cares about most, plus a strong artifact-identity scheme with essentially no logging to thread
   it through.
3. Reusable telemetry plumbing already exists elsewhere in this codebase (`landing_events`, `ai_search_log`,
   `signature/ledger.py`'s coverage-receipt pattern) and simply isn't wired to this feature — this
   substantially lowers the cost of closing the gap.
4. This shares a root cause with the test-credibility lead finding: heavy investment in proving internal
   consistency, comparatively little in capturing what actually happens in production well enough to know
   where to look next.

## Unknowns

- Whether `SENTRY_DSN` is actually set/active in Railway production (source-only audit; would need a
  `railway variables` read — not performed here, out of this pass's scope).
- Whether the same telemetry absence holds in the separate `uct-intelligence`/`uct_intelligence`/
  `morning-wire` repositories (out of scope for this checkout).

## Recommendations

1. Wire the save/import/translate path into the already-live `landing_events` table as the fastest path to
   `import_submitted`/`compile_finished`-equivalent telemetry, rather than designing new storage.
2. Extend `signature/ledger.py`'s coverage-receipt pattern to the AST-scan sweep for `execution_finished`.
3. Add minimal structured logging to `api/routers/user_definitions.py` and `api/services/user_definitions.py`,
   mirroring `scan_evaluator.py`'s existing `[scan]`-prefix convention — independent of any telemetry-event
   design work, this closes a real, current support/debugging liability: right now a save or translate
   failure leaves no server-side trace of any kind.
4. Add a bare request/import/scan correlation ID (a `uuid4()` stamped by one small FastAPI middleware,
   threaded into whatever logging exists) — a low-cost prerequisite for essentially every later
   observability improvement §27/§37 want.

## Risks

1. The save/import path is currently unobservable in production: no structured logging on the interactive
   path, and Sentry structurally doesn't see by-design-refusal failures. If members begin reporting
   translation/save problems at any volume, there is no server-side log or persisted error record to
   investigate from.
2. Zero telemetry means the program's own stated prioritization method (§37-38: which door matters, which
   unsupported names cause the most real failures) has no data source today — near-term roadmap decisions
   in this area are necessarily intuition-based.

## Files inspected

`api/main.py` (middleware stack, Sentry init lines 195-200) · `api/routers/user_definitions.py` ·
`api/services/user_definitions.py` (schema, lines 201-213) · `api/services/definition_concierge.py` ·
`api/services/screener/scan_evaluator.py` · `api/services/signature/sweep.py` ·
`api/services/signature/ledger.py` · `api/services/auth_db.py` (`landing_events` schema) ·
`app/src/components/chart/builder/BuilderSheet.jsx` · `app/package.json` · `requirements.txt`.

## Confidence

**High across all six questions** — both independent research passes confirmed matching answers from
direct code reads (schema, middleware list, `package.json`, `requirements.txt`) rather than inference, and
reproduced identical full-suite test-run numbers. The one explicitly open item (`SENTRY_DSN` production
state) is left unconfirmed rather than assumed either way.
