# NLM-1 held-out acceptance (Track B) — PRIVATE until NLM-1's D1 is frozen

This branch (`agent/qa/nlm1-heldout`) is **not merged** and must **not** be shown to the NLM-1 implementer until its D1 is frozen.

| File | What it is |
|---|---|
| `routing.heldout.json` (+ `generate_routing_heldout.py`) | 317 fresh owner-style phrasings (slang, typos, chatty, indirect, out-of-order; 43 capabilities, 12 multi-capability), each labelled with the capabilities the routed request must carry |
| `heldout.score.test.js` | The scorer. It reports recall, **own-words recall** (the headline metric), fallback rate, routed size against the budget, and groups selected. Run it with `NLM1_HELDOUT=1`; choose the router with `NLM1_ROUTER` (v1 by default; NLM-1 adds `v2`). |
| `acceptance.json` (+ `generate_acceptance.py`), `acceptance.test.jsx` | 16 in-plan reference workflows and 21 cross-turn context cases. Each checks the final state plus a grouped undo. **Pending**: they run only with `NLM1_ACCEPT=1`. |
| `baseline.v1.routing.json`, `baseline.v1.acceptance.json` | The master v1 baseline (2026-11-04): recall 95.3%, own-words recall 73.5%, fallback 21.8%; acceptance 11/37 |

## Rule: no leakage into the main corpus before D1 is frozen

The weakest capabilities on the v1 baseline are clear drawings, alert list, describe setup, daily bars, add widget,
add price level, open layout and breadth now. Their **missed held-out-style phrasings must NOT be copied into the main
capreg corpus** (`qa/capabilityRegression/baseline/corpus.json`) until NLM-1's D1 is frozen. Copying them early would
leak the held-out set into what the implementer trains against and inflate the score.

**After the freeze:**
1. Add those misses, in the same styles (fresh wordings, not these exact sentences), to the main corpus with their
   current failure modes as known gaps.
2. Re-score the held-out set on v1 and v2.
3. Keep this set private for the next milestone, or retire it.

The one exception already made: the wrong-target defect found here (P02 / P15) went to master as CG-37 (draft PR #787)
for the production fix. Those three sentences describe a defect, not a routing style, and fixing it needs a regression
case on master.
