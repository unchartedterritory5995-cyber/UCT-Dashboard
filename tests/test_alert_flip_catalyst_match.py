"""TERM-025 FLIP for `catalyst-match`: ALERT_TAXONOMY_CATALYST_MATCH_LIVE_ENABLED.

Flag OFF: the legacy catalyst-engine loops deliver, exactly as before, and the
taxonomy writes nothing. Flag ON: the taxonomy rule decides, records the fire in
`alert_fires` and delivers through `alert_taxonomy.delivery`; the legacy loop
does not run; every member gets exactly the alerts the legacy gave them (the
compare module's `legacy_only` and `new_only` both stay 0) and one alert per
event, including across a mid-day flag toggle.

Real stores on tmp paths: `catalysts.db` (the shared dedup table) and
`alert_taxonomy.db`. Delivery is captured at `deliver_alert_payload`.
"""
from __future__ import annotations

import ast
import inspect
import pathlib

import pytest

from api.services import watchlist_alert_service as wal
from api.services.alert_taxonomy import catalyst_match as cm
from api.services.alert_taxonomy import catalyst_match_compare as cmp_
from api.services.alert_taxonomy import catalyst_match_live as live
from api.services.alert_taxonomy import catalyst_match_projection as proj
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import receipts
from api.services.catalyst import engine as ce
from api.services.catalyst import store as cstore

_REPO = pathlib.Path(__file__).resolve().parents[1]
_REAL_DELIVER = wal.deliver_alert_payload   # captured before any fixture patches it
DAY = "2026-10-12"
OTHER_FLAGS = ("ALERT_TAXONOMY_REGIME_CHANGE_LIVE_ENABLED",
               "ALERT_TAXONOMY_SCAN_MEMBERSHIP_LIVE_ENABLED")


def _rows(*specs):
    return [{"ticker": t, "grade": g, "tag": "Catalyst", "catalyst_type": "FDA",
             "gap_pct": 4.2, "thesis_text": f"{t} thesis"} for t, g in specs]


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(cstore, "_DB_PATH", str(tmp_path / "catalysts.db"))
    cstore._init_db()
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    for f in (live.FLAG, *OTHER_FLAGS, "ALERT_ROUTING_RULE_ENABLED",
              "ALERT_QUEUE_CAPS_ENABLED", "ALERT_WEBHOOKS_ENABLED",
              "CATALYST_MUSTKNOW_GRADES"):
        monkeypatch.delenv(f, raising=False)
    monkeypatch.setenv("CATALYST_ALERTS_ENABLED", "1")
    monkeypatch.setenv("CATALYST_MUSTKNOW_ALERTS_ENABLED", "1")
    sent: list[dict] = []

    def _capture(**kw):
        sent.append(kw)
        return {"ok": True, "channels": {"in_app": "ok"}}
    monkeypatch.setattr(wal, "deliver_alert_payload", _capture)
    state = {"users": {}, "admins": []}
    monkeypatch.setattr(ce, "_collect_user_watchlist_tickers", lambda: state["users"])
    monkeypatch.setattr(ce, "_collect_admin_user_ids", lambda: list(state["admins"]))
    return {"sent": sent, "state": state, "mp": monkeypatch, "tmp": tmp_path}


def _reset_stores(env):
    import sqlite3
    with sqlite3.connect(cstore._DB_PATH) as c:
        c.execute("DELETE FROM catalyst_alerts_fired")
    with sqlite3.connect(at_db.DB_PATH) as c:
        try:
            c.execute("DELETE FROM alert_fires")
        except sqlite3.OperationalError:
            pass
    env["sent"].clear()


def _run(rows):
    a = ce._fire_catalyst_alerts(rows, DAY)
    b = ce._fire_mustknow_alerts(rows, DAY)
    return a + b


def _key(kw):
    """What the member receives. ⛔ Every field the legacy call passed."""
    return (kw["user_id"], kw["sym"], kw["title"], kw["message"], kw["source"],
            tuple(sorted((kw.get("extra_data") or {}).items())))


def _fires():
    import sqlite3
    c = sqlite3.connect(at_db.DB_PATH)
    try:
        return c.execute("SELECT predicate_id, trigger_type, fire_key FROM alert_fires").fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        c.close()


