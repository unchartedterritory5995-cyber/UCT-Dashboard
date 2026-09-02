---
id: MEMO-D1A
title: Orientation and planning memo (Document C Part CLXXIX)
role: Program orchestrator
wave: 1
group: A
category: synthesis
scope: program
confidence: 🟢
evidence_ceiling: none
sources: charter/, AGENT_REGISTRY.md, protection-rail.md, CRITICAL_PATH.md, OWNER_INPUTS_REQUESTED.md
uct_relevance: high
status: draft
date: 2026-09-02
---

# ORIENTATION MEMO — Terminal-Next research program, Day 1a

Delivered before external research (Day 1b). External benchmark research launches only on the owner's proceed instruction.

## 1. Interpretation of the mission

UCT commissions a seven-program-day research, discovery, synthesis, product-strategy, architecture, and implementation-readiness program for TERMINAL-NEXT: a purpose-built financial intelligence workstation for UCT's own trading desk first and its members second, grounded in the ecosystem that already exists (dashboard, engine, bot, wire, scans, chart renderer, the PC-scheduled pipeline, Discord/Substack/YouTube/R2) and in what professional terminals actually do at the workflow level. The output is not code. It is implementation-ready conviction: a master plan, an engineering backlog, and a first vertical slice that another Claude Code implementation team can start without rediscovering the strategy, proven by the 26-item gate in Document B §49 including an executed protection rail and an executed readiness test.

TERMINAL-CURRENT, the `/calendar` surface display-named "UCT Terminal", is studied, mapped, and preserved. Terminal-Next coexists with it; any later migration is a separate owner decision supported by parity, superiority, validation, readiness, and rollback.

The five questions the program answers (Document C Part II): what the best terminals look like at the workflow level; which of those capabilities matter for UCT's users; what UCT can build that no one else can because of its proprietary intelligence and workflows; how to architect a long-lived platform on the real codebase; and the safest sequence to build alongside Terminal-Current.

## 2. Major constraints in force

* **Preserve Terminal-Current.** Protection rail at every checkpoint; R0 PASSED on Day 1a (application paths unchanged; 390 frontend and 317 backend calendar tests green in the research worktree; production `/calendar` renders header, week strip, and roster line).
* **Deploy-on-push.** Nothing is pushed to master during Phase Zero. All artifacts live on `terminal-research` (pushed to `origin/terminal-research` at checkpoints). The stale `uct-dashboard` checkout is never used.
* **Audit before recommending.** Providers get a status (KEY-PRESENT → CODE-REFERENCED → OBSERVED-CALLED → CONTRACT-ACTIVE); no new vendor is proposed without the ten questions in Document B §15.
* **Licensing is architecture.** Contract facts come only from the owner; public terms support at most "Likely Allowed". Every member-facing data use is classified before it enters Tier S/A.
* **No premature coding.** Prototypes only inside the envelope (own worktree, flag-off, no shell/routing/schema/partner files, ≤1 agent-day, disposition logged).
* **Professional workflows first**, with the trader persona applied to every interface decision; members served through progressive disclosure, not by diluting the desk product (D-001 provisional).
* **Seven program days, rigor intact.** Program days advance on objectives, not the calendar. Deadline health is reported each checkpoint. YELLOW is answered with parallelism and reallocation, never with a lower evidence bar; evidence ceilings are recorded, not inferred over.
* **Environment hazards honored:** nothing runs on the production pod; port 8077 is a stale backend; `C:\data` is real and pinned away by the suite; partner-owned files are untouched; member AI traffic never uses the owner's Claude seat.

## 3. Agent organization, capability probe, and concurrency

**Capability probe (recorded in `AGENT_REGISTRY.md` §1).** Orchestrator: Fable 5.1 with a 1M-token context at xhigh effort. Delegated agents can run as Haiku 4.5, Sonnet 5, Opus 5 (1M), or Fable 5.1; they have shell, file, WebSearch, WebFetch, and the Chrome browser MCP. Ten tasks dispatched simultaneously all completed cleanly in 2 min 13 s; that is the measured concurrency. Wave 1 is being run as a measured step-up to 17 in flight (logged in `DECISION_LOG.md` DL-008); if failures appear, the working ceiling returns to 10 with top-up on completion. Delegated-agent tokens are not charged against the orchestrator's session budget; the binding constraint is the subscription seat's usage window, which may pause a wave (RESUME.md is the continuation mechanism). Rough program estimate: ~120 delegated tasks × ~0.5M tokens.

