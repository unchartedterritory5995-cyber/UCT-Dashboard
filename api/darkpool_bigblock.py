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
  DARKPOOL_BIGBLOCK_MAX_PCT_ADV  (default 400)  — ceiling: above this, a print is a
                                                  creation/NAV/thin-ticker artifact
  DARKPOOL_BIGBLOCK_ETF_MIN_NOTIONAL (default 100e6) — a NON-bond ETF must clear
                                                  this heavier floor to alert (big
                                                  index/broad blocks only). Bond ETFs
                                                  are ALWAYS excluded.
  DARKPOOL_BIGBLOCK_EQUITY_ONLY  (default 0)    — 1 = hard-exclude EVERY ETF
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


def _equity_only() -> bool:
    # OFF by default now: equities always alert; NON-bond ETFs alert only when
    # HEAVY (>= _etf_min_notional) — so big broad/index blocks (VOO, GLD, SPY) show
    # but the fund/NAV noise doesn't. Bond ETFs are ALWAYS excluded regardless.
    # Set 1 to hard-exclude every ETF (equities only).
    return os.getenv("DARKPOOL_BIGBLOCK_EQUITY_ONLY", "0") == "1"


def _etf_min_notional() -> float:
    # A NON-bond ETF must clear this much heavier notional floor than an equity to
    # alert — an index/broad ETF block is only interesting when it's genuinely big.
    try:
        return float(os.getenv("DARKPOOL_BIGBLOCK_ETF_MIN_NOTIONAL", "100e6"))
    except (TypeError, ValueError):
        return 100e6


def _max_pct() -> float:
    # Sanity ceiling: a single print above this % of avg daily volume is almost
    # always a creation/NAV/thin-new-ticker artifact, not a real trade.
    try:
        return float(os.getenv("DARKPOOL_BIGBLOCK_MAX_PCT_ADV", "400"))
    except (TypeError, ValueError):
        return 400.0


# Empirical dark-pool ETF/fund universe (every ticker BBS labels ETF/Fund in the
# dark-pool tape). NETWORK-FREE — so ETF exclusion works even when FMP is down.
# Superset of the aggregator's category sets; catches the style/intl/CLO stragglers
# (EFV, SCZ, JAAA, SPYG, HGER, MBB, GOOGM…) FMP would otherwise be the only guard on.
_KNOWN_DARK_ETFS = {
    "ACLO", "AGG", "ARCP", "ARMS", "AVDV", "BAI", "BCI", "BHYB", "BIL", "BKGI",
    "BKLC", "BKLN", "BND", "BNDX", "BSV", "CGBL", "CGCB", "CGCV", "CGGO", "CGMM",
    "CORB", "CWB", "DFIS", "DIAL", "DRAM", "EEM", "EFA", "EFV", "EMB", "EUFN",
    "EVLN", "EWJ", "EWY", "EWZ", "FLJP", "FLKR", "FLUD", "FLXR", "FTSM", "FXI",
    "FXY", "GDX", "GGUS", "GLD", "GMUB", "GOOGM", "GOOGN", "GSEU", "GSID", "GSLC",
    "GSUS", "GVUS", "HEFA", "HELO", "HGER", "HYG", "IAGG", "IBDY", "IBIT", "IEF",
    "IEFA", "IEMG", "IGIB", "IGLB", "IGSB", "IHI", "IJH", "IUSB", "IVV", "IWF",
    "IWM", "IWY", "IYR", "IYW", "JAAA", "JBND", "JCPB", "JIVE", "JMST", "JMUB",
    "JPST", "KRE", "KWEB", "LQD", "MBB", "MMIT", "MUB", "MYCH", "NSCI", "PAUG",
    "PICK", "PMBS", "PSQ", "PYLD", "QID", "QLD", "QQQ", "RECS", "SCHD", "SCHF",
    "SCHI", "SCHP", "SCHR", "SCHX", "SCMB", "SCZ", "SEIE", "SGOV", "SH", "SHV",
    "SHYG", "SKHY", "SLV", "SMBS", "SMCIP", "SNXX", "SOXQ", "SPAB", "SPHY", "SPMB",
    "SPSB", "SPSM", "SPY", "SPYG", "SPYM", "SRLN", "SSO", "SUSB", "TAXS", "TLT",
    "TLTW", "TUSI", "UAE", "USHY", "USO", "UUP", "VCLT", "VCRB", "VEU", "VGIT",
    "VGSR", "VOO", "VT", "VTEB", "VTEI", "VTV", "VUG", "VXUS", "WCMI", "XBB",
    "XCCC", "XLB", "XLC", "XLE", "XLF", "XLP", "XLU", "XLY", "XME",
}