#: Every case the compare module's rules distinguish (catalyst_match_compare
#: docstring + its test file): intersection, grade rule without a watchlist,
#: admin guard, F-S7-5 per-rule dedup on a watched grade-A name, a ticker
#: appearing twice, an ungraded row, the env-narrowed grade set, several names
#: in one refresh, a non-watcher.
CASES = {
    "watchlist_intersection": dict(users={"u1": {"AAA", "ZZZ"}}, admins=[],
                                   rows=_rows(("AAA", "C"), ("BBB", "A"))),
    "grade_rule_without_watchlist": dict(users={}, admins=["ad1"],
                                         rows=_rows(("AAA", "A"), ("BBB", "C"))),
    "non_admin_gets_no_mustknow": dict(users={"u1": {"QQQ"}}, admins=[],
                                       rows=_rows(("AAA", "A"))),
    "watched_grade_A_gets_BOTH_rules": dict(users={"ad1": {"AAA"}}, admins=["ad1"],
                                            rows=_rows(("AAA", "A"))),
    "ticker_twice_alerts_once": dict(users={"u1": {"AAA"}}, admins=["ad1"],
                                     rows=_rows(("AAA", "A"), ("aaa", "A"))),
    "ungraded_row": dict(users={"u1": {"AAA"}}, admins=["ad1"],
                         rows=_rows(("AAA", None))),
    "three_names_one_refresh": dict(users={"u1": {"AAA", "BBB", "CCC"}, "u2": {"BBB"}},
                                    admins=["ad1"],
                                    rows=_rows(("AAA", "A"), ("BBB", "B"), ("CCC", "C"))),
}


def _arm(env, case):
    env["state"]["users"] = {u: set(t) for u, t in case["users"].items()}
    env["state"]["admins"] = list(case["admins"])


@pytest.mark.parametrize("grades", [None, "A"])
@pytest.mark.parametrize("name", sorted(CASES))
def test_flag_on_delivers_EXACTLY_what_the_legacy_delivered(env, name, grades):
    """legacy_only == 0 AND new_only == 0, per member, per event, per word."""
    case = CASES[name]
    if grades:
        env["mp"].setenv("CATALYST_MUSTKNOW_GRADES", grades)
    _arm(env, case)
    n_legacy = _run(case["rows"])
    legacy = sorted(_key(k) for k in env["sent"])
    assert _fires() == [], "flag OFF wrote alert_fires: the legacy path is not untouched"

    _reset_stores(env)
    env["mp"].setenv(live.FLAG, "1")
    n_live = _run(case["rows"])
    taxonomy = sorted(_key(k) for k in env["sent"])

    assert taxonomy == legacy, (name, "legacy_only", set(legacy) - set(taxonomy),
                                "new_only", set(taxonomy) - set(legacy))
    assert n_live == n_legacy
    # every delivered alert is a recorded taxonomy fire
    assert len(_fires()) == len(taxonomy)
    assert all(t == cm.TYPE_ID for _p, t, _k in _fires())


def test_the_legacy_severity_default_is_warning_and_the_flip_sends_warning(env):
    sig = inspect.signature(_REAL_DELIVER)
    assert sig.parameters["severity"].default == "warning"
    _arm(env, CASES["watchlist_intersection"])
    env["mp"].setenv(live.FLAG, "1")
    _run(CASES["watchlist_intersection"]["rows"])
    assert env["sent"] and all(k["severity"] == "warning" for k in env["sent"])


def test_flag_off_is_the_legacy_path_and_the_live_module_is_never_called(env):
    def _boom(*a, **k):
        raise AssertionError("the live module ran with the flag OFF")
    env["mp"].setattr(live, "fire_watchlist", _boom)
    env["mp"].setattr(live, "fire_mustknow", _boom)
    _arm(env, CASES["watched_grade_A_gets_BOTH_rules"])
    assert _run(CASES["watched_grade_A_gets_BOTH_rules"]["rows"]) == 2
    assert sorted(k["source"] for k in env["sent"]) == ["catalyst_alert", "catalyst_mustknow"]
    # no extra key reached the member's payload (byte-identical call)
    for k in env["sent"]:
        assert set(k) == {"user_id", "sym", "title", "message", "source", "extra_data"}
    assert _fires() == []


def test_flag_on_the_legacy_loop_STANDS_DOWN(env):
    """The legacy loop's own delivery import is never reached: the engine
    returns the taxonomy's count before it."""
    calls = []
    real = live.fire_watchlist
    env["mp"].setattr(live, "fire_watchlist", lambda r, d: calls.append(d) or real(r, d))
    env["mp"].setenv(live.FLAG, "1")
    _arm(env, CASES["watchlist_intersection"])
    _run(CASES["watchlist_intersection"]["rows"])
    assert calls == [DAY]
    assert all(p.startswith(live.LIVE_PREFIX) for p, _t, _k in _fires())


