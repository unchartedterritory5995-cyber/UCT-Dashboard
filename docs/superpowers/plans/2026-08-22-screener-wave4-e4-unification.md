# Screener Wave 4 — E-4 Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formula scans join the Scanner as a first-class filter (nightly `scan_hits` intersection, freshness disclosed per hash), one saved-screens manager lists screen specs and formula definitions together, and the My Formulas tab retires.

**Architecture:** Backend first — two new `scan_store` read primitives (latest coverage, batched), a `scan` filter branch in `query.build_where` that reuses `scan_store.join_clause` verbatim and reports per-hash freshness in the response, and a per-user `my_scans` category appended by `filters.meta(user_id=...)`. Frontend second — a dedicated scan chip fed by the meta entry (one authority for counts), then a `ScreensManager` component that replaces `SaveScreenBar` in ScannerShell's `saveBar` slot and absorbs the My Formulas tab's definition detail (ScanResults + CoverageLine kept verbatim). Cutover is two atomic commits, each moving its own rails.

**Tech Stack:** FastAPI + SQLite (screener.db `scan_hits`/`scan_coverage`, auth.db `screener_saved_screens`, user_definitions.db) · React 19 + SWR + the Wave-3 shell · vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-08-21-screener-deep-work-design.md` §4 (binding), §10 Wave 4 row. Surface maps with exact line numbers: `.superpowers/sdd/wave4-maps/1-backend-join.md` … `4-meta-per-user.md` (read the map section for any file you touch — line numbers there are measured, not remembered).

## Recorded supersessions (state these wherever they apply — they are deliberate, not drift)

1. **E4-A5 is superseded.** `api/routers/scan_results.py`'s module header and `scan_store.join_clause`'s docstring both record the decision NOT to make the scan join a `query.run_scan` filter type, on freshness-story grounds. Wave 4 wires exactly that filter type. The objection is answered by **disclosure, not separation**: every joined hash reports its own `as_of` in the response's `scan_joins` and on the chip, so the nightly-artifact story and the live-snapshot story stay distinguishable inside one response. Task 2 updates BOTH stale docstrings in the same commit that wires the branch (the repo's un-updated-rationale lesson: `scan_evaluator.enabled()`'s "E-4 has not wired a surface" docstring survived falsely for weeks).
2. **Spec §4(b)'s "multiple `{key:'scan'}` filters" literal is superseded.** The shell's filter state is a MAP keyed by filter key at every seam (useScreenSpec state, `specToFilters`' `Object.fromEntries`, the `s=` codec, FilterChips/FilterRail React keys, SharedScreen's `<li key>`): duplicate `scan` keys silently collapse. The shape that survives every seam is ONE `scan` key whose `value` is a def_hash string OR an array of def_hash strings; the backend normalizes to a list and each hash contributes its own EXISTS fragment, AND-joined. Same semantics, map-safe.
3. **Spec §4(b)'s literal `ticker IN (SELECT …)` SQL is superseded by `scan_store.join_clause`'s EXISTS fragment** — semantically identical over these schemas, and the fragment already has one owner with behavior-pinning tests. Restating the SQL in `query.py` would be a second authority over the join.
4. **A shared/saved spec carrying a scan filter publishes the def_hash — DELIBERATE.** `GET /api/screener/shared/{share_token}` is public-by-design and serves specs verbatim, so a recipient (even logged out) sees the hash and the scan's `label`. Accepted because a def_hash is member-independent maths (two members with the same formula share one hash, one sweep, one result set — `scan_definition.py:215-218`), the TREE stays private (only the hash travels), and replaying it through `/api/screener/scan` or `/api/scans/definition-results` is paid-gated. Recorded here so it reads as decision, not leak.
5. **The cutover is TWO atomic commits, not one** (adapting the single-commit instruction): `reachable.test.js` fails BY NAME on any committed-but-unimported file, so the manager cannot land unwired and `SaveScreenBar` cannot outlive its replacement in the same tree. Commit A (Task 5) swaps the `saveBar` slot, deletes SaveScreenBar + its test, and moves the share-flow rails. Commit B (Task 7) retires the My Formulas tab, deletes SavedScreensPanel, and moves the scanmount/reachable rails. Each commit moves exactly the rails anchored on the surface it replaces — the spec's actual requirement ("the rails move deliberately in the same commit as the mounts").

## Global Constraints

- **One writer per column / derive, never restate:** the join fragment comes from `scan_store.join_clause`; the sweep timeframe is spelled once (`scan_store.SCAN_JOIN_TF`, Task 1) and read everywhere else; chip counts come from the meta entry's `latest` (never a second fetch that could disagree).
- **Honest-None:** a hash with no coverage row joins NOTHING and is disclosed (`applied: false` / "first sweep tonight") — never a silent no-op clause, never a fabricated zero. `coverage() is None` means "nobody looked", not "no matches".
- **`scan_evaluator` NEVER imports onto a request path** — `tests/test_scan_evaluator_off_request_path.py` walks every route handler transitively and fails by name. Request-path code uses `scan_store` / `scan_definition` / `user_definitions` only (all precedented in routers).
- **No new routes.** `EXPECTED_SCREENER_ROUTES = 12` / `EXPECTED_SCANS_ROUTES = 16` (test_scan_screener_auth.py:85-86, pinned twice — route table + AST oracle) stay untouched. My-scans data rides `GET /api/screener/meta`; per-request freshness rides `POST /api/screener/scan`'s response.
- **No invented thresholds; probe names derived, never typed; verify with AST, not grep.**
- **Never `git add -A`** — this branch takes concurrent commits. Add only your task's files.
- **Local flag divergence:** `SCAN_SWEEP_ENABLED` defaults `"0"` in code, `=1` on Railway — a local box has NO coverage rows unless a test writes them. Every test that needs a swept state seeds `scan_store.record_coverage`/`record_hits` explicitly with `SCREENER_DB_PATH` pointed at a tmp file; never rely on a live sweep, and never let a test reach the default DB path (`C:\data` is real on this box).
- Frontend suite: run from `app/` with `--pool=threads --execArgv=--no-warnings`. Three pre-existing red files from master (sourcesAreText, weekAnchor/CalendarWidget.weekIntent, FuturesStrip) are not this wave's.

## Known traps (cite by number in task briefs)

- **K1 — the plural-`values` silent no-op:** `query.build_where`'s generic `in` branch reads `f.get("values")` and appends NO clause when empty (query.py:34-38). A scan filter falling through to it returns the whole universe unfiltered. The scan branch runs BEFORE `column_for`/`is_valid_op`/the op ladder and REFUSES on empty/malformed value.
- **K2 — `Object.fromEntries` duplicate collapse:** applying a saved/shared spec with duplicate keys keeps only the last (`specToFilters`, useScreenSpec.js:8-9). Hence supersession #2.
- **K3 — the 6h meta SWR dedupe:** `useScreenerMeta` dedupes `/api/screener/meta` for 6 hours (hooks/useScreenerMeta.js:9). Without the Task-5 `mutate` wires, a freshly saved definition is invisible in `my_scans` for up to 6h.
- **K4 — the zero-arg meta stub tripwire:** `tests/test_scan_screener_auth.py:282` stubs `scr_filters.meta` as a ZERO-ARG lambda; giving `meta()` a `user_id` parameter 500s the paid-200 sweep until the stub is updated — that red is the deliberate-edit signal, not an accident (Task 3 updates it in the same commit).
- **K5 — FilterRail drops unknown categories silently:** a filter whose `category` is not in `meta.categories` vanishes without error (FilterRail.jsx:18-25). `my_scans` must be appended to BOTH the categories list and the entry's `category`.
- **K6 — literal-path controls crash on deletion (ENOENT):** `Screener.scanmount.test.jsx` reads `[CoverageLine.jsx, ScanResults.jsx, SavedScreensPanel.jsx, pages/Screener.jsx]` by path (413-419); `reachable.test.js` anchors on the literal line `import ScanResults from './ScanResults'\n` inside SavedScreensPanel.jsx; `screenSharing.mount.test.jsx` reads `[SaveScreenBar.jsx, shell/ScannerShell.jsx, pages/Screener.jsx]` (269-275). Deleting a file without re-pointing its control crashes the control rather than failing it.
- **K7 — `useSavedScreens`' silent 402:** its fetcher never checks `r.ok`, so a refused read renders as "None saved yet". The manager fixes the fetcher to throw (error ≠ empty — the scanmount rail's standing pin).
- **K8 — a hits-derived "latest" lies:** a swept zero-hit session writes a coverage row and NO hits rows. Latest MUST come from `scan_coverage` (Task 1) or a quiet day silently joins an older day's matches.
- **K9 — FilterControl matches presets by exact quad `(op, value, min, max)`** (FilterControl.jsx:7-8): scan presets carry SCALAR hash values so the select re-finds them; the multi-hash array form exists only after a merge (manager/chip), where the select legitimately shows `Custom…`-free "Any" fallback (scan entry has `allow_custom: false`, so no Custom option renders).

---

### Task 1: `scan_store` — latest-coverage primitives + the one tf spelling

**Files:**
- Modify: `api/services/screener/scan_store.py` (append after `coverage()`, before the join section)
- Test: `tests/test_screener_wave4_store.py` (new)

**Interfaces:**
- Produces: `SCAN_JOIN_TF = "D"` (module constant), `latest_covered_as_of(def_hash, tf) -> Optional[int]`, `latest_coverage_for(def_hashes, tf) -> dict`. Consumed by Task 2 (query) and Task 3 (meta).

- [ ] **Step 1: failing tests** — write `tests/test_screener_wave4_store.py`:

```python
"""Wave 4: the latest-coverage primitives — scan_coverage is the ONLY source.

Every test pins SCREENER_DB_PATH to a tmp file (the shared-root guard and
C:\\data both make the default path radioactive on this box).
"""
import importlib

