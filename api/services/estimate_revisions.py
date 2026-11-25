"""EEHSC: estimate revision breadth by sector, added up from UCT's own daily estimate snapshots.

"Are analysts raising or cutting numbers, and where?" `estimate_history.py` (COV-07) snapshots the consensus EPS and
revenue estimate of each upcoming fiscal quarter once each weekday evening for every symbol it tracks, and EEH shows one
stock. This module adds the snapshots up by sector. It READS THE HELD STORE ONLY: never a vendor call, never a write
beyond the store's own `CREATE TABLE IF NOT EXISTS`.

WHO IS COUNTED. Only the symbols the store tracks (`estimate_tracked`): the S&P 500 list the daily job seeds
(`origin='sp500'`) and every symbol a member opened the estimate history of (`origin='viewed'`), at most
`estimate_history.MAX_SYMBOLS` (600). NOT the whole market, and every answer says how many and from where.

WHAT ONE STOCK COUNTS AS, per window (7 or 30 days) and per estimate (EPS or revenue), from the store's newest snapshot
day (`asof`):
  end      the stock's newest snapshot; it must be within `SLACK_DAYS` of `asof`, else `gap` (the daily read has not
           answered for it since)
  quarter  its NEXT fiscal quarter: the earliest fiscal period ending after the end snapshot's day
  start    its newest snapshot on or before (end - window); it must be within `SLACK_DAYS` of that day, else `gap`
  up / down / held   the consensus for that same quarter at start and at end: a change of more than
           `HELD_TOLERANCE_PCT` either way is up or down, anything within it is held
  collecting   no snapshot yet, or its snapshots begin after (end - window): too few to span the window (the store's own
           honesty rule: a revision needs two snapshots)
  not_comparable   no consensus for that quarter at one end, no upcoming quarter in its snapshots, or a zero estimate at
           the start (a change from zero has no percent)
Every tracked symbol lands in exactly one of those six; none is dropped.

WHERE A SECTOR COMES FROM: the same map GRPS, GRP and PCHG group by (`group_stats._group_map`, the company details UCT
keeps per stock, i.e. `scan_period._sector_industry_map`), cleaned the way GRPS cleans it (`group_stats._clean`), so a
sector here is spelled exactly as GRPS spells it. A symbol the map has no sector for is counted under
`NO_SECTOR`, and the answer says how many.

A SECTOR'S FIGURES: symbols counted (up + down + held), up, down, held, net breadth = (up - down) / counted as a percent
(only with at least `MIN_COUNTED` counted, GRPS's own floor; fewer gives the counts and no figure), and the `TOP_N`
largest raises and cuts by percent.

HOW OFTEN: a request NEVER reads the store. It answers from what this module holds (`held_build.HeldBuild`), and ONE
background thread re-reads the store when the held answer is older than `REFRESH_S` (the store changes once each
weekday evening). With nothing held a request is told `computing` AT ONCE (speed pass 2, 2026-11-24: live, it waited
3 seconds first and then said `computing` anyway; the panel asks again every 3 seconds). The read is two small indexed
queries per tracked symbol (at most 600), never a whole-table scan.

THE COPY ON DISK (`DISK`, a few tens of KB): the newest answer is kept on this server's disk, so a restart answers at
once. A copy built on another New York day, by another `ANSWER_VERSION` or in another shape is never served
(`_valid`), and a failed read is never written (`held_build`).

Every constant below is the builder's default, not an owner ruling.
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from api.services import estimate_history as EH
from api.services import group_stats as GS
from api.services import group_stats_calc as GC
from api.services import held_build

WINDOWS = (7, 30)
DEFAULT_WINDOW = 30
METRICS = {"eps": 0, "revenue": 1}          # the metric's place in a snapshot's (eps_avg, rev_avg)
DEFAULT_METRIC = "eps"
#: A change of this many percent or less, either way, is "held" (not a revision). The same 0.5% the site already
#: treats as noise in an estimate revision (`fundamentals_estimates_store._REVISION_EPS_TOL`).
HELD_TOLERANCE_PCT = 0.5
#: How far (calendar days) a snapshot may sit from the day a window needs: a weekend and a holiday (the job runs
#: weekdays only), no more.
SLACK_DAYS = 4
TOP_N = 3
MIN_COUNTED = GC.MIN_MEMBERS                # GRPS's floor: fewer counted stocks give the counts and no net breadth
REFRESH_S = 30 * 60.0
NO_SECTOR = "Sector not on file"
COUNTED = ("up", "down", "held")
NOT_COUNTED = ("collecting", "gap", "not_comparable")
STATES = COUNTED + NOT_COUNTED
ORIGIN_WORDS = {"sp500": "sp500", "viewed": "viewed"}
ANSWER_VERSION = 1
DISK = ("estimate_revisions", f"breadth_v{ANSWER_VERSION}.json")
_ET = ZoneInfo("America/New_York")


def _iso(d: date) -> str:
    return d.isoformat()


def _day(s: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat(str(s)[:10]) if s else None
    except ValueError:
        return None


def _num(v) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# ── one stock (pure) ─────────────────────────────────────────────────────────────────────────

def classify(rows: list, first: Optional[str], last: Optional[str], asof: Optional[str], window: int, metric: str,
             *, tolerance: float = HELD_TOLERANCE_PCT, slack: int = SLACK_DAYS) -> dict:
    """One stock, one window, one estimate -> `{state, reason, pct, from, to, from_date, to_date, period_end}`.

    `rows`: the stock's snapshot rows `(snap_date, period_end, eps_avg, rev_avg)` from (asof - window - 2 x slack) on,
    periods ending after (asof - slack). `first` / `last`: its first and newest snapshot day in the whole store.
    `asof`: the store's newest snapshot day. Pure: no clock, no store."""
    col = METRICS[metric]
    out = {"state": None, "reason": None, "pct": None, "from": None, "to": None, "from_date": None, "to_date": None,
           "period_end": None}

    def done(state, reason=None):
        out["state"], out["reason"] = state, reason
        return out

    asof_d, first_d, last_d = _day(asof), _day(first), _day(last)
    if first_d is None or last_d is None or asof_d is None:
        return done("collecting", "no snapshot yet: the daily job adds one each weekday evening")
    if last_d < asof_d - timedelta(days=slack):
        return done("gap", f"newest snapshot {last}: the daily read has not answered for it since")
    by_day: dict = {}
    for snap, pe, eps, rev in rows:
        by_day.setdefault(str(snap)[:10], {})[str(pe)[:10]] = (_num(eps), _num(rev))
    end = str(last)[:10]
    quarters = sorted(pe for pe in by_day.get(end, {}) if pe > end)
    out["to_date"] = end
    if not quarters:
        return done("not_comparable", f"no fiscal quarter ending after {end} in its snapshots")
    pe = quarters[0]
    out["period_end"] = pe
    to = by_day[end][pe][col]
    if to is None:
        return done("not_comparable", f"no consensus for the quarter ending {pe} on {end}")
    out["to"] = to
    target = last_d - timedelta(days=window)
    if first_d > target:
        return done("collecting", f"snapshots begin {first}; a {window}-day change needs one from {_iso(target)} or before")
    starts = [d for d in by_day if d <= _iso(target)]
    start = max(starts) if starts else None
    if start is None or start < _iso(target - timedelta(days=slack)):
        return done("gap", f"no snapshot between {_iso(target - timedelta(days=slack))} and {_iso(target)}")
    out["from_date"] = start
    frm = (by_day[start].get(pe) or (None, None))[col]
    if frm is None:
        return done("not_comparable", f"no consensus for the quarter ending {pe} on {start}")
    out["from"] = frm
    if frm == 0:
        return done("not_comparable", f"the estimate was zero on {start}, so a change has no percent")
    pct = (to - frm) / abs(frm) * 100.0
    out["pct"] = round(pct, 2)
    if pct > tolerance:
        return done("up")
    if pct < -tolerance:
        return done("down")
    return done("held")


