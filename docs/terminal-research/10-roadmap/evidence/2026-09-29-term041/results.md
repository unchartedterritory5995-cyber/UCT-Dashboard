# TERM-041 (`FB-A11-02`) — a fixed, published regime vocabulary, permanently

Built 2026-09-29 on base `15a100749` (TERM-071 merged at `1423d8500`, feature commit `6a2e59f3d`).

## 0. Premises, checked against the tree

| premise | verdict |
|---|---|
| backlog has a TERM-041 row, "behind 071" | HELD (`backlog.md` §2.6) |
| backlog has a `#### TERM-041` section that is the spec | **FAILED.** Band 4 is register rows only, by design (§2.9: a package for a ticket behind an unbuilt enabler is a forecast). The spec used is the ticket's FB item, `05-product-strategy/feature-opportunity-backlog.md` `#### FB-A11-02`, plus the verification note in `backlog-bands-4-5-verification.md` (row TERM-041 and the size note: *"derive one from the other and prove it by moving the source, then publish"*). |
| TERM-071 is built and merged | HELD (`6a2e59f3d`, merge `1423d8500`). Its own register row still read BUILDABLE; corrected in this change. |
| "the enum exists twice": `regime_change.py:251` and `voice_regime_classifier.py:24` | HELD in substance. `regime_change.py:251` is exact; the authority's `REGIMES` had moved to `:32` (now `:41`). There are also two more copies TERM-071 declared (path B's scan tuple in `voice_proactive_service.py`, `_REGIME_TO_STAGE` keys in `voice_causal_model.py`). |
| `/api/regime` is "read by the Dashboard's regime panel" (its own docstring) | **FALSE.** Zero readers in `app/src` (grep for `api/regime` → 0). Its readers are server-side through the service. Docstring corrected. |
| `/api/regime` is paid and mounted | HELD (`require_paid`; mounted `api/main.py:8900`, the verification note said `:8785`). |
| the display words for the enum exist in one place | **FALSE before this change.** They were an inline dict inside `get_current_regime()`, and two other modules derived their own words by `id.replace("_", " ")`. |

## 1. What was built — the vocabulary and where it lives

The ONE home is still TERM-071's authority, `api/services/voice_regime_classifier.py`. It now holds the whole vocabulary as module-level literals:

| constant | value (v1) |
|---|---|
| `REGIME_VOCABULARY_VERSION` | `1` |
| `REGIMES` (ordered) | `bull_trend, bull_correction, distribution, chop, bear_trend` |
| `REGIME_DISPLAY` | Bull trend · Bull correction · Distribution · Chop · Bear trend |
| `REGIME_BAND` / `REGIME_BANDS` | GREEN · YELLOW · YELLOW(chop) · ORANGE · RED, from `GREEN, YELLOW, ORANGE, RED` |
| `BAND_DEFAULT` | `YELLOW` (unchanged from TERM-071) |
| `REGIME_UNKNOWN` / `_LABEL` | `unknown` / `Unknown` — a declared sentinel, NOT a regime |

Functions: `label_of(id)` (CLOSED: any non-member renders `Unknown`), `band_of(id)` (TERM-071, unchanged), `regime_vocabulary()` (the publication).

**Published** at `GET /api/regime/vocabulary` (paid, same gate as `/api/regime`; covered by the existing `/api/regime` prefix in `api/rate_limit_policy.py` FAMILIES "market-analytics", segment-boundary match, so no policy edit). Body: `{version, closed, regimes:[{id,label,band}], bands, band_default, unknown:{id,label,band}}`. `/api/regime` responses now carry `vocabulary_version`.

**Permanently** = `tests/test_regime_vocabulary.py::_PUBLISHED`, an append-only table of every published version. The authority's literals are read by AST and must equal `_PUBLISHED[REGIME_VOCABULARY_VERSION]`, and the version must be the latest published. A rename, reorder, re-band, new label, or new sentinel without a version bump reds with the instructions. The file's docstring states the five-step deliberate change procedure.

**Rendered** (migrated modules, each with a moving-the-source rail):

| module | before | after |
|---|---|---|
| `voice_regime_classifier.get_current_regime` | inline display dict | `label_of()` |
| `api/routers/regime.py` fallback | typed `"unknown"` / `"Unknown"` | the authority's sentinel |
| `portfolio_heat.py` + `PortfolioHeat.jsx` | page rendered the raw id `bull_trend` | server sends `regime_label`; page renders it (id only for an old server) |
| `awareness/rules.py` R4 headline | `id.replace("_"," ")` → "bull trend" | `label_of()` → "Bull trend"; `dedup_key` still on the id |

## 2. Disagreements found (the survey)

### 2a. Inside the regime vocabulary (the authority's own words)

