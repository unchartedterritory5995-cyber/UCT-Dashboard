# PATCH LEDGER — UCT TERMINAL PROMPT LIBRARY

Applied 2026-09-01 against the seven-prompt library:

| # | Prompt | Role | Status |
|---|---|---|---|
| 1 | Pre-flight audit instruction | audit session only | unchanged |
| 2 | Document A — one-week constraint | execution session, 1st | PATCHED → `02-A-one-week-constraint.md` |
| 3 | Document B — execution operating system | execution session, 2nd | PATCHED → `03-B-execution-operating-system.md` |
| 3.5 | Owner seed facts (new) | execution session, 3rd | NEW → `03b-OWNER_SEED_FACTS.md` |
| 4 | Document C — master directive | execution session, 4th | PATCHED → `04-C-master-directive.md` |
| 5 | Audit trigger | audit session only | unchanged |
| 6 | Execution command | execution session, 5th | PATCHED → `06-execution-command.md` |
| 7 | Approval | execution session, 7th (after memo review) | PATCHED → `07-approval.md` |

Every row below names the primary insertion and every other location in the library that the change had to agree with. "Secondary edit" means a sentence elsewhere was changed so the library does not contradict itself after the patch. Nothing was removed from the library except by explicit consolidation (P15), and that consolidation preserves every part title and every topic line.

---

## P1 — Persist the charter; program-day clock; RESUME.md

- **Primary:** B §3A (new).
- **Must agree with:** A "SEVEN-DAY OPERATING CADENCE" (Day N now defined as program day: secondary edit adds one sentence pointing at B §3A) · A "DAILY CHECKPOINTS" (RESUME.md added to the checkpoint list) · B §9 refresh order (RESUME.md placed first) · B §35 compaction list (RESUME.md and wave dispatch plan added) · B §36 "do not copy giant prompt content" (reworded: persist once under program control, never re-copy into research files) · B "YOUR FIRST ACTION" (Step Zero inserted as step 0) · C Part CLXXVIII Step 1 (now says "Step Zero per Document B first") · C Part CLXV (research directory) · Prompt 6 (Step Zero named first) · Prompt 7 (resume rule).
- **Checked against Prompt 1:** Category 4 asks for exactly this; no conflict.

## P2 — Hierarchy names Document A as Level 1; "extreme ownership" bounded

- **Primary:** B §0 Level 1 paragraph replaced.
- **Must agree with:** Prompt 1 Category 1 hierarchy (A → B → C) · C Part CLXXXI (secondary edit: final paragraph now cites B §0 and names what ownership may change and where it is logged) · A "APPROXIMATELY 100 AGENTS MEANS COVERAGE" (secondary edit for P9 keeps ownership consistent) · B §7 · Prompt 7 ("use your judgment on agent allocation" remains inside the bound).

## P3 — TERMINAL-CURRENT / TERMINAL-NEXT vocabulary

- **Primary:** B §5, first bullet of `GOVERNING_PRINCIPLES.md` contents.
- **Must agree with:** A opening constraint, A acceptance gate, A final standard (qualifiers added) · B §14 heading and body · C preamble "DO NOT DESTROY OR REPLACE" block · C Part XXXVII, XXXVIII, CXXII, CCXXXII (naming), CDLXVI, CDLXVII · Prompt 6 and 7 (qualifiers added) · Prompt 1 Category 13 (unchanged; consistent).
- **Rule applied:** the charter documents themselves now use the qualified terms at every place where the two products could be confused. Unqualified "UCT Terminal" remains only where it is the product brand in the abstract (e.g., the title of the master plan).

## P4 — File-mediated hierarchy; capped returns; capability probe

- **Primary:** B §8 body replaced.
- **Must agree with:** B §6 ("who receives the result" now means a file and a synthesis task) · B §7 (waves sized to the probe) · B §37 (RETURN SUMMARY cap) · A "PARALLELISM IS THE PRIMARY SCHEDULE COMPRESSION MECHANISM" (bullet "canonical output destinations" is now the file rule) · A "DO NOT WAIT FOR EVERY AGENT" ("replace it" = dispatch a new task) · C Part X ("Executive Product Council" realized as review tasks; Group A text edited) · C Part XI (reporting chain reworded: agents → pod file → pod synthesis task → council review task → orchestrator) · C Part CCL (owner sees milestone summaries; unchanged) · Prompt 6 (probe named).

