"""Pure watch-rule functions for the Awareness Engine (Milestone 1).

Every rule has the same shape: (scan_ctx, user_ctx) -> list[InsightCandidate].
scan_ctx is the ONE shared market-wide computation for this cycle (live
prices, regime, earnings window) built once by engine.py. user_ctx is that
one user's bulk-loaded positions + watchlist symbols. Rules never touch the
database or the network — engine.py owns all I/O.

The relevance score is deterministic and pure:
    importance = clamp(round(base_signal * personal_multiplier * urgency * 10), 1, 10)

  - base_signal (0.0-1.0): raw strength of the trigger itself (e.g. 1.0 for
    a stop that's been hit, 0.4-0.7 for "nearing" it).
  - personal_multiplier (~0.5-1.6): how much this matters to THIS user
    (owns it vs. just watches it).
  - urgency (~1.0-2.0): how time-sensitive it is (today vs. a few days out).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from api.services.placeholder_stop import is_placeholder_stop


@dataclass(frozen=True)
class InsightCandidate:
    kind: str
    symbol: str | None
    headline: str
    body: str | None
    base_signal: float
    personal_multiplier: float
    urgency: float
    # Passed as `symbol=` to add_insight() for its per-symbol cooldown scope.
    # May be a composite key (e.g. "NVDA:earnings") so different rule kinds
    # on the same ticker don't share a cooldown window.
    dedup_key: str | None


def compute_relevance_score(
    base_signal: float, personal_multiplier: float = 1.0, urgency: float = 1.0,
) -> int:
    """The deterministic relevance-score formula. Pure; clamped to 1-10 so
    it's always a valid add_insight() importance value."""
    raw = float(base_signal) * float(personal_multiplier) * float(urgency) * 10.0
    return max(1, min(10, round(raw)))


NEAR_STOP_PCT = 0.03  # 3% — R2 "nearing stop" threshold


def _stop_distance_pct(side: str, price: float, stop: float) -> float:
    """Positive = price hasn't reached the stop yet (as a % of price).
    <= 0 means at or through the stop."""
    if side == "Long":
        return (price - stop) / price
    return (stop - price) / price  # Short


def rule_stop_watch(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]:
    """R1 (at/through stop) + R2 (nearing stop). Skips broker carried-in
    positions whose stop is a NOT-NULL placeholder (stop_price==entry_price,
    source=='broker') -- see journal_two/broker/balances.py."""
    out: list[InsightCandidate] = []
    live_prices: dict = scan_ctx.get("live_prices") or {}

    for pos in user_ctx.get("positions") or []:
        sym = (pos.get("symbol") or "").upper()
        side = pos.get("side")
        stop = pos.get("stop_price")
        entry = pos.get("entry_price")
        source = pos.get("source")
        if not sym or side not in ("Long", "Short") or stop is None or entry is None:
            continue
        # ⚰️ H14 — THIS WAS THE NARROWEST OF THREE TOLERANCES AND IT MISSED THE
        # ROW THAT ACTUALLY HAPPENED. Retired verbatim:
        #
        #     if source == "broker" and abs(float(stop) - float(entry)) < 1e-9:
        #         continue  # placeholder stop -- nothing real to watch
        #
        # ORCL: a later sync refreshed entry_price to 126.0049 and left the
        # placeholder at 126.005 — a drift of 1.0e-4, five orders of magnitude
        # past this test. The row then reached the distance test below, and a
        # stop at-or-through the price emits `stop_hit` at importance 10, which
        # away-delivers by email and Discord. A stop alert about a stop the
        # member never set.
        #
        # ⛔ THE SOURCE GATE STAYS HERE, ON PURPOSE. `is_placeholder_stop`
        # answers one numeric question; whether a placeholder should be SKIPPED
        # is this rule's policy and differs from portfolio_heat's, which
        # excludes them from its confident number and then SURFACES them.
        if source == "broker" and is_placeholder_stop(stop, entry):
            continue  # placeholder stop -- nothing real to watch

        price = live_prices.get(sym)
        if not price or price <= 0:
            continue  # no cached price this cycle -- never fetch per-position

        distance_pct = _stop_distance_pct(side, float(price), float(stop))

        if distance_pct <= 0:
            out.append(InsightCandidate(
                kind="stop_hit", symbol=sym,
                headline=f"{sym} is AT or THROUGH its stop",
                body=(f"{side} {sym}: stop {float(stop):.2f}, current price "
                      f"{float(price):.2f}. Review the position now."),
                base_signal=1.0, personal_multiplier=1.3, urgency=2.0,
                # Distinct cooldown namespace from stop_proximity: an earlier
                # "nearing stop" warning must never swallow the THROUGH-the-stop
                # escalation via add_insight's 6h per-symbol cooldown.
                dedup_key=f"{sym}:stop_hit",
            ))
        elif distance_pct <= NEAR_STOP_PCT:
            base_signal = 0.4 + (1.0 - distance_pct / NEAR_STOP_PCT) * 0.3
            out.append(InsightCandidate(
                kind="stop_proximity", symbol=sym,
                headline=f"{sym} is nearing its stop",
                body=(f"{side} {sym}: stop {float(stop):.2f}, current price "
                      f"{float(price):.2f} ({distance_pct * 100:.1f}% away)."),
                base_signal=base_signal, personal_multiplier=1.2, urgency=1.3,
                dedup_key=f"{sym}:stop_near",
            ))
    return out


