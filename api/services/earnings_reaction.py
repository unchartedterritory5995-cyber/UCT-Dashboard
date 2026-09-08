"""Earnings-day price reaction for the Company Panel's Earnings tab.

The panel's `EarningsReaction` strip has been rendering nothing since it shipped:
it reads `intel.reaction`, and `/api/earnings-intel/{sym}` never carried that
key. The component was fine; nothing fed it.

THE DEFINITION (owner decision, 8 Sep 2026): the CLOSE-TO-CLOSE move of the
session that first traded the result.

    reaction = (close[S] - close[S-1]) / close[S-1]

where S is the reacting session. `earnings_intel`'s quarters carry a report
date but no report TIME, so S is identified by the OPENING GAP: a result
released while the market was shut is repriced at the open, so the reacting
session is whichever of (report day, next session) opens furthest from its
prior close. The gap only SELECTS the session; the number reported is that
session's full move.

This deliberately DIFFERS from `earnings_enrichment.get_historical_earnings_
moves`, which measures the opening gap itself. Both are defensible -- the gap
isolates what the news repriced overnight, close-to-close is what a holder
actually experienced -- and the owner asked for the second. The gap measure
also understated the answer: MU's 25 Jun 2026 session gapped +17.6% and closed
+15.7%. Close-to-close is additionally what this strip's own footer has always
claimed ("measured on the session that first traded the result").

⚠️ A quarter that cannot be computed keeps its slot as an explicit None rather
than being dropped. Dropping would COMPACT the list and re-pair every older
quarter with a newer quarter's move — the same off-by-one class the enrichment
module calls out. The average and the count are taken over non-null entries
only, since averaging a gap would misstate both.

Prices come from OUR OWN daily bars (`bars_fetch`), not yfinance or Alpha
Vantage: they are already cached in-process for the panel, so this adds no
metered provider call. Depth is sized by `daily_bars_needed_since`, which
clamps below `_DEEP_REQUEST_THRESHOLD` — requesting more would drop onto the
synchronous full-history backfill path and stall the tab for seconds.
"""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any, Iterable

_log = logging.getLogger(__name__)

# 8 quarters is the window the enrichment module and the strip both use.
DEFAULT_LIMIT = 8
# ⛔ Below this many COMPUTED moves the strip is withdrawn entirely.
# Gaps are honest -- a quarter whose price frame we lack must never borrow its
# neighbour's number -- but a strip that is mostly gaps still LOOKS like a
# reading while carrying almost none. NVDA measured 2 of 8 in production: its
# cached daily history only reached 2025-12, so six earnings dates sat outside
# the frame. Showing two bars and six holes would claim a pattern that is not
# there. This is the same judgement the strip already makes about sample size,
# applied to the data rather than to the slot count.
MIN_COMPUTED = 4
# Trading days of slack so the oldest quarter still has a PRIOR close in frame.
_LOOKBACK_PAD_DAYS = 12


def _daily_bars(sym: str, since_iso: str) -> list[dict]:
    """Daily bars from the in-process path, oldest first."""
    try:
        from api.services import bars_fetch
        depth = bars_fetch.daily_bars_needed_since(since_iso)
        resp = bars_fetch._get_bars_inner(sym, "D", depth)   # noqa: SLF001
        body = getattr(resp, "body", None)
        data = json.loads(body) if body is not None else (
            resp if isinstance(resp, dict) else {})
        bars = [b for b in (data.get("bars") or []) if b.get("t")]
        bars.sort(key=lambda b: str(b.get("t")))
        return bars
    except Exception as exc:                                  # noqa: BLE001
        _log.warning("earnings reaction bars fetch failed for %s: %s", sym, exc)
        return []


def _pct(a, b):
    try:
        a = float(a); b = float(b)
    except (TypeError, ValueError):
        return None
    if b == 0:
        return None
    return (a - b) / abs(b) * 100.0


def _gap(i: int, bars: list[dict]):
    """Session i's OPENING gap: how far it opened from the prior close."""
    if i <= 0 or i >= len(bars):
        return None
    return _pct(bars[i].get("o"), bars[i - 1].get("c"))


