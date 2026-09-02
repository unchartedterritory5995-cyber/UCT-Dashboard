# RESUME — cold-start entry point (Document B §3A)

Read in this order before doing anything: this file → `GOVERNING_PRINCIPLES.md` → `PROGRAM_STATUS.md` → `CRITICAL_PATH.md` → `OWNER_DECISIONS.md` → `AGENT_REGISTRY.md` (current wave) → the charter in `charter/` if any requirement is in doubt.

## Where we are

* **Program day:** 1 · **Phase:** Day 1a (orientation + internal discovery). Day 1b (external research) starts only after the owner's proceed instruction on the orientation memo.
* **Worktree:** `C:\Users\Patrick\uct-worktrees\terminal-research`, branch `terminal-research`, start SHA `9c3df14b9`. Never push master. Push this branch to `origin/terminal-research` at checkpoints.
* **Orchestrator:** the only committer. Commit with `git add docs/terminal-research` (scoped; never `-A`).
* **Last updated:** 2026-09-02 08:00 UTC.

## What is dispatched (see `AGENT_REGISTRY.md` §5)

* Wave 1 COMPLETE (17/17 accepted; ledger in `AGENT_REGISTRY.md` §5). Orientation memo delivered (`13-executive-synthesis/orientation-memo.md`); awaiting the owner's proceed instruction for Day 1b external research.
* In flight (dispatched 08:00 UTC): E-02 (Opus) → `09-security-licensing-cost/data-use-classification.md`; F-03a (Fable) → `01-existing-system/system-map.md`, `capability-ledger.md`, `tech-debt-register.md`; F-03b (Fable) → `02-data-providers/provider-ledger.md`. When they return: QC, log, then dispatch F-04 (licensing register; contract to write) and update CRITICAL_PATH.
* Housekeeping: an agent left an untracked scratch file `routers_inv.txt` at the worktree root; delete it once all Wave 1 tasks have returned (never while they run). Re-dispatch prompt = "Read `_SHARED_PREAMBLE.md` and `contracts/<ID>.md` in full, execute, write only to the FILE DESTINATION, return ≤150 words" plus the verbatim SOURCE HANDLING / SECRETS / DO NOT clauses.

## What is blocked

Nothing. Owner inputs batch 1 is filed (`OWNER_INPUTS_REQUESTED.md`) with defaults; D-001 proceeds provisionally.

## Where to pick up

1. If Wave 1 tasks have returned: QC each report (open the file; classify ACCEPT / ACCEPT WITH GAPS / RESEARCH AGAIN / DISCARD; log in `AGENT_REGISTRY.md` §5; feed GAPS into `RESEARCH_GAPS.md`).
2. A task that returned nothing or a partial report: re-dispatch from its contract with a KNOWN FACTS block.
3. The orientation memo is delivered (`13-executive-synthesis/orientation-memo.md`). Do not re-send it; wait for the owner's proceed instruction unless Wave 1 QC is pending.
4. If the owner has approved (pasted `07-approval.md` or said proceed): dispatch Wave 1b per `AGENT_REGISTRY.md` §4 (write contracts B-VAL-01, B-BBG-01..08, B-GDL-01, the 11 dossier authors, B-DESK-01..03, C4-01, C5-01, C7-01 first; E-02 is already running). Keep ≤10–17 in flight. Draft the forty executive questions by the end of Day 2 (F-06).
5. Run the protection rail (`protection-rail.md`, exact commands) at every checkpoint; update `PROGRAM_STATUS.md`, this file, `CRITICAL_PATH.md`, `OWNER_DECISIONS.md`.

## Standing hazards

Vocabulary TERMINAL-CURRENT / TERMINAL-NEXT everywhere. Engine/bot/wire/scans read-only. Never the stale `uct-dashboard` checkout. Never run anything on the production pod. Port 8077 is a stale local backend. `C:\data` is real; never override conftest pins. Partner files untouched. Usage-limit pause = normal; on resume, follow this file.
