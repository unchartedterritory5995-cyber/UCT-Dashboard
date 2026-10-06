"""OWNER DECISION A (2026-10-06) — the four downstream consumers are semantics-aware.

P0 stamps ``meta.semantics: 2`` on new native saves and maths edits. The chart and
the alert lane already evaluate such a document under semantics 2; the nightly
screener sweep, the screener filter ("My Scans" + definition results), the
backtest-by-definition and the forward record evaluated it under semantics 1 and
filed its results under the bare tree hash — shared across members, so a
semantics-1 answer could be served as a semantics-2 one.

After: ONE identity rule (``user_definitions.result_identity`` = tree hash, ``~s2``
for semantics 2; semantics 1 byte-identical to the old key) and ONE evaluation
door (``ast_interpret.lane_opts_for`` / ``semantics_opts_for``), used by every
consumer. Each case: ASKED / CLAIMED / DID.

The two divergent trees make an unknown out of the DATA (a bar with volume 0
turns ``close / (volume / volume)`` into 0/0 on exactly that bar), so the hole
sits on the bar we choose whatever window a consumer reads:
  UNK  ``!(close > hole)``        sem1: compare-vs-unknown = 0, negated -> 1 (a HIT)
                                   sem2: unknown propagates -> NOT COMPUTABLE
  WIL  ``rsi(hole, 14) > 0``      sem1: RSI restarts after the hole -> unknown -> 0
                                   sem2: RSI HOLDS across it -> finite -> 1 (a HIT)
"""
from __future__ import annotations

import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services import ast_interpret, definition_record, scan_definition
from api.services import user_definitions as ud
from api.services.screener import filters, scan_evaluator, scan_store
from api.services.screener import backtest as engine

import tests.test_scan_evaluator as T
from tests.test_scan_evaluator import bars, clock, store  # noqa: F401  (fixtures)

S = lambda n: {"type": "series", "name": n}            # noqa: E731
N = lambda v: {"type": "num", "value": v}              # noqa: E731
OP = lambda n, *a: {"type": "op", "name": n, "args": list(a)}     # noqa: E731
CALL = lambda n, *a: {"type": "call", "name": n, "args": list(a)}  # noqa: E731

HOLE = OP("/", S("close"), OP("/", S("volume"), S("volume")))
UNK = OP("!", OP(">", S("close"), HOLE))
WIL = OP(">", CALL("rsi", HOLE, N(14)), N(0))
SYMS = ["AAA", "BBB"]

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = json.load(open(os.path.join(HERE, "fixtures", "ast", "semantics_result_identity.json"),
                         encoding="utf-8"))


def doc(tree, semantics=None, *, pine=False, def_id="u_000000000001"):
    d = T._definition(tree, def_id=def_id)
    if semantics is not None:
        d["meta"]["semantics"] = semantics
    if pine:
        d["meta"]["recurrenceOrigin"] = "pine"
    return d


def rows_with_holes(holes, n=60):
    """Daily store tuples with a WAVY close (RSI is neither 0 nor 100) and
    volume 0 on the bars in ``holes`` — the data-made unknowns."""
    out = []
    for i, (k, o, h, l, c, v) in enumerate(T._daily_bars(n=n)):
        out.append((k, o, h, l, c + (i % 3) * 0.5 - (i % 5) * 0.7, 0 if i in holes else v))
    return out


def as_dicts(rows):
    return [{"t": k, "o": o, "h": h, "l": l, "c": c, "v": v} for k, o, h, l, c, v in rows]


def canonical_last(tree, rows, definition):
    """The SERVER'S CANONICAL EVALUATOR on the same bars under the document's own
    lane opts — the reference every consumer must agree with. (The browser lane
    equals it on the P0 shared fixtures: ``p0.sem.gaps.json``.)"""
    v = ast_interpret.interpret(tree, as_dicts(rows),
                                opts=ast_interpret.lane_opts_for(definition))[-1]
    return None if v is None or v != v else v


