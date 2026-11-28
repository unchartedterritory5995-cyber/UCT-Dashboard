"""bars-api in several processes (review of #2962): a FOLLOWER never writes the store, never starts provider work,
and never reads across the leader's store replace (`api/services/bars_api_roles.py`).

H1: every swap guard (`_WRITE_LOCK`, `DB_SWAP_LOCK`, write tracking) is per process, so a follower commit between
    the leader's TRUNCATE checkpoint and its `os.replace` leaves WAL frames beside the new file (the 2026-11-13
    "malformed" class). Rails: a real follower PROCESS cannot write (guard + query_only), and a follower PROCESS
    reading and trying to write in a loop while the leader replaces the file leaves a sound new store that the
    follower then reads, at the new file's floor.
M1: the caps and single-flight maps exist once, in the leader (a follower's claim raises `LeaderOnly`).
    The route hands such a request to the leader, which answers it with the public route's own functions.
M2: index_bars: one vendor caller (the leader); followers re-read the leader's disk copy; a unique sidecar tmp.
L1: the coverage view is published off the event loop.  L2: the process count is bounded by memory.
"""
import asyncio
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time

import pytest

from api.services import bars_api_roles as roles

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    roles._release_for_tests()
    yield
    roles._release_for_tests()


def _mkstore(path, gen: int, rows: int = 3):
    c = sqlite3.connect(str(path))
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE IF NOT EXISTS ohlcv(ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, "
              "v INTEGER, PRIMARY KEY(ticker, tf, ts))")
    c.execute("CREATE TABLE IF NOT EXISTS gen(v INTEGER)")
    c.execute("CREATE TABLE IF NOT EXISTS store_meta(k TEXT PRIMARY KEY, v REAL)")
    c.execute("DELETE FROM gen")
    c.execute("INSERT INTO gen VALUES (?)", (gen,))
    c.executemany("INSERT OR REPLACE INTO ohlcv VALUES ('OLD', '5', ?, 1, 1, 1, 1, 1)",
                  [(1_700_000_000 + 300 * i,) for i in range(rows)])
    c.commit()
    c.close()


# A follower PROCESS: elects (the test process holds the leader lock), then reads + tries to write until told to stop.
_FOLLOWER = r'''
import json, os, sqlite3, sys, time
sys.path.insert(0, {repo!r})
os.environ["DATA_DIR"] = {data!r}
os.environ["BARS_API_WORKERS"] = "2"
from api.services import bars_api_roles as r
from api.services import bars_sqlite as bs
bs.FILE_IDENTITY_CHECK_S = 3600.0          # only the read scope may follow a replace (not the 1 s background check)
role = r.elect()
out = {{"role": role, "writes_landed": 0, "refused": 0, "readonly": 0, "gens": [], "errors": [], "handed_off": 0}}
print("READY", flush=True)
t_end = time.monotonic() + {secs}
i = 0
while time.monotonic() < t_end:
    i += 1
    try:
        with r.follower_read_scope():
            g = bs._conn().execute("SELECT v FROM gen").fetchone()[0]
            if not out["gens"] or out["gens"][-1] != g:
                out["gens"].append(g)
    except r.LeaderOnly:
        out["handed_off"] += 1
    except Exception as e:
        out["errors"].append("%s: %s" % (type(e).__name__, e))
    try:                                                     # the guarded write path (put_bars & co.)
        with bs._WRITE_LOCK:
            c = bs._conn()
            c.execute("INSERT OR REPLACE INTO ohlcv VALUES ('FOLLOWER', '5', ?, 1, 1, 1, 1, 1)", (i,))
            c.commit()
        out["writes_landed"] += 1
    except r.LeaderOnly:
        out["refused"] += 1
    except Exception as e:
        out["errors"].append("guarded %s: %s" % (type(e).__name__, e))
    try:                                                     # a write no guard names: the engine refuses it
        c = bs._conn()
        c.execute("INSERT OR REPLACE INTO ohlcv VALUES ('FOLLOWER', '5', ?, 1, 1, 1, 1, 1)", (-i,))
        c.commit()
        out["writes_landed"] += 1
    except sqlite3.OperationalError as e:
        if "readonly" in str(e).lower() or "read-only" in str(e).lower():
            out["readonly"] += 1
        else:
            out["errors"].append("raw %s" % e)
    time.sleep(0.002)
print("RESULT " + json.dumps(out), flush=True)
'''


