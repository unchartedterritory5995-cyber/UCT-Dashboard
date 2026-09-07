# Blind evaluation corpus — hammer

GROUND_TRUTH_STATUS: PENDING

No adjudication has been performed on this corpus. `answer_key_ingredients.json`
records the real detector's own candidate calls ONLY (clearly labeled as such) —
it is NOT a ground-truth label and must not be reported as one. Precision/recall
numbers must not be computed from this corpus until a real adjudication pass
(human or LLM-judge, out of scope for this pass) fills in real identity labels,
analogous to `docs/uct-scanner-intelligence/vcp_gold_standard/data/case_answer_key.json`.

## Sample construction (reproducible)

- Universe: all `4293` distinct tickers with daily bars in
  `C:\data\bars.db` (read-only).
- Sampling: `random.Random(20260906)` fixed-seed shuffle of the full universe,
  taking the first 260 tickers — not filtered or
  cherry-picked by how the detector later scores them.
- Per ticker, evaluated at 2 "as of" points:
  offsets [0, 130] trading days back from the ticker's most
  recent bar (0 = most recent), each fed a 400-bar lookback window
  (skipped if fewer than 320 bars were available).
- Tickers with sufficient history that were actually scanned before the
  scan's early-stop condition was met: 161.
- The REAL detector (`api.services.pattern_engine.detectors.candlestick.hammer.detect_hammer`, repo commit `5e8f6d90c`)
  was run on every window via `build_context()` + the same
  `lab/quality/harness.py::DETECTOR_REGISTRY` entry the fixture-battery
  harness uses — no mocking, no synthetic bars.
- Windows were split into a FIRED pool (n=36 available) and a
  NOT-FIRED pool (n=284 available); this corpus draws
  12 fired + 12 not-fired cases from those pools
  (`random.Random(20260906).sample`), so the sample is not entirely
  detector-selected — a real recall check needs examples the detector
  missed too.
- Case order was shuffled (same seeded RNG) so fired/not-fired status cannot
  be inferred from `case_id` ordering.

## What's in each file

- `blind_packets.json` — 24 cases. Each has a rendered
  chart (`charts/case_XXXX.png`, no symbol/title, no highlighted level — the
  same `api.services.pattern_vision.chart_render.render_chart` the VCP
  gold-standard corpus's own render path uses, called with `key_level=None`
  for every case so a highlighted level can't leak which ones fired) plus
  `neutral_context` (last close, 52w range position, SMA10/20/50, volume
  averages, ADR% — computed directly from bars, NOT from `build_context()`'s
  categorical fields, since those feed the detectors' own confidence scoring
  and would leak verdict-adjacent signal into a "neutral" block).
  **Contains no detector verdict.**
- `answer_key_ingredients.json` — symbol, as-of date, and the detector's own
  candidate call per case_id, kept in a SEPARATE file so a reviewer given
  only `blind_packets.json` + `charts/` cannot see it.

## Next step (not done in this pass)

A human or LLM-judge adjudication pass reads `blind_packets.json` +
`charts/*.png` blind (never `answer_key_ingredients.json`) and produces a
`case_answer_key.json`-equivalent identity label per case (e.g. a
YES/BORDERLINE/NO/INSUFFICIENT_DATA rubric, modeled on
`docs/uct-scanner-intelligence/vcp_gold_standard/rubric_v2.md`). Only after
that exists can precision/recall be computed by joining the answer key
against `answer_key_ingredients.json`'s `detector_candidate_fired` column —
exactly the join `docs/uct-scanner-intelligence/vcp_gold_standard/data/metrics.json`
already performs for VCP.
