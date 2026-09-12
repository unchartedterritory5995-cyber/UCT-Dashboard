# RESUME — cold-start entry point (Document B §3A)

**Last verified against git: `a31cacea1` (2026-09-03 07:04:50 -0500), branch `terminal-research`, in sync with `origin/terminal-research`. Reconciled 2026-09-11.**

Read in this order: this file -> `PROGRAM_STATUS.md` -> `GOVERNING_PRINCIPLES.md` -> `CRITICAL_PATH.md` -> `OWNER_DECISIONS.md` -> `AGENT_REGISTRY.md` §5 -> the charter in `charter/` if any requirement is in doubt.

⛔ **`SESSION_HANDOFF.md` is now a HISTORICAL artifact** (the 2026-09-02 11:57 recovery checkpoint). It is preserved as a record, not as a state description, and its §5 and §16 are superseded here. Do not act from it.

## Where we are

* **Program day:** 1 **CLOSED**. **Phase 2 CLOSED** (product/IA/data architecture + F-09, adversarially validated). **Phase 3 CLOSED** (technical validation + PRD/spec for the four LOCKED systems).
* **Stage:** specification complete for four systems; **two of them have been IMPLEMENTED and are live on `origin/master`** (see "Implementation status" below). The program is **idle**, awaiting the owner's sign-off on S8's completion status.
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

**After Phase 3 close** (the five commits the old control files never recorded): the Entity Master pre-implementation gate packet (`12-decisions/gates/entity-master-pre-implementation-gate.md`, 564 lines, `c46048ae6`, final and awaiting explicit owner approval); RG-33 filed and then corrected (`a9837d71d`, `633691038` — `cap_universe.json` is the stale file, **not** `delisted_tickers_bulk.json`); and the S8/S11 implementation records (`8935b5092`, `99e7de3b5`, `f23530a8d`, `92296aa62`, `a31cacea1`).

## Implementation status

⛔ **Implementation HAS occurred, and it is on `origin/master`.** Any statement that this program has touched no application code — including `SESSION_HANDOFF.md` §16 — is false as of 2026-09-02 evening. The code landed on separate implementation branches (never from this worktree) and is now an ancestor of `origin/master`:

| system | commits | what shipped |
|---|---|---|
| **S8** Provenance & Freshness | `7adf80bd4`, `8d04bf75f`, `48bba9614` | `app/src/components/provenance/` (Provenance, FreshnessBadge, CoverageLine, Cited, freshnessContract, availabilityContract, sessionStale + tests), `api/routers/provenance_quote.py`, `api/routers/provenance_bar.py`, `api/services/bar_provenance.py`, `app/src/pages/ProvenanceDemo.jsx` at `/provenance-demo` |
| **S11** Session & Market Clock | `e14a5836b`, `1cf0bf028` | `app/src/lib/marketClock/{marketClock,nyseCalendar}.js`; `useMarketOpen.js` re-sourced; `sessionModel.js` `nextOpenHint()` upgraded to skip holidays |

**S11 has no PRD/spec document** — deliberately. Its `product-architecture.md` system block was judged sufficient for a system that size; that judgement is recorded in `provenance-freshness-prd.md` §12.4 and is not a gap to be silently filled.

**S3 Entity Master (`api/services/entity_master/`) is pre-existing UCT infrastructure the program adopted, not something this program built** — `provenance-freshness-spec.md` §8a confirms it satisfies what the architecture calls S3.

## What is blocked

Nothing is blocked on research. Two things are waiting on the owner:

1. **S8's overall completion status** — the PRD/spec frontmatter both read "awaiting owner sign-off." S10 (Presentation Primitives) and the vendor-side entitlement taxonomy (SPEC-S8 §17a) are formally DEFERRED, neither blocking.
2. **The Entity Master pre-implementation gate packet** — final, presented, awaiting explicit approval.

Standing owner inputs remain open and undecided by silence: OI-03(a)/(b) (Massive tier / FMP DDLA — moves 57 licensing-register rows), OI-06 (one observed desk morning — the highest-leverage input remaining), OI-08/OI-18, OI-21, and D-003 (decisiveness for two audiences).

## Where to pick up

