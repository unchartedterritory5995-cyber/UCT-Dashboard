"""Fundamental trend columns (`api/services/screener/fund_trends.py`): the definitions on invented quarter series,
the evening job, the side table, the build's one read, the filters end to end, the methodology, the schedule.

Every company, ticker and figure here is INVENTED (the repo is public).
"""
from __future__ import annotations

import importlib
import json
import random
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from api.services.screener import fund_trends as ft

ET = ZoneInfo("America/New_York")
EVENING = "2026-11-20"                         # a Friday session
REF_DAY, REF_TS = ft.reference(EVENING)


def ts(day: str, hour_utc: int = 14) -> float:
    """Unix seconds of a filing on `day` (default 14:00 UTC, before that day's close)."""
    return datetime.fromisoformat(day).replace(hour=hour_utc, tzinfo=timezone.utc).timestamp()


def series(*rows) -> list:
    """Store points from (period end, value, filed day[, hour]) rows, ascending by filing time."""
    pts = [[ts(r[2], *(r[3:] or ())), r[1], r[0], "yoy"] for r in rows]
    return sorted(pts, key=lambda p: p[0])


Q = ("2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30")
FILED = {e: (date.fromisoformat(e) + timedelta(days=38)).isoformat() for e in Q}


def quarterly(values: dict) -> list:
    """{period end: value} -> points, each filed 38 days after its quarter ended."""
    return series(*((e, v, FILED[e]) for e, v in values.items()))


# ── revenue growth acceleration ─────────────────────────────────────────────────────────────

def test_acceleration_counts_consecutive_rises_from_the_newest_quarter_and_caps_at_four():
    rising = {"2025-12-31": 10.0, "2026-03-31": 12.0, "2026-06-30": 15.0, "2026-09-30": 20.0}
    assert ft.revenue_acceleration(quarterly(rising), REF_TS, REF_DAY) == 3
    assert ft.revenue_acceleration(quarterly({"2025-09-30": 11.0, **rising}), REF_TS, REF_DAY) == 3
    assert ft.revenue_acceleration(quarterly({"2025-09-30": 8.0, **rising}), REF_TS, REF_DAY) == 4
    five = {"2025-03-31": 1.0, "2025-06-30": 3.0, "2025-09-30": 8.0, **rising}
    assert ft.revenue_acceleration(quarterly(five), REF_TS, REF_DAY) == ft.ACCEL_MAX == 4
    # a fall in the newest quarter is a measured 0, never None; equal growth is not a rise
    assert ft.revenue_acceleration(quarterly({**rising, "2026-09-30": 14.0}), REF_TS, REF_DAY) == 0
    assert ft.revenue_acceleration(quarterly({**rising, "2026-09-30": 15.0}), REF_TS, REF_DAY) == 0
    # a rise from -20% to -10% is a rise
    assert ft.revenue_acceleration(quarterly({"2026-06-30": -20.0, "2026-09-30": -10.0}), REF_TS, REF_DAY) == 1


def test_acceleration_never_compares_across_a_missing_quarter():
    # 2026-06-30 never held: 2026-09-30 against 2026-03-31 is two quarters apart -> no answer at all
    assert ft.revenue_acceleration(quarterly({"2026-03-31": 5.0, "2026-09-30": 20.0}), REF_TS, REF_DAY) is None
    # a missing quarter deeper in the chain stops the count there
    pts = quarterly({"2025-12-31": 4.0, "2026-06-30": 15.0, "2026-09-30": 20.0})
    assert ft.revenue_acceleration(pts, REF_TS, REF_DAY) == 1
    # the store's gap point (a period filed, growth not derivable) is a missing quarter too
    gap_mid = quarterly({"2026-03-31": 12.0, "2026-06-30": None, "2026-09-30": 20.0})
    assert ft.revenue_acceleration(gap_mid, REF_TS, REF_DAY) is None
    gap_deeper = quarterly({"2025-12-31": 10.0, "2026-03-31": None, "2026-06-30": 15.0, "2026-09-30": 20.0})
    assert ft.revenue_acceleration(gap_deeper, REF_TS, REF_DAY) == 1
    assert ft.revenue_acceleration(quarterly({"2026-06-30": 15.0, "2026-09-30": None}), REF_TS, REF_DAY) is None
    # one quarter alone is no answer
    assert ft.revenue_acceleration(quarterly({"2026-09-30": 20.0}), REF_TS, REF_DAY) is None


def test_acceleration_uses_a_restatement_published_while_the_quarter_was_newest_and_no_look_ahead():
    base = [("2026-06-30", 15.0, FILED["2026-06-30"]), ("2026-09-30", 9.0, FILED["2026-09-30"])]
    assert ft.revenue_acceleration(series(*base), REF_TS, REF_DAY) == 0
    restated = series(*base, ("2026-09-30", 21.0, "2026-11-12"))       # a 10-Q/A for the newest quarter
    assert ft.revenue_acceleration(restated, REF_TS, REF_DAY) == 1
    # the prior quarter restated while IT was the newest: its last figure is the one compared
    prior = series(("2026-06-30", 15.0, "2026-08-07"), ("2026-06-30", 25.0, "2026-09-02"),
                   ("2026-09-30", 21.0, FILED["2026-09-30"]))
    assert ft.revenue_acceleration(prior, REF_TS, REF_DAY) == 0
    # a filing public only AFTER the evening's close does not count
    late = series(*base, ("2026-09-30", 21.0, EVENING, 22))            # 22:00 UTC = after 16:00 ET
    assert ft.revenue_acceleration(late, REF_TS, REF_DAY) == 0
    assert ft.revenue_acceleration(late, REF_TS + 86400, REF_DAY + timedelta(days=1)) == 1


