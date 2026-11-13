"""P2 -- the SERVER half of presentation validation, narrow and by EXISTING primitives.

The browser validator (`app/src/components/chart/engine/defSchema.js`) has
always refused a paint with nothing to draw, a marker the renderer cannot place
and a plot style no renderer has. The server stored whatever it was handed, so a
hand-rolled POST (or any client that skipped `defSchema`) could store an inert
paint -- "validated but inert", the failure the schema exists to prevent (P1
intent report, out-of-scope finding 1).

This module mirrors exactly what `defSchema.js` accepts for:

  * ``plots[].style``   -- PLOT_STYLES, with the RESERVED set refused by name
  * ``plots[].marker``  -- shape / position / size / text, only on a ``markers`` plot
  * ``plots[].colorMode`` and its colour fields (``colorUp``/``colorDown``,
    ``colorPalette``, ``colorGradient``, ``colorPacked``), incl. the
    ``column:<key>`` reference
  * ``paints[]``         -- kind, colour forms, ``column:<key>`` reference,
    opacity / offset / showLast / title / line

⛔ IT IS NEVER STRICTER THAN THE BROWSER. A server that refused what the builder
saves would strand a member at Save; the shared fixture
`tests/fixtures/ast/p2_presentation_schema.json` holds both lanes to the same
answer case by case, and both lanes rail their vocabulary against its `vocab`.
Fields `defSchema` checks that are not listed above (legend, lineStyle, …) are
not checked here -- narrower, never different. A plot's `width` IS checked, for its
ceiling only (`LINE_WIDTH_HARD_MAX`, the browser's `defSchema.LINE_WIDTH_HARD_MAX`).

Every error is ``{path, code, message, fingerprint}``. ``fingerprint`` names the
offending ENTRY (the paint, or the plot's own presentation), so the save door can
tell an error a stored legacy row already carried (recorded, not enforced -- no
migration) from one this save introduces (refused).
"""
from __future__ import annotations

import json
import re
from typing import Any, Mapping

PLOT_STYLES = ("line", "stepline", "histogram", "area", "baseline", "hlines",
               "markers", "band", "candles", "ohlcBars")
#: W4-T13 -- the two styles drawn from FOUR computed columns (`plots[].ohlc`), and the
#: colour parts a document may name for each (`plots[].ohlcColors`); `defSchema.js`
#: `OHLC_DEF_STYLES` / `OHLC_COLOUR_PARTS`, held equal by the shared fixture.
OHLC_DEF_STYLES = ("candles", "ohlcBars")
OHLC_COLOUR_PARTS = {"candles": ("body", "wick", "border"), "ohlcBars": ("body",)}
RESERVED_PLOT_STYLES = ("zones", "bgband", "barcolor", "fill", "cross")
MARKER_SHAPES = ("circle", "square", "arrowUp", "arrowDown")
MARKER_POSITIONS = ("aboveBar", "belowBar", "inBar")
MARKER_SIZE_RANGE = {"min": 0.25, "max": 4}
MARKER_TEXT_MAX = 24
PAINT_KINDS = ("bgcolor", "barcolor")
COLOR_MODES = ("fixed", "sign")

#: The plot fields that are presentation for the fingerprint. A change to any of
#: them makes the plot's presentation "changed" for the legacy rule. ⚠️ `width` is
#: NOT one of them and must not become one: its ceiling (`_check_width`) carries its
#: OWN fingerprint, the plot's key + the width it draws (`_width_fp`).
_PLOT_PRESENTATION = ("style", "marker", "colorMode", "colorUp", "colorDown",
                      "colorPalette", "colorGradient", "colorPacked", "ohlc", "ohlcColors")

_HEX = re.compile(r"^#[0-9a-f]{6}([0-9a-f]{2})?$", re.IGNORECASE)


def _is_str(v: Any) -> bool:
    return isinstance(v, str) and v.strip() != ""


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v \
        and v not in (float("inf"), float("-inf"))


def _is_int(v: Any) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, int):
        return True
    return isinstance(v, float) and v.is_integer()


def _canon(v: Any) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _plot_fp(plot: Mapping[str, Any]) -> str:
    return "plot:" + _canon({"key": plot.get("key"),
                             **{k: plot[k] for k in _PLOT_PRESENTATION if k in plot}})


def _err(out: list, path: str, code: str, message: str, fp: str) -> None:
    out.append({"path": path, "code": code, "message": message, "fingerprint": fp})


#: ⭐ A plot width's sanity ceiling, in px -- `defSchema.LINE_WIDTH_HARD_MAX` in the
#: browser, held to it by `tests/fixtures/line_width_cap.json` (read by both suites).
#: TradingView paints a Pine `linewidth` unclamped (set F: 1..10 is N px), so the door
#: carries a script's own width; `linewidth = 10000` would smear the pane of everyone
#: who installs a shared script.
LINE_WIDTH_HARD_MAX = 50


