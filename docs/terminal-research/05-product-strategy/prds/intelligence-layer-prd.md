---
id: PRD-I1
title: I1 — Intelligence Layer (contextual research assistant)
role: Retroactive PRD for a SHIPPED system. Written 2026-09-11 under owner ruling 4 (Wave 1, W1-B).
status: RETROACTIVE PRD — I1 Slices 1–3 plus the Composite Rating and Earnings Events slices are LIVE on origin/master (ed6b1f041, 073aa7d4d). This document describes what shipped and binds what ships next. No I1 code was written in this wave.
system: I1 — Intelligence Layer (product-architecture.md §I1)
decisions: DEC-06 (AI provenance component, LOCKED) · DEC-09 (decisiveness for two audiences, OWNER-BOUND, deliberately unresolved here) · DEC-10 (packs vs tools, LOCKED)
sources: product-architecture.md (§I1 block, §8 boundary matrix) · PHASE_2_INTEGRATION_SYNTHESIS.md (§2 finding 5) · provenance-freshness-prd.md (S8's contract) · shipped code read in full this pass: api/services/ticker_explain.py, api/services/ticker_explain_eval/{checks,golden_set,judge,runner}.py, api/services/research/earnings_ai_adapter.py
date: 2026-09-11
---

# PRD-I1 — Intelligence Layer

## 0. Why this document exists, and why it is late

I1 ships **generated prose to members** and had **no written contract**. Its only specification was
an evaluation harness — a golden set and an LLM judge — which is a specification written in test
form, in a place product review never looks. Two other workstreams extended it with nothing to
extend against.

⭐ **The risk this closes is not that I1 is wrong. Reading the shipped code, it is unusually
disciplined.** The risk is that its discipline lives in a 2,000-line module's docstrings and in
`checks.py`, so the next contributor inherits the *behaviour* without the *reasons*, and the first
thing to erode is the grounding rule — the one property that makes an AI surface safe to put in
front of a member who trades on it.

**This PRD is descriptive for what shipped and prescriptive for what ships next.** Where the two
differ, that is named, not smoothed.

## 1. Traceability chain

North star → *a differentiated UCT Terminal built on UCT's own product/data/AI estate* → the
interaction loop's **READ** state (product-architecture.md §1.3) → **"one verdict shape, not one per
surface"** → I1 explains a security from canonical UCT evidence, rendering every number through S8
and never building a competing receipt → DEC-06 LOCKED.

⛔ **The defect this chain exists to prevent already happened once.** Phase 2's adversarial
validation found **S8 and I1 both claiming ownership of "the one provenance renderer"** and fixed it
by ruling that I1 *composes on* S8. That fix was a sentence in an architecture document. §6 below
makes it a testable boundary.

## 2. What I1 is

**The Explain role, never the Decide role.** I1 answers a bounded family of questions about **ONE
security**, from canonical UCT evidence only, for a member who is already looking at that security.

**What shipped:** `/research/:sym` → Ask AI tab (`app/src/pages/research/tabs/AskAiTab.jsx`) →
`api/routers/research.py` → `api/services/ticker_explain.py`.

## 3. Who it is for

The desk first, members second (DEC-001). The audience distinction matters less here than elsewhere
because **the hard boundary in §4 applies to both**: I1 does not issue verdicts to anyone.

## 4. ⛔ The hard boundary — non-negotiable, and already enforced

I1 **MUST NEVER**: say Buy, Sell or Hold as a recommendation; tell a member to enter or exit a
position; give a position-sizing or trade-execution instruction.

It **MAY**: describe what analysts said or did (a fact about them, not I1's verdict); describe
analytical implications ("this may suggest…") without converting them into a portfolio directive.

⭐ **This is why DEC-09 (decisiveness for two audiences) does not block I1 and must not be read as
blocked by it.** DEC-09 decides how decisive *UCT's verdict products* are. I1 is not a verdict
product. The `grade_ticker` path is where decisiveness lives; I1 explains. **Keeping these apart is
a product decision, not an implementation detail — if a future slice wants I1 to render a verdict,
that is a DEC-09 escalation and a new gate, not a prompt change.**

## 5. The grounding rule

**Every factual claim in an answer must trace to real evidence assembled in the CURRENT turn.**

Three consequences, all of them shipped:

1. **A prior assistant answer is NEVER evidence.** The multi-turn window may help interpret a
   follow-up — a pronoun, a "why", a continued topic — and may do nothing else. History is never
   added to the allowed-evidence set.
2. **"Reuse" means re-calling the composer, never carrying a prior evidence object forward.** Each
   composer owns a request-level cache with a domain-appropriate TTL, so a follow-up is a cheap
   cache hit when nothing changed and correctly fresh when it did. ⭐ I1 must never invent a second,
   parallel staleness policy on top of the one each composer already owns — that would be the
   second-authority-over-one-value defect this program keeps finding.
3. **An ungrounded number or a citation to a non-existent evidence id is a defect, not a style
   issue**, and is caught mechanically (§7).

## 6. The composes-on-S8 boundary

I1 **renders every number and every citation through S8's primitives** (`<Provenance>`,
`<FreshnessBadge>`, `<CoverageLine>`, `<Cited>`) and **owns no rendering component of its own.**

- I1 may call: S8 (renders through it), S11 (the clock), the registered composers.
- I1 may **not**: define its own citation-rendering logic, its own freshness badge, or its own
  coverage receipt.
- **Acceptance:** a code-level import/AST check confirms every I1-authored composition renders
  through S8 (see SPEC-I1 §6). This is the direct regression test for the Phase 2 defect.

## 7. The evaluation contract — the acceptance bar

The harness that exists today **is** the acceptance bar, promoted here from test-form to contract:
`api/services/ticker_explain_eval/` — `golden_set.py`, `checks.py` (mechanical, judge-independent),
`judge.py` (LLM judge), `runner.py`.

**Mechanical checks are the floor and the judge never overrides them.** A judge that likes an answer
containing an ungrounded number does not make it pass. Checks shipped today:

| check | what it refuses |
|---|---|
| `check_citation_correctness` | a `key_fact` citing an `evidence_id` that is not in the seeded bundle |
| `check_citation_completeness` | a non-insufficient-evidence answer that cites **nothing** — the member can verify nothing |
| `check_cross_fact_consistency` | an answer that ignores directionally-conflicting evidence |
| `check_response_state_fields` | a `response_state` whose required supporting field is empty |
| `check_insufficient_evidence_behavior` | answering anyway when the question expects a refusal |
| `_grounding_flags` (in-service, not the harness) | any number token not derivable from the current turn's evidence; any invalid evidence id |
| `_earnings_false_confirmed_flags` | upgrading an unconfirmed earnings date to "confirmed" wording |
| `_rating_grounding_flags` | describing Sponsorship as moving the composite, or answering a rating trend question (no historical store exists) |

⛔ **New slice ⇒ new golden-set cases ⇒ new mechanical check where the slice adds a way to be
wrong.** A slice that adds a domain and no check has moved the bar down.

## 8. Refusal shape

Five response states ship: `answer`, `answer_with_caveat`, `partially_answer`,
`ask_for_clarification`, `refuse`. An unrecognised state from the model is **coerced to `refuse`** —
fail closed.

⭐ **A refusal must say what is missing, not merely decline.** "No transcript RAG pipeline exists, so
I cannot answer from the call" is useful; "I cannot answer that" is not. This is the one place where
the shipped behaviour should be *extended* rather than merely recorded: the refusal path is correct
and terse.

## 9. Scope boundaries

**In scope:** one security; eight canonical domains (news, analyst, financials, estimates,
ownership, filings, rating, earnings); a bounded 3-turn window.

**Explicitly out of scope, each for a stated reason:** transcript Q&A (**no RAG pipeline over
transcripts exists anywhere in this codebase**); broad Calendar/Events (no product-home decision);
portfolio data; external web research; rating trend over time (**no historical rating store
exists**); multi-security comparison.

⛔ **These are honest absences, not backlog.** Each becomes in-scope only when the named missing
thing exists.

## 10. Non-goals

- I1 is **not** D2. The Composite Rating slice built a narrow, purpose-built provenance layer using
  the same `_ev()`/evidence-id/grounding-gate shape as the other domains. **That is not the Canonical
  Data Model**, which exists nowhere in this codebase. Full D2 remains deferred and is not required
  for any shipped slice.
- I1 is **not** a verdict engine (§4).
- I1 does **not** own a data class. It reads through composers; it never calls a raw provider.

## 11. Acceptance criteria

1. No I1-authored composition renders a number or citation except through S8's primitives (AST check).
2. Every `key_fact`'s `evidence_id` resolves in the current turn's bundle; zero exceptions.
3. Every number in generated prose is derivable from the current turn's evidence, or the answer is
   refused.
4. No answer, in any response state, contains a Buy/Sell/Hold recommendation, an entry/exit
   instruction, or a sizing directive — golden-set adversarial cases included.
5. An unrecognised `response_state` coerces to `refuse`.
6. The composer routing budget holds: **≤4 composer calls per question**.
7. A new domain ships with golden-set cases and, where it adds a new way to be wrong, a new
   mechanical check.
8. Prior-turn text never enters `allowed_numbers` or `valid_ids`.