# ── the sectors (pure) ───────────────────────────────────────────────────────────────────────

def _blank_counts() -> dict:
    return {"members": 0, "counted": 0, "up": 0, "down": 0, "held": 0,
            "not_counted": {k: 0 for k in NOT_COUNTED}, "net": None}


def _net(c: dict) -> None:
    c["counted"] = c["up"] + c["down"] + c["held"]
    c["net"] = round((c["up"] - c["down"]) / c["counted"] * 100.0, 1) if c["counted"] >= MIN_COUNTED else None


def _symbol_order(s: dict):
    if s["state"] in COUNTED:
        return (0, -(s["pct"] if s["pct"] is not None else 0.0), s["symbol"])
    return (1 + NOT_COUNTED.index(s["state"]), 0.0, s["symbol"])


def sector_slice(stocks: list, metric: str, window: int) -> dict:
    """Every sector for one estimate and one window, net breadth highest first (a sector with no figure, then the
    stocks with no sector on file, last). `stocks`: `{symbol, sector, results: {"eps:7": classify(...), ...}}`."""
    key = f"{metric}:{window}"
    sectors: dict = {}
    total = _blank_counts()
    for st in stocks:
        res = st["results"][key]
        name = st["sector"] or NO_SECTOR
        s = sectors.get(name)
        if s is None:
            s = sectors[name] = {"name": name, "on_file": st["sector"] is not None, **_blank_counts(), "symbols": []}
        for c in (s, total):
            c["members"] += 1
            if res["state"] in COUNTED:
                c[res["state"]] += 1
            else:
                c["not_counted"][res["state"]] += 1
        s["symbols"].append({"symbol": st["symbol"], **res})
    rows = []
    for s in sectors.values():
        _net(s)
        s["symbols"].sort(key=_symbol_order)
        ups = [x for x in s["symbols"] if x["state"] == "up"]
        downs = sorted((x for x in s["symbols"] if x["state"] == "down"), key=lambda x: (x["pct"], x["symbol"]))
        s["raises"] = [{"symbol": x["symbol"], "pct": x["pct"]} for x in ups[:TOP_N]]
        s["cuts"] = [{"symbol": x["symbol"], "pct": x["pct"]} for x in downs[:TOP_N]]
        rows.append(s)
    rows.sort(key=lambda s: (not s["on_file"], s["net"] is None, -(s["net"] or 0.0), -s["counted"], s["name"]))
    _net(total)
    return {"metric": metric, "window": window, "total": total, "sectors": rows}


