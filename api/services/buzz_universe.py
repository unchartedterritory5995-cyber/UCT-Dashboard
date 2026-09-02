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
# ⛔ SPOT is DELIBERATELY NOT HERE, and its history is the whole argument for
# reading sentences rather than ratios. It was ungated by hand-typed guess,
# then GATED when a corpus measured it lowercase-dominant, and is now gated for
# its LOWERCASE form only -- because reading all 11 uppercase occurrences in
# #main-chat showed every single one is Spotify. Three positions, and only the
# last one was reached by looking at what the room actually wrote. See
# TICKER_DESPITE_LOWERCASE below.
HOUSE_VOCAB = frozenset({
    "AI", "RS", "SMA", "MA", "PEG", "EP", "ATH", "ATL", "IPO",
    "ETF", "RSI", "MACD", "VWAP", "HOD", "LOD", "PT", "TP", "SL", "IV", "OI",
    "DD",
    # ⛔ EMA and IMO came BACK on 2026-09-02, and the round trip is the lesson.
    # They were removed on 2026-09-01 because the derived list happened to
    # cover them; then the gating threshold dropped from 35% to 10% (owner
    # ruling: capture real mentions, tolerate false ones) and both rose above
    # the line -- EMA is written uppercase 68 times in 30 days of #main-chat,
    # IMO 50. That is precisely this list's definition: uppercase-by-convention
    # tokens no casing threshold can ever separate. Coverage by the derived
    # list was a COINCIDENCE OF THE THRESHOLD, not evidence they belonged
    # there, and the moment the threshold moved for an unrelated reason the
    # coincidence evaporated and "EMA reclaim" started booking a ticker.
    "EMA", "IMO",
    # ⛔ DTE = "days to expiry", and this room writes "0 DTE" constantly. It
    # sits at 25.5% uppercase so no threshold catches it, and it was booking a
    # DTE Energy mention on every options comment. Found by auditing live chat
    # 2026-09-02: "1000 0 dte s ?", "Ur 0 dte game is legendary".
    "DTE",
})

# Indices. cap_universe.json is an EQUITY SCREEN, so none of these are in it --
# and the owner named SPX explicitly in the brief. They are countable (people
# discuss them constantly) even though they are not tradeable; the earlier
# "indices no" ruling was about CHART CHIPS, where tapping an index opened a
# dead end. Counting a mention has no such dead end.
INDEX_SYMBOLS = frozenset({"SPX", "NDX", "DJI", "RUT", "VIX", "DXY", "IXIC"})

# ⛔ THE MIRROR OF HOUSE_VOCAB: "casing says word, we know better".
#
# These are tokens the derived collision list flags -- their lowercase form
# really is ordinary English -- but whose UPPERCASE form, read in context, is
# this room talking about the stock. No threshold reaches them: BE is 6.8%
# uppercase, NOW 6.5%, SPOT 5.2%, all under the 10% bar, and raising the bar to
# catch them would ungate dozens of genuine words with it.
#
# ⛔ EVERY ENTRY NEEDS QUOTED EVIDENCE, same bar as HOUSE_VOCAB, and it must be
# the UPPERCASE occurrences that were read -- not an intuition about the word.
# Verified over 30 days of #main-chat, 2026-09-02:
#   BE    111 uppercase; 6 are "stopped/sold at BE" (break even). The rest:
#         "DELL HPE ALAB BE nice", "$BE kind of oops", "Id rather buy BE".
#   NOW   61 uppercase; 2 are the word. "PLTR MDB NOW good", "day 2 on NOW",
#         "Sold my NOW puts into close", "How's our NOW doing folks".
#   SPOT  11 uppercase; ZERO are the word. "SPOT excellent candle",
#         "I bought SPOT last week", "SPOT/SE/U/WDAY" watchlists.
#
# ⛔ It gates the EXACT (uppercase) tier ONLY. Lowercase "be", "now" and "spot"
# stay gated -- they are overwhelmingly the English word, and that is what the
# derivation measured.
TICKER_DESPITE_LOWERCASE = frozenset({"BE", "NOW", "SPOT"})

# Alias keys that are ALSO ordinary English words. An alias hit on one of these
# demands the proper-noun form in the raw text, because "an apple a day" and
# "the oracle of omaha" are things this room says constantly. Each entry is
# justified by a false-positive fixture in tests/test_buzz_extract.py -- add one
# only WITH its sentence, never on a hunch.
# ⚠️ "meta" LEFT this set on 2026-09-02, on evidence. The proper-noun rule
# demanded "Meta"/"META" in the raw text, so every lowercase mention was
# dropped -- and reading all 42 lowercase occurrences in 30 days of #main-chat,
# ~38 are the stock: "600 is wall for meta", "meta 50d", "595-598 am all out of
# meta", "Scaling meta more here 95%", "meta >pdh", "Who caught that fade on
# meta". Four are slang ("the AI CS meta", "its meta"). Trading ~4 false
# bookings a month for ~38 real ones is the owner's stated preference, and this
# room plainly writes the ticker in lowercase.
AMBIGUOUS_ALIASES = frozenset({
    "apple", "arm", "oracle", "affirm", "alphabet", "nike",
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


# ⚰️ LOWERCASE_TICKERS lived here for one hour on 2026-09-02. It carved SGOV
# out of the derived list because a 35% threshold flagged it (12 uppercase
# vs 28 lowercase) even though the lowercase hits were people typing the
# ETF casually -- "Watching sgov 5 minute". Lowering the threshold to 10%
# for the owner's recall ruling made SGOV fall out on its own, along with
# ETSY, COST, UPS, BROS, BILL and DTE, which the same 35% bar had also been
# eating. An override that duplicates what the threshold already does is a
# second authority over one token, so it was removed rather than left as a
# no-op. The RAIL it came with stays: it now asserts the OUTCOME (a
# lowercase-typed ticker is still countable), not the mechanism.


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
