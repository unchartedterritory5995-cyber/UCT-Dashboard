"""Historical event studies — the data-category-INDEPENDENT research core (Slice 2).

"Every time <condition on any supported series>, what did <symbol> do afterwards?" e.g. every time
fewer than 10% of Nasdaq stocks were above their 50-day MA, what did QQQ do over the next 3 months?

⭐ REUSE, NOT A NEW ENGINE. The condition series comes from an ADAPTER over an existing UCT interface
(`series_adapters`: breadth → `breadth_reads.sealed_series`; technical → `indicator_compute` over the
stored closes; more categories plug in there). Outcome prices come from `price_reads.daily_closes`
(the read-only `/api/bars-history` store read) and trading days from `session_calendar` (the shared
NYSE calendar). This module only aligns, detects events and does arithmetic. No network, no model,
no writes, and nothing here knows what breadth is.

⛔ LOCAL ONLY. Results carry licensed market values (condition series and prices). They are shown to the member by
`event_study_answer` and must never reach a model (LOCAL-RESULT-BOUNDARY-CONTRACT.md).

DEFINITIONS (stated in every result's `method`):
  • Conditions: `below` (value < threshold), `above` (value > threshold), `cross_below` (previous
    session ≥ threshold and this session < threshold), `cross_above` (previous ≤ threshold, this >).
    A crossing needs BOTH sessions known; a session with no known value never counts as a cross.
  • Episodes (level conditions): `first` = only the first session of each consecutive run of
    qualifying sessions (a session with no known value ends a run); `all` = every qualifying session.
  • Entry: `event_close` = the close of the event session (the condition value is known at that close, so
    this assumes acting at that close); `next_close` = the close of the next trading session (no look-ahead).
  • Horizons are EITHER trading sessions (`{"sessions": n}`: the n-th NYSE trading session after entry,
    per the shared calendar) OR calendar months (`{"months": n}`: the first trading session on or after
    entry date + n calendar months). The two are never mixed or converted.
  • Forward return = exit close / entry close − 1 (price return; split-adjusted, NOT dividend-adjusted).
  • A window that ends after the last stored close is INCOMPLETE and excluded (counted). An exit
    session with no stored close is MISSING and excluded (counted). Nothing is interpolated.
  • `non_overlapping`: an event is skipped while the previous kept event's longest window is still
    open, so samples are independent. Otherwise overlapping windows are counted and disclosed.
  • Baseline: the same horizons from EVERY trading session in the same span — what "normal" looked like.
"""
from __future__ import annotations

import concurrent.futures as _cf
import math
from datetime import date as _date, timedelta as _td
from statistics import median
from typing import Any, Optional

from api.services import session_calendar as _sc
from api.services.market_intel import price_reads as _pr
from api.services.market_intel import series_adapters as _sa

OPS = ("below", "above", "cross_below", "cross_above")
EPISODES = ("first", "all")
ENTRIES = ("event_close", "next_close")
MAX_HORIZONS = 6
MAX_SESSIONS_HORIZON = 504          # ~2 years of trading sessions
MAX_MONTHS_HORIZON = 24
MAX_EVENTS_LISTED = 60
SMALL_SAMPLE = 10
DEADLINE_S = 5.0

_pool = _cf.ThreadPoolExecutor(max_workers=2, thread_name_prefix="mi-event-study")


def _refused(reason: str, detail: str, **extra) -> dict:
    return {"status": "refused", "reason": reason, "detail": detail, **extra}


def _unavailable(reason: str, detail: str, **extra) -> dict:
    return {"status": "unavailable", "reason": reason, "detail": detail, **extra}


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _parse_date(s) -> Optional[str]:
    if not isinstance(s, str) or len(s) != 10:
        return None
    try:
        return _date.fromisoformat(s).isoformat()
    except ValueError:
        return None


# ── validation (pure; reads nothing) ─────────────────────────────────────────

