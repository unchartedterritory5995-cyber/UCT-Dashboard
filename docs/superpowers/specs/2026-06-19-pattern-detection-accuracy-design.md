# Pattern Detection Accuracy — Opus-Vision Judge — Design Spec

**Date:** 2026-06-19
**Status:** Approved design, pre-implementation
**Owner:** UCT Dashboard

## 1. Problem

The existing 88-detector pattern engine (`api/services/pattern_engine/`) is, per the
user's manual testing, **"nonsense for the most part"** — broadly untrustworthy.
Root causes (from a code audit):

- **No ground truth, ever.** No labeled set of "this real chart on this date IS a
  VCP." Tests only check detectors run on synthetic shapes; accuracy is never measured.
- **"Untrained" literally.** A feedback endpoint exists (`POST /api/patterns/{id}/feedback`)
  but **nothing consumes it**, and every detection's `history` score component is a
  hardcoded `50.0` placeholder. The engine has zero memory of what's worked.
- **Naive swing-pivot detection** (a bar higher than its 2 neighbors) → false pivots
  in choppy tape → false patterns.
- **Unvalidated thresholds + scoring weights** (`0.40·geometry + 0.25·volume +
  0.20·context + 0.15·history`) and brittle binary hard-gates.

## 2. Approach (approved)

**Candidate → Judge → Confirmed.** Demote the rule engine to a cheap, high-recall
**candidate generator**; add an **Opus 4.8 vision judge** that looks at the actual
rendered chart and rules on whether each candidate is a clean instance of the setup.
**Only confirmed detections reach users**, each with a plain-English rationale. The
**Model Book** (`modelbook_setups`, hand-labeled real setups on real charts) is the
ground-truth yardstick that makes accuracy measurable for the first time.

Why vision: pattern quality is a visual judgment a human makes by looking at the
chart; an image + rubric to Opus mirrors that far better than brittle geometry, kills
false positives immediately, and is explainable — without needing a giant hand-labeled
corpus to start.

### Decisions locked with the user
- **Judge VALIDATES, does not replace** the rule engine (rules = cheap pre-filter for recall; Opus adds precision). Running Opus over the whole universe is too costly, so a high-recall candidate stage is required.
- **Focused setup scope** (the user's whole swing playbook, ~15-20 detectors): VCP + bases (vcp, flat_base, high_tight_flag, cup_handle_uct, launchpad), flags & pullbacks (bull_flag, pullback_to_10ema/21ema/50sma), gaps & catalysts (episodic_pivot, power_earnings_gap, gap_support, news gappers), reversals & reclaims (u_and_r, remount, red_to_green, hammer/engulfing at support). The exotic long tail (rectangles, pennants, most candlesticks) is **ignored** for now.
- **mplfinance** for server-side chart rendering (new backend dependency; deterministic, label-free candlestick+volume+MAs).
- **Confirmed-only surfaces** — screener pattern filter, `/api/patterns`, Compass tools all read confirmed verdicts + show rationale.
- **Cost-guarded, web-side, active-set + on-demand** (mirrors the catalyst engine) — never judge all 3,685 nightly.
- **Model Book = ground-truth** for an accuracy eval harness.
- **Opus 4.8 (`claude-opus-4-8`)** for the judge (per the all-Opus preference).

## 3. Goals / Non-goals

**Goals**
- Pattern output users can trust: confirmed-only, with a reason.
- Accuracy is *measured* (recall vs Model Book, false-positive rate) — the number that's been missing.
- A path to continuous improvement (feedback → calibration → prune bad detectors).

**Non-goals (v1)**
- Rescuing all 88 detectors. Only the focused setups.
- ML/trained model for detection (the rule engine + vision judge replace that need; calibration is statistical, not a neural net).
- Real-time intraday judging (judge runs on the daily/active-set cadence + on-demand).
- Replacing the rule engine's internals (we wrap it, we don't rewrite its detectors in v1).

## 4. Architecture

```
focused rule detectors (candidate generator, high recall)
        │  (ticker, tf, setup, date, raw_confidence)
        ▼
chart_render.py  ── mplfinance ──▶  clean candlestick+volume+MA PNG (window around date)
        │
        ▼
vision_judge.py  ── Opus 4.8 vision + per-setup rubric ──▶ {confirmed, vision_confidence, rationale, key_level}
        │  (cost-guarded, skip-if-stable hash, active-set + on-demand)
        ▼
pattern_verdicts (SQLite)  ──▶  surfaces read CONFIRMED-only (+ rationale)
        ▲
        │
Model Book (modelbook_setups)  ──▶  eval harness: recall + false-positive rate
user 👍/👎 + admin review  ──▶  labeled set ──▶ calibrate rubrics / prune detectors
```

## 5. Components

New package `api/services/pattern_vision/`:

- **`chart_render.py`** — `render_chart(bars, *, setup, asof, window=120) -> bytes` (PNG).
  mplfinance candlestick + volume + the MAs relevant to the setup (10/20/50/200).
  Window framed around the detection date. Deterministic, no title/labels that leak the
  answer. Returns PNG bytes (base64-encoded for the LLM call).
- **`rubrics.py`** — per-setup judging rubric text (`RUBRICS: dict[setup_key, str]`) — the
  explicit visual criteria for each focused setup (e.g. VCP: prior uptrend, ≥2 tightening
  contractions, volume dry-up, pivot not yet broken). Single source of truth for prompts.
- **`vision_judge.py`** — `judge(candidate, png_bytes) -> Verdict`. Builds the Opus
  vision message (image + rubric + "answer JSON: {confirmed, confidence 0-100, reason, key_level}"),
  validates the JSON, returns a `Verdict`. Uses `engine._get_anthropic_client()`. Pure given
  an injected client (testable with a mock).