def _start_follower(tmp_path, secs):
    code = _FOLLOWER.format(repo=REPO, data=str(tmp_path), secs=secs)
    p = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                         cwd=REPO)
    line = p.stdout.readline()
    assert line.strip() == "READY", line + p.stderr.read()
    return p


def _result(p):
    out, err = p.communicate(timeout=120)
    lines = [ln for ln in out.splitlines() if ln.startswith("RESULT ")]
    assert lines, err
    return json.loads(lines[-1][7:])


def _count(db, ticker):
    c = sqlite3.connect(str(db))
    try:
        return c.execute("SELECT COUNT(*) FROM ohlcv WHERE ticker=?", (ticker,)).fetchone()[0]
    finally:
        c.close()


def test_a_follower_process_cannot_write_the_store(monkeypatch, tmp_path):
    """H1 (a): the guarded write path raises LeaderOnly, and a write no guard names is refused by SQLite."""
    monkeypatch.setenv("BARS_API_WORKERS", "2")
    _mkstore(tmp_path / "bars.db", gen=1)
    assert roles.elect() == "leader"
    p = _start_follower(tmp_path, secs=1.0)
    res = _result(p)
    assert res["role"] == "follower"
    assert res["writes_landed"] == 0, res
    assert res["refused"] > 0 and res["readonly"] > 0, res
    assert res["errors"] == [], res
    assert _count(tmp_path / "bars.db", "FOLLOWER") == 0


def test_a_follower_process_writing_during_a_swap_leaves_a_sound_store_it_then_reads(monkeypatch, tmp_path):
    """H1 (b): a follower PROCESS reads and tries to write in a loop while the leader replaces the store and then
    writes into the NEW file's WAL. The new store passes integrity_check, holds no follower row, the follower
    reads the new file after the swap (never an error), and the new file carries a floor taken at the swap."""
    from api.services import bars_sqlite, data_sync
    # The swap bumps THIS process's store floor (a wholesale change voids every proof): keep it to this test, or every
    # later test that marks a proof in the past reads "unverified".
    monkeypatch.setattr(bars_sqlite, "_mem_floors", dict(bars_sqlite._mem_floors))
    monkeypatch.setattr(bars_sqlite, "_pending_floors", dict(bars_sqlite._pending_floors))
    monkeypatch.setattr(bars_sqlite, "_floors_cache", {})
    # ...and its thread-local connection to the tmp store: restored with `_local`, so a later test on this thread never
    # reads this test's store through a connection the restored `_DB_PATH` no longer names.
    monkeypatch.setattr(bars_sqlite, "_local", threading.local())
    monkeypatch.setenv("BARS_API_WORKERS", "2")
    db, new = tmp_path / "bars.db", tmp_path / "incoming.db"
    _mkstore(db, gen=1)
    _mkstore(new, gen=2, rows=5)
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(db))
    assert roles.elect() == "leader"
    p = _start_follower(tmp_path, secs=3.0)
    time.sleep(0.8)                                         # the follower is mid-loop, connections open
    t_swap_ms = time.time() * 1000.0
    ok = data_sync._swap_in_bars_db(str(new), str(db), bars_sqlite)
    if os.name == "nt":
        # no cross-process barrier on Windows: the replace under live followers is REFUSED (fail closed)
        assert ok is False
        _result(p)
        return
    assert ok is True
    c = bars_sqlite._conn()                                 # the leader writes the new file's WAL at once
    for i in range(50):
        with bars_sqlite._WRITE_LOCK:
            c.execute("INSERT OR REPLACE INTO ohlcv VALUES ('LEADER', '5', ?, 1, 1, 1, 1, 1)", (i,))
            c.commit()
        time.sleep(0.01)
    res = _result(p)
    assert res["writes_landed"] == 0, res
    assert res["errors"] == [], res
    assert res["gens"][-1] == 2, res                        # followed the replace
    assert res["gens"] in ([1, 2], [2]), res                # never back to the old file
    chk = sqlite3.connect(str(db))
    try:
        assert chk.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert chk.execute("SELECT COUNT(*) FROM ohlcv WHERE ticker='FOLLOWER'").fetchone()[0] == 0
        assert chk.execute("SELECT COUNT(*) FROM ohlcv WHERE ticker='LEADER'").fetchone()[0] == 50
        floor = chk.execute("SELECT v FROM store_meta WHERE k=?", (bars_sqlite.REV_FLOOR_KEY,)).fetchone()
        assert floor is not None and floor[0] >= t_swap_ms - 1000      # persisted before followers read
    finally:
        chk.close()
    assert not (tmp_path / ".bars-store-swap.pending").exists()


