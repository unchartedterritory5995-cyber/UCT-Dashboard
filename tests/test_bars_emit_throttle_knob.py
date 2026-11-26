"""BARS_EMIT_THROTTLE_MS: the per-(symbol, series) emit throttle of the bar broadcaster is a knob
(2026-11-25, objective 2, gap 4). It was a constant 100 ms (10 Hz per pair + a trailing flush): a
trade landing inside the window waited for the trailing flush, ~50 ms on average under flow, the
largest designed server-side delay left after the stream's event-driven send. The broadcaster runs
where the vendor socket is (stream-ingest in production). Unset = 100 ms, exactly as before;
values are clamped to 10..1000 ms; anything unreadable is ignored (100).
"""
import asyncio

import pytest

from api.services import bar_broadcaster as bbm
from api.services import trade_conditions as tc
from tests.test_bar_broadcaster_tv_replay import DAY, Harness, drain, et_ms


@pytest.fixture(autouse=True)
def _filter_on(monkeypatch):
    monkeypatch.setattr(tc, "FILTER_ENABLED", True)


@pytest.mark.parametrize("raw,want", [(None, 100), ("", 100), ("soon", 100), ("20", 20), ("20.7", 20),
                                      ("5", 10), ("0", 10), ("-3", 10), ("5000", 1000)])
def test_the_knob_is_read_clamped_and_defaults_to_100(monkeypatch, raw, want):
    if raw is None:
        monkeypatch.delenv("BARS_EMIT_THROTTLE_MS", raising=False)
    else:
        monkeypatch.setenv("BARS_EMIT_THROTTLE_MS", raw)
    assert bbm.BarBroadcaster()._emit_throttle_ms == want


def _second_trade_after(monkeypatch, env, gap_ms):
    """Two trades `gap_ms` apart in one bucket: how many frames left before any trailing flush."""
    if env is None:
        monkeypatch.delenv("BARS_EMIT_THROTTLE_MS", raising=False)
    else:
        monkeypatch.setenv("BARS_EMIT_THROTTLE_MS", env)

    async def go():
        h = Harness()
        q = h.sub("X", "5")
        await drain(q)
        m0 = et_ms(*DAY, 10, 0)
        h.bb.push_aggregate("X", {"t": m0 + 1000, "p": 10.0, "s": 100, "c": [0]}, "T")
        h.advance(gap_ms)
        h.bb.push_aggregate("X", {"t": m0 + 1000 + gap_ms, "p": 10.5, "s": 100, "c": [0]}, "T")
        msgs = await drain(q)
        return [m["bar"]["c"] for m in msgs]
    return asyncio.run(go())


def test_at_20_ms_a_trade_25_ms_after_the_last_emit_goes_at_once(monkeypatch):
    assert _second_trade_after(monkeypatch, "20", 25) == [10.0, 10.5]


def test_unset_keeps_today_a_trade_25_ms_after_the_last_emit_waits_for_the_trailing_flush(monkeypatch):
    assert _second_trade_after(monkeypatch, None, 25) == [10.0]
