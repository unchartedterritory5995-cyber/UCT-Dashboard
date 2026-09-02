# PROGRAM STATUS

**Program day:** 1 CLOSED, Phase 2 CLOSED, Phase 3 CLOSED (technical validation + PRD/spec for the four LOCKED systems). Implementation NOT authorized — awaiting owner decision on Phase 3's exit gate.
**Stage:** Specification. No implementation.
**Last updated:** 2026-09-02 (Phase 3 close, session 1)
**Deadline health:** GREEN — Day 1, the Readiness Review, Phase 2 (architecture), and Phase 3 (technical validation + 4 PRD/spec pairs) all completed, adversarially validated, corrected, and committed/pushed this session.

## Checkpoint (Document A format)

### Progress
Phase 2 closed per the prior checkpoint (Product/Information/Data architecture + F-09, adversarially
validated, six findings corrected). The owner re-anchored the program to its north-star objective (a
differentiated UCT Terminal built on UCT's existing product/data/AI estate, not a Bloomberg clone)
with an explicit anti-drift rule, then authorized Phase 3: narrow technical validation followed by
PRD + technical specification for the four architecturally LOCKED systems (Entity Master, Provider
Abstraction Layer, Provenance & Freshness, Alerts & Monitoring). Two technical-discovery tasks ran
first, both real codebase investigation, not guesswork: **D13** (which of UCT's two regime
classifiers is authoritative) resolved cleanly — `voice_regime_classifier` is the one live authority,
the engine's `market_regimes` table has a single dashboard reader with zero frontend callers — and
surfaced a genuine, currently-shipping, previously-unknown bug reported outside program scope (RG-32:
Compass can show two different "regime" words in one conversation). Three narrow RESEARCH_GAPS items
(RG-16, RG-24, RG-25) closed by direct grep/read investigation of the actual codebase. Then four
PRD+technical-spec pairs were produced, pipelined per system, each PRD required to open with an
explicit north-star traceability chain and each spec required to ground every reuse claim in the real
UCT codebase. An adversarial validator checked all eight documents against seven specific failure
modes and found two genuine issues (1 medium, 1 low); both corrected directly — a boundary-matrix
exception was named and time-boxed rather than left implicit, and an interim job was retroactively
authorized by its own PRD with a sunset condition. **No scope drift from the north star was found.**
Protection rail re-verified a third time this session: PASS, zero application-code touches despite
extensive codebase reading during technical discovery.

### Important discoveries
* D13 resolved: `voice_regime_classifier.get_current_regime()` is the single regime authority,
  wired into `grade_ticker`, the Awareness Engine's regime-flip rule, and `brain_service`. The
  engine's `market_regimes` table (`/api/risk-summary`) is dead code — zero frontend callers.
* **RG-32 (new, reported outside program scope):** a real, currently-shipping inconsistency —
  Journal 2.0's `journal_two/regime.py` buckets the Exposure Rating score under the label "regime"
  and Compass text chat shows it ambiently, while the same chat's `get_regime` tool returns a
  different, real 5-way market classification. A member can see two different regime words in one
  conversation today. Not a Terminal-Next task; flagged for a normal operations session.
* RG-24: the ticker-mentions backend is live and mounted; the frontend hook was written but has
  zero non-test importers anywhere — the intended UI was never wired.
* RG-25: UCT's SSE streams are confirmed gapless-reconnect-blind (no `id:` field anywhere in the
  `api/` tree) — live-verified. Edge caching is deliberately scoped: on for flow JSON/CSV (with
  documented incident history), off for SSE and mutating endpoints.
* Four architectural decisions are now LOCKED (from Phase 2) plus D13 (Phase 3) = 5 total; two new
  self-expiring exceptions (D14, D15) were named during spec validation rather than left implicit.

### Decisions forming
No new owner-facing product decisions this checkpoint — Phase 3 specified systems that were already
architecturally LOCKED, so no new escalations were needed. D14 and D15 (both self-expiring technical
exceptions tied to not-yet-built systems D2 and D5) are engineering-tracked, not owner-bound.

### Critical unknowns
None newly opened by Phase 3. CP-03 (licensing) remains 🔴 and owner-input-bound, unchanged.

### Blockers
None for further specification work on the four LOCKED systems — all eight documents (4 PRDs, 4
specs) are complete and validated. Implementation itself remains explicitly gated pending the
owner's decision on the Phase 3 exit report.

### Findings for a normal operations session (outside program scope)
* RG-32 (new, see above): Compass's ambient regime context and its `get_regime` tool disagree.
* Four PC-scheduled jobs failing silently: flow-corpus archive empty since 2026-08-09; breadth-live monitor 'could not check' 52 runs since 2026-08-10 (D-14).
* Catalyst cost guard mis-prices Sonnet 5 (D-12); five clause-vs-code licensing collisions (E-04); local-backend recipes run against live `C:\data` (D-04); three real-time endpoints CONFIRMED unauthenticated (`/api/live-prices`, `/api/snapshot/{sym}`, `/api/movers`; R-17).
* The owner's Anthropic subscription seat has TWO confirmed independent consumers producing public artifacts (`desk_insights_polish.py`, `daily_recap.py`) — ESC-17 widened by F-09.
* RG-24: the ticker-mentions frontend was never wired despite a live backend and a written hook.

### Agent allocation
Phase 3 complete; zero agents currently in flight. No further dispatch pending the owner's decision
on the Phase 3 exit gate (implementation vs. further specification vs. targeted revision).

### Protection rail
PASS (re-verified a third time this session, before and after Phase 3 work) — application diff
empty; production `/api/health` 200 and `/calendar` 200. See `protection-rail.md`.

### Deadline health
GREEN.

## Next actions
1. Deliver the Phase 3 exit report to the owner (the 12-point format requested) and stop — explicit
   implementation gate in effect; no application code changes without an explicit go-ahead.
2. On proceed: the owner's own exit-gate answer (GO/CONDITIONAL GO/NO-GO) determines whether
   implementation begins, further specification continues, or a targeted revision is needed first.
3. RG-32 (the Compass regime-vocabulary collision) is a real, live product inconsistency outside
   this program's scope — worth the owner's attention in a normal operations session regardless of
   the Phase 3 decision.
