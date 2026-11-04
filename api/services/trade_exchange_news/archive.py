"""The retained archive, browsed by CALENDAR DAY (America/New_York), filtered ON THE SERVER.

The widget's filters (search, categories, linked symbol, watchlist, graphic-only
placeholders) read fields the server DERIVES from each headline at event build
(tickers, category, placeholder -- see ``pipeline.headline_event``); none of them
is a stored column. So a day is filtered here, over the WHOLE retained day,
never over whatever a browser happens to hold.

⭐ ONE DAY = 00:00:00 -> 24:00 America/New_York, by UCT's RECEIPT time (Trade
Exchange sends no publication time). Bounds come from ``zoneinfo`` timestamps,
so a DST day is honestly 23 or 25 hours long. Within a day the order is
``(received_at_ms, seq)`` DESCENDING -- newest first, ``seq`` the deterministic
tie-breaker -- and every fetch is a KEYSET step from a cursor on that key, in
either direction. Headlines arriving meanwhile can therefore never shift,
duplicate or skip a row already loaded or about to load.

⛔⛔ THE ARCHIVE IS PERMANENT; ONLY CACHES ARE BOUNDED (owner, 2026-10-31). Every
headline is kept forever (store.py), so nothing here may hold, scan or sort "the
whole archive" -- at hundreds of thousands or millions of rows that is the cliff
the old design walked into (one in-memory copy of every row, SCAN_MAX 20,000, a
full rebuild on every request once the archive outgrew it). Instead:
  * TAIL -- the newest ``TAIL_MAX`` rows by seq, for /recent and the warmer;
  * DAYS -- an LRU of whole calendar days (``DAY_CACHE_DAYS`` / ``DAY_CACHE_ROWS``),
    each read once by a RANGE query on ``ix_txn_headlines_received`` -- its cost is
    that day's size, never the archive's;
  * HOURS -- headline counts per UTC hour (the calendar's availability), one
    aggregate per process, then extended by new seqs;
  * derivations (category / placeholder / tickers ...) -- fixed-size LRUs.
Evicting any of them never deletes a row; the next request reads it back.

⭐ CHEAP WHERE IT MATTERS. Derived fields are a pure function of ``(source,
content)`` and are cached in two tiers:
  * LIGHT -- category, graphic-placeholder, lower-cased text: regexes only. A
    whole-day filter needs only these, unless it names a symbol;
  * FULL  -- what ``pipeline.derived_for`` puts on an event (resolver tickers,
    company names, impact). Made only for rows a response returns, rows a
    symbol filter must test, and -- at low priority -- by a background warmer
    over the TAIL.
⛔ MEASURED IN PRODUCTION (2026-10-30, ~950 headlines): re-deriving per request
cost 2-3.5 s; re-READING rows per request still cost ~2.1 s (in a busy process
each fetched row hands the GIL back and waits to get it again). Hence the
derivation caches, and rows served from the cached tail/day (``rows_for``) with
only the current repeat counts read per response.

⛔ THE DATABASE IS THE TRUTH; EVERY CACHE IS REBUILDABLE. Nothing here is written
anywhere; every process starts empty. Each request first reads the rows committed
since the last one (new seqs: AUTOINCREMENT, never reused -- live or recovered
from R2, whatever their receipt time) and files them into the tail, any cached
day they belong to and the hour counts. A cached day is ALSO re-counted against
the database (one indexed COUNT) on every use and re-read on any difference, and
a new epoch (a recreated or restored database) discards everything.

⭐ HONEST AVAILABILITY. ``days()`` reports only dates that hold archived rows and
where the archive begins (the day UCT started receiving Trade Exchange: partial
by definition, since nothing before it was ever delivered).

Runs on worker threads (``asyncio.to_thread``), never on the single writer: a
reader connection of its own (WAL), so it cannot delay ingestion; the router
admits at most ``CONCURRENT`` requests at a time.
"""
from __future__ import annotations