def _drawn_width(plot: Mapping, inputs: Mapping) -> Any:
    """The width a plot DRAWS: a number, or a `$key` naming an input whose default is
    one (`defSchema.substitute`); anything else is returned as written."""
    w = plot.get("width")
    if isinstance(w, str) and w.startswith("$"):
        spec = inputs.get(w[1:])
        w = spec.get("default") if isinstance(spec, Mapping) else None
    return w


def _over_cap(w: Any) -> bool:
    return _is_num(w) and w > LINE_WIDTH_HARD_MAX


def _width_fp(plot: Mapping, width: Any) -> str:
    """⭐ THE CEILING'S OWN FINGERPRINT: the plot's key + the width it draws -- NOT the
    plot's presentation fingerprint (`_plot_fp`), which does not name `width`. ⚰️ On
    the whole-plot fingerprint a stored over-cap row could RAISE its width (60 ->
    10000) and still read as "kept", and an edit to the same plot's style or colour
    made the untouched width look new and refused the save. Keyed on the drawn width,
    an unchanged over-cap width stays grandfathered whatever else about the plot
    changes, and ANY change to it -- the literal, or the input default it names -- is
    new and refused."""
    return "plot-width:" + _canon({"key": plot.get("key"), "width": width})


def _check_width(plot: Mapping, inputs: Mapping, path: str, out: list) -> None:
    """A plot's drawn width (`_drawn_width`) above the ceiling. Only the ceiling:
    everything else about a width is `defSchema`'s, so this lane is never stricter
    than the browser's validity rules (the browser DRAWS an over-cap stored width at
    the ceiling; this door refuses to let a save introduce one)."""
    w = _drawn_width(plot, inputs)
    if _over_cap(w):
        _err(out, f"{path}.width", "plot-width",
             f"{path}.width: at most {LINE_WIDTH_HARD_MAX} px, got {w!r}", _width_fp(plot, w))


def _inputs_by_key(definition: Mapping) -> dict:
    inputs = definition.get("inputs")
    return {i.get("key"): i for i in inputs if isinstance(i, Mapping) and isinstance(i.get("key"), str)} \
        if isinstance(inputs, list) else {}


def clamp_plot_widths(definition: Any) -> tuple:
    """``(definition, clamped)``: a COPY of a stored document (share install, fork)
    with every plot width above the ceiling brought down TO it -- the width the
    browser draws it at (`defSchema.validatePlot` clamps the same way), so a copy
    never hands a second member a width no UCT door produces. The copier did not
    author it, so the copy is repaired rather than refused. A literal is rewritten;
    a `$key` width clamps its input (`default`, and a `max`/`min` above the ceiling)
    -- the shape the member door builds (`builderInputs.pineLineWidth`: default and
    max at the ceiling). Returns the SAME object and ``[]`` when nothing is over;
    never raises on a malformed document."""
    if not isinstance(definition, Mapping) or not isinstance(definition.get("plots"), list):
        return definition, []
    inputs = _inputs_by_key(definition)
    if not any(isinstance(p, Mapping) and _over_cap(_drawn_width(p, inputs))
               for p in definition["plots"]):
        return definition, []
    doc = json.loads(json.dumps(definition))
    inputs = _inputs_by_key(doc)
    clamped: list = []
    for i, plot in enumerate(doc["plots"]):
        if not isinstance(plot, dict):
            continue
        w = _drawn_width(plot, inputs)
        if not _over_cap(w):
            continue
        ref = plot.get("width")
        if isinstance(ref, str) and ref.startswith("$"):
            spec = inputs[ref[1:]]
            for bound in ("default", "max", "min"):
                if _over_cap(spec.get(bound)):
                    spec[bound] = LINE_WIDTH_HARD_MAX
        else:
            plot["width"] = LINE_WIDTH_HARD_MAX
        clamped.append(f"plots[{i}].width {w!r} -> {LINE_WIDTH_HARD_MAX}")
    return doc, clamped


