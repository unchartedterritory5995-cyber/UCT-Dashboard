"""PARITY: uct_launch_pad_v4 against the offline lab rule launch_pad_v4.

launch_pad_v4 (team_rules_r6.feats/decide_launch_pad_v4) = launch_pad_v2
(team_rules_r2) + spread <= S + close <= 1 ATR above the pad, no 50-slope gate,
at the frozen S = 0.6 (out_recall_v2/tune_launch_pad_v4.json). This file runs
the lab code itself (imported by path) beside the dashboard code over the same
bars and asserts identical fire / no-fire and identical facts. The lab lives
outside this repo, so the file SKIPS when it is absent.

  * lab path: env `UCT_LAB_TEAM_RULES_R6`, default `team_rules_r6.py` beside the
    recall-v2 lab file test_uct_recall_v2_parity.py already locates
  * real bars: the lab's own read-only loader (bars.db `mode=ro`), when present.

Levels: FROZEN (constants = the lab's frozen grid point and [P] values), RULE
(synthetic corpus, facts and fire), DETECTOR (bars[:i+1], no lookahead),
LOOKAHEAD, MUTATION (each frozen threshold nudged must be caught), REAL (every
session of real histories), WINDOW (the declared 222-bar scan slice vs the
lab's full-history answer).
"""
import importlib.util
import json
import logging
import os
import random
import sys

import pytest

from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_launch_pad_v4 as LP
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor
from tests.pattern_engine.detectors import _team_setups3_synth as SY
from tests.pattern_engine.detectors.test_uct_recall_v2_parity import _LAB as _RECALL_V2_LAB

_LAB = os.environ.get("UCT_LAB_TEAM_RULES_R6") or os.path.join(
    os.path.dirname(_RECALL_V2_LAB), "team_rules_r6.py")
_TUNE_DIR = os.path.join(os.path.dirname(_LAB), "out_recall_v2")
_BARS_DB = "C:/data/bars.db"
_SETUP = "launch_pad_v4"
_N_WALKS = 40
_REAL_HIST = 30


def _load_lab():
    """Import team_rules_r6.py by path without leaking its sys.path / logging
    side effects (same procedure as the other team-setup parity files)."""
    if not os.path.isfile(_LAB):
        return None
    saved_path = list(sys.path)
    saved_disable = logging.root.manager.disable
    had = {m: m in sys.modules for m in ("score", "recall_v2", "team_rules", "team_rules_r2")}
    try:
        spec = importlib.util.spec_from_file_location("uct_lab_team_rules_r6", _LAB)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception as e:
        pytest.skip(f"lab team_rules_r6.py did not import: {e!r}")
    finally:
        sys.path[:] = saved_path
        logging.disable(saved_disable)
        for m, was in had.items():
            if not was:
                sys.modules.pop(m, None)
    return mod


class _Lab:
    def __init__(self, mod):
        self.r6 = mod
        self.mod = mod.T
        path = os.path.join(_TUNE_DIR, "tune_launch_pad_v4.json")
        try:
            with open(path, encoding="utf-8") as f:
                self.p = json.load(f)["chosen"]["p"]
        except Exception as e:
            pytest.skip(f"lab frozen params unreadable ({path}): {e!r}")

    def reset(self):
        self.mod.R._SC.clear()

    def feats(self, tb, i):
        return self.mod.FEATS[_SETUP](tb, i)

    def rule(self, tb, i):
        return self.mod.rule(_SETUP, tb, i, self.p)


@pytest.fixture(scope="module")
def lab():
    mod = _load_lab()
    if mod is None:
        pytest.skip(f"lab rules not present at {_LAB}")
    return _Lab(mod)


def _cmp(lab, tb, db, S, i, counts=None):
    errs = []
    lf, af = lab.feats(tb, i), LP.features(db, S, i)
    if lf != af:
        errs.append(f"facts mismatch at i={i}: lab={lf} dash={af}")
    x, y = lab.rule(tb, i), LP.evaluate(db, S, i)
    if (x is None) != (y is None):
        errs.append(f"fire mismatch at i={i}: lab={x and x['variant']} dash={y and y['variant']}")
    elif x is not None and x != LP.lab_facts(y):
        errs.append(f"fired facts mismatch at i={i}")
    if counts is not None:
        counts["n"] += 1
        counts["fire"] += x is not None
        counts["stacked"] += x is not None and x["variant"] == "stacked"
        counts["f200_refused"] += (lf is not None and lf["f200_over"] and 0 < lf["above"] <= 1.0
                                   and lf["spread"] <= LP.LP_SPREAD)
        counts["spread_refused"] += (lf is not None and LP.LP_SPREAD < lf["spread"] and 0 < lf["above"] <= 1.0
                                     and not lf["f200_over"])
    return errs


def _new_counts():
    return {"n": 0, "fire": 0, "stacked": 0, "f200_refused": 0, "spread_refused": 0}


