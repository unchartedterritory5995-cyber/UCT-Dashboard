"""PUBR's matching rule: which names in a government agency's records are this company's.

A ticker is not in any agency's records. Each agency lists a NAME (a contract recipient, a trial's lead
sponsor, a drug application's sponsor, a lobbying client), so the server compares names, and this module
is the whole rule. It is pure: no network, no clock.

THE COMPANY'S NAMES, from the site's own reference data:
  site       the company name the server already holds for the ticker (`held_reads.held_name`, the
             ticker-meta cache), e.g. "Kestrel Dynamics Corporation";
  sec        the company's name as the SEC lists it (EDGAR submissions `name`, found by its CIK), e.g.
             "KESTREL DYNAMICS CORP";
  sec_former a former SEC name (`formerNames`) that was still in use within `FORMER_NAME_YEARS`.

NORMALISING A NAME (both sides, the same way): capitals; accents dropped; a trailing SEC state marker
("/DE/") dropped; "&" read as AND; dots between initials closed up ("U.S." is "US"), any other mark a
space; a few standard abbreviations written out ("PHARMS" is PHARMACEUTICALS, "LABS" LABORATORIES,
"INTL" INTERNATIONAL); a leading THE dropped; trailing legal forms dropped (INC, CORP, CORPORATION,
CO, COMPANY, LLC, LTD, PLC, "AND CO", ...). "Kestrel Dynamics Corporation" and "KESTREL DYNAMICS CORP"
are both KESTREL DYNAMICS.

A NAME IN THE RECORDS COUNTS FOR THE COMPANY WHEN, after normalising, it is
  same_name    the same words in the same order as one of the company's names;
  same_words   the same words in another order ("DYNAMICS KESTREL"), two words or more;
  descriptor   the same name but for ONE trailing business word from `DESCRIPTORS` on either side
               ("KESTREL DYNAMICS LABORATORIES" for KESTREL DYNAMICS), and only when the shorter
               name is distinctive: two words or more, or one word of five letters or more that is not
               a common word (`GENERIC`).
ANYTHING ELSE THE AGENCY'S SEARCH RETURNED IS NOT COUNTED, and is shown as returned but not counted, so a
member can judge (a subsidiary that contracts under its own name, a business with a similar name). The
rule never guesses a parent or a subsidiary: a match is made from the names alone.

`search_text(names)` is the words sent to an agency's search: the normalised site name (or, without one,
the SEC name). `search_core` drops one trailing descriptor when what is left is distinctive, for the
searches whose names an agency abbreviates (the FDA writes "PHARMS").
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Any, Iterable, Optional

#: a former SEC name counts when it was given up no longer ago than this (the builder's default)
FORMER_NAME_YEARS = 5

#: trailing legal forms, one word each (dropped from the end, again and again)
LEGAL_FORMS = frozenset({
    "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "COS", "COMPANIES", "LTD", "LIMITED", "LLC",
    "LP", "LLP", "PLC", "NV", "SA", "AG", "SE", "ASA", "AB", "OYJ", "SPA", "BV", "GMBH", "KGAA", "PTY", "SAB",
    "CV", "DE", "LTDA", "PBC",
})
#: trailing legal forms of several words
LEGAL_FORM_RUNS = (("AND", "CO"), ("AND", "COMPANY"), ("L", "L", "C"), ("L", "P"), ("N", "V"), ("S", "A"),
                   ("S", "P", "A"), ("P", "L", "C"), ("B", "V"), ("DE", "C", "V"))
#: abbreviations written out (both sides), so "VERTEX PHARMS" and "VERTEX PHARMACEUTICALS" are one name
ABBREVIATIONS = {
    "PHARMS": "PHARMACEUTICALS", "PHARMACEUTICAL": "PHARMACEUTICALS", "LABS": "LABORATORIES",
    "LAB": "LABORATORIES", "LABORATORY": "LABORATORIES", "INTL": "INTERNATIONAL", "MFG": "MANUFACTURING",
    "HLDGS": "HOLDINGS", "HLDG": "HOLDINGS", "SVCS": "SERVICES",
}
#: a trailing business word a name may carry or lack and still be the company's
DESCRIPTORS = frozenset({
    "LABORATORIES", "PHARMACEUTICALS", "PHARMA", "THERAPEUTICS", "BIOPHARMA", "US", "USA", "AMERICA",
    "AMERICAS", "INTERNATIONAL", "HOLDINGS", "GROUP",
})
#: one-word names too common to stand alone in the descriptor rule
GENERIC = frozenset({
    "UNITED", "AMERICAN", "GENERAL", "NATIONAL", "INTERNATIONAL", "GLOBAL", "FIRST", "ADVANCED", "APPLIED",
    "ALLIED", "STANDARD", "UNIVERSAL", "CONTINENTAL", "PACIFIC", "ATLANTIC", "SOUTHERN", "NORTHERN",
    "WESTERN", "EASTERN", "CENTRAL", "PREMIER", "SUMMIT", "PIONEER", "LIBERTY", "EAGLE", "APEX", "ALPHA",
    "OMEGA", "DELTA", "NOVA", "PRIME", "INTEGRATED", "DYNAMIC", "STRATEGIC", "TECHNOLOGY", "SYSTEMS",
    "SERVICES", "SOLUTIONS", "INDUSTRIES", "ENTERPRISES", "PARTNERS", "CAPITAL", "HEALTH", "MEDICAL",
    "ENERGY", "POWER", "DATA", "DIGITAL", "SCIENCE", "SCIENCES", "BIO", "THERAPEUTICS", "PHARMA",
    "PHARMACEUTICALS", "LABORATORIES", "HOLDINGS", "GROUP", "AMERICA", "AMERICAS", "USA", "US",
})

HOW_WORDS = {
    "same_name": "Same name",
    "same_words": "Same words in another order",
    "descriptor": "Same name apart from one business word",
}
SOURCE_WORDS = {"site": "the site's company name", "sec": "the SEC's name for the company",
                "sec_former": "a former SEC name"}

_STATE_MARK = re.compile(r"\s*[/\\][A-Z]{2,3}[/\\]?\s*$")
_INITIALS = re.compile(r"\b(?:[A-Z]\.){2,}")
_NOT_WORD = re.compile(r"[^A-Z0-9]+")


def _ascii_upper(name: str) -> str:
    s = unicodedata.normalize("NFKD", name)
    return "".join(c for c in s if not unicodedata.combining(c)).upper()


def tokens(name: Any) -> tuple[str, ...]:
    """A name's normalised words (see the module docstring). Empty for anything that is not text."""
    if not isinstance(name, str) or not name.strip():
        return ()
    s = _ascii_upper(name).strip()
    while True:
        cut = _STATE_MARK.sub("", s)
        if cut == s:
            break
        s = cut
    s = s.replace("&", " AND ").replace("+", " AND ")
    s = _INITIALS.sub(lambda m: m.group(0).replace(".", ""), s)
    words = [ABBREVIATIONS.get(w, w) for w in _NOT_WORD.sub(" ", s).split()]
    if len(words) > 1 and words[0] == "THE":
        words = words[1:]
    changed = True
    while changed and len(words) > 1:
        changed = False
        for run in LEGAL_FORM_RUNS:
            n = len(run)
            if len(words) > n and tuple(words[-n:]) == run:
                words = words[:-n]
                changed = True
                break
        if not changed and len(words) > 1 and words[-1] in LEGAL_FORMS:
            words = words[:-1]
            changed = True
    return tuple(words)


