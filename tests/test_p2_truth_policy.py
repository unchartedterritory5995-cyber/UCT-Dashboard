"""P2 truth matrix, slice "policy" -- the SERVER half of the LOCKED owner policies.

  P2-policy 1  alert cap: 200, a named constant, atomic under BEGIN IMMEDIATE
  P2-policy 6  IS TRUE is episodic -- the REAL 60-second cycle over a router-armed
               alert reproduces `tests/fixtures/ast/p2_is_true_episodes.json`
  P2-policy 7  scalar sibling: alert admission is PER OUTPUT
  P2-presentation  `user_definitions.save` validates paints / markers / plot
               styles / colour modes with defSchema's own primitives
               (`tests/fixtures/ast/p2_presentation_schema.json`), 422 structured;
               a legacy row's stored presentation is recorded, never enforced

The browser half is `app/src/components/chart/engine/__truth__/p2.policy.truth.test.js`.
Every case states ASKED / CLAIMED / DID and its outcome class.
"""
from __future__ import annotations

import copy
import inspect
import json
import logging
import pathlib
import threading

import pytest

from api.services import alert_fired_log
from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import presentation_schema as ps
from api.services import user_definitions as ud

ROOT = pathlib.Path(__file__).resolve().parent
FIX = ROOT / "fixtures" / "ast"
EPISODES = json.loads((FIX / "p2_is_true_episodes.json").read_text("utf-8"))
SCHEMA = json.loads((FIX / "p2_presentation_schema.json").read_text("utf-8"))
ALERT_FIX = json.loads((FIX / "p1_evaluability_alert.json").read_text("utf-8"))

USER = "p2-policy-user"
DEF_ID = "u_0d2a100000c1"
TWO_ID = "u_0d2a100000c2"

GT100 = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "close"}, {"type": "num", "value": 100}]}
SCALAR_GT = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "market_cap"}, {"type": "num", "value": 1e9}]}


def defn(def_id: str = DEF_ID, tree=None, **extra) -> dict:
    d = {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "Above 100", "shortName": "A100"},
        "compute": {"kind": "ast", "ast": tree if tree is not None else GT100},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }
    d.update(extra)
    return d


def two_plot(def_id: str = TWO_ID) -> dict:
    trees = {"sig": GT100, "cap": SCALAR_GT}
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "Sig + cap", "shortName": "SC"},
        "compute": {"kind": "ast", "ast": GT100, "source": "close > 100", "trees": trees,
                    "treesHash": ud.trees_hash(trees), "scanPlot": "sig",
                    "sources": {"sig": "close > 100", "cap": "market_cap > 1e9"}},
        "placement": {"target": "pane"},
        "plots": [{"key": "sig", "style": "line"}, {"key": "cap", "style": "line"}],
        "inputs": [],
    }


BARS = [{"t": 1_700_000_000 + i * 300, "o": 70.0 + i, "h": 71.0 + i,
         "l": 69.0 + i, "c": 70.0 + i, "v": 1_000} for i in range(60)]


@pytest.fixture
def defs_db(tmp_path, monkeypatch):
    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    aus.forget()
    try:
        yield path
    finally:
        aus.forget()


@pytest.fixture
def alerts_db(tmp_path, monkeypatch):
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(ias, "_DB_PATH", str(path))
    ias.init_schema()
    return path


@pytest.fixture
def client(defs_db, alerts_db, monkeypatch):
    from fastapi.testclient import TestClient
    from api.main import app
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in BARS])
    app.dependency_overrides[get_current_user] = lambda: {"id": USER}
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_user_with_plan, None)


def arm(client, indicator: str, policy: str):
    return client.post("/api/indicator-alerts", json={
        "sym": "TEST", "indicator": indicator, "tf": "5", "trigger_policy": policy})


def seq_bars(closes: list) -> list:
    out = []
    for i, c in enumerate(closes):
        v = None if c is None else float(c)
        out.append({"t": 1_700_100_000 + i * 300, "o": v, "h": v, "l": v, "c": v, "v": 1_000})
    return out


# ═══ P2-policy 1 — the alert cap ═════════════════════════════════════════════