@pytest.mark.skipif(os.name == "nt", reason="the cross-process barrier is flock (production is Linux)")
def test_the_swap_waits_for_a_followers_read_and_new_reads_go_to_the_leader(monkeypatch, tmp_path):
    """The barrier: an in-flight follower read holds the leader's swap off; a read that starts while a swap is
    announced is handed to the leader instead of waiting; a read that outlives the wait refuses the swap."""
    monkeypatch.setenv("BARS_API_WORKERS", "2")
    (tmp_path / "bars.db").write_bytes(b"")
    code = ("import os,sys,time; sys.path.insert(0,%r); os.environ['DATA_DIR']=%r; os.environ['BARS_API_WORKERS']='2';"
            "from api.services import bars_api_roles as r; r._role='follower';"
            "s=r.follower_read_scope(); s.__enter__(); print('HELD', flush=True); time.sleep(1.5); s.__exit__();"
            "print('DONE', flush=True)") % (REPO, str(tmp_path))
    p = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True, cwd=REPO)
    assert p.stdout.readline().strip() == "HELD"
    with pytest.raises(roles.SwapBarrierBusy):
        with roles.store_swap_barrier(wait_s=0.3):
            pass
    assert not (tmp_path / ".bars-store-swap.pending").exists()
    t0 = time.monotonic()
    with roles.store_swap_barrier(wait_s=10):
        waited = time.monotonic() - t0
        roles._role = "follower"                            # a read starting now, in any follower, hands off
        with pytest.raises(roles.LeaderOnly):
            with roles.follower_read_scope():
                pass
        roles._role = "solo"
    assert waited >= 0.5                                    # it waited for the in-flight read
    p.wait(timeout=30)


def test_one_process_swaps_exactly_as_before(monkeypatch, tmp_path):
    monkeypatch.delenv("BARS_API_WORKERS", raising=False)
    with roles.store_swap_barrier():
        pass
    assert not (tmp_path / ".bars-store-swap.lock").exists()
    assert not (tmp_path / ".bars-store-swap.pending").exists()


# ── M1: the caps exist once ──────────────────────────────────────────────────────────────────────────────────

def _claims():
    from api.services import bars_fetch as bf
    return {
        "cold": lambda: bf._cold_fetch_sem.acquire(blocking=False) and bf._cold_fetch_sem.release(),
        "deepfill": lambda: bf._deepfill_sem.acquire(blocking=False) and bf._deepfill_sem.release(),
        "bg_delta": lambda: bf._bg_delta_sem.acquire(blocking=False) and bf._bg_delta_sem.release(),
        "date_delta": lambda: bf._date_delta_sem.acquire(blocking=False) and bf._date_delta_sem.release(),
        "tail_gapfill": lambda: bf._tail_gapfill_sem.acquire(blocking=False) and bf._tail_gapfill_sem.release(),
        "replay_cold": lambda: bf._replay_cold_sem.acquire(blocking=False) and bf._replay_cold_sem.release(),
        "wm_write": lambda: bf._WM_WRITE_SEM.acquire(blocking=False) and bf._WM_WRITE_SEM.release(),
        "heal": lambda: bf._interactive_heal_sem.acquire(blocking=False) and bf._interactive_heal_sem.release(),
        "inflight": lambda: (bf._inflight.__setitem__("__t__", threading.Event()), bf._inflight.pop("__t__")),
        "cold_bg": lambda: (bf._cold_bg_inflight.add("__t__"), bf._cold_bg_inflight.discard("__t__")),
        "provider": lambda: bf._fetch_daily.__wrapped__ if False else _provider_probe(bf),
    }


