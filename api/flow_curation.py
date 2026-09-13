"""Faithful Python port of the Options Flow curation pipeline.

Reference implementation: ``app/src/pages/OptionsFlow.jsx`` (the page the desk
actually looks at).  This module exists so the Morning Wire can publish flow
picks that AGREE with that page.

``api/flow_summary.py`` is only a ~30% mirror and is NOT the reference — it
disagrees with the page on DTE precedence, key format and rounding.  Do not
use it to cross-check this module.

Ported regions (line numbers are from OptionsFlow.jsx as of 2026-07-21; the
map handed to the porter was ~55-330 lines stale — see MAP CORRECTIONS below):

    parseExpiry / computeDTE / formatExp   JSX 499-531
    premiumFilter / capBand                JSX 553-564
    gradeCluster                           JSX 147-158
    detectPatterns                         JSX 161-187
    buildCharts CONV cluster builder       JSX 978-1138
    processFlowData (stages A-E)           JSX 1206-2010
    autoScore                              JSX 2835-2950
    wlPopulate (top-20 per direction)      JSX 3024-3095

MAP CORRECTIONS (what the line-number map got wrong — verified against source):

  * Every cited range was stale.  parseExpiry is 499 (not 441), premiumFilter
    553 (not 495), capBand 559 (not 501), processFlowData 1206 (not 835),
    buildCharts' CONV builder 978-1138 (not ~650-780), autoScore 2835
    (not 1897), wlPopulate 3024 (not 2042).
  * The dirty-cluster premium-dominance threshold is **0.70**, not 0.85
    (JSX 1767; the comment right above it records the deliberate 85%->70%
    lowering for Massive ingestion).  The only 0.8 boundary is the dominant
    -direction override (JSX 1042/1043).
  * ``Math.min(...[])`` -> ``Infinity`` is NOT actually relied on anywhere.
    Every spread-min/max in the dirty-cluster block and in detectPatterns is
    guarded by an explicit ``.length > 0`` / ``>= 3`` check.  The Python port
    keeps the same guards, so ``min([])`` can never be reached.  (Pitfall #4
    is handled defensively anyway — see ``_js_min`` / ``_js_max``.)

PUBLIC API
    curate(rows, *, today, pick_history=None) -> dict
    js_num(x) -> str                # JS Number->String, for cluster keys
    tracker_key(sym, cp, strike, exp) -> str    # top_flow_picks.json format
    sort_rows_newest_first(rows) -> list
    grade_cluster(cluster) -> str
    auto_score(cluster) -> float

ROW ORDER CONTRACT — READ THIS
    ``curate`` expects rows **NEWEST-FIRST**, exactly as the BBS CSV arrives
    and exactly as the page consumes them.  A HIGHER list index means EARLIER
    in time.  Three of the four dirty-cluster exceptions (escalation,
    de-escalation, profit-taking) compare positional indices and INVERT if you
    hand them ascending-time rows.  Rows read out of SQLite in rowid order are
    upload order = oldest-day-first, newest-row-first *within* a day, which is
    NOT the same thing -- run them through ``sort_rows_newest_first`` first.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Any, Iterable, Mapping, Sequence

__all__ = [
    "curate",
    "js_num",
    "tracker_key",
    "cluster_key",
    "sort_rows_newest_first",
    "grade_cluster",
    "auto_score",
    "detect_patterns",
    "parse_expiry",
    "compute_dte",
    "format_exp",
    "cap_band",
    "premium_filter",
    "normalize_row",
]


# ─────────────────────────────────────────────────────────────────────────────
# PITFALL #1 — Math.round is half-up; Python round() is banker's.
# autoScore ends on Math.round(s / 1.25 * 10) / 10.  Using round() reorders the
# top-20 at ties.  Every port of Math.round goes through js_round.
# ─────────────────────────────────────────────────────────────────────────────
def js_round(x: float) -> int:
    """JS ``Math.round``: half-up toward +Infinity (Math.round(-1.5) === -1)."""
    if x != x or x in (float("inf"), float("-inf")):
        raise ValueError(f"js_round: non-finite {x!r}")
    return math.floor(x + 0.5)


# ─────────────────────────────────────────────────────────────────────────────
# PITFALL #2 — cluster keys are JS-number-stringified.
# The page builds keys as `AAPL|C|200|6/20` (JS Number->String drops the ".0").
# oi_snapshots.make_key and top_flow_tracker._pick_key use float(strike) and
# produce `200.0`.  Those are DIFFERENT namespaces; never mix them.  Use
# cluster_key() for anything joining against this module, tracker_key() for
# anything joining against top_flow_picks.json.
# ─────────────────────────────────────────────────────────────────────────────
def js_num(x: Any) -> str:
    """Stringify a number the way JavaScript does.

    Integral floats lose the trailing ``.0`` (``200.0 -> "200"``), which is what
    makes the page's cluster keys look like ``AAPL|C|200|6/20``.
    """
    f = float(x)
    if f != f:
        return "NaN"
    if f == float("inf"):
        return "Infinity"
    if f == float("-inf"):
        return "-Infinity"
    if f == int(f) and abs(f) < 1e21:
        # -0.0 stringifies as "0" in JS.
        return str(int(f) + 0)
    return repr(f)


def _jstr(v: Any) -> str:
    """JS string-concat coercion (``null`` -> ``"null"``, numbers -> js_num)."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return js_num(v)
    return str(v)


def cluster_key(sym: Any, cp: Any, strike: Any, exp: Any) -> str:
    """The page's contract key: ``S|CP|K|E`` with a JS-stringified strike."""
    return f"{_jstr(sym)}|{_jstr(cp)}|{_jstr(strike)}|{_jstr(exp)}"


def tracker_key(sym: str, cp: str, strike: Any, exp: str) -> str:
    """The ``top_flow_picks.json`` id format (``api/top_flow_tracker._pick_key``).

    NOTE the deliberate difference from :func:`cluster_key`: the tracker uses
    ``float(strike)`` so a $200 strike is ``200.0``, and it upper-cases sym/cp.
    Callers joining curate() output against top_flow_picks.json must use THIS.
    """
    return f"{str(sym).upper()}|{str(cp).upper()}|{float(strike)}|{exp}"


# ─────────────────────────────────────────────────────────────────────────────
# PITFALL #3 — every column in the `flow` table is TEXT (api/flow_db.py) and
# BBS ships "", "N/A", "-", "1,234", "$1,234.56".  parseFloat/parseInt never
# throw; float()/int() do.  These helpers reproduce the JS coercion exactly,
# including the quirks (js_parse_float("1,234") == 1.0 — parseFloat stops at
# the comma, and the page does NOT strip commas from `strike`).
# ─────────────────────────────────────────────────────────────────────────────
_FLOAT_RE = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
_INT_RE = re.compile(r"^[+-]?\d+")
_JS_WS = " \t\n\r\v\f ﻿"


def js_parse_float(v: Any) -> float:
    """JS ``parseFloat``. Returns NaN (never raises) on unparseable input."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    s = ("" if v is None else str(v)).lstrip(_JS_WS)
    if s.startswith("Infinity") or s.startswith("+Infinity"):
        return float("inf")
    if s.startswith("-Infinity"):
        return float("-inf")
    m = _FLOAT_RE.match(s)
    return float(m.group(0)) if m else float("nan")


def js_parse_int(v: Any) -> float:
    """JS ``parseInt`` (radix 10). Returns NaN (never raises)."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        f = float(v)
        if f != f:
            return f
        return float(math.trunc(f))
    s = ("" if v is None else str(v)).lstrip(_JS_WS)
    m = _INT_RE.match(s)
    return float(m.group(0)) if m else float("nan")


