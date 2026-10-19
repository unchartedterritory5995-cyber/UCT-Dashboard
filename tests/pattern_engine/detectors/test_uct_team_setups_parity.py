"""PARITY: uct_inside_day and uct_flat_top_breakout against the offline lab rules.

Both detectors are ports of the lab's team-setup recognition rules
(`team_rules.py`: feats_/decide_inside_day and feats_/decide_flat_top_breakout)
at the grid points frozen in the lab's out_recall_v2/tune_<setup>.json. This
file runs the lab code itself (imported by path) beside the dashboard code over
the same bars and asserts identical fire / no-fire and identical facts. The lab
lives outside this repo, so the file SKIPS when it is absent.

  * lab path: env `UCT_LAB_TEAM_RULES`, default `team_rules.py` beside the
    recall-v2 lab file test_uct_recall_v2_parity.py already locates
  * real bars: the lab's own read-only loader (bars.db opened `mode=ro`), when
    the database exists; the real-data half skips otherwise.

Levels:
  FROZEN     the port's constants equal the lab's frozen grid point and [P] values.
  RULE       dashboard `evaluate(...)` vs the lab `rule(...)` at every session of a
             fixed synthetic corpus (named fixtures + seeded random walks).
  DETECTOR   the registered detector run on bars[:i+1] (it cannot see the future)
             fires with trigger_bars_ago == 0 exactly when the lab rule fires at i,
             at every session of the fixed fixtures: lab-vs-app with no lookahead.
  LOOKAHEAD  the rule at i on the full series equals the rule on bars[:i+1].
  MUTATION   each frozen threshold nudged must produce a mismatch.
  REAL       every session of real histories (skips without bars.db).
"""
import importlib.util
import json
import logging
import os
import random
import sys

import pytest

from api.services.pattern_engine.detectors.uct import uct_flat_top_breakout as FT
from api.services.pattern_engine.detectors.uct import uct_inside_day as ID
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor
from tests.pattern_engine.detectors import _team_setups_synth as SY
from tests.pattern_engine.detectors.test_uct_recall_v2_parity import _LAB as _RECALL_V2_LAB

_LAB = os.environ.get("UCT_LAB_TEAM_RULES") or os.path.join(
    os.path.dirname(_RECALL_V2_LAB), "team_rules.py")
_TUNE_DIR = os.path.join(os.path.dirname(_LAB), "out_recall_v2")
_BARS_DB = "C:/data/bars.db"   # the lab loader's own hard-coded read-only path
_REAL_HIST = 30
_N_WALKS = 40


def _load_lab():
    """Import team_rules.py by path WITHOUT leaking its side effects: it (and
    the recall_v2 module it imports) prepend lab directories, one carrying its
    own `api` package, to sys.path and disable logging, both process-wide."""
    if not os.path.isfile(_LAB):
        return None
    saved_path = list(sys.path)
    saved_disable = logging.root.manager.disable
    had = {m: m in sys.modules for m in ("score", "recall_v2")}
    try:
        spec = importlib.util.spec_from_file_location("uct_lab_team_rules", _LAB)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception as e:  # a lab that cannot import is "absent", never a pass
        pytest.skip(f"lab team_rules.py did not import: {e!r}")
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
        self.mod = mod
        self.p_id = _frozen("inside_day")
        self.p_ft = _frozen("flat_top_breakout")

    def reset(self):
        self.mod.R._SC.clear()   # its series cache keys on id(); a recycled id must not hit

    def inside(self, tb, i):
        return self.mod.rule("inside_day", tb, i, self.p_id)

    def flat(self, tb, i):
        return self.mod.rule("flat_top_breakout", tb, i, self.p_ft)


@pytest.fixture(scope="module")
def lab():
    mod = _load_lab()
    if mod is None:
        pytest.skip(f"lab rules not present at {_LAB}")
    return _Lab(mod)


def _flat_lab_shape(lab, x):
    """The lab's result reduced to the frozen L / tol, in the port's lab_facts shape."""
    f = x["facts"]
    row = f[str(lab.p_ft["L"])]
    return {"variant": x["variant"], "s50_gt_s200": f["s50_gt_s200"], "depth": row["depth"],
            "touch": tuple(row["touch"][str(lab.p_ft["tol"])]), "pos": row["pos"]}


def _cmp(lab, tb, db, S, i):
    """Both rules at session i. Returns a list of mismatch strings."""
    errs = []
    x, y = lab.inside(tb, i), ID.evaluate(db, S, i)
    if (x is None) != (y is None):
        errs.append(f"inside_day fire mismatch at i={i}: lab={x and x['variant']} dash={y and y['variant']}")
    elif x is not None and x != ID.lab_facts(y):
        errs.append(f"inside_day facts mismatch at i={i}: lab={x} dash={ID.lab_facts(y)}")
    x, y = lab.flat(tb, i), FT.evaluate(db, S, i)
    if (x is None) != (y is None):
        errs.append(f"flat_top fire mismatch at i={i}: lab={x and x['variant']} dash={y and y['variant']}")
    elif x is not None and _flat_lab_shape(lab, x) != FT.lab_facts(y):
        errs.append(f"flat_top facts mismatch at i={i}: lab={_flat_lab_shape(lab, x)} dash={FT.lab_facts(y)}")
    return errs


