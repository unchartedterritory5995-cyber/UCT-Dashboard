"""Wave 13 lane 13A -- THE ONE READER of plan levels (entry, stop, target, shares) in a note.

Every plan shape a member can write feeds this file, and nothing else in the app reads plan
levels out of a note. Grading (`plan_grading.py`) calls it; so will 13D's level index
(`j2_note_levels`, a projection of this output), 13G's thesis chips, 13I's before/after and
13J's board. A second parser anywhere is a second authority over the same numbers, and the
two would drift the first time a template changes.

SHAPES, IN PRECEDENCE ORDER INSIDE ONE NOTE (`NOTE_SHAPES`)
-----------------------------------------------------------
  1. ``chart``      -- a level drawn on a chart block: a dict in a ``widgetEmbed`` node's
                       ``annotations`` list carrying ``role`` (lane 13H writes these).
  2. ``canvas``     -- a level on the trade-plan canvas: ``tradeCanvas`` attrs
                       ``board.levels[]`` with ``role`` in entry|stop|target (wave 11D).
  3. ``properties`` -- number properties named Entry / Stop / Target / Shares (the Position
                       Tracker and the plan templates declare them; wave 12 12B-2).
  4. ``text``       -- labelled text: ``Entry: 42.50`` lines and the setup plans' "The
                       numbers" table rows (``Pivot (entry) | 42.50``).

The Compass pre-trade verdict (`j2_verdicts`) is the fifth shape and is read by
`read_verdict_plan`; it is a row, not a note, so it has no place in the in-note order.

Per ROLE, the highest-precedence shape that says anything about that role wins: a canvas
entry and stop with the Shares property beside them reads as one plan, the shares from the
property. A shape that names a role twice with DIFFERENT values reads that role as
``unreadable`` -- it is never averaged, never "the first one", and it is not passed over in
favour of a lower shape (that would hide the contradiction the member wrote). The one
exception is ``target``: several targets are scale-outs, not a contradiction, so the target is
the one NEAREST the entry (the first scale-out) when every target sits on the same side of it.

THE WRITE INTERFACE (for lanes 13D and 13H)
-------------------------------------------
⛔ THE SERVER NEVER WRITES A NOTE. A plan level reaches a note through the member's own editor
transaction (autosave, compare-and-set, the offline outbox, version history) -- the one write
path every note shares (R-12 "no second writer into notes"). So the write interface is a
SHAPE CONTRACT plus the client builders that produce it, `app/src/pages/journal-2-0/lib/
planLevels.js`, whose role vocabulary is pinned to `PLAN_ROLES` here by
`tests/test_notebook_plan_extract.py` (it parses the client file):

  * A chart-drawn level (13H): any dict in a ``widgetEmbed`` node's ``attrs.annotations`` with
        {"role": "entry" | "stop" | "target", "price": <finite number>, ...drawing fields}
    A drawing that carries ``points`` instead of ``price`` is read at ``points[0].price``.
    Planned shares ride the 13H ``ta`` attr: ``attrs.ta.planBlock.shares`` (a number), and a
    setup tag ``attrs.ta.setupTag`` (a string). Build them with
    ``planLevels.planAnnotation(role, price, drawing)`` / ``planLevels.planBlock({shares})``.
    A chart whose ``params.symbol`` names ANOTHER ticker is not read for this ticker.
  * A canvas level: ``planLevels.canvasLevel(role, price)`` (the 11D board's own shape).
  * A property value: number properties whose NAME classifies to a role (`classify_label`),
    written by the property editor like any other value.
  * Text: a line ``<label>: <number>`` or a table row ``<label> | <number>``.

Python twins of the builders (`plan_annotation`, `canvas_level`) exist for tests and for
13D's projection fixtures; they return the same dicts and never touch a database.

THE READ INTERFACE
------------------
  * `read_note_plan(body_json, properties_json, prop_defs, symbol)` -> `PlanReading`
  * `read_verdict_plan(verdict_row)` -> `PlanReading`
  * `note_levels(body_json, properties_json, prop_defs, symbol)` -> every level the note
    names, one dict per (shape, role, price) -- the input 13D's `j2_note_levels` projects.

⛔ NEVER RAISES. A body is member data written by clients this server did not build; any shape
-- a string price, a list where a dict belongs, a cyclic-looking deep tree -- reads as "less",
never as a 500 on a grade. Deterministic: no clock, no network, no model call.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

#: The plan's four numbers. ⛔ ONE FACT IN TWO FILES with `PLAN_ROLES` in
#: app/src/pages/journal-2-0/lib/planLevels.js, pinned by tests/test_notebook_plan_extract.py.
PLAN_ROLES: tuple[str, ...] = ("entry", "stop", "target", "shares")
#: The roles a price level can carry (shares is a count, never a line on a chart).
PRICE_ROLES: tuple[str, ...] = ("entry", "stop", "target")
#: In-note precedence, highest first.
NOTE_SHAPES: tuple[str, ...] = ("chart", "canvas", "properties", "text")

STATE_OK = "ok"
STATE_ABSENT = "absent"
STATE_UNREADABLE = "unreadable"

# How deep a body is walked. The note body cap (notebook depth cap, #203) is far below this;
# the bound only keeps a hostile body from costing more than a read should.
_MAX_DEPTH = 64
_MAX_NODES = 20000


# ── small readers ────────────────────────────────────────────────────────────────────────────

def _num(v: Any) -> float | None:
    """A finite positive number from a number or a numeric string, else None."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
    elif isinstance(v, str):
        m = _LEADING_NUMBER.match(v)
        if not m:
            return None
        try:
            f = float(m.group(1).replace(",", ""))
        except ValueError:
            return None
    else:
        return None
    if not math.isfinite(f) or f <= 0:
        return None
    return f


