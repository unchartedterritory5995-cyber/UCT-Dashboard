# Notebook widgets: design (2026-10-20)

Status: APPROVED by the owner 2026-10-20 ("yes it should freeze data, and yes anything the user wants should be shareable. Lets do it all").
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
- **Snapshot by default (C1), confirmed 2026-10-20.**
- **Anything the member wants is shareable (2026-10-20).** This replaces "account widgets are never shared"; see C2/C11 as revised.
- **Do it all (2026-10-20):** waves 1-3, plus the existing kinds in `/` (wave 4, now scheduled).
- **"You decide it all and get it all done fully" (2026-10-20)**, plus: customizable presets ("a customized preset of a set of charts, groups etc") and any other valuable widgets. Waves 5-6 below are Claude's picks under that grant.
- Broker-linked data first.
- Smooth, easy insertion.

### Claude's calls (unconfirmed)
- C1. **Snapshot by default.** A widget freezes its data at insert time and stores it in the note, with an "as of" stamp and a **See it now** button that refreshes it in place. The existing live chart embed keeps its current behaviour. Reason: G4, and journals are records.
- C2. **Account widgets are private by default, shareable by choice (revised per owner).** Each account widget's header carries a **Show on shared pages** switch, off by default, stored as `params.share: true` inside the frozen payload (no schema change). Off: the reader sees the account neutral line. On: share links and published pages show the **frozen snapshot only** (never a live refetch, never trade ids, notes text or links into the app), through a per-kind public param allowlist. Gallery templates stay neutral whatever the switch says (a template is a scaffold, not the author's page).
- C3. **The `/` menu is grouped by moment**: Before the open · Planning a trade · Reviewing · (existing kinds under "More").
- C4. **`$TICKER` becomes an inline chip** with a hover/tap card (price, 10/50-day, earnings date + expected move, today's options flow ratio, and the member's own history with the name). The card can insert a chart or a full ticker-card widget.
- C5. Without a linked broker, account widgets read manual/CSV trades and say so in their source line. They do not hide.
- C6. Wave order is §5.
- C7. **Snapshot storage is the existing payload-freeze regime**: the frozen data lives in `attrs.params`, with a `plainText` line and a passing `reconstructable`, exactly like today's captures. No new attr and no new node type, so no never-revert schema change.
- C8. **A `/` insert is a fetch-and-freeze builder**, one per new kind: on pick it fetches, freezes into `params`, and inserts. That is what lets a slash command supply the payload `registry.js` says a slash command cannot.
- C9. **Existing kinds stay where they are in waves 1-3; wave 4 brings them to `/` (owner: "do it all").** Calendar, watchlist, themes and the rest keep arriving through Send to Journal. Giving each a fetch-and-freeze builder is ~11 separate paths and is wave 4. The `captureOnly` kinds (screener, cot, modelbook) stay capture-only, and the registry invariant that refuses them in a menu stands.
- C10. **Release gate is a server `notebook_*` flag on the auth payload**, one per wave (unset = OFF), read per request like the other Notebook gates. It gates the `/` menu entries only. A widget already stored in a note always renders, with the gate off too; every kind stays registered.
- C11. **Public views (revised per owner).** Account kinds get a new vendor `member-optin`: SHOWN when `params.share === true`, else the account neutral line "A private account item is not shown on public pages." Market kinds (`myWatchlistToday`, `myNamesReporting`, `marketOnMyNames`, `tickerFlow`, the market half of `tickerCard`) keep their real vendor rows (`massive`/`mixed`) and stay neutral: that is the owner's 2026-09-25 legal sign-off in `VENDOR_VERDICT`, and loosening Massive is the one line `"massive": SHOWN` the owner can flip. The member's own-history rows of `tickerCard` follow the account switch.
- C12. **`$TICKER` is an editor decoration, not a node or mark.** The text stays plain `$NVDA`; a ProseMirror decoration draws the chip and opens the card. No schema change. In shared, published and gallery views it renders as plain text; a member who wants to share the card inserts it as a `tickerCard` widget and turns its switch on.
- C13. **"Add" on a no-stop position deep-links** to that position in the Journal's positions tab. It never writes `j2_positions` from inside a note.
- C14. **`/` grouping**: the existing Trading group splits into three: Before the open · Planning a trade · Reviewing. Basics and More are unchanged, and existing trading items go in whichever group fits.
- C15. **Starter styles (wave 3)** fill their widgets at apply time, through the same fetch-and-freeze builders. A gallery template ships the widget shells empty, and they render neutral in gallery mode anyway.

