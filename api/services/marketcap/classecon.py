"""Class economics from filing TEXT (Gate F): which share classes carry an economic interest, and at what ratio an
unlisted class converts into a listed one. Sentence-level, deterministic; every conclusion keeps its snippet (the
caller attaches the accession).

Per sentence that names two or more share classes (and is not about notes / debentures / preferred stock):
  CONVERSION     "<X> ... convertible / convert ... into one | a | an equivalent number of | the same number of |
                  N shares of <Y>", or "... on a one-for-one | one-to-one | share-for-share | 1:1 basis"
  EQUAL_RIGHTS   "(dividend and liquidation) rights ... identical | equal", "treated equally, identically and
                  ratably, on a per share basis" -> per-share economic equivalence of the named classes
  VOTING_ONLY    "<X> ... no economic rights" / "not entitled to (receive) dividends" / "no rights to dividends"
  NOT_CONVERTIBLE "<X> ... is not convertible"
Capital-structure COMPLEX markers (counted only in sentences about share classes / units, never notes):
  UP_C (units exchangeable for Class A), VARIABLE_CONVERSION (conversion rate adjusted / as-converted), TRACKING_STOCK,
  EXCHANGEABLE_SHARES (of a subsidiary), PAIRED_STAPLED.
Nothing is inferred beyond these statements.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .textcover import for_matching

CLASS_RX = re.compile(r"\bclass\s+([a-z])(?:-\d)?\b", re.I)
EXCLUDE = re.compile(r"\bnotes?\b|debentures?|preferred\s+stock|warrants?", re.I)
WORDNUM = {"one": 1.0, "a": 1.0, "an equivalent number of": 1.0, "the same number of": 1.0, "two": 2.0, "three": 3.0,
           "four": 4.0, "five": 5.0, "ten": 10.0, "one hundred": 100.0}
RATIO_INTO = re.compile(r"(?:into|to|for)\s+(one|a|an equivalent number of|the same number of|two|three|four|five|ten|one hundred|\d[\d,_]*)\s+"
                        r"(?:fully\s+paid\s+(?:and\s+non-?assessable\s+)?)?(?:shares?\s+of\s+(?:our\s+)?)?class\s+([a-z])\b", re.I)
RATIO_BASIS = re.compile(r"on\s+a\s+(one\s*-?\s*(?:for|to)\s*-?\s*one|share\s*-?\s*for\s*-?\s*share|1\s*:\s*1|1\s*-?\s*for\s*-?\s*1)\s+basis", re.I)
EQUAL = re.compile(r"(?:dividend|liquidation|economic)[^.;]{0,160}?(?:are|be|is)\s+(?:identical|equal|the same)"
                   r"|(?:identical|equal|same)\s+(?:liquidation\s+and\s+dividend|dividend\s+and\s+liquidation|economic)\s+rights"
                   r"|treated\s+equally,?\s+identically,?\s+and\s+ratably", re.I)
VOTING_ONLY = re.compile(r"no\s+economic\s+rights|not\s+(?:be\s+)?entitled\s+to\s+(?:receive\s+)?(?:any\s+)?dividends"
                         r"|no\s+rights?\s+to\s+(?:receive\s+)?(?:any\s+)?(?:dividends|distributions)", re.I)
NOT_CONV = re.compile(r"(?:is|are)\s+not\s+convertible", re.I)
COMPLEX = [
    ("UP_C", re.compile(r"\b(?:LLC|OpCo|Holdings|Partnership|Operating|common)\s+units?\b[^.;]{0,160}?exchang|exchang[^.;]{0,80}?\b(?:LLC|OpCo)\s+units?\b|\bUp-?C\b", re.I)),
    ("VARIABLE_CONVERSION", re.compile(r"conversion\s+rate[^.;]{0,160}?(?:adjust|reduc)|as-converted\s+basis", re.I)),
    ("TRACKING_STOCK", re.compile(r"tracking\s+stock", re.I)),
    ("EXCHANGEABLE_SHARES", re.compile(r"exchangeable\s+shares", re.I)),
    ("PAIRED_STAPLED", re.compile(r"\b(?:paired|stapled)\s+(?:shares|securities|units)", re.I)),
]


@dataclass
class ClassEcon:
    conversions: dict = field(default_factory=dict)    # from -> (to, ratio, snippet)
    convertible_no_ratio: dict = field(default_factory=dict)   # from -> (to, snippet)
    equal_rights: list = field(default_factory=list)   # [(frozenset(classes), snippet)]
    voting_only: dict = field(default_factory=dict)    # class -> snippet
    not_convertible: dict = field(default_factory=dict)
    complex: dict = field(default_factory=dict)        # marker -> snippet
    conflicts: list = field(default_factory=list)

    def equal(self, a: str, b: str) -> str | None:
        for cls, snip in self.equal_rights:
            if a in cls and b in cls:
                return snip
        return None


def _ratio(tok: str) -> float | None:
    tok = re.sub(r"\s+", " ", tok.lower().replace("_", ".").replace(",", ""))
    if tok in WORDNUM:
        return WORDNUM[tok]
    try:
        return float(tok)
    except ValueError:
        return None


def sentences(t: str) -> list[str]:
    return re.split(r"(?<=[.;])\s+(?=[A-Z(])", t)


def extract(text: str) -> ClassEcon:
    t = for_matching(text)
    out = ClassEcon()
    for s in sentences(t):
        cls = [c.upper() for c in CLASS_RX.findall(s)]
        if not cls:
            if re.search(r"units?\b", s, re.I):
                for name, rx in COMPLEX:
                    if name == "UP_C" and rx.search(s) and re.search(r"class\s+a", s, re.I):
                        out.complex.setdefault(name, s[:400])
            continue
        about_notes = bool(EXCLUDE.search(s))
        for name, rx in COMPLEX:
            if rx.search(s) and not (about_notes and name == "VARIABLE_CONVERSION"):
                out.complex.setdefault(name, s[:400])
        if about_notes:
            continue
        uniq = list(dict.fromkeys(cls))
        if len(uniq) >= 2 and EQUAL.search(s):
            out.equal_rights.append((frozenset(uniq), s[:400]))
        if len(uniq) == 1:
            if VOTING_ONLY.search(s):
                out.voting_only.setdefault(uniq[0], s[:400])
            if NOT_CONV.search(s):
                out.not_convertible.setdefault(uniq[0], s[:400])
        if re.search(r"\bconvert", s, re.I) and len(uniq) >= 2:
            ci = re.search(r"\bconvert", s, re.I).start()
            before = [c.upper() for c in CLASS_RX.findall(s[:ci])]
            if not before:
                continue
            frm = before[-1]
            m = RATIO_INTO.search(s, ci)
            if m:
                to, r = m.group(2).upper(), _ratio(m.group(1))
                # ⛔ a conversion RATIO is a per-share term ("each Class B share is convertible into one Class A
                # share"), never a transaction narrative: VTIX "transferred 1,000,000 shares of Class B ... converted
                # into 1,000,000 shares of Class A" was read as x1,000,000 (cap 117,747x Massive), UFG as x6,000,000.
                # A digit ratio needs a per-share frame and must be a plausible ratio; a compound consideration
                # ("into one Class A Common Share AND one Conversion Share", JBS) is not a single ratio at all.
                per_share = re.search(r"\beach\b|\bevery\b|\bper\s+share\b|share-for-share", s[:m.end()], re.I)
                digit = bool(re.match(r"\d", m.group(1)))
                compound = re.match(r"[^.;]{0,40}?\band\s+(?:one|a|an|\d[\d,]*)\s+(?:[\w-]+\s+){0,3}shares?\b",
                                    s[m.end():], re.I)
                if compound or (digit and (not per_share or "," in m.group(1) or (r or 0) > 100)):
                    out.conflicts.append((frm, None, (to, r), s[:200]))
                    continue
            else:
                after = [c.upper() for c in CLASS_RX.findall(s[ci:])]
                to = after[0] if after else None
                b = RATIO_BASIS.search(s, ci)
                r = 1.0 if b else None
            if not to or to == frm:
                continue
            if r is None:
                out.convertible_no_ratio.setdefault(frm, (to, s[:400]))
                continue
            prev = out.conversions.get(frm)
            if prev and (prev[0] != to or abs(prev[1] - r) > 1e-9):
                out.conflicts.append((frm, prev[:2], (to, r), s[:200]))
            elif not prev:
                out.conversions[frm] = (to, r, s[:400])
    return out
