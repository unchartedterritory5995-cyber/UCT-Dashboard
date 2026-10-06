"""P0G TRUTH CORPUS -- slice "sem": owner decisions A (unknown comparisons) and
C (Wilder functions across gaps), SERVER lane.

Twin of ``app/src/components/chart/engine/__truth__/p0.sem.truth.test.js``. Both
read ``p0.sem.gaps.json``, whose ``expect`` block is the browser lane's output
frozen at generation: this file reproduces every column at 1e-9, which is the
proof that the two lanes are identical on the gap semantics.

Each case names ASKED / CLAIMED / DID and an outcome class. "BEFORE" is the
engine at base ``7bd868f34``.

THE MECHANISM: one definition-semantics version, ``meta.semantics: 2``, stamped
by ``user_definitions.save`` (``decide_semantics``) on NEW native maths only,
read by ``ast_interpret.semantics_opts_for`` / ``lane_opts_for`` into
``opts["semantics"]``; it owns A (``_BINARY_V2``) and C (``FN_V2``). Absent = 1 =
every existing output, byte for byte.
"""
from __future__ import annotations

import json
import math
import os
import sqlite3

import pytest

from api.services import alert_conditions, alert_user_series as aus, ast_interpret as ai
from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc
from api.services.indicator_compute import compute_atr_raw, compute_rsi_raw

HERE = os.path.dirname(os.path.abspath(__file__))
GAPS_PATH = os.path.join(HERE, "..", "app", "src", "components", "chart", "engine",
                         "__truth__", "p0.sem.gaps.json")
with open(GAPS_PATH, encoding="utf-8") as fh:
    GAPS = json.load(fh)
BARS = GAPS["bars"]
CASES = {c["id"]: c for c in GAPS["cases"]}
V2 = {"semantics": 2}


def wire(col):
    return [None if (v is None or (isinstance(v, float) and not math.isfinite(v))) else v
            for v in col]


def run(case_id):
    c = CASES[case_id]
    return wire(ai.interpret(c["ast"], BARS, {}, opts=c["opts"]))


def finite(col):
    return sum(1 for v in col if v is not None)


def same(a, b, tol=1e-9):
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if (x is None) != (y is None):
            return False
        if x is not None and abs(x - y) > tol * max(1.0, abs(y)):
            return False
    return True


# --------------------------------------------------------------------------- #
# browser = server on the shared fixture
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("case_id", sorted(CASES))
def test_shared_fixture_server_equals_frozen_browser(case_id):
    """EXACT -- the server lane reproduces the browser lane's frozen column."""
    assert same(run(case_id), GAPS["expect"][case_id]), case_id


# --------------------------------------------------------------------------- #
# A -- unknown comparisons
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("op", ["gt", "lt", "ge", "le", "eq", "ne"])
def test_A_new_native_unknown_comparison_propagates(op):
    """ASKED x OP 100 where x is unknown on bars 30/50 · CLAIMED (decision A)
    unknown · BEFORE 0 · NOW (semantics 2) UNKNOWN."""
    col = run(f"{op}__v2")
    assert col[30] is None and col[50] is None
    assert finite(col) == 78


@pytest.mark.parametrize("op", ["gt", "lt", "ge", "le", "eq", "ne"])
def test_A_legacy_native_comparison_retains_zero(op):
    """A save without the stamp keeps X23: compare-vs-unknown is 0. No migration.
    DISCLOSED DIFFERENCE (legacy)."""
    assert run(f"{op}__v1")[30] == 0.0
    assert ai._BINARY[">"](float("nan"), 1.0) == 0.0
    assert math.isnan(ai._BINARY_V2[">"](float("nan"), 1.0))


def test_A_logic_keeps_propagation_and_now_sees_the_unknown():
    for cid in ("and_true__v2", "or_false__v2", "not__v2", "ternary__v2"):
        assert run(cid)[30] is None, cid
    assert run("not__v1")[30] == 1.0      # BEFORE: the laundered 0 negated to a confident TRUE


def test_A_pine_origin_keeps_pine_semantics_even_with_a_forged_stamp():
    """ASKED na > 1 in a Pine import · CLAIMED (TradingView) false · DID 0 [EXACT]."""
    pine = {"meta": {"name": "p", "recurrenceOrigin": "pine", "semantics": 2},
            "compute": {"kind": "ast", "ast": CASES["gt__v1"]["ast"]}}
    assert ai.semantics_for(pine) == 1
    assert "semantics" not in ai.lane_opts_for(pine)
    # (`lane_opts_for` also withholds Pine's `bar_index`, which the fixture's hole
    # construction reads -- so the comparison is asked under the semantics opts alone)
    col = wire(ai.interpret(pine["compute"]["ast"], BARS, {}, opts=ai.semantics_opts_for(pine)))
    assert col[30] == 0.0
    # and the evaluator itself refuses to combine the stamp with the listing
    assert ai.semantics_v2({"semantics": 2, "historyFromListing": True}) is False
    for bogus in (True, "2", 3, 1, None):
        assert ai.semantics_for({"meta": {"semantics": bogus}}) == 1, bogus


