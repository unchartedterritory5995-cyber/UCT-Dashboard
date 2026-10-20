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
