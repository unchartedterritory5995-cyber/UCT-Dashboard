# Notebook finish program: lane DATA

Branch `feat/notebook-fin-data`, from `72715e8001`. Every finding below was first checked
against the code and reproduced with a failing test before anything was changed. Each fix has
a test that pins it and a mutation check (the fix reverted by writing back captured bytes, the
test confirmed red, the fix restored).

Nothing here was run in a browser and nothing touched production. The features stay dark.

## Summary

| Finding | Source | Verdict | Commit |
|---|---|---|---|
| I1 review drafts pick the period in UTC | R2-DATA | Verified | `48499606d4` |
| I2 daily draft files a date-only trade under the previous day | R2-DATA | Verified | `6d6533ccb8` |
| I3 a sample note becomes a real trade's frozen plan | R2-DATA | Verified, and wider than stated | `58eab5e3b0` |
| I4 "Remove sample" dismisses a member's own passed setup | R2-DATA | Verified | `78e3c47813` |
| I5 the "why" text has no export and is last write wins | R2-DATA | Verified | `ac9305c742` |
| M1 an older recap card writes into today's note | R2-DATA | Verified | `45af7139ee` |
| M2 repeat clicks duplicate drafts | R2-DATA | Verified | `374fa661a7` |
| M3 sample removal trusts a client-writable preference | R2-DATA | Verified | `257dac5ab8` |
| M4 a hard delete of a trade driven by that preference | R2-DATA | Verified, worse than "dead" | `257dac5ab8` |
| M6 leak finder honesty | R2-DATA | Verified (three of four parts fixed) | `8cf69859fa` |
| M7 Re-link reads before the lock | R2-DATA | Verified | `80a69d9784` |
| I5 review drafts freeze plans with plan grading off | R5-FLAGS | Verified | `71f24aafd7` |
| I3 the daily draft has no unsent-work check | R3-FRONTEND | Verified by trace | `7965bce661` |
| I-1 unpaid member's add makes vendor calls on the request pool | R1-SECURITY | Verified | `5c4a808a65` |
| I-2 plan-grade reads re-parse notes per trade | R1-SECURITY | Verified | `aef6b44744` |
| I-3 (passed setups part) the list view writes | R1-SECURITY | Verified | `bf635d757b` |
| M-4 (passed setups half) unbounded recursion | lane SEC | Verified | `8a2ce82be4` |
| Default account creation race answers 500 | browser walk | Verified | `cd3f62ef9f` |
| Sample chart plan is not in the drawn shape | lane FE | Verified | `17a43c4894` |

No finding was refuted. Minors not changed are listed at the end, each with its reason.

## I1. Review drafts chose the day, week and month in UTC

**Verified.** `todayDayIso`, `mondayOfIso` and `thisMonthIso` in
`app/src/pages/journal-2-0/lib/reviewDrafts.js` read `toISOString()` and `getUTC*`. At 8:30 PM
Eastern the UTC date is already tomorrow, so an evening draft asked for a day, week or month
with no trades.

**Change.** All three read `todayET` (`lib/calendar.js`), which now takes an optional instant.
No typed offset anywhere.

**Test.** `reviewDrafts.test.js`, "the review period is the Eastern day, week and month". A
table of ten instants: 8:30 PM ET on an ordinary day, a Sunday, the last evening of a month and
of a year, 11:30 PM in winter (where a fixed "minus 4 hours" fails), and both sides of each
daylight-saving change. A control asserts the evening cases really sit on a different UTC date.
Eleven tests were red before the fix.

## I2. The daily draft filed a date-only trade under the previous day

**Verified.** The daily fetch windowed `exit_date` between Eastern midnights. A manual trade
entered with a date and no time is stored at UTC midnight, which is 8 PM Eastern the day
before. The scorecard called by the same draft already used `trading_day_et`.

**Change.** `api/services/journal_two/review_drafts.py` fetches the day's trades once on
`filters._DAY` (imported, not restated) and builds both the trade list and the numbers table
from that one fetch. Weekly and monthly are unchanged.

**Weekly and monthly.** Changed in round 2 (below): they now use Eastern trading weeks and
months too.

**Test.** `tests/test_review_drafts.py`: a date-only trade lands in its own day and not the day
before; the numbers, the list and the scorecard count the same trades; a trade after 8 PM
Eastern stays on its Eastern day; a row with no `trading_day_et` falls back to its exit date.

