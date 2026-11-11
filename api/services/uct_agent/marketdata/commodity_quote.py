"""MD-1 kind `commodity.quote` (W1-C C-03, builder-c): a commodity price (gold, silver, copper, crude, natural gas).

No licensed source exists in the stack (licensing register T-59: AlphaVantage commodities carry the FRED flow-down,
`R`; T-71/T-72: Yahoo is `X`). The candidate rows below are the ones the register knows; both are out of force, so
every read is the honest decline and no fetch runs. A futures or spot feed with an A/LA row would be served by
adding its fetch here and its row to provider_licensing_class.py — nothing else changes.
"""
from __future__ import annotations

from api.services.uct_agent.marketdata import asset_classes, asset_quotes

KIND = asset_classes.COMMODITY_KIND

validate = asset_quotes.validate_for(KIND)


def _no_feed(asset: str) -> dict:  # noqa: ARG001 — never reached while every row is out of force
    raise RuntimeError("no commodity feed is wired")


SOURCES = [("alphavantage", "commodities", _no_feed), ("yahoo", "commodities", _no_feed)]


def read_commodity_quote(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    return asset_quotes.read_asset(KIND, params, SOURCES)
