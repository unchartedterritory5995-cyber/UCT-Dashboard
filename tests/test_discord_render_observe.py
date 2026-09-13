"""Observability for V2 (step 2.2): scrubbed structured events, SLOs computed from the durable
jobs table, alert rules, and the health payload.

Each alert rule is tested in both directions: it fires on the breach, and a healthy snapshot fires
nothing (an alert that fires on health gets muted; one that cannot fire is not a guard)."""
from __future__ import annotations

import json
import logging
import time

import pytest

from api.services.discord_render import observe
from api.services.discord_render.jobs_store import JobsStore


class Clock:
    def __init__(self):
        self.t = time.time()

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def store(tmp_path, clock):
    s = JobsStore(str(tmp_path / "jobs.db"), now=clock)
    yield s
    s.close()


def _job(store, clock, cid, *, command="chart", state="delivered", ack=40.0, final=2200.0, cls=None,
         quality="image", age=60.0, resumed=0):
    store.insert({"corr_id": cid, "created_at": clock() - age, "command": command, "state": "queued",
                  "token": "T", "app_id": "A", "resumed": resumed})
    if state in ("queued", "running"):
        if state == "running":
            store.claim(cid, "pod", 60)
        store.update(cid, ack_ms=ack)
        return
    store.claim(cid, "pod", 60)
    fields = {"ack_ms": ack, "failure_class": cls}
    if state == "delivered":
        fields.update(final_ms=final, quality=quality)
    store.finish(cid, state, owner="pod", **fields)


# ── scrubbing + events ──────────────────────────────────────────────────────

@pytest.mark.parametrize("raw", [
    "https://uctintelligence.com/r/chart?sym=NVDA&token=abc123secret",
    "PATCH https://discord.com/api/v10/webhooks/1474900505917653142/aW50ZXJhY3Rpb24tdG9rZW4/messages/@original",
    "GET /api/live/massive/ticker-flow?symbol=DPRO&days=1",
])
def test_scrub_removes_tokens_webhook_paths_and_query_strings(raw):
    out = observe.scrub(raw)
    for leaked in ("abc123secret", "aW50ZXJhY3Rpb24tdG9rZW4", "symbol=DPRO"):
        assert leaked not in out


def test_scrub_leaves_plain_text_alone():
    assert observe.scrub("renderer HTTP 502 for NVDA D") == "renderer HTTP 502 for NVDA D"


def test_an_event_is_one_searchable_json_line_with_known_fields_only(caplog):
    caplog.set_level(logging.INFO, logger="discord_render")
    p = observe.event("hop", cid="7f3a9c21", hop="house_render", ms=2081.26, status="ok",
                      detail="url?token=zzz", not_a_field="dropped", outcome=None)
    line = caplog.records[-1].getMessage()
    assert line.startswith("drender ") and "[" not in line.split(" ", 1)[0]   # the bare word Railway can search
    body = json.loads(line.split(" ", 1)[1])
    assert body == p
    assert body["ms"] == 2081.3 and "not_a_field" not in body and "outcome" not in body
    assert "zzz" not in body["detail"]


def test_a_hop_is_timed_even_when_it_raises(caplog):
    caplog.set_level(logging.INFO, logger="discord_render")
    with pytest.raises(ValueError):
        with observe.hop("7f3a9c21", "flow_fetch"):
            raise ValueError("x")
    body = json.loads(caplog.records[-1].getMessage().split(" ", 1)[1])
    assert body["hop"] == "flow_fetch" and body["status"] == "error" and body["ms"] >= 0


def test_an_exception_traceback_is_logged_with_the_interaction_token_removed(caplog):
    """C-13 in a new place: an httpx error names the URL it failed on, and a Discord edit URL
    contains the interaction token. The traceback must reach the logs without it."""
    caplog.set_level(logging.INFO, logger="discord_render")
    token = "aW50ZXJhY3Rpb24tdG9rZW4tc2VjcmV0"
    try:
        raise RuntimeError(f"PATCH https://discord.com/api/v10/webhooks/1474900505917653142/{token}/messages/@original failed")
    except RuntimeError:
        observe.exception("handler_crash", cid="7f3a9c21", cmd="chart")
    logged = caplog.text                          # formatted output, tracebacks included
    assert "handler_crash" in logged and "Traceback" in logged
    assert token not in logged, "the interaction token reached the logs"
    assert "[redacted]" in logged


