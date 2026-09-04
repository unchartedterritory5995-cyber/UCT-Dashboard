# Decision Records — Universal Custom Indicator + Screener Ecosystem

Format per master-prompt §77: Decision / Context / Evidence / Alternatives / Why chosen / Risks /
Migration impact / Reversibility / Tests needed / Date. Append-only; never edit a shipped entry's
substance — add a new entry that supersedes it and link back.

---

## DEC-001 — Program scope: extend the existing Indicator Platform program, do not reset it

**Decision:** The 7/31-approved Indicator Platform architecture, its shipped Phase A (signature
indicators + signal ledger), and ongoing Pine/thinkScript translation work are the baseline for this
program. Extend and harden them. Do not perform a full reset. Do not reopen a previously-settled
decision merely because the master prompt raises the topic as an option.

**Context:** Phase Zero orientation (2026-09-04) discovered a mature, active, owner-approved program
already running in exactly the space the master prompt describes — one the master prompt's own framing
(§6 "Discovery Before Build", §88 "map the existing ecosystem") did not appear to assume was this far
along. Continuing as if this were a blank slate risked redundant rediscovery at best and disrupting a
near-ship-date, in-flight effort at worst.

**Evidence:**
- `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` — approved roadmap, 4 research
  reports + 5-seat panel review.
- `docs/superpowers/plans/2026-07-31-phase-a-signature-launch.md` — Phase A implementation plan.
- `api/services/signature/{rules,darkpool_levels,flow_breakout,gex_walls,ledger,sweep,confluence,registry_defs}.py`
  and `api/routers/signature.py` — present on `origin/master` (verified via `git ls-tree origin/master`,
  2026-09-04). `confluence.py` and `registry_defs.py` are not described in the Phase A plan text Claude
  read — the implementation grew beyond its own spec.
- `origin/master` commit log includes active, recent Pine/thinkScript/pattern-engine work: e.g.
  `feat(pine): a run-length counter is a bounded question, so bound it`,
  `ruling(bbw/percentrank/median): three names researched, three refused, reasons kept`,
  `thinkscript: Inertia is a linear regression, at zero new vocabulary`,
  `Segment G6: the member's grammar reference, generated from the manifest`.
- `C:\Users\Patrick\uct-worktrees\indicator-endzone` — worktree directory modified 2026-09-04 08:17,
  hours before this Phase Zero session started.
- Numerous other live/recent worktrees touching adjacent systems: `phase-b1-foundations`,
  `phase-b2-engine`, `candle-library`, `screener-deep-work`, `patterns-retire`, `live-scan-retire`.

**Alternatives considered:**
- Full reset — treat the master prompt as authoritative over the 7/31 doc, re-evaluate every prior
  decision including already-shipped direction.
- Case-by-case — no blanket policy; bring every concrete tension to the owner individually as found.

**Why chosen:** Explicit owner ruling, 2026-09-04 (verbatim in `00-MASTER-PROMPT.md` §3). Rationale
given: the 7/31 program represents real, working, already-valuable product infrastructure; the master
prompt's ambition is additive to it, not a replacement mandate.

**Risks:** "Preserve unless new evidence" could be applied too conservatively and under-invest in
genuinely valuable new directions the master prompt raises. Mitigated by: (a) the owner's own 8-point
establishment list below, which is mandatory regardless of this decision; (b) an explicit conflict
policy (see DEC-001 "conflict policy" note) that still allows individual decisions to be reopened on
real evidence and routed to owner/ChatGPT review.

**Conflict policy (owner-specified, applies to all future decisions in this program):**
1. Prior decision + no new contrary evidence → preserve it.
2. Prior decision + master prompt merely raises an option → do not reopen automatically.
3. Prior decision + new measurable evidence creates a genuine tension → document the evidence, route to
   owner/ChatGPT review (Bucket C). Do not resolve unilaterally.
4. Current implementation differs from the old approved spec → treat current code/runtime behavior as
   evidence, determine *why* it diverged, and do not automatically "correct" it back to the document.

**Migration impact:** None directly — this is a scope/process decision, not a code change.

**Reversibility:** Fully reversible at any time by the owner; per-decision reopenings are explicitly
permitted under the conflict policy above.

**Tests needed:** N/A directly. The owner's 8-point establishment list (tracked in `PROGRESS.md`)
functions as the verification plan for whether this baseline is accurately understood.

**Date:** 2026-09-04

---

## DEC-002 — Preserve "no standalone user-facing scripting language as a product"

**Decision:** The 7/31-approved decision to kill a standalone user-facing scripting language as a
product stands. Master-prompt §15 ("First-Class Native Creation" — evaluate a native UCT DSL among
options A–G) is downgraded from a directive to a RESEARCH/HYPOTHESIS item. The internal canonical
grammar/IR (used by the compiler/execution kernel) is a distinct concept from a user-facing authoring
language and is **not** affected by this decision — it may still grow in whatever way genuinely serves
Pine/thinkScript/TC2000 translation, static analysis, and execution.

**Context:** Master-prompt §14–15 describes five import doors (Pine, thinkScript, TC2000, plain
language, screenshot) plus an open research question about whether UCT should also offer a native
authoring DSL. The 7/31 doc had already explicitly settled the authoring-surface question in the
negative, in favor of versioned declarative "definitions" + a curated library + a later no-code builder
(Phase D) + an AI concierge (NL → definition, subsuming what a scripting tier would have done).

**Evidence:**
- `2026-07-31-indicator-platform-design.md` §0: *"A standalone user-facing scripting language is
  **killed** as a product; its sandbox survives as plumbing for AI-generated definitions."*
- Same doc §11 (adjudicated decisions log): *"Scripting tier (P3) | **Killed as product**; sandbox = AI
  plumbing only; revisit 2027 on demand | Trader + CEO; TV marketplace war settled; solo-owner
  security/support tax."*

**Alternatives considered:** Reopen and evaluate a native DSL now, per master-prompt §15's option list
(A: native DSL, B: Pine-like mode, C: thinkScript-like mode, D: multiple compatibility modes, E: visual
builder, F: plain-language-first, G: hybrid).

**Why chosen:** Explicit owner ruling, 2026-09-04. The owner reframed the actual objective: *"Give users
a powerful first-class way to create custom indicators/scanners inside UCT while allowing them to use
languages and mental models they already know — Pine, thinkScript, TC2000-style formulas, plain
English, screenshots/recreation, and whatever canonical internal representation UCT needs underneath."*
That objective does not require a new proprietary authoring syntax; import/translation doors plus the
existing definition-based authoring model can plausibly satisfy it.

**Risks:** Import-door translation work (Pine/thinkScript parsers) could drift into a de facto authoring
surface if, e.g., members are ever allowed to hand-edit translated/canonical source text freely rather
than edit structured definition fields/parameters. That would functionally recreate the killed
scripting-tier product without anyone deciding to. **Flag for the Compiler/IR Architect and Product
Designer workstreams explicitly** — any editor/authoring UX proposal should be checked against this
boundary before it ships.

**Migration impact:** None.

**Reversibility:** Owner has explicitly reserved the right to reopen this "if Phase Zero uncovers
specific evidence that a native authoring surface would materially improve the product and cannot be
achieved cleanly through the existing architecture." Any such evidence goes through the conflict policy
in DEC-001 (Bucket C — owner/ChatGPT review), not a unilateral reversal.

**Tests needed:** N/A directly, but any future editor/authoring UX work should be checked against the
free-text-editing boundary described under Risks before shipping.

**Date:** 2026-09-04
