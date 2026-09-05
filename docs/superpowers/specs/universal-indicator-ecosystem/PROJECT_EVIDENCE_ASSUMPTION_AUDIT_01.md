# Project Evidence & Assumption Audit 01 — Adversarial Trust Pass

**Status:** authoritative audit record. Read before trusting any "closed"/"complete"/"blocked"
status claim elsewhere in this program's docs without independent re-verification.

**Trigger:** this session's Track E credential search found the same shared production
`ANTHROPIC_API_KEY` the owner already knew about, and separately discovered
`INDICATOR_VISION_ENABLED=1` had been live in production since 2026-09-02 — three days
before DEC-008 (dated 2026-09-04) was written treating that same flag as something to be
armed "only in an isolated validation environment." The owner correctly identified this as
evidence of possible **narrative drift** — conclusions hardening from conservative
assumptions into treated-as-fact status without periodic re-verification — and ordered this
audit before any further Track E work or Review Packet #2.

**Method:** six independent, adversarial research passes (this session's own fork/subagent
mechanism), each briefed to try to falsify prior claims using a strict source-of-truth
hierarchy (production/runtime evidence > code > DB/state > non-vacuous tests > git history >
docs > prior reports > narrative), each explicitly authorized to re-run tests, re-derive
numbers, and — for one thread — perform temporary, immediately-reverted mutation testing.
**Every thread's find/re-run claims below were independently reproduced by that thread
itself**, not merely asserted. Two safety notes on process: (1) two of the six threads were
interrupted mid-task by a transient server-side rate limit; one left an in-progress mutation
(`tools/vendor_truth.py`'s `compare()` verdict hardcoded to `"MATCH"`) uncommitted in the
working tree — caught via `git status --porcelain` before it could be missed, reverted, and
confirmed clean before resuming the thread. (2) One `claude-sonnet-5[1m]` safety-classifier
pass was unavailable (rate-limited) when reviewing one thread's output; that thread's claims
were given extra scrutiny against the other five threads' independent corroboration before
being trusted here.

---

## 1. Overall verdict on reliability

**Substantially reliable, with one material evidentiary gap, one confirmed-false
recurring-narrative item, two unexecuted rulings, and a real but narrow drift pattern —
not a systemic reliability failure.** Adversarial re-execution (fresh test runs, live
mutation testing, direct code reading, direct Railway/production reads) confirmed the large
majority of this program's status claims hold up under real pressure, including several
mutation-tested non-vacuity proofs this audit performed itself. The reliability concern the
owner named — conservative assumptions hardening into treated-as-fact status — is real and
recurring exactly twice in the same subsystem (the AI import doors), not once and not
everywhere.

## 2. Important claims confirmed

- **Every JS-side benchmark number reproduces byte-for-byte from current HEAD**, freshly
  re-run: Pine curated 43/58, Pine blind (first pass) 21/48, Pine (community) 19/30,
  thinkScript 10/24, TC2000/PCF 57/57, end-to-end delivery 43→43→43, scanning reach 18/43
  direct / 43/43 with one comparison. `ast_conformance.py --check` reproduces identically
  (144 ASTs × 579 bars, exit 0) — explicitly self-consistency, not vendor parity.
  `ast_conformance.py --coverage`'s known `base_relation_count` zero-fixture-coverage gap is
  confirmed still open, unfixed since 2026-09-04.
- **Track A's tooling is real and non-vacuous.** `python tools/vendor_truth.py --check`
  reproduces "4 observations held, 0 parity-comparable, 4 vendor-semantics-only" exactly.
  `tests/test_track_a_ingest_vendor_capture.py` (30/30) genuinely refuses on disagreeing
  probe rows and untrusted control values — verified by inspection, not just count.
  `vendor_truth.py`'s own MATCH/DELTA classification was **live mutation-tested**
  (hardcoded to always-MATCH) and confirmed to go RED against its own planted-disagreement
  positive control (`test_the_vendor_truth_harness_DISCRIMINATES`) before being reverted.
- **Track B and Track C hold up under fresh re-execution.** `test_screener_screen_alerts.py`
  (21), `test_scan_store.py` (24), `test_indicator_telemetry.py` (37),
  `test_indicator_alerts_telemetry.py` (3) all re-ran green; representative tests read in
  full are genuinely descriptive of real distinctions, not snapshot/mocked-to-death.
  Telemetry's `EVENT_SCHEMAS` allowlist was independently confirmed (by both the
  test-credibility and security threads) to structurally reject raw source/prompt content —
  a parametrized 4-shape nested-smuggling test was read and confirmed non-vacuous.