def validate(req: Any) -> tuple[Optional[dict], Optional[dict]]:
    if not isinstance(req, dict):
        return None, _refused("bad_request", "The study request was not understood.")
    cond = req.get("condition")
    if not isinstance(cond, dict):
        return None, _refused("bad_condition", "The condition must name a series, an operator and a threshold.")
    series, err = _sa.describe(cond.get("series"))
    if err:
        return None, err
    if cond.get("op") not in OPS:
        return None, _refused("bad_condition", "The condition must be below, above, cross_below or cross_above a threshold.")
    transform = cond.get("transform", "level")
    if transform not in ("level", "change"):
        return None, _refused("bad_condition", "transform is level (the value) or change (vs the previous observation).")
    if transform == "change":
        series = {**series, "label": f"Change in {series['label']}", "domain": _sa.DOMAIN_ANY,
                  "unit": series["unit"]}
    thr = _finite(cond.get("threshold"))
    if thr is None or not _sa.threshold_ok(series["domain"], thr):
        return None, _refused("bad_threshold", "That threshold isn't a possible value for this measure.")
    sym = _pr.normalize_symbol(req.get("symbol"))
    if not sym:
        return None, _refused("bad_symbol", "Name the ticker to measure afterwards (for example QQQ).")
    hz = req.get("horizons")
    if not isinstance(hz, list) or not hz or len(hz) > MAX_HORIZONS:
        return None, _refused("bad_horizons", f"Give 1 to {MAX_HORIZONS} forward windows.")
    horizons = []
    for h in hz:
        if not isinstance(h, dict) or len(h) != 1:
            return None, _refused("bad_horizons", "Each window is either {sessions: n} or {months: n}.")
        (unit, n), = h.items()
        if unit not in ("sessions", "months") or not isinstance(n, int) or isinstance(n, bool) or n < 1 \
                or n > (MAX_SESSIONS_HORIZON if unit == "sessions" else MAX_MONTHS_HORIZON):
            return None, _refused("bad_horizons", f"Windows are 1–{MAX_SESSIONS_HORIZON} trading sessions "
                                                  f"or 1–{MAX_MONTHS_HORIZON} calendar months.")
        if {unit: n} not in horizons:
            horizons.append({unit: n})
    episodes = req.get("episodes", "first")
    entry = req.get("entry", "event_close")
    if episodes not in EPISODES or entry not in ENTRIES:
        return None, _refused("bad_request", "episodes is first|all; entry is event_close|next_close.")
    start, end = req.get("start"), req.get("end")
    if (start is not None and not _parse_date(start)) or (end is not None and not _parse_date(end)):
        return None, _refused("bad_date", "Study dates must be real calendar dates (YYYY-MM-DD).")
    if start and end and end < start:
        return None, _refused("bad_date", "The study window ends before it starts.")
    return {"condition": {"series": series, "op": cond["op"], "threshold": thr, "transform": transform},
            "symbol": sym, "horizons": horizons, "episodes": episodes, "entry": entry,
            "non_overlapping": bool(req.get("non_overlapping", False)), "baseline": bool(req.get("baseline", True)),
            "start": _parse_date(start) if start else None, "end": _parse_date(end) if end else None}, None


# ── calendar ─────────────────────────────────────────────────────────────────

def _trading_days(first: str, last: str) -> list[str]:
    """NYSE trading sessions in [first, last] from the shared calendar (only where it has coverage)."""
    d, end, out = _date.fromisoformat(first), _date.fromisoformat(last), []
    while d <= end:
        if _sc.covers(d) and _sc.is_trading_day(d):
            out.append(d.isoformat())
        d += _td(days=1)
    return out


def _qualifies(op: str, thr: float, v: float) -> bool:
    return v < thr if op in ("below", "cross_below") else v > thr


# ── core ─────────────────────────────────────────────────────────────────────

