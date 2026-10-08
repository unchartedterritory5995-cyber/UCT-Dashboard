"""P1 truth matrix, slice "signal" -- the SERVER half.

triggerPolicy (is_true / becomes_true / becomes_false) on a CONDITION output,
armed through the REAL router door, evaluated by the REAL closed-bar evaluator
on the STORED definition's tree; the alert count cap and its `BEGIN IMMEDIATE`
concurrency. The browser half is
`app/src/components/chart/engine/__truth__/p1.signal.truth.test.js`; the two are
held equal by `tests/fixtures/ast/p1_trigger_policy.json` (table, sentence,
transition columns and fires) and `p1_evaluability_alert.json` (the gate).

Every case states ASKED / CLAIMED / DID and its outcome class.
"""
from __future__ import annotations

import json
import pathlib
import sqlite3
import threading

import pytest

from api.services import alert_trigger_policy as atp
from api.services import alert_user_series as aus
from api.services import ast_interpret
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as ud
from tests._p0_legacy_rows import save_legacy

ROOT = pathlib.Path(__file__).resolve().parent
FIX = json.loads((ROOT / "fixtures" / "ast" / "p1_trigger_policy.json").read_text("utf-8"))
TYPE_FIXTURE = json.loads((ROOT / "fixtures" / "ast" / "p1_output_types.json").read_text("utf-8"))

USER = "p1-signal-user"
DEF_ID = "u_51a1000000c1"
SERIES_ID = "u_51a1000000c2"




GT100 = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "close"}, {"type": "num", "value": 100}]}
GT150 = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "close"}, {"type": "num", "value": 150}]}
SMA5 = {"type": "call", "name": "sma", "args": [
    {"type": "series", "name": "close"}, {"type": "num", "value": 5}]}
SYM_GT = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "close"},
    {"type": "sym", "value": "SPY", "args": [{"type": "series", "name": "close"}]}]}
LTF_GT = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "close"},
    {"type": "ltf", "value": "60", "args": [{"type": "series", "name": "close"}]}]}
SCALAR_GT = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "market_cap"}, {"type": "num", "value": 1e9}]}


def defn(def_id: str = DEF_ID, tree=None, name: str = "Above 100") -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": name, "shortName": "A100"},
        "compute": {"kind": "ast", "ast": tree if tree is not None else GT100},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


#: Monotonic 5m bars for the arm-time cross-lane proof (60 bars, as the router
#: suite: every admitting POST spawns node).
BARS = [{"t": 1_700_000_000 + i * 300, "o": 70.0 + i, "h": 71.0 + i,
         "l": 69.0 + i, "c": 70.0 + i, "v": 1_000} for i in range(60)]
FAR_FUTURE = 4_000_000_000


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
def bars(monkeypatch):
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in BARS])


@pytest.fixture
def client(defs_db, alerts_db, bars):
    from fastapi.testclient import TestClient
    from api.main import app
    from api.middleware.auth_middleware import get_current_user

    app.dependency_overrides[get_current_user] = lambda: {"id": USER}
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def post(client, **over):
    body = {"sym": "TEST", "indicator": f"{DEF_ID}.value", "tf": "5"}
    body.update(over)
    return client.post("/api/indicator-alerts", json=body)


def rows(user: str = USER) -> list:
    return [r for r in ias.list_for_user(user)]


def seq_bars(closes: list) -> list:
    out = []
    for i, c in enumerate(closes):
        v = None if c is None else float(c)
        out.append({"t": 1_700_100_000 + i * 300, "o": v, "h": v, "l": v, "c": v, "v": 1_000})
    return out


def closed_fires(alert: dict, closes: list) -> list:
    """The REAL closed-bar evaluator, bar by bar: at each bar i >= 1, the alert
    as the 60s cycle would judge it with bars[0..i] closed."""
    full = seq_bars(closes)
    return [bool(ev._evaluate_one_closed(alert, full[:i + 1], now_epoch=FAR_FUTURE)[1])
            for i in range(1, len(full))]


# ═══ the shared table: one vocabulary, two lanes ═════════════════════════════

