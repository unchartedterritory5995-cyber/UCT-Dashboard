"""Where one Breadth Monitor reading sits in its history — the drill window's reading strip and
its History drawer (`GET /api/breadth-monitor/reading`).

For (universe, metric, date) it answers, from the PRE-BUILT history only:

  • the percentile, and the level + tone the Monitor cell is shaded with. The level is the
    shading rule itself (`breadth_shade_rule.shade` over the frozen cutoffs, so it can never
    disagree with the cell); the percentile ranks the SAME value the rule ranks — a count column's
    share of `universe_count` (`per`), a signed column's raw value — over the calibration window
    (2008-01-02 on, NYSE from its own 2009 start);
  • how many sessions were at or beyond this reading, and the last one before it;
  • what the S&P 500 did next after SIMILAR readings, at +5 / +20 / +60 sessions, beside the
    same numbers over EVERY session in the window (the baseline);
  • the five closest past readings, the 20-day average and the streak.

⭐ SIMILAR = within ±2.5 percentile points of the reading, or the nearest 30 sessions by value
when that band holds fewer than 30 — whichever set is LARGER. The answer names the one it used.

⭐ THE S&P SERIES. The Monitor's `sp500_close` exists only on the collector's own sessions (2026),
so the forward moves are read from SPY's daily closes in the local bars store (the S&P 500 ETF,
2003 on); a session with no SPY bar gives no forward move. Falls back to `sp500_close` when the
store has no SPY bars at all.

⛔ COST. Nothing heavy runs per request: on first use of a (universe, metric) the history is
turned into sorted arrays once and kept in a small LRU keyed by the STORE TOKEN (the UCT session
index + authority, or the universe store's build version), so a new session or a rebuild is a new
key and the old entry ages out. Builds are single-flighted per key.

⛔ PRIVACY. This returns real readings to the member's browser (a paid route). Tests and tools
must check shapes, counts and booleans, never print values.
"""
from __future__ import annotations

import bisect
import os
import statistics
import threading
from collections import OrderedDict
from typing import Optional

from api.services import breadth_shade_rule as rule

HORIZONS = (5, 20, 60)
BAND_PTS = 2.5
MIN_SIMILAR = 30
SMALL_N = 20
CLOSEST_N = 5
#: A closest day this many sessions from the reading (or from one already picked) is skipped, so
#: the five are five different episodes rather than five days of one.
CLOSEST_GAP = 5
SPARK_N = 252
AVG_N = 20

_LRU_MAX = 48
_ROWS_MAX = 4

_series_lru: "OrderedDict[tuple, dict]" = OrderedDict()
_rows_lru: "OrderedDict[tuple, list]" = OrderedDict()
_spy: dict = {"token": None, "data": None}
_lock = threading.Lock()
_flights: dict = {}


class NoReading(Exception):
    """The metric has no history to rank on this universe (or the date has no reading)."""


# ── sources ───────────────────────────────────────────────────────────────────────
def _dev_exports() -> tuple:
    """Local dev only: UCT's long window from the read-only production exports (the same files the
    calibration reads), when BREADTH_READING_UCT_DEEP / _BACKTEST point at them."""
    deep = os.environ.get("BREADTH_READING_UCT_DEEP", "")
    bt = os.environ.get("BREADTH_READING_UCT_BACKTEST", "")
    if deep and bt and os.path.exists(deep) and os.path.exists(bt):
        return deep, bt
    return None, None


def basis_universe(universe: str, metric: str) -> str:
    """A market-wide column is the same reading everywhere: ranked on UCT's history."""
    return "uct" if universe == "uct" or metric in rule.MARKET_WIDE_COLS else universe


def store_token(universe: str) -> str:
    """Cheap identity of the history a universe's arrays were built from."""
    if universe == "uct":
        deep, bt = _dev_exports()
        if deep:
            return f"dev|{os.stat(deep).st_mtime_ns}|{os.stat(bt).st_mtime_ns}"
        from api.services import breadth_monitor as svc
        ds = svc.merged_dates()
        return f"uct|{len(ds)}|{ds[-1] if ds else ''}{svc._authority_suffix()}"
    from api.services import breadth_universe_monitor as bum
    return f"{universe}|{bum.version(universe)}"



