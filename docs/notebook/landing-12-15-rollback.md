# Rolling back the wave 12 to 15 landing

Written 2026-10-06 by the rollback lane of the finish program, before the landing merged.
Use the first lever that reaches the problem. Each lever below says what to run, how to check
it in the running process, and what a member with an open tab sees.

**Rule for every check on this page:** `railway variables --kv` shows what the service is
configured with. It does not show what the running process has. Check the process.

## Pick the lever

| What is wrong | Lever | Cost |
|---|---|---|
| One new feature misbehaves | 1. Turn its own switch off | one web restart, no build |
| Tours, the Get started list, What's new or the sample examples misbehave | 2. The wave 14 switch | one web restart, no build |
| Note saving is broken for everyone | 3. The Notebook kill switch | one web restart, no build |
| Something that shipped with no switch is broken (uploads, the new templates, keyboard changes, clicks inside chart blocks, the trade import) | 4. Revert the landing's code, keeping the keep-list | a full gate and a deploy |

Never, for any reason:
- a plain `git revert` of the landing's squash (section 4 says why);
- deleting member data to switch something off.

## 1. Turn one feature off

The sixteen new switches, all off by default:

`NOTEBOOK_TEMPLATE_GALLERY_ENABLED`, `NOTEBOOK_TA_FINGERPRINT_ENABLED`,
`NOTEBOOK_EARNINGS_PREP_ENABLED`, `NOTEBOOK_CHART_PLAN_ENABLED`, `NOTEBOOK_PLAN_GRADING_ENABLED`,
`NOTEBOOK_ENTRY_CONTEXT_ENABLED`, `NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED`,
`NOTEBOOK_PASSED_SETUPS_ENABLED`, `NOTEBOOK_THESIS_CHIPS_ENABLED`,
`NOTEBOOK_VISUAL_PLAYBOOK_ENABLED`, `AWARENESS_NOTE_RESURFACE_ENABLED`,
`NOTEBOOK_SETUPS_BOARD_ENABLED`, `NOTEBOOK_FIND_SIMILAR_ENABLED`, `NOTEBOOK_PLAYBOOK_ENABLED`,
`NOTEBOOK_REVIEW_DRAFTS_ENABLED`, `NOTEBOOK_GETTING_STARTED_ENABLED`.

The one table that lists them is `NOTEBOOK_FLAGS` in `api/routers/auth.py`. Every one is read
from the environment on each request (`api/services/notebook_flags.py`, `flag_on`).

Run:

```sh
railway variables --service web --set "NOTEBOOK_CHART_PLAN_ENABLED=0"
```

- Set it to `0`. Do not delete it: a delete does not restart the service, so the old value
  stays in the running process.
- No code is built, but the process must restart to see the new value. Wait for the new boot.
  If none appears within about three minutes: `railway redeploy --service web --yes`.

Check it in the running process:

1. In a browser, open `https://uctintelligence.com/api/health`. `uptime_seconds` is small again.
2. Sign in as the smoke account in a **new** tab, open the console and run:

   ```js
   fetch('/api/auth/me').then((r) => r.json()).then((j) => j.notebook_chart_plan_enabled)
   ```

   It prints `false`. The key is the variable's name in lower case. This value is computed on
   each request from the process's own environment (`_notebook_flags`, `api/routers/auth.py`),
   so it is the running process answering.
3. The feature's route answers 404, and its surface is gone after a reload.

What a member with an open tab sees: their tab fixed its flags when it loaded
(`app/src/pages/journal-2-0/lib/offline/notebookFlags.js`), so the surface stays on screen and
its requests answer 404 until they reload. Nothing they wrote is deleted. The rows stay in
their tables and come back when the switch is turned on again. Notes stay editable: the
schema level does not depend on any switch.

Resurfacing (`AWARENESS_NOTE_RESURFACE_ENABLED`) stops at the next scan after the restart.
Notices already delivered stay in the Compass list.

## 2. The wave 14 switch

```sh
railway variables --service web --set "NOTEBOOK_GETTING_STARTED_ENABLED=0"
```

This one switch hides every tour except "Notebook basics", the Get started list, the "What your
Notebook can do" preview, Help's Walkthroughs and What's new, and stops the sample notebook from
adding the six per-feature examples. The rule is one function on each side: `checklistEnabled`
in `onboarding/gettingStartedPref.js` and `wave14_switch_on` in
`api/services/notebook_wave14_switch.py`.

Check it the same way as lever 1. The key is `notebook_getting_started_enabled` and it prints
`false`.

What a member with an open tab sees: a tour already running keeps running in that tab. After a
reload the tours, the list and the Help entries are gone. Sample notes they already added stay
until they remove them.

## 3. The Notebook kill switch

```sh
railway variables --service web --set "NOTEBOOK_OFFLINE_DEFAULT_ON=0"
```

This turns the offline layer off for every member: the local working copy and the queue of
unsent saves. It does not hide the Notebook and it removes no feature. Use it when saving notes
is broken across the board, not for one feature. The packet with the full procedure and its
reach is `docs/notebook/kill-switch-flip-packet.md`.

