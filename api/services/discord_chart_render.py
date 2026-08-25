"""Discord /chart renderer: candles + volume + SMA 10/20/50 on the brand palette.

Pure. Takes bars exactly as /api/bars serves them ({"t","o","h","l","c","v"};
daily/weekly `t` is "YYYY-MM-DD", intraday `t` is unix seconds) and returns PNG
bytes. No network, no env, no Discord. The palette is the Substack chart
engine's (morning-wire/substack/charts.py) copied as constants because that
repo is not present on Railway.

v2 (2026-08-25): exact 1920x1080 canvas, header band with the MA legend and a
two-row stats strip computed from DAILY bars (price action + volume + ADR%),
right-side axes with a last-price tag, 50-period average-volume line.
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

# Exact output size. No bbox cropping on save, so the canvas is always this.
CANVAS = (1920, 1080)
DPI = 120
FIGSIZE = (CANVAS[0] / DPI, CANVAS[1] / DPI)

# Visible bars per timeframe. The caller asks the bars authority for
# WINDOW[tf] + MA_LEAD so SMA50 is complete at the left edge; the lead-in is
# never drawn.
WINDOW = {"D": 120, "W": 104, "60": 100, "30": 130, "15": 130, "5": 156}
MA_LEAD = 50
# Daily bars needed for the stats strip: 252 sessions for the 52-week range,
# plus the developing bar and a little slack.
STATS_DAILY_BARS = 260

# The one authority for timeframe wording. discord_interactions derives the
# slash-command choices from this; the chart title and the reply line use it.
TF_LABEL = {"D": "Daily", "W": "Weekly", "60": "60 min", "30": "30 min",
            "15": "15 min", "5": "5 min"}

# (period, colour): the Substack leader-chart MA colours, applied to 10/20/50.
# SMA50 is a step brighter than the Substack "#5a6b52" so its legend text
# reads on the dark base at 1080p.
_MAS = ((10, GOLD), (20, "#9aa0a8"), (50, "#7d9a70"))
_VOL_AVG = 50
_VOL_AVG_COLOR = "#d8d0b8"
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
    pre/post-market buckets the authority serves alongside the session. Daily
    also covers the stats strip's 52-week range so one fetch serves both."""
    if tf not in WINDOW:
        raise ValueError(f"unsupported tf {tf!r}")
    base = WINDOW[tf] + MA_LEAD
    if tf == "D":
        return max(base, STATS_DAILY_BARS)
    return base if tf in _DATE_TFS else int(base * _INTRADAY_REQUEST_MULT)


def build_frame(bars: list[dict], tf: str):
    """OHLCV frame with SMA10/20/50 and a 50-period volume average computed on
    ALL input bars, then sliced to the last WINDOW[tf] rows. Raises ValueError
    on an unknown tf or < 3 bars."""
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
    df["VolAvg"] = df["Volume"].rolling(_VOL_AVG).mean()
    return df.tail(WINDOW[tf])


# ── stats strip (always from DAILY bars) ─────────────────────────────────────

def fmt_num(v) -> str:
    """182400000 → 182.4M · 950000 → 950K · 12.5 → 12.5 · None → —"""
    if v is None:
        return "—"
    try:
        x = float(v)
    except (TypeError, ValueError):
        return "—"
    a = abs(x)
    if a >= 1e9:
        return f"{x / 1e9:.1f}B"
    if a >= 1e6:
        return f"{x / 1e6:.1f}M"
    if a >= 1e3:
        return f"{x / 1e3:.0f}K"
    return f"{x:,.2f}".rstrip("0").rstrip(".") if x != int(x) else f"{int(x):,}"


def fmt_pct(v) -> str:
    if v is None:
        return "—"
    return f"{float(v):+.1f}%"


