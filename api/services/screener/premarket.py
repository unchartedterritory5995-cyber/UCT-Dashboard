"""Screener EXTENDED HOURS: the sweep and its table (spec 2026-10-16 §2, widened 2026-10-17).

The screener carries ONE extended-hours price and change % per stock, the way the
watchlist carries `ext_price` beside the regular price:

  pre-market  04:00-09:30 ET  price traded since 04:00, change vs the previous close
  after hours close-20:00 ET  price traded since the close, change vs TODAY'S close
  closed      overnight, weekends, holidays: the last after-hours print is HELD
  session     09:30-close: nothing (the regular live overlay is the price)

Owner rulings: 2026-10-16, extended-hours prints enter the screener ONLY through these
two columns, labelled by session; 2026-10-17, "why would it be any different than
premarket when the market is open or closed" -- one column for both windows, not a
mode per window. The windows are the trading CALENDAR's (`session_calendar.session_at`,
13:00 closes and holidays included), not the weekday clock.

⚠️ THE KEYS ARE HISTORICAL. `premarket_price` / `premarket_chg_pct` (and this module's
name, its table and its flag `SCREENER_PREMARKET_ENABLED`) predate the widening; they
are kept so saved screens, the flag on Railway and the join keep working. The labels a
member reads say "Ext-hrs". `ext_session` ('pre' | 'post') says which window a row is.

⛔ THIS MODULE NEVER WRITES `screener_live` OR `screener_rows`. It reads the ticker list
from `screener_rows` and writes only `screener_premarket`, so it takes no build lock.

⛔ NO NEW PROVIDER CALL. The only market read is `scan_volume.full_market_snapshot()`,
the 30 s shared cache the live tier and every preset scan already read.

⛔ A ROW IS WRITTEN ONLY FOR A STOCK THAT TRADED IN THE WINDOW. Pre-market: its last
trade at or after 04:00 ET today. After hours: a trade (or a minute bar) after today's
close. Otherwise the price is the reference itself and the change would read 0.0% as
if measured.
"""
from __future__ import annotations

import logging
import time

log = logging.getLogger(__name__)

FLAG = "SCREENER_PREMARKET_ENABLED"
TABLE = "screener_premarket"
COLUMNS = ("premarket_price", "premarket_chg_pct")
MAX_AGE_S = 180
SWEEP_WINDOWS = ("pre", "post")

_SCHEMA = (f"CREATE TABLE IF NOT EXISTS {TABLE} ("
           "ticker TEXT PRIMARY KEY, session_ymd INTEGER, premarket_price REAL, "
           "premarket_chg_pct REAL, premarket_asof REAL, ext_session TEXT)")

_LAST: dict | None = None


def sweep_enabled() -> bool:
    """The sweep runs when the flag's scope is not off (`1` or `admin`), read PER CALL."""
    from api.routers import auth
    return auth._breadth_dc_scope(FLAG, auth.SCREENER_FLAGS[FLAG]) != auth._SCOPE_OFF


def served_to(user: dict | None) -> bool:
    """Whether THIS user may see the extended-hours columns and starters.

    The same parse members' `/api/auth/me` payload uses, so the scan and the
    payload cannot disagree. No user ⇒ a member's answer (fails closed at `admin`)."""
    from api.routers import auth
    is_admin = (user or {}).get("role") == "admin"
    return bool(auth._screener_flags(is_admin=is_admin)[FLAG.lower()])


def window(now=None) -> str:
    """'pre' | 'rth' | 'post' | 'closed' at `now` (ET), from the trading calendar."""
    from api.services import session_calendar
    from api.services.screener import live_tier
    return session_calendar.session_at(now or live_tier._now_et())


def ensure_schema(conn) -> None:
    """The table, plus `ext_session` on a table created before 2026-10-17."""
    conn.execute(_SCHEMA)
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({TABLE})")}
    if "ext_session" not in cols:
        conn.execute(f"ALTER TABLE {TABLE} ADD COLUMN ext_session TEXT")


def serve_params(conn, now=None):
    """`(session_ymd, min_asof, ext_session)` the join binds, or None (serve NULL).

    In a sweep window: today's rows of that window, under `MAX_AGE_S` old, so a dead
    sweeper serves NULL rather than a frozen price. Closed: the newest after-hours
    rows, held with no age limit (the window that produced them is over, so they are
    final). In the session: None."""
    from api.services.screener import live_tier
    now = now or live_tier._now_et()
    w = window(now)
    if w in SWEEP_WINDOWS:
        return int(live_tier.session_ymd(now)), time.time() - MAX_AGE_S, w
    if w != "closed":
        return None
    row = conn.execute(f"SELECT MAX(session_ymd) FROM {TABLE} "
                       "WHERE ext_session = 'post'").fetchone()
    if not row or row[0] is None:
        return None
    return int(row[0]), 0.0, "post"


