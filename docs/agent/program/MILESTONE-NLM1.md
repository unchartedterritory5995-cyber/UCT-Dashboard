# MILESTONE NLM-1: "Flexible understanding" (Track B, next-generation Agent intelligence)

**Status: DARK, not merged, not deployed.** Branch `agent/nlm1/flexible-understanding` (worktree `C:/w/nlm1`), draft PR #790. Stacked on Track A's `origin/agent/w2/live-train4-fixes` at `7be34d2dd9` (CG-37 `createdBinding`), as AUDIT directed. Re-merge it when AUDIT says it is final. The NLM-1 commits are separate, so they rebase cleanly.

No production behaviour change: with the flag off, v1 routing is byte-identical (a frozen sha256), and every NLM-1 code path is gated. No spending-limit change, no paid call, no model change. F-16/F-23 model isolation is untouched: routing only changes which capabilities the model sees, and every op is still re-validated against the full registry, the approval policy and the protected-layout checks.

## 1. Scope

| Deliverable | What | Where |
|---|---|---|
| D1 | Registry-derived capability discovery: a lexical index generated from the capability manifest, a curated trader vocabulary (data), entity typing, a context-aware selector within the existing budget; v1's regexes kept as the boost / fallback layer | `app/src/agent/nlm1/capabilityIndex.js`, `routingV2.js`, `vocabulary.json`, `routers.js` |
| D1.1 / D1.2 | Held-out follow-ups (AUDIT, structural): weak evidence never costs v1's fallback; critical groups; context-aware expansion; undo signal; percent-move screens; routed size trimmed | same files; `devMetrics.test.js` |
| D2 | Multi-step plans with references: "add a chart for AMD and put RSI on it / on both", "… with RSI", plus grouped Undo for the whole request. Built on Track A's `bindCreated` (the create op's alias, resolved to the committed widget's id), through the existing executor and runtime | `nlm1/plans.js`, `nlm1/followups.js` (`rewriteSameRequest`), thin hooks in `useAgent.js` |
| D3 | Conversational context: a referent tracker (the last committing message, read into slots: ticker, chart position, timeframe, created?). It rewrites "same for QQQ", "now the right one too", "same on the left but weekly", "and one for QQQ", "the other one monthly", "do that for the top right and bottom left charts" and "it = the chart the last request named" into the explicit forms the existing readers execute | `nlm1/followups.js`, hook in `useAgent.js` |
| D4 | This document | `docs/agent/program/MILESTONE-NLM1.md` |

No competing action engine: D2/D3 only rewrite text, or bind a plan's own alias. Everything then goes through the same readers (fastPath / multiChart / compound / conversation), planner, approval policy, protected-layout checks, runtime, receipts and grouped Undo (#771). A rewrite that no reader claims is dropped, and the message goes on exactly as typed.

## 2. Switches: ON by default since PACKAGE 1 (owner policy 11-04); the two keys are KILL SWITCHES

Owner policy (11-04): UCT has no members, so tested features go live for admins (the Agent is admin-only server-side). No dark flags or activation steps without a concrete reason. NLM-1 routing, the follow-up mechanisms and the step-plan executor are therefore ON by default. The in-plan rules stay default OFF for a concrete reason: they measurably do not generalise, and one costs a sealed pass.

| Kill switch | Where | Default |
|---|---|---|
| `UCT_AGENT_ROUTING_V2=0` (or false / off / no) | server env, reported as `routing_v2` by `GET /api/agent/config` (`api/routers/uct_agent.py`): off for everyone | ON (unset) |
| `localStorage uct.agent.routingV2 = '0'` (`window.__uctAgentRoutingV2(false)`) | one browser | ON (unset) |

The config not answered (or failed) means v1. With either switch off, the panel is v1, byte-identical to master (fingerprint below; capreg with `CAPREG_NLM1=off`). The rest of this section describes the original two-key dark gate (D1–step plans, before PACKAGE 1).

| Key (before PACKAGE 1) | Where | Default |
|---|---|---|
| `UCT_AGENT_ROUTING_V2=1` | server env | off |
| `localStorage uct.agent.routingV2 = '1'` | the admin's browser | off |

Only both keys on enable NLM-1 (`nlm1/flag.js routingV2Active`): routing v2 (`pickRouter`), the D2/D3 rewriter and created-reference plans, and request-level Undo grouping. Anything else, including a config that hasn't answered, errored, or has unavailable storage, means v1.

**Third key, the IN-PLAN rules (default OFF; AUDIT-approved risk reduction):**

| Key | Where | Default |
|---|---|---|
| `localStorage uct.agent.nlm1.inplan = '1'` (`window.__uctAgentNlm1Inplan(true)`) | the admin's browser, on top of the two keys above | off |

Behind it are the rules no sealed pass ever took (`nlm1/inplan.js`); see "In-plan key" below.

Hooks in production files, all gated: `useAgent.js` (`pickRouter` at the two routing calls; the rewrite before the readers; `planCreatedReference` in the fast path and in `runCompound`; Undo grouping after `execute` and `runCompound`), `agentClient.js` (`routing_v2` read), `memory.js` (`lastTurn().id`, additive). `routing.js` is untouched.

## 3. Acceptance results

### D1: routing

| Criterion | Result |
|---|---|
| (a) capreg corpus routes 100% with the flag on; no intent loses its owning group | **488/488** (`qa/capabilityRegression/corpus.routingV2.test.js`): every needed action sent, none cut by the budget, within budget, no v1 owning group lost |
| (b) routing-collision table | **35/35** words-only (unchanged v1 table; v1's regexes are v2's boost layer) and **35/35** v2 (owner recognised, selected and ranked in the top 2: `routingCollisionV2.test.js`) |
| (c) independent held-out paraphrases, routing recall ≥ 95% within the current budget | scored by AUDIT on the sealed set (317 phrasings; this track never read it). See the table below |
| (d) flag off: byte-identical routing (hash) | sha256 over 2268 `routeManifest` answers (corpus, collisions, golden steps × 4 contexts) equals the fingerprint frozen from pristine code: master `c87ab6d578` and the stacked Track A base `7be34d2dd9`; also through the two-key gate states (`nlm1/routingV1Identity.test.js`) |