def _rule_parity(lab, db, counts=None, start=0):
    lab.reset()
    tb = SY.as_tuples(db)
    S = U.series(db)
    errs = []
    for i in range(start, len(db)):
        errs += _cmp(lab, tb, db, S, i, counts)
    return errs


def _named_fixtures():
    return {"pad": SY.launch_pad(), "wide": SY.launch_pad(base=22), "extended": SY.launch_pad(last="extended"),
            "below": SY.launch_pad(last="below"), "falling_200": SY.launch_pad(falling_base=True),
            "none": SY.launch_pad(last="none")}


def _synthetic_corpus():
    return list(_named_fixtures().values()) + [SY.regime_walk(seed=s) for s in range(_N_WALKS)]


# ── frozen constants ─────────────────────────────────────────────────────────

def test_the_ports_constants_are_the_labs_frozen_grid_point(lab):
    r6, r2, m = lab.r6, lab.r6.T2, lab.mod
    assert lab.p == {"spread": LP.LP_SPREAD} == {"spread": 0.6}
    assert lab.p["spread"] in r6.LP4_GRID["spread"]
    assert (r6.LP4_ABOVE_MAX, r6.LP4_MODE, r6.LP4_TIGHT, r6.LP4_CURL) == (
        LP.LP_ABOVE_MAX, LP.LP_MODE, LP.LP_TIGHT, LP.LP_CURL)
    assert (r2.PAD_MAX, r2.S200_SLOPE) == (LP.LP_PAD_MAX, LP.LP_S200_SLOPE)
    assert m.FEATS[_SETUP] is r6.feats_launch_pad_v4 and m.DECIDE[_SETUP] is r6.decide_launch_pad_v4


# ── the fixed synthetic fixture: lab vs app ──────────────────────────────────

_EXPECT = {"pad": "stacked", "wide": None, "extended": None, "below": None, "falling_200": None, "none": None}


@pytest.mark.parametrize("name", sorted(_EXPECT))
def test_the_named_fixtures_answer_as_the_lab_does(lab, name):
    db = _named_fixtures()[name]
    lab.reset()
    tb, S, i = SY.as_tuples(db), U.series(db), len(db) - 1
    x, y = lab.rule(tb, i), LP.evaluate(db, S, i)
    assert (x and x["variant"]) == _EXPECT[name], ("lab", x)
    assert (y and y["variant"]) == _EXPECT[name], ("app", y)


def test_rule_parity_on_the_synthetic_corpus(lab):
    counts = _new_counts()
    errs = []
    for db in _synthetic_corpus():
        errs += _rule_parity(lab, db, counts)
    print(f"\nsynthetic rule parity: {counts}, mismatches={len(errs)}")
    assert counts["fire"] >= 30 and counts["stacked"] >= 5 and counts["fire"] - counts["stacked"] >= 5, counts
    assert counts["f200_refused"] >= 5 and counts["spread_refused"] >= 20, counts
    assert counts["n"] - counts["fire"] >= 10000, counts
    assert errs == [], errs[:10]


def _detector_fires_now(head):
    return any(d["geometry"]["extras"]["trigger_bars_ago"] == 0
               for d in LP.detect_uct_launch_pad_v4(head, {}))


@pytest.mark.parametrize("name", sorted(_EXPECT) + ["walk0", "walk1", "walk2"])
def test_the_detector_reproduces_the_lab_fires_with_no_lookahead(lab, name):
    """The REGISTERED detector on bars[:i+1] fires (trigger_bars_ago == 0)
    exactly when the lab rule fires at i (and the history is at least
    LP._MIN_BARS, below which the detector refuses)."""
    db = _named_fixtures()[name] if not name.startswith("walk") else SY.regime_walk(seed=int(name[4:]))
    tb = SY.as_tuples(db)
    errs, seen = [], 0
    for i in range(65, len(db)):
        head, thead = db[:i + 1], tb[:i + 1]
        lab.reset()
        want = (lab.rule(thead, i) is not None and liquidity_floor(head).passes
                and len(head) >= LP._MIN_BARS)
        got = _detector_fires_now(head)
        seen += want
        if got != want:
            errs.append(f"{name} i={i}: detector={got} lab={want}")
    assert errs == [], errs[:10]
    if name in ("pad", "walk0", "walk1", "walk2"):
        assert seen > 0 or name.startswith("walk")


# ── lookahead ────────────────────────────────────────────────────────────────

#: Walk seeds whose sessions include launch-pad fires (seeds 1, 3 and 5 have
#: none, so a sweep over them could not tell a lookahead from a silence).
@pytest.mark.parametrize("seed", (0, 2, 4, 6))
def test_no_lookahead_rule_at_i_equals_rule_on_bars_through_i(seed):
    bars = SY.regime_walk(seed=seed)
    S_full = U.series(bars)
    fired = 0
    for i in range(len(bars)):
        head = bars[:i + 1]
        S_head = U.series(head)
        assert LP.features(bars, S_full, i) == LP.features(head, S_head, i), ("features", i)
        a, b = LP.evaluate(bars, S_full, i), LP.evaluate(head, S_head, i)
        assert a == b, ("evaluate", i)
        fired += a is not None
    assert fired > 0


