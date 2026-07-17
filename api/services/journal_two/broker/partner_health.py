"""Partner-info health probe.

getPartnerInfo returns our plan's capability flags plus per-brokerage
operational flags (enabled / maintenance_mode / is_degraded). Cached probe
feeds two surfaces: the broker status payload (so the UI can warn "Webull
data is degraded right now" instead of members blaming UCT) and the fleet
monitor digest (owner visibility when a member-connected broker degrades).
"""
from __future__ import annotations

import logging
import time
from typing import Any

from api.services.journal_two.broker import snaptrade_client as snap

logger = logging.getLogger("broker_partner_health")

_TTL_SECONDS = 1800.0
_cache: dict[str, Any] = {"at": 0.0, "data": None}


def _reset_cache_for_tests() -> None:
    _cache["at"] = 0.0
    _cache["data"] = None


def _slug(broker: dict) -> str:
    return str(broker.get("slug") or broker.get("name") or "").upper()


def _normalize(raw: dict) -> dict[str, Any]:
    brokers: dict[str, dict] = {}
    for b in raw.get("allowed_brokerages") or []:
        if not isinstance(b, dict):
            continue
        slug = _slug(b)
        if not slug:
            continue
        brokers[slug] = {
            "name": b.get("display_name") or b.get("name") or slug,
            "enabled": bool(b.get("enabled", True)),
            "maintenanceMode": bool(b.get("maintenance_mode", False)),
            "isDegraded": bool(b.get("is_degraded", False)),
        }
    caps = {k: bool(v) for k, v in raw.items()
            if k.startswith("can_") and isinstance(v, (bool, int))}
    return {"capabilities": caps, "brokers": brokers}


async def get_partner_health(*, force: bool = False) -> dict[str, Any] | None:
    """Cached (30 min) normalized partner info. None when unavailable —
    callers must treat that as 'unknown', never 'healthy'."""
    now = time.monotonic()
    if not force and _cache["data"] is not None and now - _cache["at"] < _TTL_SECONDS:
        return _cache["data"]
    if not snap.is_configured():
        return None
    try:
        raw = await snap.get_partner_info()
    except Exception as e:  # noqa: BLE001 — health probe must never break callers
        logger.warning("partner info probe failed: %s", e)
        return _cache["data"]  # serve stale over nothing
    data = _normalize(raw)
    _cache["data"] = data
    _cache["at"] = now
    return data


def broker_flags_for(health: dict[str, Any] | None,
                     brokerage_name: str | None) -> dict[str, Any] | None:
    """Match a connected account's brokerage display name against the health
    map (slug or name, case-insensitive substring both ways)."""
    if not health or not brokerage_name:
        return None
    needle = brokerage_name.strip().upper()
    if not needle:
        return None
    for slug, flags in (health.get("brokers") or {}).items():
        name = str(flags.get("name") or "").upper()
        if needle == slug or needle == name or needle in name or name and name in needle:
            return flags
    return None


def peek_health() -> dict[str, Any] | None:
    """Cache-only read (no network) for request-path callers, kicking a
    background refresh when stale so the next request sees fresh data."""
    now = time.monotonic()
    if _cache["data"] is None or now - _cache["at"] >= _TTL_SECONDS:
        import asyncio
        import threading

        def _refresh():
            try:
                asyncio.run(get_partner_health(force=True))
            except Exception:  # noqa: BLE001
                pass
        threading.Thread(target=_refresh, daemon=True,
                         name="broker-partner-health").start()
    return _cache["data"]


def degraded_connected_brokers_cached(accounts: list[dict]) -> list[dict[str, Any]]:
    """Request-path variant of degraded_connected_brokers: cache-only."""
    health = peek_health()
    return _degraded_from(health, accounts)


def _degraded_from(health: dict[str, Any] | None,
                   accounts: list[dict]) -> list[dict[str, Any]]:
    if not health:
        return []
    seen: dict[str, dict] = {}
    for ba in accounts:
        name = ba.get("brokerageName")
        if not name or name in seen:
            continue
        flags = broker_flags_for(health, name)
        if flags and (flags["isDegraded"] or flags["maintenanceMode"] or not flags["enabled"]):
            seen[name] = {"brokerage": name,
                          "isDegraded": flags["isDegraded"],
                          "maintenanceMode": flags["maintenanceMode"],
                          "enabled": flags["enabled"]}
    return list(seen.values())


async def degraded_connected_brokers(accounts: list[dict]) -> list[dict[str, Any]]:
    """Degraded/maintenance flags for brokers that have CONNECTED accounts —
    the only ones worth surfacing. Returns [{brokerage, isDegraded,
    maintenanceMode, enabled}]. Empty when health is unknown."""
    health = await get_partner_health()
    return _degraded_from(health, accounts)
