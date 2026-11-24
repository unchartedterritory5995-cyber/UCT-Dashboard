"""The rebuild's engine for Up Vol / HVC / >7xATR, runnable on the web pod (2026-11-23).

`tools/breadth/uct_pit/compute.py` (which built the 2008+ series) measured each session over the
provider's grouped day files: raw OHLCV for every traded ticker, split-adjusted in memory,
dividend-adjusted closes for the levels, then `breadth_history_recon.recompute_from_frame`
(production's `compute_metrics`) and `atr_ext` (`breadth_eod_extras.atr_extended`, line for line).

The forward job (`breadth_universe_extras_forward`) must continue that series ON THE SAME BASIS.
Measured 2026-11-23 on six overlap sessions: this engine with the authority's own member list
reproduces the series exactly on US (0 difference on all three keys); bars.db through
`breadth_eod_source.compute` does not (>7xATR +5 names a day, Up Vol up to 21%), so the forward
job uses this engine and never bars.db.

Only the inputs differ from compute.py, and only in where they come from:
  • grouped day files → fetched from the provider here and cached under `CACHE_DIR`
  • splits            → the provider's reference splits (same fields compute.py read)
  • dividends         → `breadth_dividends` (same convention: ratio 1 − cash / prior close on every
                        close before the ex-session)
"""
from __future__ import annotations

import bisect
import gzip
import json
import os
import time
import urllib.request
from collections import defaultdict
from typing import Callable, Optional

import numpy as np

_DATA = os.environ.get("DATA_DIR", "/data")
CACHE_DIR = os.path.join(_DATA, "breadth_uex_forward")
BASE = "https://api.massive.com"
#: sessions loaded before the first target: recompute_from_frame's 320-session window + margin
LOOKBACK = 330
#: grouped day files kept in the cache (older ones are pruned)
KEEP_DAYS = 420
SPLITS_MAX_AGE = 20 * 3600


def norm(t: str) -> str:
    return t.replace("-", ".").replace("/", ".").upper()


def _key() -> Optional[str]:
    return os.environ.get("MASSIVE_API_KEY") or os.environ.get("MASSIVE_SECRET_KEY")


