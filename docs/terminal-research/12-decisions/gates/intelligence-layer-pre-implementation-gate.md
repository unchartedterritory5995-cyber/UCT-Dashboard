---
id: GATE-I1
title: I1 Intelligence Layer — Pre-Implementation Gate
role: gates FUTURE I1 work. Slices 1–3, Composite Rating and Earnings Events are already shipped and are NOT gated by this packet — they are recorded in PRD-I1/SPEC-I1 as-shipped.
status: PRESENTED — awaiting owner approval. NOT approved.
pairs_with: PRD-I1, SPEC-I1
date: 2026-09-11
---

# I1 — Pre-Implementation Gate

## ⛔ APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:      ____________________   (owner)
APPROVED ON:      ____________________   (date, time, timezone)
APPROVED AT SHA:  ____________________   (origin/master at approval)
SCOPE APPROVED:   [ ] all of §3   [ ] only: ______________________
```

⛔ **No Checkpoint 1 commit may be authored until the four lines above are filled in and committed.**
This block exists because of the S3 case: that gate packet's date *did* precede its first
implementation commit — by twenty minutes, written and satisfied by the same session. **Date
ordering alone is nearly vacuous.** The binding constraint is a second party recording approval.

## 1. What is already shipped, and therefore NOT gated here

I1 Slices 1–3, the Composite Rating composer and the Earnings Events composer are **live on
`origin/master`** (`341bb78de`, `a21518d0e`, `073aa7d4d`, `ec095a23d`). PRD-I1 and SPEC-I1 record
them as-shipped. **This packet gates what comes next.** Nothing here proposes changing shipped
behaviour.

## 2. Why a gate at all for a system that already shipped

Because the next change to I1 is the dangerous one. The shipped code holds four invariants by
convention and docstring — the grounding gate, the hard Buy/Sell/Hold boundary, the composes-on-S8
boundary, and `_full_text()` completeness — and **two of them have no rail.** A contributor who has
not read a 2,000-line docstring can erode either without any test going red.

## 3. Scope proposed for the first gated slice

**Recommended first slice: the two rails, not a feature.** SPEC-I1 §10 F-I1-1 and F-I1-4.

| item | what | size |
|---|---|---|
| **F-I1-1** | AST/import-graph rail asserting every I1-authored composition renders citations and freshness through `app/src/components/provenance/` and defines none of its own. Must carry a **control** proving it can see a real violation | S–M |
| **F-I1-4** | rail asserting every model-authored field in the response schema is unioned into `_full_text()`, so a new field cannot become ungoverned prose | S |
| **F-I1-3** | golden-set adversarial cases for the §4 hard boundary — no prompt reaches a Buy/Sell/Hold, entry/exit or sizing output | S |

**Explicitly NOT in this scope:** any new domain/composer; transcript Q&A (no RAG pipeline exists);
Calendar/Events; portfolio data; external web research; rating trend (no historical store); any
change to the hard boundary or to DEC-09's posture; F-I1-2 (refusal enrichment) unless the owner
adds it.

## 4. Conditions

1. **MANDATORY — the owner approval block above is filled in before Checkpoint 1.** Not "if
   desired." The S3 gate's only invitation for a human was phrased optional and was therefore
   skipped.
2. **MANDATORY — each new rail must be watched failing before it is accepted.** Mutate the thing it
   guards, see it go red, restore. A rail nobody has seen fail is not a rail.
3. No change to shipped answer behaviour in this slice. If a rail reveals a real violation, that is
   a **finding to report**, not a fix to bundle.
4. Nothing runs against production data or the production pod.

## 5. Scope exclusions have a rail, not just a sentence

The S3 gate excluded S2/S4/S5/S7/D1/D2 by name and three of them shipped within 40 hours with
nothing to notice. **This packet's exclusions are enforced by the ledger query**: a commit touching a
program-created path for an excluded system, with no ledger row, fails the protection rail's check
(1b).

## 6. Final gate

# IMPLEMENT WITH CONDITIONS — *pending the approval block in §0*

The scope is three rails and a set of adversarial test cases. It adds no capability, touches no
member-visible behaviour, and closes the two invariants currently held by convention alone.

⛔ **Unapproved until §0 is filled in.** Author: Claude (orchestrator session), 2026-09-11.
