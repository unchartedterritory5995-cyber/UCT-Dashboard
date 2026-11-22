"""VFP, the pure half: one stock's volume footprint and gaps from its stored daily bars. No I/O, no
clock, no store: lists in, dicts out. `api/services/volume_footprint.py` reads the bars and the held
earnings dates and holds the answers.

Every number here comes from UCT's stored daily bars, split-adjusted prices AND volumes as the store
serves them (the serve-time heal multiplies a pre-split volume by the split's factor), and only from
settled sessions (the caller passes bars up to the session whose evening has begun). A number the
history is too short for is `None` with what it needs, never 0; a session with no volume held is
"not judged", never a session with no volume. Each threshold below is the builder's default (the
owner may change it), and each definition is said on the panel in these words.

1. ACCUMULATION AND DISTRIBUTION (the last 25 and 50 sessions)
   accumulation day  a close at least 0.2% above the session before's close (`AD_MIN_MOVE`, judged
                     before rounding) on volume above the session before's volume
   distribution day  a close at least 0.2% below it on volume above the session before's
   net               accumulation days less distribution days
   not judged        a session whose volume, or the session before's, is not held
   up/down volume    over the last 50 sessions: the volume of every session that closed above the
                     session before's close, over the volume of every session that closed below it
                     (an unchanged close counts in neither). No ratio when a session in the window
                     that moved has no volume held, or nothing closed down.
   Needs 26 (51) sessions: a window of 25 (50) sessions and the close before its first.
2. THE BIGGEST VOLUME DAYS: the 10 highest-volume sessions of the last year (sessions after the same
   calendar day 12 months before the newest, STAT's year; a tie goes to the newer session), largest
   first, each with
     its multiple   its volume over the mean volume of the 50 sessions BEFORE it (the day itself is
                    left out, as STAT's relative volume leaves the newest session out of its base);
                    none when one of those 50 has no volume or fewer than 50 are held
     its change     its close over the session before's close
     close in range where the close sat in the day's range: (close - low) / (high - low), 0% at the
                    low, 100% at the high; none for a day with no range
     earnings       see EARNINGS below
3. POCKET PIVOTS (the published definition): an up day (a close above the session before's) whose
   volume exceeds the largest volume of the down days (a close below its own session before's) among
   the 10 sessions before it, closing above its 10-day moving average (the simple mean of the 10
   closes through that day). Builder's reading: with no down day among those 10 there is nothing to
   exceed, so it is not a pocket pivot; a missing volume on the day or on one of those down days and
   the day is not judged. Every one in the last year, newest first. The first session that can be
   judged is the 12th held (the 10 sessions before it each need their own session before).
4. GAPS: every session whose open is at least 3% (`GAP_MIN`, before rounding) above or below the
   session before's close, over all the history held:
     size           open over the session before's close
     the day        its close over its open
     filled         the first session, the gap session itself included, that traded back to the
                    session before's close: a low at or below it after a gap up, a high at or above
                    it after a gap down; "sessions to fill" counts the sessions after the gap session
                    (0 = filled the same session)
     summary        how many, up and down; of the gaps old enough to say (filled within the window,
                    or at least that many sessions after them), the share filled within 5 and within
                    20 sessions; how many are still open. The newest `GAPS_SHOWN` (60) are listed.
     check          a gap above 40% (`price_reads.SUSPECT_JUMP`), or on a session whose close moved
                    more than 40%, can be a split the history did not adjust: marked, never dropped.
EARNINGS (the biggest volume days, the pocket pivots and the gaps): True when a report date UCT
holds falls on that session, on the session before it, or on a day between the two (a weekend
report); the report's time of day is not held, so a report day and the session after it are both
marked. False only inside the span the held report dates cover completely: from the oldest report
of the newest unbroken run of consecutive fiscal quarters that all carry a report date, to the
newest report, or (when the held page names a later scheduled report) to the day before that date or
the day before the page was built, whichever is earlier. Anywhere else it is None: not known.
"""
from __future__ import annotations

import bisect
from datetime import date, datetime, timedelta
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from api.services import stock_stats_calc as SC