import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    from api.services.screener import snapshot_db, scan_store
    importlib.reload(snapshot_db)
    importlib.reload(scan_store)
    scan_store.init_db()
    return scan_store


H1 = "sha256:" + "a" * 64
H2 = "sha256:" + "b" * 64


def _cover(store, h, day, answered=10, hits=("NVDA",)):
    store.record_hits(h, "D", day, list(hits))
    store.record_coverage(h, "D", day, evaluated=12, answered=answered,
                          dropped=1, not_computable=12 - answered - 1,
                          dropped_symbols=[{"ticker": "XX", "reason": "no-bars"}])


def test_latest_reads_scan_coverage_never_scan_hits(store):
    # Day 1: hits + coverage. Day 2: swept, ZERO hits -- coverage row only.
    _cover(store, H1, 20260818, hits=("NVDA", "AMD"))
    store.record_coverage(H1, "D", 20260819, evaluated=12, answered=12,
                          dropped=0, not_computable=0, dropped_symbols=[])
    # K8: a hits-derived latest would answer 20260818 and silently join the
    # older day's matches. The coverage-derived answer is the quiet day.
    assert store.latest_covered_as_of(H1, "D") == 20260819


def test_never_swept_is_none_not_zero(store):
    assert store.latest_covered_as_of(H1, "D") is None


def test_batch_returns_each_hashes_own_latest_and_omits_the_unswept(store):
    _cover(store, H1, 20260818)
    _cover(store, H1, 20260820, answered=9)
    _cover(store, H2, 20260819)
    out = store.latest_coverage_for([H1, H2, "sha256:" + "c" * 64], "D")
    assert set(out) == {H1, H2}          # the unswept hash is ABSENT, not null
    assert out[H1]["as_of"] == 20260820
    assert out[H1]["answered"] == 9
    assert out[H2]["as_of"] == 20260819
    for k in ("as_of", "evaluated", "answered", "dropped",
              "not_computable", "freshness"):
        assert k in out[H1]


def test_batch_empty_input_is_empty_dict(store):
    assert store.latest_coverage_for([], "D") == {}
    assert store.latest_coverage_for(None, "D") == {}


def test_scalar_is_the_batch_not_a_second_query(store):
    # Derive, never restate: the scalar delegates to the batch.
    _cover(store, H1, 20260818)
    calls = []
    real = store.latest_coverage_for
    store.latest_coverage_for = lambda hs, tf: (calls.append(1) or real(hs, tf))
    try:
        assert store.latest_covered_as_of(H1, "D") == 20260818
    finally:
        store.latest_coverage_for = real
    assert calls == [1]


def test_scan_join_tf_is_the_sweeps_default_tf(store):
    # The literal "D" is forced by the off-request-path rail (query/filters
    # cannot import the evaluator). THIS test may -- it pins the two spellings
    # together so they cannot drift.
    from api.services.screener import scan_evaluator
    assert store.SCAN_JOIN_TF == scan_evaluator.DEFAULT_TF


def test_tf_label_still_refused_by_name(store):
    with pytest.raises(ValueError):
        store.latest_covered_as_of(H1, "1D")
```

- [ ] **Step 2: run to verify RED** — `python -m pytest tests/test_screener_wave4_store.py -v` → AttributeError on the missing functions.

- [ ] **Step 3: implement** — append to `api/services/screener/scan_store.py` (match the module's exact idioms — `_ensure()`, `contextlib.closing(snapshot_db.connect())`, `sqlite3.Row` access by name; read `hits()` at :244 first):

```python
# The sweep's timeframe, spelled ONCE for request-path consumers. It equals
# scan_evaluator.DEFAULT_TF, restated here because the off-request-path rail
# (tests/test_scan_evaluator_off_request_path.py) forbids importing the
# evaluator from anything a route handler reaches; the equality is pinned by
# tests/test_screener_wave4_store.py::test_scan_join_tf_is_the_sweeps_default_tf.
SCAN_JOIN_TF = "D"


def latest_covered_as_of(def_hash: str, tf: Any):
    """MAX(as_of) holding a COVERAGE row for this (def_hash, tf), else None.

    None == "nobody has ever looked" == the chip's "first sweep tonight".
    Delegates to latest_coverage_for — one query shape, one owner.
    """
    row = latest_coverage_for([def_hash], tf).get(str(def_hash or "").strip())
    return row["as_of"] if row else None