def normalise(name: Any) -> str:
    """The normalised name as one string ('' for nothing)."""
    return " ".join(tokens(name))


def distinctive(words: tuple[str, ...]) -> bool:
    """Two words or more, or one word of five letters or more that is not a common word."""
    if len(words) >= 2:
        return True
    return len(words) == 1 and len(words[0]) >= 5 and words[0] not in GENERIC


def how_matched(candidate: Any, company: tuple[str, ...]) -> Optional[str]:
    """'same_name' | 'same_words' | 'descriptor' when the record's name `candidate` is the company's
    name `company` (already normalised words), else None."""
    cand = tokens(candidate)
    if not cand or not company:
        return None
    if cand == company:
        return "same_name"
    if len(cand) >= 2 and len(cand) == len(company) and sorted(cand) == sorted(company):
        return "same_words"
    longer, shorter = (cand, company) if len(cand) > len(company) else (company, cand)
    if (len(longer) == len(shorter) + 1 and longer[:-1] == shorter and longer[-1] in DESCRIPTORS
            and distinctive(shorter)):
        return "descriptor"
    return None


def company_names(site_name: Any, sec_name: Any, former: Iterable[dict] | None = None, *,
                  today: Optional[date] = None) -> list[dict]:
    """The company's names, each `{name, source, words, until}`, the site's name first, then the SEC's
    (both kept even when they normalise alike, so a member sees each), then the former SEC names that
    normalise to a name not already listed. `former` is EDGAR's `formerNames` list ({name, from, to}); one
    given up more than `FORMER_NAME_YEARS` ago is left out."""
    out: list[dict] = []
    seen: set[tuple[str, ...]] = set()

    def add(name, source, until=None):
        words = tokens(name)
        if not words or (source == "sec_former" and words in seen):
            return
        if any(n["source"] == source and n["words"] == words for n in out):
            return
        seen.add(words)
        out.append({"name": " ".join(str(name).split()), "source": source, "words": words, "until": until})

    add(site_name, "site")
    add(sec_name, "sec")
    day = today or date.today()
    floor = date(day.year - FORMER_NAME_YEARS, day.month, min(day.day, 28)).isoformat()
    rows = [f for f in (former or []) if isinstance(f, dict) and isinstance(f.get("name"), str)]
    rows.sort(key=lambda f: str(f.get("to") or ""), reverse=True)
    for f in rows:
        until = str(f.get("to") or "")[:10] or None
        if until and until < floor:
            continue
        add(f["name"], "sec_former", until)
    return out


