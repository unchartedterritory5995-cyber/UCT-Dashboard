# Progress — Universal Custom Indicator + Screener Ecosystem

**Read `00-MASTER-PROMPT.md` first** for the objective, then `DECISIONS.md` for what's already settled.
This file tracks live status only — it will go stale; trust it less than the two files above, and less
than the repo itself.

**Current phase:** Phase Two — Standing Validation + Vendor Parity + Limited Human QA (authorized
2026-09-05 by external owner/ChatGPT review of `CHATGPT_REVIEW_PACKET_02.md`; see DEC-013 and
`PHASE_TWO_PLAN.md`). Phase One (below, and `PHASE_ONE_PLAN.md`) is accepted, closed, and preserved
as history — read `PHASE_TWO_PLAN.md` first for what's active now. Explicitly NOT a feature-expansion
phase; see `PHASE_TWO_PLAN.md` §9 for the no-go list.
**Workspace:** worktree `C:\Users\Patrick\uct-dashboard\.claude\worktrees\indicator-ecosystem`, branch
`worktree-indicator-ecosystem`, based on `origin/master` @ `12cf5c8d3` (2026-09-04). Created via the
harness's native `EnterWorktree` tool — do not also `git worktree add` a second one for this program;
enter this one.
**Do not commit to:** the main `uct-dashboard` checkout (stale `feat/catalyst-coverage-precision` with
active third-party WIP — see `CLAUDE.md`/`2026-07-31-phase-a-signature-launch.md` Global Constraints).
**Do not touch (owner-flagged, someone else's active work):** `api/live_massive_router.py`,
`api/schwab_router.py`, `api/massive_ws_worker.py`, `api/massive_processor.py`,
`app/src/pages/OptionsFlow.jsx`, `api/liveflow_router.py`.
**Unconfirmed:** whether another session is currently active on `feat/indicator-endzone` (its worktree
was touched 2026-09-04 08:17, hours before this session started). Treat as possibly live until the
owner confirms otherwise — read freely, do not write there.

**2026-09-05 (session recovery + maximum-autonomy operating model, `GOVERNING_INTENT.md`/DEC-011):**
recovered clean after a prior session's unexpected close (stale worktree lock, since removed via
`git worktree unlock`); branch backed up to `origin/worktree-indicator-ecosystem`. Track D (RISK-003)
resolved to **VERIFIED HEALTHY** via a third probe pass run from the main repo checkout — see
`RISK_REGISTER.md`. Built and tested three pieces of durable tooling so the two remaining external gates
resolve with minimal owner involvement: `tools/track_a_ingest_vendor_capture.py` (ingests an owner's real
TradingView capture per `OWNER_VENDOR_CAPTURE_PACKET_V3_1.md`, cross-validates repeated probe rows +
control arithmetic, classifies each of the four ambiguous builtins against its two candidates, and writes
`tests/fixtures/vendor/observations/*.json`), `tools/track_d_risk003_probe.py` (packages the RISK-003
probe for repeatable future spot-checks), `tools/track_e_run_golden_journey.py` (pre-flight-gates on
`ANTHROPIC_API_KEY`/`INDICATOR_VISION_ENABLED` and runs `tests/test_golden_journey_04_05_live.py` the
instant both exist, with full output captured to a log file). All three have their own test files; no
regressions in adjacent suites (`test_vendor_truth.py`, `test_golden_journey_04_05_live.py` unchanged at
1 passed/6 skipped without a key).

**2026-09-05 (same session, maximum-autonomy execution) — Track A Tranche 1A capture complete, real
evidence held for the first time in this program's history.** Owner corrected the operating model:
an external account being involved does not mean the owner must manually operate it — Claude Code should
attempt full autonomous completion first via already-available capabilities, escalating only at a genuine
authentication boundary. Acting on this: found the owner's TradingView account already authenticated in
this machine's Chrome profile (via `mcp__claude-in-chrome__*` browser automation) and completed the entire
`OWNER_VENDOR_CAPTURE_PACKET_V3_1.md` capture autonomously — opened Pine Editor, pasted the script (fixed
one Monaco auto-indent transcription artifact that broke Pine's line-continuation parsing), added to
chart, worked around the Basic plan's 2-indicator cap (temporarily removed 2 pre-existing indicators,
restored via a discarded/reloaded unsaved session rather than trusting undo alone), and read two agreeing
`phase==24` occurrences via Table View (CSV export was Premium-gated). Real findings for all four Tranche
1A functions are now in `RISK_REGISTER.md` RISK-018a. Owner's account/chart left unmodified — verified via
a fresh reload discarding all unsaved session changes. Also checked (without exposing values) whether an
approved scoped dev/test Anthropic credential already exists anywhere accessible for Track E — it does
not; only the single shared production key (used by live member-facing features) was found in local
`.env` files and the Railway `web` service, and DEC-008 explicitly forbids reusing that. Track E remains
genuinely blocked on the owner creating a dedicated credential — see the ANTHROPIC CREDENTIAL CREATION
REQUIRED note in-session.

**2026-09-05 (same session, later) — adversarial evidence audit, then Track A raw-artifact upgrade.**
The owner ordered a full adversarial re-verification of the above (`PROJECT_EVIDENCE_ASSUMPTION_AUDIT_01.md`),
which correctly downgraded the Track A block above from "capture complete" to "SEMANTIC RULINGS CAPTURED,
RAW VENDOR ARTIFACT INCOMPLETE" — the two `phase==24` rows agreed with each other, but rested on a Table-view
transcription (`get_page_text`), not an independently-inspectable file, and needed a loosened 5e-3 tolerance
because Table view rounds to 2 decimals. Six bounded corrections were then applied (false 28/48 benchmark
figure corrected everywhere current without rewriting frozen history; Track F's "29 parameters" claim made
reproducible via a new test rather than re-asserted; Track A downgraded as above; DEC-008 reframed from
"credential doesn't exist" to "exists, Track E wants a separate one" — DEC-012; the AI-door production drift
documented; all committed and pushed). Later the same day, the owner reported TradingView Premium had gone
live, removing the CSV-export paywall that caused the original gap. Re-ran the identical packet script
against the same authenticated session, exported the real chart-data CSV via the browser's own "Download
data" (the Blob was intercepted client-side and moved out of the page into `Get-Clipboard` via a real
trusted-gesture click, after a script-only `fetch`/`window.open` attempt was correctly blocked by
TradingView's CSP and abandoned rather than probed further), and re-derived all four rulings from this fresh,
full-precision, 12-row artifact as unbiased evidence per explicit instruction — all four matched the original
findings exactly. Ingested via `--force`, raw CSV preserved verbatim under `tests/fixtures/vendor/raw_captures/`,
account restored to its exact pre-capture pixel state. RISK-018a, `PHASE_ONE_PLAN.md`, and
`VALIDATION_COVERAGE_MAP.md` updated to reflect RAW VENDOR ARTIFACT COMPLETE. See `RISK_REGISTER.md`
RISK-018a for the full two-pass evidence trail. Not authorized by this capture: implementing the four
functions, or Track E, or Review Packet #2.

