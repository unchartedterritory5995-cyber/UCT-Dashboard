"""The language-coverage scoreboard's RULES, on a tiny invented reference.

`tools/pine_coverage/language_coverage.py` joins what two lanes' doors answered to TradingView's Pine v6
reference and says, per item and lane, EXACT / SUPPORTED-UNPROVEN / REFUSED / MISSING / UNANSWERED. The
numbers it prints are only as honest as five rules, and each has a test here that a mutation of the
rule turns red:

  1. EXACT needs proof (a fully compared MATCH capture, or an every-bar rail on a published formula)
     and is withheld by a declared difference; acceptance alone is SUPPORTED, never EXACT;
  2. a capture credits the RUNTIME lane only when the runtime lane drew it, and only when every output
     was compared and agreed;
  3. a refusal blames an item only when it is ATTRIBUTABLE (its token, or the probe's own line), and a
     name-unknown guard is MISSING while any other guard is REFUSED;
  4. an order-placing strategy credits no `strategy.*` item, and a host script that is not drawn whole
     credits nothing;
  5. a rail counts toward EXACT only when it compares every bar AND the reference itself publishes the
     formula; every other rail is only a definition rail.

The reference below is INVENTED (names only): the real one is licence-held and never committed.
"""
from __future__ import annotations

import argparse
import json
import os

import pytest

from tools.pine_coverage import language_coverage as lc

ANCHOR = "THE-ANCHOR-STRING-A-RAIL-CITES"

REF = {
    "functions": [
        {"name": "ta.sma", "examples": ["pine_sma(x, y) =>\n    1\nplot(pine_sma(close, 3))"]},
        {"name": "ta.ema", "desc": "The value is calculated as a weighted average."},
        {"name": "ta.zzz", "desc": "Does something."},
        {"name": "time", "desc": "The time function."},
        {"name": "array.push", "desc": "Appends."},
        {"name": "array.new_float", "desc": "A new array."},
        {"name": "request.security", "desc": "Requests."},
        {"name": "strategy.entry", "desc": "Orders."},
        {"name": "plot", "desc": "Plots."},
    ],
    "variables": [{"name": "time"}, {"name": "close"}, {"name": "volume"}],
    "constants": [{"name": "color.red"}],
    "types": [],
    "keywords": [{"name": "if"}, {"name": "for"}],
    "annotations": [{"name": "@description"}],
    "operators": [{"name": "+"}, {"name": "%"}, {"name": ":="}, {"name": "=>"}],
    "methods": [{"name": "push", "originalName": "array.push"}],
}


def loaded():
    items = lc.reference_items(REF)
    inv = lc.cm.Inventory(REF)
    return items, inv, lc.name_kinds_of(items)


def formulas_of(items):
    return {it: lc.published_formula(m) for it, m in items.items()}


# ── the vocabulary ───────────────────────────────────────────────────────────
def test_one_item_per_kind_per_name_and_methods_are_their_own_kind():
    items, _inv, _nk = loaded()
    assert ("function", "time") in items and ("variable", "time") in items       # two items, one name
    assert ("method", "array.push") in items and ("function", "array.push") in items
    assert items[("method", "array.push")]["namespace"] == "array"


def test_a_published_formula_is_read_off_the_reference_never_invented():
    items, _inv, _nk = loaded()
    f = formulas_of(items)
    assert f[("function", "ta.sma")] == "implementation"      # a pine_sma reimplementation in the examples
    assert f[("function", "ta.ema")] == "stated"              # the text states the calculation
    assert f[("function", "ta.zzz")] is None
    assert f[("variable", "close")] is None


def test_a_script_uses_the_function_and_the_variable_of_one_name_apart():
    _items, inv, _nk = loaded()
    uses, _feat = lc.item_uses("//@version=6\nindicator('t')\nx = time\nplot(x)\n", inv)
    assert ("variable", "time") in uses and ("function", "time") not in uses
    uses, _feat = lc.item_uses("//@version=6\nindicator('t')\nplot(time('D'))\n", inv)
    assert ("function", "time") in uses and ("variable", "time") not in uses


def test_the_method_call_form_is_a_method_use_and_the_namespace_form_is_not():
    _items, inv, _nk = loaded()
    method, _f = lc.item_uses("//@version=6\nindicator('t')\na = array.new_float(0)\na.push(1.0)\nplot(close)\n", inv)
    direct, _f = lc.item_uses("//@version=6\nindicator('t')\na = array.new_float(0)\narray.push(a, 1.0)\nplot(close)\n", inv)
    assert ("method", "array.push") in method and ("function", "array.push") not in method
    assert ("function", "array.push") in direct and ("method", "array.push") not in direct


def test_an_annotation_is_read_from_the_comment_and_a_name_in_a_comment_is_not_a_use():
    _items, inv, _nk = loaded()
    uses, _f = lc.item_uses("//@version=6\n//@description a thing\nindicator('t')\n// ta.zzz is not used\nplot(close)\n", inv)
    assert ("annotation", "@description") in uses
    assert ("function", "ta.zzz") not in uses


# ── rule 1: EXACT needs proof, and a declared difference withholds it ────────
def test_acceptance_alone_is_supported_never_exact():
    ev = lc.Evidence()
    it = ("function", "ta.sma")
    ev.accept[it]["host"].append(("sample", "s1"))
    assert lc.lane_record(ev, it, "host")["status"] == lc.SUPPORTED


def test_a_vendor_match_makes_it_exact_in_that_lane_only():
    ev = lc.Evidence()
    it = ("function", "ta.sma")
    ev.accept[it]["host"].append(("sample", "s1"))
    ev.add_vendor(it, "host", "cap1", True, "d1")
    assert lc.lane_record(ev, it, "host")["status"] == lc.EXACT
    assert lc.lane_record(ev, it, "runtime")["status"] == lc.UNANSWERED


def test_exact_needs_a_door_acceptance_in_this_run_whatever_a_capture_or_rail_says():
    it = ("function", "ta.sma")
    ev = lc.Evidence()
    ev.add_vendor(it, "host", "cap1", True, "d1")                          # a capture credits it, no door ever accepted it
    ev.refuse[it]["host"].append(("sample", "pine:collection", "k"))        # and every ask refused it
    rec = lc.lane_record(ev, it, "host")
    assert rec["status"] == lc.SUPPORTED and rec["evidence"]["noDoorAcceptance"] is True
    ev2 = lc.Evidence()
    ev2.rails[it]["host"].append("some-rail")
    assert lc.lane_record(ev2, it, "host")["status"] == lc.SUPPORTED          # a rail alone is no door acceptance either


def test_a_declared_difference_keeps_a_matched_item_at_supported():
    ev = lc.Evidence()
    it = ("function", "ta.sma")
    ev.accept[it]["host"].append(("sample", "s1"))
    ev.add_vendor(it, "host", "cap1", True, "d1")
    ev.diffs[it]["host"].append("some-difference")
    rec = lc.lane_record(ev, it, "host")
    assert rec["status"] == lc.SUPPORTED and rec["knownDifference"] == ["some-difference"]


def test_a_definition_rail_never_lifts_an_item():
    ev = lc.Evidence()
    it = ("function", "ta.sma")
    ev.accept[it]["host"].append(("sample", "s1"))
    ev.defrails[it]["host"].append("only-a-definition")
    rec = lc.lane_record(ev, it, "host")
    assert rec["status"] == lc.SUPPORTED and rec["evidence"]["definitionRails"] == ["only-a-definition"]


