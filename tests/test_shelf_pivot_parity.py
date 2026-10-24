"""Shelf pivot (drawing round r4): the ported layer reproduces the frozen layer EXACTLY.

Fixture tests/fixtures/shelf_pivot_parity.json.gz: 427 charts -- the 50 judged packet charts, all 77 drawing days of
the 1,500 held-out random liquid days and 300 of the non-drawing days (seeded sample). Each carries the 600 daily
bars ending at its as-of bar, the member path's served drawings and detector lines on that chart, the frozen
layer's answer (gate, line price, span start, display start, ranker score) and the frozen ranker's probability for
every candidate.

THE TREND FLOOR (2026-10-23): shelf_eligible now rejects every candidate while the as-of close is not above a
RISING 200-day average (base_draw.trend_ok). The frozen answers predate it, so the comparison reads `expect(c)`: the
frozen answer where the floor holds, and "no line" (gate no_shelf) where it does not. The floor is computed HERE by
its own arithmetic (`_floor_ok`), never by base_draw, and the number of recorded lines it removes is pinned.

The rail must be able to fail: the controls at the bottom move ONE parameter / the ranker and assert it goes red.
"""
import gzip
import json
import os

import pytest

from api.services.pattern_engine import shelf_pivot as S

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "shelf_pivot_parity.json.gz")
_CASES = []


def cases():
    if not _CASES:
        with gzip.open(FIXTURE, "rb") as fh:
            _CASES.extend(json.loads(fh.read().decode("utf-8"))["cases"])
    return _CASES


def _floor_ok(c) -> bool:
    """The trend floor, by its own arithmetic: the as-of close above the 200-day average of closes, and that
    average above its value 20 sessions earlier. False with under 220 sessions."""
    cl = [float(r[4]) for r in c["bars"]]
    i = len(cl) - 1
    if i < 219:
        return False
    s200 = sum(cl[i - 199:i + 1]) / 200
    s200p = sum(cl[i - 219:i - 19]) / 200
    return cl[i] > s200 and s200 > s200p


def expect(c) -> dict:
    """The frozen answer under the trend floor: unchanged where it holds; a recorded line becomes no line where not."""
    e = c["expect"]
    if _floor_ok(c) or e["pick"] is None:
        return e
    return {**e, "gate": "no_shelf", "pick": None, "score": None}


#: Recorded shelf lines the trend floor removes from this fixture.
FLOORED_LINES = 65


def _run(c):
    return S.evaluate(c["bars"], c["served"], c["lines"])


def _mismatches(raw=False):
    """Cases whose answer differs from `expect(c)`, or (`raw`) from the frozen answer itself."""
    bad = []
    for c in cases():
        r = _run(c)
        e = c["expect"] if raw else expect(c)
        got = None if r["pick"] is None else {k: r["pick"][k] for k in ("P", "left", "disp_left")}
        if r["gate"] != e["gate"] or got != e["pick"] or (e["pick"] is not None and r["score"] != e["score"]):
            bad.append((c["id"], e, r["gate"], got))
    return bad


def test_the_fixture_is_what_it_says():
    cs = cases()
    ids = [c["id"] for c in cs]
    assert len(cs) == 427 and len(set(ids)) == 427
    assert sum(i.startswith("R4_") for i in ids) == 50
    assert sum(i.startswith("held/draw/") for i in ids) == 77
    assert sum(i.startswith("held/none/") for i in ids) == 300
    # non-vacuity: 127 drawing charts and 300 that draw nothing
    assert sum(c["expect"]["pick"] is not None for c in cs) == 127
    assert all(261 <= len(c["bars"]) <= 600 for c in cs)


def test_the_layer_reproduces_every_case_exactly():
    """Same gate, same line price, same span start, same display start, same ranker score: on every case."""
    assert _mismatches() == []


def test_the_trend_floor_removes_exactly_the_pinned_recorded_lines():
    removed = [c["id"] for c in cases() if c["expect"]["pick"] is not None and not _floor_ok(c)]
    assert len(removed) == FLOORED_LINES, removed