# ── the read of the store (background thread only) ───────────────────────────────────────────

def _tracked(conn) -> list:
    """[(canonical symbol, [its raw spellings], origin)], one per stock (BRK.B and BRK-B are one stock; the origin is
    the first spelling's)."""
    from api.services.ticker_resolver import canonical
    order, raws, origins = [], {}, {}
    for raw, origin in conn.execute("SELECT symbol, origin FROM estimate_tracked ORDER BY added_at, symbol"):
        c = canonical(raw)
        if not c:
            continue
        if c not in raws:
            order.append(c)
            raws[c], origins[c] = [], origin
        raws[c].append(raw)
    return [(c, raws[c], origins[c]) for c in order]


def _span(conn, raw: str) -> tuple:
    r = conn.execute("SELECT MIN(snap_date), MAX(snap_date) FROM estimate_snapshot WHERE symbol=?", (raw,)).fetchone()
    return (r[0], r[1]) if r else (None, None)


def build(previous: Optional[dict] = None, *, groups: Optional[dict] = None) -> tuple:
    """Read the store once and work out every slice. Returns `(answer, note)` for `held_build`."""
    started = time.time()
    groups = groups if groups is not None else GS._group_map()
    with EH._conn() as conn:
        tracked = _tracked(conn)
        spans = {}
        for canon, raws, _origin in tracked:
            # two spellings of one stock: the one read most lately, then the one with the longer history
            cands = [(raw, *_span(conn, raw)) for raw in raws]
            cands.sort(key=lambda c: c[1] or "9999-12-31")
            cands.sort(key=lambda c: c[2] or "", reverse=True)
            spans[canon] = cands[0]
        lasts = [s[2] for s in spans.values() if s[2]]
        firsts = [s[1] for s in spans.values() if s[1]]
        asof = max(lasts) if lasts else None
        stocks = []
        floor = pe_floor = None
        if asof:
            a = date.fromisoformat(asof)
            floor = _iso(a - timedelta(days=max(WINDOWS) + 2 * SLACK_DAYS))
            pe_floor = _iso(a - timedelta(days=SLACK_DAYS))
        for canon, _raws, origin in tracked:
            raw, first, last = spans[canon]
            rows = []
            if asof and last:
                rows = conn.execute(
                    "SELECT snap_date, period_end, eps_avg, rev_avg FROM estimate_snapshot "
                    "WHERE symbol=? AND snap_date>=? AND period_end>? ORDER BY snap_date, period_end",
                    (raw, floor, pe_floor)).fetchall()
            g = groups.get(canon) or groups.get(raw) or {}
            stocks.append({
                "symbol": canon, "origin": ORIGIN_WORDS.get(origin, "other"), "sector": GS._clean(g.get("sector")),
                "results": {f"{m}:{w}": classify(rows, first, last, asof, w, m) for m in METRICS for w in WINDOWS},
            })
    origins: dict = {}
    for s in stocks:
        origins[s["origin"]] = origins.get(s["origin"], 0) + 1
    answer = {
        "status": "ok", "v": ANSWER_VERSION, "built_at": held_build.now_iso(), "asof": asof,
        "covers_from": min(firsts) if firsts else None, "source": EH.SOURCE, "map": GS.MAP_NAME,
        "tolerance_pct": HELD_TOLERANCE_PCT, "slack_days": SLACK_DAYS, "min_counted": MIN_COUNTED, "top_n": TOP_N,
        "windows": list(WINDOWS), "metrics": list(METRICS),
        "tracked": {"n": len(stocks), "cap": EH.MAX_SYMBOLS, "origins": origins,
                    "no_sector": sum(1 for s in stocks if s["sector"] is None)},
        "slices": {f"{m}:{w}": sector_slice(stocks, m, w) for m in METRICS for w in WINDOWS},
    }
    counted = {k: v["total"]["counted"] for k, v in answer["slices"].items()}
    return answer, f"tracked={len(stocks)} asof={asof} counted={counted} in {time.time() - started:.2f}s"


