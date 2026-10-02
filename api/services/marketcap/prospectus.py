"""Actual share counts stated in OFFERING DOCUMENTS (424B1/424B4/424B5/424B7 supplements, S-1/F-1/S-3/F-3).

Why: a hyper-diluting issuer (shelf takedowns, registered directs, serial reverse splits) files one annual cover a year,
while its share count multiplies between covers. Every takedown supplement states the ACTUAL count the offering is
measured against, e.g. (PAVS 424B5, 2026-06-16):

    "the number of Class A Ordinary Shares outstanding prior to and after this Offering is based on 40,985,063
     Class A Ordinary Shares outstanding as of June 15, 2026"

Only ACTUAL counts at a stated date are taken -- never the pro-forma "to be outstanding after this offering" figure
(at-the-market supplements state hypothetical maximum sales; registered directs assume warrant exercise). The stated
date must be RECENT (<= 60 days before the filing): a supplement also repeats stale counts (the dilution table's
"based on 667,247 shares outstanding as of September 30, 2025", restated for SOME later splits but not others) and
those are never used. A count of ADSs is never a share count. Several different counts for the same class and date
-> AMBIGUOUS (refused).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from .textcover import DATE, NUM, for_matching, parse_date, _qualified_not_outstanding

SHARES = (r"(?:(?:class\s+([a-z])\s+)?(?:ordinary\s+shares?|common\s+shares?|shares\s+of\s+(?:our\s+|the\s+company's\s+)?"
          r"(?:class\s+([a-z])\s+)?common\s+stock|(?:class\s+([a-z])\s+)?common\s+stock|shares))")
RULES = [
    # "based on 40,985,063 Class A Ordinary Shares outstanding as of June 15, 2026"
    ("BASED_ON_N_OUTSTANDING_AS_OF", re.compile(
        rf"based\s+(?:up)?on\s+(?:an\s+aggregate\s+of\s+|approximately\s+)?{NUM}\s+(?:of\s+(?:our|the\s+company's)\s+)?{SHARES}\s+(?:issued\s+and\s+)?outstanding"
        rf"\s+(?:as\s+of|at|on)\s+({DATE})", re.I)),
    # "As of June 15, 2026, there were 40,985,063 Class A Ordinary Shares (issued and) outstanding"
    ("AS_OF_THERE_WERE_N", re.compile(
        rf"(?:as\s+of|at|on)\s+({DATE}),?\s+(?:there\s+were|we\s+had)\s+(?:only\s+|approximately\s+)?{NUM}\s+(?:of\s+our\s+)?{SHARES}\s+"
        rf"(?:issued\s+and\s+)?outstanding", re.I)),
    # "40,985,063 Class A Ordinary Shares were (issued and) outstanding as of June 15, 2026"
    ("N_OUTSTANDING_AS_OF", re.compile(
        rf"{NUM}\s+{SHARES}\s+(?:were\s+)?(?:issued\s+and\s+)?outstanding\s+(?:as\s+of|at|on)\s+({DATE})", re.I)),
]
# Counts dated by the document itself (as of its own date): "Total Ordinary Shares outstanding before this offering
# 31,834,487 Ordinary Shares" (BAOS 424B5 2026-07-24), "Ordinary Shares issued and outstanding prior to this
# offering: 59,579,883 Class A Ordinary Shares and 3,166,667 Class B Ordinary Shares" (TWG 424B5 2026-09-11),
# "based on 31,834,487 Ordinary Shares outstanding as of the date of this prospectus supplement".
DOC_DATED = [
    ("OUTSTANDING_PRIOR_TO_OFFERING", re.compile(
        rf"(?:issued\s+and\s+)?outstanding\s+(?:prior\s+to|before)\s+(?:this|the)\s+offering(?:\s*\(\d\))*\s*[:\-]?\s*"
        rf"((?:approximately\s+)?{NUM}\s+{SHARES}(?:\s*(?:,|and)\s*{NUM}\s+{SHARES}){{0,2}})", re.I)),
    ("BASED_ON_N_AS_OF_THIS_PROSPECTUS", re.compile(
        rf"based\s+on\s+((?:approximately\s+)?{NUM}\s+{SHARES})\s+(?:issued\s+and\s+)?outstanding\s+as\s+of\s+the\s+date\s+of\s+"
        rf"this\s+prospectus(?:\s+supplement)?", re.I)),
]
EACH_COUNT = re.compile(rf"{NUM}\s+{SHARES}", re.I)
ADS_NEAR = re.compile(r"\b(?:ADSs?|American\s+depositary\s+shares?|depositary\s+shares?)\b", re.I)
RECENT_DAYS = 60


@dataclass
class ProspHit:
    class_label: str            # COMMON or a class letter
    count: float
    as_of: date
    rule: str
    snippet: str


@dataclass
class ProspResult:
    status: str                 # OK | MULTI_CLASS | AMBIGUOUS | NOT_FOUND | STALE_ONLY
    hits: list = field(default_factory=list)
    note: str = ""


def _windows(t: str) -> str:
    spans = []
    for m in re.finditer(r"outstanding", t, re.I):
        a, b = max(0, m.start() - 320), min(len(t), m.end() + 140)
        if spans and a <= spans[-1][1]:
            spans[-1][1] = b
        else:
            spans.append([a, b])
    return ". ".join(t[a:b] for a, b in spans)


def parse(text: str, filing_date: date) -> ProspResult:
    t = _windows(for_matching(text))
    found: dict[tuple, set] = {}
    snips: dict[tuple, tuple] = {}
    stale = 0
    for name, rx in RULES:
        for m in rx.finditer(t):
            g = m.groups()
            ns = next((x for x in g if x and re.fullmatch(r"\d{1,3}(?:,\d{3})+|\d{5,}", x)), None)
            ds = next((x for x in g if x and len(x) > 2 and parse_date(x)), None)
            letters = [x.upper() for x in g if x and re.fullmatch(r"[a-zA-Z]", x)]
            if not ns or not ds:
                continue
            seg = t[m.start():m.end()]
            if ADS_NEAR.search(seg):
                continue                                      # an ADS count is never a share count
            npos = t.find(ns, m.start())
            if npos > 0 and "$" in t[max(0, npos - 3):npos]:
                continue
            if _qualified_not_outstanding(t, npos, len(ns)):
                continue
            n, d = float(ns.replace(",", "")), parse_date(ds)
            if d is None or n < 1000:
                continue
            if not (filing_date - timedelta(days=RECENT_DAYS) <= d <= filing_date):
                stale += 1
                continue
            key = (letters[0] if letters else "COMMON", d)
            found.setdefault(key, set()).add(n)
            snips.setdefault(key, (name, seg[:300]))
    for name, rx in DOC_DATED:
        for m in rx.finditer(t):
            seg = t[m.start():m.end()]
            ctx = t[max(0, m.start() - 120):m.end() + 60]
            if ADS_NEAR.search(seg) or re.search(r"pro\s+forma|as\s+adjusted|assum", ctx, re.I):
                continue
            for c in EACH_COUNT.finditer(m.group(1)):
                n = float(c.group(1).replace(",", ""))
                letters = [x.upper() for x in c.groups()[1:] if x]
                if n < 1000:
                    continue
                key = (letters[0] if letters else "COMMON", filing_date)
                found.setdefault(key, set()).add(n)
                snips.setdefault(key, (name, seg[:300]))
    if not found:
        return ProspResult("STALE_ONLY" if stale else "NOT_FOUND")
    if any(len(v) > 1 for v in found.values()):
        return ProspResult("AMBIGUOUS", note=str({f"{k[0]}@{k[1]}": sorted(v) for k, v in found.items()})[:300])
    latest = max(d for _c, d in found)
    keys = [k for k in found if k[1] == latest]
    hits = [ProspHit(c, next(iter(found[(c, d)])), d, snips[(c, d)][0], snips[(c, d)][1]) for c, d in sorted(keys)]
    classes = {h.class_label for h in hits}
    if "COMMON" in classes and len(classes) > 1:
        return ProspResult("AMBIGUOUS", hits, "unlabelled and class-labelled counts")
    return ProspResult("MULTI_CLASS" if classes != {"COMMON"} else "OK", hits)
