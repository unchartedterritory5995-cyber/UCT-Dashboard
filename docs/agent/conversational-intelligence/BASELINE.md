# Layer-A baseline — master `fdba4c997d` (2026-10-13)

Deterministic, free: no model call and no network. Produced by `app/src/agent/agentEvalBaseline.test.js`; full rows are in `baseline-fdba4c997d.json`.

| Set | n | Ideal-fast reached | Det. accuracy | WRONG | Needless ask | → model | Model calls/case | Routing MISS | fastParse p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|
| dev (`corpus.json`) | 195 | 66/95 (0.695) | 0.986 | 0 | 1 | 122 | 0.708 | 20/160 | 0.25 / 1.48 ms |
| held-out (`heldout-v1.json`) | 146 | 16/39 (0.41) | 0.962 | 1 | 0 | 120 | 1.007 | 28/130 | 0.29 / 1.25 ms |
| adversarial | 50 | 1/8 (0.125) | 0.667 | 2 | 0 | 44 | 1.1 | 11/35 | 0.20 / 1.16 ms |

**Not measured:** model-path intent accuracy. It needs layer C, real-model calls with an owner-approved budget.

**About the held-out set.** It was written by a separate agent that read the action catalogue and the corpus *format* but never the matchers or the routing code. It covers:
- alternative phrasings, indicators, screening, breadth and MI;
- references and follow-ups;
- safety, ambiguity, typos, slang, multi-op requests and recovery.

**Deterministic misfires found on unseen wording.** These are real WRONG results: the fast path acts without asking.

| Case | Text | Fast path did | Should |
|---|---|---|---|
| h-ambig-09 | "open swing" | opened the *Swing* watchlist | ask: Swing Board layout vs Swing watchlist |
| h-ambig-10 | "remove momentum" | `indicator.remove` instance "momentum" | ask: Momentum watchlist vs an indicator (destructive) |
| h-typo-02 | "pull up amzon" | `chart.setSymbol` **AMZON** | AMZN (or ask); the lexicon doesn't correct tickers |

These three become Phase 1D regression cases. The fix rule: a bare name that matches more than one kind of entity asks; a ticker-like typo is grounded against the symbol index before acting.

**What the gap shows.** Reaching only 41% of ideal-fast cases on unseen wording (vs 70% on dev) is the keyword ceiling the audit predicted. Routing misses on 22% of held-out model cases means about one in five of them would need a second model call.

**Label conflict to resolve in 1C.** The dev corpus labels "change the rsi to 7" as *unsupported*. The held-out set labels edit-in-place as *act* (it needs `indicator.update`). When 1C ships, the dev label changes to act.