def latest_coverage_for(def_hashes, tf) -> dict:
    """{def_hash: {as_of, evaluated, answered, dropped, not_computable,
    freshness}} for each hash's LATEST swept session.

    ⛔ scan_coverage ONLY, never scan_hits: a swept zero-hit session writes a
    coverage row and no hits rows, so a hits-derived latest would silently
    join an OLDER day's matches — the "quiet market" lie the three-state
    contract exists to kill. A hash with no coverage row is ABSENT from the
    result (never null-filled): absent IS the answer.

    One statement regardless of input size — meta() calls this per request on
    the one shared uvicorn loop; an N+1 here multiplies into every member's
    page load.
    """
    code = _normalise_tf(tf)
    hashes = sorted({str(h).strip() for h in (def_hashes or []) if str(h or "").strip()})
    if not hashes:
        return {}
    _ensure()
    marks = ",".join("?" for _ in hashes)
    sql = (
        "SELECT c.def_hash, c.as_of, c.evaluated, c.answered, c.dropped, "
        "c.not_computable, c.freshness FROM scan_coverage c "
        "JOIN (SELECT def_hash, MAX(as_of) AS m FROM scan_coverage "
        "      WHERE tf=? AND def_hash IN (" + marks + ") GROUP BY def_hash) x "
        "  ON x.def_hash = c.def_hash AND x.m = c.as_of "
        "WHERE c.tf=?")
    with contextlib.closing(snapshot_db.connect()) as conn:
        rows = conn.execute(sql, [code, *hashes, code]).fetchall()
    return {r["def_hash"]: {
        "as_of": r["as_of"], "evaluated": r["evaluated"],
        "answered": r["answered"], "dropped": r["dropped"],
        "not_computable": r["not_computable"], "freshness": r["freshness"],
    } for r in rows}
```

- [ ] **Step 4: run to verify GREEN** — `python -m pytest tests/test_screener_wave4_store.py tests/test_scan_store.py -v` (the existing store suite must stay green untouched).

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/scan_store.py tests/test_screener_wave4_store.py
git commit -m "screener: latest-coverage primitives — scan_coverage owns 'latest', absent means nobody looked"
```

---

### Task 2: `query.py` — the scan filter branch + the E4-A5 docstring supersession

**Files:**
- Modify: `api/services/screener/query.py`
- Modify: `api/routers/scan_results.py` (module header docstring ONLY)
- Modify: `api/services/screener/scan_store.py` (`join_clause` docstring ONLY)
- Test: `tests/test_screener_wave4_query.py` (new)

**Interfaces:**
- Consumes: `scan_store.SCAN_JOIN_TF`, `latest_covered_as_of`, `join_clause` (Task 1).
- Produces: `run_scan` response gains `"scan_joins": [{"def_hash", "as_of" (int|None), "applied" (bool)}, ...]` (always present, `[]` when no scan filter). `build_where(filter_specs, scan_joins=None)` — the optional out-list keeps the 2-tuple return and every existing caller.
- The wire filter shape: `{"key": "scan", "op": "in", "value": "<def_hash>" | ["<def_hash>", ...], "label"?: str}` — extra fields (label) ignored by the backend.

- [ ] **Step 1: failing tests** — `tests/test_screener_wave4_query.py`:

```python
"""Wave 4: the scan filter branch. Every case seeds its own store state
(SCAN_SWEEP_ENABLED is 0 locally -- there is no live sweep to lean on)."""
import importlib

import pytest


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    from api.services.screener import snapshot_db, scan_store, query
    importlib.reload(snapshot_db)
    importlib.reload(scan_store)
    importlib.reload(query)
    snapshot_db.init_db()
    import contextlib
    with contextlib.closing(snapshot_db.connect()) as conn:
        for t, px in (("NVDA", 100.0), ("AMD", 50.0), ("TSLA", 200.0)):
            conn.execute(
                "INSERT INTO screener_rows (ticker, price, snapshot_date, built_at) "
                "VALUES (?,?,?,?)", (t, px, "2026-08-20", 1))
        conn.commit()
    return snapshot_db, scan_store, query


H1 = "sha256:" + "a" * 64
H2 = "sha256:" + "b" * 64


def _sweep(scan_store, h, day, hits):
    scan_store.record_hits(h, "D", day, hits)
    scan_store.record_coverage(h, "D", day, evaluated=3, answered=3,
                               dropped=0, not_computable=0, dropped_symbols=[])


def test_scan_filter_intersects_at_the_hashes_latest_coverage(env):
    _, scan_store, query = env
    _sweep(scan_store, H1, 20260818, ["NVDA", "AMD", "TSLA"])
    _sweep(scan_store, H1, 20260820, ["NVDA"])          # latest wins
    out = query.run_scan({"filters": [{"key": "scan", "op": "in", "value": H1}]})
    assert [r["ticker"] for r in out["rows"]] == ["NVDA"]
    assert out["total"] == 1                              # describe_rows saw the SAME where
    assert out["scan_joins"] == [{"def_hash": H1, "as_of": 20260820, "applied": True}]


def test_two_hashes_AND_each_at_its_own_latest(env):
    _, scan_store, query = env
    _sweep(scan_store, H1, 20260820, ["NVDA", "AMD"])
    _sweep(scan_store, H2, 20260819, ["NVDA", "TSLA"])   # divergent latest is NORMAL
    out = query.run_scan({"filters": [
        {"key": "scan", "op": "in", "value": [H1, H2]}]})
    assert [r["ticker"] for r in out["rows"]] == ["NVDA"]
    joins = {j["def_hash"]: j for j in out["scan_joins"]}
    assert joins[H1]["as_of"] == 20260820 and joins[H2]["as_of"] == 20260819


def test_never_swept_hash_is_INERT_and_disclosed_not_a_silent_universe(env):
    _, scan_store, query = env
    _sweep(scan_store, H1, 20260820, ["NVDA"])
    out = query.run_scan({"filters": [
        {"key": "scan", "op": "in", "value": [H1, H2]}]})
    # H2 has no coverage row: its clause is OMITTED (H1 still filters) and the
    # omission is REPORTED -- the client labels "first sweep tonight" from this.
    assert [r["ticker"] for r in out["rows"]] == ["NVDA"]
    joins = {j["def_hash"]: j for j in out["scan_joins"]}
    assert joins[H2] == {"def_hash": H2, "as_of": None, "applied": False}


def test_empty_or_malformed_value_REFUSES_never_the_silent_noop(env):
    _, _, query = env
    for bad in (None, "", [], [""], [None], 7, [7]):
        with pytest.raises(ValueError):
            query.run_scan({"filters": [{"key": "scan", "op": "in", "value": bad}]})


def test_scan_op_other_than_in_refused(env):
    _, _, query = env
    with pytest.raises(ValueError):
        query.run_scan({"filters": [{"key": "scan", "op": "eq", "value": H1}]})


def test_no_scan_filter_means_empty_scan_joins_and_untouched_behavior(env):
    _, _, query = env
    out = query.run_scan({"filters": [{"key": "price", "op": "gte", "min": 60}]})
    assert out["scan_joins"] == []
    assert sorted(r["ticker"] for r in out["rows"]) == ["NVDA", "TSLA"]


def test_unknown_keys_still_refuse(env):
    _, _, query = env
    with pytest.raises(ValueError):
        query.run_scan({"filters": [{"key": "not_a_key", "op": "eq", "value": 1}]})


def test_the_fragment_is_the_stores_never_restated(env):
    # Derive, never restate: query.py contains no scan_hits SQL of its own.
    import inspect
    from api.services.screener import query
    src = inspect.getsource(query)
    assert "scan_hits" not in src
```

