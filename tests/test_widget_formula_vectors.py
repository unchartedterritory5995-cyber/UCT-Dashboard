"""Task 10.2: the server's widget formula dialect, held to the SHARED vector file.

`tests/fixtures/widgetFormulaVectors.json` is the one authority on how the dialect answers. The
client twin (Task 10.3, `lib/widgetFormula/widgetFormula.js`) reads the same file with a file
read, so the two are held to one set of answers rather than to each other. Every expected value
in it was worked by hand from the rules; none was recorded from this module.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from api.services.journal_two import widget_formula as wf

VECTORS = Path(__file__).resolve().parent / "fixtures" / "widgetFormulaVectors.json"
DOC = json.loads(VECTORS.read_text(encoding="utf-8"))

_SPECIAL = {"nan": math.nan, "inf": math.inf, "-inf": -math.inf}


def decode(v):
    """Rows may carry {"$float": "nan" | "inf" | "-inf"}: strict JSON has no such literals."""
    if isinstance(v, dict):
        if set(v) == {"$float"}:
            return _SPECIAL[v["$float"]]
        return {k: decode(x) for k, x in v.items()}
    if isinstance(v, list):
        return [decode(x) for x in v]
    return v


def build(entry) -> str:
    if "build" in entry:
        return "".join(text * times for text, times in entry["build"])
    return entry["expr"]


def fields_of(doc=DOC) -> dict[str, wf.FieldInfo]:
    return {f["key"]: wf.FieldInfo(f["key"], f["label"], f["type"], f["hour_key"], f["needs_times"])
            for f in doc["fields"]}


FIELDS = fields_of()


def rows_of(spec):
    return decode(DOC["rowsets"][spec] if isinstance(spec, str) else spec)


def same(got, expect) -> bool:
    if expect is None:
        return got is None
    if isinstance(expect, bool) or isinstance(got, bool):
        return type(got) is bool and type(expect) is bool and got == expect
    if isinstance(expect, (int, float)):
        if not (isinstance(got, float) and math.isfinite(got)):
            return False
        if expect == 0:
            # +0 only: a -0 answer is a defect even though -0.0 == 0 (the twin uses Object.is).
            return got == 0 and math.copysign(1.0, got) == 1.0
        return math.isclose(got, expect, rel_tol=1e-9, abs_tol=1e-9)
    return got == expect


def _ids(entries, key="expr"):
    return [f"{i}:{(e.get(key) or e.get('name') or '')[:40]!r}" for i, e in enumerate(entries)]


@pytest.mark.parametrize("v", DOC["compile"], ids=_ids(DOC["compile"]))
def test_compile_vectors(v):
    c = wf.compile_formula(v["expr"], FIELDS)
    got = {"canonical": c.canonical, "display": wf.display(c.canonical, FIELDS), "kind": c.kind,
           "type": c.type, "fields": list(c.fields), "needs_times": c.needs_times,
           "bucket_labels": list(c.bucket_labels) if c.bucket_labels is not None else None}
    want = {k: v[k] for k in got}
    assert got == want
    # A canonical formula is itself a formula that compiles to the same canonical text.
    assert wf.compile_formula(c.canonical, FIELDS).canonical == c.canonical


@pytest.mark.parametrize("v", DOC["eval_row"], ids=_ids(DOC["eval_row"]))
def test_eval_row_vectors(v):
    c = wf.compile_formula(v["expr"], FIELDS)
    assert c.kind == "row"
    got = wf.eval_row(c, decode(v["row"]))
    assert same(got, v["expect"]), (got, v["expect"])


@pytest.mark.parametrize("v", DOC["eval_group"], ids=_ids(DOC["eval_group"]))
def test_eval_group_vectors(v):
    c = wf.compile_formula(v["expr"], FIELDS)
    assert c.kind == "aggregate"
    got = wf.eval_group(c, rows_of(v["rows"]))
    assert same(got, v["expect"]), (got, v["expect"])


@pytest.mark.parametrize("v", DOC["errors"], ids=_ids(DOC["errors"]))
def test_error_vectors_code_sentence_pos(v):
    with pytest.raises(wf.FormulaError) as ei:
        wf.compile_formula(build(v), FIELDS)
    e = ei.value
    assert (e.code, e.sentence, e.pos) == (v["code"], v["sentence"], v["pos"])
    assert str(e) == e.sentence and e.formula_id is None


def test_every_error_code_has_a_vector():
    seen = {v["code"] for v in DOC["errors"]}
    assert seen == set(wf.ERRORS), set(wf.ERRORS) ^ seen


@pytest.mark.parametrize("v", DOC["limits"], ids=_ids(DOC["limits"], "name"))
def test_limit_vectors(v):
    expr = build(v)
    if v["ok"]:
        c = wf.compile_formula(expr, FIELDS)
        assert same(wf.eval_row(c, {}), v["value"])
    else:
        with pytest.raises(wf.FormulaError) as ei:
            wf.compile_formula(expr, FIELDS)
        assert (ei.value.code, ei.value.pos) == (v["code"], v["pos"])


def test_limit_vectors_sit_on_both_sides_of_each_edge():
    """Non-vacuity: the limit cases really are at the edge (one passes, the next fails)."""
    by = {v["name"]: v for v in DOC["limits"]}
    assert len(build(by["length 2000 passes"])) == wf.MAX_LENGTH
    assert len(build(by["length 2001 fails"])) == wf.MAX_LENGTH + 1
    assert build(by["depth 32 passes"]).count("(") == wf.MAX_DEPTH
    assert build(by["depth 33 fails"]).count("(") == wf.MAX_DEPTH + 1
    assert len(wf._tokenize(build(by["500 tokens pass"]))) == wf.MAX_TOKENS
    assert len(build(by["501 tokens fail"])) == wf.MAX_TOKENS + 1  # one character per token


def test_the_file_carries_this_modules_constants_and_copy():
    """The twin reads its copy from the file, so the file must agree with the server's."""
    assert DOC["version"] == 1
    for name, value in DOC["constants"].items():
        assert getattr(wf, name) == value, name
    assert DOC["functions"] == list(wf.FUNCTIONS)
    assert DOC["function_docs"] == list(wf.FUNCTION_DOCS)
    assert DOC["arity_words"] == wf.ARITY_WORDS
    assert DOC["error_templates"] == wf.ERRORS


