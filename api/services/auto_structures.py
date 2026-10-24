"""Auto Structures — the chart's admin-only drawing layer (dark, flag-gated).

AUTO_STRUCTURES_ENABLED (default OFF, read PER CALL): when on, an ADMIN's chart
toolbar shows the structures toggle again and GET /api/patterns/{sym} can carry
the current base boxes (`include_structures=true`).

AUTO_STRUCTURES_MEMBERS_ENABLED (default OFF, read PER CALL, and only meaningful
while AUTO_STRUCTURES_ENABLED is also on): PAID members get the toggle too, but
see ONLY the MEMBER SET (registry.DISPLAY_MEMBER_SET): the types that passed two
independent blind packets as drawn -- flat_base, the MA pullback v5
(uct_pullback_ma_v5, otherwise internal), and on D/W/M the bc:flat-base pivot line
(box off; REPORT_BCFLAT_C2.md), and
bull_flag (the learned `drawn` levels + trendlines are WITHHELD from members since
2026-10-23, MEMBER_LEARNED_LINES_ROUND = None, until rebuilt to textbook rules), and
bull_flag as the round-9 drawing code draws it (REPORT_BULLFLAG_R9.md; only a row
stamped with that round, never a stale one), plus its lighter "flagging" tier (lab
flag_vocab: a stale flag stopped only by a relaxed verdict and stamped extras.flagging;
drawn faint, no entry line). The rest of the team set
(bc:cup-with-handle), experimental, hidden and the levels layer stay admin-only;
the route filters server-side (`member_rows`), never the client. A bc:cup-with-handle
reaches a member only as the CUP TIER draws it (extras.cup_tier, drawing round 4 confirmed blind:
lab cup_tier_v2 + cup_draw_v4), see member_rows.
Display-only end to end: nothing here changes what any detector fires on, its
confidence, HIST_SCORE or `confirmed_only`.
"""
from __future__ import annotations

import logging
import os
import threading
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


def deal_hold(sym: str, member: bool = False):
    """The chart marker that replaces EVERY drawing for `sym` (pattern rows, base boxes,
    shelf pivot, base metrics, textbook numbers, learned levels) while the stock is pending
    acquisition, or None. A stock pinned at a buyout price draws a perfect "base" that is
    nothing of the kind (TECH, 2026-10-23), so the member AND team paths of the patterns
    route ask this ONCE, before any layer runs. None while DEAL_STATUS_ENABLED is off (the
    payload is then byte-identical to before) and on any error (a bug never hides a chart).
    `member=True` also holds a CLEAR price pin (a +30% gap, then a collapsed band:
    `deal_status.clear_pin`) that no hand list or headline names yet (HZO, ARX, BRZE); the
    team chart keeps its drawings for those. Never raises."""
    try:
        from api.services import deal_status
        hold = deal_status.chart_marker(sym)
        if hold is None and member:
            hold = deal_status.clear_pin_marker(sym)
        return hold
    except Exception:  # noqa: BLE001 -- fail safe: not pending
        _log.warning("[auto-structures] deal hold check failed for %s", sym, exc_info=True)
        return None


def metrics_enabled() -> bool:
    """AUTO_STRUCTURES_METRICS_ENABLED, read PER CALL; unset means OFF. While off, no metrics are
    computed and the structures payload is exactly what it was before metrics existed."""
    return os.environ.get("AUTO_STRUCTURES_METRICS_ENABLED", "0").strip().lower() in _TRUTHY


def setup_tags_enabled() -> bool:
    """AUTO_STRUCTURES_SETUP_TAGS_ENABLED, read PER CALL; unset means OFF. Rides
    AUTO_STRUCTURES_ENABLED like the member flag, so unsetting the master closes this door too.
    While off, GET /api/patterns/{sym} carries no `setup_tags` key (byte-identical payload)."""
    return enabled() and (
        os.environ.get("AUTO_STRUCTURES_SETUP_TAGS_ENABLED", "0").strip().lower() in _TRUTHY)


#: The setup-tag round a member may be shown (setup_tags.TAGS_ROUND stamps every tag). A literal ON
#: PURPOSE, like the drawing rounds: when the tag rules or their definitions move to a new round,
#: members stop getting tags until this is changed by hand (admins still see them).
MEMBER_SETUP_TAGS_ROUND = 2


#: The base-metrics round a member may be shown (base_metrics.METRICS_ROUND stamps
#: `extras.metrics_round`). A literal ON PURPOSE, like the drawing rounds: None until a blind packet
#: confirms the printed numbers, so members get NO metrics (fail closed) while admins see them under the
#: flag. Set it by hand to the confirmed round.
MEMBER_METRICS_ROUND = 1
#: The ONLY row type a member may get metrics on: the blind packets (lab base_metrics P1 2.64 / P2 2.82,
#: confirmed 2026-10-20) judged the numbers on the bc:base drawing alone. bc:flat-base measures depth from the
#: box top while its drawn pivot moves, and the cup's depth comes from a detector re-run, so both stay
#: admin-only until each passes its own packet.
MEMBER_METRICS_IDS = frozenset({"bc:base"})


def textbook_numbers_enabled() -> bool:
    """AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED, read PER CALL; unset means OFF. It rides
    AUTO_STRUCTURES_METRICS_ENABLED (the textbook numbers sit beside the base metrics, so with metrics off
    nothing is computed either way). While off, nothing in api/services/textbook_numbers.py runs and every
    payload is byte-identical to before."""
    return os.environ.get("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", "0").strip().lower() in _TRUTHY


#: The textbook-numbers round a member may be shown (textbook_numbers.TEXTBOOK_ROUND stamps
#: `extras.metrics_textbook_round`). 1: RELEASED -- round 1 passed its blind A/B against the old label on
#: 2026-10-23 (new preferred 20-2), with the two defects that check found fixed before release (a spike wick
#: taken as the buy point, PLSE; a "0% deep" range labelled at all, TECH). A member gets `metrics_textbook`
#: once AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED is on; a row whose stamped round differs keeps the confirmed
#: base metrics label (fail closed). None withholds it from every member again.
#: 2: RELEASED -- round 2 draws the bc:base top line at the buy point - $0.10 (`metrics_textbook.line`, the base
#: high) instead of on the highest body, so the line and the printed buy point are one price. It passed a blind
#: paired check against the round-1 drawing on 2026-10-23 (two packets of 25 cases where the two disagreed by more
#: than 0.5 ATR, four judges: the round-2 drawing preferred in 100 of 100 judgments, mean score 2.82 and 2.72). The
#: printed numbers are unchanged from round 1.
MEMBER_TEXTBOOK_ROUND = 2
#: The textbook keys a member's row loses while MEMBER_TEXTBOOK_ROUND does not match.
_TEXTBOOK_KEYS = ("metrics_textbook", "metrics_textbook_round")


#: The candle-rules round a member's candle labels may come from (screener.candle_catalog.CANDLE_RULES_ROUND
#: stamps the geometry). 2: RELEASED -- round 2 of the textbook audit passed its blind packets on 2026-10-24
#: (2.54 / 88% and 2.36 / 88% of cases >= 2, against a 2.3 / 70% bar); round 1 failed one packet. A literal ON
#: PURPOSE, like the drawing rounds: when the candle rules move to a new round, member_candle_rules_ok() goes
#: False until this is changed by hand after that round's own blind packets (fail closed).
#: ⛔ THE CANDLE LAYER IS LABEL-ONLY. It names a shape; it never scores, ranks or forecasts it. The same audit
#: found no label with a usable edge over random bars of the same date and trend context, so no probability,
#: strength or signal wording may ride along with a candle name to a member.
MEMBER_CANDLE_ROUND = 2


def member_candle_rules_ok() -> bool:
    """True only while MEMBER_CANDLE_ROUND is an int equal to candle_catalog.CANDLE_RULES_ROUND (read per call,
    so a test can move one literal). A member surface that shows candle labels checks this first."""
    from api.services.screener import candle_catalog
    rnd = candle_catalog.CANDLE_RULES_ROUND
    return type(MEMBER_CANDLE_ROUND) is int and type(rnd) is int and MEMBER_CANDLE_ROUND == rnd


def with_metrics(sym: str, rows, *, member: bool = False) -> list:
    """`rows` with base metrics attached (base_metrics.with_metrics) when AUTO_STRUCTURES_METRICS_ENABLED
    is on; `rows` itself, untouched, when it is off. On the member path a row keeps its metrics only while
    MEMBER_METRICS_ROUND is an int equal to its stamped `extras.metrics_round`; otherwise the member gets
    the row exactly as it was before metrics (fail closed). Never mutates a cached row. Never raises.

    With AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED also on, every row with metrics also gets the textbook
    numbers (textbook_numbers.with_textbook); a member keeps them only while MEMBER_TEXTBOOK_ROUND equals the
    stamped round, and otherwise gets the row exactly as the metrics alone build it."""
    if not metrics_enabled():
        return rows
    try:
        from api.services import base_metrics
        if not any((r or {}).get("pattern_id") in base_metrics.METRIC_IDS for r in rows or []):
            return rows
        bars = _daily_bars(sym)
        out = base_metrics.with_metrics(rows, bars)
        if textbook_numbers_enabled():
            out = _with_textbook(out, bars)
    except Exception:  # noqa: BLE001 -- metrics never break a read
        _log.debug("[base-metrics] %s failed", sym, exc_info=True)
        return rows
    if not member:
        return out
    return [_member_textbook(m) if _member_metrics_ok(m) else r for r, m in zip(rows, out)]


def _with_textbook(rows, bars) -> list:
    """The textbook numbers on `rows` (the as-of session's completeness from last_bar_complete, which fails
    closed; the series is the full history when it is shorter than the STRUCTURE_BARS asked for). On any
    failure the rows come back as they were."""
    try:
        from api.services import textbook_numbers
        return textbook_numbers.with_textbook(rows, bars, asof_complete=last_bar_complete,
                                              full_history=len(bars or []) < STRUCTURE_BARS)
    except Exception:  # noqa: BLE001 -- the textbook numbers never break a read
        _log.debug("[textbook-numbers] failed", exc_info=True)
        return rows


def _member_textbook_ok(row) -> bool:
    """True only while MEMBER_TEXTBOOK_ROUND is an int equal to the row's stamped metrics_textbook_round,
    beside a dict of textbook numbers."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    rnd = ex.get("metrics_textbook_round")
    return (type(MEMBER_TEXTBOOK_ROUND) is int and type(rnd) is int and rnd == MEMBER_TEXTBOOK_ROUND
            and isinstance(ex.get("metrics_textbook"), dict))


def _member_textbook(row):
    """A member's copy of a metrics row: as it is when it carries no textbook numbers or they are released
    (_member_textbook_ok), else the same row with the textbook keys removed (key order kept, so the payload
    is byte-identical to the metrics-only row). Never mutates `row`."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    if not any(k in ex for k in _TEXTBOOK_KEYS) or _member_textbook_ok(row):
        return row
    geo = row.get("geometry") or {}
    return {**row, "geometry": {**geo, "extras": {k: v for k, v in ex.items() if k not in _TEXTBOOK_KEYS}}}


def _member_metrics_ok(row) -> bool:
    """True only for a MEMBER_METRICS_IDS row, while MEMBER_METRICS_ROUND is an int and equals the row's
    stamped metrics_round."""
    if (row or {}).get("pattern_id") not in MEMBER_METRICS_IDS:
        return False
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    rnd = ex.get("metrics_round")
    return (type(MEMBER_METRICS_ROUND) is int and type(rnd) is int and rnd == MEMBER_METRICS_ROUND
            and isinstance(ex.get("metrics"), dict))


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

    A bull_flag reaches a member only while MEMBER_BULL_FLAG_ROUND is an int equal to the
    row's drawing round (`_confirmed_flag`): a stale flag, or one stamped by other drawing
    code or never stamped at all, is dropped. Fail closed. Since 2026-10-24 that literal is
    None (recert E: no bull flag drawing passes the strict textbook bar), so NO bull flag
    reaches a member.

    The "flagging" tier (`_flagging_flag`: a flag the round-9 code stopped ONLY on a relaxed verdict,
    stamped `extras.flagging`) is WITHHELD from members since 2026-10-24 (blind textbook score 1.28):
    `_member_flagging_flag` is False while MEMBER_FLAGGING_ROUND is None, so a member gets the
    confirmed tier only. Admins and the team still get both tiers (they never pass through here).

    A uct_pullback_ma_v5 is WITHHELD from members since 2026-10-24 (recertification C failed it as served and
    through two fix rounds): every v5 row is dropped while MEMBER_PULLBACK_MA_V5_ROUND is None.

    A uct_flat_top_breakout passed its blind check as the "flat top" ceiling drawn
    under the v2 conditions (MEMBER_FLAT_TOP_ROUND), so a member gets one only while
    it carries that round's stamp beside a well-formed `draw_flat_top`
    (`_confirmed_flat_top`): any other flat-top row carries no stamp and is dropped.
    Fail closed.

    A bc:cup-with-handle passed its blind checks only as the CUP TIER draws it (lab cup_tier_v2
    recognition + lab cup_draw_v4 drawing round 4), so a member gets one only while it carries the
    tier stamp `extras.cup_tier` with draw_round == MEMBER_CUP_TIER_ROUND (a literal), not withheld,
    beside a well-formed pivot / handle (`_confirmed_cup_tier`), and is then served the TIER'S
    drawing in place of the admin rounds' (`_cup_tier_member_row`). Fail closed.

    A bc:base (the shape-agnostic base drawing, lab base_draw) passed its blind check as drawn
    by one round (MEMBER_BASE_ROUND), so a member gets one only while it carries that round's
    stamp beside a well-formed `draw_base` (`_confirmed_base`); a row of a later drawing round is
    served as the member round drew it (`_base_member_row`, from `extras.draw_member`). Fail closed. On the
    member path
    the route also applies `member_base_precedence`, so a bc:base never sits beside an incumbent
    base drawing's breakout line.

    An inside-day drawing (draw:inside-day, lab id_draw_v2) passed its blind check as drawn by one
    round (MEMBER_INSIDE_DAY_ROUND), so a member gets one only while it carries that round's stamp
    beside a well-formed `draw_inside_day` (`_confirmed_inside_day`). Fail closed. On the member
    path the route also applies `member_inside_day_precedence`.

    A named base-shape drawing (SHAPE_DRAW_IDS, lab base_shapes) reaches a member only while its row
    carries the round its MEMBER_<SHAPE>_ROUND literal names beside a well-formed `draw_shape`
    (`_confirmed_shape`) and is not stale. Only the double bottom's literal is set (round 2); the
    saucer, ascending base and IPO base literals are None, so every such row is dropped whatever
    else is true of it. Fail closed.

    A flat_base passed its blind check as drawn by ONE drawing round (MEMBER_FLAT_BASE_ROUND), so a
    member gets one only as that round draws it (`_flat_base_member_row`): a row of a later round is
    served with that round's drawing swapped back for the confirmed one, or dropped. Fail closed."""
    allowed = member_ids()
    rows = [_flat_base_member_row(r) if (r or {}).get("pattern_id") == "flat_base"
            else _base_member_row(r) if (r or {}).get("pattern_id") == BASE_DRAW_ID else r
            for r in rows or []]
    kept = [r for r in rows if r is not None
            if (r or {}).get("display_tier") == "trusted"
            and (r or {}).get("pattern_id") in allowed
            and ((r or {}).get("pattern_id") != "bull_flag"
                 or _confirmed_flag(r) or _member_flagging_flag(r))
            and ((r or {}).get("pattern_id") != PULLBACK_MA_V5_ID or MEMBER_PULLBACK_MA_V5_ROUND is not None)
            and ((r or {}).get("pattern_id") != "uct_flat_top_breakout" or _confirmed_flat_top(r))
            and ((r or {}).get("pattern_id") != CUP_ID or _confirmed_cup_tier(r))
            and ((r or {}).get("pattern_id") != "bc:flat-base" or MEMBER_BC_FLAT_BASE_ROUND is not None)
            and ((r or {}).get("pattern_id") != BASE_DRAW_ID or _confirmed_base(r))
            and ((r or {}).get("pattern_id") != INSIDE_DAY_DRAW_ID or _confirmed_inside_day(r))
            and ((r or {}).get("pattern_id") not in SHAPE_DRAW_IDS or _confirmed_shape(r))
            and ((r or {}).get("pattern_id") != SHELF_PIVOT_ID or _confirmed_shelf(r))
            and ((r or {}).get("pattern_id") not in SETUP_DRAW_IDS or _confirmed_setup_draw(r))
            and ((r or {}).get("pattern_id") not in TEAM_PIVOT_BOXES or (r or {}).get("pattern_id") == CUP_ID
                 or _pivot_only(r))]
    return [_cup_tier_member_row(r) if r.get("pattern_id") == CUP_ID else r for r in kept]


#: Rows written by ONE scan of one ticker carry last_seen_at within seconds of each other (every
#: detector stamps its own `now` while the scan works through that ticker). Scans of a ticker are
#: at least an hour apart (the hourly leaders pass; the daily universe pass), so a row more than this
#: far behind the ticker's newest scan is from an older scan. A width, not a cadence: well above the
#: seconds one ticker's detectors take, well below the gap between two scans.
SCAN_TOLERANCE_SECS = 600


def latest_scan_rows(rows, latest_scan_at, latest_bar_t) -> list:
    """The detection rows still CURRENT for a member: each row's last_seen_at is within
    SCAN_TOLERANCE_SECS of `latest_scan_at` (the ticker's newest scan, memory.latest_scan_at), so a
    row the newest scan did not re-write -- an older hash_key for the same pattern, kept alive by
    the 7-day active window -- is dropped. A uct_flat_top_breakout must ALSO carry a
    draw_flat_top whose end_t (the bar it was drawn as of) equals `latest_bar_t`, the ticker's
    newest COMPLETED daily bar (latest_completed_bar_t): the lab rule draws a fire as of the last
    completed session, so once a newer session has completed the drawing is old even if no newer
    scan has run yet -- while today's still-forming bar never hides it.

    Pure; fails closed. An unknown latest scan, a row without an int last_seen_at, an unknown
    latest bar (for the flat top) or a stamp without an int end_t drops the row. Order is kept."""
    if type(latest_scan_at) is not int:
        return []
    floor = latest_scan_at - SCAN_TOLERANCE_SECS
    out = []
    for r in rows or []:
        seen = (r or {}).get("last_seen_at")
        if type(seen) is not int or seen < floor:
            continue
        if (r or {}).get("pattern_id") == "uct_flat_top_breakout":
            ex = ((r or {}).get("geometry") or {}).get("extras") or {}
            ft = ex.get("draw_flat_top")
            end_t = ft.get("end_t") if isinstance(ft, dict) else None
            if type(latest_bar_t) is not int or type(end_t) is not int or end_t != latest_bar_t:
                continue
        out.append(r)
    return out


def latest_completed_bar_t(sym: str, tf: str, now=None):
    """YYYYMMDD of the ticker's newest STORED daily bar that belongs to a completed session: the
    newest bar at or before barspack._last_complete_session_ymd (the one authority on "complete":
    a trading day at/after the close, else the prior trading session -- weekends and NYSE holidays
    included). Today's bar written mid-session (chart reads, alert freshness, the live snapshot) is
    still forming and is skipped. None for a non-daily timeframe, an unknown session clock or a
    ticker with no such bar. May raise on a store error; the caller decides."""
    if (tf or "").upper() != "D":
        return None
    from api.services import barspack, bars_sqlite
    done = barspack._last_complete_session_ymd(now)
    if done is None:
        return None
    rows = bars_sqlite.get_bars_before(sym, "D", 1, int(done))
    return int(rows[-1][0]) if rows else None


def fresh_member_rows(sym: str, tf: str, rows) -> list:
    """latest_scan_rows over the store's own answers: the ticker's newest scan
    (memory.latest_scan_at) and, only when a flat-top row is present, its newest completed daily
    bar (latest_completed_bar_t). A failing scan read serves NOTHING (fail closed: no drawing
    rather than a possibly stale one); a failing bar read only withholds the flat top (bar=None),
    because the other families do not depend on it."""
    if not rows:
        return []
    try:
        from api.services.pattern_engine import memory
        scan_at = memory.latest_scan_at(sym, tf)
    except Exception:  # noqa: BLE001 -- fail closed, never a 500 on the member path
        _log.warning("member freshness read failed for %s %s; serving no detections", sym, tf,
                     exc_info=True)
        return []
    bar_t = None
    if any((r or {}).get("pattern_id") == "uct_flat_top_breakout" for r in rows):
        try:
            bar_t = latest_completed_bar_t(sym, tf)
        except Exception:  # noqa: BLE001 -- withhold the flat top only
            _log.warning("member flat-top bar read failed for %s %s; withholding the flat top",
                         sym, tf, exc_info=True)
            bar_t = None
    return latest_scan_rows(rows, scan_at, bar_t)


#: The flat-top drawing round the blind check confirmed for members: the v2 draw condition (lab
#: flattop_draw_v2, 2026-10-18: packets A 2.60 [2.30, 2.83] and B 2.57 [2.30, 2.80]). A literal ON
#: PURPOSE, not display.FLAT_TOP_DRAW_ROUND: when the drawing code moves to a new round, members stop
#: getting the flat top until that round is confirmed and this is changed by hand.
MEMBER_FLAT_TOP_ROUND = 2
#: The drawn label the judges saw.
MEMBER_FLAT_TOP_LABEL = "flat top"


def _finite(v) -> bool:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return False
    return x == x and x not in (float("inf"), float("-inf"))


