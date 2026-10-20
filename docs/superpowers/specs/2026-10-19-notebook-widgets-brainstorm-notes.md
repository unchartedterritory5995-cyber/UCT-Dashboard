# Notebook widgets: brainstorm notes (WIP, 2026-10-19)

Rebuild of a plan lost in a box crash on 2026-10-19. Not a design yet.

## Owner, in their words
- "useful widgets to add information and data that we have access to that someone might want to use"
- "something smooth and easy so folks can input stuff easily like charts and idk anything cool"

## Recon (master 4153258a95 + PR #432)
- Embeds are listed in `app/src/widgets/registry.js` (PANEL_MANIFESTS) and bound in `WidgetEmbedView.jsx` EMBED_COMPONENTS. Trader blocks are bound in `blocks/BlockNodeView.jsx`.
- Kinds today: chart (the only live-capable one), calendar, watchlist, themes, scanner, fundamentals, breadth, indexes (unreleased), marketcontext, aisearch, news, alerts, screener, cot, modelbook. Trader blocks: preEntryChecklist, priceStamps, positionSizing, myRules, prepWire, prepEarnings, prepMovers, prepLevels, tradeReview, moodCheckIn. Facts: /price, /consensus, /plan.
- **Key friction:** from inside a note, only chart and market context can be typed (slash). Every other kind arrives through "Send to Journal" from its own page.
- Registered with no Notebook binding: optionsflow, nhnl, nhnlPulse, volumescan, scatter, profile, periodsort.
- Data not in the Notebook yet: earnings expected move/reaction, UCT20/leadership, catalysts by date, ticker options flow, NH/NL, volume surge, candle patterns, dealer levels/GEX (tier-gated), sector/theme rotation, scanner candidates, Desk clips for a ticker.
- Avoid: econ calendar (off), trader ledger (paid + flags), morning wire (paid).
- A new kind touches: registry, host binding, (blocks) BLOCK_KINDS on both sides + the router enum, the MARKET_DATA_VENDORS sharing row, the entry point, the plain-text parity fixture, and the rails. Bodies must be lazy chunks; first-open headroom is ~17.5 KB after #432.

## Open questions
- Live or frozen snapshot when a widget is inserted?

## Round 2 (owner)
- Owner on live vs snapshot: "idk" -> proposed SNAPSHOT by default + "see it now" (Claude's call, not agreed yet).
- Owner: "think about templates and what a trader would want to journal about" -> proposed widgets grouped by moment (prep / plan a trade / review / end of day / weekly), a `$TICKER` card, and starter packs/styles shipping with widgets pre-placed + auto-filled.
- Owner: "also maybe some account stuff, group stuff, market context things like that"
- Owner: "less exposure score and more individualized stuff" -> direction: center widgets on the MEMBER's own data (their names, trades, stats, rules); market context reframed as how the market touches *their* names. Sharing rule for account widgets: Claude's default = never in anything published (not yet confirmed).
- Owner: "ideally they would have their broker linked to the journal which makes it way easier" -> trading widgets should read broker-linked data first, manual logs second.

## Recon 2: broker linking (master b24c2ec68a)
- One member provider: **SnapTrade** (aggregator; the broker is picked in SnapTrade's portal). Paid plans only (pro/premium/lifetime). Scheduler behind `BROKER_SYNC_ENABLED`. Link at Settings > Brokerage Connections or Journal > Accounts. CSV import covers Schwab/IBKR/E*Trade/TradeZella/TraderSync/TraderVue. Manual entry also works.
- Fills -> FIFO reconstruction -> the same `j2_trades`/`j2_positions` (`source='broker'`, stable `trade_ref`). Freshness: webhook, a 5-min orders poll in RTH, a daily sync, a nightly reconcile, and a manual sync (180 s cooldown).
- Closed P&L/R come from broker fills. Open marks intraday come from live vendor prices (the broker's are the previous close); after the close the broker marks win. The headline anchors on broker equity.
- **Stops do NOT come from the broker** (`stop_price = entry_price` placeholder). Risk is only as good as stops entered by hand.
- Reusable: `GET /api/j2/analytics` (equity, bySetup win rate / avg R / expectancy, costOfMistakes.byMistake, rolling win rate, exit quality), `/accounts/{id}/setup-stats`, `/discipline/*`, `/broker/equity-curve`, `/broker/performance`, `/api/portfolio/heat`, `/broker/trust`. Components: BrokerAccountHero, BrokerEquityCurve, AnalyticsTab sections.
- Notes already link to trades: the `tradeReview` block (tradeRef), `j2_trade_adherence`, `j2_trade_plan_links`.
- Privacy is already built: member-data embeds are classed "private" in `public_note_payload.py` and render neutral when shared. **New account widgets must get a "private" row.**
- Missing: broker stops/open orders, an adherence-over-time endpoint, a mistakes-trend endpoint for J2, one server P&L read that names its source.