def test_P1_signal_table_and_sentence_equal_the_shared_fixture():
    """ASKED: what does each policy compile to? CLAIMED (fixture, = browser
    `triggerPolicy.js`): above / cross_above / cross_below @ 0.5. DID: the server
    table is identical, and the numeric refusal is the gate's sentence verbatim.
    Class: EXACT."""
    assert atp.TRUTH_DECODER == FIX["decoder"]
    assert [{"policy": k, "condition": c, "threshold": t}
            for k, (c, t) in atp.POLICIES.items()] == FIX["policies"]
    assert atp.GUARD_NUMERIC == FIX["numericGuard"]
    assert atp.NUMERIC_SENTENCE == FIX["numericSentence"]
    for k, (c, t) in atp.POLICIES.items():
        assert atp.policy_of(c, t) == k
    assert atp.policy_of("cross_above", 1.0) is None


def test_P1_signal_compiles_onto_conditions_check_condition_already_judges():
    """No duplicated condition math: every compiled rule is one the ONE
    decider (`check_condition`) already handles. Class: EXACT."""
    for cond, _thr in atp.POLICIES.values():
        assert cond in ias.evaluable_conditions()


@pytest.mark.parametrize("case", TYPE_FIXTURE["cases"], ids=lambda c: c["source"])
def test_P1_signal_server_output_type_twin_agrees_with_the_browser(case):
    """The door's type reading (`output_type_of`) equals the browser authority's
    over the core type fixture. Class: EXACT."""
    d = defn(tree=case["ast"])
    assert atp.output_type_of(d, "value") == case["expect"]["type"]


# ═══ 17 / 12: the P0 transition contract through a POLICY-ARMED alert ═══════

@pytest.mark.parametrize("policy", ["becomes_true", "is_true", "becomes_false"])
def test_P1_17_12_policy_armed_alert_honours_the_P0_transitions(client, policy):
    """ASKED: alert me when `close > 100` <policy>, armed through the router.
    CLAIMED: the row stores the compiled rule; the REAL closed-bar evaluator over
    the STORED tree fires exactly as the fixture says -- F->T fires; U->T,
    U->U->T, F->U->T do not; U->F->T fires on F->T (and the becomes_false
    mirrors). Unknown never fires. DID: as claimed. Class: VALUE / UNKNOWN."""
    saved = ud.save(USER, DEF_ID, defn())
    assert saved.get("semantics") == 2          # new native maths: propagating unknown
    r = post(client, trigger_policy=policy)
    assert r.status_code == 200, r.text
    row = ias.get(r.json()["id"])
    cond, thr = atp.POLICIES[policy]
    assert (row["condition"], row["threshold"]) == (cond, thr)
    assert ev.eval_mode() == "closed"
    for t in FIX["transitions"]:
        assert closed_fires(row, t["closes"]) == t["fires"][policy], (t["id"], policy)


def test_P1_17_the_five_owner_sequences_are_in_the_fixture():
    ids = {t["id"]: t for t in FIX["transitions"]}
    want = {"F-T": True, "U-T": False, "U-U-T": False, "U-F-T": True, "F-U-T": False}
    for k, fires_last in want.items():
        f = ids[k]["fires"]["becomes_true"]
        assert f[-1] is fires_last and not any(f[:-1]), k


def test_P1_12_the_alert_column_is_the_tree_column_with_unknown_as_None(client):
    """ASKED: what does the alert consumer read on an unknown bar? CLAIMED:
    `None` (never a laundered 0) under semantics 2. DID: the fixture's column.
    Class: UNKNOWN."""
    ud.save(USER, DEF_ID, defn())
    r = post(client, trigger_policy="becomes_true")
    assert r.status_code == 200, r.text
    fn = aus.USER_FUNCS[aus.scoped_key(USER, f"{DEF_ID}.value")]
    for t in FIX["transitions"]:
        assert fn.column(seq_bars(t["closes"]), {}) == t["column"], t["id"]


# ═══ 18 / 10: arming needs the gate's approval for THIS signal output ════════