def test_P2_1_the_cap_is_200_a_named_constant_and_the_member_door_passes_it():
    """ASKED: what bounds a member's alerts? CLAIMED (owner policy 1): 200, as a
    named constant, no entitlement axis. DID: `MAX_ALERTS_PER_USER == 200`, the
    router passes exactly that name, and `entitlements` names no alert limit.
    Class: EXACT. (The name is kept: the count covers inactive rows too, so
    "ACTIVE" in a rename would misdescribe it.)"""
    from api.routers import indicator_alerts as router_mod
    from api.services import entitlements
    assert ias.MAX_ALERTS_PER_USER == 200
    assert "max_alerts=ias.MAX_ALERTS_PER_USER" in inspect.getsource(router_mod)
    assert "max_alert" not in inspect.getsource(entitlements).lower()


def test_P2_1_count_and_insert_are_one_BEGIN_IMMEDIATE_transaction(alerts_db):
    """ASKED: 10 concurrent creates against a cap of 4. CLAIMED: exactly 4 land,
    the rest are `AlertCountExceeded`. DID: 4 rows. Class: REFUSAL / EXACT."""
    src = inspect.getsource(ias.create)
    assert src.index('BEGIN IMMEDIATE') < src.index('SELECT COUNT(*)') < src.index('INSERT INTO indicator_alerts')
    barrier = threading.Barrier(10)
    results = []

    def one():
        barrier.wait()
        try:
            ias.create("cap-user", "SPY", "rsi", "above", 70.0, "D", max_alerts=4)
            results.append("ok")
        except ias.AlertCountExceeded:
            results.append("cap")
    threads = [threading.Thread(target=one) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count("ok") == 4 and results.count("cap") == 6
    assert len(ias.list_for_user("cap-user")) == 4


# ═══ P2-policy 6 — IS TRUE is episodic, through the REAL 60-second cycle ═════

@pytest.mark.parametrize("seq", EPISODES["sequences"], ids=lambda s: s["id"])
def test_P2_6_is_true_episodes_through_the_real_cycle(client, monkeypatch, seq):
    """ASKED: `is_true` on `close > 100` (semantics 2, real `ud.save` stamp),
    armed through the REAL router, then the REAL `_run_one_cycle` after each
    close. CLAIMED: the fixture's per-bar fires -- once per true episode,
    re-armed only by a KNOWN false, never by UNKNOWN; arming opens the first
    episode. DID: the fired log grows exactly where the fixture says.
    Class: VALUE / UNKNOWN."""
    ud.save(USER, DEF_ID, defn())
    r = arm(client, f"{DEF_ID}.value", "is_true")
    assert r.status_code == 200, r.text
    alert_id = r.json()["id"]
    monkeypatch.setattr(ev, "_dispatch_delivery", lambda *a, **k: None)
    monkeypatch.setattr(ev, "_accrue_ledger_receipt", lambda *a, **k: None)
    # ⚠️ ONE LEADING HISTORY BAR, never judged: the closed lane judges bar
    # `i >= 1` only (`series[i-1]` must exist), and a real alert always has
    # history before the bar it first judges. Its value cannot matter to a
    # LEVEL rule (is_true never reads `prev`) -- it is UNKNOWN here on purpose.
    closes = [None] + seq["closes"]
    got, before = [], 0
    for k in range(2, len(closes) + 1):
        prefix = seq_bars(closes[:k])
        monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                            lambda sym, tf, count=200, _p=prefix: [dict(b) for b in _p])
        ev._run_one_cycle()
        now = len(alert_fired_log.fires_for_alert(alert_id, 50))
        got.append(now > before)
        before = now
    assert got == seq["fires"], (seq["id"], got)


def test_P2_6_the_owner_sequences_are_in_the_fixture():
    ids = {s["id"] for s in EPISODES["sequences"]}
    assert {"F-T", "T-T", "T-F-T", "T-U-T", "T-U-F-T", "U-T"} <= ids


def test_P2X_owner_lock_sequences_are_in_the_shared_fixture():
    """ASKED (P2X owner lock): ARM -> U stays armed -> T fires+latches -> T latched
    -> U stays latched (no re-arm, episode not ended) -> F re-arms -> T fires;
    arming while true fires on the first KNOWN true. CLAIMED: each leg is a named
    row of the ONE fixture both lanes read (the parametrised cycle test above runs
    every row through the REAL `_run_one_cycle`; `policyFires` runs the same rows
    in the browser). DID. Class: EXACT."""
    by_id = {s["id"]: s["fires"] for s in EPISODES["sequences"]}
    assert by_id["U-U-T"] == [False, False, True]
    assert by_id["T-U-U-T"] == [True, False, False, False]
    assert by_id["T-F-U-T"] == [True, False, False, True]
    assert by_id["U-T-U-T"] == [False, True, False, False]
    assert by_id["U-T-U-F-U-T"] == [False, True, False, False, False, True]
    assert by_id["T-T"][0] is True


