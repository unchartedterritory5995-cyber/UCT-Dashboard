"""UCT RS split, unit U6: the row ↔ JS diff rails for the three new chart
definitions (`RS_RATING_RAW`, `RS_PHASES_RAW`, `RS_VS_EMA_RAW` in
`app/src/components/chart/engine/nativeRegistry.js`), the
`test_rs_columns_provider.py` pattern applied to `registry_defs.RS_SPLIT_DEFS`.

Parsed from the source text the way the rsLine rails parse it. What is railed:

* `compute` (kind / fn / rev), `version` and `meta.requiresServer` on each;
* `meta.serverInputs` equals the Python row's input keys, in the row's order;
* every input the row declares is declared on the JS side with the same
  default, range, enum options and string rule; the two ratio definitions
  share the benchmark pair through `rsSplitBenchmarkInputs()`;
* every non-guide plot is a wire column of the row, and every wire column is
  a plot;
* every `scalar:` path the definition reads (readout, paneTable,
  legendFallback, the shared benchmark and history rows) is in
  `RS_SPLIT_CONTRACT`, and the JS copy of that contract
  (`__tests__/rsSplitContract.json`) is byte-equal in content.
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

from api.services.signature import registry_defs as rd
from tests.test_rs_split_rows import RS_SPLIT_CONTRACT, SPLIT_IDS

ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "nativeRegistry.js"
JS_CONTRACT = ROOT / "app" / "src" / "components" / "chart" / "engine" / "__tests__" / "rsSplitContract.json"

RAW_NAMES = {"rsRating": "RS_RATING_RAW", "rsPhases": "RS_PHASES_RAW", "rsVsEma": "RS_VS_EMA_RAW",
             "rsExit": "RS_EXIT_RAW"}

#: 2026-11-12 (RS Exit Warnings): the one definition with presentation SWITCHES. Each toggles a dot
#: through `plots[].activeWhen` (the slim RS line's `showAverage` rule): the server never hears of them,
#: so they are not row inputs, and they are the only bool inputs an RS split definition may add.
PRESENTATION_TOGGLES = {"rsExit": {"showQuick", "showQuicksand", "showDead"}}


def _src() -> str:
    return JS.read_text(encoding="utf-8").replace("\r\n", "\n")


def _block(start: str, src: str | None = None) -> str:
    """The source from `start` to the first line that is exactly `}` or `])`."""
    src = src or _src()
    assert src.count(start) == 1, start
    body = src.split(start, 1)[1]
    end = re.search(r"\n(\}|\]\)|\))\n", body)
    assert end, start
    return body[: end.start()]


def _raw(def_id: str) -> str:
    return _block(f"const {RAW_NAMES[def_id]} = {{")


def _no_prose(block: str) -> str:
    block = "\n".join(line for line in block.split("\n") if not line.lstrip().startswith("//"))
    return re.sub(r"(?:tooltip|hint|placeholder|description|what|origin|evidence|note):\s*'(?:[^'\\]|\\.)*'", "", block)


def _inputs(block: str) -> dict:
    """`{key: {type, default, min, max, options, pattern, maxLength, case}}` out of
    a text block of input entries (the rsLine parser's grammar)."""
    block = _no_prose(block)
    out: dict = {}
    # Entries start a line with `{` at any indentation (the shared benchmark pair
    # sits two spaces in, a definition's own inputs four).
    for entry in re.split(r"\n\s*\{", block)[1:]:
        key = re.search(r"\bkey:\s*'([A-Za-z]+)'", entry)
        if not key:
            continue
        spec: dict = {"type": re.search(r"\btype:\s*'([a-z]+)'", entry).group(1)}
        dflt = re.search(r"\bdefault:\s*('[^']*'|true|false|-?\d+(?:\.\d+)?)", entry)
        if dflt:
            raw = dflt.group(1)
            spec["default"] = raw.strip("'") if raw.startswith("'") else (raw == "true" if raw in ("true", "false") else float(raw))
        for bound in ("min", "max"):
            m = re.search(rf"\b{bound}:\s*(-?\d+(?:\.\d+)?)", entry)
            if m:
                spec[bound] = float(m.group(1))
        if spec["type"] == "enum":
            spec["options"] = re.findall(r"\['([A-Za-z_]+)',", entry)
        if spec["type"] == "string":
            pat = re.search(r"\bpattern:\s*'((?:[^'\\]|\\.)*)'", entry)
            if pat:
                spec["pattern"] = re.sub(r"\\(.)", r"\1", pat.group(1))
            ml = re.search(r"\bmaxLength:\s*(\d+)", entry)
            if ml:
                spec["maxLength"] = int(ml.group(1))
            case = re.search(r"\bcase:\s*'([a-z]+)'", entry)
            if case:
                spec["case"] = case.group(1)
        out[key.group(1)] = spec
    return out


def _js_inputs(def_id: str) -> dict:
    raw = _raw(def_id)
    body = raw.split("\n  inputs: ", 1)[1].split("\n  plots: [", 1)[0]
    out = {}
    if "rsSplitBenchmarkInputs()" in body:
        out.update(_inputs(_block("const rsSplitBenchmarkInputs = () => ([")))
    out.update(_inputs(body))
    return out


def _row(def_id: str) -> dict:
    return next(d for d in rd.RS_SPLIT_DEFS if d["id"] == def_id)


def _scalar_paths(def_id: str) -> set:
    text = _raw(def_id)
    if "rsSplitBenchmarkRows()" in text:
        text += _block("const rsSplitBenchmarkRows = () => ([")
    if "rsSplitHistoryRow()" in text:
        text += _block("const rsSplitHistoryRow = () => (")
    return set(re.findall(r"'scalar:([A-Za-z0-9_.]+)'", text))


# ── the identity ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("def_id", SPLIT_IDS)
def test_compute_version_and_the_definition_gate_match_the_row(def_id):
    raw = _raw(def_id)
    m = re.search(r"compute: \{ kind: 'server', fn: '(\w+)', rev: (\d+) \}", raw)
    assert m and {"kind": "server", "fn": m.group(1), "rev": int(m.group(2))} == _row(def_id)["compute"]
    assert re.search(r"\n  version: (\d+),", raw).group(1) == str(_row(def_id)["version"])
    assert re.search(r"\n  id: '(\w+)',", raw).group(1) == def_id
    assert "requiresServer: true," in raw.split("\n  placement:", 1)[0], "the definition-level gate (U1)"
    assert re.search(r"placement: \{ target: 'pane', pane: rsSplitPane\(\)", raw), "an own pane with the U3 floor"
    assert "minPx: 64" in _block("const rsSplitPane = () => (")
    assert "presets:" not in raw and "key: 'view'" not in raw, "no presets, no Reading switch (owner decision)"


# ── the inputs ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("def_id", SPLIT_IDS)
def test_server_inputs_are_exactly_the_rows_input_keys_in_order(def_id):
    block = _raw(def_id).split("serverInputs:", 1)[1].split("],", 1)[0]
    js = re.findall(r"'([A-Za-z]+)'", block)
    assert js == RS_SPLIT_CONTRACT[def_id]["inputs"] == [i["key"] for i in _row(def_id)["inputs"]]


@pytest.mark.parametrize("def_id", SPLIT_IDS)
def test_every_row_input_is_declared_on_the_js_side_with_the_rows_rule(def_id):
    js = _js_inputs(def_id)
    for spec in _row(def_id)["inputs"]:
        key = spec["key"]
        assert key in js, f"{def_id}.{key} is a row input the JS definition never declares"
        assert js[key]["type"] == spec["type"], key
        if spec["type"] == "int":
            assert (js[key]["default"], js[key]["min"], js[key]["max"]) == (spec["default"], spec["min"], spec["max"]), key
        elif spec["type"] == "enum":
            assert js[key]["default"] == spec["default"] and js[key]["options"] == spec["options"], key
        elif spec["type"] == "string":
            assert js[key]["default"] == spec["default"], key
            assert js[key]["pattern"] == spec["pattern"] and js[key]["maxLength"] == spec["maxLength"], key
            assert js[key].get("case") == spec.get("case"), key
    # ...and the only JS inputs the row lacks are presentation (Style) ones.
    extra = {k: v for k, v in js.items() if k not in {i["key"] for i in _row(def_id)["inputs"]}}
    toggles = PRESENTATION_TOGGLES.get(def_id, set())
    assert all(v["type"] in ("color", "int") or (v["type"] == "bool" and k in toggles)
               for k, v in extra.items()), extra
    assert set(extra) <= {"color", "lineWidth"} | toggles, extra


def test_the_rating_definition_sends_nothing_and_has_style_inputs_only():
    # The colour is a `colorInput(...)` helper entry (no `key:` of its own, so the
    # parser skips it, as the rsLine rail does); the width is the one keyed input.
    assert _js_inputs("rsRating").keys() == {"lineWidth"}
    assert "colorInput('color', 'Line colour', RS_INFO)" in _raw("rsRating")
    assert "serverInputs: []" in _raw("rsRating")


# ── the plots and the wire ────────────────────────────────────────────────────

@pytest.mark.parametrize("def_id", SPLIT_IDS)
def test_every_data_plot_is_a_wire_column_and_every_wire_column_a_plot(def_id):
    plots = _no_prose(_raw(def_id).split("\n  plots: [", 1)[1].split("\n  ],", 1)[0])
    keys = re.findall(r"\{ key: '(\w+)', label: '[^']*', style: '(\w+)'", plots)
    data = [k for k, style in keys if style != "hlines"]
    assert sorted(data) == sorted(RS_SPLIT_CONTRACT[def_id]["columns"]) == sorted(_row(def_id)["columns"])


def test_the_phases_paint_reads_the_hidden_phase_column():
    raw = _raw("rsPhases")
    assert re.search(r"\{ key: 'phase', label: 'Phase', style: 'line', hidden: true", raw)
    assert "kind: 'bgcolor', colorMode: 'column:phase', colorPalette: [RS_BEAR, RS_INFO], opacity: 0.18" in raw


# ── the scalar paths ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("def_id", SPLIT_IDS)
def test_every_scalar_path_the_definition_reads_is_in_the_contract(def_id):
    paths = _scalar_paths(def_id)
    assert paths, "a definition that reads no scalar makes this vacuous"
    assert paths <= set(RS_SPLIT_CONTRACT[def_id]["paths"]), paths - set(RS_SPLIT_CONTRACT[def_id]["paths"])


def test_the_js_contract_copy_is_the_python_contract():
    js = json.loads(JS_CONTRACT.read_text(encoding="utf-8"))
    js.pop("_comment", None)
    assert js == RS_SPLIT_CONTRACT


def test_member_copy_is_plain_english():
    """Every string literal the definition carries (names, labels, tooltips, the
    cards): no trade words, and RS never spelled as RSI (whole word; the field
    name `schemaVersion` is not member copy)."""
    for def_id in SPLIT_IDS:
        # `meta.tags` are SEARCH TERMS the member types, never printed (2026-11-12: `rsExit` carries
        # `sell` and `trim` there so a search for either finds it); every printed string is scanned.
        raw = re.sub(r"tags:\s*\[[^\]]*\],", "", _raw(def_id))
        strings = " ".join(re.findall(r"'((?:[^'\\]|\\.)*)'", raw)).lower()
        for banned in (r"\bbuy\b", r"\bsell\b", r"\brsi\b"):
            assert not re.search(banned, strings), (def_id, banned)
