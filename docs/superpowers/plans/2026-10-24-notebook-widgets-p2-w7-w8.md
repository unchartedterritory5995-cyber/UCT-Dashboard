# Notebook Widgets Phase 2, Waves 7 and 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free first-open bytes without a flag (wave 7), then ship, dark behind `NOTEBOOK_WIDGETS_W8_ENABLED`, a widget builder: one server engine over closed trades, open positions and trading days, a generic `builtWidget` note kind with drill-down, stored and versioned widgets, an examples gallery with sample data, and the Widgets tab of My tools (wave 8).

**Architecture:** Wave 7 moves four Notebook-owned eager modules behind dynamic imports, one measured commit each. Wave 8 adds a pure plan validator, a whitelist compiler that emits parameterised SQL over one bounded descending scan, a shared measure module, and a run layer that admits work on the phase 1 `BoundedPool`'s permits and runs it inline on the caller's thread under a SQLite progress-handler deadline. A placed widget is an ordinary `widgetEmbed` whose `widgetId` is `builtWidget`. It holds the frozen plan, pins its revision, refreshes through `POST /api/j2/widget-definitions/run`, and the server echoes every key the note must keep. All builder and My tools code is lazy.

**Tech Stack:** React + TipTap + Vitest (`app/src`); FastAPI + sqlite + pytest (`api/`).

**Spec:** `docs/superpowers/specs/2026-10-24-notebook-widgets-phase2-design.md` (revised, `6aa990e14a`), on top of `docs/superpowers/specs/2026-10-19-notebook-widgets-design.md`. Phase 1 precedent: `docs/superpowers/plans/2026-10-20-notebook-widgets.md`. Evidence for every anchor below: `nbw-p2-research/review-feasibility.md`, re-read against this tree on 2026-10-24.

## Global Constraints

- No schema change. No new node, mark or attr in `lib/notebookSchema.js` or `notebook_schema.py`. `builtWidget` is a `widgetId` value. A task that finds it needs a schema change stops and comes back to the owner.
- First-open bytes: budget **2,260,793 B**, never raised. Gate: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist` must print `VERDICT: PASS`. Run it in every task that touches an eager file.
- Wave 7 floor: at least **25 KB** of measured headroom to proceed to wave 8 (aim 40 KB). Below 25 KB: stop and report. Terminal code is never touched. `ResearchHome.jsx` stays eager unless Tasks 7.2-7.5 fall short. `AiActionsPanel` and `drawingsStore.js` are not candidates. Lazy kind metadata is not used.
- Wave 8 flag: `NOTEBOOK_WIDGETS_W8_ENABLED`, default `False`, read per request through `notebook_widgets_wave_on(8)`. Payload key `notebook_widgets_w8_enabled`, latched per tab. Wired in ONE commit (Task 8.1). Wave 7 has no flag. Rollback is `=0`, never a delete. With the flag off, a placed widget keeps its snapshot and says "Not available right now." on any action.
- One web process. No second thread pool. Builder runs take a permit from `notebook_widgets._POOL` (`WIDGET_POOL_WORKERS = 8`) and run inline. Phase 1 kinds hold at most **6**, builder runs at most **4**, previews and examples at most **2** of those, one member at most **2**. A full gate answers at once: `"Busy right now. Try again in a moment."`
- Scan: `ORDER BY <spine> DESC, id DESC LIMIT 5001`, aggregation over at most **5,000** rows. Over the cap the payload says `"Based on your newest 5,000 trades."`. SQL deadline **1.5 s** (progress handler). An interrupt is the "Took too long" state, never a 500.
- Rates: `/run` and `/drill` use scope `notebook-widgets` at **60/minute** per member. `/preview` and `/examples` use scope `notebook-widget-preview` at **120/minute**, one preview in flight per member. Daily cap **1,000** saved-widget runs per member, counted in memory and flushed to `daily_usage_counters` at most once a minute per member. Cache hits are not counted. Result cache: **300 s**, `max_size` **2,000**, key (user, plan hash, settings, data stamp).
- Ownership: `user_id` from the session only. An account id only narrows. A `defId` or account id that is not the session member's is treated as absent. Flagged trades are excluded from aggregates (`filters.ANALYTICS_INCLUDED_SQL`). Lists show them, labelled "Flagged".
- Net P&L is `pnl_dollar - fees` on equity trades. Options P&L enters only the trading-days source's day P&L, labelled "incl. options".
- The ET day spine is `filters._DAY` (`filters.py:46`). The ET hour is `hour_et` (NULL for date-only trades). An entry ET day comes from `timeutil.compute_trading_day_et` (`timeutil.py:41`). Weekday or hour is never derived from UTC `exit_date`.
- Account size is read only through `accounts.own_account_size` (rail `tests/test_account_size_authority.py`). A placeholder stop (`placeholder_stop.is_placeholder_stop`) is "No stop set", never a 0% distance. Positions with `entry_estimated` are excluded from "days open" and counted in the footnote.
- Accounts choice: "All my accounts" (default) or one account. Never the Compass `'_all_'` scope.
- Every output number goes through `notebook_widgets._num`. NaN or Infinity becomes `null` and renders as "no data".
- New tables carry `user_id`, are created through `db.ensure_schema` (statements appended to `_PHASE_2_ALTERS`, `db.py:1645`), are listed in `account_purge._DIRECT_USER_TABLES` (`account_purge.py:32`), and `docs/account-deletion-manifest.md` is regenerated with `python tools/account_deletion_manifest.py --write`.
- Plans: `plan_version` 1. A newer app reads every older version forever. Plans are upgraded in memory on read and written back only on a member save. Nothing rewrites stored plans in bulk. A plan whose version is newer than the server knows is refused for run and save with `"This widget was made with a newer version of the app. Reload to use it."` and its stored summary is shown.
- Defaults and caps: date range `last_90d`. 100 non-archived widgets per member. Plan at most 16,384 B compact JSON and JSON depth at most 16 (`notes._json_depth_exceeds`, `notes.py:997`). 50 revisions kept per widget plus any the member names. Saves less than 60 s apart coalesce. Frozen `def` in a note at most 4,096 B, else `defRef` only. Group labels clipped at 60 characters. Top N at most 40.
- Small samples: a `rate` or `average` measure shows a "small sample" badge under 20 in its own unit, and its value is replaced by `"Not enough trades yet (<n>)"` (or `days`) under its `min_n` (default 5). Sums, counts and extremes always show, with their count.
- Sample data: a member with fewer than **5** closed trades across all accounts sees example cards and the builder preview on the bundled sample book, labelled `"Sample data"`. Sample data is never saved into a note.
- Privacy: `builtWidget` is an account kind. Neutral line verbatim: `A private account item is not shown on public pages.` The frozen `def` and the summary sentence never reach a public page or the archive image. Trade ids never appear in params or result rows.
- Member words: Widget, Routine, Tracker, Template; "Accounts", "What to look at". The words "definition", "shelf", "built widget", "source", "plan" and "scope" never appear in UI copy. No emoji; icons are `UIcon` names. Every touch target is at least 44 px (`styles/tapFloor.test.js`).
- The new router's 402 sentence is its own and distinct: `"Built widgets require a paid plan"` (`tests/test_user_definitions_auth.py:346-351` requires distinct sentences).
- Repo rules: run tests in their own tool call, read the totals line, then commit in a separate call. Backend: `python -m pytest <named files> -q`, never a directory. Frontend: `cd app && npx vitest run <paths>`. Files are LF. Run `python tools/check_repo_hygiene.py` before each commit. Commit with `git commit -F - <<'MSG'` ... `MSG`, the message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push the branch after each task.

## Review Focus

1. **A member whose trades are all date-only broker imports with no stops.** R measures say "R known on 0 of 47 trades" with the "Add stops to see R for more trades" link, an ET-hour split excludes and counts them, and "hold minutes" says it needs entry and exit times. Never a 0R bar or a 0:00 bucket. Owned by Tasks 8.3 and 8.5.
2. **Member text that is hostile or awkward** (a setup named `__proto__`, a tag with `'`, `%`, `;`, `--`, emoji, 200 characters). Filters match it exactly, labels clip at 60 characters, drill-down finds the group by its clipped label, the client groups with `Map`, and the compiled SQL contains none of the text. Owned by Tasks 8.5 and 8.14.
3. **Ranges at the edges:** today on a Saturday, a fixed range with `from` after `to`, a range past the market calendar's horizon (2028-12-31), and a "last 100 trades" range for a member with 12. A weekend today resolves to the week's sessions, a reversed range is refused with a sentence, past the horizon the days are weekdays with the quiet note, and "last 100" covers the 12 it has and says so. Owned by Tasks 8.2 and 8.4.
4. **A placed widget whose widget was deleted, whose account was deleted, or that sits in a note copied into another member's account.** See it now and drill-down run the frozen copy and say "Running from the saved copy in this note.", a missing account falls back to "All my accounts" with the sentence "That account is no longer in your Journal; showing all accounts.", and nothing reads the other member's rows. Owned by Tasks 8.7, 8.11 and 8.14.
5. **Two tabs editing one widget, and a See it now racing a share switch.** The second save gets 409 "Changed in another tab. Reload to see the newer version." with the draft kept, and a refresh that resolves after the share switch was turned off writes `share: false`. Owned by Tasks 8.8 and 8.13.

---

## Wave 7: bytes first (no flag)

### Task 7.1: Measured baseline and the eagerness census

**Files:**
- Modify: `tools/notebook_perf_budgets.py` (a `--chunks` flag)
- Modify: `docs/notebook/perf-budgets.md` (a new section, "Phase 2 wave 7 baseline")
- Test: `tests/test_notebook_perf_budgets.py`

**Interfaces:**
- Produces: `python tools/notebook_perf_budgets.py --dist app/dist --chunks` prints, after the verdict, one line per JS file in each budget's static closure, `<file> <bytes>`, largest first. `check_bytes` returns every row in `detail[name]["files"]` (it already computes them in `closure_bytes`; today only `largest[:8]` is kept).
- Produces (record): the section names the build SHA, the closure total, the headroom (`2,260,793 - total`), and for each candidate in spec §11 step 2 (`lib/notebookTemplates.js`, `components/notebook/BulkActionBar.jsx`, `components/notebook/TemplatePicker.jsx`, `lib/emojiData.js`, `components/notebook/SavedViewEditor.jsx`, `components/connectors/NoteConnectorsTrustStrip.jsx`, the onboarding sample notebook module) whether it is EAGER, with the evidence: a string literal unique to that module (confirmed unique with `grep -rn` over `app/src`) found by `grep -l` in a file the `--chunks` list names.