**Model classes (DL-003).** Opus 5 for leaf-depth (internal archaeology, licensing, Bloomberg workflow roles, dossier authors, domain pods); Sonnet 5 for leaf-breadth (verifiers, workflow reconstructors, evidence collectors); Fable 5.1 for synthesis, council, red team, planning, and architecture proposals.

**Coverage map (`AGENT_REGISTRY.md` §3).** Eight groups, ~105 distinct roles, ~140 role-slots, every Document C part and appendix line assigned to one owning role:

| Group | Roles | When |
|---|---|---|
| A Executive Product Council | 6 review tasks (director/architect, CEO, CPO, trading+PM, market data/quant/UX, security/licensing/reliability) | checkpoints |
| B Competitive research | Bloomberg ×8 by workflow; Gödel ×3; 11 products × (author, workflow reconstructor, verifier); desk tools ×4; universe validator; pod syntheses | Day 1b onward |
| C Domain pods | 8 pods, 21 roles (fundamental, news/events/alerts, charting/market viz, search/command, workspace/personalization incl. the fixed/modular/hybrid author, AI, data platform, member/commercial) | Days 1b–3 |
| D Internal system team | 14 archaeology roles (front end, backend, providers, DB/infra, performance/real-time, UI primitives, testing/observability, coexistence, Terminal-Current specialist, flags/entitlements, state/persistence, AI systems, proprietary inventory, multi-repo cartographer + scheduler) | Day 1a (running) |
| E Licensing and cost | vendor terms, data-use classifier, real-time/exchange, derived data, two cost models | Day 1a–2 |
| F Synthesis | 9 single-writer tasks for the canonical artifacts (system map, capability ledger, provider ledger, licensing register, capability matrix, executive questions, JTBD/workflows, hypothesis register) | as inputs land |
| G Red team | 6 skeptics; light Day 2 and 3, heavy Day 5, final Day 7 | gates |
| ARCH + H | 8 competing architecture/spec authors (three target architectures A/B/C); 8 implementation-planning roles incl. the readiness tester | Days 4–7 |

Hierarchy is file-mediated: leaf → pod synthesis → council review → orchestrator; leaves return ≤150 words; canonical artifacts have a single writer. Contracts are persisted at `00-program-control/contracts/` with a shared preamble carrying the evidence standard, the vocabulary, and the verbatim SOURCE HANDLING / SECRETS / DO NOT clauses.

## 4. Research sequence — parallel and dependent

* **Now (Day 1a, no approval needed, all read-only):** 17 internal and licensing tasks in flight — D-01..D-14 and E-01/E-03/E-04.
* **Day 1b (on approval), parallel:** universe validator; Bloomberg ×8; Gödel evidence collector; 11 dossier authors; desk tools ×3; C4-01 command grammars, C5-01 workspace systems survey, C7-01 streaming/caching; E-02 data-use classifier once E-01 lands. Three batches. First pod syntheses and the Day 1 executive synthesis at the end of Day 1b.
* **Dependent chains:** provider ledger (F-03b) needs D-03 + D-14; licensing register (F-04) needs E-01..E-04 + owner inputs; capability matrix (F-05) needs pod dossiers + capability ledger; fixed/modular/hybrid (C5-03) needs D-06 + D-11 + C5-01/02 + Bloomberg workspace file; architecture proposals (ARCH) need everything above; backlog (H-03) needs the first slice; readiness test needs the master plan and backlog.
* **Day 2:** targeted depth (verifiers, reconstructors, Gödel verification, domain pods), internal synthesis, the first draft of the forty executive questions with confidence tags, hypothesis register, light red team on benchmarks.
* **Day 3:** workflow/JTBD synthesis, capability and best-of-breed matrices, proprietary-advantage inventory, council review, gate into product decisions (B §27A), owner batch 2.
* **Day 4:** three competing target architectures plus data/AI/security/real-time/IA specs; skeleton slices.
* **Day 5:** heavy red team; tiers, MVP, first slice, dependency graph, coexistence.
* **Day 6:** backlog, code-impact map, tests, rollout/rollback, specs.
* **Day 7:** validation, final red team, readiness test, owner decision memo, master plan, protection rail.