import bisect
import re
import threading
import time
from collections import OrderedDict
from datetime import date as _date, datetime, timedelta
from typing import Any, Iterable
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
DEFAULT_LIMIT = 60
MAX_LIMIT = 200
MAX_SYMBOLS = 3000
MAX_QUERY = 80
#: ⭐ The cache bounds -- fixed, never derived from the archive's size. Measured in
#: tests/test_trade_exchange_news_retention.py (memory and latency at scale).
TAIL_MAX = 5_000
DAY_CACHE_DAYS = 64
DAY_CACHE_ROWS = 60_000
DERIVED_MAX = 20_000
CONCURRENT = 2
#: ⭐ ALL HISTORY (Linked to chart): one request walks archived days newest -> oldest and
#: stops at whichever comes first -- a full page, this much wall time, or this many rows
#: read -- then answers with a cursor to continue from. The walk itself has NO date
#: cutoff: the reader's scrolling carries it back to the archive's first day.
HISTORY_BUDGET_S = 1.5
HISTORY_BUDGET_ROWS = 6_000
#: categories.CATEGORIES, restated so this module imports nothing heavy (the tests
#: assert the two never drift).
CATEGORIES = ("News", "Macro", "Options", "Press Release", "Earnings", "Price", "Filing", "Other")
_SYMBOLISH = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def _cache_max() -> int:
    """Derivations kept per tier (LRU): far above any one day, so a full day never
    evicts what it is about to need; FIXED, so the archive's growth never grows it."""
    return DERIVED_MAX


# ── derivations: LIGHT (regexes) and FULL (the resolver), both LRU-cached ────
_lock = threading.Lock()
_light: OrderedDict[tuple[str, str], tuple[str, bool, str]] = OrderedDict()
_full: OrderedDict[tuple[str, str], dict[str, Any]] = OrderedDict()
#: FULL derivations made since start (cache misses).
stats = {"misses": 0}


def _put(cache: OrderedDict, key, val) -> None:
    with _lock:
        cache[key] = val
        cap = _cache_max()
        while len(cache) > cap:
            cache.popitem(last=False)


def _light_of(source: str, content: str) -> tuple[str, bool, str]:
    """(category, graphic placeholder?, lower-cased text): the same functions the
    event build calls (categories.category_for / placeholder_for), never-raise."""
    key = (source, content)
    with _lock:
        hit = _light.get(key)
        if hit is not None:
            _light.move_to_end(key)
            return hit
    try:
        from api.services.trade_exchange_news import categories as cat
    except Exception:  # noqa: BLE001 -- not in the standalone staging bundle
        cat = None
    try:
        category = cat.category_for(source, content) if cat else "Other"
    except Exception:  # noqa: BLE001 -- the event build's fallback
        category = "Other"
    try:
        graphic = bool(cat) and cat.placeholder_for(content) == "graphic"
    except Exception:  # noqa: BLE001
        graphic = False
    val = (category or "Other", graphic, content.lower())
    _put(_light, key, val)
    return val


def event_fields(source: str, content: str) -> dict[str, Any]:
    """The FULL derivation for one row's event (``headline_event(derived=...)``)."""
    key = (source, content)
    with _lock:
        hit = _full.get(key)
        if hit is not None:
            _full.move_to_end(key)
            return hit
    from api.services.trade_exchange_news import pipeline
    val = pipeline.derived_for(source, content)
    with _lock:
        stats["misses"] += 1
    _put(_full, key, val)
    return val


def _tickers(source: str, content: str) -> frozenset[str]:
    return frozenset(event_fields(source, content).get("tickers") or ())


def clear_cache() -> None:
    with _lock:
        _light.clear()
        _full.clear()
        stats["misses"] = 0


# ── the bounded caches over the permanent archive ─────────────────────────
_idx_lock = threading.Lock()
#: Index tuples are (seq, source, content, received_at_ms, event_id, via,
#: ingested_at_ms) -- every column that never changes once written.
#:   top        -- the highest seq filed into the caches below
#:   tail       -- the newest TAIL_MAX rows, seq ascending
#:   days       -- ISO date -> that ET day's rows, seq ascending (LRU, least recent first)
#:   hours      -- UTC hour -> count, complete up to hours_top (None until first asked)
#:   rebuilds   -- caches discarded (a process's first request, a new epoch)
#:   day_loads  -- days read from the database (a miss, or a re-count difference)
_idx: dict[str, Any] = {}