def _provider_probe(bf):
    import unittest.mock as um
    with um.patch("api.services.massive.get_agg_bars", return_value=[]):
        bf._fetch_daily("ZZZZ", 5)


@pytest.mark.parametrize("name", list(_claims()))
def test_every_cap_and_single_flight_claim_is_leader_only(name):
    roles._role = "follower"
    try:
        with pytest.raises(roles.LeaderOnly):
            _claims()[name]()
    finally:
        roles._role = "solo"
    _claims()[name]()                                        # the leader / one process: unchanged


_PROVIDER_ENTRIES = [
    ("_fetch_intraday_massive", ("ZZZZ", "5", 10)), ("_fetch_intraday_range", ("ZZZZ", "5", "2026-01-02", "2026-01-03")),
    ("_fetch_intraday_fmp", ("ZZZZ", "5", 10)), ("_fetch_intraday_yfinance", ("ZZZZ", "5", 10)),
    ("_fetch_intraday", ("ZZZZ", "5", 10)), ("_fetch_daily_yf", ("ZZZZ",)), ("_fetch_yf_only", ("^ZZZ", "D", 10)),
    ("_fetch_daily", ("ZZZZ", 10)), ("_fetch_weekly", ("ZZZZ", 10)), ("_fetch_monthly", ("ZZZZ", 10)),
    ("fetch_with_validation", ("ZZZZ", "5", 10)), ("_fetch_reference_end", ("ZZZZ",)), ("_fetch_market_reference_end", ()),
]


@pytest.mark.parametrize("name,args", _PROVIDER_ENTRIES, ids=[n for n, _ in _PROVIDER_ENTRIES])
def test_every_provider_entry_refuses_in_a_follower_before_touching_anything(monkeypatch, name, args):
    """Each provider entry is leader-only ITSELF (not only through a guarded callee): in a follower it raises before
    it reaches a client, a pool or another fetch."""
    import api.services.bars_fetch as bf
    import api.services.massive as ms
    import api.services.yfinance_pool as yp

    def _touched(*a, **k):
        raise AssertionError("a follower reached the provider layer through %s" % name)
    for mod, attr in ((bf, "_get_client"), (ms, "get_agg_bars"), (yp, "fetch_history"), (yp, "run_in_pool"),
                      (bf, "fetch_with_validation"), (bf, "_fetch_intraday_massive"), (bf, "_fetch_daily")):
        if not (mod is bf and attr == name) and hasattr(mod, attr):
            monkeypatch.setattr(mod, attr, _touched)
    import urllib.request as ur
    monkeypatch.setattr(ur, "urlopen", _touched)
    fn = getattr(bf, name)
    roles._role = "follower"
    try:
        with pytest.raises(roles.LeaderOnly):
            fn(*args)
    finally:
        roles._role = "solo"


def test_a_bounded_job_in_a_follower_hands_off_and_leaves_no_claim():
    from api.services import bars_fetch as bf
    roles._role = "follower"
    try:
        with pytest.raises(roles.LeaderOnly):
            bf._bounded_job("K1", lambda: None, 0.1, sem=bf._bg_delta_sem)
    finally:
        roles._role = "solo"
    assert "K1" not in bf._inflight


def test_the_store_write_lock_and_proofs_are_leader_only():
    from api.services import bars_sqlite as bs
    roles._role = "follower"
    try:
        for f in (lambda: bs._WRITE_LOCK.acquire(), lambda: bs.record_verified("A", "5", 1.0),
                  lambda: bs.record_sealed("A", "5", 1.0, 0.0, 1.0), lambda: bs.bump_store_floor("t")):
            with pytest.raises(roles.LeaderOnly):
                f()
    finally:
        roles._role = "solo"
    assert not bs._WRITE_LOCK.locked()


# ── the hand-off ────────────────────────────────────────────────────────────────────────────────────────────

