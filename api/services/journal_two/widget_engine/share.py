"""The ONE sharing reducer (Notebook widgets wave 11, Task 11.4, rulings W11-R1, W11-R5, W11-R6).

A share never copies a stored row. Each reducer here builds a NEW payload from an allowlist: the
structure of a widget, a routine, a tracker or a template travels; every member value becomes a
typed "pick yours" choice; and the only member text that travels is what the author typed in the
share preview (`edits`), with numbers only where the author listed them in `keep`.

  * `share_plan`      a widget's plan -> {name, description, plan, slots}
  * `share_routine`   a routine       -> {name, items, schedule, settings}
  * `share_tracker`   a tracker       -> {name, kind, unit, days}
  * `share_template`  a template (a journal style) -> format 2 with inline definitions, routines and
                      trackers. The outline is NOT reduced here: the caller runs `sanitize_body`.
  * `resolve_plan`    a shared plan plus the adopter's answers -> a plan `validate_plan` accepts.

Which fields hold the member's own names is the catalog's `Field.public_kind` (W10.7), the same
classification `payload` and `public_note_payload` number public labels with; a field that names a
routine or tracker is its `ref_kind`. This module adds no second table of member-named fields.

Pure: no I/O, no clock, no database. Callers pass the rows (already checked as the member's own).
`tests/test_widget_share.py::test_share_module_reads_no_database` walks this file's AST.
"""
from __future__ import annotations

import copy
import math
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable, Mapping, Sequence

from api.services.journal_two import widget_formula as wf
from api.services.journal_two.tool_errors import ToolError
from api.services.journal_two.widget_engine import plan as wplan

# -- the vocabulary -------------------------------------------------------------------------------

SLOT_TYPES = ("setup", "tag", "symbol", "account", "property", "folder", "note_kind", "routine",
              "tracker", "number")
TYPE_LABELS = {"setup": "Setup", "tag": "Tag", "symbol": "Symbol", "account": "Account",
               "property": "Property", "folder": "Folder", "note_kind": "Kind of note",
               "routine": "Routine", "tracker": "Tracker", "number": "Number"}
MAX_SLOTS = 20
PICK_TOKEN_RE = re.compile(r"\[#p(\d{1,2})\]")
#: The plan keys whose values are STRUCTURE and are copied as they are (each value is also checked
#: against its closed vocabulary by `validate_plan` first). Everything else in a shared plan is a
#: typed value this module writes itself: a pick, a kept number, a closed enum value, a bool.
CANARY_SAFE_KEYS = frozenset({
    "v", "source", "view", "display", "sort", "compare", "split.by", "split.then",
    "measures[].key", "measures[].agg", "filters[].field", "filters[].op", "range.token",
})

#: Restated closed sets (their authorities import the database); `test_constants_mirror_their_
#: authorities` pins each to its source, so a change there goes red here instead of drifting.
SUGGEST_RULES = ("stop_every_trade", "max_trades", "under_daily_loss_limit",
                 "no_trade_after_loss", "no_revenge")              # routine_insights.SUGGEST_RULES
DONE_SHARES = (1.0, 0.75, 0.5)                                       # routine_days.DONE_SHARES
SCHEDULE_KINDS = ("every", "weekdays", "traded")                     # routine_days.SCHEDULE_KINDS
TRACKER_KINDS = ("yesno", "number", "scale", "duration")             # tracker_days.KINDS
TRACKER_KIND_LABELS = {"yesno": "Yes / no", "number": "Number", "scale": "1-5 scale",
                       "duration": "Duration"}                       # tracker_days.KIND_LABELS
TRACKER_DAYS = ("trading", "any")                                    # trackers.DAYS_CHOICES
ITEMS_MAX = 25                                                       # routines.ITEMS_CAP
ITEM_TEXT_MAX = 200                                                  # routines.ITEM_MAX
SUGGEST_N_MAX = 1000                                                 # routines._clean_suggest
UNIT_MAX = 16                                                        # tracker_days.UNIT_MAX

NAME_MAX = 80
DESCRIPTION_MAX = 280
#: W11-R2: what a template's slot settings may say.
BINDS = ("note-day", "next-trading-day", "week")
ROUTINE_DISPLAYS = ("items", "pnl")
TRACKER_DISPLAYS = ("chart", "pnl")
FORMAT = 2

# -- member sentences ------------------------------------------------------------------------------
S_OWN_WORDS = "Field {n} uses your own words. Change that part before sharing."
S_UNRESOLVED = "Pick a value for each choice, or Any."
S_NEED_NUMBER = "Type a number for {label}."
S_NEED_VALUE = "Pick a value for {label}."
S_NO_ANY = "{label} needs a value of its own; Any isn't available for it."
S_NO_ITEMS = "Pick at least one item to share."
S_NAME_LONG = "A name can be at most 80 characters."
S_DESCRIPTION_LONG = "A description can be at most 280 characters."
S_TOO_MANY_ITEMS = "A routine can hold up to 25 items."
S_ITEM_LONG = "An item can be at most 200 characters."
S_UNIT_LONG = "A unit can be at most 16 characters."
S_TOO_MANY_CHOICES = ("This has more than 20 choices to make. Keep some of its numbers as they are, "
                      "then share again.")
