# Notebook P2 Tier 2 (part B): Earnings Follow-up and the Reminder Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two helpers that close the loop on a trade idea. After the session that first traded the earnings result of a name a member holds, watches or flagged, a notice offers "ORCL reported: write your follow-up". One press makes an "Earnings follow-up" note that links the member's own prep note and lists the quarter's expected and actual numbers and the price reaction, each with its source. A "Reminder" slash item puts a dated, unticked follow-up task in any note, and the new style ends with one, so the existing task reminder rings on the day.

**Architecture:**
- **The notice is a server job; the note is the member's press.** A scheduler job (`earnings_followup.py`, 16:45 ET and 18:00 ET mon-fri plus a boot catch-up) finds, per paid member, the names in their own sets whose reaction session closed today. It rings one bell per (member, symbol, report date) through `alerts.add_alert`, claimed in a table before delivery and capped at 3 a day. The server never writes a note (decision R5). The notice links to `/journal/notebook?followup=ORCL&reportDate=2026-10-14`, where a lazy card's "Write follow-up" makes the note.
- **The note is a styled create with one extra step, like `/plan`.** The card calls `createNoteViaApi({ kindId: 'earnings_followup', ticker, tags, earningsFollowup: { reportDate } })`. The server composes the built-in "Earnings follow-up" style (three headings and a reminder block). A new `followup_prefill` step, passed to `compose` as `after_build`, adds a link to the prep note and the numbers to the same body before the ONE insert. The numbers come from what `earnings_intel` already holds, which the job warmed. The create never waits on a vendor.
- **The reminder is an ordinary task.** No new node type and no new reader. The slash item types "Follow up @" in a new unticked `taskItem`, so the existing `@` date list (`DateSuggest`, `runDateCommand`) picks the date. The style's `reminder` block builds the same shape at create time, N trading days out. `note_tasks` already reads a `dateMention` in a task's own paragraph as its due date, so the Tasks view and the daily bell need no change.
- **One new switch.** `NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED` (enablement, default off) gates the job, the card and the prefill. The kind, the style, the reminder block and the Reminder slash item ride the armed `NOTEBOOK_JOURNAL_STYLES_ENABLED` or no switch at all (P0.9 precedent), so they are live on merge (O-T2B-2).