def _confirmed_flat_top(row) -> bool:
    """True when a uct_flat_top_breakout row is drawn by the confirmed round: not stale,
    `extras.draw_round` (stamped by display.draw_geometry only beside a v2 drawing) equals
    MEMBER_FLAT_TOP_ROUND, and `draw_flat_top` is well formed -- a finite price, a span, the
    judged label, and at least three touch markers with finite prices. Anything else is False."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    if ex.get("stale"):
        return False
    rnd = ex.get("draw_round")
    if not (type(rnd) is int and rnd == MEMBER_FLAT_TOP_ROUND):
        return False
    ft = ex.get("draw_flat_top")
    if not isinstance(ft, dict) or ft.get("label") != MEMBER_FLAT_TOP_LABEL:
        return False
    if not _finite(ft.get("price")) or ft.get("start_t") is None or ft.get("end_t") is None:
        return False
    touches = ft.get("touches")
    return (isinstance(touches, list) and len(touches) >= 3
            and all(isinstance(t, dict) and t.get("t") is not None and _finite(t.get("price"))
                    for t in touches))


#: The flat_base drawing round the blind check confirmed for members: round 1, the drawing that passed the
#: team-set blind packets (registry.DISPLAY_MEMBER_SET; R4 confirm / R5 / R5c), stored without a stamp. A
#: literal ON PURPOSE, not display.FLAT_BASE_DRAW_ROUND: the drawing code may move to a new round (round 2,
#: lab flatbase_breakdown: `broke_down` read as of the last bar) while members keep the confirmed drawing
#: until the new round passes its own blind check and this is changed by hand.
MEMBER_FLAT_BASE_ROUND = None
#: Since 2026-10-24 None (lab recert/A_bases): the flat base failed the strict textbook re-certification -- r1
#: packets 1.92 / 1.68 / 1.80 / 1.78 (pooled 1.80) on 4 x 25 pre-registered cases, mostly bases under 5 weeks --
#: and its fix round could not be filled: under the textbook floors (5+ weeks, <= 15% deep, a real left-side
#: ceiling, a prior advance, a rising 200-day) the member path served about one flat base per 150 route calls, so
#: 100 fresh cases were out of reach. Per the protocol no flat_base reaches a member; admins keep it. Setting this
#: back to 1 restores the round-1 member drawing.
#: The one later round that carries the round-1 drawing beside its own (extras.draw_r1).
_FLAT_BASE_R1_CARRIER = 2


def _flat_base_member_row(row):
    """A member's copy of a flat_base row drawn by MEMBER_FLAT_BASE_ROUND, or None (dropped). Fail closed.

    The row's round is extras.draw_round; a row without one was stored by the round-1 code (before the
    stamp existed) and is round 1. A row of the member round is served as it is. While the member round is
    1, a round-2 row is served as ROUND 1 drew it: its FLAT_BASE_DRAW_KEYS replaced by extras.draw_r1 when
    round 1 drew it differently (no draw_r1 = both rounds drew it the same). Any other round, a malformed
    stamp or a malformed draw_r1 drops the row. The row passed in is not modified."""
    ex = ((row or {}).get("geometry") or {}).get("extras")
    if not isinstance(ex, dict):
        return row if MEMBER_FLAT_BASE_ROUND == 1 else None
    rnd = ex.get("draw_round", 1)
    if type(rnd) is not int:
        return None
    if rnd == MEMBER_FLAT_BASE_ROUND:
        return row
    if not (MEMBER_FLAT_BASE_ROUND == 1 and rnd == _FLAT_BASE_R1_CARRIER):
        return None
    if "draw_r1" not in ex:
        return row
    prior = ex.get("draw_r1")
    keys = _display.FLAT_BASE_DRAW_KEYS
    if not isinstance(prior, dict) or not prior or not set(prior) <= set(keys):
        return None
    out = {k: v for k, v in ex.items() if k not in keys and k != "draw_r1"}
    out.update(prior)
    out["draw_round"] = 1
    return {**row, "geometry": {**row["geometry"], "extras": out}}


#: The bc:flat-base pivot line (a base_catalog box, team set, pivot only) is served to members only while this is
#: not None. None since 2026-10-24 for the same recert as MEMBER_FLAT_BASE_ROUND (the two drawings were judged
#: together: one flat base, one or two drawings of it). Setting it back to "team" restores it.
MEMBER_BC_FLAT_BASE_ROUND = None


#: The cup row id (a base_catalog box).
CUP_ID = "bc:cup-with-handle"
#: The cup tier drawing round the blind check confirmed for members (lab cup_draw_v4, 2026-10-18,
#: pre-registered: packets d1 2.42 [2.20, 2.62] 96% >= 2 and d2 2.50 [2.28, 2.72] 88% >= 2, two judges
#: each), on the cup recognition tier (lab cup_tier_v2: 28 of 33 = 84.8%). A literal ON PURPOSE, not
#: cup_tier.DRAW_ROUND: when the drawing code moves to a new round, members stop getting the cup
#: until that round is confirmed and this is changed by hand.
MEMBER_CUP_TIER_ROUND = 4
#: The tier name the stamp must carry.
MEMBER_CUP_TIER_NAME = "cup_conf"


def _span(d) -> bool:
    try:
        return int(d["start_t"]) <= int(d["end_t"])
    except (KeyError, TypeError, ValueError):
        return False


#: The base drawing's row id. A bc:base row is built ONLY beside a drawing (`base_draw_row`).
BASE_DRAW_ID = "bc:base"
#: The base drawing round the blind check confirmed for members. Round 1 passed 2026-10-18 (packets
#: A 2.70 [2.47, 2.90] and B 2.80 [2.60, 2.97]); round 2 (the pivot on the base's highest body, no base
#: straight after a parabolic run) passed its own blind check 2026-10-21 (packets A 2.76 [2.60, 2.90] and
#: B 2.78 [2.64, 2.90]); round 4 (round 2 unchanged wherever round 2 draws, plus a textbook consolidation
#: round 2 missed only on a single touch or a lip reached from above) passed its own pre-registered blind
#: packets 2026-10-23 (A 2.86 [2.72, 2.98] and B 2.96 [2.90, 3.00], and a regression packet where round 2
#: draws: 25 of 25 identical); round 5 (round 4 unchanged, minus the drawings base_draw.floor_refuses says
#: are not a base: under the label's own 3% depth floor, or a volatility-collapsed range with no correction) is a
#: REMOVAL-ONLY guard, pre-registered 2026-10-23 (no approved case dropped; the refused set scored 0.90 of 3 by
#: blind judges), and members now get it. A literal ON PURPOSE, not base_draw.BASE_DRAW_ROUND: when
#: the drawing code moves ahead of this round, every bc:base row carries THIS round's drawing
#: (`extras.draw_member`) and a member is served exactly the row this round draws (`_base_member_row`),
#: until the new round passes its own blind check and this is changed by hand. While the two are equal
#: there is no carrier. Setting this back to 4 restores the round-4 member drawing, to 2 the round-2 one byte
#: for byte, and to 1 the round-1 one (the carrier path below; railed by tests/test_base_draw_round5.py,
#: tests/test_base_draw_r4_member_parity.py and tests/test_base_draw_member_parity.py).
MEMBER_BASE_ROUND = 5
#: The (member round, row round) pairs where a row of a later drawing round carries the member round's
#: drawing of the same bars beside its own (extras.draw_member): round-2 rows carrying round 1 (the round-1
#: era), and round-4 rows carrying round 2 (members on round 2 while round 4 is admin-only) or round 1 (a
#: rollback of the literal to 1), and round-5 rows carrying round 4, 2 or 1 (a rollback of the literal to
#: any of them). Round 3 failed its held-out check and is never drawn. Any other pairing is dropped.
_BASE_CARRIERS = frozenset({(1, 2), (1, 4), (2, 4), (1, 5), (2, 5), (4, 5)})
#: The drawn labels the judges saw.
MEMBER_BASE_LABELS = ("pivot", "base low")
#: The base STATES (base_draw.state_drawing, lab base_persist_forming) a member may be drawn, each by the
#: state round its own blind packets confirmed (base_draw.STATE_ROUND stamps `draw_base.state_round`). Literals
#: ON PURPOSE; None withholds that state from every member (admins still see it). A row with no `state` is the
#: judged base and is not touched by these.
#: The breakout persistence ("breakout" in the buy zone / "extended" just past it). Round 1 passed two blind
#: packets 2026-10-23 (A 2.68 [2.48, 2.86], B 2.54 [2.30, 2.74]).
MEMBER_BASE_BREAKOUT_ROUND = 1
#: "Base forming" (dashed pivot, the right side still building). Round 1 passed two blind packets 2026-10-23
#: (A 2.82 [2.68, 2.94], B 2.66 [2.48, 2.82]).
MEMBER_BASE_FORMING_ROUND = 1
#: "3 weeks tight". None: round 1 FAILED its first blind packet 2026-10-23 (A 1.94 [1.64, 2.22]), and
#: base_draw.state_drawing does not draw it at all (base_draw.DRAWN_STATES); None stays as the fail-closed gate.
MEMBER_BASE_TIGHT_ROUND = None
#: The STATELESS base (a bc:base row with no `state`: the judged base with its "Buy point X" line, before any
#: breakout). None: WITHDRAWN from members 2026-10-24 after recertification A failed it on the strict textbook
#: rubric three rounds running (lab recert/A_bases: r1 pooled 1.58; r2 packet A 2.08 with the textbook gate; r3
#: packets A 2.22 and B 2.26 with the base's own floors, the last fix round PROTOCOL allows). Admins keep it. The
#: breakout / extended states passed r2 and are unaffected. Re-release = a new passed blind round, with this set
#: to that round (an int).
MEMBER_BASE_STATELESS_ROUND = None


def _member_base_state_ok(bd) -> bool:
    """True for a draw_base with no `state` (the judged base), or one whose state's member literal is an int
    equal to its stamped `state_round`. Any other state is False (fail closed)."""
    st = bd.get("state")
    if st is None and "state" not in bd:
        return type(MEMBER_BASE_STATELESS_ROUND) is int
    rnd = {"breakout": MEMBER_BASE_BREAKOUT_ROUND, "extended": MEMBER_BASE_BREAKOUT_ROUND,
           "forming": MEMBER_BASE_FORMING_ROUND, "tight": MEMBER_BASE_TIGHT_ROUND}.get(st) if isinstance(st, str) else None
    sr = bd.get("state_round")
    return type(rnd) is int and type(sr) is int and sr == rnd


def _is_base_state_row(row) -> bool:
    """True for a bc:base row drawn by a base STATE (base_draw.state_drawing). Such a row is ADDITIVE: it
    never removes another member drawing (member_one_line_per_base ranks it last, member_inside_day_precedence
    does not count it as an incumbent); it is the one that yields."""
    try:
        return (row or {}).get("pattern_id") == BASE_DRAW_ID and "state" in row["geometry"]["extras"]["draw_base"]
    except (KeyError, TypeError):
        return False


def _is_forming_state_row(row) -> bool:
    """True for a bc:base "Base forming" state row (draw_base.state == "forming")."""
    try:
        return _is_base_state_row(row) and row["geometry"]["extras"]["draw_base"].get("state") == "forming"
    except (KeyError, TypeError, AttributeError):
        return False


def member_after_shelf(sym: str, rows, boxes) -> tuple:
    """(rows, boxes) after every member pass the route applies AFTER the shelf pivot is placed -- today the strict
    textbook gate (member_textbook_gate, recert B: it can withhold the shelf itself). THE ONE LIST of those passes:
    the member route calls it, and member_shelf_over_forming asks it whether a shelf is still served, so a shelf
    that a later gate removes can never displace a "Base forming" row (that left 11 judged forming charts with no
    drawing at all). A pass added after the shelf goes HERE, never beside the route's call. Never raises (each
    pass does not)."""
    return member_textbook_gate(sym, rows, boxes)


def member_shelf_over_forming(sym: str, rows, boxes) -> list:
    """The member chart's shelf pivot, where a judged shelf OUTRANKS a "Base forming" state row: the shelf is asked
    with the forming rows left out of the drawings it yields to (shelf_member_facts leaves them out too), and where
    it is SERVED -- it draws, the round-5 base floor keeps it, and it survives every later member pass
    (member_after_shelf) on the chart it would be served on -- the forming rows are dropped and the shelf is added.
    Anywhere else the boxes are returned unchanged (a shelf no later pass keeps is not added: it would be withheld
    anyway). Blind paired round lab shelf_vs_forming (2026-10-24, pre-registered: 50 charts where a forming row
    displaced a shelf, two packets, four fresh judges): the shelf preferred on 88% (A) and 72% (B) of charts,
    forming 8% / 12%; mean trust shelf 2.20 / 1.96 vs forming 1.36 / 1.38. Members only; daily charts only (the
    caller asks only for D). Never raises."""
    boxes = list(boxes or [])
    try:
        served = [r for r in list(rows or []) + boxes if not _is_forming_state_row(r)]
        shelf = shelf_pivot_row(sym, member=True, chart_served=served)
        shelf = member_rows([shelf]) if shelf is not None else []
        if shelf:
            # the round-5 base floor refuses a shelf region as it does every base door (removal-only): a refused
            # shelf draws nothing, so it displaces nothing
            shelf = member_base_floor(sym, [], shelf)[1]
        if not shelf:
            return boxes
        cand = [b for b in boxes if not _is_forming_state_row(b)] + shelf
        # the shelf AS FINALLY SERVED: a shelf a later member pass withholds draws nothing, so it displaces nothing
        if not any((r or {}).get("pattern_id") == SHELF_PIVOT_ID for r in member_after_shelf(sym, rows, cand)[1]):
            return boxes
        return cand
    except Exception as e:  # noqa: BLE001 -- the shelf layer never breaks a read
        _log.debug("[shelf-pivot] %s over forming failed: %s", sym, e)
        return boxes


def _base_member_row(row):
    """A member's copy of a bc:base row as MEMBER_BASE_ROUND draws it, or None (dropped). Fail closed.

    A row stamped with the member round is served as it is. A row of a later round is served as the
    member round drew the SAME bars -- only for a known (member round, row round) pair (_BASE_CARRIERS) --
    and its `extras.draw_member` must be {"round": MEMBER_BASE_ROUND,
    "draw_base": <that round's drawing or None>}; the member gets `_base_row` rebuilt from that drawing
    (byte-identical to the row the member round's code built), or nothing when that round drew nothing.
    Any other round, a missing or malformed carrier drops the row. The row passed in is not modified."""
    ex = ((row or {}).get("geometry") or {}).get("extras")
    if not isinstance(ex, dict):
        return None
    rnd = ex.get("draw_round")
    if type(rnd) is not int:
        return None
    if rnd == MEMBER_BASE_ROUND:
        return row
    if (MEMBER_BASE_ROUND, rnd) not in _BASE_CARRIERS:
        return None
    mem = ex.get("draw_member")
    if not isinstance(mem, dict) or set(mem) != {"round", "draw_base"}:
        return None
    if not (type(mem.get("round")) is int and mem["round"] == MEMBER_BASE_ROUND):
        return None
    d = mem.get("draw_base")
    if d is None:
        return None
    if not isinstance(d, dict) or not isinstance((row or {}).get("sym"), str):
        return None
    try:
        return _base_row(row["sym"], d, MEMBER_BASE_ROUND)
    except (KeyError, TypeError, ValueError):
        return None


def admin_base_rows(rows) -> list:
    """The admin structures: every row as it is, except a bc:base row whose current-round drawing is
    None (it exists only to carry the member round's drawing, `extras.draw_member`): dropped, so an admin
    sees exactly what the current drawing round draws. Order is kept. Never raises."""
    out = []
    for r in rows or []:
        try:
            if (r or {}).get("pattern_id") == BASE_DRAW_ID and r["geometry"]["extras"].get("draw_base") is None:
                continue
        except (KeyError, TypeError, AttributeError):
            continue
        out.append(r)
    return out


def _confirmed_base(row) -> bool:
    """True when a bc:base row is drawn by the confirmed round: not stale, `extras.draw_round`
    equals MEMBER_BASE_ROUND, and `draw_base` is well formed -- a finite pivot above a finite low,
    a start before its end, and the judged labels. Anything else is False."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    if ex.get("stale"):
        return False
    rnd = ex.get("draw_round")
    if not (type(rnd) is int and rnd == MEMBER_BASE_ROUND):
        return False
    bd = ex.get("draw_base")
    if not isinstance(bd, dict) or (bd.get("label"), bd.get("low_label")) != MEMBER_BASE_LABELS:
        return False
    if not _member_base_state_ok(bd):
        return False
    if not (_finite(bd.get("pivot")) and _finite(bd.get("low"))):
        return False
    if not float(bd["pivot"]) > float(bd["low"]):
        return False
    try:
        return int(bd["start_t"]) < int(bd["end_t"])
    except (KeyError, TypeError, ValueError):
        return False


#: The inside-day drawing's row id. A row of this id is built ONLY beside a drawing
#: (`inside_day_draw_row`); the inside-day DETECTORS (uct_inside_day, uct_inside_day_id4) stay
#: admin-only and are not this id.
INSIDE_DAY_DRAW_ID = "draw:inside-day"
#: The inside-day drawing round the blind check confirmed for members (lab id_draw_v2, 2026-10-19:
#: packets A2 2.56 [2.36, 2.74] and B2 2.44 [2.28, 2.60]). A literal ON PURPOSE, not
#: inside_day_draw.ID_DRAW_ROUND: when the drawing code moves to a new round, members stop getting
#: the inside day until that round is confirmed and this is changed by hand.
MEMBER_INSIDE_DAY_ROUND = 3
#: The drawn labels the judges saw.
MEMBER_INSIDE_DAY_LABELS = ("trigger", "stop")


def _confirmed_inside_day(row) -> bool:
    """True when an inside-day drawing row is drawn by the confirmed round: not stale,
    `extras.draw_round` equals MEMBER_INSIDE_DAY_ROUND, and `draw_inside_day` is well formed -- a
    finite trigger above a finite stop, both inside a finite mother range, a finite positive ATR,
    the judged labels, and the mother bar no later than the inside day no later than the as-of bar.
    Anything else is False."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    if ex.get("stale"):
        return False
    rnd = ex.get("draw_round")
    if not (type(rnd) is int and rnd == MEMBER_INSIDE_DAY_ROUND):
        return False
    d = ex.get("draw_inside_day")
    if not isinstance(d, dict) or (d.get("label"), d.get("stop_label")) != MEMBER_INSIDE_DAY_LABELS:
        return False
    vals = [d.get(k) for k in ("trigger", "stop", "mother_high", "mother_low", "atr")]
    if not all(_finite(v) for v in vals):
        return False
    trig, stop, mh, ml, at = (float(v) for v in vals)
    if not (trig > stop and mh >= trig and stop >= ml and at > 0):
        return False
    try:
        return int(d["start_t"]) < int(d["inside_t"]) <= int(d["end_t"])
    except (KeyError, TypeError, ValueError):
        return False


#: The named base-shape drawing rows (lab base_shapes, api/services/pattern_engine/shape_draw.py). A row of
#: one of these ids is built ONLY beside a drawing (`shape_draw_rows`). Keep PatternOverlay.SHAPE_DRAW_IDS equal.
SHAPE_DRAW_IDS = ("draw:saucer", "draw:ascending-base", "draw:double-bottom", "draw:ipo-base",
                  "draw:cup-no-handle", "draw:htf")
#: The drawing round each shape's blind check confirmed for members -- None: NOT confirmed. Literals ON
#: PURPOSE, never shape_draw's *_DRAW_ROUND constants: a member gets a shape only after its round passed the
#: two pre-registered blind packets (lab base_shapes/PREREG.txt) and someone set the literal by hand. To
#: release one: set its literal to the confirmed round AND add its id to registry.DISPLAY_TEAM_SET and
#: DISPLAY_MEMBER_SET (member_rows also requires the trusted tier and the member set).
MEMBER_SAUCER_ROUND = None
MEMBER_ASCENDING_BASE_ROUND = None
#: The double bottom: drawing round 2 passed both pre-registered blind packets and an independent review,
#: which released it with two conditions railed here -- a breakout older than DB_BREAKOUT_MAX_AGE sessions
#: is withheld (`_db_breakout_stale`), and a served double bottom outranks bc:base (BASE_INCUMBENT_IDS).
MEMBER_DOUBLE_BOTTOM_ROUND = 2
#: The IPO base is EXPERIMENTAL (base_catalog.EXPERIMENTAL_STRUCTURES): no lift measurement exists, so it
#: stays admin-only whatever its drawing scores.
MEMBER_IPO_BASE_ROUND = None
#: The rare-pattern admin preview's two new shapes (api/services/pattern_engine/rare_draw.py). None: NOT
#: released. They are released only by a later commit that sets the literal by hand, after the release rule in
#: api/services/rare_preview.py is met (>= 12 owner approvals at >= 80%); nothing sets them automatically.
MEMBER_CUP_NO_HANDLE_ROUND = None
MEMBER_HTF_ROUND = None
#: The drawn labels the judges see.
MEMBER_SHAPE_LABELS = ("pivot", "base low")


def _member_shape_round(pid):
    """The confirmed member round for one shape id (read PER CALL so a test can move one literal)."""
    return {
        "draw:saucer": MEMBER_SAUCER_ROUND,
        "draw:ascending-base": MEMBER_ASCENDING_BASE_ROUND,
        "draw:double-bottom": MEMBER_DOUBLE_BOTTOM_ROUND,
        "draw:ipo-base": MEMBER_IPO_BASE_ROUND,
        "draw:cup-no-handle": MEMBER_CUP_NO_HANDLE_ROUND,
        "draw:htf": MEMBER_HTF_ROUND,
    }.get(pid)


def _confirmed_shape(row) -> bool:
    """True when a named base-shape row is drawn by its shape's confirmed round: the shape's member literal
    is an int (None = not confirmed: always False), not stale, `extras.draw_round` equals it, and
    `draw_shape` is well formed -- the row's own shape, a finite pivot above a finite low, a start before
    its end, the judged labels, and every mark a finite price. Anything else is False."""
    r = row or {}
    want = _member_shape_round(r.get("pattern_id"))
    ex = (r.get("geometry") or {}).get("extras") or {}
    if ex.get("stale"):
        return False
    rnd = ex.get("draw_round")
    # an int round equal to the literal: a None literal (not confirmed) can never be equalled
    if not (type(rnd) is int and rnd == want):
        return False
    d = ex.get("draw_shape")
    if not isinstance(d, dict) or "draw:" + str(d.get("shape")) != r.get("pattern_id"):
        return False
    if (d.get("label"), d.get("low_label")) != MEMBER_SHAPE_LABELS or d.get("draw_round") != rnd:
        return False
    if not (_finite(d.get("pivot")) and _finite(d.get("low")) and float(d["pivot"]) > float(d["low"])):
        return False
    marks = d.get("marks")
    if not (isinstance(marks, list) and marks
            and all(isinstance(m, dict) and m.get("t") is not None and _finite(m.get("price")) for m in marks)):
        return False
    try:
        return int(d["start_t"]) < int(d["end_t"])
    except (KeyError, TypeError, ValueError):
        return False


def _confirmed_cup_tier(row) -> bool:
    """True when a bc:cup-with-handle row carries the confirmed cup tier drawing: not stale,
    `extras.cup_tier` names the tier and MEMBER_CUP_TIER_ROUND (an int), nothing withheld, a pivot
    with a finite price and a span, a handle box with a finite top at or above a finite floor, and a
    rim reference exactly when the pivot is at the handle high. Anything else is False."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    if ex.get("stale"):
        return False
    st = ex.get("cup_tier")
    if not isinstance(st, dict) or st.get("tier") != MEMBER_CUP_TIER_NAME:
        return False
    rnd = st.get("draw_round")
    if not (type(rnd) is int and rnd == MEMBER_CUP_TIER_ROUND):
        return False
    if st.get("withheld") is not None or "withheld" not in st:
        return False
    pv, hd, rr = st.get("pivot"), st.get("handle"), st.get("rim_ref")
    if not (isinstance(pv, dict) and _finite(pv.get("price")) and _span(pv)):
        return False
    if not (isinstance(hd, dict) and _finite(hd.get("top")) and _finite(hd.get("floor")) and _span(hd)):
        return False
    if not float(hd["top"]) >= float(hd["floor"]):
        return False
    if st.get("pivot_at") == "handle_high":
        return isinstance(rr, dict) and _finite(rr.get("price")) and _span(rr)
    return st.get("pivot_at") == "rim" and rr is None


def _cup_tier_member_row(row) -> dict:
    """A member's copy of a confirmed cup row: every admin-round drawing key (`draw_*`) replaced by the
    tier's own drawing -- the pivot (`draw_pivot`), the handle box (`draw_handle`), the rim as a faint
    reference when the pivot is the handle high (`draw_rim_ref`) and no base box (`draw_box` False) --
    so PatternOverlay draws exactly what the judges scored. The row passed in is not modified."""
    st = row["geometry"]["extras"]["cup_tier"]
    ex = {k: v for k, v in row["geometry"]["extras"].items() if not str(k).startswith("draw_")}
    ex["draw_pivot"] = dict(st["pivot"])
    ex["draw_handle"] = dict(st["handle"])
    if st.get("rim_ref"):
        ex["draw_rim_ref"] = dict(st["rim_ref"])
    ex["draw_box"] = False
    return {**row, "geometry": {**row["geometry"], "extras": ex}}


def _complete_session_bars(bars):
    """`bars` up to the newest COMPLETE session (barspack._last_complete_session_ymd, the one authority
    on "complete"), or None when the session clock is unknown or fails. Unlike last_bar_forming, which
    answers False (keep the bar) on an unknown clock, this FAILS CLOSED: no clock, no stamp."""
    try:
        from api.services import barspack
        done = barspack._last_complete_session_ymd()
    except Exception:  # noqa: BLE001 -- an unreadable clock means nothing is stamped
        return None
    if done is None:
        return None
    b = list(bars or [])
    if b and int(b[-1]["t"]) > int(done):
        b = b[:-1]
    return b


def cup_tier_stamp(det: dict, bars: list) -> None:
    """Stamp `extras.cup_tier` on a bc:cup-with-handle row when the cup tier holds at the latest
    COMPLETE daily bar of `bars` (a forming session is dropped first: the lab judged finished
    sessions; an unknown or failing session clock stamps NOTHING). Adds that one key and nothing
    else; a row the tier does not stamp is untouched. Display only. Never raises.

    Rows the admin display rounds mark stale are stamped too since lab cup_served (2026-10-23) and are
    served only when the tier draws them (`_tier_drawn_stale_cup`); before it, structures_for dropped them.
    Measured in the lab (2026-10-18): those rounds drop 63.6% of the 1,402 tier
    fires (failed_breakout 297, gap_island 176, rim_broken 173, short_of_rim 164, ...) and round 4
    withholds 169 more, so a member is served 341 of 1,402 = 24.3%; the 21 judged charts a member
    can be served score 2.36 [2.10, 2.62], 85.7% >= 2 (post hoc), served recognition 8 of 8."""
    try:
        if (det or {}).get("pattern_id") != CUP_ID:
            return
        from api.services.pattern_engine import cup_tier
        b = _complete_session_bars(bars)
        if b is None:
            return
        st = cup_tier.stamp(b)
        if st is not None:
            det["geometry"]["extras"]["cup_tier"] = st
    except Exception:  # noqa: BLE001 -- a tier stamp never drops or breaks the row
        return


#: Member-served drawings that already mark a base's breakout line. Where one of them covers the same
#: base as a bc:base drawing, a member gets the incumbent (already shipped) and NOT the base drawing, so
#: a chart never shows two or three different "pivot" / "breakout" lines for one base. Cup ids are
#: listed now so a cup tier that reaches members later is covered the day it lands.
BASE_INCUMBENT_IDS = frozenset({"flat_base", "bc:flat-base", "uct_flat_top_breakout",
                                "bc:cup-with-handle", "cup_handle", "cup_handle_uct",
                                "draw:double-bottom"})
#: A breakout level within this many ATR(14) of the base drawing's pivot is the same breakout line.
BASE_PRECEDENCE_ATR = 1.0


def _row_levels(row) -> list:
    """Every horizontal breakout / pivot price a row draws or carries (display stamps included)."""
    r = row or {}
    ex = (r.get("geometry") or {}).get("extras") or {}
    vals = [(r.get("levels") or {}).get("entry"), ex.get("pivot"), ex.get("top"), ex.get("draw_entry_price")]
    for k in ("draw_pivot", "draw_flat_top", "draw_rim_ref"):
        v = ex.get(k)
        if isinstance(v, dict):
            vals.append(v.get("price"))
    da = ex.get("draw_anchors")
    if isinstance(da, list) and da and isinstance(da[0], dict):
        vals.append(da[0].get("price"))
    return [float(v) for v in vals if _finite(v)]


def _row_span(row):
    """(start_t, end_t) of a row as ints, from the drawn stamp when present, else the row; or None."""
    r = row or {}
    ex = (r.get("geometry") or {}).get("extras") or {}
    for k in ("draw_flat_top", "draw_pivot"):
        v = ex.get(k)
        if isinstance(v, dict) and v.get("start_t") is not None and v.get("end_t") is not None:
            try:
                return int(v["start_t"]), int(v["end_t"])
            except (TypeError, ValueError):
                pass
    try:
        return int(r["start_t"]), int(r["end_t"])
    except (KeyError, TypeError, ValueError):
        return None


def _drawn_incumbent(row) -> bool:
    """True when the chart will actually DRAW this incumbent row: not stale, or a stale bull_flag
    the client redraws as the stamped "flagging" tier (PatternOverlay.selectDrawable / flaggingView).
    A stale row is served but never drawn, so it covers nothing and must not suppress a drawing."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    return not ex.get("stale") or _flagging_flag(row)


def member_base_precedence(detections, structures) -> list:
    """`structures` without the bc:base drawing when a member-served incumbent covers the same base.

    Applied on the MEMBER path only, after member_rows and the freshness filter. An incumbent is any
    row of BASE_INCUMBENT_IDS among `detections` or `structures`. It covers the base when one of its
    breakout / pivot prices is within BASE_PRECEDENCE_ATR ATR of the base pivot, OR its span overlaps
    the base's span. A stale incumbent (served, never drawn: `_drawn_incumbent`) covers nothing. Then bc:base is dropped and the incumbent stays: the base drawing is purely
    additive where nothing else covers the base. Fails closed: a base drawing without a finite ATR,
    or an incumbent whose span cannot be read, drops the base drawing. Order is kept; never raises."""
    try:
        sts = list(structures or [])
        bases = [s for s in sts if (s or {}).get("pattern_id") == BASE_DRAW_ID]
        if not bases:
            return sts
        inc = [r for r in list(detections or []) + sts
               if (r or {}).get("pattern_id") in BASE_INCUMBENT_IDS and _drawn_incumbent(r)]
        if not inc:
            return sts
        drop = set()
        for b in bases:
            bd = ((b.get("geometry") or {}).get("extras") or {}).get("draw_base") or {}
            at, piv = bd.get("atr"), bd.get("pivot")
            try:
                s0, e0 = int(bd["start_t"]), int(bd["end_t"])
            except (KeyError, TypeError, ValueError):
                drop.add(id(b))
                continue
            if not (_finite(at) and float(at) > 0 and _finite(piv)):
                drop.add(id(b))
                continue
            for r in inc:
                span = _row_span(r)
                near = any(abs(v - float(piv)) <= BASE_PRECEDENCE_ATR * float(at) for v in _row_levels(r))
                if near or span is None or (span[0] <= e0 and s0 <= span[1]):
                    drop.add(id(b))
                    break
        return [s for s in sts if id(s) not in drop]
    except Exception:  # noqa: BLE001 -- fail closed: no base drawing rather than a duplicate line
        return [s for s in (structures or []) if (s or {}).get("pattern_id") != BASE_DRAW_ID]


#: A bc:flat-base pivot within this many ATR(14) of a served cup's pivot is the same breakout line.
CUP_PRECEDENCE_ATR = 1.0
#: The member-served drawings a confirmed cup outranks (the cup is the blind-confirmed drawing).
CUP_PRECEDENCE_IDS = frozenset({"bc:flat-base"})


def member_cup_precedence(structures) -> list:
    """`structures` without a bc:flat-base row a served cup covers. Applied on the MEMBER path only,
    after member_rows (so every cup row here is a confirmed, stamped cup in its member form). A
    flat-base row is covered when one of its breakout / pivot prices is within CUP_PRECEDENCE_ATR
    ATR(14) of the cup's pivot (the ATR is the cup stamp's own), OR its span overlaps the cup's (lip to
    as-of). Then the flat base is dropped and the cup stays. Fails closed: a cup without a finite pivot,
    ATR or span, or a flat base whose span cannot be read, drops the flat base. Admin output never
    passes through here. Order is kept; never raises."""
    try:
        sts = list(structures or [])
        cups = [s for s in sts if (s or {}).get("pattern_id") == CUP_ID
                and isinstance(((s.get("geometry") or {}).get("extras") or {}).get("cup_tier"), dict)]
        if not cups:
            return sts
        drop = set()
        for c in cups:
            st = c["geometry"]["extras"]["cup_tier"]
            pv = st.get("pivot")
            piv = pv.get("price") if isinstance(pv, dict) else None
            at = st.get("atr")
            try:
                c0, c1 = int(st["lip_t"]), int(st["asof_t"])
            except (KeyError, TypeError, ValueError):
                c0 = c1 = None
            for r in sts:
                if (r or {}).get("pattern_id") not in CUP_PRECEDENCE_IDS:
                    continue
                if not (_finite(piv) and _finite(at) and float(at) > 0) or c0 is None:
                    drop.add(id(r))
                    continue
                span = _row_span(r)
                near = any(abs(v - float(piv)) <= CUP_PRECEDENCE_ATR * float(at) for v in _row_levels(r))
                if near or span is None or (span[0] <= c1 and c0 <= span[1]):
                    drop.add(id(r))
        return [s for s in sts if id(s) not in drop]
    except Exception:  # noqa: BLE001 -- fail closed: the cup alone rather than two breakout lines
        if any((s or {}).get("pattern_id") == CUP_ID for s in (structures or [])):
            return [s for s in (structures or []) if (s or {}).get("pattern_id") not in CUP_PRECEDENCE_IDS]
        return list(structures or [])


def _base_row(sym: str, d: dict, rnd: int) -> dict:
    """The bc:base structures row for drawing `d`, stamped with drawing round `rnd`."""
    sym = (sym or "").upper()
    return {
        "id": f"{BASE_DRAW_ID}:{sym}:{d['start_t']}:{d['end_t']}",
        "sym": sym,
        "tf": "D",
        "pattern_id": BASE_DRAW_ID,
        "pattern_name": "Base",
        "category": "base",
        "direction": "bullish",
        "start_t": d["start_t"],
        "end_t": d["end_t"],
        "geometry": {
            "shape": "base_draw",
            "anchors": [{"t": d["start_t"], "price": d["pivot"]}, {"t": d["end_t"], "price": d["low"]}],
            "extras": {"draw_base": d, "draw_round": rnd},
        },
        "levels": {"entry": d["pivot"]},
        "confidence": None,
        "status": "forming",
        **display_policy(BASE_DRAW_ID),
    }


def base_draw_row(sym: str, bars: list):
    """The bc:base row for the latest COMPLETE daily bar of `bars` ({t,o,h,l,c,v}, oldest first), or
    None when no base is drawn there. A forming session (auto_structures.last_bar_forming) is dropped
    first: the lab judged drawings at finished sessions. Display only. Never raises.

    While the drawing code (base_draw.BASE_DRAW_ROUND) is ahead of MEMBER_BASE_ROUND, the row is the
    current round's drawing and carries the member round's drawing of the same bars in
    `extras.draw_member` ({"round", "draw_base"}; draw_base None when that round draws nothing). When only
    the member round draws, the row's own `draw_base` is None (admin_base_rows drops it; a member is served
    the member round's row). When the rounds are equal there is no carrier."""
    try:
        from api.services.pattern_engine import base_draw
        b = list(bars or [])
        if b and last_bar_forming(b[-1]["t"]):
            b = b[:-1]
        if not b:
            return None
        cur_round = base_draw.BASE_DRAW_ROUND
        d = base_draw.base_drawing(b, len(b) - 1)
        if MEMBER_BASE_ROUND == cur_round:
            if d is None:
                # where no base is drawn: the base STATES (breakout persistence, 3 weeks tight, base forming)
                d = base_draw.state_drawing(b, len(b) - 1)
                # ... put through the same depth floor: a state drawn where round 5 refused the range must not
                # draw that range back (a price held flat after a gap reads as a base "forming")
                if d is not None and base_draw.floor_refuses(b, len(b) - 1, d):
                    d = None
            return _base_row(sym, d, cur_round) if d is not None else None
        m = base_draw.base_drawing(b, len(b) - 1, draw_round=MEMBER_BASE_ROUND)
        if d is None and m is None:
            return None
        row = _base_row(sym, d if d is not None else m, cur_round)
        row["geometry"]["extras"] = {"draw_base": d, "draw_round": cur_round,
                                     "draw_member": {"round": MEMBER_BASE_ROUND, "draw_base": m}}
        return row
    except Exception:  # noqa: BLE001 -- a drawing layer never breaks a read
        return None


#: The member base rows drawn by code other than base_draw (a base_catalog box, a detector, a shape drawer,
#: the shelf pivot): the base floor (base_draw.floor_refuses, round 5's removal-only guard) is applied to them
#: HERE, on the member path, so a dead or ultra-shallow range is not drawn as a base by ANY door (the shelf
#: pivot too: `_member_floor_ids`). bc:base is not listed: its drawing code (round 5) already applies the floor,
#: and base_draw_row applies it to the base STATE drawings; one guard is asked once per door.
MEMBER_FLOOR_IDS = frozenset({"bc:flat-base", "bc:cup-with-handle", "draw:double-bottom", "flat_base",
                              "uct_flat_top_breakout"})


def _member_floor_ids() -> frozenset:
    """MEMBER_FLOOR_IDS and the shelf pivot (SHELF_PIVOT_ID is declared further down this module)."""
    return MEMBER_FLOOR_IDS | {SHELF_PIVOT_ID}


def _floor_region(row):
    """(start_t, pivot) of a member base row: the row's own start and the pivot it draws (the drawn pivot line,
    flat top, shape pivot or shelf line; else the box top or the entry level). None when unreadable."""
    try:
        ex = (row.get("geometry") or {}).get("extras") or {}
        piv = None
        for key, field in (("draw_pivot", "price"), ("draw_flat_top", "price"), ("draw_shape", "pivot"),
                           ("draw_shelf", "price")):
            d = ex.get(key)
            if isinstance(d, dict) and _finite(d.get(field)):
                piv = float(d[field])
                break
        if piv is None:
            for v in (ex.get("top"), (row.get("levels") or {}).get("entry")):
                if _finite(v):
                    piv = float(v)
                    break
        if piv is None or row.get("start_t") is None:
            return None
        return int(row["start_t"]), piv
    except (TypeError, ValueError, AttributeError):
        return None


def member_base_floor(sym: str, detections, structures) -> tuple:
    """(detections, structures) without any `_member_floor_ids()` row whose drawn region the base floor refuses
    (base_draw.floor_refuses on the row's start, its drawn pivot and the region's lowest low through the newest
    complete session). Members only; order kept. The daily bars are read only when such a row is present.
    REMOVAL-ONLY and fail OPEN, as the floor itself: unreadable bars or an unreadable row keep the row."""
    ids = _member_floor_ids()
    det, st = list(detections or []), list(structures or [])
    if not any((r or {}).get("pattern_id") in ids for r in det + st):
        return det, st
    try:
        from api.services.pattern_engine import base_draw
        b = list(_daily_bars(sym) or [])
        if b and last_bar_forming(b[-1]["t"]):
            b = b[:-1]
        if not b:
            return det, st
        i = len(b) - 1
        ts = [int(x["t"]) for x in b]
    except Exception:  # noqa: BLE001 -- the floor is removal-only: no bars, nothing removed
        _log.warning("[auto-structures] floor read failed for %s; base rows kept", sym, exc_info=True)
        return det, st

    def refused(r):
        if (r or {}).get("pattern_id") not in ids:
            return False
        reg = _floor_region(r)
        if reg is None or reg[0] not in ts:
            return False
        s = ts.index(reg[0])
        if s >= i:
            return False
        low = min(float(x["l"]) for x in b[s:])
        if not reg[1] > low:
            return False        # a pivot at or under the region's own low is not a region this can read
        try:
            return base_draw.floor_refuses(b, i, {"start_t": reg[0], "pivot": reg[1], "low": low})
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            return False

    return [r for r in det if not refused(r)], [r for r in st if not refused(r)]


#: THE TEXTBOOK GATE (lab recert/A_bases round r2): the member base drawings re-certified 2026-10-24 on a strict
#: O'Neil / IBD rubric failed it on the same criteria -- bases under 5 weeks, no prior uptrend or a flat 200-day,
#: a pivot on a mid-base spike or a shelf under a higher peak, and price pins. A member row of these ids is drawn
#: only when its own region meets the textbook floors below. Removal only; members only.
TEXTBOOK_GATE_IDS = frozenset({BASE_DRAW_ID, "flat_base", "bc:flat-base"})
#: a base is at least 5 weeks (sessions from the region's first bar to its last bar)
TG_MIN_SESSIONS = 25
#: the region's high to its lowest low, as a fraction of the high (a flat base is shallow)
TG_MAX_DEPTH = 0.35
TG_MAX_DEPTH_FLAT = 0.15
#: the region's high sits on its LEFT side: within TG_LEFT_HIGH_ATR x ATR(14) of the high of its first
#: TG_LEFT_BARS sessions (not a mid-base spike), and no high in the TG_LEFT_CLEAR sessions before the region
#: is more than TG_LEFT_HIGH_ATR x ATR above it (not a shelf under a higher peak)
TG_LEFT_BARS = 5
TG_LEFT_HIGH_ATR = 0.5
TG_LEFT_CLEAR = 30
#: a prior advance of TG_MIN_ADV off the lowest low of the TG_ADV_WIN sessions before the region
TG_MIN_ADV = 0.25
TG_ADV_WIN = 126
#: the 200-day average rising at least TG_SMA_RISE over TG_SMA_RISE_BARS sessions, the close above it
TG_SMA_RISE = 0.005
#: a FORMING base: the right side is building -- the close above its 50-day average
TG_FORMING_SMA = 50
TG_SMA_RISE_BARS = 20


def _tg_region(row, ts):
    """(first, last) bar index of the region a member base row draws, or None. bc:base: draw_base.start_t to
    base_end_t (a breakout state's base) or the as-of bar; flat_base / bc:flat-base: the drawn pivot's start
    (else the first drawn anchor) to the as-of bar."""
    ex = (row.get("geometry") or {}).get("extras") or {}
    pid = row.get("pattern_id")
    end = len(ts) - 1
    if pid == BASE_DRAW_ID:
        bd = ex.get("draw_base") or {}
        st = bd.get("start_t")
        if bd.get("base_end_t") is not None and bd.get("state") in ("breakout", "extended"):
            if int(bd["base_end_t"]) in ts:
                end = ts.index(int(bd["base_end_t"]))
    else:
        pv = ex.get("draw_pivot")
        st = pv.get("start_t") if isinstance(pv, dict) else None
        if st is None:
            da = ex.get("draw_anchors") or (row.get("geometry") or {}).get("anchors") or []
            st = min((a.get("t") for a in da if isinstance(a, dict) and a.get("t") is not None), default=None)
    if st is None or int(st) not in ts:
        return None
    return ts.index(int(st)), end


def base_textbook_gate_fails(b, row):
    """The first textbook floor the member base row fails on daily bars `b` (completed sessions, the as-of bar
    last), or None when it meets them all. Reads b only. RAISES on an unreadable row (the caller keeps it)."""
    from api.services.pattern_engine import base_draw
    ts = [int(x["t"]) for x in b]
    i = len(b) - 1
    reg = _tg_region(row, ts)
    if reg is None:
        raise ValueError("region")
    s, e = reg
    if e - s < TG_MIN_SESSIONS:
        return "length"
    # the base's own bars: its last bar is the right edge, which may already be the breakout attempt
    hi = max(float(x["h"]) for x in b[s:e])
    lo = min(float(x["l"]) for x in b[s:i + 1])
    flat = row.get("pattern_id") != BASE_DRAW_ID
    if not hi > 0 or (hi - lo) / hi > (TG_MAX_DEPTH_FLAT if flat else TG_MAX_DEPTH):
        return "depth"
    a = base_draw._atr(b, i)
    if not a or a <= 0:
        raise ValueError("atr")
    left = max(float(x["h"]) for x in b[s:min(e - 1, s + TG_LEFT_BARS) + 1])
    if hi > left + TG_LEFT_HIGH_ATR * a:
        return "mid_base_high"
    l0 = max(0, s - TG_LEFT_CLEAR)
    if s > l0 and max(float(x["h"]) for x in b[l0:s]) > hi + TG_LEFT_HIGH_ATR * a:
        return "under_prior_peak"
    w0 = max(0, s - TG_ADV_WIN)
    if s - w0 < 2:
        return "advance"
    floor = min(float(x["l"]) for x in b[w0:s])
    if not floor > 0 or left / floor - 1.0 < TG_MIN_ADV:
        return "advance"
    n = base_draw.TREND_N
    if i - TG_SMA_RISE_BARS - n + 1 < 0:
        return "trend"
    s200 = sum(float(x["c"]) for x in b[i - n + 1:i + 1]) / n
    s200p = sum(float(x["c"]) for x in b[i - TG_SMA_RISE_BARS - n + 1:i - TG_SMA_RISE_BARS + 1]) / n
    if not (float(b[i]["c"]) > s200 and s200 >= s200p * (1.0 + TG_SMA_RISE)):
        return "trend"
    st = ((((row.get("geometry") or {}).get("extras") or {}).get("draw_base")) or {}).get("state")
    if row.get("pattern_id") == BASE_DRAW_ID and st == "forming":
        why = _textbook_base_floors(b, s, e, i, hi, a)
        if why is not None:
            return why
        if float(b[i]["c"]) < hi * (1.0 - TG3_FORMING_BELOW):
            return "forming_too_far_below"
    if st == "forming":
        m = TG_FORMING_SMA
        if i + 1 < m or not float(b[i]["c"]) > sum(float(x["c"]) for x in b[i - m + 1:i + 1]) / m:
            return "forming_under_50"
    from api.services import deal_status
    if deal_status.price_pinned(b) is not None:
        return "pinned"
    return None


#: THE FORMING BASE'S OWN FLOORS (lab recert/A_bases round r3, PASSED 2026-10-24: packets A 2.48, B 2.70, C 2.52,
#: D 2.42, pooled 2.53 [2.41, 2.65]): the "Base forming" state failed its r2 packets (pooled 2.33) on a line on a
#: one-day spike, a shelf under an older higher peak, a short shelf straight after a parabolic run, a flat or barely
#: turning 200-day and a right side drifting well under the pivot, so it also needs a REAL ceiling, a real stage-2
#: uptrend and a right side within TG3_FORMING_BELOW of the pivot. The breakout states keep r2's gate unchanged
#: (they passed it). The stateless base took the same floors in r3 (plus a lone-high floor) and still failed; it is
#: withheld from members (MEMBER_BASE_STATELESS_ROUND) and keeps r2's gate only.
TG3_WICK_ATR = 0.6          # the region's high at most this many ATR(14) above its highest candle body
TG3_PRIOR_BARS = 120        # no high in the 120 sessions before the region above its high x (1 + 3%)
TG3_PRIOR_PCT = 0.03
TG3_PARA_BARS = 30          # a region shorter than TG3_PARA_MAX_LEN whose left-side high is > 60% above the
TG3_PARA_RUN = 0.60         # lowest low of the 30 sessions before it is the top of a run, not a base
TG3_PARA_MAX_LEN = 35
TG3_MIN_ADV = 0.30          # O'Neil's ~30% prior advance
TG3_SMA_RISE = 0.01         # the 200-day up >= 1% over 20 sessions ...
TG3_SMA_RISE_LONG = 60      # ... and above where it stood 60 sessions earlier
#: a FORMING base (r3, from its r2 packets): the right side within 12% of the pivot, not drifting near the low
TG3_FORMING_BELOW = 0.12


def _textbook_base_floors(b, s, e, i, hi, a):
    """The first r3 floor a forming base fails, or None. `s`/`e` the region, `hi` its high (last bar excluded). No
    lone-high floor: a forming base's left-side high stands above its unfinished right side by construction, so its
    highest high is ALWAYS alone; its spike test is the wick floor."""
    body = max(max(float(x["o"]), float(x["c"])) for x in b[s:e])
    if hi - body > TG3_WICK_ATR * a:
        return "spike_wick"
    p0 = max(0, s - TG3_PRIOR_BARS)
    if s > p0 and max(float(x["h"]) for x in b[p0:s]) > hi * (1.0 + TG3_PRIOR_PCT):
        return "older_higher_peak"
    r0 = max(0, s - TG3_PARA_BARS)
    floor = min(float(x["l"]) for x in b[r0:s + 1])
    if floor > 0 and float(b[s]["h"]) / floor - 1.0 > TG3_PARA_RUN and e - s < TG3_PARA_MAX_LEN:
        return "after_parabolic_run"
    w0 = max(0, s - TG_ADV_WIN)
    lo = min(float(x["l"]) for x in b[w0:s]) if s - w0 >= 2 else 0.0
    left = max(float(x["h"]) for x in b[s:min(e - 1, s + TG_LEFT_BARS) + 1])
    if not lo > 0 or left / lo - 1.0 < TG3_MIN_ADV:
        return "advance"
    from api.services.pattern_engine import base_draw
    n = base_draw.TREND_N
    if i - TG3_SMA_RISE_LONG - n + 1 < 0:
        return "trend"

    def sma(k):
        return sum(float(x["c"]) for x in b[k - n + 1:k + 1]) / n
    if not (sma(i) >= sma(i - TG_SMA_RISE_BARS) * (1.0 + TG3_SMA_RISE) and sma(i) > sma(i - TG3_SMA_RISE_LONG)):
        return "trend"
    return None


def member_base_textbook_gate(sym: str, detections, structures) -> tuple:
    """(detections, structures) without any TEXTBOOK_GATE_IDS row that fails a textbook floor
    (`base_textbook_gate_fails`). A bc:base row is gated only when it carries a base STATE (breakout / extended /
    forming): the stateless base is withheld from members by its own literal, so a re-release starts from the
    drawing its judged cases record, with this gate re-decided by that release's round. Members only; order kept; the daily bars are read only when such a row is present,
    at the last COMPLETE session. Removal only and fail OPEN: unreadable bars or an unreadable row keep the row."""
    det, st = list(detections or []), list(structures or [])
    if not any((r or {}).get("pattern_id") in TEXTBOOK_GATE_IDS for r in det + st):
        return det, st
    try:
        b = list(_daily_bars(sym) or [])
        if b and last_bar_forming(b[-1]["t"]):
            b = b[:-1]
        if not b:
            return det, st
    except Exception:  # noqa: BLE001 -- removal-only: no bars, nothing removed
        _log.warning("[auto-structures] textbook gate read failed for %s; base rows kept", sym, exc_info=True)
        return det, st

    def fails(r):
        if (r or {}).get("pattern_id") not in TEXTBOOK_GATE_IDS:
            return False
        if (r or {}).get("pattern_id") == BASE_DRAW_ID and not _is_base_state_row(r):
            return False    # the stateless base is withheld (MEMBER_BASE_STATELESS_ROUND), never gated here
        try:
            return base_textbook_gate_fails(b, r) is not None
        except Exception:  # noqa: BLE001 -- an unreadable row is kept, as the floor keeps it
            return False

    return [r for r in det if not fails(r)], [r for r in st if not fails(r)]


def shapes_enabled() -> bool:
    """Read PER CALL. AUTO_STRUCTURES_SHAPES_ENABLED (default OFF): when on, structures_for appends the named
    base-shape drawing rows (shape_draw_rows). Off, structures_for is byte-identical to the code before them.
    The rows are admin-only either way until a MEMBER_<SHAPE>_ROUND literal is set (member_rows)."""
    return os.environ.get("AUTO_STRUCTURES_SHAPES_ENABLED", "0").strip().lower() in _TRUTHY


#: Shape id -> (shape_draw function name, display name).
_SHAPE_FUNCS = (
    ("draw:saucer", "saucer_drawing", "Saucer"),
    ("draw:ascending-base", "ascending_base_drawing", "Ascending base"),
    ("draw:double-bottom", "double_bottom_drawing", "Double bottom"),
    ("draw:ipo-base", "ipo_base_drawing", "IPO base"),
)


#: A double bottom whose first close above its pivot (after the second low) came MORE than this many sessions
#: before the drawn bar is an old W that price already left: the row is marked stale (served, never drawn).
DB_BREAKOUT_MAX_AGE = 5


def _db_breakout_stale(bars, d) -> bool:
    """True when the double-bottom drawing `d` over `bars` (the drawn bars, oldest first, the last one the
    drawn bar) should be withheld as stale: the first close above `d["pivot"]` after the second-low mark came
    more than DB_BREAKOUT_MAX_AGE sessions before the last bar. No close above the pivot yet is not stale.
    Fails closed: a missing / unreadable second-low mark or pivot, or a second low not found among `bars`,
    is stale. Never raises."""
    try:
        piv = d.get("pivot")
        if not _finite(piv):
            return True
        low2 = [m for m in (d.get("marks") or []) if isinstance(m, dict) and m.get("kind") == "low2"]
        if len(low2) != 1 or low2[0].get("t") is None:
            return True
        t2 = int(low2[0]["t"])
        ts = [int(x["t"]) for x in bars]
        if t2 not in ts:
            return True
        last = len(bars) - 1
        for k in range(ts.index(t2) + 1, len(bars)):
            if float(bars[k]["c"]) > float(piv):
                return last - k > DB_BREAKOUT_MAX_AGE
        return False
    except Exception:  # noqa: BLE001 -- fail closed: an unreadable drawing is withheld
        return True


def shape_draw_rows(sym: str, bars: list) -> list:
    """The named base-shape drawing rows for the latest COMPLETE daily bar of `bars` ({t,o,h,l,c,v}, oldest
    first): one row per shape whose drawing fires there (lab base_shapes; display only). A forming session
    (last_bar_forming) is dropped first: the lab drew finished sessions. The IPO base needs the series' first
    stored bar: `bars` is the store's latest STRUCTURE_BARS, so it reaches back to the first stored bar only
    when it holds fewer than that -- otherwise the ticker is too old to be a recent listing and no IPO base is
    attempted. A double bottom whose breakout is older than DB_BREAKOUT_MAX_AGE sessions is marked
    `extras.stale` (`_db_breakout_stale`): served, never drawn. A failing shape costs that shape only.
    Never raises."""
    out = []
    try:
        from api.services.pattern_engine import shape_draw
        b = list(bars or [])
        first_t = int(b[0]["t"]) if b and len(b) < STRUCTURE_BARS else None
        if b and last_bar_forming(b[-1]["t"]):
            b = b[:-1]
        if not b:
            return []
        sym = (sym or "").upper()
        # while the rare-pattern preview is on it OWNS the saucer and IPO base rows (one row per shape on a
        # chart, at the preview's round); off, this loop is exactly what it was
        skip = RARE_SHAPE_OWNED if rare_preview_enabled() else ()
        for pid, fn, name in _SHAPE_FUNCS:
            if pid in skip:
                continue
            try:
                if pid == "draw:ipo-base":
                    if first_t is None:
                        continue
                    d = shape_draw.ipo_base_drawing(b, len(b) - 1, first_t=first_t)
                else:
                    d = getattr(shape_draw, fn)(b, len(b) - 1)
            except Exception:  # noqa: BLE001 -- a failing shape costs that shape only
                _log.debug("[auto-structures] %s %s failed", sym, pid, exc_info=True)
                continue
            if d is None:
                continue
            extras = {"draw_shape": d, "draw_round": d["draw_round"]}
            if pid == "draw:double-bottom" and _db_breakout_stale(b, d):
                extras["stale"] = True
                extras["stale_reason"] = "breakout_age"
            out.append({
                "id": f"{pid}:{sym}:{d['start_t']}:{d['end_t']}",
                "sym": sym,
                "tf": "D",
                "pattern_id": pid,
                "pattern_name": name,
                "category": "base",
                "direction": "bullish",
                "start_t": d["start_t"],
                "end_t": d["end_t"],
                "geometry": {
                    "shape": "shape_draw",
                    "anchors": [{"t": d["start_t"], "price": d["pivot"]}, {"t": d["end_t"], "price": d["low"]}],
                    "extras": extras,
                },
                "levels": {"entry": d["pivot"]},
                "confidence": None,
                "status": "forming",
                **display_policy(pid),
            })
    except Exception:  # noqa: BLE001 -- a drawing layer never breaks a read
        return []
    return out


# ================================================================ rare-pattern admin preview (dark)
def rare_preview_enabled() -> bool:
    """AUTO_STRUCTURES_RARE_PREVIEW_ENABLED, read PER CALL; unset means OFF. While on, structures_for appends
    the rare-pattern preview rows (rare_preview_rows) and the daily universe scan records every instance for
    the owner's approve / reject flow (api/services/rare_preview.py). Off, nothing below runs: structures_for,
    shape_draw_rows and the scan are byte-identical to before. The rows are ADMIN-ONLY either way: their ids are
    in neither registry display set and their member literals are None, so member_rows drops every one."""
    return os.environ.get("AUTO_STRUCTURES_RARE_PREVIEW_ENABLED", "0").strip().lower() in _TRUTHY


#: The preview's row ids, in the order rows are built. Patterns rare enough that blind 2 x 25 rounds cannot be
#: filled from the held-out pool; they go to the owner one live instance at a time instead.
RARE_PREVIEW_IDS = ("draw:cup-no-handle", "draw:htf", "draw:ipo-base", "draw:saucer")
#: The SHAPE_DRAW_IDS rows the preview takes over from shape_draw_rows while it is on.
RARE_SHAPE_OWNED = ("draw:ipo-base", "draw:saucer")
#: Display names, one per preview id.
RARE_PREVIEW_NAMES = {"draw:cup-no-handle": "Cup without handle", "draw:htf": "High tight flag",
                      "draw:ipo-base": "IPO base", "draw:saucer": "Saucer"}
#: The base-low label per preview id (the high tight flag's low is the flag's low, not a base low).
_RARE_LOW_LABELS = {"draw:htf": "flag low"}

#: The IPO base's backfill guard counts first stored dates over tickers whose first daily bar is on/after this
#: date (a listing is recent by definition).
IPO_FIRST_DATES_SINCE = 20190101
#: How long one census of first stored dates is reused.
IPO_FIRST_DATES_TTL_S = 6 * 3600
_ipo_first_dates = {"at": 0.0, "by_date": None}
_ipo_first_dates_lock = threading.Lock()


def _ipo_first_t_shared(first_t):
    """How many tickers in the bars store have their first stored daily bar on `first_t` (this series
    included), or None when the census cannot be read. A date shared by many tickers is a store backfill
    boundary, not a listing day (base_catalog.ipo_listing_is_backfill); None makes the IPO base drawing withhold
    (fail closed). One indexed query per IPO_FIRST_DATES_TTL_S. Never raises."""
    try:
        with _ipo_first_dates_lock:
            now = time.time()
            if _ipo_first_dates["by_date"] is None or now - _ipo_first_dates["at"] > IPO_FIRST_DATES_TTL_S:
                from collections import Counter
                from api.services import bars_sqlite
                firsts = bars_sqlite.recent_first_trade(IPO_FIRST_DATES_SINCE) or {}
                _ipo_first_dates["by_date"] = Counter(int(v) for v in firsts.values())
                _ipo_first_dates["at"] = now
            got = _ipo_first_dates["by_date"].get(int(first_t))
        return int(got) if got else None
    except Exception:  # noqa: BLE001 -- unknown fails closed in the drawing
        _log.debug("[auto-structures] first-date census failed", exc_info=True)
        return None


def rare_preview_drawings(bars: list, first_t=None) -> list:
    """[(pattern_id, drawing)] for every preview shape that fires on the LAST bar of `bars` ({t,o,h,l,c,v},
    oldest first; the caller has already dropped a forming session). Each drawing carries `buy_point` (the
    ceiling bar's high + $0.10, textbook_numbers.buy_point) and `label` "Buy point <price>". `first_t` is the
    series' first stored bar, or None when the series is too long to be a recent listing (no IPO base then).
    Reads only `bars`. A failing shape costs that shape only. Never raises."""
    out = []
    try:
        from api.services import textbook_numbers
        from api.services.pattern_engine import rare_draw, shape_draw
        b = list(bars or [])
        if not b:
            return []
        i = len(b) - 1
        for pid in RARE_PREVIEW_IDS:
            try:
                if pid == "draw:cup-no-handle":
                    d = rare_draw.cup_no_handle_drawing(b, i)
                elif pid == "draw:htf":
                    d = rare_draw.high_tight_flag_drawing(b, i)
                elif pid == "draw:ipo-base":
                    if first_t is None:
                        continue
                    d = shape_draw.ipo_base_drawing(b, i, first_t=first_t, rnd=shape_draw.IPO_PREVIEW_ROUND,
                                                    first_t_shared=_ipo_first_t_shared(first_t))
                else:
                    d = shape_draw.saucer_drawing(b, i)
            except Exception:  # noqa: BLE001 -- a failing shape costs that shape only
                _log.debug("[auto-structures] rare preview %s failed", pid, exc_info=True)
                continue
            if d is None:
                continue
            d = dict(d)
            if pid in ("draw:ipo-base", "draw:saucer"):
                # these drawings already withhold a spike top / lip, so their pivot IS the ceiling high
                d["buy_point"] = textbook_numbers.buy_point(d["pivot"])
                d["pivot"] = d["buy_point"]
                d["buy_label"] = "%s · Buy point %.2f" % (RARE_PREVIEW_NAMES[pid], d["buy_point"])
            if not _finite(d.get("buy_point")):
                continue
            d["label"] = "Buy point %.2f" % float(d["buy_point"])
            d["low_label"] = _RARE_LOW_LABELS.get(pid, d.get("low_label") or "base low")
            out.append((pid, d))
    except Exception:  # noqa: BLE001 -- a drawing layer never breaks a read
        return []
    return out


def rare_preview_rows(sym: str, bars: list) -> list:
    """The rare-pattern preview rows for the latest COMPLETE daily bar of `bars` ({t,o,h,l,c,v}, oldest first):
    one ADMIN-ONLY row per preview shape that fires there (`rare_preview_drawings`). A forming session
    (last_bar_forming) is dropped first. The IPO base needs the series' first stored bar, which `bars` (the
    store's latest STRUCTURE_BARS) reaches only when it holds fewer than that. Each row's `levels.entry` is the
    buy point. Never raises."""
    try:
        b = list(bars or [])
        first_t = int(b[0]["t"]) if b and len(b) < STRUCTURE_BARS else None
        if b and last_bar_forming(b[-1]["t"]):
            b = b[:-1]
        if not b:
            return []
        sym = (sym or "").upper()
        out = []
        for pid, d in rare_preview_drawings(b, first_t=first_t):
            out.append({
                "id": f"{pid}:{sym}:{d['start_t']}:{d['end_t']}",
                "sym": sym,
                "tf": "D",
                "pattern_id": pid,
                "pattern_name": RARE_PREVIEW_NAMES[pid],
                "category": "base",
                "direction": "bullish",
                "start_t": d["start_t"],
                "end_t": d["end_t"],
                "geometry": {
                    "shape": "shape_draw",
                    "anchors": [{"t": d["start_t"], "price": d["pivot"]}, {"t": d["end_t"], "price": d["low"]}],
                    "extras": {"draw_shape": d, "draw_round": d["draw_round"], "rare_preview": True},
                },
                "levels": {"entry": d["buy_point"]},
                "confidence": None,
                "status": "forming",
                **display_policy(pid),
            })
        return out
    except Exception:  # noqa: BLE001 -- a drawing layer never breaks a read
        return []


def inside_day_draw_row(sym: str, bars: list):
    """The inside-day drawing row for the latest COMPLETE daily bar of `bars` ({t,o,h,l,c,v}, oldest
    first), or None when no inside day is drawn there. A last bar that is not a COMPLETED session
    (last_bar_complete) is dropped first: the lab judged drawings at finished sessions. This FAILS
    CLOSED: an unknown or failing session clock drops the last bar too, because a half-formed session
    can read as an inside day (its range is still narrow) and would otherwise be drawn as a finished
    one. Display only. Never raises."""
    try:
        from api.services.pattern_engine import inside_day_draw
        b = list(bars or [])
        if b and not last_bar_complete(b[-1]["t"]):
            b = b[:-1]
        if not b:
            return None
        d = inside_day_draw.inside_day_drawing(b, len(b) - 1)
        if d is None:
            return None
        sym = (sym or "").upper()
        return {
            "id": f"{INSIDE_DAY_DRAW_ID}:{sym}:{d['inside_t']}:{d['end_t']}",
            "sym": sym,
            "tf": "D",
            "pattern_id": INSIDE_DAY_DRAW_ID,
            "pattern_name": "Inside day",
            "category": "uct",
            "direction": "bullish",
            "start_t": d["start_t"],
            "end_t": d["end_t"],
            "geometry": {
                "shape": "inside_day_draw",
                "anchors": [{"t": d["start_t"], "price": d["mother_high"]},
                            {"t": d["inside_t"], "price": d["mother_low"]}],
                "extras": {"draw_inside_day": d, "draw_round": inside_day_draw.ID_DRAW_ROUND},
            },
            "levels": {"entry": d["trigger"], "stop": d["stop"]},
            "confidence": None,
            "status": "forming",
            **display_policy(INSIDE_DAY_DRAW_ID),
        }
    except Exception:  # noqa: BLE001 -- a drawing layer never breaks a read
        return None


#: Member-served drawings whose own breakout / entry line can sit where the inside day's trigger
#: is. Where one does, a member gets the incumbent (already shipped) and NOT the inside-day drawing,
#: so a chart never shows two different breakout lines a hair apart.
INSIDE_DAY_INCUMBENT_IDS = BASE_INCUMBENT_IDS | frozenset({BASE_DRAW_ID, "bull_flag"})
#: An incumbent breakout / entry level within this many ATR(14) of the trigger is the same line.
INSIDE_DAY_PRECEDENCE_ATR = 1.0


def member_inside_day_precedence(detections, structures, tf="D") -> list:
    """`structures` without the inside-day drawing where a member should not get it.

    Applied on the MEMBER path only, after member_rows, the freshness filter and the base
    precedence. The drawing is dropped (1) on any timeframe but daily -- it was judged on a daily
    chart and its bars are daily sessions -- and (2) when an incumbent row (INSIDE_DAY_INCUMBENT_IDS,
    among `detections` or `structures`) carries a breakout / entry level within
    INSIDE_DAY_PRECEDENCE_ATR ATR of the trigger; a stale incumbent (never drawn) covers nothing. Span overlap is NOT a cover: the inside-day box is
    the last two or three sessions and sits inside nearly every base. Fails closed: a drawing
    without a finite trigger and ATR is dropped. Order is kept; never raises."""
    try:
        sts = list(structures or [])
        ids = [s for s in sts if (s or {}).get("pattern_id") == INSIDE_DAY_DRAW_ID]
        if not ids:
            return sts
        if (tf or "D").upper() != "D":
            return [s for s in sts if (s or {}).get("pattern_id") != INSIDE_DAY_DRAW_ID]
        inc = [r for r in list(detections or []) + sts
               if (r or {}).get("pattern_id") in INSIDE_DAY_INCUMBENT_IDS and _drawn_incumbent(r)
               and not _is_base_state_row(r)]
        drop = set()
        for s in ids:
            d = ((s.get("geometry") or {}).get("extras") or {}).get("draw_inside_day") or {}
            at, trig = d.get("atr"), d.get("trigger")
            if not (_finite(at) and float(at) > 0 and _finite(trig)):
                drop.add(id(s))
                continue
            for r in inc:
                if any(abs(v - float(trig)) <= INSIDE_DAY_PRECEDENCE_ATR * float(at) for v in _row_levels(r)):
                    drop.add(id(s))
                    break
        return [s for s in sts if id(s) not in drop]
    except Exception:  # noqa: BLE001 -- fail closed: no inside-day drawing rather than a duplicate line
        return [s for s in (structures or []) if (s or {}).get("pattern_id") != INSIDE_DAY_DRAW_ID]


#: The textbook gate round the strict blind recert confirmed for the inside-day drawing (lab recert B round 2:
#: four pre-registered packets of 25, two fresh judges each, strict textbook rubric). A literal ON PURPOSE, like
#: MEMBER_INSIDE_DAY_ROUND: it must equal textbook_gate.INSIDE_DAY_GATE_ROUND or every inside-day row is withheld
#: (fail closed). None turns the gate off (the drawing as it was before the recert), which is NOT the hide lever:
#: hiding the drawing is MEMBER_INSIDE_DAY_ROUND = None.
MEMBER_INSIDE_DAY_GATE_ROUND = 1
#: The INTERIM textbook gate round for the flat top, the shelf pivot and the double bottom (coordinator ruling
#: 2026-10-24, recert B): each failed the strict blind round 1 as served (pooled 2.01 / 1.57 / 2.005); with this gate
#: the report-only blind packets scored 2.46 / 2.52 / 2.55. Removal-only, fail closed, like the inside-day gate:
#: it must equal textbook_gate.PIVOT_GATE_ROUND or every row of the three ids is withheld; None turns it off.
#: Hiding a drawing is its own member literal (MEMBER_FLAT_TOP_ROUND / MEMBER_SHELF_PIVOT_ROUND /
#: MEMBER_DOUBLE_BOTTOM_ROUND = None), not this one.
MEMBER_PIVOT_GATE_ROUND = 1


def _textbook_gates():
    """{pattern id: (member literal, the module's round, the failing-rules function)} for every gated id."""
    from api.services.pattern_engine import textbook_gate as tg
    out = {INSIDE_DAY_DRAW_ID: (MEMBER_INSIDE_DAY_GATE_ROUND, tg.INSIDE_DAY_GATE_ROUND, tg.inside_day_fails)}
    for pid in tg.PIVOT_GATE_IDS:
        out[pid] = (MEMBER_PIVOT_GATE_ROUND, tg.PIVOT_GATE_ROUND, tg.pivot_fails)
    return out


def member_textbook_gate(sym: str, detections, structures) -> tuple:
    """(detections, structures) without any gated drawing the strict textbook gate withholds
    (pattern_engine.textbook_gate: the inside day, and -- as interim guards -- the flat top, the shelf pivot and
    the double bottom). Applied on the MEMBER path LAST, after every precedence pass and the shelf, so the member
    chart is the served chart minus the withheld rows -- exactly what the blind rounds judged. The daily bars are
    read only when a gated row is present, at the last COMPLETE session, and each row is judged on the bars ending
    at its own drawing's end_t. A gate whose literal is None is off; a literal that disagrees with the module's
    round withholds every row of its ids. Fails CLOSED: unreadable bars, a short history or a malformed row
    withhold the drawing. Order is kept; never raises."""
    det, st = list(detections or []), list(structures or [])
    try:
        gates = _textbook_gates()
    except Exception:  # noqa: BLE001 -- no gate module: withhold every gated row rather than serve it unchecked
        _log.warning("[auto-structures] textbook gate unavailable for %s", sym, exc_info=True)
        return ([r for r in det if (r or {}).get("pattern_id") not in _TEXTBOOK_GATED_IDS],
                [r for r in st if (r or {}).get("pattern_id") not in _TEXTBOOK_GATED_IDS])
    live = {pid: g for pid, g in gates.items() if g[0] is not None}
    present = {(r or {}).get("pattern_id") for r in det + st} & set(live)
    if not present:
        return det, st
    drop_all = ([r for r in det if (r or {}).get("pattern_id") not in present],
                [r for r in st if (r or {}).get("pattern_id") not in present])
    try:
        from api.services.pattern_engine import textbook_gate
        b = list(_daily_bars(sym) or [])
        if b and last_bar_forming(b[-1]["t"]):
            b = b[:-1]
        bars = [{"t": x["t"], "o": float(x["o"]), "h": float(x["h"]), "l": float(x["l"]), "c": float(x["c"]),
                 "v": float(x.get("v") or 0)} for x in b]
        ts = [int(x["t"]) for x in bars]

        def keep(r):
            pid = (r or {}).get("pattern_id")
            if pid not in present:
                return True
            want, rnd, fails = live[pid]
            if not (type(want) is int and want == rnd):
                return False
            end = textbook_gate.end_of(r)
            if end is None or end not in ts:
                return False
            return not fails(bars[:ts.index(end) + 1], r)
        return [r for r in det if keep(r)], [r for r in st if keep(r)]
    except Exception:  # noqa: BLE001 -- fail closed: an unverified drawing is not drawn
        _log.warning("[auto-structures] textbook gate failed for %s; gated rows withheld", sym, exc_info=True)
        return drop_all


#: The ids the textbook gate can withhold (the fallback when the gate module itself cannot be imported).
_TEXTBOOK_GATED_IDS = frozenset({"draw:inside-day", "uct_flat_top_breakout", "draw:shelf-pivot",
                                 "draw:double-bottom"})


#: ONE BREAKOUT LINE PER BASE, across every row a member's chart draws (detections AND structures).
#: The pairwise passes above each settle one pair of drawings; this pass closes the rest: the detector rows
#: (flat_base, bull_flag, uct_flat_top_breakout) against each other and against the base boxes and the
#: named shapes. Where two drawn rows of different ids put breakout lines within ONE_LINE_PER_BASE_ATR ATR
#: of each other over overlapping spans, they are one base drawn twice, and the member keeps exactly one:
#: the row that comes FIRST in this order. The order, and why (blind-judged scores, two pre-registered packets each, as drawn,
#: on the 1-3 scale):
#:   1. bc:cup-with-handle    -- a whole-base drawing (pivot, handle, rim reference): 2.42 / 2.50. It already
#:                               outranks bc:flat-base (member_cup_precedence) and bc:base.
#:   2. draw:double-bottom    -- a whole-base drawing (region, both lows, pivot): 2.46 / 2.32. It already
#:                               outranks bc:base. Below the cup: lower on the weaker packet (2.32 < 2.42).
#:   3. uct_flat_top_breakout -- the "flat top" ceiling with its touches: 2.60 / 2.57, the best-scoring
#:                               line-only drawing. Below the two shapes because a line names only the
#:                               base's ceiling, while a shape also names its extent and its low.
#:   4. bc:flat-base          -- the base box's pivot line (box off): 2.40 / 2.30.
#:   5. flat_base             -- the flat-base detector's drawing of the SAME base as bc:flat-base (the two
#:                               duplicate to the cent). It passed inside the team-set packets with no
#:                               per-type score on record, so the type with two recorded packets wins.
#:   6. bc:base               -- scores best of all (2.76 / 2.78) but is the additive drawing: it already
#:                               yields to every drawing above (member_base_precedence, a wider cover rule),
#:                               so here it can only meet a bull_flag, which it outranks on score.
#:   7. bull_flag             -- the flag's entry (2.43 / 2.40) is a continuation trigger at the top of the
#:                               base. Where it sits on the base's own breakout line, the base's line is the
#:                               one that names the base, so the flag yields to every drawing above.
#:   8. draw:donchian_breakout -- the 55-bar channel high (a `setup_draws` row, settled by
#:                               member_setup_one_line_per_base). Its line lands on a base's ceiling by
#:                               construction; a blind paired round (2026-10-24, precedence round e) found no
#:                               clear winner against the base drawings, so the base drawing already shown
#:                               stays and the channel line shows only where no line above it is within 1 ATR.
#:   9. draw:rectangle         -- the trading-range box (a `setup_draws` row, settled by
#:                               member_setup_one_line_per_base); its breakout line is the box TOP. Judged
#:                               alone (2.44 / 2.76) with no paired round against any drawing above, and on a
#:                               lower packet than the channel line (2.70 / 2.80), so it ranks last: the box
#:                               is shown only where no drawn breakout line above it sits within 1 ATR of its
#:                               top over an overlapping span.
#: Rows of any other id (the MA pullback's curve and stop; the inside day, settled by its own pass; the
#: shelf pivot, drawn only on an otherwise empty chart) are never touched here. Ties: the earlier row.
DONCHIAN_DRAW_ID = "draw:donchian_breakout"
#: The rectangle (horizontal trading range) setup drawing (api/services/pattern_engine/setup_draw_rectangle.py).
RECTANGLE_DRAW_ID = "draw:rectangle"
ONE_LINE_PER_BASE_PRIORITY = ("bc:cup-with-handle", "draw:double-bottom", "uct_flat_top_breakout",
                              "bc:flat-base", "flat_base", BASE_DRAW_ID, "bull_flag", DONCHIAN_DRAW_ID,
                              RECTANGLE_DRAW_ID)
#: Two breakout lines within this many ATR(14) of each other, over overlapping spans, are one line.
ONE_LINE_PER_BASE_ATR = 1.0
#: With no ATR to be had at all, two lines this close (one cent, plus float noise) are one line.
ONE_LINE_PER_BASE_CENT = 0.01 + 1e-9


def _stamped_atr(rows):
    """The widest finite, positive ATR any of `rows` carries in its own drawing stamp (a bc:base, a named
    shape, the cup tier), or None."""
    vals = []
    for r in rows:
        ex = ((r or {}).get("geometry") or {}).get("extras") or {}
        for k in ("draw_base", "draw_shape", "cup_tier"):
            d = ex.get(k)
            if isinstance(d, dict) and _finite(d.get("atr")) and float(d["atr"]) > 0:
                vals.append(float(d["atr"]))
    return max(vals) if vals else None


def _drawn_base_top(draw_base, textbook):
    """The price the member's chart draws a bc:base top line at, as PatternOverlay.baseDrawing picks it: the
    textbook round's `metrics_textbook.line` (buy point - $0.10) when it and the buy point are finite numbers with
    low < line < buy point, else `draw_base.pivot` (the body). A member row carries `metrics_textbook` only while
    its round is released (with_metrics strips it otherwise), so reading it here reads what is drawn."""
    def num(v):
        if isinstance(v, bool) or v is None:
            return None
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        return f if _finite(f) else None

    if isinstance(textbook, dict):
        line, bp, low = num(textbook.get("line")), num(textbook.get("buy_point")), num(draw_base.get("low"))
        if line is not None and bp is not None and low is not None and low < line < bp:
            return line
    return draw_base.get("pivot")


def _breakout_lines(row) -> list:
    """[(price, start_t, end_t)] -- every BREAKOUT line (pivot / entry / ceiling / box top) the member's chart
    draws for `row`, as PatternOverlay.rowView draws it: a bc:base top line (_drawn_base_top) or a named-shape
    pivot, the flat-top
    ceiling, a box's `draw_pivot`, a detector's drawn entry (`draw_entry`; never for the "flagging" tier)
    and `draw_pivot`, and a flat_base box top while the box draws. A rim reference, a low or a stop is not
    a breakout line. A line without a finite price and a readable span draws nothing and is not listed."""
    r = row or {}
    pid = r.get("pattern_id")
    g = r.get("geometry") or {}
    ex = g.get("extras") or {}
    out = []

    def add(p, s, e):
        if _finite(p):
            try:
                out.append((float(p), int(s), int(e)))
            except (TypeError, ValueError):
                pass

    def stamp(key, price_key):
        d = ex.get(key)
        if isinstance(d, dict):
            add(d.get(price_key), d.get("start_t"), d.get("end_t"))

    def box_top(a, b, price):
        try:
            add(price, min(int(a["t"]), int(b["t"])), max(int(a["t"]), int(b["t"])))
        except (KeyError, TypeError, ValueError):
            pass

    if pid == BASE_DRAW_ID:
        d = ex.get("draw_base")
        if isinstance(d, dict):
            add(_drawn_base_top(d, ex.get("metrics_textbook")), d.get("start_t"), d.get("end_t"))
    elif pid in SHAPE_DRAW_IDS:
        stamp("draw_shape", "pivot")
    elif pid == "uct_flat_top_breakout":
        stamp("draw_flat_top", "price")
    elif pid in ("bc:flat-base", CUP_ID):
        stamp("draw_pivot", "price")
    elif pid == DONCHIAN_DRAW_ID:
        # HorizontalLine.jsx: one line at the mean of the first two anchors; its span is the row's (channel high
        # bar to the as-of bar)
        an = g.get("anchors")
        if isinstance(an, list) and an and all(isinstance(x, dict) for x in an[:2]):
            ps = [x.get("price") for x in an[:2]]
            if all(_finite(v) for v in ps):
                add(sum(float(v) for v in ps) / len(ps), r.get("start_t"), r.get("end_t"))
    elif pid == RECTANGLE_DRAW_ID:
        # PatternOverlay draws the box from its two anchors; its breakout line is the top edge (the first
        # anchor's price) over the box's span (the first anchor's bar to the as-of bar)
        an = g.get("anchors")
        if isinstance(an, list) and len(an) >= 2 and all(isinstance(x, dict) for x in an[:2]):
            if _finite(an[0].get("price")) and _finite(an[1].get("price")):
                box_top(an[0], an[1], max(float(an[0]["price"]), float(an[1]["price"])))
    elif pid in ("flat_base", "bull_flag"):
        if r.get("draw_entry") and not _flagging_flag(r):
            p = ex.get("draw_entry_price")
            add(p if p is not None and _finite(p) else (r.get("levels") or {}).get("entry"),
                r.get("start_t"), r.get("end_t"))
        stamp("draw_pivot", "price")
        if pid == "flat_base" and g.get("shape") == "base_box" and ex.get("draw_box") is not False:
            # the box's top edge as PatternOverlay.drawGeometry draws it (draw_anchors capped, else the box)
            da, an = ex.get("draw_anchors"), g.get("anchors")
            if isinstance(da, list) and len(da) >= 2 and all(isinstance(x, dict) for x in da[:2]):
                if _finite(da[0].get("price")) and _finite(da[1].get("price")):
                    box_top(da[0], da[1], max(float(da[0]["price"]), float(da[1]["price"])))
            elif isinstance(an, list) and len(an) >= 2 and all(isinstance(x, dict) for x in an[:2]):
                box_top(an[0], an[1], ex.get("top"))
    return out


def daily_atr14(sym: str):
    """The mean true range of the last 14 daily sessions of `sym` (the measure the one-line-per-base pass
    compares lines with), or None under 15 bars or on any failure. Never raises."""
    try:
        b = _daily_bars(sym)
        if len(b) < 15:
            return None
        trs = [max(float(b[j]["h"]), float(b[j - 1]["c"])) - min(float(b[j]["l"]), float(b[j - 1]["c"]))
               for j in range(len(b) - 14, len(b))]
        a = sum(trs) / len(trs)
        return a if _finite(a) and a > 0 else None
    except Exception:  # noqa: BLE001 -- no ATR: the pass fails closed
        return None


#: The member base rows whose own drawing code is a detector or the base catalog (which must not change: they feed
#: confidence, history and the screener), so the trend floor is applied to them HERE, on the member path. The
#: base drawing (bc:base), the double bottom and the shelf pivot apply the same base_draw.trend_ok in their own
#: drawing code; the cup tier gates on its own rising 200-day.
MEMBER_TREND_GATED_IDS = frozenset({"flat_base", "bc:flat-base", "uct_flat_top_breakout"})


def member_trend_gate(sym: str, detections, structures) -> tuple:
    """(detections, structures) without any MEMBER_TREND_GATED_IDS row while the daily close of `sym` is not above a
    RISING 200-day average (base_draw.trend_ok): a bullish base under a falling 200-day is a pause in a
    downtrend, not a base to buy. The daily bars are read only when such a row is present, and the trend is read
    at the last COMPLETE session (a forming bar is dropped, as base_draw_row does), so a live price crossing the
    average cannot blink these rows on and off or disagree with the other base layers on the same chart. Too
    short a history (under 220 sessions) drops them; a bar READ ERROR or an EMPTY read keeps them (the gate only
    removes what it can show is a downtrend, and a store outage must not blank every base on the site). Every
    other row is untouched. Members only; order kept."""
    det, st = list(detections or []), list(structures or [])
    if not any((r or {}).get("pattern_id") in MEMBER_TREND_GATED_IDS for r in det + st):
        return det, st
    try:
        from api.services.pattern_engine import base_draw
        b = list(_daily_bars(sym) or [])
        if b and last_bar_forming(b[-1]["t"]):
            b = b[:-1]
        ok = base_draw.trend_ok([float(x["c"]) for x in b], len(b) - 1) if b else True
    except Exception:  # noqa: BLE001 -- unknown is not a downtrend: the rows stay as they were
        _log.warning("[auto-structures] trend read failed for %s; base rows left ungated", sym, exc_info=True)
        ok = True
    if ok:
        return det, st
    keep = [r for r in det if (r or {}).get("pattern_id") not in MEMBER_TREND_GATED_IDS]
    return keep, [r for r in st if (r or {}).get("pattern_id") not in MEMBER_TREND_GATED_IDS]


def member_one_line_per_base(detections, structures, atr=None) -> tuple:
    """(detections, structures) with at most ONE drawn breakout line per base. Applied on the MEMBER path
    only, after member_rows, the freshness filter and the pairwise precedences.

    The rows considered are the DRAWN rows (`_drawn_incumbent`: a stale row is served but never drawn, so it
    neither covers nor is removed) of ONE_LINE_PER_BASE_PRIORITY that draw at least one breakout line
    (`_breakout_lines`). In priority order (ties: detections before structures, then input order) each row is
    kept unless one of its lines lies within ONE_LINE_PER_BASE_ATR x `atr` of a line of an already-KEPT row
    of ANOTHER id over an overlapping span; then the whole row is dropped. Two rows of the SAME id are left
    to that drawing's own judged rules (the bull_flag overlap pass, one flat top per scan): this pass only
    settles one base drawn by two different drawings. A kept row is returned as it came in (the same
    object: nothing moved or altered), every other row is untouched, and order is kept; with nothing to drop
    the two inputs come back as lists of the very same rows.

    `atr` is a number or a zero-argument callable, read only when two rows' lines overlap in span (a chart
    with nothing to compare reads nothing). Without a finite, positive `atr` the widest ATR a candidate row
    carries in its own stamp is used (`_stamped_atr`); with none at all, only lines at the same cent count
    as one line, so the pass still removes exact duplicates and never guesses a width (a guessed width
    would hide distinct drawings whenever the bars read failed). On any unexpected error it fails closed:
    only the highest-priority candidate row is kept. Never raises."""
    dets, sts = list(detections or []), list(structures or [])
    rank = {pid: i for i, pid in enumerate(ONE_LINE_PER_BASE_PRIORITY)}
    cands = []
    try:
        for i, r in enumerate(dets + sts):
            pid = (r or {}).get("pattern_id")
            if pid in rank and _drawn_incumbent(r):
                ls = _breakout_lines(r)
                if ls:
                    # a base STATE row ranks after every incumbent drawing (it yields, it never removes one), but
                    # ahead of the donchian setup line (precedence round e: the base drawing shown stays)
                    cands.append((rank[DONCHIAN_DRAW_ID] - 0.5 if _is_base_state_row(r) else rank[pid], i, r, ls))
        if len(cands) < 2:
            return dets, sts

        def overlap(a, b):
            return a[1] <= b[2] and b[1] <= a[2]

        if not any(cands[x][2].get("pattern_id") != cands[y][2].get("pattern_id") and overlap(a, b)
                   for x in range(len(cands)) for y in range(x + 1, len(cands))
                   for a in cands[x][3] for b in cands[y][3]):
            return dets, sts
        w = atr() if callable(atr) else atr
        if not (_finite(w) and float(w) > 0):
            w = _stamped_atr([c[2] for c in cands])
        width = float(w) * ONE_LINE_PER_BASE_ATR if w is not None else ONE_LINE_PER_BASE_CENT
        kept, drop = [], set()
        for _rk, _i, r, ls in sorted(cands, key=lambda c: (c[0], c[1])):
            pid = r.get("pattern_id")
            if any(kp != pid and overlap(a, b) and abs(a[0] - b[0]) <= width
                   for kp, k in kept for a in ls for b in k):
                drop.add(id(r))
            else:
                kept.append((pid, ls))
    except Exception:  # noqa: BLE001 -- fail closed: one breakout line rather than two
        if not cands:
            return dets, sts
        top = min(cands, key=lambda c: (c[0], c[1]))[2]
        drop = {id(c[2]) for c in cands if c[2] is not top}
    if not drop:
        return dets, sts
    return [r for r in dets if id(r) not in drop], [r for r in sts if id(r) not in drop]


def member_setup_one_line_per_base(detections, structures, setups, atr=None):
    """`setups` (the member's `setup_draws` rows, or None) without a row that member_one_line_per_base would drop
    beside the chart's already-settled `detections` and `structures`: the SAME pass, run once over all three, so
    a setup drawing of ONE_LINE_PER_BASE_PRIORITY (the donchian channel line) yields wherever a higher-priority
    drawn line sits within ONE_LINE_PER_BASE_ATR over overlapping spans (and so does the rectangle box, ranked
    after it, by its top edge). Setup ids outside the priority are kept
    untouched; `detections` / `structures` are read, never changed. None stays None. Never raises."""
    if setups is None:
        return None
    sl = list(setups)
    _d, kept = member_one_line_per_base(detections, list(structures or []) + sl, atr=atr)
    keep = {id(x) for x in kept}
    return [x for x in sl if id(x) in keep]


#: The MA pullback v5 (uct_pullback_ma_v5: the tagged MA curve, tag-bar marker and stop) release literal.
#: Recertification C (2026-10-24, strict textbook placement rubric, four pre-registered blind packets of 25, two
#: fresh judges each; pass = every packet mean >= 2.3 and >= 70% of cases >= 2, pooled >= 2.4) FAILED it as served
#: (1.60 / 1.60 / 1.78 / 1.52, pooled 1.63) and through both fix rounds (round 1: 2.10 / 2.28 / 2.28 / 2.26, pooled
#: 2.23; round 2: 2.20 / 2.36 / 2.42 / 2.28, pooled 2.315). So NO v5 pullback reaches a member: None. Admins and the
#: team still see it (they never pass through member_rows). A literal ON PURPOSE: re-enabling is this one line,
#: and only after a drawing round passes the protocol.
MEMBER_PULLBACK_MA_V5_ROUND = None
PULLBACK_MA_V5_ID = "uct_pullback_ma_v5"


#: The bull_flag drawing round members are served. Round 9 (8d033ec7d2, lab/geometry_eval
#: REPORT_BULLFLAG_R9.md) passed an older geometry rubric and then scored 1.62 on the strict textbook
#: rubric (flag_textbook_r2); a rebuilt textbook flag (recert E, 2026-10-24) scored 2.34 / 2.36 / 2.22 /
#: 2.50, pooled 2.355, and FAILED the protocol bar (every packet >= 2.3, pooled >= 2.4), and no fresh fix
#: round could be filled on the member universe. So EVERY bull flag is withheld from members: None.
#: Admins and the team still see both tiers (they never pass through member_rows). A literal ON PURPOSE,
#: not display.BULL_FLAG_DRAW_ROUND: re-enabling is this one line, and only after a drawing round passes.
MEMBER_BULL_FLAG_ROUND = None


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


#: The drawing round a "flagging"-tier stamp must carry to BE that tier (the round the tier was
#: built and measured on). A literal on purpose, like MEMBER_BULL_FLAG_ROUND: a new drawing round is
#: not recognised as the tier until this is changed by hand. Recognition only -- it releases nothing.
FLAGGING_TIER_ROUND = 9
#: The "flagging" tier's MEMBER release literal. Flagging tier withheld from members 2026-10-24: blind
#: textbook score 1.28 (24% of cases scoring >= 2). None: no member gets a flagging-tier row (the
#: confirmed round-9 tier is unaffected; admins and the team keep seeing both). Fail closed: anything
#: but an int equal to FLAGGING_TIER_ROUND serves nothing. RE-ENABLING IT IS THIS ONE LITERAL: set it
#: back to 9.
MEMBER_FLAGGING_ROUND = None
#: The tier name the stamp must carry.
MEMBER_FLAGGING_TIER = "flagging"


def _flagging_flag(row) -> bool:
    """True when a bull_flag row is the "flagging" tier as display.draw_geometry stamps it: the
    strict round stopped it (`stale`, no `draw_round`) on a relaxed reason only
    (display.FLAGGING_REASONS), and `extras.flagging` carries tier "flagging" and FLAGGING_TIER_ROUND
    as an int. Recognition only: whether a MEMBER gets it is `_member_flagging_flag`. Anything
    else -- no stamp, another round, another tier, a stale reason outside the relaxed set, a row
    that is ALSO stamped confirmed -- is False. Fail closed."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    if ex.get("stale") is not True or "draw_round" in ex:
        return False
    if ex.get("stale_reason") not in _display.FLAGGING_REASONS:
        return False
    stamp = ex.get("flagging")
    if not isinstance(stamp, dict) or stamp.get("tier") != MEMBER_FLAGGING_TIER:
        return False
    rnd = stamp.get("draw_round")
    return type(rnd) is int and rnd == FLAGGING_TIER_ROUND


def _member_flagging_flag(row) -> bool:
    """True when a member may be served this "flagging"-tier row: MEMBER_FLAGGING_ROUND (read PER CALL)
    is an int equal to FLAGGING_TIER_ROUND AND the row is the tier (`_flagging_flag`). While the literal
    is None (withheld 2026-10-24) this is always False. Fail closed."""
    want = MEMBER_FLAGGING_ROUND
    return type(want) is int and want == FLAGGING_TIER_ROUND and _flagging_flag(row)


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
            if not ok and why == "short_of_rim":
                # round 9 (display.handle_pivot): a right side stalled further under the rim than
                # RIM_REACH_ATR but within HANDLE_PIVOT_REACH_ATR, with a handle, draws its PIVOT at the
                # handle high and keeps the rim as a faint reference line (extras.draw_rim_ref)
                hp, hbox, _hwhy = _display.handle_pivot(bars, cup.get("start_t"), cup.get("end_t"), rim)
                if hp:
                    extras["draw_pivot"] = hp
                    extras["draw_rim_ref"] = rim
                    extras["draw_handle"] = hbox
                    extras["draw_box"] = False
                    return
                extras["handle_pivot_reason"] = _hwhy
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
                # round 10 (display.handle_pivot_in_reach): a right side within reach that still sits more
                # than HANDLE_PIVOT_EPS_ATR under the rim pivots at the HANDLE HIGH; the rim stays as a faint
                # reference (round 9's two-line drawing)
                hp, _hwhy = _display.handle_pivot_in_reach(bars, cup.get("start_t"), cup.get("end_t"), rim, box)
                if hp:
                    extras["draw_pivot"] = hp
                    extras["draw_rim_ref"] = rim
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
        out = _structure_rows(sym, _daily_bars(sym))
    except Exception as e:  # noqa: BLE001 -- a drawing layer must never 500 a read
        _log.debug("[auto-structures] %s failed: %s", sym, e)
        out = []
    _CACHE[sym] = (now, out)
    return out


def _tier_drawn_stale_cup(det: dict, bars: list):
    """A bc:cup-with-handle row the TEAM display rounds marked stale, served in the cup tier's member form when
    the round-4 tier DRAWS it (stamped, nothing withheld, `_confirmed_cup_tier`); else None (the row stays dropped).

    lab cup_served (2026-10-23, PREREG bf403e59...): the team verdicts (failed_breakout, rim_broken, gap_island,
    short_of_rim, prior_peak, spike_rim, ...) read the DETECTOR'S cup -- its start, its lip HIGH, its box top --
    and the member never sees that geometry: a served cup is redrawn wholesale from the tier's own anchors, with
    the tier's own gates and withholds. They dropped 18 of the 29 judged-3 cup charts. Serving the stale boxes
    the tier draws passed a fresh blind packet (25 such cups, two judges: mean 2.30 [2.12, 2.48], 96% >= 2;
    25 still-withheld contrast charts 2.06). The team reason is kept as `extras.team_stale_reason`. Never raises."""
    try:
        if (det or {}).get("pattern_id") != CUP_ID:
            return None
        cup_tier_stamp(det, bars)
        ex = det["geometry"]["extras"]
        ex["team_stale_reason"] = ex.pop("stale_reason", None)
        ex.pop("stale", None)
        if not _confirmed_cup_tier(det):
            return None
        return _cup_tier_member_row(det)
    except Exception:  # noqa: BLE001 -- fail closed: the stale row stays dropped
        return None


def _structure_rows(sym: str, bars: list) -> list:
    """The structures rows for daily `bars` ({t,o,h,l,c,v}, oldest first): structures_for's body, uncached.
    May raise (structures_for turns that into no rows)."""
    out: list = []
    from api.services.screener import base_catalog
    if len(bars) >= 10:
        for box in base_catalog.current_base_structures(bars) or []:
            try:
                det = box_to_detection(sym, box, bars)
            except Exception:  # noqa: BLE001 -- one bad box drops that box only
                continue
            # A stale box (extras.stale, e.g. a failed cup breakout) is not
            # served: dropping it here keeps the overlay unchanged.
            if (det.get("geometry") or {}).get("extras", {}).get("stale"):
                # ... except a cup the round-4 cup tier DRAWS: served in the tier's own form (lab cup_served)
                det = _tier_drawn_stale_cup(det, bars)
                if det is not None:
                    out.append(det)
                continue
            # the cup recognition tier (lab cup_tier_v2 + cup_draw_v4): extras.cup_tier, or nothing
            cup_tier_stamp(det, bars)
            out.append(det)
        # the shape-agnostic base drawing (lab base_draw): its own row, after every box
        bd = base_draw_row(sym, bars)
        if bd is not None:
            out.append(bd)
        # the inside-day drawing (lab id_draw_v2): its own row, after the base drawing
        idd = inside_day_draw_row(sym, bars)
        if idd is not None:
            out.append(idd)
        # the named base-shape drawings (lab base_shapes): admin-only rows, behind their own flag
        if shapes_enabled():
            out.extend(shape_draw_rows(sym, bars))
        # the rare-pattern admin preview: admin-only rows, behind their own flag
        if rare_preview_enabled():
            out.extend(rare_preview_rows(sym, bars))
    return out


# ================================================================ shelf pivot (members: round r4)
#: The shelf-pivot row id (api/services/pattern_engine/shelf_pivot.py).
SHELF_PIVOT_ID = "draw:shelf-pivot"
#: The shelf-pivot drawing round a member may be served. A literal ON PURPOSE, never
#: shelf_pivot.SHELF_PIVOT_ROUND: a member gets the line only while this equals that frozen constant ("r4")
#: AND the id is in registry.DISPLAY_MEMBER_SET and the trusted set it must sit in (member_rows). Fail closed.
#: RELEASED to members 2026-10-23 at round "r4": blind judging round 4 (2.66 / 2.60), the independent verifier
#: (SHIP WITH CONDITIONS C1-C5, built in 785c6ae448 + c059a0d61b) and the owner's live eye check (C6, 18 live
#: shelf lines, 2026-10-22). Set it back to None to withdraw the line from members.
#: WITHDRAWN from members 2026-10-24 (recert B): the strict textbook rubric failed it as served (round 1: 1.50 / 1.56 /
#: 1.50 / 1.72, pooled 1.57), and the formal fix round with the textbook gate (pattern_engine.textbook_gate, whole
#: bars.db history 1995-2026, four pre-registered packets of 25, two fresh blind judges each) failed narrowly:
#: 2.26 / 2.44 / 2.32 / 2.54, pooled 2.39 (bar: every packet >= 2.3 and >= 70% of charts >= 2, pooled >= 2.4).
#: Evidence: lab/recert/B_pivots (PREREG_FR.txt, out/score_shelf_pivot_fr1.json). Admins keep the layer. Setting
#: this back to "r4" needs a new passed blind round (tests/golden_judged: shelf.json.gz is "withdrawn" until then).
MEMBER_SHELF_PIVOT_ROUND = None
#: The frame the drawing round was judged on; outside it there is no line.
SHELF_WINDOW = 600
SHELF_MIN_BARS = 261
SHELF_MIN_CLOSE = 5.0
SHELF_MIN_DOLLAR_VOLUME = 20e6
#: The label and the hover text (no trade instruction in either).
SHELF_LABEL = "Shelf pivot"
SHELF_CLEARED = "(cleared)"
SHELF_TOOLTIP = ("Price has stalled at this level several times since {date} and is trading near it now. "
                 "A level to watch, not a signal.")
#: One computed answer per (ticker, last completed session).
_SHELF_CACHE: dict = {}
_SHELF_LOCK = threading.Lock()
_SCAN_UNIVERSE: list = []


def shelf_enabled() -> bool:
    """AUTO_STRUCTURES_SHELF_ENABLED, read PER CALL; unset means OFF. Off, nothing below runs and every
    payload is exactly what it was before the shelf pivot existed. The kill switch is this flag."""
    return os.environ.get("AUTO_STRUCTURES_SHELF_ENABLED", "0").strip().lower() in _TRUTHY


def _member_shelf_ok() -> bool:
    from api.services.pattern_engine import shelf_pivot
    rnd = MEMBER_SHELF_PIVOT_ROUND
    return type(rnd) is str and rnd == shelf_pivot.SHELF_PIVOT_ROUND


def _confirmed_shelf(row) -> bool:
    """True when a shelf-pivot row is drawn by the member round: MEMBER_SHELF_PIVOT_ROUND equals the frozen
    round and equals the row's own stamp, beside a well-formed draw_shelf. Anything else is False."""
    if not _member_shelf_ok():
        return False
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    d = ex.get("draw_shelf")
    if ex.get("draw_round") != MEMBER_SHELF_PIVOT_ROUND or not isinstance(d, dict):
        return False
    return _finite(d.get("price")) and type(d.get("start_t")) is int and type(d.get("end_t")) is int \
        and d["start_t"] < d["end_t"]


def _row_lines(r):
    """The prices a row draws and its span (start_t, end_t) -- the member path's view of a served row."""
    ex = (r.get("geometry") or {}).get("extras") or {}
    pid = r.get("pattern_id")
    if pid == BASE_DRAW_ID:
        vals = [ex["draw_base"]["pivot"]]
        span = (int(ex["draw_base"]["start_t"]), int(ex["draw_base"]["end_t"]))
    elif pid in SHAPE_DRAW_IDS:
        vals = [ex["draw_shape"]["pivot"]]
        span = (int(ex["draw_shape"]["start_t"]), int(ex["draw_shape"]["end_t"]))
    elif pid == INSIDE_DAY_DRAW_ID:
        vals = [ex["draw_inside_day"]["trigger"]]
        span = (int(ex["draw_inside_day"]["start_t"]), int(ex["draw_inside_day"]["end_t"]))
    else:
        vals = _row_levels(r)
        span = _row_span(r)
    return [float(v) for v in vals if _finite(v)], span


def _scan_universe() -> frozenset:
    if not _SCAN_UNIVERSE:
        import json
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "cap_universe.json")
        with open(path, encoding="utf-8") as fh:
            _SCAN_UNIVERSE.append(frozenset(json.load(fh)))
    return _SCAN_UNIVERSE[0]


