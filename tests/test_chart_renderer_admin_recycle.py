"""POST /admin/pool/recycle — the on-demand pooled-page recycle (owner ruling B1, 2026-09-14).

The lever exists so determinism-across-recycle and the self-heal chaos row have a REAL trigger
with zero member impact. What has to be true, and what each test here is actually for:

* off means **gone**, not forbidden — 404, byte-identical to a path that was never registered, for
  every method, so a prober cannot learn that an admin lever lives at this URL;
* armed, it is bearer-gated in constant time;
* it recycles **exactly one** pooled page, never the browser and never the pool. A test that only
  asserts 200 proves nothing here, so the one-page test diffs pooled-page IDENTITIES — and carries
  a NON-VACUITY CONTROL proving that same differ reports TWO when two are recycled. An absence is
  only evidence if the instrument could have seen a presence.

A fake Chromium stands in for Playwright, exactly as `test_chart_renderer_pool.py` does, so these
pin the service's own logic and never open a browser.
"""
from __future__ import annotations

import asyncio
import importlib.util
import inspect
import logging
import pathlib
import sys

import httpx
import pytest

_APP = pathlib.Path(__file__).resolve().parents[1] / "services" / "chart_renderer" / "app.py"
TOKEN = "SEKRITrendertoken123"
URL = f"https://uctintelligence.com/r/chart?sym=NVDA&tf=D&token={TOKEN}"
ADMIN = "adm1n-t0ken-not-the-render-secret"
_ENV = ("RENDER_POOL_ENABLED", "RENDER_HARD_TIMEOUT_S", "RENDER_RECYCLE_AFTER", "RENDER_BACKGROUND_SLOTS",
        "RENDER_MAX_CONCURRENT", "RENDER_WARM_URL", "RENDER_RSS_CEILING_MB", "RENDER_POOL_KEYS",
        "RENDER_ADMIN_ENDPOINTS", "RENDER_ADMIN_TOKEN")
VIEWPORTS = ((1336, 710), (800, 600), (400, 240))


def _renderer_dir_on_path() -> None:
    """`services/chart_renderer/` on `sys.path` before `app.py` is exec'd — its flat
    `from edge_scope import ...` is what its own image does (WORKDIR /app, files copied flat)."""
    here = str(_APP.parent)
    if here not in sys.path:
        sys.path.insert(0, here)


def _load(monkeypatch, secret="s3cret", **env):
    _renderer_dir_on_path()
    monkeypatch.setenv("CHART_RENDERER_SECRET", secret)
    monkeypatch.setenv("RENDER_ALLOWED_HOSTS", "uctintelligence.com")
    for k in _ENV:
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, str(v))
    spec = importlib.util.spec_from_file_location("chart_renderer_app_admin", _APP)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "_rss_mb", lambda: None)
    return mod


def _armed(monkeypatch, **env):
    return _load(monkeypatch, RENDER_POOL_ENABLED="1", RENDER_ADMIN_ENDPOINTS="1",
                 RENDER_ADMIN_TOKEN=ADMIN, **env)


# ── a fake Chromium ─────────────────────────────────────────────────────────

class Browser:
    def __init__(self, delays=None):
        self.delays = delays or {}
        self.closed = False
        self.contexts = []
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
        await asyncio.sleep(next((s for k, s in b.delays.items() if k in url), 0.0))

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


# ── drivers ─────────────────────────────────────────────────────────────────