# ── rule 3: attributable refusals, MISSING versus REFUSED ────────────────────
def test_a_name_unknown_guard_is_missing_and_any_other_guard_is_refused():
    ev = lc.Evidence()
    a, b = ("function", "ta.zzz"), ("function", "array.push")
    ev.refuse[a]["host"].append(("sample", "pine:function", "s1"))
    ev.refuse[b]["host"].append(("sample", "pine:collection", "s2"))
    assert lc.lane_record(ev, a, "host")["status"] == lc.MISSING
    rec = lc.lane_record(ev, b, "host")
    assert rec["status"] == lc.REFUSED and rec["guard"] == "pine:collection"


def test_an_item_accepted_somewhere_and_refused_elsewhere_is_partial_and_keeps_its_best_status():
    ev = lc.Evidence()
    it = ("function", "request.security")
    ev.accept[it]["host"].append(("sample", "s1"))
    ev.refuse[it]["host"].append(("sample", "pine:request", "s2"))
    rec = lc.lane_record(ev, it, "host")
    assert rec["status"] == lc.SUPPORTED and rec["partial"] is True and rec["refusedAs"] == {"pine:request": 1}


def test_no_attributable_answer_is_unanswered_not_missing():
    assert lc.lane_record(lc.Evidence(), ("function", "ta.zzz"), "runtime")["status"] == lc.UNANSWERED


def test_a_refusal_token_resolves_to_the_item_it_names_and_a_user_function_to_none():
    _items, inv, nk = loaded()
    assert lc.resolve_token("ta.zzz", 6, "pine:function", inv, nk) == ("function", "ta.zzz")
    assert lc.resolve_token("my_own_helper", 6, "pine:function", inv, nk) is None
    assert lc.resolve_token("time", 6, "pine:builtin", inv, nk) == ("variable", "time")
    assert lc.resolve_token("time", 6, "pine:function", inv, nk) == ("function", "time")


# ── rule 4: what a script that a lane drew whole may credit ──────────────────
CLEAN = {"host": {"clean": True, "attached": True}, "runtime": {"ok": True, "requests": 0}}


def test_a_script_drawn_whole_credits_every_item_it_uses_in_that_lane():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    lc.ingest_script(ev, CLEAN, "//@version=6\nindicator('t')\nplot(ta.sma(close, 3))\n", inv, nk, "sample", "k1")
    for lane in ("host", "runtime"):
        assert ev.accept[("function", "ta.sma")][lane] == [("sample", "k1")]


def test_a_script_not_drawn_whole_credits_nothing():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    row = {"host": {"clean": False, "attached": True, "refusals": []}, "runtime": {"ok": False, "guard": "runtime:loop"}}
    lc.ingest_script(ev, row, "//@version=6\nindicator('t')\nplot(ta.sma(close, 3))\n", inv, nk, "sample", "k1")
    assert not ev.accept


def test_an_order_placing_strategy_credits_no_strategy_item_but_its_plots_still_count():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    src = "//@version=6\nstrategy('t')\nstrategy.entry('l', strategy.long)\nplot(ta.sma(close, 3))\n"
    lc.ingest_script(ev, CLEAN, src, inv, nk, "sample", "k1")
    assert ("function", "strategy.entry") not in ev.accept
    assert ("function", "ta.sma") in ev.accept


def test_a_refusal_whose_token_is_an_item_blames_that_item_in_that_lane():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    row = {"host": {"clean": False, "attached": False,
                    "refusals": [{"guard": "pine:function", "token": "ta.zzz", "line": 3}]},
           "runtime": {"ok": False, "guard": "runtime:unbound", "token": "ta.zzz"}}
    lc.ingest_script(ev, row, "//@version=6\nindicator('t')\nplot(ta.zzz(close))\n", inv, nk, "sample", "k1")
    assert ev.refuse[("function", "ta.zzz")]["host"] == [("sample", "pine:function", "k1")]
    assert ev.refuse[("function", "ta.zzz")]["runtime"] == [("sample", "runtime:unbound", "k1")]
    assert lc.lane_record(ev, ("function", "ta.zzz"), "runtime")["status"] == lc.MISSING


def test_the_runtime_lane_declining_a_request_for_other_bars_blames_request_security_only():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    row = {"host": {"clean": False, "attached": False, "refusals": []},
           "runtime": {"ok": True, "requests": 1}, "runtimeOwn": {"ok": False, "guard": "runtime:object-op"}}
    src = "//@version=6\nindicator('t')\nplot(request.security('SPY', 'D', close))\n"
    lc.ingest_script(ev, row, src, inv, nk, "sample", "k1")
    assert ("function", "request.security") in ev.refuse and ("function", "plot") not in ev.accept
    assert ev.refuse[("function", "request.security")]["runtime"] == [("sample", "runtime:request", "k1")]


# ── rule 2: which captures credit which lane ─────────────────────────────────
def _capture(tmp_path, name, text, shape="harness"):
    p = tmp_path / (name + ".json")
    body = {"source": {"text": text}} if shape == "harness" else {"script": {"source": text}}
    p.write_text(json.dumps(body), encoding="utf-8")
    return str(p)


def _result(path, cid, verdict="MATCH", not_compared=0, not_measured=0, fmt="harness-v1"):
    return {"file": path, "id": cid, "verdict": verdict, "notCompared": not_compared, "notMeasured": not_measured,
            "format": fmt}


def _ids(entries):
    return [c for c, _subject, _digest in entries]


def test_only_a_fully_compared_match_credits_its_items(tmp_path):
    _items, inv, _nk = loaded()
    src = "//@version=6\nindicator('t')\nplot(ta.sma(close, 3))\n"
    good = _capture(tmp_path, "good", src)
    ev = lc.Evidence()
    n = lc.ingest_vendor(ev, {"results": [
        _result(_capture(tmp_path, "a", src), "a", verdict="DIVERGE"),
        _result(_capture(tmp_path, "b", src), "b", verdict="INCONCLUSIVE"),
        _result(_capture(tmp_path, "c", src), "c", not_compared=1),
        _result(_capture(tmp_path, "d", src), "d", not_measured=2),
        _result(good, "good")]}, "host", inv)
    assert n == 1
    assert _ids(ev.vendor[("function", "ta.sma")]["host"]) == ["good"]


def test_the_runtime_lane_is_credited_only_by_a_capture_the_runtime_lane_drew(tmp_path):
    _items, inv, _nk = loaded()
    src = "//@version=6\nindicator('t')\nplot(ta.sma(close, 3))\n"
    by_host, by_runtime = _capture(tmp_path, "h", src), _capture(tmp_path, "r", src, shape="observation")
    verdicts = {"results": [_result(by_host, "h"), _result(by_runtime, "r")]}
    lanes = {by_host: "host", by_runtime: "runtime"}
    ev = lc.Evidence()
    lc.ingest_vendor(ev, verdicts, "runtime", inv, lanes)
    assert _ids(ev.vendor[("function", "ta.sma")]["runtime"]) == ["r"]
    ev2 = lc.Evidence()
    lc.ingest_vendor(ev2, verdicts, "runtime", inv, {})       # no lane map: nothing may be assumed
    assert not ev2.vendor


