"""RS screens unit U13: the daily joined-and-left message in the rating job's chain (api/main.py).

The message describes the membership record taken AFTER the rating post-pass moved the
ratings onto the settled session, so it has no cron of its own: `_run_rs_post_pass` calls
it straight after `membership.rerecord_all`, and it therefore comes through every door
that pass does (the 04:15 rating job, the 04:40 lists job, the rating catch-up).

The first half stubs the pass, the re-record, the lists job and the alert run and reads
only their ORDER and what the alert run is handed. The last test stubs only the pass and
the scan: the real re-record and the real alert run go through two doors in one night and
one message comes out.
"""
from __future__ import annotations

import time

import pytest

import api.main as m
from api.services import rs_lists
from api.services.screener import (distribution, membership, rs_history as rh,
                                   rs_market_state, rs_post_pass as pp, rs_screen_alerts as A,
                                   snapshot_db)
from tests.test_rs_history_catchup import OK_RECEIPT, OLDER, TARGET

REAL_RERECORD_ALL = membership.rerecord_all
REAL_RUN_NIGHTLY = A.run_nightly
LEADERS = "starter_rs_leaders"
PASS_OK = {"ok": True, "enabled": True, "rewritten": True, "session": TARGET,
           "rating_session": TARGET, "ranked": 3, "finished_at": 1_763_000_000.5}


@pytest.fixture(autouse=True)
def chain(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    monkeypatch.setenv(A.FLAG, "1")
    monkeypatch.setattr(m, "_rs_history_target_session", lambda now=None: TARGET)
    from api.services import chart_health_alerts
    monkeypatch.setattr(chart_health_alerts, "emit", lambda *a, **k: True)
    events, handed = [], []
    state = {"rating": dict(OK_RECEIPT), "pass": dict(PASS_OK), "alerts": None}

    def _alerts(**kw):
        events.append("alerts")
        handed.append(kw)
        if isinstance(state["alerts"], Exception):
            raise state["alerts"]
        return {"enabled": True, "sent": 0}

    monkeypatch.setattr(rh, "nightly_job", lambda *a, **k: events.append("rating") or dict(state["rating"]))
    monkeypatch.setattr(pp, "run", lambda *a, **k: events.append(f"pass:{k.get('source')}") or dict(state["pass"]))
    monkeypatch.setattr(membership, "rerecord_all", lambda: events.append("membership") or {"recorded": 3})
    monkeypatch.setattr(rs_lists, "nightly_job", lambda: events.append("lists") or {"enabled": False})
    monkeypatch.setattr(A, "run_nightly", _alerts)
    monkeypatch.setattr(distribution, "invalidate", lambda: None)
    monkeypatch.setattr(distribution, "distributions", lambda: {})
    A._done.clear()
    return {"events": events, "state": state, "handed": handed}


def test_the_message_runs_after_membership_is_recorded_again_on_every_door(chain):
    m._run_rs_history()
    assert chain["events"] == ["rating", "pass:rating", "membership", "alerts"]
    chain["events"].clear()
    m._run_rs_lists()
    assert chain["events"] == ["pass:lists", "membership", "alerts", "lists"]
    chain["events"].clear()
    rh.store_rows(OLDER, {"AAA": {"ibd": 50, "bars": 260}}, {})
    m._run_rs_history_catchup("retry")
    assert chain["events"] == ["rating", "pass:lists", "membership", "alerts", "lists"]


def test_it_is_handed_the_rated_session_and_the_pass_s_finish_time(chain):
    m._run_rs_post_pass("rating")
    assert chain["handed"] == [{"session": TARGET, "recorded_after": PASS_OK["finished_at"]}]


def test_flag_off_the_chain_is_what_it_was(chain, monkeypatch):
    monkeypatch.delenv(A.FLAG)
    m._run_rs_history()
    m._run_rs_lists()
    assert chain["events"] == ["rating", "pass:rating", "membership", "pass:lists", "membership", "lists"]
    assert chain["handed"] == []


def test_a_pass_that_did_not_move_the_ratings_is_followed_by_no_message(chain):
    """The session is not stored yet (every 03:00 build's own pass, a rating job that has
    not run): nothing was recorded again, so there is no new record to describe."""
    chain["state"]["pass"] = {**PASS_OK, "rewritten": False, "reason": "session_not_stored"}
    m._run_rs_lists()
    assert chain["events"] == ["pass:lists", "lists"]


def test_a_message_run_that_raises_never_stops_the_lists_or_the_rating_job(chain):
    chain["state"]["alerts"] = RuntimeError("boom")
    m._run_rs_lists()
    m._run_rs_history()
    assert chain["events"] == ["pass:lists", "membership", "alerts", "lists",
                               "rating", "pass:rating", "membership", "alerts"]


def test_the_message_door_itself_never_raises(chain, capsys):
    """Whoever calls it: a failure is one log line, never an exception."""
    chain["state"]["alerts"] = RuntimeError("boom")
    assert m._run_rs_screen_alerts("rating", dict(PASS_OK)) is None
    assert "rs screen alerts (rating) error: RuntimeError: boom" in capsys.readouterr().out


def test_two_doors_in_one_night_send_one_message_for_real(chain, monkeypatch):
    """Only the pass and the scan are scripted. The 04:15 rating chain and the 04:40 lists
    job both record membership again and both reach the real alert run: one message."""
    from api.services import watchlist_alert_service as was
    from api.services.alert_taxonomy import routing_rule
    from api.services.signature import registry_defs
    monkeypatch.setenv(membership.FLAG, "1")
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setattr(membership, "rerecord_all", REAL_RERECORD_ALL)
    monkeypatch.setattr(A, "run_nightly", REAL_RUN_NIGHTLY)
    monkeypatch.setattr(A, "_member", lambda uid: {"id": uid, "role": "member"})
    monkeypatch.setattr(rs_market_state, "served", lambda: None)
    monkeypatch.setattr(pp, "run", lambda *a, **k: {**PASS_OK, "finished_at": time.time()})
    sent = []
    monkeypatch.setattr(was, "deliver_alert_payload", lambda **kw: sent.append(kw))
    monkeypatch.setattr(routing_rule, "effective", lambda uid: None)
    snapshot_db.init_db()
    membership._CURRENT.clear()
    tonight = {"list": ["AAA", "BBB", "CCC"]}
    leaders = membership.spec_hash(A.screens()[LEADERS]["spec"])
    monkeypatch.setattr(membership, "_tickers_now", lambda spec, limit: (
        (list(tonight["list"]), len(tonight["list"])) if membership.spec_hash(spec) == leaders else ([], 0)))
    A.subscribe("u1", LEADERS)
    # the previous session's record, then tonight's 03:00 record on the OLD ratings
    monkeypatch.setattr(membership, "_build_identity", lambda: ("2026-11-11", OLDER))
    membership.record_all()
    monkeypatch.setattr(membership, "_build_identity", lambda: ("2026-11-12", TARGET))
    membership.record_all()
    tonight["list"] = ["AAA", "BBB", "DDD"]                  # what the new ratings select

    m._run_rs_post_pass("rating")                            # 04:15
    m._run_rs_lists()                                        # 04:40
    m._run_rs_lists()                                        # a catch-up that stored
    assert len(sent) == 1, [s["title"] for s in sent]
    assert sent[0]["title"] == "UCT RS Leaders: 1 joined, 1 left"
    assert sent[0]["message"] == ("UCT RS Leaders, at its standard settings: 1 joined (DDD), "
                                  "1 left (CCC). Ratings as of Nov 11, compared with Nov 10.")