S_BAD_TEXT = "That text couldn't be read."
S_BAD_CHARACTER = "That text has a character that can't be saved. Remove it and try again."
S_UNREADABLE = "This couldn't be read for sharing."
S_ROUTINE_UNREADABLE = "This routine couldn't be read."
S_TRACKER_UNREADABLE = "This tracker couldn't be read."
S_NOT_YOURS = {"widget": "This widget is not in your account.",
               "routine": "This routine is not in your account.",
               "tracker": "This tracker is not in your account."}
S_ADOPTED = {"widget": "This widget came from the library, so it can't be shared again.",
             "routine": "This routine came from the library, so it can't be shared again.",
             "tracker": "This tracker came from the library, so it can't be shared again."}

# What a share leaves out, in the preview's words (`Shared.not_shared`).
N_PICK = {
    "account": "Your account is left out; people pick their own.",
    "setup": "Your setups are left out; people pick their own.",
    "tag": "Your tags are left out; people pick their own.",
    "symbol": "Your symbols are left out; people pick their own.",
    "folder": "Your folders are left out; people pick their own.",
    "note_kind": "Your kinds of note are left out; people pick their own.",
    "property": "Your properties are left out; people pick their own.",
    "routine": "Your routine is left out; people pick their own.",
    "tracker": "Your tracker is left out; people pick their own.",
    "number": "Your numbers are left out; people type their own.",
}
N_DATES = "Your dates are left out; it shows the last 90 days."
N_DATE_FILTER = "A filter on your own dates is left out."
N_WORDS_FILTER = "A filter on your own words is left out."
N_VALUES_FILTER = "A filter on your own values is left out."
N_COMPARE = "The comparison with your own dates is left out."
N_TARGET = "Your target is left out."
N_TITLE = "Your own title and subtitle are left out."
N_FIELD_NAMES = "Your field names are left out."
N_UNREADABLE_WIDGET = "A widget that couldn't be read is left out."
N_ROUTINE_HISTORY = "Your ticks, history and reminders are left out."
N_UNPICKED_ITEMS = "Items you didn't pick are left out."
N_TRACKER_VALUES = "Your logged values are left out."

CODES = ("own_words", "adopted", "invalid", "unresolved", "not_yours")


class ShareError(ToolError):
    """A refusal a member reads (`.sentence`), with one of `CODES`; always a 400."""

    status = 400

    def __init__(self, code: str, sentence: str):
        super().__init__(sentence)
        self.code = code if code in CODES else "invalid"


@dataclass(frozen=True)
class Shared:
    payload: dict
    slots: tuple[dict, ...]
    kept: tuple[str, ...]
    not_shared: tuple[str, ...]


# -- small helpers ---------------------------------------------------------------------------------

def _is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _edit_text(raw: Any, limit: int, sentence: str) -> str | None:
    """An author's typed text: trimmed, None when empty, refused past `limit` or unencodable."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ShareError("invalid", S_BAD_TEXT)
    text = raw.strip()
    if not text:
        return None
    if len(text) > limit:
        raise ShareError("invalid", sentence)
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        raise ShareError("invalid", S_BAD_CHARACTER) from None
    return text


def _edits(raw: Any) -> dict:
    if raw is None:
        return {}
    if not isinstance(raw, Mapping):
        raise ShareError("invalid", S_BAD_TEXT)
    return dict(raw)


def _keep(raw: Iterable[str]) -> frozenset[str]:
    if raw is None:
        return frozenset()
    if isinstance(raw, str):
        raw = (raw,)
    try:
        return frozenset(k for k in raw if isinstance(k, str))
    except TypeError:
        raise ShareError("invalid", S_UNREADABLE) from None


def _closed_values(fld: Any) -> frozenset | None:
    """The closed set a field's values come from (`choices`, then `bucket`), or None."""
    out: set = set()
    found = False
    choices = getattr(fld, "choices", None)
    if choices is not None:
        found = True
        out.update(v for v, _label in (choices() if callable(choices) else choices))
    bucket = getattr(fld, "bucket", None)
    if bucket is not None:
        found = True
        out.update(bucket() if callable(bucket) else bucket)
    return frozenset(out) if found else None


def _say(sentences: list[str], sentence: str) -> None:
    if sentence not in sentences:
        sentences.append(sentence)


class _Slots:
    """Numbers the "pick yours" choices of one share (a template threads ONE of these through all
    its widgets, so one answer can fill several). A value seen twice (the same setup in two
    widgets, the routine a filter and a split both name) is one choice; numbers never merge."""

    def __init__(self, start: int = 1):
        if isinstance(start, bool) or not isinstance(start, int) or start < 1:
            raise ShareError("invalid", S_UNREADABLE)
        self.next = start
        self.all: list[dict] = []
        self._by_key: dict = {}

    def take(self, stype: str, *, any_ok: bool, label: str, source: str, field: str | None,
             key: Any = None, used: list[dict] | None = None) -> str:
        if key is not None and key in self._by_key:
            slot = self._by_key[key]
            slot["any"] = slot["any"] and any_ok
        else:
            if self.next > MAX_SLOTS:
                raise ShareError("invalid", S_TOO_MANY_CHOICES)
            slot = {"id": f"p{self.next}", "type": stype, "label": label, "any": any_ok,
                    "source": source, "field": field}
            self.next += 1
            self.all.append(slot)
            if key is not None:
                self._by_key[key] = slot
        if used is not None and slot not in used:
            used.append(slot)
        return slot["id"]


