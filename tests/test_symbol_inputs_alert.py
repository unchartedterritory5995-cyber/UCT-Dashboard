"""SETTINGS PARITY (symbol): an alert is computed at the author's symbol only.

A symbol a script reads through an input (``meta.symbolInputs``, ``engine/symbolInputs.js``) is a chart
setting: the chart fetches and computes the member's choice (RS Rating against AMEX:SPY instead of
SP:SPX). The alert lane computes the author's symbol, so an alert armed at another symbol is withheld by
name, never computed against the wrong instrument.
"""
from __future__ import annotations

from api.services import alert_user_series as aus

CLOSE = {"type": "series", "name": "close"}
META = {"symbolInputs": [{"input": "lineTicker", "ticker": "SPX", "venue": "SP", "default": "SP:SPX",
                          "title": "Comparative Symbol for Line", "pass": "plots"}]}


def _defn(meta=None):
    d = {"inputs": [], "plots": [{"key": "p"}],
         "compute": {"kind": "ast", "ast": {"type": "call", "name": "sma", "args": [CLOSE, {"type": "num", "value": 3}]}}}
    if meta is not None:
        d["meta"] = meta
    return d


def _bars(n=40):
    return [{"t": 20200101 + i, "o": 100.0 + i, "h": 101.0 + i, "l": 99.0 + i, "c": 100.0 + i, "v": 1000}
            for i in range(n)]


def test_S1_an_alert_at_another_symbol_is_withheld_by_name():
    fn = aus._make_value_fn("u_sym1", "p", _defn(META))
    why = fn.withheld(_bars(), {"lineTicker": "AMEX:SPY"})
    assert why is not None
    assert why.startswith("Comparative Symbol for Line is set to AMEX:SPY")
    assert "SP:SPX" in why


def test_S2_at_the_authors_symbol_any_spelling_the_alert_computes():
    fn = aus._make_value_fn("u_sym2", "p", _defn(META))
    assert fn.withheld(_bars(), {}) is None
    assert fn.withheld(_bars(), {"lineTicker": " sp:spx "}) is None


def test_S3_CONTROL_a_document_without_symbol_inputs_ignores_the_key():
    fn = aus._make_value_fn("u_sym3", "p", _defn())
    assert fn.withheld(_bars(), {"lineTicker": "AMEX:SPY"}) is None