def outcome(v):
    return "nc" if v is None else ("hit" if v else "no")


@pytest.fixture
def two_universes(store, bars, clock):  # noqa: F811
    T._snapshot({s: {"market_cap": 2e9} for s in SYMS})
    bars["AAA"] = rows_with_holes({59})        # the hole ON the evaluated (last) bar
    bars["BBB"] = rows_with_holes({57})        # the hole two bars back
    return bars


# ═══ identity ════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_result_identity_server_equals_the_shared_fixture(case):
    """#3 / #21 / #22 — ASKED the identity of each fixture document · CLAIMED
    bare for semantics 1 and every forgery (Pine-with-2, "2", true, 3), ~s2 only
    for the store's stamp · DID: equal to the fixture the browser lane asserts."""
    assert ud.result_identity(case["definition"]) == case["expect"]


def test_same_formula_two_semantics_two_identities_and_legacy_keys_are_unchanged():
    """#3 / #10 — same tree, different semantics -> distinct identities; the
    semantics-1 identity IS the pre-existing key (no migration)."""
    one, two = doc(UNK), doc(UNK, 2)
    assert ud.result_identity(one) == ud.ast_hash(UNK) == one["compute"]["fn"]
    assert ud.result_identity(two) == ud.ast_hash(UNK) + "~s2"
    assert scan_definition.assert_scannable(one)["def_hash"] == ud.result_identity(one)
    assert scan_definition.assert_scannable(two)["def_hash"] == ud.result_identity(two)
    assert ud.RESULT_IDENTITY_RE.match(ud.result_identity(two))
    assert definition_record._HASH_RE is ud.RESULT_IDENTITY_RE


# ═══ A. the nightly sweep ════════════════════════════════════════════════════

@pytest.mark.parametrize("tree,name", [(UNK, "UNKNOWN"), (WIL, "WILDER")])
def test_sweep_evaluates_each_definition_under_its_OWN_semantics(two_universes, tree, name):
    """#4 #5 #12 #13 #14 #15 #16 — ASKED the real nightly `evaluate_one` for a
    semantics-1 and a semantics-2 definition of the SAME tree · CLAIMED each
    symbol's outcome equals the canonical evaluator under that document's
    semantics, and the two differ where P0 says they do · DID."""
    got = {}
    for sem in (None, 2):
        d = doc(tree, sem)
        r = scan_evaluator.evaluate_one(d, T.TF, universe=SYMS, as_of=T.SESSION)
        assert r["def_hash"] == ud.result_identity(d)
        for s in SYMS:
            want = outcome(canonical_last(tree, two_universes[s], d))
            have = "hit" if s in r["hits"] else ("nc" if want == "nc" else "no")
            assert have == want, (name, sem, s)
        assert r["not_computable"] == sum(outcome(canonical_last(tree, two_universes[s], d)) == "nc"
                                          for s in SYMS)
        got[sem] = sorted(r["hits"])
    if name == "UNKNOWN":
        assert got == {None: ["AAA", "BBB"], 2: ["BBB"]}   # AAA: 1 under sem1, unknown under sem2
    else:
        assert got == {None: [], 2: ["BBB"]}               # BBB: RSI restarts vs HOLDS