def rule_thesis_stop_review(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]:
    """R6 (G-074, competitive gap ledger) -- a position hitting its stop is
    exactly the moment the written reasoning behind it (a thesis, a captured
    fact, any research at all) is most worth re-reading before re-entering
    or moving on. Reuses R1's own AT/THROUGH-the-stop condition and
    placeholder-stop skip (the SAME distance test, the SAME reason a
    placeholder isn't a real stop) rather than re-deriving either -- this
    rule differs from R1 only in WHO it's for and WHERE it points, never in
    what counts as "hit."

    ⛔ FIRES ONLY WHEN THE MEMBER HAS SOME RESEARCH ON THE SYMBOL
    (`user_ctx["mentioned_symbols"]`, bulk-loaded by engine.py from
    `notes.bulk_member_mentioned_symbols` -- every note/embed/mention the
    member has ever made, trash excluded). "Review your thesis" is a
    non-sequitur for a symbol with zero research; gating on real research
    existing is what keeps this rule from firing for every stop-out
    regardless of whether there is anything to review.

    ⛔ NEVER fires on stop_proximity (nearing, not yet through) -- this is
    the "re-examine the reasoning" moment, not an early warning; R2 already
    owns the early-warning job. Distinct dedup_key namespace (`:thesis_
    review`) from R1's `:stop_hit`/`:stop_near` so this insight's own 6h
    cooldown can never suppress -- or be suppressed by -- R1's."""
    out: list[InsightCandidate] = []
    live_prices: dict = scan_ctx.get("live_prices") or {}
    mentioned = user_ctx.get("mentioned_symbols") or set()
    if not mentioned:
        return out  # nothing this member has ever written about -- cheap exit

    for pos in user_ctx.get("positions") or []:
        sym = (pos.get("symbol") or "").upper()
        side = pos.get("side")
        stop = pos.get("stop_price")
        entry = pos.get("entry_price")
        source = pos.get("source")
        if not sym or side not in ("Long", "Short") or stop is None or entry is None:
            continue
        if sym not in mentioned:
            continue
        if source == "broker" and is_placeholder_stop(stop, entry):
            continue  # same placeholder-stop skip as R1 -- nothing real to watch

        price = live_prices.get(sym)
        if not price or price <= 0:
            continue

        if _stop_distance_pct(side, float(price), float(stop)) <= 0:
            out.append(InsightCandidate(
                kind="thesis_stop_review", symbol=sym,
                headline=f"Your {sym} research may need a second look",
                body=(f"{side} {sym} just hit its stop. You've written research "
                      f"on this ticker — worth reviewing before you re-enter or "
                      f"move on."),
                base_signal=1.0, personal_multiplier=1.2, urgency=1.5,
                dedup_key=f"{sym}:thesis_review",
            ))
    return out


