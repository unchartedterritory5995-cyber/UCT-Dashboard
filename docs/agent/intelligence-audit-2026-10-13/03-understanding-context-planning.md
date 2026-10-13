# 03 — Understanding, clarification, context and multi-step planning (Parts 3–6)

## 1. How well the current system handles natural requests (CONFIRMED by code trace)

Verdicts:
- **FAST**: deterministic.
- **MODEL**: a capability exists and the outcome depends on model planning.
- **PARTIAL**: something is missing.
- **UNSUPPORTED**: no capability.

| # | Request | Verdict | Why |
|---|---|---|---|
| 1 | "Show me stocks doing better than the market" | MODEL (+ reroute) | No routing word matches, so the screener group is absent and an extra model call follows. There is no "relative to SPY" concept, so the model picks `rs_rank`, `rs_return` or `chg_pct_*`. |
| 2 | "Find some strong semiconductor names" | MODEL (+ reroute, value risk) | "strong" ≠ "strongest" (screener `fast`). The industry match is whole-word ("semiconductor" ≠ "Semiconductors"). RS Rank can be null on a snapshot, in which case the ranking guard refuses. |
| 3 | "Which tech stocks have been holding up best lately?" | MODEL (+ reroute) | "Holding up" has no definition; the model approximates with a sort on returns. |
| 4 | "Find stocks pulling back into their 20-day" | MODEL | `pct_vs_ema20` / `pct_vs_sma20` exist. The band and the prior-uptrend condition are invented per call. |
| 5 | "What's happening with Nasdaq breadth?" | MODEL (figures only) | OVERVIEW_RE misses "happening with". The model never sees the figures (local-only), so it gives no narrative. |
| 6 | "Has breadth been improving lately?" | PARTIAL | "Lately" becomes guessed dates. "Improving" is an interpretation the local-only boundary forbids. |
| 7 | "Show me the last month of breadth" | MODEL | Series mode; the model must choose a measure. |
| 8 | "Put the 9 and 20 on my chart" | MODEL (+ reroute) | The fast path needs an MA word. EMA vs SMA is assumed silently. |
| 9 | "Make the moving averages change colour when they cross" | PARTIAL | Existing MAs can't be restyled; only a new custom indicator draft. |
| 10 | "Indicator showing momentum accelerating" | MODEL | `indicator.draft` → builder (Opus 5). |
| 11 | "Find stocks setting up like this one" | UNSUPPORTED | No similarity capability; any screen would be a made-up proxy. |
| 12 | "What was happening before this stock broke out" | UNSUPPORTED | No breakout detection; the Agent can't read price history. |
| 13 | "Compare this chart with the S&P 500" | MODEL | `chart.compare` has no `fast`; "S&P 500" → SPY via the model, then checked against ticker search. |
| 14 | "Open the strongest one" (after a screen) | PARTIAL | The model doesn't have the tickers. The only route is `widget.addCharts {from:'lastScreen', top:1}`, which re-runs the screen and opens a **new** chart as a proposal. |
| 15 | "Actually, use the daily timeframe instead" | MODEL | "Actually," and "use" defeat the fast path. |
| 16 | "Do the same thing for ETFs" | MODEL (fragile) | Works only after a screen (refine with `is_etf`); carried-over filters may return 0 results. |
| 17 | "Remove that indicator" | MODEL | "That" is resolved from receipt prose; it ends as a proposal. |
| 18 | "Make this chart look cleaner" | MODEL (subjective) | Settings, theme, reset: the model guesses. |
| 19 | "Why is this stock weaker than its sector?" | PARTIAL | No sector-relative measure; the model reasons or researches. |
| 20 | "Find strongest semis" → "Open the third one" → "Put a 20 EMA on it" → "Actually, make it a 9" → "Now show me the weekly" → "Compare it to the others" | 20a MODEL; **20b UNSUPPORTED**; 20c MODEL (near-miss of `fast`: "on it"); **20d PARTIAL** (no indicator edit); 20e MODEL (near-miss: "show me the weekly"); **20f UNSUPPORTED** | No result references; no indicator edit; `chart.compare` needs literal tickers. |
| 21 | "Find five high-RS semis near their 20 EMA, rank by ADR, open the strongest on my chart" | PARTIAL | A screen plus `addCharts {from, top:1}` is plannable. But "on my chart" becomes a new chart, "strongest" after an ADR sort is ambiguous, thresholds are invented, and the screen re-runs at apply. |

