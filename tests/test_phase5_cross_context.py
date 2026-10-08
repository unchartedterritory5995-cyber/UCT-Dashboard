"""PHASE 5 -- CROSS-CONTEXT + EXPRESSIVE OUTPUTS, the server lane.

* the shared parity vectors (``tests/fixtures/ast/p5_cross_context_parity.json``):
  ``sym`` / ``tf`` / ``tf_live`` with MISSING other-symbol bars, against an
  independent oracle -- the browser asserts the same file (``p5.cross.truth.test.js``);
* the alert lane SUPPLIES another symbol (``alert_user_series._symbol_bars``, the
  scan's local loader) and still refuses what it cannot supply, by name;
* an UNKNOWN bar (a date the other symbol has no bar) is ``None`` on the alert lane,
  so it neither fires nor re-arms;
* the conversation door: the scope wrappers in the model's schema, their bounds
  (ticker shape, ambiguous spellings, fan-out, W/M only), the two substitution
  backstops, and the pre-flight's Phase 5 verdicts;
* security bounds: ticker spellings, timeframe enums, fan-out.

Each case states ASKED / CLAIMED / DID.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from api.services import alert_user_series as aus
from api.services import ast_interpret
from api.services import conversation_preflight as cp
from tests.test_p2_truth_server import (  # noqa: F401  (pytest fixtures by import)
    CLOSE, RSI_GT_70, call, conv, emits, env, model, num, op, out, view,
)

ROOT = Path(__file__).resolve().parents[1]
PARITY = json.loads((ROOT / "tests" / "fixtures" / "ast" / "p5_cross_context_parity.json").read_text("utf-8"))
CROSS = json.loads((ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring"
                    / "crossContext.json").read_text("utf-8"))


def sym(t, child=CLOSE):
    return {"type": "sym", "value": t, "args": [child]}


def _plain(col):
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else v for v in col]


# ═══ 1. the parity vectors ═══════════════════════════════════════════════════

@pytest.mark.parametrize("case", PARITY["cases"], ids=lambda c: c["source"])
def test_P5_parity_vectors_sym_tf_tf_live_with_missing_bars(case):
    """ASKED: the case's tree on daily bars with SPY / QQQ bars missing on some dates.
    CLAIMED: the independent oracle -- exact-t alignment, a missing bar UNKNOWN (never
    forward-filled), a function over a sym read unknown within its reach, `tf` the
    last CLOSED period, `tf_live` the forming one. DID: equal (EXACT)."""
    got = _plain(ast_interpret.interpret(case["ast"], PARITY["bars"],
                                         opts={"tf": PARITY["tf"], "symbols": PARITY["symbols"]}))
    assert len(got) == len(case["expect"])
    for i, (g, e) in enumerate(zip(got, case["expect"])):
        assert (g is None) == (e is None), (i, g, e)
        if e is not None:
            assert g == pytest.approx(e, abs=1e-9), (i, g, e)


def test_P5_parity_fixture_is_not_vacuous():
    """The vectors exercise every scope wrapper, a missing bar, and the reach rule."""
    kinds = json.dumps([c["ast"] for c in PARITY["cases"]])
    for k in ('"sym"', '"tf"', '"tf_live"'):
        assert k in kinds
    assert any(None in c["expect"] and any(v is not None for v in c["expect"]) for c in PARITY["cases"])
    assert len(PARITY["symbols"]["SPY"]) < len(PARITY["bars"])


def test_P5_the_python_lane_no_longer_computes_THROUGH_a_missing_other_symbol_bar():
    """ASKED: `sma(sym('SPY', close), 3)` on a date SPY has no bar. BEFORE (Phase 5's
    parity probe): the Python lane answered 410.5 there -- a value on a bar SPY never
    printed; the chart lane withheld it. CLAIMED: the ported `sym_alignment_mask`
    withholds it and the bars within its reach after it. DID (EXACT / UNKNOWN)."""
    case = next(c for c in PARITY["cases"] if c["source"] == "sma(sym('SPY', close), 3)")
    got = _plain(ast_interpret.interpret(case["ast"], PARITY["bars"],
                                         opts={"tf": "D", "symbols": PARITY["symbols"]}))
    spy_t = {b["t"] for b in PARITY["symbols"]["SPY"]}
    missing = [i for i, b in enumerate(PARITY["bars"]) if b["t"] not in spy_t]
    for m in missing:
        assert all(got[j] is None for j in range(m, m + 4))
    # a caller that supplies no symbols gets the column it always got (all unknown)
    assert ast_interpret.sym_alignment_mask(case["ast"], PARITY["bars"], None) is None


# ═══ 2. the alert lane supplies another symbol ═════════════════════════════════

def _defn(tree, key="value"):
    return {"id": "u_00000000p501", "name": "p5", "version": 1, "meta": {"semantics": 2},
            "plots": [{"key": key, "style": "line"}],
            "compute": {"kind": "ast", "fn": "u_00000000p501", "source": "x", "ast": tree}}


def test_P5_alert_lane_admits_a_servable_sym_and_loads_it_at_the_alerts_timeframe(monkeypatch):
    """ASKED: an alert on `close / sym('SPY', close)` at tf D. CLAIMED: admitted; at
    evaluation SPY is read from the SCAN's local loader at the alert's own timeframe;
    the column is UNKNOWN (None) exactly where SPY has no bar. DID (SUPPLY / UNKNOWN)."""
    reads = []

    def fake_read(sym_, tf, want):
        reads.append((sym_, tf, want))
        return PARITY["symbols"].get(sym_, [])

    monkeypatch.setattr("api.services.screener.scan_evaluator._read_bars", fake_read)
    aus._SYMBOL_CACHE.clear()
    tree = op("/", CLOSE, sym("SPY"))
    fn = aus._make_value_fn("u_00000000p501", "value", _defn(tree))
    assert fn.reads_symbols == ("SPY",)
    col = fn.column(PARITY["bars"], {}, "D")
    assert reads and reads[0][0] == "SPY" and reads[0][1] == "D"
    spy_t = {b["t"] for b in PARITY["symbols"]["SPY"]}
    for b, v in zip(PARITY["bars"], col):
        assert (v is None) == (b["t"] not in spy_t)
    # ⛔ no timeframe -> no other symbol -> every bar UNKNOWN, never the alert's own symbol
    assert set(fn.column(PARITY["bars"], {}, None)) == {None}
    # the last value on a missing final bar would be None -> the lane's `_last_finite`
    assert fn(PARITY["bars"], {}, "D") == pytest.approx(col[-1] if col[-1] is not None else
                                                         [v for v in col if v is not None][-1])


def test_P5_alert_lane_class_share_is_read_under_the_stores_key(monkeypatch):
    seen = []
    monkeypatch.setattr("api.services.screener.scan_evaluator._read_bars",
                        lambda s, tf, want: seen.append(s) or [])
    aus._SYMBOL_CACHE.clear()
    fn = aus._make_value_fn("u_00000000p501", "value", _defn(op("/", CLOSE, sym("BRK.B"))))
    fn.column(PARITY["bars"], {}, "D")
    assert seen == ["BRK-B"]


@pytest.mark.parametrize("tree,code", [
    (op("/", CLOSE, sym("VIX")), aus.OTHER_SYMBOL_AMBIGUOUS),
    (op("+", op("+", sym("SPY"), sym("QQQ")), sym("IWM")), aus.OTHER_SYMBOL_FAN_OUT),
    (op("/", CLOSE, sym("SPY;DROP")), aus.OTHER_SYMBOL_UNSERVABLE),
], ids=["ambiguous", "fan-out", "unservable"])
def test_P5_alert_lane_refuses_what_it_cannot_supply_BY_NAME(tree, code):
    """ASKED: an alert reading VIX / three tickers / a hostile spelling. CLAIMED:
    refused at admission (`withheld`, the named code), never armed to go quiet. DID."""
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._make_value_fn("u_00000000p501", "value", _defn(tree))
    assert exc.value.gate == "withheld" and code in str(exc.value)


def test_P5_the_symbol_cache_is_short_lived_and_bounded(monkeypatch):
    n = []
    monkeypatch.setattr("api.services.screener.scan_evaluator._read_bars",
                        lambda s, tf, want: n.append(1) or [])
    aus._SYMBOL_CACHE.clear()
    aus._symbol_bars("SPY", "D", 10)
    aus._symbol_bars("SPY", "D", 10)
    assert len(n) == 1                      # one store read per (ticker, tf, want) per cycle
    assert aus._SYMBOL_TTL_S < 60           # under one closed-bar cycle: never stale across cycles
    assert aus._SYMBOL_CACHE_MAX <= 64


def test_P5_UNKNOWN_never_fires_and_never_rearms_numeric_conditions():
    """ASKED: a numeric alert over a column whose bar is UNKNOWN (a date the other
    symbol lacks -> None, proven above) or whose PREVIOUS bar is. CLAIMED: the
    closed-bar lane's own `check_condition` never fires on an unknown bar, and a
    cross needs a KNOWN previous bar, so an unknown bar can neither fire nor stand in
    as the "was below" half of a re-arm. Level conditions (`above` / `below`) share
    the `is_true` episode machinery pinned by `p2_is_true_episodes.json` (T->U->T: one
    fire). DID (UNKNOWN)."""
    from api.services.alert_conditions import check_condition
    for cond in ("above", "below", "cross_above", "cross_below"):
        assert check_condition(cond, None, 1.0, 0.0) is False
        assert check_condition(cond, None, None, 0.0) is False
    assert check_condition("cross_above", 2.0, None, 1.0) is False
    assert check_condition("cross_below", 0.0, None, 1.0) is False
    assert check_condition("cross_above", 2.0, 0.5, 1.0) is True      # a known crossing fires
    assert check_condition("above", 2.0, None, 1.0) is True


# ═══ 3. the conversation door ═══════════════════════════════════════════════════

def test_P5_the_models_schema_offers_the_scope_wrappers_with_their_bounds(conv):
    """ASKED: what may the model emit? CLAIMED: num/series/op/call/offset PLUS sym
    (a servable ticker SHAPE), tf and tf_live (W / M only). DID (EXACT)."""
    s = conv.composed_schema()
    Draft202012Validator.check_schema(s)
    refs = [r["$ref"].rsplit("/", 1)[-1] for r in s["$defs"]["node"]["oneOf"]]
    assert refs[-3:] == ["sym", "tf", "tf_live"]
    assert s["$defs"]["sym"]["properties"]["value"]["pattern"] == CROSS["tickerPattern"]
    assert s["$defs"]["tf"]["properties"]["value"]["enum"] == ["W", "M"]
    assert s["$defs"]["tf_live"]["properties"]["value"]["enum"] == ["W", "M"]
    tool = conv.anthropic_tool()["input_schema"]
    assert "sym" in tool["$defs"] and "tf_live" in tool["$defs"]


@pytest.mark.parametrize("tree,gate", [
    (op(">", CLOSE, sym("VIX")), "unsupported:symbol-ambiguous"),
    (op(">", op("+", sym("SPY"), sym("QQQ")), sym("IWM")), "unsupported:symbol-count"),
], ids=["ambiguous", "fan-out"])
def test_P5_the_scope_bounds_refuse_terminally_and_by_name(conv, model, tree, gate):
    client = model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": tree}]))])
    r = conv.converse("use SPY QQQ IWM VIX", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == gate and "envelope" not in r
    assert len(client.calls) == 1            # terminal: no paid repair
    for leak in ("sym", "node", "ops[", "None"):
        assert leak not in r["reason"].replace("symbol", "")


def test_P5_a_daily_tf_inside_a_formula_is_a_schema_fault_not_an_author(conv):
    bad = env(1, [{"op": "set_output_tree", "output": "value",
                   "tree": {"type": "tf", "value": "D", "args": [CLOSE]}}])
    with pytest.raises(conv._Refused) as exc:
        conv.check_envelope(bad, 1)
    assert exc.value.gate == "envelope:schema"


def test_P5_tf_live_is_authored_and_lints_preview_repaints_not_refused(conv):
    """ASKED: the FORMING week's close. CLAIMED: authored (it repaints by design and
    the member acknowledges it at save), never refused as `repaints`. DID."""
    tree = op(">", CLOSE, {"type": "tf_live", "value": "W", "args": [CLOSE]})
    got = conv.check_envelope(env(1, [{"op": "set_output_tree", "output": "value", "tree": tree}]), 1)
    assert got["ops"][0]["tree"] == tree
    from api.services import ast_lint
    assert ast_lint.lint_repaint(tree)["mode"] == "preview-repaints"


def test_P5_BACKSTOP_a_change_must_read_the_symbol_the_member_named(conv, model):
    """ASKED: "only when SPY's RSI is above 50"; the model answers with the CHART's RSI
    (the P3R substitution). CLAIMED: refused, naming SPY. DID (REFUSAL)."""
    own = op(">", call("rsi", CLOSE, num(14)), num(50))
    model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": own}]))])
    r = conv.converse("Only when SPY's RSI is above 50", user_id="u1",
                      view=view(1, [out("value", RSI_GT_70)]), chart={"sym": "AAPL", "tf": "D"})
    assert r["ok"] is False and r["gate"] == "unsupported:other-symbol" and "SPY" in r["reason"]


def test_P5_BACKSTOP_a_change_may_not_read_a_symbol_nobody_named(conv, model):
    """ASKED: "make it 80"; the model brings QQQ on its own. CLAIMED: refused
    (`unsupported:symbol-unasked`), naming QQQ. A ticker the indicator ALREADY reads
    is fine (an edit of an existing cross-symbol indicator). DID (REFUSAL / EXACT)."""
    tree = op(">", sym("QQQ", call("rsi", CLOSE, num(14))), num(80))
    model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": tree}]))])
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == "unsupported:symbol-unasked" and "QQQ" in r["reason"]
    existing = op(">", sym("QQQ", call("rsi", CLOSE, num(14))), num(70))
    model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": tree}]))])
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", existing)]))
    assert r["ok"] is True and r["disposition"] == "change"


def test_P5_SPY_to_QQQ_is_an_authored_change(conv, model):
    """ASKED: "use QQQ instead of SPY" on an indicator reading SPY. DID: accepted."""
    before = op(">", sym("SPY", call("rsi", CLOSE, num(14))), num(50))
    after = op(">", sym("QQQ", call("rsi", CLOSE, num(14))), num(50))
    model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": after}]))])
    r = conv.converse("use QQQ instead of SPY", user_id="u1", view=view(1, [out("value", before)]),
                      chart={"sym": "AAPL", "tf": "D"})
    assert r["ok"] is True, r


# ═══ 4. the pre-flight's Phase 5 verdicts + security bounds ═════════════════════

@pytest.mark.parametrize("message,chart,gate", [
    ("Only when SPY's RSI is above 50", {"sym": "AAPL", "tf": "D"}, None),
    ("use VIX", {"sym": "AAPL", "tf": "D"}, "unsupported:symbol-ambiguous"),
    ("use weekly RSI", {"sym": "AAPL", "tf": "D"}, None),
    ("Show the daily EMA 20 on this chart", {"sym": "AAPL", "tf": "5m"}, None),
    ("use the 1 minute bars", {"sym": "AAPL", "tf": "5m"}, "unsupported:other-timeframe"),
    ("use the 2 hour bars", {"sym": "AAPL", "tf": "5m"}, "unsupported:other-timeframe"),
    ("use weekly RSI", {"sym": "AAPL", "tf": "M"}, "unsupported:other-timeframe"),
])
def test_P5_preflight_verdicts(message, chart, gate):
    got = cp.check(message, chart)
    assert (got["gate"] if got else None) == gate
    if got:
        for leak in ("sym", "node", "unsupported:", "{"):
            assert leak not in got["reason"].replace("symbol", "")


@pytest.mark.parametrize("ticker,ok", [
    ("SPY", True), ("BRK.B", True), ("A", True), ("GOOGL", True),
    ("spy", False), ("SPYXYZ", False), ("SPY;DROP", False), ("BRK/B", False), ("", False),
    ("1SPY", False), ("SPY.", False), ("^SPX", False),
])
def test_P5_security_ticker_spelling(conv, ticker, ok):
    tree = op(">", CLOSE, sym(ticker))
    try:
        conv._check_scopes("t", tree)
        accepted = True
    except conv._Refused:
        accepted = False
    assert accepted is ok
    assert (aus.cross_symbol_refusal([ticker]) is None) is ok


def test_P5_security_bounds_are_ONE_file_shared_with_the_browser():
    """The bounds both languages read are the same file (crossContext.json)."""
    assert cp.cross_context() == CROSS
    from api.services import definition_conversation as dconv
    assert dconv.cross_context() == CROSS
    assert CROSS["maxOtherSymbols"] == 2
    assert CROSS["tfCodes"] == ["W", "M"] and CROSS["tfLiveCodes"] == ["W", "M"]
    assert "1" not in CROSS["calculationTimeframes"]


def test_P5_BACKSTOP_a_symbol_SLOT_edit_reads_the_symbol_it_writes(conv, model):
    """ASKED: "use QQQ instead of SPY" answered with `set_slot {symbol: QQQ}` (no tree
    at all). FOUND in the sandbox flow: the substitution backstop looked only at TREES
    and refused the very edit it exists to allow. CLAIMED: a symbol-slot write is a read
    of that symbol, for both backstops. DID (EXACT / REGRESSION)."""
    before = op(">", sym("SPY", call("rsi", CLOSE, num(14))), num(50))
    v = view(1, [out("value", before, slots=[{"id": "value#0", "kind": "symbol", "value": "SPY"}])])
    model([emits(env(1, [{"op": "set_slot", "slot": "value#0", "symbol": "QQQ"}]))])
    r = conv.converse("use QQQ instead of SPY", user_id="u1", view=v, chart={"sym": "AAPL", "tf": "D"})
    assert r["ok"] is True and r["disposition"] == "change", r
    # ...and a slot edit to a symbol nobody named is still the unasked refusal
    model([emits(env(1, [{"op": "set_slot", "slot": "value#0", "symbol": "IWM"}]))])
    r = conv.converse("make it 60", user_id="u1", view=v, chart={"sym": "AAPL", "tf": "D"})
    assert r["ok"] is False and r["gate"] == "unsupported:symbol-unasked" and "IWM" in r["reason"]
