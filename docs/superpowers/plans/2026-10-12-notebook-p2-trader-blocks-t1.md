# Notebook P2 Tier 1 (part a): Trader Blocks Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can put live trader blocks into a note, by hand (slash menu, Trading group) or through a journal style: a pre-entry checklist (also offered in Log Trade as a soft check), a frozen market context stamp, price-stamped lines, and a house-formula position sizer. Every block keeps its state in the note's own `widgetEmbed` node and changes only through an editor transaction. Ships dark behind `NOTEBOOK_JOURNAL_STYLES_ENABLED` and is paid.

**Architecture:**
- **A block is a widget kind.** The three new blocks (`preEntryChecklist`, `priceStamps`, `positionSizing`) are `widgetEmbed` nodes whose `widgetId` is a block id, registered in `app/src/widgets/registry.js` as capture-only entries with a `block: true` marker and bound in `BLOCK_COMPONENTS` (never `EMBED_COMPONENTS`). `WidgetEmbedView` hands any block to a lazy `BlockNodeView`, which owns the empty, error and "needs a switch" states and gives the block body ONE way to change its state: `setParams`, an editor transaction through TipTap's `updateAttributes`.
- **The market context stamp is the existing `marketcontext` widget, extended** (IR-S6). It already freezes the wire's phase, exposure and breadth into `params.readings` and renders through `MarketContextEmbed`. Part a adds the regime, SPY, QQQ and VIX to the same `readings` object (additive keys an older capture simply lacks), a `fields` preset, and an "uncaptured" state for a note that gains the block after it was written. No second market-context kind.
- **No new write door.** Blocks READ server data through existing endpoints or one new read route (`GET /api/j2/trader-blocks/market-context`). The only new write route (`PUT /api/j2/trader-blocks/positions/{id}/pre-entry`) writes the adherence store, never a note. A rail fails if any block file sends a non-GET request that is not a named method+URL exception, and the door census is re-run after every task that could move it.
- **Styles reuse P1 unchanged.** Each block gets a row in BOTH catalogs (`journal_styles.BLOCK_KINDS` and `lib/journalBlocks.js`, railed) and a server builder in `BLOCK_BUILDERS`, exactly the seam P1 left. The built-in Trade plan style moves to version 2 and includes the checklist, the sizer and the market context stamp, so "Update layout to v2" offers them to Trade plan notes already written (the stamp arrives uncaptured, IR-S11).
- **Every new surface is a lazy chunk.** The first-open closure gains only the registry rows, the dispatcher line, the slash items and the price-stamp extension stub (which loads the ticker resolver only on its first use, IR-S12).

