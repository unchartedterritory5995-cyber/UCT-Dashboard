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


# ── the periodic trim must actually be wired ────────────────────────────────


def test_the_trim_job_is_registered():
    """A fix for a measured cause that never runs is not a fix.

    Prod evidence for it: RSS 1490.0 -> 1276.6 MB, 213.4 MB released in ONE call
    on an 8-minute-old pod.
    """
    import ast
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    ids = set()
    for n in ast.walk(ast.parse(src)):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "add_job"):
            for kw in n.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    ids.add(kw.value.value)
    assert "malloc_trim" in ids, "no add_job(id='malloc_trim') in api/main.py"
    # Control: the probe really reads this file's job ids.
    assert len(ids) > 50, f"job-id probe found only {len(ids)} ids — not discriminating"


def test_the_trim_job_logs_duration_not_just_megabytes():
    """The duration is the signal that says when this shape stops being safe.

    malloc_trim takes the allocator's arena locks. Megabytes-released alone would
    look like a success right up until the call started stalling requests.
    """
    import inspect
    from api import main
    src = inspect.getsource(main.lifespan)
    assert "elapsed_ms" in src, (
        "the trim job logs no duration — a slow trim would be invisible"
    )


# ── per-job memory attribution ───────────────────────────────────────────────


class _FakeScheduler:
    def __init__(self): self.registered = []
    def add_job(self, func, *a, **kw):
        self.registered.append((func, a, kw)); return ("job", func)


def test_instrumentation_wraps_every_job_without_a_roster():
    """DERIVED: wrapping add_job once covers all 135 jobs — and the 136th."""
    s = _FakeScheduler()
    mp.instrument_scheduler(s)
    calls = []
    s.add_job(lambda: calls.append(1), "interval", id="job_a")
    s.add_job(lambda: calls.append(2), "interval", id="job_b")
    for func, _a, _kw in s.registered:
        func()
    assert calls == [1, 2], "the wrapper changed which jobs ran"


def test_a_job_delta_is_recorded_under_its_id(monkeypatch):
    mp._JOB_MEM.clear()
    rss = iter([100.0, 4700.0])            # before, after
    monkeypatch.setattr(mp, "_rss_mb", lambda: next(rss))
    s = _FakeScheduler()
    mp.instrument_scheduler(s)
    s.add_job(lambda: None, "interval", id="the_hog")
    s.registered[0][0]()

    row = next(r for r in mp.job_memory_report() if r["job"] == "the_hog")
    assert row["max_delta_mb"] == 4600.0
    assert row["calls"] == 1


def test_the_report_ranks_the_worst_offender_first(monkeypatch):
    """⚠️ Names chosen so ALPHABETICAL order is the REVERSE of size order.

    The first version used "huge"/"medium"/"small", which happen to sort the
    same way by name as by megabytes — so a mutation replacing the size key with
    `key=lambda r: r["job"]` SURVIVED. That is the SECOND time in this session a
    sort fixture proved nothing for exactly this reason (see
    `test_the_biggest_cache_sorts_first`). If a test asserts an ORDER, the names
    must not already be in it.
    """
    mp._JOB_MEM.clear()
    mp.record_job("alpha_tiny", 100.0, 105.0, 0.1)     # smallest, sorts FIRST by name
    mp.record_job("zeta_hog", 100.0, 4700.0, 12.0)     # largest,  sorts LAST by name
    mp.record_job("mid_job", 100.0, 400.0, 1.0)
    assert [r["job"] for r in mp.job_memory_report()][:3] == \
        ["zeta_hog", "mid_job", "alpha_tiny"]


def test_the_wrapper_re_raises_the_job_s_exception(monkeypatch):
    """⛔ A diagnostic that swallows a job's failure is worse than none.

    The recording lives in a `finally`, so the exception must still propagate —
    otherwise every broken scheduled job would start looking healthy.
    """
    mp._JOB_MEM.clear()
    # ⚠️ Pin RSS: on Windows/macOS `_rss_mb()` returns None (no /proc, no
    # `resource`), `record_job` correctly discards the sample, and the
    # "it was still measured" half below would fail for a platform reason
    # rather than a real one.
    rss = iter([100.0, 150.0])
    monkeypatch.setattr(mp, "_rss_mb", lambda: next(rss))

    s = _FakeScheduler()
    mp.instrument_scheduler(s)

    def boom(): raise ValueError("job failed")
    s.add_job(boom, "interval", id="explodes")

    with pytest.raises(ValueError, match="job failed"):
        s.registered[0][0]()
    # …and it was still measured, because the record is in a `finally`.
    assert any(r["job"] == "explodes" for r in mp.job_memory_report())


def test_recording_never_raises_on_a_missing_rss_reading():
    """Non-Linux, or a /proc read that failed: record nothing, break nothing."""
    mp._JOB_MEM.clear()
    mp.record_job("x", None, 100.0, 0.1)
    mp.record_job("y", 100.0, None, 0.1)
    assert mp.job_memory_report() == []


def test_instrumentation_runs_before_any_add_job_in_main():
    """⛔ The ordering IS the feature.

    Jobs registered before instrumentation are unmeasured — and the ones
    registered first are the heavy startup ones, i.e. exactly the candidates.
    """
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    instr = src.index("instrument_scheduler(_scheduler)")
    first_add = src.index("_scheduler.add_job(")
    assert instr < first_add, (
        "instrument_scheduler runs AFTER the first add_job — the earliest jobs "
        "are silently unmeasured"
    )