(If `screener_rows`'s NOT NULL set makes the 4-column INSERT refuse, read `snapshot_db.COLUMNS`/schema and extend the fixture INSERT minimally — adapt to reality and note it.)

- [ ] **Step 2: RED** — `python -m pytest tests/test_screener_wave4_query.py -v`.

- [ ] **Step 3: implement** in `api/services/screener/query.py`. Add the import and constant at top (`from . import filters, snapshot_db, scan_store` — router-safe: `scan_results.py` already imports scan_store). Insert the branch at the TOP of `build_where`'s loop (before `column_for` — K1) and thread the out-list:

```python
_SCAN_KEY = "scan"


def _scan_clauses(f, clauses, params, scan_joins):
    """The my_scans join: nightly scan_hits ∩ screener_rows, disclosed per hash.

    Supersedes E4-A5 (see scan_results.py's header): the freshness objection
    is answered by DISCLOSURE — every joined hash reports its own as_of in
    scan_joins, and a hash with no receipt joins NOTHING and says so
    (applied: False == "first sweep tonight"). ⛔ K1: an unresolvable scan
    filter REFUSES — the generic in-branch's silent empty-values no-op would
    return the whole universe here.
    """
    if f.get("op") != "in":
        raise ValueError(f"bad op {f.get('op')} for scan")
    raw = f.get("value")
    hashes = raw if isinstance(raw, list) else [raw]
    hashes = [h for h in hashes if isinstance(h, str) and h.strip()]
    if not hashes or (isinstance(raw, list) and len(hashes) != len(raw)) \
            or (not isinstance(raw, (list, str))):
        raise ValueError("scan filter requires def_hash value(s)")
    for h in hashes:
        latest = scan_store.latest_covered_as_of(h, scan_store.SCAN_JOIN_TF)
        if latest is None:
            # Never swept (withheld is indistinguishable at the store, by
            # design): INERT and disclosed, per spec §4(c).
            if scan_joins is not None:
                scan_joins.append({"def_hash": h, "as_of": None, "applied": False})
            continue
        frag, frag_params = scan_store.join_clause(
            h, scan_store.SCAN_JOIN_TF, latest)
        clauses.append(frag)
        params.extend(frag_params)
        if scan_joins is not None:
            scan_joins.append({"def_hash": h, "as_of": latest, "applied": True})


def build_where(filter_specs, scan_joins=None):
    clauses, params = [], []
    for f in filter_specs or []:
        key, op = f.get("key"), f.get("op")
        if key == _SCAN_KEY:
            _scan_clauses(f, clauses, params, scan_joins)
            continue
        col = filters.column_for(key)
        ...   # the rest of the loop byte-identical
```

In `run_scan`: `scan_joins = []` before the `build_where` call, pass it, and add `"scan_joins": scan_joins` to the return dict. The joined `where`/`params` already reach both statements (rows + `describe_rows`) — touch nothing else there.

Then the two docstring supersessions, same commit:
- `api/routers/scan_results.py` header: replace the paragraph arguing against a run_scan filter type with: *"E4-A5 RESOLVED BY WAVE 4: the scan join IS a `query.run_scan` filter branch now (`{key:'scan'}`). The freshness objection this header used to record is answered by disclosure — `run_scan` reports each joined hash's own `as_of` in `scan_joins`, and the chip renders it, so the nightly-artifact and live-snapshot stories stay distinguishable in one response. This route remains the definition-DETAIL door (full receipt + hit list for a chosen session)."*
- `scan_store.join_clause` docstring: replace the "E-4's decision… E-2 is dark — no route, no writer, no caller" sentence with: *"E-4 (Wave 4) wired it: `query.build_where`'s scan branch and `scan_results._hit_tickers` are the two callers, both binding the fragment's params verbatim."*

- [ ] **Step 4: GREEN** — `python -m pytest tests/test_screener_wave4_query.py tests/test_screener_query.py tests/test_screener_scan_projection.py tests/test_scan_results_route.py tests/test_scan_store.py tests/test_scan_evaluator_off_request_path.py -v` — the off-request-path rail proves scan_store-in-query is legal; projection/pagination contracts untouched.

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/query.py api/routers/scan_results.py api/services/screener/scan_store.py tests/test_screener_wave4_query.py
git commit -m "screener: scans join the query as a disclosed filter — E4-A5 superseded by per-hash as-of receipts"
```

---

### Task 3: `filters.meta(user_id=…)` — the per-user `my_scans` category

**Files:**
- Modify: `api/services/screener/filters.py`
- Modify: `api/routers/screener.py:123-126` (pass the user id)
- Modify: `tests/test_scan_screener_auth.py:282` (the stub — deliberate, K4)
- Test: `tests/test_screener_wave4_meta.py` (new)

**Interfaces:**
- Produces: `meta(user_id=None)` — byte-identical output when `user_id is None`. When provided and ≥1 scannable definition exists: `filters` gains ONE entry `{key: "scan", label: "My Scans", category: "my_scans", type: "enum", presets: [{"label": "Any"}, {"label": <name>, "op": "in", "value": <def_hash>}...], allow_custom: False, unit: None, scans: [{"def_hash", "name", "latest": {as_of, evaluated, answered, dropped, not_computable, freshness} | None}...]}`, and `categories` gains `{"key": "my_scans", "label": "My Scans"}` appended LAST (K5: both sides or the rail drops it silently).
- Consumes: `user_definitions.list_for_user(user_id)` (rows carry `ast_hash` + `definition`), `scan_definition.assert_scannable`, `scan_store.latest_coverage_for` + `SCAN_JOIN_TF` (Task 1).

- [ ] **Step 1: failing tests** — `tests/test_screener_wave4_meta.py`:

```python
"""Wave 4: the per-user my_scans category. meta() with no user is UNCHANGED."""
import importlib

import pytest


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    from api.services.screener import snapshot_db, scan_store, filters
    importlib.reload(snapshot_db)
    importlib.reload(scan_store)
    scan_store.init_db()
    return filters, scan_store


H_BOOL = None   # filled by _defs
H_IND = None


def _defs(monkeypatch, filters, rows):
    from api.services import user_definitions as ud
    monkeypatch.setattr(ud, "list_for_user", lambda uid: rows)


def _row(name, ast_hash, scannable=True):
    # assert_scannable is stubbed per-test; the row shape mirrors
    # user_definitions.list_for_user (def_id, ast_hash, definition).
    return {"def_id": "u_" + name, "ast_hash": ast_hash,
            "definition": {"compute": {"kind": "ast", "fn": ast_hash,
                                       "ast": {"op": ">"} if scannable else {"n": 1}},
                           "meta": {"name": name}}}


@pytest.fixture()
def gate(monkeypatch):
    # Deterministic scannability: boolean iff the fixture said so. The REAL
    # gate is scan_definition.assert_scannable; this stub keeps the test
    # focused on meta()'s own contract (population, absence, batching).
    from api.services import scan_definition
    def fake(defn):
        if defn["compute"]["ast"].get("op") != ">":
            raise scan_definition.ScanRefused("[gate:yields] not boolean")
        return {"def_hash": defn["compute"]["fn"], "yields": "bool", "scalars": []}
    monkeypatch.setattr(scan_definition, "assert_scannable", fake)


H1 = "sha256:" + "a" * 64
H2 = "sha256:" + "b" * 64


def test_no_user_meta_is_byte_identical_to_before(env):
    filters, _ = env
    out = filters.meta()
    assert all(f["key"] != "scan" for f in out["filters"])
    assert all(c["key"] != "my_scans" for c in out["categories"])


def test_user_with_no_scannable_definitions_gets_no_category(env, monkeypatch, gate):
    filters, _ = env
    _defs(monkeypatch, filters, [_row("indicator", H1, scannable=False)])
    out = filters.meta(user_id="u1")
    assert all(f["key"] != "scan" for f in out["filters"])
    assert all(c["key"] != "my_scans" for c in out["categories"])


def test_scannable_definitions_populate_entry_category_and_latest(env, monkeypatch, gate):
    filters, scan_store = env
    scan_store.record_coverage(H1, "D", 20260820, evaluated=10, answered=8,
                               dropped=1, not_computable=1, dropped_symbols=[])
    _defs(monkeypatch, filters, [_row("Breakout base", H1),
                                 _row("Quiet pullback", H2)])
    out = filters.meta(user_id="u1")
    entry = next(f for f in out["filters"] if f["key"] == "scan")
    assert entry["category"] == "my_scans" and entry["type"] == "enum"
    assert entry["allow_custom"] is False
    labels = [p["label"] for p in entry["presets"]]
    assert labels[0] == "Any" and "Breakout base" in labels
    by_hash = {s["def_hash"]: s for s in entry["scans"]}
    assert by_hash[H1]["latest"]["as_of"] == 20260820
    assert by_hash[H1]["latest"]["answered"] == 8
    assert by_hash[H2]["latest"] is None          # first sweep tonight
    assert out["categories"][-1] == {"key": "my_scans", "label": "My Scans"}
    # K5's other half: the entry's category key IS in categories.
    assert any(c["key"] == "my_scans" for c in out["categories"])


def test_duplicate_names_disambiguated_by_hash_suffix(env, monkeypatch, gate):
    filters, _ = env
    _defs(monkeypatch, filters, [_row("Same name", H1), _row("Same name", H2)])
    entry = next(f for f in filters.meta(user_id="u1")["filters"]
                 if f["key"] == "scan")
    labels = [p["label"] for p in entry["presets"] if p["label"] != "Any"]
    assert len(set(labels)) == 2                  # FilterControl finds by label


def test_a_failing_definitions_read_degrades_to_no_category(env, monkeypatch, gate):
    filters, _ = env
    from api.services import user_definitions as ud
    monkeypatch.setattr(ud, "list_for_user",
                        lambda uid: (_ for _ in ()).throw(RuntimeError("db")))
    out = filters.meta(user_id="u1")
    assert all(f["key"] != "scan" for f in out["filters"])   # honest absence
```

- [ ] **Step 2: RED**, then **Step 3: implement** in `filters.py` (below `meta()`; lazy imports inside the helper keep filters.py's import graph clean of user stores at module load):

```python
def _my_scans_entry(user_id):
    """The per-user category content, or None (absence is honest: no
    scannable definitions == no category, never an empty shell).

    Gated by scan_definition.assert_scannable so a plain indicator (a
    non-boolean tree the sweep refuses nightly) NEVER appears — listed
    unscannable, it would read "first sweep tonight" forever. The stored
    ast_hash IS the def_hash (no re-hash); coverage is ONE batched read
    (meta() runs per request on the shared loop — no N+1).
    """
    from api.services import user_definitions as ud
    from api.services import scan_definition
    from api.services.screener import scan_store
    try:
        rows = ud.list_for_user(user_id) or []
    except Exception:
        return None
    scannable = []
    for row in rows:
        definition = row.get("definition") or {}
        try:
            scan_definition.assert_scannable(definition)
        except Exception:
            continue
        name = str(((definition.get("meta") or {}).get("name"))
                   or row.get("def_id") or "Untitled scan")
        scannable.append((str(row.get("ast_hash")), name))
    if not scannable:
        return None
    # FilterControl re-finds presets by LABEL — duplicates must diverge.
    # EVERY member of a duplicated name gets the short-hash suffix (suffixing
    # only the second would leave the first ambiguous in the select).
    counts = {}
    for _, name in scannable:
        counts[name] = counts.get(name, 0) + 1
    labeled = [(h, f"{name} · {h[7:13]}" if counts[name] > 1 else name)
               for h, name in scannable]
    latest = scan_store.latest_coverage_for(
        [h for h, _ in labeled], scan_store.SCAN_JOIN_TF)
    return {
        "key": "scan", "label": "My Scans", "category": "my_scans",
        "type": "enum", "allow_custom": False, "unit": None,
        "presets": [{"label": "Any"}] + [
            {"label": name, "op": "in", "value": h} for h, name in labeled],
        "scans": [{"def_hash": h, "name": name, "latest": latest.get(h)}
                  for h, name in labeled],
    }


def meta(user_id=None) -> dict:
    out_filters = []
    for key, f in FILTERS.items():
        presets = (_distinct_options(f["options_column"])
                   if f.get("options_column") else f["presets"])
        out_filters.append({"key": key, "label": f["label"],
                            "category": f["category"], "type": f["type"],
                            "presets": presets, "allow_custom": f["allow_custom"],
                            "unit": f["unit"]})
    categories = CATEGORIES
    if user_id is not None:
        entry = _my_scans_entry(user_id)
        if entry is not None:
            out_filters.append(entry)
            categories = CATEGORIES + [{"key": "my_scans", "label": "My Scans"}]
    return {"filters": out_filters,
            "views": [{"key": k, **v} for k, v in VIEWS.items()],
            "categories": categories}
```

(If the two-pass duplicate-suffix zip reads awkwardly, simplify to a single pass that suffixes EVERY member of a duplicated name — the test only pins distinctness. Keep `CATEGORIES` itself unmutated — a `+` copy, never `.append`.)

Router (`api/routers/screener.py:126`): `return scr_filters.meta(user_id=user["id"])`.
Stub (`tests/test_scan_screener_auth.py:282`): `monkeypatch.setattr(scr_filters, "meta", lambda user_id=None: dict(sentinel))` — K4's deliberate edit, this commit.

- [ ] **Step 4: GREEN** — `python -m pytest tests/test_screener_wave4_meta.py tests/test_screener_filters.py tests/test_scan_screener_auth.py -v` (route counts stay 12/16 — nothing new was mounted; `test_meta_shape` unchanged because no-arg meta is unchanged).

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/filters.py api/routers/screener.py tests/test_scan_screener_auth.py tests/test_screener_wave4_meta.py
git commit -m "screener: meta grows a per-user My Scans category — scannable definitions only, latest coverage batched"
```

---

### Task 4: the scan chip — name + as-of + coverage, "first sweep tonight"

**Files:**
- Modify: `app/src/pages/screener/chipLabel.js` (the `in` fallback case)
- Create: `app/src/pages/screener/ScanFilterChip.jsx`
- Modify: `app/src/pages/screener/FilterChips.jsx` (branch on `key === 'scan'`)
- Modify: `app/src/pages/screener/shell/FilterControl.jsx` (carry the preset label on scan specs)
- Modify: `app/src/pages/screener/shell/ScannerShell.jsx` (thread `scanJoins` + `onReplace`)
- Tests: `app/src/pages/screener/ScanFilterChip.test.jsx` (new), extend `chipLabel.test.js`, `FilterChips.test.jsx`

**Interfaces:**
- Consumes: the Task-3 meta entry (`meta.filters` row `key==='scan'`, its `scans` array) and the Task-2 `scan_joins` from the scan response.
- Produces: `ScanFilterChip({ scans, spec, scanJoins, onRemoveHash })` renders one chip per hash; `FilterChips` gains optional props `scanJoins` and `onReplace(key, nextSpecOrNull)`.
- The chip's ONE authority for counts is the meta entry's `latest`; `scanJoins` (per-request truth) only downgrades to "first sweep tonight" when `applied === false`.

- [ ] **Step 1: failing tests.** `ScanFilterChip.test.jsx` pins: (a) a hash with `latest` renders `"<name> — swept 2026-08-20 · 8/10 answered · 1 dropped"`; (b) `latest: null` renders `"<name> — first sweep tonight"`; (c) a hash ABSENT from `scans` falls back to `spec.label` then `'Saved scan'` (the shared-spec arrival case); (d) `scanJoins` entry `{def_hash, applied: false}` forces "first sweep tonight" even when meta carries a `latest`; (e) each chip's ✕ calls `onRemoveHash(hash)`; (f) two hashes render two chips. `chipLabel.test.js` gains: `chipLabel({label:'scan', presets:[]}, {op:'in', value:'sha256:…', label:'Breakout base'}) === 'Breakout base'` and without `label` returns `'scan'`. `FilterChips.test.jsx` gains: a `scan`-keyed active filter renders via ScanFilterChip (assert the swept-text, not chipLabel's output), and removing the LAST hash calls `onReplace('scan', null)` while removing one of two calls `onReplace('scan', {op:'in', value:[remaining], label:…})`.

