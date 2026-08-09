"""Shared outlier-resistant group aggregation.

ONE authority for "a group's representative % change" so the Custom-Period sector/industry
sort (scan_period) and the Theme Tracker (theme_performance) rank groups the same way — a
single moonshot member can't float a group to the top when the rest are weak.
"""


def robust_group_pct(vals) -> float:
    """A group's representative % change, robust to a single moonshot outlier.

    UPSIDE-WINSORIZED MEAN: cap the top ~10% of members (at least 1) down to the
    next-highest member's return, then take the equal-weight mean. This keeps the
    group's MAGNITUDE (it still averages every member's real move) but stops one absurd
    gainer — e.g. CVNA +2641% inside Auto & Truck Dealerships — from dragging the whole
    group to #1. The DOWNSIDE is left untouched: a genuinely weak group should rank low,
    and simple returns are already bounded at -100%, so there's no runaway there.
    Single-member groups return that member; empty → 0."""
    n = len(vals)
    if n == 0:
        return 0.0
    if n <= 2:
        # Too small to separate an outlier from a trend meaningfully — but still don't
        # let a lone moonshot define a 2-name group: cap the max to the min.
        return (min(vals) if n == 2 and max(vals) > min(vals) * 3 and max(vals) > 100
                else sum(vals) / n)
    s = sorted(vals)
    k = max(1, round(n * 0.10))          # how many top members to winsorize
    cap = s[n - k - 1]                    # the return just below the winsorized top block
    capped = [v if v <= cap else cap for v in s]
    return sum(capped) / n
