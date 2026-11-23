"""ERNSC: earnings season by sector. Which sectors are beating, by how much, and how the market is reacting.

ERNS shows one day's reporters, EMOV who moved on each day, ERX one stock's reactions; this rolls a whole season up by
sector, from what UCT ALREADY HOLDS. The definitions (the season, beat / in line / miss, the reaction, the floor) are in
`sector_earnings_calc` (pure, tested on invented numbers).

WHERE THE NUMBERS COME FROM (all held on this server; NOTHING HERE ASKS A VENDOR):

  results   the earnings model the Research Earnings tab, ERX and ERNS's past moves read, by
            `earnings_intel.get_earnings_held`'s own rule (the copy in memory, else the one in the snapshot store on disk,
            at any age up to the model's own 45-day limit; never a build, never a provider call), over one store
            connection for the whole pass (`held_copies`, which says why). Each copy holds up to 12 reported
            quarters with the actual and the consensus EPS and revenue (FMP, then Finnhub) and the surprise, each report's
            (announcement) date, the next report date, and the measured move of each of the last 8 reports from UCT's own
            daily bars. The scheduled panel prewarm (PANEL_PREWARM_ENABLED) walks the whole universe 40 stocks at a time
            and keeps these copies on disk, and a member's view refreshes one. ONLY the stocks with a copy are counted,
            and every answer says how many of the universe that is.
  stocks    `group_stats._universe()`: the site's stock universe less its funds (GRPS's own).
  sectors   the map GRPS, GRP and PCHG group by (`group_stats._group_map`), cleaned as GRPS cleans it
            (`group_stats._clean`), so a sector here is spelled exactly as GRPS spells it.

NOT USED, and why (the other places results live): the Calendar's weeks (`api/routers/calendar.py`: this week in memory,
another week in the shared cache for an hour or six, built from Finnhub, FMP and Finviz on a miss, a finished day capped at
150 reporters a session) are not a store of a season: reading thirteen weeks back would be a provider call per week. The
Calendar's reactions (`/api/calendar/reactions`, what EMOV reads) are one day each, in the shared cache, worked out with a
bars request per reporter on a miss. ERNS (`earnings_season.py`) is built from those two for a week either side of today.

HOW OFTEN: a request NEVER reads the store. It answers from what this module holds (`held_build.HeldBuild`, in memory and
on disk, so a restart serves the last answer at once), and ONE background thread re-reads the copies when the held answer
is more than REFRESH_S old or was built on another day (the seasons and "still to report" move with the date). With nothing
held a request waits a few seconds on that one read, then says `computing`.

BOUNDS AND COST: at most `group_stats.MAX_SYMBOLS` stocks; each copy is read, reduced to one small tuple per season it
reported in (`sector_earnings_calc.ROW_FIELDS`) and dropped, with a short pause after each stock (YIELD_S).
MEASURED (2026-11-22, the dev PC, not production: 3,500 invented copies of about 13.7 KB each through the real snapshot
store, best of three, no pause): 2.0 s of CPU per build; +6.4 MB at the build's peak and 4.5 MB held with the answer
(measured in a separate run under tracemalloc), 1.26 MB of JSON on disk; a table answer is about 14 KB and the largest
sector's (281 reporters) about 87 KB. Reading each stock through `get_earnings_held` instead was 4.6 times the CPU (38 s
against 8.3 s, both timed under tracemalloc): see `held_copies`.

Every constant below is the builder's default, not an owner ruling.
"""
from __future__ import annotations

import json
import time
from collections import Counter
from datetime import date, datetime
from typing import Callable, Iterator, Optional

from api.services import group_stats as GS
from api.services import held_build
from api.services import sector_earnings_calc as C

SOURCE = ("UCT's held copy of each stock's earnings results (the Research Earnings tab's model: actual and consensus EPS "
          "and revenue from FMP and Finnhub)")
REACTION_SOURCE = "UCT's stored daily bars: the close before the report to the close after it"
REFRESH_S = 30 * 60.0
YIELD_S = 0.002
COPY_OLD_DAYS = 7
DEFAULT_SEASON = "current"
ANSWER_VERSION = 1
DISK = ("sector_earnings", f"sector_earnings_v{ANSWER_VERSION}.json")


def _today() -> date:
    return datetime.now(C.ET).date()


