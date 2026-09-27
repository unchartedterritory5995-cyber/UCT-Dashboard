---
id: ADR-0021
title: A population ceiling per lane is sized before any new member-facing AI surface ships; and a model is never downgraded for cost
status: accepted
date: 2026-09-26 (doctrine dated earlier)
decided_by: the programme (gate item 22) + owner doctrine
gate_item: 22
promotion: Locked as a REQUIREMENT with no number in it, which is the honest lock available: the doctrine is settled and the ceiling is a number nobody has. The card and the document both say so in those words.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0021 — A population ceiling per lane is sized before any new member-facing AI surface ships; and a model is never downgraded for cost

**STATUS: ACCEPTED** · 2026-09-26 (doctrine dated earlier) · decided by the programme (gate item 22) + owner doctrine · gate item 22

**Why it is an ADR and not a tracker row:** Locked as a REQUIREMENT with no number in it, which is the honest lock available: the doctrine is settled and the ceiling is a number nobody has. The card and the document both say so in those words.
## Context

⛔⛔ **The economic risk is guard INHERITANCE, not the model bill.** At E-06's base
assumptions six proposed features cost $2.81–3.56/member/month against a $200 list price. The
per-user caps already in code sum to **~$610–650/member/month** and the global caps to
**~$68/day ≈ $2,000/month across every capped lane** — so *"at 1,000 members the
six-feature base case ($3,563/month) already exceeds the sum of all caps: the caps as inherited
would refuse members before the product reached its own base case"*
(`08-ai/ai-architecture.md:41-52`, from E-06 §4.3/§5.1).

## Decision

1. **Terminal-Next must size a population ceiling per lane before it ships a single new AI
   surface** (`:50-52`).
2. **A model is never downgraded for cost.** The levers are caching and batching, and caching must
   be taught to the budget guard or it loosens the cap
   (`00-program-control/GOVERNING_PRINCIPLES.md:74`;
   `00-program-control/charter/OWNER_SEED_FACTS.md:39-40`). CARD 14 rules that this half is
   *"answered by an existing ruling, not an open question"*
   (`12-decisions/DECISION_CARDS_2026-09-26.md:166`).
3. **Member-facing traffic never routes through the owner's Claude seat**; any AI feature uses API
   credit with its own budget guard (`OWNER_SEED_FACTS.md:38`).

## Alternatives actually considered

1. **Inherit the per-user caps as-is.** Rejected by the arithmetic above — a per-user cap
   does not bound population cost (`GOVERNING_PRINCIPLES.md:74`).
2. **Choose a cheaper model per lane.** Barred by the doctrine.
3. **Set the ceiling now.** ⛔ Not possible. *"The owner's cost ceiling — OI-10 — is
   UNKNOWN, and every ceiling in §4.4 is therefore a shape with no number in it"*
   (`:671`ff, point 2), and `$6/member/month` in §4.4 is E-06's illustration at 3% of $200,
   **not a decision**.

## Consequences

* ⚠️ **The distinction that keeps getting collapsed, stated plainly: the cost DOCTRINE
  is settled and the cost CEILING is not.** CP-10 is resolved because no *knowledge* is missing
  for the architecture; OI-10 is Unknown because a *number* is. *"Quoting the first as though it
  answered the second is the error this clause exists to prevent."* (`:671`ff, point 3)
* ADR-0014 de-scoped cost work, so the ceiling is now unlikely to be supplied. This requirement
  therefore binds as a **gate on shipping a new lane**, not as a modelling task.
* ⛔ Not decided: which of E-06's six features ship, at what adoption, on which model, or
  whether Terminal-Next re-hosts Compass chat or voice (`:671`ff).
* ⚠️ `COMPASS_MENTOR_MODE` — the flag deciding whether a **computed trading
  verdict** reaches members — is not a key in `docs/feature_flags.json` at all, so it has no
  declared default, no exposure and no dated owner decision
  (`00-program-control/MASTER_CHECKLIST.md:28`). State UNREAD (ADR-0003).

## Sources

- `08-ai/ai-architecture.md:41-64,394-438,623-657,671-726`
- `00-program-control/GOVERNING_PRINCIPLES.md:74`
- `00-program-control/charter/OWNER_SEED_FACTS.md:38-40`
- `12-decisions/DECISION_CARDS_2026-09-26.md:156-172`
- `00-program-control/MASTER_CHECKLIST.md:28`
