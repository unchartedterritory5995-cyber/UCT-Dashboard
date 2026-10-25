"""The widget formula dialect (wave 10, Task 10.2): "your own fields" in a built widget.

A small spreadsheet-style language: `[Field]` references, numbers, texts, yes/no, the four
arithmetic operators, six comparisons and exactly the 15 functions of `FUNCTIONS`. It is a
SEPARATE dialect from the note-property formula language (`formula_engine.py`, spec §16.2):
nothing here imports it and nothing there moves.

Pure. Standard library only, no I/O, no clock, no `eval` / `exec` / `compile` / `getattr`
(`tests/test_widget_formula_hostile.py` walks this file's AST to prove it). Work is bounded:

* the text is at most `MAX_LENGTH` characters, at most `MAX_TOKENS` tokens, and parentheses
  nest at most `MAX_DEPTH` deep. The tokenizer counts the depth BEFORE the parser runs, so the
  parser's recursion (which only happens through a `(`) is bounded by the counter, never by
  Python's stack. `RecursionError` is caught as `too_deep`, a backstop only.
* operator chains (`1 + 2 + 3 ...`) are flat n-ary nodes built by a loop and unary minus is a
  counted run, so the tree's height is bounded by the parenthesis depth, not by the length.
* the tree is compiled ONCE into closures (a static dispatch table, `_FN`); a row evaluation
  is a fixed number of calls, and `eval_group` is one pass over the rows calling `check()`
  every `CHECK_EVERY` rows (W9-R17).

Values: `number` (float), `text` (str), `bool`, and `day` (a valid `YYYY-MM-DD` string, from a
day field only; it can be compared or given to `Hour` / `Weekday` but is never a result).
`None` is "no data": an empty input, a divide by zero and every non-finite intermediate give
`None`, never `inf`, never `nan`, and never a made-up `0`. `-0` is printed as `0`.

Positions and lengths count Unicode CODE POINTS (Python string indices). The client twin
(`lib/widgetFormula/widgetFormula.js`, Task 10.3) walks `Array.from(expr)` so both agree on an
astral character such as an emoji; the shared vectors pin it.

A stored formula is CANONICAL (ruling W10-R2): fields by key (`[net]`), functions in title
case (`SumIf`), `TRUE` / `FALSE` upper case, everything else exactly as typed, outer
whitespace trimmed. `display()` turns keys back into labels for the member.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable, Literal, Mapping, Sequence

from api.services.journal_two.widget_engine.plan import PlanError

# ---------------------------------------------------------------------------------------------
# Limits (spec §5.5). The client twin exports the same numbers as `LIMITS`.
MAX_LENGTH = 2000
MAX_TOKENS = 500
MAX_DEPTH = 32
MAX_FORMULAS = 5
NAME_MAX = 60
MAX_TEXT = 200
BUCKET_EDGES_MAX = 10
ROUND_DIGITS_MAX = 6
CHECK_EVERY = 256
#: A number literal may carry at most this many significant digits, so both twins parse every
#: literal to the same double and print a Bucket edge exactly as typed.
SIG_DIGITS_MAX = 15
#: Member text quoted back in a sentence is clipped to this many characters.
SHOWN_MAX = 20

FUNCTIONS: tuple[str, ...] = (
    "If", "And", "Or", "Not", "Abs", "Round", "Min", "Max",
    "CountIf", "SumIf", "AvgIf", "Share", "Bucket", "Hour", "Weekday",
)
AGGREGATES = frozenset({"CountIf", "SumIf", "AvgIf", "Share"})

#: (fewest, most) arguments per function.
ARITY: dict[str, tuple[int, int]] = {
    "If": (3, 3), "And": (2, 8), "Or": (2, 8), "Not": (1, 1), "Abs": (1, 1), "Round": (1, 2),
    "Min": (2, 8), "Max": (2, 8), "CountIf": (1, 1), "SumIf": (1, 2), "AvgIf": (1, 2),
    "Share": (1, 1), "Bucket": (2, 1 + BUCKET_EDGES_MAX), "Hour": (1, 1), "Weekday": (1, 1),
}
ARITY_WORDS: dict[str, str] = {
    "If": "3 values", "And": "2 to 8 values", "Or": "2 to 8 values", "Not": "1 value",
    "Abs": "1 value", "Round": "1 or 2 values", "Min": "2 to 8 values", "Max": "2 to 8 values",
    "CountIf": "1 value", "SumIf": "a value and an optional condition",
    "AvgIf": "a value and an optional condition", "Share": "1 value",
    "Bucket": "a value and 1 to 10 edges", "Hour": "1 value", "Weekday": "1 value",
}

FUNCTION_DOCS: tuple[dict, ...] = (
    {"name": "If", "usage": "If(condition, then, otherwise)",
     "meaning": "One value when the condition holds, another when it doesn't."},
    {"name": "And", "usage": "And(condition, condition, …)",
     "meaning": "Yes when every condition holds."},
    {"name": "Or", "usage": "Or(condition, condition, …)",
     "meaning": "Yes when any condition holds."},
    {"name": "Not", "usage": "Not(condition)", "meaning": "The opposite of a condition."},
    {"name": "Abs", "usage": "Abs(number)", "meaning": "The number without its sign."},
    {"name": "Round", "usage": "Round(number, places)",
     "meaning": "Rounded to 0 to 6 decimal places (0 when left out)."},
    {"name": "Min", "usage": "Min(number, number, …)",
     "meaning": "The smallest of the values; empty values are skipped."},
    {"name": "Max", "usage": "Max(number, number, …)",
     "meaning": "The largest of the values; empty values are skipped."},
    {"name": "CountIf", "usage": "CountIf(condition)",
     "meaning": "How many rows meet the condition."},
    {"name": "SumIf", "usage": "SumIf(value, condition)",
     "meaning": "The value added up over the rows that meet the condition, or over all rows."},
    {"name": "AvgIf", "usage": "AvgIf(value, condition)",
     "meaning": "The average of the value over the rows that meet the condition, or over all rows."},
    {"name": "Share", "usage": "Share(condition)",
     "meaning": "The share of rows that meet the condition, from 0 to 1."},
    {"name": "Bucket", "usage": "Bucket(number, edge, …)",
     "meaning": "Puts a number into ranges: under the first edge, between edges, or the last edge or more."},
    {"name": "Hour", "usage": "Hour(day)",
     "meaning": "The ET hour, 0 to 23; empty for trades with dates only."},
    {"name": "Weekday", "usage": "Weekday(day)",
     "meaning": "The weekday of a day, Monday to Sunday."},
)

#: code -> sentence template. `{x}` is the member's own text (clipped, see `_shown`), `{label}`
#: a field label, `{Fn}` a function name, `{what}` a function name or an operator, `{n}` the
#: `ARITY_WORDS` entry.
ERRORS: dict[str, str] = {
    "empty": "Type a formula.",
    "too_long": "A formula can be at most 2,000 characters.",
    "too_many_parts": "This formula has too many parts. Split it into two fields.",
    "too_deep": "This formula is nested too deeply.",
    "bad_char": "{x} can't be used in a formula.",
    "unclosed_field": "A [ is missing its ].",
    "unclosed_paren": "A ( is missing its ).",
    "extra_paren": "There is a ) without its (.",
    "unclosed_text": "A quote is missing its closing \".",
    "text_too_long": "Text in a formula can be at most 200 characters.",
    "bad_number": "{x} isn't a number a formula can use.",
    "unexpected": "Something is missing near \"{x}\".",
    "chained_compare": "Two comparisons can't be chained; join them with And.",
    "trailing": "There is something extra at the end: \"{x}\".",
    "unknown_field": "[{x}] isn't a field here.",
    "tag_field": "[{label}] holds several values; use it as a filter instead.",
    "unknown_function": "{x} isn't a function. Try If, Round or SumIf.",
    "bare_field": "Put field names in brackets, like [{x}].",
    "arg_count": "{Fn} takes {n}.",
    "needs_number": "{what} needs a number.",
    "needs_condition": "{what} needs a yes/no condition.",
    "needs_day": "{Fn} needs a day.",
    "mixed_types": "Both answers of If need the same kind of value.",
    "compare_types": "These two sides can't be compared.",
    "bad_result": "A formula must give a number, text or yes/no.",
    "nested_aggregate": "CountIf, SumIf, AvgIf and Share can't contain each other.",
    "field_outside_aggregate":
        "[{label}] needs to be inside CountIf, SumIf, AvgIf or Share when the formula adds up rows.",
    "aggregate_number": "A formula that adds up rows must give a number.",
    "bucket_edges": "Bucket's edges must be numbers, rising from left to right.",
    "bucket_edge_places": "Bucket's edges can have at most 4 decimal places.",
    "round_digits": "Round's second value must be a whole number from 0 to 6.",
    "hour_no_time": "Hour needs a time; [{label}] has none here.",
}

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

FieldType = Literal["number", "text", "bool", "day", "tag"]
ResultType = Literal["number", "text", "bool"]


@dataclass(frozen=True)
class FieldInfo:
    key: str
    label: str
    type: FieldType
    hour_key: str | None = None
    needs_times: bool = False


class FormulaError(PlanError):
    """A refusal a member reads: `.code`, `.sentence`, `.pos` (0-based code-point offset into
    the text as typed) and `.formula_id` (set by the plan validator)."""

    def __init__(self, code: str, sentence: str, pos: int, formula_id: str | None = None):
        super().__init__(sentence)
        self.code = code
        self.pos = pos
        self.formula_id = formula_id


@dataclass(frozen=True, eq=False)
class _Program:
    """The compiled form. `tree` is the parsed tree (tuples, for inspection); `row` evaluates a
    row formula; `aggs` are the aggregate calls of an aggregate formula, `outer` combines their
    results; `reads` is `(key, coerce)` per referenced field, in first-use order."""
    tree: Any
    row: Callable[[Mapping], Any] | None
    aggs: tuple
    outer: Callable[[Sequence], Any] | None
    reads: tuple


@dataclass(frozen=True)
class Compiled:
    canonical: str
    kind: Literal["row", "aggregate"]
    type: ResultType
    fields: tuple[str, ...]
    needs_times: bool
    bucket_labels: tuple[str, ...] | None
    ast: Any


# ---------------------------------------------------------------------------------------------
# Small helpers shared by both halves.

_WS = frozenset(" \t\n")
_CMP_OPS = frozenset({"=", "<>", "<", "<=", ">", ">="})
_ADD_OPS = frozenset({"+", "-"})
_MUL_OPS = frozenset({"*", "/"})
_ONE_CHAR_OPS = frozenset("+-*/=<>")
_TWO_CHAR_OPS = frozenset({"<>", "<=", ">="})
_ASCII_LOWER = {c: c + 32 for c in range(65, 91)}
_FOLDED_FUNCTIONS = {name.lower(): name for name in FUNCTIONS}

#: Characters refused ANYWHERE in a formula, inside a text or a field name too: controls (tab
#: and newline excepted: tab is whitespace and a newline ends a text), bidi and zero-width
#: formatting, the BOM, tag characters, and lone surrogates (which have no UTF-8 form, so every
#: later encode would fail). Fixed lists, no Unicode tables, so both twins agree on every engine.
_FORBIDDEN_RANGES = (
    (0x0000, 0x0008), (0x000B, 0x001F), (0x007F, 0x009F), (0x00AD, 0x00AD), (0x061C, 0x061C),
    (0x180E, 0x180E), (0x200B, 0x200F), (0x202A, 0x202E), (0x2060, 0x206F), (0xD800, 0xDFFF),
    (0xFEFF, 0xFEFF), (0xFFF9, 0xFFFB), (0xE0000, 0xE007F),
)
#: Space-like characters: allowed inside a text or a field name (where they are just text, and
#: never trimmed: trimming is space and tab only), but written as U+XXXX when quoted back so a
#: sentence never shows a blank.
_SPACE_LIKE_RANGES = (
    (0x00A0, 0x00A0), (0x1680, 0x1680), (0x2000, 0x200A), (0x2028, 0x2029), (0x202F, 0x202F),
    (0x205F, 0x205F), (0x3000, 0x3000),
)
#: Everything written as U+XXXX in a sentence: the two lists above plus tab and newline.
_INVISIBLE_RANGES = _FORBIDDEN_RANGES + _SPACE_LIKE_RANGES + ((0x0009, 0x000A),)


def _fold(s: str) -> str:
    """ASCII-only lower case: `K` (Kelvin) and `İ` stay as they are, in both twins."""
    return s.translate(_ASCII_LOWER)


def _is_digit(c: str) -> bool:
    return "0" <= c <= "9"


def _is_letter(c: str) -> bool:
    return ("A" <= c <= "Z") or ("a" <= c <= "z")


def _in(ranges: tuple, c: str) -> bool:
    o = ord(c)
    return any(lo <= o <= hi for lo, hi in ranges)


def _invisible(c: str) -> bool:
    return _in(_INVISIBLE_RANGES, c)


def _forbidden(c: str) -> bool:
    return _in(_FORBIDDEN_RANGES, c)


def _code(c: str) -> str:
    return f"U+{ord(c):04X}"


def _shown_char(c: str) -> str:
    """One refused character: printable ASCII as itself, an invisible one as `U+XXXX`, any other
    as its glyph followed by ` (U+XXXX)`, so a look-alike (a fullwidth bracket) can be told apart."""
    if "!" <= c <= "~":
        return c
    if _invisible(c):
        return _code(c)
    return f"{c} ({_code(c)})"


def _shown(x: str) -> str:
    """Member text for a sentence: whitespace runs become one space, trimmed, clipped to
    `SHOWN_MAX` characters, then every invisible character written as `U+XXXX`."""
    out: list[str] = []
    in_ws = False
    for ch in x:
        if ch in _WS:
            if not in_ws:
                out.append(" ")
            in_ws = True
            continue
        in_ws = False
        out.append(ch)
    s = "".join(out).strip(" ")[:SHOWN_MAX]
    return "".join(_code(c) if _invisible(c) else c for c in s)


def _err(code: str, pos: int, **fill: str) -> FormulaError:
    return FormulaError(code, ERRORS[code].format(**fill), pos)


def _fin(x: Any) -> float | None:
    """A finite float or None; `-0.0` becomes `0.0`."""
    if x is None or not math.isfinite(x):
        return None
    return x + 0.0


def _as_num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        x = float(v)
    except OverflowError:
        return None
    return _fin(x)


def _as_text(v: Any) -> str | None:
    return v if isinstance(v, str) else None


def _as_bool(v: Any) -> bool | None:
    return v if isinstance(v, bool) else None


def _as_day(v: Any) -> str | None:
    """A real calendar day written `YYYY-MM-DD` (ASCII digits, year 0001-9999), else None."""
    if not isinstance(v, str) or len(v) != 10 or v[4] != "-" or v[7] != "-":
        return None
    parts = (v[0:4], v[5:7], v[8:10])
    if not all(all(_is_digit(c) for c in p) for p in parts):
        return None
    try:
        date(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        return None
    return v


_COERCE = {"number": _as_num, "text": _as_text, "bool": _as_bool, "day": _as_day}


# ---------------------------------------------------------------------------------------------
# Tokenizer: one left-to-right pass; the FIRST problem met is the one reported.

@dataclass(frozen=True)
class _Tok:
    kind: str      # num text bool field name op ( ) ,
    pos: int
    end: int
    text: str      # the source slice
    value: Any     # float / unescaped text / bool / trimmed field name / None


def _significant(run: str) -> str:
    """The significant digits of a literal: leading zeros, trailing zeros of the fraction and
    trailing zeros of a whole number do not count (`1000000000000000` has one)."""
    whole, _, frac = run.partition(".")
    return (whole + frac.rstrip("0")).strip("0")


def _valid_number(run: str) -> bool:
    parts = run.split(".")
    if len(parts) > 2 or not all(p and all(_is_digit(c) for c in p) for p in parts):
        return False
    return len(_significant(run)) <= SIG_DIGITS_MAX and math.isfinite(float(run))


def _tokenize(s: str) -> list[_Tok]:
    toks: list[_Tok] = []
    opens: list[int] = []
    n = len(s)
    i = 0

    def push(t: _Tok) -> None:
        if len(toks) >= MAX_TOKENS:
            raise _err("too_many_parts", t.pos)
        toks.append(t)

    while i < n:
        c = s[i]
        if c in _WS:
            i += 1
            continue
        if _is_digit(c) or (c == "." and i + 1 < n and _is_digit(s[i + 1])):
            j = i
            while j < n and (_is_digit(s[j]) or _is_letter(s[j]) or s[j] in "._"):
                j += 1
            run = s[i:j]
            if not _valid_number(run):
                raise _err("bad_number", i, x=_shown(run))
            push(_Tok("num", i, j, run, float(run)))
            i = j
            continue
        if _is_letter(c):
            j = i
            while j < n and (_is_digit(s[j]) or _is_letter(s[j]) or s[j] == "_"):
                j += 1
            word = s[i:j]
            folded = _fold(word)
            if folded in ("true", "false"):
                push(_Tok("bool", i, j, word, folded == "true"))
            else:
                push(_Tok("name", i, j, word, None))
            i = j
            continue
        if c == '"':
            j = i + 1
            buf: list[str] = []
            while True:
                if j >= n or s[j] == "\n":
                    raise _err("unclosed_text", i)
                if _forbidden(s[j]):
                    raise _err("bad_char", j, x=_shown_char(s[j]))
                if s[j] == '"':
                    if j + 1 < n and s[j + 1] == '"':
                        buf.append('"')
                        j += 2
                        continue
                    break
                buf.append(s[j])
                j += 1
            if len(buf) > MAX_TEXT:
                raise _err("text_too_long", i)
            push(_Tok("text", i, j + 1, s[i:j + 1], "".join(buf)))
            i = j + 1
            continue
        if c == "[":
            j = i + 1
            while j < n and s[j] not in "[]\n":
                if _forbidden(s[j]):
                    raise _err("bad_char", j, x=_shown_char(s[j]))
                j += 1
            if j >= n or s[j] != "]":
                raise _err("unclosed_field", i)
            push(_Tok("field", i, j + 1, s[i:j + 1], s[i + 1:j].strip(" \t")))
            i = j + 1
            continue
        if c == "(":
            push(_Tok("(", i, i + 1, c, None))
            opens.append(i)
            if len(opens) > MAX_DEPTH:
                raise _err("too_deep", i)
            i += 1
            continue
        if c == ")":
            if not opens:
                raise _err("extra_paren", i)
            opens.pop()
            push(_Tok(")", i, i + 1, c, None))
            i += 1
            continue
        if c == ",":
            push(_Tok(",", i, i + 1, c, None))
            i += 1
            continue
        two = s[i:i + 2]
        if two in _TWO_CHAR_OPS:
            push(_Tok("op", i, i + 2, two, None))
            i += 2
            continue
        if c in _ONE_CHAR_OPS:
            push(_Tok("op", i, i + 1, c, None))
            i += 1
            continue
        raise _err("bad_char", i, x=_shown_char(c))
    if opens:
        raise _err("unclosed_paren", opens[-1])
    return toks


# ---------------------------------------------------------------------------------------------
# Parser. Tree nodes are tuples whose [0] is the kind and [1] the start position:
#   ("num", pos, value, text)          ("text", pos, value)          ("bool", pos, value)
#   ("field", pos, name)               ("neg", pos, count, operand)
#   ("arith", pos, first, ((op, op_pos, operand), ...))
#   ("cmp", pos, op, op_pos, left, right)
#   ("call", pos, name, (args, ...))
# Recursion happens only through `(`, whose depth the tokenizer has already capped.

class _Parser:
    def __init__(self, src: str, toks: list[_Tok], st: "_State"):
        self.src = src
        self.toks = toks
        self.st = st
        self.i = 0

    def _peek(self) -> _Tok | None:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def _unexpected(self, t: _Tok | None) -> FormulaError:
        if t is None:
            return _err("unexpected", len(self.src), x=_shown(self.toks[-1].text))
        return _err("unexpected", t.pos, x=_shown(t.text))

    def _is_op(self, t: _Tok | None, ops: frozenset) -> bool:
        return t is not None and t.kind == "op" and t.text in ops

    def parse(self) -> tuple:
        node = self._expr()
        t = self._peek()
        if t is not None:
            raise _err("trailing", t.pos, x=_shown(self.src[t.pos:]))
        return node

    def _expr(self) -> tuple:
        left = self._additive()
        t = self._peek()
        if not self._is_op(t, _CMP_OPS):
            return left
        self.i += 1
        right = self._additive()
        t2 = self._peek()
        if self._is_op(t2, _CMP_OPS):
            raise _err("chained_compare", t2.pos)
        return ("cmp", left[1], t.text, t.pos, left, right)

    def _chain(self, ops: frozenset, operand: Callable[[], tuple]) -> tuple:
        first = operand()
        rest = []
        while self._is_op(self._peek(), ops):
            t = self._peek()
            self.i += 1
            rest.append((t.text, t.pos, operand()))
        return ("arith", first[1], first, tuple(rest)) if rest else first

    def _additive(self) -> tuple:
        return self._chain(_ADD_OPS, self._multiplicative)

    def _multiplicative(self) -> tuple:
        return self._chain(_MUL_OPS, self._unary)

    def _unary(self) -> tuple:
        count = 0
        start = None
        while self._is_op(self._peek(), frozenset({"-"})):
            t = self._peek()
            start = t.pos if start is None else start
            count += 1
            self.i += 1
        operand = self._primary()
        return ("neg", start, count, operand) if count else operand

    def _primary(self) -> tuple:
        t = self._peek()
        if t is None:
            raise self._unexpected(None)
        k = t.kind
        if k == "num":
            self.i += 1
            return ("num", t.pos, t.value, t.text)
        if k == "text":
            self.i += 1
            return ("text", t.pos, t.value)
        if k == "bool":
            self.i += 1
            return ("bool", t.pos, t.value)
        if k == "field":
            self.i += 1
            return ("field", t.pos, t.value)
        if k == "(":
            self.i += 1
            node = self._expr()
            close = self._peek()
            if close is None or close.kind != ")":
                raise self._unexpected(close)
            self.i += 1
            return node
        if k == "name":
            name = _FOLDED_FUNCTIONS.get(_fold(t.text))
            if name is None:
                folded = _fold(t.text)
                if folded in self.st.by_key or folded in self.st.by_label:
                    raise _err("bare_field", t.pos, x=_shown(t.text))
                raise _err("unknown_function", t.pos, x=_shown(t.text))
            self.i += 1
            nxt = self._peek()
            if nxt is None or nxt.kind != "(":
                raise _err("unexpected", t.pos, x=_shown(t.text))
            self.i += 1
            args: list[tuple] = []
            if self._peek() is not None and self._peek().kind == ")":
                self.i += 1
                return ("call", t.pos, name, ())
            while True:
                args.append(self._expr())
                sep = self._peek()
                if sep is not None and sep.kind == ",":
                    self.i += 1
                    continue
                if sep is not None and sep.kind == ")":
                    self.i += 1
                    return ("call", t.pos, name, tuple(args))
                raise self._unexpected(sep)
        raise self._unexpected(t)


# ---------------------------------------------------------------------------------------------
# Checker and compiler: one walk, left to right, that types every node and builds its closure.
# Order of refusals inside a node: a call checks nesting and its argument count, then each
# argument (left to right), then the argument types; an operator checks both sides first.

class _State:
    def __init__(self, fields: Mapping[str, FieldInfo]):
        self.by_key: dict[str, FieldInfo] = {}
        self.by_label: dict[str, FieldInfo] = {}
        for fi in fields.values():
            self.by_key.setdefault(_fold(fi.key), fi)
            self.by_label.setdefault(_fold(fi.label), fi)
        self.keys_at: dict[int, str] = {}
        self.reads: dict[str, Callable] = {}
        self.needs_times = False
        self.aggs: list[tuple] = []
        self.outside: tuple[int, str] | None = None
        self.bucket_at: dict[int, tuple[str, ...]] = {}


def _resolve(st: _State, pos: int, name: str) -> FieldInfo:
    fi = None
    if len(name) <= NAME_MAX:
        f = _fold(name)
        fi = st.by_key.get(f) or st.by_label.get(f)
    if fi is None:
        raise _err("unknown_field", pos, x=_shown(name))
    if fi.type == "tag":
        raise _err("tag_field", pos, label=fi.label)
    if fi.type not in _COERCE:
        raise _err("unknown_field", pos, x=_shown(name))
    return fi


#: A Bucket edge is printed in its label exactly as the number it is, so it may carry at most
#: this many decimal places (trailing zeros do not count). An edge that would need rounding to
#: print is refused rather than shown as a different number than the one that splits the rows.
BUCKET_PLACES_MAX = 4


def _literal_edge(node: tuple) -> tuple[float, str, bool] | None:
    """A Bucket edge is `N` or `-N` with N a number literal: (value, label, prints exactly)."""
    neg = False
    if node[0] == "neg" and node[2] == 1:
        neg, node = True, node[3]
    if node[0] != "num":
        return None
    value = -node[2] if neg else node[2]
    frac = node[3].partition(".")[2].rstrip("0")
    return value + 0.0, _edge_label(node[3], neg), len(frac) <= BUCKET_PLACES_MAX


def _edge_label(text: str, negative: bool) -> str:
    """The literal's own digits: leading zeros and trailing fraction zeros trimmed, no exponent,
    a minus sign kept unless the number is zero."""
    whole, _, frac = text.partition(".")
    whole = whole.lstrip("0") or "0"
    frac = frac.rstrip("0")
    out = whole + ("." + frac if frac else "")
    return "-" + out if negative and out != "0" else out


def _check(node: tuple, st: _State, in_agg: bool) -> tuple[str, Callable]:
    kind = node[0]
    if kind == "num":
        v = node[2] + 0.0
        return "number", lambda r: v
    if kind == "text":
        v = node[2]
        return "text", lambda r: v
    if kind == "bool":
        v = node[2]
        return "bool", lambda r: v
    if kind == "field":
        return _check_field(node, st, in_agg)
    if kind == "neg":
        t, f = _check(node[3], st, in_agg)
        if t != "number":
            raise _err("needs_number", node[3][1], what="-")
        if node[2] % 2 == 0:
            return "number", f
        return "number", lambda r: None if (x := f(r)) is None else _fin(-x)
    if kind == "arith":
        return _check_arith(node, st, in_agg)
    if kind == "cmp":
        return _check_cmp(node, st, in_agg)
    return _check_call(node, st, in_agg)


def _check_field(node: tuple, st: _State, in_agg: bool) -> tuple[str, Callable]:
    pos, name = node[1], node[2]
    fi = _resolve(st, pos, name)
    st.keys_at[pos] = fi.key
    coerce = _COERCE[fi.type]
    st.reads.setdefault(fi.key, coerce)
    st.needs_times = st.needs_times or fi.needs_times
    if not in_agg and st.outside is None:
        st.outside = (pos, fi.label)
    return fi.type, _reader(fi.key, fi.type)


def _reader(key: str, ftype: str) -> Callable:
    """A field read. The number reader takes a fast path for a plain finite float (the common
    case on the hot loop) and otherwise defers to `_as_num`; the answer is identical."""
    if ftype == "number":
        isfinite = math.isfinite

        def read_number(r):
            v = r.get(key)
            if type(v) is float and isfinite(v):
                return v + 0.0
            return _as_num(v)
        return read_number
    coerce = _COERCE[ftype]
    return lambda r: coerce(r.get(key))


def _arith(op: str) -> Callable[[float, float], float | None]:
    if op == "+":
        return lambda a, b: a + b
    if op == "-":
        return lambda a, b: a - b
    if op == "*":
        return lambda a, b: a * b
    return lambda a, b: None if b == 0 else a / b


def _check_arith(node: tuple, st: _State, in_agg: bool) -> tuple[str, Callable]:
    t0, f0 = _check(node[2], st, in_agg)
    parts = []
    for op, _op_pos, operand in node[3]:
        parts.append((op, operand, _check(operand, st, in_agg)))
    if t0 != "number":
        raise _err("needs_number", node[2][1], what=node[3][0][0])
    steps = []
    for op, operand, (t, f) in parts:
        if t != "number":
            raise _err("needs_number", operand[1], what=op)
        steps.append((_arith(op), f))
    steps_t = tuple(steps)
    if len(steps_t) == 1:
        fn1, g1 = steps_t[0]

        def run_one(r):
            v = f0(r)
            if v is None:
                return None
            w = g1(r)
            if w is None:
                return None
            return _fin(fn1(v, w))
        return "number", run_one

    def run(r):
        v = f0(r)
        for fn, g in steps_t:
            if v is None:
                return None
            w = g(r)
            if w is None:
                return None
            v = _fin(fn(v, w))
        return v
    return "number", run


_NUM_CMP = {
    "=": lambda a, b: a == b, "<>": lambda a, b: a != b, "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b, ">": lambda a, b: a > b, ">=": lambda a, b: a >= b,
}


def _check_cmp(node: tuple, st: _State, in_agg: bool) -> tuple[str, Callable]:
    _, _pos, op, op_pos, left, right = node
    tl, fl = _check(left, st, in_agg)
    tr, fr = _check(right, st, in_agg)
    pair = {tl, tr}
    cmp = _NUM_CMP[op]
    fold = False
    if op in ("=", "<>"):
        if tl == tr:
            fold = tl == "text"
        elif pair == {"day", "text"}:
            lit = left if tl == "text" else right
            if lit[0] != "text" or _as_day(lit[2]) is None:
                raise _err("compare_types", op_pos)
        else:
            raise _err("compare_types", op_pos)
    elif not (tl == tr and tl in ("number", "day")):
        raise _err("compare_types", op_pos)

    if fold:
        def run(r):
            a, b = fl(r), fr(r)
            if a is None or b is None:
                return None
            return cmp(_fold(a), _fold(b))
    else:
        def run(r):
            a, b = fl(r), fr(r)
            if a is None or b is None:
                return None
            return cmp(a, b)
    return "bool", run


def _check_call(node: tuple, st: _State, in_agg: bool) -> tuple[str, Callable]:
    _, pos, name, args = node
    is_agg = name in AGGREGATES
    if is_agg and in_agg:
        raise _err("nested_aggregate", pos)
    lo, hi = ARITY[name]
    if not lo <= len(args) <= hi:
        raise _err("arg_count", pos, Fn=name, n=ARITY_WORDS[name])
    checked = [_check(a, st, in_agg or is_agg) for a in args]
    return _FN[name](node, checked, st)


def _need(code: str, checked: list, args: tuple, i: int, want: str, name: str) -> Callable:
    if checked[i][0] != want:
        if code == "needs_day":
            raise _err(code, args[i][1], Fn=name)
        raise _err(code, args[i][1], what=name)
    return checked[i][1]


def _fn_if(node, checked, st):
    args = node[3]
    cond = _need("needs_condition", checked, args, 0, "bool", "If")
    (ta, fa), (tb, fb) = checked[1], checked[2]
    if ta != tb:
        raise _err("mixed_types", args[2][1])
    return ta, lambda r: fa(r) if cond(r) is True else fb(r)


def _bools(node, checked, name):
    return tuple(_need("needs_condition", checked, node[3], i, "bool", name)
                 for i in range(len(checked)))


def _fn_and(node, checked, st):
    fs = _bools(node, checked, "And")
    return "bool", lambda r: all(f(r) is True for f in fs)


def _fn_or(node, checked, st):
    fs = _bools(node, checked, "Or")
    return "bool", lambda r: any(f(r) is True for f in fs)


def _fn_not(node, checked, st):
    f = _need("needs_condition", checked, node[3], 0, "bool", "Not")
    return "bool", lambda r: None if (x := f(r)) is None else not x


def _numbers(node, checked, name):
    return tuple(_need("needs_number", checked, node[3], i, "number", name)
                 for i in range(len(checked)))


def _fn_abs(node, checked, st):
    f = _need("needs_number", checked, node[3], 0, "number", "Abs")
    return "number", lambda r: None if (x := f(r)) is None else _fin(abs(x))


def _round_half_away(x: float | None, d: int) -> float | None:
    """`sign(x) * floor(abs(x) * 10^d + 0.5) / 10^d`, the same IEEE steps in both twins."""
    if x is None:
        return None
    m = float(10 ** d)
    y = abs(x) * m + 0.5
    if not math.isfinite(y):
        return None
    sign = 1.0 if x > 0 else (-1.0 if x < 0 else 0.0)
    return _fin(sign * (math.floor(y) / m))


def _fn_round(node, checked, st):
    args = node[3]
    f = _need("needs_number", checked, args, 0, "number", "Round")
    d = 0
    if len(args) == 2:
        a = args[1]
        if a[0] != "num" or not all(_is_digit(c) for c in a[3]) or a[2] > ROUND_DIGITS_MAX:
            raise _err("round_digits", a[1])
        d = int(a[2])
    return "number", lambda r: _round_half_away(f(r), d)


def _fn_min(node, checked, st):
    fs = _numbers(node, checked, "Min")

    def run(r):
        best = None
        for f in fs:
            x = f(r)
            if x is not None and (best is None or x < best):
                best = x
        return _fin(best)
    return "number", run


def _fn_max(node, checked, st):
    fs = _numbers(node, checked, "Max")

    def run(r):
        best = None
        for f in fs:
            x = f(r)
            if x is not None and (best is None or x > best):
                best = x
        return _fin(best)
    return "number", run


def _agg(kind: str, value: Callable | None, cond: Callable | None, st: _State):
    idx = len(st.aggs)
    st.aggs.append((kind, value, cond))
    return "number", lambda results: results[idx]


def _fn_countif(node, checked, st):
    cond = _need("needs_condition", checked, node[3], 0, "bool", "CountIf")
    return _agg("CountIf", None, cond, st)


def _fn_share(node, checked, st):
    cond = _need("needs_condition", checked, node[3], 0, "bool", "Share")
    return _agg("Share", None, cond, st)


def _value_and_cond(node, checked, name):
    value = _need("needs_number", checked, node[3], 0, "number", name)
    cond = None
    if len(checked) == 2:
        cond = _need("needs_condition", checked, node[3], 1, "bool", name)
    return value, cond


def _fn_sumif(node, checked, st):
    value, cond = _value_and_cond(node, checked, "SumIf")
    return _agg("SumIf", value, cond, st)


def _fn_avgif(node, checked, st):
    value, cond = _value_and_cond(node, checked, "AvgIf")
    return _agg("AvgIf", value, cond, st)


def bucket_labels_for(edge_labels: Sequence[str]) -> tuple[str, ...]:
    """`Under e1`, `e1 to e2`, ..., `ek or more`: the labels of a Bucket, in edge order."""
    out = [f"Under {edge_labels[0]}"]
    for a, b in zip(edge_labels, edge_labels[1:]):
        out.append(f"{a} to {b}")
    out.append(f"{edge_labels[-1]} or more")
    return tuple(out)


def _fn_bucket(node, checked, st):
    args = node[3]
    f = _need("needs_number", checked, args, 0, "number", "Bucket")
    edges: list[float] = []
    printed: list[str] = []
    for a in args[1:]:
        e = _literal_edge(a)
        if e is None:
            raise _err("bucket_edges", a[1])
        if not e[2]:
            raise _err("bucket_edge_places", a[1])
        if edges and not e[0] > edges[-1]:
            raise _err("bucket_edges", a[1])
        edges.append(e[0])
        printed.append(e[1])
    labels = bucket_labels_for(printed)
    edges_t = tuple(edges)
    last = len(edges_t)

    def run(r):
        v = f(r)
        if v is None:
            return None
        i = 0
        while i < last and v >= edges_t[i]:
            i += 1
        return labels[i]
    st.bucket_at[node[1]] = labels
    return "text", run


def _fn_hour(node, checked, st):
    a = node[3][0]
    if a[0] != "field" or checked[0][0] != "day":
        raise _err("needs_day", a[1], Fn="Hour")
    fi = _resolve(st, a[1], a[2])
    if not fi.hour_key:
        raise _err("hour_no_time", a[1], label=fi.label)
    day_key, hour_key = fi.key, fi.hour_key
    # The hour is read from its own key, so it is a field this formula reads (empty_field_of
    # names it on a dates-only row) and the formula needs times, like a hold-minutes field.
    st.reads.setdefault(hour_key, _as_num)
    st.needs_times = True

    def run(r):
        if _as_day(r.get(day_key)) is None:
            return None
        h = _as_num(r.get(hour_key))
        if h is None or not h.is_integer() or h < 0 or h > 23:
            return None
        return h
    return "number", run


def _fn_weekday(node, checked, st):
    f = _need("needs_day", checked, node[3], 0, "day", "Weekday")

    def run(r):
        d = f(r)
        if d is None:
            return None
        return WEEKDAYS[date(int(d[0:4]), int(d[5:7]), int(d[8:10])).weekday()]
    return "text", run


#: The ONE dispatch table: canonical name -> builder(node, checked_args, state) -> (type, fn).
_FN: dict[str, Callable] = {
    "If": _fn_if, "And": _fn_and, "Or": _fn_or, "Not": _fn_not, "Abs": _fn_abs,
    "Round": _fn_round, "Min": _fn_min, "Max": _fn_max, "CountIf": _fn_countif,
    "SumIf": _fn_sumif, "AvgIf": _fn_avgif, "Share": _fn_share, "Bucket": _fn_bucket,
    "Hour": _fn_hour, "Weekday": _fn_weekday,
}


# ---------------------------------------------------------------------------------------------
# Public API.

def _canonical(src: str, toks: list[_Tok], st: _State) -> str:
    out: list[str] = []
    last = 0
    for t in toks:
        out.append(src[last:t.pos])
        if t.kind == "field":
            out.append("[" + st.keys_at[t.pos] + "]")
        elif t.kind == "name":
            out.append(_FOLDED_FUNCTIONS[_fold(t.text)])
        elif t.kind == "bool":
            out.append("TRUE" if t.value else "FALSE")
        else:
            out.append(t.text)
        last = t.end
    return "".join(out).strip(" \t\n")


def _first_token_pos(src: str) -> int:
    i = 0
    while i < len(src) and src[i] in _WS:
        i += 1
    return i


def compile_formula(expr: str, fields: Mapping[str, FieldInfo]) -> Compiled:
    """Parse, type and compile `expr` against `fields` (key -> FieldInfo). Raises FormulaError,
    and only FormulaError, for any member text."""
    if not isinstance(expr, str):
        raise _err("empty", 0)
    if len(expr) > MAX_LENGTH:
        raise _err("too_long", MAX_LENGTH)
    if not expr.strip(" \t\n"):
        raise _err("empty", 0)
    try:
        toks = _tokenize(expr)
        st = _State(fields)
        tree = _Parser(expr, toks, st).parse()
        rtype, fn = _check(tree, st, False)
    except RecursionError:
        raise _err("too_deep", 0) from None
    start = _first_token_pos(expr)
    if st.aggs:
        if st.outside is not None:
            raise _err("field_outside_aggregate", st.outside[0], label=st.outside[1])
        if rtype != "number":
            raise _err("aggregate_number", start)
        kind = "aggregate"
        program = _Program(tree, None, tuple(st.aggs), fn, tuple(st.reads.items()))
    else:
        if rtype not in ("number", "text", "bool"):
            raise _err("bad_result", start)
        kind = "row"
        program = _Program(tree, fn, (), None, tuple(st.reads.items()))
    labels = st.bucket_at.get(tree[1]) if tree[0] == "call" and tree[2] == "Bucket" else None
    return Compiled(
        canonical=_canonical(expr, toks, st), kind=kind, type=rtype,
        fields=tuple(st.reads), needs_times=st.needs_times, bucket_labels=labels, ast=program,
    )


def display_name(fi: FieldInfo, fields: Mapping[str, FieldInfo]) -> str:
    """What a member sees inside the brackets for `fi`: its label, unless the label would not
    resolve back to `fi` (it equals another field's key, it is shared, it is too long, it carries
    a bracket, a newline, a refused character or outer spaces) -- then its key. So
    `compile_formula(display(c))` always gives back `c`."""
    label = fi.label
    st = _State(fields)
    ok = (
        isinstance(label, str) and label
        and label == label.strip(" \t") and len(label) <= NAME_MAX
        and not any(ch in "[]\n" or _forbidden(ch) for ch in label)
    )
    if ok:
        folded = _fold(label)
        ok = (st.by_key.get(folded) or st.by_label.get(folded)) is fi
    return label if ok else fi.key


def display(canonical: str, fields: Mapping[str, FieldInfo]) -> str:
    """The canonical text with every known field key written as its display name. A key no
    longer in `fields` stays as written; text that no longer tokenizes is returned as stored,
    with any lone surrogate replaced so the answer can always be encoded."""
    if not isinstance(canonical, str):
        return ""
    try:
        toks = _tokenize(canonical)
    except FormulaError:
        return "".join("\ufffd" if 0xD800 <= ord(c) <= 0xDFFF else c for c in canonical)
    by_key = {fi.key: fi for fi in fields.values()}
    out: list[str] = []
    last = 0
    for t in toks:
        if t.kind == "field" and t.value in by_key:
            out.append(canonical[last:t.pos])
            out.append("[" + display_name(by_key[t.value], fields) + "]")
            last = t.end
    out.append(canonical[last:])
    return "".join(out)


def eval_row(c: Compiled, row: Mapping) -> float | str | bool | None:
    """A row formula's value on one row (None is "no data")."""
    if c.kind != "row":
        raise ValueError("eval_row takes a row formula; use eval_group for one that adds up rows")
    return c.ast.row(row)