def _base_as_member_round(row):
    """A bc:base row of a later drawing round that carries the member round's drawing (`_BASE_CARRIERS`) as the
    member round's own row, or None where the member round draws nothing on those bars: the member's chart
    holds the member round's line, never the admin round's. Any other row is returned as it is."""
    ex = ((row or {}).get("geometry") or {}).get("extras")
    if (row or {}).get("pattern_id") != BASE_DRAW_ID or not isinstance(ex, dict):
        return row
    rnd = ex.get("draw_round")
    if type(rnd) is not int or (MEMBER_BASE_ROUND, rnd) not in _BASE_CARRIERS:
        return row
    return _base_member_row(row)


def shelf_member_facts(sym: str, bars: list):
    """(served, lines) for daily `bars` (completed sessions, oldest first, the last one the as-of bar): the
    drawings the member path serves on that chart -- [(pattern_id, [drawn prices], (start_t, end_t) or None)] --
    and every detector line on it, served or withheld -- [(pattern_id, price, withheld)]. The member detectors
    run on the bars as the daily scan runs them; the structures go through member_rows and the member
    precedences exactly as the route applies them. "Served" means DRAWN: a row the member path sends but the
    member's chart never draws (a stale row other than the "flagging" tier: `_drawn_incumbent`) is not in
    `served` and its lines count as withheld. RAISES on any failure (the caller draws nothing)."""
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine.primitives.context import build_context
    from api.services.pattern_engine.detectors import registry as reg
    from api.services.pattern_engine.detectors.uct import flat_base as _fb  # noqa: F401 -- registers
    from api.services.pattern_engine.detectors.uct import uct_flat_top_breakout as _ft  # noqa: F401
    from api.services.pattern_engine.detectors.uct import uct_pullback_ma_v5 as _pb  # noqa: F401
    from api.services.pattern_engine.detectors.classical import bull_flag as _bf  # noqa: F401
    from api.services.screener import base_catalog
    sym = (sym or "").upper()
    bd = list(bars)
    det_ids = sorted(i for i in member_ids() if not i.startswith(("bc:", "draw:")))
    for pid in det_ids:
        reg.get_detector(pid)   # KeyError: a member detector is not loaded -> no line
    in_universe = sym in _scan_universe()
    ctx = build_context(bd[-reg.SCAN_BASE_DEPTH:], sym=sym)
    raw = detect_all(bd, ctx, pattern_ids=det_ids, base_depth=reg.SCAN_BASE_DEPTH, sym=sym)
    lines = []
    dets_ok = []
    for d in raw:
        d = {**d, "sym": sym, "tf": "D"}
        d = {**d, **reg.row_display_policy(d)}
        ls, _span = _row_lines(d)
        ex = (d.get("geometry") or {}).get("extras") or {}
        if float(d.get("confidence") or 0) < 50.0:
            why = "min_conf"
        elif d.get("status") in ("completed", "failed", "expired"):
            why = "status"
        elif not member_rows([d]):
            why = "stale" if ex.get("stale") else "tier"
        elif not _drawn_incumbent(d):
            why = "stale"   # sent, never drawn
        else:
            why = None
        if not in_universe and why is None:
            why = "not_in_scan_universe"
        for p in ls:
            lines.append((d["pattern_id"], p, why is not None))
        if why is None:
            dets_ok.append(d)
    for box in base_catalog.current_base_structures(bd) or []:
        try:
            det = box_to_detection(sym, box, bd)
        except Exception:  # noqa: BLE001 -- the member path skips a box it cannot build
            continue
        ex = det["geometry"]["extras"]
        if not ex.get("stale") and det["pattern_id"] in reg.DISPLAY_MEMBER_SET:
            continue   # judged with the structures below
        for p in (ex.get("pivot"), ex.get("top")):
            if _finite(p):
                lines.append((det["pattern_id"], float(p), True))
    # a "Base forming" state row never hides the shelf (member_shelf_over_forming: the shelf outranks it), so the
    # shelf is computed as if it were not drawn
    st = [r for r in map(_base_as_member_round, _structure_rows(sym, bd))
          if r is not None and not _is_forming_state_row(r)]
    served_st = member_rows(st)
    after_cup = member_cup_precedence(served_st)
    after_base = member_base_precedence(dets_ok, after_cup)
    after_id = member_inside_day_precedence(dets_ok, after_base, "D")
    final_ids = {id(x) for x in after_id}
    for r in st:
        pid = r["pattern_id"]
        ls, _span = _row_lines(r)
        if id(r) in final_ids:
            why = None if _drawn_incumbent(r) else "stale"
        elif not any(x is r or (x.get("id") == r.get("id") and x.get("pattern_id") == pid) for x in served_st):
            why = "member_rows"
        else:
            why = "precedence"
        if pid == CUP_ID and why in (None, "stale", "precedence") and any(x.get("pattern_id") == pid for x in after_id):
            continue   # served in member form below
        for p in ls:
            lines.append((pid, p, why is not None))
    for r in after_id:
        if r.get("pattern_id") == CUP_ID:
            for p in _row_lines(r)[0]:
                lines.append((CUP_ID, p, not _drawn_incumbent(r)))
    served = []
    for r in dets_ok + list(after_id):
        if not _drawn_incumbent(r):
            continue   # sent, never drawn: covers nothing (its lines are withheld above)
        ls, span = _row_lines(r)
        served.append((r["pattern_id"], ls, span))
    return served, lines