## P5 — Branch policy; protection rail; prototype envelope

- **Primary:** B §14A (new).
- **Must agree with:** B §13 (secondary edit: last paragraph points at the envelope) · B §4 (artifacts on the research branch) · A "THE FINAL SEVEN-DAY STANDARD" prototype sentence (secondary edit: "within the prototype envelope, B §14A") · A acceptance gate (protection rail is gate item 25) · C Part CCVI (secondary edit: envelope pointer) · C Part CXX (baseline never on the production pod) · C Part CLXXVIII Step 12 (unchanged; consistent) · C Part CCIV code ownership (partner files) · Prompt 6 (branch and worktree named) · Prompt 7 (rail at every checkpoint).

## P6 — Agent contract: ID, KNOWN FACTS, TOOLS, BUDGET, SOURCE HANDLING, SECRETS, DO NOT

- **Primary:** B §37 block replaced.
- **Must agree with:** B §3 (external content) and C Part XII last line (both now say "and the SOURCE HANDLING clause is carried verbatim into every contract") · B §6 list of what each agent must know (aligned to the contract fields) · B §27 stopping rule (BUDGET makes it bind at the leaf) · B §33 confidence (EVIDENCE CEILING added) · C Part IV "secrets references" (secondary edit: names-only rule) · C Part CXCVIII (names-only) · C Part XI mandatory report structure (identical to OUTPUT STRUCTURE) · C Part CLXVIII confidence glyphs (identical) · Prompt 1 Category 7 list (superset).

## P7 — Multi-repository, two-machine scope

- **Primary:** C Part IIIA (new).
- **Must agree with:** B §12 internal stream (secondary edit: "across all repositories and both machines, per C Part IIIA") · C Part IV list ("scheduled jobs / cron jobs" now includes the local scheduler) · C Part V, VI, XXVI, CIX ("NOT INSPECTED" list required) · C Part CXVI–CXVII (evidence rule for production behavior) · A Day 1 "inspect repository structure" (secondary edit: "repositories") · A acceptance gate items 1–2 · Prompt 6 ("the repository" → "the repositories and out-of-repo infrastructure") · seed facts file (repo list lives there for the owner to correct).

## P8 — Evidence ceiling

- **Primary:** C Part XII end.
- **Must agree with:** C Part VIII, IX, CCXLV, CCLVII, CCLVIII (secondary edits: each now says "or record the evidence ceiling") · C Part LX Section P "Confidence" (ceiling listed) · C Part CXIII labels · A "do not conduct shallow research" (secondary edit: one sentence distinguishing shallow from ceiling-limited) · B §33 (ceiling) · Prompt 1 Category 8.

## P9 — Coverage map; rebalanced role model

- **Primary:** C Part X opening replaced; group headings retained with new counts.
- **Must agree with:** A "APPROXIMATELY 100 AGENTS MEANS COVERAGE" (secondary edit: "preserve the full role map" → "preserve the coverage map; fewer roles is acceptable") · B §7 (same wording change) · C Part VII (secondary edit: universe target "10 to 12 plus the desk's actual tools") · C Part CLXIII Deliverable 6 ("one dossier per product in the validated universe") · C Part CCLII duplicate work detection · C Part CLXXXV Q8 (desk tools) · C Part XCVII red-team gates (roles now exist) · C Part CCXXXIV, CCXL (challenger roles named) · Prompt 6 ("approximately 100-role research hierarchy" kept; coverage map named) · Prompt 7 (unchanged; "use your judgment on agent allocation" consistent).

## P10 — Owner-input channel; provider status vocabulary

- **Primary:** C Part CLXXX end.
- **Must agree with:** B §15 (secondary edit: status vocabulary named) · B §34 (secondary edit: pending decisions → `OWNER_DECISIONS.md`, thesis-change trigger from Prompt 7 added, spend threshold placeholder) · B §5 control files (two files added) · C Part VI ("already paid for but underutilized" distinctions map onto the vocabulary) · C Part XLI · C Part CCXLI owner memo · A "DAILY CHECKPOINTS" (owner-input batch listed for Day 1 and 3) · Prompt 6 (batching sentence) · Prompt 7 (interrupt conditions unchanged; the file is how they arrive).

