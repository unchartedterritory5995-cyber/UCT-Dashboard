---
id: ADR-0039
title: The MVP definition of done: K of N eligible occasions, recorder ≠ adjudicator, and pre-registration blocks
status: accepted
date: 2026-09-26
decided_by: a three-reviewer panel, adopted under owner delegation
gate_item: 18, 27
promotion: Locked: a rule, not a verdict, with a stated reversal condition (OI-02 being answered) and an explicit refusal to supply the verdict itself. It supersedes a default carried in an accepted deliverable.
supersedes: ADR-0040
superseded_by: none
register_row: none
---

# ADR-0039 — The MVP definition of done: K of N eligible occasions, recorder ≠ adjudicator, and pre-registration blocks

**STATUS: ACCEPTED** · 2026-09-26 · decided by a three-reviewer panel, adopted under owner delegation · gate item 18, 27

**Why it is an ADR and not a tracker row:** Locked: a rule, not a verdict, with a stated reversal condition (OI-02 being answered) and an explicit refusal to supply the verdict itself. It supersedes a default carried in an accepted deliverable.

**Supersedes:** ADR-0040

## Context

The charter's MVP bar is *"our own traders voluntarily prefer it for at least one meaningful daily
workflow after reasonable onboarding"* (`00-program-control/GOVERNING_PRINCIPLES.md:113`). The
owner delegated the rule: *"You do, based on simulated beta tests and judgement as a team of
decision makers from various backgrounds and skill sets."*

⛔⛔ **The simulation half was REFUSED, and the reason is the whole point.** *"Do our own
traders voluntarily prefer it"* is a claim about real human behaviour; a simulated trader
preferring a simulated terminal is evidence about the simulation. ⭐ **A panel can decide the
RULE. Only a person can supply the VERDICT.**
(`12-decisions/DECISION_CARDS_2026-09-26.md:447-452`)

## Decision

**The measured clause.** On a named occasion, for a named task: the work happened in Terminal-Next,
**and** the named incumbent tool was not opened for that task. Recorded the same day, one line per
person-occasion, append-only, with **what else was open, named**. ⛔ **A missing day is
UNREADABLE, never a zero** (`:514-518`).

**The judged clauses** — *meaningful*, *reasonable onboarding*, *voluntarily* — cannot be
made rigorous at this n and **are not dressed as metrics**. They are a signed, dated judgement that
says on its face that it is a judgement. ⭐ *"A judgement that admits what it is cannot be
quietly waived — only reversed by its signatory."* (`:519-522`)

⛔⛔ **THE ONE BLOCKING REQUIREMENT: PRE-REGISTRATION.** The workflow, the incumbent tool
it must displace, the subject and the span must appear in a dated artifact whose timestamp
**precedes day 1**. Absent ⇒ the claim is blocked regardless of anyone's opinion
(`:524-526`).

**Also required** (`:533-537`): the **methodologist's split** — recorder and adjudicator are
different people, the adjudicator answering **PASS / FAIL / INCONCLUSIVE** against a pre-committed
rule; at least one **non-builder subject**; a **withdrawal block** inside or after the span;
per-person verdicts published **unaggregated** (⛔ *"a 2-1 majority among three raters carries
zero evidential weight — under a coin-flip null the probability of ≥ 2 agreeing with you
is 0.5, so there is no vote"*); eligibility declared **that morning**, never retrospectively, with
**more than a third ineligible ⇒ INCONCLUSIVE**; and the failure sentence written in advance.

⛔ **If no non-subject adjudicator exists at this headcount, the verdict is
INCONCLUSIVE-BY-CONSTRUCTION and says so on its face. It does not become a PASS because nobody was
available to disagree.** (`:488-490`)

Plus ADR-0033's anti-waiver clause, which this card produced.

## Alternatives actually considered

1. **The owner supplies the yes.** Rejected by all three reviewers independently: he is a *subject*
   and a subject cannot adjudicate their own preference; his switching cost is ~0 and he needs no
   onboarding, making him **the worst available subject, not the most convenient one**; and a
   builder's session is QA, which in a log is indistinguishable from preference (`:461-467`).
2. **A behavioural log without pre-registration.** Rejected: *"With pre-registration and no log, a
   false pass requires a lie. Without pre-registration but with a log, the honest bad case passes
   fully documented — which is this organisation's signature failure mode."* Pre-registration
   is also the only thing that makes a NO reachable (`:528-531`).
3. **Run the simulation and report a verdict.** Refused — see Context.
4. **Keep the definition of done as the charter sentence.** ⭐ Partly adopted: the adversarial
   reviewer's demotion was accepted, so the charter sentence stays as the **thesis** and the
   definition of done becomes a **displacement ledger** (`:492-495`).

## Consequences

* ⭐⭐ **Two reviewers independently invented the same instrument: the WITHDRAWAL test.**
  Turn the surface off for a defined block, unannounced; if nobody asks for it back before the
  close, it was **tolerated, not preferred**. *"When two disciplines reach for the same instrument
  unprompted, that is the closest thing to corroboration this exercise can produce."*
  (`:468-472`)
* **Preference is a SUBTRACTION, never an addition.** *"'I use it every morning' is true of five
  open tabs."* (`:473-475`)
* ⛔ **What is still the owner's: naming a non-builder subject.** ⚠️ If no such
  person exists at this headcount, **that is itself the finding** (`:564-568`). ADR-0011 changes
  the odds: 750 people already pay for a sibling product.
* ⚠️ **Three practitioner citations were wrong and are not carried forward**, recorded
  because one was used to disqualify a named person: the claim that the owner declined to itemise
  rank and time across the four tools (**the record says the opposite** — OI-06 was answered
  2026-09-19, naming all four); *"three named morning queries through `finviz_client.py`"* (**that
  file does not exist**); and *"Finviz is the only one of the four the firm already instruments"*
  (**false** — Unusual Whales has dedicated integration). *"An argument that disqualifies a
  specific person on a misread record must not propagate, and this is why a synthesis verifies
  rather than aggregates."* (`:545-562`)
* **Reversal condition:** OI-02 being answered supersedes this card — and a verdict rendered
  under it must state whether it survives OI-02 being answered, *"otherwise a pass becomes orphaned
  rather than confirmed"* (`:570-572`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:442-572`
- `00-program-control/GOVERNING_PRINCIPLES.md:113`
- `10-roadmap/success-metrics.md:540` (SM-11, superseded — ADR-0040)
