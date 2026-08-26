"""Volume Surge accumulator — the time-of-day RVOL metric + gates.

Drives `volume_live._tick_once` with synthetic snapshot sequences (no live feed).
RVOL is the TC2000-style relative volume: today's cumulative volume / what the name
TYPICALLY trades by this time of day (prev_vol × the intraday cumulative curve). The
tests fix the clock at 13:00 ET (curve = 0.52) and shrink the price/dollar windows so
a handful of samples spans them.
"""
from datetime import datetime

import pytest

from api.services import volume_live


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    volume_live._state = {
        "session_key": None, "window": "closed", "date": None,
        "syms": {}, "asof": None, "ticks": 0, "last_error": None,
    }
    volume_live._top_set = None
    volume_live._top_built = 0.0
    monkeypatch.setattr(volume_live, "_universe_map",
                        lambda: {"AAA": "AAA", "BBB": "BBB", "CHEAP": "CHEAP", "THIN": "THIN"})
    monkeypatch.setattr(volume_live, "_etf_set", lambda: set())
    monkeypatch.setattr(volume_live, "_PRICE_SECS", 10.0)
    monkeypatch.setattr(volume_live, "_NOW_DOLLAR_SECS", 10.0)
    monkeypatch.setattr(volume_live, "_MIN_SAMPLE_GAP", 1.0)
    yield


_NOW = datetime(2026, 8, 25, 13, 0, 0)   # 13:00 ET → cumulative curve = 0.52


def test_cumfrac_curve_is_monotone_and_time_of_day_aware():
    f = volume_live._cumfrac
    assert f(datetime(2026, 8, 25, 4, 0)) == 0.0        # pre-market open
    assert 0.0 < f(datetime(2026, 8, 25, 8, 0)) < 0.05  # thin pre-market
    assert f(datetime(2026, 8, 25, 9, 30)) == pytest.approx(0.05, abs=1e-6)   # RTH open
    assert 0.9 < f(datetime(2026, 8, 25, 16, 0)) <= 0.96                       # RTH close
    assert f(datetime(2026, 8, 25, 20, 0)) == 1.0
    # Strictly rising through the day.
    pts = [f(datetime(2026, 8, 25, h, 0)) for h in (5, 8, 10, 12, 14, 16, 18, 20)]
    assert all(b >= a for a, b in zip(pts, pts[1:]))


def _feed(rows_by_t):
    for t in sorted(rows_by_t):
        snap = {app: dict(r) for app, r in rows_by_t[t].items()}
        volume_live._tick_once(snap, "rth", "2026-08-25", _NOW, float(t))


def _row(rows, sym):
    return next((r for r in rows if r["sym"] == sym), None)


def test_unusual_cumulative_volume_with_a_move_is_lit_and_tiered():
    # AAA has traded ~2.7M shares by 13:00 vs a typical 1M-share day → expected by
    # now = 1M × 0.52 = 520k → RVOL ≈ 5.2. Plus a real price move in the last window.
    seq = {}
    for t in range(0, 46):
        cv = 60_000 * t                                    # 2.7M by t=45
        px = 10.0 if t <= 36 else 10.0 + 0.15 * (t - 36)   # ramps up in the last window
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 10.0, "prev_vol": 1_000_000}}
    _feed(seq)
    aaa = _row(volume_live.get_live(min_dollar=0)["rows"], "AAA")
    assert aaa is not None and aaa["lit"] is True
    assert 4.5 <= aaa["rvol"] <= 6                          # cumulative ~5.2×
    assert aaa["tier"] == 3 and aaa["burst"] > 0           # tier tracks cumulative RVOL (High)
    assert aaa["move"] > 1 and aaa["dir"] == "up"


def test_a_modest_burst_below_the_surge_bar_does_not_light():
    # STABILITY: a quiet name with a MODEST fresh burst (below the instant-surge bar) must
    # NOT light — the old low burst gate made quiet names flicker in and out of the shaded
    # set every few seconds. Only heavy SUSTAINED volume OR a BIG instant surge lights.
    seq = {}
    for t in range(0, 46):
        cv = 200_000 if t <= 35 else 200_000 + 150 * (t - 35)   # flat, then a modest 60-sec blip
        px = 50.0 if t <= 35 else 50.0 + 0.045 * (t - 35)       # +0.9% (below the surge move bar)
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 50.0, "prev_vol": 1_000_000}}
    _feed(seq)
    r = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert r is not None and r["rvol"] < 2       # sustained RVOL is low (a quiet name)
    assert 4 <= r["burst"] < 8                    # a modest burst, below the instant-surge bar
    assert r["lit"] is False and r["igniting"] is False   # neither path fires — no flicker
    assert volume_live.get_live(min_dollar=0)["rows"] == []


