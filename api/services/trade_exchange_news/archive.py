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

⭐ BOUNDED, AND CHEAP WHERE IT MATTERS. The archive is itself bounded
(``TXN_HISTORY_MAX_AGE_HOURS`` 168 / ``TXN_HISTORY_MAX_ITEMS`` 5,000). Derived
fields are a pure function of ``(source, content)`` and are cached in two tiers:
  * LIGHT -- category, graphic-placeholder, lower-cased text: regexes only. A
    whole-day filter needs only these, unless it names a symbol;
  * FULL  -- what ``pipeline.derived_for`` puts on an event (resolver tickers,
    company names, impact). Made only for rows a response returns, rows a
    symbol filter must test, and -- at low priority -- by a background warmer.
⛔ MEASURED IN PRODUCTION (2026-10-30, ~950 headlines): re-deriving per request
cost 2-3.5 s; re-READING the archive per request still cost ~2.1 s (in a busy
process each fetched row hands the GIL back and waits to get it again). Hence the
derivation caches AND a copy of the archive's index held in memory.

⛔ THE DATABASE IS THE TRUTH; THE INDEX IS A REBUILDABLE CACHE. It is never
written anywhere, starts empty in every process (a restart rebuilds it from the
database), and every request re-checks it against the database:
  * new headlines -- live or recovered from R2 -- get a NEW seq (AUTOINCREMENT,
    never reused), so they are exactly the rows after the last one held;
  * a row's text never changes once written (only its repeat count does, and a
    response's events are always built from fresh rows: ``store.by_seqs``);
  * pruning deletes the lowest seqs (count bound) AND any row past the age
    cutoff -- which may be a recovered headline in the MIDDLE (old receipt time,
    new seq). So every request compares ``COUNT(*) WHERE seq <= last held`` with
    the rows held; on a difference it drops the held rows near the age cutoff
    that are gone, and if anything still disagrees it rebuilds from scratch;
  * a recreated database (new epoch) discards it.

⭐ HONEST AVAILABILITY. ``days()`` reports only dates that hold retained rows,
where retention begins, and whether that first day is partial. Nothing older
than the archive is ever promised.

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
#: Rows held: the archive's own bound with headroom (an env override of the count
#: bound above this would see its oldest rows unindexed, never a crash).
SCAN_MAX = 20_000
CONCURRENT = 2
#: categories.CATEGORIES, restated so this module imports nothing heavy (the tests
#: assert the two never drift).
CATEGORIES = ("News", "Macro", "Options", "Press Release", "Earnings", "Price", "Filing", "Other")
_SYMBOLISH = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def _cache_max() -> int:
    """Derivations kept per tier (LRU): the archive's count bound plus headroom, so
    a full day never evicts what it is about to need."""
    from api.services.trade_exchange_news import config
    return max(6000, config.history_max_items() + 1000)


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


# ── the archive's index, in memory, extended incrementally ───────────────────
_idx_lock = threading.Lock()
#: rows: (seq, source, content, received_at_ms), seq ascending. `rebuilds` counts
#: full reads (a process's first request, a new epoch, or an inconsistency).
_idx: dict[str, Any] = {"epoch": None, "rows": [], "rebuilds": 0}
#: Rows received this close to the age cutoff are re-checked when counts differ.
AGE_SLACK_MS = 15 * 60_000


def _read_after(store, rows: list) -> None:
    while True:
        more = store.index_after(rows[-1][0] if rows else 0, 5000)
        rows.extend(more)
        if len(more) < 5000:
            return


def _index(store) -> list[tuple[int, str, str, int]]:
    """Every retained row, seq ascending -- verified against the database on every
    call (see the module note). Normally reads a few new rows plus one COUNT.
    Returns a snapshot list (the caller iterates it without the lock)."""
    from api.services.trade_exchange_news import config
    with _idx_lock:
        if _idx["epoch"] != store.epoch:
            _idx.update(epoch=store.epoch, rows=[])
            _idx["rebuilds"] += 1
        rows = _idx["rows"]
        _read_after(store, rows)
        first = store.first_seq()
        if not first:
            rows.clear()
        elif rows and rows[0][0] < first:                         # the count bound: lowest seqs
            del rows[:bisect.bisect_left(rows, (first,))]
        if rows and store.count_upto(rows[-1][0]) != len(rows):
            # The age bound removed rows anywhere (a recovered headline keeps its
            # old receipt time under a new seq): re-check those near the cutoff.
            cutoff = int(time.time() * 1000) - config.history_max_age_ms() + AGE_SLACK_MS
            near = [r[0] for r in rows if r[3] < cutoff]
            if near:
                alive = store.present(near)
                rows[:] = [r for r in rows if r[3] >= cutoff or r[0] in alive]
            if store.count_upto(rows[-1][0] if rows else 0) != len(rows):
                rows.clear()                                     # anything else: start again
                _idx["rebuilds"] += 1
                _read_after(store, rows)
        if len(rows) > SCAN_MAX:
            del rows[:len(rows) - SCAN_MAX]
        snapshot = list(rows)
    _warm_soon(snapshot)
    return snapshot


