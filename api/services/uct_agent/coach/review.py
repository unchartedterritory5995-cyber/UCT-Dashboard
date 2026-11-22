"""Trade-review foundations (W3-3): DESCRIPTIVE statistics over the member's own journal rows -- counts, rates and
averages only; never a trade's prices, never a recommendation. Mirrored in the browser by app/src/agent/coach/
review.js (the browser reads the rows through the existing j2 route and computes the stats; the server never reads
the journal for the coach). Both sides run the one fixture app/src/agent/__fixtures__/coachJournalRows.json.

`model_view(stats)` is the ONLY shape of journal data the model may see: the server rewrites the coach context
entry's `review` through it on every coach turn (coach.sanitize_context), so a browser can never pass a trade's
prices, symbols or dates to the model by mistake.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Iterable

DEFAULT_N = 10
MAX_N = 50
MODEL_KEYS = ("considered", "closed", "wins", "losses", "breakeven", "winRatePct", "withR", "avgR", "avgHoldDays",
              "largestWinR", "largestLossR", "largestWinPct", "largestLossPct", "mistakeTags", "emotionTags")
DESCRIPTIVE = "Descriptive review, not a recommendation."


def clamp_n(n: Any) -> int:
    try:
        v = int(n)
    except (TypeError, ValueError):
        return DEFAULT_N
    return max(1, min(MAX_N, v))


def _round(v: float, d: int = 0) -> float | int:
    """Half-up, like JavaScript's Math.round (Python's round() is banker's: 62.5 -> 62, the mirror would say 63)."""
    import math
    r = math.floor(v * 10 ** d + 0.5) / 10 ** d
    return int(r) if d == 0 else r


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None          # NaN -> None


def _tags(rows: Iterable[dict], key: str, top: int = 5) -> list[dict]:
    c: Counter[str] = Counter()
    for r in rows:
        for t in r.get(key) or []:
            if isinstance(t, str) and t.strip():
                c[t.strip()[:40]] += 1
    return [{"tag": t, "count": n} for t, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:top]]


def stats(rows: list[dict], n: Any = DEFAULT_N) -> dict:
    """Descriptive stats over the newest `n` rows (as the j2 route orders them). Pure; no prices in the output."""
    n = clamp_n(n)
    rows = [r for r in (rows or []) if isinstance(r, dict)][:n]
    closed = [r for r in rows if r.get("exitDate")]
    res = [str(r.get("result") or "").lower() for r in closed]
    wins = sum(1 for x in res if x == "win")
    losses = sum(1 for x in res if x == "loss")
    breakeven = len(closed) - wins - losses
    decided = wins + losses
    rs = [v for v in (_num(r.get("rMultiple")) for r in closed) if v is not None]
    holds = [v for v in (_num(r.get("holdDays")) for r in closed) if v is not None]
    pcts = [v for v in (_num(r.get("pnlPercent")) for r in closed) if v is not None]
    out: dict[str, Any] = {
        "considered": len(rows), "closed": len(closed), "wins": wins, "losses": losses, "breakeven": breakeven,
        "winRatePct": _round(100 * wins / decided) if decided else None,
        "withR": len(rs), "avgR": _round(sum(rs) / len(rs), 2) if rs else None,
        "avgHoldDays": _round(sum(holds) / len(holds), 1) if holds else None,
        "largestWinR": _round(max(rs), 2) if rs and max(rs) > 0 else None,
        "largestLossR": _round(min(rs), 2) if rs and min(rs) < 0 else None,
        "largestWinPct": None if rs else (_round(max(pcts), 1) if pcts and max(pcts) > 0 else None),
        "largestLossPct": None if rs else (_round(min(pcts), 1) if pcts and min(pcts) < 0 else None),
        "mistakeTags": _tags(closed, "mistakeTags"), "emotionTags": _tags(closed, "emotionTags"),
    }
    return out


def model_view(review: Any) -> dict | None:
    """The whitelisted, value-free view of a review for the model: known keys only, numbers and tag counts only."""
    if not isinstance(review, dict):
        return None
    out: dict[str, Any] = {}
    for k in MODEL_KEYS:
        v = review.get(k)
        if k in ("mistakeTags", "emotionTags"):
            if isinstance(v, list):
                out[k] = [{"tag": str(t.get("tag"))[:40], "count": int(t.get("count"))} for t in v
                          if isinstance(t, dict) and isinstance(t.get("tag"), str) and isinstance(t.get("count"), int)][:5]
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = v
    return out or None


def _r(v: float | None) -> str:
    return "" if v is None else f"{v:+.2f}R".replace("+-", "-")


def review_text(s: dict) -> str:
    """The member's sentence(s): counts, rates and averages, then the descriptive note. No prices, no symbols."""
    if not s or not s.get("considered"):
        return f"Your journal has no trades to review yet. {DESCRIPTIVE}"
    if not s.get("closed"):
        return f"Your last {s['considered']} journal trades are all still open, so there is nothing to review yet. {DESCRIPTIVE}"
    parts = [f"Your last {s['closed']} closed trade{'s' if s['closed'] != 1 else ''}: {s['wins']} win{'s' if s['wins'] != 1 else ''}, "
             f"{s['losses']} loss{'es' if s['losses'] != 1 else ''}"
             + (f", {s['breakeven']} breakeven" if s.get("breakeven") else "")
             + (f" (win rate {s['winRatePct']}%)" if s.get("winRatePct") is not None else "") + "."]
    if s.get("avgR") is not None:
        parts.append(f"Average R {_r(s['avgR'])} over the {s['withR']} with a stop recorded"
                     + (f"; largest win {_r(s['largestWinR'])}" if s.get("largestWinR") is not None else "")
                     + (f", largest loss {_r(s['largestLossR'])}" if s.get("largestLossR") is not None else "") + ".")
    elif s.get("largestWinPct") is not None or s.get("largestLossPct") is not None:
        parts.append("No R-multiples recorded (add a stop to a trade and UCT computes R)"
                     + (f"; largest win {s['largestWinPct']:+.1f}%" if s.get("largestWinPct") is not None else "")
                     + (f", largest loss {s['largestLossPct']:+.1f}%" if s.get("largestLossPct") is not None else "") + ".")
    if s.get("avgHoldDays") is not None:
        parts.append(f"Average holding time {s['avgHoldDays']:g} day{'s' if s['avgHoldDays'] != 1 else ''}.")
    if s.get("mistakeTags"):
        parts.append("Mistake tags you recorded: " + ", ".join(f"{t['tag']} ({t['count']})" for t in s["mistakeTags"]) + ".")
    if s.get("emotionTags"):
        parts.append("Emotion tags: " + ", ".join(f"{t['tag']} ({t['count']})" for t in s["emotionTags"]) + ".")
    parts.append(DESCRIPTIVE)
    return " ".join(parts)