def test_a_follower_hands_a_request_needing_leader_work_to_the_leader(monkeypatch):
    from fastapi.testclient import TestClient
    import api.routers.bars as rb
    import api.bars_api_main as bam
    calls = []

    def needs_leader(*a, **k):
        raise roles.LeaderOnly("cold fetch")
    monkeypatch.setattr(rb, "serve_bars_http", needs_leader)
    monkeypatch.setattr(roles, "proxy_to_leader",
                        lambda path_qs, spent: calls.append((path_qs, spent)) or
                        (200, [("Content-Type", "application/json"), ("ETag", "x1"), ("Content-Length", "9")],
                         b'{"ok": 1}'))
    app = bam._build_app()
    roles._role = "follower"
    try:
        r = TestClient(app).get("/api/bars/ZZZ?tf=5&bars=300")
    finally:
        roles._role = "solo"
    assert r.status_code == 200 and r.json() == {"ok": 1}
    assert r.headers["X-Bars-Served-By"] == "leader" and r.headers["ETag"] == "x1"
    assert calls and calls[0][0] == "/api/bars/ZZZ?tf=5&bars=300&warm=0"


def test_a_follower_serves_a_plain_read_itself(monkeypatch):
    from fastapi.testclient import TestClient
    from fastapi.responses import JSONResponse
    import api.routers.bars as rb
    import api.bars_api_main as bam
    monkeypatch.setattr(rb, "serve_bars_http", lambda *a, **k: JSONResponse({"here": 1}))
    monkeypatch.setattr(roles, "proxy_to_leader", lambda *a: pytest.fail("a plain read was handed off"))
    app = bam._build_app()
    roles._role = "follower"
    try:
        r = TestClient(app).get("/api/bars/ZZZ?tf=5")
    finally:
        roles._role = "solo"
    assert r.json() == {"here": 1} and "X-Bars-Served-By" not in r.headers


def test_the_leader_answers_a_handed_off_request_with_the_routes_own_functions(monkeypatch, tmp_path):
    import socket
    from fastapi.responses import JSONResponse
    import api.routers.bars as rb
    from api.services import bars_fetch as bf
    seen = {}

    def serve(ticker, tf, bars, since="", to="", warm=0, session=""):
        seen.update(ticker=ticker, tf=tf, bars=bars, since=since, warm=warm,
                    spent=getattr(bf._req_ctx, "budget_spent", None))
        r = JSONResponse({"ticker": ticker, "n": bars})
        r.headers["X-Bars-Serve"] = "sqlite"
        return r
    monkeypatch.setattr(rb, "serve_bars_http", serve)
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    monkeypatch.setattr(roles, "LEADER_PORT", port)
    monkeypatch.setenv("BARS_API_WORKERS", "2")
    assert roles.elect() == "leader"
    roles.start_leader_services()
    try:
        code, headers, body = roles.proxy_to_leader("/api/bars/AAPL?tf=5&bars=120&since=17&warm=1", 1.25)
        assert code == 200 and json.loads(body) == {"ticker": "AAPL", "n": 120}
        assert {k.lower(): v for k, v in headers}["x-bars-serve"] == "sqlite"
        assert seen == {"ticker": "AAPL", "tf": "5", "bars": 120, "since": "17", "warm": 1, "spent": 1.25}
        assert roles.proxy_to_leader("/api/bars/AAPL?bars=0", 0)[0] == 422
        import urllib.request, urllib.error
        with pytest.raises(urllib.error.HTTPError) as e:     # no token, no push secret: refused
            urllib.request.urlopen("http://127.0.0.1:%d/api/bars/AAPL" % port, timeout=5)
        assert e.value.code == 401
    finally:
        roles._server.shutdown()
        roles._server = None


# ── M2: index_bars ──────────────────────────────────────────────────────────────────────────────────────────

def test_index_sidecar_tmp_is_unique_per_process_and_thread(monkeypatch, tmp_path):
    from api import index_bars as ib
    seen = []
    real = os.replace
    monkeypatch.setattr(ib.os, "replace", lambda a, b: (seen.append(a), real(a, b)))
    ib._save_repair(str(tmp_path / "SPX_5.repair.json"), {"days": {}})
    assert seen and str(os.getpid()) in os.path.basename(seen[0]) and str(threading.get_ident()) in seen[0]