def _pick(sid: str) -> dict:
    return {"pick": sid}


def _is_pick(x: Any) -> bool:
    return isinstance(x, dict) and set(x) == {"pick"} and isinstance(x["pick"], str)


#: A field's `public_kind` (W10.7: its labels are the member's own names) -> its slot type.
_PUBLIC_KIND_SLOT = {"account": "account", "folder": "folder", "tag": "tag", "kind": "note_kind",
                     "routine": "routine", "tracker": "tracker"}


def _value_kind(name: str, fld: Any, ftype: str | None) -> tuple[str, str | None]:
    """How a filter's values travel: ("pick", type) | ("number", None) | ("keep", None) |
    ("closed", None) | ("property", None) | ("drop", sentence)."""
    if fld is None:                                  # a formula filter: its result type
        if ftype == "number":
            return "number", None
        if ftype == "bool":
            return "keep", None
        return "drop", N_WORDS_FILTER
    if name == wplan.PROPERTY_FIELD:
        return "property", None
    if ftype == "day":
        return "drop", N_DATE_FILTER
    if ftype == "bool":
        return "keep", None
    if ftype == "number":
        return "number", None
    slot = _PUBLIC_KIND_SLOT.get(getattr(fld, "public_kind", None))
    if slot is not None:
        return "pick", slot
    if ftype == "tag":
        return "pick", "tag"
    if name == "setup":
        return "pick", "setup"
    if ftype == "text":
        return ("pick", "symbol") if getattr(fld, "ci", False) else ("drop", N_WORDS_FILTER)
    if ftype == "enum" and _closed_values(fld) is not None:
        return "closed", None
    return "drop", N_VALUES_FILTER


# -- formulas --------------------------------------------------------------------------------------

def _text_allowed(value: str, other: tuple, fields: Mapping[str, Any]) -> bool:
    """A text literal is structure only as a closed value of what it is compared with."""
    if other[0] == "field":
        allowed = _closed_values(fields.get(other[2]))
    elif other[0] == "call" and other[2] == "Weekday":
        allowed = frozenset(wf.WEEKDAYS)
    else:
        allowed = None
    return allowed is not None and value in allowed


def _formula_parts(tree: tuple, fields: Mapping[str, Any]) -> tuple[list[tuple[int, int]], list, set]:
    """(number spans, text nodes, positions of allowed text) of a parsed formula. A number span
    takes in the unary minus signs before it, so `-2` is one value (an answer of -3 then reads
    `-3`, never `--3`)."""
    nums: list[tuple[int, int]] = []
    texts: list[tuple] = []
    allowed: set[int] = set()
    stack = [tree]
    while stack:
        node = stack.pop()
        kind = node[0]
        if kind == "num":
            nums.append((node[1], node[1] + len(node[3])))
        elif kind == "neg":
            inner = node[3]
            if inner[0] == "num":
                nums.append((node[1], inner[1] + len(inner[3])))
            else:
                stack.append(inner)
        elif kind == "text":
            texts.append(node)
        elif kind == "arith":
            stack.append(node[2])
            stack.extend(operand for _op, _pos, operand in node[3])
        elif kind == "cmp":
            left, right = node[4], node[5]
            for a, b in ((left, right), (right, left)):
                if a[0] == "text" and _text_allowed(a[2], b, fields):
                    allowed.add(a[1])
            stack.extend((left, right))
        elif kind == "call":
            stack.extend(node[3])
    return sorted(nums), texts, allowed


def _share_formula(f: dict, n: int, name: str, fields: Mapping[str, Any], keep: frozenset[str],
                   slots: _Slots, used: list[dict], kept: list[str], sentences: list[str],
                   source: str) -> tuple[dict, str]:
    """One formula entry, reduced: its own name replaced, numbers turned into `[#pN]` choices,
    text that is not a closed value refused. Returns (entry, result type)."""
    fid, expr = f["id"], f["expr"]
    compiled = wf.compile_formula(expr, wplan.formula_field_infos(fields))
    nums, texts, allowed = _formula_parts(compiled.ast.tree, fields)
    if any(t[1] not in allowed for t in texts):
        raise ShareError("own_words", S_OWN_WORDS.format(n=n))
    out: list[str] = []
    last = 0
    for start, end in nums:
        path = f"formulas/{fid}/{start}"
        if path in keep:
            kept.append(path)
            continue
        sid = slots.take("number", any_ok=False, label=name, source=source,
                         field=wplan.FORMULA_PREFIX + fid, used=used)
        out.append(expr[last:start])
        out.append(f"[#{sid}]")
        last = end
        _say(sentences, N_PICK["number"])
    out.append(expr[last:])
    return {"id": fid, "name": name, "expr": "".join(out), "format": f["format"]}, compiled.type


# -- share_plan ------------------------------------------------------------------------------------

