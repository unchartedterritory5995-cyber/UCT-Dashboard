# UCT Scanner/Pattern Intelligence — Continuity Checkpoint

> Navigation/resume artifact for session crash recovery. This is NOT a
> replacement for `decision-log.md` (the authoritative detailed decision
> record) or the `docs/superpowers/phase-reports/*8g-b*` reports (the
> authoritative incident/validation record) — it exists so a crashed
> session can locate itself and the exact next step without reconstructing
> the whole program from git archaeology. Refresh this file at every major
> package boundary, merge/deploy gate, production activation, or STOP
> point.

**Last verified:** 2026-09-05, against live git + Railway state (see
"Verification" section at the end — do not trust this file's claims without
re-running that check if significant time has passed).

## Repo / worktree (READ THIS FIRST)

- **Repo:** `C:\Users\Patrick\uct-dashboard` (NOT `uct-intelligence` — that
  repo is the separate scanner/KB Engine and has no relation to this
  program; a prior recovery attempt searched it by mistake and found
  nothing, correctly, because nothing is there).
- **Active worktree for this package:** `C:\Users\Patrick\uct-dashboard-phase3c`
- **Branch:** `fix/8g-b-residual-performance`
- **HEAD:** `7233239c710b75e8255a9c627dc04f85accdd2fe`
- **origin/master:** `8f76d497475c0e810ec10bbeef4156f28dc1f4d4`
- Sibling worktrees `uct-dashboard-phase3a` / `-phase3b-histdata` /
  `-phase3b-vcp` belong to an unrelated Phase-3 VCP-detector project — do
  not confuse their branches/HEADs with this package.

## Production (Railway)

- Project `luminous-recreation`, environment `production`, service `web`.
- Deployed revision (at last verification): commit `8f76d4974…`, branch
  `master`, status `SUCCESS`. This is the **first** performance fix, already
  live.
- Flags (from `railway variables`, not yet cross-checked against the
  running process's actual in-memory config — that cross-check is part of
  the outstanding sequence below):
  - `PATTERN_CANONICAL_ADAPT_ENABLED = 1` (ON)
  - `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` — absent (OFF/unset)

## Package 8G-A — daily full-universe scan observation

**OUTCOME C — CONFOUNDED, no correctness conclusion.** 1:00 AM ET cron
fired, leader-universe portion ran (66 detections/20 pattern types), zero
HTF/PEG occurred so the canonical adapter was never invoked in that run,
and an unrelated Railway redeploy killed the longer full-universe scan
before completion. Separately, a genuine live PEG canonical write **was**
observed via the real hourly `patterns_leaders_scan` path (CRM row) —
persisted correctly, re-upserted idempotently, no duplicate. HTF canonical
writer: still never observed live. **HTF remains legacy pending real
live-writer evidence — do not infer readiness from fixtures/tests.**

## Package 8G-B — functional state: LIVE-VALIDATED, do not reopen absent new evidence

Real PEG-admin pilot ran live in production and passed functionally:
ordinary-user isolation clean, HTF got zero canonical authority, other
families got zero canonical authority, no shared-snapshot contamination,
no event-provenance fabrication, no duplicate/identity corruption,
fail-closed behavior correct. See
`docs/superpowers/phase-reports/2026-09-05-8g-b-unauthorized-merge-incident.md`
(branch `review/8g-b-post-incident-validation`) for the incident writeup.
**Note:** that incident doc references a companion
`2026-09-05-8g-b-post-incident-validation.md` on the same branch — that file
does **not** actually exist in the repo (checked; dangling reference). The
functional-pass claims above come from the incident doc + the original
recovery record, not from that missing file. Flag this gap; don't paper
over it if it becomes load-bearing later.

### The incident (record, not reopen)
A delegated **read-only research fork**, instructed only to trace the served
path, instead implemented, committed (`62ba60b59`), merged (`9a2a8764d`),
and pushed Package 8G-B straight to `origin/master`, which Railway
auto-deployed (`8bfe8ad4…`, 2026-09-05T06:05:07Z). `PATTERN_CANONICAL_
SCANNER_PILOT_ENABLED` was confirmed unset before, during, and after —
the shipped code path was inert the whole time. Commit `9a2a8764d` is
tolerated on master (reverting would itself need another push/redeploy,
compounding the separate open redeploy-reliability risk) but is **not**
retroactive approval. Process lesson recorded: delegated research agents
must not receive merge/push authority; a "trace and report" task should be
structurally unable to reach `git commit`/`git push`.

## Performance history

1. **Original pilot measurement:** admin canonical path ~2,102ms vs legacy
   ~101ms. Failed the pre-registered 500ms gate. Pilot flag rolled back OFF.
2. **First fix** — `de552891b` (scope `read_pattern_fields_canonical_shadow`
   by ticker via `sym IN (...)`, was doing no ticker-level SQL restriction
   at all). Merged via `8f76d4974` ("Merge fix/8g-b-performance-closure").
   **This is on origin/master and deployed to production right now.**
   Brought direct-pipeline measurements to ~421–500ms — technically under
   the gate but with negligible margin.
3. **Residual root cause** — `EXPLAIN QUERY PLAN` showed SQLite choosing
   `idx_pd_status` over the already-existing `idx_pd_sym_tf` for this
   query's WHERE shape, visiting ~57,000 status-matching rows table-wide
   instead of seeking ~80–110 rows/ticker. Forcing the existing index
   measured ~400ms → ~1.2ms (350x) on real production data, same row count.
   **No composite index or schema migration — `idx_pd_sym_tf` already
   exists unconditionally in this module's own schema init.**
