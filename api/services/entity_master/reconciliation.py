"""Entity Master reconciliation job — entity-master-spec.md §10.2.

Scheduled (when wired — see NOT WIRED note below), narrow-scope bridge that
keeps the *lifecycle-state* and *new-listing* halves of PRD UC-6 working
before D5 (Reference & Corporate-Actions Data) exists. It is explicitly NOT
a substitute for D5.

WHAT IT DOES (and nothing else):
  - Re-fetches `massive.list_reference_tickers(active=True)` fresh, at run
    time (stocks + indices, class shares canonicalized to hyphen form —
    reuses the exact normalization `scripts/entity_master_seed.py` uses,
    via `_massive_reference_rows_canonical`, so reconciliation and the seed
    script can never disagree about what "the same instrument" means).
  - Diffs that live set against the store's own currently-open aliases.
  - A live symbol with no currently-open alias anywhere → proposes
    `new_entity` (exactly the seed script's own event shape).
  - An `active`-lifecycle entity whose open alias is no longer in the live
    set → proposes `delisted` (lifecycle flip ONLY — per spec §4.3's
    payload shape, `{entity_id, lifecycle_since}`, which carries no alias
    field at all; the alias stays OPEN, so `resolve(alias, as_of=None)`
    keeps finding the entity with `lifecycle_state="delisted"` — the
    "resolved but delisted" outcome PRD §8 names, not a `NotFound`).

WHAT IT NEVER DOES — THE RENAME-EXCLUSION BOUNDARY (binding, per spec
§10.2 and this implementation's explicit authorization):
  - It NEVER correlates a delisting with a new listing. The two proposal
    lists below are computed completely independently — there is no code
    path anywhere in this module that reads `proposed_delists` while
    computing `proposed_creates` or vice versa. A rename looks IDENTICAL
    to an unrelated delisting + an unrelated new listing from this feed
    alone, and distinguishing them requires a corporate-action signal this
    job does not have — that is explicitly D5's job.
  - It NEVER reads `delisted_registry` / `delisted_tickers_bulk.json` —
    not imported, not called, anywhere in this file. This is a
    Checkpoint-7 requirement (protect against Finding A's 123 stale
    records): this job's *only* external input is the live Massive call
    above, so it is structurally immune to that file's staleness — not by
    an added guard, but because the file is never in its input set at all.
    `test_reconciliation_never_imports_delisted_registry` pins this.
  - It NEVER reconstructs historical symbols, infers a corporate action,
    merges two entities, or repairs stale data of any kind. It has exactly
    two event types it can ever emit: `new_entity` and `delisted`.

NOT WIRED into `api/main.py`'s APScheduler by this implementation pass —
deliberate. Every other new background job in this build's history ships
dark/flag-gated before activation (`CLAUDE.md`'s own pattern: Compass Brain
Bridge, Awareness Engine). Registering a cron job in the live application
entrypoint is an activation decision, not a "build the reconciliation
logic and prove it on dry-run" decision — this module is complete, tested,
and dry-run-verified against real data, callable directly
(`run_reconciliation(dry_run=True)`), and ready to be wired in a follow-up
step the owner approves separately.
"""
from __future__ import annotations

import datetime


def _massive_reference_rows_canonical(max_pages: int = 60) -> dict:
    """Identical canonicalization to `scripts/entity_master_seed.py::
    _massive_reference_rows()` (Checkpoint 6's fix) — kept as a SEPARATE
    copy rather than a shared import because the seed script is a
    standalone script (not part of the `entity_master` package) and this
    job must not depend on `scripts/` at runtime. Any future drift between
    the two would show up as reconciliation proposing to "recreate" an
    entity the seed script already created under a different canonical
    key — `test_reconciliation_canonicalization_matches_seed_script`
    guards against exactly that."""
    from api.services import massive

    rows: dict = {}

    def _add(raw_ticker: str, r: dict, market_tag: str | None = None) -> None:
        canonical = raw_ticker.replace(".", "-") if "." in raw_ticker else raw_ticker
        if canonical in rows:
            return
        r = dict(r)
        if canonical != raw_ticker:
            r["_massive_native_ticker"] = raw_ticker
        if market_tag:
            r["_market"] = market_tag
        rows[canonical] = r

    for r in massive.list_reference_tickers(active=True, market="stocks", max_pages=max_pages):
        t = (r.get("ticker") or "").strip().upper()
        if not t or t.startswith("I:"):
            continue
        _add(t, r)
    for r in massive.list_reference_tickers(active=True, market="indices", max_pages=max_pages):
        t = (r.get("ticker") or "").strip().upper()
        if t.startswith("I:"):
            t = t[2:]
        if not t:
            continue
        _add(t, r, market_tag="indices")
    return rows


