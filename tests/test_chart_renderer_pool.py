"""chart-renderer, step 2.3 (docs/discord-render/03-architecture.md §3.7): log hygiene, the hard
ceiling, correlation, /health, and the RENDER_POOL_ENABLED pool (warm, spare contexts, recycle,
background cap).

A fake Chromium stands in for Playwright, so these pin the service's own logic. The real-browser
run is a measurement, recorded in docs/discord-render/05-progress.md.
"""
from __future__ import annotations

import asyncio
import importlib.util
import logging
import pathlib
import time

import pytest

_APP = pathlib.Path(__file__).resolve().parents[1] / "services" / "chart_renderer" / "app.py"
TOKEN = "SEKRITrendertoken123"
# The shape of the leak, from the renderer's own logs (01-failure-forensics, C-13).
PLAYWRIGHT_TIMEOUT = ("TimeoutError: Page.goto: Timeout 21000ms exceeded.\nCall log:\n"
                      f'navigating to "https://uctintelligence.com/r/chart?sym=FIZZ&tf=D&w=1296&h=670&token={TOKEN}",'
                      ' waiting until "load"\n')
HDR = {"X-Render-Secret": "s3cret"}
URL = f"https://uctintelligence.com/r/chart?sym=NVDA&tf=D&token={TOKEN}"
_ENV = ("RENDER_POOL_ENABLED", "RENDER_HARD_TIMEOUT_S", "RENDER_RECYCLE_AFTER", "RENDER_BACKGROUND_SLOTS",
        "RENDER_MAX_CONCURRENT", "RENDER_WARM_URL", "RENDER_RSS_CEILING_MB", "RENDER_POOL_KEYS")


def _load(monkeypatch, secret="s3cret", **env):
    monkeypatch.setenv("CHART_RENDERER_SECRET", secret)
    monkeypatch.setenv("RENDER_ALLOWED_HOSTS", "uctintelligence.com")
    for k in _ENV:
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, str(v))
    spec = importlib.util.spec_from_file_location("chart_renderer_app_pool", _APP)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "_rss_mb", lambda: None)
    return mod


def _client(mod):
    from fastapi.testclient import TestClient
    return TestClient(mod.app)


# ── a fake Chromium ─────────────────────────────────────────────────────────

class Browser:
    def __init__(self, delays=None):
        self.delays = delays or {}
        self.closed = False
        self.contexts = []
        self.active_bg = self.max_bg = 0
        self.gotos = []

    async def new_context(self, **kw):
        assert not self.closed, "a context was opened on a closed browser"
        c = Context(self)
        self.contexts.append(c)
        return c

    def is_connected(self):
        return not self.closed

    async def close(self):
        self.closed = True


class Context:
    def __init__(self, browser):
        self.browser, self.closed, self.pages = browser, False, 0

    async def new_page(self):
        assert not self.closed, "a closed context was reused"
        self.pages += 1
        assert self.pages == 1, "one context served two renders"
        return Page(self)

    async def close(self):
        self.closed = True


class Page:
    def __init__(self, ctx):
        self.ctx = ctx

    def set_default_timeout(self, ms):
        pass

    async def goto(self, url, wait_until="load"):
        b = self.ctx.browser
        b.gotos.append(url)
        bg = "bg=1" in url
        if bg:
            b.active_bg += 1
            b.max_bg = max(b.max_bg, b.active_bg)
        try:
            await asyncio.sleep(next((s for k, s in b.delays.items() if k in url), 0.0))
        finally:
            if bg:
                b.active_bg -= 1

    async def wait_for_function(self, js, timeout):
        return True

    async def wait_for_timeout(self, ms):
        pass

    async def set_content(self, html):
        pass

    def locator(self, sel):
        return Loc()

    async def evaluate(self, js):
        return 7


class Loc:
    @property
    def first(self):
        return self

    async def count(self):
        return 1

    async def screenshot(self, type="png"):
        return b"\x89PNG-fake"


def _launcher(**kw):
    made = []

    async def launch():
        b = Browser(**kw)
        made.append(b)
        return b
    launch.made = made
    return launch


def _req(mod, query="sym=NVDA"):
    return mod.RenderRequest(url=f"https://uctintelligence.com/r/chart?{query}")


# ── log hygiene (C-13) ──────────────────────────────────────────────────────

def test_scrub_removes_every_query_string_and_named_secret(monkeypatch):
    mod = _load(monkeypatch)
    out = mod.scrub(PLAYWRIGHT_TIMEOUT)
    assert TOKEN in PLAYWRIGHT_TIMEOUT                                   # the fixture carries the leak
    assert TOKEN not in out and "/r/chart" in out and "Timeout 21000ms" in out
    assert TOKEN not in mod.scrub(f"sig=1 token={TOKEN}&x=1")
    assert mod.scrub("renderer HTTP 502 for NVDA D") == "renderer HTTP 502 for NVDA D"


