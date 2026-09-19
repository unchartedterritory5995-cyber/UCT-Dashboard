# Track C — Product Telemetry (Phase One)

Implemented 2026-09-04. Closes RISK-023 (`RISK_REGISTER.md`) — the Phase Zero finding that
this product surface had **zero** telemetry: no structured logging on the interactive
save/import path, no correlation IDs, no frontend analytics layer, nothing persisted
(`TELEMETRY_OBSERVABILITY_FINDINGS.md`).

## Infrastructure: extended, not new

Per that audit's own recommendation, this wires into the already-live, already-tested
`landing_events` table (`api/services/auth_db.py`) rather than building new storage. That
table was built for anonymous marketing-page visitors (`visitor_id, event, props JSON,
referrer, path, user_agent, created_at`, indexed on `(visitor_id, created_at)` and
`(event, created_at)`), but nothing in its schema requires that — an authenticated
`user_id` fits the `visitor_id` slot exactly as well as a localStorage UUID does, and the
existing indexes already narrow to one member's events for the query patterns telemetry
needs (per-member or per-import lookups, not global cross-import joins at scale). **No new
analytics platform, no schema migration.**

Two new, small, additive pieces were built on top of it:

- `api/services/indicator_telemetry.py` — the shared `log_event()` helper, the five-event
  allowlist, and the de-dup guard. Every backend fire point below calls into this one
  function.
- `api/routers/indicator_telemetry.py` — `POST /api/indicator-telemetry/event`, an
  **authenticated** (unlike `landing_analytics.py`, which is deliberately anonymous)
  endpoint used only by the three client-side-parsed paste dialects, and only for the two
  events a client is allowed to assert (`import_submitted`, `compile_finished`).

`signature/ledger.py`'s coverage-receipt pattern was investigated as the Phase Zero audit
recommended for `execution_finished`, but the AST-scan pipeline turned out to already have
its own, closer analog: `scan_coverage` (`api/services/screener/snapshot_db.py`), written
by `evaluate_one` for the `nightly`/`live` modes. See the `execution_finished` section below
for how the two modes are actually covered.

## Why the doors don't fire symmetrically

The five doors do not all reach the backend the same way, and the event design follows the
real architecture rather than pretending otherwise:

- **Pine / thinkScript / PCF paste** — parsed **client-side**, in the browser (`app/src/
  components/chart/engine/ast/{pine,thinkscript,pcf}.js`). The backend never sees a
  parse attempt for these unless the client reports it, so `import_submitted` and
  `compile_finished` fire from the client for these three, via the new endpoint.
- **Plain-language** and **screenshot** — the compile happens in one backend call
  (`definition_concierge.propose` / `indicator_from_image.candidates_from_image`), so both
  events fire server-side, directly in the router handler, with no new endpoint needed.
- **`import_accepted`** and **`delivery_configured`** are server-derived for **all** doors,
  deliberately: a client must never be able to assert its own formula was accepted or
  delivered (see `indicator_telemetry.py`'s `CLIENT_FIREABLE_EVENTS` — the client endpoint
  refuses these three by name, 400).

## The five events

### 1. `import_submitted`

| Door | Fires | Location |
|---|---|---|
| Pine/thinkScript/PCF paste | client, on "Use this formula" click (not on keystroke) | `PineBox.jsx:536` (`onImportTelemetry` call) → `BuilderSheet.jsx`'s `onImportTelemetry` handler on `<ImportBox>` → `app/src/lib/indicatorTelemetry.js::logIndicatorTelemetry` → `POST /api/indicator-telemetry/event` |
| Plain-language | server, top of `propose_definition` | `api/routers/user_definitions.py:316` |
| Screenshot | server, top of `candidates_from_screenshot` (after the feature-flag check) | `api/routers/indicator_vision.py:156` |

Props: `import_id` (correlation key), `dialect`.

### 2. `compile_finished`

