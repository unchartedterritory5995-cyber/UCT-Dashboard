# 06 — Model vs deterministic, response quality, options, target architecture, roadmap (Parts 7, 9, 13, 14)

## 1. Model vs deterministic: what exists and what is missing (Part 7)

**Already true (CONFIRMED):**
- Both paths produce registry ops and run through the **same** planner, policy and runtime.
- The model output is validated: closed schemas, `sanitize_envelope`, `planOps`, symbol grounding.
- The model cannot invent breadth values (local-only) or claim success (claim filter). Responses are built from execution results.

**Missing (CONFIRMED):**
- **Shared semantics:** concepts, references and assumptions. The two paths agree on *actions* but not on *meanings*.
- **Routing driven by meaning:** today it is keywords.
- **A way for the model to look at non-local data before deciding:** a bounded read round.

**Alternatives considered:**

| Approach | Verdict |
|---|---|
| Extend deterministic matchers indefinitely | Brittle; already 22 modules of regexes. Keep for the head of the distribution only. |
| Model for every request | p50 2.9 s and $0.007–0.014 per request, even for "weekly". No. |
| **Deterministic head + model tail, both emitting one validated envelope** (today) **+ concepts / references / read round** | Recommended. |
| Native tool-calling loop (the model calls tools repeatedly) | Higher latency and cost per request; it conflicts with the local-only boundary; better reserved for a bounded read round. |
| Embedding-based routing or classification | Adds a dependency and service. Not justified until lexicon-normalised routing plus a catalog index is measured. |
| A cheaper or larger model | Haiku 4.5 is already the cheapest Anthropic tier in the price table. Escalate to a larger model only for an owner-approved class (e.g. multi-step plans), measured in layer C. |

## 2. Response quality and personality (Part 9)

**Today (CONFIRMED):**
- Concise view-first presentation (`present.js`): one figure, comparison, metrics, range or table, with full detail under Details.
- Fixed honest sentences for refusals and outages.
- The prompt asks for one short line.
- Breadth answers carry freshness labels: intraday, provisional close, finalized.

**Gaps:**
- No interpretation of local-only figures.
- Assumptions are not stated.
- No "next useful action" hints.
- Receipts are template-like ("Changed symbol to …").

**Proposals:**
1. **An `assumptions` line**, rendered small, under the result.
2. **Interpretation on request only.** "Is breadth improving?" uses the read round with owner-approved model visibility of aggregate values (decision 3), labelled as interpretation.
3. **Receipts in natural language, still truthful.** The executor composes them from results, never from model text.
4. **A next action**, offered only when the result invites one: after a screen, "Open the top one?"; after a draft, "Apply it?". It is never a question when the request was explicit.
5. **Adapt the response style to the request** with no extra calls: the request class (value / list / explanation) selects the view; depth only when the member asks "why" or "explain".

## 3. Architecture options (Part 13)

| | **A — Evolve incrementally** | **B — Unified intent + execution, built as an evolution** | **C — Model-driven agent loop** |
|---|---|---|---|
| What | More fast-path phrasings, routing words, single new capabilities as needed | Extend the existing envelope into the shared intent representation (refs, concepts, assumptions); add SessionMemory, the concept library, read tools, a bounded read round, edit-in-place actions; lexicon routing plus catalog index | The model plans with native tool use over many rounds and sees tool results; deterministic execution boundary kept |
| Understanding of unseen requests | Low–med (keyword ceiling) | **High for the supported domain**; consistent meanings | High, but inconsistent meanings unless concepts are added anyway |
| Development effort | Low per item, unbounded overall | Med (phased; reuses executor, registry, policy) | High (new loop, prompt, eval, safety review) |
| Integration risk | Low | Low–med (additive to existing contracts) | High (conflicts with local-only and single-shot assumptions) |
| Ongoing cost | Lowest | Low: fewer model calls (more deterministic), ≤2 calls cap | High: multiple calls per request, larger context |
| Performance | Fast head; slow tail unchanged | Fast head grows; tail p90 down (smaller prompt, fewer reroutes) | Slower (multi-round) |
| Maintainability | Degrades (regex sprawl) | Improves (concepts and refs are data; one validator) | Prompt-dependent; harder to test |
| Security | Unchanged | Unchanged boundaries + ref validation + per-tool visibility | Larger attack surface (tool results in context) |
| Compatibility | Full | Full (golden manifest, executor, policy reused) | Partial (rewrites the turn) |

