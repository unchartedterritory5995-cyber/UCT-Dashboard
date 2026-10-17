"""Auto Structures — the chart's admin-only drawing layer (dark, flag-gated).

AUTO_STRUCTURES_ENABLED (default OFF, read PER CALL): when on, an ADMIN's chart
toolbar shows the structures toggle again and GET /api/patterns/{sym} can carry
the current base boxes (`include_structures=true`).

AUTO_STRUCTURES_MEMBERS_ENABLED (default OFF, read PER CALL, and only meaningful
while AUTO_STRUCTURES_ENABLED is also on): PAID members get the toggle too, but
see ONLY the TEAM DRAWING SET (registry.DISPLAY_TRUSTED = DISPLAY_TEAM_SET,
owner direction 2026-10-17): trusted-tier detections, trusted-tier base boxes
(their pivot lines) and, on D/W/M, the learned `drawn` levels + trendlines.
Experimental, hidden and the levels layer stay admin-only; the route filters
server-side (`member_rows`), never the client. The member flag was switched OFF
at 2026-10-17T17:07:28Z and stays off until the team set passes a blind check.
Display-only end to end: nothing here changes what any detector fires on, its
confidence, HIST_SCORE or `confirmed_only`.
"""
from __future__ import annotations

import logging
import os
import time

from api.services.pattern_engine import display as _display
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


def members_enabled() -> bool:
    """Read PER CALL. True only while BOTH AUTO_STRUCTURES_ENABLED and
    AUTO_STRUCTURES_MEMBERS_ENABLED are on: the member flip rides the admin
    gate, so unsetting AUTO_STRUCTURES_ENABLED alone still closes every door."""
    return enabled() and (
        os.environ.get("AUTO_STRUCTURES_MEMBERS_ENABLED", "0").strip().lower() in _TRUTHY)


def member_rows(rows) -> list:
    """What a member may be drawn: rows whose display tier is `trusted` (the
    registry's DISPLAY_TRUSTED, stamped per row by display_policy), nothing else.
    A row without a tier is not trusted."""
    return [r for r in rows or [] if (r or {}).get("display_tier") == "trusted"]


def box_to_detection(sym: str, box: dict, bars: list | None = None) -> dict:
    """One base_catalog box -> a detection-shaped row the overlay already reads.

    With the daily `bars` the box was read from, a flat-base / square-box also
    carries `extras.draw_anchors`: its DRAWN extent capped to the consolidation
    (pattern_engine.display.consolidation_extent; lab REPORT_TIERS_V2.md,
    2026-10-17: the judges saw these boxes take in the run-up and the
    breakdown bars). top / floor / pivot / levels stay base_catalog's numbers.
    Since REPORT_TIERS_V3.md (2026-10-17) that drawn extent ends AT the
    breakout / breakdown bar and is at most display.MAX_BOX_BARS wide, and a
    cup-with-handle that broke out and closed back below its rim carries
    `extras.stale` (structures_for does not serve it).
    """
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
    if bars and pid in _display.EXTENT_CAPPED:
        try:
            ext = _display.consolidation_extent(bars, start_t, end_t, top, floor)
            if ext:
                extras["draw_anchors"] = _display.extent_anchors(ext)
        except Exception:  # noqa: BLE001 -- a drawing cap never drops the box
            pass
    if bars and pid == "bc:cup-with-handle":
        # v3 (REPORT_TIERS_V3.md, 2026-10-17): a cup whose price already broke
        # out above the rim (the top line) and closed back below it is STALE --
        # the judges saw these drawn as if still forming. Judged over the
        # handle (the last sub-box) when there is one, else the whole box.
        # A live breakout (still above the rim) ends the drawn box AT the
        # breakout bar instead of running on through the advance.
        try:
            subs0 = extras["sub_boxes"]
            h0 = subs0[-1] if len(subs0) >= 2 else {"start_t": start_t, "end_t": end_t}
            if _display.failed_breakout(bars, h0.get("start_t"), h0.get("end_t"), top):
                extras["stale"] = True
                extras["stale_reason"] = "failed_breakout"
            else:
                ext = _display.consolidation_extent(bars, start_t, end_t, top, floor)
                if ext and ext.get("break") == "breakout":
                    extras["draw_anchors"] = [{"t": start_t, "price": top},
                                              {"t": ext["end_t"], "price": floor}]
        except Exception:  # noqa: BLE001 -- a staleness check never drops the box here
            pass
    if bars and pid == "bc:cup-with-handle" and len(extras["sub_boxes"]) >= 2:
        # The handle is the LAST sub-box; end it at the first close above the
        # lip (display only -- base_catalog's numbers are untouched).
        try:
            subs = [dict(sb) for sb in extras["sub_boxes"]]
            h = subs[-1]
            ext = _display.handle_extent(bars, h.get("start_t"), h.get("end_t"), top)
            if ext:
                subs[-1] = ext
            else:
                subs = subs[:-1]
            extras["draw_sub_boxes"] = subs
        except Exception:  # noqa: BLE001
            pass
    if bars and pid in TEAM_PIVOT_BOXES:
        _team_pivot(extras, pid, bars, start_t, end_t, top, floor, pivot)
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


#: Team drawing set (owner direction 2026-10-17, registry.DISPLAY_TEAM_SET): the
#: base_catalog boxes the team draws, as their breakout / pivot line. The BOX is
#: dropped (`draw_box` False) because neither box held up blind (v3: bc:flat-base
#: 1.20, bc:cup-with-handle 1.50); the cup keeps its capped handle (`draw_handle`).
TEAM_PIVOT_BOXES = frozenset({"bc:flat-base", "bc:cup-with-handle"})


def _team_pivot(extras, pid, bars, start_t, end_t, top, floor, pivot) -> None:
    """Stamp extras.draw_pivot / draw_box / draw_handle (display only), or mark
    a flat base that already broke DOWN out of its band as stale. Never raises."""
    try:
        price = float(top if pivot is None else pivot)
        ext = _display.consolidation_extent(bars, start_t, end_t, top, floor)
        if pid == "bc:flat-base":
            if ext and ext.get("break") == "breakdown":
                extras["stale"] = True
                extras["stale_reason"] = "broke_down"
                return
            extras["draw_pivot"] = _display.pivot_line(ext, start_t, end_t, price)
        else:   # bc:cup-with-handle: the rim line, from the left lip to the breakout bar
            end = ext["end_t"] if ext and ext.get("break") == "breakout" else end_t
            extras["draw_pivot"] = {"start_t": int(start_t), "end_t": int(end), "price": price}
            subs = extras.get("draw_sub_boxes")
            # only while the handle survived handle_extent (else the last sub-box is the cup's)
            if isinstance(subs, list) and len(subs) >= 2 and len(subs) == len(extras["sub_boxes"]):
                extras["draw_handle"] = dict(subs[-1])
        extras["draw_box"] = False
    except Exception:  # noqa: BLE001 -- a drawing stamp never drops the box
        pass


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
                    det = box_to_detection(sym, box, bars)
                except Exception:  # noqa: BLE001 -- one bad box drops that box only
                    continue
                # A stale box (extras.stale, e.g. a failed cup breakout) is not
                # served: dropping it here keeps the overlay unchanged.
                if (det.get("geometry") or {}).get("extras", {}).get("stale"):
                    continue
                out.append(det)
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
