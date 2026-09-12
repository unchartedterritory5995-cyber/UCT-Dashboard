# RESUME — cold-start entry point (Document B §3A)

**Last verified against git: `a31cacea1` (2026-09-03 07:04:50 -0500), branch `terminal-research`, in sync with `origin/terminal-research`. Reconciled 2026-09-11.**

Read in this order: this file -> `PROGRAM_STATUS.md` -> `GOVERNING_PRINCIPLES.md` -> `CRITICAL_PATH.md` -> `OWNER_DECISIONS.md` -> `AGENT_REGISTRY.md` §5 -> the charter in `charter/` if any requirement is in doubt.

⛔ **`SESSION_HANDOFF.md` is now a HISTORICAL artifact** (the 2026-09-02 11:57 recovery checkpoint). It is preserved as a record, not as a state description, and its §5 and §16 are superseded here. Do not act from it.

## Where we are

* **Program day:** 1 **CLOSED**. **Phase 2 CLOSED** (product/IA/data architecture + F-09, adversarially validated). **Phase 3 CLOSED** (technical validation + PRD/spec for the four LOCKED systems).
* **Stage: BUILD PROGRAM** (owner ruling 3, 2026-09-11 — declared, not discovered: it had been one since 2026-09-02). Specification complete for four systems; **all four are implemented in whole or in part on `origin/master`, plus two application slices** (see "Implementation status" below). The program is **idle**, awaiting the owner's read on the S3 gate and on what shipped undocumented.
* **Worktree:** `C:\Users\Patrick\uct-worktrees\terminal-research`, branch `terminal-research`, start SHA `9c3df14b9`. Never push master from here. Push this branch to `origin/terminal-research` at checkpoints.
* **Orchestrator:** the only committer. Commit with `git add docs/terminal-research` (scoped; never `-A`).

## What exists (verified against git, not asserted)

**Research — Day 1 closed.** Wave 1 (17/17 internal + licensing), Wave 1b (28/28 external benchmark), the internal synthesis group (system map, capability ledger, tech-debt register, provider ledger F-03b, licensing register F-04, both cost models), `executive-questions.md` (all 40), `hypothesis-register.md` (35), and `DAY_1_EXECUTIVE_SYNTHESIS.md` (90 KB, accepted after an independent fact-check pass that found and corrected two genuine drifts). Closed at `7652adabf`; readiness review at `714c05779`.

**Phase 2 — architecture, closed at `92e9c0a8e`.** `product-architecture.md` (32-system decomposition: 12 platform S-systems, 5 data-platform D-systems, 14 applications, 1 intelligence layer), `information-architecture.md`, `data-architecture.md`, `capability-infrastructure-matrix.md`, `provider-master-ledger.md` (F-09), `ARCHITECTURAL_DECISION_REGISTER.md`, and `13-executive-synthesis/PHASE_2_INTEGRATION_SYNTHESIS.md` (the CONDITIONAL GO that authorized Phase 3).

**Phase 3 — PRD/spec pairs, closed at `e9e7a71f7`.** Four complete pairs, no truncation, for the four systems the decision register had LOCKED:

| system | PRD | spec | document status |
|---|---|---|---|
| **S3** Entity Master | `05-product-strategy/prds/entity-master-prd.md` | `07-technical-architecture/specs/entity-master-spec.md` | draft — awaiting review |
| **D1** Provider Abstraction | `prds/provider-abstraction-prd.md` | `specs/provider-abstraction-spec.md` | draft — awaiting review |
| **S8** Provenance & Freshness | `prds/provenance-freshness-prd.md` | `specs/provenance-freshness-spec.md` | **IMPLEMENTED** — awaiting owner sign-off |
| **S7** Alerts & Monitoring | `prds/alerts-monitoring-prd.md` | `specs/alerts-monitoring-spec.md` | draft — awaiting review |

