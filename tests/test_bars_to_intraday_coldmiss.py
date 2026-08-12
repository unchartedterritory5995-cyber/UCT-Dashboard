"""Journal Widgets P4 — the intraday `to=` cold-miss DOOR + the snapshot warm.

History: this branch first shipped its own intraday deep-fetch fallback in
`_get_bars_to_response` (daily-only before it, so a months-old journal embed's
intraday `to=` fell to `_get_bars_inner`'s today-ending window and rendered
nothing). Replay Mode then landed a SUPERIOR mechanism on master — window-
coverage detection, range-bounded `_fetch_intraday_range`, per-window in-flight
dedupe, a dedicated concurrency semaphore with warm-vs-request semantics — and
the merge resolved to it (one mechanism, one owner). THE MECHANISM'S rail is
`tests/test_bars_replay_intraday.py`; this file pins only:
  1. the DOOR — a journal-embed-shaped request (intraday `to=`, cold store)
     reaches that mechanism and serves what it persisted, and a covered window
     never touches the provider;
  2. `kick_snapshot_warm` — the capture-time warm this branch owns.
"""

from __future__ import annotations

from api.services import bars_fetch


def _row_tuples(to_key: int) -> list[tuple]:
    # sqlite-row shape: ts first — the coverage check reads rows[-1][0].
    return [(to_key - 300, 1.0, 1.2, 0.9, 1.1, 100)]


def _fresh_cache(monkeypatch):
    """Isolate the module-level TTL cache so markers from other tests (or
    earlier runs in this process) can't make dedupe tests vacuous."""
    store: dict = {}
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: store.get(k))
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: store.__setitem__(k, v))
    return store


def test_intraday_to_cold_miss_reaches_the_replay_fetch_and_serves(monkeypatch):
    """The journal-embed scenario: a 5m embed anchored months back, on a pod
    whose store never held that window — the request must ride the replay
    cold-fetch (range-bounded, ≤ cutoff), persist, and serve the re-read."""
    calls: dict = {}
    reads = {"n": 0}

    def fake_get_bars_before(t, tf, bars, key):
        reads["n"] += 1
        return [] if reads["n"] == 1 else _row_tuples(key)

    monkeypatch.setattr(bars_fetch._sqlite, "get_bars_before", fake_get_bars_before)
    monkeypatch.setattr(
        bars_fetch, "_fetch_intraday_range",
        lambda t, tf, f, to: calls.setdefault("fetched", (t, tf, f, to)) and [] or [{"t": 1}],
    )
    monkeypatch.setattr(
        bars_fetch._sqlite, "put_bars",
        lambda *a, **k: calls.setdefault("put", (a, k)),
    )
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", lambda rows, tf, t: rows)

    resp = bars_fetch._get_bars_to_response("AMD", "5", 100, "2026-03-13")

    assert calls.get("fetched"), "cold intraday to= must trigger the replay cold fetch"
    assert calls["fetched"][0] == "AMD" and calls["fetched"][1] == "5"
    assert calls["fetched"][3] == "2026-03-13", "the fetched window must END at the cutoff"
    assert calls.get("put"), "the cold fetch must persist into the forever-store"
    assert resp.status_code == 200
    assert reads["n"] == 2, "must re-read at/before the cutoff after persisting"


def test_intraday_to_covered_window_never_calls_provider(monkeypatch):
    called = {}
    monkeypatch.setattr(
        bars_fetch._sqlite, "get_bars_before",
        lambda t, tf, bars, key: _row_tuples(key),
    )
    monkeypatch.setattr(
        bars_fetch, "_fetch_intraday_range",
        lambda *a: called.setdefault("fetch", True) and [],
    )
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", lambda rows, tf, t: rows)

    resp = bars_fetch._get_bars_to_response("AMD", "15", 100, "2026-03-13")
    assert resp.status_code == 200
    assert "fetch" not in called, "a covered window is an index seek, no provider call"


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
