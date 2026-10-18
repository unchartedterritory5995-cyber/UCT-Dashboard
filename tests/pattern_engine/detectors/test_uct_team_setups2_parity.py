"""PARITY: uct_flag_htf (with its guard) and uct_ma_reclaim against the offline lab rules.

Both detectors are ports of the lab's team-setup recognition rules
(`team_rules.py`: feats_/decide_flag_htf and feats_/decide_ma_reclaim) at the
grid points frozen in the lab's out_recall_v2/tune_<setup>.json; the flag rule
also carries the lab's shared guard (`team_rules_r2.guard`, version 1, G1 | G2).
This file runs the lab code itself (imported by path) beside the dashboard
code over the same bars and asserts identical fire / no-fire and identical
facts. The lab lives outside this repo, so the file SKIPS when it is absent.

  * lab path: env `UCT_LAB_TEAM_RULES_R2`, default `team_rules_r2.py` beside the
    recall-v2 lab file test_uct_recall_v2_parity.py already locates; it imports
    `team_rules.py` from its own directory
  * real bars: the lab's own read-only loader (bars.db opened `mode=ro`), when
    the database exists; the real-data half skips otherwise.

Levels:
  FROZEN     the port's constants equal the lab's frozen grid point and [P] values.
  RULE       dashboard rule vs the lab rule at every session of a fixed synthetic
             corpus (named fixtures + seeded regime walks): the unguarded flag
             rule, the guard (decision AND reasons), the guarded flag rule, and
             the MA reclaim rule, each with its facts.
  DETECTOR   the registered detector run on bars[:i+1] (it cannot see the future)
             fires with trigger_bars_ago == 0 exactly when the lab rule fires at i,
             at every session of the fixed fixtures: lab-vs-app with no lookahead.
  LOOKAHEAD  the rule at i on the full series equals the rule on bars[:i+1].
  MUTATION   each frozen threshold nudged must produce a mismatch.
  REAL       every session of real histories (skips without bars.db).
  WINDOW     the scan's declared slice reproduces the lab's full-history answer.
"""
import importlib.util
import json
import logging
import os
import random
import sys

import pytest

from api.services.pattern_engine.detectors.uct import uct_flag_htf as FL
from api.services.pattern_engine.detectors.uct import uct_ma_reclaim as MR
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor
from tests.pattern_engine.detectors import _team_setups2_synth as SY
from tests.pattern_engine.detectors.test_uct_recall_v2_parity import _LAB as _RECALL_V2_LAB

_LAB = os.environ.get("UCT_LAB_TEAM_RULES_R2") or os.path.join(
    os.path.dirname(_RECALL_V2_LAB), "team_rules_r2.py")
_TUNE_DIR = os.path.join(os.path.dirname(_LAB), "out_recall_v2")
_BARS_DB = "C:/data/bars.db"   # the lab loader's own hard-coded read-only path
_REAL_HIST = 30
_N_WALKS = 40


def _load_lab():
    """Import team_rules_r2.py by path WITHOUT leaking its side effects: it (and
    the team_rules / recall_v2 modules it imports) prepend lab directories, one
    carrying its own `api` package, to sys.path and disable logging, both
    process-wide. Returns the r2 module; its `T` is the team_rules it imported."""
    if not os.path.isfile(_LAB):
        return None
    saved_path = list(sys.path)
    saved_disable = logging.root.manager.disable
    had = {m: m in sys.modules for m in ("score", "recall_v2", "team_rules")}
    try:
        spec = importlib.util.spec_from_file_location("uct_lab_team_rules_r2", _LAB)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception as e:  # a lab that cannot import is "absent", never a pass
        pytest.skip(f"lab team_rules_r2.py did not import: {e!r}")
    finally:
        sys.path[:] = saved_path
        logging.disable(saved_disable)
        for m, was in had.items():
            if not was:
                sys.modules.pop(m, None)
    return mod


