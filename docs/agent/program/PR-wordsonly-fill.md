# PR: wordsOnly groups never ride routing v2's fill

**Branch** `agent/pl/wordsonly-fill` from master `a15b666119` (#1027). Evidence class: LOCAL / deterministic (vitest, no model, no backend).

## Bug
#1027 added `wordsOnly` routing groups (`watchlistShow`, routing.js GROUPS), meant to be sent only when their own words match. v1's fallback already honoured that (`selectGroups` `filler`), and 40ce2e82a0 kept them out of v2's BM25 index. But routing v2's step-6 fill (`routeManifestV2`) packed `GROUPS.map(g => g.id)`, i.e. every group. On requests v1 did not recognise, `watchlistShow` rode the fill and took the room that `definitions` (139 requests) or `indicatorAlerts` (3) had before #1027. Over the evidence sets it was in 153 master first calls; 150 of those had nothing in the words naming it.

## Fix (app/src/agent/nlm1/routingV2.js, `routeManifestV2` step 6, ~line 247-250)
The fill's group list is now `GROUPS.filter(g => g.id !== 'charts' && (!g.wordsOnly || wordsSelect(g.id, message)))`. That is the same rule as v1's `filler`. Nothing else changed: no new tie or size rules, no regex changes, no pins.

## Every pack-all / fill path (AUDIT (a))
| path | wordsOnly before | now |
|---|---|---|
| v2 `routingV2.js:routeManifestV2` step-6 `fill` (l.247-250) | **packed every group** (the bug) | excluded unless its words match |
| v2 `routingV2.js:selectGroupsV2` unmatched return `{...v1}` (l.143) | v1's `priority` (already filtered) | unchanged |
| v2 `weak` / `evidenced` / `lead` tiers (l.204-233, from scores) | not scored since 40ce2e82a0 (`capabilityIndex.js` l.161-166) | unchanged |
| v2 `context` tier (l.237, vocabulary.json `related`) | no `related` entry names a wordsOnly group | unchanged |
| v1 `routing.js:selectGroups` `filler` (l.460-461) | already excluded (#1027) | unchanged |
| v1 `routing.js:routeManifest` unrecognised order (l.527-528) | packs `priority` from selectGroups, already filtered | unchanged |
| NL-1 `nl1/selection.js:selectNl1` (l.85) | goes through v1 `routeManifest` (filtered) | unchanged |
| "full manifest when it fits" (routing.js l.502, routingV2.js l.293, nl1 `assembleNl1` l.110) | sends the WHOLE manifest only when the whole manifest fits the limit, so nothing is displaced. This is not a fill. | unchanged (v1-identical) |

## Rails (AUDIT (b), (e))
`app/src/agent/nlm1/nlm1Routing.test.js`, describe "routing v2: a words-only group never rides the fill…". It is generic over `GROUPS.filter(g => g.wordsOnly)`:
- every wordsOnly group must have phrases of its own words in `OWN_WORDS`. A new group (e.g. #1073's compareGroups) fails the rail until it adds them.
- 7 unrecognised requests (fill on): the v2 first call has no wordsOnly group.
- each group, on its own words: `wordsSelect` is true AND the v2 first call carries it (watchlistShow: 3 phrases).
- v1 rail unchanged: `agentRouting.test.jsx` "words-only groups never fill…".

**Mutant** (the fill's filter replaced by `true`, i.e. a wordsOnly group back in the fill): **6 failed | 56 passed (62)**. The 6 are the unrecognised-request rows ("hmm" never reached watchlistShow even on master). Restored and verified green. Output: `evidence/wordsonly-fill/mutant-wordsonly-in-fill.txt`.

## v2 first calls, master vs fix (AUDIT (c))
3650 requests, the #1027 method: lookbehind corpus, NLM-1 dev, NL-1 corpus/dev-nl1/heldout-v1/heldout-v2, agentExec held-out and tune sets. **150 differ.** Each one is master minus `watchlistShow`, plus `definitions` (139), `indicatorAlerts` (3) or nothing (8). No other group moved.
in→in 23 · out→in 0 · out→out 3 · **in→out 0** · no expectation 124. Rows with an expectation: in on master 676/789, with the fix 676/789. The 3 first calls that still carry watchlistShow are named by its words (unchanged).
Table: `docs/agent/program/evidence/wordsonly-fill/v2-first-calls.md`.

## Focused runs (AUDIT (d))
- Run A (16 files, 2255 passed): the 4 count pins (agentRouting FULL 163; agentScreener; agentNl1Selection core; agentIndicatorsM2), routeReachability (unchanged, 8/8), agentNoLookbehindEquivalence (no frozen row changed), noRegexLookbehind, capreg corpus.routing / corpus.routingV2 / inventory / routingCollision(V2), agentContracts, nlm1Routing, routingV1Identity, devMetrics. `evidence/wordsonly-fill/runA.txt`
- Run B (4 files, 157 passed): agentNl1SelectionCoverage: corpus 174/182, dev-nl1 43/43, heldout-v1 164/165 first call (budget 55); NL-1 is v1-only, so these are unchanged from master by construction. agentExecReach: all pins hold; list held-out v2 8/8; widget held-out v2 21/24 (misses C3-170, C3-151, C3-152, as on master). agentScanSat1Requests green, SAT-1 did not move. golden green. `evidence/wordsonly-fill/runB.txt`
- Nothing regenerated (golden / parity / capreg / SAT-1 did not move).
