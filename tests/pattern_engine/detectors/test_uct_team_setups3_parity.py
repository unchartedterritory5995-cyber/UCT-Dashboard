"""PARITY: uct_trendline_break against the offline lab rule trendline_break_v3.

trendline_break_v3 is the round-2 rule team_rules_r2.feats/decide_trendline_break_v2
frozen at its tuned grid point (out_recall_v2/tune_trendline_break_v2.json),
re-registered unchanged by team_rules_r5. Its line comes from the lab's learned
drawer, lab/auto_draw/drawer.py with out/drawer_model.json. The detector does
NOT read the app's display drawer; it carries a vendored, frozen copy. This file
runs the lab code itself (imported by path, drawer included) beside the
dashboard code over the same bars and asserts identical fire / no-fire and
identical facts. The lab lives outside this repo, so the file SKIPS when absent.

  * lab path: env `UCT_LAB_TEAM_RULES_R5`, default `team_rules_r5.py` beside the
    recall-v2 lab file test_uct_recall_v2_parity.py already locates; it imports
    team_rules / team_rules_r2 / recall_v2 from its own directory, and the
    drawer is loaded by path from `../auto_draw/drawer.py`
  * real bars: the lab's own read-only loader (bars.db opened `mode=ro`), when
    the database exists; the real-data half skips otherwise.

Levels:
  FROZEN     the port's constants equal the lab's frozen grid point and [P]
             values; the vendored drawer functions are the lab drawer's own
             functions (AST-identical, names prefixed) and the vendored weights
             are the lab model's trendline block.
  RULE       dashboard rule vs the lab rule at every session of a fixed synthetic
             corpus (named fixtures + seeded regime walks): the facts dict and
             the fire / no-fire.
  DETECTOR   the registered detector run on bars[:i+1] (it cannot see the
             future) fires with trigger_bars_ago == 0 exactly when the lab rule
             fires at i: lab-vs-app with no lookahead.
  LOOKAHEAD  the rule at i on the full series equals the rule on bars[:i+1].
  MUTATION   each frozen threshold nudged must produce a mismatch.
  REAL       every session of the recent past of real histories.
  WINDOW     the scan's base slice reproduces the lab's full-history answer.
"""
import ast
import datetime
import importlib.util
import inspect
import json
import logging
import os
import random
import sys

import pytest

from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.detectors.uct import uct_trendline_break as TB
from api.services.pattern_engine.primitives.liquidity import liquidity_floor
from tests.pattern_engine.detectors import _team_setups3_synth as SY
from tests.pattern_engine.detectors.test_uct_recall_v2_parity import _LAB as _RECALL_V2_LAB

_LAB = os.environ.get("UCT_LAB_TEAM_RULES_R5") or os.path.join(
    os.path.dirname(_RECALL_V2_LAB), "team_rules_r5.py")
_TUNE_DIR = os.path.join(os.path.dirname(_LAB), "out_recall_v2")
_DRAWER = os.path.join(os.path.dirname(os.path.dirname(_LAB)), "auto_draw", "drawer.py")
_BARS_DB = "C:/data/bars.db"   # the lab loader's own hard-coded read-only path
_SETUP = "trendline_break_v3"
_N_WALKS = 12
_WALK_N = 300
_REAL_HIST = 30
_REAL_RECENT = 120             # sessions compared per real history (newest ones); the drawer
                               # costs ~13 ms a session per side, and pytest.ini caps a test at 300 s

# The vendored names and the lab names they copy (the only edit the copy makes).
_RENAMES = {
    "as_arrays": "_dr_as_arrays", "atr": "_dr_atr", "strengths": "_dr_strengths",
    "t_candidates": "_dr_t_candidates", "score_rows": "_dr_score_rows", "nms_t": "_dr_nms_t",
    "TOUCH_ATR": "_DR_TOUCH_ATR", "MAX_STRENGTH": "_DR_MAX_STRENGTH",
    "TL_MIN_SPAN": "_DR_TL_MIN_SPAN", "TL_MAX_SPAN": "_DR_TL_MAX_SPAN",
}


