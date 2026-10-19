"""PARITY: uct_inside_day_id4 against the offline lab rule recall_v4 `id4`.

`id4` (lab recall_v4/v4_rules.py) = the frozen inside_day rule OR a gated new
branch (trend c>e21_up, tight 1.0 ATR, the 50 SMA rising vs 10 sessions back,
the close above the 200 SMA). This file runs the lab code itself (imported by
path) beside the dashboard code over the same bars and asserts identical fire /
no-fire, variant and branch. The lab lives outside this repo, so the file SKIPS
when it is absent.

  * lab path: env `UCT_LAB_RECALL_V4`, default `recall_v4/v4_rules.py` in the lab
    root, located from the recall-v2 lab file test_uct_recall_v2_parity.py uses
  * real bars: the lab's own read-only loader (bars.db `mode=ro`), when present.

Levels: FROZEN, RULE (synthetic corpus), DETECTOR (bars[:i+1], no lookahead),
LOOKAHEAD, MUTATION (each frozen threshold nudged must be caught), REAL (every
session of real histories), WINDOW (the declared 202-bar scan slice vs the
lab's full-history answer).
"""
import importlib.util
import logging
import os
import random
import sys

import pytest

from api.services.pattern_engine.detectors.uct import uct_inside_day as ID
from api.services.pattern_engine.detectors.uct import uct_inside_day_id4 as ID4
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor
from tests.pattern_engine.detectors import _team_setups_synth as SY
from tests.pattern_engine.detectors.test_uct_recall_v2_parity import _LAB as _RECALL_V2_LAB

_LAB = os.environ.get("UCT_LAB_RECALL_V4") or os.path.join(
    os.path.dirname(os.path.dirname(_RECALL_V2_LAB)), "recall_v4", "v4_rules.py")
_BARS_DB = "C:/data/bars.db"
_N_WALKS = 40
_REAL_HIST = 30


def _load_lab():
    """Import v4_rules.py by path without leaking its side effects: it prepends
    lab directories to sys.path (one carrying its own `api` package), turns off
    bytecode writing and imports lab modules under generic names. All of that is
    restored; modules the import added are dropped from sys.modules (the lab
    module keeps its own references)."""
    if not os.path.isfile(_LAB):
        return None
    saved_path = list(sys.path)
    saved_disable = logging.root.manager.disable
    saved_bytecode = sys.dont_write_bytecode
    before = set(sys.modules)
    try:
        spec = importlib.util.spec_from_file_location("uct_lab_recall_v4_rules", _LAB)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception as e:  # a lab that cannot import is "absent", never a pass
        pytest.skip(f"lab v4_rules.py did not import: {e!r}")
    finally:
        sys.path[:] = saved_path
        logging.disable(saved_disable)
        sys.dont_write_bytecode = saved_bytecode
        for m in set(sys.modules) - before:
            if not m.startswith(("api", "tests", "pytest", "_pytest")):
                sys.modules.pop(m, None)
    return mod


class _Lab:
    def __init__(self, mod):
        self.v4 = mod
        self.R = mod.T.R

    def reset(self):
        self.R._SC.clear()   # the lab's series cache keys on id(); a recycled id must not hit

    def id4(self, tb, i):
        return self.v4.id4(tb, i)


@pytest.fixture(scope="module")
def lab():
    mod = _load_lab()
    if mod is None:
        pytest.skip(f"lab rules not present at {_LAB}")
    return _Lab(mod)


def _cmp(lab, tb, db, S, i):
    x, y = lab.id4(tb, i), ID4.evaluate(db, S, i)
    if (x is None) != (y is None):
        return [f"id4 fire mismatch at i={i}: lab={x} dash={y and ID4.lab_facts(y)}"]
    if x is not None and x != ID4.lab_facts(y):
        return [f"id4 facts mismatch at i={i}: lab={x} dash={ID4.lab_facts(y)}"]
    return []


def _rule_parity(lab, db, start=0):
    lab.reset()
    tb = SY.as_tuples(db)
    S = U.series(db)
    n = base = new = 0
    errs = []
    for i in range(start, len(db)):
        n += 1
        errs += _cmp(lab, tb, db, S, i)
        c = ID4.evaluate(db, S, i)
        if c is not None:
            new += c["new"]
            base += not c["new"]
    return n, base, new, errs


def _named_fixtures():
    return {"inside_day": SY.inside_day(), "outside_last": SY.outside_last(),
            "inside_downtrend": SY.inside_downtrend(), "flat_at_line": SY.flat_top()}


def _synthetic_corpus():
    return list(_named_fixtures().values()) + [SY.random_walk(seed=s) for s in range(_N_WALKS)]


# ── frozen constants ─────────────────────────────────────────────────────────

def test_the_ports_constants_are_the_labs_frozen_points(lab):
    v = lab.v4
    assert v.ID_P == {"which": "i0", "trend": ID4.BASE_TREND, "tight": ID4.BASE_TIGHT_ATR}
    assert v.ID4_P == {"which": "i0", "trend": ID4.NEW_TREND, "tight": ID4.NEW_TIGHT_ATR}
    assert v.S50_LAG == ID4.S50_LAG
    # the base branch is exactly the shipped uct_inside_day rule
    assert (ID4.BASE_TREND, ID4.BASE_TIGHT_ATR) == (ID.ID_TREND, ID.ID_TIGHT_ATR) and ID.ID_WHICH == "i0"


# ── the fixed synthetic corpus: lab vs app ───────────────────────────────────

