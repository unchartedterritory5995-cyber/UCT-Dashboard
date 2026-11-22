"""Chart-data monitor — review fixes (PR #1092): cycle deadline, consecutive-transport cutoff,
latency only from clean answers, IPv4 + short connect timeout, no bearer on REST, and an
off-hours sleep that cannot skip the 04:00 pre-market start. No network beyond 127.0.0.1."""
from __future__ import annotations

import http.server
import threading
import time
from datetime import date

from api.services.chart_monitor import checks as C
from api.services.chart_monitor import probe, runner
from tests.test_chart_monitor_runtime import FakeEdge, at, cfg

WED = date(2026, 11, 11)


class HangingEdge:
    """Every request is a transport failure that costs ``cost`` seconds of (fake) clock."""

    def __init__(self, clock, cost=45.0):
        self.clock, self.cost, self.requests = clock, cost, 0

    def get_json(self, path, max_retries=2, deadline=None):
        self.requests += 1
        self.clock[0] += self.cost
        return {"status": None, "ms": self.cost * 1000, "headers": {}, "body": None,
                "retries": 2, "error": "timeout", "clean": False}


def test_cycle_stops_after_K_consecutive_transport_failures_and_fails_every_pair():
    clock = [at(WED, 11, 3)]
    edge = HangingEdge(clock, cost=1.0)
    c = cfg()
    cyc = runner.run_cycle(edge, c, C.LabelWindow(), now_fn=lambda: clock[0], sleep=lambda s: None)
    assert edge.requests == c.max_transport_fails
    assert cyc.pairs == 4 * len(runner.SERIES)
    for lab, _tf, _s in runner.SERIES:
        failing, detail = cyc.observations[f"http|{lab}"]
        assert failing and "4/4" in detail
    assert "consecutive transport failures" in cyc.aborted


def test_a_single_transport_blip_does_not_abort():
    clock = [at(WED, 11, 3)]
    edge = FakeEdge(clock[0])
    real = edge.get_json
    n = {"i": 0}

    def blip(path, max_retries=2, deadline=None):
        n["i"] += 1
        if n["i"] % 3 == 0:
            return {"status": None, "ms": 10, "headers": {}, "body": None, "retries": 2,
                    "error": "timeout", "clean": False}
        return real(path, max_retries, deadline)
    edge.get_json = blip
    cyc = runner.run_cycle(edge, cfg(), C.LabelWindow(), now_fn=lambda: clock[0], sleep=lambda s: None)
    assert cyc.aborted is None


def test_cycle_deadline_bounds_a_slow_edge_and_marks_the_rest_failed():
    clock = [at(WED, 11, 3)]
    edge = FakeEdge(clock[0])
    real = edge.get_json

    def slow(path, max_retries=2, deadline=None):
        clock[0] += 20.0                      # every answer takes 20 s — slow, not a transport error
        return real(path, max_retries, deadline)
    edge.get_json = slow
    cyc = runner.run_cycle(edge, cfg(cycle_deadline_s=240), C.LabelWindow(),
                           now_fn=lambda: clock[0], sleep=lambda s: None)
    assert edge.requests <= 12
    assert clock[0] - cyc.at <= 240 + 20
    assert "cycle deadline" in cyc.aborted
    assert cyc.observations["http|D"][0]      # pairs never probed are http FAILs


def test_an_outage_opens_http_alerts_within_two_cycles(tmp_path):
    clock = [at(WED, 11, 3)]
    posts = []
    edge = HangingEdge(clock, cost=1.0)
    for _ in range(2):
        runner.tick(cfg(), C.LabelWindow(), edge, post=lambda m: posts.append(m) or True,
                    heartbeat=lambda c, p: True, state_path=str(tmp_path / "s.json"),
                    now_fn=lambda: clock[0], sleep=lambda s: None)
        clock[0] += 300
    assert len(posts) == 1 and "http|1" in posts[0]


