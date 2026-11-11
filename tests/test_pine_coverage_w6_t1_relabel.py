"""W6 T1 - the W6 guards whose label is not what is behind them get a tag, and `rt_wave` re-waves them.

W6-BREAKDOWN section 0, finding 3 (branch `docs/pine-w6-breakdown`): `pine:collection`, `pine:type` and
`pine:member` counted scripts as W6 (collections, types) whose wall is something else. Tooling only:
no wall LABEL and no engine output changes; `coverage_map.py` reads each step's detail together with the
script's unpeeled source, and `targets.py::rt_wave` answers by the tag.

  * `ltf-array`  an array "nothing in this script creates", bound by `request.security_lower_tf` -> W7;
  * `tuple`      a bare bracket list (Pine has no array literal: a tuple value)               -> W4;
  * `library`    a `pine:type` / `pine:member` head that is an import alias or a library's value -> W8;
  * `footprint`  the same on a `footprint` / `volume_row` value (`request.footprint`)         -> W7.

Every fixture below is written for this rail (no licence-held source).
"""
from __future__ import annotations

import importlib.util
import json
import os

from tools.pine_coverage import coverage_map as cm

_TARGETS = os.path.join(os.path.dirname(cm.__file__), "w0", "targets.py")
_spec = importlib.util.spec_from_file_location("w0_targets_w6t1_under_test", _TARGETS)
targets = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(targets)

NOTHING = ("an array, a matrix or a map is outside the expression grammar this engine runs — "
           "`%s` is read as an array here and nothing in this script creates it, so the engine cannot tell what it holds")
TYPE_MSG = "a user-defined type is outside the node shapes this engine stores — `%s`"
MEMBER_MSG = "reading a member off the result of an expression needs the type of that result"


def _step(guard, text="x = 0", token=None, message=""):
    return {"attached": False, "refusals": [], "guard": None,
            "rtProbe": {"guard": guard, "agrees": True, "line": 9, "text": text, "token": token, "message": message},
            "runtimeDeclined": {"code": guard, "why": guard + " — " + message}}


def _steps(step, src):
    return cm.runtime_wall_steps({"steps": [step, {"attached": True}]}, src)


def _wave(step, src, order_strategy=False):
    [(g, tags)] = _steps(step, src)
    return targets.rt_wave(g, tags, order_strategy)


LTF_TUPLE_SRC = """//@version=6
indicator("ltf")
[upVols, dnVols]
     = request.security_lower_tf(syminfo.tickerid, "1", [close > open ? volume : 0, close < open ? volume : 0])
plot(array.sum(upVols) - array.sum(dnVols))
"""
LTF_ONE_SRC = """//@version=6
indicator("ltf")
float[] intra = request.security_lower_tf(syminfo.tickerid, "1", close)
plot(array.size(intra))
"""
NOT_LTF_SRC = """//@version=6
indicator("not ltf")
// upVols = request.security_lower_tf(syminfo.tickerid, "1", volume)   <- a comment binds nothing
s = "upVols = request.security_lower_tf("
upVols = request.security(syminfo.tickerid, "D", close)
plot(array.sum(upVols))
"""


# ---- ltf-array ----------------------------------------------------------------------------------

def test_an_array_the_peel_orphaned_from_a_lower_timeframe_tuple_is_w7():
    st = _step("pine:collection", "plot(array.sum(upVols) - array.sum(dnVols))", "array.sum", NOTHING % "upVols")
    assert _steps(st, LTF_TUPLE_SRC) == [("pine:collection", [cm.TAG_LTF_ARRAY])]
    assert _wave(st, LTF_TUPLE_SRC) == "W7"


def test_a_single_typed_lower_timeframe_binding_is_w7():
    st = _step("pine:collection", "plot(array.size(intra))", "array.size", NOTHING % "intra")
    assert _wave(st, LTF_ONE_SRC) == "W7"


def test_an_orphan_array_not_bound_by_security_lower_tf_stays_w6():
    st = _step("pine:collection", "plot(array.sum(upVols))", "array.sum", NOTHING % "upVols")
    assert _steps(st, NOT_LTF_SRC) == [("pine:collection", [])]       # comments and strings bind nothing
    assert _wave(st, NOT_LTF_SRC) == "W6"


def test_an_ltf_bound_name_without_the_orphan_detail_stays_w6():
    # the array is created and the refusal is about something else: a real collection wall
    st = _step("pine:collection", "plot(array.sum(upVols))", "array.sum",
               "an array, a matrix or a map is outside the expression grammar this engine runs")
    assert _wave(st, LTF_TUPLE_SRC) == "W6"


# ---- tuple -------------------------------------------------------------------------------------

