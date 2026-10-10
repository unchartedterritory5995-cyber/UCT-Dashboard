"""TERM-042 — the server-computed EOD breadth row (`api/services/breadth_eod_source.py`).

Four things are railed here, each with a case that must be seen to fail:

1. FLAG-OFF PARITY. `BREADTH_EOD_SOURCE` unset (or any unknown value) is today's
   source: no thread, no compute, no store, and the push route stores exactly what
   the collector sent.
2. THE PARITY RAIL. `grade_row` grades with the live reconciliation's own grader
   (`breadth_live.grade`, the `_ACCURACY` tiers), and over a RECORDED fixture of real
   numbers (`tests/fixtures/breadth_eod_source/parity_proxy_2026-08.json`) it names
   exactly the metrics that failed on each session.
3. THE DRILL INVARIANT. Every `*_list` a server row writes comes from the mask that
   produced its count — the list length IS the count.
4. SERVER MODE'S BOUNDS. Nothing before `BREADTH_EOD_SERVER_FROM` is rewritten; a
   late collector push is merged UNDER the server's keys; a server row's list is never
   read back as the next session's universe.

Everything runs over a synthetic bars.db and a temp breadth_monitor.db. No network.
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from api.services import breadth_eod_source as eod
from api.services import breadth_live as bl
from api.services import breadth_monitor as bm

FIXTURE = Path(__file__).parent / "fixtures" / "breadth_eod_source" / "parity_proxy_2026-08.json"
_ET = ZoneInfo("America/New_York")
N_TICKERS = 150


def _weekdays(end: date, n: int) -> list:
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out)


class _NoCache:
    def get(self, *a, **k): return None
    def set(self, *a, **k): pass
    def delete_prefix(self, *a, **k): pass
    def invalidate(self, *a, **k): pass


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A temp breadth store, a temp shadow store and a synthetic bars.db whose last
    session (2026-09-25) is priced for 142 of 150 names (coverage 0.947 < 0.95)
    unless `full=True` is asked for via `env.rebuild(full=True)`."""
    for k in ("BREADTH_EOD_SOURCE", "BREADTH_EOD_SERVER_FROM", "BREADTH_DIVIDEND_BASIS",
              "BREADTH_EOD_UNIVERSE"):
        monkeypatch.delenv(k, raising=False)
    # The server-built universe needs the provider's grouped frame and the reference
    # map (network). Off here by default: these cases rail the collector-list path;
    # the server-universe cases below install their own list.
    monkeypatch.setattr(eod, "server_universe_for",
                        lambda d: ([], "server universe unavailable: not in tests"))
    # The extras reach Cboe, yfinance and CNN (network) — off here; railed in the
    # extras cases below and in tests/test_breadth_eod_extras.py.
    monkeypatch.setattr(eod, "extras_for", lambda d, t, c=None: {})
    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "bm.db"))
    monkeypatch.setenv("BREADTH_EOD_SHADOW_DB", str(tmp_path / "shadow.db"))
    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())
    bm.init_db()

    days = _weekdays(date(2026, 9, 25), 300)
    tickers = [f"T{i:03d}" for i in range(N_TICKERS)]
    bars_path = tmp_path / "bars.db"

    def build(full: bool):
        if bars_path.exists():
            bars_path.unlink()
        c = sqlite3.connect(bars_path)
        c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, c REAL, v REAL)")
        rng = np.random.default_rng(7)
        rows = []
        for sym in tickers + ["SPY", "QQQ"]:
            px = 50 + rng.random() * 100
            for j, d in enumerate(days):
                px *= 1 + rng.normal(0.0005, 0.02)
                last = j == len(days) - 1
                if last and not full and sym in tickers[:8]:
                    continue                    # 8 names unpriced on the last session
                rows.append((sym, "D", bl._ts_int(d), round(px, 4),
                             float(1e6 * (1 + rng.random()))))
        c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?)", rows)
        c.execute("CREATE INDEX ix ON ohlcv(ticker, tf, ts)")
        c.commit()
        c.close()

    build(full=True)
    monkeypatch.setattr(bl, "_bars_conn", lambda: sqlite3.connect(bars_path))

    prior, last = days[-2].isoformat(), days[-1].isoformat()
    # The collector's row for the PRIOR session: its universe list is what the
    # server measures the last session over.
    bm.store_snapshot(prior, {"universe_count": N_TICKERS,
                              "universe_list": [{"t": t} for t in tickers],
                              "cnn_fear_greed": 40, "vix": 17.2})

    ns = type("Env", (), {})()
    ns.tmp, ns.days, ns.tickers, ns.prior, ns.last = tmp_path, days, tickers, prior, last
    ns.rebuild = build
    return ns


