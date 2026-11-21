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
Terminal data wave 1 (terminal-data): `analyst.actions`, `highsLows.session`, `sectors.performance`, `leaders.longRun`,
`levels.darkpool` — the Agent half of the UPDG / HILO / SCTR / LEAD / LVL terminal panels. All default OFF.
Terminal data wave 2 (terminal-data): `highsLows.yearly`, `themes.rotation`, `confluence.board`, `earnings.expectedMove`,
`earnings.callSearch` — the Agent half of the H52 / TROT / CONFL / EXMV / TSRC terminal panels. All default OFF, all
MODEL-ISOLATED, and none ever starts a build: each reads what its service already holds (MD-1 §4.11).
Terminal data wave 3 (terminal-data): `levels.gamma`, `flow.topPicks`, `flow.record`, `earnings.reactions` — the Agent
half of the LVL (options half) / TOPF / Flow Record / EMOV surfaces. All default OFF, all MODEL-ISOLATED, and none ever
starts a build or spends a provider call (MD-1 §4.12).
Terminal data wave 4 (terminal-data): `earnings.season`, `earnings.callThemes`, `group.drill` — the Agent half of the
ERNS / CEOS / GRP terminal panels. All default OFF, all MODEL-ISOLATED, and none ever starts a build or spends a provider
call: each reads only the answer its service already holds, through that service's read-only accessor (MD-1 §4.13). The
UNVOL panel needs no kind of its own: it is the Screener's by-now relative volume, which `screen.run` already scans.
Terminal data wave 5 (terminal-data): `short.interest`, `short.list` — the Agent half of the SHINT / SHRTS terminal
panels (FINRA short interest and daily short volume). Both default OFF, both MODEL-ISOLATED, and neither ever starts a
build, a check or a vendor request: each reads only what `api/services/short_data.py` already holds, through that
service's read-only accessors (MD-1 §4.14).

Terminal data wave 6 (terminal-data): `seasonality.stock`, `seasonality.board`, `options.tideHistory`,
`options.oiChange`, `rates.treasury` — the Agent half of the SEAS / SEASB / TIDEH / OIC / RATES terminal panels. All
five default OFF, all five MODEL-ISOLATED, and none ever starts a build, a fetch or a vendor request: each reads only
what its service or store already holds (MD-1 §4.15).

Terminal data wave 7 (terminal-data): `market.regime`, `stock.setups`, `stock.eventsTimeline`, `uct20.list`,
`options.ivHistory`, `dilution.watch` — the Agent half of the REGM / TECH (confirmed setups) / EVTS / UCT 20 / IVH /
DILU surfaces. All six default OFF, all six MODEL-ISOLATED, and none ever starts a compute, a build, a download or
a vendor request: each reads only what its service or store already holds (MD-1 §4.16).

Terminal data wave 8 (terminal-data): `stock.corporateActions`, `calendar.ipos`, `calendar.dividends` — the Agent half
of the CACT / IPO / DVD terminal panels. All three default OFF, all three MODEL-ISOLATED, and none ever starts a build
or a vendor request: each reads only what its service already holds (MD-1 §4.17). The MKTS board gets no kind: its
figures are live quotes the existing `quotes` and `rates.treasury` kinds already read.

