"""The `where` grammar -- a typed criteria language that compiles to a screen's
logic tree (FT-029, and the text half of FT-024/FT-030).

    price > 10 and avg_volume_30d >= 1.5m and (rs_rank >= 90 or eps_growth > 25%)
    and not sector in [Utilities, "Real Estate"]
    and gross_margin > op_margin

THE LANGUAGE.
  * A FIELD is a screener filter key (`GET /api/screener/grammar` lists every
    one with its type and unit). Case-insensitive. An unknown field is refused
    with the nearest real names -- never guessed.
  * Comparisons: `> >= < <= = == !=`, `between A and B`, `in [..]`,
    `not in [..]`, `contains "text"`.
  * Number shortcuts: `k` (thousand), `m` (million), `b` (billion), `t`
    (trillion), and `%` -- which is accepted only on a field whose unit IS
    percent, where it is the same number (`eps_growth > 25%` is 25). `%` on a
    price or a count is refused: `price > 5%` has no honest reading.
  * Field-to-field: `gross_margin > op_margin` compares two columns (the
    screener's existing `*_col` operators; range fields only, both sides).
  * Boolean: `and`, `or`, `not`, parentheses. `and` binds tighter than `or`.
  * Booleans fields: `field = true|false|yes|no`.

WHAT IT COMPILES TO. A `logic` node (see `logic.py`) whose leaves are exactly
the filter dicts the screener's flat list holds, so the grammar adds no second
evaluator: the compiled tree runs through `query.build_where` like any screen.

NOT YET IN THE LANGUAGE (stated, so nobody assumes it): arithmetic between
fields (`size * price > 50k`), and the `$AAPL` / `@sector` / `#mylist` scope
prefixes. A text using them is refused with the reason.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

from . import filters

SUFFIX = {"k": 1e3, "m": 1e6, "b": 1e9, "t": 1e12}
CMP = {">": "gt", ">=": "gte", "<": "lt", "<=": "lte", "=": "eq", "==": "eq", "!=": "ne"}
COL_OP = {"gt": "gt_col", "gte": "gte_col", "lt": "lt_col", "lte": "lte_col"}
KEYWORDS = {"and", "or", "not", "in", "between", "contains", "true", "false", "yes", "no"}
MAX_TEXT = 2000

_TOKEN = re.compile(r"""
    (?P<ws>\s+)
  | (?P<num>-?(?:\d+\.?\d*|\.\d+)(?:[kKmMbBtT](?![A-Za-z_])|%)?)
  | (?P<str>"[^"]*"|'[^']*')
  | (?P<op>>=|<=|==|!=|>|<|=)
  | (?P<punct>[()\[\],])
  | (?P<scope>[$@#][A-Za-z0-9_.\-]+)
  | (?P<arith>[*/+])
  | (?P<word>[A-Za-z_][A-Za-z0-9_.\-]*)
""", re.VERBOSE)


class GrammarError(ValueError):
    """A sentence the member can act on, with the character position."""


@dataclass
class Tok:
    kind: str
    text: str
    pos: int


def tokenize(text: str) -> list[Tok]:
    if len(text) > MAX_TEXT:
        raise GrammarError(f"criteria text is limited to {MAX_TEXT} characters")
    out, i = [], 0
    while i < len(text):
        m = _TOKEN.match(text, i)
        if not m:
            raise GrammarError(f"I can't read '{text[i]}' at position {i + 1}")
        kind = m.lastgroup
        if kind == "scope":
            raise GrammarError(
                f"scope prefixes like '{m.group()}' are not in the language yet; "
                "use a field such as sector in [..] instead")
        if kind == "arith":
            raise GrammarError(
                "arithmetic between fields (like size * price) is not in the "
                "language yet; compare two fields directly instead")
        if kind != "ws":
            out.append(Tok(kind, m.group(), m.start()))
        i = m.end()
    return out


def _field_names() -> dict[str, str]:
    return {k.lower(): k for k in filters.FILTERS}


def _resolve_field(tok: Tok) -> str:
    names = _field_names()
    key = names.get(tok.text.lower())
    if key is None:
        near = difflib.get_close_matches(tok.text.lower(), list(names), n=3, cutoff=0.6)
        hint = f"; did you mean {', '.join(names[n] for n in near)}?" if near else ""
        raise GrammarError(f"'{tok.text}' is not a screener field{hint}")
    if key in getattr(filters, "RETIRED", {}):
        raise GrammarError(f"'{key}' has been retired")
    return key


def _number(tok: Tok, key: str) -> float:
    t = tok.text
    mult, pct = 1.0, False
    if t[-1] == "%":
        pct, t = True, t[:-1]
    elif t[-1].lower() in SUFFIX:
        mult, t = SUFFIX[t[-1].lower()], t[:-1]
    if pct and filters.FILTERS[key].get("unit") != "%":
        raise GrammarError(
            f"'{tok.text}' uses %, but {filters.FILTERS[key]['label']} is not a "
            "percentage field")
    v = float(t) * mult
    return int(v) if v.is_integer() and abs(v) < 1e15 else v


class _Parser:
    def __init__(self, toks: list[Tok]):
        self.toks, self.i = toks, 0

    def peek(self, k=0):
        j = self.i + k
        return self.toks[j] if j < len(self.toks) else None

    def word(self, w, k=0):
        t = self.peek(k)
        return t is not None and t.kind == "word" and t.text.lower() == w

    def take(self, kind=None, text=None, label=None):
        """`text` is a LITERAL the token must equal; `label` only names what
        was expected in the refusal sentence."""
        t = self.peek()
        if t is None:
            raise GrammarError("the criteria end too early")
        if kind and t.kind != kind:
            raise GrammarError(f"expected {label or text or kind} at position {t.pos + 1}, found '{t.text}'")
        if text and t.text.lower() != text:
            raise GrammarError(f"expected '{text}' at position {t.pos + 1}, found '{t.text}'")
        self.i += 1
        return t

    def parse(self):
        if not self.toks:
            raise GrammarError("no criteria given")
        node = self.or_()
        t = self.peek()
        if t is not None:
            raise GrammarError(f"unexpected '{t.text}' at position {t.pos + 1}")
        return node

    def or_(self):
        kids = [self.and_()]
        while self.word("or"):
            self.i += 1
            kids.append(self.and_())
        return kids[0] if len(kids) == 1 else {"any": kids}

    def and_(self):
        kids = [self.unary()]
        while self.word("and"):
            self.i += 1
            kids.append(self.unary())
        return kids[0] if len(kids) == 1 else {"all": kids}

    def unary(self):
        if self.word("not"):
            self.i += 1
            return {"not": self.unary()}
        t = self.peek()
        if t is not None and t.kind == "punct" and t.text == "(":
            self.i += 1
            node = self.or_()
            self.take("punct", ")")
            return node
        return self.comparison()

    def _list(self):
        self.take("punct", "[")
        vals = []
        while True:
            t = self.take()
            if t.kind == "str":
                vals.append(t.text[1:-1])
            elif t.kind in ("word", "num"):
                vals.append(t.text)
            else:
                raise GrammarError(f"expected a value at position {t.pos + 1}")
            t = self.take("punct")
            if t.text == "]":
                return vals
            if t.text != ",":
                raise GrammarError(f"expected ',' or ']' at position {t.pos + 1}")

    def comparison(self):
        ft = self.take("word", label="a field name")
        if ft.text.lower() in KEYWORDS:
            raise GrammarError(f"expected a field name at position {ft.pos + 1}, found '{ft.text}'")
        key = _resolve_field(ft)
        ftype = filters.FILTERS[key]["type"]
        # not in [..]
        if self.word("not") and self.word("in", 1):
            self.i += 2
            return {"key": key, "op": "not_in", "values": self._list()}
        if self.word("in"):
            self.i += 1
            return {"key": key, "op": "in", "values": self._list()}
        if self.word("contains"):
            self.i += 1
            v = self.take("str", label="a quoted value")
            return {"key": key, "op": "contains", "value": v.text[1:-1]}
        if self.word("between"):
            self.i += 1
            lo = _number(self.take("num", label="a number"), key)
            self.take("word", "and")
            hi = _number(self.take("num", label="a number"), key)
            if lo > hi:
                lo, hi = hi, lo
            return {"key": key, "op": "between", "min": lo, "max": hi}
        opt = self.take("op", label="a comparison like >, <= or =")
        op = CMP[opt.text]
        rhs = self.take()
        if rhs.kind == "word" and rhs.text.lower() in ("true", "false", "yes", "no"):
            if ftype != "bool":
                raise GrammarError(f"{filters.FILTERS[key]['label']} is not a yes/no field")
            if op not in ("eq", "ne"):
                raise GrammarError("a yes/no field takes = or !=")
            truth = rhs.text.lower() in ("true", "yes")
            if op == "ne":
                truth = not truth
            return {"key": key, "op": "eq", "value": 1 if truth else 0}
        if rhs.kind == "word":
            other = _resolve_field(rhs)
            if op not in COL_OP:
                raise GrammarError("two fields can be compared with > >= < <= only")
            if other not in filters.comparable_keys() or key not in filters.comparable_keys():
                raise GrammarError(
                    f"{filters.FILTERS[key]['label']} and {filters.FILTERS[other]['label']} "
                    "cannot be compared")
            return {"key": key, "op": COL_OP[op], "other": other}
        if rhs.kind == "str":
            if ftype != "enum":
                raise GrammarError(f"{filters.FILTERS[key]['label']} takes a number, not text")
            leaf = {"key": key, "op": "in", "values": [rhs.text[1:-1]]}
            return {"not": leaf} if op == "ne" else leaf
        if rhs.kind != "num":
            raise GrammarError(f"expected a value at position {rhs.pos + 1}")
        if ftype != "range":
            raise GrammarError(f"{filters.FILTERS[key]['label']} does not take a number")
        v = _number(rhs, key)
        if op == "ne":
            return {"not": {"key": key, "op": "eq", "value": v}}
        operand = "max" if op in ("lt", "lte") else ("value" if op == "eq" else "min")
        return {"key": key, "op": op, operand: v}


def parse(text: str) -> dict:
    """Text -> a `logic` node. Raises GrammarError (a ValueError) with a sentence."""
    return _Parser(tokenize(text or "")).parse()


# ── the explanation: one sentence per criterion (the FT-024 panel's half) ──

_OP_WORDS = {"gt": "is above", "gte": "is at least", "lt": "is below", "lte": "is at most",
             "eq": "equals", "gt_col": "is above", "gte_col": "is at least",
             "lt_col": "is below", "lte_col": "is at most"}


def _fmt(v, unit):
    if isinstance(v, (int, float)):
        a = abs(v)
        if unit == "%":
            return f"{v:g}%"
        s = (f"{v / 1e12:g}T" if a >= 1e12 else f"{v / 1e9:g}B" if a >= 1e9
             else f"{v / 1e6:g}M" if a >= 1e6 else f"{v / 1e3:g}K" if a >= 1e4 else f"{v:g}")
        return ("$" + s) if unit == "$" else s
    return str(v)


def explain_leaf(leaf: dict) -> str:
    f = filters.FILTERS.get(leaf["key"], {"label": leaf["key"], "unit": None})
    label, unit, op = f["label"], f.get("unit"), leaf["op"]
    if op in filters.COL_OPS:
        other = filters.FILTERS.get(leaf["other"], {"label": leaf["other"]})["label"]
        return f"{label} {_OP_WORDS[op]} {other}"
    if op == "between":
        return f"{label} is between {_fmt(leaf['min'], unit)} and {_fmt(leaf['max'], unit)}"
    if op == "in":
        return f"{label} is one of {', '.join(map(str, leaf['values']))}"
    if op == "not_in":
        return f"{label} is none of {', '.join(map(str, leaf['values']))}"
    if op == "contains":
        return f"{label} contains \"{leaf['value']}\""
    if f.get("type") == "bool":
        return f"{label}: {'yes' if leaf.get('value') else 'no'}"
    v = leaf.get("min", leaf.get("max", leaf.get("value")))
    return f"{label} {_OP_WORDS[op]} {_fmt(v, unit)}"


def explain(node, depth=0) -> list[dict]:
    """A flat, indented outline of the tree: [{depth, text}], one line per group
    header and per criterion, in the order the member wrote them."""
    if "key" in node:
        return [{"depth": depth, "text": explain_leaf(node)}]
    if "not" in node:
        inner = node["not"]
        if "key" in inner:
            return [{"depth": depth, "text": "NOT: " + explain_leaf(inner)}]
        return [{"depth": depth, "text": "None of the following:"}] + explain(inner, depth + 1)
    k = next(iter(node))
    head = {"all": "All of the following:", "any": "Any of the following:",
            "none": "None of the following:"}[k]
    out = [{"depth": depth, "text": head}]
    for c in node[k]:
        out.extend(explain(c, depth + 1))
    return out


def describe() -> dict:
    """The machine-readable grammar (`GET /api/screener/grammar`)."""
    return {
        "version": 1,
        "operators": sorted(CMP) + ["between .. and ..", "in [..]", "not in [..]", "contains \"..\""],
        "boolean": ["and", "or", "not", "( )"],
        "number_suffixes": {**{k: v for k, v in SUFFIX.items()},
                            "%": "percent fields only; the same number (25% is 25)"},
        "field_to_field": sorted(COL_OP),
        "not_supported": ["arithmetic between fields", "$ticker / @group / #list scope prefixes"],
        "max_criteria": 25,
        "fields": [{"key": k, "label": f["label"], "type": f["type"], "unit": f.get("unit")}
                   for k, f in filters.FILTERS.items()],
    }