def held_copies(symbols: list) -> Iterator[tuple[str, Optional[dict]]]:
    """(symbol, the copy UCT holds or None) for every symbol, by `earnings_intel.get_earnings_held`'s own rule (the copy in
    memory if it carries the quarterly series, else the one in the snapshot store if it does and is at most `_STALE_MAX`
    old), but over ONE store connection for the whole pass. Never a build, never a provider call.

    WHY NOT CALL `get_earnings_held` PER STOCK: each call opens two SQLite connections (the store's `_ensure_init` and its
    read) and closing the last connection to a WAL file checkpoints it; measured on the dev PC (2026-11-22, 3,500 invented
    copies through the real store, both timed under tracemalloc) that was 38 s of CPU against 8.3 s with one connection
    (2.0 s without tracemalloc). Both modules are in flow-worker's import closure, so the one-connection read lives here
    rather than there.
    ⚠️ COUPLING, stated: `earnings_intel._KIND`, `_has_quarterly`, `_STALE_MAX`, the shared cache's key
    f"{_KIND}::{SYMBOL}", and the store's `_ensure_init`, `_connect` and its `fund_snapshots (kind, ticker, payload,
    updated_at)` table. tests/test_sector_earnings.py checks this read gives `get_earnings_held`'s answer case by case
    (fresh, too old, no quarters, held in memory, absent) and fails by name if one of these is renamed."""
    from api.services import earnings_intel as EI
    from api.services import fundamentals_snapshot_store as store
    from api.services.cache import cache
    now = time.time()
    conn = None
    try:
        store._ensure_init()
        conn = store._connect()
    except Exception:  # noqa: BLE001 -- no store: only the copies in memory are held
        conn = None
    try:
        for sym in symbols:
            key = str(sym or "").upper().strip()
            hit = cache.get(f"{EI._KIND}::{key}") if key else None
            if isinstance(hit, dict) and EI._has_quarterly(hit):
                yield sym, hit
                continue
            payload = None
            if conn is not None and key:
                try:
                    row = conn.execute("SELECT payload, updated_at FROM fund_snapshots WHERE kind=? AND ticker=?",
                                       (EI._KIND, key)).fetchone()
                    if row:
                        got = json.loads(row[0])
                        if isinstance(got, dict) and EI._has_quarterly(got) and max(0.0, now - row[1]) <= EI._STALE_MAX:
                            payload = got
                except Exception:  # noqa: BLE001 -- one unreadable copy is "not held"
                    payload = None
            yield sym, payload
    finally:
        if conn is not None:
            conn.close()


def _is_trading_day(d: date) -> bool:
    from api.services.session_calendar import is_trading_day
    return is_trading_day(d)


# ── the build (background thread only) ───────────────────────────────────────────────────────

def build(previous: Optional[dict] = None, *, symbols: Optional[list] = None, groups: Optional[dict] = None,
          read: Optional[Callable[[str], Optional[dict]]] = None, today: Optional[date] = None,
          trading_day: Optional[Callable[[date], bool]] = None, pause: Callable[[float], None] = time.sleep,
          yield_s: Optional[float] = None) -> tuple:
    """Read every stock's held copy ONCE (`held_copies`, one store connection; `read`, one stock at a time, for tests) and
    work out every season. Returns `(answer, note)` for `held_build`."""
    started, cpu0 = time.time(), time.process_time()
    today = today or _today()
    spans = C.seasons(today)
    symbols = list(symbols if symbols is not None else GS._universe())[:GS.MAX_SYMBOLS]
    groups = groups if groups is not None else GS._group_map()
    trading_day = trading_day or _is_trading_day
    yield_s = YIELD_S if yield_s is None else yield_s
    old_line = date.fromordinal(today.toordinal() - COPY_OLD_DAYS).isoformat()
    stocks: list = []
    counts: Counter = Counter()
    oldest = newest = None

    def one_by_one():
        for s in symbols:
            try:
                yield s, read(s)
            except Exception:  # noqa: BLE001 -- one unreadable copy is "not held", never a failed build
                counts["read_failed"] += 1
                yield s, None

    for sym, payload in (held_copies(symbols) if read is None else one_by_one()):
        if not isinstance(payload, dict):
            counts["not_held"] += 1
        else:
            counts["held"] += 1
            seen = C.built_day(payload)
            if seen:
                oldest = seen if oldest is None or seen < oldest else oldest
                newest = seen if newest is None or seen > newest else newest
                if seen < old_line:
                    counts["copies_old"] += 1
            got = C.stock_seasons(sym, payload, spans, today, trading_day)
            sector = GS._clean((groups.get(sym) or {}).get("sector"))
            if sector is None:
                counts["no_sector"] += 1
            if got:
                stocks.append({"symbol": sym, "sector": sector, "seasons": got})
        del payload
        if yield_s > 0:
            pause(yield_s)
    slices = {sid: C.season_slice(stocks, sid) for sid in C.SEASON_IDS}
    reported = {sid: s["total"]["reported"] for sid, s in slices.items()}
    answer = {
        "status": "ok", "v": ANSWER_VERSION, "built_at": held_build.now_iso(), "today": today.isoformat(),
        "source": SOURCE, "reaction_source": REACTION_SOURCE, "map": GS.MAP_NAME, "universe_name": GS.UNIVERSE_NAME,
        "season_rule": C.SEASON_RULE, "in_line_pct": C.IN_LINE_PCT, "in_line_abs": C.IN_LINE_ABS,
        "min_reporters": C.MIN_REPORTERS,
        "coverage": {"universe": len(symbols), "held": counts["held"], "not_held": counts["not_held"],
                     "no_sector": counts["no_sector"], "oldest_copy": oldest, "newest_copy": newest,
                     "copies_old": counts["copies_old"], "old_days": COPY_OLD_DAYS},
        "seasons": spans,
        "slices": slices,
        "build": {"seconds": round(time.time() - started, 2), "cpu_seconds": round(time.process_time() - cpu0, 2),
                  "counts": dict(counts)},
    }
    return answer, (f"universe={len(symbols)} held={counts['held']} reported={reported} "
                    f"cpu={answer['build']['cpu_seconds']}s")