def test_acceleration_goes_blank_when_the_newest_quarter_is_no_longer_in_force():
    # a company that stopped filing: its newest quarter ended 2026-04-30
    old = series(("2026-01-31", 10.0, "2026-03-06"), ("2026-04-30", 12.0, "2026-06-05"))
    day, ref = ft.reference("2026-11-16")                              # 200 days after: still in force
    assert ft.revenue_acceleration(old, ref, day) == 1
    day, ref = ft.reference("2026-11-17")                              # 201 days after: blank, never flat
    assert ft.revenue_acceleration(old, ref, day) is None
    assert ft.eps_streak(old, ref, day) is None and ft.year_ago_change(old, ref, day) is None


def test_a_fiscal_year_change_stops_the_chain_at_the_short_transition_period():
    # calendar quarters, then a one-month transition period to quarters ending Jan/Apr/Jul/Oct
    pts = series(("2025-09-30", 5.0, "2025-11-05"), ("2025-12-31", 8.0, "2026-02-10"),
                 ("2026-01-31", 10.0, "2026-03-10"), ("2026-04-30", 12.0, "2026-06-05"),
                 ("2026-07-31", 15.0, "2026-09-04"))
    assert ft.revenue_acceleration(pts, REF_TS, REF_DAY) == 2       # 15 > 12 > 10, then 31 days: stop


# ── the sibling's definition (PR #2417): the first step is the SAME rule, case by case ─────────

def _sibling_in_force(points, ref_ts, ref_day):
    """`group_stats_calc.in_force`, copied verbatim as an oracle while PR #2417 is not merged (replace with an
    import of `api.services.group_stats_calc` once it is)."""
    best = None
    for p in points or ():
        try:
            t = float(p[0])
        except (TypeError, ValueError, IndexError):
            continue
        if t <= ref_ts:
            best = p
        else:
            break
    if best is None or len(best) < 3:
        return None
    v = ft._finite(best[1])
    end = ft._day(best[2])
    if v is None or end is None or (ref_day - end).days > 200:
        return None
    return v


def _sibling_accelerating(points, ref_ts, ref_day):
    """`group_stats_calc.accelerating`, copied verbatim as an oracle (see above)."""
    known = []
    for p in points or ():
        try:
            t = float(p[0])
        except (TypeError, ValueError, IndexError):
            continue
        if t > ref_ts:
            break
        known.append(p)
    if not known:
        return None
    latest = _sibling_in_force(known, ref_ts, ref_day)
    if latest is None:
        return None
    latest_end = ft._day(known[-1][2])
    prior = None
    for p in reversed(known[:-1]):
        end = ft._day(p[2]) if len(p) >= 3 else None
        if end is not None and end < latest_end:
            prior = p
            break
    if prior is None:
        return None
    prior_v = ft._finite(prior[1])
    gap = (latest_end - ft._day(prior[2])).days
    if prior_v is None or not 60 <= gap <= 120:
        return None
    return latest > prior_v


def _random_store_series(rng: random.Random) -> list:
    """A store-shaped series: period ends never step back, restatements, gaps, a skipped quarter, odd spacing."""
    end = date(2024, 3, 31) + timedelta(days=rng.randint(0, 40))
    t = datetime(2024, 5, 1, 14, tzinfo=timezone.utc)
    pts = []
    for _ in range(rng.randint(1, 9)):
        step = rng.choice((91, 91, 92, 90, 183, 31, 61, 121, 59))
        end = end + timedelta(days=step)
        ended = datetime.combine(end, datetime.min.time(), tzinfo=timezone.utc)
        t = max(t, ended) + timedelta(days=rng.randint(20, 50))
        pts.append([t.timestamp(), None if rng.random() < 0.15 else round(rng.uniform(-30, 60), 2),
                    end.isoformat(), "yoy"])
        if rng.random() < 0.25:                                   # a restatement of the same newest period
            t = t + timedelta(days=rng.randint(1, 20))
            pts.append([t.timestamp(), round(rng.uniform(-30, 60), 2), end.isoformat(), "yoy"])
    return pts


def test_the_first_step_matches_the_group_views_accelerating_on_every_random_series():
    rng = random.Random(20261121)
    checked = {True: 0, False: 0, None: 0}
    for _ in range(3000):
        pts = _random_store_series(rng)
        ref_day = date(2024, 6, 1) + timedelta(days=rng.randint(0, 1000))
        ref_ts = ft.reference(ref_day.isoformat())[1]
        want = _sibling_accelerating(pts, ref_ts, ref_day)
        got = ft.revenue_acceleration(pts, ref_ts, ref_day)
        assert (None if got is None else got >= 1) == want, (pts, ref_day, got, want)
        checked[want] += 1
    assert min(checked.values()) > 100, checked                  # every branch was exercised