async def _call(mod, path="/admin/pool/recycle", method="post", token=ADMIN, scheme="Bearer", cid=None):
    headers = {}
    if token is not None:
        headers["Authorization"] = f"{scheme} {token}"
    if cid is not None:
        headers["X-Correlation-Id"] = cid
    transport = httpx.ASGITransport(app=mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://renderer") as c:
        return await getattr(c, method)(path, headers=headers)


async def _fill_pool(mod, viewports=VIEWPORTS):
    """One render per viewport leaves one spare context per viewport standing by."""
    for w, h in viewports:
        await mod.render_png(mod.RenderRequest(url=URL, width=w, height=h))
        await asyncio.sleep(0.02)                    # the replenish task creates the spare
    assert len(mod._current.spare) == len(viewports), "the pool did not fill; the test proves nothing"


def _ids(state: dict) -> set:
    return {p["id"] for p in state["pages"]}


# ── the gate: off means GONE, not forbidden ─────────────────────────────────

def test_with_the_flag_off_the_route_is_404_and_is_indistinguishable_from_never_written(monkeypatch):
    """⛔ 404, NOT 403. A 403 tells an unauthenticated prober that an admin lever lives here and
    that only a credential stands between them and it."""
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1", RENDER_ADMIN_TOKEN=ADMIN)   # flag deliberately absent

    async def main():
        armed_ok = await _call(mod)                                   # correct bearer, flag off
        no_such = await _call(mod, path="/admin/pool/no-such-lever")  # a path that was never written
        health = await _call(mod, path="/health", method="get")
        return armed_ok, no_such, health
    armed_ok, no_such, health = asyncio.run(main())

    assert armed_ok.status_code == 404
    assert armed_ok.status_code != 403, "403 would publish the existence of the lever"
    assert armed_ok.json() == no_such.json() == {"detail": "Not Found"}
    # NON-VACUITY: the app is mounted and answering, so the 404 is the gate and not a dead client.
    assert health.status_code == 200


def test_the_flag_is_what_makes_the_404_a_404(monkeypatch):
    """The control for the test above: ONE module, ONE request, ONE variable flipped between them.
    Without it the 404 could be a misspelt path and nobody would know. It also pins that the gate
    is read PER REQUEST — a module-level capture would keep the second call a 404 and make the
    'arm it with a variable' operation a fiction."""
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1", RENDER_ADMIN_TOKEN=ADMIN)
    assert asyncio.run(_call(mod)).status_code == 404
    monkeypatch.setenv("RENDER_ADMIN_ENDPOINTS", "1")
    assert asyncio.run(_call(mod)).status_code == 200


@pytest.mark.parametrize("value", ["0", "", "true", "yes", "on", " 2 ", "01"])
def test_only_the_literal_1_arms_the_lever(monkeypatch, value):
    """An enablement gate fails closed on anything it does not recognise — including the spellings
    that read as 'on' to a human."""
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1", RENDER_ADMIN_ENDPOINTS=value, RENDER_ADMIN_TOKEN=ADMIN)
    assert asyncio.run(_call(mod)).status_code == 404


def test_every_other_method_is_404_too_armed_or_not(monkeypatch):
    """⭐ Registering a path makes every OTHER method answer 405, which is itself a tell: a path
    that does not exist answers 404 to everything."""
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1", RENDER_ADMIN_TOKEN=ADMIN)
    for armed in ("", "1"):
        monkeypatch.setenv("RENDER_ADMIN_ENDPOINTS", armed)
        for method in ("get", "put", "patch", "delete"):
            r = asyncio.run(_call(mod, method=method))
            assert r.status_code == 404, f"{method.upper()} leaked {r.status_code} (armed={armed!r})"


# ── the bearer ──────────────────────────────────────────────────────────────

def test_armed_without_a_bearer_is_401(monkeypatch):
    mod = _armed(monkeypatch)
    r = asyncio.run(_call(mod, token=None))
    assert r.status_code == 401 and "bearer" in r.json()["detail"]


@pytest.mark.parametrize("given", ["", "wrong", ADMIN + "x", ADMIN[:-1], ADMIN.upper(), "s3cret"])
def test_a_wrong_bearer_is_401(monkeypatch, given):
    """`s3cret` is in that list on purpose: CHART_RENDERER_SECRET is handed to `web` on every
    render, so the operator lever must NOT be reachable with it."""
    mod = _armed(monkeypatch)
    assert asyncio.run(_call(mod, token=given)).status_code == 401


def test_a_non_bearer_scheme_is_401(monkeypatch):
    mod = _armed(monkeypatch)
    assert asyncio.run(_call(mod, scheme="Basic")).status_code == 401


def test_an_unconfigured_admin_token_locks_the_lever_rather_than_opening_it(monkeypatch):
    """⛔ Armed with no token configured must NEVER be 200 — an empty secret that matches an empty
    header is an open door wearing a lock."""
    mod = _load(monkeypatch, RENDER_POOL_ENABLED="1", RENDER_ADMIN_ENDPOINTS="1")   # no RENDER_ADMIN_TOKEN
    assert asyncio.run(_call(mod, token="")).status_code == 401
    assert asyncio.run(_call(mod, token=None)).status_code == 401
    assert asyncio.run(_call(mod, token=ADMIN)).status_code == 401


def test_the_bearer_is_compared_in_constant_time(monkeypatch):
    """A behavioural test cannot tell `==` from `compare_digest`, so this reads the source. The
    leak is real: a byte-by-byte `==` on a secret hands its prefix to anyone who can time this."""
    mod = _armed(monkeypatch)
    src = inspect.getsource(mod._bearer_ok)
    assert "compare_digest" in src
    assert "given == token" not in src and "token == given" not in src


# ── exactly one page, and not the browser ───────────────────────────────────

def test_a_recycle_names_the_page_it_recycled_and_its_replacement(monkeypatch):
    mod = _armed(monkeypatch)
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)

    async def main():
        await _fill_pool(mod)
        return await _call(mod)
    r = asyncio.run(main())

    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["reason"] is None
    assert body["recycled"]["id"] in _ids(body["before"])
    assert body["recycled"]["id"] not in _ids(body["after"])
    assert body["replaced_by"]["id"] in _ids(body["after"])
    assert body["replaced_by"]["id"] not in _ids(body["before"])
    for state in ("before", "after"):
        for k in ("size", "in_use", "idle", "pages", "recycles", "page_recycles"):
            assert k in body[state], f"{state} is missing {k}"


