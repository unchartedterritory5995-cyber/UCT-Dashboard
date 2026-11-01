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


# ═══ 3. an alert the member's chart withholds is TOLD, never silent (M2) ═════
#
# The column of a withheld plot is no number on every bar, so the alert goes quiet
# -- and since this deploy that includes every C48 stamp ALREADY SAVED, which the
# server lanes now honour. The member's surface for "this alert is quiet for a
# reason" is the silent-alert sweep: `state = needs_attention` with the reason in
# `state_detail`, rendered verbatim by every alert surface (`alertState.jsx`).

def _store_bars(bars):
    """The parity bars in the store's daily shape (`t` a YYYYMMDD int) -- what the
    evaluator's own fetcher hands the closed-bar lane."""
    return [dict(b, t=int(str(b["t"]).replace("-", ""))) for b in bars]


#: bars on which the T03 / v6-and code runs on EVERY bar (each closes up)
UP_ONLY = [b for b in RDDT if b["c"] > b["o"]][:60]
ADDRESS = "u_b1b1b1b1b1b1.value"


@pytest.fixture
def alerts(tmp_path, monkeypatch):
    from api.services import indicator_alert_service as ias
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    ias.init_schema()
    aus.forget()
    yield ias
    aus.forget()


def _armed(monkeypatch, ias, definition, *, arm_bars, params_json=None):
    """An alert row armed on `arm_bars` through the REAL create path, and the
    evaluator's fetcher pointed at a feed the test then moves."""
    from api.services import indicator_alert_evaluator as ev
    _admit_patched(monkeypatch, definition)
    feed = {"bars": _store_bars(arm_bars)}
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in feed["bars"]])
    aid = ias.create(user_id="user-b1", sym="RDDT", indicator=ADDRESS,
                     condition="below", threshold=-1e12, tf="D", params_json=params_json)
    return aid, feed


RESUMES = "This alert resumes when the value is computable."


def _detail_names_the_gate(detail, case):
    """⭐ L1 (review round 2) — the ARMED alert's sentence, WHOLE: the gate's head (the
    call, the shape, the line) and where on these bars its code skipped."""
    assert detail == aus.withheld_alert_detail(CASES[case]["expected"])
    assert detail.startswith("Withheld: ") and detail.endswith(RESUMES)
    assert len(detail) <= aus.ALERT_DETAIL_MAX
    assert CASES[case]["expected"].split(": ", 1)[0].split(" — ", 1)[0] in detail
    assert "skips bar" in detail


def test_a_withheld_alert_is_put_in_needs_attention_by_the_gates_own_sentence(alerts, monkeypatch):
    import time as _time
    from api.services import indicator_alert_evaluator as ev
    ias = alerts
    aid, feed = _armed(monkeypatch, ias, doc(T03, stamp("?: true arm (T03)")), arm_bars=UP_ONLY)
    feed["bars"] = _store_bars(RDDT)            # the bars arrive on which the arm runs after a skip
    t0 = _time.time()
    summary = ev._run_one_cycle()
    assert summary["errors"] == 0
    row = ias.get(aid)
    # the silence itself: the column was no number on every bar, and nothing was written
    assert row["last_evaluated_at"] is None and row["state"] == "armed"
    out = ias.sweep_silent_alerts(now=t0 + 400)
    assert out["flagged"] == 1
    row = ias.get(aid)
    assert row["state"] == "needs_attention"
    _detail_names_the_gate(row["state_detail"], "?: true arm (T03)")