def _frozen(setup):
    path = os.path.join(_TUNE_DIR, f"tune_{setup}.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)["chosen"]["p"]
    except Exception as e:  # frozen params missing = the lab is incomplete
        pytest.skip(f"lab frozen params unreadable ({path}): {e!r}")


class _Lab:
    def __init__(self, mod):
        self.r2 = mod
        self.mod = mod.T
        self.p_fl = _frozen("flag_htf")
        self.p_mr = _frozen("ma_reclaim")

    def reset(self):
        self.mod.R._SC.clear()   # its series cache keys on id(); a recycled id must not hit

    def flag_raw(self, tb, i):
        return self.mod.rule("flag_htf", tb, i, self.p_fl)

    def guard(self, tb, i):
        return self.r2.guard(tb, i)

    def flag(self, tb, i):
        """The confirmed rule: round-1 flag_htf AND NOT the guard (team_setups_r3.guarded_rule)."""
        x = self.flag_raw(tb, i)
        return None if x is None or self.guard(tb, i)[0] else x

    def reclaim(self, tb, i):
        return self.mod.rule("ma_reclaim", tb, i, self.p_mr)


@pytest.fixture(scope="module")
def lab():
    mod = _load_lab()
    if mod is None:
        pytest.skip(f"lab rules not present at {_LAB}")
    return _Lab(mod)


def _cmp(lab, tb, db, S, i, counts=None):
    """All four comparisons at session i. Returns a list of mismatch strings."""
    errs = []
    x, y = lab.flag_raw(tb, i), FL.evaluate_unguarded(db, S, i)
    if (x is None) != (y is None):
        errs.append(f"flag fire mismatch at i={i}: lab={x and x['variant']} dash={y and y['variant']}")
    elif x is not None and x != y:
        errs.append(f"flag facts mismatch at i={i}: lab={x} dash={y}")
    # The guard is only ever consulted after the flag rule's warm-up (i >= 65);
    # below that the lab's own guard slices with a negative start and can raise,
    # so it is compared from the warm-up on, where every guarded answer lives.
    g_lab = lab.guard(tb, i) if i >= FL._WARMUP else (False, [])
    g_app = FL.guard(db, S, i) if i >= FL._WARMUP else (False, [])
    if (bool(g_lab[0]), list(g_lab[1])) != (bool(g_app[0]), list(g_app[1])):
        errs.append(f"guard mismatch at i={i}: lab={g_lab} dash={g_app}")
    x, y = lab.flag(tb, i), FL.evaluate(db, S, i)
    if (x is None) != (y is None):
        errs.append(f"guarded flag fire mismatch at i={i}: lab={x and x['variant']} dash={y and y['variant']}")
    elif x is not None and x != FL.lab_facts(y):
        errs.append(f"guarded flag facts mismatch at i={i}")
    x, y = lab.reclaim(tb, i), MR.evaluate(db, S, i)
    if (x is None) != (y is None):
        errs.append(f"ma_reclaim fire mismatch at i={i}: lab={x and x['variant']} dash={y and y['variant']}")
    elif x is not None and x != MR.lab_facts(y):
        errs.append(f"ma_reclaim facts mismatch at i={i}: lab={x} dash={MR.lab_facts(y)}")
    if counts is not None:
        counts["flag_raw"] += FL.evaluate_unguarded(db, S, i) is not None
        counts["flag"] += FL.evaluate(db, S, i) is not None
        counts["suppressed"] += (FL.evaluate_unguarded(db, S, i) is not None
                                 and FL.evaluate(db, S, i) is None)
        counts["g1"] += "falling200" in g_app[1]
        counts["g2"] += "pinned" in g_app[1]
        r = MR.evaluate(db, S, i)
        counts["reclaim"] += r is not None
        counts["reclaim_s200"] += r is not None and r["variant"] == "reclaim_s200"
    return errs


def _new_counts():
    return {"n": 0, "flag_raw": 0, "flag": 0, "suppressed": 0, "g1": 0, "g2": 0, "reclaim": 0, "reclaim_s200": 0}


def _rule_parity(lab, db, counts=None, start=0):
    """Compare every rule at every session of one series. Returns the mismatch list."""
    lab.reset()
    tb = SY.as_tuples(db)
    S = U.series(db)
    errs = []
    for i in range(start, len(db)):
        if counts is not None:
            counts["n"] += 1
        errs += _cmp(lab, tb, db, S, i, counts)
    return errs


def _named_fixtures():
    return {"flag_forming": SY.flag(), "flag_forming_htf": SY.flag(pole_gain=1.2),
            "flag_breakout": SY.flag(last="breakout"),
            "flag_deep": SY.flag(depth=0.85), "flag_small_pole": SY.flag(pole_gain=0.20),
            "flag_falling_200": SY.flag(falling_base=True), "flag_pinned": SY.flag_pinned(),
            "reclaim_s50": SY.ma_reclaim(), "reclaim_extended": SY.ma_reclaim(last="extended"),
            "reclaim_two_below": SY.ma_reclaim(under=2), "reclaim_none": SY.ma_reclaim(last="none")}


def _synthetic_corpus():
    return list(_named_fixtures().values()) + [SY.regime_walk(seed=s) for s in range(_N_WALKS)]


# ── frozen constants ─────────────────────────────────────────────────────────

def test_the_ports_constants_are_the_labs_frozen_grid_points(lab):
    assert lab.p_fl == {"gain": FL.FL_GAIN, "depth": FL.FL_DEPTH, "e21tol": FL.FL_E21_TOL,
                        "tight": FL.FL_TIGHT, "near": FL.FL_NEAR_ATR}
    assert lab.p_mr == {"within": MR.MR_WITHIN, "below": MR.MR_BELOW, "press": MR.MR_PRESS,
                        "vol": MR.MR_VOL}
    m, r2 = lab.mod, lab.r2
    assert (m.FL_MAXLEN, m.FL_POLE, m.FL_HTF) == (FL.FL_MAXLEN, FL.FL_POLE, FL.FL_HTF)
    assert (m.MR_PRIOR, tuple(m.MR_MAS)) == (MR.MR_PRIOR, MR.MR_MAS)
    # the guard exactly as rounds 3 and 4 ran it (version 1, not the DEV-only v2)
    assert (r2.S200_SLOPE, r2.GAP_MIN, r2.GAP_LOOK, r2.PIN_N, r2.PIN_PCT) == (
        FL.G1_SLOPE, FL.G2_GAP, FL.G2_LOOK, FL.G2_PIN_N, FL.G2_PIN_PCT)
    # the grid points the lab chose are inside the grids it pre-registered
    for k, v in lab.p_fl.items():
        assert v in m.FLAG_GRID[k], (k, v)
    for k, v in lab.p_mr.items():
        assert v in m.MR_GRID[k], (k, v)


# ── the fixed synthetic fixture: lab vs app ──────────────────────────────────

_EXPECT = {
    # name: (unguarded flag, guard fires, guarded flag, ma_reclaim) at the last session
    "flag_forming": ("forming", False, "forming", None),
    "flag_forming_htf": ("forming_htf", False, "forming_htf", None),
    "flag_breakout": ("breakout", False, "breakout", None),
    "flag_deep": (None, False, None, None),
    "flag_small_pole": (None, False, None, None),
    "flag_falling_200": ("forming", True, None, None),
    "flag_pinned": ("forming", True, None, None),
    "reclaim_s50": (None, False, None, "reclaim_s50"),
    "reclaim_extended": (None, False, None, None),
    "reclaim_two_below": (None, False, None, None),
    "reclaim_none": (None, False, None, None),
}


@pytest.mark.parametrize("name", sorted(_EXPECT))
def test_the_named_fixtures_answer_as_the_lab_does(lab, name):
    """The fixed fixture's last session, both sides, by name (non-vacuous: the
    expected answers include fires and silences of every rule, and a guard that
    suppresses a fire through each of its two clauses)."""
    db = _named_fixtures()[name]
    lab.reset()
    tb, S, i = SY.as_tuples(db), U.series(db), len(db) - 1
    v = lambda r: (r or {}).get("variant")
    got_lab = (v(lab.flag_raw(tb, i)), bool(lab.guard(tb, i)[0]), v(lab.flag(tb, i)), v(lab.reclaim(tb, i)))
    got_app = (v(FL.evaluate_unguarded(db, S, i)), bool(FL.guard(db, S, i)[0]), v(FL.evaluate(db, S, i)),
               v(MR.evaluate(db, S, i)))
    assert got_lab == _EXPECT[name], ("lab", got_lab)
    assert got_app == _EXPECT[name], ("app", got_app)


def test_rule_parity_on_the_synthetic_corpus(lab):
    counts = _new_counts()
    errs = []
    for db in _synthetic_corpus():
        errs += _rule_parity(lab, db, counts)
    print(f"\nsynthetic rule parity: {counts}, mismatches={len(errs)}")
    assert counts["flag"] >= 30 and counts["reclaim"] >= 30 and counts["reclaim_s200"] >= 5, counts
    assert counts["suppressed"] >= 5 and counts["g1"] >= 50 and counts["g2"] >= 5, counts
    assert counts["n"] - counts["flag_raw"] - counts["reclaim"] >= 5000, counts
    assert errs == [], errs[:10]


def _detector_fires_now(detect, head):
    return any(d["geometry"]["extras"]["trigger_bars_ago"] == 0 for d in detect(head, {}))


@pytest.mark.parametrize("name", sorted(_EXPECT) + ["walk0", "walk1", "walk2"])
def test_the_detector_reproduces_the_lab_fires_with_no_lookahead(lab, name):
    """At every session i of a fixed fixture, the REGISTERED detector is handed
    only bars[:i+1] and must fire (trigger_bars_ago == 0) exactly when the lab
    rule, given the same history, fires at i. The flag detector additionally
    refuses a history too short for the guard's G1 (FL._MIN_BARS)."""
    db = _named_fixtures()[name] if not name.startswith("walk") else SY.regime_walk(seed=int(name[4:]))
    tb = SY.as_tuples(db)
    errs = []
    seen = {"fl": 0, "mr": 0}
    for i in range(65, len(db)):
        head, thead = db[:i + 1], tb[:i + 1]
        lab.reset()
        liquid = liquidity_floor(head).passes
        for key, labfn, detect, floor in (("fl", lab.flag, FL.detect_uct_flag_htf, FL._MIN_BARS),
                                          ("mr", lab.reclaim, MR.detect_uct_ma_reclaim, MR._MIN_BARS)):
            want = labfn(thead, i) is not None and liquid and len(head) >= floor
            got = _detector_fires_now(detect, head)
            seen[key] += want
            if got != want:
                errs.append(f"{name} {key} i={i}: detector={got} lab={want}")
    assert errs == [], errs[:10]
    if name.startswith("walk"):
        assert seen["fl"] + seen["mr"] > 0, seen


# ── lookahead ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(4))
def test_no_lookahead_rule_at_i_equals_rule_on_bars_through_i(seed):
    bars = SY.regime_walk(seed=seed)
    S_full = U.series(bars)
    fired = 0
    for i in range(len(bars)):
        head = bars[:i + 1]
        S_head = U.series(head)
        a, b = FL.evaluate(bars, S_full, i), FL.evaluate(head, S_head, i)
        assert a == b, ("flag", i)
        assert FL.guard(bars, S_full, i) == FL.guard(head, S_head, i), ("guard", i)
        c, d = MR.evaluate(bars, S_full, i), MR.evaluate(head, S_head, i)
        assert c == d, ("ma_reclaim", i)
        fired += (a is not None) + (c is not None)
    assert fired > 0, "the sweep must see fires to mean anything"


def test_future_bars_cannot_change_the_newest_answer():
    for db, mod in ((SY.flag(), FL), (SY.flag(last="breakout"), FL), (SY.ma_reclaim(), MR)):
        i = len(db) - 1
        before = mod.evaluate(db, U.series(db), i)
        assert before is not None
        junk = db + [SY.bar(i + 1 + k, 1, 1000, 0.5, 2, 1) for k in range(5)]
        assert mod.evaluate(junk, U.series(junk), i) == before


# ── mutation: the comparison must be able to fail ────────────────────────────

_MUTATIONS = [
    # flag_htf: the frozen grid point
    (FL, "FL_GAIN", 0.25), (FL, "FL_DEPTH", 0.50), (FL, "FL_E21_TOL", 0.5), (FL, "FL_TIGHT", 2.5),
    (FL, "FL_NEAR_ATR", 0.5),
    # flag_htf: the lab's fixed [P] values
    (FL, "FL_MAXLEN", 20), (FL, "FL_MIN_LEN", 3), (FL, "FL_POLE", 30), (FL, "FL_HTF", 0.80),
    (FL, "FL_E21_SLOPE", 3), (FL, "FL_RANGE", 8), (FL, "FL_TIGHT_N", 3), (FL, "FL_EXT_ATR", 1.0),
    # the guard (version 1)
    (FL, "G1_SLOPE", 10), (FL, "G2_GAP", 0.20), (FL, "G2_LOOK", 20), (FL, "G2_PIN_N", 5),
    (FL, "G2_PIN_PCT", 0.06),
    # ma_reclaim: the frozen grid point
    (MR, "MR_WITHIN", 1), (MR, "MR_BELOW", 5), (MR, "MR_PRESS", 0.5), (MR, "MR_VOL", 1.0),
    # ma_reclaim: the lab's fixed [P] values
    (MR, "MR_PRIOR", 10), (MR, "MR_LOOKBACK", 2), (MR, "MR_EXT_ATR", 1.0), (MR, "MR_MAS", ("s50",)),
]


#: Walk seeds whose sessions include a flag that closes a hair UNDER the 21 EMA
#: (0 > c_e21 >= -0.5 ATR) with every other condition met. Found by sweeping
#: seeds 0-299 for a session whose answer moves with FL_E21_TOL; without them no
#: corpus series can tell the frozen 0-ATR tolerance from a looser one.
_TOLERANCE_SEEDS = (47, 222)


def _mismatches(lab, corpus):
    return sum(len(_rule_parity(lab, db)) for db in corpus)


@pytest.mark.parametrize("mod,name,value", _MUTATIONS,
                         ids=[f"{m.__name__.rsplit('.', 1)[-1]}.{n}" for m, n, _ in _MUTATIONS])
def test_a_mutated_threshold_is_caught(lab, monkeypatch, mod, name, value):
    corpus = [SY.regime_walk(seed=s) for s in (*range(12), *_TOLERANCE_SEEDS)] + list(_named_fixtures().values())
    assert _mismatches(lab, corpus) == 0, "control: the unmutated port must agree"
    monkeypatch.setattr(mod, name, value)
    assert _mismatches(lab, corpus) > 0, f"mutating {name} -> {value} went unnoticed"


# ── real bars (read-only) ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def real(lab):
    if not os.path.isfile(_BARS_DB):
        pytest.skip(f"{_BARS_DB} not present")
    score = lab.mod.R.score
    bars = score.Bars()                  # the lab's loader: mode=ro, same cleaning
    assert "mode=ro" in score.DB, "the lab loader must open bars.db read-only"
    (last,) = bars.c.execute("select max(ts) from ohlcv where tf='D'").fetchone()
    tickers = sorted(t for (t,) in bars.c.execute(
        "select distinct ticker from ohlcv where tf='D' and ts=?", (last,)))
    random.Random(4417).shuffle(tickers)
    yield bars, tickers
    bars.c.close()


def test_rule_parity_on_real_full_histories(lab, real):
    """Every session of real histories."""
    bars, tickers = real
    counts = _new_counts()
    used = 0
    errs = []
    for t in tickers:
        if used >= _REAL_HIST:
            break
        b = bars.get(t)
        if len(b) < MR.MIN_BARS + 40:
            continue
        used += 1
        db = lab.mod.R.to_dict_bars(b)
        errs += [f"{t}: {e}" for e in _rule_parity(lab, db, counts)]
    print(f"\nreal rule parity over {used} histories: {counts}, mismatches={len(errs)}")
    assert used == _REAL_HIST
    assert counts["flag"] > 0 and counts["reclaim_s200"] > 0 and counts["g1"] > 0, \
        "no fire in the real sample: the comparison saw one branch only"
    assert errs == [], errs[:10]


def test_the_scan_window_reproduces_the_full_history_answer(lab, real):
    """The daily scan hands each detector its declared slice (FL.MIN_BARS = 222,
    MR.MIN_BARS = 225). At the newest session of the slice AND at the two prior
    sessions the wrapper may report, the slice must answer as the lab does on the
    ticker's full history. ma_reclaim's inputs are all windowed (SMA, ATR), so
    that must hold EXACTLY. The flag rule reads the 21 EMA, which the slice seeds
    at its first bar; the residual disagreement is measured and must stay
    negligible (the guard's 200 SMA and gap look-back are windowed and exact)."""
    bars, tickers = real
    rnd = random.Random(7)
    n = fl_diff = mr_diff = g_diff = fl_fires = mr_fires = suppressed = 0
    for t in tickers[:300]:
        b = bars.get(t)
        if len(b) < 400:
            continue
        tb = list(b)
        db = lab.mod.R.to_dict_bars(tb)
        lab.reset()
        for _ in range(5):
            i = rnd.randrange(300, len(db))
            for mod, full_fn in ((FL, lab.flag), (MR, lab.reclaim)):
                w = db[i + 1 - mod.MIN_BARS:i + 1]
                S = U.series(w)
                for off in range(U.MAX_TRIGGER_AGE):
                    j, wj = i - off, len(w) - 1 - off
                    full = full_fn(tb, j)
                    got = mod.evaluate(w, S, wj)
                    if mod is FL:
                        n += 1
                        fl_fires += full is not None
                        fl_diff += (full is None) != (got is None)
                        g_diff += bool(lab.guard(tb, j)[0]) != bool(FL.guard(w, S, wj)[0])
                        suppressed += lab.flag_raw(tb, j) is not None and full is None
                    else:
                        mr_fires += full is not None
                        mr_diff += (full is None) != (got is None)
    print(f"\nscan-window parity: n={n} ticker-days per rule, flag fires={fl_fires} "
          f"(guard-suppressed {suppressed}), ma_reclaim fires={mr_fires}; disagreements "
          f"flag={fl_diff} guard={g_diff} ma_reclaim={mr_diff}")
    assert n >= 1500
    assert fl_fires > 0 and mr_fires > 0
    assert mr_diff == 0 and g_diff == 0
    assert fl_diff <= max(1, n // 1000), fl_diff
