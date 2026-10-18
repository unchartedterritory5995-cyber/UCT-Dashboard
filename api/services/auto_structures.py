"""Auto Structures — the chart's admin-only drawing layer (dark, flag-gated).

AUTO_STRUCTURES_ENABLED (default OFF, read PER CALL): when on, an ADMIN's chart
toolbar shows the structures toggle again and GET /api/patterns/{sym} can carry
the current base boxes (`include_structures=true`).

AUTO_STRUCTURES_MEMBERS_ENABLED (default OFF, read PER CALL, and only meaningful
while AUTO_STRUCTURES_ENABLED is also on): PAID members get the toggle too, but
see ONLY the MEMBER SET (registry.DISPLAY_MEMBER_SET): the types that passed two
independent blind packets as drawn -- flat_base, the MA pullback v5
(uct_pullback_ma_v5, otherwise internal), and on D/W/M the bc:flat-base pivot line
(box off; REPORT_BCFLAT_C2.md), the learned `drawn` levels + trendlines, and
bull_flag as the round-9 drawing code draws it (REPORT_BULLFLAG_R9.md; only a row
stamped with that round, never a stale one). The rest of the team set
(bc:cup-with-handle), experimental, hidden and the levels layer stay admin-only;
the route filters server-side (`member_rows`), never the client.
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


def member_ids() -> frozenset:
    """The pattern ids a member may be drawn: registry.DISPLAY_MEMBER_SET, read
    from the registry module PER CALL (one authority, never a copy here)."""
    from api.services.pattern_engine.detectors import registry
    return frozenset(registry.DISPLAY_MEMBER_SET)


def member_rows(rows) -> list:
    """What a member may be drawn: rows whose pattern id is in the MEMBER SET
    (registry.DISPLAY_MEMBER_SET, the types that passed the blind check as drawn)
    AND whose display tier is `trusted` (stamped per row by display_policy).
    Both must hold: a row without a tier, or an id outside the set, is dropped.

    A team-set base box (TEAM_PIVOT_BOXES) passed its blind check as its PIVOT LINE
    with the box off, so a member gets one only in that shape (`_pivot_only`): a box
    whose stamp failed or never ran would draw the full box, which nobody judged.

    A bull_flag passed its blind check as drawn by ONE drawing round
    (MEMBER_BULL_FLAG_ROUND), so a member gets one only while it is that round's
    finished, drawn flag (`_confirmed_flag`): a stale flag, or one stamped by other
    drawing code or never stamped at all, is dropped. Fail closed."""
    allowed = member_ids()
    return [r for r in rows or []
            if (r or {}).get("display_tier") == "trusted"
            and (r or {}).get("pattern_id") in allowed
            and ((r or {}).get("pattern_id") not in TEAM_PIVOT_BOXES or _pivot_only(r))
            and ((r or {}).get("pattern_id") != "bull_flag" or _confirmed_flag(r))]


#: The bull_flag drawing round the blind check confirmed for members: round 9,
#: 8d033ec7d2 (lab/geometry_eval REPORT_BULLFLAG_R9.md). A literal ON PURPOSE, not
#: display.BULL_FLAG_DRAW_ROUND: when the drawing code moves to a new round, members
#: stop getting bull_flag until that round is confirmed and this is changed by hand.
MEMBER_BULL_FLAG_ROUND = 9


def _confirmed_flag(row) -> bool:
    """True when a bull_flag row is drawn by the confirmed round: not stale, and
    `extras.draw_round` (stamped by display.draw_geometry only on a flag that came
    through every verdict and the overlap pass) equals MEMBER_BULL_FLAG_ROUND.
    Missing geometry, a missing stamp or any other round is False."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    if ex.get("stale"):
        return False
    rnd = ex.get("draw_round")
    return type(rnd) is int and rnd == MEMBER_BULL_FLAG_ROUND


