"""Setup tags: the chart's UCT Intelligence "Setups" list as text, never drawn.

GET /api/patterns/{sym}?tf=D&confirmed_only=true carries `setup_tags` while
AUTO_STRUCTURES_SETUP_TAGS_ENABLED is on (auto_structures.setup_tags_enabled, read per call).
Off: no `setup_tags` key, so the payload is byte-identical to before.

Each tag is one deterministic fact about one of the ticker's last three COMPLETED daily sessions:
a name, a one-line definition, the session it occurred on, its kind ("setup" for a blind-confirmed
recognition setup, "event" for a bar event) and its direction. The ids, and who may see which, are
registry.SETUP_TAG_TEAM_SET / SETUP_TAG_MEMBER_SET (one authority). A member is shown only a row
whose direction is bullish (NR7, which has no direction, is the one exception) and only while the
module's TAGS_ROUND equals auto_structures.MEMBER_SETUP_TAGS_ROUND. Admins see every id, both
directions. Fail closed: any failure serves no tags.

The tags come from the SAME registered detectors the daily scan runs, fed the slice the scan feeds
them (registry.bars_for at SCAN_BASE_DEPTH), with two deliberate exceptions:
  * uct_hve is fed SETUP_TAG_HVE_DEPTH bars so its record is judged over a full year (252 prior
    sessions); at the scan's 200 bars it can only see 199.
  * nr7 and outside_bar judge only the newest bar of what they are handed, so they are also run on
    the slices ending one and two sessions back, which is what makes "the last three sessions" mean
    the same thing for them as for every other id.

TEXTBOOK narrows a detector to its textbook definition where the detector is LOOSER than the
textbook (a tag must never show a definition that is false for the bar it names). A detector that is
STRICTER than the textbook needs no narrowing: every bar it reports still meets the definition.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from typing import Optional

_log = logging.getLogger(__name__)

#: The tag rules and definitions below, as one versioned round. Members are served tags only while
#: this equals auto_structures.MEMBER_SETUP_TAGS_ROUND (a literal there, changed by hand).
TAGS_ROUND = 1
#: Completed daily sessions a tag may be from: the newest and the two before it.
TAG_WINDOW_SESSIONS = 3
#: Bars fetched per ticker: enough for the deepest detector slice plus the two older NR7 /
#: outside-bar slices.
SETUP_TAG_FETCH_BARS = 320
#: The slice uct_hve is fed: 252 prior sessions for the oldest trigger session in the window.
SETUP_TAG_HVE_DEPTH = 252 + TAG_WINDOW_SESSIONS
#: Detectors that judge only the newest bar of the slice they are handed.
LAST_BAR_ONLY = ("nr7", "outside_bar")

SETUP, EVENT = "setup", "event"

#: id -> (member-facing name, one-line definition, kind). The definition is true for every bar the
#: tag is shown on (TEXTBOOK narrows the detectors that are looser than their textbook).
TAG_DEFS: dict = {
    # Blind-confirmed recognition setups.
    "uct_launch_pad_v4": (
        "Launch Pad",
        "A close just above a tight cluster of the 8-day EMA, 21-day EMA and 50-day average, "
        "with no falling 200-day average overhead.", SETUP),
    "uct_gap_support": (
        "Gap Support",
        "A pullback that tests an unfilled, high-volume gap up and closes back above the gap.", SETUP),
    "uct_capitulation": (
        "Capitulation",
        "A wide-range flush that closes far below the lower Bollinger Band after a multi-day slide.",
        SETUP),
    "uct_go_signal": (
        "Go Signal",
        "In a rising stock, a session that opens weak, undercuts nearby support and closes in the "
        "upper part of its range.", SETUP),
    "uct_flag_htf": (
        "Flag",
        "A strong advance followed by a shallow, orderly pause above a rising 21-day EMA, pressing "
        "or closing through the top of the pause.", SETUP),
    "uct_ma_reclaim": (
        "MA Reclaim",
        "A close back above the 50-day or 200-day moving average after price had been closing "
        "below it.", SETUP),
    "uct_trendline_break": (
        "Trendline Break",
        "A green session that closes up through a falling trendline drawn across prior swing highs.",
        SETUP),
    "uct_flat_top_breakout_ftb4": (
        "Flat-Top Breakout",
        "A close at or through a flat ceiling of repeated highs inside a shallow base, in an "
        "uptrend.", SETUP),
    # Deterministic bar events.
    "uct_kicker": (
        "Kicker",
        "A down candle followed by an up candle that opens above the prior session's open, so the "
        "two bodies do not overlap.", EVENT),
    "uct_oops_reversal": (
        "Oops Reversal",
        "The session opens below the prior session's low, then rallies to close above the prior "
        "session's close.", EVENT),
    "uct_slingshot": (
        "Slingshot",
        "The first close above the 4-day EMA of the highs after three or more closes below it, in a "
        "stock above its 50-day average.", EVENT),
    "uct_hve": (
        "Highest Volume in a Year",
        "The session's volume is the highest of the past 252 trading sessions.", EVENT),
    "nr7": (
        "NR7",
        "The session's high-to-low range is the narrowest of the last seven sessions.", EVENT),
    "outside_bar": (
        "Outside Bar",
        "The session's range engulfs the prior session's: a higher high and a lower low.", EVENT),
    "episodic_pivot": (
        "Episodic Pivot",
        "A gap up of 4% or more on at least twice the average volume and range that closes near the "
        "high and above a sideways base; the news behind it is not checked.", EVENT),
}


def _labels(row) -> list:
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    lv = ex.get("label_variants")
    return list(lv) if isinstance(lv, list) else []


def _extras(row) -> dict:
    ex = ((row or {}).get("geometry") or {}).get("extras")
    return ex if isinstance(ex, dict) else {}


#: id -> predicate over a detection row: True only when the row meets the TEXTBOOK definition.
#: Only detectors LOOSER than their textbook are listed; every other id passes as reported.
#:   uct_kicker        the core rule needs only a weak prior close, a gap over the prior CLOSE and
#:                     a break of the prior high; the textbook kicker is a red candle then a green
#:                     candle opening above the red candle's OPEN (label textbook_v5).
#:   uct_oops_reversal the scan needs only an open under the prior CLOSE and a low under the prior
#:                     low; the textbook oops opens under the prior LOW (extras.gap_below_low).
#:   uct_hve           at the scan's depth the record is over 199 sessions; the textbook is a year
#:                     of 252 (label hve_252, meaningful once fed SETUP_TAG_HVE_DEPTH bars).
TEXTBOOK: dict = {
    "uct_kicker": lambda r: "textbook_v5" in _labels(r),
    "uct_oops_reversal": lambda r: _extras(r).get("gap_below_low") is True,
    "uct_hve": lambda r: "hve_252" in _labels(r),
}


def _register_detectors() -> None:
    """Import every tag detector's module (registration happens at import)."""
    from api.services.pattern_engine.detectors.uct import (  # noqa: F401
        uct_launch_pad_v4, uct_gap_support, uct_capitulation, uct_go_signal, uct_flag_htf,
        uct_ma_reclaim, uct_trendline_break, uct_flat_top_breakout_ftb4,
        uct_kicker, uct_oops_reversal, uct_slingshot, uct_hve, episodic_pivot,
    )
    from api.services.pattern_engine.detectors.classical import nr7, outside_bar  # noqa: F401


