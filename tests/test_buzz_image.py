"""The board render's valve: cache, single-flight, and the shared render slot.

⛔ Why this file exists. /buzz is MEMBER-TRIGGERED and lands on the same
single-process web pod and the same single chart-renderer that /chart's
4-slot valve exists to protect. Before these guards, 25 members running /buzz
inside a minute meant 25 unbounded Playwright renders and 25 anyio workers
held for up to RENDER_TIMEOUT_S -- the 2026-07-01 threadpool-exhaustion
outage, with /chart degrading underneath it because it politely waits its turn.

Every test here counts RENDERS, not return values: "it gave me a PNG" is true
of the broken version too.
"""
from __future__ import annotations

import threading

import pytest

from api.services import buzz_image


class _FakeResponse:
    def __init__(self, content=b"\x89PNG-board", rows=8, status=200):
        self.content = content
        self.status_code = status
        self.is_success = 200 <= status < 300
        self.text = ""
        self.headers = {} if rows is None else {"X-Chart-Probe": str(rows)}


class _CountingClient:
    """Stands in for httpx.Client. Counts posts and can be made slow so the
    single-flight test has a window to overlap in."""

    def __init__(self, response=None, delay=0.0):
        self.calls = 0
        self._response = response or _FakeResponse()
        self._delay = delay
        self._lock = threading.Lock()

    def post(self, url, **kwargs):
        with self._lock:
            self.calls += 1
        if self._delay:
            import time as _t
            _t.sleep(self._delay)
        return self._response

    def close(self):
        pass


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setenv("CHART_RENDERER_URL", "http://renderer.local")
    monkeypatch.setenv("CHART_RENDER_BASE_URL", "http://app.local")
    buzz_image._reset_for_tests()
    yield
    buzz_image._reset_for_tests()


def test_a_second_call_inside_the_ttl_does_not_re_render():
    c = _CountingClient()
    first = buzz_image.render_board_png("open", client=c)
    second = buzz_image.render_board_png("open", client=c)
    assert first == second == b"\x89PNG-board"
    # THE assertion: the burst collapsed to one render.
    assert c.calls == 1


def test_each_window_caches_separately():
    """'since the open' and 'this month' are different boards; one must never
    be served for the other."""
    c = _CountingClient()
    buzz_image.render_board_png("open", client=c)
    buzz_image.render_board_png("month", client=c)
    buzz_image.render_board_png("open", client=c)
    assert c.calls == 2


def test_an_expired_entry_re_renders(monkeypatch):
    c = _CountingClient()
    buzz_image.render_board_png("open", client=c)
    monkeypatch.setattr(buzz_image, "_CACHE_TTL_S", -1.0)  # everything is stale
    buzz_image.render_board_png("open", client=c)
    assert c.calls == 2


def test_a_failed_render_is_not_cached():
    """A cached failure would mean one bad minute costs every caller the image
    for the whole TTL. Only a real PNG is worth remembering."""
    c = _CountingClient(response=_FakeResponse(status=500))
    assert buzz_image.render_board_png("open", client=c) is None
    assert buzz_image.render_board_png("open", client=c) is None
    assert c.calls == 2


def test_an_empty_board_is_discarded_and_not_cached():
    """probe_js says 0 rows: ready, but nothing drawn. Discard it AND leave the
    cache empty so the next caller can get a real board."""
    c = _CountingClient(response=_FakeResponse(rows=0))
    assert buzz_image.render_board_png("open", client=c) is None
    assert buzz_image.render_board_png("open", client=c) is None
    assert c.calls == 2


def test_concurrent_callers_produce_exactly_one_render():
    """Single-flight. Ten threads, one slow render, one POST. Without the
    flight lock this is ten simultaneous Playwright renders."""
    c = _CountingClient(delay=0.15)
    results = []

    def go():
        results.append(buzz_image.render_board_png("open", client=c))

    threads = [threading.Thread(target=go) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert len(results) == 10
    assert all(r == b"\x89PNG-board" for r in results)
    assert c.calls == 1


def test_no_render_slot_means_no_render_at_all(monkeypatch):
    """The slot is /chart's valve, shared. When it is full, /buzz must return
    None promptly (the member still gets the text board) rather than open a
    second unbounded lane at the renderer."""
    from api.services import discord_interactions as di
    monkeypatch.setattr(di, "RENDER_SLOTS", threading.BoundedSemaphore(1))
    di.RENDER_SLOTS.acquire()  # occupy the only slot
    monkeypatch.setattr(buzz_image, "_SLOT_WAIT_S", 0.05)
    c = _CountingClient()
    assert buzz_image.render_board_png("open", client=c) is None
    assert c.calls == 0


def test_the_slot_is_released_when_the_render_raises(monkeypatch):
    """A leaked slot is worse than a failed render: it permanently shrinks the
    valve /chart depends on."""
    from api.services import discord_interactions as di
    sem = threading.BoundedSemaphore(1)
    monkeypatch.setattr(di, "RENDER_SLOTS", sem)

    class _Boom(_CountingClient):
        def post(self, url, **kwargs):
            self.calls += 1
            raise RuntimeError("renderer exploded")

    assert buzz_image.render_board_png("open", client=_Boom()) is None
    # The slot came back: a second acquire must succeed immediately.
    assert sem.acquire(timeout=0.1) is True
    sem.release()


# ── The width arm of the probe. Counting rows caught a BLANK board; it was
# structurally blind to a MISLAID-OUT one, and that is exactly what shipped: a
# `#buzz-export` rule inside a CSS module is hashed by css-modules, so the board
# lost `width: 1000px` and stretched to fill the renderer's 1400px viewport.
# Every row still existed, so the probe reported a healthy count.

def _probe(rows_or_width):
    return _CountingClient(response=_FakeResponse(rows=rows_or_width))


def test_a_board_drawn_at_the_wrong_width_is_discarded(caplog):
    """A NEGATIVE probe is the page saying "rows drew, but my box is |n|px, not
    the width I declared". The PNG would be legible enough to look shippable and
    wrong enough to be worthless, so it never reaches the room."""
    import logging
    c = _probe(-1915)
    with caplog.at_level(logging.WARNING):
        assert buzz_image.render_board_png("open", client=c) is None
    # The measured width is in the log, not just "discarded" — the number is
    # what tells you WHICH geometry broke.
    assert "1915" in caplog.text


def test_a_wrong_width_board_is_not_cached():
    """Same contract as any other failure: one bad render must not cost every
    caller the image for a whole TTL."""
    c = _probe(-1915)
    assert buzz_image.render_board_png("open", client=c) is None
    assert buzz_image.render_board_png("open", client=c) is None
    assert c.calls == 2


def test_a_correctly_sized_board_is_kept():
    """CONTROL. Without this, discarding everything would also pass the two
    tests above."""
    c = _probe(8)
    assert buzz_image.render_board_png("open", client=c) == b"\x89PNG-board"
    assert c.calls == 1


def test_the_probe_asks_the_page_for_the_width_rather_than_restating_it():
    """⛔ The expected width has ONE authority: BuzzRender.jsx's BOARD_W, which
    it publishes as window.__buzzBoardW. If this module ever hard-codes 1000,
    the two drift and the probe starts discarding good boards (or passing bad
    ones) the day the design changes width."""
    assert "__buzzBoardW" in buzz_image.PROBE_JS
    assert "1000" not in buzz_image.PROBE_JS
    # An older cached bundle that does not publish the value must fall through
    # to the plain row count, never to a rejection.
    assert "if (!want) return rows;" in buzz_image.PROBE_JS
