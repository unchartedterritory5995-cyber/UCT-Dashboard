"""Historical market-breadth reads for UCT Agent (Breadth Slice 1) — US / NYSE / Nasdaq, end of day.

⭐ REUSE, NOT A SECOND ENGINE. Every value comes from the functions the member's breadth charts
already use: `breadth_symbols.resolve` / `symbol_for` (which series exist and are PUBLISHED),
`breadth_symbols.availability` (which sessions are FINALIZED, per universe authority) and
`breadth_symbols.build_breadth_bars` (the served daily series, cache-first). Units and labels come
from `breadth_metrics`. Nothing is recomputed here — this module only selects sessions, aligns
dates and summarises what the canonical series already holds.

⛔ LOCAL ONLY. The result of `read()` is rendered for the member by `breadth_answer` and must never be
sent to a model (owner decision 2026-10-11, LOCAL-RESULT-BOUNDARY-CONTRACT.md). This module imports
no model client and makes no network call of its own.

⛔ FINALIZED END-OF-DAY ONLY (owner D5). The served series appends provisional / live sessions after
the sealed watermark; those are DROPPED here, never substituted. The watermark (`availability()[u]
["last"]`) is trusted only when the universe answers from its authority (`authority` present —
confirmed by the Breadth owner 2026-10-11); without it the read is refused as unavailable rather
than risk presenting a provisional value as final.

`read()` never raises: every outcome is an `ok` / `partial` / `refused` / `unavailable` dict.
"""
from __future__ import annotations

import concurrent.futures as _cf
import math
from datetime import date as _date, timedelta as _td
from typing import Any, Optional

from api.services import breadth_metrics as _bm
from api.services import breadth_symbols as _bs
from api.services import breadth_universes as _bu

SLICE1_UNIVERSES = ("us", "nyse", "nasdaq")
SLICE1_METRICS = (
    "pct_above_5sma", "pct_above_10sma", "pct_above_20sma", "pct_above_40sma", "pct_above_50sma",
    "pct_above_100sma", "pct_above_150sma", "pct_above_200sma",
    "new_52w_highs", "new_52w_lows", "net_new_high_low", "hi_ratio", "lo_ratio",
    "new_20d_highs", "new_20d_lows", "near_52w_high",
    "up_4pct_today", "down_4pct_today", "ratio_5day", "ratio_10day",
    "adv_decline", "advancing", "declining", "universe_count",
    "stage2_count", "stage4_count",
)
MODES = ("value", "compare", "series")

MAX_METRICS = 4
MAX_RANGE_SESSIONS = 4700          # the existing /api/breadth-monitor/series span cap
SAMPLE_POINTS = 20
DEADLINE_S = 2.5
FULL_HISTORY_BARS = 8000           # > every universe's history (US daily since 2008 ≈ 4,700 sessions)

SOURCE_SERVICE = "breadth_symbols.build_breadth_bars"
DATA_CLASS = "UCT-computed from Massive end-of-day prices; multi-security breadth"

_pool = _cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="mi-breadth")

#: ≤ ~600 chars for the Agent capability hint: what each metric key MEANS. Words only — no values.
METRIC_GUIDE = (
    "pct_above_{5,10,20,40,50,100,150,200}sma = % of stocks above that N-day simple MA; "
    "new_52w_highs/new_52w_lows = counts at 52-week highs/lows; net_new_high_low = highs minus lows; "
    "hi_ratio/lo_ratio = % of stocks at 52-week highs/lows; new_20d_highs/new_20d_lows = 20-day; "
    "near_52w_high = within 5% of 52w high; up_4pct_today/down_4pct_today = up/down 4%+ that day; "
    "ratio_5day/ratio_10day = up-4%/down-4% ratio over 5/10 days; "
    "adv_decline = net advancers; advancing/declining = issues up/down; universe_count = stocks counted; "
    "stage2_count/stage4_count = Stage 2 uptrend / Stage 4 downtrend counts."
)


# ── validation ────────────────────────────────────────────────────────────────

def _parse_date(s: Any) -> Optional[str]:
    """A real calendar date as YYYY-MM-DD, or None. `2024-02-30` and `10/09/2026` are not dates."""
    if not isinstance(s, str) or len(s) != 10:
        return None
    try:
        return _date.fromisoformat(s).isoformat()
    except ValueError:
        return None


def _refused(reason: str, detail: str, **extra) -> dict:
    return {"status": "refused", "reason": reason, "detail": detail, **extra}


def _unavailable(reason: str, detail: str, **extra) -> dict:
    return {"status": "unavailable", "reason": reason, "detail": detail, **extra}


