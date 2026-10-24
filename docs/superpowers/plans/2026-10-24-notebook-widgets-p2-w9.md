# Notebook Widgets Phase 2, Wave 9 (Routines and Trackers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship, dark behind `NOTEBOOK_WIDGETS_W9_ENABLED`, routines (a list of items remembered every trading day) and trackers (one value a day) as live trader blocks whose state never enters the note, with forgiving consistency, "vs P&L" comparisons, suggestions from the member's own trades, quiet milestones, optional bell reminders, their history as two new builder sources, and the Routines and Trackers tabs of My tools.

**Architecture:** Raw ticks, the skipped flag, versioned schedules and tracker values live in seven new user-scoped tables. Done, not done, consistency and runs are DERIVED at read time by a pure module over `trading_days.py`, so no edit ever rewrites a past day. The tick, skip and log endpoints write only those tables (never `j2_notes`) inside `BEGIN IMMEDIATE`, per item, and answer the merged day; every block instance adopts it through a BroadcastChannel. A placed routine or tracker is an ordinary `widgetEmbed` trader block (`block: true`, rendered by `BlockNodeView`) whose params hold only the id, the bound day and display settings. The builder gains `routine_history` and `tracker_history` sources and two routine/tracker columns on trading days, through the wave 8 engine's `Catalog`.

**Tech Stack:** React + TipTap + Vitest (`app/src`); FastAPI + sqlite + pytest (`api/`).

**Spec:** `docs/superpowers/specs/2026-10-24-notebook-widgets-phase2-design.md` (§6 Routines, §7 Trackers, §9, §5.8, §5.10, §5.11, §13 wave 9 row, §16 answers 3-5), on top of `docs/superpowers/specs/2026-10-19-notebook-widgets-design.md`. Format and wave 8 interfaces: `docs/superpowers/plans/2026-10-24-notebook-widgets-p2-w7-w8.md`. Rulings R-1..R-27 carry over from `.superpowers/sdd/2026-10-24-notebook-widgets-p2-w7-w8/progress.md` (notably R-1 anchors are hints, R-14 controller review of mechanical diffs, R-15 If-Match = `etag`, R-25 account names never public, R-27 missing If-Match = 428 `conflict`).

## Global Constraints