| Door | Fires | Notes |
|---|---|---|
| Pine/thinkScript/PCF paste | client, alongside `import_submitted`, same click | Only fires as `success: true` — the "Use this formula" action only runs on an already-usable translation (`PasteBox`'s `use()` early-returns on `!active.formula`), so a genuine parse failure never reaches this callback. **Stated gap**: the failure half of this event is not observable for these three doors from this hook; it's covered by the other two doors below. |
| Plain-language | server, both branches | `api/routers/user_definitions.py:332` (the `bars:too-large` gate, before the model ever runs) and `:348` (after `definition_concierge.propose` returns, success or refusal) |
| Screenshot | server, both branches | `api/routers/indicator_vision.py:167` (bars-too-large gate) and `:190` (after `candidates_from_image` returns) |

Props: `import_id`, `dialect`, `success` (bool), `stage` (`"gate"` or `"compile"`), `gate`
(the refusal gate name, when refused). **Never** the pasted source, the prompt, or image
bytes — see `indicator_telemetry.py`'s module docstring.

### 3. `import_accepted`

Server-only, all five doors converge here: `api/routers/user_definitions.py:183`, inside
`_save_or_400`, fired once, only after `svc.save(...)` succeeds (never on the `except
ValueError` refusal branch). Both `create_definition` (`POST`) and `save_definition`
(`PUT`) call through this one function.

Props: `import_id`, `dialect` (from `DefinitionIn`'s new optional `import_id`/
`source_dialect` fields — telemetry-only, never merged into the persisted `definition`
JSON, never validated by `defSchema`), `def_id`, `def_hash` (from `svc.save`'s own
return value).

**Threading the id across the client/server boundary**: `BuilderSheet.jsx` keeps
`importTelemetryRef` (a `useRef`, mirroring the `savingRef` pattern from RISK-012),
populated by the paste door's `onImportTelemetry` callback and by `ConciergeBox`'s
`onAccept` (which reads `proposal.import_id` — the same id the plain-language door
minted and returned). `save()` passes it as a third, optional argument to
`saveUserDefinition(doc, defId, importTelemetryRef.current)`
(`app/src/hooks/useUserDefinitions.js`), which adds `import_id`/`source_dialect` as
**siblings** of `definition` in the request body — never inside it. Cleared only on a
successful save, so a retried save after a validation error still joins to the same
attempt.

**Stated gap**: the screenshot door's `import_id` is not threaded through to
`import_accepted` in this pass — `ImageBox.jsx`'s `onAccept` reshapes its response into a
new object per-candidate (`onAccept({...})`) rather than passing the top-level response
through, and correctly threading a top-level field down through a per-candidate list
render was judged not worth rushing in this pass. The screenshot door's
`import_submitted`/`compile_finished` pair still fires and is correctly attributed to the
user and timestamp; it just isn't joinable by `import_id` to the eventual accept. A
follow-up.

### 4. `delivery_configured`

Server-only, `api/routers/indicator_alerts.py:334`, inside `create_alert`, fired only when
`alert_user_series.is_user_address(body.indicator)` is true (a user-authored `u_<hex>.plot`
address, never a native indicator like `rsi`) and only after `ias.create(...)` succeeds
(never on the `AdmissionRefused` branch).

Props: `surface` (`"alert"`), `indicator` (the address), `sym`, `tf`.

**Stated gap, not silently omitted**: a definition attached to a **chart widget** is not
instrumented. That attachment lives inside the `charts_workspace_layout` preference blob
alongside dozens of unrelated fields — too diffuse a signal to extract cleanly without a
larger, separate design pass. A definition becoming usable as a **scan filter** is a
client-side, read-time computed property (`_stamped`'s `assert_scannable` in
`user_definitions.py`), not a distinct "attach" action to hook — `import_accepted` already
covers the moment the definition itself was saved.

### 5. `execution_finished`

Two execution modes, two different mechanisms, deliberately:

- **On-demand ("Run Now")** — the one mode with **no persisted receipt today**
  (`evaluate_one`'s own "WRITES NOTHING" behavior for `mode="on-demand"`, RISK-017). A new,
  lightweight, purely observational `landing_events` row fires from
  `api/services/screener/scan_run.py:652`, at the end of `_run_job` (the function `_POOL`'s
  worker thread executes, off any request path), after the job reaches its terminal state.
  It does **not** touch `scan_store`/`scan_coverage` and therefore does not reintroduce the
  state-write RISK-017 forbids for this mode. Props: `def_id`, `mode` (`"on-demand"`), `tf`,
  `as_of`, `state` (`"done"`/`"refused"`), `gate` (when refused).
- **Nightly / Live sweep** — **not duplicated** into `landing_events`. `scan_coverage`
  (`api/services/screener/snapshot_db.py`) is already written per-definition per-tf
  per-as_of by `evaluate_one` for these two modes, and it already answers exactly the
  question `execution_finished` exists to answer ("did this run, and what happened").
  Reconstructing the "event" for these modes means reading that table, joined to its owner
  — see the worked query below.

## De-duplication

`indicator_telemetry.log_event()` is idempotent per `(user_id, event, import_id)` when an
`import_id` is supplied: it checks `landing_events` for an existing row bearing that trio
before inserting. This directly answers "a retried request re-submitting
`import_submitted`" — a client-side network retry or a double-fired handler does not
multiply the count.

**Verified non-vacuous**: `tests/test_indicator_telemetry.py::TestLogEvent::
test_a_repeated_import_id_is_deduplicated_and_only_one_row_lands` fires the same
`(user, event, import_id)` twice and asserts exactly one row landed and the second call
reports `False`.

Events with no natural `import_id` (`delivery_configured`, the nightly/live half of
`execution_finished`) are not deduplicated by this mechanism — their call sites are each
single-fire by construction instead:

- `delivery_configured` fires once per `POST /api/indicator-alerts` request — one HTTP
  request, one function execution, no loop.
- On-demand `execution_finished` fires once per `job_id`: `_run_job`'s own top-of-function
  guard (`if job is None or job["state"] != "queued": return`) already refuses to re-run an
  already-terminal job, for an unrelated reason (a job's answer must not be replaced once a
  member has read it) — and that guarantee also bounds the telemetry fire, verified by
  `tests/test_scan_run.py::test_execution_finished_does_not_fire_twice_for_one_job`, which
  calls `_run_job` a second time directly against an already-terminal job and asserts the
  row count stays at 1.
- The client-side paste-door `import_submitted`/`compile_finished` pair fires once per
  "Use this formula" click — a deliberate, separately-intentioned member action each time,
  not a duplicate (each new click on new/changed text is a genuinely new attempt).

## A real regression this work found and fixed

A full regression sweep (not just the files this track directly touched) surfaced that
`ImportBox.thinkscript.test.jsx`'s save-verification test used
`H.requests.find((r) => r.method === 'POST')` to locate the definition-save request. Before
this track, exactly one `POST` fired during that test's flow; after it, the new
`import_submitted`/`compile_finished` telemetry calls **also** POST (to
`/api/indicator-telemetry/event`), and `.find()` returned the first — a telemetry
event, not the save — causing a `TypeError` deep in the test. Confirmed via `git stash`
(twice) that this was a real, deterministic regression (reproduced 3/3 runs with the
change present, absent 3/3 runs without it) rather than the pre-existing, already-documented,
unrelated flake elsewhere in the same file (a whitespace/timing issue, still present and
unaffected either way — see `PHASE_ONE_PLAN.md`). Fixed by scoping the test's selector to
the actual endpoint (`r.url.includes('/api/user-definitions')`).

## Content-safety hardening (2026-09-04, owner review) — EVENT_SCHEMAS is the primary defense

The first pass of this track shipped a 200-character length ceiling on `props` values as its
only structural guard beyond caller discipline. Owner review correctly rejected that as
insufficient: **a pasted script, a plain-language prompt, or a sensitive fragment is routinely
under 200 characters**, so a length-only gate would wave through exactly the content it exists
to stop.

`api/services/indicator_telemetry.py::EVENT_SCHEMAS` is now the primary defense — an explicit,
named `(property → allowed types)` allowlist for **each of the five events separately**:

| Event | Allowed properties (beyond the shared correlation set) |
|---|---|
| `import_submitted` | *(correlation fields only — see below)* |
| `compile_finished` | `success` (bool), `stage` (str), `gate` (str), `source_length`/`node_count`/`latency_ms` (int/float) |
| `import_accepted` | `source_length`/`node_count` (int/float) |
| `delivery_configured` | `surface`, `destination`, `indicator`, `sym`, `tf` (str) |
| `execution_finished` | `mode`, `tf`, `as_of`, `session`, `state`, `gate` (str), `universe` (str/int), `latency_ms` (int/float) |

Every event additionally allows the shared correlation set — `import_id`, `def_id`, `def_hash`,
`dialect`, `door` (all `str`) — the "which journey, which formula, which door" axis, never
content.

**`_prop_violation(event, key, value)` is the one function both enforcement paths ask** —
this repo's own most-repeated defect is a second authority over one value, so there is exactly
one place that decides what a property may be:

- **`sanitize_props()`** (used by `log_event()`, i.e. every server-side call site) is
  *lenient*: anything `_prop_violation` flags is silently **dropped**, matching `log_event`'s
  pre-existing "a telemetry failure must never break the product action it observes" contract.
  The event still writes, with only its allowed fields.
- **`EventBody._props_must_be_allowed_for_this_event`** (the client-facing HTTP door,
  `api/routers/indicator_telemetry.py`) is *strict*: the same violation **rejects the whole
  request** (422), appropriate for untrusted network input where surfacing a bug early beats
  silently losing data.

**Three independent rules, not just one**, closing the specific bypasses named in review:

1. **Name allowlist** — a key not in the event's schema is refused regardless of its value's
   length, type, or shape. An 11-character `{"prompt": "buy signal"}` is refused exactly as a
   2,000-character one would be, because `prompt` is not a name either schema declares.
2. **Scalar-only** — a list or dict value is *never* allowed, under any key, on any event. This
   closes the "wrap the real content in a container under an otherwise-allowed key" bypass
   (`{"gate": {"note": "<the actual prompt>"}}`, or a list) that a flat per-key check alone
   would miss.
3. **Type fidelity** — a value must match its schema's declared Python type(s) exactly; `bool`
   is treated as distinct from `int`/`float` despite Python's own subclassing (`_type_ok`),
   so a numeric-only field cannot silently accept `True`/`False`.

**The 200-character cap survives as defense-in-depth only** (`_MAX_PROP_STRING_LEN`), for an
*allowed* field that somehow arrives implausibly long — it is deliberately no longer the first
or only line of defense, per the owner's explicit requirement.

**Tests** (`tests/test_indicator_telemetry.py::TestEventSchemas` + new `TestClientRouter`
cases): every documented field for every event round-trips; an unlisted name is dropped
regardless of length (both a short and a long planted value); list/dict-wrapped content under
an allowed key is refused at four different nesting shapes; a bool cannot pass as a numeric
field; `log_event()` and `sanitize_props()` agree end-to-end; and the client router's strict
(422) path is exercised for the same short-unlisted-name and nested-container cases. The
allowlist's load-bearing-ness was verified non-vacuous by monkeypatching `_prop_violation` to
always allow and confirming a previously-refused short unlisted field then survives.

## Reconstructing a full member journey

**Case 1 — a paste door, end to end** (the fully-joined case):

```sql
-- Everything for one import attempt, by its import_id, across both events + the accept:
SELECT event, created_at, props
FROM landing_events
WHERE visitor_id = :user_id
  AND json_extract(props, '$.import_id') = :import_id
ORDER BY created_at;
-- Expect, in order: import_submitted, compile_finished, (if saved) import_accepted
```

**Case 2 — did an accepted definition ever get delivered or executed?**

```sql
-- 1. Find the def_id from import_accepted:
SELECT json_extract(props, '$.def_id') AS def_id
FROM landing_events
WHERE visitor_id = :user_id AND event = 'import_accepted'
  AND json_extract(props, '$.import_id') = :import_id;

-- 2. Was it ever attached to an alert?
SELECT * FROM landing_events
WHERE visitor_id = :user_id AND event = 'delivery_configured'
  AND json_extract(props, '$.indicator') LIKE :def_id || '.%';

-- 3. Was it ever run on-demand?
SELECT * FROM landing_events
WHERE visitor_id = :user_id AND event = 'execution_finished'
  AND json_extract(props, '$.def_id') = :def_id;

-- 4. Was it ever swept nightly/live? (a DIFFERENT table — see below)
SELECT def_hash, tf, as_of, evaluated, answered, dropped, not_computable, freshness
FROM scan_coverage
WHERE def_hash = (
  -- def_hash isn't stored on the definitions row directly; it's derived from
  -- the definition's AST via scan_definition.assert_scannable(definition)["def_hash"],
  -- exactly as `sweep_job()` itself does when it reads receipts back (scan_evaluator.py).
  -- In practice: look up the definition by def_id, run assert_scannable, take def_hash.
  :def_hash
)
ORDER BY as_of DESC;
```

## Tests

- `tests/test_indicator_telemetry.py` (14 tests) — the shared `log_event` helper (unknown
  event refused, successful write, de-dup guard + its non-duplicate/cross-user controls,
  never raises on a broken connection) and the client router (auth required, only
  client-fireable events accepted, server-only events refused by name).
- `tests/test_user_definitions.py` (+4 tests) — `import_accepted` fires once on a
  successful create, does not fire on a store refusal, omits journey fields when the
  caller sends none, fires again (not a duplicate) on a subsequent edit.
- `tests/test_scan_run.py` (+3 tests) — on-demand `execution_finished` fires once on
  success, fires with its gate on a refused run, does not fire twice for one job.
- `tests/test_indicator_alerts_telemetry.py` (3 tests) — `delivery_configured` fires only
  for a user-authored address, never a native one, never on a refused admission.
- `app/src/components/chart/builder/pineBoxImportTelemetry.test.jsx` (5 tests) — the real
  `PasteBox`/`ImportBox`, a real script typed in, a real click: `onImportTelemetry` fires
  once with the detected dialect, never on a keystroke alone, and never changes `onPick`'s
  own guarded payload contract.
- `app/src/hooks/useUserDefinitions.saveTelemetry.test.js` (5 tests) — `saveUserDefinition`'s
  new third argument is fully additive: absent by default, correctly threaded as sibling
  fields (never inside `definition`) when present, works on both create and edit.

All 38 new tests pass. Full regression sweep run: `tests/test_user_definitions*.py`,
`tests/test_indicator_vision`-adjacent (`test_indicator_from_image.py`,
`test_exposed_routes_gated.py`), `tests/test_indicator_alert_*.py`, `tests/test_scan_run.py`,
`tests/test_scan_evaluator*.py`, `tests/test_scan_store.py`, `tests/test_definition_concierge.py`
(one pre-existing stale assertion found and fixed — see below, unrelated to telemetry
correctness itself), `tests/test_alert_rev_migration.py`, `tests/test_ast_multi_tree_parity.py`,
`tests/test_entitlements.py`, `tests/test_phase_e_acceptance.py`,
`tests/test_scan_evaluator_off_request_path.py`, `tests/test_starter_library.py`,
`tests/test_user_definition_edit_forget.py`, `tests/test_user_definition_relint.py` — 510
backend tests green. Frontend: the full `app/src/components/chart/builder` directory
(1593 of 1596 passing; the 3 remaining are the pre-existing, already-documented
`ImportBox.thinkscript.test.jsx` timing flake, confirmed via `git stash` to be present
identically without any Track C change).

**A drive-by fix, found during the sweep, unrelated to telemetry correctness**:
`tests/test_definition_concierge.py`'s `test_a_PAID_user_gets_the_concierges_answer_and_a_
refusal_is_a_200` asserted a raw `400` for an over-sized `bars` payload on `/propose` — a
shape RISK-016 (Track B, earlier this same session) already changed to the door's
`{ok:false, gate, reason}` convention. The test was never updated when that fix landed.
Confirmed via `git stash` that it fails identically with every Track C change removed.
Fixed to assert the current, correct shape.
