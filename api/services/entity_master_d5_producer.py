"""api/services/entity_master_d5_producer.py — D5 CHECKPOINT 5.

`source='d5'` for two event types: `delisted` + `new_entity`, through
`entity_master.api.apply_event`, compared on the same run against the interim
job's (`entity_master.reconciliation`) own proposals.

⛔ WHY THIS IS A SEPARATE MODULE, NOT AN `entity_master/**` FILE. The D5 gate's
own inert-strand ruling for CP5: "no [inert-strand risk], provided the
producer is a new module that adds no import to `entity_master/**`" (which
flow-worker RUNS). This file imports `entity_master.api`, `entity_master.
reconciliation` and `massive` — one-way, producer → entity_master. Nothing
under `entity_master/**` imports this file back, so flow-worker's existing
reachability of that package gains no new edge into this module's own network
call (`massive.list_reference_tickers`).

⭐ CONFIRMED, not merely detected. `entity_master.reconciliation`'s own header
says plainly: "It is explicitly NOT a substitute for D5" — its proposals are
INFERRED from a live/open-alias set difference alone, carrying no vendor-
declared date for a delisting (it stamps `lifecycle_since` as the run's own
"today", an approximation). This producer reads Massive's OWN per-ticker
`delisted_utc` / `list_date` fields directly — the same "a vendor's own
reference feed IS the confirmation" grounding D5 CP3 already established for
splits — so a delisting proposed here carries the date the vendor actually
declared, not the date reconciliation happened to run.

WHAT IT NEVER DOES (same rename-exclusion boundary as reconciliation.py):
  - Never correlates a delisting with a new listing. Distinguishing a rename
    from an unrelated delist+list pair needs a corporate-action signal
    neither this nor reconciliation.py reads yet — that is CP6's job.
  - Never wired into APScheduler. Same discipline as reconciliation.py:
    written, tested, dry-run-verified against real data; activation is a
    separate decision this checkpoint does not make.

`dry_run=True` (default) computes proposals and the comparison only, calling
`apply_event` zero times. `dry_run=False` applies each proposal via the
normal write path — same collision guard, same idempotency, same audit trail
every other `apply_event` caller gets, tagged `source='d5'`.
"""
from __future__ import annotations

import datetime
import logging

_log = logging.getLogger(__name__)


def _entity_type_for(ref: dict) -> str:
    """Same mapping reconciliation.py's own `_entity_type_for` uses, so a
    ticker gets the same entity_type whichever producer creates it first."""
    from api import ticker_types
    raw_type = ref.get("type") or ""
    norm = ticker_types.normalize_type(raw_type, "stocks")
    return {"STOCK": "equity", "ETF": "etf", "INDEX": "index"}.get(norm, "equity")


def _canonical(raw_ticker: str) -> str:
    return raw_ticker.replace(".", "-") if "." in raw_ticker else raw_ticker


def run_d5_producer(dry_run: bool = True, db_path: str | None = None,
                     max_pages: int = 60, compare_to_reconciliation: bool = True) -> dict:
    """One D5 pass. See module docstring for the confirmed-vs-inferred
    distinction and the dry_run contract."""
    from api.services import massive
    from api.services.entity_master import api as em_api

    proposed_creates: list[dict] = []
    for r in massive.list_reference_tickers(active=True, market="stocks", max_pages=max_pages):
        ticker = (r.get("ticker") or "").strip().upper()
        list_date = r.get("list_date")
        if not ticker or ticker.startswith("I:") or not list_date:
            continue
        symbol = _canonical(ticker)
        resolved = em_api.resolve(symbol, db_path=db_path)
        if resolved.status != "not_found":
            continue  # already known, or ambiguous — not this producer's call to make
        proposed_creates.append({
            "symbol": symbol,
            "entity_type": _entity_type_for(r),
            "list_date": str(list_date)[:10],
            "cik": r.get("cik"),
            "composite_figi": r.get("composite_figi"),
        })

    proposed_delists: list[dict] = []
    for r in massive.list_reference_tickers(active=False, market="stocks", max_pages=max_pages):
        ticker = (r.get("ticker") or "").strip().upper()
        delisted_utc = r.get("delisted_utc")
        if not ticker or ticker.startswith("I:") or not delisted_utc:
            continue
        symbol = _canonical(ticker)
        resolved = em_api.resolve(symbol, db_path=db_path)
        if resolved.status != "resolved" or resolved.entity is None:
            continue
        if resolved.entity.lifecycle_state != "active":
            continue
        proposed_delists.append({
            "symbol": symbol,
            "entity_id": resolved.entity.entity_id,
            "lifecycle_since": str(delisted_utc)[:10],
        })

    comparison = None
    if compare_to_reconciliation:
        from api.services.entity_master import reconciliation as _recon
        recon = _recon.run_reconciliation(dry_run=True, db_path=db_path, max_pages=max_pages)
        d5_creates = {c["symbol"] for c in proposed_creates}
        recon_creates = {c["symbol"] for c in recon["proposed_creates"]}
        d5_delists = {d["symbol"] for d in proposed_delists}
        recon_delists = {d["symbol"] for d in recon["proposed_delists"]}
        comparison = {
            "creates_agree": sorted(d5_creates & recon_creates),
            "creates_d5_only": sorted(d5_creates - recon_creates),
            "creates_reconciliation_only": sorted(recon_creates - d5_creates),
            "delists_agree": sorted(d5_delists & recon_delists),
            "delists_d5_only": sorted(d5_delists - recon_delists),
            "delists_reconciliation_only": sorted(recon_delists - d5_delists),
        }
        _log.info("[d5-cp5] comparison vs reconciliation: %s",
                  {k: len(v) for k, v in comparison.items()})

    result = {
        "dry_run": dry_run,
        "proposed_creates": proposed_creates,
        "proposed_delists": proposed_delists,
        "comparison": comparison,
        "rejected": [],
    }
    if dry_run:
        return result

    created = 0
    for c in proposed_creates:
        payload = {"entity_type": c["entity_type"], "initial_alias": c["symbol"],
                   "initial_alias_valid_from": c["list_date"]}
        if c.get("cik"):
            payload["cik"] = c["cik"]
        if c.get("composite_figi"):
            payload["composite_figi"] = c["composite_figi"]
        r = em_api.apply_event(
            "new_entity", payload,
            dedup_key=f"d5:new_entity:{c['symbol']}:{c['list_date']}",
            source="d5", db_path=db_path,
        )
        if r.accepted:
            created += 1
        else:
            result["rejected"].append({"symbol": c["symbol"], "reason": r.reason})
    result["created"] = created

    delisted = 0
    for d in proposed_delists:
        r = em_api.apply_event(
            "delisted", {"entity_id": d["entity_id"], "lifecycle_since": d["lifecycle_since"]},
            dedup_key=f"d5:delisted:{d['entity_id']}:{d['lifecycle_since']}",
            source="d5", db_path=db_path,
        )
        if r.accepted:
            delisted += 1
        else:
            result["rejected"].append({"symbol": d["symbol"], "reason": r.reason})
    result["delisted"] = delisted

    return result