def test_exactly_one_pooled_page_is_recycled(monkeypatch):
    """⛔ The load-bearing one. Size unchanged, one identity gone, one identity new, and every OTHER
    pooled context still open — a 200 alone would say none of that."""
    mod = _armed(monkeypatch)
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)

    async def main():
        await _fill_pool(mod)
        survivors = {p.id: p.ctx for p in mod._current.spare.values()}
        r = await _call(mod)
        return r.json(), survivors
    body, survivors = asyncio.run(main())

    before, after = body["before"], body["after"]
    assert before["idle"] == after["idle"] == len(VIEWPORTS)
    assert before["size"] == after["size"]
    gone = _ids(before) - _ids(after)
    arrived = _ids(after) - _ids(before)
    assert len(gone) == 1 and len(arrived) == 1
    assert gone == {body["recycled"]["id"]} and arrived == {body["replaced_by"]["id"]}

    recycled_ctx = survivors.pop(body["recycled"]["id"])
    assert recycled_ctx.closed is True, "the recycled page's context was never closed"
    assert [c.closed for c in survivors.values()] == [False] * len(survivors), \
        "a page other than the recycled one was closed"
    assert mod._stats.page_recycles == 1


def test_the_instrument_would_have_seen_a_second_page_recycled(monkeypatch):
    """⭐ NON-VACUITY CONTROL for the test above. The same differ, over two recycles, must report
    TWO — otherwise `len(gone) == 1` is a statement about the differ, not about the service."""
    mod = _armed(monkeypatch)
    monkeypatch.setattr(mod, "_launch_browser", _launcher())

    async def main():
        await _fill_pool(mod)
        first = (await _call(mod)).json()
        second = (await _call(mod)).json()
        return first, second
    first, second = asyncio.run(main())

    gone = _ids(first["before"]) - _ids(second["after"])
    arrived = _ids(second["after"]) - _ids(first["before"])
    assert len(gone) == 2, f"the differ cannot count to two: {gone}"
    assert len(arrived) == 2
    assert gone == {first["recycled"]["id"], second["recycled"]["id"]}
    assert first["recycled"]["id"] != second["recycled"]["id"], "the same page was taken twice"
    assert mod._stats.page_recycles == 2
    assert first["before"]["idle"] == second["after"]["idle"] == len(VIEWPORTS)


def test_a_recycle_does_not_restart_the_browser(monkeypatch):
    """Never the browser: same slot identity, no second launch, the browser object still open, and
    the ORGANIC recycle counter untouched — conflating the two would make /health's `recycles` and
    `renders_since_recycle` stop meaning 'a new Chromium'."""
    mod = _armed(monkeypatch)
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)

    async def main():
        await _fill_pool(mod)
        renders_before = mod._current.renders
        body = (await _call(mod)).json()
        return body, renders_before
    body, renders_before = asyncio.run(main())

    assert body["before"]["browser"]["id"] == body["after"]["browser"]["id"]
    assert len(launch.made) == 1, "a recycle launched a second Chromium"
    assert launch.made[0].closed is False, "a recycle closed the browser"
    assert body["after"]["browser"]["connected"] is True
    assert body["after"]["browser"]["retired"] is False
    assert body["after"]["browser"]["renders_since_launch"] == renders_before
    assert mod._stats.recycles == 0 and mod._stats.page_recycles == 1


def test_renders_keep_working_on_the_same_browser_after_a_recycle(monkeypatch):
    mod = _armed(monkeypatch)
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)

    async def main():
        await _fill_pool(mod)
        assert (await _call(mod)).status_code == 200
        png, meta = await mod.render_png(mod.RenderRequest(url=URL))
        return png, meta
    png, meta = asyncio.run(main())
    assert png.startswith(b"\x89PNG") and meta["ready"] is True
    assert len(launch.made) == 1


# ── it says so rather than forcing it ───────────────────────────────────────