**No-cost measurement (run during this audit).** The repository's corpus (`__fixtures__/nlIntent/corpus.json`, 195 cases):
- 95 cases should need no model; **67 of them (71%)** reach the fast path;
- **0 wrong deterministic actions**;
- routing misses: 3 of the 48 checked.

The 28 cases that should be fast but aren't are listed in the run output (e.g. `alt-03`, `slang-01`, `typo-03`, `ind-01`, `ref-06`, `multi-09`).

## 2. Systemic weaknesses (CONFIRMED)

1. **No reference memory for results.** The model never sees screen tickers (`screener.js:498` exposes only filters, sort and count). There is no ordinal map; `{from, top}` feeds only `widget.addCharts`.
2. **No shared trading semantics.** "Strong", "near", "pullback", "outperforming", "holding up", "breakout", "cleaner" are undefined, so the same request can yield different screens on different turns.
3. **Keyword routing under a 55-action budget.** Paraphrases lose the screener and data groups and cost a reroute. Routing ignores typo correction (N6 unbuilt).
4. **The fast path is strict on small variations.** "on it", "show me the weekly", "Actually, …", "what's happening with … breadth".
5. **Edit-in-place gaps.** There is no indicator-settings edit, and no symbol-from-reference for `setSymbol` / `compare`.
6. **Interpretation boundary.** Breadth figures (and any local-only data) are deliberately hidden from the model, so "is it improving?" cannot be answered beyond the figures.
7. **Data coverage.** Most read-only market data (see 02) is not reachable.
8. **References resolved from prose.** "It / that / the same / instead" depend on the model reading 12 turns of receipt text. The breadth module is the only structured subject.

## 3. Proposed intent representation (PROPOSAL)

**Finding:** both paths already converge on the *validated op envelope*. A new parallel IR would duplicate it. The proposal is to **extend the envelope** into the shared intent representation:

```jsonc
{
  "disposition": "apply|propose|answer|clarify|unsupported",
  "ops": [{ "action": "screener.run", "target": "screener", "args": {…}, "as": "s1" }],
  // NEW — references resolved against session working memory (§5), validated before planning
  "refs": [{ "id": "r3", "kind": "result_item", "set": "s_prev", "index": 3 }],
  // NEW — named, owner-approved concepts the plan used (§4), expanded deterministically
  "concepts": [{ "id": "strong_rs", "version": 1 }],
  // NEW — assumptions to state to the member (defaults chosen, ambiguity resolved)
  "assumptions": ["“Strong” = RS Rank ≥ 80", "20-day = 20 EMA"],
  "question": null, "reply": "…"
}
```

- **The deterministic path** emits the same envelope (with `refs` and `concepts`) from its matchers.
- **The model path** emits it through structured output.
- **One validator** (server `sanitize_envelope` plus browser `planOps`) checks:
  - actions against the manifest;
  - args against the closed schemas;
  - refs against working memory;
  - concepts against the library.
- **Responses** are rendered from execution results, never from the model's claims (as today), so they are consistent regardless of which path recognised the intent.

## 4. Trading concept library (PROPOSAL)

- **What it is.** A versioned, owner-approved table: `id → definition → screener filter expansion / indicator spec`. Examples (definitions require owner approval):
  - `strong_rs` = `rs_rank ≥ 80`;
  - `near_ema20` = `|pct_vs_ema20| ≤ 2%` with `ema_stack_intact`;
  - `outperforming_market_3m` = `rs_return_3m > 0`;
  - `pullback_to_ema20`, `holding_up` (drawdown vs SPY), `tight_range`, `breakout_volume`;
  - default MA type = EMA for "the 9 and 20".
- **How it is used.** Deterministic matchers map words to concepts. The model chooses concept ids instead of inventing thresholds, and the expansion is deterministic, so the same request gives the same screen.
- **What the member sees.** Assumptions are said in one short line ("Using RS Rank ≥ 80 for ‘strong’") and can be changed with a follow-up ("make it 90").