def _check_marker(plot: Mapping, path: str, fp: str, out: list) -> None:
    if "marker" not in plot:
        return
    m = plot["marker"]
    if not isinstance(m, Mapping):
        _err(out, f"{path}.marker", "marker-shape", f"{path}.marker: expected an object", fp)
        return
    if plot.get("style") != "markers":
        _err(out, f"{path}.marker", "marker-style",
             f"{path}.marker: only a plot with style \"markers\" draws one", fp)
    if m.get("shape") not in MARKER_SHAPES:
        _err(out, f"{path}.marker.shape", "marker-shape",
             f"{path}.marker.shape: expected one of {', '.join(MARKER_SHAPES)}, "
             f"got {m.get('shape')!r}", fp)
    if "position" in m and m.get("position") not in MARKER_POSITIONS:
        _err(out, f"{path}.marker.position", "marker-position",
             f"{path}.marker.position: expected one of {', '.join(MARKER_POSITIONS)}, "
             f"got {m.get('position')!r}", fp)
    if "size" in m:
        s = m.get("size")
        if not _is_num(s) or s < MARKER_SIZE_RANGE["min"] or s > MARKER_SIZE_RANGE["max"]:
            _err(out, f"{path}.marker.size", "marker-size",
                 f"{path}.marker.size: expected a number between "
                 f"{MARKER_SIZE_RANGE['min']} and {MARKER_SIZE_RANGE['max']}", fp)
    if "text" in m:
        t = m.get("text")
        if not isinstance(t, str) or len(t) > MARKER_TEXT_MAX:
            _err(out, f"{path}.marker.text", "marker-text",
                 f"{path}.marker.text: a string of at most {MARKER_TEXT_MAX} characters", fp)


def _check_plot_colour_fields(plot: Mapping, path: str, fp: str, out: list) -> None:
    mode = plot.get("colorMode")
    column_mode = isinstance(mode, str) and mode.startswith("column:")
    if "colorPalette" in plot:
        pal = plot["colorPalette"]
        if not isinstance(pal, list) or len(pal) < 2 or not all(_is_str(c) for c in pal):
            _err(out, f"{path}.colorPalette", "plot-colour-field",
                 f"{path}.colorPalette: expected two or more colour strings", fp)
        elif not column_mode:
            _err(out, f"{path}.colorPalette", "plot-colour-field",
                 f"{path}.colorPalette: a palette is read through a column", fp)
    if "colorGradient" in plot:
        g = plot["colorGradient"]
        hexes = isinstance(g, Mapping) and isinstance(g.get("from"), str) \
            and isinstance(g.get("to"), str) and _HEX.match(g["from"]) and _HEX.match(g["to"])
        if not hexes:
            _err(out, f"{path}.colorGradient", "plot-colour-field",
                 f"{path}.colorGradient: expected {{from, to}} hex colours", fp)
        elif "transparency" in g and not (_is_int(g["transparency"])
                                          and 0 <= g["transparency"] <= 100):
            _err(out, f"{path}.colorGradient.transparency", "plot-colour-field",
                 f"{path}.colorGradient.transparency: expected a whole number 0-100", fp)
        elif not column_mode:
            _err(out, f"{path}.colorGradient", "plot-colour-field",
                 f"{path}.colorGradient: a gradient is read through a column", fp)
    if "colorPacked" in plot:
        p = plot["colorPacked"]
        if not isinstance(p, Mapping):
            _err(out, f"{path}.colorPacked", "plot-colour-field",
                 f"{path}.colorPacked: expected an object", fp)
        elif "transparency" in p and not (_is_int(p["transparency"])
                                          and 0 <= p["transparency"] <= 100):
            _err(out, f"{path}.colorPacked.transparency", "plot-colour-field",
                 f"{path}.colorPacked.transparency: expected a whole number 0-100", fp)
        elif not column_mode:
            _err(out, f"{path}.colorPacked", "plot-colour-field",
                 f"{path}.colorPacked: a computed colour is read through a column", fp)
    for field in ("colorUp", "colorDown"):
        if field in plot and not _is_str(plot[field]):
            _err(out, f"{path}.{field}", "plot-colour-field",
                 f"{path}.{field}: expected a non-empty colour string", fp)


def _check_ohlc(plot: Mapping, path: str, fp: str, columns: set, out: list) -> None:
    """W4-T13: `defSchema.validateOhlc` -- a candles / ohlcBars row names the columns it is
    drawn from (`ohlc` = {open, high, low}; its own column is the close), may name colour
    columns (`ohlcColors`), and no other style may carry either."""
    if plot.get("style") not in OHLC_DEF_STYLES:
        for f in ("ohlc", "ohlcColors"):
            if f in plot:
                _err(out, f"{path}.{f}", "plot-ohlc",
                     f"{path}.{f}: only a \"candles\" or \"ohlcBars\" plot names OHLC columns", fp)
        return

    def ref_ok(v: Any, p: str) -> None:
        if not _is_str(v):
            _err(out, p, "plot-ohlc", f"{p}: expected a plot key", fp)
        elif v == plot.get("key"):
            _err(out, p, "plot-ohlc", f"{p}: the plot's own column is its close; name another", fp)
        elif v not in columns:
            _err(out, p, "plot-ohlc", f"{p}: references a column no plot declares", fp)

    ohlc = plot.get("ohlc")
    if not isinstance(ohlc, Mapping):
        _err(out, f"{path}.ohlc", "plot-ohlc",
             f"{path}.ohlc: style {plot.get('style')!r} requires {{open, high, low}} naming three plot keys", fp)
    else:
        for k in ohlc:
            if k not in ("open", "high", "low"):
                _err(out, f"{path}.ohlc.{k}", "plot-ohlc", f"{path}.ohlc.{k}: unknown part", fp)
        for k in ("open", "high", "low"):
            ref_ok(ohlc.get(k), f"{path}.ohlc.{k}")
    if "ohlcColors" in plot:
        oc = plot["ohlcColors"]
        if not isinstance(oc, Mapping):
            _err(out, f"{path}.ohlcColors", "plot-ohlc", f"{path}.ohlcColors: expected an object", fp)
        else:
            parts = OHLC_COLOUR_PARTS[plot["style"]]
            for k, v in oc.items():
                if k not in parts:
                    _err(out, f"{path}.ohlcColors.{k}", "plot-ohlc",
                         f"{path}.ohlcColors.{k}: unknown part for {plot['style']!r}", fp)
                else:
                    ref_ok(v, f"{path}.ohlcColors.{k}")