def test_high_priced_megacap_on_news_is_surfaced_not_price_capped():
    # A META-class name (~$590) making a fast pre-market news move. The old $250 cap
    # silently hid EVERY megacap — the exact liquid names this scanner exists to catch.
    seq = {}
    for t in range(0, 46):
        cv = 300_000 if t <= 35 else 300_000 + 3_500 * (t - 35)   # quiet, then a BIG instant surge
        px = 590.0 if t <= 35 else 590.0 + 0.9 * (t - 35)         # a fast +1.5% pop
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 590.0, "prev_vol": 15_000_000}}
    _feed(seq)
    r = _row(volume_live.get_live(min_dollar=0)["rows"], "AAA")
    assert r is not None and r["lit"] is True            # surfaced + lit (not price-capped)
    assert r["price"] > 250                              # a megacap the old cap excluded
    assert r["burst"] >= 8 and r["igniting"] is True     # a big INSTANT surge, caught immediately
    # The price band is still a real filter: an explicit low cap still excludes it.
    assert _row(volume_live.get_live(max_price=250, min_dollar=0)["rows"], "AAA") is None


def test_sustained_recent_volume_is_the_primary_signal_and_rings():
    # A name QUIET most of the session (low cumulative RVOL) that goes HEAVY and STAYS
    # heavy for the last few minutes with a real move — the META-on-news shape. The
    # SUSTAINED recent RVOL must light it BOLD (high tier) + ring, even though cumulative
    # RVOL is still low. (Long history so the sustained window is measured, not the
    # cumulative fallback.)
    seq = {}
    for t in range(0, 201):
        cv = 278 * t                 # ~10× the normal per-second rate at 13:00, sustained
        px = 100.0 + 0.1 * t         # a real, sustained climb
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 100.0, "prev_vol": 1_000_000}}
    _feed(seq)
    r = _row(volume_live.get_live(min_dollar=0)["rows"], "AAA")
    assert r is not None and r["lit"] is True
    assert r["rvol_day"] < 1          # cumulative is LOW (quiet overall)…
    assert r["rvol"] >= 6             # …but the SUSTAINED recent RVOL is high
    assert r["surge_intraday"] > 1    # recent pace well ABOVE its own day pace (accelerating)
    assert r["tier"] >= 4             # → bold (Very High / Extreme)
    assert r["igniting"] is True      # sustained + accelerating + moving → the gold ring


def test_normal_activity_reads_below_1x_and_is_not_lit():
    # QUIET trades ~300k by 13:00 vs 520k expected → RVOL ≈ 0.58 (below normal).
    seq = {}
    for t in range(0, 46):
        seq[t] = {"AAA": {"min_av": 6_666 * t, "last_price": 50.0, "prev_close": 50.0, "prev_vol": 1_000_000}}
    _feed(seq)
    lit = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert lit is not None and lit["lit"] is False and lit["rvol"] < 1
    assert volume_live.get_live(show_all=False, min_dollar=0)["rows"] == []


def test_illiquid_now_window_is_filtered_by_the_dollar_floor(monkeypatch):
    # A name that traded heavily EARLIER (high cumulative RVOL) but is dead NOW: its
    # last-minute $-volume is ~0, so despite a high RVOL + a small tick it must drop.
    monkeypatch.setattr(volume_live, "_universe_map", lambda: {"DEAD": "DEAD"})
    seq = {}
    for t in range(0, 46):
        cv = 150_000 * t if t <= 20 else 3_000_000          # surges early, then FLAT (dead now)
        px = 14.0 if t <= 35 else 14.0 + 0.01 * (t - 35)    # a tiny tick (passes the move gate)
        seq[t] = {"DEAD": {"min_av": cv, "last_price": px, "prev_close": 14.0, "prev_vol": 1_000_000}}
    _feed(seq)
    lit = _row(volume_live.get_live(min_dollar=0)["rows"], "DEAD")
    assert lit is not None and lit["rvol"] >= 2 and abs(lit["move"]) >= 0.25
    assert lit["dvol"] < 15_000                             # ~nothing traded in the last minute
    assert _row(volume_live.get_live()["rows"], "DEAD") is None            # default floor drops it
    assert _row(volume_live.get_live(min_dollar=100_000)["rows"], "DEAD") is None


def test_tradability_floor_excludes_cheap_and_illiquid_names():
    seq = {}
    for t in range(0, 46):
        cv = 60_000 * t
        seq[t] = {
            "CHEAP": {"min_av": cv, "last_price": 0.50, "prev_close": 0.50, "prev_vol": 5_000_000},
            "THIN":  {"min_av": cv, "last_price": 14.0, "prev_close": 14.0, "prev_vol": 1_000},
        }
    _feed(seq)
    rows = volume_live.get_live(min_dollar=0, show_all=True)["rows"]
    assert _row(rows, "CHEAP") is None      # sub-$1
    assert _row(rows, "THIN") is None       # below the 100k liquidity floor