- No note schema change. `routine` and `tracker` are `widgetId` values of the existing `widgetEmbed` node, registered with `blockManifest` (`app/src/widgets/registry.js:345`), the `moodCheckIn` precedent (`:1032`). A task that finds it needs a node, mark or attr change in `lib/notebookSchema.js` or `notebook_schema.py` stops and comes back to the owner.
- First-open bytes: budget **2,260,793 B**, never raised. Gate: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist` must print `VERDICT: PASS`. Run it in every task that touches an eager file (named per task). Block bodies, editors, pickers and the My tools tabs are lazy (`() => import(...)`); eager additions are limited to two registry rows, two `BLOCK_COMPONENTS` importers, two labels, the slash items, one editor-storage function and the flag rows.
- Wave 9 flag: `NOTEBOOK_WIDGETS_W9_ENABLED`, default `False`, read per request through `notebook_widgets_wave_on(9)` (`notebook_widgets.py:313`). Payload key `notebook_widgets_w9_enabled`, latched per tab. Wired in ONE commit (Task 9.1). Rollback is `=0`, never a delete. With the flag off every routine and tracker route answers the `public.not_found()` 404, a placed block says `"Not available right now."` (never an empty routine, never zero ticks), and stored routines, trackers, ticks and values stay and reappear when it is switched back on.
- Online only (spec §16.5): no offline queue. Offline, controls are disabled and the block says `"You're offline. Ticks save when you're back online."` (routines and trackers alike). No change to `lib/offline/**`.
- ⛔ Live state is never written into note params. Opening a note with blocks, ticking, skipping and logging produce ZERO ProseMirror transactions with `docChanged` and ZERO note PUTs. The tick, skip and log services contain no `j2_notes` SQL, so `lib/offline/doorEnumeration.test.js` stays green with no new exception. Only the block's own settings (bound day, Follow today, display) change the note, through `useBlockParams` (the ONE `updateAttributes` door, `blocks/useBlockParams.js`), riding the note's own save.
- `lib/blocks/blockDoors.test.js` stays green: each non-GET request a block file makes is a NAMED `WRITE_EXCEPTIONS` entry added in the commit that creates it, and each module a block file imports outside the block directories is a named `IMPORT_ALLOW` entry with its reason.
- Ownership: `user_id` from the session only. Every read and write is `WHERE id = ? AND user_id = ?`. A routine, tracker or item id that is not the session member's is absent: reads return nothing for it and the block says `"Not available."`; writes answer the 404.
- Writes are per item, merged server-side inside `BEGIN IMMEDIATE` (reuse `widget_definitions._begin_immediate`), and answer the merged day. `{day}` is `YYYY-MM-DD`. The write window is fixed by `routine_days.write_window(today)`: earliest = the 7th trading session strictly before today ET; latest = the next trading session after today (ruling W9-R1, below). Outside it: 400 code `window`, `"Ticks can be added up to 7 trading days back."`.
- Rates (in-process slowapi, ⚠️ per-process state): writes (ticks, skips, logs, create, edit, archive, delete) scope `notebook-routine-writes` at **120/minute** per member; reads (batched days, vs P&L, lists) scope `notebook-routine-reads` at **60/minute**. Request bodies at most **8 KB** (`8 * 1024`).
- Caps: **30** non-archived routines, **25** items each, names at most **80** characters, item text at most **200**; **30** non-archived trackers, unit at most **16** characters; duration at most **24 h** (stored as minutes, `<= 1440`); scale integers 1-5; yes/no `0` or `1`; numbers finite with `abs(v) <= 1e9`. Batched reads: `ids` at most 30, `days` at most 31.
- Day states, member copy: `Done` · `Not done` · `Skipped` · `Off day`. Partial reads `"4 of 6"`. Consistency is `done / (scheduled - skipped)` (strict mode: `done / scheduled`), always shown with its skips: `"18 of the last 20 trading days (2 skipped)"`. The current run is shown only while it is 3 or more. Milestones at 7, 21, 50 and 100 show one line (`"21 sessions in a row"`) and nothing else. ⛔ No surface ever shows a streak, run, consistency or count of 0; no red; no strike-through; a not-done day carries the text label `"Not done"` and a tooltip.
- Trading days come only from `api/services/journal_two/trading_days.py`. Half days are sessions. Past the calendar's horizon (2028-12-31) schedules count weekdays with the quiet note `"Market calendar not available past <Mon D, YYYY>; counting weekdays."` (`trading_days.beyond_note`). Never derive a day from UTC.
- Day binding (spec §16.3): on insert, `day` = the note's own day (`note.dailyDate`, else the note's created ET day), never "today" at read time. "Follow today" (`bind: 'today'`) is a block setting, never a default.
- "vs P&L": day net P&L includes closed options strategies (the trading-days source's day net), counts only sessions with trades, and ALWAYS ends with `"A comparison, not proof."`. Small samples: under 20 days a "small sample" badge; under 5 the value is replaced by `"Not enough days yet (<n>)"`; with no days at all, `"No days with trades yet."` (never "(0)").
- Reminders: one optional reminder per routine, OFF by default, the alert bell only (`api.services.alerts.add_alert(..., user_id=...)`, which skips Discord for a private alert and sends no email), holiday-aware, moved with an early close, at most once per routine per ET day (`j2_routine_reminder_claims`), and a slot missed during a deploy is skipped, never sent late.
- Public, shared and gallery pages: routine and tracker blocks render `A private account item is not shown on public pages.`, even with `params.share === true`; example notes drop them; no day state travels and the public reducer makes no database read.
- New tables carry `user_id`, are created by `db.ensure_schema` (statements appended to `_PHASE_2_ALTERS`, `db.py:1645`), are listed in `account_purge._DIRECT_USER_TABLES` (`account_purge.py:32`), are covered by a tombstone-replay test (`account_tombstones.replay_on_db`, `api/services/account_tombstones.py:295`), and `docs/account-deletion-manifest.md` is regenerated with `python tools/account_deletion_manifest.py --write`.
- Plans: `plan.PLAN_VERSION` becomes **2**. A plan is stored with `v = plan.needed_version(plan)`: 2 only when it uses a routine or tracker source or a `ref`, else 1. So every wave 8 plan stays v1, and a server reverted to wave 8 refuses a v2 plan with `"This widget was made with a newer version of the app. Reload to use it."` instead of dropping keys (ruling W9-R3).
- Errors: `{"detail": {"code": str, "message": str}}`; every 200 `Cache-Control: no-store`; If-Match on routine and tracker edits carries `etag` (`save_seq`, R-15); a missing If-Match is 428 `conflict` `"Reload to see the newer version."` (R-27); a stale one is 409 `"Changed in another tab. Reload to see the newer version."`. Tick, skip and log writes take no If-Match (they merge per item). The new router's 402 sentence is its own: `"Routines and trackers require a paid plan"` (`tests/test_user_definitions_auth.py` requires distinct sentences).
- Every number shown goes through `notebook_widgets._num`: NaN or Infinity becomes `null` and renders as "no data".
- Member words: Routine, Tracker (and Widget, Template). The word "checklist" is never used for a routine (Checklist is a Basics block). "definition", "shelf", "built widget", "source", "plan" and "scope" never appear in UI copy. No emoji; icons are `UIcon` names. Every touch target is at least 44 px (`styles/tapFloor.test.js`).
- Repo rules: run tests in their own tool call, read the totals line, then commit in a separate call. Backend: `python -m pytest <named files> -q`, never a directory. Frontend: `cd app && npx vitest run <paths>`. Files are LF. Run `python tools/check_repo_hygiene.py` before each commit. Commit with `git commit -F - <<'MSG'` ... `MSG`, the message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push the branch after each task. Never create scratch worktrees or junctions (the 7.6 incident); measure in place.

### Rulings made by this plan (W9-R1..R5)

- **W9-R1 (write window, upper bound).** Spec §6.2 says `{day}` is "not after today in ET", but §6.2 also binds night-before routines "For the next trading day", which could then never be ticked the night before. The window's upper bound is therefore the NEXT trading session after today, and nothing later. The lower bound is the spec's: 7 trading sessions back, counted in sessions so a long weekend never shortens it.
- **W9-R2 (tables).** `j2_routines` and `j2_trackers` gain `deleted_at TEXT` (spec §5.8: "Recently deleted" for 30 days) and `save_seq INTEGER NOT NULL DEFAULT 1` (R-15 If-Match on edits). Neither is in §6.2's column list; both follow the widget-definitions pattern.
- **W9-R3 (plan version).** As in Global Constraints: `needed_version`, `PLAN_VERSION = 2`.
- **W9-R4 (no KIND_WAVE row, no BLOCK_KINDS row).** Routines and trackers are trader blocks, not snapshot kinds: `KIND_WAVE`, `KIND_TITLE`, `ACCOUNT_KINDS` and the client `WIDGET_KINDS` are unchanged (the `tests/test_journal_styles_compose.py` rails compare snapshot kinds only). They are not journal-style blocks either: `lib/journalBlocks.BLOCK_KINDS`, `journal_styles.BLOCK_KINDS`, `trader_blocks.BLOCK_IDS` and `_slot_wave_off` are unchanged (wave 11 owns `routine_<k>` / `tracker_<k>` slots). A placed block learns the flag is off from the server's 404, so no block file imports a flag module.
- **W9-R5 (negative items).** A negative item ("No revenge trades") is done only by a tick, like any item; it differs in its words (the tick reads "Didn't happen") and in its suggestion rule. Nothing counts as done without a member's tick, so a routine nobody opens never reads as kept.

## Review Focus

1. **Calendar edges.** A note opened on Saturday, on Thanksgiving (2026-11-26), on the half day after it (2026-11-27), after 16:00 ET, at 23:30 ET (04:30 UTC the next day), and on a day past the calendar horizon. "Follow today" shows the next session on a non-trading day and the current session after the close; the half day is a scheduled session; a reminder set for 15:45 ET on the half day fires at 12:45 ET; past the horizon the block shows the quiet note and counts weekdays. Owned by Tasks 9.3, 9.4 and 9.9.
2. **Two devices tick different items of one routine day at the same moment, with a third tab open on the same note.** Both ticks survive, every instance on every tab shows both, and no note is written or forked. Owned by Tasks 9.4, 9.12 and 9.13.
3. **A routine id that is not the member's**: a note copied from another member, a hand-made body naming another member's routine, a routine deleted 31 days ago, and the same ids on a public page. The block says "Not available.", the batched read returns no row for the id, the write answers 404, and the public reducer prints the account line without reading the database. Owned by Tasks 9.4, 9.6, 9.11 and 9.13.
4. **History edits months later**: an item renamed, an item removed, a schedule changed from every day to Mon/Wed/Fri, and a late tick inside the window. Past days keep the items and schedule valid on them, a rename keeps the item's history, a removal applies from today forward, a late tick changes only its own day, and nothing in storage is rewritten. Owned by Tasks 9.3 and 9.4.
5. **A brand-new member and hostile values**: a routine created today with no trades ever, and tracker values `NaN`, `"1e309"`, `-5` minutes, scale `6`, a 17-character unit and `true` for a number. The block shows no consistency line and no run line (never "0 of 0" or "0 sessions"), vs P&L says "No days with trades yet.", and every bad value is refused with its sentence and stores nothing. Owned by Tasks 9.3, 9.5, 9.7 and 9.13.

## Order, lanes and parallel work

- Task 9.1 first (a mechanical diff, R-14 controller review).
- **Backend lane** (only `api/`, `tests/`, `docs/account-deletion-manifest.md`): 9.2 → 9.4 → 9.5 → 9.6 → 9.7, with 9.3 (pure, disjoint files) in parallel with 9.2. Then 9.8, 9.9, 9.10 and 9.11, which touch disjoint files (`widget_engine/*` + `plan.py`; `routine_reminders.py` + `api/main.py`; `notes.py` + the two stores; `public_note_payload.py`) and may run concurrently once 9.5 is in. These can run while wave 8's frontend Tasks 8.14-8.19 finish, as wave 8's backend did (ruling R-7 pattern: a second worktree, one implementer at a time there, merged after).
- **Frontend lane** (in `nbw-p2-impl`, one `npm run build` at a time, ruling R-9): 9.12 → 9.13 → 9.14 → 9.15 → 9.16 can start once Task 8.13 has landed (8.13 edits `registry.js` and `SlashMenu.jsx`). 9.17 needs Tasks 8.15-8.16 (builder sections), 9.18 needs Task 8.17 (`MyToolsSheet`), 9.19 needs Tasks 8.16 and 8.18 (`ExamplesGallery`, the Mine group). The frontend tasks code against Task 9.6's routes; until 9.6 is merged their tests mock `fetch`.
- Task 9.20 last.

---

### Task 9.1: Flag wiring in every place

**Files:**
- Modify: `api/routers/auth.py` (`NOTEBOOK_FLAGS`, after the W8 row `:291`)
- Modify: `app/src/pages/journal-2-0/lib/offline/notebookFlags.js` (`FLAG_FALLBACKS`, after `:90`)
- Modify: `app/src/pages/journal-2-0/lib/notebookWidgetsFlags.js` (`WAVES`, `:7`)
- Modify: `docs/feature_flags.json` (after the `NOTEBOOK_WIDGETS_W8_ENABLED` entry, `:1963-1968`)
- Modify: `tests/test_notebook_flags.py` (pins, after `:106`)
- Test: `tests/test_notebook_flags.py`, `tests/test_notebook_flag_table_form.py`, `tests/test_notebook_flag_parse.py`, `app/src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js`

**Interfaces:**
- Produces: `"NOTEBOOK_WIDGETS_W9_ENABLED": False,  # enablement — unset means OFF (notebook widgets, wave 9)`; `notebook_widgets_w9_enabled: false, // notebook widgets, wave 9 — absent ⇒ OFF`; `WAVES = Object.freeze([1, 2, 3, 4, 5, 6, 8, 9])`; `widgetsWaveOn(9)`; server `notebook_widgets_wave_on(9)` (the reader is generic, no change).
- The ledger entry: `member_facing: {label: "Routines and trackers", where: "Notebook"}`, `status: "dark"`, `where: ["web"]`, a note naming this plan, "read per request through notebook_widgets_wave_on(9)", "with the flag off a placed routine or tracker says \"Not available right now.\" and every stored routine, tracker, tick and value is kept", the arm line `railway variables --service web --set NOTEBOOK_WIDGETS_W9_ENABLED=1` (the owner's) and the rollback `=0` (never a delete; a delete does not restart the process).
- ⚠️ Deviation from spec §13, on purpose (ruling W9-R4): no `KIND_WAVE` row and no `_slot_wave_off` change.

- [ ] **Step 1: Write the failing tests.** Add `notebook_widgets_w9_enabled` to the pinned list. In `notebookWidgetsFlags.test.js`: `widgetsWaveOn(9)` is false unlatched and true once latched; `widgetsWaveOn(7)` and `widgetsWaveOn(10)` are always false.
- [ ] **Step 2:** Run `python -m pytest tests/test_notebook_flags.py tests/test_notebook_flag_table_form.py tests/test_notebook_flag_parse.py -q` and `cd app && npx vitest run src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js`. Expected: FAIL.
- [ ] **Step 3:** Add the four rows in one change.
- [ ] **Step 4:** Run both commands. Expected: PASS.
- [ ] **Step 5:** Bytes (two eager files): `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `feat(notebook): dark release flag for notebook widgets wave 9`.

### Task 9.2: Routine and tracker tables, purge rows and tombstone replay

**Files:**
- Modify: `api/services/journal_two/db.py` (`_PHASE_2_ALTERS`, after the `j2_tool_uses` block, `:2179-2190`)
- Modify: `api/services/journal_two/account_purge.py` (`_DIRECT_USER_TABLES`, after `"j2_tool_uses"`, `:213`)
- Modify: `docs/account-deletion-manifest.md` (regenerated)
- Test: `tests/test_routine_tracker_schema.py` (new), `tests/test_account_deletion_manifest.py`, `tests/test_journal_two_account_purge.py`, `tests/test_account_tombstones.py`

**Interfaces:**
- Produces (exact DDL, every table `user_id TEXT NOT NULL`; ids `uuid4` strings; times ISO UTC; days `YYYY-MM-DD` ET):
  - `j2_routines (id TEXT PRIMARY KEY, user_id, name TEXT NOT NULL, items_json TEXT NOT NULL, settings_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, deleted_at TEXT, save_seq INTEGER NOT NULL DEFAULT 1, source_gallery_id TEXT, source_template_key TEXT, UNIQUE(user_id, source_template_key))`, index `idx_j2_routines_user (user_id, archived_at, deleted_at)`.
  - `j2_routine_schedules (user_id, routine_id TEXT NOT NULL, effective_from TEXT NOT NULL, schedule_json TEXT NOT NULL, PRIMARY KEY (user_id, routine_id, effective_from))`.
  - `j2_routine_ticks (user_id, routine_id TEXT NOT NULL, day TEXT NOT NULL, item_id TEXT NOT NULL, ticked INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, routine_id, day, item_id))`.
  - `j2_routine_days (user_id, routine_id TEXT NOT NULL, day TEXT NOT NULL, skipped INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, routine_id, day))`.
  - `j2_routine_reminder_claims (user_id, routine_id TEXT NOT NULL, day TEXT NOT NULL, claimed_at TEXT NOT NULL, PRIMARY KEY (user_id, routine_id, day))`.
  - `j2_trackers (id TEXT PRIMARY KEY, user_id, name TEXT NOT NULL, kind TEXT NOT NULL, unit TEXT, settings_json TEXT NOT NULL, created_at, updated_at, archived_at TEXT, deleted_at TEXT, save_seq INTEGER NOT NULL DEFAULT 1, source_gallery_id TEXT, source_template_key TEXT, UNIQUE(user_id, source_template_key))`, index `idx_j2_trackers_user (user_id, archived_at, deleted_at)`.
  - `j2_tracker_values (user_id, tracker_id TEXT NOT NULL, day TEXT NOT NULL, value REAL NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, tracker_id, day))`.
  - A comment above the block names W9-R2 and says all seven are purged with the account.
- Purge: add the seven names to `_DIRECT_USER_TABLES` under a "Notebook widgets phase 2 (Task 9.2)" comment.

- [ ] **Step 1: Write the failing tests** in `tests/test_routine_tracker_schema.py` (fresh db through `db.ensure_schema`):
  - `test_seven_tables_exist_with_user_id`: `PRAGMA table_info` of each lists `user_id` NOT NULL.
  - `test_primary_keys_are_per_member`: two members insert the same `(routine_id, day, item_id)`; both rows stay.
  - `test_unique_template_key_allows_many_nulls_and_refuses_a_second_key`: two NULL `source_template_key` rows for one member insert; two `"premarket_routine"` rows for one member raise `sqlite3.IntegrityError`; the same key for two members inserts.
  - `test_ensure_schema_is_idempotent`: a second `ensure_schema` raises nothing.
  - In `tests/test_account_tombstones.py`: `test_tombstone_replay_removes_every_routine_and_tracker_table`: seed all seven for a member and a control member, `account_tombstones.replay_on_db(conn, [uid])`, the member's rows are gone and the control's stay, table by table.
  - The derived manifest rail and the purge rail go green only with all seven listed.
- [ ] **Step 2:** Run `python -m pytest tests/test_routine_tracker_schema.py tests/test_account_deletion_manifest.py tests/test_journal_two_account_purge.py tests/test_account_tombstones.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement, then `python tools/account_deletion_manifest.py --write`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): routine and tracker tables, purged with the account`.

### Task 9.3: Done, consistency and runs, derived over the trading-days spine

**Files:**
- Create: `api/services/journal_two/routine_days.py` (pure: no I/O, no clock except arguments)
- Create: `api/services/journal_two/tracker_days.py` (pure)
- Modify: `api/services/journal_two/trading_days.py` (three helpers)
- Test: `tests/test_routine_days.py`, `tests/test_tracker_days.py`, `tests/test_trading_days.py`

**Interfaces:**
- Consumes: `trading_days.is_session`, `sessions`, `session_on_or_before`, `today_et`, `beyond_note`; `session_calendar.close_time`; `measures.Measure`, `MeasureValue`, `DEFAULT_MIN_N` (`api/services/journal_two/measures.py`).
- Produces in `trading_days.py`: `next_session_after(d: date) -> date`; `session_on_or_after(d: date) -> date`; `nth_session_before(d: date, n: int) -> date` (the n-th session strictly before `d`).
- Produces in `routine_days.py`:
  - Constants: `WINDOW_SESSIONS = 7`, `CONSISTENCY_WINDOW = 20`, `RUN_SHOWN_FROM = 3`, `MILESTONES = (7, 21, 50, 100)`, `DONE_SHARES = (1.0, 0.75, 0.5)`, `MAX_HISTORY_SESSIONS = 3700` (R-8 parity), `SCHEDULE_KINDS = ("every", "weekdays", "traded")`, `STATE_LABELS = {"done": "Done", "not_done": "Not done", "skipped": "Skipped", "off": "Off day", "open": ""}`, `S_WINDOW = "Ticks can be added up to 7 trading days back."`.
  - Item JSON: `{"id": str, "text": str, "negative": bool, "suggest": {"rule": str, "n": int} | None, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" | None}`; `to` is exclusive. Schedule JSON: `{"kind": "every"}`, `{"kind": "weekdays", "days": [0..4]}` (Monday = 0), `{"kind": "traded"}`.
  - `@dataclass(frozen=True) class Item: id, text, negative, suggest, valid_from, valid_to`; `parse_items(raw: list) -> list[Item]`.
  - `@dataclass(frozen=True) class DayState: day: str; state: Literal["done","not_done","skipped","off","open"]; ticked: int; of: int` and `partial_label(ds) -> str | None` (`"4 of 6"`, None when `of == 0`).
  - `items_on(items, day: date) -> list[Item]`; `schedule_on(schedules: list[tuple[str, dict]], day: date) -> dict | None` (the row with the greatest `effective_from <= day`); `is_scheduled(schedule: dict | None, day: date, traded: frozenset[str]) -> bool` (`every`: a session; `weekdays`: a session on a chosen weekday; `traded`: `day.isoformat() in traded`).
  - `day_state(*, items, schedule, ticks: dict[str, bool], skipped: bool, day: date, today: date, created: date, traded: frozenset[str], done_share: float) -> DayState`: `off` before `created` or when not scheduled; `skipped` when skipped; `done` when `ticked >= ceil(done_share * len(items_on(day)))` and at least one item applies; `open` when `day >= today` and not done; else `not_done`. Only ticks of items valid that day count.
  - `history(*, items, schedules, ticks_by_day: dict[str, dict[str, bool]], skipped_days: frozenset[str], created: date, upto: date, today: date, traded: frozenset[str], done_share: float) -> list[DayState]`: every session (and every weekday past the horizon) from `max(created, upto - MAX_HISTORY_SESSIONS sessions)` to `upto`, oldest first, plus `traded` days for a `traded` schedule.
  - `@dataclass(frozen=True) class Consistency: done: int; scheduled: int; skipped: int`; `consistency(states, *, strict: bool, window: int = CONSISTENCY_WINDOW) -> Consistency | None`: over the newest `window` scheduled, non-open states; None when there are none. `consistency_rate(c, *, strict) -> float | None`: `done / (scheduled - skipped)`, strict `done / scheduled`, None on a zero denominator.
  - `consistency_sentence(c: Consistency | None, unit: Literal["trading days", "days you traded"]) -> str | None`: `"18 of the last 20 trading days (2 skipped)"`, without the parenthesis when `skipped == 0`, None for None. `unit` is `"days you traded"` for a `traded` schedule.
  - `@dataclass(frozen=True) class Runs: current: int; best: int`; `runs(states, *, strict: bool) -> Runs`: `done` extends a run; `skipped` neither extends nor breaks it unless `strict`; `off` and `open` are ignored; `not_done` breaks it.
  - `run_line(current: int) -> str | None`: None under 3, else `"<n> sessions in a row"`. `is_milestone(current) -> bool`: `current in MILESTONES`. `best_line(r: Runs) -> str | None`: `"Best run: <n> sessions"` only when `r.current < 3 <= r.best`.
  - `write_window(today: date) -> tuple[date, date]`: `(nth_session_before(today, 7), next_session_after(today))`; `in_window(day, today) -> bool`.
  - `ROUTINE_MEASURES: dict[str, Measure]` over routine-history rows `{routine, day, state, ticked, of, strict, consistency}`: `routine_consistency` ("Consistency", theme `process`, unit `days`, kind `rate`, done / (scheduled - skipped), strict rows count a skip as not done), `routine_completion_pct` ("Completion %", `rate`, done / scheduled), `routine_days_done` ("Days done", `count`), `routine_best_run` ("Best run", `extreme`, per routine in day order). Each `sources=frozenset({"routine_history"})`, `min_n = DEFAULT_MIN_N`.
- Produces in `tracker_days.py`:
  - `KINDS = ("yesno", "number", "scale", "duration")`, `KIND_LABELS = {"yesno": "Yes / no", "number": "Number", "scale": "1-5 scale", "duration": "Duration"}`, `UNIT_MAX = 16`, `DURATION_MAX_MIN = 1440`, `NUMBER_ABS_MAX = 1e9`.
  - Sentences: `S_YESNO = "Pick yes or no."`, `S_SCALE = "Pick a value from 1 to 5."`, `S_NUMBER = "Enter a number."`, `S_DURATION = "A duration can be at most 24 hours."`, `S_UNIT = "A unit can be at most 16 characters."`.
  - `clean_value(kind: str, raw: Any) -> float` (raises `ValueError(sentence)`; a bool is never a number; strings are refused; NaN and Infinity refused; duration in minutes, `0 <= v <= 1440`).
  - `format_value(kind, value, unit) -> str` (`"Yes"`/`"No"`, `"3"`, `"7h 30m"`, `"6.5 h"` with the unit).
  - `@dataclass(frozen=True) class Bucket: label: str; lo: float | None; hi: float | None` (lo inclusive, hi exclusive); `buckets(kind, values: list[float], unit: str | None) -> list[Bucket]`: yes/no `["Yes", "No"]`; scale `["1-2", "3", "4-5"]`; number and duration with 3 or more distinct values: terciles of the sorted distinct values (edges at index `k // 3` and `2k // 3`) labelled `"Under <a><unit>"`, `"<a>-<b><unit>"`, `"<b><unit> or more"` (duration in whole hours, `"6h"`); fewer distinct values: one bucket per value. `bucket_of(bs, v) -> str | None`.
  - `TRACKER_MEASURES: dict[str, Measure]` over tracker-history rows `{tracker, day, value}`: `tracker_avg` ("Average", `average`), `tracker_min` ("Lowest", `extreme`), `tracker_max` ("Highest", `extreme`), `tracker_latest` ("Latest", `extreme`, newest day), `tracker_entries` ("Entries", `count`); unit `entries`, `sources=frozenset({"tracker_history"})`. "Change vs previous period" is the builder's compare view over `tracker_avg`, not a measure.

- [ ] **Step 1: Write the failing tests** (`tests/test_routine_days.py`; dates are real 2026 sessions):
  - `test_weekend_and_thanksgiving_are_off`: an `every` routine, `history` over 2026-11-23..2026-11-29 marks 11-26 and 11-28 `off`.
  - `test_half_day_is_scheduled`: 2026-11-27 is not `off`.
  - `test_beyond_horizon_counts_weekdays`: a range across `horizon()` schedules weekdays only after it.
  - `test_schedule_change_applies_from_its_day_only`: `every` from 2026-10-01, `weekdays [0,2,4]` from 2026-10-14; 2026-10-13 (Tue) scheduled, 2026-10-20 (Tue) `off`.
  - `test_item_added_today_does_not_count_yesterday` and `test_removed_item_stops_counting_from_its_removal_day`.
  - `test_renamed_item_keeps_its_ticks` (same id, new text).
  - `test_done_share_three_quarters_of_four_needs_three`: `ceil(0.75 * 4) == 3`.
  - `test_today_not_done_is_open_and_not_counted`.
  - `test_before_created_is_off`.
  - `test_skip_never_breaks_a_run_unless_strict`: done, skipped, done → `current == 2` forgiving, `1` strict.
  - `test_consistency_sentence_exact`: `"18 of the last 20 trading days (2 skipped)"`, `"5 of the last 6 trading days"`, `"9 of the last 10 days you traded"`, and None for a routine with no past scheduled day.
  - `test_strict_rate_counts_skips`: 18 done, 2 skipped: forgiving 1.0, strict 0.9.
  - `test_run_line_hidden_under_three_and_never_zero`: `run_line(0)`, `(1)`, `(2)` are None; `(3) == "3 sessions in a row"`.
  - `test_milestones_exact`: true for 7, 21, 50, 100 only.
  - `test_best_line_only_after_a_run_ends`.
  - `test_write_window_counts_sessions`: today 2026-12-01 → `(2026-11-19, 2026-12-02)`; today Saturday 2026-11-28 → latest 2026-11-30; today 2026-11-25 → latest 2026-11-27.
  - `test_traded_schedule_off_on_a_day_without_trades`.
  - `test_routine_measures_match_their_rates` (consistency vs completion on 18 done, 2 skipped, 0 not done: 1.0 and 0.9).
  - In `tests/test_trading_days.py`: `test_next_session_after_skips_thanksgiving` (2026-11-25 → 2026-11-27), `test_nth_session_before_seven_from_dec_1` (→ 2026-11-19), `test_session_on_or_after_saturday_is_monday`.
  - `tests/test_tracker_days.py`: `test_clean_value_refuses` (parametrised: `float("nan")`, `"1e309"`, `float("inf")`, `True` for number, `6` and `2.5` for scale, `-5` and `1441` for duration, `2` for yes/no, each with its sentence), `test_buckets_terciles_label_sleep` (values 4..9 hours as minutes give `"Under 6h"`, `"6h-8h"`, `"8h or more"`), `test_buckets_few_distinct_values`, `test_scale_and_yesno_buckets`, `test_tracker_latest_is_newest_day`.
- [ ] **Step 2:** Run `python -m pytest tests/test_routine_days.py tests/test_tracker_days.py tests/test_trading_days.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): routine day states, consistency and runs derived over the market calendar`.

### Task 9.4: The routine store: CRUD, schedules, ticks, skips and the batched read

**Files:**
- Create: `api/services/journal_two/routines.py`
- Test: `tests/test_routines_store.py`, `tests/test_routines_isolation.py`

**Interfaces:**
- Consumes: Task 9.2's tables; Task 9.3's `routine_days` (all of it) and `trading_days`; `widget_definitions._begin_immediate`; `filters._DAY`, `filters.ANALYTICS_INCLUDED_SQL`; `timeutil.compute_trading_day_et`; `sample_marker.not_sample_sql`.
- Produces:
  - Constants: `COUNT_CAP = 30`, `ITEMS_CAP = 25`, `NAME_MAX = 80`, `ITEM_MAX = 200`, `RECENTLY_DELETED_DAYS = 30`, `READ_IDS_MAX = 30`, `READ_DAYS_MAX = 31`, `KIND = "routine"`.
  - Sentences: `S_CAP = "You have 30 routines. Archive one in My tools to make room."`, `S_CONFLICT = "Changed in another tab. Reload to see the newer version."`, `S_NOT_FOUND = "Not available."`, `S_ARCHIVED = "Archived routine, history only"`, `S_WINDOW = routine_days.S_WINDOW`, `S_BAD_NAME = "Give the routine a name."`, `S_NAME_LONG = "A name can be at most 80 characters."`, `S_TOO_MANY_ITEMS = "A routine can hold up to 25 items."`, `S_ITEM_LONG = "An item can be at most 200 characters."`, `S_NO_ITEMS = "Add at least one item."`, `S_BAD_SCHEDULE = "Pick when this routine runs."`, `S_BAD_DAY = "Dates need to look like 2026-10-24."`, `S_ARCHIVE_FIRST = "Archive this routine before deleting it."`, `S_TYPE_NAME = "Type the routine's name exactly to delete it."`, `S_UNKNOWN_ITEM = "That item isn't in this routine."`.
  - Errors: `class RoutineError(ValueError)` (`.sentence`), `NotFound(RoutineError)`, `Conflict(RoutineError)`, `OutsideWindow(RoutineError)`, `ReadOnly(RoutineError)`.
  - Settings JSON: `{"done_share": 1.0 | 0.75 | 0.5, "strict": bool, "reminder": {"on": bool, "time_et": "HH:MM"} | None}`; `time_et` minutes are a multiple of 5. Defaults `{"done_share": 1.0, "strict": False, "reminder": None}`.
  - `create(user_id, *, name, items: list[dict], schedule: dict, settings: dict | None = None, source_template_key: str | None = None, now=None, conn=None) -> dict`: new items get `uuid4` ids and `from = today ET`; writes one schedule row `effective_from = today`. A second create with the same `source_template_key` returns the existing routine (unique key), never a second row.
  - `get(user_id, rid, *, conn=None) -> dict | None`: `{id, name, items (valid today, in order), schedule (effective today), settings, archived, deleted, etag, createdDay, updatedAt, usedIn}` (`usedIn` is 0 until Task 9.10).
  - `update(user_id, rid, *, if_match: int, name=None, items=None, schedule=None, settings=None, now=None) -> dict`: `save_seq != if_match` raises `Conflict`. Items diff by id: a known id with new text keeps its id and history; a missing id gets `to = today`; a new entry gets a new id and `from = today`. A schedule change writes the row for `effective_from = today` (replacing a same-day row). Nothing earlier is rewritten. Bumps `save_seq`.
  - `list_routines(user_id, *, filter: Literal["active","archived","deleted"] = "active") -> list[dict]` (hard-deletes the member's rows deleted more than 30 days ago, with their schedules, ticks, days and claims).
  - `archive`, `unarchive`, `soft_delete(user_id, rid, *, typed_name)` (only from archived and only when `typed_name == name`), `undelete`, `duplicate(user_id, rid) -> dict` (`"<name> copy"`, items with new ids, history not copied).
  - `traded_days(conn, user_id, lo: str, hi: str) -> frozenset[str]`: ET days with a closed trade (`filters._DAY`, flagged trades excluded), an opened trade or open position (entry day through `compute_trading_day_et`, `entry_estimated` positions excluded), or an options strategy opened or closed (`trading_day_et`, else the ET day of `closed_at` / `created_at`).
  - `set_tick(user_id, rid, day: str, item_id: str, ticked: bool, *, now=None) -> dict` and `set_skipped(user_id, rid, day: str, skipped: bool, *, now=None) -> dict`: `BEGIN IMMEDIATE`; ownership re-checked inside the transaction (`SELECT 1 FROM j2_routines WHERE id = ? AND user_id = ? AND deleted_at IS NULL`); an archived routine raises `ReadOnly(S_ARCHIVED)`; a day outside `routine_days.write_window` raises `OutsideWindow`; an item not valid that day raises `RoutineError(S_UNKNOWN_ITEM)`. Upsert one row; return `day_entry(...)` for that day.
  - `read_days(user_id, ids: list[str], days: list[str], *, now=None) -> dict`: at most 30 ids and 31 days (else `RoutineError`); a day value `"today"` resolves to `trading_days.session_on_or_after(today_et)`. Returns `{"resolved": {"today": "YYYY-MM-DD"}?, "routines": {id: Read}}`, foreign, unknown and deleted ids absent. `Read = {"routine": {id, name, items, settings, archived, scheduleKind}, "days": {day: DayEntry}}`.
  - `DayEntry = {"day", "state", "label" (STATE_LABELS), "ticked": {itemId: bool}, "skipped": bool, "partial": "4 of 6" | None, "items": [{id, text, negative}] (valid that day), "writable": bool, "beyondNote": str | None, "consistency": str | None (the sentence, as of that day), "rate": float | None, "run": {"line": str | None, "milestone": bool, "best": str | None}}`. History is read for at most `MAX_HISTORY_SESSIONS` sessions back.
  - `import_day_rules(user_id) -> list[str]`: the labels of the newest `j2_day_notes` row whose `rules` list is non-empty (`[{id, label, checked}]`), stripped, de-duplicated, at most 25.
  - `STARTERS: dict[str, dict]` and `starters() -> list[{key, name, items: [{text, negative, suggest}]}]`, exactly:
    - `premarket`, "Pre-market routine": "Read the morning wire", "Check today's economic calendar", "Review open positions and stops", "Mark key levels on my watchlist", "Set my max loss for today".
    - `preentry`, "Pre-entry checks": "The setup is in my playbook", "My stop is set before entry", "Size fits my risk per trade", "The market is not against the trade".
    - `eod`, "End-of-day review": "Log every trade", "Tag setups and mistakes", "Save a screenshot of my best and worst trade", "Write one lesson", "Build tomorrow's watchlist".
    - `rules`, "Rules I keep": "Stop on every trade" (`suggest {"rule": "stop_every_trade"}`), "Max 3 trades" (`{"rule": "max_trades", "n": 3}`), "Stayed under my daily loss limit" (`{"rule": "under_daily_loss_limit"}`), "No trade within 10 min of a loss" (negative, `{"rule": "no_trade_after_loss", "n": 10}`), "No revenge trades" (negative, `{"rule": "no_revenge"}`).
  - ⛔ This module contains no `j2_notes` SQL except Task 9.10's read-only `used_in_notes` join.

- [ ] **Step 1: Write the failing tests** (`tests/test_routines_store.py`, seeded sqlite through `db.ensure_schema`, `now=` injected):
  - `test_create_get_owned_only` and `test_cap_30_sentence`.
  - `test_field_caps` (name 81, item 201, 26 items, no items, bad schedule kind, `time_et "09:07"` each refused with its sentence).
  - `test_template_key_create_is_idempotent`.
  - `test_update_if_match_conflict_and_etag_bumps`.
  - `test_rename_item_keeps_history_remove_applies_from_today` (a tick on 2026-10-20 still counts for that day after the item is removed on 2026-10-22).
  - `test_schedule_change_never_rewrites_past_days`.
  - `test_tick_window_refuses_eighth_session_back_and_two_sessions_ahead` (today 2026-12-01: 2026-11-19 accepted, 2026-11-18 refused, 2026-12-02 accepted, 2026-12-03 refused, each with `S_WINDOW`).
  - `test_concurrent_ticks_both_survive`: two threads tick items A and B of one day at once; the read shows both ticked.
  - `test_tick_returns_merged_day` (the returned `DayEntry` equals `read_days` for that day).
  - `test_archived_is_read_only`.
  - `test_today_token_resolves_to_next_session_on_saturday`.
  - `test_consistency_and_run_lines_as_of_the_bound_day`.
  - `test_new_routine_has_no_consistency_or_run_line` (both None).
  - `test_traded_days_excludes_estimated_entries_and_flagged_trades`.
  - `test_import_day_rules_newest_non_empty_dedup`.
  - `test_starters_exact_text`.
  - `test_soft_delete_needs_archive_and_typed_name` and `test_deleted_purged_after_30_days_with_children`.
  - `test_no_j2_notes_write`: wrap the connection with a trace callback (`conn.set_trace_callback`) and assert no statement containing `j2_notes` runs during create, update, tick, skip and read.
  - `tests/test_routines_isolation.py`: member B's get, update, tick, skip, archive and read of A's id give None, `NotFound` or no row; a read naming A's and B's ids answers only B's; an item id of A's routine in B's tick is refused.
- [ ] **Step 2:** Run `python -m pytest tests/test_routines_store.py tests/test_routines_isolation.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): routine store with per-item ticks, versioned schedules and the batched day read`.

### Task 9.5: The tracker store, with check-ins as two read-only trackers

**Files:**
- Create: `api/services/journal_two/trackers.py`
- Test: `tests/test_trackers_store.py`, `tests/test_routines_isolation.py` (tracker cases)

**Interfaces:**
- Consumes: Task 9.2's tables; `tracker_days` (Task 9.3); `routine_days.write_window`; `widget_definitions._begin_immediate`; the check-in rule of `widget_engine.sources._checkins` (latest by the note's `updated_at`, trashed and sample notes excluded): import and call it, never copy it.
- Produces:
  - Constants: `COUNT_CAP = 30`, `NAME_MAX = 80`, `KIND = "tracker"`, `RECENT_MAX = 30`, `DAYS_CHOICES = ("trading", "any")`.
  - Built-ins: `BUILTIN = {"checkin:mood": {"name": "Check-in mood", "kind": "scale", "readOnly": True}, "checkin:focus": {"name": "Check-in focus", "kind": "scale", "readOnly": True}}`; ids namespaced so they can never collide with a `uuid4`.
  - Sentences: `S_CAP = "You have 30 trackers. Archive one in My tools to make room."`, `S_NOT_FOUND = "Not available."`, `S_ARCHIVED = "Archived tracker, history only"`, `S_READ_ONLY = "Mood and focus come from your check-ins."`, `S_TRADING_ONLY = "This tracker logs trading days only."`, `S_KIND_FIXED = "A tracker's type can't change. Make a new tracker instead."`, plus the `tracker_days` value sentences and `S_WINDOW`.
  - Settings JSON: `{"days": "trading" | "any"}` (default `"trading"`).
  - `create(user_id, *, name, kind, unit=None, settings=None, source_template_key=None, now=None, conn=None) -> dict`; `get(user_id, tid) -> dict | None` (`{id, name, kind, unit, settings, archived, deleted, etag, readOnly, usedIn}`; a built-in id answers its built-in row); `update(user_id, tid, *, if_match, name=None, unit=None, settings=None)` (a `kind` key raises `RoutineError`-style `TrackerError(S_KIND_FIXED)`); `list_trackers(user_id, *, filter)` (built-ins first on `active`); `archive`, `unarchive`, `soft_delete(typed_name)`, `undelete`, `duplicate` (as routines; built-ins refuse every write with `S_READ_ONLY`).
  - `set_value(user_id, tid, day: str, value: Any, *, now=None) -> dict`: `value is None` deletes the day's row; else `tracker_days.clean_value(kind, value)`; a `trading` tracker refuses a non-session day (`S_TRADING_ONLY`); window and ownership as routines, inside `BEGIN IMMEDIATE`. Returns `TrackerDay`.
  - `read_days(user_id, ids, days, *, now=None) -> dict`: `{"resolved"?, "trackers": {id: {"tracker": {...}, "days": {day: TrackerDay}, "recent": [{day, value}] (newest 30, oldest first), "average": float | None, "latest": {day, value} | None, "n": int}}}`. `TrackerDay = {"day", "value": float | None, "text": str | None (format_value), "writable": bool}`. Built-ins read `j2_note_checkins` through the shared check-in rule.
  - `TrackerError(ValueError)`, `NotFound`, `Conflict`, `OutsideWindow`, `ReadOnly` (same shape as Task 9.4's).

- [ ] **Step 1: Write the failing tests** (`tests/test_trackers_store.py`):
  - `test_create_each_kind_and_cap_30`.
  - `test_unit_17_chars_refused`.
  - `test_hostile_values_refused_and_store_nothing` (the Task 9.3 list through `set_value`, and a row count of 0 after).
  - `test_null_clears_the_day`.
  - `test_trading_tracker_refuses_saturday_any_day_tracker_accepts_it`.
  - `test_window_matches_routines`.
  - `test_kind_is_fixed`.
  - `test_builtins_listed_first_read_only_and_follow_latest_checkin`: two check-ins on one day, the later note's mood wins; a trashed note's check-in is gone; `set_value("checkin:mood", ...)` raises `ReadOnly`.
  - `test_recent_30_oldest_first_and_average`.
  - `test_no_j2_notes_write` (trace callback; the built-in READ of `j2_notes` is allowed, no write statement).
  - Tracker cases in `tests/test_routines_isolation.py`.
- [ ] **Step 2:** Run `python -m pytest tests/test_trackers_store.py tests/test_routines_isolation.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): tracker store with range-checked values and check-ins as read-only trackers`.

### Task 9.6: The routines and trackers router

**Files:**
- Create: `api/routers/notebook_routines.py` (two routers)
- Modify: `api/main.py` (`include_router` for both, beside the widget-definitions router)
- Test: `tests/test_routines_router.py`, `tests/test_user_definitions_auth.py`

**Interfaces:**
- Consumes: Tasks 9.4 and 9.5; `notebook_widgets.notebook_widgets_wave_on`; `public_note_payload.not_found`; `get_current_user_with_plan`, `is_paid_user`; `json_depth._json_depth_exceeds`; `api.limiter.limiter` (the `_rate` shape of `notebook_widget_definitions.py:155`).
- Produces:
  - `WAVE = 9`, `MAX_BODY = 8 * 1024`, `MAX_BODY_DEPTH = 16`, `WRITE_RATE = "120/minute"`, `SCOPE_WRITE = "notebook-routine-writes"`, `READ_RATE = "60/minute"`, `SCOPE_READ = "notebook-routine-reads"`, `S_RATE = "Too many changes in a minute. Try again shortly."`, `S_RATE_READ = "Too many reads in a minute. Try again shortly."`.
  - `routines_router = APIRouter(prefix="/api/j2/routines", dependencies=[Depends(_wave_gate)])` and `trackers_router = APIRouter(prefix="/api/j2/trackers", ...)`. The wave gate runs first and answers `public.not_found()` while `notebook_widgets_wave_on(9)` is false, read per request. Own `require_paid` with `HTTPException(status_code=402, detail="Routines and trackers require a paid plan")`. Every route a sync `def`; the body read by an async dependency `json_body` (8 KB, depth 16, 413/400 `invalid`).
  - Codes: `invalid` (400), `window` (400), `read_only` (400), `count_cap` (409), `conflict` (409; 428 when If-Match is missing, R-27), `rate` (429). Foreign, unknown and deleted ids: `public.not_found()`.
  - Routine routes (declared in this order so the literal paths win over `/{rid}`): `GET ""` (`?filter=active|archived|deleted`), `POST ""`, `GET /starters`, `GET /import-day-rules`, `POST /days` `{ids, days}`, `GET /{rid}`, `PUT /{rid}` (If-Match: etag; body `{name?, items?, schedule?, settings?}`), `POST /{rid}/archive`, `/unarchive`, `/delete` `{typedName}`, `/undelete`, `/duplicate`, `PUT /{rid}/days/{day}/items/{item_id}` `{ticked: bool}`, `PUT /{rid}/days/{day}` `{skipped: bool}`, `GET /{rid}/used-in` (an empty list until Task 9.10).
  - Tracker routes: `GET ""`, `POST ""`, `POST /days`, `GET /{tid}`, `PUT /{tid}`, `POST /{tid}/archive`, `/unarchive`, `/delete`, `/undelete`, `/duplicate`, `PUT /{tid}/days/{day}` `{value: number | bool | null}`, `GET /{tid}/used-in`. The `{tid}` path accepts `checkin:mood` and `checkin:focus`.
  - Writes (every `POST`/`PUT`) take the write scope; `POST /days` and every `GET` take the read scope. A tick, skip or log answers the merged `DayEntry` / `TrackerDay`.

- [ ] **Step 1: Write the failing tests** (`tests/test_routines_router.py`, the router mounted on a test app the way `tests/test_widget_definitions_router.py` mounts its own):
  - `test_all_routes_404_when_w9_off` (enumerated from both routers' `.routes`, with a non-vacuity count of at least 25).
  - `test_flag_read_per_request`.
  - `test_unpaid_402_own_sentence`.
  - `test_literal_paths_beat_the_id_route` (`GET /starters` and `POST /days` reach their handlers).
  - `test_tick_and_skip_return_the_merged_day`.
  - `test_window_400_code_and_sentence`.
  - `test_foreign_id_404_and_absent_from_days`.
  - `test_put_requires_if_match_428_and_409_on_stale`.
  - `test_count_cap_409_code`.
  - `test_body_over_8kb_refused_and_deep_body_refused`.
  - `test_write_rate_120_and_read_rate_60_separate_scopes`.
  - `test_every_200_is_no_store`.
  - `test_no_note_route_touched`: a spy on `notes` write functions sees zero calls across a tick, a skip and a log.
  - `tests/test_user_definitions_auth.py` passes with the new sentence distinct.
- [ ] **Step 2:** Run `python -m pytest tests/test_routines_router.py tests/test_user_definitions_auth.py -q`. Expected: FAIL (the known pre-existing screener-sentence red in `test_user_definitions_auth.py` `PER_ROUTER` stays; read it by name, it is not this task's).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS, apart from that one known red.
- [ ] **Step 5:** Commit: `feat(notebook): /api/j2/routines and /api/j2/trackers routes (dark, wave 9)`.

### Task 9.7: "vs P&L" comparisons and suggestions from the member's trades

**Files:**
- Create: `api/services/journal_two/routine_insights.py`
- Modify: `api/services/journal_two/routines.py` (`read_days` adds `suggested`)
- Modify: `api/routers/notebook_routines.py` (two read routes)
- Test: `tests/test_routine_insights.py`, `tests/test_routines_router.py`

**Interfaces:**
- Consumes: `widget_engine.sources.scan_days` (the day net incl. options, one row per session); `widget_engine.run._cover_plan("trading_days")` for the plan it scans with; `routines.read_days` internals (the history); `tracker_days.buckets`, `bucket_of`; `measures.small_sample` thresholds (`SMALL_SAMPLE_N = 20`, `DEFAULT_MIN_N = 5`); `revenge_detect.detect`; `placeholder_stop.is_placeholder_stop`; `accounts.own_account_size` and `daily_loss_limit_pct`; `session_calendar.close_time`.
- Produces:
  - `CAVEAT = "A comparison, not proof."`, `S_NO_DAYS = "No days with trades yet."`, `S_NOT_ENOUGH = "Not enough days yet ({n})"`, `SUGGEST_LINE = "From your trades: looks done"`.
  - `money(v: float) -> str`: whole dollars, `"+$95"`, `"−$40"` (U+2212), `"$0"`.
  - `Group = {"avg": float | None, "n": int, "sample": "" | "small" | "hide", "text": str}` (`text` is `"+$95 average (22 days)"`, or `S_NOT_ENOUGH` under 5, or `S_NO_DAYS` at 0).
  - `routine_vs_pnl(user_id, rid, *, now=None) -> dict | None`: `{"done": Group, "other": Group, "winRate": {"done": Group, "other": Group}, "sentence": str}`. Days are the routine's scheduled past sessions that had trades; "done" = state `done`, "other" = `not_done` and `skipped`. `sentence` = `"On days you finished it: +$95 average (22 days). Other days: −$40 (9 days). A comparison, not proof."`. Win rate is decisive trades won on those days (breakeven excluded). History bounded by `MAX_HISTORY_SESSIONS`. None for a foreign id.
  - `tracker_vs_pnl(user_id, tid, *, now=None) -> dict | None`: `{"buckets": [{"label", "avg", "n", "sample", "text"}], "sentence": str}`, e.g. `"Sleep under 6h: avg day −$210 (9 days); 6h-8h: +$95 (22 days). A comparison, not proof."` (the tracker's name, lower-cased first word kept as typed, before the first bucket).
  - `SUGGEST_RULES = ("stop_every_trade", "max_trades", "under_daily_loss_limit", "no_trade_after_loss", "no_revenge")` and `suggestions(conn, user_id, routine_items, days: list[str], *, now) -> dict[str, list[str]]`: per day, the ids of opted-in items whose rule holds, computed at read time and NEVER written. Only for a day that is past, or today after `close_time(today)`, and only when that day had at least one trade. `stop_every_trade`: every trade that day has a real stop (not a placeholder); `max_trades`: trades that day `<= n` (1-20); `under_daily_loss_limit`: day net (equity, net of fees) above `-(daily_loss_limit_pct / 100 * own_account_size)` for the account that has a limit, no suggestion when none has one; `no_trade_after_loss`: no entry within `n` minutes (default 10) after a losing exit, timed trades only, no suggestion if any trade that day is date-only; `no_revenge`: `revenge_detect.detect` finds nothing that day.
  - `read_days` `DayEntry` gains `"suggested": [itemId]`.
  - Routes: `GET /api/j2/routines/{rid}/vs-pnl` and `GET /api/j2/trackers/{tid}/vs-pnl` (read scope; 404 for a foreign id).

- [ ] **Step 1: Write the failing tests** (`tests/test_routine_insights.py`, seeded trades, option strategies and ticks):
  - `test_sentence_exact_and_caveat_always`: 22 done days averaging +95, 9 other days averaging −40 give exactly the spec sentence.
  - `test_counts_only_days_with_trades_and_includes_options`.
  - `test_under_5_not_enough_with_count_and_zero_says_no_days`.
  - `test_small_badge_under_20`.
  - `test_win_rate_excludes_breakeven`.
  - `test_tracker_buckets_sentence`.
  - `test_suggestion_never_written`: tick tables row count unchanged after a read with suggestions.
  - `test_suggestion_only_after_close_and_with_trades` (today 2026-10-27 at 15:00 ET: none; at 16:01 ET: present; a no-trade day: none).
  - One test per rule: `test_stop_every_trade_placeholder_fails`, `test_max_trades_three`, `test_daily_loss_limit_uses_own_account_size`, `test_no_trade_after_loss_ten_minutes_and_date_only_gives_none`, `test_no_revenge_uses_detector`.
  - Router: `test_vs_pnl_routes_read_scope_and_404_foreign`.
- [ ] **Step 2:** Run `python -m pytest tests/test_routine_insights.py tests/test_routines_router.py tests/test_routines_store.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): routine and tracker P&L comparisons and suggestions from your trades`.

### Task 9.8: Routine history and tracker history as builder sources

**Files:**
- Modify: `api/services/journal_two/widget_engine/plan.py` (`PLAN_VERSION`, `SOURCES`, `needed_version`, `ref` on filters and the split, tool-source rules)
- Modify: `api/services/journal_two/widget_engine/sources.py` (`Field.ref_kind`, four trading-days fields, two sources, `SOURCES`)
- Modify: `api/services/journal_two/widget_engine/measures.py` (`builder_measures` adds the tool measures)
- Modify: `api/services/journal_two/widget_engine/aggregate.py` (`_SINGULAR["entries"] = "entry"`)
- Modify: `api/services/journal_two/widget_engine/run.py` (`data_stamp`, `NO_SAMPLE_SOURCES`)
- Modify: `api/services/journal_two/widget_engine/drill.py` (`_SHAPE` rows)
- Modify: `api/services/journal_two/widget_engine/payload.py` (`S_EMPTY`)
- Modify: `api/services/journal_two/widget_definitions.py` (`plan_version` written from `needed_version`)
- Modify: `api/routers/notebook_widget_definitions.py` (catalog, vocabulary and run gating on wave 9)
- Test: `tests/test_widget_tool_sources.py` (new), `tests/test_widget_plan.py`, `tests/test_widget_engine_isolation.py`, `tests/test_widget_definitions_router.py`

**Interfaces:**
- Consumes: Tasks 9.3-9.5 (`routine_days.history`, `ROUTINE_MEASURES`, `TRACKER_MEASURES`, `tracker_days.buckets`, `routines`/`trackers` reads); wave 8's `Catalog`, `Field`, `Scan`, `Source`, `scan_days`, `aggregate.apply_filters`, `run.data_stamp`, `drill._SHAPE`.
- Produces in `plan.py`:
  - `PLAN_VERSION = 2`; `SOURCES = ("closed_trades", "open_positions", "trading_days", "routine_history", "tracker_history")`; `TOOL_SOURCES = frozenset({"routine_history", "tracker_history"})`.
  - A filter and a split may carry `ref: str` only for a field whose `ref_kind` is set, and must carry it there; a ref is a `uuid4` string, or `checkin:mood` / `checkin:focus` for a tracker. At most one distinct ref per kind in a plan: `S_ONE_REF = "A widget can look at one routine and one tracker."`. A tool source refuses one account (`S_TOOL_ACCOUNTS = "Routines and trackers cover all your accounts."`) and any `last_*_trades` range (`S_UNKNOWN_RANGE`).
  - `needed_version(plan: dict) -> int`: 2 when the source is in `TOOL_SOURCES` or any filter or split has `ref`, else 1. `upgrade_plan` maps v1 to the same dict. `uses_tools(plan) -> bool`.
- Produces in `sources.py`:
  - `Field.ref_kind: str | None = None`.
  - `DAY_FIELDS` gains `routine_done` (enum, split, `ref_kind="routine"`, bucket `("Done", "Not done", "Skipped")`, an off day leaves the split with the missing word `"an off day for this routine"`), `tracker_value` (number, filter only, `ref_kind="tracker"`), `tracker_bucket` (enum, split, `ref_kind="tracker"`, labels from `tracker_days.buckets`). `scan_days` writes `row["routine_done"]`, `row["tracker_value"]` and `row["tracker_bucket"]` for the plan's ref, resolved for the session member only (a foreign ref leaves them None).
  - `ROUTINE_FIELDS`: `day` (day, split), `weekday` (enum, split), `month` (enum, split), `routine` (enum, split, values are routine ids, labels from `routine_name`), `item` (split only: when the plan splits by item the scan yields one row per valid item per scheduled day, state Done when ticked, Not done when not, Skipped on a skipped day), `state` (enum, split, `("Done", "Not done", "Skipped")`), `consistency` (number, the rolling 20-day rate as of that day).
  - `TRACKER_FIELDS`: `day`, `weekday`, `month`, `tracker` (enum, split, ids including the two built-ins), `value` (number).
  - `ROUTINE_HISTORY = Source("routine_history", "Routine history", "Every scheduled day of your routines: done, not done or skipped.", "days", ROUTINE_FIELDS, scan_routines)` and `TRACKER_HISTORY = Source("tracker_history", "Tracker history", "Every value you have logged.", "entries", TRACKER_FIELDS, scan_trackers)`. Scans read only the session member's rows, scheduled days only for routines (off days never appear), newest first, at most 5,000 rows (`capped` past it), and never the sample book.
- Produces elsewhere:
  - `builder_measures()` adds `ROUTINE_MEASURES` and `TRACKER_MEASURES` (asserting no key shadows another, as for the positions measures).
  - `run.NO_SAMPLE_SOURCES = TOOL_SOURCES`: `run_plan` and `run_examples` never answer sample data for them; `sample_rows` raises `ValueError` for them.
  - `data_stamp`: `routine_history` reads `COUNT(*), MAX(updated_at)` of `j2_routine_ticks`, `j2_routine_days` and `j2_routines` plus `COUNT(*)` of `j2_routine_schedules`; `tracker_history` reads `j2_tracker_values` and `j2_trackers` plus the check-ins stamp; `trading_days` appends both.
  - `drill._SHAPE["routine_history"] -> {day, label (routine name), label2 (item text or None), state}` and `["tracker_history"] -> {day, label (tracker name), value, text}`.
  - `payload.S_EMPTY["routine_history"] = "Start ticking your routine; history shows here from day one."` and `["tracker_history"] = "Log your first value; the chart starts with it."`.
  - Router: while `notebook_widgets_wave_on(9)` is false, `GET /vocabulary` lists no tool source, ref field or tool measure, and `/run`, `/preview`, `/drill` and `PUT`/`POST` of a plan where `uses_tools(plan)` answer `public.not_found()` (the client's `unavailable`, "Not available right now."). `VOCAB_FIELDS` gains `"routine"` and `"tracker"` (`{id, name}`, built-ins included) only while wave 9 is on. The catalog's field rows carry `refKind`.

- [ ] **Step 1: Write the failing tests** (`tests/test_widget_tool_sources.py`):
  - `test_routine_history_rows_scheduled_days_only_newest_first`.
  - `test_split_by_item_expands_rows`.
  - `test_consistency_and_completion_measures_differ_on_skips`.
  - `test_tracker_history_includes_checkin_builtins`.
  - `test_trading_days_split_by_routine_done_and_off_day_footnote`.
  - `test_tracker_bucket_split_matches_vs_pnl_buckets` (same labels as `tracker_days.buckets`).
  - `test_foreign_ref_leaves_columns_empty`.
  - `test_empty_sentences_exact`.
  - `test_tool_sources_never_sample`: a member with 0 trades and 10 ticked days gets real rows, `sample: False`.
  - `test_stamp_busts_on_tick_and_value`.
  - `test_drill_rows_for_both_sources`.
  - In `tests/test_widget_plan.py`: `test_needed_version_v1_for_wave8_plans_v2_for_tools`, `test_ref_only_on_ref_fields_and_required_there`, `test_one_ref_per_kind`, `test_tool_source_refuses_one_account_and_last_n_trades`, `test_v2_plan_too_new_for_a_v1_server` (validate with `PLAN_VERSION` monkeypatched to 1 raises `PlanTooNew`).
  - In `tests/test_widget_engine_isolation.py`: both sources and the ref fields with a second member's routines, trackers and values present: nothing of B's appears in A's rows, labels or counts.
  - In `tests/test_widget_definitions_router.py`: `test_tool_plans_404_and_hidden_from_catalog_when_w9_off`, `test_vocabulary_routine_and_tracker_fields_when_w9_on`.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_tool_sources.py tests/test_widget_plan.py tests/test_widget_sources.py tests/test_widget_engine_isolation.py tests/test_widget_engine_fuzz.py tests/test_widget_run.py tests/test_widget_definitions.py tests/test_widget_definitions_router.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS (wave 8's own tests unchanged and green: no wave 8 plan changes version).
- [ ] **Step 5:** Commit: `feat(notebook): routine and tracker history as widget sources, behind wave 9`.

### Task 9.9: Bell reminders with a claim log

**Files:**
- Create: `api/services/journal_two/routine_reminders.py`
- Modify: `api/main.py` (register the job beside `_j2_note_tasks.register_task_reminder_job`, `:9376-9387`)
- Test: `tests/test_routine_reminders.py`

**Interfaces:**
- Consumes: `routines` (settings, schedules, day states), `routine_days.day_state`, `trading_days.is_session`, `session_calendar.close_time`, `is_half_day`; `api.services.alerts.add_alert`; `notebook_widgets_wave_on(9)`.
- Produces:
  - `SLOT_MINUTES = 5`, `ALERT_TYPE = "routine_reminder"`, `JOB_ID = "notebook_routine_reminders"`.
  - `slot_for(time_et: str, d: date) -> datetime | None`: None on a non-session day; on an early close, a time after the close moves back by the gap (`16:00 - close`), so 15:45 on a 13:00 close is 12:45; otherwise the stated time, ET-aware.
  - `due(conn, now: datetime) -> list[tuple[str, str, str, str]]`: `(user_id, routine_id, day, name)` for routines that are not archived or deleted, have `reminder.on`, are scheduled today, are not done or skipped today, and whose slot falls in `(now - 5 min, now]`. A slot outside that window (a deploy ate it) is never returned.
  - `run_due(now: datetime | None = None) -> dict`: returns `{"skipped": "flag off"}` without a read when wave 9 is off; else for each due row `INSERT OR IGNORE INTO j2_routine_reminder_claims` and, only when the insert took, `add_alert(ALERT_TYPE, name, "Your routine for today is ready.", severity="info", data={"routineId": rid, "day": day}, user_id=uid)`. Returns `{"claimed": n, "sent": n}`. A failed `add_alert` is logged and not retried (at most once per day).
  - `register_routine_reminder_job(scheduler) -> bool`: `CronTrigger(minute="*/5", timezone=ET)`, `max_instances=1`, `coalesce=True`, `misfire_grace_time=60`, `replace_existing=True`; the body looks `run_due` up at call time and never raises into the scheduler; the flag is read at run time, never at registration.

