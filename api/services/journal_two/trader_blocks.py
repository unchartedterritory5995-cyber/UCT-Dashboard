"""Trader blocks (Notebook P2 Tier 1, spec §P2): the server half.

A trader block is a widgetEmbed whose widgetId is a block id (docs/notebook/p1-verify-before-building.md
§a). This module builds the node a style composes and READS the market data a block shows.

⛔ NOTHING HERE WRITES A NOTE. A block's state changes only through an editor transaction (spec §P2
integrity rule); the composer places the node this module builds, and journal_styles writes the note
in its one insert. tests/test_trader_blocks_no_note_door.py reads this file and fails on any j2_notes
write or any call to a notes write function.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable

#: The three P2a blocks (`block: true` in the client registry, bound in BLOCK_COMPONENTS). The market
#: context is NOT one: it is the existing `marketcontext` capture widget (Task 3, IR-S6).
BLOCK_IDS = ("preEntryChecklist", "priceStamps", "positionSizing")

#: The regime ids regime.classify_regime answers (journal_two/regime.py), in severity order.
REGIME_IDS = ("green", "amber", "orange", "red")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _node(block_id: str, params: dict, ctx: dict) -> dict:
    from api.services.journal_two import journal_styles as js
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": block_id, "embedId": uuid.uuid4().hex, "mode": "snapshot", "params": params,
        "capturedAt": _iso(ctx["now"]), "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None,
        "searchText": js._BLOCK_BY_ID[block_id]["search"],
    }}


def _settings(block: dict) -> dict:
    return block.get("settings") or {}


def build_pre_entry_checklist(block: dict, ctx: dict):
    s = _settings(block)
    return _node("preEntryChecklist", {"setup": "", "includeRules": s.get("includeRules", "yes"),
                                       "requireAll": s.get("requireAll", "no"), "checked": []}, ctx), None


def build_price_stamps(block: dict, ctx: dict):
    return _node("priceStamps", {"on": _settings(block).get("on", "no")}, ctx), None


def build_position_sizing(block: dict, ctx: dict):
    """The regime the size was built in, as the regime ID; the client maps ids to the house words
    through app/src/constants/houseSizing.json, the ONE in-repo table (IR-S10).

    R-W0-2: the regime is read and DATED exactly as entry_context._regime_fields reads it (the wire's
    exposure, dated by the reading's own date or else the wire run's), through the compose's memo, so
    every block in one compose stamps the same frozen reading. HELD-ONLY (R-W0-1): it is entered only
    when the pod already holds a breadth payload, because the default engine.get_breadth goes on to the
    breadth vendor fetch on a cold box. A cold hold leaves the block unstamped; the client stamps
    today's regime on the member's first change."""
    from api.services import engine
    params = {"grade": _settings(block).get("grade", "A")}
    try:
        held = engine.get_breadth(held_only=True) is not None
    except Exception:  # noqa: BLE001 -- an unreadable hold is a missing regime, never a failed note
        held = False
    if held:
        from api.services.journal_two import entry_context
        field = entry_context._regime_fields(ctx.setdefault("memo", {}))[0]
        if field.get("value") in REGIME_IDS:
            params.update({"regimeId": field["value"], "regimeAsOf": field.get("asOf") or ""})
    return _node("positionSizing", params, ctx), None


BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {
    "preEntryChecklist": build_pre_entry_checklist,
    "priceStamps": build_price_stamps,
    "positionSizing": build_position_sizing,
}
