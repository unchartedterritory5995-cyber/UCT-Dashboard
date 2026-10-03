"""Wave 11 (lane 11B): the formula expression language for note properties.

A formula is computed from the SAME note's number properties. This module is
the server's half of the language: a real tokenizer, a recursive-descent
parser and a tree-walking evaluator. Its client twin is
`app/src/pages/journal-2-0/lib/formula/formulaEngine.js`, and the two are held
to ONE shared test-vector file (`lib/formula/formulaVectors.json`) that both
test suites read -- so the server that sorts a table and the editor that
previews a value cannot disagree about what a formula means.

⛔⛔ NO `eval`, NO `exec`, NO `compile`, NO `__import__`, NO `getattr` ON
ANYTHING THE MEMBER TYPED. The member's text is only ever matched against a
fixed token grammar; an identifier that is not one of the five function names
below is an error, so `constructor`, `__proto__`, `__class__` and friends can
name nothing. `tests/test_formula_engine.py` scans this file's AST and fails if
any of those calls ever appears.

THE GRAMMAR (whitespace is space, tab, CR, LF and nothing else)::

    formula    := comparison END
    comparison := additive [ ( "<" | "<=" | ">" | ">=" | "=" | "!=" ) additive ]
    additive   := term { ( "+" | "-" ) term }
    term       := unary { ( "*" | "/" ) unary }
    unary      := ( "-" | "+" ) unary | primary
    primary    := NUMBER | REF | FUNC "(" [ comparison { "," comparison } ] ")"
                | "(" comparison ")"
    NUMBER     := digits [ "." digits* ] [ exponent ]  |  "." digits [ exponent ]
    REF        := "{" text "}"      -- "{Entry}" by name, "{@<property id>}" by id
    FUNC       := round | abs | min | max | if   (case-insensitive)

A comparison is not associative (`1 < 2 < 3` is an error) and yields 1 or 0.
`if(cond, a, b)` evaluates ONLY the branch it takes, so
`if({Stop} = {Entry}, 0, ({Exit} - {Entry}) / ({Entry} - {Stop}))` never
divides by zero. `round(x, n)` rounds half away from zero on the number's
shortest decimal form (so `round(1.005, 2)` is 1.01, as a person expects), with
`n` a whole number from 0 to 10.

LIMITS, stated once and enforced the same way by both engines: an expression
is at most MAX_LENGTH characters and MAX_TOKENS tokens, and nests at most
MAX_DEPTH deep (every parenthesis, function call and unary sign is one level).
A number literal is at most MAX_NUMBER_CHARS characters and must be finite.

A value that cannot be computed is NEVER NaN or Infinity: division by zero, a
missing value, a value that is not a number, and a result too large to hold
each raise `FormulaEvalError` with a code and a plain sentence, which the cell
shows on hover. Codes are shared with the client; sentences need not be.
"""
from __future__ import annotations

import math
import operator
import re
from typing import Any, Callable

MAX_LENGTH = 2000
MAX_TOKENS = 500
MAX_DEPTH = 32
MAX_NUMBER_CHARS = 32
MAX_ARGS = 32
MAX_ROUND_PLACES = 10
MAX_REF_CHARS = 100

# name -> (min args, max args)
FUNCTIONS: dict[str, tuple[int, int]] = {
    "round": (1, 2),
    "abs": (1, 1),
    "min": (1, MAX_ARGS),
    "max": (1, MAX_ARGS),
    "if": (3, 3),
}
COMPARISONS = ("<", "<=", ">", ">=", "=", "!=")

