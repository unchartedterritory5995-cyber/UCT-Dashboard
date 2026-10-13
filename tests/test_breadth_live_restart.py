"""2026-10-13 incident: at 10:20 ET the Agent answered US/Nasdaq % above 50-day with Oct 9
finalized ("no current reading") — 16 min after a web deploy, the live engine was still inside
its post-restart blackout (600 s boot grace + ~2 min cold build), and the fallback skipped Oct 12's
provisional close. Synthetic values only."""
from __future__ import annotations

from datetime import date, datetime

import numpy as np
import pytest

from api.services import breadth_current as bc
from api.services import breadth_live_universes as blu
from api.services import session_calendar as sc

ET = bc._ET


# ── a restart restores the built state instead of a 12-minute blackout ──────────────────────

def _state(L=1760054400):
    return {"L": L, "dates": [L - 86400, L], "union": ["AAA", "BBB"],
            "members": {"us": ["AAA", "BBB"], "nyse": ["AAA"], "nasdaq": ["BBB"]},
            "idx": {"us": np.array([0, 1]), "nyse": np.array([0]), "nasdaq": np.array([1])},
            "closes": np.ones((2, 2)), "vols": np.ones((2, 2)), "built_at": 0.0,
            "levels_today": {"x": np.zeros(2)}, "timings": {}}