def test_a_re_armed_alert_the_gates_withhold_is_told_the_same_way(alerts, monkeypatch):
    """The registry-miss path (a restart, or the author saved): the re-arm raises the
    arm-time refusal inside the cycle, and the diagnosis reads the same door."""
    import time as _time
    from api.services import indicator_alert_evaluator as ev
    ias = alerts
    aid, feed = _armed(monkeypatch, ias, doc(V6_AND, stamp("v6 and")), arm_bars=UP_ONLY)
    aus.forget()
    feed["bars"] = _store_bars(RDDT)
    t0 = _time.time()
    assert ev._run_one_cycle()["errors"] == 1
    assert ias.get(aid)["last_evaluated_at"] is None
    ias.sweep_silent_alerts(now=t0 + 400)
    row = ias.get(aid)
    assert row["state"] == "needs_attention"
    _detail_names_the_gate(row["state_detail"], "v6 and")


BROKEN_GUARD = {"type": "call", "name": "no_such_function_here", "args": []}


def _broken_stamp():
    meta = stamp("?: true arm (T03)")
    meta["blockRuns"]["keys"][0]["gates"][0]["guard"] = BROKEN_GUARD
    return meta


def test_a_guard_that_THROWS_withholds_the_plot_and_surfaces_the_same_way(alerts, monkeypatch):
    """⛔ An unread guard is not code that ran on every bar: the column is withheld,
    and the member is told so -- in the cycle (re-arm) and in the diagnosis."""
    import time as _time
    from api.services import indicator_alert_evaluator as ev
    ias = alerts
    fn = aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(T03, _broken_stamp()))
    why = fn.withheld(RDDT, {}, "D")
    assert why.startswith(CASES["?: true arm (T03)"]["expected"].split(" — on this chart")[0])
    assert "could not be computed" in why
    assert fn.column(RDDT, {}) == [None] * len(RDDT)
    # end to end: armed while the document was unstamped, then the stamp lands
    aid, feed = _armed(monkeypatch, ias, doc(T03), arm_bars=RDDT)
    _admit_patched(monkeypatch, doc(T03, _broken_stamp()))
    aus.forget()
    t0 = _time.time()
    assert ev._run_one_cycle()["errors"] == 1
    ias.sweep_silent_alerts(now=t0 + 400)
    row = ias.get(aid)
    assert row["state"] == "needs_attention"
    detail = row["state_detail"]
    assert detail.startswith("Withheld: ") and detail.endswith(RESUMES) and len(detail) <= aus.ALERT_DETAIL_MAX
    assert "could not be computed" in detail


def test_CONTROL_the_same_alert_unstamped_evaluates_and_is_never_flagged(alerts, monkeypatch):
    import time as _time
    from api.services import indicator_alert_evaluator as ev
    ias = alerts
    aid, feed = _armed(monkeypatch, ias, doc(T03), arm_bars=UP_ONLY)
    feed["bars"] = _store_bars(RDDT)
    t0 = _time.time()
    ev._run_one_cycle()
    assert ias.get(aid)["last_evaluated_at"] is not None
    assert ias.sweep_silent_alerts(now=t0 + 400)["flagged"] == 0
    assert ias.get(aid)["state"] == "armed"