- [ ] **Step 1: Write the failing test** `test_chunks_lists_every_closure_file`: on the existing synthetic-manifest fixture of that file, `check_bytes(...)[1][name]["files"]` holds every JS file in the closure (not only 8), sorted by size descending, and its sum equals `detail[name]["bytes"]`.
- [ ] **Step 2:** Run `python -m pytest tests/test_notebook_perf_budgets.py -q`. Expected: FAIL (`KeyError: 'files'`).
- [ ] **Step 3:** Implement: keep `rows` as `files` in `detail`, print them under `--chunks`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Build and measure: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist --chunks`. Expected: `VERDICT: PASS`. Write the section with the numbers exactly as printed, the SHA (`git rev-parse HEAD`), and the census table. A candidate not found in any closure file is recorded "lazy already, not a candidate".
- [ ] **Step 6:** Commit: `perf(notebook): wave 7 baseline - measured first-open bytes and the eagerness census`.

### Task 7.2: `notebookTemplates` behind an async loader

**Files:**
- Create: `app/src/pages/journal-2-0/lib/templatesLoader.js`
- Create: `app/src/pages/journal-2-0/lib/templateWantsTicker.js` (the pure helper moved out, re-exported from `notebookTemplates.js` so its other importers are unchanged)
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (`:22` import; call sites `:1926`, `:2335`; `:1804` keeps `templateWantsTicker` from the new tiny module)
- Modify: `app/src/pages/journal-2-0/lib/noteCreation.js` (`:12`, `:95`)
- Test: `app/src/pages/journal-2-0/lib/templatesLoader.test.js`, the existing `NotebookTab` deep-link and thesis tests, `lib/noteCreation*.test.js`

**Interfaces:**
- Produces: `loadTemplates(): Promise<module>` (one dynamic `import('./notebookTemplates')`, memoised, retried once through `importWithOneRetry`), `getTemplateAsync(key: string): Promise<template|null>`, `preloadTemplates(): void` (schedules `loadTemplates()` with `requestIdleCallback`, falling back to `setTimeout(…, 1500)`).
- `templateWantsTicker(tpl)` is byte-for-byte the function at `notebookTemplates.js:1305`.
- ⛔ `TemplatePicker.jsx:75` still imports the catalog statically, so this commit's byte delta can be near zero. It is recorded as measured, and Task 7.4 frees the module.

- [ ] **Step 1: Write the failing tests:**
  - `loadTemplates_imports_once`: two concurrent calls resolve the same module object, and the import spy is called once.
  - `getTemplateAsync_unknown_is_null`: `await getTemplateAsync('nope') === null`.
  - In the NotebookTab deep-link test: `?new=thesis` still creates a note titled by the thesis template, after `await` (findBy).
  - In the noteCreation test: `createNoteFromTemplateViaApi('nope')` still rejects with `Unknown template: nope`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/lib/templatesLoader.test.js src/pages/journal-2-0/lib/noteCreation src/pages/journal-2-0/tabs/NotebookTab`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. NotebookTab calls `preloadTemplates()` once in a mount effect. The deep-link effect at `:1926` and the thesis handler at `:2335` await `getTemplateAsync`. `noteCreation.js:95` awaits it (the function is already `async`).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`. Note the total.
- [ ] **Step 6:** Commit: `perf(notebook): load the template catalog on demand (<measured delta> B)`, the delta from Task 7.1's total.

### Task 7.3: BulkActionBar mounted on first selection

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (`:42` import, `:2594` mount)
- Test: the existing BulkActionBar and NotebookTab selection tests

**Interfaces:**
- `BulkActionBar` becomes `lazyChunk(() => import('../components/notebook/BulkActionBar'))` (`lib/lazyChunk.js:80`), rendered inside `<Suspense fallback={null}>` at the same place, under the same `selectionOn && selection.count > 0` condition.

- [ ] **Step 1: Write the failing test** in the NotebookTab selection test file: `bulk_bar_module_not_loaded_without_selection` (mock the module, assert its factory has not run after mount), and `bulk_bar_appears_after_first_select` (tick one row, `await findByRole` the bar).
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/tabs/NotebookTab src/pages/journal-2-0/components/notebook/BulkActionBar`. Expected: the first test FAILS.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS, with the existing focus-on-Clear test still green.
- [ ] **Step 5:** Bytes check. Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `perf(notebook): mount the bulk action bar on first selection (<measured delta> B)`.

### Task 7.4: TemplatePicker lazy, with a skeleton that keeps the tour's anchor

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/TemplatePickerSkeleton.jsx`
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (`:17` import, mounts `:2674` and `:2869`)
- Modify: `app/src/pages/journal-2-0/components/notebook/TemplatePicker.jsx` (`:75`: take `FAMILIES`, `templatesByFamily` and `templatePreview` from `await loadTemplates()` instead of a static import)
- Test: `components/notebook/onboarding/tours/b1TemplateGallery.steps.test.js`, `tours/b4Styles.emptyNotebook.test.jsx`, `tabs/NotebookTab.starterOffer.test.jsx`, a new `TemplatePickerSkeleton.test.jsx`

**Interfaces:**
- `TemplatePickerSkeleton` renders the picker's outer box with the same class, the same height and an element carrying `data-tour="template-gallery-door"` (`TemplatePicker.jsx:340`), so the tour step finds its anchor while the chunk loads.
- NotebookTab renders `<Suspense fallback={<TemplatePickerSkeleton/>}>` around a `lazyChunk` TemplatePicker at both mounts.

- [ ] **Step 1: Write the failing tests:**
  - `skeleton_carries_the_tour_anchor`: `container.querySelector('[data-tour="template-gallery-door"]')` is not null.
  - In `b4Styles.emptyNotebook.test.jsx`: the tour reaches its gallery step with the picker module delayed by a never-resolving mock for one tick.
  - `notebookTemplates_not_imported_on_empty_notebook_mount`: an import spy on `lib/notebookTemplates` is not called before the picker resolves.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/TemplatePickerSkeleton.test.jsx src/pages/journal-2-0/components/notebook/onboarding/tours src/pages/journal-2-0/tabs/NotebookTab.starterOffer.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes check. Expected: `VERDICT: PASS`, and `notebookTemplates`'s unique literal no longer found in any `--chunks` file.
- [ ] **Step 6:** Commit: `perf(notebook): lazy template picker with a tour-anchor skeleton (<measured delta> B)`.

### Task 7.5: Emoji data loaded on the first `:`

**Files:**
- Create: `app/src/pages/journal-2-0/lib/emojiShortcode.js` (`SHORTCODE_BODY`, `EMOJI_QUERY_RE`, moved from `emojiData.js:196-197` and re-exported there)
- Modify: `app/src/pages/journal-2-0/components/notebook/EmojiMenu.jsx` (`:41`, the input rule at `:123-133`, `items` at `:155`)
- Test: `components/notebook/EmojiMenu*.test.jsx`, `lib/emojiData.test.js`

**Interfaces:**
- `EmojiMenu` imports only `emojiShortcode.js` statically. `loadEmoji(): Promise<module>` (memoised dynamic import of `../../lib/emojiData`) starts on the first `:` typed in the editor.
- `items` answers `[]` until the module lands and the suggestion re-queries when it does.
- The `:name:` input rule: when the module is not loaded yet, it awaits `loadEmoji()`, then replaces the range only if the document still holds `:name:` there (mapped through any transaction meanwhile).

- [ ] **Step 1: Write the failing tests:**
  - `emoji_data_not_imported_until_colon`.
  - `first_whole_shortcode_converts_after_load`: typing `:smile:` as the very first input ends with the emoji in the doc.
  - `shortcode_not_replaced_if_text_changed_while_loading`: delete the text before the load resolves, and the doc is unchanged.
  - The existing search tests stay green.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/EmojiMenu src/pages/journal-2-0/lib/emojiData`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes check. Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `perf(notebook): load emoji data on the first colon (<measured delta> B)`.

### Task 7.6: The remaining candidates, and the headroom gate

**Files:**
- Modify (only for a candidate Task 7.1 recorded EAGER): `tabs/NotebookTab.jsx` imports of `SavedViewEditor` (`:12`) and `NoteConnectorsTrustStrip` (`:18`), and the onboarding sample notebook module's importer
- Modify: `docs/notebook/perf-budgets.md` (the wave 7 close-out table)

**Interfaces:**
- Each EAGER candidate becomes a `lazyChunk` with `fallback={null}` (the editor and the trust strip render after first paint; both are below the list header).

