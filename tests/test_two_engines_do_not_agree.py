"""Two engines answer five names, and on the two biggest they are INDEPENDENT.

⛔⛔ THE FINDING. `api/services/screener/base_catalog.py` and
`api/services/pattern_engine/detectors/**` both implement five concepts under
the same name, and both are LIVE on different member surfaces — the catalog
answers through the screener's `base_matches` column and the provenance panel,
the engine through `pattern_detections`, which Compass reads via
`find_patterns_on_ticker` / `scan_active_patterns`.

The number carried around for this is "3-13%", usually spoken as a DISAGREEMENT
rate. Two things are wrong with that:

  1. It is the AGREEMENT. Restated correctly, on the symbols either engine
     names, the two DISAGREE 86-98% of the time.
  2. It is the wrong statistic. A raw agreement rate between two labels with
     very different base rates is CEILINGED by the mismatch — the catalog names
     7.4% of the universe a double bottom and the engine 26.1%, so a low
     overlap is partly arithmetic and says nothing on its own.

⭐⭐ SO THE HEADLINE IS THE CHANCE-CORRECTED ONE, AND IT IS WORSE THAN THE RAW
NUMBER SUGGESTS. Cohen's kappa over the same counts — 1.0 = identical verdicts,
0.0 = statistically independent:

    concept          kappa   both   expected if independent
    double-bottom    0.010     29          26.9
    vcp              0.003      3           2.7
    wyckoff-spring   0.036      2           0.8
    cup-with-handle  0.091      2           0.2
    flat-base        0.198     20           4.7
    high-tight-flag -0.001      0           0.0

**For `double-bottom` and `vcp`, knowing that one engine fired tells you
essentially nothing about whether the other did.** 29 of the 1,397 symbols
carry both labels; 26.9 is what two independent coin flips at those rates would
have produced. Only `flat-base` shows agreement meaningfully above chance, and
0.198 is still "slight" on any reading of kappa. Two live surfaces are using
one word for two unrelated verdicts.

⭐ MEASURED 2026-09-01 by `tools/two_engine_agreement.py --sample 1500`, which
is committed BECAUSE the rails below say "RE-MEASURE" on every drift they catch,
and a rail demanding a measurement nobody can reproduce is an instruction to
guess.
n=1,397 tickers (`load_universe(1500, seed=7)`, every symbol with >=400 usable
daily bars), BOTH ARMS ON THE SAME 400-BAR ARRAY —
`bases.classify(w, bars_full=series)` against `detect_all(w, build_context(w))`.

    concept          both  base-only  engine-only  neither   agree%  disagree%
    double-bottom      29      74         336        958       6.6      93.4
    flat-base          20      47          77       1253      13.9      86.1
    vcp                 3      23         144       1227       1.8      98.2
    wyckoff-spring      2      45          21       1329       2.9      97.1
    high-tight-flag     0       1           3       1393        --        --
    cup-with-handle*    2       4          33       1358       5.1      94.9

    * NOT an exact-key overlap and therefore invisible to the standing sweep in
      `test_no_second_authority_across_axes.py`, which compares NORMALISED KEYS:
      the catalog spells it `cup-with-handle` and the engine `cup_handle`. It is
      one concept to a member and is measured here for that reason. The stated
      limit in that file ("a pattern-engine STAGE label is invisible to this
      sweep") has a second half: so is a SPELLING.

⛔ high-tight-flag IS NOT "0% AGREEMENT". Four symbols in 1,397 were named by
either engine. That is an empty cell, not a measurement, and printing 0.0
beside the others would be the `lesson_a_fixture_that_cannot_distinguish_is_not
_a_rail` shape — an unmeasurable result wearing a measured one's clothes.
`test_no_agreement_rate_is_claimed_on_a_union_too_small_to_carry_one` refuses
it. Neither engine is silent for it, so this is a THIN detector pair, not a
broken adapter: base 1/1397 (0.07%), engine 3/1397 (0.21%).

⭐ THE OBVIOUS CONFOUND IS RULED OUT, AGAIN AND DIFFERENTLY. The prior pass
checked `end_t` (both engines answer "right now"). This one checks the WINDOW:
the shipped universe scan feeds the engine 200 bars (`api/main.py::
_scan_patterns_daily`) while the screener feeds the catalog 400. Re-running the
engine arm at its own shipped 200-bar depth against the same catalog arm moves
nothing — double-bottom 6.6 -> 6.4, flat-base 13.9 -> 14.0, vcp 1.8 -> 1.8,
wyckoff-spring 2.9 -> 2.9. The disagreement is not a depth artefact.

⭐⭐ WHAT ACTUALLY EXPLAINS IT: THE TWO ENGINES ARE NOT LOOKING FOR THE SAME
THING UNDER THE SAME WORD. Their base rates differ by up to 6x, and even where
the rarer set COULD sit inside the commoner one, it mostly does not:

    concept          base fires   engine fires   of the rarer set, in both
    double-bottom      7.4%          26.1%              28.2%
    flat-base          4.8%           6.9%              29.9%
    vcp                1.9%          10.5%              11.5%
    wyckoff-spring     3.4%           1.6%               8.7%
    cup-with-handle    0.4%           2.5%              33.3%

Seven in ten of the catalog's double bottoms are not double bottoms to the
engine. Nine in ten of the engine's wyckoff springs are not springs to the
catalog. The last column is the number the base-rate objection cannot explain
away: it asks how much of the RARER engine's output the commoner one also
named, and even a strict-subset relationship would have to score 100 there.

⛔⛔ AND A NATURAL EXPERIMENT LANDED MID-MEASUREMENT, WHICH IS THE MOST USEFUL
THING IN THIS FILE. The first pass was taken with `double_bottom`'s
`_MAX_TROUGH2_AGE = 30`: catalog 7.4% / engine 45.1% / agreement 7.8%. A
concurrent session then narrowed that knob to 10 (see
`tests/test_double_bottom_is_in_noise_territory.py`), nearly halving the
engine's coverage to 26.1% — and agreement went DOWN, 7.8% -> 6.6%. Making the
looser engine stricter did not move it toward the other one: it dropped 265 of
its 630 hits, and only 24 of those 265 were symbols the catalog also named, so
the shared set shrank FASTER than the engine did. **These are not
the same rule at different sensitivities. They are different rules.** Anyone
tempted to close this gap by tuning a threshold should start from that.

⛔⛔ NOTHING IS CHANGED, AND THE REASON IS SPECIFIC. The boundary was DECIDED on
2026-08-31 and is written into `double_bottom.py`'s own header: the base library
is authoritative for WHETHER a structure is present (its criteria are sourced,
gated and carry provenance) and the engine is authoritative for WHERE TO ENTER
one (it emits entry/stop/target; the catalog emits a label and its provenance).
Loosening the catalog to match these hit-rates, or deleting the detector, are
both product decisions with a Compass report-card deploy gate behind them that
this pass cannot run. What was missing was not a decision — it was the NUMBER,
written somewhere a person can find it. That is all this file adds.

⚠️ AND THE NUMBER WAS ONLY EVER HALF-WRITTEN, WHICH IS NOT THE SAME AS UNWRITTEN.
The 2026-08-31 table did exist — in a comment above `ENGINE_ALLOWED` in
`test_no_second_authority_across_axes.py`, and in `double_bottom.py`'s header —
so "it exists only in a transcript" was wrong. But a comment beside an
allow-list is not a rail. Nothing there failed when the measurement stopped
describing the code, and that is not hypothetical: `_MAX_TROUGH2_AGE` moved
30 -> 10 DURING this pass, which invalidated a `double_bottom` number in both
places, and every test stayed green. Nothing there could name the
cup-with-handle pair either, because that sweep compares keys. The comment has
been replaced with a pointer here rather than left to drift — two copies of one
measurement is `lesson_a_second_authority_over_one_value` applied to our own
evidence. This file pins the measurement in BOTH directions and names the
shipped thresholds it was taken against.
"""
import ast
import pathlib
import random
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc

