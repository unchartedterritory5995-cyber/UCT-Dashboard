# Notebook Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member types `/` in a note and gets a filled-in, frozen widget about their own names, trades and rules, with a "See it now" refresh and an opt-in switch to show it on shared pages.

**Architecture:** One server module composes data the app already computes into a capped, frozen payload for each widget kind (`GET /api/j2/notebook-widgets/{kind}`). The client inserts that payload as an ordinary `widgetEmbed` node (`attrs.params`, the payload-freeze regime the COT capture uses) through new slash items, and renders it with one lazy embed per kind that never fetches on open. Public views reduce each account kind to a neutral line unless the member switched `params.share` on. Market kinds stay under the owner's vendor table.

**Tech Stack:** React + TipTap (`app/src`), Vitest; FastAPI + sqlite (`api/`), pytest.

**Spec:** `docs/superpowers/specs/2026-10-19-notebook-widgets-design.md` (approved 2026-10-20). Mockups: `docs/notebook/mockups/2026-10-20-notebook-widgets.html`.

## Global Constraints

- No schema change. No new node, mark or attr, in either `lib/notebookSchema.js` or `notebook_schema.py`. If a task finds it needs one, it stops and comes back to the owner (never-revert rule).
- First-open bytes stay within budget: `python tools/notebook_perf_budgets.py --dist app/dist` must say `VERDICT: PASS` (budget 2,260,793 B, about 17.5 KB of headroom on 2026-10-19). The budget is never raised to fit. Every embed body is a `lazyLeaf(() => import(...))`. Nothing imports the chart engine statically.
- One release flag per wave, all OFF when unset: `NOTEBOOK_WIDGETS_W1_ENABLED`, `NOTEBOOK_WIDGETS_W2_ENABLED`, `NOTEBOOK_WIDGETS_W3_ENABLED`, `NOTEBOOK_WIDGETS_W4_ENABLED`, `NOTEBOOK_WIDGETS_W5_ENABLED`, `NOTEBOOK_WIDGETS_W6_ENABLED`. Each is read per request. Payload keys are derived lowercase (`notebook_widgets_w1_enabled`, and so on). A flag gates the menu entries and the server reads only. A stored widget always renders.
- Each new router defines its own `require_paid` with its own sentence: `"Notebook widgets require a paid plan"`.
- Payload cap: `PAYLOAD_CAP_BYTES = 16384` (compact JSON) and `ROW_CAP = 40`. Rows beyond the cap are dropped, and the count dropped is kept as `truncated: <n>`.
- Every payload carries `asOf` (ISO UTC) and `source`, one of `"broker" | "manual" | "mixed" | "market"`. Every figure that is unknown is `null`. The UI shows `null` as "n/a" with a reason in its `title`, never `0` and never a blank cell.
- Stops: a placeholder stop (`api/services/placeholder_stop.is_placeholder_stop`) shows "No stop set" plus the link "Set it in Journal". It never shows a 0% distance.
- See it now and the share switch are editor transactions (`updateAttributes`), saved by the editor's own save path. Neither one issues a PUT or PATCH of its own. Offline, See it now is disabled with the title "You're offline. This shows the saved snapshot."
- Account neutral line, verbatim: `A private account item is not shown on public pages.` Market kinds keep `NEUTRAL_LINE`.
- `VENDOR_VERDICT` is not edited. Massive stays `NEUTRAL` (the owner's 2026-09-25 legal sign-off).
- Copy: plain words, UIcon names, no emoji. Commits use `git commit -F - <<'MSG'` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push after every task.

## Review Focus

1. **A member with no linked broker and no trades.** Account widgets render a sentence ("No closed trades in this range yet."), not zeros. Owned by Tasks 3 and 9.
2. **A note shared before the member switches sharing on, then re-shared after.** The public payload follows the CURRENT `params.share` on every read, and switching it off hides the widget again. Owned by Task 5.
3. **A frozen payload from last month opened today.** It renders from `params` with no request, and it shows the old `asOf`. Owned by Task 7 (the no-fetch rail).
4. **`$` text that is not a ticker** (`$5`, `$$`, `US$`, `$nvda` lowercase, text inside a code mark or code block). No chip. Owned by Task 10.
5. **See it now fails** (server 5xx, gate turned off since insert, or offline). The old snapshot stays exactly as it was, and a short reason shows. Owned by Task 7.

---

## Wave 1

### Task 1: Release flags for all six waves

**Files:**
- Modify: `api/routers/auth.py` (the `NOTEBOOK_FLAGS` table, about line 145)
- Modify: `docs/feature_flags.json` (one row per flag, same shape as `NOTEBOOK_CHART_PLAN_ENABLED`)
- Create: `app/src/pages/journal-2-0/lib/notebookWidgetsFlags.js`
- Test: `tests/test_notebook_flags.py`, `tests/test_notebook_flag_table_form.py` (existing derived rails), `app/src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js`

**Interfaces:**
- Produces: `widgetsWaveOn(wave: 1|2|3|4|5|6) -> boolean` (client), reading `notebookFlag('notebook_widgets_w<wave>_enabled') === true`. Server: `notebook_widgets_wave_on(wave: int) -> bool` in `api/services/journal_two/notebook_widgets.py` (Task 2), via `flag_on('NOTEBOOK_WIDGETS_W<n>_ENABLED', False)`.

- [ ] **Step 1:** Add the six rows to `NOTEBOOK_FLAGS`, each `False` and each with a one-line comment in the house style, plus the six `docs/feature_flags.json` rows (status `dark`, the note naming this plan).
- [ ] **Step 2:** Run `pytest tests/test_notebook_flags.py tests/test_notebook_flag_table_form.py tests/test_notebook_flag_parse.py -q`. Expected: PASS. These rails derive from the table, so a missing ledger row fails here by name.
- [ ] **Step 3:** Write `notebookWidgetsFlags.test.js`: `widgetsWaveOn(1)` is false with no latch, true once `notebook_widgets_w1_enabled: true` is latched, and `widgetsWaveOn(2)` stays false then. Use the latch helper the `chartPlanEnabled` tests use.
- [ ] **Step 4:** Implement `widgetsWaveOn`, then run `npx vitest run src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): dark release flags for notebook widgets waves 1-4`.

### Task 2: Server payload builder: shared shell and the two market kinds

**Files:**
- Create: `api/services/journal_two/notebook_widgets.py`
- Test: `tests/test_notebook_widgets_service.py`

**Interfaces:**
- Consumes: `earnings_prep._member_sets(user_id) -> {SYM: [source]}`, `earnings_prep.reporting_soon(user_id, today=)`, `api.routers.live_prices.get_live_prices(tickers=",".join(...))` (row keys `price`, `change_pct`), `earnings_enrichment.get_implied_move(sym, earnings_date)`.
- Produces:
  - `KIND_WAVE: dict[str, int]`, all fifteen kinds: `myWatchlistToday:1, myNamesReporting:1, tickerCard:1, myPnlStats:1, myPositionsRisk:1, myRulesCheck:2, myMistakes:2, marketOnMyNames:3, tickerFlow:3, tradeRecap:6, myPnlCalendar:6, mySetupEdge:6, myScreenToday:6, roomBuzzOnMyNames:6, myEarningsReactions:6`.
  - `ACCOUNT_KINDS = frozenset({"myPnlStats", "myPositionsRisk", "myRulesCheck", "myMistakes", "tradeRecap", "myPnlCalendar", "mySetupEdge"})`.
  - `class WidgetRequestError(ValueError)`.
  - `build(kind: str, user_id: str, params: dict, *, now: datetime | None = None) -> dict`, which raises `WidgetRequestError` for an unknown kind or bad params.
  - `cap_payload(payload: dict) -> dict`.
  - `notebook_widgets_wave_on(wave: int) -> bool`.
  - Builders: `_my_watchlist_today(user_id, params, now)` and `_my_names_reporting(user_id, params, now)`.

Payload shapes (the keys are fixed, later tasks read them):
- `myWatchlistToday`: `{"asOf", "source": "market", "listLabel": "Watchlist"|"Flagged", "rows": [{"symbol", "price", "changePct", "earningsDay"}], "truncated"?}`. Symbols come from the `watchlist` set, then `flagged`, deduped and sorted. Prices come from one batched `get_live_prices` call. `earningsDay` comes from the `reporting_soon` window, or `null`. `params.list` may be `"watchlist"` or `"flagged"`; the default is `"watchlist"` when that set is non-empty, else `"flagged"`. Relative volume, news count and near-52-week-high are NOT in wave 1: no server reader returns them today, and an always-null column breaks the no-blank rule.
- `myNamesReporting`: `{"asOf", "source": "market", "rows": [{"symbol", "day", "timing", "daysAway", "sources", "impliedMovePct"}], "partial"}`. These are `reporting_soon` items, each with `get_implied_move` (or `null`).

- [ ] **Step 1: Write the failing tests.** Inject fakes by monkeypatching the module's consumed functions:
  - `test_unknown_kind_raises`
  - `test_watchlist_rows_sorted_and_capped`: 45 symbols give 40 rows and `truncated == 5`.
  - `test_watchlist_price_missing_is_null_not_zero`: `get_live_prices` returns no row for `AMD`, so `price is None` and `changePct is None`.
  - `test_watchlist_defaults_to_flagged_when_watchlist_empty`: `listLabel == "Flagged"`.
  - `test_reporting_rows_carry_implied_move_or_null`
  - `test_cap_payload_under_16384_bytes`: a payload whose rows are each 1 KB comes back under `PAYLOAD_CAP_BYTES` with `truncated > 0`.
  - `test_every_payload_has_asOf_and_source`
- [ ] **Step 2:** Run `pytest tests/test_notebook_widgets_service.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the shell and the two builders. `build` dispatches through a `_BUILDERS` dict and calls `cap_payload` last. `cap_payload` drops rows from the end until `len(json.dumps(p, separators=(",", ":"))) <= PAYLOAD_CAP_BYTES`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): widget payload builder, watchlist today + names reporting`.

### Task 3: Server builders for the account kinds and the ticker card

**Files:**
- Modify: `api/services/journal_two/notebook_widgets.py`
- Test: `tests/test_notebook_widgets_service.py`

**Interfaces:**
- Consumes: `analytics.get_analytics(user_id, date_from=, date_to=)`, `portfolio_heat.portfolio_heat(user_id)` (`per_position` keys: `symbol, side, dist_to_stop_pct, risk_pct, stop_price, risk_dollars, placeholder_stop`), `positions.list_open_positions(user_id)`, `get_live_prices`, the per-symbol J2 trade read the ticker detail uses (`trades.list_trades_for_user(user_id, symbol=...)`; confirm the name with grep before use).
- Produces these payload shapes:
  - `myPnlStats`: `{"asOf", "source", "range": {"from", "to"}, "netPnl", "winRate", "avgR", "tradeCount", "equity": [[day, value], ...]}`. `equity` has at most 60 points, downsampled by even stride. `params.from`/`params.to` are ISO days; the default is Monday of this ET week through today. `tradeCount == 0` gives `netPnl/winRate/avgR = None` and `"empty": "No closed trades in this range yet."`.
  - `myPositionsRisk`: `{"asOf", "source", "accountSize", "rows": [{"positionId", "symbol", "side", "sizePct", "openPnl", "stopPrice", "distToStopPct", "noStop"}], "empty"?}`. The join key is `symbol` plus `side`. `sizePct = qty * price / accountSize * 100` (`None` without an account size or a price). `openPnl` uses the live price (sign by side). With `noStop = placeholder_stop`, `stopPrice` and `distToStopPct` are `None`. No open positions gives `"empty": "No open positions."`.
  - `tickerCard`: `{"asOf", "source": "mixed", "symbol", "price", "changePct", "ma10", "ma50", "earningsDay", "impliedMovePct", "history": {"trades", "winRate", "netPnl"} | None}`. `params.symbol` is required and must match `^[A-Z][A-Z.\-]{0,9}$`, else `WidgetRequestError`. `history` is `None` when the member has no trades in it. The 10/50-day averages come from the server's daily-bars reader that the ticker modal uses (confirm with `grep -rn "sma\|moving_average" api/services/research/snapshot.py`). If none returns them, the fields are `null`.
- `source` for the account kinds: `"broker"` when every row's trade has a broker origin, `"manual"` when none does, else `"mixed"`.

- [ ] **Step 1: Write the failing tests:**
  - `test_pnl_empty_range_says_so`: no trades gives `empty == "No closed trades in this range yet."` and `netPnl is None`.
  - `test_pnl_equity_downsampled_to_60`
  - `test_pnl_source_mixed_when_broker_and_manual`
  - `test_positions_placeholder_stop_is_no_stop`: `stop_price == entry` gives `noStop is True` and `distToStopPct is None`.
  - `test_positions_size_pct_null_without_account_size`
  - `test_positions_open_pnl_short_sign`
  - `test_ticker_card_bad_symbol_raises`: `"nvda!"`.
  - `test_ticker_card_history_none_without_trades`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the three builders.
- [ ] **Step 4:** Run `pytest tests/test_notebook_widgets_service.py -q`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): widget payloads for P&L, positions risk, ticker card`.

### Task 4: The router

**Files:**
- Create: `api/routers/notebook_widgets.py`
- Modify: `api/main.py` (`include_router`, next to `portfolio_heat_router`)
- Test: `tests/test_notebook_widgets_router.py`

**Interfaces:**
- Produces: `GET /api/j2/notebook-widgets/{kind}`. Query params pass through to `params` (`symbol`, `list`, `from`, `to`). The answers:
  - 404 when the kind is unknown or its wave's flag is off. The same body for both, so a gate-off kind is indistinguishable from none.
  - 400 with the `WidgetRequestError` text for bad params.
  - 402 `"Notebook widgets require a paid plan"`.
  - 200 with the payload and the header `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing tests:**
  - `test_gate_off_404`
  - `test_gate_on_200_no_store`
  - `test_wave2_kind_404_when_only_w1_on`
  - `test_unpaid_402_sentence`
  - `test_bad_symbol_400`
  - `test_flag_read_per_request`: flip the env between two calls and check the answer changes.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The router has no module-level flag capture. Confirm `tests/test_user_definitions_auth.py` passes with the new per-router `require_paid`.
