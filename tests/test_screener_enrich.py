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
    assert out["peg"] == 1.0
    assert out["pe_fwd"] == 18
    assert out["sector"] == "Technology"
    assert out["accdis"] == "B"          # ratio 1.2 -> B
    # computed
    assert out["rs_rank"] == 88          # _RS_BANDS: 30 -> 88
    assert out["uct_composite"] == 86    # weighted composite of the bands