# ── EPS growth streak and the weakest-of-N columns ──────────────────────────────────────────

EPS = {"2025-12-31": 24.0, "2026-03-31": 26.0, "2026-06-30": 30.0, "2026-09-30": 40.0}


def test_the_eps_streak_counts_quarters_at_or_above_25_percent():
    pts = quarterly(EPS)
    assert ft.eps_streak(pts, REF_TS, REF_DAY) == 3
    assert ft.eps_streak(quarterly({**EPS, "2026-09-30": 24.99}), REF_TS, REF_DAY) == 0     # measured: below
    assert ft.eps_streak(quarterly({**EPS, "2026-09-30": 25.0}), REF_TS, REF_DAY) == 3      # at the threshold counts
    assert ft.eps_streak(pts, REF_TS, REF_DAY, threshold=30.0) == 2
    many = {e: 50.0 for e in Q} | {"2024-12-31": 50.0, "2024-09-30": 50.0, "2024-06-30": 50.0}
    many_pts = series(*((e, v, (date.fromisoformat(e) + timedelta(days=38)).isoformat()) for e, v in many.items()))
    assert ft.eps_streak(many_pts, REF_TS, REF_DAY) == ft.EPS_STREAK_MAX == 8


def test_a_negative_prior_year_eps_never_counts_ends_the_streak_and_blanks_a_newest_quarter():
    # the store leaves growth BLANK (a gap point) when the year-earlier EPS is zero or negative
    mid = quarterly({**EPS, "2026-03-31": None})
    assert ft.eps_streak(mid, REF_TS, REF_DAY) == 2
    assert ft.eps_min_growth(mid, REF_TS, REF_DAY, 2) == 30.0
    assert ft.eps_min_growth(mid, REF_TS, REF_DAY, 3) is None
    newest = quarterly({**EPS, "2026-09-30": None})
    assert ft.eps_streak(newest, REF_TS, REF_DAY) is None             # no growth figure: blank, never 0
    assert ft.eps_min_growth(newest, REF_TS, REF_DAY, 2) is None


def test_the_weakest_growth_of_the_last_n_quarters_and_its_identity_with_the_streak():
    pts = quarterly(EPS)
    assert [ft.eps_min_growth(pts, REF_TS, REF_DAY, n) for n in (2, 3, 4)] == [30.0, 26.0, 24.0]
    assert ft.eps_min_growth(quarterly({"2026-06-30": 30.0, "2026-09-30": 40.0}), REF_TS, REF_DAY, 3) is None
    # a missing quarter inside the window is no answer
    skip = quarterly({"2026-03-31": 26.0, "2026-09-30": 40.0})
    assert ft.eps_min_growth(skip, REF_TS, REF_DAY, 2) is None and ft.eps_streak(skip, REF_TS, REF_DAY) == 1
    # two decimals FIRST, so the streak and the minimum agree at the boundary
    edge = quarterly({**EPS, "2026-03-31": 24.996})
    assert ft.eps_min_growth(edge, REF_TS, REF_DAY, 3) == 25.0 and ft.eps_streak(edge, REF_TS, REF_DAY) == 3
    rng = random.Random(7)
    for _ in range(2000):
        s = _random_store_series(rng)
        ref_day = date(2024, 6, 1) + timedelta(days=rng.randint(0, 1000))
        ref_ts = ft.reference(ref_day.isoformat())[1]
        streak = ft.eps_streak(s, ref_ts, ref_day)
        for n in ft.EPS_MIN_WINDOWS:
            m = ft.eps_min_growth(s, ref_ts, ref_day, n)
            if m is not None:
                assert (m >= ft.EPS_STREAK_THRESHOLD) == (streak is not None and streak >= n), (s, n, m, streak)


# ── margin change and share count change ─────────────────────────────────────────────────────

def test_margin_change_is_points_against_the_quarter_one_fiscal_year_earlier():
    pts = quarterly({"2025-09-30": 10.0, "2025-12-31": 11.0, "2026-06-30": 11.5, "2026-09-30": 12.25})
    assert ft.year_ago_change(pts, REF_TS, REF_DAY) == 2.25
    # the year-ago quarter restated while it was newest: its last figure is used
    restated = series(("2025-09-30", 10.0, "2025-11-07"), ("2025-09-30", 9.0, "2025-12-01"),
                      ("2026-09-30", 12.25, FILED["2026-09-30"]))
    assert ft.year_ago_change(restated, REF_TS, REF_DAY) == 3.25
    assert ft.year_ago_change(quarterly({"2026-06-30": 11.0, "2026-09-30": 12.0}), REF_TS, REF_DAY) is None
    assert ft.year_ago_change(quarterly({"2025-09-30": None, "2026-09-30": 12.0}), REF_TS, REF_DAY) is None
    assert ft.year_ago_change(quarterly({"2025-09-30": 10.0, "2026-09-30": None}), REF_TS, REF_DAY) is None