def test_a_capture_never_credits_an_order_alert_or_log_item(tmp_path):
    _items, inv, _nk = loaded()
    src = "//@version=6\nstrategy('t')\nplot(strategy.entry('l', strategy.long))\n"      # an order inside a compared plot
    ev = lc.Evidence()
    lc.ingest_vendor(ev, {"results": [_result(_capture(tmp_path, "s", src), "s")]}, "host", inv)
    assert ("function", "strategy.entry") not in ev.vendor and ("function", "plot") in ev.vendor


# ── rule 5: which rails count ────────────────────────────────────────────────
def _reg(**over):
    rail = {"id": "r1", "lane": "host", "test": "tests/test_language_coverage.py", "anchor": ANCHOR,
            "oracle": "reference-formula", "scope": "every-bar", "items": [["function", "ta.sma"]]}
    rail.update(over)
    return {"rails": [rail], "knownDifferences": []}


def test_an_every_bar_rail_on_a_published_formula_counts():
    items, _inv, _nk = loaded()
    ev = lc.Evidence()
    ev.accept[("function", "ta.sma")]["host"].append(("sample", "s1"))
    assert lc.ingest_registry(ev, _reg(), items, formulas_of(items)) == []
    assert ev.rails[("function", "ta.sma")]["host"] == ["r1"]
    assert lc.lane_record(ev, ("function", "ta.sma"), "host")["status"] == lc.EXACT


@pytest.mark.parametrize("over,item", [
    ({"scope": "single-bar"}, ["function", "ta.sma"]),            # one bar is not a series
    ({}, ["function", "ta.zzz"]),                                  # the reference publishes no formula for it
    ({"oracle": "definition"}, ["function", "ta.sma"]),            # not a reference formula at all
])
def test_every_other_rail_is_only_a_definition_rail(over, item):
    items, _inv, _nk = loaded()
    ev = lc.Evidence()
    assert lc.ingest_registry(ev, _reg(items=[item], **over), items, formulas_of(items)) == []
    assert not ev.rails and ev.defrails[tuple(item)]["host"] == ["r1"]


def test_a_registry_that_cites_what_does_not_exist_is_refused():
    items, _inv, _nk = loaded()
    f = formulas_of(items)
    assert lc.ingest_registry(lc.Evidence(), _reg(test="tests/no_such_test.py"), items, f)
    assert lc.ingest_registry(lc.Evidence(), _reg(anchor="ABSENT-" + "ANCHOR"), items, f)
    assert lc.ingest_registry(lc.Evidence(), _reg(items=[["function", "ta.not_in_reference"]]), items, f)
    reg = {"rails": [], "knownDifferences": [{"id": "d", "lanes": ["host"], "items": [["function", "ta.sma"]],
                                               "source": {"divergence": "no-such-row"}}]}
    assert lc.ingest_registry(lc.Evidence(), reg, items, f, {"rows": []})


def test_a_known_difference_is_carried_to_the_lanes_it_names_only():
    items, _inv, _nk = loaded()
    reg = {"rails": [], "knownDifferences": [
        {"id": "d1", "lanes": ["host"], "items": [["variable", "volume"]], "source": {"divergence": "row1"}}]}
    ev = lc.Evidence()
    div = {"rows": [{"id": "row1", "status": "open"}]}
    assert lc.ingest_registry(ev, reg, items, formulas_of(items), div) == []
    assert ev.diffs[("variable", "volume")]["host"] == ["d1"] and "runtime" not in ev.diffs[("variable", "volume")]


# ── rule 3 again, for a probe: only its own item, only an attributable refusal ──
PROBE = {"key": "probe:function:array.push#0", "kind": "function", "name": "array.push", "target_lines": [4]}


def test_a_refusal_on_a_probes_set_up_line_blames_nothing():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    row = {"host": {"clean": False, "refusals": [{"guard": "pine:collection", "token": "array.new_float", "line": 3}]},
           "runtime": {"ok": False, "guard": "runtime:array", "token": "array.new_float", "line": 3}}
    lc.ingest_probe(ev, row, PROBE, inv, nk)
    assert not ev.refuse and not ev.accept


def test_a_refusal_on_the_probes_own_line_or_naming_its_item_blames_it():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    row = {"host": {"clean": False, "refusals": [{"guard": "pine:collection", "token": "a", "line": 4}]},
           "runtime": {"ok": False, "guard": "runtime:array", "token": "array.push", "line": 9}}
    lc.ingest_probe(ev, row, PROBE, inv, nk)
    it = ("function", "array.push")
    assert ev.refuse[it]["host"] == [("probe", "pine:collection", PROBE["key"])]
    assert ev.refuse[it]["runtime"] == [("probe", "runtime:array", PROBE["key"])]


def test_an_accepted_probe_credits_only_its_item():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    lc.ingest_probe(ev, CLEAN, PROBE, inv, nk)
    assert list(ev.accept) == [("function", "array.push")]


# ── the engine door ──────────────────────────────────────────────────────────
def test_a_reached_engine_function_is_the_reference_function_of_the_same_short_name():
    items, _inv, _nk = loaded()
    ev = lc.Evidence()
    lc.ingest_engine_door(ev, [{"name": "sma", "pine": "reachable"}, {"name": "ema", "pine": "call-unmapped"},
                               {"name": "accum", "pine": "reachable"}], "host", items)
    assert list(ev.accept) == [("function", "ta.sma")]


# ── the whole build: determinism and the shape of the answer ─────────────────
def _build(tmp_path, out_name):
    script = tmp_path / "s.pine"
    script.write_text("//@version=6\nindicator('t')\nplot(ta.sma(close, 3))\n", encoding="utf-8")
    cap = _capture(tmp_path, "cap", "//@version=6\nindicator('t')\nplot(ta.sma(close, 3), title = \"p\")\n")
    files = {
        "ref": REF, "cov": {"measuredOn": "x", "masterSha": "y", "headline": {"sample": 1},
                            "inventory": {"items": [{"name": "ta.sma", "scriptsUsing": 7}]}},
        "inputs": [{"key": "committed:s", "path": str(script)}],
        "verdicts": {"results": [_result(cap, "cap", fmt="observation")]},
        "registry": {"rails": [], "knownDifferences": []},
    }
    paths = {}
    for k, v in files.items():
        paths[k] = str(tmp_path / (k + ".json"))
        with open(paths[k], "w", encoding="utf-8") as f:
            json.dump(v, f)
    rows = tmp_path / "rows.jsonl"
    rows.write_text(json.dumps({"key": "committed:s", **CLEAN}) + "\n", encoding="utf-8")
    ns = argparse.Namespace(ref=paths["ref"], coverage_map=paths["cov"], inputs=paths["inputs"], door_answers=[str(rows)],
                            probes=None, probe_answers=[], engine_door=None, engine_door_runtime=None,
                            verdicts=paths["verdicts"], runtime_verdicts=None, capture_lanes=None,
                            registry=paths["registry"], divergences=None, measured_on="2026-11-02",
                            master_sha="abc", out=str(tmp_path / out_name), md=str(tmp_path / (out_name + ".md")))
    lc.cmd_build(ns)
    return ns


