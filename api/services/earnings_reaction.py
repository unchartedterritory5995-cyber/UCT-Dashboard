"""Earnings-day price reaction for the Company Panel's Earnings tab.

The panel's `EarningsReaction` strip has been rendering nothing since it shipped:
it reads `intel.reaction`, and `/api/earnings-intel/{sym}` never carried that
key. The component was fine; nothing fed it.

⛔ THE DEFINITION IS NOT OURS TO INVENT. It is the one
`earnings_enrichment.get_historical_earnings_moves` already documents:

    pre-market report   -> (report-day open  - prior close)     / prior close
    post-market report  -> (next-day open    - report-day close)/ report-day close
    timing unknown      -> whichever of those two is larger in magnitude

`earnings_intel`'s quarters carry `report_date` but no report TIME, so every
quarter here takes the documented unknown-timing branch. That is the existing
rule for this case, not a shortcut invented for this module.

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


def _move_for(idx: int, bars: list[dict]):
    """The documented unknown-timing reaction at bar index `idx`.

    `idx` is the report day. Returns the larger-magnitude of the pre-market and
    post-market readings, or None when neither can be formed.
    """
    pre = post = None
    if idx > 0:
        pre = _pct(bars[idx].get("o"), bars[idx - 1].get("c"))
    if idx + 1 < len(bars):
        post = _pct(bars[idx + 1].get("o"), bars[idx].get("c"))
    candidates = [m for m in (pre, post) if m is not None]
    if not candidates:
        return None
    return max(candidates, key=abs)


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