def _shelf_bars(sym: str):
    """The SHELF_WINDOW daily bars ending at the newest COMPLETED session ({t,o,h,l,c,v}, oldest first), or None
    when the session clock is unknown (fail closed: a forming bar is never drawn on)."""
    from api.services import bars_sqlite, barspack
    done = barspack._last_complete_session_ymd()
    if done is None:
        return None
    rows = bars_sqlite.get_bars(sym, "D", SHELF_WINDOW + 1) or []
    rows = [r for r in rows if int(r[0]) <= int(done)][-SHELF_WINDOW:]
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]),
             "v": float(r[5] or 0)} for r in rows]


def shelf_in_frame(bars) -> bool:
    """The judged frame (the sampling rule of every judged and held-out chart): >= SHELF_MIN_BARS daily bars, and
    on the as-of session close > SHELF_MIN_CLOSE and close x volume >= SHELF_MIN_DOLLAR_VOLUME."""
    if len(bars or []) < SHELF_MIN_BARS:
        return False
    last = bars[-1]
    return last["c"] > SHELF_MIN_CLOSE and last["c"] * last["v"] >= SHELF_MIN_DOLLAR_VOLUME


def _shelf_date(t: int) -> str:
    import datetime
    d = datetime.date(int(t) // 10000, int(t) // 100 % 100, int(t) % 100)
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def shelf_compute(sym: str, bars: list):
    """The shelf-pivot row for completed daily `bars`, or None: outside the judged frame, any served drawing on
    the chart (v1: co-display was never judged), or no shelf. RAISES on a failure (the caller draws nothing)."""
    from api.services.pattern_engine import shelf_pivot
    if not shelf_in_frame(bars):
        return None
    served, lines = shelf_member_facts(sym, bars)
    if served:
        return None
    rows = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]
    res = shelf_pivot.evaluate(rows, served, lines)
    pk = res.get("pick")
    if not pk:
        return None
    return shelf_row(sym, pk, res["score"], res["atr"])