def _session_move(i: int, bars: list[dict]):
    """Session i's CLOSE-TO-CLOSE move — what a holder actually experienced."""
    if i <= 0 or i >= len(bars):
        return None
    return _pct(bars[i].get("c"), bars[i - 1].get("c"))


def _move_for(idx: int, bars: list[dict]):
    """The reaction: the CLOSE-TO-CLOSE move of the session that traded the news.

    `idx` is the report day. Two sessions can be the one that first traded the
    result and we are not told which, because the quarters carry a report date
    but no report TIME:
      • a pre-market print is answered by the report day itself
      • a post-close print is answered by the NEXT session

    The opening GAP identifies which one. A result released while the market was
    shut is repriced at the open, so the reacting session is the one that opens
    furthest from its prior close. The gap only SELECTS the session; the number
    reported is that session's full close-to-close move.

    Measuring the gap itself was the earlier behaviour and it understated the
    answer: MU's 25 Jun 2026 session gapped +17.6% and closed +15.7%, and
    "+15.7%" is what a holder of the stock actually made that day. Close-to-close
    is also what the strip's own footer has always claimed to show.
    """
    cands = [i for i in (idx, idx + 1) if 0 < i < len(bars)]
    if not cands:
        return None
    scored = [(abs(_gap(i, bars) or 0.0), i) for i in cands]
    _, best = max(scored, key=lambda t: t[0])
    move = _session_move(best, bars)
    if move is not None:
        return move
    # The chosen session could not be measured; fall back to the other one
    # rather than reporting nothing.
    for i in cands:
        if i != best:
            return _session_move(i, bars)
    return None


def _index_for(day: str, by_date: dict[str, int], bars: list[dict]):
    """Bar index for a report date, or the next trading day after it.

    A report date can land on a weekend or holiday (providers report the filing
    date, not a session). Walking FORWARD is deliberate: the reaction belongs to
    the first session that could price the news, never to the session before it.
    """
    if day in by_date:
        return by_date[day]
    try:
        d = date.fromisoformat(day)
    except ValueError:
        return None
    for _ in range(5):
        d += timedelta(days=1)
        hit = by_date.get(d.isoformat())
        if hit is not None:
            return hit
    return None


def reaction_for(sym: str, quarters: Iterable[dict] | None,
                 *, limit: int = DEFAULT_LIMIT,
                 min_computed: int = MIN_COMPUTED) -> dict[str, Any] | None:
    """{'events': [...newest LAST...], 'avg_abs_move_pct': float} or None.

    `quarters` is `earnings_intel`'s list, newest first. The strip reads left to
    right in time, so events come back newest LAST.
    """
    rows = [q for q in (quarters or [])
            if q and q.get("reported") and q.get("report_date")]
    if not rows:
        return None
    rows = rows[:limit]

    oldest = min(str(q["report_date"])[:10] for q in rows)
    try:
        since = (date.fromisoformat(oldest)
                 - timedelta(days=_LOOKBACK_PAD_DAYS)).isoformat()
    except ValueError:
        return None

    bars = _daily_bars(sym, since)
    if len(bars) < 2:
        return None
    by_date = {str(b["t"])[:10]: i for i, b in enumerate(bars)}

    events: list[dict[str, Any]] = []
    for q in rows:
        day = str(q.get("report_date"))[:10]
        idx = _index_for(day, by_date, bars)
        events.append({
            "quarter": q.get("label") or day,
            "report_date": day,
            "reaction_pct": None if idx is None else _move_for(idx, bars),
            "eps_actual": q.get("eps_actual"),
            "eps_estimate": q.get("eps_estimate"),
        })

    events.reverse()                       # newest last, so the strip reads in time
    moves = [e["reaction_pct"] for e in events if e["reaction_pct"] is not None]
    if len(moves) < min_computed:
        return None
    return {
        "events": events,
        "avg_abs_move_pct": round(sum(abs(m) for m in moves) / len(moves), 2),
        "n_quarters": len(moves),
    }