- [ ] **Step 1:** For each EAGER candidate, write the "module not loaded on mount" test in its host's test file, then implement, then run that file. Expected: PASS. One commit per candidate: `perf(notebook): lazy <module> (<measured delta> B)`.
- [ ] **Step 2:** Build and measure: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`.
- [ ] **Step 3:** Write the close-out table: each Task 7.x delta and the final headroom. **If the headroom is below 25,600 B (25 KB): stop and report to the owner.** Wave 8 does not start, and the budget is not raised. If it is at or above it, record "proceed".
- [ ] **Step 4:** Commit: `docs(notebook): wave 7 close-out - <headroom> B of first-open headroom`.

---

## Wave 8: the widget engine and the builder (`NOTEBOOK_WIDGETS_W8_ENABLED`)

### Task 8.1: Flag wiring in every place

**Files:**
- Modify: `api/routers/auth.py` (`NOTEBOOK_FLAGS`, after `:290`)
- Modify: `app/src/pages/journal-2-0/lib/offline/notebookFlags.js` (`FLAG_FALLBACKS`, after `:89`)
- Modify: `app/src/pages/journal-2-0/lib/notebookWidgetsFlags.js` (`WAVES`)
- Modify: `docs/feature_flags.json` (after the W6 entry, `:1957-1962`)
- Modify: `tests/test_notebook_flags.py` (`:100-105` pins)
- Test: `tests/test_notebook_flags.py`, `tests/test_notebook_flag_table_form.py`, `tests/test_notebook_flag_parse.py`, `lib/notebookWidgetsFlags.test.js`

**Interfaces:**
- Produces: `"NOTEBOOK_WIDGETS_W8_ENABLED": False,  # enablement — unset means OFF (notebook widgets, wave 8)`; `notebook_widgets_w8_enabled: false, // notebook widgets, wave 8 — absent ⇒ OFF`; `WAVES = [1, 2, 3, 4, 5, 6, 8]`; `widgetsWaveOn(8)`.
- The ledger entry: `member_facing: {label: "Build your own widgets", where: "Notebook"}`, `status: "dark"`, `where: ["web"]`, a note naming this plan, "read per request", the arm line `railway variables --service web --set NOTEBOOK_WIDGETS_W8_ENABLED=1` (the owner's) and the rollback `=0` (never a delete).
- W8 adds no template slot family, so `journal_styles._slot_wave_off` (`:816`) is unchanged. The wave 11 plan owns that.
- ⚠️ Deviation from spec §13, on purpose: the `KIND_WAVE` row lands in Task 8.13, not here. `tests/test_journal_styles_compose.py` (`test_the_server_kind_titles_match_the_client_widget_kinds`, `test_account_kinds_agree_client_server_and_public_table`, `test_client_waves_match_the_server_kind_wave`) compare the server's `KIND_WAVE`, `KIND_TITLE` and `ACCOUNT_KINDS` with the client's `WIDGET_KINDS` row by row, so a server row without its client row turns three rails red. Task 8.13 adds all of them, both sides, in one commit.

- [ ] **Step 1: Write the failing tests.** Add `notebook_widgets_w8_enabled` to the pinned list. In `notebookWidgetsFlags.test.js`: `widgetsWaveOn(8)` is false unlatched and true once latched, and `widgetsWaveOn(7)` is always false.
- [ ] **Step 2:** Run `python -m pytest tests/test_notebook_flags.py tests/test_notebook_flag_table_form.py tests/test_notebook_flag_parse.py -q` and `cd app && npx vitest run src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js`. Expected: FAIL.
- [ ] **Step 3:** Add the four rows in one change.
- [ ] **Step 4:** Run both commands. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): dark release flag for notebook widgets wave 8`.

### Task 8.2: The trading-days spine

**Files:**
- Create: `api/services/journal_two/trading_days.py`
- Test: `tests/test_trading_days.py`

**Interfaces:**
- Consumes: `session_calendar.is_trading_day`, `covers`, `horizon` (`session_calendar.py:154-172`); `timeutil.compute_trading_day_et`.
- Produces:
  - `today_et(now: datetime | None = None) -> date`.
  - `class SessionRange(NamedTuple): days: list[date]; beyond_from: date | None` (the first day past `horizon()` in the range, else `None`).
  - `sessions(lo: date, hi: date) -> SessionRange`: every `is_trading_day` day in `[lo, hi]` while `covers(d)`; past the horizon, Monday to Friday. `lo > hi` raises `ValueError("The start date is after the end date.")`.
  - `beyond_note(beyond_from: date) -> str`: `"Market calendar not available past <Mon D, YYYY>; counting weekdays."`.
  - `entry_day_et(entry_date: str | None, *, estimated: bool) -> str | None`: `None` when `estimated`, else `compute_trading_day_et(entry_date)`.
  - `is_session(d: date) -> bool`.
  - `session_on_or_before(d: date) -> date` (a weekend or holiday maps to the last session).

- [ ] **Step 1: Write the failing tests:**
  - `test_weekend_and_holiday_are_not_sessions`: 2026-11-26 (Thanksgiving) and 2026-11-28 (Saturday) are absent from `sessions(date(2026,11,23), date(2026,11,29)).days`.
  - `test_half_day_is_a_session`: 2026-11-27 is present.
  - `test_beyond_horizon_counts_weekdays`: a range across `horizon()` sets `beyond_from == horizon() + 1 day` and includes weekdays only after it.
  - `test_reversed_range_raises_with_sentence`.
  - `test_entry_day_estimated_is_none`.
  - `test_entry_day_uses_et_not_utc`: `"2026-10-20T01:30:00Z"` gives `"2026-10-19"`.
  - `test_session_on_or_before_saturday_is_friday`.
- [ ] **Step 2:** Run `python -m pytest tests/test_trading_days.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): trading-days spine over the market calendar`.

### Task 8.3: The shared measure module

**Files:**
- Create: `api/services/journal_two/measures.py`
- Test: `tests/test_measures.py`

**Interfaces:**
- Consumes: `metrics_registry.build_vocabulary` definitions (`metrics_registry.py:600-637`), whose `metrics_registry` card output is NOT changed.
- Produces:
  - `@dataclass(frozen=True) class Measure: key: str; label: str; theme: Literal["results","winloss","risk","time","process"]; meaning: str; unit: Literal["trades","decisive","days","entries"]; kind: Literal["sum","count","rate","average","extreme"]; min_n: int; needs: tuple[str, ...]; sources: frozenset[str]; fn: Callable[[list[dict]], MeasureValue]`.
  - `class MeasureValue(NamedTuple): value: float | None; n: int; have: int | None` (`have` = rows carrying every `needs` field; `None` when `needs` is empty).
  - `MEASURES: dict[str, Measure]`, with the 16 `VOCABULARY_KEYS` (`net_pnl, gross_pnl, fees, trades, wins, losses, win_rate, avg_win, avg_loss, payoff, profit_factor, expectancy, days_traded, profitable_days, avg_true_r, max_drawdown`) plus `expectancy_r, total_r, best_trade, worst_trade, avg_hold_days, profitable_days_pct, max_win_streak, max_loss_streak, current_streak, avg_day_pnl, green_day_pct`.
  - `PF_CAP = 5.0`. `profit_factor` = min(sum of net wins / abs(sum of net losses), 5.0), and 5.0 when there are wins and no losses. Displayed "5+" at the cap.
  - `small_sample(m: Measure, mv: MeasureValue) -> Literal["", "small", "hide"]`: for `rate`/`average` only, counted in `mv.have` when `needs` is set, else `mv.n`. `"hide"` under `m.min_n`, `"small"` under 20.
  - `min_n` is 5 except `payoff` 20 (`metrics_registry._MIN_DECISIVE`, `:44`).
  - Units: `win_rate`, `payoff` → `decisive`; day measures (`days_traded, profitable_days, profitable_days_pct, avg_day_pnl, green_day_pct`) → `days`, counting only days with trades; R measures → `trades` with `needs=("r",)`.
  - Rows are plain dicts with keys `net, gross, fees, result, r, hold_days, day` (from Task 8.5's closed-trades rows).
  - Every value passes `notebook_widgets._num`.

- [ ] **Step 1: Write the failing tests:**
  - `test_vocabulary_parity`: on a 30-trade fixture with fees, for each of the 16 keys except `profit_factor`, `MEASURES[k].fn(rows).value == pytest.approx(build_vocabulary(ctx)[k])`.
  - `test_pf_capped_and_equals_registry_under_cap`: PF 2.3 equals the registry; PF 7.1 gives 5.0; all wins gives 5.0 (the registry gives `None`).
  - `test_pf_parity_with_analytics`: on a ZERO-FEE fixture, PF equals `analytics.get_analytics(uid, conn=conn)["edgeScore"]["components"]["profitFactor"]`. ⚠️ Analytics computes PF from gross `pnl_dollar` (`analytics.py:953-957`), so a fixture with fees would diverge. A second test, `test_pf_with_fees_is_net`, pins the builder on net and names that divergence in its docstring.
  - `test_win_rate_counts_decisive_only`: 6 W, 4 L, 3 BE gives 0.6, `n == 10`.
  - `test_r_measures_count_have`: 47 rows, 9 with `r`, give `have == 9` and `n == 47`.
  - `test_small_sample_hide_and_badge`: `n=3` hides, `n=12` is small, `n=25` is "", and a `sum` is never hidden.
  - `test_streaks`: W W L L L W gives longest win 2, longest loss 3, current 1 win.
  - `test_day_measures_count_only_days_with_trades`.
  - `test_nan_becomes_none`: a row with `net=float('nan')` yields `value is None`, never NaN.
- [ ] **Step 2:** Run `python -m pytest tests/test_measures.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement. Streaks run in day-then-id order. `current_streak` value is signed (+n wins, −n losses).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): shared measure module with per-measure minimums`.

### Task 8.4: The plan module

**Files:**
- Create: `api/services/journal_two/widget_engine/__init__.py`, `api/services/journal_two/widget_engine/plan.py`
- Test: `tests/test_widget_plan.py`

**Interfaces:**
- Plan v1, the one stored shape:
  ```
  {"v": 1, "source": "closed_trades"|"open_positions"|"trading_days",
   "accounts": "all" | {"id": str},
   "range": {"token": RANGE_TOKEN} | {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"},
   "filters": [{"field": str, "op": str, "values": [scalar, ...], "overridable": bool}],
   "measures": [{"key": str}],                     # 1..3
   "split": null | {"by": str, "then": str|null},  # "then" only for view "table"
   "view": {"type": VIEW, "auto": bool},
   "sort": null | {"measure": 0|1|2, "dir": "asc"|"desc", "top": int},
   "compare": null | {"mode": "previous"} | {"mode": "all"} | {"mode": "range", "from": str, "to": str},
   "display": {"title": str, "titleAuto": bool, "subtitle": str, "accent": str, "showN": bool, "target": number|null}}
  ```
  `RANGE_TOKENS = ("today","this_week","last_week","last_7d","last_30d","last_90d","this_month","last_month","this_quarter","last_quarter","ytd","last_12m","all","last_20_trades","last_50_trades","last_100_trades")`. `VIEWS = ("number","compare","table","bar","line","scatter","heat","list","progress")`.
- Produces:
  - `PLAN_VERSION = 1`. `class PlanError(ValueError)` carrying a member sentence. `class PlanTooNew(PlanError)` with the Global Constraints sentence.
  - `upgrade_plan(raw: dict) -> dict`: identity for v1; `v > PLAN_VERSION` raises `PlanTooNew`; a missing `v` raises `PlanError`.
  - `validate_plan(raw: dict, catalog: Catalog) -> dict`: runs `upgrade_plan`, then refuses (with sentences) an unknown source, field, op, measure, view, range token or accent; more than 3 measures; more than one `overridable` filter; a `then` with a view other than `table`; `top` outside 1..40; more than 8 filters or 50 values in one filter; a string over 200 characters; a measure whose `sources` excludes the plan's source; a view the shape cannot show (`catalog.view_allowed(plan)`); a fixed range with `from > to`. The plan is returned with defaults filled and nothing else added.
  - `plan_size_ok(raw) -> bool`: compact JSON at most 16,384 B and depth at most 16 (`notes._json_depth_exceeds`).
  - `resolve_range(rng: dict, today: date) -> ResolvedRange(from_day: str|None, to_day: str, last_n: int|None, label: str)`. Weeks start Monday. `"all"` gives `from_day=None`. `last_N_trades` gives `last_n=N`.
  - `previous_range(r: ResolvedRange) -> ResolvedRange` (same length, immediately before).
  - `summary(plan: dict, catalog: Catalog, count: int | None, unit: str) -> str`, e.g. `"Net P&L, split by setup, for closed trades in the last 90 days, all accounts. 47 trades."`. `default_name(plan, catalog) -> str`, e.g. `"Net P&L by setup, last 90 days"`. These two are the ONE authority; the client shows what the server sent.
  - `plan_hash(plan: dict) -> str` (sha1 of canonical compact JSON, sorted keys).
  - `Catalog` is defined in Task 8.5 (`sources.CATALOG`). This module takes it as a parameter, so it stays pure and imports no SQL.

- [ ] **Step 1: Write the failing tests:**
  - A parametrised `test_refuses(raw, sentence)` with one row per refusal above, each asserting the exact sentence (for example `"Pick up to 3 measures."`, `"Only one filter can be changed from the note."`, `"Top N must be between 1 and 40."`, `"The start date is after the end date."`).
  - `test_too_new_refused_with_reload_sentence`: `{"v": 2, ...}`.
  - `test_v1_round_trips_unchanged`: `validate_plan(p) == p` for a fully specified plan.
  - `test_defaults_range_last_90d`.
  - `test_resolve_range_weekend_this_week`: Saturday 2026-10-24 gives `this_week` 2026-10-19..2026-10-24.
  - `test_last_quarter_and_ytd_labels`.
  - `test_previous_range_same_length`.
  - `test_summary_and_default_name_exact`.
  - `test_plan_size_cap`: a 17 KB plan is refused, and a depth-17 plan is refused.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_plan.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement (pure: no I/O, no clock read except the `today` argument).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): widget plan validator, upgrader and plain-language summary`.

### Task 8.5: Sources, the compiler and the aggregator

**Files:**
- Create: `api/services/journal_two/widget_engine/sources.py`, `compile.py`, `aggregate.py`, `measures.py` (the builder adapter)
- Modify: `tests/test_sample_never_feeds_real_numbers.py` (`GUARDED`, `:392`: add `widget_engine/sources.py`, which reads `j2_notes` for check-ins, guarded with `sample_marker.not_sample_sql`)
- Test: `tests/test_widget_sources.py`, `tests/test_widget_engine_isolation.py`, `tests/test_widget_engine_fuzz.py`

**Interfaces:**
- `Field(key, label, type: "enum"|"text"|"number"|"bool"|"tag"|"day", ops: tuple[str,...], split: bool, sql: str | None, py: Callable | None, bucket: tuple | None, needs_times: bool)`. Ops: enum `in`, `not_in`; text `in`, `contains`; number `eq, gt, gte, lt, lte, between`; bool `is`; tag `has_any`. An SQL field's `sql` is a static fragment written in this file; the plan only chooses its key.
- `Source(key, label, description, unit, fields: dict[str, Field], scan: Callable)`. `CATALOG: Catalog` holds the three sources, `measures.MEASURES` filtered per source, the views and the range tokens. Its `view_allowed(plan)` encodes the auto-pick and the disabled reasons.
- Fields per source (spec §5.3):
  - **closed_trades**: `day`, `hour_et` (date-only rows excluded and counted), `weekday`, `month`, `symbol` (text), `side`, `setup`, `result`, `net`, `gross`, `fees`, `r` (effective R: `r_multiple`, else excursion `true_r`, as `analytics._effective_r_map`, `analytics.py:232`), `risk_dollars` (`abs(entry_price − original_stop) × shares`, `None` for a placeholder stop), `pct_return`, `hold_days`, `hold_bucket` (same day, 1, 2-5, 6-20, 21+), `hold_minutes` (only when neither entry nor exit is date-only; `needs_times=True`), `shares`, `size_quartile` (of `shares × entry_price` over the scanned rows), `regime`, `mistake` (tag over `mistake_tags`), `emotion` (tag over `emotion_tags`), `origin` (manual/CSV/broker from `source`), `account`, `had_stop`, `mfe_r`, `mae_r`, `exit_efficiency` (from `j2_trade_excursions`), `adherence_pct` (from `j2_trade_adherence`), `plan_linked` (row in `j2_trade_plan_links`), `r_bucket` (≤−2, −2..−1, −1..0, 0..1, 1..2, 2..3, >3). Excursion, adherence and plan-link rows join by `trade_refs.trade_ref_for_row`, filtered `user_id = ?` on each child table.
  - **open_positions** (`closed_at IS NULL`): `symbol`, `side`, `setup`, `days_open` (from `trading_days.entry_day_et`; `entry_estimated` rows excluded and counted), `unrealised` (from the stored `broker_price` only, else `None`), `risk_dollars` and `risk_pct_account` (with `accounts.own_account_size`; "No stop set" for a placeholder), `pct_account`, `account`.
  - **trading_days**: one row per `trading_days.sessions(lo, hi)` day: `day`, `weekday`, `day_net` (equity net plus closed option strategies through `calendar._fetch_strategies_in_window` and `calendar._union_strategy_aggregates`, `calendar.py:456`, `:530`; label "Day net P&L (incl. options)"), `trade_count`, `day_win_rate`, `best_trade`, `worst_trade`, `mood`, `focus` (from `j2_note_checkins` joined to `j2_notes` with `deleted_at IS NULL`, not sample, latest by the note's `updated_at`), `had_day_note` (a `j2_day_notes` row). Routine and tracker columns are wave 9.
- `compile.compile_scan(source: Source, plan: dict, settings: dict, rng: ResolvedRange, user_id: str) -> tuple[str, list]`:
  - `SELECT <static column list> FROM j2_trades WHERE user_id = ? <ANALYTICS_INCLUDED_SQL> [AND account_id = ?] <filter fragments> AND <_DAY> BETWEEN ? AND ? ORDER BY <_DAY> DESC, id DESC LIMIT 5001`.
  - `last_N_trades` uses `LIMIT N` (N ≤ 100).
  - Tag filters: `EXISTS (SELECT 1 FROM json_each(COALESCE(t.<col>,'[]')) WHERE value IN (?,…))`. `contains`: `LIKE ? ESCAPE '\'` with `%` and `_` escaped.
  - Python-only fields (`r`, `size_quartile`, `hold_minutes`…) filter after the scan.
  - Every value is a `?` parameter. Identifiers come only from `Field.sql`.
- `aggregate.evaluate(rows: list[dict], plan: dict, catalog) -> Result`. `Result(groups: list[Group], total: GroupValues, coverage: list[Coverage], footnotes: list[str])`. Grouping keys are compared as Python strings in a `dict`. A label is `_clip(str(key), 60)`. Sort and top N apply after grouping. `Coverage(have, total, hint)`, where `hint` is `"Add stops to see R for more trades"` when `have/total < 0.5` for a `needs=("r",)` measure.
- `run_flagged_list(...)`: List views include flagged trades labelled `"Flagged"`. Aggregates never include them.

- [ ] **Step 1: Write the failing tests** (`tests/test_widget_sources.py`, seeded sqlite through `db.ensure_schema`):
  - `test_closed_trades_net_is_pnl_minus_fees`.
  - `test_flagged_excluded_from_aggregate_listed_in_list_view`.
  - `test_hour_split_excludes_date_only_and_counts_them`: the footnote reads `"3 trades have no time and are not in this split."`.
  - `test_hold_minutes_needs_times_sentence`: all date-only gives the footnote `"Hold time in minutes needs entry and exit times; your trades have dates only"`.
  - `test_placeholder_stop_risk_is_none_and_had_stop_false`.
  - `test_effective_r_falls_back_to_true_r`.
  - `test_positions_entry_estimated_excluded_from_days_open_and_counted`.
  - `test_positions_unrealised_none_without_broker_mark`.
  - `test_trading_days_includes_sessions_without_trades`.
  - `test_trading_days_day_net_includes_options_and_matches_calendar`: for one month, `day_net` equals `calendar.get_calendar(uid, view="month", year=…, month=…)["days"][i]["pnlDollar"]` on the same day.
  - `test_checkin_latest_by_note_updated_at_and_trashed_gone`.
  - `test_scan_is_descending_limit_5001_and_caps`: 5,200 trades give 5,000 rows used, `capped=True`, and `earliest_day` equal to the 5,000th newest.
  - `test_tag_filter_matches_exact_member_text`.
  - `test_group_labels_clipped_at_60`.
- [ ] **Step 2: Write the isolation rail** `tests/test_widget_engine_isolation.py`. Two members seeded with overlapping symbols, setups and account ids. For each source and each of `split`, `filter`, `accounts={"id": <other member's account>}`: member A's result has no row, count or label from B, and an account id of B's gives the same result as `"all"` for A's own rows (absent, not B's).
- [ ] **Step 3: Write the fuzz rail** `tests/test_widget_engine_fuzz.py`. A corpus of filter values containing `'`, `"`, `--`, `;`, `$.`, `%`, `_`, `\`, `__proto__`, emoji, and 200-character strings. For each, the compiled SQL text contains none of the strings, the parameter list contains each exactly as given, and running the scan on an empty seeded db raises nothing.
- [ ] **Step 4:** Run `python -m pytest tests/test_widget_sources.py tests/test_widget_engine_isolation.py tests/test_widget_engine_fuzz.py tests/test_sample_never_feeds_real_numbers.py -q`. Expected: FAIL.
- [ ] **Step 5:** Implement.
- [ ] **Step 6:** Run the same command. Expected: PASS.
- [ ] **Step 7:** Commit: `feat(notebook): widget engine sources, whitelist compiler and aggregator`.

### Task 8.6: The `builtWidget` server kind and its payload

**Files:**
- Modify: `api/services/journal_two/notebook_widgets.py` (`ACCOUNT_KINDS` `:61`, `KIND_TITLE` `:71`, `cap_payload` `:368`, `source_detail` `:2017`)
- Create: `api/services/journal_two/widget_engine/payload.py`
- Modify: `api/routers/notebook_widgets.py` (`get_widget`: `builtWidget` answers the 404 body)
- Modify: `tests/test_journal_styles_compose.py` (`:623`, `len(client) == 15` becomes 16 once Task 8.13 adds the client row; this task adds the server row and marks that test `xfail(strict=True)` with the reason "client row lands in Task 8.13")
- Test: `tests/test_built_widget_payload.py`, `tests/test_notebook_widgets_service.py`, `tests/test_notebook_widgets_router.py`

**Interfaces:**
- `ACCOUNT_KINDS` gains `"builtWidget"`. `KIND_TITLE["builtWidget"] = "Widget"`.
- `cap_payload(payload, kind=None, list_key=None, trim_from="end")`. An explicit `list_key` wins over `LIST_KEY`. `trim_from="start"` drops the oldest items first. Existing callers are unchanged.
- `source_detail("builtWidget", p)`: `"Your closed trades in the Journal."`, `"Your open positions in the Journal."` or `"Your trading days in the Journal (day P&L incl. options)."`, by `p["sourceKey"]`.
- `payload.build_payload(*, result, plan, settings, def_id, def_rev, latest_rev, rng, scan, sample: bool, now) -> dict`. Its keys are fixed:
  - `asOf`, `source` (`broker|manual|mixed` by `notebook_widgets._origin` semantics), `sourceKey`, `view`, `title`, `summary`, `defId`, `defRev`, `latestRev`, `def` (the plan, or omitted and `defRef: {id, rev}` when over 4,096 B), `scopeLabel`, `rangeLabel`, `range`, `accountId`, `filter`, `count`, `capped`, `sample`, `notice`, `truncated`.
  - `measures`: `[{label, unit, kind, fmt}]`.
  - `value` / `compare`: `{v1,v2,v3,n1,n2,n3,s1,s2,s3,n}`, plus `compareLabel`.
  - `rows`: `[{label, label2, v1,v2,v3, n1,n2,n3, s1,s2,s3, n}]`.
  - `series`: the same row shape, ordered oldest first, one row per time bucket (a Line view splits by a time field only, so no nested series exists).
  - `points`: `[{x, y, d, r}]`, where `d` is the exit day and `r` is win, loss or be.
  - `cells`: `[{label, v1, n1, s1}]`.
  - `coverage`: `[{have, total, hint}]`.
  - `empty`: the §5.9 sentence when `count == 0`.
  - Trade ids never appear.
- `cap_payload` is called with `list_key` by view: `table|bar|list|number` use `rows` from the end; `line` uses `series` from the start; `scatter` uses `points` from the start; `heat` uses `cells` from the start.
- `rangeLabel` over the cap: `"From <Mon D>, newest 5,000 trades"`, and `notice` is `"Based on your newest 5,000 trades. Narrow the range to include all trades."`.
- Path-dependent measures (`max_drawdown`, streaks) over a capped scan carry the footnote `"within your newest 5,000 trades"`.

- [ ] **Step 1: Write the failing tests:**
  - `test_payload_echoes_def_and_settings`.
  - `test_def_over_4kb_becomes_defref`.
  - `test_line_trimmed_from_start`: a 400-bucket series over the cap keeps the newest buckets and sets `truncated`.
  - `test_rows_trimmed_from_end_after_sort`.
  - `test_no_trade_id_anywhere`: `json.dumps(payload)` does not contain any seeded trade id.
  - `test_nan_in_result_is_null`.
  - `test_empty_sentence_per_source`: the exact §5.9 sentences for the three sources.
  - `test_capped_labels`.
  - `test_get_route_404_for_builtWidget`: with W8 on, `GET /api/j2/notebook-widgets/builtWidget` gives 404 with the same body as an unknown kind.
  - `test_cap_payload_existing_kinds_unchanged`: the existing cap tests stay green.
- [ ] **Step 2:** Run `python -m pytest tests/test_built_widget_payload.py tests/test_notebook_widgets_service.py tests/test_notebook_widgets_router.py tests/test_journal_styles_compose.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS (the compose test xfails strictly).
- [ ] **Step 5:** Commit: `feat(notebook): builtWidget server kind and its fixed-key payload`.

### Task 8.7: Run: admission, deadline, cache and counters

**Files:**
- Create: `api/services/journal_two/widget_engine/run.py`
- Modify: `api/services/journal_two/notebook_widgets.py` (`BoundedPool` `:94`: a `reserve` argument; `_POOL` `:129` built with `reserve=2`)
- Test: `tests/test_widget_run.py`, `tests/test_notebook_widgets_service.py` (the pool tests)

**Interfaces:**
- `BoundedPool(workers, name, reserve=0)`: `try_submit` acquires a second non-blocking semaphore of size `workers - reserve` before `_slots`. `admit_inline() -> bool` acquires `_slots` only, and `release_inline()` releases it. `journal_styles._slot_pool()` stays `reserve=0`.
- Constants: `BUILDER_MAX = 4`, `PREVIEW_MAX = 2`, `MEMBER_MAX = 2`, `DEADLINE_S = 1.5`, `CACHE_TTL_S = 300`, `CACHE_MAX = 2000`, `DAILY_RUN_CAP = 1000`, `FLUSH_EVERY_S = 60`.
- Sentences: `BUSY = "Busy right now. Try again in a moment."` and `TOO_LONG = "This is a lot of data to add up. Try a shorter range or fewer splits."`.
- `class EngineBusy(Exception)`, `class EngineTooLong(Exception)`, `class DailyCapReached(Exception)`, `class Superseded(Exception)`.
- `admit(user_id: str, lane: Literal["run","drill","preview","example"])`: a context manager over `_POOL.admit_inline()`, a builder semaphore, a preview semaphore (preview and example lanes) and a per-member count. Raises `EngineBusy` at once when any is full. Releases in `finally`.
- `deadline(conn, seconds=DEADLINE_S, *, superseded: Callable[[], bool] = lambda: False)`: sets `conn.set_progress_handler(cb, 1000)` and clears it on exit. `cb` returns 1 past the deadline or when `superseded()` is true. `sqlite3.OperationalError("interrupted")` becomes `EngineTooLong` or `Superseded`.
- `data_stamp(conn, user_id, source_key) -> str`. ⚠️ `j2_trades` has no `updated_at`, so the closed-trades stamp is `COUNT(*), MAX(rowid), TOTAL(pnl_dollar), TOTAL(fees), TOTAL(COALESCE(analytics_excluded,0)), TOTAL(LENGTH(COALESCE(setup,''))+LENGTH(COALESCE(mistake_tags,''))+LENGTH(COALESCE(emotion_tags,'')))` for the member, plus `MAX(computed_at)` of `j2_trade_excursions` and `MAX(updated_at)` of `j2_trade_adherence`. Open positions use `MAX(updated_at)` and `COUNT(*)` over `j2_positions`. Trading days use the trades stamp plus `j2_option_strategies MAX(updated_at)` and `j2_note_checkins COUNT(*), MAX(created_at)`. Known blind spot, documented in the docstring: a same-length relabel shows after the 300 s TTL at worst.
- `run_plan(user_id: str, plan: dict, settings: dict, *, lane, def_id=None, def_rev=None, latest_rev=None, now=None, sample: bool = False) -> dict`: validate, merge settings (an overridable filter, `range`, `accountId`; a foreign `accountId` is dropped with the notice `"That account is no longer in your Journal; showing all accounts."`), compute the cache key, then `SingleFlight.run_here` on a module `SingleFlight(waiters=8, name="widget run")`, `admit`, `deadline`, scan, `aggregate.evaluate`, `payload.build_payload`. `sample=True` scans `sample_book.json` (Task 8.10) instead of the database, and is never cached across members.
- `count_run(user_id)`: in memory, flushed with `daily_counters.take(day, [Charge("notebook_widget_runs", user_id, n, None)])` when 60 s have passed since that member's last flush. `daily_cap_reached(user_id) -> bool` = `daily_counters.value(day, …) + pending >= 1000`. Lane `run` only; a cache hit is not counted.
- `preview_generation(user_id) -> int`: each preview increments the member's counter, and an older preview's `superseded()` sees a newer number.

- [ ] **Step 1: Write the failing tests:**
  - `test_phase1_holds_at_most_6`: 6 phase-1 `try_submit`s then a 7th gives `None`, while `admit("u","run")` still succeeds twice.
  - `test_builder_max_4_and_preview_max_2`.
  - `test_member_max_2`.
  - `test_admit_releases_on_error`.
  - `test_busy_is_immediate`: a full gate raises `EngineBusy` in under 50 ms.
  - `test_deadline_interrupts_and_maps_to_too_long`: a recursive CTE counting to 10^9 raises `EngineTooLong` within 2 s, and the connection's handler is cleared after.
  - `test_superseded_preview_interrupts`.
  - `test_cache_hit_same_stamp_and_bust_on_new_trade`.
  - `test_cache_never_shared_across_members_same_plan_hash`.
  - `test_cache_bust_on_excluded_toggle_and_setup_change`.
  - `test_daily_counter_flush_at_most_once_a_minute`: 30 runs inside a minute make one `daily_counters.take` call (spy).
  - `test_daily_cap_reached_raises`.
  - `test_foreign_account_id_is_absent_with_notice`.
  - `test_cache_hit_not_counted`.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_run.py tests/test_notebook_widgets_service.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement. The connection comes from `auth_db.get_connection()`, which clears the progress handler on reuse (`auth_db.py:624`); the context manager clears it anyway.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Measure the 50,000-trade latency (spec §5.7): `test_run_50k_trades_under_budget` seeds 50,000 trades in a temp db and asserts one uncached run of a three-measure split-by-setup plan finishes under 1.5 s of SQL plus under 1.0 s of Python. It skips (with its reason, shown by `-ra`) unless `UCT_WIDGET_50K=1`, because seeding 50,000 rows is slow. Run it here with `UCT_WIDGET_50K=1 python -m pytest tests/test_widget_run.py -q -k 50k` and record the reading in the commit message; a skipped run is not a reading.
- [ ] **Step 6:** Commit: `feat(notebook): widget run admission, deadline, cache and daily counter (50k: <reading>)`.

### Task 8.8: The widget store, revisions and purge

**Files:**
- Modify: `api/services/journal_two/db.py` (`_PHASE_2_ALTERS`, `:1645`: two tables and indexes)
- Create: `api/services/journal_two/widget_definitions.py`
- Modify: `api/services/journal_two/account_purge.py` (`_DIRECT_USER_TABLES`, `:32`)
- Modify: `docs/account-deletion-manifest.md` (regenerated)
- Test: `tests/test_widget_definitions.py`, `tests/test_account_deletion_manifest.py`, `tests/test_journal_two_account_purge.py`, `tests/test_account_tombstones.py`

**Interfaces:**
- Tables:
  - `j2_widget_definitions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, plan_json TEXT NOT NULL, plan_version INTEGER NOT NULL, rev INTEGER NOT NULL, placed_rev INTEGER NOT NULL, last_answer TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, deleted_at TEXT, source_gallery_id TEXT, source_version INTEGER)`, with index `(user_id, archived_at, deleted_at)`. `last_answer` holds `"update_all"` or `"save_new"`.
  - `j2_widget_definition_revs (user_id TEXT NOT NULL, definition_id TEXT NOT NULL, rev INTEGER NOT NULL, plan_json TEXT NOT NULL, summary TEXT NOT NULL, saved_at TEXT NOT NULL, named TEXT, PRIMARY KEY (definition_id, rev))`, with index `(user_id)`.
- Produces (every read and write is `WHERE id = ? AND user_id = ?`; ids are `uuid4`):
  - `COUNT_CAP = 100`, `REVS_KEPT = 50`, `COALESCE_S = 60`, `RECENTLY_DELETED_DAYS = 30`.
  - `create(user_id, name, plan) -> dict`: refuses over the cap with `"You have 100 widgets. Archive one in My tools to make room."`.
  - `get(user_id, def_id) -> dict | None`: `{id, name, plan, rev, placedRev, archived, usedIn, lastAnswer, summary}`. `usedIn` is counted by Task 8.9 and is 0 until then. A plan newer than the server knows is returned with `tooNew: True` and its stored summary.
  - `update(user_id, def_id, *, if_match: int, name=None, plan=None, apply: Literal["update_all","save_new","only"]) -> dict`: a `rev != if_match` raises `Conflict` (409 `"Changed in another tab. Reload to see the newer version."`). `update_all` sets `placed_rev = rev`. `save_new` creates a new widget from the plan and leaves this one unchanged. A save within 60 s of the latest unnamed revision rewrites that revision in place (same rev). Revisions beyond the newest 50 unnamed are deleted.
  - `list_defs(user_id, *, archived=False, deleted=False) -> list[dict]`: also hard-deletes this member's rows deleted more than 30 days ago.
  - `revs(user_id, def_id) -> list[dict]`, `name_rev(user_id, def_id, rev, name)`, `restore_rev(user_id, def_id, rev, *, if_match) -> dict` (saves the old plan as a new revision).
  - `archive(...)`, `unarchive(...)`, `soft_delete(user_id, def_id, *, typed_name: str)` (only from archived, and only when `typed_name == name`), `undelete(...)`.
  - `resolve_for_run(user_id, def_id, def_rev) -> tuple[dict | None, int | None, int | None]`: `(plan to run, rev ran, latest_rev)`. It runs `max(def_rev, placed_rev)`, gives `None` for a foreign or deleted id, and returns revisions by number.
  - Plans are stored as the member saved them, never rewritten in bulk.
- Purge: add `"j2_widget_definitions"` and `"j2_widget_definition_revs"` to `_DIRECT_USER_TABLES`, then run `python tools/account_deletion_manifest.py --write`.

- [ ] **Step 1: Write the failing tests:**
  - `test_create_get_update_owned_only`: member B's get, update and archive of A's id give `None` or `NotFound`.
  - `test_if_match_conflict`.
  - `test_update_all_sets_placed_rev_save_new_creates_copy`.
  - `test_coalesce_within_60s_and_new_rev_after`.
  - `test_keeps_50_unnamed_plus_named`.
  - `test_restore_saves_new_rev`.
  - `test_count_cap_sentence`.
  - `test_delete_needs_archive_and_typed_name`.
  - `test_recently_deleted_purged_after_30_days`.
  - `test_too_new_plan_get_flags_and_refuses_update`.
  - `test_resolve_for_run_prefers_placed_rev`.
  - The derived manifest rail and the purge rail go green only with both tables listed.
  - `test_tombstone_replay_removes_both_tables` (in `tests/test_account_tombstones.py`): seed both tables for a member, call `account_tombstones.replay_on_db(conn, [uid])`, and the member's rows are gone while a control member's stay.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_definitions.py tests/test_account_deletion_manifest.py tests/test_journal_two_account_purge.py tests/test_account_tombstones.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement, then regenerate the manifest.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): stored widgets with revisions, If-Match and account purge`.

### Task 8.9: The "used in" projection

**Files:**
- Modify: `api/services/journal_two/db.py` (`_PHASE_2_ALTERS`: `j2_tool_uses`)
- Modify: `api/services/journal_two/notes.py` (`_sync_note_sidecars` `:408`, beside the check-ins block `:505-520`; `purge_expired_deleted_notes` `:4485`)
- Modify: `api/services/journal_two/widget_definitions.py` (`usedIn` and `used_in_notes`)
- Modify: `api/services/journal_two/account_purge.py`, `docs/account-deletion-manifest.md`, `tests/test_sample_never_feeds_real_numbers.py` (`GUARDED`: `widget_definitions.py` joins `j2_notes`)
- Test: `tests/test_tool_uses_projection.py`, the three purge and manifest test files

**Interfaces:**
- `j2_tool_uses (user_id TEXT NOT NULL, note_id TEXT NOT NULL, kind TEXT NOT NULL, tool_id TEXT NOT NULL, rev INTEGER)`, with indexes `(user_id, kind, tool_id)` and `(note_id)`. A rebuildable projection, never edited directly.
- In the sidecar walk, a `widgetEmbed` with `widgetId == "builtWidget"` and a string `params.defId` adds `(user_id, note_id, "widget", defId, defRev)`. Delete and insert per note, in the same transaction, like `j2_note_checkins`. Wave 9 adds `routine` and `tracker`.
- `used_in_notes(user_id, def_id) -> list[{noteId, title, updatedAt}]` joins `j2_notes` with `deleted_at IS NULL` and `sample_marker.not_sample_sql("n")`. `get()`'s `usedIn` is that count (distinct notes).
- Purge lists `"j2_tool_uses"`.

- [ ] **Step 1: Write the failing tests:**
  - `test_note_save_records_built_widget_use`.
  - `test_two_in_one_note_counts_one_note`.
  - `test_removing_widget_clears_row`.
  - `test_trashed_note_not_counted`.
  - `test_hard_delete_sweep_removes_rows`.
  - `test_foreign_def_id_in_my_note_not_counted_for_owner`: A's note naming B's id adds nothing to B's count.
  - The purge and manifest rails.
- [ ] **Step 2:** Run `python -m pytest tests/test_tool_uses_projection.py tests/test_account_deletion_manifest.py tests/test_journal_two_account_purge.py tests/test_sample_never_feeds_real_numbers.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement and regenerate the manifest.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): used-in-notes projection for built widgets`.

### Task 8.10: Starter examples and the sample book

**Files:**
- Create: `api/services/journal_two/widget_engine/shelf.json`, `shelf.py`, `sample_book.json`
- Create: `tools/gen_widget_sample_book.py`
- Test: `tests/test_widget_shelf.py`, `tests/test_widget_sample_book.py`

**Interfaces:**
- `shelf.json`: `{"version": 1, "examples": [{"id", "name", "description", "keywords": [...], "plan": {...}}]}`, served server-side only. Wave 8 holds the §8 rows its three sources and the measure module can express: Equity curve, Daily P&L bars, R equity curve, Win rate, Profit factor, Expectancy, Average win vs average loss, Performance by symbol, Max drawdown, P&L by time of day, P&L by weekday, P&L by hold time, R-multiple distribution, MAE vs MFE scatter, Best and worst trades, Recent trades, Accounts side by side, Long vs short, Exit quality, Month in review, Weekly scorecard, Fees drag, Loss streak.
  - Synonyms in `keywords`: win rate gets `hit rate, batting average, win %`; profit factor `PF`; expectancy `edge, EV, avg R`; max drawdown `DD, drawdown`; weekly scorecard `report card, review`.
  - Ids are namespaced `shelf:<slug>`. Wave 10 turns this file into immutable revision files with a hash rail.
- `shelf.py`: `examples() -> list[dict]`, where every plan passes `validate_plan` at import (a broken example fails the import, not a member). `example(shelf_id) -> dict | None`.
- `sample_book.json`: deterministic synthetic data from `python tools/gen_widget_sample_book.py --seed 20261024`: 120 closed trades over 9 months across 2 accounts, 6 setups, mistake and emotion tags, a mix of date-only and timed trades, 8 open positions (one placeholder stop, one `entry_estimated`), and the trading-days rows. Symbols come from a fixed list of well-known tickers. No member data.
- `run.sample_rows(source_key) -> list[dict]` reads it, shaped like the source scan's rows.
- `run.wants_sample(conn, user_id) -> bool`: `SELECT COUNT(*) FROM j2_trades WHERE user_id = ?` below 5.
- `run.run_examples(user_id, ids: list[str]) -> {"sample": bool, "cards": {id: payload}}`: at most 8 ids, one scan per distinct source over the member's rows (or the sample book), every card evaluated over that row set, cached per member for 300 s, counted as one preview.

- [ ] **Step 1: Write the failing tests:**
  - `test_every_example_validates`.
  - `test_ids_namespaced_and_unique`.
  - `test_synonyms_present` (the five lists above).
  - `test_sample_book_regenerates_identically`: run the generator into a temp file and compare bytes.
  - `test_sample_book_has_no_real_member_ids`: no value looks like a uuid from a seeded member.
  - `test_examples_one_scan_per_source`: a spy on `compile_scan` sees 2 calls for 8 cards over 2 sources.
  - `test_examples_use_sample_under_5_trades_and_label`: `sample is True`.
  - `test_examples_switch_to_real_at_5`.
  - `test_examples_more_than_8_refused`.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_shelf.py tests/test_widget_sample_book.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement, run the generator and commit its output.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): starter widget examples and the bundled sample book`.

