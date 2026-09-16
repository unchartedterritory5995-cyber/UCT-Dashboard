"""RTH-ONLY RECONSTRUCTION + COMPOSITES-BEFORE-OHLC.

⭐⭐ THE THREE CLAIMS UNDER TEST, each a measured production defect:

  1. the reconstruction domain is the REGULAR SESSION, not 4:00-20:00
  2. the resolution is 1-minute, not 30
  3. NETHL / PH / PL are derived AT EACH MINUTE and then aggregated on their own
     path — never assembled from their components' finished candles
"""
import datetime as dt

import pytest

from api.services import breadth_session as bsess
from api.services import breadth_wick_recon as wr

ET = "America/New_York"


def _ts(iso_date, hh, mm):
    from zoneinfo import ZoneInfo
    d = dt.date.fromisoformat(iso_date)
    return int(dt.datetime(d.year, d.month, d.day, hh, mm,
                           tzinfo=ZoneInfo(ET)).timestamp())


def _session(iso, close_hh=16, close_mm=0, busy=400, thin=3,
             pre=True, post=True):
    """A synthetic minute session: `busy` names per RTH minute, `thin` outside it."""
    per = {}

    def add(tk, ts):
        per.setdefault(tk, []).append({"t": ts, "o": 1.0, "h": 1.0, "l": 1.0,
                                       "c": 1.0, "v": 1})
    cur = dt.datetime(2000, 1, 1, 9, 30)
    end = dt.datetime(2000, 1, 1, close_hh, close_mm)
    while cur < end:
        for i in range(busy):
            add(f"T{i}", _ts(iso, cur.hour, cur.minute))
        cur += dt.timedelta(minutes=1)
    if pre:
        for hh, mm in ((4, 0), (7, 15), (9, 29)):
            for i in range(thin):
                add(f"T{i}", _ts(iso, hh, mm))
    if post:
        for hh, mm in ((16, 30), (18, 0), (19, 59)):
            for i in range(thin):
                add(f"T{i}", _ts(iso, hh, mm))
    return per


# ── the session window ───────────────────────────────────────────────────────

def test_a_a_normal_session_derives_a_16_00_close():
    per = _session("2026-07-23")
    lo, hi = bsess.rth_bounds(per)
    assert lo == 9 * 60 + 30
    assert hi == 16 * 60 - 1, "the last RTH minute BAR starts at 15:59"
    assert bsess.is_early_close(hi) is False


def test_b_a_half_day_derives_a_13_00_close_with_no_calendar_entry():
    """⭐ THE REASON THE BOUNDARY IS DERIVED. The canonical early-close set starts at
    2025-01-01 and this reconstruction runs to 2008; a half-day in 2013 is in no list
    we own. The market's own participation says when it closed."""
    per = _session("2013-11-29", close_hh=13)
    lo, hi = bsess.rth_bounds(per)
    assert lo == 9 * 60 + 30
    assert hi == 13 * 60 - 1
    assert bsess.is_early_close(hi) is True