- [ ] **Step 1: Write the failing tests:**
  - `test_off_by_default_sends_nothing`.
  - `test_fires_once_per_routine_per_day` (two runs inside the slot: one alert, one claim).
  - `test_holiday_and_weekend_no_slot`.
  - `test_early_close_moves_the_slot` (2026-11-27, 15:45 → 12:45 ET).
  - `test_missed_slot_is_skipped_not_late` (run at 09:12 for a 09:00 slot sends nothing).
  - `test_done_or_skipped_today_sends_nothing`.
  - `test_bell_only_never_discord_or_email`: the `channels` out-dict reads `in_app: ok`, `discord: skipped`; a spy on `watchlist_alert_service.deliver_alert_payload` sees no call.
  - `test_flag_off_reads_nothing` (spy `get_connection`).
  - `test_registered_job_shape` (an AST check over `api/main.py` that the registration call exists, with a non-vacuity control naming the task-reminder registration beside it).
- [ ] **Step 2:** Run `python -m pytest tests/test_routine_reminders.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): optional routine reminders through the alert bell, once a day`.

### Task 9.10: "Used in" for routines and trackers

**Files:**
- Modify: `api/services/journal_two/notes.py` (`_sync_note_sidecars`, beside the `_BUILT_WIDGET_ID` branch `:501`)
- Modify: `api/services/journal_two/routines.py`, `api/services/journal_two/trackers.py` (`usedIn`, `used_in_notes`)
- Modify: `api/routers/notebook_routines.py` (`GET /{id}/used-in` answers the list)
- Modify: `tests/test_sample_never_feeds_real_numbers.py` (`GUARDED`: both stores join `j2_notes`)
- Test: `tests/test_tool_uses_projection.py`, `tests/test_routines_router.py`

