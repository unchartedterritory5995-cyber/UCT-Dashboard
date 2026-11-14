"""RS screens unit U1, part D(b): the post-pass in the rating job's chain (api/main.py).

The 03:00 ET build ends with the pass, but the rating job for that session runs at 04:15
ET, so the pass must run AGAIN once the session is stored, and screen membership (the
record behind "New today", taken at 03:00 on the previous session's ratings) must be
recorded again on the new ones. Three doors lead there:

  * ``_run_rs_history`` (04:15): a run that stored runs the pass right away, so a rating
    job that finishes after 04:40 is still followed by one;
  * ``_run_rs_lists`` (04:40): the pass runs first, so the lists read the same ratings;
  * ``_run_rs_history_catchup``: a catch-up that stored re-runs ``_run_rs_lists``.

``rs_history.nightly_job``, ``rs_post_pass.run``, ``membership.rerecord_all`` and
``rs_lists.nightly_job`` are stubbed and only their ORDER is read; the membership rule
itself is tested against a real ``screener.db`` at the bottom.
"""
from __future__ import annotations

import json

import pytest

import api.main as m
from api.services import rs_lists
from api.services.screener import (distribution, membership, rs_history as rh,
                                   rs_post_pass as pp, snapshot_db)
from tests.test_rs_history_catchup import OK_RECEIPT, OLDER, TARGET, _register

#: The real functions, held before the fixture below replaces them on their modules.
REAL_RERECORD_ALL = membership.rerecord_all
REAL_PASS = pp.run
REAL_INVALIDATE, REAL_DISTRIBUTIONS = distribution.invalidate, distribution.distributions

PASS_OK = {"ok": True, "enabled": True, "rewritten": True, "session": TARGET,
           "rating_session": TARGET, "ranked": 3}