#: accumulation and distribution windows, in sessions
AD_WINDOWS = (25, 50)
#: the least close-to-close move of an accumulation (distribution) day
AD_MIN_MOVE = 0.002
#: the up/down volume ratio's window, in sessions
UPDOWN_SESSIONS = 50
#: the biggest volume days listed
BIG_DAYS = 10
#: a big day's volume against the mean volume of this many sessions before it
AVG_SESSIONS = 50
#: pocket pivots: the sessions looked back over for down days, and the moving average's length
PIVOT_LOOKBACK = 10
PIVOT_MA = 10
#: a gap counts from this size, either way
GAP_MIN = 0.03
#: the fill windows the gap summary reports, in sessions after the gap session
FILL_WINDOWS = (5, 20)
#: the gaps listed, newest first (the summary counts every one)
GAPS_SHOWN = 60
#: "at least" is judged before rounding: a float a hair under a threshold that is really on it still counts
EPS = 1e-9
#: the block size of the fill search (block minima and maxima: a gap never filled costs a few hundred steps)
_BLOCK = 64
_ET = ZoneInfo("America/New_York")


def _short(needed: int, held: int) -> dict:
    return {"state": "short", "needed": needed, "held": held, "unit": "sessions"}


def _iso(v) -> Optional[str]:
    s = str(v or "")[:10]
    try:
        date.fromisoformat(s)
    except ValueError:
        return None
    return s


def mean_volume_before(bars: list[tuple], i: int, k: int = AVG_SESSIONS) -> Optional[float]:
    """The mean volume of the `k` sessions before session `i`: None when fewer are held or one of them
    has no volume (STAT's rule: a missing volume is no average, never a smaller one)."""
    if i < k:
        return None
    vs = [bars[j][5] for j in range(i - k, i)]
    if any(v is None for v in vs):
        return None
    return sum(vs) / k


# ── 1. accumulation and distribution ─────────────────────────────────────────────────────────────

def ad_kind(bars: list[tuple], i: int) -> Optional[str]:
    """'accumulation' | 'distribution' | 'neither' for session `i` (i >= 1), or None when its volume or
    the session before's is not held."""
    p, b = bars[i - 1], bars[i]
    if b[5] is None or p[5] is None:
        return None
    if b[5] > p[5]:
        move = b[4] / p[4] - 1.0
        if move >= AD_MIN_MOVE - EPS:
            return "accumulation"
        if move <= -AD_MIN_MOVE + EPS:
            return "distribution"
    return "neither"


def updown(bars: list[tuple]) -> dict:
    n, k = len(bars), UPDOWN_SESSIONS
    if n < k + 1:
        return {**_short(k + 1, n), "sessions": k}
    up_v = down_v = 0.0
    up = down = flat = missing = 0
    for i in range(n - k, n):
        c, pc, v = bars[i][4], bars[i - 1][4], bars[i][5]
        if c == pc:
            flat += 1
            continue
        if v is None:
            missing += 1
            continue
        if c > pc:
            up, up_v = up + 1, up_v + v
        else:
            down, down_v = down + 1, down_v + v
    ratio = SC.r2(up_v / down_v) if (down_v > 0 and not missing) else None
    return {"state": "ok", "sessions": k, "from": bars[n - k][0], "up_volume": round(up_v), "down_volume": round(down_v),
            "up_sessions": up, "down_sessions": down, "flat_sessions": flat, "no_volume": missing, "ratio": ratio}