def test_sweep_results_never_cross_semantics_either_way(two_universes):
    """#17 #18 — ASKED: sweep semantics 1 first, read the semantics-2 key; then
    sweep semantics 2, re-read semantics 1 · CLAIMED neither satisfies nor
    overwrites the other · DID."""
    one, two = doc(UNK), doc(UNK, 2)
    k1, k2 = ud.result_identity(one), ud.result_identity(two)
    scan_evaluator.evaluate_one(one, T.TF, universe=SYMS, as_of=T.SESSION)
    assert sorted(scan_store.hits(k1, T.TF, T.SESSION)) == ["AAA", "BBB"]
    assert scan_store.hits(k2, T.TF, T.SESSION) == []
    assert scan_store.coverage(k2, T.TF, T.SESSION) is None       # sem2 never served sem1
    scan_evaluator.evaluate_one(two, T.TF, universe=SYMS, as_of=T.SESSION)
    assert sorted(scan_store.hits(k2, T.TF, T.SESSION)) == ["BBB"]
    assert sorted(scan_store.hits(k1, T.TF, T.SESSION)) == ["AAA", "BBB"]   # untouched
    assert scan_store.coverage(k1, T.TF, T.SESSION)["not_computable"] == 0
    assert scan_store.coverage(k2, T.TF, T.SESSION)["not_computable"] == 1


def test_the_sweep_dedupes_by_maths_AND_semantics(monkeypatch):
    """A — two members' rows with the SAME `ast_hash` and different semantics are
    two sweeps (deduping by tree alone ran only whichever came first)."""
    one, two = doc(UNK), doc(UNK, 2, def_id="u_000000000002")
    rows = [{"def_id": d["id"], "version": 1, "ast_hash": ud.ast_hash(UNK), "definition": d,
             "requirements": []} for d in (one, two, doc(UNK))]
    monkeypatch.setattr(ud, "live_definitions", lambda: rows)
    out = scan_evaluator.definitions_to_sweep()
    assert [ud.result_identity(d) for d in out] == [ud.result_identity(one), ud.result_identity(two)]


def test_a_pine_document_carrying_2_is_swept_under_PINE_semantics(two_universes):
    """#22 — Pine keeps Pine semantics: a forged stamp does not move its key or
    its evaluation."""
    pine = doc(UNK, 2, pine=True)
    r = scan_evaluator.evaluate_one(pine, T.TF, universe=SYMS, as_of=T.SESSION)
    assert r["def_hash"] == ud.ast_hash(UNK)
    assert sorted(r["hits"]) == ["AAA", "BBB"]               # the semantics-1 answer


def test_an_unsupplied_secondary_symbol_is_not_computable_under_both_semantics(two_universes):
    """#24 — a `sym('ZZZ', close)` the store cannot supply is NOT COMPUTABLE (or
    refused) identically under both semantics: no fake number, no fallback to the
    base bars, no change of semantics."""
    tree = OP(">", {"type": "sym", "value": "ZZZ", "args": [S("close")]}, N(0))
    outs = []
    for sem in (None, 2):
        try:
            r = scan_evaluator.evaluate_one(doc(tree, sem), T.TF, universe=SYMS, as_of=T.SESSION)
            outs.append(("ran", r["hits"], r["answered"]))
        except scan_evaluator.ScanRunRefused as exc:
            outs.append(("refused", exc.gate))
    assert outs[0] == outs[1]
    assert outs[0][0] == "refused" or outs[0][1] == []


# ═══ B. the screener filter ══════════════════════════════════════════════════

def test_my_scans_offers_each_definition_under_its_result_identity(two_universes, monkeypatch):
    """#6 #7 — ASKED My Scans for a member holding the same formula twice
    (semantics 1 and 2, same name) · CLAIMED two presets, each keyed by its own
    result identity, unique labels, and each reads its own sweep receipt · DID."""
    one, two = doc(UNK), doc(UNK, 2, def_id="u_000000000002")
    for d in (one, two):
        scan_evaluator.evaluate_one(d, T.TF, universe=SYMS, as_of=T.SESSION)
    rows = [{"def_id": d["id"], "ast_hash": ud.ast_hash(UNK), "definition": d} for d in (one, two)]
    monkeypatch.setattr(ud, "list_for_user", lambda uid: rows)
    entry = filters._my_scans_entry("member-1")
    values = [p["value"] for p in entry["presets"] if "value" in p]
    assert values == [ud.result_identity(one), ud.result_identity(two)]
    labels = [p["label"] for p in entry["presets"]]
    assert len(labels) == len(set(labels))
    for scan in entry["scans"]:
        # the filter's read path (`definition-results` -> `scan_store`) by the offered key
        hits = sorted(scan_store.hits(scan["def_hash"], T.TF, T.SESSION))
        assert hits == (["AAA", "BBB"] if scan["def_hash"] == ud.result_identity(one) else ["BBB"])
        assert scan["latest"] is not None


