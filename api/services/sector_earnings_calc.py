"""ERNSC: earnings season by sector, the pure half (no store, no clock, no vendor). Tested on invented numbers.

WHAT A SEASON IS (the builder's definition, said on every answer): the reports DATED in one calendar quarter. Reports
dated 1 October to 31 December mostly give the quarter that ended on 30 September, so those three months are the "Q3"
season; 1 January to 31 March is the Q4 season of the year before; and so on. Every report belongs to exactly one season,
and the same season a year earlier is the same three months a year earlier. `seasons(today)` gives three: the one that
holds today (so far, through today), the one before it, and the same one a year earlier.

ONE STOCK IN ONE SEASON, from the earnings model UCT already holds for it (`earnings_intel`, the Research Earnings tab's
copy: its reported quarters with the actual and the consensus EPS and revenue, each report's date, the measured move of
each report, and the next report date):
  reported   its newest reported quarter whose report (announcement) date falls inside the season
  to_report  (the season that holds today only) nothing reported in it yet, and the copy's next report date is today or
             later in it
  awaiting   (the season that holds today only) nothing reported in it in the copy, and the copy's next report date is in
             it and has passed: the result has not reached UCT's copy yet
  (nothing)  no report in the window and none due in it
A reported quarter's EPS is a beat, in line or a miss by the copy's OWN surprise (`earnings_intel._surprise`, never
restated here: (actual - estimate) / |estimate|; for an estimate under 5 cents only the difference in dollars): a surprise
within IN_LINE_PCT either way (or, for an estimate under 5 cents, within IN_LINE_ABS dollars) is in line; `none` when the
copy holds no consensus to set it against. Revenue the same, by its percent surprise only.
Its reaction is the copy's measured move for that report (`earnings_reaction`: the close-to-close move of the session that
first traded the result, i.e. the close before the report to the close after it, from UCT's own daily bars), counted only
when the copy was read after the session that could have traded the result closed (`not_settled` before then), and
`not_measured` when the copy holds no move for it.

A SECTOR'S FIGURES (and the same over every sector together): reporters so far, still to report, awaiting; for EPS and for
revenue the share beating, in line and missing among the reporters with a consensus, and the median percent surprise; the
median reaction and the share that rose. Every figure carries the count it rests on, and a share or a median needs at least
MIN_REPORTERS (GRPS's own floor): fewer gives the counts and no figure.

Every constant below is the builder's default, not an owner ruling.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from statistics import median
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from api.services import group_stats_calc as GC

ET = ZoneInfo("America/New_York")
#: A surprise of this many percent or less, either way, is "in line". The same 0.5% the site already treats as noise in an
#: estimate (EEHSC's held tolerance, `fundamentals_estimates_store._REVISION_EPS_TOL`).
IN_LINE_PCT = 0.5
#: For an EPS estimate under 5 cents the copy gives only the difference in dollars: within half a cent (equal to the cent
#: the figures are reported to) is in line.
IN_LINE_ABS = 0.005
MIN_REPORTERS = GC.MIN_MEMBERS
NO_SECTOR = "Sector not on file"
SEASON_IDS = ("current", "previous", "year_ago")
SEASON_RULE = ("The reports dated in one calendar quarter: 1 October to 31 December is the Q3 season (most companies give "
               "the quarter that ended 30 September), 1 January to 31 March the Q4 season, and so on.")
STATES = ("beat", "in_line", "miss", "none")
MOVE_STATES = ("ok", "not_settled", "not_measured")

#: A reporter as held: one tuple per stock per season (a fifth of the memory of a dict). `row_dict` names the fields.
ROW_FIELDS = ("symbol", "date", "label", "eps_act", "eps_est", "eps_pct", "eps_abs", "eps_state",
              "rev_act", "rev_est", "rev_pct", "rev_state", "move", "move_state")
SYM, DATE, LABEL, EPS_ACT, EPS_EST, EPS_PCT, EPS_ABS, EPS_STATE, REV_ACT, REV_EST, REV_PCT, REV_STATE, MOVE, MOVE_STATE = range(14)


def _num(v) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _day(v) -> Optional[str]:
    s = str(v or "")[:10]
    try:
        return date.fromisoformat(s).isoformat() if len(s) == 10 else None
    except ValueError:
        return None


def _r(v: Optional[float], nd: int = 2) -> Optional[float]:
    return None if v is None else round(v, nd)


# ── the seasons ──────────────────────────────────────────────────────────────────────────────

def quarter_of(d: date) -> tuple[int, int]:
    return d.year, (d.month - 1) // 3 + 1


def _quarter_span(year: int, q: int) -> tuple[date, date]:
    first = date(year, 3 * q - 2, 1)
    nxt = date(year + 1, 1, 1) if q == 4 else date(year, 3 * q + 1, 1)
    return first, nxt - timedelta(days=1)


def season(year: int, q: int, today: date) -> dict:
    """The season of the reports dated in calendar quarter (year, q): named for the quarter before it."""
    frm, to = _quarter_span(year, q)
    gy, gq = (year, q - 1) if q > 1 else (year - 1, 4)
    return {"label": f"Q{gq} {gy}", "quarter": f"{gy}-Q{gq}", "from": frm.isoformat(), "to": to.isoformat(),
            "through": min(today, to).isoformat(), "complete": today > to}


def seasons(today: date) -> dict:
    """{current, previous, year_ago}: the season that holds `today`, the one before it, and the same one a year earlier."""
    y, q = quarter_of(today)
    py, pq = (y, q - 1) if q > 1 else (y - 1, 4)
    return {"current": season(y, q, today), "previous": season(py, pq, today), "year_ago": season(y - 1, q, today)}


# ── one stock ────────────────────────────────────────────────────────────────────────────────

def classify(pct: Optional[float], diff: Optional[float] = None) -> str:
    """'beat' | 'in_line' | 'miss' | 'none' from a percent surprise, else (an estimate under 5 cents) the difference."""
    if pct is not None:
        return "beat" if pct > IN_LINE_PCT else "miss" if pct < -IN_LINE_PCT else "in_line"
    if diff is not None:
        return "beat" if diff > IN_LINE_ABS else "miss" if diff < -IN_LINE_ABS else "in_line"
    return "none"


def built_day(payload: dict) -> Optional[str]:
    """The New York day the copy was read (`meta.retrieved_at`), or None."""
    ts = _num(((payload.get("meta") or {}) if isinstance(payload, dict) else {}).get("retrieved_at"))
    if ts is None or ts <= 0:
        return None
    try:
        return datetime.fromtimestamp(ts, ET).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _next_session(d: date, is_trading_day: Callable[[date], bool], *, include: bool) -> date:
    d = d if include else d + timedelta(days=1)
    for _ in range(12):
        if is_trading_day(d):
            return d
        d += timedelta(days=1)
    return d


def settled(report_day: str, read_day: Optional[str], is_trading_day: Callable[[date], bool]) -> bool:
    """Was the copy read after the LAST session that could have traded the result closed? A report before the open is
    traded that session, one after the close the next, and the copy carries no time, so both must have closed: the copy
    must be from a day after the session following the report's first session."""
    rd, read = _day(report_day), _day(read_day)
    if rd is None or read is None:
        return False
    first = _next_session(date.fromisoformat(rd), is_trading_day, include=True)
    return read > _next_session(first, is_trading_day, include=False).isoformat()