def _reset(epoch: str | None) -> None:
    _idx.update(epoch=epoch, top=0, tail=[], days=OrderedDict(), day_rows=0, hours=None, hours_top=0,
                first_seq=0)


_reset(None)
_idx.update(rebuilds=0, day_loads=0)


def _day_key(ms: int, memo: dict[int, str]) -> str:
    hour = ms // 3_600_000                               # ET offsets are whole hours
    key = memo.get(hour)
    if key is None:
        key = memo[hour] = day_of(ms).isoformat()
    return key


def _sync(store) -> None:
    """File every row committed since the last call into the caches. Caller holds
    ``_idx_lock``. A cold cache starts at the newest TAIL_MAX rows -- never a read
    of the whole archive."""
    if _idx["epoch"] != store.epoch:
        _reset(store.epoch)
        _idx["rebuilds"] += 1
        last = store.last_seq()
        _idx["tail"] = list(store.index_before(last + 1, TAIL_MAX)) if last else []
        _idx["top"] = last
        _idx["first_seq"] = store.first_seq()
        return
    memo: dict[int, str] = {}
    while True:
        more = store.index_after(_idx["top"], 5000)
        if not more:
            break
        tail, days, hours = _idx["tail"], _idx["days"], _idx["hours"]
        for r in more:
            tail.append(r)
            lst = days.get(_day_key(r[3], memo))
            if lst is not None and (not lst or lst[-1][0] < r[0]):   # a day read meanwhile may hold it
                lst.append(r)
                _idx["day_rows"] += 1
            if hours is not None and r[0] > _idx["hours_top"]:
                h = r[3] // 3_600_000
                hours[h] = hours.get(h, 0) + 1
                _idx["hours_top"] = r[0]
        if len(tail) > TAIL_MAX:
            del tail[:len(tail) - TAIL_MAX]
        _idx["top"] = more[-1][0]
        if not _idx["first_seq"]:
            _idx["first_seq"] = store.first_seq()
        if len(more) < 5000:
            break
    _evict_days()


def _evict_days() -> None:
    days = _idx["days"]
    while days and (len(days) > DAY_CACHE_DAYS or _idx["day_rows"] > DAY_CACHE_ROWS):
        _, gone = days.popitem(last=False)
        _idx["day_rows"] -= len(gone)


def _day_rows(store, d: _date) -> tuple[list[tuple], int]:
    """(that ET day's rows seq ascending -- a snapshot, iterate without the lock,
    the highest seq filed). Served from the day LRU when its count still matches the
    database (one indexed COUNT), else read by one range query."""
    start, end = day_bounds(d)
    key = d.isoformat()
    with _idx_lock:
        _sync(store)
        days = _idx["days"]
        rows = days.get(key)
        if rows is not None and store.count_between(start, end) != len(rows):
            _idx["day_rows"] -= len(rows)
            del days[key]
            rows = None
        if rows is None:
            rows = list(store.index_between(start, end))
            _idx["day_loads"] += 1
            days[key] = rows
            _idx["day_rows"] += len(rows)
        days.move_to_end(key)
        snap = list(rows)
        top = _idx["top"]
        _evict_days()
    _warm_soon(snap)
    return snap, top


def _tail(store) -> tuple[list[tuple], int, int]:
    """(the newest rows seq ascending -- a snapshot, first seq, last seq)."""
    with _idx_lock:
        _sync(store)
        snap = list(_idx["tail"])
        first, top = _idx["first_seq"], _idx["top"]
    _warm_soon(snap)
    return snap, first, top


def _hours(store) -> dict[int, int]:
    with _idx_lock:
        _sync(store)
        if _idx["hours"] is None:
            _idx["hours"], _idx["hours_top"] = store.hour_counts(0)
        return dict(_idx["hours"])