def test_future_bars_cannot_change_the_newest_answer():
    db = SY.launch_pad()
    i = len(db) - 1
    before = LP.evaluate(db, U.series(db), i)
    assert before is not None
    junk = db + [SY.bar(i + 1 + k, 1, 1000, 0.5, 2, 1) for k in range(5)]
    assert LP.evaluate(junk, U.series(junk), i) == before


# ── mutation ─────────────────────────────────────────────────────────────────

_MUTATIONS = [
    ("LP_SPREAD", 0.9), ("LP_ABOVE_MAX", 0.5), ("LP_MODE", "c>=e21,s50"), ("LP_TIGHT", 1.5),
    ("LP_CURL", 0.0), ("LP_PAD_MAX", 0.3), ("LP_S200_SLOPE", 5), ("LP_CORE_SPREAD", 1.0),
    ("LP_S50_SLOPE", 5), ("LP_TIGHT_N", 3), ("_WARMUP", 150),
]


def _mismatches(lab, corpus):
    return sum(len(_rule_parity(lab, db)) for db in corpus)


@pytest.mark.parametrize("name,value", _MUTATIONS, ids=[f"{n}={v}" for n, v in _MUTATIONS])
def test_a_mutated_threshold_is_caught(lab, monkeypatch, name, value):
    corpus = [SY.regime_walk(seed=s) for s in range(12)] + list(_named_fixtures().values())
    assert _mismatches(lab, corpus) == 0, "control: the unmutated port must agree"
    monkeypatch.setattr(LP, name, value)
    assert _mismatches(lab, corpus) > 0, f"mutating {name} -> {value} went unnoticed"


# ── real bars (read-only) ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def real(lab):
    if not os.path.isfile(_BARS_DB):
        pytest.skip(f"{_BARS_DB} not present")
    score = lab.mod.R.score
    bars = score.Bars()
    assert "mode=ro" in score.DB, "the lab loader must open bars.db read-only"
    (last,) = bars.c.execute("select max(ts) from ohlcv where tf='D'").fetchone()
    tickers = sorted(t for (t,) in bars.c.execute(
        "select distinct ticker from ohlcv where tf='D' and ts=?", (last,)))
    random.Random(6619).shuffle(tickers)
    yield bars, tickers
    bars.c.close()


def test_rule_parity_on_real_full_histories(lab, real):
    bars, tickers = real
    counts = _new_counts()
    used = 0
    errs = []
    for t in tickers:
        if used >= _REAL_HIST:
            break
        b = bars.get(t)
        if len(b) < LP.MIN_BARS + 40:
            continue
        used += 1
        db = lab.mod.R.to_dict_bars(b)
        errs += [f"{t}: {e}" for e in _rule_parity(lab, db, counts)]
    print(f"\nreal rule parity over {used} histories: {counts}, mismatches={len(errs)}")
    assert used == _REAL_HIST
    assert counts["fire"] > 0 and counts["f200_refused"] + counts["spread_refused"] > 0
    assert errs == [], errs[:10]


def test_the_scan_window_reproduces_the_full_history_answer(lab, real):
    """The daily scan hands the detector its declared slice (MIN_BARS = 222). At
    the newest session and the two prior sessions the wrapper may report, the
    slice must answer as the lab does on the full history. ATR, the SMAs and the
    falling-200 gate are windowed and exact; the 8 / 21 EMAs are seeded at the
    slice's first bar, so the residual is measured and must stay negligible."""
    bars, tickers = real
    assert registry.min_bars_for(LP._PATTERN_ID) == LP.MIN_BARS
    rnd = random.Random(11)
    n = diff = fires = 0
    for t in tickers[:400]:
        b = bars.get(t)
        if len(b) < 400:
            continue
        tb = list(b)
        db = lab.mod.R.to_dict_bars(tb)
        lab.reset()
        for _ in range(5):
            i = rnd.randrange(300, len(db))
            w = db[i + 1 - LP.MIN_BARS:i + 1]
            S = U.series(w)
            for off in range(U.MAX_TRIGGER_AGE):
                j, wj = i - off, len(w) - 1 - off
                full = lab.rule(tb, j)
                got = LP.evaluate(w, S, wj)
                n += 1
                fires += full is not None
                diff += (full is None) != (got is None)
    print(f"\nscan-window parity: n={n} ticker-days, lab fires={fires}, disagreements={diff}")
    assert n >= 3000 and fires > 0
    assert diff <= max(1, n // 1000), diff