def _num_or_zero(v: Any) -> float:
    """``parseFloat(x) || 0`` — NaN *and* 0 both fall through to 0."""
    f = js_parse_float(v)
    return 0.0 if f != f or f == 0 else f


def _int_or_zero(v: Any) -> int:
    """``parseInt(x) || 0``."""
    f = js_parse_int(v)
    return 0 if f != f or f == 0 else int(f)


def _s(v: Any) -> str:
    """``(x || "")`` for a text column."""
    return "" if v is None else str(v)


def _js_min(seq: Sequence[float]) -> float:
    """``Math.min(...seq)`` — empty spread is +Infinity in JS (see PITFALL #4)."""
    return min(seq) if seq else float("inf")


def _js_max(seq: Sequence[float]) -> float:
    """``Math.max(...seq)`` — empty spread is -Infinity in JS."""
    return max(seq) if seq else float("-inf")


# ─────────────────────────────────────────────────────────────────────────────
# Row normalization — mirrors parseCSV's ALIASES table (JSX 446-468) so the
# same function accepts flow-table rows (`Symbol`, `CallPut`, `MktCap`, ...)
# and already-lowercased CSV rows (`ticker`, `cp`, `mktcap`, ...).
# ─────────────────────────────────────────────────────────────────────────────
_ALIASES: dict[str, tuple[str, ...]] = {
    "ticker": ("symbol", "ticker", "sym", "stock", "underlying", "name"),
    "date": ("createddate", "date", "tradedate", "day"),
    "time": ("createdtime", "time", "tradetime"),
    "expiry": ("expirationdate", "expiry", "expiration", "exp", "expdate"),
    "strike": ("strike", "strikeprice", "k"),
    "type": ("type", "details", "tradetype", "tradedetails", "description", "ordertype"),
    "cp": ("callput", "cp", "optiontype", "callorput", "putorcall"),
    "spot": ("spot", "stockprice", "underprice", "underlyingprice", "last",
             "underlast", "stocklast"),
    "side": ("side", "aggressorside", "aggressor", "orderside"),
    "volume": ("volume", "vol", "qty", "contracts", "size", "quantity"),
    "oi": ("oi", "openinterest", "openint", "opint"),
    "iv": ("impliedvolatility", "iv", "impliedvol", "implvol", "ivol"),
    "premium": ("premium", "prem", "totalpremium", "value", "totalvalue", "notional"),
    "price": ("price", "contractprice", "optionprice", "lastprice", "midprice", "mid"),
    "color": ("color", "signal", "oicolor", "oisignal", "flag"),
    "dte": ("dte", "daystoexpiry", "daystoexp", "dtex"),
    "mktcap": ("mktcap", "marketcap", "mcap"),
    "sector": ("sector",),
    "uoa": ("uoa",),
    "stocketf": ("stocketf", "assettype", "type2"),
    "er": ("er", "earnings", "earningsdate"),
}
_NON_ALNUM = re.compile(r"[^a-z0-9]")


def normalize_row(row: Mapping[str, Any]) -> dict[str, str]:
    """Map an arbitrary flow row onto the canonical field names.

    Header keys are lower-cased and stripped of non-alphanumerics exactly like
    ``parseCSV`` does, then resolved through the alias table (first alias that
    is present wins — same precedence as the JSX).
    """
    flat = {_NON_ALNUM.sub("", str(k).lower()): v for k, v in row.items()}
    out: dict[str, str] = {}
    for field, aliases in _ALIASES.items():
        for alias in aliases:
            if alias in flat:
                out[field] = _s(flat[alias]).strip()
                break
    return out