def _load_by_path(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_lab():
    """Import team_rules_r5.py by path WITHOUT leaking its side effects: it (and
    the modules it imports) prepend lab directories, one carrying its own `api`
    package, to sys.path and disable logging, both process-wide. The drawer is
    loaded by path too and handed to team_rules, so its lazy loader never puts
    lab/auto_draw on sys.path. Returns (r5 module, drawer module)."""
    if not os.path.isfile(_LAB) or not os.path.isfile(_DRAWER):
        return None
    saved_path = list(sys.path)
    saved_disable = logging.root.manager.disable
    had = {m: m in sys.modules for m in ("score", "recall_v2", "team_rules", "team_rules_r2")}
    try:
        drawer = _load_by_path("uct_lab_auto_draw_drawer", _DRAWER)
        mod = _load_by_path("uct_lab_team_rules_r5", _LAB)
        mod.T._DR = drawer
    except Exception as e:  # a lab that cannot import is "absent", never a pass
        pytest.skip(f"lab team_rules_r5.py / drawer did not import: {e!r}")
    finally:
        sys.path[:] = saved_path
        logging.disable(saved_disable)
        for m, was in had.items():
            if not was:
                sys.modules.pop(m, None)
    return mod, drawer


class _Lab:
    def __init__(self, mod, drawer):
        self.r5 = mod
        self.mod = mod.T
        self.drawer = drawer
        path = os.path.join(_TUNE_DIR, "tune_trendline_break_v2.json")
        try:
            with open(path, encoding="utf-8") as f:
                self.p_tuned = json.load(f)["chosen"]["p"]
        except Exception as e:
            pytest.skip(f"lab frozen params unreadable ({path}): {e!r}")
        self.p = dict(mod.TLB3_P)

    def reset(self):
        self.mod.R._SC.clear()   # its series cache keys on id(); a recycled id must not hit

    def feats(self, tb, i):
        return self.mod.FEATS[_SETUP](tb, i)

    def rule(self, tb, i):
        return self.mod.rule(_SETUP, tb, i, self.p)


@pytest.fixture(scope="module")
def lab():
    got = _load_lab()
    if got is None:
        pytest.skip(f"lab rules not present at {_LAB} / {_DRAWER}")
    return _Lab(*got)


def _tmap(tb, db):
    return {d["t"]: t[0] for t, d in zip(tb, db)}


def _app_facts(f, tmap):
    if f is None:
        return None
    return {**f, "t1": tmap[f["t1"]], "t2": tmap[f["t2"]]}


def _cmp(lab, tb, db, S, i, tmap, counts=None):
    errs = []
    lf, af = lab.feats(tb, i), _app_facts(TB.features(db, S, i), tmap)
    if lf != af:
        errs.append(f"facts mismatch at i={i}: lab={lf} dash={af}")
    x, y = lab.rule(tb, i), TB.evaluate(db, S, i)
    if (x is None) != (y is None):
        errs.append(f"fire mismatch at i={i}: lab={x and x['variant']} dash={y and y['variant']}")
    elif x is not None and x != {"variant": y["variant"], "facts": _app_facts(y["facts"], tmap)}:
        errs.append(f"fired facts mismatch at i={i}")
    if counts is not None:
        counts["n"] += 1
        counts["line"] += lf is not None
        counts["fire"] += x is not None
        counts["below_s50"] += x is not None and not x["facts"]["c_gt_s50"]
        counts["cross_refused"] += (lf is not None and lf["cross0"] and lf["green"] and lf["gt_ph"]
                                    and x is None)
    return errs


def _new_counts():
    return {"n": 0, "line": 0, "fire": 0, "below_s50": 0, "cross_refused": 0}


def _rule_parity(lab, db, counts=None, start=0):
    lab.reset()
    tb = SY.as_tuples(db)
    S = U.series(db)
    tmap = _tmap(tb, db)
    errs = []
    for i in range(start, len(db)):
        errs += _cmp(lab, tb, db, S, i, tmap, counts)
    return errs


def _named_fixtures():
    return {"break": SY.trendline_break(), "red": SY.trendline_break(last="red"),
            "no_ph": SY.trendline_break(last="no_ph"), "extended": SY.trendline_break(last="extended"),
            "none": SY.trendline_break(last="none"), "rise": SY.trend(220, start=40.0, step=0.25, seed=3)}


def _synthetic_corpus():
    return list(_named_fixtures().values()) + [SY.regime_walk(n=_WALK_N, seed=s) for s in range(_N_WALKS)]


# ── frozen constants and the frozen drawer ───────────────────────────────────

def test_the_ports_constants_are_the_labs_frozen_grid_point(lab):
    assert lab.p == lab.p_tuned == {"first": TB.TLB_FIRST, "ext": TB.TLB_EXT, "trend": TB.TLB_TREND}
    for k, v in lab.p.items():
        assert v in lab.r5.T2.TLB2_GRID[k], (k, v)
    # trendline_break_v3 IS v2's rule, unchanged
    assert lab.mod.FEATS[_SETUP] is lab.r5.T2.feats_trendline_break_v2
    assert lab.mod.DECIDE[_SETUP] is lab.r5.T2.decide_trendline_break_v2
    # the drawer constants
    d = lab.drawer
    assert (d.TOUCH_ATR, d.MAX_STRENGTH, d.TL_MIN_SPAN, d.TL_MAX_SPAN) == (
        TB._DR_TOUCH_ATR, TB._DR_MAX_STRENGTH, TB._DR_TL_MIN_SPAN, TB._DR_TL_MAX_SPAN)
    # the lab calls t_candidates / nms_t with their defaults; the port passes them explicitly
    tc = inspect.signature(d.t_candidates).parameters
    assert (tc["lookback"].default, tc["min_strength"].default, tc["max_pivots"].default) == (
        TB.TL_LOOKBACK, TB.TL_MIN_STRENGTH, TB.TL_MAX_PIVOTS)
    assert inspect.signature(d.nms_t).parameters["sep"].default == TB.TL_NMS_SEP
    assert TB.TL_TOPK == 1
    assert TB._WARMUP == 65


def test_the_vendored_weights_are_the_lab_model(lab):
    m = lab.drawer.load_model(lab.drawer.MODEL_PATH)["trendline"]
    for k in ("features", "mean", "scale", "coef", "intercept"):
        assert TB._DR_TRENDLINE_MODEL[k] == m[k], k
    assert TB._DR_TRENDLINE_MODEL["features"] == lab.drawer.T_FEATURES


class _Rename(ast.NodeTransformer):
    def visit_Name(self, node):
        node.id = _RENAMES.get(node.id, node.id)
        return node

    def visit_FunctionDef(self, node):
        node.name = _RENAMES.get(node.name, node.name)
        self.generic_visit(node)
        return node


def _fn_ast(src, rename):
    fn = ast.parse(src).body[0]
    body = fn.body
    if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) \
            and isinstance(body[0].value.value, str):
        fn.body = body[1:]                     # docstrings are prose, not the rule
    if rename:
        fn = _Rename().visit(fn)
    return ast.dump(fn, include_attributes=False)