def eval_group(c: Compiled, rows: Sequence[Mapping], *,
               check: Callable[[], None] | None = None) -> float | None:
    """An aggregate formula over one group of rows, in ONE pass; `check()` is called before
    rows 256, 512, ... (every `CHECK_EVERY` rows)."""
    if c.kind != "aggregate":
        raise ValueError("eval_group takes a formula that adds up rows")
    aggs = c.ast.aggs
    k = len(aggs)
    sums = [0.0] * k
    hits = [0] * k
    n = 0
    for i, row in enumerate(rows):
        if check is not None and i and i % CHECK_EVERY == 0:
            check()
        n += 1
        for j in range(k):
            kind, value, cond = aggs[j]
            if cond is not None and cond(row) is not True:
                continue
            if value is None:
                hits[j] += 1
                continue
            v = value(row)
            if v is not None:
                sums[j] = sums[j] + v
                hits[j] += 1
    results: list[float | None] = []
    for j in range(k):
        kind = aggs[j][0]
        if kind == "CountIf":
            results.append(float(hits[j]) if n else None)
        elif kind == "Share":
            results.append(_fin(hits[j] / n) if n else None)
        elif kind == "SumIf":
            results.append(_fin(sums[j]) if hits[j] else None)
        else:
            results.append(_fin(sums[j] / hits[j]) if hits[j] else None)
    return c.ast.outer(results)


def empty_field_of(c: Compiled, row: Mapping) -> str | None:
    """The first referenced field (in the order the formula names them) with no value on `row`."""
    for key, coerce in c.ast.reads:
        if coerce(row.get(key)) is None:
            return key
    return None


def skip_notice(n: int, label: str | None, unit_one: str, unit_many: str) -> str | None:
    """The footnote for rows a formula skipped. None when nothing was skipped."""
    if isinstance(n, bool) or not isinstance(n, int) or n <= 0:
        return None
    unit = unit_one if n == 1 else unit_many
    if label:
        return f"[{label}] is empty on {n:,} {unit}; those are skipped"
    return f"This formula has no value on {n:,} {unit}; those are skipped"
