import math
import os
import tempfile

import pytest

# Point the DB at a temp volume BEFORE importing darkpool_db (its module-level
# init_db() runs on import).
os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH",
                      tempfile.mkdtemp(prefix="dp_signature_"))

from api import darkpool_db  # noqa: E402
from api.services.signature import rules  # noqa: E402
from api.services.signature.darkpool_levels import (  # noqa: E402
    cluster_levels,
    fetch_dp_levels,
)


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


# ── Finding B: non-finite poisoning ──────────────────────────────────────

def test_non_finite_prints_are_ignored():
    """inf/NaN must never reach a level.

    An inf notional makes wsum inf and price inf/inf = NaN, which FastAPI's
    JSONResponse (allow_nan=False) refuses to serialize -> 500 on a rank-1 level.
    """
    inf = float("inf")
    nan = float("nan")
    good = [_p(100.00, 6_000_000), _p(100.05, 6_000_000)]

    for poison in (_p(100.02, inf), _p(inf, 6_000_000),
                   _p(100.02, nan), _p(nan, 6_000_000)):
        levels = cluster_levels(good + [poison], bin_pct=0.0025,
                                min_notional=10_000_000, top_k=5)
        assert len(levels) == 1, poison
        assert levels[0]["printCount"] == 2, poison
        assert math.isfinite(levels[0]["price"]), poison
        assert math.isfinite(levels[0]["notional"]), poison
        assert abs(levels[0]["price"] - 100.025) < 1e-9, poison


def test_payload_of_only_non_finite_rows_is_empty():
    inf = float("inf")
    nan = float("nan")
    assert cluster_levels([_p(inf, 5_000_000)]) == []
    assert cluster_levels([_p(100.0, inf)]) == []
    assert cluster_levels([_p(nan, 5_000_000), _p(100.0, nan), _p(inf, inf)]) == []


# ── Finding C + D: clustering invariants ─────────────────────────────────