def _due(answer: dict, checked: float) -> bool:
    return time.time() - checked >= REFRESH_S


def today_et() -> date:
    """Today in New York (indirected so tests replace it)."""
    return datetime.now(_ET).date()


def _built_on(answer: dict) -> Optional[date]:
    """The New York day an answer was built on, from its `built_at` (UTC ISO), or None."""
    try:
        return datetime.fromisoformat(str(answer.get("built_at"))).astimezone(_ET).date()
    except (TypeError, ValueError):
        return None


def _valid(answer: dict) -> bool:
    """This module's answer, of this version, built today (New York): anything else is never served, from memory's
    new build or from the copy on disk."""
    return (answer.get("status") == "ok" and isinstance(answer.get("slices"), dict) and answer.get("v") == ANSWER_VERSION
            and _built_on(answer) == today_et())


_held = held_build.HeldBuild("estimate-revisions", lambda previous: build(previous), _due, disk=DISK,
                             version=ANSWER_VERSION, wait_s=0.0, valid=_valid)


# ── the read the route makes ─────────────────────────────────────────────────────────────────

def get_breadth(metric: str = DEFAULT_METRIC, window: int = DEFAULT_WINDOW) -> dict:
    """One estimate and one window: every sector, the totals, the tracked count and the store's dates. NEVER reads the
    store on the request and never waits: the held answer (in memory, or today's copy on disk), else `computing` while
    the one read runs."""
    if metric not in METRICS or window not in WINDOWS:
        return {"status": "error", "detail": "metric must be eps or revenue, window 7 or 30"}
    got = _held.get(wait_s=0.0)
    if got.get("status") != "ok":
        return {**got, "metric": metric, "window": window}
    out = {k: v for k, v in got.items() if k != "slices"}
    out.update((got.get("slices") or {}).get(f"{metric}:{window}") or {"metric": metric, "window": window,
                                                                       "total": _blank_counts(), "sectors": []})
    return out


def peek() -> Optional[dict]:
    """READ ONLY: the whole held answer, or None. Never starts a read."""
    return _held.peek()


def reset_for_tests() -> None:
    _held.reset()


def drain_for_tests(timeout: float = 5.0) -> None:
    _held.drain(timeout)