### Task 8.11: The router

**Files:**
- Create: `api/routers/notebook_widget_definitions.py`
- Modify: `api/main.py` (`include_router` beside `notebook_widgets_router`, `:10278`)
- Test: `tests/test_widget_definitions_router.py`, `tests/test_user_definitions_auth.py`

**Interfaces:**
- Prefix `/api/j2/widget-definitions`. Every route 404s (the `public.not_found()` body) when `notebook_widgets_wave_on(8)` is false, read per request. Its own `require_paid` answers 402 `"Built widgets require a paid plan"`. Bodies are at most 32 KB. Every 200 carries `Cache-Control: no-store`. Errors are `{"detail": {"code": str, "message": str}}`, with these codes: `busy` (503), `too_long` (503), `rate` (429), `rate_preview` (429, `"Pausing the preview for a moment; your changes are kept."`), `daily_cap` (429, `"You have refreshed widgets a lot today. Snapshots stay; refreshing resumes tomorrow."`), `count_cap` (409), `conflict` (409), `too_new` (409), `invalid` (400, the `PlanError` sentence), `superseded` (409).
- Routes:
  - `POST /run` `{defId?, defRev?, def?, settings}`: a `defId` that `resolve_for_run` finds runs it. Otherwise the frozen `def` runs and the payload's `notice` is `"Running from the saved copy in this note."`. A `shelf:` id runs the shelf example. Lane `run`, scope `notebook-widgets` at 60/minute, daily cap.
  - `POST /preview` `{plan, settings}`: lane `preview`, scope `notebook-widget-preview` at 120/minute, superseding. Answers `sample` when `wants_sample`. The payload adds `defaultName`.
  - `POST /examples` `{ids: [...≤8]}`: preview scope, counted once.
  - `POST /drill` `{defId?, def?, defRev?, settings, cell}`: `cell` is `{}` (all rows), `{label}`, `{label, label2}` or `{d, x, y}` (scatter). It answers `{rows: [{id, symbol, side, day, net, r, setup, flagged}] (≤40), more: int, live: bool, note}` for trades, `{day, net, trades}` for days and `{id, symbol, side, ...}` for positions. A group matches when `_clip(key, 60) == cell.label`. `note` is `"Live data; the snapshot was taken on <Mon D>"` when the live count differs from the request's `snapshotCount`. Scope `notebook-widgets`.
  - `GET /vocabulary`: without `field`, the static catalog (sources, fields with labels, types, ops and split flags, measures with label, theme, meaning, unit, kind and needs, views, range tokens and labels). With `field=<key>` (whitelisted), the member's own values, at most 200: setups from the accounts' setup lists plus those used, tags used, symbols traded, accounts as `{id, name}`.
  - `GET /shelf`: `shelf.examples()` (name, description, keywords, plan, id).
  - CRUD: `GET ""`, `POST ""`, `GET /{id}`, `PUT /{id}` (header `If-Match: <rev>` required; body `{name?, plan?, apply}`), `POST /{id}/archive`, `POST /{id}/unarchive`, `POST /{id}/delete` `{typedName}`, `POST /{id}/undelete`, `GET /{id}/used-in`, `GET /{id}/revs`, `POST /{id}/revs/{rev}/name`, `POST /{id}/revs/{rev}/restore` (with `If-Match`).
  - Every route is a sync `def`.

