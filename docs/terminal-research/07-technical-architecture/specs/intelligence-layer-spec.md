---
id: SPEC-I1
title: I1 — Intelligence Layer, technical specification
role: Retroactive technical spec for a SHIPPED system, written 2026-09-11 (Wave 1, W1-B). Binds future slices.
status: RETROACTIVE SPEC — describes `api/services/ticker_explain.py` as shipped on origin/master and binds what ships next. No I1 code was written in this wave.
pairs_with: 05-product-strategy/prds/intelligence-layer-prd.md
sources: code read in full 2026-09-11 — api/services/ticker_explain.py · api/services/ticker_explain_eval/{checks,golden_set,judge,runner}.py · api/services/research/earnings_ai_adapter.py · api/routers/research.py · app/src/pages/research/tabs/AskAiTab.jsx
date: 2026-09-11
---

# SPEC-I1 — Intelligence Layer

## 1. Shipped surface

| layer | path |
|---|---|
| frontend | `app/src/pages/research/tabs/AskAiTab.jsx` (inside `ResearchPage.jsx`) |
| route | `api/routers/research.py` |
| service | `api/services/ticker_explain.py` |
| evidence adapters | `api/services/research/*` (incl. `earnings_ai_adapter.py`) |
| eval harness | `api/services/ticker_explain_eval/{checks,golden_set,judge,runner}.py` |

Shipped by `341bb78de` (Slice 1), `a21518d0e` (Slice 2), `073aa7d4d` (Slice 3 + Composite Rating +
Earnings Events), extended by `ec095a23d` (Seam 29). See
[`LEDGER.md`](../../00-program-control/LEDGER.md).

## 2. The tool-registry contract

I1 does not call providers. It calls **composers**, registered in one place:

```python
_DOMAIN_FETCHERS = {
    "news": _fetch_news,          "analyst":  _fetch_analyst,
    "financials": _fetch_financials, "estimates": _fetch_estimates,
    "ownership": _fetch_ownership, "filings":  _fetch_filings,
    "rating": _fetch_rating,       "earnings": _fetch_earnings,
}
```

**Registration rules (binding on new domains):**

1. **One canonical composer per domain.** The Earnings slice is the reference: it reaches earnings
   through exactly one owner-approved adapter (`research.earnings_ai_adapter.get_earnings_ai_evidence`)
   and **never touches a raw Calendar-page payload and never calls a raw provider directly.**
2. **A composer returns evidence items in the shared `_ev()` shape** — an `id`, the value, and its
   provenance. Every domain uses the same shape; a domain with a bespoke evidence shape cannot pass
   the grounding gate, which is the point.
3. **A composer owns its own request-level cache and TTL.** I1 must not add a second staleness
   policy on top.
4. **A composer fails independently.** One composer's failure degrades that domain only; it never
   aborts the answer.
5. **Registration is a code change in `_DOMAIN_FETCHERS`, reviewed** — there is deliberately no
   dynamic/plugin registration. A registry that can be extended at runtime cannot be audited by AST.

**Routing.** `_resolve_domains(question, prior_domains)` maps a question class to a domain subset.
⛔ **Budget: ≤4 composer calls per question**, a property of the routing table, not a runtime
counter to be tuned upward without review.

## 3. The evidence bundle

`_build_evidence(sym, question, …)` assembles the current turn's bundle from the routed subset. It
is **always freshly assembled** — never rehydrated from a client-held snapshot. This is what keeps
cross-fact consistency and the numeric/citation gates working across turns with zero extra
mechanism.

## 4. The grounding gate

`_grounding_flags(data, evidence)` is the chokepoint. For the **current turn's** evidence only:

- `valid_ids = {e["id"] for e in evidence}` — every cited `evidence_id` must be in it.
- `allowed_numbers = _evidence_numbers(evidence)` — every number token in model-authored text must
  be derivable from it (`_number_is_grounded`).