def validate(req: Any) -> tuple[Optional[dict], Optional[dict]]:
    """(normalised request, None) or (None, refusal). Shape and bounds only — no data is read.

    ⛔ BOUNDARY CONTRACT (Agent turn.py relies on it): validate() is PURE and VALUE-FREE. It reads no
    store, calls no service, and its output holds only the mode/universe/metric enums and ISO dates
    copied from the request — never a breadth value. The Agent rebuilds a history note ("the member
    asked for …") from it; if this ever reads data or echoes free text, that note could leak."""
    if not isinstance(req, dict):
        return None, _refused("bad_request", "The breadth request was not understood.")
    if "from" in req or "to" in req:
        return None, _refused("bad_request", "Use `start` / `end` for a date range.")
    mode = req.get("mode")
    if mode not in MODES:
        return None, _refused("bad_request", "Ask for a value on a date, a comparison of two dates, or a date range.")
    universe = str(req.get("universe") or "").strip().lower()
    if universe not in SLICE1_UNIVERSES:
        return None, _refused("unsupported_universe",
                              "Breadth answers here cover US, NYSE and Nasdaq stocks only.", universe=universe or None)
    metrics = req.get("metrics")
    if not isinstance(metrics, list) or not metrics:
        return None, _refused("bad_request", "Name at least one breadth measure.", universe=universe)
    seen: list[str] = []
    for m in metrics:
        if m not in seen:
            seen.append(m)
    if len(seen) > MAX_METRICS:
        return None, _refused("too_many_metrics", f"Ask for at most {MAX_METRICS} breadth measures at once.",
                              universe=universe)
    unknown = [m for m in seen if m not in SLICE1_METRICS]
    if unknown:
        return None, _refused("unknown_metric", "That breadth measure isn't available here.",
                              universe=universe, metrics=unknown)
    out = {"mode": mode, "universe": universe, "metrics": seen}
    if mode == "value":
        d = req.get("date")
        if d is not None and _parse_date(d) is None:
            return None, _refused("bad_date", "Dates must be real calendar dates (YYYY-MM-DD).", universe=universe)
        if req.get("start") is not None or req.get("end") is not None or req.get("compare_date") is not None:
            return None, _refused("bad_request", "A single-date question takes one date only.", universe=universe)
        out["date"] = _parse_date(d) if d else None
    elif mode == "compare":
        d1, d2 = req.get("date"), req.get("compare_date")
        if d2 is None or _parse_date(d2) is None or (d1 is not None and _parse_date(d1) is None):
            return None, _refused("bad_date", "A comparison needs two real calendar dates (YYYY-MM-DD); "
                                              "the first may be left out to mean the latest session.",
                                  universe=universe)
        out["date"], out["compare_date"] = (_parse_date(d1) if d1 else None), _parse_date(d2)
    else:
        f, t = req.get("start"), req.get("end")
        if _parse_date(f) is None or (t is not None and _parse_date(t) is None):
            return None, _refused("bad_date", "A date range needs a real start date (YYYY-MM-DD); "
                                              "the end may be left out to mean the latest session.",
                                  universe=universe)
        out["start"], out["end"] = _parse_date(f), (_parse_date(t) if t else None)
        if out["end"] and out["end"] < out["start"]:
            return None, _refused("bad_date", "The range ends before it starts.", universe=universe)
    return out, None


# ── canonical reads ───────────────────────────────────────────────────────────

def _coverage(universe: str) -> tuple[Optional[dict], Optional[dict]]:
    """The universe's finalized coverage, or a refusal/unavailable. Trusted only under its authority."""
    try:
        row = (_bs.availability() or {}).get(universe)
    except Exception:
        row = None
    if not row:
        return None, _refused("universe_not_enabled",
                              f"{_bu.label(universe)} breadth isn't available right now.", universe=universe)
    if not row.get("authority"):
        # The fallback store can include provisional rows, so its "last" is not a finalized watermark.
        return None, _unavailable("not_finalized",
                                  f"{_bu.label(universe)} breadth can't confirm which sessions are finalized right now.",
                                  universe=universe)
    if not row.get("last") or not row.get("first"):
        return None, _unavailable("not_populated", f"{_bu.label(universe)} breadth has no finalized history yet.",
                                  universe=universe)
    return {"first": row["first"], "last": row["last"], "floor": row.get("floor"),
            "authority": row["authority"], "state": row.get("state")}, None


def latest_finalized(universe: str) -> Optional[str]:
    """The universe's latest FINALIZED session date, or None. Cheap (memoised availability), never raises.
    A date, not a breadth value — safe for the model-facing context (it lets the model turn
    "a month ago" into a real date; `read()` still validates and snaps)."""
    try:
        cov, _err = _coverage(universe)
        return cov["last"] if cov else None
    except Exception:
        return None


