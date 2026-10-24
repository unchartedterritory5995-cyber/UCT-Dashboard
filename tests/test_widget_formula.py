"""Task 10.2: properties of the widget formula dialect that the shared vectors cannot state
compactly: canonical form and display, key-versus-label resolution, the no-data rules, the
aggregate rules, the bounded group loop, the footnote copy and the function reference."""
from __future__ import annotations

import dataclasses
import json
import math
from pathlib import Path

import pytest

from api.services.journal_two import widget_formula as wf
from api.services.journal_two.widget_engine.plan import PlanError
from tests.test_widget_formula_vectors import DOC, FIELDS, rows_of


def _compile(expr, fields=FIELDS):
    return wf.compile_formula(expr, fields)


def _error(expr, fields=FIELDS) -> wf.FormulaError:
    with pytest.raises(wf.FormulaError) as ei:
        wf.compile_formula(expr, fields)
    return ei.value


def test_canonical_uses_keys_and_title_case():
    assert _compile("[Net P&L]/[risk $]").canonical == "[net]/[risk_dollars]"
    assert _compile("sumif([net], [net] > 0)").canonical == "SumIf([net], [net] > 0)"
    assert _compile("ROUND(abs([R]), 2)").canonical == "Round(Abs([r]), 2)"
    assert _compile("if(true, 1, 2)").canonical == "If(TRUE, 1, 2)"
    # Everything that is not a name, a field or a yes/no stays exactly as typed, trimmed outside.
    assert _compile("  [net]\t*\n 2.50  ").canonical == "[net]\t*\n 2.50"
    assert _compile("\"Sumif [net]\"").canonical == "\"Sumif [net]\""


def test_display_round_trip():
    for v in DOC["compile"]:
        c = _compile(v["expr"])
        shown = wf.display(c.canonical, FIELDS)
        assert _compile(shown).canonical == c.canonical, v["expr"]
    assert wf.display("[net] / [risk_dollars]", FIELDS) == "[Net P&L] / [Risk $]"


def test_display_keeps_an_unknown_key_and_untokenizable_text():
    assert wf.display("[gone] + [net]", FIELDS) == "[gone] + [Net P&L]"
    assert wf.display("[net] & [r]", FIELDS) == "[net] & [r]"
    assert wf.display("\"[net]\"", FIELDS) == "\"[net]\""
    assert wf.display(None, FIELDS) == ""


def test_key_wins_over_label():
    fields = {
        "r": wf.FieldInfo("r", "R multiple", "number"),
        "risk": wf.FieldInfo("risk", "R", "number"),  # its LABEL is another field's key
    }
    c = _compile("[R] + [r multiple]", fields)
    assert c.canonical == "[r] + [r]" and c.fields == ("r",)
    assert _compile("[RISK]", fields).fields == ("risk",)
    # Matching is ASCII-only: a Kelvin sign is not a K.
    assert _error("[K]", {"k": wf.FieldInfo("k", "K", "number")}).code == "unknown_field"


def test_divide_by_zero_is_null_not_inf():
    c = _compile("[net] / [risk_dollars]")
    for den in (0, 0.0, -0.0):
        assert wf.eval_row(c, {"net": 5, "risk_dollars": den}) is None
    assert wf.eval_row(_compile("0 / 0"), {}) is None
    assert wf.eval_row(_compile("[net] * 10"), {"net": 1e308}) is None
    g = _compile("SumIf([net]) / CountIf([net] > 1000)")
    assert wf.eval_group(g, rows_of("book")) is None
    # And the payload of every answer survives strict JSON.
    for v in DOC["eval_row"]:
        json.dumps(wf.eval_row(_compile(v["expr"]), {}), allow_nan=False)


def test_round_half_away_from_zero():
    assert wf.eval_row(_compile("Round(2.5)"), {}) == 3
    assert wf.eval_row(_compile("Round(-2.5)"), {}) == -3
    vector = next(v for v in DOC["eval_row"] if v["expr"] == "Round(1.005, 2)")
    assert wf.eval_row(_compile("Round(1.005, 2)"), {}) == vector["expect"] == 1
    zero = wf.eval_row(_compile("Round(-0.4)"), {})
    assert zero == 0 and math.copysign(1, zero) == 1  # never -0