def test_a_follower_hands_index_refreshes_to_the_leader_and_rereads_disk(monkeypatch):
    from api import index_bars as ib
    from api.services.cache import cache
    sent = []
    monkeypatch.setattr(roles, "send_index_refresh", lambda s, t: sent.append((s, t)))
    monkeypatch.setattr(ib._bg_pool, "submit", lambda *a, **k: pytest.fail("a follower asked the vendor"))
    now = time.time()
    stale = {"series": [{"t": 1, "c": 1}], "saved_at": now - 99999}
    fresh = {"series": [{"t": 2, "c": 2}], "saved_at": now - 1}
    monkeypatch.setattr(cache, "get", lambda k: stale)
    monkeypatch.setattr(cache, "set", lambda *a, **k: None)
    monkeypatch.setattr(ib, "_load_disk", lambda s, t: fresh)
    monkeypatch.setattr(ib, "_copy_behind_since_saved", lambda *a: False)
    roles._role = "follower"
    try:
        series, tier = ib._cached_series("^GSPC", "D")
        assert (series, tier) == (fresh["series"], "index-disk")   # the leader's newer disk copy, not the stale mem
        ib._kick_bg_refresh("^GSPC", "D")
        assert sent == [("^GSPC", "D")]
        with pytest.raises(roles.LeaderOnly):
            ib._refresh("^GSPC", "D")
    finally:
        roles._role = "solo"


# ── L1 / L2 ─────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_coverage_view_is_published_off_the_event_loop(monkeypatch):
    from fastapi.testclient import TestClient
    import api.bars_api_main as bam
    from api.services import bars_live_store
    on_loop = []

    def publish():
        try:
            asyncio.get_running_loop()
            on_loop.append(True)
        except RuntimeError:
            on_loop.append(False)
    monkeypatch.setattr(roles, "publish_view", publish)
    monkeypatch.setattr(bars_live_store, "ingest", lambda payload: {"ok": True})
    import api.bars_auth as ba
    app = bam._build_app()
    app.dependency_overrides[ba.require_bars_service] = lambda: {}
    r = TestClient(app).post("/internal/live-bars", json={"bars": []})
    assert r.status_code == 200 and on_loop == [False]


@pytest.mark.parametrize("mem_gib,ask,want", [(32, 24, 14), (16, 24, 8), (8, 12, 4), (None, 24, 14), (32, 6, 6)])
def test_the_process_count_is_bounded_by_memory(monkeypatch, mem_gib, ask, want):
    monkeypatch.setattr(roles, "_container_memory_bytes", lambda: None if mem_gib is None else mem_gib << 30)
    monkeypatch.setenv("BARS_API_WORKERS", str(ask))
    assert roles.workers() == want


# ── round 2: best-effort kicks never hand a request off; stale swap marker; one authority; history hand-off ────

@pytest.fixture
def deferred(monkeypatch):
    sent = []
    monkeypatch.setattr(roles, "_send_async", lambda item: sent.append(item))
    roles._deferred.clear()
    roles._role = "follower"
    roles.set_current_request("/api/bars/AAPL?tf=5&bars=1199")
    yield sent
    roles.set_current_request(None)
    roles._role = "solo"


def test_the_deepfill_kick_on_every_intraday_first_paint_never_hands_off(monkeypatch, deferred):
    """The kick runs BEFORE Layer 1 on every intraday first paint. Its pytest early return is bypassed here so the
    follower branch itself runs: no LeaderOnly, a local throttle, ONE background replay at the leader."""
    from api.services import bars_fetch as bf
    from api.services.cache import cache
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr(bf, "_DEEPFILL_ENABLED", True)
    monkeypatch.setattr(bf, "_deepfill_once", lambda *a: pytest.fail("a follower ran a deep fill"))
    cache.invalidate(f"deepfill_AAPL_5_{bf._depth_tier(1199)}")
    ttls = []
    real_set = cache.set
    monkeypatch.setattr(cache, "set", lambda k, v, ttl=None, **kw: (ttls.append((k, ttl)), real_set(k, v, ttl=ttl)))
    bf._maybe_kick_deepfill("AAPL", "5", 1199)
    bf._maybe_kick_deepfill("AAPL", "5", 1199)              # a burst: throttled by the local marker
    assert deferred == [("KICK", "deepfill", ["AAPL", "5", 1199])]   # the LEADER runs the kick itself
    # the follower's marker is a burst guard (seconds), never the 6 h TTL a dropped kick would then wait out
    assert [t for k, t in ttls if k.startswith("deepfill_")] == [bf._FOLLOWER_DEEPFILL_MARK_S]
    assert bf._FOLLOWER_DEEPFILL_MARK_S <= 60 < bf._DEEPFILL_TTL


