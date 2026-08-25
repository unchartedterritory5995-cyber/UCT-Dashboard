"""Discord /chart renderer: candles + volume + SMA 10/20/50 on the brand palette.

Pure. Takes bars exactly as /api/bars serves them ({"t","o","h","l","c","v"};
daily/weekly `t` is "YYYY-MM-DD", intraday `t` is unix seconds) and returns PNG
bytes. No network, no env, no Discord. The palette is the Substack chart
engine's (morning-wire/substack/charts.py) copied as constants because that
repo is not present on Railway.
"""
from __future__ import annotations

import datetime as _dt
import io
import threading
from zoneinfo import ZoneInfo

import matplotlib
matplotlib.use("Agg")  # headless; must precede any pyplot import

BASE = "#191c17"
GOLD = "#c9a84c"
GREEN = "#3cb868"
RED = "#e74c3c"
CREAM = "#f0ead8"
GRID = "#2c3128"
MUTED = "#8a8f98"
_FONT = "DejaVu Sans"

# Visible bars per timeframe. The caller asks the bars authority for
# WINDOW[tf] + MA_LEAD so SMA50 is complete at the left edge; the lead-in is
# never drawn.
WINDOW = {"D": 120, "W": 104, "60": 100, "30": 130, "15": 130, "5": 156}
MA_LEAD = 50

# The one authority for timeframe wording. discord_interactions derives the
# slash-command choices from this; the chart title and the reply line use it.
TF_LABEL = {"D": "Daily", "W": "Weekly", "60": "60 min", "30": "30 min",
            "15": "15 min", "5": "5 min"}

# (period, colour): the Substack leader-chart MA colours, applied to 10/20/50.
_MAS = ((10, GOLD), (20, "#8a8f98"), (50, "#5a6b52"))
_ET = ZoneInfo("America/New_York")
_PLOT_LOCK = threading.Lock()   # matplotlib is not thread-safe; handlers run in a threadpool
_STYLE = None                   # lazy: building the style imports mplfinance


_DATE_TFS = ("D", "W", "M")
_RTH_OPEN = (9, 30)   # first regular-session bucket (inclusive)
_RTH_CLOSE = (16, 0)  # first after-hours bucket (exclusive)
_INTRADAY_REQUEST_MULT = 2.5  # extended-hours buckets are up to ~60% of a 5-min day