def test_a_fiscal_year_change_finds_no_year_ago_quarter():
    pts = series(("2025-06-30", 10.0, "2025-08-05"), ("2025-09-30", 10.5, "2025-11-05"),
                 ("2026-01-31", 11.0, "2026-03-10"), ("2026-04-30", 11.4, "2026-06-05"),
                 ("2026-07-31", 12.0, "2026-09-04"))
    assert ft.year_ago_change(pts, REF_TS, REF_DAY) is None           # 2025-07-31 was never a quarter end


def test_share_count_change_is_percent_against_the_count_closest_to_a_year_earlier():
    pts = series(("2025-07-25", 120e6, "2025-08-01"), ("2025-10-18", 104e6, "2025-10-30"),
                 ("2025-10-28", 110e6, "2025-11-04"), ("2026-10-24", 100e6, "2026-11-03"))
    assert ft.shares_change(pts, REF_TS, REF_DAY) == round((100 / 110 - 1) * 100, 2)   # 361 days beats 371
    buyback = series(("2025-10-20", 104e6, "2025-11-01"), ("2026-10-24", 100e6, "2026-11-03"))
    assert ft.shares_change(buyback, REF_TS, REF_DAY) == -3.85
    dilution = series(("2025-10-20", 80e6, "2025-11-01"), ("2026-10-24", 100e6, "2026-11-03"))
    assert ft.shares_change(dilution, REF_TS, REF_DAY) == 25.0
    assert ft.shares_change(series(("2025-07-25", 104e6, "2025-08-01"), ("2026-10-24", 100e6, "2026-11-03")),
                            REF_TS, REF_DAY) is None                  # 456 days: no year-ago count
    assert ft.shares_change(series(("2025-10-20", 0.0, "2025-11-01"), ("2026-10-24", 100e6, "2026-11-03")),
                            REF_TS, REF_DAY) is None


def test_a_company_with_too_few_quarters_has_absent_keys_never_zero():
    assert ft.stock_trends({}, REF_TS, REF_DAY) == {}
    thin = {"revenue_growth_yoy_q": quarterly({"2026-09-30": 20.0}),
            "eps_growth_yoy_q": quarterly({"2026-09-30": 10.0})}
    assert ft.stock_trends(thin, REF_TS, REF_DAY) == {"eps_streak_25": 0}
    full = {"revenue_growth_yoy_q": quarterly({"2026-06-30": 15.0, "2026-09-30": 20.0}),
            "eps_growth_yoy_q": quarterly(EPS),
            "net_margin_ttm": quarterly({"2025-09-30": 10.0, "2026-09-30": 12.0}),
            "gross_margin_ttm": quarterly({"2025-09-30": 40.0, "2026-09-30": 38.5}),
            "shares_outstanding": series(("2025-10-20", 104e6, "2025-11-01"), ("2026-10-24", 100e6, "2026-11-03"))}
    assert ft.stock_trends(full, REF_TS, REF_DAY) == {
        "rev_accel_q": 1, "eps_streak_25": 3, "eps_growth_min_2q": 30.0, "eps_growth_min_3q": 26.0,
        "eps_growth_min_4q": 24.0, "net_margin_chg_1y": 2.0, "gross_margin_chg_1y": -1.5, "shares_chg_1y": -3.85}


def test_the_columns_windows_and_series_are_one_set():
    assert [c for c in ft.COLUMNS if c.startswith("eps_growth_min_")] == \
        [f"eps_growth_min_{n}q" for n in ft.EPS_MIN_WINDOWS]
    from api.services.fundamentals_pit import catalog
    assert set(ft.SERIES_NEEDED) <= catalog.stored_series_ids()
    from api.services.screener import snapshot_db
    for c in ft.COLUMNS:
        assert c in snapshot_db.COLUMNS, c
        assert (c in snapshot_db._INT) == (c in ft.INT_COLUMNS), c


# ── the clock ─────────────────────────────────────────────────────────────────────────────────

def test_the_quiet_span_is_scan_periods_own():
    from api.services import scan_period
    t = datetime(2026, 11, 16, 0, 0, tzinfo=ET)
    for i in range(7 * 24 * 4):
        now = t + timedelta(minutes=15 * i)
        assert ft.quiet(now) == scan_period._reuse_quiet_now(now), now


def test_the_evening_key_and_the_reference_close():
    assert ft.evening_key(datetime(2026, 11, 20, 20, 40, tzinfo=ET)) == "2026-11-20"
    assert ft.evening_key(datetime(2026, 11, 20, 20, 10, tzinfo=ET)) == "2026-11-19"
    assert ft.evening_key(datetime(2026, 11, 21, 1, 35, tzinfo=ET)) == "2026-11-20"   # Saturday small hours
    assert ft.evening_key(datetime(2026, 11, 23, 2, 35, tzinfo=ET)) == "2026-11-20"   # Monday before the open
    from api.services.fundamentals_pit.asof import close_utc
    assert ft.reference(EVENING) == (date(2026, 11, 20), close_utc(date(2026, 11, 20)).timestamp())
    assert datetime.fromtimestamp(REF_TS, ET).strftime("%H:%M") == "16:00"


