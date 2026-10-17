"""Screener pre-market mode: the sweep and its table (spec 2026-10-16 §2).

From 04:00 to 09:30 ET the screener carries a pre-market price and a pre-market
change % per stock. Owner ruling 2026-10-16: extended-hours prints enter the
screener ONLY through these two columns, labelled as pre-market. The regular live
overlay (`live_tier.run_sweep`, `LIVE_COLUMNS`, `screener_live`, its serve
predicate) is untouched, and `run_sweep` there still refuses outside the regular
session.

⛔ THIS MODULE NEVER WRITES `screener_live` OR `screener_rows`. It reads the ticker
list from `screener_rows` and writes only `screener_premarket`, so it takes no
build lock (it reads no anchors).

⛔ NO NEW PROVIDER CALL. The only market read is `scan_volume.full_market_snapshot()`,
the 30 s shared cache the live tier and every preset scan already read.

⛔ A ROW IS WRITTEN ONLY WHEN THE SYMBOL TRADED TODAY IN PRE-MARKET — its last trade
(`last_trade_ns`, the provider's `lastTrade.t`) at or after 04:00 ET today. Otherwise
`last_price` is yesterday's close and the change would read 0.0% as if measured.

Serving (the `pm` join in `query.py`) is gated separately: only in pre-market, only
today's `session_ymd`, only rows under `MAX_AGE_S` old, and only to users the flag
reaches (`served_to`).
"""
from __future__ import annotations

import logging
import time

log = logging.getLogger(__name__)

FLAG = "SCREENER_PREMARKET_ENABLED"
TABLE = "screener_premarket"
COLUMNS = ("premarket_price", "premarket_chg_pct")
MAX_AGE_S = 180

_SCHEMA = (f"CREATE TABLE IF NOT EXISTS {TABLE} ("
           "ticker TEXT PRIMARY KEY, session_ymd INTEGER, premarket_price REAL, "
           "premarket_chg_pct REAL, premarket_asof REAL)")

_LAST: dict | None = None


def sweep_enabled() -> bool:
    """The sweep runs when the flag's scope is not off (`1` or `admin`), read PER CALL."""
    from api.routers import auth
    return auth._breadth_dc_scope(FLAG, auth.SCREENER_FLAGS[FLAG]) != auth._SCOPE_OFF


def served_to(user: dict | None) -> bool:
    """Whether THIS user may see the pre-market columns and starters.

    The same parse members' `/api/auth/me` payload uses, so the scan and the
    payload cannot disagree. No user ⇒ a member's answer (fails closed at `admin`)."""
    from api.routers import auth
    is_admin = (user or {}).get("role") == "admin"
    return bool(auth._screener_flags(is_admin=is_admin)[FLAG.lower()])


def _blank(**over) -> dict:
    r = {"skipped_reason": None, "considered": 0, "written": 0,
         "not_traded_today": 0, "no_feed": 0, "no_price": 0, "as_of": None}
    r.update(over)
    return r


def _finish(receipt: dict) -> dict:
    global _LAST
    _LAST = receipt
    return receipt


def last_receipt() -> dict | None:
    return dict(_LAST) if _LAST else None


def run_sweep() -> dict:
    """One pre-market cycle. Returns the receipt; a refusal is an answer.

    Order is cheapest first: the flag, then the session, and only then any read,
    so the 60 s job costs nothing for the 18.5 hours a day it has nothing to do."""
    if not sweep_enabled():
        return _finish(_blank(skipped_reason="disabled"))
    from api.services.screener import live_tier
    if live_tier._session() != "pre_market":
        return _finish(_blank(skipped_reason="not_pre_market"))

    from api.services import scan_volume
    from api.services.screener import snapshot_db

    now = live_tier._now_et()
    ymd = live_tier.session_ymd(now)
    cutoff_ns = int(now.replace(hour=4, minute=0, second=0, microsecond=0)
                    .timestamp()) * 1_000_000_000
    snap = scan_volume.full_market_snapshot() or {}

    with snapshot_db.connect() as conn:
        try:
            tickers = [r[0] for r in conn.execute("SELECT ticker FROM screener_rows")]
        except Exception:
            return _finish(_blank(skipped_reason="no_snapshot"))

    receipt = _blank(considered=len(tickers))
    as_of = time.time()
    batch = []
    for ticker in tickers:
        q = scan_volume._snap_lookup(snap, str(ticker or ""))
        if not q:
            receipt["no_feed"] += 1
            continue
        t_ns = q.get("last_trade_ns")
        if not isinstance(t_ns, int) or isinstance(t_ns, bool) or t_ns < cutoff_ns:
            receipt["not_traded_today"] += 1
            continue
        px, pc = q.get("last_price"), q.get("prev_close")
        if not (isinstance(px, (int, float)) and isinstance(pc, (int, float))
                and px > 0 and pc > 0):
            receipt["no_price"] += 1
            continue
        batch.append((ticker, ymd, round(float(px), 4),
                      round((px / pc - 1) * 100, 2), as_of))

    # ONE transaction: the table, today's-only, then the batch.
    with snapshot_db._WRITE_LOCK, snapshot_db.connect() as conn:
        conn.execute(_SCHEMA)
        conn.execute(f"DELETE FROM {TABLE} WHERE session_ymd != ?", (ymd,))
        conn.executemany(
            f"INSERT OR REPLACE INTO {TABLE} (ticker, session_ymd, premarket_price, "
            "premarket_chg_pct, premarket_asof) VALUES (?, ?, ?, ?, ?)", batch)
        conn.commit()
    receipt["written"] = len(batch)
    receipt["as_of"] = as_of
    return _finish(receipt)


def sweep_job() -> dict:
    """The scheduled entry point. Logs a writing cycle; a skip is silent."""
    receipt = run_sweep()
    if not receipt["skipped_reason"]:
        log.info("[screener-premarket] written=%s considered=%s not_traded_today=%s "
                 "no_feed=%s no_price=%s", receipt["written"], receipt["considered"],
                 receipt["not_traded_today"], receipt["no_feed"], receipt["no_price"])
    return receipt
