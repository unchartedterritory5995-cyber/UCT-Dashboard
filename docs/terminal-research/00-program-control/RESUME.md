# RESUME — cold-start entry point (Document B §3A)

Read in this order before doing anything: this file → `GOVERNING_PRINCIPLES.md` → `PROGRAM_STATUS.md` → `CRITICAL_PATH.md` → `OWNER_DECISIONS.md` → `AGENT_REGISTRY.md` (current wave) → the charter in `charter/` if any requirement is in doubt.

## Where we are

* **Program day:** 1 · **Phase:** Day 1b (external landscape research). Owner proceed received 2026-09-02 10:41 UTC.
* **Worktree:** `C:\Users\Patrick\uct-worktrees\terminal-research`, branch `terminal-research`, start SHA `9c3df14b9`. Never push master. Push this branch to `origin/terminal-research` at checkpoints.
* **Orchestrator:** the only committer. Commit with `git add docs/terminal-research` (scoped; never `-A`).
* **Last updated:** 2026-09-02 10:50 UTC.

## What is dispatched (see `AGENT_REGISTRY.md` §5)

* Wave 1 COMPLETE (17/17 accepted; ledger in `AGENT_REGISTRY.md` §5). Orientation memo delivered (`13-executive-synthesis/orientation-memo.md`); awaiting the owner's proceed instruction for Day 1b external research.
* In flight (10): E-02, F-03a, F-03b (re-dispatched 10:41 after a usage-limit kill) + B-VAL-01, B-BBG-01..06 (batch A, 10:50). Queued: batch B = B-BBG-07/08, B-GDL-01, B-LSEG-01, B-FDS-01, B-CIQ-01, B-KOY-01, B-TV-01, B-AS-01, B-FC-01; batch C = B-TIKR-01, B-QTR-01, B-YC-01, B-BZ-01, B-DESK-01..03, C4-01, C5-01, C7-01. Dispatch from `contracts/B-BBG.md` (section ID), `contracts/B-DOSSIER.md` (appendix ID), `contracts/B-DESK.md`, `contracts/C-WAVE1B.md`, each prefaced by `_EXTERNAL_PREAMBLE.md`. Keep ≤10 in flight.
* After the synthesis trio returns: write and dispatch F-04 (licensing register) and F-06 (first draft of the forty executive questions, due end of Day 2); run the rail; write `DAY_1_EXECUTIVE_SYNTHESIS.md` at the end of Day 1b.
* Housekeeping: an agent left an untracked scratch file `routers_inv.txt` at the worktree root; delete it once all Wave 1 tasks have returned (never while they run). Re-dispatch prompt = "Read `_SHARED_PREAMBLE.md` and `contracts/<ID>.md` in full, execute, write only to the FILE DESTINATION, return ≤150 words" plus the verbatim SOURCE HANDLING / SECRETS / DO NOT clauses.

## What is blocked

Nothing. Owner inputs batch 1 is filed (`OWNER_INPUTS_REQUESTED.md`) with defaults; D-001 proceeds provisionally.

## Where to pick up

1. If Wave 1 tasks have returned: QC each report (open the file; classify ACCEPT / ACCEPT WITH GAPS / RESEARCH AGAIN / DISCARD; log in `AGENT_REGISTRY.md` §5; feed GAPS into `RESEARCH_GAPS.md`).
2. A task that returned nothing or a partial report: re-dispatch from its contract with a KNOWN FACTS block.
3. Approval is in hand (DL-015). Continue Wave 1b top-ups until all 28 external tasks have returned; QC each (a dossier with uniform 🟢 and no URLs is DISCARDED and re-dispatched).
4. Day 1 ends when: Wave 1b landed, first pod syntheses (B-POD-BBG when all eight files exist), the Day 1 executive synthesis, owner-input batch 1 confirmed filed, rail run, checkpoint written. Then advance the program-day counter to 2.
5. Run the protection rail (`protection-rail.md`, exact commands) at every checkpoint; update `PROGRAM_STATUS.md`, this file, `CRITICAL_PATH.md`, `OWNER_DECISIONS.md`.

## Standing hazards

Vocabulary TERMINAL-CURRENT / TERMINAL-NEXT everywhere. Engine/bot/wire/scans read-only. Never the stale `uct-dashboard` checkout. Never run anything on the production pod. Port 8077 is a stale local backend. `C:\data` is real; never override conftest pins. Partner files untouched. Usage-limit pause = normal; on resume, follow this file.
