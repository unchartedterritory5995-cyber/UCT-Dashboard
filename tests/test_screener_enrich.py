from api.services.screener import enrich


def test_ratings_fields_empty():
    assert enrich.ratings_fields(None, {}) == {}
    assert enrich.ratings_fields({}, {}) == {}


def test_ratings_fields_band_fallback_composite():
    # No distributions -> absolute band path (deterministic).
    metrics = {
        "rs_return": 30, "earnings_growth": 40, "blended_growth": 30,
        "peg": 1.0, "pe_fwd": 18, "rev_growth": 25, "op_margin": 20,
        "roe": 20, "inst_pct": 55, "accdis_ratio": 1.2, "sector": "Technology",
    }
    out = enrich.ratings_fields(metrics, {})
    # passthrough mapping
    assert out["eps_growth"] == 40
    assert out["rev_growth"] == 25
    assert out["pe_fwd"] == 18
    assert out["sector"] == "Technology"
    assert out["accdis"] == "B"          # ratio 1.2 -> B
    # computed
    assert out["uct_composite"] == 86    # weighted composite of the bands


def test_ratings_fields_does_not_emit_the_rs_columns():
    """🔴 THE SECOND-AUTHORITY RAIL, and it is asserted on a FULLY-POPULATED
    metrics dict — the exact input that used to produce `rs_rank: 88`.

    `rs_rank`/`rs_return` belong to `rs_ranking` (see `enrich`'s docstring).
    Absence proves it; a `None` would not, because `build_row` merges only
    non-None values and a `None` here would look identical to this test while
    still being a second producer of the name.
    """
    metrics = {
        "rs_return": 30, "earnings_growth": 40, "blended_growth": 30,
        "peg": 1.0, "pe_fwd": 18, "rev_growth": 25, "op_margin": 20,
        "roe": 20, "inst_pct": 55, "accdis_ratio": 1.2, "sector": "Technology",
    }
    out = enrich.ratings_fields(metrics, {})
    assert "rs_rank" not in out
    assert "rs_return" not in out
    # ...and `rs` is still an INPUT: the composite is unchanged by its removal.
    assert out["uct_composite"] == 86


def test_ratings_fields_does_not_emit_the_three_columns_the_bulk_pass_owns():
    """🔴 THE SAME RAIL, FOR THE 2026-08-09 HANDOVER — and this conflict was
    LIVE, not dormant: `RATINGS_PERCENTILE_ENABLED=1` on Railway, so both
    writers ran and `build_row`'s merge order silently decided the winner
    row by row.

    `op_margin`/`roe`/`peg` now belong to `fundamentals_bulk`, which reads them
    out of files it already downloads. Asserted on a FULLY-POPULATED metrics
    dict, because that is the input that used to emit all three.

    ⭐ AND THE COMPOSITE IS ASSERTED UNCHANGED IN THE SAME BREATH. That is the
    whole claim: all three are still INPUTS (`peg` is the Value leg,
    `op_margin` and `roe` are two of the three SMR legs), read from `metrics`
    rather than from the row. A test that only checked absence would pass just
    as happily on a change that had broken the rating.
    """
    metrics = {
        "rs_return": 30, "earnings_growth": 40, "blended_growth": 30,
        "peg": 1.0, "pe_fwd": 18, "rev_growth": 25, "op_margin": 20,
        "roe": 20, "inst_pct": 55, "accdis_ratio": 1.2, "sector": "Technology",
    }
    out = enrich.ratings_fields(metrics, {})
    for column in ("op_margin", "roe", "peg"):
        assert column not in out, (
            f"{column} is `fundamentals_bulk`'s column — emitting it here is a "
            f"second authority, and on Railway both writers run")
    assert out["uct_composite"] == 86

    # ⛔ THE INPUTS ARE PROVEN LOAD-BEARING, not assumed: drop the three from
    # `metrics` and the composite MOVES. Without this the assertion above could
    # be green on a function that had stopped reading them entirely.
    without = {k: v for k, v in metrics.items()
               if k not in ("op_margin", "roe", "peg")}
    assert enrich.ratings_fields(without, {})["uct_composite"] != 86
