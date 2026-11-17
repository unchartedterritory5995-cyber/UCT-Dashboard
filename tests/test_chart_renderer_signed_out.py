"""Which of the rendered page's calls the renderer answers itself, and the many it must not.

Each negative is a request that would be answered WRONGLY (a fake 401 where the chart needs the
real answer) if the rule were written loosely.
"""
from __future__ import annotations

import asyncio
import importlib.util
import os
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DIR = os.path.join(_ROOT, "services", "chart_renderer")
sys.path.insert(0, _ROOT)
sys.path.insert(0, _DIR)

import edge_scope  # noqa: E402
from edge_scope import answered_signed_out, signed_out_enabled  # noqa: E402

PAGE = "https://uctintelligence.com/r/chart?sym=AAPL&tf=D"
SITE = "https://uctintelligence.com"


@pytest.mark.parametrize("path", [
    "/api/auth/me", "/api/auth/preferences", "/api/auth/preferences?keys=a", "/api/breadth-symbols",
    "/api/signature/definitions", "/api/market-indicators", "/api/j2/accounts", "/api/j2/positions",
    "/api/j2/trades?limit=50",
])
def test_member_only_reads_are_answered_here(path):
    assert answered_signed_out(SITE + path, PAGE) is True


@pytest.mark.parametrize("url", [
    SITE + "/api/bars/AAPL?tf=D",                 # carries the render capability, answered for real
    SITE + "/api/bars-history/AAPL",              # the chart's own data family: not ours to answer
    SITE + "/api/bars-today-pack",
    SITE + "/api/barspack/x",
    SITE + "/api/r/chart-settings?t=abc",         # the render's own settings
    SITE + "/api/ticker-meta/AAPL",
    SITE + "/api/ticker-ipo/AAPL",
    SITE + "/api/chart/markers/AAPL",
    SITE + "/api/auth/me/sessions",               # exact paths only
    SITE + "/api/auth/preferencesX",
    SITE + "/api/j2",                             # the prefix needs its slash
    SITE + "/api/j2x/accounts",
    SITE + "/api/signature/columns-batch",
    SITE + "/assets/index-abc.js",
    SITE + "/r/chart",
    "https://evil.example/api/auth/me",           # another host
    "https://uctintelligence.com.evil.example/api/auth/me",
    "http://uctintelligence.com/api/auth/me",     # not https
    "https://uctintelligence.com:8443/api/auth/me",
    "https://uctintelligence.com:bad/api/auth/me",
    "not a url", "", None,
])
def test_everything_else_goes_to_the_network(url):
    assert answered_signed_out(url, PAGE) is False


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "", None])
def test_only_a_get_is_answered_here(method):
    assert answered_signed_out(SITE + "/api/auth/preferences", PAGE, method) is False


def test_a_page_on_another_host_gets_nothing_answered():
    assert answered_signed_out(SITE + "/api/auth/me", "https://example.com/r/chart") is False
    assert answered_signed_out(SITE + "/api/auth/me", "") is False


def test_the_switch(monkeypatch):
    assert signed_out_enabled({}) is True
    for off in ("0", "false", "OFF", "no"):
        assert signed_out_enabled({edge_scope.SIGNED_OUT_SWITCH: off}) is False
    assert signed_out_enabled({edge_scope.SIGNED_OUT_SWITCH: "1"}) is True


def test_the_answer_is_the_one_web_gives_a_client_with_no_session():
    assert edge_scope.SIGNED_OUT_STATUS == 401
    assert edge_scope.SIGNED_OUT_BODY == '{"detail":"Not authenticated"}'


# ── the renderer wires it to the page ─────────────────────────────────────────

def _load_app():
    spec = importlib.util.spec_from_file_location("chart_renderer_app_signed_out", os.path.join(_DIR, "app.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Route:
    def __init__(self, url, method="GET"):
        self.request = type("R", (), {"url": url, "method": method, "headers": {}})()
        self.fulfilled = None
        self.continued = False

    async def fulfill(self, **kw):
        self.fulfilled = kw

    async def continue_(self, **kw):
        self.continued = True


class _Locator:
    first = None

    def __init__(self):
        self.first = self

    async def count(self):
        return 1

    async def screenshot(self, type="png"):
        return b"PNG"


class _Page:
    def __init__(self):
        self.routes = []

    def set_default_timeout(self, ms):
        pass

    async def route(self, matcher, handler):
        self.routes.append((matcher, handler))

    async def goto(self, url, wait_until="load"):
        pass

    async def wait_for_function(self, js, timeout=0):
        pass

    async def wait_for_timeout(self, ms):
        pass

    def locator(self, selector):
        return _Locator()


class _Ctx:
    def __init__(self):
        self.page = _Page()

    async def new_page(self):
        return self.page


def _drive(app, monkeypatch, switch=None):
    if switch is None:
        monkeypatch.delenv(edge_scope.SIGNED_OUT_SWITCH, raising=False)
    else:
        monkeypatch.setenv(edge_scope.SIGNED_OUT_SWITCH, switch)
    ctx = _Ctx()
    req = app.RenderRequest(url=PAGE, selector="#chart")
    assert asyncio.run(app._drive(ctx, req, {})) == b"PNG"
    return ctx.page


def test_a_render_answers_a_member_only_call_itself_and_lets_the_rest_through(monkeypatch):
    app = _load_app()
    page = _drive(app, monkeypatch)
    assert len(page.routes) == 1, "no edge token on this render, so only the signed-out route"
    matcher, handler = page.routes[0]
    assert matcher(SITE + "/api/auth/me") is True and matcher(SITE + "/api/bars/AAPL") is False

    mine = _Route(SITE + "/api/j2/positions")
    asyncio.run(handler(mine))
    assert mine.continued is False
    assert (mine.fulfilled["status"], mine.fulfilled["body"]) == (401, '{"detail":"Not authenticated"}')
    assert mine.fulfilled["content_type"] == "application/json"

    write = _Route(SITE + "/api/auth/preferences", method="POST")   # the matcher sees only the URL
    asyncio.run(handler(write))
    assert write.fulfilled is None and write.continued is True


def test_the_switch_removes_the_route(monkeypatch):
    app = _load_app()
    assert _drive(app, monkeypatch, switch="0").routes == []


def test_a_page_that_cannot_route_still_renders(monkeypatch):
    app = _load_app()
    monkeypatch.delenv(edge_scope.SIGNED_OUT_SWITCH, raising=False)

    class NoRoute(_Page):
        route = None

    ctx = _Ctx()
    ctx.page = NoRoute()
    assert asyncio.run(app._drive(ctx, app.RenderRequest(url=PAGE, selector="#chart"), {})) == b"PNG"