@pytest.fixture
def state_file(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_LIVE_UNIVERSES_STATE_PATH", str(tmp_path / "state.pkl"))
    blu._state.clear()
    yield
    blu._state.clear()


def test_a_saved_state_round_trips_for_its_session(state_file):
    st = _state()
    blu._save_state(st)
    got = blu._restore_state(st["L"])
    assert got is not None and got["L"] == st["L"] and got["members"] == st["members"]
    assert np.array_equal(got["closes"], st["closes"])


@pytest.mark.parametrize("why", ["other_session", "old_version", "too_old", "corrupt", "absent"])
def test_an_invalid_saved_state_is_never_restored(state_file, monkeypatch, why):
    import pickle, time
    st = _state()
    if why == "absent":
        assert blu._restore_state(st["L"]) is None
        return
    blu._save_state(st)
    path = blu._state_path()
    if why == "other_session":
        assert blu._restore_state(st["L"] + 86400) is None
        return
    rec = pickle.load(open(path, "rb"))
    if why == "old_version":
        rec["version"] = blu.STATE_VERSION - 1
    elif why == "too_old":
        rec["saved_at"] = time.time() - blu.STATE_MAX_AGE_S - 60
    if why == "corrupt":
        open(path, "wb").write(b"not a pickle")
    else:
        pickle.dump(rec, open(path, "wb"))
    assert blu._restore_state(st["L"]) is None


def test_a_fresh_process_restores_during_the_boot_grace_and_never_builds(state_file, monkeypatch):
    from api.services import breadth_live as bl
    st = _state()
    blu._save_state(st)
    monkeypatch.setattr(bl, "_bars_conn", lambda: None)
    monkeypatch.setattr(bl, "last_completed_session", lambda conn=None, now=None: st["L"])
    monkeypatch.setattr(blu, "_process_uptime", lambda: 30.0)          # 30 s after a deploy
    built = []
    monkeypatch.setattr(blu, "_build_state", lambda L: built.append(L))
    try:
        blu.compute()
    except Exception:
        pass                       # the synthetic state is too thin to finish a payload; irrelevant
    assert built == [] and blu._state["value"]["L"] == st["L"]           # restored, not rebuilt


def test_without_a_saved_state_the_boot_grace_still_protects_boot(state_file, monkeypatch):
    from api.services import breadth_live as bl
    monkeypatch.setattr(bl, "_bars_conn", lambda: None)
    monkeypatch.setattr(bl, "last_completed_session", lambda conn=None, now=None: 1760054400)
    monkeypatch.setattr(blu, "_process_uptime", lambda: 30.0)
    built = []
    monkeypatch.setattr(blu, "_build_state", lambda L: built.append(L))
    assert "boot grace" in blu.compute()["reason"] and built == []


def test_a_new_session_invalidates_the_restore(state_file, monkeypatch):
    """Cache invalidation: a state saved for yesterday's L is not used once L advances."""
    from api.services import breadth_live as bl
    st = _state()
    blu._save_state(st)
    monkeypatch.setattr(bl, "_bars_conn", lambda: None)
    monkeypatch.setattr(bl, "last_completed_session", lambda conn=None, now=None: st["L"] + 86400)
    monkeypatch.setattr(blu, "_process_uptime", lambda: 9999.0)
    built = []
    monkeypatch.setattr(blu, "_build_state", lambda L: built.append(L) or None)
    blu.compute()
    assert built == [st["L"] + 86400]


# ── present-tense selection (Agent contract == chart rule) ──────────────────────────────────

def _payload(data_as_of, carried=False):
    rows = [{"date": "2026-10-12", "final": True, "metrics": {"pct_above_50sma": 2.0}},
            {"date": "2026-10-13", "final": False, "metrics": {"pct_above_50sma": 3.0}}]
    p = {"ok": True, "as_of": data_as_of, "data_as_of": data_as_of,
         "universes": {u: {"ok": True, "population_drift": 0.01, "rows": rows}
                       for u in ("us", "nyse", "nasdaq")}}
    if carried:
        p.update(carried=True, carried_reason="boot grace")
    return p


FINAL = {"2026-10-08": 1.0, "2026-10-09": 1.5}


@pytest.mark.parametrize("u", ["us", "nasdaq", "nyse"])
def test_current_session_intraday_a50_for_every_universe(u):
    now = datetime(2026, 10, 13, 10, 22, 30, tzinfo=ET)
    r = bc.choose(u, "pct_above_50sma", now, _payload("2026-10-13T10:21:17-04:00"), FINAL)
    assert r["current"] and r["status"] == "intraday" and r["session"] == "2026-10-13"
    assert r["label"] == "Intraday · 10:21 AM ET" and r["observed_at"].startswith("2026-10-13T10:21:17")


@pytest.mark.parametrize("u", ["us", "nasdaq", "nyse"])
def test_the_incident_falls_back_to_oct_12_not_oct_9(u):
    """10:20 ET, carried pre-restart payload: today's row is stale, so not current — but the
    newest COMPLETED session is Oct 12's provisional close, not Oct 9's finalized value."""
    now = datetime(2026, 10, 13, 10, 20, 44, tzinfo=ET)
    r = bc.choose(u, "pct_above_50sma", now, _payload("2026-10-13T10:03:00-04:00", carried=True), FINAL)
    assert not r["current"]
    lc = r["latest_completed"]
    assert lc["session"] == "2026-10-12" and lc["status"] == "provisional"
    assert lc["label"] == "Provisional close · Oct 12"


def test_no_live_payload_at_all_still_names_the_newest_completed_session_it_has():
    now = datetime(2026, 10, 13, 10, 15, tzinfo=ET)
    r = bc.choose("us", "pct_above_50sma", now, {"ok": False, "reason": "boot grace"}, FINAL)
    assert not r["current"] and "boot grace" in r["stale_reason"]
    assert r["latest_completed"]["session"] == "2026-10-09"           # truly the newest it has
    assert r["latest_completed"]["status"] == "finalized"


def test_intraday_to_finalized_transition():
    """Once Oct 12 finalizes (after Oct 13's row lands), finalized Oct 12 is the newest completed."""
    now = datetime(2026, 10, 13, 18, 0, tzinfo=ET)
    fin = dict(FINAL, **{"2026-10-12": 2.1})
    p = _payload("2026-10-13T16:00:40-04:00")
    r = bc.choose("us", "pct_above_50sma", now, p, fin)
    assert r["status"] == "provisional" and r["session"] == "2026-10-13" and r["current"]
    assert r["latest_completed"]["session"] == "2026-10-13"


def test_previous_trading_days_finalized_reading_before_the_open():
    now = datetime(2026, 10, 13, 8, 0, tzinfo=ET)
    p = {"ok": True, "data_as_of": None, "universes": {"us": {"ok": True, "population_drift": 0.0,
         "rows": [{"date": "2026-10-12", "final": True, "metrics": {"pct_above_50sma": 2.0}}]}}}
    r = bc.choose("us", "pct_above_50sma", now, p, FINAL)
    assert r["session"] == "2026-10-12" and r["status"] == "provisional" and r["current"]


def test_columbus_day_2026_is_a_trading_session():
    """Oct 12, 2026 (Columbus Day, a federal holiday) is a regular NYSE session; Thanksgiving is not."""
    assert sc.is_trading_day(date(2026, 10, 12))
    assert sc.close_time(date(2026, 10, 12)).hour == 16
    assert not sc.is_trading_day(date(2026, 11, 26))


def test_historical_fallback_is_disclosed_when_live_truly_unavailable():
    now = datetime(2026, 10, 13, 11, 0, tzinfo=ET)
    r = bc.choose("nasdaq", "pct_above_50sma", now, {"ok": False, "reason": "frame unavailable"}, FINAL)
    assert r["status"] == "finalized" and not r["current"]
    assert "frame unavailable" in r["stale_reason"] and "not 2026-10-13" in r["stale_reason"]


def test_chart_and_agent_agree_at_the_incident_moment(monkeypatch):
    p = _payload("2026-10-13T10:03:00-04:00", carried=True)
    now = datetime(2026, 10, 13, 10, 20, 44, tzinfo=ET)
    monkeypatch.setattr(blu, "serving", lambda: True)
    monkeypatch.setattr(blu, "payload", lambda cached_only=True: p)
    monkeypatch.setattr(blu, "_intraday_path", lambda *a: None)
    st = {}
    body = [{"t": "2026-10-09", "o": 1, "h": 1, "l": 1, "c": 1.5, "v": 0}]
    out = blu.append_library_bars(body, "us", "pct_above_50sma", state_out=st, now=now)
    r = bc.choose("us", "pct_above_50sma", now, p, FINAL)
    assert st["live"] == "withheld" and not r["current"]                 # neither calls it live
    assert out[-1]["t"] == "2026-10-12" == r["latest_completed"]["session"]   # both end at Oct 12
