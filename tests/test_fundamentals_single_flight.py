"""S5 (terminal backend fixes, 2026-10-05): a cold ticker's fundamentals are built ONCE
however many callers ask at the same moment.

Before, the result was cached but N concurrent cold opens each ran the yfinance walk
on the single web process.
"""
import threading
import time

from api.services import fundamentals


def test_concurrent_cold_callers_share_one_build(monkeypatch):
    fundamentals._CACHE.invalidate("fund::ZZQX")
    calls = []
    gate = threading.Event()

    def slow_build(sym):
        calls.append(sym)
        gate.wait(5)
        return {"ticker": sym, "name": "Zed"}

    monkeypatch.setattr(fundamentals, "_build_fundamentals", slow_build)
    results = []
    threads = [threading.Thread(target=lambda: results.append(fundamentals.get_fundamentals("zzqx")))
               for _ in range(10)]
    for t in threads:
        t.start()
    time.sleep(0.3)          # let every caller arrive while the leader is still building
    gate.set()
    for t in threads:
        t.join(10)
    assert calls == ["ZZQX"]
    assert len(results) == 10 and all(r == {"ticker": "ZZQX", "name": "Zed"} for r in results)
    # each caller gets its own copy, so one caller mutating it cannot reach another
    results[0]["name"] = "changed"
    assert results[1]["name"] == "Zed"


def test_a_cached_value_never_enters_the_flight(monkeypatch):
    fundamentals._CACHE.set("fund::ZZQY", {"ticker": "ZZQY"}, ttl=60)

    def never(sym):
        raise AssertionError("built despite a cache hit")

    monkeypatch.setattr(fundamentals, "_build_fundamentals", never)
    assert fundamentals.get_fundamentals("ZZQY") == {"ticker": "ZZQY"}


def test_a_follower_that_waits_too_long_gets_an_honest_error(monkeypatch):
    from api.services import single_flight
    fundamentals._CACHE.invalidate("fund::ZZQZ")

    def timeout(key, fn, wait=None, on_role=None):
        raise single_flight.SingleFlightTimeout("slow")

    monkeypatch.setattr(single_flight, "run", timeout)
    out = fundamentals.get_fundamentals("ZZQZ")
    assert out["ticker"] == "ZZQZ" and "still loading" in out["error"]