## P11 — Canonical gate; readiness test

- **Primary:** A "END-OF-WEEK ACCEPTANCE GATE" replaced; the 26-item table itself now lives in B §49 (so the execution session does not depend on the audit file).
- **Must agree with:** A "THE FINAL SEVEN-DAY STANDARD" (kept as prose; secondary edit: "the gate in B §49 is the test") · B §47 (kept as the readiness questions; secondary edit: "each maps to a gate item") · B §48 readiness memo (unchanged) · C Part CCXLII (secondary edit: pointer to B §49) · C Part CLXIII 38 deliverables (secondary edit: each deliverable's home is a gate item's artifact path; list kept) · C Part CC 42 sections (unchanged; item 24) · Prompt 6 closing list (secondary edit: "per the gate in Document B §49") · Directory paths in the table use B §4's canonical tree (see S1).

## P12 — Day 1a / 1b split

- **Primary:** A Day 1 "Immediately:" list replaced.
- **Must agree with:** C Part CLXXIX ("then commence after the owner's proceed instruction": consistent, 1a is pre-approval) · C Part CLXXVIII Steps 1–4 (secondary edit: Step 3 and 4 reference 1a/1b) · B "YOUR FIRST ACTION" (ordered to match 1a) · A `DAY_1_EXECUTIVE_SYNTHESIS.md` (due end of 1b) · Prompt 6 ("produce the memo … " = end of 1a) · Prompt 7 (= start of 1b).

## P13 — Prompt 6 additions

- **Primary:** Prompt 6.
- **Must agree with:** B §3A, §14A, §37 · C Part CLXXIX memo contents (unchanged) · vocabulary (P3) · orchestration opt-in (environment rule).

## P14 — Prompt 7 additions

