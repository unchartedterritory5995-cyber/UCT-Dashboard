# PROGRAM STATUS

**Program day:** 1 CLOSED, Phase 2 CLOSED, Phase 3 CLOSED (technical validation + PRD/spec for the four LOCKED systems).
**Stage: BUILD PROGRAM** — declared by owner ruling 3 on 2026-09-11, and true in fact since 2026-09-02. Specification complete for four systems; **all four are implemented in whole or in part on `origin/master`, plus two application slices (A3/A4 and A5)** — see "Post-Phase-3 work" below. Program **idle since 2026-09-03**, awaiting the owner's read on the S3 gate and on the undocumented shipments.
**Last updated:** 2026-09-11 (control-file reconciliation; no new program work).
**Last verified against git:** `a31cacea1` (2026-09-03 07:04:50 -0500), branch `terminal-research`, in sync with `origin/terminal-research`.
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

⛔ **Superseded within hours of being written** — the checkpoint above describes the state at
2026-09-02 17:14. S8 and S11 were authorized and implemented that same evening and the following
morning. See "Post-Phase-3 work" below; everything from here to the end of this checkpoint is
historical.

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

## Post-Phase-3 work (2026-09-02 17:31 → 2026-09-03 07:19) — added by the 2026-09-11 reconciliation

Eight docs commits and five code commits landed after the Phase 3 close above, and **no control file
recorded any of them** until this reconciliation.

**Docs, on `terminal-research`:**
* `c46048ae6` — **Entity Master pre-implementation gate packet**, `12-decisions/gates/entity-master-pre-implementation-gate.md`, 564 lines. Status: final, presented, **awaiting explicit owner approval**.
* `a9837d71d` then `633691038` — **RG-33** filed and then corrected: the stale file is `cap_universe.json`, **not** `delisted_tickers_bulk.json`. The correction is the operative version.
* `8935b5092`, `99e7de3b5`, `f23530a8d`, `92296aa62`, `a31cacea1` — the **S8 readiness review and implementation records**, plus the **S11 implementation record** and one factual correction: NYSE's 2026 calendar has **3 July as a full closure, not an early close** (Independence Day observed); only 27 November and 24 December are real early closes. The shipped dataset uses the corrected calendar; the prose error was recorded rather than silently fixed.

## THE IMPLEMENTATION LEDGER — what this program has shipped to production

**Seventeen commits to `origin/master`, 2026-09-02 17:51 → 2026-09-03 15:07**, all from separate
implementation branches, never from this worktree. Thirteen of the seventeen were recorded in no
program document until the 2026-09-11 reconciliation; the re-scoped protection rail surfaced them on
its first run. ⛔ **This table is the manifest check (1b) validates against. A commit on a
program-owned path that is not listed here is a FAIL.**

| system | commits | what shipped | recorded before 09-11? |
|---|---|---|---|
| **S3** Entity Master | `3c762d25e` `8424b8be5` `195e8e24c` `114052d2d` `f1b75e270` `baaf28906` `53b99ad5a` | `api/services/entity_master/` **created from nothing** — canonical schema, read primitives, write path, seed script (**a real seed run was executed**, Checkpoint 4), provider mapping, reconciliation, adversarial validation at real scale. 2,395 insertions, 1,174 of them tests. Checkpoints run 1,2,3,4,5,7,8 — **no Checkpoint 6 exists in history; open question** | ❌ no |
| **D1** Provider Abstraction | `9d0b5eb26` | provenance/freshness hardening — vendor-entitlement distinction, stale detection, AI-consumable contract. ⚠️ **This is not the one-ACL-per-vendor boundary PRD-D1 specifies**; the adapter layer itself remains unbuilt, so D1 is PARTIAL, not done | ❌ no |
| **S8** Provenance & Freshness | `7adf80bd4` `834b45df4` `8d04bf75f` `03d399a52` `48bba9614` | the `provenance/` component family, the two provenance routers, `bar_provenance.py`, `ProvenanceDemo.jsx` at `/provenance-demo` | partly — 3 of 5 |
| **S11** Session & Market Clock | `e14a5836b` `1cf0bf028` | `app/src/lib/marketClock/`; `useMarketOpen.js` re-sourced; `sessionModel.js` holiday-aware | ✅ yes |
| **A3/A4** vertical slice | `408f04935` | `/research/:sym`'s Estimates + Financials mounted onto S3+D1+S8+S11. Verified NOT to touch Terminal-Current | ❌ no |
| **A5** Events & Calendar | `1214dc246` | modernization onto S3/D1/S8 — and it **modified TERMINAL-CURRENT**: `api/routers/calendar.py` (163 lines), `app/src/pages/Calendar.jsx`, `calendar/CalendarHeader.jsx`, `earningsModalRow.js`, three test files, plus a new 281-line `tests/test_calendar_a5_modernization.py` | ❌ no |

