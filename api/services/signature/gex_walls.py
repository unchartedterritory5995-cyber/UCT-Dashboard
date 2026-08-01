"""UCT Signature: GEX Walls (gxw-v1).

The underlying gex_service call is a LIVE Schwab /chains request (~20s
timeout, zero caching today). It must only ever be reached through the
router's ServeStale slot — never called per chart render directly.
"""
from __future__ import annotations

import math
import time

from api.services.signature import rules


def shape_walls(gex: dict) -> dict:
    if not gex or gex.get("error"):
        return {"levels": [], "error": (gex or {}).get("error", "no data"),
                "version": rules.VERSIONS["gxw"]}
    spot = float(gex.get("spot") or 0)
    # gex_service's own spot gate is `if spot <= 0`, and `nan <= 0` is False --
    # so a NaN/inf underlyingPrice reaches us. Emitting it would be worse than
    # emitting no walls: FastAPI serializes with allow_nan=False and a browser
    # r.json() throws on a bare NaN, killing the whole overlay. Fold it into the
    # existing spot<=0 empty-levels path instead.
    if not math.isfinite(spot):
        spot = 0.0
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
        # Explicit, though the band compare below already rejects non-finite
        # (every NaN comparison is False, and inf distance exceeds the band):
        # a level's price is a wire value, so its finiteness is stated here
        # rather than left resting on a comparison side effect.
        if not math.isfinite(price):
            continue
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
