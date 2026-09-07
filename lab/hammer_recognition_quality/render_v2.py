"""Two-view chart renderer for candlestick (single-bar) recognition-quality
adjudication. Lab-only -- does NOT touch api/services/pattern_vision/chart_render.py
(production code used elsewhere); this is a separate, isolated rendering
path built specifically to fix the resolution ceiling discovered in Hammer
Corpus B (160 bars/image, ~7px/candle -- too coarse to judge wick/body
ratios reliably; see corpus_b/UNBLINDED_RESULTS.md).

Two views per case, both marking the SAME candidate bar (always the last
bar in the window, by construction) with an identical, neutral, non-
directional marker -- a thin gray dashed vertical line through both the
price and volume panes. The marker never encodes pass/fail, direction, or
any detector-derived signal; it only says "this bar is the one being
judged," removing any need to guess among ~160 candles.

  MORPHOLOGY view: last `MORPH_BARS` bars only (default 16) -- wide
  per-candle rendering so body/wick proportions are actually legible.
  No moving averages (meaningless over a 16-bar window; would also clutter
  a chart this tight for no benefit to an anatomy judgment).

  CONTEXT view: last `CONTEXT_BARS` bars (default 90) -- same style as the
  original corpus renderer (10/20/50 MAs, volume), for judging trend/
  swing-low/support location. Deliberately narrower than the original
  160-bar frame too (90, not 160) for a modest resolution bump on this
  view as well, without losing the "wide picture" this view exists for.
"""
from __future__ import annotations

import datetime
import io


MORPH_BARS = 16
CONTEXT_BARS = 90


def _to_dt(ts):
    s = str(int(ts))
    if len(s) == 8:
        return datetime.datetime(int(s[:4]), int(s[4:6]), int(s[6:8]))
    return datetime.datetime.fromtimestamp(int(ts))


def _render(bars_tuples, window, show_mav, marker_at_last=True) -> bytes:
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

    kwargs = dict(
        type="candle", volume=True, style="charles", figratio=(16, 9), figscale=1.1,
        tight_layout=True, savefig=dict(fname=(buf := io.BytesIO()), dpi=110, format="png"),
    )
    if show_mav:
        # Only include MAs the window can actually support (a 16-bar morph
        # view can't compute a 50-period MA; silently including a MA mpf
        # can't compute would either error or draw nothing useful).
        n = len(rows)
        mavs = tuple(p for p in (10, 20, 50) if p <= n)
        if mavs:
            kwargs["mav"] = mavs

    if marker_at_last:
        # Neutral candidate marker: a plain gray dashed vertical line at the
        # LAST bar's timestamp, identical on every case regardless of the
        # true label -- never colored/styled by pass-fail or direction.
        last_dt = df.index[-1]
        kwargs["vlines"] = dict(
            vlines=[last_dt], colors=["#888888"], linestyle="--", linewidths=1.0,
            alpha=0.6,
        )

    mpf.plot(df, **kwargs)
    buf.seek(0)
    return buf.read()


def render_morphology(bars_tuples) -> bytes:
    """Tight, high-per-candle-resolution crop -- last MORPH_BARS bars, no MAs."""
    return _render(bars_tuples, MORPH_BARS, show_mav=False)


def render_context(bars_tuples) -> bytes:
    """Wider trend/location view -- last CONTEXT_BARS bars, with MAs."""
    return _render(bars_tuples, CONTEXT_BARS, show_mav=True)
