"""PARITY: uct_pullback_ma_v5 against the offline lab rule pullback_ma_v5.

`uct_pullback_ma_v5` is a port of `pullback_ma_v5` in the lab's
`recall_v2.py` (v2 base definition + v3 guards + v4 guards and universe
exclusion + v5 rules, with the thresholds frozen in the lab's
out_recall_v2/tune_v3/v4/v5.json). This file runs the lab code itself (imported
by path) beside the dashboard code over the same bars and asserts identical
fire / no-fire and identical facts (variant, tagged MAs, pull, distance, tag
age, 200 SMA slope, depth under the 21 EMA / 50 SMA). The lab lives outside this
repo, so the file SKIPS when it is absent.

  * lab path: env `UCT_LAB_RECALL_V2`, default
    ~/Desktop/TSDR-Ledger-Backup/lab/detectors/recall_v2.py
  * real bars: the lab's own read-only loader (bars.db opened `mode=ro`), when
    the database exists; the real-data half skips otherwise.

Three levels:
  RULE      dashboard `evaluate(...)` vs the lab at the same session i, over
            every session of a series, with the ticker passed through (so the
            excluded-fund branch is compared too).
  DETECTOR  the registered detector on bars[:i+1] vs the lab at i for 200 real
            ticker-days. The detector adds the liquidity floor and reports a
            still-intact trigger from the prior two sessions, so parity is
            "fired with trigger_bars_ago == 0" <=> lab fired.
  MUTATION  each of the port's thresholds nudged one at a time must produce at
            least one mismatch, proving the comparison can fail.

The lab composition used here is `pullback_ma_v5_features` + `v5_decide` with
the frozen thresholds read ONCE (the public `pullback_ma_v5` re-reads three
JSON files per call); `test_the_composition_is_the_public_lab_function` pins
that the two agree.
"""
import importlib.util
import logging
import os
import random
import sys

import pytest

from api.services.pattern_engine.detectors.uct import uct_pullback_ma_v5 as PB
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor
from tests.pattern_engine.detectors import _pullback_v5_synth as SY

_LAB = os.environ.get("UCT_LAB_RECALL_V2") or os.path.expanduser(
    "~/Desktop/TSDR-Ledger-Backup/lab/detectors/recall_v2.py")
_BARS_DB = "C:/data/bars.db"   # the lab loader's own hard-coded read-only path
_REAL_N = 200
_REAL_HIST = 40
_START = PB._MIN_IDX


def _load_lab():
    """Import recall_v2.py by path WITHOUT leaking its side effects: it prepends
    the lab's engine snapshot (which carries its own `api` package) to sys.path
    and disables logging, both process-wide."""
    if not os.path.isfile(_LAB):
        return None
    saved_path = list(sys.path)
    saved_disable = logging.root.manager.disable
    had_score = "score" in sys.modules
    try:
        spec = importlib.util.spec_from_file_location("uct_lab_recall_v2_pb5", _LAB)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception as e:  # a lab that cannot import is "absent", never a pass
        pytest.skip(f"lab recall_v2.py did not import: {e!r}")
    finally:
        sys.path[:] = saved_path
        logging.disable(saved_disable)
        if not had_score:
            sys.modules.pop("score", None)
    return mod


class _Lab:
    def __init__(self, mod):
        self.mod = mod
        try:
            self.k3, self.k4, self.k5 = mod._v3_frozen(), mod._v4_frozen(), mod._v5_frozen()
        except Exception as e:  # frozen thresholds missing = the lab is incomplete
            pytest.skip(f"lab frozen thresholds unreadable: {e!r}")

    def v5(self, tb, i, sym=None):
        x = self.mod.pullback_ma_v5_features(tb, i)
        if x is None:
            return None
        return self.mod.v5_decide(x[0], x[1], sym, self.k3, self.k4, **self.k5)

    def reset(self):
        self.mod._SC.clear()   # its series cache keys on id(); a recycled id must not hit


@pytest.fixture(scope="module")
def lab():
    mod = _load_lab()
    if mod is None:
        pytest.skip(f"lab rules not present at {_LAB}")
    return _Lab(mod)