def test_a_handler_crash_in_the_runtime_never_writes_the_interaction_token(tmp_path, caplog):
    from api.services.discord_render.delivery import DeliveryResult
    from api.services.discord_render.runtime import Job, JobRuntime
    caplog.set_level(logging.INFO, logger="discord_render")
    token = "aW50ZXJhY3Rpb24tdG9rZW4tY3Jhc2g"

    class Delivery:
        def edit_text(self, *a, **k):
            return DeliveryResult(True, 200, None, "")

        def followup(self, *a, **k):
            return DeliveryResult(True, 200, None, "")

    def crash(ctx):
        raise RuntimeError(f"PATCH https://discord.com/api/v10/webhooks/{ctx.job.app_id}/{ctx.job.token}/messages/@original -> 500")
    s = JobsStore(str(tmp_path / "jobs.db"))
    try:
        rt = JobRuntime(store=s, handlers={"chart": crash}, edit_fn=lambda *a, **k: True, delivery=Delivery(), workers=1)
        job = Job(corr_id="c0ffee01", command="chart", app_id="1474900505917653142", token=token, args={}, label="/chart NVDA")
        assert rt.run_job(job)["state"] == "messaged"
    finally:
        s.close()
    assert "handler_crash" in caplog.text and token not in caplog.text


def test_no_module_in_the_v2_package_calls_log_exception():
    """Every exception path goes through observe.exception, which scrubs. Read from the AST, so
    prose that SAYS `log.exception` (observe's own docstring does) is not a match."""
    import ast
    import pathlib

    def calls(src):
        return [n.lineno for n in ast.walk(ast.parse(src))
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "exception"
                and isinstance(n.func.value, ast.Name) and n.func.value.id in ("log", "logger", "logging")]
    assert calls("log.exception('x')") == [1]                                  # the scanner can see one
    assert calls("# log.exception('x')\n'''log.exception('y')'''\n") == []     # and prose is not one
    pkg = pathlib.Path(observe.__file__).parent
    offenders = {p.name: calls(p.read_text(encoding="utf-8")) for p in sorted(pkg.glob("*.py"))}
    assert len(offenders) >= 7, offenders                                        # it read the package
    assert not {k: v for k, v in offenders.items() if v}


def test_percentile_is_nearest_rank():
    assert observe.pct([2000, 3000], 50) == 2000
    assert observe.pct([10, 20, 30], 99) == 30
    assert observe.pct([None, None], 50) is None


# ── SLOs from the jobs table ────────────────────────────────────────────────

def test_success_rate_excludes_user_errors_and_counts_failures_by_class(store, clock):
    for i in range(8):
        _job(store, clock, f"0000000{i}", final=2000.0 + i * 100)
    _job(store, clock, "000000a1", state="messaged", cls="deadline")
    _job(store, clock, "000000a2", state="abandoned", cls="ack_late")
    _job(store, clock, "000000a3", state="messaged", cls="no_bars")          # the member's input, not our failure
    snap = observe.slo_snapshot(store, now=clock())
    hour = snap["windows"]["1h"]["all"]
    assert hour["jobs"] == 11 and hour["user_errors"] == 1
    assert hour["success_rate"] == round(8 / 10, 4)
    assert hour["failures_by_class"] == {"deadline": 1, "ack_late": 1}
    assert hour["final_ms"]["p50"] == 2300.0 and hour["image_rate"] == 1.0
    assert [f["class"] for f in snap["last_failures"]] and "no_bars" not in [f["class"] for f in snap["last_failures"]]


def test_windows_separate_the_last_hour_from_the_last_week(store, clock):
    _job(store, clock, "00000001", age=60)
    _job(store, clock, "00000002", age=3 * 86400)
    snap = observe.slo_snapshot(store, now=clock())
    assert snap["windows"]["1h"]["all"]["jobs"] == 1
    assert snap["windows"]["7d"]["all"]["jobs"] == 2


def test_acks_over_three_seconds_and_stuck_jobs_are_counted(store, clock):
    _job(store, clock, "00000001", ack=3500.0)
    _job(store, clock, "00000002", state="running", ack=20.0, age=120)
    snap = observe.slo_snapshot(store, now=clock())
    assert snap["windows"]["1h"]["all"]["ack_ms"]["over_3s"] == 1
    assert snap["stuck"] == 1


# ── alert rules: fire on the breach, stay quiet on health ───────────────────

def _healthy(store, clock, n=30):
    for i in range(n):
        _job(store, clock, f"{i:08x}", ack=30.0, final=2100.0)


def test_a_healthy_hour_fires_no_alert(store, clock):
    _healthy(store, clock)
    assert observe.evaluate_alerts(observe.slo_snapshot(store, now=clock()), renderer_misses=0) == []


