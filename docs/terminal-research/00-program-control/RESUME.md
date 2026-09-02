# RESUME — cold-start entry point (Document B §3A)

**READ `SESSION_HANDOFF.md` FIRST if it is newer than this file's last-updated line below** — it is the authoritative recovery checkpoint after the third session-limit pause and supersedes the dispatch state described here. Otherwise read in this order: this file -> `GOVERNING_PRINCIPLES.md` -> `PROGRAM_STATUS.md` -> `CRITICAL_PATH.md` -> `OWNER_DECISIONS.md` -> `AGENT_REGISTRY.md` (current wave) -> the charter in `charter/` if any requirement is in doubt.

## Where we are

* **Program day:** 1 · **Phase:** Day 1b (external landscape research). Owner proceed received 2026-09-02 10:41 UTC.
* **Worktree:** `C:\Users\Patrick\uct-worktrees\terminal-research`, branch `terminal-research`, start SHA `9c3df14b9`. Never push master. Push this branch to `origin/terminal-research` at checkpoints.
* **Orchestrator:** the only committer. Commit with `git add docs/terminal-research` (scoped; never `-A`).
* **Last updated:** 2026-09-02 (recovery checkpoint; see SESSION_HANDOFF.md for the full state -- this file's dispatch section below is now stale).

## What is dispatched (see `AGENT_REGISTRY.md` §5)

* Wave 1 COMPLETE (17/17 accepted; ledger in `AGENT_REGISTRY.md` §5). Orientation memo delivered (`13-executive-synthesis/orientation-memo.md`); awaiting the owner's proceed instruction for Day 1b external research.
* Wave 1b: ALL 28 external tasks dispatched; 23 accepted (Bloomberg 8/8, universe validator, Gödel evidence, dossiers: Unusual Whales, TradingView, Koyfin, Benzinga Pro, AlphaSense, Fiscal.ai, Quartr, FactSet, LSEG, SpotGamma, adjacent light note; desk tools 4/4; C4-01). Internal syntheses accepted: E-02, F-03a (system map, capability ledger, tech debt), F-03b (provider ledger).
* SECOND usage-limit pause ~14:30 UTC (DL-019) killed 11 tasks; re-dispatched 16:10. In flight (10): B-POD-BBG (completion), F-04 (completion), F-06, F-08, C5-01, C7-01, E-05, B-GDL-02, E-06, C6-01. Wave 2 queue (contracts on disk): B-GDL-03 (after B-GDL-02); verifiers B-<P>-03 and reconstructors B-<P>-02 for the 11 products (`contracts/B-WAVE2.md`, Sonnet); C1-01/02, C2-01/02/03, C3-01/02, C4-02/03, C5-02, C6-02/03, C7-02/03, C8-01/02 (`contracts/C-WAVE2.md`, Opus); G-01-D2 light red team after F-06/F-08 land (`contracts/G-LIGHT-D2.md`, Fable); pod syntheses B-POD-<P> after each product's -02/-03 return. Dispatch from `contracts/B-BBG.md` (section ID), `contracts/B-DOSSIER.md` (appendix ID), `contracts/B-DESK.md`, `contracts/C-WAVE1B.md`, each prefaced by `_EXTERNAL_PREAMBLE.md`. Keep ≤10 in flight.
* After the synthesis trio returns: write and dispatch F-04 (licensing register) and F-06 (first draft of the forty executive questions, due end of Day 2); run the rail; write `DAY_1_EXECUTIVE_SYNTHESIS.md` at the end of Day 1b.
* Housekeeping: an agent left an untracked scratch file `routers_inv.txt` at the worktree root; delete it once all Wave 1 tasks have returned (never while they run). Re-dispatch prompt = "Read `_SHARED_PREAMBLE.md` and `contracts/<ID>.md` in full, execute, write only to the FILE DESTINATION, return ≤150 words" plus the verbatim SOURCE HANDLING / SECRETS / DO NOT clauses.

## What is blocked

Nothing. Owner inputs batch 1 is filed (`OWNER_INPUTS_REQUESTED.md`) with defaults; D-001 proceeds provisionally.

## Where to pick up

1. If Wave 1 tasks have returned: QC each report (open the file; classify ACCEPT / ACCEPT WITH GAPS / RESEARCH AGAIN / DISCARD; log in `AGENT_REGISTRY.md` §5; feed GAPS into `RESEARCH_GAPS.md`).
2. A task that returned nothing or a partial report: re-dispatch from its contract with a KNOWN FACTS block.
3. Approval is in hand (DL-015). Continue Wave 1b top-ups until all 28 external tasks have returned; QC each (a dossier with uniform 🟢 and no URLs is DISCARDED and re-dispatched).
4. Day 1 ends when: B-POD-BBG and F-04 completed, F-06 (forty questions + Day 1 synthesis) and F-08 landed, rail run (R1), checkpoint written in PROGRAM_STATUS.md. Then advance the program-day counter to 2 and dispatch Wave 2 in batches of ≤10 (verifiers/reconstructors first for the deep products, then domain pods, then G-01-D2).
5. Pause protocol: if a 429 kills tasks, check each destination file (frontmatter + GAPS/SOURCES) — a written file is accepted after QC; a partial file gets a COMPLETION re-dispatch; a missing file gets an exact re-dispatch.
5. Run the protection rail (`protection-rail.md`, exact commands) at every checkpoint; update `PROGRAM_STATUS.md`, this file, `CRITICAL_PATH.md`, `OWNER_DECISIONS.md`.

## Standing hazards

Vocabulary TERMINAL-CURRENT / TERMINAL-NEXT everywhere. Engine/bot/wire/scans read-only. Never the stale `uct-dashboard` checkout. Never run anything on the production pod. Port 8077 is a stale local backend. `C:\data` is real; never override conftest pins. Partner files untouched. Usage-limit pause = normal; on resume, follow this file.