**Tech Stack:** FastAPI + SQLite (`auth.db`, `j2_` tables), React + Vite, TipTap 3 (3.23.6) / ProseMirror, vitest + Testing Library, acorn, pytest, Python Playwright walk tools.

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`, §P2 preamble (lines 219-232) and Tier 1 items 1, 3, 4 and 5 (lines 235-258). Also §0, §1, §2, §6, §7 (decisions 1 and 5 taken as recommended) and §8. Part b (`docs/superpowers/plans/2026-10-12-notebook-p2b-rules-packs-t1.md`) carries items 2, 6 and 7, rule versions, the before/after insight, M-7 and the NVDA pass.

**Base:** `origin/master` at Task 0 time, which must contain master `d92fca5be9` AND the list caret (PR #320, head `4089c8a5a8`; Task 0 Step 1 checks both and stops if the caret has not merged). P1 is in master (`ed39eb2038` merge commit, P1 tip `3704241461`).

**Pre-flight:** `.superpowers/sdd/2026-10-12-notebook-p2-trader-blocks-t1/preflight.md` (5 Blocking, 24 Should-fix, 13 Notes). This revision answers every item; the Rulings section records the integrator's rulings and the Dispositions section says what happened to each remaining item.

## Why two plans

Tier 1 is 5-6 agent-days (spec §8) and splits cleanly on one seam: **does the block need a new table?** Part a (this plan) builds the block platform and the four blocks that need no new table, and lands as its own dark PR, so the platform is gated, walked and byte-measured before six more blocks stand on it. Part b adds the one new table (`j2_journal_rule_versions`), the rule-editing door, the Insights card, the two packs, M-7 and the arming checks. The interface between them is named in Task 7 (`rule.beforeEntry`), Task 1A (`BLOCK_BUILDERS`, the catalog rows) and Task 6 (`BLOCK_COMPONENTS`, `BLOCK_IDS` in `registry.test.js`, the vendor rows). Arming happens once, after part b.

## Rulings this plan makes (each also in the PR body)

Each ruling reads **Ruling: what — why — cost if wrong.** `IR-*` are the integrator's rulings from the pre-flight review (recorded verbatim in substance); `R-P2-*` are this plan's own.

### Integrator rulings (pre-flight round)

- **IR-B1.** Ruling: every `app/node_modules` junction in this plan targets `C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules`; a junction is removed ONLY with the non-recursive `cmd /c rmdir <link>` from the PowerShell tool, after `Get-Item -Force` proves it is that junction, and the target is counted (`Get-ChildItem -Force`) before and after: 377 entries both times — why: the old target `notebook-k\app\node_modules` does not exist, and a recursive delete through a junction empties the shared install every Notebook worktree runs on (CLAUDE.md, 2026-09-13: 368 packages lost that way) — cost if wrong: every worktree junctioned to the shared install loses vitest at once, and the repair (`npm ci` on a quiet box) blocks all Notebook lanes.
- **IR-B2.** Ruling: the three P2a blocks keep `block: true` and are bound in `BLOCK_COMPONENTS` (`blocks/BlockNodeView.jsx`), never in `EMBED_COMPONENTS`; the registry embed-binding rail (`registry.test.js`, "reconstructable widgets and journal embed bindings cannot drift apart") gets an explicit `block: true` branch, a new rail asserts every `block: true` id has exactly one `BLOCK_COMPONENTS` entry and no non-block id has one (with a control), and `IDS`, the three label maps and the defaults table are updated in the same task (Task 6) — why: `registry.test.js` pins `expect(WIDGET_IDS).toEqual(IDS)` (`:56`) and fires `${id} has no journal renderer` for capture-only kinds (`:577`), so a block registered without these edits reds four pins at once — cost if wrong: a block bound in the embed host would get the embed toolbar, archive and resize, none of which a block's params state survives.
- **IR-B3.** Ruling: each block gets its `public_note_payload.MARKET_DATA_VENDORS` row in the task that registers it: `preEntryChecklist` and `positionSizing` are `private`, `priceStamps` follows the `("financialFact", "massive")` price row (`massive`), and the market context keeps its existing `("widgetEmbed", "marketcontext"): "mixed"` row; `tests/test_public_note_payload.py` joins every run list that touches the registry and the landing rails — why: `test_every_registered_widget_has_a_vendor_row` parametrizes over the client registry, so an unlisted id is red, and the verdict a stranger sees is the owner's legal table — cost if wrong: a shared or published note shows a block whose data a vendor's terms do not allow, or hides one that is fine (each is one row to flip).
- **IR-B4.** Ruling: one worktree and branch PER LANE (`notebook-p2-<lane>`, each with its own `.uct-session-owner` and junction); the integrator merges lanes into `notebook-p2-blocks` in the order the shared-files table states; the shared client catalog pieces Task 6 needs (`journalBlocks.js` labels, `search` rows, option labels, `blockSearch`/`optionWord`) move to the W0 foundation (Task 1A) so the W1 lanes share no file; P2b uses `notebook-p2b-*` — why: lanes in one tree share an index (CLAUDE.md, `a9b4916e5`), and lanes S and C both edited `journalBlocks.js` — cost if wrong: a lane commits another lane's staged file, or a merge conflict lands in the catalog the parity rail reads.
- **IR-B5.** Ruling: `blockDoors.test.js` starts with an EMPTY `WRITE_EXCEPTIONS`; each task that creates a writing file adds that file's own method+URL entries in the same commit (Task 8: `logTradeChecklist.js`; Task 10: `priceStamps*.js`), so the rail is green at every task boundary — why: an exception naming a file that does not exist yet fails "every exception names a file that exists", which made Task 6 red until Tasks 8 and 10 landed — cost if wrong: a lane reports "all pass" over a red rail, or loosens the rail to get green.
- **IR-S1.** Ruling: `builtin:regime_at_write` is filtered server-side before any write that did not come from the composer: `set_note_properties` drops a captured built-in from every member patch, whatever its form (`properties` or `propertiesReplace`), and a replace (a version restore) carries the note's CURRENT captured value forward; only `create_note(..., captured_properties="keep")`, called by the composer, ever writes it — why: `update_note_endpoint` forwards the member's dict, popping only `baseUpdatedAt` and `locked` (`api/routers/journal_two.py:3610`, `:3614`), so a mode keyed on `propertiesReplace` is member-reachable — cost if wrong: a member can relabel a note's regime and the RED/ORANGE board lies.
- **IR-S2.** Ruling: tests expect `notes.NoteValidationError`, the type `update_note`/`create_note` actually raise (`notes.py:3320-3321`, `:3768-3769`: `except PropertyValidationError as e: raise NoteValidationError(str(e)) from e`) — why: the old test caught the inner type and would have passed or failed for the wrong reason — cost if wrong: none once it reads the real type.
- **IR-S3.** Ruling: a pending price stamp tracks its line by the line's START mapped with `assoc = 1`; `mapResult(pos, 1).deleted` is true exactly when the line was deleted, and then nothing is inserted — why: with `assoc = -1` at a deleted line's start ProseMirror reports `deleted === false`, so the plan's own "a deleted line takes no stamp" test failed against the plan's code — cost if wrong: a stamp lands under the wrong line.
- **IR-S4.** Ruling: every sourced field the market context stores carries a `missing` SENTENCE (from a fixed table of codes), never entry_context's `detail` object — why: `_breadth_field` answers `detail: {"liveUnavailable": …}` (`entry_context.py:368-371`), and React throws on an object child — cost if wrong: a cold cache blanks the block.
- **IR-S5.** Ruling: VIX shows "VIX unavailable" in part a: no source entry context reads carries a VIX quote (`entry_context.py` has no VIX reader; `breadth_live.py:125` lists `vix` under `NOT_LIVE`; `live_prices.py` never quotes it). SPY and QQQ are read through `live_prices.get_live_prices` (the shared 15 s per-ticker cache, then one bounded fetch under the same valve), and every stored price carries the vendor's own `observed_at`, shown on screen as "as of HH:MM ET" (or "last close" when the market is closed) — why: a price older than its cache age must never be stamped without saying so, and a cache-only read was usually empty — cost if wrong: the stamp lacks VIX until a dated VIX source is chosen (owner decision O-3).
- **IR-S6.** Ruling: the market context block IS the existing `marketcontext` widget (registry `:464`, `EMBED_COMPONENTS.marketcontext` → `MarketContextEmbed.jsx`, vendor row `:180`), with new additive keys in `params.readings`; no `marketContext` id is added — why: spec §1, "build on what exists, never beside it", and a case-only-different id beside a live kind is a trap for every grep — cost if wrong: the /charts board widget and the note stamp share a renderer, so a rendering change reaches both (the new rows render only when their keys are present, which a board reading never has).
- **IR-S7.** Ruling: the two Log Trade doors (`LogTradeButton.jsx`, `JournalLogFab.jsx`) pass `preEntryChecklist` to both dialogs and their `handleCreateTrade` returns the created row; `AddTradeModal` keeps `onSave`'s value; the checklist renders ONLY where the dialog can save the ticks — why: `handleCreateTrade` returned nothing (`LogTradeButton.jsx:105-112`) and `AddTradeModal.handleSave` discarded `onSave`'s value (`:128`), so a closed trade's ticks were never saved while a mocked test stayed green — cost if wrong: the other two trade-adding surfaces (`TodaySurface`, `TradeJournalTab`) show no checklist until they return their row too.
- **IR-S8.** Ruling: `requireAll` is wired: in a note it is the block's own setting (the block shows "n checklist items not ticked" when it is `yes`), and in Log Trade it is the member's preference value (`notebook_log_trade_checklist` = `off` | `on` | `on-warn`), each tested for both values — why: Log Trade has no note, and a hard-coded `requireAll="yes"` made the catalog setting dead — cost if wrong: a member must set the warning twice (once per surface); the label says which surface each one governs.
- **IR-S9.** Ruling: the sizer never sizes against a placeholder account: when the account's size is unset or equals `accounts._DEFAULT_ACCOUNT_SIZE` (`accounts.py:59`, `100_000.0`, written into every new account at `:67`), it says "Set your account size in Settings." and sizes nothing until the member enters a size for this note — why: every account has the default, so "no account size" could never happen and a member saw shares for $100k they do not have — cost if wrong: a member whose account really is $100,000 must type it once per note (owner decision O-4).
- **IR-S10.** Ruling: the block uses the house table ONLY, read from one in-repo file, `app/src/constants/houseSizing.json` (the single in-repo authority); `tests/test_house_sizing_table.py` PARSES uct-intelligence's `_SIZING_TABLE` with `ast` when that repo is present and compares every cell, and when it is absent reports a visible SKIP naming the paths it looked in (a SKIP is not a pass, and the PR body says which it was); the Compass / Trade-plan canvas sizer (`chart_plan` → `brain_service.size_a_trade` → engine `calculate_position_size`, risk-driven shares with an "informational" ceiling) is OUT of part a's scope, is not changed, and is recorded as a divergence for the owner (O-5) — why: the spec says "the house formula only" and the earlier plan's "rail that parses the other file" was a restatement — cost if wrong: one note can hold two sizing answers that differ until the owner rules on O-5.
- **IR-S11.** Ruling: "Update layout" adds a market context block to an EXISTING note UNCAPTURED (`params.uncaptured: true`), and the block says "Market context is captured when a note is created. This note was written before it had one." It never stamps today's market into an older note; a version restore never captures either (it restores the version's own frozen readings, or none) — why: `_plan` runs the builders at update time (`journal_styles.py:920`), and spec item 3 says "On note creation, captures" — cost if wrong: an older Trade plan note shows an empty stamp; the member can add a dated one by hand with the slash item.
- **IR-S12.** Ruling: the price-stamp extension stub in the first-open closure decides only what it can without the resolver (switch on, a `priceStamps` block set to `yes`, Enter at the end of a text line); the ticker resolver (`tickerResolver.js` imports `taxonomy/a8Taxonomy.json`, 3,286 B) and the fetch-and-insert load on first use through `importWithOneRetry` (`lib/lazyChunk.js:61`) — why: the 512 B allowance cannot hold the taxonomy — cost if wrong: the very first stamp of a session waits one chunk load (well inside the 2 s budget).
- **IR-I (integrity holes).** Ruling: (a) the block-door rail treats a `fetch` whose second argument is not an object literal (an identifier, a call, a spread) as method `?`, which is never exempt; it also flags `navigator.sendBeacon`, `XMLHttpRequest` and the `json(Post|Put|Patch|Delete)` helpers; (b) `WRITE_EXCEPTIONS` is keyed `{file: [{method, url}]}`, matched on the call's literal method AND its URL pattern, never a whole file; (c) the door census (`lib/offline/doorEnumeration.test.js`) runs after Task 5 and after Task 6, not only at baseline and the gate — why: each was a hole a block could walk through unseen — cost if wrong: a second write door ships behind a green rail.

### This plan's rulings

- **R-P2-1, the switch.** Ruling: no new flag; every P2 block rides `NOTEBOOK_JOURNAL_STYLES_ENABLED`, which gates CREATING a block (slash items, style composition, Log Trade's checklist, the new routes, a price stamp) and never RENDERING one (spec P1.7c; `docs/notebook/p1-verify-before-building.md` §c) — why: spec §2 ships P1 and P2 T1 as one release, and a rendered block writes nothing on its own — cost if wrong: after arming, a misbehaving block can only be withdrawn with the whole styles switch (P1 goes dark with it).
- **R-P2-2, price stamps are a block card, not an inline chip.** Ruling: the stamp is a `financialFact` node inserted as its own block directly after the line that named the ticker — why: the node is `group: 'block'` (`app/src/pages/journal-2-0/lib/financialFactNode.jsx:25`) and an inline variant would be a new node type (a schema level, never-revert) — cost if wrong: the stamp reads as a card under the line; an inline form later needs a schema level.
- **R-P2-3, which tickers a line "names".** Ruling: explicit cashtags (`$NVDA`) through the ONE resolver's cashtag tier (`app/src/lib/tickerResolver.js:32`, `export function resolveCashtags(text) {`), plus the note's own Ticker written as a bare word; one stamp per Enter, for the first ticker — why: the resolver's header keeps bare words on the server ("a browser that guessed bare words would be a second resolver") — cost if wrong: `NVDA` without `$` gets no stamp; the block's copy tells the member to write `$NVDA`.
- **R-P2-4, block settings stay finite.** Ruling: style-level block settings use the existing select grammar (`StyleEditor.jsx` renders every setting as a `<select>` of `options`), "which setup" is chosen in the note, and the market context's "which fields" is one of three presets (`all`, `regime`, `indexes`) — why: a free-text setting type is a change to `_clean_blocks` P1 did not make — cost if wrong: a member who wants a style pinned to one setup picks it once per note.
- **R-P2-5, the house table's cells.** Ruling: GREEN A+ 25 / A 20 / B 10, YELLOW A+ 15 / A 12 / B 6, ORANGE A+ 8 / A 5 / B 0, RED all 0, max account risk 2%, held in `app/src/constants/houseSizing.json` (IR-S10) and railed against `uct-intelligence/uct_intelligence/api.py:2775` (`_SIZING_TABLE = {`, uct-intelligence `782b879496` 2026-10-02); the spec's "GREEN A+ 20-25%" is read as the GREEN band from A (20) to A+ (25) — why: every cell the spec names agrees with the engine table — cost if wrong: an A+ in GREEN is offered 25% where the owner meant 20%; the 2% cap binds first whenever the stop is wider than 8%.
- **R-P2-6, `builtin:regime_at_write` is a captured fact.** Ruling: written once, by the composer, from the `marketcontext` stamp it composed (`readings.regime.value`); stripped from every member write and carried forward by a restore (IR-S1); "show notes written in RED/ORANGE" is the Board grouped by it (V8), not a saved view — why: `property_filter` refuses any property whose source is not `user_set` (`note_properties.py:727`, `if prop_def["source"] != "user_set":`), so a saved view on it is impossible without loosening that filter, which part a does not do — cost if wrong: the spec's "saved view" is not delivered in part a (owner decision O-2).
- **R-P2-7, Log Trade for an open position.** Ruling: ticks made while logging a CLOSED trade go to that trade's adherence record (existing `PUT /api/j2/trades/{id}/adherence`); ticks made while logging an OPEN position go to the adherence store under `pos:<position id>`, and the closed trade's adherence read falls back to that record; no new table — why: an open position has no trade ref yet — cost if wrong: the `pos:` record is read by the one GET route only, so a stored percentage that counts `rule:` items can differ from the card's (N8, recorded).
- **R-P2-8, the slash item is a member's dated stamp.** Ruling: inserting a market context block by hand (`/Market context`) captures NOW and labels the stamp with its own capture time; it never sets `builtin:regime_at_write` — why: IR-S11 forbids stamping today's market into an older note AUTOMATICALLY; a member who inserts one by hand is asking for today's reading, dated as such — cost if wrong: a member reads a hand-inserted stamp as the note's creation context (the stamp's own date line says otherwise).

### Spec conflicts ruled here

- **VIX** (spec item 3 names it): unavailable in part a (IR-S5). Owner decision O-3 picks a dated source.
- **"saved view"** (spec item 3): not built; the Board grouped by `builtin:regime_at_write` stands in (R-P2-6). Owner decision O-2.
- **"breadth score"** (spec item 3, pre-flight N10): the stamp keeps the wire's `breadth_score` (`readingsFrom`'s `breadthScore`), the field the spec names, alongside `% above 50-day` and `% above 200-day` the existing widget already shows.
- **Two sizing formulas in one Trade plan note** (pre-flight S10): the canvas sizer is untouched and recorded (O-5).
- **Shorts** (pre-flight N13): the block sizes a short (stop above entry) the same way; the Compass sizer refuses shorts (`brain_service.py`, "stop must sit below entry for a long"). Recorded as part of O-5.

## Owner decisions this plan surfaces (none blocks the build)

- **O-1.** The integrator's rulings above, as recorded.
- **O-2.** Should `property_filter` accept `source == "captured"` so "notes written in RED/ORANGE" can be a saved view? (Part a ships the Board grouping only.)
- **O-3.** A dated VIX source for the stamp (the breadth monitor's EOD `vix` row is the nearest, but it is not what entry context reads).
- **O-4.** Is $100,000 ever a real account size worth sizing against without asking? (Part a asks.)
- **O-5.** The two sizers: the block's house table (ceiling-bound, sizes shorts) versus the Compass / canvas sizer (risk-driven with an informational ceiling, refuses shorts). Which is "the house formula" for the canvas?

## Global Constraints

- Member-facing names (spec §7.1): **"Journal styles"**, **"Kind of note"**, **"outline"**, **"block"**. Block names: "Pre-entry checklist", "Market context", "Price stamps", "Position sizing".
- Every new surface requires a paid plan (owner ruling 2026-10-06). New routes live in `api/routers/notebook_journal_styles.py` and take its `require_paid` (402, `"Journal styles require a paid plan"`) behind its router-level gate (one `404 {"detail": "Not found"}` while off).
- Dark behind `NOTEBOOK_JOURNAL_STYLES_ENABLED` (R-P2-1). No new flag, so `tests/test_notebook_flags.py` `NOTEBOOK_KEYS` and `docs/feature_flags.json` do not change.
- The switch gates CREATING, never RENDERING. A note that holds a block renders it with the switch off, and an older bundle shows "This block needs a newer version of the app. Reload to see it." (`WidgetEmbedView.jsx`, `export const UNKNOWN_BLOCK_SENTENCE`) and keeps the node.
- **INTEGRITY RULE (spec §P2, non-negotiable).** A block's member state lives in the node's `params` attribute and changes ONLY through `setParams` (an editor transaction). No block file sends a non-GET request except a method+URL pair named in `WRITE_EXCEPTIONS` by the task that added it. No block owns a PUT/PATCH to a note. Server data is READ-only to a block.
- Schema: **zero schema-level bumps.** Block state rides `params` (`widgetEmbedNode.jsx`, `params: jsonAttr('data-params', {}),`), never a new attribute. A task that finds it needs a node type or attribute STOPS and reports.
- ONE FACT IN TWO FILES gets a rail that PARSES or EXECUTES the other file: the block catalog (`journal_styles.BLOCK_KINDS` ⇄ `lib/journalBlocks.js`, through Node, extended in Task 1A to `search`); the registry's enum options ⇄ the catalog's options (Task 6); the market context readings (`trader_blocks.market_context_readings` ⇄ `marketContextModel.readingsFrom`, through Node, Task 3); the house table (`houseSizing.json` ⇄ uct-intelligence's `_SIZING_TABLE` through `ast`, Task 11).
- **Worktrees (IR-B4).** Each lane works ONLY in its own worktree and branch from the lane table. `$WT` in every command below is that lane's worktree path; shell state does not persist between tool calls, so set it at the start of each call (`WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s`). Never commit in another lane's tree. Commit with a pathspec on the commit.
- **Junctions (IR-B1).** `app/node_modules` in every lane worktree is a junction to `C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules`. Never `npm ci` in a lane. Removal: Task 14 Step 6's procedure only.
- New preference keys go into `api/routers/auth.py::_PREFERENCE_KEYS` AND `app/src/hooks/usePreferences.additionsOnly.test.js` `BASELINE_KEYS`, in the same commit, with literal keys (`notebook_log_trade_checklist`, Task 8).
- New Python paths read by vitest rails go into `scripts/gate_shards.py` `GATE_READ_PATHS`, asked of `tests/test_gate_shards.py`'s read-set rail, never guessed (Task 1A creates `trader_blocks.py`, which `doorEnumeration.test.js` rail ② walks).
- No new table in part a, so `api/services/address_space.py`, account purge and the deletion manifest do not change. A task that adds one STOPS: that is part b's.
- No new `document`/`window` key listener (`pages/command/keyListenerCensus.test.js`). Blocks use `onKeyDown`; the price-stamp extension uses a TipTap keyboard shortcut (editor keymaps are out of the census's scope, its header says).
- Note writes: every client call that advances a note's `updatedAt` lands it with `settleNoteWrite` (`lib/offline/doorEnumeration.test.js`, `MODE = 'fail'`). P2a adds none, and the census is re-run after Tasks 5 and 6 to prove it (IR-I c).
- Bytes: the Notebook first-open closure (`python tools/notebook_perf_budgets.py --dist app/dist`) stays under `max` 2,260,793 B (`docs/notebook/perf-budgets.json`, `"max": 2260793,`). Part a's allowance is **+3,072 B** in total, split as Task 6 ≤ 1,536 B (registry rows + dispatcher), Task 10 ≤ 512 B (extension stub), Task 12 ≤ 1,024 B (slash items). V3 measures the headroom before anything is built; if the base plus 3,072 B exceeds `max`, Task 1 STOPS and reports. A task over its allowance moves code into a lazy chunk before it lands; it never edits `perf-budgets.json`.
- Typing: no regression against the 2026-10-10 busy-time baseline (p95 4.94 / 7.07 / 9.37 ms), same instrument (`tools/notebook_perf_harness.py --busy`), same sizes, plus a note holding one of every block (Task 13).
- Touch targets ≥ `var(--tap-min)` at ≤1024 px (`styles/tapFloor.test.js`); every control has an accessible name and a keyboard path; breakpoints only 640 and 1024; icons are `UIcon` names; no emoji. Every new `.jsx` under `components/notebook/blocks/` and `components/LogTradeChecklist.jsx` is in the a11y population with an axe recipe (`a11y/population.js`, `a11y/notebookSurfaces.js`), added by the task that creates the file.
- Every new `data-tour` literal appears once in its file (`tourAnchors.test.js`). P2a adds none (tours are P5).
- Tests: `cd "$WT/app" && npx vitest run <explicit files>`. Backend pytest by NAMED FILES only. A run without a totals line is not a run. Never verify through a pipe or a trailing `echo`: `cmd > log 2>&1; code=$?; echo "EXIT: $code"; exit $code`. `-t` and `-k` are filters: a filter that matches nothing collects zero tests, so read the count.
- **"Expected: all pass" means every file in that step's run list, read from the totals line.** A pre-existing red recorded at Task 0 is named, not counted as a pass.
- Run the suite in its own tool call and read the totals before committing.
- Commits: `git commit -F - -- <paths> <<'MSG'` (pathspec on the commit). Every message ends with exactly:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ`
- Write files with the line endings git stores (new files LF); run `python tools/check_repo_hygiene.py` before each commit.
- Never touch `C:\data`. Sandboxes go through `scripts/hub_sandbox_boot.py`; data dirs are passed from PowerShell or single-quoted. At most 3 agents; print `(Get-Counter '\Memory\Available MBytes').CounterSamples.CookedValue` before each launch and stay at 3 under ~4 GB.
- Mutation proofs restore by captured bytes (sha checked against `git cat-file blob HEAD:<path>`), never `git checkout --`.

## Review Focus

Five inputs the spec implies but no feature test exercises on its own. Each names the test that pins it.

1. **A member ticks a checklist item and leaves the note within 1.5 s** (the P0.0 fork shape). The tick must land through the note's one save path and leave no "(conflicted copy)". Pinned in Task 6, `blockParams.test.jsx` "a tick is ONE transaction through updateAttributes, no fetch", and walked in Task 13, `blocks.integrity-tick-leave`.
2. **A price stamp arrives after the member has deleted or moved the line** (the fetch is async). It must land after the line wherever the line now is, or not at all if the line is gone, and never inside another word. Pinned in Task 10, `priceStamps.test.js` "a deleted line takes no stamp" and "a moved line takes its stamp where it now is".
3. **A note holding a block is opened by a member whose account has no setups, no before-entry rules and only the default account size.** Each block must say what to do, never render an empty box, never size against the placeholder, never throw. Pinned in Task 7 `PreEntryChecklistBlock.test.jsx` "no setups yet" and Task 11 `PositionSizingBlock.test.jsx` "the default account size is not an account size".
4. **A version restore of a note that carries `builtin:regime_at_write`, and a member PUT that tries to set it.** The restore replaces properties (`notes.py:3598`, `"propertiesReplace": version["propertiesJson"] or {},`) through a validator that refuses non-member-set built-ins (`note_properties.py:456`). Pinned in Task 4, `test_a_version_restore_keeps_the_captured_regime` and `test_a_member_put_cannot_set_or_clear_it`.
5. **The sizer is fed a stop on the wrong side, an equal entry and stop, or a grade the regime skips.** It must say why and size nothing, never a negative share count. Pinned in Task 11, `houseSizing.test.js` "wrong-side, equal and skip cases".

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/p2-verify-before-building.md` (new) | every citation this plan leans on, re-read; the open verification items, resolved | 1 |
| `api/services/journal_two/trader_blocks.py` (new) | block builders, the market context readings, the pre-entry record | 1A, 3, 5 |
| `api/services/journal_two/journal_styles.py` | catalog rows, builders wired, `ctx["mode"]`, composer captures the regime; Trade plan v2 | 1A, 3, 4, 12 |
| `J/lib/journalBlocks.js` | client catalog rows (labels, settings, `search`, option labels) | 1A, 3 |
| `B/styles/StyleEditor.jsx` | option labels from the catalog (additive) | 1A |
| `scripts/gate_shards.py` | `trader_blocks.py` in `GATE_READ_PATHS` (per the read-set rail) | 1A |
| `tools/notebook_fin_walk.py`, `tools/notebook_fin_walk_features.py` | P1 walk-tool minors (R24); then the P2a walk steps | 2, 13 |
| `B/NewNoteMenu.listCaret.css.test.js` | P1 test hardening (R28 N1/N2) on the caret's test file | 2 |
| `api/routers/notebook_journal_styles.py` | `GET /trader-blocks/market-context`, `PUT /trader-blocks/positions/{id}/pre-entry` | 3, 5 |
| `tools/notebook_contract_fixtures.py`, `J/__fixtures__/contract/*` | fixtures for both routes | 3, 5 |
| `api/services/journal_two/note_properties.py`, `notes.py` | `builtin:regime_at_write` and the captured-property modes | 4 |
| `api/routers/journal_two.py` | the `pos:` fallback on a closed trade's adherence read | 5 |
| `src/widgets/registry.js`, `registry.test.js` | three block manifests; the block-binding rails; later the `marketcontext` params | 6, 9 |
| `api/services/journal_two/public_note_payload.py` | three vendor rows | 6 |
| `B/WidgetEmbedView.jsx` | hand a block to the lazy `BlockNodeView`, behind `EmbedErrorBoundary` | 6 |
| `B/blocks/*` (new, lazy) | `BlockNodeView`, `useBlockParams`, states, three block bodies | 6, 7, 10, 11 |
| `J/lib/blocks/*` (new) | `checklistItems.js`, `logTradeChecklist.js`, `priceStamps.js`, `priceStampsRun.js`, `houseSizing.js`, the door rail | 6, 7, 8, 10, 11 |
| `J/a11y/population.js`, `J/a11y/notebookSurfaces.js`, `J/a11y/traderBlocks.a11y.test.jsx` (new) | the blocks in the a11y population, with axe recipes | 6, 7, 8, 10, 11 |
| `J/components/AddPositionModal.jsx`, `AddTradeModal.jsx`, `J/LogTradeButton.jsx`, `J/JournalLogFab.jsx`, `J/components/PortfolioSettingsModal.jsx` | the checklist in Log Trade, soft warning, opt-in | 8 |
| `api/routers/auth.py`, `src/hooks/usePreferences.additionsOnly.test.js` | `notebook_log_trade_checklist` | 8 |
| `src/pages/charts/widgets/marketContextModel.js`, `MarketContextWidget.jsx`, `B/MarketContextEmbed.jsx` | the extended readings rows, the uncaptured sentence | 9 |
| `J/lib/tiptap.js`, `B/NoteEditorPage.jsx` | register the price-stamp extension; `noteTicker` in editor storage | 10 |
| `app/src/constants/houseSizing.json` (new), `tests/test_house_sizing_table.py` (new) | the house table, railed against uct-intelligence | 11 |
| `B/SlashMenu.jsx` | three block items and the Market context item in the Trading group | 12 |
| `tools/notebook_perf_harness.py` | `--with-blocks` | 13 |
| `tools/notebook_door_audit_doors.json` | rows 56-60 (the audit-drivable ones) | 13 |

`J` = `app/src/pages/journal-2-0`, `B` = `J/components/notebook`.

## Lanes and waves

Every lane has its own worktree, branch, owner file and junction (IR-B4). Lane branches start from `notebook-p2-blocks` AFTER the wave before them is merged into it.

| Wave | Lane | Worktree (`$WT`) | Branch | Tasks | Agent |
|---|---|---|---|---|---|
| W0 | F (foundation) | `C:\Users\Patrick\uct-worktrees\notebook-p2` | `notebook-p2-blocks` | 0, 1, 1A | controller |
| W1 | S (server) | `...\notebook-p2-s` | `notebook-p2-s` | 3 → 4 → 5 | opus |
| W1 | C (client platform) | `...\notebook-p2-c` | `notebook-p2-c` | 6 | opus |
| W1 | W (walk debt) | `...\notebook-p2-w` | `notebook-p2-w` | 2 | sonnet |
| M1 | integrator | `...\notebook-p2` | `notebook-p2-blocks` | merge W, then S, then C; re-run every merged lane's run lists | controller |
| W2 | A (checklist) | `...\notebook-p2-a` | `notebook-p2-a` | 7 → 8 | opus |
| W2 | B (context, stamps) | `...\notebook-p2-b` | `notebook-p2-b` | 9 → 10 | opus |
| W2 | D (sizing) | `...\notebook-p2-d` | `notebook-p2-d` | 11 | sonnet |
| M2 | integrator | `...\notebook-p2` | `notebook-p2-blocks` | merge D, then A, then B; re-run every merged lane's run lists | controller |
| W3 | integrator | `...\notebook-p2` | `notebook-p2-blocks` | 12 → 13 → 14 | controller + one agent |

At most three agents run at once (W1 and W2 are three lanes each). The integrator merges with `git merge --no-ff <lane branch>` in its own worktree, reads every conflict, re-runs the merged lanes' run lists in ITS session, and only then starts the next wave. A lane's own "all pass" is evidence, never the verdict.

**Shared files and merge order.** W1 lanes touch disjoint files (Task 1A took the shared catalog pieces). The pairs below are the only files more than one task writes.

| File | Tasks (wave) | Order and resolution |
|---|---|---|
| `journal_styles.py` | 1A (W0), 3, 4 (W1 S), 12 (W3) | sequential: 1A → lane S in order → 12 after M2 |
| `trader_blocks.py` | 1A (W0), 3, 5 (W1 S) | created in 1A; 3 and 5 append in lane S, in order |
| `journalBlocks.js` | 1A (W0), 3 (W1 S) | 1A writes the three block rows; 3 adds the `marketcontext` row; no other lane edits it |
| `notebook_journal_styles.py`, `tools/notebook_contract_fixtures.py`, fixtures dir | 3, 5 (W1 S) | same lane, in order |
| `registry.js`, `registry.test.js` | 6 (W1 C), 9 (W2 B) | 9 starts from M1, which holds 6 |
| `blockDoors.test.js` `WRITE_EXCEPTIONS` | 6 (creates, empty), 8 (W2 A), 10 (W2 B) | M2 merges A before B; each adds one key; a conflict on adjacent lines is resolved by keeping both keys |
| `a11y/notebookSurfaces.js`, `a11y/traderBlocks.a11y.test.jsx` | 6 (W1 C), 7, 8 (A), 10 (B), 11 (D) | each task edits only its own file's entry and its own `describe`; M2 order D, A, B; an adjacent-line conflict keeps both sides |
| `a11y/population.js` | 6 (C), 8 (A) | 6 adds the blocks dir, 8 adds `components/LogTradeChecklist.jsx` |
| `notebook_fin_walk_features.py` | 2 (W1 W), 13 (W3) | sequential |
| `AddPositionModal.jsx`, `AddTradeModal.jsx`, `LogTradeButton.jsx`, `JournalLogFab.jsx` | 8 only | |
| `SlashMenu.jsx` | 12 only | |
| `tiptap.js`, `NoteEditorPage.jsx` | 10 only | |

---

### Task 0: Worktrees, one per lane

**Files:** none (environment)

- [ ] **Step 1: Check the base holds master `d92fca5be9` and the list caret**

```bash
git -C /c/Users/Patrick/uct-worktrees/notebook-p1 fetch origin
git -C /c/Users/Patrick/uct-worktrees/notebook-p1 merge-base --is-ancestor d92fca5be9 origin/master; echo "master base: $?"
gh pr view 320 --json state,mergeCommit --jq '.state + " " + (.mergeCommit.oid // "none")'
```

Expected: `master base: 0` and `MERGED <sha>`. Then `git -C /c/Users/Patrick/uct-worktrees/notebook-p1 merge-base --is-ancestor <that sha> origin/master; echo $?` prints `0`. If PR #320 is not merged, STOP and report: this plan never merges another session's unlanded branch.

- [ ] **Step 2: Create the integration worktree and the three W1 lane worktrees**

```bash
for L in "notebook-p2 notebook-p2-blocks" "notebook-p2-s notebook-p2-s" "notebook-p2-c notebook-p2-c" "notebook-p2-w notebook-p2-w"; do
  set -- $L
  git -C /c/Users/Patrick/uct-worktrees/notebook-p1 worktree add -b "$2" "/c/Users/Patrick/uct-worktrees/$1" origin/master
  printf 'session: <this session id>\ncreated: <YYYY-MM-DD>\nlane: %s\n' "$2" > "/c/Users/Patrick/uct-worktrees/$1/.uct-session-owner"
  git -C "/c/Users/Patrick/uct-worktrees/$1" status --short --branch
done
```

Expected: four `## <branch>...origin/master` lines and clean trees. (The W1 lanes are re-pointed at `notebook-p2-blocks` after Task 1A in Step 5; they are created now so their junctions are verified once.)

- [ ] **Step 3: Junction the shared install into each (PowerShell tool)**

```powershell
$target = 'C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules'
$before = (Get-ChildItem $target -Force | Measure-Object).Count
if ($before -ne 377) { throw "the shared install holds $before entries, expected 377: stop and report" }
foreach ($w in 'notebook-p2','notebook-p2-s','notebook-p2-c','notebook-p2-w') {
  $link = "C:\Users\Patrick\uct-worktrees\$w\app\node_modules"
  New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  $i = Get-Item $link -Force
  "{0} | {1} | {2}" -f $w, $i.LinkType, ($i.Target -join ',')
}
```

Expected: four lines, each `Junction | C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules`.

- [ ] **Step 4: Baseline the files this plan touches (in the integration tree)**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT/app"
npx vitest run src/widgets/registry.test.js src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/hooks/usePreferences.additionsOnly.test.js src/pages/command/keyListenerCensus.test.js src/components/screener/reachable.test.js src/pages/journal-2-0/a11y/surfaceCoverage.test.js src/pages/journal-2-0/components/notebook/NewNoteMenu.listCaret.css.test.js > "$TEMP/p2a-baseline.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python -m pytest tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_update.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py tests/test_note_kind_property.py tests/test_gate_shards.py tests/test_public_note_payload.py -q > "$TEMP/p2a-baseline-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Read both totals lines. Record any pre-existing red, by name, in `docs/notebook/p2-verify-before-building.md` §baseline (Task 1) and the PR body. Pre-existing reds are not this plan's to fix, and a later "all pass" means "no red beyond these".

- [ ] **Step 5 (after Task 1A is committed): re-point the W1 lanes at the foundation**

```bash
for W in notebook-p2-s notebook-p2-c notebook-p2-w; do
  git -C "/c/Users/Patrick/uct-worktrees/$W" merge --ff-only notebook-p2-blocks
  git -C "/c/Users/Patrick/uct-worktrees/$W" log -1 --format='%h %s'
done
```

Expected: each prints Task 1A's commit. (Each lane branch has no commits of its own yet, so the fast-forward is exact.) The W2 lanes (`notebook-p2-a`, `-b`, `-d`) are created the same way at M1, from `notebook-p2-blocks`, with their own owner files and the Step 3 junction procedure.

---

### Task 1: Verify before building, written down

No product code. This task produces `docs/notebook/p2-verify-before-building.md`, which every later task cites. **Every quote is re-read at write time**: run the grep, read the matched line's CONTENT, and confirm it says what the row claims. A line that moved is updated. A claim the content no longer supports is STRUCK and the task stops and reports.

**Lane:** F, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2`.

**Files:**
- Create: `docs/notebook/p2-verify-before-building.md`

**Interfaces:**
- Produces: the findings document, sections `§baseline`, `§cite` (the quotes), `§V1`-`§V14` (the open items, each answered with a file:line or a measurement). Tasks 1A-13 cite it.

- [ ] **Step 1: Re-verify every citation this plan leans on**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
grep -n "ONE FACT IN TWO FILES with app/src/pages/journal-2-0/lib/journalBlocks.js" api/services/journal_two/journal_styles.py
grep -n 'BLOCK_BUILDERS: dict\[str, Callable' api/services/journal_two/journal_styles.py
grep -n '    ctx = {"ticker": row\["ticker"\], "now": datetime.now(timezone.utc)}' api/services/journal_two/journal_styles.py
grep -n "P1 can$" app/src/pages/journal-2-0/lib/journalBlocks.js
grep -n "const EMBED_COMPONENTS = {" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "  marketcontext: lazyLeaf(() => import('./MarketContextEmbed'))," app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "^class EmbedErrorBoundary extends Component {" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "export const UNKNOWN_BLOCK_SENTENCE = 'This block needs a newer version of the app. Reload to see it.'" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "const shareView = !!editor?.storage?.uctJournalWidgets?.shareView" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "export default function WidgetEmbedView(" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "params: jsonAttr('data-params', {})," app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx
grep -n "    if (manifest.captureOnly === true) {" app/src/widgets/registry.js
grep -n "^  marketcontext: {" app/src/widgets/registry.js
grep -n "    reconstructable: (p) => !!(p?.readings && typeof p.readings === 'object' && !Array.isArray(p.readings))," app/src/widgets/registry.js
grep -n "export function paramsPlainText(widgetId, params) {" app/src/widgets/registry.js
grep -n "^export function readingsFrom(breadth) {" app/src/pages/charts/widgets/marketContextModel.js
grep -n "  it('registers exactly the 20 workspace widget types + the G-040 capture-only kinds, in menu order', () => {" app/src/widgets/registry.test.js
grep -n "  it('reconstructable widgets and journal embed bindings cannot drift apart', () => {" app/src/widgets/registry.test.js
grep -n "^const CAPTURE_ONLY = \['screener', 'cot', 'modelbook'\]" app/src/widgets/registry.test.js
grep -n '    ("widgetEmbed", "marketcontext"): "mixed",    # regime + prices' api/services/journal_two/public_note_payload.py
grep -n '    ("financialFact", "massive"): "massive",      # the `price` fact type' api/services/journal_two/public_note_payload.py
grep -n "^def test_every_registered_widget_has_a_vendor_row(widget_id):" tests/test_public_note_payload.py
grep -n "  { id: 'trading', label: 'Trading' }," app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx
grep -n "const TRADING_BLOCKS = new Set(" app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx
grep -n "          body: JSON.stringify({ ticker: symbol, factType: 'price' })," app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx
grep -n "  group: 'block'," app/src/pages/journal-2-0/lib/financialFactNode.jsx
grep -n "export function resolveCashtags(text) {" app/src/lib/tickerResolver.js
grep -n "^import A8 from './taxonomy/a8Taxonomy.json'" app/src/lib/tickerResolver.js
grep -n "^export function importWithOneRetry(load, waitMs = RETRY_WAIT_MS, accept = hasDefault) {" app/src/pages/journal-2-0/lib/lazyChunk.js
grep -n "BUILTIN_USER_SET_IDS = frozenset" api/services/journal_two/note_properties.py
grep -n 'raise PropertyValidationError(f"{property_id} is not a settable property")' api/services/journal_two/note_properties.py
grep -n '        if prop_def\["source"\] != "user_set":' api/services/journal_two/note_properties.py
grep -n "^class NoteValidationError(ValueError):" api/services/journal_two/notes.py
grep -n "properties_json = set_note_properties(user_id, new_id, properties, conn, replace=True)" api/services/journal_two/notes.py
grep -n '"propertiesReplace": version\["propertiesJson"\] or {},' api/services/journal_two/notes.py
grep -n "new_properties_json = set_note_properties(user_id, note_id, raw, conn, replace=replace)" api/services/journal_two/notes.py
grep -n '    base = patch.pop("baseUpdatedAt", None) if isinstance(patch, dict) else None' api/routers/journal_two.py
grep -n '        patch.pop("locked", None)' api/routers/journal_two.py
grep -n "def upsert_adherence(" api/services/journal_two/adherence_store.py
grep -n 'return adherence_store.get_adherence(user\["id"\], detail\["tradeRef"\])' api/routers/journal_two.py
grep -n '"positionId": row\["position_id"\],' api/services/journal_two/trades.py
grep -n "^_DEFAULT_ACCOUNT_SIZE = 100_000.0" api/services/journal_two/accounts.py
grep -n '        "accountSize": _DEFAULT_ACCOUNT_SIZE,' api/services/journal_two/accounts.py
grep -n "  const handleCreateTrade = useCallback(async (payload) => {" app/src/pages/journal-2-0/LogTradeButton.jsx
grep -n "  const handleCreateTrade = useCallback(async (payload) => {" app/src/pages/journal-2-0/JournalLogFab.jsx
grep -n "      await onSave({" app/src/pages/journal-2-0/components/AddTradeModal.jsx
grep -n "      const created = await onSave(payload)" app/src/pages/journal-2-0/components/AddPositionModal.jsx
grep -n "  return { prefs, setPref, setPrefMerged, loading: isLoading }" app/src/hooks/usePreferences.js
grep -n "^_CACHE_TTL = 15" api/routers/live_prices.py
grep -n "^def get_live_prices(" api/routers/live_prices.py
grep -n '    "vix", "vxn", "avg_10d_vix", "avg_10d_vxn", "vxmt", "vix_term_structure",' api/services/breadth_live.py
grep -n "^def _regime_fields(memo: dict) -> tuple\[dict, dict\]:" api/services/journal_two/entry_context.py
grep -n '                          {"universe": "wire", "liveUnavailable": live.get("reason")})' api/services/journal_two/entry_context.py
grep -n "^def get_current_regime() -> dict\[str, Any\]:" api/services/journal_two/regime.py
grep -n '"NOTEBOOK_JOURNAL_STYLES_ENABLED": False,' api/routers/auth.py
grep -n "^_PREFERENCE_KEYS = {" api/routers/auth.py
grep -n "^const BASELINE_KEYS = {" app/src/hooks/usePreferences.additionsOnly.test.js
grep -n "^GATE_READ_PATHS = (" scripts/gate_shards.py
grep -n "it('① the SQL names exactly SEVEN functions that advance a note'" app/src/pages/journal-2-0/lib/offline/doorEnumeration.test.js
grep -n "^export function derivePopulation() {" app/src/pages/journal-2-0/a11y/population.js
grep -n "^export const SURFACES = Object.freeze({" app/src/pages/journal-2-0/a11y/notebookSurfaces.js
grep -n '"max": 2260793,' docs/notebook/perf-budgets.json
grep -n "^def paragraphs_doc(n: int, tag: str)" tools/notebook_perf_harness.py
grep -n "^def _seed(req, base: str, sizes: list\[int\], run: str)" tools/notebook_perf_harness.py
grep -n 'STEP_KINDS = ("click", "click_css", "hover_css", "open_note", "type")' tools/notebook_door_audit.py
grep -n "editor keymaps (TipTap/ProseMirror/CodeMirror, scoped to the editor)" app/src/pages/command/keyListenerCensus.test.js
grep -n '^_SIZING_TABLE = {' /c/Users/Patrick/uct-intelligence/uct_intelligence/api.py
grep -n '    ("ORANGE", "B"):  0.00,' /c/Users/Patrick/uct-intelligence/uct_intelligence/api.py
git -C /c/Users/Patrick/uct-intelligence log -1 --format='%H %cs'
```

Each grep must print exactly ONE line. An empty result is a failed check, never a pass. Two of the expected lines repeat by design: `handleCreateTrade` is greped once per file; the `/facts` fetch appears twice in `SlashMenu.jsx` (`/price` at `:393` and `/consensus` at `:445`), so the `/price` line is pinned by its `factType: 'price'` body line instead. Record each `file:line` as printed. Plan-time values (2026-10-12, master `d92fca5be9`): `financialFactNode.jsx:25`, `SlashMenu.jsx:285`/`:293`/`:396`, `note_properties.py:456`/`:727`, `notes.py:147`/`:3319`/`:3598`/`:3767`, `journal_two.py:1020`/`:3610`/`:3614`, `accounts.py:59`/`:67`, `AddPositionModal.jsx:349`, `AddTradeModal.jsx:128`, `usePreferences.js:385`, `live_prices.py:32`, `breadth_live.py:125`, `entry_context.py:328`/`:368`, `uct_intelligence/api.py:2775`/`:2783`.

- [ ] **Step 2: Answer the open verification items**

Each item below names what to read, and what the answer changes. Write the answer, with the line it rests on, into §V1-§V14.

- **V1 — The list caret is on the base.** Task 0 Step 1 proved PR #320 merged. Record its merge sha, and `ls app/src/pages/journal-2-0/components/notebook/NewNoteMenu.listCaret.css.test.js`. Task 2 Step 4 (R28 N1/N2) and Task 13's row-56 measurement both run.
- **V2 — The typing baseline of record.** The spec names p95 4.94 / 7.07 / 9.37 ms (2026-10-10). Search `docs/notebook/perf-runs/*/` for the run whose `typing_busy_per_char` p95 rows read those three values at the same three sizes (`grep -rln '"measure": "typing_busy_per_char"' docs/notebook/perf-runs`, then read the p95 rows). At plan time `ty-l15-quiet/q1.json` carried 4.949 and 9.377 and `ty5/ab/A3.json` carried 7.073, so no one file was confirmed. Write down the file and its sizes and `--chars`; Task 13 runs the same flags. If no single run carries all three, Task 13 compares against the latest quiet-box record in `docs/notebook/perf-budgets.md` and says so in the PR body.
- **V3 — The bytes headroom.** `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist --json "$TEMP/p2a-bytes-base.json"`. Record the current closure, `max` minus it, and which chunk's module list holds `widgets/registry.js`, `WidgetEmbedView.jsx` and `lib/tiptap.js`. **If the headroom is under 3,072 B, STOP and report**: the allowance does not fit and the owner decides.
- **V4 — The market context readers.** Read `entry_context._regime_fields` (`:328`) and `regime.get_current_regime`: confirm `_regime_fields` answers `(regime_field, exposure_field)`, each `{value, source, asOf, missing, detail}` with `detail` `None` on every branch, and that it reaches only the wire cache. Read `engine.get_breadth()`'s return keys against `readingsFrom` (`market_phase`, `exposure.score`, `exposure.score_delta`, `breadth_score`, `distribution_days`, `pct_above_50ma`, `pct_above_200ma`) and whether `get_breadth` can reach a vendor on a cold cache (Task 3's builder runs inside a note create).
- **V5 — The index quotes.** Read `get_live_prices` (`live_prices.py`) end to end: the value's keys (`price`, `change_pct`, `observed_at`, `market_closed` at plan time), the valve wait (`_SEM_WAIT_S`), the 503 branch, and the alert check it runs on a freshly built set (`run_alert_check(live_only)`, which evaluates every member's alerts for those tickers, exactly as any member's poll does). Record whether calling it with `tickers="SPY,QQQ"` from Task 3's builder is safe inside a create (bounded by `_SEM_WAIT_S`). If any branch can block longer, Task 3 reads the cache only and says so.
- **V6 — `get_trade_detail`'s keys.** Confirm `positionId` and `tradeRef` are both on the dict the adherence routes read (`trades.py`, `"positionId": row["position_id"],`). Task 5 uses both.
- **V7 — How the Properties section shows a built-in a member cannot set.** Read `B/PropertiesSection.jsx` for how non-`user_set` built-ins (e.g. `financial_derived`) render, and whether "Add property" lists them. Task 4 gives the new built-in `source: "captured"`; if the section treats any non-`user_set` source as read-only and never offers it, nothing more is needed; otherwise Task 4 adds `captured` to that branch.
- **V8 — Grouping the Board by a built-in select.** Read `NoteBoardView.jsx` and `NotebookTab.jsx` for which properties the board offers as `groupBy` (a `select` only, per CLAUDE.md), whether a `captured` built-in is offered, and whether a URL form opens the board grouped by a property id. Task 9's sentence names the steps V8 found; if a captured built-in is NOT offered as a group, Task 4 adds it to the board's offer and V8 names the line.
- **V9 — What a price fact looks like.** Read `B/FinancialFactView.jsx` for how a `factType: 'price'` fact renders (value, ticker, time). Record it; Task 13's walk asserts that text.
- **V10 — The TipTap Enter order.** Read `node_modules/@tiptap/core/dist/index.js` (3.23.6) for how `addKeyboardShortcuts` handlers of several extensions are combined (`get plugins()` reverses the extension list, so a LATER extension's keymap runs FIRST; a handler returning `false` lets the next one and the default Enter run). Task 10's test proves the outcome in a real editor; this records why.
- **V11 — What the Log Trade dialogs return.** Read `J/LogTradeButton.jsx` and `J/JournalLogFab.jsx`: `handleCreatePosition` returns `created`; `handleCreateTrade` returns nothing. Read `AddTradeModal.handleSave` (`await onSave({`). Record the created row's `id` key from `POST /api/j2/trades`. Task 8 threads the return (IR-S7).
- **V12 — `notes.create_note`'s and `set_note_properties`' signatures.** `grep -n "^def create_note(" -A 12 api/services/journal_two/notes.py` and `grep -n "^def set_note_properties(" -A 3 api/services/journal_two/note_properties.py`. Task 4 adds `captured_properties` and `captured`.
- **V13 — The accounts list and settings routes.** Read `api/routers/journal_two.py` for `GET /api/j2/accounts` (a list, or `{"accounts": [...]}`) and `GET`/`PUT /api/j2/accounts/{id}/settings` (the body `useJ2Settings`' `save` sends: the whole settings object). Task 13's integrity row seeds `setups`/`setupRules`/`accountSize` through them.
- **V14 — Where uct-intelligence lives for the table rail.** Record which of these holds `uct_intelligence/api.py` on this box: `$UCT_INTEL_PATH`, `external/uct-intelligence` (a submodule, usually not initialised in a worktree), `C:\Users\Patrick\uct-intelligence`. Task 11's rail looks in that order; on this box at plan time only the last exists.

- [ ] **Step 3: Write the finding**

Create `docs/notebook/p2-verify-before-building.md` with a title, the measured `git rev-parse HEAD`, `§baseline` (Task 0 Step 4's totals and any pre-existing red, by name), a `§cite` table (claim | `file:line` | the line, quoted) holding every row from Step 1, then `§V1`-`§V14`, each with its answer and the line it rests on. A V-item whose answer changes a later task names that task and the change.

- [ ] **Step 4: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python tools/check_repo_hygiene.py
git add docs/notebook/p2-verify-before-building.md
git commit -F - -- docs/notebook/p2-verify-before-building.md <<'MSG'
docs(notebook): P2a verify-before-building (citations re-read, fourteen open items answered)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 1A: The shared catalog seam (W0 foundation)

Everything more than one W1 lane needs, landed once before the lanes start (IR-B4): the three block rows in BOTH catalogs with their `search` lines and option labels, their builders, `ctx["mode"]`, and the gate read path for the new service module. After this task lane S and lane C share no file.

**Lane:** F, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2` (branch `notebook-p2-blocks`).

**Files:**
- Create: `api/services/journal_two/trader_blocks.py`
- Modify: `api/services/journal_two/journal_styles.py` (`BLOCK_KINDS` `:51-53`, `BLOCK_BUILDERS` `:647`, `compose`'s `ctx` `:696`, `_plan`'s `ctx` `:920`)
- Modify: `app/src/pages/journal-2-0/lib/journalBlocks.js`
- Modify: `app/src/pages/journal-2-0/components/notebook/styles/StyleEditor.jsx` (`:14` import, `:278` option word)
- Modify: `scripts/gate_shards.py` (`GATE_READ_PATHS`, per the read-set rail)
- Test: `tests/test_trader_blocks.py` (new), `tests/test_journal_styles_store.py` (`:45`, the shape)

**Interfaces:**
- Produces (server): `BLOCK_KINDS` rows `preEntryChecklist`, `priceStamps`, `positionSizing`, each `{"id", "search", "settings": ({"key", "options", "default"},...)}` (`chart` has no `search`); `trader_blocks.BLOCK_IDS = ("preEntryChecklist", "priceStamps", "positionSizing")`; `trader_blocks.REGIME_IDS`; `trader_blocks.BUILDERS` (merged into `journal_styles.BLOCK_BUILDERS`); every builder's `ctx` carries `"mode": "create" | "update"`, `"memo": {}` and `"user_id"`.
- Produces (client): `BLOCK_KINDS` rows with `label`, `search`, `settings[].optionLabels`; `blockSearch(id) -> string | null`; `optionWord(setting, option) -> string`.

- [ ] **Step 1: Write the failing tests**

`tests/test_trader_blocks.py`:

```python
"""P2a trader blocks, server half (Task 1A): catalog rows and builders. Tasks 3 and 5 append."""
from __future__ import annotations

import importlib
import os
import tempfile
from datetime import datetime, timezone

import pytest


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


NOW = datetime(2026, 10, 13, 14, 30, tzinfo=timezone.utc)
CTX = {"ticker": None, "now": NOW, "memo": {}, "mode": "create", "user_id": "u1"}


def test_every_trader_block_has_a_catalog_row_and_a_builder():
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    assert tb.BLOCK_IDS == ("preEntryChecklist", "priceStamps", "positionSizing")
    assert set(tb.BLOCK_IDS) <= js.KNOWN_BLOCKS
    assert set(js.BLOCK_BUILDERS) == js.KNOWN_BLOCKS
    for bid in tb.BLOCK_IDS:
        assert js._BLOCK_BY_ID[bid]["search"].startswith("[")


@pytest.mark.parametrize("bid", ["preEntryChecklist", "priceStamps", "positionSizing"])
def test_each_builder_makes_a_body_the_editor_can_build(bid, monkeypatch, db_path):
    from api.services.journal_two import journal_styles as js, notes, regime
    monkeypatch.setattr(regime, "_read_exposure", lambda: None)          # hermetic: no wire read
    kind = js._BLOCK_BY_ID[bid]
    block = {"block": bid, "enabled": True, "settings": {s["key"]: s["default"] for s in kind["settings"]}}
    node, reason = js.BLOCK_BUILDERS[bid](block, dict(CTX, memo={}))
    assert reason is None and node["attrs"]["widgetId"] == bid
    assert node["attrs"]["searchText"] == kind["search"]
    body = notes._validate_body_json({"type": "doc", "content": [node]})
    notes._refuse_unbuildable(body)                                      # raises if the editor could not build it


def test_settings_flow_into_params():
    from api.services.journal_two import journal_styles as js
    node, _ = js.BLOCK_BUILDERS["priceStamps"]({"block": "priceStamps", "settings": {"on": "yes"}}, dict(CTX))
    assert node["attrs"]["params"] == {"on": "yes"}


def test_the_sizer_records_the_regime_id_it_was_built_in(monkeypatch):
    from api.services.journal_two import journal_styles as js, regime
    monkeypatch.setattr(regime, "_read_exposure", lambda: {"score": 40, "as_of": "2026-10-13"})
    node, _ = js.BLOCK_BUILDERS["positionSizing"]({"block": "positionSizing", "settings": {"grade": "A+"}}, dict(CTX))
    assert node["attrs"]["params"] == {"grade": "A+", "regimeId": "orange", "regimeAsOf": "2026-10-13"}


def test_compose_builds_in_create_mode_and_plan_in_update_mode():
    """IR-S11's seam: a builder must know whether it serves a NEW note or an older one. Task 3's
    test_a_create_captures_and_an_update_does_not proves the market context builder obeys it."""
    import inspect
    from api.services.journal_two import journal_styles as js
    assert '"mode": "create"' in inspect.getsource(js.compose)
    assert '"mode": "update"' in inspect.getsource(js._plan)
```

In `tests/test_journal_styles_store.py`, change the `shape` lambda in `test_the_client_block_catalog_equals_the_server_catalog` (`:45`) so the `search` line is part of the pinned fact:

```python
    shape = lambda kinds: [(k["id"], k.get("search"),
                            [(s["key"], list(s["options"]), s["default"]) for s in k["settings"]])
                           for k in kinds]
```

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python -m pytest tests/test_trader_blocks.py tests/test_journal_styles_store.py -q > "$TEMP/p2a-t1a.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (`No module named ... trader_blocks`).

- [ ] **Step 3: Create `trader_blocks.py`**

```python
"""Trader blocks (Notebook P2 Tier 1, spec §P2): the server half.

A trader block is a widgetEmbed whose widgetId is a block id (docs/notebook/p1-verify-before-building.md
§a). This module builds the node a style composes and READS the market data a block shows.

⛔ NOTHING HERE WRITES A NOTE. A block's state changes only through an editor transaction (spec §P2
integrity rule); the composer places the node this module builds, and journal_styles writes the note
in its one insert. tests/test_trader_blocks_no_note_door.py reads this file and fails on any j2_notes
write or any call to a notes write function.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable

#: The three P2a blocks (`block: true` in the client registry, bound in BLOCK_COMPONENTS). The market
#: context is NOT one: it is the existing `marketcontext` capture widget (Task 3, IR-S6).
BLOCK_IDS = ("preEntryChecklist", "priceStamps", "positionSizing")

#: The regime ids regime.classify_regime answers (journal_two/regime.py), in severity order.
REGIME_IDS = ("green", "amber", "orange", "red")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _node(block_id: str, params: dict, ctx: dict) -> dict:
    from api.services.journal_two import journal_styles as js
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": block_id, "embedId": uuid.uuid4().hex, "mode": "snapshot", "params": params,
        "capturedAt": _iso(ctx["now"]), "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None,
        "searchText": js._BLOCK_BY_ID[block_id]["search"],
    }}


def _settings(block: dict) -> dict:
    return block.get("settings") or {}


def build_pre_entry_checklist(block: dict, ctx: dict):
    s = _settings(block)
    return _node("preEntryChecklist", {"setup": "", "includeRules": s.get("includeRules", "yes"),
                                       "requireAll": s.get("requireAll", "no"), "checked": []}, ctx), None


def build_price_stamps(block: dict, ctx: dict):
    return _node("priceStamps", {"on": _settings(block).get("on", "no")}, ctx), None


def build_position_sizing(block: dict, ctx: dict):
    """The regime the size was built in, as the regime ID; the client maps ids to the house words
    through app/src/constants/houseSizing.json, the ONE in-repo table (IR-S10)."""
    from api.services.journal_two import regime as regime_mod
    cur = regime_mod.get_current_regime()
    params = {"grade": _settings(block).get("grade", "A")}
    if cur.get("regime") in REGIME_IDS:
        params.update({"regimeId": cur["regime"], "regimeAsOf": cur.get("asOf") or ""})
    return _node("positionSizing", params, ctx), None


BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {
    "preEntryChecklist": build_pre_entry_checklist,
    "priceStamps": build_price_stamps,
    "positionSizing": build_position_sizing,
}
```

- [ ] **Step 4: Catalog rows, builders and the build mode in `journal_styles.py`**

Replace `BLOCK_KINDS` (`:51-53`) with:

```python
BLOCK_KINDS: tuple[dict, ...] = (
    {"id": "chart", "settings": ({"key": "tf", "options": ("D", "W", "60", "15", "5"), "default": "D"},)},
    # P2 Tier 1 (part a). `search` is the node's searchText, set by the builder and by the client insert.
    {"id": "preEntryChecklist", "search": "[pre-entry checklist]", "settings": (
        {"key": "includeRules", "options": ("yes", "no"), "default": "yes"},
        {"key": "requireAll", "options": ("no", "yes"), "default": "no"})},
    {"id": "priceStamps", "search": "[price stamps]", "settings": (
        {"key": "on", "options": ("no", "yes"), "default": "no"},)},
    {"id": "positionSizing", "search": "[position sizing]", "settings": (
        {"key": "grade", "options": ("A", "A+", "B"), "default": "A"},)},
)
```

Replace `BLOCK_BUILDERS` (`:647`) with:

```python
#: block id -> builder. ⛔ Every id in BLOCK_KINDS has a builder (railed); P2 adds both together.
from api.services.journal_two import trader_blocks as _tb  # noqa: E402 -- after BLOCK_KINDS, no cycle
BLOCK_BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {
    "chart": _build_chart, **_tb.BUILDERS}
```

(`trader_blocks` imports `journal_styles` only inside `_node`, at call time, so there is no cycle at load.)

In `compose` (`:696`), change the `ctx` line to:

```python
        ctx = {"ticker": ticker, "now": now or datetime.now(timezone.utc), "memo": {}, "mode": "create",
               "user_id": user_id}
```

and in `_plan` (`:920`):

```python
    ctx = {"ticker": row["ticker"], "now": datetime.now(timezone.utc), "memo": {}, "mode": "update",
           "user_id": user_id}
```

`mode` tells a builder whether it runs for a NEW note or to offer a block to an existing one (IR-S11; Task 3's market context builder reads it).

- [ ] **Step 5: The client catalog**

Replace `app/src/pages/journal-2-0/lib/journalBlocks.js` with:

```js
// The blocks a journal style can switch on (spec P1.1/P1.2, P2). A block id IS a widget id: a block
// is a widgetEmbed node with that widgetId (docs/notebook/p1-verify-before-building.md §a). P2 adds
// rows here AND in journal_styles.BLOCK_KINDS (with a builder).
// ⛔ ONE FACT IN TWO FILES, pinned by tests/test_journal_styles_store.py through Node (ids, `search`,
// settings keys, options, defaults). Labels and optionLabels are the client's own words. NO IMPORTS.
const YES_NO = Object.freeze({ yes: 'Yes', no: 'No' })
export const BLOCK_KINDS = Object.freeze([
  Object.freeze({
    id: 'chart',
    label: 'Chart of the note’s ticker',
    settings: Object.freeze([
      Object.freeze({ key: 'tf', label: 'Timeframe', options: Object.freeze(['D', 'W', '60', '15', '5']), default: 'D' }),
    ]),
  }),
  Object.freeze({
    id: 'preEntryChecklist',
    label: 'Pre-entry checklist',
    search: '[pre-entry checklist]',
    settings: Object.freeze([
      Object.freeze({ key: 'includeRules', label: 'Include my before-entry rules', options: Object.freeze(['yes', 'no']), default: 'yes', optionLabels: YES_NO }),
      Object.freeze({ key: 'requireAll', label: 'Warn until every item is ticked', options: Object.freeze(['no', 'yes']), default: 'no', optionLabels: YES_NO }),
    ]),
  }),
  Object.freeze({
    id: 'priceStamps',
    label: 'Price stamps',
    search: '[price stamps]',
    settings: Object.freeze([
      Object.freeze({ key: 'on', label: 'Stamp prices as I write', options: Object.freeze(['no', 'yes']), default: 'no', optionLabels: YES_NO }),
    ]),
  }),
  Object.freeze({
    id: 'positionSizing',
    label: 'Position sizing',
    search: '[position sizing]',
    settings: Object.freeze([
      Object.freeze({ key: 'grade', label: 'Setup grade', options: Object.freeze(['A', 'A+', 'B']), default: 'A' }),
    ]),
  }),
])

const TF_WORDS = { D: 'Daily', W: 'Weekly', 60: '1 hour', 15: '15 minutes', 5: '5 minutes' }
export const tfWord = (tf) => TF_WORDS[tf] || String(tf)

/** A block's member-facing name; an id this bundle does not know reads as a newer-version block. */
export function blockLabel(id) {
  const k = BLOCK_KINDS.find((b) => b.id === id)
  return k ? k.label : `A block from a newer version (${id})`
}

/** The node's searchText for a block id (the server builder writes the same line). */
export function blockSearch(id) {
  return BLOCK_KINDS.find((b) => b.id === id)?.search || null
}

/** The word a style setting's option shows in the editor. */
export function optionWord(setting, option) {
  return setting?.optionLabels?.[option] ?? tfWord(option)
}
```

In `StyleEditor.jsx`, change the option rendering at `:278` from `{tfWord(o)}` to `{optionWord(s, o)}`, and add `optionWord` to the `journalBlocks` import at `:14` (keep `tfWord`, which `:34` still uses).

- [ ] **Step 6: Gate read path**

`doorEnumeration.test.js` rail ② walks every module under `api/services/journal_two/` for note-advancing calls, so it now reads `trader_blocks.py`. Ask the read-set rail instead of guessing:

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python -m pytest tests/test_gate_shards.py -q > "$TEMP/p2a-t1a-readset.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

For every path `test_the_read_set_covers_every_root_relative_path_the_suite_reads` names as missing, add it to `GATE_READ_PATHS`, exact path, under a comment:

```python
    # ⛔ Notebook P2a: read by app/src/pages/journal-2-0/lib/offline/doorEnumeration.test.js rail ②,
    # which walks every api/services/journal_two/ module for note-advancing calls. Exact path.
    "api/services/journal_two/trader_blocks.py",
```

Re-run until green. If it names nothing, record "no new Python path is read by a vitest rail" in the commit message.

- [ ] **Step 7: Run**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python -m pytest tests/test_trader_blocks.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_update.py tests/test_journal_styles_create.py tests/test_notebook_journal_styles_router.py tests/test_gate_shards.py -q > "$TEMP/p2a-t1a.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT/app"
npx vitest run src/pages/journal-2-0/components/notebook/styles src/pages/journal-2-0/lib/journalStyles.test.js src/pages/journal-2-0/lib/offline/doorEnumeration.test.js > "$TEMP/p2a-t1a-js.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass (beyond Task 0's recorded reds).

- [ ] **Step 8: Mutation-prove the catalog rail**

Capture `journalBlocks.js`. Change `search: '[price stamps]'` to `search: '[price]'`. `test_the_client_block_catalog_equals_the_server_catalog` must FAIL. Restore by bytes; check the sha against `git cat-file blob HEAD:app/src/pages/journal-2-0/lib/journalBlocks.js` after the commit (before it, against the captured bytes).

- [ ] **Step 9: Commit, then re-point the W1 lanes (Task 0 Step 5)**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python tools/check_repo_hygiene.py
git add api/services/journal_two/trader_blocks.py api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/journalBlocks.js app/src/pages/journal-2-0/components/notebook/styles/StyleEditor.jsx scripts/gate_shards.py tests/test_trader_blocks.py tests/test_journal_styles_store.py
git commit -F - -- api/services/journal_two/trader_blocks.py api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/journalBlocks.js app/src/pages/journal-2-0/components/notebook/styles/StyleEditor.jsx scripts/gate_shards.py tests/test_trader_blocks.py tests/test_journal_styles_store.py <<'MSG'
feat(notebook): P2a shared catalog seam -- three block rows in both catalogs, builders, build mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 2: P1 walk-tool minors and test hardening (ledger R24, R28)

Tool and test changes only. Ledger R24 parked M2-M6 as walk-tool follow-ups because "a tool change is only proven by a re-walk"; Task 13's walk is that re-walk. R28 parked N1 and N2 on the list caret's CSS test, which is now on the base (V1).

**Lane:** W, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2-w`.

**Files:**
- Modify: `tools/notebook_fin_walk.py` (the comment at `:76`)
- Modify: `tools/notebook_fin_walk_features.py` (imports; `styles()`, `:1970-2067`; `d_new_note_home`'s `styles_on`, `:1420`)
- Modify: `app/src/pages/journal-2-0/components/notebook/NewNoteMenu.listCaret.css.test.js`
- Test: `tests/test_notebook_fin_walk_styles_step.py` (new)

**Interfaces:**
- Produces: `save_landed(page, note_id, act, ceiling_ms=15000)` in `run_c2`'s scope: runs `act()` inside Playwright's `page.expect_response` for the autosave's `PUT /api/j2/notes/{id}` (a waiter, never a sampled poll, IR pre-flight S17), then reads the note back. `styles.update-layout` waits for the banner to hide and checks the added block; `styles.unknown-block` edits and waits for the save before reading. Task 13 re-walks them and reuses `save_landed`.

- [ ] **Step 1: Write the failing source rails**

`tests/test_notebook_fin_walk_styles_step.py`:

```python
"""Ledger R24 (P1 Task 15 review M2-M6): the styles walk step must wait, not sleep; the two rows must
check what their labels claim; the switch count must not be typed; styles_on mirrors the product gate.
These read the tool's source, because the only other proof is a two-hour re-walk (Task 13 is that)."""
from __future__ import annotations

import ast
import re
from pathlib import Path

FEATURES = Path("tools/notebook_fin_walk_features.py")
WALK = Path("tools/notebook_fin_walk.py")


def _styles_body() -> str:
    src = FEATURES.read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "styles":
            return ast.get_source_segment(src, node)
    raise AssertionError("no def styles() in the features file")       # non-vacuity


def test_the_styles_step_has_no_blind_sleep():
    body = _styles_body()
    assert "Review update" in body                                       # non-vacuity: the right function
    assert "wait_for_timeout(" not in body


def test_update_layout_reads_the_added_block_and_unknown_block_saves_first():
    body = _styles_body()
    assert re.search(r'widgetId"\)\s*==\s*"chart"', body), "update-layout must check the chart block landed"
    assert "keyboard.type(" in body.split("walkFutureBlock", 1)[1], "unknown-block must edit the note first"
    assert "save_landed" in body, "unknown-block must wait for the save, not a clock"


def test_no_typed_switch_count():
    src = WALK.read_text(encoding="utf-8")
    assert "WAVE_FLAGS = [" in src                                        # non-vacuity
    assert not re.search(r"\b(seventeen|eighteen|nineteen)\s+switches\b", src)


def test_styles_on_mirrors_the_product_gate():
    src = FEATURES.read_text(encoding="utf-8")
    line = next(l for l in src.splitlines() if "styles_on =" in l)
    assert "notebook_journal_styles_enabled" in line
    assert "paid_equiv" not in line
```

Add one more case to the same file (the waiter rule, IR pre-flight S17):

```python
def test_save_landed_waits_on_the_save_response_not_a_poll():
    src = FEATURES.read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next((n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "save_landed"), None)
    assert fn is not None, "no def save_landed in the features file"        # non-vacuity
    body = ast.get_source_segment(src, fn)
    assert "expect_response(" in body and '"PUT"' in body
    assert "wait_for_timeout(" not in body and "while " not in body
```

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-w
cd "$WT"
python -m pytest tests/test_notebook_fin_walk_styles_step.py -q > "$TEMP/p2a-t2.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: 5 failed.

- [ ] **Step 3: Fix the tool**

In `tools/notebook_fin_walk.py`, replace the comment at `:76` with:

```python
# The switches waves 11-14 and P1/P2 add and production has not armed (count them from the list,
# never from this line). Read against the ledger at run time (`flag_sets`), so a name that is not a
# real flag refuses the run.
```

In `tools/notebook_fin_walk_features.py`, add beside the module's imports (`grep -n "^import time" tools/notebook_fin_walk_features.py` finds them):

```python
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
```

At `:1420`, drop the second condition so the walk asks the product's own question:

```python
            styles_on = bool(meA.get("notebook_journal_styles_enabled"))
```

In `run_c2`, immediately before `def styles():`, add this helper (in `run_c2`'s scope, so Task 13's `blocks()` step uses it too):

```python
    def save_landed(page, note_id, act, ceiling_ms=15000):
        """Run `act()` (the member's edit), then WAIT for the autosave's own answer: the PUT to
        /api/j2/notes/{note_id} that lands it, 2xx. Playwright's waiter, never a sampled poll
        (CLAUDE.md "SAMPLING WHERE A WAITER WAS AVAILABLE"); the ceiling only bounds it. Returns the
        note the server holds after that PUT answered, or None when none landed inside the ceiling."""
        path = re.compile(rf"/api/j2/notes/{re.escape(str(note_id))}(\?|$)")
        try:
            with page.expect_response(lambda r: r.request.method == "PUT" and bool(path.search(r.url)) and r.ok,
                                      timeout=ceiling_ms):
                act()
        except PlaywrightTimeoutError:
            return None
        return M.get(base + f"/api/j2/notes/{note_id}").json()["note"]
```

Replace the update-layout block (`:2034-2042`) with:

```python
        if banner:
            pg.get_by_role("button", name="Review update").click()
            pg.get_by_role("button", name="Apply").click()
            pg.get_by_text(re.compile(r"Update layout to v\d+\?")).first.wait_for(state="hidden", timeout=15000)
        got = M.get(base + f"/api/j2/notes/{n['id']}").json()["note"]
        added = any(x.get("type") == "widgetEmbed" and (x.get("attrs") or {}).get("widgetId") == "chart"
                    for x in got.get("bodyJson", {}).get("content", []))
        conflicted = [x for x in C.notes_list(ctx, base) if "(conflicted copy)" in (x.get("title") or "")]
        ok = banner and added and got.get("styleVersion") == (mine or {}).get("version", 0) + 2 and not conflicted
        C.step(pg, inst, "styles.update-layout", "The banner's Review update -> Apply adds the block, stamps the version, forks nothing",
               "PASS" if ok else "FAIL", style_version=got.get("styleVersion"), chart_added=added, conflicted=len(conflicted))
```

Replace the unknown-block block (`:2054-2061`) with:

```python
        fb = M.post(base + "/api/j2/notes", data={"title": "Future block", "bodyJson": future}).json()["note"]
        C.goto(pg, base, f"/journal/notebook?note={fb['id']}", wait=".ProseMirror")
        card = C.vis_loc(pg.get_by_text("This block needs a newer version of the app. Reload to see it."), 10000)
        ed2 = pg.locator(".ProseMirror").first

        def edit():                                     # an edit, so the save writes the body back
            ed2.click()
            pg.keyboard.press("Control+Home")
            pg.keyboard.press("End")
            pg.keyboard.type("y", delay=40)
        landed = save_landed(pg, fb["id"], edit)
        kept = bool(landed) and any((x.get("attrs") or {}).get("widgetId") == "walkFutureBlock"
                                    for x in landed["bodyJson"]["content"])
        C.step(pg, inst, "styles.unknown-block", "A block from a newer version shows the card and survives an edit and a save",
               "PASS" if card and kept else "FAIL", card=card, saved=bool(landed), kept=kept)
```

(The test `test_update_layout_reads_the_added_block_and_unknown_block_saves_first` looks for `keyboard.type(` after `walkFutureBlock` and for `save_landed` in `styles()`'s body; both are there.)

- [ ] **Step 4: R28 N1 and N2**

In `NewNoteMenu.listCaret.css.test.js`, inside the CONTROLS `describe`, add (N1: a commented `@media` block must not count, which only `strip` prevents):

```js
  it('a whole @media block inside a comment does not count (this is what `strip` is for)', () => {
    const css = '/* @media (max-width: 640px) { .listCaret { position: static; } } */ .x { color: red; }'
    expect(declsFor(mediaBlocks(css, PHONE), '.listCaret')).toEqual({})
  })
```

and inside the contract `describe` (N2: the base anchor above 640 px, read from the text BEFORE the first `@media`, because `declsFor` merges every rule for a selector):

```js
  it('at >=641px the caret itself is the menu\'s containing block (base .listCaret is relative)', () => {
    const base = strip(MENU_CSS).split('@media')[0]
    expect(declsFor(base, '.listCaret')).toMatchObject({ position: 'relative', display: 'flex' })
  })
```

Mutation check: delete `const src = strip(css)`'s call to `strip` in `mediaBlocks` (use `const src = css`); the N1 case must FAIL. Restore. Delete `position: relative;` from `.listCaret` in `NewNoteMenu.module.css`; the N2 case must FAIL. Restore both by captured bytes and check the sha against `git cat-file blob HEAD:<path>`.

- [ ] **Step 5: Run**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-w
cd "$WT"
python -m pytest tests/test_notebook_fin_walk_styles_step.py -q > "$TEMP/p2a-t2.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-w
cd "$WT/app"
npx vitest run src/pages/journal-2-0/components/notebook/NewNoteMenu.listCaret.css.test.js > "$TEMP/p2a-t2-js.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: 5 passed; the vitest file passes with its two new cases.

- [ ] **Step 6: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-w
cd "$WT"
python tools/check_repo_hygiene.py
git add tools/notebook_fin_walk.py tools/notebook_fin_walk_features.py tests/test_notebook_fin_walk_styles_step.py app/src/pages/journal-2-0/components/notebook/NewNoteMenu.listCaret.css.test.js
git commit -F - -- tools/notebook_fin_walk.py tools/notebook_fin_walk_features.py tests/test_notebook_fin_walk_styles_step.py app/src/pages/journal-2-0/components/notebook/NewNoteMenu.listCaret.css.test.js <<'MSG'
test(notebook): P1 walk minors (R24, R28) -- waiters not sleeps, the two styles rows check what they claim, styles_on mirrors the gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 3: The market context stamp, server half (on the existing `marketcontext` widget)

Spec §P2 item 3. IR-S4, IR-S5, IR-S6, IR-S11.

**Lane:** S, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2-s`.

**Files:**
- Modify: `api/services/journal_two/trader_blocks.py` (append)
- Modify: `api/services/journal_two/journal_styles.py` (`BLOCK_KINDS` row, nothing else: `BLOCK_BUILDERS` already spreads `_tb.BUILDERS`)
- Modify: `app/src/pages/journal-2-0/lib/journalBlocks.js` (one row)
- Modify: `api/routers/notebook_journal_styles.py` (one GET route)
- Modify: `tools/notebook_contract_fixtures.py` (`journal_styles` builder, `:1648`)
- Test: `tests/test_trader_blocks_market_context.py` (new)

**Interfaces:**
- Produces:
  - `BLOCK_KINDS` row `{"id": "marketcontext", "settings": ({"key": "fields", "options": ("all", "regime", "indexes"), "default": "all"},)}` (no `search`, like `chart`: the client derives the embed's searchText from its params).
  - `trader_blocks.readings_from(breadth: dict) -> dict`: the server's copy of `marketContextModel.readingsFrom` (`marketPhase`, `exposureScore`, `exposureDelta`, `breadthScore`, `distributionDays`, `pctAbove50`, `pctAbove200`, `powerTrend: None`), railed against the client function through Node.
  - `trader_blocks.market_context_params(memo, *, user_id, now) -> dict` → `{"readings": {...readings_from, "regime": F, "spy": F, "qqq": F, "vix": F}, "wireDate": str|None, "updated": "H:MM AM ET"}` where every `F` is `{"value", "source", "asOf", "missing"}` and `missing` is a SENTENCE or `None` (IR-S4). `spy`/`qqq` `value` is `{"price", "changePct", "closed"}`. `vix` is always `{"value": None, ..., "missing": "VIX unavailable"}` in part a (IR-S5).
  - `BUILDERS["marketcontext"]`: in `mode == "create"` the node carries `market_context_params(...)` plus `fields`; in `mode == "update"` it carries `{"uncaptured": True, "fields": ...}` and reads nothing (IR-S11).
  - `GET /api/j2/trader-blocks/market-context` → `market_context_params(...)` for the caller (the slash item's insert reads it, Task 12).

- [ ] **Step 1: Write the failing tests**

`tests/test_trader_blocks_market_context.py`:

```python
"""P2a market context stamp (spec §P2 item 3), on the EXISTING marketcontext widget (IR-S6).
Hermetic: every source is patched at trader_blocks' own seams (pre-flight S22)."""
from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

NOW = datetime(2026, 10, 13, 17, 26, tzinfo=timezone.utc)          # 1:26 PM ET (EDT)
MODEL = Path("app/src/pages/charts/widgets/marketContextModel.js")
BREADTH = {"market_phase": "Uptrend", "exposure": {"score": 32.04, "score_delta": -4.0},
           "breadth_score": 47.56, "distribution_days": 3, "pct_above_50ma": 41.26,
           "pct_above_200ma": 55.0, "wire_date": "2026-10-13"}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def sources(monkeypatch):
    """Every market source, patched at trader_blocks' seams. Tests change the dict to vary them."""
    from api.services.journal_two import trader_blocks as tb
    s = {"breadth": dict(BREADTH),
         "regime": {"value": "orange", "source": "UCT Exposure Rating", "asOf": "2026-10-13",
                    "missing": None, "detail": None},
         "quotes": {"SPY": {"price": 600.5, "change_pct": -0.42, "observed_at": 1791912360, "market_closed": False}}}
    monkeypatch.setattr(tb, "_breadth", lambda: s["breadth"])
    monkeypatch.setattr(tb, "_regime_field", lambda memo: s["regime"])
    monkeypatch.setattr(tb, "_quotes", lambda user_id, symbols: s["quotes"])
    return s


def _client_readings(payload: dict) -> dict:
    node = shutil.which("node")
    assert node, "node is not on PATH"
    js = (f"import({json.dumps(MODEL.resolve().as_uri())}).then((m) => "
          f"process.stdout.write(JSON.stringify(m.readingsFrom({json.dumps(payload)}))))")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    assert r.returncode == 0, (r.stderr or b"").decode("utf-8", "replace")[:2000]
    return json.loads(r.stdout.decode("utf-8"))


@pytest.mark.parametrize("payload", [
    BREADTH,
    {},
    {"market_phase": "", "exposure": {"score": None}, "breadth_score": "x", "distribution_days": None},
    # 101.25 * 10 = 1012.5: JavaScript's Math.round gives 1013, Python's round() gives 1012 (it rounds
    # half to even). This row is what makes the rail able to see the two roundings differ.
    {"exposure": {"score": 101.25, "score_delta": 0.05}, "pct_above_50ma": 9.99, "pct_above_200ma": True},
])
def test_readings_mirror_the_client_derivation(payload):
    """ONE FACT IN TWO FILES: the server's readings_from and the client's readingsFrom, run on the SAME
    payload, answer the same keys and values (a /charts capture and a note stamp read identically)."""
    from api.services.journal_two import trader_blocks as tb
    client = _client_readings(payload)
    assert client                                                          # non-vacuity
    assert tb.readings_from(payload) == client


def test_params_carry_the_readings_and_the_sourced_fields(sources):
    from api.services.journal_two import trader_blocks as tb
    p = tb.market_context_params({}, user_id="u1", now=NOW)
    r = p["readings"]
    assert r["exposureScore"] == 32.0 and r["breadthScore"] == 47.6 and r["marketPhase"] == "Uptrend"
    assert r["regime"] == {"value": "orange", "source": "UCT Exposure Rating", "asOf": "2026-10-13", "missing": None}
    assert r["spy"]["value"] == {"price": 600.5, "changePct": -0.42, "closed": False}
    assert r["spy"]["asOf"] == "2026-10-13T17:26:00Z"
    assert r["qqq"] == {"value": None, "source": None, "asOf": None, "missing": "No QQQ quote could be read just now."}
    assert r["vix"] == {"value": None, "source": None, "asOf": None, "missing": "VIX unavailable"}
    assert p["wireDate"] == "2026-10-13" and p["updated"] == "1:26 PM ET"


def test_a_missing_source_is_a_sentence_never_an_object(sources):
    """IR-S4: entry_context answers `detail` as a DICT on a cold breadth; nothing stored may be one."""
    from api.services.journal_two import trader_blocks as tb
    sources["regime"] = {"value": None, "source": "uct_regime", "asOf": None, "missing": "wire_unavailable",
                         "detail": {"liveUnavailable": "cold"}}
    sources["quotes"] = {}
    r = tb.market_context_params({}, user_id="u1", now=NOW)["readings"]
    for key in ("regime", "spy", "qqq", "vix"):
        assert isinstance(r[key]["missing"], str) and r[key]["missing"], key
        assert "detail" not in r[key], key
    assert r["regime"]["missing"] == "The morning wire has not published an exposure rating yet."


def test_a_create_captures_and_an_update_does_not(sources, monkeypatch):
    """IR-S11: 'Update layout' must never stamp today's market into an older note."""
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    block = {"block": "marketcontext", "enabled": True, "settings": {"fields": "regime"}}
    node, reason = js.BLOCK_BUILDERS["marketcontext"](block, {"ticker": None, "now": NOW, "memo": {},
                                                               "mode": "create", "user_id": "u1"})
    assert reason is None and node["attrs"]["widgetId"] == "marketcontext"
    assert node["attrs"]["params"]["fields"] == "regime" and node["attrs"]["params"]["readings"]["regime"]["value"] == "orange"
    monkeypatch.setattr(tb, "market_context_params", lambda *a, **k: pytest.fail("an update must read nothing"))
    node, _ = js.BLOCK_BUILDERS["marketcontext"](block, {"ticker": None, "now": NOW, "memo": {},
                                                          "mode": "update", "user_id": "u1"})
    assert node["attrs"]["params"] == {"uncaptured": True, "fields": "regime"}


def test_the_stamp_node_is_buildable(sources, db_path):
    from api.services.journal_two import journal_styles as js, notes
    node, _ = js.BLOCK_BUILDERS["marketcontext"]({"block": "marketcontext", "settings": {}},
                                                  {"ticker": None, "now": NOW, "memo": {}, "mode": "create", "user_id": "u1"})
    notes._refuse_unbuildable(notes._validate_body_json({"type": "doc", "content": [node]}))


def test_route_off_free_paid(db_path, sources, monkeypatch):
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    url = "/api/j2/trader-blocks/market-context"
    monkeypatch.delenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", raising=False)
    assert TestClient(app).get(url).status_code == 404
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "free"}
    assert TestClient(app).get(url).status_code == 402
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    got = TestClient(app).get(url)
    assert got.status_code == 200 and got.json()["readings"]["regime"]["value"] == "orange"
```

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python -m pytest tests/test_trader_blocks_market_context.py -q > "$TEMP/p2a-t3.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (no `readings_from`).

- [ ] **Step 3: Append to `trader_blocks.py`**

Add `import math` to the module's imports, then append:

```python
# ── The market context stamp (spec §P2 item 3) on the EXISTING marketcontext widget (IR-S6) ─────
# ⛔ ONE FACT IN TWO FILES: readings_from mirrors app/src/pages/charts/widgets/marketContextModel.js
# readingsFrom, run against it through Node by tests/test_trader_blocks_market_context.py.
# ⛔ Every sourced field stores a `missing` SENTENCE, never entry_context's `detail` (IR-S4).

_MISSING_SENTENCES = {
    "wire_unavailable": "The morning wire has not published an exposure rating yet.",
    "source_error": "The regime could not be read just now.",
}
_VIX = {"value": None, "source": None, "asOf": None, "missing": "VIX unavailable"}   # IR-S5


def _num(v: Any) -> float | int | None:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf")) else None


def _round1(v: Any) -> float | None:
    """Math.round(v * 10) / 10, exactly: JavaScript rounds a half UP (floor(x + 0.5)); Python's
    round() rounds it to even, which would differ at 101.25."""
    n = _num(v)
    return None if n is None else math.floor(n * 10 + 0.5) / 10


def readings_from(breadth: dict) -> dict:
    """The wire payload -> the frozen reading set, exactly as marketContextModel.readingsFrom does."""
    b = breadth if isinstance(breadth, dict) else {}
    exp = b.get("exposure") if isinstance(b.get("exposure"), dict) else {}
    phase = b.get("market_phase")
    return {
        "marketPhase": phase if isinstance(phase, str) and phase else None,
        "exposureScore": _round1(exp.get("score")),
        "exposureDelta": _round1(exp.get("score_delta")),
        "breadthScore": _round1(b.get("breadth_score")),
        "distributionDays": _num(b.get("distribution_days")),
        "pctAbove50": _round1(b.get("pct_above_50ma")),
        "pctAbove200": _round1(b.get("pct_above_200ma")),
        "powerTrend": None,        # ⛔ null by owner direction (2026-04-17), exactly as the client
    }


def _breadth() -> dict:
    """The wire's breadth payload (the source /charts' Market Context reads)."""
    from api.services import engine
    payload = engine.get_breadth()
    return payload if isinstance(payload, dict) else {}


def _regime_field(memo: dict) -> dict:
    """The regime field as entry context reads it (entry_context._regime_fields: the wire cache only)."""
    from api.services.journal_two import entry_context
    return entry_context._regime_fields(memo)[0]


def _quotes(user_id: str, symbols: tuple[str, ...]) -> dict:
    """SPY/QQQ through the live-price route's own function (IR-S5): the shared 15 s per-ticker cache,
    then one bounded fetch under the same valve. A 503 / 400 answer is {}."""
    from api.routers import live_prices
    got = live_prices.get_live_prices(tickers=",".join(symbols), user={"id": user_id})
    return got if isinstance(got, dict) else {}


def _sourced(field: dict) -> dict:
    """entry_context's {value, source, asOf, missing(code), detail} -> the stored shape (a sentence)."""
    if field.get("missing"):
        code = str(field["missing"])
        return {"value": None, "source": None, "asOf": None,
                "missing": _MISSING_SENTENCES.get(code, "Not available when this note was written.")}
    return {"value": field.get("value"), "source": field.get("source"), "asOf": field.get("asOf"), "missing": None}


def _epoch_iso(v: Any) -> str | None:
    n = _num(v)
    return None if n is None else _iso(datetime.fromtimestamp(float(n), tz=timezone.utc))


def _et_clock(now: datetime) -> str:
    from zoneinfo import ZoneInfo
    t = now.astimezone(ZoneInfo("America/New_York"))
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'} ET"


def market_context_params(memo: dict, *, user_id: str, now: datetime) -> dict:
    """The params a marketcontext stamp freezes: the wire readings (/charts' exact derivation) plus the
    regime, SPY, QQQ and VIX, each sourced and dated or carrying a sentence saying why not."""
    breadth = _breadth()
    readings = readings_from(breadth)
    try:
        readings["regime"] = _sourced(_regime_field(memo))
    except Exception:  # noqa: BLE001 -- one source never takes the stamp down
        readings["regime"] = _sourced({"missing": "source_error"})
    try:
        quotes = _quotes(user_id, ("SPY", "QQQ"))
    except Exception:  # noqa: BLE001
        quotes = {}
    for key, sym in (("spy", "SPY"), ("qqq", "QQQ")):
        q = quotes.get(sym) if isinstance(quotes.get(sym), dict) else None
        if q and _num(q.get("price")) is not None:
            readings[key] = {"value": {"price": q["price"], "changePct": _num(q.get("change_pct")),
                                       "closed": bool(q.get("market_closed"))},
                             "source": "live price", "asOf": _epoch_iso(q.get("observed_at")), "missing": None}
        else:
            readings[key] = {"value": None, "source": None, "asOf": None,
                             "missing": f"No {sym} quote could be read just now."}
    readings["vix"] = dict(_VIX)
    wire = breadth.get("wire_date")
    return {"readings": readings, "wireDate": wire if isinstance(wire, str) and wire else None,
            "updated": _et_clock(now)}


def build_market_context(block: dict, ctx: dict):
    """A NEW note captures now; an older note offered the block by 'Update layout' gets it UNCAPTURED
    and reads nothing (IR-S11: never today's market in an older note)."""
    fields = _settings(block).get("fields", "all")
    if ctx.get("mode") == "update":
        params = {"uncaptured": True, "fields": fields}
    else:
        params = {**market_context_params(ctx.setdefault("memo", {}), user_id=ctx.get("user_id") or "",
                                          now=ctx["now"]), "fields": fields}
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "marketcontext", "embedId": uuid.uuid4().hex, "mode": "snapshot", "params": params,
        "capturedAt": _iso(ctx["now"]), "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None,
    }}, None


BUILDERS["marketcontext"] = build_market_context
```

(No `searchText`, exactly like P1's `_build_chart`: the client derives an embed's searchText from its params.)

- [ ] **Step 4: The catalog row, both files**

Append to `journal_styles.BLOCK_KINDS`:

```python
    # The market context stamp is the EXISTING marketcontext capture widget (IR-S6). No `search`.
    {"id": "marketcontext", "settings": (
        {"key": "fields", "options": ("all", "regime", "indexes"), "default": "all"},)},
```

Append to `journalBlocks.js` `BLOCK_KINDS`:

```js
  Object.freeze({
    id: 'marketcontext',
    label: 'Market context',
    settings: Object.freeze([
      Object.freeze({ key: 'fields', label: 'Show', options: Object.freeze(['all', 'regime', 'indexes']), default: 'all',
        optionLabels: Object.freeze({ all: 'Everything', regime: 'Regime, exposure and breadth', indexes: 'SPY, QQQ and VIX' }) }),
    ]),
  }),
```

- [ ] **Step 5: The read route**

In `api/routers/notebook_journal_styles.py`, add to the module docstring's route table:

```
  GET    /api/j2/trader-blocks/market-context           the readings a market context stamp freezes (P2a)
```

and the route (below the other GETs):

```python
@router.get("/trader-blocks/market-context")
def trader_market_context(user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Read-only (spec §P2 item 3): the params a hand-inserted market context stamp freezes, captured
    now and dated as such (R-P2-8). Every gap is a sentence."""
    from datetime import datetime, timezone
    from api.services.journal_two import trader_blocks
    return trader_blocks.market_context_params({}, user_id=user["id"], now=datetime.now(timezone.utc))
```

- [ ] **Step 6: Contract fixture**

In `tools/notebook_contract_fixtures.py`, at the end of `journal_styles(w)` (before any free-plan record), add:

```python
    w.as_user(who)
    w.record("trader-blocks.market-context", "GET", "/api/j2/trader-blocks/market-context",
             case="success", expect=200)
```

- [ ] **Step 7: Run**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python tools/notebook_contract_fixtures.py > "$TEMP/p2a-t3-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python -m pytest tests/test_trader_blocks_market_context.py tests/test_trader_blocks.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_update.py tests/test_journal_styles_create.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py -q > "$TEMP/p2a-t3.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. The router's route sweeps include the new GET (401 and 404 cases) without edits; read the fixture diff and confirm it adds only the new record. If `tests/test_journal_styles_compose.py` or `_update.py` pin a style's composed body by snapshot and a `marketcontext` row is not in any built-in style yet (Task 12 adds it), nothing they pin changes.

- [ ] **Step 8: Mutation-prove the parity rail and the update rule**

Capture `trader_blocks.py`. (a) Change `math.floor(n * 10 + 0.5) / 10` to `round(n * 10) / 10`: the 101.25 case of `test_readings_mirror_the_client_derivation` must FAIL (and only that case). (b) Change `if ctx.get("mode") == "update":` to `if False:`: `test_a_create_captures_and_an_update_does_not` must FAIL. Restore by bytes; check the sha.

- [ ] **Step 9: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python tools/check_repo_hygiene.py
git add api/services/journal_two/trader_blocks.py api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/journalBlocks.js api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks_market_context.py
git commit -F - -- api/services/journal_two/trader_blocks.py api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/journalBlocks.js api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks_market_context.py <<'MSG'
feat(notebook): market context stamp on the existing marketcontext widget -- readings mirrored and railed, sourced fields, never captured on update

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 4: `builtin:regime_at_write`, a captured property

Rests on R-P2-6, IR-S1, IR-S2 and Review Focus 4.

**Lane:** S, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2-s`.

**Files:**
- Modify: `api/services/journal_two/note_properties.py` (`BUILTIN_PROPERTY_DEFS` `:73`, `BUILTIN_USER_SET_IDS` `:118`, `set_note_properties` `:421-467`)
- Modify: `api/services/journal_two/notes.py` (`create_note` `:3263`, its call `:3319`). `update_note` is NOT changed: its call at `:3767` uses the default mode, which is the member-write mode.
- Modify: `api/services/journal_two/journal_styles.py` (`compose`, `create_styled_note` `:796`)
- Modify (per V7/V8): `app/src/pages/journal-2-0/components/notebook/PropertiesSection.jsx`, `NoteBoardView.jsx`
- Test: `tests/test_regime_at_write.py` (new)

**Interfaces:**
- Produces: `note_properties.REGIME_AT_WRITE = "builtin:regime_at_write"`; `BUILTIN_CAPTURED_IDS`; `set_note_properties(..., captured: str = "drop")` where `captured` is `"drop" | "keep"`; `notes.create_note(..., captured_properties: str = "drop")`.
- Rule (IR-S1): ONE guard, in `set_note_properties`. In `drop` mode (every caller but the composer) a captured id in the patch is ignored, and a REPLACE (a version restore) carries the note's current captured value forward. Only `keep` (the composer's `create_note`) writes it. Nothing keys on `propertiesReplace`.

- [ ] **Step 1: Write the failing tests**

`tests/test_regime_at_write.py`:

```python
"""R-P2-6 / IR-S1: builtin:regime_at_write is written once by the composer, never by a member (in
either property form), and a restore neither changes nor clears it."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def red(monkeypatch):
    """Every market source patched at trader_blocks' seams: the regime reads RED (hermetic)."""
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(tb, "_breadth", lambda: {})
    monkeypatch.setattr(tb, "_regime_field", lambda memo: {"value": "red", "source": "UCT Exposure Rating",
                                                         "asOf": "2026-10-13", "missing": None, "detail": None})
    monkeypatch.setattr(tb, "_quotes", lambda user_id, symbols: {})


def _styled_note(user="u1"):
    from api.services.journal_two import journal_styles as js
    s = js.create_style(user, {"name": "Ctx", "kindId": "thesis",
                               "blocks": [{"block": "marketcontext", "enabled": True, "settings": {}}]})
    n, _ = js.create_styled_note(user, {"styleId": s["id"]})
    return n


def _put(note_id, body):
    from api.routers import journal_two
    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1"}
    return TestClient(app).put(f"/api/j2/notes/{note_id}", json=body)


def test_a_styled_note_records_the_regime_it_was_written_in(db_path, red):
    n = _styled_note()
    assert n["propertiesJson"]["builtin:regime_at_write"] == "red"


def test_no_context_block_no_property(db_path, red):
    from api.services.journal_two import journal_styles as js
    n, _ = js.create_styled_note("u1", {"styleId": "builtin:weekly_review"})
    assert "builtin:regime_at_write" not in (n["propertiesJson"] or {})


def test_a_member_put_cannot_set_or_clear_it(db_path, red):
    """IR-S1: through the member's own PUT route, in BOTH forms. Filtered before the write: 200, unchanged."""
    from api.services.journal_two import notes
    n = _styled_note()
    for body in ({"properties": {"builtin:regime_at_write": "green"}},
                 {"propertiesReplace": {"builtin:regime_at_write": "green"}},
                 {"propertiesReplace": {}}):
        got = _put(n["id"], body)
        assert got.status_code == 200, (body, got.text)
        assert notes.get_note("u1", n["id"])["propertiesJson"].get("builtin:regime_at_write") == "red", body
    plain = notes.create_note("u1", {"title": "plain"})
    assert _put(plain["id"], {"properties": {"builtin:regime_at_write": "green"}}).status_code == 200
    assert "builtin:regime_at_write" not in (notes.get_note("u1", plain["id"])["propertiesJson"] or {})


def test_a_member_cannot_set_a_derived_builtin_either(db_path):
    """IR-S2: the refusal a member sees for a non-settable built-in is notes.NoteValidationError (400)."""
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"})
    with pytest.raises(notes.NoteValidationError):
        notes.update_note("u1", n["id"], {"properties": {"builtin:ticker": "NVDA"}}, client_schema=4)


def test_a_plain_create_drops_it(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"}, properties={"builtin:regime_at_write": "green",
                                                            "builtin:confidence": "high"})
    assert n["propertiesJson"] == {"builtin:confidence": "high"}


def test_a_version_restore_keeps_the_captured_regime_and_captures_nothing(db_path, red, monkeypatch):
    from api.services.journal_two import notes, trader_blocks as tb
    n = _styled_note()
    n2 = notes.update_note("u1", n["id"], {"title": "edited"}, client_schema=4, force_version=True)
    oldest = notes.list_note_versions("u1", n["id"])[-1]
    monkeypatch.setattr(tb, "market_context_params", lambda *a, **k: pytest.fail("a restore must not capture"))
    restored = notes.restore_note_version("u1", n["id"], oldest["id"], expected_updated_at=n2["updatedAt"])
    assert restored["propertiesJson"]["builtin:regime_at_write"] == "red"


def test_the_def_is_listed_and_read_only():
    from api.services.journal_two import note_properties as np
    d = np._BUILTIN_BY_ID["builtin:regime_at_write"]
    assert d["source"] == "captured" and d["type"] == "select"
    assert [o["id"] for o in d["options"]] == ["green", "amber", "orange", "red"]
    assert "builtin:regime_at_write" not in np.BUILTIN_USER_SET_IDS
    assert np.BUILTIN_CAPTURED_IDS == frozenset({"builtin:regime_at_write"})
```

Before running, confirm three names this test leans on: `grep -n "^def get_note(\|^def list_note_versions(\|^_BUILTIN_BY_ID" api/services/journal_two/notes.py api/services/journal_two/note_properties.py` (plan time: `list_note_versions` `:3478`; `get_note` and `_BUILTIN_BY_ID` to be read), and `list_note_versions`' keyword list (it may need `limit`). Use the names they print.

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python -m pytest tests/test_regime_at_write.py -q > "$TEMP/p2a-t4.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (no such def).

- [ ] **Step 3: The definition and the captured modes**

In `note_properties.py`, append to `BUILTIN_PROPERTY_DEFS` (after the `NOTE_KIND_PROPERTY` entry):

```python
    # Notebook P2 (R-P2-6): the regime the note was WRITTEN in, captured once by the composer from its
    # market context stamp. ⛔ source "captured": no member write sets or clears it (IR-S1).
    {
        "id": "builtin:regime_at_write", "name": "Regime when written", "type": "select", "source": "captured",
        "options": [{"id": "green", "label": "Green", "color": "green"},
                    {"id": "amber", "label": "Yellow", "color": "amber"},
                    {"id": "orange", "label": "Orange", "color": "amber"},
                    {"id": "red", "label": "Red", "color": "red"}],
    },
```

Below `BUILTIN_USER_SET_IDS` add:

```python
REGIME_AT_WRITE = "builtin:regime_at_write"
BUILTIN_CAPTURED_IDS = frozenset(d["id"] for d in BUILTIN_PROPERTY_DEFS if d["source"] == "captured")
```

Change `set_note_properties`'s signature to `(user_id, note_id, patch, conn, *, replace: bool = False, captured: str = "drop")`, add to its docstring: "`captured` decides a captured built-in (IR-S1). `drop` (every member write, a template, a plain create): a captured id in `patch` is ignored, and a `replace` carries the note's CURRENT captured value forward, so no member write and no restore can set, change or clear it. `keep`: the journal styles composer's create, the only writer.", and replace the body from `current: dict[str, Any] = {}` to the end of the loop's first branch with:

```python
    stored: dict[str, Any] = {}
    if not replace or captured == "drop":
        row = conn.execute(
            "SELECT properties_json FROM j2_notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        ).fetchone()
        stored = _parse_properties_json(row["properties_json"] if row else None)
    current: dict[str, Any] = {} if replace else dict(stored)
    if replace and captured == "drop":
        # IR-S1: a restore replaces what the member set; a CAPTURED fact is not the member's.
        current.update({k: v for k, v in stored.items() if k in BUILTIN_CAPTURED_IDS})
    for property_id, value in patch.items():
        if property_id in BUILTIN_CAPTURED_IDS:
            if captured != "keep":
                continue                       # IR-S1: filtered before the write, in every form
            prop_def = _builtin_def(user_id, property_id, conn)
        elif is_builtin_property_id(property_id):
            if property_id not in BUILTIN_USER_SET_IDS:
                raise PropertyValidationError(f"{property_id} is not a settable property")
            prop_def = _builtin_def(user_id, property_id, conn)
        else:
```

(the `else:` body and the rest are unchanged; a create of a NEW note has no row, so `stored` is `{}` there). Read `_builtin_def` first: if it only serves `user_set` ids, extend its lookup to `BUILTIN_PROPERTY_DEFS` by id.

- [ ] **Step 4: Thread the create mode through `notes.py`**

`create_note`: add the keyword `captured_properties: str = "drop"` after `style_stamp`, document it beside `properties` ("INTERNAL: `keep` only from the journal styles composer, the one writer of a captured built-in (IR-S1)"), and change `:3319` to:

```python
                properties_json = set_note_properties(user_id, new_id, properties, conn, replace=True,
                                                      captured=captured_properties)
```

`update_note` (`:3767`) keeps its call as it is: `drop` is the default, which is the member-write mode, and a restore's `propertiesReplace` takes the carry-forward branch.

- [ ] **Step 5: The composer captures it**

In `journal_styles.compose`, after `props[_nk().NOTE_KIND_PROPERTY] = style["kindId"]` (`:760`), add:

```python
        from api.services.journal_two import note_properties as np_
        reg = _captured_regime(doc["content"])
        if reg:
            props[np_.REGIME_AT_WRITE] = reg
```

and a module-level helper beside `_present`:

```python
def _captured_regime(content: list) -> str | None:
    """The regime id frozen in the first market context stamp of a composed body (R-P2-6), or None.
    An uncaptured stamp (IR-S11) has no readings, so it yields None."""
    stack = list(content or [])
    while stack:
        n = stack.pop(0)
        if not isinstance(n, dict):
            continue
        a = n.get("attrs") or {}
        if n.get("type") == "widgetEmbed" and a.get("widgetId") == "marketcontext":
            r = (((a.get("params") or {}).get("readings") or {}).get("regime") or {})
            return r.get("value") if r.get("value") in ("green", "amber", "orange", "red") else None
        if isinstance(n.get("content"), list):
            stack[0:0] = n["content"]
    return None
```

In `create_styled_note` (`:796`), pass the mode on the create:

```python
        note = notes_service.create_note(
            user_id, base, conn, properties=composed["properties"], captured_properties="keep",
            style_stamp=(composed["styleId"], composed["styleVersion"], composed["kindId"]))
```

`compose` also serves `preview` (writes nothing) and the update path's `insertsOutline` branch, which writes `bodyJson` only, so the property is set on creation only, as the spec says ("On note creation, captures").

- [ ] **Step 6: The Properties section and the Board (per V7, V8)**

If V7 found that non-`user_set` built-ins already render read-only and are never offered in "Add property", change nothing there and say so in the commit message; otherwise add `'captured'` to the source test that renders a built-in read-only, with a vitest case in `PropertiesSection.test.jsx`: "a captured built-in renders its option label and offers no editor and no Add". If V8 found the Board does not offer a `captured` select as a group, add `'captured'` to the sources its group picker accepts, with a case in `NoteBoardView.test.jsx`: "a note's Regime when written groups the board, read-only (no drag between columns for a captured property)". (A captured property must never be MOVED by a board drag: the drop path calls the same merge `properties` write, which IR-S1 now drops; the case asserts the column picker hides the move control for it.)

- [ ] **Step 7: Run**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python -m pytest tests/test_regime_at_write.py tests/test_trader_blocks_market_context.py tests/test_journal_styles_compose.py tests/test_journal_styles_create.py tests/test_journal_two_properties_router.py tests/test_journal_two_notes_versions_router.py tests/test_note_kind_property.py tests/test_journal_two_note_templates_router.py tests/test_notebook_template_gallery.py -q > "$TEMP/p2a-t4.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

(and `npx vitest run` on the two client test files if Step 6 changed them). Expected: all pass.

- [ ] **Step 8: Mutation-prove the guard**

Capture `note_properties.py`. (a) Delete the `continue` line (so a member's captured id falls through to validation and is written): `test_a_member_put_cannot_set_or_clear_it` must FAIL on the `properties` form. (b) Restore; delete the `current.update(...)` carry-forward line: the same test must FAIL on `{"propertiesReplace": {}}`, and `test_a_version_restore_keeps_the_captured_regime_and_captures_nothing` must FAIL. Restore by bytes; check the sha.

- [ ] **Step 9: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python tools/check_repo_hygiene.py
git add api/services/journal_two/note_properties.py api/services/journal_two/notes.py api/services/journal_two/journal_styles.py tests/test_regime_at_write.py
git commit -F - -- api/services/journal_two/note_properties.py api/services/journal_two/notes.py api/services/journal_two/journal_styles.py tests/test_regime_at_write.py <<'MSG'
feat(notebook): builtin:regime_at_write -- captured by the composer only; stripped from member writes in both forms; a restore carries it forward

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

(Add `PropertiesSection.jsx`, `NoteBoardView.jsx` and their tests to both lists if Step 6 changed them.)

---

### Task 5: The pre-entry record for an open position (Log Trade, server half)

Rests on R-P2-7.

**Lane:** S, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2-s`.

**Files:**
- Modify: `api/services/journal_two/trader_blocks.py` (append)
- Modify: `api/routers/notebook_journal_styles.py` (one PUT)
- Modify: `api/routers/journal_two.py` (`get_trade_adherence_route`, its last line: `return adherence_store.get_adherence(user["id"], detail["tradeRef"])`)
- Modify: `tools/notebook_contract_fixtures.py`
- Test: `tests/test_trader_blocks_pre_entry.py` (new), `tests/test_trader_blocks_no_note_door.py` (new)

**Interfaces:**
- Produces: `PUT /api/j2/trader-blocks/positions/{position_id}/pre-entry`, body `{setup: str|null, checkedRuleIds: [str], totalRules: int}` → the stored adherence record; 404 for a position that is not the caller's. `trader_blocks.PRE_ENTRY_PREFIX = "pos:"`; `trader_blocks.save_pre_entry(user_id, position_id, setup, checked, total) -> dict | None`.
- Changes: `GET /api/j2/trades/{trade_id}/adherence` answers the `pos:<positionId>` record when the trade has none of its own.

- [ ] **Step 1: Write the failing tests**

`tests/test_trader_blocks_pre_entry.py`:

```python
"""R-P2-7: ticks made in Log Trade for an OPEN position carry to the closed trade's adherence card."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _position(user="u1", pid="p1"):
    from api.services.auth_db import get_connection
    c = get_connection()
    c.execute("INSERT INTO j2_positions (id, user_id, symbol, side, shares, entry_price, entry_date, stop_price,"
              " context_at_entry, created_at, updated_at) VALUES (?, ?, 'NVDA', 'Long', 10, 100, '2026-10-13',"
              " 95, '{}', 'now', 'now')", (pid, user))
    c.commit()
    c.close()


def _app(plan="pro"):
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": plan}
    return TestClient(app)


def test_put_stores_under_the_position_ref(db_path):
    from api.services.journal_two import adherence_store
    _position()
    got = _app().put("/api/j2/trader-blocks/positions/p1/pre-entry",
                     json={"setup": "VCP", "checkedRuleIds": ["r1"], "totalRules": 3})
    assert got.status_code == 200
    rec = adherence_store.get_adherence("u1", "pos:p1")
    assert rec["checkedRuleIds"] == ["r1"] and rec["totalRules"] == 3


def test_a_foreign_position_is_404(db_path):
    _position(user="u2", pid="p9")
    got = _app().put("/api/j2/trader-blocks/positions/p9/pre-entry", json={"setup": None, "checkedRuleIds": [], "totalRules": 0})
    assert got.status_code == 404


def test_bad_body_is_400(db_path):
    _position()
    got = _app().put("/api/j2/trader-blocks/positions/p1/pre-entry", json={"checkedRuleIds": "r1", "totalRules": 1})
    assert got.status_code == 400


def test_the_closed_trade_reads_the_position_record_when_it_has_none(db_path, monkeypatch):
    from api.routers import journal_two
    from api.services.journal_two import adherence_store
    adherence_store.upsert_adherence("u1", "pos:p1", "VCP", ["r1"], 2)
    monkeypatch.setattr(journal_two.trades_service, "get_trade_detail",
                        lambda uid, tid: {"tradeRef": "id:t1", "positionId": "p1"})
    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1"}
    assert TestClient(app).get("/api/j2/trades/t1/adherence").json()["checkedRuleIds"] == ["r1"]
    adherence_store.upsert_adherence("u1", "id:t1", "VCP", ["r1", "r2"], 2)
    assert TestClient(app).get("/api/j2/trades/t1/adherence").json()["checkedRuleIds"] == ["r1", "r2"]
```

(The `INSERT INTO j2_positions` column list must match `db.py`'s `j2_positions` NOT NULL columns; read `grep -n "CREATE TABLE IF NOT EXISTS j2_positions" -A 20 api/services/journal_two/db.py` and the `_PHASE_2_ALTERS` rows for `j2_positions` NOT NULL defaults before running, and adjust the list to what the table requires.)

`tests/test_trader_blocks_no_note_door.py`:

```python
"""Spec §P2 integrity rule, server half: trader_blocks.py writes no note. Read by AST, with controls."""
from __future__ import annotations

import ast
from pathlib import Path

SRC = Path("api/services/journal_two/trader_blocks.py")
NOTE_WRITERS = {"create_note", "update_note", "append_widget_embed", "append_financial_fact",
                "append_document_excerpt", "restore_note", "restore_note_version", "patch_note_tags"}


def problems(src: str) -> list[str]:
    out = []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            low = node.value.lower()
            if "update j2_notes" in low or "insert into j2_notes" in low or "delete from j2_notes" in low:
                out.append(f"SQL on j2_notes: {node.value[:60]}")
        if isinstance(node, ast.Attribute) and node.attr in NOTE_WRITERS:
            out.append(f"calls a note writer: {node.attr}")
        if isinstance(node, ast.Name) and node.id in NOTE_WRITERS:
            out.append(f"names a note writer: {node.id}")
        if isinstance(node, ast.ImportFrom) and node.module and node.module.endswith("notes"):
            out += [f"imports a note writer: {a.name}" for a in node.names if a.name in NOTE_WRITERS]
    return out


def test_trader_blocks_writes_no_note():
    src = SRC.read_text(encoding="utf-8")
    assert "def build_position_sizing" in src and "def save_pre_entry" in src   # non-vacuity: the real file
    assert problems(src) == []


def test_control_a_planted_write_is_seen():
    assert problems('conn.execute("UPDATE j2_notes SET title = ?")')
    assert problems("notes_service.update_note(u, n, {})")
    assert problems("from api.services.journal_two.notes import create_note")
    assert problems("f = create_note")
    assert problems("x = notes.get_note(u, n)") == []              # a read is not a write
```

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python -m pytest tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py -q > "$TEMP/p2a-t5.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: the pre-entry tests FAIL (404 on the PUT, the fallback missing) and the door rail FAILS on its non-vacuity line (`save_pre_entry` does not exist yet); after Step 3 the rail guards from then on.

- [ ] **Step 3: The service function**

Append to `trader_blocks.py`:

```python
# ── Log Trade's checklist for an OPEN position (R-P2-7) ─────────────────────────────────────
PRE_ENTRY_PREFIX = "pos:"


def save_pre_entry(user_id: str, position_id: str, setup: str | None, checked: list[str],
                   total: int) -> dict | None:
    """The ticks made in Log Trade, stored in the adherence store under `pos:<position id>` (the
    closed trade's adherence read falls back to it). None when the position is not this member's."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import adherence_store
    c = get_connection()
    try:
        own = c.execute("SELECT 1 FROM j2_positions WHERE id = ? AND user_id = ?", (position_id, user_id)).fetchone()
    finally:
        c.close()
    if own is None:
        return None
    return adherence_store.upsert_adherence(user_id, PRE_ENTRY_PREFIX + position_id, setup, checked, total)
```

- [ ] **Step 4: The route**

In `notebook_journal_styles.py` (docstring row `PUT /api/j2/trader-blocks/positions/{position_id}/pre-entry  Log Trade's ticks for an open position (P2a)`):

```python
@router.put("/trader-blocks/positions/{position_id}/pre-entry")
def trader_pre_entry(position_id: str, body: dict = Depends(paid_body),
                     user: dict = Depends(require_paid)) -> dict[str, Any]:
    """R-P2-7: writes the adherence store, never a note."""
    from api.services.journal_two import trader_blocks
    setup = body.get("setup")
    checked = body.get("checkedRuleIds", [])
    total = body.get("totalRules", 0)
    if setup is not None and not isinstance(setup, str):
        raise HTTPException(status_code=400, detail="setup must be a string")
    if not isinstance(checked, list) or not all(isinstance(x, str) for x in checked):
        raise HTTPException(status_code=400, detail="checkedRuleIds must be a list of strings")
    if isinstance(total, bool) or not isinstance(total, int) or total < 0:
        raise HTTPException(status_code=400, detail="totalRules must be a non-negative integer")
    rec = trader_blocks.save_pre_entry(user["id"], position_id, setup, checked, total)
    if rec is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return rec
```

- [ ] **Step 5: The fallback on the closed trade's read**

In `api/routers/journal_two.py`, `get_trade_adherence_route`, replace its last line with:

```python
    own = adherence_store.get_adherence(user["id"], detail["tradeRef"])
    if own is None and detail.get("positionId"):
        # Notebook P2 (R-P2-7): the ticks made in Log Trade while the position was open.
        return adherence_store.get_adherence(user["id"], "pos:" + str(detail["positionId"]))
    return own
```

- [ ] **Step 6: Contract fixture**

In `journal_styles(w)` in `tools/notebook_contract_fixtures.py`, create a position for `who` with the same column list the test used, then:

```python
    w.record("trader-blocks.pre-entry", "PUT", "/api/j2/trader-blocks/positions/pos-styles-1/pre-entry",
             case="success", expect=200, json_body={"setup": "VCP", "checkedRuleIds": ["r1"], "totalRules": 2})
    w.record("trader-blocks.pre-entry.not-found", "PUT", "/api/j2/trader-blocks/positions/nope/pre-entry",
             case="error", expect=404, json_body={"setup": None, "checkedRuleIds": [], "totalRules": 0})
```

- [ ] **Step 7: Run, the door census included (IR-I c)**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python tools/notebook_contract_fixtures.py > "$TEMP/p2a-t5-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python -m pytest tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py tests/test_trader_blocks.py tests/test_trader_blocks_market_context.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py -q > "$TEMP/p2a-t5.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT/app"
npx vitest run src/pages/journal-2-0/lib/offline/doorEnumeration.test.js > "$TEMP/p2a-t5-doors.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

No adherence router test file exists under `tests/` (`git ls-files tests | grep -i adherence` is empty at plan time), so the fallback is covered by `test_the_closed_trade_reads_the_position_record_when_it_has_none` alone. Expected: all pass, and the door census still names exactly SEVEN note-advancing functions (the new PUT writes the adherence store).

- [ ] **Step 8: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-s
cd "$WT"
python tools/check_repo_hygiene.py
git add api/services/journal_two/trader_blocks.py api/routers/notebook_journal_styles.py api/routers/journal_two.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py
git commit -F - -- api/services/journal_two/trader_blocks.py api/routers/notebook_journal_styles.py api/routers/journal_two.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py <<'MSG'
feat(notebook): Log Trade pre-entry ticks for an open position carry to the closed trade's adherence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 6: The client block platform, the binding rails and the no-new-door rail

IR-B2, IR-B3, IR-B5, IR-I (a, b, c), pre-flight S15, S16, S20, S23.

**Lane:** C, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2-c`.

**Files:**
- Modify: `app/src/widgets/registry.js` (`validatePanelManifest` `:209`; three manifests in `PANEL_MANIFESTS` after `modelbook`; `isTraderBlock` below `widgetMeta` `:945`)
- Modify: `app/src/widgets/registry.test.js` (`IDS` `:41-49`, `CAPTURE_ONLY` `:51`, the three label maps `:60-96`, the defaults table `:98-130`, the drift rail `:563-578`; new cases)
- Modify: `api/services/journal_two/public_note_payload.py` (`MARKET_DATA_VENDORS`, three rows)
- Modify: `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx` (the dispatcher, behind `EmbedErrorBoundary` `:83`)
- Create: `app/src/pages/journal-2-0/components/notebook/blocks/BlockNodeView.jsx`, `Blocks.module.css`, `useBlockParams.js`, `blockStates.jsx`, and stub bodies `PreEntryChecklistBlock.jsx`, `PriceStampsBlock.jsx`, `PositionSizingBlock.jsx`
- Create: `app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js`
- Modify: `app/src/pages/journal-2-0/a11y/population.js`, `a11y/notebookSurfaces.js`; create `a11y/traderBlocks.a11y.test.jsx`
- Test: `blocks/BlockNodeView.test.jsx`, `blocks/blockParams.test.jsx`, `WidgetEmbedView.unknownKind.test.jsx` (one case)

**Interfaces:**
- Produces:
  - registry manifests `preEntryChecklist`, `priceStamps`, `positionSizing`: `captureOnly: true`, `block: true`, all menus false, `reconstructable: false`, `liveCapable: false`, `plainText: () => '<the catalog search line>'`.
  - `isTraderBlock(widgetId) -> boolean` exported from `registry.js` (`WIDGET_REGISTRY[id]?.block === true`).
  - `BlockNodeView({node, editor, updateAttributes, deleteNode, selected})` (default export) and `BLOCK_COMPONENTS` (named), the ONLY binding of a block id.
  - A block body receives `{ params, setParams, editable, editor, attrs }`. `setParams(patch) -> boolean` merges `patch` into `params` in ONE `updateAttributes` call that also re-derives `searchText`; it returns `false` (and writes nothing) when the editor is not editable.
  - `blockStates.jsx` exports `BlockEmpty({title, children})`, `BlockError({onRetry})` (`BLOCK_ERROR_SENTENCE = "This block couldn't load. Your note is safe."`), `BlockNeedsSwitch({what})` (`"This block needs {what}, which is not on for you."`), `BlockLoading()`.
  - `blockDoors.test.js`: `WRITE_EXCEPTIONS = {}` (IR-B5), keyed `{file: [{method, url, why}]}` (IR-I b); exported `problemsIn(file, src, exceptions)`.

- [ ] **Step 1: Write the failing tests**

`app/src/pages/journal-2-0/components/notebook/blocks/blockParams.test.jsx`:

```jsx
// Spec §P2 integrity rule: a block's state changes ONLY through an editor transaction.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useBlockParams } from './useBlockParams'

function Probe({ attrs, updateAttributes, editable }) {
  const setParams = useBlockParams({ attrs, updateAttributes, editable })
  return <button type="button" onClick={() => setParams({ checked: ['r1'] })}>tick</button>
}

describe('useBlockParams', () => {
  beforeEach(() => { globalThis.fetch = vi.fn() })

  it('a tick is ONE transaction through updateAttributes, no fetch', () => {
    const updateAttributes = vi.fn()
    const attrs = { widgetId: 'preEntryChecklist', params: { setup: 'VCP', checked: [] } }
    render(<Probe attrs={attrs} updateAttributes={updateAttributes} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'tick' }))
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    expect(updateAttributes.mock.calls[0][0]).toEqual({
      params: { setup: 'VCP', checked: ['r1'] }, searchText: '[pre-entry checklist]',
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('a reader (not editable) writes nothing', () => {
    const updateAttributes = vi.fn()
    render(<Probe attrs={{ widgetId: 'preEntryChecklist', params: {} }} updateAttributes={updateAttributes} editable={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'tick' }))
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('two ticks in a row read the LATEST params, never a stale render', () => {
    const calls = []
    let attrs = { widgetId: 'preEntryChecklist', params: { checked: [] } }
    const updateAttributes = (a) => { calls.push(a); attrs = { ...attrs, params: a.params } }
    function Two() {
      const set = useBlockParams({ attrs, updateAttributes, editable: true })
      return <button type="button" onClick={() => { set({ checked: ['a'] }); set({ setup: 'VCP' }) }}>two</button>
    }
    render(<Two />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'two' })) })
    expect(calls[1].params).toEqual({ checked: ['a'], setup: 'VCP' })
  })
})
```

`app/src/pages/journal-2-0/components/notebook/blocks/BlockNodeView.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
vi.mock('./PreEntryChecklistBlock', () => ({ default: () => { throw new Error('boom') } }))
vi.mock('./PriceStampsBlock', () => ({
  default: ({ params }) => <button type="button" aria-label="Stamp prices as I write">stamps {params.on}</button>,
}))

import BlockNodeView from './BlockNodeView'
import { BLOCK_ERROR_SENTENCE } from './blockStates'

const node = (widgetId, params = {}) => ({ attrs: { widgetId, params, searchText: '[x]' } })
const editor = (extra = {}) => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1', ...extra } } })

describe('BlockNodeView', () => {
  it('renders the block body with its params, labelled by the block name', async () => {
    render(<BlockNodeView node={node('priceStamps', { on: 'yes' })} editor={editor()} updateAttributes={() => {}} />)
    expect(await screen.findByText('stamps yes')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Price stamps' })).toBeTruthy()
  })
  it('a body that throws shows the error state and never blanks the note', async () => {
    render(<BlockNodeView node={node('preEntryChecklist')} editor={editor()} updateAttributes={() => {}} />)
    expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Pre-entry checklist' })).toBeTruthy()
  })
  it('on a public share page it renders the block line only (nothing auth-scoped mounts)', () => {
    render(<BlockNodeView node={node('priceStamps', { on: 'yes' })} editor={editor({ shareView: true })} updateAttributes={() => {}} />)
    expect(screen.getByText('[x]')).toBeTruthy()
    expect(screen.queryByText('stamps yes')).toBeNull()
  })
  it('keyboard path (S23): Tab reaches the block\'s first control, the Remove button, and leaves it again', async () => {
    const deleteNode = vi.fn()
    render(<>
      <button type="button">before</button>
      <BlockNodeView node={node('priceStamps', { on: 'yes' })} editor={editor()} updateAttributes={() => {}} deleteNode={deleteNode} />
      <button type="button">after</button>
    </>)
    await screen.findByText('stamps yes')
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'before' }).focus()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Price stamps' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stamp prices as I write' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }))   // and out again
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    await user.keyboard('{Enter}')                                                       // Enter on Remove
    expect(deleteNode).toHaveBeenCalledTimes(1)
  })
})
```

`app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js`:

```js
/**
 * ⛔⛔ SPEC §P2 INTEGRITY RULE, CLIENT HALF — "No block may own a second write door."
 *
 * Every file under components/notebook/blocks/ and lib/blocks/, plus components/LogTradeChecklist.jsx
 * (tests excluded), is parsed with acorn:
 *   ① every request is a GET unless it matches a NAMED method+URL exception below (IR-I b): a fetch
 *     whose options are not an object literal with a literal `method` reads as method '?', which is
 *     never exempt (IR-I a); navigator.sendBeacon, XMLHttpRequest and the json(Post|Put|Patch|Delete)
 *     helpers are writes too. The door census (doorEnumeration.test.js ①/②) still pins the server to
 *     seven note-advancing functions, so a note door cannot hide behind an exception;
 *   ② no block file imports the offline write layer (lib/offline/*) or the styles writes
 *     (lib/journalStyles.js);
 *   ③ `updateAttributes(` is called in exactly ONE block file, useBlockParams.js.
 * ⛔ IR-B5: WRITE_EXCEPTIONS starts EMPTY. The task that creates a writing file adds its own entry in
 * the same commit, so this rail is green at every task boundary.
 * The controls plant each failure in memory and prove the rail sees it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const DIRS = [join(REPO, 'app/src/pages/journal-2-0/components/notebook/blocks'),
  join(REPO, 'app/src/pages/journal-2-0/lib/blocks')]
const EXTRA = [join(REPO, 'app/src/pages/journal-2-0/components/LogTradeChecklist.jsx')]
const rel = (p) => relative(REPO, p).split(sep).join('/')
const P = Parser.extend(jsx())

/** file -> [{ method, url (a RegExp source over the call's URL, `{}` standing for each ${…}), why }] */
export const WRITE_EXCEPTIONS = {}

const HELPER_METHOD = { jsonPost: 'POST', jsonPut: 'PUT', jsonPatch: 'PATCH', jsonDelete: 'DELETE' }

function urlOf(arg) {
  if (!arg) return '?'
  if (arg.type === 'Literal') return String(arg.value)
  if (arg.type === 'TemplateLiteral') return arg.quasis.map((q) => q.value.cooked).join('{}')
  return '?'
}

function methodOf(opts) {
  if (!opts) return 'GET'
  if (opts.type !== 'ObjectExpression') return '?'                       // IR-I a: a variable, a call, …
  if (opts.properties.some((p) => p.type === 'SpreadElement')) return '?'
  const m = opts.properties.find((p) => (p.key?.name || p.key?.value) === 'method')
  if (!m) return 'GET'
  return m.value?.type === 'Literal' ? String(m.value.value).toUpperCase() : '?'
}

function exempt(exceptions, file, method, url) {
  return (exceptions[file] || []).some((e) => e.method === method && new RegExp(`^${e.url}$`).test(url))
}

export function problemsIn(file, src, exceptions = WRITE_EXCEPTIONS) {
  const out = []
  const ast = P.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const write = (method, url) => { if (!exempt(exceptions, file, method, url)) out.push(`WRITE ${file}: ${method} ${url}`) }
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ImportDeclaration' && /lib\/offline\/|journalStyles(\.js)?$/.test(n.source.value)) {
      out.push(`IMPORT ${file}: ${n.source.value}`)
    }
    if (n.type === 'NewExpression' && n.callee?.name === 'XMLHttpRequest') out.push(`XHR ${file}`)
    if (n.type === 'CallExpression') {
      const callee = n.callee.type === 'Identifier' ? n.callee.name : n.callee.property?.name
      if (callee === 'updateAttributes' && !file.endsWith('/useBlockParams.js')) out.push(`UPDATE ${file}`)
      if (callee === 'fetch') {
        const method = methodOf(n.arguments[1])
        if (method !== 'GET') write(method, urlOf(n.arguments[0]))
      }
      if (callee === 'sendBeacon') write('POST', urlOf(n.arguments[0]))
      if (HELPER_METHOD[callee]) write(HELPER_METHOD[callee], urlOf(n.arguments[0]))
    }
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v)
    }
  }
  visit(ast)
  return out
}