1. **Do not re-dispatch the Wave-2 recovery list.** It is closed. Of the eight items `SESSION_HANDOFF.md` §5 classified as needing re-dispatch (that file says "seven" in §1 and §5's prose while its own table lists eight), **seven are DONE and accepted** — F-06 deliverable 2, B-POD-BBG, C7-02, C5-02, B-POD-GDL, C2-01, C7-03 — all QC'd file-by-file in `AGENT_REGISTRY.md`.
2. **One research task remains outstanding: C2-02 (Events intelligence).** Its destination file `05-product-strategy/domain-events-intelligence.md` is still the original 635-byte stub (frontmatter + "DRAFT — patterns section being written first"), and it is **untracked** — it has never been committed, which is why no commit records it. It was the one member of the recovery list left out of the six-worker recovery wave `wf_ff0deab0-60a`. Re-dispatch it **full**, not as a completion; the stub is discarded, not built from. Tier 2 (Sonnet High) per DL-020.
3. **Then the un-dispatched Wave-2 remainder** (`contracts/C-WAVE2.md`, `contracts/B-WAVE2.md`): domain pods C1-01/02, C2-03, C3-01/02, C4-02/03, C6-03, C8-01/02; the dossier verifiers/reconstructors (one -02 and one -03 per product); F-05 (capability matrix) and F-07 (JTBD/workflow library) once their inputs exist; `G-LIGHT-D2.md` light red team. Batches of ≤10, Sonnet tier per DL-020.
4. **QC every return by reading the actual file** — bytes, section headers, tail, truncation-marker scan — never an agent's self-report. This is how F-08 and C6-02 were correctly recovered after their agents reported failure, and how B-POD-BBG's premature failure call was caught and corrected (`68d0f4990`).
5. ⛔ **When scanning a file for a literal marker, strip prose first.** A truncation-marker scan of `provenance-freshness-spec.md` on 2026-09-11 returned two hits, both false: the field name `truncated` inside a documented data shape, and a line-range note. An instrument that matches prose reports a property of itself.
6. Run the protection rail (`protection-rail.md`) at every checkpoint and update `PROGRAM_STATUS.md`, this file, `CRITICAL_PATH.md`, `OWNER_DECISIONS.md`.

## How this drifted (read before trusting any control file)

Between 2026-09-02 17:14 and 2026-09-03 07:04, five commits landed — the Entity Master gate packet, two RG-33 commits, and the S8/S11 implementation records — and **not one of them touched a control file.** In the same window, application code for S8 and S11 shipped to `origin/master` from separate branches, which this worktree's history cannot see at all. `RESUME.md` and `SESSION_HANDOFF.md` were last written at 11:57 that morning and went on describing "Day 1b, Wave 2 partially complete, seven tasks needing re-dispatch" for nine days, while every one of those tasks but C2-02 had in fact been completed and accepted hours later.

A cold-start session reading `RESUME.md` first, exactly as instructed, would therefore have re-dispatched seven finished research tasks and believed no code had shipped.

⛔ **So: check git before trusting these files.** This document carries a "Last verified against git" line at the top; if the branch has moved past that SHA, reconcile before acting. Two specific blind spots, both real here: a docs commit that records implementation is not the implementation (the code lives on other branches, and only `origin/master` can confirm it), and an **untracked** file is invisible to every `git log` — C2-02's stub survived nine days precisely because nothing ever committed it.

## Standing hazards

Vocabulary TERMINAL-CURRENT / TERMINAL-NEXT everywhere. Engine/bot/wire/scans read-only. Never the stale `uct-dashboard` checkout. Never run anything on the production pod. Port 8077 is a stale local backend. `C:\data` is real; never override conftest pins. Partner files untouched. Usage-limit pause = normal; on resume, follow this file.

⚠️ **Two ID collisions in this program's own vocabulary — both live, both load-bearing:**
1. **`D3`/`D4`/`D6`/`D7` name both decisions and systems.** `PHASE_2_INTEGRATION_SYNTHESIS.md` §10 locks "D3 Entity Master, D4 Provider Abstraction, D6 Provenance, D7 Alerts" — those are **decision-register** ids. The **systems** with those ids are D3 Realtime Streaming and D4 Caching & Serving. The systems locked by those decisions are S3, D1, S8 and S7. Always say which register you mean.
2. **`S7` means two different things across programs.** Here it is the **Alerts & Monitoring** system. In the (now closed) UCT Terminal convergence program, "S7" is the **filing-watch** feature that went live to members 2026-09-11 12:07:29 ET. They are unrelated.

⚠️ **The codebase has moved since these documents were written.** Terminal-Next must not assume a pre-convergence codebase — see `PROGRAM_STATUS.md`'s reconciliation section for the one confirmed overlap (Seam 7's 2026-09-07 edit to S11's `nyseCalendar.js`).