**Interfaces:**
- Produces in `notes.py`: `_ROUTINE_ID = "routine"`, `_TRACKER_ID = "tracker"` (restated with the same ⛔ ONE FACT IN TWO FILES comment as `_BUILT_WIDGET_ID`, pinned by a test against the registry ids). A `routine` embed with a string `params.routineId` adds `(user_id, note_id, "routine", routineId, None)`; a `tracker` embed with `params.trackerId` adds `(user_id, note_id, "tracker", trackerId, None)`; same delete-and-insert, same transaction.
- Produces in the stores: `used_in_notes(user_id, tool_id) -> list[{noteId, title, updatedAt}]` joining `j2_notes` on `user_id` with `deleted_at IS NULL` and `sample_marker.not_sample_sql("n")`; `get()` and `list_*()` report `usedIn` as the count of distinct notes.

- [ ] **Step 1: Write the failing tests** (in `tests/test_tool_uses_projection.py`):
  - `test_routine_and_tracker_blocks_recorded_on_save`.
  - `test_two_blocks_in_one_note_count_one_note`.
  - `test_removing_block_clears_row` and `test_trashed_note_not_counted`.
  - `test_foreign_routine_id_in_my_note_not_counted_for_owner`.
  - `test_tool_ids_match_registry` (`_ROUTINE_ID`, `_TRACKER_ID` equal the registry ids `routine`, `tracker`, read from `app/src/widgets/registry.js` by text).
  - Router: `test_used_in_lists_notes`.
