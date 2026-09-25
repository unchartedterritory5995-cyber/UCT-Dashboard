# RESUME — Notebook 10/10 program, waves 5–6 — checkpoint 2026-09-24 (updated 19:15 CT: wave 5 evidence complete)

> ⭐ **THIS IS THE CURRENT HEADER.** Read this file top to bottom before touching
> either worktree. Everything in it was verified at the timestamps given —
> re-derive anything load-bearing with the commands in §7 before acting on it.

## 0. Resuming with a full prompt

**`docs/notebook/RESUME-PROMPT.md`** is a complete, self-contained prompt
covering the WHOLE program (the full plan doc's vision, all 16 scorecard
standards, phases 0–7, the full wave-5-through-9 structure, the D1–D16
decision ledger, standing process rules) plus this file's current-state
summary — paste its fenced block into a fresh session to resume with full
context, not just the immediate next step. This file (§1 onward) remains the
authoritative, frequently-re-verified detail on exactly where waves 5–6
stand; the prompt file points back to it rather than duplicating it.

For a bare-minimum one-liner instead: "Resume the Notebook 10/10 program
(waves 5–6) — read `docs/notebook/wave5-6-RESUME-HERE.md` in
`C:\Users\Patrick\uct-worktrees\notebook-k` first, then continue exactly
where it says to."

⚠️ **A separate session named "UCT NOTEBOOK" exists** (visible via `ListAgents`
as a Remote Control session, offline as of 2026-09-24). If that session is the
one you reconnect to, it may carry its own conversation history for this same
program — read this file anyway before trusting recollection, since this file
is the one place both worktrees' state was actually re-verified.

## 1. Where things stand, measured 2026-09-24 19:15 CT

| Worktree | Branch | HEAD SHA | Pushed? | Working tree |
|---|---|---|---|---|
| `C:\Users\Patrick\uct-worktrees\notebook-k` | `feat/notebook-10` (wave 5) | `34f3fb6d2` (tools: the walk script; evidence `f8976a114`; gate `8f963fefa`; code tip `8370e15ad`) | ✅ `origin/feat/notebook-10` at the same SHA | clean except 6 gitignored `shard-*.log` files (never committed by convention) |
| `C:\Users\Patrick\uct-worktrees\notebook-w6` | `feat/notebook-w6` (wave 6) | moving — lanes D and E were committing at 19:00 (`158b98b06` and later); run `git log --oneline -8` there | pushed by the lanes at their checkpoints — verify with `git status -sb` | lane E had UNCOMMITTED daily-note files at 19:00 (`api/services/journal_two/note_daily.py`, `lib/dailyNote.js`, a router test, edits to `journal_two.py`/`db.py`/`notes.py`/`NoteEditorPage.jsx`) — an agent's work in flight, never yours to stash or reset |

**Wave 5 is CODE-COMPLETE, REVIEWED, GATED AND WALKED.** Its only remaining item
is an owner action: open the PR (`gh` is unauthenticated on this box).

`feat/notebook-w6` carries ALL of wave 5's code (merge `07e1a74ae`, with the
eight wave-6 node types registered at schema level 2 on both sides). It is
behind `feat/notebook-10` only by the four docs/evidence commits that followed
(`8370e15ad` rollback-doc fix, `8f963fefa` gate manifest, `f8976a114` walk
evidence, `34f3fb6d2` walk script) — merge that tail before the wave-6 PR.

Both worktrees' own `CLAUDE.md` carry a pointer section (search "Notebook
10/10 program") back to this file and to the SDD ledger.

## 2. Blockers as of 2026-09-25 03:00 CT — none on the code; #186 waits on the owner's merge, wave 6 waits on its final gate + walk

- **#187 and #183 are MERGED and LIVE** (master `d4a1a13b6` / `a3d9f5a1e`; production fast-forwarded
  to `74beea1d2`, verified by a SUCCESS record CONTAINING the sha + ancestry + fresh boot —
  `scratchpad/deploy_watch_contains.py`, never hash equality: the promotion queue can jump past a squash).