def _refused(client, before: int, r, *needles):
    assert r.status_code == 400, r.text
    for n in needles:
        assert n in r.json()["detail"], (n, r.json()["detail"])
    assert len(rows()) == before                  # nothing armed, nothing to go quiet


def test_P1_18_a_numeric_series_is_refused_never_thresholded(client):
    """ASKED: `becomes_true` on `sma(close, 5)`. CLAIMED: refused
    `signal:numeric-output` with the gate's sentence -- a number is not read as a
    yes/no at 0.5. DID: 400, no row. Class: REFUSAL."""
    save_legacy(USER, SERIES_ID, defn(SERIES_ID, SMA5, "Avg"))
    r = post(client, indicator=f"{SERIES_ID}.value", trigger_policy="becomes_true")
    _refused(client, 0, r, atp.GUARD_NUMERIC, atp.NUMERIC_SENTENCE)


def test_P1_10_sym_unsupplied_refuses_through_policy_arming(client):
    """⭐ PHASE 5 SUPERSEDES P1-10: `becomes_true` on `close > sym('SPY', close)`
    now ARMS (the lane supplies SPY at evaluation); an ambiguous spelling
    (`sym('VIX', close)`) is still refused at arm by name. Class: SUPPLY / REFUSAL."""
    save_legacy(USER, DEF_ID, defn(tree=SYM_GT))
    r = post(client, trigger_policy="becomes_true")
    assert r.status_code == 200, r.text
    vix = json.loads(json.dumps(SYM_GT).replace('"SPY"', '"VIX"'))
    save_legacy(USER, DEF_ID, defn(tree=vix))
    r = post(client, trigger_policy="becomes_true")
    _refused(client, 1, r, aus.OTHER_SYMBOL_AMBIGUOUS, "withheld")


def test_P1_18_ltf_refuses_through_policy_arming(client):
    save_legacy(USER, DEF_ID, defn(tree=LTF_GT))
    r = post(client, trigger_policy="becomes_true")
    _refused(client, 0, r, aus.UNSUPPLIED_LOWER_TF)


def test_P1_18_scalar_refuses_through_policy_arming(client):
    save_legacy(USER, DEF_ID, defn(tree=SCALAR_GT))
    r = post(client, trigger_policy="is_true")
    _refused(client, 0, r, "scalar")


def test_P1_18_malformed_policy_requests_refuse(client):
    ud.save(USER, DEF_ID, defn())
    _refused(client, 0, post(client, trigger_policy="sometimes"), atp.GUARD_UNKNOWN)
    _refused(client, 0, post(client, trigger_policy="becomes_true",
                             condition="above", threshold=0.5), atp.GUARD_CONFLICT)
    _refused(client, 0, post(client, indicator="rsi", trigger_policy="becomes_true"),
             atp.GUARD_NOT_A_FORMULA)
    _refused(client, 0, post(client), atp.GUARD_UNKNOWN)          # neither sent
    # the compiled rule sent beside its policy is accepted (the popover does this)
    r = post(client, trigger_policy="becomes_true", condition="cross_above", threshold=0.5)
    assert r.status_code == 200, r.text


def test_P1_18_popover_defect_dead_threshold_on_a_yes_no_is_refused(client):
    """ASKED (the old popover's prefill): `cross_above 1` on a 0/1 CONDITION.
    BEFORE: armed, could never fire. CLAIMED: refused by name, pointing at the
    policies. DID: 400; `above 0` (alive -- it is is_true) still arms; a SERIES
    keeps numeric thresholds. Class: REFUSAL."""
    ud.save(USER, DEF_ID, defn())
    for cond, thr in (("cross_above", 1.0), ("above", 1.0), ("below", 0.0),
                      ("cross_below", 0.0)):
        _refused(client, 0, post(client, condition=cond, threshold=thr),
                 atp.GUARD_DEAD_THRESHOLD)
    assert post(client, condition="above", threshold=0.0).status_code == 200
    save_legacy(USER, SERIES_ID, defn(SERIES_ID, SMA5, "Avg"))
    assert post(client, indicator=f"{SERIES_ID}.value", condition="cross_above",
                threshold=1.0).status_code == 200


