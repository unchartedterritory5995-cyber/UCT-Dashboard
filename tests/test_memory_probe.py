"""The memory probe has to find caches it was never told about.

RSS on the web pod climbs and no existing diagnostic said what was holding it —
`/api/health` reports the total, `/api/health/threads` showed a flat 64 (not a
thread leak), `/api/health/cache` is about R2 bars sync.

⚠️ THE RATE, corrected: ~0.27 MB/s (~1 GB/h), sampled over a quiet 6-minute
stretch (1748.6 MB -> 1848.9 MB). The 2.2 MB/s first reported here was measured
across the BOOT window (1201 MB at 105s -> 1661 MB at 318s), which is warm-up
allocation rather than steady state — a real number describing the wrong thing.
11,665 MB has been seen on a long-lived pod, consistent with the slower rate.

What this probe then established: it is NOT the caches (2.9 MB, 0.17% of RSS)
and NOT the Python heap (+481 MB of RSS against +11% GC-tracked objects). That
leaves native memory, and `malloc_trim` below is what splits the two remaining
explanations apart.

The value of this probe is entirely in DISCOVERY: a hand-written roster of caches
would omit whichever one was added last, which is the one most likely to be the
new leak. So the load-bearing test is that it finds an instance nobody registered.
"""
from __future__ import annotations

import sys
import types

import pytest

from api.services import memory_probe as mp
from api.services.cache import TTLCache


def test_it_finds_a_cache_it_was_never_told_about():
    """THE point of the probe. A typed roster cannot do this."""
    mod = types.ModuleType("api.services._probe_fixture_mod")
    mod.some_new_cache = TTLCache()
    mod.some_new_cache.set("k", {"v": 1}, ttl=600)
    sys.modules["api.services._probe_fixture_mod"] = mod
    try:
        names = [c["name"] for c in mp.snapshot()["caches"]]
        assert "api.services._probe_fixture_mod.some_new_cache" in names, (
            f"the probe missed an unregistered cache; it found {names}"
        )
    finally:
        del sys.modules["api.services._probe_fixture_mod"]


def test_it_finds_the_real_shared_cache():
    names = [c["name"] for c in mp.snapshot()["caches"]]
    assert "api.services.cache.cache" in names, (
        f"the app's main cache is not in the report: {names}"
    )


def test_it_reports_occupancy_against_the_bound():
    """entries vs max_size is what says 'this cache is at its ceiling'."""
    row = next(c for c in mp.snapshot()["caches"] if c["name"] == "api.services.cache.cache")
    assert isinstance(row["entries"], int)
    assert isinstance(row["max_size"], int) and row["max_size"] > 0


def test_the_default_snapshot_skips_the_expensive_walks():
    """gc.get_objects() on a multi-GB process costs time AND allocates."""
    snap = mp.snapshot()
    assert snap["deep"] is False
    assert snap["gc_tracked_objects"] is None
    assert "top_types" not in snap
    assert all("estimated_bytes" not in c for c in snap["caches"]), (
        "the cheap path is estimating bytes — that is the costly walk"
    )


def test_deep_adds_attribution_not_just_more_numbers():
    mod = types.ModuleType("api.services._probe_fixture_big")
    mod.big = TTLCache()
    mod.big.set("payload", [{"x": i, "s": "y" * 200} for i in range(200)], ttl=600)
    sys.modules["api.services._probe_fixture_big"] = mod
    try:
        snap = mp.snapshot(deep=True)
        assert snap["deep"] is True
        assert isinstance(snap["gc_tracked_objects"], int)
        assert snap["top_types"], "no GC type histogram in a deep snapshot"
        row = next(c for c in snap["caches"] if c["name"].endswith("_probe_fixture_big.big"))
        assert row["estimated_bytes"] > 10_000, (
            f"a ~200-row payload estimated at {row['estimated_bytes']} bytes"
        )
        assert row["largest_value_bytes"] > 0
    finally:
        del sys.modules["api.services._probe_fixture_big"]


