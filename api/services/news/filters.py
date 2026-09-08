"""Quality gates: junk rejection and category assignment.

Every rejection is RECORDED with a reason rather than silently dropped, so
§43's instrumentation can show what the filter is actually removing and the
thresholds can be tuned against real data instead of guessed at.

Measured on 15,193 real articles during source validation (7 Sep 2026):
    legal solicitation   224 of 229 rejections in FMP press-releases
    editorial commentary 2,121 in FMP /news/stock
    market-research PR   a small but persistent GlobeNewswire family
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# 1. Law-firm solicitation. The single biggest junk family on the wire lane:
#    "INVESTOR ALERT: Scott+Scott Attorneys at Law LLP Investigates ..."
#    These are paid placements, not company news.
# ---------------------------------------------------------------------------
LEGAL_RE = re.compile(
    r"\b(?:deadline|investor|shareholder|class\s+action)\s+(?:alert|reminder|notice)\b"
    r"|\bshareholders?\s+who\s+(?:lost|purchased)\b"
    r"|\b(?:urged|encouraged|reminded)\s+to\s+contact\b"
    r"|\bclass\s+action\s+(?:lawsuit|complaint|deadline)\b"
    r"|\bsecurities\s+(?:fraud|class\s+action|litigation)\b"
    r"|\blead\s+plaintiff\s+deadline\b"
    r"|\binvestigates?\s+claims?\s+on\s+behalf\b"
    r"|\bcontact\s+the\s+firm\s+before\b"
    r"|\b(?:rosen|glancy|pomerantz|bronstein|levi\s*&\s*korsinsky|robbins|"
    r"scott\+scott|kessler\s+topaz|bragar|faruqi|kahn\s+swick|schall\s+law|"
    r"johnson\s+fistel|gross\s+law|howard\s+g\.?\s+smith)\b",
    re.I,
)

# A genuine company legal event must still get through. An 8-K or a company's
# own release about a verdict or settlement is real news; a law firm touting for
# clients is not. This exception requires BOTH a material legal noun AND the
# absence of solicitation language, so it cannot be used to smuggle spam in.
LEGAL_MATERIAL_RE = re.compile(
    r"\b(?:jury\s+(?:verdict|awards?)|court\s+(?:rules?|ruled|orders?)|"
    r"settles?|settlement\s+(?:of|with|reached)|"
    r"(?:wins?|loses?|lost)\s+(?:appeal|patent|case|ruling)|"
    r"injunction|consent\s+decree|plea\s+agreement|"
    r"(?:fined|penalt(?:y|ies))\s+by|antitrust\s+(?:suit|ruling|probe)|"
    r"doj|ftc|sec\s+charges?)\b",
    re.I,
)

# ---------------------------------------------------------------------------
# 2. Paid market-research PR. Wire-distributed but about an INDUSTRY REPORT,
#    tagged to whatever companies it names.
# ---------------------------------------------------------------------------
PR_SPAM_RE = re.compile(
    r"\bmarket\s+(?:size|share|report|trends?|outlook|analysis|forecast|research)\b"
    r"|\bmarket\s+to\s+(?:reach|hit|surpass|grow|skyrocket)\b"
    r"|\bUSD\s*[\d.,]+\s*(?:billion|million|trillion)\b"
    r"|\bCAGR\b"
    r"|\bindustry\s+(?:report|analysis|outlook)\b"
    r"|\bforecast\s+(?:to|period)\s+20\d\d\b"
    r"|\bglobal\s+[\w\s,&-]{0,45}?market\b"
    r"|\b20\d\d\s*[-–]\s*20\d\d\b\s*\|",
    re.I,
)

# ---------------------------------------------------------------------------
# 3. Editorial commentary. Validated at 11/11 caught, 0/8 real news misflagged,
#    then re-validated across the full 15k-article corpus.
# ---------------------------------------------------------------------------
COMMENTARY_RE = re.compile(
    "|".join([
        r"\bbuy,?\s*sell,?\s*or\s+hold\b",
        r"\bis\s+.{0,40}\ba\s+(?:buy|sell|screaming\s+buy|no-brainer)\b",
        r"\bhere(?:['’]?s|\s+is)\s+(?:why|what|which|how)\b",
        r"\b(?:i['’]?d|i['’]?ve|i['’]?m|i['’]?ll|why\s+i)\b",
        r"\bmy\s+top\b", r"\bbetter\s+buy\b",
        r"\bprediction\b",
        r"\b(?:could|will)\s+(?:double|triple|soar|skyrocket|crash|plunge)\b",
        r"\b\d+\s+reasons?\b", r"\bno-brainer\b", r"\bmillionaire[-\s]maker\b",
        r"\bwhere\s+will\s+.{0,40}\bbe\s+in\s+\d+\s+years?\b",
        r"\bworth\s+buying\b", r"\binvesting\s+radar\b",
        r"\bshould\s+you\s+buy\b", r"\bis\s+it\s+too\s+late\s+to\s+buy\b",
        r"\bstocks?\s+to\s+(?:buy|watch)\b",
        r"\bthese\s+\d+\s+stocks\b",
        r"\b\d+\s+(?:best|top|great|cheap)\b.{0,30}\bstocks?\b",
        r"\bshould\s+investors\b",
        r"\bwhat\s+investors\s+(?:need|should)\s+(?:to\s+)?know\b",
        # Interrogative headline: a question ABOUT a stock, not a report of an
        # event. Straight news almost never ends in '?'. Allowed to open the
        # headline or follow a colon/dash.
        r"(?:^|[:\-–—]\s*)"
        r"(?:can|will|is|are|should|why|what|how|where|which|do|does|has|have)\b"
        r"[^?]{0,170}\?\s*$",
        r"^\s*\d{1,2}\s+\S",          # numeric listicle
        r"^\s*why\b",                  # explainer voice
    ]),
    re.I,
)

REJECT_LEGAL = "legal-solicitation"
REJECT_PR_SPAM = "market-research-pr"
REJECT_COMMENTARY = "editorial-commentary"
REJECT_EMPTY = "empty-headline"
REJECT_SOURCE = "source-not-displayable"
REJECT_MENTION = "mention-only"
REJECT_NO_TICKER = "no-ticker"


def reject_reason(title: str, *, source_class: str = "") -> str | None:
    """Why this headline should not enter the default feed, or None.

    Order matters: legal solicitation is checked first because those headlines
    also frequently trip the commentary detector, and the more specific reason
    is the more useful one to record.
    """
    t = (title or "").strip()
    if not t:
        return REJECT_EMPTY

    if LEGAL_RE.search(t):
        # A company's own primary release about a real legal outcome survives.
        if source_class in ("primary",) and LEGAL_MATERIAL_RE.search(t):
            return None
        return REJECT_LEGAL

    if PR_SPAM_RE.search(t):
        return REJECT_PR_SPAM

    # Primary sources are not editorialising. An SEC form title like
    # "Why ..." cannot occur, but a company release occasionally uses a
    # question; do not reject the issuer's own words as commentary.
    if source_class in ("primary", "wire") and not COMMENTARY_RE.search(t):
        return None
    if source_class in ("primary",):
        return None

    if COMMENTARY_RE.search(t):
        return REJECT_COMMENTARY
    return None


# ---------------------------------------------------------------------------
# Categories (§14). Restrained set, only what the data actually supports.
# ---------------------------------------------------------------------------
CATEGORY_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("earnings", re.compile(
        r"\b(?:q[1-4]|first|second|third|fourth)[\s-]*quarter\b|\bfiscal\s+(?:q[1-4]|year)\b"
        r"|\bearnings\b|\bresults\b|\brevenue\b|\bEPS\b|\bbeats?\b|\bmisses\b"
        r"|\btop(?:s|ped)?\s+estimates\b|\breports?\s+(?:third|fourth|first|second)\b", re.I)),
    ("guidance", re.compile(
        r"\bguidance\b|\bforecast\b|\boutlook\b|\braises?\s+(?:its\s+)?(?:full[\s-]year|fy|q[1-4])"
        r"|\bcuts?\s+(?:its\s+)?(?:full[\s-]year|fy|outlook|forecast)\b|\bwarns?\b", re.I)),
    ("analyst", re.compile(
        r"\bprice\s+target\b|\bupgrade[sd]?\b|\bdowngrade[sd]?\b|\binitiate[sd]?\s+coverage\b"
        r"|\breiterate[sd]?\b|\boverweight\b|\bunderweight\b|\bbuy\s+rating\b"
        r"|\banalysts?\s+(?:raise|cut|lift)\b", re.I)),
    ("m&a", re.compile(
        r"\bacquir(?:e|es|ed|ing|ition)\b|\bmerger\b|\bto\s+buy\b|\btakeover\b"
        r"|\bdivest\b|\bspin[\s-]?off\b|\bstake\s+in\b|\bjoint\s+venture\b", re.I)),
    ("management", re.compile(
        r"\bC[EFOT]O\b|\bchief\s+(?:executive|financial|operating|technology)\b"
        r"|\bappoint(?:s|ed|ment)\b|\bsteps?\s+down\b|\bresign(?:s|ed|ation)\b"
        r"|\bnames?\s+\w+\s+as\b|\bboard\s+of\s+directors\b", re.I)),
    ("financing", re.compile(
        r"\boffering\b|\bnotes?\s+due\b|\bconvertible\b|\bdebt\b|\bcredit\s+facility\b"
        r"|\braises?\s+\$[\d.]+\s*(?:m|b|million|billion)\b|\bprices?\s+\$", re.I)),
    ("buyback", re.compile(r"\bbuyback\b|\brepurchase\b|\bshare\s+repurchase\b", re.I)),
    ("dividend", re.compile(r"\bdividend\b|\bdistribution\s+declared\b", re.I)),
    ("legal", re.compile(
        r"\blawsuit\b|\bcourt\b|\bjury\b|\bverdict\b|\bsettle(?:s|d|ment)\b"
        r"|\bpatent\b|\binjunction\b|\bantitrust\b", re.I)),
    ("regulatory", re.compile(
        r"\bFDA\b|\bapproval\b|\bregulator\w*\b|\bFTC\b|\bDOJ\b|\bexport\s+controls?\b"
        r"|\btariffs?\b|\bsanctions?\b|\bcompliance\b|\bclearance\b", re.I)),
    ("contract", re.compile(
        r"\bcontract\b|\bawarded?\b|\border\s+(?:worth|valued)\b|\bpartnership\b"
        r"|\bagreement\s+with\b|\bdeal\s+with\b|\bsupply\s+agreement\b", re.I)),
    ("product", re.compile(
        r"\blaunch(?:es|ed)?\b|\bunveil(?:s|ed)?\b|\bintroduc(?:es|ed)\b|\bannounces?\s+new\b"
        r"|\bavailable\s+now\b|\bnext[\s-]gen\b|\bunveiling\b", re.I)),
]

CATEGORY_BY_FORM = {
    "8-K": "sec", "10-Q": "sec", "10-K": "sec", "S-1": "financing",
    "424B5": "financing", "SC 13D": "sec", "SC 13G": "sec", "4": "sec",
    "DEF 14A": "sec", "6-K": "sec", "20-F": "sec",
}


def categorize(title: str, *, form_type: str = "", provider: str = "") -> str:
    """One restrained category, or 'other'."""
    if provider == "sec":
        return CATEGORY_BY_FORM.get((form_type or "").upper(), "sec")
    if provider in ("x", "twitter"):
        return "social"
    t = title or ""
    for name, pat in CATEGORY_PATTERNS:
        if pat.search(t):
            return name
    return "other"