def test_every_best_effort_kick_defers_in_a_follower(monkeypatch, deferred):
    from api.services import bars_fetch as bf
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr(bf, "cold_negative", lambda *a: False)
    calls = [
        lambda: bf._enqueue_since_bg_heal("bars_AAPL_5_x", "AAPL", "5", 1, False),
        lambda: bf._kick_cold_fetch("AAPL", "5", 1199, False),
        lambda: bf._kick_tail_gapfill("AAPL", "5"),
        lambda: bf.kick_snapshot_warm("AAPL", "5"),
    ]
    for i, c in enumerate(calls):
        roles._deferred.clear()
        c()                                                  # never LeaderOnly
        assert deferred[-1] == ("BG", "/api/bars/AAPL?tf=5&bars=1199"), i
    assert len(deferred) == len(calls)


def test_a_follower_serves_an_answer_whose_path_kicked_a_refresh(monkeypatch, deferred):
    """The route level: a serve that hits a best-effort kick answers HERE (no hand-off)."""
    import api.bars_api_main as bam
    from api.services import bars_fetch as bf
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr(bf, "_DEEPFILL_ENABLED", True)
    monkeypatch.setattr(roles, "proxy_to_leader", lambda *a: pytest.fail("handed off for a best-effort kick"))
    from api.services.cache import cache
    cache.invalidate(f"deepfill_MSFT_15_{bf._depth_tier(600)}")

    def serve():
        bf._maybe_kick_deepfill("MSFT", "15", 600)
        return {"here": True}
    assert bam._served_here_or_by_leader("/api/bars/MSFT", {"tf": "15", "bars": 600}, serve) == {"here": True}
    assert deferred and deferred[-1] == ("KICK", "deepfill", ["MSFT", "15", 600])


def test_the_leader_replays_a_deferred_request_in_the_background(monkeypatch):
    import socket
    import urllib.request
    import api.bars_api_main as bam
    seen = threading.Event()
    monkeypatch.setattr(bam, "serve_for_follower", lambda pq, spent, ae="": seen.set() or (200, [], b"{}"))
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    monkeypatch.setattr(roles, "LEADER_PORT", port)
    monkeypatch.setenv("BARS_API_WORKERS", "2")
    assert roles.elect() == "leader"
    roles.start_leader_services()
    try:
        roles._replay_in_background("/api/bars/AAPL?tf=5")
        assert seen.wait(5)
    finally:
        roles._server.shutdown()
        roles._server = None


def test_a_new_leader_removes_a_swap_announcement_its_dead_predecessor_left(monkeypatch, tmp_path):
    monkeypatch.setenv("BARS_API_WORKERS", "2")
    (tmp_path / ".bars-store-swap.pending").write_text("99999")
    assert roles.elect() == "leader"
    assert not (tmp_path / ".bars-store-swap.pending").exists()
    roles._role = "follower"                                 # a follower read no longer hands off forever
    try:
        with roles.follower_read_scope():
            pass
    finally:
        roles._role = "solo"


def test_the_multi_process_settings_follow_the_memory_clamped_worker_count(monkeypatch):
    from api.services import bars_sqlite
    monkeypatch.setenv("BARS_API_WORKERS", "4")
    monkeypatch.setattr(roles, "_container_memory_bytes", lambda: 2 << 30)      # 2 GB: one process
    assert roles.workers() == 1 and bars_sqlite._multiprocess_tier() is False
    monkeypatch.setattr(roles, "_container_memory_bytes", lambda: 32 << 30)
    assert bars_sqlite._multiprocess_tier() is True


