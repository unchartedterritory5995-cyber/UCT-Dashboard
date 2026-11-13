"""MD-1 market-data kinds (owner: agent-md).

Each kind is an adapter over an existing canonical UCT service (see contracts/MD-1-market-data.md §4)
and is added with `registry.register(Kind(...))` inside `register` below. The gateway loads this module
once on first use; nobody edits gateway.py to add a kind. Every kind's pure parameter check is its
`validate=`, which the gateway runs BEFORE admission, so a malformed request spends no budget.

Sprint 1, PR 1: `quote`, `quotes` (services/massive.py snapshot, read-only — see quotes.py).
Sprint 1, PR 2: `bars.daily` (the canonical bars store via bars_fetch, read-only — see bars_daily.py).
Sprint 1, PR 3: `fundamentals` (financial_statements), `earnings` (earnings_table), `news.company` (news store).
Sprint 1, PR 4a: `themes` (theme_performance overlay, read without building).
Sprint 1, PR 4b: `breadth.current` (breadth_current.reading) and `ratings` (research/ratings) — both
MODEL-ISOLATED: the gateway serves them for purpose "answer" only.
Sprint 2: `instrument.resolve` (the canonical symbol index, ticker_search_index — see instruments.py, MD-1 §4.7).
Wave 2 (W2-B1, agent-rs): `research.company` (RS-1 v1 — composed from the served kinds above plus the turn's one
web search; api/services/uct_agent/research/rs1.py).
Wave 2 (W2-B2, builder-b): `history.eventStudy` (Market Intelligence's existing event_study over technical series;
history_event_study.py) and `bars.daily` gains `from`.
"""
from __future__ import annotations

from api.services.uct_agent.marketdata import (asset_classes, bars_daily, breadth, commodity_quote, crypto_quote, earnings,
                                              index_quote, instruments, news_company, quotes, ratings, statements, themes)
from api.services.uct_agent.marketdata import history_event_study
from api.services.uct_agent.research import rs1

# Symbols one read may name. A request-shape bound per kind, not a toolkit cap: the cap numbers live only
# in entitlements.TOOLKITS (tests/test_entitlements.py, "the NUMBERS live in exactly ONE place").
ONE_SYMBOL = 1
NO_SYMBOL = 0