**Tech Stack:** FastAPI + SQLite (`auth.db`, `j2_` tables), APScheduler, React + Vite, TipTap 3, vitest + Testing Library, pytest, Python Playwright, NVDA (the owner's box only, muted).

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`: §P2 integrity rule (lines 226-232), Tier 2 items 11 and 12 (lines 273-275), P0.4 (lines 114-117), P0.9 (lines 133-134), §6 cross-cutting requirements (lines 361-378). Code map of what exists: `C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\tier2b-code-map.md`. Model plan (shape, rails, constraints): `docs/superpowers/plans/2026-10-14-notebook-p2-tier2-part-a.md`.

**Base:** Part A's tip `204234469b` (branch `notebook-t2a-assists`). One integration worktree `C:\Users\Patrick\uct-worktrees\notebook-t2b`, branch `notebook-t2b-followup`, written with a `.uct-session-owner` file. Tasks run one at a time in that worktree. Implementers never run in parallel: Tasks 3-7 share `journal_styles.py`, and Tasks 9-10 share the client's create path.

Every `file:line` below was read on `204234469b` when this plan was written. Each is a dated claim; Task 1 re-reads them on the base.

## Rulings this plan makes (each also in the PR body)

Each reads **Ruling: what. Why. Cost if wrong.**

- **R-T2B-1, who and which names.** Ruling: the job considers every paid member (`auth_middleware.is_paid_user`, the predicate `require_paid` uses, `api/middleware/auth_middleware.py:92`). For each one it reads their own names through `earnings_prep._member_sets` (`api/services/journal_two/earnings_prep.py:245-265`): open positions, watchlists and flagged names (`MEMBER_SOURCES`, `:58`). A name in two sets is ONE notice. Why: the controller's ruling 1, and the prep feature already proved this reader (it unions the journal's own open positions because `member_interest` misses them, `:249-260`). Cost if wrong: a member who sold before the report and does not watch the name gets no notice, which is the intended reading of "a holding".
- **R-T2B-2, which reports a run offers.** Ruling: the run on trading day T offers every report whose REACTION SESSION is T. `reaction_session(report_date, timing)` answers: a report dated a non-trading day reacts on the next trading day; `bmo` (before the open) and `dmh` (during market hours) react on their own date; `amc` (after the close) reacts on the next trading day. The run scans each calendar day from the previous trading day through T. So a Friday after-close report is offered on Monday, and a report before a holiday is offered on the session after it. Trading days come from `session_calendar.is_trading_day` (`api/services/session_calendar.py:168`), the one session authority. Why: the controller's ruling 1, made exact for weekends and holidays. Cost if wrong: none found. A provider that dates a report wrongly moves the notice by a day, and the note's quarter match tolerates three days (R-T2B-9).
- **R-T2B-3, an unknown report time counts as after the close.** Ruling: a report whose time no source names (no calendar cache entry, no Finnhub `hour`) is offered on the trading day after its date and counted in the run ledger as `timing_unknown`. Why: offering it on its own date could ring the bell before the reaction session has closed, which would be a notice about a reaction that has not happened yet. A day late is honest; a day early is not. Cost if wrong: a before-the-open report with no time on record reaches the member one session late.
- **R-T2B-4, the report time for a past day.** Ruling: `calendar_alerts._get_reporters_for_date_with_status` (`api/services/calendar_alerts.py:124-175`) names the symbols, and it returns symbols only. The time comes from `earnings_prep._timing_from_calendar_cache` (`earnings_prep.py:219-240`, cache reads only) and, when that is empty for any symbol on that day, ONE Finnhub call for the day through the shared `finnhub_client.fh_get` (the call shape `calendar_alerts.py:158` already uses), read for each row's `hour`. In a local sandbox that asked for the walk's calendar file (`earnings_prep.sandbox_calendar_active`, `:160-178`), the file is the whole answer and no vendor is called. Why: the controller's ruling 1 needs the time of a report dated yesterday, and the reporters lookup drops it. Cost if wrong: one extra Finnhub call per scanned day per pass, through the shared token bucket. Task 1 V4 measures what the lookup answers for a past date.
- **R-T2B-5, the switches.** Ruling: `NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED` (enablement, unset = off) gates the job, the card and the server prefill, read per run and per request. The job also needs `NOTEBOOK_JOURNAL_STYLES_ENABLED` (armed on web 2026-10-14), because the note it offers is a styled create; with styles off it rings nothing. The flag gets the full plumbing Part A's switch got (commit `6ddba86694`, nine files). Why: the controller's ruling 1, plus a notice must never lead to a create that 404s. Cost if wrong: arming the follow-up switch while styles is off does nothing, and the arming packet says so.
- **R-T2B-6, delivery, dedup and the cap.** Ruling: one bell per (member, symbol, report date) through `alerts.add_alert(FOLLOWUP_SOURCE, title, message, severity="info", data=..., user_id=...)` (`api/services/alerts.py:382`), with `data.source` and the alert type both `notebook_earnings_followup` and `data.research_url` the card's link. A claim table `j2_earnings_followup_log` is written with ONE atomic `INSERT OR IGNORE ... SELECT ... WHERE <count for this member and session day> < 3` before delivery, so the claim and the cap of 3 cannot race. A delivery that raises deletes its claim. A run ledger `j2_earnings_followup_runs` records every pass. Inside the cap, names go largest |reaction| first, an unmeasured reaction last, then by symbol. The rest are counted as `capped` and never written or delivered. Why: the controller's ruling 2, in `note_tasks`' claim-then-deliver idiom (`api/services/journal_two/note_tasks.py:439-501`). Cost if wrong: a member with four reports in one session sees the three biggest moves.
- **R-T2B-7, the member's press is a card on a route parameter.** Ruling: the notice links to `/journal/notebook?followup=SYM&reportDate=YYYY-MM-DD`. `NotebookTab` sees the parameter (beside its `?new=` deep link, `app/src/pages/journal-2-0/tabs/NotebookTab.jsx:1907-1929`) and renders a lazy `FollowupOffer` card: "Earnings follow-up for ORCL", "Write follow-up", "Not now". The press goes through `createFollowupNote`, a copy of Part A's `createPlanNote` shape (`lib/planCreate.js:17-27`): `createNoteViaApi`, then `settleNoteWrite`. Then the tab opens the note. There is no duplicate check: each press is the member's decision. Why: the controller's ruling 3 asks for the smallest reuse of the `/plan` create path. A route parameter needs no new sheet. Opening the notice link already marks the notice read (`NoticesBox.jsx:61`), so the note must not be made by the link itself. Cost if wrong: a member who opens the same link twice can make two notes.
- **R-T2B-8, the kind and the style.** Ruling: a new built-in kind `earnings_followup` ("Earnings follow-up", icon `edit`) sits after `earnings` in `note_kinds.BUILTIN_NOTE_KINDS`. A new built-in style of the same id holds the three headings ("What I expected", "What happened", "What I'll do differently") and one `reminder` block. The headings are ONE constant, `journal_styles.FOLLOWUP_HEADINGS`, read by the outline and by the prefill. Task 4 updates every ONE-FACT-IN-TWO-FILES pair listed in its census. Why: the controller's ruling 4. Cost if wrong: the kind shows in every member's New note picker on merge (O-T2B-2).
- **R-T2B-9, what the prefill writes.** Ruling: the payload flag `earningsFollowup: {reportDate}` runs `followup_prefill.apply` as `compose`'s `after_build`, in create mode only (the hook Part A added, `journal_styles.py:739-819`). Under "What I expected" it inserts "Your prep note before the report: " and a `noteLink` to the member's newest live, non-sample note tagged `earnings-prep` on that ticker. That note must have been created ON OR BEFORE the report date in ET; the controller's "created before the report date" is read that way, because a prep note written on the morning of an after-close report is the common case (O-T2B-4). The prep note is linked, never parsed. Under "What happened" it inserts plain paragraphs: the quarter, EPS and revenue (actual vs expected, with `earnings_intel`'s own surprise %), the close-to-close reaction, and a source line naming `earnings_prep.SRC_EARNINGS` and the retrieved time in ET. The quarter and the reaction event are matched to the report date within 3 calendar days. A value UCT does not hold is a labelled dash ("EPS: — (no reported EPS for this quarter in UCT's earnings data yet)"), never invented. A missing or malformed value never fails the create: the work is done on a copy, as Part A's I4 fix did (`plan_prefill.py:133-143`). Why: the controller's ruling 4. Cost if wrong: a member whose provider dates the report four days off sees a labelled dash.
- **R-T2B-10, the create never waits on a vendor.** Ruling: the prefill reads `earnings_intel.get_earnings_held(sym)`, a new read of what `earnings_intel` already holds (memory, then the persisted snapshot up to `_STALE_MAX`), which never builds. The job calls the building reader `get_earnings` on its scheduler thread for every name it offers, so the store is warm when the member presses. Why: `get_earnings` builds from providers on a miss (`api/services/earnings_intel.py:740-775`), and CLAUDE.md's launch-hardening rule is that a new blocking external call on the request path must have a bound. A held read has no vendor in it. Cost if wrong: a member who opens the card days later, after the snapshot ages out (45 days), sees the labelled dash.
- **R-T2B-11, the numbers are text, not fact chips.** Ruling: the numbers are plain paragraphs, not `financialFact` nodes and not a table. Why: a fact chip needs a fact row keyed to the note id, which does not exist before the one insert (Part A's R-T2A-2). The line shapes are tested so `plan_extract`'s text reader never reads them as plan levels. Cost if wrong: the numbers do not refresh, which is right: they are a record of what UCT held when the note was made.
- **R-T2B-12, the Reminder slash item.** Ruling: a slash item "Reminder" (keywords `remind`, `reminder`, `follow up`) makes a new unticked `taskItem` holding "Follow up " and types "@", which opens the existing date list. `runDateCommand` (`lib/dateSuggest.js:111-118`) stays the one inserter of the date. On a line with text, the task goes on a new line; inside a task with text, a new task follows it. No switch, like P0.9's "Due date" item (`components/notebook/SlashMenu.jsx:134-141`). Why: the controller's ruling 5. Cost if wrong: "/remind" also matches "Due date" through its keyword; the Reminder row ranks first because its title starts with the query (`rankedBlockItems`, `SlashMenu.jsx:370-383`).
- **R-T2B-13, the `reminder` block kind.** Ruling: `reminder` joins `journal_styles.BLOCK_KINDS` and `lib/journalBlocks.js` `BLOCK_KINDS`, with one setting `days` (options 1, 2, 3, 5, 10; default 5). It is the first block that is NOT a widget: its builder (`reminder_block.build_reminder`) returns a `taskList` holding one unticked `taskItem` whose paragraph is "Follow up by " and a `dateMention` N trading days after the create's own clock in ET. It builds in create mode only. Update layout never offers it: `journal_styles._plan` skips it, because `_present` (`journal_styles.py:938-948`) finds blocks by widgetEmbed only and would offer a fresh reminder on every update. Why: the controller's ruling 5. "N trading days after creation" only has a meaning when the note is made. Cost if wrong: a note made from an older version of a style gains no reminder through Update layout; the member can type /remind.
- **R-T2B-14, bytes.** Ruling: the first-open allowance is +2,048 B over Part A's tip (2,251,768 B, `docs/notebook/t2a-arming.md:31`), so a ceiling of **2,253,816 B**, under the budget 2,260,793 B (`docs/notebook/perf-budgets.json:11`). The card and `followupCreate.js` are one lazy chunk. If the measure is over, `insertReminder` moves behind a lazy import (Task 11 Step 5 shows the code). Why: the controller's ruling 6. Cost if wrong: one more lazy fetch on the first `/remind`.
- **R-T2B-15, the walk's seams.** Ruling: the walk group `followup()` uses the two seams the earnings prep walk already uses. The first is the sandbox calendar file `NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR` (read per call, `earnings_prep.py:181-192`, set by `tools/notebook_fin_walk.py:1052`). The second is the intel snapshot seed `fundamentals_snapshot_store.put(earnings_intel._KIND, ...)` in a census-pinned child (`tools/notebook_w13c_walk.py:171-184`). The job is fired by such a child with a pinned `now`. Its bell reaches the sandbox server through the durable copy every private alert gets (`alert_durability.should_persist`, `api/services/alert_durability.py:64-74`; served by `alerts.py:370-379`). Why: the controller's ruling 7 forbids network. These are the seams that exist. Cost if wrong: Task 1 V6 proves the durable copy is served; if it is not, the step is INCONCLUSIVE, never PASS.

## Owner decisions this plan surfaces (none blocks the build)

- **O-T2B-1.** Arming `NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED` on `web` after the PR is live. Task 12 hands over the exact command and the checks after it.
- **O-T2B-2.** The "Earnings follow-up" kind and style, the `reminder` style block and the Reminder slash item are live on merge, because they ride the armed styles switch or no switch. A kind cannot be listed per switch without breaking the kinds pin (`tests/test_note_kinds.py:44-45`). Recommended: accept. The other answer is a revert.
- **O-T2B-3.** When `earnings_intel` withholds the whole reaction strip (fewer than 4 quarters computed, `api/services/earnings_reaction.py:59` and `:201-202`), the follow-up's reaction line is a labelled dash. The other answer is to call `earnings_reaction.reaction_for(sym, [quarter], limit=1, min_computed=1)`, the same definition, for the one quarter. Recommended: keep the dash until Task 1 V3 says how often it happens.
- **O-T2B-4.** The prep-note window reads "created before the report date" as "on or before, in ET" (R-T2B-9). The other answer is "strictly before the date", which drops a prep note written on the morning of an after-close report. Recommended: on or before.

## Global Constraints

Part A's Global Constraints apply unchanged (`docs/superpowers/plans/2026-10-14-notebook-p2-tier2-part-a.md`, "Global Constraints"), and through it the P2 Tier 1 plans'. That covers names, the paid gate, dark switches, creating-not-rendering, the INTEGRITY RULE, zero schema bumps, the ONE-FACT rails, the settle rule, tests, commits, hygiene, `C:\data`, at most 3 agents, mutation restores, and the junction rule. Restated, with this plan's values:

- **Worktree.** Everything runs in `$WT = C:\Users\Patrick\uct-worktrees\notebook-t2b`. `app/node_modules` is a junction to `C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules`. Make it only after `ls -A` counts **377** entries there. Remove it only with `cmd /c rmdir` from PowerShell, after `Get-Item -Force` shows `LinkType` = `Junction`, then re-count 377.
- **Zero schema bumps.** No new node type and no new node attribute. `taskList`, `taskItem`, `dateMention` and `noteLink` all exist. A task that finds it needs a new node or attribute STOPS and reports.
- **The integrity rule** (spec lines 226-232). No second write door into a note. The follow-up note is written in the styled create's ONE insert. The job writes bells and its own two tables, never a note. The Reminder writes through editor transactions only. `J/lib/offline/doorEnumeration.test.js` stays `MODE = 'fail'` and green.
- **No new `document` or `window` key listener** (`app/src/pages/command/keyListenerCensus.test.js`). The card's keys are its buttons.
- **No new plugin and no new extension.** The Reminder is a slash item over existing commands. The typing path does not change, so the typing re-measure runs only if Task 11 finds `J/lib/tiptap.js` changed on this branch (Part A's baseline: **p95 4.94 / 7.07 / 9.37 ms** at 1 / 1,000 / 2,000 paragraphs; F-LONGNOTE-TYPING ~16 ms is the floor).
- **iOS 16 floor.** No regex lookbehind (`(?<=`, `(?<!`) anywhere in client code (Part A fix `d129cda120`). No `Iterator` helpers, no `Promise.withResolvers` without the existing shims.
- **Bytes.** The first-open closure (`python tools/notebook_perf_budgets.py --dist app/dist`) stays at or under **2,253,816 B** (R-T2B-14). Every new surface is a lazy chunk (spec §6).
- **Copy.** Plain English, no emoji, `UIcon` names only. A refusal is a fixed sentence, never a server's `detail` (`rawErrorSurface.test.js`). A toast or line says what happened and what did not ("Nothing was saved.").
- **Touch.** Every new control meets `var(--tap-min)` (44 px) at or below 1,024 px (`app/src/styles/tapFloor.test.js`). Breakpoints are 640 and 1,024 only.
- **Rails that must stay green:** `J/lib/offline/doorEnumeration.test.js`, `app/src/pages/command/keyListenerCensus.test.js`, `app/src/components/screener/reachable.test.js` (the new card is reachable from `App.jsx`), `app/src/styles/tapFloor.test.js`, `rawErrorSurface.test.js`, and the a11y population in `J/a11y/notebookSurfaces.js` with its coverage rail.
- **Tests.** Backend pytest by named files only (`python -m pytest tests/test_a.py tests/test_b.py -q`), never `tests/` and never `-k` alone. Vitest by named files from `$WT/app`. Each verification runs in its own tool call, captures `code=$?` and exits with it, with no pipe and no trailing `echo`. Read the totals line, then commit in a separate call.
- **Commits.** `python tools/check_repo_hygiene.py --staged` in its own call, then `git commit -F - -- <paths>` with a quoted heredoc, never `-m`. The message ends with exactly one trailer line:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  Push the branch after every task. Never `--no-verify`.
- **Evidence.** Every walk, bytes, typing and NVDA run writes its raw output under `docs/notebook/evidence/t2b-<run-id>/` and commits it BEFORE any summary is written (R-RAW).
- **Gate, walk and NVDA.** The six-shard gate runs in a SEPARATE worktree on a `notebook-*` branch. The walk runs at 1280 / 820 / 390. NVDA runs only when the owner says they are away, silent and killed at teardown.
- **Flags in production are the owner's.** No agent runs `railway variables --set` or `railway variable delete`.

## Review Focus

The input classes the spec implies, most likely first. Each is pinned by a test in the task that owns the code.

1. **An after-close reporter on a Friday.** The reaction session is Monday: Friday's run offers nothing for it, Monday's run offers it. Pinned in Task 7, `test_an_amc_report_on_friday_is_offered_on_monday`, and Task 7's `reaction_session` table.
2. **A member who sold before the report.** With the name off their watchlists and flags, no notice. With it still on a watchlist, one notice whose line says "It is on your watchlist." and never "You hold it." Pinned in Task 7, `test_a_member_who_sold_gets_nothing_unless_still_watching`.
3. **A symbol both held and watched.** One notice, whose line says "You hold it." Pinned in Task 7, `test_one_notice_when_held_and_watched`.
4. **A holiday.** A run on a holiday rings nothing. An after-close report on the day before a holiday is offered on the next session. A report dated the holiday itself also reacts on the next session. The reminder's "5 trading days" skips the holiday. Pinned in Task 7, `test_a_holiday_rings_nothing_and_the_next_session_carries_it`, and Task 3, `test_add_trading_days_skips_weekends_and_a_holiday`.
5. **`earnings_intel` missing the quarter** (not updated yet, a partial build, or nothing held). The note says "The numbers: — UCT's earnings data does not have the Oct 14, 2026 report yet." with its source line, and the job still rings, ranking that name as unmeasured. Pinned in Task 6, `test_a_missing_quarter_is_a_labelled_dash_never_invented`, and Task 7, `test_the_cap_keeps_the_biggest_moves_and_breaks_ties_by_symbol`.
6. **A deleted prep note.** A trashed or sample prep note is never linked. With none left, the note has no prep line and nothing invented. Pinned in Task 6, `test_a_trashed_or_sample_prep_note_is_never_linked`.
7. **The job running twice in a day** (16:45 and 18:00, a catch-up after a deploy, or two at once). One notice per (member, symbol, report date). The second run counts it as `already_sent`. Pinned in Task 7, `test_running_twice_rings_once`, and the walk's second child run (Task 11).
8. **A tie at the cap of 3.** Equal |reaction| breaks by symbol, A to Z. An unmeasured reaction ranks after every measured one. The fourth is counted `capped` and never written. Pinned in Task 7, `test_the_cap_keeps_the_biggest_moves_and_breaks_ties_by_symbol`.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/t2b-verify-before-building.md` (new), `docs/notebook/evidence/t2b-verify-<run-id>/` | citations re-read; V1-V18 answered, three of them measured | 1 |
| `api/routers/auth.py`, `J/lib/offline/notebookFlags.js`, `J/lib/earningsFollowupFlag.js` (new) + test, `tests/test_notebook_flags.py`, `tests/test_notebook_flag_parse.py`, `docs/feature_flags.json`, `tools/notebook_contract_fixtures.py`, `tools/notebook_fin_walk.py`, `api/services/journal_two/earnings_followup.py` (new, `enabled()` only) | the switch | 2 |
| `api/services/journal_two/reminder_block.py` (new), `journal_styles.py` (`BLOCK_KINDS`, `BLOCK_BUILDERS`, `_plan`), `J/lib/journalBlocks.js`, `tests/test_reminder_block.py` (new) | the `reminder` block kind | 3 |
| `note_kinds.py`, `J/lib/noteKinds.js`, `journal_styles.py` (`FOLLOWUP_HEADINGS`, `BUILTIN_STYLES`), `tests/test_note_kinds.py`, contract fixtures | the kind and the style | 4 |
| `api/services/earnings_intel.py` (`get_earnings_held`), `tests/test_earnings_intel_held.py` (new) | the held read | 5 |
| `api/services/journal_two/followup_prefill.py` (new), `journal_styles.py` (`create_styled_note`), `tests/test_followup_prefill.py` (new) | the prefill | 6 |
| `api/services/journal_two/earnings_followup.py` (the job), `api/main.py`, `tests/test_earnings_followup.py` (new) | the job | 7 |
| `J/lib/notices.js`, `J/lib/__fixtures__/notices.json`, `J/lib/notices.test.js`, `B/NoticesBox.test.jsx`, `tools/capture_followup_notice.py` (new) | the notice kind | 8 |
| `J/lib/noteCreation.js`, `J/lib/followupCreate.js` (new) + test, `B/FollowupOffer.jsx` (new) + CSS + test, `J/tabs/NotebookTab.jsx`, `J/tabs/NotebookTab.followup.test.jsx` (new) | the card and the create | 9 |
| `J/lib/reminderItem.js` (new) + test, `B/SlashMenu.jsx`, `B/SlashMenu.test.jsx` (V-named) | the Reminder slash item | 10 |
| `J/a11y/notebookSurfaces.js`, `J/a11y/followup.a11y.test.jsx` (new), `tools/notebook_fin_walk_features.py`, `tools/notebook_door_audit_doors.json`, `docs/notebook/screen-reader-pass.md`, `tools/notebook_nvda_pass.py` | the rails, the walk group, bytes | 11 |
| `docs/notebook/t2b-arming.md` (new), PR | gate, walk, PR, arming packet | 12 |

`J` = `app/src/pages/journal-2-0`, `B` = `J/components/notebook`.

---

### Task 1: Verify before building

Every citation in this plan is a dated claim. This task re-reads each one on the base and measures the three open questions. It changes no product code.

**Files:**
- Create: `docs/notebook/t2b-verify-before-building.md`, `docs/notebook/evidence/t2b-verify-<run-id>/` (raw probe output)

**Interfaces:**
- Consumes: nothing.
- Produces: the doc. Each V-item is "confirmed", with a quoted line and its `file:line`, or "differs", with the real shape and the task text it changes. The controller rules on every "differs" before Task 2 is dispatched.

- [ ] **Step 1: Make the worktree**

```bash
cd /c/Users/Patrick/uct-dashboard && git fetch origin && git worktree add -b notebook-t2b-followup /c/Users/Patrick/uct-worktrees/notebook-t2b 204234469b
printf 'session: 61625d99-f8db-4269-a728-231c08d3da11\ncreated: 2026-10-15\n' > /c/Users/Patrick/uct-worktrees/notebook-t2b/.uct-session-owner
ls -A /c/Users/Patrick/uct-worktrees/_nb-shared-install/node_modules | wc -l
```
Expected: the last line prints `377`. Then make the junction from PowerShell:
```powershell
New-Item -ItemType Junction -Path 'C:\Users\Patrick\uct-worktrees\notebook-t2b\app\node_modules' -Target 'C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules'
```
Record in the doc whether `204234469b` is an ancestor of `origin/master` (`git merge-base --is-ancestor 204234469b origin/master`). If Part A has merged, the controller decides whether to rebase onto master before Task 2.

- [ ] **Step 2: Record the base reds**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-t2b/app && npx vitest run src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/pages/journal-2-0/a11y/surfaceCoverage.test.js src/pages/command/keyListenerCensus.test.js src/components/screener/reachable.test.js src/pages/journal-2-0/lib/notices.test.js src/pages/journal-2-0/lib/dateSuggest.test.js > /tmp/t2b-base.log 2>&1; code=$?; tail -5 /tmp/t2b-base.log; exit $code
```
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-t2b && python -m pytest tests/test_note_kinds.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_update.py tests/test_prep_create_budget.py tests/test_note_tasks.py tests/test_plan_prefill.py -q > /tmp/t2b-base-py.log 2>&1; code=$?; tail -3 /tmp/t2b-base-py.log; exit $code
```
Record any red, with its first assertion line, as "pre-existing at 204234469b".

- [ ] **Step 3: Answer V1-V18 in the doc, each with a quoted line**

| V | Question | Where to look |
|---|---|---|
| V1 | Base SHA; Part A merged or not; the flag rows Part A added (`git show --stat 6ddba86694`) | git |
| V2 (**measured**) | Does `earnings_intel` hold the just-reported quarter by 16:45 ET, and by 18:00 ET? | Step 4 |
| V3 (**measured**) | What is `reaction` (and each event's `reaction_pct`) when fewer than 4 quarters compute, and does the daily bar for today carry the session's close at 16:45 ET? | Step 5 |
| V4 (**measured**) | What `calendar_alerts._get_reporters_for_date_with_status` answers for the previous trading day (which leg, `ok`), what `earnings_prep._timing_from_calendar_cache` answers for those symbols, and what `hour` values a Finnhub `/calendar/earnings` row carries for that day | Step 6 |
| V5 | `notes.list_notes(user_id, tag=..., sort="created", limit=..., conn=...)`: newest created first; the shape of each row's `id`, `ticker` and `createdAt` (UTC ISO with offset?) | `api/services/journal_two/notes.py:1878`, `earnings_prep.py:268-278` |
| V6 | The module and function behind `GET /api/alerts`; that a private alert written by ANOTHER process (a child) is served by the server through `alert_durability.list_durable_alerts` | `api/services/alerts.py:360-379`, `api/services/alert_durability.py:64-120`, the alerts router |
| V7 | `finnhub_client.fh_get(path, params, timeout=...)` signature and return shape | `api/services/finnhub_client.py`, `calendar_alerts.py:158` |
| V8 | `notebook_flags.flag_on(name, default)` reads the environment per call | `api/services/notebook_flags.py:47` |
| V9 | Every client consumer that assumes a block id is a widget id (`WIDGET_REGISTRY[...]` or `isTraderBlock` over `BLOCK_KINDS` ids): `KindSection.jsx`, `StyleEditor.jsx`, `BlockNodeView.jsx`, `api/services/journal_two/public_note_payload.py`. A consumer that breaks on `reminder` is listed with the guard Task 3 adds | grep `BLOCK_KINDS` in `app/src` |
| V10 | `tools/notebook_contract_fixtures.py`'s write mode, and which fixtures carry kinds, styles or `blockKinds` (`note-kinds.list.json`, `journal-styles.list.json`, `journal-styles.list.empty.json`, `lib/__fixtures__/journalStylesComposed.json`) | the tool's header |
| V11 | `splitBlock`, `splitListItem('taskItem')`, `toggleTaskList` and `isActive('taskItem')` are available on `buildExtensions()` | `J/lib/tiptap.js` |
| V12 | `NotebookTab`'s `lazyDialog` and `lazyChunk` (`NotebookTab.jsx:94-125`; `J/lib/lazyChunk.js`): what a failed chunk fetch renders | `J/lib/lazyChunk.js` |
| V13 | The product route that adds a symbol to a member's watchlist (for the walk), with its body | `api/routers/watchlists.py` |
| V14 | The first-open closure on the base (`npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`): expected 2,251,768 B | build |
| V15 | `tools/notebook_door_audit_doors.json` accepts a row with `"flag": null` (the Reminder needs no switch); the next free `audit_row` (expected 67) | `tests/test_notebook_door_audit.py` |
| V16 | `session_calendar` covers 2026 and 2027 (`horizon()`), and names a weekday holiday in November 2026 | `api/services/session_calendar.py:154-181` |
| V17 | The walk's two seams: `_sandbox_window` reads the file on every call (`earnings_prep.py:181-192`); the snapshot seed `snap.put(earnings_intel._KIND, SYM, payload, ttl)` (`tools/notebook_w13c_walk.py:182`) | as named |
| V18 | `auth_middleware.get_user_plan(user_id)` and `is_paid_user(user)` with a `users` row plus `plan` (the shape `journal_two._styled_create_allowed` builds, `api/routers/journal_two.py:3576`) | `api/middleware/auth_middleware.py` |

- [ ] **Step 4: Measure V2 (is the quarter held by 16:45 ET?)**

This runs on a trading day, at or after 16:45 ET, and again at or after 18:00 ET. It runs in a CHILD process that applies the sandbox census first, so nothing reaches `C:\data`. It needs the provider keys from the local `.env`. Write the probe to the scratchpad under a lane-unique name, `t2b_v2_probe.py`:
```python
import json, sys, time
from datetime import date, datetime
from zoneinfo import ZoneInfo
repo, data_dir = sys.argv[1], sys.argv[2]
sys.path.insert(0, repo); sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from dotenv import load_dotenv; load_dotenv(repo + "/.env", override=False)
from api.services import calendar_alerts, earnings_intel, session_calendar
ET = ZoneInfo("America/New_York")
today = datetime.now(ET).date()
prev = today
while True:
    prev = date.fromordinal(prev.toordinal() - 1)
    if session_calendar.is_trading_day(prev):
        break
out = {"at": datetime.now(ET).isoformat(), "today": today.isoformat(), "prev": prev.isoformat(), "rows": []}
for day in (today, prev):
    syms, ok = calendar_alerts._get_reporters_for_date_with_status(day.isoformat())
    for sym in sorted(syms)[:6]:
        t0 = time.monotonic()
        p = earnings_intel._build(sym)
        q = next((q for q in p.get("quarters") or [] if q.get("reported")), {})
        ev = {e.get("report_date"): e.get("reaction_pct") for e in ((p.get("reaction") or {}).get("events") or [])}
        out["rows"].append({"day": day.isoformat(), "sym": sym, "secs": round(time.monotonic() - t0, 1),
                            "newest_reported": q.get("report_date"), "eps_actual": q.get("eps_actual"),
                            "revenue_actual": q.get("revenue_actual"), "reaction_none": p.get("reaction") is None,
                            "reaction_for_day": ev.get(day.isoformat())})
print("V2 " + json.dumps(out))
```
Run it from PowerShell (a Windows path through the Bash tool loses its backslash), with a scratch data dir outside `C:\data`:
```powershell
$probe = 'C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\t2b_v2_probe.py'
python $probe 'C:\Users\Patrick\uct-worktrees\notebook-t2b' 'C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\t2b-v2-data' *> 'C:\Users\Patrick\uct-worktrees\notebook-t2b\docs\notebook\evidence\t2b-verify-1645\v2.txt'
$code = $LASTEXITCODE; Write-Output "EXIT: $code"; exit $code
```
If `python-dotenv` is not installed in that Python, drop the `load_dotenv` line and have the parent copy the provider keys (`FMP_API_KEY`, `FINNHUB_API_KEY`) from `.env` into the child's environment instead; never print a key into the evidence file. Repeat after 18:00 ET into `t2b-verify-1800\v2.txt`. Commit both raw files before writing the answer. The answer counts how many rows have `newest_reported == day` and an `eps_actual` at each time. If fewer than half at 16:45 and most at 18:00, record it, and the controller decides whether the first pass moves to 18:00 (the job's ranking and the warm both read this).

- [ ] **Step 5: Measure V3 (the reaction under 4 quarters, and today's bar)**

From the code, `reaction_for` answers `None` for the whole strip when fewer than `MIN_COMPUTED = 4` moves compute (`api/services/earnings_reaction.py:59`, `:201-202`), so every event, including the newest, is absent. Quote both lines. Then count it from Step 4's raw rows: how many have `reaction_none: true`. Then, in the same child shape, read `bars_fetch._get_bars_inner(sym, "D", 5)` for two of Step 4's symbols at 16:45 ET. Record whether the last bar's date is today and whether its close equals the session close shown by the quote. Raw output into the same evidence directory.

- [ ] **Step 6: Measure V4 (the reporters lookup for a past date)**

In the same child shape, for the previous trading day: record `_get_reporters_for_date_with_status(prev)` (`ok`, count, and which leg answered, by also reading `cache.get("calendar_weekly")` for that day), `earnings_prep._timing_from_calendar_cache(sym, prev)` for each symbol, and one `fh_get("/calendar/earnings", {"from": prev, "to": prev}, timeout=10)` row's keys and `hour` values. Raw output first, then the answer.

- [ ] **Step 7: Commit the doc**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-t2b && git add docs/notebook/t2b-verify-before-building.md docs/notebook/evidence && python tools/check_repo_hygiene.py --staged
```
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-t2b && git commit -F - -- docs/notebook/t2b-verify-before-building.md docs/notebook/evidence <<'MSG'
docs(notebook): Tier 2 part B verify-before-building (V1-V18, three measured)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git push -u origin notebook-t2b-followup
```

---

### Task 2: The `NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED` switch

**Files:**
- Modify: `api/routers/auth.py` (`NOTEBOOK_FLAGS`, beside `:266`), `app/src/pages/journal-2-0/lib/offline/notebookFlags.js` (`FLAG_FALLBACKS`, beside `:78`), `tests/test_notebook_flags.py` (`NOTEBOOK_KEYS`, beside `:86`), `tests/test_notebook_flag_parse.py` (import beside `:65`; gate map beside `:165`), `docs/feature_flags.json`, `tools/notebook_contract_fixtures.py` (`FLAGS`, beside `:83`), `tools/notebook_fin_walk.py` (list beside `:90`)
- Create: `api/services/journal_two/earnings_followup.py` (the gate only; Task 7 adds the job), `app/src/pages/journal-2-0/lib/earningsFollowupFlag.js`, `app/src/pages/journal-2-0/lib/earningsFollowupFlag.test.js`

**Interfaces:**
- Produces: server env `NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED`, payload key `notebook_earnings_followup_enabled`, `earnings_followup.FLAG`, `earnings_followup.enabled() -> bool`; client `EARNINGS_FOLLOWUP_FLAG = 'notebook_earnings_followup_enabled'`, `earningsFollowupEnabled(): boolean`.

- [ ] **Step 1: Write the failing client test**

```js
// app/src/pages/journal-2-0/lib/earningsFollowupFlag.test.js
import { describe, expect, it, afterEach } from 'vitest'
import { EARNINGS_FOLLOWUP_FLAG, earningsFollowupEnabled } from './earningsFollowupFlag'
import { FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags } from './offline/notebookFlags'

describe('earnings follow-up switch', () => {
  afterEach(() => { __resetNotebookFlags() })
  it('is an enablement gate: off until the payload says on', () => {
    expect(FLAG_FALLBACKS[EARNINGS_FOLLOWUP_FLAG]).toBe(false)
    expect(earningsFollowupEnabled()).toBe(false)
  })
  it('follows the latched payload', () => {
    latchNotebookFlags({ [EARNINGS_FOLLOWUP_FLAG]: true })
    expect(earningsFollowupEnabled()).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/earningsFollowupFlag.test.js; code=$?; exit $code`
Expected: FAIL, `Failed to resolve import "./earningsFollowupFlag"`.

- [ ] **Step 3: Add the accessor and the fallback**

```js
// app/src/pages/journal-2-0/lib/earningsFollowupFlag.js
/**
 * Tier 2 part B (R-T2B-5): the earnings follow-up card. An ENABLEMENT gate: unset means off. Latched
 * per tab like every Notebook capability (offline/notebookFlags.js).
 */
import { notebookFlag } from './offline/notebookFlags'

export const EARNINGS_FOLLOWUP_FLAG = 'notebook_earnings_followup_enabled'

export function earningsFollowupEnabled() {
  return notebookFlag(EARNINGS_FOLLOWUP_FLAG) === true
}
```
In `notebookFlags.js` `FLAG_FALLBACKS`, after `notebook_smart_chips_enabled: false,` (`:78`), add:
```js
  notebook_earnings_followup_enabled: false, // Tier 2 part B: the earnings follow-up card and job — absent ⇒ OFF
```

- [ ] **Step 4: Add the server gate, the payload row and the rails**

```python
# api/services/journal_two/earnings_followup.py
"""Tier 2 part B, item 11: the earnings follow-up notice (spec §P2 Tier 2 item 11).

This commit holds the gate only; the job lands in Task 7 of the Tier 2 part B plan.
"""
from __future__ import annotations

from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED"


def enabled() -> bool:
    """The gate, read per call (default OFF): the job, the card and the server prefill."""
    return flag_on(FLAG, False)
```
In `api/routers/auth.py` `NOTEBOOK_FLAGS`, after `"NOTEBOOK_SMART_CHIPS_ENABLED": False,` (`:266`):
```python
    "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED": False,  # enablement (Tier 2 part B: earnings follow-up notice + card)
```
In `tests/test_notebook_flags.py`, add `"notebook_earnings_followup_enabled",` to `NOTEBOOK_KEYS` after `"notebook_smart_chips_enabled",` (`:86`), with the comment `# Tier 2 part B: the earnings follow-up notice and card — an enablement gate.` Do NOT add it to `KILL_SWITCH_KEYS`. In `tests/test_notebook_flag_parse.py`, add `from api.services.journal_two import earnings_followup` beside `:65`, and `"NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED": earnings_followup.enabled,` after `:165`. Add the env name to `tools/notebook_contract_fixtures.py` `FLAGS` after `"NOTEBOOK_SMART_CHIPS_ENABLED",` (`:83`), and to `tools/notebook_fin_walk.py`'s list after `:90` with the comment `# Notebook P2 Tier 2 part B (earnings follow-up), dark in production.` Add a ledger entry to `docs/feature_flags.json` after the `NOTEBOOK_SMART_CHIPS_ENABLED` entry, copying its shape, with `"status": "dark"`, `"where": "web"`, and a `note` that says: Notebook P2 Tier 2 part B (R-T2B-5), built dark; enablement gate, unset means OFF; when on, (1) a job at 16:45 and 18:00 ET mon-fri (and a boot catch-up) rings one in-app bell per member, symbol and report date for the paid member's held, watched or flagged names whose reaction session closed that day, at most 3 a day, and only while `NOTEBOOK_JOURNAL_STYLES_ENABLED` is also on; (2) the bell's link opens a card whose "Write follow-up" makes an Earnings follow-up note; (3) the server accepts the `earningsFollowup` create payload. Never email, never Discord (`info`). Rides the auth payload as `notebook_earnings_followup_enabled`. Arming and rollback are the owner's (Task 12's packet).

- [ ] **Step 5: Run the rails**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/earningsFollowupFlag.test.js; code=$?; exit $code`
Then: `cd $WT && python -m pytest tests/test_notebook_flags.py tests/test_notebook_flag_parse.py tests/test_feature_flag_ledger.py -q; code=$?; exit $code`
Then: `cd $WT && python tools/flag_ledger_audit.py --offline; code=$?; exit $code` (if `--offline` is not a flag, record the offline rail it names in the task report and run that).
Expected: all pass; totals lines present.

- [ ] **Step 6: Commit**

`python tools/check_repo_hygiene.py --staged` in its own call, then:
```bash
git commit -F - -- api/routers/auth.py api/services/journal_two/earnings_followup.py app/src/pages/journal-2-0/lib/offline/notebookFlags.js app/src/pages/journal-2-0/lib/earningsFollowupFlag.js app/src/pages/journal-2-0/lib/earningsFollowupFlag.test.js tests/test_notebook_flags.py tests/test_notebook_flag_parse.py docs/feature_flags.json tools/notebook_contract_fixtures.py tools/notebook_fin_walk.py <<'MSG'
feat(notebook): NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED switch (dark)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git push
```

---

### Task 3: The `reminder` block kind

**Files:**
- Create: `api/services/journal_two/reminder_block.py`, `tests/test_reminder_block.py`
- Modify: `api/services/journal_two/journal_styles.py` (`BLOCK_KINDS` `:52-74`, `BLOCK_BUILDERS` `:688-689`, `_plan` `:1030-1036`), `app/src/pages/journal-2-0/lib/journalBlocks.js` (header `:1-5`, `BLOCK_KINDS` `:7-64`)

**Interfaces:**
- Consumes: `session_calendar.is_trading_day(d) -> bool`; `note_tasks.extract_tasks(doc) -> list[dict]` (in tests).
- Produces: `reminder_block.BLOCK_ID = "reminder"`, `DAYS_OPTIONS`, `DEFAULT_DAYS = "5"`, `LEAD_TEXT = "Follow up by "`, `CREATE_ONLY_REASON = "create-only"`, `add_trading_days(start: date, n: int) -> date`, `reminder_node(due: date) -> dict`, `build_reminder(block: dict, ctx: dict) -> tuple[dict | None, str | None]`; `journal_styles.CREATE_ONLY_BLOCKS = frozenset({"reminder"})`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_reminder_block.py
"""Tier 2 part B, item 12 (R-T2B-13): the Reminder a journal style places. An ordinary unticked task
whose own paragraph holds a dateMention, so note_tasks reads its due date with no new reader."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from api.services import session_calendar
from api.services.journal_two import journal_styles as js
from api.services.journal_two import note_tasks, reminder_block as rb


def _weekday_holiday(year: int, month: int) -> date:
    d = date(year, month, 1)
    while d.month == month:
        if d.weekday() < 5 and not session_calendar.is_trading_day(d):
            return d
        d += timedelta(days=1)
    raise AssertionError(f"no weekday holiday in {year}-{month:02d}")      # non-vacuity


def test_add_trading_days_skips_weekends_and_a_holiday():
    assert rb.add_trading_days(date(2026, 10, 16), 1) == date(2026, 10, 19)   # Friday -> Monday
    h = _weekday_holiday(2026, 11)
    before = h - timedelta(days=1)
    while not session_calendar.is_trading_day(before):
        before -= timedelta(days=1)
    got = rb.add_trading_days(before, 1)
    assert got > h and session_calendar.is_trading_day(got)


def test_create_mode_builds_a_task_that_note_tasks_reads_as_due():
    now = datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)          # Wednesday, 11:00 ET
    node, reason = rb.build_reminder({"block": "reminder", "settings": {"days": "5"}}, {"now": now, "mode": "create"})
    assert reason is None
    tasks = note_tasks.extract_tasks({"type": "doc", "content": [node]})
    assert len(tasks) == 1 and tasks[0]["checked"] is False
    assert tasks[0]["due"] == rb.add_trading_days(date(2026, 10, 14), 5).isoformat()
    assert tasks[0]["text"].startswith("Follow up by")


def test_the_clock_is_eastern_time():
    late = datetime(2026, 10, 15, 2, 0, tzinfo=timezone.utc)            # still Oct 14 in ET
    node, _ = rb.build_reminder({"settings": {"days": "1"}}, {"now": late, "mode": "create"})
    assert note_tasks.extract_tasks({"type": "doc", "content": [node]})[0]["due"] == "2026-10-15"


def test_an_unknown_days_setting_is_the_default():
    now = datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)
    a, _ = rb.build_reminder({"settings": {"days": "99"}}, {"now": now, "mode": "create"})
    b, _ = rb.build_reminder({"settings": {}}, {"now": now, "mode": "create"})
    c, _ = rb.build_reminder({}, {"now": now, "mode": "create"})
    assert a == b == c


def test_update_mode_builds_nothing():
    node, reason = rb.build_reminder({"settings": {}}, {"now": datetime.now(timezone.utc), "mode": "update"})
    assert node is None and reason == rb.CREATE_ONLY_REASON


def test_the_block_is_catalogued_with_a_builder_and_is_create_only():
    assert "reminder" in js.KNOWN_BLOCKS
    assert js.BLOCK_BUILDERS["reminder"] is rb.build_reminder
    assert js._BLOCK_BY_ID["reminder"]["settings"][0] == {"key": "days", "options": rb.DAYS_OPTIONS,
                                                          "default": rb.DEFAULT_DAYS}
    assert "search" not in js._BLOCK_BY_ID["reminder"]     # not a widget: no searchText
    assert js.CREATE_ONLY_BLOCKS == frozenset({"reminder"})
```
And add to `tests/test_journal_styles_update.py`, using that file's own fixtures (Task 1 V-records name them; follow the shape of its `test_..._watchlist_note` cases at `:126-132`):
```python
def test_update_layout_never_offers_or_lists_a_reminder(db_path):
    """R-T2B-13: _present finds widgets only, so a reminder would be re-offered on every update."""
    from api.services.journal_two import journal_styles as js
    style = js.create_style("u1", {"name": "With reminder", "kindId": "trade_plan",
                                   "blocks": [{"block": "reminder", "enabled": True, "settings": {"days": "5"}}]})
    n = _note_from_style("u1", style)            # the file's helper that makes a note from a style
    plan = js.plan_style_update("u1", n["id"])
    assert all(a["block"] != "reminder" for a in plan["add"])
    assert all(s["block"] != "reminder" for s in plan["skipped"])
```
If the file has no helper that makes a note from a style, make one in the test with `js.create_styled_note("u1", {"styleId": style["id"]})` and read `[0]`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd $WT && python -m pytest tests/test_reminder_block.py tests/test_journal_styles_update.py -q; code=$?; exit $code`
Expected: FAIL, `ImportError: cannot import name 'reminder_block'`.

- [ ] **Step 3: Write `reminder_block.py`**

```python
# api/services/journal_two/reminder_block.py
"""Tier 2 part B, item 12 (R-T2B-13): the Reminder block a journal style can place.

⛔ NO NEW NODE TYPE, NO NEW READER. The block is an ordinary unticked taskItem whose OWN paragraph
holds a dateMention -- exactly what note_tasks._own_text_and_due reads as a due date -- so the
reminder rides the existing daily task bell and the Tasks view.
⛔ NOT A WIDGET. Every other block id is a widget id; this one builds a taskList. It has no
searchText (the task's own words are its text).
⛔ CREATE-ONLY. "N trading days after creation" means something only when the note is made, and
journal_styles._present cannot see a task, so Update layout never offers it (_plan skips it).
Trading days are session_calendar's: the ONE session authority, holidays included.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from api.services import session_calendar
from api.services.journal_two.timeutil import ET

BLOCK_ID = "reminder"
#: ONE FACT IN TWO FILES with journal_styles.BLOCK_KINDS and lib/journalBlocks.js (pinned by
#: tests/test_journal_styles_store.py through Node).
DAYS_OPTIONS = ("1", "2", "3", "5", "10")
DEFAULT_DAYS = "5"
LEAD_TEXT = "Follow up by "
CREATE_ONLY_REASON = "create-only"


def add_trading_days(start: date, n: int) -> date:
    """The n-th trading day AFTER `start` (n >= 1). Bounded: a broken calendar cannot loop forever."""
    left = max(1, int(n))
    d = start
    for _ in range(left * 7 + 21):
        d += timedelta(days=1)
        if session_calendar.is_trading_day(d):
            left -= 1
            if left == 0:
                return d
    return d


def _days(block: Any) -> int:
    settings = (block or {}).get("settings") if isinstance(block, dict) else None
    raw = str((settings or {}).get("days") or DEFAULT_DAYS)
    return int(raw if raw in DAYS_OPTIONS else DEFAULT_DAYS)


def reminder_node(due: date) -> dict:
    return {"type": "taskList", "content": [{
        "type": "taskItem", "attrs": {"checked": False},
        "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": LEAD_TEXT},
            {"type": "dateMention", "attrs": {"date": due.isoformat()}},
        ]}],
    }]}


def build_reminder(block: dict, ctx: dict):
    """A journal style's builder (journal_styles.BLOCK_BUILDERS). Reads nothing."""
    if ctx.get("mode") != "create":
        return None, CREATE_ONLY_REASON
    now = ctx["now"]
    today = (now if now.tzinfo else now.replace(tzinfo=ET)).astimezone(ET).date()
    return reminder_node(add_trading_days(today, _days(block))), None
```

- [ ] **Step 4: Catalogue it in both files and skip it in `_plan`**

In `journal_styles.py` `BLOCK_KINDS`, after the `marketcontext` row (`:72-73`):
```python
    # Tier 2 part B (R-T2B-13): the Reminder, an unticked task "Follow up by <date>". ⛔ NOT a widget, so
    # no `search`; built in create mode only (reminder_block.py).
    {"id": "reminder", "settings": ({"key": "days", "options": ("1", "2", "3", "5", "10"), "default": "5"},)},
```
Replace `BLOCK_BUILDERS` (`:688-689`) with:
```python
from api.services.journal_two import reminder_block as _rb  # noqa: E402 -- reads no journal_styles name
BLOCK_BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {
    "chart": _build_chart, _rb.BLOCK_ID: _rb.build_reminder, **_tb.BUILDERS}
#: Blocks built only when a note is made (R-T2B-13). Update layout neither offers nor lists them.
CREATE_ONLY_BLOCKS = frozenset({_rb.BLOCK_ID})
```
In `_plan`, in the loop over `style["blocks"]` (`:1030-1032`), make the first check:
```python
        if not b.get("enabled") or b["block"] in have or b["block"] in CREATE_ONLY_BLOCKS:
            continue
```
In `app/src/pages/journal-2-0/lib/journalBlocks.js`, change the header's first sentence (`:1-3`) to say "A block id IS a widget id, except `reminder` (Tier 2 part B), which builds an unticked task.", and add after the `marketcontext` row (`:56-63`):
```js
  // Tier 2 part B: the Reminder, an unticked task "Follow up by <date>" N trading days after the note is
  // made. NOT a widget (no `search`); created once, never re-added by Update layout.
  Object.freeze({
    id: 'reminder',
    label: 'Reminder',
    settings: Object.freeze([
      Object.freeze({ key: 'days', label: 'Follow up after', options: Object.freeze(['1', '2', '3', '5', '10']), default: '5',
        optionLabels: Object.freeze({ 1: '1 trading day', 2: '2 trading days', 3: '3 trading days', 5: '5 trading days', 10: '10 trading days' }) }),
    ]),
  }),
```
If Task 1 V9 named a client consumer that treats every `BLOCK_KINDS` id as a widget, add the guard V9 recorded there (skip ids with no `WIDGET_REGISTRY` entry), with its own test case.

- [ ] **Step 5: Run the tests and the neighbouring rails**

Run: `cd $WT && python -m pytest tests/test_reminder_block.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_update.py tests/test_prep_create_budget.py tests/test_note_tasks.py -q; code=$?; exit $code`
Expected: all pass. `test_journal_styles_store.py:73` (`set(BLOCK_BUILDERS) == KNOWN_BLOCKS`) and `:48` (the two catalogues equal through Node) cover the pair. `test_prep_create_budget.py:380-397` passes because the builder reads nothing.
Then: `cd $WT/app && npx vitest run src/widgets/registry.test.js src/pages/journal-2-0/components/notebook/styles src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx; code=$?; exit $code`

- [ ] **Step 6: Mutation check**

Capture `journal_styles.py`'s bytes to the scratchpad as `t2b-t3-js.bak`. Remove `or b["block"] in CREATE_ONLY_BLOCKS` from `_plan` and run `test_journal_styles_update.py::test_update_layout_never_offers_or_lists_a_reminder`. Expected: FAIL (the reminder is listed as skipped `create-only`). Restore from the capture, then prove it against the committed blob: `git diff --quiet -- api/services/journal_two/journal_styles.py` must show only this task's intended edits (compare `git diff` before and after the mutation round), and the test is green again.

- [ ] **Step 7: Commit** (hygiene in its own call; `git commit -F - -- <the files above>`; message `feat(notebook): the Reminder style block, an unticked task N trading days out (create-only)`; push).

---

### Task 4: The "Earnings follow-up" kind and style

**Files:**
- Modify: `api/services/journal_two/note_kinds.py` (`BUILTIN_NOTE_KINDS` `:42-51`), `app/src/pages/journal-2-0/lib/noteKinds.js` (`:8-17`), `api/services/journal_two/journal_styles.py` (`BUILTIN_STYLES` `:128-172`), `tests/test_note_kinds.py` (`:124`), the four contract fixtures V10 names
- Create: the census output inside `docs/notebook/t2b-verify-before-building.md` (a new section "Task 4 census")

**Interfaces:**
- Produces: kind id `earnings_followup`; `journal_styles.FOLLOWUP_HEADINGS = ("What I expected", "What happened", "What I'll do differently")`; built-in style id `builtin:earnings_followup` (version 1) whose blocks are `[reminder]`.

- [ ] **Step 1: Run the ONE-FACT census (grep and AST) and record it**

```bash
cd $WT && git grep -n "watchlist_note\|post_trade_review" -- api app/src tools tests ':!*.pyc' > /tmp/t2b-kinds-grep.txt; code=$?; exit $code
```
Then the AST half, for Python lists, tuples, sets and dicts that hold a built-in kind id as a literal (so a list written without that id spelled the grep's way is still found):
```bash
cd $WT && python - <<'PY'
import ast, pathlib
KINDS = {"trade_plan", "daily_prep", "weekend_prep", "earnings", "post_trade_review", "weekly_review", "thesis", "watchlist_note"}
for root in ("api", "tools", "tests"):
    for p in pathlib.Path(root).rglob("*.py"):
        try:
            tree = ast.parse(p.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, (ast.List, ast.Tuple, ast.Set, ast.Dict)):
                elts = node.keys if isinstance(node, ast.Dict) else node.elts
                lits = {e.value for e in elts if isinstance(e, ast.Constant) and isinstance(e.value, str)}
                hit = lits & KINDS
                if len(hit) >= 3:
                    print(f"{p}:{node.lineno}: {sorted(hit)}")
PY
```
Record both outputs in the verify doc. The pairs this plan already knows, each to be confirmed or corrected by the census:

| Pair | Files | Pinned by |
|---|---|---|
| built-in kinds | `note_kinds.py:42-51` ⇄ `lib/noteKinds.js:8-17` | `tests/test_note_kinds.py:44-45` (through Node) |
| a style per kind | `journal_styles.BUILTIN_STYLES` keys ⇄ `note_kinds.BUILTIN_KIND_IDS` | `tests/test_journal_styles_store.py:65` |
| block catalogue | `journal_styles.BLOCK_KINDS` ⇄ `lib/journalBlocks.js` | `tests/test_journal_styles_store.py:48` (Task 3) |
| builders | `BLOCK_BUILDERS` ⇄ `KNOWN_BLOCKS` | `tests/test_journal_styles_store.py:73` (Task 3) |
| Kind of note options | `note_properties.py:114`, DERIVED from `BUILTIN_NOTE_KINDS` | no edit; a test reads the option list (Step 4) |
| contract fixtures | `note-kinds.list.json`, `journal-styles.list.json`, `journal-styles.list.empty.json`, `lib/__fixtures__/journalStylesComposed.json` | regenerated by the tool V10 names |

Any other list the census finds is a stop: report it, and the controller rules whether it is a third copy to update or a fixture to regenerate.

- [ ] **Step 2: Write the failing tests**

In `tests/test_note_kinds.py`, replace the literal at `:124` (`ids[:8]`) with `ids[:len(nk.BUILTIN_NOTE_KINDS)]`, and add:
```python
def test_the_earnings_followup_kind_sits_after_earnings():
    ids = [k["id"] for k in note_kinds.BUILTIN_NOTE_KINDS]
    assert ids[ids.index("earnings") + 1] == "earnings_followup"
    assert note_kinds._BUILTIN_BY_ID["earnings_followup"] == {"id": "earnings_followup", "name": "Earnings follow-up", "icon": "edit"}
```
Add to `tests/test_journal_styles_compose.py` (it already imports `journal_styles as js`):
```python
def test_the_earnings_followup_style_is_three_headings_and_a_reminder():
    s = js.BUILTIN_STYLES["earnings_followup"]
    heads = [js._plain(n) for n in s["outline"]["content"] if n.get("type") == "heading"]
    assert heads == list(js.FOLLOWUP_HEADINGS)
    assert [b["block"] for b in s["blocks"]] == ["reminder"] and s["version"] == 1


def test_the_kind_of_note_property_lists_the_new_kind():
    from api.services.journal_two import note_properties as np_
    opts = [o["id"] for o in np_._BUILTIN_BY_ID["builtin:note_kind"]["options"]]
    assert "earnings_followup" in opts
```

- [ ] **Step 3: Run them and see them fail**

Run: `cd $WT && python -m pytest tests/test_note_kinds.py tests/test_journal_styles_compose.py -q; code=$?; exit $code`
Expected: FAIL (`ValueError: 'earnings_followup' is not in list`, `KeyError: 'earnings_followup'`).

- [ ] **Step 4: Add the kind (both files) and the style**

In `note_kinds.py` `BUILTIN_NOTE_KINDS`, after the `earnings` row (`:46`):
```python
    {"id": "earnings_followup", "name": "Earnings follow-up", "icon": "edit"},
```
In `lib/noteKinds.js`, after the `earnings` row (`:12`):
```js
  { id: 'earnings_followup', name: 'Earnings follow-up', icon: 'edit' },
```
In `journal_styles.py`, above `BUILTIN_STYLES` (`:126`):
```python
#: Tier 2 part B (R-T2B-8): the follow-up's three headings. ONE constant: the built-in outline below and
#: followup_prefill.py (which places the prep link and the numbers under the first two) both read it.
FOLLOWUP_HEADINGS = ("What I expected", "What happened", "What I'll do differently")
```
And in `BUILTIN_STYLES`, after the `earnings` entry (`:152-155`):
```python
    # Tier 2 part B (R-T2B-8): the earnings follow-up. followup_prefill.py adds the prep-note link and the
    # quarter's numbers under the first two headings; the reminder lands at the end.
    "earnings_followup": {"name": "Earnings follow-up", "version": 1, "properties": {},
                          "blocks": [_blk("reminder")], "outline": _doc(
        _h(FOLLOWUP_HEADINGS[0]), _p("What did I expect going in, and why?"),
        _h(FOLLOWUP_HEADINGS[1]), _p("How did the numbers and the reaction compare?"),
        _h(FOLLOWUP_HEADINGS[2]), _p(), _ph("reminder"))},
```
`edit` is a `UIcon` name (`app/src/components/ui/UIcon.jsx`, the `ICONS` key `edit`; `UICON_NAMES` at `:639`). `test_note_kinds.py` walks every name through `_clean_icon`.

- [ ] **Step 5: Regenerate the contract fixtures**

Run the tool's write mode as its header says (V10), then:
`cd $WT && python -m pytest tests/test_notebook_contract_fixtures.py -q; code=$?; exit $code`

- [ ] **Step 6: Run the kind and style rails, both sides**

Run: `cd $WT && python -m pytest tests/test_note_kinds.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_update.py tests/test_journal_styles_schema.py tests/test_journal_styles_create.py tests/test_notebook_journal_styles_router.py tests/test_sample_never_feeds_real_numbers.py -q; code=$?; exit $code`
Then: `cd $WT/app && npx vitest run src/pages/journal-2-0/tabs/NotebookTab.kindPicker.test.jsx src/pages/journal-2-0/tabs/NotebookTab.listCaret.test.jsx src/pages/journal-2-0/components/notebook/styles src/pages/journal-2-0/components/notebook/NoteMenuActions.saveAsStyle.test.jsx; code=$?; exit $code`
Expected: all pass. A client test that counts kinds by a literal is a test to fix by deriving from `BUILTIN_NOTE_KINDS`, recorded in the task report.

- [ ] **Step 7: Commit** (`feat(notebook): the Earnings follow-up kind and style (three headings and a reminder)`; push).

---

### Task 5: The held read of `earnings_intel`

**Files:**
- Modify: `api/services/earnings_intel.py` (after `get_earnings`, `:740-775`)
- Create: `tests/test_earnings_intel_held.py`

**Interfaces:**
- Produces: `earnings_intel.get_earnings_held(ticker: str) -> dict | None`. It reads memory, then the persisted snapshot, at any age up to `_STALE_MAX`. It never builds, never calls a provider, and never schedules a refresh.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_earnings_intel_held.py
"""Tier 2 part B (R-T2B-10): what earnings_intel already HOLDS, for a request path that must not wait
on a vendor. Never a build."""
import pytest

from api.services import earnings_intel as ei

FULL = {"ticker": "ORCL", "quarters": [{"label": "FY2027 Q1", "reported": True}], "estimates": [], "meta": {}}


@pytest.fixture(autouse=True)
def _no_build(monkeypatch):
    monkeypatch.setattr(ei, "_build", lambda sym: (_ for _ in ()).throw(AssertionError("built")))
    monkeypatch.setattr(ei, "_schedule_refresh", lambda sym: (_ for _ in ()).throw(AssertionError("refreshed")))
    store = {}
    monkeypatch.setattr(ei.cache, "get", lambda k: store.get(("mem", k)))
    monkeypatch.setattr(ei.snap_store, "get", lambda kind, sym: store.get(("disk", kind, sym)))
    return store


def test_memory_first(_no_build):
    _no_build[("mem", f"{ei._KIND}::ORCL")] = FULL
    assert ei.get_earnings_held("orcl") is FULL


def test_a_stale_snapshot_is_still_held(_no_build):
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX - 1, 60)
    assert ei.get_earnings_held("ORCL") is FULL


def test_too_old_partial_or_absent_is_none(_no_build):
    assert ei.get_earnings_held("ORCL") is None
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX + 1, 60)
    assert ei.get_earnings_held("ORCL") is None
    _no_build[("disk", ei._KIND, "ORCL")] = ({"quarters": [], "estimates": []}, 10, 60)
    assert ei.get_earnings_held("ORCL") is None
    assert ei.get_earnings_held("") is None
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd $WT && python -m pytest tests/test_earnings_intel_held.py -q; code=$?; exit $code`
Expected: FAIL, `AttributeError: module 'api.services.earnings_intel' has no attribute 'get_earnings_held'`.

- [ ] **Step 3: Add the read**

After `get_earnings` in `earnings_intel.py`:
```python
def get_earnings_held(ticker: str) -> dict | None:
    """What UCT already HOLDS for a ticker: memory, then the persisted snapshot at any age up to
    _STALE_MAX. ⛔ Never a build, never a provider call, never a background refresh. For a request
    path that must not wait on a vendor (Tier 2 part B's follow-up note, R-T2B-10); get_earnings stays
    the reader that builds, and the follow-up job calls it on its scheduler thread to warm this."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    hit = cache.get(f"{_KIND}::{sym}")
    if isinstance(hit, dict):
        return hit
    stored = snap_store.get(_KIND, sym)
    if stored is None:
        return None
    payload, age, _ttl = stored
    if isinstance(payload, dict) and _has_quarterly(payload) and age <= _STALE_MAX:
        return payload
    return None
```

- [ ] **Step 4: Run the tests and the earnings rails**

Run: `cd $WT && python -m pytest tests/test_earnings_intel_held.py tests/test_notebook_earnings_prep.py -q; code=$?; exit $code`
Expected: all pass. `tests/test_notebook_earnings_prep.py` rails the prep module's import graph; this change adds no import there.

- [ ] **Step 5: Commit** (`feat(notebook): earnings_intel.get_earnings_held, a read that never builds`; push).

---

### Task 6: The follow-up prefill

**Files:**
- Create: `api/services/journal_two/followup_prefill.py`, `tests/test_followup_prefill.py`
- Modify: `api/services/journal_two/journal_styles.py` (`create_styled_note`, `:845` and `:861-868`)

**Interfaces:**
- Consumes: `journal_styles.FOLLOWUP_HEADINGS`, `journal_styles._plain`, `journal_styles._after_first_heading`, `journal_styles.StyleValidationError`; `notes.list_notes(user_id, tag=, sort=, limit=, conn=)` (V5); `sample_marker.not_sample_sql()`; `earnings_intel.get_earnings_held` (Task 5); `earnings_prep.SRC_EARNINGS` (`earnings_prep.py:79`); `earnings_followup.enabled` (Task 2).
- Produces: `followup_prefill.FOLLOWUP_KIND = "earnings_followup"`, `PREP_TAG = "earnings-prep"`, `MATCH_DAYS = 3`, `MAX_AGE_DAYS = 120`, `DASH = "—"`, `OFF_SENTENCE`, `NEEDS_TICKER_SENTENCE`, `DATE_SENTENCE`; `as_number(v) -> float | None`; `quarter_for(intel, report_date: str) -> dict | None`; `event_for(intel, report_date: str) -> dict | None`; `clean_request(raw, *, kind_id, ticker, today=None) -> str`; `prep_note(user_id, symbol, report_date, conn) -> str | None`; `number_lines(symbol, report_date, intel) -> list[str]`; `apply(doc, ctx, conn, report_date) -> doc`. `create_styled_note` accepts `payload["earningsFollowup"] = {"reportDate": "YYYY-MM-DD"}`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_followup_prefill.py
"""Tier 2 part B, item 11 (R-T2B-9..11): the follow-up note opens with a link to the member's own prep
note and the quarter's numbers, each labelled with its source. Never an invented number, never a 500.

The harness is tests/test_plan_prefill.py's own (a per-file temp auth db, notes made with
notes.create_note, a sample note marked by sample_marker.SAMPLE_SOURCE)."""
from __future__ import annotations

import copy
import importlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from api.services import earnings_intel
from api.services.journal_two import followup_prefill as fp, journal_styles, plan_extract, sample_marker

UID = "u1"
REPORT = "2026-10-14"
INTEL = {
    "ticker": "ORCL",
    "quarters": [
        {"label": "FY2027 Q1", "report_date": "2026-10-14", "reported": True, "eps_actual": 1.47,
         "eps_estimate": 1.42, "eps_surprise_pct": 3.5, "revenue_actual": 15.2e9, "revenue_estimate": 15.0e9,
         "rev_surprise_pct": 1.3},
        {"label": "FY2026 Q4", "report_date": "2026-07-10", "reported": True, "eps_actual": 1.3},
    ],
    "reaction": {"events": [{"report_date": "2026-07-10", "reaction_pct": 2.0},
                            {"report_date": "2026-10-14", "reaction_pct": -4.2}]},
    "meta": {"retrieved_at": datetime(2026, 10, 14, 20, 52, tzinfo=timezone.utc).timestamp()},
}


def _text(doc):
    out, stack = [], [doc]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "text":
                out.append(n.get("text", ""))
            stack.extend(reversed(n.get("content") or []))
    return "\n".join(out)


def _links(doc):
    out, stack = [], [doc]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "noteLink":
                out.append(n["attrs"]["noteId"])
            stack.extend(n.get("content") or [])
    return out


def _body(note):
    return note["bodyJson"] if isinstance(note["bodyJson"], dict) else json.loads(note["bodyJson"])


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _on(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED", "1")
    monkeypatch.setattr(earnings_intel, "get_earnings",
                        lambda sym: (_ for _ in ()).throw(AssertionError("the create built earnings")))
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: copy.deepcopy(INTEL) if sym == "ORCL" else None)


@pytest.fixture
def member(db_path):
    from api.services import auth_db
    from api.services.journal_two import notes
    conn = auth_db.get_connection()

    def prep(ticker="ORCL", created=None, sample=False, tags=("earnings", "earnings-prep")):
        n = notes.create_note(UID, {"title": f"Earnings Prep — {ticker}", "ticker": ticker, "tags": list(tags),
                                    "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}, conn)
        if created:
            conn.execute("UPDATE j2_notes SET created_at = ? WHERE id = ?", (created, n["id"]))
        if sample:
            conn.execute("UPDATE j2_notes SET import_source = ? WHERE id = ?", (sample_marker.SAMPLE_SOURCE, n["id"]))
        conn.commit()
        return n

    def trash(note):
        assert notes.delete_note(UID, note["id"], conn)

    yield SimpleNamespace(conn=conn, prep=prep, trash=trash)
    conn.close()


def _followup(member, ticker="ORCL", report=REPORT, **extra):
    return journal_styles.create_styled_note(
        UID, {"kindId": "earnings_followup", "ticker": ticker, "earningsFollowup": {"reportDate": report}, **extra},
        member.conn)


def test_links_the_prep_note_and_writes_the_numbers_under_the_headings(member):
    p = member.prep(created="2026-10-13T14:00:00+00:00")
    note, _ = _followup(member)
    body = _body(note)
    assert _links(body) == [p["id"]]
    text = _text(body)
    assert "Your prep note before the report: " in text
    assert "Quarter: FY2027 Q1, reported Oct 14, 2026." in text
    assert "EPS: $1.47 actual vs $1.42 expected (+3.5% surprise)." in text
    assert "Revenue: $15.2B actual vs $15.0B expected (+1.3% surprise)." in text
    assert "Reaction: −4.2% close to close, on the session that first traded the result." in text
    assert "Source: UCT earnings data (consensus estimates and reported results), retrieved Oct 14, 2026, 4:52 PM ET." in text
    heads = [journal_styles._plain(n) for n in body["content"] if n.get("type") == "heading"]
    assert heads == list(journal_styles.FOLLOWUP_HEADINGS)
    i_happened = [journal_styles._plain(n) for n in body["content"]].index(journal_styles.FOLLOWUP_HEADINGS[1])
    assert journal_styles._plain(body["content"][i_happened + 1]).startswith("Quarter:")


def test_a_prep_note_written_on_the_report_morning_counts_and_one_written_after_does_not(member):
    same_day = member.prep(created="2026-10-14T13:00:00+00:00")             # 09:00 ET on the report day
    member.prep(created="2026-10-15T13:00:00+00:00")                        # after the report date
    note, _ = _followup(member)
    assert _links(_body(note)) == [same_day["id"]]


def test_a_trashed_or_sample_prep_note_is_never_linked(member):
    gone = member.prep(created="2026-10-12T13:00:00+00:00")
    member.trash(gone)
    member.prep(created="2026-10-12T14:00:00+00:00", sample=True)
    member.prep(ticker="AMD", created="2026-10-12T15:00:00+00:00")         # another ticker
    member.prep(created="2026-10-12T16:00:00+00:00", tags=("earnings",))  # not a prep note
    note, _ = _followup(member)
    body = _body(note)
    assert _links(body) == []
    assert "Your prep note" not in _text(body)


def test_a_missing_quarter_is_a_labelled_dash_never_invented(member, monkeypatch):
    held = copy.deepcopy(INTEL)
    held["quarters"] = held["quarters"][1:]
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _text(_body(_followup(member)[0]))
    assert "The numbers: — UCT's earnings data does not have the Oct 14, 2026 report yet." in text
    assert "EPS:" not in text and "1.3" not in text
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: None)
    text = _text(_body(_followup(member)[0]))
    assert "The numbers: — UCT holds no earnings data for ORCL right now." in text


def test_a_missing_value_or_reaction_is_a_labelled_dash(member, monkeypatch):
    held = copy.deepcopy(INTEL)
    held["quarters"][0].update(eps_actual=None, revenue_estimate=None, rev_surprise_pct=None)
    held["reaction"] = None                                              # fewer than 4 quarters computed
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _text(_body(_followup(member)[0]))
    assert "EPS: — (no reported EPS for this quarter in UCT's earnings data yet)" in text
    assert "Revenue: $15.2B actual; no consensus estimate in UCT's earnings data." in text
    assert "Reaction: — (UCT could not measure the price reaction to this report)." in text


@pytest.mark.parametrize("bad", [
    "not a dict", {"quarters": "x"}, {"quarters": [None, 5, "q"]},
    {"quarters": [{"report_date": "garbage", "reported": True}]},
    {"quarters": [{"report_date": REPORT, "reported": True, "eps_actual": "1.47", "eps_estimate": float("nan"),
                   "label": 7}], "reaction": {"events": "x"}, "meta": {"retrieved_at": "soon"}},
    {"quarters": [{"report_date": REPORT, "reported": True, "eps_actual": True, "revenue_actual": 1e400}],
     "reaction": [], "meta": None},
])
def test_malformed_earnings_data_never_fails_the_create(member, monkeypatch, bad):
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: bad)
    note, _ = _followup(member)
    assert note["id"]


def _h(t):
    return {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": t}]}


def _outline_style(member, content):
    """A member Earnings follow-up style whose OUTLINE is `content`, written straight to the row so no cleaning
    step tidies it (tests/test_plan_prefill.py's `_outline_style` idiom, `:303-316`)."""
    s = journal_styles.create_style(UID, {"name": "my follow-up", "kindId": "earnings_followup",
                                          "outlineBodyJson": {"type": "doc", "content": [_h("Notes")]}, "blocks": []})
    member.conn.execute("UPDATE j2_journal_styles SET outline_body_json = ? WHERE id = ?",
                        (json.dumps({"type": "doc", "content": content}), s["id"]))
    member.conn.commit()
    return s


def test_a_member_outline_without_the_headings_still_gets_the_numbers(member):
    s = _outline_style(member, [_h("My take"), {"type": "paragraph"}])
    note, _ = journal_styles.create_styled_note(
        UID, {"styleId": s["id"], "ticker": "ORCL", "earningsFollowup": {"reportDate": REPORT}}, member.conn)
    body = _body(note)
    assert journal_styles._plain(body["content"][0]) == "My take"
    assert journal_styles._plain(body["content"][1]).startswith("Quarter:")      # after the first heading


def test_apply_on_a_doc_it_cannot_copy_or_walk_returns_it_unchanged(monkeypatch):
    """The Part A I4 lesson at the unit: `apply` never raises, and leaves the doc exactly as it was."""
    monkeypatch.setattr(fp, "prep_note", lambda *a: "n9")
    uncopyable = {"type": "doc", "content": [{"type": "paragraph", "attrs": {"x": (i for i in [])}}]}
    assert fp.apply(uncopyable, {"ticker": "ORCL", "user_id": UID}, None, REPORT) is uncopyable
    assert len(uncopyable["content"]) == 1
    not_a_list = {"type": "doc", "content": "not a list"}
    assert fp.apply(not_a_list, {"ticker": "ORCL", "user_id": UID}, None, REPORT) == {"type": "doc", "content": "not a list"}


def test_the_prefill_is_the_same_insert_no_second_revision(member):
    note, _ = _followup(member)
    assert note["createdAt"] == note["updatedAt"]


def test_the_numbers_are_never_read_as_plan_levels(member):
    member.prep(created="2026-10-13T14:00:00+00:00")
    note, _ = _followup(member)
    r = member.conn.execute("SELECT body_json, properties_json FROM j2_notes WHERE id = ?", (note["id"],)).fetchone()
    plan = plan_extract.read_note_plan(r["body_json"], r["properties_json"], None, "ORCL")
    assert all(plan.value(role) is None for role in ("entry", "stop", "target"))


def test_the_style_places_the_reminder_five_trading_days_out(member):
    from api.services.journal_two import note_tasks, reminder_block
    note, _ = _followup(member)
    tasks = note_tasks.extract_tasks(_body(note))
    today_et = datetime.now(timezone.utc).astimezone(reminder_block.ET).date()
    assert [t["due"] for t in tasks] == [reminder_block.add_trading_days(today_et, 5).isoformat()]


@pytest.mark.parametrize("payload, sentence", [
    ({"kindId": "trade_plan", "ticker": "ORCL"}, fp.NEEDS_TICKER_SENTENCE),
    ({"kindId": "earnings_followup"}, fp.NEEDS_TICKER_SENTENCE),
    ({"kindId": "earnings_followup", "ticker": "ORCL", "reportDate": "2099-01-01"}, fp.DATE_SENTENCE),
    ({"kindId": "earnings_followup", "ticker": "ORCL", "reportDate": "2026-02-30"}, fp.DATE_SENTENCE),
    ({"kindId": "earnings_followup", "ticker": "ORCL", "reportDate": "2020-01-02"}, fp.DATE_SENTENCE),
])
def test_refusals(member, payload, sentence):
    report = payload.pop("reportDate", REPORT)
    with pytest.raises(journal_styles.StyleValidationError, match=re.escape(sentence)):
        journal_styles.create_styled_note(UID, {**payload, "earningsFollowup": {"reportDate": report}}, member.conn)


def test_switch_off_refuses_and_both_prefills_at_once_refuse(member, monkeypatch):
    with pytest.raises(journal_styles.StyleValidationError, match="Choose one"):
        journal_styles.create_styled_note(UID, {"kindId": "trade_plan", "ticker": "ORCL", "planPrefill": True,
                                                "earningsFollowup": {"reportDate": REPORT}}, member.conn)
    monkeypatch.delenv("NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED")
    with pytest.raises(journal_styles.StyleValidationError, match=re.escape(fp.OFF_SENTENCE)):
        _followup(member)


def test_without_the_payload_flag_the_style_is_only_the_outline(member):
    note, _ = journal_styles.create_styled_note(UID, {"kindId": "earnings_followup", "ticker": "ORCL"}, member.conn)
    text = _text(_body(note))
    assert "Quarter:" not in text and "Your prep note" not in text
```
The "Choose one" case uses the Trade plan kind on purpose: the `planPrefill` branch runs first and passes, so only the follow-up branch's own refusal can answer. It raises before `compose`, so no market read happens.

- [ ] **Step 2: Run them and see them fail**

Run: `cd $WT && python -m pytest tests/test_followup_prefill.py -q; code=$?; exit $code`
Expected: FAIL, `ImportError: cannot import name 'followup_prefill'`.

- [ ] **Step 3: Write `followup_prefill.py`**

```python
# api/services/journal_two/followup_prefill.py
"""Tier 2 part B, item 11: what an earnings follow-up note opens with, in the create's ONE insert.

Two things, each optional, none invented (R-T2B-9..11):
  * a link to the member's newest earnings-prep note on the name, created ON OR BEFORE the report date
    (ET), live and not a sample. LINKED, never mined: the prep note's text table is not parsed;
  * the quarter's expected and actual EPS and revenue, earnings_intel's own surprise %, and the
    close-to-close reaction, read from what earnings_intel already HOLDS (get_earnings_held: never a
    build and never a vendor call on this request path), with one source line naming where they came
    from and when. A value UCT does not hold is a labelled dash.
The headings are the style's own outline (journal_styles.FOLLOWUP_HEADINGS); the reminder is its block.
⛔ It never raises for a missing or malformed value (Part A's I4 lesson, 6b3bca53a9): the work is done
on a COPY, so an error leaves the note exactly as the style composed it.
"""
from __future__ import annotations

import copy
import math
from datetime import date, datetime, timezone
from typing import Any

from api.services.journal_two import journal_styles as _js
from api.services.journal_two import sample_marker
from api.services.journal_two.earnings_prep import SRC_EARNINGS
from api.services.journal_two.timeutil import ET

FOLLOWUP_KIND = "earnings_followup"
PREP_TAG = "earnings-prep"
#: Newest prep notes read, at most (earnings_prep._existing_prep_notes reads the same 200).
PREP_SCAN = 200
#: A provider can date one report a day or two apart from the calendar.
MATCH_DAYS = 3
MAX_AGE_DAYS = 120
DASH = "—"
OFF_SENTENCE = "Earnings follow-ups are not on for you yet."
NEEDS_TICKER_SENTENCE = "An earnings follow-up needs a ticker."
DATE_SENTENCE = "Choose a report date from the last 120 days."


def as_number(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def _iso_day(v: Any) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def _list(v: Any) -> list:
    return v if isinstance(v, list) else []


def _nearest(rows: list, report_date: str) -> dict | None:
    rd = _iso_day(report_date)
    if rd is None:
        return None
    best = None
    for r in rows:
        if not isinstance(r, dict):
            continue
        d = _iso_day(r.get("report_date"))
        if d is None:
            continue
        gap = abs((d - rd).days)
        if gap <= MATCH_DAYS and (best is None or gap < best[0]):
            best = (gap, r)
    return best[1] if best else None


def quarter_for(intel: Any, report_date: str) -> dict | None:
    if not isinstance(intel, dict):
        return None
    return _nearest([q for q in _list(intel.get("quarters")) if isinstance(q, dict) and q.get("reported")],
                    report_date)


def event_for(intel: Any, report_date: str) -> dict | None:
    if not isinstance(intel, dict):
        return None
    reaction = intel.get("reaction")
    return _nearest(_list(reaction.get("events")) if isinstance(reaction, dict) else [], report_date)


def clean_request(raw: Any, *, kind_id: Any, ticker: str | None, today: date | None = None) -> str:
    """The `earningsFollowup` payload's report date, or a StyleValidationError with a fixed sentence."""
    from api.services.journal_two import earnings_followup
    if not earnings_followup.enabled():
        raise _js.StyleValidationError(OFF_SENTENCE)
    if kind_id != FOLLOWUP_KIND or not ticker:
        raise _js.StyleValidationError(NEEDS_TICKER_SENTENCE)
    rd = raw.get("reportDate") if isinstance(raw, dict) else None
    d = _iso_day(rd) if isinstance(rd, str) and len(rd) == 10 else None
    today = today or datetime.now(tz=ET).date()
    if d is None or d > today or (today - d).days > MAX_AGE_DAYS:
        raise _js.StyleValidationError(DATE_SENTENCE)
    return d.isoformat()


def _created_et_day(iso: Any) -> date | None:
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return _iso_day(iso)
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(ET).date()


def prep_note(user_id: str, symbol: str, report_date: str, conn) -> str | None:
    """The id of the member's newest live, non-sample note tagged earnings-prep on `symbol`, created on
    or before `report_date` in ET, or None. One list read and one check query."""
    from api.services.journal_two import notes as notes_service
    rd, sym = _iso_day(report_date), symbol.upper()
    if rd is None:
        return None
    rows = notes_service.list_notes(user_id, tag=PREP_TAG, sort="created", limit=PREP_SCAN, conn=conn)
    ids = []
    for n in rows:
        created = _created_et_day(n.get("createdAt"))
        if str(n.get("ticker") or "").upper() == sym and created is not None and created <= rd:
            ids.append(n["id"])
    if not ids:
        return None
    marks = ",".join("?" for _ in ids)
    live = {r[0] for r in conn.execute(
        f"SELECT id FROM j2_notes WHERE user_id = ? AND id IN ({marks}) AND deleted_at IS NULL AND "
        + sample_marker.not_sample_sql(), (user_id, *ids))}
    return next((i for i in ids if i in live), None)


def _day_words(d: date) -> str:
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def _eps(v: float) -> str:
    return f"{'−' if v < 0 else ''}${abs(v):,.2f}"


def _rev(v: float) -> str:
    a, sign = abs(v), ("−" if v < 0 else "")
    if a >= 1e9:
        return f"{sign}${a / 1e9:,.1f}B"
    if a >= 1e6:
        return f"{sign}${a / 1e6:,.1f}M"
    return f"{sign}${a:,.0f}"


def _pct(v: float) -> str:
    return f"{'+' if v >= 0 else '−'}{abs(v):.1f}%"


def _retrieved(meta: Any) -> str:
    v = as_number(meta.get("retrieved_at")) if isinstance(meta, dict) else None
    if v is None:
        return "at a time not recorded"
    try:
        t = datetime.fromtimestamp(v, tz=timezone.utc).astimezone(ET)
    except (OverflowError, OSError, ValueError):
        return "at a time not recorded"
    return f"{_day_words(t.date())}, {t.strftime('%I:%M %p').lstrip('0')} ET"


def _metric(name: str, actual: Any, estimate: Any, surprise: Any, fmt, missing: str) -> str:
    a, e, s = as_number(actual), as_number(estimate), as_number(surprise)
    if a is None:
        return f"{name}: {DASH} ({missing})"
    if e is None:
        return f"{name}: {fmt(a)} actual; no consensus estimate in UCT's earnings data."
    tail = f" ({_pct(s)} surprise)" if s is not None else ""
    return f"{name}: {fmt(a)} actual vs {fmt(e)} expected{tail}."


def number_lines(symbol: str, report_date: str, intel: Any) -> list[str]:
    """The lines under "What happened". Prose, never `role: number` (plan_extract must not read them)."""
    when = _day_words(_iso_day(report_date))
    if not isinstance(intel, dict):
        return [f"The numbers: {DASH} UCT holds no earnings data for {symbol} right now."]
    source = f"Source: {SRC_EARNINGS}, retrieved {_retrieved(intel.get('meta'))}."
    q = quarter_for(intel, report_date)
    if q is None:
        return [f"The numbers: {DASH} UCT's earnings data does not have the {when} report yet.", source]
    label = q.get("label") if isinstance(q.get("label"), str) and q.get("label").strip() else "The quarter"
    r = as_number((event_for(intel, report_date) or {}).get("reaction_pct"))
    return [
        f"Quarter: {label}, reported {when}.",
        _metric("EPS", q.get("eps_actual"), q.get("eps_estimate"), q.get("eps_surprise_pct"), _eps,
                "no reported EPS for this quarter in UCT's earnings data yet"),
        _metric("Revenue", q.get("revenue_actual"), q.get("revenue_estimate"), q.get("rev_surprise_pct"), _rev,
                "no reported revenue for this quarter in UCT's earnings data yet"),
        (f"Reaction: {_pct(r)} close to close, on the session that first traded the result." if r is not None
         else f"Reaction: {DASH} (UCT could not measure the price reaction to this report)."),
        source,
    ]


def _para(*inline: dict) -> dict:
    return {"type": "paragraph", "content": [n for n in inline if n]}


def _text(s: str) -> dict:
    return {"type": "text", "text": s}


def _insert_under(content: list, heading: str, nodes: list) -> None:
    for i, n in enumerate(content):
        if isinstance(n, dict) and n.get("type") == "heading" and _js._plain(n).strip() == heading:
            content[i + 1:i + 1] = nodes
            return
    i = _js._after_first_heading(content)
    content[i:i] = nodes


def apply(doc: dict, ctx: dict, conn, report_date: str) -> dict:
    """compose's `after_build` for an earningsFollowup create. Mutates and returns `doc`; never raises."""
    symbol = ctx.get("ticker")
    if not symbol:
        return doc
    try:
        prep = prep_note(ctx["user_id"], symbol, report_date, conn)
    except Exception:  # noqa: BLE001 -- an unreadable notebook is "no prep note", never a failed note
        prep = None
    try:
        from api.services import earnings_intel
        intel = earnings_intel.get_earnings_held(symbol)
    except Exception:  # noqa: BLE001
        intel = None
    try:
        lines = number_lines(symbol, report_date, intel)
    except Exception:  # noqa: BLE001 -- data of a shape nobody planned for
        lines = [f"The numbers: {DASH} UCT could not read its earnings data for {symbol} just now."]
    try:
        trial = copy.deepcopy(doc)
        content = trial.get("content")
        if not isinstance(content, list):
            return doc
        expected, happened, _ = _js.FOLLOWUP_HEADINGS
        if prep:
            _insert_under(content, expected, [_para(_text("Your prep note before the report: "),
                                                    {"type": "noteLink", "attrs": {"noteId": prep}})])
        _insert_under(content, happened, [_para(_text(t)) for t in lines])
    except Exception:  # noqa: BLE001 -- a malformed outline is "nowhere to put it", never a failed note
        return doc
    doc.clear()
    doc.update(trial)
    return doc
```
Note: an outline whose `content` is not a list never reaches `apply` from `compose` (compose rebuilds `content`). The check is a guard for a direct caller.

- [ ] **Step 4: Hook it into `create_styled_note`**

Change the import at `journal_styles.py:845` to `from api.services.journal_two import followup_prefill, notes as notes_service, plan_prefill`. After the `planPrefill` block (`:862-867`) and before `composed = compose(...)` (`:868`):
```python
        followup = payload.get("earningsFollowup")
        if followup is not None:
            # Tier 2 part B (R-T2B-9): the prep-note link and the quarter's numbers, added to the SAME body
            # in this create's one insert. One prefill per create.
            if prefill is not None:
                raise StyleValidationError("Choose one: a trade plan or an earnings follow-up.")
            report_date = followup_prefill.clean_request(followup, kind_id=style.get("kindId"), ticker=ticker)
            prefill = lambda doc, ctx: followup_prefill.apply(doc, ctx, conn, report_date)  # noqa: E731
```

- [ ] **Step 5: Run the tests and the neighbouring rails**

Run: `cd $WT && python -m pytest tests/test_followup_prefill.py tests/test_plan_prefill.py tests/test_prep_create_budget.py tests/test_journal_styles_create.py tests/test_journal_styles_store.py tests/test_trader_blocks_no_note_door.py tests/test_notebook_journal_styles_router.py -q; code=$?; exit $code`
Expected: all pass.

- [ ] **Step 6: Mutation checks** (capture `followup_prefill.py` to `t2b-t6-fp.bak` in the scratchpad; restore after each; re-run green)
  1. In `prep_note`, change `created <= rd` to `created < rd`. Expected: `test_a_prep_note_written_on_the_report_morning_counts...` FAILS.
  2. Remove `+ sample_marker.not_sample_sql()` and the `AND` before it. Expected: `test_a_trashed_or_sample_prep_note_is_never_linked` FAILS.
  3. In `apply`, replace `trial = copy.deepcopy(doc)` with `trial = doc`. Expected: `test_apply_on_a_doc_it_cannot_copy_or_walk_returns_it_unchanged` FAILS (the lines land in the caller's doc instead of being refused with it).

- [ ] **Step 7: Commit** (`feat(notebook): earnings follow-up prefill, the prep-note link and the quarter's numbers, never invented`; push).

---

### Task 7: The follow-up job

**Files:**
- Modify: `api/services/journal_two/earnings_followup.py` (Task 2's gate grows the job), `api/main.py` (after the task-reminder block, `:8967-8972`)
- Create: `tests/test_earnings_followup.py`

**Interfaces:**
- Consumes: `session_calendar.is_trading_day`; `calendar_alerts._get_reporters_for_date_with_status(iso) -> (set, ok)`; `earnings_prep.sandbox_calendar_active()`, `earnings_prep._sandbox_window()`, `earnings_prep._timing_from_calendar_cache(sym, iso)`, `earnings_prep._member_sets(uid)`; `finnhub_client.fh_get` (V7); `earnings_intel.get_earnings`; `followup_prefill.event_for`, `followup_prefill.as_number`; `alerts.add_alert`; `auth_middleware.get_user_plan`, `is_paid_user` (V18).
- Produces: `FOLLOWUP_SOURCE = "notebook_earnings_followup"`, `DAILY_CAP = 3`, `FIRST_PASS = (16, 45)`, `SECOND_PASS = (18, 0)`; `next_trading_day(d) -> date`; `prev_trading_day(d) -> date`; `reaction_session(report_date: date, timing: str | None) -> date`; `reporters_on(day: date) -> tuple[dict[str, str | None], bool]`; `todays_reports(day: date) -> tuple[dict[str, str], bool, int]`; `followup_url(symbol, report_date: str) -> str`; `notice_copy(symbol, report_date: date, sources: list[str]) -> tuple[str, str]`; `run_followups(now=None, *, pass_label="manual", conn=None, deliver=None) -> dict`; `catch_up_target(now) -> date`; `catch_up_followups(now=None, conn=None, deliver=None) -> dict`; `register_followup_jobs(scheduler) -> bool`. Tables `j2_earnings_followup_log` and `j2_earnings_followup_runs`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_earnings_followup.py
"""Tier 2 part B, item 11 (R-T2B-1..6): the earnings follow-up notice. Who, which reports, when, once,
at most three a day. The seams (reporters, member sets, the paid check, the reaction) are module
functions the run looks up at CALL time, so a monkeypatch reaches them."""
from __future__ import annotations

import ast
import importlib
import os
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from api.services import session_calendar
from api.services.journal_two import earnings_followup as ef
from api.services.journal_two.timeutil import ET

FRI, MON = date(2026, 10, 16), date(2026, 10, 19)


def at(d: date, h=17, m=0):
    return datetime(d.year, d.month, d.day, h, m, tzinfo=ET)


def _weekday_holiday(year=2026, month=11) -> date:
    d = date(year, month, 1)
    while d.month == month:
        if d.weekday() < 5 and not session_calendar.is_trading_day(d):
            return d
        d += timedelta(days=1)
    raise AssertionError("no weekday holiday")          # non-vacuity


@pytest.fixture
def db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    monkeypatch.setenv("NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    conn = auth_db.get_connection()
    yield conn
    conn.close()
    for s in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + s)
        except OSError:
            pass


@pytest.fixture
def world(monkeypatch):
    """reports[day_iso] = {SYM: timing}; sets[uid] = {SYM: [sources]}; reactions[SYM] = pct or None."""
    w = {"reports": {}, "sets": {}, "reactions": {}, "paid": set(), "ok": True, "warmed": []}
    monkeypatch.setattr(ef, "reporters_on", lambda d: (dict(w["reports"].get(d.isoformat(), {})), w["ok"]))
    monkeypatch.setattr(ef, "_member_ids", lambda conn: sorted(w["sets"]))
    monkeypatch.setattr(ef, "_member_sets", lambda uid: dict(w["sets"].get(uid, {})))
    monkeypatch.setattr(ef, "_paid", lambda uid, conn: uid in w["paid"])

    def reaction(sym, rd):
        w["warmed"].append(sym)
        return w["reactions"].get(sym)
    monkeypatch.setattr(ef, "_reaction_pct", reaction)
    return w


def ring(db, now, **kw):
    sent = []
    result = ef.run_followups(now=now, conn=db, deliver=lambda uid, t, m, data: sent.append((uid, t, m, data)), **kw)
    return result, sent


@pytest.mark.parametrize("rd, timing, session", [
    (date(2026, 10, 14), "bmo", date(2026, 10, 14)),
    (date(2026, 10, 14), "dmh", date(2026, 10, 14)),
    (date(2026, 10, 14), "amc", date(2026, 10, 15)),
    (date(2026, 10, 14), None, date(2026, 10, 15)),           # R-T2B-3: unknown is after the close
    (FRI, "amc", MON),
    (date(2026, 10, 17), "bmo", MON),                         # dated a Saturday
])
def test_reaction_session(rd, timing, session):
    assert ef.reaction_session(rd, timing) == session


def test_bmo_today_and_amc_yesterday_ring_today(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo", "AAPL": "amc"}, "2026-10-14": {"NVDA": "amc", "AMD": "bmo"}}
    world["sets"] = {"u1": {"ORCL": ["watchlist"], "AAPL": ["watchlist"], "NVDA": ["positions"], "AMD": ["flagged"]}}
    world["paid"] = {"u1"}
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert sorted(d["symbol"] for _, _, _, d in sent) == ["NVDA", "ORCL"]
    assert result["delivered"] == 2 and result["candidates"] == 2


def test_an_amc_report_on_friday_is_offered_on_monday(db, world):
    world["reports"] = {FRI.isoformat(): {"ORCL": "amc"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["positions"]}}, {"u1"}
    assert ring(db, at(FRI))[1] == []
    _, sent = ring(db, at(MON))
    assert [d["symbol"] for _, _, _, d in sent] == ["ORCL"]
    assert sent[0][3]["reportDate"] == FRI.isoformat() and sent[0][3]["sessionDay"] == MON.isoformat()


def test_a_holiday_rings_nothing_and_the_next_session_carries_it(db, world):
    h = _weekday_holiday()
    before = ef.prev_trading_day(h)
    after = ef.next_trading_day(h)
    world["reports"] = {before.isoformat(): {"ORCL": "amc"}, h.isoformat(): {"AMD": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"], "AMD": ["watchlist"]}}, {"u1"}
    result, sent = ring(db, at(h))
    assert sent == [] and result["skipped"] == "not-a-trading-day"
    _, sent = ring(db, at(after))
    assert sorted(d["symbol"] for _, _, _, d in sent) == ["AMD", "ORCL"]


def test_one_notice_when_held_and_watched(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["positions", "watchlist"]}}, {"u1"}
    _, sent = ring(db, at(date(2026, 10, 15)))
    assert len(sent) == 1 and "You hold it." in sent[0][2]


def test_a_member_who_sold_gets_nothing_unless_still_watching(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {}, "u2": {"ORCL": ["watchlist"]}}, {"u1", "u2"}
    _, sent = ring(db, at(date(2026, 10, 15)))
    assert [uid for uid, *_ in sent] == ["u2"]
    assert "It is on your watchlist." in sent[0][2] and "You hold it." not in sent[0][2]


def test_running_twice_rings_once(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}
    _, first = ring(db, at(date(2026, 10, 15), 16, 45), pass_label="16:45")
    second, again = ring(db, at(date(2026, 10, 15), 18, 0), pass_label="18:00")
    assert len(first) == 1 and again == [] and second["already_sent"] == 1


def test_the_cap_keeps_the_biggest_moves_and_breaks_ties_by_symbol(db, world):
    world["reports"] = {"2026-10-15": {s: "bmo" for s in ("AAA", "BBB", "CCC", "DDD", "EEE")}}
    world["sets"], world["paid"] = {"u1": {s: ["watchlist"] for s in ("AAA", "BBB", "CCC", "DDD", "EEE")}}, {"u1"}
    world["reactions"] = {"AAA": None, "BBB": 3.0, "CCC": -3.0, "DDD": 1.0, "EEE": None}
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert [d["symbol"] for _, _, _, d in sent] == ["BBB", "CCC", "DDD"]
    assert result["capped"] == 2
    rows = db.execute("SELECT symbol FROM j2_earnings_followup_log ORDER BY symbol").fetchall()
    assert [r[0] for r in rows] == ["BBB", "CCC", "DDD"]          # capped names are never written


def test_unmeasured_reactions_rank_last_even_under_the_cap(db, world):
    world["reports"] = {"2026-10-15": {s: "bmo" for s in ("AAA", "ZZZ", "MMM", "BBB")}}
    world["sets"], world["paid"] = {"u1": {s: ["watchlist"] for s in ("AAA", "ZZZ", "MMM", "BBB")}}, {"u1"}
    world["reactions"] = {"AAA": None, "BBB": None, "MMM": None, "ZZZ": 0.1}
    _, sent = ring(db, at(date(2026, 10, 15)))
    assert [d["symbol"] for _, _, _, d in sent] == ["ZZZ", "AAA", "BBB"]


def test_a_failed_delivery_releases_its_claim_and_a_later_pass_retries(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}

    def boom(*a):
        raise RuntimeError("bell down")
    result = ef.run_followups(now=at(date(2026, 10, 15)), conn=db, deliver=boom)
    assert result["failed"] == 1
    assert db.execute("SELECT COUNT(*) FROM j2_earnings_followup_log").fetchone()[0] == 0
    _, sent = ring(db, at(date(2026, 10, 15), 18))
    assert len(sent) == 1


def test_switches_off_or_unpaid_ring_nothing_and_read_nothing(db, world, monkeypatch):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"] = {"u1": {"ORCL": ["watchlist"]}}
    assert ring(db, at(date(2026, 10, 15)))[1] == []              # u1 is not paid
    world["paid"] = {"u1"}
    monkeypatch.delenv("NOTEBOOK_JOURNAL_STYLES_ENABLED")
    r, sent = ring(db, at(date(2026, 10, 15)))
    assert sent == [] and r["skipped"] == "switched-off" and world["warmed"] == []
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    monkeypatch.delenv("NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED")
    assert ring(db, at(date(2026, 10, 15)))[1] == []


def test_the_notice_names_the_card_link_and_the_source(db, world):
    world["reports"] = {"2026-10-15": {"BRK.B": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"BRK.B": ["flagged"]}}, {"u1"}
    _, sent = ring(db, at(date(2026, 10, 15)))
    uid, title, message, data = sent[0]
    assert title == "BRK.B reported: write your follow-up"
    assert message == "BRK.B reported earnings on Oct 15, 2026. You flagged it. Compare what you expected with what happened."
    assert data["source"] == ef.FOLLOWUP_SOURCE
    assert data["research_url"] == "/journal/notebook?followup=BRK.B&reportDate=2026-10-15"


def test_catch_up_targets_the_latest_session_whose_first_pass_has_passed():
    assert ef.catch_up_target(at(date(2026, 10, 15), 16, 50)) == date(2026, 10, 15)
    assert ef.catch_up_target(at(date(2026, 10, 15), 10, 0)) == date(2026, 10, 14)
    assert ef.catch_up_target(at(date(2026, 10, 18), 12, 0)) == FRI           # a Sunday


def test_catch_up_skips_a_day_whose_run_completed(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}
    ring(db, at(date(2026, 10, 15), 16, 45), pass_label="16:45")
    out = ef.catch_up_followups(now=at(date(2026, 10, 15), 19), conn=db, deliver=lambda *a: None)
    assert out == {"ran": False, "reason": "already-complete", "day": "2026-10-15"}


def test_the_registrar_reads_no_switch_and_wires_three_jobs(monkeypatch):
    monkeypatch.setattr(ef, "enabled", lambda: (_ for _ in ()).throw(AssertionError("read at registration")))
    jobs = []

    class FakeScheduler:
        def add_job(self, fn, trigger, **kw):
            jobs.append((kw["id"], str(trigger)))
    assert ef.register_followup_jobs(FakeScheduler()) is True
    ids = [j for j, _ in jobs]
    assert ids == ["notebook_earnings_followup", "notebook_earnings_followup_second", "notebook_earnings_followup_catch_up"]
    assert "hour='16'" in jobs[0][1] and "minute='45'" in jobs[0][1] and "mon-fri" in jobs[0][1]


def test_main_calls_the_registrar():
    tree = ast.parse(Path("api/main.py").read_text(encoding="utf-8"))
    called = {n.func.attr for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "register_task_reminder_job" in called                   # non-vacuity: the sibling is seen
    assert "register_followup_jobs" in called
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd $WT && python -m pytest tests/test_earnings_followup.py -q; code=$?; exit $code`
Expected: FAIL, `AttributeError: module ... has no attribute 'reaction_session'`.

- [ ] **Step 3: Write the job**

Replace `earnings_followup.py` (Task 2's gate stays as written at the top) with:
```python
# api/services/journal_two/earnings_followup.py
"""Tier 2 part B, item 11: the earnings follow-up NOTICE (spec §P2 Tier 2 item 11).

After the session that first traded the earnings result of a member's held, watched or flagged name
closes, the member's Notices box offers "<SYM> reported: write your follow-up". Its link opens a card
whose "Write follow-up" makes the note through the ONE styled-create door (followup_prefill.py).

THE RULES (R-T2B-1..6, 10):
* NEVER WRITES A NOTE (decision R5). This rings a bell; the member makes the note.
* WHO: paid members, over their OWN names (earnings_prep._member_sets: open positions, watchlists,
  flagged). One notice per (member, symbol, report date), however many sets hold the name.
* WHEN: the run on trading day T offers every report whose REACTION SESSION is T (`reaction_session`).
  16:45 ET and 18:00 ET mon-fri, plus a boot catch-up; a holiday is skipped INSIDE the run. The switch
  is read at every RUN, never at registration, and the run also needs NOTEBOOK_JOURNAL_STYLES_ENABLED.
* CLAIM, THEN DELIVER (note_tasks' idiom): ONE atomic INSERT claims AND enforces DAILY_CAP per member
  per session day; a delivery that raises releases its claim.
* Inside the cap: largest |reaction| first, an unmeasured one last, then by symbol. The rest are
  counted (`capped`) and never written or delivered.
* It WARMS earnings_intel (get_earnings, on this scheduler thread) for every name it ranks, so the
  member's create reads what UCT already holds and never waits on a vendor (R-T2B-10).
"""
from __future__ import annotations

import json
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from api.services import auth_db, session_calendar
from api.services.notebook_flags import flag_on
from api.services.journal_two.timeutil import ET

FLAG = "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED"
FOLLOWUP_SOURCE = "notebook_earnings_followup"
FIRST_PASS = (16, 45)
SECOND_PASS = (18, 0)
MISFIRE_GRACE_S = 3600
CATCH_UP_DELAY_S = 120
DAILY_CAP = 3
SAME_SESSION = frozenset({"bmo", "dmh"})
NOTEBOOK_PATH = "/journal/notebook"
_WALK = 15            # calendar days a trading-day walk may step: a long weekend and a holiday fit

_SCHEMA = """
CREATE TABLE IF NOT EXISTS j2_earnings_followup_log (
    user_id      TEXT NOT NULL,
    symbol       TEXT NOT NULL,
    report_date  TEXT NOT NULL,
    session_day  TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'claimed',
    PRIMARY KEY (user_id, symbol, report_date)
);
CREATE INDEX IF NOT EXISTS idx_j2_followup_log_day ON j2_earnings_followup_log (user_id, session_day);
CREATE TABLE IF NOT EXISTS j2_earnings_followup_runs (
    day       TEXT NOT NULL,
    pass      TEXT NOT NULL,
    ran_at    TEXT NOT NULL,
    complete  INTEGER NOT NULL DEFAULT 0,
    result    TEXT NOT NULL,
    PRIMARY KEY (day, pass)
);
"""
_CLAIM = ("INSERT OR IGNORE INTO j2_earnings_followup_log"
          " (user_id, symbol, report_date, session_day, created_at, status)"
          " SELECT ?, ?, ?, ?, ?, 'claimed' WHERE (SELECT COUNT(*) FROM j2_earnings_followup_log"
          " WHERE user_id = ? AND session_day = ?) < ?")


def enabled() -> bool:
    """The gate, read per call (default OFF): the job, the card and the server prefill."""
    return flag_on(FLAG, False)


def _now() -> datetime:
    return datetime.now(tz=ET)


def ensure_schema(conn) -> None:
    conn.executescript(_SCHEMA)


def next_trading_day(d: date) -> date:
    for _ in range(_WALK):
        d += timedelta(days=1)
        if session_calendar.is_trading_day(d):
            return d
    return d


def prev_trading_day(d: date) -> date:
    for _ in range(_WALK):
        d -= timedelta(days=1)
        if session_calendar.is_trading_day(d):
            return d
    return d


def reaction_session(report_date: date, timing: str | None) -> date:
    """The session that first traded the result (R-T2B-2, R-T2B-3)."""
    if not session_calendar.is_trading_day(report_date):
        return next_trading_day(report_date)
    if timing in SAME_SESSION:
        return report_date
    return next_trading_day(report_date)


def _fill_timing(day_iso: str, found: dict) -> None:
    """One Finnhub call for the day, only when some symbol has no time (R-T2B-4). Never raises."""
    if all(found.values()):
        return
    try:
        from api.services.finnhub_client import fh_get
        data = fh_get("/calendar/earnings", {"from": day_iso, "to": day_iso}, timeout=10)
    except Exception:  # noqa: BLE001 -- no time is "after the close" (R-T2B-3), never a failed run
        return
    if not isinstance(data, dict):
        return
    for row in data.get("earningsCalendar") or []:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").strip().upper()
        hour = str(row.get("hour") or "").strip().lower()
        if sym in found and not found[sym] and hour in ("bmo", "amc", "dmh"):
            found[sym] = hour


def reporters_on(day: date) -> tuple[dict[str, str | None], bool]:
    """({SYM: 'bmo'|'amc'|'dmh'|None}, clean) for reports dated `day`."""
    from api.services.journal_two import earnings_prep as ep
    iso = day.isoformat()
    if ep.sandbox_calendar_active():
        window, timing, partial, _ = ep._sandbox_window()
        return {s: timing.get(s) for s, d in window.items() if d == iso}, not partial
    from api.services import calendar_alerts
    syms, ok = calendar_alerts._get_reporters_for_date_with_status(iso)
    found = {s: ep._timing_from_calendar_cache(s, iso) for s in syms}
    _fill_timing(iso, found)
    return found, ok


def todays_reports(day: date) -> tuple[dict[str, str], bool, int]:
    """({SYM: report date}, partial, unknown-time count) for the reports whose reaction session is `day`."""
    out: dict[str, str] = {}
    partial, unknown = False, 0
    d = prev_trading_day(day)
    while d <= day:
        found, ok = reporters_on(d)
        partial = partial or not ok
        for sym, timing in sorted(found.items()):
            if sym not in out and reaction_session(d, timing) == day:
                out[sym] = d.isoformat()
                unknown += 0 if timing else 1
        d += timedelta(days=1)
    return out, partial, unknown


def _member_ids(conn) -> list[str]:
    return [str(r[0]) for r in conn.execute("SELECT id FROM users")]


def _member_sets(user_id: str) -> dict[str, list[str]]:
    from api.services.journal_two import earnings_prep
    return earnings_prep._member_sets(user_id)


def _paid(user_id: str, conn) -> bool:
    try:
        from api.middleware import auth_middleware as authmw
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            return False
        return bool(authmw.is_paid_user({**dict(row), "plan": authmw.get_user_plan(user_id)}))
    except Exception:  # noqa: BLE001 -- an unreadable plan is "not paid", never a failed run
        return False


def _reaction_pct(symbol: str, report_date: str) -> float | None:
    """The reaction for ranking, and the WARM of earnings_intel for the member's create (R-T2B-10)."""
    try:
        from api.services.earnings_intel import get_earnings
        from api.services.journal_two import followup_prefill as fp
        return fp.as_number((fp.event_for(get_earnings(symbol), report_date) or {}).get("reaction_pct"))
    except Exception:  # noqa: BLE001
        return None


def _day_words(d: date) -> str:
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def followup_url(symbol: str, report_date: str) -> str:
    return f"{NOTEBOOK_PATH}?{urlencode({'followup': symbol, 'reportDate': report_date})}"


def notice_copy(symbol: str, report_date: date, sources: list[str]) -> tuple[str, str]:
    if "positions" in sources:
        why = "You hold it."
    elif "watchlist" in sources:
        why = "It is on your watchlist."
    else:
        why = "You flagged it."
    return (f"{symbol} reported: write your follow-up",
            f"{symbol} reported earnings on {_day_words(report_date)}. {why} "
            "Compare what you expected with what happened.")


def _offer(conn, uid: str, sym: str, report_date: str, day: date, sources: list[str], deliver,
           result: dict) -> None:
    stamp = datetime.now(tz=ET).isoformat(timespec="seconds")
    cur = conn.execute(_CLAIM, (uid, sym, report_date, day.isoformat(), stamp, uid, day.isoformat(), DAILY_CAP))
    conn.commit()
    if cur.rowcount == 0:
        held = conn.execute("SELECT status FROM j2_earnings_followup_log WHERE user_id = ? AND symbol = ?"
                            " AND report_date = ?", (uid, sym, report_date)).fetchone()
        result["capped" if held is None else ("already_sent" if held[0] == "sent" else "in_flight")] += 1
        return
    title, message = notice_copy(sym, date.fromisoformat(report_date), sources)
    data = {"source": FOLLOWUP_SOURCE, "research_url": followup_url(sym, report_date), "symbol": sym,
            "reportDate": report_date, "sessionDay": day.isoformat(), "sources": list(sources)}
    try:
        deliver(uid, title, message, data)
    except Exception:  # noqa: BLE001 -- one member must not stop the rest; a later pass retries
        conn.execute("DELETE FROM j2_earnings_followup_log WHERE user_id = ? AND symbol = ? AND report_date = ?"
                     " AND status = 'claimed'", (uid, sym, report_date))
        conn.commit()
        result["failed"] += 1
        return
    conn.execute("UPDATE j2_earnings_followup_log SET status = 'sent' WHERE user_id = ? AND symbol = ?"
                 " AND report_date = ?", (uid, sym, report_date))
    conn.commit()
    result["delivered"] += 1


def _record_run(conn, result: dict, when: datetime) -> None:
    complete = int(result["failed"] == 0 and result["in_flight"] == 0 and not result["partial"])
    conn.execute("INSERT OR REPLACE INTO j2_earnings_followup_runs (day, pass, ran_at, complete, result)"
                 " VALUES (?, ?, ?, ?, ?)",
                 (result["day"], result["pass"], when.isoformat(timespec="seconds"), complete,
                  json.dumps(result, sort_keys=True)))
    conn.commit()


def run_followups(now: datetime | None = None, *, pass_label: str = "manual", conn=None, deliver=None) -> dict:
    """One pass for the session day of `now` (ET). Safe to run twice, and twice at once."""
    when = (now or _now()).astimezone(ET)
    day = when.date()
    result: dict[str, Any] = {"day": day.isoformat(), "pass": pass_label, "skipped": None, "members": 0,
                              "candidates": 0, "delivered": 0, "already_sent": 0, "in_flight": 0, "capped": 0,
                              "failed": 0, "timing_unknown": 0, "partial": False}
    from api.services.journal_two import journal_styles
    if not (enabled() and journal_styles.enabled()):
        result["skipped"] = "switched-off"
        return result
    if not session_calendar.is_trading_day(day):
        result["skipped"] = "not-a-trading-day"
        return result
    deliver = deliver or _deliver_in_app
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        ensure_schema(conn)
        reports, result["partial"], result["timing_unknown"] = todays_reports(day)
        result["candidates"] = len(reports)
        reactions: dict[str, float | None] = {}
        if reports:
            for uid in _member_ids(conn):
                mine = {s: src for s, src in _member_sets(uid).items() if s in reports}
                if not mine or not _paid(uid, conn):
                    continue
                result["members"] += 1
                for s in mine:
                    if s not in reactions:
                        reactions[s] = _reaction_pct(s, reports[s])
                order = sorted(mine, key=lambda s: (reactions[s] is None, -abs(reactions[s] or 0.0), s))
                for s in order:
                    _offer(conn, uid, s, reports[s], day, mine[s], deliver, result)
        _record_run(conn, result, when)
        return result
    finally:
        if owned:
            conn.close()


def catch_up_target(now: datetime) -> date:
    """Today once its first pass time has passed; otherwise the trading day before."""
    when = now.astimezone(ET)
    d = when.date()
    if session_calendar.is_trading_day(d) and (when.hour, when.minute) >= FIRST_PASS:
        return d
    return prev_trading_day(d)


def catch_up_followups(now: datetime | None = None, conn=None, deliver=None) -> dict:
    """The boot catch-up: run the latest session day whose first pass has passed, unless a pass for that
    day completed (no failure, nothing in flight, every source clean)."""
    target = catch_up_target(now or _now())
    if not enabled():
        return {"ran": False, "reason": "disabled", "day": target.isoformat()}
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        ensure_schema(conn)
        done = conn.execute("SELECT 1 FROM j2_earnings_followup_runs WHERE day = ? AND complete = 1",
                            (target.isoformat(),)).fetchone()
        if done:
            return {"ran": False, "reason": "already-complete", "day": target.isoformat()}
        at = datetime.combine(target, dtime(*SECOND_PASS), tzinfo=ET)
        return {"ran": True, **run_followups(now=at, pass_label="catch-up", conn=conn, deliver=deliver)}
    finally:
        if owned:
            conn.close()


def register_followup_jobs(scheduler) -> bool:
    """16:45 and 18:00 ET mon-fri, each with a one-hour misfire grace, and a one-shot boot catch-up.
    ⛔ The switch is NOT read here (read at every run). ⛔ Each body looks its run up at CALL time."""
    from zoneinfo import ZoneInfo
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.date import DateTrigger
    et = ZoneInfo("America/New_York")

    def _boundary(label: str, run):
        def body() -> None:
            try:
                print(f"[notebook-earnings-followup] {label}: {run()}")
            except Exception as e:  # noqa: BLE001 -- a failed run must never break the scheduler
                print(f"[notebook-earnings-followup] {label} failed: {e}")
        return body

    for job_id, (h, m), label in (("notebook_earnings_followup", FIRST_PASS, "16:45"),
                                  ("notebook_earnings_followup_second", SECOND_PASS, "18:00")):
        scheduler.add_job(
            _boundary(f"{label} pass", lambda label=label: run_followups(pass_label=label)),
            CronTrigger(day_of_week="mon-fri", hour=h, minute=m, timezone=et),
            id=job_id, max_instances=1, coalesce=True, misfire_grace_time=MISFIRE_GRACE_S, replace_existing=True,
        )
    scheduler.add_job(
        _boundary("boot catch-up", lambda: catch_up_followups()),
        DateTrigger(run_date=datetime.now(tz=timezone.utc) + timedelta(seconds=CATCH_UP_DELAY_S)),
        id="notebook_earnings_followup_catch_up", max_instances=1, misfire_grace_time=MISFIRE_GRACE_S,
        replace_existing=True,
    )
    return True


def _deliver_in_app(user_id: str, title: str, message: str, data: dict) -> None:
    """The in-app bell ONLY. `info` is below the Discord threshold, and this path never emails."""
    from api.services.alerts import add_alert
    add_alert(FOLLOWUP_SOURCE, title, message, severity="info", data=data, user_id=user_id)
```
Add one more test for the time fill, in the same file: monkeypatch `finnhub_client.fh_get` to answer `{"earningsCalendar": [{"symbol": "ORCL", "hour": "amc"}, {"symbol": "AMD", "hour": ""}, "junk"]}`, call `ef._fill_timing("2026-10-14", found)` with `found = {"ORCL": None, "AMD": None, "NVDA": "bmo"}`, and assert `found == {"ORCL": "amc", "AMD": None, "NVDA": "bmo"}`. Then make `fh_get` raise and assert `found` is unchanged. Then assert `fh_get` is never called when every symbol already has a time.

- [ ] **Step 4: Wire it in `api/main.py`**

After the task-reminder block (`:8967-8972`):
```python
        # Tier 2 part B (R-T2B-2): Notebook earnings follow-up notices. The registrar wires 16:45 ET and
        # 18:00 ET mon-fri and a one-shot boot catch-up; NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED (and the
        # journal styles switch) are read at every RUN, never here. In-app bell only.
        try:
            from api.services.journal_two import earnings_followup as _j2_followup
            if _j2_followup.register_followup_jobs(_scheduler):
                print("[startup] notebook earnings follow-ups registered (16:45 + 18:00 ET mon-fri, boot "
                      "catch-up; inert unless NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED)")
        except Exception as e:
            print(f"[startup] notebook earnings follow-ups registration failed (non-fatal): {e}")
```

- [ ] **Step 5: Run the tests and the neighbours**

Run: `cd $WT && python -m pytest tests/test_earnings_followup.py tests/test_followup_prefill.py tests/test_note_tasks.py tests/test_notebook_earnings_prep.py tests/test_notebook_flag_parse.py -q; code=$?; exit $code`
Expected: all pass.

- [ ] **Step 6: Mutation checks** (capture `earnings_followup.py` to `t2b-t7-ef.bak`; restore after each; re-run green)
  1. In `reaction_session`, return `report_date` for every timing. Expected: `test_reaction_session` and `test_an_amc_report_on_friday_is_offered_on_monday` FAIL.
  2. Replace `_CLAIM`'s `WHERE (SELECT COUNT(*) ...) < ?` with `WHERE 1`. Expected: the cap test FAILS (five delivered).
  3. Remove the `DELETE` in `_offer`'s except branch. Expected: `test_a_failed_delivery_releases_its_claim...` FAILS.
  4. Drop `reactions[s] is None,` from the sort key. Expected: `test_unmeasured_reactions_rank_last...` FAILS.

- [ ] **Step 7: Commit** (`feat(notebook): earnings follow-up notices, one per member, symbol and report, at most three a day (dark)`; push).

---

### Task 8: The notice kind on Research Home

**Files:**
- Modify: `app/src/pages/journal-2-0/lib/notices.js` (`:12-30`), `app/src/pages/journal-2-0/lib/__fixtures__/notices.json` (`alertsBody`, `_provenance`), `app/src/pages/journal-2-0/lib/notices.test.js`, `app/src/pages/journal-2-0/components/notebook/NoticesBox.test.jsx`
- Create: `tools/capture_followup_notice.py`

**Interfaces:**
- Consumes: the alert row `run_followups` writes (Task 7), as `GET /api/alerts?limit=20` serves it.
- Produces: `toNotices` emits `{ kind: 'followup', title, line, href, source: 'alert' }` for a `notebook_earnings_followup` row whose `data.research_url` starts with `/journal/notebook?followup=`, and no link otherwise.

- [ ] **Step 1: Capture the row from the real producer and the real route**

The fixture is CAPTURED, never typed (`notices.json` `_provenance`). Write `tools/capture_followup_notice.py`. It runs a census-pinned CHILD the way `tools/notebook_fin_walk.py:544-653` runs `POST_CHILD`, so nothing reaches `C:\data`. The child:
1. calls `hub_sandbox_boot.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)`, sets both switches to `1`, and runs `auth_db.init_db()`;
2. creates a user with `auth_service.create_user` (the function signup calls; V-record its import path);
3. monkeypatches the job's seams (`reporters_on`, `_member_ids`, `_member_sets`, `_paid`, `_reaction_pct`) to one BMO report of `ORCL` dated the pinned trading day and on the user's watchlist, and runs `earnings_followup.run_followups(now=<that day> 17:00 ET)` with the DEFAULT delivery (`add_alert`);
4. reads `GET /api/alerts?limit=20` through a `TestClient` over a FastAPI app holding only the alerts router (V6 names it), with `get_current_user` overridden to that user, and prints `CAPTURED <json>`.

The parent writes the printed body to `docs/notebook/evidence/t2b-notice-capture/alerts-body.json` (raw first; commit it). Then insert the one follow-up row into `notices.json`'s `alertsBody` BY TEXT (the Edit tool), keeping the file's own formatting, and extend `_provenance` with one sentence: "The notebook_earnings_followup row was captured the same way on <date> by tools/capture_followup_notice.py (earnings_followup.run_followups, default delivery -> alerts.add_alert)."

- [ ] **Step 2: Write the failing tests**

In `notices.test.js`, update the two existing expectations that list the fixture's kinds:
```js
    expect(kinds).toEqual(['fill', 'followup', 'reminder', 'resurface'])
```
```js
    expect(types).toEqual(['notebook_earnings_followup', 'notebook_entry_context_new_fill', 'notebook_task_reminder'])
```
and add:
```js
  it('a follow-up says what the bell said and opens the card', () => {
    const f = toNotices(fx.alertsBody, { insights: [] }).find((n) => n.kind === 'followup')
    expect(f.title).toBe('ORCL reported: write your follow-up')
    expect(f.line).toMatch(/^ORCL reported earnings on [A-Z][a-z]{2} \d{1,2}, \d{4}\. It is on your watchlist\./)
    expect(f.href).toMatch(/^\/journal\/notebook\?followup=ORCL&reportDate=\d{4}-\d{2}-\d{2}$/)
  })
  it('a follow-up row whose link is not the card has no link', () => {
    const row = { ...fx.alertsBody.find((r) => r.type === 'notebook_earnings_followup') }
    row.data = { ...row.data, research_url: 'https://elsewhere.example/x' }
    expect(toNotices([row], { insights: [] })[0].href).toBeNull()
  })
```
In `NoticesBox.test.jsx`, add a case that the follow-up row renders as a link named `ORCL reported: write your follow-up` whose `href` is the card link, and that pressing it posts `/api/alerts/<id>/read` (follow that file's existing reminder case).

- [ ] **Step 3: Run them and see them fail**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/notices.test.js src/pages/journal-2-0/components/notebook/NoticesBox.test.jsx; code=$?; exit $code`
Expected: FAIL (`followup` missing from the kinds).

- [ ] **Step 4: Teach `toNotices` the kind**

In `notices.js`, after `const FILL = ...` (`:13`):
```js
const FOLLOWUP = 'notebook_earnings_followup'
const FOLLOWUP_LINK = '/journal/notebook?followup='
```
and after the `FILL` branch (`:26-28`):
```js
    } else if (a.type === FOLLOWUP) {
      // Tier 2 part B: the door only follows the card's own link (the job writes nothing else).
      const url = a.data?.research_url
      out.push({ key: `a:${a.id}`, id: a.id, kind: 'followup', title: a.title || 'Write an earnings follow-up',
        line: a.message || '', href: typeof url === 'string' && url.startsWith(FOLLOWUP_LINK) ? url : null, source: 'alert' })
```
Update the file's header comment to name the three notebook alert rows.

- [ ] **Step 5: Run the tests and the notices a11y rail**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/notices.test.js src/pages/journal-2-0/components/notebook/NoticesBox.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.notices.test.jsx src/pages/journal-2-0/a11y/notices.a11y.test.jsx; code=$?; exit $code`
Expected: all pass.

- [ ] **Step 6: Commit** (`feat(notebook): Notices shows the earnings follow-up bell, captured from the real producer`; the raw capture is in its own commit first; push).

---

### Task 9: The card and the create

**Files:**
- Create: `app/src/pages/journal-2-0/lib/followupCreate.js`, `app/src/pages/journal-2-0/lib/followupCreate.test.js`, `app/src/pages/journal-2-0/components/notebook/FollowupOffer.jsx`, `app/src/pages/journal-2-0/components/notebook/FollowupOffer.module.css`, `app/src/pages/journal-2-0/components/notebook/FollowupOffer.test.jsx`, `app/src/pages/journal-2-0/tabs/NotebookTab.followup.test.jsx`
- Modify: `app/src/pages/journal-2-0/lib/noteCreation.js` (`:28-47`), `app/src/pages/journal-2-0/lib/noteCreation.test.js` (V-named), `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (lazy list `:134-142`, the deep-link area `:1901-1929`, the render after `:1962-1964`)

**Interfaces:**
- Consumes: `createNoteViaApi`, `settleNoteWrite`, `earningsFollowupEnabled()` (Task 2), `journalStylesEnabled()`.
- Produces: `FOLLOWUP_TAGS = ['earnings', 'earnings-followup']`; `followupWhen(iso) -> string` ("Oct 14, 2026"); `followupTitle(symbol, iso) -> string` ("Earnings follow-up — ORCL (Oct 14)"); `parseFollowupParams(searchParams) -> { symbol, reportDate } | null`; `createFollowupNote({ symbol, reportDate, folderId }) -> Promise<note>`; `FollowupOffer` default export with props `{ open, searchParams, folderId, onCreated(note), onDismiss() }`; exported `FOLLOWUP_REGION = 'Earnings follow-up'`, `FAILED_SENTENCE`.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/pages/journal-2-0/lib/followupCreate.test.js
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./noteCreation', () => ({ createNoteViaApi: vi.fn() }))
vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => {}) }))
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { createFollowupNote, followupTitle, parseFollowupParams } from './followupCreate'

describe('createFollowupNote', () => {
  beforeEach(() => { createNoteViaApi.mockReset(); settleNoteWrite.mockClear() })
  it('asks the server for an earnings follow-up and lands the answer', async () => {
    createNoteViaApi.mockResolvedValue({ id: 'n7' })
    const note = await createFollowupNote({ symbol: 'orcl', reportDate: '2026-10-14', folderId: 'f1' })
    expect(createNoteViaApi).toHaveBeenCalledWith({
      title: 'Earnings follow-up — ORCL (Oct 14)', kindId: 'earnings_followup', ticker: 'ORCL',
      tags: ['earnings', 'earnings-followup'], earningsFollowup: { reportDate: '2026-10-14' }, folderId: 'f1',
    })
    expect(settleNoteWrite).toHaveBeenCalledWith('n7', note)
  })
  it('refuses a symbol or a date that is not one, and calls nothing', async () => {
    await expect(createFollowupNote({ symbol: '12$', reportDate: '2026-10-14' })).rejects.toThrow()
    await expect(createFollowupNote({ symbol: 'ORCL', reportDate: '2026-02-30' })).rejects.toThrow()
    expect(createNoteViaApi).not.toHaveBeenCalled()
  })
  it('reads the link the bell carries, and nothing else', () => {
    expect(parseFollowupParams(new URLSearchParams('followup=BRK.B&reportDate=2026-10-14')))
      .toEqual({ symbol: 'BRK.B', reportDate: '2026-10-14' })
    for (const q of ['followup=ORCL', 'reportDate=2026-10-14', 'followup=ORCL&reportDate=10/14/2026',
      'followup=<b>&reportDate=2026-10-14', 'followup=ORCL&reportDate=2026-13-01']) {
      expect(parseFollowupParams(new URLSearchParams(q)), q).toBeNull()
    }
  })
  it('names the note after the ticker and the day', () => { expect(followupTitle('amd', '2026-01-05')).toBe('Earnings follow-up — AMD (Jan 5)') })
})
```
```jsx
// app/src/pages/journal-2-0/components/notebook/FollowupOffer.test.jsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../lib/followupCreate', async (importOriginal) => ({ ...(await importOriginal()), createFollowupNote: vi.fn() }))
import { createFollowupNote } from '../../lib/followupCreate'
import FollowupOffer, { FAILED_SENTENCE } from './FollowupOffer'

const params = new URLSearchParams('followup=ORCL&reportDate=2026-10-14')

describe('FollowupOffer', () => {
  beforeEach(() => { createFollowupNote.mockReset() })
  it('names the report and makes the note only on the press', async () => {
    createFollowupNote.mockResolvedValue({ id: 'n7' })
    const onCreated = vi.fn()
    render(<FollowupOffer open searchParams={params} onCreated={onCreated} onDismiss={() => {}} />)
    expect(screen.getByRole('region', { name: 'Earnings follow-up' })).toBeTruthy()
    expect(screen.getByText('ORCL reported on Oct 14, 2026. Write what you expected, what happened, and what you’ll do differently.')).toBeTruthy()
    expect(createFollowupNote).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))   // a second press while busy
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'n7' }))
    expect(createFollowupNote).toHaveBeenCalledTimes(1)
  })
  it('a failed create says so in words and makes nothing', async () => {
    createFollowupNote.mockRejectedValue(Object.assign(new Error('x'), { status: 500, detail: 'Traceback' }))
    render(<FollowupOffer open searchParams={params} onCreated={() => {}} onDismiss={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILED_SENTENCE)
    expect(screen.queryByText(/Traceback/)).toBeNull()
  })
  it('Not now leaves without a note; a closed or bad link renders nothing', () => {
    const onDismiss = vi.fn()
    const { unmount } = render(<FollowupOffer open searchParams={params} onCreated={() => {}} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onDismiss).toHaveBeenCalled()
    unmount()
    const { container } = render(<FollowupOffer open searchParams={new URLSearchParams('followup=ORCL')} />)
    expect(container.innerHTML).toBe('')
    const { container: c2 } = render(<FollowupOffer open={false} searchParams={params} />)
    expect(c2.innerHTML).toBe('')
  })
})
```
`NotebookTab.followup.test.jsx`: copy `NotebookTab.kindPicker.test.jsx`'s mocks and `beforeEach` (`:1-70`) and cover four cases, each asserting rendered text or roles:
- both switches latched on, `initialEntries={['/journal/notebook?followup=ORCL&reportDate=2026-10-14']}`: the region "Earnings follow-up" shows; pressing "Write follow-up" calls the mocked `createNoteViaApi` once with `kindId: 'earnings_followup'`, and the mocked `NoteEditorPage` then renders with `data-note-id="new1"`;
- follow-up switch off: no region, and no request for the card's chunk (no `createNoteViaApi`);
- a note already open (`?note=n1&followup=ORCL&reportDate=2026-10-14`): no region;
- "Not now": the region goes and the URL loses both parameters.

In `noteCreation.test.js`, add: `earningsFollowup: { reportDate: '2026-10-14' }` is in the body; `earningsFollowup: 'yes'` and `earningsFollowup: { reportDate: 5 }` are not.

- [ ] **Step 2: Run them and see them fail**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/followupCreate.test.js src/pages/journal-2-0/components/notebook/FollowupOffer.test.jsx src/pages/journal-2-0/tabs/NotebookTab.followup.test.jsx src/pages/journal-2-0/lib/noteCreation.test.js; code=$?; exit $code`
Expected: FAIL (modules missing).

- [ ] **Step 3: Pass `earningsFollowup` through the one create path**

In `noteCreation.js`, add `earningsFollowup` to the destructured arguments (`:28-30`) and, after the `planPrefill` line (`:46`):
```js
      // Tier 2 part B: the server adds the prep-note link and the quarter's numbers. Sent only as
      // { reportDate: 'YYYY-MM-DD' }; any other shape stays off the wire.
      ...(earningsFollowup && typeof earningsFollowup.reportDate === 'string'
        ? { earningsFollowup: { reportDate: earningsFollowup.reportDate } } : {}),
```
Extend the docblock's list of additive keys by one sentence naming it.

- [ ] **Step 4: Write `followupCreate.js`**

```js
// app/src/pages/journal-2-0/lib/followupCreate.js
/**
 * Tier 2 part B, item 11 (R-T2B-7) -- the door that MAKES an earnings follow-up note. The same shape as
 * /plan's createPlanNote: createNoteViaApi (the one network path every creation uses) as a styled create
 * of the member's default Earnings follow-up style; the server adds the prep-note link and the quarter's
 * numbers in the SAME insert (api/services/journal_two/followup_prefill.py). Landed with settleNoteWrite
 * before any editor can meet it. Imported only by the lazy FollowupOffer card.
 */
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'

const SYMBOL_RE = /^[A-Za-z][A-Za-z.\-]{0,9}$/
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
export const FOLLOWUP_TAGS = Object.freeze(['earnings', 'earnings-followup'])

function realDay(iso) {
  const m = ISO_RE.exec(String(iso || ''))
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null
}

const fmt = (d, withYear) => d.toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
})

export function followupWhen(iso) {
  const d = realDay(iso)
  return d ? fmt(d, true) : String(iso || '')
}

export function followupTitle(symbol, iso) {
  const d = realDay(iso)
  return `Earnings follow-up — ${String(symbol).toUpperCase()}${d ? ` (${fmt(d, false)})` : ''}`
}

export function parseFollowupParams(searchParams) {
  const symbol = String(searchParams?.get?.('followup') || '').trim()
  const reportDate = String(searchParams?.get?.('reportDate') || '').trim()
  if (!SYMBOL_RE.test(symbol) || !realDay(reportDate)) return null
  return { symbol: symbol.toUpperCase(), reportDate }
}

export async function createFollowupNote({ symbol, reportDate, folderId } = {}) {
  const p = parseFollowupParams(new URLSearchParams({ followup: symbol || '', reportDate: reportDate || '' }))
  if (!p) throw new Error('not a follow-up')
  const created = await createNoteViaApi({
    title: followupTitle(p.symbol, p.reportDate), kindId: 'earnings_followup', ticker: p.symbol,
    tags: [...FOLLOWUP_TAGS], earningsFollowup: { reportDate: p.reportDate },
    ...(folderId ? { folderId } : {}),
  })
  await settleNoteWrite(created?.id ?? null, created)
  return created
}
```

- [ ] **Step 5: Write the card**

```jsx
// app/src/pages/journal-2-0/components/notebook/FollowupOffer.jsx
// Tier 2 part B (R-T2B-7): the member-pressed door of an earnings follow-up. The notice links to
// /journal/notebook?followup=SYM&reportDate=YYYY-MM-DD; this card names the report and makes the note
// ONLY on "Write follow-up" (decision R5: the server never writes a note). A lazy chunk: NotebookTab
// fetches it the first time such a link is open. A refusal is a fixed sentence, never the server's.
import { useRef, useState } from 'react'
import { createFollowupNote, followupWhen, parseFollowupParams } from '../../lib/followupCreate'
import styles from './FollowupOffer.module.css'

export const FOLLOWUP_REGION = 'Earnings follow-up'
export const FAILED_SENTENCE = "Couldn't create the follow-up. Nothing was saved."

export default function FollowupOffer({ open, searchParams, folderId, onCreated, onDismiss }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const pressed = useRef(false)
  const p = open ? parseFollowupParams(searchParams) : null
  if (!p) return null
  const write = async () => {
    if (pressed.current) return
    pressed.current = true
    setBusy(true)
    setError(null)
    try {
      const note = await createFollowupNote({ ...p, folderId })
      onCreated?.(note)
    } catch {
      pressed.current = false
      setError(FAILED_SENTENCE)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={styles.card} role="region" aria-label={FOLLOWUP_REGION} data-followup-offer>
      <h2 className={styles.title}>Earnings follow-up for {p.symbol}</h2>
      <p className={styles.line}>
        {p.symbol} reported on {followupWhen(p.reportDate)}. Write what you expected, what happened, and what you’ll do differently.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={write} aria-busy={busy || undefined}>Write follow-up</button>
        <button type="button" className={styles.secondary} onClick={() => onDismiss?.()} disabled={busy}>Not now</button>
      </div>
    </section>
  )
}
```
`FollowupOffer.module.css`: a card in the Notebook's own tokens (copy the variables `NoticesBox.module.css` uses for its box, border and text colours). Both buttons get `min-height: var(--tap-min)` inside `@media (max-width: 1024px)`, and the actions wrap at `@media (max-width: 640px)`. No other breakpoints.

- [ ] **Step 6: Mount it in `NotebookTab`**

Beside the other lazy dialogs (`:134-142`):
```js
// Tier 2 part B (R-T2B-7): the earnings follow-up card, fetched the first time its link is open.
const FollowupOffer = lazyDialog(() => import('../components/notebook/FollowupOffer'), 'earnings follow-up')
```
Import `earningsFollowupEnabled` from `../lib/earningsFollowupFlag`. Next to the `?new=` deep link (`:1901-1929`):
```js
  // Tier 2 part B: /journal/notebook?followup=SYM&reportDate=YYYY-MM-DD (the earnings follow-up bell's
  // link). The card parses and checks the two values itself; nothing is made until its button is pressed.
  const followupOpen = searchParams.has('followup') && !noteId && earningsFollowupEnabled() && journalStylesEnabled()
  const leaveFollowup = useCallback((noteIdToOpen) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('followup')
      next.delete('reportDate')
      if (noteIdToOpen) next.set('note', noteIdToOpen)
      return next
    }, { replace: !noteIdToOpen })
  }, [setSearchParams])
```
And render it right after the `actionError` block (`:1962-1964`):
```jsx
      <FollowupOffer
        open={followupOpen}
        searchParams={searchParams}
        onCreated={(note) => { refresh(); if (note?.id) leaveFollowup(note.id) }}
        onDismiss={() => leaveFollowup(null)}
      />
```
If Task 1 V12 found that `lazyChunk` throws on a failed fetch instead of rendering nothing, wrap the element in the guard Part A used for its doors (`git show c57a084a08 -- app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx`), with a test that a rejected import renders nothing.

- [ ] **Step 7: Run the task's files and the rails**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/followupCreate.test.js src/pages/journal-2-0/components/notebook/FollowupOffer.test.jsx src/pages/journal-2-0/tabs/NotebookTab.followup.test.jsx src/pages/journal-2-0/lib/noteCreation.test.js src/pages/journal-2-0/tabs/NotebookTab.kindPicker.test.jsx src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/components/screener/reachable.test.js src/styles/tapFloor.test.js; code=$?; exit $code`
Expected: all pass (no new red beyond Task 1's record). `rawErrorSurface.test.js` too, if V-records show it scans components.

- [ ] **Step 8: Commit** (`feat(notebook): the earnings follow-up card, Write follow-up makes the note (dark)`; push).

---

### Task 10: The Reminder slash item

**Files:**
- Create: `app/src/pages/journal-2-0/lib/reminderItem.js`, `app/src/pages/journal-2-0/lib/reminderItem.test.js`
- Modify: `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx` (the item list after `:134-141`; `BASICS` `:336-339`), the slash menu's test file (V-named; Part A's `SlashMenu.test.jsx`)

**Interfaces:**
- Consumes: `runDateCommand(editor, choice, range)`, `dateSuggestPluginKey` (`lib/dateSuggest.js:111-120`); `buildExtensions()` (`lib/tiptap.js`).
- Produces: `REMINDER_LEAD = 'Follow up '`; `insertReminder(editor, range) -> boolean`; a slash item `{ title: 'Reminder', keywords: ['remind', 'reminder', 'follow up'] }` in the Basics group.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/pages/journal-2-0/lib/reminderItem.test.js
// Tier 2 part B, item 12 (R-T2B-12): "/remind" makes an unticked task holding "Follow up " and opens
// the EXISTING @ date list; runDateCommand stays the one inserter of the date. On the real roster.
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { dateSuggestPluginKey, runDateCommand } from './dateSuggest'
import { insertReminder, REMINDER_LEAD } from './reminderItem'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const task = (text) => ({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [para(text)] }] })

