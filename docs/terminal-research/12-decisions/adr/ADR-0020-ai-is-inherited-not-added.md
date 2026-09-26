---
id: ADR-0020
title: Terminal-Next does not add an AI layer: it generalises and rails the contract that already shipped
status: accepted
date: 2026-09-26
decided_by: the programme (gate item 22 / ARCH-05)
gate_item: 22
promotion: Locked: it is a measured reversal of the item's own commission. The document was commissioned to design a contract and found it already running, so the deliverable changed shape.
supersedes: gate item 22's own commission to design an evidence/grounding contract, and D-12's finding that one was missing
superseded_by: none
register_row: DEC-10 (Packs vs. tools) is adjacent and stays in the register
---

# ADR-0020 — Terminal-Next does not add an AI layer: it generalises and rails the contract that already shipped

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (gate item 22 / ARCH-05) · gate item 22

**Why it is an ADR and not a tracker row:** Locked: it is a measured reversal of the item's own commission. The document was commissioned to design a contract and found it already running, so the deliverable changed shape.

**Register:** DEC-10 (Packs vs. tools) is adjacent and stays in the register — `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` remains the authority for that row. This ADR records only what locked after 2026-09-02 and is not in the register.

**Supersedes:** gate item 22's own commission to design an evidence/grounding contract, and D-12's finding that one was missing
## Context

ARCH-05 was commissioned to invent the evidence/grounding contract C6-02 ranks highest and D-12
found missing.

## Decision

⭐⭐ **The contract this document was commissioned to invent has already shipped.**
`api/services/ticker_explain.py` implements, in running code: fixed deterministic evidence domains
with stable citable ids, a closed member-facing vocabulary, a **blocking** grounding gate that
runs over the union of *every* free-text field the model authored, five named response states, and
a refusal whose reason is **derived from the evidence gap, never model-authored**
(`08-ai/ai-architecture.md:27-40`). **ARCH-05's job is to generalise and rail that contract, not to
design one** (`:38-40`).

Two constraints follow, and they are the decision's substance:

1. **AI is a panel-scoped capability plus exactly one ask surface. It is never a panel type of its
   own, and never a second chat.** The pattern already shipped: the earnings modal
   (`AskAiSection.jsx`) and the notebook (`AiSearchEmbed.jsx`) both **compose `AiSearchWidget`**
   rather than growing a second chat, and `AskAiSection.jsx:5-13` says so explicitly
   (`:491-517`).
2. ⛔ **The one genuinely new piece of plumbing is the scope object.** The voice path has a
   page-context contract (`setVoicePageHint` → a `"=== CURRENT PAGE ==="` block) and *"the
   typed ask box has only a symbol scope"*. **A board that can hold N panels needs one
   page-context contract both lanes read, not two** (`:505-509`, D-12 §8 Gap #1).

## Alternatives actually considered

1. **Design a new contract.** Rejected on measurement — it exists and is stronger than any
   vendor's published producer-side posture (`:33-40`, C6-02 §9).
2. **An `aisearch` panel type with its own host.** Rejected: *"Registry membership, not a new
   host"* — `aisearch` is already a registry entry, and D-06's recommendation is to add a
   `menus.terminal` flag rather than fork the registry (`:515-517`). See ADR-0016.
3. **A free-floating conversation.** Rejected: an AI answer is scoped to whatever a panel is
   already about — the symbol, the scan, the position (`:499-503`).

## Consequences

* ⛔ **Grounding is producer-side only, and that is the whole trust gap.** P5 — a
  machine-checkable citation pointer per claim — is *"half a wire format; the other half is a
  data-modelling job no citation API will do"*: **a computed number with no addressable row cannot
  be cited by any mechanism in the field** (`:33-37`). Whether computed metrics get addressable
  rows is C7-03's contract, not this document's (`:671`ff).
* ⛔ **The first requirement is a derived rail rather than more prose**, because **seven of
  the spec's nine cited line numbers had moved in two days**
  (`00-program-control/MASTER_CHECKLIST.md:28`; `08-ai/ai-architecture.md:317`).
* An AI panel inherits ADR-0018's standing invariant, and is *"the most likely to throw … and
  therefore the least acceptable place to lose the close control"* (`:511-513`).
* ⚠️ Overturn signal 5: *"`ComparisonAskAi.jsx` (or any second AI surface) shipping its
  own citation renderer"* would already have broken §4.3's requirement 6 (`:658`ff).

## Sources

- `08-ai/ai-architecture.md:27-64,317,485-517,658-670,671-726`
- `00-program-control/MASTER_CHECKLIST.md:28`