- [ ] **Step 2: RED → implement.**

`chipLabel.js` — insert before `default:`:

```js
    // Fallback only (SharedScreen and any surface without the scan chip):
    // the filter object may carry the scan's name as `label`.
    case 'in': return spec.label || def.label
```

`ScanFilterChip.jsx`:

```jsx
import styles from './ScannerPro.module.css'

const day = v => {
  const d = String(v)
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d
}
const n = v => Number(v).toLocaleString('en-US')

// One chip per joined scan. Counts come from the meta entry's `latest` — the
// ONE authority (server-batched off scan_coverage). `scanJoins` is the
// per-request truth: applied:false downgrades to the inert label even if a
// stale meta still carries a latest. "First sweep tonight" covers never-swept
// AND withheld (indistinguishable at the store, by design — spec §4c).
export function scanChipText({ scans, spec, hash, scanJoins }) {
  const meta = (scans || []).find(s => s.def_hash === hash)
  const name = meta?.name || spec?.label || 'Saved scan'
  const join = (scanJoins || []).find(j => j.def_hash === hash)
  const inert = (join && join.applied === false) || !meta?.latest
  if (inert) return `${name} — first sweep tonight`
  const l = meta.latest
  return `${name} — swept ${day(l.as_of)} · ${n(l.answered)}/${n(l.evaluated)} answered · ${n(l.dropped)} dropped`
}

export default function ScanFilterChip({ scans, spec, scanJoins, onRemoveHash }) {
  const hashes = Array.isArray(spec?.value) ? spec.value : [spec?.value].filter(Boolean)
  return hashes.map(h => (
    <span key={h} className={styles.chip} data-testid={`scan-chip-${h.slice(7, 15)}`}>
      {scanChipText({ scans, spec, hash: h, scanJoins })}
      <button type="button" className={styles.chipX}
        aria-label="Remove scan filter" onClick={() => onRemoveHash(h)}>×</button>
    </span>
  ))
}
```

