# Notebook widgets, phase 2: build your own widgets, checklists, trackers, more trader widgets and a presets library

Status: DRAFT for owner approval, 2026-10-24.
Builds on: `docs/superpowers/specs/2026-10-19-notebook-widgets-design.md` (phase 1, waves 1–6, live since 2026-10-23). Everything in phase 1's goals, non-goals and anti-goals still binds unless this document says otherwise.

## 1. Intent

Phase 1 gave members a fixed menu of widgets about their own trading. Phase 2 turns the Notebook into a place where a trader builds their own tools:

- **A widget builder.** A member picks what to measure from their own data, narrows it, chooses how to show it, and saves it. It then sits in the `/` menu beside the built-in widgets and works in any note.
- **Checklists and trackers.** Tools that remember something every trading day (did I follow my pre-market routine, how did I sleep, did I size correctly) and show streaks and how those days compare with P&L.
- **A larger shelf of ready-made trader widgets**, most of them shipped as builder definitions so a member can open one, see how it is made, and change it.
- **A presets library**: note templates with widgets already placed, for every part of a trader's routine, shareable through the community library.

Owner's words (2026-10-24): "a ton more widget ideas for traders and just notebook customized widgets for users to create really unique tools and stuff whenever they want as well as create a ton of cool presets", "awesome and perfect and customizable and very user friendly". The owner delegated every decision ("you decide it all and get it all done fully").

### Why this, and why it can win
Research (summarised in §12) found the gap clearly. The closest competitor, Tradezella, ships first-party notebook and playbook templates but no user-built widgets and no community library. TradesViz has hundreds of widgets, but users find it overwhelming and it had to add a "Simple Mode". Notion and Coda let users build anything, but their formulas feel like programming to most traders. The opening is **"build your own, starting from something that already works"**: every new tool starts from a filled-in example on the member's own data, never from a blank form.

## 2. Goals, non-goals, anti-goals

**Goals**
- P1. A member can build a working widget in under a minute without typing a formula, starting from an example.
- P2. Every number a builder widget shows says how many trades or days are behind it, which accounts it covers, and its date range. Small samples are marked.
- P3. A member can open any built-in or shared widget, see exactly how it is made in plain words, and change it.
- P4. A checklist or tracker never punishes a weekend, a market holiday or a day the member chose not to trade.
- P5. Presets cover a trader's whole routine (before the open, during the day, after the close, weekly, monthly, per trade, per setup) and fill in with the member's own data when used.
- P6. Saved widgets, checklists, trackers and presets are never lost or silently changed by an app update.
- P7. Phone and tablet are first-class: building, checking off a checklist and logging a tracker all work comfortably at 390 px.

**Non-goals**
- Market-wide scores, regime gauges or exposure dials (phase 1 rule, unchanged).
- New data vendors. Every source reads data the app already stores or computes.
- Writing to trades, positions or accounts from a widget. Widgets read; only checklists and trackers store their own new data.
- Journal 1.0 data. J1 is retired; nothing reads `journal_entries` or its siblings.
- The Compass unified ("Compass accounts", `'_all_'`) scope as a builder choice. The builder offers "All my accounts" or one account, nothing else.
- Real-time streaming widgets. Widgets remain snapshots with "See it now".
- Free-form SQL or code of any kind from members.

**Anti-goals (failure even if it works)**
- A private number (P&L, positions, size, rules, mistakes, checklist or tracker data) appearing in a shared, published or gallery note, or in a shared copy of someone's widget.
- A builder that feels like programming: a member has to know field names, type syntax or read an error message to get a result.
- A streak or checklist that nags: "you broke your streak" messages, red failure screens, or a reminder that will not stop.
- A saved widget, checklist or preset that breaks or changes meaning after an update (TraderSync's 2026 redesign reportedly erased users' notes; we never migrate member definitions destructively).
- A number shown without its sample size, or "0" / blank where the honest answer is "no data".
- Exceeding the Notebook first-open byte budget, or loading builder code on first open.
- A builder query that can hold the single web process: every query is bounded in rows and time.

