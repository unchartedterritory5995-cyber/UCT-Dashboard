"""MD-1 market-data kinds (owner: agent-md).

Each kind is an adapter over an existing canonical UCT service (see contracts/MD-1-market-data.md §4)
and is added with `registry.register(Kind(...))` inside `register` below. The gateway loads this module
once on first use; nobody edits gateway.py to add a kind. Every kind's pure parameter check is its
`validate=`, which the gateway runs BEFORE admission, so a malformed request spends no budget.

Sprint 1, PR 1: `quote`, `quotes` (services/massive.py snapshot, read-only — see quotes.py).
Sprint 1, PR 2: `bars.daily` (the canonical bars store via bars_fetch, read-only — see bars_daily.py).
Sprint 1, PR 3: `fundamentals` (financial_statements), `earnings` (earnings_table), `news.company` (news store).
Sprint 1, PR 4a: `themes` (theme_performance overlay, read without building).
"""
from __future__ import annotations

from api.services.uct_agent.marketdata import bars_daily, earnings, news_company, quotes, statements, themes


def register(registry) -> None:
    from api.services.uct_agent.marketdata.gateway import Kind
    registry.register(Kind(
        name="quote", fn=quotes.read_quote, validate=quotes.validate_quote, freshness="live", owner="agent-md",
        max_symbols=1,
        description="One ticker's latest price from the Massive snapshot. Live in the regular session "
                    f"(stale after {quotes.FRESHNESS_BUDGET_S}s) and in extended hours when the vendor stamp is "
                    f"at most {quotes.EXTENDED_LIVE_S // 60} min old; historical with a note otherwise "
                    "(MD-1 v1.1 §4.1). Params: {symbol}.",
    ))
    registry.register(Kind(
        name="quotes", fn=quotes.read_quotes, validate=quotes.validate_quotes, freshness="live", owner="agent-md",
        description="Latest prices for up to 50 tickers from one Massive batch snapshot; as_of is the "
                    "oldest quote in the set. Params: {symbols: [...]}.",
    ))
    registry.register(Kind(
        name="bars.daily", fn=bars_daily.read_bars_daily, validate=bars_daily.validate, freshness="historical",
        owner="agent-md",
        max_symbols=1,
        description="Completed daily sessions for one ticker from UCT's bars store (never today's "
                    "developing bar); as_of is the newest bar's session close. Point-in-time with `to`. "
                    f"Params: {{symbol, bars (1-{bars_daily.MAX_BARS}, default {bars_daily.DEFAULT_BARS}), to?}}.",
    ))
    registry.register(Kind(
        name="fundamentals", fn=statements.read_fundamentals, validate=statements.validate, freshness="periodic",
        owner="agent-md", max_symbols=1,
        description="Periodic financial disclosures (income, balance, cash flow) from Yahoo Finance via "
                    "financial_statements; as_of is the newest period end, stale after "
                    f"{statements.STALE_AFTER_DAYS} days. Params: {{symbol, period: quarterly|annual, periods}}.",
    ))
    registry.register(Kind(
        name="earnings", fn=earnings.read_earnings, validate=earnings.validate, freshness="periodic",
        owner="agent-md", max_symbols=1,
        description="Reported quarters (actual vs estimate) and the next scheduled report, from earnings_table. "
                    "Reported rows carry no date, so as_of is null; stale when "
                    f"{earnings.STALE_QUARTERS}+ quarters behind. Params: {{symbol}}.",
    ))
    registry.register(Kind(
        name="news.company", fn=news_company.read_news_company, validate=news_company.validate,
        freshness="periodic", owner="agent-md", max_symbols=1,
        description="Published company news from UCT's news store (no provider call, no body text); as_of is the "
                    "newest item; stale when news ingest has not succeeded for an hour. "
                    f"Params: {{symbol, limit (1-{news_company.MAX_LIMIT})}}.",
    ))
    registry.register(Kind(
        name="themes", fn=themes.read_themes, validate=themes.validate, freshness="periodic", owner="agent-md",
        max_symbols=0,
        description="Equal-weight returns of UCT's curated themes (the Theme Tracker payload), read without "
                    "building it — 'theme data is warming' when no complete overlay exists. "
                    f"Params: {{period: {'|'.join(themes.PERIODS)}, order: leaders|laggards, limit (1-{themes.MAX_LIMIT})}}.",
    ))
