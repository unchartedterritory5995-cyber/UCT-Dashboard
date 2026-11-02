"""Chart IQ route gates and the engine's end-to-end run (api/routers/chart_iq.py, api/services/chart_iq).

Gates (read per call): CHART_IQ_ENABLED off -> 404 for everyone; on -> admins only; CHART_IQ_MEMBERS_ENABLED also on -> paid
members; a free account -> 402 with Chart IQ's own sentence. Members never receive the admin-only ``raw`` layer. The engine test
runs the REAL pipeline on a synthetic bars.db (no C:/data, no network), so the vendored package is proven importable and runnable
on the site's own data path.
"""
from __future__ import annotations

import math
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import chart_iq as R

ADMIN = {"id": "a1", "role": "admin", "plan": "pro"}
MEMBER = {"id": "m1", "role": "member", "plan": "pro"}
FREE = {"id": "f1", "role": "member", "plan": "free"}
FAKE = {"ticker": "ABC", "asof": "2026-10-30", "clean": [{"kind": "candle", "ptype": "UnR"}], "card": [["Trend", "Uptrend"]], "thesis": "t",
        "context": "", "rs": [], "candles": [], "cycle": [], "buydays": [], "gaps": [], "watches": [], "market": "", "raw": [{"kind": "hline"}]}


def client(user, monkeypatch, paid=True):
    app = FastAPI()
    app.include_router(R.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    monkeypatch.setattr(R, "is_paid_user", lambda u: paid)
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    monkeypatch.delenv("CHART_IQ_ENABLED", raising=False)
    monkeypatch.delenv("CHART_IQ_MEMBERS_ENABLED", raising=False)
    from api.services.cache import TTLCache
    monkeypatch.setattr(R, "_CACHE", TTLCache(max_size=50))
    from api.services.chart_iq import pipeline
    monkeypatch.setattr(pipeline, "analyze", lambda sym, date=None: dict(FAKE, ticker=sym))


def test_off_is_404_for_everyone(monkeypatch):
    assert client(ADMIN, monkeypatch).get("/api/chart-iq/ABC").status_code == 404
    assert client(MEMBER, monkeypatch).get("/api/chart-iq/ABC").status_code == 404


def test_on_admin_only(monkeypatch):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    r = client(ADMIN, monkeypatch).get("/api/chart-iq/ABC")
    assert r.status_code == 200 and r.json()["raw"] == FAKE["raw"]
    assert client(MEMBER, monkeypatch).get("/api/chart-iq/ABD").status_code == 404


def test_members_flag_needs_the_master_flag(monkeypatch):
    monkeypatch.setenv("CHART_IQ_MEMBERS_ENABLED", "1")
    assert client(MEMBER, monkeypatch).get("/api/chart-iq/ABC").status_code == 404


def test_members_on_and_raw_withheld(monkeypatch):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    monkeypatch.setenv("CHART_IQ_MEMBERS_ENABLED", "1")
    j = client(MEMBER, monkeypatch).get("/api/chart-iq/ABE").json()
    assert j["thesis"] == "t" and j["clean"] and "raw" not in j


def test_free_account_gets_402(monkeypatch):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    monkeypatch.setenv("CHART_IQ_MEMBERS_ENABLED", "1")
    r = client(FREE, monkeypatch, paid=False).get("/api/chart-iq/ABC")
    assert r.status_code == 402 and "Chart IQ" in r.json()["detail"]


def test_bad_input_400(monkeypatch):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    c = client(ADMIN, monkeypatch)
    assert c.get("/api/chart-iq/ab;c").status_code == 400
    assert c.get("/api/chart-iq/ABC?date=10-30-2026").status_code == 400


def _bars_db(path):
    """~420 sessions of a trending stock with pullbacks, and SPY, as the site's ohlcv table."""
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL)")
    import datetime
    d = datetime.date(2025, 3, 3); rows = []
    k = 0
    while k < 420:
        if d.weekday() < 5:
            ts = int(d.strftime("%Y%m%d"))
            for t, base, amp in (("SPY", 500.0, 0.03), ("TST", 40.0, 0.12)):
                px = base * (1 + 0.0015 * k) * (1 + amp * math.sin(k / 9.0))
                o = px * (1 - 0.004 * math.sin(k)); c_ = px
                rows.append((t, "D", ts, o, max(o, c_) * 1.012, min(o, c_) * 0.988, c_, 1e6 * (1.5 + math.sin(k / 3.0))))
            k += 1
        d += datetime.timedelta(days=1)
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows); c.commit(); c.close()
    return rows[-1][2]