function files() {
  const out = []
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push(p) } }
  for (const d of DIRS) if (existsSync(d)) walk(d)
  for (const f of EXTRA) if (existsSync(f)) out.push(f)
  return out.filter((p) => /\.(js|jsx)$/.test(p) && !/\.test\.jsx?$/.test(p))
}

describe('⛔⛔ no block owns a second write door', () => {
  it('the real block files: nothing found, and the rail read them', () => {
    const fs = files()
    expect(fs.map(rel)).toContain('app/src/pages/journal-2-0/components/notebook/blocks/useBlockParams.js')
    const problems = fs.flatMap((p) => problemsIn(rel(p), readFileSync(p, 'utf8')))
    expect(problems).toEqual([])
  })
  it('every write exception names a file that exists AND a call in it that the exception actually exempts', () => {
    const fs = files().map(rel)
    for (const [f, list] of Object.entries(WRITE_EXCEPTIONS)) {
      expect(fs, f).toContain(f)
      const bare = problemsIn(f, readFileSync(join(REPO, f), 'utf8'), {})        // with NO exceptions
      for (const e of list) expect(bare.some((p) => p.startsWith(`WRITE ${f}: ${e.method} `)), `${f} ${e.method}`).toBe(true)
    }
  })
  it('CONTROL — each kind of write door, an offline import and a stray updateAttributes are each seen', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    expect(problemsIn(f, "fetch('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`WRITE ${f}: PUT /api/j2/notes/1`])
    expect(problemsIn(f, 'const opts = { method: "PUT" }; fetch(u, opts)')).toEqual([`WRITE ${f}: ? ?`])
    expect(problemsIn(f, "fetch('/x', { ...o })")).toEqual([`WRITE ${f}: ? /x`])
    expect(problemsIn(f, "fetch('/x', { method: m })")).toEqual([`WRITE ${f}: ? /x`])
    expect(problemsIn(f, "navigator.sendBeacon('/api/j2/notes/1', b)")).toEqual([`WRITE ${f}: POST /api/j2/notes/1`])
    expect(problemsIn(f, "jsonPut(`/api/j2/notes/${id}`, b)")).toEqual([`WRITE ${f}: PUT /api/j2/notes/{}`])
    expect(problemsIn(f, 'new XMLHttpRequest()')).toEqual([`XHR ${f}`])
    expect(problemsIn(f, "import { settleNoteWrite } from '../../../lib/offline/settleNoteWrite'")).toHaveLength(1)
    expect(problemsIn(f, 'updateAttributes({ params: {} })')).toEqual([`UPDATE ${f}`])
    expect(problemsIn(f, "fetch('/api/j2/regime')")).toEqual([])
    expect(problemsIn(f, "fetch('/api/j2/regime', { credentials: 'include' })")).toEqual([])
  })
  it('CONTROL — an exception is method+URL, never the whole file (IR-I b)', () => {
    const f = 'app/src/pages/journal-2-0/lib/blocks/Y.js'
    const ex = { [f]: [{ method: 'PUT', url: '/api/j2/trades/\\{\\}/adherence', why: 'test' }] }
    expect(problemsIn(f, "fetch(`/api/j2/trades/${id}/adherence`, { method: 'PUT' })", ex)).toEqual([])
    expect(problemsIn(f, "fetch(`/api/j2/notes/${id}`, { method: 'PUT' })", ex)).toEqual([`WRITE ${f}: PUT /api/j2/notes/{}`])
    expect(problemsIn(f, "fetch(`/api/j2/trades/${id}/adherence`, { method: 'DELETE' })", ex)).toHaveLength(1)
  })
})
```

In `registry.test.js`:

1. Replace `IDS`, `CAPTURE_ONLY` and `BOARD_IDS` (`:41-52`) with:

```js
const IDS = [
  'chart', 'watchlist', 'themes', 'scanner', 'fundamentals', 'breadth',
  'indexes', 'marketcontext',
  'aisearch', 'news', 'notebook', 'profile', 'alerts', 'calendar', 'optionsflow',
  'periodsort', 'nhnl', 'nhnlPulse', 'volumescan', 'scatter',
  // G-040 (wave 10, lane CX): the three CAPTURE-ONLY Notebook kinds. Registered so
  // a capture can store `widgetId` + `params`; bound by the journal host alone.
  'screener', 'cot', 'modelbook',
  // Notebook P2a: the trader blocks (capture-only AND `block: true`), bound in
  // blocks/BlockNodeView.jsx's BLOCK_COMPONENTS, never in EMBED_COMPONENTS.
  'preEntryChecklist', 'priceStamps', 'positionSizing',
]
const G040_KINDS = ['screener', 'cot', 'modelbook']
const BLOCK_IDS = ['preEntryChecklist', 'priceStamps', 'positionSizing']
// The ids a /charts board can hold — everything except the capture-only kinds.
const CAPTURE_ONLY = [...G040_KINDS, ...BLOCK_IDS]
const BOARD_IDS = IDS.filter(id => !CAPTURE_ONLY.includes(id))
```

and rename the first case to `'registers exactly the 20 workspace widget types, the G-040 capture-only kinds and the P2a blocks, in menu order'`.

2. Add to each of the three label maps (`labelMap('header')`, `labelMap('menu')`, `labelMap('tab')`) after `modelbook: …`:

```js
      preEntryChecklist: 'Pre-entry checklist', priceStamps: 'Price stamps', positionSizing: 'Position sizing',
```

3. Add to the defaults table after `modelbook`'s row (read the row's exact formatting first):

```js
      preEntryChecklist: { w: 6, h: 4, minW: 3, minH: 2 },
      priceStamps: { w: 6, h: 4, minW: 3, minH: 2 },
      positionSizing: { w: 6, h: 4, minW: 3, minH: 2 },
```

4. In 'reconstructable widgets and journal embed bindings cannot drift apart' (`:563`), give blocks an explicit branch, and point the capture-only loop at the G-040 kinds:

```js
  it('reconstructable widgets and journal embed bindings cannot drift apart', () => {
    const bound = new Set(journalEmbedIds())
    // ⛔ IR-B2, the explicit `block: true` branch: a block is rendered by BlockNodeView, so it is
    // NEVER an embed binding and never counted as a live re-render, whatever its manifest says.
    const blocks = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].block === true)
    for (const id of blocks) expect(bound.has(id), `${id} is a block and must not be bound in EMBED_COMPONENTS`).toBe(false)
    const renders = WIDGET_IDS.filter(
      id => WIDGET_REGISTRY[id].block !== true && isReconstructable(id, normalizeParams(id, RECONSTRUCTABLE_FIXTURES[id])),
    )
    expect([...bound].sort()).toEqual([...renders].sort())
    expect(bound.has('indexes')).toBe(true)
    expect(bound.has('marketcontext')).toBe(true)
    for (const id of G040_KINDS) expect(bound.has(id), `${id} has no journal renderer`).toBe(true)
  })