def test_a_browser_error_never_puts_the_token_in_a_log_or_the_response(monkeypatch, caplog):
    mod = _load(monkeypatch)
    caplog.set_level(logging.INFO, logger="chart-renderer")

    async def boom(req):
        raise RuntimeError(PLAYWRIGHT_TIMEOUT)
    monkeypatch.setattr(mod, "render_png", boom)
    r = _client(mod).post("/render", json={"url": URL}, headers={**HDR, "X-Correlation-Id": "7f3a9c21"})
    assert r.status_code == 502 and "Page.goto" in r.text and TOKEN not in r.text
    assert "render failed cid=7f3a9c21 path=/r/chart" in caplog.text and "Traceback" in caplog.text
    assert TOKEN not in caplog.text


def test_page_warnings_log_the_path_never_the_query(monkeypatch, caplog):
    mod = _load(monkeypatch)
    caplog.set_level(logging.INFO, logger="chart-renderer")

    class Stuck(Page):
        async def wait_for_function(self, js, timeout):
            raise RuntimeError("predicate timeout")

        async def evaluate(self, js):
            raise RuntimeError(PLAYWRIGHT_TIMEOUT)

    class Ctx(Context):
        async def new_page(self):
            return Stuck(self)
    meta = {"ready": False, "probe": None}
    png = asyncio.run(mod._drive(Ctx(Browser()), mod.RenderRequest(url=URL, probe_js="() => 1"), meta))
    assert png.startswith(b"\x89PNG") and meta["ready"] is False
    assert "ready predicate timed out for /r/chart" in caplog.text and "probe_js failed for /r/chart" in caplog.text
    assert TOKEN not in caplog.text


# ── the hard ceiling ────────────────────────────────────────────────────────

def test_the_hard_ceiling_cuts_a_hung_render_with_a_504(monkeypatch):
    mod = _load(monkeypatch, RENDER_HARD_TIMEOUT_S="0.3")

    async def hang(req):
        await asyncio.sleep(5)
        return b"", {}
    monkeypatch.setattr(mod, "render_png", hang)
    t0 = time.perf_counter()
    r = _client(mod).post("/render", json={"url": URL}, headers=HDR)
    assert r.status_code == 504 and "hard timeout" in r.json()["detail"]
    assert time.perf_counter() - t0 < 3


def test_the_default_ceiling_is_the_budget_the_request_declares(monkeypatch):
    mod = _load(monkeypatch)
    house_first = mod.RenderRequest(url=URL, settle_ms=300, ready_timeout_ms=15000)    # web's first attempt
    assert mod.hard_timeout_s(house_first) == pytest.approx(46.3)        # 21 s nav + 15 s ready + 0.3 s + 10 s
    monkeypatch.setenv("RENDER_HARD_TIMEOUT_S", "20")
    assert mod.hard_timeout_s(house_first) == 20.0


# ── correlation ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("given,logged", [("7f3a9c21", "cid=7f3a9c21"), ("../etc/passwd", "cid=-"), (None, "cid=-")])
def test_one_render_line_carries_the_correlation_id_and_only_the_path(monkeypatch, caplog, given, logged):
    mod = _load(monkeypatch)
    caplog.set_level(logging.INFO, logger="chart-renderer")

    async def ok(req):
        return b"\x89PNG-fake", {"ready": True, "probe": None}
    monkeypatch.setattr(mod, "render_png", ok)
    hdr = {**HDR, **({"X-Correlation-Id": given} if given else {})}
    assert _client(mod).post("/render", json={"url": URL}, headers=hdr).status_code == 200
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("render cid="))
    assert line.startswith(f"render {logged} path=/r/chart status=200") and TOKEN not in line and "?" not in line


# ── /health ─────────────────────────────────────────────────────────────────

def test_legacy_health_is_ready_before_the_first_render_and_carries_counters(monkeypatch):
    """Pool off, Chromium launches on the first render. A `ready` read off `browser` would call an
    idle, healthy renderer down — and web's observer pages on that."""
    mod = _load(monkeypatch)
    h = _client(mod).get("/health").json()
    assert h["ok"] is True and h["ready"] is True and h["browser_connected"] is False and h["pool_enabled"] is False
    for k in ("renders_total", "renders_since_recycle", "active", "queued", "rss_mb", "last_render_ms",
              "p95_render_ms", "recycles"):
        assert k in h, k
    assert _client(_load(monkeypatch, secret="")).get("/health").json()["ready"] is False


