"""The breadth row's NON-price-metric keys, produced on the SERVER — the rest of the PC
collector's push.

⭐ WHY (2026-10-10, owner): "find a solution so that we do not have to rely on my PC". The
EOD server row (`breadth_eod_source`) owns the price metrics; the collector still supplied
everything below. Each key reproduces the collector's (uct-intelligence
`scripts/breadth_collector.py`, origin/master 2026-10-10) definition, from a source the web
pod already has:

  sp500_close                       yfinance ^GSPC (the collector's own source)
  rsp_close, iwm_close,             bars.db daily closes (RSP, IWM, SPY, QQQ)
  rsp_spy_ratio, iwm_qqq_ratio
  vix, vxn, avg_10d_vix,            Cboe's own daily CSVs (`market_indicators.cboe_store`;
  avg_10d_vxn, vxmt,                `vxmt` is the 6-month tenor, VIX6M — the collector moved
  vix_term_structure                 to Cboe for it when yfinance stopped carrying it)
  cnn_fear_greed                    CNN's graph-data endpoint (the collector's own source)
  spy_dist_days, qqq_dist_days      the Morning Wire's `_count_dist`, ported verbatim, over
                                    bars.db SPY/QQQ through the PRIOR session (the wire
                                    computes it the morning of the session)
  uct_exposure, market_phase        the Morning Wire push for that session (`wire_data`)
  new_ath                           closes at/above their all-time high (bars.db full
                                    history), the collector's 0.999 tolerance
  atr_ext_7                         names > 7 ATR(14) above their 50-day SMA (Jeff Sun)

Not here: AAII and NAAIM (their own module), `cboe_putcall` (already filled on the web pod by
`breadth_putcall_backfill`).

⛔ EVERY KEY IS INDEPENDENT. A source that fails yields no key — never a zero and never a
neighbouring session's value — and the others are still produced. `compute_extras` never
raises.
"""
from __future__ import annotations

import logging
import math
import time
from datetime import date, datetime, timezone
from typing import Optional

import numpy as np

_log = logging.getLogger("breadth_eod_extras")

#: Per-key parity tolerance against the collector's value (`abs`, optional `rel`).
#: Strings (`market_phase`) are graded by equality.
TOLERANCE = {
    "sp500_close": {"abs": 0.5},
    "rsp_close": {"abs": 0.02}, "iwm_close": {"abs": 0.02},
    "rsp_spy_ratio": {"abs": 0.0005}, "iwm_qqq_ratio": {"abs": 0.0005},
    "vix": {"abs": 0.05}, "vxn": {"abs": 0.05}, "vxmt": {"abs": 0.05},
    "avg_10d_vix": {"abs": 0.05}, "avg_10d_vxn": {"abs": 0.05},
    "vix_term_structure": {"abs": 0.005},
    "cnn_fear_greed": {"abs": 2.0},
    "spy_dist_days": {"abs": 0}, "qqq_dist_days": {"abs": 0},
    "uct_exposure": {"abs": 0.1}, "market_phase": {"abs": 0},
    "new_ath": {"abs": 3, "rel": 0.10},
    "atr_ext_7": {"abs": 2, "rel": 0.15},
}
KEYS = tuple(TOLERANCE)

ATR_EXT_THRESH = 7.0
ATR_N = 14
SMA_N = 50
ATH_TOL = 0.999


def _f(v) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


# ── bars.db ──────────────────────────────────────────────────────────────────

def _sessions_through(conn, ts: int, n: int) -> list[int]:
    rows = conn.execute("SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts <= ? "
                        "ORDER BY ts DESC LIMIT ?", (ts, n)).fetchall()
    return sorted(int(r[0]) for r in rows)


def _ohlcv_series(conn, ticker: str, start: int, end: int) -> list[tuple]:
    return conn.execute("SELECT ts, o, h, l, c, v FROM ohlcv WHERE tf='D' AND ticker=? "
                        "AND ts BETWEEN ? AND ? ORDER BY ts", (ticker, start, end)).fetchall()


def _close_on(conn, ticker: str, ts: int) -> Optional[float]:
    row = conn.execute("SELECT c FROM ohlcv WHERE tf='D' AND ticker=? AND ts=?",
                       (ticker, ts)).fetchone()
    return _f(row[0]) if row else None