def test_the_diagnosis_reads_a_member_formula_by_its_OWN_lane(monkeypatch):
    """⚰️ `diagnose` called every user formula "not an indicator this chart can
    evaluate" (`value_function` walks the GLOBAL partitions only). A user formula is
    now diagnosed by the user lane: withheld is a fault naming the gate, a raising
    compute is a fault with its message, and a column with no number YET is not."""
    from api.services import indicator_alert_evaluator as ev
    from api.services import indicator_alert_service as ias
    alert = {"indicator": ADDRESS, "sym": "RDDT", "tf": "D", "params_json": "{}", "user_id": "user-b1"}
    bars = _store_bars(RDDT)
    fns = {"fn": aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(T03, stamp("?: true arm (T03)")))}
    monkeypatch.setattr(ev, "_user_value_function", lambda a, b=None: fns["fn"])
    fault, detail = ias.diagnose(alert, bars)
    assert fault is True
    _detail_names_the_gate(detail, "?: true arm (T03)")
    # a guard that throws
    fns["fn"] = aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(T03, _broken_stamp()))
    fault, detail = ias.diagnose(alert, bars)
    assert fault is True and "could not be computed" in detail
    # warming: a 300-bar mean on 60 bars has no number yet -- not a fault
    fns["fn"] = aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(call("sma", CLOSE, num(300))))
    fault, detail = ias.diagnose(alert, _store_bars(RDDT[:60]))
    assert fault is False and "not enough history" in detail
    # ⛔ the CLOSED lane judges the newest closed bar, never the newest number: `up ? close : na`
    # on bars that end on a down bar has no value there, so the alert is quiet this cycle
    monkeypatch.setattr(ev, "eval_mode", lambda: "closed")
    assert RDDT[-1]["c"] < RDDT[-1]["o"] and any(b["c"] > b["o"] for b in RDDT)
    fns["fn"] = aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(op("?:", UP, CLOSE, op("/", num(0), num(0)))))
    fault, detail = ias.diagnose(alert, bars)
    assert fault is False and "not enough history" in detail
    # healthy: no fault, nothing to say
    fns["fn"] = aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(T03))
    assert ias.diagnose(alert, bars) == (False, None)
    # no bars at all is a fault (nothing can be computed), and a compute that RAISES says so
    assert ias.diagnose(alert, []) == (True, "no bars are stored for this symbol and timeframe yet, "
                                              "so nothing can be computed")

    class _Raising:
        reads_symbols = ()

        def withheld(self, *a, **k):
            return None

        def column(self, *a, **k):
            raise RuntimeError("boom")
    fns["fn"] = _Raising()
    assert ias.diagnose(alert, bars) == (True, "RuntimeError: boom")
    # ⭐ L1 — the re-arm refusal of a plot the gates withhold is told in the ARMED words…
    def _refuse_gated(a, b=None):
        raise aus.block_runs_withheld(ADDRESS, "RDDT", CASES["v6 and"]["expected"])
    monkeypatch.setattr(ev, "_user_value_function", _refuse_gated)
    assert ias.diagnose(alert, bars) == (True, aus.withheld_alert_detail(CASES["v6 and"]["expected"]))
    # …and any other arm-time door, re-run on a registry miss, is quoted verbatim
    def _refuse(a, b=None):
        raise aus.AdmissionRefused("withheld", "W")
    monkeypatch.setattr(ev, "_user_value_function", _refuse)
    assert ias.diagnose(alert, bars) == (True, "W [gate:withheld]")
    # 🔴 CONTROL — a builtin address never reaches the user lane
    assert ias._diagnose_user({"indicator": "rsi"}, bars) is None


def test_the_armed_sentence_is_stored_WHOLE_for_the_longest_fixture(alerts):
    """⭐ L1 (review round 2) — `mark_needs_attention` keeps 500 characters. The arm-time
    refusal ran 468-587 on these fixtures and was cut mid-sentence; the armed sentence
    is whole for every one, and the longest is stored exactly as written."""
    ias = alerts
    details = {c["name"]: aus.withheld_alert_detail(c["expected"]) for c in PARITY["cases"] if c["expected"]}
    assert len(details) >= 6
    for name, detail in details.items():
        assert detail.startswith("Withheld: ") and detail.endswith(RESUMES), name
        assert len(detail) <= aus.ALERT_DETAIL_MAX, name
        assert "An alert on it would fire" not in detail, name          # never the arm-time phrasing
    # the shape, pinned once: the gate's head, where it skipped, and the resume clause
    assert details["v6 and"] == (
        "Withheld: `ta.crossover` is called on the right of a Pine v6 `and` (line 4), which runs only on the bars "
        "where its left side is true — on this chart that right side skips bar 1 and runs again on bar 2, so its "
        "calls have not run on every bar. This alert resumes when the value is computable.")
    longest_name = max(details, key=lambda k: len(details[k]))
    longest = details[longest_name]
    aid = ias.create(user_id="user-b1", sym="RDDT", indicator="rsi", condition="above", threshold=70.0, tf="D")
    ias.mark_needs_attention(aid, longest)
    assert ias.get(aid)["state_detail"] == longest
    # 🔴 CONTROL — the arm-time sentence for the same gate does NOT survive the cap
    arm_time = str(aus.block_runs_withheld(ADDRESS, "RDDT", CASES[longest_name]["expected"]))
    assert len(arm_time) > 500
    ias.mark_needs_attention(aid, arm_time)
    assert ias.get(aid)["state_detail"] != arm_time


