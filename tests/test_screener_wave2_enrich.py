"""Wave 2 Task 9 — ratings components + sector RS + sponsorship, and the
``inst_pct`` handover to the Finviz nightly pull (Task 3/10).

⛔ THE METRICS FIXTURE IS DERIVED FROM `ratings_db.METRIC_COLUMNS`, never
hand-typed — a metric the store gains tomorrow is automatically exercised
here too (`_METRIC_VALUES` will KeyError the day one is added without a
matching realistic value, which is the point: silent coverage loss is not
an option). Same idea for the sample sizes: `ratings_db.MIN_SAMPLE` /
`SECTOR_MIN_SAMPLE` size the synthetic distributions rather than a
hand-typed 200/15, so this rail tracks the real gate rather than a copy of it.
"""
from api.services.research import ratings_db
from api.services.screener import enrich

# One realistic value per metric the store persists. Keyed by name (not
# derived) because a REALISTIC figure has to be authored somewhere — but the
# metrics dict itself is built by iterating `METRIC_COLUMNS`, so a renamed or
# added metric shows up as a loud KeyError here rather than a silently
# under-covered fixture.
_METRIC_VALUES = {
    "earnings_growth": 40.0,
    "rev_growth": 25.0,
    "blended_growth": 30.0,
    "rs_return": 32.0,
    "peg": 1.1,
    "pe_fwd": 18.0,
    "op_margin": 20.0,
    "roe": 22.0,
    "inst_pct": 58.0,
    "accdis_ratio": 1.2,
}


def _full_metrics(sector="Technology"):
    metrics = {c: _METRIC_VALUES[c] for c in ratings_db.METRIC_COLUMNS}
    metrics["sector"] = sector
    return metrics


def _synthetic_dists():
    """Universe distributions wide enough to clear `ratings_db.MIN_SAMPLE`,
    centered near 0 so every value in `_METRIC_VALUES` lands mid-range
    (a real, non-extreme percentile) rather than pinned at 1 or 99."""
    n = ratings_db.MIN_SAMPLE + 20
    half = n // 2
    values = [float(i - half) for i in range(n)]
    return {m: {"values": values, "n": n} for m in ratings_db._DIST_COLUMNS}


def _synthetic_sector_dists(rs_value, sector="Technology"):
    """Per-sector `rs_return` pool wide enough to clear `SECTOR_MIN_SAMPLE`,
    centered on the ticker's own rs_return so its sector rank lands mid-range
    too."""
    n = ratings_db.SECTOR_MIN_SAMPLE + 5
    start = rs_value - n / 2
    values = [start + i for i in range(n)]
    return {sector: {"rs_return": {"values": values, "n": n}}}


_NEW_KEYS = {"blended_growth", "sector_rs_pct", "rating_eps", "rating_growth",
             "rating_value", "rating_smr", "sponsorship"}


def test_wave2_all_seven_keys_emit_with_full_distributions():
    """Full metrics + a warm universe distribution + a warm sector pool ->
    every new key emits a plausible value, and `inst_pct` is absent (the
    handover holds even when the store that used to feed it is fully warm)."""
    metrics = _full_metrics()
    dists = _synthetic_dists()
    sdists = _synthetic_sector_dists(metrics["rs_return"], metrics["sector"])

    out = enrich.ratings_fields(metrics, dists, sdists)

    assert _NEW_KEYS <= out.keys(), f"missing: {_NEW_KEYS - out.keys()}"
    assert out["blended_growth"] == metrics["blended_growth"]  # direct passthrough
    for key in ("rating_eps", "rating_growth", "rating_value", "rating_smr",
                "sector_rs_pct"):
        v = out[key]
        assert isinstance(v, int), f"{key} = {v!r} is not an int"
        assert 1 <= v <= 99, f"{key} = {v!r} outside the 1-99 rating scale"
    assert out["sponsorship"] in ("A", "B", "C", "D", "E")

    # ⛔ THE HANDOVER. `inst_pct` is still an INPUT (it fed `sponsorship`
    # above) but must never be an OUTPUT again — that column belongs to
    # `finviz_universe.py` now.
    assert "inst_pct" not in out


def test_wave2_sponsorship_and_sector_rs_absent_on_a_cold_store():
    """`dists={}` (the cold-store shape `_pct` already handles) -> the two
    percentile-only additions stay absent, `blended_growth` (a plain
    passthrough, not percentile-gated) still emits, and `inst_pct` is STILL
    absent — the handover does not depend on the store being warm."""
    metrics = _full_metrics()

    out = enrich.ratings_fields(metrics, {})

    assert "sponsorship" not in out
    assert "sector_rs_pct" not in out
    assert out["blended_growth"] == metrics["blended_growth"]
    assert "inst_pct" not in out

    # And the band-fallback path still produces the other four ratings
    # (bands don't need a distribution at all).
    for key in ("rating_eps", "rating_growth", "rating_value", "rating_smr"):
        assert key in out


def test_wave2_sector_rs_absent_when_sdists_not_passed():
    """`sdists` defaults to `None` (the pre-Wave-2 call shape every existing
    caller still uses) -> `sector_rs_pct` stays absent even with a fully warm
    universe distribution. No caller is silently opted into Sector RS."""
    metrics = _full_metrics()
    dists = _synthetic_dists()

    out = enrich.ratings_fields(metrics, dists)  # no third arg

    assert "sector_rs_pct" not in out
    assert "sponsorship" in out  # unaffected — sponsorship only needs `dists`


def test_wave2_additions_do_not_move_the_composite():
    """The seven new keys are pure additions. Proven by computing the
    composite twice off the SAME metrics + universe distributions, once
    without `sdists` and once with — if Sector RS or sponsorship touched the
    composite's inputs, these would disagree."""
    metrics = _full_metrics()
    dists = _synthetic_dists()
    sdists = _synthetic_sector_dists(metrics["rs_return"], metrics["sector"])

    without_sector = enrich.ratings_fields(metrics, dists)
    with_sector = enrich.ratings_fields(metrics, dists, sdists)

    assert without_sector["uct_composite"] == with_sector["uct_composite"]
    assert "sector_rs_pct" not in without_sector
    assert "sector_rs_pct" in with_sector


def test_wave2_load_sector_distributions_mirrors_load_distributions(monkeypatch):
    """`enrich.load_sector_distributions()` wraps `ratings_db.get_sector_distributions`
    the same way `load_distributions()` wraps `get_distributions` — including
    the {}-on-error degrade, so a cold/corrupt store never raises into the
    builder."""
    monkeypatch.setattr(ratings_db, "get_sector_distributions",
                        lambda: {"Technology": {"rs_return": {"values": [1.0], "n": 1}}})
    assert enrich.load_sector_distributions() == {
        "Technology": {"rs_return": {"values": [1.0], "n": 1}}}

    def _boom():
        raise RuntimeError("db unavailable")
    monkeypatch.setattr(ratings_db, "get_sector_distributions", _boom)
    assert enrich.load_sector_distributions() == {}