describe('insertReminder', () => {
  let editor
  afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })
  function mount(...blocks) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: blocks } })
    editor.commands.focus('end', { scrollIntoView: false })
    return editor
  }
  const tasks = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'taskItem') o.push({ checked: n.attrs.checked, text: n.textContent, dates: (() => { const d = []; n.descendants((c) => { if (c.type.name === 'dateMention') d.push(c.attrs.date) }); return d })() }) }); return o }
  const typedRange = (ed, s) => { const to = ed.state.selection.from; return { from: to - s.length, to } }

  it('on an empty line: one unticked task holding the lead, and the date list open', () => {
    const ed = mount(para(''))
    ed.commands.insertContent('/remind')
    expect(insertReminder(ed, typedRange(ed, '/remind'))).toBe(true)
    expect(tasks(ed)).toEqual([{ checked: false, text: `${REMINDER_LEAD}@`, dates: [] }])
    expect(dateSuggestPluginKey.getState(ed.state).active).toBe(true)
  })
  it('the date goes in through runDateCommand, inside the task\'s own paragraph', () => {
    const ed = mount(para(''))
    ed.commands.insertContent('/remind')
    insertReminder(ed, typedRange(ed, '/remind'))
    const s = dateSuggestPluginKey.getState(ed.state)
    expect(runDateCommand(ed, { date: '2026-10-21' }, s.range)).toBe(true)
    const t = tasks(ed)
    expect(t).toHaveLength(1)
    expect(t[0].checked).toBe(false)
    expect(t[0].dates).toEqual(['2026-10-21'])
    expect(t[0].text.startsWith(REMINDER_LEAD.trim())).toBe(true)
    expect(t[0].text).not.toContain('@')
    expect(dateSuggestPluginKey.getState(ed.state).active).toBe(false)
  })
  it('on a line with words, the words stay and the task goes on its own line', () => {
    const ed = mount(para('Buy ORCL '))
    ed.commands.insertContent('/remind')
    insertReminder(ed, typedRange(ed, '/remind'))
    expect(ed.state.doc.firstChild.type.name).toBe('paragraph')
    expect(ed.state.doc.firstChild.textContent).toBe('Buy ORCL ')
    expect(tasks(ed).map((t) => t.text)).toEqual([`${REMINDER_LEAD}@`])
  })
  it('inside a task with words, a new task follows it', () => {
    const ed = mount(task('Call broker '))
    ed.commands.insertContent('/remind')
    insertReminder(ed, typedRange(ed, '/remind'))
    expect(tasks(ed).map((t) => t.text)).toEqual(['Call broker ', `${REMINDER_LEAD}@`])
  })
  it('adds no node, mark or attribute', () => {
    const ed = mount(para(''))
    expect(Object.keys(ed.schema.nodes)).not.toContain('reminder')
    expect(Object.keys(ed.schema.nodes.dateMention.spec.attrs)).toEqual(['date'])
  })
})
```
After the date the task's paragraph is "Follow up ", the mention and a space (`runDateCommand` adds the space, `dateSuggest.js:116`), so its `textContent` starts with "Follow up" and holds no "@".

In the slash menu test file, add:
```js
describe('/remind', () => {
  it('the Reminder row is a Basics item and ranks first for "remind"', () => {
    const items = blockItemsAvailable(null)
    const reminder = items.find((i) => i.title === 'Reminder')
    expect(reminder.keywords).toEqual(['remind', 'reminder', 'follow up'])
    expect(blockItemGroup(reminder)).toBe('basics')
    expect(rankedBlockItems(items, 'remind')[0].title).toBe('Reminder')
    expect(rankedBlockItems(items, 'follow').map((i) => i.title)).toContain('Reminder')
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/reminderItem.test.js <the slash test file>; code=$?; exit $code`
Expected: FAIL (`reminderItem` missing; no Reminder row).

- [ ] **Step 3: Write `reminderItem.js`**

```js
// app/src/pages/journal-2-0/lib/reminderItem.js
// Tier 2 part B, item 12 (R-T2B-12): "/remind". An unticked task whose own line is "Follow up " and
// then the date, chosen in the EXISTING @ list (lib/dateSuggest.js). No new node: a taskItem whose
// own paragraph holds a dateMention is what the Tasks view and the daily task bell already read
// (note_tasks._own_text_and_due). This types "@"; runDateCommand stays the one inserter of the date.
export const REMINDER_LEAD = 'Follow up '

export function insertReminder(editor, range) {
  if (!editor || editor.isDestroyed) return false
  const $from = editor.state.selection.$from
  const inTask = editor.isActive('taskItem')
  const left = $from.parent.textContent.length - (range ? range.to - range.from : 0)
  let chain = editor.chain().focus()
  if (range) chain = chain.deleteRange(range)
  if (inTask) {
    if (left > 0) chain = chain.splitListItem('taskItem')
  } else {
    if (left > 0) chain = chain.splitBlock()
    chain = chain.toggleTaskList()
  }
  return chain.insertContent(`${REMINDER_LEAD}@`).run()
}
```
If V11 shows a command name differs on this roster, use the roster's name and record it.

- [ ] **Step 4: Add the slash item**

In `SlashMenu.jsx`, after the "Due date" item (`:134-141`):
```js
  {
    // Tier 2 part B, item 12: a follow-up task with a date. It makes the task and types "@", which opens
    // the date list (lib/dateSuggest.js): one door for the date, not a second picker.
    title: 'Reminder',
    description: 'A follow-up task with a date',
    keywords: ['remind', 'reminder', 'follow up'],
    command: ({ editor, range }) => insertReminder(editor, range),
  },
```
Import `insertReminder` from `../../lib/reminderItem`. Add `'Reminder'` to `BASICS` after `'Due date'` (`:337`).

- [ ] **Step 5: Run the task's files and the neighbours**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/reminderItem.test.js <the slash test file> src/pages/journal-2-0/components/notebook/SlashMenu.blocks.test.jsx src/pages/journal-2-0/lib/dateSuggest.test.js src/pages/journal-2-0/lib/dateSuggest.coldTab.test.js src/pages/command/keyListenerCensus.test.js; code=$?; exit $code`
Expected: all pass.

- [ ] **Step 6: Commit** (`feat(notebook): /remind makes a dated follow-up task through the @ date list`; push).

---

### Task 11: The rails, the walk group and bytes

**Files:**
- Modify: `app/src/pages/journal-2-0/a11y/notebookSurfaces.js`; `tools/notebook_fin_walk_features.py` (`ORDER` `:42-45`, a `followup()` group after `smart_chips()` `:2989`); `tools/notebook_door_audit_doors.json` (+ `tests/test_notebook_door_audit.py`'s required set if it lists rows); `docs/notebook/screen-reader-pass.md` (rows 42-44 after `:266`); `tools/notebook_nvda_pass.py`
- Create: `app/src/pages/journal-2-0/a11y/followup.a11y.test.jsx`, `docs/notebook/evidence/t2b-bytes-<run-id>.txt`

- [ ] **Step 1: The a11y population**

Add an entry for `components/notebook/FollowupOffer.jsx` (`{ recipe: 'followup-card' }`) to `notebookSurfaces.js`. Write `followup.a11y.test.jsx` over `a11y/axeHarness.js` and `a11y/fixtures.jsx`, with two recipes: the card (region "Earnings follow-up", buttons "Write follow-up" and "Not now"), and the Notices box holding the captured follow-up row (link "ORCL reported: write your follow-up", button "Dismiss ORCL reported: write your follow-up"). Each asserts axe finds no violations AND the accessible names.
Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/a11y/followup.a11y.test.jsx src/pages/journal-2-0/a11y/surfaceCoverage.test.js src/pages/journal-2-0/a11y/ariaCoverage.test.js src/pages/journal-2-0/a11y/targetFloors.test.js src/pages/journal-2-0/a11y/phoneOverflow.test.js src/pages/journal-2-0/a11y/notebookContrast.test.js src/styles/tapFloor.test.js; code=$?; exit $code`

- [ ] **Step 2: The walk group `followup()`**

In `tools/notebook_fin_walk_features.py`, add `"followup"` to `ORDER` after `"smart"` and a key constant beside `:67`:
```python
EARNINGS_FOLLOWUP_KEY = "notebook_earnings_followup_enabled"   # lib/earningsFollowupFlag.js
FOLLOWUP_SYM = "ORCL"
```
Add a module-level child script beside the walk's other children (`tools/notebook_fin_walk.py:544` is the shape), `FOLLOWUP_CHILD`. Given `{data_dir, flags, email, day, symbol}`, it:
1. applies `hub_sandbox_boot.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)` and sets each flag to `1`;
2. seeds the intel snapshot with `fundamentals_snapshot_store.put(earnings_intel._KIND, symbol, payload, 7 * 86400)`, the payload in `earnings_intel._build`'s shape (`tools/notebook_w13c_walk.py:137-168` is the model): one reported quarter dated `day` (FY label, EPS 1.47 vs 1.42 estimate, +3.5%; revenue 15.2e9 vs 15.0e9, +1.3%), three older quarters, a `reaction.events` row for `day` at -4.2, and `meta.retrieved_at` now;
3. runs `earnings_followup.run_followups(now=<day> 17:00 ET, pass_label="walk")` TWICE with the default delivery (the bell's durable copy is how the sandbox server sees it; V6);
4. prints `FOLLOWUP <json>` with both results and the rows of `j2_earnings_followup_log`.
The parent writes the sandbox calendar file first, adding `FOLLOWUP_SYM: {"date": day, "timing": "bmo"}` to the reporters the file already holds (read it, add the key, write it back in the same `indent=1` shape `notebook_fin_walk.py:1077-1079` writes). `day` is the last trading day on or before today in ET (the child computes it with `session_calendar`).

The group's steps:
- **followup.setup** (API, 1280): add `FOLLOWUP_SYM` to the member's watchlist through the route V13 names; make the prep note through `POST /api/j2/notes` with `{"title": "Earnings Prep — ORCL", "ticker": "ORCL", "tags": ["earnings", "earnings-prep"], "bodyJson": ...}`; run the child. PASS when the first run's `delivered == 1` and the second's `already_sent == 1` and `delivered == 0` (Review Focus 7). Record both raw results.
- **followup.notice** at 820 and 390 FIRST (they must not press the link, which marks it read): Home, unfold "Notices · N", assert the row link "ORCL reported: write your follow-up" is visible, at least 44 px tall, and the page has no sideways scroll. At 1280: the same, then click the link and assert the URL carries `followup=ORCL&reportDate=<day>` and the region "Earnings follow-up" is visible.
- **followup.write** at 1280, 820 and 390. At 820 and 390, `goto` the link captured at 1280. Press "Write follow-up"; wait for `?note=`; read the note through `GET /api/j2/notes/<id>`. Assert: the three headings in order; "EPS: $1.47 actual vs $1.42 expected (+3.5% surprise)."; "Reaction: −4.2% close to close"; a "Source:" line; one `taskItem` with a `dateMention`; and the Kind of note property `earnings_followup`. The `noteLink` to the prep note must be present when today is the report day. If today is not a trading day, the prep note was made AFTER `day`, so that one sub-assert is INCONCLUSIVE with that reason, never FAIL.
- **followup.reminder** at 1280, 820 and 390: in a new note, type `/remind`, wait for the option "Reminder", Enter; wait for `#uct-date-suggest [role="option"]`; ArrowDown, Enter (Today). Assert one `[data-type="date-mention"]` inside a task item. Wait for the save to land (the walk's own save wait). Then `GET /api/j2/notes/tasks?status=open` holds a task on that note whose `text` starts with "Follow up" and whose `due` is today. Open `/journal/notebook?view=tasks` and assert a row whose accessible name starts with "Follow up" (`NoteTasksView.jsx:127`).

Each step is NOT_RUN with a reason when `EARNINGS_FOLLOWUP_KEY` (or, for `followup.reminder`, nothing) is off in the sandbox, as `smart_chips()`'s `not_run` does (`:3032-3034`).

- [ ] **Step 3: Door audit rows**

Add two rows to `tools/notebook_door_audit_doors.json` in row 65's shape (V15 confirms 67 and 68 are free):
- 67, "Reminder from the slash menu (Tier 2)": `open_note` "Research: how a base", `{"type": "\n/remind"}`, target `{"role": "option", "name": "~^Reminder"}`, viewports 1280 and 390, `"flag": null`.
- 68, "Earnings follow-up card (Tier 2)": path `/journal/notebook?followup=ORCL&reportDate=2026-10-14`, no steps, target `{"role": "region", "name": "Earnings follow-up"}`, viewports 1280 and 390, flag `NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED`.

Each row's `note` says what it opens and that the walk's `followup.*` steps drive it through.
Run: `cd $WT && python -m pytest tests/test_notebook_door_audit.py -q; code=$?; exit $code`

- [ ] **Step 4: Screen-reader rows**

Add rows 42-44 to `docs/notebook/screen-reader-pass.md` and their driver to `tools/notebook_nvda_pass.py`. Quote each accessible name from the component with its `file:line`, as rows 39-41 do (`:264-266`):
- 42: Home, Notices unfolded: the link "ORCL reported: write your follow-up" (`NoticesBox.jsx:61`) and its Dismiss button (`:65`).
- 43: the card: region "Earnings follow-up", heading "Earnings follow-up for ORCL", button "Write follow-up" (`FollowupOffer.jsx`, the lines as written).
- 44: in a note, `/remind`: the option "Reminder", then the date list's first option "Today" (`DateSuggestList.jsx`).
These rows run in Task 12's NVDA pass, only while the follow-up switch is on in the sandbox.

- [ ] **Step 5: Bytes (R-RAW), and the typing decision**

```bash
cd $WT/app && npm run build > /tmp/t2b-build.log 2>&1; code=$?; tail -3 /tmp/t2b-build.log; exit $code
```
```bash
cd $WT && python tools/notebook_perf_budgets.py --dist app/dist > docs/notebook/evidence/t2b-bytes-$(date -u +%Y%m%dT%H%M%SZ).txt 2>&1; code=$?; exit $code
```
Expected: within `notebook_first_open.max`, and at or under **2,253,816 B** (R-T2B-14). If it is over, move `insertReminder` behind a lazy import and re-measure:
```js
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      import('../../lib/reminderItem').then((m) => m.insertReminder(editor, null)).catch(() => {})
    },
```
Typing: run `git diff --stat 204234469b -- app/src/pages/journal-2-0/lib/tiptap.js`. Empty means no extension or plugin changed, so no per-keystroke path changed; record that line as the evidence and skip the re-measure. If it is not empty, run Part A's typing re-measure (Part A plan, Task 11 Step 5) and compare against p95 4.94 / 7.07 / 9.37 ms.

- [ ] **Step 6: Commit** the raw bytes evidence first, then the rails (`test(notebook): Tier 2 part B rails, the followup walk group, door rows 67-68, NVDA rows 42-44`); push.

---

### Task 12: Gate, walk, PR and the arming packet

**Files:**
- Create: `docs/notebook/t2b-arming.md`
- No product code.

- [ ] **Step 1: The six-shard gate, from a SEPARATE worktree of the tip**

The gate never shares a worktree with an implementer. Use `C:\Users\Patrick\uct-worktrees\notebook-t2b-gate` on branch `notebook-t2b-gate` checked out at the tip, with the same junction rule and its own `.uct-session-owner`. Run `python scripts/gate_shards.py --shards 6` there and read the manifest: the totals lines, the file-count reconciliation, and `GATE EXIT`. Expected: 0 NEW failures against the baseline it records. Then the Python rails this plan touched, by name:
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-t2b-gate && python -m pytest tests/test_earnings_followup.py tests/test_followup_prefill.py tests/test_reminder_block.py tests/test_earnings_intel_held.py tests/test_note_kinds.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_update.py tests/test_journal_styles_schema.py tests/test_journal_styles_create.py tests/test_plan_prefill.py tests/test_prep_create_budget.py tests/test_note_tasks.py tests/test_notebook_earnings_prep.py tests/test_notebook_journal_styles_router.py tests/test_sample_never_feeds_real_numbers.py tests/test_notebook_flags.py tests/test_notebook_flag_parse.py tests/test_feature_flag_ledger.py tests/test_notebook_contract_fixtures.py tests/test_notebook_door_audit.py tests/test_paywall_gate_free_tier.py -q > /tmp/t2b-gate-py.log 2>&1; code=$?; tail -3 /tmp/t2b-gate-py.log; exit $code
```

- [ ] **Step 2: The walk on a sandbox from the tip**

Boot `scripts/hub-sandbox.ps1` from PowerShell, with the data dir single-quoted, the c2 configuration (both switches on) and a paid walk account. Run the walk's `followup` group at 1280 / 820 / 390, on a trading day if possible (Task 11 Step 2 says what changes on another day). The raw JSON goes under `docs/notebook/evidence/t2b-walk-<run-id>/` and is committed first. The snapshot-compare line must read CLEAN for `C:\data`.

- [ ] **Step 3: NVDA rows 42-44 (owner away only)**

Only when the owner has said they are away and no test run is in progress. Start NVDA from PowerShell with the silent config (`%TEMP%\nvda-silent-config`, `-m --log-level=12 --log-file=...`). Run the driver for rows 42-44 against the sandbox. Then quit NVDA with `& 'C:/Program Files/NVDA/nvda.exe' -q` and prove it gone (`Get-Process nvda -ErrorAction SilentlyContinue` returns nothing). Raw log first, then the rows' PASS or FAIL. If the owner is not away, this step waits. It does not block the PR; the arming packet lists it as a check before arming.

- [ ] **Step 4: Open the PR**

`gh pr create` from `notebook-t2b-followup` into `master`. If Part A is not merged yet, the base is `notebook-t2a-assists`, and the PR says so in its first line. The body has: the rulings (R-T2B-1..15), the owner decisions, the gate manifest path, the walk, bytes and capture evidence paths, and two lists. What is dark: the job, the card and the prefill. What is live on merge: the Earnings follow-up kind and style, the `reminder` style block and the Reminder slash item (O-T2B-2). And the rollback for each:
- the job and the card: leave the switch unset, or set it to `0`;
- the kind, the style, the block and the slash item: revert the PR. There is no schema change. Notes already made stay ordinary notes, and their tasks stay tasks;
- the two new tables are additive (`CREATE TABLE IF NOT EXISTS`) and stay behind after a revert, unread.

The body ends with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
The owner merges (merging is classifier-gated for agents). One master merge at a time; wait for `web` SUCCESS before anything else lands.

- [ ] **Step 5: After the merge, verify and hand over the arming packet**

Check that web reached SUCCESS on a fresh boot (the deploy record's status, and ancestry against `origin/production`). Read the startup line "[startup] notebook earnings follow-ups registered". Then run `python tools/hub_nav_smoke.py --auth` (exit 0 PASS, 1 measured, 2 INCONCLUSIVE; H15 if 1). Then, as `smoke@uctintelligence.internal` in its own Playwright context, type `/remind` in a new note, pick Today, confirm the task shows in the Tasks view, and trash the note.

Write `docs/notebook/t2b-arming.md` with:
- the owner's command: `! railway variables --service web --set "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED=1"`;
- the checks after it: a NEW boot (a startup line after the set); the value read in-process; `/api/auth/me` carrying `notebook_earnings_followup_enabled: true` for the smoke account; the next trading day's 16:45 ET pass in the logs (`[notebook-earnings-followup] 16:45 pass: {...}`), with its ledger row in `j2_earnings_followup_runs` read over `railway ssh` with `/opt/venv/bin/python`; the app-wide client smoke (R-27); and `docs/feature_flags.json` moved to `armed` with the flip timestamp in the same docs push;
- what NOT to expect: no bell on a holiday or a weekend; nothing while `NOTEBOOK_JOURNAL_STYLES_ENABLED` is off; at most 3 bells per member per day;
- the rollback: `! railway variables --service web --set "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED=0"`, then verify a new boot;
- the open items: NVDA rows 42-44 if Step 3 waited, and O-T2B-1..4.

Commit and push the doc. Report to the owner in one copy-paste block.

---

## Self-review (done at write time)

- **Spec coverage.** Item 11, "the day after a holding or watched name reports, a notice offers a follow-up note": the job (Task 7) and the Notices kind (Task 8). The notice fires when the reaction session closes, which for an after-close report is the day after (R-T2B-2). "Your prep note's expectation": the prep note is LINKED (Task 6), never parsed, per the controller's ruling. "Beside the actual numbers and the reaction": Task 6's lines under "What happened". Item 12, "Due-date and reminder block (pairs with P0.9)": the Reminder slash item (Task 10) rides P0.9's date list, and the `reminder` block (Task 3) puts it in a style. P0.4: the notice lands in Research Home's Notices box (Task 8). P0.9: `runDateCommand` stays the one inserter (Task 10). The integrity rule: one insert for the note, editor transactions for the Reminder, no note write in the job (Global Constraints, `doorEnumeration` in Task 9). §6: schema (none), performance (Task 11 Step 5: bytes; typing judged by the `tiptap.js` diff), accessibility (Task 11 Steps 1 and 4), offline (the create goes through `createNoteViaApi`; the card needs a connection, and a failure is a fixed sentence), privacy (the bell carries a symbol, a date and the member's own set names; no note text), rollback (Task 12 Step 4), testing (unit, the captured fixture, mutation checks in Tasks 3, 6 and 7, walk steps at three widths, contract fixtures regenerated in Task 4).
- **Placeholders.** Where a shape could not be read at write time, the plan names the V-item that confirms it and what to change if it differs (V5, V6, V9, V10, V11, V12, V13, V15, V18). These are verification gates with a stated fallback, not open blanks. The test-file names Part A's plan left to V3 (the slash menu's test file, `noteCreation.test.js`) are V-named in Task 1 Step 3.
- **Type consistency.** `reaction_session` / `next_trading_day` / `prev_trading_day` / `reporters_on` / `todays_reports` / `run_followups` / `catch_up_target` / `catch_up_followups` / `register_followup_jobs` / `followup_url` / `notice_copy` / `FOLLOWUP_SOURCE` / `DAILY_CAP`; `as_number` / `quarter_for` / `event_for` / `clean_request` / `prep_note` / `number_lines` / `apply` / `FOLLOWUP_KIND`; `FOLLOWUP_HEADINGS`; `get_earnings_held`; `build_reminder` / `add_trading_days` / `reminder_node` / `CREATE_ONLY_BLOCKS`; `earningsFollowupEnabled` / `EARNINGS_FOLLOWUP_FLAG`; `createFollowupNote` / `parseFollowupParams` / `followupTitle` / `followupWhen` / `FOLLOWUP_TAGS`; `FollowupOffer` / `FOLLOWUP_REGION` / `FAILED_SENTENCE`; `insertReminder` / `REMINDER_LEAD`. Each is used under the same name and shape in every task that consumes it.
- **Review Focus.** All eight lines have a test in the owning task: 1, 2, 3, 4, 7 and 8 in Task 7; 5 and 6 in Task 6; 4's reminder half in Task 3; 7's second half in the walk.
