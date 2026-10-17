"""Chart base boxes — DISPLAY-ONLY geometry for the screener's base structures.

Each box is read off the numbers a structure's EXISTING state function already
computed (`darvas_box_state`, `flat_base_state`, `vcp_state`, ...). Nothing here
detects anything: a box is returned only when the structure's own
`Structure.detect(ctx)` fires on the same context, and every price on it is a
number the state function produced. No gate, threshold or pivot is added,
moved or re-derived.

⛔ `start_t` / `end_t` are the `t` VALUES of the input bars (YYYYMMDD ints on
the daily path), never bar indices — an index means nothing once the window
the caller fetched moves.

Bars in, exactly the shape `api/main.py::_scan_patterns_daily` builds from
`bars_sqlite.get_bars(sym, "D", N)`: ``{t, o, h, l, c, v}`` oldest-first. The
context is built the way `snapshot_builder` builds it: the working window is the
last ``WORKING_BARS`` (400) usable bars and `bars_full` is the whole usable
series. Callers should pass ~600 daily bars (enough for every structure's
lookback plus the 400-bar working window).

Never raises: a failure inside one structure drops that box only.
"""
from __future__ import annotations

import logging
from typing import Callable, Optional

_log = logging.getLogger(__name__)

#: The working window snapshot_builder hands `bases.classify`.
WORKING_BARS = 400

#: The fallback "structure" when no base box fires (lab geometry_eval REPORT.md,
#: 2026-10-16: the 10-session range high is the line traders actually use on
#: flat tops — 63% recall vs 20% for the posted-day open).
RANGE_FALLBACK_BARS = 10


def _usable(bars) -> list:
    from api.services.screener.technicals import usable_bars
    return usable_bars(list(bars or []))


def _ctx(bars):
    """(ctx, working_bars) built the way snapshot_builder builds them."""
    from api.services.screener import bases
    full = _usable(bars)
    work = full[-WORKING_BARS:]
    return bases._context(work, full), work


def _t(bars, i) -> Optional[int]:
    try:
        return int(bars[i]["t"])
    except (IndexError, KeyError, TypeError, ValueError):
        return None


def _f(x) -> Optional[float]:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v and v not in (float("inf"), float("-inf")) else None


def _label(name: str, nbars: Optional[int], pivot: Optional[float]) -> str:
    parts = [name]
    if nbars:
        parts.append(f"{int(nbars)} bars")
    if pivot is not None:
        parts.append(f"pivot {pivot:.2f}")
    return " · ".join(parts)


def _box(key, name, bars, start_i, end_i, top, floor, pivot, nbars, source,
         sub_boxes=None) -> Optional[dict]:
    start_t, end_t = _t(bars, start_i), _t(bars, end_i)
    top, floor, pivot = _f(top), _f(floor), _f(pivot)
    if start_t is None or end_t is None or top is None or floor is None:
        return None
    return {
        "structure_key": key,
        "name": name,
        "label": _label(name, nbars, pivot),
        "start_t": start_t,
        "end_t": end_t,
        "top": top,
        "floor": floor,
        "pivot": pivot,
        "bars": int(nbars) if nbars else None,
        "sub_boxes": list(sub_boxes or []),
        "source": source,
    }


# ── per-structure mappings: STATE NUMBERS -> box. No detection here. ──────

def _darvas(ctx, bars):
    from api.services.screener import base_catalog as bc
    st = bc.darvas_box_state(ctx.bars)
    if st.get("state") != "box":
        return None
    n = len(bars)
    start = st["top_set_at"]
    # Darvas publishes no pivot for the box (Structure.pivot is None).
    return _box("darvas-box", "Darvas box", bars, start, n - 1, st["top"],
                st["bottom"], None, n - start, "darvas_box_state")


def _flat_base(ctx, bars):
    from api.services.screener import base_catalog as bc
    st = bc.flat_base_state(ctx.bars)
    if st is None:
        return None
    n, k = len(bars), st["bars"]
    return _box("flat-base", "Flat base", bars, n - k, n - 1, st["high"],
                st["low"], st["pivot"], k, "flat_base_state")


def _square_box(ctx, bars):
    from api.services.screener import base_catalog as bc
    st = bc.square_box_state(ctx.bars)
    if st is None:
        return None
    n, k = len(bars), st["bars"]
    return _box("square-box", "Square box", bars, n - k, n - 1, st["high"],
                st["low"], st["pivot"], k, "square_box_state")


def _three_weeks_tight(ctx, bars):
    from api.services.screener import base_catalog as bc
    st = bc.three_weeks_tight_state(ctx.bars)
    if st is None:
        return None
    n, k = len(bars), st["bars"]
    # The state carries the intraday high of the three weeks and the weekly
    # CLOSES; the floor is the lowest of those closes (the band IBD measures).
    return _box("three-weeks-tight", "3 weeks tight", bars, n - k, n - 1,
                st["high"], min(st["closes"]), st["pivot"], k,
                "three_weeks_tight_state")


def _base_on_base(ctx, bars):
    from api.services.screener import base_catalog as bc
    st = bc.base_on_base_state(ctx.bars)
    if st is None:
        return None
    n = len(bars)
    k2 = st["base2_bars"]
    subs = []
    e1, k1 = st.get("base1_end"), st.get("base1_bars")
    if e1 is not None and k1:
        s1t, e1t = _t(bars, e1 - k1), _t(bars, e1 - 1)
        if s1t is not None and e1t is not None:
            subs.append({"start_t": s1t, "end_t": e1t,
                         "top": _f(st["base1_high"]), "floor": _f(st["base1_low"])})
    return _box("base-on-base", "Base on base", bars, n - k2, n - 1,
                st["base2_high"], st["base2_low"], st["pivot2"], k2,
                "base_on_base_state", subs)