`FilterChips.jsx` — accept `scanJoins` and `onReplace`; in the map, branch:

```jsx
        key === 'scan' ? (
          <ScanFilterChip key={key} spec={spec} scanJoins={scanJoins}
            scans={(byKey.scan?.scans) || []}
            onRemoveHash={h => {
              const arr = (Array.isArray(spec.value) ? spec.value : [spec.value])
                .filter(x => x !== h)
              onReplace(key, arr.length ? { ...spec, value: arr } : null)
            }} />
        ) : (
          <span key={key} className={styles.chip}> ... unchanged ... </span>
        )
```

(`onReplace` defaults to `(k, v) => onRemove(k)`-compatible behavior: `onReplace = onReplace || ((k, v) => (v == null ? onRemove(k) : null))` is NOT acceptable — require the prop where the scan branch renders; ScannerShell passes `onReplace={(k, v) => s.setFilter(k, v)}` which handles both shapes since `setFilter(key, null)` deletes.)

`FilterControl.jsx` `onSelect` — after the `spec` object is built:

```js
    if (filter.key === 'scan' && p.label && p.label !== 'Any') spec.label = p.label
```

(The label rides into saved/shared specs; K9 — preset re-find compares only op/value/min/max, so the extra field is invisible to `currentLabel`.)

`ScannerShell.jsx` — pass `scanJoins={data?.scan_joins}` and `onReplace={(k, v) => s.setFilter(k, v)}` to the FilterChips mount (read the current mount around L115 first; `data` is the scan response the shell already holds).