def clear_index() -> None:
    with _idx_lock:
        _idx.update(epoch=None, rows=[], rebuilds=0)


def cache_stats() -> dict[str, int]:
    """Sizes only (admin status): rows indexed, derivations cached, full rebuilds."""
    with _idx_lock:
        n, rebuilds = len(_idx["rows"]), _idx["rebuilds"]
    with _lock:
        return {"index_rows": n, "derived_light": len(_light), "derived_full": len(_full), "rebuilds": rebuilds}


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
        for _seq, source, content, _at in reversed(rows):
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
    """Retained headline counts per ET date (unfiltered), plus where retention
    begins. ``first_day_partial`` marks the first retained day when retention may
    have cut it (the age bound falls inside it, or the count bound is full)."""
    from api.services.trade_exchange_news import config
    rows = _index(store)
    counts: dict[str, int] = {}
    by_hour: dict[int, str] = {}                      # ET offsets are whole hours: one lookup per UTC hour
    for _seq, _s, _c, at in rows:
        hour = at // 3_600_000
        key = by_hour.get(hour)
        if key is None:
            key = by_hour[hour] = day_of(at).isoformat()
        counts[key] = counts.get(key, 0) + 1
    now = int(time.time() * 1000) if now_ms is None else now_ms
    oldest = min((r[3] for r in rows), default=None)
    newest = max((r[3] for r in rows), default=None)
    first_day = day_of(oldest) if oldest is not None else None
    partial = False
    if first_day is not None:
        start, end = day_bounds(first_day)
        age_cut = now - config.history_max_age_ms()
        partial = start < age_cut < end or len(rows) >= config.history_max_items()
    return {"today": today(now).isoformat(), "oldest_ms": oldest, "newest_ms": newest,
            "first_day": first_day.isoformat() if first_day else None, "first_day_partial": partial,
            "days": [{"date": k, "count": v} for k, v in sorted(counts.items())],
            "retention": {"max_age_hours": config.history_max_age_ms() // 3_600_000,
                          "max_items": config.history_max_items()}}


# ── one day's slice ───────────────────────────────────────────────────────────

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
    seqs}``; the router turns ``seqs`` into events. ``total`` counts every match in
    the day; ``top`` is the newest seq considered (newer arrivals reach the
    browser live).
    """
    limit = max(1, min(MAX_LIMIT, int(limit)))
    start, end = day_bounds(day)
    q = str(query or "").strip().lower()[:MAX_QUERY]
    q_sym = q[1:].upper() if q.startswith("$") else q.upper()
    q_needs_tickers = bool(q) and bool(_SYMBOLISH.match(q_sym))
    cats = None
    if categories:
        picked = frozenset(c for c in categories if isinstance(c, str) and c in CATEGORIES)
        cats = picked if picked and len(picked) < len(CATEGORIES) else None
    sym = str(symbol).strip().upper() if symbol else None
    syms = _clean_syms(symbols)

    rows = _index(store)
    top = rows[-1][0] if rows else 0
    day_rows = [r for r in rows if start <= r[3] < end]
    day_rows.sort(key=lambda r: (r[3], r[0]), reverse=True)
    match: list[tuple[int, int]] = []                 # (received_at_ms, seq), newest first
    hidden = 0
    for i, (seq, source, content, received) in enumerate(day_rows):
        if i and i % 256 == 0:
            time.sleep(0)                             # a cold day: let the event loop in
        cat, graphic, lc = _light_of(source, content)
        if graphic:
            hidden += 1
            if hide_placeholders:
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
            "top": top, "seqs": [k[1] for k in keys]}