## I3. A sample note was read as data about the member

**Verified, and wider than the review said.** Reproduced before the fix: the example NVDA
thesis froze itself as the plan of a real NVDA trade; the six example tickers counted as
"symbols you have research on" for the stop alert; the example's stop sat on a real position's
chip; a scan inside a sample note counted as names the member passed on; and the example
chart's hand-written fingerprint was a template for the nightly market match. Seventeen tests
red.

**The marker.** `j2_notes.import_source = 'sample'`. It is written once, at insert, and no
later write changes it. The member-facing import door now refuses that value, so only the
server's own seed can write it.

**The predicate.** New module `api/services/journal_two/sample_marker.py`: the value, the SQL
fragment, a row test and an id lookup. `sample_notebook.SOURCE` and
`sample_examples.IMPORT_SOURCE` are that module's value.

**Where it is applied.**

| Reader | What it no longer reads from a sample |
|---|---|
| `plan_grading` | every match tier, the Re-link (refused with a sentence) and the Re-link picker |
| `playbook_patterns` | "what you wrote before" a trade |
| `notes` (`_member_mentioned_symbols`, `bulk_member_mentioned_symbols`) | symbols the member has research on (stop alert, vocabulary) |
| `thesis_chips` | the chip on a position, holdings or watchlist row |
| `passed_setups` | names saved from a scan |
| `similar_matches` | templates for the nightly match |

`note_levels.load_index` already filtered the marker. That file belongs to lane SEC, so it
keeps its own literal, and a test pins that the literal is the same value.

**Already frozen.** A plan link whose plan came from a sample is dropped on the next read of
that trade, and "Remove sample" drops all of them (`plan_grading.forget_sample_links`). A link
frozen before this fix whose note was then purged from Trash with no read in between cannot be
recognised. The features are dark, so no such row exists in production.

**The rail.** `tests/test_sample_never_feeds_real_numbers.py` lists all 46 modules under `api/`
whose code reads a note table (found by parsing the code, so a table named in a comment does
not count). Each is GUARDED (must use the predicate) or EXEMPT with a reason. A new reader in
neither list fails by name. So does a stale entry, and so does a reader that types the marker
itself. A control feeds the scan a synthetic unguarded reader and checks it is caught. Every
behaviour test has a control where the member's own note with the same words is read.

**Setups board and visual playbook.** Ruled in round 2 (below): the example is shown, labelled
"Example" and in no count.

**Wording.** The example thesis note no longer says a chip appears for it.

## I4. "Remove sample" could dismiss a member's own passed setup

**Verified.** The sample seeded through `passed_setups.add_manual`, which answers the existing
row when the member already has that name on that day, and un-dismisses it. The sample recorded
whatever id came back and later dismissed it.

**Change.** `passed_setups.add_example` writes a row marked `source = 'sample'` and writes
nothing when the member already has a row for the name and day. Removal dismisses rows by that
marker, never by the id in the preference. The sample's row never stands in for the member's:
`add_manual` and the nightly collect ignore it when looking for a duplicate. The list labels
the row "Example".

**Test.** `tests/test_sample_notebook_examples.py`, the "fin-data I4" section. Four mutations,
all red.

## I5. The "why did you take it" text

**Verified, both halves.**

**Export.** `GET /api/j2/trades/export` now carries the text next to its own trade: two columns
after the stable set in the CSV, an `entryWhy` object in the JSON. They appear only when an
exported trade has a why, so a member who never wrote one gets the file byte for byte as
before, and the read creates no table. It is not gated on the entry-context switch.

**Compare-and-set.** `set_why` takes the base the editor read and puts it in the UPDATE's own
WHERE clause. A stale base changes nothing and raises `WhyConflict`. The route answers 409 with
the stored note. A request with no base key is the older bundle and saves as before, the same
rule as the note door.

**Client.** `WhyPrompt` stays in the editor with the typed words untouched, shows the server's
sentence and the other version, and adopts that version as the new base. Saving again is then a
deliberate replacement.

**Observation, not changed.** That CSV has never guarded member-typed cells against being read
as spreadsheet formulas (setup names, tags, and now this text). `api/services/data_exports.py`
does. Worth one small follow-up for the whole file.

## Minors from R2-DATA

- **M1.** Fixed. The draft opens the daily note of the day it drafts. The card says "Draft in
  that day's note" for an older card.
