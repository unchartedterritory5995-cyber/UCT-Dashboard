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
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-11
APPROVED AT SHA:  cd1b37cfc87a806006d5e46e8382ceb25b308457   (this packet as it stood at approval)
SCOPE APPROVED:   [ ] all of §3   [x] only: FIRST SLICE — F-I1-1 (S8-boundary AST rail),
                  F-I1-4 (_full_text() completeness rail), and adversarial cases for the
                  hard boundary. No new capability, no member-visible change, no changes to
                  the eight composers' behaviour.
                  ⛔ F-I1-2 and F-I1-3 are NOT in scope — each needs its own approval line.
```

---

## ⛔ APPROVAL — SLICE 2 (second block; the first slice's block is above and remains as-granted)

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-11
APPROVED AT SHA:  22a0367fe3ca1c23e013684ec8547a4388e0c47f   (this packet as it stood at approval)
SCOPE APPROVED:   SLICE 2 — AskAiTab.jsx composes <Cited>/<Provenance> for its citation list
                  instead of the local CSS-module rendering.
                  MEMBER-VISIBLE: the Ask-AI answer's provenance affordance becomes identical
                  to its sibling tabs.
                  ⛔ NO change to answer content, composers, grounding, or the [E#] evidence-id
                     mapping. NO other file.
```

**Why slice 2 exists:** slice 1's F-I1-1 rail found the violation it was built to find. `AskAiTab.jsx`
renders its own citation list — `[E#]` marks, source, date and link in local CSS-module classes —
while every sibling tab on the same page composes S8's primitives. ⭐ **This is the Phase-2
double-ownership defect, which was "fixed" on 2026-09-02 by writing a sentence into an architecture
document and has been live ever since.** Slice 2 closes it in code.

**Conditions:**

1. **MANDATORY — branch off `origin/master` AFTER the five pending PRs merge, never before.** It
   depends on `feat/i1-rails`; branching early would either miss the rail or duplicate it.
2. **MANDATORY — evidence ids map 1:1 to what the backend emits today.** A test must assert the
   rendered citation count equals the payload's evidence count.
3. **MANDATORY — remove the `RECORDED_BOUNDARY_DEBT` entry for this violation in the same PR**, so
   F-I1-1 passes on **the fix itself** rather than on the debt record. ⛔ Confirm the rail goes green
   **because the violation is gone, not because the entry moved** — that distinction is the whole
   point of a debt ledger inside a rail, and it is checkable: delete the entry first, watch the rail
   go red, then apply the fix and watch it go green.
4. Frontend tests, plus a **before/after screenshot pair** of the Ask-AI tab against a fixture
   answer. Screenshots are for the owner — no BrowserStack, no device run.
5. Branch `feat/i1-askai-provenance`. PR only. Ledger row. ⛔ **Flagged MEMBER-VISIBLE by name in the
   merge list.**

---

✅ **SLICE 1 APPROVED 2026-09-11.** Implementation authorized on branch `feat/i1-rails` (Wave 1.5)
under exactly the slice-1 scope above. ⚠️ Note the honest asymmetry, recorded rather than smoothed: this packet
was written and approved **after** I1's Slices 1–3 shipped. It gates the *next* change, which is the
first one this rule has ever actually preceded.

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
