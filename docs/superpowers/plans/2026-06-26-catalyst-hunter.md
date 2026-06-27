# Catalyst Hunter Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use `- [ ]` tracking.
> Spec: `docs/superpowers/specs/2026-06-26-catalyst-hunter-design.md`.

**Goal:** Add an Opus 4.8 + web-search discovery agent that surfaces every
pre-market catalyst (incl. names not yet moving), tagged PRE-MOVE vs mover.

**Architecture:** New `hunter.py` runs Opus 4.8 (web search + adaptive thinking +
structured output) → `collect_all` merges hits by ticker → gate/scoring let
confirmed-but-flat catalysts survive and rank → frontend tags PRE-MOVE + type.

**Tech Stack:** FastAPI/Python backend, Anthropic SDK (Opus 4.8, `web_search_20260209`),
React `CatalystTable.jsx`.

## Global Constraints

- Synthesis/hunt model = `claude-opus-4-8` (env `CATALYST_HUNTER_MODEL`); Opus
  4.8 rejects `temperature` — omit it.
- Fail-open everywhere: any hunter error → `[]`, refresh never breaks.
- Ships dark behind `CATALYST_HUNTER_ENABLED` (default `0`).
- No generic emoji in UI — use `UIcon`.
- Ship via worktree → FF push to master; verify `grep -c broker_sync api/main.py` ≥ 7.

---

### Task 1: Hunter module — structured-output parsing + validation (pure)

**Files:** Create `api/services/catalyst/hunter.py`, `tests/test_catalyst_hunter.py`

**Produces:** `HUNTER_TYPES` set; `_coerce_hits(raw: list|dict) -> list[dict]`
(validates ticker `^[A-Z.]{1,6}$`, coerces catalyst_type into `HUNTER_TYPES`
else `News`, requires headline, carries source_url/when/moving_yet bool);
`run_hunt(mode: str, existing_tickers: set[str]|None=None) -> list[dict]`
(returns `[]` when disabled or on any error).

- [ ] Test `_coerce_hits`: drops bad tickers, coerces unknown type→News, casts
  `moving_yet` truthy→bool, drops entries missing ticker/headline.
- [ ] Test `run_hunt` returns `[]` when `CATALYST_HUNTER_ENABLED` unset.
- [ ] Implement; mock the Anthropic client for a happy-path `run_hunt` test
  (returns parsed hits). Run tests green. Commit.

Key implementation notes (in `run_hunt`):
- Gated on `CATALYST_HUNTER_ENABLED`.
- Build messages: deep prompt (full category sweep) vs light prompt (given
  `existing_tickers`, only new/changed since last hunt).
- `client.messages.create(model=CATALYST_HUNTER_MODEL, max_tokens=8000,
  thinking={"type":"adaptive"}, tools=[{"type":"web_search_20260209","name":"web_search"}],
  output_config={"format":{"type":"json_schema","schema": HIT_LIST_SCHEMA}},
  messages=...)`. Loop on `stop_reason=="pause_turn"` up to
  `CATALYST_HUNTER_MAX_ITERATIONS` (default 8), re-sending assistant content.
  On `temperature`-style 400, retry without it (mirror synthesize).
- Parse final text block as JSON → `_coerce_hits`. Cost-log via
  `cost_guard.record`. Wrap everything in try/except → `[]`.

---

### Task 2: Gate — confirmed catalyst passes when flat

**Files:** Modify `api/services/catalyst/filters.py:is_real_catalyst`; `tests/test_catalyst_filters.py`

- [ ] Test: candidate `{hunter_confirmed: True, gap_pct: 0.3, vol_x: 1.0}` →
  `is_real_catalyst` returns `(True, None)`.
- [ ] Test: junk `{hunter_confirmed: True, price: 1.0}` still fails
  `quality_gate` (unchanged).
- [ ] Add `if c.get("hunter_confirmed"): return True, None` to `is_real_catalyst`
  (alongside earnings/scanner/analyst passes). Run tests green. Commit.

---

### Task 3: Scoring — per-category confirmed-catalyst bonus

**Files:** Modify `api/services/catalyst/scoring.py:score`; `tests/test_catalyst_scoring.py`

**Produces:** `_HUNTER_BONUS = {"M&A":35,"FDA":35,"Earnings":20,"Guidance":18,
"Analyst":15,"Contract":12,"Index":12,"Offering":8,"Halt":15,"News":8}`,
env-overridable via `CATALYST_SCORE_W_HUNTER_<TYPE>` (TYPE uppercased, `&`→``,
non-alnum→`_`).