def _load_rows(universe: str) -> list:
    """ASC rows of the universe's full stored history within the window."""
    if universe == "uct":
        # ⭐ (2026-11-22) the rows the Monitor SHOWS, with nothing laid over them: the reading ranks
        # exactly the value the cell displays. (The V2 `uct_backtest` overlay this used to apply
        # is today's list run backward, and it replaced values the cell never showed.)
        deep, _bt = _dev_exports()
        if deep:
            deep_rows = rule.read_export(deep)
        else:
            from api.services import breadth_monitor as svc
            deep_rows = svc.get_history_deep(8000)
        by = {r["date"]: r for r in deep_rows if r.get("date") and not r.get("_live")}
        rows = [by[d] for d in sorted(by)]
    else:
        from api.services import breadth_universe_monitor as bum
        ds = bum.dates(universe)
        by = bum.rows_for_dates(universe, ds)
        rows = [dict(by[d], date=d) for d in ds if d in by]
    return [r for r in rows if r.get("date") and r["date"] >= rule.WINDOW_FLOOR]


def _rows_for(universe: str, token: str) -> list:
    key = (universe, token)
    with _lock:
        hit = _rows_lru.get(key)
        if hit is not None:
            _rows_lru.move_to_end(key)
            return hit
    rows = _load_rows(universe)
    with _lock:
        _rows_lru[key] = rows
        while len(_rows_lru) > _ROWS_MAX:
            _rows_lru.popitem(last=False)
    return rows


def _spy_closes(fallback_rows: list) -> tuple:
    """(ascending session dates, {date: close}) for the S&P 500, plus the basis label."""
    try:
        from api.services import local_bars
        bars = local_bars.read_bars("SPY", local_bars.DAILY_TF, 8000) or []
    except Exception:
        bars = []
    tok = (len(bars), bars[-1]["t"] if bars else None)
    if _spy["token"] == tok and _spy["data"] is not None:
        return _spy["data"]
    closes: dict = {}
    for b in bars:
        t = str(b.get("t") or "")
        c = rule.numeric(b.get("c"))
        if len(t) == 8 and c and c > 0:
            closes[f"{t[:4]}-{t[4:6]}-{t[6:]}"] = c
    basis = "SPY daily close"
    if not closes:
        basis = "S&P 500 close"
        for r in fallback_rows:
            c = rule.numeric(r.get("sp500_close"))
            if c and c > 0:
                closes[r["date"]] = c
    data = (sorted(closes), closes, basis)
    if bars:
        _spy.update(token=tok, data=data)
    return data


# ── the per-(universe, metric) arrays ────────────────────────────────────────────
def _rank_of(c: Optional[dict], metric: str, row: dict):
    """The value the shading ranks (shading.js `shadeValue`); the raw value with no spec."""
    if c is None:
        return rule.numeric(row.get(metric))
    if c.get("kind") == "flag":
        return None
    if c.get("kind") == "pair":
        return rule.numeric(row.get(metric))
    return rule.shade_value(c, c.get("basis") or metric, row)


def _forward(dates_spy: list, closes: dict, d: str) -> dict:
    i = bisect.bisect_left(dates_spy, d)
    if i >= len(dates_spy) or dates_spy[i] != d:
        return {}
    base = closes[dates_spy[i]]
    out = {}
    for h in HORIZONS:
        j = i + h
        if j < len(dates_spy):
            out[h] = (closes[dates_spy[j]] / base - 1.0) * 100.0
    return out


def build_series(universe: str, metric: str, rows: list, spec: dict, spy: tuple) -> dict:
    """The sorted arrays one (universe, metric) answers from. Pure: tests feed synthetic rows."""
    c = spec["cols"].get(metric)
    dates, ranks, disp = [], [], []
    for r in rows:
        # ⛔ a back-tested UCT session (today's list run backward) is neither ranked nor ranked
        # against: its date has no reading, and the window is UCT's real sessions only.
        if rule.is_backtested_cell(metric, r, universe):
            continue
        v = _rank_of(c, metric, r)
        if v is None:
            continue
        dates.append(r["date"])
        ranks.append(v)
        disp.append(rule.numeric(r.get(metric)))   # what the cell shows
    if len(ranks) < 20:
        raise NoReading(metric)
    srt = sorted(ranks)
    n = len(srt)
    pct = [bisect.bisect_right(srt, v) / n * 100.0 for v in ranks]
    dates_spy, closes, basis = spy
    fwd = [_forward(dates_spy, closes, d) for d in dates]
    base = {}
    for h in HORIZONS:
        xs = [f[h] for f in fwd if h in f]
        base[h] = _stats(xs)
    return {"dates": dates, "ranks": ranks, "disp": disp, "sorted": srt, "pct": pct, "fwd": fwd,
            "baseline": base, "basis": basis, "row_by_date": {r["date"]: r for r in rows}}


