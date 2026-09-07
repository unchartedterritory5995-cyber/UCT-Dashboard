"""Two-view chart renderer for Pullback-to-21-EMA (MA/support-setup
recognition-quality adjudication). Lab-only -- does NOT touch production
`pattern_vision/chart_render.py`.

Deliberately NOT a copy of Hammer's single-candle harness or Bull Flag's
90/45-bar structural harness -- the semantic scale here is different again:
a human needs to see (a) enough PRIOR TREND to judge whether this is a
genuine Stage-2-style uptrend (not just a local crossing), (b) the 21-EMA's
own SLOPE over that longer window, and (c) a close, legible look at the
SPECIFIC bar(s) where price approaches/touches/reclaims the EMA, with volume,
since volume contraction is a hard gate for this detector.

  STRUCTURE view: last STRUCTURE_BARS (130) bars, with SMA50 + SMA200 (true
  SMAs, matching context.py's own MA-alignment/trend-stage definitions) PLUS
  a computed 21-EMA overlay (gold) -- shows the broader trend + the EMA's
  slope over time, without which "is this really Stage 2" is unanswerable.

  DETAIL view: last DETAIL_BARS (35) bars, with the 21-EMA overlay + volume --
  a close, legible look at the approach/touch/reclaim shape and the volume
  signature around it (the hard volume-contraction gate).

Both views are FIXED SIZE, identical for every case regardless of whether the
detector fired -- a per-case dynamic crop keyed to the detector's own
pullback/reclaim bar indices would leak the verdict. The trailing edge of
both charts is always `as_of_t`, so the region under evaluation is
unambiguous without an in-chart marker. The 21-EMA line itself is rendered
because it is the neutral indicator the whole setup is defined against (like
rendering a bull flag's own trendlines would be leaking; rendering "here is
the 21-day EMA" is the same category of neutral technical overlay as SMA50/
SMA200 -- it does not reveal pass/fail, touch location, or reclaim location).
"""
from __future__ import annotations

import datetime
import io
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from api.services.pattern_engine.detectors.uct.pullback_to_21ema import _EMA_PERIOD


STRUCTURE_BARS = 130
DETAIL_BARS = 35


def _to_dt(ts):
    s = str(int(ts))
    if len(s) == 8:
        return datetime.datetime(int(s[:4]), int(s[4:6]), int(s[6:8]))
    return datetime.datetime.fromtimestamp(int(ts))


def _ema_series(closes: list[float], period: int) -> list[float | None]:
    """Full-history EMA series (one value per input close), None until the
    seed window fills -- mirrors the detector's own `_ema` seed/recursion
    exactly so the rendered line matches what the detector actually reads."""
    out: list[float | None] = [None] * len(closes)
    if len(closes) < period:
        return out
    k = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    out[period - 1] = ema
    for i in range(period, len(closes)):
        ema = closes[i] * k + ema * (1.0 - k)
        out[i] = ema
    return out


def _render(bars_tuples, window) -> bytes:
    if not bars_tuples:
        return b""
    import matplotlib
    matplotlib.use("Agg")
    import pandas as pd
    import mplfinance as mpf

    all_closes = [row[4] for row in bars_tuples]
    ema_full = _ema_series(all_closes, _EMA_PERIOD)

    rows = bars_tuples[-window:]
    ema_window = ema_full[-window:]
    df = pd.DataFrame(
        [{"Date": _to_dt(t), "Open": o, "High": h, "Low": l, "Close": c, "Volume": v}
         for (t, o, h, l, c, v) in rows]
    ).set_index("Date")

    n = len(rows)
    mavs = tuple(p for p in (50, 200) if p <= n)
    addplots = []
    if any(v is not None for v in ema_window):
        ema_col = pd.Series(ema_window, index=df.index)
        addplots.append(mpf.make_addplot(ema_col, color="#c9a84c", width=1.6))

    kwargs = dict(
        type="candle", volume=True, style="charles", figratio=(16, 9), figscale=1.1,
        tight_layout=True, savefig=dict(fname=(buf := io.BytesIO()), dpi=110, format="png"),
    )
    if mavs:
        kwargs["mav"] = mavs
    if addplots:
        kwargs["addplot"] = addplots

    mpf.plot(df, **kwargs)
    buf.seek(0)
    return buf.read()


def render_structure(bars_tuples) -> bytes:
    return _render(bars_tuples, STRUCTURE_BARS)


def render_detail(bars_tuples) -> bytes:
    return _render(bars_tuples, DETAIL_BARS)
