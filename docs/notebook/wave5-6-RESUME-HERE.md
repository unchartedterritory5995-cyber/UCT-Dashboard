# RESUME — Notebook 10/10 program, waves 5–6 — checkpoint 2026-09-24

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

## 1. Where things stand, measured 2026-09-24

**Two worktrees, both branches now pushed to origin (safety backup done this session):**

| Worktree | Branch | HEAD SHA | Pushed? | Working tree |
|---|---|---|---|---|
| `C:\Users\Patrick\uct-worktrees\notebook-k` | `feat/notebook-10` | `c679090fd...` (docs: CLAUDE.md pointer) | ✅ `origin/feat/notebook-10` | clean except 6 gitignored shard logs (harmless, never committed by convention) |
| `C:\Users\Patrick\uct-worktrees\notebook-w6` | `feat/notebook-w6` | `d1f4312e3...` (docs: CLAUDE.md pointer) | ✅ `origin/feat/notebook-w6` | clean |

Both worktrees' own `CLAUDE.md` now carry a short pointer section (search
"Notebook 10/10 program") back to this file and to the SDD ledger, as
belt-and-suspenders in case this file itself isn't the first thing read.

`feat/notebook-w6` was built on top of `feat/notebook-10`'s tip as of when it
branched — **it does NOT yet include `82c56dd63`, `1320d0f83`, `a555f99bf`,
`9ee43bc26`, `de8aafd9d` or `c679090fd`** (all landed on `feat/notebook-10`
after `feat/notebook-w6` branched — B1 fix, rollback doc, gate evidence, this
resume doc, and the CLAUDE.md pointer). Merging wave-5's tail
onto wave-6 is already a known open item (see §4).

**Both branches were UNPUSHED before this session's checkpoint** — all of
waves 5 and 6 existed only on local disk until just now. That is now fixed.

## 2. THE BLOCKER — read this before dispatching anything

**Weekly Opus rate limit, hit simultaneously across three concurrent agents on
2026-09-24: `HTTP 429`, resets `2026-09-25, 6pm America/Chicago`.** This is a
weekly account-level limit, distinct from any daily session limit. It blocks
**new Opus subagent dispatch** — it did NOT block the controller session
itself, which is how the B1 fix got finished and committed without a new
dispatch (see §3).

**Until the reset time above, do not attempt to dispatch a new Opus subagent**
(the review, lane E, or anything else requiring one). If you are resuming
before that time and there is no other Opus-independent work queued, the
correct action is to wait, or to do controller-level mechanical work only
(reading, ledger updates, doc fixes, pushing branches) — not to retry
dispatch in a loop.

## 3. What's actually done (wave 5)

All five wave-5 lanes (A, B, C) are closed and merged into `feat/notebook-10`,
the schema guard is built and independently re-reviewed, and the B1
safety-critical gap the re-review found has been fixed, verified three
independent ways by the controller, and committed:

- **Lanes A, B, C**: closed, `f84cb5add` was the tip going into the whole-branch review.
- **Whole-branch review** (`wave5-FINAL-review.md`): CHANGES REQUESTED — 1
  BLOCKER (B1), 1 SHOULD-FIX (S1), 7 notes.
- **B1 fix** (`82c56dd63`): stamps `writtenSchema` on every capture that might
  be sent by a later page load (durable record, outbox entry, crash draft);
  any door forwarding a body it did not just freshly read sends
  `min(stamp, sender's own level)`, never its own level unconditionally. Fixes
  the sender-vs-writer gap: a stale tab's blanked note could previously be
  adopted and sent by a newer tab at the newer tab's own (higher) schema level.
  Includes a justified, disclosed exception touching the F5-**frozen**
  `outboxDrain.js` (minimal, additive, no control-flow change — matches the
  documented "D3 lift" precedent).