def rule_regime_flip(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]:
    """R4: fires once per (label, cycle) for any user with something at
    stake (an open position or a watched symbol) -- an inactive account
    with neither gets nothing. dedup_key is label-scoped (not per-user),
    so add_insight's 6h per-symbol cooldown naturally suppresses repeat
    firing for the SAME flip across scan cycles while allowing a genuine
    flip-back-and-forth to re-fire (different label string)."""
    regime = scan_ctx.get("regime") or {}
    label = regime.get("label")
    prev_label = regime.get("prev_label")
    # Explicit 0.0 is a legitimate zero-confidence reading -- only a MISSING
    # confidence falls back to the 0.5 default (never `or`, which eats 0.0).
    confidence = regime.get("confidence")
    confidence = 0.5 if confidence is None else float(confidence)
    if not label or not prev_label or label == prev_label:
        return []

    has_positions = bool(user_ctx.get("positions"))
    has_watch = bool(user_ctx.get("watch_syms"))
    if not has_positions and not has_watch:
        return []

    # The published words (TERM-041), never `id.replace("_", " ")` — that was a
    # second display vocabulary ("bull trend") beside the authority's ("Bull
    # trend"). dedup_key below stays keyed on the ID, so this changes no dedup.
    from api.services.voice_regime_classifier import label_of
    pretty_prev = label_of(prev_label)
    pretty_new = label_of(label)
    base_signal = 0.5 + 0.5 * min(1.0, max(0.0, float(confidence)))

    return [InsightCandidate(
        kind="regime_flip", symbol=None,
        headline=f"Market regime flipped: {pretty_prev} → {pretty_new}",
        body=(f"Confidence {float(confidence) * 100:.0f}%. Reassess exposure "
              f"and setup selection for the new regime."),
        base_signal=base_signal,
        personal_multiplier=1.3 if has_positions else 1.0,
        urgency=1.4,
        dedup_key=f"REGIME:{label}",
    )]


EARNINGS_PROXIMITY_DEFAULT_DAYS = 3


def rule_earnings_proximity(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]:
    """R5: fires for any owned OR watched symbol reporting within the
    proximity window. dedup_key is composite ("SYM:earnings") so it never
    shares a cooldown with a stop-watch insight on the same symbol.

    The window size comes from scan_ctx["earnings_window_days"] (set by
    engine.py from AWARENESS_EARNINGS_PROXIMITY_DAYS) so the rule's cutoff
    always matches the engine's collection window; falls back to the default."""
    out: list[InsightCandidate] = []
    earnings_by_symbol: dict = scan_ctx.get("earnings_by_symbol") or {}
    if not earnings_by_symbol:
        return out

    window_days = scan_ctx.get("earnings_window_days", EARNINGS_PROXIMITY_DEFAULT_DAYS)
    today = scan_ctx.get("today")
    owned_syms = {(p.get("symbol") or "").upper()
                  for p in (user_ctx.get("positions") or [])}
    watch_syms = {s.upper() for s in (user_ctx.get("watch_syms") or set())}
    mine = owned_syms | watch_syms

    for sym in mine:
        report_date_str = earnings_by_symbol.get(sym)
        if not report_date_str:
            continue
        try:
            report_date = date.fromisoformat(report_date_str)
        except ValueError:
            continue
        days_out = (report_date - today).days
        if days_out < 0 or days_out > window_days:
            continue

        owned = sym in owned_syms
        # base_signal scales inversely with days_out: today=1.0, floors at 0.3.
        base_signal = max(0.3, 1.0 - 0.2 * days_out)
        when = ("today" if days_out == 0 else
                "tomorrow" if days_out == 1 else f"in {days_out} days")

        out.append(InsightCandidate(
            kind="earnings_proximity", symbol=sym,
            headline=f"{sym} reports earnings {when}",
            body=(f"{'You own' if owned else 'On your watchlist'}: {sym} is "
                  f"scheduled to report on {report_date_str}."),
            base_signal=base_signal,
            personal_multiplier=1.4 if owned else 1.0,
            urgency=1.5 if days_out == 0 else 1.0,
            dedup_key=f"{sym}:earnings",
        ))
    return out