- `_full_text()` unions **every free-text field the model authors** — summary, interpretation,
  key_facts. ⛔ A new model-authored field that is not added to `_full_text()` is ungoverned prose:
  **adding a field to the response schema requires adding it here in the same commit.**

Domain-specific gates compose on top, never replace it: `_rating_grounding_flags`,
`_earnings_false_confirmed_flags`.

## 5. Multi-turn (Slice 3)

A sliding **3-turn** window of **client-transported, server-trimmed structured state**. Never
persisted server-side. No summarization subsystem. No opaque model memory.

⛔ **The epistemic invariant, enforced mechanically and not by instruction:** prior-turn text is
never added to `allowed_numbers` or `valid_ids`. A claim of the form "as I said last time" has
nothing to ground it unless the fact is also real evidence *this* turn.

## 6. The S8 boundary — and its rail

I1 renders through S8's primitives and defines no competing renderer.

**Required rail (NOT YET BUILT — this spec's one new engineering ask):** an AST/import-graph check,
in the shape of the existing `singleWriterIndex.test.js` and `reachable.test.js`, asserting that
every I1-authored composition imports its citation/freshness rendering from
`app/src/components/provenance/` and defines none of its own. ⭐ It must carry a **control** proving
it can still see a real violation — a rail nobody has watched fail is not a rail.

## 7. Response states and failure

`_RESPONSE_STATES = ("answer", "answer_with_caveat", "partially_answer", "ask_for_clarification",
"refuse")`. An unrecognised state coerces to **`refuse`** — fail closed.

## 8. The evaluation contract

`runner.py` replays `golden_set.py` cases; `checks.py` applies mechanical, judge-independent checks;
`judge.py` scores what remains. **Mechanical checks are the floor; the judge cannot override them.**

**Binding on new slices:** new domain ⇒ new golden-set cases ⇒ a new mechanical check wherever the
slice adds a new way to be wrong. The eight checks catalogued in PRD-I1 §7 are the current bar.

## 9. Extensions inventory — reviewed 2026-09-11, grounding-compliant

Two workstreams extended I1 with no contract to extend against. **Both were checked against §4 and
neither violates the grounding rule.** Recorded rather than assumed:

| extension | commit | verdict |
|---|---|---|
| **Composite Rating** (7th composer) | `073aa7d4d` | ✅ compliant — uses the **same** `_ev()`/evidence-id/grounding-gate shape as the other domains and adds its own `_rating_grounding_flags`. Correctly refuses rating-trend questions (no historical store) and refuses to describe Sponsorship as moving the composite. Explicitly documents that it is **not** D2 |
| **Earnings Events** (8th composer) | `073aa7d4d` | ✅ compliant — one canonical adapter, never a raw provider or raw Calendar payload. Adds a **blocking** `_earnings_false_confirmed_flags` preventing the model from upgrading an unconfirmed date to "confirmed" wording |
| **Seam 29** analyst-source outage signal | `ec095a23d` | ✅ compliant — threads a source-status signal into Ask AI; a status-integrity addition, not a new evidence path |

⭐ **The honest finding: the extensions did not erode the contract — they each extended it, adding a
blocking check alongside their new capability.** The convention was already load-bearing before it
was written down. That makes this spec a ratification, not a correction.

## 10. Follow-ups (not spec exceptions)

| # | item | why |
|---|---|---|
| F-I1-1 | **Build the §6 S8-boundary rail** | the Phase 2 defect's only regression test is currently prose |
| F-I1-2 | **Enrich refusals to name the missing thing** | shipped refusals are correct but terse (PRD §8) |
| F-I1-3 | **Golden-set adversarial cases for the §4 hard boundary** | verify no prompt reaches a Buy/Sell/Hold, entry/exit or sizing output |
| F-I1-4 | **`_full_text()` completeness check** | a rail asserting every model-authored field in the response schema is unioned into `_full_text()` — today that is a convention a new field can silently break |

⛔ None of these was built in Wave 1 (docs-only). F-I1-1 and F-I1-4 are the two that protect an
invariant currently held by convention.
