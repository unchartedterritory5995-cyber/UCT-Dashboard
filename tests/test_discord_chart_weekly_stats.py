"""The stats strip under a WEEKLY chart describes the WEEK (2026-09-25).

⚰️ Measured that night on production renders: QQQ's weekly chart read "W $744.50 +3.19%" in its
header (the week) above a strip reading "Day +0.5%", the day's O/H/L/C and "Vol 30.3M", while
the volume pane on the same image said "Volume 179.4M". Two volumes for one chart.
"""
from __future__ import annotations

import datetime as dt

from api.services.discord_chart_render import _stats_rows, compute_stats


def _daily(weeks=14):
    """`weeks` full Mon..Fri weeks ending Fri 2026-09-25, a steady climb with known volumes."""
    out, px = [], 100.0
    start = dt.date(2026, 9, 25) - dt.timedelta(days=7 * weeks - 3)       # a Monday
    d = start
    while d <= dt.date(2026, 9, 25):
        if d.weekday() < 5:
            wk = (d - start).days // 7
            out.append({"t": d.isoformat(), "o": px, "h": px + 2, "l": px - 1, "c": px + 1,
                        "v": 1_000_000 * (wk + 1)})
            px += 1
        d += dt.timedelta(days=1)
    return out


def test_a_weekly_strip_is_the_developing_weeks_numbers():
    b = _daily()
    st = compute_stats(b, "W")
    week = b[-5:]
    assert st["period"] == "W" and st["avg_bars"] == 10
    assert (st["open"], st["high"], st["low"], st["close"]) == (
        week[0]["o"], max(x["h"] for x in week), min(x["l"] for x in week), week[-1]["c"])
    assert st["volume"] == sum(x["v"] for x in week) == 5 * 14_000_000
    prev_close = b[-6]["c"]
    assert abs(st["day_pct"] - (week[-1]["c"] / prev_close - 1) * 100) < 1e-9, "the change is the WEEK's"
    assert abs(st["gap_pct"] - (week[0]["o"] / prev_close - 1) * 100) < 1e-9
    prior = [5 * 1_000_000 * (w + 1) for w in range(3, 13)]                 # the 10 completed weeks before
    assert st["avg_vol"] == sum(prior) / 10 and st["avg_vol_50"] is None
    assert abs(st["rvol"] - st["volume"] / st["avg_vol"]) < 1e-12
    assert st["dollar_vol"] == st["volume"] * st["close"]


def test_range_adr_and_vintage_stay_daily_on_a_weekly_strip():
    b = _daily()
    d, w = compute_stats(b, "D"), compute_stats(b, "W")
    for k in ("hi_52w", "lo_52w", "adr_pct", "as_of"):
        assert w[k] == d[k], k
    assert w["as_of"] == "2026-09-25"


def test_the_daily_strip_is_unchanged_and_intraday_keeps_it():
    b = _daily()
    d = compute_stats(b)
    assert d["period"] == "D" and d["avg_bars"] == 50 and d["avg_vol"] == d["avg_vol_50"]
    assert d["close"] == b[-1]["c"] and d["volume"] == b[-1]["v"]
    assert compute_stats(b, "15") == d and compute_stats(b, "D") == d


def test_too_little_history_for_ten_weeks_prints_a_dash_not_a_wrong_average():
    st = compute_stats(_daily(weeks=6), "W")
    assert st["avg_vol"] is None and st["rvol"] is None


def test_the_fallback_image_labels_the_week():
    b = _daily()
    r1, r2 = _stats_rows(compute_stats(b, "W"))
    labels = [seg[0].strip() for seg in r1 + r2]
    assert "Wk" in labels and "Day" not in labels and "Avg(10w)" in labels
    r1, r2 = _stats_rows(compute_stats(b, "D"))
    labels = [seg[0].strip() for seg in r1 + r2]
    assert "Day" in labels and "Avg(50)" in labels


def test_the_house_render_is_handed_the_stats_for_ITS_timeframe():
    """The house path computes the strip and hands it to the page; a weekly request must carry
    the week's strip there, not the day's. (A rail on compute_stats alone passed while the call
    site still asked for daily stats.)"""
    from api.services import discord_chart_prefs as p
    from api.services.discord_interactions import ChartRequest, produce_chart
    from api.services.render_gate import MEMBER
    png = b"\x89PNG\r\n\x1a\n"
    for tf, period in (("W", "W"), ("D", "D")):
        seen = {}

        def house(ticker, t, stats, opts):
            seen["stats"] = stats
            return png + b"h"
        out = produce_chart(ChartRequest("WKST", tf), p.render_options(dict(p.DEFAULTS), tf), dict(p.DEFAULTS), (),
                            cls=MEMBER, bars_fn=lambda tkr, t, n: _daily(), render_fn=lambda *a, **k: png,
                            house_fn=house)
        assert out[0] == "ok", out[0]
        assert seen["stats"]["period"] == period, (tf, seen["stats"].get("period"))