def _rule_parity(lab, db, start=0):
    """Compare both rules at every session of one series. Returns (n, id_fires, ft_fires, errs)."""
    lab.reset()
    tb = SY.as_tuples(db)
    S = U.series(db)
    n = fid = fft = 0
    errs = []
    for i in range(start, len(db)):
        n += 1
        errs += _cmp(lab, tb, db, S, i)
        fid += ID.evaluate(db, S, i) is not None
        fft += FT.evaluate(db, S, i) is not None
    return n, fid, fft, errs


def _named_fixtures():
    return {"inside_day": SY.inside_day(), "outside_last": SY.outside_last(),
            "inside_downtrend": SY.inside_downtrend(), "flat_at_line": SY.flat_top(),
            "flat_breakout": SY.flat_top(last="breakout"), "flat_deep": SY.flat_top(last="deep")}


def _synthetic_corpus():
    return list(_named_fixtures().values()) + [SY.random_walk(seed=s) for s in range(_N_WALKS)]


# ── frozen constants ─────────────────────────────────────────────────────────

def test_the_ports_constants_are_the_labs_frozen_grid_points(lab):
    assert lab.p_id == {"which": ID.ID_WHICH, "trend": ID.ID_TREND, "tight": ID.ID_TIGHT_ATR}
    assert lab.p_ft == {"L": FT.FT_L, "tol": FT.FT_TOL_ATR, "depth": FT.FT_DEPTH,
                        "near": FT.FT_NEAR_ATR, "trend": FT.FT_TREND}
    m = lab.mod
    assert (m.FT_GAP, m.FT_MATURE) == (FT.FT_GAP, FT.FT_MATURE)
    assert FT.FT_L in m.FT_LENS and FT.FT_TOL_ATR in m.FLAT_GRID["tol"]
    # the grid points the lab chose are inside the grids it pre-registered
    for k, v in lab.p_id.items():
        assert v in m.ID_GRID[k], (k, v)
    for k, v in lab.p_ft.items():
        assert v in m.FLAT_GRID[k], (k, v)


# ── the fixed synthetic fixture: lab vs app ──────────────────────────────────

def test_the_named_fixtures_fire_as_the_lab_does(lab):
    """The fixed fixture's last session, both sides, by name (non-vacuous: the
    expected answers include fires and silences of both rules)."""
    expect = {"inside_day": ("inside", None), "outside_last": (None, None),
              "inside_downtrend": (None, None), "flat_at_line": (None, "at_line"),
              "flat_breakout": (None, "breakout"), "flat_deep": (None, None)}
    for name, db in _named_fixtures().items():
        lab.reset()
        tb, S, i = SY.as_tuples(db), U.series(db), len(db) - 1
        x_id, x_ft = lab.inside(tb, i), lab.flat(tb, i)
        assert ((x_id or {}).get("variant"), (x_ft or {}).get("variant")) == expect[name], name
        assert ((ID.evaluate(db, S, i) or {}).get("variant"),
                (FT.evaluate(db, S, i) or {}).get("variant")) == expect[name], name


def test_rule_parity_on_the_synthetic_corpus(lab):
    total = fid = fft = 0
    errs = []
    for db in _synthetic_corpus():
        n, a, b, e = _rule_parity(lab, db)
        total, fid, fft = total + n, fid + a, fft + b
        errs += e
    print(f"\nsynthetic rule parity: {total} sessions, inside_day fires={fid}, "
          f"flat_top fires={fft}, mismatches={len(errs)}")
    assert fid >= 50 and fft >= 50 and total - fid - fft >= 5000, (fid, fft, total)
    assert errs == [], errs[:10]


def _detector_fires_now(detect, head):
    return any(d["geometry"]["extras"]["trigger_bars_ago"] == 0 for d in detect(head, {}))


@pytest.mark.parametrize("name", sorted(_named_fixtures()) + ["walk0", "walk1", "walk2"])
def test_the_detector_reproduces_the_lab_fires_with_no_lookahead(lab, name):
    """At every session i of a fixed fixture, the REGISTERED detector is handed
    only bars[:i+1] and must fire (trigger_bars_ago == 0) exactly when the lab
    rule, given the same history, fires at i."""
    db = _named_fixtures()[name] if not name.startswith("walk") else SY.random_walk(seed=int(name[4:]))
    tb = SY.as_tuples(db)
    errs = []
    seen = {"id": 0, "ft": 0}
    for i in range(ID._MIN_IDX, len(db)):
        head, thead = db[:i + 1], tb[:i + 1]
        lab.reset()
        liquid = liquidity_floor(head).passes
        for key, labfn, detect in (("id", lab.inside, ID.detect_uct_inside_day),
                                   ("ft", lab.flat, FT.detect_uct_flat_top_breakout)):
            want = labfn(thead, i) is not None and liquid
            got = _detector_fires_now(detect, head)
            seen[key] += want
            if got != want:
                errs.append(f"{name} {key} i={i}: detector={got} lab={want}")
    assert errs == [], errs[:10]
    if name.startswith("walk"):
        assert seen["id"] > 0 and seen["ft"] > 0, seen


