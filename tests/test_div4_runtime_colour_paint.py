"""DIV-4 -- a host (``ast``) document's paint may read a colour column the per-bar
run computes (``compute.runtimeColours.keys``), the mirror of the client's
``defSchema.validateRuntimeColours`` (``div4RuntimeReadPaint.test.js``)."""

from api.services import presentation_schema as ps


def _doc(kind="ast", keys=("rtcolour1",), paint_col="rtcolour1"):
    return {
        "compute": {"kind": kind, "runtimeColours": {"source": "x", "at": [{}], "keys": list(keys)}},
        "plots": [{"key": "value", "style": "line"}],
        "paints": [{"kind": "barcolor", "line": 3, "colorMode": f"column:{paint_col}", "colorPacked": {}}],
    }


def _paint_errors(doc):
    return [e for e in ps.presentation_errors(doc) if e["path"].startswith("paints")]


def test_a_declared_run_colour_column_is_a_column_a_paint_may_name():
    assert _paint_errors(_doc()) == []


def test_an_undeclared_one_is_refused_and_so_is_one_on_a_non_ast_document():
    assert _paint_errors(_doc(keys=("rtcolourX",)))
    assert _paint_errors(_doc(kind="runtime"))


def test_control_without_runtime_colours_the_paint_is_refused():
    doc = _doc()
    del doc["compute"]["runtimeColours"]
    assert _paint_errors(doc)