- **S1 fix + N1/N2 + server-side B1 rail** (`1320d0f83`): replaced the fragile
  per-line regex Python parser of `NOTEBOOK_TYPE_SCHEMA` with a real
  Node-subprocess import of `notebookSchema.js` (immune to layout); structural
  invariant tests replacing the hand-typed level-1 name list; pinned
  `SCHEMA_REFUSAL_DETAIL` == `notebook_schema.py`'s `REFUSAL_DETAIL`.
- **Controller verification of the B1 fix** (done directly, without an Opus
  subagent, because the fixing agent was rate-limited mid-flight): full manual
  diff review against `wave5-B1-fix-brief.md`; 68 vitest files / 1220 tests +
  17 pytest files green, zero new regressions; independent mutation
  spot-checks on the two most safety-critical guards (the `min()`-forwarding
  logic and `isSchemaRefusal`), both proven load-bearing.
- **Rollback doc** (`docs/notebook/wave5-rollback.md`, commit `a555f99bf`):
  fully updated to name all three never-revert commits (`8167f7aa0`,
  `fd87271fd`, `82c56dd63`), with an explicit, honest caveat that `82c56dd63`'s
  rollback interaction is **reasoned, not yet measured** (unlike the first two,
  which were measured in a real simulated rollback).
- **Wave-5 gate run** (commit `9ee43bc26`): six-shard gate at `f84cb5add`
  (the tip *before* the B1 fix commits) — **0 NEW failures** vs the adopted
  master baseline. This gate has **not yet been re-run on the post-B1-fix
  tip** — see §4, step 3.

**STILL OWED before wave 5 can be called fully closed:** a scoped re-review of
`82c56dd63` + `1320d0f83` against `wave5-B1-fix-brief.md`'s exact required
rails and the Web Locks trace question — blocked on the rate limit (§2).

## 4. Wave 6 — where lanes D, E, F actually stand

- **Lane F** (client error beacon, Notebook telemetry, unlinked mentions,
  tasks-across-notes + reminders): **CLOSED.** 3 fix rounds, 2 re-review
  rounds, all resolved. Tip contribution: `f6a392bbf`, `995a0327b`, etc. (see
  `progress.md` for the full commit list).
- **Lane D** (13-item brief: editor 2, in-note TOC, tag suggest, locked notes,
  @date mentions, pasted-link handling, delete-vs-trash, etc.): **IN
  PROGRESS**, tip `80adeaa7a` "ONE predicate for 'the base has no body'" —
  this looked like a clean stopping point when the rate limit hit, but has
  **not been formally closed out** (no final report, no dedicated re-review of
  lane D specifically). Confirm what's actually left on the 13-item brief
  before assuming it's done.
- **Lane E** (organization 2: archive, lock, member templates, daily note,
  relation property, timeline view, split view, tag rename, `tag=` escaping):
  **DISPATCHED** (`a408503ecbe9a872a`) then hit the rate limit before reporting
  any progress. **Confirmed nothing to recover** — `notebook-w6`'s tip is
  exactly lane D's `80adeaa7a` with a clean working tree. **Needs a fresh
  dispatch from scratch**, not a resume, once the rate limit clears.

## 5. Exact next actions, in order

**Do these only after `2026-09-25 18:00 America/Chicago` (unless marked
otherwise):**

1. **Confirm the rate limit has actually cleared** before dispatching anything
   — try a small Opus subagent dispatch first if uncertain, rather than
   assuming the clock alone settles it.
2. **Dispatch the scoped re-review** of `82c56dd63` + `1320d0f83` against
   `.superpowers/sdd/2026-09-23-notebook-10/wave5-B1-fix-brief.md`'s exact
   required rails and the Web Locks trace question. Use the same review
   package pattern as the rest of this SDD program (`scripts/review-package`
   from the `subagent-driven-development` skill, BASE = `77a19e832`, HEAD =
   current tip).
3. **Re-run the six-shard gate** on the post-B1-fix tip (currently
   `9ee43bc26`, or later if the re-review requires more fixes). The last gate
   run (`docs/notebook/gate-runs/wave5/2026-09-23T22-27-39.md`) was at
   `f84cb5add`, BEFORE the B1 fix commits — it does not cover them.
