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

# Chart / setup / desk ACRONYMS that are ALSO a listed symbol -- e.g. without
# RS in this set, "RS reclaiming the 50" books a mention of RS (a genuine
# ticker). This is the ONE hand-curated collision list, and it is PROVABLY
# narrow: every entry is an uppercase-by-convention ACRONYM/ABBREVIATION that
# casing analysis structurally cannot separate -- this room writes them
# uppercase whether it means the acronym or the ticker, so no corpus
# measurement will ever push their upper_pct below the word threshold.
# `test_house_vocab_holds_only_what_casing_cannot_derive` pins ZERO overlap
# with `chat_words()` (the derived file) -- an entry the corpus already
# covers is not evidence this list needs it, it is precedent for the next
# person to hand-type an ordinary word here "because the file already does
# that." (EMA, GAP, LINE, BULL and GAIN were removed for exactly this reason
# on 2026-09-01: the derived corpus independently covers all five with its
# own evidence.) Every ordinary ENGLISH WORD collision (SPOT, IMO, BIT, LOT,
# WAY, POST, TWO, JAN, ...) belongs in `chat_words()` /
# `api/data/buzz_collisions.json` instead, DERIVED from a real corpus by
# `tools/buzz_derive_collisions.py`. A word whose LOWERCASE form is ordinary
# English but that this corpus does not (yet) measure as a collision belongs
# in `WORD_FORMS` below, with a fixture -- not here either (`BAND` moved there
# the same day, for the same reason `arm`/`meta`/`net`/`lab` live there;
# `PUMP` moved there too and then GRADUATED to the derived list on 2026-09-02
# once a real #main-chat corpus measured it). Three different collision
# mechanisms, three lists -- do not merge any two of them.
#
# ⛔ SPOT is DELIBERATELY NOT HERE. Spotify is a name this room actually trades,
# and it was never wrong to refuse a hand-typed "SPOT is just a word" guess --
# only real data could settle it. It has: the derived corpus measured SPOT at
# 11.2% uppercase (308 word-uses vs 39 ticker-uses), well under the 35% word
# threshold, so it IS now gated -- via `chat_words()`, not by adding it here.
HOUSE_VOCAB = frozenset({
    "AI", "RS", "SMA", "MA", "PEG", "EP", "ATH", "ATL", "IPO",
    "ETF", "RSI", "MACD", "VWAP", "HOD", "LOD", "PT", "TP", "SL", "IV", "OI",
    "DD",
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

# Tokens whose LOWERCASE form is ordinary English, whatever a corpus measures.
# ⛔ This is a THIRD category, distinct from both the derived list and
# HOUSE_VOCAB, and it exists because of a measured blind spot: the derivation
# corpus (#tsdr) is a DISCIPLINED feed where "arm"/"meta" are ticker-dominant,
# while in casual chat they are a body part and an adjective. A casing rule
# cannot see that from #tsdr alone. Every entry needs a fixture sentence.
# "pump" was here until 2026-09-02, when re-deriving against real #main-chat
# MEASURED it (62 lowercase vs 1 uppercase) and chat_words() started
# covering it. Keeping both would put two authorities on one token, and the
# derived one is stronger -- it also gates the uppercase form this room
# never uses. Same graduation LINE/BULL/GAIN made out of HOUSE_VOCAB.
WORD_FORMS = AMBIGUOUS_ALIASES | frozenset({"net", "lab", "band"})

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


# ⛔ The one place the casing rule is KNOWN to be wrong, with the evidence.
#
# The derivation assumes a token written mostly lowercase is an ordinary word.
# That holds overwhelmingly -- re-derived against 32,890 real #main-chat
# messages, 53 new collisions were found and hand-inspected, and 52 of them are
# genuine: "ngl" (not gonna lie), "ty", "bc" (because), "0 dte", "nat gas",
# "wall st", an electric "bill", "hardest to short stock ever". Even "qs" is
# not QuantumScape -- it is the room's slang for QQQ ("729.36 on the qs"), so
# gating it is right for a reason the rule never knew.
#
# SGOV is the exception: it is not an English word, and the lowercase hits are
# people typing the ETF casually -- "Watching sgov 5 minute", "i should
# probably buy back the sgov I sold". Gating it would DROP REAL MENTIONS, which
# is the other half of the owner's brief ("things don't fall through the
# cracks"), not just noise.
#
# This stays OUT of the derived JSON so that file remains a pure, reproducible
# measurement -- the exception is applied here, at load, where it can carry its
# evidence. Add to it only with quoted corpus lines, the same bar HOUSE_VOCAB
# and WORD_FORMS hold.
LOWERCASE_TICKERS = frozenset({"SGOV"})


@functools.lru_cache(maxsize=1)
def chat_words() -> frozenset[str]:
    """Ordinary English words that collide with a real ticker, DERIVED by
    casing analysis over a genuine Discord corpus (see the module docstring +
    `tools/buzz_derive_collisions.py`). Never hand-typed: this is a straight
    load of `api/data/buzz_collisions.json`'s `tokens` keys, minus the measured
    exceptions in LOWERCASE_TICKERS. A missing or malformed file degrades to an
    empty set rather than raising -- the same fail-soft contract every loader
    in this module follows."""
    payload = _load_json("buzz_collisions.json") or {}
    tokens = payload.get("tokens") if isinstance(payload, dict) else None
    derived = frozenset(str(k).strip().upper() for k in (tokens or {}))
    return derived - LOWERCASE_TICKERS


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