def event_t(row, bars) -> Optional[int]:
    """The `t` of the session a detection names: the trigger bar (extras.trigger_bars_ago, counted
    back from the newest of `bars`, which ends where the detector's slice ended), else the newest
    geometry anchor. None when neither is readable."""
    ex = _extras(row)
    tba = ex.get("trigger_bars_ago")
    if type(tba) is int and 0 <= tba < len(bars):
        return int(bars[-1 - tba]["t"])
    ts = []
    for a in ((row or {}).get("geometry") or {}).get("anchors") or []:
        if isinstance(a, dict) and isinstance(a.get("t"), (int, float)):
            ts.append(int(a["t"]))
    return max(ts) if ts else None


def _ymd_text(t: int) -> str:
    s = str(int(t))
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else s


def compute_tags(sym: str, bars: list) -> list:
    """Every TEAM-set tag for `sym` over completed daily `bars` ({t,o,h,l,c,v}, oldest first, `t`
    YYYYMMDD): at most one per id (the newest), in the window, meeting its textbook definition.
    Setups first, then events, newest first within each. Raises on a missing detector (the caller
    fails closed)."""
    from api.services.pattern_engine.detectors import registry as reg
    from api.services.pattern_engine.primitives.context import build_context

    _register_detectors()
    if len(bars) < TAG_WINDOW_SESSIONS + 1:
        return []
    window = {int(b["t"]) for b in bars[-TAG_WINDOW_SESSIONS:]}
    base = reg.SCAN_BASE_DEPTH
    ctx_full = build_context(bars[-base:], sym=sym)
    found: dict = {}

    def _run(pid, own, ctx):
        fn = reg.get_detector(pid)
        try:
            dets = fn(own, reg.context_for(pid, ctx, sym)) or []
        except Exception:  # noqa: BLE001 -- one bad detector never hides the others
            _log.warning("[setup-tags] %s raised on %s", pid, sym, exc_info=True)
            return
        for d in dets:
            if d.get("pattern_id") != pid:
                continue
            check = TEXTBOOK.get(pid)
            if check is not None and not check(d):
                continue
            t = event_t(d, own)
            if t is None or t not in window:
                continue
            if pid not in found or t > found[pid][0]:
                found[pid] = (t, str(d.get("direction") or ""))

    for pid in sorted(reg.SETUP_TAG_TEAM_SET):
        if pid == "uct_hve":
            _run(pid, bars[-SETUP_TAG_HVE_DEPTH:], ctx_full)
        elif pid in LAST_BAR_ONLY:
            for back in range(TAG_WINDOW_SESSIONS):
                head = bars[:len(bars) - back] if back else bars
                own = reg.bars_for(pid, head, base)
                ctx = ctx_full if not back else build_context(head[-base:], sym=sym)
                _run(pid, own, ctx)
        else:
            _run(pid, reg.bars_for(pid, bars, base), ctx_full)

    out = []
    for pid, (t, direction) in found.items():
        name, definition, kind = TAG_DEFS[pid]
        out.append({
            "setup": pid, "setup_name": name, "setup_definition": definition,
            "asof_date": _ymd_text(t), "kind": kind, "direction": direction,
            "tag_round": TAGS_ROUND,
        })
    out.sort(key=lambda r: (0 if r["kind"] == SETUP else 1, -int(r["asof_date"].replace("-", "")),
                            r["setup"]))
    return out


