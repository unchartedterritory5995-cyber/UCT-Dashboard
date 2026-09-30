"""ADR / ADS ratios (Gate F) and the ADS-equivalent share conversion.

Units. bars are adjusted for EVERY ADS-level event (an ordinary split passing through the ADS and a depositary
ratio change look identical in the ADS price). With R(a) = ordinary shares per ADS in effect at the as-of date `a`
of an ordinary-share count N, and F(a) = the ADS ticker's split factor after `a`:

    ADS-equivalent shares, today's ADS basis  =  N * F(a) / R(a)

Proof sketch: an ordinary split k after `a` leaves R unchanged and appears in F; a ratio change s = R_old/R_new
after `a` appears in F as s; either way N * F(a) / R(a) * adjusted_close(t) = N_t * price_t / R_t.

R(a) must come from a STATEMENT (filing text: "American Depositary Shares, each representing N ordinary shares")
with no ADS ledger event between the statement's date and `a` -- otherwise the ratio at `a` is not known and the
observation is refused (ADR_RATIO_UNRESOLVED). Never ADS price x ordinary shares.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from api.services.fundamentals_pit.splits import Ledger

from .textcover import for_matching

FRAC = {"one-half": 0.5, "one half": 0.5, "one-third": 1 / 3, "one-quarter": 0.25, "one-fourth": 0.25, "one-fifth": 0.2,
        "one-tenth": 0.1, "one-twentieth": 0.05, "one-fortieth": 0.025, "two-thirds": 2 / 3, "three-quarters": 0.75}
WORD = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "twenty-five": 25, "thirty": 30, "forty": 40, "fifty": 50,
        "one hundred": 100, "a": 1, "an": 1}
ADS = r"(?:american\s+depositary\s+shares?|american\s+depository\s+shares?|ADSs?|ADRs?|depositary\s+shares?)"
SH = r"(?:ordinary\s+shares?|common\s+shares?|shares?\s+of\s+common\s+stock|shares?(?:\s+of\s+the\s+company)?|equity\s+shares?|class\s+a\s+ordinary\s+shares?)"
NUMW = r"(one-half|one half|one-third|one-quarter|one-fourth|one-fifth|one-tenth|one-twentieth|one-fortieth|two-thirds|three-quarters|\d+(?:_\d+)?|one hundred|twenty-five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|an?)"
RX = [
    # "American Depositary Shares, each representing one-fifth of one ordinary share" / "each representing 5 ordinary shares"
    re.compile(rf"{ADS}[^.;]{{0,60}}?(?:each\s+)?(?:representing|represents|represent|evidencing|equal\s+to)\s+{NUMW}\s+(?:of\s+(?:one|an?)\s+)?{SH}", re.I),
    # "each ADS represents 5 ordinary shares"
    re.compile(rf"each\s+{ADS}\s+(?:represents|representing|evidences)\s+{NUMW}\s+(?:of\s+(?:one|an?)\s+)?{SH}", re.I),
    # "5 ordinary shares per ADS"
    re.compile(rf"{NUMW}\s+{SH}\s+per\s+{ADS}", re.I),
]


@dataclass(frozen=True)
class RatioStatement:
    as_of: date                 # the date the statement speaks for (filing date / cover date)
    ords_per_ads: float
    accn: str
    snippet: str


def _val(tok: str) -> float | None:
    t = tok.lower().replace("_", ".")
    if t in FRAC:
        return FRAC[t]
    if t in WORD:
        return float(WORD[t])
    try:
        return float(t)
    except ValueError:
        return None


def parse_ratio(text: str) -> tuple[float | None, str, str]:
    """-> (ordinary shares per ADS, status, snippet). status OK | NOT_FOUND | CONFLICT."""
    t = for_matching(text)
    vals = {}
    for rx in RX:
        for m in rx.finditer(t):
            tok = m.group(1)
            v = _val(tok)
            if v is None or v <= 0:
                continue
            seg = m.group(0).lower()
            frac_of_one = re.search(r"of\s+(?:one|an?)\s+", seg[seg.find(tok.lower()) + len(tok):][:12]) is not None
            if frac_of_one and v >= 1 and tok.lower() not in FRAC:
                continue            # "one of one" style noise
            vals.setdefault(round(v, 9), t[max(0, m.start() - 20):m.end() + 20][:300])
    if not vals:
        return None, "NOT_FOUND", ""
    if len(vals) > 1:
        return None, "CONFLICT", " || ".join(list(vals.values())[:3])
    v, s = next(iter(vals.items()))
    return v, "OK", s


def ratio_at(a: date, statements: list[RatioStatement], ads_ledger: Ledger) -> RatioStatement | None:
    """The statement valid at `a`: the nearest one with no ADS ledger event strictly between it and `a`."""
    best = None
    for st in statements:
        lo, hi = sorted((a, st.as_of))
        if any(lo < s.ex_date <= hi for s in ads_ledger.splits):
            continue
        if best is None or abs((st.as_of - a).days) < abs((best.as_of - a).days):
            best = st
    return best