# --------------------------------------------------------------------------- #
# A -- alerts: unknown never fires and never counts as a crossing
# --------------------------------------------------------------------------- #
def _doc(src_ast, semantics=None):
    meta = {"name": "sem", "repaint": "non-repainting"}
    if semantics is not None:
        meta["semantics"] = semantics
    return {"schemaVersion": 1, "id": "u_000000000777", "version": 1, "meta": meta,
            "compute": {"kind": "ast", "ast": src_ast},
            "placement": {"target": "pane"},
            "plots": [{"key": "value", "style": "line", "role": "primary"}], "inputs": []}


def _fires(series, condition, threshold):
    """The closed lane's rule (`_evaluate_one_closed`): current = series[i],
    prev = series[i-1], `None` current never fires, `check_condition` decides."""
    out = []
    for i in range(1, len(series)):
        cur, prev = series[i], series[i - 1]
        out.append(cur is not None and alert_conditions.check_condition(condition, cur, prev, threshold))
    return out


def test_A_alert_column_carries_the_semantics_and_unknown_never_fires():
    tree = CASES["gt__v1"]["ast"]
    v2 = aus._make_value_fn("u_000000000777", "value", _doc(tree, 2)).column(BARS, {})
    v1 = aus._make_value_fn("u_000000000777", "value", _doc(tree)).column(BARS, {})
    assert v2[30] is None and v2[50] is None      # the alert lane's "no number"
    assert v1[30] == 0.0                          # BEFORE: a confident 0
    for cond in ("above", "below", "cross_above", "cross_below"):
        assert _fires(v2, cond, 0.5)[30 - 1] is False, cond      # the unknown bar itself
    for cond in ("cross_above", "cross_below"):
        assert _fires(v2, cond, 0.5)[31 - 1] is False, cond      # prev unknown -> no edge
    assert _fires(v2, "above", 0.5)[31 - 1] is True              # a known level still answers


def test_A_an_unknown_bar_does_not_manufacture_a_crossing():
    """ASKED cross_above 0.5 on `x > 100` · bars 29/30/31 are 1/unknown/1 ·
    BEFORE (legacy): 1 -> laundered 0 -> 1 manufactured a cross_above on bar 31 ·
    NOW (semantics 2): no edge -- the transition out of an unknown is not one."""
    tree = CASES["gt__v1"]["ast"]
    v1 = aus._make_value_fn("u_000000000777", "value", _doc(tree)).column(BARS, {})
    v2 = aus._make_value_fn("u_000000000777", "value", _doc(tree, 2)).column(BARS, {})
    assert (v1[29], v1[30], v1[31]) == (1.0, 0.0, 1.0)
    assert _fires(v1, "cross_above", 0.5)[31 - 1] is True       # the manufactured edge, legacy
    assert (v2[29], v2[30], v2[31]) == (1.0, None, 1.0)
    assert _fires(v2, "cross_above", 0.5)[31 - 1] is False


def test_A_unknown_then_false_then_true_edges_only_on_two_known_bars():
    """The closed-lane edge contract stated explicitly: an edge needs two
    consecutive KNOWN bars. unknown -> false is NOT an edge (in either direction);
    false -> true on two known bars is the genuine crossing and the ONLY one."""
    seq = [None, 0.0, 1.0]
    for cond in ("cross_above", "cross_below"):
        assert alert_conditions.check_condition(cond, 0.0, None, 0.5) is False
    assert alert_conditions.check_condition("above", None, None, 0.5) is False
    assert _fires(seq, "cross_above", 0.5) == [False, True]
    assert _fires(seq, "cross_below", 0.5) == [False, False]
    # and an unknown in the MIDDLE breaks the edge: false -> unknown -> true never fires
    assert _fires([0.0, None, 1.0], "cross_above", 0.5) == [False, False]


@pytest.mark.parametrize("seq,fires_last", [
    ([0.0, 1.0], True),               # false -> true                     = FIRE
    ([None, 1.0], False),             # unknown -> true                   = no fire
    ([None, None, 1.0], False),       # unknown -> unknown -> true        = no fire
    ([None, 0.0, 1.0], True),         # unknown -> false -> true          = FIRE on false -> true
    ([0.0, None, 1.0], False),        # false -> unknown -> true          = no fire
], ids=["F-T", "U-T", "U-U-T", "U-F-T", "F-U-T"])
def test_A_owner_crossing_contract_five_sequences(seq, fires_last):
    """OWNER CONTRACT (P0 final clarification, 2026-10-05): an UNKNOWN bar breaks
    crossing continuity; a later real FALSE -> TRUE is a genuine crossing. Only the
    final transition may fire, and nothing before it does."""
    edges = _fires(seq, "cross_above", 0.5)
    assert edges[-1] is fires_last
    assert not any(edges[:-1])