def test_P1_18_catalog_serves_the_server_derived_output_type(client):
    ud.save(USER, DEF_ID, defn())
    save_legacy(USER, SERIES_ID, defn(SERIES_ID, SMA5, "Avg"))
    cat = client.get("/api/indicator-alerts/catalog").json()["catalog"]
    types = {p["value"]: p["output_type"] for e in cat if e.get("source") == "user"
             for p in e["plots"]}
    assert types == {f"{DEF_ID}.value": "condition", f"{SERIES_ID}.value": "series"}
    # the GLOBAL entries are untouched (no new key on the frozen enumeration)
    assert all("output_type" not in p for e in cat if e.get("source") != "user"
               for p in e["plots"])


# ═══ 19 (alert part): the alert evaluates the STORED tree, not a copy ════════

def test_P1_19_the_alert_evaluates_the_stored_definition_tree(client):
    """ASKED: alert on the definition's CONDITION output. CLAIMED: one tree --
    the alert row holds an ADDRESS and a rule, no formula; its column IS
    `interpret(stored tree)`; editing the stored definition changes what the
    alert evaluates (after re-proof), so nothing was copied at arm. DID: as
    claimed. Class: EXACT."""
    ud.save(USER, DEF_ID, defn())
    r = post(client, trigger_policy="becomes_true")
    assert r.status_code == 200, r.text
    row = ias.get(r.json()["id"])
    assert row["indicator"] == f"{DEF_ID}.value" and row["params_json"] in (None, "{}", "null")
    raw = sqlite3.connect(str(ias._DB_PATH)).execute(
        "SELECT * FROM indicator_alerts WHERE id=?", (row["id"],)).fetchone()
    assert not any(isinstance(v, str) and ('"op"' in v or "close >" in v) for v in raw)
    stored = ud.get(USER, DEF_ID, None)["definition"]
    probe = seq_bars([99, 101, 120, 160, 99])
    want = ast_interpret.interpret(stored["compute"]["ast"], probe, {},
                                   opts=ast_interpret.lane_opts_for(stored))
    fn = aus.USER_FUNCS[aus.scoped_key(USER, f"{DEF_ID}.value")]
    assert fn.column(probe, {}) == want == [0.0, 1.0, 1.0, 1.0, 0.0]
    # edit the STORED definition's maths: the armed alert now evaluates the new tree
    ud.save(USER, DEF_ID, defn(tree=GT150))
    aus.forget(USER)
    fn2 = aus.value_function_for_alert(row)
    assert fn2.column(probe, {}) == [0.0, 0.0, 0.0, 1.0, 0.0]


# ═══ the alert count cap + BEGIN IMMEDIATE ═══════════════════════════════════

def _count(user: str) -> int:
    with sqlite3.connect(str(ias._DB_PATH)) as c:
        return c.execute("SELECT COUNT(*) FROM indicator_alerts WHERE user_id=?",
                         (user,)).fetchone()[0]