- **Track F's shipped mechanism (int/float parameter editing) is genuinely tested.**
  `BuilderSheet.paramReopen.test.jsx` mounts the real component, mocks only `fetch`
  (stateful, not a trivial stub), and performs real unmount/remount cycles — read in full,
  confirmed non-vacuous. `param_manifest.py`'s reject-not-clamp behavior and its
  crafted-manifest-widening defense were both **live mutation-tested** (silencing the bounds
  check) and confirmed to go RED on two specific tests before being reverted.
- **Track D's tooling-restriction scope was confirmed narrower than it could be misread.**
  `railway status` from the audit's own execution context linked cleanly to
  `luminous-recreation`/`production`/`web` — the blocker that stopped the 2026-09-04 second
  pass is scoped specifically to the `isolation:"worktree"` Agent execution mode, not to
  this worktree directory in general.
- **No critical or high security findings.** `.env` gitignore confirmed via
  `git check-ignore -v` (exit 0) in all three sibling repos; no `.env` file or real
  secret-shaped string was ever committed to any of their histories (the only
  `*_KEY=`/`*_SECRET=`/`*_TOKEN=` hits across all history trace to `.env.example`
  placeholders); no test file or this session's own new tooling ever prints a credential
  value; the four Track A observation JSON files contain only chart/provenance data.
- **`SCAN_LIVE_SWEEP_ENABLED` is a clean control case** — confirmed absent from Railway
  `web`, code defaults `"0"` — showing the docs are not uniformly stale, just unevenly so.

## 3. Important claims weakened

- **Track A's real-vendor-evidence claim has no independently-inspectable raw artifact.**
  The only record of the actual TradingView session is a hand-transcribed JSON built from a
  `get_page_text` dump by the acting Claude session — not a saved screenshot, HAR, or DOM
  snapshot. Nothing on disk lets a third party confirm the browser genuinely reached real
  TradingView and read these exact numbers, independent of trusting that session's own
  narration. **This session attempted to remediate this gap directly** (reopened the same
  real TradingView account, re-added the oracle script, attempted a saved screenshot at
  `phase==24`) and **failed** — the browser tab entered a glitchy rendering state after
  several rapid indicator add/remove cycles (the oracle's own chart pane would not render
  data, showing empty `ø` cells in Table view, even after multiple full-page reloads and a
  fresh tab). The remediation attempt was abandoned rather than risk further disruption to
  the owner's real account; **the account itself was independently reverified fully intact
  and unaffected** both before and after the attempt. Track A's classification
  (VENDOR SEMANTICS CAPTURED, not PARITY VERIFIED) is correctly enforced by code regardless
  of this gap — `vendor_truth.py` cannot be tricked into claiming parity from these
  fixtures — but "closed, real vendor evidence" should be read as **credible, self-consistent,
  and internally cross-validated (two independent phase==24 rows agreed exactly), but not
  independently corroborated by a raw artifact.**
- **Track F's "numeric options" and "bar-displacement parameter" limitations are framed as
  bounded Track-F gaps but are actually general, pre-existing translator limitations** — no
  array-literal AST node type exists at all, and bar offsets must already reduce to a
  whole-number constant at translation time, independent of parameter editing. Expanding
  Track F to cover these would require general parser work first, not a small Track-F
  extension. This is a scope-understatement in the docs, not a false claim.
- **DEC-008's credential-separation requirement reads as conservative-by-design, not derived
  from a specific technical risk in this program's own architecture** — see §10.

## 4. Important claims disproven

- **The "28/48 after assisted edits" figure is confirmed FALSE, independently, by two
  separate audit threads** (test-credibility and benchmark-reproduction, run separately,
  same result): the real, current, freshly-reproduced number is **21/48** — identical to the
  pre-assisted-edit base rate. The assisted-edit mechanism currently recovers **zero**
  additional blind-corpus scripts. This was already known and tracked internally
  (`RISK_REGISTER.md` RISK-004), but any external-facing report citing "28/48" without this
  correction is stating a disproven number as current fact.
- **Track F's "14/14 translating Pine scripts in the 21-script corpus gained at least one
  adjustable parameter, 29 total adjustable parameters added" claim has no re-runnable
  artifact anywhere in the repo.** Extensive search (translator call patterns, script names,
  the exact figures) found nothing but the doc text itself. This was a one-time
  manual/ad-hoc comparison, reported as if it were a standing, re-verifiable result. It is
  **not disproven** (nothing found contradicts it) but it is **evidentially weaker than every
  other benchmark number in this program**, all of which reproduce automatically from a
  checked-in test.