def test_the_biggest_cache_sorts_first():
    """The report is read top-down during an incident; ordering is the answer.

    ⚠️ The BIG cache is named to sort LAST alphabetically ('zzz_big') and the
    small one FIRST ('aaa_small'), so a name-based sort produces the WRONG order
    and only a size-based sort passes. An earlier version used '_probe_big2' and
    '_probe_small', which happen to sort the same way by name as by size — a
    mutation replacing the size key with `key=lambda r: r["name"]` SURVIVED it.
    A fixture that cannot distinguish the bug is not a rail.
    """
    big = types.ModuleType("api.services._probe_zzz_big")
    big.c = TTLCache(); big.c.set("a", ["z" * 500 for _ in range(300)], ttl=600)
    small = types.ModuleType("api.services._probe_aaa_small")
    small.c = TTLCache(); small.c.set("a", {"n": 1}, ttl=600)
    sys.modules["api.services._probe_zzz_big"] = big
    sys.modules["api.services._probe_aaa_small"] = small
    try:
        rows = mp.snapshot(deep=True)["caches"]
        order = [r["name"] for r in rows]
        big_at = order.index("api.services._probe_zzz_big.c")
        small_at = order.index("api.services._probe_aaa_small.c")
        assert big_at < small_at, (
            "the small cache sorted above the large one — the report is ordered "
            "by something other than footprint (a name sort would do exactly this)"
        )
    finally:
        del sys.modules["api.services._probe_zzz_big"]
        del sys.modules["api.services._probe_aaa_small"]


def test_an_empty_cache_does_not_blow_up_the_estimator():
    mod = types.ModuleType("api.services._probe_empty")
    mod.c = TTLCache()
    sys.modules["api.services._probe_empty"] = mod
    try:
        row = next(c for c in mp.snapshot(deep=True)["caches"]
                   if c["name"] == "api.services._probe_empty.c")
        assert row["entries"] == 0
        assert row["estimated_bytes"] in (None, 0)
    finally:
        del sys.modules["api.services._probe_empty"]


def test_an_unserializable_value_is_still_counted():
    """A cache full of objects must not silently estimate as zero.

    Falling back to sys.getsizeof keeps the row honest-ish rather than absent —
    a leak made of non-JSON objects is exactly the one worth seeing.
    """
    mod = types.ModuleType("api.services._probe_objs")
    mod.c = TTLCache()
    mod.c.set("obj", object(), ttl=600)
    sys.modules["api.services._probe_objs"] = mod
    try:
        row = next(c for c in mp.snapshot(deep=True)["caches"]
                   if c["name"] == "api.services._probe_objs.c")
        assert row["estimated_bytes"] and row["estimated_bytes"] > 0
    finally:
        del sys.modules["api.services._probe_objs"]


def test_the_payload_says_the_bytes_are_estimates():
    """A sampled number presented as exact is how a wrong conclusion gets made."""
    assert "ESTIMATE" in mp.snapshot()["note"].upper()


# ── malloc_trim: the one call that separates the two explanations ────────────


def test_trim_reports_rss_either_side_and_never_raises():
    """It must return a MEASUREMENT or say it could not measure — never throw.

    On this dev box (Windows) libc.so.6 does not exist, so the honest answer is
    `available: False` with a reason, not a fabricated 0.0 that would read as
    "nothing was held".
    """
    out = mp.malloc_trim()
    assert set(out) >= {"available", "rss_mb_before", "rss_mb_after", "released_mb", "note"}
    assert isinstance(out["available"], bool)
    assert out["note"], "an unavailable trim must say why"


def test_an_unavailable_trim_is_not_reported_as_zero_released():
    """⛔ The failure that would mislead: 'released 0.0 MB' on a platform that
    never ran the call at all reads as 'the allocator is holding nothing', which
    is the opposite conclusion from 'we did not measure'."""
    out = mp.malloc_trim()
    if not out["available"]:
        assert out["released_mb"] == 0.0
        assert "nothing measured" in out["note"], (
            "an unavailable trim must SAY nothing was measured, not imply a result"
        )


def test_the_endpoint_only_trims_when_asked():
    """A GET that always trimmed would make every status check do real work."""
    import inspect
    from api import main
    src = inspect.getsource(main.health_memory)
    assert "if trim:" in src, "the endpoint trims unconditionally"
    assert "trim: bool = False" in src, "trim must default to off"
