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
# "to be outstanding after this offering" (canonical) and the summary-table spellings measured on the 2026-10-01
# miss sample: "Common stock outstanding after this offering 19,246,097 shares", dot leaders ("..........."),
# "issued and outstanding after the offering (1): 6,139,973 shares".
AFTER = (r"(?:to be\s+)?(?:issued\s+and\s+)?outstanding\s+(?:after|upon (?:the )?completion of|immediately (?:after|following)|following)\s+"
         r"(?:the\s+completion\s+of\s+)?(?:this|the|our)\s+(?:initial\s+public\s+|global\s+|public\s+)?offering[s]?")
LEAD = r"(?:\s*\(\d\)){0,3}\s*[:\-]?[\s._]*"
LINE = re.compile(
    rf"(total\s+[^.;]{{0,120}}?|(?:class\s+([a-z])\s+)?[a-z\- ]{{0,40}}?(?:common stock|ordinary shares|common shares|shares))\s+{AFTER}"
    rf"{LEAD}{NUM}\s*(?:shares|ordinary shares|common shares)?", re.I)
# a count stated ASSUMING the over-allotment / additional-share option is exercised is not the post-offering count
ASSUMES_OPTION = re.compile(r"^[^.;]{0,40}?assuming\s+(?:the\s+)?(?:full\s+)?exercise|^[^.;]{0,60}?over-?allotment option is exercised in full", re.I)
ADS_ONLY = re.compile(r"\b(?:ADSs?|American depositary shares?)\b", re.I)


@dataclass
class IpoResult:
    status: str                       # OK | MULTI_CLASS | AMBIGUOUS | NOT_FOUND
    counts: dict = field(default_factory=dict)   # class letter | "COMMON" | "TOTAL" -> shares
    snippets: list = field(default_factory=list)
    note: str = ""


def _windows(t: str, before: int = 260, after: int = 420) -> str:
    """Every LINE match contains 'outstanding'; scan only merged windows around it (a 600 KB prospectus took ~1 s of
    regex). Windows are joined by '. ' so no match (all spans are [^.;]-bounded or short) can cross two windows."""
    spans = []
    for m in re.finditer(r"outstanding", t, re.I):
        a, b = max(0, m.start() - before), min(len(t), m.end() + after)
        if spans and a <= spans[-1][1]:
            spans[-1][1] = b
        else:
            spans.append([a, b])
    return ". ".join(t[a:b] for a, b in spans)


def parse(text: str) -> IpoResult:
    t = _windows(for_matching(text))
    found: dict[str, set] = {}
    snips = []
    for m in LINE.finditer(t):
        lab_text, n = m.group(1), m.group(3)
        if ASSUMES_OPTION.search(t[m.end(): m.end() + 160]):
            found.setdefault("_OPTION_ASSUMED", set()).add(float(n.replace(",", "")))
            continue
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
    if "_OPTION_ASSUMED" in found:
        return IpoResult("AMBIGUOUS", {k: sorted(v) for k, v in found.items()}, snips, "count assumes the option is exercised")
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