def accumulation(bars: list[tuple]) -> dict:
    """Section 1 from `clean_bars` output (ascending)."""
    n = len(bars)
    windows = []
    for k in AD_WINDOWS:
        if n < k + 1:
            windows.append({**_short(k + 1, n), "sessions": k})
            continue
        acc = dist = unjudged = 0
        for i in range(n - k, n):
            kind = ad_kind(bars, i)
            if kind is None:
                unjudged += 1
            elif kind == "accumulation":
                acc += 1
            elif kind == "distribution":
                dist += 1
        windows.append({"state": "ok", "sessions": k, "from": bars[n - k][0], "accumulation": acc,
                        "distribution": dist, "net": acc - dist, "not_judged": unjudged})
    days = []
    for i in range(n - 1, max(0, n - max(AD_WINDOWS) - 1), -1):        # newest first, the widest window
        kind = ad_kind(bars, i) if i >= 1 else None
        if kind not in ("accumulation", "distribution"):
            continue
        p, b = bars[i - 1], bars[i]
        days.append({"date": b[0], "kind": kind, "change_pct": SC.pct(b[4] / p[4] - 1.0), "volume": round(b[5]),
                     "vs_prior": SC.r2(b[5] / p[5]) if p[5] else None, "session": n - i})
    return {"as_of": bars[-1][0], "min_move_pct": SC.pct(AD_MIN_MOVE, 1), "windows": windows, "days": days,
            "updown": updown(bars)}


# ── 2. the biggest volume days ───────────────────────────────────────────────────────────────────

def big_days(bars: list[tuple], flag: Callable[[int], Optional[bool]]) -> dict:
    n = len(bars)
    last = bars[-1][0]
    start = SC.year_start(last)
    pool = [i for i in range(n) if bars[i][0] > start]
    held = [i for i in pool if bars[i][5] is not None]
    top = sorted(held, key=lambda i: (-bars[i][5], -i))[:BIG_DAYS]   # a tie goes to the newer session
    rows, moves = [], []
    for i in top:
        d, _o, h, lo, c, v = bars[i]
        avg = mean_volume_before(bars, i)
        move = c / bars[i - 1][4] - 1.0 if i else None
        moves.append(move)
        rows.append({"date": d, "volume": round(v), "avg_volume": None if avg is None else round(avg),
                     "vs_avg": SC.r2(v / avg) if avg else None, "change_pct": SC.pct(move),
                     "close_in_range_pct": round((c - lo) / (h - lo) * 100.0, 1) if h > lo else None,
                     "earnings": flag(i)})
    return {
        "as_of": last, "from": start, "full_year": bars[0][0] <= start, "held_from": bars[0][0],
        "sessions": len(pool), "no_volume": len(pool) - len(held), "listed": BIG_DAYS, "avg_sessions": AVG_SESSIONS,
        "rows": rows,
        "summary": {"up": sum(1 for m in moves if m is not None and m > 0), "down": sum(1 for m in moves if m is not None and m < 0),
                    "earnings": sum(1 for r in rows if r["earnings"] is True),
                    "earnings_unknown": sum(1 for r in rows if r["earnings"] is None)},
    }


# ── 3. pocket pivots ─────────────────────────────────────────────────────────────────────────────

def pocket_pivots(bars: list[tuple], flag: Callable[[int], Optional[bool]]) -> dict:
    n = len(bars)
    last = bars[-1][0]
    start = SC.year_start(last)
    first_i = PIVOT_LOOKBACK + 1
    base = {"as_of": last, "from": start, "full_year": bars[0][0] <= start, "held_from": bars[0][0],
            "lookback": PIVOT_LOOKBACK, "ma": PIVOT_MA}
    if n <= first_i:
        return {**base, **_short(first_i + 1, n)}
    rows, up_days, unjudged = [], 0, 0
    for i in range(first_i, n):
        d, _o, _h, _l, c, v = bars[i]
        if d <= start or not c > bars[i - 1][4]:
            continue
        up_days += 1
        downs = [bars[j][5] for j in range(i - PIVOT_LOOKBACK, i) if bars[j][4] < bars[j - 1][4]]
        if v is None or any(x is None for x in downs):
            unjudged += 1
            continue
        if not downs:
            continue
        top = max(downs)
        ma = sum(b[4] for b in bars[i - PIVOT_MA + 1:i + 1]) / PIVOT_MA
        if v > top and c > ma:
            rows.append({"date": d, "change_pct": SC.pct(c / bars[i - 1][4] - 1.0), "volume": round(v),
                         "down_max": round(top), "vs_down_max": SC.r2(v / top) if top else None,
                         "ma": SC.r2(ma, 4), "above_ma_pct": SC.pct(c / ma - 1.0), "earnings": flag(i)})
    rows.reverse()
    first_in_year = next((b[0] for b in bars if b[0] > start), last)
    return {**base, "state": "ok", "judged_from": max(bars[first_i][0], first_in_year),
            "count": len(rows), "up_days": up_days, "not_judged": unjudged,
            "earnings": sum(1 for r in rows if r["earnings"] is True), "rows": rows}


