"""S8 Step 2 (PRD-S8/SPEC-S8) — the minimal, new backend surface "live D1 -> S8
wiring" actually requires. No existing endpoint exposes D1's typed
`ProviderResult` shape to a frontend (confirmed during the S8 readiness
review: SPEC-S8 §6/§14's own casing-boundary note); this is that boundary,
kept as narrow as the requirement — a thin JSON passthrough over the already-
built, already-tested `fmp_client.get_quote`/`massive.get_quote`, no new
business logic, gated by `get_current_user` (signed-in members only).

⚰️ It was NO-AUTH until 2026-09-25, citing "`/api/live-prices` and
`/api/fundamentals/{ticker}`'s existing no-auth convention for ordinary
quote-shaped data". That convention ended with OI-17 (`caebdab16`,
2026-09-23), which put `/api/live-prices`, `/api/snapshot`, `/api/movers` and
`/api/gex/data` behind `Depends(get_current_user)` because an anonymous
market-data endpoint is a licensing exposure. This route serves the same
Massive/FMP quote data, so it takes the same gate; its only consumer, the
`/provenance-demo` route, moved inside `<AuthGuard/>` in the same commit so
the pair is gated together, never one without the other. Anonymous requests
answer 401 (`tests/test_provenance_quote.py` pins it).

Returns each vendor's `ProviderResult.to_dict()` on success. A vendor's
typed failure (not-found / entitlement-denied / rate-limited / transient /
not-configured) is caught INDEPENDENTLY per vendor and reported as a typed
JSON error shape rather than a 500 or a silently-omitted key -- exactly the
"empty because X" honesty PRD-S8 §9.3 requires one layer up, at the surface
that actually has the typed evidence to report it precisely.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from api.middleware.auth_middleware import get_current_user

router = APIRouter()


def _error_shape(exc) -> dict:
    """One typed D1 exception -> one honest JSON shape. Never a bare 500 --
    the caller (an S8 component) needs the SPECIFIC reason, not just
    "something failed".

    ⚰️ This function OWNED the isinstance ladder until 2026-09-12. It now
    delegates to `provider_degraded.error_shape`, which the G1 tranche-1
    call-site degradation also uses. ⛔ Two copies of a type ladder drift the
    day a new provider error class is added, and the drift is silent: the older
    copy just starts reporting `unknown` for a class the newer one names.
    """
    from api.services import provider_degraded
    return provider_degraded.error_shape(exc)


def _fmp_result(symbol: str, entity_type: Optional[str]) -> dict:
    from api.services import fmp_client
    try:
        return fmp_client.get_quote(symbol, entity_type=entity_type).to_dict()
    except Exception as exc:  # noqa: BLE001 -- every D1 typed error, caught per-vendor on purpose
        return _error_shape(exc)


def _massive_result(symbol: str, entity_id: Optional[str]) -> dict:
    from api.services import massive
    try:
        client = massive._MassiveRestClient()
        return client.get_quote(symbol, entity_id=entity_id).to_dict()
    except Exception as exc:  # noqa: BLE001 -- see _fmp_result
        return _error_shape(exc)


@router.get("/api/provenance/quote")
def get_provenance_quote(
    symbol: str = Query(..., description="Ticker symbol, e.g. AAPL"),
    entity_id: Optional[str] = Query(None, description="Entity Master id, optional"),
    entity_type: Optional[str] = Query(None, description="'index' applies FMP's caret-prefix convention"),
    vendor: Optional[str] = Query(None, description="'fmp' or 'massive' -- omit for both"),
    user: dict = Depends(get_current_user),
):
    """The visible trust-layer demo surface: one symbol, every configured
    vendor's own typed quote (value + provenance + freshness + licensing),
    or an honest per-vendor error shape when a vendor can't answer.

    Response: `{symbol, vendors: {fmp?: <ProviderResult|error>, massive?:
    <ProviderResult|error>}}`. A vendor key is present only when it was
    requested via `vendor=` or `vendor` was omitted (both queried)."""
    sym = symbol.strip().upper()
    want_fmp = vendor is None or vendor == "fmp"
    want_massive = vendor is None or vendor == "massive"

    vendors = {}
    if want_fmp:
        vendors["fmp"] = _fmp_result(sym, entity_type)
    if want_massive:
        vendors["massive"] = _massive_result(sym, entity_id)

    return {"symbol": sym, "vendors": vendors}