def shelf_row(sym: str, pk: dict, score, atr) -> dict:
    from api.services.pattern_engine import shelf_pivot
    sym = (sym or "").upper()
    price = round(float(pk["P"]), 4)
    start_t, end_t = int(pk["disp_left_t"]), int(pk["asof_t"])
    cleared = float(pk["close"]) > float(pk["P"])
    d = {
        "price": price, "start_t": start_t, "end_t": end_t, "span_start_t": int(pk["left_t"]),
        "label": SHELF_LABEL, "cleared": cleared,
        "tooltip": SHELF_TOOLTIP.format(date=_shelf_date(start_t)),
        "touch_groups": int(pk["touch_groups"]), "atr": float(atr), "score": float(score),
    }
    return {
        "id": f"{SHELF_PIVOT_ID}:{sym}:{start_t}:{end_t}",
        "sym": sym,
        "tf": "D",
        "pattern_id": SHELF_PIVOT_ID,
        "pattern_name": SHELF_LABEL,
        "category": "level",
        "direction": "neutral",
        "start_t": start_t,
        "end_t": end_t,
        "geometry": {
            "shape": "shelf_pivot",
            "anchors": [{"t": start_t, "price": price}, {"t": end_t, "price": price}],
            "extras": {"draw_shelf": d, "draw_round": shelf_pivot.SHELF_PIVOT_ROUND},
        },
        "levels": {},
        "confidence": None,
        "status": "forming",
        **display_policy(SHELF_PIVOT_ID),
    }