**2026-09-05 (same session, later still) — Track E COMPLETE: real live-credentialed evidence, a real
defect found and fixed.** Owner provisioned a scoped, isolated-environment-only dev/test Anthropic
credential per DEC-008 and ran `tools/track_e_run_golden_journey.py` twice. First run: 6 failed, 1
passed — traced to a test-fixture defect (the Golden Journey test's `client` fixture never initialized
`catalyst.store`/`user_definitions`, so the real `cost_guard` check 500'd before any model call; zero
real model calls occurred for any failing case). Fixed, then re-run locally with a mocked model to
verify before spending again — which surfaced two REAL, independent product semantic-safety defects
that had never been reachable before: `definition_concierge.propose()` silently substituted EMA for an
explicitly-named unsupported indicator ("McGinley Dynamic") and silently invented a formula for a fully
ambiguous scan condition ("the vibe turns bullish"), both `ok:true`. Fixed with two general,
non-blacklist mechanisms — a deterministic pre-model gate for named-but-unsupported concepts (pure
code, the model is never even consulted, proven both by mock and live) and a new required `unresolved`
tool-schema field forcing honest model self-report of ungrounded language (a materially stronger
contract than free-text prompting, disclosed as still dependent on model honesty, not claimed
bulletproof). A first design attempt at the second mechanism (a pre-model syntactic "any fully-unanchored
clause refuses" check) was tried and reverted after this module's OWN pre-existing test suite proved it
too broad — "a twenty bar average of it" and "stocks where that holds" are both legitimately
fully-unanchored and required to succeed. 10 new non-live regression tests, all using prompts never
seen in any fixture; full sweep across every file importing `definition_concierge` (498 tests) plus the
Golden Journey file itself: 0 failed. **Second live run: 7 passed, 0 failed** — every case, including
both previously-failing ones, now passing on real evidence (real `claude-opus-5` calls, real tokens/cost,
real persistence round-trip, real vision candidates). Reviewed the evidence by hand (not the mechanical
draft alone), removed the DRAFT banner from `GOLDEN_JOURNEY_04_05_LIVE_RESULTS.md`, and moved
`VALIDATION_COVERAGE_MAP.md`'s plain-language and screenshot door rows to **4 — End-to-End**, scoped
precisely to what was tested. Full detail in `RISK_REGISTER.md` RISK-026 and `PHASE_ONE_PLAN.md`'s
Track E row. The credential was cleared from the local shell immediately after the second run; this
session never had access to it. Not authorized by this track: broadening the fix further, or any content
beyond what's recorded here — Review Packet #2 is a separate deliverable, produced next.

**2026-09-05 (same session, later still) — CHATGPT_REVIEW_PACKET_02.md produced; Phase One ACCEPTED;
Phase Two AUTHORIZED.** Published `CHATGPT_REVIEW_PACKET_02.md` covering final Track A-F state, the
corrected 21/48 benchmark figure, the reproducible 29-parameter Track F count, and a Human Testing
Readiness evaluation (READY FOR LIMITED HUMAN QA, one gate item unmet: Journeys #1-3 have no CI
automation). Owner/ChatGPT review accepted Phase One in full and authorized **Phase Two — Standing
Validation + Vendor Parity + Limited Human QA**, explicitly not a feature-expansion phase — full
9-decision authorization recorded durably as DEC-013, with per-item detail and sequencing in the new
`PHASE_TWO_PLAN.md`. Completed the "First Return" items required before any Phase Two coding begins:
(1) DEC-013 recorded; (2) the screener-execution/Track-D apparent contradiction investigated and
resolved — not a contradiction, `VALIDATION_COVERAGE_MAP.md`'s row was incomplete (Track D proves
sweep completion/liveness, not matched-ticker semantic correctness; the row now says both explicitly);
(3) `CHATGPT_REVIEW_PACKET_02.md`'s HEAD-provenance line clarified (HEAD at generation time, one
commit before the packet's own commit — git history unedited); (4) a bounded Journey #1-3 automation
implementation plan written (`PHASE_TWO_PLAN.md` §1), reusing `tools/mobile_audit.py`'s proven local-
backend-Playwright pattern rather than inventing new infrastructure, with each journey's own "chain"
table as the behavior specification and Journey #3's date-dependent "1.00" assertion flagged as
needing a point-in-time-aware rewrite; (5) a real, evidence-derived Vendor Parity Tranche 2 Lane-A
priority list produced (rsi > atr > sma > ema > rma > hma > macd > stoch > adx-family > wma, each
justified by actual corpus-frequency counts, `RISK_REGISTER.md` incident history, or
`divergences.json`'s already-flagged-but-unverified convention disputes — not asserted from memory).
`PHASE_ONE_PLAN.md` marked accepted/closed and preserved as history, mirroring the Phase Zero → Phase
One precedent. Next: begin Journey #1-3 automation implementation per `PHASE_TWO_PLAN.md` §1.

**2026-09-05 (same session, later still) — Journey #1-3 automation COMPLETE; gate item 8 closed;
`HUMAN_TESTING_READINESS_REPORT.md` produced.** `tools/golden_journey_pine_thinkscript_pcf.py` drives a
real headless Chromium through the full documented chain (paste/detect/translate/canonical/validation/
save/reload/My-Formulas/screener-gate/negative-path) for all three journeys against a fresh, isolated,
throwaway sandbox every run — no synthetic happy-path shortcut. Journey #3's PCF "1.00" assertion is now
genuinely point-in-time deterministic: fetches SPY's real current bars, runs the actual browser-produced
formula through the product's own JS interpreter in a real Node subprocess, cross-checks against an
independent from-scratch pandas SMA computation — both agreed at `1.0` against real 2026-09-04 data, no
hardcoded value. Found and fixed two real harness bugs (a Playwright label-locator ambiguity; a missing
`/screener` navigation) and one real flaky race (the screener's saved-scans list resolving its fetch after
`domcontentloaded` — fixed by polling for concrete DOM evidence instead of a fixed sleep). **3 consecutive
clean runs** on the fixed code, each an independent fresh sandbox. One documentation correction made along
the way, classified DOCUMENTATION DRIFT not a product defect (no durable decision ever required it, `git
log -S` shows it was never fresh-import behavior, `pine.js` deliberately treats a script's own `hline()`
as a visual-only pragma): `CORE_GOLDEN_JOURNEY_01`'s claim that `LEVELS` auto-populates on a fresh Pine
import was corrected in place (append-style) to state the real behavior — blank on fresh import, restored
only on reopening an already-saved definition — `PHASE_TWO_PLAN.md`'s mirrored claim corrected too. No
product code changed. With item 8 closed, all 9 gate items are met; produced
`HUMAN_TESTING_READINESS_REPORT.md` — verdict READY FOR LIMITED, ADVERSARIAL HUMAN QA, explicitly NOT
broad acceptance testing (per both the gate's own vocabulary and DEC-013's more specific standing scope).
Vendor Parity Tranche 2 not yet started.

**2026-09-06 — Vendor Parity Tranche 2 Lane B: implemented, then amended same day after an
owner-caught overclaim.** All four Track A-resolved functions (`ta.rising`, `ta.median` even-length,
`ta.percentrank`, `ta.bbw`) implemented in both JS/Python kernels, added to `closedTable.json`, and
compared against the RISK-018a raw-CSV-backed vendor observation — closing RISK-018/RISK-018a's
harness-minimum gap (0 parity-comparable) for these four functions. **Same day, owner review correctly
rejected the initial "VENDOR-PARITY VERIFIED" label as resting on exactly one probe row per function.**
A bounded audit (`tools/vendor_parity_lane_b_multibar_audit.py`, no new TradingView session) found the
SAME preserved CSV already holds 300 rows across all 25 distinct states of the synthetic script's cycle;
rebuilding the full series and comparing against both the ruling and a real-data mutation control
(the rejected candidate) produced per-function multi-bar verdicts, each precisely qualified rather than
uniformly upgraded: `rising`/`median`/`percentrank` → VENDOR-PARITY VERIFIED — MULTI-BAR; `bbw` →
VENDOR-PARITY VERIFIED — SCOPED CONTRACT (integer multiplier only); `rising` additionally carries a
disclosed PARTIAL — NA BEHAVIOR UNVERIFIED boundary (the artifact has zero NA-gap rows). Full detail:
`RISK_REGISTER.md` RISK-018b, `VALIDATION_COVERAGE_MAP.md`'s vendor-parity row. Lane A (the 10-function
priority list) was not started by this work.

