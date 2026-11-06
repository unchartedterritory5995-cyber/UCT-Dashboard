PINE PARITY: DESKTOP RESUME PROMPT (2026-11-05, written by the desktop coordinator before a session restart)

You are resuming the Pine parity programme on the DESKTOP machine (Windows 11, Git Bash), acting as the desktop merge coordinator, with full autonomy. Communicate fully. The owner's standing direction is "get it all done asap / keep progressing".

0. READ FIRST, in order
- `git fetch origin`, then read origin/ops/pine-desktop:DESKTOP-STATUS.md (the tail entries are newest). Also read origin/ops/pine-desktop:reviews/RESUME-2026-11-05.md and reviews/NEXT-STAGE.md.
- Local copies live under C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/ (DESKTOP-STATUS.md, reviews/*.md, BUILDER-BRIEF-COMMON.md, reviews/REVIEW-BRIEF.md).
- Programme docs on master: docs/pine/parity-programme/{PLAN.md,WAVE-TASKS.md,AGENT-RULES.md,BUILDER-RULES.md,DESKTOP-PROMPT.md}, docs/pine/W4-BREAKDOWN.md and docs/pine/SERVER-RUNTIME-DESIGN.md.
- Design docs on their own branches: docs/pine-w6-breakdown (W6-BREAKDOWN.md @1889bbedd7), docs/pine-w9-strategy-design (W9-STRATEGY-DESIGN.md @59bf931484), docs/pine-w3w4-next-breakdown (W3W4-NEXT-BREAKDOWN.md @fe4f84b78c) and docs/pine-coverage-2026-11-05 (COVERAGE-MAP-2026-11-05.md @de4371e1e9).

1. WHAT IS LIVE
- origin/production includes:
  - the landing train (PR #857, be5fd05ea2): 41 lanes, W4/W3/W2/E/W5/editor E2;
  - the screener-pin fix (PR #862, 6fe0577df8);
  - W6-T3a type descriptor (PR #867, c855e8cadf).
  SCRIPT_ENGINE_VERSION = 18. The next engine number, assigned in merge order, is 19.
- On master, deploy to be verified: PR #869 (3ca4b0d358), carrying W9-T0 census, W9-T3 capture tooling and W9-T14a + T2 (one 5,000-bar window constant in api/services/bars_window.py, and a pin ledger with a lock rail). It needs no engine change. Check that master-deploy-gate run 42130538630 passed and that 3ca4b0d358 is an ancestor of origin/production.
- The runtime lane is UNARMED. Stage 1 (admins, adx-and-di-for-v4 only) is READY: the arming rails and the adx re-grade are all green on master. Arming is the OWNER's act: PINE_RUNTIME_STAGE=admins on Railway web. It is the biggest single unblock (about 22 sole-blocked scripts once widened past stage 1).
- The W5-T20 pine-runtime Railway service does NOT exist. The OWNER creates it per docs/runbooks/pine-runtime-service.md section 3.
- Coverage on engine 17 (W0 re-measure): 218/679 transfer at the production door; 268 runtime-on; 47 transfer+MATCH; 6/70 strategies.
  - Re-measure on engine 18: 212 and 260. This is NOT a regression: door verdicts are unchanged, and W9-T0's census honesty reclassified 8 strategy false-transfers (reviews/W34-T0.md).
- Top sole-blocker walls: drawing-objects (now decomposed by W34-T0), imperative 39, strategy 35, request.security 17, imports 12.

2. IN FLIGHT. Each branch's EVIDENCE.md top line holds its exact next step.

| lane | branch @ tip | state | next |
|---|---|---|---|
| W6-T3b expr/return-type inference | feat/pine-w6-t3b-expr-type @1eb962e278 (code e105a1f9a3) | built | measure-pair (runs/w6t3b/mp-all.log), then FULL final-tip, ready-check, independent review |
| W34-T0 census honesty | feat/pine-w34-t0-census @519b13aac0 | review INCOMPLETE (reviews/W34-T0.md) | the reviewer intends NO-GO because EVIDENCE's "0 zero-attempt" claim is false. Finish the review, then a fix round. Drawing-objects sole 55 -> 3, the rest re-named |
| W34-D1 drawing per-call-site history | feat/pine-w34-d1-drawing-history @defa05f551 | built | final-tip #2 ran while HEAD moved, so re-run a CLEAN full final-tip, then ready-check and review. Engine bump: yes (at landing) |
| W34-D2 drawing-door naming | feat/pine-w34-d2-drawing-lower @5ea5f9ed17 (code 08a454f739) | built, mutations done | the detached runs/w34-d2/pipeline.sh (pipeline.log) runs measure-pair, final-tip and ready-check; update EVIDENCE, then review. No bump. Premise corrected: the drawing build DOES lower, and the door now names the real refusal |
| W34-D3 undeclared names | feat/pine-w34-d3-undeclared @47f1b23278 | finishing | ta.correlation MUST reuse the existing implementation and its TradingView evidence (no hand-written Pearson as proof). Then measure-pair, final-tip, review. Bump if any script moves |

3. NEXT, after those
- Review each lane. Land it when GO via a small PR to master, assigning engine numbers in merge order. Follow the bump procedure in C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/train/ENGINE.md + FIXES.md:
  - the version line;
  - hostParity digests via `node tools/pine_runtime_host_parity.mjs --host node --write` on Node 24;
  - service_smoke.json re-recorded against a LOCAL service only.
- Builds:
  - W6 T5 (arrays), T2, T1 from master. Remove order-block-detector-luxalgo from T6's attach list (W6 review note).
  - W9-T1: port the S1 broker (after W4-T10/T13/T15, which are on master now).
  - W34 I-tasks (I1 = W4-T5, I2 = W4-T6, I3, I4) where no capture is needed.
- Follow-ups F1-F18 are listed in reviews/NEXT-STAGE.md and the status file. Also fix the W9 design doc's DEEP_BARS sentence on docs/pine-w9-strategy-design: R13 keeps DEEP_BARS separate as the all-time-high lookback.
- Rulings in force:
  - R10: one history rule, 5,000 bars.
  - R11: the scans lane owns the sweep cap.
  - R12/R13: W9 decisions; DEEP_BARS separate.
  - Grading: the 5-trade floor applies to TradingView's count only. Zero-trade or refused = UNGRADABLE. A pin-ledger landing is an engine bump.

4. HOW TO WORK
- Bash prefix: `export H=C:/Users/Patrick/uct-worktrees/pine-handoff-dsk-ops; source $H/docs/pine/parity-programme/scripts/env-desktop.sh`. Tooling: ops/pine-tooling-speed @bde80e19f3 (final-tip, ready-check.sh, measure-pair, lane_env, lock_run, retire-worktree.sh).
- Node: `source C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/node20.sh` before any vitest run (pinned 20.20.2; it refuses otherwise).
- Heavy jobs:
  - `source C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/ram-gate.sh; ram_gate` (needs 6 GB free) before taking a lock;
  - locks: dsk/heavy-{mut,mp2,mp3,final2,final3}.lock;
  - one heavy job per lock. Memory is tight: Claude Code reaped background watchers when it ran low.
- ready-check baselines:
  - vitest: pollingSites, settingsScope, enumerationSites, vendorHarness, controlDoorCensus (red on master since PR #832, not Pine);
  - pytest: the test_vendor_batch_capture manifest;
  - the coverageAudit delta-rsi test is a 1000 ms wall-clock flake: re-run it alone, never widen it.
- Builders follow dsk/BUILDER-BRIEF-COMMON.md. Reviewers follow reviews/REVIEW-BRIEF.md and write reviews/<LANE>.md with first line `VERDICT: GO|GO-WITH-NOTES|NO-GO @tip`. Fix rounds get delta re-reviews.
- Status: update DESKTOP-STATUS.md (encode to a temp file, then os.replace) and push with `bash $S/status-push.sh ops/pine-desktop "<msg>" DESKTOP-STATUS.md=$F reviews/<n>.md=<path>`.
- Deploy freeze: weekdays 15:30-16:15 ET and Wed 09:00-11:00 ET. promote-production skips during those windows, so never force it.
- The gh token lacks the `workflow` scope. A PR that touches .github/ must be merged in the GitHub web UI, and only with the owner's go.

5. HARD LIMITS (owner standing rules)
- Never: Railway changes or variables, flags, arming, captures, the capture rig, sign-ins or credentials.
- Never use the owner's Chrome unless the owner asks in chat for that action.
- No Discord posts unless the owner asks.
- Never touch other projects' worktrees or processes; never kill a process you did not start.
- Never --no-verify and never force-push. No SCRIPT_ENGINE_VERSION edits by builders.
- Licence-held script text is never committed.
- Merging to master and production deploys need the owner's explicit approval in the session.
- Report outcomes faithfully.

6. WAITING ON THE OWNER
- Arm stage 1 (PINE_RUNTIME_STAGE=admins).
- Create the pine-runtime service (runbook section 3).
- Schedule rig capture sessions: the queue is ready, including 47 W9 rule captures.
- Optionally delete the empty leftover dir C:/Users/Patrick/uct-worktrees/pine-dsk-land18.