def test_a_sentence_too_long_for_the_state_is_shortened_at_a_word_and_still_ends_whole():
    why = "`ta.sma` is called in one arm of a `?:` whose test can change from bar to bar (line 4): x" \
          " — and whether the block runs on every bar of this chart could not be computed (" + "word " * 120 + ")"
    detail = aus.withheld_alert_detail(why)
    assert len(detail) <= aus.ALERT_DETAIL_MAX
    assert detail.startswith("Withheld: `ta.sma` is called in one arm of a `?:` whose test can change from bar to bar (line 4) — ")
    assert detail.endswith("… " + RESUMES)


def test_L3_a_fetch_that_handed_back_None_does_not_break_the_gate_check(monkeypatch):
    """⭐ L3 (review round 2) — `run_opts_for` sized the other symbol's read with
    `len(bars)`, and the evaluator's fetch can hand back None."""
    other = op("-", CLOSE, {"type": "sym", "value": "SPY", "args": [CLOSE]})
    fn = aus._make_value_fn("u_b1b1b1b1b1b1", "value", doc(other, stamp("?: true arm (T03)")))
    assert fn.reads_symbols == ("SPY",)
    monkeypatch.setattr(aus, "_symbol_bars", lambda ticker, tf, want: [])
    why = fn.withheld(None, {}, "D")                 # no TypeError: no bars to read is a gate that cannot be read
    assert why is None or isinstance(why, str)


# ═══ 4. arming asks the gates as the alert WILL evaluate (L1) ════════════════

KNOB = stamp("input knob in the guard")
KNOB_TREE = op("?:", KNOB["blockRuns"]["keys"][0]["gates"][0]["guard"], call("ema", CLOSE, num(5)), CLOSE)


def knob_doc(default):
    d = doc(KNOB_TREE, KNOB)
    d["inputs"] = [{"key": "k", "type": "float", "label": "Cut", "default": default}]
    return d


def test_arming_asks_the_gates_with_the_alerts_OWN_params(monkeypatch):
    """⚰️ `arm_for_alert` asked with `{}`: a gate reading a member's input was proven
    at the author's default, in both directions."""
    try:
        # the author's default (-1e9) holds on every bar; the member's k = 0 does not
        _admit_patched(monkeypatch, knob_doc(-1e9))
        aus.forget()
        assert aus.arm_for_alert("user-b1", ADDRESS, "RDDT", "D", bars=RDDT)["addresses"] == [ADDRESS]
        aus.forget()
        with pytest.raises(aus.AdmissionRefused) as exc:
            aus.arm_for_alert("user-b1", ADDRESS, "RDDT", "D", bars=RDDT, params={"k": 0})
        assert exc.value.gate == "withheld"
        assert CASES["?: true arm (T03)"]["expected"].split("(line")[0] not in str(exc.value)   # the knob's own arm
        assert "that arm skips bar 1 and runs again on bar 2" in str(exc.value)
        # …and the reverse: the default varies, the member's value holds on every bar
        _admit_patched(monkeypatch, knob_doc(0))
        aus.forget()
        assert aus.arm_for_alert("user-b1", ADDRESS, "RDDT", "D", bars=RDDT, params={"k": -1e9})["addresses"] == [ADDRESS]
    finally:
        aus.forget()