**2026-09-06 — Public Script + Complex Visual Indicator Compatibility Harness: First Return through
Layer C, then a bounded final closeout.** A new tranche, separately authorized outside `PHASE_TWO_PLAN.md`'s
original numbered sections (design doc:
`PUBLIC_SCRIPT_VISUAL_COMPATIBILITY_HARNESS_READINESS_REPORT.md`). Sequence, condensed:
- **Layer A** (static, no browser): `compatHarness.publicScript.test.js` classified an initial 8-script
  `pine_community/` sample via the same real doors `doorScorecard.test.js` measures with — 5 SUPPORTED,
  1 PARTIAL, 1 UNSUPPORTED, 1 CORRECTLY_REFUSED, non-vacuity + mutation-tested.
- **Lane 2's six-level visual-fixture ladder** (Levels 1-6) found RISK-029: the document/schema layer
  (bands, `fill`, `colorMode`, composite arithmetic) supports materially more visual capability than
  `BuilderSheet.jsx`'s authoring UI exposes — recorded, explicitly not actioned per owner instruction.
- **Layer B** (visual/persistence, Level 1 fixture): classifier logic unit-tested and mutation-sensitive;
  a live re-run hit a reproducible `FontNotSettledError` (RISK-027), root cause undiagnosed, correctly
  classified HARNESS_DEFECT rather than fabricating a result — the prior 140,925-px evidence for that
  fixture stands unaffected.
- **Layer C, first session** (live TradingView, 4-script sample): found RISK-028 — two Layer-A-SUPPORTED
  scripts (`02-wavetrend-oscillator-lazybear.pine`, `19-cm-macd-ult-mtf.pine`) do NOT compile in
  TradingView's real, current engine (vendor platform decay over ~11 years on un-pragma'd scripts, not a
  UCT defect); Williams VIX Fix confirmed fully SUPPORTED end-to-end; ZigZag++'s attempt was
  HARNESS_DEFECT (Monaco auto-indent corrupted the source via simulated per-keystroke typing).
- **Final bounded closeout (this session)**: fixed the Monaco-corruption harness limitation with a
  genuine OS-clipboard-paste source-entry mechanism (verified byte-exact pre-paste, line-count +
  indentation-verified post-paste — reproduced no corruption across three scripts of increasing nesting
  depth); retried ZigZag++ under the hardened mechanism (now SUPPORTED at the vendor level — the import
  resolves cleanly; UCT's Layer A CORRECTLY_REFUSED is unchanged, a claim about UCT's own architecture,
  not vendor resolvability); added exactly two new/retested categories chosen to maximize new
  information (`14-earnings-gap-ups.pine`, input-heavy: enum/UDT/method/switch; `27-support-resistance-
  channels.pine`, visual-heavy, previously Layer A UNSUPPORTED) — both compile and render cleanly in the
  real vendor while UCT correctly rejects both (`pine:no-output`; `pine:reassign` — the latter correcting
  an earlier, less precise assumption that the real blocker was missing array/box builtins). Filed
  RISK-030 for the full finding set. Produced the required 17-item `PUBLIC_SCRIPT_COMPATIBILITY_
  CHECKPOINT_01.md`, updated `RISK_REGISTER.md`/`VALIDATION_COVERAGE_MAP.md` accordingly. **Explicit next
  phase boundary per owner instruction: no remediation, no further corpus expansion, no Track F v2, no
  RISK-004 work begins from this closeout — awaiting the owner/ChatGPT review gate. Vendor Parity Lane A
  RSI/ATR remains the next engineering tranche after this checkpoint is separately accepted.**

