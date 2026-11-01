"""C48 / C45 -- the server lanes honour ``meta.blockRuns``, as the member's chart does.

A member pane attaches ONE document to ``/api/user-definitions``. Two server lanes
then evaluate its trees column-wise with ``ast_interpret`` -- the every-bar number:

    ``alert_user_series``   a user-series alert armed on one of its plots
    ``scan_evaluator``      the scan sweep, running its plot as a screen

A plot that reads a call whose code runs only on some bars -- a ``ta.*`` written in
an ``if`` block (C48), in one arm of a ``?:`` or on the right of a Pine v6 ``and`` /
``or`` (C45) -- carries that code's guard (``meta.blockRuns``), and the chart refuses
it by name wherever the code runs after a bar it skipped. Until this file neither
server lane read the stamp, so a plot the member's chart draws nothing for could
fire an alert, or match a screen, off a value that is not TradingView's.

⛔ THE STAMPS HERE ARE THE MEMBER DOOR'S OWN (``tests/fixtures/ast/block_runs_parity
.json``, written by the JS lane), and every refusal is asserted against the
sentence the chart's bind produced there.
"""
from __future__ import annotations

import ast as pyast
import datetime
import io
import json
import pathlib

import pytest

from api.services import alert_user_series as aus
from api.services import ast_interpret as ai
from api.services import block_runs
from api.services import user_definitions
from api.services.screener import scan_evaluator
from api.services.screener import scan_store
from api.services.screener import snapshot_db

PARITY = json.load(io.open(pathlib.Path(__file__).parent / "fixtures" / "ast" / "block_runs_parity.json",
                           encoding="utf-8"))
CASES = {c["name"]: c for c in PARITY["cases"]}
RDDT = PARITY["bars"]                                     # RDDT 1D, from the listing

CLOSE = {"type": "series", "name": "close"}
OPEN = {"type": "series", "name": "open"}
VOLUME = {"type": "series", "name": "volume"}


def num(v):
    return {"type": "num", "value": v}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


#: the trees the member door built for the parity cases, spelled here
UP = op(">", CLOSE, OPEN)
T03 = op("?:", UP, call("sma", CLOSE, num(5)), CLOSE)                     # `up ? ta.sma(close, 5) : close`
ALWAYS = op("?:", op(">=", VOLUME, num(0)), call("sma", CLOSE, num(5)), CLOSE)
V6_AND = op("&&", UP, call("crossOver", CLOSE, call("sma", CLOSE, num(5))))  # `up and ta.crossover(…)`


def stamp(case_name: str) -> dict:
    return json.loads(json.dumps(CASES[case_name]["definition"]["meta"]))


def doc(tree, meta=None) -> dict:
    return {"meta": dict(meta or {}), "compute": {"kind": "ast", "ast": tree},
            "plots": [{"key": "value"}], "inputs": []}


def test_the_trees_here_are_the_ones_the_stamps_were_made_for():
    """A gate guards ITS plot's test: the stamp's guard is the test spelled here."""
    assert stamp("?: true arm (T03)")["blockRuns"]["keys"][0]["gates"][0]["guard"] == UP
    assert stamp("v6 and")["blockRuns"]["keys"][0]["gates"][0]["guard"] == UP
    assert stamp("?: test true on every bar")["blockRuns"]["keys"][0]["gates"][0]["guard"] == ALWAYS["args"][0]


# ═══ 1. the alert lane ═══════════════════════════════════════════════════════

def test_an_alert_column_is_withheld_where_the_chart_withholds_the_plot():
    fn = aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(T03, stamp("?: true arm (T03)")))
    assert fn.block_runs_refusal(RDDT, {}) == CASES["?: true arm (T03)"]["expected"]
    column = fn.column(RDDT, {})
    assert column == [None] * len(RDDT)
    assert fn(RDDT, {}) is None


def test_CONTROL_the_same_tree_unstamped_is_the_every_bar_number_it_always_was():
    fn = aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(T03))
    column = fn.column(RDDT, {})
    assert fn.block_runs_refusal(RDDT, {}) is None
    # only the SMA's warm-up on the up bars among the first four has no number
    assert sum(1 for v in column if v is not None) == len(RDDT) - sum(1 for b in RDDT[:4] if b["c"] > b["o"])
    assert column == ai.interpret(T03, RDDT)