# ═══ C. backtest by definition id ════════════════════════════════════════════

def _bt_rows(holes, n=200):
    import datetime
    d0 = datetime.date(2024, 1, 2)
    out = []
    for i in range(n):
        d = d0 + datetime.timedelta(days=i)
        px = 10.0 + i + (i % 3) * 0.5 - (i % 5) * 0.7
        out.append((d.year * 10_000 + d.month * 100 + d.day, px, px + 1.0, px - 1.0, px,
                    0.0 if i in holes else 1000.0))
    return out


def _bt_client(monkeypatch, stored_doc):
    from api.routers import screener_backtest as bt
    from api.services import bars_sqlite
    from api.services.screener import snapshot_builder
    row = {"def_id": stored_doc["id"], "version": 1, "rev": 1,
           "ast_hash": ud.ast_hash(stored_doc["compute"]["ast"]), "definition": stored_doc}
    monkeypatch.setattr(ud, "get", lambda user_id, def_id, version=None:
                        dict(row) if def_id == row["def_id"] else None)
    monkeypatch.setattr(snapshot_builder, "_load_universe", lambda: ["AAA"])
    rows = _bt_rows(set(range(20, 200, 7)))
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda sym, tf, want, to_key: list(rows)[:want])
    app = FastAPI()
    app.include_router(bt.router)
    user = {"id": "paid1", "email": "p@x", "role": "user", "plan": "pro"}
    app.dependency_overrides[get_current_user] = lambda: dict(user)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app), rows


@pytest.fixture
def _clean_receipts():
    from api.routers import screener_backtest as bt
    from api.services.cache import cache
    cache.delete_prefix("screen_backtest::")
    yield
    cache.delete_prefix("screen_backtest::")
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.clear()


WINDOW = {"from": "2024-02-01", "to": "2024-07-01", "universe": "current", "horizons": [5]}


def test_backtest_by_def_id_runs_under_the_stored_semantics_and_keys_by_it(monkeypatch, _clean_receipts):
    """#8 #9 #17 #18 #20 — ASKED POST /api/screener/backtest {def_id} for the SAME
    tree stored as semantics 1, then as semantics 2 · CLAIMED different job ids
    (the shared receipt cache cannot cross), the receipt carries the result
    identity, and the signal counts are the canonical evaluator's under each
    semantics · DID."""
    seen = {}
    for sem in (None, 2):
        d = doc(UNK, sem)
        client, rows = _bt_client(monkeypatch, d)
        r = client.post("/api/screener/backtest", json={"def_id": d["id"], **WINDOW})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["def_hash"] == ud.result_identity(d)
        assert "_semantics" not in json.dumps(body)              # private key never echoed
        seen[sem] = body
    assert seen[None]["job"] != seen[2]["job"]
    # semantics 1 holes are TRUE, semantics 2 holes are unknown: sem1 has MORE signals
    assert seen[None]["signals"] > seen[2]["signals"]


