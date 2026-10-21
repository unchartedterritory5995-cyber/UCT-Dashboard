"""Base WARNINGS: a small caution tag on a drawn base (MarketSurge-parity "late-stage" / "faulty base").

DISPLAY ONLY. Nothing here is read by any detector, confidence, HIST_SCORE or `confirmed_only`, and nothing
here changes WHICH base is found or where it is drawn. A warning is one extra key on a structures row,
`geometry.extras.warning = {code, text, round}`, and the overlay draws it as a small caution tag on the
drawing (PatternOverlay `baseWarning`).

GATES (auto_structures.with_warnings, read per call):
  * AUTO_STRUCTURES_WARNINGS_ENABLED, default OFF. Off => no key is added anywhere and every payload is
    byte-identical to before (railed).
  * Members get a warning only while auto_structures.MEMBER_WARNINGS_ROUND (a literal) equals the round
    stamped here (WARNINGS_ROUND). It is None: members get no warning until a blind check passes
    (lab base_warnings). Admins get them with the flag on.

THE WARNINGS (one per row, the first that holds in this order):
  failed_breakout  price closed above the base's pivot (by at least BREAKOUT_PCT) within the last
                   FAILED_LOOKBACK sessions and the as-of close is back under it (by at least FAIL_PCT):
                   "failed breakout: closed back below pivot 12.34".
  too_deep         the base's depth (its top down to its low, as a share of the top) is beyond the
                   shape's norm (DEPTH_NORMS, the IBD base norms): "too deep: 41% (norm <= 33%)".
                   A shape with no published norm gets no depth warning.
  late_stage       base_catalog.base_stage_count >= LATE_STAGE_MIN on the bars up to the as-of session.
                   ⛔ The stage is an ESTIMATE: the count walks the stack of flat-base-qualifying bases
                   behind the last bar and only an advance of >= 20% off the older base's pivot opens a
                   new stage (base_catalog.base_stage_count). It sees only the bars it is handed (the
                   chart's 600 sessions) and only flat-style bases, so the text always says "est.":
                   "late-stage base (est. stage 3)".

NO LOOKAHEAD. `warning_at(bars, i, row)` reads bars[:i+1] only; a row's own numbers (pivot, low, top,
start) come from a drawing built on bars up to i. Railed in tests/test_base_warnings.py (future bars
appended, wild and crash) and measured in lab/base_warnings (lookahead log).

WITHHELD BASES. A base_catalog box the display rounds withhold (`extras.stale`, auto_structures) used to
vanish silently. With the flag on, a withheld box whose own warning is a FAULT (FAULT_CODES: a failed
breakout or a base too deep) is served to admins WITH that warning, still `stale`, and the overlay draws
it only because it carries one (PatternOverlay `warningView`). Every other withheld box stays withheld.
"""
from __future__ import annotations

import os

_TRUTHY = ("1", "true", "yes", "on")

#: The warning round this code IS (stamped as warning.round). The member gate compares it with the
#: literal auto_structures.MEMBER_WARNINGS_ROUND. Bump it with every change to a rule below.
WARNINGS_ROUND = 1

#: late_stage fires at this estimated stage or later.
LATE_STAGE_MIN = 3
#: failed_breakout: the breakout close must lie within this many sessions before the as-of bar ...
FAILED_LOOKBACK = 20
#: ... clear the pivot by at least this share (a real close through the line, not a tick over it) ...
BREAKOUT_PCT = 0.005
#: ... and the as-of close must sit under the pivot by at least this share.
FAIL_PCT = 0.005

#: The deepest base a shape normally makes (top to low, as a share of the top). IBD's published norms:
#: a flat base corrects no more than ~15%, a cup-with-handle ~12-33%, a high-tight flag's flag ~20-25%.
#: bc:base (the shape-agnostic base drawing) is held to the cup's 33%. No norm => no depth warning.
DEPTH_NORMS: dict = {
    "bc:flat-base": 0.15,
    "bc:square-box": 0.15,
    "bc:cup-with-handle": 0.33,
    "bc:high-tight-flag": 0.25,
    "bc:base": 0.33,
}

#: Every code this module can stamp, in priority order.
CODES = ("failed_breakout", "too_deep", "late_stage")
#: The codes that may bring a WITHHELD (stale) box back, tagged: a fault in the base itself.
FAULT_CODES = frozenset({"failed_breakout", "too_deep"})
#: Structures rows that are not a base and never carry a warning.
NOT_A_BASE = frozenset({"bc:range-10"})


def enabled() -> bool:
    """AUTO_STRUCTURES_WARNINGS_ENABLED, read PER CALL. Unset means OFF."""
    return os.environ.get("AUTO_STRUCTURES_WARNINGS_ENABLED", "0").strip().lower() in _TRUTHY


def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x and x not in (float("inf"), float("-inf")) else None


