---
id: ADR-0015
title: Licensing is CLEARED for the current estate and OPEN for each new data source
status: accepted
date: 2026-09-26
decided_by: the OWNER (clearance) + the programme (the scope rule)
gate_item: 5, 9, 27
promotion: Locked: an owner clearance with *"Reversal condition: none"*, plus a forward scope rule the card states as *"the honest rule going forward"*. Two named escalations were closed by the same ruling.
supersedes: the licensing register's ESC-08 and ESC-10 as OPEN items
superseded_by: none
register_row: none
---

# ADR-0015 — Licensing is CLEARED for the current estate and OPEN for each new data source

**STATUS: ACCEPTED** · 2026-09-26 · decided by the OWNER (clearance) + the programme (the scope rule) · gate item 5, 9, 27

**Why it is an ADR and not a tracker row:** Locked: an owner clearance with *"Reversal condition: none"*, plus a forward scope rule the card states as *"the honest rule going forward"*. Two named escalations were closed by the same ruling.

**Supersedes:** the licensing register's ESC-08 and ESC-10 as OPEN items

## Context

The licensing register had moved **76 of 118 rows to Likely Allowed** (from 7) and cut Restricted
to **18** (from 81) on written provider confirmations, with four named exceptions still open
(`12-decisions/DECISION_CARDS_2026-09-26.md:718`).

## Decision

✅ **Owner, verbatim, 2026-09-26: "in terms of license and compliance we already have
everythign checked off and are good everywhere that already has access and data and information so
we are good."** (`:716`) Accepted and recorded as the owner's risk decision. ⛔ **No
downstream document treats licensing as a blocker again** (`:718`).

✅✅ **The named exceptions were closed too** (`:720`):

| item | disposition |
|---|---|
| **ESC-08** Finnhub (*written approval confirmed to exist, document not captured*) | ✅ **CLOSED** — owner: *"consider finnhub and schwab closed and approved"* (`:734`) |
| **ESC-10** Schwab (Commercial/Redistribution tier confirmed, document not captured) | ✅ **CLOSED**, same sentence (`:734`) |
| **ESC-03** derived works — does the grant reach charts, breadth, RS, analytics, AI summaries, or only display? | ✅ **OWNER-ACCEPTED RISK**, not left open. Written down rather than deleted for one narrow reason: if a vendor ever challenges a derived surface, the record should show the decision was taken knowingly, with a date. **No task is owed.** (`:728`) |
| **yfinance / Yahoo** | ✅ Confirmed on the owner's own reasoning — *"and yahoo obviously yes because they dont have licensing"* — matching `00-program-control/OWNER_DECISIONS.md` **D-004** precisely (`:740`). ⛔ It is an **accepted risk, not a licence**; Yahoo sells none, so there is nothing to obtain and *nobody should file a task to "go get the Yahoo licence"* (`:742`) |

⛔ **AND THE SCOPE RULE, which is the part that binds forward work:**
*"licensing is CLEARED for the current estate and OPEN for each new data source the roadmap
adds."* (`:748`)

## Alternatives actually considered

1. **Record the clearance without its exceptions.** Rejected explicitly: *"a blanket clearance
   recorded WITHOUT its exceptions is precisely the artifact class this programme keeps getting
   burned by — a record that was true when written, standing in for a live obligation."*
   (`:722`)
2. **Read the clearance as covering feeds not yet acquired.** Rejected as a scope statement, not
   a challenge: *"if the owner intends the clearance to extend to feeds not yet acquired, one
   sentence says so and this section is struck."* (`:752`)

## Consequences

* ⭐ **Under ADR-0012's aggregation thesis this matters MORE, not less.** Almost everything
  this product would aggregate is a derived work — the whole point is to compute on vendor
  data rather than resell it — and *"having access to a feed and being permitted to publish
  what you compute from it are separate grants"* (`:730`).
* **Item 9's coverage ledger gets a column it would otherwise have had to invent**: every
  capability needing a feed not currently held is an **open** licensing question (`:746-748`).
* Two rows are carried forward as permanent product boundaries, not backlog: **LIC-06** (no terms
  document exists at all) and **LIC-08** (no purchasable remedy at any price) (`:750`).
* ⚠️ The evidence-filing gap is real but not a compliance gap: today the programme's
  record cannot prove what the owner correctly knows. Cheap to close while the emails exist
  (`:736`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:714-752`
- `00-program-control/OWNER_DECISIONS.md:17` (D-004)
- `09-security-licensing-cost/licensing-register.md` §1D and the ESC-03 row (cited by the card at `:726`)
