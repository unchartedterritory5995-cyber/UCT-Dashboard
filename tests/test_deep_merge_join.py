"""The deep daily merge puts yfinance's older bars on Massive's basis when the two overlap on one (2026-11-18).

Production EMBJ (Embraer ADR, 4:1 on 2026-11-16): Massive's series starts 2025-11-03 and is adjusted,
yfinance's was not yet, so every deep fetch wrote a x0.25 cliff at 2025-11-03 and undid a repaired store
within minutes. `bars_fetch._yf_join_factor` has the reasoning."""
import datetime as dt

from api.services import bars_fetch as F


def _days(start, n):
    out, d = [], dt.date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def _bars(days, closes, v=1000):
    return [{"t": t, "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": v} for t, c in zip(days, closes)]


OLD = _days("2025-06-02", 60)            # yfinance only
SHARED = _days("2025-11-03", 40)         # both vendors
PRICES = [16.0 + 0.1 * i for i in range(40)]


def test_one_security_on_two_bases_is_joined_at_the_vendors_ratio():
    """EMBJ: yfinance 4x Massive across the overlap -> yfinance's older bars divided by 4 (volume x4)."""
    yf = _bars(OLD, [60.0 + 0.1 * i for i in range(60)], v=1000) + _bars(SHARED, [p * 4 for p in PRICES])
    massive = _bars(SHARED, PRICES)
    out = F._merge_daily_bars(yf, massive)
    assert [b["t"] for b in out] == OLD + SHARED
    assert out[0]["c"] == 15.0 and out[0]["v"] == 4000
    assert out[59]["c"] == round((60.0 + 5.9) / 4, 4)
    assert out[60] == massive[0]                       # Massive's own bars untouched
    assert abs(out[60]["c"] / out[59]["c"] - 1) < 0.05  # no cliff at the seam


def test_two_different_securities_are_never_rescaled():
    """GEN: Massive's per-ticker GenOn against yfinance's Symantec -- the ratio wanders, nothing moves."""
    yf = _bars(OLD, [17.0] * 60) + _bars(SHARED, [17.0 + (i % 5) for i in range(40)])
    massive = _bars(SHARED, [3.7 + 0.3 * ((i * 7) % 4) for i in range(40)])
    out = F._merge_daily_bars(yf, massive)
    assert [b["c"] for b in out[:60]] == [17.0] * 60


def test_the_same_basis_is_left_as_it_is():
    yf = _bars(OLD, [16.0] * 60) + _bars(SHARED, [p * 1.004 for p in PRICES])
    out = F._merge_daily_bars(yf, _bars(SHARED, PRICES))
    assert [b["c"] for b in out[:60]] == [16.0] * 60


def test_too_short_an_overlap_proves_nothing():
    yf = _bars(OLD, [60.0] * 60) + _bars(SHARED[:5], [p * 4 for p in PRICES[:5]])
    out = F._merge_daily_bars(yf, _bars(SHARED, PRICES))
    assert out[0]["c"] == 60.0


def test_an_empty_side_merges_as_before():
    m = _bars(SHARED, PRICES)
    assert F._merge_daily_bars([], m) is m
    y = _bars(OLD, [1.0] * 60)
    assert F._merge_daily_bars(y, []) is y
