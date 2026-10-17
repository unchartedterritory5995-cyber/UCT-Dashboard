"""Auto Structures — the chart's admin-only drawing layer (dark, flag-gated).

AUTO_STRUCTURES_ENABLED (default OFF, read PER CALL): when on, an ADMIN's chart
toolbar shows the structures toggle again and GET /api/patterns/{sym} can carry
the current base boxes (`include_structures=true`). Members are unchanged until
a later, separate flip. Display-only end to end: nothing here changes what any
detector fires on, its confidence, HIST_SCORE or `confirmed_only`.
"""
from __future__ import annotations

import logging
import os
import time

from api.services.pattern_engine.detectors.registry import (
    DISPLAY_LEARNED_HIDES, DISPLAY_LEARNED_REPLACES, display_policy,
)

_log = logging.getLogger(__name__)

_TRUTHY = ("1", "true", "yes", "on")

#: Daily bars handed to base_catalog: it classifies on the trailing 400 and needs
#: a full history beside it for its longer look-backs.
STRUCTURE_BARS = 600

_CACHE: dict = {}
_DRAWN_CACHE: dict = {}
_CACHE_TTL_S = 600


def enabled() -> bool:
    """Read PER CALL. Unset means OFF (an enablement gate on a dark surface)."""
    return os.environ.get("AUTO_STRUCTURES_ENABLED", "0").strip().lower() in _TRUTHY


def box_to_detection(sym: str, box: dict) -> dict:
    """One base_catalog box -> a detection-shaped row the overlay already reads."""
    key = str(box.get("structure_key") or "")
    pid = f"bc:{key}"
    top = float(box["top"])
    floor = float(box["floor"])
    start_t = int(box["start_t"])
    end_t = int(box["end_t"])
    pivot = box.get("pivot")
    extras = {
        "top": top,
        "floor": floor,
        "pivot": None if pivot is None else float(pivot),
        "label": box.get("label") or "",
        "bars": box.get("bars"),
        "sub_boxes": list(box.get("sub_boxes") or []),
        "source": box.get("source"),
        "pattern_end_t": end_t,
    }
    return {
        "id": f"{pid}:{sym}:{start_t}:{end_t}",
        "sym": sym,
        "tf": "D",
        "pattern_id": pid,
        "pattern_name": box.get("name") or key,
        "category": "base",
        "direction": "bullish",
        "start_t": start_t,
        "end_t": end_t,
        "geometry": {
            "shape": "base_box",
            "anchors": [{"t": start_t, "price": top}, {"t": end_t, "price": floor}],
            "extras": extras,
        },
        "levels": {"entry": None if pivot is None else float(pivot)},
        "confidence": None,
        "status": "forming",
        **display_policy(pid),
    }


def _daily_bars(sym: str) -> list:
    """The latest STRUCTURE_BARS daily bars of `sym` as {t,o,h,l,c,v} dicts, oldest first."""
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(sym, "D", STRUCTURE_BARS) or []
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def structures_for(sym: str) -> list:
    """Current base boxes for the latest daily bars of `sym`. Never raises."""
    sym = (sym or "").upper()
    now = time.time()
    hit = _CACHE.get(sym)
    if hit and now - hit[0] < _CACHE_TTL_S:
        return hit[1]
    out: list = []
    try:
        from api.services.screener import base_catalog
        bars = _daily_bars(sym)
        if len(bars) >= 10:
            for box in base_catalog.current_base_structures(bars) or []:
                try:
                    out.append(box_to_detection(sym, box))
                except Exception:  # noqa: BLE001 -- one bad box drops that box only
                    continue
    except Exception as e:  # noqa: BLE001 -- a drawing layer must never 500 a read
        _log.debug("[auto-structures] %s failed: %s", sym, e)
        out = []
    _CACHE[sym] = (now, out)
    return out


def drawn_for(sym: str):
    """The learned drawer's default drawing for the latest daily bars of `sym`
    (api/services/auto_draw.drawn_set), plus the display rules that ride with it:
    `suppress` maps a pattern_id to why the overlay leaves it undrawn while this block is
    present (`hidden_by_default` / `replaced_by_learned`, from the registry constants).
    None when there are too few bars. Never raises."""
    sym = (sym or "").upper()
    now = time.time()
    hit = _DRAWN_CACHE.get(sym)
    if hit and now - hit[0] < _CACHE_TTL_S:
        return hit[1]
    out = None
    try:
        from api.services import auto_draw
        rows = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in _daily_bars(sym)]
        drawn = auto_draw.drawn_set(auto_draw.clean_bars(rows))
        if drawn is not None:
            suppress = {pid: "hidden_by_default" for pid in sorted(DISPLAY_LEARNED_HIDES)}
            suppress.update({pid: "replaced_by_learned" for pid in sorted(DISPLAY_LEARNED_REPLACES)})
            out = {**drawn, "suppress": suppress}
    except Exception as e:  # noqa: BLE001 -- a drawing layer must never 500 a read
        _log.debug("[auto-draw] %s failed: %s", sym, e)
        out = None
    _DRAWN_CACHE[sym] = (now, out)
    return out