def _align(series: dict, cal: list[str]) -> tuple[dict, Optional[set]]:
    """(session → value known at that session's close (None = gap), publication sessions).

    For an `as_of` series the second item is the set of sessions on which a NEW observation became
    known. Events may only occur on those sessions: a weekly or monthly value carried across the
    sessions between publications is the SAME observation, not a new event each day (a defect the
    real-data validation exposed: "CPI change < 0, every session" counted ~3,300 events for ~300
    releases). For a `session` series every session is an observation (None)."""
    rows = series["rows"]
    if series["alignment"] == "session":
        m = dict(rows)
        return {d: m.get(d) for d in cal}, None
    stale = series.get("max_staleness_days")
    out, pubs, j, cur = {}, set(), -1, None
    for d in cal:
        moved = False
        while j + 1 < len(rows) and rows[j + 1][0] <= d:
            j += 1
            cur = rows[j]
            moved = True
        if moved:
            pubs.add(d)                      # first session at/after the publication day
        if cur is None:
            out[d] = None
        elif stale is not None and (_date.fromisoformat(d) - _date.fromisoformat(cur[0])).days > stale:
            out[d] = None
        else:
            out[d] = cur[1]
    return out, pubs


def _detect(req: dict, cal: list[str], known: dict, ws: str, we: str,
            pubs: Optional[set] = None) -> tuple[list[str], dict]:
    op, thr = req["condition"]["op"], req["condition"]["threshold"]
    events, qualifying, runs, gaps = [], 0, 0, 0
    prev: Optional[float] = None
    in_run = False
    for d in cal:
        if d < ws or d > we:
            continue
        v = known.get(d)
        if v is None:
            gaps += 1
            prev, in_run = None, False
            continue
        if pubs is not None and d not in pubs:
            continue                          # same observation as the last publication: not a new event
        q = _qualifies(op, thr, v)
        if op in ("below", "above"):
            if q:
                qualifying += 1
                if not in_run:
                    runs += 1
                if req["episodes"] == "all" or not in_run:
                    events.append(d)
            in_run = q
        else:
            # cross_below: previous ≥ threshold and this < threshold; cross_above: previous ≤ and this >.
            crossed = prev is not None and q and (prev >= thr if op == "cross_below" else prev <= thr)
            if crossed:
                events.append(d)
                runs += 1
            qualifying += 1 if q else 0
        prev = v
    return events, {"qualifying_sessions": qualifying, "episodes_or_crossings": runs, "condition_gaps": gaps}