**After Phase 3 close** (the eight docs commits the old control files never recorded): the Entity Master pre-implementation gate packet (`12-decisions/gates/entity-master-pre-implementation-gate.md`, 564 lines, `c46048ae6`, final and awaiting explicit owner approval); RG-33 filed and then corrected (`a9837d71d`, `633691038` — `cap_universe.json` is the stale file, **not** `delisted_tickers_bulk.json`); and the S8/S11 implementation records (`8935b5092`, `99e7de3b5`, `f23530a8d`, `92296aa62`, `a31cacea1`).

## Implementation status

⛔ **Implementation HAS occurred, and it is on `origin/master`.** Any statement that this program has touched no application code — including `SESSION_HANDOFF.md` §16 — is false as of 2026-09-02 evening. The code landed on separate implementation branches (never from this worktree) and is now an ancestor of `origin/master`:

**Seventeen commits, 2026-09-02 17:51 → 09-03 15:07.** Found by the re-scoped rail on 2026-09-11; the first eleven and the last two were unknown to every program document until then.

| system | commits | what shipped |
|---|---|---|
| **S3** Entity Master | `3c762d25e` `8424b8be5` `195e8e24c` `114052d2d` `f1b75e270` `baaf28906` `53b99ad5a` | `api/services/entity_master/` created from nothing — canonical schema, read primitives, write path, seed script **(a real seed run was executed)**, provider mapping, reconciliation, adversarial validation at scale. 2,395 insertions, 1,174 of them tests |
| **D1** Provider Abstraction | `9d0b5eb26` | provenance/freshness hardening — entitlement distinction, stale detection, AI-consumable contract. ⚠️ **Not the one-ACL-per-vendor boundary** the PRD specifies; that is still unbuilt |
| **S8** Provenance & Freshness | `7adf80bd4` `834b45df4` `8d04bf75f` `03d399a52` `48bba9614` | `app/src/components/provenance/` (Provenance, FreshnessBadge, CoverageLine, Cited, freshnessContract, availabilityContract, sessionStale + tests), `api/routers/provenance_quote.py`, `provenance_bar.py`, `api/services/bar_provenance.py`, `ProvenanceDemo.jsx` at `/provenance-demo` |
| **S11** Session & Market Clock | `e14a5836b` `1cf0bf028` | `app/src/lib/marketClock/{marketClock,nyseCalendar}.js`; `useMarketOpen.js` re-sourced; `sessionModel.js` `nextOpenHint()` skips holidays |
| **A3/A4** vertical slice | `408f04935` | `/research/:sym`'s Estimates + Financials mounted onto S3+D1+S8+S11. Does **not** touch Terminal-Current |
| **A5** Events & Calendar | `1214dc246` | ⛔ **modified TERMINAL-CURRENT** — `api/routers/calendar.py` (163 lines), `app/src/pages/Calendar.jsx`, `calendar/CalendarHeader.jsx`, `earningsModalRow.js` + tests, plus `tests/test_calendar_a5_modernization.py` (281 lines, new) |

**S11 has no PRD/spec document** — deliberately. Its `product-architecture.md` system block was judged sufficient for a system that size; that judgement is recorded in `provenance-freshness-prd.md` §12.4 and is not a gap to be silently filled.

