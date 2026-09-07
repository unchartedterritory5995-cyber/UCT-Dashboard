# ACCOUNT-SWITCH / FULL-SHUTDOWN HANDOFF — indicator-ecosystem / OOS-1

Freeze checkpoint written 2026-09-07 09:58:38 CDT. Written for a brand-new Claude
instance with ZERO memory of the prior conversation. Read this whole file before
doing anything else in this worktree.

## A. IDENTITY

- **Session name:** `indicator-ecosystem` (session ref `[e31baa]`, just renamed via `/rename` immediately before this checkpoint)
- **Project:** UCT Dashboard — "Universal Custom Indicator + Screener Ecosystem" validation program (a long-running, strictly bounded, evidence-driven program to validate/harden the Pine Script → internal-AST translator; owner authorizes narrow batches, assistant executes + reports precisely + stops for review)
- **Workstream:** (1) SILENT_WRONG_RESULT forensic + fix for a Pine for-loop/reassignment bug (RISK-043) — **COMPLETE**. (2) Frontier/corpus-count reconciliation — **COMPLETE**. (3) Two capability-classification re-checks (`ta.valuewhen`, `ta.cci`) — **COMPLETE**. (4) PHASE OOS-1: construct a frozen, blind, 60-script out-of-sample real-world Pine compatibility evaluation corpus — **IN PROGRESS, NOT FROZEN, MID-FLIGHT AT CHECKPOINT TIME**.
- **Repository:** `unchartedterritory5995-cyber/UCT-Dashboard` (GitHub)
- **Worktree:** `C:\Users\Patrick\uct-dashboard\.claude\worktrees\indicator-ecosystem` — this is a git **worktree**, NOT the main checkout (`C:\Users\Patrick\uct-dashboard` is stale/parked per this repo's own CLAUDE.md; do not confuse the two)
- **Branch:** `worktree-indicator-ecosystem`
- **HEAD:** `8bd571b723b7e77e35191940daa2171e2372e76a` — matches `origin/worktree-indicator-ecosystem` exactly (0 ahead, 0 behind)
- **Checkpoint time:** 2026-09-07 09:58:38 CDT (see file mtimes under `tests/fixtures/pine_oos_staging/` for finer-grained timing of the in-flight work)

## B. ORIGINAL OBJECTIVE

This session's concrete objective, in order:
1. Trace and fix a real SILENT_WRONG_RESULT-class bug in the Pine translator (a for-loop-mutated scalar read through an intermediate binding was silently folding to its pre-loop value instead of refusing).
2. Reconcile the resulting corpus pass/fail accounting precisely (no double-counting, name every script).
3. Re-verify two specific capability classifications (`ta.valuewhen`, `ta.cci`) against actual current code, not memory.
4. Build **PHASE OOS-1**: a frozen, 60-script, genuinely out-of-sample (never seen by this project before) real-world Pine compatibility evaluation corpus, sourced completely blind to UCT's known capabilities — so a FUTURE phase (OOS-2, NOT yet authorized) can measure "when a real user brings UCT a script we never optimized against, how often does it work, get assisted, or get honestly refused?" without the corpus itself being contaminated by knowledge of what UCT can/can't do.

## C. AUTHORITATIVE SCOPE

**In scope, this session:** items 1-4 above (RISK-043 fix; reconciliation; classification re-checks; OOS-1 **sourcing and freezing only**).

**Explicitly OUT of scope / NOT authorized, this session or the next:**
- Any product/translator code change during OOS-1 sourcing.
- Running ANY OOS-1 candidate script through UCT's Pine translator, PineBox, BuilderSheet, screener, canonical AST, or JS/Python kernels — that is Phase **OOS-2**, a separate future phase requiring separate authorization.
- Implementing `ta.valuewhen`, arbitrary-source `ta.cci`, `ta.supertrend`, `ta.tr(true)`, bare `ta.obv`/`ta.accdist` LEVEL, generalized loop-carried-state execution, or any pattern-engine work.
- Beginning OOS-2 evaluation under any circumstances without explicit fresh authorization.

## D. IMPORTANT PRIOR CONTEXT

- This session continued an even earlier session's work (RISK-041/042: vendor-parity batches + an evidence-reconciliation tranche) — already committed/pushed/accepted in prior commits `32046d04c`, `31d5a19a2`, `74c45362f`. Not touched this session; background only.
- Established program discipline: **SILENT WRONG RESULT is ranked as a MORE SEVERE failure class than CORRECT REFUSAL.** This governs remediation priority throughout.
- Canonical evidence documents for this whole program: `docs/superpowers/specs/universal-indicator-ecosystem/RISK_REGISTER.md` (one row per numbered finding, RISK-001 through RISK-043 as of this checkpoint) and `RISK_004_BLIND_CORPUS_DECOMPOSITION_REPORT.md` (detailed narrative). Both were updated this session (see H).
- Three existing Pine corpora already live in this repo, used for leakage-checking OOS-1 against:
  - `tests/fixtures/pine_blind/` — 48 scripts, "blind-authored" by 8 independent authors per trading lens, but now internally referred to as "development-influenced" since 2+ years of engineering has targeted it directly.
  - `tests/fixtures/pine_community/` — 30 real public TradingView scripts. An older doc phrase "the 8-script public compatibility corpus" is **not a separate directory** — it refers to a named subset of files within this same 30-script directory (checked in an earlier RISK-037 checkpoint).
  - Various pattern-detector fixture directories (unrelated to Pine translation, do not confuse).

## E. DECISIONS ALREADY MADE (carry these forward, do not re-litigate)

1. **RISK-043 fix approach:** Outcome B (correct refusal), explicitly NOT Outcome A (new execution capability). At the exact point the top-level Pine statement-walker gives up on a `for`/`while`/`switch` block it cannot fold (pine.js's `BLOCK_KEYWORDS.has(word)` branch, ~L7685), it now immediately forces every name that block mutates opaque, reusing the SAME `forceOpaque('pine:reassign', ...)` mechanism the "closing pass" safety net already used — just moved earlier, so it actually protects any ordinary binding created after it in program order. No new execution semantics were added.
2. **`ta.valuewhen`** is classified **EXECUTION CAPABILITY GAP / CORRECT REFUSAL UNDER CURRENT EXECUTION MODEL**, not a translator/naming gap. Verified by direct re-read of pine.js's own ruling (~L1215-1246): Pine's real function counts *occurrences* (unbounded backward search); this table's `valuewhen` takes a bounded *window*; mapping them would silently produce a wrong number on most bars. TradingView's own docs are cited as the authority in the refusal message itself.
3. **Arbitrary-source `ta.cci`** requires a genuine kernel/runtime expansion, NOT a translator role-order fix — **re-confirmed**, cross-kernel: `computeCCI` (`app/src/components/chart/indicators.js:445-460`) and `compute_cci_raw` (`api/services/indicator_compute.py:407-430`) BOTH hardcode `typical = (h+l+c)/3` with no `source` parameter at all in either signature. Do not implement.
4. **OOS-1 blind-sourcing design:** 3 fresh (non-fork) subagents, split by TradingView engagement tier (high / mid / long-tail, ~20 each toward 60 total), each given a fully self-contained neutral rubric with ZERO UCT-capability information and an explicit instruction not to read anything in this repo except their own staging output path. The orchestrating session (this one) is already contaminated with full RISK-004 capability knowledge and therefore does NOT do any of the actual script selection itself.
5. **Predeclared deterministic excess-trim method** (declared BEFORE seeing final candidate counts, per the user's explicit "orchestrator must not exercise discretion" addendum): within any over-quota cell (tier × complexity bucket, or an author with >2 candidates), sort candidates by **ascending SHA-256 of normalized source text**, keep the first N needed. This is a cryptographic hash of the script's own text — uniformly distributed, uncorrelated with Pine constructs/difficulty/UCT compatibility, and fully reproducible by anyone re-running the hash.
6. **Predeclared complexity thresholds** (LOC = non-comment line count): SHORT ≤ 40, MEDIUM 41-90, LONG > 90. If the achieved distribution skews heavily (it did — see L), DOCUMENT it rather than revise the thresholds after seeing data (revising post-hoc would risk correlating with UCT-compatibility odds, since longer scripts statistically hit more unsupported constructs).
7. **Predeclared near-duplicate detection:** normalized-source (comments stripped, whitespace collapsed, lowercased) similarity ratio via Python `difflib.SequenceMatcher` ≥ 0.85 = near-duplicate. Tiebreak: keep earlier `retrieved_at` metadata timestamp, then lower SHA-256.
8. **Predeclared copyright/storage rule:** full source text may be committed to this git repo ONLY if the script's recorded license is an open/redistribution-contemplating term (Mozilla Public License 2.0, MIT, Apache-2.0, CC0/public-domain). Otherwise (license "not stated," ambiguous, or restrictive) the full source must be stored LOCALLY ONLY, never git-committed — only metadata + hash + provenance + source URL gets committed. **This rule has NOT yet been applied to anything** — nothing in `pine_oos_staging/` has been committed.
9. Target: exactly 60 frozen scripts for OOS-1, sourced entirely from real, externally-authored, open-source TradingView Community Scripts.

## F. RESEARCH / FINDINGS ALREADY ESTABLISHED

### Verified (direct code reading or direct code execution — not recalled/assumed)

- **RISK-043 root cause**, precisely: `exprBinding` (pine.js ~L6916) is `{kind:'expr', node, env, at}` where `env` is `new Map(env)` — a SNAPSHOT of the environment captured at the moment an ordinary top-level binding (e.g. `screen = ...`) is walked. The Resolver (pine.js ~L4052-53) later reads a name through such a binding by swapping `this.env = bound.env` — resolving against the FROZEN snapshot, never the live env. The top-level walker's for/while/switch handling never corrected `env` for the block's mutated names; only a "closing pass" safety net did, and it runs once, after the entire program has already been walked — too late for any binding made earlier in program order.
- **Fix verified** via a permanent 18-test regression suite (`app/src/components/chart/engine/ast/pine.forLoopReassignSilentWrongResult.test.js`), all passing: 9 minimal repro variants (A-I) + 2 controls + non-vacuity checks + real-fixture checks.
- **4 total real-world occurrences** of this exact bug found and fixed by the one change (confirmed via `git stash` isolation of the fix, re-running each against the unmodified code to prove they were silently passing before):
  - `volume-dollar-volume-money-flow.pine` (originally discovered; its own status is unchanged in headline terms since it hits an earlier, unrelated `ta.cmf` blocker first in source order, but a direct probe with `ta.cmf`/`ta.accdist` bypassed confirmed the loop now correctly refuses underneath).
  - `volume-pocket-pivot-up-volume.pine` (frozen 48-corpus) — was silently PASSING, now correctly refuses `pine:reassign`.
  - `meanrev-consecutive-down-closes-exhaustion.pine` (frozen 48-corpus) — same.
  - `17-pocket-pivot-breakout.pine` (30-script community corpus) — same, moved from a TRANSLATES roster to a RULED (permanent correct-refusal) entry.
- **Frozen 48-corpus counts, live-measured (re-derive via `cd app && npx vitest run src/components/chart/engine/ast/pine.blindCorpus.test.js` — do not trust a stale number from this doc):** RAW 27/48 pass, 21/48 fail; ASSISTED 36/48 pass, 12/48 fail. Full per-script primary/secondary-blocker table was produced in conversation (not written to a durable file — see L item 6 if this needs to be made permanent).
- **Community corpus (30 scripts):** 18 translate, 12 refuse/ruled (was 19/11 before RISK-043).
- **`ta.valuewhen`/`ta.cci` classifications** — see E items 2-3.
- **OOS-1 sourcing agent #1 (high-engagement tier) — CRITICAL BUG FOUND AND (believed) fixed:** its entire first-pass output (21 scripts) measured **0.0% indentation preserved** — every line of every file flush to column 0. Pine Script is indentation-significant for `if`/`for`/`while`/`switch` block bodies, so this completely destroyed the semantics of all 21 captures (verified by direct inspection — e.g. `06-pivot-points-high-low-mtf-lonesometheblue.pine` line 42's `if not na(pivothigh)` was followed by unconditionally-flush-left `line.new(...)` calls that were originally its indented body). Root cause: TradingView's page-text/accessibility-tree extraction strips leading whitespace. Verified fix (already proven working by sourcing agent #2): clipboard-copy-based capture instead of page-text extraction, cross-checked against TradingView's own displayed line count. Agent #1 was resumed with this fix, plus told to replace 4 of its 21 picks that turned out to be exact-hash duplicates of scripts already in `pine_community` (`squeeze-momentum-lazybear`, `cm-williams-vix-fix`, `pivot-points-high-low-mtf`, `zigzag-plus-plus`).
- **OOS-1 sourcing agents #2 (mid) and #3 (long-tail):** captures independently verified structurally sound via two mechanical checks (`_tools/oos_indent_check.py` — per-block-opener body-indent check; `_tools/oos_flatten_check.py` — whole-file %-lines-indented check). No corruption found in either tier's original output. Both resumed for supplemental candidates (needed more after dedup/leakage/near-dup removal fell short of the 20/tier target).
- One cross-tier exact-duplicate pair found and resolved: `mid_engagement/02-vix-term-structure.pine` vs `long_tail/08-vix-term-structure.pine` (same author "IvanLabrie", same title, byte-identical after normalization) — the mid-tier copy was dropped per the predeclared tiebreak (long_tail's `retrieved_at` was earlier).

### NOT yet verified / must re-check before trusting

- Whether the RESUMED agents' NEW output (high-engagement's full replacement set; mid/long-tail's supplemental scripts) is ALSO free of the indentation-stripping bug. **Nothing new has been validated since the fix was requested.** Re-run `_tools/oos_flatten_check.py` and `_tools/oos_indent_check.py` against everything currently on disk before trusting any of it, especially the high-engagement tier.
- Whether all 3 resumed agents actually completed, partially completed, or were killed mid-write by the shutdown (see L).

## G. WORK COMPLETED

1. **RISK-043**: pine.js fix (17 lines) + 18-test permanent regression suite (new file) + 6 downstream test-file corrections (ratchet floors, RULED-roster entries, roster tables) across `pine.blindCorpus.test.js`, `pine.blindCorpusDecomposition.test.js`, `pine.community.test.js`, `pine.community.guards.test.js`, `doorScorecard.test.js`, `constructCoverage.test.js` + PVT-residual wording softened ("PROVEN" → "consistent with / bounded by") in `RISK_004_BLIND_CORPUS_DECOMPOSITION_REPORT.md` and `RISK_REGISTER.md`'s RISK-042 row + a new RISK-043 row added to `RISK_REGISTER.md`. **Committed as `8bd571b72`, pushed. User explicitly ACCEPTED this commit** (verbatim: "RISK-043 status is accepted as: ROOT-CAUSED + FALSE-SUCCESS PATH ELIMINATED + CORRECTLY REFUSED UNDER CURRENT EXECUTION MODEL").
2. **Frontier reconciliation**: exact 12 ASSISTED-fail / 21 RAW-fail rosters with full per-script primary/secondary blocker classification, blast-radius assessment, and classification (CORRECT REFUSAL / EXECUTION CAPABILITY GAP / TRANSLATOR GAP / INVALID SOURCE / etc.) — delivered as a chat response only, not written to a file. User explicitly accepted the numeric reconciliation (27/21 RAW, 36/12 ASSISTED, community 18/12).
3. **Two classification re-checks** (`ta.valuewhen`, `ta.cci`) delivered as a chat response, code-verified (see F). **Not yet explicitly re-acknowledged by the user** — their next message launched straight into the OOS-1 addendum. Low risk (solidly code-verified) but technically an unclosed loop.
4. **OOS-1 Phase 1 (blind corpus sourcing)**: 3 subagents dispatched, ran once to completion (21+20+14=55 raw candidates), mechanically analyzed (dedup/near-dup/leakage/license/complexity via `_tools/oos_analyze.py`), found the high-engagement indentation-corruption bug via `_tools/oos_indent_check.py` + `_tools/oos_flatten_check.py`, all 3 resumed with fixes/supplemental requests. **All 3 resumed dispatches were STILL RUNNING (status: `running`, started ~10-11 min prior) when this shutdown request arrived — NOT waited for, per the explicit freeze instruction.** The corpus is NOT deduplicated in its final form, NOT trimmed to 60, NOT hashed into a manifest, NOT license-routed for storage, NOT frozen.

## H. FILES / MODULES CHANGED

**Committed (in `8bd571b72`):**
- `app/src/components/chart/engine/ast/pine.js`
- `app/src/components/chart/engine/ast/pine.forLoopReassignSilentWrongResult.test.js` (new)
- `app/src/components/chart/engine/ast/pine.blindCorpus.test.js`
- `app/src/components/chart/engine/ast/pine.blindCorpusDecomposition.test.js`
- `app/src/components/chart/engine/ast/pine.community.test.js`
- `app/src/components/chart/engine/ast/pine.community.guards.test.js`
- `app/src/components/chart/engine/ast/doorScorecard.test.js`
- `app/src/components/chart/engine/ast/constructCoverage.test.js`
- `docs/superpowers/specs/universal-indicator-ecosystem/RISK_004_BLIND_CORPUS_DECOMPOSITION_REPORT.md`
- `docs/superpowers/specs/universal-indicator-ecosystem/RISK_REGISTER.md`

**Untracked, NOT committed (do not commit `pine_oos_staging/*.pine` or `*.json` content without first applying the license-routing rule in E.8):**
- `tests/fixtures/pine_oos_staging/{high_engagement,mid_engagement,long_tail}/*.pine` + matching `*.json` metadata sidecars
- `tests/fixtures/pine_oos_staging/{high_engagement,mid_engagement,long_tail}/_tier_report.json`
- `tests/fixtures/pine_oos_staging/_analysis.json` — output of the mechanical dedup/leakage/license/complexity pass, as of the LAST time it was run (before the agents' resume work landed — rerun it for current truth)
- `tests/fixtures/pine_oos_staging/_tools/{oos_analyze.py,oos_indent_check.py,oos_flatten_check.py}` — the exact deterministic analysis scripts. **Re-run these, do not reconstruct the methodology from memory or from this doc's prose summary.** Each has a hardcoded `ROOT` path near the top pointing at this worktree — update it if the worktree moved.
- **This handoff file itself.**

**This handoff will be committed** (see below) since it's new, deliberate, durable content — not a "manufactured WIP commit to look clean."

## I. COMMITS / SHAs

- **`8bd571b72`** (HEAD) — RISK-043 fix. **Pushed, matches origin exactly. User-accepted.**
- Prior, unrelated to this session's own work, for background only: `74c45362f`, `31d5a19a2`, `32046d04c` (RISK-041/042 tranches, already accepted in an earlier session).
- This handoff document's own commit SHA: see the git log after this file is committed (immediately following this write).

## J. CURRENT GIT STATE

```
On branch worktree-indicator-ecosystem
Your branch is up to date with 'origin/worktree-indicator-ecosystem'.

Untracked files:
  tests/fixtures/pine_oos_staging/

nothing added to commit but untracked files present
```

Staged: none. Unstaged (tracked-file modifications): none. Untracked: exactly one directory (contents listed in H). This is the ONLY non-clean element in the entire worktree as of the freeze.

## K. VALIDATION / TEST EVIDENCE

- **RISK-043:** full `app/src/components/chart/engine/ast/` suite GREEN at commit time: **115/115 files, 2,174/2,174 tests.** Two unrelated failures found OUTSIDE that directory (`reachable.test.js` on a pre-existing, unrelated community/floor2 orphan-module finding — last touched 2026-09-03, four days before this session; `BuilderSheet.pine.test.jsx`/`ImportBox.thinkscript.test.jsx` whitespace-diff flakes) — both confirmed PRE-EXISTING via `git log`/`git stash` isolation of this session's own fix, correctly NOT fixed (out of scope).
- **Frontier reconciliation:** RAW/ASSISTED counts re-derived by ACTUALLY RUNNING the test suite and a custom probe script — not recalled or estimated.
- **OOS-1:** mechanical validation only. Hash-based exact/near dedup + leakage detection (`_tools/oos_analyze.py`) and two independent indentation-fidelity checks (`_tools/oos_indent_check.py`, `_tools/oos_flatten_check.py`) have been run against the ORIGINAL (pre-resume) 55-candidate pool. **Zero UCT-capability testing has been run against any OOS-1 candidate — correctly, since that's forbidden until OOS-2.**
- **Evidence gap:** none of the resumed agents' NEW output has been re-validated. This is the single most important pending step before trusting anything new on disk.

## L. OPEN ISSUES / RESIDUAL DEBT

1. **OOS-1 corpus is NOT frozen and NOT at 60.** Last known-good count (before resume output is folded in): high_engagement effectively 0 trustworthy (all 21 originals corrupted), mid_engagement 19 valid (after 1 near-dup drop), long_tail 14 valid → ~33 valid, need 60. The 3 resumed agents were asked to close this gap; unknown how far they got.
2. **3 background sourcing agents were mid-flight at freeze time** (`a31f7384203fbcbdc`, `aa6a219bc964a1924`, `af11c6ef3fc1513a2`, all status `running` per `ListAgents` at freeze time, started ~10-11 min prior). **These are in-process subagents tied to THIS session's process and will almost certainly be killed by the restart/account-switch — assume their state is unrecoverable.** Whatever they had already written to disk (see freeze-time snapshot below) is all that survives.
3. **Freeze-time snapshot of `tests/fixtures/pine_oos_staging/*/`.pine counts** (2026-09-07 09:58:38 CDT, moving target, agents actively writing): `high_engagement` 21 `.pine` files, `mid_engagement` 21 `.pine` files, `long_tail` 14 `.pine` files. **Do not trust these numbers as final — re-count from disk on resume.** In particular the high-engagement count of 21 is suspicious (agent was asked to replace 4 + fix 17 = still 21, so this MIGHT be the corrected set, or might be stale pre-fix files not yet overwritten — the flattening check MUST be re-run before trusting any of them).
4. **The high-engagement tier needs full re-validation** once resume output is confirmed final — do not trust ANY `.pine` file there without re-running `_tools/oos_flatten_check.py` first. The entire tier was 100% corrupted before the fix was requested.
5. **Final trim-to-60** (predeclared SHA-256-sort method, E.5), **manifest construction, SHA-256 freeze-ID computation, and copyright-based storage routing** (E.8) have NOT been performed — the corpus is not close to frozen.
6. **The two classification re-checks were delivered but not explicitly re-acknowledged** by the user before the shutdown request arrived (low risk — solidly code-verified — but an open loop).
7. **The remaining-frontier table (12 ASSISTED-fail scripts, full detail) was delivered only in conversation, never written to a durable file.** If the user wants it as a permanent record (matching this program's established pattern of writing everything into `RISK_004_BLIND_CORPUS_DECOMPOSITION_REPORT.md`/`RISK_REGISTER.md`), that write is still pending.

## M. REJECTED / RULED-OUT APPROACHES (do not re-attempt without new instruction)

- **Outcome A** (implementing genuine loop-carried-state execution) for RISK-043 — explicitly not authorized; Outcome B (correct refusal) was implemented instead.
- **Re-balancing the OOS-1 complexity distribution** after seeing it skew heavily toward "long" scripts (measured: high_engagement 10/6/5 short/medium/long; mid_engagement 2/2/16; long_tail 1/3/10, against predeclared ≤40/41-90/>90 thresholds) — explicitly NOT done. Predeclared thresholds must not be revised after seeing data; document the achieved distribution instead.
- **Doing OOS-1 web reconnaissance/sourcing from the orchestrating session itself** — explicitly avoided, since the orchestrator is contaminated with full RISK-004 capability knowledge. All actual sourcing was delegated to fresh, non-fork subagents with a self-contained neutral rubric.
- **Committing `pine_oos_staging/` to git before the copyright/license-routing step** — explicitly deferred per the user's own addendum.
- **Waiting for the 3 background agents to finish before checkpointing** — explicitly rejected per the user's own Phase 1 freeze instruction ("Do NOT... start another phase"); the freeze was taken as-is, mid-flight.

## N. CRITICAL CONSTRAINTS

- Do NOT run any OOS-1 candidate (staged or final) through UCT's Pine translator/PineBox/BuilderSheet/screener/AST/JS-or-Python kernels until OOS-2 is separately, explicitly authorized.
- Do NOT exercise ANY discretion based on Pine constructs, likely UCT support, implementation difficulty, known blocker families, or "would this help/hurt the future score" when trimming the OOS-1 pool to 60 — ONLY the predeclared deterministic/integrity operations in E.5-E.8.
- Do NOT implement `ta.valuewhen`, arbitrary-source `ta.cci`, `ta.supertrend`, `ta.tr(true)`, bare `ta.obv`/`ta.accdist` LEVEL, generalized loop execution, or pattern-engine work.
- Do NOT begin OOS-2 evaluation under any circumstance without fresh, explicit authorization.
- **SILENT WRONG RESULT ranks strictly more severe than CORRECT REFUSAL** — this governs remediation priority throughout this whole program, not just this session.
- A corpus "floor"/"ratchet" assertion in the test suite may only ever be lowered with an explicit, evidence-cited, in-code comment explaining it as a correctness correction — never silently, never to make a red test green without justification.

## O. DEPENDENCIES / GATES

- No external workstream gates this — self-contained inside one git worktree.
- OOS-1 sourcing depends on live internet access to TradingView via WebSearch/WebFetch/Claude-in-Chrome browser tools. If the resumed session lacks browser tool access, OOS-1 sourcing cannot continue as designed and would need re-scoping with the user.

## P. ENVIRONMENT / CONFIGURATION

- Platform: Windows. PowerShell is the primary shell tool; a Bash tool (Git Bash / POSIX) is also available and was used throughout this session — prefer whichever matches the command style needed.
- Worktree: `C:\Users\Patrick\uct-dashboard\.claude\worktrees\indicator-ecosystem`, branch `worktree-indicator-ecosystem`. The MAIN checkout at `C:\Users\Patrick\uct-dashboard` is stale/parked per this repo's own `CLAUDE.md` — do not work there.
- JS/vitest: `cd app && npx vitest run <path>`.
- Python: use the bare `python` command in Git Bash, NOT `python3` (that alias is broken in this environment — redirects to a Microsoft Store install stub).
- **Browser automation tools (`mcp__claude-in-chrome__*`) are DEFERRED** — must be loaded via `ToolSearch` before first use in a new session: `ToolSearch("select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__find")`.
- **`SendMessage` tool is also deferred** — only useful for reaching the (almost certainly dead) background agent IDs listed in L.2; do not expect this to work after an account switch, but it costs nothing to try `ListAgents` first.
- No special env vars, credentials, or external services required for OOS-1 sourcing beyond normal internet/browser access.
- No `.env` secrets or credentials are involved in any part of this workstream.

## Q. EXACT STOPPING POINT

RISK-043 is fully complete, committed (`8bd571b72`), pushed, and user-accepted. Frontier reconciliation and the two classification re-checks are complete and delivered in-conversation (not all explicitly re-acknowledged). PHASE OOS-1 (corpus sourcing) is mid-flight: 3 subagents ran once to completion, a critical capture-fidelity bug was found in one tier and fixed via resume, all 3 were resumed a second time for fixes/supplementation, and **all 3 resumed dispatches were still `running` (per `ListAgents`) when this shutdown request arrived.** Nothing from their resume work has been validated, deduplicated, trimmed, hashed, or frozen.

## R. NEXT RECOMMENDED ACTION (smallest correct step)

1. Read this entire handoff file.
2. Verify current git state matches this document (`git status`, `git log -1 --format="%H %s"`).
3. `python tests/fixtures/pine_oos_staging/_tools/oos_flatten_check.py` and `python tests/fixtures/pine_oos_staging/_tools/oos_analyze.py` (fix the hardcoded `ROOT` path at the top of each if the worktree path changed) — get a FRESH, current picture of what's actually on disk. Do not trust any count in this document beyond its stated freeze-time snapshot.
4. Try `ListAgents` to see if the 3 subagent IDs in L.2 are still reachable (unlikely after an account switch, but free to check).
5. Report findings to the user and ask how they want to proceed (resume OOS-1 sourcing with fresh subagent dispatches using the rubric captured in section E, or something else) — **do not resume OOS-1 sourcing unprompted.**

## S. DO-NOT-DO LIST

- Do not run any `pine_oos_staging` script through the UCT translator or any UCT product surface.
- Do not commit `pine_oos_staging/` content to git without first applying the per-item license-based storage-routing rule (E.8).
- Do not trust any high-engagement-tier `.pine` file without re-running the flattening check first.
- Do not re-balance OOS-1 complexity buckets after the fact.
- Do not exercise semantic/capability-based discretion anywhere in the OOS-1 trim-to-60 step.
- Do not assume the 3 background agents completed, or that any count in this document is still accurate — re-measure from disk.
- Do not delete `tests/fixtures/pine_oos_staging/` — it contains real, hard-won research work, some of it not reproducible without re-running the whole sourcing process.
- Do not implement any of the explicitly-parked capabilities (N).
- Do not begin OOS-2 evaluation.

## T. RECOVERY INSTRUCTIONS

1. Open a new Claude Code session.
2. `cd C:\Users\Patrick\uct-dashboard\.claude\worktrees\indicator-ecosystem` — verify the worktree still exists at this path (`git worktree list` from the main checkout if not, or check the secondary handoff copy for this path as a reference).
3. Read this file in full: `docs/superpowers/specs/universal-indicator-ecosystem/ACCOUNT_SWITCH_HANDOFF_INDICATOR_ECOSYSTEM_OOS1_2026-09-07.md`.
4. Run `git log -1` and `git status` — confirm HEAD is `8bd571b72` (or later, if something changed) and that `pine_oos_staging/` is still the only untracked item (or note what else changed).
5. Load browser tools if OOS-1 work is to continue (see P for the exact `ToolSearch` call).
6. Re-run the analysis tools in `pine_oos_staging/_tools/` for current ground truth before making any decisions.
7. Report status to the user and await instructions before taking any further action.

## U. FIRST MESSAGE TO CLAUDE AFTER RECOVERY (ready to paste)

> Read `docs/superpowers/specs/universal-indicator-ecosystem/ACCOUNT_SWITCH_HANDOFF_INDICATOR_ECOSYSTEM_OOS1_2026-09-07.md` in full before doing anything else — you have no memory of the prior conversation. Verify current git/worktree state matches the document, re-run the analysis tools under `tests/fixtures/pine_oos_staging/_tools/` to get current ground truth on the OOS-1 corpus, and report back what you found before taking any action. Do not resume OOS-1 sourcing, touch any Pine translator code, or run any staged script through UCT until I explicitly say so.
