"""THE server bar contract — every /api/bars answer and every /api/stream/bars event.

Spec (semantics, invariants, examples): docs/architecture/bar-contract.md. This module
is the ONE implementation; the REST router (`routers/bars._augment_with_contract`) and
the stream router (`routers/stream`) both call it, so no serve branch computes these
fields its own way.

Fields (all additive — `bars` keeps its exact pre-contract shape for old clients):
  contract          int, the contract version (CONTRACT_VERSION)
  grid              "eth-clock" | "rth-tv" | "plain"
  session           "rth" | "eth" | None (no session param: the legacy behaviour)
  cache_key         canonical server-issued key of the ROW SERIES this answer belongs to
  series_rev        int ms HLC of the stored source series (None: not store-backed)
  verified_through  unix s the provider/stream last proved the series current (None)
  complete_through  unix s: every bucket of THIS ANSWER whose end <= it is final
                    (None: nothing is guaranteed)
  developing        {t, o, h, l, c, v, rev} — the bucket that contains `now` — or None

Buckets are read off the single bucket helpers (`bar_rollup.tv_bucket_bounds` for
intraday; the session clock in `bars_fetch` for D/W/M closes).
"""
from __future__ import annotations

import time as _time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

CONTRACT_VERSION = 1
INTRADAY_TFS = ("1", "5", "15", "30", "60")
DATE_TFS = ("D", "W", "M")
_ET = ZoneInfo("America/New_York")
_CACHE_KEY_VERSION = "b1"


# ── identity ─────────────────────────────────────────────────────────────────

def _norm_session(session):
    from api.services.bars_fetch import normalize_session
    return normalize_session(session)


def grid_for(tf: str, session=None) -> str:
    """The bucket grid of the rows an answer carries. 1-30m: ET clock floors over the
    04:00-20:00 extended session, identical for rth/eth charts. 60m: the stored
    TradingView RTH grid (09:30, 10:30 ... 15:30 half bar) unless `session=eth`, which
    serves TradingView's clock hours. D/W/M: one bar per period ("plain")."""
    if tf in DATE_TFS:
        return "plain"
    if tf == "60":
        if _norm_session(session) == "eth":
            return "eth-clock"
        from api.services.bars_fetch import SIXTY_MIN_GRID
        return "eth-clock" if SIXTY_MIN_GRID in ("eth", "clock") else "rth-tv"
    return "eth-clock"


def source_series(tf: str, session=None) -> str:
    """The STORED series (bars.db tf) an answer for (tf, session) is read from: the ETH
    60m grid is derived on read from 15m; everything else is its own stored series."""
    return "15" if (tf == "60" and _norm_session(session) == "eth") else tf


def cache_key(ticker: str, tf: str, session=None) -> str:
    """Canonical key of the row series. Keyed on the GRID, not the chart session: an rth
    and an eth 5m chart hold byte-identical rows (only the tail judgement differs), so
    they share one entry; the two 60m grids cannot be converted into each other, so they
    never do. ⛔ The ONLY cache-key function — clients must use the server's value."""
    return f"{_CACHE_KEY_VERSION}:{str(ticker).upper()}:{tf}:{grid_for(tf, session)}"


# ── buckets ──────────────────────────────────────────────────────────────────

def _date_of(t) -> date | None:
    """A D/W/M key ('YYYY-MM-DD' or YYYYMMDD int) as a date."""
    try:
        s = str(t).replace("-", "")[:8]
        return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except (TypeError, ValueError):
        return None


def _rth_close_ts(d: date) -> int:
    from api.services.bars_fetch import _session_window
    return _session_window(d, "rth")[1]


def _midnight_ts(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=_ET).timestamp())


def _last_trading_day_in(lo: date, hi: date) -> date | None:
    from api.services.bars_fetch import _is_trading_day_ymd
    d = hi
    while d >= lo:
        if _is_trading_day_ymd(d):
            return d
        d -= timedelta(days=1)
    return None