def _check_color_mode(plot: Mapping, path: str, fp: str, columns: set, out: list) -> None:
    if "colorMode" not in plot:
        return
    mode = plot["colorMode"]
    p = f"{path}.colorMode"
    if not isinstance(mode, str):
        _err(out, p, "color-mode", f"{p}: expected a string", fp)
        return
    if mode == "sign":
        if not (_is_str(plot.get("colorUp")) and _is_str(plot.get("colorDown"))):
            _err(out, p, "color-mode-colours",
                 f"{p}: colour mode \"sign\" needs both colorUp and colorDown", fp)
        return
    if mode in COLOR_MODES:
        return
    if not mode.startswith("column:"):
        _err(out, p, "color-mode", f"{p}: unknown colour mode {mode!r}", fp)
        return
    col = mode[len("column:"):]
    if col not in columns:
        _err(out, p, "color-mode-column",
             f"{p}: {mode!r} references column {col!r}, which no plot or event declares", fp)
        return
    if "colorPalette" in plot:
        if "colorUp" in plot or "colorDown" in plot or "colorGradient" in plot \
                or "colorPacked" in plot:
            _err(out, p, "color-mode-colours", f"{p}: declare one colour source, not several", fp)
        return
    if "colorPacked" in plot:
        if "colorUp" in plot or "colorDown" in plot or "colorGradient" in plot:
            _err(out, p, "color-mode-colours", f"{p}: declare colorPacked alone", fp)
        return
    if "colorGradient" in plot:
        if "colorUp" in plot or "colorDown" in plot:
            _err(out, p, "color-mode-colours", f"{p}: declare colorGradient OR colorUp/colorDown", fp)
        return
    if not (_is_str(plot.get("colorUp")) and _is_str(plot.get("colorDown"))):
        _err(out, p, "color-mode-colours",
             f"{p}: colour mode {mode!r} needs both colorUp and colorDown "
             "(or a colorPalette, a colorGradient or a colorPacked)", fp)


def _check_paints(paints: Any, columns: set, out: list) -> None:
    if paints is None:
        return
    if not isinstance(paints, list):
        _err(out, "paints", "paint-shape", "paints: expected an array",
             "paints:" + _canon(paints))
        return
    for i, p in enumerate(paints):
        path = f"paints[{i}]"
        fp = "paint:" + _canon(p)
        if not isinstance(p, Mapping):
            _err(out, path, "paint-shape", f"{path}: expected an object", fp)
            continue
        if p.get("kind") not in PAINT_KINDS:
            _err(out, f"{path}.kind", "paint-kind",
                 f"{path}.kind: expected one of {', '.join(PAINT_KINDS)}, got {p.get('kind')!r}", fp)
        if "title" in p and not isinstance(p["title"], str):
            _err(out, f"{path}.title", "paint-field", f"{path}.title: expected a string", fp)
        if "line" in p and not (_is_int(p["line"]) and p["line"] > 0):
            _err(out, f"{path}.line", "paint-field", f"{path}.line: expected a positive whole number", fp)
        if "opacity" in p and not (_is_num(p["opacity"]) and 0 <= p["opacity"] <= 1):
            _err(out, f"{path}.opacity", "paint-field", f"{path}.opacity: expected a number in [0, 1]", fp)
        if "color" in p and not _is_str(p["color"]):
            _err(out, f"{path}.color", "paint-colour", f"{path}.color: expected a colour string", fp)
        if "offset" in p and not _is_int(p["offset"]):
            _err(out, f"{path}.offset", "paint-field", f"{path}.offset: expected a whole number", fp)
        if "showLast" in p and not (_is_int(p["showLast"]) and p["showLast"] >= 0):
            _err(out, f"{path}.showLast", "paint-field",
                 f"{path}.showLast: expected a non-negative whole number", fp)
        if "colorMode" not in p:
            if not _is_str(p.get("color")):
                _err(out, path, "paint-colour",
                     f"{path}: a paint must declare a colour (color, or colorMode \"column:<key>\")", fp)
            continue
        mode = p["colorMode"]
        if not isinstance(mode, str) or not mode.startswith("column:"):
            _err(out, f"{path}.colorMode", "paint-color-mode",
                 f"{path}.colorMode: expected \"column:<key>\", got {mode!r}", fp)
            continue
        col = mode[len("column:"):]
        if col not in columns:
            _err(out, f"{path}.colorMode", "paint-column",
                 f"{path}.colorMode: {mode!r} references column {col!r}, which no plot declares", fp)
        grad = p.get("colorGradient")
        ways = sum(1 for ok in (
            _is_str(p.get("colorUp")) and _is_str(p.get("colorDown")),
            isinstance(p.get("colorPalette"), list) and len(p["colorPalette"]) >= 2
            and all(_is_str(c) for c in p["colorPalette"]),
            isinstance(grad, Mapping) and _is_str(grad.get("from")) and _is_str(grad.get("to")),
            isinstance(p.get("colorPacked"), Mapping),
        ) if ok)
        if ways != 1:
            _err(out, path, "paint-ways",
                 f"{path}: colorMode {mode!r} needs exactly one of colorUp/colorDown, a "
                 "colorPalette, a colorGradient, or a colorPacked", fp)
        packed = p.get("colorPacked")
        if isinstance(packed, Mapping) and "transparency" in packed \
                and not (_is_int(packed["transparency"]) and 0 <= packed["transparency"] <= 100):
            _err(out, f"{path}.colorPacked.transparency", "paint-field",
                 f"{path}.colorPacked.transparency: expected a whole number 0-100", fp)