```

5. Add, in the same `describe` as that case:

```js
  /** BLOCK_COMPONENTS' keys, parsed out of BlockNodeView.jsx, IN ORDER and WITH duplicates. */
  function blockComponentKeys() {
    const file = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
      '../pages/journal-2-0/components/notebook/blocks/BlockNodeView.jsx')
    const src = readFileSync(file, 'utf8')
    const block = /export const BLOCK_COMPONENTS\s*=\s*\{([\s\S]*?)\n\}/.exec(src)
    expect(block, 'BLOCK_COMPONENTS not found in BlockNodeView.jsx').toBeTruthy()          // non-vacuity
    return [...block[1].matchAll(/^\s*([A-Za-z][\w]*)\s*:/gm)].map(m => m[1])
  }

  /** Every block id bound exactly once; nothing else bound. Returns the problems, for the control. */
  function blockBindingProblems(blockIds, keys) {
    const out = []
    for (const id of blockIds) {
      const n = keys.filter(k => k === id).length
      if (n !== 1) out.push(`${id} is bound ${n} times in BLOCK_COMPONENTS`)
    }
    for (const k of new Set(keys)) if (!blockIds.includes(k)) out.push(`${k} is not a block but is bound in BLOCK_COMPONENTS`)
    return out
  }

  it('⛔ IR-B2: every block id has exactly ONE BLOCK_COMPONENTS entry, and no non-block id has one', () => {
    const blocks = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].block === true)
    expect(blocks).toEqual(BLOCK_IDS)
    expect(blockBindingProblems(blocks, blockComponentKeys())).toEqual([])
  })

  it('CONTROL: the binding check sees a missing, a doubled and a stray entry', () => {
    expect(blockBindingProblems(['a', 'b'], ['a'])).toEqual(['b is bound 0 times in BLOCK_COMPONENTS'])
    expect(blockBindingProblems(['a'], ['a', 'a'])).toEqual(['a is bound 2 times in BLOCK_COMPONENTS'])
    expect(blockBindingProblems(['a'], ['a', 'chart'])).toEqual(['chart is not a block but is bound in BLOCK_COMPONENTS'])
  })

  it('⛔ P2a: a block is capture-only, offered by no menu, and its manifest is refused without captureOnly', () => {
    for (const id of BLOCK_IDS) {
      expect(WIDGET_REGISTRY[id].captureOnly).toBe(true)
      expect(isTraderBlock(id)).toBe(true)
    }
    expect(isTraderBlock('chart')).toBe(false)
    expect(isTraderBlock('marketcontext')).toBe(false)
    expect(() => registerPanel('x', { ...WIDGET_REGISTRY.priceStamps, captureOnly: false })).toThrow(/block entry must be captureOnly/)
  })

  it('S20: a block\'s plain text IS its catalog search line', () => {
    for (const id of BLOCK_IDS) expect(paramsPlainText(id, {}), id).toBe(blockSearch(id))
  })

  it('S20: the registry\'s enum options and defaults ARE the catalog\'s, for every catalog setting of a block', () => {
    for (const id of BLOCK_IDS) {
      const kind = BLOCK_KINDS.find(k => k.id === id)
      expect(kind, id).toBeTruthy()
      for (const s of kind.settings) {
        const f = WIDGET_REGISTRY[id].paramsSchema.find(x => x.key === s.key)
        expect(f, `${id}.${s.key}`).toBeTruthy()
        expect(f.type).toBe('enum')
        expect(f.options, `${id}.${s.key}`).toEqual([...s.options])
        expect(f.default, `${id}.${s.key}`).toBe(s.default)
      }
    }
  })
```

and import `isTraderBlock`, `registerPanel` (if not already), and from `'../pages/journal-2-0/lib/journalBlocks'` `BLOCK_KINDS` and `blockSearch`. (If the file's existing `journalEmbedIds` builds its path differently, build `blockComponentKeys`' path the same way it does; read it at `:535`.)

In `tests/test_public_note_payload.py`, nothing changes: `test_every_registered_widget_has_a_vendor_row` reads the registry and is red until Step 3b.

In `WidgetEmbedView.unknownKind.test.jsx`, add (read the file's own render helper first and use it; the case below names what it renders and asserts):

```jsx
it('P2a: a trader block goes to BlockNodeView, never the embed chrome', async () => {
  // Render WidgetEmbedView the way this file renders every embed, with
  //   node.attrs = { v: 1, widgetId: 'priceStamps', embedId: 'b1', mode: 'snapshot', params: { on: 'no' }, searchText: '[price stamps]' }
  // and an editable editor whose storage.uctJournalWidgets = { noteId: 'n1' }.
  // Then:
  expect(await screen.findByRole('group', { name: 'Price stamps' })).toBeTruthy()
  expect(screen.queryByRole('toolbar')).toBeNull()               // no embed toolbar of any name
  expect(screen.queryByText(UNKNOWN_BLOCK_SENTENCE)).toBeNull()  // and not the newer-version card
})

it('P2a: a block whose chunk fails to load shows its own line, never a crashed note (S15)', async () => {
  // Same render, with vi.doMock('./blocks/BlockNodeView', () => { throw new Error('chunk') }) set up
  // before WidgetEmbedView is imported (vi.resetModules() then a dynamic import of WidgetEmbedView).
  expect(await screen.findByText('[price stamps]')).toBeTruthy()
})
```

Write both in full with the file's helper; the comments say exactly what each renders and asserts. Each must FAIL before Step 4 and PASS after.

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-c
cd "$WT/app"
npx vitest run src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks src/widgets/registry.test.js src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx > "$TEMP/p2a-t6.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (modules missing; the registry pins red).

- [ ] **Step 3: Registry manifests**

In `registry.js`, add to `validatePanelManifest` (after the `captureOnly` boolean check, before `return problems`):

```js
  if (manifest.block !== undefined && manifest.block !== true) problems.push('block must be true when present')
  if (manifest.block === true && manifest.captureOnly !== true) problems.push('a block entry must be captureOnly')
```

Above `PANEL_MANIFESTS`:

```js
/** A trader block's manifest (Notebook P2): one shape, so each entry costs its params and words only.
 *  ⛔ Rendered by blocks/BlockNodeView.jsx (BLOCK_COMPONENTS), never the embed host: not reconstructable,
 *  never live, so resolveEmbedRender's archive and live paths can never pick a block up. */
