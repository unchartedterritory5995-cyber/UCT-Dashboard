"""Symbol universe, company aliases, and the DERIVED collision set.

Three facts drive this module, all measured (see the spec):
  1. `cap_universe.json` is a $300M+ EQUITY SCREEN, not a symbol list -- 84 of
     the 100 live ETFs are absent from it. Ask both sources.
  2. The universe genuinely contains RS / EMA / MA / GAP / PEG and every single
     letter, so a universe hit CANNOT carry a ticker match by itself.
  3. The mirror-image bug is just as bad: the old #tsdr extractor excluded AI,
     OPEN, PLAY, BIG, REAL, CASH and ALL -- all real, actively traded names.

So collisions are DERIVED (universe INTERSECT chat/house vocabulary), never
typed, and the result is asserted to be a subset of the universe -- a collision
list naming things that are not symbols is not measuring collisions.
"""
from __future__ import annotations

import functools
import json
import os
import pathlib

_HERE = pathlib.Path(__file__).resolve().parents[1]      # api/
_DATA = _HERE / "data"

# Chart / setup / desk vocabulary that is ALSO a listed symbol.
# The second row was DERIVED on 2026-09-01 by intersecting a chart-vocabulary
# candidate list against the real universe -- not typed from memory. Without
# LINE, "RS line reclaiming the EMA" books a mention of LINE (a genuine ticker).
#
# ⛔ SPOT was in that derived intersection and is DELIBERATELY NOT HERE.
# Spotify is a name this room actually trades; "spot" as a word is comparatively
# rare in equity chat. Banishing a symbol members discuss deletes real mentions
# permanently, which is the exact failure mode this whole module exists to
# avoid. When a genuine name collides, tighten tier 4's context requirement --
# never remove the symbol.
HOUSE_VOCAB = frozenset({
    "RS", "EMA", "SMA", "MA", "GAP", "PEG", "EP", "ATH", "ATL", "IPO", "ETF",
    "RSI", "MACD", "VWAP", "HOD", "LOD", "PT", "TP", "SL", "IV", "OI", "DD",
    "LINE", "BAND", "BULL", "GAIN", "PUMP",
})

# Indices. cap_universe.json is an EQUITY SCREEN, so none of these are in it --
# and the owner named SPX explicitly in the brief. They are countable (people
# discuss them constantly) even though they are not tradeable; the earlier
# "indices no" ruling was about CHART CHIPS, where tapping an index opened a
# dead end. Counting a mention has no such dead end.
INDEX_SYMBOLS = frozenset({"SPX", "NDX", "DJI", "RUT", "VIX", "DXY", "IXIC"})

# Alias keys that are ALSO ordinary English words. An alias hit on one of these
# demands the proper-noun form in the raw text, because "an apple a day" and
# "the oracle of omaha" are things this room says constantly. Each entry is
# justified by a false-positive fixture in tests/test_buzz_extract.py -- add one
# only WITH its sentence, never on a hunch.
AMBIGUOUS_ALIASES = frozenset({
    "apple", "arm", "meta", "oracle", "affirm", "alphabet", "novo", "lilly", "nike",
})

# Ordinary conversational English. Kept short on purpose: every entry must be a
# word this room actually uses non-financially. `tools/buzz_collisions.py`
# (Task 5) re-derives this from the real corpus and reports anything missing.
# Entries that are NOT in the universe are harmless -- ambiguous() intersects,
# so they simply drop out. They are kept as a guard in case the universe grows.
CHAT_WORDS = frozenset({
    "A", "ALL", "AM", "AN", "AND", "ANY", "ARE", "AS", "AT", "BE", "BIG", "BUT",
    "BY", "CAN", "CASH", "DO", "EACH", "EV", "FOR", "FROM", "GO", "GOOD", "HAS",
    "HE", "HOME", "HOPE", "HOW", "IF", "IN", "IS", "IT", "JUST", "KEY", "LOVE",
    "LOW", "MY", "NEW", "NEXT", "NICE", "NO", "NOW", "OF", "OK", "OLD", "ON",
    "ONE", "OPEN", "OR", "OUT", "OVER", "PLAY", "PLUS", "REAL", "RUN", "SAFE",
    "SEE", "SO", "SOME", "STAY", "TAKE", "TELL", "THE", "TO", "TURN", "UP",
    "US", "VERY", "WE", "WELL", "WHY", "WISH", "WORK", "YOU", "AI",
    "NET", "ARM", "META", "LAB",
})


def _load_json(name: str):
    for base in (_DATA, _HERE.parent / "data", pathlib.Path(os.environ.get("UCT_DATA_DIR", ""))):
        if not base or not str(base):
            continue
        p = pathlib.Path(base) / name
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001 - a bad file must not take the module down
                return None
    return None


def _syms_from(payload) -> set[str]:
    """Accept the two shapes these files ship in: a list of strings, or a list
    of dicts keyed by sym/ticker/symbol."""
    out: set[str] = set()
    if isinstance(payload, dict):
        payload = payload.get("symbols") or payload.get("tickers") or []
    for item in payload or []:
        if isinstance(item, str):
            out.add(item.strip().upper())
        elif isinstance(item, dict):
            v = item.get("sym") or item.get("ticker") or item.get("symbol")
            if v:
                out.add(str(v).strip().upper())
    return {s for s in out if s and len(s) <= 6}


@functools.lru_cache(maxsize=1)
def symbols() -> frozenset[str]:
    s = _syms_from(_load_json("cap_universe.json"))      # 3,742 equities, $300M+
    s |= _syms_from(_load_json("prebuilt_etfs.json"))    # 100 liquid ETFs
    s |= set(INDEX_SYMBOLS)                              # not in either source
    s |= set(aliases().values())                         # a name we alias is a name we know
    return frozenset(s)


@functools.lru_cache(maxsize=1)
def aliases() -> dict[str, str]:
    payload = _load_json("buzz_aliases.json") or {}
    return {str(k).lower(): str(v).upper() for k, v in payload.items()}


@functools.lru_cache(maxsize=1)
def ambiguous() -> frozenset[str]:
    """Symbols that also read as ordinary chat. DERIVED by intersection, so it
    can only ever name things that are genuinely in the universe."""
    return frozenset((CHAT_WORDS | HOUSE_VOCAB) & set(symbols()))


def _reset_caches_for_tests() -> None:
    """Drop the lru_caches so a test can change what the loaders see."""
    symbols.cache_clear()
    aliases.cache_clear()
    ambiguous.cache_clear()