def _get(url: str, tries: int = 5) -> dict:
    key = _key()
    if not key:
        raise RuntimeError("no MASSIVE api key")
    sep = "&" if "?" in url else "?"
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(f"{url}{sep}apiKey={key}", headers={"User-Agent": "uct-breadth/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 ** i)
    raise RuntimeError(f"provider request failed: {type(last).__name__}")


# ── inputs ────────────────────────────────────────────────────────────────────
def grouped_day(d: str, fetch: Optional[Callable] = None) -> Optional[dict]:
    """{ticker: [o, h, l, c, v, vw]} for session d (compute.py's day-file shape), cached.
    None when the provider has nothing for the day (never cached, so it is asked again)."""
    p = os.path.join(CACHE_DIR, "grouped", f"{d}.json.gz")
    if os.path.exists(p):
        with gzip.open(p, "rt") as fh:
            return json.load(fh)
    j = (fetch or _get)(f"{BASE}/v2/aggs/grouped/locale/us/market/stocks/{d}?adjusted=false&include_otc=false")
    res = j.get("results") or []
    if not res:
        return None
    g = {T["T"]: [T.get("o"), T.get("h"), T.get("l"), T.get("c"), T.get("v"), T.get("vw")] for T in res if "T" in T}
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with gzip.open(p + ".tmp", "wt") as fh:
        json.dump(g, fh)
    os.replace(p + ".tmp", p)
    return g


def prune(keep_from: str) -> int:
    d = os.path.join(CACHE_DIR, "grouped")
    n = 0
    for f in os.listdir(d) if os.path.isdir(d) else ():
        if f[:10] < keep_from:
            os.remove(os.path.join(d, f))
            n += 1
    return n


def splits(since: str, fetch: Optional[Callable] = None) -> dict:
    """{norm ticker: [(execution_date, split_to / split_from), ...]} executed on/after `since`."""
    p = os.path.join(CACHE_DIR, "splits.json")
    rows = None
    try:
        if time.time() - os.path.getmtime(p) < SPLITS_MAX_AGE:
            doc = json.load(open(p))
            if doc.get("since", "9999") <= since:
                rows = doc["rows"]
    except Exception:
        rows = None
    if rows is None:
        rows, url, pages = [], f"{BASE}/v3/reference/splits?execution_date.gte={since}&limit=1000", 0
        while url and pages < 200:
            j = (fetch or _get)(url)
            rows += [{"ticker": s.get("ticker"), "execution_date": s.get("execution_date"),
                      "split_from": s.get("split_from"), "split_to": s.get("split_to")} for s in j.get("results") or []]
            url, pages = j.get("next_url"), pages + 1
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(p + ".tmp", "w") as fh:
            json.dump({"since": since, "rows": rows}, fh)
        os.replace(p + ".tmp", p)
    by = defaultdict(list)
    for s in rows:
        try:
            r = float(s["split_to"]) / float(s["split_from"])
        except Exception:
            continue
        if r > 0 and s.get("ticker") and s.get("execution_date"):
            by[norm(s["ticker"])].append((s["execution_date"], r))
    for v in by.values():
        v.sort()
    return dict(by)


def _ymd(d: str) -> int:
    return int(d.replace("-", ""))


# ── the frame (compute.build_frame) ───────────────────────────────────────────
def build_frame(sessions: list, days: dict, spl: dict, keep: Optional[set] = None, dividends: bool = True):
    tick, cols = {}, []
    for d in sessions:
        g = days[d]
        g = {norm(t): b for t, b in g.items()}
        if keep is not None:
            g = {t: b for t, b in g.items() if t in keep}
        cols.append(g)
        for t in g:
            tick.setdefault(t, len(tick))
    T, D = len(tick), len(sessions)
    closes = np.full((T, D), np.nan, dtype=np.float64)
    vols = np.full((T, D), np.nan)
    highs = np.full((T, D), np.nan, dtype=np.float32)
    lows = np.full((T, D), np.nan, dtype=np.float32)
    for j, g in enumerate(cols):
        for t, b in g.items():
            i = tick[t]
            if b[3]:
                closes[i, j] = b[3]
            if b[4]:
                vols[i, j] = b[4]
            if b[1] is not None and b[2] is not None and b[3] and (b[4] or 0) > 0:
                highs[i, j] = b[1]
                lows[i, j] = b[2]
    tickers = [None] * T
    for t, i in tick.items():
        tickers[i] = t
    # split adjustment to the newest session's basis: price before an execution date / ratio, volume x ratio
    for t, evs in spl.items():
        i = tick.get(t)
        if i is None:
            continue
        for ex, r in evs:
            j = bisect.bisect_left(sessions, ex)
            if j <= 0 or j > D:
                continue
            closes[i, :j] /= r
            vols[i, :j] *= r
            highs[i, :j] /= r
            lows[i, :j] /= r
    split_closes = closes.astype(np.float32)            # the split-only basis, for atr_ext_7
    if dividends:
        from api.services import breadth_dividends as bd
        closes = bd.adjust(tickers, [_ymd(d) for d in sessions], closes)
    return {"dates": sessions, "date_pos": {d: j for j, d in enumerate(sessions)}, "closes": closes, "vols": vols,
            "split_closes": split_closes, "highs": highs, "lows": lows, "tick": tick}, tickers


def atr_ext(frame: dict, j: int, mem, thresh: float = 7.0, atr_n: int = 14, sma_n: int = 50) -> Optional[int]:
    """compute.atr_ext (= breadth_eod_extras.atr_extended), unchanged."""
    a = j - (sma_n + 5) + 1
    if a < 0:
        return None
    idx = np.array([frame["tick"][t] for t in mem if t in frame["tick"]], dtype=np.int64)
    C = frame["split_closes"][idx, a:j + 1].astype(np.float64)
    H = frame["highs"][idx, a:j + 1].astype(np.float64)
    L = frame["lows"][idx, a:j + 1].astype(np.float64)
    pc = np.concatenate([np.full((C.shape[0], 1), np.nan), C[:, :-1]], axis=1)
    with np.errstate(invalid="ignore"):
        tr = np.fmax(np.fmax(H - L, np.abs(H - pc)), np.abs(L - pc))
    tr14 = tr[:, -atr_n:]
    c = C[:, -1]
    sma = C[:, -sma_n:]
    ok = (~np.isnan(tr14).any(axis=1)) & (~np.isnan(sma).any(axis=1)) & (c > 0)
    n = 0
    for i in np.nonzero(ok)[0]:
        atr = float(tr14[i].mean())
        if atr <= 0:
            continue
        atr_pct = round(atr / c[i] * 100, 1)
        if atr_pct <= 0:
            continue
        if round((c[i] - float(sma[i].mean())) / (atr_pct / 100.0 * c[i]), 1) > thresh:
            n += 1
    return n


def measure(frame: dict, tickers: list, d: str, members) -> dict:
    """{"ok", "values": {up_vol_ratio, hvc_52w, atr_ext_7}, "measured", "members"} for session d."""
    from api.services import breadth_history_recon as recon
    mem = {norm(t) for t in members}
    r = recon.recompute_from_frame(frame, tickers, d, members=mem)
    if not r.get("ok"):
        return {"ok": False, "reason": r.get("reason")}
    m = r["metrics"]
    vals = {"up_vol_ratio": m.get("up_vol_ratio"), "hvc_52w": m.get("hvc_52w"),
            "atr_ext_7": atr_ext(frame, frame["date_pos"][d], mem)}
    return {"ok": True, "values": {k: v for k, v in vals.items() if v is not None},
            "measured": int(m.get("universe_count") or 0), "members": len(mem)}