def test_control_without_the_floor_the_reproduction_breaks(monkeypatch):
    """The floor is visible: with base_draw.trend_ok forced true the recorded lines under a falling 200-day come
    back and no longer match `expect`."""
    from api.services.pattern_engine import base_draw
    monkeypatch.setattr(base_draw, "trend_ok", lambda closes, i: True)
    assert len(_mismatches()) >= FLOORED_LINES > 0


def test_the_ranker_matches_the_frozen_probabilities_to_1e9():
    """Every candidate of every chart (gated or not): the pure-Python tree ensemble against the frozen model."""
    n, worst = 0, 0.0
    for c in cases():
        arr = S.arrays(c["bars"])
        i = len(c["bars"]) - 1
        a = S.atr14(arr[2], arr[3], arr[4], i)
        det = {"served": [(p, ls) for p, ls, _ in c["served"]],
               "cand": [(p, v, "withheld" if w else None) for p, v, w in c["lines"]],
               "base_cands": S.base_candidate_gates(arr, i, a) if a else []}
        _a, cands = S.chart_rows(arr, det, i)
        got = S.ranker_scores(cands)
        want = c["cand_scores"]
        assert [(x["P"], x["left"], x["src"]) for x in cands] == [tuple(w[:3]) for w in want], c["id"]
        for g, w in zip(got, want):
            worst = max(worst, abs(g - w[3]))
            n += 1
    assert n > 5000
    assert worst <= 1e-9


def test_the_base_drawing_verdicts_match():
    for c in cases():
        arr = S.arrays(c["bars"])
        i = len(c["bars"]) - 1
        a = S.atr14(arr[2], arr[3], arr[4], i)
        got = [[g, float(p), lip] for g, p, lip in S.base_candidate_gates(arr, i, a)]
        assert got == c["base_cands"], c["id"]


def test_a_short_history_draws_nothing():
    c = next(c for c in cases() if c["expect"]["pick"] is not None)
    r = S.evaluate(c["bars"][-260:], c["served"], c["lines"])
    assert r["gate"] == "short_history" and r["pick"] is None


def test_a_missing_ranker_raises_so_the_caller_draws_nothing(tmp_path):
    with pytest.raises(Exception):
        S.load_ranker(str(tmp_path / "absent.json"))
    bad = tmp_path / "bad.json"
    bad.write_text('{"features": [], "trees": []}', encoding="utf-8")
    with pytest.raises(ValueError):
        S.load_ranker(str(bad))


# ---------------------------------------------------------------- the rail can fail
@pytest.fixture
def no_floor(monkeypatch):
    """The trend floor lifted: the controls below read every frozen case, including the ones the floor removes
    (otherwise a parameter whose only witnesses sit under a falling 200-day would look unseen)."""
    from api.services.pattern_engine import base_draw
    monkeypatch.setattr(base_draw, "trend_ok", lambda closes, i: True)


def test_without_the_floor_the_layer_reproduces_every_frozen_answer(no_floor):
    """Everything but the floor is unchanged: with it lifted, the frozen answers come back exactly."""
    assert _mismatches(raw=True) == []


@pytest.mark.parametrize("key,value", [("CLUSTER_ATR", 0.29), ("THR", 0.11), ("RECENT_EXCL", 1),
                                       ("MAX_EXT_ATR", 0.7), ("SNAP_ATR", 0.24)])
def test_control_moving_one_parameter_goes_red(monkeypatch, no_floor, key, value):
    monkeypatch.setitem(S.PARAMS, key, value)
    assert _mismatches(raw=True), "moving %s did not change any case: the rail cannot see it" % key


def test_control_moving_the_ranker_goes_red(monkeypatch, no_floor):
    m = dict(S.load_ranker())
    m["baseline"] = m["baseline"] + 0.5
    monkeypatch.setattr(S, "_RANKER", [m])
    assert _mismatches(raw=True)


def test_control_moving_the_gate_goes_red(monkeypatch, no_floor):
    monkeypatch.setitem(S.GATE, "KNIFE_DD", 0.55)
    assert _mismatches(raw=True)