# ════════════════════════════════════════════════════════════════════════════
# Wave 13 lane 13D -- RESURFACING: R7 (a level named in a note), R8 (a large
# move), R9 (a named date). Everything ABOVE this banner is R1-R6, byte for byte
# as it was (tests/test_awareness_resurface.py pins those bytes); S7 is absorbing
# R1-R6 and nothing here edits them.
#
# The same shape as every rule above: pure (scan_ctx, user_ctx) -> candidates.
# What differs is the INPUT: user_ctx["note_levels"] is the member's rows of the
# level index (`journal_two/note_levels.py`, a projection of plan_extract's
# output -- never a second reader of a note), and scan_ctx["note_quotes"] is
# {SYMBOL: {"price", "change_pct"}} read from the SHARED live-price cache by
# engine.py (never a per-note fetch).
#
# ⛔ DELIVERY IS IN-APP ONLY. Every importance below is <= 7, under the away
# floor of 8, and engine.py fires these through `_fire_resurface`, which has no
# delivery branch at all. "One per level per day" and the 2-a-day sub-cap are
# I/O and live in engine.py / voice_proactive_service.add_insight.
# ════════════════════════════════════════════════════════════════════════════

#: R7: a price within this fraction of a named level "touches" it (0.5%).
NOTE_TOUCH_BAND_PCT = 0.005
#: R8: the mover insight's top tier (voice_proactive_service.scan_premarket's
#: `abs(pct_val) >= 8`), the day's change from the cached quote, in percent.
NOTE_BIG_MOVE_PCT = 8.0
#: R9: a named date fires on the day, or within this many days after it (the
#: scan runs on weekdays only, so a Saturday review date is still reached).
NOTE_DATE_LOOKBACK_DAYS = 3

#: The price roles an index row can carry (plan_extract.PRICE_ROLES).
NOTE_PRICE_ROLES = ("entry", "stop", "target")
#: The date roles (a Review Date property; a catalyst/event/earnings date property).
NOTE_DATE_ROLES = ("review_date", "catalyst_date")

_ROLE_WORD = {"entry": "entry", "stop": "stop", "target": "target"}
_DATE_WORD = {"review_date": "review date", "catalyst_date": "catalyst date"}


@dataclass(frozen=True)
class ResurfaceCandidate(InsightCandidate):
    """An InsightCandidate that also names the note to open. `fire_key` is the
    "one per level per day" key; `once` makes it once EVER (a date is reached
    once); `rank` orders a member's candidates so the 2-a-day sub-cap goes to
    the most useful first (lower first)."""
    note_id: str = ""
    version_id: str | None = None
    fire_key: str = ""
    once: bool = False
    rank: int = 9


def level_side(price: float, level: float) -> str:
    """Which side of `level` a price is on: 'above' (at counts as above) or
    'below'. The ONE definition: R7 compares against the stored previous side,
    and note_levels records the side this function says."""
    return "above" if float(price) >= float(level) else "below"


def _fmt_px(v) -> str:
    return f"{float(v):,.2f}"


def _quote(scan_ctx: dict, sym: str) -> dict:
    q = (scan_ctx.get("note_quotes") or {}).get(sym)
    return q if isinstance(q, dict) else {}


def _real_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _title(lv: dict) -> str:
    t = (lv.get("note_title") or "").strip()
    return t[:80] if t else "Untitled"


def _named_day(lv: dict) -> str:
    """The ET calendar day the note named it ("on 2026-09-12"). A stored stamp is UTC ISO;
    a UTC date would name tomorrow for an evening edit, so it is converted, never sliced."""
    v = lv.get("named_at")
    if not v:
        return "earlier"
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(ZoneInfo("America/New_York"))
        return f"on {dt.date().isoformat()}"
    except (ValueError, TypeError):
        return f"on {str(v)[:10]}"


def rule_note_level_touch(scan_ctx: dict, user_ctx: dict) -> list[ResurfaceCandidate]:
    """R7: the price TOUCHES a level a note named -- within NOTE_TOUCH_BAND_PCT of
    it, or on the other side of it from the last cycle (a cross between scans).
    A level with no previous side (first sighting) fires only inside the band.
    Placeholder stops never reach here: the index never stores one."""
    out: list[ResurfaceCandidate] = []
    for lv in user_ctx.get("note_levels") or []:
        role = lv.get("role")
        if role not in NOTE_PRICE_ROLES:
            continue
        sym = (lv.get("symbol") or "").upper()
        level = lv.get("price")
        if not sym or not _real_number(level) or level <= 0:
            continue
        px = _quote(scan_ctx, sym).get("price")
        if not _real_number(px) or px <= 0:
            continue  # no cached price this cycle -- never fetched per note
        dist = abs(float(px) - float(level)) / float(level)
        prev = lv.get("last_side")
        crossed = prev in ("above", "below") and prev != level_side(px, level)
        if dist > NOTE_TOUCH_BAND_PCT and not crossed:
            continue
        word = _ROLE_WORD[role]
        out.append(ResurfaceCandidate(
            kind="note_level_touch", symbol=sym,
            headline=f"{sym} reached {_fmt_px(level)}, the {word} you named",
            body=(f"In “{_title(lv)}” you named {_fmt_px(level)} as your {word} "
                  f"{_named_day(lv)}. {sym} is at {_fmt_px(px)} now. "
                  f"Here's what you thought then."),
            # 0.6 x 1.0 x 1.0 -> 6; a stop 0.6 x 1.0 x 1.15 -> 7. Never 8.
            base_signal=0.6, personal_multiplier=1.0,
            urgency=1.15 if role == "stop" else 1.0,
            dedup_key=f"{sym}:note_level",
            note_id=str(lv.get("note_id") or ""), version_id=lv.get("version_id"),
            fire_key=f"{lv.get('note_id')}|{lv.get('level_id')}",
            rank=0 if role == "stop" else 1,
        ))
    return out