def test_pool_mode_is_not_ready_until_the_warm_render_ran(monkeypatch):
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1")
    monkeypatch.setattr(mod, "_launch_browser", _launcher())
    c = _client(mod)
    assert c.get("/health").json()["ready"] is False
    asyncio.run(mod.warm())
    h = c.get("/health").json()
    assert h["ready"] is True and h["browser_connected"] is True and h["pool_enabled"] is True


def test_the_warm_url_is_rendered_once_and_logged_by_path(monkeypatch, caplog):
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1",
                RENDER_WARM_URL=f"https://uctintelligence.com/r/chart?sym=NVDA&fixedbars=nvda-d&token={TOKEN}")
    caplog.set_level(logging.INFO, logger="chart-renderer")
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)
    asyncio.run(mod.warm())
    assert [u for u in launch.made[0].gotos if "fixedbars=nvda-d" in u]
    assert "warm render path=/r/chart ok" in caplog.text and TOKEN not in caplog.text and mod._warm_done


# ── the pool ────────────────────────────────────────────────────────────────

def test_with_the_pool_off_every_render_opens_and_closes_its_own_context(monkeypatch):
    mod = _load(monkeypatch)
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)

    async def main():
        for _ in range(2):
            png, meta = await mod.render_png(_req(mod))
            assert png.startswith(b"\x89PNG") and meta["ready"] is True
    asyncio.run(main())
    (b,) = launch.made
    assert len(b.contexts) == 2 and all(c.closed for c in b.contexts)
    assert mod._stats.pool_hits == mod._stats.pool_misses == 0


def test_the_pool_hands_out_a_pre_created_context_and_never_reuses_one(monkeypatch):
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1")
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)

    async def main():
        for _ in range(3):
            await mod.render_png(_req(mod))
            await asyncio.sleep(0.01)                        # the replenish task runs
    asyncio.run(main())
    (b,) = launch.made
    assert mod._stats.pool_misses == 1 and mod._stats.pool_hits == 2
    used = [c for c in b.contexts if c.pages]
    assert len(used) == 3 and all(c.closed for c in used)   # one render each (the fake asserts it)


def test_background_renders_never_hold_more_than_their_slots(monkeypatch):
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1", RENDER_MAX_CONCURRENT="3", RENDER_BACKGROUND_SLOTS="1")
    launch = _launcher(delays={"bg=1": 0.3, "member=1": 0.05})
    monkeypatch.setattr(mod, "_launch_browser", launch)

    async def one(query, prio):
        token = mod._priority.set(prio)
        try:
            return await mod.render_png(_req(mod, query))
        finally:
            mod._priority.reset(token)

    async def main():
        await one("sym=SPY", "interactive")                 # launch the browser first
        bg = [asyncio.ensure_future(one(f"bg=1&n={i}", "background")) for i in range(3)]
        await asyncio.sleep(0.05)
        t0 = time.perf_counter()
        await one("member=1", "interactive")
        waited = time.perf_counter() - t0
        await asyncio.gather(*bg)
        return waited
    waited = asyncio.run(main())
    assert launch.made[0].max_bg == 1, "background renders exceeded RENDER_BACKGROUND_SLOTS"
    assert waited < 0.25, f"a member render waited {waited:.2f}s behind background work"


def test_recycle_waits_for_in_flight_renders_then_closes_the_old_browser(monkeypatch):
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1", RENDER_MAX_CONCURRENT="4", RENDER_RECYCLE_AFTER="2")
    launch = _launcher(delays={"slow=1": 0.4})
    monkeypatch.setattr(mod, "_launch_browser", launch)

    async def main():
        slow = asyncio.ensure_future(mod.render_png(_req(mod, "slow=1")))
        await asyncio.sleep(0.05)
        await mod.render_png(_req(mod, "fast=1"))
        await mod.render_png(_req(mod, "fast=2"))          # the second finished render retires browser 1
        first = launch.made[0]
        assert mod._stats.recycles == 1
        assert first.closed is False, "the browser was closed under an in-flight render"
        await asyncio.sleep(0.01)
        assert len(launch.made) == 2, "the replacement was not launched until a render needed it"
        await mod.render_png(_req(mod, "fast=3"))
        assert len(launch.made) == 2 and "fast=3" in launch.made[1].gotos[-1]
        await slow
        assert first.closed is True, "the retired browser was never closed"
    asyncio.run(main())


def test_rss_over_the_ceiling_recycles(monkeypatch):
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1", RENDER_RSS_CEILING_MB="1000")
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)
    monkeypatch.setattr(mod, "_rss_mb", lambda: 1500.0)
    asyncio.run(mod.render_png(_req(mod)))
    assert mod._stats.recycles == 1 and launch.made[0].closed
