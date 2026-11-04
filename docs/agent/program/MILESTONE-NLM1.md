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

## 2. Flag (two keys, both default OFF)

| Key | Where | Default |
|---|---|---|
| `UCT_AGENT_ROUTING_V2=1` | server env, reported as `routing_v2` by `GET /api/agent/config` (`api/routers/uct_agent.py`) | off |
| `localStorage uct.agent.routingV2 = '1'` (`window.__uctAgentRoutingV2(true)`) | the admin's browser | off |

Only both keys on enable NLM-1 (`nlm1/flag.js routingV2Active`): routing v2 (`pickRouter`), the D2/D3 rewriter and created-reference plans, and request-level Undo grouping. Anything else, including a config that hasn't answered, errored, or has unavailable storage, means v1.

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

Recorded gaps (capreg `gapIt`: each must fail exactly as recorded, so a fix is noticed):
- **NLM1-G1** (D2-13, G-a3): after the new chart's later changes are undone exactly, the creation's own Undo is refused ("Workspace has changed since I made that change"). The new chart's stored settings aren't byte-identical after those undos, so the workspace fingerprint no longer matches. Same with the flag off. Runtime exact-undo area (#771), reported to AUDIT.
- **NLM1-G2** (D2-18), FIXED in D2/D3.2 by the style-last-added mechanism (marker removed). It was: an indicator added on a chart the same request created (through its alias, the deferred step) isn't found by the conversation follow-up reader, so the next "make it orange" has no referent. Same in two separate turns with the flag off (it goes to the model). Conversation memory × CG-37, reported to AUDIT.

Unit coverage: `nlm1/nlm1FollowupOps.test.js` (referent sets, repeat / additive, inversion, removal, ordinals, on a fake 2×2 board), `nlm1/nlm1Followups.test.js` (rewriter and same-request rules, never-guess cases, tracker bounds) and `nlm1/nlm1Routing.test.js` (vocabulary validity; the vocabulary is a supplement: the index alone recognises ≥ 75% of the dev set; index generated from the registry; entity typing; `NLM1_ROUTER`).

## 4. Activation checklist (needs the OWNER's approval plus a PAID eval; nothing here is authorised yet)

1. AUDIT's held-out re-score of the frozen D1.x head: raw availability ≥ 95.3% (v1), own-groups ≥ 90%, no capability below v1.
2. Track A's created-binding-v2 (the rework of `7be34d2dd9`, which failed review) final and merged; NLM-1 re-merged on it (`plans.js` takes the binder as a parameter); gates re-run (identity fingerprint re-frozen for the new base, only if routing inputs changed).
3. Owner/peer review of `nlm1/vocabulary.json` (marked draft) and of the rewrite rules in `nlm1/followups.js`.
4. Gap NLM1-G1 triaged by its owner (it also affects the flag-off product); NLM1-G2 is fixed.
5. Paid eval (separate owner authorisation, `EVAL.md`): the real planner model with routing v2. Measure task success on the capreg corpus and live phrasings, need_groups reroute rate, input tokens and $ per turn against the #785 per-turn cap (expected +10–25% manifest bytes), and confirm the model handles the larger mean routed set.
6. Full Agent suite plus CI green on the RC; the master deploy gate; normal release approvals (guard → gate → promote). Builders never merge.
7. Staged activation, admin only: set `UCT_AGENT_ROUTING_V2=1` on web, opt in one admin browser (`window.__uctAgentRoutingV2(true)`), live smoke of the D2/D3 workflows on the owner's board, then decide. Kill switch: unset the env var or clear the browser key (each alone returns v1).

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
| (this commit) | D2/D3.2: command at a referent set (any turn), referent + value, repeat with a modification, style the indicator just added (+ runCompound fallback), honest not-there; in-plan structural normalisations; in-message repeat as steps; robustness set (22); routing: entities as evidence on overflow |