@pytest.mark.parametrize("lab_name", sorted(k for k in _RENAMES if k[0].islower()))
def test_each_vendored_drawer_function_is_the_lab_function(lab, lab_name):
    """AST identity, docstrings aside, after the name prefix: the vendored copy
    IS the lab drawer's code, so every literal inside it (the 0.1 ATR violation
    band, the ATR period, the clamps) is pinned to the lab too."""
    want = _fn_ast(inspect.getsource(getattr(lab.drawer, lab_name)), rename=True)
    got = _fn_ast(inspect.getsource(getattr(TB, _RENAMES[lab_name])), rename=False)
    assert got == want


def test_the_ast_identity_check_can_fail(lab):
    """Control: a one-literal change to a vendored function is seen."""
    src = inspect.getsource(TB._dr_t_candidates).replace("0.1 * at", "0.2 * at", 1)
    assert "0.2 * at" in src
    want = _fn_ast(inspect.getsource(lab.drawer.t_candidates), rename=True)
    assert _fn_ast(src, rename=False) != want


# ── the fixed synthetic fixture: lab vs app ──────────────────────────────────

_EXPECT = {"break": "break", "red": None, "no_ph": None, "extended": None, "none": None, "rise": None}


@pytest.mark.parametrize("name", sorted(_EXPECT))
def test_the_named_fixtures_answer_as_the_lab_does(lab, name):
    db = _named_fixtures()[name]
    lab.reset()
    tb, S, i = SY.as_tuples(db), U.series(db), len(db) - 1
    x, y = lab.rule(tb, i), TB.evaluate(db, S, i)
    assert (x and x["variant"]) == _EXPECT[name], ("lab", x)
    assert (y and y["variant"]) == _EXPECT[name], ("app", y)


def test_rule_parity_on_the_synthetic_corpus(lab):
    counts = _new_counts()
    errs = []
    for db in _synthetic_corpus():
        errs += _rule_parity(lab, db, counts)
    print(f"\nsynthetic rule parity: {counts}, mismatches={len(errs)}")
    assert counts["fire"] >= 30 and counts["below_s50"] >= 3 and counts["cross_refused"] >= 10, counts
    assert counts["line"] >= 2000 and counts["n"] - counts["fire"] >= 2000, counts
    assert errs == [], errs[:10]