- **M2.** Fixed for the three review doors. Daily skips when the recap heading for that day is
  already there; weekly and monthly open the existing note with the same tag and title. Not
  changed for earnings prep, plan review and playbook snapshot: each makes a visible, dated note
  the member can delete, and earnings prep already has a daily cap and looks for an existing
  note on the server.
- **M3.** Fixed. Removal and the status strip find sample notes by the marker. The preference
  only orders them. A seed that dies after writing the examples leaves nothing behind.
- **M4.** Fixed. The reviewer called the branch dead. It was reachable: the preference is
  client-writable and the branch hard-deleted the trade it named. An existing test asserted
  that delete; it now asserts the trade survives.
- **M5.** Not changed. Checklist state is another lane's file (`gettingStartedPref.js`) and the
  cost of a lost tick is small.
- **M6.** Fixed in three parts: each finding says how many trades it left out for having no R
  and their dollars; each finding says whether it was worse than the period average and the
  note lists the ones that were not under their own heading; the time-window label says "by
  exit time". Not changed: "Holding into earnings" counts a trade closed earlier on the report
  day. Fixing it needs the report's time of day, which the stored context does not hold.
- **M7.** Fixed. The new row is built first, then the lock, then the read and the replace in
  one transaction.
- **M8.** Not changed. Summing entered shares across accounts needs an account on the plan, and
  a plan note has none. A member with the same fill in two accounts on the same day at the same
  price is rare, and the size check says which shares it counted.
- **M9.** Not changed. Split adjustment of stored bars after a save is a property of the bar
  store, not of this feature, and the fix belongs there.
- **M10.** Partly changed. The passed-setups refresh now commits row by row.
  `note_levels.catch_up_all` is lane SEC's file.
- **M11.** Not changed here. One more table is added by this lane (`j2_trade_plan_misses`). It
  is a memo that is safe to drop and is in the purge list and the deletion manifest. The
  rollback note should list it with the other twelve.
- **M12.** Reduced. A grade read still freezes a first match. It no longer happens from review
  drafts while plan grading is off, and an unplanned read writes one remembered row in place of
  repeating the walk.
- **M13.** Not changed. The gallery seed is lane SEC's file.

## Items added by the controller

**R5-FLAGS I5.** Verified: review drafts on, plan grading off, one plan link written. Review
drafts now ask plan grading's own switch. Off: nothing is graded, nothing is written, the
Discipline section is left out. A test lists every module that calls the matcher and fails by
name on a caller not known to be gated.

**R3-FRONTEND I3.** Verified by reading the code; the outbox was not run. The daily draft now
asks `noteHasUnsentWork`, the sibling door's own helper, before it fetches or writes, and
throws that helper's sentence. Callers show the sentence. Trace with the note open in the
editor: clean, the write lands and `settleNoteWrite` records it, so the editor's next save
rebases onto it; with a queued write, the door refuses; typing between the check and the PUT
gets the editor's ordinary 409 handling.

**R1-SECURITY I-1.** Verified. The capture is now paid-only (the same predicate the routes
apply, resolved from the member id), runs on two threads of its own behind a bounded queue (40
in total, 3 per member), remembers the one vendor read per symbol per day (misses too), and
caps vendor reads in flight at 2. A caller that cannot get a slot does not wait; the field is
frozen as a new labelled gap, `source_busy`. The sweep skips unpaid members too. The queue, the
slots and the cache are per process; the "single-process assumptions" list in `CLAUDE.md`
should gain a line for them.

**R1-SECURITY I-2.** Verified by counting SQL statements. `plan_grading.MatchScope` reads a
ticker's notes, a note's versions and the parse of a note state once per request. "Unplanned"
is remembered in `j2_trade_plan_misses` with a stamp of everything that could change it, so a
repeat read does no candidate work. It is a memo, not a freeze. Review drafts grade at most the
newest 300 trades of a period and say how many were left ungraded. Not done: a per-member rate
limit on those routes (router-level, another lane).

**R1-SECURITY I-3, passed setups part.** Verified. The list route is a plain read. The refresh
is queued for after the response, at most once per member per 15 minutes, and commits row by
row. The client reads once more when the server says a refresh was queued.