- [ ] **Step 4:** Run `pytest tests/test_notebook_widgets_router.py tests/test_user_definitions_auth.py -q`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): GET /api/j2/notebook-widgets/{kind}, dark per wave`.

### Task 5: Public views: neutral by default, shown by the member's switch

**Files:**
- Modify: `api/services/journal_two/public_note_payload.py` (`MARKET_DATA_VENDORS`, `VENDOR_VERDICT`, `EMBED_PARAM_KEYS`, `_market_data`, the neutral-collapse check near line 935, `__all__`)
- Test: `tests/test_public_note_payload.py`

**Interfaces:**
- Produces:
  - `ACCOUNT_NEUTRAL_LINE = "A private account item is not shown on public pages."`
  - The vendor `"member-optin"` with `VENDOR_VERDICT["member-optin"] = NEUTRAL`, so any caller that ignores the switch fails closed.
  - Rows: `myPnlStats`, `myPositionsRisk`, `myRulesCheck` and `myMistakes` are `member-optin`. `tickerCard`, `myWatchlistToday`, `marketOnMyNames` and `tickerFlow` are `mixed`. `myNamesReporting` is `mixed`.
  - In share and publish modes, a `member-optin` embed with `params.share is True` returns the embed with `params` reduced by `EMBED_PARAM_KEYS[kind]`. Every other case gives `ACCOUNT_NEUTRAL_LINE`. Gallery always gives `ACCOUNT_NEUTRAL_LINE` for these kinds.
  - `EMBED_PARAM_KEYS` adds (never `positionId`):
    - `myPnlStats: ("asOf","source","range","netPnl","winRate","avgR","tradeCount","equity","empty","share")`
    - `myPositionsRisk: ("asOf","source","accountSize","rows","empty","share")`
  - For `myPositionsRisk`, `rows` are copied with `positionId` removed from each row.
  - `tickerCard` stays neutral as a whole in wave 1. Its own-history rows go public only when the market half is allowed too, which `VENDOR_VERDICT` decides and this plan does not change.

- [ ] **Step 1: Write the failing tests:**
  - `test_account_kind_neutral_without_share` (share and publish modes): the output is one paragraph whose text is `ACCOUNT_NEUTRAL_LINE`.
  - `test_account_kind_shown_with_share`: `params.share=True` keeps `netPnl`.
  - `test_positions_shown_strips_position_id`: no `positionId` anywhere in the output JSON.
  - `test_account_kind_gallery_always_neutral`
  - `test_share_switched_off_hides_again`: the same node with `share=False` gives neutral.
  - `test_share_truthy_string_is_not_true`: `share="true"` gives neutral (only a real `True` shows).
  - `test_market_widget_kinds_neutral`: `myWatchlistToday`, `myNamesReporting` and `tickerCard` give `NEUTRAL_LINE`.
  - `test_adjacent_mixed_neutral_lines_collapse_per_line`: two account lines collapse to one, and a market line next to an account line stays two.
  - The existing derived rail (every registry id has a row) goes green once Task 6 registers the ids.
- [ ] **Step 2:** Run `pytest tests/test_public_note_payload.py -q`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. Branch on `MARKET_DATA_VENDORS.get(("widgetEmbed", widget_id)) == "member-optin"` before the existing verdict check in `_market_data`. Make `_neutral(line=NEUTRAL_LINE)` take the line, and the collapse check compare against the line it was given.
- [ ] **Step 4:** Run the whole file plus `pytest tests/test_public_note_headers.py -q`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): account widgets neutral on public pages unless the member shares them`.