def test_one_alert_per_event_on_a_second_refresh(env):
    env["mp"].setenv(live.FLAG, "1")
    case = CASES["three_names_one_refresh"]
    _arm(env, case)
    first = _run(case["rows"])
    assert first > 0
    assert _run(case["rows"]) == 0
    assert len(env["sent"]) == first


@pytest.mark.parametrize("first_on", [False, True])
def test_a_mid_day_toggle_never_double_alerts(env, first_on):
    """The dedup claim is the legacy's own table, shared by both paths."""
    case = CASES["watched_grade_A_gets_BOTH_rules"]
    _arm(env, case)
    if first_on:
        env["mp"].setenv(live.FLAG, "1")
    assert _run(case["rows"]) == 2
    if first_on:
        env["mp"].delenv(live.FLAG)
    else:
        env["mp"].setenv(live.FLAG, "1")
    assert _run(case["rows"]) == 0
    assert len(env["sent"]) == 2


def test_the_legacy_gates_still_bind_with_the_flag_on(env):
    """new_only == 0 by construction: the taxonomy is asked only where the
    legacy gate let the legacy rule run."""
    env["mp"].setenv(live.FLAG, "1")
    env["mp"].setenv("CATALYST_ALERTS_ENABLED", "0")
    env["mp"].setenv("CATALYST_MUSTKNOW_ALERTS_ENABLED", "0")
    _arm(env, CASES["watched_grade_A_gets_BOTH_rules"])
    assert _run(CASES["watched_grade_A_gets_BOTH_rules"]["rows"]) == 0
    assert env["sent"] == [] and _fires() == []


def test_the_compare_module_reads_ZERO_disagreement_on_what_the_flip_sent(env, tmp_path):
    """Drive the shadow comparison over the same inputs: the rule the flip
    delivers and the legacy mirror agree, so the readiness counters stay 0."""
    case = CASES["three_names_one_refresh"]
    dbp = str(tmp_path / "cmp.db")
    at_db.init_db(db_path=dbp)
    for user, mine in case["users"].items():
        for rule in cm.MATCH_RULES:
            t = cmp_.observe(f"t:{user}:{rule}", proj._params(rule), DAY,
                             displayed=case["rows"], member_tickers=mine,
                             is_admin=user in case["admins"], db_path=dbp)
            assert t[cmp_.NEW_ONLY] == 0 and t[cmp_.LEGACY_ONLY] == 0


def test_the_grade_rule_agrees_with_the_legacy_on_every_stored_grade(env):
    """`synthesize._normalize_grade` writes only A/B/C/None; on that whole
    domain (and lower-case input) `would_fire` and the legacy expression agree."""
    from api.services.catalyst import synthesize
    stored = {synthesize._normalize_grade(g) for g in ("A", "b", "c", "", None, "A+", "x")}
    assert stored <= {"A", "B", "C", None}
    for grades in ("A", "A,B", "A,B,C"):
        env["mp"].setenv("CATALYST_MUSTKNOW_GRADES", grades)
        rows = _rows(*[(f"T{i}", g) for i, g in enumerate(sorted(stored, key=str))])
        dark = cm.would_fire(proj._params(cm.RULE_GRADE), displayed=rows, is_admin=True)
        legacy = cmp_.legacy_would_fire(proj._params(cm.RULE_GRADE), displayed=rows,
                                        is_admin=True)
        assert dark == legacy


def test_the_flags_are_INDEPENDENT(env):
    """The other two types' flags ON leave this type on its legacy path."""
    for f in OTHER_FLAGS:
        env["mp"].setenv(f, "1")
    assert live.is_enabled() is False
    _arm(env, CASES["watchlist_intersection"])
    _run(CASES["watchlist_intersection"]["rows"])
    assert env["sent"] and _fires() == []


def test_the_flag_is_read_per_call_and_defaults_off(env):
    assert live.is_enabled() is False
    env["mp"].setenv(live.FLAG, "1")
    assert live.is_enabled() is True
    env["mp"].setenv(live.FLAG, "0")
    assert live.is_enabled() is False
    src = (_REPO / "api/services/alert_taxonomy/catalyst_match_live.py").read_text(encoding="utf-8")
    assert 'os.environ.get(FLAG, "0")' in src


def test_the_named_call_site_exists_and_is_gated(env):
    """CARD 10 / §2a item 3: what calls the live evaluator, and the rail that
    fails if that wire is cut."""
    code = ast.unparse(ast.parse((_REPO / "api/services/catalyst/engine.py")
                                 .read_text(encoding="utf-8")))
    assert "live.fire_watchlist(top_n, market_date)" in code
    assert "live.fire_mustknow(displayed, market_date)" in code
    assert "catalyst_match_live" in code and "_live.is_enabled()" in code
