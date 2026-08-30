# Base Catalog & Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the base/structure grammar and classifier end-to-end, proven by one complete structure — the Darvas Box, the best-specified entry in the whole research corpus.

**Architecture:** Mirrors the shipped candle library exactly. `base_catalog.py` is ONE grammar (metadata + criteria provenance + predicate per structure); `bases.py` orchestrates guard → context → segment → SHAPE → RELATIONS → rank → render. Nothing else in the repo learns a structure's name.

**Tech Stack:** Python 3, stdlib only. pytest. Consumes the primitives shipped in `2026-08-30-base-detection-primitives.md`.

**Spec:** `docs/superpowers/specs/2026-08-30-base-structure-library-design.md`

## Global Constraints

- **SHAPE is a total partition** (exactly one per symbol, always); **RELATIONS are sparse** (zero or many). Fusing the two axes is what produced the original 7-label candle defect. Spec §5.2.
- **Every criterion carries provenance**: `value` + verbatim `quote` + `source_id`, OR `value: None` + `missing:`, OR `origin: "uct"`. No fourth state. Spec §5.1.
- **A number no house publishes is OURS, labelled.** Never attribute a number to a source that did not say it — the `setup_templates` VCP row already carries a "40-50% breakout volume" figure Minervini never published. Spec §3.
- **No volume gate may be presented as a quality upgrade.** Spec F3.
- **Never build a structure on a provisional swing.** `zigzag.segment` flags the trailing swing; a detector placing an entry or stop on it is publishing a level that can move. Spec §5.2.
- **Never build on a bar that did not trade** — the island-reversal defect. `technicals.usable_bars` upstream, `_usable` inside zigzag.
- **Run tests from the repo root.** Primitive/structure tests live in `tests/pattern_engine/primitives/`; screener-side tests in `tests/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `api/services/screener/base_catalog.py` | **Create.** THE grammar. `Structure` record, `Criterion` record with provenance, `SHAPES` + `RELATIONS` lists, `ALL_STRUCTURES`, `meta()`. |
| `api/services/screener/bases.py` | **Create.** The classifier. `classify(bars) -> dict` returning the snapshot columns. |
| `tests/pattern_engine/primitives/test_base_catalog.py` | **Create.** Grammar invariants + provenance rail. |
| `tests/pattern_engine/primitives/test_bases_darvas.py` | **Create.** The Darvas box state machine. |

---

### Task 1: The grammar — `base_catalog.py`

Metadata and geometry in one place, exactly as `candle_catalog.py` argues. A
structure needs a machine key, a display label, an axis, a bias, a precedence
rank, a member-facing description, its sourced criteria, and (for relations) a
predicate. Split those across a detector module, a filter registry and a
frontend constant and they drift.

**Files:**
- Create: `api/services/screener/base_catalog.py`
- Test: `tests/pattern_engine/primitives/test_base_catalog.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Criterion` — `condition:str`, `value`, `quote:Optional[str]`, `source_id:Optional[str]`, `confidence:str`, `missing:Optional[str]`, `origin:str` (`"source"` | `"uct"`)
  - `@dataclass(frozen=True) class Structure` — `key`, `label`, `axis` (`"shape"`|`"relation"`), `family`, `bias`, `rank`, `min_bars`, `desc`, `criteria: tuple[Criterion, ...]`, `detect: Optional[Callable]`, `needs_intraday: bool`
  - `SHAPES: list[Structure]`, `RELATIONS: list[Structure]`, `ALL_STRUCTURES`, `by_key(key)`, `meta()`

- [ ] **Step 1: Write the failing tests**

Create `tests/pattern_engine/primitives/test_base_catalog.py`:

```python
import pytest

from api.services.screener import base_catalog as bc


def test_every_key_is_unique():
    keys = [s.key for s in bc.ALL_STRUCTURES]
    assert len(keys) == len(set(keys))


def test_every_structure_declares_a_known_axis():
    for s in bc.ALL_STRUCTURES:
        assert s.axis in ("shape", "relation"), s.key