def test_real_engine_runs_on_the_site_data_path(tmp_path, monkeypatch):
    last = _bars_db(str(tmp_path / "bars.db"))
    monkeypatch.setenv("CHART_IQ_BARS_DB", str(tmp_path / "bars.db"))
    monkeypatch.setenv("INDUSTRY_MAP_DB_PATH", str(tmp_path / "missing_industry.db"))
    monkeypatch.undo()                                  # drop the fake analyze installed by the autouse fixture
    monkeypatch.setenv("CHART_IQ_BARS_DB", str(tmp_path / "bars.db"))
    monkeypatch.setenv("INDUSTRY_MAP_DB_PATH", str(tmp_path / "missing_industry.db"))
    from api.services.chart_iq import pipeline
    from api.services.chart_iq.engine import _db
    monkeypatch.setattr(_db, "_TL", type(_db._TL)())     # fresh per-thread connections for this test's database
    r = pipeline.analyze("TST")
    assert "error" not in r, r
    assert r["asof"] == "%s-%s-%s" % (str(last)[:4], str(last)[4:6], str(last)[6:])
    assert isinstance(r["clean"], list) and isinstance(r["card"], list) and r["thesis"]
    assert {"Trend", "Setup"} <= {k for k, _ in r["card"]}
    # every read carries the vendored engine release, so a member's vote is tied to the engine that produced the read
    import re
    from api.services.chart_iq.engine import _version
    assert re.fullmatch(r"v\d+\.\d+[a-z]?", _version.VERSION) and r["version"] == _version.VERSION
    assert pipeline.analyze("NOPE").get("error")


def test_engine_carries_no_lab_paths():
    import pathlib
    root = pathlib.Path(R.__file__).resolve().parents[1] / "services" / "chart_iq"
    text = "".join(p.read_text(encoding="utf-8") for p in root.rglob("*.py"))
    for bad in ("C:/data", "owner_review_local", "TSDR", "similar_index", "ratings.json"):
        assert bad not in text, bad


# ── member feedback (useful / partly / noise + note) and the no-performance-numbers rule ──

@pytest.fixture
def fbdb(tmp_path, monkeypatch):
    monkeypatch.setenv("CHART_IQ_FEEDBACK_DB", str(tmp_path / "fb.db"))
    return tmp_path / "fb.db"


def test_feedback_is_gated_like_the_read(monkeypatch, fbdb):
    body = {"asof": "2026-10-30", "vote": "useful"}
    assert client(ADMIN, monkeypatch).post("/api/chart-iq/ABC/feedback", json=body).status_code == 404
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    assert client(MEMBER, monkeypatch).post("/api/chart-iq/ABC/feedback", json=body).status_code == 404
    assert client(FREE, monkeypatch, paid=False).post("/api/chart-iq/ABC/feedback", json=body).status_code == 402
    assert client(ADMIN, monkeypatch).post("/api/chart-iq/ABC/feedback", json=body).status_code == 200


def test_feedback_saves_replaces_and_comes_back_with_the_read(monkeypatch, fbdb):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    monkeypatch.setenv("CHART_IQ_MEMBERS_ENABLED", "1")
    c = client(MEMBER, monkeypatch)
    assert c.get("/api/chart-iq/ABC").json()["my_feedback"] is None
    assert c.post("/api/chart-iq/ABC/feedback", json={"asof": "2026-10-30", "vote": "noise", "note": "too many lines"}).status_code == 200
    assert c.post("/api/chart-iq/abc/feedback", json={"asof": "2026-10-30", "vote": "partly", "note": "better"}).status_code == 200
    assert c.get("/api/chart-iq/ABC").json()["my_feedback"] == {"vote": "partly", "note": "better"}
    # another member's view of the same chart does not see this vote
    assert client(dict(MEMBER, id="m2"), monkeypatch).get("/api/chart-iq/ABC").json()["my_feedback"] is None
    assert c.post("/api/chart-iq/ABC/feedback", json={"asof": "2026-10-30", "vote": "great"}).status_code == 400
    assert c.post("/api/chart-iq/ABC/feedback", json={"asof": "10/30/2026", "vote": "useful"}).status_code == 400


