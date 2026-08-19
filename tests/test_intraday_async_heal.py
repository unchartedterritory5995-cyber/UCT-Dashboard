"""Phase 1 (instant-origin) — `_intraday_deblockable` + its serve-path wiring.

The intraday twin of `_daily_deblockable`: a cold-stale intraday tail that already
carries the LAST CLOSED session (missing only today's forming bars) is safe to
serve stale-then-heal instead of blocking the first paint on a provider call. The
client paints the prior-session tail instantly (`isIntradayTailStale`) and `since=`
fills today. Gated by `BARS_INTRADAY_ASYNC_HEAL=1`, DARK by default.

These pin the predicate (the load-bearing safety gate) and that the flag actually
moves the serve path off the synchronous provider fetch — with a CONTROL proving a
genuinely-gapped tail (missing an earlier full session) still blocks.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from api.services import bars_fetch

_ET = ZoneInfo("America/New_York")


def _unix_at(y, m, d, hh, mm) -> int:
    """Unix seconds for an ET wall-clock instant (intraday `last_ts` shape)."""
    return int(datetime(y, m, d, hh, mm, tzinfo=_ET).timestamp())


# ── The predicate ────────────────────────────────────────────────────────────

def test_flag_off_is_never_deblockable(monkeypatch):
    """Default OFF: even a perfect last-closed-session tail stays synchronous."""
    monkeypatch.delenv("BARS_INTRADAY_ASYNC_HEAL", raising=False)
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", lambda now=None: 20260818)
    assert bars_fetch._intraday_deblockable("5", _unix_at(2026, 8, 18, 15, 55)) is False


def test_last_closed_session_tail_is_deblockable(monkeypatch):
    """Flag ON + tail on the last closed session (only today's bars missing) → serve-then-heal."""
    monkeypatch.setenv("BARS_INTRADAY_ASYNC_HEAL", "1")
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", lambda now=None: 20260818)
    # 15:55 ET on the last closed session, and any bar that same day.
    assert bars_fetch._intraday_deblockable("5", _unix_at(2026, 8, 18, 15, 55)) is True
    assert bars_fetch._intraday_deblockable("60", _unix_at(2026, 8, 18, 9, 30)) is True


def test_an_earlier_session_tail_stays_synchronous(monkeypatch):
    """CONTROL: a tail missing an EARLIER full session (Fri, when Tue is last-closed)
    is NOT deblockable — serving it would pin a gapped first paint. Must stay sync."""
    monkeypatch.setenv("BARS_INTRADAY_ASYNC_HEAL", "1")
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", lambda now=None: 20260818)
    assert bars_fetch._intraday_deblockable("5", _unix_at(2026, 8, 15, 15, 55)) is False


def test_daily_and_bad_inputs_are_not_intraday_deblockable(monkeypatch):
    monkeypatch.setenv("BARS_INTRADAY_ASYNC_HEAL", "1")
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", lambda now=None: 20260818)
    assert bars_fetch._intraday_deblockable("D", 20260818) is False   # daily tf
    assert bars_fetch._intraday_deblockable("5", None) is False
    assert bars_fetch._intraday_deblockable("W", _unix_at(2026, 8, 18, 15, 55)) is False


# ── The serve-path wire ──────────────────────────────────────────────────────

def _stub_store(monkeypatch, rows, last_ts):
    """A warm-but-cold-stale intraday store: has rows, tail on last_ts."""
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: None)
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: None)
    monkeypatch.setattr(bars_fetch._sqlite, "get_last_ts", lambda s, tf: last_ts)
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars", lambda s, tf, n: rows)
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", lambda r, tf, t=None: [{"t": 1}])
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda ts, tf: True)         # force stale
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, tf: True)     # not "partial"
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)


def test_deblockable_intraday_does_NOT_call_provider_on_the_request_thread(monkeypatch):
    """With the flag ON, a cold-stale-but-last-closed-session 5m tail serves stale
    immediately — the synchronous `_delta_intraday`/`_fetch_intraday` must NOT run on
    the request thread (the heal is spawned to the bg pool instead)."""
    monkeypatch.setenv("BARS_INTRADAY_ASYNC_HEAL", "1")
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", lambda now=None: 20260818)
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260819)
    called = {"delta": 0, "fetch": 0}
    monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda *a, **k: called.__setitem__("delta", called["delta"] + 1) or [])
    monkeypatch.setattr(bars_fetch, "_fetch_intraday", lambda *a, **k: called.__setitem__("fetch", called["fetch"] + 1) or [])
    # Neuter the bg thread so nothing actually fetches; we only assert the request
    # thread didn't fetch synchronously and served the stale rows.
    monkeypatch.setattr(bars_fetch._threading, "Thread", lambda *a, **k: type("T", (), {"start": lambda self: None})())

    last_ts = _unix_at(2026, 8, 18, 15, 55)   # last closed session
    _stub_store(monkeypatch, rows=[(last_ts, 1.0, 1.1, 0.9, 1.05, 100)], last_ts=last_ts)

    resp = bars_fetch._get_bars_inner("AMD", "5", 240)
    assert resp.status_code == 200
    assert called["delta"] == 0 and called["fetch"] == 0, (
        "deblockable cold-stale intraday must NOT block on a provider call"
    )
    assert bars_fetch.get_serve_layer() == "stale-swr", "should serve the stale rows, not a sync fetch"


def test_CONTROL_gapped_intraday_still_blocks(monkeypatch):
    """The safety control: a tail missing an EARLIER full session is NOT deblockable,
    so the request path must still reach the synchronous provider fetch (Layer 4)."""
    monkeypatch.setenv("BARS_INTRADAY_ASYNC_HEAL", "1")
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", lambda now=None: 20260818)
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260819)
    # A cold-stale tail WITH stored rows falls to Layer 4's synchronous DELTA fetch
    # (not a full fetch) — the request thread blocks on the provider. Prove that runs.
    hit = {"delta": 0}
    monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda *a, **k: hit.__setitem__("delta", hit["delta"] + 1) or [])
    monkeypatch.setattr(bars_fetch, "_is_intraday_stale", lambda raw: False)
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", lambda *a, **k: None)

    last_ts = _unix_at(2026, 8, 15, 15, 55)   # an EARLIER session → gapped → not deblockable
    _stub_store(monkeypatch, rows=[(last_ts, 1.0, 1.1, 0.9, 1.05, 100)], last_ts=last_ts)
    # cold-stale intraday with an earlier-session tail falls to Layer 4; make it the
    # designated fetcher path by leaving _inflight empty.
    monkeypatch.setattr(bars_fetch, "_inflight", {})

    bars_fetch._get_bars_inner("AMD", "5", 240)
    assert hit["delta"] >= 1, "a genuinely-gapped intraday tail must still fetch synchronously"
    assert bars_fetch.get_serve_layer() == "fetch", "gapped tail must reach the synchronous Layer-4 fetcher"