Check it the same way. The key is `notebook_offline_default_on` and it prints `false`.

What a member with an open tab sees: nothing changes in that tab, because the tab fixed its
answer when it loaded. The switch reaches a member when they reload or sign in again.

## 4. Revert the landing's code, keeping the keep-list

Use this only when no switch reaches the problem.

### Why not a plain revert

Two things would be lost. Both are measured in `tests/test_notebook_rollback_never_revert.py`.

1. **Plan data in notes.** A chart block can now hold a setup tag, a frozen fingerprint and a
   plan block in one attribute, `widgetEmbed.ta`. The old editor does not know the attribute.
   It opens the note, drops the value while loading, and its next autosave writes the note
   without it. The old server has no row for the attribute, so it answers 200. No error is
   shown anywhere. With the two schema files kept, the old editor declares level 3, the server
   requires level 4 for that note, and the save is refused. The note becomes read-only with the
   sentence "This note has content from a newer version of the app. Reload to edit it." It is
   never stripped. Bringing the feature back brings editing back.
2. **Account deletion.** The landing adds twelve tables to the list that account deletion
   clears. A revert leaves the tables and their rows in the database. A reverted list would
   leave those rows behind when a member deletes their account.

### The keep-list

| Kept exactly as the landing has it | Why |
|---|---|
| `api/services/journal_two/notebook_schema.py`, `app/src/pages/journal-2-0/lib/notebookSchema.js` | the attribute row, on both sides |
| `tests/test_notebook_schema_guard.py`, `app/src/pages/journal-2-0/lib/notebookSchema.rail.test.js` | the rails for those two files |
| `api/services/journal_two/account_purge.py` | the deletion list |
| `tests/test_journal_two_account_purge.py`, `tests/test_notebook_rollback_never_revert.py` | the rails for it |
| `docs/`, `tools/`, `scripts/`, `CLAUDE.md` | records and instruments are never reverted |

The tool holds this list (`KEEP_AT_TIP`, `KEEP_WITH_LANDING`, `KEEP_PATHS` in
`tools/notebook_rollback_chain.py`). Do not retype it.

### Commands

`<squash>` is the landing's squash commit on master.

```sh
git fetch origin
python tools/notebook_rollback_chain.py --landing <squash> --from origin/master
```

Read the last line of output:

- `"product_conflicts": []` and a `"result"`: the revert is built. Go on.
- `{"stopped": ...}`: a later commit changed the same lines. The tool does not guess. Fix
  forward, or resolve that file by hand the way `docs/notebook/wave5-rollback.md` says under
  "If the tool stops", and rehearse again.
- `"later_commits_on_the_landings_files"` is not empty: the revert merged, but those commits
  touched files the landing changed. Read each one before going on.

Then:

```sh
git switch -c rollback/notebook-w12-15 <result>
git diff origin/master HEAD --stat -- api/services/journal_two/notebook_schema.py app/src/pages/journal-2-0/lib/notebookSchema.js tests/test_notebook_schema_guard.py app/src/pages/journal-2-0/lib/notebookSchema.rail.test.js api/services/journal_two/account_purge.py tests/test_journal_two_account_purge.py tests/test_notebook_rollback_never_revert.py
#   ^ must print NOTHING
python -m pytest tests/test_notebook_rollback_never_revert.py tests/test_notebook_schema_guard.py tests/test_journal_two_account_purge.py -q
python -m pytest api/services/journal_two/test_notes.py tests/test_notes_cas_is_atomic.py tests/test_notes_answer_is_the_committed_row.py tests/test_notes_unbuildable_body_refused.py tests/test_journal_two_notes_versions_router.py -q
cd app && npx vitest run src/pages/journal-2-0/lib/notebookSchema.rail.test.js --maxWorkers=2
```

Expected totals are in "What was rehearsed" below. Then run the full gate, open the pull
request, and squash-merge it. It must land as ONE squash, so that rolling forward again is
reverting that one commit. The deploy is the owner's call.

Before it ships, know these:

- The revert changes files under `api/services/journal_two/` and
  `api/flow_worker_deploy_marker.txt`, so flow-worker restarts and the options tape drops for
  that restart. Land it outside market hours.
- Three Notebook checks gate production (`notebook-a11y`, `notebook-latency`, `notebook-bytes`).
  A red that is a flake is re-run with `gh run rerun <run-id> --failed`, then
  `gh workflow run promote-production.yml -f sha=<sha>`.

### Check it after the deploy

1. `/api/health` in a browser: a new boot.
2. As the smoke account in a new tab: `/api/auth/me` no longer carries the sixteen new keys.
3. A note that holds plan data opens and shows the read-only sentence. A note without plan data
   saves normally.
4. `git merge-base --is-ancestor <revert sha> origin/production` exits 0.

### What a member with an open tab sees

- Their tab keeps the landing's bundle until they reload. It still declares level 4, so it can
  still edit notes that hold plan data, and the kept server table accepts it. No data is lost
  from that tab.
- After a reload they have the old bundle. Notes that hold plan data are read-only with the
  sentence above. Everything else works as it did before the landing.