def _entity_type_for(ref: dict | None) -> str:
    """Identical mapping to the seed script's `_entity_type_for` (Checkpoint 1's
    corrected entity_type comment)."""
    from api import ticker_types

    if ref is None:
        return "equity"
    raw_type = ref.get("type") or ""
    market = "indices" if ref.get("_market") == "indices" else "stocks"
    norm = ticker_types.normalize_type(raw_type, market)
    return {"STOCK": "equity", "ETF": "etf", "INDEX": "index"}.get(norm, "equity")


def run_reconciliation(dry_run: bool = True, db_path: str | None = None, max_pages: int = 60) -> dict:
    """One reconciliation pass. `dry_run=True` (the default — callers must
    opt IN to real writes) computes and returns every proposal without
    calling `apply_event` at all. `dry_run=False` applies each proposal via
    the normal write path (same collision guard, same idempotency, same
    audit trail as every other caller of `apply_event`)."""
    from api.services.entity_master import api as em_api
    from api.services.entity_master import store

    live_rows = _massive_reference_rows_canonical(max_pages)
    live_symbols = set(live_rows.keys())

    # {alias: [(entity_id, lifecycle_state), ...]} — a LIST per alias so a
    # genuine collision stays visible (store.open_aliases_with_lifecycle's
    # own contract; see its docstring). Checkpoint 7 fix: an earlier version
    # of this function unpacked this as a single (entity_id, lifecycle_state)
    # tuple per alias, which silently discarded one entity on a genuine
    # collision — caught by `test_ambiguous_symbol_reported_not_silently_
    # skipped_or_recreated` before this ever ran against real data.
    open_rows = store.open_aliases_with_lifecycle(db_path)

    proposed_creates: list[dict] = []
    proposed_delists: list[dict] = []
    ambiguous: list[dict] = []
    skipped_existing: list[str] = []

    # New listings — computed WITHOUT any reference to proposed_delists.
    for sym in sorted(live_symbols):
        if sym in open_rows:
            if len(open_rows[sym]) > 1:
                ambiguous.append({
                    "symbol": sym,
                    "candidates": [eid for eid, _ in open_rows[sym]],
                })
            else:
                skipped_existing.append(sym)
            continue
        r = em_api.resolve(sym, db_path=db_path)
        if r.status == "ambiguous":
            ambiguous.append({"symbol": sym, "candidates": list(r.candidates)})
            continue
        if r.status == "resolved":
            # A closed-but-known alias (e.g. seed-time delisted, or a prior
            # reconciliation-delisted entity whose alias later got closed by
            # something else) resolving at a PAST as_of only — as_of=None
            # already returned not_found here, so this branch is defensive,
            # not expected to fire; recorded rather than silently skipped.
            skipped_existing.append(sym)
            continue
        ref = live_rows.get(sym)
        proposed_creates.append({
            "symbol": sym,
            "entity_type": _entity_type_for(ref),
            "valid_from": (ref.get("list_date") if ref else None) or "1990-01-01",
            "composite_figi": ref.get("composite_figi") if ref else None,
            "cik": ref.get("cik") if ref else None,
        })

    # Delistings — computed WITHOUT any reference to proposed_creates. A
    # symbol appearing in BOTH lists this run (rare: reconciliation's own
    # snapshot moved between the two queries) is still two independent,
    # correct proposals — never merged into a "rename." A genuinely
    # ambiguous open alias (len > 1) is reported above, never guessed at
    # here — an entity this job cannot uniquely identify is never proposed
    # for a lifecycle change.
    today = datetime.datetime.now(datetime.UTC).date().isoformat()
    for alias, candidates in sorted(open_rows.items()):
        if len(candidates) != 1:
            continue
        entity_id, lifecycle_state = candidates[0]
        if lifecycle_state == "active" and alias not in live_symbols:
            proposed_delists.append({
                "symbol": alias, "entity_id": entity_id, "lifecycle_since": today,
            })

    result = {
        "dry_run": dry_run,
        "live_symbols_count": len(live_symbols),
        "open_aliases_count": len(open_rows),
        "proposed_creates": proposed_creates,
        "proposed_delists": proposed_delists,
        "ambiguous": ambiguous,
        "skipped_existing_count": len(skipped_existing),
        "rejected": [],
    }
    if dry_run:
        return result

    created = 0
    for c in proposed_creates:
        payload = {
            "entity_type": c["entity_type"], "initial_alias": c["symbol"],
            "initial_alias_valid_from": c["valid_from"],
        }
        if c.get("cik"):
            payload["cik"] = c["cik"]
        if c.get("composite_figi"):
            payload["composite_figi"] = c["composite_figi"]
        r = em_api.apply_event(
            "new_entity", payload, dedup_key=f"reconcile:new_entity:{c['symbol']}:{today}",
            source="reconciliation", db_path=db_path,
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
            dedup_key=f"reconcile:delisted:{d['entity_id']}:{today}",
            source="reconciliation", db_path=db_path,
        )
        if r.accepted:
            delisted += 1
        else:
            result["rejected"].append({"symbol": d["symbol"], "reason": r.reason})
    result["delisted"] = delisted

    return result
