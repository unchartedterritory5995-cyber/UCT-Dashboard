# UCT Agent — natural-language architecture review (2026-11-02, overnight)

Author: agent-lead, with agent-sc's independent input (scanner path). Scope: why UCT Agent does not yet feel
like ChatGPT inside UCT, and the simplest robust architecture that lets the model use its own intelligence.
Evidence is from the code on `agent/int` 8cda1ef85c and the measured records cited; nothing here is from a
paid model run, because none has ever been authorized.

## 1. Verdict in one paragraph

The core design is right: one capability registry, the model plans against a manifest generated from it, and
every op is re-validated, approved, receipted and undoable after the model. What limits the Agent is
everything **in front of** the model, how little of UCT the model is **shown** on a given turn, and **which**
model plans. A model-first path that fixes the first two (NL-1 plus hybrid selection) is already built,
tested and in production — switched off — and has never been measured on a real model. The single most
valuable next step is not new code; it is one capped, owner-approved evaluation that compares today's path
with NL-1 (and Haiku 4.5 with a stronger model) on the sealed sets.

## 2. How a message flows today (production, legacy path)

```
text ─► doItForMe (guide) ─► retargetCorrection ─► multiChartPlan ─► resolveFollowUp
     ─► fastParse (canon rewrites, typo readings, control words, capability `fast` regexes, clause split)
     ─► authoring intent ─► [only if none of the above claimed it]
     ─► routing.js word patterns pick ≤55 of ~91 actions ─► model (claude-haiku-4-5 default) plans
     ─► sanitize_envelope ─► compose / deixis / screens ─► planOps ─► policy ─► commit ─► receipt ─► Undo
```

Six deterministic interceptors run before the model. Each one that claims a message decides its meaning with
no model and no second opinion.

## 3. Findings

| # | Finding | Evidence | Effect |
|---|---|---|---|
| F1 | **Confident pre-model misreads.** A deterministic layer that claims a message is final. | Quote held-out: 7/44 confident wrong answers at 0 calls ("btc price" → BTC ETF, "price of gold" → GOLD, "nvdia" → NVDIA); QA's private set: 17 FAILs on the RC; NL-1 audit: "add it to momentum" added ticker **IT**. | Wrong actions or answers with no chance for the model to read the sentence. This is the main source of brittleness. |
| F2 | **Word routing hides tools.** The model only sees groups whose words matched. | #626 found 14/31 discovery questions routed without the screener; still 2/21 first-call misses in the readiness set (`agentNlReadiness.test.js`): "Maybe ones with good volume that are still above their 20-day", "anything ripping on huge volume rn". | The model spends its 2nd and last call on `need_groups`, or plans without the right tool. Every fix is another word list. |
| F3 | **Word lists decide what the model may understand.** `SCREEN_WORDS` sends a keys-only catalog (no labels or units) when no word matches. | agent-sc: 4 discovery requests got the bare catalog before #628. | The model cannot tell `vol_ratio` from `rvol_live` from a key. |
| F4 | **Scanner follow-ups have structural holes** (agent-sc). | `mode: refine` cannot remove a filter; a universe switch ("now just tech") intersects silently; `lastScreen` gives labels, not keys. | "Actually remove…" and "now just…" fail or go silently wrong, whatever the model understands. |
| F5 | **The planner model is small.** `turn.model()` defaults to `claude-haiku-4-5`. | `api/services/uct_agent/turn.py:81`. | Fine for clear commands; the weakest point for vague, compound and multi-turn reasoning. Never measured against a stronger model. |
| F6 | **The market-data tools the example conversation needs are dark.** | `stock.quote`, `news.company`, scan-by-gateway are all behind flags (Sprint 2). "Why is NVDA moving" relies on the web-research path. | Correct but limited answers until data is activated. |
| F7 | **F-16 changes "strength" questions.** UCT ratings are hidden from the Agent by owner decision. | Owner rulings 2026-11-02. | "Strongest relative strength" can only be refused or answered from public price performance. That is a product decision (§6). |
| F8 | **Conversation state is good.** | `conversation_memory` (recent_results in shown order, subject_chart, last_change_detail, corrections) and the reference rules in the system prompt. | "Put the top five on my watchlist", "compare it with AMD" are supported in principle. Not the bottleneck. |
| F9 | **Answer vs research vs clarify vs act is explicit.** | Five dispositions; research is a separate, budgeted call. | Sound. Keep. |

## 4. What NL-1 already fixes (built, dark)

- The model interprets every ordinary request; deterministic instant handling only for exact Undo, Confirm and
  Cancel (owner decision 2026-10-16) — removes F1's interceptors.
- Hybrid selection (2026-10-20): a fixed core (charts, indicators, screener, agent) on every request plus soft
  word additions and one bounded reroute — removes F2/F3. Readiness set: 21/21 first-call exposure.
- One byte-identical cached system prompt (~13–17k tokens) instead of 62 routed variants: cheaper per call.
- Corrections ("no, I meant 15") reverse the previous change only when it is still undoable and unchanged.
- All post-model guards stay: registry re-validation, approvals, receipts, Undo, admin-only, budgets.

## 5. Recommended architecture (the simplest robust one)

1. **Model-first for meaning.** NL-1 becomes the path: the model reads every message except exact control
   words. Deterministic code moves *behind* the model — grounding (symbols via the canonical ticker index,
   names via the registry), validation, policy, approvals, receipts, Undo. No new phrase handlers.
2. **Show the model UCT, not a slice.** Fixed core + soft additions (NL-1 selection); the full labelled
   screener catalog with one-line definitions for ambiguous fields; data kinds exposed as ordinary tools
   once activated.
3. **Tools that can express follow-ups.** Scanner refine with remove and universe-replace semantics, wire
   filters in context (agent-sc, branch in progress).
4. **Deterministic fast path only where it is provably safe and free:** control words, and instrument-grounded
   quotes (MD-1 §4.7, in progress) — never a guess.
5. **Choose the planner model on measured accuracy, cost and latency.** Evaluate Haiku 4.5 vs a stronger model
   (Sonnet 5.5) and the newer small model on the sealed sets before changing anything.
6. **Measure, then switch.** NL-1 turns on only after the sealed evaluation beats the legacy baseline, admin-only,
   behind its two switches.

What this removes over time: `routing.js` as a gate (it becomes soft additions only), `SCREEN_WORDS`, the
parked scan-intent layer, and most of the legacy pre-model interceptors. What stays: every safety layer.

## 6. Decisions only the owner can make

1. **Authorize the capped NL-1 evaluation** (`docs/agent/nl-intent/NL1-EVAL.md` §5): 10-request trial
   ($2.60 cap), then legacy-vs-NL-1 on Haiku 4.5, plus NL-1 on Haiku 5.5 and on Sonnet 5.5 (sealed only).
   Recorded estimate ≈ $15 with caching, hard ceiling $45 (prices recorded 2026-10-16; re-verified live at run
   start). Plus SAT-1 §B (≤ $1). Needs a dedicated, approved development credential.
2. **"Strength" under F-16.** When a member asks for the strongest names or relative strength: refuse (today's
   PR-B), or answer from public price performance and say so ("by 3-month price change; UCT ratings aren't
   available to the Agent")?
3. **Planner model** after the evaluation.

## 7. Overnight work against this review

- Readiness harness (`agentNlReadiness.test.js`, branch `agent/lead/nl-readiness`).
- Scanner follow-up holes (agent-sc, branch).
- Instrument-grounded quotes, the Sprint 2 blocker (agent-md).
- Independent NL evaluation scenarios and offline scorer (agent-qa).