def _stats(xs: list) -> dict:
    if not xs:
        return {"median": None, "higher": None, "n": 0}
    return {"median": round(statistics.median(xs), 2),
            "higher": round(100.0 * sum(1 for x in xs if x > 0) / len(xs)),
            "n": len(xs)}


def series_for(universe: str, metric: str) -> dict:
    """The cached arrays for (universe, metric), built once per store token."""
    token = store_token(universe)
    key = (universe, metric, token)
    with _lock:
        hit = _series_lru.get(key)
        if hit is not None:
            _series_lru.move_to_end(key)
            return hit
        ev = _flights.get(key)
        leader = ev is None
        if leader:
            ev = _flights[key] = threading.Event()
    if not leader:
        ev.wait(120)
        with _lock:
            hit = _series_lru.get(key)
        if hit is not None:
            return hit
    try:
        rows = _rows_for(universe, token)
        s = build_series(universe, metric, rows, rule.load_spec(), _spy_closes(rows))
        with _lock:
            _series_lru[key] = s
            while len(_series_lru) > _LRU_MAX:
                _series_lru.popitem(last=False)
        return s
    finally:
        if leader:
            with _lock:
                _flights.pop(key, None)
            ev.set()


def clear_cache() -> None:
    with _lock:
        _series_lru.clear()
        _rows_lru.clear()
        _spy.update(token=None, data=None)


# ── one reading ──────────────────────────────────────────────────────────────────
def _side_share(s: dict, v: float, side: str) -> float:
    """% of sessions at or beyond `v` on `side`."""
    n = len(s["sorted"])
    if side == "high":
        return 100.0 * (n - bisect.bisect_left(s["sorted"], v)) / n
    return 100.0 * bisect.bisect_right(s["sorted"], v) / n


def _band_of(share: float) -> Optional[float]:
    for t in (3, 10, 25):
        if share <= t:
            return t
    return None