def test_feedback_export_is_admin_only_and_hashes_members(monkeypatch, fbdb):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    monkeypatch.setenv("CHART_IQ_MEMBERS_ENABLED", "1")
    client(MEMBER, monkeypatch).post("/api/chart-iq/ABC/feedback", json={"asof": "2026-10-30", "vote": "useful", "note": "n"})
    assert client(MEMBER, monkeypatch).get("/api/chart-iq/feedback/export").status_code == 404
    r = client(ADMIN, monkeypatch).get("/api/chart-iq/feedback/export")
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert len(rows) == 1 and rows[0]["vote"] == "useful" and rows[0]["ticker"] == "ABC"
    assert "m1" not in r.text and rows[0]["member"] and not rows[0]["is_admin"]
    nxt = r.json()["next_since"]
    assert client(ADMIN, monkeypatch).get("/api/chart-iq/feedback/export?since=%s" % nxt).json()["rows"] == []


def test_feedback_daily_cap(monkeypatch, fbdb):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    from api.services.chart_iq import feedback
    monkeypatch.setattr(feedback, "DAILY_CAP", 2)
    c = client(ADMIN, monkeypatch)
    for s in ("AAA", "BBB"):
        assert c.post("/api/chart-iq/%s/feedback" % s, json={"asof": "2026-10-30", "vote": "useful"}).status_code == 200
    assert c.post("/api/chart-iq/CCC/feedback", json={"asof": "2026-10-30", "vote": "useful"}).status_code == 429
    assert c.post("/api/chart-iq/AAA/feedback", json={"asof": "2026-10-30", "vote": "noise"}).status_code == 200   # re-vote allowed


def test_members_get_no_performance_numbers(monkeypatch, fbdb):
    from api.services.chart_iq import pipeline
    bd = [{"d": "2026-10-20", "name": "UnR", "held": True, "best": True, "run": 12.5}]
    monkeypatch.setattr(pipeline, "analyze", lambda sym, date=None: dict(FAKE, ticker=sym, buydays=bd, timing={"db_s": 1.0}))
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    monkeypatch.setenv("CHART_IQ_MEMBERS_ENABLED", "1")
    m = client(MEMBER, monkeypatch).get("/api/chart-iq/ABC").json()
    assert m["buydays"] and "run" not in m["buydays"][0]
    assert "timing" not in m and "raw" not in m                                     # admin diagnostics never reach a member
    assert client(ADMIN, monkeypatch).get("/api/chart-iq/ABC").json()["buydays"][0]["run"] == 12.5   # cache not mutated by the strip


def test_engine_follows_a_bars_db_swap(tmp_path, monkeypatch):
    """The web pod replaces bars.db wholesale and bumps bars_sqlite's epoch; the engine must reopen, not keep the old inode."""
    import os
    from api.services import bars_sqlite
    from api.services.chart_iq.engine import _db

    def make(path, close):
        c = sqlite3.connect(path)
        c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL)")
        c.execute("INSERT INTO ohlcv VALUES ('ZZZ','D',20261030,1,1,1,?,1)", (close,))
        c.commit(); c.close()

    live = tmp_path / "bars.db"
    make(str(live), 10.0)
    monkeypatch.setenv("CHART_IQ_BARS_DB", str(live))
    monkeypatch.delattr(_db._TL, "bars", raising=False)
    q = "SELECT c FROM ohlcv WHERE ticker='ZZZ'"
    assert _db.bars().execute(q).fetchone()[0] == 10.0
    new = tmp_path / "new.db"
    make(str(new), 20.0)
    # data_sync moves a new file over the path (a new inode); Windows refuses to replace an open file, so point the path at the
    # new file instead: either way only a REOPEN reads the new data, and the held connection still reads the old one
    monkeypatch.setenv("CHART_IQ_BARS_DB", str(new))
    assert _db.bars().execute(q).fetchone()[0] == 10.0    # no bump yet: the thread keeps its connection (no reopen per query)
    bars_sqlite.bump_db_epoch()
    assert _db.bars().execute(q).fetchone()[0] == 20.0


