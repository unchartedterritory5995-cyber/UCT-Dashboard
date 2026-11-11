"""MD-1 kind `crypto.quote` (W1-C C-03, builder-c): a cryptocurrency's own price (Bitcoin, Ether, Solana).

The product's only crypto quote is Yahoo's BTC-USD (`massive._yfinance_snapshot`, register T-72: class `X`, no
licence exists). Massive's crypto product has no register row (`U`). Every read is therefore the honest decline — a
fund's share price (BTC, ETHA…) is NEVER presented as the coin's price (MD-1 §4.7.3 fund rule). A licensed feed is
one fetch + one A/LA row away.
"""
from __future__ import annotations

from api.services.uct_agent.marketdata import asset_classes, asset_quotes

KIND = asset_classes.CRYPTO_KIND

validate = asset_quotes.validate_for(KIND)


def _no_feed(asset: str) -> dict:  # noqa: ARG001 — never reached while every row is out of force
    raise RuntimeError("no crypto feed is wired")


SOURCES = [("massive", "crypto", _no_feed), ("yahoo", "crypto", _no_feed)]


def read_crypto_quote(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    return asset_quotes.read_asset(KIND, params, SOURCES)