- [ ] **Step 2:** Run `python -m pytest tests/test_tool_uses_projection.py tests/test_routines_router.py tests/test_sample_never_feeds_real_numbers.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): used-in-notes for routines and trackers`.

### Task 9.11: Public pages: the account line for routine and tracker blocks

**Files:**
- Modify: `api/services/journal_two/public_note_payload.py` (`MARKET_DATA_VENDORS` near the `moodCheckIn` row `:293`; `_neutral_for_embed` `:1362`)
- Test: `tests/test_public_note_payload.py`, `tests/test_widget_engine_isolation.py`

**Interfaces:**
- Produces: `("widgetEmbed", "routine"): "private"`, `("widgetEmbed", "tracker"): "private"`; `ACCOUNT_LINE_BLOCKS = frozenset({"routine", "tracker"})`; `_neutral_for_embed(widget_id)` returns the `ACCOUNT_NEUTRAL_LINE` paragraph for an account kind OR an id in `ACCOUNT_LINE_BLOCKS`. `_is_account_kind` is unchanged, so the share switch never reveals a routine or tracker. Example mode drops them through the existing private branch (`_example_neutral`). Neither id joins `trader_blocks.BLOCK_IDS` (W9-R4).
- ⛔ This row lands BEFORE the registry rows (Tasks 9.13 and 9.14): `test_every_registered_widget_has_a_vendor_row` reds a registry id without a vendor row, and nothing reds the reverse.