def test_slow_delivery_fires_only_with_enough_jobs_inside_thirty_minutes(store, clock):
    for i in range(10):
        _job(store, clock, f"a{i:07x}", final=12000.0, age=45 * 60)          # a slow spell that ENDED 45 minutes ago
    assert "slo_final_p95" not in dict(observe.evaluate_alerts(observe.slo_snapshot(store, now=clock())))
    for i in range(9):
        _job(store, clock, f"{i:08x}", final=12000.0)
    assert "slo_final_p95" not in dict(observe.evaluate_alerts(observe.slo_snapshot(store, now=clock())))
    _job(store, clock, "0000000a", final=12000.0)
    assert "slo_final_p95" in dict(observe.evaluate_alerts(observe.slo_snapshot(store, now=clock())))


def test_low_success_fires_and_user_errors_do_not_trigger_it(store, clock):
    _healthy(store, clock, n=20)
    for i in range(5):
        _job(store, clock, f"f{i:07x}", state="messaged", cls="no_bars")
    assert "slo_success" not in dict(observe.evaluate_alerts(observe.slo_snapshot(store, now=clock())))
    _job(store, clock, "e0000001", state="abandoned", cls="internal")
    assert "slo_success" in dict(observe.evaluate_alerts(observe.slo_snapshot(store, now=clock())))


@pytest.mark.parametrize("key,setup,kwargs", [
    ("ack_over_3s", lambda s, c: _job(s, c, "00000001", ack=4000.0), {}),
    ("stuck_jobs", lambda s, c: _job(s, c, "00000001", state="running", age=120), {}),
    ("renderer_not_ready", lambda s, c: None, {"renderer_misses": 2}),
    ("failure_burst", lambda s, c: [_job(s, c, f"b{i:07x}", state="messaged", cls="deadline") for i in range(5)], {}),
])
def test_each_rule_fires_on_its_breach(store, clock, key, setup, kwargs):
    setup(store, clock)
    assert key in dict(observe.evaluate_alerts(observe.slo_snapshot(store, now=clock()), **kwargs))


def test_the_observer_reads_only_the_hour(store, clock):
    _job(store, clock, "00000001", age=3 * 86400)
    assert set(observe.slo_snapshot(store, now=clock(), windows=("1h",))["windows"]) == {"1h"}


# ── the observer: alert delivery, durable cooldown, purge ───────────────────

class Posts:
    def __init__(self, ok=True):
        self.ok, self.calls = ok, []

    def __call__(self, url, content):
        self.calls.append((url, content))
        return self.ok


def _observer(store, posts, webhook="https://discord.test/api/webhooks/1/abc", **kw):
    return observe.Observer(store, post_fn=posts, webhook_fn=lambda: webhook, cooldown_s=1800, **kw)


def test_a_breach_is_sent_once_and_the_cooldown_survives_a_new_pod(store, clock):
    _job(store, clock, "00000001", ack=4000.0)
    posts = Posts()
    assert _observer(store, posts).run_once(now=clock())["sent"] == ["ack_over_3s"]
    assert len(posts.calls) == 1 and "ack_over_3s" in posts.calls[0][1]
    # A NEW observer on the same volume — what the next pod builds — must not re-page.
    again = _observer(store, posts).run_once(now=clock())
    assert again["breached"] == ["ack_over_3s"] and again["sent"] == [] and len(posts.calls) == 1
    clock.t += 1801
    assert _observer(store, posts).run_once(now=clock())["sent"] == ["ack_over_3s"]


def test_a_failed_send_buys_no_cooldown(store, clock):
    _job(store, clock, "00000001", ack=4000.0)
    assert _observer(store, Posts(ok=False)).run_once(now=clock())["failed"] == ["ack_over_3s"]
    assert _observer(store, Posts()).run_once(now=clock())["sent"] == ["ack_over_3s"], "a failed POST silenced the alert"


def test_a_blank_webhook_logs_the_alert_under_the_cooldown_and_posts_nothing(store, clock, caplog):
    caplog.set_level(logging.INFO, logger="discord_render")
    _job(store, clock, "00000001", ack=4000.0)
    posts = Posts()
    assert _observer(store, posts, webhook="").run_once(now=clock())["logged"] == ["ack_over_3s"]
    assert posts.calls == []
    assert any('"evt":"alert"' in r.getMessage() and '"key":"ack_over_3s"' in r.getMessage() for r in caplog.records)
    assert _observer(store, posts, webhook="").run_once(now=clock())["logged"] == []


def test_a_healthy_pass_sends_nothing(store, clock):
    _healthy(store, clock)
    posts = Posts()
    assert _observer(store, posts).run_once(now=clock())["breached"] == [] and posts.calls == []