### Task 6: Registry entries and plain-text parity

**Files:**
- Modify: `app/src/widgets/registry.js` (five entries after `modelbook`)
- Modify: `app/src/widgets/captureRelease.js`, only if it enumerates capture kinds (read it first; if it does, the new kinds are NOT added: they are gated by `widgetsWaveOn`, never by the per-browser capture switch)
- Modify: `tests/fixtures_plain_text.json` and the server-side plain-text table that `tests/test_plain_text_parity.py` compares against
- Test: `app/src/widgets/registry.test.js`, `app/src/widgets/registerPanel.test.js`, `tests/test_plain_text_parity.py`

**Interfaces:**
- Produces: registry ids `myWatchlistToday`, `myNamesReporting`, `tickerCard`, `myPnlStats`, `myPositionsRisk`. Each entry has:
  - `captureOnly: true` and every `menus.*` set to `false`. These kinds have no workspace widget, and they arrive in a note through their own fetch-and-freeze slash items (Task 8), never through `menus.journal`. That keeps the `registerPanel` invariant untouched.
  - `liveCapable: false` and `themeFollow: true`.
  - `paramsSchema` listing the payload keys from Tasks 2-3 as `json`/`string`/`number` plus `share` (`boolean`).
  - `reconstructable: (p) => typeof p?.asOf === 'string'`.
  - These `plainText` lines (the exact copy):
    - `[my watchlist today: N names · as of <day>]`
    - `[my names reporting: N names · as of <day>]`
    - `[ticker card: <SYM> · as of <day>]`
    - `[my P&L and stats: <from> to <to>]`
    - `[my open positions and risk: N positions · as of <day>]`
  - Never a number from an account payload in `plainText`: plain text feeds search and AI context, and it must not carry P&L.

