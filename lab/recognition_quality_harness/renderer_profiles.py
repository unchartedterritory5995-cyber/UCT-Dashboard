"""Generalized two-view chart renderer for recognition-quality corpora,
factored out of the three family-specific renderers that already proved
this pattern works (Hammer's render_v2.py: 16-bar morphology + 90-bar
context; Bull Flag's render_bf.py: 90/45-bar structural; Pullback-to-21EMA's
render_ma.py: 130/35-bar MA-context). The lesson those three cycles taught,
independently, is that render dimensions are FAMILY-SEMANTIC -- there is no
single correct crop size. This module keeps that lesson structural instead
of re-learning it by hand each time: a `RenderProfile` is a plain
dataclass of parameters: any new family picks the closest preset and
overrides only what's actually different, rather than writing a new
render_XXX.py from scratch.

Both views in every profile are FIXED SIZE and IDENTICAL for every case
regardless of whether the detector fired -- a per-case dynamic crop keyed to
the detector's own anchors leaks the verdict. This invariant is NOT
profile-configurable; it is load-bearing across all three prior cycles and
stays true here.
"""
from __future__ import annotations

import datetime
import io
from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class RenderProfile:
    name: str
    structure_bars: int
    detail_bars: int
    structure_smas: tuple[int, ...] = ()      # true SMAs rendered via mplfinance's own `mav`
    detail_smas: tuple[int, ...] = ()
    ema_overlay_period: Optional[int] = None  # if set, an EMA line (not an SMA) is computed and overlaid on BOTH views
    ema_overlay_color: str = "#c9a84c"
    show_volume_structure: bool = False
    show_volume_detail: bool = True
    detail_no_mas: bool = False               # Hammer-style: detail view intentionally omits ALL overlays (pure morphology)


# --- Presets, one per family class proven so far -----------------------

CANDLE_MORPHOLOGY = RenderProfile(
    name="CANDLE_MORPHOLOGY",
    structure_bars=90, detail_bars=16,
    structure_smas=(10, 20, 50),
    detail_smas=(), detail_no_mas=True,   # wide per-candle pixels, no line clutter -- wick/body ratio is the whole question
    show_volume_structure=False, show_volume_detail=False,
)

STRUCTURAL = RenderProfile(
    name="STRUCTURAL",
    structure_bars=90, detail_bars=45,
    structure_smas=(10, 20, 50),
    detail_smas=(10, 20, 50),
    show_volume_structure=False, show_volume_detail=True,
)

MA_CONTEXT = RenderProfile(
    name="MA_CONTEXT",
    structure_bars=130, detail_bars=35,
    structure_smas=(50, 200),
    detail_smas=(),
    ema_overlay_period=21,
    show_volume_structure=False, show_volume_detail=True,
)

EVENT_DRIVEN = RenderProfile(
    name="EVENT_DRIVEN",
    # Event/gap setups (earnings gaps, episodic pivots) need a LONGER prior
    # base for context (was there a real base before the gap?) and a
    # shorter, volume-forward detail view around the event itself.
    structure_bars=150, detail_bars=25,
    structure_smas=(50, 200),
    detail_smas=(10,),
    show_volume_structure=True, show_volume_detail=True,
)

PROFILES = {
    "CANDLE_MORPHOLOGY": CANDLE_MORPHOLOGY,
    "STRUCTURAL": STRUCTURAL,
    "MA_CONTEXT": MA_CONTEXT,
    "EVENT_DRIVEN": EVENT_DRIVEN,
}


def _to_dt(ts):
    s = str(int(ts))
    if len(s) == 8:
        return datetime.datetime(int(s[:4]), int(s[4:6]), int(s[6:8]))
    return datetime.datetime.fromtimestamp(int(ts))


def _ema_series(closes: list[float], period: int) -> list[Optional[float]]:
    """Full-history EMA series, seeded the same way every detector in this
    codebase seeds its own EMA (SMA seed then standard recursion), so a
    rendered overlay always matches what the detector actually reads."""
    out: list[Optional[float]] = [None] * len(closes)
    if len(closes) < period:
        return out
    k = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    out[period - 1] = ema
    for i in range(period, len(closes)):
        ema = closes[i] * k + ema * (1.0 - k)
        out[i] = ema
    return out


def _render(bars_tuples, window: int, smas: tuple[int, ...], show_volume: bool,
            ema_period: Optional[int], ema_color: str, no_mas: bool) -> bytes:
    if not bars_tuples:
        return b""
    import matplotlib
    matplotlib.use("Agg")
    import pandas as pd
    import mplfinance as mpf

    rows = bars_tuples[-window:]
    df = pd.DataFrame(
        [{"Date": _to_dt(t), "Open": o, "High": h, "Low": l, "Close": c, "Volume": v}
         for (t, o, h, l, c, v) in rows]
    ).set_index("Date")

    n = len(rows)
    kwargs = dict(
        type="candle", volume=show_volume, style="charles", figratio=(16, 9), figscale=1.1,
        tight_layout=True, savefig=dict(fname=(buf := io.BytesIO()), dpi=110, format="png"),
    )
    if not no_mas:
        mavs = tuple(p for p in smas if p <= n)
        if mavs:
            kwargs["mav"] = mavs

    if ema_period is not None:
        all_closes = [row[4] for row in bars_tuples]
        ema_full = _ema_series(all_closes, ema_period)
        ema_window = ema_full[-window:]
        if any(v is not None for v in ema_window):
            kwargs["addplot"] = [mpf.make_addplot(pd.Series(ema_window, index=df.index),
                                                    color=ema_color, width=1.6)]

    mpf.plot(df, **kwargs)
    buf.seek(0)
    return buf.read()


def render_structure(bars_tuples, profile: RenderProfile) -> bytes:
    return _render(bars_tuples, profile.structure_bars, profile.structure_smas,
                    profile.show_volume_structure, profile.ema_overlay_period,
                    profile.ema_overlay_color, no_mas=False)


def render_detail(bars_tuples, profile: RenderProfile) -> bytes:
    return _render(bars_tuples, profile.detail_bars, profile.detail_smas,
                    profile.show_volume_detail, profile.ema_overlay_period,
                    profile.ema_overlay_color, no_mas=profile.detail_no_mas)
