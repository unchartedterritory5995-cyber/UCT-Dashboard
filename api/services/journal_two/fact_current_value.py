"""Wave F — current-value resolver.

For a `live_and_snapshot` fact, resolves "what is this comparable value
NOW" at READ time -- never persisted, never confused with the immutable
original observation (checkpoint decision 21/37). Batched per note
(checkpoint decision 39/119/140): one call per note-open, not one per fact.

Provider consistency (checkpoint decision 22): a fact type's current-value
resolver reads the SAME source class the capture path used for that type --
PRICE capture and PRICE current-value both ride the shared live-price cache;
there is no cross-provider fallback here that could manufacture a false
"change."

Never raises. A resolution failure returns `None` for that fact's current
value -- the ORIGINAL observation must remain fully visible and useful even
when live re-resolution fails (checkpoint decision 47/81/98, directive's
single most emphasized UX rule in this wave)."""
from __future__ import annotations

from typing import Any


def _resolve_price(tickers: list[str]) -> dict[str, float | None]:
    if not tickers:
        return {}
    try:
        from api.routers.live_prices import get_live_prices
        result = get_live_prices(tickers=",".join(sorted(set(tickers))))
        if not isinstance(result, dict):
            return {t: None for t in tickers}
        out: dict[str, float | None] = {}
        for t in tickers:
            row = result.get(t)
            out[t] = row.get("price") if isinstance(row, dict) else None
        return out
    except Exception:
        return {t: None for t in tickers}


def resolve_current_values(facts: list[dict[str, Any]]) -> dict[str, float | str | None]:
    """`facts` is the already-resolved list from `note_facts.list_note_facts`
    (each a dict with `id`, `factType`, `temporalMode`, `ticker`). Returns
    `{factId: current_value_or_None}` for every `live_and_snapshot` fact;
    facts of any other temporal mode are simply absent from the result (the
    caller renders no current-value row for them -- there is nothing to
    compare, by design, not by failure)."""
    price_facts = [f for f in facts if f.get("factType") == "price" and f.get("temporalMode") == "live_and_snapshot"]
    price_tickers = [f["ticker"] for f in price_facts if f.get("ticker")]
    price_current = _resolve_price(price_tickers)

    out: dict[str, float | str | None] = {}
    for f in price_facts:
        out[f["id"]] = price_current.get(f["ticker"])
    return out