def compute_stats(daily_bars: list[dict]) -> dict:
    """Price-action + volume facts off the daily series. Every derived value
    is None when the history is too short for it; the strip prints — there.
    Volume averages use the 50 COMPLETED bars before the last one (the last
    bar is usually today's developing session)."""
    if not daily_bars:
        return {}
    b = daily_bars
    last = b[-1]
    prev = b[-2] if len(b) >= 2 else None
    o, h, l, c, v = float(last["o"]), float(last["h"]), float(last["l"]), float(last["c"]), float(last.get("v") or 0)
    pc = float(prev["c"]) if prev else None
    tail = b[-252:]
    hi = max(float(x["h"]) for x in tail)
    lo = min(float(x["l"]) for x in tail)
    prior = b[-51:-1]
    avg50 = (sum(float(x.get("v") or 0) for x in prior) / 50) if len(prior) == 50 else None
    adr_bars = b[-20:]
    adr = (sum((float(x["h"]) / float(x["l"]) - 1) * 100 for x in adr_bars if float(x["l"]) > 0) / len(adr_bars)) if len(adr_bars) == 20 else None
    return {
        "open": o, "high": h, "low": l, "close": c,
        "day_pct": ((c / pc - 1) * 100) if pc else None,
        "gap_pct": ((o / pc - 1) * 100) if pc else None,
        "hi_52w": hi, "lo_52w": lo,
        "from_52w_high_pct": ((c / hi - 1) * 100) if hi else None,
        "volume": v,
        "avg_vol_50": avg50,
        "rvol": (v / avg50) if avg50 else None,
        "dollar_vol": v * c,
        "adr_pct": adr,
    }


# ── drawing ───────────────────────────────────────────────────────────────────

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
            base_mpf_style="nightclouds", marketcolors=mc, y_on_right=True,
            facecolor=BASE, figcolor=BASE, edgecolor=GRID,
            gridcolor=GRID, gridstyle="--", gridaxis="both",
            rc={"axes.labelcolor": CREAM, "xtick.color": CREAM, "ytick.color": CREAM,
                "font.family": _FONT, "font.size": 12, "axes.linewidth": 0.8},
        )
    return _STYLE


def _stamp(as_of: _dt.datetime, tf: str) -> str:
    if tf in ("D", "W"):
        return as_of.strftime("%Y-%m-%d")
    return as_of.strftime("%Y-%m-%d %H:%M ET")


def _row(fig, x: float, y: float, segments, size: float, gap_px: float = 14.0) -> None:
    """Draw inline text segments left-to-right from figure fraction (x, y),
    each with its own colour/weight; advances by the rendered width."""
    renderer = fig.canvas.get_renderer()
    fig_w = fig.bbox.width
    for text, color, weight in segments:
        if not text:
            continue
        t = fig.text(x, y, text, color=color, fontsize=size, fontweight=weight,
                     fontfamily=_FONT, ha="left", va="top")
        bb = t.get_window_extent(renderer=renderer)
        x += (bb.width + gap_px) / fig_w


def _dir_color(v) -> str:
    if v is None:
        return CREAM
    return GREEN if v >= 0 else RED


def _stats_rows(st: dict):
    """Two rows of (text, colour, weight) segments. Labels muted, values cream,
    signed percentages coloured by direction."""
    if not st:
        return [], []
    L, V, B = MUTED, CREAM, "normal"
    row1 = [
        ("O", L, B), (fmt_num(st["open"]), V, B),
        ("H", L, B), (fmt_num(st["high"]), V, B),
        ("L", L, B), (fmt_num(st["low"]), V, B),
        ("C", L, B), (fmt_num(st["close"]), V, "bold"),
        ("  Day", L, B), (fmt_pct(st["day_pct"]), _dir_color(st["day_pct"]), "bold"),
        ("  Gap", L, B), (fmt_pct(st["gap_pct"]), _dir_color(st["gap_pct"]), B),
        ("  52w High", L, B), (fmt_num(st["hi_52w"]), V, B),
        (f"({fmt_pct(st['from_52w_high_pct'])})", _dir_color(st["from_52w_high_pct"]), B),
        ("  52w Low", L, B), (fmt_num(st["lo_52w"]), V, B),
    ]
    row2 = [
        ("Vol", L, B), (fmt_num(st["volume"]), V, "bold"),
        ("  Avg(50)", L, B), (fmt_num(st["avg_vol_50"]), V, B),
        ("  RVOL", L, B), (f"{st['rvol']:.2f}x" if st["rvol"] is not None else "—",
                          GOLD if (st["rvol"] or 0) >= 1.5 else V, "bold"),
        ("  $Vol", L, B), (fmt_num(st["dollar_vol"]), V, B),
        ("  ADR", L, B), (f"{st['adr_pct']:.1f}%" if st["adr_pct"] is not None else "—", V, B),
    ]
    return row1, row2