def bucket_bounds(tf: str, t, grid: str) -> tuple[int, int] | None:
    """(start, end) unix seconds of the bucket a row keyed `t` covers; end exclusive.
    D = that session's RTH close; W = the week's last session close (key = its Friday);
    M = the month's last session close (key = the 1st). None for an unreadable key."""
    try:
        if tf in DATE_TFS:
            d = _date_of(t)
            if d is None:
                return None
            if tf == "D":
                return _midnight_ts(d), _rth_close_ts(d)
            if tf == "W":
                mon = d - timedelta(days=d.weekday())
                last = _last_trading_day_in(mon, mon + timedelta(days=4)) or d
                return _midnight_ts(mon), _rth_close_ts(last)
            first = d.replace(day=1)
            nxt = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
            last = _last_trading_day_in(first, nxt - timedelta(days=1)) or first
            return _midnight_ts(first), _rth_close_ts(last)
        from api.services.bar_rollup import tv_bucket_bounds
        sess = "eth" if grid == "eth-clock" else "rth"
        s, e = tv_bucket_bounds(int(t) * 1000, tf, sess)
        return s // 1000, e // 1000
    except Exception:                      # noqa: BLE001 — an unreadable key guarantees nothing
        return None


def _store_key(tf: str, t):
    """A served row's `t` as the bars.db `ts` key (YYYYMMDD int on D/W/M)."""
    if tf in DATE_TFS:
        d = _date_of(t)
        return None if d is None else d.year * 10000 + d.month * 100 + d.day
    try:
        return int(t)
    except (TypeError, ValueError):
        return None


def _same_values(row: dict, stored: tuple) -> bool:
    """A served row carries the stored row's values (c and v; serve-time sanitising may
    scale prices, which then — correctly — reads as 'not the store's row')."""
    try:
        c, v = row.get("c"), row.get("v")
        sc, sv = stored[4], stored[5]
        if c is None or sc is None:
            return False
        return abs(float(c) - float(sc)) <= 1e-9 * max(1.0, abs(float(sc))) and \
            int(v or 0) == int(sv or 0)
    except (TypeError, ValueError, IndexError):
        return False


# ── the contract ─────────────────────────────────────────────────────────────

def _bar_out(row: dict, rev) -> dict:
    return {"t": row.get("t"), "o": row.get("o"), "h": row.get("h"), "l": row.get("l"),
            "c": row.get("c"), "v": row.get("v"), "rev": rev}


