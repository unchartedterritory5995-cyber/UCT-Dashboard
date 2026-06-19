"""Server-side chart rendering for the vision judge (mplfinance, headless).

Produces a clean candlestick+volume PNG with 10/20/50 MAs from local daily bars,
framed to the last `window` bars. No title/label that would leak the setup name.
"""
import datetime
import io


def _to_dt(ts):
    s = str(int(ts))
    if len(s) == 8:  # YYYYMMDD (daily/weekly)
        return datetime.datetime(int(s[:4]), int(s[4:6]), int(s[6:8]))
    return datetime.datetime.fromtimestamp(int(ts))  # intraday unix seconds


def render_chart(bars, *, window=120, key_level=None) -> bytes:
    if not bars:
        return b""
    import matplotlib
    matplotlib.use("Agg")  # headless backend
    import pandas as pd
    import mplfinance as mpf

    rows = bars[-window:]
    df = pd.DataFrame(
        [{"Date": _to_dt(t), "Open": o, "High": h, "Low": l, "Close": c, "Volume": v}
         for (t, o, h, l, c, v) in rows]
    ).set_index("Date")

    kwargs = dict(
        type="candle", volume=True, mav=(10, 20, 50),
        style="charles", figratio=(16, 9), figscale=1.1,
        tight_layout=True, savefig=dict(fname=(buf := io.BytesIO()), dpi=110, format="png"),
    )
    # Draw the claimed trigger level as a dashed gold line, if sane vs the window.
    try:
        kl = float(key_level) if key_level is not None else None
    except (TypeError, ValueError):
        kl = None
    if kl is not None and kl > 0:
        lo = min(r[3] for r in rows)
        hi = max(r[2] for r in rows)
        if lo * 0.5 <= kl <= hi * 1.5:  # ignore wildly out-of-frame levels
            kwargs["hlines"] = dict(hlines=[kl], colors=["#c9a84c"],
                                    linestyle="--", linewidths=1.1)
    mpf.plot(df, **kwargs)
    buf.seek(0)
    return buf.read()