Terminal data wave 9 (terminal-data): `rates.auctions`, `rates.realYields`, `fed.watch` — the Agent half of the AUCT
terminal panel, the real-yield block of RATES and the FED panel. All three default OFF, all three MODEL-ISOLATED, and
none ever starts a build or a request: each reads only what its service already holds (MD-1 §4.18).
"""
from __future__ import annotations

from api.services.uct_agent.marketdata import (asset_classes, bars_daily, breadth, commodity_quote, crypto_quote, earnings,
                                              index_quote, instruments, news_company, quotes, ratings, statements, themes)
from api.services.uct_agent.marketdata import catalysts_board, cot, history_event_study, rs_leadership
from api.services.uct_agent.marketdata import (analyst_actions, darkpool_levels, leaders_long_run, sectors_performance,
                                              session_highs_lows)
from api.services.uct_agent.marketdata import (confluence_board, earnings_call_search, earnings_expected_move,
                                              themes_rotation, yearly_highs_lows)
from api.services.uct_agent.marketdata import earnings_reactions, flow_record, flow_top_picks, gamma_levels
from api.services.uct_agent.marketdata import earnings_call_themes, earnings_season, group_drill
from api.services.uct_agent.marketdata import short_interest, short_list
from api.services.uct_agent.marketdata import (oi_change_read, seasonality_board_read, seasonality_stock,
                                               tide_history_read, treasury_read)
from api.services.uct_agent.marketdata import (dilution_read, events_timeline_read, iv_history_read, regime_read,
                                               setups_read, uct20_read)
from api.services.uct_agent.marketdata import corporate_actions_read, dividends_calendar_read, ipo_calendar_read
from api.services.uct_agent.marketdata import fed_watch_read, real_yields_read, treasury_auctions_read
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
        description="Periodic financial disclosures (income, balance, cash flow) via financial_statements "
                    "(FMP; Yahoo Finance only for a ticker FMP has no statements for; `source` names the one "
                    "that answered); as_of is the newest period end, stale after "
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
    # Phase 2 (market intelligence): relative strength + group leadership from UCT's stored RS Rating table, the bars
    # store and the industry map (no provider call). MODEL-ISOLATED like `ratings`: the RS Rating is UCT-derived.
    registry.register(Kind(
        name=rs_leadership.KIND, fn=rs_leadership.read_rs_leadership, validate=rs_leadership.validate,
        freshness="periodic", owner="agent-md", max_symbols=rs_leadership.MAX_SYMBOLS, model_isolated=True,
        description="Relative strength and leadership from UCT's stored data: the nightly UCT RS Rating (1-99) with its "
                    "5/20-session change, period returns vs SPY over the identical window, a stock's rank in its "
                    "industry, the 11 SPDR sector ETFs ranked, one industry's rating distribution, or the index + "
                    "sector backdrop. Historical, never a forecast. Shown to the member only. Params: {scope: "
                    f"{'|'.join(rs_leadership.SCOPES)}, symbols?, industry?, period: {'|'.join(rs_leadership.PERIODS)}}}.",
    ))
    # Phase 2 (market-moving news + catalysts): UCT's catalyst board from the catalyst engine's own store, opened
    # READ-ONLY (no _init_db, no WAL pragma, no self-heal refresh, no provider). MODEL-ISOLATED: stored headlines are
    # third-party text and the grade / write-up are UCT-derived AI output; the reading capability (news.movers) is
    # local-only (turn.LOCAL_ONLY_ACTIONS), so a co-occurring headline never becomes a model's stated cause.
    registry.register(Kind(
        name=catalysts_board.KIND, fn=catalysts_board.read_catalysts_board, validate=catalysts_board.validate,
        freshness="periodic", owner="agent-md", max_symbols=catalysts_board.MAX_SYMBOLS, model_isolated=True,
        description="UCT's catalyst board: the stocks UCT's catalyst engine flagged on a market date (type, tag, grade, "
                    "gap, new vs continuing, first-news time, the engine's write-up, stored headlines with source and "
                    "time), optionally only some symbols or one stored sector, over the last 1-"
                    f"{catalysts_board.MAX_DAYS} stored boards; as_of is the newest board's last refresh. Co-occurring "
                    "headlines, never established causes. Shown to the member only. "
                    f"Params: {{date?, days?, symbols?, sector?, limit (1-{catalysts_board.MAX_LIMIT})}}.",
    ))
    # Phase 2 (COT research): CFTC Commitments of Traders weekly rows from the COT tab's own store (no provider call).
    # The positioning statistics are computed in the browser by the COT tab's single authority (cotRead.js), not here.
    registry.register(Kind(
        name=cot.KIND, fn=cot.read_cot, validate=cot.validate, freshness="periodic", owner="agent-md",
        max_symbols=cot.MAX_MARKETS,
        description="CFTC Commitments of Traders: stored weekly net positions (large speculators, commercials, small "
                    "speculators) and open interest for 1-6 futures markets, named by a member's word or COT code; "
                    "as_of is the Tuesday report date (published the following Friday), stale when a newer report is "
                    f"due. Unmapped words are listed as not covered. Params: {{symbols: [...], weeks (1-{cot.MAX_WEEKS})}}.",
    ))
    # Terminal data wave 1 (owner: terminal-data): the Agent half of five terminal panels, each a thin adapter over the
    # service its member route already reads. Default OFF like every kind (UCT_AGENT_DATA_KINDS); the four isolated
    # ones also need their own UCT_AGENT_ISOLATED_KINDS entry (ADR-005), and their capabilities are local-only.
    registry.register(Kind(
        name=analyst_actions.KIND, fn=analyst_actions.read_analyst_actions, validate=analyst_actions.validate,
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="Analyst upgrades, downgrades and price-target changes from the last morning wire pushed to this "
                    "server (market-wide; firm, action, ratings, target). as_of is the wire's own date; the list is "
                    "served until the next wire, so it is never worded as today's. Shown to the member only. "
                    f"Params: {{side: {'|'.join(analyst_actions.SIDES)}}}.",
    ))
    registry.register(Kind(
        name=session_highs_lows.KIND, fn=session_highs_lows.read_session_highs_lows,
        validate=session_highs_lows.validate, freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL,
        model_isolated=True,
        description="Stocks making new highs and new lows OF THE SESSION (pre-market, regular, after-hours; not "
                    "52-week), each with how many times, from UCT's intraday scanner; as_of is null (only UCT's tick "
                    "time is known), historical when the market is closed. Shown to the member only. "
                    f"Params: {{limit (1-{session_highs_lows.MAX_LIMIT}), min_price?, min_count?}}.",
    ))
    registry.register(Kind(
        name=sectors_performance.KIND, fn=sectors_performance.read_sectors_performance,
        validate=sectors_performance.validate, freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL,
        description="The 11 SPDR sector funds ranked by percent change from daily closes; as_of is null (the ranking "
                    "carries no time). A cold read costs one daily-bars request per fund. "
                    "Params: {period: Today|1W|1M|3M}.",
    ))
    registry.register(Kind(
        name=leaders_long_run.KIND, fn=leaders_long_run.read_leaders_long_run, validate=leaders_long_run.validate,
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="One of UCT's long-run leader lists: 30 / 60 / 90-session top gainers, 1-year or all-time volume "
                    "highs, new listings. 'computing' while its reference builds; an empty list can also mean the "
                    "market snapshot was missing. Shown to the member only. "
                    f"Params: {{list: {'|'.join(leaders_long_run.LISTS)}, limit (1-{leaders_long_run.MAX_LIMIT})}}.",
    ))
    registry.register(Kind(
        name=darkpool_levels.KIND, fn=darkpool_levels.read_darkpool_levels, validate=darkpool_levels.validate,
        # declared `periodic` (levels are recomputed as the nightly print ledger grows); every read reports the LESS
        # fresh `historical` (completed sessions only), which MD-1 §3 allows and the isolation rails' spies assume
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="One stock's dark pool price levels: zones where confirmed dark pool prints bunched up, computed "
                    "by UCT from the nightly-confirmed print ledger; as_of is the newest print date among them. A "
                    "failed read is never 'no levels'. Shown to the member only. Params: {symbol}.",
    ))
    # Terminal data wave 2 (owner: terminal-data): the Agent half of five more terminal panels. Default OFF like every kind
    # (UCT_AGENT_DATA_KINDS); ALL FIVE are model-isolated, so each also needs its own UCT_AGENT_ISOLATED_KINDS entry
    # (ADR-005) and its capability is local-only. None starts a build inside a turn: each reads what its service already
    # holds (a warm cache, a stored list, a local index) and answers `unavailable` with the reason otherwise.
    registry.register(Kind(
        name=yearly_highs_lows.KIND, fn=yearly_highs_lows.read_yearly_highs_lows, validate=yearly_highs_lows.validate,
        # declared `periodic` (the lists of a session under way); a finished session's stored lists read `historical`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="The stocks at new 52-WEEK highs and new 52-week lows (the names behind the Breadth Monitor's counts, "
                    "UCT's own universe): the lists of the session under way from the last warm breadth read, else the "
                    "stored lists of the newest finished session. Never computes a breadth read. Shown to the member only. "
                    f"Params: {{side: {'|'.join(yearly_highs_lows.SIDES)}, limit (1-{yearly_highs_lows.MAX_LIMIT})}}.",
    ))
    registry.register(Kind(
        name=themes_rotation.KIND, fn=themes_rotation.read_themes_rotation, validate=themes_rotation.validate,
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="Which of UCT's themes are rotating in and out: each theme's 1-week percentile rank against its "
                    f"1-month rank ({themes_rotation.THRESHOLD} points or more apart), read from the service's 15-minute "
                    "cache and never computed here ('not cached' otherwise); as_of is null (only UCT's time is known). "
                    "Shown to the member only. "
                    f"Params: {{side: {'|'.join(themes_rotation.SIDES)}, limit (1-{themes_rotation.MAX_LIMIT})}}.",
    ))
    registry.register(Kind(
        name=confluence_board.KIND, fn=confluence_board.read_confluence_board, validate=confluence_board.validate,
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="UCT's confluence board: stocks where a large dark pool dollar size and aligned long-dated options "
                    "flow line up, for the one window the server keeps warm. The cached board or 'warming', never a "
                    "build; as_of is null (the board carries no data time). Shown to the member only. "
                    f"Params: {{direction: {'|'.join(confluence_board.DIRECTIONS)}, limit (1-{confluence_board.MAX_LIMIT})}}.",
    ))
    registry.register(Kind(
        name=earnings_expected_move.KIND, fn=earnings_expected_move.read_expected_move,
        validate=earnings_expected_move.validate, freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL,
        model_isolated=True,
        description="One stock's expected move around earnings: the at-the-money straddle from UCT's own Massive option "
                    "chain when the server already holds it (never read here), and what the straddle priced before each "
                    "past and coming report from UCT's capture store. No Setup Grade. Shown to the member only. "
                    "Params: {symbol, report_date? (YYYY-MM-DD)}.",
    ))
    registry.register(Kind(
        name=earnings_call_search.KIND, fn=earnings_call_search.read_call_search, validate=earnings_call_search.validate,
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="Search UCT's index of recent earnings-call transcripts for a word or a phrase: one hit per call, best "
                    "match first, with the index's own short excerpt (third-party text, never lengthened). An empty index "
                    "is 'unavailable', never 'no mention'. Shown to the member only. "
                    f"Params: {{q, limit (1-{earnings_call_search.MAX_LIMIT}), symbol?, since? (YYYY-MM-DD)}}.",
    ))
    # Terminal data wave 3 (owner: terminal-data): four more kinds, the Agent half of the LVL panel's options levels, the
    # TOPF panel, the Flow Record page and the EMOV panel. Default OFF like every kind (UCT_AGENT_DATA_KINDS); ALL FOUR
    # are model-isolated, so each also needs its own UCT_AGENT_ISOLATED_KINDS entry (ADR-005) and its capability is
    # local-only. None starts a build or spends a provider call: `levels.gamma` and `earnings.reactions` read only what
    # their routes already hold, and the two flow kinds read the pick tracker's in-memory lists.
    registry.register(Kind(
        name=gamma_levels.KIND, fn=gamma_levels.read_gamma_levels, validate=gamma_levels.validate,
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="One stock's gamma walls: the call wall, the put wall and the zero gamma level UCT works out from an "
                    "option chain, read from what the server already holds (its 10-minute cache, else a last good copy) "
                    "and never built here ('not held' otherwise); as_of is null (only UCT's build time is known). "
                    "Shown to the member only. Params: {symbol}.",
    ))
    registry.register(Kind(
        name=flow_top_picks.KIND, fn=flow_top_picks.read_top_picks, validate=flow_top_picks.validate,
        # declared `periodic` (the store grows daily); every read reports the LESS fresh `historical` (daily prices)
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="UCT's Top Flow picks, one by one, with how each option CONTRACT has done since it was flagged (the "
                    "Flow Record's own arithmetic; a pick with fewer than two daily prices is too new to score, never "
                    "0%). Picks from UCT's options flow tape; daily prices from Massive (before November 2026, from Schwab). as_of is "
                    "the newest daily price date. Shown to the member only. "
                    f"Params: {{status: {'|'.join(flow_top_picks.STATUSES)}, direction: {'|'.join(flow_top_picks.DIRECTIONS)}, "
                    f"sort: {'|'.join(flow_top_picks.SORTS)}, limit (1-{flow_top_picks.MAX_LIMIT}), symbol?}}.",
    ))
    registry.register(Kind(
        name=flow_record.KIND, fn=flow_record.read_flow_record, validate=flow_record.validate,
        # declared `periodic`; every read reports the LESS fresh `historical` (daily prices of completed sessions)
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="The Flow Record: aggregate results of every Top Flow pick (win rates, the same by grade, recent "
                    "standouts, the last scored picks whatever their result), from the service's own 5-minute cache; "
                    "losers are never left out and too-new picks are in no rate. as_of is the newest daily price date; "
                    "the newest pick's date is given. Shown to the member only. Params: none.",
    ))
    registry.register(Kind(
        name=earnings_reactions.KIND, fn=earnings_reactions.read_earnings_reactions,
        validate=earnings_reactions.validate, freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL,
        model_isolated=True,
        description="One day's earnings reporters from UCT's calendar, each with its reported EPS and revenue against "
                    "what was expected and the stock's move, read only from what the server's calendar caches already "
                    "hold (never a week build, never a price read: 'not held' otherwise); as_of is null (no data time "
                    "is carried). Shown to the member only. "
                    f"Params: {{date? (YYYY-MM-DD, a weekday), limit (1-{earnings_reactions.MAX_LIMIT})}}.",
    ))
    # Terminal data wave 4 (owner: terminal-data): three more kinds, the Agent half of the ERNS, CEOS and GRP panels.
    # Default OFF like every kind (UCT_AGENT_DATA_KINDS); ALL THREE are model-isolated, so each also needs its own
    # UCT_AGENT_ISOLATED_KINDS entry (ADR-005) and its capability is local-only. None starts a build or spends a provider
    # call: each member route can start its service's background build, so each adapter reads the service's own
    # read-only accessor (`earnings_season.held_day`, `call_themes.held_themes`, `scan_period.period_groups_of` over the
    # held ranking) and answers `unavailable`, with the reason, when nothing is held.
    registry.register(Kind(
        name=earnings_season.KIND, fn=earnings_season.read_earnings_season, validate=earnings_season.validate,
        # declared `periodic` (results and moves land through the day); a past day's read reports `historical`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="One day's earnings reporters in one read: who reports before the open and after the close, biggest "
                    "company first, each with the move options priced before the report (UCT's stored capture from its "
                    "own Massive option chain), its past earnings moves, and the result and move once it lands. Only the "
                    "answer the server already holds, never a build ('not held' otherwise); as_of is null (only UCT's "
                    "build time is known). Shown to the member only. "
                    f"Params: {{date? (YYYY-MM-DD, a weekday), session: {'|'.join(earnings_season.SESSION_CHOICES)}, "
                    f"limit (1-{earnings_season.MAX_LIMIT})}}.",
    ))
    registry.register(Kind(
        name=earnings_call_themes.KIND, fn=earnings_call_themes.read_call_themes,
        validate=earnings_call_themes.validate, freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL,
        model_isolated=True,
        description="The phrases new and rising across a month of earnings calls: one- to three-word phrases whose share "
                    "of calls rose the most against the months before, with counts and example tickers (phrases from "
                    "third-party transcripts; no other transcript text). Only the lists the server already holds, never "
                    "the scan ('not held' otherwise); as_of is the newest call they were worked out from. Shown to the "
                    "member only. "
                    f"Params: {{month? (YYYY-MM), list: {'|'.join(earnings_call_themes.LISTS)}, "
                    f"limit (1-{earnings_call_themes.MAX_LIMIT})}}.",
    ))
    registry.register(Kind(
        name=group_drill.KIND, fn=group_drill.read_group_drill, validate=group_drill.validate,
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="One sector, industry or UCT theme and its stocks: each stock's percent change over a one-click "
                    "range, its RS rank and whether it is on UCT's confluence board, joined from answers the server "
                    "already holds (never a ranking build: 'not held' otherwise). With no group named: the names of the "
                    "ranked groups, for resolving one. as_of is null (the ranking carries two days and UCT's build "
                    "time). Shown to the member only. "
                    f"Params: {{range: {'|'.join(group_drill.RANGES)}, kind?: {'|'.join(group_drill.GROUP_KINDS)}, "
                    f"group? (its exact name; needs kind), sort: {'|'.join(group_drill.SORTS)}, "
                    f"dir: {'|'.join(group_drill.DIRS)}, limit (1-{group_drill.MAX_LIMIT})}}.",
    ))
    # Terminal data wave 5 (owner: terminal-data): two more kinds, the Agent half of the SHINT and SHRTS panels. Default OFF
    # like every kind (UCT_AGENT_DATA_KINDS); BOTH are model-isolated, so each also needs its own UCT_AGENT_ISOLATED_KINDS
    # entry (ADR-005) and its capability is local-only. Neither starts a build, a check or a vendor request: each member
    # route can start the service's background build, so each adapter reads the service's own read-only accessor
    # (`short_data.held_stock`, `short_data.held_market`) and answers `unavailable`, with the reason, when nothing is held.
    registry.register(Kind(
        name=short_interest.KIND, fn=short_interest.read_short_interest, validate=short_interest.validate,
        # declared `periodic` (a report lands twice a month, short volume daily); every read reports the LESS fresh
        # `historical` (a settled report and completed sessions)
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="One stock's FINRA short interest: the newest report (settlement date, shares short, days to cover, "
                    "average daily volume, the change from the report before), percent of float, its newest reports and "
                    "its newest days of daily short volume (off-exchange trades only; not short interest). Only the "
                    "answer the server already holds, never a vendor read ('not held' otherwise); as_of is the "
                    "settlement date, never today. Shown to the member only. "
                    f"Params: {{symbol, reports (1-{short_interest.MAX_REPORTS}), days (1-{short_interest.MAX_DAYS})}}.",
    ))
    registry.register(Kind(
        name=short_list.KIND, fn=short_list.read_short_list, validate=short_list.validate,
        # declared `periodic` (a report lands twice a month); every read reports the LESS fresh `historical`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="The newest FINRA short interest report across the stocks UCT follows, each beside its previous "
                    "report, ranked by days to cover, by the biggest percent increase or decrease in short interest, or "
                    "by percent of float. Only the list the server already holds, never a vendor read or a look for a "
                    "newer report ('not held' otherwise); as_of is the settlement date, never today. Shown to the member "
                    f"only. Params: {{rank: {'|'.join(short_list.RANKS)}, limit (1-{short_list.MAX_LIMIT})}}.",
    ))
    # Terminal data wave 6 (owner: terminal-data): five more kinds, the Agent half of the SEAS, SEASB, TIDEH, OIC and
    # RATES panels. Default OFF like every kind (UCT_AGENT_DATA_KINDS); ALL FIVE are model-isolated, so each also needs
    # its own UCT_AGENT_ISOLATED_KINDS entry (ADR-005) and its capability is local-only. None starts a build, a fetch or
    # a vendor request: where the member route can start work (the bar serve's deep fetch, the board's build, the
    # open-interest pair's background build, the Treasury build), the adapter reads the read-only path beside it and
    # answers `unavailable`, with the reason, when nothing is held (MD-1 §4.15).
    registry.register(Kind(
        name=seasonality_stock.KIND, fn=seasonality_stock.read_seasonality_stock, validate=seasonality_stock.validate,
        # declared `periodic` (the table moves once a month); every read reports the LESS fresh `historical`
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="One stock by calendar month and by weekday, close to close: for each month the years counted, "
                    "the average and the median month return, the percent of years it rose and a flag when too few "
                    "years are counted, with the window the record covers. Only the completed daily bars the server "
                    "already holds, never a fetch; a history held only in part is 'unavailable', never a short record "
                    "stated as the record. as_of is the newest bar in the record, never today. Shown to the member "
                    "only. Params: {symbol}.",
    ))
    registry.register(Kind(
        name=seasonality_board_read.KIND, fn=seasonality_board_read.read_seasonality_board,
        validate=seasonality_board_read.validate,
        # declared `periodic` (built once a New York day); every read reports the LESS fresh `historical`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="The seasonality board: the index funds and the sector funds by calendar month (years counted, "
                    "average and median month return, percent of years up, a flag on a thin month), each fund without "
                    "numbers listed with its reason. Only the board the server already holds today, never a build "
                    "('not held' otherwise); as_of is the newest bar the board covers, never today. Shown to the member "
                    "only. No params.",
    ))
    registry.register(Kind(
        name=tide_history_read.KIND, fn=tide_history_read.read_tide_history, validate=tide_history_read.validate,
        # declared `periodic` (one row a session, stored after the close); every read reports `historical`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="Market Tide by finished session, newest first: net call premium, net put premium and net for each "
                    "stored session, for the whole options tape, stocks only or funds only, with the first stored day "
                    "and the sessions that have no row. Only the stored sessions, never a capture or a live tide; as_of "
                    "is the newest stored session, never today. Shown to the member only. "
                    f"Params: {{scope: {'|'.join(tide_history_read.SCOPES)}, rows (1-{tide_history_read.MAX_ROWS})}}.",
    ))
    registry.register(Kind(
        name=oi_change_read.KIND, fn=oi_change_read.read_oi_change, validate=oi_change_read.validate,
        # declared `periodic` (one log file a session); every read reports `historical`
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="One stock's open-interest change by contract between the two newest sessions of UCT's options "
                    "log: the changed and the newly listed contracts, biggest first, for calls, puts or both, with the "
                    "totals by side, what expired, what was not reported and any session skipped. Only the pair of "
                    "files the server already holds, never the background build ('not prepared' otherwise); as_of is "
                    "the newer file's date, never today. Shown to the member only. "
                    f"Params: {{symbol, side: {'|'.join(oi_change_read.SIDES)}, rows (1-{oi_change_read.MAX_ROWS})}}.",
    ))
    registry.register(Kind(
        name=treasury_read.KIND, fn=treasury_read.read_treasury, validate=treasury_read.validate,
        # declared `periodic` (one curve a day, end of day); every read reports `historical`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="US Treasury daily par yields by maturity as UCT holds them: each yield, what it was one day, one "
                    "week, one month, three months and one year earlier with the change in basis points, and the "
                    "10-year minus 2-year and 10-year minus 3-month spreads with their state. Only the answer the "
                    "server already holds, never a request to the Treasury's website ('not held' otherwise); as_of is "
                    "the curve's date, never today. Shown to the member only. No params.",
    ))
    # Terminal data wave 7 (owner: terminal-data): six more kinds, the Agent half of the REGM, TECH (confirmed
    # setups), EVTS, UCT 20, IVH and DILU surfaces. Default OFF like every kind (UCT_AGENT_DATA_KINDS); ALL SIX are
    # model-isolated, so each also needs its own UCT_AGENT_ISOLATED_KINDS entry (ADR-005) and its capability is
    # local-only. None starts a compute, a build, a download or a vendor request: where the member route can start
    # work (the regime recompute, the earnings rebuild, the pending-acquisition build and the bar warm, the options
    # log download, the SEC build), the adapter reads the read-only path beside it and answers `unavailable`, with
    # the reason, when nothing is held (MD-1 §4.16).
    registry.register(Kind(
        name=regime_read.KIND, fn=regime_read.read_regime, validate=regime_read.validate,
        # declared `periodic` (recomputed at most every 15 minutes); every read reports `periodic`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="UCT's rules-based market regime read as the server last computed it: the regime, its "
                    "confidence, the sizing band UCT's own GRADE verdicts read, and the breadth figures behind it. "
                    "The UCT Exposure Rating and the VIX level are left out. Only a read the server already holds, "
                    "never a recompute ('not held' otherwise); as_of is when the server computed it, never the "
                    "time of the read. What UCT's rules read, not advice. Shown to the member only. No params.",
    ))
    registry.register(Kind(
        name=setups_read.KIND, fn=setups_read.read_setups, validate=setups_read.validate,
        # declared `periodic` (the judge runs on a schedule); every read reports `historical`
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="One stock's setups confirmed by UCT's chart judge on its daily chart, as stored: the setup, the "
                    "daily bar it was judged on, the judge's confidence and key level, newest first, with how many "
                    "setups were judged in the window. Stored verdicts only, never a detection or a chart reading; "
                    "a stock that was not judged is 'unavailable', never 'no setup'. as_of is the newest bar "
                    "judged, never the time of the read. Shown to the member only. "
                    f"Params: {{symbol, rows (1-{setups_read.MAX_ROWS})}}.",
    ))
    registry.register(Kind(
        name=events_timeline_read.KIND, fn=events_timeline_read.read_events, validate=events_timeline_read.validate,
        # declared `periodic` (the stores are written by daily jobs); every read reports `historical`
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="One stock's dated events from UCT's stores, each placed against its nearest earnings report: "
                    "earnings reports and the next scheduled one, catalyst engine flags, SEC filings in UCT's "
                    "index and days the room's mentions spiked, newest first. Stored events only, never a fetch; "
                    "off while the timeline's own switch is off, and a source that did not answer is named. as_of "
                    "is the newest event that is not in the future, never the time of the read. Shown to the "
                    f"member only. Params: {{symbol, rows (1-{events_timeline_read.MAX_ROWS})}}.",
    ))
    registry.register(Kind(
        name=uct20_read.KIND, fn=uct20_read.read_uct20, validate=uct20_read.validate,
        # declared `periodic` (one wire run a day); every read reports `historical`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="The current UCT 20 leadership list as the morning wire last pushed it: each name's rank, RS "
                    "rating, UCT 20 score, one-month and three-month returns and next earnings date. The model "
                    "portfolio, its NAV and each name's entry, stop and targets are left out. Only the list the "
                    "server already holds, never a build ('not held' otherwise); as_of is the wire run's date, "
                    "never the time of the read. Shown to the member only. "
                    f"Params: {{rows (1-{uct20_read.MAX_ROWS})}}.",
    ))
    registry.register(Kind(
        name=iv_history_read.KIND, fn=iv_history_read.read_iv_history, validate=iv_history_read.validate,
        # declared `periodic` (one logged session a day); every read reports `historical`
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="One stock's at-the-money implied volatility by session from UCT's own options log, newest "
                    "first, with the day the log began, the sessions held and the IV rank and percentile (null, "
                    "with the reason, under the service's minimum of sessions). Only the sessions already on the "
                    "server's disk, never a download ('not held' otherwise); as_of is the newest session with a "
                    "figure, never the time of the read. Shown to the member only. "
                    f"Params: {{symbol, rows (1-{iv_history_read.MAX_ROWS})}}.",
    ))
    registry.register(Kind(
        name=dilution_read.KIND, fn=dilution_read.read_dilution, validate=dilution_read.validate,
        # declared `periodic` (an answer is held for an hour and rebuilt on a member's visit); reads report `historical`
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="One company's share-issuance filings of the last three years as UCT classified them from the "
                    "SEC's filing index: each filing's date, form and kind, the shelf registrations and their "
                    "state, and counts of offerings, unregistered sales and registrations. Only the answer the "
                    "server already holds, never a request to the SEC ('not held' otherwise); as_of is the newest "
                    "filing's day, never the time of the read. Shown to the member only. "
                    f"Params: {{symbol, rows (1-{dilution_read.MAX_ROWS})}}.",
    ))
    # Terminal data wave 8 (owner: terminal-data): three more kinds, the Agent half of the CACT, IPO and DVD panels.
    # Default OFF like every kind (UCT_AGENT_DATA_KINDS); ALL THREE are model-isolated, so each also needs its own
    # UCT_AGENT_ISOLATED_KINDS entry (ADR-005) and its capability is local-only. None asks a vendor: where the member
    # route can (the IPO calendar's two vendor reads, the dividend calendar's reference reads), the adapter reads the
    # held-only reader beside the service and answers `unavailable`, with the reason, when nothing is held (MD-1 §4.17).
    registry.register(Kind(
        name=corporate_actions_read.KIND, fn=corporate_actions_read.read_corporate_actions,
        validate=corporate_actions_read.validate,
        # declared `periodic` (the record is rebuilt when the chart is opened and it is old); every read is `historical`
        freshness="periodic", owner="terminal-data", max_symbols=ONE_SYMBOL, model_isolated=True,
        description="One stock's splits and cash dividends as UCT holds them beside its chart: splits back 45 years "
                    "and cash dividends back 5 years by ex-date, each block newest first with its own count and newest "
                    "date; dividend amounts split-adjusted. The name and ticker record is left out. Only the record "
                    "the server already holds, never a vendor request ('not held' otherwise); as_of is the newest "
                    "event, never the time of the read. Shown to the member only. "
                    f"Params: {{symbol, rows (1-{corporate_actions_read.MAX_ROWS} per block)}}.",
    ))
    registry.register(Kind(
        name=ipo_calendar_read.KIND, fn=ipo_calendar_read.read_ipos, validate=ipo_calendar_read.validate,
        # declared `periodic` (one range is held for at most six hours); every read is `periodic`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="The IPO calendar for the IPO panel's window (last week's Monday to next week's Friday) as UCT "
                    "holds it, merged from two vendor calendars: each deal's day, company, symbol, exchange, price or "
                    "range, shares, value and status, today and ahead soonest first, earlier newest first. Only the "
                    "calendar the server already holds, never a vendor request ('not held' otherwise); the calendars "
                    "carry no as-of, so as_of is null and the time UCT read them rides beside it, never the time of "
                    f"the read. Shown to the member only. Params: {{rows (1-{ipo_calendar_read.MAX_ROWS})}}.",
    ))
    registry.register(Kind(
        name=dividends_calendar_read.KIND, fn=dividends_calendar_read.read_dividends,
        validate=dividends_calendar_read.validate,
        # declared `periodic` (one stock's answer is held for at most twelve hours); every read is `periodic`
        freshness="periodic", owner="terminal-data", max_symbols=dividends_calendar_read.MAX_SYMBOLS,
        model_isolated=True,
        description="The dividends and splits declared ahead for the stocks named, one stock at a time as UCT holds "
                    "them: each stock's next ex-dividend date with the cash amount as declared, and every split ahead, "
                    "soonest first. Never the member's own lists. Only what the server already holds, never a vendor "
                    "request ('not held' otherwise, per stock); a forward calendar carries no as-of, so as_of is null "
                    "and the time UCT read each stock rides beside it, never the time of the read. Shown to the member "
                    f"only. Params: {{symbols (1-{dividends_calendar_read.MAX_SYMBOLS} tickers)}}.",
    ))
    # Terminal data wave 9 (owner: terminal-data): three more kinds, the Agent half of the AUCT panel, the real-yield block
    # of RATES and the FED panel. Default OFF like every kind (UCT_AGENT_DATA_KINDS); ALL THREE are model-isolated, so each
    # also needs its own UCT_AGENT_ISOLATED_KINDS entry (ADR-005) and its capability is local-only. None asks a source:
    # where the member route can (each service's background build; the Fed watch's rates through the economics store's
    # published files), the adapter reads the held-only reader beside the service and answers `unavailable`, with the
    # reason, when nothing is held (MD-1 §4.18).
    registry.register(Kind(
        name=treasury_auctions_read.KIND, fn=treasury_auctions_read.read_auctions, validate=treasury_auctions_read.validate,
        # declared `periodic` (the records are looked for once each weekday evening); every read is `periodic`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="US Treasury auctions as UCT holds them from the Treasury's Fiscal Data service: the auctions coming "
                    "up (security, auction day, issue day, amount offered), soonest first, and the results of the last 45 "
                    "days (high yield, rate or discount margin, bid-to-cover, the award split between primary dealers, "
                    "direct and indirect bidders), newest first. Only the answer the server already holds, never a build "
                    "or a request ('not held' otherwise); as_of is the newest record's date, never the time of the read. "
                    f"Shown to the member only. Params: {{rows (1-{treasury_auctions_read.MAX_ROWS} per list)}}.",
    ))
    registry.register(Kind(
        name=real_yields_read.KIND, fn=real_yields_read.read_real, validate=real_yields_read.validate,
        # declared `periodic` (the curve is looked for each weekday evening); every read is `historical`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="US Treasury daily par real yields (TIPS, 5 to 30 years) as UCT holds them: each real yield with its "
                    "1-day and 1-week change in basis points, and the breakeven at each maturity (nominal minus real on "
                    "the newest day both curves hold, worked out by the server, with its own date). Only the block the "
                    "server already holds, never a build or a request ('not held' otherwise); as_of is the real curve's "
                    "own date, never the time of the read. Shown to the member only. Params: {}.",
    ))
    registry.register(Kind(
        name=fed_watch_read.KIND, fn=fed_watch_read.read_fed_watch, validate=fed_watch_read.validate,
        # declared `periodic` (the Board's feeds are looked for on a schedule); every read is `periodic`
        freshness="periodic", owner="terminal-data", max_symbols=NO_SYMBOL, model_isolated=True,
        description="The Fed watch as UCT holds it, seven blocks each with its own state, source and date: the newest "
                    "FOMC statement with the added and removed word counts and the passages that changed, Fed speeches "
                    "and testimony, Fed headlines from the news wire with the time UCT received each, the next FOMC "
                    "decision, the federal funds rates, the officials' median rate projections and the New York Fed "
                    "survey's median path. Only what the server already holds, never a build or a request (a block not "
                    "held is said); as_of is null and each block carries its own date, never the time of the read. Shown "
                    f"to the member only. Params: {{rows (1-{fed_watch_read.MAX_ROWS} per list)}}.",
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