- C16. **Saved chart sets (wave 5).** A member names a set of symbols and timeframes ("Semis: NVDA AMD AVGO, D + 60m") and inserts it as a block of frozen charts with `/set <name>`. A set is a list of `{symbol, tf}` (max 12 charts), stored as one opaque user preference `notebook_chart_sets` (a `_PREF_OPAQUE` row), read-modify-write because the preferences endpoint replaces the whole value. Insertion reuses `chartInsertNodes`, so a set is N ordinary chart embeds, not a new kind. The member can also start a set from a watchlist or a theme.
- C17. **Saved widget presets (wave 5).** Any snapshot widget's settings (which list, date range, columns, sort) can be saved under a name ("Weekly review P&L", "Flagged only"), and `/` lists the member's presets under "My presets". Stored in the same preference as C16 under its own key. A preset stores settings only, never data; inserting one runs the normal fetch-and-freeze.
- C18. **Member-made note presets with live slots (wave 5).** "Save as preset" on a note records its text plus each snapshot widget as a slot (`{kind, params}`). Applying it refills every slot at apply time (the C15 path, opened up to members). It goes through the existing style library (P3a); a preset shared to the gallery ships its slots empty (C15).
- C19. **Six more widgets (wave 6).** Picked for the owner's "account stuff, group stuff, market context" and "individualized":
  - `tradeRecap`: one closed trade (entry, exit, R, setup, hold time, mistakes) with a small daily chart. Account kind.
  - `myPnlCalendar`: a month of daily P&L as a heat strip, with best and worst days. Account kind.
  - `mySetupEdge`: the member's own expectancy by setup (`personal_edge.edge_for_setups`), with thin samples labelled as thin. Account kind.
  - `myScreenToday`: today's hits for one of the member's saved screens, with the four-count coverage line (`/api/scans/definition-results`). Market kind.
  - `roomBuzzOnMyNames`: which of the member's names the community chat is talking about today (`buzz_store.board`), with mention counts. This is the group widget, and it stores no message text, like the board itself. Market kind (neutral publicly; mention counts are ours, but the rows sit beside prices).
  - `myEarningsReactions`: the member's names that reported this week, with EPS and revenue against estimate and the next-day move. Market kind.
- C20. **Considered and left out:** exposure gauges (owner: "less exposure score"); a live-updating ticker tape (it breaks the snapshot rule, and the Dashboard already has one); member-written formula widgets (another write surface needing its own review).

## 4. The widgets

Every widget has: a header (name, snapshot chip or 🔒 Only you, as-of stamp, See it now), a body, and a source line.

| Kind (working id) | Shows | Reads (existing) | Private (shareable by switch) | Wave |
|---|---|---|---|---|
| `myWatchlistToday` | Member's names: pre-market/today %, rel. volume, news count, earnings flag, near-52w-high | watchlists + live prices + news + calendar | no | 1 |
| `myNamesReporting` | Earnings this week/next for names on watchlists or in positions, with expected move | calendar enrichment (`get_implied_move`) + my-sets | no | 1 |
| `tickerCard` | Inline `$TICKER` chip + card; full-card widget form | ticker meta, bars (10/50), calendar, flow summary, J2 trades/notes for that symbol | own-history rows (shareable by switch) | 1 |
| `myPnlStats` | Closed P&L, win rate, avg R, trade count, equity line for a date range | `/api/j2/analytics`, `/broker/equity-curve` | yes | 1 |
| `myPositionsRisk` | Open positions: size % of account, open P&L, stop + distance; "No stop set" + link to the position | `/api/portfolio/heat` `per_position` (stop_price, dist_to_stop_pct, placeholder_stop) joined with J2 open positions + live prices for size % and open P&L (heat carries neither) | yes | 1 |
| `myRulesCheck` | Rules kept / total over a range | `j2_trade_adherence` (needs an over-time read, §6) | yes | 2 |
| `myMistakes` | Mistake, cost over 30 days, more/less often | `costOfMistakes.byMistake` (needs a trend read, §6) | yes | 2 |
| `marketOnMyNames` | Each of the member's names vs its sector over 5 days | RS / sector data, theme taxonomy | no | 3 |
| `tickerFlow` | Options flow summary for one name | flow proxy reads | no | 3 |