def test_shapes_and_relations_partition_all_structures():
    assert len(bc.SHAPES) + len(bc.RELATIONS) == len(bc.ALL_STRUCTURES)
    assert all(s.axis == "shape" for s in bc.SHAPES)
    assert all(s.axis == "relation" for s in bc.RELATIONS)


def test_every_relation_carries_a_predicate_and_no_shape_does():
    """Shapes are CLASSIFIED by a total cascade; relations are COLLECTED by
    their own predicate. A shape with a predicate would be a second authority
    on what that shape is.
    """
    for s in bc.RELATIONS:
        assert callable(s.detect), f"{s.key} is a relation with no predicate"
    for s in bc.SHAPES:
        assert s.detect is None, f"{s.key} is a shape carrying a predicate"


def test_ranks_are_unique_within_an_axis():
    """Rank is ORDERING ONLY, but a tie makes render order undefined."""
    for group in (bc.SHAPES, bc.RELATIONS):
        ranks = [s.rank for s in group]
        assert len(ranks) == len(set(ranks))


def test_every_criterion_has_exactly_one_provenance_state():
    """⛔ THE PROVENANCE RAIL. A criterion is one of exactly three things:
    sourced (a value AND the quote it came from), refused (no value, plus a
    `missing:` saying what would have to be published), or ours (`origin`
    is 'uct'). Anything else is a number attributed to nobody -- which is
    how `setup_templates` ended up carrying a Minervini breakout-volume
    figure he never published.
    """
    for s in bc.ALL_STRUCTURES:
        for c in s.criteria:
            sourced = c.value is not None and bool(c.quote) and bool(c.source_id)
            refused = c.value is None and bool(c.missing)
            ours = c.origin == "uct"
            assert sum([sourced, refused, ours]) == 1, (
                f"{s.key}: criterion {c.condition!r} is in "
                f"{sum([sourced, refused, ours])} provenance states"
            )


def test_a_uct_origin_criterion_never_claims_a_source():
    for s in bc.ALL_STRUCTURES:
        for c in s.criteria:
            if c.origin == "uct":
                assert not c.source_id, f"{s.key}: uct number cites {c.source_id}"


def test_confidence_is_from_the_closed_vocabulary():
    for s in bc.ALL_STRUCTURES:
        for c in s.criteria:
            assert c.confidence in ("high", "med", "low"), s.key


def test_bias_never_forecasts():
    """Textbook bias only, same ruling as the candle library."""
    for s in bc.ALL_STRUCTURES:
        assert s.bias in ("bullish", "bearish", "neutral"), s.key


def test_meta_exposes_label_and_desc_for_every_key():
    m = bc.meta()
    assert set(m) == {s.key for s in bc.ALL_STRUCTURES}
    for key, entry in m.items():
        assert entry["label"] and entry["desc"]


def test_by_key_returns_none_for_an_unknown_key():
    assert bc.by_key("no-such-structure") is None


def test_banned_verdict_words_appear_in_no_label_or_desc():
    """"Confirmed"/"failed" are banned, extending the candle library's rail.
    A structure describes; it does not grade its own outcome.
    """
    banned = ("confirmed", "failed", "high-probability", "high probability")
    for s in bc.ALL_STRUCTURES:
        blob = f"{s.label} {s.desc}".lower()
        for word in banned:
            assert word not in blob, f"{s.key} says {word!r}"


def test_the_darvas_box_is_registered_as_a_relation():
    box = bc.by_key("darvas-box")
    assert box is not None
    assert box.axis == "relation"
    assert box.criteria, "the box must carry its sourced criteria"


