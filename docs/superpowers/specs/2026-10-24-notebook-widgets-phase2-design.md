# Notebook widgets, phase 2: build your own widgets, routines, trackers, more trader widgets and a template library

Status: DRAFT for owner approval, 2026-10-24. Revised the same day against three reviews (product and UX, safety, feasibility) under owner-delegated rulings; every finding and its disposition is in §17.
Builds on: `docs/superpowers/specs/2026-10-19-notebook-widgets-design.md` (phase 1, waves 1–6, live since 2026-10-23). Everything in phase 1's goals, non-goals and anti-goals still binds unless this document says otherwise.

## 1. Intent

Phase 1 gave members a fixed menu of widgets about their own trading. Phase 2 turns the Notebook into a place where a trader builds their own tools:

- **A widget builder.** A member picks what to measure from their own data, narrows it, chooses how to show it, and saves it. It then sits in the `/` menu beside the built-in widgets and works in any note.
- **Routines and trackers.** Tools that remember something every trading day (did I follow my pre-market routine, how did I sleep, did I size correctly) and show consistency and how those days compare with P&L.
- **A larger shelf of ready-made trader widgets**, most of them shipped as builder definitions so a member can open one, see how it is made, and change it.
- **A template library**: note layouts with widgets already placed, for every part of a trader's routine, living in the existing templates and journal-styles surfaces and shareable through the community library.

Owner's words (2026-10-24): "a ton more widget ideas for traders and just notebook customized widgets for users to create really unique tools and stuff whenever they want as well as create a ton of cool presets", "awesome and perfect and customizable and very user friendly". The owner delegated every decision ("you decide it all and get it all done fully"). The owner's "presets" are this document's **Templates** (§4.1).

### Why this, and why it can win
Research (summarised in §12) found the gap clearly. The closest competitor, Tradezella, ships first-party notebook and playbook templates but no user-built widgets and no community library. TradesViz has hundreds of widgets, but users find it overwhelming and it had to add a "Simple Mode". Notion and Coda let users build anything, but their formulas feel like programming to most traders. The opening is **"build your own, starting from something that already works"**: every new tool starts from a filled-in example on the member's own data (or clearly labelled sample data when they have none), never from a blank form.

## 2. Goals, non-goals, anti-goals

**Goals**
- P1. A member can build a working widget in under a minute without typing a formula, starting from an example.
- P2. Every number a builder widget shows says how many trades or days are behind it (and, for a measure that needs a per-trade value such as R, how many of them have it), which accounts it covers, and its date range. Small samples are marked.
- P3. A member can open any built-in or shared widget, see exactly how it is made in plain words, and change it.
- P4. A routine or tracker never punishes a weekend, a market holiday or a day the member chose not to trade.
- P5. Templates cover a trader's whole routine (the night before, before the open, during the day, after the close, weekly, monthly, per trade, per setup) and fill in with the member's own data when used.
- P6. Saved widgets, routines, trackers and templates are never lost or silently changed, by an app update or by the member's own edit made from another note.
- P7. Phone and tablet are first-class: building, ticking a routine and logging a tracker all work comfortably at 390 px.
- P8. Everything a member makes has one place to be found, renamed, copied, archived and restored (§5.8).

**Non-goals**
- Market-wide scores, regime gauges or exposure dials (phase 1 rule, unchanged).
- New data vendors. Every source reads data the app already stores or computes.
- Writing to trades, positions or accounts from a widget. Widgets read; only routines and trackers store their own new data.
- Journal 1.0 data. J1 is retired; nothing reads `journal_entries` or its siblings.
- The Compass unified ("Compass accounts", `'_all_'`) scope as a builder choice. The builder offers "All my accounts" or one account, nothing else.
- Real-time streaming widgets. Builder widgets remain snapshots with "See it now".
- Free-form SQL or code of any kind from members.
- Day state of routines and trackers on public, shared or gallery pages (phase 2 shows the neutral line there; §9).
- An offline queue for routine ticks and tracker logs (§16.5).

**Anti-goals (failure even if it works)**
- A private number (P&L, positions, size, rules, mistakes, routine or tracker data) appearing in a shared, published or gallery note, or in a shared copy of someone's widget, routine, tracker or template.
- A builder that feels like programming: a member has to know field names, type syntax or read an error message to get a result.
- A streak or routine that nags: "you broke your streak" messages, a streak shown as 0, red failure screens, or a reminder that will not stop.
- A saved widget, routine or template that breaks or changes meaning after an update, or after the member edits it from a different note (TraderSync's 2026 redesign reportedly erased users' notes; we never migrate member definitions destructively).
- A number shown without its sample size, or "0" / blank where the honest answer is "no data".
- Exceeding the Notebook first-open byte budget, or loading builder code on first open.
- A builder query that can hold the single web process: every query is bounded in rows and time.
- Opening a note, or ticking a routine in it, changing the note (that is the Wave Q1 fork class).

## 3. Constraints (from the codebase, each verified 2026-10-24)

