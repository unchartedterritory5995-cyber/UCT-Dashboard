"""Live 5-day / 1-month / 1-year change, MINV3.1 and market cap during the session.

Owner ask, 2026-11-10: "all scans should be immediately live ... as the market is moving intraday".

The one claim that matters, and the reason the build stores new bases instead of recovering them from
the stored columns: **a value the live tier publishes at 10:42 must equal what the nightly build would
compute if today's bar were already complete at the live price.** That is what TC2000 shows for
``c/c5`` and ``MinV3.1`` during the session, where today's developing bar is bar 0. Every lookback is
one session later than it was at 03:00, so recovering the base from the stored number gives the wrong
day (a 6-day change under a 5-day name), and the fixture here is built so that wrong answer is
DIFFERENT, not accidentally equal.
"""
from __future__ import annotations

import datetime

import pytest

from api.services.screener import live_tier, query, snapshot_db
from api.services.screener import technicals as T

ET = datetime.timezone(datetime.timedelta(hours=-4))
YMD = 20260824                     # a Monday
ANCHOR_ASOF = "20260821"           # the Friday before: a one-session-old anchor


def _bars(n=300):
    """Closes and volumes that never repeat in a way that could make two different days agree."""
    out = []
    for i in range(n):
        c = round(50 + i * 0.25 + (i * 7 % 11) * 0.9, 2)
        v = 500_000 + (i * 37 % 17) * 45_000
        out.append({"o": c, "h": c + 1, "l": c - 1, "c": c, "v": v})
    return out


def _anchor(bars, **over):
    row = T.compute_technicals(bars)
    row.update({"ticker": "AAA", "bars_asof": ANCHOR_ASOF, "market_cap": 2_000_000_000.0})
    row.update(over)
    return row


def _quote(p1, prev_close, vol=900_000):
    return {"last_price": p1, "prev_close": prev_close, "today_vol": vol, "prev_vol": 1_000_000,
            "day_open": prev_close}


# --------------------------------------------------------------------------- #
# the build stores the session-shifted bases
# --------------------------------------------------------------------------- #

def test_the_build_stores_the_bases_the_next_session_reads():
    bars = _bars()
    closes = [b["c"] for b in bars]
    vols = [b["v"] for b in bars]
    out = T.compute_technicals(bars)
    assert out["live_base_close_1w"] == closes[-5]
    assert out["live_base_close_1m"] == closes[-21]
    assert out["live_base_close_1y"] == closes[-252]
    assert out["live_base_min_volume_3d"] == min(vols[-3:])
    # and they are NOT the bases tonight's own columns used (one session earlier)
    assert out["chg_pct_1w"] == T._pct(closes[-1], closes[-6])
    assert closes[-5] != closes[-6]
    assert out["min_volume_3d_prior"] == min(vols[-4:-1]) != min(vols[-3:])


def test_a_short_or_gappy_history_leaves_the_base_blank_never_zero():
    short = _bars(4)
    out = T.compute_technicals(short)
    assert out["live_base_close_1w"] is None            # needs 5 closes
    assert out["live_base_min_volume_3d"] is not None   # 3 volumes is enough
    gappy = _bars(30)
    gappy[-2]["v"] = None
    assert T.compute_technicals(gappy)["live_base_min_volume_3d"] is None


def test_the_bases_are_not_screener_filters():
    from api.services.screener import filters
    keys = {f["key"] for f in filters.field_catalog()}
    assert not set(T.LIVE_BASE_COLUMNS) & keys
    assert set(T.LIVE_BASE_COLUMNS) <= set(snapshot_db.COLUMNS)


# --------------------------------------------------------------------------- #
# the live value equals tonight's build with today's bar appended at the live price
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("move", [0.96, 1.0, 1.04, 1.13])
def test_live_values_equal_the_build_with_todays_bar_appended(move):
    bars = _bars()
    anchor = _anchor(bars)
    p0 = anchor["price"]
    p1 = round(p0 * move, 2)
    today_vol = 1_234_567
    tomorrow = T.compute_technicals(bars + [{"o": p0, "h": max(p0, p1), "l": min(p0, p1), "c": p1,
                                             "v": today_vol}])
    got = live_tier.derive_row(anchor, _quote(p1, p0, vol=today_vol), YMD, 1.0)
    assert got is not None
    for col in ("chg_pct_1w", "chg_pct_1m", "chg_pct_1y", "min_volume_3d_prior"):
        assert got[col] == tomorrow[col], col
    assert got["market_cap"] == pytest.approx(2_000_000_000.0 * p1 / p0, rel=1e-9)


