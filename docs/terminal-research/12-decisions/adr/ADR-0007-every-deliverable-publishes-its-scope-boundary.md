---
id: ADR-0007
title: Every gate-item deliverable publishes its own scope boundary
status: accepted-by-practice-unwritten
date: adopted by practice; no ruling, no date
decided_by: no one — never ruled, never written down
gate_item: 31
promotion: ⭐⭐ THE ONE DECISION THIS PROGRAMME HAS TAKEN AND NEVER WRITTEN DOWN ANYWHERE. Promoted precisely because it is locked by sixteen independent instances and mandated by nothing.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0007 — Every gate-item deliverable publishes its own scope boundary

**STATUS: ACCEPTED-BY-PRACTICE-UNWRITTEN** · adopted by practice; no ruling, no date · decided by no one — never ruled, never written down · gate item 31

**Why it is an ADR and not a tracker row:** ⭐⭐ THE ONE DECISION THIS PROGRAMME HAS TAKEN AND NEVER WRITTEN DOWN ANYWHERE. Promoted precisely because it is locked by sixteen independent instances and mandated by nothing.

## Context

Sixteen gate-item deliverables carry a section headed *"What this document does NOT decide"*, and
it is the most load-bearing anti-scope-creep device in the programme. It is what lets item 23
describe the entitlement mechanism while proposing no tier, no price and no plan name
(`09-security-licensing-cost/security-entitlement-architecture.md:761-793`); item 22 state a
grounding contract without classifying a licensing input (`08-ai/ai-architecture.md:671-726`);
item 24 rule on ten realtime decisions while barring any Cloudflare change
(`07-technical-architecture/realtime-performance-architecture.md:589-604`); item 25 propose nine
thresholds while wiring none of them to `os._exit`
(`10-roadmap/observability-plan.md:830-871`); and item 29 publish a dependency graph that
sequences nothing in time (`10-roadmap/dependency-graph.md:807-836`).

**It is mandated nowhere.** The binding output structure at
`00-program-control/contracts/_SHARED_PREAMBLE.md:69` ends at *"two mandatory sections:
**GAPS** … and **NOT INSPECTED**"*. `GOVERNING_PRINCIPLES.md` does not contain the phrase.
No contract under `00-program-control/contracts/` contains it. Derived:

```
# documents carrying it as a heading, and as a phrase
grep -rn "^#\{1,3\} .*does NOT decide" --include=*.md docs/terminal-research | wc -l   -> 19
grep -rl "does NOT decide"              --include=*.md docs/terminal-research | wc -l   -> 16
# whether anything in the control tree asks for it
grep -rn "does NOT decide" --include=*.md docs/terminal-research/00-program-control | wc -l -> 0
```

(19 headings across 16 files: `mvp.md`, `jobs-to-be-done.md` and `workflow-library.md` each carry
both a numbered section and a closing one.)

## Decision (as taken, by adoption)

Every gate-item deliverable publishes, inside the document, the list of questions it is **not**
entitled to answer — each with the artifact or the person that owns it.

## Alternatives actually considered

None. The decision was never taken explicitly; that is the finding. The nearest thing to a
deliberation is `GOVERNING_PRINCIPLES.md:69`'s escalation list, which says what to escalate and
says nothing about declaring a boundary in the artifact.

## Consequences

* ⛔ The convention is **unenforceable and unauditable.** Nothing fails when a deliverable
  omits it, and nothing states which questions must appear.
* ⛔⛔ **Two undeclared conventions serve one purpose, which is the second-authority
  defect this programme records against everyone else.** Gate items 19 and 21 — both
  ACCEPTED — do not carry the section; they carry a **PROVISIONAL / OWNER INPUT REQUIRED
  register** instead (`06-ux-and-information-architecture/information-architecture.md:692`;
  `07-technical-architecture/data-architecture.md:1674`), which does the same job in a different
  shape. A reader auditing for one shape finds items 19 and 21 non-compliant; a reader auditing
  for the other finds the six newest documents non-compliant. Neither is true.
* **The cheapest fix is one sentence** in `_SHARED_PREAMBLE.md`'s mandatory output structure
  naming a third mandatory section and stating that either shape satisfies it. Not done here:
  the preamble is a control artifact and this deliverable writes only under
  `12-decisions/adr/`.
* ⚠️ This is recorded as a **decision**, not an open question, because nobody is
  waiting on an answer — sixteen authors have already answered it the same way.

## Sources

- `00-program-control/contracts/_SHARED_PREAMBLE.md:45-74`
- `00-program-control/GOVERNING_PRINCIPLES.md:66-71` (the nearest adjacent rule; the convention is absent)
- `06-ux-and-information-architecture/fixed-modular-hybrid.md:318`
- `07-technical-architecture/realtime-performance-architecture.md:589`
- `08-ai/ai-architecture.md:671`
- `09-security-licensing-cost/security-entitlement-architecture.md:761`
- `10-roadmap/observability-plan.md:830`
- `10-roadmap/dependency-graph.md:807`
- the remaining carriers, enumerated by the grep above rather than by hand: `10-roadmap/mvp.md:680,803` · `10-roadmap/rollout-rollback.md:788` · `10-roadmap/success-metrics.md:545` · `10-roadmap/testing-plan.md:785` · `04-workflows/jobs-to-be-done.md:661,778` · `04-workflows/workflow-library.md:1448,1596` · `05-product-strategy/anti-patterns.md:2428` · `05-product-strategy/feature-scoring.md:1197` · `05-product-strategy/feature-opportunity-backlog.md:1502` · `05-product-strategy/capability-matrix/best-of-breed.md:1214`
- `06-ux-and-information-architecture/information-architecture.md:692` and `07-technical-architecture/data-architecture.md:1674` (the other shape)