def test_the_build_is_deterministic_and_says_what_it_rests_on(tmp_path):
    a = _build(tmp_path, "a.json")
    b = _build(tmp_path, "b.json")
    assert open(a.out, "rb").read() == open(b.out, "rb").read()
    assert open(a.md, "rb").read() == open(b.md, "rb").read()
    out = json.load(open(a.out, encoding="utf-8"))
    sma = next(i for i in out["items"] if i["name"] == "ta.sma" and i["kind"] == "function")
    assert sma["usage"] == 7 and sma["publishedFormula"] == "implementation"
    assert sma["host"]["status"] == lc.EXACT                     # drawn whole AND a fully compared MATCH capture
    assert sma["runtime"]["status"] == lc.SUPPORTED              # drawn whole, no capture the runtime lane drew
    assert out["headline"]["items"] == len(out["items"])
    for lane in lc.LANES:
        assert sum(out["headline"]["byLane"][lane].values()) == out["headline"]["items"]
    assert out["inputs"]["captures"]["host"]["fullMatchesCredited"] == 1


def test_a_missing_door_answer_stops_the_build_rather_than_reading_as_unanswered(tmp_path):
    ns = _build(tmp_path, "a.json")
    (tmp_path / "rows.jsonl").write_text("", encoding="utf-8")
    with pytest.raises(SystemExit):
        lc.cmd_build(ns)


# ── the probe planner: the smallest program that uses ONE item as the reference spells it ──
def _arg(name, allowed, required=True):
    return {"name": name, "required": required, "allowedTypeIDs": allowed}


PREF = {
    "functions": [
        {"name": "ta.sma", "args": [_arg("source", ["series int", "series float"]), _arg("length", ["series int", "simple int"])],
         "returnedTypes": ["series float"]},
        {"name": "ta.crossover", "args": [_arg("source1", ["series float"]), _arg("source2", ["series float"])],
         "returnedTypes": ["series bool"]},
        {"name": "ta.macd", "args": [_arg("source", ["series float"])], "returnedTypes": ["[series float, series float]"]},
        {"name": "line.new", "args": [_arg("x1", ["series int"])], "returnedTypes": ["series line"]},
        {"name": "ta.stoch", "args": [_arg("source", ["series float"]), _arg("optional_thing", ["series float"], required=False)],
         "returnedTypes": ["series float"]},
        {"name": "strategy.entry", "args": [_arg("id", ["series string"])], "returnedTypes": ["series float"]},
    ],
    "variables": [{"name": "close", "type": "series float"}, {"name": "barstate.isfirst", "type": "series bool"},
                  {"name": "strategy.position_size", "type": "series float"}],
    "constants": [{"name": "color.red", "type": "const color"}, {"name": "math.pi", "type": "const float"},
                  {"name": "location.abovebar", "type": "const string"}, {"name": "plot.style_line", "type": "const plot_style"}],
    "types": [], "keywords": [], "annotations": [], "operators": [], "methods": [],
}


def _plan(ref):
    items = lc.reference_items(ref)
    consts = lc._const_by_type(ref)
    return {it: lc.plan_probe(m, consts) for it, m in items.items()}


def test_a_function_probe_spells_the_required_arguments_from_their_reference_types():
    plan = _plan(PREF)
    assert plan[("function", "ta.sma")][0]["lines"] == ["plot(ta.sma(close, 14))"]
    assert plan[("function", "ta.crossover")][0]["lines"] == ["plot(ta.crossover(close, close) ? 1 : 0)"]
    assert plan[("function", "ta.stoch")][0]["lines"] == ["plot(ta.stoch(close))"]          # an optional argument is not asked for


def test_what_needs_a_handle_or_a_tuple_or_the_wrong_script_kind_is_not_planned():
    plan = _plan(PREF)
    for it in (("function", "line.new"), ("function", "ta.macd"), ("function", "strategy.entry"),
               ("variable", "strategy.position_size"), ("constant", "location.abovebar")):
        assert plan[it] == [], it


def test_variables_and_constants_are_used_the_way_their_type_says():
    plan = _plan(PREF)
    assert plan[("variable", "close")][0]["lines"] == ["plot(close)"]
    assert plan[("variable", "barstate.isfirst")][0]["lines"] == ["plot(barstate.isfirst ? 1 : 0)"]
    assert plan[("constant", "color.red")][0]["lines"] == ["plot(close, color = color.red)"]
    assert plan[("constant", "math.pi")][0]["lines"] == ["plot(close + math.pi)"]       # `plot(math.pi)` is constant-only
    assert plan[("constant", "plot.style_line")][0]["lines"] == ["plot(close, style = plot.style_line)"]


def test_cmd_probes_writes_a_program_whose_target_lines_are_the_items_own(tmp_path):
    ref = tmp_path / "ref.json"
    ref.write_text(json.dumps(PREF), encoding="utf-8")
    out = tmp_path / "probes.json"
    lc.cmd_probes(argparse.Namespace(ref=str(ref), wanted=None, out=str(out)))
    plan = {p["key"]: p for p in json.load(open(out, encoding="utf-8"))}
    p = plan["probe:function:ta.sma#call"]
    lines = p["source"].rstrip("\n").split("\n")
    assert [lines[n - 1] for n in p["target_lines"]] == ["plot(ta.sma(close, 14))"]
    assert lines[0] == "//@version=6" and p["reaches_output"] is True
    wanted = tmp_path / "wanted.json"
    wanted.write_text(json.dumps([["function", "ta.sma"]]), encoding="utf-8")
    lc.cmd_probes(argparse.Namespace(ref=str(ref), wanted=str(wanted), out=str(out)))
    got = json.load(open(out, encoding="utf-8"))
    assert [x["key"] for x in got if not x.get("control")] == ["probe:function:ta.sma#call"]
    assert [x["key"] for x in got if x.get("control")] == ["control:good", "control:unknown-function", "control:unknown-variable"]


def test_a_host_acceptance_of_a_probe_that_feeds_no_output_is_vacuous_and_credits_nothing():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    lc.ingest_probe(ev, CLEAN, {**PROBE, "reaches_output": False}, inv, nk)
    it = ("function", "array.push")
    assert "host" not in ev.accept.get(it, {}) and ev.accept[it]["runtime"] == [("probe", PROBE["key"])]


# ── the instrument's controls: a door that answers everything the same way must stop the run ──
def _controls_plan():
    return {k: {"key": k, "control": True} for k in ("control:good", "control:unknown-function", "control:unknown-variable")}


GOOD_ROW = {"host": {"clean": True}, "runtime": {"ok": True}}
BAD_ROW = {"host": {"clean": False, "refusals": [{"guard": "pine:function"}]}, "runtime": {"ok": False, "guard": "runtime:something"}}


def test_the_controls_pass_when_the_good_script_is_accepted_and_the_unknown_names_refused():
    rows = {"control:good": GOOD_ROW, "control:unknown-function": BAD_ROW, "control:unknown-variable": BAD_ROW}
    unknown = {lane: set(g) for lane, g in lc.NAME_UNKNOWN_GUARDS.items()}
    out = lc.check_controls(_controls_plan(), rows, unknown)
    assert out["control:good"]["hostClean"] and out["control:unknown-function"]["runtimeGuards"] == ["runtime:something"]
    assert "runtime:something" in unknown["runtime"]           # what the lane says to an unknown name IS its MISSING


