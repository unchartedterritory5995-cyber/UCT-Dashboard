"""DIV-4 -- a host (``ast``) document's PAINT may read a colour column the per-bar
run computes (``compute.runtimeColours.keys``): the server mirror of the client's
``defSchema.validateRuntimeColours`` (``div4RuntimeReadPaint.test.js``), rule for rule."""

from api.services import presentation_schema as ps

SPEC = {"line": 3, "column": 1, "node": {"type": "name", "name": "c"}, "kind": "colour"}


def _doc(kind="ast", keys=("rtcolour1",), paint_col="rtcolour1", at=None):
    return {
        "compute": {"kind": kind,
                    "runtimeColours": {"source": "x", "at": list(at) if at is not None else [SPEC] * len(keys),
                                       "keys": list(keys)}},
        "plots": [{"key": "value", "style": "line"}],
        "paints": [{"kind": "barcolor", "line": 3, "colorMode": f"column:{paint_col}", "colorPacked": {}}],
    }


def _errors(doc, prefix):
    return [e for e in ps.presentation_errors(doc) if e["path"].startswith(prefix)]


def test_a_declared_run_colour_column_is_a_column_a_paint_may_name():
    assert ps.presentation_errors(_doc()) == []


def test_an_undeclared_one_is_refused():
    assert _errors(_doc(keys=("rtcolourX",)), "paints")


def test_only_an_ast_definition_carries_it():
    doc = _doc(kind="runtime")
    assert _errors(doc, "compute.runtimeColours")
    assert _errors(doc, "paints")


def test_a_key_that_is_a_plot_key_is_refused():
    doc = _doc(keys=("value",), paint_col="value")
    assert [e["path"] for e in _errors(doc, "compute.runtimeColours")] == ["compute.runtimeColours.keys[0]"]


def test_a_value_that_is_not_a_colour_at_a_statement_is_refused():
    doc = _doc(at=[{**SPEC, "kind": "num"}])
    assert [e["path"] for e in _errors(doc, "compute.runtimeColours")] == ["compute.runtimeColours.at[0]"]
    assert _errors(doc, "paints")


def test_a_plot_may_not_name_a_run_colour_column():
    doc = _doc()
    doc["plots"][0]["colorMode"] = "column:rtcolour1"
    doc["plots"][0]["colorPacked"] = {}
    assert _errors(doc, "plots[0]")


def test_control_without_runtime_colours_the_paint_is_refused():
    doc = _doc()
    del doc["compute"]["runtimeColours"]
    assert _errors(doc, "paints")