ROOT = pathlib.Path(__file__).resolve().parents[1]
ROUTER = ROOT / "api/routers/patterns.py"
DETECTORS = ROOT / "api/services/pattern_engine/detectors"


# ─── derivation: neither engine's name list is typed here ───────────────────

def _load_shipped_registry() -> set:
    """Every pattern id the SHIPPED loader registers.

    ⛔ REGISTRATION, NOT DECLARATION. `test_no_second_authority_across_axes.py`
    greps `_PATTERN_ID` out of the files, which answers "is it written down".
    This imports exactly the modules `_ensure_pattern_detectors_loaded()`
    imports — read off `api/routers/patterns.py`'s AST, so the list is derived
    from the shipped loader rather than retyped — and reads the registry the
    engine actually dispatches through. A detector on disk that no import
    reaches would be invisible to the engine and must be invisible here too.

    ⚠️ The router itself is NOT imported: it pulls FastAPI, the auth middleware
    and `pattern_engine.memory` (which opens `/data/patterns.db`), and none of
    that is needed to register a detector.
    """
    import importlib
    tree = ast.parse(ROUTER.read_text(encoding="utf-8"))
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and n.module and \
                n.module.startswith("api.services.pattern_engine.detectors"):
            for a in n.names:
                importlib.import_module(n.module + "." + a.name)
    from api.services.pattern_engine.detectors import registry
    return set(registry.list_pattern_ids())


def _declared_pattern_ids() -> set:
    """`_PATTERN_ID` as declared on disk — the cross-check on the registry."""
    out = set()
    import re
    for f in DETECTORS.rglob("*.py"):
        if "__pycache__" in f.parts:
            continue
        for m in re.finditer(r'^_PATTERN_ID\s*=\s*"([^"]+)"',
                             f.read_text(encoding="utf-8"), re.M):
            out.add(m.group(1))
    return out


def _norm(s) -> str:
    return str(s).replace("-", "_").replace(" ", "_").lower()


