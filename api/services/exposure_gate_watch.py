"""Intraday watch on the exposure gate's price levels.

The morning wire publishes ``gate_levels`` inside ``wire_data.exposure`` —
the restraint release (FTD close x 1.0125) and the S2 danger level (the FTD
day's low). Both are static all session. This watcher compares live QQQ
against them and posts ONE broadcast in-app alert per trigger per day, so
members learn about a cross while it is happening instead of on the next
morning's wire.

The engine acts on CLOSES, so the copy always says "a close here ..." —
this alert is an early flag, never the verdict.

Reads ONLY caches (wire_data + the live-prices per-ticker cache): a watcher
must never add provider load. Cold cache -> skip the tick; the next one is
two minutes away. Dedup is cache-keyed per (date, kind) with a 24h TTL and
is process-local: a redeploy can re-fire at most one duplicate in-app alert
per trigger, accepted for v1.
"""
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from api.services.cache import cache as app_cache

_ET = ZoneInfo("America/New_York")


def enabled() -> bool:
    return os.environ.get("EXPOSURE_GATE_WATCH_ENABLED", "0") == "1"


def _in_rth(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return (9 * 60 + 30) <= minutes <= (16 * 60 + 5)


def _fire_once(day: str, kind: str, title: str, message: str, data: dict) -> bool:
    key = f"exposure_gate_fired_{day}_{kind}"
    if app_cache.get(key):
        return False
    app_cache.set(key, True, ttl=86400)
    from api.services.alerts import add_alert
    add_alert("exposure_gate", title, message, data=data)
    return True


def check_once(now: datetime | None = None) -> dict:
    now = now or datetime.now(_ET)
    if not _in_rth(now):
        return {"ok": True, "skipped": "outside RTH"}

    exposure = (app_cache.get("wire_data") or {}).get("exposure") or {}
    levels = exposure.get("gate_levels") or {}
    if not levels:
        return {"ok": True, "skipped": "no gate levels"}

    sym = levels.get("symbol", "QQQ")
    from api.routers import live_prices as lp
    hit = lp.cache.get(lp._px_key(sym)) or {}
    price = hit.get("price")
    if price is None:
        return {"ok": True, "skipped": "price cache cold"}

    day = now.strftime("%Y-%m-%d")
    fired = []
    release = levels.get("release")
    if release is not None and price >= release:
        if _fire_once(
            day, "release",
            f"Exposure cap release in play: {sym} ${price:,.2f}",
            f"{sym} is trading above the restraint release level "
            f"(${release:,.2f}). A CLOSE above it lifts the exposure cap "
            f"on the next morning's wire.",
            {"symbol": sym, "price": price, "level": release, "kind": "release"},
        ):
            fired.append("release")

    s2 = levels.get("s2")
    if s2 is not None and price <= s2:
        if _fire_once(
            day, "s2",
            f"S2 danger level: {sym} ${price:,.2f}",
            f"{sym} is trading below the FTD low (${s2:,.2f}). A CLOSE "
            f"below it demotes the market phase and drops the exposure cap "
            f"to 25% — no new risk until it reclaims.",
            {"symbol": sym, "price": price, "level": s2, "kind": "s2"},
        ):
            fired.append("s2")

    return {"ok": True, "price": price, "fired": fired}