@pytest.mark.parametrize("which,row", [
    ("control:good", BAD_ROW),                                                              # nothing accepted: everything would read refused
    ("control:unknown-function", GOOD_ROW),                                                 # everything accepted: nothing would read refused
    ("control:unknown-function", {"host": {"clean": False, "refusals": [{"guard": "pine:block"}]},
                                  "runtime": {"ok": False, "guard": "runtime:x"}}),         # refused, but not as an unknown name
    ("control:unknown-variable", GOOD_ROW),                                                 # an unknown VARIABLE accepted by both lanes
    ("control:unknown-function", {"host": BAD_ROW["host"], "runtime": {"ok": True}}),       # the runtime lane alone accepts an unknown name
    ("control:unknown-variable", {"host": {"clean": True}, "runtime": BAD_ROW["runtime"]}), # the host lane alone accepts it
    ("control:unknown-variable", {"host": {"clean": False, "refusals": []}, "runtime": BAD_ROW["runtime"]}),   # refused with no guard named
    ("control:unknown-variable", {"host": BAD_ROW["host"], "runtime": {"ok": False}}),      # the runtime lane refused it with no guard named
])
def test_a_run_whose_controls_disagree_writes_nothing(which, row):
    rows = {"control:good": GOOD_ROW, "control:unknown-function": BAD_ROW, "control:unknown-variable": BAD_ROW}
    rows[which] = row
    with pytest.raises(SystemExit):
        lc.check_controls(_controls_plan(), rows, {lane: set(g) for lane, g in lc.NAME_UNKNOWN_GUARDS.items()})


def test_an_unanswered_control_stops_the_run():
    with pytest.raises(SystemExit):
        lc.check_controls(_controls_plan(), {}, {lane: set(g) for lane, g in lc.NAME_UNKNOWN_GUARDS.items()})


# ── a refusal about LANGUAGE names no builtin; the refused line says which syntax it wrote ──
def _syntax_row(guard, text, rt_guard=None):
    return {"host": {"clean": False, "refusals": [{"guard": guard, "token": None, "line": 3, "text": text}]},
            "runtime": {"ok": False, "guard": rt_guard or "runtime:statement", "line": 3, "text": text}}


def test_a_language_guard_blames_the_syntax_written_on_the_refused_line_and_nothing_else():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    row = _syntax_row("pine:block", "for i = 0 to 3", "runtime:loop")
    lc.ingest_script(ev, row, "//@version=6\nindicator('t')\nfor i = 0 to 3\n    x = 1\nplot(close)\n", inv, nk, "sample", "k")
    assert sorted(ev.refuse) == [("keyword", "for")]                      # not `if`, not `while`, not anything else on the guard's list
    assert ev.refuse[("keyword", "for")]["host"] == [("sample", "pine:block", "k")]
    assert ev.refuse[("keyword", "for")]["runtime"] == [("sample", "runtime:loop", "k")]


def test_a_language_guard_on_a_line_without_that_syntax_blames_nothing():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    lc.ingest_script(ev, _syntax_row("pine:block", "x = ta.sma(close, 3)", "runtime:loop"),
                     "//@version=6\nindicator('t')\nx = ta.sma(close, 3)\nplot(x)\n", inv, nk, "sample", "k")
    assert not ev.refuse


def test_a_guard_the_syntax_table_does_not_know_blames_no_syntax():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    lc.ingest_script(ev, _syntax_row("pine:statement", "for i = 0 to 3"), "//@version=6\nindicator('t')\nplot(close)\n", inv, nk, "sample", "k")
    assert not ev.refuse


def test_a_reassignment_refusal_blames_the_reassignment_operator():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    lc.ingest_script(ev, _syntax_row("pine:reassign", "x := x + 1"), "//@version=6\nindicator('t')\nplot(close)\n", inv, nk, "sample", "k")
    assert ("operator", ":=") in ev.refuse and ("operator", "+") not in ev.refuse


# ── the capture-to-item link is tiered: a subject proves its items, a community script needs company ──
IT = ("function", "ta.sma")


def _community(tmp_path, name, extra=""):
    return _capture(tmp_path, name, "//@version=6\nindicator('%s')\nplot(ta.sma(close, 3))\n%s" % (name, extra))


def _status_after(tmp_path, results):
    ev = lc.Evidence()
    ev.accept[IT]["host"].append(("sample", "s1"))          # a door accepted ta.sma in the run
    _items, inv, _nk = loaded()
    lc.ingest_vendor(ev, {"results": results}, "host", inv)
    return lc.lane_record(ev, IT, "host")


def test_one_community_script_does_not_prove_an_item_it_merely_uses(tmp_path):
    rec = _status_after(tmp_path, [_result(_community(tmp_path, "a"), "a", fmt="harness-v1")])
    assert rec["status"] == lc.SUPPORTED and rec["evidence"]["vendorNotCorroborated"] is True
    assert rec["evidence"]["vendorScripts"] == 1


def test_two_distinct_community_scripts_prove_it(tmp_path):
    rec = _status_after(tmp_path, [_result(_community(tmp_path, "a"), "a", fmt="harness-v1"),
                                   _result(_community(tmp_path, "b"), "b", fmt="harness-v1")])
    assert rec["status"] == lc.EXACT and rec["evidence"]["vendorScripts"] == 2


def test_one_script_captured_on_two_symbols_is_still_one_script(tmp_path):
    same = "//@version=6\nindicator('same')\nplot(ta.sma(close, 3))\n"
    rec = _status_after(tmp_path, [_result(_capture(tmp_path, "rddt", same), "rddt", fmt="harness-v1"),
                                   _result(_capture(tmp_path, "spy", same), "spy", fmt="harness-v1")])
    assert rec["status"] == lc.SUPPORTED and rec["evidence"]["vendorScripts"] == 1


TITLED = "//@version=6\nindicator('t')\nplot(ta.sma(close, 3), title = \"p\")\n"


def test_a_purpose_built_observation_proves_its_items_alone(tmp_path):
    for fmt in ("observation", "probe-rows"):
        rec = _status_after(tmp_path, [_result(_capture(tmp_path, "s" + fmt, TITLED), "s" + fmt, fmt=fmt)])
        assert rec["status"] == lc.EXACT and rec["evidence"]["vendorSubjectCaptures"] == 1


def test_the_runtime_walls_behind_the_first_are_named_from_the_peel_and_never_credit_anything():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    row = {"host": {"clean": False, "attached": False, "refusals": []},
           "runtime": {"ok": False, "guard": "runtime:loop", "token": None, "line": 3, "text": "for i = 0 to 3"},
           "runtimePeel": [{"ok": False, "guard": "runtime:unbound", "token": "ta.zzz", "line": 4, "text": "x = ta.zzz(close)"},
                           {"ok": True, "outputs": 1}]}
    lc.ingest_script(ev, row, "//@version=6\nindicator('t')\nplot(ta.zzz(close))\n", inv, nk, "sample", "k")
    assert ev.refuse[("function", "ta.zzz")]["runtime"] == [("sample", "runtime:unbound", "k")]
    assert ev.refuse[("keyword", "for")]["runtime"] == [("sample", "runtime:loop", "k")]
    assert not ev.accept                                          # a script that is only ok AFTER an edit is not drawn


