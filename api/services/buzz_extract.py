"""Extract tickers from open Discord chat, by confidence tier.

Measured 2026-09-01: the #tsdr extractor this replaces found NOTHING in six
consecutive real #main-chat messages, because (a) it required ALL CAPS and
(b) its caps branch was gated behind a "trading keyword" check that ordinary
conversation never satisfies. This room writes `Dell`, `Spy`, `Amazon`.

Tiers, strongest first:
  cashtag     $DELL                      -- certain, beats every gate
  alias       "Amazon", "Rocket Lab"     -- curated company names
  exact       DELL (exact case)          -- real symbol, not chat/house vocab
  contextual  Dell / dell                -- case-insensitive, unambiguous only

An ambiguous token (ALL, OPEN, PLAY, AI, RS, EMA ...) is ONLY ever a ticker
with a cashtag. That is deliberate: those are real symbols, so we cannot drop
them from the universe, and they are real words, so we cannot free-match them.
"""
from __future__ import annotations

import re

from api.services import buzz_universe as uni

_RANK = {"cashtag": 0, "alias": 1, "exact": 2, "contextual": 3}

_URL = re.compile(r"https?://\S+|www\.\S+")
_CASHTAG = re.compile(r"\$([A-Za-z]{1,6}(?:\.[A-Za-z]{1,2})?)\b")
_WORD = re.compile(r"\b[A-Za-z][A-Za-z.]{0,5}\b")


def _strongest(found: dict[str, str], ticker: str, tier: str) -> None:
    cur = found.get(ticker)
    if cur is None or _RANK[tier] < _RANK[cur]:
        found[ticker] = tier


def extract(text: str | None) -> list[tuple[str, str]]:
    if not text:
        return []

    # URLs carry path segments that look exactly like tickers.
    text = _URL.sub(" ", text)

    symbols = uni.symbols()
    aliases = uni.aliases()
    ambiguous = uni.ambiguous()
    found: dict[str, str] = {}

    # Tier 1 -- cashtag. Beats every gate, including ambiguity.
    for m in _CASHTAG.finditer(text):
        sym = m.group(1).upper()
        if sym in symbols:
            _strongest(found, sym, "cashtag")

    # Tier 2 -- company aliases. Longest first so "rocket lab" wins over "lab".
    low = text.lower()
    for name in sorted(aliases, key=len, reverse=True):
        if name in uni.AMBIGUOUS_ALIASES:
            # An ordinary English word: demand the proper-noun form in the RAW
            # text. "Arm reports Tuesday" counts; "sprain your arm" does not.
            hit = re.search(r"\b(?:%s|%s)\b"
                            % (re.escape(name.capitalize()), re.escape(name.upper())), text)
        else:
            hit = re.search(r"\b" + re.escape(name) + r"\b", low)
        if hit:
            _strongest(found, aliases[name], "alias")

    # Tiers 3 and 4 -- bare words.
    for m in _WORD.finditer(text):
        raw = m.group(0).strip(".")
        if len(raw) < 2:
            continue
        sym = raw.upper()
        if sym not in symbols or sym in ambiguous:
            continue
        _strongest(found, sym, "exact" if raw == sym else "contextual")

    return sorted(found.items())
