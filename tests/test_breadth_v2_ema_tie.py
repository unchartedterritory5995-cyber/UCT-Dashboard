"""Breadth V2 live EMA rule (ema-tie-exact-v1): a gapped constant series stays exactly constant.

Regression fixtures are the four flat-price SPACs behind the 21 accepted frozen oracle cells.
The pinned `_ewm_last` is read from the vendored accepted file itself (never re-typed).
"""
from __future__ import annotations

import ast
import os

import numpy as np
import pandas as pd
import pytest

from api.services import breadth_v2_overlay as ov

A = 2.0 / 21
NAN = np.nan


def _pinned_ewm():
    src = open(os.path.join(ov.PINNED_DIR, "breadth_live.py"), encoding="utf-8").read()
    fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "_ewm_last")
    ns = {"np": np, "Optional": object}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "pinned_breadth_live", "exec"), ns)
    return ns["_ewm_last"]


PINNED = _pinned_ewm()


def _pandas(row):
    return pd.Series(row).ewm(alpha=A, adjust=False, ignore_na=False).mean().iloc[-1]


@pytest.mark.parametrize("name,px", [("NEBU", 9.65), ("CCH", 9.63), ("TWNT", 9.83), ("NGC", 10.00)])
@pytest.mark.parametrize("pattern", [
    "no gaps", "gaps", "leading gap", "trailing gap", "long gap"])
def test_a_constant_series_stays_exactly_constant(name, px, pattern):
    base = [px] * 40
    if pattern == "gaps":
        base = [px, NAN, NAN, px, NAN, px] * 7
    elif pattern == "leading gap":
        base = [NAN] * 5 + [px] * 30
    elif pattern == "trailing gap":
        base = [px] * 30 + [NAN] * 3
    elif pattern == "long gap":
        base = [px] * 10 + [NAN] * 25 + [px] * 3
    arr = np.array([base])
    got = ov.ewm_last_tie_exact(arr, A)[0]
    assert got == px, (name, pattern, repr(got))
    assert got == _pandas(base)


def test_the_accepted_frozen_behaviour_is_what_it_was():
    """The pinned recursion DOES drift on the gapped fixtures — that is the frozen characteristic
    this live rule removes (and it is why the 21 cells exist)."""
    drift = [PINNED(np.array([[px, NAN, NAN, px, NAN, px] * 7]), A)[0] for px in (9.65, 9.63, 9.83, 10.0)]
    assert all(d < px for d, px in zip(drift, (9.65, 9.63, 9.83, 10.0)))


def test_ordinary_series_are_unchanged_bit_for_bit():
    rng = np.random.default_rng(7)
    X = 100 + np.cumsum(rng.normal(0, 1, (200, 120)), axis=1)
    mask = rng.random(X.shape) < 0.08
    X[mask] = NAN
    X[3, :10] = NAN
    a, b = ov.ewm_last_tie_exact(X, A), PINNED(X, A)
    both = ~np.isnan(a)
    assert np.array_equal(np.isnan(a), np.isnan(b))
    assert np.array_equal(a[both], b[both])          # no tie anywhere → identical to the accepted rule


def test_matches_pandas_including_missing_session_semantics():
    rng = np.random.default_rng(11)
    X = np.round(20 + np.cumsum(rng.normal(0, 0.3, (60, 80)), axis=1), 2)
    X[rng.random(X.shape) < 0.1] = NAN
    X[5, :] = 9.63                                   # a flat name
    X[5, 20:24] = NAN
    got = ov.ewm_last_tie_exact(X, A)
    want = np.array([_pandas(r) for r in X])
    assert np.allclose(got, want, rtol=0, atol=1e-12, equal_nan=True)
    assert got[5] == 9.63 == want[5]


def test_a_price_equal_to_its_ema_is_not_above():
    """The member-facing consequence: `px > ema` is False for the tied SPAC (the oracle's answer)."""
    for px in (9.65, 9.63, 9.83, 10.0):
        e = ov.ewm_last_tie_exact(np.array([[px, NAN, px, NAN, NAN, px] * 5]), A)[0]
        assert not (px > e)