def test_an_in_flight_render_is_never_taken_and_the_answer_says_so(monkeypatch):
    """A context handed to a render is popped out of `slot.spare` before the render starts, so
    everything still in the pool is idle BY CONSTRUCTION. With the only page in flight the lever
    reports an empty pool and takes nothing — and the render finishes normally."""
    mod = _armed(monkeypatch, RENDER_MAX_CONCURRENT="4")
    launch = _launcher(delays={"slow=1": 0.4})
    monkeypatch.setattr(mod, "_launch_browser", launch)

    async def main():
        await _fill_pool(mod, viewports=((1336, 710),))
        slow = asyncio.ensure_future(mod.render_png(
            mod.RenderRequest(url=f"https://uctintelligence.com/r/chart?slow=1&token={TOKEN}")))
        await asyncio.sleep(0.05)
        body = (await _call(mod)).json()
        png, _meta = await slow
        return body, png
    body, png = asyncio.run(main())

    assert body["recycled"] is None and body["replaced_by"] is None
    assert "pool empty" in body["reason"]
    assert body["before"]["in_use"] == 1 and body["before"]["idle"] == 0
    assert mod._stats.page_recycles == 0
    assert png.startswith(b"\x89PNG"), "the in-flight render was disturbed"
    assert launch.made[0].closed is False


def test_a_replacement_that_could_not_be_created_is_reported_rather_than_implied(monkeypatch):
    """The page WAS recycled and the pool is one short. Reporting a clean `recycled` with no word
    about the missing replacement would leave the operator reading `idle` and blaming the diff."""
    mod = _armed(monkeypatch)
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)

    async def main():
        await _fill_pool(mod)

        async def refuse(**kw):
            raise RuntimeError("out of memory")
        launch.made[0].new_context = refuse
        return (await _call(mod)).json()
    body = asyncio.run(main())

    assert body["recycled"] is not None and body["replaced_by"] is None
    assert "replacement" in body["reason"]
    assert body["after"]["idle"] == body["before"]["idle"] - 1
    assert mod._stats.page_recycles == 1
    assert launch.made[0].closed is False and len(launch.made) == 1


def test_with_the_pool_off_it_says_so_and_never_launches_a_browser(monkeypatch):
    mod = _load(monkeypatch, RENDER_ADMIN_ENDPOINTS="1", RENDER_ADMIN_TOKEN=ADMIN)   # pool deliberately off
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)
    body = asyncio.run(_call(mod)).json()
    assert body["recycled"] is None and "pool disabled" in body["reason"]
    assert launch.made == [], "the lever launched a browser"
    assert mod._stats.page_recycles == 0


def test_before_anything_is_pooled_it_says_there_is_no_browser(monkeypatch):
    mod = _armed(monkeypatch)
    launch = _launcher()
    monkeypatch.setattr(mod, "_launch_browser", launch)
    body = asyncio.run(_call(mod)).json()
    assert body["recycled"] is None and "no live browser" in body["reason"]
    assert launch.made == [], "the lever launched a browser"


# ── logging + /health ───────────────────────────────────────────────────────

def test_the_recycle_logs_one_line_carrying_the_correlation_id(monkeypatch, caplog):
    mod = _armed(monkeypatch)
    monkeypatch.setattr(mod, "_launch_browser", _launcher())
    caplog.set_level(logging.INFO, logger="chart-renderer")

    async def main():
        await _fill_pool(mod)
        return (await _call(mod, cid="7f3a9c21")).json()
    body = asyncio.run(main())

    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("pool recycle "))
    assert "cid=7f3a9c21" in line and body["recycled"]["id"] in line
    assert TOKEN not in caplog.text, "the render token reached a log line"
    assert body["corr_id"] == "7f3a9c21"


def test_a_bad_correlation_id_is_not_echoed_into_the_log(monkeypatch, caplog):
    mod = _armed(monkeypatch)
    monkeypatch.setattr(mod, "_launch_browser", _launcher())
    caplog.set_level(logging.INFO, logger="chart-renderer")
    body = asyncio.run(_call(mod, cid="../etc/passwd")).json()
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("pool recycle "))
    assert "cid=-" in line and "passwd" not in caplog.text
    assert body["corr_id"] == "-"


def test_health_reports_the_two_recycle_counters_separately(monkeypatch):
    """⛔ `recycles` must keep meaning 'a new Chromium'. A page recycle gets its own counter."""
    mod = _armed(monkeypatch)
    monkeypatch.setattr(mod, "_launch_browser", _launcher())

    async def main():
        await _fill_pool(mod)
        await _call(mod)
        return (await _call(mod, path="/health", method="get")).json()
    h = asyncio.run(main())
    assert h["recycles"] == 0 and h["page_recycles"] == 1
