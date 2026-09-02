#!/usr/bin/env python3
"""Entity Master one-time backfill/seed script — entity-master-spec.md §5.1.

Populates entity_master.db from three existing, unmodified sources:
  1. cap_universe.symbols() / cap_universe.etf_symbols() — the membership list.
  2. massive.list_reference_tickers() — name/type/FIGI/list-date reference data.
  3. delisted_registry.all_entries() — the delisted population.

Idempotent (spec §5.1 step 7): every symbol already resolved to an open
alias is skipped, never duplicated. Never runs automatically (spec §10.1) —
an admin runs this by hand, or triggers the admin `/reconcile` route
(Checkpoint 6+, not built yet). Offline/background only; never on a
request path.

Usage:
    python scripts/entity_master_seed.py --dry-run          # read-only, writes nothing
    python scripts/entity_master_seed.py --db-path PATH     # real run, explicit target
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    for _env_path in (ROOT / ".env", Path(r"C:\Users\Patrick\uct-dashboard\.env")):
        if _env_path.exists():
            load_dotenv(_env_path)
            break
except ImportError:
    pass


def _massive_reference_rows(max_pages: int) -> dict:
    """Steps 2: read stocks + indices reference feed, keyed by ticker.

    Mirrors ticker_search_index._collect_rows()'s own 'I:'-prefix handling
    for indices (spec §5.1 step 2 cites the same two calls that function
    already makes) — stripped so an index's key matches how every other
    consumer in this codebase already keys it (bare 'SPX', not 'I:SPX')."""
    from api.services import massive

    rows: dict = {}
    for r in massive.list_reference_tickers(active=True, market="stocks", max_pages=max_pages):
        t = (r.get("ticker") or "").strip().upper()
        if not t or t.startswith("I:"):
            continue
        rows[t] = r
    for r in massive.list_reference_tickers(active=True, market="indices", max_pages=max_pages):
        t = (r.get("ticker") or "").strip().upper()
        if t.startswith("I:"):
            t = t[2:]
        if not t:
            continue
        r = dict(r)
        r["_market"] = "indices"
        rows.setdefault(t, r)
    return rows


def _entity_type_for(sym: str, ref: dict | None) -> str:
    """Massive `type` -> ticker_types.normalize_type() -> this schema's
    'equity'|'etf'|'index' (Checkpoint 1's corrected mapping). A symbol
    with no Massive reference row (cap_universe-only) or an unrecognized
    raw type defaults to 'equity' — justified by cap_universe.py's own
    documented scope ("the cap universe is an EQUITY screen", its own
    docstring on `etf_symbols()`), not an arbitrary choice."""
    from api import ticker_types

    if ref is None:
        return "equity"
    raw_type = (ref.get("type") or "")
    market = "indices" if ref.get("_market") == "indices" else "stocks"
    norm = ticker_types.normalize_type(raw_type, market)
    return {"STOCK": "equity", "ETF": "etf", "INDEX": "index"}.get(norm, "equity")


def run_seed(db_path: str | None = None, dry_run: bool = False, max_pages: int = 60) -> dict:
    from api.services import cap_universe, delisted_registry
    from api.services.entity_master import api as em_api
    from api.services.entity_master import schema
    from api.services.entity_master import store

    # Every category the run's final report must always show, even at zero
    # (a key silently missing when its count is zero is exactly the kind of
    # incomplete receipt this program's own CoverageLine idiom exists to
    # avoid — see CLAUDE.md's "measured on the real universe" section).
    stats: Counter = Counter({
        "entities_created": 0, "delisted_entities_created": 0,
        "skipped_already_seeded": 0, "rejected_records": 0,
        "ambiguities_encountered": 0, "normalization_anomalies": 0,
        "vendor_symbols_populated": 0, "figi_populated": 0,
    })
    anomalies: list = []

    # Steps 1-3: read every source. Read-only regardless of --dry-run.
    universe = cap_universe.symbols()
    etf_universe = cap_universe.etf_symbols()
    stats["cap_universe_symbols"] = len(universe)
    stats["cap_universe_etf_symbols"] = len(etf_universe)

    ref_rows = _massive_reference_rows(max_pages)
    stats["massive_reference_rows"] = len(ref_rows)

    delisted = delisted_registry.all_entries()
    stats["delisted_registry_entries"] = len(delisted)

    active_symbols = sorted(set(universe) | set(ref_rows.keys()))
    stats["distinct_active_symbols"] = len(active_symbols)

    if dry_run:
        figi_count = sum(1 for r in ref_rows.values() if r.get("composite_figi"))
        hyphenated = [s for s in active_symbols if "-" in s]
        type_breakdown = Counter(_entity_type_for(s, ref_rows.get(s)) for s in active_symbols)
        stats["would_populate_figi"] = figi_count
        stats["would_populate_vendor_symbol_massive"] = len(hyphenated)
        stats.update({f"would_create_type_{k}": v for k, v in type_breakdown.items()})
        stats["would_create_delisted_entities"] = len(delisted)
        return {"stats": dict(stats), "anomalies": anomalies, "dry_run": True}

    with store.bulk_mode(db_path):
        # Real run — opens/creates entity_master.db.
        schema.init_db(db_path=db_path)

        # Step 4a + 5 + 6: active entities.
        for sym in active_symbols:
            ref = ref_rows.get(sym)
            entity_type = _entity_type_for(sym, ref)
            valid_from = (ref.get("list_date") if ref else None) or "1990-01-01"

            existing = em_api.resolve(sym, db_path=db_path)
            if existing.status == "resolved":
                stats["skipped_already_seeded"] += 1
                eid = existing.entity.entity_id
            elif existing.status == "ambiguous":
                anomalies.append({"kind": "ambiguous_on_seed", "alias": sym, "candidates": list(existing.candidates)})
                stats["ambiguities_encountered"] += 1
                continue
            else:
                payload = {"entity_type": entity_type, "initial_alias": sym, "initial_alias_valid_from": valid_from}
                if ref and ref.get("cik"):
                    payload["cik"] = ref["cik"]
                if ref and ref.get("composite_figi"):
                    payload["composite_figi"] = ref["composite_figi"]
                result = em_api.apply_event(
                    "new_entity", payload, dedup_key=f"seed:new_entity:{sym}",
                    source="admin_manual", db_path=db_path,
                )
                if not result.accepted:
                    anomalies.append({"kind": "rejected", "alias": sym, "reason": result.reason})
                    stats["rejected_records"] += 1
                    continue
                eid = result.entity_id
                stats["entities_created"] += 1

            if "-" in sym:
                em_api.set_vendor_symbol(
                    eid, "massive", sym.replace("-", "."), valid_from,
                    "derived:dot_notation", db_path=db_path,
                )
                stats["vendor_symbols_populated"] += 1

            if ref and ref.get("composite_figi"):
                em_api.set_figi(
                    eid, ref["composite_figi"], ref.get("share_class_figi"),
                    "massive_reference", db_path=db_path,
                )
                stats["figi_populated"] += 1

        # Step 4b: delisted entities. Composed as new_entity (open alias) then
        # alias_retired + delisted (close it) — apply_event has no
        # "create-already-closed" event type, so this is 3 primitive calls per
        # delisted record rather than a 4th event type invented for this script.
        for rec in delisted:
            ticker = rec["ticker"]  # the registry's own disambiguated key (e.g. BSC-OLD)
            existing = em_api.resolve(ticker, as_of=rec.get("last_date") or "2026-01-01", db_path=db_path)
            current = em_api.resolve(ticker, db_path=db_path)
            if current.status == "resolved" or existing.status == "resolved":
                stats["skipped_already_seeded"] += 1
                continue
            if current.status == "ambiguous" or existing.status == "ambiguous":
                anomalies.append({"kind": "ambiguous_on_seed", "alias": ticker})
                stats["ambiguities_encountered"] += 1
                continue

            valid_from = rec.get("first_date") or "1990-01-01"
            payload = {"entity_type": "equity", "initial_alias": ticker, "initial_alias_valid_from": valid_from}
            result = em_api.apply_event(
                "new_entity", payload, dedup_key=f"seed:new_entity:{ticker}",
                source="admin_manual", db_path=db_path,
            )
            if not result.accepted:
                anomalies.append({"kind": "rejected", "alias": ticker, "reason": result.reason})
                stats["rejected_records"] += 1
                continue
            eid = result.entity_id
            stats["delisted_entities_created"] += 1

            last_date = rec.get("last_date") or rec.get("delisted_date")
            if last_date:
                close = em_api.apply_event(
                    "alias_retired", {"entity_id": eid, "alias": ticker, "valid_to": last_date},
                    dedup_key=f"seed:close_alias:{ticker}", source="admin_manual", db_path=db_path,
                )
                if not close.accepted:
                    anomalies.append({"kind": "close_alias_failed", "alias": ticker, "reason": close.reason})
                    stats["normalization_anomalies"] += 1
                delist_evt = em_api.apply_event(
                    "delisted", {"entity_id": eid, "lifecycle_since": last_date},
                    dedup_key=f"seed:delisted:{ticker}", source="admin_manual", db_path=db_path,
                )
                if not delist_evt.accepted:
                    anomalies.append({"kind": "delist_event_failed", "alias": ticker, "reason": delist_evt.reason})
                    stats["normalization_anomalies"] += 1
            else:
                anomalies.append({"kind": "delisted_record_missing_date", "alias": ticker})
                stats["normalization_anomalies"] += 1

    return {"stats": dict(stats), "anomalies": anomalies, "dry_run": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db-path", default=None, help="Override entity_master.db path (default: DATA_DIR env)")
    parser.add_argument("--dry-run", action="store_true", help="Read-only: report what WOULD be written, write nothing")
    parser.add_argument("--max-pages", type=int, default=60, help="Cap on Massive reference-ticker pagination")
    args = parser.parse_args()

    result = run_seed(db_path=args.db_path, dry_run=args.dry_run, max_pages=args.max_pages)
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