- [ ] **Step 1: Write the failing tests:**
  - `test_all_routes_404_when_w8_off` (enumerated from `router.routes`, with a non-vacuity count).
  - `test_flag_read_per_request`.
  - `test_unpaid_402_own_sentence`.
  - `test_run_saved_and_frozen_and_shelf`.
  - `test_run_foreign_def_id_runs_frozen_with_notice`.
  - `test_preview_rate_120_scope_separate_from_run_60`.
  - `test_examples_counts_one_preview`.
  - `test_drill_40_and_more`.
  - `test_drill_live_note_when_count_differs`.
  - `test_drill_never_returns_other_members_trades`.
  - `test_vocabulary_whitelist_refuses_unknown_field`.
  - `test_put_requires_if_match_and_409_on_stale`.
  - `test_too_new_409_code`.
  - `test_busy_503_code`.
  - `test_bodies_over_32kb_refused`.
  - `test_filter_values_never_in_query_string`: every member-value route is a POST, or a GET whose only parameter is `field`.
  - `tests/test_user_definitions_auth.py` passes with the new router's sentence distinct.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_definitions_router.py tests/test_user_definitions_auth.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): /api/j2/widget-definitions routes (dark, wave 8)`.

### Task 8.12: Public pages and the archive image

**Files:**
- Modify: `api/services/journal_two/public_note_payload.py` (`MARKET_DATA_VENDORS` near `:301`, `EMBED_PARAM_KEYS` and `EMBED_ROW_KEYS` near `:486-566`)
- Test: `tests/test_public_note_payload.py`, `tests/test_widget_engine_isolation.py` (the public modes)