def test_a_renderer_down_on_two_probes_alerts_and_one_ready_probe_resets_it(store, clock):
    state = {"ready": False}
    probe = lambda: {"reachable": True, "ready": state["ready"], "status": 200}  # noqa: E731
    obs = _observer(store, Posts(), renderer_fn=probe)
    assert obs.run_once(now=clock())["breached"] == []                          # one miss is a blip
    assert obs.run_once(now=clock())["sent"] == ["renderer_not_ready"]
    state["ready"] = True
    assert obs.run_once(now=clock())["breached"] == [] and obs.renderer_misses == 0
    state["ready"] = False
    assert obs.run_once(now=clock())["breached"] == [], "a ready probe did not reset the count"


def test_a_crashed_probe_counts_as_a_miss_and_an_unconfigured_renderer_never_does(store, clock):
    def boom():
        raise RuntimeError("probe")
    obs = _observer(store, Posts(), renderer_fn=boom)
    obs.run_once(now=clock())
    assert obs.run_once(now=clock())["breached"] == ["renderer_not_ready"]
    assert obs.renderer == {"reachable": False, "ready": False, "error": "RuntimeError"}
    quiet = _observer(store, Posts(), renderer_fn=lambda: None)
    for _ in range(3):
        assert quiet.run_once(now=clock())["breached"] == []


def test_purge_runs_on_its_own_cadence_and_nulls_old_tokens(store, clock):
    store.insert({"corr_id": "00000001", "created_at": clock() - 17 * 60, "command": "chart", "state": "queued",
                  "token": "T", "app_id": "A"})
    obs = _observer(store, Posts(), purge_every_s=3600)
    assert obs.run_once(now=clock())["purged"] == {"tokens_nulled": 1, "rows_deleted": 0}
    assert store.get("00000001")["token"] is None
    assert obs.run_once(now=clock() + 60)["purged"] is None
    assert obs.run_once(now=clock() + 3601)["purged"] is not None


def test_posting_an_alert_never_logs_the_webhook_url(monkeypatch, caplog):
    import httpx
    caplog.set_level(logging.INFO, logger="discord_render")
    url = "https://discord.com/api/webhooks/123456/sEcReTwEbHoOkToKeN"

    def boom(*a, **k):
        raise httpx.ConnectError(f"cannot reach {url}")
    monkeypatch.setattr(httpx, "post", boom)
    assert observe.post_webhook(url, "x") is False
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(404, request=httpx.Request("POST", url)))
    assert observe.post_webhook(url, "x") is False
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "alert_send_error" in logged and "alert_send_refused" in logged and "sEcReTwEbHoOkToKeN" not in logged


def test_the_health_text_fits_discord_and_names_what_matters(store, clock):
    _healthy(store, clock, n=3)
    _job(store, clock, "dead0001", state="messaged", cls="deadline")

    class RT:
        owner = "pod-X"

        def depth(self):
            return {"interactive": 1, "background": 0, "active": 2, "workers": 6, "bg_running": 0}
    text = observe.format_health_text(observe.health_payload(
        RT(), store, renderer={"reachable": False, "ready": False, "error": "ConnectError"}, now=clock(), renderer_misses=2))
    assert len(text) <= 2000
    for want in ("NOT READY (ConnectError)", "deadline×1", "dead0001", "1 waiting", "renderer_not_ready", "1h: 4 jobs"):
        assert want in text, want


def test_a_failure_burst_is_five_in_five_minutes_not_five_in_an_hour(store, clock):
    for i in range(5):
        _job(store, clock, f"c{i:07x}", state="messaged", cls="deadline", age=600 + i * 600)
    assert "failure_burst" not in dict(observe.evaluate_alerts(observe.slo_snapshot(store, now=clock())))
    for i in range(5):
        _job(store, clock, f"d{i:07x}", state="messaged", cls="deadline", age=30 + i * 30)
    assert "failure_burst" in dict(observe.evaluate_alerts(observe.slo_snapshot(store, now=clock())))


def test_one_renderer_miss_is_a_blip_two_are_an_alert(store, clock):
    snap = observe.slo_snapshot(store, now=clock())
    assert "renderer_not_ready" not in dict(observe.evaluate_alerts(snap, renderer_misses=1))
    assert "renderer_not_ready" in dict(observe.evaluate_alerts(snap, renderer_misses=2))


def test_health_payload_carries_queue_slo_and_alert_keys(store, clock):
    class FakeRuntime:
        owner = "pod-X"

        def depth(self):
            return {"interactive": 0, "background": 0, "active": 0, "workers": 6, "bg_running": 0}
    _healthy(store, clock, n=3)
    p = observe.health_payload(FakeRuntime(), store, renderer={"ready": True}, now=clock())
    assert p["owner"] == "pod-X" and p["queue"]["workers"] == 6
    assert p["slo"]["windows"]["1h"]["all"]["jobs"] == 3 and p["alerts"] == []