**Recommendation: B, built as an evolution.** It does not win by default. It wins on the repository's evidence:
- The shared intent representation already exists (the envelope), and so does the shared executor.
- The measured failures are references, semantics, routing and data reach. These are exactly the four additions B makes.
- C would spend more model calls to rediscover meanings that the concept library fixes deterministically.
- C's main advantage, looking at data before acting, is obtained by B's bounded read round at a capped cost.

## 4. Target architecture (PROPOSAL)

```
member text ─┬─► Normalise (lexicon + typo, N6) ─► Deterministic matchers ─┐
             │        uses: concepts, SessionMemory refs, deixis          │ envelope (ops, refs,
             │                                                             │  concepts, assumptions)
             └─ miss ─► Router (lexicon groups + catalog index) ─► Model (Haiku, 1 call)
                                       │  optional: 1 read round (read tools, ≤2 calls total)
                                       ▼
                         Validator (server sanitize + browser planOps):
                           manifest · closed schemas · refs vs live workspace · concept ids · protection
                                       ▼
                         Executor / policy / runtime (unchanged): apply | propose | ask
                                       ▼
                         Results → SessionMemory update → Presenter (views, freshness, assumptions)
                                       ▼
                         Telemetry (path, calls, tokens, cost, latency, clarification) → Eval dashboards
```

## 5. Phased roadmap (PROPOSAL)

**Phase 0 — quick wins (≈1–2 weeks; no new architecture)**
- Fast-path near-misses: "on it", "show me the weekly", "Actually, …", "what's happening with X breadth", "the 9 and 20" (EMA default + assumption), plural/singular industry matching.
- Routing words for "doing better / holding up / strong / pulling back" (interim, until N6).
- Telemetry: tokens and cache writes per turn into `agent_telemetry`. Set the Agent $ cap and cost-guard lane.
- A per-minute rate limit.
- Re-measure latency over a larger window.

**Phase 1 — foundations (≈3–5 weeks)**
- SessionMemory (result sets, subjects, last action) with staleness validation; deterministic ordinals and "it / that".
- Reference arguments for `chart.setSymbol`, `chart.compare`, `watchlist.add` and indicator ops.
- `indicator.update` (inputs and colours of an existing instance).
- Concept library v1 (10–15 owner-approved concepts) + assumptions in the envelope and the view.
- Lexicon-normalised routing (N6) + catalog index.
- Evaluation layers A/B with the new schema; held-out and adversarial sets; first owner-approved layer-C run.

**Phase 2 — medium term (≈5–8 weeks)**
- Read tools: RS rankings, sector and industry strength, themes, movers, market indicators, NH/NL, calendar, insider and filings, ETF holdings, watchlist performance.
- Bounded read round (≤2 model calls).
- An interpretation policy for figures (decision 3).
- Streaming verified with the real model.
- Natural receipts and next-action hints.

**Phase 3 — longer term**
- Similar-setup search and breakout detection (new analytics, not wrappers).
- Replay control, drawing creation.
- Member rollout (prerequisites in `docs/agent/ROADMAP.md:140-146`).
- Other surfaces.
- Consolidation with AI Search and the voice tools.

## 6. Prioritised improvements (impact / cost / risk)

