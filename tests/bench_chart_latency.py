"""Latency benchmark — informational only, not a CI gate.

Run manually: pytest tests/bench_chart_latency.py -v -s
Asserts that p95 cache-hit latency is under 50ms for a 50-ticker random sample.
"""
import time
import statistics
import pytest

from api.services import bars_disk_cache, bars_hot_tier, bar_quarantine, bar_provenance


@pytest.fixture
def tmp_setup(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_quarantine.init_schema()
    bar_provenance.init_schema()
    bars_hot_tier._reset()
    return cache_dir


@pytest.mark.benchmark
def test_cache_hit_p95_under_50ms(tmp_setup):
    """p95 cache-hit latency for 50-ticker × 5 reads = 250 reads should beat 50ms."""
    payload = {
        "source": "massive",
        "bars": [{"t": i, "o": 100, "h": 100.5, "l": 99.5, "c": 100, "v": 1000} for i in range(5000)],
    }
    syms = [f"T{i}" for i in range(50)]
    for sym in syms:
        bars_disk_cache.put(sym, "30", 5000, payload)

    times_ms = []
    for sym in syms * 5:  # 250 reads
        start = time.perf_counter()
        bars_disk_cache.get(sym, "30", 5000)
        elapsed_ms = (time.perf_counter() - start) * 1000
        times_ms.append(elapsed_ms)

    p50 = statistics.median(times_ms)
    p95 = statistics.quantiles(times_ms, n=20)[18]  # 95th percentile
    print(f"\nCache hit p50={p50:.2f}ms, p95={p95:.2f}ms (n={len(times_ms)})")
    assert p95 < 50, f"p95 {p95:.2f}ms exceeded 50ms target"


@pytest.mark.benchmark
def test_hot_tier_hit_p95_under_5ms(tmp_setup):
    """p95 hot-tier-hit latency should beat 5ms (much faster than disk)."""
    payload = {"bars": [{"t": i, "c": 100} for i in range(5000)]}
    syms = [f"T{i}" for i in range(50)]
    for sym in syms:
        bars_hot_tier.set(sym, "30", 5000, payload)

    times_ms = []
    for sym in syms * 10:  # 500 reads
        start = time.perf_counter()
        bars_hot_tier.get(sym, "30", 5000)
        elapsed_ms = (time.perf_counter() - start) * 1000
        times_ms.append(elapsed_ms)

    p95 = statistics.quantiles(times_ms, n=20)[18]
    print(f"\nHot tier p95={p95:.4f}ms (n={len(times_ms)})")
    assert p95 < 5, f"Hot tier p95 {p95:.4f}ms exceeded 5ms target"
