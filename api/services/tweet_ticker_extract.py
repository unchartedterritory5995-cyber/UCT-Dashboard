"""Cashtag-based ticker extraction for the tweet ingest.

TERM-064 follow-up 1: this DELEGATES to the one ticker resolver
(`api/services/ticker_resolver.py`, context `CASHTAG_POST`): cashtags only, A8's
forex exclusions (TERM-075 stays the authority over that vocabulary), and the
resolver's canonical spelling. Before this the ingest ran M5's own grammar, which
booked `$BRK.B` as `BRK`, a symbol that does not exist, so a class-share tweet
joined to nothing. Source accounts are professional, so there is no universe
check: a cashtag is the author's explicit claim.
"""
from api.services import ticker_resolver


def extract_tickers(text: str) -> set[str]:
    return set(ticker_resolver.resolve_tickers(text, ticker_resolver.CASHTAG_POST))
