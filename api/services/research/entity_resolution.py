"""S3 (Entity Master) resolution shared by the research page's tabs.

The vertical slice's "route symbol -> canonical entity -> capability
request -> D1 -> provider" flow (owner authorization, 2026-09-03) starts
here: one small, shared call so estimates.py and financials.py can't drift
into two different resolution behaviors for the same route param. This is
NOT a new normalization layer or a D2 substitute -- it does exactly one
thing, resolve a route symbol against Entity Master, and hands back either
a D1-ready vendor symbol (when a mapping exists) or the honest fallback.
"""
from __future__ import annotations

from api.services.entity_master import api as entity_master_api


def resolve_entity(sym: str, *, vendor: str | None = None) -> tuple[dict, str]:
    """Resolve `sym` against Entity Master.

    Returns `(entity_info, effective_symbol)`:
      - `entity_info` is `{"status": "resolved"|"not_found"|"ambiguous",
        "entityId": str | None}` -- always present, never fabricated. A
        resolution miss is reported honestly, not hidden.
      - `effective_symbol` is `sym` unchanged UNLESS `vendor` is given AND
        Entity Master has a real vendor-symbol mapping for the resolved
        entity, in which case it is that vendor's own symbol (e.g. a
        renamed/reused ticker's real FMP symbol). No mapping is a valid,
        common outcome (Entity Master's coverage is new and partial) --
        never an error.

    Never raises (mirrors `entity_master.api.resolve`'s own "never raises"
    contract; the extra try/except is defense-in-depth, not evidence this
    path is expected to fail). A resolution miss never blocks the caller's
    own data fetch -- Entity Master not yet knowing a ticker must not make
    an otherwise-working page stop working for it.
    """
    sym = (sym or "").upper().strip()

    try:
        resolution = entity_master_api.resolve(sym)
    except Exception:
        return {"status": "not_found", "entityId": None}, sym

    if resolution.status != "resolved" or resolution.entity is None:
        return {"status": resolution.status, "entityId": None}, sym

    entity_id = resolution.entity.entity_id
    effective_symbol = sym
    if vendor:
        try:
            vendor_sym = entity_master_api.vendor_symbol(entity_id, vendor)
            if vendor_sym:
                effective_symbol = vendor_sym
        except Exception:
            pass  # no vendor-symbol mapping yet is a valid outcome, not a failure
    return {"status": "resolved", "entityId": entity_id}, effective_symbol
