# Plain-English authoring: end-to-end evaluation design (2026-11-02)

**Design only. No paid call has been made, and none will be without separate owner approval.**

## What it measures

One request, followed the whole way through the product's real code:

| Step | Real code | Pass when |
|---|---|---|
| 1. Natural-language request | `POST /api/user-definitions/converse` (sandbox backend, real model) | `ok`; `disposition` is `change` (or the expected `clarify` / `unsupported`) |
| 2. Model-generated definition | `authoring/applyPatch.js` in the browser | the patch applies atomically, and the read-back (`readback.js`) names what was asked |
| 3. Canonical calculation | the engine evaluating the stored tree | the tree's `astHash` equals the reference tree's hash, OR the values match the reference on fixed bars (see "Equivalence" below) |
| 4. Chart display | real `StockChart` on fixed synthetic bars | the output series is painted, and markers, paints or background appear on the expected bars |
| 5. Save | the ordinary save door (`prepareSave` → `validateUserDefinitions` → `user_definitions.save`) | saved with no refusal; the stored definition re-validates in Python |
| 6. Reload | a real page reload; definitions fetched again | it draws again with no timeframe change (the #671 class), and the identical hash |
| 7. Edit | a second `/converse` turn on the saved definition | only the asked-for slot changes; no unrequested rename (#680); `baseRevision` advances |

**Equivalence.** A model may write a correct formula with a different tree, for example `ema(close,9) > ema(close,20)` versus `crossOver(...)` for "is above". So step 3 grades in order:
1. hash-equal to a reference;
2. else value-equal on the fixed bars across every bar of every output;
3. else FAIL.

A value-equal pass is reported separately, so drift in what the model writes stays visible.

## The cases

**A. The owner's three examples (multi-turn, the full 7 steps):**

1. "Highlight when the 9 EMA crosses above the 20 EMA."
   - Expected: a yes/no output `crossOver(ema(close,9), ema(close,20))` plus a marker.
   - Edit turn: "make it the 10 and 30".
2. "RSI 28 with a 5-period moving average of the RSI."
   - Expected: two outputs, `rsi(close,28)` and `sma(rsi(close,28),5)`.
   - Edit turn: "make the average 9".
3. "Background green when the 9 EMA is above the 20 EMA."
   - Expected: a yes/no output plus `set_paint{channel: bgcolor}`.
   - Edit turn: "make it blue".

**B. The 32-phrase corpus** (`tests/fixtures/authoring/plain_english_chart_door.json` on #670). Each is graded on steps 1–3 only. The fixture's expected `terms` and `refused` pins become the reference: a refused phrase must still be refused, with no model call.

**C. Negative controls (5).** Each must NOT produce a change:
- an undeclared study (McGinley);
- another symbol than the one named;
- a request that needs screener-only text data;
- an ambiguous request (it must ask);
- a rename-only turn naming nothing (it must not rename a line).

## Repeats and pass gates

Each model-reaching case runs 3 times, because the model is not deterministic.

| Gate | Threshold |
|---|---|
| The three examples, steps 1–7 | 3/3 runs pass for each example |
| Corpus, steps 1–3 | ≥ 90% of runs pass |
| Negative controls | 100%; an unsafe change in any run fails the gate |
| First-pass rate (no repair) | ≥ 70% |
| Cost per turn (median) | ≤ $0.12 |
| p95 latency | ≤ 20 s |

## Cost estimate

**Inputs used:**
- Model `claude-opus-5` (`CONCIERGE_MODEL` default), priced at $5 in / $25 out per million tokens (`catalyst/cost_guard._PRICING`).
- The system prompt plus tool schema measured locally on `2cd4c3839c`: 49,199 characters, about 12,300 tokens, sent behind one cache breakpoint.
- About 2,000–4,000 tokens of turn input.
- About 1,000–2,000 output tokens.

**Cost per call:**

| Kind of call | Estimate |
|---|---|
| Cache-write call | ≈ $0.11–0.17 |
| Cached call | ≈ $0.05–0.10 |
| A repair | adds one more call |

**Calls in one run:**

| Group | Turns per run |
|---|---|
| The three examples (2 turns each) | 6 |
| Corpus phrases that reach the model (about 26 of the 32) | 26 |
| Negative controls that reach the model (about 3) | 3 |
| **Total** | **≈ 35 turns** |

At 3 repeats that is about 105 turns. Assuming a 30% repair rate, that is about 135 model calls.

**Estimate: $10–$20. Proposed hard cap: $40.** The runner stops when the ledger reaches the cap.

These are estimates; the measured production median from `rollout_report` should replace the per-call figures before the run. A rerun after a fix costs the same again.

## Credentials and environment it needs

- **An Anthropic API key, provided by the owner.**
  - Preferably a dedicated key with its own spend limit set in the Anthropic console.
  - Set by the owner in the operator environment (`setx ANTHROPIC_API_KEY ...`).
  - Never in the repo, a log, a commit or a chat.
  - There is no key on this machine today.
- **A sandboxed backend.**
  - `scripts/hub_sandbox_boot.py`, with the AST-derived census pins.
  - The sandbox's own `auth.db` holding one synthetic eval admin.
  - Never `C:\data`, never production, and never `railway run` (that injects production variables and production data paths).
- **The spend ledger.** The run is recorded by the product's own `cost_guard`, inside the sandbox, so the cap is enforced by the same code members are held to.
- **No other paid service.**
  - The bars are synthetic fixtures served by a fetch shim, so no market-data key is needed.
  - No real market values appear in any output.
- **A browser for steps 2 and 4–7.** Either Playwright (not installed on this machine; it would be a local operator tool, not a repo dependency) or the Chrome extension against a local harness page.

## Outputs

`docs/indicators/evidence/e2e-eval/<run-id>/` holds:
- the raw per-turn records: envelope, gate, attempts, tokens, usd and latency, with no member text beyond the fixed corpus;
- the grading table;
- the cost ledger.

The raw records are written before any summary is computed (R-RAW).

## Not covered

- The UCT Agent path (`agentAuthoring.js`). It reaches the same layer, but its acceptance gates are the Agent program's (`agent/testing/acceptance.js`).
- `/propose`. It is a different door, with a one-column scope.
