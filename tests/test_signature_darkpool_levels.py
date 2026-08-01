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


def _pd(price, notional, date_raw, date=None):
    """A print shaped like a real darkpool_db row (dateRaw + short date)."""
    row = {"price": price, "notional": notional, "dateRaw": date_raw}
    if date is not None:
        row["date"] = date
    return row


def test_last_date_is_chronological_not_lexicographic():
    # "9/5/2026" > "12/31/2026" as a STRING, but December is later in time.
    prints = [
        _pd(100.00, 6_000_000, "12/31/2026", date="12/31"),
        _pd(100.05, 6_000_000, "9/5/2026", date="9/5"),
    ]
    levels = cluster_levels(prints, bin_pct=0.0025, min_notional=10_000_000, top_k=5)
    assert len(levels) == 1
    assert levels[0]["printCount"] == 2
    assert levels[0]["lastDate"] == "2026-12-31"


def test_last_date_prefers_date_raw_and_handles_iso():
    prints = [
        _pd(100.00, 6_000_000, "2026-09-05"),
        _pd(100.05, 6_000_000, "2026-12-31"),
    ]
    levels = cluster_levels(prints, bin_pct=0.0025, min_notional=10_000_000, top_k=5)
    assert levels[0]["lastDate"] == "2026-12-31"

    # A bare M/D carries no year -> kept as-is rather than guessing a year.
    bare = [
        {"price": 100.00, "notional": 6_000_000, "date": "9/5"},
        {"price": 100.05, "notional": 6_000_000, "date": "9/4"},
    ]
    levels = cluster_levels(bare, bin_pct=0.0025, min_notional=10_000_000, top_k=5)
    assert levels[0]["lastDate"] == "9/5"


def test_unparseable_dates_do_not_raise_and_fall_back_to_string_max():
    prints = [
        _pd(100.00, 6_000_000, "not-a-date"),
        _pd(100.05, 6_000_000, "also-bad"),
    ]
    levels = cluster_levels(prints, bin_pct=0.0025, min_notional=10_000_000, top_k=5)
    assert len(levels) == 1
    assert levels[0]["lastDate"] == "not-a-date"  # max of the raw strings

    # A missing/blank date must also be safe.
    blank = [
        {"price": 100.00, "notional": 6_000_000},
        {"price": 100.05, "notional": 6_000_000, "dateRaw": None},
    ]
    levels = cluster_levels(blank, bin_pct=0.0025, min_notional=10_000_000, top_k=5)
    assert levels[0]["lastDate"] == ""