def member_tags(tags) -> list:
    """The part of `tags` a paid member may see: a member-set id, a bullish row (or an id with no
    direction), stamped with the member round. Anything else is dropped. Fail closed: when the
    module's round is not the member round, nothing."""
    from api.services import auto_structures
    from api.services.pattern_engine.detectors import registry as reg

    rnd = auto_structures.MEMBER_SETUP_TAGS_ROUND
    if not (type(rnd) is int and rnd == TAGS_ROUND):
        return []
    out = []
    for t in tags or []:
        pid = (t or {}).get("setup")
        if pid not in reg.SETUP_TAG_MEMBER_SET:
            continue
        if t.get("tag_round") != rnd:
            continue
        if not (t.get("direction") in reg.SETUP_TAG_MEMBER_DIRECTIONS
                or pid in reg.SETUP_TAG_DIRECTIONLESS):
            continue
        out.append(t)
    return out


# Per-ticker cache of the TEAM tags, keyed on the newest completed bar so a new session recomputes.
_CACHE: "OrderedDict[str, tuple]" = OrderedDict()
_CACHE_LOCK = threading.Lock()
_CACHE_MAX = 512
_CACHE_TTL_S = 600


def _completed_daily_bars(sym: str) -> list:
    """The latest SETUP_TAG_FETCH_BARS daily bars of `sym` on COMPLETED sessions, oldest first.
    Empty when the session clock is unknown (fail closed: no tags rather than a forming bar)."""
    from api.services import barspack, bars_sqlite
    done = barspack._last_complete_session_ymd()
    if done is None:
        return []
    rows = bars_sqlite.get_bars_before(sym, "D", SETUP_TAG_FETCH_BARS, int(done)) or []
    return [{"t": int(r[0]), "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def _team_tags_cached(sym: str) -> list:
    bars = _completed_daily_bars(sym)
    if not bars:
        return []
    key = f"{sym}|{int(bars[-1]['t'])}"
    now = time.time()
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit and now - hit[0] < _CACHE_TTL_S:
            _CACHE.move_to_end(key)
            return hit[1]
    tags = compute_tags(sym, bars)
    with _CACHE_LOCK:
        _CACHE[key] = (now, tags)
        _CACHE.move_to_end(key)
        while len(_CACHE) > _CACHE_MAX:
            _CACHE.popitem(last=False)
    return tags


def tags_for(sym: str, *, member: bool) -> Optional[list]:
    """The `setup_tags` for one daily chart, or None while AUTO_STRUCTURES_SETUP_TAGS_ENABLED is off
    (the caller then adds no key). A member gets member_tags(); an admin gets the team set. A ticker
    pending acquisition gets none. Never raises: any failure serves []."""
    from api.services import auto_structures
    if not auto_structures.setup_tags_enabled():
        return None
    sym = (sym or "").strip().upper()
    if not sym:
        return []
    try:
        if auto_structures.deal_hold(sym) is not None:
            return []
        tags = _team_tags_cached(sym)
        return member_tags(tags) if member else list(tags)
    except Exception:  # noqa: BLE001 -- fail closed, never a 500 on the setups read
        _log.warning("[setup-tags] failed for %s", sym, exc_info=True)
        return []
