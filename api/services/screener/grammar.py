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

TYPED SUBJECTS, SCOPES AND ARITHMETIC (FT-029 v2, dark behind
`SCREENER_ALERT_GRAMMAR_ENABLED`; off, both are refused with the v1 sentences):
  * `$AAPL` -- a TICKER subject. Adjacent tickers (`$AAPL $MSFT` or
    `$AAPL, $MSFT`) are one scope and UNION, the way a list's selectors do.
  * `#flagged`, `#unflagged`, `#tag:red`, `#wl:12`, or a list's own name
    with spaces written as `_` (`#swing_ideas`) -- a LIST subject, resolved
    for the caller by `resolve_scopes` into the screener's own
    `{key: "list"}` filter (so ownership is checked where it always is).
  * A scope applies to the WHOLE criteria: it may sit only as a top-level
    `and` conjunct. Under `or` / `not` it is refused -- "$AAPL or price > 5"
    has no subject.
  * Arithmetic: `+ - * /` and parentheses between numeric fields and
    numbers, compared with `> >= < <= = !=`:
        avg_volume_30d * price > 50m     (price - sma50) / price > 0.05
    It compiles to ONE leaf, `{key: "arith", op, lhs, rhs}`, which
    `query.build_where` renders through the same `col_expr` and column
    check as every other leaf. Division by zero is NULL (no match), never
    an error. `-` needs a space after it (`a - b`; `a-b` reads as one name).