def test_the_comparator_refuses_negative_zero():
    """Control for the zero rule: -0.0 is not an answer for an expected 0."""
    assert same(0.0, 0) and not same(-0.0, 0) and not same(-0.0, 0.0)
    assert not same(False, 0) and not same(1e-12, 0)


@pytest.mark.parametrize("v", DOC["empty_field"], ids=_ids(DOC["empty_field"]))
def test_empty_field_vectors(v):
    c = wf.compile_formula(v["expr"], FIELDS)
    assert wf.empty_field_of(c, decode(v["row"])) == v["expect"]


@pytest.mark.parametrize("v", DOC["display_cases"], ids=_ids(DOC["display_cases"], "name"))
def test_display_case_vectors(v):
    fields = fields_of({"fields": v["fields"]})
    shown = wf.display(v["canonical"], fields)
    assert shown == v["display"]
    shown.encode("utf-8")  # always encodable
    try:
        c = wf.compile_formula(v["canonical"], fields)
    except wf.FormulaError:
        return  # a stored text that no longer compiles: display returned it as stored
    assert wf.compile_formula(shown, fields).canonical == c.canonical


def test_display_names_round_trip_over_the_vector_field_table():
    """Every field of the shared table, shown by its display name, resolves back to itself."""
    usable = {k: f for k, f in FIELDS.items() if f.type != "tag"}
    for key, fi in usable.items():
        name = wf.display_name(fi, FIELDS)
        assert name == fi.label  # the table has no collisions, so every label is shown
        c = wf.compile_formula(f"[{key}] = [{key}]", usable)
        shown = wf.display(c.canonical, FIELDS)
        assert wf.compile_formula(shown, usable).canonical == c.canonical


@pytest.mark.parametrize("v", DOC["skip_notice"], ids=[str(v[:2]) for v in DOC["skip_notice"]])
def test_skip_notice_vectors(v):
    n, label, one, many, expect = v
    assert wf.skip_notice(n, label, one, many) == expect


def test_vector_file_is_strict_json_lf_and_large_enough():
    raw = VECTORS.read_bytes()
    assert b"\r" not in raw and raw.endswith(b"\n")
    json.loads(raw, parse_constant=lambda c: pytest.fail(f"non-strict JSON constant {c}"))
    assert len(DOC["compile"]) >= 40
    assert len(DOC["eval_row"]) >= 50
    assert len(DOC["eval_group"]) >= 25
    assert len(DOC["hostile"]) >= 40


# ---------------------------------------------------------------------------------------------
# Non-vacuity: every function and every operator is exercised by at least two vectors, counted
# from the TOKENS of each vector (so a name inside a text literal, or a field called "If", does
# not count).

OPERATORS = ("+", "-", "unary -", "*", "/", "=", "<>", "<", "<=", ">", ">=")


def _appearances(entries):
    counts = {name: 0 for name in (*wf.FUNCTIONS, *OPERATORS)}
    for v in entries:
        toks = wf._tokenize(build(v))
        seen = set()
        for i, t in enumerate(toks):
            if t.kind == "name":
                seen.add(wf._FOLDED_FUNCTIONS[wf._fold(t.text)])
            elif t.kind == "op":
                prev = toks[i - 1] if i else None
                unary = t.text == "-" and (prev is None or prev.kind in ("op", "(", ","))
                seen.add("unary -" if unary else t.text)
        for name in seen:
            counts[name] += 1
    return counts


def test_every_function_and_operator_has_two_vectors():
    evaluated = DOC["eval_row"] + DOC["eval_group"]
    for section, entries in (("evaluated", evaluated), ("compile", DOC["compile"])):
        counts = _appearances(entries)
        thin = {k: n for k, n in counts.items() if n < 2}
        assert not thin, f"{section}: {thin}"


def test_the_appearance_counter_can_see_a_gap():
    """Control: the counter is not answering 'enough' for everything."""
    counts = _appearances([{"expr": "Abs(1)"}, {"expr": "\"Round(1)\""}, {"expr": "-1 - 2"}])
    assert counts["Abs"] == 1 and counts["Round"] == 0 and counts["Hour"] == 0
    assert counts["unary -"] == 1 and counts["-"] == 1