def shelf_pivot_row(sym: str, *, member: bool = False, chart_served=()):
    """The shelf-pivot row for `sym`'s daily chart, or None. Gated: AUTO_STRUCTURES_SHELF_ENABLED (default
    off; nothing runs while it is off) and, for a member, MEMBER_SHELF_PIVOT_ROUND equal to the frozen round
    (member_rows also requires the member set). `chart_served`: the drawings the caller's chart already
    serves -- any one the chart DRAWS hides the line (v1; a stale row other than the "flagging" tier is sent
    but never drawn: `_drawn_incumbent`). One computed answer per (ticker, last completed session). Any
    failure -> None. Never raises."""
    try:
        if not shelf_enabled():
            return None
        if member and not _member_shelf_ok():
            return None
        if any(_drawn_incumbent(r) for r in chart_served or ()):
            return None
        sym = (sym or "").upper()
        bars = _shelf_bars(sym)
        if not bars:
            return None
        key = int(bars[-1]["t"])
        with _SHELF_LOCK:
            hit = _SHELF_CACHE.get(sym)
        if hit and hit[0] == key:
            return hit[1]
        row = shelf_compute(sym, bars)
        with _SHELF_LOCK:
            _SHELF_CACHE[sym] = (key, row)
        return row
    except Exception as e:  # noqa: BLE001 -- any failure draws no line
        _log.debug("[shelf-pivot] %s failed: %s", sym, e)
        return None


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


def last_bar_complete(last_t, now=None) -> bool:
    """True ONLY when the daily series' last bar is a COMPLETED session (levels_session_state ==
    'complete'). The fail-CLOSED counterpart of last_bar_forming: an unknown or failing session clock
    answers False, so a caller that drops a not-complete last bar treats an unreadable clock as a
    possibly forming session and drops it (as _complete_session_bars and latest_completed_bar_t do),
    instead of drawing a half-formed bar's range as if the session had closed. Never raises."""
    return levels_session_state(last_t, now) == "complete"


#: The levels drawing round confirmed for the chart's `drawn` levels: lab levels_v3 (2026-10-18, pre-registered):
#: v2's chart-reading levels plus a guaranteed near support / resistance, at most 4. Team agreement on fresh
#: charts tied C2 (F1 +0.005, lift +0.016 n.s.) with a near support on 100% of charts (C2 91.5%); blind judges
#: preferred it twice: packet J 2.70 vs 2.10, and the confirmation packet (30 fresh charts, two balanced packets,
#: four fresh judges) 2.53 vs 2.20, paired +0.33, 90% CI [+0.15, +0.52]. A literal ON PURPOSE, not
#: levels_v3.LEVELS_V3_ROUND: when the drawing code moves to a new round, the chart falls back to the C2 levels
#: until that round is confirmed and this is changed by hand.
MEMBER_LEVELS_ROUND = "2026-10-18-v3"
#: The v3 drawing never has more levels than this (C2's count; the judged and team-scored cap).
LEVELS_V3_MAX = 4
#: v3 labels that must never reach a member (F3): a bare 'level' / 'round' says nothing.
_LEVELS_V3_BANNED_LABELS = frozenset({"level", "round"})

#: Every time a chart falls back from the v3 levels to the C2 levels, by reason ("crash", "rejected").
#: Read by an operator / a test; the first fallback in a process also logs at WARNING (F2), later ones at DEBUG.
LEVELS_FALLBACKS: dict = {"crash": 0, "rejected": 0}
_levels_fallback_warned = False
_levels_fallback_lock = threading.Lock()


def _levels_fallback(reason: str, sym: str, detail) -> None:
    global _levels_fallback_warned
    with _levels_fallback_lock:   # reads run on a threadpool: count and warn-once atomically
        LEVELS_FALLBACKS[reason] = LEVELS_FALLBACKS.get(reason, 0) + 1
        first = not _levels_fallback_warned
        _levels_fallback_warned = True
    if first:
        _log.warning("[levels-v3] %s fell back to the C2 levels (%s): %s -- further fallbacks counted in "
                     "auto_structures.LEVELS_FALLBACKS, logged at DEBUG", sym, reason, detail)
    else:
        _log.debug("[levels-v3] %s fell back to the C2 levels (%s): %s", sym, reason, detail)


def _levels_v3_ok(v3) -> bool:
    """True when a levels_v3 result carries the confirmed round's stamp and well-formed levels: 1 to
    LEVELS_V3_MAX horizontals, each a finite price, an int t_from, the levels_v3 source and a member label."""
    if not isinstance(v3, dict) or v3.get("round") != MEMBER_LEVELS_ROUND:
        return False
    hs = v3.get("horizontals")
    if not isinstance(hs, list) or not 1 <= len(hs) <= LEVELS_V3_MAX:
        return False
    return all(isinstance(h, dict) and h.get("source") == "levels_v3" and _finite(h.get("price"))
               and type(h.get("t_from")) is int and isinstance(h.get("label"), str) and h.get("label")
               and h.get("label") not in _LEVELS_V3_BANNED_LABELS for h in hs)


def levels_session_state(last_t, now=None) -> str:
    """'complete' when the daily series' last bar is a COMPLETED session (at or before barspack's
    _last_complete_session_ymd, the one authority on "complete": a trading day at/after the close, else
    the prior trading session -- weekends and holidays included), 'forming' when it is a session still in
    progress, 'unknown' when the session clock (or the bar's date) cannot be read. Only 'complete' may
    serve the v3 levels: that is the state the lab drew and the judges scored. Never raises."""
    try:
        from api.services import barspack
        done = barspack._last_complete_session_ymd(now)
        if done is None or last_t is None:
            return "unknown"
        return "forming" if int(last_t) > int(done) else "complete"
    except Exception:  # noqa: BLE001 -- a clock question never breaks the drawing; unknown fails closed
        return "unknown"


