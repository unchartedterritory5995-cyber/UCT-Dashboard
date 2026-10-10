# READINESS TEST (Document B §49 item 26) — executed on the final program day

## Procedure (fixed on Day 1a so every run is identical)

1. Dispatch a fresh agent (Fable 5.1, no prior context) whose ONLY inputs are `13-executive-synthesis/MASTER_PLAN.md` and `10-roadmap/backlog.md`. The contract forbids reading any other file or asking the orchestrator anything.
2. Ask it to produce the implementation plan for the first work package (`TERM-001`, or whatever the backlog names first): files to touch per repository, sequence, tests to write, flag and rollout steps, and acceptance-criteria verification.
3. Require it to list every DISCOVERY QUESTION it had to ask that the plan should have answered (facts it needed and could not find in the two inputs).
4. Count the questions. **Three or fewer = PASS**; answer them into the plan the same day and record the answers here. More than three = NOT READY; fix the gaps, rerun with a new fresh agent.

## Run log

| Run | Date | Inputs (commit) | Questions asked | Verdict | Answers folded into |
|---|---|---|---|---|---|
| 1 | 2026-10-10 | `MASTER_PLAN.md` at `fc7384f36` + `10-roadmap/backlog.md` | 7 | NOT READY (more than three) | Part C of `MASTER_PLAN.md`, commit `c085c3714` |
| 2 | 2026-10-10 | `MASTER_PLAN.md` at `c085c3714` + `10-roadmap/backlog.md` | 7 | NOT READY (more than three) | not yet folded in |

Both runs dispatched by lane f-l1: a fresh agent (model `fable`, no prior context), Read tool only,
on the two inputs. TERM-001 was the package in both; both agents found it already built and
planned the remainder.

**Run 1 questions** (answered into Part C by `c085c3714`): (1) which commit merged
`lane/term-001-006`; (2) TERM-001's acceptance criteria; (3) which test files cover it; (4) whether
the server check covers the terminal's own board keys; (5) who takes the production read of
`charts_layouts.db`; (6) what "its own panel curve" is; (7) whether the files are on flow-worker's
watch list.

**Run 2 questions** (open; none repeats a run 1 question): (1) the workspace-doc apply path,
since `MASTER_PLAN.md` says `/api/workspace-doc/apply` and `backlog.md` says
`/api/workspace/doc/apply`; (2) the schema of `charts_layouts.layout_json` and how a widget is
counted; (3) whether the PH-1 census tool exists to reuse; (4) whether the TERM-052 Settings
Limits card publishes the 16 now that a cap exists; (5) how the `VACUUM INTO` copy reaches the
lane; (6) whether opening a saved layout over 16 is refused; (7) which instrument measures cost
for the optional panel curve.

**Verdict: NOT READY.** Gate item 26 is not passed. The run 1 gaps closed, and run 2 went one
level deeper into TERM-001's remainder. The next step is to answer run 2's seven into the plan and
run a third fresh agent. The package under test is already `live`, so these questions are about
its leftover measurement, not about building it.