def clear_index() -> None:
    with _idx_lock:
        _reset(None)
        _idx.update(rebuilds=0, day_loads=0)


def cache_stats() -> dict[str, int]:
    """Sizes only (admin status): rows held per cache, derivations cached, reloads."""
    with _idx_lock:
        out = {"tail_rows": len(_idx["tail"]), "days_cached": len(_idx["days"]),
               "day_rows": _idx["day_rows"], "hours": len(_idx["hours"] or {}),
               "rebuilds": _idx["rebuilds"], "day_loads": _idx["day_loads"]}
    with _lock:
        return {**out, "derived_light": len(_light), "derived_full": len(_full)}


# ── the background warmer: FULL derivations, newest first, at low priority ───
_warm: dict[str, Any] = {"thread": None, "pending": None}
#: Rows derived between pauses, and the pause: the warmer hands the GIL back often
#: so the event loop and the writer are never kept waiting behind it.
WARM_BATCH = 8
WARM_PAUSE_S = 0.01
WARM_ENABLED = True


def _warm_soon(rows: list) -> None:
    if not WARM_ENABLED:
        return
    with _lock:
        _warm["pending"] = rows
        t = _warm["thread"]
        if t is not None and t.is_alive():
            return
        t = threading.Thread(target=_warm_run, name="txn-archive-warm", daemon=True)
        _warm["thread"] = t
    t.start()


def _warm_run() -> None:
    while True:
        with _lock:
            rows, _warm["pending"] = _warm["pending"], None
        if not rows:
            return
        n = 0
        for r in reversed(rows):
            source, content = r[1], r[2]
            with _lock:
                if _warm["pending"] is not None:
                    break                          # a newer snapshot arrived: start over from it
                done = (source, content) in _full
            if done:
                continue
            try:
                event_fields(source, content)
            except Exception:  # noqa: BLE001 -- a warmer never raises
                pass
            n += 1
            if n % WARM_BATCH == 0:
                time.sleep(WARM_PAUSE_S)


def warm_wait(timeout: float = 5.0) -> bool:
    """Tests: wait for the warmer to finish."""
    t = _warm["thread"]
    if t is not None:
        t.join(timeout)
    return t is None or not t.is_alive()


# ── calendar days ─────────────────────────────────────────────────────────────

def parse_day(raw: Any) -> _date | None:
    try:
        return _date.fromisoformat(str(raw)) if raw else None
    except ValueError:
        return None


def day_bounds(d: _date) -> tuple[int, int]:
    """[start, end) in epoch ms for one America/New_York calendar day (23/24/25 h)."""
    start = datetime(d.year, d.month, d.day, tzinfo=ET)
    nxt = d + timedelta(days=1)
    end = datetime(nxt.year, nxt.month, nxt.day, tzinfo=ET)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def day_of(ms: int) -> _date:
    return datetime.fromtimestamp(ms / 1000, ET).date()


def today(now_ms: int | None = None) -> _date:
    return day_of(int(time.time() * 1000) if now_ms is None else now_ms)


def at_ms(d: _date, hhmm: Any) -> int | None:
    """The last instant of the minute ``HH:MM`` on day ``d`` (ET) -- "at or before
    9:30" includes 9:30:59 -- or None when the time is not valid. A wall time a DST
    change skips or repeats resolves as zoneinfo resolves it (fold=0)."""
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", str(hhmm or ""))
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        return None
    t = datetime(d.year, d.month, d.day, int(m.group(1)), int(m.group(2)), tzinfo=ET)
    return int(t.timestamp() * 1000) + 59_999