def _evenly_spaced(n=200, base=100.0, bins_apart=0.9, bin_pct=0.0025,
                   notional=20_000_000):
    """Prints spaced a constant `bins_apart` fraction of the REALIZED bin width.

    bin_w derives from the median price, which itself depends on the spacing, so
    solve for d: median = base + (n//2)*d and d = bins_apart*bin_pct*median.
    """
    k = bins_apart * bin_pct
    d = k * base / (1 - k * (n // 2))
    return [_p(base + i * d, notional) for i in range(n)], d


def test_spaced_clusters_stay_one_bin_wide_and_never_chain():
    """Kills the anchor mutation: anchoring to the PREVIOUS print instead of the
    cluster's lowest price lets 0.9-bin-spaced prints chain-merge into one
    arbitrarily wide zone."""
    prints, d = _evenly_spaced()
    prices = sorted(p["price"] for p in prints)
    bin_w = prices[len(prices) // 2] * 0.0025
    assert 0.89 < d / bin_w < 0.91  # fixture really is ~0.9 bins apart

    levels = cluster_levels(prints, bin_pct=0.0025, min_notional=10_000_000,
                            top_k=10_000)
    assert len(levels) == 100
    for lv in levels:
        assert lv["printCount"] <= 2
        assert lv["hi"] - lv["lo"] == pytest.approx(bin_w)

    # Finding D: adjacent zones must not overlap.
    zones = sorted((lv["lo"], lv["hi"]) for lv in levels)
    for (lo_a, hi_a), (lo_b, _) in zip(zones, zones[1:]):
        assert lo_b - hi_a >= -1e-9, f"zones overlap: {hi_a} > {lo_b}"


def test_price_is_notional_weighted_not_midpoint():
    """Kills the unweighted-mean mutation."""
    prints = [_p(100.00, 90_000_000), _p(100.10, 10_000_000)]
    levels = cluster_levels(prints, bin_pct=0.0025, min_notional=10_000_000, top_k=5)
    assert len(levels) == 1 and levels[0]["printCount"] == 2
    assert levels[0]["price"] == pytest.approx(100.01)      # weighted point
    assert abs(levels[0]["price"] - 100.05) > 1e-3          # NOT the midpoint


def test_zone_is_exactly_one_bin_wide_for_an_asymmetric_cluster():
    """Kills the lo/hi-anchoring mutation (e.g. lo=cmin, hi=cmax)."""
    prints = [_p(100.00, 90_000_000), _p(100.10, 10_000_000)]
    prices = sorted(p["price"] for p in prints)
    bin_w = prices[len(prices) // 2] * 0.0025
    levels = cluster_levels(prints, bin_pct=0.0025, min_notional=10_000_000, top_k=5)
    assert levels[0]["hi"] - levels[0]["lo"] == pytest.approx(bin_w)
    assert levels[0]["lo"] < levels[0]["price"] < levels[0]["hi"]


def test_cluster_at_exactly_min_notional_is_kept():
    """Pins < vs <=: the brief keeps clusters with total notional >= $10M."""
    prints = [_p(100.00, 5_000_000.0), _p(100.05, 5_000_000.0)]
    levels = cluster_levels(prints, bin_pct=0.0025)
    assert levels and levels[0]["notional"] == rules.DPL_MIN_CLUSTER_NOTIONAL
    assert levels[0]["printCount"] == 2


def test_contributing_prints_fall_inside_their_own_zone():
    """Finding D: a zone centred on the notional-weighted mean can exclude the
    very prints that formed it. 99.75 (90M) + 100.00 (10M) is exactly one bin
    wide, so an unclamped centre puts hi at 99.90 -- below its own 100.00 print."""
    prints = [_p(99.75, 90_000_000), _p(100.00, 10_000_000)]
    prices = sorted(p["price"] for p in prints)
    bin_w = prices[len(prices) // 2] * 0.0025
    levels = cluster_levels(prints, bin_pct=0.0025, min_notional=10_000_000, top_k=5)
    assert len(levels) == 1 and levels[0]["printCount"] == 2
    lv = levels[0]
    assert lv["lo"] <= 99.75, f"lo {lv['lo']} excludes its own 99.75 print"
    assert lv["hi"] >= 100.00, f"hi {lv['hi']} excludes its own 100.00 print"
    assert lv["hi"] - lv["lo"] == pytest.approx(bin_w)
    assert lv["lo"] < lv["price"] < lv["hi"]


# ── Finding A: the 20-day window must not be row-truncated ───────────────

@pytest.fixture
def dp_db(tmp_path, monkeypatch):
    """Isolate every darkpool DB access to a per-test SQLite file."""
    db_path = str(tmp_path / "darkpool.db")
    monkeypatch.setattr(darkpool_db, "DB_DIR", str(tmp_path))
    monkeypatch.setattr(darkpool_db, "DB_PATH", db_path)
    darkpool_db.init_db()
    return db_path


def _insert(rows):
    conn = darkpool_db.get_conn()
    try:
        conn.executemany(
            "INSERT INTO darkpool_trades "
            "(date, timestamp, ticker, volume, price, notional, type) "
            "VALUES (?,?,?,?,?,?,?)",
            rows,
        )
        conn.commit()
    finally:
        conn.close()


def test_fetch_dp_levels_covers_the_whole_window_not_the_newest_200_prints(dp_db):
    """get_ticker_prints caps at 200 rows ordered date DESC, so on a heavy ticker
    the OLDEST dates in the 20-day window are silently truncated -- taking the
    true #1 level with them."""
    rows = []
    # 15 newest dates x 14 small prints at 100.00 = 210 prints, 210M total.
    for day in range(6, 21):
        for i in range(14):
            rows.append((f"7/{day}/2026", f"10:{i:02d}:00 AM", "SPY",
                         1000, 100.00, 1_000_000, "Block"))
    # 5 OLDEST dates x 4 heavy prints at 200.00 = 20 prints, 600M total.
    for day in range(1, 6):
        for i in range(4):
            rows.append((f"7/{day}/2026", f"10:{i:02d}:00 AM", "SPY",
                         1000, 200.00, 30_000_000, "Block"))
    _insert(rows)
    assert len(rows) == 230  # > the 200-row cap

    out = fetch_dp_levels("spy")

    assert out["datesCovered"] == 20, "the full 20-day window must be seen"
    assert out["windowDays"] == rules.DPL_WINDOW_DAYS
    assert out["sym"] == "SPY" and out["version"] == rules.VERSIONS["dpl"]

    # The heaviest cluster lives on the OLDEST dates -> it must rank 1.
    assert out["levels"], "expected levels"
    top = out["levels"][0]
    assert top["rank"] == 1
    assert top["price"] == pytest.approx(200.00), (
        "the 600M cluster on the oldest dates was truncated away"
    )
    assert top["notional"] == pytest.approx(600_000_000)
    assert top["printCount"] == 20


def test_get_ticker_prints_window_is_unlimited_and_shapes_rows_like_the_capped_read(dp_db):
    rows = [
        (f"7/{day}/2026", f"10:{i:02d}:00 AM", "AAPL", 1000, 100.0 + i, 5_000_000, "Block")
        for day in range(1, 11) for i in range(30)
    ]
    _insert(rows)  # 300 prints across 10 dates

    capped = darkpool_db.get_ticker_prints("AAPL", days=20, limit=200)
    full = darkpool_db.get_ticker_prints_window("AAPL", days=20)

    assert len(capped) == 200          # the cap the old path imposes
    assert len(full) == 300            # no row limit
    assert set(full[0]) == set(capped[0])  # identical row shape
    assert full[0]["dateRaw"] and full[0]["date"] and full[0]["price"]

    # Same guards as get_ticker_prints.
    assert darkpool_db.get_ticker_prints_window("") == []
    assert darkpool_db.get_ticker_prints_window("bad;drop") == []