def _detector_fires_now(head):
    return any(d["geometry"]["extras"]["trigger_bars_ago"] == 0
               for d in TB.detect_uct_trendline_break(head, {}))


@pytest.mark.parametrize("name", sorted(_EXPECT) + ["walk0", "walk1"])
def test_the_detector_reproduces_the_lab_fires_with_no_lookahead(lab, name):
    """At every session i, the REGISTERED detector is handed only bars[:i+1] and
    must fire (trigger_bars_ago == 0) exactly when the lab rule, given the same
    history, fires at i."""
    db = _named_fixtures()[name] if not name.startswith("walk") else SY.regime_walk(n=_WALK_N,
                                                                                    seed=int(name[4:]))
    tb = SY.as_tuples(db)
    errs, seen = [], 0
    start = 65 if not name.startswith("walk") else 65
    for i in range(start, len(db)):
        head, thead = db[:i + 1], tb[:i + 1]
        lab.reset()
        want = lab.rule(thead, i) is not None and liquidity_floor(head).passes
        got = _detector_fires_now(head)
        seen += want
        if got != want:
            errs.append(f"{name} i={i}: detector={got} lab={want}")
    assert errs == [], errs[:10]
    if name.startswith("walk") or name == "break":
        assert seen > 0


# ── lookahead ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(3))
def test_no_lookahead_rule_at_i_equals_rule_on_bars_through_i(seed):
    bars = SY.regime_walk(n=_WALK_N, seed=seed)
    S_full = U.series(bars)
    fired = 0
    for i in range(65, len(bars)):
        head = bars[:i + 1]
        S_head = U.series(head)
        assert TB.features(bars, S_full, i) == TB.features(head, S_head, i), ("features", i)
        a, b = TB.evaluate(bars, S_full, i), TB.evaluate(head, S_head, i)
        assert a == b, ("evaluate", i)
        fired += a is not None
    assert fired > 0, "the sweep must see fires to mean anything"


def test_future_bars_cannot_change_the_newest_answer():
    db = SY.trendline_break()
    i = len(db) - 1
    before = TB.evaluate(db, U.series(db), i)
    assert before is not None
    junk = db + [SY.bar(i + 1 + k, 1, 1000, 0.5, 2, 1) for k in range(5)]
    assert TB.evaluate(junk, U.series(junk), i) == before


# ── mutation: the comparison must be able to fail ────────────────────────────

_MUTATIONS = [
    # the frozen grid point
    ("TLB_FIRST", 3), ("TLB_FIRST", "anchor"), ("TLB_EXT", 1.0), ("TLB_TREND", "c>s50"),
    # the lab's shared warm-up
    ("_WARMUP", 150),
    # how the rule calls the drawer. TL_NMS_SEP and TL_TOPK are deliberately absent:
    # with the top-1 line the near-duplicate suppression never suppresses (the
    # best-scored candidate is always kept first), so neither can change an
    # answer and no comparison could ever see them (measured: TL_NMS_SEP=3.0
    # went unnoticed). Both are pinned to the lab in the FROZEN test instead.
    ("TL_LOOKBACK", 60), ("TL_MIN_STRENGTH", 2), ("TL_MAX_PIVOTS", 10),
    # the frozen drawer's own constants
    ("_DR_TOUCH_ATR", 1.0), ("_DR_MAX_STRENGTH", 5), ("_DR_TL_MIN_SPAN", 12), ("_DR_TL_MAX_SPAN", 25),
]


def _mutation_corpus():
    return [SY.regime_walk(n=_WALK_N, seed=s) for s in range(4)] + list(_named_fixtures().values())


@pytest.fixture(scope="module")
def lab_answers(lab):
    """The lab's answers over the mutation corpus, computed once."""
    out = []
    for db in _mutation_corpus():
        lab.reset()
        tb = SY.as_tuples(db)
        out.append((db, _tmap(tb, db), [(lab.feats(tb, i), lab.rule(tb, i)) for i in range(len(db))]))
    return out


def _mismatches(answers):
    bad = 0
    for db, tmap, ans in answers:
        S = U.series(db)
        for i, (lf, x) in enumerate(ans):
            if lf != _app_facts(TB.features(db, S, i), tmap):
                bad += 1
                continue
            y = TB.evaluate(db, S, i)
            bad += (x is None) != (y is None)
    return bad


def test_the_unmutated_port_agrees_on_the_mutation_corpus(lab_answers):
    assert _mismatches(lab_answers) == 0