def _exact_key_overlap() -> dict:
    """{base structure key: engine pattern id} for names BOTH engines ship."""
    engine = {_norm(i): i for i in _load_shipped_registry()}
    return {st.key: engine[_norm(st.key)]
            for st in bc.ALL_STRUCTURES if _norm(st.key) in engine}


# ─── what was measured, and what it was measured against ────────────────────

#: The overlap as it stood when the table above was taken. Pinned so that a
#: SIXTH shared name — or the removal of one of these five — makes the table
#: incomplete rather than quietly wrong.
MEASURED_OVERLAP = {
    "double-bottom": "double_bottom",
    "flat-base": "flat_base",
    "high-tight-flag": "high_tight_flag",
    "vcp": "vcp",
    "wyckoff-spring": "wyckoff_spring",
}

#: One concept, two spellings, so key equality cannot see it. Measured with the
#: other five because a member reads the label, not the key.
MEASURED_NEAR_MISS = {"cup-with-handle": "cup_handle"}

#: 2026-09-01 · n=1397 · `load_universe(1500, seed=7)` · both arms on the same
#: 400-bar array. RAW COUNTS ONLY — every rate in this file is derived from
#: these four numbers, never restated beside them.
N = 1397
MEASURED = {
    "double-bottom":   dict(both=29, base_only=74, engine_only=336, neither=958),
    "flat-base":       dict(both=20, base_only=47, engine_only=77, neither=1253),
    "high-tight-flag": dict(both=0, base_only=1, engine_only=3, neither=1393),
    "vcp":             dict(both=3, base_only=23, engine_only=144, neither=1227),
    "wyckoff-spring":  dict(both=2, base_only=45, engine_only=21, neither=1329),
    "cup-with-handle": dict(both=2, base_only=4, engine_only=33, neither=1358),
}

#: The same run with the engine arm at its SHIPPED 200-bar depth
#: (`api/main.py::_scan_patterns_daily`) — the window confound, ruled out.
MEASURED_AT_SHIPPED_DEPTH = {
    "double-bottom":   dict(both=28, base_only=75, engine_only=332, neither=962),
    "flat-base":       dict(both=20, base_only=47, engine_only=76, neither=1254),
    "high-tight-flag": dict(both=0, base_only=1, engine_only=3, neither=1393),
    "vcp":             dict(both=3, base_only=23, engine_only=142, neither=1229),
    "wyckoff-spring":  dict(both=2, base_only=45, engine_only=21, neither=1329),
    "cup-with-handle": dict(both=2, base_only=4, engine_only=32, neither=1359),
}

#: ⛔ THE HARNESS'S OWN NON-VACUITY CONTROL, RECORDED. The catalog arm was run
#: TWICE per symbol on identical bars; it agreed with itself on 1397 of 1397.
#: A comparison that could not report agreement would have failed here first —
#: which is exactly how failure #2 in `tools/probe.py` (a cross-engine probe
#: whose bare `except` swallowed an AttributeError on every ticker and printed
#: "nothing fired") got past a reader.
MEASURED_SELF_AGREEMENT = (1397, 1397)

#: Below this many symbols in the union, a percentage is a shape, not a
#: measurement. `high-tight-flag` has FOUR.
UNMEASURABLE_BELOW_UNION = 20

#: The shipped thresholds the table describes, both sides. AST-derived at
#: capture and AST-derived again by the rail — a knob that moves means the
#: numbers above are about detectors that no longer exist.
ENGINE_SOURCE = {
    "double-bottom": "classical/double_bottom.py",
    "flat-base": "uct/flat_base.py",
    "high-tight-flag": "uct/high_tight_flag.py",
    "vcp": "uct/vcp.py",
    "wyckoff-spring": "uct/wyckoff_spring.py",
    "cup-with-handle": "classical/cup_handle.py",
}
#: (file, constant-name prefix). The catalog namespaces its thresholds per
#: structure; cup-with-handle delegates to a pattern-engine PRIMITIVE, which is
#: its own small finding — the two implementations share a package and not an
#: implementation.
BASE_SOURCE = {
    "double-bottom": ("api/services/screener/base_catalog.py", "DBL_"),
    "flat-base": ("api/services/screener/base_catalog.py", "FLAT_"),
    "high-tight-flag": ("api/services/screener/base_catalog.py", "HTF_"),
    "vcp": ("api/services/screener/base_catalog.py", "VCP_"),
    "wyckoff-spring": ("api/services/screener/base_catalog.py", "SPRING_"),
    "cup-with-handle": ("api/services/pattern_engine/primitives/cup.py", ""),
}

