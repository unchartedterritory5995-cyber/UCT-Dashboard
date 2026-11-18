"""MD-1 kind `levels.gamma` (owner: terminal-data, data wave 3) — one stock's gamma walls.

The call wall, the put wall and the zero gamma level: the options half of the LVL terminal panel
(app/src/pages/terminal/panels/levelsModel.js `gexRead`), over the read behind `GET /api/signature/gex-walls`
(api/routers/signature.py `_serve_gxw` → api/services/signature/gex_walls.py → api/gex_service.py).

⛔ ONLY WHAT THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). `_serve_gxw` builds synchronously when it holds nothing
for the symbol: a whole option chain read (a first request and a paged Massive walk of up to 48 pages under a 25
second budget). That is past a turn's 20 provider requests and a
member's patience, so this adapter never calls `_serve_gxw` or `_gxw_build`. It reads the two places the route itself
serves from:
  * the route's TTL cache entry for the symbol (`rules.GXW_TTL_S`, 10 minutes)        → `held: "fresh"`;
  * else its last-good slot (`_GXW_STALE`, `rules.GXW_MAX_AGE_S`, 30 minutes)          → `held: "last_good"`, `stale`;
  * else nothing is held                                                                → `unavailable`, with the reason.
The route's negative cache (a remembered failure) is never read: a failed build is "nothing held" here.
provider_calls is always 0.
⚠️ COUPLING, stated: the route's cache key (`_ck("gxw", sym)`) and its last-good slot (`_GXW_STALE`), both private to
api/routers/signature.py. A rail fills them through the route's own `_gxw_build` and reads them back, so a rename fails
by name.

THE CHAIN (read api/gex_service.py's own comment): the chain behind the arithmetic is Massive's, and only Massive's.
Schwab's chain, the `shadow` comparison mode and the `GEX_CHAIN_SOURCE` switch that chose between them were retired on
2026-11-17 with Schwab itself; `gex_service.chain_source()` always answers `massive`. MEMBER DISPLAY IS NOT THE SAME AS
SENDING DATA TO A MODEL PROVIDER, and no record clears the chain for that, so this kind is model-isolated.
`data.chain_source` still names the chain (`massive`): the field is part of the payload's shape.

TIME (MD-1 §3): the payload's `asOf` is epoch seconds of the BUILD (when UCT read the chain and worked the levels out):
a computation time, so it is never `as_of`. `as_of` is null with a note, and the build time rides as `data.computed_at`.
The stock price in the payload is the one the chain carried at that moment, never a current quote. freshness `periodic`.

WHAT THE HELD READ DOES NOT SAY: how the zero gamma level was found. `gex_service` names its method
(`zeroGammaMethod`), and a stand-in level is not a true flip, but `shape_walls` does not carry that through, so neither
the route nor this kind can tell the two apart. A note says so on every read that returns a zero gamma level.

MODEL-ISOLATED (ADR-005): the three levels are computed by UCT (its own wall search, band and zero-gamma rules) from a
vendor option chain. UCT-derived, and derived from options data the owner has not cleared for the model. Shown to the
member only; the capability is local-only.
"""
from __future__ import annotations

import math
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

KIND = "levels.gamma"
SOURCE = "uct-gex-walls"
#: the member route's own symbol rule (api/routers/signature.py `_SYM_RE`), railed equal in the tests
SYMBOL_RE = re.compile(r"^[A-Za-z][A-Za-z.\-]{0,9}$")
#: the level kinds `shape_walls` emits, by the route's own names (the LVL panel's model reads them)
LEVEL_KINDS = ("callWall", "putWall", "zeroGamma")
REGIMES = ("bullish", "bearish", "choppy", "unbound")
HELD = ("fresh", "last_good")
#: what `gex_service.chain_source()` answers → the chain a served payload was read from. One row since 2026-11-17.
CHAIN_OF_MODE = {"massive": "massive"}

NOTE_WHAT = ("the call wall, the put wall and the zero gamma level UCT works out from the options on {sym} expiring "
             "within a week, each given only when it is within {band}% of the stock price; UCT's own arithmetic on an "
             "option chain, not a forecast")
NOTE_TIME = ("worked out by UCT at {at} from an option chain it read then (UCT's own time; the vendor's quote time is "
             "not carried), so as_of is not given: not a live feed")
NOTE_NO_TIME = "the held levels carry no build time, so their age is unknown and as_of is not given"
NOTE_LAST_GOOD = ("these are the last good levels, older than the {minutes} minutes they are normally kept, so they may "
                  "be behind the option market")
NOTE_SPOT = ("the stock price given is the one the option chain carried when the levels were worked out, never a "
             "current quote")