#: ⛔ THE ONE COLOUR GRAMMAR A DRAWING-OBJECT PROGRAM MAY CARRY -- byte-equal to
#: ``app/src/components/chart/engine/objectColour.js::OBJECT_COLOUR_LITERAL`` (a test
#: holds them equal and both lanes answer ``tests/fixtures/ast/object_colour_cases.json``).
#: A stored ``objects`` program's colour literals reach the table renderer's CSS, so a
#: hand-crafted (and SHARED) definition could otherwise put ``url(...)`` into a
#: recipient's page. Found in the 2026-10-08 trust review.
OBJECT_COLOUR_LITERAL = re.compile(
    r"^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})"
    r"|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|1\.0+)\s*)?\)"
    r"|chart\.(?:fg|bg)_color(?:@\d{1,3})?)$", re.IGNORECASE)


def is_object_colour_literal(value: Any) -> bool:
    return (isinstance(value, str) and len(value) <= 64
            and OBJECT_COLOUR_LITERAL.match(value) is not None)


def object_colour_errors(definition: Mapping[str, Any]) -> list:
    """Every colour literal (``{"c": "lit", "hex": ...}``) in the definition's
    ``objects`` program that is not a colour, as ``[{path, code, message}]``.
    Iterative, bounded; never raises on a malformed document. ENFORCED on every
    save INCLUDING a copy of a stored row (share install, fork): unlike the rest
    of presentation, a copy is exactly how an unsafe program would reach a
    second member."""
    out: list = []
    root = definition.get("objects") if isinstance(definition, Mapping) else None
    if not isinstance(root, (Mapping, list)):
        return out
    stack = [(root, "objects")]
    seen = 0
    while stack and seen < 200_000:
        node, path = stack.pop()
        seen += 1
        if isinstance(node, Mapping):
            if (node.get("c") == "lit" and "hex" in node
                    and not is_object_colour_literal(node.get("hex"))):
                shown = json.dumps(node.get("hex"))[:48]
                out.append({"path": f"{path}.hex", "code": "object-colour",
                            "message": f"{path}.hex: {shown} is not a colour"})
            for k, v in node.items():
                if isinstance(v, (Mapping, list)):
                    stack.append((v, f"{path}.{k}"))
        elif isinstance(node, list):
            for i, v in enumerate(node):
                if isinstance(v, (Mapping, list)):
                    stack.append((v, f"{path}[{i}]"))
    return out


_NUM_CHANNELS = r"\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?\s*"
_HSL_CHANNELS = r"\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?%\s*,\s*\d{1,3}(?:\.\d+)?%\s*"
_ALPHA = r"(?:,\s*(?:0|1|0?\.\d+|1\.0+)\s*)?"

