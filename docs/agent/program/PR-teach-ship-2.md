# teach-ship-2: walkthrough lifecycle

Base: ship-1. Stack position: 2 of 5. Local only; not pushed.

Stacking: this slice stacks on teach-ship-1's tested code head `d10ae09c24`, not on its doc commit, so `PR-teach-ship-1.md` is absent from this slice on purpose. The stack is not broken.

## Behaviour changes
- **A pressed control finishes its step** even when it stays on screen, so no ring is left behind (pl-auto howto-10).
- **The card is never placed under the member's pointer**, so it can't close a hover menu (Layouts ▾ → Multi Chart).
- **P1 stale ring:** when the walkthrough's chart closes, nothing on another chart stands in for it. The walkthrough pauses and says so.
- **P2 gear advance:** another chart's settings window never advances this chart's step.
- **A new request ends the walkthrough:** the Send button, and Enter through `useAgent.send()` calling `guideStore.endForNewRequest()`.
- **Escape on the board ends it:** `agent.guideEscapeBoard`, a window-capture registry binding that never prevents or stops the key. It stands down for a field, a layer, a menu, an armed drawing tool or a selected drawing.
- **Owner decision: pressing another chart ends the walkthrough.** A board chart or a Multi Chart cell ends it cleanly, with no restart. Its own chart, the card, portalled menus and non-chart widgets do not end it.
- **Owner rule: the chart's symbol changing from outside ends it.** For example, a linked watchlist row loading into it. The symbol search is the exception.

## Touches deixis / useAgent / runtime / host
**Yes.**
- `useAgent.js`: +4 lines, `endForNewRequest()` in `send()`.
- `pages/command/shortcutRegistry.js`: +14 lines, one declaration plus its overlap acknowledgments.
- keyListenerCensus counts are unchanged for every touched file.

## Notes
- `f72e5a1e56` was split by file: its lifecycle part is here, its "the other chart" part is in ship-3.
- `90c65b6eb5`'s runner-file hunks are in ship-5.