def date_context() -> dict:
    """`{today_et, latest_finalized: {universe: date|None}}` — dates only, for the Agent's context."""
    try:
        today = _bs._et_today()
    except Exception:
        today = None
    return {"today_et": today, "latest_finalized": {u: latest_finalized(u) for u in SLICE1_UNIVERSES}}


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _valid_for_domain(metric: str, v: float) -> bool:
    """The catalogue's own domain is the numerical rule (a % outside 0–100 is not a reading)."""
    dom = (_bm.get(metric) or {}).get("domain")
    if dom == _bm.DOMAIN_PCT:
        return 0.0 <= v <= 100.0
    if dom == _bm.DOMAIN_NONNEG:
        return v >= 0
    if dom == _bm.DOMAIN_RATIO:
        return v >= 0
    return True


def _sealed_series(universe: str, metric: str, last_sealed: str) -> tuple[Optional[list], Optional[dict]]:
    """[(date, value)] ascending, finalized sessions only, or an error dict for this metric."""
    sym = _bs.symbol_for(universe, metric)
    if not sym or not _bs.resolve(sym):
        return None, _refused("not_published", "That breadth measure isn't published for this universe.",
                              metric=metric)
    try:
        payload = _bs.build_breadth_bars(sym, "D", FULL_HISTORY_BARS) or {}
    except Exception:
        return None, _unavailable("read_failed", "The breadth series could not be read.", metric=metric)
    rows: list[tuple[str, float]] = []
    for b in payload.get("bars") or []:
        t = str(b.get("t") or "")[:10]
        if not t or t > last_sealed:          # D5: provisional / live sessions are dropped, never shown
            continue
        v = _finite(b.get("c"))
        if v is None or not _valid_for_domain(metric, v):
            continue
        rows.append((t, v))
    rows.sort()
    if not rows:
        return None, _unavailable("read_failed", "The breadth series came back empty.", metric=metric)
    return rows, None


def _on_or_before(rows: list, day: str) -> Optional[int]:
    lo, hi, ans = 0, len(rows) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if rows[mid][0] <= day:
            ans, lo = mid, mid + 1
        else:
            hi = mid - 1
    return ans


def _meta(metric: str) -> dict:
    m = _bm.get(metric) or {}
    return {"metric": metric, "label": m.get("name") or metric, "code": m.get("code"),
            "unit": m.get("unit"), "domain": m.get("domain")}


def sealed_series(universe: str, metric: str) -> dict:
    """The full FINALIZED daily series of one published (universe, metric) — for analytics that
    need every session (Slice 2 event studies). Same rules as `read()`: the universe authority's
    sealed watermark, provisional sessions dropped, catalogue-domain validation. Never raises.

    `{"status":"ok", "rows":[(YYYY-MM-DD, value), …] ascending, "coverage":{…}}` or a refusal /
    unavailable dict. ⛔ LOCAL ONLY — the values never go to a model."""
    universe = str(universe or "").strip().lower()
    if universe not in SLICE1_UNIVERSES:
        return _refused("unsupported_universe", "Breadth here covers US, NYSE and Nasdaq stocks only.",
                        universe=universe or None)
    if metric not in SLICE1_METRICS:
        return _refused("unknown_metric", "That breadth measure isn't available here.", metric=metric)
    try:
        cov, err = _coverage(universe)
        if err:
            return err
        rows, err = _sealed_series(universe, metric, cov["last"])
        if err:
            return err
        return {"status": "ok", "rows": rows, "coverage": cov}
    except Exception:
        return _unavailable("read_failed", "The breadth series could not be read.", metric=metric)


def _sessions_after(last: str, requested: str) -> bool:
    """Is there an NYSE trading day in (last, requested]? (the shared market calendar, not a weekday guess)"""
    from api.services import session_calendar as _sc
    d, end = _date.fromisoformat(last), _date.fromisoformat(requested)
    while d < end:
        d += _td(days=1)
        if _sc.is_trading_day(d):
            return True
    return False


def _point(rows: list, requested: Optional[str], cov: dict) -> dict:
    """One session aligned to `requested` (None = latest finalized).

    A date after the latest finalized session snaps back to it ONLY when no trading session lies in
    between (a weekend or holiday right after it). If a session exists that is not finalized yet, the
    honest answer is "not finalized yet" — never yesterday's value presented as that date's (D5)."""
    day = requested or cov["last"]
    if requested and requested > cov["last"] and _sessions_after(cov["last"], requested):
        return _refused("after_latest", f"The latest finalized session is {cov['last']}.",
                        requested_date=requested, latest_finalized=cov["last"])
    if requested and requested < cov["first"]:
        return _refused("before_history", f"This history starts {cov['first']}.",
                        requested_date=requested, history_start=cov["first"])
    i = _on_or_before(rows, day)
    if i is None:
        return _refused("before_history", f"This history starts {rows[0][0]}.",
                        requested_date=requested, history_start=rows[0][0])
    as_of, value = rows[i]
    out = {"status": "ok", "requested_date": requested, "as_of": as_of, "value": value,
           "snapped": bool(requested) and as_of != requested}
    if i > 0:
        out["prior_session"], out["prior_value"] = rows[i - 1][0], rows[i - 1][1]
    return out


