"""Whole-market TODAY pack — today's developing daily bar for every symbol in one
small artifact, so a chart paints today's candle at FIRST PAINT even for a symbol
this browser has never opened.

🔴 THE GAP THIS FILLS. `barspack` — the instant D/W/M seed — deliberately carries
only CLOSED sessions: `_should_build_now` says *"Never builds mid-session
(partial-bar guard)"*. That is right for a ~90MB multi-day artifact; a partial bar
baked into it would persist and lie. The consequence is that a symbol you have never
opened has NO local copy of today's bar, so today's candle cannot appear until
`/api/bars` answers. Measured 2026-09-11 against production: server compute
`bars;desc="mem";dur=0.8` — 0.8ms — inside a 300-500ms round trip. The delay a member
sees while typing tickers is ENTIRELY network, and no amount of server tuning touches
it. A warm symbol feels instant only because IndexedDB still holds today's bar from
the last visit.

⭐ SO PREFETCH THE ONE BAR THAT IS MISSING, FOR EVERYTHING, ONCE. The client pulls
this on load and refreshes it in the background; by the time a ticker is typed,
today's bar is already local. `/api/bars` still arrives behind it and remains
authoritative — this only decides what is on screen for those few hundred
milliseconds.

⚠️ COSTS NO PROVIDER CALL. `get_full_market_snapshot_hl_cached` is a single
all-tickers snapshot the pod ALREADY fetches every ~30s for the live scanners
(Volume Surge, NH/NL). This is a projection of that dict — not a new call, not a new
endpoint, not new vendor budget.

⛔ AND IT IS GATED ON THE SAME SESSION CLOCK AS THE SERVED BAR. Before the open the
provider's `day` object still holds the PRIOR session (the 2026-09-04 and 2026-09-11
duplicate-candle incidents), so seeding from it would paint the very duplicate those
fixes removed — in the client, where no server guard can see it. Outside an open
session this returns an EMPTY pack and the chart's reserved whitespace slot holds,
exactly as it does today.
"""
from __future__ import annotations

import logging

from api.services import massive

_log = logging.getLogger(__name__)

# Snapshot reuse window. The scanners already refresh the underlying all-tickers
# snapshot every ~30s; asking for it with a 15s tolerance means this endpoint rides
# their fetch essentially always and never forces one of its own on a quiet pod.
_SNAP_TTL = 15.0


def _canonical(provider_sym: str) -> str:
    """Provider form → the app's canonical ticker.

    The inverse of `massive.to_polygon_symbol`: class shares are DOT upstream
    (BRK.B) and HYPHEN everywhere in this app (BRK-B) — storage keys, the universe
    list, FMP and yfinance. The snapshot returns provider form, and the CLIENT will
    look these up by the app's form, so the conversion belongs here rather than in
    every caller.
    """
    return provider_sym.upper().replace(".", "-")


def build_today_pack() -> dict:
    """``{"d": "YYYY-MM-DD", "n": <count>, "bars": {SYM: [o, h, l, c, v]}}``.

    An empty pack (``d: ""``, ``bars: {}``) whenever today's regular session has not
    opened — never a stale one.

    The close is the LIVE price (`last_price`), not the `day.c` aggregate, matching
    what `get_todays_daily_ohlcv` serves for the same bar: `day.c` lags the tape by
    seconds-to-minutes on thinner names, and seeding the lagged value would paint a
    candle that visibly corrects a moment later — trading one flicker for another.
    """
    if not massive._regular_session_has_opened_today():
        return {"d": "", "n": 0, "bars": {}}

    from datetime import datetime
    from zoneinfo import ZoneInfo
    today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()

    try:
        snap = massive.get_full_market_snapshot_hl_cached(ttl=_SNAP_TTL) or {}
    except Exception:                                              # noqa: BLE001
        _log.exception("[todaypack] snapshot read failed")
        return {"d": "", "n": 0, "bars": {}}

    out: dict[str, list] = {}
    for psym, row in snap.items():
        if not psym or not isinstance(row, dict):
            continue
        try:
            o = float(row.get("day_open") or 0.0)
            h = float(row.get("day_high") or 0.0)
            l = float(row.get("day_low") or 0.0)
            c = float(row.get("last_price") or 0.0)
            v = float(row.get("today_vol") or 0.0)
        except (TypeError, ValueError):
            continue
        # ⛔ ZERO IS ABSENT, NOT A PRICE. The provider returns zeros for a name that
        # has not printed in the regular session yet; `get_full_market_snapshot_hl`'s
        # own docstring says every consumer owes that distinction. A zero-open bar
        # would paint a candle at the axis floor.
        if o <= 0.0 or h <= 0.0 or l <= 0.0 or c <= 0.0:
            continue
        # The live close can sit outside the running day range by a tick at the edge
        # of a print; widen rather than emit an OHLC that contradicts itself.
        if c > h:
            h = c
        if c < l:
            l = c
        out[_canonical(psym)] = [
            round(o, 4), round(h, 4), round(l, 4), round(c, 4), int(v),
        ]

    return {"d": today, "n": len(out), "bars": out}