def render_chart_png(ticker: str, tf: str, bars: list[dict], daily_bars: list[dict] | None = None,
                     show_mas: bool = True, show_volume: bool = True) -> bytes:
    """Exact 1920x1080 PNG: header (title, MA legend, stats strip) over a
    candle pane and a volume pane with right-side axes and a last-price tag.
    `daily_bars` feeds the stats strip; without it the strip is omitted.
    Raises ValueError for an unknown tf or fewer than 3 bars."""
    view = build_frame(bars, tf)
    import mplfinance as mpf
    import matplotlib.pyplot as plt

    last = float(view["Close"].iloc[-1])
    prev = float(view["Close"].iloc[-2])
    chg = (last / prev - 1) * 100 if prev > 0 else None
    up_bar = float(view["Close"].iloc[-1]) >= float(view["Open"].iloc[-1])
    tag_color = GREEN if up_bar else RED
    footer = f"as of {_stamp(view.index[-1].to_pydatetime(), tf)} · uctintelligence.com"
    stats = compute_stats(daily_bars) if daily_bars else {}
    row1, row2 = _stats_rows(stats)

    buf = io.BytesIO()
    with _PLOT_LOCK:
        fig = plt.figure(figsize=FIGSIZE, dpi=DPI, facecolor=BASE)
        try:
            # External-axes mode: the header band above the panes is ours.
            if show_volume:
                ax = fig.add_axes([0.035, 0.305, 0.905, 0.475])
                vax = fig.add_axes([0.035, 0.085, 0.905, 0.195], sharex=ax)
            else:
                ax = fig.add_axes([0.035, 0.085, 0.905, 0.695])
                vax = None
            addplots = [mpf.make_addplot(view[f"SMA{n}"], ax=ax, color=c, width=1.3)
                        for n, c in _MAS if show_mas and view[f"SMA{n}"].notna().any()]
            if vax is not None and view["VolAvg"].notna().any():
                addplots.append(mpf.make_addplot(view["VolAvg"], ax=vax, color=_VOL_AVG_COLOR, width=1.1, alpha=0.85))
            kwargs = dict(type="candle", ax=ax, volume=vax if vax is not None else False, style=_style(), xrotation=0,
                          datetime_format="%b %d" if tf == "D" else "%b %y" if tf == "W" else "%m-%d %H:%M",
                          update_width_config=dict(candle_linewidth=1.1, candle_width=0.72,
                                                   volume_width=0.72, volume_linewidth=0.6))
            if addplots:
                kwargs["addplot"] = addplots
            mpf.plot(view, **kwargs)

            # Last-price line + right-axis tag.
            ax.axhline(last, color=tag_color, ls="--", lw=0.9, alpha=0.9, zorder=3)
            ax.annotate(f"{last:,.2f}", xy=(1.0, last), xycoords=("axes fraction", "data"),
                        xytext=(5, 0), textcoords="offset points", ha="left", va="center",
                        fontsize=12, fontweight="bold", color=BASE, fontfamily=_FONT, zorder=6,
                        bbox=dict(boxstyle="round,pad=0.3", fc=tag_color, ec=tag_color),
                        annotation_clip=False)
            for a in (ax, vax):
                if a is None:
                    continue
                a.set_facecolor(BASE)
                a.tick_params(labelsize=12, colors=CREAM, length=3)
                a.set_ylabel("")
            if vax is not None:
                ax.tick_params(labelbottom=False)

            # Header band.
            _row(fig, 0.035, 0.975,
                 [(f"{ticker} · {TF_LABEL[tf]} · {last:,.2f}", GOLD, "bold"),
                  (fmt_pct(chg) if chg is not None else "", _dir_color(chg), "bold")], size=24, gap_px=16)
            legend = []
            for n, c in (_MAS if show_mas else ()):
                val = view[f"SMA{n}"].iloc[-1]
                if val == val:  # not NaN
                    legend += [(f"SMA{n}", c, "bold"), (f"{float(val):,.2f}", CREAM, "normal"), ("  ", CREAM, "normal")]
            va = view["VolAvg"].iloc[-1]
            if show_volume and va == va:
                legend += [("Avg Vol(50)", _VOL_AVG_COLOR, "bold"), (fmt_num(va), CREAM, "normal")]
            _row(fig, 0.035, 0.925, legend, size=13, gap_px=8)
            if row1:
                _row(fig, 0.035, 0.885, row1, size=13, gap_px=8)
                _row(fig, 0.035, 0.85, row2, size=13, gap_px=8)
            fig.text(0.94, 0.02, footer, color=MUTED, fontsize=10.5, ha="right", va="bottom", fontfamily=_FONT)
            fig.savefig(buf, dpi=DPI, facecolor=BASE, format="png")
        finally:
            plt.close(fig)
    return buf.getvalue()