- [ ] **Step 1: Write the failing tests:**
  - `registry.test.js`: each new id is `captureOnly`, is in no menu, and its `plainText` for the fixture params equals the exact strings above.
  - `test_plain_text_parity.py`: the fixtures for the five kinds match on both sides.
- [ ] **Step 2:** Run `npx vitest run src/widgets` and `pytest tests/test_plain_text_parity.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement the entries and the server parity rows.
- [ ] **Step 4:** Run both again, plus `pytest tests/test_public_note_payload.py -q` (the derived id rail). Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): register five snapshot widget kinds (capture-only, no menus)`.

### Task 7: The snapshot frame, See it now, the share switch, and the five embeds

**Files:**
- Create: `app/src/pages/journal-2-0/lib/notebookWidgets.js`
- Create: `app/src/pages/journal-2-0/components/notebook/widgets/SnapshotFrame.jsx` + `SnapshotFrame.module.css`
- Create, in `app/src/pages/journal-2-0/components/notebook/widgets/`: `MyWatchlistTodayEmbed.jsx`, `MyNamesReportingEmbed.jsx`, `TickerCardEmbed.jsx`, `MyPnlStatsEmbed.jsx`, `MyPositionsRiskEmbed.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx` (five `lazyLeaf` rows in `EMBED_COMPONENTS`, plus passing `editable` and an `onUpdateParams(next)` callback to `Live`)
- Test: `notebookWidgets.test.js`, `widgets/SnapshotFrame.test.jsx`, and one `*.test.jsx` per embed

**Interfaces:**
- Consumes: `widgetsWaveOn` (Task 1), the endpoint (Task 4), the payload shapes (Tasks 2-3).
- Produces (in `notebookWidgets.js`):
  - `WIDGET_KINDS`: an ordered array of `{id, wave, group: 'open'|'plan'|'review', title, keywords, account: boolean}`, covering all nine kinds.
  - `fetchWidgetPayload(kind, params) -> Promise<{ok: true, payload} | {ok: false, reason: string}>`. It never throws. Its reasons are `"offline"`, `"unavailable"` (a 404) and `"failed"`.
  - `widgetEmbedNode(kind, payload) -> {type: 'widgetEmbed', attrs}`. It builds the attrs through the same attr constructor `widgetEmbedCore` uses for the COT capture, with `mode` frozen and `capturedAt = payload.asOf`.
  - `refreshParams(oldParams, payload) -> params`. It keeps `oldParams.share` and the request keys (`symbol`, `list`, `from`, `to`).