# ── 4. gaps ──────────────────────────────────────────────────────────────────────────────────────

def _blocks(values: list[float], pick) -> list[float]:
    return [pick(values[k:k + _BLOCK]) for k in range(0, len(values), _BLOCK)]


def first_at_or_below(lows: list[float], mins: list[float], start: int, target: float) -> Optional[int]:
    """The first index from `start` whose low is at or below `target` (`mins`: each block's minimum)."""
    n, j = len(lows), start
    end = min(n, (j // _BLOCK + 1) * _BLOCK)
    while j < end:
        if lows[j] <= target:
            return j
        j += 1
    if j >= n:                                     # the last block held: never re-enter it from its start
        return None
    b = j // _BLOCK
    while b < len(mins) and mins[b] > target:
        b += 1
    if b >= len(mins):
        return None
    for j in range(b * _BLOCK, min(n, b * _BLOCK + _BLOCK)):
        if lows[j] <= target:
            return j
    return None


def first_at_or_above(highs: list[float], maxes: list[float], start: int, target: float) -> Optional[int]:
    """The first index from `start` whose high is at or above `target` (`maxes`: each block's maximum)."""
    n, j = len(highs), start
    end = min(n, (j // _BLOCK + 1) * _BLOCK)
    while j < end:
        if highs[j] >= target:
            return j
        j += 1
    if j >= n:                                     # the last block held: never re-enter it from its start
        return None
    b = j // _BLOCK
    while b < len(maxes) and maxes[b] < target:
        b += 1
    if b >= len(maxes):
        return None
    for j in range(b * _BLOCK, min(n, b * _BLOCK + _BLOCK)):
        if highs[j] >= target:
            return j
    return None


def _fill_side(found: list[tuple], n: int, flags: dict) -> dict:
    out = {"count": len(found), "open": sum(1 for g in found if g[3] is None)}
    for w in FILL_WINDOWS:
        judged = [g for g in found if (g[3] is not None and g[3] - g[0] <= w) or n - 1 - g[0] >= w]
        filled = sum(1 for g in judged if g[3] is not None and g[3] - g[0] <= w)
        out[f"within_{w}"] = {"filled": filled, "judged": len(judged),
                              "pct": SC.pct(filled / len(judged), 1) if judged else None}
    out["earnings"] = sum(1 for g in found if flags[g[0]] is True)
    out["earnings_known"] = sum(1 for g in found if flags[g[0]] is not None)
    return out


def gaps(bars: list[tuple], flag: Callable[[int], Optional[bool]], jumps: list[str]) -> dict:
    n = len(bars)
    base = {"as_of": bars[-1][0], "first": bars[0][0], "min_gap_pct": SC.pct(GAP_MIN, 1), "windows": list(FILL_WINDOWS),
            "shown_max": GAPS_SHOWN}
    if n < 2:
        return {**base, **_short(2, n)}
    lows, highs = [b[3] for b in bars], [b[2] for b in bars]
    mins, maxes = _blocks(lows, min), _blocks(highs, max)
    found = []                                     # (index, gap, up, fill index or None)
    for i in range(1, n):
        prior = bars[i - 1][4]
        g = bars[i][1] / prior - 1.0
        if abs(g) < GAP_MIN - EPS:
            continue
        up = g > 0
        j = first_at_or_below(lows, mins, i, prior) if up else first_at_or_above(highs, maxes, i, prior)
        found.append((i, g, up, j))
    flags: dict[int, Optional[bool]] = {g[0]: flag(g[0]) for g in found}
    jumped = set(jumps)
    rows = []
    for i, g, up, j in reversed(found[-GAPS_SHOWN:]):
        d, o, _h, _l, c, _v = bars[i]
        rows.append({"date": d, "up": up, "gap_pct": SC.pct(g), "prior_date": bars[i - 1][0], "prior_close": SC.r2(bars[i - 1][4], 4),
                     "open": SC.r2(o, 4), "close": SC.r2(c, 4), "close_vs_open_pct": SC.pct(c / o - 1.0),
                     "filled": bars[j][0] if j is not None else None, "sessions_to_fill": j - i if j is not None else None,
                     "sessions_since": n - 1 - i, "earnings": flags[i],
                     "check": abs(g) > SC.SUSPECT_JUMP or d in jumped})
    return {**base, "state": "ok", "total": len(found), "shown": len(rows), "rows": rows,
            "summary": {"all": _fill_side(found, n, flags), "up": _fill_side([g for g in found if g[2]], n, flags),
                        "down": _fill_side([g for g in found if not g[2]], n, flags)}}


# ── earnings ─────────────────────────────────────────────────────────────────────────────────────

def _quarter_key(q: dict) -> Optional[tuple[int, int]]:
    fy, fq = q.get("fiscal_year"), q.get("fiscal_quarter")
    if type(fy) is not int or type(fq) is not int or not 1 <= fq <= 4:
        return None
    return fy, fq


def _quarter_before(key: tuple[int, int]) -> tuple[int, int]:
    fy, fq = key
    return (fy, fq - 1) if fq > 1 else (fy - 1, 4)


def _built_day(payload: dict) -> Optional[str]:
    """The New York calendar day the held earnings page was built (its `meta.retrieved_at`)."""
    meta = payload.get("meta")
    ts = meta.get("retrieved_at") if isinstance(meta, dict) else None
    if type(ts) not in (int, float) or not ts > 0:
        return None
    try:
        return datetime.fromtimestamp(ts, _ET).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def earnings_index(payload) -> Optional[dict]:
    """`{dates, cover, next, built}` from the held earnings page, or None when it holds no report date.
    `dates`: every reported quarter's report date, ascending. `cover`: `{from, through, quarters}`, the
    span inside which a session with no report date beside it is known to have had none (see the module
    docstring), or None."""
    if not isinstance(payload, dict):
        return None
    reported = [q for q in payload.get("quarters") or () if isinstance(q, dict) and q.get("reported") is True]
    dates = sorted({d for d in (_iso(q.get("report_date")) for q in reported) if d})
    if not dates:
        return None
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    nxt = _iso(summary.get("next_report_date") or payload.get("next_report_date"))
    built = _built_day(payload)
    keyed = [(_quarter_key(q), _iso(q.get("report_date"))) for q in reported]
    cover = None
    if all(k is not None for k, _d in keyed):
        run, prev = [], None
        for k, d in sorted(keyed, key=lambda kd: kd[0], reverse=True):     # newest fiscal quarter first
            if d is None or (prev is not None and k != _quarter_before(prev)):
                break
            run.append(d)
            prev = k
        if run:
            newest = max(run)
            through = newest
            if nxt and built and nxt > newest:
                day_before = lambda s: (date.fromisoformat(s) - timedelta(days=1)).isoformat()   # noqa: E731
                through = max(newest, min(day_before(nxt), day_before(built)))
            cover = {"from": min(run), "through": through, "quarters": len(run)}
    return {"dates": dates, "cover": cover, "next": nxt, "built": built}


def earnings_flagger(bars: list[tuple], index: Optional[dict]) -> Callable[[int], Optional[bool]]:
    """`flag(i)` for session `i` of `bars`: True | False | None (see the module docstring)."""
    if not index:
        return lambda i: None
    dates, cover = index["dates"], index.get("cover")

    def flag(i: int) -> Optional[bool]:
        d = bars[i][0]
        lo = bars[i - 1][0] if i > 0 else d
        k = bisect.bisect_left(dates, lo)
        if k < len(dates) and dates[k] <= d:
            return True
        if cover and cover["from"] <= lo and d <= cover["through"]:
            return False
        return None
    return flag