def _levels_v3(clean_rows, forming, sym=""):
    """The levels_v3 drawing when it is stamped with MEMBER_LEVELS_ROUND and well formed, else None (the
    caller keeps the C2 levels; the fallback is counted and the first one per process logged at WARNING).
    Never raises."""
    try:
        from api.services import levels_v3
        v3 = levels_v3.drawn_levels(clean_rows, last_bar_forming=forming)
    except Exception as e:  # noqa: BLE001 -- a drawing layer must never 500 a read
        _levels_fallback("crash", sym, repr(e))
        return None
    if _levels_v3_ok(v3):
        return v3
    _levels_fallback("rejected", sym, "round=%r" % (v3.get("round") if isinstance(v3, dict) else None))
    return None


def drawn_for(sym: str):
    """The learned drawer's default drawing for the latest daily bars of `sym`
    (api/services/auto_draw.drawn_set), plus the display rules that ride with it:
    `suppress` maps a pattern_id to why the overlay leaves it undrawn while this block is
    present (`hidden_by_default` / `replaced_by_learned`, from the registry constants).
    None when there are too few bars. Never raises."""
    sym = (sym or "").upper()
    now = time.time()
    out = None
    token = None
    try:
        rows = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in _daily_bars(sym)]
        last_t = rows[-1][0] if rows else None
        forming = bool(rows) and last_bar_forming(last_t)
        session = levels_session_state(last_t)
        # R1: ONE cache slot per symbol, reused only for the SAME last bar in the SAME forming / session
        # state, so a new session (or a forming bar that completes) is never served the old drawing. The
        # slot is overwritten in place -- no iteration over the shared dict and no delete -- so concurrent
        # reads on the request threadpool cannot race it.
        token = (last_t, forming, session)
        hit = _DRAWN_CACHE.get(sym)
        if hit and hit[1] == token and now - hit[0] < _CACHE_TTL_S:
            return hit[2]
        from api.services import auto_draw
        clean = auto_draw.clean_bars(rows)
        drawn = auto_draw.drawn_set(clean, last_bar_forming=forming)
        if drawn is not None:
            suppress = {pid: "hidden_by_default" for pid in sorted(DISPLAY_LEARNED_HIDES)}
            suppress.update({pid: "replaced_by_learned" for pid in sorted(DISPLAY_LEARNED_REPLACES)})
            out = {**drawn, "suppress": suppress}
            # v3 only on a COMPLETED session's bar -- the state the lab drew and the judges scored. While
            # the session is forming, or the session clock is unknown, the chart keeps the C2 levels
            # (today's live behaviour; a policy, not a fallback, so it is not counted).
            if session == "complete" and not forming:
                v3 = _levels_v3(clean, False, sym)
                if v3 is not None and v3.get("asof_t") != int(last_t):
                    _levels_fallback("rejected", sym, "asof_t=%r last bar=%r" % (v3.get("asof_t"), last_t))
                    v3 = None
                if v3 is not None:
                    out["horizontals"] = v3["horizontals"]
                    # asof_t: the completed session the levels were drawn at ("levels as of <date> close")
                    out["levels_tier"] = {"round": v3["round"], "source": "levels_v3", "asof_t": int(last_t)}
    except Exception as e:  # noqa: BLE001 -- a drawing layer must never 500 a read
        _log.debug("[auto-draw] %s failed: %s", sym, e)
        out = None
    if token is not None:
        _DRAWN_CACHE[sym] = (now, token, out)
    return out


#: The learned auto-drawer round a MEMBER may be shown (the `drawn` block: learned levels + trendlines).
#: None: WITHHELD from every member (owner decision 2026-10-23) until the layer is rebuilt to textbook
#: support / resistance rules and that rebuild passes blind judging. A literal ON PURPOSE, like the other
#: MEMBER_*_ROUND values: set it by hand to the confirmed round, and a member then gets a `drawn` block only
#: while it carries that round in `learned_round` (the rebuilt drawer stamps it; today's drawer stamps
#: nothing, so even a non-None literal serves members no lines -- fail closed). Admins are unaffected.
MEMBER_LEARNED_LINES_ROUND = None


def member_drawn_for(sym: str):
    """A member's copy of the learned `drawn` block for `sym`, or None (no `drawn` key). None without
    computing anything while MEMBER_LEARNED_LINES_ROUND is None; otherwise drawn_for's block only when its
    `learned_round` equals the literal. Read PER CALL so a test can move the literal. Never raises."""
    rnd = MEMBER_LEARNED_LINES_ROUND
    if rnd is None or type(rnd) is bool:
        return None
    try:
        drawn = drawn_for(sym)
    except Exception:  # noqa: BLE001 -- a drawing layer must never 500 a read
        return None
    if not isinstance(drawn, dict) or drawn.get("learned_round") != rnd:
        return None
    return drawn


# ================================================================ textbook support / resistance (members: WITHDRAWN)
#: The textbook support / resistance drawing round a member may be served (api/services/pattern_engine/sr_levels.py).
#: A literal ON PURPOSE, never sr_levels.SR_ROUND: a member gets the layer only while this equals that frozen
#: constant, so a new drawing round cannot release itself. Fail closed.
#: None: WITHDRAWN from members 2026-10-24 (admins keep it under AUTO_STRUCTURES_SR_ENABLED). Round r2 first passed
#: two packets of 25 (2.52 / 2.36) on a looser rubric. The recertification on the strict Edwards & Magee / Bulkowski
#: rubric (four pre-registered packets of 25 per round, two fresh blind judges each) failed it, 2.04 / 1.98 / 2.02 /
#: 2.20, pooled 2.06, mostly for an important nearby level left undrawn. Both permitted fix rounds failed too: r3
#: pooled 2.055, r4 2.56 / 2.02 / 2.24 / 2.36, pooled 2.295 (bar: every packet >= 2.3 and >= 70% of charts >= 2,
#: pooled >= 2.4). Evidence: lab/recert/D_levels_candles. Setting this back to a round string needs a new passed
#: blind round of that round (tests/golden_judged: sr.json is "withdrawn" until then).
MEMBER_SR_ROUND = None
#: The judged frame (the sampling rule of every judged chart): >= SR_MIN_BARS daily bars, and on the as-of session
#: close > SR_MIN_CLOSE and close x volume >= SR_MIN_DOLLAR_VOLUME. Outside it there is no layer.
SR_MIN_BARS = 261
SR_MIN_CLOSE = 5.0
SR_MIN_DOLLAR_VOLUME = 20e6
#: One computed answer per (ticker, scope), reused while the last completed session and the served pattern prices
#: are unchanged.
_SR_CACHE: dict = {}
_SR_LOCK = threading.Lock()


def sr_enabled() -> bool:
    """AUTO_STRUCTURES_SR_ENABLED, read PER CALL; unset means OFF. Off, nothing below runs and every payload is
    exactly what it was before the layer existed. The kill switch is this flag."""
    return os.environ.get("AUTO_STRUCTURES_SR_ENABLED", "0").strip().lower() in _TRUTHY


def _member_sr_ok() -> bool:
    """True only while MEMBER_SR_ROUND is a str equal to sr_levels.SR_ROUND. Anything else (None, a bool, an int, a
    newer drawing round) is False: fail closed."""
    try:
        from api.services.pattern_engine import sr_levels
        rnd = MEMBER_SR_ROUND
        return type(rnd) is str and rnd == sr_levels.SR_ROUND
    except Exception:  # noqa: BLE001 -- an unreadable round serves nothing
        return False


def levels_sr_available(*, member: bool) -> bool:
    """The ONE client-visible signal: the released member S/R layer exists for this scope. A member: the flag AND
    the member round literal (the member door also needs members_enabled); an admin: the flag. Never raises."""
    try:
        return sr_enabled() and (not member or _member_sr_ok())
    except Exception:  # noqa: BLE001
        return False


def sr_in_frame(bars) -> bool:
    if len(bars or []) < SR_MIN_BARS:
        return False
    last = bars[-1]
    return last["c"] > SR_MIN_CLOSE and last["c"] * last["v"] >= SR_MIN_DOLLAR_VOLUME


def sr_served_prices(rows) -> list:
    """Every price a served member drawing puts on the chart (the lab's served-pattern replay: auto_structures
    _row_lines of each row the chart DRAWS -- a stale row other than the "flagging" tier is sent but never drawn and
    covers nothing), plus a served shelf pivot's line. Sorted, rounded to 4 places, de-duplicated."""
    out = set()
    for r in rows or ():
        try:
            if not _drawn_incumbent(r):
                continue
            ex = (r.get("geometry") or {}).get("extras") or {}
            if r.get("pattern_id") == SHELF_PIVOT_ID:
                p = (ex.get("draw_shelf") or {}).get("price")
                vals = [p] if _finite(p) else []
            else:
                vals, _span = _row_lines(r)
                # textbook round 2: a bc:base row whose numbers carry `line` draws its top line THERE (the buy
                # point - $0.10), not on draw_base.pivot. Added beside the body pivot, so S/R keeps clear of both.
                tl = (ex.get("metrics_textbook") or {}).get("line") if r.get("pattern_id") == BASE_DRAW_ID else None
                if _finite(tl):
                    vals = list(vals) + [tl]
        except Exception:  # noqa: BLE001 -- a row whose lines cannot be read suppresses nothing (as the lab)
            continue
        for v in vals:
            out.add(round(float(v), 4))
    return sorted(out)


def _sr_payload(d: dict) -> dict:
    """The member payload: the drawing round, the as-of session, ATR(14), the zones and the trendlines, and the
    reason a chart draws nothing on purpose ("pinned")."""
    out = {
        "round": d["round"],
        "asof_t": int(d["asof"]),
        "atr": d["atr"],
        "zones": [{k: z[k] for k in ("role", "bot", "top", "label", "touches", "first_t", "last_t",
                                     "broken_retested")} for z in d["zones"]],
        "trendlines": [{k: t[k] for k in ("side", "t1", "p1", "t2", "p2", "slope_per_bar", "label", "touches",
                                          "last_touch_t")} for t in d["trendlines"]],
    }
    if d.get("withheld"):
        out["withheld"] = d["withheld"]
    return out


def _sr_withheld(bars: list, why: str) -> dict:
    """The block for a chart the released layer looked at and draws nothing on, by rule ("out_of_frame": outside
    the judged frame; "short_history": too few bars). Present so the key means "released to this viewer"."""
    from api.services.pattern_engine import sr_levels
    return {"round": sr_levels.SR_ROUND, "asof_t": int(bars[-1]["t"]), "atr": None, "zones": [], "trendlines": [],
            "withheld": why}


def sr_compute(bars: list, prices) -> dict | None:
    """The layer for completed daily `bars` (oldest first, the last one the as-of bar) and the served pattern
    prices, or None with too little history. The judged frame is levels_sr_for's to check (once, before any work).
    RAISES on a failure (the caller draws nothing)."""
    from api.services.pattern_engine import sr_levels
    rows = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]
    d = sr_levels.draw(rows, None, list(prices))
    return None if d is None else _sr_payload(d)


def levels_sr_for(sym: str, *, member: bool = False, served=None):
    """The `levels_sr` block for `sym`'s daily chart, or None (no key). Gated: AUTO_STRUCTURES_SR_ENABLED (default
    off; nothing runs while it is off) and, for a member, MEMBER_SR_ROUND equal to the frozen round. `served`: the
    drawings this response serves (member path) -- their prices win (patterns win); None (team path) = the drawings
    the MEMBER path serves on this chart, replayed from the bars (shelf_member_facts). Reads only bars up to the last
    COMPLETED session (an unknown session clock draws nothing). Outside the judged frame, or with too little history,
    the block is present with no zones or lines and `withheld` naming why, so the key itself means "released to this
    viewer" (the UCT Intelligence indicator's "Support & resistance" toggle reads its presence). One computed answer
    per (ticker, last completed session, served prices). Any failure -> None (no key). Never raises."""
    try:
        if not sr_enabled():
            return None
        if member and not _member_sr_ok():
            return None
        sym = (sym or "").upper()
        bars = _shelf_bars(sym)          # the last COMPLETED session's 600-bar window (>= sr_levels.BARS_NEEDED)
        if not bars:
            return None
        if not sr_in_frame(bars):
            return _sr_withheld(bars, "out_of_frame")
        key = int(bars[-1]["t"])
        scope = "member" if member else "team"
        if served is not None:
            prices = tuple(sr_served_prices(served))
            with _SR_LOCK:
                hit = _SR_CACHE.get((sym, scope))
            if hit and hit[0] == key and hit[1] == prices:
                return hit[2]
        else:
            with _SR_LOCK:
                hit = _SR_CACHE.get((sym, scope))
            if hit and hit[0] == key:
                return hit[2]
            facts, _lines = shelf_member_facts(sym, bars)
            prices = tuple(sorted({round(float(v), 4) for _pid, ls, _span in facts for v in ls}))
        out = sr_compute(bars, prices)
        if out is None:
            out = _sr_withheld(bars, "short_history")
        with _SR_LOCK:
            _SR_CACHE[(sym, scope)] = (key, prices, out)
        return out
    except Exception as e:  # noqa: BLE001 -- any failure draws no level
        _log.debug("[sr-levels] %s failed: %s", sym, e)
        return None


# ================================================================ setup drawings (dark: remount, u_and_r, donchian)
#: The setup-drawing row ids (api/services/pattern_engine/setup_draw.py), in build order. One horizontal line each.
#: They ride the `setup_draws` key, never `structures`: PatternOverlay draws them as their own layer, driven by the
#: UCT Intelligence "Setups" toggle (uctIntelligence.layerAvailability reads the key's presence).
#: Round-2 setup drawings (api/services/pattern_engine/setup_draw_r2.py, textbook rebuilds), in build order:
#: setup_draw_r2 key -> (row id, display name, the judged drawing's `shape` fact). Same layer, same flag, same key.
_SETUP_DRAW_R2_FUNCS = (
    ("rsi_bullish_divergence", "draw:rsi-bullish-divergence", "RSI bullish divergence", "rsi_bullish_divergence"),
    ("wyckoff_upthrust", "draw:wyckoff-upthrust", "Wyckoff upthrust", "wyckoff_upthrust"),
    ("channel", "draw:channel", "Price channel", "channel"),
    ("pennant", "draw:pennant", "Pennant", "pennant"),
    ("darvas_box", "draw:darvas-box", "Darvas box", "bc:darvas-box"),
    ("falling_wedge", "draw:falling-wedge", "Falling wedge", "falling_wedge"),
    ("double_top", "draw:double-top", "Double top", "double_top"),
    ("golden_cross", "draw:golden-cross", "Golden cross", "golden_cross"),
    ("death_cross", "draw:death-cross", "Death cross", "death_cross"),
)
SETUP_DRAW_R2_IDS = tuple(pid for _k, pid, _n, _s in _SETUP_DRAW_R2_FUNCS)
#: Round-3 setup drawings (api/services/pattern_engine/setup_draw_r3.py, textbook fixes), in build order: same
#: tuple shape as round 2. Same layer, same flag, same key.
_SETUP_DRAW_R3_FUNCS = (
    ("outside_bar", "draw:outside-bar", "Outside bar", "outside_bar"),
    ("descending_triangle", "draw:descending-triangle", "Descending triangle", "descending_triangle"),
    ("inverse_head_shoulders", "draw:inverse-head-shoulders", "Inverse head and shoulders", "inverse_head_shoulders"),
    ("bear_flag", "draw:bear-flag", "Bear flag", "bear_flag"),
    ("bollinger_squeeze", "draw:bollinger-squeeze", "Bollinger squeeze", "bollinger_squeeze"),
    ("major_trendlines", "draw:major-trendline", "Major trendline", "major_trendlines"),
)
SETUP_DRAW_R3_IDS = tuple(pid for _k, pid, _n, _s in _SETUP_DRAW_R3_FUNCS)
#: The rectangle (horizontal trading range) drawing (RECTANGLE_DRAW_ID): ONE box, same layer, same flag, same key.
SETUP_DRAW_RECT_IDS = (RECTANGLE_DRAW_ID,)
SETUP_DRAW_IDS = ("draw:remount", "draw:u_and_r", "draw:donchian_breakout") + SETUP_DRAW_R2_IDS + SETUP_DRAW_R3_IDS \
    + SETUP_DRAW_RECT_IDS
#: setup_draw key -> (row id, display name).
_SETUP_DRAW_FUNCS = (
    ("remount", "draw:remount", "Remount"),
    ("u_and_r", "draw:u_and_r", "Undercut & Rally"),
    ("donchian_breakout", "draw:donchian_breakout", "Donchian breakout (55-bar)"),
)
#: The drawing round each setup's blind check confirmed for members -- None: NOT released. Literals ON PURPOSE,
#: never setup_draw's *_DRAW_ROUND constants: a member gets a drawing only while its literal equals the frozen
#: round AND its id is in registry.DISPLAY_MEMBER_SET (member_rows also requires the trusted tier). Fail closed.
#: remount round 3 (A 2.48 / 92%, B 2.42 / 92%) and u_and_r round 2 (A 2.56 / 100%, B 2.50 / 92%) passed both
#: pre-registered blind packets. donchian_breakout round 1 passed too (A 2.70 / 100%, B 2.80 / 100%); owner
#: released 2026-10-24: its literal is 1 and its id is in DISPLAY_TEAM_SET and DISPLAY_MEMBER_SET. Withdrawing it is
#: one literal: set it to None (or take the id out of either registry set) and member_rows drops it.
#: WITHDRAWN 2026-10-24 (remount and u_and_r: None). Recertification C re-judged both on the strict textbook rubric
#: (four pre-registered packets of 25 random liquid charts 2023-06..2026-10, two fresh blind judges each; bar: every
#: packet mean >= 2.3 and >= 70% of charts >= 2, pooled >= 2.4). remount round 3: 2.04 / 1.96 / 2.02 / 1.80, pooled
#: 1.96 (chop lines, marginal or light-volume reclaims, brief losses); its fix round (lab textbook gate) 2.06 / 2.14 /
#: 2.40 / 1.96, pooled 2.14. u_and_r round 2: 1.96 / 2.06 / 1.92 / 1.76, pooled 1.93 (marginal reclaims, lower-high
#: downtrends); a fix round could not field 100 eligible held-out charts. Evidence: lab/recert/C_setups. The ids stay
#: in both registry sets (the team chart keeps them); setting a literal back needs a new passed blind round.
MEMBER_REMOUNT_ROUND = None
MEMBER_U_AND_R_ROUND = None
#: donchian_breakout: owner released 2026-10-24 at round 1, then WITHDRAWN the same day by recert B: the strict textbook
#: round DC1 failed it (1.62 / 1.44 / 1.66 / 1.40, pooled 1.53) and its fix round with a textbook gate (lab gate_dc,
#: whole bars.db history 1995-2026, four packets of 25, two fresh judges each) failed too: 2.10 / 2.06 / 2.26 / 2.10,
#: pooled 2.13 (mostly a close barely over the line, no real base under it, average volume). Evidence:
#: lab/recert/B_pivots (PREREG_FR.txt, out/score_donchian_fr1.json).
MEMBER_DONCHIAN_BREAKOUT_ROUND = None
#: Round-2 setup drawings released to members: each passed two pre-registered blind packets AS DRAWN (two fresh
#: judges per packet, 25 random liquid held-out charts each; bar: mean >= 2.3 AND >= 70% of charts >= 2):
#:   rsi_bullish_divergence  A 2.56 / 96%   B 2.72 / 100%   (drawn on price AND on an RSI(14) panel)
#:   wyckoff_upthrust        A 2.56 / 100%  B 2.48 / 96%    (bearish)
#:   channel                 A 2.84 / 100%  B 2.48 / 100%
#:   pennant                 A 2.46 / 88%   B 2.34 / 80%
#:   darvas_box              A 2.62 / 96%   B 2.60 / 92%
#:   falling_wedge           A 2.84 / 100%  B 2.76 / 100%
#:   double_top              A 2.38 / 84%   B 2.56 / 88%    (bearish)
#:   golden_cross            A 2.52 / 88%   B 2.46 / 84%    (two rows: the 50-day and the 200-day SMA curves)
#:   death_cross             A 2.42 / 92%   B 2.34 / 92%    (bearish; two rows, as the golden cross)
#: Literals ON PURPOSE (never setup_draw_r2.R2_DRAW_ROUND): a new drawing round cannot release itself.
MEMBER_RSI_BULLISH_DIVERGENCE_ROUND = 2
MEMBER_WYCKOFF_UPTHRUST_ROUND = 2
MEMBER_CHANNEL_ROUND = 2
MEMBER_PENNANT_ROUND = 2
MEMBER_DARVAS_BOX_ROUND = 2
MEMBER_FALLING_WEDGE_ROUND = 2
MEMBER_DOUBLE_TOP_ROUND = 2
MEMBER_GOLDEN_CROSS_ROUND = 2
MEMBER_DEATH_CROSS_ROUND = 2
#: Round-3 setup drawings released to members (each passed two pre-registered blind packets AS DRAWN, same bar):
#:   outside_bar             A 2.72 / 96%   B 2.96 / 100%
#:   descending_triangle     A 2.60 / 100%  B 2.86 / 100%   (bearish)
#:   inverse_head_shoulders  A 2.34 / 84%   B 2.30 / 84%
#:   bear_flag               A 2.32 / 96%   B 2.34 / 88%    (bearish)
#:   bollinger_squeeze       A 2.42 / 84%   B 2.30 / 88%
#:   major_trendlines        A 2.48 / 92%   B 2.74 / 96%    (one line; semantic_subtype single_trendline)
#: Literals ON PURPOSE (never setup_draw_r3.R3_DRAW_ROUND): a new drawing round cannot release itself.
MEMBER_OUTSIDE_BAR_ROUND = 3
MEMBER_DESCENDING_TRIANGLE_ROUND = 3
MEMBER_INVERSE_HEAD_SHOULDERS_ROUND = 3
MEMBER_BEAR_FLAG_ROUND = 3
MEMBER_BOLLINGER_SQUEEZE_ROUND = 3
MEMBER_MAJOR_TRENDLINES_ROUND = 3
#: The rectangle drawing released to members: round 1 passed two pre-registered blind packets AS DRAWN (two fresh
#: judges per packet, 25 seeded charts each drawn round-robin across 1995..2026; bar: mean >= 2.3 AND >= 70% >= 2):
#:   rectangle               A 2.44 / 100%  B 2.76 / 96%
#: Literal ON PURPOSE (never setup_draw_rectangle.RECTANGLE_DRAW_ROUND): a new drawing round cannot release itself.
MEMBER_RECTANGLE_ROUND = 1
#: How many sessions of RSI(14) the divergence's panel carries (the judged frame shows at most 250 bars).
SETUP_RSI_PANEL_BARS = 250
#: The judged frames: each setup family is drawn only on the population its passed blind round SAMPLED (owner
#: decision 2026-10-24: each family is served on the frame it was certified on). Both frames need >= SETUP_MIN_BARS
#: daily bars and an as-of close > SETUP_MIN_CLOSE; they differ in the liquidity floor:
#:   SETUP_FRAME_DAY    the as-of session's close x volume >= SETUP_MIN_DOLLAR_VOLUME (one day). The rule of
#:                      release_g4 (donchian, remount, u_and_r), setups_r2 (every round-2 drawing) and setups_r3
#:                      batches b1 (outside_bar) and b2 (major_trendlines), whose PREREGs sample "close > $5,
#:                      close x volume >= $20M".
#:   SETUP_FRAME_ADV20  the mean close x volume of the last SETUP_ADV_SESSIONS completed sessions (the as-of one
#:                      included) >= SETUP_MIN_ADV_DOLLAR_VOLUME. The recert supply rule of setups_r3 b3 AMENDMENT S2
#:                      (descending_triangle, inverse_head_shoulders, bear_flag, bollinger_squeeze) and
#:                      rectangle_v2 PREREG_r2 (rectangle): "close > $5, 20-day average dollar volume >= $5M".
#: Outside a family's frame there is no drawing of that family. SETUP_FRAME_BY_ID maps every setup-drawing id;
#: an id missing from it is never drawn (fail closed).
SETUP_MIN_BARS = 261
SETUP_MIN_CLOSE = 5.0
SETUP_MIN_DOLLAR_VOLUME = 20e6
SETUP_ADV_SESSIONS = 20
SETUP_MIN_ADV_DOLLAR_VOLUME = 5e6
SETUP_FRAME_DAY = "day"
SETUP_FRAME_ADV20 = "adv20"
_SETUP_ADV20_IDS = ("draw:descending-triangle", "draw:inverse-head-shoulders", "draw:bear-flag",
                    "draw:bollinger-squeeze", RECTANGLE_DRAW_ID)
