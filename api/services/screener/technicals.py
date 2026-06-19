"""Technical indicators computed from local daily bars.

``bars`` is a list of dicts ``{"o","h","l","c","v"}`` ordered oldest -> newest.
Pure; returns Nones where there isn't enough history.
"""


def _sma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


def _ema(vals, n):
    if len(vals) < n:
        return None
    k = 2 / (n + 1)
    ema = sum(vals[:n]) / n
    for v in vals[n:]:
        ema = v * k + ema * (1 - k)
    return ema


def _rsi(closes, n=14):
    if len(closes) < n + 1:
        return None
    gains = losses = 0.0
    for i in range(len(closes) - n, len(closes)):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0)
        losses += max(-d, 0)
    avg_g, avg_l = gains / n, losses / n
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100 - (100 / (1 + rs))


def _pct(a, b):
    return round((a - b) / b * 100, 2) if b else None


def compute_technicals(bars: list[dict]) -> dict:
    out = {k: None for k in (
        "chg_pct_1d", "chg_pct_1w", "chg_pct_1m", "rsi14", "pct_vs_sma20",
        "pct_vs_sma50", "pct_vs_sma200", "pct_vs_ema20", "adr_pct", "atr_pct",
        "vol_ratio", "gap_pct", "dist_52w_high_pct", "dist_52w_low_pct", "price")}
    out["ma_stack"] = None
    out["above_50sma"] = None
    out["new_52w_high"] = False
    if not bars:
        return out
    closes = [b["c"] for b in bars]
    price = closes[-1]
    out["price"] = price
    if len(closes) >= 2:
        out["chg_pct_1d"] = _pct(price, closes[-2])
        out["gap_pct"] = _pct(bars[-1]["o"], closes[-2])
    if len(closes) >= 6:
        out["chg_pct_1w"] = _pct(price, closes[-6])
    if len(closes) >= 22:
        out["chg_pct_1m"] = _pct(price, closes[-22])
    rsi = _rsi(closes)
    out["rsi14"] = round(rsi, 2) if rsi is not None else None
    s20, s50, s200 = _sma(closes, 20), _sma(closes, 50), _sma(closes, 200)
    e20 = _ema(closes, 20)
    out["pct_vs_sma20"] = _pct(price, s20) if s20 else None
    out["pct_vs_sma50"] = _pct(price, s50) if s50 else None
    out["pct_vs_sma200"] = _pct(price, s200) if s200 else None
    out["pct_vs_ema20"] = _pct(price, e20) if e20 else None
    out["above_50sma"] = (price > s50) if s50 else None
    if s20 and s50 and s200:
        if price > s20 > s50 > s200:
            out["ma_stack"] = "full-bull"
        elif price < s20 < s50 < s200:
            out["ma_stack"] = "bear"
        else:
            out["ma_stack"] = "partial"
    # ADR% / ATR% over last 21 sessions
    window = bars[-21:] if len(bars) >= 21 else bars
    if window:
        adr = sum((b["h"] - b["l"]) / b["c"] for b in window if b["c"]) / len(window)
        out["adr_pct"] = round(adr * 100, 2)
        out["atr_pct"] = out["adr_pct"]
    # Volume ratio: today vs prior 30-day average
    vols = [b.get("v") or 0 for b in bars]
    if len(vols) >= 2:
        prior = vols[-31:-1]
        avg = sum(prior) / len(prior) if prior else 0
        out["vol_ratio"] = round(vols[-1] / avg, 2) if avg else None
    # 52-week high/low distance + new-high flag (today's high vs window)
    yr = bars[-252:] if len(bars) >= 252 else bars
    hi = max(b["h"] for b in yr)
    lo = min(b["l"] for b in yr)
    out["dist_52w_high_pct"] = _pct(price, hi)
    out["dist_52w_low_pct"] = _pct(price, lo)
    out["new_52w_high"] = bars[-1]["h"] >= hi
    return out