- `SnapshotFrame` props: `{title, asOf, account, share, editable, onRefresh, onShareChange, sourceLine, children}`. Its header shows:
  - the title;
  - a "Snapshot" chip, or "Only you" with a lock icon when `account && !share`;
  - `as of <ET day, time>`;
  - when `editable`, the "See it now" button and, for account kinds, a "Show on shared pages" switch.
  
  The source line sits under the body.
- See it now calls `fetchWidgetPayload` and, on `ok`, `onUpdateParams(refreshParams(...))`. On failure it shows the reason inline for 4 s and leaves params alone: "Couldn't refresh. The saved snapshot is unchanged." or, offline, the Global Constraints sentence.
- Embeds read only `attrs.params`. The "Set it in Journal" link is `/journal?j2tab=positions`, with `&position=<positionId>` appended only if the Journal reads that param (check `JournalLayout.jsx`; if not, the tab alone).

- [ ] **Step 1: Write the failing tests:**
  - `notebookWidgets.test.js`: `refreshParams` keeps `share: true` and `symbol`; `fetchWidgetPayload` returns `{ok:false, reason:'offline'}` with `navigator.onLine=false` and makes no request; a 404 gives `'unavailable'`.
  - `SnapshotFrame.test.jsx`: there are no controls when `editable=false`; the switch is absent for market kinds; a failed refresh keeps the rendered numbers and shows "Couldn't refresh. The saved snapshot is unchanged."
  - One test per embed, `renders_from_params_without_fetch`: spy on `global.fetch`, render with fixture params, and expect it called 0 times.
  - `MyPositionsRiskEmbed.test.jsx`: a `noStop` row shows "No stop set" and a "Set it in Journal" link, and no "0%".
  - `MyPnlStatsEmbed.test.jsx`: the `empty` sentence renders, and no "$0".
  - Null cells render "n/a" with a `title`.
- [ ] **Step 2:** Run `npx vitest run src/pages/journal-2-0/lib/notebookWidgets.test.js src/pages/journal-2-0/components/notebook/widgets`. Expected: FAIL.
- [ ] **Step 3:** Implement. The equity line in `MyPnlStatsEmbed` is an inline SVG polyline, not the chart engine.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then `npm run build` in `app` and `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`.
- [ ] **Step 5:** Commit: `feat(notebook): snapshot frame, See it now, share switch, five widget embeds`.