def index_closes(conn, ts: int) -> dict:
    """RSP/IWM closes and the two leadership ratios (collector rounding)."""
    out = {}
    px = {s: _close_on(conn, s, ts) for s in ("RSP", "IWM", "SPY", "QQQ")}
    if px["RSP"]:
        out["rsp_close"] = round(px["RSP"], 2)
        if px["SPY"]:
            out["rsp_spy_ratio"] = round(px["RSP"] / round(px["SPY"], 2), 4)
    if px["IWM"]:
        out["iwm_close"] = round(px["IWM"], 2)
        if px["QQQ"]:
            out["iwm_qqq_ratio"] = round(px["IWM"] / round(px["QQQ"], 2), 4)
    return out


def _hlc(conn, tickers: list, dates: list[int]):
    pos = {t: i for i, t in enumerate(dates)}
    tix = {t: i for i, t in enumerate(tickers)}
    shape = (len(tickers), len(dates))
    H, L, C = (np.full(shape, np.nan) for _ in range(3))
    for i in range(0, len(tickers), 800):
        chunk = tickers[i:i + 800]
        qm = ",".join("?" * len(chunk))
        for tk, ts, h, lo, c in conn.execute(
                f"SELECT ticker, ts, h, l, c FROM ohlcv WHERE tf='D' AND ts BETWEEN ? AND ? "
                f"AND ticker IN ({qm})", [dates[0], dates[-1], *chunk]).fetchall():
            r, j = tix.get(tk), pos.get(int(ts))
            if r is None or j is None:
                continue
            H[r, j], L[r, j], C[r, j] = (np.nan if v is None else v for v in (h, lo, c))
    return H, L, C


def atr_extended(conn, tickers: list, ts: int, thresh: float = ATR_EXT_THRESH) -> Optional[int]:
    """`count_atr_extended(_sma50_atr_map(...), 7)`: names whose close sits MORE than
    `thresh` ATR(14) above the 50-day SMA. ATR is the collector's: a simple 14-bar mean
    of the true range, rounded to a 0.1% of close, then the distance rounded to 0.1."""
    dates = _sessions_through(conn, ts, SMA_N + 5)
    if len(dates) < SMA_N or dates[-1] != ts:
        return None
    H, L, C = _hlc(conn, tickers, dates)
    pc = np.concatenate([np.full((C.shape[0], 1), np.nan), C[:, :-1]], axis=1)
    with np.errstate(invalid="ignore"):
        tr = np.fmax(np.fmax(H - L, np.abs(H - pc)), np.abs(L - pc))
    tr14 = tr[:, -ATR_N:]
    c = C[:, -1]
    sma = C[:, -SMA_N:]
    ok = (~np.isnan(tr14).any(axis=1)) & (~np.isnan(sma).any(axis=1)) & (c > 0)
    n = 0
    for i in np.nonzero(ok)[0]:
        atr = float(tr14[i].mean())
        if atr <= 0:
            continue
        atr_pct = round(atr / c[i] * 100, 1)
        if atr_pct <= 0:
            continue
        a50 = round((c[i] - float(sma[i].mean())) / (atr_pct / 100.0 * c[i]), 1)
        if a50 > thresh:
            n += 1
    return n


def new_ath(conn, tickers: list, ts: int) -> Optional[int]:
    """`count_at_ath`: names closing at/above 0.999x their all-time high close (the
    session itself included in the high, as the collector's full-history download is)."""
    today = {}
    prior_max = {}
    for i in range(0, len(tickers), 800):
        chunk = tickers[i:i + 800]
        qm = ",".join("?" * len(chunk))
        for tk, c in conn.execute(f"SELECT ticker, c FROM ohlcv WHERE tf='D' AND ts=? "
                                  f"AND ticker IN ({qm})", [ts, *chunk]).fetchall():
            if _f(c) and c > 0:
                today[tk] = float(c)
        for tk, m in conn.execute(f"SELECT ticker, MAX(c) FROM ohlcv WHERE tf='D' AND ts<? "
                                  f"AND ticker IN ({qm}) GROUP BY ticker", [ts, *chunk]).fetchall():
            if _f(m):
                prior_max[tk] = float(m)
    if not today:
        return None
    n = 0
    for tk, c in today.items():
        ref = max(c, prior_max.get(tk, c))
        if c >= ref * ATH_TOL:
            n += 1
    return n


