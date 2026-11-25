# Deliverable 6 — Multi-agent execution plan

What exists in this Claude Code environment was verified against the official docs on 2026-11-02 (Appendix G). Nothing below assumes a feature that was not found there.

## 1. What can run here, and what cannot

| Mechanism | Status | Runs unattended? | Use it for |
|---|---|---|---|
| Interactive Claude Code sessions, one per worktree (today's pattern) | GA | no (terminal open; `claude --bg` keeps one alive) | builders, integrator |
| Subagents inside a session (20 concurrent, 3 levels, `isolation: worktree`) | GA | while the parent runs | fan-out audits, parallel verification, independent review |
| Workflow tool (scripted `agent()/parallel()/pipeline()`, 16 concurrent) | GA | no (stops when the session exits; resumable) | review-and-verify passes on a package, eval scoring, matrix checks |
| Agent teams (lead + teammates sharing a task list and messaging) | **experimental**, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; interactive only; split panes not on Windows Terminal | no | optional: one team per wave if the owner wants to try it; not required |
| Cross-session SendMessage / ListAgents | GA on native Windows ≥ 2.1.234 | n/a | integrator ↔ builders notices (already used by the program) |
| `/goal "<condition>"` | GA | while the session is open | long build runs with a stop condition |
| `/loop`, CronCreate, ScheduleWakeup | GA | only while the session is open (`claude --bg` for /loop) | integrator's periodic merge/CI checks during a working day |
| Headless `claude -p --settings … --max-budget-usd … --permission-prompts none` | GA | **yes**, via Windows Task Scheduler (the repo already runs `tools/weekly_claude_child.cmd` this way) | nightly eval, nightly integration check, report generation |
| Cloud scheduled tasks (`/schedule`) and cloud sessions (`claude --cloud`) | research preview / GA | **yes**, without this machine; fresh clone, no local files | nightly eval if the eval needs no local data; parallel builders when the machine is contended |
| Remote Control | GA | the session runs here | owner review from a phone; production smoke by the owner |

Conclusion: continuous multi-day progress is a combination of (a) interactive builder sessions during working hours, each driven by `/goal` against a persistent task file, (b) headless scheduled runs at night for evaluation, integration checks and the next day's task preparation, and (c) an integrator session. Fully unattended *development* for days is possible with `claude -p` loops but is not recommended until the eval loop and CI exist; unattended *releases* stay forbidden (UNATTENDED-DEVELOPMENT.md).

## 2. Proposed organization

```
 owner ──decision packet (2x/week)──► INTEGRATOR session (C:/UCT/agent-int worktree, agent/int)
                                        │ merges daily, runs CI, cuts weekly RC, flips admin flags, writes BOARD.md
        ┌───────────────────────────────┼───────────────────────────────┐
  BUILDER A (planner/eval)        BUILDER B (operator)           BUILDER C (data/scan)      ← Wave 1
  worktree + branch               worktree + branch              worktree + branch
  /goal on its BOARD tasks        /goal on its BOARD tasks       /goal on its BOARD tasks
  subagents: review, verify       subagents: review, verify      subagents: review, verify
                                        │
                      EVAL RUNNER (headless, nightly, Task Scheduler): real-model eval → EVAL.md
                      INTEGRATION CHECK (headless, nightly): merge-preview of open builder branches → BOARD.md notes
```

| Role | Count | Responsibilities | Not allowed |
|---|---|---|---|
| Integrator | 1 | owns `agent/int`, golden manifest, CI, RC, activation, BOARD.md; reviews each package PR with an independent-review subagent; coordinates with Indicators/News trains | writing features |
| Builder | 3 (aggressive) / 2 | one package end to end: code, tests, panel scenarios, eval prompts, docs line in BOARD.md; one PR per increment (≈ daily) | merging; touching another builder's package; editing the planner contract after freeze |
| Eval runner | headless | nightly real-model run under budget; writes scorecard; opens no PR | anything else |
| Owner | — | decision packets; production smoke; flag flips (or delegates to integrator) | — |

Compared with today (lead / md / sc / qa, four sessions, PRs reviewed by each other, QA as a separate adversarial lane with 742 lines of findings): QA becomes (1) the real-model eval that runs every night, (2) an independent review subagent the integrator spawns per package PR with the code and no conclusion, and (3) a held-out adversarial set kept by the integrator and never shown to builders. Findings become BOARD tasks, not status prose.

## 3. Persistence: the record that survives context loss

- `docs/agent/program/PROGRAM.md` — the vision, package list, owners, decisions in force (replaces README/STARTUP-PROMPTS/ROADMAP/PHASE reports; those are archived).
- `docs/agent/program/BOARD.md` — the task graph: one line per task `id | package | owner | state | depends | PR | eval evidence`. Builders update their lines in every PR. The integrator is the only one who closes.
- `docs/agent/program/EVAL.md` + `scores/*.json` — the nightly scorecard (date, model, cost, per-class results, regressions).
- `docs/agent/program/contracts/` — only the step protocol and the registry contract.
- ADRs for decisions.
- Each builder session starts from one startup prompt: "read PROGRAM.md, your BOARD lines, EVAL.md; continue; update BOARD in every PR; never merge". The harness's auto-memory and CLAUDE.md are not the record; the files are.

## 4. Coordination rules (kept from today, because they work)

- Ownership by package path, checked by `tools/agent_ownership_check.py` (fix F-9 first: use the two-dot diff).
- Suite lock for full local suites; CI does the heavy runs.
- No `npm ci` in shared worktrees; prune the worktree set to the active sessions before Wave 1.
- SendMessage for notices only; files are the record.
- UNATTENDED-DEVELOPMENT.md unchanged.

## 5. Cost controls for the program itself

- Builders and integrator run on the account's subscription; parallel sessions share one pool, so three builders is the practical ceiling on this plan (docs: start with 3–5 teammates).
- Subagent use is bounded per task: one independent review and one verification per PR; fan-out only for audits.
- Real-model spend: eval key with `--max-usd` per run (≤ $10 nightly, ≤ $75 per wave); production Agent spend under the existing $5/day cap; both reported in EVAL.md.
- Workflow runs (if used for review passes): under 10 agents per run per the session guideline.

## 6. A day in the proposed system

1. 00:30 Task Scheduler runs the eval (`claude -p` or a plain Python call to `tools/agent_live_batch.py`); EVAL.md updated; regressions become BOARD tasks tagged `regression`.
2. 01:00 Integration check: for each open builder branch, a merge preview onto `agent/int` in a scratch worktree; conflicts and failing suites noted in BOARD.md.
3. Morning: builders open their sessions, read BOARD/EVAL, `/goal "all my Wave-1 BOARD tasks are in state PR-open or done, or stop after 40 turns"`, work, open PRs.
4. Afternoon: integrator merges in dependency order, runs CI, updates BOARD, prepares the decision packet if anything needs the owner.
5. Friday: RC to master, promote, admin smoke, flags on; EVAL.md records the release baseline.