def test_show_all_lists_the_whole_universe_lit_first_then_by_rvol(monkeypatch):
    monkeypatch.setattr(volume_live, "_universe_map", lambda: {"HOT": "HOT", "NOISE": "NOISE"})
    seq = {}
    for t in range(0, 46):
        # HOT: high cumulative + a price move (lit). NOISE: EVEN higher cumulative
        # RVOL but flat price (unlit via the move gate) — must sink below HOT.
        hot_px = 10.0 if t <= 36 else 10.0 + 0.15 * (t - 36)
        seq[t] = {
            "HOT":   {"min_av": 60_000 * t, "last_price": hot_px, "prev_close": 10.0, "prev_vol": 1_000_000},
            "NOISE": {"min_av": 90_000 * t, "last_price": 50.0,   "prev_close": 50.0, "prev_vol": 1_000_000},
        }
    _feed(seq)
    rows = volume_live.get_live(show_all=True, min_dollar=0)["rows"]
    syms = [r["sym"] for r in rows]
    assert "HOT" in syms and "NOISE" in syms
    assert _row(rows, "HOT")["lit"] is True
    assert _row(rows, "NOISE")["lit"] is False
    assert _row(rows, "NOISE")["rvol"] > _row(rows, "HOT")["rvol"]   # NOISE reads higher…
    assert syms.index("HOT") < syms.index("NOISE")                   # …yet the lit name ranks above
    assert volume_live.get_live(show_all=True, min_dollar=0)["total"] == 1


def test_scans_only_the_top_liquid_names(monkeypatch):
    monkeypatch.setenv("VOLUME_UNIVERSE_TOP", "1")
    monkeypatch.setattr(volume_live, "_universe_map", lambda: {"BIG": "BIG", "SMALL": "SMALL"})
    seq = {}
    for t in range(0, 46):
        px = 10.0 if t <= 36 else 10.0 + 0.15 * (t - 36)
        seq[t] = {
            "BIG":   {"min_av": 60_000 * t, "last_price": px, "prev_close": 100.0, "prev_vol": 5_000_000},
            "SMALL": {"min_av": 60_000 * t, "last_price": px, "prev_close": 2.0,   "prev_vol": 60_000},
        }
    _feed(seq)
    assert "SMALL" not in volume_live._state["syms"]
    rows = volume_live.get_live(min_dollar=0, show_all=True)["rows"]
    assert _row(rows, "BIG") is not None
    assert _row(rows, "SMALL") is None


def test_min_rvol_and_min_move_filters_are_honored():
    seq = {}
    for t in range(0, 46):
        px = 10.0 if t <= 36 else 10.0 + 0.008 * (t - 36)   # a small move (no big day-move)
        seq[t] = {"AAA": {"min_av": 60_000 * t, "last_price": px, "prev_close": 10.0, "prev_vol": 1_000_000}}
    _feed(seq)
    # min_rvol / min_move are honoured. A high min_rvol excludes the name (its move is below
    # the instant-surge bar, so there's no backdoor); a high min_move excludes it.
    assert volume_live.get_live(min_rvol=999, min_dollar=0)["rows"] == []
    assert _row(volume_live.get_live(min_rvol=2, min_dollar=0)["rows"], "AAA") is not None
    assert volume_live.get_live(min_move=999, min_dollar=0)["rows"] == []


def test_closed_window_serves_no_rows():
    volume_live._tick_once({}, "closed", "2026-08-25", _NOW, 0.0)
    assert volume_live.get_live()["rows"] == []


def test_push_aggregate_refreshes_a_tracked_symbol(monkeypatch):
    # The instant A.* push refreshes ONE tracked symbol's volume + price in ~1s, between
    # the slower REST polls. Gated by VOLUME_PUSH_ENABLED; inert when off.
    monkeypatch.setenv("VOLUME_PUSH_ENABLED", "1")
    monkeypatch.setattr(volume_live, "_now_et", lambda: _NOW)
    monkeypatch.setattr(volume_live, "_active_window", lambda now=None: "rth")

    class _FT:
        def time(self):
            return 46.0
    monkeypatch.setattr(volume_live, "_time", _FT())

    # The REST poll tracks AAA + sets its prev-day baseline (cv ~2.7M by 13:00).
    seq = {t: {"AAA": {"min_av": 60_000 * t, "last_price": 10.0,
                       "prev_close": 10.0, "prev_vol": 1_000_000}} for t in range(0, 46)}
    _feed(seq)
    before = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert before is not None

    # A per-second A push: accumulated volume jumps + price ticks up. bar_stream delivers
    # the bar dict directly as the payload (av = accumulated day volume, c = last price).
    volume_live.on_aggregate("AAA", {"av": 5_000_000, "c": 10.5, "v": 100_000}, "A")
    after = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert after is not None
    assert after["price"] == pytest.approx(10.5)      # price refreshed by the push
    assert after["rvol"] > before["rvol"]             # accumulated volume jumped → RVOL rose

    # Flag OFF → the push is inert (no refresh).
    monkeypatch.setenv("VOLUME_PUSH_ENABLED", "0")
    volume_live.on_aggregate("AAA", {"av": 9_000_000, "c": 12.0, "v": 1}, "A")
    still = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert still["price"] == pytest.approx(10.5)      # unchanged with the push off