def test_A_arm_time_cross_lane_proof_runs_under_the_documents_semantics():
    """The 1e-9 arm-time proof is taken with the SAME opts production evaluates
    with (`semantics_opts_for`), on the gap fixture, and the lanes agree."""
    tree = CASES["rsi_cmp_gap__v2"]["ast"]
    try:
        report = aus.cross_lane_report(tree, BARS, {}, {"semantics": 2})
    except Exception as exc:                       # pragma: no cover - node missing
        pytest.skip(f"node lane unavailable: {exc}")
    assert report["compared"] > 0
    assert not report.get("differences"), report.get("differences")[:3]


# --------------------------------------------------------------------------- #
# C -- Wilder functions across gaps
# --------------------------------------------------------------------------- #
def test_C_new_native_rsi_across_a_gap_preserves_state():
    v1, v2 = run("rsi_gap__v1"), run("rsi_gap__v2")
    assert finite(v1) == 15                        # BEFORE: restart after the LAST hole
    assert finite(v2) == 62
    assert v2[30] is None and v2[31] is None and v2[32] is not None
    # == compute_rsi_raw over the whole gappy column (it holds), == native rsiOfSeries
    gcol = ai.interpret(CASES["gt__v1"]["ast"]["args"][0], BARS, {})
    held = [None if v is None else v for v in compute_rsi_raw(
        [float("nan") if v is None else v for v in gcol], 14)]
    assert same(v2, wire(held))
    assert same(v2, GAPS["native"]["rsiOfSeries_G14"])


def test_C_new_native_atr_across_a_gap_preserves_state():
    v1, v2 = run("atr_gap__v1"), run("atr_gap__v2")
    assert finite(v1) == 15 and finite(v2) == 64
    assert v2[31] is None and v2[32] is not None
    assert same(v2[:31], run("atr_gapfree__v2")[:31])


def test_C_adx_family_holds_mfi_and_stoch_do_not():
    assert finite(run("adx_gap__v1")) == 2 and finite(run("adx_gap__v2")) == 49
    assert run("mfi_gap__v2") == run("mfi_gap__v1")
    assert run("stoch_gap__v2") == run("stoch_gap__v1")
    assert sorted(ai.FN_V2) == ["adx", "atr", "minusDI", "plusDI", "rsi"]


def test_C_legacy_formula_retains_restart_and_left_edge_is_identical():
    assert same(run("rsi_gap__v1"), GAPS["expect"]["rsi_gap__v1"])
    for cid in ("rsi_left_edge", "atr_left_edge", "rsi_gapfree", "atr_gapfree", "adx_gapfree"):
        assert run(f"{cid}__v1") == run(f"{cid}__v2"), cid


def test_C_native_server_rsi_atr_unchanged():
    """The server's NATIVE `compute_rsi_raw`/`compute_atr_raw` (untouched) still
    equal the browser's native columns on the fixture's gap-free bars."""
    rsi = wire(compute_rsi_raw([b["c"] for b in BARS], 14))
    atr = wire(compute_atr_raw(BARS, 14))
    assert same(rsi, GAPS["native"]["computeRSI_close14"])
    assert same(atr, GAPS["native"]["computeATR_14"])


# --------------------------------------------------------------------------- #
# ownership -- the store stamps, and only the store
# --------------------------------------------------------------------------- #
@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _sma(n):
    return {"type": "call", "name": "sma", "args": [{"type": "series", "name": "close"},
                                                    {"type": "num", "value": n}]}


def _defn(period=20, *, name="Mine", def_id="u_000000000001", meta_extra=None):
    meta = {"name": name, "shortName": "MA", "repaint": "non-repainting"}
    meta.update(meta_extra or {})
    return {"schemaVersion": 1, "id": def_id, "version": 1, "meta": meta,
            "compute": {"kind": "ast", "ast": _sma(period)},
            "placement": {"target": "price"},
            "plots": [{"key": "value", "style": "line", "role": "primary"}], "inputs": []}


def _stored(def_id="u_000000000001"):
    return svc.get("u1", def_id)["definition"]


def _make_legacy(def_id="u_000000000001"):
    """Rewrite the newest row as a PRE-P0G row: the same document, no stamp."""
    with sqlite3.connect(svc._DB_PATH) as c:
        row = c.execute("SELECT version, definition FROM user_definitions WHERE def_id=? "
                        "ORDER BY version DESC LIMIT 1", (def_id,)).fetchone()
        doc = json.loads(row[1])
        doc["meta"].pop("semantics", None)
        c.execute("UPDATE user_definitions SET definition=? WHERE def_id=? AND version=?",
                  (json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
                   def_id, row[0]))