function blockManifest(label, paramsSchema, line) {
  return {
    labels: { header: label, menu: label, tab: label },
    defaults: { w: 6, h: 4, minW: 3, minH: 2 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: false, tab: false, mobile: false, journal: false },
    captureOnly: true,
    block: true,
    themeFollow: true,
    paramsSchema,
    plainText: () => line,
    reconstructable: false,
    liveCapable: false,
  }
}
```

In `PANEL_MANIFESTS` after `modelbook` (the enum options and defaults mirror `journalBlocks.js`; the S20 case above pins them):

```js
  // ── Notebook P2 (Tier 1, part a): trader blocks. ⛔ A block is a capture-only kind bound by the
  // Notebook alone (blocks/BlockNodeView.jsx). Its member state is `params`, written only by
  // blocks/useBlockParams.js (spec §P2 integrity rule; lib/blocks/blockDoors.test.js).
  preEntryChecklist: blockManifest('Pre-entry checklist', [
    { key: 'setup', type: 'string' },
    { key: 'includeRules', type: 'enum', options: ['yes', 'no'], default: 'yes' },
    { key: 'requireAll', type: 'enum', options: ['no', 'yes'], default: 'no' },
    { key: 'checked', type: 'json', default: [] },
  ], '[pre-entry checklist]'),
  priceStamps: blockManifest('Price stamps', [
    { key: 'on', type: 'enum', options: ['no', 'yes'], default: 'no' },
  ], '[price stamps]'),
  positionSizing: blockManifest('Position sizing', [
    { key: 'entry', type: 'number' },
    { key: 'stop', type: 'number' },
    { key: 'grade', type: 'enum', options: ['A', 'A+', 'B'], default: 'A' },
    { key: 'accountSize', type: 'number' },
    { key: 'regimeId', type: 'enum', options: ['green', 'amber', 'orange', 'red'] },
    { key: 'regimeAsOf', type: 'string' },
  ], '[position sizing]'),
```

and below `widgetMeta`:

```js
/** Is this widget id a Notebook trader block (rendered by blocks/BlockNodeView, not the embed chrome)? */
export function isTraderBlock(id) {
  return WIDGET_REGISTRY[id]?.block === true
}
```

- [ ] **Step 3b: The vendor rows (IR-B3)**

In `api/services/journal_two/public_note_payload.py` `MARKET_DATA_VENDORS`, after `("widgetEmbed", "modelbook"): "mixed",`:

```python
    # Notebook P2a trader blocks (IR-B3). The checklist and the sizer hold the member's own setups,
    # rules, prices and account; a price-stamps block is a switch over Massive price facts, so it
    # follows ("financialFact", "massive") below. The market context stamp is "marketcontext" above.
    ("widgetEmbed", "preEntryChecklist"): "private",
    ("widgetEmbed", "priceStamps"): "massive",
    ("widgetEmbed", "positionSizing"): "private",
```

- [ ] **Step 4: The dispatcher in `WidgetEmbedView.jsx`**

Rename the current `export default function WidgetEmbedView(...)` to `function EmbedNodeView(...)` (body unchanged). Add, below `EMBED_COMPONENTS`:

```jsx
// Notebook P2: a trader block is NOT an embed. It has no toolbar, no archive and no resize; its state
// is its params, changed only through blocks/useBlockParams.js. Lazy, so a note with no block loads none
// of it. ⛔ EmbedErrorBoundary (S15): a stale BlockNodeView chunk after a deploy shows the block's own
// line, never a crashed note. An older bundle never reaches here: it has no registry row, so the block
// keeps the "needs a newer version" card (docs/notebook/p1-verify-before-building.md §b).
const BlockNodeView = lazyLeaf(() => import('./blocks/BlockNodeView'))

export default function WidgetEmbedView(props) {
  if (isTraderBlock(props.node?.attrs?.widgetId)) {
    const line = props.node.attrs.searchText || ''
    return (
      <EmbedErrorBoundary fallback={<NodeViewWrapper className={styles.frame} data-widget-embed-view="block-failed"><p>{line}</p></NodeViewWrapper>}>
        <Suspense fallback={<NodeViewWrapper className={styles.frame} data-widget-embed-view="block-loading" />}>
          <BlockNodeView {...props} />
        </Suspense>
      </EmbedErrorBoundary>
    )
  }
  return <EmbedNodeView {...props} />
}
```

and add `isTraderBlock` to the `widgetMeta` import from `'../../../../widgets/registry'` (`:8`). Two component TYPES (not a branch inside one) keep every hook of `EmbedNodeView` in a stable order.

- [ ] **Step 5: The block files**

`blocks/useBlockParams.js`:

```js
// ⛔⛔ THE ONE WAY A BLOCK CHANGES ITS STATE (spec §P2 integrity rule). One TipTap updateAttributes
// call = one editor transaction, so the change rides the note's existing save path (autosave -> outbox
// -> compare-and-set) and nothing else. lib/blocks/blockDoors.test.js fails on any other
// updateAttributes call in a block file.
import { useCallback, useRef } from 'react'
import { paramsPlainText } from '../../../../../widgets/registry'

export function useBlockParams({ attrs, updateAttributes, editable }) {
  // `latest` holds the params the NEXT write merges into: the node's own params, or the value this
  // hook just wrote if the node has not re-rendered with it yet (two ticks inside one event).
  // When the node's params object changes (our write landed, or a rebase from another tab), the
  // node's value wins again.
  const latest = useRef(attrs?.params || {})
  const seen = useRef(attrs?.params)
  if (attrs?.params !== seen.current) {
    seen.current = attrs?.params
    latest.current = attrs?.params || {}
  }
  return useCallback((patch) => {
    if (!editable || typeof updateAttributes !== 'function') return false
    const params = { ...latest.current, ...patch }
    latest.current = params
    updateAttributes({ params, searchText: paramsPlainText(attrs.widgetId, params) })
    return true
  }, [editable, updateAttributes, attrs?.widgetId])
}
```

`blocks/blockStates.jsx`:

```jsx
import styles from './Blocks.module.css'

export const BLOCK_ERROR_SENTENCE = "This block couldn't load. Your note is safe."

export function BlockLoading() {
  return <p className={styles.muted} aria-live="polite">Loading…</p>
}
export function BlockEmpty({ title, children }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children}
    </div>
  )
}
export function BlockError({ onRetry }) {
  return (
    <div className={styles.error} role="status">
      <p>{BLOCK_ERROR_SENTENCE}</p>
      {onRetry && <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={onRetry}>Try again</button>}
    </div>
  )
}
export function BlockNeedsSwitch({ what }) {
  return <p className={styles.muted} role="status">{`This block needs ${what}, which is not on for you.`}</p>
}
```

`blocks/BlockNodeView.jsx`:

```jsx
import { Component, Suspense } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { lazyLeaf } from '../../../lib/lazyChunk'
import { blockLabel } from '../../../lib/journalBlocks'
import { useBlockParams } from './useBlockParams'
import { BlockError, BlockLoading } from './blockStates'
import styles from './Blocks.module.css'

/** ⛔ IR-B2: the ONLY binding of a block id (registry.test.js parses these keys). Each body is its own
 *  lazy chunk; Tasks 7, 10 and 11 replace the stub files, never this map. */
export const BLOCK_COMPONENTS = {
  preEntryChecklist: lazyLeaf(() => import('./PreEntryChecklistBlock')),
  priceStamps: lazyLeaf(() => import('./PriceStampsBlock')),
  positionSizing: lazyLeaf(() => import('./PositionSizingBlock')),
}

class BlockBoundary extends Component {
  constructor(p) { super(p); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <BlockError onRetry={() => this.setState({ failed: false })} />
      : this.props.children
  }
}