def test_rule_parity_on_the_synthetic_corpus(lab):
    total = base = new = 0
    errs = []
    for db in _synthetic_corpus():
        n, b, w, e = _rule_parity(lab, db)
        total, base, new = total + n, base + b, new + w
        errs += e
    print(f"\nsynthetic rule parity: {total} sessions, base fires={base}, new-branch fires={new}, "
          f"mismatches={len(errs)}")
    assert base >= 30 and new >= 30 and total - base - new >= 5000, (base, new, total)
    assert errs == [], errs[:10]


def _detector_fires_now(head):
    return any(d["geometry"]["extras"]["trigger_bars_ago"] == 0
               for d in ID4.detect_uct_inside_day_id4(head, {}))


@pytest.mark.parametrize("name", ["inside_day", "outside_last", "walk0", "walk1", "walk2"])
def test_the_detector_reproduces_the_lab_fires_with_no_lookahead(lab, name):
    db = _named_fixtures()[name] if not name.startswith("walk") else SY.random_walk(seed=int(name[4:]))
    tb = SY.as_tuples(db)
    errs = []
    seen = 0
    for i in range(ID._MIN_IDX, len(db)):
        head, thead = db[:i + 1], tb[:i + 1]
        lab.reset()
        want = lab.id4(thead, i) is not None and liquidity_floor(head).passes
        got = _detector_fires_now(head)
        seen += want
        if got != want:
            errs.append(f"{name} i={i}: detector={got} lab={want}")
    assert errs == [], errs[:10]
    if name.startswith("walk"):
        assert seen > 0


# ── lookahead ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(4))
def test_no_lookahead_rule_at_i_equals_rule_on_bars_through_i(seed):
    bars = SY.random_walk(seed=seed)
    S_full = U.series(bars)
    fired = 0
    for i in range(len(bars)):
        head = bars[:i + 1]
        a, b = ID4.evaluate(bars, S_full, i), ID4.evaluate(head, U.series(head), i)
        assert a == b, i
        fired += a is not None
    assert fired > 0


# ── mutation: the comparison must be able to fail ────────────────────────────

_MUTATIONS = [("NEW_TIGHT_ATR", 0.7), ("NEW_TREND", "c>s50"), ("S50_LAG", 5),
              ("NEED_ABOVE_S200", False), ("BASE_TIGHT_ATR", 1.0), ("BASE_TREND", "c>e21_up")]


@pytest.mark.parametrize("name,value", _MUTATIONS, ids=[n for n, _ in _MUTATIONS])
def test_a_mutated_threshold_is_caught(lab, monkeypatch, name, value):
    corpus = [SY.random_walk(seed=s) for s in range(12)] + list(_named_fixtures().values())
    assert sum(len(_rule_parity(lab, db)[3]) for db in corpus) == 0, "control: the unmutated port agrees"
    monkeypatch.setattr(ID4, name, value)
    assert sum(len(_rule_parity(lab, db)[3]) for db in corpus) > 0, f"mutating {name} went unnoticed"


# ── real bars (read-only) ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def real(lab):
    if not os.path.isfile(_BARS_DB):
        pytest.skip(f"{_BARS_DB} not present")
    score = lab.R.score
    bars = score.Bars()
    assert "mode=ro" in score.DB, "the lab loader must open bars.db read-only"
    (last,) = bars.c.execute("select max(ts) from ohlcv where tf='D'").fetchone()
    tickers = sorted(t for (t,) in bars.c.execute(
        "select distinct ticker from ohlcv where tf='D' and ts=?", (last,)))
    random.Random(4421).shuffle(tickers)
    yield bars, tickers
    bars.c.close()


def test_rule_parity_on_real_full_histories(lab, real):
    bars, tickers = real
    total = base = new = used = 0
    errs = []
    for t in tickers:
        if used >= _REAL_HIST:
            break
        b = bars.get(t)
        if len(b) < ID4.MIN_BARS + 40:
            continue
        used += 1
        tb = list(b)
        db = lab.R.to_dict_bars(tb)
        lab.reset()
        S = U.series(db)
        for i in range(len(db)):
            total += 1
            errs += [f"{t}: {e}" for e in _cmp(lab, tb, db, S, i)]
            c = ID4.evaluate(db, S, i)
            if c is not None:
                new += c["new"]
                base += not c["new"]
    print(f"\nreal rule parity: {total} sessions over {used} histories, base={base}, new={new}, "
          f"mismatches={len(errs)}")
    assert used == _REAL_HIST
    assert base > 0 and new > 0, "the real sample must exercise both branches"
    assert errs == [], errs[:10]


def test_the_scan_window_reproduces_the_full_history_answer(lab, real):
    """The scan hands this detector its declared 202 bars. The 8 / 21 EMAs are
    seeded at the window's first bar, so a near-tie can resolve differently from
    the lab's full history; the residual is measured and must stay negligible."""
    bars, tickers = real
    rnd = random.Random(11)
    n = diff = fires = 0
    for t in tickers[:300]:
        b = bars.get(t)
        if len(b) < 400:
            continue
        tb = list(b)
        db = lab.R.to_dict_bars(tb)
        lab.reset()
        for _ in range(5):
            i = rnd.randrange(300, len(db))
            n += 1
            full = lab.id4(tb, i)
            fires += full is not None
            w = db[i + 1 - ID4.MIN_BARS:i + 1]
            got = ID4.evaluate(w, U.series(w), len(w) - 1)
            diff += (full is None) != (got is None)
    print(f"\nscan-window parity: n={n} ticker-days, fires={fires}, disagreements={diff}")
    assert n >= 500 and fires > 0
    assert diff <= max(1, n // 1000), diff