def _exit_date(cal: list[str], idx: dict, entry: str, h: dict) -> Optional[str]:
    if "sessions" in h:
        j = idx[entry] + h["sessions"]
        return cal[j] if j < len(cal) else None
    target = _sc.add_months(_date.fromisoformat(entry), h["months"]).isoformat()
    lo, hi = 0, len(cal)
    while lo < hi:                       # first session >= target
        mid = (lo + hi) // 2
        if cal[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return cal[lo] if lo < len(cal) else None


def _forward(cal, idx, price, price_last, entry_d, h) -> tuple[str, Optional[str], Optional[float]]:
    """(outcome, exit_date, return): outcome is ok | incomplete | missing."""
    ex = _exit_date(cal, idx, entry_d, h)
    if ex is None or ex > price_last:
        return "incomplete", ex, None
    p0, p1 = price.get(entry_d), price.get(ex)
    if p1 is None:
        return "missing", ex, None
    return "ok", ex, p1 / p0 - 1.0


def _stats(rows: list[tuple[str, str, float]]) -> dict:
    """rows: (event_date, exit_date, return)."""
    if not rows:
        return {"n": 0}
    rets = [r for _, _, r in rows]
    pos = sum(1 for r in rets if r > 0)
    best = max(rows, key=lambda x: (x[2], x[0]))
    worst = min(rows, key=lambda x: (x[2], x[0]))
    return {"n": len(rets), "positive": pos, "positive_rate": pos / len(rets),
            "mean": sum(rets) / len(rets), "median": median(rets),
            "best": {"event_date": best[0], "exit_date": best[1], "return": best[2]},
            "worst": {"event_date": worst[0], "exit_date": worst[1], "return": worst[2]}}


def _hlabel(h: dict) -> str:
    (u, n), = h.items()
    return f"{n} trading session{'s' if n != 1 else ''}" if u == "sessions" else f"{n} calendar month{'s' if n != 1 else ''}"


def _study(req: dict) -> dict:
    series = _sa.load(req["condition"]["series"])
    if series.get("status") != "ok":
        return {**series, "request": req, "stage": "condition_series"}
    if req["condition"].get("transform") == "change":
        rows = series["rows"]
        series = {**series, "rows": [(rows[k][0], None if rows[k][1] is None or rows[k - 1][1] is None
                                      else rows[k][1] - rows[k - 1][1]) for k in range(1, len(rows))]}
        if not series["rows"]:
            return _unavailable("no_data", "Not enough observations to compute a change.", request=req)
    ps = _pr.daily_closes(req["symbol"])
    if ps.get("status") != "ok":
        return {**ps, "request": req, "stage": "price"}
    price = dict(ps["closes"])
    b_first, b_last = series["rows"][0][0], series["rows"][-1][0]
    p_first, p_last = ps["first"], ps["last"]

    ws = max(b_first, p_first, req["start"] or b_first)
    we = min(b_last, req["end"] or b_last)
    if ws > we:
        return _unavailable("no_overlap", f"{req['symbol']} price history ({p_first} to {p_last}) does not overlap "
                                          f"the condition series ({b_first} to {b_last}) in the requested window.",
                            request=req, stage="coverage")
    cal_end = max(p_last, b_last)
    cal_end = (_date.fromisoformat(cal_end) + _td(days=760)).isoformat()      # room to classify incomplete windows
    cal = _trading_days(min(ws, b_first), cal_end)
    idx = {d: i for i, d in enumerate(cal)}

    if series["alignment"] == "as_of":
        # the last publication may fall on a non-session day: the window runs to the session that knew it
        nxt = next((d for d in cal if d >= b_last), b_last)
        we = min(nxt, req["end"] or nxt)
    known, pubs = _align(series, cal)  # session → known condition value (None = gap); publication sessions
    raw, counts = _detect(req, cal, known, ws, we, pubs)

    def entry_of(d: str) -> Optional[str]:
        if req["entry"] == "event_close":
            return d
        j = idx[d] + 1
        return cal[j] if j < len(cal) else None

    longest = max(req["horizons"], key=lambda h: (h.get("sessions", 0) / 252.0) + (h.get("months", 0) / 12.0))
    excluded = {"no_entry_price": 0, "entry_after_price_history": 0, "skipped_overlapping": 0}
    events, overlapping, open_until = [], 0, None
    for d in raw:
        e = entry_of(d)
        if e is None or e > p_last:
            excluded["entry_after_price_history"] += 1
            continue
        if price.get(e) is None:
            excluded["no_entry_price"] += 1
            continue
        window_end = _exit_date(cal, idx, e, longest) or cal[-1]
        if open_until is not None and e <= open_until:
            if req["non_overlapping"]:
                excluded["skipped_overlapping"] += 1
                continue
            overlapping += 1
        events.append((d, e))
        if open_until is None or window_end > open_until:
            open_until = window_end

    per_h, listed = [], []
    rows_by_h: list[list] = [[] for _ in req["horizons"]]
    inc = [0] * len(req["horizons"])
    miss = [0] * len(req["horizons"])
    for d, e in events:
        item = {"event_date": d, "entry_date": e, "entry_close": price[e], "condition_value": known[d], "returns": []}
        for k, h in enumerate(req["horizons"]):
            outcome, ex, r = _forward(cal, idx, price, p_last, e, h)
            if outcome == "ok":
                rows_by_h[k].append((d, ex, r))
            elif outcome == "incomplete":
                inc[k] += 1
            else:
                miss[k] += 1
            item["returns"].append({"horizon": h, "outcome": outcome, "exit_date": ex, "return": r})
        listed.append(item)
    for k, h in enumerate(req["horizons"]):
        per_h.append({"horizon": h, "label": _hlabel(h), **_stats(rows_by_h[k]),
                      "incomplete": inc[k], "missing_price": miss[k]})

    baseline = None
    if req["baseline"]:
        baseline = []
        span = [d for d in cal if ws <= d <= we]
        for h in req["horizons"]:
            rows = []
            for d in span:
                e = entry_of(d)
                if e is None or e > p_last or price.get(e) is None:
                    continue
                outcome, ex, r = _forward(cal, idx, price, p_last, e, h)
                if outcome == "ok":
                    rows.append((d, ex, r))
            s = _stats(rows)
            baseline.append({"horizon": h, "label": _hlabel(h), "n": s.get("n", 0),
                             "positive_rate": s.get("positive_rate"), "mean": s.get("mean"),
                             "median": s.get("median")})

    notes = []
    if overlapping:
        notes.append(f"{overlapping} event(s) began while an earlier event's longest window was still open, so "
                     f"their outcomes overlap and are not independent.")
    if any(s.get("n", 0) < SMALL_SAMPLE for s in per_h):
        notes.append(f"Small sample: fewer than {SMALL_SAMPLE} completed outcomes for at least one window.")
    if p_first > b_first:
        notes.append(f"{req['symbol']} stored price history starts {p_first}, after the condition series ({b_first}); "
                     f"the study starts {ws}.")
    if counts["condition_gaps"]:
        notes.append(f"{counts['condition_gaps']} trading session(s) in the window have no known condition value; "
                     f"they never qualify and they end a run.")
    if series["alignment"] == "as_of":
        notes.append("This series is point-in-time: each session uses only the latest value PUBLISHED by that day.")
    notes.extend(series.get("notes") or [])

    spec = req["condition"]["series"]
    return {
        "status": "ok", "request": req,
        "series_label": spec["label"], "series_category": spec["category"],
        "series_unit": spec["unit"], "series_domain": spec["domain"], "alignment": series["alignment"],
        "series_description": (series.get("source") or {}).get("universe_description"),
        "coverage": {"series_first": b_first, "series_last": b_last,
                     "series_basis": series["coverage"].get("basis"),
                     "series_authority": series["coverage"].get("authority"),
                     "pit_profile": series.get("pit_profile"),
                     "price_first": p_first, "price_last": p_last, "study_start": ws, "study_end": we,
                     "price_basis": ps.get("basis")},
        "counts": {**counts, "events_detected": len(raw), "events_used": len(events), **excluded,
                   "overlapping_events": overlapping},
        "horizons": per_h, "baseline": baseline,
        "events": listed[-MAX_EVENTS_LISTED:], "events_listed_truncated": len(listed) > MAX_EVENTS_LISTED,
        "notes": notes,
        "method": {"entry": req["entry"], "episodes": req["episodes"], "non_overlapping": req["non_overlapping"],
                   "return": "price return (split-adjusted, not dividend-adjusted)",
                   "sessions": "NYSE trading sessions after entry (shared calendar)",
                   "months": "first trading session on or after entry date + N calendar months",
                   "excluded": "incomplete windows and exits without a stored close are excluded and counted"},
        "provenance": {"condition": (series.get("source") or {}).get("interface"),
                       "prices": "price_reads.daily_closes → bars_sqlite (read-only, /api/bars-history path)",
                       "calendar": f"session_calendar {_sc.version()}"},
    }


def run(request: Any, *, deadline_s: float = DEADLINE_S) -> dict:
    """Validate and run one event study. Never raises."""
    req, refusal = validate(request)
    if refusal:
        return refusal
    fut = _pool.submit(_study, req)
    try:
        return fut.result(timeout=deadline_s)
    except _cf.TimeoutError:
        return _unavailable("warming", "The history is still loading. Run the study again in a moment.", request=req)
    except Exception:
        return _unavailable("failed", "The study could not be computed.", request=req)