# ── lookahead ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(4))
def test_no_lookahead_rule_at_i_equals_rule_on_bars_through_i(seed):
    bars = SY.random_walk(seed=seed)
    S_full = U.series(bars)
    fired = 0
    for i in range(len(bars)):
        head = bars[:i + 1]
        S_head = U.series(head)
        a, b = ID.evaluate(bars, S_full, i), ID.evaluate(head, S_head, i)
        assert a == b, ("inside_day", i)
        c, d = FT.evaluate(bars, S_full, i), FT.evaluate(head, S_head, i)
        assert c == d, ("flat_top", i)
        fired += (a is not None) + (c is not None)
    assert fired > 0, "the sweep must see fires to mean anything"


def test_future_bars_cannot_change_the_newest_answer():
    for db, mod in ((SY.inside_day(), ID), (SY.flat_top(last="breakout"), FT)):
        i = len(db) - 1
        before = mod.evaluate(db, U.series(db), i)
        assert before is not None
        junk = db + [SY.bar(i + 1 + k, 1, 1000, 0.5, 2, 1) for k in range(5)]
        assert mod.evaluate(junk, U.series(junk), i) == before


# ── mutation: the comparison must be able to fail ────────────────────────────

_MUTATIONS = [
    (ID, "ID_TIGHT_ATR", 1.0), (ID, "ID_TREND", "c>s50"), (ID, "ID_WHICH", "i0|i1"),
    (FT, "FT_L", 25), (FT, "FT_TOL_ATR", 0.25), (FT, "FT_DEPTH", 0.15), (FT, "FT_NEAR_ATR", 0.5),
    (FT, "FT_TREND", "c>s50"), (FT, "FT_GAP", 1), (FT, "FT_MATURE", 5), (FT, "FT_EXT_ATR", 1.0),
]


def _mismatches(lab, corpus):
    return sum(len(_rule_parity(lab, db)[3]) for db in corpus)


@pytest.mark.parametrize("mod,name,value", _MUTATIONS, ids=[f"{m.__name__.rsplit('.', 1)[-1]}.{n}" for m, n, _ in _MUTATIONS])
def test_a_mutated_threshold_is_caught(lab, monkeypatch, mod, name, value):
    corpus = [SY.random_walk(seed=s) for s in range(12)] + list(_named_fixtures().values())
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
    total = fid = fft = used = 0
    errs = []
    for t in tickers:
        if used >= _REAL_HIST:
            break
        b = bars.get(t)
        if len(b) < FT._MIN_BARS + 40:
            continue
        used += 1
        db, tb = lab.mod.R.to_dict_bars(b), list(b)
        lab.reset()
        S = U.series(db)
        for i in range(len(db)):
            total += 1
            errs += [f"{t}: {e}" for e in _cmp(lab, tb, db, S, i)]
            fid += ID.evaluate(db, S, i) is not None
            fft += FT.evaluate(db, S, i) is not None
    print(f"\nreal rule parity: {total} sessions over {used} histories, inside_day fires={fid}, "
          f"flat_top fires={fft}, mismatches={len(errs)}")
    assert used == _REAL_HIST
    assert fid > 0 and fft > 0, "no fire in the real sample: the comparison saw one branch only"
    assert errs == [], errs[:10]


def test_the_scan_window_reproduces_the_full_history_answer(lab, real):
    """The daily scan hands inside_day the trailing 200 bars and flat_top its
    declared 202. flat_top's inputs are all windowed (SMA, ATR, extremes), so its
    answer on the window must equal the lab's on the full history EXACTLY. The
    inside-day stack reads EMAs seeded at the window's first bar; the residual
    disagreement is measured and must stay negligible."""
    bars, tickers = real
    rnd = random.Random(7)
    n = id_diff = ft_diff = id_fires = 0
    for t in tickers[:300]:
        b = bars.get(t)
        if len(b) < 400:
            continue
        tb = list(b)
        db = lab.mod.R.to_dict_bars(tb)
        lab.reset()
        for _ in range(5):
            i = rnd.randrange(300, len(db))
            n += 1
            full_id = lab.inside(tb, i)
            id_fires += full_id is not None
            w_id = db[i + 1 - 200:i + 1]
            got_id = ID.evaluate(w_id, U.series(w_id), len(w_id) - 1)
            id_diff += (full_id is None) != (got_id is None)
            w_ft = db[i + 1 - FT.MIN_BARS:i + 1]
            got_ft = FT.evaluate(w_ft, U.series(w_ft), len(w_ft) - 1)
            ft_diff += (lab.flat(tb, i) is None) != (got_ft is None)
    print(f"\nscan-window parity: n={n} ticker-days, inside_day fires={id_fires}, "
          f"inside_day window disagreements={id_diff}, flat_top window disagreements={ft_diff}")
    assert n >= 500
    assert ft_diff == 0
    assert id_diff <= max(1, n // 1000), id_diff
