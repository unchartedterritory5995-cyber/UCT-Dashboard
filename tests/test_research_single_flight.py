"""S6 (terminal backend fixes, 2026-10-05): the research composers build a cold symbol
once however many members open it at once, and get_ratings runs its three reads side by
side instead of one after another."""
import importlib
import threading
import time

import pytest

from api.services.cache import cache

MODS = [("financials", "research_fin::v2"), ("estimates", "research_est"),
        ("ownership", "research_own"), ("ratings", "research_rat")]


def _hold(m, mod, key, sym, record):
    """Put a record where the getter looks first: OWN holds its record in its own module since speed pass 2
    (2026-11-24); the other three still use the shared cache."""
    if mod == "ownership":
        m._remember(sym, record, 60)
    else:
        cache.set(f"{key}::{sym}", record, ttl=60)


def _forget(m, mod, key, sym):
    if mod == "ownership":
        m.forget_for_tests(sym)
    cache.invalidate(f"{key}::{sym}")


def _record(result):
    """The built / cached record a getter returned. `get_ownership` attaches the short interest
    block on every read (it is never part of the built record), so it is set aside here."""
    return {k: v for k, v in result.items() if k != "short"}


@pytest.mark.parametrize("mod,key", MODS)
def test_concurrent_cold_opens_share_one_build(monkeypatch, mod, key):
    m = importlib.import_module(f"api.services.research.{mod}")
    sym = "ZZSF" + mod[:2].upper()
    _forget(m, mod, key, sym)
    calls, gate = [], threading.Event()

    def slow_build(s):
        calls.append(s)
        gate.wait(5)
        return {"sym": s, "built": True}

    monkeypatch.setattr(m, f"_build_{mod}", slow_build)
    getter = getattr(m, f"get_{mod}")
    results = []
    threads = [threading.Thread(target=lambda: results.append(getter(sym.lower()))) for _ in range(10)]
    for t in threads:
        t.start()
    time.sleep(0.3)
    gate.set()
    for t in threads:
        t.join(10)
    assert calls == [sym], f"{mod}: built {len(calls)} times"
    assert len(results) == 10 and all(_record(r) == {"sym": sym, "built": True} for r in results)


@pytest.mark.parametrize("mod,key", MODS)
def test_a_cache_hit_never_enters_the_flight(monkeypatch, mod, key):
    m = importlib.import_module(f"api.services.research.{mod}")
    sym = "ZZSH" + mod[:2].upper()
    _hold(m, mod, key, sym, {"sym": sym, "cached": True})

    def never(s):
        raise AssertionError("built despite a cache hit")

    monkeypatch.setattr(m, f"_build_{mod}", never)
    try:
        assert _record(getattr(m, f"get_{mod}")(sym)) == {"sym": sym, "cached": True}
    finally:
        _forget(m, mod, key, sym)


def test_the_ratings_reads_run_side_by_side(monkeypatch):
    from api.services.research import ratings as r
    sym = "ZZRP"
    cache.invalidate(f"research_rat::{sym}")
    spans = {}

    def leg(name, value):
        def _f(*a, **k):
            t0 = time.monotonic()
            time.sleep(0.4)
            spans[name] = (t0, time.monotonic())
            return value
        return _f

    monkeypatch.setattr(r, "get_fundamentals", leg("fund", {}))
    monkeypatch.setattr(r, "get_ownership", leg("own", {}))
    monkeypatch.setattr(r, "fetch_history", leg("hist", None))
    monkeypatch.setattr(r, "resolve_entity", lambda s, **k: (None, None))
    t0 = time.monotonic()
    try:
        r._build_ratings(sym)
    except Exception:
        pass   # whatever the scoring does with empty inputs, the reads already ran
    finally:
        cache.invalidate(f"research_rat::{sym}")
    assert set(spans) == {"fund", "own", "hist"}
    latest_start = max(s for s, _ in spans.values())
    earliest_end = min(e for _, e in spans.values())
    assert latest_start < earliest_end, "the three reads did not overlap"
    assert time.monotonic() - t0 < 1.1