def _validated(plan: Any, catalog: Any) -> dict:
    if not isinstance(plan, dict):
        raise ShareError("invalid", S_UNREADABLE)
    try:
        return wplan.validate_plan(copy.deepcopy(plan), catalog)
    except wplan.PlanError as e:
        raise ShareError("invalid", e.sentence) from None
    except (TypeError, ValueError, KeyError, AttributeError):
        raise ShareError("invalid", S_UNREADABLE) from None


def share_plan(plan: dict, *, catalog: Any, edits: dict | None = None, keep: Iterable[str] = (),
               slot_start: int = 1, _slots: _Slots | None = None) -> Shared:
    """A widget's plan as a shareable structure (`{name, description, plan, slots}`).

    The plan is validated first (a stored plan this server cannot read is refused). The shared plan
    is a NEW dict: structure is copied key by key (`CANARY_SAFE_KEYS`), every member value becomes a
    `{"pick": "p<n>"}` choice or a `[#p<n>]` formula token (or leaves with its filter), and only the
    author's `edits` (`name`, `description`, `formulas: {id: name}`) and `keep` paths
    (`"filters/<i>/values/<j>"`, `"formulas/<id>/<offset>"`, `"display/target"`) travel.
    `_slots` is the template's shared numbering (internal)."""
    edits = _edits(edits)
    keep = _keep(keep)
    slots = _slots if _slots is not None else _Slots(slot_start)
    used: list[dict] = []
    kept: list[str] = []
    sentences: list[str] = []
    p = _validated(plan, catalog)
    source = p["source"]
    fields = getattr(catalog.sources[source], "fields", {}) or {}
    unit = getattr(catalog.sources[source], "unit", "") or ""
    out: dict = {"v": p["v"], "source": source}

    # accounts: all, or one account -> a choice ("Any" is all of the adopter's accounts)
    if p["accounts"] == "all":
        out["accounts"] = "all"
    else:
        out["accounts"] = _pick(slots.take("account", any_ok=True, label=TYPE_LABELS["account"],
                                           source=source, field="account",
                                           key=("account", "account", p["accounts"]["id"]),
                                           used=used))
        _say(sentences, N_PICK["account"])

    # range: a token stays; fixed dates become the default token
    if "token" in p["range"]:
        out["range"] = {"token": p["range"]["token"]}
    else:
        out["range"] = {"token": wplan.DEFAULT_RANGE_TOKEN}
        _say(sentences, N_DATES)

    # formulas (first: filters, measures and choices on a formula use its shared name)
    formula_edits = edits.get("formulas") or {}
    if not isinstance(formula_edits, Mapping):
        raise ShareError("invalid", S_BAD_TEXT)
    formulas: list[dict] = []
    ftypes: dict[str, str] = {}
    fnames: dict[str, str] = {}
    for n, f in enumerate(p.get("formulas") or [], start=1):
        name = _edit_text(formula_edits.get(f["id"]), wf.NAME_MAX, wplan.S_FORMULA_NAME_LONG)
        if name is None:
            name = f"Field {n}"
            _say(sentences, N_FIELD_NAMES)
        entry, ftype = _share_formula(f, n, name, fields, keep, slots, used, kept, sentences, source)
        formulas.append(entry)
        ftypes[f["id"]], fnames[f["id"]] = ftype, name

    # filters
    shared_filters: list[dict] = []
    for i, f in enumerate(p["filters"]):
        name, op, values = f["field"], f["op"], f["values"]
        if name.startswith(wplan.FORMULA_PREFIX):
            fid = name[len(wplan.FORMULA_PREFIX):]
            fld, ftype, label = None, ftypes.get(fid), fnames.get(fid, name)
        else:
            fld = fields.get(name)
            ftype, label = getattr(fld, "type", None), (getattr(fld, "label", None) or name)
        how, why = _value_kind(name, fld, ftype)
        if how == "drop":
            _say(sentences, why)
            continue
        if how == "property" and any(isinstance(v, str) for v in values):
            _say(sentences, N_WORDS_FILTER)        # a property's text values are the member's words
            continue
        if how == "closed" and not all(v in _closed_values(fld) for v in values):
            _say(sentences, N_VALUES_FILTER)
            continue
        new: dict = {"field": name, "op": op, "overridable": f["overridable"]}
        if "ref" in f:
            ref = f["ref"]
            if ref in wplan.BUILTIN_TRACKER_REFS:
                new["ref"] = ref
            else:
                kind = getattr(fld, "ref_kind", None)
                new["ref"] = _pick(slots.take(kind, any_ok=False, label=TYPE_LABELS[kind],
                                              source=source, field=name, key=(kind, "ref", ref),
                                              used=used))
                _say(sentences, N_PICK[kind])
        if "prop" in f:
            new["prop"] = _pick(slots.take("property", any_ok=True, label=TYPE_LABELS["property"],
                                           source=source, field=name,
                                           key=("property", "prop", f["prop"]), used=used))
            _say(sentences, N_PICK["property"])
        if how == "pick":
            new["values"] = [_pick(slots.take(why, any_ok=True, label=TYPE_LABELS[why],
                                              source=source, field=name,
                                              key=(why, name, tuple(values)), used=used))]
            _say(sentences, N_PICK[why])
        elif how in ("closed", "keep"):
            new["values"] = list(values)
        else:                                       # numbers (and a property's numbers / bools)
            new["values"] = []
            for j, v in enumerate(values):
                path = f"filters/{i}/values/{j}"
                if isinstance(v, bool):
                    new["values"].append(v)
                elif path in keep:
                    kept.append(path)
                    new["values"].append(v)
                else:
                    new["values"].append(_pick(slots.take("number", any_ok=True, label=label,
                                                          source=source, field=name, used=used)))
                    _say(sentences, N_PICK["number"])
        shared_filters.append(new)
    out["filters"] = shared_filters

    # measures
    measures: list[dict] = []
    for m in p["measures"]:
        if "formula" in m:
            measures.append({k: m[k] for k in ("formula", "agg") if k in m})
        elif "prop" in m:
            measures.append({"key": m["key"], "prop": _pick(slots.take(
                "property", any_ok=False, label=TYPE_LABELS["property"], source=source,
                field="property", key=("property", "prop", m["prop"]), used=used))})
            _say(sentences, N_PICK["property"])
        else:
            measures.append({"key": m["key"]})
    out["measures"] = measures

    # split
    split = p["split"]
    if split is None:
        out["split"] = None
    else:
        s: dict = {"by": split["by"], "then": split["then"]}
        for ref_key, field_key in (("ref", "by"), ("ref2", "then")):
            if ref_key not in split:
                continue
            ref = split[ref_key]
            if ref in wplan.BUILTIN_TRACKER_REFS:
                s[ref_key] = ref
                continue
            kind = getattr(fields.get(split[field_key]), "ref_kind", None)
            s[ref_key] = _pick(slots.take(kind, any_ok=False, label=TYPE_LABELS[kind], source=source,
                                          field=split[field_key], key=(kind, "ref", ref), used=used))
            _say(sentences, N_PICK[kind])
        out["split"] = s

    out["view"] = {"type": p["view"]["type"], "auto": p["view"]["auto"]}
    out["sort"] = None if p["sort"] is None else {k: p["sort"][k] for k in ("measure", "dir", "top")}
    cmp = p["compare"]
    if cmp is not None and cmp["mode"] == "range":
        out["compare"] = None
        _say(sentences, N_COMPARE)
    else:
        out["compare"] = None if cmp is None else {"mode": cmp["mode"]}

    d = p["display"]
    display = {"title": "", "titleAuto": True, "subtitle": "", "accent": d["accent"],
               "showN": d["showN"], "target": None}
    if d["title"] or d["subtitle"] or d["titleAuto"] is False:
        _say(sentences, N_TITLE)
    if d["target"] is not None:
        if "display/target" in keep:
            display["target"] = d["target"]
            kept.append("display/target")
        else:
            _say(sentences, N_TARGET)
    for k in wplan.WAVE10_DISPLAY:
        if k in d:
            display[k] = d[k]
    out["display"] = display
    if formulas:
        out["formulas"] = formulas

    name = _edit_text(edits.get("name"), NAME_MAX, S_NAME_LONG)
    if name is None:
        name = wplan.default_name(out, catalog)[:NAME_MAX]
    description = _edit_text(edits.get("description"), DESCRIPTION_MAX, S_DESCRIPTION_LONG)
    if description is None:
        description = wplan.summary(out, catalog, None, unit)[:DESCRIPTION_MAX]
    used_slots = tuple(dict(s) for s in used)
    payload = {"name": name, "description": description, "plan": out, "slots": list(used_slots)}
    return Shared(payload, used_slots, tuple(dict.fromkeys(kept)), tuple(sentences))