def test_P1_cap_control_a_naive_count_then_insert_leaks_under_WAL(alerts_db):
    """THE HAZARD, REPRODUCED DETERMINISTICALLY (control, not product code): a
    deferred count -> barrier -> insert over WAL lets 12 contenders all see 0
    against a cap of 5. This is why the cap ships ONLY with BEGIN IMMEDIATE."""
    n, cap = 12, 5
    gate = threading.Barrier(n)
    errors: list = []

    def naive():
        try:
            c = sqlite3.connect(str(alerts_db), timeout=10.0)
            c.execute("PRAGMA journal_mode=WAL")
            seen = c.execute("SELECT COUNT(*) FROM indicator_alerts WHERE user_id='n'").fetchone()[0]
            gate.wait()
            if seen < cap:
                c.execute("INSERT INTO indicator_alerts (user_id, sym, indicator, condition, "
                          "tf, created_at) VALUES ('n','X','rsi','above','D',0)")
                c.commit()
            c.close()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    ts = [threading.Thread(target=naive) for _ in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errors, errors
    assert _count("n") == n > cap                    # BEFORE: the cap leaks


def test_P1_cap_twelve_concurrent_creates_against_cap_5_land_exactly_5(alerts_db):
    """ASKED: 12 threads create at once against a cap of 5. CLAIMED: exactly 5
    rows; the other 7 are `AlertCountExceeded`, none a bypass. DID: 5.
    Class: REFUSAL (atomic)."""
    n, cap = 12, 5
    gate = threading.Barrier(n)
    ok: list = []
    refused: list = []
    other: list = []

    def arm():
        gate.wait()
        try:
            ok.append(ias.create("cap-user", "SPY", "rsi", "above", 70.0, "D",
                                 max_alerts=cap))
        except ias.AlertCountExceeded as exc:
            refused.append(exc)
        except Exception as exc:  # noqa: BLE001
            other.append(exc)

    ts = [threading.Thread(target=arm) for _ in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not other, other
    assert _count("cap-user") == cap
    assert len(ok) == cap and len(refused) == n - cap


def test_P1_cap_counts_inactive_rows_and_is_uncapped_for_operator_callers(alerts_db):
    for _ in range(3):
        ias.set_active(ias.create("c2", "SPY", "rsi", "above", 70.0, "D", max_alerts=3), False)
    with pytest.raises(ias.AlertCountExceeded):
        ias.create("c2", "SPY", "rsi", "above", 70.0, "D", max_alerts=3)
    assert _count("c2") == 3
    ias.create("c2", "SPY", "rsi", "above", 70.0, "D")          # operator path: no cap
    assert _count("c2") == 4


def test_P1_cap_the_member_door_refuses_at_the_cap(client, monkeypatch):
    """ASKED: one more alert than the cap through the router. CLAIMED: 400 with
    the store's sentence, no row. The value is `MAX_ALERTS_PER_USER` (200,
    OWNER DECISION). Class: REFUSAL."""
    assert ias.MAX_ALERTS_PER_USER == 200
    monkeypatch.setattr(ias, "MAX_ALERTS_PER_USER", 2)
    body = {"sym": "SPY", "indicator": "rsi", "condition": "above", "threshold": 70, "tf": "D"}
    assert client.post("/api/indicator-alerts", json=body).status_code == 200
    assert client.post("/api/indicator-alerts", json=body).status_code == 200
    r = client.post("/api/indicator-alerts", json=body)
    assert r.status_code == 400 and "delete one before creating another" in r.json()["detail"]
    assert _count(USER) == 2


# ═══ is_true re-fire / dedupe through the REAL 60s cycle ═════════════════════

def test_P1_12_is_true_fires_once_per_episode_and_an_unknown_bar_never_rearms(client, monkeypatch):
    """ASKED: `is_true` (a LEVEL rule) over T, U, T, F, T, run through the real
    `_run_one_cycle`. CLAIMED: one fire per armed episode (the fired log's
    fire-once); an UNKNOWN bar is skipped (`value is None: continue`) -- it is
    not "observed false", so it neither fires nor re-arms; the F re-arms, the
    next T fires again. DID: exactly 2 fires. Class: UNKNOWN / VALUE."""
    from api.services import alert_fired_log
    ud.save(USER, DEF_ID, defn())
    r = post(client, trigger_policy="is_true")
    assert r.status_code == 200, r.text
    alert_id = r.json()["id"]
    monkeypatch.setattr(ev, "_dispatch_delivery", lambda *a, **k: None)
    monkeypatch.setattr(ev, "_accrue_ledger_receipt", lambda *a, **k: None)
    closes = [99, 101, None, 101, 99, 101]
    fires_after = []
    for k in range(2, len(closes) + 1):
        prefix = seq_bars(closes[:k])
        monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                            lambda sym, tf, count=200, _p=prefix: [dict(b) for b in _p])
        ev._run_one_cycle()
        fires_after.append(len(alert_fired_log.fires_for_alert(alert_id, 50)))
    #            T   U   T   F   T
    assert fires_after == [1, 1, 1, 1, 2]