⛔⛔ **THE A5 COMMIT NEEDS THE OWNER'S READ.** `1214dc246` changed the surface this entire rail is
named after. It may well have been authorized in conversation the way S8's and S11's slices were —
but it is recorded nowhere, and the rail that exists to catch exactly this returned PASS three times.
Nothing further should be built on A5 until the owner confirms it was intended.

⛔ **Why the protection rail never noticed — and what changed.** The rail diffed *this worktree's*
application paths against the start SHA. This worktree receives only docs commits, so the diff was
empty **by construction** and PASS was guaranteed regardless of what the program shipped. **A green
protection rail proved this worktree shipped nothing; it never could prove the program shipped
nothing.** Per owner ruling 3 the rail now diffs `origin/master` over a program-owned path manifest,
and PASS is no longer "empty output" but "every commit returned is in the ledger above" — a build
program's rail cannot demand emptiness without failing on its own successful work. Full before/after
and the re-scoped commands: `protection-rail.md`.

**Deferred, recorded, not gaps:** S10 (Presentation Primitives) and the vendor-side entitlement
taxonomy (SPEC-S8 §17a) are both formally DEFERRED and neither blocks. S11 has **no PRD/spec
document** by deliberate judgement — its `product-architecture.md` system block was held sufficient
for a system that size.

## Codebase drift since these documents were written

The PRDs and specs describe a codebase as it stood on 2026-09-02. The (separate, now closed) UCT
Terminal convergence program has shipped to master continuously since. **Exactly one confirmed
overlap**, found by diffing master's history against every path this program owns:

* **Seam 7, `4c4e19ede` (2026-09-07)** edited S11's own `nyseCalendar.js` — added 2027 holiday data
  (the table had ~4 months of runway and degraded to "every weekday is a full trading day" once
  `COVERED_YEARS=[2026]` lapsed), and added `tests/test_nyse_calendar_parity.py` so a hand-edit to
  either calendar table fails CI instead of drifting. It explicitly preserved S11's bundled
  zero-latency design as deliberate architecture. **This is a strict improvement to S11 and requires
  no revision here** — but S11's own record must not be read as describing the current file.

No other master commit since 2026-09-03 has touched `app/src/components/provenance/`,
`app/src/lib/marketClock/`, the provenance routers, or `api/services/entity_master/`.

⚠️ **`S7` names two different things.** Here it is the **Alerts & Monitoring** system. In the
convergence program it is the **filing-watch** feature, live to members since 2026-09-11 12:07:29 ET.
Unrelated. (Checked: the alerts PRD and spec name `alert_fires` and never `user_alerts`, so they are
already consistent with the owner's 2026-09-08 ruling that the durable alert is `alert_fires`.)

## How the control files drifted (read before trusting them)

Between 2026-09-02 17:14 and 2026-09-03 07:19, thirteen commits landed across several branches' worth of
branches and not one touched `RESUME.md` or `SESSION_HANDOFF.md`. Those two files went on describing
"Day 1b, Wave 2 partially complete, seven tasks needing re-dispatch" for nine days, while all but one
of those tasks had been completed and accepted hours after they were written. A cold-start session
following the documented reading order would have re-dispatched seven finished research tasks and
believed no code had shipped. Both files now carry a "last verified against git" line; **if the
branch has moved past that SHA, reconcile before acting.**

Two blind spots that made this durable, both worth carrying forward: a docs commit that *records* an
implementation is not the implementation (the code was on branches this worktree cannot see, and only
`origin/master` confirms it), and an **untracked** file is invisible to every `git log` and every
diff — which is exactly how C2-02's 635-byte stub survived nine days looking like completed work.

## Next actions
1. **Owner decisions outstanding** (nothing below is decided by silence): sign-off on **S8's overall
   completion status**; explicit approval of the **Entity Master pre-implementation gate packet**;
   and the standing inputs OI-03(a)/(b), OI-06, OI-21 and D-003.
2. **Re-dispatch C2-02 (Events intelligence), full** — the single outstanding research task. Its
   destination file is still the original 635-byte stub and is untracked. Tier 2 per DL-020.
3. **Then the un-dispatched Wave-2 remainder** (`contracts/C-WAVE2.md`, `contracts/B-WAVE2.md`):
   domain pods C1-01/02, C2-03, C3-01/02, C4-02/03, C6-03, C8-01/02; the per-product verifiers and
   reconstructors; F-05 and F-07 once their inputs exist; `G-LIGHT-D2.md`. Batches of ≤10.
4. RG-32 (the Compass regime-vocabulary collision) is a real, live product inconsistency outside
   this program's scope — worth the owner's attention in a normal operations session regardless.