def test_the_create_path_hands_the_rows_params_to_the_arm(alerts, monkeypatch):
    ias = alerts
    from api.services import indicator_alert_evaluator as ev
    _admit_patched(monkeypatch, knob_doc(-1e9))
    monkeypatch.setattr(ev, "_fetch_bars_for_alert", lambda sym, tf, count=200: _store_bars(RDDT))
    with pytest.raises(aus.AdmissionRefused) as exc:
        ias.create(user_id="user-b1", sym="RDDT", indicator=ADDRESS, condition="below",
                   threshold=-1e12, tf="D", params_json={"k": 0})
    assert exc.value.gate == "withheld"
    assert ias.list_active() == []
    # 🔴 CONTROL — at the default the same create is admitted
    aus.forget()
    assert ias.create(user_id="user-b1", sym="RDDT", indicator=ADDRESS, condition="below",
                      threshold=-1e12, tf="D", params_json={})


def test_the_re_arm_asks_with_the_rows_params_too(alerts, monkeypatch):
    """A registry miss (a restart, or the author saved) re-arms through `arm_for_alert`
    -- with the row's own params, as the arm was."""
    from api.services import indicator_alert_evaluator as ev
    ias = alerts
    _admit_patched(monkeypatch, knob_doc(0))                 # the author's default VARIES on these bars
    monkeypatch.setattr(ev, "_fetch_bars_for_alert", lambda sym, tf, count=200: _store_bars(RDDT))
    aid = ias.create(user_id="user-b1", sym="RDDT", indicator=ADDRESS, condition="below",
                     threshold=-1e12, tf="D", params_json={"k": -1e9})   # the member's holds on every bar
    aus.forget()
    assert aus.value_function_for_alert(ias.get(aid), _store_bars(RDDT)) is not None


# ═══ 5. the screener backtest and the rule record honour the gates (M3) ══════

BT_WINDOW = ("2024-04-01", "2024-12-31")


def _bt_withheld_for(definition):
    from api.routers import screener_backtest as bt
    gates = block_runs.block_runs_for(definition, "value")
    return bt._withheld_for({"definition": definition, "key": "value", "gates": gates}, None)


def test_the_backtest_engine_withholds_a_symbol_by_name_and_counts_it():
    from api.services.screener import backtest as engine
    up_only = [b for b in RDDT if b["c"] > b["o"]]
    data = {"MIXD": RDDT, "UPUP": up_only}
    stamped = doc(V6_AND, stamp("v6 and"))
    run = lambda syms, wf: engine.run_backtest(V6_AND, syms, *BT_WINDOW, bars_for=data.get, horizons=[1],
                                               min_signals=1, **({"withheld_for": wf} if wf else {})).to_dict()
    both = run(["MIXD", "UPUP"], _bt_withheld_for(stamped))
    assert both["coverage"]["symbols_withheld"] == 1
    assert both["coverage"]["symbols_tested"] == 1
    assert both["method"]["withheld"] == {"guard": block_runs.BLOCK_RUNS_GUARD, "symbols": 1,
                                          "reason": CASES["v6 and"]["expected"]}
    # every symbol withheld: the named refusal, with the gate's own sentence
    only = run(["MIXD"], _bt_withheld_for(stamped))
    assert only["backtestable"] is False and only["refused"] == "block_runs"
    assert CASES["v6 and"]["expected"] in only["detail"]
    assert only["coverage"]["symbols_withheld"] == 1
    # 🔴 CONTROL — no gates asked: not a key of the receipt, both symbols tested
    bare = run(["MIXD", "UPUP"], None)
    assert "symbols_withheld" not in bare["coverage"] and "withheld" not in bare["method"]
    assert bare["coverage"]["symbols_tested"] == 2