## 5. Stale assumptions discovered

- **The screenshot-inference production door.** `docs/feature_flags.json` shows
  `INDICATOR_VISION_ENABLED` armed on `web` since **2026-09-02**, paid-gated, rate-limited
  (10/hour), cost-guarded via the shared catalyst budget, storing nothing until a member
  saves through the ordinary door. Track E's narrative throughout this program treated this
  as unstarted validation work blocked on a credential — it does not mention that the
  underlying feature has been live for paying members for days.
- **The plain-language production door — the more material of the two.** `/api/user-definitions/propose`
  (`api/routers/user_definitions.py`) is mounted unconditionally with **no feature flag at
  all**, gated only by `require_paid`. Any paid member has been able to reach real Anthropic
  model calls through this exact door since it was first mounted. Track E's narrative never
  surfaces this as "already live" — it is discussed purely as credential-blocked validation.
- **DEC-004 (Confluence naming/dead-code ruling) was ruled 2026-09-04 and never executed.**
  `api/services/signature/confluence.py` is still named `confluence.py`, registry key still
  `dpc-v1`. Track B's "all seven items fixed" list does not include RISK-001/RISK-002.
- **DEC-007's "named Vendor Parity Owner" role exists only as a phrase** in
  `DECISIONS.md`/`PHASE_ONE_PLAN.md`/`RISK_REGISTER.md` — no CODEOWNERS entry, no named
  person, no ownership artifact anywhere in the repo.

## 6. Blockers that were not real (technical) blockers

| Item | Real classification |
|---|---|
| Track E "no Anthropic access exists" (as sometimes implied by the framing, not the literal claim) | **NOT TRUE as framed** — access exists; what's missing is narrower: an approved *scoped dev/test* credential satisfying DEC-008, which is itself a self-imposed process gate, not a technical fact (see §10) |
| Track D's "isolated-worktree can't run the probe" | **TOOLING LIMITATION**, scoped specifically to the `isolation:"worktree"` Agent execution mode — confirmed not a property of this worktree directory itself |
| Track F "numeric options / bar-displacement unsupported" | **REAL, but the root cause is a general pre-existing parser limitation**, not a bounded Track-F-specific gap as currently documented |

Confirmed genuinely real, unchanged: vendor CSV export (TradingView Basic-plan paywall,
reproduced this session), `SCAN_LIVE_SWEEP_ENABLED` (real safety/policy decision, code- and
Railway-confirmed off), Track F's bool/string/source/timeframe/symbol/time/color exclusion
(confirmed by source: `PARAM_MANIFEST_ELIGIBLE_KINDS = {'input','int','float'}`).

## 7. Material production/documentation drift

Both instances found are the same subsystem, the AI import doors, both armed/mounted in the
same window this program's own Phase One tracking documents were being written — i.e., the
program's paper trail was behind the actual deployed state, not ahead of it or wrong about
it. Both are bounded (paid-gated, rate-or-cost-capped, store nothing until saved), so
"shipped" here does not mean "unsafe" — it means the risk posture and the Track E narrative
should have already reflected "this exists in production" rather than "this is blocked,
future work." No other material drift was found in this pass beyond these two and the two
unexecuted rulings in §5.

## 8. Test-credibility concerns

- **Confirmed non-vacuous, by direct mutation test:** the Pine blind-corpus judge (a
  hardcoded always-pass mutation was caught), `vendor_truth.py`'s MATCH/DELTA logic (a
  hardcoded always-MATCH mutation was caught), and `param_manifest.py`'s bounds
  enforcement (a silenced-check mutation was caught on two distinct tests, including the
  crafted-manifest defense).
- **Confirmed non-vacuous by inspection:** `test_indicator_telemetry.py`'s exactly one
  `monkeypatch` is a deliberate, narrow failure-injection test, not a blanket mock;
  `BuilderSheet.paramReopen.test.jsx` exercises the real component through real
  unmount/remount cycles.
- **Explicitly NOT independently audited this pass** (a real scope gap, not a clean bill of
  health): thinkScript tests, PCF tests, `ast_conformance.py`'s underlying fixture suite
  beyond the one known gap, JS/Python dual-kernel conformance beyond `--check`'s aggregate,
  screener tests beyond the two re-run files, and alert tests beyond
  `test_screener_screen_alerts.py`. Treat these as **unaudited**, not as **confirmed fine**.
- **This session's own new tooling** (`tools/track_a_ingest_vendor_capture.py`,
  `tools/track_d_risk003_probe.py`, `tools/track_e_run_golden_journey.py`) was reviewed by
  inspection (found honest about its own scope, no overreach) but was not independently
  mutation-tested by the audit threads — flagged for the same reason as the items above.

