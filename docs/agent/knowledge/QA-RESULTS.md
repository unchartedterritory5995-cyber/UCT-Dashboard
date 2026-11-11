# KN-1 QA results (2026-11-03)

Counts and labels only. No knowledge content, no market values. Real-snapshot runs were made locally against the `uct-brain` snapshot of 2026-11-01 (pack layout rebuilt in the session scratchpad, never committed, never uploaded).

## 1. Source coverage under the default-deny policy (real snapshot, 19,024 active KB rows)

| Policy state | Rows | Sources |
|---|---|---|
| admitted | 5,270 | `trader_archive` (5,172), `setup_knowledge` (98) |
| pending (not approved; owner candidates) | 1,843 | `self_review` (1,840, the brain's own AI review), `manual` (3) |
| excluded | 11,890 | every `intake:*` class |
| unknown (default-deny) | 21 | the chart case studies: their source strings carry a per-file suffix, so they do not match the exact `chart_intake` key and fall to default-deny (excluded either way) |

| Licence class | Rows | Admitted? |
|---|---|---|
| team_owned | 5,270 | yes |
| substack_intake | 4,806 | no — Substack intake, licensing unresolved |
| third_party_attributed | 4,438 | no — tweets / X and YouTube intake |
| unresolved | 2,667 | no — Discord intake, numbered intake documents, unknown sources |
| firm_generated | 1,840 | no — pending owner approval |
| firm_curated | 3 | no — pending owner approval |

Duplicates collapsed at index time: 158. Setup templates: 48 (firm-curated, served by `setup.playbook`). Statistics tables: `setup_performance` 25 rows (refreshed 2026-10-30), `trigger_performance` 69 rows (2026-10-31).

## 2. Real-snapshot demonstration (local only)

| Request | Result | Latency |
|---|---|---|
| knowledge.search "What does UCT mean by an episodic pivot?" | ok, 2 team-owned SETUP passages, cited | 6 ms |
| knowledge.search "patience and discipline" | ok, 2 team-owned PSYCHOLOGY passages | 11 ms |
| knowledge.search "volatility contraction pattern" | ok, team playbook SETUP + PRINCIPLE | 11 ms |
| knowledge.search "where to put the stop on a flag breakout" | ok, RULE + SETUP | 16 ms |
| knowledge.search "is the market in an uptrend" (include_dated) | ok, one dated MACRO read inside 30 days, marked dated | 13 ms |
| setup.playbook EP / VCP / U&R / kicker | ok, template with 12 fields + Setup Library link | 4–47 ms |
| setup.playbook "high tight flag" | **refused by name**: the alias belongs to two templates (HTF, Tight Flag) | 2 ms |
| setup.record EP | engine n = 513, descriptive (not controlled); triggers n = 10 → withheld | 5 ms |
| setup.record VCP / HTF | all blocks below n = 30 → no figure | 5–6 ms |
| setup.record Tight Flag | triggers n = 100, descriptive; engine → withheld | 4 ms |

Index build over the full snapshot: 0.66 s. No external call is made on any path.

**Data finding for the partner:** the alias "high tight flag" is attached to two templates. The Agent refuses rather than guesses; the fix belongs in the partner's templates.

## 3. Deterministic test results (free; synthetic fixtures)

| Suite | Result |
|---|---|
| `tests/test_uct_agent_knowledge.py` (server: policy, freshness, injection, conflicts, statistics, update, access, isolation, hooks, review regressions) | 67 passed |
| `app/src/agent/agentKnowledge.test.js` (capabilities, dark/served, rendering) | 13 passed |
| `app/src/agent/agentKnowledgeCompare.test.js` (with vs without Brain, dark routing) | 74 passed (with the 3 previously regressed files: 132) |
| Full Agent server suite + brain tests, head 68c401482a | 2,148 passed, 1 failed (clock rail, caused by this branch, fixed in 3f3afea069) |
| Full Agent browser suite, head 68c401482a | 2,576 passed, 3 failed (dark-routing regression + isolation rail, caused by this branch, fixed in 3f3afea069) |
| Full Agent server suite + brain tests, head f9a03577da | 2,156 passed, 0 failed |
| Full Agent browser suite, head f9a03577da | 2,653 passed, 6 skipped, 0 failed |

## 4. With vs without Brain retrieval (deterministic routing comparison)

| Prompt set | Without the Brain | With the Brain |
|---|---|---|
| 20 knowledge-shaped prompts (concepts, templates, records) | 0 / 20 reach any knowledge capability: the model would answer from its own training | 20 / 20 select the playbook group by their own words and carry the expected capability |
| 8 control prompts (chart, indicator, quote, breadth, layout, screen, news, watchlist) | unchanged | 0 / 8 match the knowledge group |
| 4 phrasings that regressed in review ("What is a pullback, in plain words?" …) | routing exactly as before (nothing new recognised) | — |

A paid real-model comparison (answer quality with and without the passages) is NOT run: no paid evaluations are authorised.

## 5. Independent review

Round 1 (diff-only subagent): 2 blocking (dark routing changed; a possible 0 % rate from a count alone), 7 non-blocking. All fixed in 3f3afea069 and f9a03577da with a regression test each, except finding 8 (with the feature ON, a message matching only the playbook group narrows the routed request), recorded as a known limitation for the integrator.

Round 2 (diff-only, on the fix commits): 0 blocking. Fixed in 8a4993b520: a live facade figure was withheld when the pack had no row; the rebuild cooldown delayed a new pack; a redundant assertion. Recorded: routing words never disarmed at runtime (latent); a rate without a win count is withheld (fails closed).

## 6. Relevance improvement (K-14)

Query expansion from the pack's own template aliases (data-driven; whole-word matching, so "ep" never fires inside "step"; a shared alias expands to both templates). Real snapshot, 6 shorthand questions (EP, U&R, VCP, HTF, kicker, PEG), k = 3: top passages that name the setup in full went from 7 of 14 to 9 of 13; no question returned nothing in either run. Lexical retrieval still misses paraphrase; embeddings stay out by design (no external calls).