@pytest.fixture
def bt_route(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener_backtest as bt
    from api.services import bars_sqlite
    from api.services.cache import cache
    from api.services.screener import snapshot_builder
    paid = {"id": "paid-b1", "role": "member", "plan": "pro"}
    cache.delete_prefix("screen_backtest::")
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.clear()
    state = {}

    def build(definition, rows_by_sym):
        stored = {"def_id": "u_b1b1b1b1b1b3", "version": 1, "rev": 1,
                  "ast_hash": user_definitions.ast_hash(definition["compute"]["ast"]), "definition": definition}
        monkeypatch.setattr(user_definitions, "get",
                            lambda user_id, def_id, version=None: dict(stored) if def_id == stored["def_id"] else None)
        monkeypatch.setattr(snapshot_builder, "_load_universe", lambda: list(rows_by_sym))
        monkeypatch.setattr(bars_sqlite, "get_bars_before",
                            lambda sym, tf, want, to_key: list(rows_by_sym.get(sym, []))[:want])
        app = FastAPI()
        app.include_router(bt.router)
        app.dependency_overrides[get_current_user] = lambda: dict(paid)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(paid)
        state["client"] = TestClient(app)
        return state["client"]
    yield build
    cache.delete_prefix("screen_backtest::")
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.clear()


def _store_rows(bars):
    return [(int(str(b["t"]).replace("-", "")), b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]


def test_the_backtest_route_replays_a_stored_definition_WITH_its_gates(bt_route):
    stamped = {"meta": stamp("v6 and"), "compute": {"kind": "ast", "ast": V6_AND, "rev": 1},
               "plots": [{"key": "value"}], "inputs": []}
    window = {"from": BT_WINDOW[0], "to": BT_WINDOW[1]}
    client = bt_route(stamped, {"MIXD": _store_rows(RDDT)})
    r = client.post("/api/screener/backtest", json={"def_id": "u_b1b1b1b1b1b3", **window})
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["backtestable"] is False and body["refused"] == "block_runs"
    assert "on this chart that right side skips bar" in body["detail"]
    assert body["coverage"]["symbols_withheld"] == 1
    assert "_block_runs" not in json.dumps(body)              # the private key never reaches an echo
    # ⛔ the SAME tree posted bare is another job: the two receipts are never served for each other
    bare = client.post("/api/screener/backtest", json={"ast": V6_AND, **window}).json()
    assert bare["job"] != body["job"]
    assert bare.get("refused") != "block_runs" and "symbols_withheld" not in bare["coverage"]


def test_the_rule_record_honours_the_definitions_gates(tmp_path, monkeypatch):
    from api.services import definition_record as dr
    from api.services.signature import ledger
    p = tmp_path / "signal_ledger.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_INITED", False)
    monkeypatch.setattr(dr, "_INITED", set())
    bars = _store_bars(RDDT)
    stamped = doc(V6_AND, stamp("v6 and"))
    out = dr.record_pass(1, "1D", "MIXD", ast=V6_AND, bars=bars, definition=stamped)
    assert out["recorded"] is False and out["evaluated"] == 0
    assert out["skipped"] == f"{block_runs.BLOCK_RUNS_GUARD}: {CASES['v6 and']['expected']}"
    h = user_definitions.ast_hash(V6_AND)
    assert dr.latest_evaluation(h, 1, "1D", "MIXD") is None
    # ⛔ a definition whose gates describe ANOTHER tree is refused, never asked
    with pytest.raises(ValueError, match="not the one this tree is the scan plot of"):
        dr.record_pass(1, "1D", "MIXD", ast=T03, bars=bars, definition=stamped)
    # 🔴 CONTROL — the same pass on bars where the code runs every bar, and with no definition
    assert dr.record_pass(1, "1D", "UPUP", ast=V6_AND, bars=_store_bars(UP_ONLY), definition=stamped)["recorded"] is True
    # (another revision: the record's origin is per revision, and UPUP's pass above set rev 1's)
    assert dr.record_pass(2, "1D", "MIXD", ast=V6_AND, bars=bars)["recorded"] is True
