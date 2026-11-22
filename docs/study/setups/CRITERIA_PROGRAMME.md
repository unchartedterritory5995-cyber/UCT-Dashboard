# Setup criteria programme: from 44 research dossiers to the rules we build questions and courses on

The owner, 2026-11-09: *"find any places we can improve our awareness, recognition, knowledge base everything to get it
to a much higher level of quality and examples so we can establish all of the criteria for the content and rules that
we can build questions and courses around."*

The 44 dossiers in `research/` (about 794,000 words, 1,247 sources, every one cold-checked) hold the knowledge. What
they do not yet give the course builder is a uniform, measurable statement of each setup. An audit on 2026-11-09 found:

1. The proposed rules (section 8) are written three different ways (bullets, numbered lines, tables) with uneven basis
   tags; nothing can read them mechanically.
2. 596 numbered owner questions across the dossiers; many are one decision repeated per setup (20 versus 21 EMA, the
   RS threshold, which stop, the chase limit).
3. Every charted example is a winner: no failure charts, no near-misses, nothing a member can learn "what it is not" from.
   The method plan (`UNITS-method.md`, rule 5) requires at least one correctly traded loss per setup unit.
4. 21 dossiers say nothing about look-alikes (Flat Base against VCP against Cup; Kicker against a plain gap).
5. Shared words drift between dossiers: "tight", "dry-up", "prior trend", "a few cents", "high volume".

**Status 2026-11-10:** all four deliverables built and committed; `CARD_NOTES.md` holds what the writers flagged and what the chart run corrected. Nothing is a ruling until the owner answers `DECISIONS.md`.

## The four deliverables

| # | Deliverable | Where | Built by |
|---|---|---|---|
| 1 | **A criteria card per setup**: the house five-field card (context, pattern, trigger, stop, failure mode) with every criterion measurable, tagged with its basis and sources, and flagged when it waits on an owner decision; grading marks; look-alikes with the one test that separates them; invalidations; common mistakes; the short mirror; question seeds. Schema below; `scripts/study/criteria_lib.py` validates; `tests/test_study_criteria.py` runs it over every card. | `criteria/NN-slug.json` | a pilot on Flat Base, then all 44, from the dossiers only (no new research) |
| 2 | **The decisions register**: the 596 questions collapsed into deduplicated decisions, shared ones first, each with the setups it touches, the options, the evidence and a recommended default. | `DECISIONS.md` | one reader of every section 10 |
| 3 | **The glossary of shared measurable terms**: one definition each, the canonical threshold, which setups override it and why; the cross-dossier conflicts listed. | `GLOSSARY.md` | one reader of every section 8 |
| 4 | **Failure and near-miss charts**: per setup, 4 valid setups that stopped out (traded by the rules) and 4 near-misses that fail exactly one named criterion, each labelled with the criterion id; side-by-side sheets for the confusable pairs. | `_study-resume/scratchpad/setups/NN-slug/final/fail_*.png`, `near_*.png`, section 13 of the dossier | after the cards, from the existing scan hits |

Nothing here is a ruling. Every `status: "pending-owner"` criterion waits for his word; his rulings go verbatim into
`docs/study/audits/2026-10-24/owner_verdicts.jsonl` and then into the card.

## The criteria card (schema)

One JSON file per setup, UTF-8, LF, indent 1. Plain short sentences; no em-dashes; the member-facing fields
(`statement`, `grade`, `lookalikes[].tell`, `mistakes`) read like the courses (`docs/study/VOICE.md`).

```json
{
 "setup": "01-flat-base",
 "name": "Flat Base Breakout",
 "unit": "SET.07",
 "direction": "long",
 "timeframe": "daily",
 "dossier": "docs/study/setups/research/01-flat-base.md",
 "as_of": "2026-11-09",
 "card": {
  "context": "one or two sentences: where it happens (trend, stage, leadership, market)",
  "pattern": "one or two sentences: the shape a member looks for",
  "trigger": "one sentence: the exact event that makes it a buy, and which of the four entry triggers it is",
  "stop": "one sentence: where the stop goes and why",
  "failure_mode": "one or two sentences: how it fails and what that looks like"
 },
 "entry_trigger": "BASE BREAKOUT | PREV DAY HIGH BREAK | PREV LOW RECLAIM | RED TO GREEN | OTHER",
 "criteria": [
  {
   "id": "fb.prior_trend",
   "field": "context | pattern | trigger | stop | management | invalidation",
   "statement": "The left-side high is at least 30% above the lowest low of the 65 sessions before it.",
   "measure": {"what": "left-side high / lowest low of prior 65 sessions - 1", "op": ">=", "value": 30, "unit": "%", "timeframe": "daily"},
   "glossary": "prior_trend",
   "basis": "originator | source consensus | UCT | house rule | my proposal | measured",
   "sources": ["S1", "S4"],
   "house_rule": "C31",
   "options": [{"value": 20, "basis": "O'Neil via Bonde"}, {"value": 25, "basis": "flat_base.py"}],
   "recommended": 30,
   "status": "settled | proposed | pending-owner",
   "owner_question": "D-012",
   "gate": true,
   "grade_cue": false,
   "dossier_ref": "8.1 Prior trend",
   "evidence": "optional: what our own scan measured about this line (section 12)"
  }
 ],
 "grading": {
  "a_plus": ["observable marks, each one a criterion id or a short sentence"],
  "b_minus": ["..."],
  "no_trade": ["..."]
 },
 "lookalikes": [
  {"setup": "06-vcp", "tell": "One sentence a member can apply on a chart: the test that separates the two.", "criterion": "fb.depth"}
 ],
 "invalidations": ["short measurable sentences, each tied to a criterion id where one exists"],
 "mistakes": ["the common mistakes, from the dossier"],
 "short_mirror": {"exists": true, "setup": "16-wedge-drop", "note": "or why there is none"},
 "best_conditions": "one or two sentences",
 "management": {"trim_1": "a third at 3R (B19)", "trim_2": "a third at 5R (E51)", "trail": "10-day for fast movers, 21-day for steadier (E52)", "breakeven": "at the first trim (B19)", "overrides": "setup-specific trail or trim, with its basis"},
 "examples": {"winners": 10, "sheet_dir": "_study-resume/scratchpad/setups/01-flat-base/final", "base_rate": {"hits": 3849, "r3_pct": 28.9, "r5_pct": 20.0, "window": "60 sessions, fixed stop"}},
 "question_seeds": [
  {"kind": "recall | spot | discriminate | scenario | grade | numeric", "criterion": "fb.prior_trend", "seed": "one line: what the question asks"}
 ],
 "owner_decisions": ["D-012", "D-031"],
 "conflicts": ["where sources or dossiers disagree and what the card did (owner-only)"]
}
```

Rules the validator enforces: every criterion has an id (`<setup prefix>.<snake>`), a field, a statement, a basis, a
status; a `measure` whenever the statement carries a number; `sources` that exist in the dossier's section 11 (`S1`
style ids) unless the basis is `house rule`, `UCT` or `my proposal`; a `house_rule` id that exists in
`docs/study/sizing_rule.md` section 9 when the basis is `house rule`; `glossary` ids that exist in `GLOSSARY.md`;
`owner_question` ids that exist in `DECISIONS.md`; at least two lookalikes, each naming another card; at least three
question seeds of three different kinds; the five card fields present and under 60 words each; no em-dashes.