def _blank(**over) -> dict:
    r = {"skipped_reason": None, "window": None, "considered": 0, "written": 0,
         "not_traded_today": 0, "no_feed": 0, "no_price": 0, "as_of": None}
    r.update(over)
    return r


def _finish(receipt: dict) -> dict:
    global _LAST
    _LAST = receipt
    return receipt


def last_receipt() -> dict | None:
    return dict(_LAST) if _LAST else None


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def quote_price(q: dict, w: str, start_ns: int):
    """`(price, reference)` for one stock in window `w`, or `(None, reason)`.

    Pre-market: the last trade since 04:00, against the previous close. After hours:
    the last trade since the close, against today's close (`day_close`); when
    `lastTrade` is not after the close but the minute bar is, the minute close (the
    provider pins some names' `lastTrade` to the 16:00 print, `massive._ext_price_for`)."""
    t_ns = q.get("last_trade_ns")
    traded = isinstance(t_ns, int) and not isinstance(t_ns, bool) and t_ns >= start_ns
    if w == "pre":
        if not traded:
            return None, "not_traded_today"
        px, ref = _num(q.get("last_price")), _num(q.get("prev_close"))
    else:
        ref = _num(q.get("day_close"))
        px = _num(q.get("last_price")) if traded and t_ns > start_ns else None
        if px is None:
            m_ms = q.get("min_t_ms")
            if isinstance(m_ms, int) and not isinstance(m_ms, bool) and m_ms * 1_000_000 > start_ns:
                px = _num(q.get("min_close"))
            if px is None:
                return None, "not_traded_today"
    if px is None or ref is None:
        return None, "no_price"
    return (px, ref), None


def run_sweep(now=None) -> dict:
    """One cycle. Returns the receipt; a refusal is an answer.

    Order is cheapest first: the flag, then the window, and only then any read, so the
    60 s job costs nothing outside the two windows."""
    if not sweep_enabled():
        return _finish(_blank(skipped_reason="disabled"))
    from api.services import scan_volume, session_calendar
    from api.services.screener import live_tier, snapshot_db

    now = now or live_tier._now_et()
    w = window(now)
    if w not in SWEEP_WINDOWS:
        return _finish(_blank(skipped_reason="not_extended_hours", window=w))

    ymd = live_tier.session_ymd(now)
    if w == "pre":
        start = now.replace(hour=4, minute=0, second=0, microsecond=0)
    else:
        start = session_calendar.close_time(now.date())
    start_ns = int(start.timestamp()) * 1_000_000_000
    snap = scan_volume.full_market_snapshot() or {}

    with snapshot_db.connect() as conn:
        try:
            tickers = [r[0] for r in conn.execute("SELECT ticker FROM screener_rows")]
        except Exception:
            return _finish(_blank(skipped_reason="no_snapshot", window=w))

    receipt = _blank(considered=len(tickers), window=w)
    as_of = time.time()
    batch = []
    for ticker in tickers:
        q = scan_volume._snap_lookup(snap, str(ticker or ""))
        if not q:
            receipt["no_feed"] += 1
            continue
        got, why = quote_price(q, w, start_ns)
        if got is None:
            receipt[why] += 1
            continue
        px, ref = got
        batch.append((ticker, ymd, round(px, 4), round((px / ref - 1) * 100, 2), as_of, w))

    # ONE transaction. A window's rows replace that window's older rows; rows written
    # before `ext_session` existed (NULL) were pre-market, and are superseded.
    with snapshot_db._WRITE_LOCK, snapshot_db.connect() as conn:
        ensure_schema(conn)
        conn.execute(f"DELETE FROM {TABLE} WHERE ext_session IS NULL "
                     "OR (ext_session = ? AND session_ymd != ?)", (w, ymd))
        conn.executemany(
            f"INSERT OR REPLACE INTO {TABLE} (ticker, session_ymd, premarket_price, "
            "premarket_chg_pct, premarket_asof, ext_session) VALUES (?, ?, ?, ?, ?, ?)",
            batch)
        conn.commit()
    receipt["written"] = len(batch)
    receipt["as_of"] = as_of
    return _finish(receipt)


def sweep_job() -> dict:
    """The scheduled entry point. Logs a writing cycle; a skip is silent."""
    receipt = run_sweep()
    if not receipt["skipped_reason"]:
        log.info("[screener-extended] window=%s written=%s considered=%s "
                 "not_traded_today=%s no_feed=%s no_price=%s", receipt["window"],
                 receipt["written"], receipt["considered"], receipt["not_traded_today"],
                 receipt["no_feed"], receipt["no_price"])
    return receipt