# -- routines and trackers -------------------------------------------------------------------------

def _adopted(row: Mapping) -> bool:
    if row.get("sourceGalleryId") or row.get("source_gallery_id"):
        return True
    key = row.get("sourceTemplateKey") or row.get("source_template_key")
    return isinstance(key, str) and key.startswith("gal:")


def _schedule(raw: Any) -> dict:
    """The schedule KIND only (and a weekday schedule's days, Monday 0 to Friday 4)."""
    kind = raw.get("kind") if isinstance(raw, Mapping) else None
    if kind not in SCHEDULE_KINDS:
        return {"kind": "every"}
    if kind != "weekdays":
        return {"kind": kind}
    days = raw.get("days")
    clean = sorted({d for d in days if isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 4}
                   if isinstance(days, list) else set())
    return {"kind": "weekdays", "days": clean} if clean else {"kind": "every"}


def share_routine(routine: dict, *, edits: dict | None = None, keep: Iterable[str] = ()) -> Shared:
    """A routine as `{name, items, schedule, settings}`: exactly the item texts the author typed
    (`edits["items"]`, each a string or `{"text", "negative"}`, in the routine's own item order),
    never an id, a tick, a day or a reminder. An item's suggestion rule travels; its number only
    when `"items/<i>/suggest"` is kept."""
    if not isinstance(routine, Mapping):
        raise ShareError("invalid", S_ROUTINE_UNREADABLE)
    edits = _edits(edits)
    keep = _keep(keep)
    kept: list[str] = []
    sentences: list[str] = []
    raw_items = edits.get("items")
    if raw_items is not None and not isinstance(raw_items, list):
        raise ShareError("invalid", S_BAD_TEXT)
    stored = routine.get("items") if isinstance(routine.get("items"), list) else []
    items: list[dict] = []
    for i, e in enumerate(raw_items or []):
        text = e if not isinstance(e, Mapping) else e.get("text")
        text = _edit_text(text, ITEM_TEXT_MAX, S_ITEM_LONG)
        if text is None:
            continue
        src = stored[i] if i < len(stored) and isinstance(stored[i], Mapping) else {}
        neg = e.get("negative") if isinstance(e, Mapping) else None
        item: dict = {"text": text,
                      "negative": neg if isinstance(neg, bool) else bool(src.get("negative") is True)}
        sug = src.get("suggest")
        if isinstance(sug, Mapping) and sug.get("rule") in SUGGEST_RULES:
            item["suggest"] = {"rule": sug["rule"]}
            n = sug.get("n")
            if isinstance(n, int) and not isinstance(n, bool) and 0 < n <= SUGGEST_N_MAX:
                path = f"items/{i}/suggest"
                if path in keep:
                    item["suggest"]["n"] = n
                    kept.append(path)
                else:
                    _say(sentences, N_PICK["number"])
        items.append(item)
    if not items:
        raise ShareError("invalid", S_NO_ITEMS)
    if len(items) > ITEMS_MAX:
        raise ShareError("invalid", S_TOO_MANY_ITEMS)
    if len(stored) > len(items):
        _say(sentences, N_UNPICKED_ITEMS)
    _say(sentences, N_ROUTINE_HISTORY)
    name = _edit_text(edits.get("name"), NAME_MAX, S_NAME_LONG)
    if name is None:
        name = f"Routine with {len(items)} item" + ("" if len(items) == 1 else "s")
    settings = routine.get("settings") if isinstance(routine.get("settings"), Mapping) else {}
    share_ = settings.get("done_share")
    done = next((s for s in DONE_SHARES if _is_number(share_) and abs(float(share_) - s) < 1e-9), 1.0)
    payload = {"name": name, "items": items, "schedule": _schedule(routine.get("schedule")),
               "settings": {"done_share": done}}
    return Shared(payload, (), tuple(dict.fromkeys(kept)), tuple(sentences))