def _count_dist(closes: list, volumes: list, highs: list, lows: list) -> int:
    """The Morning Wire's `_count_dist`, ported: non-expired distribution + stalling days
    over the last 26 sessions — down >= 0.2% on volume above the 50-day average, or an
    up/flat close in the lowest quarter of the bar's range on above-average volume; a day
    expires once the index has rallied 5% off its close."""
    prices = closes
    if not prices:
        return 0
    current = prices[-1]
    n = 0
    for i in range(1, len(prices)):
        if len(prices) - 1 - i > 25:
            continue
        avg50 = sum(volumes[max(0, i - 50):i]) / min(50, max(1, i))
        above = (volumes[i] > avg50) if avg50 > 0 else False
        pct = (prices[i] / prices[i - 1] - 1) * 100
        if (current / prices[i] - 1) * 100 >= 5.0:
            continue
        if pct <= -0.2 and above:
            n += 1
        elif pct >= 0 and above:
            rng = highs[i] - lows[i]
            if rng > 0 and (prices[i] - lows[i]) / rng <= 0.25:
                n += 1
    return n


def dist_days(conn, ts: int) -> dict:
    """SPY/QQQ distribution days as the Morning Wire counted them the morning of `ts`
    (bars through the PRIOR session)."""
    dates = _sessions_through(conn, ts, 120)
    if len(dates) < 60 or dates[-1] != ts:
        return {}
    prior = dates[-2]
    out = {}
    for sym, key in (("SPY", "spy_dist_days"), ("QQQ", "qqq_dist_days")):
        rows = [r for r in _ohlcv_series(conn, sym, dates[0], prior)
                if r[4] is not None]
        if len(rows) < 55:
            continue
        c = [float(r[4]) for r in rows]
        v = [float(r[5] or 0) for r in rows]
        h = [float(r[2]) if r[2] is not None else c[i] for i, r in enumerate(rows)]
        lo = [float(r[3]) if r[3] is not None else c[i] for i, r in enumerate(rows)]
        out[key] = _count_dist(c, v, h, lo)
    return out


# ── external sources ─────────────────────────────────────────────────────────

def sp500_close(date_iso: str) -> Optional[float]:
    from api.services import yf_util

    def _get():
        import yfinance as yf
        df = yf.download("^GSPC", period="1mo", auto_adjust=True, progress=False)
        if df is None or df.empty:
            return None
        cl = df["Close"]
        if hasattr(cl, "columns"):
            cl = cl.iloc[:, 0]
        cl = cl.dropna()
        hit = [v for d, v in cl.items() if str(d)[:10] == date_iso]
        return round(float(hit[-1]), 2) if hit else None

    return yf_util.bounded_call(_get, None, timeout=20.0)


def cboe_levels(date_iso: str, refresh: bool = True) -> dict:
    """vix/vxn/vxmt (VIX6M), their 10-day means, and the term structure — Cboe's own
    daily closes. Refreshes the three symbols once when the session is not stored yet."""
    from api.services.market_indicators import cboe_store as cs

    def read(sym):
        return [b for b in cs.bars(sym) if b["t"] <= date_iso and _f(b["c"])]

    syms = ("VIX", "VXN", "VIX6M")
    series = {s: read(s) for s in syms}
    if refresh and any(not s or s[-1]["t"] != date_iso for s in series.values()):
        try:
            cs.refresh(list(syms), timeout=30)
        except Exception as e:                     # noqa: BLE001
            _log.warning("[eod-extras] cboe refresh failed: %s", e)
        series = {s: read(s) for s in syms}
    out = {}
    for sym, key in (("VIX", "vix"), ("VXN", "vxn"), ("VIX6M", "vxmt")):
        s = series[sym]
        if not s or s[-1]["t"] != date_iso:
            continue
        out[key] = round(float(s[-1]["c"]), 2)
        if key in ("vix", "vxn") and len(s) >= 10:
            out[f"avg_10d_{key}"] = round(sum(float(b["c"]) for b in s[-10:]) / 10, 2)
    if out.get("vxmt") and out.get("vix"):
        out["vix_term_structure"] = round(out["vxmt"] / out["vix"], 3)
    return out


_CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata/{d}"
_CNN_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://edition.cnn.com/markets/fear-and-greed",
    "Origin": "https://edition.cnn.com",
}


def cnn_fear_greed(date_iso: str, get=None) -> Optional[float]:
    """CNN Fear & Greed for exactly `date_iso`: the historical point dated that day, or
    the live score when that day is today (ET) and the history has no point yet."""
    try:
        if get is None:
            import requests
            get = requests.get
        r = get(_CNN_URL.format(d=date_iso), timeout=12, headers=_CNN_HEADERS)
        if getattr(r, "status_code", 0) != 200:
            return None
        d = r.json() or {}
    except Exception:
        return None
    for p in ((d.get("fear_and_greed_historical") or {}).get("data") or []):
        try:
            day = datetime.fromtimestamp(float(p["x"]) / 1000, timezone.utc).date().isoformat()
        except Exception:
            continue
        if day == date_iso:
            v = _f(p.get("y"))
            return round(v, 1) if v is not None else None
    fg = d.get("fear_and_greed") or {}
    ts = str(fg.get("timestamp") or "")[:10]
    v = _f(fg.get("score"))
    if v is not None and ts == date_iso:
        return round(v, 1)
    return None