- **#186 (`feat/notebook-10`, wave 5) is OPEN, gated green on its landing tree `9ec80e965` (one NEW row =
  the recorded NC-D order-sensitive probe; manifest `145478ec1`), tags `notebook-wave5-guard-*` +
  `notebook-wave5-tip-2026-09-24` pushed, PR body READY.** The only action is the owner's
  `! gh pr merge 186 --squash`; then `deploy_watch_contains.py <squash sha>`; then merge master into
  `feat/notebook-w6` (14 squash-induced conflicts resolve as OURS — the g064 history is an ancestor;
  `NoteEditorPage.metadataSettle.test.jsx` → w6's combobox variant).
- **Wave 6 (`feat/notebook-w6`)**: every lane closed; whole-branch review + combined re-review done;
  fix round 5 (the live walk's findings) landed at `70426b0a8`. Remaining: the FINAL six-shard gate on
  that tip in the detached worktree `notebook-w6-gate` ON THE BRANCH NAME `notebook-w6-gate` (a detached
  checkout trips `rule12Paths` — two phantom NEW rows, measured), the live walk on that tip
  (`tools/notebook_wave6_walk.py`; previous run `walk-7006f1504.json` found the editor crash), the PR (opened from feat/notebook-w6 right after this checkpoint commit (gh pr list --head feat/notebook-w6)).
- **Expected NEW rows on the final gate, already classified as NOT wave 6's:** `dailyFirstPaintIncidental`
  CASE A (hour-dependent: fails identically on the wave-5 tree past midnight); anything else NEW is ours.

## 3. What's actually done (wave 5) — everything

- **Lanes A, B, C** closed and merged; `f84cb5add` was the whole-branch-review tip.
- **Whole-branch review** (`wave5-FINAL-review.md`): CHANGES REQUESTED — B1 blocker, S1, 7 notes.
- **B1 fix** (`82c56dd63`) + **S1/N1/N2 + server-side B1 rail** (`1320d0f83`).
- **B1 scoped re-review** (agent `a4c2bf62877fd8e5c`, after the account switch): B1 ADDRESSED,
  S1 ADDRESSED, N1/N2/N3/N5/N7 ADDRESSED, traced end to end on all three doors with controls;
  the Web Locks question confirmed and pinned by seven rails. `wave5-B1-fix-re-review.md`.
- **Rollback doc final** (`8370e15ad`): the rule for `82c56dd63` is "every bundle that declares
  level ≥ 1 must carry it"; Procedure B keeps all three never-revert commits
  (`8167f7aa0`, `fd87271fd`, `82c56dd63`); the earlier wrong window-story is tombstoned.
- **Six-shard gate on the FINAL tip** `8370e15ad` (`docs/notebook/gate-runs/wave5/2026-09-24T18-23-10.md`,
  commit `8f963fefa`): **VERDICT=NO_NEW_FAILURES**, 0 NEW, 1,779 test files reconcile.
- **Live re-walk on the final tip** (`docs/notebook/gate-runs/wave5/walk-8370e15ad.json`, run
  `r185200`, commit `f8976a114`): **all 19 checks PASS, 0 page errors**; both walk-found defects
  confirmed fixed on screen ("plan" opens the Plan note — controller item 8; stacked notices keep
  Undo on top at 1200/820/390). The phone joystick-corner clause was additionally MEASURED as the
  sandbox admin (hub mounted, no overlap) because a member does not get the hub at the current
  rollout stage — recorded in the ledger.
- **The walk script preserved** at `tools/notebook_wave5_walk.py` (`34f3fb6d2`) with its three
  preconditions in the header.
- **PR draft** `.superpowers/sdd/2026-09-23-notebook-10/wave5-PR-draft.md`: complete, no placeholders.

**STILL OWED: nothing on the branch.** The PR is the owner's action (§5, step 1).

## 4. Wave 6 — where lanes D, E, F stand (19:00 CT)

- **Controller wiring** `7dd7f2705` on `feat/notebook-w6`: `notebook_insights` mounted BEFORE
  `journal_two` (route order is load-bearing), `client_errors`, `notebook_link_preview`, the task
  reminder job, `installErrorBeacon`, boundary `reportError`, Ask telemetry;
  `tests/test_main_router_order.py` rails the order with non-vacuity controls.
- **Wave 5 merged into wave 6** at `07e1a74ae` (`keepRefusedWords` re-wired to
  `reconcileConflict(null, { refused: true })`; eight wave-6 node types at schema 2 both sides;
  every red classified — PositionDetailPage/TradeDetailPage are pre-existing baseline reds).
- **Lane F** (error beacon, telemetry, unlinked mentions, tasks + reminders): **CLOSED.**
- **Lane D** (13 items): all landed (`82f0a4a57`..`80adeaa7a`); task review verdicts I1–I4 + items
  7/10 captured in `wave6-D-R1-fix-brief.md`; **fix round 1 IN FLIGHT** (agent `af4f13291d6b20de3`,
  fresh implementer) — by 19:00 it had landed item 10 (`5c3b230c7`), the TOC `_prose` fix
  (`e490c4408`), I3 (`0d66df0e7`), M7 (`158b98b06`). When it reports: scoped re-review.
- **Lane E** (organization 2): **IN FLIGHT** (agent `a4047419e353d4941`, dispatched on the merged
  tip with D's lock contract — `wave6-E-dispatch-addendum.md`); item 3 member templates landed
  (`1858b3d0a`); the daily note was in progress, uncommitted, at 19:00. When it reports: task
  review; handle its split-view `NoteEditorPage` prop request.
- After D and E close: wave-6 whole-branch review (most capable model) → six-shard gate → live walk
  (base it on `tools/notebook_wave5_walk.py`; sandbox from a w6 `app/dist` build; the data dir
  `C:\data-g064-w5final` already holds a paid walk account, see §6) → PR, targeting master AFTER
  wave 5 merges.

## 5. Exact next actions, in order

1. **OWNER:** `! gh pr merge 186 --squash` (wave 5). Then the controller: deploy watch (contains-sha),
   merge master into `feat/notebook-w6` (ours on the squash-induced conflicts), push.
2. **Wave 6 final gate** on `70426b0a8`: in `notebook-w6-gate` run `git checkout -B notebook-w6-gate 70426b0a8`,
   verify the junction (`Get-Item -Force` → Junction → notebook-k's node_modules), then
   `python scripts/gate_shards.py --shards 6 --out docs/notebook/gate-runs/wave6 --max-workers 4`; read the
   manifest's NEW section (never a task's last line); classify each NEW row alone on the branch and on
   `notebook-k` as the control. Record: docs/notebook/gate-runs/wave6/2026-09-25T03-35-52.md.
3. **Wave 6 live walk** on `70426b0a8` (walk author: rebuild `app/dist`, sandbox `C:\data-w6walk` from
   PowerShell, comp the account, run `tools/notebook_wave6_walk.py`, commit the JSON by pathspec):
   every check PASS or an accepted INCONCLUSIVE (W11 reminders: no manual trigger). Record: docs/notebook/gate-runs/wave6/walk-70426b0a8.json.
4. **Scoped re-review of round 5** (small, opus) → residuals adjudicated → **PR** from `feat/notebook-w6`
   (body draft `scratchpad/wave6-pr-body-draft.md`; tag the tip before the squash; the eight schema
   level-2 entries are never-revert) → owner merges after #186 is live → deploy watch.
5. **Checkpoint docs** (this file, CLAUDE.md pointer + the shared-INDEX rule, `wave6-ownership.md`,
   OPEN-ITEMS sweep, gate manifests copied into `docs/notebook/gate-runs/wave6/`, `data-w6walk/` removed
   from the worktree) → memory topic file + MEMORY.md (pointer gate).
6. **Waves 7–9** per `wave7-briefs.md`, with the wave-6 carry-overs listed in OPEN-ITEMS (M-3, M-4, M-8,
   M-9, `guarded_media_get`, the deletion manifest, M14's client caller, the owner's M-10 statement and I3 device run).

## 6. Background processes — what dies on restart, what doesn't

- **The wave-5 hub sandbox is STOPPED** (pid 14828, `--data-dir C:\data-g064-w5final --port
  8093`, stopped gracefully via a console Ctrl+C at 18:55:32 so the launcher's `finally:` wrote
  the shutdown integrity row). ⚠️ That row lists 7 live `C:\data` files changed — by a process
  OTHER than the sandbox; the ruling with five independent reasons is in `progress.md`
  ("SANDBOX INTEGRITY, RULING"), the log is committed as recorded, and the owner is told (§9).
- **`C:\data-g064-w5final` persists and is worth REUSING for the wave-6 walk:** it holds
  `hubtest@local.dev` (admin via `ADMIN_EMAILS`, password `LocalTest2026!`) and `g064@local.dev`
  (comped Pro via `POST /api/auth/admin/comp-access`). A FRESH data dir needs both steps again —
  an unpaid walk account is redirected off every notebook route and the walk aborts INCOMPLETE.
- **Lanes D and E** are subagents of the controller session — they die with it. Their commits are
  on `feat/notebook-w6`; on resume, `git log`/`git status` in `notebook-w6` is the truth, and any
  uncommitted files there are theirs (leave them; re-dispatch the lane with a pointer to them).
- **Nothing else this program runs locally.** Unrelated Task Scheduler jobs resume on their own
  per the main `CLAUDE.md`.

## 7. Verification checklist — re-derive everything above after restart

```sh
# 1. Confirm both worktrees still exist and are on the right branch/SHA
git -C C:/Users/Patrick/uct-worktrees/notebook-k status --porcelain -uall
git -C C:/Users/Patrick/uct-worktrees/notebook-k rev-parse HEAD
git -C C:/Users/Patrick/uct-worktrees/notebook-w6 status --porcelain -uall
git -C C:/Users/Patrick/uct-worktrees/notebook-w6 rev-parse HEAD

# 2. Confirm both branches are still pushed (should match local HEAD)
git -C C:/Users/Patrick/uct-worktrees/notebook-k log --oneline origin/feat/notebook-10 -1
git -C C:/Users/Patrick/uct-worktrees/notebook-w6 log --oneline origin/feat/notebook-w6 -1

# 3. Confirm the SDD workspace (gitignored, LOCAL DISK ONLY — see §8 warning)
#    is still present and readable
ls C:/Users/Patrick/uct-worktrees/notebook-k/.superpowers/sdd/2026-09-23-notebook-10/

# 4. Check whether the weekly Opus rate limit has actually cleared —
#    the safest test is a trivial subagent dispatch, not just checking the clock.
```

## 8. ⛔⛔ CRITICAL — the SDD ledger is LOCAL DISK ONLY, not in git

**`.superpowers/` is gitignored (`notebook-k/.gitignore:46`).** This means the
following files exist **only** on this machine's local disk at
`C:\Users\Patrick\uct-worktrees\notebook-k\.superpowers\sdd\2026-09-23-notebook-10\`
and are **not recoverable from git, GitHub, or any push**:

- `progress.md` — the full SDD ledger (every lane's history, every ruling)
- `OPEN-ITEMS.md` — the single open-items tracker
- `DISCORD-QUEUE.md` — queued Discord messages, including the one written
  this session that has **not yet been sent** (Chrome extension was
  disconnected)
- `constraints.md` and every `wave5-*`/`wave6-*` brief, report, and review
  package file

**A normal PC restart does NOT touch local disk and will NOT lose these** —
this warning exists so that nobody later runs `git clean -fdx`, deletes the
`notebook-k` worktree thinking it's redundant with the pushed branch, or
otherwise treats this directory as disposable. **It is not disposable.** If
this worktree is ever removed, back up `.superpowers/sdd/2026-09-23-notebook-10/`
first.

## 9. Discord — queued, the Chrome extension was still disconnected at 19:10 CT

`DISCORD-QUEUE.md` (local-disk-only, §8) ends with a **consolidated entry (2026-09-24 ~19:10 CT)
that supersedes the five older ones** — wave 5 complete and verified, the two owner items (open
the PR; ship #183 with the batch), the box-hygiene FYI, the Enter-wait trade-off, wave-6 status.
Post that one alone when `mcp__claude-in-chrome__navigate` works again (`tabs_context_mcp`
creating a group is NOT proof the extension is connected — navigate is), and mark the older
five as superseded. Channel: `#main-to-do-list-or-must-do`, tag `<@339816805805588480>`.

## 10. Standing rules — pointers only, not restated

Full detail lives in `CLAUDE.md` at the repo root; the ones most relevant to
resuming this program:

- **At most 3 concurrent agents plus the integrator**, on this account —
  never more, even after the rate limit clears.
- **Master is production; never push to it directly.** Everything here is
  feature branches.
- **TDD + mutation-proving on every guard.** Restore bytes and verify sha256,
  never `git checkout` to undo a mutation.
- **Commit by explicit pathspec, never `git add -A`.**
- **Run tests in their own tool call, before `git commit`** — never chained
  in one shell invocation.
- **`python tools/check_repo_hygiene.py --staged` clean before every commit.**
- **The F5-frozen offline files** (`serverChange.js`, `settleNoteWrite.js`,
  `outboxDrain.js`) are "Nobody's" to edit except via a deliberately
  justified, disclosed exception — `82c56dd63`'s touch of `outboxDrain.js` is
  the most recent instance of this, already disclosed in its commit message.
- **A test run without a totals line is not a run**, and a background-task
  exit code is not a verdict — read the manifest.

## 11. Known gotchas specific to this checkpoint

- `feat/notebook-w6` carries all of wave 5's CODE but is behind by four docs/evidence commits
  (`8370e15ad..34f3fb6d2`) — merge that tail before the wave-6 PR (§5, step 4).
- The gate that covers the B1 fix is `8f963fefa` (manifest `2026-09-24T18-23-10.md`, tip
  `8370e15ad`); `9ee43bc26` (tip `f84cb5add`) is the PRE-fix evidence — do not cite it for
  `82c56dd63`/`1320d0f83`.
- **The walk instrument failed three times before the product passed once; each fault has a
  control in `progress.md`:** a fixed-sleep sampler (use waiters); an UNPAID sandbox account
  (AuthGuard → `/morning-wire`; the script now aborts on `paid_equiv` false); an editor seed with an
  EMPTY TEXT NODE (`P("")`) that ProseMirror cannot build — the content guard `4da0b1fcd` now opens
  it read-only where the pre-guard editor silently blanked it, so a fixture that passed on
  `f84cb5add` is not a control for the new tip.
- The walk's `hubOverlap` reads `null` for a MEMBER (hub not mounted at the current rollout stage);
  the phone joystick-corner clause is measured as the sandbox ADMIN
  (`scratchpad/probe_hub_overlap.py` pattern; result: no overlap, Undo clear of the pad by 0.3 px
  horizontally at 390 px — tight, noted).
- The sandbox integrity log's shutdown row is CHANGED (7 live files) and that is NOT the
  sandbox's doing — read the ruling before treating the walk as void or re-running it.
- `check_repo_hygiene.py --staged` must run from INSIDE the worktree (a `-C`-style path reported
  "0 staged"); the Bash classifier can refuse `cd <worktree> && git …` — use `git -C`.