`@sector` stays refused: `sector in [..]` already says it.
"""
from __future__ import annotations

import difflib
import os
import re
from dataclasses import dataclass

from . import filters

SUFFIX = {"k": 1e3, "m": 1e6, "b": 1e9, "t": 1e12}
CMP = {">": "gt", ">=": "gte", "<": "lt", "<=": "lte", "=": "eq", "==": "eq", "!=": "ne"}
COL_OP = {"gt": "gt_col", "gte": "gte_col", "lt": "lt_col", "lte": "lte_col"}
KEYWORDS = {"and", "or", "not", "in", "between", "contains", "true", "false", "yes", "no"}
MAX_TEXT = 2000
#: FT-029 v2 -- scopes ($AAPL / #list) and arithmetic. Read per call.
V2_FLAG = "SCREENER_ALERT_GRAMMAR_ENABLED"
ARITH_KEY = "arith"
ARITH_OPS = ("+", "-", "*", "/")
#: Terms one arithmetic criterion may hold -- a criterion, not a program.
MAX_ARITH_NODES = 15

_ARITH_REFUSAL = ("arithmetic between fields (like size * price) is not in the "
                  "language yet; compare two fields directly instead")


def v2_enabled() -> bool:
    return os.environ.get(V2_FLAG, "0").strip() == "1"

_TOKEN = re.compile(r"""
    (?P<ws>\s+)
  | (?P<num>-?(?:\d+\.?\d*|\.\d+)(?:[kKmMbBtT](?![A-Za-z_])|%)?)
  | (?P<str>"[^"]*"|'[^']*')
  | (?P<op>>=|<=|==|!=|>|<|=)
  | (?P<punct>[()\[\],])
  | (?P<scope>[$@#][A-Za-z0-9_.:\-]+)
  | (?P<arith>[*/+]|-(?=[\s(]))
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
        v2 = v2_enabled()
        if kind == "scope" and (not v2 or m.group()[0] == "@"):
            raise GrammarError(
                f"scope prefixes like '{m.group()}' are not in the language yet; "
                "use a field such as sector in [..] instead")
        if kind == "arith" and not v2:
            raise GrammarError(_ARITH_REFUSAL)
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
        if t is not None and t.kind == "scope":
            return self._scope()
        if t is not None and t.kind == "punct" and t.text == "(":
            start = self.i
            self.i += 1
            try:
                node = self.or_()
                self.take("punct", ")")
                return node
            except GrammarError as first:
                # `(price - sma50) / price > 0.05` opens with a paren that is
                # ARITHMETIC, not grouping. Re-read it as an expression; if that
                # fails too, the grouping reading's sentence is the useful one.
                if not v2_enabled():
                    raise
                self.i = start
                try:
                    return self._arith_comparison()
                except GrammarError:
                    raise first from None
        return self.comparison()

    # ── FT-029 v2: typed subjects ────────────────────────────────────────
    def _scope(self):
        subs = []
        while True:
            t = self.peek()
            if t is None or t.kind != "scope":
                break
            self.i += 1
            subs.append(_subject(t))
            nxt, after = self.peek(), self.peek(1)
            if (nxt is not None and nxt.kind == "punct" and nxt.text == ","
                    and after is not None and after.kind == "scope"):
                self.i += 1
        return {"scope": subs}

    # ── FT-029 v2: arithmetic ────────────────────────────────────────────
    def _is_arith(self, k=0):
        t = self.peek(k)
        return t is not None and t.kind == "arith"

    def _arith_comparison(self, lhs=None):
        lhs = lhs if lhs is not None else self._expr()
        opt = self.take("op", label="a comparison like >, <= or =")
        rhs = self._expr()
        if not (_has_field(lhs) or _has_field(rhs)):
            raise GrammarError("an arithmetic criterion needs at least one field")
        if _count(lhs) + _count(rhs) > MAX_ARITH_NODES:
            raise GrammarError(
                f"an arithmetic criterion can hold at most {MAX_ARITH_NODES} terms")
        return {"key": ARITH_KEY, "op": CMP[opt.text], "lhs": lhs, "rhs": rhs}

    def _expr(self):
        node = self._term()
        while self._is_arith() and self.peek().text in ("+", "-"):
            op = self.take().text
            node = {"o": op, "a": node, "b": self._term()}
        return node

    def _term(self):
        node = self._factor()
        while self._is_arith() and self.peek().text in ("*", "/"):
            op = self.take().text
            node = {"o": op, "a": node, "b": self._factor()}
        return node

    def _factor(self):
        t = self.take()
        if t.kind == "punct" and t.text == "(":
            node = self._expr()
            self.take("punct", ")")
            return node
        if t.kind == "num":
            if t.text.endswith("%"):
                raise GrammarError(
                    f"'{t.text}': inside arithmetic write the plain number "
                    "(a percent field's 5% is 5)")
            return {"n": _plain_number(t)}
        if t.kind == "word" and t.text.lower() not in KEYWORDS:
            key = _resolve_field(t)
            if filters.FILTERS[key]["type"] != "range":
                raise GrammarError(
                    f"{filters.FILTERS[key]['label']} is not a number, so it "
                    "cannot be used in arithmetic")
            return {"f": key}
        raise GrammarError(f"expected a number or a field at position {t.pos + 1}")

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
        head = self.peek()
        if head is not None and (head.kind == "num" or
                                 (head.kind == "word" and self._is_arith(1))):
            if not v2_enabled():
                raise GrammarError(_ARITH_REFUSAL)
            return self._arith_comparison()
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
        nxt = self.peek()
        if v2_enabled() and nxt is not None and (
                self._is_arith(1) or (nxt.kind == "punct" and nxt.text == "(")):
            if ftype != "range":
                raise GrammarError(
                    f"{filters.FILTERS[key]['label']} is not a number, so it "
                    "cannot be compared with arithmetic")
            self.i -= 1                     # re-read the comparison operator
            return self._arith_comparison(lhs={"f": key})
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


def _subject(tok: Tok) -> dict:
    """A scope token -> a typed subject. Never resolved here: a list name means
    something only for the caller, so `resolve_scopes` does that with a user id."""
    body = tok.text[1:]
    if tok.text[0] == "$":
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9.\-]{0,9}", body):
            raise GrammarError(f"'{tok.text}' is not a ticker")
        return {"kind": "ticker", "value": body.upper()}
    return {"kind": "list", "value": body}


def _has_field(e) -> bool:
    if "f" in e:
        return True
    if "o" in e:
        return _has_field(e["a"]) or _has_field(e["b"])
    return False


def _count(e) -> int:
    return 1 + (_count(e["a"]) + _count(e["b"]) if "o" in e else 0)


def _plain_number(tok: Tok) -> float:
    t = tok.text
    mult = 1.0
    if t[-1].lower() in SUFFIX:
        mult, t = SUFFIX[t[-1].lower()], t[:-1]
    v = float(t) * mult
    return int(v) if v.is_integer() and abs(v) < 1e15 else v


def arith_fields(e) -> list[str]:
    """Every filter key an arithmetic expression reads, in order."""
    if "f" in e:
        return [e["f"]]
    if "o" in e:
        return arith_fields(e["a"]) + arith_fields(e["b"])
    return []


def _split_scopes(node):
    """Pull top-level scope conjuncts out of the tree. A scope anywhere else
    (under `or` / `not`) is refused: it would have no subject."""
    scopes, rest = [], node
    if "scope" in node:
        scopes, rest = [node["scope"]], None
    elif "all" in node:
        kids = []
        for c in node["all"]:
            if isinstance(c, dict) and "scope" in c:
                scopes.append(c["scope"])
            else:
                kids.append(c)
        rest = None if not kids else (kids[0] if len(kids) == 1 else {"all": kids})

    def walk(n):
        if not isinstance(n, dict) or "key" in n:
            return
        if "scope" in n:
            raise GrammarError(
                "a scope ($TICKER / #list) applies to the whole criteria; it "
                "cannot sit inside or / not")
        for k in ("all", "any", "none"):
            for c in n.get(k, []):
                walk(c)
        if "not" in n:
            walk(n["not"])

    if rest is not None:
        walk(rest)
    return scopes, rest


def compile_text(text: str) -> dict:
    """Text -> {"logic": node | None, "subjects": [[subject, ...], ...]}.

    Each inner list is ONE scope (its members union); separate scopes
    intersect, the same way two `list` filters do."""
    tree = _Parser(tokenize(text or "")).parse()
    scopes, rest = _split_scopes(tree)
    return {"logic": rest, "subjects": scopes}


def parse(text: str) -> dict:
    """Text -> a `logic` node. Raises GrammarError (a ValueError) with a sentence.

    A text that carries a scope is refused here: a bare logic node has nowhere
    to put a subject. `compile_text` + `resolve_scopes` is the scoped path."""
    out = compile_text(text)
    if out["subjects"]:
        raise GrammarError(
            "this criteria names a scope ($TICKER / #list); a scope is the "
            "screen's universe, not a criterion")
    return out["logic"]


def resolve_scopes(subjects: list, user_id) -> list[dict]:
    """Typed subjects -> the screener's own flat filters, for THIS caller.

    Tickers become `{key: "tickers"}`; lists become `{key: "list"}` with a
    selector `list_universe` already resolves (and already refuses when the
    caller does not own it). A list NAME is looked up among the caller's own
    lists; zero or two matches is refused, never guessed."""
    from . import list_universe
    out = []
    for scope in subjects or []:
        tickers = [s["value"] for s in scope if s["kind"] == "ticker"]
        lists = [s["value"] for s in scope if s["kind"] == "list"]
        if tickers and lists:
            raise GrammarError(
                "one scope cannot mix tickers and lists; write them as two "
                "scopes joined by and")
        if tickers:
            out.append({"key": "tickers", "op": "in", "values": tickers})
            continue
        sels = []
        for name in lists:
            low = name.lower()
            if low in (list_universe.FLAGGED, list_universe.UNFLAGGED) or \
                    low.startswith("tag:") or low.startswith("wl:"):
                sels.append(low)
                continue
            hits = [a["value"] for a in list_universe.available(user_id)
                    if str(a.get("value", "")).startswith("wl:")
                    and str(a.get("label", "")).rsplit(" (", 1)[0].strip()
                    .lower().replace(" ", "_") == low]
            if len(hits) != 1:
                raise GrammarError(
                    f"'#{name}' does not name exactly one of your lists"
                    + ("" if not hits else
                       " (several of your lists have that name; use #wl:<id>)"))
            sels.append(hits[0])
        out.append({"key": "list", "op": "in",
                    "value": sels if len(sels) > 1 else sels[0]})
    return out


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


def _explain_expr(e, top=True) -> str:
    if "f" in e:
        return filters.FILTERS.get(e["f"], {"label": e["f"]})["label"]
    if "n" in e:
        return _fmt(e["n"], None)
    body = f"{_explain_expr(e['a'], False)} {e['o']} {_explain_expr(e['b'], False)}"
    return body if top else f"({body})"


_CMP_WORDS = {"gt": "is above", "gte": "is at least", "lt": "is below",
              "lte": "is at most", "eq": "equals", "ne": "is not"}


def explain_leaf(leaf: dict) -> str:
    if leaf.get("key") == ARITH_KEY:
        return (f"{_explain_expr(leaf['lhs'])} {_CMP_WORDS[leaf['op']]} "
                f"{_explain_expr(leaf['rhs'])}")
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
        **({"scopes": {"$TICKER": "a ticker subject; adjacent tickers union",
                       "#flagged | #unflagged | #tag:<colour> | #wl:<id> | #<list_name>":
                           "one of your own lists (spaces in a name written as _)"},
            "arithmetic": {"operators": list(ARITH_OPS), "max_terms": MAX_ARITH_NODES},
            "not_supported": ["@group scope prefixes (use sector in [..])"]}
           if v2_enabled() else
           {"not_supported": ["arithmetic between fields",
                              "$ticker / @group / #list scope prefixes"]}),
        "max_criteria": 25,
        "fields": [{"key": k, "label": f["label"], "type": f["type"], "unit": f.get("unit")}
                   for k, f in filters.FILTERS.items()],
    }