1. **Display casing, three forms.** Authority "Bull trend"; awareness R4 and voice path B "bull trend" (`replace`); Portfolio Risk and the voice opportunity body the raw id "bull_trend". R4 and Portfolio Risk migrated.
2. **An undeclared sixth word.** `/api/regime`'s fallback typed `unknown`/`Unknown`. Now the authority's declared sentinel.
3. **NOT migrated — `voice_proactive_service.py:550`** `headline=f"Regime shifted to {cur_regime.replace('_', ' ')}"`. That headline IS the dedupe key: `_regime_shift_already_told` (`:523`) compares the stored headline to the same f-string. Changing the words re-fires one `regime_shift` insight to every member whose last one used the old words. Needs a dedupe on a stored id first (follow-up F1).
4. **NOT migrated — `voice_proactive_service.py:345`** opportunity body `regime: {id}` (raw id; low visibility, model-facing). Follow-up F2.
5. **NOT migrated — `voice_proactive_service.py:290`** falls back to `{"regime": "chop"}` when the classifier raises: it asserts a regime nobody computed and changes which setups are "favored" (`:325-327`). Behaviour change, out of scope. Follow-up F3.
6. `portfolio_heat.py` `sources` still says `regime {id}` — a provenance string, left.
7. The S7 copies (`regime_change.REGIME_LABELS`, path B's scan tuple, `_REGIME_TO_STAGE`) stay DECLARED copies, as TERM-071 ruled: `regime_change.py`'s own comment records that the type module keeps no legacy import at CP1, and `test_alert_taxonomy_regime_change_schema.py` rails it against the authority's AST in order. This rail pins the authority; theirs pin the copies to it. Deriving `REGIME_LABELS` by import is follow-up F4 (an S7 decision).

### 2b. The same WORD in different vocabularies

`Distribution` is a regime (this authority), an engine market phase (`api/routers/intelligence.py:115` `Uptrend, Pullback, Recovery, Rally Attempt, Distribution, Downtrend`), and a Regime Clock quadrant (`app/src/pages/breadth/views/breadthViewShared.js:104` `Expansion, Distribution, Recovery, Contraction`). `Recovery` is shared by the last two. Three vocabularies, one word, three meanings on member surfaces. The new display-word rail deliberately scans only COMPOUND words (with a space) so it does not flag these; renaming is a product decision (F5).

### 2c. Exposure vocabularies (a DIFFERENT quantity — the wire's exposure score, H4; not migrated)

| where | thresholds on the 0-150 score | words |
|---|---|---|
| `app/src/pages/Breadth.jsx:136` colorFn **and** `breadth/heatmapMetrics.js:109` getTier (two copies) | 110/90/70/50/30/15 | g3 g2 g1 a r1 r2 r3 |
| `api/services/journal_two/regime.py` (Exposure Backdrop, Packet W) | 90/50/15 | green amber orange red |
| `app/src/pages/UCT20.jsx:558` | 70/50 | gain / amber / loss |
| wire `game_plan.exposure_tier` (morning-wire `discipline.py`; read by `quote_of_the_day.py`) | engine-side | Aggressive Constructive Neutral Caution Defensive |

They disagree on where "green" starts (70 on UCT20, 90 in the J2 backdrop and Breadth's g2) and on the name of the middle band (`amber` there, `YELLOW` in this authority's sizing bands). They are exposure, not regime, so TERM-041 does not own them; the exposure authority is the wire's score (owner ruling, "owns exposure everywhere"). Journal 2.0 and the morning-wire engine are out of this lane's scope. Follow-up F6: one exposure-tier authority with a parity rail against a pushed fixture (the engine is a separate repo; rail the dashboard against `tests/test_quote_of_the_day.py`-style fixtures, never by editing the engine).

### 2d. The base-rate clause

FB-A11-02 also asks that *"any published regime statistic carries its window and its null model"*. Searched `api/` for outcome statistics keyed on this vocabulary (`by_regime`, `per_regime`, `win_rate`/`hit_rate` with regime): **none exist**. `/api/regime`'s `confidence` is a vote share, not an outcome rate. The two regime-keyed statistics that exist are on OTHER vocabularies: `intelligence.py`'s `performance_by_regime` (engine phases; computed in uct-intelligence) and J2 analytics `byRegime` (exposure backdrop; off-limits). The clause is therefore vacuous for this vocabulary today; recorded rather than railed with a speculative check (F7, which is `FB-A9-02`'s rail).

## 3. Tests

- `tests/test_regime_vocabulary.py` — 18 cases (pin + contiguity + internal closure; classifier output ∈ enum over 5 signal fixtures; `label_of` closure; moving the display moves `get_current_regime`, the publication, Portfolio Risk, the R4 headline; the fallback reads the sentinel and follows it when moved; paid gate on the new route; no `api/` module restates a compound display word; no `app/src` module quotes a regime id or compound word, with a non-vacuity control).
- `app/src/pages/PortfolioHeat.regimeLabel.test.jsx` — 3 cases, asserted as rendered text.
- `tests/test_exposed_routes_gated.py` — `GET /api/regime/vocabulary` declared `paid`.

## 4. Follow-ups

- **F1** dedupe `regime_shift` on a stored regime id, then render `label_of()` in its headline.
- **F2** `voice_proactive` opportunity body → `label_of()`.
- **F3** `voice_proactive` classifier-failure fallback asserts `chop`; should be the sentinel (a behaviour change to opportunity selection).
- **F4** S7 `REGIME_LABELS` derived by import (S7's call; its CP1 no-legacy-import rule).
- **F5** the `Distribution` / `Recovery` word collision across three vocabularies.
- **F6** one exposure-tier authority (§2c).
- **F7** base-rate/window rail for any future regime statistic (`FB-A9-02`).