NOTE_ZERO = ("the zero gamma level is an estimate of where dealer hedging flips; the held read does not say how it was "
             "found, and for some stocks it is a stand-in level rather than a true flip")
NOTE_CHAIN = "the option chain behind these levels is Massive's, the one chain UCT reads for them"
NOTE_NONE = "no gamma level is within {band}% of the stock price for {sym}; that is a healthy answer, not a failed read"
NOTE_NOT_HELD = ("no gamma levels are held for {sym} in the server's cache (they are kept {minutes} minutes after a "
                 "chart or the Levels panel reads them, and a last good copy for {max_minutes}), and this read never "
                 "starts an option chain read; that is not the same as no levels")
NOTE_NO_PRICE = ("the held option read for {sym} carries no stock price, so no level could be placed; that is not the "
                 "same as no levels")
NOTE_FAILED = "gamma levels could not be read for {sym}"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    sym = params.get("symbol")
    if not isinstance(sym, str) or not SYMBOL_RE.match(sym.strip()):
        return "`symbol` must be one ticker (letters, dots and dashes, starting with a letter)"
    return None


def now_s() -> float:
    return time.time()


def _pos(v: Any) -> Optional[float]:
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v <= 0:
        return None
    return float(v)


def held_walls(sym: str) -> tuple[Optional[dict], str]:
    """(the walls payload the route already holds for this symbol, how it is held), WITHOUT building one."""
    from api.routers import signature as route
    hit = route.cache.get(route._ck("gxw", sym))
    if isinstance(hit, dict):
        return hit, "fresh"
    value, age = route._GXW_STALE.peek(sym)
    if isinstance(value, dict) and age is not None and age <= route._GXW_STALE.max_age:
        return value, "last_good"
    return None, "not_held"


def chain_source() -> Optional[str]:
    """The chain this server's GEX arithmetic reads (`massive`), or None when it cannot be told."""
    try:
        from api import gex_service
        return CHAIN_OF_MODE.get(gex_service.chain_source())
    except Exception:  # noqa: BLE001 — the source is a label; never a reason to fail the read
        return None


def read_gamma_levels(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = params["symbol"].strip().upper()
    try:
        from api.services.signature import rules
        payload, how = held_walls(sym)               # the route's cache or its last-good slot: never a build
        ttl_minutes = int(rules.GXW_TTL_S // 60)
        max_minutes = int(rules.GXW_MAX_AGE_S // 60)
        band = round(float(rules.GXW_MAX_DIST_PCT) * 100)
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never "no levels"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(sym=sym))
    if payload is None:
        return env.unavailable(KIND, params, SOURCE,
                               NOTE_NOT_HELD.format(sym=sym, minutes=ttl_minutes, max_minutes=max_minutes))
    if payload.get("error") or not isinstance(payload.get("levels"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(sym=sym))
    spot = _pos(payload.get("spot"))
    if spot is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NO_PRICE.format(sym=sym))

    levels = [{"kind": lv["kind"], "price": _pos(lv.get("price"))} for lv in payload["levels"]
              if isinstance(lv, dict) and lv.get("kind") in LEVEL_KINDS and _pos(lv.get("price")) is not None]
    built = _pos(payload.get("asOf"))
    computed_at = env.utc_iso(datetime.fromtimestamp(built, tz=timezone.utc)) if built else None
    notes = [NOTE_WHAT.format(sym=sym, band=band), NOTE_TIME.format(at=computed_at) if computed_at else NOTE_NO_TIME,
             NOTE_SPOT]
    # unknown is never claimed fresh: a payload with no build time is stale
    stale = how == "last_good" or built is None
    if how == "last_good":
        notes.append(NOTE_LAST_GOOD.format(minutes=ttl_minutes))
    if not levels:
        notes.append(NOTE_NONE.format(sym=sym, band=band))
    if any(lv["kind"] == "zeroGamma" for lv in levels):
        notes.append(NOTE_ZERO)
    chain = chain_source()
    if chain:
        notes.append(NOTE_CHAIN)
    regime = payload.get("regime") if payload.get("regime") in REGIMES else None
    # `sym` / `levels` / `spot` / `regime` / `asOf` keep the route's own names: the LVL panel's pure helper
    # (levelsModel.js gexRead) reads them
    data = {"sym": sym, "levels": levels, "spot": spot, "regime": regime, "version": payload.get("version"),
            "asOf": built, "computed_at": computed_at, "held": how, "chain_source": chain, "band_pct": band,
            "kept_minutes": ttl_minutes, "last_good_minutes": max_minutes}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=None, source=SOURCE, data=data,
                             stale=stale, notes=notes, provider_calls=0)
