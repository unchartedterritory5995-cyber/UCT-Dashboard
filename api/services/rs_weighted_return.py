"""The weighted relative-strength return — ONE implementation.

🔴 WHY THIS MODULE EXISTS. There were two, and they disagreed by **15.7% on
identical inputs**:

* ``rs_ranking._compute_returns`` SUBSTITUTED. A missing 6-month return became
  **the 3-month return** (so 3m silently carried 60% of the weight), and a
  missing 1-month or 1-week return became **``0`` — a fabricated flat return**.
  The denominator was always 1.0.
* ``research.ratings._weighted_rs_return`` DROPPED the missing term and
  **renormalised** over the weight that actually resolved.

Worked example, same inputs ``r3m = +50%``, ``r1m = +10%``, ``r1w = +2%`` with
``r6m`` unavailable: the substituting lane returned **32.40**, the renormalising
lane **28.00**. Meanwhile ``snapshot_builder.rs_fields``'s docstring asserted the
screener's ``rs_return`` was *"the same quantity ``ratings._weighted_rs_return``
computes"*. It was not — and that claim is what this module makes true.

⭐ THE MISSING-PERIOD RULE, STATED ONCE AND OUT LOUD: **an absent period is
dropped and the surviving weights are renormalised. It never becomes a value.**
Substituting ``0`` for a return we do not have asserts the stock was FLAT over
that window, which is a measurement nobody took; substituting a different
period's return asserts two windows moved identically. Both put a fabricated
number into a ranking that decides which names a member sees first. Dropping and
renormalising says the only honest thing available: *"scored on the terms we
have"*.

⛔ THE 3-MONTH TERM IS REQUIRED, and it is the one substitution rule that stays:
without it there is no RS return at all and the answer is ``None``, not a score
built on the tail weights. It carries the largest weight (0.40) and is the
shortest window every provider can serve.

⚠️ Pure and dependency-free on purpose — imported by ``rs_ranking`` (the screener
lane) and ``research.ratings`` (the research lane), neither of which may import
the other.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

#: ``(label, bars_back, weight)`` — the IBD-style weighting, in the order the
#: docstring above quotes it. ⛔ THE ONLY COPY. ``rs_ranking`` reports the four
#: period returns beside the score and derives that list FROM THIS ONE, so a
#: reweighting cannot leave the payload describing a different formula than the
#: score it sits next to.
RS_TERMS: Tuple[Tuple[str, int, float], ...] = (
    ("3m", 63, 0.40),
    ("6m", 126, 0.20),
    ("1m", 21, 0.20),
    ("1w", 5, 0.20),
)

#: The term that cannot be missing. Named rather than assumed so the rule is
#: greppable from either lane.
REQUIRED_TERM = "3m"


def period_return(closes: Sequence[float], bars_back: int) -> Optional[float]:
    """Percentage return over ``bars_back`` trading bars, or ``None``.

    ``None`` — never ``0`` — when the series is too short or the reference close
    is not a positive price. A non-positive denominator has no percentage; see
    ``lesson_a_derived_reference_needs_a_sanity_bound`` (return ``None``, not 0).
    """
    if closes is None or len(closes) <= bars_back:
        return None
    ref = closes[-1 - bars_back]
    if ref is None or ref <= 0:
        return None
    current = closes[-1]
    if current is None:
        return None
    return (current - ref) / ref * 100.0


def period_returns(closes: Sequence[float]) -> Dict[str, Optional[float]]:
    """``{label: return_pct_or_None}`` for every term in ``RS_TERMS``."""
    return {label: period_return(closes, n) for label, n, _w in RS_TERMS}


def weighted_rs_return(closes: Sequence[float]) -> Optional[float]:
    """The weighted RS return for a close series, or ``None``.

    Missing terms are DROPPED and the remaining weights RENORMALISED. Returns
    ``None`` when the required 3-month term cannot be computed.
    """
    return weighted_from_returns(period_returns(closes))


def weighted_from_returns(returns: Dict[str, Optional[float]]) -> Optional[float]:
    """``weighted_rs_return`` for period returns that were computed elsewhere.

    Exists so a caller that already needs the four returns for its payload
    (``rs_ranking``) scores off exactly the numbers it reports, rather than
    recomputing them — a second derivation of one value is the defect this
    module retires, and it does not get to come back through the back door.
    """
    if returns.get(REQUIRED_TERM) is None:
        return None
    parts: List[Tuple[float, float]] = [
        (returns[label], w) for label, _n, w in RS_TERMS if returns.get(label) is not None
    ]
    total_weight = sum(w for _v, w in parts)
    if not total_weight:
        return None
    return sum(v * w for v, w in parts) / total_weight