def test_bucket_labels_and_edges():
    c = _compile("Bucket([r], -1, 0, 1.5)")
    assert c.type == "text"
    assert c.bucket_labels == ("Under -1", "-1 to 0", "0 to 1.5", "1.5 or more")
    expect = {-5: "Under -1", -1: "-1 to 0", -0.5: "-1 to 0", 0: "0 to 1.5", 1.5: "1.5 or more",
              99: "1.5 or more"}
    for r, label in expect.items():
        assert wf.eval_row(c, {"r": r}) == label
    assert wf.eval_row(c, {"r": None}) is None
    # Only a formula that IS one Bucket carries the natural split order.
    assert _compile("If(TRUE, Bucket([r], 0), \"x\")").bucket_labels is None
    assert _compile("(Bucket([r], 0))").bucket_labels == ("Under 0", "0 or more")
    for bad in ("Bucket([r], 1, 1)", "Bucket([r], 2, 1)", "Bucket([r], [net])",
                "Bucket([r], 0.00001, 0.00002)"):
        assert _error(bad).code == "bucket_edges", bad
    assert wf.bucket_labels_for(["5"]) == ("Under 5", "5 or more")


def test_hour_reads_hour_key_and_refuses_without_one():
    c = _compile("Hour([day])")
    assert wf.eval_row(c, {"day": "2026-10-05", "hour_et": 15}) == 15
    assert wf.eval_row(c, {"day": "2026-10-05", "hour_et": None}) is None
    assert wf.eval_row(c, {"day": "2026-10-05"}) is None
    # The hour comes from the field's hour_key, never from the day text.
    assert wf.eval_row(c, {"day": "2026-10-05T15:00:00", "hour_et": 15}) is None
    e = _error("Hour([entry_day])")
    assert (e.code, e.sentence, e.pos) == ("hour_no_time", "Hour needs a time; [Entry day] has none here.", 5)
    other = {"opened": wf.FieldInfo("opened", "Opened", "day", hour_key="opened_hour")}
    assert wf.eval_row(_compile("Hour([opened])", other), {"opened": "2026-01-02", "opened_hour": 4}) == 4


def test_weekday_no_timezone():
    c = _compile("Weekday([day])")
    # Read from the date parts: a day is the day it says, wherever the server is.
    assert wf.eval_row(c, {"day": "2026-11-01"}) == "Sunday"   # US DST ends this day
    assert wf.eval_row(c, {"day": "2026-03-08"}) == "Sunday"   # US DST starts this day
    assert wf.eval_row(c, {"day": "2026-12-31"}) == "Thursday"
    assert wf.eval_row(c, {"day": "2027-01-01"}) == "Friday"
    assert wf.eval_row(c, {"day": "2026-10-05T23:30:00-04:00"}) is None


def test_aggregate_rules():
    e = _error("[net] - SumIf([net])")
    assert e.code == "field_outside_aggregate" and e.pos == 0
    assert "[Net P&L]" in e.sentence
    assert _error("SumIf([net], CountIf([had_stop]) > 0)").code == "nested_aggregate"
    assert _error("CountIf([had_stop]) > 2").code == "aggregate_number"
    assert _error("If(CountIf(TRUE) > 1, \"a\", \"b\")").code == "aggregate_number"
    ok = _compile("SumIf([net], [net] > 0) / Abs(SumIf([net], [net] < 0))")
    assert ok.kind == "aggregate" and ok.type == "number" and ok.fields == ("net",)
    assert _compile("[net] * 2").kind == "row"


def test_share_of_no_rows_is_null():
    c = _compile("Share([had_stop])")
    assert wf.eval_group(c, []) is None
    assert wf.eval_group(c, [{"had_stop": False}]) == 0  # a real zero: there WAS a row
    assert wf.eval_group(_compile("CountIf([had_stop])"), []) is None


def test_sumif_none_matching_is_null():
    rows = rows_of("book")
    assert wf.eval_group(_compile("SumIf([net], [setup] = \"Nope\")"), rows) is None
    assert wf.eval_group(_compile("AvgIf([net], [setup] = \"Nope\")"), rows) is None
    assert wf.eval_group(_compile("SumIf([net])"), [{"net": None}, {}]) is None
    assert wf.eval_group(_compile("SumIf([net], [net] = 0)"), rows) == 0  # matched, summed to 0


def test_check_called_every_256_rows():
    calls = []
    c = _compile("SumIf([net], [net] > 0) + CountIf(TRUE) + AvgIf([r])")
    wf.eval_group(c, [{"net": 1, "r": 1}] * 1000, check=lambda: calls.append(1))
    assert len(calls) == 3  # before rows 256, 512 and 768, however many aggregates there are
    calls.clear()
    wf.eval_group(c, [{"net": 1}] * 256, check=lambda: calls.append(1))
    assert calls == []
    calls.clear()
    wf.eval_group(c, [{"net": 1}] * 257, check=lambda: calls.append(1))
    assert len(calls) == 1


def test_check_can_stop_the_loop():
    class TooLong(Exception):
        pass

    seen = []

    def check():
        seen.append(1)
        raise TooLong

    with pytest.raises(TooLong):
        wf.eval_group(_compile("CountIf(TRUE)"), [{}] * 600, check=check)
    assert seen == [1]