def days(store, now_ms: int | None = None) -> dict[str, Any]:
    """Archived headline counts per ET date (unfiltered), plus where the archive
    begins. ``first_day_partial`` is true whenever there is a first day: the archive
    began during it (nothing before that was ever delivered to UCT)."""
    hours = _hours(store)
    counts: dict[str, int] = {}
    memo: dict[int, str] = {}
    for h, n in hours.items():
        key = _day_key(h * 3_600_000, memo)
        counts[key] = counts.get(key, 0) + n
    now = int(time.time() * 1000) if now_ms is None else now_ms
    oldest, newest = store.received_range()
    first_day = day_of(oldest) if oldest is not None else None
    return {"today": today(now).isoformat(), "oldest_ms": oldest, "newest_ms": newest,
            "first_day": first_day.isoformat() if first_day else None,
            "first_day_partial": first_day is not None,
            "days": [{"date": k, "count": v} for k, v in sorted(counts.items()) if v],
            "retention": {"permanent": True}}


# ── one day's slice ───────────────────────────────────────────────────────────

def rows_for(store, picked: list[tuple]) -> list[dict[str, Any]]:
    """Index tuples -> the row dicts ``pipeline.headline_event`` reads, with the
    CURRENT repeat counts. No per-row database read."""
    reps = store.repeats_for([t[0] for t in picked]) if picked else {}
    return [{"seq": t[0], "source": t[1], "content": t[2], "received_at_ms": t[3], "event_id": t[4],
             "via": t[5], "ingested_at_ms": t[6], "repeat_count": reps.get(t[0], 0)} for t in picked]


def recent_rows(store, limit: int, before: int | None = None) -> tuple[list[dict[str, Any]], int, int]:
    """/recent: the newest ``limit`` (seq order), or those before ``before`` -- from
    the cached tail, or one keyset read below it. Returns (rows seq ascending,
    first_seq, last_seq)."""
    rows, first, top = _tail(store)
    limit = int(limit)
    if before:
        rows = rows[:bisect.bisect_left(rows, (int(before),))]
        if len(rows) < limit and not (rows and rows[0][0] <= first):
            rows = store.index_before(int(before), limit)        # older than the tail
    picked = rows[-limit:] if limit else []
    return rows_for(store, picked), first, top


def _clean_syms(raw: Iterable[Any] | None) -> frozenset[str] | None:
    if raw is None:
        return None
    out = set()
    for s in raw:
        if isinstance(s, str) and 0 < len(s) <= 16:
            out.add(s.strip().upper())
        if len(out) >= MAX_SYMBOLS:
            break
    return frozenset(out)


def _cursor(raw: Any) -> tuple[int, int] | None:
    if isinstance(raw, (list, tuple)) and len(raw) == 2 and all(isinstance(x, int) and not isinstance(x, bool) for x in raw):
        return int(raw[0]), int(raw[1])
    return None


def _rule(query: str, categories, symbol, symbols, hide_placeholders: bool) -> dict[str, Any]:
    """The widget's filters, normalised once per request (``visibleItems`` + ``matchesQuery``)."""
    q = str(query or "").strip().lower()[:MAX_QUERY]
    q_sym = q[1:].upper() if q.startswith("$") else q.upper()
    cats = None
    if categories:
        picked = frozenset(c for c in categories if isinstance(c, str) and c in CATEGORIES)
        cats = picked if picked and len(picked) < len(CATEGORIES) else None
    return {"q": q, "q_sym": q_sym, "q_needs_tickers": bool(q) and bool(_SYMBOLISH.match(q_sym)), "cats": cats,
            "sym": str(symbol).strip().upper() if symbol else None, "syms": _clean_syms(symbols),
            "hide": bool(hide_placeholders)}