export default function BlockNodeView({ node, editor, updateAttributes, deleteNode, selected }) {
  const attrs = node?.attrs || {}
  const shareView = !!editor?.storage?.uctJournalWidgets?.shareView
  const editable = editor?.isEditable !== false && !shareView
  const setParams = useBlockParams({ attrs, updateAttributes, editable })
  const label = blockLabel(attrs.widgetId)
  const Body = BLOCK_COMPONENTS[attrs.widgetId]
  return (
    <NodeViewWrapper className={`${styles.block} ${selected ? styles.selected : ''}`}
      data-widget-embed-view={attrs.widgetId} contentEditable={false}>
      <div role="group" aria-label={label} className={styles.inner}>
        <div className={styles.head}>
          <span className={styles.title}>{label}</span>
          {editable && deleteNode && (
            <button type="button" className={`btn btn-ghost ${styles.tap}`} aria-label={`Remove ${label}`} onClick={() => deleteNode()}>
              Remove
            </button>
          )}
        </div>
        {shareView || !Body ? <p className={styles.muted}>{attrs.searchText || label}</p> : (
          <BlockBoundary>
            <Suspense fallback={<BlockLoading />}>
              <Body params={attrs.params || {}} setParams={setParams} editable={editable} editor={editor} attrs={attrs} />
            </Suspense>
          </BlockBoundary>
        )}
      </div>
    </NodeViewWrapper>
  )
}
```

`blocks/Blocks.module.css`:

```css
.block { margin: 12px 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev, var(--bg)); }
.selected { outline: 2px solid var(--accent); }
.inner { padding: 10px 12px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.title { font-weight: 600; font-size: 13px; letter-spacing: .02em; }
.muted { color: var(--text-muted); font-size: 13px; margin: 4px 0; }
.empty { display: grid; gap: 6px; }
.emptyTitle { margin: 0; font-size: 13px; }
.error { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 13px; }
.row { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.tap { min-height: 32px; }
@media (max-width: 1024px) {
  .row, .tap { min-height: var(--tap-min); }
}
@media (max-width: 640px) {
  .inner { padding: 8px; }
  .head { flex-wrap: wrap; }
}
```

(The tokens `--border`, `--text-muted`, `--accent` and `--tap-min` are the ones P1's styles surfaces use; `styles/tokens.reachable.test.js` fails on a token that does not exist, so it is in Step 7's run list.)

Each stub body (`PreEntryChecklistBlock.jsx`, `PriceStampsBlock.jsx`, `PositionSizingBlock.jsx`), replaced by its own task:

```jsx
import { BlockEmpty } from './blockStates'

export default function PriceStampsBlock() {
  return <BlockEmpty title="This block is being built." />
}
```

(with the file's own component name).

- [ ] **Step 6: The blocks in the a11y population (S23)**

In `a11y/population.js` `derivePopulation()`, add `...jsxIn('components/notebook/blocks'),` after the `import` line, and to the doc comment "and components/notebook/blocks/ (Notebook P2 trader blocks)". In `a11y/notebookSurfaces.js` `SURFACES`, add:

```js
  // ── Notebook P2a trader blocks (blocks/; rail a11y/traderBlocks.a11y.test.jsx). Each body task
  // swaps its own line for its own recipe when it replaces the stub.
  'components/notebook/blocks/BlockNodeView.jsx': { recipe: 'trader-block-platform' },
  'components/notebook/blocks/blockStates.jsx': { coveredBy: 'trader-block-platform' },
  'components/notebook/blocks/PreEntryChecklistBlock.jsx': { coveredBy: 'trader-block-platform' },
  'components/notebook/blocks/PriceStampsBlock.jsx': { coveredBy: 'trader-block-platform' },
  'components/notebook/blocks/PositionSizingBlock.jsx': { coveredBy: 'trader-block-platform' },
```

Create `a11y/traderBlocks.a11y.test.jsx`:

```jsx
// app/src/pages/journal-2-0/a11y/traderBlocks.a11y.test.jsx
//
// Notebook P2a: the trader block platform through 8A's axe harness. One recipe renders BlockNodeView
// with each of the three block ids (the stub bodies until Tasks 7, 10 and 11 replace them, each with its
// own recipe in this file's siblings), plus the error state, so an empty screen cannot pass as a clean one.
import { render, screen } from '@testing-library/react'
import { vi, expect } from 'vitest'
import { axeSurface } from './surface'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
import BlockNodeView from '../components/notebook/blocks/BlockNodeView'

const editor = { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1' } } }
const node = (widgetId, params = {}) => ({ attrs: { widgetId, params, searchText: `[${widgetId}]` } })

axeSurface('trader-block-platform', async () => {
  render(<div>
    {['preEntryChecklist', 'priceStamps', 'positionSizing'].map((id) => (
      <BlockNodeView key={id} node={node(id)} editor={editor} updateAttributes={() => {}} deleteNode={() => {}} />
    ))}
  </div>)
  for (const name of ['Pre-entry checklist', 'Price stamps', 'Position sizing']) {
    expect(await screen.findByRole('group', { name })).toBeTruthy()
  }
})
```

(Read `a11y/surface.js`'s `axeSurface(id, recipe)` and one existing rail, e.g. `entryContext.a11y.test.jsx`, first; wrap in `Providers` from `./fixtures` if a body needs SWR. A body that reads hooks gets its data from its own recipe in its own task.)

- [ ] **Step 7: Run, the door census included (IR-I c)**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-c
cd "$WT/app"
npx vitest run src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks src/widgets/registry.test.js src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx src/pages/journal-2-0/components/notebook/WidgetEmbedView.toolbarMore.test.jsx src/components/screener/reachable.test.js src/styles/tokens.reachable.test.js src/styles/tapFloor.test.js src/surfaces/panelSet.test.js src/pages/journal-2-0/a11y/surfaceCoverage.test.js src/pages/journal-2-0/a11y/ariaCoverage.test.js src/pages/journal-2-0/a11y/traderBlocks.a11y.test.jsx src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/pages/journal-2-0/tabs/NotebookTab.lazyViews.test.js > "$TEMP/p2a-t6.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-c
cd "$WT"
python -m pytest tests/test_public_note_payload.py tests/test_trader_blocks.py -q > "$TEMP/p2a-t6-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

(`NotebookTab.lazyViews.test.js`: confirm its path with `git ls-files app/src | grep lazyViews`.) Expected: all pass. `tokens.reachable.test.js` fails on a CSS token that does not exist: use `--bg` alone if `--bg-elev` is not a token. Any other registry pin that enumerates every widget id and reds is a pin this task updates (name it in the commit message); never a test deleted.

- [ ] **Step 8: Mutation-prove the platform and the rails**

Each by captured bytes, restored and sha-checked:
1. `useBlockParams.js`: replace the `updateAttributes(...)` call with `fetch('/api/j2/notes/x', { method: 'PUT' })`. `blockParams.test.jsx` "ONE transaction ... no fetch" and `blockDoors.test.js` "the real block files" must FAIL.
2. `WidgetEmbedView.jsx`: make the dispatcher always return `<EmbedNodeView {...props} />`. The new `unknownKind` case "goes to BlockNodeView" must FAIL.
3. `WidgetEmbedView.jsx`: remove the `EmbedErrorBoundary` wrapper (keep the `Suspense`). The "chunk fails to load" case must FAIL.
4. `BlockNodeView.jsx`: add a second `priceStamps:` line to `BLOCK_COMPONENTS`. The IR-B2 binding rail must FAIL naming `priceStamps is bound 2 times`.
5. `public_note_payload.py`: delete the `priceStamps` row. `test_every_registered_widget_has_a_vendor_row[priceStamps]` must FAIL.

- [ ] **Step 9: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-c
cd "$WT"
python tools/check_repo_hygiene.py
git add app/src/widgets/registry.js app/src/widgets/registry.test.js api/services/journal_two/public_note_payload.py app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx app/src/pages/journal-2-0/components/notebook/blocks app/src/pages/journal-2-0/lib/blocks app/src/pages/journal-2-0/a11y/population.js app/src/pages/journal-2-0/a11y/notebookSurfaces.js app/src/pages/journal-2-0/a11y/traderBlocks.a11y.test.jsx
git commit -F - -- app/src/widgets/registry.js app/src/widgets/registry.test.js api/services/journal_two/public_note_payload.py app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx app/src/pages/journal-2-0/components/notebook/blocks app/src/pages/journal-2-0/lib/blocks app/src/pages/journal-2-0/a11y/population.js app/src/pages/journal-2-0/a11y/notebookSurfaces.js app/src/pages/journal-2-0/a11y/traderBlocks.a11y.test.jsx <<'MSG'
feat(notebook): trader block platform -- block kinds bound in BLOCK_COMPONENTS only, one write path, method+URL door rail, vendor rows, a11y recipe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 7: Pre-entry checklist block

Spec §P2 item 1. Settings (R-P2-4): `includeRules`, `requireAll` (IR-S8: in a note, the block's own "n not ticked" line); the setup is chosen in the note.

**Lane:** A, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2-a`.

**Files:**
- Create: `app/src/pages/journal-2-0/lib/blocks/checklistItems.js`, `checklistItems.test.js`
- Replace: `app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.jsx`
- Test: `app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.test.jsx`
- Create: `app/src/pages/journal-2-0/a11y/traderBlockChecklist.a11y.test.jsx`; modify `a11y/notebookSurfaces.js` (this block's line only)

**Interfaces:**
- Consumes: `useJ2Settings()` → `{ settings }` (`LogTradeButton.jsx`, `const { settings } = useJ2Settings()`); `settings.setupRules` is `{setupName: [{id, label}]}` (`accounts.py`, the settings defaults); `settings.setups`; `useJ2SelectedAccount()` → `{ accountId }`; `useJournalRules(accountId)` → `{ rules }`.
- Produces (`checklistItems.js`), the ONE copy each (pre-flight S18):
  - `checklistItems({ settings, rules, setup, includeRules }) -> [{ id, label, source: 'setup'|'rule' }]` — the setup's rules, then the account's active rules whose `beforeEntry === true` (ids prefixed `rule:`), each id once.
  - `toggleChecked(items, checked, id) -> string[]` — the checked ids after toggling `id`, in item order, stale ids dropped.
  - `uncheckedItems(items, checked)`, `checklistSummary(items, checked) -> { done, total }`. Only CURRENT item ids count.
  - `untickedLine(n) -> string | null` — `"2 checklist items not ticked."` / `"1 checklist item not ticked."`, `null` at 0.
- Part b sets `beforeEntry` on rules (part b Task 3). Until then `includeRules` includes no rule, and the block says so.

- [ ] **Step 1: Write the failing tests**

`checklistItems.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { checklistItems, uncheckedItems, checklistSummary, toggleChecked, untickedLine } from './checklistItems'

const settings = { setups: ['VCP', 'Flag'], setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] } }
const rules = [{ id: 'r1', label: 'No trades in the first 5 minutes', beforeEntry: true },
  { id: 'r2', label: 'Journal every loss', beforeEntry: false }, { id: 'r3', label: 'Old rule' }]

describe('checklistItems', () => {
  it('the setup rules, then before-entry rules only', () => {
    expect(checklistItems({ settings, rules, setup: 'VCP', includeRules: 'yes' }).map((i) => i.id))
      .toEqual(['s1', 's2', 'rule:r1'])
  })
  it('includeRules no leaves the rules out; an unknown setup has no setup items', () => {
    expect(checklistItems({ settings, rules, setup: 'VCP', includeRules: 'no' }).map((i) => i.id)).toEqual(['s1', 's2'])
    expect(checklistItems({ settings, rules, setup: 'Gone', includeRules: 'yes' }).map((i) => i.id)).toEqual(['rule:r1'])
  })
  it('a stale checked id never counts', () => {
    const items = checklistItems({ settings, rules, setup: 'VCP', includeRules: 'no' })
    expect(checklistSummary(items, ['s1', 'deleted'])).toEqual({ done: 1, total: 2 })
    expect(uncheckedItems(items, ['s1']).map((i) => i.id)).toEqual(['s2'])
  })
  it('toggleChecked: on, off, item order, stale ids dropped', () => {
    const items = checklistItems({ settings, rules, setup: 'VCP', includeRules: 'no' })
    expect(toggleChecked(items, [], 's2')).toEqual(['s2'])
    expect(toggleChecked(items, ['s2'], 's1')).toEqual(['s1', 's2'])
    expect(toggleChecked(items, ['s1', 's2'], 's1')).toEqual(['s2'])
    expect(toggleChecked(items, ['gone', 's1'], 's2')).toEqual(['s1', 's2'])
  })
  it('untickedLine counts, and says nothing at zero', () => {
    expect(untickedLine(2)).toBe('2 checklist items not ticked.')
    expect(untickedLine(1)).toBe('1 checklist item not ticked.')
    expect(untickedLine(0)).toBeNull()
  })
  it('missing settings or rules are empty, never a throw', () => {
    expect(checklistItems({ settings: null, rules: null, setup: '', includeRules: 'yes' })).toEqual([])
  })
})
```

`PreEntryChecklistBlock.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let SETTINGS = { setups: ['VCP'], setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] } }
let RULES = []
vi.mock('../../../hooks/useJ2Settings', () => ({ default: () => ({ settings: SETTINGS }) }))
vi.mock('../../../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1' }) }))
vi.mock('../../../hooks/useJournalRules', () => ({ default: () => ({ rules: RULES }) }))

import PreEntryChecklistBlock from './PreEntryChecklistBlock'

const base = { setup: 'VCP', includeRules: 'yes', requireAll: 'no', checked: [] }

describe('PreEntryChecklistBlock', () => {
  it('lists the setup checklist as named checkboxes and ticks through setParams only', () => {
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={base} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Volume dry-up' }))
    expect(setParams).toHaveBeenCalledWith({ checked: ['s1'] })
    expect(screen.getByText('0 of 2 ticked')).toBeTruthy()
  })
  it('requireAll no: no "not ticked" line (IR-S8)', () => {
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.queryByText(/not ticked/)).toBeNull()
  })
  it('requireAll yes: the "not ticked" line, counted (IR-S8)', () => {
    render(<PreEntryChecklistBlock params={{ ...base, requireAll: 'yes', checked: ['s1'] }} setParams={vi.fn()} editable />)
    expect(screen.getByRole('status').textContent).toBe('1 checklist item not ticked.')
  })
  it('no setup picked: a named select of the member setups', () => {
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={setParams} editable />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Setup for this trade' }), { target: { value: 'VCP' } })
    expect(setParams).toHaveBeenCalledWith({ setup: 'VCP', checked: [] })
  })
  it('no setups yet: says what to do, never an empty box', () => {
    SETTINGS = { setups: [], setupRules: {} }
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={vi.fn()} editable />)
    expect(screen.getByText(/You have no setups yet/)).toBeTruthy()
    SETTINGS = { setups: ['VCP'], setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] } }
  })
  it('a reader sees the ticks, disabled', () => {
    render(<PreEntryChecklistBlock params={{ ...base, checked: ['s1'] }} setParams={vi.fn()} editable={false} />)
    const box = screen.getByRole('checkbox', { name: 'Volume dry-up' })
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
  })
  it('includeRules yes with no before-entry rules says how to mark one', () => {
    RULES = [{ id: 'r1', label: 'x', beforeEntry: false }]
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.getByText(/No rules are marked "before entry" yet/)).toBeTruthy()
    RULES = []
  })
  it('keyboard: Space on a focused checkbox ticks it through setParams', () => {
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={base} setParams={setParams} editable />)
    const box = screen.getByRole('checkbox', { name: 'Tight closes' })
    box.focus()
    expect(document.activeElement).toBe(box)
    fireEvent.click(box)                               // jsdom's Space on a checkbox is a click
    expect(setParams).toHaveBeenCalledWith({ checked: ['s2'] })
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-a
cd "$WT/app"
npx vitest run src/pages/journal-2-0/lib/blocks/checklistItems.test.js src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.test.jsx > "$TEMP/p2a-t7.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: `checklistItems.js`**

```js
// The pre-entry checklist's items (spec §P2 item 1): the setup's checklist (settings.setupRules,
// "{setupName: [{id, label}]}") plus the account's ACTIVE rules marked "before entry" (part b sets
// `beforeEntry`). Read-only over server data; the block and Log Trade store only ticked ids.
// ⛔ The ONE copy of toggle and of the "not ticked" sentence: the block (Task 7) and Log Trade (Task 8)
// both import them (pre-flight S18).
export function checklistItems({ settings, rules, setup, includeRules }) {
  const out = []
  const seen = new Set()
  const push = (id, label, source) => { if (id && !seen.has(id)) { seen.add(id); out.push({ id, label, source }) } }
  const setupRules = settings?.setupRules?.[setup]
  if (Array.isArray(setupRules)) for (const r of setupRules) push(String(r.id), String(r.label || ''), 'setup')
  if (includeRules === 'yes' && Array.isArray(rules)) {
    for (const r of rules) if (r?.beforeEntry === true) push(`rule:${r.id}`, String(r.label || ''), 'rule')
  }
  return out
}

export function toggleChecked(items, checked, id) {
  const on = new Set(Array.isArray(checked) ? checked : [])
  if (on.has(id)) on.delete(id)
  else on.add(id)
  return items.map((i) => i.id).filter((x) => on.has(x))
}

export function uncheckedItems(items, checked) {
  const on = new Set(Array.isArray(checked) ? checked : [])
  return items.filter((i) => !on.has(i.id))
}

export function checklistSummary(items, checked) {
  const on = new Set(Array.isArray(checked) ? checked : [])
  return { done: items.filter((i) => on.has(i.id)).length, total: items.length }
}

export function untickedLine(n) {
  if (!n) return null
  return `${n} checklist ${n === 1 ? 'item' : 'items'} not ticked.`
}
```

- [ ] **Step 4: `PreEntryChecklistBlock.jsx`**

```jsx
import useJ2Settings from '../../../hooks/useJ2Settings'
import useJ2SelectedAccount from '../../../hooks/useJ2SelectedAccount'
import useJournalRules from '../../../hooks/useJournalRules'
import { checklistItems, checklistSummary, toggleChecked, untickedLine } from '../../../lib/blocks/checklistItems'
import { BlockEmpty } from './blockStates'
import styles from './Blocks.module.css'

export default function PreEntryChecklistBlock({ params, setParams, editable }) {
  const { settings } = useJ2Settings()
  const { accountId } = useJ2SelectedAccount()
  const { rules } = useJournalRules(params.includeRules === 'yes' ? accountId : null)
  const setups = Array.isArray(settings?.setups) ? settings.setups : []
  const setup = params.setup || ''

  if (!setup) {
    if (!setups.length) {
      return (
        <BlockEmpty title="You have no setups yet. Add your setups and their checklists in Journal settings, then pick one here." />
      )
    }
    return (
      <label className={styles.row}>
        <span>Setup for this trade</span>
        <select aria-label="Setup for this trade" disabled={!editable} value=""
          onChange={(e) => setParams({ setup: e.target.value, checked: [] })}>
          <option value="" disabled>Pick a setup</option>
          {setups.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    )
  }

  const items = checklistItems({ settings, rules, setup, includeRules: params.includeRules })
  const checked = Array.isArray(params.checked) ? params.checked : []
  const { done, total } = checklistSummary(items, checked)
  const noRuleItems = params.includeRules === 'yes' && !items.some((i) => i.source === 'rule')
  const warn = params.requireAll === 'yes' ? untickedLine(total - done) : null

  return (
    <fieldset className={styles.empty}>
      <legend className={styles.muted}>{`Pre-entry checklist for ${setup}`}</legend>
      {!items.length && <p className={styles.muted}>{`No checklist for ${setup} yet. Add its rules in Journal settings, under Setups.`}</p>}
      {items.map((i) => (
        <label key={i.id} className={styles.row}>
          <input type="checkbox" checked={checked.includes(i.id)} disabled={!editable}
            onChange={() => setParams({ checked: toggleChecked(items, checked, i.id) })} />
          <span>{i.label}</span>
        </label>
      ))}
      {noRuleItems && <p className={styles.muted}>No rules are marked "before entry" yet. Mark one in My rules to add it here.</p>}
      {total > 0 && <p className={styles.muted} aria-live="polite">{`${done} of ${total} ticked`}</p>}
      {warn && <p className={styles.muted} role="status">{warn}</p>}
      {editable && (
        <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => setParams({ setup: '', checked: [] })}>
          Change setup
        </button>
      )}
    </fieldset>
  )
}
```

(Hook paths: `blocks/` is `J/components/notebook/blocks`, so `../../../hooks/...` is `J/hooks/...` (all three exist on master: `useJ2Settings.js`, `useJ2SelectedAccount.js`, `useJournalRules.js`).)

- [ ] **Step 5: This block's a11y recipe**

In `a11y/notebookSurfaces.js`, change ONLY `PreEntryChecklistBlock.jsx`'s line to `{ recipe: 'trader-block-checklist' }`. Create `a11y/traderBlockChecklist.a11y.test.jsx`, modelled on `traderBlocks.a11y.test.jsx`, mocking the three hooks as the block test does, rendering `PreEntryChecklistBlock` twice (a setup with two items, one ticked, `requireAll: 'yes'`; and no setup with two setups to pick), inside `axeSurface('trader-block-checklist', …)`, and asserting the two checkboxes, the status line and the combobox are on screen before axe runs.

- [ ] **Step 6: Run**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-a
cd "$WT/app"
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/a11y/traderBlockChecklist.a11y.test.jsx src/pages/journal-2-0/a11y/surfaceCoverage.test.js src/styles/tapFloor.test.js > "$TEMP/p2a-t7.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass (the door rail included: this block sends nothing).

- [ ] **Step 7: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-a
cd "$WT"
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/blocks/checklistItems.js app/src/pages/journal-2-0/lib/blocks/checklistItems.test.js app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.test.jsx app/src/pages/journal-2-0/a11y/notebookSurfaces.js app/src/pages/journal-2-0/a11y/traderBlockChecklist.a11y.test.jsx
git commit -F - -- app/src/pages/journal-2-0/lib/blocks/checklistItems.js app/src/pages/journal-2-0/lib/blocks/checklistItems.test.js app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PreEntryChecklistBlock.test.jsx app/src/pages/journal-2-0/a11y/notebookSurfaces.js app/src/pages/journal-2-0/a11y/traderBlockChecklist.a11y.test.jsx <<'MSG'
feat(notebook): pre-entry checklist block (setup checklist + before-entry rules, ticks in params, requireAll line)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 8: The checklist in Log Trade (soft warning, opt-in per member)

Spec §P2 item 1 and §7.5 (soft warning only). R-P2-7, IR-S7, IR-S8, IR-B5, pre-flight S15.

**Lane:** A, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2-a`.

**Files:**
- Create: `app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.js`, `logTradeChecklist.test.js`
- Create: `app/src/pages/journal-2-0/components/LogTradeChecklist.jsx` (lazy body), `LogTradeChecklistSlot.jsx` (eager: the lazy import, a boundary that renders nothing, the `Suspense`), `LogTradeChecklist.test.jsx`
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx`, `AddTradeModal.jsx` (+ their tests)
- Modify: `app/src/pages/journal-2-0/LogTradeButton.jsx`, `JournalLogFab.jsx` (`handleCreateTrade` returns its row; both pass `preEntryChecklist`)
- Create: `app/src/pages/journal-2-0/LogTradeButton.checklist.test.jsx`, `JournalLogFab.checklist.test.jsx`
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx` (+ `PortfolioSettingsModal.test.jsx`, created if absent)
- Modify: `api/routers/auth.py` (`_PREFERENCE_KEYS`), `app/src/hooks/usePreferences.additionsOnly.test.js` (`BASELINE_KEYS`)
- Modify: `app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js` (this file's own `WRITE_EXCEPTIONS` entry, IR-B5)
- Modify: `app/src/pages/journal-2-0/a11y/notebookSurfaces.js` (`OUTSIDE_POPULATION_SURFACES`); create `a11y/logTradeChecklist.a11y.test.jsx`

**Interfaces:**
- Consumes: Task 5's route; Task 7's `checklistItems`, `uncheckedItems`, `toggleChecked`, `untickedLine`.
- Produces:
  - preference key `notebook_log_trade_checklist` (literal), value `'off'` (default) | `'on'` | `'on-warn'` (IR-S8: `on-warn` is `requireAll` in Log Trade).
  - `logTradeChecklist.saveTicks({ kind: 'position'|'trade', id, setup, checked, total }) -> Promise<boolean>`; never throws; a failure returns `false` and the trade stays logged. Each branch is a `fetch` with a literal URL template and an inline `{ method: 'PUT', … }`, so the door rail can match it.
  - `softWarning({ requireAll, unticked }) -> string | null` = `untickedLine(unticked) + " You can still log this trade."` when `requireAll === 'yes'`.
  - `checklistMode(prefs) -> { show: boolean, requireAll: 'yes'|'no' }`.
  - `<LogTradeChecklist setup settings accountId requireAll checked onChange />`; `<LogTradeChecklistSlot …same props />`.
  - Both dialogs take `preEntryChecklist` (boolean). The checklist mounts only when `preEntryChecklist && journalStylesEnabled() && checklistMode(prefs).show`. Only `LogTradeButton` and `JournalLogFab` pass it (IR-S7), and both `handleCreatePosition` and `handleCreateTrade` there resolve the created row.

- [ ] **Step 1: Write the failing tests**

`logTradeChecklist.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveTicks, softWarning, checklistMode } from './logTradeChecklist'

describe('saveTicks', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) })
  it('an open position writes the pre-entry route', async () => {
    expect(await saveTicks({ kind: 'position', id: 'p1', setup: 'VCP', checked: ['s1'], total: 2 })).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/positions/p1/pre-entry', expect.objectContaining({ method: 'PUT' }))
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ setup: 'VCP', checkedRuleIds: ['s1'], totalRules: 2 })
  })
  it('a closed trade writes its adherence', async () => {
    await saveTicks({ kind: 'trade', id: 't1', setup: 'VCP', checked: [], total: 2 })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trades/t1/adherence', expect.objectContaining({ method: 'PUT' }))
  })
  it('a failure is false, never a throw', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('offline') })
    expect(await saveTicks({ kind: 'trade', id: 't1', setup: null, checked: [], total: 0 })).toBe(false)
  })
})

describe('softWarning and checklistMode (IR-S8, both values)', () => {
  it('softWarning: only when requireAll is yes and something is unticked', () => {
    expect(softWarning({ requireAll: 'yes', unticked: 2 })).toBe('2 checklist items not ticked. You can still log this trade.')
    expect(softWarning({ requireAll: 'yes', unticked: 1 })).toBe('1 checklist item not ticked. You can still log this trade.')
    expect(softWarning({ requireAll: 'no', unticked: 2 })).toBeNull()
    expect(softWarning({ requireAll: 'yes', unticked: 0 })).toBeNull()
  })
  it('checklistMode reads the preference: off (default), on, on-warn', () => {
    expect(checklistMode({})).toEqual({ show: false, requireAll: 'no' })
    expect(checklistMode({ notebook_log_trade_checklist: 'off' })).toEqual({ show: false, requireAll: 'no' })
    expect(checklistMode({ notebook_log_trade_checklist: 'on' })).toEqual({ show: true, requireAll: 'no' })
    expect(checklistMode({ notebook_log_trade_checklist: 'on-warn' })).toEqual({ show: true, requireAll: 'yes' })
  })
})
```

`LogTradeChecklist.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
vi.mock('../hooks/useJournalRules', () => ({ default: () => ({ rules: [] }) }))
import LogTradeChecklist from './LogTradeChecklist'

const settings = { setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] } }

describe('LogTradeChecklist', () => {
  it('requireAll yes: ticks report up, and the soft warning shows and never disables anything', () => {
    const onChange = vi.fn()
    render(<LogTradeChecklist setup="VCP" settings={settings} accountId="a1" requireAll="yes" checked={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Volume dry-up' }))
    expect(onChange).toHaveBeenCalledWith(['s1'], 2)
    expect(screen.getByRole('status').textContent).toBe('2 checklist items not ticked. You can still log this trade.')
  })
  it('requireAll no: the same boxes, no warning', () => {
    render(<LogTradeChecklist setup="VCP" settings={settings} accountId="a1" requireAll="no" checked={[]} onChange={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('no setup chosen yet: one line, no boxes', () => {
    render(<LogTradeChecklist setup="" settings={settings} accountId="a1" requireAll="no" checked={[]} onChange={vi.fn()} />)
    expect(screen.getByText('Pick a setup to see its pre-entry checklist.')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
```

`app/src/pages/journal-2-0/LogTradeButton.checklist.test.jsx` (IR-S7: the door must RESOLVE the created row, or the dialog has no id to save ticks under):

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const seen = {}
vi.mock('./hooks/useJ2Settings', () => ({ default: () => ({ settings: { setups: ['VCP'] } }) }))
vi.mock('./hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', account: { name: 'Main' }, accounts: [{ id: 'a1', name: 'Main' }] }) }))
vi.mock('./components/AddTradeModal', () => ({
  default: ({ onSave, preEntryChecklist }) => (
    <button type="button" onClick={async () => { seen.trade = { checklist: preEntryChecklist, resolved: await onSave({ symbol: 'NVDA', side: 'Long' }) } }}>save trade</button>
  ),
}))
vi.mock('./components/AddPositionModal', () => ({
  default: ({ onSave, preEntryChecklist }) => (
    <button type="button" onClick={async () => { seen.position = { checklist: preEntryChecklist, resolved: await onSave({ symbol: 'NVDA', side: 'Long' }) } }}>save position</button>
  ),
}))
import LogTradeButton from './LogTradeButton'

describe('LogTradeButton resolves the row it created (IR-S7)', () => {
  beforeEach(() => {
    for (const k of Object.keys(seen)) delete seen[k]
    globalThis.fetch = vi.fn(async (url) => ({ ok: true, status: 200,
      json: async () => (String(url).includes('/api/j2/trades') ? { id: 't9', symbol: 'NVDA' } : { id: 'p9', symbol: 'NVDA' }) }))
  })
  it('a closed trade: onSave resolves { id } and the dialog is asked for the checklist', async () => {
    render(<MemoryRouter><LogTradeButton /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Log Trade' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Log closed trade/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'save trade' }))
    await waitFor(() => expect(seen.trade?.resolved).toEqual({ id: 't9', symbol: 'NVDA' }))
    expect(seen.trade.checklist).toBe(true)
  })
  it('an open position: the same', async () => {
    render(<MemoryRouter><LogTradeButton /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Log Trade' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Log open position/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'save position' }))
    await waitFor(() => expect(seen.position?.resolved).toEqual({ id: 'p9', symbol: 'NVDA' }))
    expect(seen.position.checklist).toBe(true)
  })
})
```

`app/src/pages/journal-2-0/JournalLogFab.checklist.test.jsx`: the same file with `JournalLogFab` in place of `LogTradeButton`, opened by `screen.getByRole('button', { name: 'Log a trade' })` (its `aria-label`, `JournalLogFab.jsx:116`) and the same two menu items; identical assertions.

In `AddTradeModal.test.jsx` and `AddPositionModal.test.jsx` (read each file's render helper and its mocks first, then add these with that helper; mock `../lib/journalStylesFlag` `journalStylesEnabled`, `../../../hooks/usePreferences` to answer `{ prefs: { notebook_log_trade_checklist: <value> }, setPref: vi.fn() }`, and `../hooks/useJournalRules` to `{ rules: [] }`, with `settings.setupRules.VCP = [{ id: 's1', label: 'Volume dry-up' }]`):

```jsx
it('P2a: switch on, preference on, preEntryChecklist: the checklist shows, submit stays enabled, and a save writes the ticks under the created id', async () => {
  // render with preEntryChecklist and onSave = vi.fn(async () => ({ id: 'NEW1' }));
  // fill the form's required fields the way this file's existing "saves" case does, pick setup 'VCP';
  expect(await screen.findByRole('group', { name: 'Pre-entry checklist' })).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Volume dry-up' }))
  // the submit button (this file's name for it) is enabled; click it
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
    '/api/j2/trades/NEW1/adherence',            // AddPositionModal: '/api/j2/trader-blocks/positions/NEW1/pre-entry'
    expect.objectContaining({ method: 'PUT' })))
})
it('P2a: on-warn shows the soft warning; on does not', async () => { /* render twice, prefs 'on-warn' then 'on'; assert the status line text, then its absence */ })
it('P2a: no preEntryChecklist prop (another surface): no checklist and no tick write', async () => { /* same render without the prop; queryByRole group is null; after save, no PUT */ })
it('P2a: the switch off: no checklist and no tick write', async () => { /* journalStylesEnabled -> false */ })
```

Write all four in full in each file against its helper (the comments say exactly what each renders and asserts; the AddTradeModal case's `onSave` mock is what `handleCreateTrade` now resolves).

In `usePreferences.additionsOnly.test.js`, add to `BASELINE_KEYS` beside `notebook_kind_mapping: 'scalar',`:

```js
  notebook_log_trade_checklist: 'scalar',
```

In `blockDoors.test.js`, add this file's own entry (IR-B5), the only change to that file in this task:

```js
export const WRITE_EXCEPTIONS = {
  'app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.js': [
    { method: 'PUT', url: '/api/j2/trader-blocks/positions/\\{\\}/pre-entry',
      why: 'Log Trade ticks for an OPEN position, to the adherence store under pos:<id> (R-P2-7); never a note.' },
    { method: 'PUT', url: '/api/j2/trades/\\{\\}/adherence',
      why: "Log Trade ticks for a CLOSED trade, to that trade's adherence record; never a note." },
  ],
}
```

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-a
cd "$WT/app"
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/LogTradeChecklist.test.jsx src/pages/journal-2-0/LogTradeButton.checklist.test.jsx src/pages/journal-2-0/JournalLogFab.checklist.test.jsx src/pages/journal-2-0/components/AddPositionModal.test.jsx src/pages/journal-2-0/components/AddTradeModal.test.jsx src/hooks/usePreferences.additionsOnly.test.js > "$TEMP/p2a-t8.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (and `blockDoors.test.js`'s "every write exception names a file that exists" is red until Step 3 creates the file, the IR-B5 order inside this task).

- [ ] **Step 3: `logTradeChecklist.js`**

```js
// Log Trade's pre-entry checklist (spec §P2 item 1, §7.5 soft warning only; R-P2-7). It writes the
// ADHERENCE store, never a note (lib/blocks/blockDoors.test.js names each method+URL below).
// ⛔ Each fetch keeps a literal URL template and an inline { method: 'PUT' } so the rail can match it.
import { untickedLine } from './checklistItems'

export const LOG_TRADE_CHECKLIST_PREF = 'notebook_log_trade_checklist'

export function checklistMode(prefs) {
  const v = prefs?.[LOG_TRADE_CHECKLIST_PREF]
  return { show: v === 'on' || v === 'on-warn', requireAll: v === 'on-warn' ? 'yes' : 'no' }
}

export async function saveTicks({ kind, id, setup, checked, total }) {
  const body = JSON.stringify({ setup: setup || null, checkedRuleIds: checked, totalRules: total })
  const headers = { 'Content-Type': 'application/json' }
  try {
    const res = kind === 'position'
      ? await fetch(`/api/j2/trader-blocks/positions/${encodeURIComponent(id)}/pre-entry`,
        { method: 'PUT', credentials: 'include', headers, body })
      : await fetch(`/api/j2/trades/${encodeURIComponent(id)}/adherence`,
        { method: 'PUT', credentials: 'include', headers, body })
    return res.ok
  } catch {
    return false
  }
}

export function softWarning({ requireAll, unticked }) {
  if (requireAll !== 'yes') return null
  const line = untickedLine(unticked)
  return line ? `${line} You can still log this trade.` : null
}
```

- [ ] **Step 4: `LogTradeChecklist.jsx` and its slot**

`components/LogTradeChecklist.jsx`:

```jsx
import useJournalRules from '../hooks/useJournalRules'
import { checklistItems, uncheckedItems, toggleChecked } from '../lib/blocks/checklistItems'
import { softWarning } from '../lib/blocks/logTradeChecklist'
import styles from './notebook/blocks/Blocks.module.css'

export default function LogTradeChecklist({ setup, settings, accountId, requireAll, checked, onChange }) {
  const { rules } = useJournalRules(accountId || null)
  if (!setup) return <p className={styles.muted}>Pick a setup to see its pre-entry checklist.</p>
  const items = checklistItems({ settings, rules, setup, includeRules: 'yes' })
  if (!items.length) return null
  const warn = softWarning({ requireAll, unticked: uncheckedItems(items, checked).length })
  return (
    <fieldset role="group" aria-label="Pre-entry checklist" className={styles.empty}>
      <legend className={styles.muted}>{`Pre-entry checklist for ${setup}`}</legend>
      {items.map((i) => (
        <label key={i.id} className={styles.row}>
          <input type="checkbox" checked={checked.includes(i.id)} onChange={() => onChange(toggleChecked(items, checked, i.id), items.length)} />
          <span>{i.label}</span>
        </label>
      ))}
      {warn && <p role="status" className={styles.muted}>{warn}</p>}
    </fieldset>
  )
}
```

`components/LogTradeChecklistSlot.jsx` (S15: `lazyLeaf`, never `lazyChunk`, whose second failure reloads the page and would lose a half-filled trade; and a boundary that renders nothing):

```jsx
import { Component, Suspense } from 'react'
import { lazyLeaf } from '../lib/lazyChunk'

const LogTradeChecklist = lazyLeaf(() => import('./LogTradeChecklist'))

/** A checklist that cannot load is simply absent: the trade must still be loggable. */
class Quiet extends Component {
  constructor(p) { super(p); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

export default function LogTradeChecklistSlot(props) {
  return <Quiet><Suspense fallback={null}><LogTradeChecklist {...props} /></Suspense></Quiet>
}
```

Add a case to `LogTradeChecklist.test.jsx`: render `LogTradeChecklistSlot` with `vi.doMock('./LogTradeChecklist', () => { throw new Error('chunk') })` (after `vi.resetModules()`, a dynamic import of the slot) and assert it renders nothing and does not throw.

- [ ] **Step 5: Wire both dialogs and both doors**

In `AddPositionModal.jsx` and `AddTradeModal.jsx` (read both first; their setup state is `setup` and `setupVal` respectively, and `AddTradeModal` takes `settings` and `accountId` props while `AddPositionModal` reads `useJ2SelectedAccount()` at `:114`):

```jsx
import usePreferences from '../../../hooks/usePreferences'
import { journalStylesEnabled } from '../lib/journalStylesFlag'
import { checklistMode, saveTicks } from '../lib/blocks/logTradeChecklist'
import LogTradeChecklistSlot from './LogTradeChecklistSlot'
```

Add `preEntryChecklist = false` to each component's props. Inside, beside the setup state:

```jsx
  const { prefs } = usePreferences()
  const mode = checklistMode(prefs)
  const checklistOn = preEntryChecklist && journalStylesEnabled() && mode.show
  const [ticks, setTicks] = useState({ checked: [], total: 0 })
```

Render, above the submit row (`setup` / `setupVal` as the file names it):

```jsx
      {checklistOn && (
        <LogTradeChecklistSlot setup={setup} settings={settings} accountId={accountId} requireAll={mode.requireAll}
          checked={ticks.checked} onChange={(checked, total) => setTicks({ checked, total })} />
      )}
```

In `AddPositionModal.jsx`'s save handler, right after `const created = await onSave(payload)` (`:349`):

```jsx
      if (checklistOn && created?.id && ticks.total > 0) {
        saveTicks({ kind: 'position', id: created.id, setup, checked: ticks.checked, total: ticks.total })
      }
```

In `AddTradeModal.jsx`'s `handleSave`, change `await onSave({` (`:128`) to `const created = await onSave({`, and right after that call:

```jsx
      if (checklistOn && created?.id && ticks.total > 0) {
        saveTicks({ kind: 'trade', id: created.id, setup: setupVal.trim() || null, checked: ticks.checked, total: ticks.total })
      }
```

The write is fire-and-forget: a failed tick save never fails or delays the logged trade. `usePreferences` returns `{ prefs, setPref, setPrefMerged, loading }` (`usePreferences.js:385`). `AddPositionModal` has `settings` from its own props or `useJ2Settings()` (read it; use what the file already has).

In `LogTradeButton.jsx` and `JournalLogFab.jsx`, `handleCreateTrade` ends with `return res` (after its `navigate(...)` line), and both `<AddPositionModal` and `<AddTradeModal` get `preEntryChecklist`. Leave `TodaySurface.jsx` and `TradeJournalTab.jsx` as they are (IR-S7: they show no checklist until they also resolve their row; recorded in the PR body).

Add the opt-in to the Journal settings where the member keeps setups (`PortfolioSettingsModal.jsx`, the setups section), rendered only while `journalStylesEnabled()`:

```jsx
        <label className={/* the section's row class */ undefined}>
          <span>Pre-entry checklist in Log Trade</span>
          <select aria-label="Pre-entry checklist in Log Trade"
            value={prefs?.[LOG_TRADE_CHECKLIST_PREF] || 'off'}
            onChange={(e) => setPref(LOG_TRADE_CHECKLIST_PREF, e.target.value)}>
            <option value="off">Off</option>
            <option value="on">Show it</option>
            <option value="on-warn">Show it, and warn until every item is ticked</option>
          </select>
        </label>
```

Test it in `PortfolioSettingsModal.test.jsx` (create the file if it does not exist, modelled on the modal's nearest test): the select is absent with the switch off; with it on, choosing each of `on` and `on-warn` calls `setPref('notebook_log_trade_checklist', <value>)` with that literal.

- [ ] **Step 6: The server preference key**

In `api/routers/auth.py` `_PREFERENCE_KEYS`, beside `"notebook_kind_mapping": _PREF_OPAQUE,`:

```python
    # Notebook P2a: Log Trade's pre-entry checklist opt-in ('off' / 'on' / 'on-warn'), written by
    # PortfolioSettingsModal. Added in the same commit as its writer.
    "notebook_log_trade_checklist": _PREF_OPAQUE,
```

- [ ] **Step 7: The a11y recipe for an outside-population surface**

In `a11y/notebookSurfaces.js` `OUTSIDE_POPULATION_SURFACES`, add:

```js
  // Notebook P2a: Log Trade's pre-entry checklist (dark behind the journal styles switch and the member's
  // opt-in); rail a11y/logTradeChecklist.a11y.test.jsx.
  'components/LogTradeChecklist.jsx': { recipe: 'log-trade-checklist', railFile: 'a11y/logTradeChecklist.a11y.test.jsx' },
```

and create `a11y/logTradeChecklist.a11y.test.jsx` rendering `LogTradeChecklist` with two items, one ticked, `requireAll="yes"`, inside `axeSurface('log-trade-checklist', …)`, asserting the group, both checkboxes and the status line before axe runs.

- [ ] **Step 8: Run**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-a
cd "$WT/app"
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/LogTradeChecklist.test.jsx src/pages/journal-2-0/LogTradeButton.checklist.test.jsx src/pages/journal-2-0/JournalLogFab.checklist.test.jsx src/pages/journal-2-0/LogTradeButton.test.jsx src/pages/journal-2-0/JournalLogFab.test.jsx src/pages/journal-2-0/components/AddPositionModal.test.jsx src/pages/journal-2-0/components/AddTradeModal.test.jsx src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx src/hooks/usePreferences.additionsOnly.test.js src/styles/tapFloor.test.js src/pages/journal-2-0/a11y/logTradeChecklist.a11y.test.jsx src/pages/journal-2-0/a11y/entryContext.a11y.test.jsx > "$TEMP/p2a-t8.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

(`entryContext.a11y.test.jsx` holds the OUTSIDE_POPULATION_SURFACES rail.)

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-a
cd "$WT"
python -m pytest $(grep -rln "test_every_key_the_client_writes_is_still_accepted" tests) -q > "$TEMP/p2a-t8-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

(The pytest that reads JS writers against `_PREFERENCE_KEYS`; the `grep` names its file. If it prints nothing, STOP: the rail moved, find it before running.) Expected: all pass.

- [ ] **Step 9: Mutation-prove IR-S7**

Capture `LogTradeButton.jsx`. Delete `return res` from `handleCreateTrade`. `LogTradeButton.checklist.test.jsx` "a closed trade" must FAIL. Restore by bytes; check the sha. Capture `AddTradeModal.jsx`; change `const created = await onSave({` back to `await onSave({` (and the `created?.id` guard now reads an undefined name: make it `undefined?.id` for the mutation). The AddTradeModal "save writes the ticks under the created id" case must FAIL. Restore by bytes.

- [ ] **Step 10: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-a
cd "$WT"
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.js app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.test.js app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js app/src/pages/journal-2-0/components/LogTradeChecklist.jsx app/src/pages/journal-2-0/components/LogTradeChecklistSlot.jsx app/src/pages/journal-2-0/components/LogTradeChecklist.test.jsx app/src/pages/journal-2-0/components/AddPositionModal.jsx app/src/pages/journal-2-0/components/AddPositionModal.test.jsx app/src/pages/journal-2-0/components/AddTradeModal.jsx app/src/pages/journal-2-0/components/AddTradeModal.test.jsx app/src/pages/journal-2-0/LogTradeButton.jsx app/src/pages/journal-2-0/JournalLogFab.jsx app/src/pages/journal-2-0/LogTradeButton.checklist.test.jsx app/src/pages/journal-2-0/JournalLogFab.checklist.test.jsx app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx api/routers/auth.py app/src/hooks/usePreferences.additionsOnly.test.js app/src/pages/journal-2-0/a11y/notebookSurfaces.js app/src/pages/journal-2-0/a11y/logTradeChecklist.a11y.test.jsx
git commit -F - -- app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.js app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.test.js app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js app/src/pages/journal-2-0/components/LogTradeChecklist.jsx app/src/pages/journal-2-0/components/LogTradeChecklistSlot.jsx app/src/pages/journal-2-0/components/LogTradeChecklist.test.jsx app/src/pages/journal-2-0/components/AddPositionModal.jsx app/src/pages/journal-2-0/components/AddPositionModal.test.jsx app/src/pages/journal-2-0/components/AddTradeModal.jsx app/src/pages/journal-2-0/components/AddTradeModal.test.jsx app/src/pages/journal-2-0/LogTradeButton.jsx app/src/pages/journal-2-0/JournalLogFab.jsx app/src/pages/journal-2-0/LogTradeButton.checklist.test.jsx app/src/pages/journal-2-0/JournalLogFab.checklist.test.jsx app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx api/routers/auth.py app/src/hooks/usePreferences.additionsOnly.test.js app/src/pages/journal-2-0/a11y/notebookSurfaces.js app/src/pages/journal-2-0/a11y/logTradeChecklist.a11y.test.jsx <<'MSG'
feat(journal): pre-entry checklist in Log Trade -- opt-in, soft warning wired to the preference, ticks saved under the row the door now returns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 9: The market context stamp, client half (the existing widget, extended)

Spec §P2 item 3. IR-S4, IR-S5, IR-S6, IR-S11, R-P2-6, R-P2-8.

**Lane:** B, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2-b`.

**Files:**
- Modify: `app/src/pages/charts/widgets/marketContextModel.js` (additive exports)
- Modify: `app/src/pages/charts/widgets/MarketContextWidget.jsx` (the frozen view: preset, sourced rows, uncaptured sentence)
- Modify: `app/src/pages/journal-2-0/components/notebook/MarketContextEmbed.jsx` (pass `fields` and `uncaptured`)
- Modify: `app/src/widgets/registry.js` (the `marketcontext` manifest, `:464-…`: two params, `reconstructable`, `plainText`), `registry.test.js` (two cases)
- Test: `app/src/pages/charts/widgets/MarketContextWidget.test.jsx` (cases), `app/src/pages/charts/widgets/marketContextModel.test.js` (new)
- Modify: `app/src/pages/journal-2-0/a11y/parts.a11y.test.jsx` (`:115`, the `embed-market-context` recipe's params)

**Interfaces:**
- Consumes: Task 3's params shape (`readings` with `regime`/`spy`/`qqq`/`vix` sourced fields, `wireDate`, `updated`, `fields`; or `{uncaptured: true, fields}`).
- Produces (`marketContextModel.js`): `REGIME_WORDS = {green: 'Green', amber: 'Yellow', orange: 'Orange', red: 'Red'}` (part b's PrepWire block reuses it); `FIELD_SETS = {all, regime, indexes}` naming which `CONTEXT_ROWS` keys and which `SOURCED_ROWS` keys a preset shows; `SOURCED_ROWS` (`regime`, `spy`, `qqq`, `vix`); `sourcedText(key, field) -> { text, missing, asOfText }`; `UNCAPTURED_SENTENCE = 'Market context is captured when a note is created. This note was written before it had one.'`.
- Rule: a reading key the capture does not hold renders NO row (an older capture, and every /charts board reading, look exactly as before); a sourced field whose `missing` is set renders its sentence, muted; a price row always says its time ("as of 1:26 PM ET", or "last close" when `closed`).

- [ ] **Step 1: Write the failing tests**

`app/src/pages/charts/widgets/marketContextModel.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { sourcedText, FIELD_SETS, SOURCED_ROWS, REGIME_WORDS, CONTEXT_ROWS } from './marketContextModel'

describe('the stamp\'s sourced rows', () => {
  it('a regime reads as its word', () => {
    expect(sourcedText('regime', { value: 'orange', source: 'UCT Exposure Rating', asOf: '2026-10-13', missing: null }))
      .toEqual({ text: 'Orange', missing: false, asOfText: 'UCT Exposure Rating, as of 2026-10-13' })
  })
  it('a price always says its time, in ET', () => {
    const t = sourcedText('spy', { value: { price: 600.5, changePct: -0.42, closed: false }, source: 'live price',
      asOf: '2026-10-13T17:26:00Z', missing: null })
    expect(t.text).toBe('600.50 (-0.42%) · as of 1:26 PM ET')
    expect(sourcedText('qqq', { value: { price: 500, changePct: 1, closed: true }, source: 'live price', asOf: null, missing: null }).text)
      .toBe('500.00 (+1.00%) · last close')
  })
  it('a missing field is its sentence, muted, never an object (IR-S4)', () => {
    expect(sourcedText('vix', { value: null, source: null, asOf: null, missing: 'VIX unavailable' }))
      .toEqual({ text: 'VIX unavailable', missing: true, asOfText: null })
    expect(sourcedText('regime', { value: null, missing: { liveUnavailable: 'x' } }).text).toBe('Not available.')
  })
  it('the presets', () => {
    expect(FIELD_SETS.indexes).toEqual({ context: [], sourced: ['spy', 'qqq', 'vix'] })
    expect(FIELD_SETS.regime.sourced).toEqual(['regime'])
    expect(FIELD_SETS.all.context).toEqual(CONTEXT_ROWS.map((r) => r.key))
    expect(SOURCED_ROWS.map((r) => r.key)).toEqual(['regime', 'spy', 'qqq', 'vix'])
    expect(REGIME_WORDS.amber).toBe('Yellow')
  })
})
```

In `MarketContextWidget.test.jsx` (read its render helper first; it renders the widget with `frozen`), add:

```jsx
const STAMP = {
  marketPhase: 'Uptrend', exposureScore: 32, exposureDelta: -4, breadthScore: 47.6, distributionDays: 3,
  pctAbove50: 41.3, pctAbove200: 55, powerTrend: null,
  regime: { value: 'orange', source: 'UCT Exposure Rating', asOf: '2026-10-13', missing: null },
  spy: { value: { price: 600.5, changePct: -0.42, closed: false }, source: 'live price', asOf: '2026-10-13T17:26:00Z', missing: null },
  qqq: { value: null, source: null, asOf: null, missing: 'No QQQ quote could be read just now.' },
  vix: { value: null, source: null, asOf: null, missing: 'VIX unavailable' },
}

it('P2a stamp: the regime, SPY, QQQ and VIX rows render after the wire rows, each with its time or its sentence', () => {
  render(<MarketContextWidget frozen={{ readings: STAMP, wireDate: '2026-10-13', updated: '1:26 PM ET', fields: 'all' }} readOnly journalDoor={false} />)
  expect(screen.getByText('Orange')).toBeTruthy()
  expect(screen.getByText('600.50 (-0.42%) · as of 1:26 PM ET')).toBeTruthy()
  expect(screen.getByText('No QQQ quote could be read just now.')).toBeTruthy()
  expect(screen.getByText('VIX unavailable')).toBeTruthy()
  expect(screen.getByText('Market phase')).toBeTruthy()
})
it('P2a stamp: the indexes preset shows SPY, QQQ and VIX only', () => {
  render(<MarketContextWidget frozen={{ readings: STAMP, fields: 'indexes' }} readOnly journalDoor={false} />)
  expect(screen.queryByText('Market phase')).toBeNull()
  expect(screen.queryByText('Orange')).toBeNull()
  expect(screen.getByText('VIX unavailable')).toBeTruthy()
})
it('P2a: an older capture (no stamp keys) renders exactly the rows it always did', () => {
  const OLD = { marketPhase: 'Uptrend', exposureScore: 32, breadthScore: 47.6, powerTrend: null }
  render(<MarketContextWidget frozen={{ readings: OLD }} readOnly journalDoor={false} />)
  expect(screen.queryByText('Regime')).toBeNull()
  expect(screen.queryByText('SPY')).toBeNull()
  expect(screen.queryByText('VIX')).toBeNull()
})
it('P2a: an uncaptured stamp says why it is empty, and offers no capture (IR-S11)', () => {
  render(<MarketContextWidget frozen={{ readings: null, uncaptured: true, fields: 'all' }} readOnly journalDoor={false} />)
  expect(screen.getByText('Market context is captured when a note is created. This note was written before it had one.')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
```

In `registry.test.js`, add:

```js
  it('P2a: an uncaptured market context stamp is still a reconstructable embed, and its plain text says so', () => {
    expect(isReconstructable('marketcontext', { uncaptured: true, fields: 'all' })).toBe(true)
    expect(paramsPlainText('marketcontext', { uncaptured: true })).toBe('[market context: not captured]')
    expect(paramsPlainText('marketcontext', { readings: { regime: { value: 'red' }, exposureScore: 10 } }))
      .toBe('[market context: regime red · exposure 10]')
  })
```

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-b
cd "$WT/app"
npx vitest run src/pages/charts/widgets/marketContextModel.test.js src/pages/charts/widgets/MarketContextWidget.test.jsx src/widgets/registry.test.js > "$TEMP/p2a-t9.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: `marketContextModel.js` (additive; `readingsFrom` and `CONTEXT_ROWS` unchanged)**

Append:

```js
// ── Notebook P2a: the market context STAMP (a note's frozen capture, IR-S6) ──────────────────────
// The stamp adds sourced fields to the same `readings` object. A key a capture does not hold renders
// NO row, so an older capture and every /charts board reading look exactly as before. Each sourced
// field is {value, source, asOf, missing}, and `missing` is a SENTENCE (IR-S4) — never rendered as
// an object: anything else reads "Not available.".
export const REGIME_WORDS = Object.freeze({ green: 'Green', amber: 'Yellow', orange: 'Orange', red: 'Red' })
export const SOURCED_ROWS = Object.freeze([
  { key: 'regime', label: 'Regime' }, { key: 'spy', label: 'SPY' },
  { key: 'qqq', label: 'QQQ' }, { key: 'vix', label: 'VIX' },
])
export const FIELD_SETS = Object.freeze({
  all: { context: CONTEXT_ROWS.map((r) => r.key), sourced: ['regime', 'spy', 'qqq', 'vix'] },
  regime: { context: CONTEXT_ROWS.map((r) => r.key), sourced: ['regime'] },
  indexes: { context: [], sourced: ['spy', 'qqq', 'vix'] },
})
export const UNCAPTURED_SENTENCE = 'Market context is captured when a note is created. This note was written before it had one.'

const etClock = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`
}

export function sourcedText(key, field) {
  const f = field && typeof field === 'object' ? field : {}
  if (f.value == null) {
    return { text: typeof f.missing === 'string' && f.missing ? f.missing : 'Not available.', missing: true, asOfText: null }
  }
  if (key === 'regime') {
    return { text: REGIME_WORDS[f.value] || String(f.value), missing: false,
      asOfText: f.source ? `${f.source}${f.asOf ? `, as of ${f.asOf}` : ''}` : null }
  }
  const p = Number(f.value?.price)
  const c = Number(f.value?.changePct)
  const when = f.value?.closed ? 'last close' : (f.asOf && etClock(f.asOf) ? `as of ${etClock(f.asOf)}` : 'time unknown')
  const text = `${p.toFixed(2)}${Number.isFinite(c) ? ` (${c > 0 ? '+' : ''}${c.toFixed(2)}%)` : ''} · ${when}`
  return { text, missing: false, asOfText: f.source || null }
}
```

- [ ] **Step 4: `MarketContextWidget.jsx`'s frozen view**

Import `FIELD_SETS`, `SOURCED_ROWS`, `sourcedText`, `UNCAPTURED_SENTENCE` beside `CONTEXT_ROWS`. Then:

- Before `{!readings && (`, render the uncaptured state when `frozen?.uncaptured`: `<div className={styles.hint} role="status">{UNCAPTURED_SENTENCE}</div>` and skip the `!readings` hint in that case (`{!readings && !frozen?.uncaptured && (`).
- Compute `const preset = FIELD_SETS[frozen?.fields] || FIELD_SETS.all`. Map `CONTEXT_ROWS.filter((r) => preset.context.includes(r.key))` in place of `CONTEXT_ROWS` (the board, with no `frozen`, uses `FIELD_SETS.all`, so its rows are unchanged).
- After the `CONTEXT_ROWS` map, inside the same `.list`, add:

```jsx
          {SOURCED_ROWS.filter((r) => preset.sourced.includes(r.key) && readings[r.key] !== undefined).map((r) => {
            const s = sourcedText(r.key, readings[r.key])
            return (
              <div key={r.key} className={styles.row} title={s.asOfText || undefined}>
                <span className={styles.rowLabel}>{r.label}</span>
                <span className={`${styles.rowValue} ${s.missing ? styles.dash : ''}`}>{s.text}</span>
              </div>
            )
          })}
          {frozen && readings.regime?.value && (
            <div className={styles.hint}>
              {/* R-P2-6 / V8: the words V8 found for opening the board grouped by this property. */}
              To see your notes by the regime they were written in, open your notes as a Board and group by "Regime when written".
            </div>
          )}
```

(`styles.dash` exists in `MarketContextWidget.module.css`; `readings[r.key] !== undefined` is the rule that keeps older captures unchanged.)

- [ ] **Step 5: `MarketContextEmbed.jsx`**

Add `fields` and `uncaptured` to the `frozen` memo:

```jsx
  const frozen = useMemo(() => ({
    readings: (params.readings && typeof params.readings === 'object') ? params.readings : null,
    wireDate: params.wireDate || null,
    updated: params.updated || null,
    fields: params.fields || 'all',
    uncaptured: params.uncaptured === true,
  }), [params.readings, params.wireDate, params.updated, params.fields, params.uncaptured])
```

- [ ] **Step 6: The `marketcontext` manifest**

In `registry.js`, in `marketcontext.paramsSchema` add after `updated`:

```js
      // Notebook P2a (IR-S6, IR-S11): which rows a note's stamp shows, and the stamp a note gained
      // after it was written (nothing was captured, by rule).
      { key: 'fields', type: 'enum', options: ['all', 'regime', 'indexes'], default: 'all' },
      { key: 'uncaptured', type: 'boolean' },
```

replace `plainText` with:

```js
    plainText: (p) => {
      if (p?.uncaptured === true) return '[market context: not captured]'
      const r = (p?.readings && typeof p.readings === 'object') ? p.readings : {}
      const bits = []
      if (r.regime?.value) bits.push(`regime ${r.regime.value}`)
      if (r.marketPhase) bits.push(String(r.marketPhase))
      if (r.exposureScore != null) bits.push(`exposure ${r.exposureScore}`)
      if (r.breadthScore != null) bits.push(`breadth ${r.breadthScore}`)
      return `[market context: ${bits.length ? bits.join(' · ') : 'no readings'}${p?.wireDate ? ` — ${p.wireDate}` : ''}]`
    },
```

and `reconstructable` with:

```js
    reconstructable: (p) => p?.uncaptured === true
      || !!(p?.readings && typeof p.readings === 'object' && !Array.isArray(p.readings)),
```

(The payload-freeze comment above `reconstructable` stays as it is: an uncaptured stamp renders its sentence, never a re-fetch.)

In `a11y/parts.a11y.test.jsx` `:115`, change the `embed-market-context` row's params from `{ readings: {} }` to the `STAMP` readings above with `fields: 'all'` (copy the object into that file), so the recipe renders the new rows.

- [ ] **Step 7: Run**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-b
cd "$WT/app"
npx vitest run src/pages/charts/widgets src/widgets/registry.test.js src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx src/pages/journal-2-0/a11y/parts.a11y.test.jsx src/pages/journal-2-0/a11y/surfaceCoverage.test.js > "$TEMP/p2a-t9.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-b
cd "$WT"
python -m pytest tests/test_trader_blocks_market_context.py tests/test_public_note_payload.py -q > "$TEMP/p2a-t9-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. (`test_trader_blocks_market_context.py`'s Node parity case reads `readingsFrom`, which this task leaves unchanged.)

- [ ] **Step 8: Mutation-prove the "older capture" rule**

Capture `MarketContextWidget.jsx`. Remove `&& readings[r.key] !== undefined` from the sourced filter. "an older capture renders exactly the rows it always did" must FAIL. Restore by bytes; check the sha.

- [ ] **Step 9: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-b
cd "$WT"
python tools/check_repo_hygiene.py
git add app/src/pages/charts/widgets/marketContextModel.js app/src/pages/charts/widgets/marketContextModel.test.js app/src/pages/charts/widgets/MarketContextWidget.jsx app/src/pages/charts/widgets/MarketContextWidget.test.jsx app/src/pages/journal-2-0/components/notebook/MarketContextEmbed.jsx app/src/widgets/registry.js app/src/widgets/registry.test.js app/src/pages/journal-2-0/a11y/parts.a11y.test.jsx
git commit -F - -- app/src/pages/charts/widgets/marketContextModel.js app/src/pages/charts/widgets/marketContextModel.test.js app/src/pages/charts/widgets/MarketContextWidget.jsx app/src/pages/charts/widgets/MarketContextWidget.test.jsx app/src/pages/journal-2-0/components/notebook/MarketContextEmbed.jsx app/src/widgets/registry.js app/src/widgets/registry.test.js app/src/pages/journal-2-0/a11y/parts.a11y.test.jsx <<'MSG'
feat(notebook): market context stamp renders regime, SPY, QQQ and VIX on the existing widget; uncaptured stamps say why

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 10: Price-stamped lines

Spec §P2 item 4. R-P2-2, R-P2-3, IR-S3, IR-S12, IR-B5, pre-flight S24, Review Focus 2.

**Lane:** B, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2-b`.

**Files:**
- Create: `app/src/pages/journal-2-0/lib/blocks/priceStamps.js` (the first-open stub), `priceStampsRun.js` (lazy), `priceStamps.test.js`
- Modify: `app/src/pages/journal-2-0/lib/tiptap.js` (`buildExtensions`)
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` (`:2465`, `noteTicker` in editor storage)
- Replace: `app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.jsx`
- Test: `app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.test.jsx`
- Modify: `app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js` (this file's own `WRITE_EXCEPTIONS` entry, IR-B5)
- Create: `app/src/pages/journal-2-0/a11y/traderBlockStamps.a11y.test.jsx`; modify `a11y/notebookSurfaces.js` (this block's line only)

**Interfaces:**
- Produces (`priceStamps.js`, eager, NO resolver import, IR-S12): `STAMP_TIMEOUT_MS = 2000`; `PRICE_STAMPS_KEY` (the plugin key); `stampsOn(doc) -> boolean`; `PriceStamps`, a TipTap `Extension` named `uctPriceStamps` whose `Enter` shortcut returns `false` (Enter lands first and at once) and, when the switch is on (S24) and the note holds a `priceStamps` block set to `yes` and the cursor ends a text line, records the line's START as pending and schedules `priceStampsRun` through `importWithOneRetry`; and whose plugin keeps each pending start MAPPED with `assoc = 1`, dropping it when `mapResult(...).deleted` (IR-S3).
- Produces (`priceStampsRun.js`, lazy): `lineTicker(text, noteTicker) -> string | null` (R-P2-3); `requestStamp({ noteId, symbol, signal }) -> Promise<{id} | null>` (`POST /api/j2/notes/{noteId}/facts {ticker, factType: 'price'}`, the `/price` path, `SlashMenu.jsx:396`); default `runStamp({ editor, id, signal })`.
- The 2 s budget starts at Enter and covers the chunk load, the ticker decision and the fetch. The stamp lands as its OWN, history-closed transaction (`closeHistory` from `@tiptap/pm/history`) directly after the line; a failure, a timeout, no ticker or a deleted line inserts nothing.

- [ ] **Step 1: Write the failing tests**

`priceStamps.test.js` (a real TipTap editor in jsdom, so V10's Enter order is proved, not assumed):

```js
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'

let STYLES_ON = true
vi.mock('../journalStylesFlag', async (orig) => ({ ...(await orig()), journalStylesEnabled: () => STYLES_ON }))

import { buildExtensions } from '../tiptap'
import { stampsOn, STAMP_TIMEOUT_MS } from './priceStamps'

let lineTicker
beforeAll(async () => { ({ lineTicker } = await import('./priceStampsRun')) })   // warm the lazy chunk once

const doc = (on, ...paras) => ({ type: 'doc', content: [
  { type: 'widgetEmbed', attrs: { widgetId: 'priceStamps', params: { on } } },
  ...paras.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })),
] })

function editorWith(content) {
  const ed = new Editor({ extensions: buildExtensions(), content })
  ed.storage.uctJournalWidgets = { noteId: 'n1', noteTicker: 'AMD' }
  return ed
}
const types = (ed) => ed.getJSON().content.map((n) => n.type)
const pressEnterAtEndOf = (ed, index) => {
  let pos = 0
  ed.state.doc.forEach((n, off, i) => { if (i === index) pos = off + n.nodeSize - 1 })
  ed.commands.setTextSelection(pos)
  ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })))
}

describe('price stamps', () => {
  beforeEach(() => {
    STYLES_ON = true
    vi.useFakeTimers()
    globalThis.fetch = vi.fn(() => new Promise((r) => setTimeout(() => r({ ok: true, json: async () => ({ fact: { id: 'f1' } }) }), 300)))
  })
  afterEach(() => { vi.useRealTimers() })

  it('lineTicker: a cashtag wins; the note ticker as a bare word counts; otherwise none', () => {
    expect(lineTicker('Bought $NVDA at the open', 'AMD')).toBe('NVDA')
    expect(lineTicker('AMD held the 20 EMA', 'AMD')).toBe('AMD')
    expect(lineTicker('Nothing here', 'AMD')).toBeNull()
  })

  it('Enter lands at once; the stamp lands after the line, as its own step', async () => {
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'paragraph'])     // Enter, instantly
    await vi.advanceTimersByTimeAsync(400)
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'financialFact', 'paragraph'])
    ed.commands.undo()
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'paragraph'])     // the stamp undoes alone
  })

  it('off by default: no block or on=no stamps nothing and fetches nothing', async () => {
    const ed = editorWith(doc('no', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(stampsOn(ed.state.doc)).toBe(false)
  })

  it('the journal styles switch off: nothing is fetched and nothing stamped, even with on=yes (S24)', async () => {
    STYLES_ON = false
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(types(ed)).not.toContain('financialFact')
  })

  it('a fetch slower than the timeout inserts nothing', async () => {
    globalThis.fetch = vi.fn((url, { signal }) => new Promise((r, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      setTimeout(() => r({ ok: true, json: async () => ({ fact: { id: 'f1' } }) }), STAMP_TIMEOUT_MS + 500)
    }))
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(STAMP_TIMEOUT_MS + 600)
    expect(types(ed)).not.toContain('financialFact')
  })

  it('a deleted line takes no stamp', async () => {
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    let from = 0, to = 0
    ed.state.doc.forEach((n, off, i) => { if (i === 1) { from = off; to = off + n.nodeSize } })
    ed.chain().deleteRange({ from, to }).run()
    await vi.advanceTimersByTimeAsync(400)
    expect(types(ed)).not.toContain('financialFact')
  })

  it('a moved line takes its stamp where it now is', async () => {
    const ed = editorWith(doc('yes', 'first', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 2)
    ed.chain().insertContentAt(1, { type: 'paragraph', content: [{ type: 'text', text: 'typed above' }] }).run()
    await vi.advanceTimersByTimeAsync(400)
    const json = ed.getJSON().content
    const at = json.findIndex((n) => n.type === 'financialFact')
    expect(at).toBeGreaterThan(0)
    expect(json[at - 1].content[0].text).toBe('Long $NVDA here')
  })

  it('a line that names no ticker fetches nothing', async () => {
    const ed = editorWith(doc('yes', 'Nothing here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('a failed fetch inserts nothing and never throws', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }))
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(100)
    expect(types(ed)).not.toContain('financialFact')
  })
})
```

`PriceStampsBlock.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
let STYLES_ON = true
vi.mock('../../../lib/journalStylesFlag', async (orig) => ({ ...(await orig()), journalStylesEnabled: () => STYLES_ON }))
import PriceStampsBlock from './PriceStampsBlock'

describe('PriceStampsBlock', () => {
  it('a named switch; turning it on is one setParams', () => {
    const setParams = vi.fn(() => true)
    render(<PriceStampsBlock params={{ on: 'no' }} setParams={setParams} editable />)
    const sw = screen.getByRole('switch', { name: 'Stamp prices as I write' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    expect(setParams).toHaveBeenCalledWith({ on: 'yes' })
  })
  it('says how it works', () => {
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={vi.fn()} editable />)
    expect(screen.getByText(/Write \$NVDA and press Enter/)).toBeTruthy()
  })
  it('the switch off: says what it needs, and the toggle is disabled (S24)', () => {
    STYLES_ON = false
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('This block needs Journal styles, which is not on for you.')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Stamp prices as I write' }).disabled).toBe(true)
    STYLES_ON = true
  })
})
```

In `blockDoors.test.js`, add this task's own entry beside the existing ones (IR-B5):

```js
  'app/src/pages/journal-2-0/lib/blocks/priceStampsRun.js': [
    { method: 'POST', url: '/api/j2/notes/\\{\\}/facts',
      why: 'The /price capture path: creates a j2_fact_observations row and never advances the note; the stamp node lands through an editor transaction (spec §P2 item 4).' },
  ],
```

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-b
cd "$WT/app"
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.test.jsx > "$TEMP/p2a-t10.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (`blockDoors.test.js`'s "names a file that exists" is red until Step 3, inside this task).

- [ ] **Step 3: `priceStamps.js` (the stub) and `priceStampsRun.js` (lazy)**

`lib/blocks/priceStamps.js`:

```js
// Price-stamped lines (spec §P2 item 4; R-P2-2, R-P2-3). The FIRST-OPEN stub (IR-S12): it decides only
// what it can without the ticker resolver, then loads priceStampsRun on the first stamp. Enter lands at
// once; the stamp follows as its own, history-closed transaction, within STAMP_TIMEOUT_MS of the Enter
// (chunk load included) or not at all. Off unless the journal styles switch is on (S24) and the note
// holds a priceStamps block with on = 'yes'.
// ⛔ IR-S3: a pending stamp tracks its line's START mapped with assoc = 1, so a deleted line reports
// `deleted` and takes no stamp.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { importWithOneRetry } from '../lazyChunk'
import { journalStylesEnabled } from '../journalStylesFlag'

export const STAMP_TIMEOUT_MS = 2000
export const PRICE_STAMPS_KEY = new PluginKey('uctPriceStamps')

export function stampsOn(doc) {
  let on = false
  doc.descendants((n) => {
    if (on) return false
    if (n.type.name === 'widgetEmbed' && n.attrs.widgetId === 'priceStamps' && n.attrs.params?.on === 'yes') on = true
    return !on
  })
  return on
}

let seq = 0

export const PriceStamps = Extension.create({
  name: 'uctPriceStamps',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: PRICE_STAMPS_KEY,
      state: {
        init: () => new Map(),
        apply(tr, pending) {
          const next = new Map()
          for (const [id, pos] of pending) {
            const r = tr.mapping.mapResult(pos, 1)
            if (!r.deleted) next.set(id, r.pos)
          }
          const meta = tr.getMeta(PRICE_STAMPS_KEY)
          if (meta?.add) next.set(meta.add.id, meta.add.pos)
          if (meta?.done) next.delete(meta.done)
          return next
        },
      },
    })]
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!journalStylesEnabled() || !empty || !editor.isEditable || !$from.parent.isTextblock) return false
        if ($from.parentOffset !== $from.parent.content.size || !$from.parent.textContent) return false
        if (!editor.storage?.uctJournalWidgets?.noteId || !stampsOn(state.doc)) return false
        const id = `stamp-${++seq}`
        editor.view.dispatch(state.tr.setMeta(PRICE_STAMPS_KEY, { add: { id, pos: $from.before() } }).setMeta('addToHistory', false))
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), STAMP_TIMEOUT_MS)
        importWithOneRetry(() => import('./priceStampsRun'))
          .then((m) => m.default({ editor, id, signal: ctl.signal }))
          .catch(() => {
            if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(PRICE_STAMPS_KEY, { done: id }).setMeta('addToHistory', false))
          })
          .finally(() => clearTimeout(timer))
        return false
      },
    }
  },
})
```

`lib/blocks/priceStampsRun.js`:

```js
// The lazy half of price stamps (IR-S12): the ticker resolver (and its taxonomy) load here, on the first
// stamp of a session, never on first open. Writes ONE thing that is not a note: the /price capture's
// fact row (lib/blocks/blockDoors.test.js names this method+URL).
import { closeHistory } from '@tiptap/pm/history'
import { resolveCashtags } from '../../../../lib/tickerResolver'
import { PRICE_STAMPS_KEY } from './priceStamps'

