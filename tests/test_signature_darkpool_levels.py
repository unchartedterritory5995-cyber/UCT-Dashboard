from api.services.signature.darkpool_levels import cluster_levels


def _p(price, notional, date="7/30/2026"):
    return {"price": price, "notional": notional, "date": date}


def test_clusters_nearby_prints_and_ranks_by_notional():
    prints = [
        _p(100.00, 6_000_000), _p(100.10, 6_000_000),   # cluster A: 12M near 100
        _p(105.00, 30_000_000),                          # cluster B: 30M at 105
        _p(90.00, 4_000_000),                            # below min -> dropped
    ]
    levels = cluster_levels(prints, bin_pct=0.0025, min_notional=10_000_000, top_k=5)
    assert len(levels) == 2
    assert levels[0]["rank"] == 1 and abs(levels[0]["price"] - 105.0) < 1e-9
    assert levels[1]["printCount"] == 2
    # weighted mean of equal notionals
    assert abs(levels[1]["price"] - 100.05) < 1e-9
    assert levels[1]["lo"] < levels[1]["price"] < levels[1]["hi"]


def test_empty_and_zero_price_prints_are_safe():
    assert cluster_levels([]) == []
    assert cluster_levels([_p(0, 5_000_000)]) == []


def test_top_k_truncates():
    prints = [_p(100 + i * 10, 20_000_000) for i in range(8)]
    assert len(cluster_levels(prints, top_k=3)) == 3