| Rank | Improvement | Impact | Cost | Risk |
|---|---|---|---|---|
| 1 | SessionMemory + ordinal / "it" references | Very high (follow-ups) | Med | Low–med (staleness handled) |
| 2 | Concept library + assumptions | Very high (consistency) | Med | Low |
| 3 | Reference args for setSymbol / compare | High | Low | Low |
| 4 | Fast-path near-misses (Phase 0) | High (speed, cost) | Low | Low |
| 5 | Lexicon routing + catalog index | High (fewer reroutes) | Med | Low |
| 6 | `indicator.update` | High ("make it a 9") | Low–med | Low |
| 7 | Read tools (10 GET wrappers) | High (data reach) | Low each | Low–med (visibility decision) |
| 8 | Evaluation layers + held-out set | High (truth) | Med | None |
| 9 | Bounded read round | Med–high | Med | Med |
| 10 | Telemetry, cost lane, rate limit | Med (control) | Low | None |

## 7. Acceptance criteria and success metrics (PROPOSAL)

**Phase 0:**
- Corpus ideal-fast reached ≥ 85/95 (from 67), WRONG = 0.
- Tokens and cost stored per turn.
- $ cap enforced.

**Phase 1:**
- The scripted chain "screen → third one → 20 EMA on it → make it a 9 → weekly → compare to the others" completes with ≤ 2 model calls and 0 wrong targets.
- Stale-reference tests ask rather than act.
- Identical concept requests produce identical screens.

**Phase 2:**
- Layer-C held-out: intent accuracy ≥ 85%, wrong-capability ≤ 3%, unnecessary clarification ≤ 5%, unsupported honesty 100%.
- Model-path p50 ≤ 3 s, p90 ≤ 6 s.
- Model calls per model-path task ≤ 1.3.
- Mean cost per model turn ≤ $0.015.

**Always:**
- 0 unauthorised mutations.
- 0 local-only values in model requests.
- 0 success claims before confirmation.

## 8. Preserve / modify

**Preserve:**
- the capability registry contract and golden manifest;
- executor / policy / runtime (compensation, read-back, Undo);
- the sanitize / claim filter;
- the local-only boundary;
- protected layouts;
- deterministic matchers and typo correction;
- breadth selection policy;
- view presentation;
- admin gating.

**Modify:**
- `turn.py`: envelope fields (refs, concepts, assumptions), prompt prefix ordering, optional read round, history → structured memory;
- `routing.js`: lexicon routing + catalog index;
- `fastPath.js` / matchers: near-misses, concepts, refs;
- `compose.js` / `executor.js`: generalised refs;
- `indicatorEdits.js`: `indicator.update`;
- `screener.js`: concept expansion;
- `useAgent.js`: SessionMemory;
- `agent_telemetry`: tokens and cost.

## 9. Open questions and dependencies
1. RS Rank coverage gaps on some snapshots (the ranking guard refuses). The concept library depends on reliable fields.
2. Industry and sector vocabulary normalisation (singular/plural, synonyms like "semis" or "chips").
3. Whether AI Search's and the voice tools' wrappers can be reused rather than duplicated.
4. Indicator instance identity on charts, needed for `indicator.update` and the "that indicator" reference.
5. The INDICATORS team's ownership of builder changes (Opus-based concierge cost).
6. The Market Intelligence and BREADTH data contracts for any newly model-visible values.

## Decisions requiring the owner's approval
1. **Direction.** Approve option B (evolution) and the Phase 0 + Phase 1 scope.
2. **Real-model evaluation budget.** Proposed ≤ $10 per release (layer C); first run after Phase 1.
3. **Model visibility of values.** May the model *see* aggregate market values (breadth, RS ranks, sector strength) in order to interpret them ("is breadth improving?")? Today breadth is local-only by design. Options: keep local-only; allow aggregates only; or decide per tool.
4. **Concept definitions.** Owner-approved thresholds for "strong", "near the 20-day", "pullback", "outperforming", "holding up", "breakout", and the default MA type.
5. **Model choice.** Stay on Haiku 4.5. Is any escalation to a larger model allowed, and for which request class?
6. **Spending.** Agent daily $ cap and inclusion in the cost-guard interactive lane; values to set.
7. **Rollout.** When members (not just admins) get the Agent; prerequisites S2–S5.
8. **AI Search / voice.** Converge on the Agent, or keep them separate?
9. **Research disclosure.** How Perplexity-sourced answers are labelled to members.