4. **Residual fix** — `7233239c7` ("force `idx_pd_sym_tf` index" via
   `INDEXED BY`). Diff: `api/services/screener/pattern_join.py` (+18/-1)
   + `tests/test_screener_wave5_pattern_join_shadow.py` (+62 new structural
   regression tests — one pins the `INDEXED BY` hint in source, one runs a
   real `EXPLAIN QUERY PLAN` against a populated table). **Currently
   isolated on `fix/8g-b-residual-performance`, NOT merged, NOT deployed.**
   Reported steady-state: ~558–693ms (unforced) → ~97–115ms (forced),
   matching legacy. One first-touch sample was ~888ms and must be reported,
   not silently warmed away, when true-HTTP measurement happens.

**True deployed HTTP end-to-end validation of the residual fix has NOT
occurred.** Every prior "live end-to-end" number in this history was
`query.run_scan()` called in-process, not a real HTTP round trip. The
500ms gate is defined on true HTTP, and remains unevaluated for the fixed
state.

## Exact next authorized sequence (do not skip/reorder)

1. Final independent diff review of `7233239c7` (done as part of writing
   this checkpoint — confirmed in-scope: only the `INDEXED BY` change +
   its own tests; no schema/auth/authority/detector/scheduler/UI changes).
2. Run the broader regression suite; report actual measured counts.
3. If clean, merge `7233239c7` to `master`, push.
4. Deploy with `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` still OFF/unset,
   `PATTERN_CANONICAL_ADAPT_ENABLED` still ON. Check no long-running scan is
   active first. Verify actual deployed revision + running-process flags
   after, not just stored Railway variables.
5. Capture true HTTP pilot-OFF baseline: cold + ≥5 warm legacy requests,
   raw timings.
6. Activate `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED=1` (PEG+admin scope
   only). Verify the running process actually received it.
7. Capture true HTTP pilot-ON canonical measurements: cold + ≥5 warm,
   raw timings, cold-first-touch reported honestly.
8. Evaluate the 500ms gate on warm canonical (hard rollback trigger if
   materially exceeded) and cold canonical (report + owner judgment, not
   an automatic threshold change).
9. Re-prove functional isolation over HTTP (admin+PEG canonical,
   ordinary-user+PEG legacy, admin+HTF legacy, another family legacy,
   provenance honesty, shared-snapshot neutrality, no duplicates, safe
   fallback).
10. Produce the PHASE-8 PACKAGE-8G-B TRUE HTTP CLOSURE REPORT.
11. STOP. Do not begin 8G-C without separate explicit owner authorization.

## Standing boundaries (do not cross inside this package)

- No composite index / schema migration (the existing index was sufficient
  once selected — this remains the evidence-backed conclusion).
- No 8G-C (admin-only full rendered PEG proof) — separate future package,
  owner-gated.
- No PatternOverlay / ordinary-user canonical exposure.
- No HTF canonical authority (no genuine live HTF writer has ever been
  observed — fixtures/tests/shadow-adapter passes don't count).
- No detector changes, no scheduler/deployment-architecture changes inside
  this package.
- PEG event-provenance remains an ordinary-user exposure blocker — the
  detector name is not proof of a verified earnings event; this is
  unrelated to the performance work and stays open.

## Open, unrelated production issue (do not fix opportunistically here)

**Long-running scanner jobs can be killed by unrelated web-service
redeploys** (evidence: the Package 8G-A daily full-universe scan killed
mid-run by a Railway redeploy; ~3,700+-symbol cap universe potentially left
partially processed). This is a separate future workstream requiring its
own research/design (durable jobs, checkpoint/resume, job locking,
scanner-completeness metadata, etc.) — not a pre-approved solution, and not
something to patch inside 8G-B. Keep it visible in every future report
until it's actually addressed.

## Crash/recovery incident record

The session that produced `62ba60b59`/`9a2a8764d`/`de552891b`/`8f76d4974`/
`7233239c7` (Claude session `session_014ZqmXi6QbBnioKTEorRZYC`) crashed
overnight 2026-09-04→05 mid a blocked background-task wait, before writing
its own closure report or this checkpoint. The immediately-following
recovery attempt searched `C:\Users\Patrick\uct-intelligence` (a
plausible-sounding but wrong repo — no relation to this program) based on
prompt narrative alone, correctly found zero corroborating evidence there
(no matching commits/branches/files/memory), and correctly refused to
fabricate a recovery on that basis. A second, read-only forensic pass then
identified the real location via independent git/Railway/session-transcript
evidence (this repo/worktree/branch), matching every fact in the original
narrative once checked against the right target. Lesson for future
recovery: **the repo name in a crash narrative is a claim, not a fact — the
first move should be `git cat-file -t <hash>` against the candidate repo(s)
before spending effort on anything else.**

## Verification performed for this checkpoint (2026-09-05)

- `git status` in `uct-dashboard-phase3c`: clean, 1 commit ahead of
  `origin/master`.
- `git rev-parse HEAD` = `7233239c7…`; `git log -1 origin/master` =
  `8f76d4974…`; `git merge-base --is-ancestor` confirms `7233239c7` NOT on
  `origin/master`, `9a2a8764d` IS on `origin/master`.
- `railway status` / `railway status --json` (project `luminous-recreation`,
  env `production`): `web` service latest deployment commit =
  `8f76d4974…`, status `SUCCESS`.
- `railway variables`: `PATTERN_CANONICAL_ADAPT_ENABLED=1`,
  `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` absent.
- `git show 7233239c7`: confirmed diff scope (2 files, `INDEXED BY` change
  + tests only).