def test_lag_is_counted_in_trading_sessions():
    assert ft.lag_sessions(EVENING, date(2026, 11, 20)) == 0
    assert ft.lag_sessions(EVENING, date(2026, 11, 23)) == 1          # over a weekend: one session
    assert ft.lag_sessions(EVENING, date(2026, 11, 30)) == ft.MAX_LAG_SESSIONS + 1
    assert ft.lag_sessions(EVENING, None) is None


# ── the read path: the store's own source selection, never its per-company cache ──────────────

def _artifact(cik: int, metrics: dict, **extra) -> dict:
    from api.services.fundamentals_pit.derive import DERIVATION_VERSION
    return {"v": 1, "cik": cik, "tickers": [], "name": "Invented Co", "derivation_version": DERIVATION_VERSION,
            "input_hash": "x", "built_at": 1.0, "split_status": "verified", "metrics": metrics, **extra}


@pytest.fixture
def local_store(tmp_path, monkeypatch):
    """A local artifact directory in the publish layout, served through `serving` in its `local` mode."""
    from api.services.fundamentals_pit import publish as P, serving
    from api.services.fundamentals_pit.derive import DERIVATION_VERSION
    root = tmp_path / "pit"

    def put(key, doc):
        path = root.joinpath(*key.split("/"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc), encoding="utf-8")

    monkeypatch.setenv("FUNDAMENTALS_PIT_SOURCE", "local")
    monkeypatch.setenv("FUNDAMENTALS_PIT_ARTIFACT_DIR", str(root))
    monkeypatch.delenv("FUNDAMENTALS_PIT_SERVE", raising=False)
    serving.clear_cache()
    put(P.index_key(DERIVATION_VERSION), {"v": 1, "derivation_version": DERIVATION_VERSION,
                                          "tickers": {"ZZQA": 9000001, "ZZQG-B": 9000002, "ZZQE": 9000005}})
    put(P.key_for(9000001, DERIVATION_VERSION), _artifact(9000001, {
        "revenue_growth_yoy_q": quarterly({"2026-06-30": 15.0, "2026-09-30": 20.0}),
        "eps_growth_yoy_q": quarterly(EPS), "assets": quarterly({"2026-09-30": 5e9})}))
    put(P.key_for(9000002, DERIVATION_VERSION), _artifact(9000002, {
        "net_margin_ttm": quarterly({"2025-09-30": 10.0, "2026-09-30": 12.0})}, withheld_split_sensitive=True))
    yield root
    serving.clear_cache()


def test_the_store_names_this_read_couples_to_still_exist():
    from api.services.fundamentals_pit import publish, serving, v5_publish
    for name in ("_mode", "_read_key", "_db_conn", "current_source", "_cache"):
        assert hasattr(serving, name), name
    assert callable(publish.key_for) and callable(v5_publish.obj_key)


def test_the_reader_goes_through_the_source_selection_and_holds_no_artifact(local_store):
    from api.services.fundamentals_pit import serving
    read, close, tag = ft.artifact_reader()
    try:
        art, found = read("ZZQA")
        assert found and art["cik"] == 9000001 and "eps_growth_yoy_q" in art["metrics"]
        art2, found2 = read("ZZQG.B")                       # the screener's dot spelling, the store's hyphen
        assert found2 and art2["cik"] == 9000002
        assert read("ZZQZ") == (None, False)                # not a filer the store holds
        assert read("ZZQE") == (None, True)                 # held in the index, no artifact published
    finally:
        close()
    assert tag == "v4"
    held = [k for k in serving._cache if k.startswith(("art:", "v5o:"))]
    assert held == [], f"the evening read left parsed artifacts in the serving cache: {held}"


def test_the_evening_build_through_the_real_read_path(local_store):
    pauses = []
    rows, receipt = ft.build(EVENING, symbols=["ZZQA", "ZZQG.B", "ZZQE", "ZZQZ"], pause=pauses.append, yield_s=0.0)
    assert rows == {"ZZQA": {"rev_accel_q": 1, "eps_streak_25": 3, "eps_growth_min_2q": 30.0,
                             "eps_growth_min_3q": 26.0, "eps_growth_min_4q": 24.0},
                    "ZZQG.B": {"net_margin_chg_1y": 2.0}}
    assert receipt["targets"] == 4 and receipt["covered"] == 3 and receipt["read"] == 2
    assert receipt["no_artifact"] == 1 and receipt["read_failed"] == 0 and receipt["split_withheld"] == 1
    assert receipt["filled"]["eps_streak_25"] == 1 and receipt["filled"]["shares_chg_1y"] == 0
    assert receipt["source"] == "v4"
    assert len(pauses) == 3, "a pause after every company the store holds"


# ── the side table, the job, the build's reader ───────────────────────────────────────────────