MEASURED_AGAINST = {
 'cup-with-handle': {'base': {'CUP_BEAR_MAX_DEPTH': 0.5,
                              'CUP_MAX_BARS': 325,
                              'CUP_MAX_DEPTH': 0.33,
                              'CUP_MIN_BARS': 35,
                              'CUP_MIN_DEPTH': 0.12,
                              'CUP_PRIOR_UPTREND': 0.3,
                              'CUP_SEARCH_STEP': 5,
                              'CUP_UPTREND_LOOKBACK': 120,
                              'HANDLE_MAX_BARS': 25,
                              'HANDLE_MAX_DEPTH': 0.12,
                              'HANDLE_MIN_BARS': 5,
                              'HANDLE_STEP': 5,
                              'HANDLE_WITHIN_OLD_HIGH': 0.15,
                              'MIN_RIM_EQUALITY': 0.75,
                              'MIN_ROUNDNESS': 0.1,
                              'PIVOT_PAD': 0.1,
                              'RIM_BARS': 10},
                     'engine': {'_CONFIDENCE_FLOOR': 50.0,
                                '_MAX_CUP_DEPTH': 0.5,
                                '_MAX_HANDLE_BARS': 25,
                                '_MAX_HANDLE_DEPTH_RATIO': 0.5,
                                '_MAX_PATTERN_BARS': 120,
                                '_MAX_RIGHT_RIM_AGE': 35,
                                '_MAX_RIM_DIFF': 0.05,
                                '_MIN_BOTTOM_WIDTH_PCT': 0.3,
                                '_MIN_CUP_DEPTH': 0.12,
                                '_MIN_HANDLE_BARS': 5,
                                '_MIN_HANDLE_DEPTH': 0.02,
                                '_MIN_PATTERN_BARS': 30}},
 'double-bottom': {'base': {'DBL_MAX_AGE_BARS': 40,
                            'DBL_MAX_DEPTH': 0.4,
                            'DBL_MAX_UNDERCUT': 0.1,
                            'DBL_MIN_BARS': 35,
                            'DBL_PIVOT_PAD': 0.1,
                            'DBL_PRIOR_UPTREND': 0.3,
                            'DBL_UPTREND_LOOKBACK': 120},
                   'engine': {'_CONFIDENCE_FLOOR': 50.0,
                              '_MAX_PATTERN_BARS': 80,
                              '_MAX_RALLY_DEPTH': 0.25,
                              '_MAX_TROUGH2_AGE': 10,
                              '_MAX_TROUGH_SIMILARITY': 0.04,
                              '_MIN_PATTERN_BARS': 20,
                              '_MIN_RALLY_DEPTH': 0.05,
                              '_MIN_TROUGH_SPACING': 7}},
 'flat-base': {'base': {'FLAT_ADVANCE_LOOKBACK': 60,
                        'FLAT_HEAD_BARS': 5,
                        'FLAT_HEAD_REACH': 0.97,
                        'FLAT_MAX_DEPTH': 0.15,
                        'FLAT_MAX_LOOKBACK': 260,
                        'FLAT_MAX_TIGHTNESS': 0.025,
                        'FLAT_MIN_BARS': 25,
                        'FLAT_PIVOT_PAD': 0.1,
                        'FLAT_PRIOR_ADVANCE': 0.2},
               'engine': {'_CONFIDENCE_FLOOR': 50.0,
                          '_MAX_BASE_BARS': 35,
                          '_MAX_BASE_DEPTH': 0.12,
                          '_MAX_SLOPE_PCT_PER_BAR': 0.005,
                          '_MAX_VOL_LATTER_RATIO': 0.75,
                          '_MIN_BASE_BARS': 15,
                          '_MIN_PRIOR_ADVANCE': 0.25,
                          '_PRIOR_ADVANCE_LOOKBACK': 60}},
 'high-tight-flag': {'base': {'HTF_FLAG_MAX_BARS': 25,
                              'HTF_FLAG_MAX_DEPTH': 0.25,
                              'HTF_FLAG_MIN_BARS': 15,
                              'HTF_FLAG_MIN_DEPTH': 0.1,
                              'HTF_POLE_MAX_BARS': 40,
                              'HTF_POLE_MAX_GAIN': 1.2,
                              'HTF_POLE_MIN_BARS': 20,
                              'HTF_POLE_MIN_GAIN': 1.0},
                     'engine': {'_CONFIDENCE_FLOOR': 50.0,
                                '_MAX_FLAG_BARS': 25,
                                '_MAX_FLAG_RETRACE': 0.25,
                                '_MAX_FLAG_VOLUME_RATIO': 0.6,
                                '_MAX_POLE_BARS': 40,
                                '_MIN_FLAG_BARS': 3,
                                '_MIN_POLE_BARS': 3,
                                '_MIN_POLE_PCT': 0.9}},
 'vcp': {'base': {'VCP_ADVANCE_LOOKBACK': 120,
                  'VCP_HARD_DEPTH': 0.6,
                  'VCP_MAX_AGE_BARS': 60,
                  'VCP_MAX_CONTRACTIONS': 6,
                  'VCP_MAX_DEPTH': 0.4,
                  'VCP_MIN_CONTRACTIONS': 2,
                  'VCP_MIN_DEPTH': 0.1,
                  'VCP_PRIOR_ADVANCE': 0.3,
                  'VCP_RATIO_MAX': 0.75,
                  'VCP_RATIO_MIN': 0.35},
         'engine': {'_CONFIDENCE_FLOOR': 50.0,
                    '_MAX_FINAL_CONTRACTION_PCT': 0.1,
                    '_MAX_FINAL_LOW_AGE': 15,
                    '_MAX_FIRST_CONTRACTION_PCT': 0.4,
                    '_MAX_PATTERN_BARS': 90,
                    '_MIN_CONTRACTIONS': 2,
                    '_MIN_CONTRACTION_PCT': 0.025,
                    '_MIN_FIRST_CONTRACTION_PCT': 0.06,
                    '_MIN_PATTERN_BARS': 30,
                    '_MIN_PRIOR_ADVANCE': 0.2,
                    '_TIGHTENING_RATIO_MAX': 0.85}},
 'wyckoff-spring': {'base': {'SPRING_RECENT_BARS': 10,
                             'SPRING_TR_BARS': 60},
                    'engine': {'_CONFIDENCE_FLOOR': 50.0,
                               '_MAX_RANGE_BARS': 60,
                               '_MAX_RANGE_DEPTH': 0.18,
                               '_MAX_RECLAIM_LAG': 3,
                               '_MAX_SPRING_BARS': 3,
                               '_MAX_SPRING_DEPTH': 0.05,
                               '_MIN_RANGE_BARS': 15,
                               '_MIN_RANGE_DEPTH': 0.03,
                               '_MIN_SPRING_DEPTH': 0.005,
                               '_RECLAIM_VOL_MIN': 1.2}},
}