- [ ] **Step 1: Write the failing tests:**
  - `test_routine_and_tracker_account_line_in_share_publish_gallery`, each with `params.share` false and `True`.
  - `test_routine_and_tracker_dropped_in_example_mode`.
  - `test_no_routine_name_or_day_state_in_public_output`: a body whose block searchText holds a canary routine name; the output JSON contains neither the canary nor the params.
  - In `tests/test_widget_engine_isolation.py`: a note body naming another member's routine and tracker ids reduces to the account line in every public mode and makes no database read (spy `get_connection`).
- [ ] **Step 2:** Run `python -m pytest tests/test_public_note_payload.py tests/test_widget_engine_isolation.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): routine and tracker blocks show the private account line on public pages`.

### Task 9.12: The client data layer: one batched read, per-item writes, adoption, offline

**Files:**
- Create: `app/src/pages/journal-2-0/lib/blocks/toolsApi.js` (a block file: `blockDoors.test.js` scans it)
- Create: `app/src/pages/journal-2-0/lib/blocks/toolDays.js`
- Modify: `app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js` (`WRITE_EXCEPTIONS` for `toolsApi.js`; `IMPORT_ALLOW` only if `toolDays.js` needs a module not yet listed)
- Test: `lib/blocks/toolsApi.test.js`, `lib/blocks/toolDays.test.js`, `lib/blocks/blockDoors.test.js`

**Interfaces:**
- Consumes: Task 9.6's routes and shapes (`DayEntry`, `TrackerDay`, the `{detail: {code, message}}` errors); `lib/calendar.js` `etDayOf`, `todayET` (already allow-listed for block files).
- Produces in `toolsApi.js`:
  - `ROUTINES_URL = '/api/j2/routines'`, `TRACKERS_URL = '/api/j2/trackers'`, `CHANNEL = 'uct-nb-tools'`.
  - `TOOL_COPY = Object.freeze({ offline: "You're offline. Ticks save when you're back online.", flagOff: 'Not available right now.', missing: 'Not available.', readFailedRoutine: "Can't load this routine right now.", readFailedTracker: "Can't load this tracker right now.", tickFailed: "Didn't save. Retry?", window: 'Ticks can be added up to 7 trading days back.', archivedRoutine: 'Archived routine, history only', archivedTracker: 'Archived tracker, history only' })`.
  - `isOffline() -> boolean` (`navigator.onLine === false`).
  - `readDay(kind: 'routine'|'tracker', id: string, day: string) -> Promise<{ok: true, entry, tool, resolvedDay} | {ok: false, code}>`: every call made in one macrotask joins ONE `POST <URL>/days` `{ids, days}` per kind (`setTimeout(0)` flush; `ids` and `days` de-duplicated; split into requests of at most 30 ids and 31 days). `code` is `'offline'` (no request), `'unavailable'` (404 on the route itself, or the wave gate), `'missing'` (200 without the id), `'rate'`, `'network'`.
  - `tick(routineId, day, itemId, ticked)`, `setSkipped(routineId, day, skipped)`, `logValue(trackerId, day, value)` -> `Promise<{ok: true, entry} | {ok: false, code, message}>`: each `fetch` names its method literally (`method: 'PUT'`); `code` from the server's detail (`window`, `read_only`, `rate`, `invalid`) or `offline`/`network`. A success publishes the merged entry to `subscribe` listeners in this page and on `BroadcastChannel(CHANNEL)` (guarded `typeof BroadcastChannel !== 'undefined'`).
  - `vsPnl(kind, id) -> Promise<{ok, data} | {ok: false, code}>` (GET).
  - `subscribe(kind, id, day, fn) -> () => void`: called with a merged entry from this page or another tab; also re-reads on `visibilitychange` to visible (one batched read for every subscribed pair).