@pytest.fixture
def screener_db(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    ft.reset_for_tests()
    yield tmp_path
    ft.reset_for_tests()


def _stub_read(art_by_sym):
    def read(sym):
        if sym not in art_by_sym:
            return None, False
        a = art_by_sym[sym]
        if isinstance(a, Exception):
            raise a
        return a, True
    return read


GOOD = {"ZZQA": _artifact(1, {"revenue_growth_yoy_q": quarterly({"2026-06-30": 15.0, "2026-09-30": 20.0})}),
        "ZZQB": _artifact(2, {"eps_growth_yoy_q": quarterly(EPS)})}
QUIET = datetime(2026, 11, 20, 20, 40, tzinfo=ET)


def test_the_job_reads_nothing_while_the_store_is_switched_off(screener_db, monkeypatch):
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "0")
    calls = []
    assert ft.run_evening(QUIET, symbols=["ZZQA"], read=lambda s: calls.append(s)) == {"skipped": "off"}
    assert calls == [] and ft.stored_evening() is None
    assert ft.read_fields(["ZZQA"]) == {}


def test_the_job_runs_only_in_the_quiet_span_once_an_evening(screener_db):
    busy = datetime(2026, 11, 20, 15, 0, tzinfo=ET)
    assert ft.run_evening(busy, symbols=list(GOOD), read=_stub_read(GOOD), yield_s=0.0) == {"skipped": "not_quiet"}
    receipt = ft.run_evening(QUIET, symbols=list(GOOD), read=_stub_read(GOOD), yield_s=0.0)
    assert receipt["evening"] == EVENING and receipt["rows"] == 2 and receipt["not_stored"] is None
    assert ft.stored_evening() == EVENING
    again = ft.run_evening(QUIET + timedelta(hours=1), symbols=list(GOOD), read=_stub_read(GOOD), yield_s=0.0)
    assert again == {"skipped": "stored", "evening": EVENING}
    assert ft.read_fields(["ZZQA", "ZZQB", "ZZQC"]) == {
        "ZZQA": {"rev_accel_q": 1},
        "ZZQB": {"eps_streak_25": 3, "eps_growth_min_2q": 30.0, "eps_growth_min_3q": 26.0, "eps_growth_min_4q": 24.0}}
    assert ft.last_run()["stored"] is True


def test_an_evening_whose_reads_mostly_failed_does_not_replace_the_stored_one(screener_db):
    ft.store("2026-11-19", {"ZZQA": {"rev_accel_q": 2}}, {}, stored=True)
    broken = {**GOOD, "ZZQC": OSError("store down"), "ZZQD": OSError("store down")}
    receipt = ft.run_evening(QUIET, symbols=list(broken), read=_stub_read(broken), yield_s=0.0)
    assert receipt["read_failed"] == 2 and receipt["no_artifact"] == 0
    assert receipt["not_stored"] and "reads failed" in receipt["not_stored"]
    assert ft.stored_evening() == "2026-11-19"
    assert ft.read_fields(["ZZQA"]) == {"ZZQA": {"rev_accel_q": 2}}
    assert ft.last_run()["stored"] is False
    for _ in range(ft.TRIES_PER_EVENING - 1):
        ft.run_evening(QUIET, symbols=list(broken), read=_stub_read(broken), yield_s=0.0)
    assert ft.run_evening(QUIET, symbols=list(broken), read=_stub_read(broken))["skipped"] == "tries_spent"


def test_a_stored_evening_replaces_the_whole_table(screener_db):
    ft.store("2026-11-19", {"ZZQA": {"rev_accel_q": 2}, "ZZQF": {"shares_chg_1y": -1.0}}, {}, stored=True)
    ft.store(EVENING, {"ZZQA": {"rev_accel_q": 3}}, {}, stored=True)
    assert ft.read_fields(["ZZQA", "ZZQF"]) == {"ZZQA": {"rev_accel_q": 3}}


def test_the_reader_withholds_an_evening_too_far_behind_the_build(screener_db):
    ft.store(EVENING, {"ZZQA": {"rev_accel_q": 3, "shares_chg_1y": None}}, {}, stored=True)
    said, failures = {}, {}
    assert ft.read_fields(["ZZQA"], failures, settled=date(2026, 11, 23), receipt=said) == {"ZZQA": {"rev_accel_q": 3}}
    assert said == {"state": "served", "evening": EVENING, "lag_sessions": 1, "rows": 1, "matched": 1}
    assert ft.read_fields(["ZZQA"], failures, settled=date(2026, 11, 30), receipt=said) == {}
    assert said["state"] == "withheld_stale" and failures == {"fund_trends": {"withheld_stale": 1}}


def test_the_reader_says_missing_before_the_first_evening(screener_db):
    said, failures = {}, {}
    assert ft.read_fields(["ZZQA"], failures, receipt=said) == {}
    assert said["state"] == "missing" and failures == {"fund_trends": {"missing": 1}}


def test_no_member_route_reaches_the_job():
    import pathlib
    routers = pathlib.Path(ft.__file__).resolve().parents[2] / "routers"
    offenders = [p.name for p in routers.glob("*.py") if "fund_trends" in p.read_text(encoding="utf-8")]
    assert offenders == [], offenders