**Interfaces:**
- `("widgetEmbed", "builtWidget"): "member-optin"`.
- `EMBED_PARAM_KEYS["builtWidget"] = ("asOf","source","title","view","measures","value","compare","compareLabel","rows","series","points","cells","count","rangeLabel","capped","notice","truncated","tooLarge","empty","share")`. Never `def`, `defRef`, `defId`, `defRev`, `latestRev`, `summary`, `scopeLabel`, `filter`, `accountId`, `range`, `coverage` or `sample`.
- `EMBED_ROW_KEYS["builtWidget"]`: `measures: ("label","unit","kind","fmt")`; `value` and `compare`: `("v1","v2","v3","n1","n2","n3","s1","s2","s3","n")`; `rows` and `series`: `("label","label2","v1","v2","v3","n1","n2","n3","s1","s2","s3","n")`; `points: ("x","y","d","r")`; `cells: ("label","v1","n1","s1")`.

- [ ] **Step 1: Write the failing tests:**
  - `test_built_neutral_without_share` (share, publish, gallery and example modes).
  - `test_built_shown_with_share_has_no_def_summary_or_filter_values`: plant canary strings in the plan's filter values, summary and account name, and assert none appear in the output JSON.
  - `test_built_gallery_always_neutral`.
  - `test_share_string_true_is_neutral`.
  - The existing derived id rail (every registry id has a row) is extended in Task 8.13.
  - In `test_widget_engine_isolation.py`: a note body naming another member's `defId` reduces to the neutral line in every public mode and makes no database read (spy `get_connection`).
- [ ] **Step 2:** Run `python -m pytest tests/test_public_note_payload.py tests/test_widget_engine_isolation.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): built widgets neutral on public pages unless shared, result only`.

### Task 8.13: The client kind, the refresh merge and the Change fields

**Files:**
- Modify: `app/src/widgets/registry.js` (`builtWidget: snapshotManifest(...)` after `myEarningsReactions`)
- Modify: `app/src/pages/journal-2-0/lib/notebookWidgets.js` (`WIDGET_KINDS` row)
- Modify: `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx` (`snapshotWidgetItems` `:611` skips `kind.built`)
- Create: `app/src/pages/journal-2-0/lib/builtWidgets.js`
- Modify: `app/src/pages/journal-2-0/components/notebook/widgets/SnapshotFrame.jsx` (`CHANGE_FIELDS` `:197`, `changeKeysOf` `:208`, `useSnapshotFrame` `:223`: refresh and change branch, `title` `:281`, `onSavePreset` `:296`)
- Modify: `tests/test_journal_styles_compose.py` (remove the Task 8.6 xfail; `len(client) == 16`)
- Test: `lib/builtWidgets.test.js`, `widgets/SnapshotFrame.built.test.jsx`, `src/widgets/registry.test.js`, `SlashMenu.items.test.jsx`, `tests/test_journal_styles_compose.py`, `tests/test_public_note_payload.py`

**Interfaces:**
- Registry: `builtWidget: snapshotManifest('Widget', 'defId defRev:n latestRev:n def:j defRef:j title summary view sourceKey measures:j value:j compare:j compareLabel rows:j series:j points:j cells:j coverage:j count:n scopeLabel rangeLabel range accountId filter:j capped:b sample:b notice truncated:n', (p, l) => \`[widget: ${p?.title || 'widget'}${_asOfDay(p)}]\`)`. Plain text never carries a number.
- `WIDGET_KINDS` row: `{ id: 'builtWidget', wave: 8, group: 'review', title: 'Widget', built: 1, account: true, description: 'A widget you built' }`.
- `lib/builtWidgets.js` (lazy; only `SnapshotFrame`, the builder, My tools and the `/` Mine rows import it):
  - `BUILT_KIND = 'builtWidget'`, `DEFS_URL = '/api/j2/widget-definitions'`.
  - `postJson(path, body) -> Promise<{ok, data} | {ok:false, code, message}>`: never throws; `code: 'offline'` with no request when offline; `'unavailable'` on 404. Each `fetch` names `method: 'POST'` literally (the door rail reads methods, `lib/offline/doorEnumeration.test.js`).
  - `runBuilt(params) -> Promise<result>`: posts `{defId, defRev, def, settings: viewerSettingsOf(params)}`.
  - `builtRefreshParams(old, payload) -> params`: `{...payload, share: old.share === true}`. The server echoed every key, so nothing is copied from `old` except `share`.
  - `viewerSettingsOf(params) -> {range?, accountId?, filter?}`.
  - `BUILT_CHANGE_KEYS = ['range', 'accountId', 'filter']`.
  - `loadAccounts() -> Promise<[{id,name}]>` (`GET /api/j2/accounts`), `loadVocabulary(field)`, `loadCatalog()`.
  - `failureText(code) -> string`: the §5.10 copy for `busy, too_long, rate, rate_preview, daily_cap, count_cap, conflict, too_new, offline, unavailable` (`'unavailable'` → `"Not available right now."`).
