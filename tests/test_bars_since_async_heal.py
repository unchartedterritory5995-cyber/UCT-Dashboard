"""Phase 1.4 — the `since=` poll must not block on a provider (BARS_SINCE_ASYNC_HEAL).

The 30s SWR poll is the highest-QPS bars entrypoint. On a stale tail it used to do a
SYNCHRONOUS provider delta, tying up a pool thread on every open chart. With the flag
on, the poll serves the local delta immediately and heals the tail in the background
— so the synchronous `_delta_*` fetch must NOT run, and a bounded bg heal is enqueued.
"""
import api.services.bars_fetch as bf


def _wire_stale_tail(monkeypatch):
    """Make the response think the tail is stale, with a couple of local new rows to
    serve, and stub out everything that would touch the network/db/cache."""
    monkeypatch.setattr(bf, "_is_yf_only_symbol", lambda s: False)
    monkeypatch.setattr(bf, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bf._sqlite, "get_last_ts", lambda *a, **k: 1_700_000_000)
    monkeypatch.setattr(bf, "_needs_fresh", lambda *a, **k: True)
    # Local rows newer than the since threshold, so the poll has a delta to serve.
    monkeypatch.setattr(bf._sqlite, "get_bars_since",
                        lambda *a, **k: [(1_700_000_300, 1, 2, 0.5, 1.5, 100)])
    monkeypatch.setattr(bf._sqlite, "get_bars", lambda *a, **k: [])
    monkeypatch.setattr(bf, "_fmt_sqlite_bars",
                        lambda rows, tf, sym: [{"t": r[0], "o": r[1], "h": r[2],
                                                "l": r[3], "c": r[4], "v": r[5]} for r in rows])
    monkeypatch.setattr(bf.cache, "invalidate", lambda *a, **k: None)


def test_flag_on_serves_local_and_enqueues_bg_heal_without_sync_fetch(monkeypatch):
    _wire_stale_tail(monkeypatch)
    monkeypatch.setenv("BARS_SINCE_ASYNC_HEAL", "1")

    calls = {"sync": 0, "heal": 0}

    def _sync_spy(*a, **k):
        calls["sync"] += 1
        return []
    for name in ("_delta_daily", "_delta_weekly", "_delta_monthly", "_delta_intraday"):
        monkeypatch.setattr(bf, name, _sync_spy)
    monkeypatch.setattr(bf, "_enqueue_since_bg_heal",
                        lambda *a, **k: calls.__setitem__("heal", calls["heal"] + 1))

    resp = bf._get_bars_since_response("AAPL", "5", 600, "1700000000")

    import json
    body = json.loads(bytes(resp.body))
    assert body["delta"] is True
    assert len(body["bars"]) == 1               # the local delta was served immediately
    assert calls["sync"] == 0                    # NO synchronous provider fetch
    assert calls["heal"] == 1                    # bg heal enqueued exactly once


def test_flag_off_keeps_the_synchronous_delta(monkeypatch):
    _wire_stale_tail(monkeypatch)
    monkeypatch.delenv("BARS_SINCE_ASYNC_HEAL", raising=False)

    calls = {"sync": 0, "heal": 0}
    monkeypatch.setattr(bf, "_delta_intraday", lambda *a, **k: calls.__setitem__("sync", calls["sync"] + 1) or [])
    monkeypatch.setattr(bf, "_enqueue_since_bg_heal",
                        lambda *a, **k: calls.__setitem__("heal", calls["heal"] + 1))
    # put_bars would be reached only if the sync delta returned rows; it returns [].
    monkeypatch.setattr(bf._sqlite, "put_bars", lambda *a, **k: None)

    bf._get_bars_since_response("AAPL", "5", 600, "1700000000")

    assert calls["sync"] == 1                    # synchronous delta ran (legacy path)
    assert calls["heal"] == 0                    # no bg heal


def test_since_async_heal_reads_env(monkeypatch):
    monkeypatch.delenv("BARS_SINCE_ASYNC_HEAL", raising=False)
    assert bf._since_async_heal() is False
    monkeypatch.setenv("BARS_SINCE_ASYNC_HEAL", "1")
    assert bf._since_async_heal() is True