@pytest.mark.parametrize("name,value", _MUTATIONS, ids=[f"{n}={v}" for n, v in _MUTATIONS])
def test_a_mutated_threshold_is_caught(lab_answers, monkeypatch, name, value):
    monkeypatch.setattr(TB, name, value)
    assert _mismatches(lab_answers) > 0, f"mutating {name} -> {value} went unnoticed"


@pytest.mark.parametrize("which", ["coef", "mean", "scale"])
def test_a_mutated_drawer_weight_is_caught(lab_answers, monkeypatch, which):
    """The ranking is what picks the top line; a moved weight must be seen. (The
    intercept is deliberately not here: it shifts every score equally and
    cannot change a ranking, so no comparison could ever see it.)"""
    m = {k: list(v) if isinstance(v, list) else v for k, v in TB._DR_TRENDLINE_MODEL.items()}
    k = m["features"].index("abs_slope")
    m[which][k] = m[which][k] * (-1.0 if which == "coef" else 4.0)
    monkeypatch.setattr(TB, "_DR_TRENDLINE_MODEL", m)
    assert _mismatches(lab_answers) > 0, f"mutating the {which} of abs_slope went unnoticed"


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
    random.Random(5511).shuffle(tickers)
    yield bars, tickers
    bars.c.close()


def test_the_real_bar_timestamps_map_back_to_the_lab_dates(lab, real):
    """The facts compare app bar times to lab YYYYMMDD stamps through the lab's
    own to_dict_bars; the mapping must be the calendar date, both ways."""
    bars, tickers = real
    b = bars.get(tickers[0])
    db = lab.mod.R.to_dict_bars(b)
    for t, d in zip(b[-50:], db[-50:]):
        utc = datetime.datetime.fromtimestamp(d["t"], datetime.timezone.utc)
        assert int(utc.strftime("%Y%m%d")) == t[0]


def test_rule_parity_on_real_histories(lab, real):
    """Every one of the newest sessions of real histories (whole histories are
    passed, so every session sees its full past)."""
    bars, tickers = real
    counts = _new_counts()
    used = 0
    errs = []
    for t in tickers:
        if used >= _REAL_HIST:
            break
        b = bars.get(t)
        if len(b) < 400:
            continue
        used += 1
        db = lab.mod.R.to_dict_bars(b)
        errs += [f"{t}: {e}" for e in _rule_parity(lab, db, counts, start=len(db) - _REAL_RECENT)]
    print(f"\nreal rule parity over {used} histories: {counts}, mismatches={len(errs)}")
    assert used == _REAL_HIST
    assert counts["fire"] > 0 and counts["cross_refused"] > 0, \
        "no fire in the real sample: the comparison saw one branch only"
    assert errs == [], errs[:10]


def test_the_scan_window_reproduces_the_full_history_answer(lab, real):
    """The daily scan hands an undeclared detector the last SCAN_BASE_DEPTH (200)
    bars. At the newest session of that slice AND at the two prior sessions the
    wrapper may report, the slice must answer exactly as the lab does on the
    ticker's full history: every input is windowed (the line reads bars from
    i - 180, ATR and the 50 SMA are windowed)."""
    bars, tickers = real
    depth = registry.SCAN_BASE_DEPTH
    assert registry.bars_for(TB._PATTERN_ID, list(range(depth + 50)), depth) == list(range(50, depth + 50))
    rnd = random.Random(9)
    n = diff = fdiff = fires = 0
    for t in tickers[:300]:
        if n >= 1800:
            break
        b = bars.get(t)
        if len(b) < 450:
            continue
        tb = list(b)
        db = lab.mod.R.to_dict_bars(tb)
        tmap = _tmap(tb, db)
        lab.reset()
        for _ in range(4):
            i = rnd.randrange(300, len(db))
            w = db[i + 1 - depth:i + 1]
            S = U.series(w)
            for off in range(U.MAX_TRIGGER_AGE):
                j, wj = i - off, len(w) - 1 - off
                full = lab.rule(tb, j)
                got = TB.evaluate(w, S, wj)
                n += 1
                fires += full is not None
                diff += (full is None) != (got is None)
                fdiff += lab.feats(tb, j) != _app_facts(TB.features(w, S, wj), tmap)
    print(f"\nscan-window parity: n={n} ticker-days, lab fires={fires}; "
          f"disagreements fire={diff} facts={fdiff}")
    assert n >= 1800
    assert fires > 0
    assert diff == 0 and fdiff == 0
