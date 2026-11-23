"""Group fundamentals, breadth and weekly rank for every sector and industry, built once each evening and held.

The Terminal's group views (GRP's "Rank", "Fundamentals" and "Breadth" sections, and the GRPS table of every
sector or industry) read this through one paid route (`api/routers/group_stats.py`).

WHERE THE NUMBERS COME FROM (all already held by UCT; NOTHING HERE ASKS A VENDOR):

  universe  `cap_universe.symbols()` less `cap_universe.etf_symbols()`: the site's stock universe, no funds.
  groups    the sector and industry map GRP and PCHG group by (`scan_period._sector_industry_map`, the
            company details UCT keeps per stock), so a name here is the name GRP shows. NOT
            `industry_map.py` (a different, Finviz-named map the breadth drill and the NH/NL scanner use)
            and NOT `groups.py` (UCT's curated themes): GRP's sector and industry lists come from the first.
  prices    `price_reads.daily_closes`, the read-only `/api/bars-history` read (split-adjusted, not
            dividend-adjusted, the serve-time split heal applied); never a provider refresh.
  filings   the point-in-time fundamentals store the charts and FUND read (`fundamentals_pit`, served when
            FUNDAMENTALS_PIT_ENABLED=1, as its routes are): each company's published artifact, read through
            the store's own source selection (`serving.current_source`) but NOT through its per-company
            cache, which would hold every company's parsed artifact for five minutes (well over a gigabyte
            for the universe). Only the series the group figures need are kept from each artifact.

THE DEFINITIONS are in `group_stats_calc` (pure, tested on invented numbers).

THE WEEKLY RANK (2026-11-22) rides the same single read of each stock's closes: the tail kept per stock is
`RANK_TAIL` closes instead of `TAIL_SESSIONS` (breadth still reads only its last `TAIL_SESSIONS`, so its figures
are unchanged), and after the pass each stock's change at every weekly point is worked out from that tail (an array
of 106 numbers) and grouped. Nothing is read a second time.

HOW OFTEN: a request NEVER builds. It answers from what this module holds, in memory and on disk
(`<DATA_DIR>/group_stats/`), so a restart serves the last answer at once. The ONE build runs on a
background thread started by the scheduler's evening ticks (`scheduled_refresh`, registered in api/main.py)
and never by a member's request: only in the quiet span `scan_period` keeps whole-universe work to (weekends,
and weekdays before 07:00 or from 20:15 New York time), only when the held answer is older than the newest
session's evening (`REBUILD_AT_ET`), one build at a time, with a short pause after every stock (`YIELD_S`).
The span is checked only when a build STARTS; a build still running when it ends (07:00 on a weekday) is not
stopped, but from that stock on it pauses `YIELD_BUSY_S` after each one (MKTH's pair, `market_history.py`).
Closes that stop short of that evening, or filings that could not be read, are tried again on a later tick,
at most `LAG_TRIES` times an evening.
A BUILD THAT PRICED TOO LITTLE IS A FAILURE (`held_build.py`'s rule: a look that did not go well never replaces a
good answer). When every price read fails, the build still finishes with no session, no breadth and no rank; held,
it would replace the last good evening's figures in memory and on disk. So a build that priced fewer than
`MIN_PRICED_SHARE` of the stocks it read (none at all included), or found no session, is not held: the held answer
and its disk copy stay as they were, the failure is said in the build's log line, and the evening is tried again on
a later tick (after `FAIL_RETRY_S`), counted against the same `LAG_TRIES`.

BOUNDS: at most `MAX_SYMBOLS` symbols; each stock's full history is dropped as soon as its last
`TAIL_SESSIONS` closes and three valuation closes are taken (the tails are arrays: about 4 KB a stock);
each artifact is dropped as soon as its needed series are copied.
MEASURED (2026-11-21, a bounded invented sample through the real read paths on the dev PC, not production;
see the unit's report): about 80 ms of CPU per stock for the price read of ~6,000 daily rows (the same read
MKTH measured), a few ms per artifact parse, and well under a second for the grouping, so a universe of
about 3,500 stocks is several minutes of one core once each evening.
THE WEEKLY RANK, MEASURED (2026-11-22, the build before and after on the same invented closes, 3,500 stocks, 11
sectors and 145 industries, filings off, best of three, dev PC): +1.4 s of CPU per build (1.0 s for the changes, the
medians and the ranks; 0.4 s for the longer tail), +5.9 MB at the build's peak, +1.5 MB held with the answer, and
+341 KB in the answer's JSON (disk and the industries table).

POSITIONING (2026-11-22, the GRPS CROWDING view): after the closes are let go, the same build reads three stores
this server already holds, each ONCE (the short interest list SHRTS ranks, the INS CLUSTER store's open-market
purchases, and the Funds (N-PORT) index), and rolls each stock's figure up by the same groups
(`api/services/group_positioning.py` says where every number comes from, what is left out and why). Held with the
answer; a part whose store cannot be read says so, and a failure there never costs the rest of the build. An answer
held from before it is rebuilt on the next quiet tick, as the weekly rank was. The table and one group's members are
read with `part=positioning` (`get_group_positioning`), so the other views' answers stay exactly as they were.
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from api.services import group_positioning as GP
from api.services import group_stats_calc as C

_log = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")
KINDS = ("sector", "industry")
SOURCE_PRICES = "UCT's stored daily closes (split-adjusted, price only)"
SOURCE_FILINGS = "SEC filings (XBRL), as filed: each value as known at the reference close (point in time)"
UNIVERSE_NAME = "UCT's stock universe ($300M market value and up), less the funds it lists"
MAP_NAME = "the sector and industry each company's details name (the map GRP and PCHG group by)"

# ── defaults (each one is the builder's, not an owner ruling) ────────────────────────────────
REBUILD_AT_ET = (20, 15)        # a trading day's evening begins here (scan_period's quiet span)
QUIET_HOURS_ET = (7 * 60, 20 * 60 + 15)   # minutes: a weekday between these is busy (scan_period._reuse_quiet_now)
YIELD_S = 0.005                 # the build sleeps this long after every stock it reads, in the quiet span
YIELD_BUSY_S = 0.05             # and this long once the quiet span has ended mid-build (market_history.YIELD_BUSY_S)
MIN_PRICED_SHARE = 0.25         # a build that priced fewer than this share of the universe it read is not held
MAX_SYMBOLS = 8000              # the universe read never exceeds this many symbols
FAIL_RETRY_S = 1200.0           # a failed build waits this long before another is started
LAG_TRIES = 3                   # an evening whose closes or filings fell short is tried again at most this often
MAX_NAME = 80
DISK_VERSION = 1

_lock = threading.Lock()


def _blank_state() -> dict:
    return {
        "answer": None,       # the last complete answer
        "built_for": None,    # the evening (session date, ISO) it was built for
        "built_at": 0.0,
        "retry_at": 0.0,      # no build starts before this
        "inflight": None,     # the running build's done event
        "lag": None,          # (evening, tries) while the closes or the filings fell short of that evening
        "loaded": False,
        "last_build": None,   # {started, seconds, outcome, ...} for the log
    }


_state: dict = _blank_state()


# ── the clock ────────────────────────────────────────────────────────────────────────────────

def now_et() -> datetime:
    return datetime.now(ET)


def quiet(now: datetime) -> bool:
    """Pure: weekends, and weekdays before 07:00 or from 20:15 New York time (the span
    `scan_period._reuse_quiet_now` keeps whole-universe work to; a test pins the two together)."""
    now = now.astimezone(ET)
    if now.weekday() >= 5:
        return True
    hm = now.hour * 60 + now.minute
    return hm < QUIET_HOURS_ET[0] or hm >= QUIET_HOURS_ET[1]


def evening_key(now: datetime) -> str:
    """Pure: the newest trading session whose evening (`REBUILD_AT_ET`) has begun at `now`, as an ISO date."""
    from api.services.session_calendar import is_trading_day
    now = now.astimezone(ET)
    d = now.date()
    at = now.replace(hour=REBUILD_AT_ET[0], minute=REBUILD_AT_ET[1], second=0, microsecond=0)
    if not (is_trading_day(d) and now >= at):
        d -= timedelta(days=1)
        while not is_trading_day(d):
            d -= timedelta(days=1)
    return d.isoformat()


def _years_back(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:                    # 29 February
        return d.replace(year=d.year - years, day=28)


def fund_refs(key_day: date) -> dict:
    """{label: (day, unix seconds of 16:00 New York time that day)}: the evening's session, the same day a
    year earlier and three years earlier. A filing counts at a reference only if it was public by then."""
    out = {}
    for label, years in (("now", 0), ("year_ago", 1), ("three_years_ago", 3)):
        day = _years_back(key_day, years)
        out[label] = (day, datetime(day.year, day.month, day.day, 16, 0, tzinfo=ET).timestamp())
    return out


# ── the reads (each indirected so tests replace it) ─────────────────────────────────────────

def _universe() -> list[str]:
    from api.services import cap_universe
    return sorted(cap_universe.symbols() - cap_universe.etf_symbols())


def _group_map() -> dict:
    """{symbol: {sector, industry}} from the map GRP and PCHG read; {} when it cannot be read."""
    try:
        from api.services.scan_period import _sector_industry_map
        return dict(_sector_industry_map() or {})
    except Exception:  # noqa: BLE001 -- no map is said in the answer (no groups), never a crash
        return {}


def _closes(sym: str) -> dict:
    from api.services.market_intel import price_reads
    return price_reads.daily_closes(sym)


def fundamentals_on() -> bool:
    """The switch the point-in-time routes answer behind (api/routers/fundamentals_pit.py `_enabled`)."""
    return os.environ.get("FUNDAMENTALS_PIT_ENABLED", "0") == "1"


def _artifact_reader() -> tuple[Callable[[str], Optional[dict]], Callable[[], None]]:
    """(read(symbol) -> the company's artifact or None, close()). The store the series route reads, through its
    own source selection, WITHOUT its per-company cache.
    ⚠️ COUPLING, stated: `serving._mode`, `serving._read_key`, `serving._db_conn` and the publish keys
    (`publish.key_for`, `v5_publish.obj_key`); tests/test_group_stats.py fails by name if one is renamed."""
    from api.services.fundamentals_pit import publish as P
    from api.services.fundamentals_pit import serving as SV
    source = SV.current_source()
    conn = SV._db_conn() if SV._mode() == "db" else None

    def read(sym: str) -> Optional[dict]:
        cik = source.cik_for(sym)
        if cik is None:
            return None
        if conn is not None:
            return P.artifact(conn, cik, source.version)
        if source.kind == "v4":
            raw = SV._read_key(P.key_for(cik, source.version))
        else:
            from api.services.fundamentals_pit import v5_publish as VP
            sha = source.object_sha(cik)
            raw = SV._read_key(VP.obj_key(sha)) if sha else None
        return json.loads(raw) if raw else None

    def close() -> None:
        if conn is not None:
            conn.close()

    return read, close


def _clean(name) -> Optional[str]:
    s = " ".join(str(name or "").split())
    return s[:MAX_NAME] if s else None


# ── the build ────────────────────────────────────────────────────────────────────────────────

def _metric_meta() -> list[dict]:
    """The metrics as the views label them: each stored or composed one from the fundamentals catalog
    (its own name, unit, format and method), and the acceleration share, defined here."""
    from api.services.fundamentals_pit import catalog
    cat = catalog.by_id()
    out = []
    for mid in C.FUND_ORDER:
        if mid == C.ACCEL_ID:
            out.append({"id": mid, "name": "Revenue growth accelerating", "category": "Growth", "unit": "percent",
                        "fmt": "pct1", "agg": "share", "composed": False, "subtitle": "Share of members",
                        "methodology": ("The share of members whose newest quarter's year-over-year revenue growth "
                                        "is higher than the quarter before it, both as known at that close. A "
                                        "company with a missing quarter between the two is not counted.")})
            continue
        m = cat[mid]
        out.append({"id": mid, "name": m.name, "category": m.category, "unit": m.unit, "fmt": m.fmt, "agg": "median",
                    "composed": bool(m.compose), "subtitle": m.subtitle, "methodology": m.methodology})
    return out


def build(now: Optional[datetime] = None, *, read_closes: Optional[Callable[[str], dict]] = None,
          read_artifact: Optional[Callable[[str], Optional[dict]]] = None, symbols: Optional[list] = None,
          groups: Optional[dict] = None, pause: Callable[[float], None] = time.sleep,
          yield_s: Optional[float] = None, fund_on: Optional[bool] = None,
          positioning: Optional[Callable[[dict], dict]] = None, yield_busy_s: Optional[float] = None,
          clock: Optional[Callable[[], datetime]] = None) -> dict:
    """The whole build on the calling (background) thread; returns the answer. Reads every stock ONCE (its
    closes, then its filings), then works out every group's figures, then each group's positioning from the three
    held stores (`positioning(sym_groups)`, `group_positioning.build` unless a test gives one).
    After each stock it pauses `yield_s`, or `yield_busy_s` from the first stock at which `clock()` is past the quiet
    span (the build goes on to the end). `clock` is the real clock, or `now` held still when the caller gives `now`."""
    started, cpu0 = time.time(), time.process_time()
    if clock is None:
        clock = (lambda: now) if now is not None else now_et
    now = now or now_et()
    key = evening_key(now)
    refs = fund_refs(date.fromisoformat(key))
    read_closes = read_closes or _closes
    yield_s = YIELD_S if yield_s is None else yield_s
    yield_busy_s = YIELD_BUSY_S if yield_busy_s is None else yield_busy_s
    symbols = list(symbols if symbols is not None else _universe())[:MAX_SYMBOLS]
    groups = groups if groups is not None else _group_map()
    fund_on = fundamentals_on() if fund_on is None else fund_on
    close_reader: Callable[[], None] = lambda: None
    reader = read_artifact if fund_on else None       # switched off: no filing is read at all
    if fund_on and reader is None:
        try:
            reader, close_reader = _artifact_reader()
        except Exception as exc:  # noqa: BLE001 -- no store: the fundamentals say so; breadth still builds
            _log.warning("[group-stats] the fundamentals store could not be opened (%s)", type(exc).__name__)
            reader = None

    members = {k: Counter() for k in KINDS}
    fund_members = {k: Counter() for k in KINDS}
    fund_vals = {k: defaultdict(lambda: defaultdict(lambda: defaultdict(list))) for k in KINDS}
    tails: dict = {}
    sym_groups: dict = {}
    day_counts: Counter = Counter()
    counts = Counter()
    t_prices = t_filings = 0.0
    busy_after: Optional[int] = None      # stocks read before the quiet span ended, once it has
    try:
        for sym in symbols:
            g = groups.get(sym) or {}
            mine = tuple((k, _clean(g.get(k))) for k in KINDS)
            if not any(name for _, name in mine):
                counts["not_mapped"] += 1
                continue
            counts["mapped"] += 1
            sym_groups[sym] = mine
            for k, name in mine:
                if name:
                    members[k][name] += 1
            t0 = time.process_time()
            try:
                got = read_closes(sym)
            except Exception:  # noqa: BLE001 -- one symbol never stops the build
                got = None
            closes = list((got or {}).get("closes") or ()) if (got or {}).get("status") == "ok" else []
            at = {label: None for label in C.REFS}
            if closes:
                counts["priced"] += 1
                days, vals = C.tail(closes, max(C.TAIL_SESSIONS, C.RANK_TAIL))
                if len(days):
                    tails[sym] = (days, vals)
                    day_counts.update(days)
                at = {label: C.close_on_or_before(closes, day) for label, (day, _ts) in refs.items()}
            else:
                counts["not_priced"] += 1
            del closes, got
            t_prices += time.process_time() - t0
            if reader is not None:
                t1 = time.process_time()
                try:
                    art = reader(sym)
                except Exception:  # noqa: BLE001
                    art = None
                    counts["filings_failed"] += 1
                metrics = art.get("metrics") if isinstance(art, dict) else None
                if isinstance(metrics, dict):
                    keep = {s: metrics.get(s) for s in C.SERIES_NEEDED if metrics.get(s)}
                    del art, metrics
                    have_now = False
                    for label, (day, ts) in refs.items():
                        vals_at = C.stock_fundamentals(keep, ts, day, at[label])
                        if label == "now" and vals_at:
                            have_now = True
                        for k, name in mine:
                            if name:
                                for mid, v in vals_at.items():
                                    fund_vals[k][name][mid][label].append(v)
                    if have_now:
                        counts["with_filings"] += 1
                        for k, name in mine:
                            if name:
                                fund_members[k][name] += 1
                    else:
                        counts["filings_not_current"] += 1
                else:
                    counts["no_filings"] += 1
                t_filings += time.process_time() - t1
            if busy_after is None and not quiet(clock()):
                busy_after = counts["mapped"] - 1          # the quiet span ended: every pause from here is the busy one
            wait = yield_s if busy_after is None else yield_busy_s
            if wait > 0:
                pause(wait)
    finally:
        try:
            close_reader()
        except Exception:  # noqa: BLE001
            pass

    t2 = time.process_time()
    sessions, session = C.sessions_from(day_counts, len(tails))
    del day_counts
    targets: dict = {}
    line_days: tuple = ()
    if session is not None:
        i = len(sessions) - 1
        for label, back in C.OFFSETS:
            if i - back >= 0:
                targets[label] = sessions[i - back]
        line_days = sessions[-C.LINE_SESSIONS:]
    points = C.week_points(sessions) if session is not None else ()
    tallies = {k: {} for k in KINDS}
    rank_members = {k: defaultdict(list) for k in KINDS}
    t_rank = 0.0
    if targets:
        for sym, (days, vals) in tails.items():
            # breadth reads the same last TAIL_SESSIONS closes it always did; the longer tail is the rank's
            b = C.stock_breadth(days[-C.TAIL_SESSIONS:], vals[-C.TAIL_SESSIONS:], targets, line_days)
            t3 = time.process_time()
            chg = C.stock_changes(days, vals, points)
            t_rank += time.process_time() - t3
            for k, name in sym_groups.get(sym, ()):
                if name:
                    t = tallies[k].get(name)
                    if t is None:
                        t = tallies[k][name] = C.BreadthTally(len(line_days))
                    t.add(b)
                    rank_members[k][name].append(chg)
    tails.clear()
    t3 = time.process_time()
    rank_hist = {k: C.group_rank_history(rank_members[k], len(points)) for k in KINDS} if points else {}
    rank_members.clear()
    t_rank += time.process_time() - t3
    t_breadth = time.process_time() - t2 - t_rank

    # positioning runs after the closes are let go, so the build's peak is the larger of the two passes, not their sum
    t4 = time.process_time()
    try:
        pos = (positioning or GP.build)(sym_groups)
    except Exception as exc:  # noqa: BLE001 -- said as every part's state; the rest of the build stands
        _log.warning("[group-stats] positioning could not be worked out (%s)", type(exc).__name__)
        pos = GP.failed()
    t_pos = time.process_time() - t4

    iso = lambda o: date.fromordinal(o).isoformat()
    rank_dates = [iso(p) if p is not None else None for p in points]
    ranked = {k: Counter() for k in KINDS}
    kinds_out = {}
    for k in KINDS:
        blocks = {}
        for name in sorted(members[k]):
            fund = {}
            per_metric = fund_vals[k].get(name) or {}
            for mid in C.FUND_ORDER:
                per = per_metric.get(mid) or {}
                if mid == C.ACCEL_ID:
                    fund[mid] = {label: C.share(per.get(label) or ()) for label in C.REFS}
                else:
                    fund[mid] = {label: C.summarize(per.get(label) or ()) for label in C.REFS}
            tally = tallies[k].get(name)
            rk = None
            if points:
                hist, ofs = rank_hist[k]
                rk = _rank_of(hist.get(name), ofs, rank_dates)
                ranked[k]["ranked" if rk[C.RANK_PRIMARY]["now"]["position"] is not None else "unranked"] += 1
            blocks[name] = {"name": name, "members": members[k][name], "fund_members": fund_members[k][name],
                            "fund": fund, "breadth": tally.result() if tally is not None else None, "rank": rk}
        _rank_blocks(blocks)
        kinds_out[k] = blocks

    lag = []
    if session is None or iso(session) < key:
        lag.append("prices")
    if fund_on and not counts["with_filings"]:
        lag.append("filings")
    answer = {
        "status": "ok",
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "built_for": key,
        "session": iso(session) if session is not None else None,
        "sessions": {label: iso(d) for label, d in targets.items()},
        "line_dates": [iso(d) for d in line_days],
        "fund_refs": {label: day.isoformat() for label, (day, _ts) in refs.items()},
        "fundamentals": {"state": ("ok" if counts["with_filings"] else "unavailable") if fund_on else "off",
                         "source": SOURCE_FILINGS, "with_data": counts["with_filings"]},
        "breadth": {"state": "ok" if session is not None else "unavailable", "source": SOURCE_PRICES,
                    "priced": counts["priced"]},
        "rank": {"state": "ok" if points else "unavailable", "source": SOURCE_PRICES, "dates": rank_dates,
                 "weeks": C.RANK_WEEKS, "measures": [{"id": mid, "sessions": bars} for mid, bars in C.RANK_MEASURES],
                 "of": {k: rank_hist[k][1] for k in KINDS} if points else {},
                 "counted": {k: {"groups": len(members[k]), "ranked": ranked[k]["ranked"],
                                 "unranked": ranked[k]["unranked"]} for k in KINDS}},
        "universe": {"name": UNIVERSE_NAME, "map": MAP_NAME, "symbols": len(symbols), "mapped": counts["mapped"],
                     "not_mapped": counts["not_mapped"]},
        "lagging": lag,
        "kinds": kinds_out,
        "positioning": pos,
        "build": {"seconds": round(time.time() - started, 1), "cpu_seconds": round(time.process_time() - cpu0, 1),
                  "prices_cpu_s": round(t_prices, 1), "filings_cpu_s": round(t_filings, 1),
                  "groups_cpu_s": round(t_breadth, 1), "rank_cpu_s": round(t_rank, 2),
                  "positioning_cpu_s": round(t_pos, 2), "counts": dict(counts), "busy_after": busy_after},
        "metrics": _metric_meta(),
    }
    return answer


def _rank_of(hist: Optional[dict], ofs: dict, dates: list) -> dict:
    """One group's weekly rank on each measure: its lines (rank, median, members with a change) and the summary
    (`group_stats_calc.rank_summary`). A group none of whose members has a change is every point with no rank."""
    n = len(dates)
    out = {}
    for mid, _bars in C.RANK_MEASURES:
        m = (hist or {}).get(mid) or {"rank": [None] * n, "median": [None] * n, "n": [0] * n}
        out[mid] = {**m, **C.rank_summary(m["rank"], ofs.get(mid) or [0] * n, m["n"], m["median"], dates)}
    return out


def _rank_blocks(blocks: dict) -> None:
    """Each group's rank among the groups of its kind, per metric (highest median or share first) and per
    breadth share (now), in place. A group with no figure has no rank."""
    for mid in C.FUND_ORDER:
        key = "share" if mid == C.ACCEL_ID else "median"
        ranks = C.rank({n: (b["fund"][mid]["now"] or {}).get(key) for n, b in blocks.items()})
        for n, b in blocks.items():
            b["fund"][mid]["rank"] = ranks.get(n)
    for k in C.BREADTH_SHARES:
        ranks = C.rank({n: ((b["breadth"] or {}).get(k) or {}).get("now", {}).get("share") for n, b in blocks.items()})
        for n, b in blocks.items():
            if b["breadth"] is not None:
                b["breadth"][k]["rank"] = ranks.get(n)
    ranks = C.rank({n: (b["breadth"] or {}).get("net_highs") for n, b in blocks.items()})
    for n, b in blocks.items():
        if b["breadth"] is not None:
            b["breadth"]["net_highs_rank"] = ranks.get(n)


# ── the one background build ─────────────────────────────────────────────────────────────────

def _positioning_said(pos: Optional[dict]) -> str:
    """Each positioning part's state and how many stocks it covered, for the build's one log line."""
    parts = (pos or {}).get("parts") or {}
    return " ".join(f"{p}={(parts.get(p) or {}).get('state')}/{(parts.get(p) or {}).get('covered', '-')}"
                    for p in ("short", "insider", "funds"))


def too_thin(answer: dict) -> Optional[str]:
    """Why a finished build is not good enough to hold, in words for the log, or None. It priced no stock, or fewer
    than `MIN_PRICED_SHARE` of the stocks it read, or found no session (so no breadth and no rank)."""
    priced = int(((answer.get("build") or {}).get("counts") or {}).get("priced") or 0)
    universe = int((answer.get("universe") or {}).get("symbols") or 0)
    if priced == 0 or priced < MIN_PRICED_SHARE * universe:
        return f"priced {priced} of {universe} stocks"
    if answer.get("session") is None:
        return "no session in the closes"
    return None


def _run_build(done: threading.Event) -> None:
    started = time.time()
    said, level = "failed", logging.WARNING
    try:
        answer = build()
        thin = too_thin(answer)
        if thin is not None:
            # never held, never written: the last good answer and its disk copy stay; tried again, within LAG_TRIES
            with _lock:
                key, prev = answer["built_for"], _state["lag"]
                tries = prev[1] + 1 if prev and prev[0] == key else 1
                _state["lag"] = (key, tries)
                _state["retry_at"] = time.time() + FAIL_RETRY_S
            said = f"failed ({thin}; not held, the last answer stays; try {tries} of {LAG_TRIES} for {key})"
            return
        with _lock:
            prev = _state["lag"]
            key = answer["built_for"]
            _state["answer"] = answer
            _state["built_for"] = key
            _state["built_at"] = time.time()
            if answer["lagging"]:
                tries = prev[1] + 1 if prev and prev[0] == key else 1
                _state["lag"] = (key, tries)
            else:
                _state["lag"] = None
        _save_disk()
        b = answer["build"]
        said = (f"session={answer['session']} for={answer['built_for']} lagging={answer['lagging'] or 'no'} "
                f"busy_after={b.get('busy_after')} "
                f"cpu={b['cpu_seconds']}s prices={b['prices_cpu_s']}s filings={b['filings_cpu_s']}s "
                f"groups={b['groups_cpu_s']}s rank={b.get('rank_cpu_s')}s counts={b['counts']} "
                f"ranked={(answer.get('rank') or {}).get('counted')} positioning={b.get('positioning_cpu_s')}s "
                f"{_positioning_said(answer.get('positioning'))}")
        level = logging.INFO
    except Exception as exc:  # noqa: BLE001 -- a failed build is said and tried again later, never "computing" for ever
        said = f"failed ({type(exc).__name__})"
        with _lock:
            _state["retry_at"] = time.time() + FAIL_RETRY_S
    finally:
        secs = round(time.time() - started, 1)
        with _lock:
            _state["last_build"] = {"started": started, "seconds": secs, "outcome": said}
            _state["inflight"] = None
        _log.log(level, "[group-stats] %s; %.1fs", said, secs)
        done.set()


def _start_job() -> threading.Event:
    with _lock:
        done = _state["inflight"]
        if done is None:
            done = _state["inflight"] = threading.Event()
            threading.Thread(target=_run_build, args=(done,), daemon=True, name="group-stats-build").start()
        return done


def refresh_due(now: Optional[datetime] = None, at: Optional[float] = None) -> bool:
    """True when nothing is running, no retry wait is on, and the held answer is older than the newest
    session's evening, or that evening fell short (closes or filings) and has been tried fewer than
    `LAG_TRIES` times. A build that priced too little to hold counts against the same tries: with nothing held,
    or only an older evening's answer, the evening is not tried again once `LAG_TRIES` builds of it priced too
    little. Pure over the module's state."""
    now = now or now_et()
    at = time.time() if at is None else at
    with _lock:
        if _state["inflight"] is not None or at < _state["retry_at"]:
            return False
        ans, built_for, lag = _state["answer"], _state["built_for"], _state["lag"]
    key = evening_key(now)
    if lag and lag[0] == key and lag[1] >= LAG_TRIES and (ans is None or built_for is None or built_for < key):
        return False                            # this evening's tries are spent; the next evening tries again
    if ans is None:
        return True
    if "rank" not in ans:                       # held from before the weekly rank: the next quiet tick builds it
        return True
    if "positioning" not in ans:                # held from before positioning: likewise
        return True
    if built_for is None or built_for < key:
        return True
    return bool(lag and lag[0] == key and lag[1] < LAG_TRIES)


def refresh_if_due(now: Optional[datetime] = None) -> bool:
    """Start the one background build when the clock is in the quiet span and a rebuild is due. Returns True
    when this call started it. Called by the scheduler only, never on a member's request."""
    _ensure_loaded()
    now = now or now_et()
    if not quiet(now) or not refresh_due(now):
        return False
    _start_job()
    return True


def scheduled_refresh() -> None:
    """The scheduler's evening tick (api/main.py). Never raises."""
    try:
        if refresh_if_due():
            _log.info("[group-stats] evening build started")
    except Exception as exc:  # noqa: BLE001
        _log.warning("[group-stats] the evening build could not start (%s)", type(exc).__name__)


# ── disk ─────────────────────────────────────────────────────────────────────────────────────

def _disk_path() -> Optional[str]:
    base = os.environ.get("DATA_DIR", "/data")
    return os.path.join(base, "group_stats", f"group_stats_v{DISK_VERSION}.json") if os.path.isdir(base) else None


def _save_disk() -> None:
    path = _disk_path()
    if not path:
        return
    with _lock:
        doc = {"v": DISK_VERSION, "answer": _state["answer"], "built_for": _state["built_for"],
               "built_at": _state["built_at"], "lag": _state["lag"]}
    try:
        blob = json.dumps(doc, separators=(",", ":"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".group_stats_", suffix=".tmp", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(blob)
            os.replace(tmp, path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:  # noqa: BLE001 -- the answer is still held in memory
        _log.warning("[group-stats] the answer could not be written to disk (%s)", type(exc).__name__)


def _load_disk() -> Optional[dict]:
    path = _disk_path()
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("v") != DISK_VERSION:
        return None
    ans = doc.get("answer")
    if not isinstance(ans, dict) or ans.get("status") != "ok" or not isinstance(ans.get("kinds"), dict):
        return None
    try:
        date.fromisoformat(doc.get("built_for"))
    except (TypeError, ValueError):
        return None
    lag = doc.get("lag")
    lag = (lag[0], int(lag[1])) if isinstance(lag, list) and len(lag) == 2 else None
    return {"answer": ans, "built_for": doc["built_for"], "built_at": min(float(doc.get("built_at") or 0.0), time.time()),
            "lag": lag}


def _ensure_loaded() -> None:
    with _lock:
        if _state["loaded"]:
            return
    doc = _load_disk()
    with _lock:
        if _state["loaded"]:
            return
        _state["loaded"] = True
        if doc and _state["answer"] is None:
            _state.update(doc)


# ── the reads the route makes ────────────────────────────────────────────────────────────────

def _key(name) -> str:
    """A group name compared: case, spacing and punctuation do not count, `&` is "and" (GRP's groupKey)."""
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower().replace("&", " and "))


def _find(blocks: dict, name: str) -> Optional[dict]:
    if name in blocks:
        return blocks[name]
    k = _key(name)
    hits = [b for n, b in blocks.items() if _key(n) == k] if k else []
    return hits[0] if len(hits) == 1 else None


def _fund_part(ans: dict, on: bool) -> dict:
    if not on:
        return {"state": "off", "source": SOURCE_FILINGS, "with_data": None}
    part = dict(ans.get("fundamentals") or {})
    if part.get("state") == "off":           # switched on since the held answer was built
        part["state"] = "pending"
    return part


def _rank_part(ans: dict) -> dict:
    """The weekly rank's build-wide state: 'pending' when the held answer was built before the rank existed."""
    rk = ans.get("rank")
    if not isinstance(rk, dict):
        return {"state": "pending", "source": SOURCE_PRICES, "dates": []}
    return {"state": rk.get("state"), "source": rk.get("source"), "weeks": rk.get("weeks"),
            "measures": rk.get("measures") or [], "dates": rk.get("dates") or [], "min_members": C.MIN_MEMBERS}


_RANK_BRIEF = ("now", *(label for label, _b in C.RANK_BACK), "best", "worst", "weeks_ranked")


def _brief_rank(r: Optional[dict]) -> Optional[dict]:
    """The table's rank: each measure's points (now, 4, 13 and 52 weeks back with the places moved, the best and the
    worst), and the weekly line of the 6-month rank."""
    if not isinstance(r, dict):
        return None
    out = {}
    for mid, _bars in C.RANK_MEASURES:
        m = r.get(mid) or {}
        part = {key: m.get(key) for key in _RANK_BRIEF}
        if mid == C.RANK_PRIMARY:
            part["line"] = m.get("rank") or []
        out[mid] = part
    return out


def _full_rank(r: Optional[dict], ans: dict, kind: str) -> Optional[dict]:
    """One group's rank in full: each measure's points and its weekly lines, with how many groups were ranked each
    week (`of_line`)."""
    if not isinstance(r, dict):
        return None
    ofs = (((ans.get("rank") or {}).get("of") or {}).get(kind)) or {}
    return {mid: {**(r.get(mid) or {}), "of_line": ofs.get(mid) or []} for mid, _bars in C.RANK_MEASURES}


def _common(ans: dict, kind: str, on: bool, running: bool) -> dict:
    return {
        "status": "ok", "kind": kind, "built_at": ans.get("built_at"), "built_for": ans.get("built_for"),
        "session": ans.get("session"), "sessions": ans.get("sessions") or {}, "fund_refs": ans.get("fund_refs") or {},
        # the build-wide state of each source; a group's own figures ride under `fund`, `breadth` and `rank`
        "sources": {"fundamentals": _fund_part(ans, on), "breadth": ans.get("breadth") or {}, "rank": _rank_part(ans)},
        "universe": ans.get("universe") or {},
        "lagging": ans.get("lagging") or [], "metrics": ans.get("metrics") or [], "min_members": C.MIN_MEMBERS,
        "refreshing": running,
    }


def _brief_breadth(b: Optional[dict]) -> Optional[dict]:
    """The table's breadth: each share now with its count, and its change in points from a week and a month ago."""
    if b is None:
        return None
    out = {}
    for k in C.BREADTH_SHARES:
        m = b.get(k) or {}
        now = m.get("now") or {}
        out[k] = {"share": now.get("share"), "n": now.get("n"), "count": now.get("count"),
                  "week_change": C.change_points(now.get("share"), (m.get("week") or {}).get("share")),
                  "month_change": C.change_points(now.get("share"), (m.get("month") or {}).get("share"))}
    for k in ("new_highs", "new_lows", "net_highs", "advance_decline", "priced"):
        out[k] = b.get(k)
    return out


def _brief_fund(fund: dict, on: bool) -> Optional[dict]:
    if not on:
        return None
    out = {}
    for mid, m in (fund or {}).items():
        now, ago = m.get("now") or {}, m.get("year_ago") or {}
        key = "share" if mid == C.ACCEL_ID else "median"
        out[mid] = {"n": now.get("n"), "value": now.get(key), "year_ago": {"n": ago.get("n"), "value": ago.get(key)}}
    return out


def get_group_stats(kind: str = "sector", name: Optional[str] = None) -> dict:
    """Every group of a kind (the table), or one group in full (`name`). NEVER builds: it reads what this module
    holds. Before the first build: `not_built` (or `computing` while the first one runs)."""
    if kind not in KINDS:
        return {"status": "error", "detail": "kind must be sector or industry"}
    _ensure_loaded()
    with _lock:
        ans = _state["answer"]
        running = _state["inflight"] is not None
    if ans is None or ans.get("status") != "ok":
        if running:
            return {"status": "computing", "kind": kind}
        return {"status": "not_built", "kind": kind,
                "detail": ("The group figures are worked out once each evening after the close (from 8:15 PM New "
                           "York time), and the first one has not run on this server yet.")}
    on = fundamentals_on()
    blocks = (ans.get("kinds") or {}).get(kind) or {}
    out = _common(ans, kind, on, running)
    if name is None:
        out["groups"] = [{"name": b["name"], "members": b["members"], "fund_members": b["fund_members"] if on else None,
                          "fund": _brief_fund(b.get("fund"), on), "breadth": _brief_breadth(b.get("breadth")),
                          "rank": _brief_rank(b.get("rank"))}
                         for b in blocks.values()]
        out["count"] = len(out["groups"])
        return out
    asked = " ".join(str(name).split())[:MAX_NAME]
    hit = _find(blocks, asked)
    out.update({"name": asked, "peers": len(blocks)})
    if hit is None:
        out["found"] = False
        return out
    out.update({"found": True, "name": hit["name"], "members": hit["members"],
                "fund_members": hit["fund_members"] if on else None,
                "fund": hit.get("fund") if on else None, "breadth": hit.get("breadth"),
                "rank": _full_rank(hit.get("rank"), ans, kind),
                "line_dates": ans.get("line_dates") or []})
    return out


def get_group_positioning(kind: str = "sector", name: Optional[str] = None) -> dict:
    """GRPS CROWDING: every group of a kind with its positioning (the table), or one group's positioning with its
    members and their own figures (`name`). NEVER builds and never reads a store: it reads what this module holds.
    The other parts of the answer (fundamentals, breadth, rank) are left out, so this answer stays small."""
    if kind not in KINDS:
        return {"status": "error", "detail": "kind must be sector or industry"}
    _ensure_loaded()
    with _lock:
        ans = _state["answer"]
        running = _state["inflight"] is not None
    if ans is None or ans.get("status") != "ok":
        if running:
            return {"status": "computing", "kind": kind, "part": "positioning"}
        return {"status": "not_built", "kind": kind, "part": "positioning",
                "detail": ("The group figures are worked out once each evening after the close (from 8:15 PM New "
                           "York time), and the first one has not run on this server yet.")}
    pos = ans.get("positioning")
    names = (ans.get("kinds") or {}).get(kind) or {}
    blocks = ((pos or {}).get("kinds") or {}).get(kind) or {}
    out = _common(ans, kind, fundamentals_on(), running)
    out["part"] = "positioning"
    out["sources"]["positioning"] = GP.parts_view(pos)
    if name is None:
        out["groups"] = [{"name": b["name"], "members": b["members"], "positioning": GP.brief(blocks.get(b["name"]))}
                         for b in names.values()]
        out["count"] = len(out["groups"])
        return out
    asked = " ".join(str(name).split())[:MAX_NAME]
    hit = _find(names, asked)
    out.update({"name": asked, "peers": len(names)})
    if hit is None:
        out["found"] = False
        return out
    block = blocks.get(hit["name"])
    out.update({"found": True, "name": hit["name"], "members": hit["members"], "positioning": GP.brief(block),
                **GP.member_rows(pos, block)})
    return out


def held_answer() -> tuple[Optional[dict], str]:
    """READ ONLY: the whole held answer and how it is held ('held' | 'not_held'). Never starts a build."""
    _ensure_loaded()
    with _lock:
        ans = _state["answer"]
    return ans, ("held" if ans and ans.get("status") == "ok" else "not_held")


def last_build() -> Optional[dict]:
    with _lock:
        return dict(_state["last_build"]) if _state["last_build"] else None


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds."""
    with _lock:
        _state.clear()
        _state.update(_blank_state())