def _row_from_store(tf: str, r: tuple) -> dict:
    ts = r[0]
    if tf in DATE_TFS:
        s = str(int(ts))
        ts = f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return {"t": ts, "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}


def compute(ticker: str, tf: str, session, rows: list, *, delta: bool = False,
            to: bool = False, store_backed: bool = True, now: float | None = None,
            store_rows: list | None = None, meta: dict | None = None,
            reconcile: bool = True) -> dict:
    """The contract fields for one answer. `rows` = the answer's `bars` (dicts, in the
    wire format). `store_rows` / `meta` override the store reads (tests; derived grids).
    `meta` should be read BEFORE the answer's rows were (`snapshot_meta`), so the rows
    are never older than the `series_rev` they are labelled with. When the answer's
    tail had to be refreshed from the store the new rows come back under "_bars".

    complete_through (see the doc for the proof):
      P  = max(verified_through, start of the store's newest row)  — every bucket that
           ENDS at or before P is final in the store: the provider was asked after it
           closed (verified_through), or a later row exists (every tail writer re-fetches
           from the stored tail bucket inclusive, so a bucket older than the store's
           newest row was last written after it closed).
      CT = end of the newest row R of this answer with end(R) <= min(P, now), and
           <= start of the answer's last row when that row is not the store's current
           row (a cached/older snapshot: its last row may be a stale partial), and
           <= end of the newest SEALED stored row (never past what the store holds).
    """
    from api.services import bars_fetch as _bf
    from api.services import bars_sqlite as _bs
    now = float(now if now is not None else _time.time())
    sess = _norm_session(session) if tf in INTRADAY_TFS else None
    grid = grid_for(tf, sess)
    out = {"contract": CONTRACT_VERSION, "grid": grid, "session": sess,
           "cache_key": cache_key(ticker, tf, sess), "series_rev": None,
           "history_rev": None, "verified_through": None, "complete_through": None,
           "developing": None}
    rows = [r for r in (rows or []) if isinstance(r, dict)]
    src = source_series(tf, sess)
    if not store_backed:
        out["developing"] = _developing(tf, grid, rows, None, now)
        return out
    tkr = str(ticker).upper()
    if meta is None:
        meta = _bs.series_meta(tkr, src)
    rev = int(meta.get("rev") or 0)
    out["series_rev"] = rev
    out["history_rev"] = int(meta.get("history_rev") or 0)
    # `verified_through` on the wire = the tail-status proof (store + live stream);
    # complete_through rests on the STORE's own persisted proof only, the one the
    # store's history accounting (`bars_sqlite._history_keys`) also reads.
    vt = meta.get("verified_through")
    out["verified_through"] = (_bf.tail_verified_through(tkr, src)
                               if src in INTRADAY_TFS else vt)
    if store_rows is None:
        try:
            store_rows = _bs.get_bars(tkr, src, 2)
        except Exception:                  # noqa: BLE001 — an unreadable store proves nothing
            store_rows = []
    # ⭐ The answer describes the store AT `series_rev` or later: an intraday full answer
    # whose tail is an older snapshot (a memory-cache hit, a write that landed after the
    # rows were read) gets the store's current tail spliced in, read AFTER the proof.
    if (not delta and not to and tf in INTRADAY_TFS and src == tf and rows and store_rows
            and reconcile):
        spliced = _reconcile_tail(tkr, tf, rows, store_rows)
        if spliced is not rows:
            rows = spliced
            out["_bars"] = spliced
    considered = [_row_from_store(tf, r) for r in store_rows] if delta else rows
    dev_rows = considered
    if delta and rows and (not considered or (_store_key(tf, rows[-1].get("t")) or 0)
                           > (_store_key(tf, considered[-1].get("t")) or 0)):
        dev_rows = rows                    # e.g. today's daily bar appended past the store
    out["developing"] = (_developing(tf, grid, dev_rows, rev, now)
                         or _live_partial(tkr, tf, sess, grid, now))
    if not store_rows or not considered:
        return out
    # P: the store's proof instant.
    tail_b = bucket_bounds(tf, store_rows[-1][0] if tf in INTRADAY_TFS
                           else _row_from_store(tf, store_rows[-1])["t"], grid)
    if tail_b is None:
        return out
    proof = tail_b[0]
    if vt is not None:
        proof = max(proof, float(vt))
    limit = min(proof, now)
    # Never past the newest SEALED stored row.
    sealed_ends = [b[1] for b in (bucket_bounds(tf, (r[0] if tf in INTRADAY_TFS
                                                     else _row_from_store(tf, r)["t"]), grid)
                                  for r in store_rows) if b is not None and b[1] <= now]
    if not sealed_ends:
        return out
    limit = min(limit, max(sealed_ends))
    # A full answer whose last row is not the store's current row of that bucket is an
    # older snapshot (memory cache, a concurrent write): its last row proves nothing.
    if not delta and not to:
        last_key = _store_key(tf, considered[-1].get("t"))
        stored = {int(r[0]): r for r in store_rows}
        newest_stored = int(store_rows[-1][0])
        lb = bucket_bounds(tf, considered[-1].get("t"), grid)
        if last_key is None or lb is None:
            return out
        if last_key <= newest_stored and not (last_key in stored and
                                              _same_values(considered[-1], stored[last_key])):
            limit = min(limit, lb[0])
    for r in reversed(considered):
        b = bucket_bounds(tf, r.get("t"), grid)
        if b is not None and b[1] <= limit:
            out["complete_through"] = int(b[1])
            break
    return out


def snapshot_meta(ticker: str, tf: str, session=None):
    """The store's series meta for an answer, read BEFORE its rows (see `compute`)."""
    from api.services import bars_sqlite as _bs
    try:
        return _bs.series_meta(str(ticker).upper(), source_series(tf, session))
    except Exception:                      # noqa: BLE001
        return None


def _reconcile_tail(ticker: str, tf: str, rows: list, store_rows: list) -> list:
    """`rows` with every row from its last bucket onward replaced by the store's, when
    the answer's last row is not the store's current row for that bucket. Returns
    `rows` itself (identity) when nothing had to change or the store cannot be read."""
    try:
        last_key = int(rows[-1].get("t"))
    except (TypeError, ValueError):
        return rows
    stored = {int(r[0]): r for r in store_rows}
    if last_key > int(store_rows[-1][0]):
        return rows                        # newer than the store (not persisted yet)
    if (last_key == int(store_rows[-1][0])
            and _same_values(rows[-1], stored[last_key])):
        return rows                        # the answer already ends on the store's tail
    try:
        from api.services import bars_sqlite as _bs
        from api.services.bars_fetch import _fmt_sqlite_bars
        fresh = _fmt_sqlite_bars(_bs.get_bars_since(ticker, tf, last_key - 1), tf, ticker)
    except Exception:                      # noqa: BLE001
        return rows
    if not fresh:
        return rows
    return [r for r in rows if int(r.get("t")) < last_key] + fresh


def _developing(tf: str, grid: str, rows: list, rev, now: float):
    """The newest row whose bucket contains `now` (start <= now < end), else None."""
    if not rows:
        return None
    b = bucket_bounds(tf, rows[-1].get("t"), grid)
    if b is None or not (b[0] <= now < b[1]):
        return None
    return _bar_out(rows[-1], rev if rev is not None else int(now * 1000))


def _live_partial(ticker: str, tf: str, sess, grid: str, now: float):
    """The push feed's developing bar for the CURRENT bucket, when this process runs the
    broadcaster and a first answer stops at the newest closed bucket (the store does not
    hold the forming one yet). Never invents a bar: None when nothing is known."""
    if tf not in INTRADAY_TFS:
        return None
    try:
        from api.services.bar_broadcaster import get_broadcaster
        bar = get_broadcaster().get_partial(ticker, tf, "eth" if grid == "eth-clock" and tf == "60" else "rth")
    except Exception:                      # noqa: BLE001 — no broadcaster in this process
        return None
    if not bar or bar.get("final"):
        return None
    t = int(bar["t"]) // 1000
    b = bucket_bounds(tf, t, grid)
    if b is None or not (b[0] <= now < b[1]):
        return None
    return _bar_out(dict(bar, t=t), int(bar.get("trade_ts") or now * 1000))


def derive_for_grid(ticker: str, tf: str, session, rows: list, base: dict,
                    base_tf: str, now: float | None = None) -> dict:
    """Contract for an answer DERIVED on read from another stored series (the ETH 60m
    grid from 15m): identity from (tf, session); series_rev / verified_through from the
    base; complete_through = end of the newest derived row that ends at or before the
    base's complete_through (a derived bucket is final iff all its base buckets are)."""
    now = float(now if now is not None else _time.time())
    sess = _norm_session(session)
    grid = grid_for(tf, sess)
    rows = [r for r in (rows or []) if isinstance(r, dict)]
    out = {"contract": CONTRACT_VERSION, "grid": grid, "session": sess,
           "cache_key": cache_key(ticker, tf, sess), "series_rev": base.get("series_rev"),
           "history_rev": base.get("history_rev"),
           "verified_through": base.get("verified_through"), "complete_through": None,
           "developing": _developing(tf, grid, rows, base.get("series_rev"), now)}
    bct = base.get("complete_through")
    if bct is not None:
        for r in reversed(rows):
            b = bucket_bounds(tf, r.get("t"), grid)
            if b is not None and b[1] <= bct:
                out["complete_through"] = int(b[1])
                break
    return out


# ── stream ───────────────────────────────────────────────────────────────────

_STREAM_REV_TTL_S = 1.0
_stream_rev_cache: dict = {}


def stream_fields(sym: str, tf: str, session) -> dict:
    """Contract identity for one /api/stream/bars pair (grid/session/cache_key and the
    store's series_rev, cached ~1 s: a stream event must never wait on SQLite)."""
    sess = _norm_session(session) or "rth"
    src = source_series(tf, sess)
    key = (str(sym).upper(), src)
    now = _time.monotonic()
    hit = _stream_rev_cache.get(key)
    if hit is None or now - hit[0] > _STREAM_REV_TTL_S:
        try:
            from api.services import bars_sqlite as _bs
            rev = int(_bs.series_meta(key[0], src).get("rev") or 0)
        except Exception:                  # noqa: BLE001
            rev = None
        if len(_stream_rev_cache) > 20000:
            _stream_rev_cache.clear()
        _stream_rev_cache[key] = hit = (now, rev)
    return {"contract": CONTRACT_VERSION, "grid": grid_for(tf, sess), "session": sess,
            "cache_key": cache_key(sym, tf, sess), "series_rev": hit[1]}