**Lane SEC M-4, passed setups half.** Verified (a 5,000-deep body raised RecursionError). The
walk is a loop. SEC's helper reads chart embeds only and lives in their file, so the shape is
mirrored, not shared.

**Default account race.** Verified: `GET /api/j2/accounts/comparison` answered 500 with the
race injected. Creation now takes the write lock, inserts or ignores, then reads the stored row
and uses it. Legacy positions and trades are assigned to the stored account. Only this function
creates a default account.

**Sample chart plan shape.** Verified against the product's own writer and reader. The two
chart examples now store levels as `{id, type, role, points: [{time, price}]}`. Tests read each
example through `chart_plan`'s reader, check the level type against the list in `chartPlan.js`
itself, hold the hand-written fingerprint to `tech_fingerprint`'s field list, and hold the
thesis example to the plan reader. The transcript, earnings-prep and passed-setup examples go
through their features' real doors and were already in shape.

## Things another lane or the owner should know

- `sample_marker.py` is the one place to ask "is this note a sample". Lane SEC's
  `note_levels.py` still carries its own literal; switching it to the module is a one-line
  change for that lane.
- The I3 ledger will fail by name when any lane adds a module that reads a note table. That is
  intended. The fix is one line in the test: GUARDED or EXEMPT with a reason.
- New table: `j2_trade_plan_misses`. New missing-reason code: `source_busy`. New export
  columns: `entryWhy`, `entryWhyUpdatedAt`. New response fields: `leakCoverage`, `gradingCap`,
  `refreshQueued`, and `vsBaseline` on each leak finding.
- A sample added before the shape fix is read in the drawn shape (round 2). A plan link frozen
  from a sample is dropped on the next read of that trade or on removal.

## Round 2

| Item | Commit |
|---|---|
| Sample cards: labelled "Example", in no count | `4d8c06ea7d` |
| Weekly and monthly drafts on Eastern trading weeks and months | `5e80f9b597` |
| Rate limit on the plan-grade routes | `f030b8078c` |
| An old-shape sample is read in the drawn shape | `b8d91d4034` |
| Passed setups: a horizon is the market's Nth session (tests lane D5) | `b6e7952586` |

**Sample cards.** The server marks each card the sample made with `example: true`, decided by
`sample_marker`. Sample cards come after the member's own. The setups board's `count` is the
member's own cards. The visual playbook's count, its setup, timeframe and regime tallies, its
slice statistics and its "left out" counts all exclude sample cards. The client renders the
word "Example" from that flag and never infers it. The "none yet" guidance on both screens is
decided on the member's own cards, so a member whose only card is the sample sees it beside the
card. Both modules moved from EXEMPT to GUARDED in the ledger. Tests:
`tests/test_sample_never_feeds_real_numbers.py` (payload), `SetupsBoard.test.jsx` and
`VisualPlaybook.test.jsx` (rendered text).

**Weekly and monthly drafts.** All three periods select on `filters._DAY`. A week is Monday
through Friday and a month its first through last day, as trading days. Each draft fetches
once and builds the list and the numbers from that fetch. A trade closed Friday evening Eastern
is in that week; one closed on the last evening of a month is in that month.

**What Compass uses (not changed).**
- Weekly review: `exit_date` in [Monday 00:00 UTC, Saturday 00:00 UTC).
  `api/services/journal_two/coach_data_assembler.py:54-55`, predicate at `:162`.
- Daily recap: `exit_date` between Eastern midnights. Same file, `:509-511`, used at `:522`.

So the weekly draft and the Compass weekly review now disagree for a trade closed in the
evening Eastern (after 8 PM in summer, 7 PM in winter). The daily draft and the Compass daily
recap already disagreed for a date-only trade. A draft therefore quotes Compass only when
Compass counted exactly the trades the draft lists. When they differ, the quote is left out and
the note carries one sentence naming each window and how many trades are in one and not the
other. Bringing Compass onto the trading-day spine is a separate, small change for whoever
owns it.

**Rate limit.** `notebook_plan_grades.py`: 60 a minute per member for the three reads (one
shared bucket) and 30 a minute for the Re-link, through `public_note_payload.enforce_rate`, the
limiter the sibling routes use. The charge comes after the gate and the session.

**Old-shape sample.** `sample_marker.upgrade_sample_levels` builds the drawn shape in memory
when a sample note is read (`notes._row_to_note`). A read never writes it back. A member's own
note is served exactly as stored.