## 9. Security concerns

**None at CRITICAL or HIGH severity.** All seven planned checks passed: `.env` gitignored
and confirmed never committed in all three sibling repos; no real secret ever entered any
git history; no test file or this session's tooling prints a credential; browser-automation
artifacts contain only the one chart-data JSON this session wrote itself (no cookies/tokens,
no completed CSV download); Track A's observation files contain only chart/provenance data;
telemetry's allowlist is structurally enforced, not just documented; and model-input logging
is standard low-risk exception logging (exception objects only, never raw prompts/responses/keys).

## 10. DEC-008 recommendation

**Read `DECISIONS.md` DEC-008 fully before acting on this section — this is a decision
review, not an instruction to proceed.**

DEC-008's own stated reasoning is narrow: wait for RISK-016 (an unrelated shared-cap bug,
now fixed) before spending model calls on noisy results, and separately, "never use a
production key" — asserted independently with **no technical justification tied to
Anthropic's account architecture, a specific incident, or a named risk** anywhere in
`DECISIONS.md` or `RISK_REGISTER.md`. Reading `tests/test_golden_journey_04_05_live.py` in
full: it makes real outbound Anthropic API calls (not mocked), but runs entirely against an
in-process `TestClient(app)` with the repo-root `conftest.py`'s DB-path redirect forcing every
row into an isolated sandboxed database, uses only synthetic/hand-authored fixtures, is bounded
to exactly 6 model calls for a full run (independently counted, not just quoted from a doc),
each call is additionally capped by `MAX_TOKENS`, zero HTTP retries, a 10/hour rate limit with
a real 429, and a real, code-enforced spend ceiling (`cost_guard.may_member_spend()`) —
and never logs the key's value anywhere.