- [ ] Test: flat candidate `{hunter_confirmed:True, catalyst_type:"M&A", gap_pct:0}`
  scores ≥ 30; a `News` flat one scores lower than the M&A one.
- [ ] Test: a moving candidate (gap 12%) still outranks an equal-type flat one.
- [ ] Implement: when `c.get("hunter_confirmed")`, add the per-type bonus. Run green. Commit.

---

### Task 4: Wire hunter into collect_all + pre_move flag

**Files:** Modify `api/services/catalyst/sources.py:collect_all`; `tests/test_catalyst_sources_hunter.py` (new)

**Consumes:** `hunter.run_hunt`. **Produces:** merged candidate fields
`hunter_confirmed`, `catalyst_type`, `hunter_headline`, `hunter_source_url`,
`hunter_when`, `moving_yet` on candidates from hunter hits.

- [ ] Test (mock `hunter.run_hunt` → one hit for "NEWCO"): collect_all output
  contains a NEWCO candidate with `hunter_confirmed True` + carried fields.
- [ ] Add `hunter` to the parallel task set; after the union, fold hunter hits in
  (merge onto existing ticker dict, or add new candidate). Compute nothing about
  pre_move here. Run green. Commit.

Notes: pass `mode`/`existing_tickers` via module globals set by the engine, OR
have collect_all accept optional kwargs `hunter_mode="deep"`, `existing_tickers=None`
(default deep, empty) — use kwargs. Engine passes them.

---

### Task 5: Engine — deep/light mode, pre_move, store fields

**Files:** Modify `api/services/catalyst/engine.py:run_refresh`; `api/services/catalyst/store.py`

- [ ] `store.py`: add `pre_move INTEGER` + `catalyst_type` (already exists) to
  schema + backwards-compat ALTER (mirror `refreshed_at`); add `pre_move` to
  `upsert_catalyst` columns; ensure `get_for_date` returns it (SELECT *).
- [ ] `engine.run_refresh`: choose `hunter_mode` = "deep" if no deep hunt ran
  today else "light" (per-date flag in DATA_DIR, e.g. `.hunter_deep_<md>`);
  pass `existing_tickers` = today's ranked tickers to `collect_all`.
- [ ] After grading, set `c["pre_move"] = bool(c.get("hunter_confirmed") and
  abs(c.get("gap_pct") or 0) < float(os.environ.get("CATALYST_PRE_MOVE_GAP","2.0")))`;
  pass `pre_move` + seed `catalyst_type` (hunter's) into `upsert_catalyst`.
- [ ] Smoke-test store round-trips pre_move. Commit.

---

### Task 6: Synthesis prompt gets catalyst_type + headline

**Files:** Modify `api/services/catalyst/synthesize.py:format_prompt`

- [ ] Add a "Hunter catalyst:" line to the prompt when `c.get("hunter_headline")`
  (type + headline + url). No schema change. Commit. (Skip-if-stable hash already
  keys on signals; hunter fields ride in `rss`/signals so resynthesis triggers —
  verify hunter hit is added to the signal set used by the hash, else add it.)

---

### Task 7: Frontend — PRE-MOVE chip + catalyst-type glyph

**Files:** Modify `app/src/components/tiles/CatalystTable.jsx` + `.module.css`;
`app/src/components/tiles/CatalystTable.test.jsx`

- [ ] Render a `PRE-MOVE` chip on rows where `row.pre_move` (distinct style).
- [ ] Render a small `UIcon` per row keyed by `row.catalyst_type`
  (Earnings/Analyst/M&A/FDA/Guidance/Contract/Index/Offering/Halt/News → existing
  UIcon glyphs; fallback generic). NO emoji.
- [ ] Test: a row with `pre_move:true` shows the chip; type glyph renders. Build green. Commit.

---

### Task 8: main.py registration sanity + scheduler log line

**Files:** Modify `api/main.py` (startup log only — hunter runs inside run_refresh)

- [ ] Update the catalyst scheduler print to mention "hunter (deep 6 AM + light)".
- [ ] Verify `grep -c broker_sync api/main.py` ≥ 7. Commit.

---

## Verification
- `python -m pytest tests/ -k "catalyst" -q` green.
- `cd app && npm run build` green.
- FF push to master; deploy dark (`CATALYST_HUNTER_ENABLED` unset).