def sort_rows_newest_first(rows: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """Order rows the way ``curate`` requires: NEWEST FIRST.

    Rows read out of SQLite in rowid order are upload order — oldest *day*
    first, newest *row* first within a day.  That is not newest-first overall,
    and feeding it straight to :func:`curate` silently inverts three of the
    four dirty-cluster exceptions.  Sort with this instead.

    Rows with unparseable date/time sort last (treated as oldest).
    """
    def _int(v: Any) -> int:
        f = js_parse_int(v)
        return 0 if f != f else int(f)

    def key(r: Mapping[str, Any]) -> tuple[int, int, int, int]:
        n = normalize_row(r)
        parts = [p for p in n.get("date", "").split("/") if p != ""]
        mo = _int(parts[0]) if len(parts) >= 1 else 0
        dy = _int(parts[1]) if len(parts) >= 2 else 0
        yr = _int(parts[2]) if len(parts) >= 3 else 0
        if 0 < yr < 100:
            yr += 2000
        return (yr, mo, dy, _time_to_sec(n.get("time", "")))

    return sorted(rows, key=key, reverse=True)


_TIME_RE = re.compile(r"(\d+):(\d+):(\d+)\s*(AM|PM)", re.I)
_TIME_RE_OPT = re.compile(r"(\d+):(\d+):(\d+)\s*(AM|PM)?", re.I)


def _time_to_sec(t: str) -> int:
    """``parseTimeToSec`` (JSX 1355-1366) — unparseable -> 0."""
    m = _TIME_RE.search(t or "")
    if not m:
        return 0
    h = int(js_parse_int(m.group(1)))
    mi = int(js_parse_int(m.group(2)))
    se = int(js_parse_int(m.group(3)))
    ampm = m.group(4).upper()
    if ampm == "PM" and h != 12:
        h += 12
    if ampm == "AM" and h == 12:
        h = 0
    return h * 3600 + mi * 60 + se


def _parse_ts(ts: str) -> int:
    """``_parseTs`` / ``parseT`` (JSX 1415-1426, 1071-1078) — unparseable -> -1."""
    m = _TIME_RE_OPT.search(ts or "")
    if not m:
        return -1
    h = int(js_parse_int(m.group(1)))
    mm = int(js_parse_int(m.group(2)))
    ss = int(js_parse_int(m.group(3)))
    pm = (m.group(4) or "").upper() == "PM"
    if pm and h < 12:
        h += 12
    if not pm and h == 12:
        h = 0
    return h * 3600 + mm * 60 + ss


# ─────────────────────────────────────────────────────────────────────────────
# Date utilities (JSX 499-531)
#
# PITFALL #10 — parseExpiry's "M/D" rollover reads the wall clock.  Here
# `today` is an explicit injected parameter everywhere, never an implicit
# clock call, so results are reproducible.
# ─────────────────────────────────────────────────────────────────────────────
def parse_expiry(s: Any, *, today: date) -> date | None:
    """``parseExpiry`` (JSX 499-517).

    ``M/D/YYYY`` / ``M/D/YY`` (2-digit years get +2000) or bare ``M/D``.  For
    the bare form the JSX compares ``new Date(y, m-1, d)`` (midnight) against
    ``new Date()`` (now), so an ``M/D`` equal to TODAY is already in the past
    and rolls to next year.  ``<= today`` reproduces that.
    """
    if not s:
        return None
    txt = str(s).strip().replace('"', "")
    parts = txt.split("/")
    if len(parts) == 3:
        y = js_parse_int(parts[2])
        m = js_parse_int(parts[0])
        d = js_parse_int(parts[1])
        if y != y or m != m or d != d:
            return None
        year = int(y) + 2000 if y < 100 else int(y)
        return _js_date(year, int(m), int(d))
    if len(parts) == 2:
        m = js_parse_int(parts[0])
        d = js_parse_int(parts[1])
        if m != m or d != d:
            return None
        cand = _js_date(today.year, int(m), int(d))
        if cand is None:
            return None
        if cand <= today:  # midnight-of-today is < now-of-today in JS
            cand = _js_date(today.year + 1, int(m), int(d))
        return cand
    # `new Date(s)` fallback: accept ISO YYYY-MM-DD, else give up.
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", txt)
    if m:
        return _js_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def _js_date(year: int, month: int, day: int) -> date | None:
    """``new Date(y, m-1, d)`` including JS's month/day overflow rollover."""
    try:
        y = year + (month - 1) // 12
        mo = (month - 1) % 12 + 1
        base = date(y, mo, 1)
        from datetime import timedelta

        return base + timedelta(days=day - 1)
    except (ValueError, OverflowError):
        return None


def compute_dte(expiry: date | None, *, today: date) -> int:
    """``computeDTE`` (JSX 518-522). No expiry -> -1."""
    if not expiry:
        return -1
    return (expiry - today).days


def format_exp(expiry: date | None, *, today: date) -> str:
    """``formatExp`` (JSX 523-531). Current year -> ``M/D``, else ``M/D/YY``."""
    if not expiry:
        return ""
    if expiry.year == today.year:
        return f"{expiry.month}/{expiry.day}"
    return f"{expiry.month}/{expiry.day}/{str(expiry.year)[2:]}"


# ─────────────────────────────────────────────────────────────────────────────
# Cap / premium filters (JSX 551-564)
# ─────────────────────────────────────────────────────────────────────────────
def is_mega_cap(mktcap: float) -> bool:
    return mktcap >= 500e9


def premium_filter(premium: float, mktcap: float) -> bool:
    """``premiumFilter`` (JSX 553-556): mega caps need $100K+, others any size."""
    if not is_mega_cap(mktcap):
        return True
    return premium >= 100000


def cap_band(mktcap: float) -> str:
    """``capBand`` (JSX 559-564)."""
    if not mktcap or mktcap <= 0:
        return "Unknown"
    if mktcap >= 500e9:
        return "Mega"
    if mktcap >= 10e9:
        return "Large"
    return "Mid-Small"


# ─────────────────────────────────────────────────────────────────────────────
# Grading + pattern detection (JSX 147-187)
# ─────────────────────────────────────────────────────────────────────────────
def grade_cluster(c: Mapping[str, Any]) -> str:
    """``gradeCluster`` (JSX 147-158). Accepts the internal cluster dict."""
    has_sweep = bool(c.get("hasSweep"))
    has_block = bool(c.get("hasBlock"))
    oi_exceeded = bool(c.get("oiExceeded"))
    clean = bool(c.get("clean"))
    if has_sweep and has_block and clean and oi_exceeded:
        return "A+"
    if (has_sweep and has_block and clean) or (has_sweep and oi_exceeded and clean):
        return "A"
    if has_sweep and clean:
        return "B+"
    if has_sweep and has_block:
        return "B"
    if (has_sweep and not clean) or (has_block and oi_exceeded):
        return "C"
    return "D"


def detect_patterns(c: Mapping[str, Any]) -> list[dict[str, Any]]:
    """``detectPatterns`` (JSX 161-187)."""
    patterns: list[dict[str, Any]] = []
    ivs = c.get("ivs") or []
    if len(ivs) >= 3:
        min_iv, max_iv = _js_min(ivs), _js_max(ivs)
        spots = c.get("spots") or []
        min_spot = _js_min(spots) if len(spots) > 0 else 0
        max_spot = _js_max(spots) if len(spots) > 0 else 0
        spot_range = (max_spot - min_spot) / min_spot if min_spot > 0 else 0
        iv_change = (max_iv - min_iv) / min_iv if min_iv > 0 else 0
        if iv_change >= 0.5 and spot_range < 0.03:
            patterns.append({
                "type": "IV_SURGE",
                "ivChange": js_round(iv_change * 100),
                "spotRange": js_round(spot_range * 100),
            })
    side_times = c.get("sideTimes") or []
    if len(side_times) >= 6:
        half = len(side_times) // 2
        f, s = side_times[:half], side_times[half:]
        ap1 = sum(x["prem"] for x in f if x["si"] in ("AA", "A"))
        bp1 = sum(x["prem"] for x in f if x["si"] in ("BB", "B"))
        ap2 = sum(x["prem"] for x in s if x["si"] in ("AA", "A"))
        bp2 = sum(x["prem"] for x in s if x["si"] in ("BB", "B"))
        t1, t2 = ap1 + bp1, ap2 + bp2
        if (t1 > 0 and ap1 / t1 > 0.7 and t2 > 0 and bp2 / t2 > 0.7) or \
           (t1 > 0 and bp1 / t1 > 0.7 and t2 > 0 and ap2 / t2 > 0.7):
            ask_first = t1 > 0 and ap1 / t1 > 0.7
            patterns.append({
                "type": "SIDE_FLIP",
                "from": "ASK" if ask_first else "BID",
                "to": "BID" if ask_first else "ASK",
            })
    hits = c.get("hits") or c.get("H") or 0
    if hits >= 20:
        patterns.append({"type": "HEAVY", "hits": hits})
    prices = c.get("prices") or []
    if len(prices) >= 4:
        fp, lp = prices[0], prices[-1]
        if fp > 0 and lp / fp >= 1.8:
            patterns.append({"type": "PRICE_SURGE", "pctChange": js_round((lp / fp - 1) * 100)})
    return patterns


# ─────────────────────────────────────────────────────────────────────────────
# autoScore (JSX 2835-2950)
#
# The page's wlCapCheck falls back to a client-side `capLookup` map for rows
# with mktcap == 0.  That map is UI state (built from live snapshots) and is
# not available server-side, so this port uses cap_band(mktcap) alone.  A
# gap-fill row with mktcap 0 therefore scores as "Unknown" cap == non-mega,
# which is exactly what the page does when its lookup also misses.
# ─────────────────────────────────────────────────────────────────────────────
def auto_score(c: Mapping[str, Any]) -> float:
    """``autoScore`` (JSX 2835-2950). 0-10, one decimal."""
    s = 0.0
    g = c.get("grade") or ""
    s += {"A+": 2.5, "A": 2.0, "B+": 1.5, "B": 1.0, "C": 0.5}.get(g, 0.5)

    h = c.get("hits") or 0
    v = c.get("volOI") or 0
    p = c.get("prem") or 0
    cap = cap_band(c.get("mktcap") or 0)
    is_mega = cap == "Mega"

    if h <= 1:
        if (p >= 10e6) if is_mega else (p >= 5e6):
            s += 2.5
        elif v >= 15:
            s += 2.5
        elif v >= 5 and ((p >= 2e6) if is_mega else (p >= 250e3)):
            s += 2
        elif v >= 5:
            s += 1.5
        elif (p >= 5e6) if is_mega else (p >= 500e3):
            s += 1.5
        else:
            s += 0.5
    else:
        hits_score = 2.5 if h >= 10 else 2 if h >= 5 else 1.5 if h >= 3 else 1 if h >= 2 else 0.5
        if (p >= 5e6) if is_mega else (p >= 2e6):
            hits_score = max(hits_score, 2)
        s += hits_score

    if is_mega:
        s += 2.5 if p >= 20e6 else 2 if p >= 10e6 else 1.5 if p >= 5e6 else 1 if p >= 1e6 else 0.5
    else:
        s += (3 if p >= 10e6 else 2.5 if p >= 5e6 else 2 if p >= 2e6
              else 1.75 if p >= 1.5e6 else 1.5 if p >= 500e3 else 1 if p >= 100e3 else 0.5)

    s += 2.5 if v >= 15 else 2 if v >= 8 else 1.5 if v >= 5 else 1.2 if v >= 3 else 1 if v >= 2 else 0.5

    sd = c.get("side") or ""
    s += 1.5 if sd == "AA" else 1 if sd == "BB" else 0.75 if sd in ("ASK", "BID") else 0.5

    if c.get("uoa"):
        s += 1
    if (c.get("DTE") or 0) > 180:
        s += 0.5

    if h <= 1:
        if (p >= 10e6) if is_mega else (p >= 5e6):
            s += 1.5
        elif (p >= 5e6) if is_mega else (p >= 1.5e6):
            s += 0.75

    if h >= 50 and p >= 1e6:
        s += 1.5
    elif h >= 30 and p >= 750e3:
        s += 1.0
    elif h >= 20 and p >= 500e3:
        s += 0.5

    if (c.get("DTE") or 0) >= 3:
        tc = c.get("_timeConc") or 0
        if tc >= 5:
            s += 1.0
        elif tc >= 3:
            s += 0.5

    prem_mult = 1.0
    if is_mega:
        if p < 500e3:
            prem_mult = 0.4
        elif p < 1e6:
            prem_mult = 0.7
    elif cap == "Large":
        if p < 400e3:
            prem_mult = 0.4
        elif p < 750e3:
            prem_mult = 0.7
    elif cap == "Mid-Small":
        if p < 250e3:
            prem_mult = 0.4
        elif p < 500e3:
            prem_mult = 0.7
    s = s * prem_mult

    # PITFALL #1 — half-up, NOT banker's rounding.  round(2.25*10)/10 would
    # give 2.2 in Python and 2.3 in JS, silently reordering the top-20.
    return min(10, js_round(s / 1.25 * 10) / 10)


# ─────────────────────────────────────────────────────────────────────────────
# Stage A — raw trade normalization (processFlowData, JSX 1207-1296)
# ─────────────────────────────────────────────────────────────────────────────
def _raw_trade(row: Mapping[str, Any], idx: int, *, today: date,
               er_soon: set[str] | None) -> dict[str, Any]:
    r = normalize_row(row)

    type_raw = _s(r.get("type")).upper().strip()
    is_ml = type_raw == "ML/" or type_raw.startswith("ML/")
    is_swp = type_raw == "SWEEP" or "SWP" in type_raw
    is_blk = type_raw == "BLOCK" or "BLK" in type_raw

    cp_raw = _s(r.get("cp")).upper().strip()
    if cp_raw == "CALL":
        cp = "C"
    elif cp_raw == "PUT":
        cp = "P"
    else:
        cp = re.sub(r"[^CP]", "", cp_raw)[:1]

    # PITFALL #3 — JS-style coercion everywhere.  Note `strike`/`spot`/`iv`/
    # `mktcap` are parsed WITHOUT stripping commas (faithful to the JSX), so
    # "1,234" -> 1.0 for a strike but 1234 for a volume.
    strike = _num_or_zero(r.get("strike"))
    spot = _num_or_zero(r.get("spot"))
    volume = _int_or_zero(_s(r.get("volume")).replace(",", ""))
    oi = _int_or_zero(_s(r.get("oi")).replace(",", ""))
    premium = _num_or_zero(re.sub(r"[$,]", "", _s(r.get("premium"))))
    price = _num_or_zero(re.sub(r"[$,]", "", _s(r.get("price"))))
    iv = _num_or_zero(r.get("iv"))
    mktcap = _num_or_zero(r.get("mktcap"))
    sector = _s(r.get("sector")).strip()
    uoa = _s(r.get("uoa")).upper().strip() == "T"

    sr = _s(r.get("side")).upper().strip()
    side = sr
    if "ABOVE" in sr or sr == "AA":
        side = "AA"
    elif "BELOW" in sr or sr == "BB":
        side = "BB"
    elif sr == "A" or "ASK" in sr:
        side = "A"
    elif sr == "B" or "BID" in sr:
        side = "B"

    cr = _s(r.get("color")).upper().strip()
    color = "WHITE"
    if cr in ("YELLOW", "Y"):
        color = "YELLOW"
    elif cr in ("MAGENTA", "PURPLE", "M"):
        color = "MAGENTA"
    elif cr == "ORANGE":
        color = "ORANGE"
    elif cr in ("RED", "#FF0000"):
        color = "RED"
    elif cr == "ARB":
        color = "ARB"

    expiry = parse_expiry(r.get("expiry"), today=today)

    # PITFALL #5 — DTE precedence: the CSV `Dte` column WINS when parseable and
    # >= 0; the expiry-derived value is only the fallback.  flow_summary.py has
    # this backwards — do not copy it.
    dte_parsed = js_parse_int(r.get("dte"))
    if dte_parsed == dte_parsed and dte_parsed >= 0:
        dte = int(dte_parsed)
    else:
        dte = compute_dte(expiry, today=today) if expiry else -1

    exp_str = format_exp(expiry, today=today) if expiry else _s(r.get("expiry"))

    dt = ""
    date_raw = _s(r.get("date"))
    if date_raw:
        dp = date_raw.split("/")
        if len(dp) >= 2:
            a, b = js_parse_int(dp[0]), js_parse_int(dp[1])
            dt = f"{_jstr(a)}/{_jstr(b)}"
        else:
            dt = date_raw[:5]

    pct_from_spot = abs(strike - spot) / spot * 100 if spot > 0 else 0
    is_block_deep = type_raw == "BLOCK" or "BLK" in type_raw
    is_deep = pct_from_spot >= 10 if is_block_deep else pct_from_spot >= 20

    confirmed = color in ("YELLOW", "MAGENTA")
    direction = None
    if cp:
        if cp == "C":
            if side in ("AA", "A"):
                direction = "BULL"
            elif side == "BB" and is_swp:
                direction = "BEAR"
        else:
            if side in ("AA", "A"):
                direction = "BEAR"
            elif side == "BB" and is_swp:
                direction = "BULL"
        # Lottery filter — the ONLY consumer of expiry-derived live DTE
        # (JSX 1271-1282).  Everything else uses the CSV-preferred `dte`.
        live_dte = compute_dte(expiry, today=today) if expiry else dte
        if direction and spot > 0 and 0 <= live_dte <= 7 and mktcap >= 10e9:
            is_otm = (cp == "C" and strike > spot) or (cp == "P" and strike < spot)
            if is_otm:
                otm_pct = abs(strike - spot) / spot * 100
                otm_limit = 10 if mktcap >= 200e9 else 15
                if otm_pct >= otm_limit:
                    direction = None
                    confirmed = False

    sym = _s(r.get("ticker")).upper().strip()
    return {
        "_i": idx,
        "S": sym,
        "Ty": "SWP" if is_swp else "BLK" if is_blk else None,
        "CP": cp, "K": strike, "V": volume, "P": premium, "price": price,
        "E": exp_str, "expiry": expiry, "Si": side, "Co": color, "DTE": dte, "Dt": dt,
        "D": direction, "OI": oi, "IV": iv, "Spot": spot,
        "isML": is_ml, "confirmed": confirmed,
        "mktcap": mktcap, "sector": sector, "uoa": uoa,
        "isDeep": is_deep, "pctFromSpot": pct_from_spot,
        "er": (sym in er_soon) if isinstance(er_soon, set)
              else (_s(r.get("er")).upper().strip() == "T"),
        "stocketf": _s(r.get("stocketf")).upper().strip(),
        "time": _s(r.get("time")).strip(),
        "_rescuedBlock": False,
        "_rescueDerived": False,
        "_idx": -1,
    }


def _tkey(t: Mapping[str, Any]) -> str:
    """The page's per-contract cluster key for a trade (PITFALL #2 / #9).

    PITFALL #9 — dict iteration order over these keys is only safe because
    every key contains ``|``; a symbol can never collide with a composite.
    Python dicts preserve insertion order, matching JS object key order for
    non-integer-like string keys.
    """
    return cluster_key(t["S"], t["CP"], t["K"], t["E"])


# ─────────────────────────────────────────────────────────────────────────────
# Stages B-E (processFlowData, JSX 1298-1787)
# ─────────────────────────────────────────────────────────────────────────────
_ETF_BLACKLIST = {"AAL"}
_STOCK_BLACKLIST = {"DRAM"}


def _apply_blacklists(raw: list[dict]) -> None:
    for t in raw:
        if t["S"] in _ETF_BLACKLIST:
            t["stocketf"] = "STOCK"
        if t["S"] in _STOCK_BLACKLIST:
            t["stocketf"] = "ETF"


def _ml_volume_match(raw: list[dict]) -> set[int]:
    """ML/ volume matching (JSX 1307-1331). Returns matched trade indices."""
    matched: set[int] = set()
    ml_trades = [t for t in raw if t["isML"] and t["S"] and t["V"] > 0]
    if not ml_trades:
        return matched
    non_ml: dict[str, list[dict]] = {}
    for t in raw:
        if t["isML"] or not t["Ty"] or not t["S"] or t["V"] <= 0:
            continue
        k = _tkey(t) + "|" + js_num(t["V"])
        non_ml.setdefault(k, []).append(t)
    for ml in ml_trades:
        k = _tkey(ml) + "|" + js_num(ml["V"])
        for cand in non_ml.get(k, []):
            if cand["_i"] not in matched:
                matched.add(cand["_i"])
                break
    return matched


def _cancel_pairs(raw: list[dict]) -> set[int]:
    """Cancel-pair filter (JSX 1333-1394). Returns excluded trade indices."""
    groups: dict[str, list[dict]] = {}
    for t in raw:
        key = "|".join(_jstr(x) for x in
                       (t["Dt"], t["S"], t["CP"], t["K"], t["E"], t["Ty"], t["Si"], t["P"]))
        groups.setdefault(key, []).append(t)
    canceled: set[int] = set()
    for trades in groups.values():
        ordered = sorted(trades, key=lambda t: _time_to_sec(t["time"]))
        stack: list[dict] = []
        for t in ordered:
            if t["Co"] == "RED":
                if stack:
                    canceled.add(stack.pop()["_i"])
                canceled.add(t["_i"])
            else:
                stack.append(t)
    return canceled


def _ml_rescue(raw: list[dict], ml_matched: set[int]) -> None:
    """Massive ML/ rescue (JSX 1396-1506). Mutates trades in place."""
    flow_shape: dict[str, dict[str, float]] = {}
    for t in raw:
        if t["isML"] or t["Ty"] != "SWP" or not t["S"] or not t["CP"]:
            continue
        sh = flow_shape.setdefault(_tkey(t), {"ask": 0.0, "bid": 0.0})
        if t["Si"] in ("A", "AA"):
            sh["ask"] += t["P"]
        elif t["Si"] in ("B", "BB"):
            sh["bid"] += t["P"]

    ml_index: dict[str, list[dict]] = {}
    for t in raw:
        if not t["isML"] or not t["S"] or not t["CP"]:
            continue
        ml_index.setdefault(f"{t['S']}|{t['CP']}", []).append(
            {"trade": t, "ts": _parse_ts(t["time"]), "strike": t["K"], "exp": t["E"]})

    for t in list(raw):
        if not t["isML"] or not t["S"] or not t["CP"]:
            continue
        if t["V"] <= 0 or t["P"] < 100000:
            continue
        if t["_i"] in ml_matched:
            continue
        if (t["OI"] or 0) > 0:  # BBS-sourced ML/ — leave filtered
            continue
        my_ts = _parse_ts(t["time"])
        if my_ts < 0:
            continue
        sym_cp = f"{t['S']}|{t['CP']}"
        siblings = [o for o in ml_index.get(sym_cp, [])
                    if o["trade"] is not t
                    and (o["strike"] != t["K"] or o["exp"] != t["E"])
                    and o["ts"] >= 0 and abs(o["ts"] - my_ts) <= 5]
        if siblings:
            continue
        t["isML"] = False
        t["Ty"] = "SWP"
        shape = flow_shape.get(_tkey(t))
        same_contract_ml = [o for o in ml_index.get(sym_cp, [])
                            if o["strike"] == t["K"] and o["exp"] == t["E"]]
        is_clean_whale = t["P"] >= 2e6 and len(same_contract_ml) == 1 and (t["DTE"] or 0) >= 3
        if shape and ((t["DTE"] or 0) >= 14 or is_clean_whale):
            total = shape["ask"] + shape["bid"]
            if total > 0 and shape["ask"] / total >= 0.7:
                t["Si"] = "A"
                t["D"] = "BULL" if t["CP"] == "C" else "BEAR"
                t["_rescueDerived"] = True


def _spread_filter(filtered: list[dict]) -> list[dict]:
    """Same-timestamp multi-strike spread filter (JSX 1515-1539)."""
    ts_key: dict[str, set[float]] = {}
    for t in filtered:
        ts_key.setdefault(f"{t['S']}|{t['CP']}|{t['time']}", set()).add(t["K"])
    spread_keys = {k for k, strikes in ts_key.items() if len(strikes) >= 3}
    if not spread_keys:
        return filtered
    return [t for t in filtered if f"{t['S']}|{t['CP']}|{t['time']}" not in spread_keys]


def _deep_filter(filtered: list[dict]) -> list[dict]:
    """Deep ITM/OTM arb filter (JSX 1552-1589)."""
    deep_block, deep_sweep = set(), set()
    for t in filtered:
        if t["pctFromSpot"] < 10:
            continue
        k = _tkey(t)
        is_itm = (t["CP"] == "C" and t["K"] < t["Spot"]) or (t["CP"] == "P" and t["K"] > t["Spot"])
        if not is_itm:
            if t["Ty"] == "BLK":
                deep_block.add(k)
            if t["Ty"] == "SWP":
                deep_sweep.add(k)

    out = []
    for t in filtered:
        if not t["isDeep"]:
            out.append(t)
            continue
        is_itm = (t["CP"] == "C" and t["K"] < t["Spot"]) or (t["CP"] == "P" and t["K"] > t["Spot"])
        if is_itm and t["Ty"] == "BLK":
            continue
        if is_itm:
            intrinsic = (t["Spot"] - t["K"]) if t["CP"] == "C" else (t["K"] - t["Spot"])
            if t["Spot"] > 0 and intrinsic > t["Spot"] * 0.5:
                continue
            out.append(t)
            continue
        k = _tkey(t)
        if k in deep_block and k in deep_sweep:
            out.append(t)
            continue
        if t["Ty"] == "BLK":
            continue
        out.append(t)
    return out


def _is_rescuable_whale(t: Mapping[str, Any]) -> bool:
    """``_isRescuableWhale`` (JSX 1609-1616)."""
    if not t["D"]:
        return False
    if t["Ty"] != "SWP":
        return False
    if t["Si"] not in ("A", "AA"):
        return False
    if t["P"] >= 1e6:
        return True
    if (t["OI"] or 0) == 0 and t["P"] >= 500e3:
        return True
    return False


def _block_rescue(filtered: list[dict]) -> None:
    """Sibling BLOCK rescue with the 60% dominance gate (JSX 1618-1676)."""
    contract_prem: dict[str, dict[str, float]] = {}
    for t in filtered:
        if not t["S"] or not t["CP"]:
            continue
        cp = contract_prem.setdefault(_tkey(t), {"total": 0.0, "whaleAsk": 0.0})
        cp["total"] += t["P"]
        if _is_rescuable_whale(t):
            cp["whaleAsk"] += t["P"]
    rescued_dir: dict[str, str] = {}
    for t in filtered:
        if not _is_rescuable_whale(t):
            continue
        rescued_dir.setdefault(_tkey(t), t["D"])
    for t in filtered:
        if t["Ty"] != "BLK" or t["D"] or t["P"] < 500e3 or (t["OI"] or 0) != 0:
            continue
        k = _tkey(t)
        d = rescued_dir.get(k)
        if not d:
            continue
        cp = contract_prem.get(k)
        if not cp or cp["total"] <= 0 or cp["whaleAsk"] / cp["total"] < 0.6:
            continue
        t["D"] = d
        t["_rescuedBlock"] = True
        t["_rescueDerived"] = True


def _dirty_cluster_keys(filtered: list[dict]) -> set[str]:
    """Dirty-cluster detection with all four exceptions (JSX 1683-1782).

    PITFALL #7 — ``_idx`` is the POSITION in ``filtered``, and rows are
    newest-first, so a HIGHER index is EARLIER in time.  Exceptions 1-3 read
    as: ``min(...)`` = most recent, ``max(...)`` = earliest.  Flip the input
    order and all three invert.

    PITFALL #6 — ``c.dte`` is the DTE of the FIRST row seen in the cluster,
    not a max/min.  Do not recompute it.

    PITFALL #8 — askPrem/bidPrem are accumulated in Python in row order, one
    float add at a time, because the 0.70 dominance test is an exact
    comparison on accumulated doubles.  Never replace this with SQL SUM().
    """
    dirty: set[str] = set()
    cluster_dirs: dict[str, dict[str, Any]] = {}
    for i, t in enumerate(filtered):
        t["_idx"] = i
        k = _tkey(t)
        c = cluster_dirs.get(k)
        if c is None:
            c = cluster_dirs[k] = {
                "dirs": set(), "askTimes": [], "askIVs": [], "bidTimes": [], "bidIVs": [],
                "bbSweepTimes": [], "hasBidSide": False, "hasAskSide": False,
                "hasSweep": False, "dte": t["DTE"], "askPrem": 0.0, "bidPrem": 0.0,
            }
        if t["Si"] in ("B", "BB"):
            c["hasBidSide"] = True
            c["bidTimes"].append(i)
            c["bidPrem"] += t["P"]
            if t["IV"] > 0:
                c["bidIVs"].append(t["IV"])
        if t["Si"] in ("A", "AA"):
            c["hasAskSide"] = True
            c["askTimes"].append(i)
            c["askPrem"] += t["P"]
            if t["IV"] > 0:
                c["askIVs"].append(t["IV"])
        if t["Ty"] == "SWP":
            c["hasSweep"] = True
        if not t["D"]:
            continue
        c["dirs"].add(t["D"])
        if t["Si"] == "BB" and t["Ty"] == "SWP":
            c["bbSweepTimes"].append(i)

    for k, c in cluster_dirs.items():
        # DTE <= 3 with any bid side = scalping noise.
        if 0 <= c["dte"] <= 3 and c["hasBidSide"]:
            dirty.add(k)
            continue
        # Block-only clusters, minus the big-ask-block exception.
        if not c["hasSweep"]:
            big_ask_block = c["askPrem"] >= 500000 and not c["hasBidSide"]
            if not big_ask_block:
                dirty.add(k)
                continue
        if c["hasBidSide"] and c["hasAskSide"]:
            # Exception 1 — profit-taking: ask first -> BB sweep later, short DTE.
            is_short_dte = 0 <= c["dte"] <= 14
            if is_short_dte and c["askTimes"] and c["bbSweepTimes"]:
                if _js_min(c["askTimes"]) > _js_max(c["bbSweepTimes"]):
                    continue
            # Exception 2 — escalation: bid first -> ask later with rising IV.
            if c["bidTimes"] and c["askTimes"]:
                earliest_bid = _js_max(c["bidTimes"])   # highest idx = earliest
                latest_ask = _js_min(c["askTimes"])     # lowest idx = most recent
                if earliest_bid > latest_ask:
                    bid_iv = _js_max(c["bidIVs"]) if c["bidIVs"] else 0
                    ask_iv = _js_max(c["askIVs"]) if c["askIVs"] else 0
                    if ask_iv > 0 and ask_iv >= bid_iv:
                        continue
            # Exception 3 — de-escalation: ask first -> bid later with falling IV.
            if c["askTimes"] and c["bidTimes"]:
                earliest_ask = _js_max(c["askTimes"])
                latest_bid = _js_min(c["bidTimes"])
                if earliest_ask > latest_bid:
                    peak_ask_iv = _js_max(c["askIVs"]) if c["askIVs"] else 0
                    late_bid_iv = _js_min(c["bidIVs"]) if c["bidIVs"] else 0
                    if peak_ask_iv > 0 and late_bid_iv > 0 and late_bid_iv < peak_ask_iv:
                        continue
            # Exception 4 — premium dominance.  THRESHOLD IS 0.70, not 0.85:
            # deliberately lowered for Massive ingestion (JSX 1760-1767).
            total_side = c["askPrem"] + c["bidPrem"]
            if total_side > 0:
                if c["askPrem"] / total_side >= 0.70 or c["bidPrem"] / total_side >= 0.70:
                    continue
            dirty.add(k)
            continue
        if len(c["dirs"]) <= 1:
            continue
        is_short_dte = 0 <= c["dte"] <= 14
        if is_short_dte and c["askTimes"] and c["bbSweepTimes"]:
            if _js_min(c["askTimes"]) > _js_max(c["bbSweepTimes"]):
                continue
        dirty.add(k)
    return dirty


# ─────────────────────────────────────────────────────────────────────────────
# CONV cluster builder (buildCharts, JSX 978-1138)
# ─────────────────────────────────────────────────────────────────────────────
_SCORE_MAP = {"A+": 600, "A": 500, "B+": 400, "B": 300, "C": 200, "D": 100}


def _build_conv(clean_confirmed: list[dict], *, today: date) -> list[dict]:
    all_cons: dict[str, dict[str, Any]] = {}
    cons_trades: dict[str, list[dict]] = {}

    for t in clean_confirmed:
        k = _tkey(t)
        c = all_cons.get(k)
        if c is None:
            c = all_cons[k] = {
                "sym": t["S"], "cp": t["CP"], "K": t["K"], "exp": t["E"], "DTE": t["DTE"],
                "stocketf": t["stocketf"], "hits": 0, "prem": 0.0, "vol": 0, "dir": t["D"],
                "hasAA": False, "hasBB": False, "hasSweep": False, "hasBlock": False,
                "oiExceeded": False, "dirs": set(), "clean": True,
                "bullPrem": 0.0, "bearPrem": 0.0, "askPrem": 0.0, "bidPrem": 0.0,
                "dominantOverride": False, "maxOI": 0, "er": bool(t["er"]),
                "uoa": False, "mktcap": t["mktcap"] or 0,
                "ivs": [], "spots": [], "prices": [], "sideTimes": [],
                # Not in the JSX cluster (the page reads sector off the trade
                # rows); carried here so callers get it without a second pass.
                "sector": t["sector"],
            }
            cons_trades[k] = []
        cons_trades[k].append(t)
        c["hits"] += 1
        # PITFALL #8 — accumulate in row order; float adds are order-sensitive
        # and downstream comparisons (>= 0.8, >= 0.70) are exact.
        c["prem"] += t["P"]
        c["vol"] += t["V"]
        if t["D"] == "BULL":
            c["bullPrem"] += t["P"]
        if t["D"] == "BEAR":
            c["bearPrem"] += t["P"]
        if t["Si"] == "AA":
            c["hasAA"] = True
        if t["Si"] == "BB":
            c["hasBB"] = True
        if t["Si"] in ("A", "AA"):
            c["askPrem"] += t["P"]
        if t["Si"] in ("B", "BB"):
            c["bidPrem"] += t["P"]
        if t["Ty"] == "SWP":
            c["hasSweep"] = True
        if t["Ty"] == "BLK":
            c["hasBlock"] = True
        if t["Co"] in ("YELLOW", "MAGENTA"):
            c["oiExceeded"] = True
        if t["D"]:
            c["dirs"].add(t["D"])
        if t["uoa"]:
            c["uoa"] = True
        if t["mktcap"] > c["mktcap"]:
            c["mktcap"] = t["mktcap"]
        if t["OI"] > c["maxOI"]:
            c["maxOI"] = t["OI"]
        if t["IV"] > 0:
            c["ivs"].append(t["IV"])
        if t["Spot"] > 0:
            c["spots"].append(t["Spot"])
        if t["price"] > 0:
            c["prices"].append(t["price"])
        c["sideTimes"].append({"si": t["Si"], "time": t["time"], "prem": t["P"]})

    # Derived oiExceeded pass — runs BEFORE the B-side override (JSX 1016-1018).
    for c in all_cons.values():
        if not c["oiExceeded"] and c["maxOI"] > 0 and c["vol"] > c["maxOI"]:
            c["oiExceeded"] = True

    # B-side conviction override (JSX 1023-1034).
    for c in all_cons.values():
        if not c["dir"] and len(c["dirs"]) == 1:
            c["dir"] = next(iter(c["dirs"]))
        if (not c["dir"] and c["oiExceeded"] and c["hasSweep"] and c["prem"] >= 200000
                and c["bidPrem"] > 0 and c["askPrem"] == 0):
            if c["cp"] == "C":
                c["dir"] = "BULL"
                c["dirs"].add("BULL")
            elif c["cp"] == "P":
                c["dir"] = "BEAR"
                c["dirs"].add("BEAR")

    pre_sort: list[dict] = []
    for c in all_cons.values():
        if not c["dir"]:
            continue
        c["clean"] = len(c["dirs"]) <= 1
        # 80% dominance override — exact comparison on accumulated doubles.
        if not c["clean"]:
            total_dir = c["bullPrem"] + c["bearPrem"]
            if total_dir > 0:
                if c["bullPrem"] / total_dir >= 0.8:
                    c["clean"] = True
                    c["dir"] = "BULL"
                    c["dominantOverride"] = True
                elif c["bearPrem"] / total_dir >= 0.8:
                    c["clean"] = True
                    c["dir"] = "BEAR"
                    c["dominantOverride"] = True
        # Pattern-based oiExceeded (Massive maxOI=0 rescue).
        if (not c["oiExceeded"] and c["maxOI"] == 0 and (c["DTE"] or 0) >= 3
                and c["hasSweep"] and c["hasBlock"] and c["clean"] and c["dir"]
                and c["prem"] >= 2e6):
            c["oiExceeded"] = True

        grade = grade_cluster(c)
        vol_oi = c["vol"] / c["maxOI"] if c["maxOI"] > 0 else 0
        voi_bonus = min(vol_oi, 5) * 80
        k = cluster_key(c["sym"], c["cp"], c["K"], c["exp"])
        trades = sorted(cons_trades.get(k, []), key=lambda t: t["P"], reverse=True)

        # Time concentration: max ASK-side SWEEP prints in any 10-min window.
        time_conc = 0
        ask_ts = sorted(ts for ts in
                        (_parse_ts(t["time"]) for t in trades
                         if t["Ty"] == "SWP" and t["Si"] in ("A", "AA"))
                        if ts >= 0)
        if len(ask_ts) >= 3:
            l, best = 0, 1
            for r in range(len(ask_ts)):
                while ask_ts[r] - ask_ts[l] > 600:
                    l += 1
                if r - l + 1 > best:
                    best = r - l + 1
            time_conc = best

        single_whale_bonus = 250 if (
            c["hits"] <= 1 and c["hasSweep"] and c["askPrem"] > c["bidPrem"]
            and c["oiExceeded"]
            and c["prem"] >= (5e6 if (c["mktcap"] or 0) >= 500e9 else 1e6)
        ) else 0

        out = dict(c)
        out.update({
            "grade": grade,
            "volOI": vol_oi,
            "_timeConc": time_conc,
            "score": (_SCORE_MAP.get(grade, 0) + c["hits"] * 20 + c["prem"] / 5e3
                      + voi_bonus + single_whale_bonus),
            "side": ("AA" if c["hasAA"] else "ASK") if c["askPrem"] >= c["bidPrem"]
                    else ("BB" if c["hasBB"] else "BID"),
            "strike": "$" + js_num(c["K"]) + c["cp"],
            "trades": trades,
            "patterns": detect_patterns(c),
        })
        pre_sort.append(out)

    # Post-score filters (JSX 1096-1109).
    kept: list[dict] = []
    for c in pre_sort:
        if not c["clean"]:
            continue
        if c["DTE"] <= 7 and c["prem"] < 500000:
            continue
        if c["exp"]:
            p = [js_parse_int(x) for x in c["exp"].split("/")]
            if len(p) >= 2 and p[0] == p[0] and p[1] == p[1]:
                if len(p) >= 3 and p[2] == p[2]:
                    y = int(p[2]) + 2000 if p[2] < 100 else int(p[2])
                else:
                    y = today.year + 1 if today.month > p[0] else today.year
                exp_date = _js_date(y, int(p[0]), int(p[1]))
                # JS compares end-of-expiry-day against `now`; with date
                # granularity that is exactly "expiry before today".
                if exp_date is not None and exp_date < today:
                    continue
        kept.append(c)

    # Ticker heat bonus (JSX 1110-1134).
    ticker_heat: dict[str, dict[str, Any]] = {}
    for c in kept:
        th = ticker_heat.get(c["sym"])
        if th is None:
            th = ticker_heat[c["sym"]] = {"contracts": 0, "totalPrem": 0.0,
                                          "strikes": set(), "exps": set(),
                                          "dirs": set(), "grades": []}
        th["contracts"] += 1
        th["totalPrem"] += c["prem"]
        th["strikes"].add(c["K"])
        th["exps"].add(c["exp"])
        th["dirs"].add(c["dir"])
        th["grades"].append(c["grade"])

    conv: list[dict] = []
    for c in kept:
        th = ticker_heat[c["sym"]]
        heat = 0
        if th["contracts"] >= 2:
            heat += min(th["contracts"], 6) * 50
        if len(th["exps"]) >= 2:
            heat += len(th["exps"]) * 40
        if len(th["strikes"]) >= 2:
            heat += len(th["strikes"]) * 20
        if th["totalPrem"] >= 5e6:
            heat += 200
        elif th["totalPrem"] >= 2e6:
            heat += 100
        elif th["totalPrem"] >= 1e6:
            heat += 50
        if len(th["dirs"]) > 1:
            heat = math.floor(heat * 0.3)
        out = dict(c)
        out["score"] = c["score"] + heat
        out["tickerHeat"] = ({"contracts": th["contracts"], "totalPrem": th["totalPrem"],
                              "strikes": len(th["strikes"]), "exps": len(th["exps"])}
                             if th["contracts"] >= 2 else None)
        conv.append(out)

    # JS Array.sort is stable (ES2019+); so is Python's sorted with reverse=True
    # (ties keep original order in BOTH — reverse=True does not reverse ties).
    conv.sort(key=lambda c: c["score"], reverse=True)
    return conv


# ─────────────────────────────────────────────────────────────────────────────
# wlPopulate — top-20 per direction (JSX 3024-3095)
# ─────────────────────────────────────────────────────────────────────────────
def _watchlist(conv: list[dict], direction: str,
               pick_history: Mapping[str, Sequence[Mapping[str, Any]]] | None) -> list[dict]:
    ranked: list[dict] = []
    for c in conv:
        if c["dir"] != direction:
            continue
        # _isExitRaw needs top_flow_picks OI history, which is UI/tracker state.
        # Callers may inject it keyed by tracker_key(); absent it, no pick is
        # found and _isExitRaw is False — identical to the page's behaviour for
        # a contract that isn't being tracked yet.
        hist: Sequence[Mapping[str, Any]] = ()
        if pick_history:
            hist = pick_history.get(tracker_key(c["sym"], c["cp"], c["K"], c["exp"]), ()) or ()
        oi_h = [h for h in hist if (h.get("oi") or 0) > 0]
        cur_oi = oi_h[-1].get("oi") if oi_h else 0
        peak_oi = _js_max([h.get("oi") for h in oi_h]) if oi_h else 0
        is_exit_raw = peak_oi >= 100 and cur_oi > 0 and (peak_oi - cur_oi) / peak_oi * 100 >= 30
        has_accum = c["vol"] > 0 and (c["maxOI"] or 0) > 0 and (c["vol"] / c["maxOI"]) >= 0.3
        is_exit = is_exit_raw and not has_accum
        auto_s = auto_score(c)
        entry = dict(c)
        entry["_isExit"] = is_exit
        entry["_rankScore"] = auto_s * 0.4 if is_exit else auto_s
        ranked.append(entry)

    ranked.sort(key=lambda c: c["_rankScore"], reverse=True)
    # One contract per ticker — highest _rankScore wins (dedupe AFTER the sort).
    seen: set[str] = set()
    deduped = []
    for c in ranked:
        if c["sym"] in seen:
            continue
        seen.add(c["sym"])
        deduped.append(c)
    return [_public_cluster(c) for c in deduped[:20]]


# ─────────────────────────────────────────────────────────────────────────────
# Public cluster shape
# ─────────────────────────────────────────────────────────────────────────────
def _public_cluster(c: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "sym": c["sym"],
        "cp": c["cp"],
        "strike": c["K"],
        "exp": c["exp"],
        "dte": c["DTE"],
        "dir": c["dir"],
        "grade": c["grade"],
        "auto_score": auto_score(c),
        "score": c["score"],
        "hits": c["hits"],
        "prem": c["prem"],
        "ask_prem": c["askPrem"],
        "bid_prem": c["bidPrem"],
        "max_oi": c["maxOI"],
        "vol": c["vol"],
        "vol_oi": c["volOI"],
        "side": c["side"],
        "uoa": bool(c["uoa"]),
        "er": bool(c["er"]),
        "sector": c.get("sector", ""),
        "mktcap": c["mktcap"],
        "cap_band": cap_band(c["mktcap"] or 0),
        "clean": bool(c["clean"]),
        "oi_exceeded": bool(c["oiExceeded"]),
        "is_exit": bool(c.get("_isExit", False)),
        "patterns": c["patterns"],
        "key": cluster_key(c["sym"], c["cp"], c["K"], c["exp"]),
        "tracker_key": tracker_key(c["sym"], c["cp"], c["K"], c["exp"]),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────
def curate(rows: Iterable[Mapping[str, Any]], *, today: date,
           er_soon: set[str] | None = None,
           pick_history: Mapping[str, Sequence[Mapping[str, Any]]] | None = None
           ) -> dict[str, Any]:
    """Run the OptionsFlow curation pipeline over ``rows``.

    Args:
        rows: flow rows, **NEWEST FIRST** (see the module docstring).  Accepts
            flow-table column names (``Symbol``/``CallPut``/...) or the page's
            lower-cased CSV names — both go through :func:`normalize_row`.
        today: the "today" reference for every date computation.  Explicit so
            results are reproducible (PITFALL #10) — nothing reads the clock.
        er_soon: optional set of symbols reporting soon.  When given it drives
            the ``er`` flag; otherwise the row's own ``ER`` column is used.
        pick_history: optional ``{tracker_key: [{"oi": int}, ...]}`` OI history
            from ``top_flow_picks.json``, used only for the watchlist EXIT
            penalty.  Absent -> no contract is flagged as an exit.

    Returns:
        ``{"clusters": [...], "conv": [...], "watchlist_bull": [...],
        "watchlist_bear": [...], "stats": {...}}``.  ``clusters`` and ``conv``
        are the SAME list (the page has exactly one CONV board) — ``conv`` is
        kept as the page's own name for it.  Both are score-sorted descending.
        ``watchlist_*`` are the wlPopulate top-20 per direction, one contract
        per ticker, ranked by autoScore.

    Not ported (UI state that has no server-side equivalent, documented rather
    than guessed): the Stocks/Indexes tab ETF filter, the cap-band filter
    chips, and ``wlCapCheck``'s client-side ``capLookup`` fallback for rows
    with ``mktcap == 0``.  The watchlist here is "all caps, all tickers".
    """
    raw = [_raw_trade(r, i, today=today, er_soon=er_soon) for i, r in enumerate(rows)]

    _apply_blacklists(raw)
    ml_matched = _ml_volume_match(raw)
    canceled = _cancel_pairs(raw)
    _ml_rescue(raw, ml_matched)

    filtered = [t for t in raw
                if not t["isML"] and t["S"] and t["Ty"] and t["CP"] and t["DTE"] >= 0
                and t["V"] > 0 and t["P"] > 0
                and t["_i"] not in canceled and t["_i"] not in ml_matched]

    filtered = _spread_filter(filtered)
    dark_pool = [t for t in filtered if t["Co"] == "ORANGE"]
    filtered = [t for t in filtered if t["Co"] != "ORANGE"]
    filtered = [t for t in filtered if t["Co"] != "ARB"]
    filtered = _deep_filter(filtered)
    filtered = [t for t in filtered if premium_filter(t["P"], t["mktcap"])]

    _block_rescue(filtered)

    confirmed_trades = [t for t in filtered
                        if (t["confirmed"] and t["D"]) or _is_rescuable_whale(t)
                        or t["_rescuedBlock"]]

    dirty = _dirty_cluster_keys(filtered)
    clean_confirmed = [t for t in confirmed_trades if _tkey(t) not in dirty]

    conv_internal = _build_conv(clean_confirmed, today=today)
    clusters = [_public_cluster(c) for c in conv_internal]

    return {
        "clusters": clusters,
        "conv": clusters,
        "watchlist_bull": _watchlist(conv_internal, "BULL", pick_history),
        "watchlist_bear": _watchlist(conv_internal, "BEAR", pick_history),
        "stats": {
            "rows": len(raw),
            "filtered": len(filtered),
            "confirmed": len(confirmed_trades),
            "clean_confirmed": len(clean_confirmed),
            "dark_pool": len(dark_pool),
            "dirty_clusters": len(dirty),
        },
    }