def test_a_stamped_plot_whose_code_runs_on_every_bar_keeps_its_alert():
    fn = aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(ALWAYS, stamp("?: test true on every bar")))
    assert fn.block_runs_refusal(RDDT, {}) is None
    assert fn.column(RDDT, {}) == ai.interpret(ALWAYS, RDDT)


def test_bars_that_arrive_later_are_honoured_at_evaluation():
    """The verdict is a fact about the bars: a window on which the code never
    skipped is answered, and the moment a later bar makes it run after a skip the
    column goes to no number -- the per-evaluation half of the gate."""
    fn = aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(T03, stamp("?: true arm (T03)")))
    up_only = [b for b in RDDT if b["c"] > b["o"]][:40]
    assert fn.block_runs_refusal(up_only, {}) is None
    assert fn.column(up_only, {})[-1] is not None
    mixed = up_only + [dict(up_only[-1], o=up_only[-1]["c"] + 1)] + up_only[-5:]
    assert fn.block_runs_refusal(mixed, {}) is not None
    assert fn.column(mixed, {}) == [None] * len(mixed)


def _admit_patched(monkeypatch, definition):
    row = {"def_id": "u_b1b1b1b1b1b1", "version": 1, "rev": 1, "ast_hash": "x", "definition": definition}
    monkeypatch.setattr(aus, "_gate_definition", lambda user_id, def_id, version: row)
    monkeypatch.setattr(aus, "_gate_lane", lambda r: definition)
    monkeypatch.setattr(aus, "_gate_requirements", lambda r, d: None)
    monkeypatch.setattr(aus, "_gate_repaint", lambda r, d: None)
    monkeypatch.setattr(aus, "_gate_budget", lambda d, i: None)
    monkeypatch.setattr(aus, "_gate_cross_lane", lambda d, i, bars: {"compared": 1, "rel_tol": 1e-9})


def test_arming_an_alert_on_a_withheld_plot_is_refused_by_name(monkeypatch):
    _admit_patched(monkeypatch, doc(V6_AND, stamp("v6 and")))
    aus.forget()
    try:
        with pytest.raises(aus.AdmissionRefused) as exc:
            aus.arm_for_alert("user-b1", "u_b1b1b1b1b1b1.value", "RDDT", "D", bars=RDDT)
        assert exc.value.gate == "withheld"
        message = str(exc.value)
        assert aus.REFUSAL_FRAGMENTS["withheld"] in message
        assert f"({block_runs.BLOCK_RUNS_GUARD})" in message
        assert CASES["v6 and"]["expected"] in message
    finally:
        aus.forget()


def test_CONTROL_arming_the_same_plot_on_bars_where_its_code_runs_every_bar(monkeypatch):
    _admit_patched(monkeypatch, doc(V6_AND, stamp("v6 and")))
    aus.forget()
    try:
        up_only = [b for b in RDDT if b["c"] > b["o"]][:60]
        admitted = aus.arm_for_alert("user-b1", "u_b1b1b1b1b1b1.value", "RDDT", "D", bars=up_only)
        assert admitted["addresses"] == ["u_b1b1b1b1b1b1.value"]
        # …and an unstamped document arms on the mixed bars, exactly as before
        _admit_patched(monkeypatch, doc(V6_AND))
        aus.forget()
        assert aus.arm_for_alert("user-b1", "u_b1b1b1b1b1b1.value", "RDDT", "D", bars=RDDT)["addresses"] \
            == ["u_b1b1b1b1b1b1.value"]
    finally:
        aus.forget()


# ═══ 2. the scan sweep ═══════════════════════════════════════════════════════

SESSION = 20260807
SESSION_DATE = datetime.date(2026, 8, 7)


