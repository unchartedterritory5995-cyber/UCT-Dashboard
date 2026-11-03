"""Asset-class words (W1-C C-03, builder-c) — what a member means by "gold", "oil", "s&p", "btc".

This is an ASSET-CLASS vocabulary, not instrument logic. MD-1 §4.7 keeps every instrument class (symbol,
symbol_typed_lowercase, name_match, non_equity, unknown) computed from UCT's symbol index and the typed form; this
module never changes a class. It only says which CLASS OF INSTRUMENT a plain word belongs to, so a question about it
is routed to that class's dedicated kind — `index.quote`, `commodity.quote`, `crypto.quote` — and never answered
with a ticker guess (an ETF that happens to hold the ticker, a company that happens to spell the word).

The route is attached by `instrument.resolve` as a parallel, additive `data.routes[i]` for the words typed WITHOUT
explicit capitals (a lowercase word, a lowercase cashtag), plus an exact index symbol typed any way (`SPX` is an index
whichever way it is typed). An explicit UPPERCASE / `$BTC` stock-or-ETF ticker is the member's choice (owner ruling
2026-11-02, MD-1 §4.7.3) and carries no route.

Each entry: word -> (kind, asset id, label). Words are matched lowercase, exactly, after a leading `$` is dropped.
"""
from __future__ import annotations

from typing import Optional

INDEX_KIND = "index.quote"
COMMODITY_KIND = "commodity.quote"
CRYPTO_KIND = "crypto.quote"
KINDS = (INDEX_KIND, COMMODITY_KIND, CRYPTO_KIND)

#: member-facing word for each class, used in the honest decline ("I don't have a licensed source for …")
CLASS_WORDS = {INDEX_KIND: "index levels", COMMODITY_KIND: "commodity prices", CRYPTO_KIND: "cryptocurrency prices"}

_ASSETS: dict[str, tuple[str, str, str]] = {
    # indexes
    "spx": (INDEX_KIND, "spx", "S&P 500"), "s&p": (INDEX_KIND, "spx", "S&P 500"), "s&p500": (INDEX_KIND, "spx", "S&P 500"),
    "sp500": (INDEX_KIND, "spx", "S&P 500"), "spx500": (INDEX_KIND, "spx", "S&P 500"),
    "nasdaq": (INDEX_KIND, "ixic", "Nasdaq Composite"), "ixic": (INDEX_KIND, "ixic", "Nasdaq Composite"),
    "ndx": (INDEX_KIND, "ndx", "Nasdaq-100"), "nasdaq100": (INDEX_KIND, "ndx", "Nasdaq-100"),
    "dow": (INDEX_KIND, "dji", "Dow Jones Industrial Average"), "djia": (INDEX_KIND, "dji", "Dow Jones Industrial Average"),
    "dji": (INDEX_KIND, "dji", "Dow Jones Industrial Average"), "dowjones": (INDEX_KIND, "dji", "Dow Jones Industrial Average"),
    "russell": (INDEX_KIND, "rut", "Russell 2000"), "rut": (INDEX_KIND, "rut", "Russell 2000"),
    "vix": (INDEX_KIND, "vix", "Cboe Volatility Index"),
    # commodities
    "gold": (COMMODITY_KIND, "gold", "gold"), "silver": (COMMODITY_KIND, "silver", "silver"),
    "copper": (COMMODITY_KIND, "copper", "copper"),
    "oil": (COMMODITY_KIND, "crude", "crude oil"), "crude": (COMMODITY_KIND, "crude", "crude oil"),
    "wti": (COMMODITY_KIND, "crude", "WTI crude oil"), "brent": (COMMODITY_KIND, "brent", "Brent crude oil"),
    "natgas": (COMMODITY_KIND, "natgas", "natural gas"),
    # cryptocurrencies
    "btc": (CRYPTO_KIND, "btc", "Bitcoin"), "bitcoin": (CRYPTO_KIND, "btc", "Bitcoin"),
    "eth": (CRYPTO_KIND, "eth", "Ether"), "ethereum": (CRYPTO_KIND, "eth", "Ether"), "ether": (CRYPTO_KIND, "eth", "Ether"),
    "sol": (CRYPTO_KIND, "sol", "Solana"), "solana": (CRYPTO_KIND, "sol", "Solana"),
}


def lookup(word: str) -> Optional[dict]:
    """{kind, asset, label} for an asset-class word (case-insensitive, a leading `$` dropped), else None."""
    w = str(word or "").strip().lstrip("$").lower()
    hit = _ASSETS.get(w)
    return {"kind": hit[0], "asset": hit[1], "label": hit[2]} if hit else None


def assets_of(kind: str) -> dict:
    """asset id -> label for one kind (the ids its adapter accepts)."""
    return {a: lbl for k, a, lbl in _ASSETS.values() if k == kind}


def words() -> frozenset:
    return frozenset(_ASSETS)