**Passed setups horizons.** Verified with holes at the start, the middle and the end. Each
horizon is now the name's close on the market's Nth session after the reference. A horizon
whose bar is not stored is "missing"; the best move needs all twenty sessions; with no calendar
in the store every horizon is "unknown". The strict xfail `test_D5_...` on
`feat/notebook-fin-tests` will pass once the branches meet, so its marker has to come off then.

## Two lines for the landing lane to copy

**Rollback note** (add to the list of tables in `docs/notebook/wave5-rollback.md` and wherever
the twelve wave-13 tables are listed):

> `j2_trade_plan_misses` (plan grading's remembered "unplanned" answers). A memo, not a record: safe to leave in place on a rollback and safe to drop at any time, because it is rebuilt on the next grade read. An older build does not read it and does not purge it; the account purge of this build does.

**Single-process state** (add to the "SINGLE-PROCESS assumptions" list in `CLAUDE.md`):

> `entry_context._capture_executor` + `_capture_pending` (the manual-add capture queue: 2 threads, 40 queued in total, 3 per member), `entry_context._VENDOR_SLOTS` (2 report-date vendor reads in flight) and `entry_context._vendor_cache` (one answer per symbol per capture day), and `passed_setups._refresh_seen` (one refresh on view per member per 15 minutes). A second web process doubles each bound and keeps its own cache. The plan-grade rate limits (`notebook-plan-grades-read`, `notebook-plan-grades-relink`) are in the `api/limiter.py` storage already on that list.

## Round 3: passed-setups sessions come from the published market calendar

Round 2 counted sessions from SPY's stored daily bars, so with no SPY rows every horizon read
"unknown". That made the feature depend on one symbol's rows being in one bar store.

**The authority.** The repo already has a trading-session authority that needs no price row:
`api/services/session_calendar.py` (`covers` at `:163`, `is_trading_day` at `:168`,
`close_time` at `:187`). It reads `app/src/lib/marketClock/market_calendar.json`, the NYSE
dataset the browser reads too: holidays and half-days from 2000 to its published horizon.
`passed_setups.calendar_sessions` counts the sessions that have closed after the reference
from it.

**SPY is now only a cross-check, and a fallback outside the dataset.** In
`passed_setups.session_days`:
- a stored bar (SPY's or the name's own) on a day the calendar did not list proves that day
  traded, so it counts;
- the newest session, closed less than 18 hours ago, with no bar from either yet, is not
  counted yet, so its horizons read "pending" while the store catches up, not "missing";
- a listed session is never dropped because rows are absent. A day missing from both stores is
  far more often a failed ingest than a closure the dataset does not know, and dropping it
  would shift every later horizon, which is the original defect.
Only for a reference day outside the dataset do stored rows decide, and with no SPY rows there
either the horizons read "unknown".

**Which bar store, and is SPY guaranteed there.** `passed_setups.read_base` (`:213`) and
`read_after` (`:220`) call `bars_sqlite.get_bars_before` and `get_bars_since`, which read the
local SQLite file `<DATA_DIR>/bars.db` (`api/services/bars_sqlite.py:18`). On the web service
that is the web pod's own volume. Nothing in that path calls a remote bars service. The web's
copy is filled by its own chart fetches and by merging the worker's snapshots
(`api/services/data_sync.py:1022` `merge_snapshot`, `:1077` `sync_if_newer_merge`). SPY is the
first name in the prewarm priority list (`api/services/bars_prewarm.py:778`). That makes SPY
daily bars very likely to be there. It is not a guarantee: nothing asserts it, and a fresh
volume, a failed merge or a paused worker leaves it empty. The feature no longer depends on it.

**Tests** (`tests/test_notebook_passed_setups.py`): horizons are right with no SPY rows at all;
a missing bar is still "missing" and never filled, with no SPY rows; a real market holiday
(Labor Day 2026-09-07, from the published calendar) is not a session; a session that has not
closed is "pending"; the newest session is "pending" for the store's lag and "missing" after
it; a day missing from both stores is still a session. Three mutations, all red. Two older
tests that pinned the SPY-rows calendar were restated on the published one.

**One thing to know.** The published calendar runs to its horizon (2028-12-31 today) and has
its own rail that goes red twelve months before it lapses. An unscheduled closure that is not
yet in the dataset would show that day's horizon as "missing" until the dataset is refreshed.
