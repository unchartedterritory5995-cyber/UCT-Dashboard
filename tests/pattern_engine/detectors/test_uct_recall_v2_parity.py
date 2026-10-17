"""PARITY: the dashboard's recall-v2 detectors against the offline lab rules.

`uct_undercut_reclaim` and `uct_episodic_pivot_v2` are ports of
`undercut_reclaim_v2` and `ep_v2` in the lab's `recall_v2.py`. This file runs the
lab code itself (imported by path) beside the dashboard code over the same bars
and asserts identical fire / no-fire, the same variant, and for EP the same
facts. The lab lives outside this repo, so the file SKIPS when it is absent.

  * lab path: env `UCT_LAB_RECALL_V2`, default
    ~/Desktop/TSDR-Ledger-Backup/lab/detectors/recall_v2.py
  * real bars: the lab's own read-only loader (bars.db, `mode=ro`), when the
    database exists; the real-data half skips otherwise.

Two levels are compared, because they answer different questions:
  RULE      dashboard `evaluate(...)` vs the lab function at the same session i,
            over every session of a series (the rule is the port).
  DETECTOR  the registered detector on bars[:i+1] vs the lab at i, for 200 real
            ticker-days. The detector adds the liquidity floor shared by every
            UCT trader-setup detector (a failing floor must yield []), and UnR
            also reports a still-intact trigger from the prior two sessions, so
            UnR parity is "fired with trigger_bars_ago == 0" <=> lab fired.
"""
import importlib.util
import logging
import os
import random
import sys

import pytest

from api.services.pattern_engine.detectors.uct import uct_ep_v2 as EP
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.detectors.uct import uct_undercut_reclaim as UR
from api.services.pattern_engine.primitives.liquidity import liquidity_floor
from tests.pattern_engine.detectors import _recall_v2_synth as SY

_LAB = os.environ.get("UCT_LAB_RECALL_V2") or os.path.expanduser(
    "~/Desktop/TSDR-Ledger-Backup/lab/detectors/recall_v2.py")
_BARS_DB = "C:/data/bars.db"   # the lab loader's own hard-coded read-only path
_REAL_N = 200


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
        spec = importlib.util.spec_from_file_location("uct_lab_recall_v2", _LAB)
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


@pytest.fixture(scope="module")
def lab():
    mod = _load_lab()
    if mod is None:
        pytest.skip(f"lab rules not present at {_LAB}")
    return mod


def _lab_series_reset(lab):
    lab._SC.clear()   # its series cache keys on id(); a recycled id must not hit


def _cmp_unr(lab, tb, db, S, i):
    x = lab.undercut_reclaim_v2(tb, i)
    y = UR.evaluate(db, S, i)
    if (x is None) != (y is None):
        return f"UnR fire mismatch at i={i}: lab={x} dash={y and y['variant']}"
    if x is not None and (x["variant"] != y["variant"] or x["facts"]["levels"] != y["levels_hit"]):
        return f"UnR variant mismatch at i={i}: lab={x} dash={y['variant']} {y['levels_hit']}"
    return None


def _cmp_ep(lab, tb, db, i):
    x = lab.ep_v2(tb, i)
    y = EP.evaluate(db, i)
    if (x is None) != (y is None):
        return f"EP fire mismatch at i={i}: lab={x} dash={y and y['variant']}"
    if x is not None:
        f = x["facts"]
        got = {"gap": y["gap"], "vol_x": y["vol_x"], "close_strength": y["close_strength"],
               "base_bars": y["base_bars"]}
        if x["variant"] != y["variant"] or f != got:
            return f"EP facts mismatch at i={i}: lab={x} dash={y['variant']} {got}"
    return None


def _rule_parity_over_series(lab, tb, db, start=0):
    """Compare both rules at every session of one series. Returns (n, fires, errors)."""
    _lab_series_reset(lab)
    S = U.series(db)
    n, fires, errs = 0, {"unr": 0, "ep": 0}, []
    for i in range(start, len(db)):
        n += 1
        e1 = _cmp_unr(lab, tb, db, S, i)
        e2 = _cmp_ep(lab, tb, db, i)
        errs += [e for e in (e1, e2) if e]
        fires["unr"] += lab.undercut_reclaim_v2(tb, i) is not None
        fires["ep"] += lab.ep_v2(tb, i) is not None
    return n, fires, errs


# ── synthetic ────────────────────────────────────────────────────────────────

