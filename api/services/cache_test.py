"""Tests for api.services.cache.

The TTL cache underpins the bars hot path. Recent additions (delete_prefix)
need coverage so the refresh-bars admin endpoint actually wipes everything
it claims to."""
import time

from api.services.cache import TTLCache


def test_get_set_round_trip():
    c = TTLCache()
    c.set("k1", "v1", ttl=60)
    assert c.get("k1") == "v1"


def test_get_returns_none_for_expired():
    c = TTLCache()
    c.set("k1", "v1", ttl=-1)  # already expired
    assert c.get("k1") is None


def test_invalidate_removes_key():
    c = TTLCache()
    c.set("k1", "v1", ttl=60)
    c.invalidate("k1")
    assert c.get("k1") is None


def test_invalidate_missing_key_is_noop():
    """Invalidating a non-existent key must NOT raise — defensive callers
    invalidate before knowing whether the key was set."""
    c = TTLCache()
    c.invalidate("never-set")  # raises if not safe


# ── delete_prefix ────────────────────────────────────────────────────────

def test_delete_prefix_returns_count_of_deletions():
    """Every key starting with the prefix must go. Return value must
    accurately reflect how many were dropped — that's what the
    /api/admin/refresh-bars endpoint reports back to the operator."""
    c = TTLCache()
    c.set("bars_AAPL_30_200", "x", ttl=60)
    c.set("bars_AAPL_30_500", "x", ttl=60)
    c.set("bars_AAPL_60_200", "x", ttl=60)  # different tf, won't match prefix
    c.set("bars_TSLA_30_200", "x", ttl=60)  # different ticker

    n = c.delete_prefix("bars_AAPL_30_")
    assert n == 2
    assert c.get("bars_AAPL_30_200") is None
    assert c.get("bars_AAPL_30_500") is None
    # Non-matching keys preserved
    assert c.get("bars_AAPL_60_200") == "x"
    assert c.get("bars_TSLA_30_200") == "x"


def test_delete_prefix_empty_match_returns_zero():
    """Prefix matching nothing returns 0 and doesn't crash."""
    c = TTLCache()
    c.set("foo", "v", ttl=60)
    assert c.delete_prefix("nope_") == 0
    assert c.get("foo") == "v"


def test_delete_prefix_full_ticker_wipe():
    """Refresh-bars without a tf parameter calls delete_prefix with
    just ``bars_{TICKER}_`` — must wipe every timeframe for that ticker.
    This is the "blast radius" semantic the endpoint promises."""
    c = TTLCache()
    c.set("bars_AAPL_1_200", "x", ttl=60)
    c.set("bars_AAPL_30_200", "x", ttl=60)
    c.set("bars_AAPL_D_200", "x", ttl=60)
    c.set("bars_AAPL_W_200", "x", ttl=60)
    c.set("bars_TSLA_30_200", "x", ttl=60)  # different ticker, must survive

    n = c.delete_prefix("bars_AAPL_")
    assert n == 4
    assert c.get("bars_TSLA_30_200") == "x"


# ── Thread safety ───────────────────────────────────────────────────────────

def test_concurrent_get_set_does_not_raise():
    """Regression: without the internal RLock the OrderedDict ops below
    race in ways that surface as `KeyError` / `RuntimeError` on the
    /api/bars hot path under low concurrency (the 2026-05-27 incident).
    Hammer the cache from many threads at once and verify no exception
    bubbles out. The mix is intentional: eviction loop + invalidate +
    delete_prefix + get all on overlapping keys to maximize race surface."""
    import threading

    c = TTLCache()
    # Seed near the eviction threshold so the `while len > _MAX_SIZE`
    # popitem loop fires repeatedly during the contention window.
    for i in range(450):
        c.set(f"seed_{i}", i, ttl=60)

    errors: list[BaseException] = []
    stop = threading.Event()

    def writer():
        i = 0
        while not stop.is_set():
            try:
                c.set(f"k_{i % 200}", i, ttl=60)
                i += 1
            except BaseException as e:  # noqa: BLE001
                errors.append(e)
                return

    def reader():
        i = 0
        while not stop.is_set():
            try:
                c.get(f"k_{i % 200}")
                c.get(f"seed_{i % 450}")
                i += 1
            except BaseException as e:  # noqa: BLE001
                errors.append(e)
                return

    def invalidator():
        i = 0
        while not stop.is_set():
            try:
                c.invalidate(f"k_{i % 200}")
                if i % 50 == 0:
                    c.delete_prefix("seed_")
                    # Re-seed so subsequent prefix wipes still have targets.
                    for j in range(100):
                        c.set(f"seed_{j}", j, ttl=60)
                i += 1
            except BaseException as e:  # noqa: BLE001
                errors.append(e)
                return

    threads = (
        [threading.Thread(target=writer) for _ in range(4)]
        + [threading.Thread(target=reader) for _ in range(4)]
        + [threading.Thread(target=invalidator) for _ in range(2)]
    )
    for t in threads:
        t.start()
    time.sleep(0.5)
    stop.set()
    for t in threads:
        t.join(timeout=2)

    assert not errors, f"cache races raised: {errors[:3]}"