def test_darvas_box_records_that_darvas_publishes_no_duration_bound():
    """He explicitly declines to bound it: 'I did not care how long it stayed
    in its box'. That refusal must survive into the catalog as a refusal,
    not be quietly replaced by a number of ours.
    """
    box = bc.by_key("darvas-box")
    dur = [c for c in box.criteria if "duration" in c.condition.lower()]
    assert dur, "expected a duration criterion"
    assert any(c.value is None and c.missing for c in dur)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/primitives/test_base_catalog.py -v`
Expected: collection error — `No module named 'api.services.screener.base_catalog'`

- [ ] **Step 3: Write the grammar**

Create `api/services/screener/base_catalog.py`. The module docstring must
carry the two-axis argument and the provenance rule; then:

```python
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass(frozen=True)
class Criterion:
    """One rule from one house, with where it came from.

    EXACTLY ONE of three states (test-pinned):
      sourced -> `value` set, `quote` + `source_id` set, origin "source"
      refused -> `value` None, `missing` says what would have to be published
      ours    -> `origin` "uct", no `source_id`
    """
    condition: str
    value: object = None
    quote: Optional[str] = None
    source_id: Optional[str] = None
    confidence: str = "med"
    missing: Optional[str] = None
    origin: str = "source"


@dataclass(frozen=True)
class Structure:
    key: str                 # stable machine key — NEVER renamed
    label: str               # display string
    axis: str                # "shape" (total) | "relation" (sparse)
    family: str
    bias: str                # textbook: bullish | bearish | neutral
    rank: int                # ORDERING ONLY, never displayed
    min_bars: int
    desc: str
    criteria: tuple = ()
    detect: Optional[Callable] = None
    needs_intraday: bool = False
```

Then define `SHAPES` (start with the total-partition placeholders the
classifier needs — see Task 2), `RELATIONS` containing the Darvas Box with
its criteria transcribed from
`docs/superpowers/research/bases/09-darvas-livermore-greenline.md`, and:

```python
ALL_STRUCTURES = SHAPES + RELATIONS
_BY_KEY = {s.key: s for s in ALL_STRUCTURES}


def by_key(key):
    return _BY_KEY.get(key)


def meta():
    return {s.key: {"label": s.label, "desc": s.desc, "axis": s.axis,
                    "family": s.family, "bias": s.bias,
                    "needs_intraday": s.needs_intraday}
            for s in ALL_STRUCTURES}
```

The Darvas criteria to transcribe, verbatim quotes from the corpus file:

| condition | value | quote | confidence |
|---|---|---|---|
| Box top confirmed after N sessions with no new high | 3 | "The top of a box is established when the stock does not touch or penetrate a previously set new high for three consecutive days." | high |
| Box bottom may not be established until the top is set | `None` (ordering constraint, not a number) | "Equally important: the lower limit of the new box cannot be established until the upper limit is firmly set." | high |
| A touch invalidates — the count resets | `None` | "does not touch or penetrate" | high |
| Box violated by any trade below the lower frame | `None` | "If, however, it fell to 44½, I eliminated it as a possibility." | high |
| Typical box height, narrow stocks | 10 | "some stocks moved in a very small frame, perhaps not more than 10% each way" | med |
| Box duration | `None` + `missing:` | "I did not care how long it stayed in its box" | high |

⛔ The height figures are DESCRIPTIVE — implement them as a reported
statistic of the detected box, never as a gate. The corpus says so
explicitly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/primitives/test_base_catalog.py -v`
Expected: all pass.

- [ ] **Step 5: Verify the provenance rail discriminates**

A rail that cannot fail is not a rail. Temporarily add a criterion with a
value and no quote, confirm `test_every_criterion_has_exactly_one_provenance_state`
goes RED, then remove it.

- [ ] **Step 6: Commit**

```bash
git add api/services/screener/base_catalog.py tests/pattern_engine/primitives/test_base_catalog.py
git commit -m "feat(bases): the base/structure grammar with a provenance rail"
```

---

### Task 2: The classifier — `bases.py`

**Files:**
- Create: `api/services/screener/bases.py`
- Test: extended in Task 3's file

**Interfaces:**
- Consumes: `zigzag.segment`, `base_catalog.SHAPES`/`RELATIONS`
- Produces: `classify(bars) -> dict` with keys `base_shape`, `base_shape_label`, `base_matches` (delimiter-WRAPPED `,key,` CSV), `base_relation_count`, `base_render`

⛔ **`base_matches` is delimiter-wrapped**, exactly like `candle_matches`.
`contains` compiles to `LIKE %v%`, so a bare CSV makes a filter for one key
match a longer key that contains it. This is a shipped, documented trap in
the candle library — do not re-introduce it.