- `SnapshotFrame`:
  - `title` is `params.title || meta?.title || kind`.
  - `onSavePreset` is `undefined` for `builtWidget`.
  - `changeKeysOf('builtWidget')` returns `BUILT_CHANGE_KEYS`.
  - `CHANGE_FIELDS` gains `range` (a select of the range tokens plus "Fixed dates", which reveals `from`/`to`), `accountId` (a select filled by `loadAccounts()` when Change opens: "All my accounts" plus each account) and `filter` (enabled only when `params.def` marks a filter `overridable`, its options from `loadVocabulary(field)`).
  - For `builtWidget`, `onRefresh` and `onChange` call `runBuilt` and write `builtRefreshParams` through the same `writeThrough` ref, so a share switch made while the request ran wins.

- [ ] **Step 1: Write the failing tests:**
  - `builtRefreshParams_keeps_current_share_and_server_echo`: old `share: true`, payload without `share`, gives `share: true` and every payload key.
  - `refresh_after_share_switched_off_writes_false`: start a refresh, switch share off, resolve, and the written params have `share: false`.
  - `change_fields_for_built`: `range`, `accountId` and `filter` render; `filter` is disabled without an `overridable` filter.
  - `run_offline_makes_no_request`.
  - `failureText_exact_copy` (one assertion per code, exact strings from spec §5.10).
  - `title_from_params`.
  - `no_preset_action_for_built`.
  - `slash_snapshot_items_skip_built`.
  - In `registry.test.js`: `builtWidget` is `captureOnly`, in no menu, and its plain text for fixture params is `[widget: Net P&L by setup · as of Oct 24]` with no digit from a figure.
  - `tests/test_journal_styles_compose.py`: `len(client) == 16` and `KIND_TITLE == client`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/lib/builtWidgets.test.js src/pages/journal-2-0/components/notebook/widgets/SnapshotFrame src/widgets/registry.test.js src/pages/journal-2-0/components/notebook/SlashMenu.items.test.jsx` and `python -m pytest tests/test_journal_styles_compose.py tests/test_public_note_payload.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both commands. Expected: PASS.
- [ ] **Step 5:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `feat(notebook): builtWidget client kind, server-echo refresh and viewer settings`.

