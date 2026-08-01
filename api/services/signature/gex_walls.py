"""UCT Signature: GEX Walls (gxw-v1).

The underlying gex_service call is a LIVE Schwab /chains request (~20s
timeout, zero caching today). It must only ever be reached through the
router's ServeStale slot — never called per chart render directly.
"""
from __future__ import annotations

import time

from api.services.signature import rules


def shape_walls(gex: dict) -> dict:
    if not gex or gex.get("error"):
        return {"levels": [], "error": (gex or {}).get("error", "no data"),
                "version": rules.VERSIONS["gxw"]}
    spot = float(gex.get("spot") or 0)
    levels = []
    candidates = [
        ("callWall", (gex.get("callWall") or {}).get("strike")),
        ("putWall", (gex.get("putWall") or {}).get("strike")),
        ("zeroGamma", gex.get("zeroGamma")),
    ]
    for kind, price in candidates:
        if price is None or spot <= 0:
            continue
        price = float(price)
        if abs(price - spot) / spot <= rules.GXW_MAX_DIST_PCT:
            levels.append({"kind": kind, "price": price})
    return {"levels": levels, "spot": spot, "regime": gex.get("regime", ""),
            "version": rules.VERSIONS["gxw"]}


async def fetch_gex_walls(sym: str) -> dict:
    from api.gex_service import get_gex_data  # local import for testability

    shaped = shape_walls(await get_gex_data(sym, rules.GXW_DTE))
    shaped["sym"] = sym.upper()
    shaped["asOf"] = time.time()
    return shaped