def rule_note_big_move(scan_ctx: dict, user_ctx: dict) -> list[ResurfaceCandidate]:
    """R8: a ticker the member wrote a note on moves NOTE_BIG_MOVE_PCT or more on
    the day (the cached quote's change). One per symbol, opening the member's most
    recently edited note on it."""
    latest: dict[str, dict] = {}
    for lv in user_ctx.get("note_levels") or []:
        sym = (lv.get("symbol") or "").upper()
        if not sym:
            continue
        cur = latest.get(sym)
        if cur is None or str(lv.get("note_updated_at") or "") > str(cur.get("note_updated_at") or ""):
            latest[sym] = lv
    out: list[ResurfaceCandidate] = []
    for sym, lv in sorted(latest.items()):
        chg = _quote(scan_ctx, sym).get("change_pct")
        if not _real_number(chg) or abs(float(chg)) < NOTE_BIG_MOVE_PCT:
            continue
        direction = "up" if chg > 0 else "down"
        out.append(ResurfaceCandidate(
            kind="note_big_move", symbol=sym,
            headline=f"{sym} is {direction} {abs(float(chg)):.1f}% today, and you wrote about it",
            body=(f"Your note “{_title(lv)}” is on {sym}. "
                  f"Here's what you thought then, before today's move."),
            base_signal=0.6, personal_multiplier=1.0, urgency=1.0,   # -> 6
            dedup_key=f"{sym}:note_move",
            note_id=str(lv.get("note_id") or ""), version_id=None,
            fire_key=f"move|{sym}", rank=2,
        ))
    return out


def rule_note_date_due(scan_ctx: dict, user_ctx: dict) -> list[ResurfaceCandidate]:
    """R9: a date the member set on a note (its Review Date, or a catalyst / event
    / earnings date property) is today, or passed at most NOTE_DATE_LOOKBACK_DAYS
    ago. Once ever per (note, date): `once=True`."""
    today = scan_ctx.get("today")
    if not isinstance(today, date):
        return []
    out: list[ResurfaceCandidate] = []
    for lv in user_ctx.get("note_levels") or []:
        role = lv.get("role")
        if role not in NOTE_DATE_ROLES:
            continue
        try:
            on = date.fromisoformat(str(lv.get("on_date") or "")[:10])
        except ValueError:
            continue
        days = (today - on).days
        if days < 0 or days > NOTE_DATE_LOOKBACK_DAYS:
            continue
        sym = (lv.get("symbol") or "").upper()
        word = _DATE_WORD[role]
        when = "is today" if days == 0 else ("was yesterday" if days == 1 else f"was {days} days ago")
        out.append(ResurfaceCandidate(
            kind="note_date_due", symbol=sym or None,
            headline=f"{sym + ': ' if sym else ''}the {word} you set {when}",
            body=(f"“{_title(lv)}” has a {word} of {on.isoformat()}. "
                  f"Here's what you thought then."),
            base_signal=0.5, personal_multiplier=1.0, urgency=1.0,   # -> 5
            dedup_key=f"{sym}:note_date",
            note_id=str(lv.get("note_id") or ""), version_id=lv.get("version_id"),
            fire_key=f"{lv.get('note_id')}|{lv.get('level_id')}",
            once=True, rank=3,
        ))
    return out