def test_skip_notice_exact():
    assert wf.skip_notice(4, "Risk $", "trade", "trades") == "[Risk $] is empty on 4 trades; those are skipped"
    assert wf.skip_notice(1, "Risk $", "trade", "trades") == "[Risk $] is empty on 1 trade; those are skipped"
    assert wf.skip_notice(4, None, "trade", "trades") == "This formula has no value on 4 trades; those are skipped"
    assert wf.skip_notice(0, "Risk $", "trade", "trades") is None
    assert wf.skip_notice(True, "Risk $", "trade", "trades") is None


def test_function_docs_exact_and_fifteen():
    assert len(wf.FUNCTIONS) == 15 and len(wf.FUNCTION_DOCS) == 15
    assert [d["name"] for d in wf.FUNCTION_DOCS] == list(wf.FUNCTIONS)
    assert set(wf._FN) == set(wf.FUNCTIONS) == set(wf.ARITY) == set(wf.ARITY_WORDS)
    assert all(set(d) == {"name", "usage", "meaning"} for d in wf.FUNCTION_DOCS)
    by = {d["name"]: d for d in wf.FUNCTION_DOCS}
    assert by["If"] == {"name": "If", "usage": "If(condition, then, otherwise)",
                        "meaning": "One value when the condition holds, another when it doesn't."}
    assert by["Bucket"]["meaning"] == ("Puts a number into ranges: under the first edge, between "
                                       "edges, or the last edge or more.")
    assert by["And"]["usage"] == "And(condition, condition, …)"
    assert by["Hour"]["meaning"] == "The ET hour, 0 to 23; empty for trades with dates only."


def test_member_copy_avoids_internal_words():
    words = ("plan", "source", "scope", "definition", "shelf", "token", "parse", "syntax", "AST",
             "null", "NaN", "aggregate", "expression")
    copy = list(wf.ERRORS.values()) + [d["meaning"] for d in wf.FUNCTION_DOCS]
    import re
    for sentence in copy:
        for w in words:
            assert not re.search(r"\b" + w + r"\b", sentence, re.IGNORECASE), (w, sentence)
    assert re.search(r"\bnull\b", "a null value", re.IGNORECASE)  # control: the probe can match


def test_formula_error_is_a_plan_error_with_its_parts():
    e = _error("[net] +")
    assert isinstance(e, PlanError) and isinstance(e, ValueError)
    assert (e.code, e.pos, e.formula_id) == ("unexpected", 7, None)
    assert e.sentence == str(e) == "Something is missing near \"+\"."
    e.formula_id = "f2"  # the plan validator sets it
    assert e.formula_id == "f2"


def test_compiled_is_frozen_and_reports_what_it_reads():
    c = _compile("If([had_stop], [hold minutes] / [r], [hold_minutes])")
    assert c.fields == ("had_stop", "hold_minutes", "r") and c.needs_times is True
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.kind = "aggregate"
    assert _compile("[net]").needs_times is False


def test_empty_field_of_names_the_first_empty_field_in_formula_order():
    c = _compile("[net] / [risk_dollars] + [r]")
    assert wf.empty_field_of(c, {"net": 1, "risk_dollars": None, "r": None}) == "risk_dollars"
    assert wf.empty_field_of(c, {"net": "x", "risk_dollars": 1, "r": 1}) == "net"  # unusable = empty
    assert wf.empty_field_of(c, {"net": 1, "risk_dollars": 1, "r": 1}) is None
    assert wf.empty_field_of(_compile("1 + 1"), {}) is None


def test_eval_row_and_eval_group_refuse_the_wrong_kind():
    with pytest.raises(ValueError):
        wf.eval_row(_compile("CountIf(TRUE)"), {})
    with pytest.raises(ValueError):
        wf.eval_group(_compile("[net]"), [])


def test_results_have_one_python_type_per_formula_type():
    rows = rows_of("book")
    for v in DOC["eval_row"]:
        c = _compile(v["expr"])
        got = wf.eval_row(c, rows[0])
        if got is not None:
            want = {"number": float, "text": str, "bool": bool}[c.type]
            assert type(got) is want, (v["expr"], got)
    for v in DOC["eval_group"]:
        got = wf.eval_group(_compile(v["expr"]), rows)
        assert got is None or type(got) is float


def test_a_separate_dialect_from_the_note_property_language():
    """Spec §16.2: this module neither imports nor edits the note-property formula engine."""
    import ast
    tree = ast.parse(Path(wf.__file__).read_text(encoding="utf-8"))
    imported = {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    imported |= {n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
    assert not any("formula_engine" in m for m in imported), imported
    assert "api.services.journal_two.widget_engine.plan" in imported  # the control: it sees imports
