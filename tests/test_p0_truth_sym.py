"""P0 truth corpus, slice "sym" -- the SERVER lanes.

Invariant: if UCT accepts a definition that requires an EXTERNAL series
(``sym('T', …)`` another symbol, ``ltf(…, 'N')`` a lower timeframe), the
execution path must either SUPPLY it correctly or REFUSE it before it becomes
active. Never accept -> starve -> silent "no number" / confident 0.

Every case names ASKED / CLAIMED / DID and its expected outcome class.
BEFORE is the behaviour measured on base a92b96de2 (recorded in the
P0-sym report); AFTER is what each case asserts.
"""
from __future__ import annotations

import datetime

import pytest

from api.services import alert_user_series as aus
from api.services import scan_definition

CLOSE = {"type": "series", "name": "close"}


def num(v):
    return {"type": "num", "value": v}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def sym(ticker, child=CLOSE):
    return {"type": "sym", "value": ticker, "args": [child]}


def ltf(code, child=CLOSE):
    return {"type": "ltf", "value": code, "args": [child]}


#: close / sym('SPY', close) -- relative strength vs SPY
RS = op("/", CLOSE, sym("SPY"))
#: close / sym('SPY', close) > highest(...)[1] -- an RS new-high CONDITION
RS_HIGH = op(">", RS, call("highest", {"type": "offset", "value": 1, "args": [RS]}, num(63)))
ABOVE_AVERAGE = op(">", CLOSE, call("sma", CLOSE, num(3)))
PINE = {"name": "from pine", "recurrenceOrigin": "pine"}
#: ⭐ PHASE 5 -- a sym the alert lane still cannot supply: letters that also name an index
VIX_RS = op("/", CLOSE, sym("VIX"))


def _doc(tree, meta=None) -> dict:
    return {"meta": dict(meta or {}), "compute": {"kind": "ast", "ast": tree},
            "plots": [{"key": "value"}]}


def date_bars(n: int = 120) -> list:
    day, out = datetime.date(2024, 1, 2), []
    while len(out) < n:
        if day.weekday() < 5:
            c = 100.0 + (len(out) % 9)
            out.append({"t": int(day.strftime("%Y%m%d")), "o": c, "h": c + 1,
                        "l": c - 1, "c": c, "v": 1000.0})
        day += datetime.timedelta(days=1)
    return out


# ═══ ALERT LANE ══════════════════════════════════════════════════════════════

def test_alert_sym_formula_is_REFUSED_at_arm():
    """ASKED: alert when `close / sym('SPY', close)` makes a 63-bar high.
    P0: REFUSED (`withheld`, `other-symbol:unsupplied`) -- the lane supplied no SPY.
    ⭐ PHASE 5 SUPERSEDES: the lane SUPPLIES SPY now (`alert_user_series._symbol_bars`,
    the scan's local loader, at the alert's timeframe), so the plot is ADMITTED and
    names what it reads; a sym it still cannot supply (`VIX`, an index spelling) keeps
    the P0 refusal shape: `withheld`, named, "would arm and never fire"."""
    fn = aus._make_value_fn("u_0000000005e1", "value", _doc(RS_HIGH))
    assert fn.reads_symbols == ("SPY",)
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._make_value_fn("u_0000000005e1", "value", _doc(op(">", VIX_RS, num(1))))
    assert exc.value.gate == "withheld"
    assert aus.OTHER_SYMBOL_AMBIGUOUS in str(exc.value)
    assert "sym('VIX'" in str(exc.value)
    assert "would arm and never fire" in str(exc.value)


def test_alert_ltf_formula_is_REFUSED_at_arm():
    """ASKED: alert on `ltf(close, '60') > sma(close, 3)`.
    CLAIMED (before): admitted.  DID (before): never a number (SILENT).
    AFTER: REFUSAL, gate `withheld`, code `lower-tf:unsupplied`."""
    tree = op(">", ltf("60"), call("sma", CLOSE, num(3)))
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._make_value_fn("u_0000000005e1", "value", _doc(tree))
    assert exc.value.gate == "withheld"
    assert aus.UNSUPPLIED_LOWER_TF in str(exc.value)


def test_alert_pine_origin_sym_is_REFUSED_too():
    """ASKED: an alert on a Pine import's `request.security("AMEX:SPY", …)` plot.
    ⭐ PHASE 5: the supply is per TICKER, not per origin -- the Pine document is
    treated exactly as the typed formula is: SPY admitted, VIX refused."""
    assert aus._make_value_fn("u_0000000005e1", "value", _doc(RS, PINE)).reads_symbols == ("SPY",)
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._make_value_fn("u_0000000005e1", "value", _doc(VIX_RS, PINE))
    assert exc.value.gate == "withheld" and aus.OTHER_SYMBOL_AMBIGUOUS in str(exc.value)