⛔⛔ **CORRECTION, 2026-09-11 — S3 was BUILT BY THIS PROGRAM, not adopted.** An earlier reading of
this file said `api/services/entity_master/` was "pre-existing UCT infrastructure the program
adopted." **That is false.** The path **did not exist at the start SHA** (`git ls-tree 9c3df14b9 --
api/services/entity_master` returns nothing); it was created by `3c762d25e` on 2026-09-02 17:51:55
and built out across Checkpoints 1–8 (no Checkpoint 6 exists — open question), 2,395 insertions
including 1,174 lines of tests. The misreading came from `provenance-freshness-spec.md` §8a calling
Entity Master "already shipped" — written at ~23:00 that night, it meant *shipped five hours ago by
us*, and was read as *predates us*. ⭐ **"Already shipped" names a state, never an author. Ask git
who wrote it.**

⚠️ **The full implementation ledger is in `PROGRAM_STATUS.md`** and includes two things no program
document recorded until this reconciliation: the **A3/A4 vertical slice** (`408f04935`) and the
**A5 Events & Calendar modernization** (`1214dc246`) — the latter having modified **Terminal-Current
itself**. Read that section before planning any build work.

## What is blocked

Nothing is blocked on research. Two things are waiting on the owner:

1. **S8's overall completion status** — the PRD/spec frontmatter both read "awaiting owner sign-off." S10 (Presentation Primitives) and the vendor-side entitlement taxonomy (SPEC-S8 §17a) are formally DEFERRED, neither blocking.
2. **The Entity Master pre-implementation gate packet** — final, presented, awaiting explicit approval.

Standing owner inputs remain open and undecided by silence: OI-03(a)/(b) (Massive tier / FMP DDLA — moves 57 licensing-register rows), OI-06 (one observed desk morning — the highest-leverage input remaining), OI-08/OI-18, OI-21, and D-003 (decisiveness for two audiences).

## Where to pick up

1. **Do not re-dispatch the Wave-2 recovery list.** It is closed. Of the eight items `SESSION_HANDOFF.md` §5 classified as needing re-dispatch (that file says "seven" in §1 and §5's prose while its own table lists eight), **seven are DONE and accepted** — F-06 deliverable 2, B-POD-BBG, C7-02, C5-02, B-POD-GDL, C2-01, C7-03 — all QC'd file-by-file in `AGENT_REGISTRY.md`.
2. ✅ **C2-02 (Events intelligence) is DONE** — re-dispatched and accepted 2026-09-11 (`82d084b43`), 47,658 bytes, QC'd by reading the file. **RG-28 closes with it.** There is no outstanding research task.
3. ⛔ **THE REST OF DAY-1 RESEARCH IS PARKED — owner ruling 5, 2026-09-11. Do not dispatch it as a wave.** Pull an individual pod **on demand, only when a specific system's spec needs it**, and say in the dispatch which spec and which question. The full parked list, recorded so nothing is lost:

   | contract | tasks |
   |---|---|
   | `contracts/C-WAVE2.md` | **C1-01, C1-02** · **C2-03** (alerts & notifications — the one most likely to be pulled, for S7 Alerts) · **C3-01, C3-02** · **C4-02, C4-03** (C4-03 global search / entity resolution — likely for S2, which is itself parked on OI-06) · **C6-03** · **C8-01, C8-02**. *(C2-01, C2-02, C5-02, C6-01, C6-02, C7-02, C7-03 are already accepted.)* |
   | `contracts/B-WAVE2.md` | the per-product **`B-<P>-02` workflow reconstructors** and **`B-<P>-03` verifiers**, one pair per benchmark product (11 products → 22 tasks) |
   | `contracts/G-LIGHT-D2.md` | **G-01-D2** Product Skeptic light red-team pass (Fable; destination `12-decisions/red-team/day2-benchmark-product.md`) |
   | not yet contracted | **F-05** cross-product capability matrix · **F-07** JTBD / workflow library — both need their inputs first |

   ⭐ **Why parked and not cancelled:** Day 1 closed, and Phase 2 and Phase 3 both completed without any of it. The evidence base was sufficient to lock four decisions and specify four systems, so the marginal research value is now lower than the cost of running 20–30 agents. That judgement is reversible — the contracts are on disk and each is independently dispatchable.
4. **QC every return by reading the actual file** — bytes, section headers, tail, truncation-marker scan — never an agent's self-report. This is how F-08 and C6-02 were correctly recovered after their agents reported failure, and how B-POD-BBG's premature failure call was caught and corrected (`68d0f4990`).
5. ⛔ **When scanning a file for a literal marker, strip prose first.** A truncation-marker scan of `provenance-freshness-spec.md` on 2026-09-11 returned two hits, both false: the field name `truncated` inside a documented data shape, and a line-range note. An instrument that matches prose reports a property of itself.
6. Run the protection rail (`protection-rail.md`) at every checkpoint and update `PROGRAM_STATUS.md`, this file, `CRITICAL_PATH.md`, `OWNER_DECISIONS.md`.

## How this drifted (read before trusting any control file)

Between 2026-09-02 17:14 and 2026-09-03 07:04, eight docs commits landed on this branch — the Entity Master gate packet, two RG-33 commits, four S8 records and the S11 record — and **not one of them touched a control file.** In the same window, application code for S8 and S11 shipped to `origin/master` from separate branches, which this worktree's history cannot see at all. `RESUME.md` and `SESSION_HANDOFF.md` were last written at 11:57 that morning and went on describing "Day 1b, Wave 2 partially complete, seven tasks needing re-dispatch" for nine days, while every one of those tasks but C2-02 had in fact been completed and accepted hours later.

A cold-start session reading `RESUME.md` first, exactly as instructed, would therefore have re-dispatched seven finished research tasks and believed no code had shipped.

⛔ **So: check git before trusting these files.** This document carries a "Last verified against git" line at the top; if the branch has moved past that SHA, reconcile before acting. Two specific blind spots, both real here: a docs commit that records implementation is not the implementation (the code lives on other branches, and only `origin/master` can confirm it), and an **untracked** file is invisible to every `git log` — C2-02's stub survived nine days precisely because nothing ever committed it.

## Standing hazards

Vocabulary TERMINAL-CURRENT / TERMINAL-NEXT everywhere. Engine/bot/wire/scans read-only. Never the stale `uct-dashboard` checkout. Never run anything on the production pod. Port 8077 is a stale local backend. `C:\data` is real; never override conftest pins. Partner files untouched. Usage-limit pause = normal; on resume, follow this file.

⚠️ **Two ID collisions in this program's own vocabulary — both live, both load-bearing:**
1. **A bare `Dn` means the SYSTEM. A decision is always `DEC-nn`.** Renamed 2026-09-11 by owner ruling: the decision register's ids are now `DEC-01`–`DEC-15`, and so are the Readiness Review §7 items that seeded them. `PHASE_2_INTEGRATION_SYNTHESIS.md` §10 locks "D3 Entity Master, D4 Provider Abstraction, D6 Provenance, D7 Alerts" in the OLD spelling — read those as **DEC-03 / DEC-04 / DEC-06 / DEC-07**; the systems they lock are **S3, D1, S8, S7**. The token was carrying up to five meanings (decision · data-platform system · capability-ledger row · benchmark-universe row · Readiness-Review item), two of them inside one table row in `information-architecture.md`. **In-prose references were deliberately NOT mass-renamed** — a rule-based pass mislabelled ~10% against hand-checking. Each document's decision references are corrected when that document is re-verified. Mapping and rationale: the register's rename note.
2. ⛔ **`S7` NAMES TWO UNRELATED THINGS — and this program's writing rule for it (owner ruling, 2026-09-11).**
   - In **this** program, S7 is the **Alerts & Monitoring** platform system. **Always write it "S7 Alerts", never a bare "S7."**
   - In the (now closed) UCT Terminal **convergence** program, "S7" is the **filing-watch** feature — live to members since 2026-09-11 12:07:29 ET, durable alert row `alert_fires`. **Always call that one "filing watch", never "S7."**
   - The two are unrelated and neither is a rename of the other. ✅ Checked 2026-09-11: `alerts-monitoring-spec.md` names `alert_fires` 12 times and `user_alerts` **zero** times, so S7 Alerts is already consistent with the convergence program's 2026-09-08 owner ruling that the durable alert is `alert_fires`, never a `user_alerts` row. That consistency is luck plus good grounding, not a designed handshake — re-check it when S7 Alerts is authorized.

⚠️ **The codebase has moved since these documents were written.** Terminal-Next must not assume a pre-convergence codebase — see `PROGRAM_STATUS.md`'s reconciliation section for the one confirmed overlap (Seam 7's 2026-09-07 edit to S11's `nyseCalendar.js`).