def answer(s: dict, *, universe: str, metric: str, date: str, row: Optional[dict] = None,
           spec: Optional[dict] = None, cut: Optional[dict] = None) -> dict:
    """The reading's answer from the arrays. `row` (a live reading not in history yet) overrides
    the stored row for `date`."""
    spec = spec or rule.load_spec()
    c = spec["cols"].get(metric)
    i = bisect.bisect_left(s["dates"], date)
    in_hist = i < len(s["dates"]) and s["dates"][i] == date
    if row is None:
        if not in_hist:
            raise NoReading(date)
        row = s["row_by_date"].get(date) or {}
    v = _rank_of(c, metric, row)
    if v is None:
        raise NoReading(date)
    shown = rule.numeric(row.get(metric))
    n = len(s["sorted"])
    pct = bisect.bisect_right(s["sorted"], v) / n * 100.0
    side = "high" if pct >= 50 else "low"
    share = _side_share(s, v, side)
    sh = rule.shade(row, metric, spec, cut, universe) if (c and cut) else None
    level = sh[1] if sh else 0
    tone = sh[0] if sh else None
    typical = not level and 25.0 <= pct <= 75.0

    # at or beyond, and the last such session BEFORE this one
    end = i if in_hist else bisect.bisect_left(s["dates"], date)
    if side == "high":
        beyond = [k for k in range(len(s["dates"])) if s["ranks"][k] >= v]
    else:
        beyond = [k for k in range(len(s["dates"])) if s["ranks"][k] <= v]
    before = [k for k in beyond if k < end]
    last = s["dates"][before[-1]] if before else None

    # similar: ±BAND_PTS percentile points, or the nearest MIN_SIMILAR — whichever is larger
    others = [k for k in range(len(s["dates"])) if s["dates"][k] != date]
    band = [k for k in others if abs(s["pct"][k] - pct) <= BAND_PTS]
    nearest = sorted(others, key=lambda k: (abs(s["ranks"][k] - v), -k))[:MIN_SIMILAR]
    if len(band) >= len(nearest):
        rule_used, sim = "band", band
    else:
        rule_used, sim = "nearest", nearest
    fwd_sim = {}
    for h in HORIZONS:
        fwd_sim[h] = _stats([s["fwd"][k][h] for k in sim if h in s["fwd"][k]])
    n_sim = fwd_sim[HORIZONS[0]]["n"]

    # the five closest, as five different episodes
    picked: list = []
    for k in sorted(others, key=lambda k: (abs(s["ranks"][k] - v), -k)):
        if in_hist and abs(k - i) < CLOSEST_GAP:
            continue
        if any(abs(k - p) < CLOSEST_GAP for p in picked):
            continue
        picked.append(k)
        if len(picked) == CLOSEST_N:
            break
    closest = [{"date": s["dates"][k], "value": s["disp"][k], "percentile": round(s["pct"][k], 1),
                "fwd20": round(s["fwd"][k][20], 2) if 20 in s["fwd"][k] else None} for k in picked]

    # context: the 20 sessions before, and the streak in this reading's band
    prev = [s["disp"][k] for k in range(max(0, end - AVG_N), end) if s["disp"][k] is not None]
    avg = sum(prev) / len(prev) if len(prev) >= 5 else None
    band_t = _band_of(share)
    streak = 1
    k = end - 1
    while k >= 0:
        rv = s["ranks"][k]
        if band_t is not None:
            ok = _side_share(s, rv, side) <= band_t
        else:
            p = s["pct"][k]
            ok = 25.0 <= p <= 75.0
        if not ok:
            break
        streak += 1
        k -= 1

    lo = max(0, end - SPARK_N + (0 if in_hist else 1))
    spark_d = s["dates"][lo:end + (1 if in_hist else 0)]
    spark_v = s["disp"][lo:end + (1 if in_hist else 0)]
    if not in_hist:
        spark_d = spark_d + [date]
        spark_v = spark_v + [shown]

    start = s["dates"][0]
    return {
        "ok": True,
        "universe": universe,
        "metric": metric,
        "date": date,
        "in_history": in_hist,
        "value": shown,
        "rank": {"by": "share" if (c and c.get("per")) else "value",
                 "per": c.get("per") if c else None,
                 "signed": bool(c and c.get("zero"))},
        "window": {"start": start, "end": s["dates"][-1], "sessions": n,
                   "years": _years(start, s["dates"][-1])},
        "percentile": round(pct, 1),
        "side": side,
        "share": round(share, 1),
        "level": level,
        "level_word": rule.LEVEL_WORDS.get(level),
        "tone": tone,
        "typical": typical,
        "beyond": {"count": len(beyond), "last_date": last},
        "similar": {"rule": rule_used, "band_pts": BAND_PTS, "min_n": MIN_SIMILAR, "n": len(sim),
                    "small": n_sim < SMALL_N},
        "forward": {"basis": s["basis"], "horizons": list(HORIZONS),
                    "similar": {str(h): fwd_sim[h] for h in HORIZONS},
                    "baseline": {str(h): s["baseline"][h] for h in HORIZONS}},
        "closest": closest,
        "context": {"avg20": round(avg, 4) if avg is not None else None,
                    "streak": {"days": streak, "band": band_t, "side": side if band_t else "middle"}},
        "series": {"dates": spark_d, "values": spark_v},
    }


def _years(a: str, b: str) -> int:
    from datetime import date as _d
    return max(1, round((_d.fromisoformat(b) - _d.fromisoformat(a)).days / 365.25))


def reading(universe: str, metric: str, date: str, live_row: Optional[dict] = None) -> dict:
    """The route's whole answer. `live_row` (the cell's own number) is ranked in place of the stored row."""
    bu = basis_universe(universe, metric)
    s = series_for(bu, metric)
    cut = rule.cutoffs_for(universe, metric)
    # The level is the CELL's: a market-wide column is shaded by UCT's cutoffs with UCT's floors.
    out = answer(s, universe=bu, metric=metric, date=date, row=live_row, cut=cut)
    out["universe"] = universe
    out["basis_universe"] = bu
    return out