def _due(answer: dict, checked: float) -> bool:
    return time.time() - checked >= REFRESH_S or answer.get("today") != _today().isoformat()


def _valid(answer: dict) -> bool:
    slices = answer.get("slices")
    return (answer.get("status") == "ok" and answer.get("v") == ANSWER_VERSION and isinstance(slices, dict)
            and all(isinstance(slices.get(sid), dict) for sid in C.SEASON_IDS))


_held = held_build.HeldBuild("sector-earnings", lambda previous: build(previous), _due, disk=DISK,
                             version=ANSWER_VERSION, valid=_valid)


# ── the read the route makes ─────────────────────────────────────────────────────────────────

def get_season(season: str = DEFAULT_SEASON, sector: Optional[str] = None) -> dict:
    """One season: every sector's figures and the total (no `sector`), or one sector with every reporter, the stocks still
    to report and the ones whose result has not reached UCT yet. The season that holds today carries each sector's figures
    for the same season a year earlier beside it (`year_ago`). NEVER reads the store on the request."""
    if season not in C.SEASON_IDS:
        return {"status": "error", "detail": "season must be current, previous or year_ago"}
    got = _held.get()
    if got.get("status") != "ok":
        return {**got, "season": season}
    slices = got.get("slices") or {}
    blank = {"total": C.figures([]) | {"to_report": 0, "awaiting": 0}, "sectors": []}
    sl = slices.get(season) or blank
    ago = (slices.get("year_ago") or blank) if season == "current" else None
    ago_by = {s["name"]: s for s in ago["sectors"]} if ago else {}
    out = {k: v for k, v in got.items() if k not in ("slices", "build")}
    out["season"] = season
    out["total"] = {**C.brief(sl["total"]), "year_ago": C.brief(ago["total"]) if ago else None}
    if sector is None:
        out["sectors"] = [{**C.brief(s), "year_ago": C.brief(ago_by.get(s["name"])) if ago else None}
                          for s in sl["sectors"]]
        out["count"] = len(out["sectors"])
        return out
    asked = " ".join(str(sector).split())[:GS.MAX_NAME]
    hit = GS._find({s["name"]: s for s in sl["sectors"]}, asked)
    out["asked"] = asked
    if hit is None:
        out.update({"found": False, "sector": None})
        return out
    out.update({"found": True, "sector": {
        **C.brief(hit), "year_ago": C.brief(ago_by.get(hit["name"])) if ago else None,
        "reporters": [C.row_dict(r) for r in hit["reporters"]],
        "upcoming": [{"symbol": s, "date": d} for s, d in hit["upcoming"]],
        "late": [{"symbol": s, "date": d} for s, d in hit["late"]],
    }})
    return out


def peek() -> Optional[dict]:
    """READ ONLY: the whole held answer, or None. Never starts a read."""
    return _held.peek()


def reset_for_tests() -> None:
    _held.reset()


def drain_for_tests(timeout: float = 5.0) -> None:
    _held.drain(timeout)