- **One web process.** Every request-path read must be bounded, single-flighted where shared, and refuse rather than queue when saturated (phase 1's `BoundedPool`, `SingleFlight`, `cap_payload` pattern in `api/services/journal_two/notebook_widgets.py`). Routes are sync `def`s, so a request already holds an anyio thread; nothing may submit to a second pool and wait (the slot path's deadlock note, `journal_styles.py:892-900`).
- **First-open bytes.** Budget 2,260,793 B (`docs/notebook/perf-budgets.json`, edited by hand, never raised). The current reading is **not measured** for this design: no artifact records one (phase 1's spec records 2,243,289 B at its own time, `2026-10-19-notebook-widgets-design.md:122`). Wave 7 starts by measuring a real build and committing the reading (§11). `registry.js`, `lib/notebookWidgets.js` and `SlashMenu` load on first open, so every new registry row adds first-open bytes.
- **No schema change is needed for builder widgets.** `widgetEmbed.attrs.params` is free JSON and a new `widgetId` is a value, not a node type (`lib/widgetEmbedNode.jsx:112-158`; schema guard versions node types and listed attrs only). The client's `normalizeParams` drops undeclared keys, so each new kind needs one registry row declaring its params. Routines and trackers ride the existing trader-block path (`blockManifest`, the `moodCheckIn` precedent, `registry.js:1032`), also without a schema change.
- **Public pages fail closed.** An unknown `widgetEmbed` kind becomes the neutral line on share, publish and gallery (`public_note_payload.py`). Public reduction is a pure function of the stored body (`public_note_payload.py:569-590`); public embeds render their archived image only (`WidgetEmbedView.jsx:588-591`). Any new kind that must show anything publicly needs explicit allowlist rows; account kinds must not.
- **Account size has one authority** (`accounts.own_account_size` / `account_size_of`; `tests/test_account_size_authority.py` fails on a raw read).
- **The trading-day spine** is `COALESCE(trading_day_et, substr(exit_date,1,10))` (`filters._DAY`, `filters.py:46`); ET hour from `hour_et` (NULL for date-only trades). Both are exit-side; the entry ET day comes from `timeutil.compute_trading_day_et(entry_date)` in Python (`timeutil.py:41`). Never derive day-of-week or hour from UTC `exit_date` (the Compass `_bucket_key` mistake).
- **The market calendar** is `api.services.session_calendar` (`is_trading_day(d)`, `covers(d)`, `horizon()`, `session_calendar.py:154-172`), backed by `app/src/lib/marketClock/market_calendar.json`, covering 2000-01-01 to the dataset horizon (2028-12-31).
- **Aggregates exclude flagged trades** (`ANALYTICS_INCLUDED_SQL`); lists show them, labelled ("flag, never hide").
- **Net P&L = `pnl_dollar - fees`** on equity trades; options P&L is already net. Options are never unioned into equity aggregates except where the calendar already does it, and the trading-days source's day P&L is one of those places (§5.3).
- **Placeholder stops** (`is_placeholder_stop`) are never shown as a real stop or a 0% distance. Broker positions also carry placeholder `entry_date` values (`entry_estimated`).
- **Measures today** (`metrics_registry.VOCABULARY_KEYS`, `metrics_registry.py:757-761`) are 16 keys with no per-measure minimum; `profit_factor` there is uncapped while the analytics tab caps it at 5 (`analytics.py:957`, `playbook_stats.py:79`). §5.4 handles both facts.
- **House rules for new tables:** every new table carries `user_id` and is listed by name in `account_purge._DIRECT_USER_TABLES` (purged with `DELETE ... WHERE user_id = ?`, `account_purge.py:399-400`; a missing column is only logged, `:339-348`). New flags are wired in four places (§13); flags read per request; unset = off.

## 4. The pieces, and how they fit

```
Widget definition (stored per member, versioned, every placement pinned to a revision)
   └── compiled by ONE server engine (whitelist plan → bounded, parameterised query)
          ├── used by the generic built-widget kind in notes (snapshot + See it now)
          ├── used by every ready-made shelf widget         (definitions we ship, server-side)
          ├── used by template slots                        ({{block:built_a}}, definition copy embedded)
          └── shared as STRUCTURE (never values) through the community library

Routines and trackers (stored per member, per trading day)
   ├── trader blocks in notes (tick / log in place; the note stores only the id and the bound day)
   └── also builder SOURCES (e.g. "P&L on days I finished my routine")

My tools: one screen that lists, renames, copies, archives and restores all of it
```

One engine is the core decision: the builder, the shelf and the templates all run through the same compiler and the same measure module, so a fix or a new measure reaches all three, and a shipped widget is just a definition a member can open.

### 4.1 Words members see (fixed)
Exactly four nouns for things a member makes or uses, plus phase 1's "preset" with its phase 1 meaning only.

- **Widget**: anything that shows numbers in a note. It is either *built in* (phase 1 kinds and the ready-made shelf) or *mine* (built by me, copied, or adopted from the library).
- **Routine**: a list of items remembered every trading day ("Pre-market routine", "Rules I keep"). This replaces "checklist" everywhere in this design, because **Checklist** is already a Basics block in `/` (`BASICS` in `SlashMenu.jsx`, a to-do list in the note) and keeps its name. In `/` the new item reads "Routine (remembered daily)" with its own icon.
- **Tracker**: one value logged per day.
- **Template**: a note layout with widgets, routines or trackers in it. Phase 2's note presets become Templates inside the existing templates and journal-styles surfaces; "Save as template" stays the door; "journal style" stays an internal name only.
- **Preset** keeps only its phase 1 meaning: saved widget settings (phase 1 C17), listed in `/` under "My presets" as today. Built widgets do not get presets: a definition with viewer settings is already the reusable unit (the frame's "Save these settings as a preset" is hidden for built widgets).

The `/` menu gains a **Mine** group (first row "Build a widget", then my widgets, my routines, my trackers); "My presets" stays as it is. The words "definition", "shelf", "built widget", "source", "plan" and "scope" never appear in the UI; the UI says "Accounts", not "Scope", and "What to look at", not "Source".

## 5. The builder

### 5.1 What a definition is
A definition is a small JSON plan, never code:

| Part | Choices (v1) |
|---|---|
| **What to look at** (source) | Closed trades · Open positions · Options strategies · Trading days (one row per ET trading session, joining day P&L, routine and tracker values, check-in mood/focus) · Notes · Routine history · Tracker history |
| **Accounts** | All my accounts (default) · one account. Shown on the widget. |
| **Date range** | Relative: today, this week, last week, last 7/30/90 days, this month, last month, this quarter, last quarter, YTD, last 12 months, all time; **last 20 / 50 / 100 trades**; or fixed dates. **Default: last 90 days.** |
| **Filters** | Typed chips, AND-joined, from a per-source field list (§5.3). OR inside one chip (e.g. setup is A or B). A definition may mark ONE filter as `overridable` for viewer settings (§5.6). |
| **Measure(s)** | 1–3 measures from the shared measure module (§5.4) or a member's formula field. |
| **Split by** (group by) | Optional, one dimension, optional second for tables only. |
| **View** | Number · Number with comparison (vs the previous period of the same length by default; or vs a chosen range, or vs all time) · Table · Bar · Line · Scatter (two measures per trade) · Calendar heat map · List · Progress bar. Auto-picked from the shape; member can override. |
| **Sort / top N** | Sort by a measure, keep top N (max 40, the phase 1 row cap). |
| **Formula fields** | 0–5 named fields (§5.5). |
| **Display** | Title, optional subtitle, accent colour from the existing token palette, show/hide sample size (always on for averages and rates). |

Stored server-side, versioned:
- `j2_widget_definitions (id uuid4, user_id, name, plan_json, plan_version, rev, placed_rev, created_at, updated_at, archived_at, deleted_at, source_gallery_id, source_version)`. `placed_rev` is the newest revision the member approved for every placement (§5.2 step 4).
- `j2_widget_definition_revs (user_id, definition_id, rev, plan_json, summary, saved_at, named)`: history a member can restore from. Keep the last 50 revisions per definition plus any the member names; saves less than 60 s apart coalesce into one revision.
- Caps: 100 non-archived definitions per member, plan ≤ 16 KB (the `user_definitions` precedent is 50 and 64 KB; widget plans are smaller). Plan JSON is depth-checked (`_json_depth_exceeds`) before parsing.
- `plan_version` is the plan format version. **A newer app reads every older plan version forever**; plans are upgraded in memory on read and only written back when the member saves. No migration ever rewrites stored plans in bulk (P6). A server that meets a `plan_version` newer than it knows (for example after a code revert) renders the stored summary sentence, refuses to run or save it, and says why (§5.10), so it can never drop fields it does not understand. Frozen `def`s in notes run through the same upgrader and validator as stored plans.
- Concurrent edits: definition `PUT` carries `If-Match: <rev>` and answers 409, shown as "Changed in another tab. Reload to see the newer version."

### 5.2 The building flow (UX)
Order follows what works for non-technical users in Metabase and Airtable, adapted for traders:

1. **Start.** Type `/build` (or the first row of the `/` menu's **Mine** group, "Build a widget", or "Edit" on any built-in or shared widget). A sheet opens showing **"Start from an example"**: the shelf widgets as cards (§8) rendered from one batched request (§5.7), plus "Start blank". Search across them. Cards render small static SVG previews, never chart-engine instances; the full live preview runs only when a card is opened.
   - **No data yet.** If the member has fewer than 5 closed trades across all accounts, example cards, the builder preview and template previews render on a bundled, clearly labelled **"Sample data"** set (server-side, `widget_engine/sample_book.json`; synthetic, never a real member's). Each card carries a "Sample data" ribbon and the gallery shows a banner: "These use sample trades. Link a broker or log a trade to see yours." with **Link broker** and **Log a trade** buttons. The preview switches to real data from the 5th closed trade. Sample data is never saved into a note: inserting a widget while on sample data inserts the real widget, which shows its empty state (§5.9). The first suggested step for such a member needs no trades: the Notebook's first-run card offers "Set up your pre-market routine (1 minute)" before "Build a widget".
2. **One screen, sections top to bottom**, live preview always visible. Desktop (≥1025 px) and tablet (641–1024 px): preview on the right, 40% wide, controls on the left. Phone (≤640 px): a one-line sticky summary at the top ("Net P&L by setup · 47 trades · +$2,140 ▾") that expands to the full preview on tap and hides automatically while the keyboard is open. Pickers never open a second sheet: on touch they push in place inside the builder sheet with a Back control, so there is only ever one sheet, one focus trap and one swipe-to-dismiss.
   - **What to look at:** large tiles with one-line descriptions ("Closed trades: every trade you have closed").
   - **Which ones:** date range chip first, then "+ Filter" chips. Each chip is a sentence ("Setup is Flag or VCP", "Held less than 2 days"). Value pickers come from the member's own vocabulary (their setups list, tags, symbols they have traded), never a blank text box where a list exists.
   - **What to measure:** a picker of measures in plain names grouped by theme (Results, Win/loss, Risk, Time, Process), each with a one-line meaning on hover/long-press. A measure that needs a per-trade value (R, MFE, MAE, a stop) shows its coverage on this member's data before it is picked ("R known on 23 of 47 trades").
   - **Split it by:** optional dimension picker (Setup, Symbol, Day of week, Hour, Month, Hold time, R bucket, Side, Account, Mistake, Emotion, Regime at entry, Routine done, Tracker value bucket…).
   - **Show it as:** view thumbnails; the auto-pick is highlighted with "Suggested".
   - **Name it:** pre-filled from the plan ("Net P&L by setup, last 90 days"). The name keeps following the plan until the member types in it; from then on it is theirs.
3. **The plain-language summary** sits under the preview at all times: "Net P&L, split by setup, for closed trades in the last 90 days, all accounts. 47 trades." This sentence is also what the widget's "How this is made" shows later (P3), what version history lists, and what an old app version shows as the unknown-widget fallback.
4. **Save.**
   - A new widget goes into `/` under **Mine** and is inserted into the note if the builder was opened from a note.
   - **Editing a widget placed in other notes asks once:** "This widget is in 14 notes. **Update all 14 notes** · **Save as a new widget**." "Update all" sets the definition's `placed_rev` to the new revision; every placed copy keeps showing its frozen snapshot and adopts the new revision on its next "See it now" (a member action that already writes the note). No note is written by the save itself. "Save as a new widget" creates a new definition used only by the note the builder was opened from. A title-only or colour-only change defaults to "Update all"; a change to filters, measures or split defaults to "Save as a new widget". A widget used in no other note saves without asking. After the first time, the member's last answer for that widget is the pre-selected choice.
   - **Built-in, shelf and adopted widgets are never edited in place:** the button is "Save as a copy". When the builder was opened from a placed widget, the copy **replaces that widget in the note** (one undo step brings the original back); opened from `/build`, it inserts at the cursor.
   - Swipe-down or Escape keeps a draft ("Keep your changes?" only if something changed). Reopening `/build` within 24 h offers "Resume your unsaved widget".

Details that make it friendly:
- **Undo/redo** inside the builder (Ctrl/Cmd+Z); Ctrl/Cmd+Enter saves; Escape goes back one picker level before it closes the sheet.
- **No invalid combination is reachable by clicking.** A measure that needs a split greys out with a reason; a view that cannot show the shape is disabled with a one-line why. This covers invalid builder combinations only; states the engine can reach (busy, too long, rate limit, offline) each have their own copy in §5.10, and in every one of them Save stays enabled because the definition is valid.
- **Drill-down:** clicking (or pressing Enter on) a number, bar, point or cell in the preview, and later in the note, opens the trades or days behind it (§5.7, max 40, "and N more"), each opening the existing trade drawer.
- **Sample-size honesty:** every average or rate shows its count, in the measure's own unit (decisive trades for win rate, days with trades for day measures). For a measure that needs a per-trade value, the count is the count that **has** that value, next to the total: "0.4R, from 9 of 47 trades (38 have no stop)", and the small-sample rule applies to the 9. When fewer than half have the value, the widget adds "Add stops to see R for more trades", linking to the trades filter "no stop". Under 20 a "small sample" badge appears; under 5 the value is replaced by "Not enough trades yet (3)". A measure with a stricter minimum uses its own (§5.4).
- **Keyboard and screen reader:** §5.11.

### 5.3 Fields per source (the filter and split vocabulary)
Built from existing columns and helpers (see §12 member-data inventory for exact columns). v1:

- **Closed trades:** day (ET spine), ET hour, weekday, month, symbol, side, setup, result (win/loss/breakeven), net P&L, gross P&L, fees, R (effective R: stop-R else true R from excursions), risk $ (|entry − stop| × shares; blank for placeholder stops), % return, hold days, hold-time bucket, hold minutes (only when entry and exit times exist; §8 #12), shares, size quartile, regime at entry, mistake tags, emotion tags, source (manual/CSV/broker), account, had a stop (not a placeholder), MFE R, MAE R, exit efficiency, plan adherence %, linked to a plan note (yes/no).
- **Open positions:** symbol, side, setup, days open (from the entry ET day; rows with `entry_estimated` are excluded and counted in the footnote), unrealised P&L (stored broker mark only, never a live fan-out), risk to stop ($ and % of the member's own account size, "No stop set" for placeholders), % of account, account.
- **Options strategies:** underlying, strategy type, direction, status, days to expiry at entry, net P&L, R, result, account.
- **Trading days:** one row per session in the range from `session_calendar` (including sessions with no trades); day, weekday, day net P&L (**includes closed options strategies, as the calendar does, and the label says "incl. options"**), trade count, win rate that day, best/worst trade, routine done (per routine), tracker value (per tracker), check-in mood/focus (several check-ins in a day: the latest by the note's `updated_at` wins; a trashed note's check-in is gone, because `j2_note_checkins` is a projection of note bodies), had a day note.
- **Notes:** created/updated day, folder, tags, ticker, note kind, any of the member's note properties (via the existing `property_filter_sql`, AND-only, type-checked). Measures: count, plus number-property sums.
- **Routine history / Tracker history:** day, item, state/value (derived as in §6.2), consistency at that day.

### 5.4 Measures (the shared measure module)
- One new module, `api/services/journal_two/measures.py` (with a thin builder adapter `widget_engine/measures.py`), is the single authority for builder measures and for any **new** analytics code. Each measure declares `{key, unit: "trades"|"decisive"|"days"|"entries", kind: "sum"|"count"|"rate"|"average"|"extreme", min_n, needs: [per-trade fields]}`. The §5.2 badge and hide rule applies to `rate` and `average` only, counted in the measure's own unit; sums, counts and extremes always show, with their count.
- Existing measures reuse `metrics_registry` definitions so numbers match the analytics tab: trades, wins, losses, win rate (breakeven excluded), net P&L, gross P&L, fees, average win, average loss, payoff ratio, profit factor, expectancy ($, over all trades, breakeven included), days traded, profitable days, average true R, max drawdown.
- About 11 new measures, each with its own `min_n`: expectancy R, total R, best trade, worst trade, average hold (days), profitable-days %, longest win streak, longest loss streak, current streak, average day P&L, green-day %. Day measures count only days with trades and say so. Routine measures (completion %, consistency, best run) and tracker measures (average, min, max, latest, change vs previous period) live in the routine and tracker modules, not here.
- **Profit factor in the builder uses the analytics cap of 5, shown as "5+".** The existing `metrics_registry` card output is **not** changed (its vocabulary value stays uncapped, so no existing card or report moves). A parity rail asserts the builder's value equals `analytics.get_analytics` for the same filter, and equals the registry's value wherever the registry's is under 5.
- **R-based measures** count only trades with a known R and say "R known on 23 of 47 trades" (§5.2).
- Every output value passes through `_num` (`notebook_widgets.py:297`): NaN and Infinity become null and render as "no data", never a 500 (Starlette refuses NaN).

### 5.5 Formula fields
For the 10% who want more, a spreadsheet-style formula field with autocomplete:
- Field names in brackets: `[Net P&L] / [Risk $]`.
- Functions (about 15): `If, And, Or, Not, Abs, Round, Min, Max, CountIf, SumIf, AvgIf, Share` (fraction of rows matching), `Bucket(value, edges…)`, `Hour, Weekday`. Streak functions are measures, not formula functions.
- No variables, loops, text manipulation or lookups across sources.
- Engine: a **separate, small widget-formula dialect** (`[Field]` syntax, title-case functions, aggregate functions) in its own module (`api/services/journal_two/widget_formula.py`) with its own client twin (`lib/widgetFormula/widgetFormula.js`), its own tokenizer (the note-property tokenizer knows `{Name}` references, not `[Field]`, `formula_engine.py:100`) and its own shared vector file (`tests/fixtures/widgetFormulaVectors.json`). The note-property formula language (`formula_engine.py`, `{Name}`, `formulaVectors.json`) is not changed in any way, so members' stored note formulas cannot move (§16.2). Limits: length 2000, tokens 500, depth 32. Row-level formulas evaluate per row before aggregation; aggregate formulas (`CountIf`, `Share`…) evaluate per group. Divide-by-zero gives null, not Infinity.
- The formula box shows the live result for the first row and a plain error inline ("[Risk $] is empty on 4 trades; those are skipped").

### 5.6 How a built widget lives in a note
- One new generic kind, `builtWidget`, with rows in every place a kind needs one: the `registry.js` row (params schema), the `WIDGET_KINDS` row in `lib/notebookWidgets.js` (drives `isSnapshotKind`, `account` and the embed row), `KIND_WAVE`, `KIND_TITLE` and `ACCOUNT_KINDS` rows (`notebook_widgets.py:41-89`), a `MARKET_DATA_VENDORS` row `"member-optin"`, `EMBED_PARAM_KEYS` / `EMBED_ROW_KEYS` rows (`public_note_payload.py:486-566`), a `source_detail('builtWidget', …)` branch (`notebook_widgets.py:2070`), and one lazy row in `snapshotEmbeds.js`. The frame shows `title: params.title || meta.title` (`SnapshotFrame.jsx:296`).
- Params: `defId`, `defRev` (always pinned, §16.1), `def` (the frozen plan, so the note stays readable if the definition is later deleted and so copies travel), `title`, the result payload (`value` / `rows` / `series` / `points` / `cells` per view), `count`, `scopeLabel`, `rangeLabel`, `truncated`, the viewer settings (`range`, `accountId`, `filter`), plus the phase 1 snapshot common keys (`asOf`, `source`, `share`, …). Result rows use fixed keys (`{label, v1, v2, v3, n}`), never measure names as keys, because `allowed_params` passes one level of dict items only (`public_note_payload.py:569-590`). Trade ids are never stored in params or rows.
- Payload size: `cap_payload(payload, kind, list_key=None)` takes an explicit key chosen by view: Table, List, Bar and Number grid trim `rows` from the end (after sort and top N); Line trims each `series[*].points` from the start (oldest first, evenly); Scatter trims `points` oldest first; Heat map trims `cells` oldest first. Group labels are clipped at 60 characters. The frozen `def` is capped at 4 KB inside the 16 KB node cap; a larger plan is stored as `defRef` (id and rev) only, with the summary sentence. Each trim sets `truncated` with the count. At these caps a 1 MB note body (`notes.py:70`) holds about 40 built widgets.
- It is an **account kind**: "Only you" chip, share switch default off, neutral line on public pages unless shared, and even then only the rendered result with an explicit allowlist (§9).
- **Snapshot by default** (phase 1 decision C1): inserting freezes the result. **See it now** re-runs the pinned `defRev` (or the definition's `placed_rev` if the member approved a newer one for all placements) with the widget's own settings, through `POST /api/j2/widget-definitions/run` (§5.7). The server **echoes** `def`, `defId`, `defRev`, `title`, `scopeLabel`, `rangeLabel` and the viewer settings in every payload, and the client's refresh for `builtWidget` merges through its own lazy `lib/builtWidgets.js` rather than phase 1's `refreshParams` (which copies only `REQUEST_KEYS`, `notebookWidgetsFetch.js:96-104`), so nothing is dropped by construction. When the run adopts a newer revision, the stored `def` is replaced by the revision it ran, so the stored copy always matches the numbers shown. If the definition was deleted, or the note was copied into another account, See it now runs the frozen `def`. The phase 1 `SETTING_KEYS` / `SETTINGS_KEYS` lists do not change.
- **Updated version available:** a quiet control on a placed widget whose definition has a newer revision than its pin that the member has not approved for all placements (shelf updates, opted-in library updates, or a definition the member updated with "Save as a new widget" elsewhere and later restored). It previews the change and applies it only on click.
- **Viewer settings** on the placed widget via the existing Change control, so one saved definition serves many notes (the Airtable/Apple-widget pattern). Change gains three fields for `builtWidget` (`CHANGE_FIELDS` rows, and `changeKeysOf('builtWidget')` returns them): `range` (a select of the §5.1 relative tokens plus "Fixed dates" revealing from/to), `accountId` (loaded from `GET /api/j2/accounts` when Change opens: "All my accounts" plus each account), and `filter` (enabled only when the definition marks one filter `overridable`, its value picker loaded from `GET /api/j2/widget-definitions/vocabulary?field=` in the lazy `lib/builtWidgets.js`). These live in the widget's params, not the definition.
- **"How this is made"** opens the plain-language summary and an "Edit widget" button that opens the builder on the definition. For shelf and adopted widgets the builder opens with "Save as a copy" (§5.2 step 4). Phase 1 widgets keep their phase 1 menu; no edit or copy control is added to them (§16.6).
- **Archived or deleted definitions:** archiving or deleting a widget that is in notes says "It stays in your 14 notes as a snapshot. See it now keeps working from its saved copy." Placed copies of an archived widget show "Archived widget" in the ⋯ menu, with a Restore action.

### 5.7 The server engine
Modules (feasibility review's proposed layout): `api/services/journal_two/widget_engine/` with `plan.py` (`validate_plan`, `upgrade_plan`, `share_plan`), `sources.py` (one section per source), `measures.py` (adapter over §5.4), `compile.py`, `run.py` (admission, deadline, cache, `SingleFlight`), `shelf.json` + `shelf.py`, `sample_book.json`; `widget_definitions.py` (CRUD, revisions, caps); router `api/routers/notebook_widget_definitions.py`.

- **Every plan is untrusted input.** `validate_plan` (whitelist: rejects unknown sources, fields, operators, measures, functions; enforces caps) runs on **every** run: saved, preview, frozen fallback, adopted, viewer-override-merged, example. `compile` emits SQL only from static fragments chosen by whitelisted keys; every value is a `?` parameter; identifiers (columns, sort keys, split keys) come only from the whitelist. Tag membership is `EXISTS (SELECT 1 FROM json_each(t.<col>) WHERE value IN (?,…))`; JSON paths are never built from plan data. "Contains" filters escape `%` and `_` with `ESCAPE '\'`. The client groups with `Map` (never plain-object keys), so a setup named `__proto__` cannot corrupt preview or drill-down aggregation. Rail: a fuzz corpus of plans whose strings contain quotes, `--`, `;`, `$.`, `%` and `__proto__`; the compiled SQL text contains no plan string.
- **Ownership:** `user_id = ?` from the session, never the request; child tables joined back to an owned parent; account id only narrows; a `def:` reference or routine/tracker id that does not belong to the session member is treated as absent. Flagged trades excluded from aggregates.
- **Bounded scan:** an inner `SELECT … WHERE user_id = ? AND <filters> ORDER BY <spine> DESC, id DESC LIMIT 5001` on an indexed column, then aggregation over that set (so the limit bounds rows read, not groups; `metrics_registry._fetch_rows` orders ascending with no limit and is not reused for this). Over 5,000 rows the payload says **"Based on your newest 5,000 trades"**, `rangeLabel` names the actual earliest day covered ("From Mar 4, newest 5,000 trades"), and path-dependent measures (drawdown, streaks, equity curve) say "within your newest 5,000 trades".
- **Deadline:** an SQLite progress handler, default 1.5 s, covers the SQL (the pooled connection already clears handlers on reuse, `auth_db.py:624`). An interrupted query (`OperationalError("interrupted")`) maps to the "Took too long" sentence, never a 500. Python post-processing is bounded by those ≤5,000 rows and ≤5 formula fields; the latency gate measures it on a 50,000-trade fixture.
- **Admission, not a second pool:** no separate thread pool. Builder runs take a permit from the existing phase 1 `BoundedPool`'s admission count (`WIDGET_POOL_WORKERS` = 8) and run **inline** on the caller's thread (the request thread for routes, the slot thread for template fills), never submitting to the pool's executor. Within those 8 permits: phase 1 kinds may hold at most 6, so 2 are always reserved for builder runs; builder runs may hold at most 4; previews and examples at most 2 of those; one member at most 2 at once. A full gate answers the phase 1 "busy, try again" sentence at once, never queues.
- **Result cache:** per member, keyed on (user, plan hash, settings, data stamp), 300 s, `max_size` 2,000 entries, behind `SingleFlight`. The **data stamp** is one cheap indexed query per run over the tables the plan's source reads (newest `updated_at` or row id per member, plus routine-tick, tracker-value and definition stamps where the source joins them), so a new trade, broker sync, tick or definition edit is never hidden for 5 minutes. Two members never share an entry (the user is in the key).
- **Rates:**
  - Saved-widget runs (`/run`) and drill-downs share the phase 1 `notebook-widgets` scope, 60/min per member.
  - Previews and example batches use their own in-memory scope `notebook-widget-preview`, **120/min per member**. This is looser than the 60/min widget rate, on purpose: previews fire as the member edits (debounced 400 ms client-side). Each member has one preview in flight: a newer preview supersedes the older one, and the client drops stale answers.
  - A durable daily cap of 1,000 saved-widget runs per member, counted in process memory and flushed to `daily_usage_counters` at most once a minute per member (never one `auth.db` write per run, and never for previews), generous for humans, a stop for a runaway client. Cache hits are not counted.
- **Routes** (all `POST` bodies, so filter values never appear in query strings or access logs, and all on their own path so nothing collides with phase 1's `GET /api/j2/notebook-widgets/{kind}`):
  - `POST /api/j2/widget-definitions/run` `{defId?, defRev?, def?, settings}`: a saved definition at a revision, or a frozen `def`.
  - `POST /api/j2/widget-definitions/preview` `{plan, settings}`: an unsaved plan, same engine and caps.
  - `POST /api/j2/widget-definitions/examples` `{ids: [≤8]}`: example cards; the request reads each source once (one bounded scan per source) and evaluates every requested card over that row set; cached per member for 300 s; counts as one preview. The gallery requests cards in batches of 8 as they scroll into view, never re-fetching a card already shown. When the gate is full the cards keep their skeleton and retry once, never showing "busy" on a card.
  - `POST /api/j2/widget-definitions/drill` `{defId|def, defRev, settings, cell}`: at most 40 rows plus "and N more", same caps; labelled **"Live data; the snapshot was taken on <date>"** when the live count differs from the snapshot. Never offered on a public render.
  - `GET /api/j2/widget-definitions/vocabulary?field=<whitelisted field key>` and `GET /api/j2/widget-definitions/shelf` (the shelf is a server file, never bundled into the client).
  - CRUD under `/api/j2/widget-definitions`, plus `/{id}/revs` and `/{id}/revs/{rev}/restore`.
- Builder UI code is entirely lazy (loaded when the builder opens). The builder component is `components/notebook/widgetBuilder/WidgetBuilderSheet.jsx` (the name `BuilderSheet` is taken by the Screener's builder, `components/chart/builder/BuilderSheet.jsx`). Built-widget views are inline SVG components (`builtViews/{Number,Compare,Table,Bar,Line,Scatter,Heat,List,Progress}View.jsx`) in the lazy snapshot chunk, the way phase 1 embeds draw (`MyPnlStatsEmbed.jsx:68-70`); no ECharts or lightweight-charts in note embeds (§15).

### 5.8 My tools (one management place)
One screen in the Notebook, **My tools**, with four tabs: **Widgets · Routines · Trackers · Templates**.
- Each row shows the name, a small static thumbnail, **"Used in N notes"** (a link that lists those notes), last edited, and for adopted items "Based on X's Y" (or "Based on a former member's Y", §9).
- Row actions: Open (the builder or editor), Rename, Duplicate, Share to library, **Version history** (widgets: each save with its date and summary sentence, changes against the current version highlighted; Restore saves the old version as a new revision and then asks the §5.2 step 4 question if the widget is placed elsewhere), **Archive**. Archive hides an item from `/` but keeps every placed copy and all history; an Archived filter lists them with **Restore**. "Delete permanently" is offered only from the Archived filter, needs the name typed, and keeps the item in "Recently deleted" for 30 days.
- "Used in N notes" reads a projection, `j2_tool_uses (user_id, note_id, kind, tool_id, rev)`, rebuilt on note save the way `j2_note_checkins` is (`notes.py:505-520`), so counting never scans note bodies.
- Ways in: a "Manage my tools" row at the end of the Mine group in `/`, "Manage…" in the ⋯ menu of every placed built widget, routine or tracker, and Notebook settings. Phase 1 presets and chart sets stay in the existing "Manage chart sets" dialog, which My tools links to.
- Phone: a full-screen Sheet with the tabs as a segmented control, rows 56 px, actions in a ContextPopover.

### 5.9 Empty states and sample data
Never "0" or a blank chart (§2). One sentence per source, with buttons where a next step exists:
- Closed trades, none in range: "No closed trades in this range. Widen the range, or log a trade."
- Open positions, none: "No open positions."
- Options strategies, none: "No options strategies in this range."
- Trading days, none: "No sessions in this range."
- Notes, none: "No notes match."
- Routine history, none: "Start ticking your routine; history shows here from day one."
- Tracker history, none: "Log your first value; the chart starts with it."
Sample data rules are in §5.2 step 1.

### 5.10 Every failure state a member can reach, and its copy
"No invalid combination is reachable" (§5.2) applies to builder combinations only. Every reachable state has fixed copy; the last good result stays on screen, dimmed, wherever one exists.

| State | Where | Copy | What stays |
|---|---|---|---|
| Busy (gate full) | preview, See it now, drill | "Busy right now. Try again in a moment." (phase 1 sentence) | last result; Save enabled |
| Took too long (deadline) | preview, See it now | "This is a lot of data to add up. Try a shorter range or fewer splits." with one-tap suggestions ("Last 90 days") | last result; Save enabled |
| Over 5,000 rows | any run | "Based on your newest 5,000 trades. Narrow the range to include all trades." | the result, labelled |
| Rate limit (preview) | builder | "Pausing the preview for a moment; your changes are kept." | last preview |
| Rate limit (widget) | See it now, drill | "Too many refreshes in a minute. Try again shortly." | snapshot |
| Daily cap reached | See it now | "You have refreshed widgets a lot today. Snapshots stay; refreshing resumes tomorrow." | snapshot |
| Count cap reached | save (100 widgets, 30 routines, 30 trackers) | "You have 100 widgets. Archive one in My tools to make room." | the draft |
| Offline | builder, See it now, routine, tracker | builder: "Offline. The preview updates when you're back." Routine/tracker: "You're offline. Ticks save when you're back online." (controls disabled) | last result / snapshot |
| Flag off (wave dark) | placed widget, routine, tracker | "Not available right now." (never an empty routine or zero ticks) | snapshot for widgets |
| Definition missing (deleted, or another account's copy) | See it now | runs the frozen copy; ⋯ menu says "Running from the saved copy in this note." | result |
| Newer plan version than this app knows | open, run, save | "This widget was made with a newer version of the app. Reload to use it." | stored summary |
| Not enough data | any measure | "Not enough trades yet (3)" / "Not enough days yet (2)" | count |
| Changed in another tab | save | "Changed in another tab. Reload to see the newer version." | the draft |
| Live read failed | routine, tracker | "Can't load this routine right now." with Retry (never zero ticks or 0%) | nothing invented |
| Tick failed | routine, tracker | the tick rolls back visibly: "Didn't save. Retry?" | previous state |
| Outside the logging window | routine, tracker | "Ticks can be added up to 7 trading days back." | read-only day |
| Beyond the market calendar | routine schedule | "Market calendar not available past <date>; counting weekdays." (quiet note) | weekday schedule |

### 5.11 Accessibility
- Source tiles and view thumbnails are radio groups (arrow keys move, Enter chooses). Each filter chip is a button named by its sentence, with its own "Remove filter: Setup is Flag or VCP" button. Focus moves section to section; every control has a label.
- **Every chart view has a data-table alternative:** a "Show as table" toggle renders the same rows as an HTML table, in the builder and in the note.
- **Drill-down has a full keyboard path:** in table form every row is focusable and Enter opens its drill; in chart form, bars, points and cells are reachable with arrow keys and Enter; the drill panel traps focus, Escape returns focus to the cell it came from.
- **The heat map does not rely on colour alone:** every cell carries its value as a label (or a sign glyph, + / −, when cells are smaller than 32 px) and a pattern (hatched for negative), on a diverging scale that passes for deuteranopia.
- **The preview's live region announces only the summary sentence**, debounced to 1 s ("Net P&L by setup, 47 trades"), never the table.
- Routine history gaps carry a text label for screen readers ("Not done") and a tooltip; no red and no strike-through.
- Motion in the gallery respects reduced motion. Every touch target is ≥44 px at every tier, including view thumbnails and chip remove buttons, enforced by the existing tap-floor rail (`styles/tapFloor.test.js`).

## 6. Routines

### 6.1 What a member gets
- Create a routine: name, items (each a short line), optional "negative" items that count as done when something did **not** happen ("No revenge trades", "Didn't move a stop"), and a schedule: every trading day (default; follows the market calendar so weekends and market holidays never count; half days count as trading days), chosen weekdays, or only days I trade ("days I trade" = a closed trade, an opened trade or an options strategy on that ET day; entry days from `compute_trading_day_et`, broker placeholder entry dates excluded).
- A routine block in a note shows its bound day's items with large tap targets (44 px), the day it is recording ("For Mon Oct 27"), and consistency ("18 of the last 20 trading days (2 skipped)"). Consistency always shows skips beside it, so skipping hard days cannot quietly keep it at 100%.
- Day states, in member-facing copy: **Done · Not done · Skipped · Off day** (not scheduled). "Not done" replaces "missed". Partial shows as "4 of 6" and counts as done only at the member's chosen share of items (default all).
- **Forgiving by default:** a skipped day never breaks a run; a member can tick up to **7 trading days back**, enforced server-side (a long weekend never shortens the window); strict mode (opt-in per routine) counts skips as not done. After the window a day is read-only.
- **No nagging:** no broken-streak messages, no red, and **no surface ever shows a streak of 0**. A not-done day shows as a quiet gap. When a run ends, the block shows consistency and the best run, and nothing else changes. The current run is shown only while it is 3 or more. Quiet milestones at 7, 21, 50 and 100 sessions show one line on the block ("21 sessions in a row") and nothing else: no confetti, no notification.
- **Suggested from your trades (opt-in per item):** items that map to data ("Stop on every trade", "Max 3 trades", "Stayed under my daily loss limit", "No trade within 10 min of a loss", the `leak_finder` revenge rule) show "From your trades: looks done" after the session. The suggestion is computed at read time and never written; the member confirms by ticking.
- **One optional reminder per routine**, tied to the market clock (e.g. 9:00 ET, shown with the member's local time beside it: "9:00 ET · 8:00 your time"), through the existing alert bell only, off by default, holiday-aware, and moving with an early close. A slot missed during a deploy is skipped, not sent late (the scheduler's job store is in memory). Claims are recorded in `j2_routine_reminder_claims` so a reminder fires at most once per routine per day.
- **The trader payoff, automatic:** every routine block can flip to "P&L on days you finished it vs other days" and "win rate on done days vs other days", with counts and the small-sample rule. Copy: "On days you finished it: +$95 average (22 days). Other days: −$40 (9 days). A comparison, not proof." The last sentence is always shown.
- Starter routines in the template library (pre-market routine, pre-entry checks, end-of-day review, rules I keep) and "Import my day rules" from the existing day-notes rules list.

### 6.2 Storage and the block
- Tables (ids `uuid4`; every row carries `user_id`):
  - `j2_routines (id, user_id, name, items_json, settings_json, created_at, updated_at, archived_at, source_gallery_id, source_template_key, UNIQUE(user_id, source_template_key))`. Items carry stable ids and validity ranges, so renaming an item keeps its history and removing one applies from today forward. Caps: 30 non-archived routines, 25 items each; names ≤ 80 characters, item text ≤ 200.
  - `j2_routine_schedules (user_id, routine_id, effective_from, schedule_json, PRIMARY KEY(user_id, routine_id, effective_from))`: schedule changes are versioned with an effective date and apply from that day forward.
  - `j2_routine_ticks (user_id, routine_id, day, item_id, ticked, updated_at, PRIMARY KEY(user_id, routine_id, day, item_id))`: one row per item per day.
  - `j2_routine_days (user_id, routine_id, day, skipped, updated_at, PRIMARY KEY(user_id, routine_id, day))`.
  - `j2_routine_reminder_claims (user_id, routine_id, day, claimed_at, PRIMARY KEY(user_id, routine_id, day))`.
- **Only raw ticks and the skipped flag are stored.** Done and not-done are derived at read time from the ticks, the items valid that day, the member's done share, and the schedule version effective on that day. Changing the threshold, items or schedule never rewrites past days (P6), and late ticking never overwrites a stored "missed".
- **Market calendar:** trading days are `session_calendar.is_trading_day`; one owner module, `api/services/journal_two/trading_days.py`, provides sessions in a range and the ET day of an entry, and the engine, routines and trackers all import it. Beyond `covers()`, schedules fall back to weekdays only, with the quiet note in §5.10. Half days are trading days.
- **Writes are per item:** `PUT /api/j2/routines/{id}/days/{day}/items/{itemId}` `{ticked}` and `PUT …/days/{day}` `{skipped}`, merged server-side inside `BEGIN IMMEDIATE`, so concurrent ticks from two devices or two notes never lose each other. The response is the merged day; every instance on the page adopts it (BroadcastChannel across tabs, refetch on focus). `{day}` must be `YYYY-MM-DD`, not after today in ET, and inside the 7-trading-day window, or the server answers 400 with a sentence. Writes are 120/min per member; request bodies ≤ 8 KB.
- **Reads:** one batched read per note, `POST /api/j2/routines/days` `{ids, days}`, so a daily note with six blocks is one request. **Every read and write is `WHERE id = ? AND user_id = <session user>`**; an id that does not belong to the session member renders as "Not available" and returns nothing.
- **The block in a note is a trader block, not a snapshot embed.** `routine` registers with `blockManifest` and renders through `BlockNodeView` (no toolbar, no archive image, no resize), like `moodCheckIn`, so it never enters the snapshot pipeline's self-archive and never counts against `LIVE_EMBEDS_PER_ENTRY`. Unlike `moodCheckIn`, the sidecar tables are the authority, on purpose.
  - Params: `{routineId, day: 'YYYY-MM-DD' | '', bind: 'note-day' | 'next-trading-day' | 'week' | 'today', display}`. The note stores only the routine id, the bound day and display settings.
  - **Live state is never written into note params.** Ticks, values and consistency live in component state only. Opening or ticking produces **zero** ProseMirror transactions with `docChanged` and zero note PUTs, so it never dirties a note, forks it, or enters the offline outbox. `searchText` is static (routine name and bound day). The tick endpoint touches no `j2_notes` row, so `lib/offline/doorEnumeration.test.js` stays green with no new exception. Changing the block's own settings (bound day, Follow today, display) is an ordinary note write through `settleNoteWrite`, recorded in the door ledger. Rails: open → no doc change; tick → no note PUT; read failure → no zeros.
- **Day binding** (§16.3): on insert, `day` is the note's own day (a daily note's date, a day note's date, otherwise the note's created ET day), never "today" at read time, so reopening a 10/14 note next month shows 10/14. Templates bind their routine blocks to the new note's day at instantiation, with a per-slot option **"For the next trading day"** (night-before prep) and **"For the trading week"** for weekend reviews (ticks land on the week's last trading day; the block reads "For the week of Oct 20"). **Follow today** is a setting on the block (it shows the current trading day, or the next one on a non-trading day) for home or dashboard notes; it is never a template default.
- **Public, shared and gallery pages** render the account neutral line for routine blocks in phase 2 (`MARKET_DATA_VENDORS` row `"private"`); no day state travels. With the wave flag off the block says "Not available right now".
- **Archiving** a routine (or tracker) keeps all its history; its placed blocks turn read-only and say "Archived routine, history only", with Restore in the ⋯ menu. Permanent delete is only in My tools (§5.8).
- Offline: ticking is disabled with "You're offline. Ticks save when you're back online." (no offline queue in phase 2, §16.5). An optimistic tick that fails rolls back visibly and offers Retry.

## 7. Trackers
- A tracker logs one value per trading day (or any day, member's choice): yes/no, number (with unit ≤ 16 characters, e.g. hours of sleep), 1–5 scale, or duration (≤ 24 h). Values must be finite and range-checked.
- Block: log the bound day in one tap/keystroke, a small SVG chart of the last 30 entries (with a table alternative), average, latest, and "vs P&L" (bucketed: e.g. "Sleep under 6h: avg day −$210 (9 days); 6–8h: +$95 (22 days). A comparison, not proof.").
- Storage: `j2_trackers (id uuid4, user_id, name, kind, unit, settings_json, created_at, updated_at, archived_at, source_gallery_id, source_template_key, UNIQUE(user_id, source_template_key))` and `j2_tracker_values (user_id, tracker_id, day, value, updated_at, PRIMARY KEY(user_id, tracker_id, day))`; cap 30 non-archived trackers. Same trader-block, ownership, day-binding, batching (`POST /api/j2/trackers/days`), rate, logging-window, public and offline rules as routines.
- Existing check-ins (`j2_note_checkins` mood/focus) appear as two read-only built-in trackers so members see them in the same place; nothing migrates.

## 8. The ready-made shelf (built-in widgets)

Ranked by how often traders ask for them (research §12). Most are **shipped definitions** over the builder engine ("editable on arrival", the starter-scan precedent), stored as immutable versioned revision files under `api/services/journal_two/widget_engine/shelf/` and served by `GET /api/j2/widget-definitions/shelf` (no first-open bytes). A few need data or sequence logic the plan language cannot express and stay dedicated builders, which reuse phase 1's builder shell (`notebook_widgets._BUILDERS`), caps and privacy rules.

**One card per idea.** Where a phase 1 kind already covers the idea (P&L calendar `myPnlCalendar`, setup edge `mySetupEdge`, mistakes `myMistakes`, rules `myRulesCheck`, positions near stop `myPositionsRisk`), the gallery and `/` show the phase 1 widget only, and the shelf has no twin.

| # | Widget | Shows | How |
|---|---|---|---|
| 1 | Equity curve | cumulative net P&L line, drawdown shaded | definition (line over trading days) |
| 2 | Daily P&L bars | one bar per session, average line | definition (bar over trading days) |
| 3 | R equity curve | cumulative R, drawdown in R ("R known on N of M trades") | definition (line) |
| 4 | Win rate | win rate with count, vs previous period | definition |
| 5 | Profit factor | PF (shown as "5+" above 5) with count | definition |
| 6 | Expectancy | $ and R per trade | definition |
| 7 | Average win vs average loss | two bars + payoff ratio | definition |
| 8 | Performance by symbol | best and worst 5 tickers: trades, win rate, net | definition (table) |
| 9 | Max drawdown | value, date range, recovery status | definition |
| 10 | P&L by time of day | bar by ET hour (date-only trades excluded and counted) | definition |
| 11 | P&L by weekday | bar Mon–Fri | definition |
| 12 | P&L by hold time | bar by hold bucket; for day traders, buckets by minutes when entry and exit times exist; when they don't, it says "Hold time in minutes needs entry and exit times; your trades have dates only" instead of one bar | definition |
| 13 | R-multiple distribution | histogram of R buckets | definition |
| 14 | MAE vs MFE scatter | each trade, coloured by result and patterned; quadrant labels "stopped too tight", "gave it back" | definition (scatter) |
| 15 | Best and worst trades | top/bottom 5 list | definition |
| 16 | Recent trades | last 10 closed trades | definition (list) |
| 17 | Accounts side by side | each account's trades, win rate, expectancy, net, max drawdown | definition (split by account) |
| 18 | Long vs short | side comparison table | definition |
| 19 | Exit quality | MFE/MAE, exit efficiency, missed R | definition (excursions) |
| 20 | Month in review | net, trades, win rate, best day, worst day, top setup | definition (number grid) |
| 21 | Weekly scorecard | this week vs last 4 weeks on 5 measures | definition (table) |
| 22 | Process vs results | adherence % and routine completion vs net P&L by week | definition (trading-days source) |
| 23 | Fees drag | fees as % of gross | definition |
| 24 | Goals progress | daily/weekly/monthly goal vs actual | definition over `j2_accounts.goals` |
| 25 | Loss streak | current win/loss streak, longest, and a member-chosen "stop after N losses" state ("2 of your 3") | definition (streak measures + a display setting) |
| 26 | Tilt check | trades taken within 30 min after a loss vs others | dedicated (sequence-dependent) |
| 27 | Revenge trades | clean days in the last 30 trading days, using the `leak_finder` revenge rule ("27 of 30 clean") | dedicated |
| 28 | Plan vs actual (one trade) | planned entry/stop/target vs fills, slippage, R | dedicated (`j2_trade_plan_links`) |
| 29 | Risk left today | daily loss limit minus today's net, open risk | dedicated (discipline state) |
| 30 | Prop-firm rules | member-entered daily loss limit and max drawdown limit, each with "room left" (trailing drawdown from peak) | dedicated (sequence-dependent, member enters the limits) |
| 31 | Pre-market game plan | Morning Wire headline read, my names reporting today, open risk | dedicated (composes existing reads) |
| 32 | Alerts that fired | my alerts fired since the last session | dedicated (alert fire logs) |

The position size helper (shares for a symbol/entry/stop from own size and risk %) reads no history, so it is a `/` calculator item, not a shelf example. Any "days since" framing is replaced by "clean days in the last 30 trading days" (§6.1's no-zero rule).

**`/` discoverability:** a bare `/` shows at most 8 built-in widgets (the most used, then the defaults Equity curve, Win rate, Daily P&L bars, Performance by setup (`mySetupEdge`), Max drawdown, Risk left today, Positions near stop (`myPositionsRisk`), Weekly scorecard), then "All widgets…", which opens the gallery. Typing searches all of them. Each shelf entry declares trader synonyms in its keywords (win rate: hit rate, batting average, win %; profit factor: PF; expectancy: edge, EV, avg R; max drawdown: DD, drawdown; weekly scorecard: report card, review). The `/` search ranks a name match above a keyword match. `/routine`, `/track`, `/build` and `/widgets` are direct commands.

## 9. Privacy and sharing

- Built widgets are **account kinds**; routines and trackers are trader blocks that are private by construction. Default share off. On public, shared and gallery pages they render the existing neutral line ("A private account item is not shown on public pages."). A built widget whose member turns sharing on shows only its rendered result, through allowlisted `EMBED_PARAM_KEYS` / `EMBED_ROW_KEYS` rows with fixed row keys; the frozen `def` never travels to a public page. The archive image captures the result body and the title only: the summary sentence, subtitle-from-filters and "How this is made" control sit outside the captured element (or are hidden while `share` is on), so filter values cannot travel in the image. Drill-down is absent on every public render. Routine and tracker day state never travels in phase 2.
- **One sharing reducer for widgets, routines, trackers and templates** (`widget_engine/plan.share_plan()` and its siblings) builds a **new** payload from an allowlist and shares **structure only**: source, measures, split, view, formula expressions, display. Everything else is stripped or turned into a typed **"pick yours"** slot: names and descriptions (reset to the generated summary unless the author edits them in a share preview that shows exactly what will travel), formula field names (become "Field 1…n" unless the author retypes them), note-property, folder and note-kind ids, routine and tracker ids and item ids, symbols, setups, tags, accounts, and free text. Formula literals are kept **only if** they are numeric thresholds the author confirms in the share preview; every other literal becomes a slot. Fixed dates become the default range (last 90 days). Shared routines share item text only (the author confirms it in the share preview), never day history; shared trackers share name, kind and unit only. A rail plants canary strings and numbers in every field of a widget, routine, tracker and template and asserts none survive the reducer except confirmed numeric thresholds.
- **Shared templates embed copies of their widget definitions**, each reduced by the same reducer, never references to private rows (§10).
- **Adoption** shows a working preview immediately, using each slot's suggested value (the adopter's most-used value of that type) or "Any" (drops the filter), and lets the member change slots before saving with one tap of "Use". Adoption creates a copy owned by the adopter, with "Based on X's Y" credit and opt-in updates (gallery `j2_gallery_watches` precedent); the copy pins its revision like every placement (§16.1). Saving requires every slot resolved, so a saved definition never contains an unresolved slot.
- **Author credit after deletion:** the credit uses the gallery's opaque author handle (`j2_gallery_authors`); once the author deletes their account, every copy shows "Based on a former member's Y".
- **Gallery item types:** new types `widget_definition`, `routine` and `tracker` are added to both `ITEM_TYPES` files in one commit (`template_gallery.py:90-95` and `lib/styleLibrary.js:23`, parsed by `tests/test_style_library.py`). They use category `review`, `body_json` holds `{}`, and the reduced payload goes in `payload_json`. Watches reuse `style_id` as "the adopter's copy id", with a column comment. Listings ride the existing review-before-listing, rate limits and reducer.
- **Account deletion (purge):** every new table carries `user_id` and is listed by name in `account_purge._DIRECT_USER_TABLES` and replayed by `purge_user_rows` on restore: `j2_widget_definitions`, `j2_widget_definition_revs`, `j2_tool_uses`, `j2_routines`, `j2_routine_schedules`, `j2_routine_ticks`, `j2_routine_days`, `j2_routine_reminder_claims`, `j2_trackers`, `j2_tracker_values`, `j2_gallery_use_days`. Gallery listings of new item types live in the existing gallery tables, whose purge rows already exist. The purge rail derives the expected set from the schema (every new table with a `user_id` column) and fails by name on one missing; a misspelled name must not pass as "no such table". A tombstone-replay test covers each table (`account_tombstones.replay_on_db`).
- **Cross-member rail:** every engine source, the routine and tracker reads and writes, drill-down, viewer overrides and the result cache run with a second member's data present, including a note body that names another member's definition, routine or tracker id, in app mode and in every public mode (`share`, `publish`, `gallery`, `example`); nothing crosses, and two members with the same plan hash never share a cache entry.

## 10. Template library

- **Official templates, about 30**, each an existing journal style (`j2_journal_styles`) with slots filled server-side when used, listed in the existing templates and journal-styles surfaces (TemplatePicker, the community style library) under the name **Template library**. Categories follow a trader's routine:
  - The night before: Night-before prep (tomorrow's watchlist and levels; routine slots bound "for the next trading day")
  - Before the open: Pre-market prep · Game plan · Earnings day prep · Watchlist review
  - During the day: Mid-day and risk check · Trade plan (one idea)
  - After the close: End-of-day recap · Tag today's trades (setup, mistakes, emotions for broker-imported trades, one row each) · Trade replay and rules check (released as Trade post-mortem; renamed 2026-10-27 so it is not read as a twin of the built-in Trade Post-Mortem) · Mistake log entry · Tilt reset
  - Weekly / monthly: Weekly review · Weekend swing review (open positions, stops, earnings next week; routine slots bound "for the trading week") · Monthly review · Quarterly edge review · Year in review · Goal setting
  - Playbook: Setup study (fills with my stats on that setup) · New setup idea · Rules review · Options trade plan (strategy, max loss, IV, expiry)
  - Mindset: Pre-session check-in (sleep, mood, focus trackers)
  - Challenges: Prop-firm challenge tracker · 30-day consistency challenge
  - Habits: Morning routine · Trading-day tracker set
- **Slots, in the grammar that already exists.** Today only six snapshot kinds can fill a slot (`journal_styles.SNAPSHOT_SLOT_KINDS`), and `PLACEHOLDER_RE` / `BLOCK_ID_RE` (`journal_styles.py:780`, `:52`, client twin `outlineText.js:7`) accept no colon. Phase 2 slots are **instance block ids the existing regex already accepts**: `built_<k>`, `routine_<k>`, `tracker_<k>`, where `<k>` is 1–2 lowercase letters or digits unique within the template (for example `{{block:built_a}}`). The target lives in the block's settings, never in the id: `{"ref": "shelf:equity_curve"}`, `{"ref": "inline:<key>"}`, `{"template": "premarket_routine", "bind": "next-trading-day"}`. `PLACEHOLDER_RE`, `BLOCK_ID_RE` and `outlineText.js` do not change; `KNOWN_BLOCKS` membership becomes a prefix test for the three families; `_clean_blocks` reduces their settings through a new `slot_settings_of(family, settings)` rather than `notebook_widgets.settings_of` (which keeps only short `SETTING_KEYS` strings). A template can hold several built widgets, because each has its own instance id (the "each block id once" rule, `journal_styles.py:323-326`, is unchanged).
- **Definition copies embedded in the payload:** a template that uses member definitions carries them inline, `payload_json.definitions = [{key, plan}]`, each reduced by the §9 reducer when shared, with each slot's ref rewritten to `inline:<key>`. On use or adoption (`template_gallery.adopt_style`), every inline definition becomes a new `j2_widget_definitions` row owned by the member, with `source_gallery_id`, after the pick-yours sheet resolves its slots; the member's style refs are rewritten in the same transaction. A ref that does not resolve for the current member is a slot sentence ("This widget is not in your account"), never a read of another member's row. Member definition ids in slots are validated as owned at fill time.
- **Routines and trackers in templates:** using a template that contains a routine or tracker slot asks once per slot: "Use your **Morning routine** · Create **Pre-market routine** from the template". The member's own routine whose name or items best match is pre-selected, and the choice is remembered for that template. Creation is unique on `(user_id, source_template_key)`, so using the template in two tabs never creates two routines. A routine created this way is listed in My tools as "From template: Pre-market prep", and deleting the note never deletes it. Slots bind to the new note's day as described in §6.2.
- **Preview with my data** runs through the same batched examples path (§5.7), only when a signed-in member opens one template's detail, never for list cards, and only for that member's own data, filling as the viewer for slots whose source the viewer owns. It shares the existing `notebook-gallery-preview` rate scope (60/hour) and is cached per (template version, viewer, ET day) for 300 s. List cards keep the current "fills in with your own data" sentence; a member with fewer than 5 trades sees the "Sample data" preview (§5.2). The existing `SKIP_SENTENCES` "widget-preview" wording is unchanged for any surface that still does not fill.
- **Members save any note as a template** (the existing "Save as template" door), and share it through the community style library (existing review-before-listing, rate limits and reducer, extended by §9). Shared templates carry structure and embedded definition copies, never values.
- **Gallery card information:** what it is for (one line), what it contains (widget list), "used by N traders", last updated, author handle, helpful count (existing). Ratings are the existing "helpful" mark, allowed only after the member has used the item on 3 different days. For templates the rule reads `SELECT COUNT(DISTINCT substr(created_at,1,10)) FROM j2_notes WHERE user_id=? AND style_id=?`; for widget, routine and tracker items it reads `j2_gallery_use_days (user_id, item_id, day)`. On the 3rd day a template is used, its note shows one dismissible line: "Was Pre-market prep helpful? Yes · Not really".

## 11. Bytes first (phase 2, wave 7)

Before any new kind ships, free first-open room so phase 2 never fights the budget. Lazy kind metadata is **not** used: the render path and the archive privacy gate read `account`, `paramsSchema` and friends synchronously (`WidgetEmbedView.jsx:592` fails open while `account` is unloaded), and it would save under 5 KB.

1. **Measure first.** A baseline commit records a real build: `npm run build`, then `tools/notebook_perf_budgets.py --dist app/dist`, written into `docs/notebook/perf-budgets.md` with the build's SHA. Nothing in this section is a measured byte figure until that artifact exists.
2. **Candidates are only Notebook-owned modules that are verifiably eager in that build's chunk graph and safe to make lazy.** In order, from the feasibility review's dependency map (source bytes, which overstate minified bytes):
   1. `lib/notebookTemplates.js` (66,299 B source) behind an async `loadTemplates()`, with `getTemplate` awaited at its call sites (`NotebookTab.jsx:1804`, `:1926`, `:2335`, `noteCreation.js:95`) and preloaded on idle. Making TemplatePicker lazy alone does not free it.
   2. `BulkActionBar.jsx` (18,039 B), mounted on first selection.
   3. `TemplatePicker.jsx` (22,181 B), with an anchor-preserving skeleton so the tour's gallery door still lands.
   4. `lib/emojiData.js` (13,937 B), loaded on the first `:`.
   5. `SavedViewEditor.jsx`, `NoteConnectorsTrustStrip.jsx`, `onboarding/sampleNotebook.js`, only if the build shows them eager.
   `ResearchHome.jsx` (the landing view) stays eager unless 1–4 fall short, and then it is preloaded at route entry. `AiActionsPanel` is already lazy and is not a candidate. `drawingsStore.js` belongs to the charts programme and is not touched.
3. **Floor:** at least 25 KB of headroom to proceed (aim for 40 KB). Below 25 KB, stop and report; never raise the budget. **Terminal code is never touched** by this workstream (§16.8).
4. Each move is its own measured commit with the byte delta in the message. The two rails that parse kind files (`tests/test_journal_styles_compose.py:620-634`, `tests/test_public_note_payload.py:38`) are unaffected, because kind metadata does not move.
5. New phase 2 rows (the `builtWidget` registry row, the two trader-block rows, the dedicated shelf kinds) are counted against the measured headroom; the shelf definitions, the sample book and "My tools" data are server-side or lazy and add no first-open bytes. The "Mine" list and routine reads stay off the first-open path. The perf harness opens a note containing each new kind.

## 12. Research summary (inputs to this design)

- **Codebase:** widget pipeline, extension points, gallery, per-day stores and byte map: research report 1 (2026-10-24), summarised in §3 and §5.6–5.7. Notable: `params` is free JSON; `normalizeParams` drops undeclared keys; `readSets` drops presets of unknown kinds (built widgets get no presets, §4.1); slots run on their own pool with a 4 s budget.
- **Member data:** every member-owned dataset with columns, scope rules and helpers: research report 2, summarised in §5.3. Notable: J2 is current, J1 dead; three scope shapes disagree (`'_all_'` means Compass-enabled accounts only), so the builder offers only "all accounts" or one account; `watchlist_items` has no `user_id`; public watchlists and the community feed are not "own data"; J2 trades carry `hour_et` but no entry or exit time column, so hold time in minutes needs times the member's trades may not have.
- **Competitors:** Tradezella, TradesViz, TraderSync, Tradervue, Edgewonk, Notion, Coda, Obsidian (Dataview, Tracker), Airtable, Metabase, habit apps: research report 3. Ideas taken: template-first start with live preview on own data or sample data (Metabase/Notion), viewer settings on a placed widget (Airtable/Apple widgets), sample-size badges and drill-down, Edgewonk's cost-of-mistakes and plan-adherence-vs-equity, forgiving streaks with consistency score, quiet milestones and negative habits (Streaks/Loop), market-calendar-aware schedules, definitions-not-values sharing with opt-in updates (Notion template pain), small formula language (Notion/Coda cautionary). Reddit could not be fetched; sentiment came from review sites and vendor forums.
- **Reviews (2026-10-24):** product/UX, safety and feasibility reviews of the first draft, in `nbw-p2-research/review-{ux,safety,feasibility}.md`; dispositions in §17.

## 13. Waves and flags

Same delivery shape as phase 1: each wave dark behind its own flag, reviewed, browser-walked at 1200/820/390 (the builder also with the keyboard open at 390 px, and with VoiceOver on iOS Safari 17), then switched on one at a time with a production check.

**Flags W8–W11 are wired in ONE commit per wave, in every place the phase 1 flags live:** the `auth.NOTEBOOK_FLAGS` row (`api/routers/auth.py:285-290`, default False), the `FLAG_FALLBACKS` row (`lib/offline/notebookFlags.js:84-89`), the `WAVES` entry (`lib/notebookWidgetsFlags.js`, gating `widgetsWaveOn`), the `docs/feature_flags.json` entry (status `dark`), plus `KIND_WAVE` rows for the wave's kinds, `served_style`'s `_slot_wave_off` coverage for its slot families, and the pins in `tests/test_notebook_flags.py`. The server reads them through `notebook_widgets_wave_on` (`notebook_widgets.py:278-281`). Payload keys are latched per tab, so a flip reaches a member on reload. Wave 7 has no flag.

| Wave | Flag | Tasks |
|---|---|---|
| 7 | none (bytes only) | 1. Baseline measured-bytes commit (`perf-budgets.md`). 2. `notebookTemplates` async load. 3. BulkActionBar lazy. 4. TemplatePicker lazy with a tour-anchor skeleton. 5. emojiData lazy. 6. Further Notebook-owned candidates only if the build shows them eager. Each its own measured commit; stop and report if headroom is below 25 KB. |
| 8 | `NOTEBOOK_WIDGETS_W8_ENABLED` | 1. Flag wiring in all places (above). 2. `trading_days.py` with tests (weekends, holidays, half days, calendar horizon). 3. Shared measure module with `min_n`, the ~11 new measures, the builder PF cap at "5+", parity rail against `analytics.get_analytics`; `metrics_registry` card output unchanged. 4. `widget_engine/plan.py` (validate, upgrade, unknown-version refusal) as a pure module with exhaustive refusal tests and the injection fuzz rail. 5. `sources.py` and `compile.py` for closed trades, open positions and trading days (incl. options day P&L), with the cross-member isolation rail. 6. `run.py`: admission gate on the phase 1 pool with the reserved builder share, descending scan with LIMIT 5,001, SQL deadline, data-stamped cache, `SingleFlight`, batched daily counter, NaN/Infinity to null. 7. `widget_definitions.py`: tables, revisions (50 kept, 60 s coalesce, named), `If-Match`, `placed_rev`, purge rows and tombstone replay. 8. `j2_tool_uses` projection on note save. 9. Router: `/run`, `/preview`, `/examples`, `/drill`, `/vocabulary`, `/shelf`, CRUD and revs. 10. `builtWidget` server kind: `KIND_WAVE`, `ACCOUNT_KINDS`, `KIND_TITLE`, `source_detail`, `cap_payload(list_key)`, echoed keys. 11. Public payload rows with fixed row keys; archive capture excludes the summary. 12. Client: registry and `WIDGET_KINDS` rows, `BuiltWidgetEmbed` and the inline SVG views with table alternatives, `lib/builtWidgets.js` refresh merge and Change fields, "Updated version available". 13. `WidgetBuilderSheet` (lazy): flow, push-in pickers, draft resume, update-all / save-as-new question, examples gallery with batched cards and the bundled sample data, empty states, the §5.10 failure copy, §5.11 accessibility. 14. My tools: Widgets tab with used-in, version history, archive/restore. 15. Mine group in `/`, synonyms, `/build` and `/widgets`. 16. Browser walk at 1200, 820 and 390 px, keyboard-open and VoiceOver passes. |
| 9 | `NOTEBOOK_WIDGETS_W9_ENABLED` | 1. Flag wiring. 2. Routine and tracker tables (per-item ticks, skipped flag, versioned schedules, values, reminder claims) plus purge rows and tombstone replay. 3. Done/not-done and consistency derivation over `trading_days.py` (pure, table-tested across weekends, holidays, half days, horizon days, schedule changes, late ticks). 4. Per-item tick, skip and log endpoints that touch no `j2_notes` row; batched reads; ownership re-check; 7-trading-day window; rates and field caps. 5. `RoutineBlock` and `TrackerBlock` as trader blocks: no params writes from live state, BroadcastChannel adoption, offline and flag-off copy, day binding and Follow today; the `doorEnumeration` rail stays green; open/tick/failure rails. 6. "vs P&L" comparisons, suggested-from-your-trades items, milestones, no-zero rule. 7. Routine history and tracker history as builder sources. 8. Reminders through the bell, off by default, claim log. 9. My tools: Routines and Trackers tabs; `/routine` and `/track`. 10. Public neutral line rows. 11. Browser walk. |
| 10 | `NOTEBOOK_WIDGETS_W10_ENABLED` | 1. Flag wiring. 2. Widget formula dialect, server and client, own tokenizer, shared vectors. 3. Options and notes sources. 4. Shelf revision files (immutable, with a hash rail), `GET /shelf`, and the "Updated version available" control for shelf updates. 5. The shelf definitions (§8) and the dedicated shelf builders in `_BUILDERS` (tilt check, revenge clean days, plan vs actual, risk left today, prop-firm rules, game plan, alerts fired). 6. The position size calculator item. 7. Browser walk. |
| 11 | `NOTEBOOK_WIDGETS_W11_ENABLED` | 1. Flag wiring. 2. Slot instance ids `built_<k>`, `routine_<k>`, `tracker_<k>` with `slot_settings_of` and the prefix `KNOWN_BLOCKS` test. 3. Inline definition copies on save and share; id remap on use and adopt. 4. The shared sharing reducer for widgets, routines, trackers and templates, the share preview, and the canary rail. 5. New gallery item types in both `ITEM_TYPES` files; `j2_gallery_use_days`; former-member credit. 6. Adoption sheet with immediate preview and suggested slot values. 7. Template routine/tracker reuse question with the unique key; next-trading-day and trading-week binding. 8. Preview with my data on template detail through the batched path. 9. About 30 official templates. 10. Helpful 3-day rule and the 3rd-day prompt. 11. My tools: Templates tab. 12. Browser walk. |

Rollback per wave: set its flag to `0` (never a delete). Stored definitions, routines, trackers and templates stay and reappear when the wave is switched back on; with the flag off, placed widgets keep their snapshots and routine/tracker blocks say "Not available right now".

## 14. Decisions made for the owner (my calls, to check while reading)

1. One engine and one measure module for builder, shelf and templates (§4, §5.4).
2. Builder offers "All my accounts" or one account; never the Compass-only scope (§2, §5.1).
3. Routines and trackers are live trader blocks whose state never enters the note; built widgets stay snapshots (§6.2).
4. Forgiving routines by default; strict mode opt-in; no broken-streak messages and no streak shown as 0; reminders off by default (§6.1).
5. Sharing is structure-only through one reducer, with member values stripped to "pick yours" slots and shared templates carrying definition copies (§9, §10).
6. Scan cap 5,000 rows (descending, before aggregation) and a 1.5 s SQL deadline per builder query; "Based on your newest 5,000 trades" over the cap (§5.7).
7. Small-sample rule: badge under 20, hidden value under 5, in each measure's own unit, with per-trade-value coverage stated (§5.2).
8. Formula language: a separate, small dialect of about 15 functions; `formula_engine.py` and `formulaVectors.json` unchanged (§5.5).
9. Bytes first: measure a real build, then ≥25 KB headroom from Notebook-owned lazy moves before new kinds (§11).
10. AI "describe your widget" (a sentence → a plan the member can see and edit) is **not** in this phase; it is a natural follow-up once the plan language is proven, and would ride the existing LLM cost guards.
11. Every placement pins a revision; editing a widget used elsewhere asks "Update all N notes" or "Save as a new widget" (§5.2, §16.1).
12. Four member-facing nouns: Widget, Routine, Tracker, Template; Preset keeps its phase 1 meaning (§4.1).
13. One management place, My tools (§5.8).
14. Default date range "Last 90 days" (§5.1).

## 15. Left to the builder

- Exact visual design of the builder sheet and My tools within the existing Notebook design tokens and components (Sheet, ContextPopover, UIcon).
- Chart rendering for builder views: **inline SVG components in the lazy snapshot chunk**, the way phase 1 embeds draw (`MyPnlStatsEmbed.jsx:68-70`, `TradeRecapEmbed.jsx:83-90` use `<polyline>`); no ECharts and no lightweight-charts in note embeds, and no static import of any chart engine (phase 1 rule).
- Exact SQL per source and field, and the exact data-stamp columns per source, within §5.7's rules.
- Copy for every label and sentence not fixed in §5.10, plain words, no emoji, following phase 1's copy style.
- Builder controls meet the 44 px floor at every tier, enforced by the existing tap-floor rail.
- Test design, within the repo rules (rendered-text assertions, non-vacuity controls, mutation proofs for guards).

## 16. Builder-check answers (my calls, settled 2026-10-24; updated by the review rulings)

An independent builder read the first draft and asked nine questions. The owner delegated every decision, so each is settled here as my call. Where a review ruling replaced an answer, the answer below is the current one and says what it superseded.

1. **No placed widget changes silently: every placement pins `defRev`, including the member's own** (supersedes the first answer, which let a member's own definition run its current revision). Shelf definitions ship as immutable versioned files on the server (`shelf:<id>`, namespaced so they can never collide with a member's ids), each with a revision number and a hash rail. A widget placed from the shelf, adopted from the library, or built by the member pins its `defRev`; "See it now" re-runs that revision, or the definition's `placed_rev` when the member chose "Update all N notes". When a newer unapproved revision exists, the frame shows a quiet "Updated version available" control that previews the change and applies it only on click. "Save as a copy" from a placed widget replaces that widget in that note.
2. **Formulas are a separate widget dialect** (see §5.5), with its own tokenizer. The note-property formula language and its vector file are untouched.
3. **A routine or tracker in a note is bound to a day** (supersedes the first answer's "Today" default for templates and its public render-time read). On insert, `day` = the note's own day (daily note date, day-note date, otherwise the note's created ET day). Reopening a 10/14 note next month shows 10/14 (phase 1 G4). Templates bind at instantiation to the new note's day, with "For the next trading day" (night-before prep) and "For the trading week" (weekend reviews) options. "Follow today" exists as a block setting and is never a template default. Public, shared and gallery pages show the neutral line in phase 2; no day state travels and the public reducer makes no database read.
4. **Trading days source:** one row per market session in the range (`session_calendar.is_trading_day`, through `trading_days.py`), including sessions with no trades; beyond the calendar's coverage, weekdays only with a quiet note; half days are sessions. Day measures that need trades (average day P&L, green-day %, win rate that day) count only days with trades and say so. Day net P&L includes closed options strategies, as the calendar does, and says so. "Days I trade" means a closed trade, an opened trade or an options strategy on that ET day; entry days come from `compute_trading_day_et`, and broker placeholder entry dates are excluded and counted. Routine consistency = done / (scheduled − skipped), always shown with the skip count, derived at read time with the schedule version effective each day. Several check-ins in one day: the latest by the note's `updated_at` wins.
5. **Wave 9 is online-only.** Ticks and logs need a connection; offline the controls are disabled with a plain sentence. No change to the Notebook offline outbox in phase 2 (it is note-shaped and carries an incident history), and none is needed: routine and tracker blocks never write live state into the note. An offline queue for ticks is a possible follow-up.
6. **Phase 1 kinds stay exactly as they are.** No near-duplicate shelf entries are added for them (calendar, setup edge, mistakes, rules, positions near stop stay phase 1 widgets). "Edit" and "How this is made" apply to built widgets and shelf definitions only. "Make an editable copy" for phase 1 kinds is dropped entirely (supersedes the first answer). Phase 1 code is not changed in wave 10.
7. **"Pick yours" on adoption:** the adopt sheet lists each stripped value as a typed slot (setup, tag, symbol, account, property, folder, note kind, routine, tracker, number), shows a working preview immediately using each slot's suggested value (the member's most-used value of that type), and offers "Any" where dropping the filter makes sense. The member can change slots before saving, or accept all with one tap of "Use". Saving requires every slot resolved, so a saved definition never contains an unresolved slot. "Bound by role" means exactly this: the slot keeps its type and takes the member's own value.
8. **Terminal code is not moved by this workstream** (§11). Measure a real build first; candidates are only Notebook-owned modules verifiably eager and safe to make lazy; proceed at 25 KB or more of headroom; below that, stop and report. The budget is never raised. Lazy kind metadata is dropped.
9. **Measures live in one shared measure module** (`api/services/journal_two/measures.py`) used by the builder and by new analytics code, with a per-measure minimum sample defined there (supersedes the first answer, which put them in `metrics_registry` itself). Existing measures reuse `metrics_registry` definitions; its card output is not changed. The builder's profit factor uses the analytics cap of 5, shown as "5+". The §5.2 small-sample rule (badge under 20, hidden under 5) is the floor for any measure without a stricter minimum.

## 17. Review dispositions

Three reviews of the first draft (2026-10-24): product/UX (`review-ux.md`, 29 findings), safety (`review-safety.md`, 27 findings), feasibility (`review-feasibility.md`, 31 findings). Owner-delegated rulings settled every conflict between them. Every finding not listed below was **accepted and integrated** into the section it concerns (the waves table in §13 carries its tasks). The table records only findings, or parts of findings, that were **rejected or replaced**, with the reason.

| Finding | Disposition | Why |
|---|---|---|
| UX C1 (My tools replaces "Manage chart sets"; phase 1 presets and chart sets move into the Widgets tab) | Part rejected | Preset keeps its phase 1 meaning (ruling 1); phase 1 presets and chart sets stay in their dialog, which My tools links to. The rest of C1 is in §5.8. |
| UX C2 (phase 1 widget presets become "mine" widgets; `/` "My presets" renamed "Mine") | Part rejected | Same ruling: presets stay presets and "My presets" keeps its name; a separate Mine group holds widgets, routines and trackers (§4.1). |
| UX C3 (per-routine "This routine is for: next session / session that just ended") | Replaced | Ruling 3 binds to the note's day, with "for the next trading day" and "for the trading week" options at template use; one binding model instead of two (§6.2). |
| UX I3 ("Make an editable copy" as the customise path for phase 1 twins) | Part rejected | Ruling 13 drops "Make an editable copy" for phase 1 kinds entirely; the twin rows are still removed. |
| UX I4 (prop-firm profit target, minimum days and consistency rule) | Part deferred | Ruling 13 scopes the prop-firm tracker to member-entered daily loss and max drawdown limits; the other rules are a follow-up. |
| UX I7 (default "last 30 days, else last 50 trades"; custom N) | Replaced | Ruling 14: one fixed default, "Last 90 days", which avoids a default that changes with the member's data; Last N trades offers 20/50/100. |
| UX I10 ("Edit anyway" behind a confirm in strict mode) | Part rejected | Ruling 4 enforces the 7-day window server-side with no override; "7 days" is counted as 7 trading days so a long weekend never shortens it. |
| UX M4 ("Also email me" reminders) | Part rejected | Reminders stay bell-only (safety M8): the alert delivery path also emails and posts to Discord, and a reminder must not add outbound channels in phase 2. Local time beside ET is adopted. |
| Safety C1 (public pages read routine state as the note's owner) | Replaced | Ruling 3: public pages show the neutral line, so no public database read exists; ownership by session user and uuid4 ids are adopted. |
| Safety I2 (previews at 60/min) | Part rejected | Ruling 5 keeps previews at 120/min in their own scope, stated honestly as looser than the widget rate; one-in-flight and the preview worker cap are adopted. |
| Safety I4 (one wall-clock budget across SQL and post-processing, checked every 256 rows) | Part replaced | Ruling 5: the deadline covers SQL, and post-processing is bounded by the 5,000-row cap and measured on a 50,000-trade fixture. |
| Safety I8 (days after the calendar's coverage count as "unknown"; "Today" means the next session after 16:00 ET) | Part replaced | Ruling 4: beyond coverage, weekdays only with a quiet note. After 16:00 ET "today" stays the current session, because end-of-day review routines are ticked after the close for that day. |
| Safety M12 (server-signed `computedAt` on shared results) | Rejected | Phase 1 snapshot embeds have the same property and sit in a page that is the member's own note; a signature is a cross-kind change for a later phase, not a phase 2 widget task. |
| Safety M13 (first `/` press becomes a round trip under a lazy manifest) | Moot | The lazy manifest is dropped (ruling 12); the rest of M13 is in §11. |
| Feasibility C2 (add `defId`, `defRev`, `range`, `accountId`, `filter` to `SETTING_KEYS`/`SETTINGS_KEYS`) | Replaced | Built widgets refresh through their own POST route and lazy merge with server echo (ruling 9), so phase 1's pinned key lists do not move (§5.6). |
| Feasibility C3 (its replacement step: an optional lazy kind copy split) | Part rejected | The finding's diagnosis is adopted (lazy kind metadata is dropped, ruling 12); its proposed copy split is not, because the saving is under 5 KB and it still moves two parsing rails. |
| Feasibility I3 (cap profit factor at 5 inside `metrics_registry`'s vocabulary) | Rejected | Ruling 11: the builder applies the cap; the registry's card output is not changed, so no existing card or report moves (§5.4). |
| Feasibility I7 (one request for every example card) | Replaced | Ruling 6: at most 8 cards per request, loaded as they scroll into view, cached per member. |
| Feasibility I15 (scope sentence on "Make an editable copy" of `mySetupEdge`) | Moot | "Make an editable copy" is dropped (ruling 13). |

Counts: 87 findings; 85 addressed in the design (17 of them with a part replaced, deferred or rejected as above); 2 not adopted (safety M12 rejected; feasibility I15 moot).