# A value: optional $ sign, then a number with optional thousands commas and decimals.
_LEADING_NUMBER = re.compile(r"^\s*\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)")
# A labelled line: "<label>: <rest>" or "<label> = <rest>".
_LABELLED_LINE = re.compile(r"^\s*([A-Za-z][^:=\n]{0,60}?)\s*[:=]\s*(.*)$")


def classify_label(label: Any) -> str | None:
    """The plan role a label names, or None. One classifier for text labels AND property names,
    so "Stop" means the same thing wherever a member writes it.

    ``Shares``/``Size (shares / $ risk)``/``Shares (small)`` -> shares; ``Risk per share`` -> None;
    ``Stop``/``Low of day (stop)`` -> stop; ``Target(s)``/``Prior high (first target)``/
    ``First support (cover)`` -> target; ``Entry``/``Pivot (entry)`` -> entry.
    """
    if not isinstance(label, str):
        return None
    lab = " ".join(label.lower().split())
    if not lab:
        return None
    if re.search(r"\bshares\b", lab):
        return "shares"
    if "risk" in lab or "%" in lab:
        return None
    if re.search(r"\bstop\b", lab):
        return "stop"
    if re.search(r"\btargets?\b|\btarget\(s\)|\bcover\b|\btake profit\b", lab):
        return "target"
    if re.search(r"\bentry\b", lab):
        return "entry"
    if lab == "size" or lab.startswith("size "):
        return "shares"
    return None


def _round(v: float) -> float:
    return round(v, 6)


