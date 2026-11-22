"""Chart-data monitor — alert hysteresis/dedupe, the cycle against a fake edge, durable state,
the daily summary, the heartbeat + dead-man, scheduler/thread registration and the kill switch.
No network: the edge, the Discord webhook and the scheduler are all fakes."""
from __future__ import annotations

import json
import re
import threading
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from api.services.chart_monitor import alerting, deadman, runner
from api.services.chart_monitor import checks as C

WED = date(2026, 11, 11)
REPO = Path(__file__).resolve().parents[1]


def at(d, hh, mm, ss=0):
    return C.et_epoch(d, hh * 60 + mm) + ss


# ───────────────────────────── hysteresis / dedupe

def test_alert_opens_only_after_N_consecutive_failures_and_resolves_after_M_passes():
    st, ev = alerting.step({}, {"freshness|1": (True, "1/16 tickers: SOFI")}, 0, n_fail=2, n_clear=2)
    assert ev == [] and st["freshness|1"]["fails"] == 1
    st, ev = alerting.step(st, {"freshness|1": (True, "2/16 tickers: SOFI, ONON")}, 300)
    assert [e.kind for e in ev] == ["open"] and "SOFI, ONON" in ev[0].detail
    st, ev = alerting.step(st, {"freshness|1": (True, "x")}, 600)
    assert ev == []                                   # deduped: no repeat while open
    st, ev = alerting.step(st, {"freshness|1": (False, "0/16")}, 900)
    assert ev == []                                   # one pass is not a recovery
    st, ev = alerting.step(st, {"freshness|1": (False, "0/16")}, 1200)
    assert [e.kind for e in ev] == ["resolve"]
    assert "freshness|1" not in st                    # healthy keys carry no state


def test_flapping_never_opens_with_N2():
    st = {}
    for i in range(20):
        st, ev = alerting.step(st, {"k": (i % 2 == 0, "d")}, i * 300, n_fail=2, n_clear=2)
        assert ev == []


def test_reminder_at_most_every_remind_s_while_open():
    st = {}
    kinds = []
    for i in range(60):                                # 5 hours of failing cycles
        st, ev = alerting.step(st, {"k": (True, "d")}, i * 300, n_fail=2, remind_s=7200)
        kinds += [e.kind for e in ev]
    assert kinds == ["open", "remind", "remind"]


def test_unobserved_key_neither_opens_nor_resolves():
    st, _ = alerting.step({}, {"k": (True, "d")}, 0)
    st, _ = alerting.step(st, {"k": (True, "d")}, 300)
    assert st["k"]["open"]
    for i in range(10):                                # e.g. stream SKIP while market closed
        st, ev = alerting.step(st, {}, 600 + i * 300)
        assert ev == [] and st["k"]["open"]


def test_PROPERTY_open_and_resolve_alternate_per_key():
    """Over random sequences: events per key strictly alternate open → resolve (reminders only
    between them) — no double-open, no resolve without open."""
    import random
    rnd = random.Random(7)
    for _ in range(200):
        st, seq = {}, []
        for i in range(60):
            obs = {k: (rnd.random() < 0.5, "d") for k in ("a", "b") if rnd.random() < 0.8}
            st, ev = alerting.step(st, obs, i * 300, n_fail=rnd.randint(1, 3), n_clear=rnd.randint(1, 3),
                                   remind_s=900)
            seq += [(e.key, e.kind) for e in ev]
        for key in ("a", "b"):
            is_open = False
            for k, kind in seq:
                if k != key:
                    continue
                if kind == "open":
                    assert not is_open
                    is_open = True
                elif kind == "remind":
                    assert is_open
                else:
                    assert is_open
                    is_open = False


def test_message_names_tickers_tf_check_counts_and_no_digits_beyond_counts():
    ev = [alerting.Event("open", "freshness|60rth", "2/16 tickers: SOFI, ONON", 0),
          alerting.Event("resolve", "grid|5", "", 0)]
    msg = alerting.format_events(ev, 1500)
    assert "freshness|60rth" in msg and "SOFI, ONON" in msg and "2/16" in msg
    assert "resolved `grid|5`" in msg
    assert alerting.format_events([], 0) is None


