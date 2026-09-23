"""As-of projection, price-derived metrics, splits and beta."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from api.services.fundamentals_pit import asof as A, beta as B, price_derived as PD, splits as SP
from api.services.fundamentals_pit.series import Point

ET = ZoneInfo("America/New_York")


def pt(et_str, v, period_end="2024-12-31"):
    t = datetime.fromisoformat(et_str).replace(tzinfo=ET).astimezone(timezone.utc)
    return Point(t_eff=t, v=v, period_end=date.fromisoformat(period_end), sources=(), method="x")


# ── as-of ─────────────────────────────────────────────────────────────────
def test_filing_after_the_close_applies_to_the_next_daily_bar():
    pts = [pt("2025-02-14 16:42", 0.18)]
    assert A.project(pts, ["2025-02-14", "2025-02-18"], "D") == [None, 0.18]


def test_filing_before_the_close_applies_to_that_days_bar():
    pts = [pt("2025-02-14 10:05", 0.18)]
    assert A.project(pts, ["2025-02-13", "2025-02-14"], "D") == [None, 0.18]


def test_previous_value_holds_until_the_next_is_public():
    pts = [pt("2025-02-14 16:42", 0.18), pt("2025-05-01 16:10", 0.20, "2025-03-31")]
    got = A.project(pts, ["2025-04-30", "2025-05-01", "2025-05-02"], "D")
    assert got == [0.18, 0.18, 0.20]


def test_intraday_bar_uses_its_end_time():
    t_bar = int(datetime(2025, 2, 14, 16, 40, tzinfo=ET).timestamp())      # 16:40-16:45 bar
    pts = [pt("2025-02-14 16:42", 0.18)]
    assert A.project(pts, [t_bar, t_bar + 300], "5m") == [0.18, 0.18]
    assert A.project(pts, [t_bar - 300], "5m") == [None]


def test_weekly_and_monthly_bars_use_the_bucket_end():
    pts = [pt("2025-02-12 16:30", 0.18)]              # a Wednesday
    assert A.project(pts, ["2025-02-10"], "W") == [0.18]    # Monday-keyed week -> Friday close
    assert A.project(pts, ["2025-02-01"], "M") == [0.18]    # month-start key -> month end
    assert A.project(pts, ["2025-01-01"], "M") == [None]


def test_value_older_than_the_staleness_cap_goes_blank_not_flat():
    pts = [pt("2017-05-10 16:51", 0.05, "2017-03-31")]
    assert A.project(pts, ["2017-06-01", "2018-06-01"], "D") == [0.05, None]


def test_close_time_follows_dst():
    assert A.close_utc(date(2025, 1, 15)).hour == 21 and A.close_utc(date(2025, 7, 15)).hour == 20


# ── price-derived ─────────────────────────────────────────────────────────
def test_market_cap_uses_contemporaneous_shares_never_todays():
    series = {"shares_outstanding": [pt("2024-01-30 16:00", 1_000, "2024-01-20"),
                                     pt("2024-04-30 16:30", 800, "2024-04-20")]}
    # before the second count is public the FIRST count applies -- never today's
    out = PD.derive(["2024-02-01", "2024-04-30", "2024-05-01"], [10.0, 10.0, 10.0], series)
    assert out["market_cap"] == [10_000.0, 10_000.0, 8_000.0]


def test_pe_is_blank_for_non_positive_eps():
    series = {"eps_diluted_ttm": [pt("2024-01-30 16:00", -1.0, "2023-12-31")]}
    assert PD.derive(["2024-06-03"], [10.0], series)["pe_ttm"] == [None]


def test_split_moves_neither_market_cap_nor_pe():
    led = SP.Ledger([SP.Split(date(2024, 6, 10), 10.0)])
    # a pre-split 10-Q reports EPS 6.00 and 2.46B shares (cover date 2024-05-17)
    eps_today = led.per_share_today(6.00, date(2024, 5, 29))
    shares_today = led.shares_today(2.46e9, date(2024, 5, 17))
    series = {"eps_diluted_ttm": [pt("2024-05-29 16:30", eps_today, "2024-04-28")],
              "shares_outstanding": [pt("2024-05-29 16:30", shares_today, "2024-05-17")]}
    # adjusted closes around the split: 120.89 (Fri) and 121.79 (Mon)
    out = PD.derive(["2024-06-07", "2024-06-10"], [120.89, 121.79], series)
    assert abs(out["pe_ttm"][0] - 120.89 / 0.6) < 1e-9
    assert abs(out["market_cap"][1] / out["market_cap"][0] - 121.79 / 120.89) < 1e-12


def test_split_inference_recovers_ratio_and_window():
    got = SP.infer_splits([(date(2024, 5, 29), 5.98, date(2024, 8, 28), 0.60)])
    assert got == [(date(2024, 5, 29), date(2024, 8, 28), 10.0)]
    assert SP.infer_splits([(date(2009, 7, 22), 1.0, date(2010, 1, 25), 1.01)]) == []


# ── beta ──────────────────────────────────────────────────────────────────
def _walk(n, seed=3):
    import random
    r = random.Random(seed)
    px, out = 100.0, []
    for i in range(n):
        px *= 1 + r.gauss(0, 0.01)
        out.append((date(2020, 1, 1) + timedelta(days=i), px))
    return out


def test_beta_of_benchmark_with_itself_is_one_and_levered_is_two():
    spy = _walk(400)
    lev = [(spy[0][0], 100.0)]
    for (d0, a), (d1, b) in zip(spy, spy[1:]):
        lev.append((d1, lev[-1][1] * (1 + 2 * (b / a - 1))))
    assert abs(B.rolling_beta(spy, spy)[-1][1] - 1.0) < 1e-9
    assert abs(B.rolling_beta(lev, spy)[-1][1] - 2.0) < 1e-9


def test_beta_needs_min_observations_and_aligns_on_common_days():
    spy = _walk(300)
    got = B.rolling_beta(spy[:150], spy)
    assert all(v is None for _, v in got)                 # < 200 returns
    stock = [x for i, x in enumerate(spy) if i % 7 != 3]  # missing days never fabricate 0 returns
    assert abs(B.rolling_beta(stock, spy)[-1][1] - 1.0) < 1e-9