def _reactions(payload: dict) -> dict:
    """{report day: measured move} from the copy's reaction strip."""
    out: dict = {}
    reaction = payload.get("reaction")
    events = reaction.get("events") if isinstance(reaction, dict) else None
    for e in events if isinstance(events, list) else ():
        if isinstance(e, dict):
            d, pct = _day(e.get("report_date")), _num(e.get("reaction_pct"))
            if d and pct is not None:
                out.setdefault(d, pct)
    return out


def reporter_row(sym: str, q: dict, moves: dict, read_day: Optional[str], is_trading_day) -> tuple:
    """One reported quarter as a held row (ROW_FIELDS)."""
    d = _day(q.get("report_date"))
    comparable = q.get("eps_basis") == "consensus_comparable"
    eps_pct = _num(q.get("eps_surprise_pct")) if comparable else None
    eps_abs = _num(q.get("eps_surprise_abs")) if comparable else None
    rev_pct = _num(q.get("rev_surprise_pct")) if comparable else None
    move = moves.get(d)
    if move is None:
        move_state = "not_measured"
    elif settled(d, read_day, is_trading_day):
        move_state = "ok"
    else:
        move, move_state = None, "not_settled"
    label = q.get("label")
    return (sym, d, label if isinstance(label, str) and label.strip() else None,
            _num(q.get("eps_actual")), _num(q.get("eps_estimate")), _r(eps_pct), _r(eps_abs, 4),
            classify(eps_pct, eps_abs if eps_pct is None else None),
            _num(q.get("revenue_actual")), _num(q.get("revenue_estimate")), _r(rev_pct), classify(rev_pct),
            _r(move), move_state)