def test_a_program_the_runtime_fallback_would_decline_for_an_unsettled_na_reading_is_not_credited():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    row = {"host": {"clean": False, "attached": False, "refusals": []},
           "runtime": {"ok": True, "requests": 0, "naTests": 2}, "runtimeOwn": {"ok": False, "guard": "runtime:object-op"}}
    lc.ingest_script(ev, row, "//@version=4\nstudy('t')\nplot(close > open ? 1 : 0)\n", inv, nk, "sample", "k")
    assert not ev.accept and not ev.refuse               # drawn by nothing, and the decline names no item


# ── a purpose-built observation compares ONE plot: only that plot's own items are credited ──
OBS = ("//@version=5\nindicator('uct-parity')\nsma20 = ta.sma(close, 20)\nema20 = ta.ema(close, 20)\n"
       "plot(sma20, title = \"sma20\")\nplot(ema20, title = \"ema20\")\n")


def _observation(tmp_path, name, src=OBS, **kw):
    fmt = kw.pop("fmt", "observation")
    return _result(_capture(tmp_path, name, src, shape="observation"), name, fmt=fmt, **kw)


def test_the_uncompared_plot_of_an_observation_credits_nothing(tmp_path):
    _items, inv, _nk = loaded()
    ev = lc.Evidence()
    r = _observation(tmp_path, "o1", not_compared=[{"ours": "out2", "title": "ema20", "why": "no vendor counterpart"}],
                     not_measured=["colour"])
    assert lc.ingest_vendor(ev, {"results": [r]}, "host", inv) == 1
    assert ("function", "ta.sma") in ev.vendor and ("function", "ta.ema") not in ev.vendor


def test_a_tuple_binding_is_followed_to_the_call_that_made_it(tmp_path):
    _items, inv, _nk = loaded()
    src = ("//@version=5\nindicator('t')\n[a, b] = ta.sma(close, 3)\nplot(a, title = \"a\")\nplot(b, title = \"b\")\n")
    ev = lc.Evidence()
    r = _observation(tmp_path, "o2", src=src, not_compared=[{"title": "b"}])
    lc.ingest_vendor(ev, {"results": [r]}, "host", inv)
    assert ("function", "ta.sma") in ev.vendor


def test_an_observation_with_nothing_unmeasured_but_colour_counts_and_anything_else_does_not(tmp_path):
    _items, inv, _nk = loaded()
    ok, bad = lc.Evidence(), lc.Evidence()
    lc.ingest_vendor(ok, {"results": [_observation(tmp_path, "o3", src=TITLED, not_measured=["colour"])]}, "host", inv)
    lc.ingest_vendor(bad, {"results": [_observation(tmp_path, "o4", src=TITLED, not_measured=["colour", "objects"])]}, "host", inv)
    assert ("function", "ta.sma") in ok.vendor and not bad.vendor


def test_a_plot_without_a_readable_title_cannot_be_told_from_an_uncompared_one(tmp_path):
    _items, inv, _nk = loaded()
    ev = lc.Evidence()
    untitled = "//@version=6\nindicator('t')\nplot(ta.sma(close, 3))\n"
    assert lc.ingest_vendor(ev, {"results": [_observation(tmp_path, "o5", src=untitled)]}, "host", inv) == 0
    assert not ev.vendor


def test_a_native_capture_with_anything_uncompared_credits_nothing_however_it_graded(tmp_path):
    _items, inv, _nk = loaded()
    ev = lc.Evidence()
    src = "//@version=6\nindicator('t')\nplot(ta.sma(close, 3))\n"
    lc.ingest_vendor(ev, {"results": [_result(_capture(tmp_path, "n1", src), "n1", not_compared=1)]}, "host", inv)
    assert not ev.vendor


# ── a native capture credits only what the harness COMPARED ──
def loaded_plus(*function_names):
    ref = dict(REF, functions=REF["functions"] + [{"name": n, "desc": "x"} for n in function_names])
    items = lc.reference_items(ref)
    return items, lc.cm.Inventory(ref), lc.name_kinds_of(items)


def test_a_native_capture_credits_only_the_items_its_compared_plots_reach(tmp_path):
    _items, inv, _nk = loaded_plus("label.new")
    src = ("//@version=6\nindicator('t')\nema3 = ta.ema(close, 3)\nlabel.new(bar_index, close, 'a')\n"
           "plot(ta.sma(close, 3))\n")
    ev = lc.Evidence()
    assert lc.ingest_vendor(ev, {"results": [_result(_capture(tmp_path, "n2", src), "n2")]}, "host", inv) == 1
    assert ("function", "ta.sma") in ev.vendor and ("function", "plot") in ev.vendor
    assert ("function", "ta.ema") not in ev.vendor            # computed, never plotted: nothing compared it
    assert ("function", "label.new") not in ev.vendor          # drawn, but the harness compared only its count and text


OBJ_SRC = "//@version=6\nindicator('t')\nln = line.new(0, 1, 2, 3)\nplot(line.get_price(ln, bar_index))\n"


@pytest.mark.parametrize("reason,credited", [
    ("object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1", False),
    ("neither side draws an object", False),
    (None, False),                                                      # no objects comparison at all
    ("object counts, texts, coordinates and styles agree", True),      # a comparison that DID cover them
])
def test_an_object_item_is_credited_only_by_a_comparison_that_covered_coordinates(tmp_path, reason, credited):
    _items, inv, _nk = loaded_plus("line.new", "line.get_price")
    r = _result(_capture(tmp_path, "obj", OBJ_SRC), "obj")
    if reason:
        r["objects"] = {"reason": reason}
    ev = lc.Evidence()
    lc.ingest_vendor(ev, {"results": [r]}, "host", inv)
    assert ("function", "plot") in ev.vendor
    assert (("function", "line.get_price") in ev.vendor) is credited
    assert (("function", "line.new") in ev.vendor) is credited


def test_a_colour_item_is_credited_only_when_colour_was_measured(tmp_path):
    _items, inv, _nk = loaded_plus("color.r")
    src = "//@version=6\nindicator('t')\nplot(color.r(color.red))\n"
    for not_measured, credited in (([], True), (["colour"], False)):
        ev = lc.Evidence()
        lc.ingest_vendor(ev, {"results": [_result(_capture(tmp_path, "c", src), "c", not_measured=not_measured)]}, "host", inv)
        assert (("function", "color.r") in ev.vendor) is credited
        assert ("function", "plot") in ev.vendor


# ── a script that DIVERGES on any symbol is no witness for the items it uses ──
def test_a_script_that_diverges_on_another_symbol_does_not_corroborate(tmp_path):
    rddt = _capture(tmp_path, "rddt", "//@version=6\nindicator('swing')\nplot(ta.sma(close, 3))\n")
    spy = _capture(tmp_path, "spy", "//@version=6\nindicator('swing')\nplot(ta.sma(close, 3))\n")      # the same script
    other = _community(tmp_path, "other")
    rec = _status_after(tmp_path, [_result(rddt, "rddt"), _result(spy, "spy", verdict="DIVERGE"), _result(other, "other")])
    assert rec["status"] == lc.SUPPORTED and rec["evidence"]["vendorNotCorroborated"] is True
    assert rec["evidence"]["vendorScripts"] == 1 and rec["evidence"]["vendorDivergentScripts"] == 1
    clean = _status_after(tmp_path, [_result(rddt, "rddt"), _result(other, "other")])        # without the divergence
    assert clean["status"] == lc.EXACT