export function lineTicker(text, noteTicker) {
  const tags = resolveCashtags(text)
  if (tags.length) return tags[0]
  const t = String(noteTicker || '').toUpperCase()
  return t && new RegExp(`(^|[^A-Za-z0-9$])${t.replace(/[.\-]/g, '\\$&')}(?![A-Za-z0-9])`).test(text) ? t : null
}

export async function requestStamp({ noteId, symbol, signal }) {
  try {
    const res = await fetch(`/api/j2/notes/${encodeURIComponent(noteId)}/facts`, {
      method: 'POST', credentials: 'include', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: symbol, factType: 'price' }),
    })
    if (!res.ok) return null
    return (await res.json())?.fact || null
  } catch {
    return null
  }
}

export default async function runStamp({ editor, id, signal }) {
  const done = () => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(PRICE_STAMPS_KEY, { done: id }).setMeta('addToHistory', false))
  }
  const start = PRICE_STAMPS_KEY.getState(editor.state)?.get(id)
  const line = start == null ? null : editor.state.doc.nodeAt(start)
  const symbol = line?.isTextblock ? lineTicker(line.textContent, editor.storage?.uctJournalWidgets?.noteTicker) : null
  if (!symbol || signal.aborted) { done(); return }
  const fact = await requestStamp({ noteId: editor.storage.uctJournalWidgets.noteId, symbol, signal })
  if (editor.isDestroyed) return
  const pos = PRICE_STAMPS_KEY.getState(editor.state)?.get(id)       // mapped through every edit since Enter
  const now = pos == null ? null : editor.state.doc.nodeAt(pos)
  if (!fact?.id || signal.aborted || !now?.isTextblock) { done(); return }   // IR-S3: line gone -> nothing
  const tr = closeHistory(editor.state.tr)
    .insert(pos + now.nodeSize, editor.schema.nodes.financialFact.create({ factId: fact.id }))
    .setMeta(PRICE_STAMPS_KEY, { done: id })
  editor.view.dispatch(closeHistory(tr))
}
```

(`noteTicker`: in `NoteEditorPage.jsx` at `:2465`, `ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), noteId,`; add `noteTicker: note?.ticker || null,` beside `noteId` (read the surrounding lines for the note's variable name).)

- [ ] **Step 4: Register the extension**

In `lib/tiptap.js` `buildExtensions`, import `PriceStamps` from `'./blocks/priceStamps'` and add it to the returned array AFTER every extension that handles Enter. TipTap 3 builds the plugin list in REVERSE extension order (V10), so the extension added last runs its Enter handler FIRST; it returns `false`, and the others and the default Enter act. The test "Enter lands at once" proves the outcome. Allowance: 512 B in the first-open closure (Task 13 measures it); the resolver and its taxonomy must not appear in the first-open chunk list (Task 13 Step 4 checks `tickerResolver` and `a8Taxonomy` are absent from it).

- [ ] **Step 5: `PriceStampsBlock.jsx`**

```jsx
import { journalStylesEnabled } from '../../../lib/journalStylesFlag'
import { BlockNeedsSwitch } from './blockStates'
import styles from './Blocks.module.css'

export default function PriceStampsBlock({ params, setParams, editable }) {
  const on = params.on === 'yes'
  const switchOn = journalStylesEnabled()
  return (
    <div className={styles.empty}>
      <button type="button" role="switch" aria-checked={on} aria-label="Stamp prices as I write"
        className={`btn btn-ghost ${styles.tap}`} disabled={!editable || !switchOn}
        onClick={() => setParams({ on: on ? 'no' : 'yes' })}>
        {on ? 'Price stamps: on' : 'Price stamps: off'}
      </button>
      {switchOn
        ? <p className={styles.muted}>Write $NVDA and press Enter: the live price is added below the line a moment later, and stays as it was.</p>
        : <BlockNeedsSwitch what="Journal styles" />}
    </div>
  )
}
```

- [ ] **Step 6: This block's a11y recipe**

In `a11y/notebookSurfaces.js`, change ONLY `PriceStampsBlock.jsx`'s line to `{ recipe: 'trader-block-stamps' }`; create `a11y/traderBlockStamps.a11y.test.jsx` rendering `PriceStampsBlock` with `on: 'yes'` and with the switch mocked off, inside `axeSurface('trader-block-stamps', …)`, asserting the switch and the needs-switch sentence before axe runs.

- [ ] **Step 7: Run**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-b
cd "$WT/app"
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/blocks src/pages/command/keyListenerCensus.test.js src/pages/journal-2-0/a11y/traderBlockStamps.a11y.test.jsx src/pages/journal-2-0/a11y/surfaceCoverage.test.js $(git ls-files 'src/pages/journal-2-0/lib/tiptap*.test.js') > "$TEMP/p2a-t10.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass; the key-listener census unchanged.

- [ ] **Step 8: Mutation-prove the async rule and IR-S3**

Capture `priceStamps.js`. (a) Change `return false` at the end of the Enter handler to `return true` (the stamp would swallow Enter): "Enter lands at once" must FAIL. (b) Restore; change `mapResult(pos, 1)` to `mapResult(pos, -1)`: "a deleted line takes no stamp" must FAIL (this is the defect the pre-flight found). (c) Restore; change `STAMP_TIMEOUT_MS = 2000` to `20000`: "a fetch slower than the timeout inserts nothing" must FAIL. (d) Restore; delete `!journalStylesEnabled() ||`: the S24 case must FAIL. Restore by bytes; check the sha.

- [ ] **Step 9: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-b
cd "$WT"
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/blocks/priceStamps.js app/src/pages/journal-2-0/lib/blocks/priceStampsRun.js app/src/pages/journal-2-0/lib/blocks/priceStamps.test.js app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js app/src/pages/journal-2-0/lib/tiptap.js app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.test.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx app/src/pages/journal-2-0/a11y/notebookSurfaces.js app/src/pages/journal-2-0/a11y/traderBlockStamps.a11y.test.jsx
git commit -F - -- app/src/pages/journal-2-0/lib/blocks/priceStamps.js app/src/pages/journal-2-0/lib/blocks/priceStampsRun.js app/src/pages/journal-2-0/lib/blocks/priceStamps.test.js app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js app/src/pages/journal-2-0/lib/tiptap.js app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.test.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx app/src/pages/journal-2-0/a11y/notebookSurfaces.js app/src/pages/journal-2-0/a11y/traderBlockStamps.a11y.test.jsx <<'MSG'
feat(notebook): price-stamped lines -- Enter lands at once, the stamp follows as its own undoable step, 2 s or nothing; resolver loads lazily; dark with the switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 11: Position sizing block (the house formula only)

Spec §P2 item 5. R-P2-5, IR-S9, IR-S10, Review Focus 3 and 5.

**Lane:** D, `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2-d`.

**Files:**
- Create: `app/src/constants/houseSizing.json` (the ONE in-repo table, IR-S10)
- Create: `app/src/pages/journal-2-0/lib/blocks/houseSizing.js`, `houseSizing.test.js`
- Create: `tests/test_house_sizing_table.py`
- Replace: `app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.jsx`
- Test: `app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.test.jsx`
- Create: `app/src/pages/journal-2-0/a11y/traderBlockSizing.a11y.test.jsx`; modify `a11y/notebookSurfaces.js` (this block's line only)

**Interfaces:**
- Produces: `houseSizing.json` = `{ source, maxAccountRiskPct: 2, placeholderAccountSize: 100000, regimeWords: {green, amber, orange, red}, ceilingPct: {GREEN: {"A+", A, B}, …} }`; `houseSizing.js` exports `MAX_ACCOUNT_RISK_PCT`, `SIZE_CEILING_PCT`, `REGIME_OF`, `PLACEHOLDER_ACCOUNT_SIZE` (all read from the JSON) and `houseSize({entry, stop, accountSize, grade, regime}) -> {ok, skip, reason, stopPct, sizePct, riskPct, shares, riskDollars, positionDollars, boundBy: 'regime'|'risk'}`; `accountSizeFor({ params, settings }) -> number | null` (IR-S9: `null` when the settings value is unset or the placeholder and the note holds no size of its own).
- Formula (spec, verbatim): **Account Risk % = Position Size % × Stop Distance %**. Size % = min(the regime ceiling for the grade, `MAX_ACCOUNT_RISK_PCT` / Stop Distance % × 100). Shares = floor(account × Size % / entry). Risk $ = shares × |entry − stop|. No other formula. A short (stop above entry) sizes the same way (O-5 records that the Compass sizer refuses shorts).
- Consumes: `useJ2Settings()` (`settings.accountSize`), `useJ2CurrentRegime()` → `{ regime: {regime, asOf} }`; Task 1A's builder stores `regimeId`/`regimeAsOf`.

- [ ] **Step 1: Write the failing tests**

`tests/test_house_sizing_table.py`:

```python
"""IR-S10 / R-P2-5: app/src/constants/houseSizing.json is the ONE in-repo copy of the house sizing table.
This rail PARSES uct-intelligence's _SIZING_TABLE (an ast read, never an import) and compares every cell.
⛔ When uct-intelligence is not on this box the comparison SKIPS, visibly, naming where it looked.
A SKIP IS NOT A PASS: the PR body says which of the two this run was."""
from __future__ import annotations

import ast
import json
import os
from pathlib import Path

import pytest

TABLE = Path("app/src/constants/houseSizing.json")
CANDIDATES = [p for p in (os.environ.get("UCT_INTEL_PATH"), "external/uct-intelligence",
                          r"C:\Users\Patrick\uct-intelligence") if p]


def _engine_api() -> Path | None:
    for root in CANDIDATES:
        p = Path(root) / "uct_intelligence" / "api.py"
        if p.is_file():
            return p
    return None


def _sizing_table(src: str) -> dict[tuple[str, str], float]:
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_SIZING_TABLE" for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError("no `_SIZING_TABLE = {...}` assignment in uct_intelligence/api.py")


def test_the_in_repo_table_is_whole():
    t = json.loads(TABLE.read_text(encoding="utf-8"))
    assert t["maxAccountRiskPct"] == 2
    assert set(t["ceilingPct"]) == {"GREEN", "YELLOW", "ORANGE", "RED"}
    assert all(set(row) == {"A+", "A", "B"} for row in t["ceilingPct"].values())
    assert t["regimeWords"] == {"green": "GREEN", "amber": "YELLOW", "orange": "ORANGE", "red": "RED"}


def test_the_placeholder_is_the_servers_default_account_size():
    """IR-S9: the client treats this number as 'not set'; it must BE the server's default."""
    from api.services.journal_two import accounts
    assert json.loads(TABLE.read_text(encoding="utf-8"))["placeholderAccountSize"] == accounts._DEFAULT_ACCOUNT_SIZE


def test_the_table_equals_uct_intelligences_sizing_table():
    api = _engine_api()
    if api is None:
        pytest.skip(f"SKIP, NOT A PASS: uct-intelligence not found (looked in {CANDIDATES}); "
                    "the house table was NOT compared against _SIZING_TABLE")
    engine = _sizing_table(api.read_text(encoding="utf-8"))
    assert engine, "the parsed engine table is empty"                     # non-vacuity
    ours = json.loads(TABLE.read_text(encoding="utf-8"))["ceilingPct"]
    flat = {(r, g): v / 100 for r, row in ours.items() for g, v in row.items()}
    assert set(flat) == set(engine), (sorted(flat), sorted(engine))
    for key, frac in engine.items():
        assert abs(flat[key] - frac) < 1e-9, (key, flat[key], frac)


def test_control_the_parser_reads_a_planted_table_and_sees_a_changed_cell():
    src = '_SIZING_TABLE = {("GREEN", "A+"): 0.25, ("RED", "B"): 0.00}\nother = 1\n'
    assert _sizing_table(src) == {("GREEN", "A+"): 0.25, ("RED", "B"): 0.0}
    assert _sizing_table(src.replace("0.25", "0.20"))[("GREEN", "A+")] != 0.25
```

`houseSizing.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { houseSize, accountSizeFor, SIZE_CEILING_PCT, MAX_ACCOUNT_RISK_PCT, REGIME_OF, PLACEHOLDER_ACCOUNT_SIZE } from './houseSizing'

describe('the house table (R-P2-5; app/src/constants/houseSizing.json, railed by tests/test_house_sizing_table.py)', () => {
  it('carries every cell the spec names', () => {
    expect(SIZE_CEILING_PCT.GREEN['A+']).toBe(25)
    expect(SIZE_CEILING_PCT.YELLOW['A+']).toBe(15)
    expect(SIZE_CEILING_PCT.ORANGE['A+']).toBe(8)
    expect(SIZE_CEILING_PCT.ORANGE.B).toBe(0)
    expect(MAX_ACCOUNT_RISK_PCT).toBe(2)
    expect(REGIME_OF.amber).toBe('YELLOW')
  })
})

describe('houseSize', () => {
  it('the regime ceiling binds when the stop is tight', () => {
    const r = houseSize({ entry: 100, stop: 95, accountSize: 100000, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: true, stopPct: 5, sizePct: 25, riskPct: 1.25, shares: 250, riskDollars: 1250, boundBy: 'regime' })
  })
  it('the 2% cap binds when the stop is wide', () => {
    const r = houseSize({ entry: 100, stop: 90, accountSize: 100000, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ stopPct: 10, sizePct: 20, riskPct: 2, shares: 200, boundBy: 'risk' })
  })
  it('a short sizes the same way', () => {
    expect(houseSize({ entry: 50, stop: 52.5, accountSize: 10000, grade: 'A', regime: 'YELLOW' }))
      .toMatchObject({ ok: true, stopPct: 5, sizePct: 12 })
  })
  it('wrong-side, equal and skip cases size nothing and say why', () => {
    expect(houseSize({ entry: 100, stop: 100, accountSize: 1e5, grade: 'A', regime: 'GREEN' })).toMatchObject({ ok: false, reason: 'Entry and stop are the same price.' })
    expect(houseSize({ entry: 100, stop: -1, accountSize: 1e5, grade: 'A', regime: 'GREEN' })).toMatchObject({ ok: false })
    expect(houseSize({ entry: 100, stop: 95, accountSize: 1e5, grade: 'B', regime: 'ORANGE' }))
      .toMatchObject({ ok: false, skip: true, reason: 'The house rules skip a B setup in an ORANGE market.' })
    expect(houseSize({ entry: 100, stop: 95, accountSize: 1e5, grade: 'A+', regime: 'RED' })).toMatchObject({ skip: true })
  })
  it('no account size or no regime: not sized, and says what is missing', () => {
    expect(houseSize({ entry: 100, stop: 95, accountSize: null, grade: 'A', regime: 'GREEN' })).toMatchObject({ ok: false, reason: 'Set your account size in Settings.' })
    expect(houseSize({ entry: 100, stop: 95, accountSize: 1e5, grade: 'A', regime: null })).toMatchObject({ ok: false, reason: 'The market regime is not known yet.' })
  })
  it('never a negative or fractional share count', () => {
    const r = houseSize({ entry: 333.33, stop: 320, accountSize: 777, grade: 'A', regime: 'GREEN' })
    expect(Number.isInteger(r.shares) && r.shares >= 0).toBe(true)
  })
})

describe('accountSizeFor (IR-S9)', () => {
  it('the default account size is not an account size', () => {
    expect(accountSizeFor({ params: {}, settings: { accountSize: PLACEHOLDER_ACCOUNT_SIZE } })).toBeNull()
    expect(accountSizeFor({ params: {}, settings: {} })).toBeNull()
  })
  it('a size the member set in Settings counts; a size typed into this note wins', () => {
    expect(accountSizeFor({ params: {}, settings: { accountSize: 25000 } })).toBe(25000)
    expect(accountSizeFor({ params: { accountSize: 100000 }, settings: { accountSize: PLACEHOLDER_ACCOUNT_SIZE } })).toBe(100000)
  })
})
```

`PositionSizingBlock.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
let SETTINGS = { accountSize: 50000 }
vi.mock('../../../hooks/useJ2Settings', () => ({ default: () => ({ settings: SETTINGS }) }))
vi.mock('../../../hooks/useJ2CurrentRegime', () => ({ default: () => ({ regime: { regime: 'green', asOf: '2026-10-13' } }) }))
import PositionSizingBlock from './PositionSizingBlock'

describe('PositionSizingBlock', () => {
  it('named inputs; an input change is one setParams carrying the regime it was sized in', () => {
    const setParams = vi.fn(() => true)
    render(<PositionSizingBlock params={{ grade: 'A+' }} setParams={setParams} editable />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Entry' }), { target: { value: '100' } })
    expect(setParams).toHaveBeenCalledWith({ entry: 100, regimeId: 'green', regimeAsOf: '2026-10-13' })
  })
  it('shows size, shares and risk from the house formula', () => {
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('25% of the account')).toBeTruthy()
    expect(screen.getByText('125 shares')).toBeTruthy()
    expect(screen.getByText('$625 at risk (1.25% of the account)')).toBeTruthy()
  })
  it('the default account size is not an account size: says where to set it, sizes nothing, offers a size for this note (IR-S9)', () => {
    SETTINGS = { accountSize: 100000 }
    const setParams = vi.fn(() => true)
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regimeId: 'green' }} setParams={setParams} editable />)
    expect(screen.getByText('Set your account size in Settings.')).toBeTruthy()
    expect(screen.queryByText(/shares$/)).toBeNull()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Account size for this note' }), { target: { value: '80000' } })
    expect(setParams).toHaveBeenCalledWith({ accountSize: 80000 })
    SETTINGS = { accountSize: 50000 }
  })
  it("sized in an older regime: says so and offers today's", () => {
    const setParams = vi.fn(() => true)
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regimeId: 'orange', regimeAsOf: '2026-10-01' }} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('button', { name: "Use today's regime (GREEN)" }))
    expect(setParams).toHaveBeenCalledWith({ regimeId: 'green', regimeAsOf: '2026-10-13' })
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-d
cd "$WT/app"
npx vitest run src/pages/journal-2-0/lib/blocks/houseSizing.test.js src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.test.jsx > "$TEMP/p2a-t11.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-d
cd "$WT"
python -m pytest tests/test_house_sizing_table.py -q -rs > "$TEMP/p2a-t11-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (no table file).

- [ ] **Step 3: The table, and `houseSizing.js`**

`app/src/constants/houseSizing.json`:

```json
{
  "source": "uct-intelligence/uct_intelligence/api.py _SIZING_TABLE (percent of account), railed by tests/test_house_sizing_table.py",
  "maxAccountRiskPct": 2,
  "placeholderAccountSize": 100000,
  "regimeWords": { "green": "GREEN", "amber": "YELLOW", "orange": "ORANGE", "red": "RED" },
  "ceilingPct": {
    "GREEN": { "A+": 25, "A": 20, "B": 10 },
    "YELLOW": { "A+": 15, "A": 12, "B": 6 },
    "ORANGE": { "A+": 8, "A": 5, "B": 0 },
    "RED": { "A+": 0, "A": 0, "B": 0 }
  }
}
```

`lib/blocks/houseSizing.js`:

```js
// The house sizing formula, and nothing else (spec §P2 item 5):
//   Account Risk % = Position Size % × Stop Distance %
// capped at MAX_ACCOUNT_RISK_PCT, with the regime ceilings of the house table. ⛔ The table is
// app/src/constants/houseSizing.json, the ONE in-repo copy (IR-S10), railed against uct-intelligence's
// _SIZING_TABLE by tests/test_house_sizing_table.py. 0 = skip.
import TABLE from '../../../../constants/houseSizing.json'

export const MAX_ACCOUNT_RISK_PCT = TABLE.maxAccountRiskPct
export const PLACEHOLDER_ACCOUNT_SIZE = TABLE.placeholderAccountSize
export const SIZE_CEILING_PCT = Object.freeze(TABLE.ceilingPct)
export const REGIME_OF = Object.freeze(TABLE.regimeWords)

const round2 = (x) => Math.round(x * 100) / 100
const fail = (reason, extra = {}) => ({ ok: false, skip: false, reason, ...extra })

/** IR-S9: the account size to size against, or null when the member has not set one. The server writes
 *  the placeholder into every new account, so the placeholder means "not set" unless typed in this note. */
export function accountSizeFor({ params, settings }) {
  const own = Number(params?.accountSize)
  if (own > 0) return own
  const s = Number(settings?.accountSize)
  return s > 0 && s !== PLACEHOLDER_ACCOUNT_SIZE ? s : null
}

export function houseSize({ entry, stop, accountSize, grade, regime }) {
  const e = Number(entry), s = Number(stop), a = Number(accountSize)
  if (!(e > 0) || !(s > 0)) return fail('Enter an entry and a stop above zero.')
  if (e === s) return fail('Entry and stop are the same price.')
  if (!(a > 0)) return fail('Set your account size in Settings.')
  const row = SIZE_CEILING_PCT[regime]
  if (!row) return fail('The market regime is not known yet.')
  const ceiling = row[grade]
  if (ceiling === undefined) return fail('Pick a setup grade.')
  if (ceiling === 0) return fail(`The house rules skip a ${grade} setup in a${regime === 'ORANGE' ? 'n' : ''} ${regime} market.`, { skip: true })
  const stopPct = round2((Math.abs(e - s) / e) * 100)
  const riskCapSize = (MAX_ACCOUNT_RISK_PCT / stopPct) * 100
  const sizePct = round2(Math.min(ceiling, riskCapSize))
  const shares = Math.max(0, Math.floor((a * sizePct) / 100 / e))
  return {
    ok: true, skip: false, reason: null, stopPct, sizePct,
    riskPct: round2((sizePct * stopPct) / 100),
    shares, riskDollars: round2(shares * Math.abs(e - s)), positionDollars: round2(shares * e),
    boundBy: ceiling <= riskCapSize ? 'regime' : 'risk',
  }
}
```

- [ ] **Step 4: `PositionSizingBlock.jsx`**

```jsx
import useJ2Settings from '../../../hooks/useJ2Settings'
import useJ2CurrentRegime from '../../../hooks/useJ2CurrentRegime'
import { houseSize, accountSizeFor, REGIME_OF } from '../../../lib/blocks/houseSizing'
import styles from './Blocks.module.css'

const money = (x) => `$${Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

export default function PositionSizingBlock({ params, setParams, editable }) {
  const { settings } = useJ2Settings()
  const { regime: cur } = useJ2CurrentRegime()
  const todayId = cur?.regime && REGIME_OF[cur.regime] ? cur.regime : null
  const regimeId = params.regimeId || todayId
  const regime = REGIME_OF[regimeId] || null
  const accountSize = accountSizeFor({ params, settings })
  const stamp = todayId ? { regimeId: todayId, regimeAsOf: cur?.asOf || '' } : {}
  const num = (raw) => { const n = raw === '' ? undefined : Number(raw); return Number.isFinite(n) ? n : undefined }
  const put = (key, raw) => setParams({ [key]: num(raw), ...(params.regimeId ? {} : stamp) })
  const r = houseSize({ entry: params.entry, stop: params.stop, accountSize, grade: params.grade, regime })
  return (
    <div className={styles.empty}>
      <div className={styles.row}>
        <label>Entry <input type="number" inputMode="decimal" step="0.01" aria-label="Entry" disabled={!editable}
          value={params.entry ?? ''} onChange={(e) => put('entry', e.target.value)} /></label>
        <label>Stop <input type="number" inputMode="decimal" step="0.01" aria-label="Stop" disabled={!editable}
          value={params.stop ?? ''} onChange={(e) => put('stop', e.target.value)} /></label>
        <label>Grade <select aria-label="Setup grade" disabled={!editable} value={params.grade || 'A'}
          onChange={(e) => setParams({ grade: e.target.value })}>
          {['A+', 'A', 'B'].map((g) => <option key={g} value={g}>{g}</option>)}
        </select></label>
      </div>
      {accountSize == null && (
        <label className={styles.row}>Account size for this note <input type="number" inputMode="decimal" step="1"
          aria-label="Account size for this note" disabled={!editable} value={params.accountSize ?? ''}
          onChange={(e) => setParams({ accountSize: num(e.target.value) })} /></label>
      )}
      <p className={styles.muted}>{regime ? `Sized for a ${regime} market${params.regimeAsOf ? ` (as of ${params.regimeAsOf})` : ''}.` : 'The market regime is not known yet.'}</p>
      {editable && todayId && params.regimeId && params.regimeId !== todayId && (
        <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => setParams(stamp)}>
          {`Use today's regime (${REGIME_OF[todayId]})`}
        </button>
      )}
      {r.ok ? (
        <ul aria-live="polite">
          <li>{`${r.sizePct}% of the account`}</li>
          <li>{`${r.shares} shares`}</li>
          <li>{`${money(r.riskDollars)} at risk (${r.riskPct}% of the account)`}</li>
          <li className={styles.muted}>{r.boundBy === 'risk' ? 'Capped by the 2% account-risk limit.' : `The ${regime} ceiling for an ${params.grade || 'A'} setup.`}</li>
        </ul>
      ) : (
        (params.entry != null || params.stop != null || r.skip) && <p role="status" className={styles.muted}>{r.reason}</p>
      )}
    </div>
  )
}
```

(With `settings.accountSize` 50,000, entry 100, stop 95, A+ in GREEN: size 25%, 125 shares, $625 at risk. The "named inputs" case: with no stored regime the first input stamps today's; a block that already carries one keeps it until "Use today's regime".)

- [ ] **Step 5: This block's a11y recipe**

In `a11y/notebookSurfaces.js`, change ONLY `PositionSizingBlock.jsx`'s line to `{ recipe: 'trader-block-sizing' }`; create `a11y/traderBlockSizing.a11y.test.jsx` rendering the block twice (a sized trade; the placeholder account with its "Account size for this note" input), mocking the two hooks, inside `axeSurface('trader-block-sizing', …)`, asserting the three inputs, the result list and the account input before axe runs.

- [ ] **Step 6: Run**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-d
cd "$WT/app"
npx vitest run src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/blocks src/styles/tapFloor.test.js src/pages/journal-2-0/a11y/traderBlockSizing.a11y.test.jsx src/pages/journal-2-0/a11y/surfaceCoverage.test.js > "$TEMP/p2a-t11.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-d
cd "$WT"
python -m pytest tests/test_house_sizing_table.py -q -rs > "$TEMP/p2a-t11-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. Read the `-rs` summary: on this box the engine comparison must RUN (V14 found `C:\Users\Patrick\uct-intelligence`). Record "compared" or "SKIPPED (not a pass)" in the commit message and, later, the PR body.

- [ ] **Step 7: Mutation-prove the formula and the table rail**

Capture `houseSizing.js`: change `Math.min(ceiling, riskCapSize)` to `ceiling`; "the 2% cap binds when the stop is wide" must FAIL. Restore. Capture `houseSizing.json`: change `"A": 12` (YELLOW) to `"A": 13`; `test_the_table_equals_uct_intelligences_sizing_table` must FAIL and name `('YELLOW', 'A')`. Restore by bytes; check both shas.

- [ ] **Step 8: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-d
cd "$WT"
python tools/check_repo_hygiene.py
git add app/src/constants/houseSizing.json app/src/pages/journal-2-0/lib/blocks/houseSizing.js app/src/pages/journal-2-0/lib/blocks/houseSizing.test.js tests/test_house_sizing_table.py app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.test.jsx app/src/pages/journal-2-0/a11y/notebookSurfaces.js app/src/pages/journal-2-0/a11y/traderBlockSizing.a11y.test.jsx
git commit -F - -- app/src/constants/houseSizing.json app/src/pages/journal-2-0/lib/blocks/houseSizing.js app/src/pages/journal-2-0/lib/blocks/houseSizing.test.js tests/test_house_sizing_table.py app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.jsx app/src/pages/journal-2-0/components/notebook/blocks/PositionSizingBlock.test.jsx app/src/pages/journal-2-0/a11y/notebookSurfaces.js app/src/pages/journal-2-0/a11y/traderBlockSizing.a11y.test.jsx <<'MSG'
feat(notebook): position sizing block -- the house table from one in-repo file, railed against the engine; never sizes against the placeholder account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 12: Slash items and the Trade plan style v2

IR-S11, R-P2-8.

**Lane:** integrator (W3), `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2` (branch `notebook-p2-blocks`, after M2).

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx` (`ITEMS`, `TRADING_BLOCKS` `:293`)
- Modify: `api/services/journal_two/journal_styles.py` (`BUILTIN_STYLES["trade_plan"]`, `:102-105`; `_blk` beside `_chart` `:82`)
- Test: `app/src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx` (new), `tests/test_journal_styles_compose.py` (two cases)