def share_tracker(tracker: dict, *, edits: dict | None = None) -> Shared:
    """A tracker as `{name, kind, unit, days}`: the author's typed name and unit, never a value."""
    if not isinstance(tracker, Mapping) or tracker.get("kind") not in TRACKER_KINDS:
        raise ShareError("invalid", S_TRACKER_UNREADABLE)
    edits = _edits(edits)
    kind = tracker["kind"]
    name = _edit_text(edits.get("name"), NAME_MAX, S_NAME_LONG) or f"{TRACKER_KIND_LABELS[kind]} tracker"
    unit = _edit_text(edits.get("unit"), UNIT_MAX, S_UNIT_LONG)
    settings = tracker.get("settings") if isinstance(tracker.get("settings"), Mapping) else {}
    days = settings.get("days") if settings.get("days") in TRACKER_DAYS else TRACKER_DAYS[0]
    return Shared({"name": name, "kind": kind, "unit": unit, "days": days}, (), (),
                  (N_TRACKER_VALUES,))


# -- templates -------------------------------------------------------------------------------------

_FAMILY_RE = re.compile(r"(built|routine|tracker)_[a-z0-9]{1,2}")
_BLOCK_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")
_SHELF_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
_TEMPLATE_KEY_RE = re.compile(r"[a-z0-9_]{1,40}")
_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _row(rows: Mapping[str, Any], ref: str, prefix: str, what: str) -> Mapping:
    """The member's own row a `<prefix>:<uuid>` ref names (keyed by the ref or by the id)."""
    rid = ref[len(prefix) + 1:]
    row = rows.get(ref) if isinstance(rows, Mapping) else None
    if row is None and isinstance(rows, Mapping):
        row = rows.get(rid)
    if not _UUID_RE.fullmatch(rid) or not isinstance(row, Mapping):
        raise ShareError("not_yours", S_NOT_YOURS[what])
    if _adopted(row):
        raise ShareError("adopted", S_ADOPTED[what])
    return row


def _range_token(raw: Any) -> dict | None:
    if isinstance(raw, Mapping) and set(raw) == {"token"} and raw["token"] in wplan.RANGE_TOKENS:
        return {"token": raw["token"]}
    return None


def _choice(raw: Any, allowed: tuple[str, ...]) -> str:
    return raw if raw in allowed else allowed[0]


def _block_keep(keep: frozenset[str], bid: str) -> frozenset[str]:
    pre = bid + "/"
    return frozenset(k[len(pre):] for k in keep if k.startswith(pre))


