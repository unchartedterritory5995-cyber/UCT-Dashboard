import inspect
from api.services.breadth_analogues import find_analogues


def test_find_analogues_accepts_a_match_count():
    sig = inspect.signature(find_analogues)
    assert "top_n" in sig.parameters
    assert sig.parameters["top_n"].default == 5


def test_router_exposes_top_n_as_a_bounded_query_param():
    from api.routers import breadth_monitor as r
    sig = inspect.signature(r.get_breadth_analogues)
    assert "top_n" in sig.parameters, "the endpoint must let the caller pick the match count"


# ── Behavioural cache-key tests ──────────────────────────────────────────────
#
# The two tests above are pure signature introspection and never call
# find_analogues, so they cannot catch a regression of the cache-key defect
# this task exists to close. These two actually exercise the cache: they
# monkeypatch `_get_all_snapshots` (never touching a database) with synthetic
# rows built to pass `_extract_vector`'s missing-field tolerance, then drive
# `find_analogues` through a real similarity pass.
#
# Row design: every `ANALOGUE_METRICS` field is held CONSTANT across all rows
# except `breadth_score`, which is set to the row's chronological index. Since
# a constant metric has `a == b` for every pair, its normalized difference is
# always exactly 0 regardless of the (floor-clamped) std — so it contributes
# nothing to the weighted distance, and distance-to-"today" becomes a strictly
# monotonic function of `breadth_score` alone. That makes the similarity
# ordering fully predictable instead of an incidental property of arbitrary
# numbers: with "today" = the newest row (index 49) and candidates drawn from
# indices 0-44 (the last 5 are always excluded as "too recent"), the nearest
# candidate is 44, and the `min_gap_days=10` de-clustering rule then walks
# outward in exact steps of 10 — 44, 34, 24, 14, 4 — giving exactly 5
# well-separated matches on tap, in a known order, for any top_n from 1-5.

_CONSTANT_METRICS = {
    "uct_exposure": 60.0, "pct_above_50sma": 45.0, "pct_above_200sma": 55.0,
    "pct_above_20ema": 50.0, "ratio_5day": 1.2, "ratio_10day": 1.1, "vix": 18.0,
    "mcclellan_osc": 5.0, "cnn_fear_greed": 50.0, "aaii_spread": 2.0,
    "cboe_putcall": 0.9, "new_52w_highs": 40.0, "new_52w_lows": 10.0,
    "hi_ratio": 1.3, "stage2_count": 300.0,
}


def _mk_row(i):
    row = {"date": f"D{i:03d}", "breadth_score": float(i), "sp500_close": 5000.0 + i * 3}
    row.update(_CONSTANT_METRICS)
    return row


def _mk_snapshots_newest_first(n=50):
    """`_get_all_snapshots` is documented "newest first" — build chronological
    ascending (oldest index 0 -> newest index n-1) then reverse, so the fake
    obeys the same contract the real one does."""
    return list(reversed([_mk_row(i) for i in range(n)]))


def _reset_cache():
    # The module's own clear, not a hand-written poke at its internals: the
    # cache is one entry PER top_n now, so writing sentinel keys into it would
    # leave every real entry in place and silently stop isolating these tests.
    from api.services import breadth_analogues as ba
    ba.invalidate_cache()


def test_a_different_top_n_is_a_cache_miss_not_a_stale_smaller_result(monkeypatch):
    """Case A: request top_n=2, then top_n=4 with no TTL expiry in between.
    The second call must reflect its OWN top_n, not the first call's cached
    2-analogue result."""
    from api.services import breadth_analogues as ba

    _reset_cache()
    try:
        monkeypatch.setattr(ba, "_get_all_snapshots", lambda lookback_days=500: _mk_snapshots_newest_first())

        small = ba.find_analogues(top_n=2)
        assert [a["date"] for a in small["analogues"]] == ["D044", "D034"]

        big = ba.find_analogues(top_n=4)
        assert [a["date"] for a in big["analogues"]] == ["D044", "D034", "D024", "D014"], (
            "a request for MORE matches must not be served the smaller cached result"
        )
    finally:
        _reset_cache()


def test_b_the_same_top_n_within_the_ttl_is_served_from_cache(monkeypatch):
    """Case B: two calls with the SAME top_n. The source data is mutated to a
    too-small history in between — if the second call were not served from
    cache, it would recompute against that mutated source and come back with
    an EMPTY analogues list, which cannot equal the first call's result by
    accident. Only an actual cache hit makes this pass."""
    from api.services import breadth_analogues as ba

    _reset_cache()
    try:
        monkeypatch.setattr(ba, "_get_all_snapshots", lambda lookback_days=500: _mk_snapshots_newest_first())
        first = ba.find_analogues(top_n=3)
        assert [a["date"] for a in first["analogues"]] == ["D044", "D034", "D024"]

        # Mutate the source: too few rows (< 20) makes a fresh computation
        # short-circuit to an empty result.
        monkeypatch.setattr(ba, "_get_all_snapshots", lambda lookback_days=500: _mk_snapshots_newest_first(n=5))

        second = ba.find_analogues(top_n=3)
        assert second == first, "a repeated request within the TTL must be served from cache, not recomputed"
    finally:
        _reset_cache()


def test_c_alternating_top_n_callers_do_not_evict_each_other(monkeypatch):
    """Case C: the single-slot cache held ONE (data, top_n) pair, so two callers
    alternating between 5 and 10 matches recomputed the full similarity pass on
    every request — the six-hour TTL never once did its job.

    Same mutate-the-source trick as case B, but applied to the FIRST top_n after
    a second one has been asked for: if 2's entry had been evicted by 4, the
    third call would recompute against the too-small history and come back
    empty, which cannot equal the first result by accident."""
    from api.services import breadth_analogues as ba

    _reset_cache()
    try:
        monkeypatch.setattr(ba, "_get_all_snapshots", lambda lookback_days=500: _mk_snapshots_newest_first())
        small = ba.find_analogues(top_n=2)
        big = ba.find_analogues(top_n=4)
        assert [a["date"] for a in small["analogues"]] == ["D044", "D034"]
        assert len(big["analogues"]) == 4

        monkeypatch.setattr(ba, "_get_all_snapshots", lambda lookback_days=500: _mk_snapshots_newest_first(n=5))

        assert ba.find_analogues(top_n=2) == small, (
            "asking for 4 matches evicted the cached 2-match answer"
        )
        assert ba.find_analogues(top_n=4) == big
        # …and a top_n nobody has asked for is still a MISS, not a near-enough hit.
        assert ba.find_analogues(top_n=3)["analogues"] == []
    finally:
        _reset_cache()


def test_invalidate_clears_every_top_n_not_just_the_last_written(monkeypatch):
    """A breadth push makes yesterday's deck stale at EVERY match count."""
    from api.services import breadth_analogues as ba

    _reset_cache()
    try:
        monkeypatch.setattr(ba, "_get_all_snapshots", lambda lookback_days=500: _mk_snapshots_newest_first())
        ba.find_analogues(top_n=2)
        ba.find_analogues(top_n=4)
        assert len(ba._cache) == 2, "the fixture did not populate two entries — nothing to clear"

        ba.invalidate_cache()
        assert ba._cache == {}

        # Behavioural proof the entries are really gone: a fresh call now sees
        # the mutated (too-small) source instead of the pre-invalidate answer.
        monkeypatch.setattr(ba, "_get_all_snapshots", lambda lookback_days=500: _mk_snapshots_newest_first(n=5))
        assert ba.find_analogues(top_n=2)["analogues"] == []
    finally:
        _reset_cache()
