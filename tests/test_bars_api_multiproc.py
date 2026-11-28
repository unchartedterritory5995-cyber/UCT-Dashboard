"""bars-api in several processes on one volume (capacity-500, 2026-11-28; `api/services/bars_api_roles.py`).

The 500-member replay measured one bars-api process near ~100 member asks a second (GIL-bound) inside a 32-vCPU
container, so the tier runs `BARS_API_WORKERS` uvicorn processes. These rails pin what that must not break:
  * unset / 1 is the single process of before (no election, no lock file, no stat per connection);
  * exactly one LEADER runs the background work; FOLLOWERS serve reads only and never start it;
  * a follower answers the live store's coverage from the leader's published view exactly as the leader would,
    and hands an uncovered ticker to the leader's repair queue;
  * the web pod's push reaching a follower is applied by the leader (forwarded verbatim; 503 when it is gone);
  * a follower's SQLite connections follow a replaced store file;
  * `main()` starts N processes through the factory.
"""
import json
import os
import pickle
import sqlite3
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from api.services import bars_api_roles as roles
from api.services import bars_live_store as bls

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    roles._release_for_tests()
    bls._reset_for_tests()
    yield
    roles._release_for_tests()
    bls._reset_for_tests()


# ── the knob ────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,want", [(None, 1), ("", 1), ("1", 1), ("8", 8), ("junk", 1), ("0", 1), ("999", 64)])
def test_workers_is_clamped_and_unset_means_one(monkeypatch, raw, want):
    if raw is None:
        monkeypatch.delenv("BARS_API_WORKERS", raising=False)
    else:
        monkeypatch.setenv("BARS_API_WORKERS", raw)
    assert roles.workers() == want


def test_a_single_process_elects_nothing_and_takes_no_lock(monkeypatch, tmp_path):
    monkeypatch.delenv("BARS_API_WORKERS", raising=False)
    assert roles.elect() == "solo"
    assert not (tmp_path / ".bars-api-leader.lock").exists()


# ── election ────────────────────────────────────────────────────────────────────────────────────────────────

_PROBE = ("import os,sys; sys.path.insert(0, %r); os.environ['DATA_DIR']=%r; os.environ['BARS_API_WORKERS']='4';"
          "from api.services import bars_api_roles as r; print(r.elect())")


def _elect_in_another_process(tmp_path):
    out = subprocess.run([sys.executable, "-c", _PROBE % (REPO, str(tmp_path))], capture_output=True, text=True,
                         timeout=60, cwd=REPO)
    return out.stdout.strip().splitlines()[-1]


def test_exactly_one_process_leads_and_the_lock_passes_on_when_it_goes(monkeypatch, tmp_path):
    monkeypatch.setenv("BARS_API_WORKERS", "4")
    assert roles.elect() == "leader"
    assert _elect_in_another_process(tmp_path) == "follower"
    roles._release_for_tests()                       # the leader's process is gone: the kernel drops its lock
    assert _elect_in_another_process(tmp_path) == "leader"


def test_a_follower_never_starts_the_leaders_background_work(monkeypatch):
    import asyncio
    import api.bars_api_main as bam
    calls = []
    monkeypatch.setattr(roles, "elect", lambda: "follower")
    monkeypatch.setattr(roles, "start_follower_services", lambda promote: calls.append(("follower", promote)))
    monkeypatch.setattr(bam, "_start_background_work", lambda: calls.append("background"))
    monkeypatch.setattr(bam, "_tune_interpreter", lambda: None)

    async def enter():
        async with bam._lifespan(None):
            pass
    asyncio.run(enter())
    assert "background" not in calls
    assert calls and calls[0][0] == "follower"
    # what it would run if it is PROMOTED is exactly the leader's work
    assert calls[0][1] is bam._start_background_work


def test_the_leader_and_the_single_process_start_the_background_work(monkeypatch):
    import asyncio
    import api.bars_api_main as bam
    for who in ("leader", "solo"):
        calls = []
        monkeypatch.setattr(roles, "elect", lambda who=who: who)
        monkeypatch.setattr(roles, "start_leader_services", lambda: calls.append("leader-port"))
        monkeypatch.setattr(bam, "_start_background_work", lambda: calls.append("background"))
        monkeypatch.setattr(bam, "_tune_interpreter", lambda: None)

        async def enter():
            async with bam._lifespan(None):
                pass
        asyncio.run(enter())
        assert calls[0] == "background", who


# ── the coverage view ───────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def live(monkeypatch, tmp_path):
    from api.services import bars_sqlite
    monkeypatch.setenv("BARS_LIVE_COVERAGE_ENABLED", "1")
    monkeypatch.setattr(bars_sqlite, "put_bars_many", lambda tf, by: sum(len(v) for v in by.values()))
    db = sqlite3.connect(str(tmp_path / "bars.db"), check_same_thread=False)
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: db)
    bls._reset_for_tests()
    return bls