| `tradeRecap` | One closed trade: entry, exit, R, setup, hold, mistakes, mini chart | J2 trade by id + bars | yes | 6 |
| `myPnlCalendar` | Month of daily P&L as a heat strip, best/worst day | `/api/j2/analytics` performance by day | yes | 6 |
| `mySetupEdge` | Expectancy per setup, n per setup, thin-sample label | `personal_edge.edge_for_setups` | yes | 6 |
| `myScreenToday` | Today's hits for one saved screen + coverage counts | `/api/scans/definition-results` | no | 6 |
| `roomBuzzOnMyNames` | Member's names the chat is talking about today | `buzz_store.board` ∩ my-sets | no | 6 |
| `myEarningsReactions` | My names that reported: EPS/rev vs estimate, next-day move | `get_year_earnings` + bars | no | 6 |

Existing kinds are NOT added to `/` in wave 1 (C9). Saved chart sets (C16) are chart embeds, not a kind.

## 5. Waves

- **Wave 1.** The regrouped `/` menu (C14) with the new kinds, the fetch-and-freeze builders (C8), the snapshot/See-it-now frame shared by every new widget, `tickerCard` + `$TICKER` chip, `myWatchlistToday`, `myNamesReporting`, `myPnlStats`, `myPositionsRisk`, and the private rows.
- **Wave 2.** `myRulesCheck`, `myMistakes`, plus their two server reads.
- **Wave 1 also:** the Show-on-shared-pages switch and the `member-optin` public path (C2/C11).
- **Wave 3.** `marketOnMyNames`, `tickerFlow`, and starter styles shipping with widgets pre-placed (Morning prep: watchlist today + names reporting; Weekly review: P&L + positions + rules + mistakes).

- **Wave 4.** Fetch-and-freeze builders for the existing non-capture-only kinds (calendar, watchlist, themes, breadth, indexes, news, fundamentals, alerts, profile and the rest), so they join `/` under More. `captureOnly` kinds stay capture-only.

- **Wave 5 (make it yours).** Saved chart sets (C16), saved widget presets (C17), member note presets with live slots (C18).
- **Wave 6.** The six widgets in C19.

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

## 8. Owner answers (2026-10-20)

1. Snapshot by default: **yes**.
2. Account widgets shareable: **yes, anything the member wants** (C2/C11 revised to an opt-in switch, off by default).
3. Waves: **do it all**, waves 1-4; then waves 5-6 added under "you decide it all".

Still the owner's, not changed here: Massive-sourced market data stays neutral on public pages under the 2026-09-25 legal sign-off; flipping it is one line in `VENDOR_VERDICT`.

## 9. Builder check (2026-10-20)

A fresh reviewer read this doc against the code. Everything it raised is settled above as C7–C15, plus the `myPositionsRisk` data join. It also corrected one wrong claim: there is no `BlockNodeView.jsx`, `BLOCK_KINDS` or block router enum, so the block recipe was removed (every new kind is an embed). It confirmed `EMBED_COMPONENTS`, `settleNoteWrite`, `/api/portfolio/heat`, `get_implied_move`, `j2_trade_adherence`, `costOfMistakes`, `/broker/equity-curve`, the perf budget figure and the lazy-leaf pattern.