Held-out (sealed set, scored independently by AUDIT; aggregates only):

| Metric | v1 | D1 `9a912420cc` | D1.1 `09512d5def` | D1.2 `92893dca0f` | D1.3 `799d3419a5` |
|---|---|---|---|---|---|
| Raw availability (needed actions sent) | 95.3% | 93.7% | 97.2% | 96.8% | **97.8%** |
| Own-groups recall (router's own selection) | 78.2% | 90.9% | 94.3% | 95.0% | **95.9%** |
| Broad fallback | 18.0% | 3.2% | 0.6% | 0.6% | **0.6%** |
| Avg actions per request (budget 55) | 24.9 | 31.5 | 36.8 | 28.9 | n/a |
| Avg / largest manifest bytes | 24.5 / 55.4 KB | n/a | n/a | 28.2 / 59.3 KB | **27.9 KB / = v1's largest** |
| Capabilities below v1 | (none) | 5 | 1 (screener.run) | 1 (news.latest, ticker asks without "news") | **none**; nothing v1 recalls is missed |

D1.3 fixes, all structural: composite entities (a ticker plus an information-seeking ask points at data/news; a ticker plus a period-change shape points at data), and a byte budget so no request exceeds v1's own fallback request for the manifest.

Per-turn cost of the larger routed set, at #785's byte bound (`budget.worst_case_usd`: every request byte counted as an input token billed as a cache write, priced by `narrative_cost_guard.estimate_cost` on `claude-haiku-4-5`, the default `UCT_AGENT_MODEL`): $0.00128 per extra KB. That is +$0.0047 per turn for the held-out D1.2 average delta (+3.7 KB, 1.9% of the $0.25 per-turn cap), +$0.0064 for the corpus D1.3 delta (+5.0 KB, 2.5%) and +$0.0024 for the dev delta (+1.9 KB, 0.95%). The largest request can no longer exceed v1's. Getting the average to ≤ v1 + 5% (packing v2's extra groups on v1-recognised messages only at score ≥ 6) cost about 4 points of dev availability (99.4% to 95.1%), so it is not taken. The knob (`TUNING.MATCHED_ADD`) is there if the owner prefers bytes.

Dev metrics harness (`nlm1/devMetrics.test.js`, `NLM1_METRICS=1` prints the tables). Its gates: own ≥ 90%, availability ≥ v1, no capability below v1, no single message v1 routes fully that nlm1 does not:

| Set | Router | Own-groups | Fallback | Availability | Avg actions | Avg groups | Avg manifest bytes |
|---|---|---|---|---|---|---|---|
| capreg corpus (488) | v1 | 94.9% | 5.1% | 100.0% | 21.5 | 3.1 | 20,395 |
| | nlm1 (D1.3) | **99.8%** | **0.0%** | 100.0% | 26.8 | 3.7 | 25,473 (largest 55,357 = v1) |
| dev tuning set (162, this track's) | v1 | 63.0% | 27.8% | 87.7% | 29.1 | 4.6 | 28,987 (largest 56,319) |
| | nlm1 (D1.3) | **98.1%** | **0.0%** | **99.4%** | 31.5 | 5.0 | 30,884 (largest 55,357) |

Prompt-size delta (D1.2): +5.1 KB of manifest JSON per turn on the corpus (+25%), +2.8 KB on the dev set (+10%). D1.1 was +13.8 KB on the corpus. The per-turn cost cap (#785) reserves on bytes, so this is the activation input for the paid eval's cost check.

### D2 + D3: final workspace state plus Undo (`nlm1/nlm1Workflows.test.jsx`, `nlm1/baseline/workflows.json`)

40 cases (18 D2 multi-step / same-plan references, 22 D3 cross-turn), capreg golden-workflow format, replayed through the real panel and asserted on the FINAL WORKSPACE STATE (charts, symbols, timeframes, indicators, colours) and on Undo restoring it exactly. No model anywhere (`modelTurns: 0`).

| Mode | Pass | Notes |
|---|---|---|
| Flag OFF, master `c87ab6d578` | 14/40 | D2 4/18, D3 10/22 |
| Flag OFF, + Track A `7be34d2dd9` | 18/40 | createdBinding's production fix |
| **Flag ON (NLM-1)** | **38/40 + 2 recorded gaps** | D2 16/18 + 2 gaps, D3 22/22 |

Acceptance: D2 needs ≥ 15 golden multi-step / cross-turn workflows passing with grouped Undo restoring exactly: **16** (D2-01..12, 14..17). D3 needs ≥ 20 cross-turn cases: **22**.

#### D2/D3.1: mechanisms, after AUDIT's sealed-set result (17/37 flag on, 14/37 off at `799d3419a5`)

AUDIT's finding was that the D2/D3 rewriter generalised poorly beyond the phrasings it was built on. D2/D3.1 replaces phrase templates with mechanisms (`nlm1/followupOps.js`, plus same-request normalisations in `nlm1/followups.js`):

| Mechanism | What it does |
|---|---|
| Chart referent sets | A target phrase resolves to charts from the live board's geometry: positions ("top right", "the bottom two", "the left two"), quantifiers ("the other three", "the other two on the bottom", "the others", "both", "all of them"; a count that doesn't match gives no reading), ordinals (the charts the last request created, in creation order, else board order), tickers, and lists of these |
| Repeat / additive | The last committing request's ops (what the runtime committed) re-aimed at each chart of the set; an indicator said as an addition ("and macd too") goes on the charts the last request touched |
| Inversion | "back to <value>" sets that value; "back", "back to the previous …" or "put the first one back" restore the value from before the last request (a per-turn snapshot of each chart's symbol and timeframe), only for what that request changed |
| Removal by position | "remove it from the right one" / "take it off the bottom two": the indicator the conversation last added, found by what it is (defId + length) on each chart; more than one match means a question, never a guess |
| Ordinals over created charts | "make the second one weekly" after (or within) a request that made several charts: counted among those charts (main path and `runCompound`'s working set) |
| Same-request normalisation | Multi-ticker creation ("AMD and QQQ charts, both with RSI" / "with the 21 ema on each") becomes the grid and each-with readers' form; a clause's "add X to it" never crosses into the clause before it; a verb is distributed over a coordinated indicator list ("put RSI and MACD on it") |

Generalisation set (`nlm1/baseline/workflows2.json`: 23 cases in AUDIT's categories a–f, written after them, no sealed texts seen), plus the first set (40):

| Mode | First set (40) | Generalisation set (23) | Total |
|---|---|---|---|
| Flag OFF (with Track A) | 23/40 | 3/23 | 26/63 |
| Flag ON, before D2/D3.1 | 38/40 + 2 gaps | 4/23 | n/a |
| **Flag ON, D2/D3.1** | **38/40 + 2 gaps** | **22/23 + 1 gap** | **60/63 + 3 recorded gaps** |

By category, flag ON: (a) in-plan 4/5 + 1 gap, (b) quantifiers/positions 6/6, (c) revert 5/5, (d) additive 4/4, (e) removal by position 2/2, (f) Undo after a follow-up removal 1/1. (f) works flag-on; flag-off it never gets that far (the removal goes to the model), so there is nothing to route to Track A.

**(a) Decision: in-plan multi-step is handled deterministically where the readers can take the sentence's explicit form, and otherwise by the planner.** `NLM1_WF_MODE=planner` (planner-assisted measurement) answers each (a) step with its scripted canonical plan through the real panel and checks the step's routes under routing v2. Result: 4/5, and every canonical plan's actions are routed. The one failure (G-a3) executes correctly and fails only at its Undo (NLM1-G1). Two routing fixes came out of this measurement: when v1's own groups overflow the budget, the cut follows evidence rather than size (charts was being cut for being the largest), and two or more tickers plus "charts" points at workspace and chartGrid.

**Track A dependency (created-binding v2).** `nlm1/plans.js` hands the binder only UNTARGETED ops and takes the binder as a parameter (`{ bind }`), so it can sit on created-binding-v2 unchanged if v2 keeps the `(ops, text, host) → {ops}|{ask}|null` contract. No flag-ON pass depends on re-targeting an explicitly targeted op. The flag-OFF +4 that Track A gave on the first set does go through that re-targeting (flagged in its review).

#### D2/D3.2: robustness, after AUDIT's second sealed result (20/37 flag on, 14/37 off at `c887318c81`)

The probe matrix (`workflows3.json`: different boards, different prior turns, ordinals with nothing created) found one root cause behind most cross-turn failures: **the FIRST turn did nothing**. A command aimed at charts by ticker or by a quantified set ("add rsi to AMD", "add macd to SPY and QQQ", "make the top two charts weekly") had no deterministic reader, so it went to the model, and the follow-up then had no committed referent. New mechanisms:

| Mechanism | What it does |
|---|---|
| Command at a referent set (any turn) | "<command> to/on/for <set>" and "<verb> <set> <rest>": the set resolved by the referent-set resolver, the command read by the fast path as about "it", each chart-scoped op aimed at each chart |
| Referent + value | "and that one weekly", "the bottom two monthly": no verb needed |
| Repeat with a modification | "same but monthly for the other two on the bottom", "same but macd for the other two": the last request's ops with the timeframe or indicator replaced |
| Style the indicator just added | "…, add the 21 ema and make it orange": the indicator the last request (or the step before, inside one request) added, named by what it is, styled on its chart. `runCompound` falls back to these mechanisms when no reader takes a step |
| Honest "not there" | "remove it from the right one" when the right chart doesn't carry it: said plainly, nothing changed, no model call |
| In-plan structural normalisations | trailing "on the weekly" / "with RSI" become clauses; verbless assignments ("TSLA on the left chart, META on the right one"); "to both" becomes "to both charts"; "<request>, then do the same for <ticker>" becomes two explicit compound steps; "<tickers> in four equal charts" |

**(A) decision per sub-category: all five are deterministic now**, each through the existing readers:

| Sub-category | How |
|---|---|
| Symbol + timeframe + indicator on one chart | trailing-modifier normalisation |
| Tickers to positions + indicator on both | verbless / quantifier normalisation |
| "…then do the same for <ticker>" after a create | in-message repeat as two steps |
| Grid + indicator on all of them | grid and each-with readers, multi-ticker form |
| Chain where the third change styles the second's indicator | style-last-added mechanism |

Their canonical plans are kept as planner-mode cases (`NLM1_WF_MODE=planner`), reported separately below.

**(C) Undo after "remove it":** not reproducible with the flag on. "add rsi to AMD" (an existing chart, by ticker), then "remove it" (a proposal, approved), then "undo" restores the indicator with its original identity on a 2-chart and a 4-chart board (R-C1, R-C2). Before D2/D3.2, "add … to <ticker>" had no deterministic reader, so with no model plan nothing was ever added, and "undo" had nothing to restore. That is the likely cause of the sealed failure.

Results, all three sets (85 cases: first 40, generalisation 23, robustness 22). Final workspace state plus Undo, no model:

| Mode | First (40) | Generalisation (23) | Robustness (22) | Total |
|---|---|---|---|---|
| Flag OFF (with Track A) | 23/40 | 3/23 | 2/22 | 28/85 |
| **Flag ON, D2/D3.2** | **39/40 + 1 gap** | **22/23 + 1 gap** | **22/22** | **83/85 + 2 recorded gaps (both NLM1-G1)** |
| Planner-assisted (canonical plans, routes checked under v2) | n/a | 4/5 | 4/4 | 8/9 (G-a3 fails only at Undo: NLM1-G1) |

By AUDIT's categories, robustness set flag ON: A (in-plan) 8/8, B (cross-turn, varied boards / prior turns) 12/12, C (Undo after removal by "it") 2/2. NLM1-G2 is fixed by the style-last-added mechanism: D2-18 now passes and its gap marker is removed. The planner-mode measurement also produced one more routing fix: on overflow, the message's entities count as evidence, so charts is no longer cut from "put TSLA on the left and AMD on the right and add rsi to both". D1 gates and metrics are unchanged.

#### D3.3: in-plan shapes by structure, after AUDIT's third sealed result (27/37 flag on, 14/37 off at `77542d5342`; cross-turn 19/19, in-plan 8/16)

**How the D2/D3.2 "deterministic now" claims held.** They held for my probe wording, not for the shapes. On a NEW set written before any D3.3 code (`workflows4.json`: AUDIT's 7 failing shapes × 3–5 surface variants each, varying word order, synonyms, ticker / position swaps and 2- vs 4-chart boards), the D2/D3.2 head passed **8/29**:

| Shape | D2/D3.2 claim held? |
|---|---|
| S1 swap + both | 1/5 |
| S2 grid + all | 3/4 (the miss: a count of charts became *new* charts, one too many, the very failure AUDIT reported; my R-A4b case didn't check the count, so it hid this) |
| S3 three-clause chain ending in styling | 4/4 |
| S4 create + possessive | 0/4 |
| S5 "same" aimed at a ticker | 0/4 |
| S6 "same" aimed at a new chart | 0/3 |
| S7 ticker-named chart + "give it" | 0/5 |

D3.3 handles each shape by structure:

| Mechanism | What it does |
|---|---|
| Clauses | A message of several requests is split only where a command verb starts the next clause (ticker and indicator lists are never split). Each clause is normalised on its own and run as a compound step. A later clause's "both of them / them" takes the set the clause before named. |
| Swap over a referent set | Exactly two charts: their places (`board.swap`), or their tickers when the words say so. |
| "give <target> <thing>" | Topicalised or not; an indicator becomes "add … to <target>", a timeframe becomes "make <target> <tf>". |
| Possessives | "set its timeframe to weekly", "change its interval", "make their timeframe", "with its timeframe on weekly". |
| A count of charts is a grid | "four charts: A, B, …", "A, B, … in four equal charts", "… on four charts": the grid reuses the charts already there, never one too many. |
| In-message "same" | Aimed at a ticker or a chart ("<request> and the same to AMD", ", same for QQQ", "and do the same with TSLA", "and AMD the same"), or at a NEW chart ("…, then open a chart for AMD and do the same there", "… and give a new AMD chart the same", where the request is re-aimed at the new chart as "it"), run as explicit steps. |
| "new chart for X" | Read as a creation. |
| Plumbing | An explicit form counts as read when a reader OR an NLM-1 mechanism takes it; a rewritten form that only a mechanism takes is run by that mechanism (it used to go to the readers, and from there to the model). |

Shape 8 (the timeframe landing on the existing chart instead of the new one) is left to created-binding-v2, as directed. The harness clears the browser key unless a case is seeded `nlm1`, so every flag-ON run now starts with a test that fails unless NLM-1 really is ON (and the flag-OFF run unless it really is OFF).

Results, all four sets (114 cases: first 40, generalisation 23, robustness 22, shapes 29). Final workspace state plus Undo, no model. Each run starts with the flag-state check, and it passed in every mode:

| Mode | Shapes (29) | All four sets (114) |
|---|---|---|
| Flag OFF (with Track A) | 4/29 | 32/114 |
| D2/D3.2 head, flag ON | 8/29 | n/a |
| **D3.3, flag ON** | **29/29** (S1 5/5, S2 4/4, S3 4/4, S4 4/4, S5 4/4, S6 3/3, S7 5/5) | **112/114 + 2 recorded gaps (both NLM1-G1)** |
| Planner-assisted | n/a | 8/9 (G-a3 fails only at Undo: NLM1-G1) |

Flag-off regression suites (capreg + goldens + conversation / undo / memory / deixis / routing + nlm1): 3073/3073, up from 3038 because the new test files are included. D1 gates and dev metrics are unchanged: corpus own-groups 99.8%, availability 100%, largest request = v1's.

Caveat, said plainly: these shape cases are mine, written from AUDIT's abstract descriptions. Twice my own sets have overstated generalisation, so the sealed re-score is the measure that counts.

#### STOP on in-plan (A): status, risk, proposal (AUDIT decision after the sealed re-score of `36957ddf7a`)

**Sealed result.** Flag ON 28/37, flag OFF 14/37, no regressions, D1 unchanged. Cross-turn (B) 19/19. In-plan (A) 9/16: only 1 of the 8 shapes AUDIT described flipped. The scorer's own fresh, sealed in-plan set scores **1/12 with the flag both ON and OFF**, so on fresh in-plan wording NLM-1 adds nothing over v1. **The deterministic in-plan normalisation is not extended further.** Each round fitted my probes (29/29 on my shape set) and did not generalise.

Sealed history (flag ON / OFF of 37):

| Head | ON / OFF | Note |
|---|---|---|
| D1.3 `799d3419a5` | 17 / 14 | |
| D2/D3.1 `c887318c81` | 20 / 14 | |
| D2/D3.2 `77542d5342` | 27 / 14 | B 19/19, A 8/16 |
| D3.3 `36957ddf7a` | 28 / 14 | A 9/16 |

Almost all of the lift came from D2/D3.2, whose main mechanism (a command aimed at a referent set on ANY turn, plus the follow-up operations) is what makes (B) work.

**Which (A) rewrites the sealed passes actually exercise.** I have not seen the sealed texts, so I cannot attribute the 9 in-plan passes to specific rules myself. Every rule announces itself on the turn trace: `mark('nlm1:rewrite', <rule>)`, `nlm1:followup-ops`, `nlm1:created-ref`, `nlm1:ordinal`, readable in `window.__uctAgentTurns` / `trace.lastTurns()`. The attribution therefore needs AUDIT to run the sealed set once with a per-case tally of those marks (no texts need to be shared). Pending that tally, the honest classification by evidence:

| Rewrite / mechanism (in-plan) | Exercised by sealed passes? | Exercised by my probes |
|---|---|---|
| Created-chart reference on Track A's binding (`plans.js`) | probably: P01/P02/P15 class; Track A's fix also passes flag-off | first set, A-sets |
| Command at a referent set (`followupOps.aimCommandAtSet`) | **yes, indirectly**: it is what makes the first turn of the (B) cases act (sealed B 4 → 19 at D2/D3.2) | all sets |
| Style the indicator just added (+ `runCompound` fallback) | unknown (needs the trace tally) | S3, R-A5, D2-18 |
| Ordinal over just-created charts (`rescopeOrdinal`) | unknown | G-b3, G-a3 |
| `with-indicator`, `add-to-it(-clause)`, `distribute-indicators` | unknown | first set, G-a, R-A |
| `multi-ticker-create`, count-of-charts → grid | unknown; the sealed "one chart too many" shape did not flip | G-a, R-A4b, S2 |
| `verbless-assign`, `tf-modifier`, `quantifier` | unknown | R-A1, R-A2 |
| In-message repeat / same-on-new-chart | unknown; the sealed S5/S6 shapes did not flip | R-A3, S5, S6 |
| Clause splitting, swap, `give`, possessives, `new chart for` | **no evidence**: of the 8 shapes they target, 1 flipped | S1, S4, S7 |

**Risk.** A taken rewrite runs deterministically, bypassing the planner. A rewrite that misreads an unforeseen phrasing acts on the board with no model in the loop, though still through policy, approvals, receipts and Undo. A rewrite no reader takes is dropped, and the original message goes on as typed. The probe-only rules add that risk without measured benefit.

**Proposal (owner / AUDIT decision; not implemented, no code changed).**
1. **Keep** D1 routing v2, the (B) cross-turn mechanisms (referent sets, repeat / additive / repeat-with-modification, inversion, removal by position, referent + value, the D3 referent tracker and follow-up rewriter), command-at-set, and `plans.js` (thin, on Track A's binding, and it moves to created-binding-v2).
2. **Flag-gate, default OFF**, every in-plan normalisation in the table without sealed evidence: `rewriteSameRequest`'s structure stages, in-message same, `rewriteClauses`, swap, `rescopeOrdinal` in `runCompound`, and the `runCompound` fallback. Proposed third key: `localStorage uct.agent.nlm1.inplan = '1'`. With it off, NLM-1 = D1 + (B). Then **remove** any gated rule the AUDIT trace tally shows no sealed pass ever uses.
3. Re-run the sealed set with the in-plan key OFF. The prediction is (B) 19/19 kept, and (A) back near the flag-off figure. That shows exactly what the in-plan rules were buying.

**Measurement caveat.** No-model scoring (all of my sets, and the sealed set as scored) measures only **deterministic coverage**: whether a request is handled without the model. In production, an in-plan request no deterministic reader takes goes to the **planner** (the model), so "does nothing without a planner" is the expected v1 behaviour, not a failure of the product. The real in-plan measure is planner-assisted or a model eval. My scripted-canonical-plan mode (`NLM1_WF_MODE=planner`, 8/9: routing plus binding plus executor right whenever the plan is right) is a proxy for the routing and binding half only. A real model eval needs the owner's paid-eval approval (`EVAL.md`), and it is the right way to decide whether any in-plan determinism is worth keeping.

#### In-plan key: implemented (AUDIT-approved after the sealed trace tally; dark code, rules not deleted)

AUDIT's tally (no texts shared): the sealed passes used `created-ref`; followup-ops `command-at-set`, `back-to-value`, `repeat-on-set`, `additive`, `referent-value`, `repeat-modified`; and rewrites `same-on-chart`, `add-to-it`, `in-message-repeat`, `same-but-tf`, `tf-modifier+add-to-it`, `clauses` (1 pass, 1 fail). No mark fired on any of the scorer's fresh 12.

**Gated behind `uct.agent.nlm1.inplan` (default OFF), exactly the never-taken list:**

| Rule | Where |
|---|---|
| `back-to-before` | `followupOps.js` |
| `borrow-verb` | `followups.js` |
| `it-is-named-chart` | `followups.js` |
| `multi-ticker-create` | `followups.js` |
| `ordinal-of-created`, and the whole `nlm1:ordinal` path (main and `runCompound`) | `followupOps.rescopeOrdinal` |
| `same-for-ticker` (as a follow-up of its own) | `followups.js` |
| `same-on-new-chart` | `followups.js` |
| `style-last-added` | `followupOps.js` |
| `swap-places`, `swap-tickers` | `followupOps.swapOps` |
| the `structure` rewrite (`preNormalise`: count-of-charts grid, give, possessives, "new chart for") | `followups.js` |

Kept ungated:
- The rules sealed passes used.
- `remove-not-there` and `remove-ambiguous`: safety behaviours (an honest refusal, a question; never a guess).
- `in-message-repeat`, which a sealed pass used, still reads its "same for <ticker>" internally (`rewriteFollowUp(…, { internal: true })`), so gating `same-for-ticker` as a follow-up does not break it.

**Rule names built at runtime that appeared in neither list.** AUDIT then classified them from the full sealed tally (every mark that fired, composites included): none fired in any sealed case. So these are **now gated too**, at the TOP level:
- `same-on-charts` (the plural branch of a ternary next to `same-on-chart`);
- the same-request pipeline stages `verbless-assign`, `with-indicator`, `quantifier`, `distribute-indicators`;
- `nlm1Rewrite`'s `<follow-up>+<same-request>` composites.

`tf-modifier` and `add-to-it` (used) stay on. **Internal paths of used rules are kept**: a used rule that normalises its parts (`clauses`, `in-message-repeat`: `rewriteSameRequest` at depth > 0, `rewriteFollowUp(…, { internal: true })`) still applies those stages, `same-for-ticker` and `structure` to its own parts. Without the key, those rules are not reachable on their own.

**R-B5b** ("add rsi to both charts" → "remove it from the right one") needed `remove-on-charts`. **AUDIT ungated it** (11-04): it is a cross-turn (B) behaviour, and `indicator.remove` is always a proposal the member approves, which matches the owner's confirmation rule. Tests: R-B5c (real panel, key OFF) shows the proposal and, dismissed, removes nothing; `nlm1InplanGate.test.js` shows it reads by what the indicator is, and that `remove-ambiguous` asks instead of guessing.

**NLM1-G2.** Its fix depended on `style-last-added`, which is now gated. D2-18 passes with the in-plan key ON (the default of `nlm1Workflows.test.jsx`, which reproduces `36957ddf7a`). With the key OFF, D2-18 fails as before: **G2 is a gated gap**, fixed only behind the in-plan key.

Tests:
- `nlm1/nlm1InplanGate.test.js`: key OFF, each gated rule does not fire; the used rules and the two safety behaviours still do.
- `nlm1Followups` / `nlm1FollowupOps` units run with the key ON.
- `nlm1Workflows.test.jsx`: in-plan key ON by default (`NLM1_WF_INPLAN=0` turns it off). Every run first asserts BOTH the flag state and the in-plan key state.

Results (my 114 cases; final state plus Undo, no model; every run's flag and key state asserted first):

| Mode | First (40) | Gen. (23) | Robust. (22) | Shapes (29) | Total |
|---|---|---|---|---|---|
| Flag ON, in-plan key ON (= `36957ddf7a`) | 40 | 23 | 22 | 29 | **114/114** (incl. 2 NLM1-G1 gap cases failing as recorded) |
| Flag ON, in-plan key OFF (as it would ship; after the second gating batch) | 34 | 13 | 16 | 9 | **72/114** (first batch only: 77) |
| Flag OFF | 23 | 3 | 2 | 4 | 32/114 |

By category with the key OFF: robustness B (cross-turn) 11/12 before AUDIT ungated `remove-on-charts` (R-B5b needed it; 12/12 + R-B5c after, see above), C 2/2, A 3/8. My shape set drops to 9/29: exactly the never-taken in-plan rules. Flag-off regression 3083/3083 (+ the gate tests); D1 gates and metrics unchanged. AUDIT's sealed confirmation with the key OFF is pending (prediction: B 19/19, A 9/16 or close).

Recorded gaps (capreg `gapIt`: each must fail exactly as recorded, so a fix is noticed):
- **NLM1-G1** (D2-13, G-a3): after the new chart's later changes are undone exactly, the creation's own Undo is refused ("Workspace has changed since I made that change"). The new chart's stored settings aren't byte-identical after those undos, so the workspace fingerprint no longer matches. Same with the flag off. Runtime exact-undo area (#771), reported to AUDIT.
- **NLM1-G2** (D2-18), FIXED in D2/D3.2 by the style-last-added mechanism (marker removed). It was: an indicator added on a chart the same request created (through its alias, the deferred step) isn't found by the conversation follow-up reader, so the next "make it orange" has no referent. Same in two separate turns with the flag off (it goes to the model). Conversation memory × CG-37, reported to AUDIT.

Unit coverage: `nlm1/nlm1FollowupOps.test.js` (referent sets, repeat / additive, inversion, removal, ordinals, on a fake 2×2 board), `nlm1/nlm1Followups.test.js` (rewriter and same-request rules, never-guess cases, tracker bounds) and `nlm1/nlm1Routing.test.js` (vocabulary validity; the vocabulary is a supplement: the index alone recognises ≥ 75% of the dev set; index generated from the registry; entity typing; `NLM1_ROUTER`).

## 3b. DESIGN (proposal, not built beyond the harness): structured multi-step plans through the PLANNER

Owner direction (11-04): keep the cross-turn behaviour; keep non-generalising in-plan rules off; priorities are structured multi-step plans, operation-result references, correct chart targeting, grouped Undo and accurate final-state verification. Unfinished planner behaviour is never enabled in production.

**Problem.** In-plan requests ("add a chart for AMD, make it weekly and put RSI on it") belong to the planner: four rounds of deterministic rules did not generalise. The planner already has two shapes:
- **v1** (one model call, one envelope of ops): created widgets carry an `as` alias, and later ops may target it. Anything else ("it", "the new one") is a pronoun the browser must bind (Track A's `createdBinding`, being reworked as created-binding-v2).
- **v2** (`turn_v2.py`, `UCT_AGENT_PLANNER=v2`, off): one tool call per step, in rounds. Each step's result (including `New refs:` for created charts) is fed back before the next step. Correct, but one model round per step (6-round, $0.25 caps).

**Proposal: one structured plan, with steps that name earlier steps' RESULTS by id.**

1. **Schema.** Each op may carry an `id`. A `target` or any `args` value may be a reference `$<id>.<field>` to an EARLIER op of the same plan. Fields are declared per capability in the registry (new metadata `produces`):

   | Producer | Field |
   |---|---|
   | `widget.add` type chart | `chart` (the new chart) |
   | any chart-scoped op | `chart` (its own target) |
   | `indicator.add` | `indicator` (the committed instance) |
   | `chartGrid.set` / `widget.addCharts` | `charts[i]` |
   | `watchlist.create`, `layout.saveAs`, `alert.create` | their new object |

2. **Validation, before anything runs** (browser `planOps`, mirrored as a syntactic pre-check on the server): a reference names an earlier op, a field its capability declares, and a kind compatible with the consuming op's target kind. Any violation refuses the WHOLE plan, never a partial run.
3. **Resolution reuses the runtime, no new engine.**
   - `chart` of a creating op = today's alias (`as`): the runtime resolves it to the committed widget's id (`commitPlan` `created`), and deferred / sequential ops are re-aimed by `landDeferred`.
   - **New, small:** the runtime records each committed op's results in a per-plan map keyed by step id. That covers an `indicator.add`'s instance id (already reported by the Indicators receipt, `takeIndicatorTouches`) and a grid's charts in order. A deferred step referencing them is re-aimed by the same `landDeferred` hook.
4. **Chart targeting / created-binding-v2.** A structured plan names every target explicitly (a context ref or a step reference), and v2's structural rule is that an explicit target is never re-targeted. So binding is not involved at all. created-binding-v2 stays the fallback only for legacy pronoun plans and the instant path, with its contract unchanged (`(ops, text, host) → {ops} | {ask} | null`). NLM-1's `plans.js` already hands it only untargeted ops.
5. **Approval policy:** unchanged, decided per op (`decideMode`). A plan with a proposal-risk step shows one card. Steps after a pending proposal wait, as v2's pause does. A reference into a proposed step resolves only after approval.
6. **Grouped Undo:** one plan = one Undo group (Mission 3 grouping; NLM-1's request-level grouping), each entry's exact Undo. A step that fails stops the plan: "made X, then stopped: Y didn't go through".
7. **Final-state verification:** each capability declares a postcondition (chart shows the symbol / timeframe; the instance is on that chart; the chart exists). After commit, each step's postcondition is read back from PERSISTED state, and a mismatch is said in the receipt ("on your screen but not saved" / "did not take") instead of a success claim. The harness asserts the same from outside.
8. **Where it runs.** Structured plans fit the v1 envelope (ONE model call: cheapest, and the whole plan is validated before anything runs). v2's rounds stay for plans whose later steps depend on a READ (a screen's result, a quote), where the model must see a result before planning. v2's `New refs:` result line becomes the same `$<id>.<field>` vocabulary.
9. **Flags and ownership.** Behind NLM-1's keys plus the planner flag; never on in production without the owner. The prompt and schema text lives in `turn.py` / `turn_v2.py` (owned by `release/agent-dark-train`), so those edits are coordinated through AUDIT, not made here.

**Built now (the harness only):** `nlm1/stepPlan.js` desugars a structured plan onto TODAY's executor: a create's `id` becomes the alias; `$id.chart` becomes that alias or the op's own chart; an indicator op on an existing chart is aimed at its indicator entry. A result the runtime cannot carry yet (`.indicator`), a forward or unknown reference, or a duplicate id is REPORTED as unsupported, never approximated. `nlm1/nlm1StepPlans.test.jsx` + `nlm1/baseline/stepplans.json` (the case format for AUDIT's eval: request text, board, the scripted correct plan, the words naming its targets, expected final state, Undo) replay each scripted plan through the real panel as the model's answer. They send an opaque line plus the target-naming words, so no deterministic reader pre-empts the planner and the multi-chart "which chart?" safety screen stays in force. With NLM-1 on and the in-plan key off, they assert final state and then grouped Undo restoring the board exactly.

| Case | What it covers | Result |
|---|---|---|
| P1 | create + tf + indicator on `$step1.chart` | pass, Undo restores |
| P2 | two creates, an indicator on each by reference | pass, Undo restores |
| P3 | an explicit existing chart, then `$s1.chart` | pass |
| P4 | create + an explicit change on the EXISTING chart (never re-targeted) | pass |
| P5 | symbol + tf + indicator on one existing chart | pass |
| P6 | style the indicator a step added (`$e.indicator`) | reported unsupported: needs the runtime results map |
| P7 | a forward reference | refused |

**Proposed build order (after approval):**
- (a) `produces` metadata + reference validation (browser, pure);
- (b) the runtime per-plan results map (`indicator`, `charts[i]`), which turns P6 green;
- (c) postcondition read-back in receipts;
- (d) the prompt / schema change, coordinated with the planner owners;
- (e) the paid eval, on the stepplans case format with the model's plan in place of the scripted one.

## 3c. BUILD (a)–(c) of §3b (AUDIT approved 11-04; branch `agent/nlm1/step-plans`, stacked on #790's head)

Dark behind the same two NLM-1 keys (the in-plan key is not involved). No prompt or schema edits: only a plan whose ops carry an `id` (which no current planner emits) takes this path. With either key off the path is never entered, so behaviour is byte-identical (see the flag-off results below).

- **Module** `nlm1/stepPlans.js` (new; the scripted-plan desugarer `nlm1/stepPlan.js` is deleted). Hooks in `useAgent.js` are thin: the model path after binding, `runFollowUps` before each follow-up op, and `approve()` / `dismiss()`.
- **(a) `produces` + validation.** `producesOf(op)`: a chart `widget.add` produces `chart` (created); a chart / indicator-edits op produces `chart` (its target); `indicator.add` also produces `indicator`; a capability can declare `produces` itself. `prepareStepPlan` validates the WHOLE plan before anything runs. A forward or unknown reference, a duplicate id, a field the producer lacks, or a consumer that does not act on a chart refuses the whole plan: "I didn't run any of that plan: …" (kind `refused-step-plan`). A create's id becomes the executor's existing `args.as` alias; `$id.chart` becomes the alias or the explicit chart; indicator consumers use that chart's indicator-edits entry. Every target is explicit, so created-binding never re-aims a step plan.
- **(b) Per-plan results.** A step that changes "the indicator step k added" (`$k.indicator`) is resolved just before it runs, from STATE: the one instance on the chart that was not there before the plan and matches the step's defId / period / maType. No result (the step failed, was refused or dismissed, or was ambiguous) means the step does not run, and the panel says so: "I didn't run step n (…): it changes the indicator step k adds, and it did not take effect." (kind `refused-step-result`). P6 is green.
- **(c) Postcondition read-back.** After the plan runs (or after its card is approved or dismissed), each checkable step is read back from the board: chart created, symbol, timeframe, indicator present. Then the server's saved copy of each touched chart is compared (`widgetInSync`). One plain line: "Checked on your board: all N checked steps are in place." or "… k of N … Not in place: step n (…)." plus "On your screen but not saved yet: …". A step that consumes a result but was never reached (the batch stopped before it) is named as well. While a card from the plan is waiting: "Part of this plan waits for your approval on the card above — it runs only if you approve it."
  - **Placement (flagged to AUDIT):** the read-back lives in the NLM-1 module and is shown as outcome lines. It does not touch the receipt code (release-path, #796). A receipt-level read-back would be useful outside NLM-1, but it was deliberately not widened.
- **Harness** `nlm1/baseline/stepplans.json` v2 + `nlm1/nlm1StepPlans.test.jsx`. The production path runs through the real panel with NLM-1 on and the in-plan key off. Unit tests cover (a) and (b). Cases P1–P10 all pass (15/15):
  - P1–P6: final state, the read-back line, grouped Undo.
  - P7: a forward reference refuses the whole plan; the board is unchanged.
  - P8: a failed step mid-plan. The partial result is stated explicitly: step 1 is in place, "Not in place: step 2", and "didn't run step 3". No rollback: what ran stays, and the member's Undo reverts it.
  - P9: an approval dismissed mid-plan. No alert is created and "nothing changed".
  - P10: a reference to a refused step. The board is unchanged; step 2 is reported as not run because step 1 did not take effect.

## 4. PACKAGE 1: multi-step and follow-up conversations (live for admins after review; owner policy 11-04)

Branch `agent/nlm1/package1` on master `29830442d0`: #790 (D1 routing, D2/D3 follow-ups, in-plan key) + step plans (a)–(c) (§3c), merged as one package.
- **ON by default for admins** (§2). Kill switches: `UCT_AGENT_ROUTING_V2=0` (server) and `localStorage uct.agent.routingV2='0'` (browser). The in-plan key stays default OFF.
- **created-binding-v2 overlap (#797):** `planCreatedReference` sits on the v2 binder unchanged. One fix: when NLM-1 rewrote the member's words ("same but weekly" → "add a chart for TSLA and make it weekly"), the binder now reads the member's typed words when deciding whether they named an existing chart. A ticker carried over from the rewrite no longer triggers a question. A member who types the ticker of an existing chart is still asked, as on master.
- **NLM1-G1** is fixed on master (#798): its two gap markers are removed, and both cases pass with the in-plan key on.
- **Unchanged:** spending caps, server auth (`/api/agent/config` admin-only), approvals, Undo and receipts.
- **Step plans:** the executor is live, but no real request reaches it until the planner emits step ids. That is the prompt/schema change (d), a later package.

**Proof.**
- Flag-off fingerprint: base `29830442d0` equals the frozen hash.
- capreg passes at both clocks with NLM-1 ON (now the harness default, as in production), and with `CAPREG_NLM1=off` (the kill-switch path).
- Full Agent vitest and `pytest tests/test_uct_agent*.py` pass.
- Workflow sets with NLM-1 ON and the in-plan key OFF: 78/116. The 38 misses are in-plan shapes; they pass only with the in-plan key on, which stays off.

**DEMO (admin browser; nothing to set; a 2-chart board).** Undo after any line restores the board.
1. "add a chart for AMD and put RSI on it" → "undo"
2. "add the 21 ema to the left chart" → "same for the right one"
3. "make both charts weekly" → "put the right one back to daily"
4. "make the left chart weekly" → "same on the right but monthly"
5. "add rsi to the left chart" → "put that on <the right chart's ticker> as well"
6. "add a chart for TSLA" → "same but weekly" (a second TSLA chart, weekly) → "undo" → "undo"
7. "add rsi to both charts" → "remove it from the right one" (an approval card; nothing is removed until you approve) → "undo"
8. Kill switch: in the console, `__uctAgentRoutingV2(false)` → the panel is v1 again; `__uctAgentRoutingV2(null)` → back on.

## 5. Commits

| Head | What |
|---|---|
| `9a912420cc` | D1: index, vocabulary, routing v2, routers, two-key flag, gates |
| `1af16a8ef5` | D2/D3: workflow cases + harness `seed.nlm1` |
| `d21bce8c55` | merge Track A `7be34d2dd9` (stack for D2) |
| `393ab08fd8` | D1(d): fingerprint frozen per base |
| `09512d5def` | D1.1: weak evidence, critical groups, expansion, undo signal, typos, dev metrics |
| `92893dca0f` | D1.2: percent-move screens, best group leads under doubt, size trimmed |
| `344a9777b3` | D2/D3: referent tracker + rewriter, created-reference plans on `bindCreated`, request-level Undo grouping; D4 |
| `799d3419a5` | D1.3: ticker + info-seeking / period-change entities, byte budget = v1 fallback size; cost analysis |
| `c887318c81` | D2/D3.1: follow-ups as operations (referent sets, repeat / additive, inversion, removal by position, ordinals over created charts), same-request normalisation, planner-assisted mode, generalisation set; routing: evidence-ordered cut, multi-ticker charts entity |
| `77542d5342` | D2/D3.2: command at a referent set (any turn), referent + value, repeat with a modification, style the indicator just added (+ runCompound fallback), honest not-there; in-plan structural normalisations; in-message repeat as steps; robustness set (22); routing: entities as evidence on overflow |
| `36957ddf7a` | D3.3: in-plan shapes by structure: verb-anchored clause steps (set anaphora between clauses), swap over a referent set, "give <target> <thing>", possessives, a count of charts is a grid (no extra chart), in-message "same" for a ticker / a new chart, "new chart for", NLM-1 mechanisms count as reading; shape set (29, written before the code); flag-state check in every run |
| (this commit) | Doc only: STOP on in-plan (A) per AUDIT; sealed history; rule attribution needs the trace tally; risk; proposal to flag-gate (default off) and then remove probe-only in-plan rules; measurement caveat (no-model = deterministic coverage; real in-plan = planner / paid model eval) |
