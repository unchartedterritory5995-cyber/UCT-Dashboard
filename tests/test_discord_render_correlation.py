"""The correlation id and the render priority reach chart-renderer (step 2.3, 03 §3.7 / §3.9).

  * inside a V2 job every renderer request carries `X-Correlation-Id` — on the job's own thread and
    on the multi-chart job's pool threads;
  * the warm cycle's renders carry `X-Render-Priority: background`;
  * outside both, no header is sent, so the pre-V2 path's requests are unchanged;
  * web never logs the renderer's error body with its query string (C-13's web half: the renderer's
    502 detail quoted the page URL, render token included, and web logged 160 characters of it).
"""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from api.services import discord_chart_cache as cache
from api.services import discord_chart_hotset as hot
from api.services import discord_chart_prefs as p
from api.services import discord_interactions as di
from api.services.discord_render import ids
from api.services.discord_render.jobs_store import JobsStore
from api.services.discord_render.runtime import BACKGROUND, Job, JobRuntime

PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 200
LEAK = "LEAKtok1"
RENDERER_502 = {"detail": 'Page.goto: Timeout 21000ms exceeded.\nnavigating to '
                          f'"https://uctintelligence.com/r/chart?token={LEAK}&sym=NVDA"'}


def bars(n=30):
    return [{"t": f"2026-08-{(i % 28) + 1:02d}", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100} for i in range(n)]


@pytest.fixture(autouse=True)
def _clean():
    hot.clear_for_tests()
    cache.clear()
    yield
    hot.clear_for_tests()
    cache.clear()


@pytest.fixture
def renderer_env(monkeypatch):
    monkeypatch.setenv("CHART_RENDERER_URL", "http://chart-renderer.railway.internal:8080")
    monkeypatch.setenv("CHART_RENDERER_SECRET", "s3cret")
    monkeypatch.setenv("CHART_RENDER_TOKEN", "tok")


# ── the binding ─────────────────────────────────────────────────────────────

def test_a_binding_is_per_thread_and_restored_on_exit():
    assert ids.current() is None and ids.render_headers() == {}
    with ids.bind("7f3a9c21"):
        assert ids.render_headers() == {"X-Correlation-Id": "7f3a9c21"}
        other = []
        t = threading.Thread(target=lambda: other.append(ids.render_headers()))
        t.start()
        t.join()
        assert other == [{}], "a binding leaked to another thread"
        with ids.background():
            assert ids.render_headers() == {"X-Correlation-Id": "7f3a9c21", "X-Render-Priority": "background"}
        assert ids.render_headers() == {"X-Correlation-Id": "7f3a9c21"}
    assert ids.current() is None and ids.render_headers() == {}


def test_carry_hands_the_callers_binding_to_pool_threads():
    with ids.bind("0badc0de", background=True):
        with ThreadPoolExecutor(2) as ex:
            got = list(ex.map(ids.carry(lambda _: ids.render_headers()), range(3)))
    assert got == [{"X-Correlation-Id": "0badc0de", "X-Render-Priority": "background"}] * 3


def test_something_that_is_not_a_correlation_id_is_never_sent():
    with ids.bind("../../etc"):
        assert ids.render_headers() == {}


# ── where the binding is made ───────────────────────────────────────────────

def test_a_v2_job_runs_its_handler_bound_to_its_id_and_lane(tmp_path):
    seen = {}

    def handler(ctx):
        seen[ctx.job.corr_id] = ids.render_headers()
        ctx.edit(ctx.job.app_id, ctx.job.token, content="ok")
        return "ok"
    store = JobsStore(str(tmp_path / "jobs.db"))
    try:
        rt = JobRuntime(store=store, handlers={"chart": handler, "warm": handler}, edit_fn=lambda *a, **k: True, workers=1)
        rt.run_job(Job(corr_id="7f3a9c21", command="chart", app_id="A", token="T", args={}, label="/chart NVDA"))
        rt.run_job(Job(corr_id="0badc0de", command="warm", app_id="A", token="T", args={}, label="warm", lane=BACKGROUND))
    finally:
        store.close()
    assert seen == {"7f3a9c21": {"X-Correlation-Id": "7f3a9c21"},
                    "0badc0de": {"X-Correlation-Id": "0badc0de", "X-Render-Priority": "background"}}
    assert ids.current() is None


def test_every_chart_in_a_multi_chart_job_renders_under_the_jobs_id():
    seen, lock = [], threading.Lock()

    def house_fn(ticker, tf, stats, opts):
        with lock:
            seen.append((ticker, threading.current_thread() is threading.main_thread(), ids.render_headers()))
        return PNG + ticker.encode()
    items = [(di.ChartRequest(t, "D"), dict(p.DEFAULTS)) for t in ("CIDA", "CIDB", "CIDC")]
    with ids.bind("7f3a9c21"):
        assert di.run_multi_chart_job("1", "t", items, bars_fn=lambda *a: bars(), render_fn=lambda *a, **k: PNG,
                                      edit_fn=lambda *a, **k: True, house_fn=house_fn) == "ok"
    assert sorted(t for t, _, _ in seen) == ["CIDA", "CIDB", "CIDC"]
    assert not any(on_main for _, on_main, _ in seen), "the renders did not run on the pool's threads"
    assert all(h == {"X-Correlation-Id": "7f3a9c21"} for _, _, h in seen)


def test_the_warm_cycle_renders_as_background_and_leaves_nothing_bound():
    seen = []
    hot.record("BGW:D:default", di.ChartRequest("BGW", "D"), dict(p.DEFAULTS), 120)
    warmed = di.warm_hot_charts(bars_fn=lambda *a: bars(), render_fn=lambda *a, **k: PNG,
                                house_fn=lambda t, tf, s, o: seen.append(ids.render_headers()) or PNG)
    assert warmed == ["BGW:D:default"] and seen == [{"X-Render-Priority": "background"}]
    assert ids.render_headers() == {}


# ── the requests and the logs ───────────────────────────────────────────────

def test_the_house_render_sends_the_headers_only_when_bound_and_scrubs_the_error_body(renderer_env, caplog):
    from api.services import discord_chart_house as hs
    caplog.set_level(logging.WARNING)
    assert LEAK in httpx.Response(502, json=RENDERER_502).text[:160], "control: unscrubbed, the token is in the logged slice"
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(502, json=RENDERER_502)
    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert hs.render_house_chart("NVDA", "D", {}, client=client) is None
    assert "x-correlation-id" not in seen[-1].headers and "x-render-priority" not in seen[-1].headers
    with ids.bind("7f3a9c21"):
        hs.render_house_chart("NVDA", "D", {}, client=client)
    assert seen[-1].headers["x-correlation-id"] == "7f3a9c21" and "x-render-priority" not in seen[-1].headers
    with ids.background():
        hs.render_house_chart("NVDA", "D", {}, client=client)
    assert seen[-1].headers["x-render-priority"] == "background"
    assert "house render HTTP 502" in caplog.text and LEAK not in caplog.text


def test_the_buzz_render_sends_the_id_and_scrubs_the_error_body(renderer_env, caplog):
    from api.services import buzz_image
    caplog.set_level(logging.WARNING)
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(502, json=RENDERER_502)
    with ids.bind("0badc0de"):
        assert buzz_image._render_uncached("open", client=httpx.Client(transport=httpx.MockTransport(handler))) is None
    assert seen and seen[-1].headers["x-correlation-id"] == "0badc0de"
    assert "[buzz] render HTTP 502" in caplog.text and LEAK not in caplog.text