def _summary(rows: list, f: str, t: Optional[str], cov: dict) -> dict:
    end = t or cov["last"]
    if f > cov["last"]:
        return _refused("after_latest", f"The latest finalized session is {cov['last']}.",
                        latest_finalized=cov["last"])
    if end < cov["first"]:
        return _refused("before_history", f"This history starts {cov['first']}.", history_start=cov["first"])
    win = [r for r in rows if f <= r[0] <= end]
    if not win:
        return _unavailable("no_sessions", "No finalized sessions fall in that range.")
    if len(win) > MAX_RANGE_SESSIONS:
        return _refused("range_too_long", f"Ask for at most {MAX_RANGE_SESSIONS:,} sessions at once.")
    vals = [v for _, v in win]
    lo = min(range(len(win)), key=lambda k: (win[k][1], win[k][0]))
    hi = max(range(len(win)), key=lambda k: (win[k][1], win[k][0]))
    last = vals[-1]
    pct = round(100.0 * sum(1 for v in vals if v <= last) / len(vals))
    # first / last / min / max always; the rest evenly spaced across the window (≤ SAMPLE_POINTS total)
    keep = {0, len(win) - 1, lo, hi}
    spare = SAMPLE_POINTS - len(keep)
    if len(win) > 2 and spare > 0:
        keep |= {round(k * (len(win) - 1) / (spare + 1)) for k in range(1, spare + 1)}
    sampled = [{"date": win[k][0], "value": win[k][1]} for k in sorted(keep)]
    return {"status": "ok", "start_requested": f, "end_requested": t, "start": win[0][0], "end": win[-1][0],
            "sessions": len(win), "first": {"date": win[0][0], "value": win[0][1]},
            "last": {"date": win[-1][0], "value": last}, "change": last - win[0][1],
            "min": {"date": win[lo][0], "value": win[lo][1]}, "max": {"date": win[hi][0], "value": win[hi][1]},
            "mean": sum(vals) / len(vals), "percentile_of_last_in_range": pct, "sampled": sampled,
            "clipped_start": win[0][0] != f, "clipped_end": bool(t) and win[-1][0] != t}


def _read_metric(req: dict, metric: str, cov: dict) -> dict:
    rows, err = _sealed_series(req["universe"], metric, cov["last"])
    if err:
        return {**_meta(metric), **err}
    if req["mode"] == "value":
        return {**_meta(metric), **_point(rows, req["date"], cov)}
    if req["mode"] == "compare":
        a, b = _point(rows, req["date"], cov), _point(rows, req["compare_date"], cov)
        if a.get("status") != "ok" or b.get("status") != "ok":
            bad = a if a.get("status") != "ok" else b
            return {**_meta(metric), **bad}
        return {**_meta(metric), "status": "ok", "current": a, "other": b, "change": a["value"] - b["value"]}
    return {**_meta(metric), **_summary(rows, req["start"], req["end"], cov)}


def _read(req: dict) -> dict:
    universe = req["universe"]
    cov, err = _coverage(universe)
    if err:
        return {**err, "request": req}
    metrics = [_read_metric(req, m, cov) for m in req["metrics"]]
    oks = sum(1 for m in metrics if m.get("status") == "ok")
    status = "ok" if oks == len(metrics) else ("partial" if oks else metrics[0].get("status", "unavailable"))
    return {
        "status": status, "request": req, "universe": universe,
        "universe_label": _bu.label(universe), "universe_description": _bu.DESCRIPTIONS.get(universe),
        "basis": "end-of-day, finalized sessions only",
        "coverage": cov, "metrics": metrics,
        "provenance": {"service": SOURCE_SERVICE, "data_class": DATA_CLASS,
                       "authority": cov["authority"], "source_label": f"UCT Breadth ({_bu.label(universe)})"},
    }


def read(request: Any, *, deadline_s: float = DEADLINE_S) -> dict:
    """Validate, read and summarise one breadth request. Never raises."""
    req, refusal = validate(request)
    if refusal:
        return refusal
    fut = _pool.submit(_read, req)
    try:
        return fut.result(timeout=deadline_s)
    except _cf.TimeoutError:
        # The canonical build keeps going (single-flighted) and will be warm on the next ask.
        return _unavailable("warming", "Breadth history is loading. Ask again in a moment.", request=req)
    except Exception:
        return _unavailable("read_failed", "The breadth data could not be read.", request=req)