def _filter_day(day_rows: list[tuple], rule: dict[str, Any]) -> tuple[list[tuple[int, int]], dict[int, tuple], int]:
    """One day's matches, newest first by (received_at_ms, seq): (keys, rows by seq, graphic posts seen)."""
    day_rows.sort(key=lambda r: (r[3], r[0]), reverse=True)
    q, q_sym, q_needs_tickers = rule["q"], rule["q_sym"], rule["q_needs_tickers"]
    cats, sym, syms, hide = rule["cats"], rule["sym"], rule["syms"], rule["hide"]
    match: list[tuple[int, int]] = []                 # (received_at_ms, seq), newest first
    by_seq: dict[int, tuple] = {}
    hidden = 0
    # ⛔ No voluntary GIL yields here: Python already switches threads every 5 ms, and
    # in a busy process every give-back is a wait to get it again.
    for r in day_rows:
        seq, source, content, received = r[:4]
        cat, graphic, lc = _light_of(source, content)
        if graphic:
            hidden += 1
            if hide:
                continue
        if cats is not None and cat not in cats:
            continue
        if sym or syms is not None:
            tick = _tickers(source, content)
            if sym and sym not in tick:
                continue
            if syms is not None and tick.isdisjoint(syms):
                continue
        if q and q not in lc and not (q_needs_tickers and q_sym in _tickers(source, content)):
            continue
        match.append((received, seq))
        by_seq[seq] = r
    return match, by_seq, hidden


def day_slice(store, *, day: _date, limit: int = DEFAULT_LIMIT, cursor: Any = None, direction: str = "older",
              at: int | None = None, query: str = "", categories: Iterable[str] | None = None,
              symbol: str | None = None, symbols: Iterable[Any] | None = None,
              hide_placeholders: bool = True) -> dict[str, Any]:
    """Up to ``limit`` matches of ``day``, newest first, by the key
    ``(received_at_ms, seq)``:
      * no cursor, no ``at``  -> the day's newest;
      * ``at`` (epoch ms)     -> starting at the newest match received AT OR BEFORE it;
      * ``cursor`` + older    -> the matches just below the cursor;
      * ``cursor`` + newer    -> the matches just above it (still newest first).
    Mirrors the widget's ``visibleItems`` + ``matchesQuery``
    (tradeExchangeNewsModel.js). Returns ``{start_ms, end_ms, total, day_total,
    hidden_placeholders, has_older, has_newer, older_cursor, newer_cursor, top,
    seqs, _rows}``; the router turns ``_rows`` (index tuples, ``rows_for``) into events. ``total`` counts every match in
    the day; ``top`` is the newest seq considered (newer arrivals reach the
    browser live).
    """
    limit = max(1, min(MAX_LIMIT, int(limit)))
    start, end = day_bounds(day)
    rule = _rule(query, categories, symbol, symbols, hide_placeholders)
    day_rows, top = _day_rows(store, day)
    match, by_seq, hidden = _filter_day(day_rows, rule)

    neg = [(-k[0], -k[1]) for k in match]             # ascending, for bisect
    cur = _cursor(cursor)
    if cur is not None and direction == "newer":
        j = bisect.bisect_left(neg, (-cur[0], -cur[1]))    # matches strictly newer than the cursor
        sl = (max(0, j - limit), j)
    else:
        if cur is not None:
            i = bisect.bisect_right(neg, (-cur[0], -cur[1]))   # strictly older than the cursor
        elif at is not None:
            i = bisect.bisect_left(neg, (-at, -(1 << 62)))     # the first received <= at
        else:
            i = 0
        sl = (i, min(len(match), i + limit))
    # A jump earlier than every match of the day lands on the EARLIEST match, and
    # says so ("after") -- never an empty view that hides the day's headlines.
    at_match = None
    if cur is None and at is not None:
        at_match = "at_or_before"
        if sl[0] >= len(match) and match:
            sl = (max(0, len(match) - limit), len(match))
            at_match = "after"
    keys = match[sl[0]:sl[1]]
    return {"start_ms": start, "end_ms": end, "total": len(match), "day_total": len(day_rows), "at_match": at_match,
            "hidden_placeholders": hidden if hide_placeholders else 0,
            "has_newer": sl[0] > 0, "has_older": sl[1] < len(match),
            "newer_cursor": list(keys[0]) if keys else None,
            "older_cursor": list(keys[-1]) if keys else None,
            "top": top, "seqs": [k[1] for k in keys], "_rows": [by_seq[k[1]] for k in keys]}


# ── all history: every archived day, newest first (Linked to chart) ──────────