# ═══ P2-policy 7 — the scalar sibling ═════════════════════════════════════════

def test_P2_7_plot_admissions_keep_the_scalar_refusal_PER_PLOT():
    """ASKED: admit a definition with a CONDITION plot and a market_cap plot.
    CLAIMED: the CONDITION is admissible; the scalar plot alone is refused
    (gate `scalar`). DID. Class: VALUE / REFUSAL."""
    admissible, withheld = aus.plot_admissions(TWO_ID, two_plot())
    assert [a for a, _ in admissible] == [f"{TWO_ID}.sig"]
    assert withheld[f"{TWO_ID}.cap"].gate == "scalar"
    assert aus.PER_PLOT_GATES == frozenset({"withheld", "scalar"})


def test_P2_7_a_plot_refusal_still_refuses_the_whole_definition():
    case = next(c for c in ALERT_FIX["cases"] if c["name"] == "v2 claim, plot c has no tree :: a")
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.plot_admissions(case["definition"]["id"], case["definition"])
    assert exc.value.gate == "plot"


def test_P2_7_the_condition_sibling_ARMS_and_the_scalar_plot_is_refused_at_the_router(client):
    """ASKED: arm `becomes_true` on `sig` (a CONDITION) whose sibling `cap` reads
    market_cap; then arm on `cap`. CLAIMED: `sig` arms (it used to be refused for
    the whole definition); `cap` is refused, no row. DID. Class: VALUE / REFUSAL."""
    ud.save(USER, TWO_ID, two_plot())
    r = arm(client, f"{TWO_ID}.sig", "becomes_true")
    assert r.status_code == 200, r.text
    before = len(ias.list_for_user(USER))
    r2 = arm(client, f"{TWO_ID}.cap", "becomes_true")
    assert r2.status_code >= 400
    assert "market_cap" in r2.text
    assert len(ias.list_for_user(USER)) == before


# ═══ P2-presentation — server validation by defSchema's own primitives ═══════

def test_P2_presentation_vocabulary_equals_the_shared_fixture():
    """The server's lists ARE the fixture's, which the browser rails against
    defSchema's exports -- a drift on either side reds."""
    v = SCHEMA["vocab"]
    assert list(ps.PLOT_STYLES) == v["plotStyles"]
    assert list(ps.RESERVED_PLOT_STYLES) == v["reservedPlotStyles"]
    assert list(ps.MARKER_SHAPES) == v["markerShapes"]
    assert list(ps.MARKER_POSITIONS) == v["markerPositions"]
    assert ps.MARKER_SIZE_RANGE == v["markerSizeRange"]
    assert ps.MARKER_TEXT_MAX == v["markerTextMax"]
    assert list(ps.PAINT_KINDS) == v["paintKinds"]
    assert list(ps.COLOR_MODES) == v["colorModes"]


def _schema_base() -> dict:
    return {"plots": [
        {"key": "value", "style": "line", "color": "$color", "legend": {"decimals": 2}},
        {"key": "cond", "style": "line", "hidden": True},
        {"key": "sig", "style": "markers", "marker": {"shape": "circle"}},
    ]}


def _apply(base: dict, case: dict) -> dict:
    d = copy.deepcopy(base)
    for key, patch in (case.get("plots") or {}).items():
        p = next(x for x in d["plots"] if x["key"] == key)
        for f, v in patch.items():
            if v is None:
                p.pop(f, None)
            else:
                p[f] = v
    if "paints" in case:
        d["paints"] = case["paints"]
    return d


@pytest.mark.parametrize("case", SCHEMA["cases"], ids=lambda c: c["name"])
def test_P2_presentation_server_agrees_with_the_browser_case_by_case(case):
    """ASKED: the fixture's presentation. CLAIMED (defSchema, the browser
    validator): `case.expect`. DID (server): the same answer, naming `case.code`.
    Class: REFUSAL / EXACT."""
    errors = ps.presentation_errors(_apply(_schema_base(), case))
    if case["expect"] == "ok":
        assert errors == [], errors
    else:
        assert errors, case["name"]
        assert case["code"] in {e["code"] for e in errors}, errors