- [ ] **Step 3: GREEN** — from `app/`: `npx vitest run src/pages/screener --pool=threads --execArgv=--no-warnings`.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/screener/chipLabel.js app/src/pages/screener/ScanFilterChip.jsx app/src/pages/screener/FilterChips.jsx app/src/pages/screener/shell/FilterControl.jsx app/src/pages/screener/shell/ScannerShell.jsx app/src/pages/screener/ScanFilterChip.test.jsx app/src/pages/screener/chipLabel.test.js app/src/pages/screener/FilterChips.test.jsx
git commit -m "screener: the scan chip — name, swept-as-of, coverage counts, first-sweep-tonight"
```

---

### Task 5: ScreensManager replaces SaveScreenBar (atomic swap, commit A of the cutover)

**Files:**
- Create: `app/src/pages/screener/ScreensManager.jsx`
- Create: `app/src/pages/screener/ScreensManager.test.jsx`
- Modify: `app/src/pages/screener/hooks/useSavedScreens.js` (fetcher throws — K7)
- Modify: `app/src/pages/screener/shell/ScannerShell.jsx` (the ONE `saveBar` JSX element, L110)
- Modify: `app/src/hooks/useUserDefinitions.js` (K3: `mutate('/api/screener/meta')` in `saveUserDefinition`/`deleteUserDefinition`)
- Modify: `app/src/pages/screener/screenSharing.mount.test.jsx` (driver + owner list + blocklist)
- Delete: `app/src/pages/screener/SaveScreenBar.jsx`, `app/src/pages/screener/SaveScreenBar.test.jsx`

**Interfaces:**
- Produces: `ScreensManager({ currentSpec, onApply, onUseScan })` — same trigger button `Screens ▾` (the mount rail's driver), same `data-testid={'share-panel-' + id}` share panel semantics, PLUS a type-badged "My scans" section listing scannable definitions with per-row **Use as filter**.
- `onUseScan(hash, name)` is wired by ScannerShell: `s.setFilter('scan', prev => …)` is NOT available (setFilter takes a value) — ScannerShell computes the union itself:

```jsx
saveBar={<ScreensManager currentSpec={s.baseSpec} onApply={s.applySpec}
  onUseScan={(hash, name) => {
    const cur = s.filters?.scan
    const have = cur ? (Array.isArray(cur.value) ? cur.value : [cur.value]) : []
    const value = have.includes(hash) ? have : [...have, hash]
    s.setFilter('scan', { op: 'in', value: value.length === 1 ? value[0] : value,
                          label: name })
  }} />}
```

(read useScreenSpec's actual exposed state name for the filters map first — if `s.filters` is not exposed, expose it from the hook in this task and note it; the hook already holds the map.)

- [ ] **Step 1: component + tests.** ScreensManager structure (popover on the existing `saveMenuWrap/saveBtn/saveMenuPop` classes from `ScannerPro.module.css` — the style owner survives):
  - Trigger `Screens ▾`; outside-click close (copy SaveScreenBar's `wrapRef` mousedown pattern verbatim).
  - **Starters** section: apply-only rows (from `useSavedScreens().starters`).
  - **My screens** section (type badge `SCREEN`): apply / Share (the moved share panel, verbatim behavior: publish `update(id, {is_public: true})`, copy `sharedScreenUrl(s.share_token)`, unpublish; `data-testid={'share-panel-' + s.id}`) / rename ✎ / delete ✕ — all via `useSavedScreens()`.
  - **My scans** section (type badge `SCAN`): rows from `useUserDefinitions()` filtered by `scannableScreens` (import from `../../components/screener/SavedScreensPanel` in THIS task; Task 6 moves the import to `scanSession.js`) — per-row **Use as filter** button calling `onUseScan(row.ast_hash, name)` (name via the same `meta.name → def_id → 'Untitled screen'` fallback), and a **Details** affordance that Task 6 fills (render the button disabled with title "detail arrives with the manager's next commit" is NOT acceptable — omit it entirely until Task 6).
  - **Save current** footer: verbatim `create(name, currentSpec)`.
  - **Error ≠ empty:** `useSavedScreens` gains `error` (throwing fetcher) and the manager renders `data-testid="screens-manager-error"` (role=alert) distinct from the empty states; `useUserDefinitions`' error renders the same way for its section.
  `ScreensManager.test.jsx` (mocks both hooks — the mount rail records that pattern): starter apply · save-current calls `create` · both sections type-badged · share panel publish/unpublish payloads · rename/delete fan-out · use-as-filter calls `onUseScan` with `(hash, name)` · 402 → error testid, never "None saved yet".

- [ ] **Step 2: `useSavedScreens` fetcher (K7):**

```js
const fetcher = async url => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`saved-screens ${r.status}`)
  return r.json()
}
```

and return `error` from the hook (`const { data, error, mutate } = useSWR(...)` → spread into the return object).

- [ ] **Step 3: K3 wires** in `useUserDefinitions.js`: inside `saveUserDefinition` and `deleteUserDefinition`, after their own store mutation succeeds, `mutate('/api/screener/meta')` (import `{ mutate }` from `'swr'`). Every door — BuilderSheet included — now revalidates the rail's category. The manager's own saved-screens CRUD needs no meta mutate (screen specs are not meta content).

- [ ] **Step 4: the swap + deletions + rail move, ONE commit.** ScannerShell L110 mounts ScreensManager; delete `SaveScreenBar.jsx` + `SaveScreenBar.test.jsx`. Update `screenSharing.mount.test.jsx`: owner-file list `[SaveScreenBar.jsx → ScreensManager.jsx, shell/ScannerShell.jsx, pages/Screener.jsx]` (K6 — literal path reads); ON_THE_CHAIN mock blocklist swaps `SaveScreenBar → ScreensManager` (keep `useSavedScreens`, `screenShareLink`); driver steps unchanged (`Screens ▾` → `Share <name>` — preserve those accessible names in the manager); the note about `SaveScreenBar.test.jsx` mocking the hook re-targets `ScreensManager.test.jsx`.

- [ ] **Step 5: GREEN** — from `app/`: `npx vitest run src/pages/screener src/components/screener --pool=threads --execArgv=--no-warnings` — `reachable.test.js` green (no orphan: SaveScreenBar gone, manager wired), `screenSharing.mount` green through the manager, `Screener.scanmount` untouched-green (formulas tab still alive).

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/screener/ScreensManager.jsx app/src/pages/screener/ScreensManager.test.jsx app/src/pages/screener/hooks/useSavedScreens.js app/src/pages/screener/shell/ScannerShell.jsx app/src/hooks/useUserDefinitions.js app/src/pages/screener/screenSharing.mount.test.jsx
git rm app/src/pages/screener/SaveScreenBar.jsx app/src/pages/screener/SaveScreenBar.test.jsx
git commit -m "screener: one screens manager — specs and scans type-badged, share flow moved intact, refused reads refuse"
```

---

### Task 6: definition detail in the manager + `scanSession.js`

