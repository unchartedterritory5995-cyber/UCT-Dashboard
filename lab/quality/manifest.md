# Evaluation-relevant assets inventory

Scope: bounded first-pass cohort of 6 detector families (see `RESULTS.md`).
Everything below was found by reading, not modified.

## 1. Fixture corpus — `tests/fixtures/<pattern_id>/*.json`

Format is `tests/pattern_engine/detectors/fixture_loader.py`'s `Fixture`
dataclass: each JSON file has `name`, `category` (`positive` / `negative` /
`edge`), `bars` (real-shaped OHLCV), optional `context` (else built fresh via
`build_context`), and `expected` (`fires`, `min_confidence`/`max_confidence`,
optional `geometry_shape`). Every family in the repo (all ~103 detector
`test_*.py` files under `tests/pattern_engine/detectors/`) already follows
this convention and already carries **both positive AND negative/edge
fixtures** — this is not a gap unique to the cohort below.

| pattern_id | subpackage | positive | negative | edge | total (excl. `_generate.py`) |
|---|---|---|---|---|---|
| hammer | candlestick | 5 | 8 | 2 | 15 |
| bull_flag | classical | 5 | 8 | 2 | 15 |
| vcp | uct | 5 | 9 | 2 | 16 |
| pullback_to_50sma | uct | 5 | 8 | 2 | 15 |
| power_earnings_gap | uct | 5 | 10 | 2 | 17 |
| ascending_triangle | classical | 5 | 8 | 2 | 15 |

Every family's own `test_fixture_battery_has_minimum_coverage()` (in each
`test_*.py`) already asserts `positive >= 5, negative >= 8, edge >= 2` — so
the *existence* of negative/adversarial fixtures is a repo-wide enforced
invariant, not something this lab discovered. What is NOT enforced anywhere
is an aggregate recall/false-positive-rate report across a family's own
corpus, or a check that firing detections carry sane geometry — that's the
gap this lab's harness fills (see `RESULTS.md` for what running it found).

## 2. `docs/uct-scanner-intelligence/vcp_gold_standard/` — REAL, REUSABLE, and directly relevant

This is **not** a fixture corpus — it's a human/LLM-adjudicated evaluation of
the actual VCP detector (`api/services/pattern_engine/detectors/uct/vcp.py`,
labeled here "System A") plus a second engine (`base_catalog.py::vcp_state`,
"System D") against **82 real-market cases** (real symbols, real bar
history, evaluated at real historical `as_of` dates going back up to 6
months), scored against a frozen, versioned rubric.

- `data/selected_cases_raw.json` — 82 cases, each with `symbol`, `eval_label`
  (e.g. `t_minus_6mo`), the full `system_a`/`system_d` Detection objects
  (confidence, geometry, levels, context) as actually produced by the
  engines, `liquidity_tier`, `volatility_tier`, `agreement_category`.
- `data/case_answer_key.json` — per-case adjudicated ground truth.
- `data/case_packets.json` — chart file + provenance + neutral context per
  case (82 rendered chart PNGs live in `charts/case_0000.png`..`case_0081.png`).
- `data/metrics.json` — **already-computed** precision/recall/F1 with 95% CIs
  for both engines, on 48 non-ambiguous cases (34 excluded as
  ambiguous/insufficient-data by the rubric):
  - System A (our `vcp.py`): precision 0.40 [0.168, 0.687], recall 0.50
    [0.215, 0.785], F1 0.444, FPR 0.15, FNR 0.5.
  - System D (`base_catalog.py`): precision 0.111, recall 0.25, F1 0.154.
- `rubric_v2.md` — frozen 4-state (YES/BORDERLINE/NO/INSUFFICIENT_DATA)
  labeling rubric with primary-source (Minervini) citations tiered by
  evidence strength (PRIMARY_VERBATIM / DERIVED / OURS).

**Verdict: reusable as-is, and it is materially stronger evidence than
anything a fixture battery can produce**, because it grades the detector
against real historical market data with genuine ambiguity, not
hand-authored bars built to satisfy a specific assertion. It should be cited
as the VCP family's real precision/recall evidence rather than re-derived —
see `RESULTS.md`.

## 3. `api/services/pattern_vision/` — LLM-vision confirmation layer

Read but not exercised in this lab (out of the bounded scope — it operates
on rendered chart images + an LLM judge, not the raw-bar detectors this
mission targets). Its `eval.py`/`vision_judge.py`/`rubrics.py` are what
*produced* the gold-standard corpus above (`scripts/adjudicate_and_compare.py`,
`build_case_packets.py`) — i.e. the gold standard is this system's own
evaluation output, already reusable per point 2.

## 4. What this lab added

- `lab/quality/harness.py` — reusable module: a `DETECTOR_REGISTRY` mapping
  `pattern_id -> (module_path, function_name)`, `run_family(pattern_id)` to
  run every real fixture through the real detector and compute a recall
  proxy / false-positive proxy / geometry-sanity check, and `run_families()`
  for a batch. Extending to a 7th+ family is a one-line registry addition.
- `lab/quality/run_evaluation.py` — runs the 6-family cohort + the
  candlestick context pilot, writes `results.json`.
- `lab/quality/results.json` — full per-fixture output from the actual run.
