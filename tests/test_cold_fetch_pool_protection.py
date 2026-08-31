"""Pool protection for truly-cold provider fetches (the HAR-diagnosed outage).

A member's HAR (2026-08-19) showed a fresh browser scanning obscure tickers: 15 cold
names each triggered a ~20s provider fetch, those held threadpool workers, and 664 WARM
charts (plus a /api/watchlists) queued behind them at 5-20s.

⭐ INSTANT-CHARTS PHASE 4 (2026-08-31): a cold request NO LONGER fetches inline (which
held a request thread ~20s and forced the old block-3-then-shed compromise). It now
NEVER blocks — it kicks a BOUNDED, DEDUPED background fetch that warms bars.db and
returns a fast "warming" 503+Retry-After, so the client re-polls in ~3s and reads the
fresh SQLite rows the moment the bg fetch lands. These pin the never-block invariant:
the provider fetch must NEVER run on the request thread.
"""
from __future__ import annotations

from api.services import bars_fetch


def _cold_store(monkeypatch):
    """Truly-cold ticker: nothing in mem/sqlite/disk, this request is the fetcher."""
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: None)
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: None)
    monkeypatch.setattr(bars_fetch._sqlite, "get_last_ts", lambda s, tf: None)
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars", lambda s, tf, n: [])
    monkeypatch.setattr(bars_fetch.disk_cache, "get", lambda s, tf, n: None)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_inflight", {})


def test_cold_fetch_NEVER_runs_the_provider_on_the_request_thread(monkeypatch):
    """The whole point: a cold request returns a fast warming 503 and the ~20s provider
    fetch happens OFF the request thread. Spying _kick_cold_fetch (so nothing actually
    runs in the bg) proves the inline provider call count stays ZERO."""
    _cold_store(monkeypatch)
    calls = {"fetch": 0}
    monkeypatch.setattr(bars_fetch, "_fetch_daily",
                        lambda *a, **k: calls.__setitem__("fetch", calls["fetch"] + 1) or [])
    kicked = {}
    monkeypatch.setattr(bars_fetch, "_kick_cold_fetch",
                        lambda t, tf, b, d: kicked.update(t=t, tf=tf, bars=b))

    resp = bars_fetch._get_bars_inner("ZSQR", "D", 300)

    assert resp.status_code == 503, "a cold request must return 503 (warming), never hang"
    assert resp.headers.get("Retry-After") == "3", "client must be told to re-poll fast"
    assert calls["fetch"] == 0, "the provider fetch must NEVER run on the request thread"
    assert kicked == {"t": "ZSQR", "tf": "D", "bars": 300}, "a bounded bg warm must be kicked"
    assert bars_fetch.get_serve_layer() == "cold-bg"


def test_the_background_job_fetches_and_persists(monkeypatch):
    """_do_cold_fetch (the bg job) uses the right fetcher for the tf and writes the
    result to SQLite so the client's next poll is a warm hit."""
    got = {}
    monkeypatch.setattr(bars_fetch, "_fetch_daily",
                        lambda t, n, deep=False: [{"t": "2026-08-20", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 0}])
    monkeypatch.setattr(bars_fetch, "_is_intraday_stale", lambda raw: False)
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars",
                        lambda t, tf, bars, date_tf=False, **k: got.update(t=t, tf=tf, n=len(bars), date_tf=date_tf))

    bars_fetch._do_cold_fetch("ZSQR", "D", 300, date_tf=True)

    assert got == {"t": "ZSQR", "tf": "D", "n": 1, "date_tf": True}, "bg job must persist to bars.db"


def test_the_background_kick_is_deduped(monkeypatch):
    """Two cold requests for the same key must not submit two bg fetches — the inflight
    guard collapses them (so a scan of the same name doesn't multiply provider load)."""
    submitted = {"n": 0}

    class _FakePool:
        def submit(self, fn):
            submitted["n"] += 1  # do NOT run fn — keep the key 'in flight'
    monkeypatch.setattr(bars_fetch, "_cold_bg_pool", _FakePool())
    bars_fetch._cold_bg_inflight.clear()
    try:
        bars_fetch._kick_cold_fetch("ZDUP", "D", 300, False)
        bars_fetch._kick_cold_fetch("ZDUP", "D", 300, False)  # deduped: still in flight
        assert submitted["n"] == 1, "the second cold kick for the same key must be deduped"
    finally:
        bars_fetch._cold_bg_inflight.clear()


def test_a_WARM_ticker_serves_normally_and_never_kicks_a_cold_fetch(monkeypatch):
    """A ticker WITH stored rows takes the delta path, not the cold branch — it must
    serve 200 and never touch the cold-fetch background path."""
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: None)
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: None)
    monkeypatch.setattr(bars_fetch._sqlite, "get_last_ts", lambda s, tf: 20260818)
    rows = [(20260818, 1.0, 1.1, 0.9, 1.05, 100)]
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars", lambda s, tf, n: rows)
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", lambda r, tf, t=None: [{"t": 1}])
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda ts, tf: True)
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_daily", lambda tf, ts: True)   # force Layer 4
    monkeypatch.setattr(bars_fetch, "_daily_deblockable", lambda tf, ts: False)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, tf: True)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_inflight", {})
    monkeypatch.setattr(bars_fetch, "_delta_daily", lambda s, ts: [])
    kicked = {"n": 0}
    monkeypatch.setattr(bars_fetch, "_kick_cold_fetch",
                        lambda *a, **k: kicked.__setitem__("n", kicked["n"] + 1))

    resp = bars_fetch._get_bars_inner("AAPL", "D", 300)

    assert resp.status_code == 200, "a warm/delta ticker must serve normally"
    assert kicked["n"] == 0, "the delta path must never kick a cold fetch"