### Task 8: The `/` menu: three moment groups and the fetch-and-freeze items

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx` (`SLASH_GROUPS`, `groupedSlashItems`, `items`)
- Modify: `app/src/pages/journal-2-0/components/notebook/WidgetPalette.jsx` (the same items, under the same group labels)
- Test: `SlashMenu.items.test.jsx`, `WidgetPalette.test.jsx`

**Interfaces:**
- Consumes: `WIDGET_KINDS`, `fetchWidgetPayload`, `widgetEmbedNode`, `widgetsWaveOn`.
- Produces: `snapshotWidgetItems(query) -> items[]`, exported from `SlashMenu.jsx`.
  - Items are only for kinds whose wave is on.
  - Each item is `{title, description, group, command}`. `command` is async. It deletes the range, inserts nothing until the fetch answers, then inserts `widgetEmbedNode` at the original position and calls `caretAfterWidgetEmbed()`. On failure it inserts nothing (the `/price` precedent).
  - `/ticker NVDA` takes the same two-regime matching as `/chart`: a bare `ticker` completes to `/ticker `, and a valid symbol inserts.
- `SLASH_GROUPS` becomes `[{id:'open',label:'Before the open'},{id:'plan',label:'Planning a trade'},{id:'review',label:'Reviewing'},{id:'basics',label:'Basics'},{id:'more',label:'More'}]`.
  - Existing trading captures (chart, mtf, vs, compare, price, consensus) go in `plan`.
  - `Trade-plan canvas` goes in `plan`, and `Transcript passage` in `review`.
  - With all wave flags off, the bare-`/` order of the existing items is unchanged apart from the group labels.

- [ ] **Step 1: Write the failing tests:**
  - `snapshot_items_absent_when_wave_off`
  - `bare_slash_groups_in_order`: the open, plan, review, basics, more labels.
  - `ticker_bare_completes`
  - `ticker_bad_symbol_offers_nothing`: `/ticker looks great` gives `[]`.
  - `failed_fetch_inserts_nothing`
  - `insert_places_widgetEmbed_with_frozen_params`
  - The existing `/transcript` ranking test stays green.
- [ ] **Step 2:** Run `npx vitest run src/pages/journal-2-0/components/notebook/SlashMenu src/pages/journal-2-0/components/notebook/WidgetPalette`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS. Then the bytes check again. Expected: `VERDICT: PASS`.
- [ ] **Step 5:** Commit: `feat(notebook): / menu grouped by moment, snapshot widget items (dark)`.

### Task 9: End-to-end rail with a seeded member

**Files:**
- Test: `tests/test_notebook_widgets_e2e.py` (FastAPI TestClient over the real services with seeded sqlite: one broker trade, one manual trade, one open position with a placeholder stop, two watchlist names)

- [ ] **Step 1:** Write `test_each_wave1_kind_builds_and_reduces`. For each wave-1 kind:
  - the GET returns 200 with the W1 flag on;
  - the payload drops into a note body as a `widgetEmbed`;
  - the public reducer gives neutral without `share` and, for the account kinds, shown with it;
  - the shown output never contains the seeded position id, and never the trade ids.
- [ ] **Step 2:** Write `test_new_member_no_data` (no trades, no positions, no lists). Every kind returns 200 with `empty` or empty `rows`, and no `0.0` P&L.
- [ ] **Step 3:** Run `pytest tests/test_notebook_widgets_e2e.py -q`. Expected: PASS. If not, fix the owning task's code, not the test.
- [ ] **Step 4:** Commit: `test(notebook): wave-1 widgets end to end, privacy and empty member`.

### Task 10: `$TICKER` chip and card

**Files:**
- Create: `app/src/pages/journal-2-0/lib/tickerChip.js` (a ProseMirror decoration plugin wrapped as a TipTap `Extension`; small, first-open)
- Create: `app/src/pages/journal-2-0/components/notebook/widgets/TickerCardPopover.jsx` (lazy)
- Modify: the editor's extension list (where `SlashMenuExtension` is registered)
- Test: `tickerChip.test.js`, `widgets/TickerCardPopover.test.jsx`

**Interfaces:**
- Produces:
  - `findTickerRanges(text: string) -> Array<{from, to, symbol}>`, using `/(?<![\w$])\$([A-Z][A-Z.]{0,5})(?![\w$])/g`.
  - `TickerChipExtension`. It adds an inline decoration with class `tickerChip` and `data-symbol` only when `widgetsWaveOn(1)` is true and the editor is editable. It skips text inside a `code` mark and inside `codeBlock`. A click dispatches a `uct:ticker-card` CustomEvent with `{symbol, rect}`.
- The card mounts on that event and loads with `fetchWidgetPayload('tickerCard', {symbol})`. It shows price, % today, 10/50-day, earnings day plus expected move, and "Your history" (or "No trades in <SYM> yet."). It has two buttons: "Insert chart" (`chartInsertNodes('chart', {symbol, tf:'D'}, settings)`) and "Insert card" (`widgetEmbedNode('tickerCard', payload)`).
- The stored text stays `$NVDA`, and the public reducer is untouched.

- [ ] **Step 1: Write the failing tests:**
  - `findTickerRanges`: `"$NVDA up"` gives one range NVDA; `"$5"`, `"US$NVDA"`, `"$nvda"`, `"$$"` and `"$TOOLONGX"` give none; `"$BRK.B"` gives `BRK.B`.
  - The decoration is absent in a code mark, absent with the W1 flag off, and absent when read-only.
  - `TickerCardPopover`: "Insert card" inserts a `widgetEmbed` with `widgetId: 'tickerCard'`, and a fetch failure shows "Couldn't load NVDA right now."
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, `npm run build`, and the bytes check. Expected: PASS and `VERDICT: PASS`.
- [ ] **Step 5:** Commit: `feat(notebook): $TICKER chip with a card (editor-only, dark)`.

### Task 11: Wave-1 browser check and ship dark

- [ ] **Step 1:** Run the full suites touched: `pytest tests/test_notebook_widgets_*.py tests/test_public_note_payload.py tests/test_plain_text_parity.py tests/test_notebook_flag*.py -q`, then `npx vitest run src/pages/journal-2-0 src/widgets`. Expected: all PASS, with the counts recorded in the PR.
- [ ] **Step 2:** Run a local browser walk (per `feedback_browser_testing_core`) with `NOTEBOOK_WIDGETS_W1_ENABLED=1` on a local backend, at 390, 820 and 1200 px:
  - insert each of the five kinds from `/`;
  - See it now;
  - toggle sharing;
  - open the share link in a private window: neutral with the switch off, shown with it on;
  - click `$NVDA`.
  
  Save screenshots under `docs/notebook/evidence/2026-10-20-widgets-w1/`.
- [ ] **Step 3:** Open a PR to master with the member-impact paragraph "Nothing changes for members: the new Notebook widgets ship switched off." Merge, deploy, and verify the new boot by the `/api/health` uptime reset and `hub_nav_smoke`.
- [ ] **Step 4:** Arming the flag is the owner's flip, reported with the exact `railway variables --service web --set NOTEBOOK_WIDGETS_W1_ENABLED=1` and its rollback `=0` (never a delete).

---

## Wave 2

### Task 12: Adherence-over-time and mistakes-trend reads

**Files:**
- Modify: `api/services/journal_two/notebook_widgets.py` (builders `_my_rules_check`, `_my_mistakes`)
- Test: `tests/test_notebook_widgets_service.py`

**Interfaces:**
- Consumes: `j2_trade_adherence` through `adherence_store` (confirm the reader name with grep), and the server side of `costOfMistakes.byMistake` (`leak_finder.py` / `discipline.py`; find the function the Journal's cost-of-mistakes card calls).
- Produces these payloads:
  - `myRulesCheck`: `{"asOf","source","range","rules":[{"rule","kept","total"}],"empty"?}`
  - `myMistakes`: `{"asOf","source","rows":[{"mistake","cost30d","countNow","countPrior","trend":"more"|"less"|"same"}],"empty"?}`. `trend` compares the last 30 days with the 30 before. Both are capped by `cap_payload`.
- No new public route. Both ride `GET /api/j2/notebook-widgets/{kind}` with W2.

- [ ] **Step 1: Write the failing tests:**
  - `test_rules_check_counts_over_range`
  - `test_rules_empty_without_rules`: `"No rules set yet."`.
  - `test_mistakes_trend_more_less_same`
  - `test_mistakes_empty`: `"No mistakes tagged in the last 60 days."`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): rules check + recurring mistakes payloads (wave 2)`.

