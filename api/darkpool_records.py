"""Dark Pool records — per-ticker biggest-ever dark-pool prints (persistent, never
pruned) + new-record Discord alerts. Web-side (owns darkpool.db).

`darkpool_trades` is pruned to ~120 trading days, so an all-time record must live
in its OWN table that only ever grows. Records update from the nightly ingest
(authoritative) and the intraday poller (~3-min, real-time). A print that BEATS an
existing record AND is >= DARKPOOL_RECORDS_ALERT_FLOOR (default $100M) fires one
Discord ping to the same channel as the EOD card. A ticker's FIRST-ever print is
stored silently (nothing to beat). Alerts dedup naturally: only a strictly-bigger
notional updates the row, so re-seeing the same print never re-alerts.

Dark by default: DARKPOOL_RECORDS_ENABLED=1 to arm tracking + alerts.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime

log = logging.getLogger("darkpool_records")
_UA = "UCT-Massive/1.0 (+https://uctintelligence.com)"


def _enabled() -> bool:
    return os.getenv("DARKPOOL_RECORDS_ENABLED", "0") == "1"


def _alert_floor() -> float:
    try:
        return float(os.getenv("DARKPOOL_RECORDS_ALERT_FLOOR", "100e6"))
    except (TypeError, ValueError):
        return 100e6


def _conn():
    from api.darkpool_db import DB_PATH
    return sqlite3.connect(DB_PATH, timeout=15)


def _ensure_table():
    c = _conn()
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS darkpool_records (
                ticker        TEXT PRIMARY KEY,
                notional      REAL NOT NULL,
                price         REAL,
                date          TEXT,
                prev_notional REAL,
                prev_date     TEXT,
                updated_at    TEXT
            )
        """)
        c.commit()
    finally:
        c.close()


def _records_count() -> int:
    _ensure_table()
    c = _conn()
    try:
        return c.execute("SELECT COUNT(*) FROM darkpool_records").fetchone()[0]
    finally:
        c.close()


def _max_per_ticker(source: str, date: str | None = None) -> list[tuple]:
    """Biggest print per ticker from a source table (darkpool_trades /
    darkpool_today), optionally one date. Returns (ticker, notional, price, date).
    `source` is a fixed internal literal — never user input."""
    c = _conn()
    try:
        if date:
            rows = c.execute(f"""
                SELECT t.ticker, t.notional, t.price, t.date FROM {source} t
                JOIN (SELECT ticker, MAX(notional) mx FROM {source}
                      WHERE notional IS NOT NULL AND date=? GROUP BY ticker) m
                  ON t.ticker=m.ticker AND t.notional=m.mx AND t.date=?
            """, (date, date)).fetchall()
        else:
            rows = c.execute(f"""
                SELECT t.ticker, t.notional, t.price, t.date FROM {source} t
                JOIN (SELECT ticker, MAX(notional) mx FROM {source}
                      WHERE notional IS NOT NULL GROUP BY ticker) m
                  ON t.ticker=m.ticker AND t.notional=m.mx
            """).fetchall()
    finally:
        c.close()
    # A ticker can tie its own max on two rows — keep one.
    seen: dict = {}
    for tk, notional, price, dt in rows:
        if tk and (tk not in seen or (notional or 0) > (seen[tk][1] or 0)):
            seen[tk] = (tk, notional, price, dt)
    return list(seen.values())


def seed_from_trades() -> int:
    """Idempotent seed: each ticker's biggest print in the retained trades history.
    Upserts the MAX so re-seeding never lowers a record. Returns rows written."""
    _ensure_table()
    prints = _max_per_ticker("darkpool_trades")
    c = _conn()
    n = 0
    try:
        now = datetime.utcnow().isoformat()
        for tk, notional, price, date in prints:
            if not tk or not notional or notional <= 0:
                continue
            cur = c.execute("SELECT notional FROM darkpool_records WHERE ticker=?", (tk,)).fetchone()
            if cur is None:
                c.execute("INSERT INTO darkpool_records (ticker,notional,price,date,updated_at) "
                          "VALUES (?,?,?,?,?)", (tk, notional, price, date, now))
                n += 1
            elif (notional or 0) > (cur[0] or 0):
                c.execute("UPDATE darkpool_records SET notional=?,price=?,date=?,updated_at=? "
                          "WHERE ticker=?", (notional, price, date, now, tk))
                n += 1
        c.commit()
    finally:
        c.close()
    return n