- Produces in `toolDays.js`: `noteDayOf(note) -> string` (`note.dailyDate` when it is a `YYYY-MM-DD`, else `etDayOf(note.createdAt)`, else `todayET()`); `weekMonday(day) -> string` (UTC parts, no time zone drift); `forDayLabel(day, bind) -> string` (`'For Tue Oct 27'` for `2026-10-27`; for `bind === 'week'`, `'For the week of Oct 20'` from `weekMonday`); `toolSearchText(kind, name, day, bind) -> string` (`'[routine: Pre-market routine · For Tue Oct 27]'`, `'[tracker: Sleep · For Tue Oct 27]'`, built on `forDayLabel`); `localTimeBeside(timeEt, now = new Date()) -> string` (`'9:00 ET · 8:00 your time'` through `Intl.DateTimeFormat`, the local part omitted when the member's zone is ET).
- `WRITE_EXCEPTIONS['app/src/pages/journal-2-0/lib/blocks/toolsApi.js']` = five entries: `POST /api/j2/routines/days`, `PUT /api/j2/routines/{}/days/{}/items/{}`, `PUT /api/j2/routines/{}/days/{}`, `POST /api/j2/trackers/days`, `PUT /api/j2/trackers/{}/days/{}`, each `why` naming the tables it writes (or "a read sent as POST so ids never reach a query string") and "never a note".

- [ ] **Step 1: Write the failing tests:**
  - `six_reads_in_one_tick_make_one_request`: six `readDay('routine', …)` calls in one macrotask → one `fetch`, body `{ids:[…6], days:[…]}`; a tracker read in the same tick → a second request to the trackers URL.
  - `missing_id_resolves_missing_not_zero` and `404_resolves_unavailable`.
  - `offline_makes_no_request` (reads and writes).
  - `tick_publishes_merged_entry_to_page_and_channel` (a fake `BroadcastChannel` records the post; a second subscriber receives the entry).
  - `channel_message_reaches_subscriber`.
  - `visible_again_rereads_once`.
  - `write_error_code_and_message_from_detail`.
  - `toolDays`: `noteDayOf_prefers_daily_date_then_created_et_day` (a `createdAt` of `2026-10-28T03:30:00Z` gives `2026-10-27`), `forDayLabel_day_and_week`, `toolSearchText_exact`, `localTimeBeside_in_chicago_and_new_york`.
  - `blockDoors.test.js` passes with the five named entries, and fails (by name) when one is removed (its own controls).
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/lib/blocks/toolsApi.test.js src/pages/journal-2-0/lib/blocks/toolDays.test.js src/pages/journal-2-0/lib/blocks/blockDoors.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): routine and tracker client reads, per-item writes and tab-to-tab adoption`.

### Task 9.13: `RoutineBlock`, a live trader block

**Files:**
- Modify: `app/src/widgets/registry.js` (`routine` row after `moodCheckIn` `:1032`)
- Modify: `app/src/pages/journal-2-0/components/notebook/blocks/BlockNodeView.jsx` (`BLOCK_COMPONENTS.routine`)
- Modify: `app/src/pages/journal-2-0/lib/journalBlocks.js` (`TOOL_BLOCK_LABELS`, consulted by `blockLabel` before `SNAPSHOT_BLOCK_LABELS`)
- Modify: `app/src/pages/journal-2-0/components/notebook/blocks/useBlockParams.js` (`opts.searchText`)
- Modify: `app/src/pages/journal-2-0/lib/widgetEmbedCore.js` (`buildWidgetEmbedAttrs` takes `extra.searchText`)
- Modify: `app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx` (the `block_used` event is sent only for a `BLOCK_KINDS` id, so `routine` and `tracker` never send an out-of-enum kind)
- Create: `app/src/pages/journal-2-0/components/notebook/blocks/RoutineBlock.jsx` + `RoutineBlock.module.css`
- Modify: `app/src/pages/journal-2-0/lib/blocks/blockDoors.test.js` (`IMPORT_ALLOW`: `app/src/components/mobile/ContextPopover`, `app/src/components/ui/UIcon`, and the two lazy openers `components/notebook/routines/openRoutineEditor` and `components/notebook/myTools/openMyTools`, each with its reason)
- Test: `blocks/RoutineBlock.test.jsx`, `blocks/RoutineBlock.integrity.test.jsx`, `src/widgets/registry.test.js`, `blocks/blockParams.test.jsx`, `lib/blocks/blockDoors.test.js`, `lib/offline/doorEnumeration.test.js`, `src/styles/tapFloor.test.js`, `tests/test_public_note_payload.py`

**Interfaces:**
- Consumes: Task 9.12 (`readDay`, `tick`, `setSkipped`, `subscribe`, `isOffline`, `TOOL_COPY`, `forDayLabel`, `toolSearchText`); `BlockNodeView`'s body props `{params, setParams, editable, editor, attrs}`; `editor.storage.uctJournalWidgets.noteDay` (Task 9.19; absent → `todayET()`); Task 9.11's vendor row.
- Produces:
  - Registry: `routine: blockManifest('Routine', [{key: 'routineId', type: 'string', default: ''}, {key: 'day', type: 'string', default: ''}, {key: 'bind', type: 'string', default: 'note-day'}, {key: 'display', type: 'string', default: 'items'}], '[routine]')`, the fixed-string line form (the registry imports nothing from `lib/blocks`; the name-and-day search text is always written explicitly with `toolSearchText`, at insert and on each settings change); `bind` is one of `note-day`, `next-trading-day`, `week`, `today`; `display` one of `items`, `pnl`.
  - `TOOL_BLOCK_LABELS = Object.freeze({ routine: 'Routine', tracker: 'Tracker' })`.
  - `useBlockParams` setter: `setParams(patch, { searchText })` writes that string as `searchText` in the same `updateAttributes` call (one transaction).
  - `RoutineBlock` renders, for the bound day (`bind === 'today'` reads the day `'today'`, else `params.day`, else the note's day): the line `forDayLabel(...)`; each valid item as a 44 px checkbox named by its text (`aria-checked`; a negative item's tick reads "Didn't happen"); the partial `"4 of 6"`; a Skip toggle ("Skip this day" / "Skipped"); the consistency sentence; the run line (a milestone reads the same words with an accent class); the best-run line. A not-done past day shows the text "Not done" with a `title` tooltip, never red, never struck through.
  - States, each with its exact copy and nothing invented: loading (`BlockLoading`); `unavailable` → `TOOL_COPY.flagOff`; `missing` → `TOOL_COPY.missing`; archived → read-only with `TOOL_COPY.archivedRoutine` and Restore in the ⋯ menu; offline → controls disabled and `TOOL_COPY.offline` (also on the `offline` event); read failed → `TOOL_COPY.readFailedRoutine` with a Retry button; tick failed → the tick rolls back visibly with `TOOL_COPY.tickFailed` and a Retry button; `writable === false` → read-only with `TOOL_COPY.window`; `editable === false` → the items and lines without controls.
  - ⋯ menu (`ContextPopover`): "Edit routine" (dynamic `import('../routines/openRoutineEditor')`), "Manage…" (dynamic `import('../myTools/openMyTools')`, `tab: 'routines'`), "Follow today" / "Use this note's day" (each ONE `setParams({bind, day}, {searchText})` call), Restore when archived. The vs P&L control is Task 9.15's.
  - ⛔ The body never calls `setParams` on mount, on a read, on a tick, on a skip or on an adopted entry.
- Bytes: `registry.js`, `BlockNodeView.jsx`, `journalBlocks.js`, `useBlockParams.js`, `widgetEmbedCore.js` and `widgetEmbedNode.jsx` are eager; the body is lazy.

- [ ] **Step 1: Write the failing tests:**
  - `RoutineBlock.integrity.test.jsx` (a real TipTap editor holding one `routine` node; `fetch` mocked):
    - `open_makes_no_doc_change`: after the read resolves, the count of transactions with `docChanged` is 0 and no request went to `/api/j2/notes`.
    - `tick_makes_no_note_put_and_no_doc_change`.
    - `adopted_entry_from_another_tab_makes_no_doc_change`.
    - `follow_today_is_one_transaction_with_search_text`: one `docChanged` transaction; `searchText` reads `[routine: Pre-market routine · For Tue Oct 27]`.
  - `RoutineBlock.test.jsx` (rendered text, never state):
    - `renders_items_partial_consistency_and_run_line`.
    - `run_line_absent_under_three_and_no_zero_anywhere` (for runs 0-2 and a brand-new routine, `textContent` matches none of `/\b0 (of|sessions)\b/`, `/0%/`).
    - `milestone_21_one_line`.
    - `not_done_has_text_label_and_tooltip_no_strike` (no `line-through` in the computed class rules).
    - `flag_off_says_not_available_right_now`, `foreign_says_not_available`, `archived_read_only_with_restore`, `offline_disables_with_sentence`, `read_failure_sentence_and_retry_never_zero`, `tick_failure_rolls_back_and_retries`, `outside_window_read_only_with_sentence`.
    - `two_instances_adopt_one_tick` (two blocks of one routine and day, one tick, both show it).
    - `bound_day_note_day_and_week_label`.
    - `negative_item_reads_didnt_happen`.
  - `registry.test.js`: `routine` is `captureOnly` and `block: true`, in no menu, bound once in `BLOCK_COMPONENTS` (IR-B2), and its registry plain text is `[routine]`.
  - `blockParams.test.jsx`: `search_text_option_rides_the_same_update`.
  - `tests/test_public_note_payload.py` `test_every_registered_widget_has_a_vendor_row` stays green (Task 9.11's row).
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/blocks src/widgets/registry.test.js src/pages/journal-2-0/lib/blocks/blockDoors.test.js src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/styles/tapFloor.test.js` and `python -m pytest tests/test_public_note_payload.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both commands. Expected: PASS.
- [ ] **Step 5:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `feat(notebook): routine block, ticked in place without writing the note`.

### Task 9.14: `TrackerBlock`, a live trader block with its own small chart

**Files:**
- Modify: `app/src/widgets/registry.js` (`tracker` row after `routine`)
- Modify: `app/src/pages/journal-2-0/components/notebook/blocks/BlockNodeView.jsx` (`BLOCK_COMPONENTS.tracker`)
- Create: `app/src/pages/journal-2-0/components/notebook/blocks/TrackerBlock.jsx` + `TrackerBlock.module.css`, `blocks/TrackerChart.jsx` (inline SVG)
- Test: `blocks/TrackerBlock.test.jsx`, `blocks/TrackerBlock.integrity.test.jsx`, `src/widgets/registry.test.js`, `lib/blocks/blockDoors.test.js`, `src/styles/tapFloor.test.js`

**Interfaces:**
- Consumes: Task 9.12 (`readDay('tracker', …)`, `logValue`, `subscribe`), Task 9.13's patterns (`TOOL_BLOCK_LABELS.tracker`, `setParams(…, {searchText})`, the ⋯ menu).
- Produces:
  - Registry: `tracker: blockManifest('Tracker', [{key: 'trackerId', type: 'string', default: ''}, {key: 'day', type: 'string', default: ''}, {key: 'bind', type: 'string', default: 'note-day'}, {key: 'display', type: 'string', default: 'chart'}], '[tracker]')`; `display` one of `chart`, `pnl`.
  - Logging the bound day in one tap or keystroke: yes/no two buttons; scale five buttons (1-5); number an input that logs on Enter or blur; duration an `h:mm` input. Pressing the picked value again clears it (`value: null`). Values are sent as typed; the server's refusal sentence is shown beside the control and nothing is kept.
  - The body: `forDayLabel`, the logged value's `text`, "Average <x>" and "Latest <x>" with their counts ("from 12 entries"), and `TrackerChart` of the last 30 entries (`<polyline>` and `<circle>`, no chart engine) with a "Show as table" toggle rendering an HTML `<table>` of the same points.
  - Built-in check-in trackers (`checkin:mood`, `checkin:focus`) are read-only: no log controls, the line "Mood and focus come from your check-ins.".
  - States and copy exactly as Task 9.13, with `TOOL_COPY.readFailedTracker` and `TOOL_COPY.archivedTracker`; offline uses `TOOL_COPY.offline` verbatim.
  - ⛔ No `setParams` on mount, read, log or adoption.
- Bytes: `registry.js` and `BlockNodeView.jsx` are eager; the body is lazy.

- [ ] **Step 1: Write the failing tests:**
  - Integrity: `open_and_log_make_no_doc_change_and_no_note_put`.
  - `logs_each_kind_in_one_action` (yes/no click, scale click, number Enter, duration `7:30` Enter sends `450`).
  - `pressing_picked_value_clears`.
  - `refusal_sentence_shown_nothing_kept`.
  - `chart_last_30_and_table_alternative_same_points`.
  - `average_latest_with_counts_never_zero_on_empty` (a tracker with no values shows "Log your first value; the chart starts with it." and no "0").
  - `builtin_checkin_read_only_line`.
  - `flag_off_offline_read_failure_tick_failure_window_archived` (one case each, exact copy).
  - `registry.test.js`: `tracker` row, IR-B2 binding, plain text `[tracker]`.
  - The tap-floor rail.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/blocks/TrackerBlock.test.jsx src/pages/journal-2-0/components/notebook/blocks/TrackerBlock.integrity.test.jsx src/widgets/registry.test.js src/pages/journal-2-0/lib/blocks/blockDoors.test.js src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes check. Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `feat(notebook): tracker block, logged in one tap, with its last 30 entries`.

### Task 9.15: "vs P&L" and suggestions on the blocks

**Files:**
- Modify: `blocks/RoutineBlock.jsx`, `blocks/TrackerBlock.jsx` (+ their `.module.css`)
- Create: `blocks/VsPnlPanel.jsx`
- Test: `blocks/VsPnlPanel.test.jsx`, `blocks/RoutineBlock.test.jsx`, `blocks/TrackerBlock.test.jsx`

**Interfaces:**
- Consumes: Task 9.7's `GET …/vs-pnl` shapes and `DayEntry.suggested`; Task 9.12's `vsPnl`.
- Produces:
  - A control "P&L on days you finished it" on the routine block and "Compare with P&L" on the tracker block flips the body to `VsPnlPanel` in COMPONENT STATE (no note write). The panel fetches `vsPnl` lazily on first flip and renders the server's `sentence`, then per group its `text`, the "small sample" badge when `sample === 'small'`, and for routines the win-rate pair ("Win rate on days you finished it: 58% (22 days). Other days: 41% (9 days)."). `"A comparison, not proof."` is always the last line. A failed read says "Can't load the comparison right now." with Retry; never a zero.
  - `display: 'pnl'` (set from the ⋯ menu "Show the P&L comparison first", ONE `setParams` call) opens the block on the panel.
  - An item whose id is in the day's `suggested` shows `"From your trades: looks done"` beside it; it never ticks the item.

- [ ] **Step 1: Write the failing tests:** `flip_fetches_once_and_writes_no_note`, `caveat_always_last_line`, `not_enough_days_and_no_days_copy`, `small_badge`, `win_rate_pair`, `comparison_failure_retry_never_zero`, `suggestion_line_beside_item_never_ticks`, `display_pnl_opens_on_panel`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/blocks`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): P&L comparison and from-your-trades hints on routine and tracker blocks`.

### Task 9.16: The routine and tracker editors

**Files:**
- Create: `app/src/pages/journal-2-0/lib/toolsCrud.js` (lazy; imported only by the editors, the picker and My tools)
- Create: `app/src/pages/journal-2-0/components/notebook/routines/{RoutineEditorSheet,TrackerEditorSheet}.jsx` + `routines.module.css`, `routines/openRoutineEditor.js`, `routines/openTrackerEditor.js`
- Test: `routines/RoutineEditorSheet.test.jsx`, `routines/TrackerEditorSheet.test.jsx`, `lib/toolsCrud.test.js`, `src/styles/tapFloor.test.js`

**Interfaces:**
- Consumes: Task 9.6's CRUD routes, `GET /starters`, `GET /import-day-rules`; `toolDays.localTimeBeside`; `components/mobile/Sheet.jsx`.
- Produces in `toolsCrud.js` (never throws; `{ok, data} | {ok: false, code, message}`): `listTools(kind, filter)`, `getTool(kind, id)`, `createTool(kind, body)`, `saveTool(kind, id, etag, body)` (header `If-Match: <etag>`), `archiveTool`, `unarchiveTool`, `deleteTool(kind, id, typedName)`, `undeleteTool`, `duplicateTool`, `usedIn(kind, id)`, `starters()`, `importDayRules()`; `kind` is `'routine' | 'tracker'`.
- Produces: `openRoutineEditor({routineId?, starter?, onSaved?}) -> close()` and `openTrackerEditor({trackerId?, onSaved?}) -> close()`, each mounted on its own root, one at a time (the `SetsDialog.openSetsDialog` pattern).
- `RoutineEditorSheet`: one `Sheet`; name; items (add, reorder, rename, remove; at most 25; each with a "Negative" switch labelled "Counts when it didn't happen" and, for items that map to data, "Suggest from my trades" with the rule's own words and its number for `max_trades` and `no_trade_after_loss`); "Start from" chips for the four starters (new routines only); "Import my day rules"; schedule radio: "Every trading day" (default), "Chosen weekdays" (Mon-Fri toggles), "Only days I trade"; done share select "All items" / "3 of 4 items" / "Half the items"; strict switch "Count skipped days as not done"; reminder switch, OFF by default, with a time select in 5-minute steps and the line from `localTimeBeside` ("9:00 ET · 8:00 your time") and "Through the alert bell only.". Save creates or saves with If-Match; a conflict keeps the draft and shows "Changed in another tab. Reload to see the newer version."; the count cap shows "You have 30 routines. Archive one in My tools to make room."; a field refusal shows the server's sentence beside the field.
- `TrackerEditorSheet`: name; kind radio "Yes / no", "Number", "1-5 scale", "Duration" (fixed after create, with the server's sentence); unit (at most 16, for number); "Trading days" (default) / "Any day".
- Every control at least 44 px; Escape asks "Keep your changes?" only when something changed.

- [ ] **Step 1: Write the failing tests:** `create_from_starter_premarket_items_exact`, `import_day_rules_fills_items`, `negative_and_suggest_options`, `schedule_weekdays_toggles`, `reminder_off_by_default_shows_local_time_line`, `save_sends_if_match_and_conflict_keeps_draft`, `count_cap_sentence`, `field_refusal_beside_field`, `tracker_kind_fixed_after_create`, `unit_17_chars_refused_client_side_too`, `toolsCrud_never_throws_and_offline_no_request`, the tap-floor rail.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/routines src/pages/journal-2-0/lib/toolsCrud.test.js src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes check (the editors must add nothing to first open). Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `feat(notebook): routine and tracker editors with starters, schedules and an off-by-default reminder`.

### Task 9.17: The builder offers routine and tracker choices

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/widgetBuilder/sections/{WhichOnesSection,SplitSection}.jsx` (Task 8.15's)
- Modify: `app/src/pages/journal-2-0/lib/builtWidgets.js` (`loadVocabulary('routine'|'tracker')` passes through; `refKind` kept on catalog fields)
- Test: `widgetBuilder/toolRefs.test.jsx`, `widgetBuilder/WidgetBuilderSheet.test.jsx`

**Interfaces:**
- Consumes: Task 9.8's catalog (`sources` include the two tool sources while wave 9 is on; fields carry `refKind`); Task 8.15's builder state actions `addFilter`, `editFilter`, `setSplit`.
- Produces:
  - A filter or split on a field with `refKind` first asks "Which routine" / "Which tracker" (values from `loadVocabulary(refKind)`), stores `ref` on the filter or split, and its chip reads `"<routine name> is Done"` / `"Split by <tracker name>"`. A second, different routine or tracker in one widget is disabled with "A widget can look at one routine and one tracker.".
  - With the tool sources selected, the Accounts control is hidden and range choices `last_*_trades` are disabled with the server's reason.
  - The source tiles render whatever the catalog lists, so with wave 9 off the two tiles are absent (no client flag read).

- [ ] **Step 1: Write the failing tests:** `ref_field_asks_which_routine_then_values`, `chip_sentence_names_the_routine`, `second_routine_disabled_with_reason`, `tool_source_hides_accounts_and_disables_last_n_trades`, `tool_tiles_absent_when_catalog_omits_them`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgetBuilder`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): widget builder picks a routine or tracker for its history and day columns`.

### Task 9.18: My tools, Routines and Trackers tabs

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/myTools/MyToolsSheet.jsx` (Task 8.17's: the two tabs stop showing "Coming soon")
- Create: `myTools/RoutinesTab.jsx`, `myTools/TrackersTab.jsx`
- Modify: `myTools/UsedInList.jsx` (takes `kind`)
- Test: `myTools/RoutinesTab.test.jsx`, `myTools/TrackersTab.test.jsx`, `myTools/MyToolsSheet.test.jsx`, `src/styles/tapFloor.test.js`

**Interfaces:**
- Consumes: Task 9.16's `toolsCrud` and openers; Task 9.10's `usedIn`; Task 8.17's `openMyTools({editor, tab})`, `ContextPopover` rows, filters and `DeleteConfirm`.
- Produces:
  - `openMyTools({tab: 'routines' | 'trackers'})` opens on that tab.
  - Rows: name, a static glyph (`UIcon` `check` for routines, `graph` for trackers), "Used in <N> notes" (opens `UsedInList` for that kind), last edited, the schedule in words ("Every trading day", "Mon, Wed, Fri", "Only days I trade") or the tracker's kind and unit, and "From template: <name>" when `source_template_key` is set (none before wave 11).
  - Row actions: Open (the editor), Rename (`saveTool` with If-Match; the conflict sentence on 409), Duplicate, Archive with "It stays in your <N> notes. Its history is kept.", and the filters Active, Archived (Restore, "Delete permanently" with the name typed) and Recently deleted (Restore, kept 30 days). "Share to library" is not rendered (wave 11).
  - The two check-in trackers are listed first on Trackers as read-only rows with "From your check-ins" and Open only.
  - Phone: rows 56 px, actions in `ContextPopover`.

- [ ] **Step 1: Write the failing tests:** `routines_rows_with_schedule_words_and_used_in`, `trackers_rows_with_builtins_first_read_only`, `rename_if_match_conflict_sentence`, `archive_sentence_with_count`, `delete_only_from_archived_with_typed_name`, `recently_deleted_restore`, `opens_on_requested_tab`, `no_share_action_in_w9`, the tap-floor rail.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/myTools src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): My tools, Routines and Trackers tabs`.

### Task 9.19: `/routine`, `/track`, the Mine rows, the note's day and the first-run step

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx` (two items; routine and tracker rows in the Mine group from Task 8.18's `builtItems` loader)
- Create: `app/src/pages/journal-2-0/components/notebook/routines/ToolPicker.jsx`, `routines/openToolPicker.js`
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` (editor storage `noteDay`)
- Modify: `app/src/pages/journal-2-0/components/notebook/widgetBuilder/ExamplesGallery.jsx` (Task 8.16's: the first-run step)
- Test: `SlashMenu.tools.test.jsx`, `SlashMenu.items.test.jsx`, `routines/ToolPicker.test.jsx`, `widgetBuilder/ExamplesGallery.test.jsx`, the NoteEditorPage storage test

**Interfaces:**
- Consumes: Tasks 9.12 (`noteDayOf`, `toolSearchText`), 9.16 (openers, `toolsCrud.listTools`), 8.18 (`SLASH_GROUPS` `{id: 'tools', label: 'Mine'}`, `builtItems(query, editor)`, "Build a widget" first and "Manage my tools" last), 8.16 (`ExamplesGallery`, its `sample` flag).
- Produces:
  - `editor.storage.uctJournalWidgets.noteDay = () => noteDayOf(<the ref holding this render's note>)` (the `noteTicker` precedent).
  - Slash items, offered only while `widgetsWaveOn(9)`: "Routine (remembered daily)" (description "Tick it every trading day; it never changes the note", keywords `routine, habit, daily, pre-market, rules, process`) and "Tracker (one value a day)" (description "Log sleep, focus or anything once a day", keywords `track, tracker, sleep, mood, log, habit`). Each opens `openToolPicker({editor, kind})`: the member's non-archived routines (or trackers) plus "New routine" / "New tracker" (which opens the editor and inserts on save). Picking inserts `insertWidgetEmbed('routine', {routineId, day: noteDay, bind: 'note-day', display: 'items'}, {searchText: toolSearchText('routine', name, noteDay, 'note-day')})` (tracker alike, `display: 'chart'`). `/routine` and `/track` reach them through `rankedBlockItems` (title prefix).
  - Mine group (only while `widgetsWaveOn(9)`): after the widget rows, the member's routines then trackers, at most 5 each on a bare `/`, every match when typed; each row inserts its block directly, bound to the note's day.
  - With wave 9 off, the bare `/` list is unchanged item for item (the snapshot test of Task 8.18).
  - First-run (spec §5.2 step 1): when the examples gallery shows sample data and wave 9 is on, a card "Set up your pre-market routine (1 minute)" sits above the cards and opens `openRoutineEditor({starter: 'premarket'})`; saving from there inserts the routine at the caret when the builder was opened from a note. The Getting started list (`GettingStartedList.jsx`, rule D4) is not changed.
- Bytes: `SlashMenu.jsx` and `NoteEditorPage.jsx` are eager; the picker and openers are lazy (dynamic imports in the commands).

- [ ] **Step 1: Write the failing tests:** `routine_and_tracker_items_absent_when_w9_off_and_bare_list_unchanged`, `slash_routine_opens_picker_and_inserts_bound_to_note_day` (a daily note `2026-10-27` gives `day: '2026-10-27'`, and a note created `2026-10-28T03:30:00Z` gives `'2026-10-27'`), `search_text_static_name_and_day`, `mine_rows_after_widgets_five_each_bare`, `typed_query_lists_every_match`, `new_routine_from_picker_inserts_on_save`, `first_run_card_only_on_sample_and_w9_on`, `note_day_storage_function`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/SlashMenu src/pages/journal-2-0/components/notebook/routines src/pages/journal-2-0/components/notebook/widgetBuilder/ExamplesGallery.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`. Record the total and the remaining headroom in the commit message.
- [ ] **Step 6:** Commit: `feat(notebook): /routine, /track, routine and tracker rows in Mine, and the pre-market first step (dark)`.

### Task 9.20: Wave 9 verification and ship dark

- [ ] **Step 1:** Backend, by name: `python -m pytest tests/test_routine_tracker_schema.py tests/test_routine_days.py tests/test_tracker_days.py tests/test_trading_days.py tests/test_routines_store.py tests/test_trackers_store.py tests/test_routines_isolation.py tests/test_routines_router.py tests/test_routine_insights.py tests/test_widget_tool_sources.py tests/test_widget_plan.py tests/test_widget_sources.py tests/test_widget_engine_isolation.py tests/test_widget_engine_fuzz.py tests/test_widget_run.py tests/test_widget_definitions.py tests/test_widget_definitions_router.py tests/test_routine_reminders.py tests/test_tool_uses_projection.py tests/test_public_note_payload.py tests/test_notebook_flags.py tests/test_notebook_flag_table_form.py tests/test_notebook_flag_parse.py tests/test_account_deletion_manifest.py tests/test_journal_two_account_purge.py tests/test_account_tombstones.py tests/test_sample_never_feeds_real_numbers.py tests/test_user_definitions_auth.py tests/test_journal_styles_compose.py -q`. Expected: all PASS except the known `test_user_definitions_auth.py` `PER_ROUTER` screener red; totals line recorded.
- [ ] **Step 2:** Frontend, chunked: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/routines src/pages/journal-2-0/components/notebook/myTools src/pages/journal-2-0/components/notebook/widgetBuilder src/pages/journal-2-0/components/notebook/SlashMenu src/pages/journal-2-0/lib/toolsCrud.test.js src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js src/widgets src/styles src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/components/screener/reachable.test.js`. Expected: all PASS (`reachable.test.js:907`'s expired chart-engine parking note is a known red, not ours; read it by name); totals recorded.
- [ ] **Step 3:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`.
- [ ] **Step 4:** Browser walk on a local sandbox (`scripts/hub-sandbox.ps1`, the data dir passed from PowerShell, a paid walk account) with `NOTEBOOK_WIDGETS_W8_ENABLED=1` and `NOTEBOOK_WIDGETS_W9_ENABLED=1`, at 1200, 820 and 390 px:
  - `/routine` → New routine from the Pre-market starter → tick two items → reload: the note shows no unsaved change and both ticks are there;
  - open the same note in a second tab and tick a third item: both tabs show all three;
  - skip a day and read the consistency sentence;
  - go offline (devtools): controls disabled with the offline sentence;
  - `/track` → Sleep (duration) → log `7:30`; open a check-in tracker read-only;
  - flip "P&L on days you finished it" on a member with trades;
  - turn the reminder on for the next 5-minute slot and see one bell item, then none at the next slot;
  - build a widget over Routine history and over Trading days split by "routine done";
  - My tools: Routines and Trackers tabs, rename, archive, restore, delete permanently;
  - share the note and open the link in a private window: the account line in place of each block;
  - set `NOTEBOOK_WIDGETS_W9_ENABLED=0`, reload: each block says "Not available right now.", nothing else in the note changes;
  - at 390 px also with the keyboard open in a number tracker's input.

  Save the raw evidence to `docs/notebook/evidence/<run-id>/` and commit it before writing any summary (R-RAW). The VoiceOver pass on iOS Safari 17 runs on BrowserStack Live and is recorded in the same directory, by the operator who ran it.
- [ ] **Step 5:** In the same branch, add to `CLAUDE.md`'s single-process list (Journal 2.0 broker-sync section, the per-process state paragraph): the two scopes `notebook-routine-writes` (120/minute) and `notebook-routine-reads` (60/minute), keyed on the member, in-process only. Commit: `docs: single-process note for the routine and tracker rate scopes`.
- [ ] **Step 6:** Open a PR to master with the member-impact paragraph "Nothing changes for members: routines and trackers ship switched off." Merge, deploy, verify the new boot by the `/api/health` uptime reset and `tools/hub_nav_smoke.py --auth`.
- [ ] **Step 7:** Arming is the owner's flip: report `railway variables --service web --set NOTEBOOK_WIDGETS_W9_ENABLED=1` and its rollback `=0` (never a delete). When armed, update `docs/feature_flags.json` (`status: armed`, the service, the flip time) in the same docs push.

---

## Scan for conflicts

| Tasks | Shared file or interface | How it is kept safe |
|---|---|---|
| 9.2 → 9.4, 9.5 | the seven tables | 9.2 lands first; the stores only read and write its columns |
| 9.3 → 9.4, 9.5, 9.7, 9.8 | `routine_days`, `tracker_days`, `trading_days` helpers | pure module first; consumers import, never copy |
| 9.4, 9.7, 9.10 | `routines.py` | sequential: 9.4 creates, 9.7 adds `suggested`, 9.10 adds `usedIn` |
| 9.5, 9.10 | `trackers.py` | sequential |
| 9.6, 9.7, 9.10 | `api/routers/notebook_routines.py` | sequential; 9.7 and 9.10 add routes after the literal paths |
| 9.6, 9.9 | `api/main.py` | different blocks (`include_router` vs the scheduler); pathspec commits |
| 9.8 vs wave 8 | `plan.py`, `sources.py`, `run.py`, `drill.py`, `payload.py`, `widget_definitions.py`, `notebook_widget_definitions.py` | wave 8 backend is merged (`47e2602aed`); 9.8 runs after it; wave 8's own tests are in 9.8's run |
| 9.9 | `alerts.add_alert` | consumer only; no change to `alerts.py` |
| 9.10 vs wave 8 | `notes._sync_note_sidecars`, `j2_tool_uses` | additive branch beside `_BUILT_WIDGET_ID`; the 8.9 rails stay in the run |
| 9.11 → 9.13, 9.14 | vendor rows before registry rows | ordered; `test_every_registered_widget_has_a_vendor_row` is in 9.13's run |
| 9.12, 9.13, 9.14 | `lib/blocks/blockDoors.test.js` (`WRITE_EXCEPTIONS`, `IMPORT_ALLOW`) | sequential; each adds only its own entries |
| 9.13, 9.14 vs 8.13 | `registry.js`, `BlockNodeView.jsx` | 9.13 starts after 8.13 lands; 9.14 after 9.13 |
| 9.13, 9.14, 9.15 | `RoutineBlock.jsx`, `TrackerBlock.jsx` | sequential |
| 9.16, 9.18, 9.19 | `toolsCrud.js`, `openRoutineEditor`, `openTrackerEditor` | 9.16 produces; 9.18 and 9.19 consume |
| 9.17 vs 8.15, 8.16 | builder sections, `lib/builtWidgets.js` | 9.17 after 8.16 |
| 9.18 vs 8.17 | `MyToolsSheet.jsx`, `UsedInList.jsx` | 9.18 after 8.17 |
| 9.19 vs 8.13, 8.16, 8.18 | `SlashMenu.jsx`, `ExamplesGallery.jsx` | 9.19 after 8.18 |
| 9.13, 9.14, 9.16, 9.19 | `npm run build` into `app/dist` | one build at a time in `nbw-p2-impl` (R-9) |