def history_slice(store, *, limit: int = DEFAULT_LIMIT, cursor: Any = None, query: str = "",
                  categories: Iterable[str] | None = None, symbol: str | None = None,
                  symbols: Iterable[Any] | None = None, hide_placeholders: bool = True,
                  budget_s: float | None = None, budget_rows: int | None = None,
                  now_ms: int | None = None) -> dict[str, Any]:
    """Up to ``limit`` matches across EVERY archived day, newest first by
    ``(received_at_ms, seq)``, strictly older than ``cursor`` when one is given.

    Walks the days that hold archived rows (``days()``), newest first, through the
    same bounded day reader and the same filter as ``day_slice`` -- never a scan of
    the archive in one go. One request stops at a full page, ``HISTORY_BUDGET_S``
    or ``HISTORY_BUDGET_ROWS`` (checked between days), whichever is first, and
    answers ``has_older`` with an ``older_cursor`` to continue from: the last match
    returned, or -- when the budget ran out first -- the start of the oldest day it
    finished, so the next request begins with the day before it. There is no date
    cutoff; ``searched_to`` (the oldest date fully searched) and ``reached_start``
    let the widget say how far back it has looked. ``total`` is None: counting every
    match would mean reading every day.
    """
    limit = max(1, min(MAX_LIMIT, int(limit)))
    budget_s = HISTORY_BUDGET_S if budget_s is None else budget_s
    budget_rows = HISTORY_BUDGET_ROWS if budget_rows is None else budget_rows
    rule = _rule(query, categories, symbol, symbols, hide_placeholders)
    cur = _cursor(cursor)
    held = [_date.fromisoformat(r["date"]) for r in days(store, now_ms)["days"]]
    held.sort(reverse=True)
    if cur is not None:
        cut = day_of(cur[0])
        # the cursor's own day only if it can still hold an older row (a budget stop
        # leaves the cursor exactly at a searched day's start: that day is done)
        held = [d for d in held if d < cut or (d == cut and (cur[0], cur[1]) > (day_bounds(d)[0], 0))]
    t0 = time.perf_counter()
    keys: list[tuple[int, int]] = []
    rows_out: list[tuple] = []
    scanned = 0
    searched_to = None
    top = 0
    stopped = None                                    # the oldest day finished when a budget stopped the walk
    for i, d in enumerate(held):
        day_rows, top = _day_rows(store, d)
        scanned += len(day_rows)
        match, by_seq, _ = _filter_day(day_rows, rule)
        if cur is not None:
            match = [k for k in match if (k[0], k[1]) < cur]
        need = limit - len(keys)
        take = match[:need]
        keys.extend(take)
        rows_out.extend(by_seq[k[1]] for k in take)
        if len(match) > need:                         # a full page, with more in this day
            return _history_out(keys, rows_out, True, top, searched_to, False, scanned)
        searched_to = d
        if len(keys) >= limit:
            return _history_out(keys, rows_out, i + 1 < len(held), top, searched_to, i + 1 >= len(held), scanned)
        if i + 1 < len(held) and (time.perf_counter() - t0 >= budget_s or scanned >= budget_rows):
            stopped = d
            break
    if stopped is not None:
        start, _ = day_bounds(stopped)
        out = _history_out(keys, rows_out, True, top, searched_to, False, scanned)
        out["older_cursor"] = [start, 0]              # strictly older than this day: the day before it
        return out
    return _history_out(keys, rows_out, False, top, searched_to, True, scanned)


def _history_out(keys, rows_out, has_older, top, searched_to, reached_start, scanned) -> dict[str, Any]:
    return {"history": True, "total": None, "day_total": None, "at_match": None, "hidden_placeholders": None,
            "has_newer": False, "has_older": bool(has_older),
            "newer_cursor": list(keys[0]) if keys else None,
            "older_cursor": list(keys[-1]) if keys else None,
            "searched_to": searched_to.isoformat() if searched_to else None, "reached_start": bool(reached_start),
            "scanned_rows": scanned, "top": top, "seqs": [k[1] for k in keys], "_rows": rows_out}