def _cmp(lab, tb, db, S, i, sym=None):
    x = lab.v5(tb, i, sym)
    y = PB.evaluate(db, S, i, sym)
    if (x is None) != (y is None):
        return f"fire mismatch at i={i} sym={sym}: lab={x} dash={y and PB.lab_facts(y)}"
    if x is not None and x != PB.lab_facts(y):
        return f"facts mismatch at i={i} sym={sym}: lab={x} dash={PB.lab_facts(y)}"
    return None


def _rule_parity_over_series(lab, tb, db, sym=None, start=_START):
    """Compare the rule at every session of one series. Returns (n, fires, errors)."""
    lab.reset()
    S = U.series(db)
    n = fires = 0
    errs = []
    for i in range(start, len(db)):
        n += 1
        e = _cmp(lab, tb, db, S, i, sym)
        if e:
            errs.append(e)
        fires += PB.evaluate(db, S, i, sym) is not None
    return n, fires, errs


def _synthetic_corpus():
    series = [SY.random_walk(seed=s) for s in range(40)]
    series += [SY.fire_e21(U.series), SY.pullback_to_ma(U.series, ma="s50"),
               SY.eight_ema_only(U.series), SY.falling_e21(U.series)]
    return series


# ── thresholds + composition ─────────────────────────────────────────────────

def test_the_ports_constants_are_the_labs_frozen_thresholds(lab):
    m = lab.mod
    assert lab.k3 == {"s200_tol": PB.PB3_S200_TOL_ATR, "brk": 1.0, "dist": PB.PB3_DIST_ATR,
                      "g1_s50": False}
    assert lab.k4["e21_n"] == PB.PB4_E21_N and lab.k4["near"] == PB.PB4_NEAR_ATR
    assert lab.k5 == {"g2": PB.PB5_G2_ATR, "g2_mode": PB.PB5_G2_MODE}
    assert m.PB4_EXCLUDE == PB.PB4_EXCLUDE
    assert tuple(m.PB_MAS) == PB.PB_MAS and m.PB_LOOK == PB.PB_LOOK
    assert (m.PB_TAG_ABOVE_ATR, m.PB_TAG_BELOW_ATR, m.PB_PULLED_ATR) == (
        PB.PB_TAG_ABOVE_ATR, PB.PB_TAG_BELOW_ATR, PB.PB_PULLED_ATR)
    assert m.PB_S50_SLOPE_BARS == PB.PB_S50_SLOPE_BARS
    assert m.PB3_S200_SLOPE_BARS == PB.PB3_S200_SLOPE_BARS
    assert tuple(m.PB3_BREAK_MAS) == PB.PB3_BREAK_MAS and m.PB4_MAX_AGO == PB.PB4_MAX_AGO


def test_the_composition_is_the_public_lab_function(lab):
    checked = fired = 0
    for db in _synthetic_corpus()[::4] + [SY.fire_e21(U.series)]:
        tb = SY.as_tuples(db)
        lab.reset()
        for i in range(len(db) - 40, len(db)):
            for sym in (None, "TQQQ"):
                assert lab.mod.pullback_ma_v5(tb, i, sym=sym) == lab.v5(tb, i, sym)
                checked += 1
                fired += lab.v5(tb, i, sym) is not None
    assert checked > 100 and fired > 0


# ── synthetic ────────────────────────────────────────────────────────────────

def test_rule_parity_on_synthetic_series(lab):
    total = fires = 0
    errs = []
    for db in _synthetic_corpus():
        n, f, e = _rule_parity_over_series(lab, SY.as_tuples(db), db)
        total += n
        fires += f
        errs += e
    # the excluded-fund branch, compared on the same bars
    n, f, e = _rule_parity_over_series(lab, SY.as_tuples(SY.fire_e21(U.series)),
                                       SY.fire_e21(U.series), sym="TQQQ")
    errs += e
    print(f"\nsynthetic rule parity: {total} sessions, fires={fires}, mismatches={len(errs)}")
    assert fires >= 20 and total - fires >= 5000, (fires, total)
    assert errs == [], errs[:10]