def _cup_with_handle(ctx, bars):
    from api.services.pattern_engine.primitives import cup
    st = cup.cup_with_handle_state(ctx.bars)
    if st is None:
        return None
    n = len(bars)
    cs, ce = st["cup_start"], st["cup_end"]          # ce is EXCLUSIVE
    rim = max(st["left_rim"], st["right_rim"])
    subs = []
    for s, e, top, floor in ((cs, ce - 1, rim, st["low"]),
                             (ce, n - 1, st["handle_high"], st["handle_low"])):
        st_t, en_t = _t(bars, s), _t(bars, e)
        if st_t is not None and en_t is not None:
            subs.append({"start_t": st_t, "end_t": en_t,
                         "top": _f(top), "floor": _f(floor)})
    return _box("cup-with-handle", "Cup with handle", bars, cs, n - 1, rim,
                st["low"], st["pivot"], n - cs, "cup_with_handle_state", subs)


def _high_tight_flag(ctx, bars):
    from api.services.screener import base_catalog as bc
    st = bc.high_tight_flag_state(ctx)
    if st is None:
        return None
    n = len(bars)
    peak_i = n - 1 - st["flag_bars"]                 # flag = bars[peak_i+1:]
    origin = peak_i - st["pole_bars"]
    subs = []
    o_t, p_t = _t(bars, origin), _t(bars, peak_i)
    if o_t is not None and p_t is not None:
        subs.append({"start_t": o_t, "end_t": p_t,
                     "top": _f(st["pole_high"]), "floor": _f(st["pole_low"])})
    # The main box is the FLAG — the consolidation the pivot breaks out of.
    return _box("high-tight-flag", "High tight flag", bars, peak_i, n - 1,
                st["pole_high"], st["flag_low"], st["pivot"], st["flag_bars"],
                "high_tight_flag_state", subs)


def _vcp(ctx, bars):
    from api.services.screener import base_catalog as bc
    st = bc.vcp_state(ctx)
    if st is None:
        return None
    n = len(bars)
    start = (n - 1) - st["bars"]
    subs = []
    for sp in st.get("contraction_spans") or []:
        s_t, e_t = _t(bars, sp["start"]), _t(bars, sp["end"])
        if s_t is not None and e_t is not None:
            subs.append({"start_t": s_t, "end_t": e_t,
                         "top": _f(sp["high"]), "floor": _f(sp["low"])})
    return _box("vcp", "VCP", bars, start, n - 1, st["top"], st["floor"],
                st["pivot"], st["bars"], "vcp_state", subs)


#: key -> mapping. Order is the render order a caller gets.
BOX_MAPPERS: dict[str, Callable] = {
    "vcp": _vcp,
    "cup-with-handle": _cup_with_handle,
    "high-tight-flag": _high_tight_flag,
    "base-on-base": _base_on_base,
    "flat-base": _flat_base,
    "three-weeks-tight": _three_weeks_tight,
    "square-box": _square_box,
    "darvas-box": _darvas,
}


def _box_on(ctx, work, structure_key) -> Optional[dict]:
    from api.services.screener import base_catalog as bc
    mapper = BOX_MAPPERS.get(structure_key)
    s = bc.by_key(structure_key)
    if mapper is None or s is None or s.detect is None:
        return None
    try:
        if not s.detect(ctx):            # the structure's OWN verdict
            return None
        return mapper(ctx, work)
    except Exception as e:  # noqa: BLE001 — a box failure costs that box only
        _log.debug("[base_geometry] %s failed: %s", structure_key, e)
        return None


def base_geometry(bars, structure_key: str) -> Optional[dict]:
    """The current box for ONE structure on the latest bars, or None."""
    try:
        ctx, work = _ctx(bars)
        if not work:
            return None
        return _box_on(ctx, work, structure_key)
    except Exception as e:  # noqa: BLE001
        _log.debug("[base_geometry] %s failed: %s", structure_key, e)
        return None


def range_box(bars, n: int = RANGE_FALLBACK_BARS) -> Optional[dict]:
    """The last-`n`-session high/low box (the default structure)."""
    try:
        work = _usable(bars)
        if len(work) < n:
            return None
        win = work[-n:]
        top = max(b["h"] for b in win)
        floor = min(b["l"] for b in win)
        top_f = _f(top)
        if top_f is None:
            return None
        return {
            "structure_key": "range-10",
            "name": "10-day range",
            "label": f"10-day range · high {top_f:.2f}",
            "start_t": int(win[0]["t"]),
            "end_t": int(win[-1]["t"]),
            "top": top_f,
            "floor": _f(floor),
            "pivot": top_f,
            "bars": n,
            "sub_boxes": [],
            "source": "range10",
        }
    except Exception as e:  # noqa: BLE001
        _log.debug("[base_geometry] range box failed: %s", e)
        return None


def current_base_structures(bars) -> list:
    """Every supported structure's current box; the 10-day range if none fire."""
    out = []
    try:
        ctx, work = _ctx(bars)
        if work:
            for key in BOX_MAPPERS:
                box = _box_on(ctx, work, key)
                if box is not None:
                    out.append(box)
    except Exception as e:  # noqa: BLE001
        _log.debug("[base_geometry] context build failed: %s", e)
    if not out:
        rb = range_box(bars)
        if rb is not None:
            out.append(rb)
    return out