def _leader_state(live):
    now = int(time.time())
    live.ingest({"epoch_ms": 1_000, "first_full_bucket_ms": 2_000, "watermark_ms": (now // 60) * 60_000, "rows": []})
    live._covered5.update({"AAA", "BBB"})
    live._history5_complete.add("AAA")
    live._daily_seen.add("AAA")
    live._own_last["5"]["AAA"] = (now // 300) * 300 - 300
    live._state["daily_last_ok_mono"] = time.monotonic()


def _answers(live):
    return {
        "cov5": [live.covered(s, "5") for s in ("AAA", "BBB", "CCC")],
        "covD": [live.covered(s, "D") for s in ("AAA", "BBB")],
        "proof": [live.proven_through_s(s, "5") for s in ("AAA", "BBB", "CCC")],
        "hist": [live.history_complete(s, "5") for s in ("AAA", "BBB")],
        "alive": (live.stream_alive(), live.daily_alive()),
    }


def _as_follower(live, tmp_path, sent):
    """Publish the leader's view, then empty the leader's own state: every answer now comes from the view."""
    path = tmp_path / ".bars-live-view.pkl"
    path.write_bytes(pickle.dumps(live.export_view()))
    keep = live.STREAM_ALIVE_S
    bls._reset_for_tests()
    live.install_view(roles.FollowerView(str(path), want_sender=lambda s, tf: sent.append((s, tf))))
    return keep


def test_a_follower_answers_coverage_exactly_as_the_leader(live, tmp_path, monkeypatch):
    monkeypatch.setattr(live, "_daily_contiguous", lambda sym: True)
    _leader_state(live)
    lead = _answers(live)
    assert lead["cov5"] == [True, True, False] and lead["covD"] == [True, False]   # the fixture is not vacuous
    sent = []
    _as_follower(live, tmp_path, sent)
    assert live._covered5 == set()                    # nothing left in this process's own state
    follow = _answers(live)
    assert follow == lead


def test_a_follower_sees_the_stream_die_from_the_view(live, tmp_path, monkeypatch):
    _leader_state(live)
    live._state["last_push_mono"] = time.monotonic() - live.STREAM_ALIVE_S - 5
    sent = []
    _as_follower(live, tmp_path, sent)
    assert live.stream_alive() is False
    assert live.covered("AAA", "5") is False


def test_a_follower_reads_a_new_view_when_the_leader_publishes(live, tmp_path, monkeypatch):
    _leader_state(live)
    path = tmp_path / ".bars-live-view.pkl"
    path.write_bytes(pickle.dumps(live.export_view()))
    v = roles.FollowerView(str(path), want_sender=lambda s, tf: None)
    assert "CCC" not in v.view()["covered5"]
    live._covered5.add("CCC")
    time.sleep(0.02)
    path.write_bytes(pickle.dumps(live.export_view()))
    os.utime(path, ns=(time.time_ns(), time.time_ns() + 10_000_000))
    time.sleep(roles.VIEW_CHECK_S + 0.02)
    assert "CCC" in v.view()["covered5"]


def test_an_uncovered_read_in_a_follower_asks_the_leader_once(live, tmp_path):
    _leader_state(live)
    sent = []
    _as_follower(live, tmp_path, sent)
    assert live.covered("ZZZ", "5") is False
    assert live.covered("ZZZ", "5") is False
    assert sent == [("ZZZ", "5")]


def test_the_leader_queues_what_a_follower_asks_for(live):
    _leader_state(live)
    live.want_from_follower("zzz", "5")
    assert "ZZZ" in live._urgent_set and live._urgent[-1] == "ZZZ"
    live.want_from_follower("AAA", "5")              # already covered: nothing queued
    assert "AAA" not in live._urgent_set


# ── the push hand-off ───────────────────────────────────────────────────────────────────────────────────────

class _FakeLeader(BaseHTTPRequestHandler):
    got = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        _FakeLeader.got.append((self.path, self.headers.get("Authorization"), self.rfile.read(n)))
        body = b'{"ok": true, "acked_seq": 7}'
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _free_port():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_a_follower_hands_the_push_to_the_leader_verbatim(monkeypatch):
    port = _free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port), _FakeLeader)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        monkeypatch.setattr(roles, "LEADER_PORT", port)
        _FakeLeader.got = []
        body = json.dumps({"epoch_ms": 1, "rows": [["AAA", 1, 1, 1, 1, 1, 1]]}).encode()
        code, out = roles.forward_to_leader("POST", "/internal/live-bars", body, "Bearer s3")
        assert code == 200 and json.loads(out)["acked_seq"] == 7
        assert _FakeLeader.got == [("/internal/live-bars", "Bearer s3", body)]
    finally:
        srv.shutdown()


def test_a_push_with_no_leader_answers_503_so_the_web_pod_requeues(monkeypatch):
    monkeypatch.setattr(roles, "LEADER_PORT", _free_port())          # nothing listens there
    code, _ = roles.forward_to_leader("POST", "/internal/live-bars", b"{}", "Bearer s3")
    assert code == 503


def test_the_push_route_forwards_in_a_follower_and_applies_in_the_leader(monkeypatch):
    from starlette.testclient import TestClient
    import api.bars_api_main as bam
    monkeypatch.setenv("PUSH_SECRET", "s3")
    seen = []
    monkeypatch.setattr(roles, "forward_to_leader",
                        lambda m, p, b, a: (seen.append((m, p, b, a)) or (200, b'{"from":"leader"}')))
    monkeypatch.setattr(bls, "ingest", lambda payload: {"from": "here", "n": len(payload.get("rows", []))})
    app = bam._build_app()
    client = TestClient(app)                          # no `with`: the lifespan (background work) is not entered
    roles._role = "follower"
    r = client.post("/internal/live-bars", content=b'{"rows": [1, 2]}', headers={"Authorization": "Bearer s3"})
    assert r.status_code == 200 and r.json() == {"from": "leader"}
    assert seen == [("POST", "/internal/live-bars", b'{"rows": [1, 2]}', "Bearer s3")]
    roles._role = "solo"
    r = client.post("/internal/live-bars", content=b'{"rows": [1, 2]}', headers={"Authorization": "Bearer s3"})
    assert r.status_code == 200 and r.json() == {"from": "here", "n": 2}
    assert len(seen) == 1
    r = client.post("/internal/live-bars", content=b'{"rows": []}')                  # the gate still holds
    assert r.status_code == 401


# ── the store file ──────────────────────────────────────────────────────────────────────────────────────────

def _mkdb(path, val):
    c = sqlite3.connect(str(path))
    c.execute("CREATE TABLE t(v)")
    c.execute("INSERT INTO t VALUES (?)", (val,))
    c.commit()
    c.close()


def _read_in_thread(fn):
    out = []
    t = threading.Thread(target=lambda: out.append(fn()))
    t.start()
    t.join()
    return out[0]


@pytest.mark.skipif(os.name == "nt", reason="replacing an OPEN file needs POSIX rename semantics (production is Linux)")
def test_a_followers_connection_follows_a_replaced_store_file(monkeypatch, tmp_path):
    from api.services import bars_sqlite
    db, new = tmp_path / "bars.db", tmp_path / "new.db"
    _mkdb(db, "old")
    _mkdb(new, "new")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(db))
    monkeypatch.setenv("BARS_API_WORKERS", "4")
    monkeypatch.setattr(bars_sqlite, "FILE_IDENTITY_CHECK_S", 0.0)

    def request_thread():                 # one long-lived thread: read, the LEADER replaces the file, read again
        out = [bars_sqlite._conn().execute("SELECT v FROM t").fetchone()[0]]
        os.replace(str(new), str(db))
        out.append(bars_sqlite._conn().execute("SELECT v FROM t").fetchone()[0])
        return out
    assert _read_in_thread(request_thread) == ["old", "new"]


def test_the_single_process_never_stats_the_store_per_connection(monkeypatch, tmp_path):
    from api.services import bars_sqlite
    db = tmp_path / "bars.db"
    _mkdb(db, "x")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(db))
    monkeypatch.delenv("BARS_API_WORKERS", raising=False)
    monkeypatch.setattr(bars_sqlite, "FILE_IDENTITY_CHECK_S", 0.0)     # any check at all would show below
    calls = []
    real = bars_sqlite._file_identity
    monkeypatch.setattr(bars_sqlite, "_file_identity", lambda: calls.append(1) or real())

    def go():
        for _ in range(5):
            bars_sqlite._conn().execute("SELECT 1").fetchone()
        return True
    assert _read_in_thread(go)
    assert calls == []


# ── main ────────────────────────────────────────────────────────────────────────────────────────────────────

def test_main_starts_n_processes_through_the_factory(monkeypatch, tmp_path):
    import api.bars_api_main as bam
    got = {}
    monkeypatch.setattr(bam, "_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(bam.uvicorn, "run", lambda app, **kw: got.update(app=app, **kw))
    monkeypatch.setenv("BARS_API_WORKERS", "6")
    monkeypatch.setenv("PORT", "8123")
    bam.main()
    assert got["app"] == "api.bars_api_main:_build_worker_app" and got["factory"] is True
    assert got["workers"] == 6 and got["port"] == 8123
    monkeypatch.setenv("BARS_API_WORKERS", "1")
    got.clear()
    bam.main()
    assert not isinstance(got["app"], str) and "workers" not in got       # the single process, as before