# ── the build: one read, the columns land, the filters screen them ────────────────────────────

def _weekday_ymds(n):
    out, d = [], date(2026, 11, 20)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d -= timedelta(days=1)
    return sorted(out)


def test_the_build_reads_the_side_table_once_and_writes_the_eight_columns(screener_db, monkeypatch):
    from api.services.screener import snapshot_builder as sb, snapshot_db
    from api.services.screener import (finviz_universe, earnings_dates, earnings_context, analyst_pass,
                                       insider_capture, short_columns, context_joins as cj)
    bars = [(ymd, 100.0, 100.5, 99.5, 100.0, 1000) for ymd in _weekday_ymds(60)]
    monkeypatch.setattr(sb, "_load_universe", lambda: ["ZZQA", "ZZQB", "ZZQC"])
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_bars", lambda t, tf, n: bars)
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_fundamentals", lambda t, price=None, failures=None: {})
    monkeypatch.setattr(sb, "_read_spy_closes", lambda: [])
    monkeypatch.setattr(sb, "settled_session", lambda now=None: date(2026, 11, 23))
    monkeypatch.setattr(sb, "_read_settled_bars", lambda d: {"error": "not in this test"})
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    for mod, fn in ((finviz_universe, "read_finviz_fields"), (earnings_dates, "read_earnings_dates"),
                    (earnings_context, "read_last_report_move"), (earnings_context, "read_implied_context"),
                    (analyst_pass, "read_analyst_fields"), (insider_capture, "read_insider_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None: {})
    monkeypatch.setattr(short_columns, "read_short_columns", lambda t, failures=None, receipt=None: {})
    ft.store(EVENING, {"ZZQA": {"rev_accel_q": 3, "eps_streak_25": 0, "net_margin_chg_1y": -1.25},
                       "ZZQB": {"rev_accel_q": 0, "shares_chg_1y": -4.5}}, {}, stored=True)
    calls = []
    real = ft.read_fields
    monkeypatch.setattr(ft, "read_fields", lambda *a, **kw: calls.append(1) or real(*a, **kw))

    out = sb.run_build(max_tickers=3)
    assert out["built"] == 3 and calls == [1], "one read per build, never one per ticker"
    assert out["fund_trends"]["state"] == "served" and out["fund_trends"]["matched"] == 2
    assert out["populated"]["rev_accel_q"] == 2 and out["populated"]["shares_chg_1y"] == 1
    a, b, c = (snapshot_db.get_row(t) for t in ("ZZQA", "ZZQB", "ZZQC"))
    assert (a["rev_accel_q"], a["eps_streak_25"], a["net_margin_chg_1y"], a["shares_chg_1y"]) == (3, 0, -1.25, None)
    assert (b["rev_accel_q"], b["shares_chg_1y"]) == (0, -4.5)
    assert all(c[k] is None for k in ft.COLUMNS), "a company with no trend figures stays NULL, never 0"


def _snapshot(tmp_path, monkeypatch, rows):
    from tests.test_screener_filters import _snapshot as snap
    return snap(tmp_path, monkeypatch, rows)


def test_the_filters_screen_the_trend_columns_end_to_end(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "ZZQA", "rev_accel_q": 3, "eps_streak_25": 4, "eps_growth_min_3q": 31.0,
         "net_margin_chg_1y": 2.5, "gross_margin_chg_1y": 1.0, "shares_chg_1y": -3.0,
         "snapshot_date": EVENING, "built_at": 1},
        {"ticker": "ZZQB", "rev_accel_q": 1, "eps_streak_25": 1, "eps_growth_min_3q": 12.0,
         "net_margin_chg_1y": -0.5, "shares_chg_1y": 6.0, "snapshot_date": EVENING, "built_at": 1},
        {"ticker": "ZZQC", "rev_accel_q": 0, "eps_streak_25": 0, "snapshot_date": EVENING, "built_at": 1},
        # NULL is "cannot be worked out": inside no range, at either end
        {"ticker": "ZZQD", "snapshot_date": EVENING, "built_at": 1},
    ])
    from api.services.screener import query
    importlib.reload(query)

    def tickers(*fs):
        return sorted(r["ticker"] for r in query.run_scan({"filters": list(fs)})["rows"])

    assert tickers({"key": "rev_accel_q", "op": "gte", "min": 2}) == ["ZZQA"]
    assert tickers({"key": "rev_accel_q", "op": "lte", "max": 0}) == ["ZZQC"]
    assert tickers({"key": "eps_streak_25", "op": "gte", "min": 1}) == ["ZZQA", "ZZQB"]
    assert tickers({"key": "eps_growth_min_3q", "op": "gte", "min": 30}) == ["ZZQA"]
    assert tickers({"key": "net_margin_chg_1y", "op": "gt", "min": 0}) == ["ZZQA"]
    assert tickers({"key": "gross_margin_chg_1y", "op": "gte", "min": 0}) == ["ZZQA"]
    assert tickers({"key": "shares_chg_1y", "op": "lt", "max": 0}) == ["ZZQA"]
    assert tickers({"key": "shares_chg_1y", "op": "gt", "min": 0}) == ["ZZQB"]