def _apply(prints: list[tuple]) -> list[dict]:
    """Update records from prints; return NEW-record events (only those that BEAT
    an existing record — a first-ever ticker is stored silently)."""
    _ensure_table()
    c = _conn()
    events: list[dict] = []
    try:
        now = datetime.utcnow().isoformat()
        for tk, notional, price, date in prints:
            if not tk or not notional or notional <= 0:
                continue
            cur = c.execute("SELECT notional,date FROM darkpool_records WHERE ticker=?", (tk,)).fetchone()
            if cur is None:
                c.execute("INSERT INTO darkpool_records (ticker,notional,price,date,updated_at) "
                          "VALUES (?,?,?,?,?)", (tk, notional, price, date, now))
            elif notional > (cur[0] or 0):
                c.execute("UPDATE darkpool_records SET notional=?,price=?,date=?,"
                          "prev_notional=?,prev_date=?,updated_at=? WHERE ticker=?",
                          (notional, price, date, cur[0], cur[1], now, tk))
                events.append({"ticker": tk, "notional": notional, "price": price, "date": date,
                               "prev_notional": cur[0], "prev_date": cur[1]})
        c.commit()
    finally:
        c.close()
    return events


# ── Discord alert (text ping, hand-rolled over stdlib urllib) ───────────────
def _post_text(content: str) -> None:
    from api.darkpool_eod import _webhook
    wh = _webhook()
    if not wh:
        return
    data = json.dumps({
        "content": content[:1900],
        "username": "UCT Intelligence · Dark Pool",
        "allowed_mentions": {"parse": []},
    }).encode("utf-8")
    req = urllib.request.Request(
        wh, data=data, method="POST",
        headers={"Content-Type": "application/json", "User-Agent": _UA})
    try:
        urllib.request.urlopen(req, timeout=15)
    except Exception as e:  # noqa: BLE001
        log.warning("[darkpool-records] alert post failed: %s", e)


def _alert(events: list[dict]) -> int:
    from api.darkpool_eod import _fmt_n
    floor = _alert_floor()
    sent = 0
    for e in sorted(events, key=lambda x: x["notional"] or 0, reverse=True):
        if (e["notional"] or 0) < floor:
            continue
        px = e.get("price")
        _at = f" @ ${px:,.2f}" if px else ""
        if e.get("prev_notional"):
            _prev = f" — beats {_fmt_n(e['prev_notional'])}" + (f" ({e['prev_date']})" if e.get("prev_date") else "")
        else:
            _prev = ""
        _post_text(f"🚨 **{e['ticker']}** set a new dark-pool record: **{_fmt_n(e['notional'])}**{_at}{_prev}")
        sent += 1
    return sent


# ── entry points (called from the ingest paths; fail-soft) ──────────────────
def _refresh(source: str, date: str | None) -> dict:
    if not _enabled():
        return {"ok": False, "reason": "disabled"}
    try:
        just_seeded = False
        if _records_count() == 0:
            seed_from_trades()          # first-ever: capture the baseline silently
            just_seeded = True
        events = _apply(_max_per_ticker(source, date))
        sent = 0 if just_seeded else _alert(events)   # never alert on the seed cycle
        return {"ok": True, "source": source, "new_records": len(events),
                "alerts_sent": sent, "seeded": just_seeded}
    except Exception as e:  # noqa: BLE001
        log.exception("[darkpool-records] refresh failed")
        return {"ok": False, "reason": str(e)}


def refresh_from_trades(date_mdyyyy: str | None = None) -> dict:
    """Nightly hook — the authoritative session just landed in darkpool_trades."""
    return _refresh("darkpool_trades", date_mdyyyy)


def refresh_from_today() -> dict:
    """Intraday hook — new live prints just landed in darkpool_today (~3 min)."""
    return _refresh("darkpool_today", None)


def get_records(limit: int = 300, sort: str = "notional") -> list[dict]:
    """The records table for the /api/darkpool/records endpoint + panel."""
    _ensure_table()
    order = {"notional": "notional DESC", "date": "date DESC",
             "ticker": "ticker ASC"}.get(sort, "notional DESC")
    c = _conn()
    try:
        rows = c.execute(
            f"SELECT ticker,notional,price,date,prev_notional,prev_date,updated_at "
            f"FROM darkpool_records ORDER BY {order} LIMIT ?", (int(limit),)).fetchall()
    finally:
        c.close()
    return [{"ticker": r[0], "notional": r[1], "price": r[2], "date": r[3],
             "prevNotional": r[4], "prevDate": r[5], "updatedAt": r[6]} for r in rows]
