# Blind evaluation corpus — hammer + bull_flag

## Step 1 — what independent evidence already exists, beyond VCP

**VCP remains the only family with a real, rigorous independent study**
(`docs/uct-scanner-intelligence/vcp_gold_standard/`: 82 real-symbol cases,
4-reviewer-persona rubric, precision 0.40 / recall 0.50). Four other assets
were found and are worth recording precisely, because each is a *different*
kind of evidence and none of them is a substitute for VCP's:

1. **`docs/uct-scanner-intelligence/tier1_validation/`** — a large, already-committed
   (2026-09-03/04) **code-level correctness audit** across 7 families
   (`bull_flag`, `bullish_engulfing`/`bearish_engulfing`, `high_tight_flag`,
   `oneil_ascending_flat_base`, `power_earnings_gap`+`episodic_pivot`,
   `pullback_to_50sma`, `vcp`). It found real defects — fabricated narrative
   statistics, a hammer/bull_flag-adjacent class of confidence-floor bugs that
   silently drop geometrically-valid detections, and reproducible false
   positives on penny/illiquid synthetic bars — via code reading, corpus
   citation-checking, and throwaway repro scripts, **not** via a blind/human
   accuracy study. Every family's own entry explicitly records
   `BLINDED VALIDATION recommended=False` — a prior team considered building
   blind corpora for these families and judged code-level fixes cheaper and
   more decisive. This is real, useful evidence of code defects; it is not
   precision/recall ground truth.
2. **`docs/base_lift_ledger.json`** — real measured forward-return *lift* for
   System D's (`base_catalog.py`, a **different engine** than the
   `pattern_engine` detectors this lab evaluates) flat-base (n=21,634,
   lift=-10.56pp, a real negative finding) and ascending-base (n=799,
   lift=+1.77pp, underpowered). This is **outcome data, not identity ground
   truth** — it answers "did price do something after this fired," not "did a
   genuine setup exist here" — and per the mission brief these must not be
   conflated. Also not applicable to `hammer`/`bull_flag`'s pattern_engine
   implementations directly.
3. **`api/services/pattern_vision/`** (the Opus-vision confirmation system) +
   its live `/data/pattern_vision.db` (read locally, read-only): it **does**
   hold real stored verdicts for `hammer` (n=8, 0 confirmed) and `bull_flag`
   (n=20, 2 confirmed), among ~14 setups, 107 rows total. The judge is blind
   to the raw detector's own confidence (`vision_judge.judge()` takes only the
   setup name + chart PNG), so a confirm/deny is a genuine second opinion, not
   an echo. But it is **confirmation-only** — every judged case is one the raw
   detector already fired on, so it can only speak to precision, never
   recall — and it's an LLM judge, not a human, on a tiny N. The data is a
   frozen snapshot (`asof_date` only 2026-07-10 and 2026-08-10):
   `PATTERN_VISION_ENABLED=0` is a deliberate retirement on Railway
   (`feature_flag_index.py`), so nothing new is accumulating.
4. No other `*_gold_standard/` or similarly-labeled directory exists anywhere
   else under `docs/uct-scanner-intelligence/`.

**Honest conclusion:** no independent ground truth exists for `hammer` or
`bull_flag` today. Step 2 below builds the reproducible workflow (and one
honest partial sample) for closing that gap the same way VCP's was closed.

## Step 2 — the workflow

`lab/quality/blind_corpus/build_blind_corpus.py`: opens `C:\data\bars.db`
**read-only**, draws a fixed-seed (`20260906`) random sample of real tickers
from the full universe (4,293 symbols), evaluates the **real** detector
(via `lab/quality/harness.py`'s existing `DETECTOR_REGISTRY`) at 2 real
as-of points per ticker (most-recent bar + ~130 trading days back), splits
results into a FIRED pool and a NOT-FIRED pool, and subsamples **both**
(so the corpus isn't entirely detector-selected — a real recall check needs
the misses too). Each selected case gets a de-identified chart (reused,
unmodified, `api.services.pattern_vision.chart_render.render_chart`, called
with `key_level=None` for every case so a highlighted level can't leak which
ones fired) plus a `neutral_context` block computed directly from raw bars
(never from `build_context()`'s categorical fields, which feed the
detectors' own scoring). Case order is shuffled so `case_id` position leaks
nothing.

**Actual output this pass** (`lab/quality/blind_corpus/`):
- `hammer/`: 24 cases (12 fired-candidate + 12 not-fired), pools of 36/284
  available. `blind_packets.json` + `charts/*.png` (no verdict) +
  `answer_key_ingredients.json` (detector's own candidate call, kept
  separate) + `manifest.md`.
- `bull_flag/`: 24 cases (12/12), pools of 66/254 available. Same file set.

**`GROUND_TRUTH_STATUS: PENDING`** for both families — no adjudication was
performed, and no precision/recall number has been computed or fabricated.
The next step (out of scope here) is a human or LLM-judge pass over
`blind_packets.json` + `charts/` only, producing a `case_answer_key.json`
analogous to VCP's, which then joins against `answer_key_ingredients.json`
exactly as `vcp_gold_standard/data/metrics.json` already does for VCP.
