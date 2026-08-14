"""Dark Pool big-block intraday alerts — a live Discord ping when a single dark
print is large RELATIVE TO THE NAME: its notional is >= DARKPOOL_BIGBLOCK_PCT_ADV
percent of the ticker's 50-day average daily DOLLAR-volume.

This is SIZE-RELATIVE, unlike the all-time RECORD ping in darkpool_records (a flat
$100M floor). A flat dollar floor misses off-radar mid/small-caps; a %ADV floor
catches "this block is huge for THIS name" — a $4M print on a $30M-ADV ticker
(~13% ADV) fires, while the same $4M on a mega-cap does not.

Fires off the intraday poller (~3 min) on the BIGGEST print per ticker today.
Deduped per (date, ticker): a ticker pings once, then re-pings only if a strictly
larger block lands. Posts to the same channel as the EOD card (darkpool_eod._webhook).

Dark by default: DARKPOOL_BIGBLOCK_ENABLED=1 to arm. Knobs:
  DARKPOOL_BIGBLOCK_PCT_ADV      (default 5.0)  — % of 50d avg daily $-volume
  DARKPOOL_BIGBLOCK_MIN_NOTIONAL (default 4e6)  — absolute floor (matches the
                                                  ingest's $4M off-exchange floor)
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import urllib.request
from datetime import datetime

log = logging.getLogger("darkpool_bigblock")
_UA = "UCT-Massive/1.0 (+https://uctintelligence.com)"


def _enabled() -> bool:
    return os.getenv("DARKPOOL_BIGBLOCK_ENABLED", "0") == "1"


def _pct_floor() -> float:
    try:
        return float(os.getenv("DARKPOOL_BIGBLOCK_PCT_ADV", "5"))
    except (TypeError, ValueError):
        return 5.0


def _min_notional() -> float:
    try:
        return float(os.getenv("DARKPOOL_BIGBLOCK_MIN_NOTIONAL", "4e6"))
    except (TypeError, ValueError):
        return 4e6


def _conn():
    from api.darkpool_db import DB_PATH
    return sqlite3.connect(DB_PATH, timeout=15)


def _ensure_table():
    c = _conn()
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS darkpool_bigblock_alerts (
                date       TEXT NOT NULL,
                ticker     TEXT NOT NULL,
                notional   REAL NOT NULL,
                pct_adv    REAL,
                price      REAL,
                alerted_at TEXT,
                PRIMARY KEY (date, ticker)
            )
        """)
        c.commit()
    finally:
        c.close()


def pct_adv(notional, price, avg50_shares) -> float | None:
    """A single print's notional as a % of the 50-day avg daily $-volume:
    shares_in_print / avg_daily_shares * 100. None when inputs can't support it."""
    try:
        n = float(notional or 0)
        px = float(price or 0)
        av = float(avg50_shares or 0)
    except (TypeError, ValueError):
        return None
    if n <= 0 or px <= 0 or av <= 0:
        return None
    return (n / px) / av * 100.0


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
        log.warning("[darkpool-bigblock] alert post failed: %s", e)


def _evaluate(prints: list[tuple]) -> list[dict]:
    """From (ticker, notional, price, date) rows, return the NEW big-block events
    that (a) clear the absolute floor, (b) clear the %ADV floor, and (c) beat any
    prior alert for the same (date, ticker). Dedup is checked BEFORE the avg50
    lookup so an already-alerted ticker costs no Massive call."""
    floor_pct = _pct_floor()
    floor_min = _min_notional()
    _ensure_table()
    from api.darkpool_eod import _daily_stats
    c = _conn()
    events: list[dict] = []
    try:
        now = datetime.utcnow().isoformat()
        for tk, notional, price, date in prints:
            if not tk or not notional or (notional or 0) < floor_min or not date:
                continue
            cur = c.execute(
                "SELECT notional FROM darkpool_bigblock_alerts WHERE date=? AND ticker=?",
                (date, tk)).fetchone()
            if cur is not None and (notional or 0) <= (cur[0] or 0):
                continue  # already pinged this ticker today at >= this size
            avg50 = (_daily_stats(tk) or {}).get("avg50") or 0.0
            pct = pct_adv(notional, price, avg50)
            if pct is None or pct < floor_pct:
                continue
            if cur is None:
                c.execute(
                    "INSERT INTO darkpool_bigblock_alerts "
                    "(date,ticker,notional,pct_adv,price,alerted_at) VALUES (?,?,?,?,?,?)",
                    (date, tk, notional, pct, price, now))
            else:
                c.execute(
                    "UPDATE darkpool_bigblock_alerts SET notional=?,pct_adv=?,price=?,"
                    "alerted_at=? WHERE date=? AND ticker=?",
                    (notional, pct, price, now, date, tk))
            events.append({"ticker": tk, "notional": notional, "price": price,
                           "date": date, "pct_adv": pct})
        c.commit()
    finally:
        c.close()
    return events


def _alert(events: list[dict]) -> int:
    from api.darkpool_eod import _fmt_n
    sent = 0
    for e in sorted(events, key=lambda x: x.get("pct_adv") or 0, reverse=True):
        px = e.get("price")
        _at = f" @ ${px:,.2f}" if px else ""
        _post_text(
            f"📊 **{e['ticker']}** dark block **{_fmt_n(e['notional'])}**{_at} — "
            f"**{e['pct_adv']:.0f}% of 50d ADV**")
        sent += 1
    return sent


def _run(source: str, date: str | None) -> dict:
    if not _enabled():
        return {"ok": False, "reason": "disabled"}
    try:
        from api.darkpool_records import _max_per_ticker  # biggest print per ticker
        events = _evaluate(_max_per_ticker(source, date))
        return {"ok": True, "source": source, "new_blocks": len(events),
                "alerts_sent": _alert(events)}
    except Exception as e:  # noqa: BLE001
        log.exception("[darkpool-bigblock] refresh failed")
        return {"ok": False, "reason": str(e)}


def refresh_from_today() -> dict:
    """Intraday hook — scan today's biggest print per ticker in darkpool_today and
    ping the ones crossing the %ADV floor. Self-gated + fail-soft."""
    return _run("darkpool_today", None)


def refresh_from_trades(date_mdyyyy: str | None = None) -> dict:
    """Manual/backfill hook against the authoritative darkpool_trades for a date."""
    return _run("darkpool_trades", date_mdyyyy)