## 3. Constraints (from the codebase, each verified 2026-10-24)

- **One web process.** Every request-path read must be bounded, single-flighted where shared, and refuse rather than queue when saturated (phase 1's `BoundedPool`, `SingleFlight`, `cap_payload` pattern in `api/services/journal_two/notebook_widgets.py`).
- **First-open bytes.** Budget 2,260,793 B (`docs/notebook/perf-budgets.json`, edited by hand, never raised). Current reading about 2,258,355 B, about 2.4 KB of room. `registry.js`, `lib/notebookWidgets.js` and `SlashMenu` load on first open, so every new built-in kind adds first-open bytes today.
- **No schema change is needed for builder widgets.** `widgetEmbed.attrs.params` is free JSON and a new `widgetId` is a value, not a node type (`lib/widgetEmbedNode.jsx:112-158`; schema guard versions node types and listed attrs only). The client's `normalizeParams` drops undeclared keys, so each new kind needs one registry row declaring its params.
- **Public pages fail closed.** An unknown `widgetEmbed` kind becomes the neutral line on share, publish and gallery (`public_note_payload.py`). Any new kind that must show anything publicly needs explicit allowlist rows; account kinds must not.
- **Account size has one authority** (`accounts.own_account_size` / `account_size_of`; `tests/test_account_size_authority.py` fails on a raw read).
- **The trading-day spine** is `COALESCE(trading_day_et, substr(exit_date,1,10))` (`filters._DAY`); ET hour from `hour_et` (NULL for date-only trades). Never derive day-of-week or hour from UTC `exit_date` (the Compass `_bucket_key` mistake).
- **Aggregates exclude flagged trades** (`ANALYTICS_INCLUDED_SQL`); lists show them, labelled ("flag, never hide").
- **Net P&L = `pnl_dollar - fees`** on equity trades; options P&L is already net. Options are never unioned into equity aggregates except where the calendar already does it.
- **Placeholder stops** (`is_placeholder_stop`) are never shown as a real stop or a 0% distance.
- **House rules for new tables:** add to `account_purge._DIRECT_USER_TABLES`; new flags to `docs/feature_flags.json` and `auth.NOTEBOOK_FLAGS`; flags read per request; unset = off.

## 4. The pieces, and how they fit

```
Builder definition (stored per member, versioned)
   └── compiled by ONE server engine (whitelist plan → bounded, parameterised query)
          ├── used by the generic "Built widget" kind in notes  (snapshot + See it now)
          ├── used by every built-in "shelf" widget              (definitions we ship)
          ├── used by preset slots                               ({{block:built:<id>}})
          └── shared as a DEFINITION (never values) through the community library

Checklists and trackers (stored per member, per trading day)
   ├── their own widgets in notes (check off / log in place)
   └── also builder SOURCES (e.g. "P&L on days I finished my checklist")
```

One engine is the core decision: the builder, the shelf and the presets all run through the same compiler, so a fix or a new measure reaches all three, and a shipped widget is just a definition a member can open.

## 5. The builder

### 5.1 What a definition is
A definition is a small JSON plan, never code:

| Part | Choices (v1) |
|---|---|
| **Source** | Closed trades · Open positions · Options strategies · Trading days (one row per ET trading day, joining day P&L, checklist and tracker values, check-in mood/focus) · Notes · Checklist history · Tracker history |
| **Scope** | All my accounts (default) · one account. Shown on the widget. |
| **Date range** | Relative (today, this week, last 7/30/90 days, this month, last month, YTD, last 12 months, all time) or fixed dates. Default last 30 days. |
| **Filters** | Typed chips, AND-joined, from a per-source field list (§5.3). OR inside one chip (e.g. setup is A or B). |
| **Measure(s)** | 1–3 measures from the vocabulary (§5.4) or a member's formula field. |
| **Group by** | Optional, one dimension, optional second for tables only. |
| **View** | Number · Number with comparison · Table · Bar · Line · Calendar heat map · List · Progress bar. Auto-picked from the shape; member can override. |
| **Sort / top N** | Sort by a measure, keep top N (max 40, the phase 1 row cap). |
| **Formula fields** | 0–5 named fields (§5.5). |
| **Display** | Title, optional subtitle, accent colour from the existing token palette, show/hide sample size (always on for averages and rates). |

Stored server-side in a new table, versioned:
- `j2_widget_definitions (id, user_id, name, plan_json, plan_version, rev, created_at, updated_at, deleted_at, source_gallery_id, source_version)`.
- `j2_widget_definition_revs (definition_id, rev, plan_json, saved_at)`: append-only history; a member can restore an earlier version.
- Cap 100 definitions per member, plan ≤ 16 KB (the `user_definitions` precedent is 50 and 64 KB; widget plans are smaller).
- `plan_version` is the plan format version. **A newer app reads every older plan version forever**; plans are upgraded in memory on read and only written back when the member saves. No migration ever rewrites stored plans in bulk (anti-goal: P6).

### 5.2 The building flow (UX)
Order follows what works for non-technical users in Metabase and Airtable, adapted for traders:

1. **Start.** Type `/build` (or "Build a widget" at the bottom of the `/` menu, or "Edit" on any built-in or shared widget). A sheet opens showing **"Start from an example"**: about 30 shelf widgets as cards, each rendered live on the member's own data, plus "Start blank". Search across them.
2. **One screen, sections top to bottom**, live preview always visible (right side at ≥1025 px; a sticky preview strip at the top of the sheet on touch, expandable):
   - **What to look at:** source as large tiles with one-line descriptions ("Closed trades: every trade you have closed").
   - **Which ones:** date range chip first, then "+ Filter" chips. Each chip is a sentence ("Setup is Flag or VCP", "Held less than 2 days"). Value pickers come from the member's own vocabulary (their setups list, tags, symbols they have traded), never a blank text box where a list exists.
   - **What to measure:** a picker of measures in plain names grouped by theme (Results, Win/loss, Risk, Time, Process), each with a one-line meaning on hover/long-press.
   - **Split it by:** optional dimension picker (Setup, Symbol, Day of week, Hour, Month, Hold time, R bucket, Side, Account, Mistake, Emotion, Regime at entry, Checklist done, Tracker value bucket…).
   - **Show it as:** view thumbnails; the auto-pick is highlighted with "Suggested".
   - **Name it:** pre-filled from the plan ("Net P&L by setup, last 30 days").
3. **The plain-language summary** sits under the preview at all times: "Net P&L, split by setup, for closed trades in the last 30 days, all accounts. 47 trades." This sentence is also what the widget's "How this is made" shows later (P3), and what an old app version shows as the unknown-widget fallback.
4. **Save** puts it in the `/` menu under "My widgets" and inserts it into the note if the builder was opened from a note. "Save as a copy" when editing a built-in or adopted widget (the original is never edited in place).

Details that make it friendly:
- **Undo/redo** inside the builder; Escape closes with "Keep your changes?" only if something changed.
- **Every invalid combination is prevented, not reported.** A measure that needs a group-by greys out with a reason; a view that cannot show the shape is disabled with a one-line why. There is no error state the member can reach by clicking.
- **Drill-down:** clicking a number, bar or cell in the preview (and later in the note) opens the list of trades/days behind it (max 40, "and N more"), each opening the existing trade drawer.
- **Sample-size honesty:** every average or rate shows its count; under 20 trades a "small sample" badge appears; under 5 the value is replaced by "Not enough trades yet (3)".
- **Keyboard:** full keyboard path; focus moves section to section; every control has a label; the preview is announced politely on change.

### 5.3 Fields per source (the filter and group-by vocabulary)
Built from existing columns and helpers (see §12 member-data inventory for exact columns). v1:

- **Closed trades:** day (ET spine), ET hour, weekday, month, symbol, side, setup, result (win/loss/breakeven), net P&L, gross P&L, fees, R (effective R: stop-R else true R from excursions), % return, hold days, hold-time bucket, shares, size quartile, regime at entry, mistake tags, emotion tags, source (manual/CSV/broker), account, had a stop (not a placeholder), MFE R, MAE R, exit efficiency, plan adherence %, linked to a plan note (yes/no).
- **Open positions:** symbol, side, setup, days open, unrealised P&L (stored broker mark only, never a live fan-out), risk to stop ($ and % of the member's own account size, "No stop set" for placeholders), % of account, account.
- **Options strategies:** underlying, strategy type, direction, status, days to expiry at entry, net P&L, R, result, account.
- **Trading days:** day, weekday, day net P&L, trade count, win rate that day, best/worst trade, checklist done (per checklist), tracker value (per tracker), check-in mood/focus, had a day note.
- **Notes:** created/updated day, folder, tags, ticker, note kind, any of the member's note properties (via the existing `property_filter_sql`, AND-only, type-checked). Measures: count, plus number-property sums.
- **Checklist history / Tracker history:** day, item, state/value, streak at that day.

### 5.4 Measures (the vocabulary)
Reuse `metrics_registry.VOCABULARY_KEYS` definitions so numbers match the analytics tab exactly: trades, wins, losses, win rate (breakeven excluded), net P&L, gross P&L, fees, average win, average loss, payoff ratio, profit factor (capped at 5, as elsewhere), expectancy ($ and R), average R, total R, max drawdown, best trade, worst trade, average hold, days traded, profitable days %, largest win streak, largest loss streak, current streak; for days: average day P&L, green-day %; for checklists: completion %, current streak, best streak, consistency (done ÷ scheduled days); for trackers: average, min, max, latest, change vs previous period.

Each measure carries its minimum sample (from `metrics_registry`, e.g. Sharpe-type measures need ≥20 days) and returns `None` with the count below it.

### 5.5 Formula fields
For the 10% who want more, a spreadsheet-style formula field with autocomplete:
- Field names in brackets: `[Net P&L] / [Risk $]`.
- Functions (about 15): `If, And, Or, Not, Abs, Round, Min, Max, CountIf, SumIf, AvgIf, Share` (fraction of rows matching), `Bucket(value, edges…)`, `Hour, Weekday`. Streak functions are measures, not formula functions.
- No variables, loops, text manipulation or lookups across sources.
- Engine: extend the existing `formula_engine.py` and its client twin `lib/formula/formulaEngine.js` with the new functions, sharing test vectors (`formulaVectors.json`). Limits unchanged (length 2000, tokens 500, depth 32). Row-level formulas evaluate per row before aggregation; aggregate formulas (`CountIf`, `Share`…) evaluate per group.
- The formula box shows the live result for the first row and a plain error inline ("[Risk $] is empty on 4 trades; those are skipped").

### 5.6 How a builder widget lives in a note
- One new generic kind, `builtWidget`, registered once in `registry.js`. Params: `defId`, `defRev`, `def` (the frozen plan, so the note stays readable if the definition is later deleted and so copies travel), the result payload (`value` / `rows` / `series` / `cells` per view), `count`, `scopeLabel`, `rangeLabel`, plus the phase 1 snapshot common keys (`asOf`, `source`, `share`, …). `cap_payload` gets a `LIST_KEY` entry for it.
- It is an **account kind**: "Only you" chip, share switch default off, neutral line on public pages unless shared, and even then only the rendered result with an explicit allowlist (§9).
- **Snapshot by default** (phase 1 decision C1): inserting freezes the result. "See it now" re-runs the member's **current** definition (by `defId`) with the widget's own settings. If the definition was deleted, "See it now" re-runs the frozen `def`.
- **Viewer settings** on the placed widget via the existing Change control: date range, account, and one filter override (e.g. setup), so one saved definition serves many notes (the Airtable/Apple-widget pattern). These live in the widget's params, not the definition.
- **"How this is made"** opens the plain-language summary and an "Edit widget" button that opens the builder on the definition (or "Make a copy" for shelf and adopted widgets).

### 5.7 The server engine
- `api/services/journal_two/widget_engine.py` (new): `validate_plan(plan) -> plan` (whitelist; rejects unknown sources, fields, operators, measures, functions; enforces caps), `compile(plan, user_id, settings) -> (sql, params, post)`, `run(plan, user_id, settings) -> payload`.
- Every query: `user_id = ?` from the session, never the request; child tables joined back to an owned parent; account id only narrows; flagged trades excluded from aggregates; a hard scan `LIMIT` (5,000 rows, matching `SETUP_EDGE_TRADES_MAX`) and a deadline via an SQLite progress handler (default 1.5 s; the pooled connection already clears handlers on reuse). Over the scan cap, the payload says "Based on your newest 5,000 trades".
- Its own `BoundedPool` (4 workers, separate from the phase 1 pool and the slot pool) that refuses when full with the phase 1 "busy, try again" sentence.
- Per-member result cache keyed on (plan hash, settings, user), 300 s, behind `SingleFlight`.
- Rate: shares the phase 1 `notebook-widgets` 60/min per member; plus a durable daily cap of 1,000 builder runs per member (`daily_usage_counters`), generous for humans, a stop for a runaway client.
- Router: `GET /api/j2/notebook-widgets/builtWidget?defId=&…settings` (re-run a saved definition), `POST /api/j2/widget-definitions/preview` (run an unsaved plan, same engine, same caps, stricter rate 120/min because previews fire as the member edits, debounced 400 ms client-side), CRUD under `/api/j2/widget-definitions`.
- Builder UI code is entirely lazy (loaded when the builder opens). The note-side `builtWidget` embed is one more lazy row in `snapshotEmbeds.js`.

## 6. Checklists

### 6.1 What a member gets
- Create a checklist: name, items (each a short line), optional "negative" items that count as done when something did **not** happen ("No revenge trades", "Didn't move a stop"), and a schedule: every trading day (default; follows the market calendar so weekends and market holidays never count), chosen weekdays, or only days I trade.
- A checklist widget in a note shows today's items with large tap targets (44 px), the current streak, best streak and consistency % (e.g. "18 of the last 20 trading days").
- Day states: done · missed · skipped (the member marks "not today", e.g. no-trade day) · not scheduled. Partial completion counts as done when a member-chosen share of items is ticked (default all).
- **Forgiving by default:** a skipped day never breaks a streak; a member can log up to 7 days late ("Log yesterday"); strict mode is opt-in per checklist.
- **No nagging:** no broken-streak messages, no red. A missed day shows as a quiet gap. One optional reminder per checklist, tied to the market clock (e.g. 9:00 ET), through the existing alert bell only, off by default.
- **The trader payoff, automatic:** every checklist widget can flip to "P&L on done days vs other days" and "win rate on done days vs other days", with counts and the small-sample rule.
- Starter checklists in the presets library (pre-market routine, pre-entry checks, end-of-day review, rules I keep) and "Import my day rules" from the existing day-notes rules list.

### 6.2 Storage
- `j2_checklists (id, user_id, name, items_json, schedule_json, settings_json, created_at, updated_at, archived_at, source_gallery_id)`; items carry stable ids so renaming an item keeps its history; cap 30 checklists, 25 items each.
- `j2_checklist_days (user_id, checklist_id, day, state, items_json, updated_at, PRIMARY KEY(user_id, checklist_id, day))`.
- Ticking writes directly through a small endpoint (`PUT /api/j2/checklists/{id}/days/{day}`), not through the note body, so the same checklist can sit in many notes and one tick updates all of them. Writes take `BEGIN IMMEDIATE` like other note-adjacent writes.
- The widget in a note is a `checklistWidget` kind (account kind). Unlike snapshot widgets, its state is **live** (it reads the checklist's current day on open), because a checklist frozen at insert time would be useless; the note stores only `checklistId` and display settings. Offline: ticks queue in the existing offline outbox pattern and show "Will save when you're back online".
- Market calendar: reuse the existing trading-session calendar helpers (the same source the scheduler and `last_closed_session()` use); no new holiday list.

## 7. Trackers
- A tracker logs one value per trading day (or any day, member's choice): yes/no, number (with unit, e.g. hours of sleep), 1–5 scale, or duration.
- Widget: log today in one tap/keystroke, a small chart of the last 30 entries, average, latest, and "vs P&L" (bucketed: e.g. "Sleep under 6h: avg day −$210 (9 days); 6–8h: +$95 (22 days)").
- Storage: `j2_trackers (id, user_id, name, kind, unit, settings_json, …)` and `j2_tracker_days (user_id, tracker_id, day, value, PRIMARY KEY(user_id, tracker_id, day))`; cap 30 trackers. Same live-state, write-through and offline rules as checklists.
- Existing check-ins (`j2_note_checkins` mood/focus) appear as two read-only built-in trackers so members see them in the same place; nothing migrates.

## 8. The ready-made shelf (built-in widgets)

Ranked by how often traders ask for them (research §12). Most are **shipped definitions** over the builder engine ("editable on arrival", the starter-scan precedent); a few need data the plan language cannot express and stay dedicated builders.

| # | Widget | Shows | How |
|---|---|---|---|
| 1 | Equity curve | cumulative net P&L line, drawdown shaded | definition (line over trading days) |
| 2 | P&L calendar heat map | month grid, day P&L colour | already live (`myPnlCalendar`); also a definition view |
| 3 | Win rate | win rate with count, vs previous period | definition |
| 4 | Profit factor | PF (capped 5) with count | definition |
| 5 | Expectancy | $ and R per trade | definition |
| 6 | Average win vs average loss | two bars + payoff ratio | definition |
| 7 | Performance by setup | table: trades, win rate, avg R, net | definition (also `mySetupEdge`) |
| 8 | Max drawdown | value, date range, recovery status | definition |
| 9 | P&L by time of day | bar by ET hour (date-only trades excluded and counted) | definition |
| 10 | P&L by weekday | bar Mon–Fri | definition |
| 11 | P&L by hold time | bar by hold bucket | definition |
| 12 | R-multiple distribution | histogram of R buckets | definition |
| 13 | Best and worst trades | top/bottom 5 list | definition |
| 14 | Cost of mistakes | $ and R lost per mistake tag | definition |
| 15 | Tilt check | trades taken within 30 min after a loss vs others | dedicated (sequence-dependent) |
| 16 | Plan vs actual (one trade) | planned entry/stop/target vs fills, slippage, R | dedicated (`j2_trade_plan_links`) |
| 17 | Risk left today | daily loss limit minus today's net, open risk | dedicated (discipline state) |
| 18 | Positions near stop | open positions within X% of stop | definition |
| 19 | Position size helper | shares for a symbol/entry/stop from own size & risk % | dedicated (interactive, no data read) |
| 20 | Goals progress | daily/weekly/monthly goal vs actual | definition over `j2_accounts.goals` |
| 21 | Rule-keeping streak | days since a rule break, consistency | checklist-based |
| 22 | Long vs short | side comparison table | definition |
| 23 | Exit quality | MFE/MAE, exit efficiency, missed R | definition (excursions) |
| 24 | Month in review | net, trades, win rate, best day, worst day, top setup | definition (number grid view) |
| 25 | Weekly scorecard | this week vs last 4 weeks on 5 measures | definition (table) |
| 26 | Pre-market game plan | Morning Wire headline read, my names reporting today, open risk | dedicated (composes existing reads) |
| 27 | Alerts that fired | my alerts fired since the last session | dedicated (alert fire logs) |
| 28 | Process vs results | adherence % and checklist completion vs net P&L by week | definition (trading-days source) |
| 29 | Fees drag | fees as % of gross | definition |
| 30 | Days since last revenge trade | uses the revenge rule from `leak_finder` | dedicated |

Dedicated ones reuse phase 1's builder shell (`notebook_widgets._BUILDERS`), caps and privacy rules.

## 9. Privacy

- Builder, checklist and tracker widgets are all **account kinds**. Default share off; on public pages they render the existing neutral line ("A private account item is not shown on public pages.") unless the member turns sharing on for that widget. When shared, only the rendered result travels, and only keys listed in new `EMBED_PARAM_KEYS` / `EMBED_ROW_KEYS` rows; the frozen `def` never travels to a public page (it could carry symbols or tags the member did not mean to expose).
- **Sharing a widget to the community library shares the definition only**: source, measures, group-by, view, formulas, display. Filters that name the member's own values (a symbol, a setup name, a tag, an account) are stripped to "pick yours" placeholders; dates become relative. This follows the gallery rule "definitions, never values" (`template_gallery.py`). Adoption creates a copy owned by the adopter, bound to their own data by role (their setups, their tags), with "Based on X's Y" credit and opt-in updates (gallery `j2_gallery_watches` precedent).
- Shared checklists share item text only, never day history. Shared trackers share the definition only.
- New tables go into `account_purge._DIRECT_USER_TABLES`, and the account-deletion tombstone flow covers them.
- Every engine query is re-checked by a rail that runs each source with a second member's data present and asserts nothing crosses.

## 10. Presets library

- **Official shelf, about 30 presets**, each a journal style (existing `j2_journal_styles`) with widget slots filled server-side when used. Categories follow a trader's routine:
  - Before the open: Pre-market prep · Game plan · Earnings day prep · Watchlist review
  - During the day: Mid-day check · Trade plan (one idea) · Risk check
  - After the close: End-of-day recap · Trade post-mortem · Mistake log entry · Tilt reset
  - Weekly / monthly: Weekly review · Monthly review · Quarterly edge review · Goal setting
  - Playbook: Setup study (fills with my stats on that setup) · New setup idea · Rules review
  - Challenges: Prop-firm challenge tracker · 30-day consistency challenge
  - Habits: Morning routine checklist · Trading-day tracker set
- **Slots extended:** today only six snapshot kinds can fill a slot (`journal_styles.SNAPSHOT_SLOT_KINDS`). Phase 2 adds `{{block:built:<shelf-or-def-id>}}`, `{{block:checklist:<template>}}` and `{{block:tracker:<template>}}`. Using a preset that contains a checklist or tracker template creates the member's own checklist/tracker (once; re-using the preset reuses it).
- **Preview with my data:** the preset card shows a preview built from the member's own data (the slot fill runs in preview mode, same bounded slot pool and 4 s budget).
- **Members save any note as a preset** (existing journal styles flow), and share it through the community style library (existing review-before-listing, rate limits and reducer). Shared presets carry definitions and slot templates, never values.
- **Gallery card information:** what it is for (one line), what it contains (widget list), "used by N traders", last updated, author handle, helpful count (existing). Ratings are the existing "helpful" mark, allowed only after the member has used the preset on 3 different days.

## 11. Bytes first (phase 2, wave 0)

Before any new kind ships, free first-open room so phase 2 never fights the budget:
1. **Lazy kind metadata.** Keep only ids and waves eager; move labels, keywords, descriptions and `paramsSchema` for all snapshot kinds into a lazy manifest loaded on the first `/` press or first embed render. The unknown-kind path already shows `searchText` while it loads.
2. **Lazy NotebookTab dialogs:** TemplatePicker (and the 1,408-line `notebookTemplates.js` it pulls), SavedViewEditor, BulkActionBar, NoteConnectorsTrustStrip, ResearchHome.
3. **Terminal code out of the entry chunk** (~35 KB minified, named in `docs/notebook/wave14-perf.md`) if (1) and (2) do not reach the target.
Target: at least 40 KB of headroom, measured with `tools/notebook_perf_budgets.py`, budget unchanged. Each move is its own measured commit with the byte delta in the message.

## 12. Research summary (inputs to this design)

- **Codebase:** widget pipeline, extension points, gallery, per-day stores and byte map: research report 1 (2026-10-24), summarised in §3 and §5.6–5.7. Notable: `params` is free JSON; `normalizeParams` drops undeclared keys; `readSets` drops presets of unknown kinds (builder presets need their own path); slots run on their own pool with a 4 s budget.
- **Member data:** every member-owned dataset with columns, scope rules and helpers: research report 2, summarised in §5.3. Notable: J2 is current, J1 dead; three scope shapes disagree (`'_all_'` means Compass-enabled accounts only), so the builder offers only "all accounts" or one account; `watchlist_items` has no `user_id`; public watchlists and the community feed are not "own data".
- **Competitors:** Tradezella, TradesViz, TraderSync, Tradervue, Edgewonk, Notion, Coda, Obsidian (Dataview, Tracker), Airtable, Metabase, habit apps: research report 3. Ideas taken: template-first start with live preview on own data (Metabase/Notion), viewer settings on a placed widget (Airtable/Apple widgets), sample-size badges and drill-down, Edgewonk's cost-of-mistakes and plan-adherence-vs-equity, forgiving streaks with consistency score and negative habits (Streaks/Loop), market-calendar-aware schedules, definitions-not-values sharing with opt-in updates (Notion template pain), small formula language (Notion/Coda cautionary). Reddit could not be fetched; sentiment came from review sites and vendor forums.

## 13. Waves and flags

Same delivery shape as phase 1: each wave dark behind its own flag, reviewed, browser-walked at 1200/820/390, then switched on one at a time with a production check.

| Wave | Flag | Contents |
|---|---|---|
| 7 | (no flag; bytes only) | §11 byte recovery |
| 8 | `NOTEBOOK_WIDGETS_W8_ENABLED` | Widget engine + builder (sources: closed trades, open positions, trading days), `builtWidget` kind, drill-down, definitions CRUD + versions |
| 9 | `NOTEBOOK_WIDGETS_W9_ENABLED` | Checklists and trackers (storage, widgets, streak rules, reminders off by default, "vs P&L"), and their builder sources |
| 10 | `NOTEBOOK_WIDGETS_W10_ENABLED` | Formula fields; options and notes sources; the shelf (§8), including the dedicated ones |
| 11 | `NOTEBOOK_WIDGETS_W11_ENABLED` | Presets library (§10), extended slots, preview-with-my-data, community sharing of widgets/checklists/trackers/presets |

Rollback per wave: set its flag to `0` (never a delete). Stored definitions, checklists and trackers stay and reappear when the wave is switched back on.

## 14. Decisions made for the owner (my calls, to check while reading)

1. One engine for builder, shelf and presets (§4).
2. Builder offers "All my accounts" or one account; never the Compass-only scope (§2, §5.1).
3. Checklists and trackers are live, not snapshots (§6.2), unlike every other widget.
4. Forgiving streaks by default; strict mode opt-in; no broken-streak messages; reminders off by default (§6.1).
5. Sharing is definitions-only with member values stripped to "pick yours" (§9).
6. Scan cap 5,000 rows and 1.5 s per builder query; "Based on your newest 5,000 trades" over the cap (§5.7).
7. Small-sample rule: badge under 20, hidden value under 5 (§5.2).
8. Formula language limited to about 15 functions, extending the existing engine rather than a new one (§5.5).
9. Bytes first: ≥40 KB headroom before new kinds (§11).
10. AI "describe your widget" (a sentence → a plan the member can see and edit) is **not** in this phase; it is a natural follow-up once the plan language is proven, and would ride the existing LLM cost guards.

## 15. Left to the builder

- Exact visual design of the builder sheet within the existing Notebook design tokens and components (Sheet, ContextPopover, UIcon).
- Chart rendering for builder views: reuse what phase 1 embeds already use; no static import of the chart engine (phase 1 rule).
- Exact SQL per source and field, within §5.7's rules.
- Copy for every label and sentence, plain words, no emoji, following phase 1's copy style.
- Test design, within the repo rules (rendered-text assertions, non-vacuity controls, mutation proofs for guards).
