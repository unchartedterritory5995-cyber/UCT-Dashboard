"""THE NAME CATALOGUE: well-known indicators a member may ask Create Indicator for BY NAME that it
does not build by name (`api/data/indicator_name_catalogue.json`).

It exists for one thing. When a request names one of these, the turn's record carries the
catalogue row's ID, never the member's words, so the weekly owner report can say which names are
asked for most and the named-indicator library can be grown by demand.

* NAMES ONLY. No formula is here and none is implied: a row says "people call something this".
* A spelling the library answers is not unknown: it is dropped when the catalogue is read,
  whether or not the file has been regenerated since. A spelling of the same row the library does
  NOT answer (an acronym it may not carry, such as "obv") is still unknown and still counted.
* ``names_in`` reads a request and returns IDS. Nothing else leaves this module.
"""
from __future__ import annotations

import functools
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

PATH = Path(__file__).resolve().parents[1] / "data" / "indicator_name_catalogue.json"
#: A name refused as unknown that is not in the catalogue. Its words are dropped.
OTHER = "other"
#: The shape of a row's id (the library's own shape).
ID = re.compile(r"[a-z][a-z0-9_]{1,47}")
#: At most this many names are recorded for one turn.
MAX_PER_TURN = 4
#: A request is read up to here (the door's own message cap is far below it).
_READ_CHARS = 4000


def norm(text: Any) -> str:
    """One spelling of a phrase: lower case; letters, digits and % only; single spaces."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9%]+", " ", str(text or "").lower())).strip()


@functools.lru_cache(maxsize=1)
def _file() -> Tuple[Dict[str, Any], ...]:
    """The rows as written. Never raises: an unreadable catalogue is an empty one (the door and
    its record go on; a test fails)."""
    try:
        rows = json.loads(PATH.read_text(encoding="utf-8"))["names"]
        return tuple({"id": r["id"], "name": r["name"], "aliases": tuple(r["aliases"]),
                      "distinctive": r.get("distinctive") is True} for r in rows)
    except Exception:                              # noqa: BLE001
        logger.exception("[indicator-names] the catalogue could not be read")
        return ()


def _library_spellings() -> frozenset:
    from api.services import named_indicators
    return frozenset(norm(alias) for alias, _ in named_indicators.phrases())


def _answered(spelling: str, known: frozenset) -> bool:
    """Does the library answer this spelling: is one of its own spellings written in it, as whole words?"""
    padded = f" {spelling} "
    return any(f" {k} " in padded for k in known)


@functools.lru_cache(maxsize=1)
def catalogue() -> Tuple[Dict[str, Any], ...]:
    """What is still unknown: each row of the file with the spellings the library does not answer
    (a row with none left is gone)."""
    known = _library_spellings()
    rows = []
    for r in _file():
        left = tuple(a for a in r["aliases"] if not _answered(a, known))
        if left:
            rows.append({**r, "aliases": left})
    return tuple(rows)


def is_short_acronym(spelling: str) -> bool:
    """A bare two- or three-letter word ("kvo", "jma"): several such are real tickers, so one is
    never looked up as a name (the library's own rule for its spellings)."""
    return " " not in spelling and len(spelling) <= 3


def withheld_spellings() -> Tuple[Tuple[str, str], ...]:
    """⭐ (spelling, id) for every DISTINCTIVE name the library has no entry for: the names the door
    builds and withholds. A bare short acronym is never one of them."""
    return tuple((a, r["id"]) for r in catalogue() if r["distinctive"]
                 for a in r["aliases"] if not is_short_acronym(a))


def every_spelling(entry_id: Any) -> Tuple[str, ...]:
    """Every spelling the file holds for a row, acronyms included (what must not be written on a
    chart when the name is withheld)."""
    return next((r["aliases"] for r in _file() if r["id"] == entry_id), ())


def now_in_library() -> Dict[str, str]:
    """{catalogue id: library entry id} for the rows the library has since gained."""
    from api.services import named_indicators
    by_spelling = {norm(alias): entry_id for alias, entry_id in named_indicators.phrases()}
    return {r["id"]: by_spelling[a] for r in _file() for a in r["aliases"] if a in by_spelling}


def ids() -> frozenset:
    """Every id the file has ever held (a record written before the library gained a name stays valid)."""
    return frozenset(r["id"] for r in _file())


def name_of(entry_id: Any) -> Optional[str]:
    return next((r["name"] for r in _file() if r["id"] == entry_id), None)


@functools.lru_cache(maxsize=1)
def _spellings() -> Tuple[Tuple[str, str], ...]:
    """(spelling, id), the longest spelling first, so "aroon oscillator" is read before "aroon"."""
    pairs = [(a, r["id"]) for r in catalogue() for a in r["aliases"]]
    return tuple(sorted(pairs, key=lambda p: (-len(p[0]), p[0])))


def lookup(phrase: Any) -> Optional[str]:
    """The id of a phrase that IS a catalogue name (the whole phrase, in any spelling), or None."""
    want = norm(phrase)
    return next((eid for spelling, eid in _spellings() if spelling == want), None)


def names_in(text: Any) -> List[str]:
    """The catalogue ids a request names, as whole words, each once, in the order found (longest
    spelling first), at most ``MAX_PER_TURN``. IDS ONLY."""
    padded = f" {norm(str(text or '')[:_READ_CHARS])} "
    found: List[str] = []
    for spelling, eid in _spellings():
        if eid not in found and f" {spelling} " in padded:
            found.append(eid)
            if len(found) == MAX_PER_TURN:
                break
    return found