def test_a_purpose_built_capture_of_a_script_that_diverges_elsewhere_proves_nothing(tmp_path):
    ok = _observation(tmp_path, "ok", src=TITLED)
    bad = _observation(tmp_path, "bad", src=TITLED, verdict="DIVERGE")
    rec = _status_after(tmp_path, [ok, bad])
    assert rec["status"] == lc.SUPPORTED and rec["evidence"]["vendorDivergentScripts"] == 1


def test_a_divergence_counts_in_the_lane_that_drew_the_capture_only(tmp_path):
    _items, inv, _nk = loaded()
    src = "//@version=6\nindicator('t')\nplot(ta.sma(close, 3))\n"
    host_drawn = _capture(tmp_path, "hd", src)
    ev = lc.Evidence()
    lc.ingest_vendor(ev, {"results": [_result(host_drawn, "hd", verdict="DIVERGE")]}, "runtime", inv, {host_drawn: "host"})
    assert not ev.diverged
    lc.ingest_vendor(ev, {"results": [_result(host_drawn, "hd", verdict="DIVERGE")]}, "host", inv)
    assert len(ev.diverged["host"]) == 1


# ── a wall-clock timeout is the machine's pace, not the script's limit ──
def test_a_timeout_on_the_main_host_attempt_blames_nothing_and_its_peel_is_not_read():
    _items, inv, nk = loaded()
    row = {"host": {"clean": False, "attached": False,
                    "refusals": [{"guard": "pine:timeout", "token": "ta.zzz", "line": 4, "text": "x = ta.zzz(close)"},
                                 {"guard": "pine:block", "token": "for", "line": 3, "text": "for i = 0 to 3"}]},
           "hostPeel": [{"attached": False, "guard": "pine:builtin",
                         "refusals": [{"guard": "pine:builtin", "token": "time", "line": 5, "text": "y = time"}]}],
           "runtime": {"ok": False, "guard": "runtime:statement", "token": None, "line": None}}
    ev = lc.Evidence()
    lc.ingest_script(ev, row, "//@version=6\nindicator('t')\nplot(ta.zzz(close))\ny = time\n", inv, nk, "sample", "k")
    assert ("function", "ta.zzz") not in ev.refuse                      # the timeout's token is not blamed
    assert ev.refuse[("keyword", "for")]["host"]                       # a real wall in the same ask still is
    assert ("variable", "time") not in ev.refuse                        # nor is the wall the peel found behind it
    assert ev.timedOut["host"] == [("sample", "k")]                     # and the script is recorded as unanswered


def test_a_timeout_on_a_probe_blames_nothing():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    row = {"host": {"clean": False, "refusals": [{"guard": "pine:timeout", "token": "array.push", "line": 4}]},
           "runtime": {"ok": False, "guard": "runtime:array", "token": "array.push", "line": 9}}
    lc.ingest_probe(ev, row, PROBE, inv, nk)
    it = ("function", "array.push")
    assert not ev.refuse[it]["host"] and ev.timedOut["host"] == [("probe", PROBE["key"])]
    assert ev.refuse[it]["runtime"]                                     # the runtime lane has its own wall: untouched
    assert lc.lane_record(ev, it, "host")["status"] == lc.UNANSWERED


# ── the headline's known-difference column and section 4 ──
def test_the_known_difference_column_counts_supported_items_only_and_next_rails_exclude_them():
    items, _inv, _nk = loaded()
    sma, ema = ("function", "ta.sma"), ("function", "ta.ema")
    ev = lc.Evidence()
    ev.diffs[sma]["host"].append("d1")                      # missing in the host lane: not a supported item
    ev.refuse[sma]["host"].append(("sample", "pine:function", "k"))
    ev.diffs[ema]["host"].append("d2")
    ev.accept[ema]["host"].append(("sample", "s"))          # supported, with a declared difference
    sub = {sma: items[sma], ema: items[ema]}
    formulas = {sma: "implementation", ema: "implementation"}
    _recs, head, ranked = lc.build_scoreboard({}, {}, ev, sub, formulas, {}, {})
    assert head["knownDifference"]["host"] == 1
    assert ranked["nextRails"]["host"] == []                # a declared difference is not one rail away from EXACT
    assert [x["name"] for x in ranked["knownDifferences"]] == ["ta.ema"]
    ev.diffs[ema]["host"].clear()
    _recs, _head, ranked = lc.build_scoreboard({}, {}, ev, sub, formulas, {}, {})
    assert [x["name"] for x in ranked["nextRails"]["host"]] == ["ta.ema"]


# ── a probe's output must be able to VARY, and its refusal must be the item's own ──
def test_an_output_that_cannot_vary_is_refused_for_that_and_so_the_planner_makes_it_vary():
    ref = {"functions": [
        {"name": "math.abs", "args": [_arg("number", ["series int", "simple int", "const int"])], "returnedTypes": ["series int"]},
        {"name": "math.abs", "args": [_arg("number", ["series float", "simple float", "const float"])], "returnedTypes": ["series float"]},
        {"name": "timeframe.in_seconds", "args": [_arg("timeframe", ["simple string"])], "returnedTypes": ["simple int"]},
    ], "variables": [{"name": "syminfo.mintick", "type": "simple float"}, {"name": "barstate.isconfirmed", "type": "simple bool"}],
        "constants": [{"name": "hline.style_dashed", "type": "const hline_style"}, {"name": "dayofweek.monday", "type": "const int"}],
        "types": [], "keywords": [], "annotations": [], "operators": [], "methods": []}
    plan = _plan(ref)
    assert plan[("function", "math.abs")][0]["lines"] == ["plot(math.abs(close))"]               # the series-capable overload
    assert plan[("function", "timeframe.in_seconds")][0]["lines"] == ['plot(close + timeframe.in_seconds("D"))']
    assert plan[("variable", "syminfo.mintick")][0]["lines"] == ["plot(close + syminfo.mintick)"]
    assert plan[("variable", "barstate.isconfirmed")][0]["lines"] == ["plot(barstate.isconfirmed ? close : open)"]
    assert plan[("constant", "dayofweek.monday")][0]["lines"] == ["plot(close + dayofweek.monday)"]
    hl = plan[("constant", "hline.style_dashed")][0]
    assert hl["lines"] == ["plot(close)", "hline(0, linestyle = hline.style_dashed)"] and hl["reaches"] is False


def test_the_target_line_of_a_two_line_probe_is_the_line_that_carries_the_item(tmp_path):
    ref = tmp_path / "ref.json"
    ref.write_text(json.dumps({"functions": [], "variables": [], "constants": [{"name": "hline.style_dashed", "type": "const hline_style"}],
                               "types": [], "keywords": [], "annotations": [], "operators": [], "methods": []}), encoding="utf-8")
    out = tmp_path / "p.json"
    lc.cmd_probes(argparse.Namespace(ref=str(ref), wanted=None, out=str(out)))
    p = next(x for x in json.load(open(out, encoding="utf-8")) if not x.get("control"))
    lines = p["source"].rstrip("\n").split("\n")
    assert [lines[n - 1] for n in p["target_lines"]] == ["hline(0, linestyle = hline.style_dashed)"]


def test_a_refusal_naming_another_item_on_the_probes_line_blames_that_wrapper_never_the_probed_item():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    wrapper = ("function", "ta.zzz")
    row = {"host": {"clean": False, "refusals": [{"guard": "pine:function", "token": "ta.zzz", "line": 4}]},
           "runtime": {"ok": False, "guard": "pine:function", "token": "ta.zzz", "line": 4}}
    lc.ingest_probe(ev, row, PROBE, inv, nk)
    assert not ev.refuse and not ev.accept                    # `array.push` is neither blamed nor credited by `ta.zzz`'s refusal