# ── the reading ──────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class RoleReading:
    """One role's answer: ``state`` is ok (``value`` set), absent, or unreadable (``values``
    holds the contradiction the member wrote). ``shape`` is where it was read."""
    state: str = STATE_ABSENT
    value: float | None = None
    shape: str | None = None
    values: tuple[float, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {"state": self.state, "value": self.value, "shape": self.shape,
                "values": list(self.values)}


@dataclass(frozen=True)
class PlanReading:
    roles: dict[str, RoleReading] = field(default_factory=dict)
    setup: str | None = None
    side: str | None = None      # "Long" / "Short" when the source says so (a verdict does)

    def role(self, name: str) -> RoleReading:
        return self.roles.get(name) or RoleReading()

    def value(self, name: str) -> float | None:
        r = self.role(name)
        return r.value if r.state == STATE_OK else None

    @property
    def names_any_level(self) -> bool:
        """The source says SOMETHING about entry/stop/target/shares (an explicit link needs
        only this much to be read as a plan)."""
        return any(self.role(r).state != STATE_ABSENT for r in PLAN_ROLES)

    @property
    def is_plan(self) -> bool:
        """Enough to call it a plan when nobody linked it: an entry or a stop is named."""
        return self.role("entry").state != STATE_ABSENT or self.role("stop").state != STATE_ABSENT

    @property
    def primary_shape(self) -> str | None:
        """The shape that answered the entry (else the stop, else any role) -- the plan's
        source label."""
        for name in ("entry", "stop", "target", "shares"):
            r = self.role(name)
            if r.state != STATE_ABSENT:
                return r.shape
        return None

    def as_dict(self) -> dict[str, Any]:
        return {
            "roles": {r: self.role(r).as_dict() for r in PLAN_ROLES},
            "entry": self.value("entry"), "stop": self.value("stop"),
            "target": self.value("target"), "shares": self.value("shares"),
            "setup": self.setup, "side": self.side, "primaryShape": self.primary_shape,
        }


def _resolve(values: list[float], role: str, entry: float | None) -> RoleReading:
    """Several raw readings of one role inside ONE shape -> one RoleReading (shape set later)."""
    distinct = sorted({_round(v) for v in values})
    if not distinct:
        return RoleReading()
    if len(distinct) == 1:
        return RoleReading(STATE_OK, distinct[0])
    if role == "target" and entry is not None:
        above = [v for v in distinct if v > entry]
        below = [v for v in distinct if v < entry]
        if above and not below:
            return RoleReading(STATE_OK, min(above), values=tuple(distinct))
        if below and not above:
            return RoleReading(STATE_OK, max(below), values=tuple(distinct))
    return RoleReading(STATE_UNREADABLE, None, values=tuple(distinct))


def _merge(per_shape: dict[str, dict[str, list[float]]], setup: str | None = None,
           side: str | None = None) -> PlanReading:
    """Per role, the highest-precedence shape that says anything about it."""
    # The entry first: a multi-target shape resolves its target against the plan's entry.
    entry_reading = RoleReading()
    for shape in NOTE_SHAPES + ("verdict",):
        vals = per_shape.get(shape, {}).get("entry") or []
        if vals:
            r = _resolve(vals, "entry", None)
            entry_reading = RoleReading(r.state, r.value, shape, r.values)
            break
    entry_value = entry_reading.value if entry_reading.state == STATE_OK else None
    roles: dict[str, RoleReading] = {"entry": entry_reading}
    for role in ("stop", "target", "shares"):
        chosen = RoleReading()
        for shape in NOTE_SHAPES + ("verdict",):
            vals = per_shape.get(shape, {}).get(role) or []
            if vals:
                r = _resolve(vals, role, entry_value)
                chosen = RoleReading(r.state, r.value, shape, r.values)
                break
        roles[role] = chosen
    return PlanReading(roles=roles, setup=setup, side=side)


# ── walking a TipTap body ──────────────────────────────────────────────────────────────────

def _parse_body(body_json: Any) -> dict[str, Any] | None:
    if isinstance(body_json, dict):
        return body_json
    if isinstance(body_json, (str, bytes)):
        try:
            v = json.loads(body_json)
        except (ValueError, TypeError):
            return None
        return v if isinstance(v, dict) else None
    return None


def _walk(body: dict[str, Any]) -> Iterable[dict[str, Any]]:
    """Every node dict, depth-first, bounded."""
    stack: list[tuple[Any, int]] = [(body, 0)]
    seen = 0
    while stack:
        node, depth = stack.pop()
        if not isinstance(node, dict) or depth > _MAX_DEPTH:
            continue
        seen += 1
        if seen > _MAX_NODES:
            return
        yield node
        content = node.get("content")
        if isinstance(content, list):
            for child in reversed(content):
                stack.append((child, depth + 1))


def _inline_text(node: Any) -> str:
    """The plain text of one block (its inline children, and nested paragraphs)."""
    out: list[str] = []
    for n in _walk(node) if isinstance(node, dict) else ():
        if n.get("type") == "text" and isinstance(n.get("text"), str):
            out.append(n["text"])
        elif n.get("type") == "hardBreak":
            out.append("\n")
    return "".join(out)


def _attrs(node: dict[str, Any]) -> dict[str, Any]:
    a = node.get("attrs")
    return a if isinstance(a, dict) else {}


def _clean_symbol(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    s = v.strip().lstrip("$").upper()
    return s or None


def _annotation_price(a: dict[str, Any]) -> float | None:
    p = _num(a.get("price"))
    if p is not None:
        return p
    pts = a.get("points")
    if isinstance(pts, list) and pts and isinstance(pts[0], dict):
        return _num(pts[0].get("price"))
    return None


def _chart_levels(body: dict[str, Any], symbol: str | None) -> tuple[dict[str, list[float]], str | None]:
    out: dict[str, list[float]] = {}
    setup: str | None = None
    for node in _walk(body):
        if node.get("type") != "widgetEmbed":
            continue
        attrs = _attrs(node)
        params = attrs.get("params") if isinstance(attrs.get("params"), dict) else {}
        chart_sym = _clean_symbol(params.get("symbol"))
        if symbol and chart_sym and chart_sym != symbol:
            continue
        anns = attrs.get("annotations")
        for a in anns if isinstance(anns, list) else []:
            if not isinstance(a, dict) or a.get("role") not in PRICE_ROLES:
                continue
            price = _annotation_price(a)
            if price is not None:
                out.setdefault(a["role"], []).append(price)
        ta = attrs.get("ta") if isinstance(attrs.get("ta"), dict) else {}
        block = ta.get("planBlock") if isinstance(ta.get("planBlock"), dict) else {}
        shares = _num(block.get("shares"))
        if shares is not None:
            out.setdefault("shares", []).append(shares)
        tag = ta.get("setupTag")
        if setup is None and isinstance(tag, str) and tag.strip():
            setup = tag.strip()[:80]
    return out, setup


def _canvas_levels(body: dict[str, Any], symbol: str | None) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for node in _walk(body):
        if node.get("type") != "tradeCanvas":
            continue
        board = _attrs(node).get("board")
        if not isinstance(board, dict):
            continue
        items = board.get("items") if isinstance(board.get("items"), list) else []
        chart_syms = {it.get("id"): _clean_symbol(it.get("symbol")) for it in items
                      if isinstance(it, dict) and it.get("kind") == "chart"}
        levels = board.get("levels") if isinstance(board.get("levels"), list) else []
        for lv in levels:
            if not isinstance(lv, dict) or lv.get("role") not in PRICE_ROLES:
                continue
            on = chart_syms.get(lv.get("chartId")) if isinstance(lv.get("chartId"), str) else None
            if symbol and on and on != symbol:
                continue
            price = _num(lv.get("price"))
            if price is not None:
                out.setdefault(lv["role"], []).append(price)
    return out


def _text_lines(body: dict[str, Any]) -> list[tuple[str, str]]:
    """(label, rest) pairs: labelled paragraph/heading lines, and table rows read as
    (first cell, the first later cell that starts with a number)."""
    pairs: list[tuple[str, str]] = []
    for node in _walk(body):
        t = node.get("type")
        if t in ("paragraph", "heading"):
            for line in _inline_text(node).split("\n"):
                m = _LABELLED_LINE.match(line)
                if m:
                    pairs.append((m.group(1), m.group(2)))
        elif t == "tableRow":
            cells = [c for c in (node.get("content") or []) if isinstance(c, dict)]
            if len(cells) < 2:
                continue
            label = " ".join(_inline_text(cells[0]).split())
            for c in cells[1:]:
                txt = _inline_text(c).strip()
                if _LEADING_NUMBER.match(txt):
                    pairs.append((label, txt))
                    break
    return pairs


def _text_levels(body: dict[str, Any]) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for label, rest in _text_lines(body):
        role = classify_label(label)
        if role is None:
            continue
        v = _num(rest)
        if v is not None:
            out.setdefault(role, []).append(v)
    return out


def _property_levels(properties_json: Any, prop_defs: Iterable[dict[str, Any]] | None
                     ) -> tuple[dict[str, list[float]], str | None]:
    values = properties_json
    if isinstance(values, (str, bytes)):
        try:
            values = json.loads(values)
        except (ValueError, TypeError):
            values = None
    if not isinstance(values, dict):
        return {}, None
    out: dict[str, list[float]] = {}
    setup: str | None = None
    for d in prop_defs or []:
        if not isinstance(d, dict):
            continue
        pid, name, typ = d.get("id"), d.get("name"), d.get("type")
        if pid not in values:
            continue
        raw = values.get(pid)
        if typ == "number":
            role = classify_label(name)
            v = _num(raw)
            if role and v is not None:
                out.setdefault(role, []).append(v)
        elif isinstance(name, str) and name.strip().lower() == "setup" and setup is None:
            if typ == "select":
                opts = d.get("options") or []
                label = next((o.get("label") for o in opts if isinstance(o, dict) and o.get("id") == raw), None)
                if isinstance(label, str) and label.strip():
                    setup = label.strip()[:80]
            elif isinstance(raw, str) and raw.strip():
                setup = raw.strip()[:80]
    return out, setup


# ── the public readers ─────────────────────────────────────────────────────────────────────

def read_note_plan(body_json: Any, properties_json: Any = None,
                   prop_defs: Iterable[dict[str, Any]] | None = None,
                   symbol: str | None = None) -> PlanReading:
    """The plan one note names, for `symbol` (a chart or canvas chart naming another ticker is
    skipped). Never raises."""
    try:
        sym = _clean_symbol(symbol)
        body = _parse_body(body_json) or {}
        chart, chart_setup = _chart_levels(body, sym)
        props, prop_setup = _property_levels(properties_json, list(prop_defs or []))
        per_shape = {
            "chart": chart,
            "canvas": _canvas_levels(body, sym),
            "properties": props,
            "text": _text_levels(body),
        }
        return _merge(per_shape, setup=chart_setup or prop_setup)
    except Exception:  # noqa: BLE001 -- see the module docstring: a body reads as "less"
        return PlanReading()


def read_verdict_plan(row: Any) -> PlanReading:
    """The plan a Compass pre-trade verdict row names (`j2_verdicts`)."""
    try:
        get = (lambda k: row[k] if k in row.keys() else None) if hasattr(row, "keys") else row.get
        per = {"verdict": {}}
        for role, col in (("entry", "entry_price"), ("stop", "stop_price"),
                          ("target", "target_price"), ("shares", "shares")):
            v = _num(get(col))
            if v is not None:
                per["verdict"][role] = [v]
        side = get("side")
        side = side.strip().capitalize() if isinstance(side, str) and side.strip() else None
        setup = get("setup")
        setup = setup.strip()[:80] if isinstance(setup, str) and setup.strip() else None
        return _merge(per, setup=setup, side=side if side in ("Long", "Short") else None)
    except Exception:  # noqa: BLE001
        return PlanReading()


def note_levels(body_json: Any, properties_json: Any = None,
                prop_defs: Iterable[dict[str, Any]] | None = None,
                symbol: str | None = None) -> list[dict[str, Any]]:
    """Every level the note names, unmerged: [{shape, role, price}] in precedence order. The
    input 13D's `j2_note_levels` projection writes (a projection of THIS, never a re-parse)."""
    try:
        sym = _clean_symbol(symbol)
        body = _parse_body(body_json) or {}
        chart, _ = _chart_levels(body, sym)
        props, _ = _property_levels(properties_json, list(prop_defs or []))
        per_shape = {"chart": chart, "canvas": _canvas_levels(body, sym),
                     "properties": props, "text": _text_levels(body)}
        out: list[dict[str, Any]] = []
        for shape in NOTE_SHAPES:
            for role in PLAN_ROLES:
                for v in sorted({_round(x) for x in per_shape[shape].get(role, [])}):
                    out.append({"shape": shape, "role": role, "price": v})
        return out
    except Exception:  # noqa: BLE001
        return []


# ── the Python twins of the client builders (lib/planLevels.js) ───────────────────────────

def plan_annotation(role: str, price: float, drawing: dict[str, Any] | None = None) -> dict[str, Any]:
    """A chart-drawn plan level, as 13H stores it in a widgetEmbed's ``annotations``."""
    if role not in PRICE_ROLES:
        raise ValueError(f"not a price role: {role!r}")
    base = dict(drawing or {"type": "horizontal"})
    base["role"] = role
    base["price"] = float(price)
    return base


def canvas_level(role: str, price: float, level_id: str = "lv1", chart_id: str | None = None) -> dict[str, Any]:
    """A trade-plan canvas level (the 11D board's own shape)."""
    if role not in PRICE_ROLES:
        raise ValueError(f"not a price role: {role!r}")
    return {"id": level_id, "role": role, "label": "", "price": float(price), "chartId": chart_id}