def test_P2_presentation_a_new_save_with_an_inert_paint_is_a_structured_422(client):
    """ASKED: POST a definition whose paint reads a column no plot declares.
    CLAIMED: refused, nothing stored (it would register and draw nothing).
    DID: 422, gate `presentation`, errors[{path, code, message}]. Class: REFUSAL."""
    bad = defn(paints=[{"kind": "barcolor", "colorMode": "column:nope",
                        "colorUp": "#fff", "colorDown": "#000"}])
    r = client.post("/api/user-definitions", json={"definition": bad})
    assert r.status_code == 422, r.text
    ref = r.json()["refusal"]
    assert ref["gate"] == "presentation"
    assert ref["guard"] == "presentation:paint-column"
    assert ref["errors"][0]["path"] == "paints[0].colorMode"
    assert ud.list_for_user(USER) == []


def test_P2_presentation_markers_and_styles_refuse_at_the_door(client):
    for plots, code in (
        ([{"key": "value", "style": "markers", "marker": {"shape": "star"}}], "marker-shape"),
        ([{"key": "value", "style": "markers", "marker": {"shape": "circle", "position": "top"}}], "marker-position"),
        ([{"key": "value", "style": "cross"}], "plot-style"),
    ):
        r = client.post("/api/user-definitions", json={"definition": defn(plots=plots)})
        assert r.status_code == 422, (code, r.text)
        assert r.json()["refusal"]["guard"] == f"presentation:{code}"


def test_P2_presentation_valid_presentation_saves_unchanged(client):
    good = defn(paints=[{"kind": "barcolor", "colorMode": "column:value",
                         "colorUp": "#26a69a", "colorDown": "transparent"}],
                plots=[{"key": "value", "style": "markers", "role": "primary",
                        "marker": {"shape": "arrowUp", "position": "belowBar"}}])
    r = client.post("/api/user-definitions", json={"definition": good})
    assert r.status_code == 200, r.text


def test_P2_presentation_a_legacy_row_is_recorded_not_enforced(defs_db, alerts_db, monkeypatch, caplog):
    """ASKED: a row stored BEFORE this gate with a paint today's rule refuses
    (kind 'fill'), then (a) a maths edit, (b) a presentation edit of ANOTHER
    field, (c) an edit that CHANGES that paint to another invalid one, (d) an
    edit that ADDS a new invalid paint. CLAIMED: no migration; the unchanged
    legacy entry never blocks a save and is logged; a new or changed invalid
    entry is refused. DID. Class: DISCLOSED DIFFERENCE / REFUSAL."""
    from api.services import alert_rev_migration
    alert_rev_migration.init_schema()
    legacy_paint = {"kind": "fill", "color": "#abcdef"}
    with monkeypatch.context() as m:
        m.setattr(ps, "presentation_errors", lambda *_a, **_k: [])
        ud.save(USER, DEF_ID, defn(paints=[legacy_paint]))
    # (a) maths edit keeps the legacy paint byte-identical
    edited = defn(tree={"type": "op", "name": ">", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": 150}]}, paints=[legacy_paint])
    with caplog.at_level(logging.WARNING, logger="api.services.user_definitions"):
        r = ud.save(USER, DEF_ID, edited)
    assert r["rev_bumped"] is True
    assert "paints[0].kind [paint-kind]" in caplog.text
    # (b) presentation edit of another field
    renamed = copy.deepcopy(edited)
    renamed["plots"][0]["color"] = "#123456"
    assert ud.save(USER, DEF_ID, renamed)["appended"] is True
    # (c) the legacy entry CHANGED to another refused one
    changed = copy.deepcopy(renamed)
    changed["paints"] = [{"kind": "fill", "color": "#000000"}]
    with pytest.raises(ud.SaveRefused) as exc:
        ud.save(USER, DEF_ID, changed)
    assert exc.value.gate == "presentation"
    # (d) a NEW invalid entry beside the kept legacy one
    added = copy.deepcopy(renamed)
    added["paints"] = [legacy_paint, {"kind": "bgcolor"}]
    with pytest.raises(ud.SaveRefused) as exc2:
        ud.save(USER, DEF_ID, added)
    assert [e["code"] for e in exc2.value.errors] == ["paint-colour"]


def test_P2_presentation_other_save_gates_keep_their_422_body_shape():
    """The `presentation` gate's `errors` list is additive: every other gate's
    `as_dict` is byte-identical to before."""
    assert ud.SaveRefused("repaint", "x", plot="value").as_dict() == {
        "gate": "repaint", "plot": "value", "mode": None, "guard": None}