def test_backtest_job_id_semantics_1_is_byte_identical_to_the_legacy_id():
    """#23 (cache migration) — every semantics-1 receipt already cached keeps its id."""
    from api.routers import screener_backtest as bt
    import hashlib
    legacy = hashlib.sha256(json.dumps(
        {"ast": UNK, "symbols": ["AAA"], "tf": "D", "from": 1, "to": 2, "horizons": [5]},
        sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()[:24]
    assert bt.job_id(UNK, ["AAA"], "D", 1, 2, [5]) == legacy
    assert bt.job_id(UNK, ["AAA"], "D", 1, 2, [5], semantics=2) != legacy


def test_a_posted_ast_is_semantics_1_whatever_it_claims(monkeypatch, _clean_receipts):
    """#21 — a hand-posted tree has no stored document; a client cannot opt it
    into semantics 2. Its receipt is keyed and evaluated as semantics 1."""
    client, _ = _bt_client(monkeypatch, doc(UNK))
    r = client.post("/api/screener/backtest", json={"ast": UNK, "semantics": 2, **WINDOW})
    if r.status_code == 200:
        assert r.json()["def_hash"] == ud.ast_hash(UNK)
    else:
        assert r.status_code in (400, 422)                     # an unknown field refused


def test_backtest_engine_signals_equal_the_canonical_evaluator_per_semantics():
    """#13 #15 — the engine under each semantics' opts against the canonical
    column: the semantics-1 minus semantics-2 signal difference is EXACTLY the
    in-window bars that are true under 1 and unknown under 2."""
    rows = _bt_rows(set(range(20, 200, 7)))
    bars_d = [{"t": f"{k // 10000:04d}-{k // 100 % 100:02d}-{k % 100:02d}", "o": o, "h": h, "l": l,
               "c": c, "v": v} for k, o, h, l, c, v in rows]
    r1 = engine.run_backtest(UNK, ["AAA"], "2024-03-01", "2024-06-01",
                             bars_for=lambda s: bars_d, horizons=(5,), min_signals=1)
    r2 = engine.run_backtest(UNK, ["AAA"], "2024-03-01", "2024-06-01",
                             bars_for=lambda s: bars_d, horizons=(5,), min_signals=1,
                             opts={"semantics": 2})
    c1 = ast_interpret.interpret(UNK, bars_d)
    c2 = ast_interpret.interpret(UNK, bars_d, opts={"semantics": 2})
    flipped = [i for i, b in enumerate(bars_d) if "2024-03-01" <= b["t"] <= "2024-06-01"
               and c1[i] == 1.0 and (c2[i] is None or c2[i] != c2[i])]
    assert flipped, "the fixture must exercise the divergence"
    assert r1.signals - r2.signals == len(flipped)
    w1 = engine.run_backtest(WIL, ["AAA"], "2024-03-01", "2024-06-01",
                             bars_for=lambda s: bars_d, horizons=(5,), min_signals=1)
    w2 = engine.run_backtest(WIL, ["AAA"], "2024-03-01", "2024-06-01",
                             bars_for=lambda s: bars_d, horizons=(5,), min_signals=1,
                             opts={"semantics": 2})
    assert w2.signals > w1.signals                             # RSI holds across each hole


def test_a_current_only_scalar_still_refuses_historical_backtest_under_semantics_2():
    """#23 — current-only scalars are refused for a history consumer regardless of semantics."""
    rows = _bt_rows(set())
    bars_d = [{"t": f"{k // 10000:04d}-{k // 100 % 100:02d}-{k % 100:02d}", "o": o, "h": h, "l": l,
               "c": c, "v": v} for k, o, h, l, c, v in rows]
    tree = OP(">", S("rs_rank"), N(80))
    for opts in (None, {"semantics": 2}):
        r = engine.run_backtest(tree, ["AAA"], "2024-03-01", "2024-06-01",
                                bars_for=lambda s: bars_d, opts=opts)
        assert r.backtestable is False and r.refused == "scalar_no_history"


# ═══ D. the forward record ═══════════════════════════════════════════════════

def test_forward_record_rows_are_filed_per_semantics_and_never_merge(two_universes):
    """#10 #11 #19 — ASKED the sweep to record both semantics of one tree ·
    CLAIMED two separate record keys, each with its own truth · DID."""
    one, two = doc(UNK), doc(UNK, 2)
    for d in (one, two):
        scan_evaluator.evaluate_one(d, T.TF, universe=SYMS, as_of=T.SESSION)
    k1, k2 = ud.result_identity(one), ud.result_identity(two)
    # AAA: true under semantics 1; under semantics 2 its bar is UNKNOWN, and an
    # unknown is not an evaluation — nothing is recorded (no fake zero, and
    # certainly not the semantics-1 "true")
    a1 = T._record_rows(k1, 1, T.TF_LABEL, "AAA")
    assert [(r["def_hash"], r["bars_evaluated"], r["bars_true"]) for r in a1] == [(k1, 1, 1)]
    assert T._record_rows(k2, 1, T.TF_LABEL, "AAA") == []
    # BBB: evaluated under both — two rows, two keys, never merged
    b1 = T._record_rows(k1, 1, T.TF_LABEL, "BBB")
    b2 = T._record_rows(k2, 1, T.TF_LABEL, "BBB")
    assert [r["def_hash"] for r in b1] == [k1] and [r["def_hash"] for r in b2] == [k2]


def test_editing_maths_into_semantics_2_starts_a_fresh_record_and_keeps_the_old_one(two_universes):
    """#20 — a legacy record exists; a maths edit (store-stamped semantics 2) is a
    new identity: its record starts empty, the legacy rows are untouched."""
    legacy = doc(UNK)
    scan_evaluator.evaluate_one(legacy, T.TF, universe=SYMS, as_of=T.SESSION)
    before = T._record_row_count(ud.result_identity(legacy), 1)
    edited_tree = OP("!", OP(">", S("close"), OP("*", HOLE, N(1.0001))))
    edited = doc(edited_tree, 2)
    assert ud.result_identity(edited) != ud.result_identity(legacy)
    assert T._record_row_count(ud.result_identity(edited), 1) == 0
    scan_evaluator.evaluate_one(edited, T.TF, universe=SYMS, as_of=T.SESSION)
    assert T._record_row_count(ud.result_identity(legacy), 1) == before


def test_the_record_route_reads_the_STORED_documents_semantics(two_universes, monkeypatch):
    """#11 #19 — ASKED GET /api/scans/definition-record for a semantics-2 stored
    definition when only the semantics-1 record of the same tree exists ·
    CLAIMED the route keys by the result identity and serves nothing from the
    semantics-1 record · DID; and for the semantics-1 definition it reads its own."""
    from api.routers import definition_record as route
    one = doc(UNK)
    scan_evaluator.evaluate_one(one, T.TF, universe=SYMS, as_of=T.SESSION)
    out = {}
    for sem in (None, 2):
        d = doc(UNK, sem)
        row = {"def_id": d["id"], "version": 1, "rev": 1, "definition": d}
        monkeypatch.setattr(ud, "get", lambda user_id, def_id, version=None, _r=row: dict(_r))
        app = FastAPI()
        app.include_router(route.router)
        user = {"id": "paid1", "email": "p@x", "role": "user", "plan": "pro"}
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        r = TestClient(app).get("/api/scans/definition-record",
                                params={"def_id": d["id"], "tf": "D"})
        assert r.status_code == 200, r.text
        out[sem] = r.json()
    assert out[None]["def_hash"] == ud.result_identity(one)
    assert out[2]["def_hash"] == ud.result_identity(doc(UNK, 2))
    assert out[None]["window"] is not None                     # its own record exists
    assert out[2]["window"] is None                            # nothing borrowed from sem1


def test_the_store_discards_a_forged_semantics_on_a_presentation_edit(monkeypatch):
    """#21 — server authority: a client-sent `meta.semantics: 2` on a legacy row's
    presentation edit is discarded; its result identity stays semantics 1."""
    d = doc(UNK)
    decided = ud.decide_semantics({**d, "meta": {**d["meta"], "semantics": 2}}, d, maths_moved=False)
    assert decided is None
    assert ud.result_identity(d) == ud.ast_hash(UNK)
