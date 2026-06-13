"""Nightly catalyst coverage self-audit.

For three sessions running, the user has been the miss-detector ("you only
listed TER, but RKLB/NBIS/ALAB/CRWV all moved"). This automates that check:
after the close, take the day's actual biggest movers (the full-market
snapshot the gap-scan already pulls) and ask, for each, what the engine did
with it. Every mover lands in one bucket:

  ranked        — shown on the tile (rank set). The win case.
  scored_hidden — scored but below the rank cut / grade-C hidden.
  excluded      — entered the pool but a gate dropped it (reason stored).
  missed        — never a candidate at all. The real coverage hole.

The report persists (catalyst_coverage_audit table) and surfaces at
GET /api/admin/catalyst-coverage so misses become a logged, diagnosable
event instead of waiting for someone to notice. A 'missed' big mover is the
signal that a SOURCE is blind — exactly the gap each source addition closes.
"""
import contextlib
import json
import logging
import os
import sqlite3
import threading
import time

logger = logging.getLogger(__name__)

# Reuse the catalysts DB — one store, audited alongside what it's auditing.
from api.services.catalyst.store import _DB_PATH  # noqa: E402

_WRITE_LOCK = threading.Lock()
_INIT_DONE = False
_INIT_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS catalyst_coverage_audit (
  market_date   TEXT PRIMARY KEY,
  audited_at    INTEGER NOT NULL,
  movers_total  INTEGER NOT NULL,
  ranked        INTEGER NOT NULL,
  scored_hidden INTEGER NOT NULL,
  excluded      INTEGER NOT NULL,
  missed        INTEGER NOT NULL,
  report_json   TEXT NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _INIT_LOCK:
        if _INIT_DONE:
            return
        with contextlib.closing(_connect()) as c:
            c.executescript(_SCHEMA)
            c.commit()
        _INIT_DONE = True


def _biggest_movers(min_abs_pct: float, min_price: float,
                    min_dollar_vol: float, limit: int) -> list[dict]:
    """The day's real movers from the full-market snapshot — the same liquid
    universe the gap-scan ranks, but kept as a ground-truth mover list rather
    than capped for enrichment. Returns [{ticker, gap_pct, dollar_vol}]."""
    from api.services.massive import _get_client
    snap = _get_client().get_full_market_snapshot() or {}
    movers: list[dict] = []
    for ticker, d in snap.items():
        sym = (ticker or "").upper()
        if not sym or len(sym) > 5 or not sym.isalpha():
            continue
        last = d.get("last_price") or 0.0
        prev = d.get("prev_close") or 0.0
        if last < min_price or prev <= 0:
            continue
        gap = (last - prev) / prev * 100.0
        if abs(gap) < min_abs_pct:
            continue
        vol = d.get("prev_vol") or d.get("today_vol") or 0
        dollar_vol = last * vol
        if vol > 0 and dollar_vol < min_dollar_vol:
            continue
        movers.append({"ticker": sym, "gap_pct": round(gap, 2),
                       "dollar_vol": dollar_vol})
    movers.sort(key=lambda m: abs(m["gap_pct"]), reverse=True)
    return movers[:limit]


def run_audit(market_date: str) -> dict:
    """Classify the day's biggest movers against what the engine surfaced.
    Persists + returns the report. Never raises (logs + returns error dict)."""
    try:
        _ensure_init()
        min_abs_pct = float(os.environ.get("CATALYST_AUDIT_MIN_PCT", "7"))
        min_price = float(os.environ.get("CATALYST_AUDIT_MIN_PRICE", "5"))
        min_dollar_vol = float(os.environ.get("CATALYST_AUDIT_MIN_DOLLAR_VOL",
                                              "30000000"))
        limit = int(os.environ.get("CATALYST_AUDIT_MOVERS", "40"))

        movers = _biggest_movers(min_abs_pct, min_price, min_dollar_vol, limit)

        from api.services.catalyst import store
        from api.services.catalyst.engine import get_exclusion_reason
        # All rows the engine touched today, ranked or not.
        all_rows = {r["ticker"].upper(): r
                    for r in store.get_for_date(market_date, ranked_only=False)}

        buckets = {"ranked": [], "scored_hidden": [], "excluded": [], "missed": []}
        for m in movers:
            sym = m["ticker"]
            row = all_rows.get(sym)
            if row and row.get("rank") is not None:
                bucket = "ranked"
            elif row:
                bucket = "scored_hidden"
            else:
                reason = None
                try:
                    reason = get_exclusion_reason(market_date, sym)
                except Exception:
                    pass
                bucket = "excluded" if reason else "missed"
                if reason:
                    m = {**m, "reason": reason}
            buckets[bucket].append(m)

        report = {
            "market_date": market_date,
            "movers_total": len(movers),
            "counts": {k: len(v) for k, v in buckets.items()},
            "buckets": buckets,
            "thresholds": {"min_abs_pct": min_abs_pct, "min_price": min_price,
                           "min_dollar_vol": min_dollar_vol, "limit": limit},
        }
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute(
                """INSERT INTO catalyst_coverage_audit
                   (market_date, audited_at, movers_total, ranked,
                    scored_hidden, excluded, missed, report_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(market_date) DO UPDATE SET
                     audited_at=excluded.audited_at,
                     movers_total=excluded.movers_total, ranked=excluded.ranked,
                     scored_hidden=excluded.scored_hidden,
                     excluded=excluded.excluded, missed=excluded.missed,
                     report_json=excluded.report_json""",
                (market_date, int(time.time()), len(movers),
                 len(buckets["ranked"]), len(buckets["scored_hidden"]),
                 len(buckets["excluded"]), len(buckets["missed"]),
                 json.dumps(report)),
            )
            c.commit()
        missed = buckets["missed"]
        logger.info("[catalyst-audit] %s: %d movers | ranked=%d hidden=%d "
                    "excluded=%d MISSED=%d%s", market_date, len(movers),
                    len(buckets["ranked"]), len(buckets["scored_hidden"]),
                    len(buckets["excluded"]), len(missed),
                    (" -> " + ", ".join(f"{m['ticker']}({m['gap_pct']:+.0f}%)"
                                        for m in missed[:10])) if missed else "")
        return report
    except Exception as e:
        logger.exception("[catalyst-audit] run failed")
        return {"market_date": market_date, "error": str(e)}


def get_audit(market_date: str) -> dict | None:
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT report_json FROM catalyst_coverage_audit WHERE market_date=?",
            (market_date,),
        ).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["report_json"])
    except (TypeError, ValueError):
        return None