# ─── the statistic. ONE definition, derived from the raw counts ─────────────

def _union(row) -> int:
    return row["both"] + row["base_only"] + row["engine_only"]


def _agreement_pct(row):
    """Share of the symbols EITHER engine named that BOTH engines named.

    `None` when nothing was named — an empty union is not 0% agreement, and a
    function that returned 0.0 there would launder "we saw nothing" into "they
    never agree".
    """
    u = _union(row)
    return (100.0 * row["both"] / u) if u else None


def _kappa(row):
    """Cohen's kappa over the 2x2. Agreement AFTER chance is removed.

    ⭐ THIS IS THE STATISTIC THE RAW RATE CANNOT REPLACE. Two labels with very
    different base rates cannot overlap much no matter how well they agree, so
    a low raw rate is ambiguous between "they disagree" and "one fires far more
    often". Kappa is not: 0 means the two verdicts carry no information about
    each other.
    """
    n = sum(row.values())
    base = (row["both"] + row["base_only"]) / n
    eng = (row["both"] + row["engine_only"]) / n
    po = (row["both"] + row["neither"]) / n
    pe = base * eng + (1 - base) * (1 - eng)
    return None if pe >= 1.0 else (po - pe) / (1 - pe)


def _expected_both(row):
    """How many symbols BOTH would name if the two verdicts were independent."""
    n = sum(row.values())
    return ((row["both"] + row["base_only"]) *
            (row["both"] + row["engine_only"])) / n


def _module_constants(rel: str, prefix: str = "") -> dict:
    """Module-level numeric assignments, by AST.

    ⛔ AST, NOT A REGEX. `base_catalog` prints its own thresholds inside prose
    and inside `Criterion(value=...)` tuples; a text scan would pick those up
    and this pin would fire on an edited comment.
    """
    tree = ast.parse((ROOT / rel).read_text(encoding="utf-8"))
    out = {}
    for n in tree.body:
        if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant) \
                and isinstance(n.value.value, (int, float)) \
                and not isinstance(n.value.value, bool):
            for t in n.targets:
                if isinstance(t, ast.Name) and t.id.startswith(prefix):
                    out[t.id] = n.value.value
    return out


# ─── the controls, first, because they are what makes the rest mean anything ─

def test_the_derivation_can_see_both_engines():
    """⛔ NON-VACUITY. Every claim below is about an OVERLAP between two name
    sets. A derivation that read one side as empty would find no overlap and
    report it as calmly as a real answer."""
    registered = _load_shipped_registry()
    assert len(bc.ALL_STRUCTURES) > 25, (
        f"only {len(bc.ALL_STRUCTURES)} base structures were read — this rail "
        f"is not looking at the catalog it claims to")
    assert len(registered) > 50, (
        f"only {len(registered)} detectors registered — the shipped loader was "
        f"not reproduced, so any overlap this file reports is meaningless")


def test_every_registered_detector_is_one_declared_on_disk():
    """The registry and the `_PATTERN_ID` declarations must be the same set.

    A detector declared but never imported is invisible to the engine; a
    detector registered under a name no file declares means the AST walk above
    is reading the wrong thing."""
    assert _load_shipped_registry() == _declared_pattern_ids()


def test_the_overlap_finder_responds_to_input():
    """The detector detects. Without this, an `_exact_key_overlap()` that
    always returned `{}` would satisfy the pin below by returning nothing at
    all — and `{}` is what a broken import gives you."""
    keys = {st.key for st in bc.ALL_STRUCTURES}
    engine = {_norm(i) for i in _load_shipped_registry()}
    assert _norm("double-bottom") in engine, "the positive probe is not present"
    assert "advancing-structure" in keys
    assert _norm("advancing-structure") not in engine, (
        "the NEGATIVE probe collides too — pick a base key the engine really "
        "does not implement, or this control proves nothing")