**No concrete technical risk was found** from running this specific test locally with the
existing production credential: no member-data exposure (synthetic fixtures, isolated DB), no
production-mutation path (never touches the real Railway `web` service or production DB), no
uncontrolled spend (a real ceiling exists, independent of this test's own 6-call bound), no
leak risk (never printed/logged). The only real cost of reusing the existing key is
**accounting commingling** — this test's ~6 calls would count against the same spend
dashboard as production traffic — a bookkeeping inconvenience, not a security or
data-integrity risk.

**Recommendation:** the evidence supports **Option B** (amend DEC-008 to permit this
specific, bounded, local-only test run with the existing credential) as a technically
defensible choice, since every risk axis DEC-008's own alternatives-considered section could
plausibly have been guarding against was checked here and came back clean. **Option A**
(create a separate key) remains the cleaner long-term hygiene practice — clean
cost/spend-accounting separation, standard "never reuse prod creds for tests" practice, and
costs one console visit — and is not wrong to prefer even though it is not technically
required by anything found in this audit. **This is the owner's call to make, not this
audit's to make for them** — the audit's job was to determine whether DEC-008 was a
technical necessity or a conservative process choice; it is the latter, and the owner should
decide A vs. B knowing that.

## 11. Corrected A–F status

- **Track A:** Tranche 1A capture stands, but downgrade "closed, real vendor evidence" to
  **closed, credible evidence, not independently corroborated by a raw artifact** (see §3).
  Tooling and classification logic are independently confirmed sound.
- **Track B:** COMPLETE — reconfirmed by fresh, non-mocked test re-runs.
- **Track C:** CLOSED — reconfirmed by fresh test re-runs and independent inspection of the
  allowlist mechanism.
- **Track D:** VERIFIED HEALTHY stands as a point-in-time result; the probe itself was
  correctly NOT re-run by this audit (would touch production, out of scope for a read-only
  pass) — this is a **carried-forward, not re-verified this pass** status, not a downgrade.
- **Track E:** status unchanged (blocked pending an owner decision on DEC-008 §10) — but the
  program's own narrative about it should be corrected to acknowledge the underlying doors
  are already live in production, independent of this program's formal validation.
- **Track F:** CLOSED FOR NARROW V1 stands for the shipped mechanism (mutation-tested,
  E2E-tested); the "14/14 scripts, 29 parameters" corpus claim should be labeled
  **unverified-as-stated** until it has a re-runnable artifact, and the "numeric
  options/bar-displacement" framing should be corrected per §3.

## 12. Confidence levels by subsystem (0–10 ladder; only where executable evidence justifies a level)

| Subsystem | Level | Basis |
|---|---|---|
| Pine translator (translation layer) | 5 — Adversarial | Blind-corpus + judge + this audit's own mutation test confirming the judge can fail |
| Pine translator vendor parity (as a correctness claim) | 0 — Exists (evidence-capture only) | 4 vendor-semantics-only observations, 0 parity-comparable; no UCT implementation to compare against |
| thinkScript / PCF translators | 2 — Integration | Corpus pass rate reproduced fresh; non-vacuity NOT independently tested this pass |
| Canonical AST / JS-Python dual-kernel | 2 — Integration (self-consistency only) | `--check` reproduces; explicitly not a correctness claim |
| `vendor_truth.py` tooling itself | 5 — Adversarial | Mutation-tested, confirmed fires on its own planted-disagreement control |
| Track F parameter-editing mechanism (int/float) | 5 — Adversarial | Real-component E2E test + 2 mutation-tested defenses |
| Track F corpus-impact claim (14/14, 29 params) | 0 — Exists (unverifiable as stated) | No re-runnable artifact found |
| Telemetry (Track C) schema enforcement | 5 — Adversarial | Parametrized nested-smuggling tests read and confirmed non-vacuous |
| Screenshot AI door (production) | 8 — Staging/production-like (as a running feature) / 0 (this program's own fixture-based validation) | Live, paid-gated, rate/cost-guarded in production since 2026-09-02; Track E's own Golden Journey #5 has not executed |
| Plain-language AI door (production) | 8 — Staging/production-like (as a running feature) / 0 (this program's own fixture-based validation) | Live, unconditionally mounted, `require_paid`-gated only; Track E's own Golden Journey #4 has not executed |
| Track D production scan health | 8 — Staging/production-like (single point-in-time read) | Real, read-only production DB read, not repeated/regression-tested |
| Screener / alert tests (beyond the two re-run this pass) | carried forward, unaudited | Not independently assessed this pass |

## 13. Is proceeding to Track E justified?

**Yes, contingent on the owner's DEC-008 decision (§10), not on this audit alone.** If the
owner selects Option B, Track E can proceed immediately using the existing credential in the
exact bounded form validated here (synthetic fixtures, in-process TestClient, existing
rate/cost caps, key never logged) — no separate credential purchase/creation needed. If the
owner prefers Option A, the original ANTHROPIC CREDENTIAL CREATION REQUIRED path from the
prior turn still stands. Either way, Track E's completion report should now also correct the
narrative drift found in §5 rather than continue presenting the AI doors as pure future work.

## 14. Should Review Packet #2 proceed afterward?

**Yes, after Track E completes and after this audit's material findings are folded in** —
specifically: the Track A raw-artifact caveat (§3), the corrected "21/48, not 28/48" figure
everywhere it might otherwise be quoted (§4), the Track F corpus-claim caveat (§4/§11), and
an explicit note that DEC-004 and DEC-007's ownership ruling remain unexecuted (§5). None of
these are severe enough to block Review Packet #2 outright; they need to be stated honestly
in it.

## 15. Any reason to pause broader development?

**No blanket pause is warranted** — the measured code/tests/production evidence held up
strongly under real adversarial pressure, including live mutation testing. **One standing
practice change is warranted**: before any future Review Packet or major status claim,
re-verify "blocked"/"future work" framing against actual current production/runtime state
(a `docs/feature_flags.json` diff-by-date check would have caught both drift instances in
§5 immediately) — narrative drift compounds silently otherwise, exactly as it did twice here
in the same subsystem.

---

## Appendix — evidence sources (this audit's own six research threads)

1. Capability inventory + narrative drift — full code/runtime inventory across all listed
   capabilities; found the two AI-door drift instances in §5.
2. Track A–F recheck + blocker audit — fresh test re-runs per track, found the Track A
   raw-artifact gap (§3) and the Track F scope-understatement (§3).
3. Test-credibility challenge — 3 live mutation tests (all reverted, `git status` confirmed
   clean at every checkpoint and at sign-off), found the confirmed-false 21/48 figure (§4).
4. Decision audit (DEC-001–011) — full classification table; the DEC-008 deep-dive is §10.
5. Benchmark reproduction — every JS-side number re-run fresh from current HEAD; found the
   Track F corpus-claim evidentiary gap (§4) and independently reconfirmed the 21/48 figure.
6. Security/secret-handling audit — 7-point checklist, no critical/high findings (§9).

Two threads (benchmark reproduction, security) were interrupted mid-task by a transient
server-side rate limit and resumed from where they left off; one thread (test-credibility)
left an in-progress mutation uncommitted when interrupted, which was caught via
`git status --porcelain`, reverted, and reconfirmed clean before that thread resumed and
completed its remaining planned mutation checks.
