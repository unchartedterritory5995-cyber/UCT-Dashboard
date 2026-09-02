# SESSION HANDOFF — Terminal-Next research program

**Written:** 2026-09-02, recovery checkpoint after the third session-limit pause of this session.
**Read this file FIRST in any new or resumed session**, before `RESUME.md`, before re-dispatching anything. It supersedes the "what is dispatched" section of `RESUME.md` as of this timestamp; `RESUME.md` still owns the standing hazards and the cold-start reading order.

---

## 1. Current program phase

**Program day 1, late Day 1b / early Wave 2.** Wave 1 (17 internal + licensing tasks) and Wave 1b (28 external benchmark tasks) are **fully dispatched and accepted**. Internal synthesis (system map, capability ledger, tech-debt register, provider ledger) is **accepted**. The licensing register (118 rows) and both cost models are **accepted**. Wave 2 (domain pods, pod syntheses, the forty executive questions, the hypothesis register) is **partially complete** — 9 of 16 dispatched Wave-2 tasks are accepted; 7 need re-dispatch after the third pause. **Program Day 1 has NOT formally closed**: the Day 1 executive synthesis (`DAY_1_EXECUTIVE_SYNTHESIS.md`, Document A's required Day-1 artifact) was never started.

## 2. Deadline health

**GREEN**, with a caveat. No Tier-1 critical-path confidence was lost by the pauses — everything that landed stayed landed. The caveat: three session-limit pauses in one session (see §12) mean the *effective* throughput of ~10-parallel premium-model dispatch is roughly 2–4 hours of useful work per ~5-hour rolling window, not continuous. The owner has directed a compute-tier policy change (DL-020, §13) to raise throughput per window by defaulting most Wave-2/3 work to Sonnet 5 High instead of Opus/Fable.

## 3. Repositories and worktrees involved

| Repo/worktree | Role | Status this session |
|---|---|---|
| `C:\Users\Patrick\uct-worktrees\terminal-research` | THE research worktree. Branch `terminal-research`, start SHA `9c3df14b9`, remote `origin/terminal-research`. All program artifacts live here. | Active. Latest commit `a3db65688` at last push; several commits made after that in this checkpoint (see §16 for the commit to look for). |
| `C:\Users\Patrick\uct-dashboard` | Dashboard repo, but the **stale parked checkout** — never used this program. | Not touched. |
| `C:\Users\Patrick\uct-intelligence` | Intelligence engine (trading KB, screener). Read-only for this program. | Read by D-03, D-13, D-14 (Wave 1). Not touched this checkpoint. |
| `C:\Users\Patrick\uct_intelligence` | Discord bot (RAG, slash commands). **Not under git.** Read-only. | Read by D-12, D-13, D-14. Not touched this checkpoint. |
| `C:\Users\Patrick\morning-wire` | Pre-market pipeline. Read-only. | Read by D-13, D-14. Not touched this checkpoint. |
| `C:\Users\Patrick\uct-sunday-scan` | Sunday scans. Read-only. | Read by D-14. Not touched this checkpoint. |
| `origin/master` (dashboard) | Production. **Never pushed to this program.** | Drifted from start SHA `9c3df14b9` to `dd57711f0` (54 commits, other sessions). Confirmed Terminal-Current itself untouched by the drift (see §17). |

## 4. Completed work (accepted, on disk, pushed)

### Wave 1 — internal archaeology + licensing (17/17 accepted)
D-01 front-end · D-02 backend · D-03 provider inventory (dashboard) · D-04 database/infra · D-05 performance/real-time · D-06 UI primitives · D-07 testing/reliability (found the vitest substring-filter fragility — rail tightened, DL-009) · D-08 coexistence mechanisms · D-09 Terminal-Current map · D-10 flags/entitlements (found the paywall inversion — DL-010) · D-11 state/persistence · D-12 existing AI systems · D-13 proprietary asset inventory · D-14 ecosystem cartography (found 34 scheduled tasks, 4 silently failing) · E-01 vendor terms · E-03 real-time/exchange rules (found unauthenticated endpoints, later confirmed — R-17) · E-04 derived-data rights.

### Wave 1b — external benchmark research (28/28 dispatched, 23 accepted, 5 need re-dispatch — see §5)
B-VAL-01 universe validator (added Unusual Whales, SpotGamma; merged TIKR/YCharts/CIQ to a light note — DL-017) · B-BBG-01..08 (all eight Bloomberg workflow files, accepted) · B-GDL-01 Gödel evidence · 11 leaf dossiers accepted (Unusual Whales, TradingView, Koyfin, Benzinga Pro, AlphaSense, Fiscal.ai, Quartr, FactSet, LSEG Workspace, SpotGamma, adjacent light note) · B-DESK-01..04 (thinkorswim, TradingView-desk-use, Finviz, Market Chameleon) · C4-01 command grammars.

### Internal synthesis (Group F, Wave 2 start)
E-02 data-use classification · F-03a system map + capability ledger (211 rows) + tech-debt register (72 entries) · F-03b provider ledger (48 rows) · F-04 licensing register (118 rows — completed via a completion re-dispatch after the *second* pause) · E-05 data/infra cost model · E-06 AI/infra cost model · C6-01 AI-native tools survey · C6-02 grounding/citation architectures · C5-01 workspace systems survey · C7-01 streaming/caching architectures · B-GDL-02 Gödel verification · B-GDL-03 Gödel ideas · **F-08 hypothesis register (35 hypotheses)** · **F-06 deliverable 1, `executive-questions.md` (all 40 questions answered, scoreboard, reallocation advice)**.

The last two (F-08 and F-06 deliverable 1) are the newest acceptances from THIS checkpoint — they survived the third pause and were QC'd for the first time just now.

### Orchestrator-only work
Program-control layer (14 control files + contracts), capability probe, coverage map, protection rail (now at R1), Railway variable/flag-state read (`02-data-providers/railway-flag-state.md`), two admin-endpoint reads, three read-only production HTTP verifications (confirmed R-17's unauthenticated endpoints).

**Full ledger with dispatch/return times and QC notes: `AGENT_REGISTRY.md` §5.**

## 5. Interrupted work — exact classification (Step 1/Step 6 of the recovery instructions)

Ten Wave-2 assignments were in flight when the third pause hit. Two of them (F-08, C6-02) turned out to have already finished writing — the 429 killed the agent's *process* after its file was already durable, which is why "an agent reported failure" does not mean "no output exists." Every classification below was verified by reading the actual file (bytes, section headers, tail content, truncation-marker scan), never by trusting the agent's own return trace.

| ID | Classification | Evidence | Disposition |
|---|---|---|---|
| **F-08** hypothesis register | ✅ **COMPLETED** | 82 KB, sections 1–5 + GAPS + NOT INSPECTED, 57 table rows, no truncation marker | **ACCEPTED this checkpoint.** No action. |
| **C6-02** grounding architectures | ✅ **COMPLETED** | 53 KB, 9 sections + GAPS + SOURCES, no truncation marker | **ACCEPTED this checkpoint.** No action. |
| **F-06 deliverable 1** (`executive-questions.md`) | ✅ **COMPLETED** | 93 KB, all 40 questions, scoreboard (10🟢/23🟡/7🔴), reallocation advice, GAPS, NOT INSPECTED, no truncation marker | **ACCEPTED this checkpoint.** No action. |
| **F-06 deliverable 2** (`DAY_1_EXECUTIVE_SYNTHESIS.md`) | ❌ **FAILED BEFORE USEFUL OUTPUT** (for this deliverable only) | File does not exist. The contract said "write deliverable 1 first" — it did, then was killed before starting deliverable 2. | **NEEDS RE-DISPATCH.** Scoped completion: inputs are now the accepted `executive-questions.md` plus the day's other accepted artifacts. Tier 3 (this IS the executive/Day-1 synthesis — the one place premium reasoning is still justified). |
| **B-POD-BBG** Bloomberg dossier synthesis | 🟡 **PARTIALLY COMPLETED, durable output exists** | 86.7 KB. Sections A–L are sound and complete (Reconciliations, Workflows, Data, Customization, Search, AI, UX, Performance, Pricing). An explicit `<!-- DOSSIER-CONTINUES: sections I–Q, addendum, GAPS, SOURCES, NOT INSPECTED follow -->` marker sits where M (best ideas), N (bad ideas/anti-patterns), O (evidence), P (confidence), Q (the twelve Part CCXLV questions), GAPS, SOURCES, NOT INSPECTED should be. (Note: I is actually present per headers — the marker text is slightly stale from an earlier draft state; trust the section list, not the marker's own claim of what's missing.) | **NEEDS RE-DISPATCH** as a completion run (same pattern used successfully after the second pause for F-04 and after the first pause for the licensing register). Tier 2 (Sonnet High) — this is compiling already-gathered evidence into the template, not new strategic judgment. |
| **C7-02** symbol master / time model | 🟡 **PARTIALLY COMPLETED, durable output exists** | 13 KB. §0 (headline, four claims) and §1 (UCT's internal baseline, INTERNAL evidence only — includes a real finding about a split-repair service) are substantive. No external-pattern section, no GAPS/SOURCES tail. | **NEEDS RE-DISPATCH** as a completion run keeping §0–1 verbatim. Tier 2. |
| **C5-02** personalization patterns | 🟡 **PARTIALLY COMPLETED, durable output exists** | 5 KB. §1 "Provisional pattern set (dossier-derived, pre-external)" and §2 "Anti-patterns (dossier-derived)" are real, internally-sourced content. GAPS section explicitly says "Draft. External research not yet performed." | **NEEDS RE-DISPATCH** as a completion run keeping §1–2 verbatim, adding external research. Tier 2. |
| **B-POD-GDL** Gödel dossier synthesis | ❌ **FAILED BEFORE USEFUL OUTPUT** | File does not exist. The agent's own return trace said "the two large leaves were persisted to files, I'll read both in full now" — it was killed mid-read, before writing anything. | **NEEDS RE-DISPATCH**, full. Contract already exists (`contracts/B-POD-GDL.md`) and all three inputs (01-evidence, 02-verification, 03-ideas) are already accepted — this is now a cheap, well-scoped task. Tier 2. |
| **C2-01** news architecture patterns | ❌ **FAILED BEFORE USEFUL OUTPUT** | File does not exist. Agent's return trace: "let me check the dossier source URLs so I can fetch primaries without searching" — killed before any writing began. | **NEEDS RE-DISPATCH**, full. Tier 2. |
| **C7-03** vendor abstraction / data platform | ❌ **FAILED BEFORE USEFUL OUTPUT** | File does not exist. Agent's return trace: "now I'll write the first version of the artifact so an interruption leaves something usable" — the intent was right, the timing wasn't; nothing landed. | **NEEDS RE-DISPATCH**, full. Tier 2. |
| **C2-02** events intelligence | ❌ **FAILED BEFORE USEFUL OUTPUT** | 635 bytes — frontmatter plus a single line "DRAFT — patterns section being written first, per contract. Do not read as final." No usable content; discard, do not complete-from. | **NEEDS RE-DISPATCH**, full (not a completion — the stub has nothing worth keeping). Tier 2. |

**Nothing was SUPERSEDED / no-longer-necessary.** All seven still-needed items remain decision-relevant and on the path to gate items 6–9 (competitive research) and 12 (executive synthesis). None can be answered by another already-completed agent's work — each covers a distinct topic or product.

**No new agents were dispatched during this checkpoint**, per the owner's explicit Step 8/Step 8 instruction in both recovery messages.

## 6. Decisions made (owner or provisional)

| ID | Decision | Status |
|---|---|---|
| D-001 | Desk-first, members second | Provisional, in force |
| D-002 | Licensing exposure of member-facing vendor data — proceed desk-first, classify member-facing raw vendor displays Restricted-pending-contract | Provisional, in force; quantified by F-04: Massive tier flips 38 register rows, FMP DDLA flips 19; Restricted falls 81→27 if both favorable |
| DL-017 | Benchmark universe: 11 leaf dossiers + Bloomberg + Gödel; Unusual Whales and SpotGamma added; TIKR/YCharts/CIQ merged light | Final for this program |
| DL-020 | Four-tier compute policy (this checkpoint) — see §13 | Governs all future dispatch |

**Full log with rationale: `DECISION_LOG.md` (DL-001 through DL-020).**

## 7. Decisions NOT yet made (owner-pending)

Nothing is formally escalated beyond D-001/D-002 (both already provisional and in force). The **highest-value unanswered owner question remains OI-03**: which Massive plan tier (Individual vs Business) and whether an FMP Data Display and Licensing Agreement exists — this single pair of facts moves 57 of 118 licensing-register rows. See `OWNER_INPUTS_REQUESTED.md` for the full batch (OI-01 through OI-20).

## 8. Hypotheses (from F-08, now accepted)

35 hypotheses (H1–H5 seed, H6–H35 evidence-raised) in `13-executive-synthesis/hypothesis-register.md`. Notable ones already trending: H3 (existing providers can support most of V1) is *partially supported* (desk half yes); H4 (proprietary intelligence as primary differentiator) is *partially supported*, grounded in D-13's measured counts. H1 and H5 (customizable workspaces, keyboard-first navigation) remain *unknown* — no UCT-specific evidence yet, only benchmark analogy.

## 9. Critical path

`CRITICAL_PATH.md` unchanged in substance by this pause — no Tier-1 item regressed. Seven of nine Tier-1 items sit at 🟡 (up from all-🔴 at the start of Wave 1). CP-03 (licensing classification above Unknown) remains 🔴 and is the one genuinely owner-input-bound item; it is now quantified (see §6). Gate B §27A (research → product decisions) is **NOT OPEN** but close: once F-06 deliverable 2 and the remaining domain pods land, the gate review becomes live.

## 10. Research gaps

28 items in `RESEARCH_GAPS.md` (RG-01 through RG-28). RG-28 (new, this checkpoint) is the umbrella entry for the seven re-dispatch items in §5. Most other gaps are owner-answerable (folded into `OWNER_INPUTS_REQUESTED.md`) or planned for a later wave — none block Day 1 closure except RG-28 itself.

## 11. Agent/workstream status summary

See `AGENT_REGISTRY.md` §5 for the complete dispatch ledger (every task, dispatch time, return time, tool-call/token count, ACCEPT/PARTIAL/KILLED verdict). §1 has the capability probe (measured concurrency: 10 safe). §2 has the (now superseded — see DL-020) old three-tier model-class table; §2's successor is the four-tier policy in `GOVERNING_PRINCIPLES.md` §8 and `DECISION_LOG.md` DL-020.

## 12. Provider / licensing state

Provider ledger (F-03b, accepted): 48 providers, 20 core, 7 retirement/consolidation candidates (Bullflow, Polygon-direct, Unusual Whales-as-a-provider, Finnhub, AlphaVantage, yfinance, ForexFactory), 9 dormant keyless lanes. **Zero rows are CONTRACT-ACTIVE** (owner-confirmed) — everything is KEY-PRESENT, CODE-REFERENCED, or OBSERVED-CALLED at best. Licensing register (F-04, accepted): 118 rows, 3 Allowed / 7 Likely Allowed / 81 Restricted / 18 Unknown / 8 Unsuitable. **Confirmed production finding**: `/api/live-prices`, `/api/snapshot/{sym}`, `/api/movers` answer with live data to an unauthenticated GET (R-17, verified with read-only browser-UA curl at 08:05 UTC). This is a real production exposure, not a research artifact — worth the owner's attention in a normal operations session.

## 13. Current product direction (emerging, not decided)

* Terminal-Next as a route inside the existing dashboard shell, reusing the `/charts` panel layer (react-grid-layout, four color link groups) and the existing AI platform (154-tool registry).
* The moat is decision provenance and first-party narrative (7,766 classified #tsdr messages, 19,050 wire_universe rows, 4,440 leadership theses, a 79-lesson curriculum), not raw data volume — UCT's largest tables (earnings, news) are commodity vendor data.
* The workspace question is trending toward fixed/hybrid over fully modular: C5-01 found six of seven observed cross-product workspace failure modes are *persistence* failures, and none of seven surveyed dock libraries ships a schema-version field — adopting a dock library would not solve UCT's already-unversioned `charts_workspace_layout` blob (R-13).
* AI cost: six proposed member-facing AI features would cost ~$2.8–3.6/member/month at scale, but production's existing per-user caps already sum to ~$650/member/month with no population cap on Compass chat (R-18) — any new member AI lane needs a population guard before shipping.

**None of this is a decision.** It is the direction the evidence is leaning, tracked formally in the hypothesis register (§8) and the forty executive questions (§4).

## 14. Current architecture direction (emerging, not decided)

* Real-time transport is largely settled by standards (HTTP/2 removes the historical SSE-connection-limit argument; UCT's existing pooling already collapses N panels to ~2 connections per browser) — the live architectural questions are elsewhere: Cloudflare does not edge-cache JSON by default, and `s-maxage` disables `stale-while-revalidate`, so a documented cache rule (`/api/flow/data`) cannot behave as designed (C7-01).
* AI grounding: benchmark products span a five-rung "cost to verify a claim" ladder from per-cell citations to nothing; UCT's existing AI platform sits closer to the strong end (structured tools, citations in some lanes) but is inconsistent across lanes (C6-01, C6-02).
* Symbol master / time model: UCT's internal baseline has a real, quiet failure mode around a split-repair service silently changing chart numbers (C7-02 §1) — worth a closer look independent of the terminal program.

## 15. Terminal/calendar safety status

**PASS, verified this checkpoint (protection rail R1).** All three checks:
1. Application-path diff empty (`git diff --stat 9c3df14b9 -- . ':(exclude)docs/terminal-research'` — zero output).
2. Frontend: 31/31 calendar test files green (`Test Files 31 passed (31)`). Backend: 374 passed, 0 failed.
3. Production: `/api/health` → 200, `status: ok`. `/calendar` → 200, SPA root present.

**Master drift note**: `origin/master` moved from the start SHA to `dd57711f0` (54 commits by other sessions since program start). The diff touches `api/services/journal_two/calendar.py` and its test — this is the **Journal 2.0 calendar tab**, a distinct feature per the system map, NOT the `/api/calendar/*` Terminal-Current router or any `app/src/pages/calendar/*` file. Confirmed by path; no Terminal-Current file appears in the 54-commit diff. Flagged for a quick independent double-check next session, purely because "calendar" naming two different features in this codebase is exactly the kind of thing that has caused confusion before (per project memory) — not because anything here looks wrong.

## 16. Implementation status

**Zero implementation has occurred.** This remains Phase Zero (research/discovery/synthesis) throughout. No application source has been touched by this program at any point (confirmed every checkpoint via the protection rail). No prototypes have been built.

## 17. Exact next actions (in order)

1. **Read this file, then `RESUME.md`, then `GOVERNING_PRINCIPLES.md`, then `CRITICAL_PATH.md`, then `AGENT_REGISTRY.md` §5** (the standard cold-start order, per `GOVERNING_PRINCIPLES.md` §4 and `RESUME.md`).
2. Dispatch the **recommended next wave** (§18 below) — 7 tasks, all pre-scoped, contracts either already on disk or trivially derived from the existing `C-WAVE2.md` / `B-POD-BBG.md` / `B-POD-GDL.md` / `F-06.md` contracts. Model tier per DL-020 (§13): Sonnet High for six, Fable High for the one Tier-3 item (F-06 deliverable 2).
3. QC each return exactly as done throughout this session: read the actual file (bytes, section headers, tail, truncation-marker scan) before logging ACCEPT — never trust an agent's self-reported success alone (this is precisely how F-08 and C6-02 were correctly recovered this checkpoint despite their agents reporting "failed").
4. When all seven land: write `DAY_1_EXECUTIVE_SYNTHESIS.md` is already covered by item 2 (it's one of the seven). Once it lands, formally advance the program-day counter to 2 in `PROGRAM_STATUS.md`.
5. Dispatch the remaining domain pods (C1-01, C1-02, C2-03, C3-01, C3-02, C4-02, C4-03, C6-03, C7-02[if not folded into the completion above], C8-01, C8-02 — see `C-WAVE2.md`) and the Wave-2 dossier verifiers/reconstructors (`B-WAVE2.md`, one -02 and one -03 per product, 11 products × 2 = 22 tasks) in Sonnet-tier batches of ≤10, per DL-020.
6. Once the capability matrix (F-05) and JTBD/workflow library (F-07) have their inputs, dispatch those.
7. Day 2 gate: light red team (`G-LIGHT-D2.md`, contract ready) once F-06/F-08 and the domain pods are in.

## 18. Recommended next wave (proposed — NOT dispatched; awaiting owner go-ahead)

| # | ID | Task | Model | Effort | Why this tier |
|---|---|---|---|---|---|
| 1 | F-06 (deliverable 2, scoped) | `DAY_1_EXECUTIVE_SYNTHESIS.md` only | **Fable 5.1 High** | Tier 3 | This is literally the Document A Day-1 executive synthesis — strategic surprise/opportunity framing that benefits from stronger reasoning |
| 2 | B-POD-BBG completion | Finish Bloomberg dossier §M–Q + addendum + GAPS + SOURCES | Sonnet 5 High | Tier 2 | Compiling already-gathered evidence into a template |
| 3 | B-POD-GDL | Gödel dossier synthesis, full | Sonnet 5 High | Tier 2 | Same — 3 accepted leaves already exist |
| 4 | C7-02 completion | Finish symbol master/time model | Sonnet 5 High | Tier 2 | Domain synthesis |
| 5 | C5-02 completion | Finish personalization patterns | Sonnet 5 High | Tier 2 | Domain synthesis |
| 6 | C2-01 | News architecture patterns, full | Sonnet 5 High | Tier 2 | Domain synthesis |
| 7 | C7-03 | Vendor abstraction/data platform, full | Sonnet 5 High | Tier 2 | Domain synthesis |
| — | C2-02 | Events intelligence, full (discard the 635-byte stub) | Sonnet 5 High | Tier 2 | Domain synthesis — could be batch 2 if concurrency is capped at 7 |

Seven concurrent tasks (one Fable, six Sonnet) is comfortably inside the measured-safe-10 concurrency and shifts premium-model exposure down sharply from the prior all-Opus/Fable Wave-2 pattern, directly implementing DL-020.

## 19. Work that should NOT be repeated

* Do **not** re-run D-01 through D-14, E-01/E-03/E-04 (Wave 1) — all 17 accepted, high confidence, no gaps that block anything.
* Do **not** re-run B-VAL-01, B-BBG-01..08, B-GDL-01, any of the 11 leaf dossiers, or B-DESK-01..04 — all accepted.
* Do **not** re-run F-03a, F-03b, F-04, E-02, E-05, E-06, C6-01, C6-02, C5-01, C7-01, B-GDL-02, B-GDL-03 — all accepted.
* Do **not** re-run F-08 or F-06 deliverable 1 — both COMPLETED this checkpoint, verified by file inspection, ACCEPT logged. Only F-06 deliverable 2 needs work.
* Do **not** discard the durable partials for B-POD-BBG, C7-02, or C5-02 — complete them, do not restart from zero.
* Do **not** treat the C2-02 635-byte stub as worth completing-from — it has no real content; a full re-dispatch is correct there specifically.
* Do **not** re-verify the protection rail beyond what R1 already shows unless application code changes (none has, and none will during Phase Zero) — re-run at the next natural checkpoint (end of Day 1, or before any wave that touches licensing/security conclusions).
* Do **not** re-read the full charter documents (Document A/B/C, OWNER_SEED_FACTS) inside every new agent's contract — they are already distilled into `GOVERNING_PRINCIPLES.md`; only the orchestrator needs the raw charter, and only when a requirement is genuinely in doubt.

## 20. Warnings for the next session

* **Session-limit pauses are now an expected, recurring event** (three this session; R-19). Every dispatch must instruct the agent to write its core artifact FIRST, before deep research continues, so a mid-flight kill still leaves something durable. This pattern already saved F-08, C6-02, F-06-deliverable-1, and three of the partials in §5 — it works.
* **Never trust an agent's own "return summary" as proof of completion** after a 429. Several agents in this batch reported "failed" or gave no return at all, yet their files were complete on disk (F-08, C6-02) — always inspect the actual file.
* **Bash heredocs with unicode characters (ö, em-dashes, etc.) inside a `<<'EOF'` block have failed twice this session** with `SyntaxError: unicode error`. Use the `Write` tool for any file containing non-ASCII characters, or a Python script file written via `Write` and executed via `Bash python <path>` for surgical string edits — never an inline Bash heredoc with those characters.
* **Do not conflate the two "calendars"** in this codebase: `/api/calendar/*` + `app/src/pages/calendar/*` is Terminal-Current (protected); `api/services/journal_two/calendar.py` is the Journal 2.0 calendar tab (an unrelated feature, not protected by this program's rail, and fine to appear in master drift).
* **`AGENT_REGISTRY.md` §5 is large and append-heavy.** When looking for a specific task's status, `grep -n "^| <ID> "` rather than reading the whole file.

## 21. Owner decisions pending

None beyond the standing D-001/D-002 (both provisional, in force). See §7.

## 22. Files the next session should read, in order

1. This file (`SESSION_HANDOFF.md`)
2. `RESUME.md`
3. `GOVERNING_PRINCIPLES.md` (now includes the DL-020 compute-tier policy in §8)
4. `CRITICAL_PATH.md`
5. `AGENT_REGISTRY.md` §5 (dispatch ledger) — grep for the specific IDs in §5 of this handoff if resuming re-dispatch
6. `MASTER_CHECKLIST.md` (freshly rewritten this checkpoint — trust it over any older memory of checklist state)
7. The seven contracts named in §18: `contracts/F-06.md`, `contracts/B-POD-BBG.md`, `contracts/B-POD-GDL.md`, `contracts/C-WAVE2.md` (§C7-02, §C5-02, §C2-01, §C7-03, §C2-02)

---

*This handoff is a snapshot. Update it at the next major checkpoint (Day 1 close, or the next session-limit pause) rather than trusting it indefinitely.*
