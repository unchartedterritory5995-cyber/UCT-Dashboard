# F-I1-2 — before/after refusal text, the gate's condition (3)

> Gate condition (3): *"Before/after refusal text for the owner, on the real out-of-scope
> classes (transcripts, Calendar/Events, portfolio, rating-trend)."* Produced here as an artifact
> so it can be read after the fact rather than gating the build on a human.

The eight evidence domains are `news · analyst · financials · estimates · ownership · filings ·
rating · earnings`. **Transcripts, Calendar/Events, portfolio and rating-trend are not among
them** — which is exactly why questions about them refuse.

| situation | BEFORE | AFTER |
|---|---|---|
| transcripts question, bundle has news + analyst | *"I cannot answer that."* | **"What I can read for NVDA covers news and analyst coverage. The answer is not in it."** |
| Calendar/Events question, bundle has filings | *(empty reason)* | **"What I can read for NVDA covers SEC filings. The answer is not in it."** |
| portfolio question, nothing retrieved | *(empty reason)* | **"I have no evidence for NVDA at all — nothing was retrieved, so there is nothing to answer from."** |
| rating-trend question, bundle has ratings | *(empty reason)* | **"What I can read for AAPL covers ratings. The answer is not in it."** |
| **cost budget exhausted** | *"Daily usage limit reached."* | **unchanged — "Daily usage limit reached."** |
| model supplied its own reason | *"Forward estimates are not in my evidence set."* | **unchanged** |

## ⚰️ The first version of this was wrong, and the existing suite caught it

It replaced **every** refusal sentence. Three tests went red, and one of them was a genuine
member-facing harm: a **cost-budget** refusal (*"usage limit"*) became *"nothing was
retrieved"* — **telling a member there is no data when the truth is the service stopped
spending.** Two others lost a reason more specific than the derived one.

⭐ **The intent is to enrich a refusal that says NOTHING, never to overwrite one that already
says something.** A caller-supplied reason is itself derived — from a budget, an error, an empty
verified set — and knows its own cause better than a function reading the evidence bundle can.
So the rule is **derive to FILL, never to REPLACE**, and `test_a_refusal_that_ALREADY_names_its_
cause_is_left_alone` is the standing rail. Mutation-proved: restoring the overwrite reds four.

## Conditions, honestly

| # | condition | state |
|---|---|---|
| 1 | the derived reason goes through `_full_text()` and so the grounding gate | ✅ **already structural** — slice 1 put `insufficient_evidence_reason` inside the union; a derived sentence travels the same path |
| 2 | golden-set cases proving an enriched refusal fails no mechanical check | ✅ 13 cases in `tests/test_ticker_explain_refusal_names_the_gap.py`, incl. **no digit can appear in a derived reason** — the slice-1 hole was a fabricated NUMBER inside a refusal |
| 3 | before/after text for the owner | ✅ this file |

⚠️ **AND ONE CLAUSE IS ONLY PARTLY MET, WHICH IS WORTH SAYING PLAINLY.** The gate says the named
reason must be *"never a model-authored explanation of its own refusal."* A **derived** sentence
satisfies that. But where the model supplies its own reason, that sentence is still served —
because suppressing it would have meant overwriting the budget and verified-set reasons too, and
the suite proved that direction does real harm. ⭐ The mitigation is slice 1's, and it holds: a
model-authored refusal sentence is inside `_full_text`, so a fabricated number or a Buy directive
hidden there is caught mechanically. **Full compliance would need the caller to distinguish a
server reason from a model reason at `_result`, which is a signature change and a separate unit.**
