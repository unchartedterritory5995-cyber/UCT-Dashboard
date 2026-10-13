# 05 — Evaluation: test understanding, not keyword matching (Part 10)

## What exists today (CONFIRMED)
- **Unit and contract tests:** 71 Agent frontend test files (about 833 cases) and 21 backend files (295 cases). A golden manifest is checked by `tests/test_uct_agent_contract.py`.
- **NL intent corpus:** `app/src/agent/__fixtures__/nlIntent/corpus.json`, 195 cases.
  - It measures the deterministic layers only.
  - Today: ideal-fast reached 67 of 95; 0 wrong deterministic actions; 3 routing misses of 48 checked.
- **Scripted evaluation:** `agentEval.test.jsx`, 24 tasks with a scripted model; all completed when re-run on 2026-10-13.
- **Real-model tools:** `tools/agent_latency_probe.py` ($1 ceiling), `agent_live_batch.py` and `agent_live_chain.py`. The planned real-model replay ("Layer C", estimated ≤ $3.15) was **never run**.

**Gap:** every existing layer either avoids the model or scripts it. Nothing measures whether the *real* model picks the right capability and parameters for unseen wording, and the corpus was written alongside the handlers it tests.

## Proposed benchmark (PROPOSAL)

### Case schema
```jsonc
{
  "id": "scan-017", "split": "dev|heldout|adversarial",
  "turns": [{ "say": "find strong semis pulling back to the 20", "board": "two-charts", "memory": null }],
  "expect": {
    "intent": "scan",
    "capabilities": ["screener.run"],
    "args": { "industry~": "Semiconductor", "concepts": ["strong_rs", "pullback_to_ema20"] },
    "path": "fast|model|either",
    "clarify": false,
    "final": { "kind": "table", "mustMention": ["RS Rank ≥ 80"] },
    "forbidden": ["widget.addCharts", "chart.setSymbol"]
  },
  "tags": ["informal", "beginner", "multi-op", "follow-up", "typo", "unsupported", "freshness"]
}
```

### Scored dimensions
Each case is scored separately on each dimension, so that "a plausible answer to the wrong question" is visible:

1. **Intent**: the disposition and intent class.
2. **Capability selection**: the action set, plus forbidden actions.
3. **Parameters**: exact match, or a semantic match through the concept ids and tolerant matchers.
4. **Data retrieval**: the right endpoint and arguments (stubbed responses in layers A/B).
5. **Execution**: board state after the run, and Undo restores it.
6. **Final response**: required facts, freshness labels, no false success claims, length budget.
7. **Unnecessary clarification**: a question asked when `clarify:false`.
8. **Latency**: Agent-own time; server time in layer C.
9. **Model usage and cost**: calls and tokens per case.
10. **Unsupported honesty**: said plainly, never a substituted action.

### Layers
| Layer | What it runs | Cost | When |
|---|---|---|---|
| A — deterministic | fast path, refs, concepts, routing, executor on fixture boards | free | every commit (vitest) |
| B — scripted model | real request bodies; the model reply is replayed from recorded envelopes | free | every commit |
| C — real model | the actual model on dev + held-out + adversarial | paid; ≈ (cases × $0.007–0.014) | before each release; owner-approved budget |

**Layer C estimate.** 600 cases × 1.2 calls × $0.007–0.014 ≈ **$5–10 per full run**. A 150-case smoke run costs about $1.3–2.5.

### Sets
- **dev**: grows with features.
- **held-out**: written by someone other than the implementer, never used for prompt tuning, refreshed quarterly.
- **adversarial**:
  - near-miss wording;
  - wrong-but-plausible capabilities ("compare" meaning the stock-compare data, not a chart overlay);
  - stale references;
  - prompt injection inside news and research text;
  - unsupported requests dressed up as supported ones.

**Coverage targets:** each of these areas gets ≥ 40 cases across beginner, professional, informal, typo and multi-op phrasings:
- stocks and ETFs;
- breadth;
- indicators and formulas;
- scanning;
- themes;
- workspace;
- follow-ups;
- multi-step;
- ambiguous;
- unsupported;
- freshness;
- safety.

### Regression maintenance
- Every production failure becomes a case. The 2026-10-13 breadth failures already have cases, in `tests/test_uct_agent_breadth_selection.py` and `agentBreadthSelection.test.jsx`.
- Layer A/B results are stored as JSON (as `docs/agent/nl-intent/after-2026-10-12.json` already is). CI fails on any new WRONG and on a drop in ideal-fast coverage.
- Layer C reports trend lines per release: intent accuracy, wrong-capability rate, clarification rate, `f`, cost per task and p50/p90.