def to_datetime(t, tf: str | None = None) -> _dt.datetime:
    """Bar time → naive datetime. Accepts "YYYY-MM-DD", YYYYMMDD, unix s, unix ms.

    Intraday unix times become ET wall-clock. For a DATE timeframe (D/W/M) a
    unix time is a UTC-midnight date key (the index path serves SPX/^GSPC that
    way): take the UTC date, or 2026-08-25 would render as 08-24 20:00 ET."""
    s = str(t).strip()
    if "-" in s and len(s) >= 10:
        return _dt.datetime(int(s[:4]), int(s[5:7]), int(s[8:10]))
    n = int(float(s))
    if len(s) == 8 and 19000101 <= n <= 21001231:
        return _dt.datetime(n // 10000, (n // 100) % 100, n % 100)
    if n > 10_000_000_000:  # milliseconds
        n //= 1000
    if tf in _DATE_TFS:
        d = _dt.datetime.fromtimestamp(n, tz=_dt.timezone.utc)
        return _dt.datetime(d.year, d.month, d.day)
    return _dt.datetime.fromtimestamp(n, tz=_ET).replace(tzinfo=None)


def bars_to_request(tf: str) -> int:
    """How many bars to ask the bars authority for: the visible window plus the
    SMA50 lead-in, scaled up for intraday because the RTH filter drops the
    pre/post-market buckets the authority serves alongside the session."""
    if tf not in WINDOW:
        raise ValueError(f"unsupported tf {tf!r}")
    base = WINDOW[tf] + MA_LEAD
    return base if tf in _DATE_TFS else int(base * _INTRADAY_REQUEST_MULT)


def build_frame(bars: list[dict], tf: str):
    """OHLCV frame with SMA10/20/50 computed on ALL input bars, then sliced to
    the last WINDOW[tf] rows. Raises ValueError on an unknown tf or < 3 bars."""
    if tf not in WINDOW:
        raise ValueError(f"unsupported tf {tf!r}")
    if not bars or len(bars) < 3:
        raise ValueError("not enough bars")
    import pandas as pd
    if tf not in _DATE_TFS:
        # Regular session only: a clean intraday chart is 09:30-16:00 ET. The
        # authority serves pre/post-market buckets too, which are thin, noisy,
        # and would eat most of a 130-bar window.
        def _rth(b):
            ts = to_datetime(b["t"], tf)
            return _RTH_OPEN <= (ts.hour, ts.minute) < _RTH_CLOSE
        bars = [b for b in bars if _rth(b)]
        if len(bars) < 3:
            raise ValueError("not enough regular-session bars")
    df = pd.DataFrame({
        "Date": [to_datetime(b["t"], tf) for b in bars],
        "Open": [float(b["o"]) for b in bars],
        "High": [float(b["h"]) for b in bars],
        "Low": [float(b["l"]) for b in bars],
        "Close": [float(b["c"]) for b in bars],
        "Volume": [float(b.get("v") or 0) for b in bars],
    }).set_index("Date")
    df = df[~df.index.duplicated(keep="last")].sort_index()
    for n, _ in _MAS:
        df[f"SMA{n}"] = df["Close"].rolling(n).mean()
    return df.tail(WINDOW[tf])


def _style():
    global _STYLE
    if _STYLE is None:
        import mplfinance as mpf
        mc = mpf.make_marketcolors(up=GREEN, down=RED, edge="inherit", wick="inherit",
                                   volume={"up": GREEN, "down": RED}, alpha=0.95)
        # Not a make_marketcolors kwarg on 0.12.10b0; the base style's blue
        # volume edge would otherwise outline every volume bar.
        mc["vcedge"] = {"up": GREEN, "down": RED}
        _STYLE = mpf.make_mpf_style(
            base_mpf_style="nightclouds", marketcolors=mc,
            facecolor=BASE, figcolor=BASE, edgecolor=GRID,
            gridcolor=GRID, gridstyle="--", gridaxis="both",
            rc={"axes.labelcolor": CREAM, "xtick.color": CREAM, "ytick.color": CREAM,
                "font.family": _FONT, "font.size": 10},
        )
    return _STYLE


def _stamp(as_of: _dt.datetime, tf: str) -> str:
    if tf in ("D", "W"):
        return as_of.strftime("%Y-%m-%d")
    return as_of.strftime("%Y-%m-%d %H:%M ET")


def render_chart_png(ticker: str, tf: str, bars: list[dict]) -> bytes:
    """Candles + volume + SMA 10/20/50, 16:9, ~1210x680 px. Raises ValueError
    for an unknown tf or fewer than 3 bars; any other exception propagates."""
    view = build_frame(bars, tf)
    import mplfinance as mpf
    import matplotlib.pyplot as plt

    last = float(view["Close"].iloc[-1])
    prev = float(view["Close"].iloc[-2])
    chg = f" ({(last / prev - 1) * 100:+.1f}%)" if prev > 0 else ""
    title = f"{ticker} · {TF_LABEL[tf]} · {last:,.2f}{chg}"
    footer = f"as of {_stamp(view.index[-1].to_pydatetime(), tf)} · uctintelligence.com"
    addplots = [mpf.make_addplot(view[f"SMA{n}"], color=c, width=1.0)
                for n, c in _MAS if view[f"SMA{n}"].notna().any()]
    kwargs = dict(type="candle", volume=True, style=_style(), figsize=(11, 6.2),
                  returnfig=True, xrotation=0,
                  datetime_format="%b %d" if tf == "D" else "%b %y" if tf == "W" else "%m-%d %H:%M")
    if addplots:
        kwargs["addplot"] = addplots

    buf = io.BytesIO()
    with _PLOT_LOCK:
        fig, axes = mpf.plot(view, **kwargs)
        try:
            axes[0].set_title(title, color=GOLD, fontsize=13, fontweight="bold",
                              loc="left", pad=12, fontfamily=_FONT)
            # Footer sits just under the volume pane's tick labels. Positioned
            # from that pane's real bbox: a fixed y=0.01 leaves a blank band,
            # and an off-axes annotation is dropped by the tight bbox.
            vol = axes[-1].get_position()
            fig.text(vol.x1, vol.y0 - 0.075, footer, color=MUTED, fontsize=8.5,
                     ha="right", va="top", fontfamily=_FONT)
            fig.savefig(buf, dpi=110, facecolor=BASE, bbox_inches="tight",
                        pad_inches=0.25, format="png")
        finally:
            plt.close(fig)
    return buf.getvalue()