**Files:**
- Create: `app/src/components/screener/scanSession.js`
- Modify: `app/src/components/screener/SavedScreensPanel.jsx` (import + re-export from scanSession — keeps the scanmount rail's import source valid until Task 7)
- Modify: `app/src/pages/screener/ScreensManager.jsx` (+ its test)

**Interfaces:**
- `scanSession.js` exports MOVED VERBATIM from SavedScreensPanel: `SESSION_TZ`, `SCAN_TF`, `defaultSession(now)`, `scannableScreens(rows)` (bodies byte-identical; SavedScreensPanel re-exports them: `export { SESSION_TZ, SCAN_TF, defaultSession, scannableScreens } from './scanSession'`).
- Manager detail: selecting a My-scans row expands `<ScanResults definition={row.definition} asOf={session} tf={SCAN_TF} />` beneath it, with the session `<input type="date">` seeded `defaultSession()` — the panel's control, verbatim. ⛔ The manager must import `ScanResults` and must NOT import `CoverageLine` directly — `reachable.test.js`'s planted-cut control (Task 7 re-points it here) asserts CoverageLine is reachable only THROUGH ScanResults.

- [ ] **Step 1: failing test** — extend `ScreensManager.test.jsx`: clicking a scan row's name mounts ScanResults (mock it at the manager-test level and assert props `{definition, asOf: defaultSession(), tf: 'D'}`; the REAL wire is the scanmount rail's job after Task 7); the date input changes `asOf`.
- [ ] **Step 2: create `scanSession.js`** (verbatim bodies from SavedScreensPanel.jsx:64-94 including their comments), re-export from the panel, re-point the manager's `scannableScreens` import to `../../components/screener/scanSession`.
- [ ] **Step 3: GREEN** — same vitest sweep as Task 5 (scanmount still green: the panel's exports still resolve).
- [ ] **Step 4: Commit**

```bash
git add app/src/components/screener/scanSession.js app/src/components/screener/SavedScreensPanel.jsx app/src/pages/screener/ScreensManager.jsx app/src/pages/screener/ScreensManager.test.jsx
git commit -m "screener: definition detail lives in the manager — session vocabulary gets one home"
```

---

### Task 7: My Formulas retires (atomic cutover, commit B)

**Files:**
- Modify: `app/src/pages/Screener.jsx` (PAGE_TABS loses `formulas`; the L487-494 branch goes; the deliberate before-the-candidates-gate comment moves to the manager's mount context note in ScannerShell — the manager is inside ScannerShell which mounts before the candidates gate by construction; verify and state it)
- Delete: `app/src/components/screener/SavedScreensPanel.jsx` (+ `SavedScreensPanel.module.css` IFF importer-grep proves the manager/detail took none of its classes — check first)
- Modify: `app/src/pages/Screener.scanmount.test.jsx`, `app/src/components/screener/reachable.test.js`

**The rail moves (K6 — every literal anchor, this commit):**
- scanmount: the door becomes `Screens ▾` → the My-scans row (update the click helper at L185); imports move — `SCAN_TF, scannableScreens` from `components/screener/scanSession`, `RESULTS_ENDPOINT` unchanged from ScanResults; the coverage-line ownership file list (L413-419) becomes `[CoverageLine.jsx, ScanResults.jsx, pages/screener/ScreensManager.jsx, pages/Screener.jsx]`; the mock blocklist regex (L404) gains `ScreensManager|scanSession`; cases 3/10/11 re-target the manager's rows/empty/error; the RECEIPT assertions (four counts, withheld-beside, nodata, not-run, the issued-GET assertion) carry VERBATIM. The `vi.mock` of ScannerShell (L59-65) must GO — the manager lives inside ScannerShell now, so the rail renders the real shell (mock only ChartPane and heavy leaf hooks; if shell data hooks fetch, stub fetch per-URL as the file already does).
- reachable: the planted-cut anchor (L398-420) re-points to ScreensManager's literal `import ScanResults from '../../components/screener/ScanResults'\n` line; its (b) assertion (cutting it orphans ScanResults AND CoverageLine) holds because the manager never imports CoverageLine directly (Task 6's constraint).
- [ ] **Step 1:** make the edits; run the full frontend suite from `app/` — reachable green (SavedScreensPanel deleted, nothing orphaned), scanmount's 12 re-targeted cases green, everything else untouched.
- [ ] **Step 2: Commit**

```bash
git add app/src/pages/Screener.jsx app/src/pages/Screener.scanmount.test.jsx app/src/components/screener/reachable.test.js
git rm app/src/components/screener/SavedScreensPanel.jsx
git commit -m "screener: My Formulas tab retires — the manager owns the door, the rails moved with the mounts"
```

(add `git rm` for the module.css only if the importer-grep said so.)

---

### Task 8: verification — suites, build, read-only smoke

**Files:**
- Create: `tools/screener_wave4_smoke.py`

- [ ] **Step 1:** `tools/screener_wave4_smoke.py` — READ-ONLY against a tmp `SCREENER_DB_PATH`: seed 3 `screener_rows` + two swept sessions for one hash + zero for another (mirror the Task-2 fixture), call `query.run_scan` for the four states (single hash, two-hash AND, never-swept disclosed, refused empty value), print each response's `rows`/`total`/`scan_joins`, then call `filters.meta(user_id=...)` with `user_definitions.list_for_user` monkeypatched to two definitions and print the my_scans entry. Exit non-zero on any deviation. Run it; paste output in the report.
- [ ] **Step 2:** backend: `python -m pytest tests/test_screener_wave4_store.py tests/test_screener_wave4_query.py tests/test_screener_wave4_meta.py tests/test_scan_store.py tests/test_screener_query.py tests/test_screener_scan_projection.py tests/test_screener_filters.py tests/test_scan_results_route.py tests/test_scan_screener_auth.py tests/test_scan_evaluator_off_request_path.py tests/test_entitlements.py tests/test_user_definitions.py -v` — all green.
- [ ] **Step 3:** frontend from `app/`: `npx vitest run --pool=threads --execArgv=--no-warnings` (3 pre-existing reds only) then `npm run build`.
- [ ] **Step 4: Commit** — `git add tools/screener_wave4_smoke.py` → `"screener: wave-4 read-only smoke (four join states + the per-user category)"`.

---

### Task 9: ship gate — CONTROLLER-HELD

Not an implementer task. Controller: interactive browser pass on a local run (rail category renders · picker applies · chip states incl. first-sweep-tonight · manager sections/share/detail · shared-spec arrival shows the scan name), then push after-hours, deploy-verify by artifact (served chunk content), and next-morning receipt check: the 05:00 sweep's first my_scans-visible receipts + a real member-path join. No Railway flag changes (SCAN_SWEEP_ENABLED already =1; nothing new is env-gated).

## Parallelism map

- T1 alone → then T2 ∥ T3 (disjoint: query.py/scan_results.py vs filters.py/routers/screener.py/auth-test).
- T4 after T2+T3 shapes exist (its tests mock them; dispatchable in parallel with T3 if briefs carry the shapes — controller's call).
- T5 after T4 (ScannerShell is edited by both — serialize on that file).
- T6 after T5 → T7 after T6 → T8 after T7. T9 last.

## Self-review notes (author)

- Spec §4.1 covered by T1-T4; §4.2 by T5-T7; §4.3 stays deferred (recorded, standing). Freshness disclosure (§4c) is triple-covered: meta `latest`, response `scan_joins`, chip text.
- Placeholder scan: none. Two adapt-to-reality escape hatches are explicit (the T2 fixture INSERT; `s.filters` exposure in T5).
- Type consistency: `as_of` is the store's int YYYYMMDD everywhere server-side; the chip formats for display only. `value` scalar-or-array is normalized server-side in exactly one place (`_scan_clauses`); presets always scalar (K9).