- **Primary:** Prompt 7.
- **Must agree with:** B §3A (resume), §14A (rail), B §34 (interrupt list identical to Prompt 7's; the thesis-change trigger now appears in both).

## P15 — Topic checklist consolidation (Parts CCCLXX–CDLXV)

- **Primary:** C appendix.
- **Preserved:** every part title from CCCLXX through CDLXV (96 parts) as one line each with its body condensed to the operative sentence; CDLXII's five-status parity list kept in full. Part numbers retained in the appendix for cross-reference. Parts CDLXVI–CDLXVIII remain as full parts after the appendix.
- **Must agree with:** C Part XIII taxonomy (appendix grouped under its 15 headings plus "Platform / Data / Ops" for items outside them) · B §24 capability matrix ("rows may become hundreds": the appendix seeds them) · P9 coverage map (every appendix line is a question that needs an owning role).

## P16 — Workspace null hypothesis

- **Primary:** C Part XXI end.
- **Must agree with:** C Part XXII, XXXII, LXXII ("fixed tab page may be inferior to a workspace": secondary edit adds "or superior; test both"), CCVII, CCCXL ("default may matter more than customization": consistent) · C Part CLXIX H1 · C Part CLXXXVI Tier S evidence rule · B §30 platform primitives.

## P17 — Executive questions as progressive synthesis

- **Primary:** C Part CLXXXV closing.
- **Must agree with:** A Day 2 objectives (secondary edit adds "first draft of the forty executive questions") · A checkpoints ("Decisions forming" now cites the questions' confidence drift) · B §25 status format (added line) · C Part CLXIX hypothesis register (same cadence) · C Part XCVIII synthesis process.

---

## Secondary consistency edits not tied to a single patch

- **S1 — One directory tree.** B §4's tree is canonical. C Part CLXV now says so and shows the same tree. The capability matrix and best-of-breed matrix live at `05-product-strategy/capability-matrix/`; benchmark dossiers at `03-competitive-research/<product>/`. Section 10 of the audit had mixed the two trees; the gate table in B §49 uses only B's.
- **S2 — First-action lists.** B "YOUR FIRST ACTION" is the authoritative sequence. A Day 1a/1b, C Part CLXXVIII, and Prompt 6 now point at it rather than restating a different order.
- **S3 — MVP sentence.** One sentence in A, B §32, C Part CV: "The smallest coherent version that proves the Terminal-Next thesis, meaning our own traders voluntarily prefer it for at least one meaningful daily workflow after reasonable onboarding."
- **S4 — Red team cadence.** A Day 5 heading kept; a sentence in A Day 2 and Day 3 adds the light passes; B §28 and C Part XCVII reference the same cadence.
- **S5 — Spec drafting starts Day 4.** A Day 4 gains "implementation-planning roles draft skeleton specifications for the two or three leading vertical-slice candidates"; Day 6 completes; Day 7 runs the readiness test.
- **S6 — Control files list.** B §5 now lists: GOVERNING_PRINCIPLES, RESUME, PROGRAM_STATUS, MASTER_CHECKLIST, AGENT_REGISTRY (incl. coverage map and probe results), CRITICAL_PATH, DECISION_LOG, OWNER_DECISIONS, OWNER_INPUTS_REQUESTED, OPEN_QUESTIONS, RISK_REGISTER, EVIDENCE_INDEX (generated), RESEARCH_GAPS, protection-rail, readiness-test. A's "program-control files" references this list.
- **S7 — Single-writer rule** added to B §38.
- **S8 — Research → product gate** added to B §26/§27 boundary and referenced from A Day 3.
- **S9 — Owner decision memo** is the single owner-facing summary (C Part CCXLI); C Deliverable 1 and 38 and Part CC §1 now say they point to it or summarize it in one page.
- **S10 — Prompt 1 and Prompt 5** unchanged. If the audit is ever rerun, Prompt 5 should name this ledger as prior art so the auditor does not re-derive it.

## Verification performed

- Every `[[control file]]` name used anywhere in the patched library appears in B §5's list.
- Every directory path used in the gate table appears in B §4's tree.
- Every one of the 96 consolidated part titles appears in the appendix (count checked by grep after writing).
- "preserve the full role map" no longer appears anywhere; "coverage map" appears in A, B, C, and Prompt 6.
- The MVP sentence is byte-identical in A, B, C.
- The interrupt/escalation list in B §34 and Prompt 7 contain the same items.

---

## Decisions applied 2026-09-02 (owner delegated the three open choices)

- **S11 — Delivery is read-from-disk.** Prompt 6 is now the only paste; it names the four files in this folder and orders them read in full. B §3A names the same source path and requires a byte-for-byte copy into the worktree charter directory. Must agree with: B §3A · B "YOUR FIRST ACTION" step 0 · A Day 1a first bullet · C Part CLXXVIII Step 0 · HOW_TO_RUN.md.
- **S12 — Seed facts §6 pre-filled as VERIFY / DEFAULT.** Every former blank now carries either a fact supported by prior project work (marked VERIFY) or an explicit default assumption the program proceeds on and lists in its first `OWNER_INPUTS_REQUESTED.md` batch. Must agree with: C Part CLXXX (batch mechanism and provider status vocabulary) · B §15, §16 (contract facts only from seed facts or an answered input) · B §34 (D-001 desk-first priority recorded as a pending decision) · C Part CCXVI asset classes · C Part X Group B desk-tools slots · C Part CCCVIII "the UCT way".
- **S13 — Escalation spend rule.** $250/month new recurring spend, any contract or signup regardless of amount, any cost that scales with member count regardless of amount. Must agree with: B §34 ("threshold set in OWNER_SEED_FACTS.md") · Prompt 7 first interrupt bullet · C Part XLII cost model · C Part CCXC (population-level reserve).
- **S14 — Last-pass gaps closed 2026-09-02.** Prompt 6 names the worktree location, the git commands, the starting directory, and that non-dashboard repositories are read-only. B §8 probe records the orchestrator's own model and context window and expects usage-limit pauses. B §14A rail names which check is proof (the diff) versus liveness, requires tests to run in the worktree against a local backend, and requires the exact commands and assertion to be pinned in `protection-rail.md` on Day 1a. HOW_TO_RUN.md gained a session-setup section (start directory, model, effort, permission mode, usage pauses). Must agree with: B §3A · A Day 1a · C Part IIIA (read-only repos) · seed facts §2 (stale checkout) and §3 (never production).