def test_the_fixture_distinguishes_recovery_from_the_stored_base():
    """The control: recovering the base from tonight's stored change (the obvious implementation) must
    give a DIFFERENT number on this fixture, or the test above proves nothing about which day was used."""
    bars = _bars()
    anchor = _anchor(bars)
    p0 = anchor["price"]
    p1 = round(p0 * 1.04, 2)
    recovered = live_tier._recover_level(p0, anchor["chg_pct_1w"])
    wrong = T._pct(p1, recovered)
    right = live_tier.derive_row(anchor, _quote(p1, p0), YMD, 1.0)["chg_pct_1w"]
    assert wrong != right
    assert abs(wrong - right) > 0.5


def test_a_missing_base_keeps_the_nightly_value_and_is_not_claimed_live():
    bars = _bars()
    anchor = _anchor(bars, live_base_close_1w=None, live_base_min_volume_3d=None, market_cap=None)
    p0 = anchor["price"]
    seen = set()
    got = live_tier.derive_row(anchor, _quote(round(p0 * 1.05, 2), p0), YMD, 1.0, recomputed_out=seen)
    assert got["chg_pct_1w"] == anchor["chg_pct_1w"]
    assert got["min_volume_3d_prior"] == anchor["min_volume_3d_prior"]
    assert got["market_cap"] is None
    assert not {"chg_pct_1w", "min_volume_3d_prior", "market_cap"} & seen
    assert {"chg_pct_1m", "chg_pct_1y"} <= seen          # the bases that exist still go live


# --------------------------------------------------------------------------- #
# end to end: the Anticipation starter picks up an intraday thrust
# --------------------------------------------------------------------------- #

@pytest.fixture
def live_env(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "1")
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    monkeypatch.setattr(live_tier, "_session", lambda: "regular")
    monkeypatch.setattr(live_tier, "_now_et", lambda: datetime.datetime(2026, 8, 24, 10, 42, tzinfo=ET))
    monkeypatch.setattr(live_tier, "_EFFECTIVE_COLUMNS", None)
    snapshot_db.init_db()
    return monkeypatch


def _row(ticker, **over):
    row = {c: None for c in snapshot_db.COLUMNS}
    row.update({"ticker": ticker, "price": 20.0, "bars_asof": ANCHOR_ASOF, "snapshot_date": "2026-08-22",
                "built_at": 1, "pct_vs_sma50": 10.0, "above_50sma": 1, "chg_pct_1w": 4.0,
                "live_base_close_1w": 17.0, "min_volume_3d_prior": 500_000.0,
                "live_base_min_volume_3d": 800_000.0, "market_cap": 400_000_000.0})
    row.update(over)
    return row


def _anticipation_hits():
    from api.services.screener import saved_screens
    starter = next(s for s in saved_screens.starters() if s["id"] == "starter_anticipation")
    spec = dict(starter["spec"], sort={"key": "ticker", "dir": "asc"})
    # `run_scan` is what POST /api/screener/scan calls: it resolves the overlay once per statement.
    return {r["ticker"] for r in query.run_scan(spec)["rows"]}


def test_an_intraday_thrust_enters_the_anticipation_list_before_tomorrows_build(live_env):
    """Nightly, RUNNER is up 4% in 5 days with 500K on its thinnest prior day: out on two counts.
    At 10:42 it trades 23.0 against a 5-session base of 17.0 (+35%), and its three newest completed
    sessions all cleared 800K. The list must show it NOW. FLAT has the same stored row and no move."""
    from api.services import scan_volume
    snapshot_db.upsert_rows([_row("RUNNER"), _row("FLAT")])
    assert _anticipation_hits() == set()                  # nightly: neither passes

    live_env.setattr(scan_volume, "full_market_snapshot", lambda: {
        "RUNNER": _quote(23.0, 20.0),
        "FLAT": _quote(17.5, 20.0),                       # +2.9% on the 5-day base: still out
    })
    receipt = live_tier.sweep_job()
    assert receipt.get("rows_written") == 2, receipt
    assert _anticipation_hits() == {"RUNNER"}


def test_with_the_live_tier_off_the_list_stays_on_nightly_values(live_env):
    """The control for the test above: same rows, same feed, tier switched off, nothing moves."""
    from api.services import scan_volume
    snapshot_db.upsert_rows([_row("RUNNER")])
    live_env.setattr(scan_volume, "full_market_snapshot", lambda: {"RUNNER": _quote(23.0, 20.0)})
    live_tier.sweep_job()
    live_env.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    assert _anticipation_hits() == set()
