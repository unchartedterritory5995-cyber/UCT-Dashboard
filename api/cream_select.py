"""Cream (EOD Top Flow card) selection rules — pure, no DB, no router state.

`live_massive_router.compute_cream` builds one candidate row per CONTRACT from the
day's aggregate + big single-print tiers. These helpers decide which of those rows
are allowed to claim a DIRECTION on a member-facing card. They live here (not in
the partner-co-edited router) so the router diff stays a few call sites.

Audit of the 10/09 card (owner-approved fixes, 2026-10-13):

1. FAR-DATED / FAR-OTM / THIN FRESH rows. SNDK $800P 1/2029 (833 DTE, 49% OTM on
   spot, OI 0) was the TOP bear row at $16.1M; MU $1190C 1/2029 was 51 contracts
   into a fresh strike. A >1y lottery-ticket or a hedge leg is not the day's
   conviction. -> `row_sanity_reason`.
2. TWO-SIDED names. MU, LITE, NVDA, PLTR printed on BOTH sides (MU $6.1M bull vs
   $10.0M bear). A card that says "bull" and "bear" for the same name in the same
   breath tells the reader nothing. -> `net_two_sided`.
3. GRADE. Rows ranked by premium alone, so D-grade rows sat above A-grade ones.
   -> `grade_rank` (rank key) + `passes_grade_floor`.
"""
from __future__ import annotations

# Higher = better. Unknown/blank grades rank below every real grade but are NOT
# dropped by the floor unless the floor is set (a row whose grade we cannot read
# is not evidence of a bad row; the floor only drops grades we can read).
_GRADE_ORDER = {"A+": 6, "A": 5, "B": 4, "C": 3, "D": 2, "F": 1}


def grade_rank(grade) -> int:
    g = str(grade or "").replace("\U0001F680", "").strip().upper()
    return _GRADE_ORDER.get(g, 0)


def passes_grade_floor(grade, min_grade: str) -> bool:
    """`min_grade` '' / None disables the floor. A blank grade passes (see above)."""
    floor = grade_rank(min_grade)
    if floor <= 0:
        return True
    r = grade_rank(grade)
    return r == 0 or r >= floor


def spot_otm_pct(cp, strike, spot):
    """Distance OUT of the money as a % of SPOT (positive = OTM, negative = ITM),
    or None without a usable strike/spot. ⚠️ Spot-normalised on purpose: the
    alert's own `moneynessPct` is strike-normalised, which reads SNDK $800P at
    spot $1,581 as "-97.6%" — a number nobody can reason about. 49% below spot
    is the sentence a trader actually means by "far OTM"."""
    try:
        k, s = float(strike), float(spot)
    except (TypeError, ValueError):
        return None
    if not (k > 0 and s > 0):
        return None
    c = str(cp or "").upper()[:1]
    if c == "C":
        return (k - s) / s * 100.0
    if c == "P":
        return (s - k) / s * 100.0
    return None


def row_sanity_reason(a: dict, *, max_dte: int, max_otm_pct: float,
                      fresh_min_vol: int, far_dte_grades=("A+", "A")):
    """Why this classified alert may NOT claim a direction on the card, or None.

    - "far_dated":  dte > max_dte (default 365) unless graded A/A+. The aggregate
                    tiers grade LEAPs on their own floors; an A LEAP build is real
                    conviction, a C/D one is usually a hedge or a lottery ticket.
    - "far_otm":    > max_otm_pct (default 40%) out of the money vs spot.
    - "thin_fresh": a fresh strike (prior OI 0/None) with fewer than fresh_min_vol
                    ask contracts. "Fresh" earns the row a pass on the V/OI test,
                    so it must be a real position, not 51 contracts.
    Any knob <= 0 disables its rule. Fail-open on missing fields (no dte / no spot
    = the rule cannot be evaluated, so it does not fire)."""
    dte = a.get("dte")
    if max_dte and max_dte > 0 and isinstance(dte, (int, float)) and dte > max_dte:
        g = str(a.get("grade") or "").replace("\U0001F680", "").strip().upper()
        if g not in far_dte_grades:
            return "far_dated"
    if max_otm_pct and max_otm_pct > 0:
        otm = spot_otm_pct(a.get("cp"), a.get("strike"), a.get("spot"))
        if otm is not None and otm > max_otm_pct:
            return "far_otm"
    if fresh_min_vol and fresh_min_vol > 0:
        oi = a.get("priorOI") or 0
        av = a.get("aggAskVolume") or 0
        if oi <= 0 and av < fresh_min_vol:
            return "thin_fresh"
    return None


def net_two_sided(rows: list, ratio: float):
    """Resolve names that carry rows on BOTH sides. Returns (kept_rows, two_sided).

    Rule: sum each name's eligible premium (`_agg`) per side. If one side is at
    least `ratio`x the other (default 2.0) the name is a CLEAN read on that side
    and only its winning-side rows are kept. Otherwise the flow offsets — a hedge,
    a straddle, a collar, or two traders disagreeing — and the name is dropped from
    BOTH sides and reported in `two_sided` so a reader (the Morning Wire) can still
    see it was active.

    Why drop rather than mark: the card's only claim is direction. A name that
    cannot win its own tug-of-war by 2:1 has no direction to claim, and a
    "two-sided" tag on a Bulls/Bears card is a row that argues with its own header.
    Why 2x: below it the losing side is more than a third of the name's
    directional dollars, i.e. not noise. `ratio` <= 0 disables netting.

    `two_sided` items: {sym, bull, bear} (premium sums, rounded)."""
    if not ratio or ratio <= 0:
        return list(rows), []
    tot: dict = {}
    for r in rows:
        t = tot.setdefault(r["sym"], {"Bull": 0.0, "Bear": 0.0})
        if r.get("_dir") in t:
            t[r["_dir"]] += float(r.get("_agg") or 0)
    drop_side: dict = {}
    two_sided = []
    for sym, t in tot.items():
        bu, be = t["Bull"], t["Bear"]
        if bu <= 0 or be <= 0:
            continue
        if bu >= ratio * be:
            drop_side[sym] = {"Bear"}
        elif be >= ratio * bu:
            drop_side[sym] = {"Bull"}
        else:
            drop_side[sym] = {"Bull", "Bear"}
            two_sided.append({"sym": sym, "bull": round(bu), "bear": round(be)})
    kept = [r for r in rows if r.get("_dir") not in drop_side.get(r["sym"], ())]
    two_sided.sort(key=lambda d: -(d["bull"] + d["bear"]))
    return kept, two_sided
