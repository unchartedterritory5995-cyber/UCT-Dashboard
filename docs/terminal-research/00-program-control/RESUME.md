# RESUME — cold-start entry point (Document B §3A)

Read in this order before doing anything: this file → `GOVERNING_PRINCIPLES.md` → `PROGRAM_STATUS.md` → `CRITICAL_PATH.md` → `OWNER_DECISIONS.md` → `AGENT_REGISTRY.md` (current wave) → the charter in `charter/` if any requirement is in doubt.

## Where we are

* **Program day:** 1 · **Phase:** Day 1a (orientation + internal discovery). Day 1b (external research) starts only after the owner's proceed instruction on the orientation memo.
* **Worktree:** `C:\Users\Patrick\uct-worktrees\terminal-research`, branch `terminal-research`, start SHA `9c3df14b9`. Never push master. Push this branch to `origin/terminal-research` at checkpoints.
* **Orchestrator:** the only committer. Commit with `git add docs/terminal-research` (scoped; never `-A`).
* **Last updated:** 2026-09-02 06:10 UTC.

## What is dispatched (see `AGENT_REGISTRY.md` §5)

* Wave 1 batch 1 running: D-01..D-10 (Opus). Contracts: `contracts/D-0x.md` + `contracts/_SHARED_PREAMBLE.md`.
* Wave 1 batch 2 queued: D-11, D-12, D-13, D-14, E-01, E-03, E-04. Dispatch each as a batch-1 task returns (≤10 in flight). Dispatch prompt = "Read `_SHARED_PREAMBLE.md` and `contracts/<ID>.md` in full, execute, write only to the FILE DESTINATION, return ≤150 words" plus the verbatim SOURCE HANDLING / SECRETS / DO NOT clauses.

## What is blocked

Nothing. Owner inputs batch 1 is filed (`OWNER_INPUTS_REQUESTED.md`) with defaults; D-001 proceeds provisionally.

## Where to pick up

1. If Wave 1 tasks have returned: QC each report (open the file; classify ACCEPT / ACCEPT WITH GAPS / RESEARCH AGAIN / DISCARD; log in `AGENT_REGISTRY.md` §5; feed GAPS into `RESEARCH_GAPS.md`).
2. Keep ≤10 tasks in flight; dispatch batch 2.
3. If the orientation memo (`13-executive-synthesis/orientation-memo.md`) is not yet delivered: write it (Part CLXXIX, nine sections) and stop the turn.
4. If the owner has approved (pasted `07-approval.md` or said proceed): dispatch Wave 1b per `AGENT_REGISTRY.md` §4 (write contracts B-*, C4-01, C5-01, C7-01, E-02 first), then start F-03a/F-03b as Wave 1 files land. Draft the forty executive questions by the end of Day 2.
5. Run the protection rail (`protection-rail.md`, exact commands) at every checkpoint; update `PROGRAM_STATUS.md`, this file, `CRITICAL_PATH.md`, `OWNER_DECISIONS.md`.

## Standing hazards

Vocabulary TERMINAL-CURRENT / TERMINAL-NEXT everywhere. Engine/bot/wire/scans read-only. Never the stale `uct-dashboard` checkout. Never run anything on the production pod. Port 8077 is a stale local backend. `C:\data` is real; never override conftest pins. Partner files untouched. Usage-limit pause = normal; on resume, follow this file.
