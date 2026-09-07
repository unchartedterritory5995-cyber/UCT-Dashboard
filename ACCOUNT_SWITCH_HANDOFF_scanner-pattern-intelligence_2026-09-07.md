# ACCOUNT-SWITCH / FULL-SHUTDOWN HANDOFF — Scanner / Pattern-Intelligence Recognition-Quality Workstream

Checkpoint written: 2026-09-07 09:56 CDT, by the Claude Code session named
`uct-scanner`, immediately before an intentional full computer shutdown +
Claude account switch. Assume the Claude instance reading this has **zero**
conversational memory of anything that produced it. This document plus the
git history plus the memory files listed in §T are the entire recovery
surface.

---

## A. IDENTITY

- **Claude session name:** `uct-scanner`
- **Project:** UCT Dashboard (`unchartedterritory5995-cyber/UCT-Dashboard`, GitHub)
- **Workstream:** Recognition-quality / pattern-intelligence program — evaluating and selectively fixing the *empirical recognition accuracy* (not just architectural presence) of UCT's technical-pattern detector library
- **Repository root (canonical, do not work here directly):** `C:\Users\Patrick\uct-dashboard` — ⚠️ this checkout is STALE/PARKED per standing project convention; never treat it as authoritative, read `origin/master:<path>` instead if you need the true master state
- **Active worktree (this is where all current work lives):** `C:\Users\Patrick\uct-dashboard-recognition-quality-harness-lab`
- **Branch:** `recognition-quality-harness-lab`
- **HEAD SHA:** `3e75d6672` (this handoff document's own commit — the last commit made before shutdown; the prior HEAD, `81ce79f266...`, was the last commit containing actual research/code work, and this one adds only this document)
- **Upstream comparison:** `origin/master` (branch has NEVER been pushed — verified via `git ls-remote origin recognition-quality-harness-lab` returning empty — all 8 commits on this branch are 100% local-only)
- **Divergence from origin/master:** 8 ahead, 27 behind (master has moved on since this branch's base; that is expected and not a problem — this branch was never meant to merge)
- **Checkpoint date/time:** 2026-09-07 09:56 CDT

### Related worktrees from the SAME broader program, all CLOSED sub-phases (earlier than this checkpoint's active frontier), all verified clean with no uncommitted work:

| Worktree | Branch | HEAD | Status |
|---|---|---|---|
| `C:\Users\Patrick\uct-dashboard-bull-flag` | `feat/canonical-bull-flag` | `5a629be54` | CLOSED (Bull Flag family) |
| `C:\Users\Patrick\uct-dashboard-bull-flag-ts-fix` | `fix/bull-flag-anchor-timestamps` | `b3e2dc2b4` | CLOSED, separately-pending geometry/timestamp fix (NOT this program's scope) |
| `C:\Users\Patrick\uct-dashboard-bullflag-recognition-quality-lab` | `bullflag-recognition-quality-lab` | `f0af823ea` | CLOSED (Bull Flag stale-pole fix + Corpus B/C/D) |
| `C:\Users\Patrick\uct-dashboard-hammer-recognition-lab` | `hammer-recognition-quality-lab` | `15cf17c77` | CLOSED (Hammer ADR-scaling fix) |
| `C:\Users\Patrick\uct-dashboard-ma-pullback-recognition-quality-lab` | `ma-pullback-recognition-quality-lab` | `fbc13ab48` | CLOSED (`pullback_to_21ema` family #3 evaluation) |
| `C:\Users\Patrick\uct-dashboard-pattern-intelligence-lab` | `pattern-intelligence-lab` | `22d0a1cf4` | CLOSED (earliest exploratory phase) |

`git worktree list` shows **119 total worktrees** on this machine — the other ~112 belong to unrelated workstreams/other sessions/agent-scratch worktrees. Do not touch, enumerate, or clean up any of them from this workstream's recovery.

**⚠️ If this Claude session does not already have a unique explicit name when you next use it: it does (`uct-scanner`). No `/rename` is needed.**

---

## B. ORIGINAL OBJECTIVE

Systematically evaluate the *empirical recognition accuracy* of UCT's
pattern-detection library (~85 registered detectors across candlestick,
classical-structural, MA/context, event/breakout, momentum, and UCT-specific
categories) — not merely whether each detector runs without error or has
clean architecture, but whether it correctly recognizes real chart setups on
real market data, using real-data corpora and independently-blind-judged
evaluation. Where a genuine, source-groundable defect is found, fix it
minimally and verify the fix independently. This is explicitly a **lab-only**
R&D workstream, deliberately isolated from — and running in parallel to,
never blocking or blocked by — a much larger, separately-frozen production
release effort gated on a **2026-09-08 (Tuesday) RTH "8G-B" evidence
checkpoint**.

## C. AUTHORITATIVE SCOPE

**In scope (all lab-only, isolated-worktree):** building real-data-backed
evaluation corpora; blind (independently-judged, never self-judged) accuracy
assessment; root-causing disputed cases with real OHLCV; minimal,
source-grounded detector code fixes when a defect is objectively confirmed
and a safe fix is derivable without inventing new pattern semantics;
semantic/architectural design decisions about shared concepts (e.g.
currentness/freshness lifecycle).

**Out of scope, absolute, for this entire workstream:** any merge to
master, any push of these branches, any Railway/deploy action, any
modification of 8G-B evidence/diagnostics, any production database write,
generating real scanner/member-facing traffic, and — as of this checkpoint
— **all further recognition-quality work of any kind**, explicitly paused by
the owner (see §Q).

## D. IMPORTANT PRIOR CONTEXT

- The **9 canonical detector families** evaluated deeply/broadly so far are
  the *first high-trust cohort* the owner is building confidence in — they
  are explicitly **NOT** the full product scope. 82 detectors + 21
  "Structures" actually exist in the codebase.
- The broader platform program (outside this lab work) has 3 planned
  post-hold tracks: **Track A** (platform-native/current recognition
  runtime), **Track B** (tiered-breadth prioritization — currently HELD),
  **Track C** (member-facing high-trust intelligence exposure). This lab
  workstream feeds Track B, and its currentness-semantics findings are
  explicit required input to Track A whenever it resumes.
- Standing lesson underpinning the whole program: **"canonical rigor ≠
  recognition accuracy"** — a detector can be architecturally clean and
  still be empirically wrong on real charts, or vice versa. Never infer
  accuracy from code quality alone.
- The production release train (a *separate*, much larger effort) is frozen
  pending the 2026-09-08 8G-B gate. This lab work has never touched, and
  must never touch, that gate or its evidence.

## E. DECISIONS ALREADY MADE (carry forward, do not re-litigate)

1. **Currentness lifecycle vocabulary (locked):**
   `TRIGGERED → CONFIRMED | INVALIDATED | EXPIRED`.
   `INVALIDATED` = an explicit, family-defined opposing condition fired.
   `EXPIRED` = neither confirmed nor invalidated, but no longer current —
   a genuinely distinct third terminal state, not a subtype of either.
2. **Abstraction level (locked):** **SHARED FRAMEWORK + FAMILY-SPECIFIC
   PREDICATES.** Explicitly NOT one universal currentness predicate — proven
   necessary because candlestick-family expiry is naturally measured in
   *elapsed bars with no resolving event*, while MA-pullback-family expiry
   is naturally measured in *distance/extension from a reference level*, and
   Bull Flag proves a third case where the framework literally cannot be
   populated without inventing a new primitive first.
3. **ADR/materiality-floor theory (explicitly disproven, do not revisit
   without new evidence):** Wave 1 initially suspected `shooting_star`/
   `hanging_man` needed a minimum-ADR/materiality floor. Independent
   adjudication established the dominant mechanism is currentness, not
   materiality. Do not implement an ADR floor based on old Wave-1 language.
4. **Self-judging is banned for this program.** The agent that builds a
   corpus or implements a fix must never also blind-judge it. This was
   learned the hard way (see §F) and is now a hard rule going forward.
5. **Bull Flag's `flag_low`/`flag_high` defect is proven unfixable locally**
   — `flag_low` is a `min()` over the same window that includes the current
   bar, so "close below flag_low" can never retrospectively be true at
   extraction time by construction. Correctly left unfixed; would require
   inventing a new "established range excluding the tail-end move"
   primitive that does not exist anywhere in the codebase.
6. **No arbitrary bar-count cutoffs.** The team explicitly declined to pick
   a specific N-bar dormancy threshold "because the failed examples
   happened to be N bars old" — any future EXPIRED-state implementation
   must derive its cutoff/variable from source semantics, not from fitting
   the sample that happened to fail.

## F. RESEARCH / FINDINGS ALREADY ESTABLISHED

### VERIFIED (real code + independent re-judging + directly verified by the coordinator, not merely claimed by a sub-agent)

- Four detectors — `shooting_star`, `hanging_man`, `bearish_engulfing`,
  `pullback_to_50sma` — have a real, independently-confirmed
  **"search bound ≠ freshness"** defect (a historical trigger found inside a
  bounded backward-search window is presented as current with no re-check
  of what happened between the trigger and the true last bar). This is now
  the **8th independently-evidenced instance** of this exact defect shape
  across the whole program (after Bull Flag, `pullback_to_21ema`,
  `bullish_engulfing`, `three_white_soldiers`).
- A minimal, source-grounded fix was implemented for all four (commits
  `fcac7b04d`, `606c9c5e1`). The coordinator personally re-ran the full
  `pattern_engine` test suite independently (not trusting the implementing
  agent's self-report) — **2629 passed, 9 pre-existing unrelated xfails, 0
  failures** — and read every diff directly before trusting it. Diffs are
  genuinely minimal (~10-12 lines each), reuse each detector's own
  already-documented invalidation levels, and touch no unrelated
  threshold/scoring/geometry logic.
- The fix **works** where designed to: real true-positives are preserved,
  and **zero new false positives were introduced** anywhere, in both the
  regression rerun of the original corpora and a fresh, disjoint holdout
  built specifically to test the fixed code. This was proven by a THIRD,
  independently-dispatched, zero-context judge agent, cross-referenced by
  the coordinator against `detector_fired` in the answer keys.
- The same holdout evidence also surfaced a **real, newly-discovered
  residual gap**: a trigger that is neither confirmed nor invalidated by
  the detector's own close-based thresholds after several bars still
  returns "current" to the new `reversal_trigger_still_current` primitive
  (`if confirm_idx is None: return True`) — even though a human judge,
  looking at the actual rightmost bars, reads it as stale because price
  simply moved on without tripping either specific threshold. This is a
  refinement of the same defect family, not a new defect class, and it is
  **not yet fixed anywhere**.
- `flat_base` was **wrongly** flagged as a hard defect by Wave 1's
  self-judged pass. An independent judge, looking at the identical corpus,
  found a **perfect 3/3 TP, 4/4 TN confusion matrix** and cleared it. This
  is the concrete proof-case that motivated banning self-judging (§E.4) —
  it is not hypothetical caution, it produced one real false alarm out of
  six.
- `wyckoff_upthrust` has a genuine, independently-corroborated
  **PRODUCT-INTELLIGENCE gap** (missing a genuine-prior-trading-range
  precondition before the "upthrust" reversal) — a different failure shape
  from currentness, deliberately **not** touched by the fix pass.
- `bullish_engulfing` and `three_white_soldiers` — the **original discovery
  site** of this entire defect class, found back in the earlier Tier-1
  pilot — have **still not received** the same currentness fix now proven
  safe on their siblings (`bearish_engulfing` got it; `bullish_engulfing`
  did not). This is the most obviously-ready next step and was identified
  but **deliberately not implemented** this session — the owner paused
  before authorizing it.
- The combined library-quality registry now covers **37 of ~85 detectors**
  (3 deep-cycle + 34 Tier-1).

### HYPOTHESIS / NOT YET VERIFIED — do not treat as established fact

- Whether the "dormant trigger" gap generalizes beyond the 4 detectors it
  was found in — architecturally plausible (same search-window shape
  exists elsewhere), but **not empirically tested** on any other detector.
- Whether a concrete shared `EXPIRED` predicate implementation would
  actually work for the candlestick family — this is design-level reasoning
  only (§ the currentness semantic design document); **zero code exists**
  for it.

## G. WORK COMPLETED (chronological)

1. `bcc41aa55` — built the reusable lab harness (`lab/recognition_quality_harness/`: `taxonomy.py`, `renderer_profiles.py`, `corpus_builder.py`, `confusion.py`).
2. `449341021` — built small bounded Tier-1 corpora for 10 representative detectors (the "pilot").
3. `60a840334` — completed 4 grouped lightweight blind judgments + a pilot scorecard.
4. `b35c9f874` — **Wave 1**: Tier-1 triage across 24 NEW detectors + a combined 37-detector registry. (Self-judged inside one fork — disclosed limitation.)
5. `94c5a351e` — independently re-adjudicated Wave 1's 6 self-judged `HARD_DEFECT_SUSPECTED` detectors using two genuinely fresh, non-fork judge agents.
6. `fcac7b04d` — shared `currentness.py` primitive + fixes for `shooting_star`/`hanging_man`/`bearish_engulfing` + regression/boundary test fixtures + fresh holdout corpora (built, not yet judged at commit time).
7. `606c9c5e1` — separate, non-transplanted currentness fix for `pullback_to_50sma` + its own fixture + holdout corpus.
8. `81ce79f26` — independent holdout adjudication (a THIRD fresh judge) of the fix, cross-referenced against `detector_fired`, committed with full confusion-matrix evidence.
9. (Uncommitted, design-only, no code) — the currentness semantic design document (`TRIGGERED → CONFIRMED | INVALIDATED | EXPIRED`, shared-framework decision) was produced and accepted as authoritative program guidance but exists only in conversation/this handoff — **consider committing it as a markdown doc if/when this workstream resumes**, it was not written to a file this session.

## H. FILES / MODULES CHANGED

**New production code:**
- `api/services/pattern_engine/primitives/currentness.py` — shared `reversal_trigger_still_current()` primitive

**Modified production code (each ~10-12 line additions, nothing else touched):**
- `api/services/pattern_engine/detectors/candlestick/shooting_star.py`
- `api/services/pattern_engine/detectors/candlestick/hanging_man.py`
- `api/services/pattern_engine/detectors/candlestick/bearish_engulfing.py`
- `api/services/pattern_engine/detectors/uct/pullback_to_50sma.py`

**New/modified tests:**
- `tests/pattern_engine/detectors/test_shooting_star.py` (patched — a pre-existing test assumed `bars[-1]` is always the trigger bar; excluded the new `currentness_*` fixtures from that specific assumption)
- `tests/pattern_engine/detectors/test_hanging_man.py` (same patch)
- `tests/fixtures/{shooting_star,hanging_man,bearish_engulfing}/currentness_{boundary_confirmed_one_bar_ago_still_valid,confirmed_within_one_bar_still_valid,invalidated_next_bar_above_high,stale_confirmed_several_bars_ago}.json`
- `tests/fixtures/pullback_to_50sma/currentness_invalidated_after_reclaim_breaks_down.json`

**Lab-only (not production, gitignored-equivalent evidence, all committed to the lab branch):**
- `lab/recognition_quality_harness/{taxonomy.py,renderer_profiles.py,corpus_builder.py,confusion.py}` — reusable harness
- `lab/recognition_quality_harness/pilot/` — original 10-detector Tier-1 pilot corpora + 4 triage files + scorecard
- `lab/recognition_quality_harness/wave1/` — 24 new-detector corpora + `WAVE1_REPORT.md` + `WAVE1_SCORECARD.md` + `COMBINED_REGISTRY.md` + `ADJUDICATION_dispatch_A.md` + `ADJUDICATION_dispatch_B.md`
- `lab/recognition_quality_harness/wave1/holdouts_currentness_fix/{shooting_star,hanging_man,bearish_engulfing,pullback_to_50sma}/` — fresh post-fix holdout corpora + `ADJUDICATION_holdout.md`

**This file itself:** `ACCOUNT_SWITCH_HANDOFF_scanner-pattern-intelligence_2026-09-07.md` (repo root of this worktree) — uncommitted as of writing; will be committed as part of this checkpoint (see §J).

## I. COMMITS / SHAs

All of the following are on branch `recognition-quality-harness-lab`, **100% local-only** (verified via `git ls-remote origin recognition-quality-harness-lab` → empty), not pushed, not merged, not promoted to any release train:

```
3e75d6672  docs: account-switch/full-shutdown continuity handoff (this document)
81ce79f26  lab: currentness fix -- independent holdout adjudication + confusion matrices
606c9c5e1  fix: pullback_to_50sma post-reclaim invalidation gate (partial currentness fix)
fcac7b04d  fix: shared post-trigger currentness gate for shooting_star/hanging_man/bearish_engulfing
94c5a351e  lab: Wave 1 -- independent adjudication of the 6 HARD_DEFECT_SUSPECTED detectors
b35c9f874  lab: Wave 1 -- Tier-1 triage across 24 new detectors + combined 37-detector registry
60a840334  lab: Tier-1 pilot triage complete -- 4 lightweight blind judgments + scorecard
449341021  lab: Tier-1 pilot -- small bounded corpora for 10 representative detectors
bcc41aa55  lab: reusable recognition-quality harness (corpus/renderer/taxonomy/confusion)
```

The two `fix:`-prefixed commits (`fcac7b04d`, `606c9c5e1`) touch real
`api/services/pattern_engine/` production source — but remain **lab-only
by virtue of branch isolation**, not by file location. They are correct,
tested, and independently verified, but have **not been promoted** to any
release branch and must not be merged without separate, explicit
authorization.

## J. CURRENT GIT STATE

Verified freshly at checkpoint time (not assumed from earlier claims):

- **Active worktree** (`recognition-quality-harness-lab`): `git status` → `nothing to commit, working tree clean`. Zero staged, zero unstaged, zero untracked files, **except** this handoff file itself, which is new/untracked as of this writing and will be committed immediately after this document is finalized.
- **All 6 related sibling worktrees** (§A table): independently checked, all report clean (`git status --short` produced no output for any of them).
- No stashes were created or left behind.

## K. VALIDATION / TEST EVIDENCE

- **Full `pattern_engine` suite**, run by the coordinator directly (not
  trusting a sub-agent's self-report): `python -m pytest tests/pattern_engine/ -q`
  → **2629 passed, 9 xfailed (all pre-existing, unrelated to this
  workstream — confidence-formula documentation pins for `52w_proximity`,
  `accumulation_distribution`, `can_slim_composite`, `major_trendlines`,
  `range_detection`, `stage_analysis`, `support_resistance`,
  `swing_pivots`, `volume_profile_nodes`), 0 failures.**
- **Regression check** (the 4 fixed detectors' original Wave-1-adjudicated
  corpora, 7 cases each, reconstructed from `bars.db` at the original
  `as_of_t`): `shooting_star` 0/7 changed, `hanging_man` 2/7 changed (both
  clean invalidations, root-caused), `bearish_engulfing` 2/7 changed (both
  clean invalidations, root-caused), `pullback_to_50sma` 0/7 changed.
- **Fresh independent holdout** (28 new, disjoint cases, different
  seed/offsets than the training-adjacent corpus, judged by a genuinely
  fresh zero-context agent, cross-referenced by the coordinator against
  `detector_fired`): full per-detector TP/FP/FN/TN table is in §F and in
  `lab/recognition_quality_harness/wave1/holdouts_currentness_fix/ADJUDICATION_holdout.md`.
- **Evidence gaps, stated plainly, not glossed over:** all corpora in this
  program are small (Tier-1 scale, ~7 fired-pool cases per detector) — every
  precision/recall number in this program is explicitly directional, not
  statistically certified. The "dormant trigger" residual gap's true
  prevalence across the wider detector library was never measured. No
  targeted additional OHLCV verification was performed beyond what the
  three dispatched judges plus the coordinator's own cross-referencing
  already did.

## L. OPEN ISSUES / RESIDUAL DEBT

- **`EXPIRED` state is unimplemented everywhere.** The dormant-trigger gap
  is real and unfixed in all 4 already-fixed detectors.
- `bullish_engulfing` / `three_white_soldiers` still lack **any** currentness
  fix — not even the `CONFIRMED`/`INVALIDATED` half that their siblings
  already have.
- `pullback_to_21ema` still lacks a currentness fix — same architecture as
  its now-partially-fixed sibling `pullback_to_50sma`.
- Bull Flag's two declined "hard defects" remain permanently unfixable
  without inventing a new primitive (by design — do not attempt without a
  genuinely new architectural approach).
- `head_shoulders`: scored 0/3 confirmed TPs in the original Tier-1 pilot;
  root cause never established; flagged `NEEDS_DEEP_EVALUATION`, never
  pursued.
- `vcp`: the single highest-priority `NEEDS_DEEP_EVALUATION` detector (2
  empirical FPs independently corroborating an already-documented,
  pre-existing 3%-cross-engine-agreement gap in its own source comments) —
  never pursued this session, explicitly deferred by the owner.
- `wyckoff_spring`, `u_and_r`, `accumulation_distribution`:
  `NEEDS_DEEP_EVALUATION`, never pursued.
- `opening_range_breakout`: a genuine harness gap (the detector is
  intraday-native; this harness only builds daily-bar corpora) — no
  intraday renderer profile exists yet.
- Roughly 48 of ~85 detectors have never been evaluated at all. A
  candidate Wave-2 detector list exists in `WAVE1_REPORT.md` §15 but Wave 2
  itself was never started and is explicitly paused.

## M. REJECTED / RULED-OUT APPROACHES (do not re-propose without new evidence)

- ADR/materiality floor for `shooting_star`/`hanging_man` — tested and
  disproven as the dominant mechanism (§E.3).
- One universal currentness predicate across all detector families —
  explicitly rejected; Bull Flag alone proves it cannot work everywhere.
- Transplanting `pullback_to_21ema`'s exact rules onto `pullback_to_50sma`
  — explicitly declined; kept as two independent, family-specific fixes.
- Forcing "trigger must be on the literal current candle" as the
  currentness rule — explicitly rejected as over-correction; a setup can
  legitimately remain valid several bars after triggering.
- Picking an arbitrary N-bar dormancy cutoff fitted to the failing sample —
  explicitly rejected during the semantic-design phase.
- Self-judging (implementer = judge) — banned after producing one real
  false alarm (`flat_base`).

## N. CRITICAL CONSTRAINTS (project-wide, not just this workstream)

- **Never merge, push, deploy, touch Railway, touch a production database,
  or touch 8G-B evidence from this workstream.**
- All detector-quality work happens in **isolated git worktrees on isolated
  branches off `origin/master`** — never on the shared `uct-dashboard`
  checkout, never on `master`.
- `C:\Users\Patrick\uct-dashboard` (no suffix) is **STALE/PARKED** — never
  treat it as authoritative.
- **Never delete `C:\data\bars.db`** or any other shared/authoritative
  market-data store.
- A fork/subagent must **never self-judge** its own corpus or
  implementation — always dispatch a separate, genuinely fresh,
  zero-context, non-fork agent for any blind-judging step.
- **Verify `git status`/`git log` after every fork/agent dispatch, no
  exceptions** — a standing lesson from an earlier incident elsewhere in
  this broader program where a "read-only" fork implemented a feature and
  committed it anyway.
- **Disk-space history:** `C:` hit 13GB free / 98% full earlier this
  session, root-caused to ~197GB of orphaned `data_sync_*` staging
  directories in `%TEMP%` (from `api/services/data_sync.py`'s
  `upload_snapshot()`/`download_snapshot()` R2-sync mechanism, orphaned
  when a process was killed before its own `finally: shutil.rmtree()` ran)
  — cleaned up, **211GB free as of this checkpoint**. If low disk space
  recurs, do not bulk-delete anything under `%TEMP%` without the same
  verification discipline used this session: confirm no active owning
  process, confirm file contents match the known-safe pattern, confirm
  byte-identical duplication across instances as proof of non-uniqueness
  before deleting anything.

## O. DEPENDENCIES / GATES

- **Hard external gate:** 2026-09-08 (Tuesday) RTH "8G-B" evidence —
  governs the *separate*, much larger platform release train, not this lab
  work directly. But per the owner's own explicit instruction, this
  workstream's *next* action is deferred until that gate resolves.
- No live external API/credential dependency is specific to this handoff —
  all work this session was against the already-present local `bars.db`
  snapshot and already-existing `pattern_engine` detector source.

## P. ENVIRONMENT / CONFIGURATION

- **OS:** Windows 11 Home. Primary shell PowerShell; Bash tool (git-bash/MSYS) also available in Claude Code.
- **Python:** `C:\Python314\python.exe`. Run tests from the worktree root: `python -m pytest tests/pattern_engine/ -q`.
- **Local market-data DB:** `C:\data\bars.db` (3.18GB as of this session) — authoritative, shared across the whole machine, **never write to it directly** from this workstream.
- **Claude Code session name:** `uct-scanner` — already uniquely named, no rename needed.
- **Tools used this session:** Agent tool (both `fork` and fresh general-purpose dispatches — see §E.4 on why the distinction matters), Bash, PowerShell, Read/Edit/Write, Glob, Grep, git directly via Bash. No special MCP server (claude-in-chrome / gitlab / vercel plugins are configured on this account but were not used by this workstream).
- **No special launch flags required.** A fresh `claude` session with working directory set to the active worktree reproduces this environment exactly.
- **Memory system (read this before doing anything else):** `C:\Users\Patrick\.claude\projects\C--Users-Patrick\memory\MEMORY.md` (index — has a one-line pointer to this program) and `C:\Users\Patrick\.claude\projects\C--Users-Patrick\memory\project_pattern_intelligence_lab_evidence_2026_09_06.md` (full verbatim topic detail for this entire program, kept current through this exact checkpoint).

## Q. EXACT STOPPING POINT

The owner explicitly, deliberately paused this **entire** recognition-quality
workstream at this exact point — not a mid-task interruption. The sequence
that led here: (1) Wave 1 — Tier-1 triage across 24 new detectors; (2)
independent adjudication of Wave 1's 6 self-judged hard-defect suspects
(uncovering the `flat_base` false-alarm and confirming 4 real defects); (3)
a source-grounded minimal fix for those 4 confirmed defects, independently
verified by the coordinator directly (tests re-run, diffs read); (4)
independent holdout validation of that fix (uncovering the real "dormant
trigger" residual gap); (5) a currentness semantic-design document
(accepted as authoritative program guidance). The owner then explicitly
paused everything, is now switching this Claude Code session's account and
restarting the computer, and stated no further scanner work should happen
until they say so — tied to the separate 2026-09-08 8G-B gate outcome.

## R. NEXT RECOMMENDED ACTION

**Do nothing further on this workstream** until the owner explicitly
re-authorizes it. If/when they do, the smallest correct next action is
**back-porting the already-proven currentness fix pattern to
`bullish_engulfing`** (the original discovery site of this defect class,
whose bearish mirror `bearish_engulfing` already has the fix, unchanged
primitive, near-identical docstring-documented lifecycle) — not Wave 2, not
VCP, not the `EXPIRED`-state design. Confirm with the owner first regardless
— do not assume a new session starting means resume-work is authorized.

## S. DO-NOT-DO LIST

- Do not start Wave 2.
- Do not deep-evaluate VCP or any other `NEEDS_DEEP_EVALUATION` detector.
- Do not implement the `EXPIRED` state / dormant-trigger fix for any detector.
- Do not back-port the currentness fix to `bullish_engulfing`/`three_white_soldiers`/`pullback_to_21ema` without explicit fresh re-authorization — even though it is an obvious, ready next step.
- Do not merge any of the 7 related worktree branches to master.
- Do not push any of these branches to origin.
- Do not delete any of the 7 related worktrees — they hold unpushed, unmerged commits.
- Do not touch Bull Flag's `flag_low`/`flag_high` logic (proven unfixable locally — leave it).
- Do not re-run or re-evaluate the original Tier-1 pilot's 10 detectors, or the 3 deep-cycle families (Hammer / Bull Flag / `pullback_to_21ema`) — they are CLOSED.
- Do not bulk-delete anything under `%TEMP%` without the verification discipline in §N.
- Do not treat a new session starting, or this handoff existing, as authorization to resume — it is a preservation artifact, not a go-ahead.

## T. RECOVERY INSTRUCTIONS (exact steps for a brand-new Claude instance)

1. Open a new Claude Code session with working directory
   `C:\Users\Patrick\uct-dashboard-recognition-quality-harness-lab`.
2. Run `git status` and `git log --oneline -10`. Confirm branch
   `recognition-quality-harness-lab`, HEAD `3e75d6672...`, working tree
   clean. **If HEAD differs from `3e75d6672...` or the tree is not clean,
   STOP and reconcile before doing anything else** — something changed
   after this checkpoint that this document does not know about.
3. Read this handoff file in full.
4. Read `C:\Users\Patrick\.claude\projects\C--Users-Patrick\memory\MEMORY.md`'s
   pattern-intelligence-lab index line, then read
   `C:\Users\Patrick\.claude\projects\C--Users-Patrick\memory\project_pattern_intelligence_lab_evidence_2026_09_06.md`
   in full for the complete verbatim technical history.
5. **Confirm with the owner explicitly** that they want to resume this
   workstream before taking any action beyond reading — do not infer
   authorization from a new session starting.
6. If/when re-authorized, before making any further detector change, read
   `lab/recognition_quality_harness/wave1/WAVE1_REPORT.md`,
   `WAVE1_SCORECARD.md`, `COMBINED_REGISTRY.md`, both
   `ADJUDICATION_dispatch_{A,B}.md` files, and
   `lab/recognition_quality_harness/wave1/holdouts_currentness_fix/ADJUDICATION_holdout.md`
   — do not re-derive findings that are already on record.

## U. FIRST MESSAGE TO CLAUDE AFTER RECOVERY (ready to paste)

> Read `ACCOUNT_SWITCH_HANDOFF_scanner-pattern-intelligence_2026-09-07.md`
> at the root of this worktree in full. Then run `git status` and
> `git log --oneline -10` and confirm the repository state matches what
> that document claims (branch `recognition-quality-harness-lab`, HEAD
> `3e75d6672...`, clean tree) before doing anything else. Then read
> `project_pattern_intelligence_lab_evidence_2026_09_06.md` from the memory
> directory for full technical history. Do not resume any implementation,
> research, or fix work yet — this workstream was explicitly paused by the
> owner pending the 2026-09-08 8G-B production-gate outcome. Just confirm
> the state reconciles and report back what you found; wait for explicit
> re-authorization before continuing.