def _collector_row_from(result: dict, **overrides) -> dict:
    """A collector row for the session that AGREES with the server on every owned
    metric, plus the NOT_LIVE keys only a collector push carries."""
    row = {k: result["metrics"][k] for k in eod.owned_keys(result["metrics"])}
    row.update({"cnn_fear_greed": 55, "vix": 16.1, "aaii_spread": -4.0, "new_ath": 12,
                "universe_list": [{"t": t} for t in result["members"]["universe_count"]]})
    row.update(overrides)
    return row


# ── 1. flag-off parity ──────────────────────────────────────────────────────

@pytest.mark.parametrize("value", [None, "", "COLLECTOR ", "servr", "on", "1"])
def test_unset_or_unknown_is_todays_source(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("BREADTH_EOD_SOURCE", raising=False)
    else:
        monkeypatch.setenv("BREADTH_EOD_SOURCE", value)
    assert eod.mode() == "collector"
    assert not eod.server_writes("2026-09-25")


@pytest.mark.parametrize("value", ["collector", "shadow", "server", "  Shadow "])
def test_the_three_modes_read_per_call(monkeypatch, value):
    monkeypatch.setenv("BREADTH_EOD_SOURCE", value)
    assert eod.mode() == value.strip().lower()


def test_the_default_in_the_mode_table_is_collector():
    """The literal the ledger (and `feature_flag_index.mode_flags`) reads."""
    default, allowed = eod.BREADTH_EOD_MODE_FLAGS["BREADTH_EOD_SOURCE"]
    assert default == "collector" and set(allowed) == {"collector", "shadow", "server"}


def test_collector_mode_starts_no_thread_and_computes_nothing(env, monkeypatch):
    monkeypatch.setattr(eod, "compute", lambda *a, **k: pytest.fail("computed in collector mode"))
    monkeypatch.setattr(eod, "_status", {"started": False, "last_tick": None, "last_results": []})
    before = {t.name for t in threading.enumerate()}
    assert eod.start_job() is False
    assert "breadth_eod_source" not in {t.name for t in threading.enumerate()} - before
    assert eod.tick() == {"mode": "collector", "ran": False}
    assert not (env.tmp / "shadow.db").exists()


def test_on_push_is_identity_outside_server_mode(env, monkeypatch):
    payload = {"universe_count": 10, "cnn_fear_greed": 40}
    for m in (None, "shadow"):
        if m:
            monkeypatch.setenv("BREADTH_EOD_SOURCE", m)
        out, source = eod.on_push(env.last, payload)
        assert out is payload and source == "collector"


class _Req:
    def __init__(self, body):
        self._body, self.query_params = body, {}

    async def json(self):
        return self._body


def test_the_push_route_stores_exactly_what_the_collector_sent_when_off(env, monkeypatch):
    """The REAL route, flag unset: the blob stored is byte-identical to the payload
    and the numeric projection is labelled `collector`, as before TERM-042."""
    from api.routers import breadth_monitor as router
    monkeypatch.setattr(router, "_check_auth", lambda r: None)
    monkeypatch.setattr(router, "invalidate_analogues_cache", lambda: None)
    import api.routers.bars as bars_router
    monkeypatch.setattr(bars_router, "warm_bars_async", lambda *a, **k: None)
    metrics = {"universe_count": 2600, "stage2_count": 500, "up_4pct_today": 40,
               "new_52w_highs": 30, "cnn_fear_greed": 51,
               "universe_list": [{"t": "AAA"}]}
    res = asyncio.run(router.push_breadth_snapshot(_Req({"date": env.last, "metrics": metrics})))
    assert res["status"] == "ok"
    with sqlite3.connect(bm._db_path()) as c:
        blob, = c.execute("SELECT metrics FROM breadth_snapshots WHERE date=?", (env.last,)).fetchone()
        src, = c.execute("SELECT source FROM breadth_snapshot_numeric WHERE date=?", (env.last,)).fetchone()
    assert blob == json.dumps(metrics) and src == "collector"


def test_universe_is_unchanged_when_no_row_is_server_written(env):
    tickers, d = bl.universe()
    assert d == env.prior and tickers == sorted(env.tickers)


# ── 2. the computation and the drill invariant ───────────────────────────────

def test_compute_measures_the_newest_collector_universe_strictly_before(env):
    res = eod.compute(env.last)
    assert res["ok"] and res["universe_from"] == env.prior
    assert res["universe_size"] == N_TICKERS and res["coverage"] == 1.0 and res["coverage_ok"]


def test_every_server_drill_list_has_exactly_its_counts_names(env):
    """⛔ A drill list MUST come from the mask that produced the count."""
    res = eod.compute(env.last)
    row = eod.build_server_row(res, None)
    checked = 0
    for k in eod.owned_keys(res["metrics"]):
        if k not in bl.DRILLABLE:
            continue
        items = row[eod.list_key(k)]
        names = [i["t"] for i in items]
        assert len(names) == row[k], k
        assert len(set(names)) == len(names) and set(names) <= set(env.tickers), k
        checked += 1
    assert checked >= 15                         # non-vacuity: most drillables owned
    assert "universe_list" in row and "stage2_list" in row   # the alias spellings


def test_the_server_row_publishes_no_live_only_key_and_no_new_ath(env):
    res = eod.compute(env.last)
    owned = eod.owned_keys(res["metrics"])
    assert "new_ath" not in owned
    assert not set(eod.LIVE_ONLY) & set(owned)
    assert {"pct_above_200sma", "stage2_count", "adv_decline", "spy_close"} <= set(owned)


# ── 3. the parity rail ───────────────────────────────────────────────────────

def test_the_parity_grader_is_the_reconciliation_grader(monkeypatch):
    seen = []
    real = bl.grade

    def spy(v, s, k):
        seen.append(k)
        return real(v, s, k)
    monkeypatch.setattr(bl, "grade", spy)
    eod.grade_row({"stage2_count": 10, "pct_above_50sma": 50.0},
                  {"stage2_count": 10, "pct_above_50sma": 50.0})
    assert sorted(seen) == ["pct_above_50sma", "stage2_count"]


def test_grade_row_names_the_failure_and_the_tier(env):
    res = eod.compute(env.last)
    m = res["metrics"]
    stored = _collector_row_from(res, stage2_count=m["stage2_count"] + 50,
                                 pct_above_50sma=m["pct_above_50sma"] + 0.5)
    rep = eod.grade_row(m, stored)
    assert rep["failed"] == ["stage2_count"]      # +0.5 point is inside the 1.0 tier
    assert rep["fields"]["stage2_count"]["accuracy"] == "close"
    assert "cnn_fear_greed" in rep["collector_only"] and "new_ath" in rep["collector_only"]


def test_the_recorded_parity_fixture_is_graded_exactly_as_recorded():
    """⭐ THE PARITY RAIL over real numbers: bars.db (Massive) vs the collector's own
    yfinance frame for ten sessions, two dividend-basis arms. A grader that loosens
    or tightens any tier, or an ownership change, moves a named metric."""
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    n = 0
    for arm, sessions in data["arms"].items():
        for s in sessions:
            rep = eod.grade_row(s["server"], s["collector"], [])
            assert sorted(rep["failed"]) == s["expected_failed"], (arm, s["date"])
            assert sorted(rep["passed"]) == s["expected_passed"], (arm, s["date"])
            assert rep["breadth_score"] == s["expected_breadth_score"], (arm, s["date"])
            n += 1
    assert n == 20
    # The recorded finding the owner decides on: basis OFF fails the long-lookback
    # family on EVERY session; basis ON clears it on the clean sessions.
    off = {s["date"]: set(s["expected_failed"]) for s in data["arms"]["off"]}
    on = {s["date"]: set(s["expected_failed"]) for s in data["arms"]["on"]}
    assert all("pct_above_200sma" in f for f in off.values())
    assert all(len(on[d]) <= 2 for d in ("2026-08-24", "2026-08-25", "2026-08-26",
                                          "2026-08-27", "2026-08-28"))


def test_a_healed_row_is_never_counted_as_a_pass(env):
    """INST-7: a self-heal rewrote the row FROM bars.db — agreement is circular."""
    res = eod.compute(env.last)
    bm.store_snapshot(env.last, _collector_row_from(res, _healed=True))
    rec = eod.grade_and_record(env.last, bm.raw_row(env.last), res)
    assert rec["status"] == "not_comparable"
    assert eod.parity_report()["sessions_graded"] == 0


def test_low_coverage_is_recorded_not_graded(env):
    env.rebuild(full=False)
    res = eod.compute(env.last)
    assert res["coverage"] == pytest.approx(142 / 150, abs=1e-4) and not res["coverage_ok"]
    bm.store_snapshot(env.last, _collector_row_from(res))
    assert eod.grade_and_record(env.last, bm.raw_row(env.last), res)["status"] == "insufficient_coverage"


def test_shadow_writes_only_its_own_store_and_regrades_a_changed_row(env, monkeypatch):
    monkeypatch.setenv("BREADTH_EOD_SOURCE", "shadow")
    res = eod.compute(env.last)
    bm.store_snapshot(env.last, _collector_row_from(res))
    with sqlite3.connect(bm._db_path()) as c:
        before = c.execute("SELECT date, metrics FROM breadth_snapshots ORDER BY date").fetchall()
    first = eod.shadow_date(env.last)
    assert first["status"] == "graded" and first["failed"] == []
    assert eod.shadow_date(env.last)["status"] == "current"          # nothing changed
    with sqlite3.connect(bm._db_path()) as c:
        assert c.execute("SELECT date, metrics FROM breadth_snapshots ORDER BY date").fetchall() == before
    bm.store_snapshot(env.last, _collector_row_from(res, stage2_count=res["metrics"]["stage2_count"] + 80))
    again = eod.shadow_date(env.last)                                  # a re-push re-grades
    assert again["status"] == "graded" and again["failed"] == ["stage2_count"]
    rep = eod.parity_report()
    assert rep["metrics_with_failures"] == ["stage2_count"]
    assert rep["per_metric"]["stage2_count"]["failed_on"] == [env.last]


# ── 4. server mode ──────────────────────────────────────────────────────────

def test_server_mode_without_a_from_date_writes_nothing(env, monkeypatch):
    monkeypatch.setenv("BREADTH_EOD_SOURCE", "server")
    assert eod.server_from() is None and not eod.server_writes(env.last)
    assert eod.write_server_row(env.last)["status"] == "not_armed_for_date"
    assert bm.raw_row(env.last) is None


def test_server_mode_never_rewrites_a_session_before_from(env, monkeypatch):
    monkeypatch.setenv("BREADTH_EOD_SOURCE", "server")
    monkeypatch.setenv("BREADTH_EOD_SERVER_FROM", "2026-09-28")
    assert not eod.server_writes(env.last)
    assert eod.write_server_row(env.last)["status"] == "not_armed_for_date"


def test_server_row_replaces_owned_keys_and_keeps_the_collectors_others(env, monkeypatch):
    monkeypatch.setenv("BREADTH_EOD_SOURCE", "server")
    monkeypatch.setenv("BREADTH_EOD_SERVER_FROM", env.last)
    res = eod.compute(env.last)
    collector = _collector_row_from(res, stage2_count=res["metrics"]["stage2_count"] + 60,
                                    stage2_list=[{"t": "STALE"}], _healed=True)
    bm.store_snapshot(env.last, collector)
    out = eod.write_server_row(env.last)
    assert out["status"] == "written"
    row = bm.raw_row(env.last)
    assert row["_source"] == "server" and "_healed" not in row
    assert row["stage2_count"] == res["metrics"]["stage2_count"]          # server owns it
    assert len(row["stage2_list"]) == row["stage2_count"]                 # its list too
    assert row["cnn_fear_greed"] == 55 and row["new_ath"] == 12           # collector keeps these
    with sqlite3.connect(bm._db_path()) as c:
        assert c.execute("SELECT source FROM breadth_snapshot_numeric WHERE date=?",
                         (env.last,)).fetchone()[0] == "server"
    # a healed collector row is not comparable, and it is recorded as such
    assert eod.shadow_records()[0]["status"] == "not_comparable"
    assert eod.write_server_row(env.last)["status"] == "current"          # idempotent


def test_a_late_collector_push_merges_under_the_server_keys_and_is_graded(env, monkeypatch):
    monkeypatch.setenv("BREADTH_EOD_SOURCE", "server")
    monkeypatch.setenv("BREADTH_EOD_SERVER_FROM", env.last)
    assert eod.write_server_row(env.last)["status"] == "written"
    server_row = bm.raw_row(env.last)
    push = _collector_row_from(eod.compute(env.last),
                               stage2_count=server_row["stage2_count"] + 70,
                               stage2_list=[{"t": "COLL"}], cnn_fear_greed=61)
    merged, source = eod.on_push(env.last, push)
    assert source == "server"
    assert merged["stage2_count"] == server_row["stage2_count"]
    assert merged["stage2_list"] == server_row["stage2_list"]
    assert merged["cnn_fear_greed"] == 61 and merged["_source"] == "server"
    rec = eod.shadow_records()[0]
    assert rec["status"] == "graded" and rec["report"]["failed"] == ["stage2_count"]


def test_a_server_rows_list_is_never_read_back_as_the_universe(env, monkeypatch):
    """The shrink guard: the server's universe_list is the PRICED subset."""
    monkeypatch.setenv("BREADTH_EOD_SOURCE", "server")
    monkeypatch.setenv("BREADTH_EOD_SERVER_FROM", env.last)
    env.rebuild(full=False)
    monkeypatch.setattr(bl, "MIN_LIVE_COVERAGE", 0.9)          # let the thin session write
    assert eod.write_server_row(env.last)["status"] == "written"
    assert len(bm.raw_row(env.last)["universe_list"]) == 142
    tickers, d = bl.universe()
    assert d == env.prior and len(tickers) == N_TICKERS
    nxt = (date.fromisoformat(env.last) + timedelta(days=3)).isoformat()
    assert eod._collector_universe_before(nxt) == (sorted(env.tickers), env.prior)



# ── 5. the job ──────────────────────────────────────────────────────────────

def test_todays_session_waits_for_the_evening(env):
    last = date.fromisoformat(env.last)
    at = lambda h: datetime(last.year, last.month, last.day, h, 0, tzinfo=_ET)
    assert env.last not in eod.candidate_sessions(at(17))
    assert eod.candidate_sessions(at(21))[0] == env.last


def test_a_tick_computes_at_most_its_budget(env, monkeypatch):
    monkeypatch.setenv("BREADTH_EOD_SOURCE", "shadow")
    calls = []
    monkeypatch.setattr(eod, "shadow_date",
                        lambda d: calls.append(("c", d)) or {"date": d, "computed": True})
    # (2026-10-10) the server-universe run shares the same budget
    monkeypatch.setattr(eod, "shadow_server_universe",
                        lambda d: calls.append(("s", d)) or {"date": d, "computed": True})
    last = date.fromisoformat(env.last)
    out = eod.tick(datetime(last.year, last.month, last.day, 22, 0, tzinfo=_ET))
    assert out["ran"] and len(calls) == eod._MAX_PER_TICK
    assert calls[0][0] == "c" and calls[1] == ("s", calls[0][1])


def test_the_status_route_needs_the_push_secret(env, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import breadth_monitor as router
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    app = FastAPI()
    app.include_router(router.router)
    c = TestClient(app)
    assert c.get("/api/breadth-monitor/eod-source").status_code == 401
    r = c.get("/api/breadth-monitor/eod-source", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200 and r.json()["mode"] == "collector"
    assert r.json()["parity"]["sessions_graded"] == 0


def test_the_admin_status_route_serves_admins_only(env, monkeypatch):
    """The admin twin of the status route: an admin SESSION reads the parity report;
    a member, or nobody, is refused. It never accepts the worker bearer instead."""
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient
    from api.routers import breadth_monitor as router
    from api.middleware import auth_middleware

    app = FastAPI()
    app.include_router(router.router)
    who = {"user": None}

    def fake_user():
        if who["user"] is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return who["user"]

    app.dependency_overrides[auth_middleware.get_current_user] = fake_user
    c = TestClient(app)
    assert c.get("/api/admin/breadth-eod-source").status_code == 401
    who["user"] = {"id": "m", "role": "member"}
    assert c.get("/api/admin/breadth-eod-source").status_code == 403
    who["user"] = {"id": "a", "role": "admin"}
    r = c.get("/api/admin/breadth-eod-source")
    assert r.status_code == 200 and r.json()["mode"] == "collector"
    assert "parity" in r.json()
# ── 5. the switch bar (decided 2026-10-07, owner-delegated) ───────────────────

def _rec(day, status="graded", passes=True, fields=True):
    report = {"fields": ({"stage2_count": {"pass": passes}, "pct_above_50sma": {"pass": True}}
                         if fields else {})}
    return {"date": day, "status": status, "reason": None, "report": report}


def test_the_switch_bar_is_ten_consecutive_clean_sessions():
    assert eod.SWITCH_CLEAN_SESSIONS == 10
    recs = [_rec(f"2026-10-{d:02d}") for d in range(20, 10, -1)]   # 10, newest first
    s = eod.switch_readiness(recs)
    assert s["ready"] is True and s["consecutive_clean"] == 10 and s["broken_by"] is None
    assert "BREADTH_EOD_SOURCE=server" in s["sentence"]
    nine = eod.switch_readiness(recs[:9])
    assert nine["ready"] is False and nine["consecutive_clean"] == 9
    assert nine["sentence"] == "Not yet: 9 of 10 consecutive clean sessions."


def test_a_failed_or_ungraded_session_BREAKS_the_run_it_is_never_skipped():
    clean = [_rec(f"2026-10-{d:02d}") for d in range(30, 18, -1)]   # 12 clean
    failed = clean[:3] + [_rec("2026-10-27", passes=False)] + clean[3:]
    s = eod.switch_readiness(failed)
    assert s["ready"] is False and s["consecutive_clean"] == 3
    assert s["broken_by"]["date"] == "2026-10-27" and s["broken_by"]["reason"] == "a metric failed"
    gap = clean[:2] + [_rec("2026-10-28", status="insufficient_coverage")] + clean[2:]
    g = eod.switch_readiness(gap)
    assert g["consecutive_clean"] == 2 and g["broken_by"]["status"] == "insufficient_coverage"
    # a graded session that graded NOTHING proved nothing
    empty = [_rec("2026-10-31", fields=False)] + clean
    assert eod.switch_readiness(empty)["consecutive_clean"] == 0


def test_the_parity_report_carries_the_switch_reading(env, monkeypatch):
    monkeypatch.setattr(eod, "shadow_records", lambda limit=60, table=None: [_rec("2026-10-02")])
    rep = eod.parity_report()
    assert rep["switch"]["required_consecutive_clean"] == 10
    assert rep["switch"]["consecutive_clean"] == 1 and rep["switch"]["ready"] is False


# -- (2026-10-10) the SERVER-built universe: the run that retires the PC --

def test_the_server_universe_run_grades_and_compares_the_lists(env, monkeypatch):
    res = eod.compute(env.last)
    bm.store_snapshot(env.last, _collector_row_from(res))
    server_list = list(env.tickers[:140]) + ["NEWCO"]
    monkeypatch.setattr(eod, "server_universe_for", lambda d: (server_list, "server:x"))
    out = eod.shadow_server_universe(env.last)
    assert out["computed"] and out["run"] == "server_universe"
    rec = eod.shadow_records(5, eod.TABLE_SERVER_UNIVERSE)[0]
    assert rec["universe_from"] == "server:x" and rec["universe_size"] == 141
    cmp_ = rec["report"]["universe_compare"]
    assert cmp_["both"] == 140 and cmp_["only_server"] == ["NEWCO"]
    assert cmp_["only_collector_n"] == len(res["members"]["universe_count"]) - 140
    # its own table: the collector-universe run is untouched
    assert eod.shadow_records(5) == []
    # current until the stored row changes
    assert eod.shadow_server_universe(env.last)["status"] == "current"
    rep = eod.parity_report(60, eod.TABLE_SERVER_UNIVERSE)
    assert rep["universe_compare"][0]["date"] == env.last


def test_an_unbuildable_server_universe_is_recorded_not_graded(env):
    res = eod.compute(env.last)
    bm.store_snapshot(env.last, _collector_row_from(res))
    out = eod.shadow_server_universe(env.last)          # fixture: unavailable
    assert out["status"] == "unavailable" and "not in tests" in out["reason"]
    rec = eod.shadow_records(5, eod.TABLE_SERVER_UNIVERSE)[0]
    assert rec["status"] == "unavailable"


def test_server_mode_measures_over_the_server_universe_first(env, monkeypatch):
    monkeypatch.setenv("BREADTH_EOD_SOURCE", "server")
    monkeypatch.setenv("BREADTH_EOD_SERVER_FROM", env.last)
    monkeypatch.setattr(eod, "server_universe_for",
                        lambda d: (list(env.tickers), "server:2026-09-24"))
    assert eod.write_server_row(env.last)["status"] == "written"
    detail = bm.raw_row(env.last)["_source_detail"]
    assert detail["universe_from"] == "server:2026-09-24"


def test_server_mode_falls_back_to_the_collector_list(env, monkeypatch):
    monkeypatch.setenv("BREADTH_EOD_SOURCE", "server")
    monkeypatch.setenv("BREADTH_EOD_SERVER_FROM", env.last)
    assert eod.write_server_row(env.last)["status"] == "written"   # fixture: unavailable
    assert bm.raw_row(env.last)["_source_detail"]["universe_from"] == env.prior


def test_the_universe_switch_can_pin_the_collector_list(env, monkeypatch):
    monkeypatch.setenv("BREADTH_EOD_SOURCE", "server")
    monkeypatch.setenv("BREADTH_EOD_SERVER_FROM", env.last)
    monkeypatch.setenv("BREADTH_EOD_UNIVERSE", "collector")
    called = []
    monkeypatch.setattr(eod, "server_universe_for",
                        lambda d: called.append(d) or (list(env.tickers), "server:x"))
    assert eod.write_server_row(env.last)["status"] == "written"
    assert called == [] and bm.raw_row(env.last)["_source_detail"]["universe_from"] == env.prior


def test_the_status_route_carries_both_parity_runs(env, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import breadth_monitor as router
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    app = FastAPI()
    app.include_router(router.router)
    r = TestClient(app).get("/api/breadth-monitor/eod-source",
                            headers={"Authorization": "Bearer s3cret"})
    body = r.json()
    assert "parity_server_universe" in body
    assert body["parity_server_universe"]["universe_compare"] == []

# -- (2026-10-10) the collector's other keys, produced on the server --

def test_extras_ride_the_server_row_and_are_graded(env, monkeypatch):
    monkeypatch.setattr(eod, "extras_for", lambda d, t, c=None: {
        "vix": 17.2, "cnn_fear_greed": 44.0, "uct_exposure": 72.5,
        "new_ath": 9, "universe_count": -1, "_extras_errors": {"x": "y"}})
    res = eod.compute(env.last)
    m = res["metrics"]
    assert m["vix"] == 17.2 and m["uct_exposure"] == 72.5 and m["new_ath"] == 9
    assert m["universe_count"] != -1                     # a price metric is never overridden
    owned = eod.owned_keys(m)
    assert {"vix", "cnn_fear_greed", "uct_exposure", "new_ath"} <= set(owned)
    assert "_extras_errors" not in owned
    stored = _collector_row_from(res, vix=17.21, cnn_fear_greed=55, uct_exposure=72.5,
                                 new_ath=9)
    rep = eod.grade_row(m, stored, [])
    assert rep["fields"]["vix"]["pass"] and rep["fields"]["uct_exposure"]["pass"]
    assert rep["fields"]["cnn_fear_greed"]["pass"] is False      # 44 vs 55
    assert "cnn_fear_greed" in rep["failed"]
    assert rep["fields"]["vix"]["accuracy"] == "extras"


def test_a_grader_change_regrades_a_current_session(env, monkeypatch):
    res = eod.compute(env.last)
    bm.store_snapshot(env.last, _collector_row_from(res))
    assert eod.shadow_date(env.last)["computed"]
    assert eod.shadow_date(env.last)["status"] == "current"
    monkeypatch.setattr(eod, "GRADER_VERSION", eod.GRADER_VERSION + 1)
    assert eod.shadow_date(env.last)["computed"]