def _pivot_only(row) -> bool:
    """True when a base-box row draws its pivot line and nothing else: not stale,
    `draw_box` explicitly False, and a `draw_pivot` with a finite price and a span.
    That is what PatternOverlay draws for an admin's team-set box (boxOff -> no box
    renderer, the pivot as a horizontal line)."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    pv = ex.get("draw_pivot")
    if ex.get("stale") or ex.get("draw_box") is not False or not isinstance(pv, dict):
        return False
    try:
        price = float(pv.get("price"))
    except (TypeError, ValueError):
        return False
    return (price == price and price not in (float("inf"), float("-inf"))
            and pv.get("start_t") is not None and pv.get("end_t") is not None)


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
    if bars and pid in TEAM_PIVOT_BOXES and not extras.get("stale"):
        # (round 4: an already-stale box -- a failed cup breakout -- keeps its first reason)
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
            pv = _display.pivot_line(ext, start_t, end_t, price)
            # round 4: the line on the base's top CLUSTER of highs, never one spike / failed-
            # breakout wick, and never the last (breakout) bar's high
            pos = _display._index(bars)
            s, e = pos.get(pv["start_t"]), pos.get(pv["end_t"])
            if s is not None and e is not None:
                e = min(e, len(bars) - 2) if e > s else e
                top = _display.robust_top(bars, min(s, e), max(s, e), _display.atr14(bars))
                if top is not None:
                    pv["price"] = float(top)
            # round 2: a real base under the line, and the line near price
            ok, why = _display.pivot_base_verdict(bars, pv["start_t"], pv["end_t"], pv["price"])
            if ok:   # round 3: and a FLAT base -- no stair-step, no deep V
                ok, why = _display.flat_shape_verdict(bars, pv["start_t"], pv["end_t"], pv["price"])
            if ok:   # round 4: not a wide choppy range, not a recovery from a deep decline
                ok, why = _display.flat_range_verdict(bars, pv["start_t"], pv["end_t"], pv["price"])
            if ok:   # round 5: a base under the line -- no fresh high, no thin or rounded base
                ok, why = _display.flat_top_verdict(bars, pv["start_t"], pv["end_t"], pv["price"])
            if not ok:
                extras["stale"] = True
                extras["stale_reason"] = why
                return
            extras["draw_pivot"] = pv
        else:   # bc:cup-with-handle: the rim line, from the LEFT LIP to the breakout bar
            subs0 = extras.get("sub_boxes") or []
            cup = subs0[0] if len(subs0) >= 2 else {"start_t": start_t, "end_t": end_t}
            # round 8 (display.cup_true_start): the drawn cup starts on the true left peak when the
            # detector's start fell a few bars after it; every rule below reads the moved start
            cs_t = _display.cup_true_start(bars, cup.get("start_t"), cup.get("end_t"))
            if cs_t != cup.get("start_t"):
                extras["cup_start_moved_from"] = cup.get("start_t")
                cup = {**cup, "start_t": cs_t}
            rim = _display.cup_rim_line(bars, cup.get("start_t"), cup.get("end_t"), end_t)
            if rim is None:     # span unknown: the old line (box top / pivot) as before
                end = ext["end_t"] if ext and ext.get("break") == "breakout" else end_t
                rim = {"start_t": int(start_t), "end_t": int(end), "price": price}
            # round 4: no gap-island cup, no rim already broken by a close before the last bar;
            # round 5 (display.cup_reach_verdict): no rim too old for the chart, none on a
            # pre-gap-down high, none the right side never came back to
            ok, why = _display.cup_shape_verdict(bars, cup.get("start_t"), cup.get("end_t"), rim)
            if not ok:
                extras["stale"] = True
                extras["stale_reason"] = why
                return
            extras["draw_pivot"] = rim
            # round 6 (display.pullback_handle): the handle box is the pullback from the right
            # side's peak to the last bar (or the bar before the breakout) -- at most
            # HANDLE_MAX_PULLBACK_BARS bars after the peak, its floor in the cup's upper half;
            # otherwise no box (the rim stays)
            box, why = _display.pullback_handle(bars, cup.get("start_t"), cup.get("end_t"), rim)
            if box:
                extras["draw_handle"] = box
            else:
                extras["handle_reason"] = why
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


def last_bar_forming(last_t, now=None) -> bool:
    """True when the daily series' last bar is a session still in progress (later than the most
    recent COMPLETE session, barspack's one authority on that), so the prior day is the bar before
    it. False when the last bar is complete -- it IS the prior day as of the next session -- and
    False when the session clock is unknown (the conservative answer: the drawer then omits the
    prior-day pair and says so, rather than drawing a forming bar's moving range as a level)."""
    try:
        from api.services import barspack
        done = barspack._last_complete_session_ymd(now)
        return done is not None and int(last_t) > int(done)
    except Exception:  # noqa: BLE001 -- a clock question never breaks the drawing
        return False


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
        forming = bool(rows) and last_bar_forming(rows[-1][0])
        drawn = auto_draw.drawn_set(auto_draw.clean_bars(rows), last_bar_forming=forming)
        if drawn is not None:
            suppress = {pid: "hidden_by_default" for pid in sorted(DISPLAY_LEARNED_HIDES)}
            suppress.update({pid: "replaced_by_learned" for pid in sorted(DISPLAY_LEARNED_REPLACES)})
            out = {**drawn, "suppress": suppress}
    except Exception as e:  # noqa: BLE001 -- a drawing layer must never 500 a read
        _log.debug("[auto-draw] %s failed: %s", sym, e)
        out = None
    _DRAWN_CACHE[sym] = (now, out)
    return out