def test_on_the_site_bars_are_read_through_the_sites_own_connection(monkeypatch):
    """Without CHART_IQ_BARS_DB (production), the engine must use bars_sqlite._conn: a private mode=ro connection cost ~1 s per
    query on the web pod (2026-11-02). With it set (tests, lab parity) the private read-only connection is used."""
    import sqlite3 as _sq
    from api.services import bars_sqlite
    from api.services.chart_iq.engine import _db
    fake = _sq.connect(":memory:", check_same_thread=False)
    fake.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, c REAL)")
    fake.execute("INSERT INTO ohlcv VALUES ('SITE','D',20261030,42.0)")
    calls = []
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: calls.append(1) or fake)
    monkeypatch.delenv("CHART_IQ_BARS_DB", raising=False)
    assert _db.bars().execute("SELECT c FROM ohlcv WHERE ticker='SITE'").fetchone()[0] == 42.0
    assert calls, "the site path did not go through bars_sqlite._conn"


def test_bars_row_cache_is_exact_fresh_and_survives_a_restart(tmp_path, monkeypatch):
    """On the site, the engine's "last N daily rows up to a day" queries are cached (memory + a DATA_DIR SQLite file): the same SQL
    and parameters give the same rows without a second database read; today's rows expire after LIVE_TTL_S; a past day's after
    FINAL_TTL_S; a fresh process reads the disk copy. Tests / lab parity (CHART_IQ_BARS_DB set) never use it."""
    import sqlite3 as _sq
    from api.services import bars_sqlite
    from api.services.chart_iq.engine import _db
    fake = _sq.connect(":memory:", check_same_thread=False)
    fake.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL)")
    for d in range(20261001, 20261031):
        fake.execute("INSERT INTO ohlcv VALUES ('ABC','D',?,1,2,0.5,?,100)", (d, float(d % 100)))
    hits = []
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: hits.append(1) or fake)
    monkeypatch.delenv("CHART_IQ_BARS_DB", raising=False)
    monkeypatch.setenv("CHART_IQ_ROW_CACHE_DB", str(tmp_path / "rows.db"))
    monkeypatch.setattr(_db, "_ROWS", _db._RowCache())
    q = "SELECT ts,c FROM (SELECT ts,c FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?) ORDER BY ts"
    direct = fake.execute(q, ("ABC", 20261020, 5)).fetchall()
    a = _db.bars().execute(q, ("ABC", 20261020, 5)).fetchall()
    b = _db.bars().execute(q, ("ABC", 20261020, 5)).fetchall()
    assert a == b == direct and len(hits) == 1                     # second identical query: no database read
    assert _db.bars().execute(q, ("ABC", 20261020, 6)).fetchall() == fake.execute(q, ("ABC", 20261020, 6)).fetchall()
    assert len(hits) == 2                                          # different parameters: its own read
    # a restart: a new cache object finds the disk copy
    monkeypatch.setattr(_db, "_ROWS", _db._RowCache())
    assert _db.bars().execute(q, ("ABC", 20261020, 5)).fetchall() == direct and len(hits) == 2
    # freshness: rows ending on "today" expire after LIVE_TTL_S, a past day keeps until FINAL_TTL_S
    monkeypatch.setattr(_db, "_today_et", lambda: 20261020)
    import time as _t
    real = _t.time
    monkeypatch.setattr(_db.time, "time", lambda: real() + _db.LIVE_TTL_S + 5)
    _db.bars().execute(q, ("ABC", 20261020, 5)).fetchall()
    assert len(hits) == 3                                          # today's rows were stale: re-read
    _db.bars().execute(q, ("ABC", 20261019, 5)).fetchall(); n = len(hits)
    _db.bars().execute(q, ("ABC", 20261019, 5)).fetchall()
    assert len(hits) == n                                          # a past day is still fresh
    # tests / parity path: no cache
    monkeypatch.setattr(_db.time, "time", real)
    monkeypatch.setenv("CHART_IQ_BARS_DB", str(tmp_path / "none.db"))
    assert _db._row_key("bars", (q, ("ABC", 20261020, 5))) is None