def test_the_agreement_statistic_can_reach_one_hundred_percent():
    """⛔⛔ THE NON-VACUITY CONTROL THAT MATTERS: could this measurement have
    reported AGREEMENT if agreement existed?

    A cross-engine number pinned at ~0 is exactly what a broken adapter looks
    like, so the statistic is fed two fire-vectors that are IDENTICAL by
    construction (100% must come back) and two that are independent draws at
    the measured marginals (far below). If the first case did not return 100,
    every low number in this file would be an artefact of the metric rather
    than a fact about the engines.
    """
    rnd = random.Random(20260901)
    base_rate, engine_rate = 0.074, 0.261      # the measured double-bottom pair
    same = [rnd.random() < base_rate for _ in range(N)]
    row = dict(both=0, base_only=0, engine_only=0, neither=0)
    for a in same:                       # both arms read the SAME vector
        row["both" if a else "neither"] += 1
    assert _union(row) > 0, "the identical-arm control named nobody"
    assert _agreement_pct(row) == 100.0, (
        "two identical arms did not score 100% agreement — the statistic "
        "cannot report agreement, so nothing else in this file is evidence")

    indep = dict(both=0, base_only=0, engine_only=0, neither=0)
    for _ in range(N):                   # independent draws at the real rates
        a, b = rnd.random() < base_rate, rnd.random() < engine_rate
        indep["both" if a and b else ("base_only" if a else
              ("engine_only" if b else "neither"))] += 1
    assert _agreement_pct(indep) < 20.0, (
        "independent draws at the measured base rates scored high agreement — "
        "the statistic is not discriminating")


def test_the_run_recorded_its_own_self_agreement_control():
    """⭐ The harness ran the catalog arm TWICE per symbol on identical bars.
    Anything less than total self-agreement means the arms were not comparable
    and the cross-engine number is measuring the harness, not the engines."""
    got, total = MEASURED_SELF_AGREEMENT
    assert total == N
    assert got == total, (
        f"the catalog arm disagreed with itself on {total - got} of {total} "
        f"symbols — re-derive before believing any number in this file")


# ─── the pins ───────────────────────────────────────────────────────────────

def test_the_overlap_is_exactly_the_one_that_was_measured():
    """⛔ FAILS IN EITHER DIRECTION. A sixth shared name leaves the table
    incomplete; a removed one leaves it describing a collision that is gone."""
    live = _exact_key_overlap()
    assert live == MEASURED_OVERLAP, (
        "the set of names implemented by BOTH engines has changed.\n"
        f"  now:      {sorted(live.items())}\n"
        f"  measured: {sorted(MEASURED_OVERLAP.items())}\n"
        "Re-measure and update the table in the docstring — a stale "
        "cross-engine number is worse than none, because it reads as coverage.")


def test_the_near_miss_pair_is_still_two_spellings_of_one_concept():
    """The cup pair is the reason key equality is not enough. If either side
    is renamed, this file's sixth row is about something that no longer
    exists."""
    keys = {st.key for st in bc.ALL_STRUCTURES}
    registered = _load_shipped_registry()
    for base_key, engine_id in MEASURED_NEAR_MISS.items():
        assert base_key in keys, f"base structure {base_key!r} is gone"
        assert engine_id in registered, f"engine detector {engine_id!r} is gone"
        assert _norm(base_key) != _norm(engine_id), (
            f"{base_key!r} and {engine_id!r} now normalise to the same key, so "
            f"`test_no_second_authority_across_axes.py` sees this pair on its "
            f"own — record it in that file's ENGINE_ALLOWED and drop this case")


def test_the_shipped_thresholds_have_not_moved():
    """⭐ THE TABLE IS ONLY TRUE OF THESE VALUES. Both sides, either direction:
    a knob added, removed or changed means the measurement describes detectors
    that are no longer running."""
    drift = {}
    for key, want in MEASURED_AGAINST.items():
        got_engine = _module_constants(
            "api/services/pattern_engine/detectors/" + ENGINE_SOURCE[key])
        rel, prefix = BASE_SOURCE[key]
        got_base = _module_constants(rel, prefix)
        if got_engine != want["engine"]:
            drift[f"{key}/engine"] = sorted(
                set(got_engine.items()) ^ set(want["engine"].items()))
        if got_base != want["base"]:
            drift[f"{key}/base"] = sorted(
                set(got_base.items()) ^ set(want["base"].items()))
    assert not drift, (
        "these thresholds changed since the agreement table was measured:\n"
        + "\n".join(f"  {k}: {v}" for k, v in sorted(drift.items()))
        + "\n\nRE-MEASURE. Update both the docstring table and "
          "MEASURED_AGAINST — never one without the other.")