# ── the registry, the client text, the methodology, the schedule ──────────────────────────────

def test_each_column_is_a_bare_control_in_its_own_family_with_a_seat_in_its_view():
    from api.services.screener import filters
    assert {"key": "fundamental_trends", "label": "Fundamental Trends"} in filters.CATEGORIES
    family = {k for k, f in filters.FILTERS.items() if f["category"] == "fundamental_trends"}
    assert family == set(ft.COLUMNS)
    view = filters.VIEWS["fundamental_trends"]["columns"]
    for c in ft.COLUMNS:
        f = filters.FILTERS[c]
        assert f["column"] == c and f["type"] == "range" and f["allow_custom"] is True
        assert [p["label"] for p in f["presets"]] == ["Any"] and f["presets_deferred"] is True
        assert f.get("agent_omit") is True, c
        assert c in view, c
    # the latest-quarter growth facts the Screener already holds sit beside them, not a second control
    assert {"rev_growth", "eps_growth"} <= set(view)
    catalog = {f["key"]: f for f in filters.field_catalog()}
    assert all(catalog[c].get("agent_omit") is True for c in ft.COLUMNS)


def _column_def_block(name):
    from tests.test_screener_filters import _column_def_block as block
    return block(name)


def test_the_client_text_states_the_writers_numbers():
    assert f"up to {ft.ACCEL_MAX}." in _column_def_block("rev_accel_q")
    eps = _column_def_block("eps_streak_25")
    assert f"at least {ft.EPS_STREAK_THRESHOLD:g}%" in eps and f"up to {ft.EPS_STREAK_MAX}." in eps
    assert f"{ft.EPS_STREAK_THRESHOLD:g}% is UCT's default" in eps.replace("\\'", "'")
    for n in ft.EPS_MIN_WINDOWS:
        assert f"of the last {n} quarters" in _column_def_block(f"eps_growth_min_{n}q")


def test_every_trend_column_publishes_a_method_with_the_stores_honesty_rules():
    from api.services.fundamentals_pit import catalog
    from api.services.screener import methodology as M
    doc = M.all_methods()
    published = {m["column"]: m for m in doc["methods"]}
    for c in ft.COLUMNS:
        m = published.get(c)
        assert m is not None, f"{c} ships without a method"
        assert m["family"] == "fundamental_trends" and m["one_line"] and m["scale"] and m["caveat"]
        assert catalog.FILING_LAG_NOTE in m["how"], c
        assert catalog.WHEN in m["how"], c
        assert "never 0" in m["caveat"], c
    for c in ("net_margin_chg_1y", "gross_margin_chg_1y"):
        assert catalog.TTM in published[c]["how"], c
    assert "zero or negative" in published["eps_streak_25"]["caveat"]
    assert "turnaround from a loss never qualifies" in published["eps_streak_25"]["caveat"]
    section = doc["fundamental_trends"]
    assert section["columns"] == list(ft.COLUMNS) and catalog.TTM in section["notes"]
    assert "20:15" in doc["as_of_note"] and "None of them" in doc["as_of_note"]


def test_the_fund_trend_methods_are_read_from_the_writer(monkeypatch):
    from api.services.screener import methodology as M
    monkeypatch.setattr(ft, "ACCEL_MAX", 6)
    monkeypatch.setattr(ft, "EPS_STREAK_THRESHOLD", 30.0)
    monkeypatch.setattr(ft, "YEAR_GAP_DAYS", (350, 380))
    by = {m["column"]: m for m in M._fund_trend_methods()}
    assert by["rev_accel_q"]["scale"] == "0 to 6 quarters"
    assert by["eps_streak_25"]["label"] == "EPS Growth 30%+ Streak (quarters)"
    assert "350 to 380 days apart" in by["net_margin_chg_1y"]["how"]


def test_the_evening_job_is_registered_unconditionally_inside_the_quiet_span(monkeypatch):
    from tests.test_scan_live_sweep import _add_job_gate_depth, _register
    jobs = _register(monkeypatch)
    job = jobs["screener_fund_trends_evening"]
    assert job["fn"] is ft.scheduled_run
    assert job["max_instances"] == 1 and job["coalesce"] is True and job["misfire_grace_time"] >= 60
    trig = job["trigger"]
    fields = {f.name: str(f) for f in trig.fields}
    assert fields["hour"] == ft.TICK_HOURS_ET and fields["minute"] == str(ft.TICK_MINUTE_ET)
    assert str(trig.timezone) == "America/New_York"
    # every tick is quiet on a weekday, and before the 03:00 build
    for h in (20, 21, 22, 23, 0, 1, 2):
        tick = datetime(2026, 11, 18, h, ft.TICK_MINUTE_ET, tzinfo=ET)
        assert ft.quiet(tick), h
    assert _add_job_gate_depth().get("screener_fund_trends_evening") == 0


def test_a_raising_run_never_escapes_the_tick(monkeypatch, caplog):
    monkeypatch.setattr(ft, "run_evening", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    ft.scheduled_run()
    assert any("run failed" in r.getMessage() for r in caplog.records)
