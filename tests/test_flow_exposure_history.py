"""FT-054: the intraday per-strike exposure store on flow-worker (api/flow_exposure_history.py).

Every path is a pytest tmp_path: the store, and a stand-in flow.db carrying the columns the
consumer writes. Nothing here reaches C:\\data (the repo-root conftest guard would fail the run).
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import flow_exposure_history as feh

ET = ZoneInfo("America/New_York")
T0 = datetime(2026, 10, 9, 10, 0, 0, tzinfo=ET)   # a Friday, 10:00 ET
MDY = "10/9/2026"


def _flow_db(path):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE flow (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, CreatedDate TEXT,"
              " CreatedTime TEXT, Symbol TEXT, Volume TEXT, Price TEXT, Side TEXT, CallPut TEXT,"
              " Strike TEXT, Spot TEXT, ExpirationDate TEXT, Dte TEXT)")
    c.commit()
    c.close()


def _print(path, *, sym="TST", cp="C", strike="100", vol="10", price="2.50", side="A",
           spot="100", dte="7", date=MDY, source="stocks", exp="10/16/2026"):
    c = sqlite3.connect(path)
    c.execute("INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, Volume, Price, Side,"
              " CallPut, Strike, Spot, ExpirationDate, Dte) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
              (source, date, "10:00:00 AM", sym, vol, price, side, cp, strike, spot, exp, dte))
    c.commit()
    c.close()


@pytest.fixture
def paths(tmp_path, monkeypatch):
    flow = str(tmp_path / "flow.db")
    store = str(tmp_path / "store" / "flow_exposure_history.db")
    _flow_db(flow)
    monkeypatch.setenv("FLOW_DB_PATH", flow)
    monkeypatch.setenv("FLOW_EXPOSURE_HISTORY_DB_PATH", store)
    monkeypatch.setenv("FLOW_EXPOSURE_HISTORY_SETTLE_SEC", "120")
    monkeypatch.setenv("FLOW_EXPOSURE_HISTORY_INTERVAL_MIN", "5")
    return flow, store


def _rows(store, sql, *a):
    c = sqlite3.connect(store)
    try:
        return c.execute(sql, a).fetchall()
    finally:
        c.close()


# ── the maths ──────────────────────────────────────────────────────────────────

def test_a_print_at_the_ask_makes_dealers_short_gamma_and_at_the_bid_long():
    buy = feh.aggregate_rows([dict(Symbol="TST", CallPut="C", Strike="100", Volume="10", Price="2.50",
                                   Side="A", Spot="100", Dte="7", CreatedTime="10:00:00 AM",
                                   ExpirationDate="10/16/2026")])[("TST", 100.0)]
    sell = feh.aggregate_rows([dict(Symbol="TST", CallPut="C", Strike="100", Volume="10", Price="2.50",
                                    Side="B", Spot="100", Dte="7", CreatedTime="10:00:00 AM",
                                    ExpirationDate="10/16/2026")])[("TST", 100.0)]
    assert buy[0] == 10 and sell[0] == -10
    assert buy[2] < 0 < sell[2]                       # dealer on the other side of the customer
    assert buy[2] == pytest.approx(-sell[2])


def test_a_print_without_the_input_is_counted_never_zeroed():
    out = feh.aggregate_rows([
        dict(Symbol="TST", CallPut="P", Strike="95", Volume="5", Price="1", Side="", Spot="100", Dte="7",
             CreatedTime="10:00:00 AM", ExpirationDate="x"),            # no side
        dict(Symbol="TST", CallPut="P", Strike="95", Volume="5", Price="1", Side="BB", Spot="0", Dte="7",
             CreatedTime="10:00:00 AM", ExpirationDate="x"),            # no spot -> no IV
    ])[("TST", 95.0)]
    assert out[1] == -5          # the sided print still moves the put net
    assert out[2] == 0.0         # but contributes no gamma it could not compute
    assert (out[3], out[4], out[5]) == (2, 1, 1)


# ── the recorder: settling, durability, prune ─────────────────────────────────

def test_rows_are_read_only_once_settled_and_a_snapshot_lands_on_the_interval(paths):
    flow, store = paths
    _print(flow)
    r = feh.Recorder()
    first = r.tick(now=T0)
    assert first["ingested"] == 0          # the row is not yet 120 s old
    second = r.tick(now=T0 + timedelta(seconds=130))
    assert second["ingested"] == 1
    assert r.state[("TST", 100.0)][0] == 10
    third = r.tick(now=T0 + timedelta(minutes=6))
    assert third["wrote"] == 1
    assert _rows(store, "SELECT call_net FROM strike_exposure WHERE symbol='TST'") == [(10,)]


def test_other_days_and_unknown_sources_are_ignored(paths):
    flow, _ = paths
    _print(flow, date="10/8/2026")
    _print(flow, source="crypto")
    r = feh.Recorder()
    r.tick(now=T0)
    assert r.tick(now=T0 + timedelta(seconds=130))["ingested"] == 0
    assert r.state == {}


def test_only_changed_strikes_are_written_and_a_restart_resumes_from_the_store(paths):
    flow, store = paths
    _print(flow, strike="100")
    _print(flow, strike="105", side="B", vol="3")
    r = feh.Recorder()
    r.tick(now=T0)
    r.tick(now=T0 + timedelta(seconds=130))
    assert r.tick(now=T0 + timedelta(minutes=5, seconds=10))["wrote"] == 2
    _print(flow, strike="100", vol="4")
    r.tick(now=T0 + timedelta(minutes=6))
    r.tick(now=T0 + timedelta(minutes=8, seconds=10))
    assert r.tick(now=T0 + timedelta(minutes=10, seconds=20))["wrote"] == 1   # only 100 moved

    again = feh.Recorder()          # a flow-worker restart
    again.load("2026-10-09")
    assert again.state[("TST", 100.0)][0] == 14
    assert again.state[("TST", 105.0)][0] == -3
    assert again.last_id == 3       # carries on after the last row it folded in
    again.tick(now=T0 + timedelta(minutes=12))
    again.tick(now=T0 + timedelta(minutes=14, seconds=10))
    assert again.state[("TST", 100.0)][0] == 14      # nothing double-counted


def test_prune_keeps_today_and_one_session(paths):
    _, store = paths
    with feh._store(store) as c:
        for s in ("2026-10-06", "2026-10-07", "2026-10-08"):
            c.execute("INSERT INTO snapshots VALUES (?,?,?,?)", (s, 1, 0, 1))
            c.execute("INSERT INTO strike_exposure VALUES (?,?,?,?,?,?,?,?,?,?)",
                      (s, 1, "TST", 100.0, 1, 0, 0.0, 1, 0, 0))
    feh.Recorder().load("2026-10-09")
    kept = sorted(r[0] for r in _rows(store, "SELECT DISTINCT session FROM strike_exposure"))
    assert kept == ["2026-10-07", "2026-10-08"]       # today has no rows yet; 10-06 is gone
    with feh._store(store) as c:
        c.execute("INSERT INTO snapshots VALUES (?,?,?,?)", ("2026-10-09", 2, 0, 0))
        assert feh.prune(c) > 0
    assert sorted(r[0] for r in _rows(store, "SELECT DISTINCT session FROM snapshots")) == [
        "2026-10-08", "2026-10-09"]


def test_the_session_ceiling_stops_writing_and_says_so(paths, monkeypatch):
    flow, store = paths
    monkeypatch.setattr(feh, "MAX_ROWS_PER_SESSION", 1)
    _print(flow, strike="100")
    _print(flow, strike="105")
    r = feh.Recorder()
    r.tick(now=T0)
    r.tick(now=T0 + timedelta(seconds=130))
    out = r.tick(now=T0 + timedelta(minutes=6))
    assert out["capped"] is True and out["wrote"] == 0
    assert _rows(store, "SELECT COUNT(*) FROM strike_exposure") == [(0,)]


def test_run_tick_does_nothing_while_the_switch_is_off(paths, monkeypatch):
    monkeypatch.delenv("FLOW_EXPOSURE_HISTORY_ENABLED", raising=False)
    monkeypatch.setattr(feh, "_RECORDER", None)
    assert feh.run_tick() is None
    assert feh._RECORDER is None


# ── the read ───────────────────────────────────────────────────────────────────

def _seed_series(store):
    t = int(T0.timestamp())
    with feh._store(store) as c:
        for i, (ts, net) in enumerate([(t, 5), (t + 1800, 8), (t + 3600, 12)]):
            c.execute("INSERT INTO snapshots VALUES (?,?,?,?)", ("2026-10-09", ts, i, 1))
            c.execute("INSERT INTO strike_exposure VALUES (?,?,?,?,?,?,?,?,?,?)",
                      ("2026-10-09", ts, "TST", 100.0, net, 0, -net * 1000.0, net, 0, 0))
        c.execute("INSERT INTO strike_exposure VALUES (?,?,?,?,?,?,?,?,?,?)",
                  ("2026-10-09", t + 3600, "TST", 110.0, 0, -2, 500.0, 1, 0, 0))
    return t


def test_overlay_reads_each_strike_as_it_stood_n_minutes_ago(paths):
    _, store = paths
    _seed_series(store)
    out = feh.read_overlay("tst", [30, 60])
    now, m30, m60 = out["series"]
    assert now["strikes"]["100.0"]["call_net"] == 12
    assert m30["strikes"]["100.0"]["call_net"] == 8
    assert m60["strikes"]["100.0"]["call_net"] == 5
    assert "110.0" in now["strikes"] and "110.0" not in m60["strikes"]
    assert out["strikes"] == [100.0, 110.0]
    assert out["label"] == "computed" and out["method"]


def test_an_ago_older_than_the_history_says_so(paths):
    _, store = paths
    _seed_series(store)
    out = feh.read_overlay("TST", [120])
    assert out["series"][1]["as_of"] is None
    assert "History starts at" in out["series"][1]["note"]


# ── the route ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client(paths, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    app = FastAPI()
    app.include_router(feh.router)
    return TestClient(app)


AUTH = {"Authorization": "Bearer s3cret"}


def test_route_is_404_before_identity_while_switched_off(client, monkeypatch):
    monkeypatch.delenv("FLOW_EXPOSURE_HISTORY_ENABLED", raising=False)
    assert client.get("/api/flow/exposure-history/TST").status_code == 404


def test_route_serves_the_overlay_when_armed(client, paths, monkeypatch):
    monkeypatch.setenv("FLOW_EXPOSURE_HISTORY_ENABLED", "1")
    _seed_series(paths[1])
    r = client.get("/api/flow/exposure-history/TST?ago=30,60", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert [s["minutes_ago"] for s in body["series"]] == [0, 30, 60]


def test_route_refuses_a_free_vouched_user_and_bad_input(client, monkeypatch):
    monkeypatch.setenv("FLOW_EXPOSURE_HISTORY_ENABLED", "1")
    monkeypatch.setenv("FLOW_PROXY_TRUST", "1")
    from api.flow_admin_auth import proxy_sign_user
    who = json.dumps({"id": "u1", "email": "x@y.z", "role": "member", "plan": "free"},
                     separators=(",", ":"), sort_keys=True)
    r = client.get("/api/flow/exposure-history/TST",
                   headers={"x-uct-proxy-user": who, "x-uct-proxy-sig": proxy_sign_user(who)})
    assert r.status_code == 402
    assert client.get("/api/flow/exposure-history/TST?ago=0", headers=AUTH).status_code == 422
    assert client.get("/api/flow/exposure-history/T$T", headers=AUTH).status_code == 422


def test_the_route_and_the_tick_are_mounted_on_flow_worker():
    """The wiring: an unmounted router or an unscheduled tick is the built-and-unreachable class."""
    import ast
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1]
    mount = (root / "api" / "flow_router_mount.py").read_text(encoding="utf-8")
    assert '"api.flow_exposure_history"' in mount and '"api.live_chain_stream"' in mount
    tree = ast.parse((root / "api" / "flow_worker_main.py").read_text(encoding="utf-8"))
    ids = {kw.value.value for n in ast.walk(tree) if isinstance(n, ast.Call)
           for kw in n.keywords if kw.arg == "id" and isinstance(kw.value, ast.Constant)}
    assert "flow_exposure_history" in ids
    assert "oi_massive_capture" in ids          # control: the probe sees a sibling job
