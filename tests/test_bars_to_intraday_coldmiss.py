"""Journal Widgets P4 — the `to=` intraday cold-miss guard + snapshot warm.

Before this, `_get_bars_to_response`'s deep-fetch fallback was DAILY-ONLY
(`if not rows and date_tf:`): an intraday `to=` for a ticker whose intraday
history never reached this pod fell through to `_get_bars_inner`, which
fetches a window ENDING TODAY — the client's cutoff filter then empties it
and a months-old embedded chart renders nothing, silently.
"""

from __future__ import annotations

from api.services import bars_fetch


def _mk_rows(to_key: int) -> list[dict]:
    return [{"ts": to_key - 300, "o": 1.0, "h": 1.2, "l": 0.9, "c": 1.1, "v": 100}]


def _fresh_cache(monkeypatch):
    """Isolate the module-level TTL cache so markers from other tests (or
    earlier runs in this process) can't make dedupe tests vacuous."""
    store: dict = {}
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: store.get(k))
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: store.__setitem__(k, v))
    return store


def test_intraday_to_cold_miss_deep_fetches_persists_and_serves(monkeypatch):
    _fresh_cache(monkeypatch)
    calls: dict = {}
    reads = {"n": 0}

    def fake_get_bars_before(t, tf, bars, key):
        reads["n"] += 1
        return [] if reads["n"] == 1 else _mk_rows(key)

    monkeypatch.setattr(bars_fetch._sqlite, "get_bars_before", fake_get_bars_before)
    monkeypatch.setattr(
        bars_fetch, "_fetch_intraday_massive",
        lambda t, tf, n: calls.setdefault("fetched", (t, tf, n)) and [] or [{"t": 1}],
    )
    monkeypatch.setattr(
        bars_fetch._sqlite, "put_bars",
        lambda *a, **k: calls.setdefault("put", (a, k)),
    )
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", lambda rows, tf, t: rows)

    resp = bars_fetch._get_bars_to_response("AMD", "5", 100, "2026-03-13")

    assert calls.get("fetched"), "cold intraday to= must trigger the deep fetch"
    assert calls["fetched"][0] == "AMD" and calls["fetched"][1] == "5"
    assert calls.get("put"), "the deep fetch must persist into the forever-store"
    assert resp.status_code == 200
    assert reads["n"] == 2, "must re-read at/before the cutoff after persisting"


def test_intraday_to_warm_store_never_calls_provider(monkeypatch):
    called = {}
    monkeypatch.setattr(
        bars_fetch._sqlite, "get_bars_before",
        lambda t, tf, bars, key: _mk_rows(key),
    )
    monkeypatch.setattr(
        bars_fetch, "_fetch_intraday_massive",
        lambda *a: called.setdefault("fetch", True),
    )
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", lambda rows, tf, t: rows)

    resp = bars_fetch._get_bars_to_response("AMD", "15", 100, "2026-03-13")
    assert resp.status_code == 200
    assert "fetch" not in called, "warm store must be an index seek, no provider call"


def test_kick_snapshot_warm_dispatches_bounded(monkeypatch):
    _fresh_cache(monkeypatch)
    # The pytest no-op guard is itself under test elsewhere; lift it here to
    # exercise the dispatch logic.
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    calls = {}
    monkeypatch.setattr(
        bars_fetch, "_maybe_kick_deepfill",
        lambda t, tf, bars: calls.setdefault("intraday", (t, tf, bars)),
    )
    monkeypatch.setattr(
        bars_fetch, "warm_ticker_daily_deep",
        lambda t, need_before_ymd=None: calls.setdefault("daily", (t, need_before_ymd)) or True,
    )
    # Daily runs on a fire-and-forget thread — make it synchronous for the test.
    class _Sync:
        def __init__(self, target=None, daemon=None, name=None):
            self._t = target
        def start(self):
            self._t()
    monkeypatch.setattr(bars_fetch._threading, "Thread", _Sync)

    assert bars_fetch.kick_snapshot_warm("amd", "5") is True
    assert calls["intraday"] == ("AMD", "5", 5000)
    assert bars_fetch.kick_snapshot_warm("NVDA", "D", need_before_ymd=20260313) is True
    assert calls["daily"] == ("NVDA", 20260313)
    assert bars_fetch.kick_snapshot_warm("", "5") is False
    # Custom/garbage tfs take NO warm (neither rail can serve them).
    assert bars_fetch.kick_snapshot_warm("AMD", "45") is False
    assert bars_fetch.kick_snapshot_warm("AMD", "banana") is False
    # One dispatch per (ticker, tf) per TTL — a repeat is deduped.
    assert bars_fetch.kick_snapshot_warm("AMD", "5") is False


def test_kick_snapshot_warm_is_a_pytest_noop():
    # The bare-daemon-thread incident class (bars_fetch.py:172-191): test runs
    # must never dispatch provider fetches. PYTEST_CURRENT_TEST is set here.
    assert bars_fetch.kick_snapshot_warm("AMD", "D") is False


def test_intraday_cold_miss_attempts_once_per_window(monkeypatch):
    store = _fresh_cache(monkeypatch)
    fetches = {"n": 0}
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars_before", lambda *a: [])
    monkeypatch.setattr(
        bars_fetch, "_fetch_intraday_massive",
        lambda *a: fetches.__setitem__("n", fetches["n"] + 1) or [],
    )
    monkeypatch.setattr(bars_fetch, "_get_bars_inner", lambda *a: "FALLTHROUGH")
    assert bars_fetch._get_bars_to_response("AMD", "5", 100, "2026-03-13") == "FALLTHROUGH"
    assert bars_fetch._get_bars_to_response("AMD", "5", 100, "2026-03-13") == "FALLTHROUGH"
    assert fetches["n"] == 1, "an unfillable window must not re-fetch every open"
    assert any(k.startswith("to_coldmiss_AMD_5_") for k in store)