def test_the_host_walls_behind_the_first_are_named_from_the_peel_and_never_credit_anything():
    _items, inv, nk = loaded()
    ev = lc.Evidence()
    row = {"host": {"clean": False, "attached": False, "refusals": [{"guard": "pine:block", "token": "for", "line": 3, "text": "for i = 0 to 3"}]},
           "hostPeel": [{"attached": False, "refusals": [{"guard": "pine:function", "token": "ta.zzz", "line": 4, "text": "x = ta.zzz(close)"}]},
                        {"attached": True, "refusals": []}],
           "runtime": {"ok": False, "guard": "runtime:statement", "token": None, "line": None}}
    lc.ingest_script(ev, row, "//@version=6\nindicator('t')\nplot(ta.zzz(close))\n", inv, nk, "sample", "k")
    assert ev.refuse[("function", "ta.zzz")]["host"] == [("sample", "pine:function", "k")]
    assert ev.refuse[("keyword", "for")]["host"] and not ev.accept     # a script that attaches only AFTER an edit is not drawn


def test_the_host_peel_stops_at_a_wall_clock_timeout_so_a_slow_run_scores_like_a_fast_one():
    _items, inv, nk = loaded()
    row = {"host": {"clean": False, "attached": False, "refusals": [{"guard": "pine:block", "token": "for", "line": 3, "text": "for i = 0 to 3"}]},
           "hostPeel": [{"attached": False, "guard": "pine:function",
                         "refusals": [{"guard": "pine:function", "token": "ta.zzz", "line": 4, "text": "x = ta.zzz(close)"}]},
                        {"attached": False, "guard": "pine:timeout",
                         "refusals": [{"guard": "pine:timeout", "token": None, "line": 4, "text": "x = ta.zzz(close)"}]},
                        {"attached": False, "guard": "pine:builtin",
                         "refusals": [{"guard": "pine:builtin", "token": "time", "line": 5, "text": "y = time"}]}],
           "runtime": {"ok": False, "guard": "runtime:statement", "token": None, "line": None}}
    ev = lc.Evidence()
    lc.ingest_script(ev, row, "//@version=6\nindicator('t')\nplot(ta.zzz(close))\ny = time\n", inv, nk, "sample", "k")
    assert ev.refuse[("function", "ta.zzz")]["host"]                    # the wall before the timeout is read
    assert ("variable", "time") not in ev.refuse                        # the wall behind it is not: the machine's pace chose it


# ── a name that is two kinds of item is told apart by the refused line ──
def test_a_name_that_is_two_kinds_of_item_is_told_apart_by_how_the_refused_line_writes_it():
    _items, inv, nk = loaded()
    assert lc.resolve_token("time", 6, "pine:function", inv, nk, "y = time('D')") == ("function", "time")
    assert lc.resolve_token("time", 6, "pine:function", inv, nk, "x = time") == ("variable", "time")
    assert lc.resolve_token("time", 6, "pine:function", inv, nk) == ("function", "time")        # no line: the old rule
    assert lc.resolve_token("time", 6, "pine:builtin", inv, nk) == ("variable", "time")


def test_a_declaration_that_names_a_type_blames_the_type_and_not_the_cast():
    ref = {"functions": [{"name": "string"}], "types": [{"name": "string"}], "variables": [], "constants": [], "keywords": [],
           "annotations": [], "operators": [], "methods": []}
    items = lc.reference_items(ref)
    inv, nk = lc.cm.Inventory(ref), lc.name_kinds_of(items)
    ev = lc.Evidence()
    row = {"host": {"clean": False, "refusals": []},
           "runtime": {"ok": False, "guard": "pine:function", "token": "string", "line": 3, "text": "var string s = na"}}
    lc.ingest_script(ev, row, "//@version=6\nindicator('t')\nvar string s = na\nplot(close)\n", inv, nk, "sample", "k")
    assert ("type", "string") in ev.refuse and ("function", "string") not in ev.refuse


def test_a_declared_difference_on_an_item_the_lane_does_not_draw_is_not_listed(tmp_path):
    ev = lc.Evidence()
    items, _inv, _nk = loaded()
    ev.diffs[("function", "ta.sma")]["host"].append("d")
    ev.refuse[("function", "ta.sma")]["host"].append(("sample", "pine:function", "k"))
    recs, head, ranked = lc.build_scoreboard({}, {}, ev, {("function", "ta.sma"): items[("function", "ta.sma")]}, {}, {}, {})
    assert ranked["knownDifferences"] == []


# ── usage is counted per ITEM: a name that is two kinds of item is recounted by kind ──
def test_usage_of_a_name_that_is_two_kinds_of_item_is_recounted_by_kind(tmp_path):
    ref = {"functions": [{"name": "time"}, {"name": "ta.sma"}], "variables": [{"name": "time"}], "constants": [], "types": [],
           "keywords": [], "annotations": [], "operators": [], "methods": []}
    files = {"ref": ref, "cov": {"measuredOn": "x", "masterSha": "y", "headline": {"sample": 2},
                                 "inventory": {"items": [{"name": "time", "scriptsUsing": 5}, {"name": "ta.sma", "scriptsUsing": 9}]}},
             "inputs": [], "registry": {"rails": [], "knownDifferences": []}}
    a_src = "//@version=6\nindicator('t')\nplot(time)\n"
    b_src = "//@version=6\nindicator('t')\nplot(time('D'))\nplot(ta.sma(close, 3))\n"
    paths = {}
    for k, v in files.items():
        paths[k] = str(tmp_path / (k + ".json"))
        with open(paths[k], "w", encoding="utf-8") as f:
            json.dump(v, f)
    scripts = []
    for n, src in (("a", a_src), ("b", b_src)):
        sp = tmp_path / (n + ".pine")
        sp.write_text(src, encoding="utf-8")
        scripts.append({"key": "committed:" + n, "path": str(sp)})
    with open(paths["inputs"], "w", encoding="utf-8") as f:
        json.dump(scripts, f)
    rows = tmp_path / "rows.jsonl"
    rows.write_text("".join(json.dumps({"key": s_["key"], **CLEAN}) + "\n" for s_ in scripts), encoding="utf-8")
    ns = argparse.Namespace(ref=paths["ref"], coverage_map=paths["cov"], inputs=paths["inputs"], door_answers=[str(rows)],
                            probes=None, probe_answers=[], engine_door=None, engine_door_runtime=None, verdicts=None,
                            runtime_verdicts=None, capture_lanes=None, registry=paths["registry"], divergences=None,
                            measured_on="d", master_sha="s", out=str(tmp_path / "o.json"), md=None)
    out = lc.cmd_build(ns)
    by = {(i["kind"], i["name"]): i for i in out["items"]}
    assert by[("variable", "time")]["usage"] == 1 and by[("function", "time")]["usage"] == 1   # not the map's 5 for the name
    assert by[("function", "ta.sma")]["usage"] == 9                                           # an unambiguous name keeps the map's count
    assert out["inputs"]["usageCheck"] == {"sameAsCoverageMap": 0, "differs": 1}              # the map says 9, these two scripts say 1