@pytest.fixture(autouse=True)
def chain(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    monkeypatch.setattr(m, "_rs_history_target_session", lambda now=None: TARGET)
    from api.services import chart_health_alerts
    monkeypatch.setattr(chart_health_alerts, "emit", lambda *a, **k: True)
    events = []
    state = {"rating": dict(OK_RECEIPT), "pass": dict(PASS_OK)}

    def _pass(*a, **k):
        events.append(f"pass:{k.get('source')}")
        if isinstance(state["pass"], Exception):
            raise state["pass"]
        return dict(state["pass"])

    monkeypatch.setattr(rh, "nightly_job", lambda *a, **k: events.append("rating") or dict(state["rating"]))
    monkeypatch.setattr(pp, "run", _pass)
    monkeypatch.setattr(membership, "rerecord_all", lambda: events.append("membership") or {"recorded": 3})
    monkeypatch.setattr(rs_lists, "nightly_job", lambda: events.append("lists") or {"enabled": False})
    bands = []
    monkeypatch.setattr(distribution, "invalidate", lambda: bands.append("dropped"))
    monkeypatch.setattr(distribution, "distributions", lambda: bands.append("measured") or {})
    return {"events": events, "state": state, "bands": bands}


def test_the_0415_rating_job_is_followed_by_the_pass_and_a_membership_re_record(chain):
    m._run_rs_history()
    assert chain["events"] == ["rating", "pass:rating", "membership"]
    assert chain["bands"] == ["dropped", "measured"]


def test_the_0440_lists_job_runs_the_pass_before_the_lists(chain):
    m._run_rs_lists()
    assert chain["events"] == ["pass:lists", "membership", "lists"]


def test_a_catchup_that_stored_runs_the_pass_then_the_lists(chain):
    rh.store_rows(OLDER, {"AAA": {"ibd": 50, "bars": 260}}, {})
    m._run_rs_history_catchup("retry")
    assert chain["events"] == ["rating", "pass:lists", "membership", "lists"]


def test_these_are_the_functions_the_scheduler_holds(monkeypatch):
    sched = _register(monkeypatch)
    assert sched.jobs["rs_history_nightly"][0] is m._run_rs_history
    assert sched.jobs["rs_lists_nightly"][0] is m._run_rs_lists
    assert sched.jobs["rs_history_catchup"][0] is m._run_rs_history_catchup
    assert sched.jobs["rs_history_catchup_boot"][0] is m._run_rs_history_catchup


def test_a_rating_run_that_did_not_store_is_followed_by_no_pass(chain):
    chain["state"]["rating"] = {**OK_RECEIPT, "ok": False}
    m._run_rs_history()
    assert chain["events"] == ["rating"]


def test_flag_off_the_chain_is_what_it_was(chain, monkeypatch):
    monkeypatch.delenv("RS_SCREENS_ENABLED")
    m._run_rs_history()
    m._run_rs_lists()
    assert chain["events"] == ["rating", "lists"]


def test_membership_is_re_recorded_only_when_the_pass_moved_the_ratings(chain):
    """A pass that found the session not stored yet changed no rating: the 03:00 record
    still describes the table, so nothing is recorded again."""
    chain["state"]["pass"] = {**PASS_OK, "rewritten": False, "reason": "session_not_stored"}
    m._run_rs_lists()
    assert chain["events"] == ["pass:lists", "lists"]
    assert chain["bands"] == [], "nothing moved, so the measured bands still describe the table"


def test_a_band_refresh_that_fails_does_not_cost_the_membership_record(chain, monkeypatch):
    def boom():
        raise OSError("disk")
    monkeypatch.setattr(distribution, "invalidate", boom)
    m._run_rs_lists()
    assert chain["events"] == ["pass:lists", "membership", "lists"]


def test_the_panels_measured_bands_follow_the_pass_for_real(monkeypatch):
    """Nothing stubbed but the rating job: a real table, a real pass, the real bands. The
    pass moves no row count, build stamp or date, so the cached bands keep saying the
    place column is empty unless the chain drops them."""
    monkeypatch.setattr(distribution, "invalidate", REAL_INVALIDATE)
    monkeypatch.setattr(distribution, "distributions", REAL_DISTRIBUTIONS)
    snapshot_db.init_db()
    row = {"price": 50.0, "dollar_vol_30d": 5e7, "is_etf": 0, "snapshot_date": "2026-11-12", "built_at": 1}
    snapshot_db.upsert_rows([{"ticker": "AAA", **row}, {"ticker": "BBB", **row}])
    hist = {"ibd": 90, "m12": 50, "score": 1.5, "bars": 260}
    rh.store_rows(TARGET, {"AAA": hist, "BBB": {**hist, "score": 1.4}})
    monkeypatch.setattr(pp, "run", lambda *a, **k: REAL_PASS(TARGET, source=k.get("source", "test")))
    distribution.invalidate()
    assert distribution.distributions()["columns"]["rs_rating_pos"]["non_null"] == 0
    m._run_rs_post_pass("rating")
    assert distribution.distributions()["columns"]["rs_rating_pos"]["non_null"] == 2
    distribution.invalidate()


def test_a_pass_that_raises_never_stops_the_lists_or_the_rating_job(chain):
    chain["state"]["pass"] = RuntimeError("boom")
    m._run_rs_lists()
    m._run_rs_history()
    assert chain["events"] == ["pass:lists", "lists", "rating", "pass:rating"]


# ───────────────────────── membership.rerecord_all ─────────────────────────

SPEC = {"filters": [{"key": "rs_rating_ibd", "op": "gte", "min": 90}]}


def test_rerecord_replaces_the_builds_record_and_never_creates_one(monkeypatch):
    """The nightly records membership only after a COMPLETE build (a short build's record
    would mark real names as dropped tomorrow). A re-record replaces the record the nightly
    took for the current build on the old ratings; where the nightly took none, it takes
    none either."""
    now = {"tickers": ["AAA", "OLD"]}
    monkeypatch.setattr(membership, "job_enabled", lambda: True)
    monkeypatch.setattr(membership, "_build_identity", lambda: ("2026-11-12", "2026-11-11"))
    monkeypatch.setattr(membership, "_tickers_now",
                        lambda spec, limit: (list(now["tickers"]), len(now["tickers"])))
    from api.services.screener import saved_screens
    monkeypatch.setattr(saved_screens, "starters", lambda: [{"spec": SPEC}])
    monkeypatch.setattr(saved_screens, "all_specs", lambda: [])

    def stored():
        with snapshot_db.connect() as conn:
            membership._ensure(conn)
            return [(r["snapshot_date"], json.loads(r["tickers"])) for r in conn.execute(
                "SELECT snapshot_date, tickers FROM screen_membership ORDER BY snapshot_date")]

    with snapshot_db.connect() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert REAL_RERECORD_ALL() is None, "nothing was recorded for this build: nothing to redo"
    with snapshot_db.connect() as conn:
        assert tables == {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}, "asking created a table"
    assert stored() == []
    # an earlier build has a record, this build has none (the nightly refused a short build)
    membership.record(SPEC, snapshot_date="2026-11-11", session_date="2026-11-10")
    assert REAL_RERECORD_ALL() is None
    assert stored() == [("2026-11-11", ["AAA", "OLD"])], "a record the nightly did not take was created"
    with snapshot_db.connect() as conn:
        conn.execute("DELETE FROM screen_membership")

    assert membership.record_all()["recorded"] == 1          # the 03:00 record, old ratings
    monkeypatch.setitem(membership._CURRENT, membership.spec_hash(SPEC), (9e18, {"AAA", "OLD"}))
    now["tickers"] = ["AAA", "NEW"]                          # the pass moved the ratings
    out = REAL_RERECORD_ALL()
    assert out["recorded"] == 1 and out["snapshot_date"] == "2026-11-12"
    assert stored() == [("2026-11-12", ["AAA", "NEW"])], "one row for the build, on the new ratings"
    assert membership._CURRENT == {}, "a screen's tickers remembered from before the pass were kept"

    monkeypatch.setattr(membership, "job_enabled", lambda: False)
    now["tickers"] = ["ZZZ"]
    assert REAL_RERECORD_ALL() is None and stored() == [("2026-11-12", ["AAA", "NEW"])]