def register(registry) -> None:
    from api.services.uct_agent.marketdata.gateway import Kind
    registry.register(Kind(
        name="instrument.resolve", fn=instruments.read_instruments, validate=instruments.validate,
        freshness="periodic", owner="agent-md", max_symbols=instruments.MAX_TOKENS,
        description="Which security a member's word names, from UCT's canonical symbol index (no provider call): "
                    "symbol | symbol_typed_lowercase | name_match | non_equity | unknown per word (MD-1 §4.7). "
                    "Params: {symbols: [{text, form: cashtag|upper|lower}]}.",
    ))
    registry.register(Kind(
        name="quote", fn=quotes.read_quote, validate=quotes.validate_quote, freshness="live", owner="agent-md",
        max_symbols=ONE_SYMBOL,
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
        max_symbols=ONE_SYMBOL,
        description="Completed daily sessions for one ticker from UCT's bars store (never today's "
                    "developing bar); as_of is the newest bar's session close. Point-in-time with `to`; a window "
                    "with `from`. Weekly / monthly with `tf` (W | M: the daily store read resampled by the product's own "
                    "resamplers, weeks dated by their Friday; each period's change vs the previous close and a `partial` flag "
                    "for a forming week / month; rows before 2003-09-10 are labelled yfinance history). "
                    f"Params: {{symbol, bars (1-{bars_daily.MAX_BARS}, default {bars_daily.DEFAULT_BARS}; periods for W / M), "
                    "to?, from?, tf? (D | W | M, default D)}.",
    ))
    # W2-B2 (builder-b): the event study, LOCAL-ONLY to the model through the capability (turn.LOCAL_ONLY_ACTIONS
    # "history.afterEvent"): the member sees the table; the model gets the request note and counts. Technical series
    # only — a breadth-conditioned study is refused before any read (ADR-005).
    registry.register(Kind(
        name=history_event_study.KIND, fn=history_event_study.read_event_study, validate=history_event_study.validate,
        freshness="historical", owner="builder-b", max_symbols=ONE_SYMBOL,
        description="Event study from UCT's stored daily closes (Market Intelligence event_study): every time one "
                    "ticker met a technical condition — an opening gap of N%+ (gap_pct), a one-day close-to-close move "
                    "(day_pct), RSI, % from an N-day SMA, Bollinger %B or the MACD histogram above / below / crossing a "
                    "level — its forward price returns over 1-252 sessions, with a baseline of all sessions; `last` keeps "
                    "only the most recent N events. Descriptive, not predictive; shown to the "
                    f"member only. Params: {{symbol, indicator: {'|'.join(history_event_study.INDICATORS)}, period?, "
                    f"op: {'|'.join(history_event_study.OPS)}, threshold, horizons? (sessions), since?, "
                    f"last? (1-{history_event_study.MAX_LAST})}}.",
    ))
    registry.register(Kind(
        name="fundamentals", fn=statements.read_fundamentals, validate=statements.validate, freshness="periodic",
        owner="agent-md", max_symbols=ONE_SYMBOL,
        description="Periodic financial disclosures (income, balance, cash flow) from Yahoo Finance via "
                    "financial_statements; as_of is the newest period end, stale after "
                    f"{statements.STALE_AFTER_DAYS} days. Params: {{symbol, period: quarterly|annual, periods}}.",
    ))
    registry.register(Kind(
        name="earnings", fn=earnings.read_earnings, validate=earnings.validate, freshness="periodic",
        owner="agent-md", max_symbols=ONE_SYMBOL,
        description="Reported quarters (actual vs estimate) and the next scheduled report, from earnings_table. "
                    "Reported rows carry no date, so as_of is null; stale when "
                    f"{earnings.STALE_QUARTERS}+ quarters behind. Params: {{symbol}}.",
    ))
    registry.register(Kind(
        name="news.company", fn=news_company.read_news_company, validate=news_company.validate,
        freshness="periodic", owner="agent-md", max_symbols=ONE_SYMBOL,
        description="Published company news from UCT's news store (no provider call, no body text); as_of is the "
                    "newest item; stale when news ingest has not succeeded for an hour. "
                    f"Params: {{symbol, limit (1-{news_company.MAX_LIMIT})}}.",
    ))
    registry.register(Kind(
        name="themes", fn=themes.read_themes, validate=themes.validate, freshness="periodic", owner="agent-md",
        max_symbols=NO_SYMBOL,
        description="Equal-weight returns of UCT's curated themes (the Theme Tracker payload), read without "
                    "building it — 'theme data is warming' when no complete overlay exists. "
                    f"Params: {{period: {'|'.join(themes.PERIODS)}, order: leaders|laggards, limit (1-{themes.MAX_LIMIT})}}.",
    ))
    # W1-C C-03 (builder-c): one dedicated kind per asset class, licence-driven (asset_quotes.py). Params: {asset}
    # (the class's own ids, asset_classes.py), never a ticker. While no (vendor, data_class) row is in force as A/LA
    # every read is the honest decline — "I don't have a licensed source for …" — never a ticker guess.
    registry.register(Kind(
        name="index.quote", fn=index_quote.read_index_quote, validate=index_quote.validate, freshness="delayed",
        owner="builder-c", max_symbols=NO_SYMBOL,       # review (#706): its only fetch is Massive's 15-min-delayed snapshot
        description="The level of a market index (S&P 500, Nasdaq, Dow, Russell 2000, VIX) from a LICENSED index "
                    "source — today none is in force, so the read declines honestly rather than pricing an ETF as the "
                    f"index. Params: {{asset: {'|'.join(sorted(asset_classes.assets_of('index.quote')))}}}.",
    ))
    registry.register(Kind(
        name="commodity.quote", fn=commodity_quote.read_commodity_quote, validate=commodity_quote.validate,
        freshness="live", owner="builder-c", max_symbols=NO_SYMBOL,
        description="A commodity price (gold, silver, copper, crude oil, natural gas) from a LICENSED source — today "
                    "none exists in the stack, so the read declines honestly; never a miner's or a fund's share price. "
                    f"Params: {{asset: {'|'.join(sorted(asset_classes.assets_of('commodity.quote')))}}}.",
    ))
    registry.register(Kind(
        name="crypto.quote", fn=crypto_quote.read_crypto_quote, validate=crypto_quote.validate, freshness="live",
        owner="builder-c", max_symbols=NO_SYMBOL,
        description="A cryptocurrency's own price (Bitcoin, Ether, Solana) from a LICENSED source — today none exists, "
                    "so the read declines honestly; a crypto ETF's share price is never presented as the coin's. "
                    f"Params: {{asset: {'|'.join(sorted(asset_classes.assets_of('crypto.quote')))}}}.",
    ))
    registry.register(Kind(
        name="breadth.current", fn=breadth.read_breadth_current, validate=breadth.validate, freshness="periodic",
        owner="agent-md", max_symbols=NO_SYMBOL, model_isolated=True,
        description="The current breadth reading for one measure on the US, NYSE or Nasdaq universe, from "
                    "breadth_current (intraday, provisional or finalized, with its label). Includes the "
                    "new-high/new-low measures. Shown to the member only. Params: {universe, metric}.",
    ))
    registry.register(Kind(
        name="ratings", fn=ratings.read_ratings, validate=ratings.validate, freshness="periodic",
        owner="agent-md", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="UCT Ratings: UCT's own composite 0-99 and component scores (not an analyst rating); "
                    "as_of is the price data's last session. Shown to the member only. Params: {symbol}.",
    ))
    # W2-B1 (agent-rs, RS-1 v1): a COMPOSED kind. It reads the served kinds above (purpose "research", so a
    # model-isolated kind refuses before admission) and the turn's one web search; every fact's figures come from
    # those envelopes. Declared `live` only because the gateway lets a read be LESS fresh than its kind, never
    # fresher: the envelope's class is the least fresh contributing input (rs1.py). Default OFF like every kind.
    registry.register(Kind(
        name=rs1.KIND, fn=rs1.read_research_company, validate=rs1.validate, freshness="live", owner="agent-rs",
        max_symbols=ONE_SYMBOL,
        description="A structured research answer for one company — facts (only figures UCT's gateway returned, each "
                    "with its source and as_of), interpretation (web commentary with unconfirmed figures stripped), "
                    "unknowns, and dated sources — composed from the served quote / news.company / earnings / "
                    "fundamentals (/ themes) kinds plus the turn's single web search. "
                    f"Params: {{symbol, topic: {'|'.join(rs1.TOPICS)}, question?}}.",
    ))