### Task 13: Wave-2 kinds end to end

**Files:** `registry.js` (2 entries: plain text `[my rules check: <from> to <to>]` and `[my recurring mistakes: N]`), `public_note_payload.py` (`EMBED_PARAM_KEYS` rows for both), `widgets/MyRulesCheckEmbed.jsx`, `widgets/MyMistakesEmbed.jsx`, the `EMBED_COMPONENTS` rows, the parity fixtures, and the matching tests from Tasks 5-9 extended to the two kinds.

- [ ] **Step 1:** Extend the parametrised tests from Tasks 5, 6, 7 and 9 to include both kinds. Run them. Expected: FAIL.
- [ ] **Step 2:** Implement. Run them. Expected: PASS, and the bytes check `VERDICT: PASS`.
- [ ] **Step 3:** Commit, PR, ship dark with the flag `NOTEBOOK_WIDGETS_W2_ENABLED`.

## Wave 3

### Task 14: `marketOnMyNames` and `tickerFlow`

**Interfaces:**
- `marketOnMyNames`: `{"asOf","source":"market","rows":[{"symbol","ret5d","sector","sectorRet5d","vsSector"}]}`, from the RS/sector data and theme taxonomy the breadth page reads (find the service behind `/api/breadth/industries`; mind its `[:500]` truncation, MEMORY).
- `tickerFlow`: `{"asOf","source":"market","symbol","callPremium","putPremium","ratio","topPrints":[...≤10]}`, from the server flow-summary reader the flow page uses. ⛔ Never `processFlowData`'s full aggregate (23.8 MB, MEMORY).
- Both are `mixed` in `MARKET_DATA_VENDORS`, so they are neutral publicly.

- [ ] Same five-step cycle as Tasks 2 + 13 (service tests, then registry/public/embed/parity), gated by W3.
- [ ] Commit: `feat(notebook): market on my names + ticker flow widgets (wave 3)`.

### Task 15: Starter styles with widgets pre-placed

**Files:** the starter-style definitions used by the P1/P3a style library (`grep -rn "Morning prep\|Weekly review" app/src/pages/journal-2-0/lib`), and its apply path.

**Interfaces:**
- `applyStyleWidgets(editor, slots) -> Promise<void>`. Each `{kind, params}` slot is filled through `fetchWidgetPayload` + `widgetEmbedNode` at apply time.
- A failed slot inserts one paragraph, "<title> couldn't load. Type / to add it again.", never an empty embed.
- Morning prep: `myWatchlistToday`, `myNamesReporting`. Weekly review: `myPnlStats`, `myPositionsRisk`, `myRulesCheck`, `myMistakes`. Only kinds whose wave is on are placed.
- Gallery templates keep their shells empty (they reduce to neutral in gallery mode already, Task 5).

- [ ] Tests: `applies_only_enabled_kinds`, `failed_slot_leaves_sentence`, and `gallery_template_has_no_payload`. Run, implement, run, then commit.

## Wave 4

### Task 16: Existing kinds join `/` under More

**Interfaces:**
- One fetch-and-freeze builder per existing non-`captureOnly` journal kind that does not yet have one: calendar, watchlist, themes, breadth, indexes, marketcontext, news, fundamentals, alerts, profile, scanner, periodsort, nhnl, nhnlPulse, volumescan, scatter, optionsflow, aisearch.
  - Each reuses the payload that kind's "Send to Journal" path already builds (`components/journalCaptureLoader.js`). No second payload shape.
- They are offered in the `more` group when W4 is on. `screener`, `cot` and `modelbook` stay capture-only.
- Each kind is its own small task in the same cycle as Task 8. The test `inserted_node_equals_send_to_journal_node` takes a fixed fetch answer and checks that the slash insert and the Send-to-Journal capture produce identical attrs (apart from `capturedAt`).
- Their public rows are unchanged.

- [ ] Per kind: failing test, then implement, then pass, then commit. Ship dark behind `NOTEBOOK_WIDGETS_W4_ENABLED`.

## Wave 5: make it yours

### Task 17: Saved chart sets and widget presets

**Files:**
- Modify: `api/routers/auth.py` (preference schema table: `"notebook_chart_sets": _PREF_OPAQUE`)
- Create: `app/src/pages/journal-2-0/lib/notebookSets.js`
- Create: `app/src/pages/journal-2-0/components/notebook/widgets/SetsDialog.jsx` (lazy) + `.module.css`
- Modify: `SlashMenu.jsx` (`chartSetItems(query)` and `presetItems(query)`, both shown only when W5 is on)
- Test: `notebookSets.test.js`, `SetsDialog.test.jsx`, `SlashMenu.items.test.jsx`, and the preference-allowlist rail (`grep -rn "_PREF_OPAQUE" tests`)