- The rows the new features wrote stay in the database and are invisible until the landing
  comes back. Notices already sent by resurfacing stay in the Compass list.
- Not measured by this lane: how the old Compass panel labels the three new notice kinds, and
  how the app handles a code chunk that no longer exists on the server.

### Rolling forward again

Revert the revert's one squash. Nothing was deleted, so the features find their data.

## What was rehearsed

Rehearsed on 2026-10-06, locally, with no server. The landing had not merged, so the tool built
the squash it will be (`--pending`): the branch's tree as one commit on `5ecf9ef390`, the newest
master commit the landing had merged. Raw logs, the script and the totals are in
`docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/landing/` (`rehearse.sh`,
`results.txt`).

```sh
python tools/notebook_rollback_chain.py --landing HEAD --pending --from origin/master
bash docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/landing/rehearse.sh
```

The landing changes 425 files outside the never-reverted folders. The revert had 0 conflicts.
Two trees were then checked out in turn inside the lane's own worktree and never pushed.

**Tree A: the landing reverted with the keep-list** (tree `c7cc74c97d`). The only product files
that differ from the pre-landing tree are the kept ones. None of the landing's modules is on
disk.

| Run on tree A | Totals line |
|---|---|
| The kept rails: `tests/test_notebook_rollback_never_revert.py`, `tests/test_notebook_schema_guard.py`, `tests/test_journal_two_account_purge.py` | `42 passed in 27.25s` |
| Note save and load, the pre-landing test files: `api/services/journal_two/test_notes.py`, `tests/test_notes_cas_is_atomic.py`, `tests/test_notes_answer_is_the_committed_row.py`, `tests/test_notes_unbuildable_body_refused.py`, `tests/test_journal_two_notes_versions_router.py` | `3 failed, 185 passed in 166.19s` (see below) |
| The whole server imports and mounts its routes: `tests/test_main_router_order.py` | `8 passed in 30.14s` |
| The kept client rail on the rolled-back editor: `notebookSchema.rail.test.js` | `Test Files 1 passed (1)`, `Tests 17 passed (17)` |
| The A/B probe, expecting the safe outcome | `3 passed in 4.87s` |

The three failures are not caused by the rollback. They are the three append-door cases of
`tests/test_notes_cas_is_atomic.py::test_a_second_writer_in_the_window_never_loses_acknowledged_words`
("the window never opened"). The same three fail the same way on the landing tip itself and on
the untouched pre-landing tree (`C1-cas-on-the-landing-tip.log` and
`C2-cas-on-the-pre-landing-base.log`: `3 failed, 5 passed` on each). They are reported to the
controller as a red that exists today on this box, not triaged by this lane.

Triaged on 2026-10-07: a defect in the test, not in the product. The test looked for the append
doors' read by a typed SQL string that wave 10 L14 (#260) changed, so its window never opened.
The lock was intact throughout. Fixed in `4c9520c606`; the file now reads `13 passed` on the
landing tip and on the pre-landing tree, and a 120-append concurrent probe lost nothing on
either (logs `D0` to `D4` in the same folder). The `185 passed, 3 failed` above was not re-run
on tree A after the fix.

**Tree B: the landing reverted whole** (the pre-landing tree, what a plain `git revert` gives).

| Run on tree B | Totals line |
|---|---|
| The A/B probe, expecting the loss | `3 passed in 2.43s` |
| The A/B probe, expecting the safe outcome | `2 failed, 1 passed in 2.96s` |

The A/B probe is one save and one account deletion, the same file on both trees
(`landing/test_ab_probe.py`). What it printed:

| | Tree A, keep-list kept | Tree B, whole revert |
|---|---|---|
| A level-3 editor saves a plan note without its plan data | answered 409, the plan data is still in the note | answered 200, the plan data is gone |
| A member deletes their account; the twelve tables hold their rows | 0 rows left behind | 12 rows left behind |

What the rehearsal does not show:

- It ran on the squash as it would be on `5ecf9ef390`. Master has moved since. **Run the two
  commands above again after the landing's last merge of master, before it ships**, and again on
  the real squash once it exists (`--landing <squash> --from origin/master`, no `--pending`).
- No browser opened a rolled-back build. The client half is a unit test of the editor, not a
  member's tab.

## What this page does not cover

- **Wave 11 and older.** Wave 11 (#263) is now in the chain as `W11`, measured at its own commit.
  The chain is not current at production's tip, so `--through` cannot be used there yet.
  `docs/notebook/wave5-rollback.md` opens with the details and the list of work left.
- **A rollback through wave 11 or deeper drops that landing's own tables from the deletion
  list**, as every earlier chain step always has. For wave 11 that is `j2_ai_change_sets` and
  `j2_ai_change_items`, and AI actions is on in production. `account_purge.py` cannot simply be
  kept there: the landing's copy imports modules those reverts remove. The lasting fix is to
  keep the table list apart from the code that reads it. That is a product change, and an open
  decision for the controller.
- **No server was started.** Nothing on this page was checked in a browser against a rolled-back
  build. The sandbox boot and browser walk that earlier chain steps had are still owed for this
  landing.