def share_template(style: dict, *, definitions: Mapping[str, dict], routines: Mapping[str, dict],
                   trackers: Mapping[str, dict], edits: dict | None = None, keep: Iterable[str] = (),
                   catalog: Any = None) -> Shared:
    """A template (one of the member's journal styles) as format 2.

    Each `def:` widget slot becomes `inline:d<n>` with its plan reduced by `share_plan` into
    `payload["definitions"]`; `shelf:` slots keep their `defRev`; `routine:` / `tracker:` slots
    become `{"inline": "r<n>" | "t<n>"}` reduced by `share_routine` / `share_tracker`; `template`
    and `checkin:*` refs stay; `bind` and `display` stay; `range` stays as a token. One numbering
    of choices runs across every widget, so one answer fills them all. Edits and keep for a slot are
    `edits["blocks"][<block id>]` and `"<block id>/<path>"`. Any other block travels with empty
    settings (the adopter's defaults fill it). The outline is the caller's (`sanitize_body`)."""
    if not isinstance(style, Mapping):
        raise ShareError("invalid", S_UNREADABLE)
    if catalog is None:
        from api.services.journal_two.widget_engine.sources import CATALOG as catalog
    edits = _edits(edits)
    block_edits = edits.get("blocks") or {}
    if not isinstance(block_edits, Mapping):
        raise ShareError("invalid", S_BAD_TEXT)
    keep = _keep(keep)
    slots = _Slots(1)
    kept: list[str] = []
    sentences: list[str] = []
    blocks: list[dict] = []
    defs: list[dict] = []
    rts: list[dict] = []
    tks: list[dict] = []
    inline: dict[str, str] = {}
    raw_blocks = style.get("blocks") if isinstance(style.get("blocks"), list) else []

    def sub(bid: str, found: Shared) -> None:
        kept.extend(f"{bid}/{k}" for k in found.kept)
        for s in found.not_shared:
            _say(sentences, s)

    for b in raw_blocks:
        if not isinstance(b, Mapping) or not isinstance(b.get("block"), str):
            continue
        bid = b["block"]
        enabled = b.get("enabled", True) is not False
        st = b.get("settings") if isinstance(b.get("settings"), Mapping) else {}
        fam = _FAMILY_RE.fullmatch(bid)
        if fam is None:
            if _BLOCK_RE.fullmatch(bid):
                blocks.append({"block": bid, "enabled": enabled, "settings": {}})
            continue
        family, mine = fam.group(1), block_edits.get(bid)
        if family == "built":
            ref, rng = st.get("ref"), _range_token(st.get("range"))
            if isinstance(ref, str) and ref.startswith("shelf:") and _SHELF_RE.fullmatch(ref[6:]):
                rev = st.get("defRev")
                if isinstance(rev, bool) or not isinstance(rev, int) or rev < 1:
                    _say(sentences, N_UNREADABLE_WIDGET)
                    continue
                out = {"ref": ref, "defRev": rev}
            elif isinstance(ref, str) and ref.startswith("def:"):
                row = _row(definitions, ref, "def", "widget")
                if ref not in inline:
                    found = share_plan(row.get("plan"), catalog=catalog, edits=mine,
                                       keep=_block_keep(keep, bid), _slots=slots)
                    sub(bid, found)
                    inline[ref] = f"d{len(defs) + 1}"
                    defs.append({"key": inline[ref], "plan": found.payload["plan"],
                                 "name": found.payload["name"],
                                 "description": found.payload["description"]})
                out = {"ref": f"inline:{inline[ref]}"}
            else:
                _say(sentences, N_UNREADABLE_WIDGET)
                continue
            if rng is not None:
                out["range"] = rng
        else:
            displays = ROUTINE_DISPLAYS if family == "routine" else TRACKER_DISPLAYS
            ref, tpl = st.get("ref"), st.get("template")
            if isinstance(ref, str) and ref.startswith(family + ":"):
                if ref not in inline:
                    row = _row(routines if family == "routine" else trackers, ref, family, family)
                    if family == "routine":
                        found = share_routine(row, edits=mine, keep=_block_keep(keep, bid))
                        target = rts
                    else:
                        found = share_tracker(row, edits=mine)
                        target = tks
                    sub(bid, found)
                    inline[ref] = f"{family[0]}{len(target) + 1}"
                    target.append({"key": inline[ref], **found.payload})
                out = {"inline": inline[ref]}
            elif family == "tracker" and ref in wplan.BUILTIN_TRACKER_REFS:
                out = {"ref": ref}
            elif isinstance(tpl, str) and _TEMPLATE_KEY_RE.fullmatch(tpl):
                out = {"template": tpl}
            else:
                _say(sentences, N_UNREADABLE_WIDGET)
                continue
            out["bind"] = _choice(st.get("bind"), BINDS)
            out["display"] = _choice(st.get("display"), displays)
        blocks.append({"block": bid, "enabled": enabled, "settings": out})

    payload = {
        "format": FORMAT,
        "name": _edit_text(edits.get("name"), NAME_MAX, S_NAME_LONG) or "Template",
        "description": _edit_text(edits.get("description"), DESCRIPTION_MAX, S_DESCRIPTION_LONG) or "",
        "blocks": blocks, "definitions": defs, "routines": rts, "trackers": tks,
        "slots": [dict(s) for s in slots.all],
    }
    return Shared(payload, tuple(dict(s) for s in slots.all), tuple(dict.fromkeys(kept)),
                  tuple(sentences))


# -- resolve ---------------------------------------------------------------------------------------

def _plain(x: float | int) -> str:
    """A number's plain decimal text (no exponent): what replaces a `[#pN]` token."""
    if isinstance(x, int):
        return str(x)
    if x.is_integer():
        return str(int(x))
    text = repr(x)
    return format(Decimal(text), "f") if "e" in text or "E" in text else text