def test_store_stamps_a_new_native_create(store):
    out = svc.save("u1", "u_000000000001", _defn())
    assert out["semantics"] == 2
    assert _stored()["meta"]["semantics"] == 2
    assert ai.lane_opts_for(_stored()) == {"semantics": 2}


def test_store_never_stamps_a_pine_document_or_pine_translated_maths(store):
    svc.save("u1", "u_000000000001", _defn(meta_extra={"recurrenceOrigin": "pine", "semantics": 2}))
    assert "semantics" not in _stored()["meta"]
    out = svc.save("u1", "u_000000000002", _defn(def_id="u_000000000002"), source_dialect="pine")
    assert out["semantics"] == 1 and "semantics" not in _stored("u_000000000002")["meta"]
    out = svc.save("u1", "u_000000000003", _defn(def_id="u_000000000003"), source_dialect="thinkscript")
    assert out["semantics"] == 2


def test_P2_a_pine_row_stays_unstamped_when_an_edit_door_drops_its_origin(store):
    """ASKED edit the maths of a Pine import through a door that rebuilds the document
    (the manual Builder's reopen→save drops `meta.recurrenceOrigin`) · CLAIMED the same
    indicator, edited · BEFORE: the maths edit was stamped semantics 2 (na-compares-false
    silently became unknown) · NOW: the STORED row's Pine origin decides — no stamp."""
    svc.save("u1", "u_000000000004", _defn(def_id="u_000000000004", meta_extra={"recurrenceOrigin": "pine"}))
    assert "semantics" not in _stored("u_000000000004")["meta"]
    out = svc.save("u1", "u_000000000004", _defn(period=50, def_id="u_000000000004"))  # origin dropped, maths moved
    assert out["rev_bumped"] is True
    assert out["semantics"] == 1 and "semantics" not in _stored("u_000000000004")["meta"]
    # a NATIVE row edited the same way still gets the new semantics
    svc.save("u1", "u_000000000005", _defn(def_id="u_000000000005"))
    out = svc.save("u1", "u_000000000005", _defn(period=50, def_id="u_000000000005"))
    assert out["semantics"] == 2


def test_client_cannot_forge_the_stamp(store):
    # a create carrying a bogus value is stored with the store's own decision
    svc.save("u1", "u_000000000001", _defn(meta_extra={"semantics": 7}))
    assert _stored()["meta"]["semantics"] == 2
    # a legacy row: a presentation edit that SENDS semantics 2 is stripped -> stays legacy
    _make_legacy()
    out = svc.save("u1", "u_000000000001", _defn(name="Renamed", meta_extra={"semantics": 2}))
    assert out["rev_bumped"] is False and out["semantics"] == 1
    assert "semantics" not in _stored()["meta"]
    # a stamped row: an edit that DROPS it keeps 2 (the client cannot opt out either)
    svc.save("u1", "u_000000000009", _defn(def_id="u_000000000009"))
    out = svc.save("u1", "u_000000000009", _defn(def_id="u_000000000009", name="R2"))
    assert out["semantics"] == 2 and _stored("u_000000000009")["meta"]["semantics"] == 2


def test_legacy_non_maths_edit_keeps_legacy_and_maths_edit_upgrades(store):
    svc.save("u1", "u_000000000001", _defn())
    _make_legacy()
    out = svc.save("u1", "u_000000000001", _defn(name="Only the name moved"))
    assert out["rev_bumped"] is False and out["semantics"] == 1
    assert "semantics" not in _stored()["meta"]
    out = svc.save("u1", "u_000000000001", _defn(50, name="Only the name moved"))
    assert out["rev_bumped"] is True and out["semantics"] == 2
    assert _stored()["meta"]["semantics"] == 2


def test_byte_identical_resave_of_a_stamped_row_appends_nothing(store):
    svc.save("u1", "u_000000000001", _defn())
    again = svc.save("u1", "u_000000000001", _stored())
    assert again["appended"] is False and again["semantics"] == 2
    again = svc.save("u1", "u_000000000001", _defn())    # unstamped resend, same maths
    assert again["appended"] is False


def test_stamp_does_not_move_the_tree_hashes(store):
    a = svc.save("u1", "u_000000000001", _defn())
    assert a["ast_hash"] == svc.ast_hash(_sma(20))
    pine = svc.save("u1", "u_000000000002", _defn(def_id="u_000000000002",
                                                  meta_extra={"recurrenceOrigin": "pine"}))
    assert pine["ast_hash"] == a["ast_hash"]
