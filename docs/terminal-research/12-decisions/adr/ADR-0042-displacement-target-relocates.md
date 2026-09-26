---
id: ADR-0042
title: The absorb-outright verdict STANDS; the displacement target relocates from the deleted embed to hand-use of finviz.com
status: accepted
date: 2026-09-26
decided_by: the OWNER (the existence statement) + the programme (the correction)
gate_item: 13, 27
promotion: Locked: it rests on an owner statement of fact, and it retires a published conclusion rather than adding to it.
supersedes: ADR-0041 (in part)
superseded_by: none
register_row: none
---

# ADR-0042 — The absorb-outright verdict STANDS; the displacement target relocates from the deleted embed to hand-use of finviz.com

**STATUS: ACCEPTED** · 2026-09-26 · decided by the OWNER (the existence statement) + the programme (the correction) · gate item 13, 27

**Why it is an ADR and not a tracker row:** Locked: it rests on an owner statement of fact, and it retires a published conclusion rather than adding to it.

**Supersedes:** ADR-0041 (in part)

## Context

ADR-0041 measured that the in-app Finviz embed is gone and concluded that item 13's
absorb-outright verdict rested on a void product state.

## Decision

✅ **Owner, verbatim: "Assume that i personally use every other site mentioned."**
(`12-decisions/DECISION_CARDS_2026-09-26.md:676`) This makes the live use of thinkorswim/Schwab,
TradingView, Finviz, Market Chameleon and the other named sites an **owner-stated fact, not an
assumption. Every document may now cite it** (`:700`).

⭐⭐ **So CARD 24 was too quick.** *"Item 13 verdicted a TOOL, not an embed — and the
owner now confirms he uses that tool. So the verdict stands and the displacement target simply
RELOCATES, from the deleted in-app embed to his hand-use of finviz.com. What was actually wrong was
item 27's READING of the verdict as being about the in-app tabs."* (`:704`)

⭐ **Item 27's surviving half is therefore not a remainder — it is the whole thing, and
its incumbent is now confirmed in use by the one subject currently available** (`:704`).

## The boundary this ruling draws, and it is the reusable part

⛔ **It is an EXISTENCE statement, not a task attribution, and the difference is exactly what
item 27 needs.** It settles *that* he uses Finviz; it does not settle *which step* he uses it for,
and **CP-06 records that he declined to itemise per-tool workflows.** So *"the owner uses tool X"*
is citable; *"the owner uses tool X for step Y"* remains a **labelled inference** (`:702`).

## Alternatives actually considered

1. **Let CARD 24's conclusion stand and re-verdict item 13.** Rejected — the verdict was
   never about the embed.
2. **Treat the owner's sentence as answering item 27's workflow question too.** Rejected by the
   existence/attribution boundary above. CP-06 is explicit that the itemisation was declined
   (`10-roadmap/mvp.md:60-66`).

## Consequences

* ⚠️ **Under ADR-0012's aggregation thesis this RAISES item 13's bar**: a harden/bridge
  verdict is not a success state, so three of the five desk-tool verdicts now read as **unmet**
  rather than *done differently* (`:684`).
* The whole ADR-0041 → ADR-0042 pair is the programme's cleanest worked example of **a correct
  measurement leading to a wrong conclusion**, and both halves have to be read together for it to
  teach anything.
* ⛔ Item 13's headline was flagged by ADR-0041 as *"the highest-value correction
  outstanding"* and is **still not re-verdicted** — that remains open work, not a decision
  (`:667`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:672-712` (§4 at `:698-704`), `:645-670`
- `10-roadmap/mvp.md:60-72`
- `00-program-control/MASTER_CHECKLIST.md:19`