#: ⛔ THE COLOUR GRAMMAR OF A DEFINITION'S PRESENTATION (plots, paints, colour settings) --
#: byte-equal to ``objectColour.js::PRESENTATION_COLOUR`` (a test compares the sources).
#: Everything UCT writes and every format measured in the repo: hex 3/4/6/8, numeric
#: rgb/rgba/hsl/hsla, a plain colour word, ``token:<role>[@step]``. Nothing admits ``(``
#: except the numeric functions, ``:`` except ``token:``, or ``;`` -- so ``url()``,
#: ``var()`` and declaration smuggling cannot be stored. The 2026-10-08 inventory found
#: these fields reaching inline CSS (legend chips/rows, settings swatches) unvalidated,
#: reachable cross-member through a shared definition.
PRESENTATION_COLOUR = re.compile(
    r"^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})"
    + rf"|rgba?\({_NUM_CHANNELS}{_ALPHA}\)|hsla?\({_HSL_CHANNELS}{_ALPHA}\)"
    + r"|[a-z]{3,20}|token:[a-z][a-z0-9_.-]{0,40}(?:@[a-z0-9_.-]{1,20})?)$", re.IGNORECASE)


def is_presentation_colour(value: Any) -> bool:
    return (isinstance(value, str) and len(value) <= 64
            and PRESENTATION_COLOUR.match(value) is not None)


#: The colour-bearing fields of a plot and of a paint (strings, lists of strings, or a
#: ``{from, to}`` gradient). ``plots[].color`` may be a ``"$<inputKey>"`` reference.
_PLOT_COLOUR_FIELDS = ("color", "colorUp", "colorDown", "fillColor")
_PAINT_COLOUR_FIELDS = ("color", "colorUp", "colorDown")


def definition_colour_errors(definition: Mapping[str, Any]) -> list:
    """Every persisted presentation colour that is not a colour, as
    ``[{path, code, message, value}]``: colour-type input defaults, plot colours
    (a ``$ref`` is not a colour and is skipped), up/down, fill, palettes and
    gradients, on plots and on paints. Pure; never raises on a malformed document.
    (Drawing-program colours are ``object_colour_errors``.)"""
    out: list = []
    if not isinstance(definition, Mapping):
        return out

    def check(path: str, value: Any) -> None:
        if isinstance(value, str) and not is_presentation_colour(value):
            out.append({"path": path, "code": "presentation-colour", "value": value,
                        "message": f"{path}: {json.dumps(value)[:48]} is not a colour"})

    def entry(base: str, item: Mapping, fields) -> None:
        for f in fields:
            v = item.get(f)
            if f == "color" and isinstance(v, str) and v.startswith("$"):
                continue
            check(f"{base}.{f}", v)
        pal = item.get("colorPalette")
        if isinstance(pal, list):
            for i, v in enumerate(pal):
                check(f"{base}.colorPalette[{i}]", v)
        grad = item.get("colorGradient")
        if isinstance(grad, Mapping):
            for f in ("from", "to"):
                check(f"{base}.colorGradient.{f}", grad.get(f))

    for i, inp in enumerate(definition.get("inputs") or []):
        if isinstance(inp, Mapping) and inp.get("type") == "color":
            check(f"inputs[{i}].default", inp.get("default"))
    for i, plot in enumerate(definition.get("plots") or []):
        if isinstance(plot, Mapping):
            entry(f"plots[{i}]", plot, _PLOT_COLOUR_FIELDS)
    for i, paint in enumerate(definition.get("paints") or []):
        if isinstance(paint, Mapping):
            entry(f"paints[{i}]", paint, _PAINT_COLOUR_FIELDS)
    return out


def presentation_errors(definition: Mapping[str, Any]) -> list:
    """Every presentation error `defSchema` would raise for these fields, as
    ``[{path, code, message, fingerprint}]`` (empty when the presentation is
    valid). Pure; never raises on a malformed document."""
    out: list = []
    if not isinstance(definition, Mapping):
        return out
    plots = definition.get("plots")
    plots = plots if isinstance(plots, list) else []
    events = definition.get("events")
    events = events if isinstance(events, list) else []
    columns = {p.get("key") for p in plots if isinstance(p, Mapping) and isinstance(p.get("key"), str)}
    columns |= {e.get("key") for e in events if isinstance(e, Mapping) and isinstance(e.get("key"), str)}
    inputs = _inputs_by_key(definition)
    for i, plot in enumerate(plots):
        if not isinstance(plot, Mapping):
            continue
        path = f"plots[{i}]"
        fp = _plot_fp(plot)
        style = plot.get("style")
        if style not in PLOT_STYLES:
            reserved = style in RESERVED_PLOT_STYLES
            _err(out, f"{path}.style", "plot-style",
                 f"{path}.style: plot style {style!r} is "
                 + ("SCHEMA-RESERVED for a later phase" if reserved else "unknown")
                 + f" -- buildable styles are {', '.join(PLOT_STYLES)}", fp)
        _check_marker(plot, path, fp, out)
        _check_width(plot, inputs, path, out)
        _check_plot_colour_fields(plot, path, fp, out)
        _check_color_mode(plot, path, fp, columns, out)
        _check_ohlc(plot, path, fp, columns, out)
    # DIV-4 -- a PAINT (never a plot) may also name a colour column the per-bar run computes
    run_keys = _check_runtime_colours(definition, columns, out)
    _check_paints(definition.get("paints"), columns | run_keys, out)
    # ENGINE 53 -- a host document's run half (``compute.runtimeObjects``), mapped onto PLOT keys
    plot_keys = {p.get("key") for p in plots if isinstance(p, Mapping) and isinstance(p.get("key"), str)}
    _check_runtime_objects(definition, plot_keys, out)
    return out


