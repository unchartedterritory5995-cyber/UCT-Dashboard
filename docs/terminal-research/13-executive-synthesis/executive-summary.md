---
id: EXEC-SUMMARY-1
title: Executive Research Summary -- where the decision lives
role: >
  Gate item 1. A one-page pointer to the Owner Decision Memo (gate item 38), for a reader who has
  seen none of this. It does not summarise the findings and does not re-argue the recommendation.
status: draft
date: 2026-09-26
---

# Executive Research Summary

**This page routes. It does not argue.** The conclusion, the recommendation, and the decisions this
programme asks for are all in one document, and it is the next thing to read:

> **`13-executive-synthesis/owner-decision-memo.md`** -- gate item 38,
> *"the four decisions, and what to build first"*. It also says what the programme could not answer.

Everything below is here so that document lands correctly.

## What this programme produced

**Research and decisions -- not built product.** Thirty-eight deliverables [N1]: an engineering
backlog of ninety-three tickets [N2] (`10-roadmap/backlog.md`), a competitor-facing coverage-gap
ledger (`05-product-strategy/capability-matrix/capability-matrix.md`), a three-horizon roadmap
(`10-roadmap/roadmap.md`), and the decision record below. The *code* it produced is two commits on
one branch [N3], `fix/wire-watchdog-cannot-fire` -- a production fix with its rail, plus an unrelated
docstring correction -- **neither merged**; saying the word *deploy* on them is one of the memo's four
decisions.

⛔ **A reader who takes this for a build log will look for features that do not exist.** No member
surface was shipped by this programme.

## Where to look for what

| What you want | Where it is |
|---|---|
| Every deliverable -- gate item, path, owner, status | `00-program-control/MASTER_CHECKLIST.md` |
| The rulings, current set | `12-decisions/DECISION_CARDS_2026-09-26.md` (CARDs 9-32; 1-8 in the 09-18 and 09-25 files) [N4] |
| Decisions that locked, superseded ones included | `12-decisions/adr/ADR-INDEX.md` |
| Living tracker, `DEC-01` ... `DEC-15` | `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` |

⚠️ **The checklist is the index; its status column is the weaker half.** Several rows carry a
stale leading label with the current one appended after it -- row 9 still reads NOT STARTED beside an
artifact that landed 2026-09-26. A row is reliable about *where* a thing is, not about its state.

## Settled, and needed before the rest makes sense

* **One paid tier, no tiering** (CARD 17), at **$200/month or $2,000/year**, owner-ratified (CARD 23).
* **The thesis, in the owner's own words:** *"aggregate all the best features so someone can only use
  our site instead of the others"* (CARD 25) -- an aggregation thesis, under which the binding
  constraint is **coverage**, not differentiation.
* **No execution and no order management** (`00-program-control/GOVERNING_PRINCIPLES.md` section 13,
  held by CARD 25), so substitution runs to research and analysis and is **bounded at the trade**: it
  can replace the tabs a member reads, never the one they buy through.
* **Two products, two populations, never one denominator:** roughly 750 people pay for the sibling
  Whop Discord; UCT Intelligence is roughly 26 accounts, and that figure disagrees with an in-pod
  read of 29 -- reported, not resolved (owner decision memo, section 4).

## What this programme does not claim

It does not say the product is ready, and it does not say any member would prefer it. **Nobody has
been in a position to say that** -- the MVP definition of done (CARD 22) has no named subject yet,
and naming one is the memo's first decision.

---

**Footnote -- every number above, with the command that produced it.** Run from
`docs/terminal-research/`. Nothing is typed from memory; no flag state is asserted on this page.

```bash
# [N1] numbered deliverable rows (unnumbered support rows follow them in the same table)
grep -cE '^\| [0-9]+ \|' 00-program-control/MASTER_CHECKLIST.md
# [N2] distinct backlog tickets
grep -oE 'TERM-[0-9]{3}' 10-roadmap/backlog.md | sort -u | wc -l
# [N3] the commits this programme put in code, and their subjects
git log --oneline origin/master..fix/wire-watchdog-cannot-fire
# [N4] this file's card range, then the range across all three card files
grep -hoE '^## CARD [0-9]+' 12-decisions/DECISION_CARDS_2026-09-26.md | grep -oE '[0-9]+' | sort -un
grep -hoE '^## CARD [0-9]+' 12-decisions/DECISION_CARDS_*.md | grep -oE '[0-9]+' | sort -un
```