def _scan_definition(tree, meta=None):
    return {
        "schemaVersion": 1, "id": "u_b1b1b1b1b1b2", "version": 1,
        "meta": dict(meta or {}, name="A Screen", shortName="SCR", repaint="non-repainting"),
        "compute": {"kind": "ast", "ast": tree, "fn": user_definitions.ast_hash(tree), "rev": 1},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def _rows(n=80, *, alternate=True, end=SESSION_DATE):
    """The store's own daily shape (`ts` a YYYYMMDD int): closes that wander, and
    opens that put the close above (even days) and below (odd days) them."""
    out = []
    for i in range(n):
        d = end - datetime.timedelta(days=n - 1 - i)
        key = d.year * 10_000 + d.month * 100 + d.day
        close = 100.0 + (i % 7) * 1.5
        opn = close - 1 if (i % 2 == 0 or not alternate) else close + 1
        out.append((key, opn, max(opn, close) + 1, min(opn, close) - 1, close, 1_000_000))
    return out


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(path)
    scan_store.init_db()
    return path


@pytest.fixture
def bars(monkeypatch):
    from api.services import bars_sqlite
    table: dict = {}

    def _get(ticker, tf, max_bars):
        return list(table.get(str(ticker).upper()) or [])[-max_bars:]

    monkeypatch.setattr(bars_sqlite, "get_bars", _get)
    return table


def test_the_sweep_withholds_a_stamped_screen_on_a_symbol_where_its_code_skipped(store, bars):
    bars["MIXD"] = _rows(alternate=True)
    bars["UPUP"] = _rows(alternate=False)
    out = scan_evaluator.evaluate_one(_scan_definition(V6_AND, stamp("v6 and")), scan_evaluator.DEFAULT_TF,
                                      universe=["MIXD", "UPUP"], as_of=SESSION)
    assert out["evaluated"] == 2
    assert out["not_computable"] == 1 and out["answered"] == 1
    entry = next(e for e in out["dropped_symbols"] if e["ticker"] == "MIXD")
    assert entry["reason"] == scan_evaluator.NOT_COMPUTABLE_REASON
    assert entry["detail"].startswith(f"{block_runs.BLOCK_RUNS_GUARD}: `ta.crossover` is called on the right "
                                      "of a Pine v6 `and`")
    assert "that right side skips bar" in entry["detail"]
    assert all(e["ticker"] != "UPUP" for e in out["dropped_symbols"])


def test_CONTROL_the_same_screen_unstamped_answers_both_symbols(store, bars):
    bars["MIXD"] = _rows(alternate=True)
    bars["UPUP"] = _rows(alternate=False)
    out = scan_evaluator.evaluate_one(_scan_definition(V6_AND), scan_evaluator.DEFAULT_TF,
                                      universe=["MIXD", "UPUP"], as_of=SESSION)
    assert out["answered"] == 2 and out["not_computable"] == 0


def test_the_guard_is_evaluated_under_the_trees_own_opts():
    """⛔ ONE SET OF OPTS. `_block_runs_withheld` evaluates a guard; `evaluate_one`
    evaluates the tree; the dict each hands `interpret` is the same, key for key and
    expression for expression -- read off the source, so the two cannot drift."""
    source = io.open(pathlib.Path(scan_evaluator.__file__), encoding="utf-8").read()
    module = pyast.parse(source)

    def fn(name):
        return next(n for n in pyast.walk(module) if isinstance(n, pyast.FunctionDef) and n.name == name)

    calls = [n for n in pyast.walk(fn("evaluate_one"))
             if isinstance(n, pyast.Call) and getattr(n.func, "attr", None) == "interpret"]
    assert len(calls) == 1
    tree_opts = {k.arg: k.value for k in calls[0].keywords}["opts"]
    guard_opts = next(n.value for n in pyast.walk(fn("_block_runs_withheld"))
                      if isinstance(n, pyast.Assign) and getattr(n.targets[0], "id", None) == "opts")
    assert isinstance(tree_opts, pyast.Dict) and isinstance(guard_opts, pyast.Dict)
    assert [pyast.dump(k) for k in guard_opts.keys] == [pyast.dump(k) for k in tree_opts.keys]
    assert [pyast.dump(v) for v in guard_opts.values] == [pyast.dump(v) for v in tree_opts.values]
    # …and the call that hands them over passes the names the tree's opts read
    call_site = next(n for n in pyast.walk(fn("evaluate_one"))
                     if isinstance(n, pyast.Call) and getattr(n.func, "id", None) == "_block_runs_withheld")
    assert [getattr(a, "id", None) for a in call_site.args] == [
        "definition", "scan_key", "bars", "scalars", "tf_code", "symbol_series", "_eval_now"]