def test_latency_counts_only_clean_first_attempt_answers():
    now = at(WED, 14, 3)
    six = ("A", "B", "C", "D", "E", "F")
    edge = FakeEdge(now)
    edge.ms, edge.retries = 25000, 1          # slow because it was retried: not a latency sample
    c = runner.run_cycle(edge, cfg(latency_p90_ms=3000, liquid=six), C.LabelWindow(),
                         now_fn=lambda: now, sleep=lambda s: None)
    assert "latency_p90|1" not in c.observations
    edge.retries = 0
    c2 = runner.run_cycle(edge, cfg(latency_p90_ms=3000, liquid=six), C.LabelWindow(),
                          now_fn=lambda: now, sleep=lambda s: None)
    assert c2.observations["latency_p90|1"][0]


def _local_server(handler_cls):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def test_http_client_clean_flag_and_no_bearer_on_rest(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cr3t")
    seen, calls = [], {"n": 0}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            seen.append(self.headers.get("Authorization"))
            calls["n"] += 1
            if self.path.startswith("/flaky") and calls["n"] == 1:
                self.send_response(503)
                self.send_header("Retry-After", "0")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            body = b'{"bars": []}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    srv = _local_server(H)
    try:
        h = probe.Http(f"http://127.0.0.1:{srv.server_address[1]}", rps=100)
        r = h.get_json("/ok")
        assert r["status"] == 200 and r["clean"] is True and seen[-1] is None   # no bearer on REST
        calls["n"] = 0
        r2 = h.get_json("/flaky")
        assert r2["status"] == 200 and r2["retries"] == 1 and r2["clean"] is False
        assert h.headers("text/event-stream", auth=True)["Authorization"] == "Bearer s3cr3t"
        assert "Authorization" not in h.headers()
    finally:
        srv.shutdown()


def test_deadline_stops_retries():
    hits = {"n": 0}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            hits["n"] += 1
            self.send_response(503)
            self.send_header("Retry-After", "2")
            self.send_header("Content-Length", "0")
            self.end_headers()
    srv = _local_server(H)
    try:
        h = probe.Http(f"http://127.0.0.1:{srv.server_address[1]}", rps=100)
        r = h.get_json("/x", deadline=time.monotonic() + 1.0)
        assert r["status"] == 503 and r["retries"] == 0 and hits["n"] == 1
    finally:
        srv.shutdown()


def test_connect_is_ipv4_only_with_its_own_short_timeout(monkeypatch):
    fams, timeouts = [], []
    real_gai = probe.socket.getaddrinfo

    def gai(host, port, family=0, *a, **k):
        fams.append(family)
        return real_gai(host, port, family, *a, **k)

    class S:
        def __init__(self, *a):
            pass

        def settimeout(self, t):
            timeouts.append(t)

        def connect(self, addr):
            pass

        def close(self):
            pass
    monkeypatch.setattr(probe.socket, "getaddrinfo", gai)
    monkeypatch.setattr(probe.socket, "socket", S)
    probe._ipv4_connect("127.0.0.1", 80, 3.0, 20.0)
    assert fams == [probe.socket.AF_INET] and timeouts == [3.0, 20.0]


def test_offhours_sleep_never_skips_the_premarket_start():
    c = runner.Config()
    t = at(WED, 3, 30)
    s = runner.sleep_for("closed", c, t, t + 60)
    assert t + 60 + s == at(WED, 4, 0) + 5
    sat = at(date(2026, 11, 14), 12, 0)        # next boundary is Monday 04:00: hourly cadence
    assert runner.sleep_for("closed", c, sat, sat + 60) == 3600 - 60
    r = at(WED, 11, 0)                         # RTH: the 5-minute cadence is untouched
    assert runner.sleep_for("rth", c, r, r + 100) == 200
    assert runner.next_phase_boundary(at(date(2026, 11, 27), 12, 0)) == at(date(2026, 11, 27), 13, 0)
    assert runner.next_phase_boundary(at(date(2026, 11, 25), 21, 0)) == at(date(2026, 11, 27), 4, 0)
