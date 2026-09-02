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
# This is the ONE hand-curated collision list, and it stays narrow on purpose:
# uppercase-by-convention ACRONYMS (AI, RS, EMA, SMA, MA, DD, OI, RSI, PEG ...)
# that casing analysis structurally cannot separate -- this room writes them
# uppercase whether it means the acronym or the ticker, so no corpus measurement
# will ever push their upper_pct below the word threshold. Every ordinary
# ENGLISH WORD collision (SPOT, IMO, BIT, LOT, WAY, POST, TWO, JAN, ...) belongs
# in `chat_words()` / `api/data/buzz_collisions.json` instead, DERIVED from a
# real corpus by `tools/buzz_derive_collisions.py`. Two different collision
# mechanisms, two lists -- do not merge one into the other.
#
# ⛔ SPOT is DELIBERATELY NOT HERE. Spotify is a name this room actually trades,
# and it was never wrong to refuse a hand-typed "SPOT is just a word" guess --
# only real data could settle it. It has: the derived corpus measured SPOT at
# 11.2% uppercase (308 word-uses vs 39 ticker-uses), well under the 35% word
# threshold, so it IS now gated -- via `chat_words()`, not by adding it here.
HOUSE_VOCAB = frozenset({
    "AI", "RS", "EMA", "SMA", "MA", "GAP", "PEG", "EP", "ATH", "ATL", "IPO",
    "ETF", "RSI", "MACD", "VWAP", "HOD", "LOD", "PT", "TP", "SL", "IV", "OI",
    "DD", "LINE", "BAND", "BULL", "GAIN", "PUMP",
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
    "apple", "arm", "meta", "oracle", "affirm", "alphabet", "nike",
})

# Ordinary conversational English that also reads as a ticker. DERIVED, never
# hand-typed -- see the module docstring and tools/buzz_derive_collisions.py.
# `chat_words()` below is the loader; `api/data/buzz_collisions.json` is the
# one file that regenerates from a real corpus and is the sole authority.


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
def chat_words() -> frozenset[str]:
    """Ordinary English words that collide with a real ticker, DERIVED by
    casing analysis over a genuine Discord corpus (see the module docstring +
    `tools/buzz_derive_collisions.py`). Never hand-typed: this is a straight
    load of `api/data/buzz_collisions.json`'s `tokens` keys. A missing or
    malformed file degrades to an empty set rather than raising -- the same
    fail-soft contract every loader in this module follows."""
    payload = _load_json("buzz_collisions.json") or {}
    tokens = payload.get("tokens") if isinstance(payload, dict) else None
    return frozenset(str(k).strip().upper() for k in (tokens or {}))


@functools.lru_cache(maxsize=1)
def ambiguous() -> frozenset[str]:
    """Symbols that also read as ordinary chat. DERIVED by intersection, so it
    can only ever name things that are genuinely in the universe."""
    return frozenset((chat_words() | HOUSE_VOCAB) & set(symbols()))


def _reset_caches_for_tests() -> None:
    """Drop the lru_caches so a test can change what the loaders see."""
    symbols.cache_clear()
    aliases.cache_clear()
    chat_words.cache_clear()
    ambiguous.cache_clear()