**2026-09-06 — Checkpoint 01 ACCEPTED; Vendor Parity Tranche 2, Lane A, first batch (RSI + ATR)
COMPLETE.** Owner accepted the compatibility checkpoint and authorized the next tranche exactly as
named. Captured a real, 1,328-bar SPY Daily TradingView series (2021-05-24..2026-09-04, full
double-precision) via the same hardened clipboard-paste + CSV-export-interception technique the prior
closeout established, then compared UCT's `rsi(close,14)`/`atr(high,low,close,14)` against it via
`tools/vendor_parity_compare.py`. Both are now **VENDOR-PARITY VERIFIED**: 0 disagreements across 1,148
genuine steady-state bars each (~1e-9 relative delta, float noise). A new, general finding along the
way — deliberately investigated rather than glossed over, per the readiness report's own explicit
warning: comparing UCT's Wilder/RMA-recursive functions against a real vendor value using only the
naive 14-bar period-warmup produces a large (~25% relative at bar 14) apparent disagreement that is
NOT a formula defect but a capture-window cold-start artifact (UCT re-seeds fresh at the window's own
start; the real vendor value already reflects decades of continuous smoothing) — measured precisely
(last disagreement at bar 172/169 of 1,328) and recorded as a new standing `divergences.json` row
(`recursive-smoother-cold-start-in-a-finite-capture`) rather than silently widening the tolerance or
mis-attributing it to either function's formula. Two formula mutations (Cutler's RSI; a bare-high-low
ATR) each correctly flipped 100% of steady-state bars to disagreement, plus 4 vendor-source-refusal
controls, all passing. `divergences.json::atr-tr-starts-at-bar-1`'s 2026-08-29 ruling was amended
(appended, not rewritten) with this real-capture confirmation of its steady-state claim; its separate
alignment claim remains untested by this window and is not reopened. Two pre-existing, unrelated test
failures were incidentally discovered while confirming no regressions (a `%`-operator translator gap
affecting the 4 Lane B oracle observations' own cross-check; `bbw`'s already-disclosed `mult:int`
limitation additionally tripping an argument-order rail) — both confirmed pre-existing via `git log`,
disclosed as RISK-032, and deliberately NOT fixed (out of this batch's scope). Full evidence chain:
`VENDOR_PARITY_TRANCHE_2_LANE_A_RSI_ATR_REPORT.md`; permanent regression:
`tests/test_vendor_parity_rsi_atr.py` (14 tests). `RISK_REGISTER.md` RISK-031/RISK-032,
`VALIDATION_COVERAGE_MAP.md`, and `PHASE_TWO_PLAN.md` §2 updated. **Per the explicit stop condition:
the remaining 8 Lane A functions (sma, ema, rma, hma, macd, stoch, adx-family, wma) are NOT started,
no compatibility remediation was begun, Track F v2 was not begun, and RISK-004 was not begun — all
await separate, explicit authorization.**

**2026-09-06 (same day, follow-up) — RSI/ATR review ACCEPTED with evidence-label tightening; RISK-032
bounded audit CLOSED before SMA/EMA.** Owner accepted the RSI/ATR batch but tightened the standing
labels to name exactly what was proven, not the tool's bare internal verdict string: RSI →
`VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR`; ATR → the same plus
`+ PARTIAL / UNVERIFIED INITIALIZATION BOUNDARY` (naming that the bar-0/TR-definition ruling's
alignment claim was not independently isolated by this capture). No evidence changed — applied
consistently across the report, `RISK_REGISTER.md`, and `VALIDATION_COVERAGE_MAP.md`. Then, per
explicit instruction, investigated and closed RISK-032 (the two incidentally-discovered test
failures) BEFORE starting SMA/EMA: both classified **KNOWN SCOPED LIMITATION INCORRECTLY TESTED** by
direct code reading (`pine.js`'s `%` refusal is a real, deliberate, unchanged-since-2026-08-09
product boundary — `PINE_OP_TO_TABLE` has no `%` entry at all; `bbw`'s `mult:int` is a genuine,
already-disclosed, ordering-unambiguous non-period role) and fixed test-file-only: the 4 Lane B
oracle observations gained an explicit `script.independentlyTranslatable: false` + reason field
(additive; frozen evidence untouched) that `vendorTruth.test.js` now asserts loudly instead of
attempting a re-translation these scripts were never claimed to survive; `test_ast_indicators.py`'s
`_INT_ROLES` closed set widened from `{"anchor"}` to `{"anchor", "mult"}` following the exact
precedent already established for `anchor`. **No product code changed (`pine.js`/`ast_interpret.py`/
`interpret.js`/`closedTable.json` all untouched); no published Lane B parity status invalidated.** A
third, previously-unreported gap (a stale dual-kernel conformance snapshot for the 4 Lane B
functions — zero lane disagreement, just an unrecorded digest) was found incidentally while running
the required conformance suites and filed as RISK-033, explicitly left unfixed (out of RISK-032's
named 2-item scope). Full re-verification green: `test_vendor_truth.py`, `test_vendor_parity_lane_b.py`,
`test_vendor_parity_lane_b_multibar.py`, `test_vendor_parity_rsi_atr.py`, `test_ast_indicators.py`,
`test_screener_technicals_accuracy.py`, `vendor_truth.py --check` (exit 0), `vendorTruth.test.js`,
`vendorNote.test.js`, and the full `app/src/components/chart/engine/ast/` vitest sweep (111/112 files
— the one remaining failure is the already-tracked, out-of-scope RISK-004 blind-corpus floor). Full
detail: `VENDOR_PARITY_TRANCHE_2_LANE_A_RSI_ATR_REPORT.md` §15 addendum; `RISK_REGISTER.md`
RISK-032 (RESOLVED)/RISK-033 (RECORDED). **Parity baseline confirmed clean enough to proceed to
SMA/EMA. SMA/EMA itself is NOT started by this entry — awaiting separate authorization, per the
explicit stop condition.**

## The owner's 8-point establishment list (DEC-001) — this IS the Phase Zero task list

| # | Item | Status |
|---|---|---|
| 1 | What the 7/31 architecture actually intended | **Done.** Read in full; summarized in DEC-001/DEC-002/`CURRENT_ARCHITECTURE.md`. Correction: the doc's own roadmap only covers Phases A–D faithfully; Phase E has a separate 8/8 addendum spec. |
| 2 | What portions were actually implemented | **Done for Phases A–E** — see `CURRENT_ARCHITECTURE.md`'s phase table. Engine/binding layer (B), alerts (C), builder+AI door (D), and screener mechanism (E) are all real, tested code, not just plans. |
| 3 | What portions shipped (vs. implemented-but-not-shipped) | **Done.** All of A–E are on `origin/master`. The one real "implemented but not shipped/wired" item: `confluence.py`'s `dpc-v1` prototype (RISK-002). Phase E's commercial tiering mechanism is shipped; the toolkits themselves are not (1 ungated toolkit exists) — explicitly open per the code's own docstring, not hidden. |
| 4 | What has evolved beyond the original specification | **Done.** `confluence.py`, `registry_defs.py` (beyond Phase A plan); Phase E's real shipped scope (beyond the stale doc); the independent "Confluence Radar" feature (RISK-001) that the design doc doesn't know exists. |
| 5 | What is currently in flight | **Done, with one open item.** All 7 investigated worktrees (`phase-b1-foundations`, `phase-b2-engine`, `indicator-endzone`, `candle-library`, `screener-deep-work`, `patterns-retire`, `live-scan-retire`) show **zero commits unique to the branch** — every one is fully merged into `origin/master`, confirmed via `git rev-list --left-right --count`. `feat/indicator-endzone` specifically: merged, master 4 commits ahead. Open item: whether a session is *currently* active in that worktree right now (RISK-006) — filesystem timestamp only, not conclusively resolved. |
| 6 | Whether current product behavior matches that architecture | **Partially done — code/test-level only, explicitly not browser-verified.** Strong wiring evidence (routes registered, real frontend consumers found, 222 backend tests + a 144-AST conformance check all pass live). No agent has browser access; this is the single largest remaining gap (RISK-010) and the top second-wave candidate. |
| 7 | Which decisions remain appropriate under the expanded objective | Not started as a formal pass — but no wave-one finding contradicts DEC-001/DEC-002; if anything, the shipped architecture *exceeds* what the master prompt was hypothesizing as open research (§12, §14). |
| 8 | Which decisions may deserve reconsideration on genuinely new evidence | Two real candidates surfaced, both routed to the decision queue rather than resolved unilaterally: the Confluence naming collision (RISK-001) and the `confluence.py` wire-or-retire question (RISK-002). Neither is urgent; neither touches DEC-001/DEC-002 directly. |

## Dispatched this session (2026-09-04)

- **Fork — Ledger construction. DONE.** `REQUIREMENTS_LEDGER.md` (120 rows) and `CONSTRAINT_LEDGER.md`
  (19 entries) written and committed. Key findings:
  - **Gap flagged, not yet resolved:** Door C (TC2000/PCF, MP-014C) is rated MUST by the master prompt
    on the same footing as Pine/thinkScript, but zero repo evidence of any TC2000 work exists anywhere
    (no branch/worktree/doc/commit) — unlike Pine and thinkScript, which both have real active
    engineering behind them. Kept at MUST (master prompt's own authority) but repo-area marked "unknown,
    may be greenfield." A TC2000 specialist should expect to start from zero, unlike the other two doors.
  - Several rows flag "likely already partially satisfied by the 7/31 program — verify, don't reinvent"
    (MP-016 one-saved-logic-object vs. 7/31 §3 definition schema; MP-052 versioning vs. §3.1's
    version/compute.rev split; MP-032 Vendor Oracle Protocol vs. the "ruling(bbw/percentrank/median)"
    commit pattern; MP-066 doc-from-metadata vs. the "Segment G6 ... generated from the manifest"
    commit). This is a direct, expected consequence of DEC-001 — confirming "already satisfied" is as
    valid a Phase Zero outcome as finding a gap, and the archaeology agents below should check these
    specifically rather than treating them as open.
- **Agent — Indicator Platform Program Archaeologist. DONE.** Exceptional report — see
  `CURRENT_ARCHITECTURE.md` and `RISK_REGISTER.md` for the full synthesis. Headlines: the engine is real
  and is the **unconditional active renderer** on every chart (not a shadow path); all 7 investigated
  worktrees are fully merged (zero unique commits each); Phase E (screener/toolkits mechanism) has also
  shipped, beyond what the 7/31 doc's own roadmap table (stale past Phase D) describes; found a real
  naming collision between two unrelated "Confluence" features (RISK-001); independently re-derived the
  same 144-AST conformance number the Pine/thinkScript agent found (cross-validation). Explicitly could
  not verify live product/production behavior — no browser or Railway access from that agent.
- **Agent — Pine/thinkScript Translation Layer Archaeologist. DONE.** Major findings:
  - **Q1 (authoring-surface risk) resolved, high confidence: no conflict with DEC-002.** The translation
    layer is structurally an import door only — raw Pine/thinkScript/PCF source is transient (parsed
    client-side, never persisted); only the canonical AST is saved, through one write door
    (`nativeRegistry.installUserDefinitions`). `PineBox.jsx`'s own header states this explicitly ("A
    MODE, NOT A FOURTH BUILDER"). The one soft residual risk DEC-002 itself names (free-text editing of
    *canonical* source) is not present today — members only edit *pre-translation* paste text.
  - **The manifest = `app/src/components/chart/engine/ast/closedTable.json`** (169KB). Single writer, two
    synchronized runtime readers (`interpret.js` JS, `ast_table.py`/`ast_interpret.py` Python), each
    AST-walked by its own test to forbid a hand-copied vocabulary string — a real anti-drift mechanism.
    `vocabulary.js` generates the member-facing `/formulas/reference` docs from it (the "Segment G6"
    commit, confirmed), and `definition_concierge.py`'s AI tool schema is separately generated from the
    same manifest. **Master-prompt MP-066 (docs derived from engine capability metadata) is already
    substantially satisfied — predates this program.**
  - **Correction to the ledger's TC2000 gap flag (MP-014C):** `pcf.js` (`parsePcf`) exists in the same
    `engine/ast/` directory as the Pine/thinkScript parsers, and `tests/fixtures/ast/pcf_corpus.json`
    exists with `accepted`/`offset_dependent`/`refused` buckets. TC2000/PCF is **not** greenfield — it has
    an existing parser and test corpus, same as the other two doors. The ledger-construction fork's
    "zero evidence" finding was accurate to what it could see from the master-prompt text and light repo
    grounding, but incomplete — this is exactly the kind of cross-check multiple independent agents are
    supposed to catch. `REQUIREMENTS_LEDGER.md` MP-014C updated accordingly (see below).
  - **Benchmark reconciliation — all five cited numbers (memory's 17/21, master prompt's 38/38 · 43/58 ·
    21/48 · 28/48) are stale or mischaracterized, not current measurements.** 38/38 = the self-authored
    `pine_screener/` control corpus. 21/48 → 28/48 = the externally-styled `pine_blind/` corpus, a moving
    ratchet (was 17/48 earlier). 17/21 = confirmed real for `pine/` (21 vendor scripts) but was an 8/12
    *projected ceiling*, since revised — the permanently-refused set grew 4→5 by 8/30, and the last dated
    in-file comment showed 14/21 measured. 43/58 was **not found literally** in the repo; best-fit is
    `doorScorecard.test.js`'s combined Pine+community+thinkScript corpus, whose denominator has grown
    from a presumed 58 to **77** while a "≥43 translate" floor was never raised — meaning a quoted "43/58"
    today would overstate the real pass rate. That same test file apparently carries its own explicit
    warning against exactly this: *"41/75 SCRIPTS TRANSLATE IS NOT THE NUMBER, AND QUOTING IT
    UNDERSTATES THE PRODUCT."* **No number should be quoted anywhere until re-measured live** — exact
    repro commands are recorded, not yet run (see "Next steps").
  - **Architecture — matches master-prompt §12's hypothesized shape and appears to predate it.** All five
    input doors (§14: Pine, thinkScript, TC2000/PCF, plain-language via `ConciergeBox.jsx`, screenshot via
    `ImageBox.jsx`) already exist as modes inside one `BuilderSheet.jsx`, funneling into one canonical AST,
    one write door, two synchronized (JS + Python) execution kernels cross-checked at 1e-9 tolerance via
    `tools/ast_conformance.py`. **This is a shipped realization of "one grammar, many surfaces," not an
    open research question** — Phase Zero effort here is better spent auditing depth/correctness within
    each door than re-deriving the shape.
  - **Disambiguation:** the candlestick/chart-structure "pattern engine" (`api/services/pattern_engine/`,
    feeding the Compass coaching product) is architecturally separate from this translation layer — shares
    no code, only loose commit-message proximity. Do not conflate the two when reasoning about "the
    translation layer."
  - **Unconfirmed by this agent (in scope for the still-running program archaeologist):** whether
    `indicator-endzone`, `phase-b1-foundations`, or `phase-b2-engine` worktrees contain divergent,
    uncommitted changes to this same translation layer — this agent's read was restricted to origin/master.

## Wave two #1: DONE — Core Golden Journey #1 (Pine RSI import → chart → save → reload → screener)

Full write-up: `CORE_GOLDEN_JOURNEY_01_PINE_RSI_IMPORT.md`. Ran in a properly data-isolated local
environment (verified 48 shared-data env vars redirected to a sandbox, `AUTH_DB_PATH` included, before
touching anything). Headlines:
- **Real semantic translation confirmed correct**: a 97-line Pine RSI script with a helper function and a
  19-branch source selector correctly reduced to canonical `rsi(close, 14)`, with a live execution-
  requirement contract shown to the user (3 nodes, 14-bar lookback, non-repainting) — not aspirational,
  actually working.
- **Chart delivery, save, and reload all confirmed working** for this fixture, including a clean reload
  with live-recomputed values (55.34 → 55.39), proving real computation, not a cached render.
- **The numeric-vs-boolean screener gate is correct and has real institutional memory behind it** — found
  a documented historical incident (a numeric formula once got permanently stuck reading "first sweep
  tonight" due to a weak client-side check; fixed by moving the check server-side). Reproduced the *fixed*
  behavior cleanly today for both a numeric artifact (correctly refused) and a boolean one (correctly
  accepted).
- **Screener execution itself is architecturally nightly-only, enforced by a dedicated test that forbids
  any router from importing the sweep** — correctly classified ENVIRONMENT-BLOCKED, not attempted to be
  forced, respecting the deliberate guardrail (master-prompt §10).
- **Negative-path test passed**: an unsupported property access was correctly refused with a specific
  message; Save was confirmed to be a no-op on the invalid formula.
- **One real (minor) defect found**: double-clicking Save duplicates a chart instance (RISK-012, S3, not
  fixed — logged for later per the "no broad fixes in Phase Zero" instruction).
- **One real fidelity gap found**: the source script's adjustable inputs don't carry over as adjustable
  UCT inputs, only their defaults do (RISK-013).
- `VALIDATION_COVERAGE_MAP.md` created — first real, evidence-cited version, not a stub.

## Wave two #2: DONE — Screener/"Custom Screens" archaeology

Full findings folded into `CURRENT_ARCHITECTURE.md`'s new "Screener / Scanner system" section. Headlines:
- **"Custom Screens" definitively resolved: not this repo's term for anything** — it appears only in the
  master prompt and this program's own docs. Real vocabulary: Scanner Hub → Custom Scan (retired) → Saved
  Screens → today's "Screens" dropdown inside the "Screener" page. Future capability-matrix work should
  use the repo's own terms.
- **Found a third instance of the "design doc goes stale within weeks" pattern — this time in `CLAUDE.md`
  itself.** It names a file (`SavedScreensPanel.jsx`) that was deleted 2026-08-22 and replaced, while
  originally correcting an even older false claim about the same wiring. Logged as RISK-015. This
  materially updates how much trust to extend to CLAUDE.md going forward — treat it as a lead like any
  other doc, not as ground truth, even though it's the repo's own onboarding file.
- The Finviz-snapshot screener and the AST-scan system are **deliberately joined** (an explicit, recorded
  owner decision), not accidentally coexisting — with a tested "Honest-None" disclosure guarantee that
  independently corroborates what Core Golden Journey #1 observed live in the browser.
- Three separate real pattern/structure systems identified and distinguished (`pattern_engine`, a deleted
  old heuristic, the new Base & Structure Library) — matches and extends prior memory on the latter.
- 101/101 targeted tests passed live; all three investigated worktrees/branches confirmed fully merged.
- `VALIDATION_COVERAGE_MAP.md` extended with 4 new rows for the screener system.

## Wave three: DONE — P1-P6 (all five Golden Journeys, Tracks B/C/D/E)

All six of the user's numbered priorities from the most recent Phase Zero instruction have now landed:

- **P1 — Core Golden Journeys #2-#5, all done**, joining CGJ#1: `CORE_GOLDEN_JOURNEY_02_THINKSCRIPT_ADX.md`,
  `_03_TC2000_PCF_IMPORT.md`, `_04_PLAIN_LANGUAGE.md`, `_05_SCREENSHOT_VISION.md`. Headlines: the numeric-
  vs-boolean screener gate confirmed door-agnostic across three source languages; a genuinely useful
  divergence found and explained (TC2000/PCF's AND-of-comparisons artifact correctly accepted as a screen
  without needing its own optional threshold helper); two real bugs found (RISK-016, shared by both AI
  doors) and honestly distinguished from one clean, well-designed environment block (screenshot door's
  `INDICATOR_VISION_ENABLED` flag-off, refused in-words through the documented contract) — collapsing both
  into "AI doors blocked" would have lost that distinction.
- **P2 — Screener preservation baseline, done**: `SCREENER_PRESERVATION_BASELINE.md`. Terminology
  confirmed final; two real, previously-uncaught defects found (RISK-024 unwired `scan_store.prune()`,
  RISK-025 dangling scan-definition references in alert subscriptions); one earlier internal claim about
  the edit route corrected after direct re-verification rather than carried forward.
- **P3 — RISK-003 production verification, done** (prior to this wave) — classified PRODUCTION-UNVERIFIED
  with full Railway-check evidence and a precise statement of what further evidence would resolve it.
- **P4 — Data/timeframe/execution audit, done**: `DATA_EXECUTION_FINDINGS.md`. Three "live" scanning-
  adjacent systems disambiguated; the nightly-only boundary broken into 6 policy-vs-limitation buckets;
  RISK-017 (on-demand door has no code-level intraday-tf refusal) found.
- **P5/P6 — Test credibility + telemetry audit, done**: `TEST_CREDIBILITY_FINDINGS.md`,
  `TELEMETRY_OBSERVABILITY_FINDINGS.md`. Lead finding: dual-kernel/golden-fixture agreement is self-
  consistency, not vendor parity (RISK-018) — and this exact failure mode has already shipped to
  production twice on the screener side, independently (RISK-019 `rsi14`/Cutler-under-Wilder, RISK-020
  doji/zero-range-bar). Pattern-engine narrative fabrication found in 8 detectors, fixed the day before this
  audit, ~90+ detectors not yet swept the same way (RISK-021). Telemetry as the master prompt defines it
  does not exist on the interactive path (RISK-023), but two already-live storage precedents make closing
  that gap cheaper than it looks.
- **General finding recorded**: the "design docs go stale within weeks" pattern, now observed a third and
  fourth time (7/31 doc, `CLAUDE.md`, and this program's own compressed notes about the edit route) —
  logged as a standing principle in `RISK_REGISTER.md`, not a fix-now item.

`RISK_REGISTER.md` now carries 25 entries total. `VALIDATION_COVERAGE_MAP.md` updated throughout with only
earned levels — see that file for the current per-subsystem picture.

## Wave three: DONE — CHATGPT_REVIEW_PACKET_01.md

The full 21-section ChatGPT Review Packet is written and committed:
`CHATGPT_REVIEW_PACKET_01.md`. This closes out the checkpoint the owner set — both explicit gates (remaining
Golden Journeys, data/execution audit) plus every other track (P2/P5/P6) all landed and are synthesized into
one document, section-exact to the required structure. Awaiting owner/ChatGPT review (§21 lists 10 open
questions).

## Phase One — Track F: DONE (Pine input-parameter fidelity, narrow v1, ACCEPTED)

DEC-006 authorized this track contract-first (an ADR before any mapping work). The full arc, across several
owner/ChatGPT review cycles:

- **ADR chain**: `TRACK_F_PARAMETER_ADR_V2.md` (raw-source-persistence question resolved: `compute.source`
  reuse, never a second persisted representation) → `_V2_1.md` (single authority, `__uct_param_<n>` identity,
  server-side validation chokepoint) → `_V2_2.md` (the owner's correction that ONE Pine input feeding
  multiple trees is ONE logical parameter, not two; immutable/derived state split; server-side
  canonicalize-from-`prev` bypass closure) — each revised against direct owner/ChatGPT review, not
  self-approved.
- **15-point pre-implementation spike**: `TRACK_F_SPIKE_REPORT_V1.md` — 21/21 tests passing against real
  `save()`/`alert_user_series` code, not simulated. Found and recorded a real design-assumption failure
  along the way: the ADR chain's original locator scheme (`{treeIndex, bindingId}`, assuming server-side
  re-parsing of `compute.source`) does not match this codebase's own "exactly one parser, and it is
  client-side JS" architecture — corrected to `{treeIndex, astPath}`, a structural path into the
  already-parsed AST.
- **Narrow v1 implementation, ACCEPTED (2026-09-05)**: `TRACK_F_V1_IMPLEMENTATION_COMPLETION_REPORT.md`.
  `input.int`/`input.float` — including the window/length-bound case RISK-013's own motivating fixture
  needed — now survive as adjustable, server-protected, persisted parameters. A real bug was found and
  fixed during implementation (`pine.js`'s `foldWindow` silently dropping the parameter tag on every
  window-bound input, which would have made RISK-013's own motivating case silently ineligible). Verified
  live in a real browser (isolated sandbox) against the real `07-rsi.pine` fixture: adjusted 14→21, saved,
  reloaded, reject-not-clamp confirmed on an out-of-range value. Corpus-wide: all 14 translating scripts in
  the real Pine fixture corpus (100%) gain at least one adjustable parameter, zero change to translation
  success. 60 new/promoted tests, zero regressions (2323 pre-existing tests re-run, 3 confirmed pre-existing
  unrelated failures).
- **Same-day follow-up, ACCEPTED**: reopening an already-saved parameterized definition to keep tuning it,
  through the existing `PUT /{def_id}`/`BuilderSheet.jsx::openForEdit` door — no new architecture. The door
  was already wired from the v1 commit; what was missing was proof and a permanent regression. Both landed:
  a live browser pass (stable `def_id`, version 1→2, immutable `default` preserved across the edit,
  confirmed via direct database read) and `BuilderSheet.paramReopen.test.jsx` (a real-UI wire-cut test,
  nothing mocked but `fetch`, driving the full import→save→close→reopen→re-tune→save→reload cycle).
- **RISK-013 now PARTIALLY CLOSED** (was fully open): closed for `input.int`/`input.float`; open for
  `input.bool`/`input.string`/`input.source`/`input.timeframe`/`input.symbol`/`input.time`/`input.color`,
  switch/branch-driving inputs, numeric `options` enums, and bar-displacement (`close[n]`) inputs — each a
  disclosed, deliberate scope boundary, not a silent gap. **Track F is stopped here** pending a separate
  future authorization for any further input-type expansion.
- `VALIDATION_COVERAGE_MAP.md` updated: Save/persistence (edit) raised from 0 to 4 — End-to-End; two new
  rows added for Pine input-parameter fidelity and reopen/re-tune, both 4 — End-to-End.

## Not yet started

1. Everything logged in `RISK_REGISTER.md` as "not fixed in Phase Zero" remains exactly that — 25 entries,
   none actioned beyond what the Phase Zero authorization allows (small, obviously-low-risk, independently-
   testable, non-disruptive fixes only, and none of the entries qualified).
2. Competitive research (master-prompt §64–65) — still low urgency per the master prompt's own phase
   ordering; holding.
3. RISK-018's populate-the-vendor-observations recommendation — the single highest-leverage open item this
   program has found, per `TEST_CREDIBILITY_FINDINGS.md` — is a build-phase candidate, not attempted here.
4. Everything in `CHATGPT_REVIEW_PACKET_01.md` §20 (Proposed Next Phase) and §21 (open questions) —
   awaiting owner/ChatGPT direction before any of it proceeds.

## Artifacts in this folder so far

- `00-MASTER-PROMPT.md` — verbatim source objective + addendum + reconciliation. Read first.
- `DECISIONS.md` — DEC-001 (program scope), DEC-002 (no standalone scripting language, preserved).
- `PROGRESS.md` — this file.
- `REQUIREMENTS_LEDGER.md` (120 rows), `CONSTRAINT_LEDGER.md` (19 entries) — done.
- `BENCHMARK_REPRODUCTION.md` — live-measured numbers, done.
- `CURRENT_ARCHITECTURE.md` — wave-one synthesis, done (translation-layer corner only — see its own scope note).
- `RISK_REGISTER.md` — 25 real risks logged, plus one standing general principle (stale documentation).
- `CORE_GOLDEN_JOURNEY_01_PINE_RSI_IMPORT.md` through `_05_SCREENSHOT_VISION.md` — all five Golden Journeys, done.
- `VALIDATION_COVERAGE_MAP.md` — evidence-cited, updated through all five journeys and both audit tracks.
- `SCREENER_PRESERVATION_BASELINE.md`, `DATA_EXECUTION_FINDINGS.md`, `TEST_CREDIBILITY_FINDINGS.md`,
  `TELEMETRY_OBSERVABILITY_FINDINGS.md` — the four Track B/C/E synthesis documents, done.
- `CHATGPT_REVIEW_PACKET_01.md` — the full 21-section synthesis deliverable, done.
- `TRACK_F_PARAMETER_ADR_V2.md` / `_V2_1.md` / `_V2_2.md` — the Pine input-parameter fidelity ADR chain,
  each superseded-in-part by the next, ACCEPTED at `_V2_2.md`.
- `TRACK_F_SPIKE_REPORT_V1.md` — the 15-point pre-implementation spike, 21/21 passing, ACCEPTED.
- `TRACK_F_V1_IMPLEMENTATION_COMPLETION_REPORT.md` — narrow v1 implementation + the reopen/re-tune
  follow-up, both ACCEPTED. Done; Track F is stopped pending future authorization.
- `OWNER_VENDOR_CAPTURE_PACKET_V2.md` / `_V3.md` / `_V3_1.md` — Track A's ambiguity-first vendor capture
  packet chain, each superseded-in-part by the next, ACCEPTED for owner execution at `_V3_1.md`.
- `VENDOR_OBSERVATION_SCHEMA_EXTENSION.md` — Track A's observation-schema proposal + the vendor-parity/
  vendor-observation conflation fix (RISK-018-shaped), done.

## Benchmark reproduction — DONE (`BENCHMARK_REPRODUCTION.md`)

Ran the actual corpus tests + the Python cross-lane conformance tool (commands + full results in that
file). Headline: **43/58 and 21/48 were exactly right, live; "28/48 after assisted edits" is currently
FALSE — the repo's own test is red on this today (stuck at 21, the offer mechanism isn't lifting any of
the 21 blocked blind-corpus scripts); memory's "17/21" is superseded (today: 14/21).** Also found: TC2000
(PCF) is 57/57 on its own corpus — not just non-greenfield, plausibly the most mature door by this metric
(caveat: unknown whether it has a blind/adversarial corpus the way Pine does). Also found a second live
red check: `ast_conformance.py --coverage` shows one manifest scalar (`base_relation_count`) with zero
fixture coverage. Both red findings are real, narrow, already self-tracked by the repo — not fabricated,
not hidden.

## Wave one: complete

All three dispatched workstreams (ledger construction, Pine/thinkScript archaeology, Indicator Platform
program archaeology) plus the direct benchmark reproduction have landed and been reconciled into
`CURRENT_ARCHITECTURE.md` and `RISK_REGISTER.md`. See "Not yet started (second-wave candidates)" above
for what's next — ranked by what wave one actually surfaced, per master-prompt §61's "determine optimal
parallelization after initial orientation."