def test_the_named_fixtures_separate_v4_from_v5(lab):
    """The 8-EMA-only fixture is exactly the case v5 removed: the lab's v4 fires
    on it, the lab's v5 and the port do not."""
    db = SY.eight_ema_only(U.series)
    tb = SY.as_tuples(db)
    i = len(db) - 1
    lab.reset()
    x = lab.mod.pullback_ma_v4_features(tb, i)
    assert x is not None and lab.mod.v4_decide(x[0], x[1], None, lab.k3, **lab.k4) is not None
    assert lab.v5(tb, i) is None and PB.evaluate(db, U.series(db), i) is None
    fire = SY.fire_e21(U.series)
    lab.reset()
    assert lab.v5(SY.as_tuples(fire), len(fire) - 1) is not None


def test_detector_parity_on_synthetic_last_session(lab):
    for db in [SY.fire_e21(U.series), SY.pullback_to_ma(U.series, ma="s50"),
               SY.eight_ema_only(U.series), SY.falling_e21(U.series)]:
        lab.reset()
        tb = SY.as_tuples(db)
        i = len(db) - 1
        got = [d for d in PB.detect_uct_pullback_ma_v5(db, {})
               if d["geometry"]["extras"]["trigger_bars_ago"] == 0]
        assert bool(got) == (lab.v5(tb, i) is not None)


# ── mutation: the comparison must be able to fail ────────────────────────────

_MUTATIONS = [
    ("PB5_G2_ATR", 1.0), ("PB4_NEAR_ATR", 0.75), ("PB4_E21_N", 5), ("PB3_S200_TOL_ATR", 0.5),
    ("PB3_DIST_ATR", 0.5), ("PB_TAG_ABOVE_ATR", 0.4), ("PB_PULLED_ATR", 1.25),
    ("PB_S50_SLOPE_BARS", 5), ("PB4_MAX_AGO", 2), ("PB5_G2_MODE", "any"),
]


def _mismatches(lab, corpus):
    n = 0
    for db, sym in corpus:
        n += len(_rule_parity_over_series(lab, SY.as_tuples(db), db, sym=sym)[2])
    return n


@pytest.mark.parametrize("name,value", _MUTATIONS, ids=[m[0] for m in _MUTATIONS])
def test_a_mutated_threshold_is_caught(lab, monkeypatch, name, value):
    corpus = [(db, None) for db in _synthetic_corpus()]
    assert _mismatches(lab, corpus) == 0, "control: the unmutated port must agree"
    monkeypatch.setattr(PB, name, value)
    assert _mismatches(lab, corpus) > 0, f"mutating {name} -> {value} went unnoticed"


def test_a_mutated_exclusion_list_is_caught(lab, monkeypatch):
    corpus = [(SY.fire_e21(U.series), "TQQQ")]
    assert _mismatches(lab, corpus) == 0
    monkeypatch.setattr(PB, "PB4_EXCLUDE", frozenset())
    assert _mismatches(lab, corpus) > 0


def test_counting_the_8_ema_tag_is_caught(lab, monkeypatch):
    """The v5 change itself: a port that still let an 8-EMA-only tag through
    (simulated by relabelling the 8 EMA so the `!= 'e8'` filter misses it)."""
    db = SY.eight_ema_only(U.series)
    corpus = [(db, None)]
    assert _mismatches(lab, corpus) == 0
    real_series = U.series

    def relabelled(bars):
        S = dict(real_series(bars))
        S["e8x"] = S["e8"]
        return S
    monkeypatch.setattr(PB, "PB_MAS", ("e8x", "e21", "s50", "s200"))
    monkeypatch.setattr(PB.U, "series", relabelled)
    monkeypatch.setattr(U, "series", relabelled)
    assert _mismatches(lab, corpus) > 0


