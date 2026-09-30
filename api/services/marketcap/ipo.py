"""IPO inception capitalization from the offering prospectus (424B4/424B1/424B3, S-1/F-1 and amendments).

The "The Offering" summary states the POST-OFFERING capitalization directly:
    "Class A common stock to be outstanding after this offering 98,682,548 shares (or 103,682,548 shares if the
     underwriters exercise their option ... in full)"
    "Ordinary shares to be outstanding upon completion of this offering 1,026,054,856 ordinary shares"
That count already includes new PRIMARY shares and treats SECONDARY (selling-holder) shares as the existing shares
they are; the parenthetical over-allotment figure is never used -- an exercised option reaches the dataset through
the first periodic cover. ADS lines are a subset of the ordinary shares and are ignored. Anything else (direct
listings, pro-forma-only statements, conflicting counts) is refused -> IPO_CAPITALIZATION_UNRESOLVED.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .textcover import for_matching

NUM = r"(\d{1,3}(?:,\d{3})+|\d{5,})"
AFTER = (r"to be outstanding\s+(?:after|upon (?:the )?completion of|immediately (?:after|following)|following)\s+"
         r"(?:this|the|our)\s+(?:initial\s+public\s+|global\s+|public\s+)?offering[s]?")
LINE = re.compile(
    rf"(total\s+[^.;]{{0,120}}?|(?:class\s+([a-z])\s+)?[a-z\- ]{{0,40}}?(?:common stock|ordinary shares|common shares|shares))\s+{AFTER}"
    rf"\s*[:\-]?\s*{NUM}\s*(?:shares|ordinary shares|common shares)?", re.I)
ADS_ONLY = re.compile(r"\b(?:ADSs?|American depositary shares?)\b", re.I)


@dataclass
class IpoResult:
    status: str                       # OK | MULTI_CLASS | AMBIGUOUS | NOT_FOUND
    counts: dict = field(default_factory=dict)   # class letter | "COMMON" | "TOTAL" -> shares
    snippets: list = field(default_factory=list)
    note: str = ""


def parse(text: str) -> IpoResult:
    t = for_matching(text)
    found: dict[str, set] = {}
    snips = []
    for m in LINE.finditer(t):
        lab_text, n = m.group(1), m.group(3)
        lab_text = re.split(r"\d[\d,]*(?:\s*shares)?", lab_text)[-1]      # the label starts after any prior line
        if ADS_ONLY.search(lab_text) and not re.search(r"ordinary|common", lab_text, re.I):
            continue
        cls = re.findall(r"\bclass\s+([a-z])\b", lab_text, re.I)
        if re.search(r"\btotal\b", lab_text, re.I):
            key = "TOTAL"
        elif cls:
            key = cls[-1].upper()
        else:
            key = "COMMON"
        found.setdefault(key, set()).add(float(n.replace(",", "")))
        snips.append((key, m.start(), t[m.start():m.end()][:300]))
    if not found:
        return IpoResult("NOT_FOUND")
    if any(len(v) > 1 for v in found.values()):
        return IpoResult("AMBIGUOUS", {k: sorted(v) for k, v in found.items()}, snips, "a class has several counts")
    counts = {k: next(iter(v)) for k, v in found.items()}
    letters = [k for k in counts if len(k) == 1]
    if letters:
        if "COMMON" in counts:
            return IpoResult("AMBIGUOUS", counts, snips, "unlabelled and class-labelled counts")
        if "TOTAL" in counts and abs(sum(counts[k] for k in letters) - counts["TOTAL"]) > 1:
            # classes with zero / 'None' shares are omitted by the line rule; the total must still reconcile
            return IpoResult("AMBIGUOUS", counts, snips, "class counts do not sum to the stated total")
        return IpoResult("MULTI_CLASS", counts, snips)
    if "COMMON" in counts:
        if "TOTAL" in counts and counts["TOTAL"] != counts["COMMON"]:
            return IpoResult("AMBIGUOUS", counts, snips, "total differs from the single class")
        return IpoResult("OK", {"COMMON": counts["COMMON"]}, snips)
    return IpoResult("AMBIGUOUS", counts, snips, "only a total")