#: ENGINE 53 -- the fields ``compute.runtimeObjects`` may carry (``defSchema.RUNTIME_OBJECTS_FIELDS``).
#: CLOSED: anything else is refused.
RUNTIME_OBJECTS_FIELDS = ("source", "outputs", "runtimeLanguage", "runtimeFrontend", "runtimeIr",
                          "runtimeOutputSignature", "sites", "programSha256", "programGraphSha256")
_RO_SITE_ID = re.compile(r"^s\d+$")
_RO_SITE_KEY = re.compile(r"^\d+:\d+$")
_RO_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _check_runtime_objects(definition: Mapping, plot_keys: set, out: list) -> None:
    """ENGINE 53 -- ``compute.runtimeObjects = {source, outputs, ...runtimeVersionStamp}``: the RUN
    HALF of a host document whose object program lost drawings. The mirror of the client's
    ``defSchema.runtimeObjectsErrors``, rule for rule, held to it by one fixture both suites read
    (``tests/fixtures/runtime_objects_schema.json``): only on an ``ast`` definition; ``source`` a
    non-empty string; ``outputs`` an object mapping a DECLARED plot key to a whole-number run output
    index, no index named twice; the stamp, when present, typed (``runtimeLanguage`` a non-empty
    string, ``runtimeFrontend``/``runtimeIr`` positive whole numbers, ``runtimeOutputSignature`` a list
    of strings naming every mapped index); ENGINE 54: ``sites`` an object mapping a create site id
    (``s<n>``) to its source call (``<line>:<column>``), ``programSha256`` / ``programGraphSha256``
    64 lowercase hex; no other field."""
    compute = definition.get("compute")
    if not isinstance(compute, Mapping) or "runtimeObjects" not in compute:
        return
    ro = compute.get("runtimeObjects")
    path = "compute.runtimeObjects"
    fp = "runtimeObjects:" + _canon(ro)
    code = "runtime-objects"
    if compute.get("kind") != "ast":
        _err(out, path, code, f"{path}: only an \"ast\" definition draws its objects from the per-bar run, "
             f"got kind {compute.get('kind')!r}", fp)
        return
    if not isinstance(ro, Mapping):
        _err(out, path, code, f"{path}: expected {{source, outputs, ...stamp}}", fp)
        return
    extra = sorted(k for k in ro if k not in RUNTIME_OBJECTS_FIELDS)
    if extra:
        _err(out, path, code, f"{path}: unknown field(s) {', '.join(map(repr, extra))}", fp)
    if not _is_str(ro.get("source")) or not ro.get("source"):
        _err(out, f"{path}.source", code, f"{path}.source: expected the script the run runs, a non-empty string", fp)
    # one document, one script: beside run-read colours both runs read the same source
    rc = compute.get("runtimeColours")
    if isinstance(rc, Mapping) and "source" in rc and rc.get("source") != ro.get("source"):
        _err(out, f"{path}.source", code,
             f"{path}.source: is not the script compute.runtimeColours.source reads; one document runs one script", fp)
    outputs = ro.get("outputs")
    if not isinstance(outputs, Mapping):
        _err(out, f"{path}.outputs", code,
             f"{path}.outputs: expected an object mapping a plot key to a run output index", fp)
    else:
        seen: set = set()
        for k, idx in outputs.items():
            if k not in plot_keys:
                _err(out, f"{path}.outputs.{k}", code, f"{path}.outputs.{k}: names no declared plot", fp)
            if not _is_int(idx) or idx < 0:
                _err(out, f"{path}.outputs.{k}", code,
                     f"{path}.outputs.{k}: expected a whole-number run output index, got {idx!r}", fp)
            elif int(idx) in seen:
                _err(out, f"{path}.outputs.{k}", code, f"{path}.outputs.{k}: run output {int(idx)} is named by two plots", fp)
            else:
                seen.add(int(idx))
    lang = ro.get("runtimeLanguage")
    if "runtimeLanguage" in ro and (not _is_str(lang) or not lang):
        _err(out, f"{path}.runtimeLanguage", code, f"{path}.runtimeLanguage: expected a non-empty string", fp)
    for f in ("runtimeFrontend", "runtimeIr"):
        if f in ro and (not _is_int(ro.get(f)) or ro.get(f) < 1):
            _err(out, f"{path}.{f}", code, f"{path}.{f}: expected a positive whole number, got {ro.get(f)!r}", fp)
    if "sites" in ro:
        sites = ro.get("sites")
        if not isinstance(sites, Mapping):
            _err(out, f"{path}.sites", code, f"{path}.sites: expected an object mapping a create site to its source call", fp)
        else:
            for k, v in sites.items():
                if not isinstance(k, str) or not _RO_SITE_ID.fullmatch(k):
                    _err(out, f"{path}.sites.{k}", code, f"{path}.sites.{k}: a create site is named s<n>", fp)
                if not isinstance(v, str) or not _RO_SITE_KEY.fullmatch(v):
                    _err(out, f"{path}.sites.{k}", code, f"{path}.sites.{k}: expected a source call <line>:<column>", fp)
    for f in ("programSha256", "programGraphSha256"):
        if f in ro and not (isinstance(ro.get(f), str) and _RO_SHA256.fullmatch(ro.get(f))):
            _err(out, f"{path}.{f}", code, f"{path}.{f}: expected 64 lowercase hex", fp)
    if "runtimeOutputSignature" in ro:
        sig = ro.get("runtimeOutputSignature")
        if not isinstance(sig, list) or not all(isinstance(x, str) for x in sig):
            _err(out, f"{path}.runtimeOutputSignature", code,
                 f"{path}.runtimeOutputSignature: expected a list of strings", fp)
        elif isinstance(outputs, Mapping):
            for k, idx in outputs.items():
                if _is_int(idx) and idx >= len(sig):
                    _err(out, f"{path}.outputs.{k}", code,
                         f"{path}.outputs.{k}: run output {int(idx)} is past the signature's {len(sig)} outputs", fp)