- **`cost_guard.py`** — reuse the catalyst cost-guard pattern: Opus pricing, daily soft/hard
  caps (`PATTERN_VISION_COST_CAP_DAILY` / `_HARD_CAP`), per-call USD logged. Skip-if-stable
  via a `signals_hash` of (bars window + setup) so an unchanged chart isn't re-judged.
- **`store.py`** — `pattern_verdicts` table CRUD in a dedicated **`/data/pattern_vision.db`**
  (own DB, like cot.db/catalysts.db — keeps the existing pattern_detections store untouched).
- **`orchestrator.py`** — `judge_candidates(candidates, max=N)`: render → cost-gate →
  judge → store. Active-set scan job + on-demand single-ticker path.
- **`eval.py`** — Model Book accuracy harness: `evaluate() -> report`. For each
  `modelbook_setups` row in scope: generate candidate on that ticker/date, judge, record
  hit/miss (recall). Sample random (ticker, date) non-setup points → false-positive rate.
  Returns per-setup precision/recall/FP summary.

### Table `pattern_verdicts`
`(ticker, tf, setup, asof_date, confirmed INTEGER, vision_confidence REAL, rationale TEXT,
key_level REAL, raw_confidence REAL, model TEXT, signals_hash TEXT, judged_at INTEGER,
PRIMARY KEY (ticker, tf, setup, asof_date))`

## 6. Integration

- **Router** `api/routers/patterns.py`: add `GET /api/patterns/confirmed/{sym}` (confirmed
  verdicts + rationale), `POST /api/patterns/judge/{sym}` (admin/on-demand judge),
  `GET /api/admin/patterns/eval` (admin, runs/returns the Model Book report),
  `GET /api/admin/patterns/vision-stats` (cost + counts). Existing `/api/patterns/{sym}`
  gains a `confirmed_only=true` default so current surfaces flip to confirmed verdicts.
- **Scheduler** (`api/main.py`): a `pattern_vision_judge` job over the **active set**
  (leaders + watchlists + UCT20 + screener-recent), gated `PATTERN_VISION_ENABLED`.
- **Screener**: its pattern filter reads confirmed verdicts (replaces the cheap heuristic
  set from the screener snapshot for the focused setups).
- **Compass tools** (`find_patterns_on_ticker` / `scan_active_patterns`): return confirmed
  verdicts + rationale.

## 7. Cost control
- Opus vision calls only on the **active set** + **on-demand** when a user opens a ticker's
  patterns. Never the full universe nightly.
- **Skip-if-stable** `signals_hash` (unchanged chart → reuse prior verdict, ~$0).
- Daily **soft/hard caps**; on hard cap, judging pauses (rule candidates fall back to
  "unconfirmed/pending", surfaced as such — never silently shown as confirmed).
- Per-call cost logged for `/api/admin/patterns/vision-stats`.

## 8. Feedback / calibration (P3)
- Wire `POST /api/patterns/{id}/feedback` to a `pattern_feedback` consumer.
- Admin review surface: confirmed verdicts on their charts → 👍/👎/relabel.
- Periodic calibration: per-setup confirm-rate + feedback → (a) tune rubric thresholds,
  (b) **prune** rule detectors that are mostly rejected (cuts nonsense at the source AND
  Opus cost), (c) optionally feed a confirmation-rate prior into ranking.

## 9. Phasing
1. **P1 — the trust fix:** `chart_render` + `rubrics` + `vision_judge` + `cost_guard` +
   `pattern_verdicts` store + orchestrator (on-demand path) + flip `/api/patterns` +
   screener + Compass to confirmed-only with rationale. Ships usable.
2. **P2 — prove it:** Model Book `eval` harness + `/api/admin/patterns/eval` + tuned
   per-setup rubrics; active-set scheduler job.
3. **P3 — improve it:** feedback wiring + admin review surface + calibration/pruning.

## 10. Testing
- `chart_render` produces a non-empty PNG of expected size from sample bars (no live deps).
- `vision_judge` with a **mocked Anthropic client** returning a canned vision JSON → parses
  to a `Verdict`; malformed JSON → safe rejection.
- `pattern_verdicts` store CRUD + confirmed-only read filter.
- `eval` harness against a handful of seeded Model Book rows → computes recall/FP correctly
  (with the judge mocked).
- `cost_guard` caps (soft warns, hard pauses) + skip-if-stable hash reuse.
- Router: confirmed endpoint shape, admin gating on judge/eval/stats, `confirmed_only` filter.
- Startup fingerprint line: `[startup] pattern-vision: enabled=… model=claude-opus-4-8 cost_cap=… active_set_only=on skip_if_stable=on`.

## 11. Risks / notes
- **New dependency mplfinance** (+ matplotlib) — add to `requirements.txt`; verify nixpacks
  builds it on Railway. If it bloats the image or fails to build, fallback is the existing
  Finviz static chart PNG (`chart.ashx`) as the judge input.
- **Judge faithfulness** — the rendered chart must visually match what a trader sees
  (same MAs, log/linear, enough context). Rubrics must not leak the answer (no setup label
  drawn on the chart).
- **Branch from latest `origin/master`** in an isolated worktree; ship via fast-forward push
  (shared-tree hazard). After merge: `grep -c broker_sync api/main.py` ≥ 7.
- **Don't break the existing pattern engine** — we wrap it; the raw `/api/patterns/{sym}`
  stays available (with `confirmed_only` default) so nothing hard-breaks if vision is disabled.
- Model Book scope mismatch: some Model Book `setup_type` labels use display names that
  differ from `pattern_engine` ids — normalize via a mapping in `eval.py`.