def stock_seasons(sym: str, payload: dict, spans: dict, today: date, is_trading_day: Callable[[date], bool]) -> dict:
    """{season id: ("reported", row) | ("to_report", (sym, day)) | ("awaiting", (sym, day))} for the seasons where the
    stock reported or is due (a season with neither is left out)."""
    quarters = [q for q in (payload.get("quarters") or []) if isinstance(q, dict) and q.get("reported")]
    dated = [(d, q) for q in quarters for d in (_day(q.get("report_date")),) if d]
    moves = _reactions(payload)
    read_day = built_day(payload)
    nxt = _day(payload.get("next_report_date") or (payload.get("summary") or {}).get("next_report_date"))
    out: dict = {}
    for sid, sp in spans.items():
        inside = [(d, q) for d, q in dated if sp["from"] <= d <= sp["to"]]
        if inside:
            _d, q = max(inside, key=lambda x: x[0])
            out[sid] = ("reported", reporter_row(sym, q, moves, read_day, is_trading_day))
        elif sid == "current" and nxt and sp["from"] <= nxt <= sp["to"]:
            # due today or later is still to report; a date that has passed with no result in the copy is awaiting
            out[sid] = ("to_report" if nxt >= today.isoformat() else "awaiting", (sym, nxt))
    return out


# ── a sector, and every sector together ──────────────────────────────────────────────────────

def _share(k: int, n: int) -> Optional[float]:
    return round(k / n * 100.0, 1) if n >= MIN_REPORTERS else None


def _median(vals: list) -> Optional[float]:
    return round(median(vals), 2) if len(vals) >= MIN_REPORTERS else None


def _measure(states: Counter, pcts: list) -> dict:
    n = states["beat"] + states["in_line"] + states["miss"]
    return {"n": n, "beat": states["beat"], "in_line": states["in_line"], "miss": states["miss"], "none": states["none"],
            "beat_pct": _share(states["beat"], n), "in_line_pct": _share(states["in_line"], n),
            "miss_pct": _share(states["miss"], n), "median": _median(pcts), "median_n": len(pcts)}


def figures(rows: list) -> dict:
    """The figures over a list of held rows."""
    moved = [r[MOVE] for r in rows if r[MOVE_STATE] == "ok" and r[MOVE] is not None]
    mstates = Counter(r[MOVE_STATE] for r in rows)
    rose = sum(1 for m in moved if m > 0)
    return {
        "reported": len(rows),
        "eps": _measure(Counter(r[EPS_STATE] for r in rows), [r[EPS_PCT] for r in rows if r[EPS_PCT] is not None]),
        "rev": _measure(Counter(r[REV_STATE] for r in rows), [r[REV_PCT] for r in rows if r[REV_PCT] is not None]),
        "move": {"n": len(moved), "median": _median(moved), "rose": rose, "rose_pct": _share(rose, len(moved)),
                 "not_settled": mstates["not_settled"], "not_measured": mstates["not_measured"]},
    }


def row_order(r: tuple, metric: str = "eps") -> tuple:
    """The biggest beats and misses first: the size of the percent surprise, then (EPS, an estimate under 5 cents) the
    size of the difference, then the reporters with no consensus; the symbol breaks ties."""
    pct = r[EPS_PCT] if metric == "eps" else r[REV_PCT]
    if pct is not None:
        return (0, -abs(pct), r[SYM])
    if metric == "eps" and r[EPS_ABS] is not None:
        return (1, -abs(r[EPS_ABS]), r[SYM])
    return (2, 0.0, r[SYM])


def season_slice(stocks: list, sid: str) -> dict:
    """Every sector for one season, the EPS beat share highest first (a sector below the floor next, then the stocks with
    no sector on file). `stocks`: [{symbol, sector, seasons: stock_seasons(...)}]."""
    groups: dict = {}
    for st in stocks:
        got = st["seasons"].get(sid)
        if got is None:
            continue
        name = st["sector"] or NO_SECTOR
        g = groups.get(name)
        if g is None:
            g = groups[name] = {"on_file": st["sector"] is not None, "reported": [], "to_report": [], "awaiting": []}
        g[got[0]].append(got[1])
    sectors = []
    every, to_report, awaiting = [], 0, 0
    for name, g in groups.items():
        rows = sorted(g["reported"], key=row_order)
        every.extend(rows)
        to_report += len(g["to_report"])
        awaiting += len(g["awaiting"])
        sectors.append({"name": name, "on_file": g["on_file"], **figures(rows), "to_report": len(g["to_report"]),
                        "awaiting": len(g["awaiting"]), "reporters": rows,
                        "upcoming": sorted(g["to_report"], key=lambda x: (x[1], x[0])),
                        "late": sorted(g["awaiting"], key=lambda x: (x[1], x[0]))})
    sectors.sort(key=lambda s: (not s["on_file"], s["eps"]["beat_pct"] is None, -(s["eps"]["beat_pct"] or 0.0),
                                -s["reported"], s["name"]))
    return {"total": {**figures(every), "to_report": to_report, "awaiting": awaiting}, "sectors": sectors}


def row_dict(r) -> dict:
    """A held row as the route gives it."""
    return dict(zip(ROW_FIELDS, r))


def brief(s: Optional[dict]) -> Optional[dict]:
    """A sector (or the total) without its lists."""
    if s is None:
        return None
    return {k: v for k, v in s.items() if k not in ("reporters", "upcoming", "late")}