def test_a_bare_bracket_list_is_a_tuple_value_w4_and_not_a_collection():
    st = _step("pine:collection", "        [inBar]   ", "[", "an array, a matrix or a map is outside the expression grammar")
    assert _steps(st, "//@version=5\nindicator('t')\n") == [("pine:collection", [cm.TAG_TUPLE])]
    assert _wave(st, None) == "W4"                    # the tuple reads the step alone, no source needed
    assert _wave(st, None, order_strategy=True) == "W4"


def test_an_indexed_or_called_bracket_is_not_a_tuple():
    for text in ("x = arr[0]", "[a, b] = f(x)", "plot(array.sum(v))", "[a[1]]"):
        st = _step("pine:collection", text, "[")
        assert _wave(st, None) == "W6", text


# ---- library -----------------------------------------------------------------------------------

LIB_SRC = """//@version=6
strategy("lib", overlay=true)
import someone/chrono_utils/7 as chr
import someone/drawlib/3
var dateWin = chr.DateTimeWindow.new().init(fromDateTime = 0)
chr.DateTimeWindow typed = na
drawn = drawlib.makeBox(high, low)
local = array.new<float>()
"""


def test_a_member_off_an_import_alias_chain_is_w8():
    st = _step("pine:member", "var dateWin = chr.DateTimeWindow.new().init(", "init", MEMBER_MSG)
    assert _steps(st, LIB_SRC) == [("pine:member", [cm.TAG_LIBRARY])]
    assert _wave(st, LIB_SRC) == "W8"


def test_a_type_read_off_a_value_a_library_built_is_w8():
    for tok in ("dateWin.is_bar_included", "typed.is_bar_included", "drawn.top"):   # rhs alias, typed decl, default alias
        st = _step("pine:type", "ok = %s()" % tok, tok, TYPE_MSG % tok)
        assert _wave(st, LIB_SRC) == "W8", tok


def test_a_local_collection_in_a_script_that_imports_stays_w6():
    st = _step("pine:type", "n = local.size()", "local.size", TYPE_MSG % "local.size")
    assert _steps(st, LIB_SRC) == [("pine:type", [])]
    assert _wave(st, LIB_SRC) == "W6"
    st = _step("pine:member", "v = local.get(0).field", "field", MEMBER_MSG)
    assert _wave(st, LIB_SRC) == "W6"


def test_without_the_source_no_source_tag_is_set():
    st = _step("pine:member", "var dateWin = chr.DateTimeWindow.new().init(", "init", MEMBER_MSG)
    assert _steps(st, None) == [("pine:member", [])]
    assert cm.runtime_wall_steps({"steps": [st, {"attached": True}]}) == [("pine:member", [])]


# ---- footprint ---------------------------------------------------------------------------------

FP_SRC = """//@version=6
indicator("fp")
useFP = input.bool(true)
footprint reqFP = useFP ? request.footprint(100, 70) : na
fp2 = request.footprint(50, 70)
volume_row pocRow = reqFP.poc()
plot(pocRow.up_price())
"""


def test_a_footprint_value_is_w7():
    # reqFP is the ternary form (`footprint x = c ? request.footprint(..) : na`): only its DECLARED type says footprint
    for tok in ("pocRow.up_price", "reqFP.poc", "fp2.poc"):
        st = _step("pine:type", "plot(%s())" % tok, tok, TYPE_MSG % tok)
        assert _steps(st, FP_SRC) == [("pine:type", [cm.TAG_FOOTPRINT])], tok
        assert _wave(st, FP_SRC) == "W7", tok


# ---- the labels themselves still answer W6 -----------------------------------------------------

def test_untagged_w6_guards_are_still_w6():
    for g in ("pine:collection", "pine:type", "pine:member"):
        assert targets.rt_wave(g) == "W6"
        assert targets.rt_wave(g, [cm.TAG_FOR_IN]) == "W6"       # another wall's tag does not move it


# ---- end to end: the map's tags carry each script's own source facts ---------------------------

def test_the_runtime_on_section_reads_each_scripts_own_source(tmp_path):
    srcs = {"committed:ltf": LTF_TUPLE_SRC, "committed:plain": NOT_LTF_SRC}
    inputs = {}
    for k, s in srcs.items():
        p = tmp_path / (k.split(":")[1] + ".pine")
        p.write_text(s, encoding="utf-8")
        inputs[k] = {"key": k, "path": str(p)}
    with open(tmp_path / "census.jsonl", "w", encoding="utf-8") as f:
        for k in srcs:
            st = _step("pine:collection", "plot(array.sum(upVols))", "array.sum", NOTHING % "upVols")
            f.write(json.dumps({"key": k, "lane": cm.LANE_RUNTIME_ON, "steps": [st], "reachedAfterPeel": True}) + "\n")
    scripts = [{"key": k, "population": "committed", "clean": False} for k in srcs]
    out = cm.runtime_on_section(str(tmp_path), None, None, scripts, None, lambda k: False, cm.norm_src, inputs, len(scripts))
    assert out["walls"]["tags"] == {"committed:ltf": {"pine:collection": [cm.TAG_LTF_ARRAY]}}
