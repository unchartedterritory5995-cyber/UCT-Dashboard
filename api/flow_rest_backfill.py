"""
flow_rest_backfill.py — same-day recovery of a disconnect-window's trades via
Massive REST /v3/trades, scoped to a set of contracts (the active Q-pool).

WHY: a crash/reconnect loses the OPRA WS for ~90s. The tape spool cannot capture
a window with no WS feeding it; the T+1 flat file heals it but only next day.
This pulls the gap window for the watched contracts SAME-DAY. It is a PARTIAL
recovery by construction: REST options-trades are per-contract, so you can only
recover contracts you can enumerate (the Q-pool). Newly-surfacing contracts in
the gap still wait for the T+1 flat file. That limit is inherent to REST and is
documented in docs/superpowers/specs/2026-07-17-liveflow-100pct-completeness-plan.md.

SAFETY (why this can't corrupt the live tape):
  • DARK by default: FLOW_REST_BACKFILL_ENABLED=0. Every entry point no-ops
    unless explicitly enabled.
  • Reuses the FLAT-FILE worker's ISOLATED write path (batch_process ->
    event_to_bbs_row -> FlowDB.insert_csv). It NEVER touches the live consumer's
    in-memory state (_CUMVOL_STATE, the OI/meta caches) — so it cannot race the
    single-threaded live writer or corrupt its counters.
  • IDEMPOTENT: FlowDB.insert_csv skips rows whose UNIQUE dedup_key already
    exists, so any overlap with live rows is silently ignored. Re-runs are free.
  • Off the consumer loop: always runs on a background thread; never blocks recv.

Massive REST is Polygon-compatible (same base + auth + next_url pagination as
api/massive_oi_snapshots). /v3/trades/{optionsTicker} returns the same schema the
flat files carry (sip_timestamp ns, price, size, conditions[], exchange).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

ENABLED = os.environ.get("FLOW_REST_BACKFILL_ENABLED", "0").lower() in ("1", "true", "yes")
MASSIVE_API_KEY = os.environ.get("MASSIVE_API_KEY", "").strip()
MASSIVE_REST_BASE = os.environ.get("MASSIVE_REST_BASE", "https://api.massive.com").rstrip("/")

HTTP_TIMEOUT = float(os.environ.get("FLOW_BACKFILL_HTTP_TIMEOUT", "15"))
MAX_CONCURRENCY = int(os.environ.get("FLOW_BACKFILL_CONCURRENCY", "6"))
PAGE_LIMIT = int(os.environ.get("FLOW_BACKFILL_PAGE_LIMIT", "50000"))
MAX_PAGES = int(os.environ.get("FLOW_BACKFILL_MAX_PAGES", "20"))
# Guardrails: never backfill a trivial blip or an enormous window / contract set.
MIN_GAP_SEC = float(os.environ.get("FLOW_BACKFILL_MIN_GAP_SEC", "30"))
MAX_WINDOW_SEC = float(os.environ.get("FLOW_BACKFILL_MAX_WINDOW_SEC", "1800"))
MAX_CONTRACTS = int(os.environ.get("FLOW_BACKFILL_MAX_CONTRACTS", "1200"))

_state = {
    "last_run_at": None, "last_status": None, "last_window": None,
    "last_contracts": 0, "last_trades_fetched": 0, "last_events": 0,
    "last_inserted": 0, "last_skipped_dupes": 0, "runs": 0,
}
_run_lock = threading.Lock()


def get_status() -> dict:
    s = dict(_state)
    s["enabled"] = ENABLED
    s["has_key"] = bool(MASSIVE_API_KEY)
    return s


def _headers() -> dict:
    return {"Authorization": f"Bearer {MASSIVE_API_KEY}"} if MASSIVE_API_KEY else {}


async def _fetch_one_contract(client, ticker: str, start_ns: int, end_ns: int) -> list:
    """All trades for one options ticker in [start_ns, end_ns], ascending.
    Returns a list of dicts each carrying at least sip_timestamp/price/size/
    conditions/exchange plus the ticker. Empty on any error (caller tolerates)."""
    out = []
    url = (f"{MASSIVE_REST_BASE}/v3/trades/{ticker}"
           f"?timestamp.gte={start_ns}&timestamp.lte={end_ns}"
           f"&order=asc&limit={PAGE_LIMIT}")
    page = 0
    while url and page < MAX_PAGES:
        try:
            r = await client.get(url, headers=_headers(), timeout=HTTP_TIMEOUT)
        except Exception as e:  # noqa: BLE001
            logger.warning("[rest-backfill] %s page %d request failed: %s", ticker, page, e)
            break
        if r.status_code != 200:
            logger.warning("[rest-backfill] %s page %d status=%d", ticker, page, r.status_code)
            break
        try:
            data = r.json()
        except Exception:
            break
        for t in (data.get("results") or []):
            t = dict(t)
            t.setdefault("ticker", ticker)
            out.append(t)
        nxt = data.get("next_url")
        if nxt:
            url = nxt if nxt.startswith("http") else f"{MASSIVE_REST_BASE}{nxt}"
            page += 1
        else:
            url = None
    return out


async def _fetch_all(contracts: list, start_ns: int, end_ns: int) -> list:
    import asyncio
    try:
        import httpx
    except ImportError:
        logger.warning("[rest-backfill] httpx unavailable")
        return []
    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _one(client, tk):
        async with sem:
            return await _fetch_one_contract(client, tk, start_ns, end_ns)

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[_one(client, tk) for tk in contracts],
                                       return_exceptions=True)
    trades = []
    for res in results:
        if isinstance(res, list):
            trades.extend(res)
    return trades


def probe(ticker: str = "O:SPY260918C00600000",
          window_sec: int = 300) -> dict:
    """Read-only endpoint verification: fetch a small recent window for one
    contract and report shape. Safe to run anytime — no writes. Use this to
    confirm /v3/trades works on Massive before enabling the backfill."""
    import asyncio
    if not MASSIVE_API_KEY:
        return {"ok": False, "error": "MASSIVE_API_KEY not set in this process"}
    end_ns = time.time_ns()
    start_ns = end_ns - int(window_sec * 1e9)
    try:
        trades = asyncio.run(_fetch_all([ticker], start_ns, end_ns))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:300]}
    sample = trades[0] if trades else None
    return {
        "ok": True, "ticker": ticker, "window_sec": window_sec,
        "trades_returned": len(trades),
        "sample_keys": sorted(sample.keys()) if sample else [],
        "sample": {k: sample.get(k) for k in ("sip_timestamp", "price", "size",
                                              "conditions", "exchange")}
        if sample else None,
    }


def backfill_window(start_ns: int, end_ns: int, contracts: Iterable[str]) -> dict:
    """Fetch [start_ns,end_ns] trades for `contracts`, aggregate through the
    SAME pipeline the flat-file worker uses, and dedup-insert into flow.db.
    Synchronous; call on a background thread. Returns a summary dict."""
    import asyncio
    contracts = [c for c in dict.fromkeys(contracts) if c]  # dedup, preserve order
    res = {"window": [start_ns, end_ns], "contracts": len(contracts),
           "trades_fetched": 0, "events": 0, "inserted": 0, "skipped_dupes": 0,
           "status": None}

    if not ENABLED:
        res["status"] = "disabled"
        return res
    if not MASSIVE_API_KEY:
        res["status"] = "no_key"
        return res
    span = (end_ns - start_ns) / 1e9
    if span < MIN_GAP_SEC:
        res["status"] = f"gap_below_min ({span:.0f}s < {MIN_GAP_SEC:.0f}s)"
        return res
    if span > MAX_WINDOW_SEC:
        res["status"] = f"window_too_large ({span:.0f}s > {MAX_WINDOW_SEC:.0f}s)"
        return res
    if len(contracts) > MAX_CONTRACTS:
        contracts = contracts[:MAX_CONTRACTS]
        res["contracts_capped"] = MAX_CONTRACTS

    if not _run_lock.acquire(blocking=False):
        res["status"] = "already_running"
        return res
    try:
        t0 = time.time()
        trades = asyncio.run(_fetch_all(contracts, start_ns, end_ns))
        res["trades_fetched"] = len(trades)
        if not trades:
            res["status"] = "no_trades_in_window"
            _record(res)
            return res

        import pandas as pd
        from api.massive_processor import (batch_process, event_to_bbs_row,
                                           is_index_source)
        from api.flow_db import FlowDB, COLUMNS

        rows = []
        for t in trades:
            cond = t.get("conditions")
            if isinstance(cond, list):
                cond = cond[0] if cond else -1
            rows.append({
                "ticker": t.get("ticker"),
                "price": t.get("price"),
                "size": t.get("size"),
                "exchange": t.get("exchange", 0),
                "conditions": cond if cond is not None else -1,
                "sip_timestamp": t.get("sip_timestamp"),
            })
        df = pd.DataFrame(rows).dropna(subset=["sip_timestamp", "price", "size", "ticker"])
        if df.empty:
            res["status"] = "no_usable_rows"
            _record(res)
            return res
        df = df.sort_values("sip_timestamp", kind="stable").reset_index(drop=True)

        # MIN_PREMIUM / MIN_VOLUME mirror the live consumer's filters so
        # backfilled rows match what the live tape would have kept.
        min_prem = float(os.environ.get("MASSIVE_MIN_PREMIUM", "10000"))
        min_vol = int(os.environ.get("MASSIVE_MIN_VOLUME", "50"))
        events, _stats = batch_process(df, min_premium=min_prem, min_volume=min_vol)
        res["events"] = len(events)
        if not events:
            res["status"] = "no_events_after_filter"
            _record(res)
            return res

        db = FlowDB()
        header = ",".join(COLUMNS) + "\n"
        # OI + meta enrichment via the ISOLATED flat-file helpers (read-only
        # against snapshots/cache; never the live in-memory counters).
        from api.massive_flatfiles_worker import (_load_oi_for_events,
                                                  _load_ticker_metadata)
        from datetime import datetime, timezone
        snap_iso = datetime.fromtimestamp(start_ns / 1e9, tz=timezone.utc).date().isoformat()
        all_syms = list({e.root for e in events})
        meta = _load_ticker_metadata(db.db_path, all_syms)
        try:
            from api.massive_ws_worker import _load_er_flags
            er_map = _load_er_flags(all_syms)
        except Exception:
            er_map = {}

        inserted = skipped = 0
        for source in ("stocks", "indexes"):
            evs = [e for e in events
                   if (is_index_source(e.root) == (source == "indexes"))]
            if not evs:
                continue
            oi_map = _load_oi_for_events(db.db_path, evs, snap_iso)
            buf = [header]
            for i, ev in enumerate(evs):
                m = meta.get(ev.root, {})
                row = event_to_bbs_row(ev, source=source,
                                       mktcap=m.get("mktcap", 0),
                                       sector=m.get("sector", ""),
                                       oi=oi_map.get(i, 0),
                                       er_flag=er_map.get(ev.root, "F"))
                buf.append(",".join(str(row.get(c, "")) for c in COLUMNS) + "\n")
            r = db.insert_csv("".join(buf), source=source)
            inserted += r.get("inserted", 0)
            skipped += r.get("skipped", 0)

        res["inserted"] = inserted
        res["skipped_dupes"] = skipped
        res["status"] = "ok"
        res["duration_sec"] = round(time.time() - t0, 1)
        logger.info("[rest-backfill] window %ss / %d contracts -> %d trades, "
                    "%d events, %d inserted, %d dupes in %.1fs",
                    int(span), len(contracts), len(trades), len(events),
                    inserted, skipped, res["duration_sec"])
        _record(res)
        return res
    except Exception as e:  # noqa: BLE001
        logger.exception("[rest-backfill] window failed: %s", e)
        res["status"] = f"error: {str(e)[:200]}"
        _record(res)
        return res
    finally:
        _run_lock.release()


def _record(res: dict) -> None:
    _state.update({
        "last_run_at": time.time(), "last_status": res.get("status"),
        "last_window": res.get("window"), "last_contracts": res.get("contracts"),
        "last_trades_fetched": res.get("trades_fetched"),
        "last_events": res.get("events"), "last_inserted": res.get("inserted"),
        "last_skipped_dupes": res.get("skipped_dupes"),
        "runs": _state["runs"] + 1,
    })


def backfill_gap_async(start_ns: int, end_ns: int,
                       contracts: Iterable[str]) -> bool:
    """Fire-and-forget entry (the reconnect hook will call this once wired).
    No-op unless enabled. Never blocks the caller."""
    if not ENABLED:
        return False
    threading.Thread(target=backfill_window, args=(start_ns, end_ns, list(contracts)),
                     name="flow-rest-backfill", daemon=True).start()
    return True