- [ ] **Step 1: Write the pipeline**

```python
def classify(bars):
    """guard -> context -> segment -> SHAPE -> RELATIONS -> rank -> render."""
    null = {"base_shape": None, "base_shape_label": None,
            "base_matches": None, "base_relation_count": None,
            "base_render": None}
    if not bars or len(bars) < MIN_HISTORY:
        return dict(null)

    swings = zigzag.segment(bars)
    ctx = _context(bars, swings)

    shape = _classify_shape(ctx)          # TOTAL: always returns a key
    matches = [shape]
    for s in base_catalog.RELATIONS:
        if len(bars) < s.min_bars:
            continue
        try:
            if s.detect(ctx):
                matches.append(s.key)
        except Exception:
            continue                       # one bad relation never kills the row
    ...
```

Render as primary + secondary + count, mirroring the candle library:
`Darvas Box (Higher Base) +1`.

- [ ] **Step 2-4:** tests land with Task 3 (the first real structure); a
  pipeline with no structure to classify cannot be meaningfully tested alone.

---

### Task 3: The Darvas Box state machine

The corpus gives the algorithm outright, including the trap: this is a
**stateful machine across bars**, not a per-bar predicate.

**Files:**
- Modify: `api/services/screener/base_catalog.py` (attach the predicate)
- Create: `tests/pattern_engine/primitives/test_bases_darvas.py`

- [ ] **Step 1: Write the failing tests**

```python
from api.services.screener.bases import _darvas_box_state


def _bar(i, hi, lo):
    return {"t": 1_600_000_000 + i * 86400, "o": (hi + lo) / 2,
            "h": hi, "l": lo, "c": (hi + lo) / 2, "v": 1_000_000}


def test_a_new_high_untouched_for_three_sessions_sets_the_top():
    bars = [_bar(0, 50, 48)] + [_bar(i, 49, 47) for i in range(1, 4)]
    st = _darvas_box_state(bars)
    assert st["top"] == 50


def test_a_touch_resets_the_three_day_count():
    """'does not touch or penetrate' — so the comparison is strict."""
    bars = [_bar(0, 50, 48), _bar(1, 49, 47), _bar(2, 50, 47),
            _bar(3, 49, 47), _bar(4, 49, 47)]
    st = _darvas_box_state(bars)
    assert st["top"] is None or st["top_set_at"] >= 2


def test_the_bottom_is_not_sought_before_the_top_is_set():
    """Darvas: 'the lower limit cannot be established until the upper limit
    is firmly set.' An implementation that tracks both at once is not his.
    """
    bars = [_bar(0, 50, 48)] + [_bar(i, 49, 47) for i in range(1, 3)]
    st = _darvas_box_state(bars)
    assert st["top"] is None
    assert st["bottom"] is None


def test_a_trade_below_the_box_bottom_voids_the_box():
    ...


def test_box_height_is_reported_never_gated():
    """The 10% / 15-20% figures are Darvas's OBSERVATIONS, not filters."""
    ...
```

- [ ] **Steps 2-5:** implement `_darvas_box_state`, run, then run the
  coverage harness from `tools/base_coverage.py` over the real universe and
  RECORD the hit-rate in the catalog entry's `desc`. A structure whose
  coverage was never measured has not been authored.

- [ ] **Step 6: Commit**

---

### Task 4: Coverage + provenance rails wired into the suite

- [ ] Add `test_no_structure_ships_without_a_measured_coverage_note`, reading
  the recorded hit-rate off each catalog entry.
- [ ] Add the delimiter-wrapping test for `base_matches`.
- [ ] Commit.

---

## Done when

- `python -m pytest tests/pattern_engine tests/test_screener*.py -q` is green
  apart from the 2 known pre-existing failures.
- The provenance rail has been demonstrated to FAIL on an unsourced number.
- The Darvas Box's real-universe coverage is measured and recorded, not assumed.
- No snapshot column, filter or view exists yet — that is the next plan.