def test_a_follower_history_read_goes_through_the_origin_entry_and_hands_off_with_its_encoding(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from fastapi.responses import JSONResponse
    import api.routers.bars as rb
    import api.bars_api_main as bam
    seen = {}

    async def origin(ticker, tf, bars, v, d, accept_encoding):
        seen["ae"] = accept_encoding
        return JSONResponse({"origin": ticker})
    monkeypatch.setattr(rb, "serve_bars_history_origin", origin)
    sent = []
    monkeypatch.setattr(roles, "proxy_to_leader", lambda pq, spent, ae="": sent.append((pq, ae)) or
                        (200, [("Content-Type", "application/json"), ("Content-Encoding", "gzip")], b"x"))
    app = bam._build_app()
    roles._role = "follower"
    try:
        c = TestClient(app)
        r = c.get("/api/bars-history/SPY?tf=D&bars=500", headers={"Accept-Encoding": "gzip"})
        assert r.json() == {"origin": "SPY"} and "gzip" in seen["ae"]
        (tmp_path / ".bars-store-swap.pending").write_text("1")          # a swap announced: the leader answers
        r = c.get("/api/bars-history/SPY?tf=D&bars=500", headers={"Accept-Encoding": "gzip"})
        assert sent and sent[0][0].startswith("/api/bars-history/SPY?") and "gzip" in sent[0][1]
    finally:
        roles._role = "solo"


# ── follow-up review: the leader runs a deferred deep fill itself; history hand-offs share one build; sheds ──────

def _leader_port(monkeypatch):
    import socket
    so = socket.socket()
    so.bind(("127.0.0.1", 0))
    port = so.getsockname()[1]
    so.close()
    monkeypatch.setattr(roles, "LEADER_PORT", port)
    monkeypatch.setenv("BARS_API_WORKERS", "2")
    assert roles.elect() == "leader"
    roles.start_leader_services()
    return port


def test_the_leader_runs_a_followers_deepfill_kick_through_its_own_throttle(monkeypatch):
    from api.services import bars_fetch as bf
    got = []
    monkeypatch.setattr(bf, "_maybe_kick_deepfill", lambda t, tf, b: got.append((t, tf, b)))
    _leader_port(monkeypatch)
    try:
        code, _ = roles.forward_to_leader("POST", "/internal/kick", json.dumps(
            {"kind": "deepfill", "args": ["AAPL", "5", 1199]}).encode(), "")
        assert code == 200 and got == [("AAPL", "5", 1199)]
        code, _ = roles.forward_to_leader("POST", "/internal/kick", json.dumps(
            {"kind": "__import__", "args": ["os"]}).encode(), "")
        assert code == 404                                  # an allowlist of names, never a callable
    finally:
        roles._server.shutdown()
        roles._server = None


def test_handed_off_history_reads_of_one_url_share_one_build(monkeypatch):
    import api.bars_api_main as bam
    import api.routers.bars as rb
    from fastapi.responses import JSONResponse
    builds = []

    def build(ticker, tf, bars, v, d):
        builds.append(ticker)
        time.sleep(0.3)
        return JSONResponse({"t": ticker})                  # not `public`: the memo keeps nothing, the flight shares
    monkeypatch.setattr(rb, "serve_bars_history", build)
    outs = []
    ths = [threading.Thread(target=lambda: outs.append(bam._history_for_follower("SPY", "D", 500, "", "", "gzip")))
           for _ in range(6)]
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    assert len(builds) == 1 and len(outs) == 6 and all(o[0] == 200 for o in outs)


def test_a_hand_off_shed_is_one_the_edge_reads_as_deliberate(monkeypatch):
    """A 503 the edge does not recognise (tail.js isDeliberateTierShed) is a tier FAILURE there: the read goes to
    web, another store, and the 20 s breaker opens. Every hand-off shed carries a recognised tag + Retry-After."""
    import re
    src = open(os.path.join(REPO, "edge", "bars-edge-router", "tail.js"), encoding="utf-8").read()
    allowed = set(re.findall(r'"([a-z-]+)"', re.search(r"DELIBERATE_SHED_REASONS = new Set\(\[([^\]]*)\]", src).group(1)))
    monkeypatch.setattr(roles, "LEADER_PORT", 9)                 # nobody listens: the unreachable-leader shed
    code, headers, _ = roles.proxy_to_leader("/api/bars/AAPL?tf=5", 0.0)
    h = {k.lower(): v for k, v in headers}
    assert code == 503 and h.get("retry-after") and h.get("x-bars-shed") in allowed
    assert dict((k.lower(), v) for k, v in roles.SHED_HEADERS)["x-bars-shed"] in allowed
