"""Ingest telemetry on the Massive bars socket (2026-11-13, measurement-only):
per-minute trade/receive lag, idle vs busy, thread CPU vs wall, receive-queue depth
and per-minute arrival counts. These pin the accounting, not the feed."""
import asyncio
import time

import pytest

from api.services import bar_stream as bs


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    monkeypatch.setattr(bs, "_ing_cur", bs._new_ingest_window(None))
    monkeypatch.setattr(bs, "_ing_prev", None)
    monkeypatch.setattr(bs, "_ing_recv_ms", 0.0)
    monkeypatch.setattr(bs, "_ing_queue_source", "unavailable")


def _set_minute(m):
    bs._ing_cur = bs._new_ingest_window(m)


def test_percentiles_are_bucket_upper_bounds_capped_at_max():
    _set_minute(100)
    now = 1_000_000.0
    bs._ing_recv_ms = now
    for lag in (50, 80, 90, 120, 4000):          # 3 under 100, 1 under 250, 1 under 5000
        bs._note_ingest_event("T", {"t": now - lag}, now_ms=now)
    s = bs._hist_summary(bs._ing_cur["trade"])
    assert s == {"n": 5, "max": 4000, "p50": 100, "p90": 4000}
    # single sample: p50 is capped at the observed max, not the bucket edge
    _set_minute(101)
    bs._note_ingest_event("T", {"t": now - 30}, now_ms=now)
    assert bs._hist_summary(bs._ing_cur["trade"])["p50"] == 30
    # overflow bucket (> last edge) reports the max
    _set_minute(102)
    bs._note_ingest_event("T", {"t": now - 400_000}, now_ms=now)
    assert bs._hist_summary(bs._ing_cur["trade"])["p90"] == 400_000


def test_receive_lag_uses_the_frame_dequeue_stamp():
    _set_minute(100)
    bs._ing_recv_ms = 10_000.0
    bs._note_ingest_event("T", {"t": 9_000}, now_ms=12_000.0)
    w = bs._ing_cur
    assert w["recv"]["max"] == 1_000 and w["trade"]["max"] == 3_000


def test_missing_or_garbage_t_is_ignored_but_counted():
    _set_minute(100)
    for ev in ({}, {"t": None}, {"t": "x"}, {"t": float("nan")}):
        bs._note_ingest_event("T", ev, now_ms=1.0)
    w = bs._ing_cur
    assert w["events"]["T"] == 4
    assert w["trade"]["n"] == 0 and w["recv"]["n"] == 0
    bs._note_ingest_event("A", {"t": 0}, now_ms=1.0)   # non-T never touches lag
    assert w["events"]["A"] == 1 and w["trade"]["n"] == 0


def test_status_rolls_minutes_this_last_and_stale():
    _set_minute(100)
    bs._note_ingest_event("AM", {}, now_ms=0)
    st = bs._ingest_status(now=100 * 60 + 5)
    assert st["this_minute"]["events"]["AM"] == 1 and st["last_minute"]["events"]["AM"] == 0
    st = bs._ingest_status(now=101 * 60 + 5)        # no frames yet this minute
    assert st["this_minute"]["frames"] == 0 and st["last_minute"]["events"]["AM"] == 1
    st = bs._ingest_status(now=105 * 60)            # quiet for minutes: both empty
    assert st["this_minute"]["events"]["AM"] == 0 and st["last_minute"]["events"]["AM"] == 0
    # a previous window only counts as last_minute when it is exactly m-1
    bs._ing_prev, bs._ing_cur = bs._ing_cur, bs._new_ingest_window(103)
    assert bs._ingest_status(now=103 * 60)["last_minute"]["events"]["AM"] == 0


class _FakeWS:
    """Async-iterable socket: waits `gap` (idle) before each frame."""

    def __init__(self, n, gap):
        self.n, self.gap = n, gap

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for i in range(self.n):
            await asyncio.sleep(self.gap)
            yield f"frame{i}"


def _consume(ws, body):
    async def go():
        out = []
        async for raw in bs._timed_frames(ws):
            out.append(raw)
            body()
        return out
    return asyncio.run(go())


def test_idle_busy_split_and_frames_pass_through_unchanged():
    out = _consume(_FakeWS(4, 0.05), lambda: time.sleep(0.03))
    assert out == ["frame0", "frame1", "frame2", "frame3"]
    w = bs._ing_cur
    assert w["frames"] == 4
    assert w["idle_s"] >= 0.15 and w["busy_s"] >= 0.10
    s = bs._ingest_window_summary(w)
    assert 0.2 < s["busy_ratio"] < 0.6
    # time.sleep holds no CPU: busy CPU is far below busy wall (the GIL-wait shape)
    assert s["busy_cpu_over_wall"] < 0.5
    assert bs._ing_queue_source == "unavailable" and s["recv_queue_max"] is None


def test_busy_cpu_tracks_wall_when_the_body_computes():
    def spin():
        end = time.perf_counter() + 0.04
        while time.perf_counter() < end:
            pass
    _consume(_FakeWS(3, 0.0), spin)
    s = bs._ingest_window_summary(bs._ing_cur)
    assert s["busy_ratio"] > 0.8 and s["busy_cpu_over_wall"] > 0.5


def test_receive_queue_depth_is_sampled_when_the_library_exposes_it():
    class _Asm:
        def __init__(self):
            self.frames = [1, 2, 3]
            self.paused = True

    class _WS(_FakeWS):
        recv_messages = _Asm()

    _consume(_WS(2, 0.0), lambda: None)
    s = bs._ingest_window_summary(bs._ing_cur)
    assert bs._ing_queue_source == "websockets.recv_messages.frames"
    assert s["recv_queue_max"] == 3 and s["frames_read_paused"] == 2


def test_get_status_exposes_ingest_and_keeps_feed_fields():
    st = bs.get_status()
    assert {"this_minute", "last_minute", "recv_queue_source"} <= set(st["ingest"])
    assert {"msgs", "msgs_per_sec", "total_msgs_per_sec"} <= set(st["feed"])


def test_the_reader_loop_runs_through_the_timer():
    import inspect
    src = inspect.getsource(bs._run_websocket)
    assert "async for raw_msg in _timed_frames(ws)" in src
    assert "ingest_core.apply_frame(raw_msg, frame_ctx)" in src
    assert "count_event=_count_event" in src
    assert "_note_ingest_event(ec, ev)" in inspect.getsource(bs._count_event)


def test_a_mid_update_read_never_raises():
    # The request thread can read between writes; n=1 with max=None must read as empty.
    h = bs._new_hist()
    h["n"], h["b"][0] = 1, 1
    assert bs._hist_summary(h) == {"n": 0, "max": None, "p50": None, "p90": None}
    w = bs._new_ingest_window(100)
    w["trade"] = h
    assert bs._ingest_window_summary(w)["trade_lag_ms"]["n"] == 0


def test_hist_add_writes_max_before_n():
    import inspect
    src = inspect.getsource(bs._hist_add)
    assert src.index('h["max"] = v') < src.index('h["n"] += 1')


def test_negative_clock_skew_lag_lands_in_bucket_zero():
    _set_minute(100)
    bs._ing_recv_ms = 1_000.0
    bs._note_ingest_event("T", {"t": 1_500}, now_ms=1_000.0)
    h = bs._ing_cur["trade"]
    assert h["b"][0] == 1 and bs._hist_summary(h)["max"] == -500