**Interfaces:**
- The preference value is the JSON string `{"v":1,"sets":[{"id","name","charts":[{"symbol","tf"}]}],"presets":[{"id","name","kind","params"}]}`. `sets` holds up to 30 sets with up to 12 charts each; `presets` holds up to 50.
- `readSets(raw: string|null) -> {v, sets, presets}`. It never throws; garbled input gives empty lists.
- `saveSets(next) -> Promise<{ok, reason?}>`: read-modify-write, posting the WHOLE value to `POST /api/auth/preferences`, because that endpoint replaces it.
- `chartSetNodes(set, settings) -> node[]`, one `chartInsertNodes('chart', {symbol, tf}, settings)` result per chart, in order.
- `presetParams(preset) -> params`. These are settings only; the data keys from Tasks 2-3 are stripped.
- Slash rows and entry points:
  - `/set` lists sets, and `/set <name>` inserts one.
  - `/preset` lists presets under the group label "My presets".
  - Each SnapshotFrame gets a "Save these settings as a preset" action.
- The "Chart sets" dialog creates, renames, deletes and reorders sets. It can start a set from a watchlist (`/api/watchlists?include_prebuilt=0`) or a theme's holdings, capped at 12. Touch targets are 44 px.

- [ ] **Step 1: Write the failing tests:**
  - `readSets_garbage_gives_empty`
  - `saveSets_posts_whole_value_keeping_other_key`
  - `chart_set_inserts_n_chart_embeds_in_order`
  - `preset_strips_data_keys`
  - `set_over_12_charts_refused_with_reason`
  - `slash_set_absent_when_w5_off`
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS, and the bytes check `VERDICT: PASS`.
- [ ] **Step 5:** Commit: `feat(notebook): saved chart sets and widget presets (dark)`.

### Task 18: Member note presets with live slots

**Files:** the P3a style-library save and apply path (`grep -rn "saveAsStyle\|applyStyle\|styleLibrary" app/src/pages/journal-2-0/lib`), and `applyStyleWidgets` from Task 15.

**Interfaces:**
- `noteToPresetSlots(doc) -> {body, slots: [{kind, params}]}`. Each snapshot `widgetEmbed` keeps its place, with `params` reduced to `presetParams` and `capturedAt: null`.
- Apply goes through `applyStyleWidgets`. Publishing a member preset to the gallery empties every slot's params.
- No new storage.

- [ ] Tests:
  - `slots_hold_settings_not_data`
  - `apply_refills_each_slot`
  - `gallery_publish_empties_slots`
  
  Run, implement, run, commit: `feat(notebook): member note presets with live widget slots (dark)`.

## Wave 6: six more widgets

### Task 19: Server payloads for the wave-6 kinds

**Files:** `api/services/journal_two/notebook_widgets.py`, `tests/test_notebook_widgets_service.py`

**Interfaces:**
- `tradeRecap` (`params.tradeId` required): `{"asOf","source","symbol","side","entryDate","exitDate","entryPrice","exitPrice","r","pnl","setup","holdDays","mistakes","bars"}`. `bars` holds at most 120 daily bars. A trade not owned by the user raises `WidgetRequestError("Trade not found")`.
- `myPnlCalendar` (`params.month` = `YYYY-MM`, default the current ET month): `{"asOf","source","month","days":[{"day","pnl","trades"}],"best","worst","empty"?}`.
- `mySetupEdge`: `{"asOf","source","rows":[{"setup","n","expectancyR","winRate","thin"}],"empty"?}`, from `personal_edge.edge_for_setups`, with `thin = n < 25`.
- `myScreenToday` (`params.definitionId` required): `{"asOf","source":"market","name","hits":[{"symbol","price","changePct"}],"coverage":{"evaluated","answered","dropped","notComputable","withheld"}}`, from the service behind `/api/scans/definition-results`. The counts are never collapsed.
- `roomBuzzOnMyNames`: `{"asOf","source":"market","rows":[{"symbol","mentions","people"}],"empty"?}`. It is `buzz_store.board(today_open_ts, now_ts, channels)` intersected with `_member_sets`. It never returns message text.
- `myEarningsReactions`: `{"asOf","source":"market","rows":[{"symbol","day","epsActual","epsEst","revActual","revEst","nextDayPct"}]}`, for member names that reported in the last 7 days.

- [ ] Tests, one per kind plus:
  - `trade_recap_other_users_trade_refused`
  - `pnl_calendar_empty_month_sentence`: "No closed trades this month yet."
  - `setup_edge_thin_below_25`
  - `screen_coverage_counts_close`
  - `buzz_never_returns_text`
  - `earnings_reactions_null_next_day_before_session`
  
  Run, implement, run, commit: `feat(notebook): wave-6 widget payloads`.

### Task 20: Wave-6 kinds end to end

**Files:**
- `registry.js`: six entries. The plain-text lines are:
  - `[trade recap: <SYM> <side> · <exitDate>]`
  - `[my P&L calendar: <month>]`
  - `[my setup edge: N setups]`
  - `[my screen today: <name> · N hits]`
  - `[room buzz on my names: N names]`
  - `[my earnings reactions: N names]`
- `public_note_payload.py`: the three account kinds are `member-optin`, with `EMBED_PARAM_KEYS` rows that never include `tradeId`; the three market kinds are `mixed`.
- Six embeds in `widgets/`, `EMBED_COMPONENTS` rows, and the parity fixtures.
- Slash items: `/recap` picks from recent closed trades (`/api/j2/trades?status=closed&limit=10`), `/screen` picks from saved screens, and the other four insert directly.

- [ ] Extend the parametrised tests from Tasks 5-9 to the six kinds. The privacy rail also asserts that `tradeId` never appears in a shown public payload. Run, implement, run, then the bytes check, then commit and ship dark behind `NOTEBOOK_WIDGETS_W5_ENABLED` / `_W6_ENABLED`.