def test_rule_parity_on_synthetic_series(lab):
    total, fires, errs = 0, {"unr": 0, "ep": 0}, []
    series = [SY.random_walk(seed=s) for s in range(40)]
    series += [SY.undercut_reclaim(), SY.undercut_close_below(), SY.undercut_in_downtrend(),
               SY.ep_gap(), SY.ep_gap(gap=0.01), SY.ep_gap(close_frac=0.3), SY.ep_gap(days_after=4)]
    for db in series:
        n, f, e = _rule_parity_over_series(lab, SY.as_tuples(db), db)
        total += n
        fires["unr"] += f["unr"]
        fires["ep"] += f["ep"]
        errs += e
    print(f"\nsynthetic rule parity: {total} sessions x 2 rules, fires={fires}, mismatches={len(errs)}")
    # non-vacuity: both branches of both rules were exercised
    assert fires["unr"] >= 20 and fires["ep"] >= 5, fires
    assert total - fires["unr"] >= 1000 and total - fires["ep"] >= 1000
    assert errs == [], errs[:10]


def test_detector_parity_on_synthetic_last_session(lab):
    """The registered detector agrees with the lab on the newest session."""
    for db in [SY.undercut_reclaim(), SY.undercut_close_below(), SY.undercut_in_downtrend(),
               SY.ep_gap(), SY.ep_gap(gap=0.01), SY.ep_gap(close_frac=0.3)]:
        _lab_series_reset(lab)
        tb = SY.as_tuples(db)
        i = len(db) - 1
        unr = [d for d in UR.detect_uct_undercut_reclaim(db, {})
               if d["geometry"]["extras"]["trigger_bars_ago"] == 0]
        assert bool(unr) == (lab.undercut_reclaim_v2(tb, i) is not None)
        assert bool(EP.detect_uct_episodic_pivot_v2(db, {})) == (lab.ep_v2(tb, i) is not None)


# ── real bars (read-only) ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def real(lab):
    if not os.path.isfile(_BARS_DB):
        pytest.skip(f"{_BARS_DB} not present")
    bars = lab.score.Bars()          # the lab's loader: mode=ro, same cleaning
    (last,) = bars.c.execute("select max(ts) from ohlcv where tf='D'").fetchone()
    tickers = sorted(t for (t,) in bars.c.execute(
        "select distinct ticker from ohlcv where tf='D' and ts=?", (last,)))
    rnd = random.Random(20261016)
    rnd.shuffle(tickers)
    yield bars, tickers
    bars.c.close()


def test_detector_parity_on_200_real_ticker_days(lab, real):
    bars, tickers = real
    rnd = random.Random(7)
    n = mism = liq_out = 0
    fires = {"unr": 0, "ep": 0}
    errs = []
    for t in tickers:
        if n >= _REAL_N:
            break
        b = bars.get(t)
        if len(b) < 150:
            continue
        i = rnd.randrange(90, len(b))
        tb = list(b[:i + 1])
        db = lab.to_dict_bars(tb)
        _lab_series_reset(lab)
        lab_unr = lab.undercut_reclaim_v2(tb, i) is not None
        lab_ep = lab.ep_v2(tb, i) is not None
        fires["unr"] += lab_unr
        fires["ep"] += lab_ep
        # rule level at the as-of session
        e = _cmp_unr(lab, tb, db, U.series(db), i) or _cmp_ep(lab, tb, db, i)
        # detector level
        d_unr = UR.detect_uct_undercut_reclaim(db, {})
        d_ep = EP.detect_uct_episodic_pivot_v2(db, {})
        if not liquidity_floor(db).passes:
            liq_out += 1
            if d_unr or d_ep:
                e = e or f"{t}@{tb[-1][0]}: fired through a failing liquidity floor"
        else:
            unr0 = any(d["geometry"]["extras"]["trigger_bars_ago"] == 0 for d in d_unr)
            if unr0 != lab_unr:
                e = e or f"{t}@{tb[-1][0]}: UnR detector={unr0} lab={lab_unr}"
            if bool(d_ep) != lab_ep:
                e = e or f"{t}@{tb[-1][0]}: EP detector={bool(d_ep)} lab={lab_ep}"
        if e:
            mism += 1
            errs.append(f"{t}: {e}")
        n += 1
    print(f"\nreal detector parity: n={n} ticker-days, mismatches={mism}, "
          f"lab fires={fires}, liquidity-floored={liq_out}")
    assert n == _REAL_N, f"only {n} usable ticker-days"
    assert errs == [], errs[:10]


def test_rule_parity_on_real_full_histories(lab, real):
    """Every session of 40 real histories (the 200-day sample hits few EP days)."""
    bars, tickers = real
    total, fires, errs, used = 0, {"unr": 0, "ep": 0}, [], 0
    for t in tickers[_REAL_N:]:
        if used >= 40:
            break
        b = bars.get(t)
        if len(b) < 150:
            continue
        used += 1
        n, f, e = _rule_parity_over_series(lab, list(b), lab.to_dict_bars(b), start=60)
        total += n
        fires["unr"] += f["unr"]
        fires["ep"] += f["ep"]
        errs += [f"{t}: {x}" for x in e]
    print(f"\nreal rule parity: {total} sessions over {used} histories, fires={fires}, "
          f"mismatches={len(errs)}")
    assert fires["unr"] > 0, "no UnR fire in the real sample: the comparison saw one branch only"
    assert errs == [], errs[:10]