def has_unresolved(obj: Any) -> bool:
    """Does `obj` hold a pick marker (`{"pick": ...}`) or a `[#p` token anywhere? Total."""
    stack, seen = [obj], set()
    while stack:
        v = stack.pop()
        if isinstance(v, str):
            if "[#p" in v:
                return True
        elif isinstance(v, (dict, list, tuple)):
            if id(v) in seen:
                continue
            seen.add(id(v))
            if isinstance(v, dict):
                if "pick" in v:
                    return True
                stack.extend(v.keys())
                stack.extend(v.values())
            else:
                stack.extend(v)
    return False


def resolve_plan(plan: dict, slots: Sequence[dict], answers: Mapping[str, Any], *,
                 catalog: Any) -> dict:
    """A shared plan with the adopter's answers in place of every choice, validated.

    An answer is `{"any": true}` (drop that filter, or all accounts; only where the choice allows
    Any), a number (a number choice; its plain decimal text in a formula), or the value itself (a
    text, or a list of texts for a filter that takes several). Whether an answered id is the
    adopter's own is the CALLER's check (Task 11.8)."""
    if not isinstance(plan, Mapping):
        raise ShareError("invalid", S_UNREADABLE)
    if not isinstance(answers, Mapping):
        raise ShareError("unresolved", S_UNRESOLVED)
    by_id = {s["id"]: s for s in (slots or ()) if isinstance(s, Mapping) and isinstance(s.get("id"), str)}
    out = copy.deepcopy(dict(plan))

    def answer(sid: str) -> tuple[Mapping, Any, bool]:
        """(slot, answer, is Any) for one choice; refuses an unanswered one and a forbidden Any."""
        if sid not in answers or sid not in by_id:
            raise ShareError("unresolved", S_UNRESOLVED)
        slot, a = by_id[sid], answers[sid]
        label = slot.get("label") or TYPE_LABELS.get(slot.get("type"), "this choice")
        if isinstance(a, Mapping) and a.get("any") is True:
            if slot.get("any") is not True:
                raise ShareError("invalid", S_NO_ANY.format(label=label))
            return slot, None, True
        if slot.get("type") == "number":
            if not _is_number(a):
                raise ShareError("invalid", S_NEED_NUMBER.format(label=label))
            return slot, a, False
        if isinstance(a, str) and a.strip():
            return slot, a, False
        if isinstance(a, list) and a and all(isinstance(x, str) and x.strip() for x in a):
            return slot, list(a), False
        raise ShareError("invalid", S_NEED_VALUE.format(label=label))

    def one_text(sid: str) -> str:
        slot, a, _any = answer(sid)
        if not isinstance(a, str):
            label = slot.get("label") or TYPE_LABELS.get(slot.get("type"), "this choice")
            raise ShareError("invalid", S_NEED_VALUE.format(label=label))
        return a

    acc = out.get("accounts")
    if _is_pick(acc):
        _slot, a, is_any = answer(acc["pick"])
        if not is_any and not isinstance(a, str):
            raise ShareError("invalid", S_NEED_VALUE.format(label=TYPE_LABELS["account"]))
        out["accounts"] = "all" if is_any else {"id": a}

    filters: list = []
    for f in out.get("filters") or []:
        if not isinstance(f, dict):
            filters.append(f)
            continue
        dropped = False
        if _is_pick(f.get("ref")):
            f["ref"] = one_text(f["ref"]["pick"])
        if _is_pick(f.get("prop")):
            _slot, a, is_any = answer(f["prop"]["pick"])
            if is_any:
                continue
            if not isinstance(a, str):
                raise ShareError("invalid", S_NEED_VALUE.format(label=TYPE_LABELS["property"]))
            f["prop"] = a
        values: list = []
        for v in f.get("values") or []:
            if not _is_pick(v):
                values.append(v)
                continue
            _slot, a, is_any = answer(v["pick"])
            if is_any:
                dropped = True
                break
            values.extend(a if isinstance(a, list) else [a])
        if dropped:
            continue
        f["values"] = values
        filters.append(f)
    if "filters" in out:
        out["filters"] = filters

    for m in out.get("measures") or []:
        if isinstance(m, dict) and _is_pick(m.get("prop")):
            m["prop"] = one_text(m["prop"]["pick"])
    split = out.get("split")
    if isinstance(split, dict):
        for k in ("ref", "ref2"):
            if _is_pick(split.get(k)):
                split[k] = one_text(split[k]["pick"])

    def token(m: re.Match) -> str:
        _slot, a, _any = answer("p" + m.group(1))
        return _plain(a)

    for f in out.get("formulas") or []:
        if isinstance(f, dict) and isinstance(f.get("expr"), str):
            f["expr"] = PICK_TOKEN_RE.sub(token, f["expr"])

    try:
        resolved = wplan.validate_plan(out, catalog)
    except wplan.PlanError as e:
        raise ShareError("invalid", e.sentence) from None
    except (TypeError, ValueError, KeyError, AttributeError):
        raise ShareError("invalid", S_UNREADABLE) from None
    # THE rail (one copy): a marker `validate_plan` let through (a `[#p` in a formula's name, a
    # pick in a place no answer reaches) never leaves this function.
    if has_unresolved(resolved):
        raise ShareError("unresolved", S_UNRESOLVED)
    return resolved