def test_the_recorded_table_closes():
    """Four cells, one universe. A row that does not sum to n is a row that
    was assembled rather than counted."""
    for table, label in ((MEASURED, "same-bars"),
                         (MEASURED_AT_SHIPPED_DEPTH, "shipped-depth")):
        for key, row in table.items():
            total = sum(row.values())
            assert total == N, (
                f"{label} row {key!r} sums to {total}, not n={N}")


def test_the_table_covers_every_name_both_engines_ship():
    """A measured overlap with an unmeasured row is the half-written finding
    this file exists to replace."""
    want = set(MEASURED_OVERLAP) | set(MEASURED_NEAR_MISS)
    assert set(MEASURED) == want
    assert set(MEASURED_AT_SHIPPED_DEPTH) == want


def test_neither_engine_is_silent_for_any_shared_name():
    """⛔ A ZERO FROM ONE ENGINE IS A BROKEN ADAPTER, NOT A 0% AGREEMENT.

    If one side never fired, "they never agree" would be a statement about a
    dead code path wearing the words of a statement about two live ones. Every
    shared name has both engines firing at least once, so the disagreement
    above is between two engines that are both awake."""
    silent = {}
    for key, row in MEASURED.items():
        base_n = row["both"] + row["base_only"]
        engine_n = row["both"] + row["engine_only"]
        if base_n == 0 or engine_n == 0:
            silent[key] = (base_n, engine_n)
    assert not silent, (
        f"one engine never fired for {sorted(silent)} — that is an ADAPTER "
        f"failure to investigate, not an agreement rate to report: {silent}")


def test_an_empty_union_is_not_reported_as_zero_percent():
    """⛔ THE CASE THE RECORDED DATA CANNOT EXERCISE, AND THE ONE THAT MATTERS
    MOST. Every measured row here has a non-empty union, so `_agreement_pct`'s
    empty branch is never reached by the table — which means a version that
    returned `0.0` there would pass every other case in this file. It would
    also be the exact defect this file is about: "neither engine named anybody"
    rendered as "the two never agree". Found by mutation, not by reading.
    """
    empty = dict(both=0, base_only=0, engine_only=0, neither=N)
    assert _agreement_pct(empty) is None, (
        "an empty union reported a percentage — 'we saw nothing' has been "
        "laundered into 'they never agree', which is the whole failure this "
        "file exists to name")
    assert _kappa(dict(both=0, base_only=0, engine_only=0, neither=N)) is None


def test_no_agreement_rate_is_claimed_on_a_union_too_small_to_carry_one():
    """⭐ `high-tight-flag` has a union of FOUR out of 1,397. The docstring
    prints `--` for it rather than `0.0%`. This is the case that keeps that
    honest — and it fires the other way too, so a name that grows past the
    floor gets a real number instead of staying dashed forever."""
    thin = {k for k, r in MEASURED.items() if _union(r) < UNMEASURABLE_BELOW_UNION}
    assert thin == {"high-tight-flag"}, (
        f"the set of names too thin to carry a rate has changed: {sorted(thin)}. "
        f"The docstring table prints `--` for exactly one row; make them agree.")
    assert _agreement_pct(MEASURED["high-tight-flag"]) == 0.0, (
        "high-tight-flag now has agreement to report — give it a number in the "
        "table and take the `--` off")


def test_the_finding_disagreement_is_the_majority_everywhere():
    """⛔⛔ THE CLAIM, AS ARITHMETIC OVER THE RAW COUNTS RATHER THAN AS A
    SENTENCE. On every shared name with enough symbols to measure, the two
    engines disagree far more often than they agree."""
    for key, row in MEASURED.items():
        if _union(row) < UNMEASURABLE_BELOW_UNION:
            continue
        agree = _agreement_pct(row)
        assert agree is not None and agree < 50.0, (
            f"{key}: the engines now agree on {agree:.1f}% of the symbols "
            f"either one names. The finding this file records has changed — "
            f"re-measure and rewrite it rather than editing this bound.")


def test_the_measured_agreement_band_is_pinned():
    """The headline, in both directions. If the floor rises or the ceiling
    falls, the '2-14% agreement / 86-98% disagreement' sentence above is no
    longer the sentence the numbers support."""
    rates = sorted(_agreement_pct(r) for k, r in MEASURED.items()
                   if _union(r) >= UNMEASURABLE_BELOW_UNION)
    assert len(rates) == 5, f"expected five measurable names, got {len(rates)}"
    assert round(min(rates), 1) == 1.8, f"floor moved: {min(rates):.2f}"
    assert round(max(rates), 1) == 13.9, f"ceiling moved: {max(rates):.2f}"


#: Kappa above this is "more than slight" on any conventional reading. Nothing
#: measured here reaches it; `flat-base` comes closest at 0.198.
KAPPA_SLIGHT_CEILING = 0.20

#: Below this, the two verdicts are statistically independent for practical
#: purposes — the overlap is what chance alone would produce.
KAPPA_INDEPENDENT = 0.05