## 5. Clarification policy (Part 4)

**Current behaviour, CONFIRMED.** The prompt tells the model to act on clear intent (`turn.py` `_SYSTEM_HEAD`). Explicit, reversible requests apply at once with Undo; risky ones are proposed (`policy.js`).

**Proposed decision rule** (PROPOSAL; formalises and extends today's rule):

| Situation | Behaviour |
|---|---|
| Intent clear, read-only | Execute. Say any assumption in one line. |
| Intent clear, reversible change, target resolvable from context (active chart, last subject) | Execute + Undo. Name the target when the board has several charts ("On the left chart (QQQ)"). |
| Several plausible interpretations, all safe and cheap | Pick the concept-library default, execute, state the assumption. |
| Several plausible **targets** (charts, lists) with no deixis signal | Ask one question with choices (exists today). |
| Destructive, irreversible, or affecting many objects | Propose (exists today). |
| Missing a parameter that has no safe default (a date range for "the 2022 bear market") | Ask one short question (exists for breadth). |
| Unsupported | Say so plainly; offer the nearest supported action. |

The **unnecessary-clarification rate** becomes a tracked metric ([05](05-evaluation.md)).

## 6. Conversational context and working memory (Part 5)

**Today, CONFIRMED.**
- Prose history: 12 turns.
- `lastActionsRef` (routing only).
- `pendingRef`: proposal or target question, 10-minute TTL, tied to the board epoch.
- Undo stack: 20 entries, in memory.
- Breadth subject.
- Selected chart.
- None of it survives a reload.

**Proposed `SessionMemory`** (PROPOSAL). A compact structure maintained in the browser by the executor (never by the model), sent to the model as short refs:

```
results:  [{ set: "s3", source: "screener.run", at, items: [{i:1, sym:"NVDA"}, …≤50], sort: "rs_rank desc" }]   ← last ≤3 sets
subjects: { chart: "c2", indicator: {chart:"c2", id:"ind_7", type:"EMA", len:20}, screen: "s3", breadth: {…}, list: "w4" }
last:     { action: "indicator.add", target: "c2", undoId, at }
```

- **Validation.** Every ref is checked against the live workspace before planning: the chart still exists, the indicator id is still on that chart, the epoch is unchanged. A stale ref leads to one short question, never a silent wrong target.
- **Expiry.** Entries expire after N turns or minutes, or on a layout switch.
- **Deterministic follow-ups.** Ordinals ("the third one"), "it / that indicator", "the others", "same for ETFs" and "make it a 9" can be resolved without a model where unambiguous. The model receives refs (`s3[3]`), never raw lists beyond the cap.
- **Privacy.** Result *symbols* are not market values. Local-only values stay local.

## 7. Planning and multi-step execution (Part 6)

**Today, CONFIRMED.**
- Single-shot plans of up to 12 ops, with aliases and producer → consumer refs.
- Validation of the whole plan before any write.
- Compensation on failure; Undo per receipt.
- Proposals re-validated on Apply.
- No timeouts or cancellation per op beyond fetch timeouts.
- No partial-completion reporting beyond the compensation message.

**Proposals:**
1. **Generalise references.** `{from, pick:{index|top|sort}}` accepted by `chart.setSymbol`, `chart.compare`, `watchlist.add` and indicator ops, so "open the strongest on my chart" switches the active chart.
2. **Bounded look-then-act.** For requests that need data to *decide* (rank, then open the best), allow **one** server-side read-tool round:
   - the model receives a compact, non-local result (symbols plus the sort key, not raw market values unless the owner approves);
   - it then emits the final plan.
   - Budget: at most 2 model calls; 10 s wall clock; read-only tools only in the first round.
3. **Execution budget per request.** At most 12 ops (exists) and at most N reads, with a per-op timeout and visible progress ("Screening… 1 of 3").
4. **Idempotency.** Already provided for creators by the interrupted-plan rule (`useAgent.js:611`); extend it with request ids on server writes.
5. **Keep simple requests simple.** The loop is entered only when the envelope asks for a read round. Everything else stays single-shot or deterministic.