### Task 8.14: The embed, its views, drill-down and "How this is made"

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/widgets/BuiltWidgetEmbed.jsx` + `.module.css`
- Create: `app/src/pages/journal-2-0/components/notebook/widgets/builtViews/{NumberView,CompareView,TableView,BarView,LineView,ScatterView,HeatView,ListView,ProgressView,TableAlt,DrillPanel,HowMadeSheet}.jsx` + `builtViews.module.css`
- Modify: `app/src/pages/journal-2-0/components/notebook/widgets/snapshotEmbeds.js` (one row: `export { default as builtWidget } from './BuiltWidgetEmbed'`)
- Test: `widgets/BuiltWidgetEmbed.test.jsx`, `widgets/builtViews/*.test.jsx`, `src/styles/tapFloor.test.js`

**Interfaces:**
- `BuiltWidgetEmbed({attrs, editable, onUpdateParams, uid})` renders through `useSnapshotFrame` + `SnapshotFrame`, from `params` alone: no fetch on mount.
- One view per `params.view`, each pure inline SVG (`<rect>`, `<polyline>`, `<circle>`), never a chart engine.
- Cells: a `"hide"` cell shows `"Not enough trades yet (<n>)"` (`days` for a day unit), a `"small"` cell shows a "small sample" badge, a null value shows "no data", and PF at the cap shows "5+". Every average or rate shows its count in its own unit ("from 9 of 47 trades (38 have no stop)" when `coverage.have < total`), plus the `coverage.hint` link "Add stops to see R for more trades" to `/journal/trades?seg=closed`. Compare shows "vs <compareLabel>".
- `notice` and footnotes render under the body. An `empty` payload renders its §5.9 sentence, and for closed trades a "Log a trade" link to `/journal/trades`; never a zero or a blank chart.
- "Show as table" toggles `TableAlt`, an HTML `<table>` of the same rows, for every chart view.
- Drill-down (not in `shareView`): Enter or click on a number, bar, point, cell or table row opens `DrillPanel` (a `Sheet` on touch, an anchored panel on desktop). It calls `postJson('/drill', {…, cell, snapshotCount: params.count})` and lists up to 40 rows plus "and N more", each linking to `/journal?j2tab=journal&openTrade=<id>` (`TradeJournalTab.jsx:230`), with flagged trades labelled "Flagged" and the live note. Escape returns focus to the cell. The panel traps focus.
- Keyboard: in chart views, bars, points and cells are a roving-tabindex group (arrow keys move, Enter drills). Table rows are focusable.
- Heat map: each cell carries its value as text, or `+`/`−` when the cell is smaller than 32 px; negatives use a hatched `<pattern>`; the scale is a diverging blue-orange pair.
- Grouping in the client uses `Map` only.
- The ⋯ menu (frame header) for an editable placed widget offers:
  - "How this is made", which opens `HowMadeSheet`: `params.summary` and an "Edit widget" button that calls `openWidgetBuilder({editor, from: {defId, getPos}})` from Task 8.15. For a `shelf:` widget the button reads "Edit a copy".
  - "Manage…", which opens My tools (Task 8.17).
  - Lazily on open, `GET /{defId}`: when `rev > max(defRev, placedRev)` it shows "Updated version available", which previews the new summary beside the old and applies on click through `runBuilt({…, defRev: latestRev})`. When archived it shows "Archived widget" with Restore. When missing it shows "Running from the saved copy in this note."
- ⛔ The archive image: while `share === true` the summary, subtitle and ⋯ controls are not rendered inside the archived body element, so filter values cannot be rasterised (`WidgetEmbedView.jsx:592`).

- [ ] **Step 1: Write the failing tests:**
  - `renders_from_params_without_fetch` (spy `fetch`: 0 calls) for each of the nine views.
  - `hide_cell_shows_not_enough_with_count`.
  - `small_badge_under_20`.
  - `coverage_sentence_and_add_stops_link`.
  - `pf_cap_shows_5_plus`.
  - `nan_shows_no_data_never_zero`.
  - `table_alt_matches_rows`.
  - `drill_opens_on_enter_and_escape_returns_focus`.
  - `drill_absent_in_share_view`.
  - `drill_lists_40_and_more_and_flagged_label`.
  - `heat_cell_has_text_label_and_pattern_for_negative`.
  - `proto_label_groups_safely`: a row labelled `__proto__` renders and drills.
  - `shared_body_has_no_summary_or_filter_text`: with `share: true`, the body's `textContent` holds no canary from `params.summary` or `params.def`.
  - `updated_version_control_previews_then_applies`.
  - `archived_shows_restore`.
  - `missing_definition_says_saved_copy`.
  - The tap-floor rail passes for the new CSS.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgets/BuiltWidgetEmbed.test.jsx src/pages/journal-2-0/components/notebook/widgets/builtViews src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes check. Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `feat(notebook): built widget embed, SVG views with table alternatives, drill-down`.

### Task 8.15: The builder sheet

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/widgetBuilder/WidgetBuilderSheet.jsx` + `.module.css`
- Create: `widgetBuilder/builderState.js` (the reducer with undo and redo), `widgetBuilder/sections/{SourceSection,WhichOnesSection,MeasureSection,SplitSection,ViewSection,NameSection}.jsx`, `widgetBuilder/PreviewPane.jsx`, `widgetBuilder/SaveQuestion.jsx`, `widgetBuilder/openWidgetBuilder.js`
- Test: `widgetBuilder/builderState.test.js`, `widgetBuilder/WidgetBuilderSheet.test.jsx`, `widgetBuilder/WidgetBuilderSheet.phone.test.jsx`, `src/styles/tapFloor.test.js`

**Interfaces:**
- `openWidgetBuilder({editor, from?: {defId, getPos} | {shelfId, getPos}, start?: 'examples'|'blank'|'resume'}) -> close()`: mounts on its own root, one at a time (the `SetsDialog.openSetsDialog` pattern, `SetsDialog.jsx:288`).
- `builderState`:
  - `reducer(state, action)` with actions `setSource, setRange, addFilter, editFilter, removeFilter, setMeasures, setSplit, setView, setName, setDisplay, undo, redo, loadPlan`.
  - `state = {plan, past: [], future: [], nameTouched, dirty}`. History is capped at 100.
  - `setName` sets `nameTouched`, and the name follows `defaultName` from the latest preview until then.
- The sheet:
  - One `Sheet` (`components/mobile/Sheet.jsx`) with sections top to bottom and a live `PreviewPane`. At 641 px and wider the preview is on the right, 40% wide. At 640 px and narrower it is a one-line sticky summary that expands on tap and hides while the keyboard is open (`visualViewport` height under 75% of `innerHeight`).
  - Pickers push in place inside the same sheet, with a Back control.
  - Source tiles and view thumbnails are radio groups. Value pickers load from `loadVocabulary(field)`.
  - The measure picker groups by theme, shows `meaning` on hover and long-press, and shows each `needs` measure's coverage from the last preview ("R known on 23 of 47 trades").
  - Disabled measures and views carry a one-line reason from the catalog.
- Preview: `postJson('/preview', {plan, settings})` debounced 400 ms. Only the newest answer is applied (a request counter). The last good result stays dimmed under any failure, with `failureText(code)`. Save stays enabled for every engine state.
- Save:
  - A new widget goes to `POST ""`, then is inserted at the caret through `runBuilt`, when opened from a note.
  - Editing a widget with `usedIn > 1` shows `SaveQuestion`: "This widget is in <N> notes." with "Update all <N> notes" and "Save as a new widget". A title- or colour-only change preselects "Update all"; a filter, measure or split change preselects "Save as a new widget"; after the first answer the widget's `lastAnswer` is preselected. "Update all" sends `PUT` with `apply: update_all` and writes no note: every placed copy, the source note's included, keeps its snapshot and adopts the new revision on its next See it now. "Save as a new widget" sends `apply: save_new` and replaces only the source note's widget.
  - `usedIn <= 1` saves without asking.
  - A `shelf:` or adopted widget shows "Save as a copy", which replaces the placed widget in one transaction (one undo brings the original back), or inserts at the caret from `/build`.
  - A 409 `conflict` keeps the draft and shows its sentence.
- Drafts: Escape goes back one picker level, then asks "Keep your changes?" only when `dirty`. Kept drafts go to `localStorage['uct.nb.widgetDraft.<uid>']` (wrapped in try/catch) with a timestamp. Reopening `/build` within 24 h offers "Resume your unsaved widget".
- Keys: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes, Ctrl/Cmd+Enter saves.
- The preview's live region announces only `summary` (debounced 1 s).
- Every section has a heading, focus moves section to section, each filter chip is a button named by its sentence, and each has "Remove filter: <sentence>".

- [ ] **Step 1: Write the failing tests:**
  - `builderState`: `undo_redo_round_trip`, `name_follows_default_until_typed`, `history_capped_100`.
  - Sheet:
    - `preview_debounced_and_stale_dropped`: two edits 100 ms apart give one request, and an older answer arriving later is ignored.
    - `failure_keeps_last_result_and_save_enabled` (busy, too_long, rate_preview, offline).
    - `invalid_view_disabled_with_reason`.
    - `save_new_inserts_built_widget_in_note`.
    - `editing_used_in_14_asks_update_all_or_new`.
    - `title_only_change_preselects_update_all`.
    - `shelf_widget_saves_as_copy_replacing_node_one_undo`.
    - `conflict_keeps_draft`.
    - `escape_backs_one_level_then_asks_keep`.
    - `resume_draft_within_24h`.
    - `ctrl_enter_saves`.
    - `live_region_announces_summary_only`.
    - `chip_has_remove_button_named_by_sentence`.
  - `WidgetBuilderSheet.phone.test.jsx`: at 390 px, the sticky summary shows "<name> · <count> trades · <first value>"; it hides when the keyboard opens; and there is exactly one sheet in the DOM when a picker is open.
  - The tap-floor rail.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgetBuilder src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes check (the builder must add nothing to first open). Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `feat(notebook): widget builder sheet with live preview, drafts and the update-all question`.

### Task 8.16: Examples gallery, sample data and the empty and failure states

**Files:**
- Create: `widgetBuilder/ExamplesGallery.jsx` + `.module.css`, `widgetBuilder/ExampleCard.jsx`, `widgetBuilder/miniPreview.jsx` (static SVG thumbnails from a card payload)
- Modify: `widgetBuilder/WidgetBuilderSheet.jsx` (start screen)
- Test: `widgetBuilder/ExamplesGallery.test.jsx`, `widgetBuilder/failureStates.test.jsx`

**Interfaces:**
- The start screen is "Start from an example": cards from `GET /shelf`, plus "Start blank", with search over name and keywords (a name match ranks above a keyword match).
- Card results come from `POST /examples` in batches of 8 as cards scroll into view (`IntersectionObserver`). A card already shown is never re-fetched. On `busy` a card keeps its skeleton and retries once after 1.5 s; "busy" is never shown on a card.
- `sample: true` gives each card a "Sample data" ribbon and a banner `"These use sample trades. Link a broker or log a trade to see yours."` with "Link broker" (`/journal/accounts`, where `BrokerConnectionsCard` lives) and "Log a trade" (`/journal/trades`).
- Opening a card loads its plan into the builder. Inserting while on sample data inserts the real widget, which shows its §5.9 empty sentence.
- Motion respects `prefers-reduced-motion`.
- `failureStates.test.jsx` covers every §5.10 row reachable in wave 8, each asserting the exact copy and what stays: busy, too long (with a "Last 90 days" one-tap suggestion), over 5,000 rows, rate limit (preview), rate limit (widget), daily cap, count cap, offline, flag off, definition missing, newer plan version, not enough data, changed in another tab.

- [ ] **Step 1: Write the failing tests:**
  - `cards_batched_by_8_on_scroll_never_refetched`.
  - `busy_card_keeps_skeleton_retries_once`.
  - `sample_ribbon_and_banner_with_two_buttons`.
  - `search_name_above_keyword` ("hit rate" finds Win rate).
  - `insert_from_sample_inserts_real_widget`.
  - `reduced_motion_no_animation_class`.
  - The thirteen failure-state cases in `failureStates.test.jsx`, each asserting rendered text.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgetBuilder/ExamplesGallery.test.jsx src/pages/journal-2-0/components/notebook/widgetBuilder/failureStates.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): widget examples gallery with sample data and the failure-state copy`.

### Task 8.17: My tools, Widgets tab

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/myTools/{MyToolsSheet,WidgetsTab,VersionHistory,UsedInList,DeleteConfirm}.jsx` + `myTools.module.css`, `myTools/openMyTools.js`
- Test: `myTools/MyToolsSheet.test.jsx`, `myTools/VersionHistory.test.jsx`, `src/styles/tapFloor.test.js`

**Interfaces:**
- `openMyTools({editor, tab = 'widgets'}) -> close()` mounts on its own root.
- The sheet has four tabs, Widgets · Routines · Trackers · Templates. In wave 8 the last three show "Coming soon" text and no controls.
- Phone (640 px and narrower): a full-screen `Sheet`, the tabs as `SegmentedNav`, rows 56 px, actions in `ContextPopover`.
- A link to "Manage chart sets" opens `openSetsDialog`.
- Widgets rows: name, a static view-type thumbnail, "Used in <N> notes" (opens `UsedInList` from `GET /{id}/used-in`, each linking to its note), last edited, and for adopted rows "Based on X's Y" (no adopted rows exist before wave 11).
- Row actions:
  - Open (the builder).
  - Rename (`PUT` with `If-Match`).
  - Duplicate (`POST ""` with "<name> copy").
  - Version history: each revision's date and summary, the changed parts highlighted against the current summary, "Name this version", and Restore. Restore posts `/revs/{rev}/restore`, then shows the `SaveQuestion` when `usedIn > 1`.
  - Archive: "It stays in your <N> notes as a snapshot. See it now keeps working from its saved copy."
  - "Share to library" is not rendered in wave 8 (wave 11).
- Filters: Active, Archived (with Restore and "Delete permanently", which needs the name typed), and Recently deleted (with "Restore", kept 30 days).

- [ ] **Step 1: Write the failing tests:**
  - `lists_widgets_with_used_in_and_last_edited`.
  - `used_in_opens_note_list`.
  - `rename_sends_if_match_and_conflict_sentence`.
  - `archive_sentence_with_count`.
  - `delete_only_from_archived_and_needs_typed_name`.
  - `recently_deleted_restore`.
  - `version_history_restore_then_question_when_used_elsewhere`.
  - `other_tabs_have_no_controls_in_w8`.
  - `phone_full_screen_segmented_rows_56`.
  - The tap-floor rail.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/myTools src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): My tools, Widgets tab with used-in, history, archive and restore`.

### Task 8.18: The Mine group in `/`, `/build`, `/widgets` and the My tools door

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx` (`SLASH_GROUPS` `:348`, a `builtItems(query, editor)` loader on `background()` `:552`, `items` at `:1042`)
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (a "My tools" header action beside the Styles button, `:2510`, shown while `widgetsWaveOn(8)`)
- Test: `SlashMenu.items.test.jsx`, `SlashMenu.built.test.jsx`, the NotebookTab header test

**Interfaces:**
- `SLASH_GROUPS` gains `{ id: 'tools', label: 'Mine' }` placed before `{ id: 'mine', label: 'My presets' }`. "My presets" keeps its id and label.
- `builtItems(query, editor)` (only while `widgetsWaveOn(8)`):
  - First row "Build a widget" (`cmd: 'build'`), which opens `openWidgetBuilder({editor, start: 'examples'})`.
  - Then the member's non-archived widgets from `GET /api/j2/widget-definitions` through a `background()` loader keyed to the member id. Each row runs `runBuilt({defId})` and lands the frozen widget like `landSnapshot`, saying "Adding <name>…" then "<name> added.". On failure it inserts nothing and notifies `failureText(code)`.
  - Last row "Manage my tools" (`cmd: 'tools'`), which opens `openMyTools`.
  - At most 5 widget rows on a bare `/`; typing narrows to every match.
- Direct commands: `/build` (the builder, or "Resume your unsaved widget" when a draft is under 24 h old) and `/widgets` (the builder's examples gallery). The block-item ranking (`rankedBlockItems`) puts a name match above a keyword match.
- With W8 off, the bare `/` list is unchanged item for item (a snapshot test against the current list).

- [ ] **Step 1: Write the failing tests:**
  - `mine_group_absent_when_w8_off_and_bare_list_unchanged`.
  - `mine_group_order_build_first_manage_last`.
  - `my_presets_keeps_label`.
  - `widget_row_inserts_frozen_built_widget`.
  - `failed_run_inserts_nothing_and_says_why`.
  - `build_and_widgets_commands`.
  - `five_rows_bare_all_when_typed`.
  - `loader_keyed_to_member`.
  - `my_tools_header_action_only_when_w8_on`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/SlashMenu src/pages/journal-2-0/tabs/NotebookTab`. Expected: FAIL.
- [ ] **Step 3:** Implement. `lib/builtWidgets.js` is loaded only by the loader and the commands (dynamic import).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes check. Expected: `VERDICT: PASS`. Record the total and the remaining headroom in the commit message.
- [ ] **Step 6:** Commit: `feat(notebook): Mine group in the / menu, /build, /widgets and the My tools door (dark)`.

### Task 8.19: Wave 8 verification and ship dark

- [ ] **Step 1:** Run the backend files this wave touched, by name: `python -m pytest tests/test_trading_days.py tests/test_measures.py tests/test_widget_plan.py tests/test_widget_sources.py tests/test_widget_engine_isolation.py tests/test_widget_engine_fuzz.py tests/test_built_widget_payload.py tests/test_widget_run.py tests/test_widget_definitions.py tests/test_tool_uses_projection.py tests/test_widget_shelf.py tests/test_widget_sample_book.py tests/test_widget_definitions_router.py tests/test_public_note_payload.py tests/test_notebook_widgets_service.py tests/test_notebook_widgets_router.py tests/test_journal_styles_compose.py tests/test_notebook_flags.py tests/test_account_deletion_manifest.py tests/test_journal_two_account_purge.py tests/test_account_tombstones.py tests/test_sample_never_feeds_real_numbers.py tests/test_user_definitions_auth.py -q`. Expected: all PASS, totals line recorded.
- [ ] **Step 2:** Run the frontend files this wave touched, chunked by directory: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgetBuilder src/pages/journal-2-0/components/notebook/myTools src/pages/journal-2-0/components/notebook/widgets src/pages/journal-2-0/lib/builtWidgets.test.js src/pages/journal-2-0/components/notebook/SlashMenu src/widgets src/styles src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/components/screener/reachable.test.js`. Expected: all PASS, totals recorded. `reachable.test.js` proves every new module is reachable from `App.jsx`.
- [ ] **Step 3:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`.
- [ ] **Step 4:** Browser walk on a local sandbox (`scripts/hub-sandbox.ps1`, data dir passed from PowerShell, a paid walk account) with `NOTEBOOK_WIDGETS_W8_ENABLED=1`, at 1200, 820 and 390 px:
  - build from an example on sample data (a fresh account);
  - log 5 trades and watch the preview switch to real data;
  - save and insert;
  - See it now;
  - Change the range and account;
  - drill a bar into a trade drawer;
  - share on, then open the share link in a private window (result only, no summary);
  - edit a widget used in two notes and answer both ways;
  - My tools: rename, history restore, archive and restore;
  - at 390 px also with the keyboard open in the name field.
  
  Save the raw evidence to `docs/notebook/evidence/<run-id>/` and commit it before writing any summary (R-RAW). The VoiceOver pass on iOS Safari 17 runs on BrowserStack Live and is recorded in the same directory, by the operator who ran it.
- [ ] **Step 5:** Open a PR to master with the member-impact paragraph "Nothing changes for members: the widget builder ships switched off." Merge, deploy, verify the new boot by the `/api/health` uptime reset and `tools/hub_nav_smoke.py --auth`.
- [ ] **Step 6:** Arming is the owner's flip: report `railway variables --service web --set NOTEBOOK_WIDGETS_W8_ENABLED=1` and its rollback `=0` (never a delete). When armed, update `docs/feature_flags.json` (`status: armed`, the flip time) in the same docs push.

---

## Next plans

- **Wave 9 (`NOTEBOOK_WIDGETS_W9_ENABLED`): routines and trackers.** Tables, per-item ticks and versioned schedules, done and consistency over `trading_days.py`, tick and log endpoints that touch no `j2_notes` row, `RoutineBlock` and `TrackerBlock` trader blocks, "vs P&L", suggested items, milestones, reminders, routine and tracker history as builder sources (plus the routine and tracker columns of the trading-days source), the Routines and Trackers tabs, `/routine` and `/track`, the first-run "Set up your pre-market routine" card, and `j2_tool_uses` rows for both kinds.
- **Wave 10 (`NOTEBOOK_WIDGETS_W10_ENABLED`): formulas, more sources, the full shelf.** The widget formula dialect with shared vectors; the options and notes sources; this plan's `shelf.json` becoming immutable revision files with a hash rail and shelf updates in "Updated version available"; the remaining §8 rows and the dedicated shelf builders; at most 8 built-in widgets on a bare `/`; the position size calculator.
- **Wave 11 (`NOTEBOOK_WIDGETS_W11_ENABLED`): templates and sharing.** Slot instance ids, inline definition copies, the sharing reducer and canary rail, new gallery item types, adoption, routine and tracker reuse in templates, preview with my data, about 30 official templates, the helpful 3-day rule, the Templates tab, "Share to library", and `served_style` slot-wave coverage.