def _is_etf(ticker: str) -> bool:
    """ETF/fund detection, resilient to FMP being unavailable. Order: (1) the
    network-free static dark-pool ETF set + the aggregator's own fund categories +
    the shared override, then (2) FMP isEtf for anything new. Fail-OPEN only when
    ALL are silent (unknown → treated as equity, never suppress a real block)."""
    tk = (ticker or "").upper()
    if not tk:
        return False
    if tk in _KNOWN_DARK_ETFS:
        return True
    try:
        from api.darkpool_eod import _ETF_CATS, _ETF_OVERRIDE
        from api.darkpool_aggregator import classify_ticker
        if tk in _ETF_OVERRIDE or classify_ticker(tk, 0, 1) in _ETF_CATS:
            return True
    except Exception:
        pass
    try:
        from api.darkpool_eod import _ticker_meta
        return (_ticker_meta(tk) or {}).get("isEtf") is True
    except Exception:
        return False


# Bond/muni/income/CLO funds the aggregator's BOND_ETFS set misses (seen in the
# BBS dark tape). These are ALWAYS excluded — no size floor lets them back in.
_BOND_DARK_ETFS = {
    "JAAA", "JMUB", "GMUB", "SUSB", "IGLB", "IGSB", "IBDY", "PMBS", "MBB", "VCLT",
    "SCMB", "JBND", "JMST", "CGCB", "BKLN", "SRLN", "BAI", "JCPB", "PAUG", "TLTW",
    "CORB", "XBB", "SKHY", "VCRB", "SMBS", "SPMB", "SPHY", "CWB", "EVLN", "SEIE",
    "DIAL", "VTEI",
}


def _is_bond_etf(ticker: str) -> bool:
    """Bond/muni/income fund — ALWAYS excluded (owner: 'don't care about bond
    ETFs'), no matter how heavy. Network-free: static straggler set + the
    aggregator's Bond ETFs category + its BOND_ETFS set."""
    tk = (ticker or "").upper()
    if not tk:
        return False
    if tk in _BOND_DARK_ETFS:
        return True
    try:
        from api.darkpool_aggregator import classify_ticker, BOND_ETFS
        return tk in BOND_ETFS or classify_ticker(tk, 0, 1) == "Bond ETFs"
    except Exception:
        return False


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
    max_pct = _max_pct()
    equity_only = _equity_only()
    etf_min = _etf_min_notional()
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
            if pct is None or pct < floor_pct or pct > max_pct:
                continue  # below the floor, or an absurd-%ADV data artifact
            if _is_etf(tk):
                if equity_only:
                    continue  # hard-exclude every ETF
                if _is_bond_etf(tk):
                    continue  # bond/muni/income fund — always out
                if (notional or 0) < etf_min:
                    continue  # non-bond ETF: only HEAVY index/broad blocks qualify
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


def clear_dedup() -> int:
    """Drop all per-(date,ticker) dedup rows so a manual re-scan re-alerts. Test aid
    only — a live poll would simply re-ping already-seen blocks once."""
    _ensure_table()
    c = _conn()
    try:
        cur = c.execute("DELETE FROM darkpool_bigblock_alerts")
        c.commit()
        return cur.rowcount or 0
    finally:
        c.close()