_WS = " \t\r\n"
_NUMBER_RE = re.compile(r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_ID_RE = re.compile(r"[A-Za-z0-9_:\-]{1,64}")


class FormulaError(ValueError):
    """The text is not a formula (raised while tokenizing or parsing)."""

    def __init__(self, code: str, message: str, position: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.position = position


class FormulaEvalError(ValueError):
    """The formula is fine but this note's values cannot produce a number."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ── Tokenizer ────────────────────────────────────────────────────────────────

def tokenize(text: Any) -> list[tuple[str, Any, int]]:
    """`(kind, value, position)` tuples. Kinds: num, ref, ident, op, lp, rp, comma."""
    if not isinstance(text, str):
        raise FormulaError("syntax", "A formula must be text")
    if len(text) > MAX_LENGTH:
        raise FormulaError("too_long", f"A formula can be at most {MAX_LENGTH} characters long")
    out: list[tuple[str, Any, int]] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch in _WS:
            i += 1
            continue
        if len(out) >= MAX_TOKENS:
            raise FormulaError("too_many_tokens", f"A formula can have at most {MAX_TOKENS} parts")
        if ch.isascii() and (ch.isdigit() or ch == "."):
            m = _NUMBER_RE.match(text, i)
            if not m:
                raise FormulaError("syntax", f"Unexpected \".\" at character {i + 1}", i)
            raw = m.group(0)
            if len(raw) > MAX_NUMBER_CHARS:
                raise FormulaError("number_too_large", f"The number at character {i + 1} is too long", i)
            value = float(raw)
            if not math.isfinite(value):
                raise FormulaError("number_too_large", f"The number at character {i + 1} is too large", i)
            out.append(("num", value, i))
            i = m.end()
            continue
        if ch == "{":
            close = text.find("}", i + 1)
            if close < 0:
                raise FormulaError("syntax", f"The property at character {i + 1} is missing its closing }}", i)
            inner = text[i + 1:close]
            if "{" in inner:
                raise FormulaError("syntax", f"The property at character {i + 1} is missing its closing }}", i)
            label = inner.strip()
            if not label:
                raise FormulaError("syntax", f"Empty property name at character {i + 1}", i)
            if len(label) > MAX_REF_CHARS:
                raise FormulaError("syntax", f"The property name at character {i + 1} is too long", i)
            if label.startswith("@"):
                pid = label[1:].strip()
                if not _ID_RE.fullmatch(pid):
                    raise FormulaError("syntax", f"Not a property id at character {i + 1}", i)
                out.append(("ref", ("id", pid), i))
            else:
                out.append(("ref", ("name", label), i))
            i = close + 1
            continue
        if ch == "}":
            raise FormulaError("syntax", f"Unexpected }} at character {i + 1}", i)
        if ch.isascii() and (ch.isalpha() or ch == "_"):
            m = _IDENT_RE.match(text, i)
            word = m.group(0)
            out.append(("ident", word, i))
            i = m.end()
            continue
        two = text[i:i + 2]
        if two in ("<=", ">=", "!="):
            out.append(("op", two, i))
            i += 2
            continue
        if ch in "<>=+-*/":
            out.append(("op", ch, i))
            i += 1
            continue
        if ch == "(":
            out.append(("lp", ch, i)); i += 1; continue
        if ch == ")":
            out.append(("rp", ch, i)); i += 1; continue
        if ch == ",":
            out.append(("comma", ch, i)); i += 1; continue
        raise FormulaError("syntax", f"Unexpected character {ch!r} at character {i + 1}", i)
    return out


# ── Parser ───────────────────────────────────────────────────────────────────
# AST nodes are plain tuples:
#   ("num", float) · ("ref", kind, key) · ("neg", node) · ("pos", node)
#   ("bin", op, left, right) · ("cmp", op, left, right) · ("call", name, [args])

class _Parser:
    def __init__(self, tokens: list[tuple[str, Any, int]], text_len: int):
        self.t = tokens
        self.i = 0
        self.depth = 0
        self.end = text_len

    def peek(self) -> tuple[str, Any, int] | None:
        return self.t[self.i] if self.i < len(self.t) else None

    def take(self) -> tuple[str, Any, int]:
        tok = self.t[self.i]
        self.i += 1
        return tok

    def where(self) -> str:
        tok = self.peek()
        return f"at character {tok[2] + 1}" if tok else "at the end"

    def enter(self) -> None:
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise FormulaError("too_deep", f"A formula can nest at most {MAX_DEPTH} levels deep")

    def leave(self) -> None:
        self.depth -= 1

    def formula(self):
        if not self.t:
            raise FormulaError("syntax", "The formula is empty")
        node = self.comparison()
        tok = self.peek()
        if tok is not None:
            raise FormulaError("syntax", f"Unexpected {_describe(tok)} {self.where()}", tok[2])
        return node

    def comparison(self):
        left = self.additive()
        tok = self.peek()
        if tok and tok[0] == "op" and tok[1] in COMPARISONS:
            self.take()
            right = self.additive()
            nxt = self.peek()
            if nxt and nxt[0] == "op" and nxt[1] in COMPARISONS:
                raise FormulaError("syntax", f"Compare two things at a time ({_describe(nxt)} {self.where()})", nxt[2])
            return ("cmp", tok[1], left, right)
        return left

    def additive(self):
        node = self.term()
        while True:
            tok = self.peek()
            if tok and tok[0] == "op" and tok[1] in ("+", "-"):
                self.take()
                node = ("bin", tok[1], node, self.term())
            else:
                return node

    def term(self):
        node = self.unary()
        while True:
            tok = self.peek()
            if tok and tok[0] == "op" and tok[1] in ("*", "/"):
                self.take()
                node = ("bin", tok[1], node, self.unary())
            else:
                return node

    def unary(self):
        tok = self.peek()
        if tok and tok[0] == "op" and tok[1] in ("-", "+"):
            self.take()
            self.enter()
            inner = self.unary()
            self.leave()
            return ("neg", inner) if tok[1] == "-" else ("pos", inner)
        return self.primary()

    def primary(self):
        tok = self.peek()
        if tok is None:
            raise FormulaError("syntax", "The formula ends too soon")
        kind, value, pos = tok
        if kind == "num":
            self.take()
            return ("num", value)
        if kind == "ref":
            self.take()
            return ("ref", value[0], value[1])
        if kind == "lp":
            self.take()
            self.enter()
            node = self.comparison()
            close = self.peek()
            if close is None or close[0] != "rp":
                raise FormulaError("syntax", f"Missing ) {self.where()}", close[2] if close else None)
            self.take()
            self.leave()
            return node
        if kind == "ident":
            name = value.lower()
            if name not in FUNCTIONS:
                raise FormulaError(
                    "unknown_name",
                    f"Unknown name \"{value}\" at character {pos + 1}. Put a property name in braces, like {{Entry}}",
                    pos,
                )
            self.take()
            lp = self.peek()
            if lp is None or lp[0] != "lp":
                raise FormulaError("syntax", f"{name} needs ( after it", pos)
            self.take()
            self.enter()
            args = []
            if self.peek() is not None and self.peek()[0] == "rp":
                self.take()
            else:
                while True:
                    args.append(self.comparison())
                    sep = self.peek()
                    if sep is not None and sep[0] == "comma":
                        self.take()
                        continue
                    if sep is not None and sep[0] == "rp":
                        self.take()
                        break
                    raise FormulaError("syntax", f"Missing , or ) {self.where()}", sep[2] if sep else None)
            self.leave()
            lo, hi = FUNCTIONS[name]
            if not lo <= len(args) <= hi:
                want = str(lo) if lo == hi else (f"{lo} or {hi}" if hi - lo == 1 else f"at least {lo}")
                raise FormulaError("arity", f"{name} takes {want} value{'s' if hi != 1 else ''}, not {len(args)}", pos)
            return ("call", name, args)
        raise FormulaError("syntax", f"Unexpected {_describe(tok)} at character {pos + 1}", pos)


def _describe(tok: tuple[str, Any, int]) -> str:
    kind, value, _ = tok
    if kind == "num":
        return "number"
    if kind == "ref":
        return "property"
    if kind == "ident":
        return f"\"{value}\""
    return f"\"{value}\""


def parse(text: Any):
    """The AST for `text`, or FormulaError."""
    tokens = tokenize(text)
    return _Parser(tokens, len(text)).formula()


def refs_of(node) -> list[tuple[str, str]]:
    """Every `(kind, key)` reference in an AST, in first-seen order, once each."""
    out: list[tuple[str, str]] = []
    stack = [node]
    while stack:
        n = stack.pop()
        tag = n[0]
        if tag == "ref":
            key = (n[1], n[2])
            if key not in out:
                out.append(key)
        elif tag in ("neg", "pos"):
            stack.append(n[1])
        elif tag in ("bin", "cmp"):
            stack.append(n[3])
            stack.append(n[2])
        elif tag == "call":
            stack.extend(reversed(n[2]))
    return out


# ── Evaluator ────────────────────────────────────────────────────────────────

def _finite(x: float) -> float:
    if not math.isfinite(x):
        raise FormulaEvalError("overflow", "The result is too large to show")
    return x


def _round_half_away(x: float, places: int) -> float:
    """Round half away from zero on the SHORTEST decimal form of `x` -- the
    digits `repr` prints, which are the digits JavaScript's String() prints.
    Mirrored digit for digit in formulaEngine.js."""
    if x == 0:
        return 0.0
    neg = x < 0
    s = repr(abs(x))
    exp = 0
    if "e" in s:
        mant, e = s.split("e")
        exp = int(e)
    else:
        mant = s
    if "." in mant:
        ip, fp = mant.split(".")
    else:
        ip, fp = mant, ""
    digits = ip + fp
    point = len(ip) + exp           # value = 0.<digits> * 10**point
    stripped = digits.lstrip("0")
    point -= len(digits) - len(stripped)
    digits = stripped
    if not digits:
        return 0.0
    keep = point + places
    if keep >= len(digits):
        return x
    if keep < 0:
        return 0.0
    up = digits[keep] >= "5"
    kept = digits[:keep]
    if up:
        kept = str(int(kept or "0") + 1)
    if not kept or int(kept) == 0:
        return 0.0
    result = float(f"{kept}e{point - keep}")
    return -result if neg else result


def evaluate(node, lookup: Callable[[str, str], float]) -> float:
    """The number `node` stands for. `lookup(kind, key)` returns a property's
    number or raises FormulaEvalError (missing / not a number / unknown)."""
    value = _eval(node, lookup)
    return _finite(value) + 0.0      # `+ 0.0` turns -0.0 into 0.0


def _truthy(x: float) -> bool:
    return x != 0


def _eval(node, lookup) -> float:
    tag = node[0]
    if tag == "num":
        return node[1]
    if tag == "ref":
        v = lookup(node[1], node[2])
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise FormulaEvalError("not_number", "A value this formula uses is not a number")
        try:
            v = float(v)
        except OverflowError:
            raise FormulaEvalError("overflow", "A value this formula uses is too large")
        return _finite(v)
    if tag == "neg":
        return -_eval(node[1], lookup)
    if tag == "pos":
        return _eval(node[1], lookup)
    if tag == "bin":
        op = node[1]
        a = _eval(node[2], lookup)
        b = _eval(node[3], lookup)
        if op == "+":
            return _finite(a + b)
        if op == "-":
            return _finite(a - b)
        if op == "*":
            return _finite(a * b)
        if b == 0:
            raise FormulaEvalError("div_zero", "Division by zero")
        return _finite(a / b)
    if tag == "cmp":
        op = node[1]
        a = _eval(node[2], lookup)
        b = _eval(node[3], lookup)
        ok = {"<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b, "=": a == b, "!=": a != b}[op]
        return 1.0 if ok else 0.0
    if tag == "call":
        name, args = node[1], node[2]
        if name == "if":
            cond = _eval(args[0], lookup)
            return _eval(args[1] if _truthy(cond) else args[2], lookup)
        vals = [_eval(a, lookup) for a in args]
        if name == "abs":
            return abs(vals[0])
        if name == "min":
            return min(vals)
        if name == "max":
            return max(vals)
        if name == "round":
            places = 0
            if len(vals) == 2:
                p = vals[1]
                if p != math.floor(p) or not 0 <= p <= MAX_ROUND_PLACES:
                    raise FormulaEvalError(
                        "bad_round", f"round's places must be a whole number from 0 to {MAX_ROUND_PLACES}",
                    )
                places = int(p)
            return _finite(_round_half_away(vals[0], places))
    raise FormulaEvalError("syntax", "Not a formula")  # unreachable for a parsed AST


def compile_ast(node) -> Callable[[Callable[[str, str], float]], float]:
    """The SAME semantics as `evaluate`, compiled once into nested closures so a
    formula run over thousands of notes does not re-walk its tree per note.
    `compiled(lookup)` returns the number or raises FormulaEvalError, exactly as
    `evaluate(node, lookup)` does; tests/test_formula_engine.py runs every shared
    vector through both and requires the same answer."""
    fn = _compile(node)

    def run(lookup):
        return _finite(fn(lookup)) + 0.0
    return run


def _compile(node):
    tag = node[0]
    if tag == "num":
        v = node[1]
        return lambda lookup: v
    if tag == "ref":
        kind, key = node[1], node[2]

        def ref(lookup):
            v = lookup(kind, key)
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise FormulaEvalError("not_number", "A value this formula uses is not a number")
            try:
                v = float(v)
            except OverflowError:
                raise FormulaEvalError("overflow", "A value this formula uses is too large")
            return _finite(v)
        return ref
    if tag == "neg":
        a = _compile(node[1])
        return lambda lookup: -a(lookup)
    if tag == "pos":
        return _compile(node[1])
    if tag == "bin":
        op, a, b = node[1], _compile(node[2]), _compile(node[3])
        if op == "+":
            return lambda lookup: _finite(a(lookup) + b(lookup))
        if op == "-":
            return lambda lookup: _finite(a(lookup) - b(lookup))
        if op == "*":
            return lambda lookup: _finite(a(lookup) * b(lookup))

        def div(lookup):
            x = a(lookup)
            y = b(lookup)
            if y == 0:
                raise FormulaEvalError("div_zero", "Division by zero")
            return _finite(x / y)
        return div
    if tag == "cmp":
        op, a, b = node[1], _compile(node[2]), _compile(node[3])
        test = {"<": operator.lt, "<=": operator.le, ">": operator.gt, ">=": operator.ge,
                "=": operator.eq, "!=": operator.ne}[op]
        return lambda lookup: 1.0 if test(a(lookup), b(lookup)) else 0.0
    if tag == "call":
        name, args = node[1], [_compile(x) for x in node[2]]
        if name == "if":
            c, t, f = args
            return lambda lookup: t(lookup) if _truthy(c(lookup)) else f(lookup)
        if name == "abs":
            return lambda lookup: abs(args[0](lookup))
        if name == "min":
            return lambda lookup: min([g(lookup) for g in args])
        if name == "max":
            return lambda lookup: max([g(lookup) for g in args])
        if name == "round":
            x = args[0]
            p = args[1] if len(args) == 2 else None

            def rnd(lookup):
                value = x(lookup)
                places = 0
                if p is not None:
                    q = p(lookup)
                    if q != math.floor(q) or not 0 <= q <= MAX_ROUND_PLACES:
                        raise FormulaEvalError(
                            "bad_round", f"round's places must be a whole number from 0 to {MAX_ROUND_PLACES}",
                        )
                    places = int(q)
                return _finite(_round_half_away(value, places))
            return rnd
    raise FormulaEvalError("syntax", "Not a formula")


def to_stored(text: str, name_to_id: dict[str, str | None]) -> str:
    """Rewrite every `{Name}` in `text` to `{@id}`. `name_to_id` is keyed by the
    lowercased name; a name mapped to None is shared by two properties. Unknown
    and ambiguous names raise FormulaError. Text outside braces is copied byte
    for byte."""
    tokens = tokenize(text)
    out, last = [], 0
    for kind, value, pos in tokens:
        if kind != "ref" or value[0] != "name":
            continue
        close = text.find("}", pos + 1)
        key = value[1].strip().lower()
        if key in name_to_id and name_to_id[key] is None:
            raise FormulaError("ambiguous_ref", f"Two properties are named \"{value[1]}\"; rename one", pos)
        pid = name_to_id.get(key)
        if pid is None:
            raise FormulaError("unknown_ref", f"No number property is named \"{value[1]}\"", pos)
        out.append(text[last:pos])
        out.append("{@" + pid + "}")
        last = close + 1
    out.append(text[last:])
    return "".join(out)