def is_base_row(row) -> bool:
    """True for a structures row that is a base the chart can DRAW: bc:base, or a base_catalog box other
    than the plain range box, whose stamped display tier is not `hidden` (a hidden row never draws, so a
    tag on it would be a warning nobody sees)."""
    r = row or {}
    if r.get("display_tier") == "hidden":
        return False
    pid = str(r.get("pattern_id") or "")
    return pid == "bc:base" or (pid.startswith("bc:") and pid not in NOT_A_BASE)


def row_base(row):
    """{pivot, top, low, start_t} read off a structures row's own numbers, or None.
    bc:base: its drawing (draw_base). A base_catalog box: the drawn pivot line when stamped, else the
    box's pivot, else its top; its floor; its start."""
    r = row or {}
    ex = (r.get("geometry") or {}).get("extras") or {}
    if r.get("pattern_id") == "bc:base":
        bd = ex.get("draw_base")
        if not isinstance(bd, dict):
            return None
        piv, low = _num(bd.get("pivot")), _num(bd.get("low"))
        if piv is None or low is None:
            return None
        return {"pivot": piv, "top": piv, "low": low, "start_t": bd.get("start_t")}
    dp = ex.get("draw_pivot")
    piv = _num(dp.get("price")) if isinstance(dp, dict) else None
    top = _num(ex.get("top"))
    if piv is None:
        piv = _num(ex.get("pivot"))
    if piv is None:
        piv = top
    low = _num(ex.get("floor"))
    if piv is None or low is None:
        return None
    return {"pivot": piv, "top": top if top is not None else piv, "low": low, "start_t": r.get("start_t")}


def failed_breakout(bars, i, pivot, start_t=None) -> bool:
    """True when a close in the FAILED_LOOKBACK sessions before bar i (and not before the base's start)
    cleared `pivot` by BREAKOUT_PCT and bar i's close is back under it by FAIL_PCT. Reads bars[:i+1]."""
    p = _num(pivot)
    if p is None or p <= 0 or i < 1:
        return False
    if not float(bars[i]["c"]) < p * (1.0 - FAIL_PCT):
        return False
    j0 = max(0, i - FAILED_LOOKBACK)
    if start_t is not None:
        try:
            st = int(start_t)
            j0 = max(j0, next((j for j in range(0, i + 1) if int(bars[j]["t"]) >= st), i))
        except (TypeError, ValueError):
            pass
    return any(float(bars[j]["c"]) > p * (1.0 + BREAKOUT_PCT) for j in range(j0, i))


def depth(base) -> float | None:
    """The base's depth: its top down to its low, as a share of the top."""
    top, low = _num((base or {}).get("top")), _num((base or {}).get("low"))
    if top is None or low is None or top <= 0 or low > top:
        return None
    return (top - low) / top


def stage_at(bars, i) -> int:
    """base_catalog.base_stage_count on bars[:i+1] (an ESTIMATE; see the module docstring). 0 on failure."""
    try:
        from api.services.screener import base_catalog
        return int(base_catalog.base_stage_count(list(bars[:i + 1])))
    except Exception:  # noqa: BLE001 -- a warning never breaks a drawing
        return 0


def warning_at(bars, i, row, stage=None):
    """The warning for one structures row as of bar i, from bars[:i+1] only, or None.
    `stage` (stage_at(bars, i)) may be passed in so a chart's rows share one count."""
    if not is_base_row(row) or not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(bars):
        return None
    # No bar after i is read: failed_breakout indexes bars 0..i only, and stage_at slices bars[:i+1]
    # itself (ONE slice, railed by tests/test_base_warnings.py -- not a second copy here).
    b = bars
    base = row_base(row)
    if base is None:
        return None
    if failed_breakout(b, i, base["pivot"], base.get("start_t")):
        return _stamp("failed_breakout", "failed breakout: closed back below pivot %.2f" % base["pivot"])
    norm = DEPTH_NORMS.get(str(row.get("pattern_id")))
    dep = depth(base)
    if norm is not None and dep is not None and dep > norm:
        return _stamp("too_deep", "too deep: %d%% (norm <= %d%%)" % (round(dep * 100), round(norm * 100)))
    n = stage_at(b, i) if stage is None else int(stage)
    if n >= LATE_STAGE_MIN:
        return _stamp("late_stage", "late-stage base (est. stage %d)" % n)
    return None


def _stamp(code, text) -> dict:
    return {"code": code, "text": text, "round": WARNINGS_ROUND}


def last_complete_index(bars) -> int | None:
    """Index of the newest COMPLETED session in `bars` (a forming or unknown-clock last bar is dropped,
    fail closed: auto_structures.last_bar_complete), or None for no bars."""
    if not bars:
        return None
    from api.services import auto_structures
    i = len(bars) - 1
    return i if auto_structures.last_bar_complete(bars[i]["t"]) else (i - 1 if i >= 1 else None)
