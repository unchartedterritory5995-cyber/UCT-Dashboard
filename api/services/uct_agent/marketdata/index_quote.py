"""MD-1 kind `index.quote` (W1-C C-03, builder-c): the level of a market index (S&P 500, Nasdaq, Dow, Russell, VIX).

Sources, in licence order (asset_quotes.py): Massive `/v3/snapshot/indices` (`polygon_extras.get_indices_snapshot`),
licensing row ("massive", "indices") — `U` today: the endpoint answers 403 for this key/plan (a live-confirmed
entitlement gap, api/routers/massive_adapter_status.py) and no register row licenses it. Yahoo index quotes are `X`
and are never a candidate. Until a row is A/LA every read is the honest decline; the fetch below is never called.
"""
from __future__ import annotations

from api.services.uct_agent.marketdata import asset_classes, asset_quotes

KIND = asset_classes.INDEX_KIND
_MASSIVE_TICKERS = {"spx": "I:SPX", "ndx": "I:NDX", "ixic": "I:COMP", "dji": "I:DJI", "rut": "I:RUT", "vix": "I:VIX"}

validate = asset_quotes.validate_for(KIND)


def _massive_indices(asset: str) -> dict:
    """Massive index snapshot → the adapter's row. Only reachable once ("massive", "indices") is A/LA."""
    from api.services import polygon_extras
    tick = _MASSIVE_TICKERS[asset]
    out = polygon_extras.get_indices_snapshot([tick])
    rows = out.get("results") if isinstance(out, dict) else None
    row = next((r for r in rows or [] if r.get("ticker") == tick), None)
    if not row:
        return {}
    return {"value": row.get("value"), "change": row.get("change"), "change_pct": row.get("change_pct"),
            "previous_close": row.get("previous_close"), "as_of": row.get("as_of"), "freshness": "delayed",
            "delay_s": 900, "provider_calls": 1}


SOURCES = [("massive", "indices", _massive_indices)]


def read_index_quote(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    return asset_quotes.read_asset(KIND, params, SOURCES)
