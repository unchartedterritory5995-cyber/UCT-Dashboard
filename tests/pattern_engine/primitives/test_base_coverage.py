from tools.base_coverage import classify, coverage


def _bars(price):
    return [{"t": 1_600_000_000 + i * 86400, "o": price, "h": price,
             "l": price, "c": price, "v": 100} for i in range(60)]


UNIVERSE = {f"T{i}": _bars(10.0 + i) for i in range(100)}


def test_a_predicate_that_never_fires_is_dead():
    r = coverage(lambda bars: False, UNIVERSE)
    assert r["hits"] == 0 and r["verdict"] == "dead"


def test_a_predicate_that_always_fires_is_noise():
    r = coverage(lambda bars: True, UNIVERSE)
    assert r["pct"] == 100.0 and r["verdict"] == "noise"


def test_a_selective_predicate_is_ok():
    r = coverage(lambda bars: bars[0]["c"] < 20.0, UNIVERSE)
    assert r["hits"] == 10 and r["pct"] == 10.0 and r["verdict"] == "ok"


def test_a_very_rare_predicate_is_thin():
    """⚠️ Needs a universe bigger than 100.

    THIN_PCT is 0.5%, so on a 100-name universe the smallest non-zero hit
    rate is 1% and "thin" is not expressible at all — the fixture would be
    asserting against a verdict it cannot produce. The real universe is
    ~3,700 names, where 0.5% is ~18 names; 1,000 here is enough to make one
    hit (0.1%) land in the band.
    """
    big = {f"B{i}": _bars(10.0 + i) for i in range(1000)}
    r = coverage(lambda bars: bars[0]["c"] < 10.5, big)
    assert r["hits"] == 1 and r["pct"] == 0.1 and r["verdict"] == "thin"


def test_a_raising_predicate_counts_as_a_miss_not_a_crash():
    def boom(bars):
        raise ValueError("bad bar")
    r = coverage(boom, UNIVERSE)
    assert r["hits"] == 0 and r["errors"] == 100


def test_errors_are_distinguishable_from_honest_misses():
    """A structure that CRASHES on real data must not read the same as one
    that simply never matches. Both are 0 hits; only `errors` separates them.
    """
    never = coverage(lambda bars: False, UNIVERSE)
    crashy = coverage(lambda bars: 1 / 0, UNIVERSE)
    assert never["hits"] == crashy["hits"] == 0
    assert never["errors"] == 0 and crashy["errors"] == 100


def test_an_empty_universe_does_not_divide_by_zero():
    r = coverage(lambda bars: True, {})
    assert r["total"] == 0 and r["pct"] == 0.0


def test_classify_boundaries_are_explicit():
    assert classify(0.0) == "dead"
    assert classify(0.4) == "thin"
    assert classify(0.5) == "ok"
    assert classify(35.0) == "ok"
    assert classify(35.1) == "noise"