def test_the_kappa_can_reach_one_when_the_arms_agree():
    """⛔ NON-VACUITY ON THE HEADLINE STATISTIC. A kappa implementation that
    returned ~0 for everything would make this file's strongest claim an
    artefact of its own arithmetic."""
    perfect = dict(both=100, base_only=0, engine_only=0, neither=1297)
    assert round(_kappa(perfect), 6) == 1.0, (
        "two identical arms did not score kappa 1.0 — the statistic is broken "
        "and every number derived from it below is meaningless")
    opposed = dict(both=0, base_only=100, engine_only=100, neither=1197)
    assert _kappa(opposed) < 0, (
        "systematically opposed arms did not score below zero — the statistic "
        "is not signed and cannot tell independence from anti-agreement")
    independent = dict(both=27, base_only=76, engine_only=338, neither=956)
    assert abs(_kappa(independent)) < 0.02


def test_double_bottom_and_vcp_are_statistically_INDEPENDENT():
    """⛔⛔ THE FINDING, ON THE TWO NAMES THAT CARRY THE MOST SYMBOLS. Their
    overlap is what chance alone produces at those base rates, so one engine's
    verdict predicts nothing about the other's. This is a stronger and less
    escapable claim than the raw rate, and it fails in EITHER direction — if
    the engines are ever reconciled, this rail is what says so."""
    for key in ("double-bottom", "vcp"):
        k = _kappa(MEASURED[key])
        assert k is not None and abs(k) < KAPPA_INDEPENDENT, (
            f"{key}: kappa is now {k:.3f}. The two engines have stopped being "
            f"independent — re-measure and REWRITE the finding rather than "
            f"widening this bound.")
        obs, exp = MEASURED[key]["both"], _expected_both(MEASURED[key])
        assert abs(obs - exp) / max(exp, 1.0) < 0.30, (
            f"{key}: {obs} joint hits against {exp:.1f} expected under "
            f"independence — that is no longer 'chance level'")


def test_no_shared_name_agrees_beyond_slight():
    """Even the best of the five is only slight, and that is the whole point:
    there is no name here where a member could read either surface and get the
    same answer."""
    worst = {}
    for key, row in MEASURED.items():
        if _union(row) < UNMEASURABLE_BELOW_UNION:
            continue
        k = _kappa(row)
        if k is None or k >= KAPPA_SLIGHT_CEILING:
            worst[key] = k
    assert not worst, (
        f"these now agree beyond 'slight': {worst}. The finding has changed — "
        f"rewrite the docstring rather than raising the ceiling.")


def test_the_three_to_thirteen_figure_was_AGREEMENT_not_disagreement():
    """⭐ THE CORRECTION THIS FILE EXISTS TO MAKE PERMANENT. The number carried
    forward from 2026-08-31 as a "3-13% disagreement rate" is the AGREEMENT
    band, and the earlier run's own table in
    `test_no_second_authority_across_axes.py` says so. Read as disagreement it
    describes two engines that mostly concur; the truth is the reverse."""
    prior_agreement = {"double-bottom": 7, "flat-base": 13, "vcp": 3,
                       "wyckoff-spring": 7}
    for key, prior in prior_agreement.items():
        now = _agreement_pct(MEASURED[key])
        assert now < 20.0, f"{key}: agreement is now {now:.1f}%"
        assert 100.0 - now > 80.0, (
            f"{key}: disagreement is {100 - now:.1f}%, so the '{prior}%' "
            f"figure cannot be read as a disagreement rate")


def test_the_window_confound_is_ruled_out():
    """⛔ THE ENGINE'S SHIPPED SCAN SEES 200 BARS AND THE CATALOG SEES 400, so
    "they were shown different history" is the innocent explanation that has to
    die first. Re-running the engine arm at 200 moves every rate by under a
    point."""
    for key in MEASURED:
        if _union(MEASURED[key]) < UNMEASURABLE_BELOW_UNION:
            continue
        a = _agreement_pct(MEASURED[key])
        b = _agreement_pct(MEASURED_AT_SHIPPED_DEPTH[key])
        assert abs(a - b) < 1.0, (
            f"{key}: agreement moves {a:.1f}% -> {b:.1f}% with the engine's "
            f"window alone. Depth WOULD then be part of the explanation and "
            f"the docstring's confound paragraph is wrong.")


def test_both_engines_still_answer_every_shared_name():
    """The catalog must still carry a `detect` for each shared key, and the
    engine a registered function. If either stops answering, the disagreement
    above is history rather than a live product fact."""
    from api.services.pattern_engine.detectors import registry
    registered = _load_shipped_registry()
    by_key = {st.key: st for st in bc.ALL_STRUCTURES}
    for base_key, engine_id in {**MEASURED_OVERLAP, **MEASURED_NEAR_MISS}.items():
        st = by_key.get(base_key)
        assert st is not None and st.detect is not None, (
            f"base structure {base_key!r} no longer has a detector — the "
            f"screener has stopped answering this name")
        assert engine_id in registered
        assert callable(registry.get_detector(engine_id))