SETUP_FRAME_BY_ID = {pid: (SETUP_FRAME_ADV20 if pid in _SETUP_ADV20_IDS else SETUP_FRAME_DAY)
                     for pid in SETUP_DRAW_IDS}
_SETUP_CACHE: dict = {}
_SETUP_LOCK = threading.Lock()


def g4_setups_enabled() -> bool:
    """AUTO_STRUCTURES_G4_SETUPS_ENABLED, read PER CALL; unset means OFF. Off, nothing below runs and every payload
    is exactly what it was before the setup drawings existed (no `setup_draws` key). The kill switch is this flag."""
    return os.environ.get("AUTO_STRUCTURES_G4_SETUPS_ENABLED", "0").strip().lower() in _TRUTHY


def _member_setup_round(pid):
    """The released member round for one setup-drawing id (read PER CALL so a test can move one literal)."""
    return {
        "draw:remount": MEMBER_REMOUNT_ROUND,
        "draw:u_and_r": MEMBER_U_AND_R_ROUND,
        "draw:donchian_breakout": MEMBER_DONCHIAN_BREAKOUT_ROUND,
        "draw:rsi-bullish-divergence": MEMBER_RSI_BULLISH_DIVERGENCE_ROUND,
        "draw:wyckoff-upthrust": MEMBER_WYCKOFF_UPTHRUST_ROUND,
        "draw:channel": MEMBER_CHANNEL_ROUND,
        "draw:pennant": MEMBER_PENNANT_ROUND,
        "draw:darvas-box": MEMBER_DARVAS_BOX_ROUND,
        "draw:falling-wedge": MEMBER_FALLING_WEDGE_ROUND,
        "draw:double-top": MEMBER_DOUBLE_TOP_ROUND,
        "draw:golden-cross": MEMBER_GOLDEN_CROSS_ROUND,
        "draw:death-cross": MEMBER_DEATH_CROSS_ROUND,
        "draw:outside-bar": MEMBER_OUTSIDE_BAR_ROUND,
        "draw:descending-triangle": MEMBER_DESCENDING_TRIANGLE_ROUND,
        "draw:inverse-head-shoulders": MEMBER_INVERSE_HEAD_SHOULDERS_ROUND,
        "draw:bear-flag": MEMBER_BEAR_FLAG_ROUND,
        "draw:bollinger-squeeze": MEMBER_BOLLINGER_SQUEEZE_ROUND,
        "draw:major-trendline": MEMBER_MAJOR_TRENDLINES_ROUND,
        RECTANGLE_DRAW_ID: MEMBER_RECTANGLE_ROUND,
    }.get(pid)


def _confirmed_setup_draw(row) -> bool:
    """True when a setup-drawing row is drawn by its setup's released round: the member literal is an int (None =
    not released: always False) equal to the frozen setup_draw round AND to the row's own stamp, beside a
    well-formed draw_setup (its own setup, a finite level) and a horizontal_line with >= 2 anchors at finite
    prices. Anything else is False."""
    try:
        from api.services.pattern_engine import setup_draw
        r = row or {}
        pid = r.get("pattern_id")
        want = _member_setup_round(pid)
        if pid == RECTANGLE_DRAW_ID:
            return _confirmed_setup_draw_rect(r, want)
        if pid in SETUP_DRAW_R2_IDS:
            return _confirmed_setup_draw_r2(r, want)
        if pid in SETUP_DRAW_R3_IDS:
            return _confirmed_setup_draw_r3(r, want)
        key = next((k for k, i, _n in _SETUP_DRAW_FUNCS if i == pid), None)
        if key is None or not (type(want) is int and want == setup_draw.DRAW_ROUNDS.get(key)):
            return False
        geom = r.get("geometry") or {}
        ex = geom.get("extras") or {}
        rnd = ex.get("draw_round")
        if not (type(rnd) is int and rnd == want):
            return False
        d = ex.get("draw_setup")
        if not isinstance(d, dict) or d.get("shape") != key or d.get("draw_round") != rnd or not _finite(d.get("level")):
            return False
        anchors = geom.get("anchors")
        return (geom.get("shape") == "horizontal_line" and isinstance(anchors, list) and len(anchors) >= 2
                and all(isinstance(a, dict) and a.get("t") is not None and _finite(a.get("price")) for a in anchors))
    except Exception:  # noqa: BLE001 -- an unreadable row is not served
        return False


#: row id -> the geometry shape its judged drawing has, and the exact anchor count of that shape.
_R2_SHAPE_OF = {
    "draw:rsi-bullish-divergence": "neckline", "draw:wyckoff-upthrust": "horizontal_line",
    "draw:channel": "trendline_pair", "draw:pennant": "trendline_pair", "draw:darvas-box": "rectangle",
    "draw:falling-wedge": "trendline_pair", "draw:double-top": "neckline",
    "draw:golden-cross": "horizontal_line", "draw:death-cross": "horizontal_line",
}
#: row id -> the exact anchor count of its judged geometry.
_R2_ANCHORS = {
    "draw:rsi-bullish-divergence": 2, "draw:wyckoff-upthrust": 3, "draw:channel": 4, "draw:pennant": 4,
    "draw:darvas-box": 2, "draw:falling-wedge": 4, "draw:double-top": 3,
    "draw:golden-cross": 2, "draw:death-cross": 2,
}
#: The rows whose judged drawing is a moving-average CURVE (extras.draw_ema), one row per average.
_R2_CURVE_IDS = ("draw:golden-cross", "draw:death-cross")


def _confirmed_setup_draw_r2(r, want) -> bool:
    """A round-2 setup row is served to a member only when its literal is an int equal to the frozen round AND to the
    row's stamp, its draw_setup names its own judged shape, and its geometry is that setup's judged shape with
    finite anchors (and, for the divergence, a well-formed RSI panel: the judged picture has one)."""
    from api.services.pattern_engine import setup_draw_r2
    pid = r.get("pattern_id")
    meta = next((m for m in _SETUP_DRAW_R2_FUNCS if m[1] == pid), None)
    if meta is None or not (type(want) is int and want == setup_draw_r2.DRAW_ROUNDS.get(meta[0])):
        return False
    geom = r.get("geometry") or {}
    ex = geom.get("extras") or {}
    rnd = ex.get("draw_round")
    if not (type(rnd) is int and rnd == want):
        return False
    d = ex.get("draw_setup")
    if not isinstance(d, dict) or d.get("shape") != meta[3]:
        return False
    shape = geom.get("shape")
    anchors = geom.get("anchors")
    if shape != _R2_SHAPE_OF.get(pid) or not isinstance(anchors, list) or len(anchors) != _R2_ANCHORS[pid]:
        return False
    if not all(isinstance(a, dict) and a.get("t") is not None and _finite(a.get("price")) for a in anchors):
        return False
    if pid in _R2_CURVE_IDS:
        em = ex.get("draw_ema")
        pts = em.get("points") if isinstance(em, dict) else None
        if not (isinstance(pts, list) and len(pts) >= 2
                and all(isinstance(p, dict) and p.get("t") is not None and _finite(p.get("price")) for p in pts)):
            return False
    if pid == "draw:rsi-bullish-divergence":
        pn = ex.get("draw_panel")
        if not (isinstance(pn, dict) and pn.get("kind") == "rsi14" and isinstance(pn.get("points"), list)
                and len(pn["points"]) >= 2 and all(_finite((pn.get(k) or {}).get("value")) for k in ("p1", "p2"))):
            return False
    return True


#: round 3: row id -> the geometry shape of its judged drawing, and that shape's exact anchor count.
_R3_SHAPE_OF = {
    "draw:outside-bar": "rectangle",
    "draw:descending-triangle": "trendline_pair",
    "draw:inverse-head-shoulders": "neckline",
    "draw:bear-flag": "trendline_pair",
    "draw:bollinger-squeeze": "rectangle",
    "draw:major-trendline": "trendline_pair",
}
_R3_ANCHORS = {
    "draw:outside-bar": 2,
    "draw:descending-triangle": 4,
    "draw:inverse-head-shoulders": 5,
    "draw:bear-flag": 4,
    "draw:bollinger-squeeze": 2,
    "draw:major-trendline": 2,
}
#: round 3: the rows whose judged drawing is ONE line (trendline_pair, semantic_subtype single_trendline).
_R3_SINGLE_LINE_IDS = ("draw:major-trendline",)


def _confirmed_setup_draw_r3(r, want) -> bool:
    """A round-3 setup row is served to a member only when its literal is an int equal to the frozen round AND to the
    row's stamp, its draw_setup names its own judged shape, and its geometry is that setup's judged shape with the
    judged anchor count at finite prices (and, for the single trendline, the single_trendline subtype the renderer
    needs to draw ONE line)."""
    from api.services.pattern_engine import setup_draw_r3
    pid = r.get("pattern_id")
    meta = next((m for m in _SETUP_DRAW_R3_FUNCS if m[1] == pid), None)
    if meta is None or not (type(want) is int and want == setup_draw_r3.DRAW_ROUNDS.get(meta[0])):
        return False
    geom = r.get("geometry") or {}
    ex = geom.get("extras") or {}
    rnd = ex.get("draw_round")
    if not (type(rnd) is int and rnd == want):
        return False
    d = ex.get("draw_setup")
    if not isinstance(d, dict) or d.get("shape") != meta[3]:
        return False
    anchors = geom.get("anchors")
    if geom.get("shape") != _R3_SHAPE_OF.get(pid) or not isinstance(anchors, list) or len(anchors) != _R3_ANCHORS[pid]:
        return False
    if not all(isinstance(a, dict) and a.get("t") is not None and _finite(a.get("price")) for a in anchors):
        return False
    if pid in _R3_SINGLE_LINE_IDS and geom.get("semantic_subtype") != "single_trendline":
        return False
    return True


def _setup_draw_r3_rows(sym: str, b: list) -> list:
    """The round-3 rows for the in-frame COMPLETED daily `b`: the judged geometry exactly (setup_draw_r3's det:
    shape, anchors, line_spaces, the flag's pole, the single trendline's subtype), stamped with the drawing round and
    its facts. A failing setup costs that setup only."""
    from api.services.pattern_engine import setup_draw_r3
    out = []
    w = setup_draw_r3._window(b)
    for key, pid, name, _shape in _SETUP_DRAW_R3_FUNCS:
        try:
            d = setup_draw_r3.detect(key, b)
        except Exception:  # noqa: BLE001 -- a failing setup costs that setup only
            _log.debug("[setup-draw-r3] %s %s failed", sym, key, exc_info=True)
            continue
        if d is None:
            continue
        for k_det, det in enumerate(d["dets"]):
            row = _r2_row(sym, pid, name, d, det, k_det, w, setup_draw_r3, rnd=setup_draw_r3.R3_DRAW_ROUND)
            if row is not None:
                out.append(row)
    return out


def _setup_draw_r2_rows(sym: str, b: list) -> list:
    """The round-2 rows for the in-frame COMPLETED daily `b`: the judged geometry exactly (setup_draw_r2's det: shape,
    anchors, line_spaces, the pennant's pole), stamped with the drawing round and its facts; the divergence also
    carries its RSI(14) panel. A failing setup costs that setup only."""
    from api.services.pattern_engine import setup_draw_r2
    out = []
    w = setup_draw_r2._window(b)
    for key, pid, name, _shape in _SETUP_DRAW_R2_FUNCS:
        try:
            d = setup_draw_r2.detect(key, b)
        except Exception:  # noqa: BLE001 -- a failing setup costs that setup only
            _log.debug("[setup-draw-r2] %s %s failed", sym, key, exc_info=True)
            continue
        if d is None:
            continue
        for k_det, det in enumerate(d["dets"]):
            row = _r2_row(sym, pid, name, d, det, k_det, w, setup_draw_r2)
            if row is not None:
                out.append(row)
    return out


#: The two averages a cross row draws, in the judged dets order.
_R2_CURVE_PERIODS = (50, 200)


def _r2_row(sym, pid, name, d, det, k_det, w, setup_draw_r2, rnd=None):
    """One member-shaped row for one judged det (most setups have exactly one). `setup_draw_r2` is the drawing
    module (round 2 or 3); `rnd` its frozen round (default: round 2's)."""
    geom = det["geometry"]
    extras = {k: v for k, v in (geom.get("extras") or {}).items()
              if k in ("line_spaces", "draw_pole", "draw_ema")}
    if "draw_ema" in extras:
        # the label EmaSegment prints ("50 SMA ..."): display decoration only, the points are the judged curve
        extras["draw_ema"] = {**extras["draw_ema"], "kind": "sma", "period": _R2_CURVE_PERIODS[k_det]}
    extras.update({"draw_setup": setup_draw_r2.facts(d),
                   "draw_round": setup_draw_r2.R2_DRAW_ROUND if rnd is None else rnd})
    pn = d.get("panel")
    if pn:
        rsi = pn["rsi"]
        lo = max(0, len(w) - SETUP_RSI_PANEL_BARS)
        extras["draw_panel"] = {
            "kind": "rsi14", "guides": [70, 30],
            "points": [{"t": int(w[j]["t"]), "value": round(rsi[j], 2)} for j in range(lo, len(w))
                       if rsi[j] is not None],
            "p1": {"t": int(w[pn["p1"]]["t"]), "value": round(rsi[pn["p1"]], 2)},
            "p2": {"t": int(w[pn["p2"]]["t"]), "value": round(rsi[pn["p2"]], 2)},
        }
    suffix = f":{k_det}" if len(d["dets"]) > 1 else ""
    row = {
        "id": f"{pid}:{sym}:{det['start_t']}:{det['end_t']}{suffix}",
        "sym": sym,
        "tf": "D",
        "pattern_id": pid,
        "pattern_name": name,
        "category": "setup",
        "direction": det.get("direction") or "neutral",
        "start_t": det["start_t"],
        "end_t": det["end_t"],
        "geometry": {"shape": geom["shape"], "anchors": [dict(a) for a in geom["anchors"]], "extras": extras,
                     **({"semantic_subtype": "single_trendline"}
                        if geom.get("semantic_subtype") == "single_trendline" else {})},
        "levels": {"entry": d["level"]} if "level" in d else {},
        "confidence": None,
        "status": "forming",
        **display_policy(pid),
    }
    if det.get("touch_count") is not None:
        row["touch_count"] = det["touch_count"]
    return row


def _confirmed_setup_draw_rect(r, want) -> bool:
    """A rectangle row is served to a member only when its literal is an int equal to the frozen round AND to the
    row's own stamp, its draw_setup is the rectangle's (finite top above a finite floor, the same round), and its
    geometry is the judged box: a `rectangle` with exactly 2 anchors at finite prices, the first one the top."""
    from api.services.pattern_engine import setup_draw_rectangle
    if not (type(want) is int and want == setup_draw_rectangle.RECTANGLE_DRAW_ROUND):
        return False
    geom = r.get("geometry") or {}
    ex = geom.get("extras") or {}
    rnd = ex.get("draw_round")
    if not (type(rnd) is int and rnd == want):
        return False
    d = ex.get("draw_setup")
    if not (isinstance(d, dict) and d.get("shape") == "rectangle" and d.get("draw_round") == rnd
            and _finite(d.get("top")) and _finite(d.get("floor")) and float(d["top"]) > float(d["floor"])):
        return False
    anchors = geom.get("anchors")
    if geom.get("shape") != "rectangle" or not isinstance(anchors, list) or len(anchors) != 2:
        return False
    if not all(isinstance(a, dict) and a.get("t") is not None and _finite(a.get("price")) for a in anchors):
        return False
    return float(anchors[0]["price"]) > float(anchors[1]["price"])


def _setup_draw_rect_rows(sym: str, b: list) -> list:
    """The rectangle row for the in-frame COMPLETED daily `b`: the judged box exactly (setup_draw_rectangle's det),
    stamped with the drawing round and its facts. No entry level: the judged drawing is the box alone."""
    from api.services.pattern_engine import setup_draw_rectangle
    try:
        d = setup_draw_rectangle.detect(b)
    except Exception:  # noqa: BLE001 -- a failing setup costs that setup only
        _log.debug("[setup-draw-rect] %s failed", sym, exc_info=True)
        return []
    if d is None:
        return []
    det = d["det"]
    geom = det["geometry"]
    return [{
        "id": f"{RECTANGLE_DRAW_ID}:{sym}:{det['start_t']}:{det['end_t']}",
        "sym": sym,
        "tf": "D",
        "pattern_id": RECTANGLE_DRAW_ID,
        "pattern_name": "Rectangle",
        "category": "setup",
        "direction": det.get("direction") or "bullish",
        "start_t": det["start_t"],
        "end_t": det["end_t"],
        "geometry": {"shape": geom["shape"], "anchors": [dict(a) for a in geom["anchors"]],
                     "extras": {"draw_setup": setup_draw_rectangle.facts(d), "draw_round": d["draw_round"]}},
        "levels": {},
        "confidence": None,
        "status": "forming",
        **display_policy(RECTANGLE_DRAW_ID),
    }]


def setup_in_frame(bars, frame=SETUP_FRAME_DAY) -> bool:
    """Whether COMPLETED daily `bars` (the last one the as-of session) sit inside judged `frame` (see
    SETUP_FRAME_BY_ID). An unknown frame is outside (fail closed)."""
    if len(bars or []) < SETUP_MIN_BARS:
        return False
    last = bars[-1]
    if not last["c"] > SETUP_MIN_CLOSE:
        return False
    if frame == SETUP_FRAME_DAY:
        return last["c"] * (last["v"] or 0) >= SETUP_MIN_DOLLAR_VOLUME
    if frame == SETUP_FRAME_ADV20:
        tail = bars[-SETUP_ADV_SESSIONS:]
        return sum(x["c"] * (x["v"] or 0) for x in tail) / SETUP_ADV_SESSIONS >= SETUP_MIN_ADV_DOLLAR_VOLUME
    return False


def setup_frames_held(bars) -> frozenset:
    """The judged frames COMPLETED daily `bars` sit inside."""
    return frozenset(f for f in (SETUP_FRAME_DAY, SETUP_FRAME_ADV20) if setup_in_frame(bars, f))


def _in_frame(pid, held) -> bool:
    return SETUP_FRAME_BY_ID.get(pid) in held


def setup_draw_rows(sym: str, bars: list) -> list:
    """The setup-drawing rows for COMPLETED daily `bars` ({t,o,h,l,c,v}, oldest first, the last one the as-of bar):
    one row per setup whose drawing fires there, every setup (the member filter is member_rows). Outside the judged
    frame: []. The row's geometry is the judged drawing exactly (setup_draw's `det`); extras carry the drawing round
    and its facts. A failing setup costs that setup only. Never raises."""
    out: list = []
    try:
        from api.services.pattern_engine import setup_draw
        b = list(bars or [])
        held = setup_frames_held(b)
        if not held:
            return []
        sym = (sym or "").upper()
        for key, pid, name in _SETUP_DRAW_FUNCS:
            if not _in_frame(pid, held):
                continue
            try:
                d = setup_draw.detect(key, b)
            except Exception:  # noqa: BLE001 -- a failing setup costs that setup only
                _log.debug("[setup-draw] %s %s failed", sym, key, exc_info=True)
                continue
            if d is None:
                continue
            det = d["det"]
            geom = det["geometry"]
            out.append({
                "id": f"{pid}:{sym}:{det['start_t']}:{det['end_t']}",
                "sym": sym,
                "tf": "D",
                "pattern_id": pid,
                "pattern_name": name,
                "category": "setup",
                "direction": "bullish",
                "start_t": det["start_t"],
                "end_t": det["end_t"],
                "geometry": {
                    "shape": geom["shape"],
                    "anchors": [dict(a) for a in geom["anchors"]],
                    "extras": {"draw_setup": setup_draw.facts(d), "draw_round": d["draw_round"]},
                },
                "levels": {"entry": d["level"]},
                "confidence": None,
                "status": "forming",
                **display_policy(pid),
            })
        for ids, rows_fn in ((SETUP_DRAW_R2_IDS, _setup_draw_r2_rows), (SETUP_DRAW_R3_IDS, _setup_draw_r3_rows),
                             (SETUP_DRAW_RECT_IDS, _setup_draw_rect_rows)):
            if any(_in_frame(pid, held) for pid in ids):
                out.extend(r for r in rows_fn(sym, b) if _in_frame(r.get("pattern_id"), held))
    except Exception:  # noqa: BLE001 -- a drawing layer never breaks a read
        return []
    return out


def setup_draws_for(sym: str, *, member: bool = False):
    """The `setup_draws` list for `sym`'s daily chart, or None (no key). Gated: AUTO_STRUCTURES_G4_SETUPS_ENABLED
    (default off; nothing runs while it is off). A member gets only the rows member_rows serves (the released
    literal, the member set, the trusted tier); an admin gets every setup. Reads only bars up to the last COMPLETED
    session (an unknown session clock draws nothing). Present (possibly empty) while released to this viewer, so the
    key itself is the UCT Intelligence "Setups" toggle's signal. One computed answer per (ticker, last completed
    session). Any failure -> None (no key). Never raises."""
    try:
        if not g4_setups_enabled():
            return None
        sym = (sym or "").upper()
        bars = _shelf_bars(sym)          # the last COMPLETED session's 600-bar window (>= setup_draw.WINDOW)
        if not bars:
            return None
        key = int(bars[-1]["t"])
        with _SETUP_LOCK:
            hit = _SETUP_CACHE.get(sym)
        if hit and hit[0] == key:
            rows = hit[1]
        else:
            rows = setup_draw_rows(sym, bars)
            with _SETUP_LOCK:
                _SETUP_CACHE[sym] = (key, rows)
        return member_rows(rows) if member else list(rows)
    except Exception as e:  # noqa: BLE001 -- any failure draws no line
        _log.debug("[setup-draw] %s failed: %s", sym, e)
        return None