def wire_regime(date_iso: str) -> dict:
    """`uct_exposure` and `market_phase` from that session's Morning Wire push. Only
    the wire OF THAT DATE answers — a different day's wire is never stamped on."""
    try:
        from api.services import engine
        wd = engine._load_wire_data() or {}
    except Exception:
        return {}
    if str(wd.get("date") or "")[:10] != date_iso:
        return {}
    out = {}
    score = _f((wd.get("exposure") or {}).get("score"))
    if score is not None:
        out["uct_exposure"] = round(score, 1)
    phase = (wd.get("breadth") or {}).get("market_phase")
    if isinstance(phase, str) and phase.strip():
        out["market_phase"] = phase.strip()
    return out


# ── the row ──────────────────────────────────────────────────────────────────

_SESSION_CACHE: dict = {}
_SESSION_TTL = 2 * 3600

def compute_extras(date_iso: str, tickers: list, conn=None) -> dict:
    """Every key this module can produce for the session. Never raises; a key whose
    source failed is absent. `_extras_errors` names each failure."""
    from api.services import breadth_live as bl
    out: dict = {}
    errors: dict = {}
    t0 = time.time()
    try:
        conn = conn or bl._bars_conn()
        ts = bl._ts_int(date.fromisoformat(date_iso))
    except Exception as e:                         # noqa: BLE001
        return {"_extras_errors": {"setup": f"{type(e).__name__}: {e}"}}
    # the universe-dependent pair, every call
    steps = [
        ("atr_ext_7", lambda: {"atr_ext_7": atr_extended(conn, tickers, ts)}),
        ("new_ath", lambda: {"new_ath": new_ath(conn, tickers, ts)}),
    ]
    # the session-wide keys (network: Cboe, yfinance, CNN), once per session per window
    hit = _SESSION_CACHE.get(date_iso)
    if hit and time.time() - hit[0] < _SESSION_TTL:
        out.update(hit[1])
    else:
        session_steps = (
            ("index_closes", lambda: index_closes(conn, ts)),
            ("dist_days", lambda: dist_days(conn, ts)),
            ("cboe", lambda: cboe_levels(date_iso)),
            ("sp500_close", lambda: {"sp500_close": sp500_close(date_iso)}),
            ("cnn_fear_greed", lambda: {"cnn_fear_greed": cnn_fear_greed(date_iso)}),
            ("wire", lambda: wire_regime(date_iso)),
        )
        got: dict = {}
        for name, fn in session_steps:
            try:
                for k, v in (fn() or {}).items():
                    if v is not None:
                        got[k] = v
            except Exception as e:                 # noqa: BLE001
                errors[name] = f"{type(e).__name__}: {e}"
        if not errors:                             # a partial answer is retried next time
            _SESSION_CACHE[date_iso] = (time.time(), dict(got))
            for d in sorted(_SESSION_CACHE)[:-20]:
                _SESSION_CACHE.pop(d, None)
        out.update(got)
    for name, fn in steps:
        try:
            for k, v in (fn() or {}).items():
                if v is not None:
                    out[k] = v
        except Exception as e:                     # noqa: BLE001 - one source never costs the rest
            errors[name] = f"{type(e).__name__}: {e}"
    if errors:
        out["_extras_errors"] = errors
    out["_extras_seconds"] = round(time.time() - t0, 2)
    return out


def grade(key: str, server, stored) -> Optional[dict]:
    """`breadth_live.grade`'s shape for an extras key, under `TOLERANCE`."""
    if server is None or stored is None:
        return None
    if isinstance(server, str) or isinstance(stored, str):
        ok = str(server).strip().lower() == str(stored).strip().lower()
        return {"value": server, "delta": 0.0 if ok else None, "rel_pct": 0.0 if ok else None,
                "pass": ok}
    try:
        delta = float(server) - float(stored)
    except (TypeError, ValueError):
        return None
    rel = abs(delta) / abs(float(stored)) if stored else (0.0 if not delta else float("inf"))
    tol = TOLERANCE.get(key, {"abs": 0})
    ok = abs(delta) <= tol.get("abs", 0) or ("rel" in tol and rel <= tol["rel"])
    return {"value": server, "delta": round(delta, 4), "rel_pct": round(rel * 100, 2), "pass": ok}
