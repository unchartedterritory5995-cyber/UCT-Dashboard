"""Textbook withhold gate for member drawings (recert B, round 2).

A member drawing row is served only when the chart also meets the textbook context the strict blind rubric scores:
the row's own geometry is NOT changed, the gate only withholds. Pure functions on completed daily bars
({t,o,h,l,c,v}, oldest first, the last one the as-of session); no I/O. Byte-for-byte the lab rule that passed its
pre-registered blind round (tests/test_textbook_gate.py carries the parity rail).

Released so far: the inside-day drawing (draw:inside-day), INSIDE_DAY_GATE_ROUND.
  TREND (Minervini trend template; O'Neil): close > SMA200; SMA200 above its value 20 AND 60 sessions earlier and at
     least 2% above the 60-session-old value; SMA50 > SMA200; SMA50 not below its value 10 sessions earlier; close
     within 15% of the 252-session high.
  INSIDE DAY: a true inside bar (high <= mother high, low >= mother low); inside range <= 60% of the mother range;
     close <= 6% above the SMA50; trigger - stop <= 1.0 ATR(14); the stop within 0.05 ATR of today's or the mother's
     low, the trigger within 0.05 ATR of today's or the mother's high.
"""

#: The gate round the blind check confirmed for the inside-day drawing (lab recert B round 2).
INSIDE_DAY_GATE_ROUND = 1

MIN_BARS = 261


def _sma(c, n, end):
    if end + 1 < n:
        return None
    return sum(c[end - n + 1:end + 1]) / n


def _atr(b, end, n=14):
    trs = []
    for i in range(max(1, end - n + 1), end + 1):
        trs.append(max(b[i]["h"] - b[i]["l"], abs(b[i]["h"] - b[i - 1]["c"]), abs(b[i]["l"] - b[i - 1]["c"])))
    return sum(trs) / len(trs) if trs else None


def common(bars) -> dict:
    """The trend facts of the as-of bar (the last one)."""
    c = [x["c"] for x in bars]
    i = len(bars) - 1
    f = {"close": c[i]}
    f["sma50"], f["sma200"] = _sma(c, 50, i), _sma(c, 200, i)
    f["sma50_10"], f["sma200_20"] = _sma(c, 50, i - 10), _sma(c, 200, i - 20)
    f["sma200_60"] = _sma(c, 200, i - 60)
    f["tt_200_rising_3m"] = f["sma200_60"] is not None and f["sma200"] is not None and f["sma200"] > f["sma200_60"]
    f["sma200_slope_3m"] = (f["sma200"] / f["sma200_60"] - 1) if (f["sma200_60"] and f["sma200"]) else None
    w = bars[max(0, i - 251):i + 1]
    f["hi252"] = max(x["h"] for x in w)
    f["atr"] = _atr(bars, i)
    ok = None not in (f["sma50"], f["sma200"], f["sma50_10"], f["sma200_20"])
    f["tt_50_over_200"] = ok and f["sma50"] > f["sma200"]
    f["tt_50_rising"] = ok and f["sma50"] >= f["sma50_10"]
    f["tt_200_rising"] = ok and f["sma200"] > f["sma200_20"]
    f["tt_close_over_200"] = ok and c[i] > f["sma200"]
    f["off_high"] = 1 - c[i] / f["hi252"]
    return f


def trend_fails(f) -> list:
    r = []
    if not f["tt_close_over_200"]:
        r.append("close<=sma200")
    if not f["tt_200_rising"]:
        r.append("sma200_not_rising")
    if not f["tt_200_rising_3m"]:
        r.append("sma200_not_rising_3m")
    if f["sma200_slope_3m"] is None or f["sma200_slope_3m"] < 0.02:
        r.append("sma200_slope<2%")
    if not f["tt_50_over_200"]:
        r.append("sma50<=sma200")
    if not f["tt_50_rising"]:
        r.append("sma50_falling")
    if f["off_high"] > 0.15:
        r.append("off_high>15%")
    return r


def inside_day_fails(bars, row) -> list:
    """The failed rule names for one draw:inside-day row on `bars` (ending at its as-of bar); [] = served.
    Too short a history, a malformed row or any arithmetic failure fails closed."""
    try:
        if len(bars or []) < MIN_BARS:
            return ["short_history"]
        d = ((row.get("geometry") or {}).get("extras") or {})["draw_inside_day"]
        f = common(bars)
        a = f["atr"]
        m, x = bars[-2], bars[-1]
        r = trend_fails(f)
        if not (x["h"] <= m["h"] and x["l"] >= m["l"]):
            r.append("I1_not_inside")
        ratio = (x["h"] - x["l"]) / (m["h"] - m["l"]) if m["h"] > m["l"] else None
        if ratio is None or ratio > 0.60:
            r.append("I3_wide")
        ext50 = bars[-1]["c"] / f["sma50"] - 1 if f["sma50"] else None
        if ext50 is None or ext50 > 0.06:
            r.append("I6_extended")
        risk = (d["trigger"] - d["stop"]) / a if a else None
        if risk is None or risk > 1.0:
            r.append("I5_risk")
        so = min(abs(d["stop"] - x["l"]), abs(d["stop"] - m["l"])) / a if a else None
        if so is None or so > 0.05:
            r.append("I5_stop_not_at_a_low")
        to = min(abs(d["trigger"] - x["h"]), abs(d["trigger"] - m["h"])) / a if a else None
        if to is None or to > 0.05:
            r.append("I4_trigger_not_at_a_high")
        return r
    except Exception:  # noqa: BLE001 -- an unreadable row is not served
        return ["unreadable"]