4. **Re-walk**: rebuild `app/dist` from the final tree and re-run
   `scratchpad/wave5_walk.py` against a fresh sandbox boot (see §6 for the
   sandbox process note — the one from this session, `ble7mghd3`, is almost
   certainly dead after a restart and needs re-booting).
5. **Push the branch and open the PR** for `feat/notebook-10` (already pushed
   as a branch; the PR itself was never opened — `gh` was unauthenticated
   earlier in this program, confirm current auth state).
6. **Once §5.2–5.4 are clean**, post the corrected Discord update from
   `DISCORD-QUEUE.md` (see §8) reflecting the actual go/no-go on #183.
7. **Re-dispatch lane E from scratch** (item 4 above) — organization 2 brief,
   `wave6-E-brief.md` in the SDD workspace.
8. **Confirm/close out lane D** — check whether the 13-item brief
   (`wave6-D-brief.md`) is actually complete at `80adeaa7a`, dispatch a task
   review if not already done, then close the lane.
9. **Merge wave 5's tail onto `feat/notebook-w6`** — `feat/notebook-w6` does
   not yet have `82c56dd63`/`1320d0f83`/`a555f99bf`/`9ee43bc26`. This was
   already a known open item in `OPEN-ITEMS.md` ("Before the wave-6 PR: merge
   the rest of wave 5 into feat/notebook-w6") even before this session; it is
   now more overdue since wave 5 gained four more commits.
10. **Continue with waves 7–9** per `wave7-briefs.md` once 5 and 6 are fully
    closed and merged, per the standing plan
    (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`).

## 6. Background processes — what dies on restart, what doesn't

- **The hub sandbox** (background task `ble7mghd3` from this session,
  `python scripts/hub_sandbox_boot.py --data-dir C:\data-g064 --port 8093`,
  serving the wave-5 final walk) **will NOT survive a PC restart** — it is an
  ordinary foreground-launched background process, not a scheduled service.
  If a fresh browser walk is needed (§5, step 4), re-boot it fresh:
  `python scripts/hub_sandbox_boot.py --data-dir C:\data-g064-fresh --port 8093`
  (use a **fresh** data dir name — `C:\data-g064` may hold state from the
  earlier run; check before reusing it). Read
  `docs/plans/joystick/sandbox-runs/` after boot for the integrity-log
  confirmation that nothing leaked to `C:\data`.
- **Nothing else this program runs locally.** No Task Scheduler jobs, no
  other daemons. Any Windows Task Scheduler jobs unrelated to this program
  (Morning Wire, breadth collector, etc.) resume on their own per the main
  `CLAUDE.md`.

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

## 9. Discord — one message queued, not yet sent

`DISCORD-QUEUE.md` (local-disk-only, see §8) has a queued update as of
2026-09-24 explaining that the #183-hold fix is done and self-verified, with
one more independent review still owed once the rate limit clears. It has
**not** been posted — the Chrome extension was disconnected the last time this
was checked. **Check the extension connection and post the queue when you
resume**, rather than re-summarizing from scratch — the queued text is already
accurate as of this checkpoint.

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

- `feat/notebook-w6` is **behind** `feat/notebook-10`'s tip by four commits
  (see §1, §4 item 9) — don't assume the two branches share a common current
  state without checking.
- The wave-5 gate run committed in this checkpoint (`9ee43bc26`) is at
  `f84cb5add`, **before** the B1 fix — it is evidence for the PRE-B1-fix
  state, not a verification of the current tip. Don't cite it as covering
  `82c56dd63`/`1320d0f83`.
- Lane D's stopping point (`80adeaa7a`) was reached because of the rate limit,
  not because the lane reported itself done — treat it as a checkpoint, not a
  close-out, until verified against `wave6-D-brief.md`.
