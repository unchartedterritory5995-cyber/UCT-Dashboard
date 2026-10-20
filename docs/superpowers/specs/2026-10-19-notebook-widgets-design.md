# Notebook widgets: design (2026-10-20)

Status: DRAFT for owner review. Nothing is built.
Mockups: `docs/notebook/mockups/2026-10-20-notebook-widgets.html` (static, sample data).
Brainstorm record: `docs/superpowers/specs/2026-10-19-notebook-widgets-brainstorm-notes.md`.

This rebuilds a plan that was lost in a box crash on 2026-10-19. The owner chose to skip the remaining questions ("just do it all locally and i will take a look"), so anything below marked **(Claude's call)** is a guess the owner has not confirmed.

## 1. Intent

The owner, in their own words:
- "useful widgets to add information and data that we have access to that someone might want to use"
- "something smooth and easy so folks can input stuff easily like charts and idk anything cool"
- "think about templates and what a trader would want to journal about"
- "also maybe some account stuff, group stuff, market context things like that"
- "less exposure score and more individualized stuff"
- "ideally they would have their broker linked to the journal which makes it way easier"

The goal: when a member writes in the Notebook, the data the app already holds about *their* names, *their* trades and *their* rules is one keystroke away and lands in the note already filled in.

## 2. Goals, non-goals, anti-goals

**Goals**
- G1. Every widget can be inserted from inside a note by typing `/`, without a trip through another page's "Send to Journal".
- G2. Widgets are about the member: their watchlists, positions, trades, rules and mistakes. Market data is framed by how it touches their names.
- G3. Trading widgets read broker-linked data first and manual/CSV trades second, and every number says where it came from.
- G4. A widget reads correctly when the note is reopened next month.
- G5. Starter styles can ship with widgets already placed and auto-filled (wave 3).

**Non-goals**
- Exposure scores, regime gauges, or any widget whose main output is a market-wide score.
- New data sources or vendors. Every widget reads data the app already computes.
- Broker order or stop import (SnapTrade does not supply stops; see §6).

**Anti-goals (failure even if it technically works)**
- A private account number (P&L, positions, size, rules, mistakes) showing up in a shared, published or gallery note.
- A widget that shows a made-up stop, a made-up estimate, or a number with no stated source.
- A widget that blows the Notebook's first-open byte budget or imports the chart engine statically.
- A widget that renders "0" or blank when the real answer is "we don't have this data".

## 3. Decisions

### Owner-decided
- Individualized widgets over market scores.
- Broker-linked data first.
- Smooth, easy insertion.

### Claude's calls (unconfirmed)
- C1. **Snapshot by default.** A widget freezes its data at insert time and stores it in the note, with an "as of" stamp and a **See it now** button that refreshes it in place. The existing live chart embed keeps its current behaviour. Reason: G4, and journals are records.
- C2. **Account widgets are private.** They never render in shared/published/gallery views; the reader sees a neutral placeholder. Each new kind gets a `private` row in `public_note_payload.py`, which already handles today's member-data embeds.
- C3. **The `/` menu is grouped by moment**: Before the open · Planning a trade · Reviewing · (existing kinds under "More").
- C4. **`$TICKER` becomes an inline chip** with a hover/tap card (price, 10/50-day, earnings date + expected move, today's options flow ratio, and the member's own history with the name). The card can insert a chart or a full ticker-card widget.
- C5. Without a linked broker, account widgets read manual/CSV trades and say so in their source line. They do not hide.
- C6. Wave order is §5.
- C7. **Snapshot storage is the existing payload-freeze regime**: the frozen data lives in `attrs.params`, with a `plainText` line and a passing `reconstructable`, exactly like today's captures. No new attr and no new node type, so no never-revert schema change.
- C8. **A `/` insert is a fetch-and-freeze builder**, one per new kind: on pick it fetches, freezes into `params`, and inserts. That is what lets a slash command supply the payload `registry.js` says a slash command cannot.
- C9. **Existing kinds stay where they are in wave 1.** Calendar, watchlist, themes and the rest keep arriving through Send to Journal. Giving each a fetch-and-freeze builder is ~11 separate paths and is deferred (wave 4, unscheduled). The `captureOnly` kinds (screener, cot, modelbook) stay capture-only, and the registry invariant that refuses them in a menu stands.
- C10. **Release gate is a server `notebook_*` flag on the auth payload**, one per wave (unset = OFF), read per request like the other Notebook gates. It gates the `/` menu entries only. A widget already stored in a note always renders, with the gate off too; every kind stays registered.
- C11. **Public views: every new kind is neutral.** Each gets a `MARKET_DATA_VENDORS` row (`private` for account kinds; `massive`/`mixed` for the rest), all of which reduce to neutral. No archived PNG is produced. `tickerCard` is neutral as a whole. Account kinds get their own neutral line, "A private account item is not shown on public pages."; market kinds keep the existing line.
- C12. **`$TICKER` is an editor decoration, not a node or mark.** The text stays plain `$NVDA`; a ProseMirror decoration draws the chip and opens the card. No schema change. In shared, published and gallery views it renders as plain text, so the member's history never reaches a stranger.
- C13. **"Add" on a no-stop position deep-links** to that position in the Journal's positions tab. It never writes `j2_positions` from inside a note.
- C14. **`/` grouping**: the existing Trading group splits into three: Before the open · Planning a trade · Reviewing. Basics and More are unchanged, and existing trading items go in whichever group fits.
- C15. **Starter styles (wave 3)** fill their widgets at apply time, through the same fetch-and-freeze builders. A gallery template ships the widget shells empty, and they render neutral in gallery mode anyway.

## 4. The widgets

Every widget has: a header (name, snapshot chip or 🔒 Only you, as-of stamp, See it now), a body, and a source line.

| Kind (working id) | Shows | Reads (existing) | Private | Wave |
|---|---|---|---|---|
| `myWatchlistToday` | Member's names: pre-market/today %, rel. volume, news count, earnings flag, near-52w-high | watchlists + live prices + news + calendar | no | 1 |
| `myNamesReporting` | Earnings this week/next for names on watchlists or in positions, with expected move | calendar enrichment (`get_implied_move`) + my-sets | no | 1 |
| `tickerCard` | Inline `$TICKER` chip + card; full-card widget form | ticker meta, bars (10/50), calendar, flow summary, J2 trades/notes for that symbol | own-history rows only | 1 |
| `myPnlStats` | Closed P&L, win rate, avg R, trade count, equity line for a date range | `/api/j2/analytics`, `/broker/equity-curve` | yes | 1 |
| `myPositionsRisk` | Open positions: size % of account, open P&L, stop + distance; "No stop set" + link to the position | `/api/portfolio/heat` `per_position` (stop_price, dist_to_stop_pct, placeholder_stop) joined with J2 open positions + live prices for size % and open P&L (heat carries neither) | yes | 1 |
| `myRulesCheck` | Rules kept / total over a range | `j2_trade_adherence` (needs an over-time read, §6) | yes | 2 |
| `myMistakes` | Mistake, cost over 30 days, more/less often | `costOfMistakes.byMistake` (needs a trend read, §6) | yes | 2 |
| `marketOnMyNames` | Each of the member's names vs its sector over 5 days | RS / sector data, theme taxonomy | no | 3 |
| `tickerFlow` | Options flow summary for one name | flow proxy reads | no | 3 |

Existing kinds are NOT added to `/` in wave 1 (C9).

## 5. Waves

- **Wave 1.** The regrouped `/` menu (C14) with the new kinds, the fetch-and-freeze builders (C8), the snapshot/See-it-now frame shared by every new widget, `tickerCard` + `$TICKER` chip, `myWatchlistToday`, `myNamesReporting`, `myPnlStats`, `myPositionsRisk`, and the private rows.
- **Wave 2.** `myRulesCheck`, `myMistakes`, plus their two server reads.
- **Wave 3.** `marketOnMyNames`, `tickerFlow`, and starter styles shipping with widgets pre-placed (Morning prep: watchlist today + names reporting; Weekly review: P&L + positions + rules + mistakes).

Each wave ships dark behind one Notebook flag and gets armed separately.

## 6. Constraints

- **Bytes.** First-open closure is 2,243,289 B against a 2,260,793 B budget (17,504 B headroom, `docs/notebook/perf-budgets.json`). Every widget body is a lazy chunk. Only the menu entries and the snapshot frame's small shell may be in first-open. Never import the chart engine statically. The budget is not raised to fit.
- **Adding a kind touches:** `widgets/registry.js` (PANEL_MANIFESTS; respect `registerPanel`'s captureOnly refusal), `WidgetEmbedView.jsx` EMBED_COMPONENTS, the `MARKET_DATA_VENDORS` row in `public_note_payload.py` (keyed on `widgetId`), `SlashMenu.jsx` (`SLASH_GROUPS`, `groupedSlashItems`) / `WidgetPalette.jsx`, the plain-text parity fixture, and the rails. All new kinds are embeds; none is a trader block.
- **Schema.** No schema change (C7, C12). If a builder finds it needs a new attr or node type, stop: that is a never-revert change in both `lib/notebookSchema.js` and `notebook_schema.py` (the wave 5/6 rule) and comes back to the owner.
- **Body caps.** Frozen `params` must stay under the body depth and size caps from #203 and pass the unbuildable-body refusal at create and import. The PUT save path does not run that refusal yet, so the builder caps each payload itself.
- **Stops.** Broker imports store `stop_price = entry_price` as a placeholder. `myPositionsRisk` must detect it (reuse `portfolio_heat`'s detection) and show "No stop set", never a 0% distance.
- **P&L sources.** Closed P&L comes from broker fills. Intraday open marks come from vendor prices, and broker marks win after the close. The source line must say which.
- **Missing server reads.** Rules adherence over time and mistakes trend do not exist yet. Wave 2 adds them under `/api/j2/`.
- **Writes.** "See it now" rewrites a node, so it is a note write and must go through the existing settle path (`settleNoteWrite` / the door ledger). Five of six earlier doors forked notes by skipping this.
- **Paid gating.** Widgets inherit the Notebook's paid gate. Tier-gated data (dealer levels) is out of scope.
- **Offline.** A snapshot widget renders from its stored data with no network. See it now is disabled offline with a reason.

## 7. Left to the builder

- Exact snapshot payload shape per kind, and its size cap.
- Menu ordering within a group, icons (UIcon names, no emoji), and copy.
- Whether `myWatchlistToday` lets the member pick which watchlist (default: the first non-flagged list, then flagged).
- Date-range picker form for the account widgets (default: this week for review notes, today otherwise).
- How the `$TICKER` chip is detected while typing (input rule vs. paste) and how it avoids real-ticker false positives (RS/EMA/MA/GAP/PEG are real tickers, so require the `$`).
- Test shape, following the repo's rails (render-text assertions for user-facing copy, reachability rail, privacy rail per kind).

## 8. Open questions for the owner

The ones that change what gets built:
1. Is snapshot-by-default right, or should widgets stay live?
2. Should account widgets ever be shareable (e.g. to a group you're in)? Today's answer (C2/C11) is never.
3. Is the wave order right, and is it OK that the existing kinds (calendar, watchlist, themes...) stay Send-to-Journal-only for now (C9)?

## 9. Builder check (2026-10-20)

A fresh reviewer read this doc against the code. Everything it raised is settled above as C7–C15, plus the `myPositionsRisk` data join. It also corrected one wrong claim: there is no `BlockNodeView.jsx`, `BLOCK_KINDS` or block router enum, so the block recipe was removed (every new kind is an embed). It confirmed `EMBED_COMPONENTS`, `settleNoteWrite`, `/api/portfolio/heat`, `get_implied_move`, `j2_trade_adherence`, `costOfMistakes`, `/broker/equity-curve`, the perf budget figure and the lazy-leaf pattern.