# ── real bars (read-only) ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def real(lab):
    if not os.path.isfile(_BARS_DB):
        pytest.skip(f"{_BARS_DB} not present")
    bars = lab.mod.score.Bars()          # the lab's loader: mode=ro, same cleaning
    assert "mode=ro" in lab.mod.score.DB, "the lab loader must open bars.db read-only"
    (last,) = bars.c.execute("select max(ts) from ohlcv where tf='D'").fetchone()
    tickers = sorted(t for (t,) in bars.c.execute(
        "select distinct ticker from ohlcv where tf='D' and ts=?", (last,)))
    rnd = random.Random(20261017)
    rnd.shuffle(tickers)
    yield bars, [t for t in tickers if t not in PB.PB4_EXCLUDE], sorted(
        t for t in tickers if t in PB.PB4_EXCLUDE)
    bars.c.close()


def test_rule_parity_on_real_full_histories(lab, real):
    """Every session of 40 real histories, ticker passed through."""
    bars, tickers, _ = real
    total = fires = used = 0
    errs = []
    for t in tickers[_REAL_N:]:
        if used >= _REAL_HIST:
            break
        b = bars.get(t)
        if len(b) < PB._MIN_BARS + 20:
            continue
        used += 1
        n, f, e = _rule_parity_over_series(lab, list(b), lab.mod.to_dict_bars(b), sym=t)
        total += n
        fires += f
        errs += [f"{t}: {x}" for x in e]
    print(f"\nreal rule parity: {total} sessions over {used} histories, fires={fires}, "
          f"mismatches={len(errs)}")
    assert used == _REAL_HIST
    assert fires > 0, "no fire in the real sample: the comparison saw one branch only"
    assert errs == [], errs[:10]


def test_rule_parity_on_real_excluded_funds(lab, real):
    """The excluded-fund branch on real leveraged / commodity funds: with the
    ticker both sides are silent; without it both sides agree and do fire."""
    bars, _, excluded = real
    if len(excluded) < 3:
        pytest.skip("fewer than 3 excluded funds in bars.db")
    total = fires_without = 0
    errs = []
    for t in excluded[:12]:
        b = bars.get(t)
        if len(b) < PB._MIN_BARS + 20:
            continue
        db, tb = lab.mod.to_dict_bars(b), list(b)
        n, f, e = _rule_parity_over_series(lab, tb, db, sym=t)
        assert f == 0, f"{t} fired while excluded"
        total += n
        errs += [f"{t}: {x}" for x in e]
        n2, f2, e2 = _rule_parity_over_series(lab, tb, db, sym=None)
        fires_without += f2
        errs += [f"{t} (no sym): {x}" for x in e2]
    print(f"\nreal excluded-fund parity: {total} sessions, fires without the ticker="
          f"{fires_without}, mismatches={len(errs)}")
    assert fires_without > 0, "the exclusion was never the deciding guard"
    assert errs == [], errs[:10]


def test_detector_parity_on_200_real_ticker_days(lab, real):
    bars, tickers, _ = real
    rnd = random.Random(17)
    n = liq_out = lab_fires = 0
    errs = []
    for t in tickers:
        if n >= _REAL_N:
            break
        b = bars.get(t)
        if len(b) < PB._MIN_BARS + 30:
            continue
        i = rnd.randrange(PB._MIN_BARS + 10, len(b))
        tb = list(b[:i + 1])
        db = lab.mod.to_dict_bars(tb)
        lab.reset()
        lab_fired = lab.v5(tb, i, t) is not None
        lab_fires += lab_fired
        e = _cmp(lab, tb, db, U.series(db), i, t)
        dets = PB.detect_uct_pullback_ma_v5(db, {"sym": t})
        if not liquidity_floor(db).passes:
            liq_out += 1
            if dets:
                e = e or f"{t}@{tb[-1][0]}: fired through a failing liquidity floor"
        else:
            got = any(d["geometry"]["extras"]["trigger_bars_ago"] == 0 for d in dets)
            if got != lab_fired:
                e = e or f"{t}@{tb[-1][0]}: detector={got} lab={lab_fired}"
        if e:
            errs.append(f"{t}: {e}")
        n += 1
    print(f"\nreal detector parity: n={n} ticker-days, mismatches={len(errs)}, "
          f"lab fires={lab_fires}, liquidity-floored={liq_out}")
    assert n == _REAL_N, f"only {n} usable ticker-days"
    assert errs == [], errs[:10]