def match_name(candidate: Any, names: list[dict]) -> Optional[dict]:
    """`{how, against, source}` for the first of the company's names the record's name matches, else None."""
    for n in names or []:
        how = how_matched(candidate, tuple(n.get("words") or ()))
        if how:
            return {"how": how, "against": n["name"], "source": n["source"]}
    return None


def search_text(names: list[dict]) -> Optional[str]:
    """The words sent to an agency's name search: the first name's normalised words, or None."""
    for n in names or []:
        words = tuple(n.get("words") or ())
        if words:
            return " ".join(words)
    return None


def search_core(names: list[dict]) -> Optional[str]:
    """As `search_text`, with one trailing descriptor dropped when what is left is distinctive."""
    for n in names or []:
        words = tuple(n.get("words") or ())
        if not words:
            continue
        if len(words) >= 2 and words[-1] in DESCRIPTORS and distinctive(words[:-1]):
            words = words[:-1]
        return " ".join(words)
    return None


def public_names(names: list[dict]) -> list[dict]:
    """The company's names as the route shows them (without the internal word tuples)."""
    return [{"name": n["name"], "source": n["source"], "source_words": SOURCE_WORDS.get(n["source"], n["source"]),
             "until": n.get("until")} for n in names or []]


class Tally:
    """The names one read returned, sorted into counted and not counted, with how each counted name
    matched. `add(name, amount=None)` once per record; `counted()` / `not_counted()` the lists."""

    def __init__(self, names: list[dict]):
        self._names = names
        self._seen: dict[str, dict] = {}

    def add(self, name: Any, amount: Optional[float] = None, records: int = 1) -> Optional[dict]:
        if not isinstance(name, str) or not name.strip():
            return None
        shown = " ".join(name.split())
        key = shown.upper()
        row = self._seen.get(key)
        if row is None:
            m = match_name(shown, self._names)
            row = {"name": shown, "counted": m is not None, "how": m["how"] if m else None,
                   "how_words": HOW_WORDS.get(m["how"]) if m else None, "against": m["against"] if m else None,
                   "amount": None, "records": 0}
            self._seen[key] = row
        row["records"] += records
        if isinstance(amount, (int, float)) and not isinstance(amount, bool):
            row["amount"] = (row["amount"] or 0.0) + float(amount)
        return row

    def is_counted(self, name: Any) -> bool:
        row = self._seen.get(" ".join(str(name or "").split()).upper())
        return bool(row and row["counted"])

    def _sorted(self, counted: bool) -> list[dict]:
        rows = [dict(r) for r in self._seen.values() if r["counted"] is counted]
        rows.sort(key=lambda r: (-(r["amount"] if r["amount"] is not None else -1e30), -r["records"], r["name"]))
        return rows

    def counted(self) -> list[dict]:
        return self._sorted(True)

    def not_counted(self, cap: int = 12) -> tuple[list[dict], int]:
        """(the first `cap` names not counted, largest first, and how many there were in all)."""
        rows = self._sorted(False)
        return rows[:cap], len(rows)
