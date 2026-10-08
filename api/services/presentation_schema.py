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
Fields `defSchema` checks that are not listed above (legend, lineStyle, width,
…) are not checked here -- narrower, never different.

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
               "markers", "band")
RESERVED_PLOT_STYLES = ("zones", "bgband", "barcolor", "fill", "cross")
MARKER_SHAPES = ("circle", "square", "arrowUp", "arrowDown")
MARKER_POSITIONS = ("aboveBar", "belowBar", "inBar")
MARKER_SIZE_RANGE = {"min": 0.25, "max": 4}
MARKER_TEXT_MAX = 24
PAINT_KINDS = ("bgcolor", "barcolor")
COLOR_MODES = ("fixed", "sign")

#: The plot fields that are presentation for the fingerprint. A change to any of
#: them makes the plot's presentation "changed" for the legacy rule.
_PLOT_PRESENTATION = ("style", "marker", "colorMode", "colorUp", "colorDown",
                      "colorPalette", "colorGradient", "colorPacked")

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
        _check_plot_colour_fields(plot, path, fp, out)
        _check_color_mode(plot, path, fp, columns, out)
    _check_paints(definition.get("paints"), columns, out)
    return out


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