def test_post_uses_the_ops_resolver_and_never_raises(monkeypatch):
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/webhook/x")
    monkeypatch.delenv("DISCORD_OPS_WEBHOOK_URL", raising=False)
    sent = []
    assert alerting.post("hi", sender=lambda url, body: sent.append((url, json.loads(body))) or True)
    assert sent[0][0] == "https://discord.example/webhook/x"
    assert sent[0][1]["allowed_mentions"] == {"parse": []}

    def boom(url, body):
        raise RuntimeError("network")
    assert alerting.post("hi", sender=boom) is False
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    assert alerting.post("hi", sender=lambda u, b: True) is False


# ───────────────────────────── a fake edge

class FakeEdge:
    """Serves a synthetic, correct series per (sym, tf, session) at a fixed ``now``; knobs make
    it stale / off-grid / unverified per symbol. Prices are synthetic constants."""

    def __init__(self, now, stale=(), offgrid=(), unverified=(), heal=True, status=200, desc="hot"):
        self.now, self.stale, self.offgrid = now, set(stale), set(offgrid)
        self.unverified, self.heal, self.status, self.desc = set(unverified), heal, status, desc
        self.requests = 0
        self.seen_unverified: set = set()
        self.paths: list = []

    ms, retries = 120, 0

    def get_json(self, path, max_retries=2, deadline=None):
        self.requests += 1
        self.paths.append(path)
        u = urlparse(path)
        sym = u.path.rsplit("/", 1)[-1]
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        tf, sess = q["tf"], q.get("session", "eth")
        hdr = {"server-timing": f'bars;desc="{self.desc}";dur=1'}
        if self.status != 200:
            return {"status": self.status, "ms": 50, "headers": hdr, "body": None, "retries": 0,
                    "error": None}
        if tf == "D":
            d, days = C.expected_daily_date(self.now), []
            while len(days) < 30:
                if C.is_trading_day(d):
                    days.append(d)
                d = date.fromordinal(d.toordinal() - 1)
            if sym in self.stale:
                days = days[3:]
            bars = [{"t": x.isoformat(), "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for x in reversed(days)]
            return {"status": 200, "ms": 80, "headers": hdr, "body": {"bars": bars}, "retries": 0, "error": None,
                    "clean": True}
        fr = C.frontier(self.now, tf, sess, 0)
        sday = fr.session_day
        ts = []
        for d in (C.prev_trading_day(C.prev_trading_day(sday)), C.prev_trading_day(sday), sday):
            ts += [s for s, e in C.day_buckets(d, tf, sess) if s <= self.now]
        if sym in self.stale:
            ts = [t for t in ts if t <= self.now - 4 * 3600]
        if sym in self.offgrid:
            ts.append(ts[-3] + 7)
            ts.sort()
        body = {"bars": [{"t": t, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for t in ts],
                "tail_status": "current", "newest_bar_is_forming": ts[-1] == fr.developing_start}
        key = (sym, tf, sess)
        if sym in self.unverified and (key not in self.seen_unverified or not self.heal):
            self.seen_unverified.add(key)
            body["tail_status"] = "unverified"
            hdr["retry-after"] = "3"
        return {"status": 200, "ms": self.ms, "headers": hdr, "body": body, "retries": self.retries,
                "error": None, "clean": self.retries == 0}


def cfg(**kw):
    c = runner.Config(liquid=("SPY", "SOFI", "ONON"), thin=("NVEC",), stream=False,
                      heartbeat_url="http://test/heartbeat")
    for k, v in kw.items():
        setattr(c, k, v)
    return c


def _run(edge, now, **kw):
    return runner.run_cycle(edge, cfg(**kw), C.LabelWindow(), now_fn=lambda: now, sleep=lambda s: None)


def test_healthy_edge_has_no_failing_observation_in_RTH():
    now = at(WED, 11, 3)
    cyc = _run(FakeEdge(now), now)
    bad = {k: d for k, (f, d) in cyc.observations.items() if f}
    assert not bad, bad
    assert cyc.pairs == 4 * len(runner.SERIES)
    labels = {k.split("|")[1] for k in cyc.observations}
    assert {"1", "5", "15", "30", "60rth", "60eth", "D"} <= labels


@pytest.mark.parametrize("now", [at(WED, 7, 3), at(WED, 17, 33), at(WED, 22, 0),
                                 at(date(2026, 11, 14), 12, 0), at(date(2026, 11, 27), 13, 40)])
def test_healthy_edge_is_green_in_every_phase(now):
    cyc = _run(FakeEdge(now), now)
    bad = {k: d for k, (f, d) in cyc.observations.items() if f}
    assert not bad, bad


def test_stale_symbol_fails_freshness_on_every_intraday_tf_and_names_the_ticker():
    now = at(WED, 14, 3)
    cyc = _run(FakeEdge(now, stale={"SOFI"}), now)
    for lab in ("1", "5", "15", "30", "60rth", "60eth"):
        failing, detail = cyc.observations[f"freshness|{lab}"]
        assert failing and "SOFI" in detail and "1/4" in detail
    assert cyc.observations["freshness|D"][0]


def test_stale_thin_symbol_never_pages():
    now = at(WED, 14, 3)
    cyc = _run(FakeEdge(now, stale={"NVEC"}), now)
    assert not any(f for k, (f, _d) in cyc.observations.items() if k.startswith("freshness"))


def test_offgrid_row_fails_grid():
    now = at(WED, 14, 3)
    cyc = _run(FakeEdge(now, offgrid={"ONON"}), now)
    assert cyc.observations["grid|5"][0] and "ONON" in cyc.observations["grid|5"][1]


def test_unverified_that_heals_on_retry_passes_and_one_that_does_not_fails():
    now = at(WED, 14, 3)
    healed = _run(FakeEdge(now, unverified={"SPY"}, heal=True), now)
    assert not healed.observations["tail_status|1"][0]
    stuck = _run(FakeEdge(now, unverified={"SPY"}, heal=False), now)
    assert stuck.observations["tail_status|1"][0] and "SPY" in stuck.observations["tail_status|1"][1]


def test_http_failure_and_latency_and_label_budget_observations():
    now = at(WED, 14, 3)
    cyc = _run(FakeEdge(now, status=502), now)
    assert cyc.observations["http|1"][0]
    w = C.LabelWindow()
    c2 = runner.run_cycle(FakeEdge(now, desc="stale-swr"), cfg(liquid=tuple(f"S{i}" for i in range(12))),
                          w, now_fn=lambda: now, sleep=lambda s: None)
    assert c2.observations["serve_labels|intraday"][0]
    c3 = runner.run_cycle(FakeEdge(now), cfg(latency_p90_ms=50, liquid=("A", "B", "C", "D", "E", "F")),
                          C.LabelWindow(), now_fn=lambda: now,
                          sleep=lambda s: None)
    assert c3.observations["latency_p90|1"][0]


def test_stream_verdicts_map_status_classes():
    assert runner.stream_verdicts({"status": 503})["stream_connect|1"].status == C.SKIP
    v = runner.stream_verdicts({"status": 401})
    assert v["stream_auth|-"].status == C.FAIL and "stream_connect|1" not in v
    ok = runner.stream_verdicts({"status": 200, "frames": 40, "finals": 4, "max_gap_s": 1.0,
                                 "hl_regressions": 0, "comparisons": [
                                     {"sym": "SPY", "tf": "1", "row_missing": False, "price_mismatch": False,
                                      "vol_mismatch": False}]})
    assert ok["stream_vs_rest|1"].status == C.PASS and ok["stream_vs_rest|5"].status == C.SKIP
    bad = runner.stream_verdicts({"status": 200, "frames": 40, "comparisons": [
        {"sym": "NVDA", "tf": "5", "row_missing": True}]})
    assert bad["stream_vs_rest|5"].status == C.FAIL and "NVDA" in bad["stream_vs_rest|5"].detail


def test_cycle_runs_the_stream_only_in_market_phases():
    calls = []

    def fake_stream(http, pairs, seconds, settle, fetch_row):
        calls.append(len(pairs))
        return {"status": 200, "frames": 10, "finals": 1, "comparisons": [], "hl_regressions": 0}
    now = at(WED, 11, 3)
    c = runner.run_cycle(FakeEdge(now), cfg(stream=True), C.LabelWindow(), now_fn=lambda: now,
                         stream_fn=fake_stream, sleep=lambda s: None)
    assert calls == [len(runner.STREAM_TICKERS) * len(runner.STREAM_TFS)]
    assert c.observations["stream_connect|1"] == (False, c.observations["stream_connect|1"][1])
    night = at(WED, 23, 0)
    runner.run_cycle(FakeEdge(night), cfg(stream=True), C.LabelWindow(), now_fn=lambda: night,
                     stream_fn=fake_stream, sleep=lambda s: None)
    assert len(calls) == 1


# ───────────────────────────── tick: durable dedupe, summary, heartbeat

def test_tick_pages_once_across_a_redeploy_and_resolves(tmp_path):
    path = str(tmp_path / "state.json")
    posts, beats = [], []
    now = [at(WED, 14, 3)]
    edge = FakeEdge(now[0], stale={"SOFI"})

    def go():
        edge.now = now[0]
        runner.tick(cfg(), C.LabelWindow(), edge, post=lambda m: posts.append(m) or True,
                    heartbeat=lambda c, p: beats.append(p) or True, state_path=path,
                    now_fn=lambda: now[0], sleep=lambda s: None)
        now[0] += 300
    go()
    assert posts == []                                   # 1st failure: not yet
    go()
    assert len(posts) == 1 and "SOFI" in posts[0] and "freshness|1" in posts[0]
    # a "redeploy": fresh process state, same durable file
    go()
    go()
    assert len(posts) == 1
    edge.stale = set()
    go()
    go()
    assert len(posts) == 2 and "resolved" in posts[1]
    assert len(beats) == 6 and all(b["next_due_s"] == 300 for b in beats)
    for m in posts:                                     # no price-like decimals in any alert
        assert not re.search(r"\d+\.\d{2,}", m)


def test_daily_summary_posts_once_after_the_post_close(tmp_path):
    path = str(tmp_path / "state.json")
    posts = []
    edge = FakeEdge(at(WED, 15, 0))
    for t in (at(WED, 15, 0), at(WED, 19, 30)):
        edge.now = t
        runner.tick(cfg(), C.LabelWindow(), edge, post=lambda m: posts.append(m) or True,
                    heartbeat=lambda c, p: True, state_path=path, now_fn=lambda t=t: t, sleep=lambda s: None)
    assert posts == []
    for t in (at(WED, 20, 30), at(WED, 21, 30)):
        edge.now = t
        runner.tick(cfg(), C.LabelWindow(), edge, post=lambda m: posts.append(m) or True,
                    heartbeat=lambda c, p: True, state_path=path, now_fn=lambda t=t: t, sleep=lambda s: None)
    assert len(posts) == 1 and "daily 2026-11-11" in posts[0] and "runs=2" in posts[0]


def test_interval_is_5min_in_market_phases_and_light_offhours():
    c = runner.Config()
    assert runner.interval_for("pre", c) == runner.interval_for("rth", c) == runner.interval_for("post", c) == 300
    assert runner.interval_for("closed", c) == 3600


def test_heartbeat_push_sends_the_service_bearer(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cr3t")
    seen = {}

    class R:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def opener(req, timeout):
        seen["auth"] = req.get_header("Authorization")
        seen["body"] = json.loads(req.data)
        return R()
    assert runner.push_heartbeat(cfg(), {"at": 1, "next_due_s": 300}, opener=opener)
    assert seen["auth"] == "Bearer s3cr3t" and seen["body"]["next_due_s"] == 300

    def boom(req, timeout):
        raise OSError("down")
    assert runner.push_heartbeat(cfg(), {}, opener=boom) is False


# ───────────────────────────── thread registration + kill switch

class FakeThread:
    started: list = []

    def __init__(self, target=None, args=(), daemon=None, name=None):
        self.target, self.args, self.daemon, self.name = target, args, daemon, name

    def start(self):
        FakeThread.started.append(self)


def test_start_registers_the_monitor_thread_by_default(monkeypatch):
    monkeypatch.delenv("CHART_MONITOR_ENABLED", raising=False)
    FakeThread.started = []
    assert runner.start(thread_factory=FakeThread) is True
    (t,) = FakeThread.started
    assert t.name == runner.THREAD_NAME and t.daemon and t.target is runner._loop
    assert isinstance(t.args[0], runner.Config)


def test_kill_switch_starts_no_monitor_and_tells_the_deadman(monkeypatch):
    monkeypatch.setenv("CHART_MONITOR_ENABLED", "0")
    FakeThread.started = []
    assert runner.start(thread_factory=FakeThread) is False
    (t,) = FakeThread.started
    assert t.target is runner.push_heartbeat and t.args[1]["disabled"] is True


def test_worker_boot_starts_the_monitor_and_exposes_its_health():
    src = (REPO / "api" / "worker_main.py").read_text(encoding="utf-8")
    assert "from api.services.chart_monitor import runner as _chart_monitor" in src
    assert "_chart_monitor.start()" in src
    assert '"chart_monitor": _chart_monitor_health()' in src
    main_src = (REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert "_cm_deadman.register(_scheduler)" in main_src
    assert "app.include_router(chart_monitor_heartbeat_router.router)" in main_src


# ───────────────────────────── dead-man (web pod)

def test_deadman_never_seen_is_silent_then_stale_pages_once_and_resolves(tmp_path):
    p = str(tmp_path / "dm.json")
    posts = []
    assert deadman.check(now=1000, path=p, post=posts.append) == []
    deadman.record({"next_due_s": 300, "phase": "rth"}, now=1000, path=p)
    deadman.check(now=1000 + 600, path=p, post=posts.append)
    assert posts == []                                   # 10 min < max(3×5m, 15m)
    deadman.check(now=1000 + 960, path=p, post=posts.append)
    assert len(posts) == 1 and "no heartbeat for 16m" in posts[0]
    deadman.check(now=1000 + 1260, path=p, post=posts.append)
    assert len(posts) == 1                               # deduped
    deadman.record({"next_due_s": 300}, now=1000 + 1300, path=p)
    deadman.check(now=1000 + 1310, path=p, post=posts.append)
    assert len(posts) == 2 and "resolved" in posts[1]
    assert deadman.status(path=p)["seen"] is True


def test_deadman_offhours_cadence_and_disabled_beat(tmp_path):
    p = str(tmp_path / "dm.json")
    posts = []
    deadman.record({"next_due_s": 3600}, now=0, path=p)
    deadman.check(now=2 * 3600, path=p, post=posts.append)
    assert posts == []                                   # 2h < 3×1h
    deadman.check(now=3 * 3600 + 60, path=p, post=posts.append)
    assert len(posts) == 1
    p2 = str(tmp_path / "dm2.json")
    deadman.record({"disabled": True}, now=0, path=p2)
    deadman.check(now=10 * 3600, path=p2, post=posts.append)
    assert len(posts) == 1


def test_deadman_record_ignores_garbage():
    beat = deadman.evaluate(None, 0)
    assert beat is None


def test_deadman_registers_its_scheduler_job(monkeypatch):
    class Sched:
        def __init__(self):
            self.jobs = []

        def add_job(self, fn, **kw):
            self.jobs.append((fn, kw))
    monkeypatch.delenv("CHART_MONITOR_DEADMAN_ENABLED", raising=False)
    s = Sched()
    assert deadman.register(s) is True
    (fn, kw), = s.jobs
    assert kw["id"] == deadman.JOB_ID and kw["trigger"] == "interval" and kw["minutes"] == 5
    assert kw["max_instances"] == 1 and kw["replace_existing"] is True
    monkeypatch.setenv("CHART_MONITOR_DEADMAN_ENABLED", "0")
    s2 = Sched()
    assert deadman.register(s2) is False and s2.jobs == []


def test_heartbeat_route_is_service_only(monkeypatch, tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import chart_monitor_heartbeat as r
    monkeypatch.setenv("PUSH_SECRET", "s3cr3t")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    app = FastAPI()
    app.include_router(r.router)
    cl = TestClient(app)
    assert cl.post("/api/internal/chart-monitor/heartbeat", json={"next_due_s": 300}).status_code == 401
    ok = cl.post("/api/internal/chart-monitor/heartbeat", json={"next_due_s": 300, "phase": "rth"},
                 headers={"Authorization": "Bearer s3cr3t"})
    assert ok.status_code == 200 and ok.json()["next_due_s"] == 300
    st = cl.get("/api/internal/chart-monitor/status", headers={"Authorization": "Bearer s3cr3t"})
    assert st.status_code == 200 and st.json()["seen"] is True
    assert cl.get("/api/internal/chart-monitor/status").status_code == 401
