---
id: I1-SPEC
title: I1 Intelligence Layer — the evidence-domain contract, the grounding rule, and the refusal shape
role: narrow build spec, requested by the Terminal-Next one-week roadmap (Day 1) so Day 4-5's A1/A11/A13 AI-touching work has one contract to build against instead of three separately-invented ones
wave: roadmap-2026-09-23
group: ARCH-05 input
category: spec
scope: uct-dashboard (s7-price-level worktree) — api/services/ticker_explain.py, app/src/pages/research/**, app/src/components/provenance/**
confidence: 🟢 high — every claim below is cited to a real file:line, read directly, not paraphrased from PROGRAM_STATUS.md's summary
sources: api/services/ticker_explain.py, app/src/pages/research/tabs/AskAiTab.jsx, app/src/pages/research/i1S8Boundary.test.js, app/src/components/provenance/{Cited,CoverageLine,FreshnessBadge,Provenance}.jsx
status: draft — ready for Day 4-5 builders to use as-is; one open gap noted at the end
date: 2026-09-23
---

# I1 — the contract, not a redesign

This is deliberately narrow, per the roadmap's own instruction: the evidence-domain
contract, the grounding rule, and the refusal shape. It is not an AI architecture
rewrite (MASTER_CHECKLIST.md row 22, ARCH-05, stays NOT STARTED — this is one input to
it, not the whole thing).

**One correction to the roadmap's own framing, found while reading the real code:** I1
is not built around an LLM tool-calling registry the way Compass Chat is
(`coach_chat_tools.py`'s `TOOLS` dict, dispatched by the model choosing which to call).
I1's real shape is simpler and more constrained: a fixed **evidence-domain contract** —
eight named domains, each with a deterministic fetcher, assembled into one evidence
bundle *before* the model ever runs, never chosen by the model at call time. That's a
more decisive design than a tool registry for this specific job (explaining one
security, never deciding), and Day 4-5 builders should copy this shape, not force-fit
Compass's tool-calling pattern onto it.

---

## Part 1 — the evidence-domain contract

`api/services/ticker_explain.py` defines eight canonical evidence domains, each with
its own fetcher and its own evidence-shaping function:

| Domain | Fetcher | Evidence shaper | Member-facing label |
|---|---|---|---|
| news | `_fetch_news` (`:930`) | `_news_evidence` (`:401`) | "news" |
| analyst | `_fetch_analyst` (`:936`) | `_ratings_evidence` (`:415`) | "analyst coverage" |
| financials | `_fetch_financials` (`:964`) | `_financials_evidence` (`:453`) | "financials" |
| estimates | `_fetch_estimates` (`:969`) | `_estimates_evidence` (`:511`) | "estimates" |
| ownership | `_fetch_ownership` (`:974`) | `_ownership_evidence` (`:575`) | "ownership" |
| filings | `_fetch_filings` (`:979`) | `_filings_evidence` (`:658`) | "SEC filings" |
| rating | `_fetch_rating` (`:987`) | `_rating_evidence` (`:702`) | "ratings" |
| earnings | `_fetch_earnings` (`:992`) | `_earnings_evidence` (`:825`) | "earnings" |

The member-facing labels are a **closed vocabulary** (`_DOMAIN_LABEL`, `:2060-2064`),
and the file's own comment states exactly why that matters: *"A CLOSED VOCABULARY is
what makes a derived refusal safe: the sentence can only ever be assembled from these
strings and a symbol, so it cannot carry a fabricated number or a Buy/Sell directive no
matter what the model returned."*

`_classify_domains` (`:325`) and `_resolve_domains` (`:376`) decide which of the eight
domains a given question needs, **before** any model call — domain selection is
deterministic classification, not a tool the model invokes. `_build_evidence`
(`:1017`) assembles the selected domains' fetched-and-shaped evidence into one bundle,
each item carrying a stable `id` the model must cite by (`_grounding_flags` checks
every cited `evidence_id` against this set, `:1981-1986`).

**For Day 4-5 builders adding a ninth domain (or a new AI-touching feature entirely):**
copy this shape — a named domain, a deterministic fetcher, an evidence-shaper that
gives every fact a stable citable id, added to the closed label vocabulary. Do not
invent a tool-calling registry unless the feature genuinely needs the model to decide
*which* data to fetch at call time (I1's job — explain what's already known — never
does).

---

## Part 2 — the grounding rule

The grounding gate is `_grounding_flags` (`:1974-2007`), called after every model
response and **before** anything is returned to the caller. Four checks, all
blocking — any flag triggers a retry with `_retry_note` (`:2039-2051`) naming exactly
what failed:

1. **Every cited `evidence_id` is real** (`:1983-1986`) — checked against the actual
   evidence bundle's ids, not the model's claim about what it cited.
2. **Every number anywhere in the model's free text traces to the evidence**
   (`:1988-1992`), via `_evidence_numbers`/`_number_is_grounded` (`:1525`, `:1558`).
3. **No decisive-verdict language anywhere** (`:1994`, `_decisive_language_flags`,
   `:1567`) — the Buy/Sell/Hold hard boundary is enforced mechanically, not just by
   system-prompt instruction.
4. **Conflicting evidence is surfaced on both sides, never silently picked**
   (`:1996-2002`, Slice 2) — skipped only for `refuse`/`ask_for_clarification`
   states, where there's no verdict to be one-sided about.

**The load-bearing detail, and the one worth repeating to every future builder:**
`_full_answer_text` (`:1959-1971`) unions **every** free-text field the model
authors — `summary`, `interpretation`, `caveat`, `clarification_question`,
`refusal_reason`, and every `key_facts[].statement` — into one string before any check
runs. The function's own docstring states why: *"a decisive verdict or a fabricated
number hidden in `caveat`/`clarification_question`/`refusal_reason` must be caught
exactly like one in `summary`/`interpretation`/`key_facts`."* This closes a real,
previously-shipped hole (`checks._full_text`, the earlier version of this idea,
[never read the refusal sentence, so a fabricated number inside a refusal passed every
mechanical check] — PROGRAM_STATUS.md §"What the rails found," GATE-I1 slice 1
finding).

**The rule for any new AI-touching surface:** if the model authors more than one
free-text field, the grounding check runs on the union of all of them, never on
whichever field the builder happened to remember. A field added later without being
folded into the union is a hole, not an oversight the field can excuse itself from.

---

## Part 3 — the refusal shape

Five response states, defined once (`_RESPONSE_STATES`, `:1172-1173`):

```
"answer", "answer_with_caveat", "partially_answer", "ask_for_clarification", "refuse"
```

Every response the model returns is coerced into exactly one of these — there is no
sixth state and no free-text status field.

**A refusal names what's missing, and the name is derived, never model-authored.**
`derive_refusal_reason` (`:2076`) builds the refusal sentence from the actual evidence
state (which domains were requested, which came back empty) and the closed domain
vocabulary from Part 1 — never from the model's own explanation of its own refusal.
The function's docstring states the rule the gate approval line required verbatim:
*"the named reason must be DERIVED from why the answer could not be grounded — the
absent domain, the empty evidence bundle, the out-of-scope question class — never a
model-authored explanation of its own refusal."*

**One real subtlety, already found and fixed once — don't reintroduce it.**
`_result` (`:2107-2170`) only calls `derive_refusal_reason` as a *fallback*: `caller
_reason or derive_refusal_reason(...)` (`:2135-2136`). The comment at `:2125-2134`
records why: the first version of this replaced every refusal sentence unconditionally,
and it caused real regressions — a cost-budget refusal ("usage limit") became "nothing
was retrieved," telling a member there's no data when the truth is the service stopped
spending; two other refusals lost a more specific reason than the derived one could
produce. **The rule: enrich a refusal that says nothing; never overwrite one that
already says something specific.** A caller-supplied reason is itself derived — from a
budget, an error, an empty verified set — and is strictly better-informed about its own
cause than a generic domain-based derivation can be.

**For Day 4-5 builders:** if your surface can refuse for more than one reason (a cost
cap, an empty result set, an out-of-scope question), pass your own specific reason
through rather than relying on the generic derivation to guess it — and if you do rely
on the generic path, make sure it only ever fires when nothing more specific exists.

---

## Part 4 — the S8 boundary: I1 composes, it never renders its own receipt

This is the third contract piece, and it's enforced as a real, running check, not a
sentence in a doc — `app/src/pages/research/i1S8Boundary.test.js`.

**The rule, mechanically:** nothing in the I1 surface may render citation, freshness,
coverage, or provenance *itself*. It composes S8's four named primitives —
`Cited.jsx`, `CoverageLine.jsx`, `FreshnessBadge.jsx`, `Provenance.jsx`
(`app/src/components/provenance/`) — or it's a finding.

**Why this needed to become a test and not stay a paragraph:** the file's own header
comment records the actual defect — *"Phase 2's adversarial validation found S8 and I1
BOTH claiming ownership of 'the one provenance renderer' — two teams, one concept, each
believing it owned it. The fix was a paragraph in an architecture document. A paragraph
cannot fail, so it is not a boundary."* `AskAiTab.jsx` was found rendering its own
citation list in production before this rail existed to catch it (GATE-I1 slice 1's
first real finding, per `PROGRAM_STATUS.md`).

**How it checks, so a new AI surface can be checked the same way:** an AST parse
(never a grep — a text search for "citation" matches the import line, a comment, and
unrelated prose) of the actual mounted surface (`ResearchPage.jsx` plus everything the
Ask-AI tab transitively imports), asserting no JSX element or className anywhere in
that surface's own code uses the citation/freshness/coverage/provenance vocabulary —
that vocabulary is itself derived from S8's primitive component names, so a fifth S8
primitive is guarded automatically without editing this test.

**Known, stated limit (not a gap to silently inherit):** the rail sees JSX element
names and className keys, not bare-text rendering (`{c.source} · {c.date}` is
invisible to it) — a real limit, named in the file's own comments. And it only guards
the Ask-AI tab's surface by construction; `ComparisonAskAi.jsx` (a different door, from
the compare page) draws its own citation list through the same S8 classes and is
**outside this rail's surface today** — a known, named, not-yet-decided widening, not
a secretly-covered case.

**For Day 4-5 builders:** any new panel that shows AI-authored, cited content composes
one of these four S8 primitives. If a fifth primitive is genuinely needed, add it to
`components/provenance/` and the boundary rail picks it up automatically — do not
build a bespoke citation renderer for a new surface, even a small one.

---

## Summary — the contract in one paragraph, for a builder in a hurry

Define your feature's evidence domains as fixed, deterministically-fetched buckets
with stable citable ids and a closed member-facing vocabulary (Part 1). Union every
free-text field your model authors and run the grounding check against that union,
never against just the "main" field (Part 2). Coerce every response into one of a
small, fixed set of named states, and if you refuse, derive the reason from the real
evidence gap unless you already have a more specific one (Part 3). Render citations,
freshness, and coverage only through S8's existing primitives — never build your own
(Part 4).

## Open gap, stated rather than papered over

`ComparisonAskAi.jsx`'s citation rendering is real, shipped, and outside every existing
boundary rail's surface (Part 4's "known, stated limit"). Whoever builds a compare-page
AI feature this week inherits this gap unless they either widen `i1Surface`'s roots in
the boundary test (a one-line change, per the test's own comment) or explicitly decide
not to and say so in their own PR. This spec does not resolve that decision — it's the
kind of call the roadmap's Rule 6 (shared-substrate ownership) says should be made
once, by whoever's wave touches it, not silently inherited.