def _check_runtime_colours(definition: Mapping, plot_keys: set, out: list) -> set:
    """DIV-4 -- ``compute.runtimeColours = {source, at, keys}``: colours a HOST document
    reads from the per-bar run. The mirror of the client's ``defSchema.validateRuntimeColours``,
    rule for rule: only on an ``ast`` definition; one key per value; a key unique, a
    non-empty string, and never a plot's key; each ``at`` a colour asked for at a statement
    (``{line, column, node, kind: "colour"}``). Returns the keys a paint may name: none when
    absent or malformed (the paint naming one is then refused as an undeclared column)."""
    compute = definition.get("compute")
    if not isinstance(compute, Mapping) or "runtimeColours" not in compute:
        return set()
    rc = compute.get("runtimeColours")
    path = "compute.runtimeColours"
    fp = "runtimeColours:" + _canon(rc)
    if compute.get("kind") != "ast":
        _err(out, path, "runtime-colours",
             f"{path}: only an \"ast\" definition reads colours from the per-bar run, got kind {compute.get('kind')!r}", fp)
        return set()
    at = rc.get("at") if isinstance(rc, Mapping) else None
    keys = rc.get("keys") if isinstance(rc, Mapping) else None
    if (not isinstance(rc, Mapping) or not _is_str(rc.get("source")) or not rc.get("source")
            or not isinstance(at, list) or not isinstance(keys, list) or not at or len(at) != len(keys)):
        _err(out, path, "runtime-colours", f"{path}: expected {{source, at, keys}} with one key per value", fp)
        return set()
    seen: list = []
    for i, k in enumerate(keys):
        if not _is_str(k) or not k or k in seen or k in plot_keys:
            _err(out, f"{path}.keys[{i}]", "runtime-colours",
                 f"{path}.keys[{i}]: expected a unique key no plot declares, got {k!r}", fp)
            return set()
        spec = at[i]
        if (not isinstance(spec, Mapping) or not _is_int(spec.get("line")) or not _is_int(spec.get("column"))
                or spec.get("kind") != "colour" or not isinstance(spec.get("node"), Mapping)):
            _err(out, f"{path}.at[{i}]", "runtime-colours",
                 f"{path}.at[{i}]: expected a colour asked for at a statement ({{line, column, node, kind: \"colour\"}})", fp)
            return set()
        seen.append(k)
    return set(seen)


def new_presentation_errors(definition: Mapping[str, Any],
                            stored: Any = None) -> tuple:
    """``(refused, grandfathered)``: the errors this save INTRODUCES, and the ones
    the stored predecessor already carried on an identical entry (a legacy row's
    presentation -- recorded, never enforced, no migration)."""
    errors = presentation_errors(definition)
    if not errors:
        return [], []
    known = {(e["code"], e["fingerprint"]) for e in presentation_errors(stored)} \
        if isinstance(stored, Mapping) else set()
    refused = [e for e in errors if (e["code"], e["fingerprint"]) not in known]
    kept = [e for e in errors if (e["code"], e["fingerprint"]) in known]
    return refused, kept
