"""TERM-025 FLIP for `scan-membership-change`: ALERT_TAXONOMY_SCAN_MEMBERSHIP_LIVE_ENABLED.

Flag OFF: `screen_alerts.run_nightly` delivers exactly as before and the
taxonomy writes nothing. Flag ON: `run_nightly` stays the driver but each
subscription's decision and delivery go to the taxonomy rule
(`scan_membership_change.would_fire`), recorded in `alert_fires`, delivered by
`alert_taxonomy.delivery.deliver`; the legacy delivery block does not run; every
member gets exactly what the legacy gave them, one alert per (member,
definition, session).

Real stores on tmp paths: the screener snapshot DB (scan_coverage, scan_hits,
screen_alert_subs, screen_alerts_fired) and alert_taxonomy.db.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services import user_definitions as ud
from api.services import watchlist_alert_service as wal
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import scan_membership_change as smc
from api.services.alert_taxonomy import scan_membership_change_compare as cmp_
from api.services.alert_taxonomy import scan_membership_change_live as live
from api.services.alert_taxonomy import scan_membership_change_projection as proj
from api.services.screener import scan_store as ss
from api.services.screener import screen_alerts as sa
from api.services.screener import snapshot_db as sdb

_REPO = pathlib.Path(__file__).resolve().parents[1]
TF = ss.SCAN_JOIN_TF
OTHER_FLAGS = ("ALERT_TAXONOMY_REGIME_CHANGE_LIVE_ENABLED",
               "ALERT_TAXONOMY_CATALYST_MATCH_LIVE_ENABLED")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    sdb.init_db()
    ss.init_db()
    sa._done.clear()
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    for f in (live.FLAG, *OTHER_FLAGS, "ALERT_ROUTING_RULE_ENABLED",
              "ALERT_QUEUE_CAPS_ENABLED", "ALERT_WEBHOOKS_ENABLED"):
        monkeypatch.delenv(f, raising=False)
    dangling: set = set()
    monkeypatch.setattr(ud, "get", lambda user_id, def_id, version=None: (
        None if def_id in dangling else {"definition": {"meta": {"name": f"Live {def_id}"}}}))
    sent: list = []
    monkeypatch.setattr(wal, "deliver_alert_payload",
                        lambda **kw: sent.append(kw) or {"ok": True, "channels": {"in_app": "ok"}})
    return {"mp": monkeypatch, "sent": sent, "dangling": dangling, "tmp": tmp_path}


def _sweep(def_hash, as_of, tickers):
    as_of = 20261000 + int(as_of)          # the store keys a session by its DATE
    ss.record_coverage(def_hash, TF, as_of, evaluated=100, answered=100, dropped=0,
                       not_computable=0, dropped_symbols=[])
    if tickers:
        ss.record_hits(def_hash, TF, as_of, tickers)


class _Spy:
    def __init__(self):
        self.calls = []

    def __call__(self, **kw):
        self.calls.append(kw)
        return {"ok": True}


def _key(kw):
    return (kw["user_id"], kw["sym"], kw["title"], kw["message"], kw["source"],
            repr(sorted((kw.get("extra_data") or {}).items())))


def _fires():
    import sqlite3
    c = sqlite3.connect(at_db.DB_PATH)
    try:
        return c.execute("SELECT predicate_id, trigger_type, fire_key, entity_ref "
                         "FROM alert_fires").fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        c.close()


def _reset(env):
    import sqlite3
    with sdb.connect() as conn:
        conn.execute("DELETE FROM screen_alerts_fired")
    with sqlite3.connect(at_db.DB_PATH) as c:
        try:
            c.execute("DELETE FROM alert_fires")
        except sqlite3.OperationalError:
            pass
    env["sent"].clear()


def _setup(subs, sweeps):
    for def_hash, as_of, tickers in sweeps:
        _sweep(def_hash, as_of, tickers)
    for user_id, def_hash, mode in subs:
        sa.subscribe(user_id, def_hash, f"id-{def_hash}", f"Snap {def_hash}", mode)


MANY = [f"S{i:02d}" for i in range(15)]

#: Every outcome `run_nightly` / the compare harness distinguishes: entered,
#: left, both, a mode that wants only the other direction (quiet), a quiet
#: night, a first-ever sweep (no_previous), a QUIET SESSION IN THE MIDDLE
#: (Finding B), the MAX_NAMED truncation, the MAX_PER_USER quota, a dangling
#: definition, two members on one definition.
CASES = {
    "entered": dict(subs=[("u1", "H1", "entry")],
                    sweeps=[("H1", 1, ["A", "B"]), ("H1", 2, ["A", "B", "C"])]),
    "left": dict(subs=[("u1", "H1", "exit")],
                 sweeps=[("H1", 1, ["A", "B"]), ("H1", 2, ["A"])]),
    "both": dict(subs=[("u1", "H1", "both")],
                 sweeps=[("H1", 1, ["A", "B"]), ("H1", 2, ["B", "C"])]),
    "entry_mode_sees_only_exits": dict(subs=[("u1", "H1", "entry")],
                                       sweeps=[("H1", 1, ["A", "B"]), ("H1", 2, ["A"])]),
    "quiet_night": dict(subs=[("u1", "H1", "both")],
                        sweeps=[("H1", 1, ["A"]), ("H1", 2, ["A"])]),
    "first_ever_sweep": dict(subs=[("u1", "H1", "both")], sweeps=[("H1", 1, ["A", "B"])]),
    "quiet_session_in_the_middle": dict(subs=[("u1", "H1", "both")],
                                        sweeps=[("H1", 1, ["A", "B"]), ("H1", 2, []),
                                                ("H1", 3, [])]),
    "matched_nothing_then_entries": dict(subs=[("u1", "H1", "both")],
                                         sweeps=[("H1", 1, []), ("H1", 2, ["A"])]),
    "many_names_truncated": dict(subs=[("u1", "H1", "entry")],
                                 sweeps=[("H1", 1, []), ("H1", 2, MANY)]),
    "quota_of_six": dict(subs=[("u1", f"Q{i}", "both") for i in range(8)],
                         sweeps=[x for i in range(8) for x in
                                 ((f"Q{i}", 1, ["A"]), (f"Q{i}", 2, ["B"]))]),
    "two_members_one_definition": dict(subs=[("u1", "H1", "entry"), ("u2", "H1", "exit")],
                                       sweeps=[("H1", 1, ["A", "B"]), ("H1", 2, ["B", "C"])]),
    "dangling_definition": dict(subs=[("u1", "DEAD", "both"), ("u1", "H1", "both")],
                                sweeps=[("DEAD", 1, ["A"]), ("DEAD", 2, ["B"]),
                                        ("H1", 1, ["A"]), ("H1", 2, ["B"])]),
}


def _receipt_core(r):
    return {k: r[k] for k in ("sent", "skipped_dedup", "skipped_quota",
                              "skipped_quiet", "skipped_dangling", "no_previous",
                              "compared", "errors")}


@pytest.mark.parametrize("name", sorted(CASES))
def test_flag_on_delivers_EXACTLY_what_the_legacy_delivered(env, name):
    case = CASES[name]
    if name == "dangling_definition":
        env["dangling"].add("id-DEAD")
    _setup(case["subs"], case["sweeps"])
    spy = _Spy()
    r_legacy = sa.run_nightly(deliver=spy)
    legacy = sorted(_key(k) for k in spy.calls)
    assert _fires() == []

    _reset(env)
    if name == "dangling_definition":   # the legacy run dropped it; re-arm it
        sa.subscribe("u1", "DEAD", "id-DEAD", "Snap DEAD", "both")
    env["mp"].setenv(live.FLAG, "1")
    r_live = sa.run_nightly(deliver=_Spy())
    taxonomy = sorted(_key(k) for k in env["sent"])

    assert taxonomy == legacy, (name, "legacy_only", set(legacy) - set(taxonomy),
                                "new_only", set(taxonomy) - set(legacy))
    assert _receipt_core(r_live) == _receipt_core(r_legacy)
    assert len(_fires()) == len(taxonomy)
    for pid, ttype, key, entity in _fires():
        assert ttype == smc.TYPE_ID and pid.startswith(live.LIVE_PREFIX)
    assert all(k["severity"] == "warning" for k in env["sent"])


def test_flag_off_is_byte_identical_and_never_calls_the_live_module(env):
    env["mp"].setattr(live, "deliver_one",
                      lambda **k: (_ for _ in ()).throw(AssertionError("ran")))
    _setup(*CASES["both"].values())
    spy = _Spy()
    r = sa.run_nightly(deliver=spy)
    assert r["sent"] == 1 and env["sent"] == []
    (call,) = spy.calls
    assert call == {"user_id": "u1", "sym": "C", "title": "Live id-H1: 1 in, 1 out",
                    "message": ("Overnight change in your screen — C entered Live id-H1; "
                                "A left Live id-H1."),
                    "source": "screen_alert",
                    "extra_data": {"def_hash": "H1", "as_of": 20261002,
                                   "entered": ["C"], "exited": ["A"]}}
    assert _fires() == []


def test_one_alert_per_session_on_a_rerun(env):
    env["mp"].setenv(live.FLAG, "1")
    _setup(*CASES["two_members_one_definition"].values())
    first = sa.run_nightly()
    again = sa.run_nightly()
    assert first["sent"] == 2 and again["sent"] == 0 and again["skipped_dedup"] == 2
    assert len(env["sent"]) == 2


@pytest.mark.parametrize("first_on", [False, True])
def test_a_toggle_between_two_runs_of_one_night_never_double_alerts(env, first_on):
    _setup(*CASES["entered"].values())
    if first_on:
        env["mp"].setenv(live.FLAG, "1")
        sa.run_nightly()
        env["mp"].delenv(live.FLAG)
        spy = _Spy()
        r = sa.run_nightly(deliver=spy)
        assert spy.calls == [] and r["skipped_dedup"] == 1
    else:
        spy = _Spy()
        sa.run_nightly(deliver=spy)
        env["mp"].setenv(live.FLAG, "1")
        r = sa.run_nightly()
        assert env["sent"] == [] and r["skipped_dedup"] == 1


def test_a_failed_delivery_is_retried_on_a_rerun_like_the_legacy(env):
    env["mp"].setenv(live.FLAG, "1")
    _setup(*CASES["entered"].values())
    calls = {"n": 0}

    def _flaky(**kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("smtp down")
        env["sent"].append(kw)
        return {"ok": True, "channels": {"in_app": "ok"}}
    env["mp"].setattr(wal, "deliver_alert_payload", _flaky)
    assert sa.run_nightly()["errors"] == 1
    assert sa.run_nightly()["sent"] == 1
    assert len(env["sent"]) == 1 and len(_fires()) == 1


def test_the_compare_module_reads_ZERO_disagreement(env, tmp_path):
    dbp = str(tmp_path / "cmp.db")
    at_db.init_db(db_path=dbp)
    for name, case in CASES.items():
        sa._done.clear()
        for def_hash, as_of, tickers in case["sweeps"]:
            _sweep(f"{name}-{def_hash}", as_of, tickers)
        for user_id, def_hash, mode in case["subs"]:
            h = f"{name}-{def_hash}"
            sessions, hits = proj.sessions_and_hits(h)
            t = cmp_.observe(f"c:{name}:{user_id}:{h}",
                             proj.params_for({"def_hash": h, "mode": mode}), "2026-10-12",
                             covered_sessions=sessions, hits_by_as_of=hits,
                             already_fired=[], db_path=dbp)
            assert t[cmp_.NEW_ONLY] == 0 and t[cmp_.LEGACY_ONLY] == 0, (name, t)


def test_the_flags_are_INDEPENDENT(env):
    for f in OTHER_FLAGS:
        env["mp"].setenv(f, "1")
    assert live.is_enabled() is False
    _setup(*CASES["entered"].values())
    spy = _Spy()
    sa.run_nightly(deliver=spy)
    assert len(spy.calls) == 1 and env["sent"] == [] and _fires() == []


def test_the_flag_is_read_per_call_and_defaults_off(env):
    assert live.is_enabled() is False
    env["mp"].setenv(live.FLAG, "1")
    assert live.is_enabled() is True
    env["mp"].setenv(live.FLAG, "0")
    assert live.is_enabled() is False


def test_the_named_call_site_exists(env):
    code = ast.unparse(ast.parse((_REPO / "api/services/screener/screen_alerts.py")
                                 .read_text(encoding="utf-8")))
    assert "live.deliver_one(" in code and "_scan_membership_live()" in code
