# -*- coding: utf-8 -*-
"""CBC-FMT -- a `calc_bars_count` document is never run on a server lane (by name).

The member door stamps `meta.calcBarsCount` (a positive whole number, read by
`pine.js::declarationCalcBars`). The chart computes such a script on its LAST N bars only,
as TradingView does (`engine/calcBarsWindow.js`); the alert lane and the screener backtest
compute a series over whatever history they read, which would be a different number under
the same name. Both refuse it by name (`alert:calc-bars-window`), and a stamp they cannot
read refuses too (fail closed). A document without the stamp is untouched (controls).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from api.services import alert_user_series as aus
from api.routers import screener_backtest as sb
# the admission file's own store, definition and bars fixtures (one authority for the shape)
from tests.test_alert_user_admission import (  # noqa: F401 -- pytest fixtures by name
    defs_db, real_bars, _rs_alert_flags_lit, save, defn, DEF_ID, USER_A, ADDRESS,
)


def test_the_refusal_names_the_window_and_the_guard():
    why = aus.calc_bars_window_refusal({"meta": {"calcBarsCount": 100}})
    assert why.startswith(aus.CALC_BARS_WINDOW_GUARD + ":")
    assert "last 100 bars" in why
    assert aus.CALC_BARS_WINDOW_GUARD == "alert:calc-bars-window"


@pytest.mark.parametrize("bad", [0, -5, 1.5, "100", True, None])
def test_a_stamp_it_cannot_read_FAILS_CLOSED(bad):
    why = aus.calc_bars_window_refusal({"meta": {"calcBarsCount": bad}})
    assert why and why.startswith(aus.CALC_BARS_WINDOW_GUARD)
    # and it says so, rather than quoting a window it never read
    assert "cannot read" in why and "last " not in why


@pytest.mark.parametrize("doc", [{}, {"meta": {}}, {"meta": {"name": "x"}}, None, "x"])
def test_CONTROL_no_stamp_no_refusal(doc):
    assert aus.calc_bars_window_refusal(doc) is None


def test_an_alert_on_a_windowed_document_is_refused_at_its_own_gate(defs_db, real_bars):
    save(USER_A, defn(meta_extra={"calcBarsCount": 100}))
    with pytest.raises(aus.AdmissionRefused) as e:
        aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert e.value.gate == "calc-bars-window"
    assert aus.CALC_BARS_WINDOW_GUARD in str(e.value)
    assert aus.REFUSAL_FRAGMENTS["calc-bars-window"] in str(e.value)
    # and the value door (the prefill) refuses by the same gate
    with pytest.raises(aus.AdmissionRefused) as e2:
        aus.user_value_function(USER_A, ADDRESS)
    assert e2.value.gate == "calc-bars-window"


def test_CONTROL_the_same_document_without_the_stamp_admits(defs_db, real_bars):
    save(USER_A, defn())
    admitted = aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert admitted["addresses"] == [ADDRESS]


def test_the_catalog_does_not_offer_a_windowed_document(defs_db):
    save(USER_A, defn(meta_extra={"calcBarsCount": 100}))
    assert [e for e in aus.user_catalog(USER_A) if DEF_ID in str(e)] == []


@pytest.mark.parametrize("kind", ["ast", "runtime"])
def test_the_screener_backtest_refuses_a_windowed_document_409_by_name(monkeypatch, kind):
    doc = {"meta": {"calcBarsCount": 1000},
           "compute": ({"kind": "ast", "ast": {"type": "series", "name": "close"}} if kind == "ast"
                       else {"kind": "runtime", "source": "//@version=6\nindicator('x')\nplot(close)", "outputs": {"a": 0}})}
    monkeypatch.setattr(sb.defs, "get", lambda user_id, def_id: {"def_id": def_id, "definition": doc, "version": 1})
    monkeypatch.setattr(sb.defs, "engine_withheld_reason", lambda row: None)
    with pytest.raises(HTTPException) as e:
        sb._definition_tree("u_0123456789ab", "user-a")
    assert e.value.status_code == 409
    assert aus.CALC_BARS_WINDOW_GUARD in e.value.detail


def test_CONTROL_the_screener_backtest_replays_an_unstamped_ast_document(monkeypatch):
    doc = {"meta": {}, "compute": {"kind": "ast", "ast": {"type": "series", "name": "close"}}}
    monkeypatch.setattr(sb.defs, "get", lambda user_id, def_id: {"def_id": def_id, "definition": doc, "version": 1})
    monkeypatch.setattr(sb.defs, "engine_withheld_reason", lambda row: None)
    tree, prov = sb._definition_tree("u_0123456789ab", "user-a")
    assert tree == {"type": "series", "name": "close"}