def test_c_premarket_and_postmarket_are_outside_the_domain():
    """⛔ THE REGRESSION RAIL for the exact defect found: 4:00-20:00 replay.

    ⚠️ AND FOR THE OFF-BY-ONE THAT FOLLOWED IT. The first proof run produced 391
    buckets with a last minute of 16:00, because the upper bound was inclusive. A bar
    stamped 16:00 covers 16:00:00-16:00:59 — after the bell. The session is the 390
    bars 09:30 through 15:59; the closing auction reaches the candle through the
    authoritative EOD close, not through the intraday path.
    """
    per = _session("2026-07-23", post=True)
    # a REAL 16:00 bar, which is what the live flat file carries and what the first
    # proof run let through
    for i in range(400):
        per.setdefault(f"T{i}", []).append(
            {"t": _ts("2026-07-23", 16, 0), "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1})
    buckets = sorted({b["t"] for bars in per.values() for b in bars})
    kept = bsess.rth_buckets(per, buckets)
    mins = {bsess.et_minute(t) for t in kept}
    assert min(mins) == 9 * 60 + 30
    assert max(mins) == 16 * 60 - 1
    assert not [m for m in mins if m < 9 * 60 + 30], "a premarket minute survived"
    assert not [m for m in mins if m >= 16 * 60], "a postmarket minute survived"
    assert len(kept) == 390, "a normal session is 390 one-minute bars"


def test_d_a_half_day_keeps_210_minutes():
    per = _session("2026-11-27", close_hh=13)
    buckets = sorted({b["t"] for bars in per.values() for b in bars})
    assert len(bsess.rth_buckets(per, buckets)) == 210


def test_e_a_session_with_no_real_participation_is_REFUSED_not_guessed():
    per = _session("2026-07-23", busy=5)          # under MIN_BUSY_NAMES
    assert bsess.rth_bounds(per) is None
    assert bsess.rth_buckets(per, [1, 2, 3]) == []


def test_f_the_derived_close_is_checked_against_the_canonical_calendar():
    """⛔ 'no authority disagreed' is not 'the authority agreed'. Inside the calendar's
    era the derived close must MATCH; outside it the rail says so rather than passing."""
    ok, detail = bsess.validate_against_calendar("2026-11-27", 13 * 60 - 1)
    assert ok and "agrees" in detail, detail
    bad, detail2 = bsess.validate_against_calendar("2026-11-27", 16 * 60 - 1)
    assert bad is False and "disagrees" in detail2, detail2
    old_ok, old_detail = bsess.validate_against_calendar("2013-11-29", 13 * 60 - 1)
    assert old_ok and "unverifiable" in old_detail, old_detail


def test_g_dst_does_not_shift_the_window():
    """⚠️ The flat files are UTC. A fixed -4/-5 offset would move the whole session for
    every winter date in the archive."""
    for iso in ("2026-01-15", "2026-07-15"):
        per = _session(iso)
        lo, hi = bsess.rth_bounds(per)
        assert (lo, hi) == (9 * 60 + 30, 16 * 60 - 1), iso


# ── composites ───────────────────────────────────────────────────────────────

def test_h_composites_are_derived_at_each_timestamp():
    m = {"new_52w_highs": 40, "new_52w_lows": 10, "universe_count": 200}
    wr._add_composites(m)
    assert m["net_new_high_low"] == 30
    assert m["hi_ratio"] == 20.0
    assert m["lo_ratio"] == 5.0


def test_i_a_zero_denominator_is_a_NON_VALUE_never_a_zero():
    """⛔ An empty universe means the ratio is unknown. Publishing 0.0 would read as
    'no stock is at a 52-week high', which is a claim we did not measure."""
    m = {"new_52w_highs": 5, "new_52w_lows": 1, "universe_count": 0}
    wr._add_composites(m)
    assert "hi_ratio" not in m and "lo_ratio" not in m
    assert m["net_new_high_low"] == 4


def test_j_NETHL_HIGH_IS_ITS_OWN_PATH_not_component_extrema():
    """⛔⛔ THE DEFECT THIS WHOLE FIX EXISTS FOR.

    NH peaks at minute 0, NL peaks at minute 2. The invalid shortcut
    `max(NH) - min(NL)` reads 90 - 5 = 85; the TRUE maximum of the composite's own
    path is 55. They differ because the extrema never coexisted.
    """
    path = [                       # (NH, NL) per minute
        (90, 35),                  # NETHL = 55   <- the real high
        (60, 5),                   # NETHL = 55 ... equal here by construction? no: 55
        (20, 5),                   # NETHL = 15   <- NL's own low
        (30, 60),                  # NETHL = -30  <- the real low
    ]
    series = []
    for nh, nl in path:
        m = {"new_52w_highs": nh, "new_52w_lows": nl, "universe_count": 100}
        wr._add_composites(m)
        series.append(m["net_new_high_low"])
    true_high, true_low = max(series), min(series)
    bogus_high = max(p[0] for p in path) - min(p[1] for p in path)
    bogus_low = min(p[0] for p in path) - max(p[1] for p in path)
    assert true_high == 55 and true_low == -30
    assert bogus_high == 85 and bogus_low == -40
    assert true_high != bogus_high, "component extrema must not reproduce the composite"
    assert true_low != bogus_low


def test_k_PH_PL_have_the_same_property():
    """PH/PL are ratios of two simultaneous quantities and carry the identical defect."""
    path = [(90, 10, 1000), (10, 90, 100)]          # (NH, NL, universe)
    ph, pl = [], []
    for nh, nl, uni in path:
        m = {"new_52w_highs": nh, "new_52w_lows": nl, "universe_count": uni}
        wr._add_composites(m)
        ph.append(m["hi_ratio"])
        pl.append(m["lo_ratio"])
    assert ph == [9.0, 10.0] and pl == [1.0, 90.0]
    bogus_ph = max(p[0] for p in path) / min(p[2] for p in path) * 100
    assert max(ph) == 10.0 and bogus_ph == 90.0, "component extrema invent a 9x reading"


def test_l_the_reconstruction_defaults_to_one_minute():
    import inspect
    for fn in (wr.recon_day, wr.validate_recent, wr.probe_day):
        assert inspect.signature(fn).parameters["bucket_min"].default == 1, fn.__name__
