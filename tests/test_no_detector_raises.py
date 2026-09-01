"""No SCREENER detector may RAISE. A crashing detector is a silent dead one.

⭐⭐ THE DEFECT THIS EXISTS FOR, MEASURED. `_detect_pocket_pivot` called
`_sma(closes, 10)` where `_sma` takes BARS, so it raised `AttributeError` on
every symbol that got past its early gates. `bases._collect_relations` catches
per-predicate exceptions BY DESIGN — "one bad predicate costs that predicate,
never the row" — which is the right contract and is exactly what made this
invisible. Measured 2026-08-31: pocket-pivot fired on **0 of 2,811 tickers**
while its catalog entry claimed `coverage_pct=1.5`. After the one-word fix it
fires on 43 of 2,811 (1.53%), so the CLAIM had been right all along and the
code had silently stopped matching it.

⛔ WHY A UNIT TEST COULD NOT HAVE CAUGHT IT. Nothing was logically wrong with
the structure's rules, its criteria, its provenance or its catalog entry. The
failure lived in the gap between a correct predicate and a correct swallow, and
only running the predicate over data that reaches its later lines exposes it.

⛔ AND WHY THIS FILE USES SYNTHETIC SERIES RATHER THAN THE REAL UNIVERSE. A rail
that needs `bars.db` cannot run in CI, would touch the owner's live data, and
would be skipped into uselessness. Seeded random walks are deterministic, need
no database, and drive the detectors deep: a walk that gaps, trends, reverses
and expands its range hits the same later lines the universe does — which is
the whole reason this rail reproduces the bug.

─────────────────────────────────────────────────────────────────────────────
WIDENED 2026-08-31 — the swallow has THREE consumers in the screener, not one.

`bar_character.classify` catches `(TypeError, KeyError, ZeroDivisionError)` per
cascade head and `continue`s. That swallow is WORSE than `_collect_relations`'s,
not milder: `_collect_relations` loses one relation, but the CASCADE IS A STRICT
PRIORITY ORDER — first match wins — so a head that raises does not merely lose
its own label, it hands the bar to the NEXT, LOWER-PRIORITY head. The member
does not see a missing label; they see a WRONG one, with nothing anywhere saying
so. `bar_character` is now swept beside `base_catalog` and `bases.classify`.

(The pattern engine's 85 detectors have the same shape behind
`pattern_engine.detect_all`'s `except Exception: log.warning`. They are swept by
`tests/test_no_pattern_detector_raises.py`, off the SAME fixtures.)
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc
from api.services.screener import bar_character as bch
from api.services.screener.bases import BaseCtx

#: ⛔ ONE fixture authority, shared with the pattern-engine rail. See the header
#: of `tests/detector_fixtures.py` for why this is an import and not a copy.
from tests.detector_fixtures import walk as _walk, gap_walk, edge_series, BARS

SERIES = 60          # seeded walks per run
GAP_SERIES = 30      # seeded walks that actually GAP (see `gap_walk`)


def _series():
    """Every synthetic series this file runs over, as `(name, bars)`.

    ⛔ ONE list, consumed by the rule AND by both controls. A control that
    builds its own series proves the control works, not the rail."""
    for seed in range(SERIES):
        yield f"walk/seed={seed}", _walk(seed)
    for seed in range(GAP_SERIES):
        yield f"gap/seed={seed}", gap_walk(seed)
    yield from edge_series()


SERIES_TOTAL = len(list(_series()))


def _ctx(bars):
    return BaseCtx(bars=bars, bars_full=bars)


def _detectors():
    return [s for s in bc.ALL_STRUCTURES if s.detect is not None]


# ─── the control, first ─────────────────────────────────────────────────────

def test_the_fixture_actually_reaches_the_detectors():
    """⛔ NON-VACUITY. Every assertion below is "nothing raised". A fixture that
    every detector rejects on its first line satisfies that trivially. This
    demands the walks be interesting enough that detectors actually FIRE."""
    fired = set()
    for _name, bars in _series():
        ctx = _ctx(bars)
        for s in _detectors():
            if len(ctx.bars) < s.min_bars:
                continue
            try:
                if s.detect(ctx):
                    fired.add(s.key)
            except Exception:
                pass
    # Measured 2026-08-31: 17 of 23 structures fire across these 96 series.
    assert len(fired) >= 14, (
        f"only {sorted(fired)} fired on {SERIES_TOTAL} synthetic series — the "
        f"fixture is not driving the detectors deep enough for 'nothing raised' "
        f"to mean anything"
    )


def _sweep(detectors) -> dict:
    """Run every detector over every series; return {key: [errors]}.

    ⛔ ONE implementation, shared by the rule and by its control. A control that
    reimplements the sweep proves the control works, not the rail — the
    `_render_order` probe in this repo made exactly that mistake and
    re-measured 56 twice."""
    failures = {}
    for name, bars in _series():
        ctx = _ctx(bars)
        for s in detectors:
            if len(bars) < s.min_bars:
                continue
            try:
                s.detect(ctx)
            except Exception as e:                     # noqa: BLE001
                failures.setdefault(s.key, []).append(
                    f"{name}: {type(e).__name__}: {e}")
    return failures


def test_the_sweep_reports_a_PLANTED_crashing_detector():
    """⛔ THE CONTROL THAT MATTERS. `test_no_structure_detector_raises` asserts
    an EMPTY dict — a sweep that silently swallowed its own exceptions, or that
    skipped every detector on a `min_bars` check, would return `{}` and pass
    forever. This plants a detector that always raises and requires the SAME
    `_sweep` to report it by name.

    Mutation-verified against the real thing on 2026-08-31: restoring the
    original `_sma(closes, ...)` bug makes the rule case fail with
    `pocket-pivot: AttributeError ... (8 of 60 series)`."""
    planted = bc.Structure(
        key="planted-crash", label="Planted Crash", axis="relation",
        family="Test", bias="neutral", rank=999, min_bars=1,
        desc="always raises",
        detect=lambda ctx: (_ for _ in ()).throw(
            AttributeError("'float' object has no attribute 'get'")),
    )
    found = _sweep([planted])
    assert "planted-crash" in found, (
        "the sweep did not report a detector that raises on every series — it "
        "cannot see the defect this file exists to catch"
    )
    assert len(found["planted-crash"]) == SERIES_TOTAL


# ─── the rule ───────────────────────────────────────────────────────────────

def test_no_structure_detector_raises_on_any_synthetic_series():
    failures = _sweep(_detectors())
    assert not failures, (
        "these detectors RAISED. `bases._collect_relations` swallows the "
        "exception per predicate, so in production each of these is a "
        "structure that can never fire while its catalog entry still "
        "advertises a coverage figure:\n"
        + "\n".join(f"  {k}: {v[0]}  ({len(v)} of {SERIES_TOTAL} series)"
                    for k, v in sorted(failures.items()))
    )


def test_no_shape_classifier_raises_either():
    """The SHAPE axis is a total partition — a raise there does not lose one
    label, it loses the symbol's only guaranteed answer.

    ⛔ TOTAL *ABOVE `MIN_HISTORY`*, and the refusal below it is its own
    contract. `classify` returns `_NULL` — every key present, every value None —
    for a series shorter than `MIN_HISTORY`, because "a missing key and a null
    value are different facts to every consumer downstream" (its docstring).
    Both halves are asserted, and neither number is typed here: the threshold
    and the key set are read off `bases` itself, so moving either moves the
    test with it."""
    from api.services.screener import bases
    answered = short = 0
    for name, bars in _series():
        try:
            out = bases.classify(bars)
        except Exception as e:                          # noqa: BLE001
            pytest.fail(f"bases.classify raised on {name}: "
                        f"{type(e).__name__}: {e}")
        assert set(out) == set(bases._NULL), (
            f"{name} returned key set {sorted(out)} — a consumer reading a "
            f"missing key sees a different fact from one reading a null")
        if len(bars) >= bases.MIN_HISTORY:
            answered += 1
            assert out.get("base_shape"), (
                f"{name} has {len(bars)} bars (>= MIN_HISTORY="
                f"{bases.MIN_HISTORY}) and produced no shape, but the shape "
                f"axis is a TOTAL partition — every such symbol gets exactly one")
        else:
            short += 1
            assert out == dict(bases._NULL), (
                f"{name} has {len(bars)} bars (< MIN_HISTORY) so classify must "
                f"refuse with the all-null row, not a partial answer: {out}")
    # ⛔ NON-VACUITY on BOTH branches — a fixture with no short series would let
    # the refusal contract rot untested, and one with no long series would let
    # the totality claim pass on an empty set.
    assert answered > 50 and short >= 2, (
        f"the fixture exercised {answered} answering and {short} refusing "
        f"series — both branches of classify must be driven")


# ─── the bar-character cascade ──────────────────────────────────────────────
#
# ⛔ A RAISING HEAD HERE MISLABELS THE BAR, it does not blank it. `classify`
# catches (TypeError, KeyError, ZeroDivisionError) and `continue`s to the next
# head, and because the cascade is a strict priority order the bar then gets
# whatever LOWER-priority head matches next. An Upthrust that raises is silently
# reported as a Wide Range Down Bar. Nothing logs it and the row still looks
# complete, which is why only running the predicates can find it.
#
# The cascade also needs SHORT and DEGENERATE history in a way the structures do
# not: `no-trade` (`not f["v"]`) and `flat-bar` (`rng <= 0`) exist because the
# universe delivers those bars, and half the cascade divides by `rng` or reads
# `f["pc"]`, which is None on a one-bar series.

#: Truncations, so every "short history" branch of `features()` is executed.
_BC_LENGTHS = (BARS, 300, 60, 21, 8, 3, 2, 1)


def _bar_character_series():
    for seed in range(GAP_SERIES):
        full = gap_walk(seed)
        for n in _BC_LENGTHS:
            yield f"gap/seed={seed}/n={n}", full[:n]
    for seed in range(10):
        full = _walk(seed)
        for n in (BARS, 60, 3):
            yield f"walk/seed={seed}/n={n}", full[:n]
    yield from edge_series()


BC_SERIES_TOTAL = len(list(_bar_character_series()))


def _bar_character_sweep(cascade) -> dict:
    """Run every cascade head over every series; return {key: [errors]}.

    ⛔ ONE implementation, shared by the rule and by its planted control —
    same reason as `_sweep` above."""
    failures = {}
    for name, bars in _bar_character_series():
        f = bch.features(bars)
        if f is None:                   # no bar to describe; nothing to run
            continue
        for ch in cascade:
            try:
                ch.detect(f)
            except Exception as e:                     # noqa: BLE001
                failures.setdefault(ch.key, []).append(
                    f"{name}: {type(e).__name__}: {e}")
    return failures


def test_the_fixture_actually_MATCHES_bar_character_heads():
    """⛔ NON-VACUITY, and the stricter half of it. "Nothing raised" over a
    cascade is satisfied by a fixture that never gets past `features()`. This
    demands heads actually MATCH — including the gap family, which the original
    `_walk` could not reach at all because it opened every bar at the prior
    close (see `gap_walk`'s docstring)."""
    matched, saw_features = set(), 0
    for _name, bars in _bar_character_series():
        f = bch.features(bars)
        if f is None:
            continue
        saw_features += 1
        for ch in bch.CASCADE:
            try:
                if ch.detect(f):
                    matched.add(ch.key)
            except Exception:
                pass
    assert saw_features > 100, (
        f"only {saw_features} series produced a feature vector — the fixture is "
        f"not reaching the cascade at all")
    # Measured 2026-08-31: 40 of 55 heads match across these 276 series.
    assert len(matched) >= 35, (
        f"only {len(matched)} of {len(bch.CASCADE)} cascade heads matched "
        f"({sorted(matched)}) — 'nothing raised' says little about the "
        f"{len(bch.CASCADE) - len(matched)} heads never evaluated to True")
    # The gap family is the half `_walk` alone could never reach.
    assert any(k.startswith("gap-") for k in matched), (
        "no gap head matched — the fixture opens every bar at the prior close "
        "again, which silently un-tests 12 of the 55 heads")


def test_the_bar_character_sweep_reports_a_PLANTED_crashing_head():
    """The planted-defect control, routed through the SAME
    `_bar_character_sweep` the rule uses."""
    planted = bch.Character(
        key="planted-crash", label="Planted Crash", tier=5,
        desc="always raises",
        detect=lambda f: (_ for _ in ()).throw(
            TypeError("'>=' not supported between 'NoneType' and 'float'")),
    )
    found = _bar_character_sweep([planted])
    assert "planted-crash" in found, (
        "the sweep did not report a cascade head that raises on every series")
    assert len(found["planted-crash"]) > 100


def test_no_bar_character_head_raises_on_any_synthetic_series():
    failures = _bar_character_sweep(bch.CASCADE)
    assert not failures, (
        "these cascade heads RAISED. `bar_character.classify` catches "
        "(TypeError, KeyError, ZeroDivisionError) and CONTINUES, and the "
        "cascade is a strict priority order — so each of these silently hands "
        "the bar to a LOWER-priority label and the member reads a WRONG "
        "character, not a missing one:\n"
        + "\n".join(f"  {k}: {v[0]}  ({len(v)} of {BC_SERIES_TOTAL} series)"
                    for k, v in sorted(failures.items()))
    )


def test_bar_character_classify_always_answers():
    """The cascade's terminal is identically true, so `classify` is a TOTAL
    partition exactly like `bases.classify` — every bar gets a character."""
    for name, bars in _bar_character_series():
        try:
            out = bch.classify(bars)
        except Exception as e:                          # noqa: BLE001
            pytest.fail(f"bar_character.classify raised on {name}: "
                        f"{type(e).__name__}: {e}")
        assert out.get("bar_character"), (
            f"{name} produced no bar character, but the cascade ends in a "
            f"terminal predicate that is identically true")