## 5. Deliverables mapped to the gate

`MASTER_CHECKLIST.md` maps all 38 Part CLXIII deliverables plus the gate-only artifacts to their §49 item and path. In progress today: Terminal-Current map (item 1), system map inputs (2), capability ledger inputs (3), provider ledger inputs (4), licensing evidence (5), proprietary raw inventory (11), coexistence mechanisms (16). Protection rail (25) PASS at R0. Everything else NOT STARTED by design until its inputs exist.

## 6. Artifact locations

Canonical tree `docs/terminal-research/00-program-control/` … `13-executive-synthesis/` (Document B §4) in worktree `C:\Users\Patrick\uct-worktrees\terminal-research`, branch `terminal-research`, start SHA `9c3df14b9` (origin/master re-verified unchanged on 2026-09-02), charter commit `a4ef6f240`, control-layer commit `dcedd9fc8` pushed to `origin/terminal-research`. Charter files byte-identical to the source prompts (verified). `RESUME.md` is the cold-start entry point. `EVIDENCE_INDEX.md` is generated from frontmatter by `00-program-control/scripts/build_evidence_index.py`.

## 7. Decision gates

* **Research → product decisions (B §27A):** opens when every Tier-1 item in `CRITICAL_PATH.md` is 🟡 or better, or explicitly owner-input / unknowable-this-week. Target: end of Day 3. Recorded in `DECISION_LOG.md`.
* **Tier S eligibility of any workspace primitive:** only after the fixed / modular / hybrid comparison is a written, red-teamed deliverable (Parts XXI, CCVII).
* **Product decisions → implementation planning:** after the Day 5 heavy red-team pass and the council's verdict on architecture and roadmap.
* **Program complete:** items 25 and 26 executed and passed; items 1–24 MET or MET WITH BOUNDED UNKNOWNS; nothing NOT MET.
* **Owner escalations (B §34):** logged in `OWNER_DECISIONS.md`; work proceeds provisionally on the recommendation. One pending: D-001 desk-first.

## 8. Critical path (initial)

Twelve items in `CRITICAL_PATH.md`; the Tier-1 set: (CP-01) what exactly Terminal-Current is and what users would lose; (CP-02) which providers we license and actually call; (CP-03) whether member-facing display, storage, derived use, and AI processing of FMP/Massive/Finviz/news data can be classified above Unknown — owner-input-bound; (CP-04) whether the existing `/charts` workspace and `charts_workspace_layout` constitute a reusable workspace primitive; (CP-05) the real-time and load envelope of the single-replica web pod; (CP-06) the desk's real daily workflows and external tools; (CP-07) which proprietary assets have the volume and quality to differentiate; (CP-08) whether flags/entitlements can support a dark, per-user beta; (CP-10) what AI grounding infrastructure exists and what member-facing AI the cost doctrine permits. All 🔴 pending Wave 1; each names its closing evidence.

Day 1a discoveries already reshaping the map: the PC runs ~36 UCT scheduled tasks, not ~10; the dashboard names at least 17 external providers by env variable; a customizable widget workspace and four charting libraries already exist; the Discord bot repository is not under git; an unauthenticated GET of `/api/calendar/week` returns the SPA shell; the production calendar under the owner's saved scope shows "0 reporting · 145 hidden", so it is heavily personalized.

## 9. Owner inputs requested — batch 1

Filed in `OWNER_INPUTS_REQUESTED.md` with defaults; nothing blocks on them. OI-01 member count and tier mix · OI-02 dogfooder headcount and roles · OI-03 contract terms for FMP, Massive, Finviz (redistribution, storage, derived, AI; Massive plan tier) · OI-04 which providers are contractually active and which lapsed · OI-05 asset classes · OI-06 tools the desk opens daily, ranked · OI-07 = D-001 desk-first vs member-first · OI-08 benchmark evidence access (Bloomberg, LSEG, FactSet, Capital IQ, Koyfin, TradingView, thinkorswim; a practitioner walkthrough) · OI-09 real-time entitlement (non-professional attestation, OPRA/CTA/UTP fees) · OI-10 current monthly spend baseline and AI ceiling · OI-11 naming constraints during coexistence.

**Requested action:** review this memo and send the proceed instruction (`07-approval.md`) to launch Day 1b external research. Answers to batch 1 can arrive any time; defaults are in force.
