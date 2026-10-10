# READINESS TEST (Document B §49 item 26) — executed on the final program day

## Procedure (fixed on Day 1a so every run is identical)

1. Dispatch a fresh agent (Fable 5.1, no prior context) whose ONLY inputs are `13-executive-synthesis/MASTER_PLAN.md` and `10-roadmap/backlog.md`. The contract forbids reading any other file or asking the orchestrator anything.
2. Ask it to produce the implementation plan for the first work package (`TERM-001`, or whatever the backlog names first): files to touch per repository, sequence, tests to write, flag and rollout steps, and acceptance-criteria verification.
3. Require it to list every DISCOVERY QUESTION it had to ask that the plan should have answered (facts it needed and could not find in the two inputs).
4. Count the questions. **Three or fewer = PASS**; answer them into the plan the same day and record the answers here. More than three = NOT READY; fix the gaps, rerun with a new fresh agent.

## Run log

| Run | Date | Inputs (commit) | Questions asked | Verdict | Answers folded into |
|---|---|---|---|---|---|
| 1 | 2026-10-10 | `MASTER_PLAN.md` at `5a905e30e` + `10-roadmap/backlog.md` | 7 | NOT READY (more than three) | Part C of `MASTER_PLAN.md`, commit `92c440478` |
| 2 | 2026-10-10 | `MASTER_PLAN.md` at `92c440478` + `10-roadmap/backlog.md` | 7 | NOT READY (more than three) | Part C, commit `906c11039` |
| 3 | 2026-10-10 | `MASTER_PLAN.md` at `906c11039` + `10-roadmap/backlog.md` | 7 | NOT READY (more than three) | Part C, commit `4fcaafc60` |
| 4 | 2026-10-10 | `MASTER_PLAN.md` at `4fcaafc60` + `10-roadmap/backlog.md` | 5 | NOT READY (more than three) | Part C, commit `2e8cbe5f1` |
| 5 | 2026-10-10 | `MASTER_PLAN.md` at `2e8cbe5f1` + `10-roadmap/backlog.md` | 5 | NOT READY (more than three) | Part C, commit `2c7f8a520` |
| 6 | 2026-10-10 | `MASTER_PLAN.md` at `2c7f8a520` + `10-roadmap/backlog.md` | 3 | **PASS** (three or fewer) | Part C, this commit |

Runs 1-4 dispatched by lane f-l1, runs 5-6 by lane f-x05: each a fresh agent (model `fable`, no
prior context), Read tool only, on the two inputs. TERM-001 was the package every time; every agent
found it already built and planned the remainder.

**Run 1 questions** (answered into Part C by `92c440478`): (1) which commit merged
`lane/term-001-006`; (2) TERM-001's acceptance criteria; (3) which test files cover it; (4) whether
the server check covers the terminal's own board keys; (5) who takes the production read of
`charts_layouts.db`; (6) what "its own panel curve" is; (7) whether the files are on flow-worker's
watch list.

**Run 2 questions** (answered into Part C by `906c11039`; none repeats a run 1 question): (1) the workspace-doc apply path,
since `MASTER_PLAN.md` says `/api/workspace-doc/apply` and `backlog.md` says
`/api/workspace/doc/apply`; (2) the schema of `charts_layouts.layout_json` and how a widget is
counted; (3) whether the PH-1 census tool exists to reuse; (4) whether the TERM-052 Settings
Limits card publishes the 16 now that a cap exists; (5) how the `VACUUM INTO` copy reaches the
lane; (6) whether opening a saved layout over 16 is refused; (7) which instrument measures cost
for the optional panel curve.

**Run 2 route fix.** The real route is `POST /api/workspace/doc/apply` (router prefix
`/api/workspace/doc`, `api/routers/workspace_doc.py:37`); `MASTER_PLAN.md` and the TERM-001
register cell in `10-roadmap/backlog.md` said `/api/workspace-doc/apply` and were corrected in
`906c11039`.

**Run 3 questions** (answered into Part C by `4fcaafc60`): (1) the refusal sentences verbatim;
(2) which store the census covers; (3) which test cases already exist, by name; (4)
`widget_count`'s contract; (5) other row kinds in `charts_layouts`; (6) whether every write door
to `charts_workspace_layout` is guarded; (7) where the dated test baseline lives. Answering (6)
found a real gap: `POST /api/workspace/doc/restore` writes the board through `_write_back` without
`enforce_board_bound` (`api/routers/workspace_doc.py:71-84`). It is now part of TERM-001's
remaining work in Part C.

**Run 4 questions** (answered into Part C by `2e8cbe5f1`, from the code; the restore-door gap itself
was fixed on master by `97876df0f`): (1) `enforce_board_bound`'s calling contract (arguments; raise or
return); (2) the restore response's `prefs_failed` shape and whether `_write_back` continues past
a failed key; (3) whether `api/routers/workspace_doc.py` is on flow-worker's watch list; (4)
whether a flag-less server guard needs the pre-authored tier-4 rollback branch before shipping;
(5) whether the client restore UI renders `prefs_failed`. All five are about the restore-door
fix that run 3's answer added, not about the shipped bound.

**Run 5 questions** (answered into Part C by `2c7f8a520`): (1) whether the census script reaches
the pod with a deploy or by hand; (2) whether `charts_layouts` holds deleted rows to exclude; (3) the
vitest worker cap; (4) who uses the 2026-10-14 window and whether the panel curve may share it; (5)
the panel-curve run parameters. All five were about the census and the optional panel curve, the
remainder after the restore door closed.

**Run 6 questions** (answered into Part C the same day, this commit): (1) the server-side name of
the bound value (`board_bound.MAX_BOARD_WIDGETS`, `api/services/board_bound.py:50`); (2) how a test
builds a `charts_layouts` fixture from the service's own schema (`_DB_PATH` patched, then
`_init_db()`, `api/services/charts_layout_service.py:81-87`); (3) what census result could re-open
the bound (none in code: 16 rests on cost, and only an owner sentence overrides it,
`12-decisions/2026-10-02-term-001-006-board-bound-and-freshness.md:3-4`).

**Verdict: PASS.** Gate item 26 passed on run 6 with three discovery questions against a bar of
three (runs 1-6: 7, 7, 7, 5, 5, 3). The three were answered into Part C of `MASTER_PLAN.md` the same
day, as step 4 requires. The questions narrowed with each run: from facts about the shipped bound,
to the restore door, to the census, to test seams. X-05 is `live` in the completion ledger on the
strength of this record.