**Interfaces:**
- Produces: three block slash items (titles = the block labels, group `trading`, `available` = `journalStylesEnabled`, each inserting `insertWidgetEmbed(blockId, defaults)`, `widgetEmbedNode.jsx:177`) and one "Market context" item that reads `GET /api/j2/trader-blocks/market-context` and inserts `insertWidgetEmbed('marketcontext', params)` on success, nothing on failure (the `/price` item's rule, `SlashMenu.jsx:398-404`: `if (!res.ok) return` … "nothing was inserted"). The built-in Trade plan style at version 2 with blocks `chart`, `preEntryChecklist`, `positionSizing`, `marketcontext` and a placeholder for each.

- [ ] **Step 1: Write the failing tests**

`SlashMenu.blocks.test.jsx` (there is no `SlashMenu.test.jsx` on master, pre-flight N6; this file is the slash menu's P2a rail):

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
let ON = true
vi.mock('../../lib/journalStylesFlag', async (orig) => ({ ...(await orig()), journalStylesEnabled: () => ON }))
import { blockItemsAvailable, groupedSlashItems, blockItemGroup } from './SlashMenu'

const titles = ['Pre-entry checklist', 'Price stamps', 'Position sizing', 'Market context']
const chainOf = () => {
  const chain = { focus: () => chain, deleteRange: () => chain, insertWidgetEmbed: vi.fn(() => chain), run: vi.fn() }
  return chain
}

describe('P2a slash items', () => {
  beforeEach(() => { ON = true })
  it('each is offered in the Trading group while the switch is on', () => {
    const here = blockItemsAvailable({})
    for (const t of titles) {
      const item = here.find((i) => i.title === t)
      expect(item, t).toBeTruthy()
      expect(blockItemGroup(item)).toBe('trading')
    }
    expect(groupedSlashItems(here, []).filter((i) => titles.includes(i.title)).every((i) => i.group === 'trading')).toBe(true)
  })
  it('none is offered while the switch is off', () => {
    ON = false
    expect(blockItemsAvailable({}).filter((i) => titles.includes(i.title))).toEqual([])
  })
  it('a block item inserts the block kind with its catalog defaults', () => {
    const chain = chainOf()
    blockItemsAvailable({}).find((i) => i.title === 'Price stamps').command({ editor: { chain: () => chain }, range: { from: 1, to: 2 } })
    expect(chain.insertWidgetEmbed).toHaveBeenCalledWith('priceStamps', { on: 'no' })
  })
  it('Market context reads the route and inserts the existing marketcontext kind with what it read (R-P2-8)', async () => {
    const params = { readings: { regime: { value: 'green' } }, wireDate: '2026-10-13', updated: '1:26 PM ET' }
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => params }))
    const chain = chainOf()
    await blockItemsAvailable({}).find((i) => i.title === 'Market context').command({ editor: { chain: () => chain }, range: { from: 1, to: 2 } })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/market-context', expect.objectContaining({ credentials: 'include' }))
    expect(chain.insertWidgetEmbed).toHaveBeenCalledWith('marketcontext', { ...params, fields: 'all' })
  })
  it('Market context: a failed read inserts nothing', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }))
    const chain = chainOf()
    await blockItemsAvailable({}).find((i) => i.title === 'Market context').command({ editor: { chain: () => chain }, range: { from: 1, to: 2 } })
    expect(chain.insertWidgetEmbed).not.toHaveBeenCalled()
  })
})
```

In `tests/test_journal_styles_compose.py`, add (with the `red`-style source patch at `trader_blocks`' seams; read the file's existing `db_path` fixture and reuse it):

```python
def _green(monkeypatch):
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(tb, "_breadth", lambda: {})
    monkeypatch.setattr(tb, "_regime_field", lambda memo: {"value": "green", "source": "UCT Exposure Rating",
                                                         "asOf": "2026-10-13", "missing": None, "detail": None})
    monkeypatch.setattr(tb, "_quotes", lambda user_id, symbols: {})


def test_trade_plan_v2_holds_the_p2a_blocks(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js
    _green(monkeypatch)
    s = js.BUILTIN_STYLES["trade_plan"]
    assert s["version"] == 2
    assert [b["block"] for b in s["blocks"]] == ["chart", "preEntryChecklist", "positionSizing", "marketcontext"]
    out = js.compose("u1", js.get_style("u1", "builtin:trade_plan"), ticker="NVDA", conn=None)
    ids = [n["attrs"]["widgetId"] for n in out["bodyJson"]["content"] if n["type"] == "widgetEmbed"]
    assert ids == ["marketcontext", "chart", "preEntryChecklist", "positionSizing"]
    assert out["properties"]["builtin:regime_at_write"] == "green"


def test_a_v1_trade_plan_note_gets_the_p2a_blocks_and_an_UNCAPTURED_stamp(db_path, monkeypatch):
    """IR-S11: 'Update layout to v2' never stamps today's market into an older note."""
    from api.services.journal_two import journal_styles as js, notes, trader_blocks as tb
    n = notes.create_note("u1", {"title": "old", "ticker": "NVDA"}, style_stamp=("builtin:trade_plan", 1, "trade_plan"))
    plan = js.plan_style_update("u1", n["id"])
    assert (plan["fromVersion"], plan["toVersion"], plan["versionCurrent"]) == (1, 2, False)
    assert {a["block"] for a in plan["add"]} >= {"preEntryChecklist", "positionSizing", "marketcontext"}
    monkeypatch.setattr(tb, "market_context_params", lambda *a, **k: pytest.fail("an update must not capture"))
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    stamps = [x for x in note["bodyJson"]["content"]
              if x.get("type") == "widgetEmbed" and x["attrs"]["widgetId"] == "marketcontext"]
    assert len(stamps) == 1 and stamps[0]["attrs"]["params"] == {"uncaptured": True, "fields": "all"}
    assert "builtin:regime_at_write" not in (note["propertiesJson"] or {})
```

(`import pytest` at the file's top if it is not there.)

- [ ] **Step 2: Run to see them fail**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT/app"
npx vitest run src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx > "$TEMP/p2a-t12.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: The slash items**

In `SlashMenu.jsx`, import `BLOCK_KINDS` from `'../../lib/journalBlocks'`; after the `Journal style` item in `ITEMS`, spread:

```js
  // Notebook P2a: each trader block, and the market context stamp, in the Trading group (spec P1.4).
  // Built from the catalog, so a block's words and defaults have one home. Dark behind the switch (R-P2-1).
  ...['preEntryChecklist', 'priceStamps', 'positionSizing'].map((id) => {
    const kind = BLOCK_KINDS.find((k) => k.id === id)
    return {
      title: kind.label,
      description: 'A trader block',
      keywords: ['block', 'trading'],
      available: journalStylesEnabled,
      command: ({ editor, range }) => {
        const defaults = Object.fromEntries(kind.settings.map((s) => [s.key, s.default]))
        editor.chain().focus().deleteRange(range).insertWidgetEmbed(id, defaults).run()
      },
    }
  }),
  {
    // R-P2-8: a member's own stamp, captured NOW and dated as such; never sets builtin:regime_at_write.
    title: 'Market context',
    description: 'Stamp the market as it is right now',
    keywords: ['block', 'trading', 'regime', 'market'],
    available: journalStylesEnabled,
    command: async ({ editor, range }) => {
      try {
        const res = await fetch('/api/j2/trader-blocks/market-context', { credentials: 'include' })
        if (!res.ok) return                    // a failed read inserts nothing (the /price item's rule)
        const params = await res.json()
        editor.chain().focus().deleteRange(range).insertWidgetEmbed('marketcontext', { ...params, fields: 'all' }).run()
      } catch {
        // nothing was inserted; the member sees nothing changed and can retry
      }
    },
  },
```

and add the four labels to `TRADING_BLOCKS` (`:293`):

```js
const TRADING_BLOCKS = new Set(['Trade-plan canvas', 'Transcript passage', 'Journal style',
  'Pre-entry checklist', 'Price stamps', 'Position sizing', 'Market context'])
```

(`journalStylesEnabled` is already imported in `SlashMenu.jsx` for the `Journal style` item; read the import and reuse it.) `journalBlocks.js` has no imports and is already in the first-open closure through the styles path (P1 Task 15 measured it); Task 13 measures the slash items against the 1,024 B allowance.

- [ ] **Step 4: Trade plan v2**

In `journal_styles.py`, beside `_chart` (`:82`):

```python
def _blk(block: str) -> dict:
    """A P2 block with its catalog defaults."""
    kind = _BLOCK_BY_ID[block]
    return {"block": block, "enabled": True, "settings": {s["key"]: s["default"] for s in kind["settings"]}}
```

and replace the `trade_plan` entry of `BUILTIN_STYLES` (`:102-105`):

```python
    "trade_plan": {"name": "Trade plan", "version": 2, "properties": {},
                   "blocks": [_chart("D"), _blk("preEntryChecklist"), _blk("positionSizing"), _blk("marketcontext")],
                   "outline": _doc(
        _h("The setup"), _ph("marketcontext"), _p("What is the pattern, and why now?"), _ph("chart"),
        _ph("preEntryChecklist"),
        _h("Entry, stop and target"), _p("Entry:"), _p("Stop:"), _p("Target:"),
        _h("Size and risk"), _ph("positionSizing"), _p("How much am I risking, and is it within my rules?"))},
```

(`_BLOCK_BY_ID` is defined at `:55`, above `_chart`, so `_blk` can read it at module load.) The version bump is what offers "Update layout to v2" to every Trade plan note made from v1 (the comment above `BUILTIN_STYLES`: "Versions are bumped BY HAND when an outline here changes"), and the update path's `mode: "update"` makes that note's stamp uncaptured (IR-S11).

- [ ] **Step 5: Run**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT/app"
npx vitest run src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx src/pages/journal-2-0/components/notebook/styles src/pages/journal-2-0/lib/journalStyles.test.js > "$TEMP/p2a-t12.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python tools/notebook_contract_fixtures.py > "$TEMP/p2a-t12-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python -m pytest tests/test_journal_styles_compose.py tests/test_journal_styles_store.py tests/test_journal_styles_update.py tests/test_journal_styles_create.py tests/test_notebook_contract_fixtures.py tests/test_regime_at_write.py -q > "$TEMP/p2a-t12-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. A fixture that recorded the Trade plan at version 1 changes; read every changed fixture's diff and confirm each change is the version, the new blocks or the stamp's frozen readings (fixtures run in the sandbox, whose wire may be empty: then the readings are the labelled-missing ones), then re-run P1's client tests that pin those fixtures (`StylesManager.test.jsx`, `journalStyles.test.js`).

- [ ] **Step 6: Commit**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx app/src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx api/services/journal_two/journal_styles.py tests/test_journal_styles_compose.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract
git commit -F - -- app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx app/src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx api/services/journal_two/journal_styles.py tests/test_journal_styles_compose.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract <<'MSG'
feat(notebook): trader blocks and the market context stamp in the slash menu's Trading group; Trade plan style v2 holds them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 13: Walk steps at 1280/820/390, the integrity step, door rows, bytes, typing

**Lane:** integrator (W3), `$WT = /c/Users/Patrick/uct-worktrees/notebook-p2`.

**Files:**
- Modify: `tools/notebook_fin_walk_features.py` (`ORDER` `:35`, a `blocks()` step registered before `discover`)
- Modify: `tools/notebook_door_audit_doors.json` (row 57; rows 58-60 are walk-measured, see Step 2)
- Modify: `tools/notebook_perf_harness.py` (`--with-blocks`)
- Test: `tests/test_notebook_fin_walk_styles_step.py` (one case)
- Create: `docs/notebook/evidence/fin-walk/<tip>/c2/`, `docs/notebook/evidence/door-audit-<stamp>/`, `docs/notebook/perf-runs/p2a/`

**Interfaces:**
- Produces walk features `blocks.slash-insert` (1280/820/390), `blocks.integrity-tick-leave`, `blocks.price-stamp`, `blocks.sizing`, `blocks.market-context`, `blocks.log-trade-checklist`, `blocks.switch-off-renders`, `blocks.coverage`.

- [ ] **Step 1: The walk step**

In `run_c2`, before `run("discover", discover)`, add a `blocks()` step built from the `styles()` idioms (`C.goto`, `C.vis_loc`, `C.step`, `C.notes_list`, `M`, the per-viewport `at(vp)` contexts) and Task 2's `save_landed` waiter. What each row does and asserts:

```python
    # ── Notebook P2a: trader blocks, at 1280 / 820 / 390 ────────────────────────────────────
    def blocks():
        # blocks.slash-insert (each viewport): new note, type "/Pre-entry checklist", Enter; the group
        #   "Pre-entry checklist" appears; at 820/390 its first control's box is >= 44 px tall.
        # blocks.integrity-tick-leave (1280): written out in full just below this comment block.
        # blocks.price-stamp (1280): a note with a Price stamps block, switch turned on through the block's
        #   own switch; type "Long $NVDA" and Enter; wait (locator.wait_for, 10 s) for the fact card V9
        #   recorded; assert one financialFact follows the line and Ctrl+Z removes it alone.
        #   In the sandbox the price capture may answer an error (no vendor): then assert NOTHING was
        #   inserted, by waiting (page.expect_response) for the POST .../facts answer and reading the body
        #   after it, and record verdict INFO with the answer's status, never FAIL.
        # blocks.sizing (1280): account size set through the settings route (V13) to 50,000; entry 100,
        #   stop 95, grade A+; assert the size line matches houseSize's answer for the regime the block
        #   shows; then set the account size back to the placeholder (100,000) and assert
        #   "Set your account size in Settings." and no share line.
        # blocks.market-context (1280): "/Market context" by slash; assert a marketcontext embed appears
        #   whose rows include "Regime" and "VIX unavailable", and the body's params.readings has the
        #   keys regime, spy, qqq, vix.
        # blocks.log-trade-checklist (1280 and 390): set the preference to "on" through the Settings
        #   select, open Log Trade -> Log closed trade, pick VCP; the group "Pre-entry checklist" shows;
        #   tick one, submit; read GET /api/j2/trades/{the new id}/adherence and assert
        #   checkedRuleIds == ["s1"] (the IR-S7 path, end to end).
        # blocks.switch-off-renders (1280): a second member context whose /api/auth/me is intercepted to
        #   answer notebook_journal_styles_enabled=false; open a note holding all three blocks and a
        #   marketcontext stamp; assert each block's group renders, Price stamps shows "This block needs
        #   Journal styles, which is not on for you.", and no block slash item is offered.
        # blocks.coverage: every feature above left a row.

        # ── blocks.integrity-tick-leave (1280): spec §P2's P0.0 repro shape, written out ─────────
        listing = M.get(base + "/api/j2/accounts").json()        # shape per V13
        acct_id = (listing.get("accounts") if isinstance(listing, dict) else listing)[0]["id"]
        st = M.get(base + f"/api/j2/accounts/{acct_id}/settings").json()
        st.update({"setups": ["VCP"], "setupRules": {"VCP": [{"id": "s1", "label": "Volume dry-up"}]}})
        M.put(base + f"/api/j2/accounts/{acct_id}/settings", data=st)
        body = {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "tick and leave"}]},
            {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "preEntryChecklist", "embedId": "walk-ck-1",
             "mode": "snapshot", "params": {"setup": "VCP", "includeRules": "no", "requireAll": "no", "checked": []},
             "searchText": "[pre-entry checklist]"}}]}
        note = M.post(base + "/api/j2/notes", data={"title": "Tick and leave", "bodyJson": body}).json()["note"]
        C.goto(pg, base, f"/journal/notebook?note={note['id']}", wait=".ProseMirror")
        box = pg.get_by_role("checkbox", name="Volume dry-up")
        C.vis_loc(box, 15000)

        def tick_and_leave():
            box.check()
            # An in-app navigation (the router hears popstate), started at once: the member leaving the note.
            pg.evaluate("() => { history.pushState({}, '', '/journal/notebook?view=all');"
                        " window.dispatchEvent(new PopStateEvent('popstate')) }")
        landed = save_landed(pg, note["id"], tick_and_leave)      # the waiter: the autosave's own PUT answer
        ticked = bool(landed) and any(
            (x.get("attrs") or {}).get("params", {}).get("checked") == ["s1"]
            for x in landed["bodyJson"]["content"] if x.get("type") == "widgetEmbed")
        conflicted = [x for x in C.notes_list(ctx, base) if "(conflicted copy)" in (x.get("title") or "")]
        ok = ticked and not conflicted
        C.step(pg, inst, "blocks.integrity-tick-leave",
               "Tick a checklist item and leave at once: the tick lands through autosave, no conflicted copy",
               "PASS" if ok else "FAIL", saved=bool(landed), ticked=ticked, conflicted=len(conflicted))
        # ... the other rows, then blocks.coverage ...
    run("blocks", blocks)
```

Write each remaining row in full in the tool, in the order listed, with waiters only (`wait_for`, `vis_loc`, `save_landed`, `expect_response`; no bare `wait_for_timeout`, no sampling loop), and add `"blocks"` to `ORDER` before `"discover"`. The navigation starts in the same callback as the tick, so "leaves within 1.5 s" holds by construction; the row's evidence is `ticked` and `not conflicted` (pre-flight N7: the old `left_ms` could not exceed 1,500 ms and proved nothing). Extend `tests/test_notebook_fin_walk_styles_step.py` with `test_the_blocks_step_has_no_blind_sleep` (the same AST read as `styles()`, on `def blocks`, asserting no `wait_for_timeout(` and that `save_landed(` appears).

- [ ] **Step 2: Door rows**

`tools/notebook_door_audit.py` drives exactly `STEP_KINDS = ("click", "click_css", "hover_css", "open_note", "type")` (`:219`) and the seed `SEEDS = ("find_similar",)` (`:120`). Append to `tools/notebook_door_audit_doors.json` (edit as text; keep its formatting) the one P2a row those verbs can reach:

```json
  {
    "feature": "Trader blocks in the slash menu (P2a)",
    "audit_row": 57,
    "path": "/journal/notebook",
    "steps": [{"click": "link|View all notes"}, {"click": "button|+ New note"}, {"type": "/Pre-entry"}],
    "target": {"role": "option", "name": "Pre-entry checklist"},
    "viewports": ["1280", "390"],
    "flag": "NOTEBOOK_JOURNAL_STYLES_ENABLED",
    "note": "Each P2a block is one slash item in the Trading group; the checklist stands for the four."
  }
```

Rows 58 (the checklist in Log Trade: needs the member's opt-in, which no seed sets), 59 (the opt-in select in the Journal settings: confirm its path with the audit's `click` verbs first; if they reach it, add the row in the same shape with target `{"role": "combobox", "name": "Pre-entry checklist in Log Trade"}`) and 60 ("Update layout" on a v1 Trade plan note: needs a seeded v1 note, which no seed makes) are measured by their walk rows (`blocks.log-trade-checklist`, the styles update row). Write in the PR body which rows the audit drives and which the walk measures. Row 56 (the list caret, now on the base) is measured by this run if the caret PR added it to the doors JSON (`grep -n '"audit_row": 56' tools/notebook_door_audit_doors.json`); otherwise its walk row stands.

- [ ] **Step 3: Pure rails**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python -m pytest tests/test_notebook_door_audit.py tests/test_notebook_fin_walk_styles_step.py -q > "$TEMP/p2a-t13-rails.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python tools/notebook_door_audit.py --self-check > "$TEMP/p2a-t13-selfcheck.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: pass; self-check exit 0.

- [ ] **Step 4: Build and bytes**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT/app"
npm run build > "$TEMP/p2a-build.log" 2>&1; code=$?; echo "BUILD EXIT: $code"; exit $code
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python tools/notebook_perf_budgets.py --dist app/dist --json docs/notebook/perf-runs/p2a/bytes-after.json > "$TEMP/p2a-bytes.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Compare with V3's base JSON (copy it to `docs/notebook/perf-runs/p2a/bytes-before.json`; both JSONs are committed, closing ledger R24 M8). Expected: exit 0; after − before ≤ 3,072 B, each task within its allowance by the chunk list; and `tickerResolver` and `a8Taxonomy` appear in NO first-open chunk's module list (IR-S12). A larger delta names the module from the chunk list and moves it lazy before landing.

- [ ] **Step 5: Typing re-measure (spec §6)**

Add `--with-blocks` to `tools/notebook_perf_harness.py`: a flag that makes `_seed` insert, as the doc's SECOND node, one `widgetEmbed` of every trader block kind and one `marketcontext` stamp (attrs exactly as the server builders shape them: `v`, `widgetId`, `embedId`, `mode: "snapshot"`, `params` from the catalog defaults (the stamp: `{"uncaptured": True, "fields": "all"}`), `searchText` for the three blocks), and a `--self-check`/`--dry-run` case asserting the seeded doc carries all four. Then, from the PowerShell tool on a quiet box (no gate, no other harness; print available memory first):

```powershell
python tools/notebook_perf_harness.py --boot --busy --sizes <V2's sizes> --opens 20 --chars 60 --json docs/notebook/perf-runs/p2a/plain.json --md docs/notebook/perf-runs/p2a/plain.md
python tools/notebook_perf_harness.py --boot --busy --with-blocks --sizes <V2's sizes> --opens 20 --chars 60 --json docs/notebook/perf-runs/p2a/blocks.json --md docs/notebook/perf-runs/p2a/blocks.md
```

(Run from `C:\Users\Patrick\uct-worktrees\notebook-p2`.) Commit the raw JSON and logs BEFORE writing any comparison (R-RAW). Then compare `typing_busy_per_char` p95 at each size against V2's baseline of record. Expected: no regression beyond the instrument's own run-to-run spread recorded in `docs/notebook/perf-budgets.md` (state the spread used). A regression is a defect to fix before landing, never a line moved.

- [ ] **Step 6: Sandbox walk c2 and door audit (PowerShell for the data dir)**

```powershell
python tools/notebook_fin_walk.py --config c2 --data-root 'C:\Users\Patrick\AppData\Local\Temp\nb-p2a-walk' --port 8133 --out 'C:\Users\Patrick\uct-worktrees\notebook-p2\docs\notebook\evidence\fin-walk\<tip>\c2' --tip <tip>
```

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python tools/notebook_door_audit.py --base http://127.0.0.1:8133 --doors tools/notebook_door_audit_doors.json --out docs/notebook/evidence
```

Expected: 0 FAIL in the walk (the styles rows from Task 2 included, which is ledger R24's re-walk), and the audit rows EASY or OK at 1280 and 390, none HIDDEN. Diff verdicts against the latest committed c2 record (P1's `docs/notebook/evidence/fin-walk/9ef039da76-r2/c2/walk.json`); a row that passed there and fails now is a regression to fix.

- [ ] **Step 7: Commit the tool changes and evidence**

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
python tools/check_repo_hygiene.py
git add tools/notebook_fin_walk_features.py tools/notebook_door_audit_doors.json tools/notebook_perf_harness.py tests/test_notebook_fin_walk_styles_step.py docs/notebook/evidence docs/notebook/perf-runs/p2a
git commit -F - -- tools/notebook_fin_walk_features.py tools/notebook_door_audit_doors.json tools/notebook_perf_harness.py tests/test_notebook_fin_walk_styles_step.py docs/notebook/evidence docs/notebook/perf-runs/p2a <<'MSG'
test(notebook): P2a walk steps (1280/820/390, tick-and-leave integrity), door row, bytes and typing evidence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 14: Exit bar — six-shard gate from a gate worktree, Python rails on the landing tree, PR, clean-up

**Lane:** integrator (W3).

- [ ] **Step 1: A gate worktree with a `notebook-*` branch name** (a gate never shares a tree with an implementer)

```bash
SHA=$(git -C /c/Users/Patrick/uct-worktrees/notebook-p2 rev-parse HEAD)
git -C /c/Users/Patrick/uct-worktrees/notebook-p2 worktree add -b notebook-p2-gate /c/Users/Patrick/uct-worktrees/notebook-p2-gate "$SHA"
printf 'session: <this session id>\ncreated: <YYYY-MM-DD>\nlane: notebook-p2-gate\n' > /c/Users/Patrick/uct-worktrees/notebook-p2-gate/.uct-session-owner
```

Then Task 0 Step 3's junction procedure for `notebook-p2-gate` alone (count 377 first, `New-Item -ItemType Junction`, `Get-Item -Force` shows `Junction` and the `_nb-shared-install` target).

- [ ] **Step 2: Print available memory; then gate**

```powershell
(Get-Counter '\Memory\Available MBytes').CounterSamples.CookedValue
```

Expected: ≥ 8,000 MB and no other gate running. Otherwise wait.

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2-gate
cd "$WT"
python scripts/gate_shards.py --shards 6 --out docs/notebook/gate-runs/p2a-landing > "$TEMP/p2a-gate.log" 2>&1; code=$?; echo "GATE EXIT: $code"; exit $code
```

Read the manifest under `docs/notebook/gate-runs/p2a-landing/`: the totals line, the file-count reconciliation and `GATE EXIT`. An `INVALID-*.md` is the environment, never a verdict. Classify any NEW failure by running it alone on the branch and on the base.

- [ ] **Step 3: Python rails on the landing tree** (C4-python: this branch touches `api/`, `tools/`, `tests/`, `scripts/`)

Merge `origin/master` into `notebook-p2-blocks` first if it moved (one merge, no rebase). Then, on that tree:

```bash
WT=/c/Users/Patrick/uct-worktrees/notebook-p2
cd "$WT"
PYTHONIOENCODING=utf-8 python -m pytest tests/test_trader_blocks.py tests/test_trader_blocks_market_context.py tests/test_trader_blocks_pre_entry.py tests/test_trader_blocks_no_note_door.py tests/test_regime_at_write.py tests/test_house_sizing_table.py tests/test_public_note_payload.py tests/test_notebook_fin_walk_styles_step.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_create.py tests/test_journal_styles_update.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py tests/test_note_kind_property.py tests/test_journal_two_properties_router.py tests/test_journal_two_notes_versions_router.py tests/test_journal_two_note_templates_router.py tests/test_notebook_template_gallery.py tests/test_notebook_schema_guard.py tests/test_notes_cas_is_atomic.py tests/test_notes_answer_is_the_committed_row.py tests/test_notebook_door_audit.py tests/test_notebook_flags.py tests/test_address_space.py tests/test_account_deletion_manifest.py tests/test_gate_shards.py tests/test_user_definitions_auth.py tests/test_paywall_gate_free_tier.py $(grep -rln "test_every_key_the_client_writes_is_still_accepted" tests) -q -rs > "$TEMP/p2a-py-landing.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Read the totals AND the `-rs` skip summary: `test_the_table_equals_uct_intelligences_sizing_table` must say it RAN on this box; a SKIP there is recorded in the PR body as "not compared", never as a pass. Then `python tools/gate_carry_over.py --help`, and run the carry-over check as it prints, against the gated tree and the landing tree. UNKNOWN is never a pass; a C1-C3 failure means re-gate.

- [ ] **Step 4: PR body and report**

Open the PR from `notebook-p2-blocks` (one master merge at a time; `web` SUCCESS before any other push). The body says:
- what shipped, and that it ships DARK behind `NOTEBOOK_JOURNAL_STYLES_ENABLED` (R-P2-1: no new flag);
- every ruling in this plan's Rulings section (IR-* and R-P2-*), each with its cost if wrong, and the owner decisions O-1 to O-5;
- the integrity rule and its rails (`blockDoors.test.js` with its method+URL exceptions, `test_trader_blocks_no_note_door.py`, the door census re-run after Tasks 5 and 6), and the walk's tick-and-leave row;
- bytes before, after and per-task delta against the allowances, and that the resolver is not in the first-open closure;
- the typing comparison and the baseline of record (V2);
- the house table rail: compared or skipped;
- the walk and door-audit numbers, and which ledger items closed (R24 M2-M6, M8; R28 N1/N2);
- that `TodaySurface` and `TradeJournalTab` show no Log Trade checklist (IR-S7);
- that part b carries items 2, 6, 7, rule versions, the insight, M-7 and NVDA, and that arming waits for part b.

The body ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
```

After merge, verify the deploy by its artifact: the deploy record's commit and `SUCCESS`, uptime ≥ 730 s, `python tools/hub_nav_smoke.py --auth`, and `git merge-base --is-ancestor <merge sha> origin/production`. H15: a failing smoke means roll back first; INCONCLUSIVE is not FAILED.

- [ ] **Step 5: Remove each lane worktree's junction (IR-B1) — PowerShell tool, one worktree at a time**

Only worktrees whose `.uct-session-owner` names this session. Keep `notebook-p2` (part b reads its tip).

```powershell
$target = 'C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules'
$before = (Get-ChildItem $target -Force | Measure-Object).Count
if ($before -ne 377) { throw "the shared install holds $before entries before removal, expected 377: stop and report" }
foreach ($w in 'notebook-p2-gate','notebook-p2-s','notebook-p2-c','notebook-p2-w','notebook-p2-a','notebook-p2-b','notebook-p2-d') {
  $link = "C:\Users\Patrick\uct-worktrees\$w\app\node_modules"
  if (-not (Test-Path $link)) { "{0}: no link" -f $w; continue }
  $i = Get-Item $link -Force
  if ($i.LinkType -ne 'Junction' -or ($i.Target -join '') -ne $target) { throw "$w: not our junction ($($i.LinkType) -> $($i.Target)): stop" }
  cmd /c rmdir "$link"
  $after = (Get-ChildItem $target -Force | Measure-Object).Count
  if ($after -ne 377) { throw "after removing $w's link the shared install holds $after entries, expected 377: STOP" }
  "{0}: link removed, target still 377" -f $w
}
```

⛔ Never `Remove-Item -Recurse`, `rm -rf` or `cmd //c` from Git Bash on a junction: each follows it and empties the target (CLAUDE.md, 2026-09-13).

- [ ] **Step 6: Remove the lane worktrees (this session's only)**

```bash
for W in notebook-p2-gate notebook-p2-s notebook-p2-c notebook-p2-w notebook-p2-a notebook-p2-b notebook-p2-d; do
  P=/c/Users/Patrick/uct-worktrees/$W
  grep -q "session: <this session id>" "$P/.uct-session-owner" || { echo "$W: not ours, left alone"; continue; }
  test ! -e "$P/app/node_modules" || { echo "$W: node_modules still present, STOP"; exit 1; }
  git -C /c/Users/Patrick/uct-worktrees/notebook-p2 worktree remove "$P"
done
```

Every lane branch was merged into `notebook-p2-blocks` and pushed before this step (the integrator pushes `notebook-p2-blocks` and each lane branch at every merge). Keep `notebook-p2` for part b.

---

## Dispositions of the remaining pre-flight items

Every Blocking and S-item the integrator ruled on is in the Rulings section. The rest:

| Item | Disposition |
|---|---|
| S13 (rail blind spots) | Fixed in Task 6: non-literal options read `?`, other transports and helpers seen, exceptions method+URL, "names a file that exists AND a call it exempts", controls for each (IR-I a, b). |
| S14 (door census re-run) | Fixed: Task 5 Step 7 and Task 6 Step 7 run `doorEnumeration.test.js` (IR-I c). |
| S15 (two lazy chunks without a boundary) | Fixed: Task 6's dispatcher sits in `EmbedErrorBoundary`; Task 8's checklist is `lazyLeaf` in a boundary that renders nothing (`LogTradeChecklistSlot.jsx`). |
| S16 (test bodies) | Fixed: every mandated case is written as code, or (four modal cases, Task 8) states exactly what it renders and asserts against a named helper; the two `WidgetEmbedView.unknownKind` cases carry their assertions as code. |
| S17 (`save_landed` sampled) | Fixed: Task 2's `save_landed` waits on the PUT's response through `page.expect_response`; Task 2's rail pins it. |
| S18 (duplicate toggle) | Fixed: `toggleChecked` and `untickedLine` live once, in `checklistItems.js`. |
| S19 (Task 1 grep rule) | Fixed: the `/price` line is pinned by its body line; Task 1's grep list was re-run against master `d92fca5be9` at plan time and every line printed exactly once. |
| S20 (missing test, third copy of options) | Fixed: Task 6 adds `paramsPlainText(id, {}) === blockSearch(id)` and the registry-options ⇄ catalog-options rail. |
| S21 (saved view impossible) | Recorded: R-P2-6 and owner decision O-2. |
| S22 (non-hermetic tests) | Fixed: Task 3, 4 and 12 tests patch `trader_blocks._breadth`, `_regime_field` and `_quotes`. |
| S23 (keyboard path, axe) | Fixed: `BlockNodeView.test.jsx` keyboard case (Tab in, through, out; Enter on Remove), the checklist block's keyboard case, and the blocks in the a11y population with a recipe per body (Tasks 6-11). |
| S24 (stamps with the switch off) | Fixed: the Enter handler checks `journalStylesEnabled()`, and the block shows `BlockNeedsSwitch` (Task 10). |
| N1 (TipTap version) | Fixed: Tech Stack says TipTap 3 (3.23.6); V10 records the reversed plugin order. |
| N2 (line drift) | Fixed: `financialFactNode.jsx:25`, `SlashMenu.jsx:293`/`:396`, `note_properties.py:456`, `AddPositionModal.jsx:114`. |
| N3 (T6 reads `trader_blocks.py`) | Fixed: the Global Constraints say `doorEnumeration.test.js` rail ② reads it, and Task 1A adds the path through the read-set rail. |
| N4 (`type` is a door verb) | Fixed: row 57 uses `type`; rows needing a seed no audit has are walk-measured (Task 13 Step 2). |
| N5 (no adherence router test) | Fixed: the nonexistent file is gone from the run lists; Task 5 says the new test is the only cover. |
| N6 (`SlashMenu.test.jsx` absent) | Fixed: removed from Task 12's run list; `SlashMenu.blocks.test.jsx` is the rail. |
| N7 (`left_ms` cannot fail) | Fixed: the tick and the navigation run in one callback; the row asserts `ticked` and `not conflicted`. |
| N8 (`totalRules` counts `rule:` items) | Recorded under R-P2-7; part b's review pack reads the stored record and prints its own total. |
| N9 (P2b reuses the worktree) | Fixed in part b: `notebook-p2b-*` worktrees. |
| N10 ("breadth score") | Fixed by IR-S6: the stamp keeps the wire's `breadthScore`. |
| N11 ("Capture again") | Fixed: there is no Capture again; a stamp is immutable, and a new reading is a new slash-inserted stamp dated by itself (R-P2-8); `regime_at_write` is the creation value. |
| N12 (allowance headroom) | Fixed: V3 measures it and Task 1 stops if 3,072 B do not fit. |
| N13 (shorts) | Recorded under O-5. |

---

## Self-review (done at write time)

**Spec coverage (part a's share):**
- §P2 preamble, per-block contract: registry entry and settings schema → Tasks 1A, 3, 6, 9; empty states → Tasks 7, 9 (uncaptured), 11 (and `BlockEmpty`); error state that never blanks the note → Task 6 (`BlockBoundary`, `EmbedErrorBoundary` on the dispatcher); phone layout, keyboard path, accessible names → `Blocks.module.css` 44 px rows at ≤1024, native controls with names, the keyboard cases (Tasks 6, 7) and an axe recipe per surface; a walk step → Task 13; "needs X, not on for you" → `BlockNeedsSwitch` (Task 6), used by Price stamps (Task 10).
- Integrity rule → Global Constraints, Task 6 (`useBlockParams`, `blockDoors.test.js`), Task 5 (`test_trader_blocks_no_note_door.py`), Tasks 5/6 (census re-run), Task 13 (tick-and-leave).
- Item 1 → Tasks 7 and 8 (Log Trade, opt-in, soft warning wired to the preference, adherence carry through the returned row, R-P2-7).
- Item 3 → Tasks 3, 4, 9, 12 (the existing widget extended, `builtin:regime_at_write`, uncaptured on update, the Board per V8; VIX unavailable and the saved view recorded).
- Item 4 → Task 10 (async, 2 s including the chunk, own transaction, off by default, dark with the switch, the `/price` path and `financialFact`).
- Item 5 → Task 11 (house formula only, one in-repo table railed against the engine, never the placeholder account).
- Composer and P1 wiring → Task 1A (catalog + builders + build mode), Task 3 (market context row) and Task 12 (Trade plan v2).
- §6: lazy chunks and bytes → Tasks 6, 10, 12, 13; typing → Task 13; contract fixtures → Tasks 3, 5, 12; ONE-FACT rails → Tasks 1A, 3, 6, 11; walk at 1280/820/390 → Task 13; door rows → Task 13; NVDA → part b.
- P1 absorbs: R24 M2-M6 → Task 2 (re-walked in 13), M8 → Task 13 Step 4; R28 N1/N2 → Task 2; row 56 → Task 13.

**Placeholders:** the remaining look-ups are explicit commands with a stated consequence (V1-V14 in Task 1; names Task 4 confirms with `grep` before running). Four modal cases (Task 8) and two dispatcher cases (Task 6) state their assertions as code against a file's existing render helper, which the implementer reads first. Task 13's walk rows are specified row by row with what each asserts and how it waits.

**Type consistency:** `setParams(patch) -> boolean` (Task 6) is what Tasks 7, 10 and 11 call. `checklistItems`/`toggleChecked`/`uncheckedItems`/`untickedLine` (Task 7) are what Task 8 imports. `market_context_params()`'s `readings` (Task 3) is what `sourcedText` and the widget rows (Task 9), `_captured_regime` (Task 4: `readings.regime.value`) and the slash item (Task 12) read; `readings_from` ⇄ `readingsFrom` is railed. Block ids are identical in `BLOCK_KINDS` (both files), the registry manifests, `BLOCK_COMPONENTS`, `BLOCK_IDS` in `registry.test.js`, `trader_blocks.BUILDERS`, the vendor rows and the slash items; `marketcontext` is the existing id everywhere. The sizer's `regimeId` (Task 1A builder, Task 11 block) maps to house words only through `houseSizing.json`.

**Review Focus:** each of the five lines names its owning test, written in Tasks 4, 6, 7, 10 and 11.