def test_CONTROL_alert_without_external_read_still_arms():
    """CONTROL: a plot that reads only its own bars is admitted and fires.
    Expected: VALUE (unchanged from before)."""
    fn = aus._make_value_fn("u_0000000005e1", "value", _doc(ABOVE_AVERAGE))
    assert fn(date_bars(40), {}) in (0.0, 1.0)


def test_unsupplied_reads_is_satisfied_by_a_supply():
    """The decision is "is it SUPPLIED", not "does it read sym": a caller that
    hands the series is not refused (the screener's benchmark supply)."""
    assert aus.unsupplied_reads(RS, {}) == [aus.UNSUPPLIED_OTHER_SYMBOL]
    assert aus.unsupplied_reads(RS, {"symbols": {"SPY": date_bars(5)}}) == []
    assert aus.unsupplied_reads(ABOVE_AVERAGE, {}) == []


def test_alert_sibling_plot_survives_the_refused_sym_plot(monkeypatch):
    """ASKED: a two-plot formula -- `rs` reads a symbol the lane cannot supply
    (⭐ PHASE 5: VIX; SPY is supplied now), `signal` reads nothing else.
    AFTER: `signal` is admitted (VALUE), `rs` is kept as a `withheld` REFUSAL and
    raised when THAT plot is armed -- the C45 sibling rule, unchanged."""
    doc = {
        "meta": {"name": "typed"},
        "compute": {"kind": "ast", "ast": ABOVE_AVERAGE,
                    "trees": {"signal": ABOVE_AVERAGE, "rs": VIX_RS},
                    "treesHash": "sha256:" + "0" * 64, "scanPlot": "signal"},
        "plots": [{"key": "signal"}, {"key": "rs"}],
    }
    row = {"def_id": "u_0000000005e1", "version": 1, "rev": 1, "ast_hash": "x", "definition": doc}
    monkeypatch.setattr(aus, "_gate_definition", lambda user_id, def_id, version: row)
    monkeypatch.setattr(aus, "_gate_lane", lambda r: doc)
    monkeypatch.setattr(aus, "_gate_requirements", lambda r, d: None)
    monkeypatch.setattr(aus, "_gate_repaint", lambda r, d: None)
    monkeypatch.setattr(aus, "_gate_budget", lambda d, i: None)
    monkeypatch.setattr(aus, "_gate_cross_lane", lambda d, i, bars: {"compared": 1, "rel_tol": 1e-9})
    aus.forget()
    try:
        admitted = aus.admit_user_definition("user-p0", "u_0000000005e1", bars=date_bars(40))
        assert admitted["addresses"] == ["u_0000000005e1.signal"]
        assert list(admitted["withheld"]) == ["u_0000000005e1.rs"]
        with pytest.raises(aus.AdmissionRefused) as exc:
            aus.arm_for_alert("user-p0", "u_0000000005e1.rs", "AAPL", "D", bars=date_bars(40))
        assert exc.value.gate == "withheld"
    finally:
        aus.forget()


# ═══ SCREENER LANE (verified, unchanged) ══════════════════════════════════════

def _scan_doc(tree) -> dict:
    return {
        "schemaVersion": 1, "id": "u_0000000005e1", "version": 1,
        "meta": {"name": "typed"},
        "compute": {"kind": "ast", "ast": tree},
        "placement": {"target": "pane"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def test_screener_benchmark_sym_is_SUPPLIED():
    """ASKED: scan `close / sym('SPY', close) > highest(...)[1]`.
    CLAIMED/DID: SPY is a declared benchmark the sweep loads -> admitted (VALUE)."""
    out = scan_definition.assert_scannable(_scan_doc(RS_HIGH))
    assert out["yields"] == "bool"


def test_screener_non_benchmark_sym_is_REFUSED():
    """ASKED: scan against `sym('NVDA', close)`.
    DID (before and after): REFUSAL at the door, gate `symbol`, naming the roster."""
    tree = op(">", op("/", CLOSE, sym("NVDA")), num(1))
    with pytest.raises(scan_definition.ScanRefused) as exc:
        scan_definition.assert_scannable(_scan_doc(tree))
    assert "[gate:symbol]" in str(exc.value)


def test_screener_ltf_is_REFUSED():
    """ASKED: scan on `ltf(close, '60') > close`. DID: REFUSAL, gate `cadence`."""
    with pytest.raises(scan_definition.ScanRefused) as exc:
        scan_definition.assert_scannable(_scan_doc(op(">", ltf("60"), CLOSE)))
    assert "[gate:cadence]" in str(exc.value)
