"""Two-view chart renderer for Bull Flag (multi-bar structural pattern)
recognition-quality adjudication. Lab-only -- does NOT touch production
`pattern_vision/chart_render.py`.

Deliberately NOT a copy of Hammer's single-candle harness (render_v2.py in
the sibling hammer-recognition-quality-lab worktree/branch) -- semantic
scale differs: a structural pattern needs enough history to see the prior
impulse and the full flag, not a handful of candles.

  STRUCTURE view: last STRUCTURE_BARS (90) bars, with 10/20/50 MAs -- shows
  the pole's origin (was there a real base before the impulse?), the whole
  flag, and general trend/location context.

  DETAIL view: last DETAIL_BARS (45) bars, with MAs + volume -- a closer
  look at the pole shape, the flag's channel/depth/slope, and (critically,
  since it's a hard gate) the visual volume contraction from pole to flag.

Both views are FIXED SIZE, identical for every case regardless of whether
the detector fired -- unlike a per-case dynamic crop keyed to the detector's
own extracted pole/flag anchors, which would leak the verdict (a
precision-fitted crop implies "the detector found something here"). The
trailing edge of both charts is always `as_of_t`, so the region under
evaluation is unambiguous without needing an in-chart marker.
"""
from __future__ import annotations

import datetime
import io


STRUCTURE_BARS = 90
DETAIL_BARS = 45


def _to_dt(ts):
    s = str(int(ts))
    if len(s) == 8:
        return datetime.datetime(int(s[:4]), int(s[4:6]), int(s[6:8]))
    return datetime.datetime.fromtimestamp(int(ts))


def _render(bars_tuples, window) -> bytes:
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
    mavs = tuple(p for p in (10, 20, 50) if p <= n)
    kwargs = dict(
        type="candle", volume=True, style="charles", figratio=(16, 9), figscale=1.1,
        tight_layout=True, savefig=dict(fname=(buf := io.BytesIO()), dpi=110, format="png"),
    )
    if mavs:
        kwargs["mav"] = mavs

    mpf.plot(df, **kwargs)
    buf.seek(0)
    return buf.read()


def render_structure(bars_tuples) -> bytes:
    return _render(bars_tuples, STRUCTURE_BARS)


def render_detail(bars_tuples) -> bytes:
    return _render(bars_tuples, DETAIL_BARS)
