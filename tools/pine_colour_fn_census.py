# -*- coding: utf-8 -*-
"""J3-B — can a NARROW fold carry a user-function colour into a colour position?

The translator (`app/src/components/chart/engine/ast/pine.js`) cannot carry a
colour that is a USER-FUNCTION CALL: `staticColourOf` (~:12309) has no
user-function branch, and its `color.new` branch (~:12359) returns null when the
transparency is not a numeric literal.

Uncharted Clouds' 20 fills are exactly that shape:

    fill(p1, p2, color = isBullish ? getBullFillColor(0) : getBearFillColor(0))
    getBullFillColor(k) => color.new(bullColor, getAdjustedTransparency(k, bullUserTransparency))

The owner's R32 asks for the NARROWEST fold that carries Clouds. This census
measures, per script and per COLOUR POSITION, what each candidate fold would
carry and what its blast radius is.

WHAT IS MEASURED PER POSITION
  carried today  — replicates `staticColourOf` + `colourConditional` exactly,
                   INCLUDING the `color.new` branch's non-recursive base.
  (i)            — user-function call substituted when the body is ONE colour
                   expression, every call-site argument is plan-time (a literal,
                   or a name bound to a literal / an input default), the base is
                   a static colour and the alpha is a literal or ARITHMETIC over
                   plan-time arguments and literals. No nested calls.
  (i-tern)       — (i), plus a body that is a single TERNARY of colour
                   expressions. Reported separately so the owner can see what
                   that one relaxation buys.
  (ii)           — a plan-time evaluator over user functions: nested calls,
                   multi-statement numeric bodies with local bindings, builtin
                   math, and `color.t` of a static colour. This is the general
                   constant folder, measured HERE only in colour positions — its
                   non-colour blast radius is NOT measured by this tool.

CONTROLS (this file is a literal-hunting check, and this repo has six recorded
instances of one matching its own prose):
  1. the stripper carries its own probe (comment + string + real code), and a
     counter-probe proving it does not over-strip;
  2. the Pine colour table is DERIVED from `pine.js`, never retyped here;
  3. the recorded figure 56 (`tools/pine_colour_census.py`) is re-derived by
     replicating that tool's predicate byte-for-byte and compared, pass/fail.
"""
import io
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = [
    os.path.join(ROOT, 'corpus/committed'),
    os.path.join(ROOT, 'tests/fixtures/pine_oos'),
    os.path.join(ROOT, 'tests/fixtures/member'),
]
PINE_JS = os.path.join(ROOT, 'app/src/components/chart/engine/ast/pine.js')

# ── the stripper, verbatim from tools/pine_colour_census.py ──────────────────


def strip_pine(src):
    """Remove `//` comments and string literals, preserving line count."""
    out = []
    for line in src.split('\n'):
        res, i, n, quote = [], 0, len(line), None
        while i < n:
            ch = line[i]
            if quote:
                if ch == quote:
                    quote = None
                res.append(' ')
                i += 1
                continue
            if ch in '"\'':
                quote = ch
                res.append(' ')
                i += 1
                continue
            if ch == '/' and i + 1 < n and line[i + 1] == '/':
                break
            res.append(ch)
            i += 1
        out.append(''.join(res))
    return '\n'.join(out)


def call_args(text, start):
    """Return the argument text of a call whose '(' follows index `start`."""
    i = text.find('(', start)
    if i < 0:
        return ''
    depth, j = 0, i
    while j < len(text):
        if text[j] == '(':
            depth += 1
        elif text[j] == ')':
            depth -= 1
            if depth == 0:
                return text[i + 1:j]
        j += 1
    return text[i + 1:]


# ── the stripper's own control ──────────────────────────────────────────────
PROBE = '\n'.join([
    '// color.new(a, 50) in a comment',
    'x = "color.new(a, 50) in a string"',
    'plot(close, color=color.new(red, 50))',
    'f(k) => color.new(base, k)   // getBullFillColor in a comment',
])
_p = strip_pine(PROBE)
assert _p.count('color.new') == 2, 'stripper control: expected exactly 2 color.new'
assert 'getBullFillColor' not in _p, 'stripper control: comment text survived'
# counter-control: the stripper must not eat real code
assert 'plot(close, color=' in _p, 'stripper counter-control: real code was stripped'
assert _p.count('\n') == PROBE.count('\n'), 'stripper control: line count moved'


# ── the Pine colour table, DERIVED from pine.js (never retyped) ─────────────
def pine_colours():
    src = io.open(PINE_JS, encoding='utf-8', errors='replace').read()
    m = re.search(r'const PINE_COLOURS = Object\.freeze\(\{(.*?)\}\)', src, re.S)
    if not m:
        raise SystemExit('control: could not read PINE_COLOURS from pine.js')
    pairs = re.findall(r"'color\.([a-z]+)':\s*'(#[0-9A-Fa-f]{6})'", m.group(1))
    if len(pairs) < 10:
        raise SystemExit('control: PINE_COLOURS parse returned %d entries' % len(pairs))
    return {k: v for k, v in pairs}


COLOURS = pine_colours()          # bare spelling -> hex ('red', 'teal', ...)
assert 'teal' in COLOURS and 'maroon' in COLOURS, 'control: colour table incomplete'

NUM_RE = re.compile(r'^[+-]?(?:\d+\.?\d*|\.\d+)$')
HEX_RE = re.compile(r'^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$')
IDENT = r'[A-Za-z_][A-Za-z0-9_]*'
CALL_RE = re.compile(r'^(' + IDENT + r'(?:\.' + IDENT + r')*)\s*\((.*)\)$', re.S)
NAME_RE = re.compile(r'^' + IDENT + r'$')


# ── tiny text-expression helpers (balanced, top-level aware) ────────────────
def _matching(s, i):
    depth = 0
    for j in range(i, len(s)):
        if s[j] in '([':
            depth += 1
        elif s[j] in ')]':
            depth -= 1
            if depth == 0:
                return j
    return -1


def unwrap(s):
    s = (s or '').strip()
    while s.startswith('(') and _matching(s, 0) == len(s) - 1:
        s = s[1:-1].strip()
    return s


def split_top(s, sep=','):
    """⛔⛔ EMPTY PARTS ARE KEPT, AND THAT IS THE WHOLE POINT FOR ARGUMENTS.
    `strip_pine` blanks string literals, so `plot(close, "title", color.new(…))`
    arrives as `close, , color.new(…)`. Dropping the blank shifts every
    POSITIONAL index left by one and the colour argument is read as whatever
    follows it — measured: it silently lost 7 of the control's 56 scripts."""
    if not s.strip():
        return []
    out, depth, cur = [], 0, []
    for ch in s:
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        if ch == sep and depth == 0:
            out.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append(''.join(cur))
    return [x.strip() for x in out]


ARGNAME_RE = re.compile(r'^(' + IDENT + r')\s*=(?!=)\s*(.*)$', re.S)


def parse_args(argtext):
    """[(name|None, value_text)] for one call's argument text."""
    out = []
    for raw in split_top(argtext):
        m = ARGNAME_RE.match(raw)
        if m and not raw.lstrip().startswith(('==', '>=', '<=', '!=')):
            out.append((m.group(1), m.group(2).strip()))
        else:
            out.append((None, raw.strip()))
    return out


def as_call(s):
    s = unwrap(s)
    m = CALL_RE.match(s)
    if not m:
        return None
    # the opening paren must close at the very end (else it is `f(x) + 1`)
    i = s.find('(')
    if _matching(s, i) != len(s) - 1:
        return None
    return m.group(1), m.group(2)


def as_ternary(s):
    """(test, yes, no) or None, for a top-level `a ? b : c`."""
    s = unwrap(s)
    depth = 0
    q = -1
    for i, ch in enumerate(s):
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        elif ch == '?' and depth == 0:
            q = i
            break
    if q < 0:
        return None
    depth, level = 0, 0
    for i in range(q + 1, len(s)):
        ch = s[i]
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        elif depth == 0 and ch == '?':
            level += 1
        elif depth == 0 and ch == ':':
            if s[i - 1:i + 1] == ':=':
                continue
            if level == 0:
                return s[:q].strip(), s[q + 1:i].strip(), s[i + 1:].strip()
            level -= 1
    return None


# ── logical lines (continuation-joined) ─────────────────────────────────────
# ⛔ PINE CONTINUES A LINE BY INDENTATION, NOT ONLY INSIDE PARENTHESES.
# ⚰️ MEASURED on `machine-learning-logistic-regression`: `cAqua(g) => g>9?…:g>5?…`
# wraps onto a more-indented line beginning `: g>4?…`, with every paren balanced.
# A paren-only joiner silently TRUNCATES that body mid-ternary and the shape reads
# as something the author never wrote.
# ⚠️ `=>` is excluded from the end-of-line operators on purpose — a function
# header ends in `>` and joining it to its own body destroys every body shape.
CONT_START = re.compile(r'^(?:[:?+\-*/%,)\]]|and\b|or\b)')
CONT_END = re.compile(r'(?:[?:+\-*/%,=<>]|\band\b|\bor\b)\s*$')


def logical_lines(src):
    """[(lineno, indent, text)] with paren- AND indent-continuations joined."""
    raws = src.split('\n')
    out, i, n = [], 0, len(raws)
    while i < n:
        if not raws[i].strip():
            i += 1
            continue
        start = i + 1
        indent = len(raws[i]) - len(raws[i].lstrip())
        buf = raws[i].strip()
        i += 1
        while i < n:
            depth = sum(1 for c in buf if c in '([') - sum(1 for c in buf if c in ')]')
            nxt = raws[i].strip()
            if not nxt:
                if depth > 0:
                    i += 1
                    continue
                break
            nxt_indent = len(raws[i]) - len(raws[i].lstrip())
            cont = depth > 0
            if not cont and nxt_indent > indent and not buf.rstrip().endswith('=>'):
                cont = bool(CONT_START.match(nxt) or CONT_END.search(buf))
            if not cont:
                break
            buf += ' ' + nxt
            i += 1
        out.append((start, indent, buf.strip()))
    return out


FUNCDEF_RE = re.compile(r'^(' + IDENT + r')\s*\(([^()]*)\)\s*=>\s*(.*)$', re.S)
ASSIGN_RE = re.compile(r'^(?:var\s+|varip\s+)?(' + IDENT + r')\s*=(?!=|>)\s*(.+)$', re.S)
REASSIGN_RE = re.compile(r'\b(' + IDENT + r')\s*:=')


class Script(object):
    def __init__(self, path, src):
        self.path = path
        self.name = os.path.basename(path)
        self.src = src
        self.globals = {}     # name -> expr text (top level, single binding)
        self.reassigned = set()
        self.funcs = {}       # name -> {'params': [...], 'body': [stmt, ...]}
        self._parse()

    def _parse(self):
        lines = logical_lines(self.src)
        for nm in REASSIGN_RE.findall(self.src):
            self.reassigned.add(nm)
        i = 0
        while i < len(lines):
            lineno, indent, text = lines[i]
            m = FUNCDEF_RE.match(text)
            if m and indent == 0:
                fname, params, rest = m.group(1), m.group(2), m.group(3).strip()
                body = []
                if rest:
                    body.append(rest)
                    i += 1
                else:
                    i += 1
                    while i < len(lines) and (lines[i][1] > 0 or lines[i][2] == ''):
                        if lines[i][2]:
                            body.append((lines[i][1], lines[i][2]))
                        i += 1
                    body = [t if isinstance(t, str) else t for t in body]
                self.funcs[fname] = {
                    'params': [p.strip() for p in params.split(',') if p.strip()],
                    'body': body,
                    'line': lineno,
                }
                continue
            if indent == 0:
                a = ASSIGN_RE.match(text)
                if a and not FUNCDEF_RE.match(text):
                    nm, val = a.group(1), a.group(2).strip()
                    if nm not in self.globals:
                        self.globals[nm] = val
            i += 1

    def bound(self, name):
        if name in self.reassigned:
            return None
        return self.globals.get(name)


# ── body shape ──────────────────────────────────────────────────────────────
def body_statements(fn):
    """Normalised list of body statement texts, or None when the body nests."""
    out = []
    base = None
    for st in fn['body']:
        if isinstance(st, str):
            out.append(st)
            continue
        ind, text = st
        if base is None:
            base = ind
        if ind > base:
            return None          # a nested block (if/for/while) — not flat
        out.append(text)
    return out


def body_shape(fn, sc):
    sts = body_statements(fn)
    if sts is None:
        return 'multi-statement (nested block)'
    if len(sts) != 1:
        return 'multi-statement'
    expr = sts[0]
    if ASSIGN_RE.match(expr) and not as_ternary(expr):
        return 'multi-statement'
    if as_ternary(expr):
        t, y, n = as_ternary(expr)
        if colour_ish(y, sc) and colour_ish(n, sc):
            return 'single ternary of colour expressions'
        return 'other'
    if colour_ish(expr, sc):
        return 'single colour expression'
    return 'other'


def colour_ish(expr, sc, depth=0):
    """Does this expression LOOK like a colour expression (shape only)?"""
    e = unwrap(expr)
    if depth > 6:
        return False
    if HEX_RE.match(e):
        return True
    if NAME_RE.match(e):
        if e in COLOURS:
            return True
        b = sc.bound(e)
        return colour_ish(b, sc, depth + 1) if b else False
    if re.match(r'^color\.(' + '|'.join(COLOURS) + r')$', e):
        return True
    c = as_call(e)
    if c and c[0] in ('color.new', 'color.rgb', 'color.from_gradient', 'input.color'):
        return True
    return False


# ── shape classification of a colour POSITION ───────────────────────────────
SHAPES = ['literal colour', 'colour constant', 'color.new(...)', 'color.rgb(...)',
          'user-function call', 'ternary over the above', 'other']


def shape_of(expr, sc, depth=0):
    e = unwrap(expr)
    if depth > 8 or not e:
        return 'other'
    if HEX_RE.match(e):
        return 'literal colour'
    if NAME_RE.match(e):
        if e in COLOURS:
            return 'colour constant'
        b = sc.bound(e)
        if b:
            return shape_of(b, sc, depth + 1)
        return 'other'
    if re.match(r'^color\.(' + '|'.join(COLOURS) + r')$', e):
        return 'colour constant'
    t = as_ternary(e)
    if t:
        return 'ternary over the above'
    c = as_call(e)
    if c:
        fn, _ = c
        if fn == 'color.new':
            return 'color.new(...)'
        if fn == 'color.rgb':
            return 'color.rgb(...)'
        if fn == 'input.color':
            return shape_of(parse_args(c[1])[0][1], sc, depth + 1) if parse_args(c[1]) else 'other'
        if fn in sc.funcs:
            return 'user-function call'
        return 'other'
    return 'other'


def user_fn_calls_in(expr, sc, depth=0, out=None):
    """Every user-function call reachable from a colour position (names followed)."""
    if out is None:
        out = []
    e = unwrap(expr)
    if depth > 8 or not e:
        return out
    if NAME_RE.match(e):
        b = sc.bound(e)
        if b:
            user_fn_calls_in(b, sc, depth + 1, out)
        return out
    t = as_ternary(e)
    if t:
        user_fn_calls_in(t[1], sc, depth + 1, out)
        user_fn_calls_in(t[2], sc, depth + 1, out)
        return out
    c = as_call(e)
    if c:
        fn, argtext = c
        if fn in sc.funcs:
            out.append((fn, [v for _, v in parse_args(argtext)]))
            return out
        for _, v in parse_args(argtext):
            user_fn_calls_in(v, sc, depth + 1, out)
    return out


# ── today's translator, replicated ──────────────────────────────────────────
def static_colour_today(expr, sc, depth=0):
    """`staticColourOf` — including the `color.new` branch's NON-recursive base."""
    e = unwrap(expr)
    if depth > 8 or not e:
        return None
    if NAME_RE.match(e):
        b = sc.bound(e)
        if b is not None:
            return static_colour_today(b, sc, depth + 1)
        return COLOURS.get(e)
    if HEX_RE.match(e):
        return e
    m = re.match(r'^color\.(' + '|'.join(COLOURS) + r')$', e)
    if m:
        return COLOURS[m.group(1)]
    c = as_call(e)
    if not c:
        return None
    fn, argtext = c
    args = parse_args(argtext)
    pos = [v for n, v in args if n is None]
    if fn == 'color.rgb':
        if len(pos) >= 3 and all(NUM_RE.match(unwrap(x)) for x in pos[:3]):
            if len(pos) >= 4 and not NUM_RE.match(unwrap(pos[3])):
                return None
            ch = [int(round(float(unwrap(x)))) for x in pos[:3]]
            if all(0 <= v <= 255 for v in ch):
                return '#' + ''.join('%02X' % v for v in ch)
        return None
    if fn == 'input.color':
        return static_colour_today(pos[0], sc, depth + 1) if pos else None
    if fn == 'color.new':
        if len(pos) >= 2 and not NUM_RE.match(unwrap(pos[1])):
            return None
        base = unwrap(pos[0]) if pos else ''
        # ⛔ EXACTLY AS SHIPPED: the base is checked with isColourName / a colour
        # literal and is NOT recursed into. A NAME bound to `input.color(...)`
        # therefore fails today — which is Clouds' base.
        if base in COLOURS:
            return COLOURS[base]
        m2 = re.match(r'^color\.(' + '|'.join(COLOURS) + r')$', base)
        if m2:
            return COLOURS[m2.group(1)]
        if HEX_RE.match(base):
            return base
        return None
    return None


def carried_today(expr, sc):
    """`outputPresentation`'s colour path: flat static, or a 2-branch ternary."""
    if static_colour_today(expr, sc):
        return True
    e = unwrap(expr)
    if NAME_RE.match(e):
        b = sc.bound(e)
        return carried_today(b, sc) if b else False
    t = as_ternary(e)
    if t:
        return bool(static_colour_today(t[1], sc) and static_colour_today(t[2], sc))
    return False


# ── plan-time evaluation ────────────────────────────────────────────────────
class NotPlanTime(Exception):
    pass


def plan_time_strict(expr, sc, depth=0):
    """(i)'s call-site rule: a literal, or a name bound to a literal / input default."""
    e = unwrap(expr)
    if depth > 6 or not e:
        return False
    if NUM_RE.match(e) or HEX_RE.match(e):
        return True
    if e in COLOURS or re.match(r'^color\.(' + '|'.join(COLOURS) + r')$', e):
        return True
    if NAME_RE.match(e):
        b = sc.bound(e)
        return plan_time_strict(b, sc, depth + 1) if b is not None else False
    c = as_call(e)
    if c and c[0].startswith('input.'):
        pos = [v for n, v in parse_args(c[1]) if n is None]
        return plan_time_strict(pos[0], sc, depth + 1) if pos else False
    return False


ARITH_OK = re.compile(r'^[0-9A-Za-z_.\s()+\-*/%]*$')


def eval_arith(expr, sc, env, depth=0):
    """(i)'s alpha rule: arithmetic over literals and plan-time names. NO calls."""
    e = unwrap(expr)
    if depth > 8 or not e:
        raise NotPlanTime()
    if NUM_RE.match(e):
        return float(e)
    if NAME_RE.match(e):
        if e in env:
            return env[e]
        b = sc.bound(e)
        if b is None:
            raise NotPlanTime()
        return eval_arith(b, sc, env, depth + 1)
    if as_call(e) or not ARITH_OK.match(e):
        raise NotPlanTime()
    names = set(re.findall(IDENT, e))
    local = {}
    for nm in names:
        if nm in env:
            local[nm] = env[nm]
        else:
            b = sc.bound(nm)
            if b is None:
                raise NotPlanTime()
            local[nm] = eval_arith(b, sc, env, depth + 1)
    try:
        return float(eval(e, {'__builtins__': {}}, local))   # noqa: S307 — arithmetic only, ARITH_OK-gated
    except Exception:
        raise NotPlanTime()


# When False the plan-time evaluator refuses to enter a user function at all.
# That isolates the part of (ii)'s blast radius that is NOT about user functions
# — recursing `color.new`'s base through a name and allowing a plan-time
# ARITHMETIC alpha — so the owner can see which half of the gain each buys.
ALLOW_UFN = [True]

MATH_FNS = {
    'math.min': min, 'math.max': max, 'math.abs': abs,
    'math.round': lambda x: float(round(x)), 'math.floor': lambda x: float(int(x // 1)),
    'math.ceil': lambda x: float(-int((-x) // 1)), 'math.sqrt': lambda x: x ** 0.5,
}


def split_top_str(s, sep):
    out, depth, i, last = [], 0, 0, 0
    while i < len(s):
        ch = s[i]
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        elif depth == 0 and s.startswith(sep, i):
            out.append(s[last:i])
            i += len(sep)
            last = i
            continue
        i += 1
    out.append(s[last:])
    return [x.strip() for x in out]


def eval_bool(expr, sc, env, depth=0):
    """A plan-time CONDITION. Constant folding is not folding without it — a
    literal-argument call like `cAqua(10)` selects one branch of a ternary chain
    and collapses to a single colour."""
    e = unwrap(expr)
    if depth > 12 or not e:
        raise NotPlanTime()
    if e in ('true', 'false'):
        return e == 'true'
    for sep, comb in ((' or ', any), (' and ', all)):
        parts = split_top_str(e, sep)
        if len(parts) > 1:
            return comb(eval_bool(p, sc, env, depth + 1) for p in parts)
    if e.startswith('not '):
        return not eval_bool(e[4:], sc, env, depth + 1)
    for op in ('>=', '<=', '==', '!=', '>', '<'):
        parts = split_top_str(e, op)
        if len(parts) == 2 and parts[0] and parts[1]:
            a = eval_num_full(parts[0], sc, env, depth + 1)
            b = eval_num_full(parts[1], sc, env, depth + 1)
            return {'>=': a >= b, '<=': a <= b, '==': a == b,
                    '!=': a != b, '>': a > b, '<': a < b}[op]
    if NAME_RE.match(e):
        if e in env and isinstance(env[e], bool):
            return env[e]
        b = sc.bound(e)
        if b is not None:
            return eval_bool(b, sc, env, depth + 1)
    raise NotPlanTime()


def eval_num_full(expr, sc, env, depth=0):
    """(ii)'s numeric rule: arithmetic + builtin math + `color.t` + user calls."""
    e = unwrap(expr)
    if depth > 12 or not e:
        raise NotPlanTime()
    if NUM_RE.match(e):
        return float(e)
    t = as_ternary(e)
    if t:
        return eval_num_full(t[1] if eval_bool(t[0], sc, env, depth + 1) else t[2],
                             sc, env, depth + 1)
    c = as_call(e)
    if c:
        fn, argtext = c
        args = parse_args(argtext)
        pos = [v for n, v in args if n is None]
        if fn in MATH_FNS:
            vals = [eval_num_full(v, sc, env, depth + 1) for v in pos]
            try:
                return float(MATH_FNS[fn](*vals))
            except Exception:
                raise NotPlanTime()
        if fn == 'color.t':
            hexv = eval_colour_full(pos[0], sc, env, depth + 1) if pos else None
            if not hexv:
                raise NotPlanTime()
            return 0.0 if len(hexv) <= 7 else round((1 - int(hexv[7:9], 16) / 255.0) * 100, 4)
        if fn in sc.funcs and ALLOW_UFN[0]:
            return call_fn(fn, pos, sc, env, depth + 1, want='num')
        raise NotPlanTime()
    if NAME_RE.match(e):
        if e in env:
            return env[e]
        b = sc.bound(e)
        if b is None:
            raise NotPlanTime()
        return eval_num_full(b, sc, env, depth + 1)
    if not ARITH_OK.match(e):
        raise NotPlanTime()
    # split an arithmetic expression whose leaves may themselves be calls
    for op in ('+', '-', '*', '/', '%'):
        parts = split_top(e, op)
        if len(parts) > 1 and all(p.strip() for p in parts):
            vals = [eval_num_full(p, sc, env, depth + 1) for p in parts]
            acc = vals[0]
            for v in vals[1:]:
                if op == '+':
                    acc += v
                elif op == '-':
                    acc -= v
                elif op == '*':
                    acc *= v
                elif op == '/':
                    acc = acc / v if v else float('nan')
                else:
                    acc = acc % v
            return acc
    raise NotPlanTime()


def eval_colour_full(expr, sc, env, depth=0):
    """A static colour under (ii): recursive base, plan-time alpha, user calls."""
    e = unwrap(expr)
    if depth > 12 or not e:
        return None
    if HEX_RE.match(e):
        return e
    t = as_ternary(e)
    if t:
        try:
            pick = t[1] if eval_bool(t[0], sc, env, depth + 1) else t[2]
        except NotPlanTime:
            return None
        return eval_colour_full(pick, sc, env, depth + 1)
    if NAME_RE.match(e):
        if e in env and isinstance(env[e], str):
            return env[e]
        if e in COLOURS:
            return COLOURS[e]
        b = sc.bound(e)
        return eval_colour_full(b, sc, env, depth + 1) if b is not None else None
    m = re.match(r'^color\.(' + '|'.join(COLOURS) + r')$', e)
    if m:
        return COLOURS[m.group(1)]
    c = as_call(e)
    if not c:
        return None
    fn, argtext = c
    args = parse_args(argtext)
    pos = [v for n, v in args if n is None]
    if fn == 'input.color':
        return eval_colour_full(pos[0], sc, env, depth + 1) if pos else None
    if fn == 'color.new':
        if len(pos) < 1:
            return None
        base = eval_colour_full(pos[0], sc, env, depth + 1)
        if not base:
            return None
        if len(pos) < 2:
            return base
        try:
            tv = eval_num_full(pos[1], sc, env, depth + 1)
        except NotPlanTime:
            return None
        return base[:7] + '%02X' % max(0, min(255, int(round((1 - tv / 100.0) * 255))))
    if fn == 'color.rgb':
        try:
            ch = [eval_num_full(v, sc, env, depth + 1) for v in pos[:3]]
        except NotPlanTime:
            return None
        if len(ch) < 3 or not all(0 <= v <= 255 for v in ch):
            return None
        return '#' + ''.join('%02X' % int(round(v)) for v in ch)
    if fn in sc.funcs and ALLOW_UFN[0]:
        try:
            return call_fn(fn, pos, sc, env, depth + 1, want='colour')
        except NotPlanTime:
            return None
    return None


def call_fn(fname, argvals, sc, env, depth, want):
    """Substitute a user function body under plan-time arguments."""
    if depth > 12:
        raise NotPlanTime()
    fn = sc.funcs[fname]
    sts = body_statements(fn)
    if sts is None:
        raise NotPlanTime()
    local = {}
    for p, a in zip(fn['params'], argvals):
        hexv = eval_colour_full(a, sc, env, depth + 1)
        if hexv:
            local[p] = hexv
            continue
        local[p] = eval_num_full(a, sc, env, depth + 1)
    for st in sts[:-1]:
        m = ASSIGN_RE.match(st)
        if not m:
            raise NotPlanTime()
        nm, val = m.group(1), m.group(2)
        hexv = eval_colour_full(val, sc, local, depth + 1)
        local[nm] = hexv if hexv else eval_num_full(val, sc, local, depth + 1)
    last = sts[-1]
    if want == 'colour':
        v = eval_colour_full(last, sc, local, depth + 1)
        if v:
            return v
        t = as_ternary(last)
        if t:
            # the test is not plan-time, but both branches are the SAME colour —
            # then the branch does not matter and the value is still static.
            y = eval_colour_full(t[1], sc, local, depth + 1)
            n = eval_colour_full(t[2], sc, local, depth + 1)
            return y if (y and n and y == n) else None
        return None
    return eval_num_full(last, sc, local, depth + 1)


# ── candidate (i) ───────────────────────────────────────────────────────────
def fold_i(expr, sc, allow_ternary_body=False, depth=0):
    """Candidate (i): substitute a SINGLE-colour-expression body. Returns bool."""
    e = unwrap(expr)
    if depth > 8 or not e:
        return False
    if NAME_RE.match(e):
        b = sc.bound(e)
        return fold_i(b, sc, allow_ternary_body, depth + 1) if b else False
    t = as_ternary(e)
    if t:
        return (_leaf_i(t[1], sc, allow_ternary_body, depth)
                and _leaf_i(t[2], sc, allow_ternary_body, depth))
    return _leaf_i(e, sc, allow_ternary_body, depth)


def _leaf_i(expr, sc, allow_ternary_body, depth):
    e = unwrap(expr)
    if static_colour_today(e, sc):
        return True
    if NAME_RE.match(e):
        b = sc.bound(e)
        return _leaf_i(b, sc, allow_ternary_body, depth + 1) if b else False
    c = as_call(e)
    if not c or c[0] not in sc.funcs:
        return False
    fname, argtext = c
    args = [v for n, v in parse_args(argtext)]
    if not all(plan_time_strict(a, sc) for a in args):
        return False
    shape = body_shape(sc.funcs[fname], sc)
    if shape == 'single colour expression':
        sts = body_statements(sc.funcs[fname])
        return _body_colour_i(sts[0], sc, sc.funcs[fname]['params'], args)
    if shape == 'single ternary of colour expressions' and allow_ternary_body:
        sts = body_statements(sc.funcs[fname])
        t = as_ternary(sts[0])
        return (_body_colour_i(t[1], sc, sc.funcs[fname]['params'], args)
                and _body_colour_i(t[2], sc, sc.funcs[fname]['params'], args))
    return False


def _body_colour_i(expr, sc, params, argvals):
    """The body is a colour whose base is static and whose alpha is plan-time
    ARITHMETIC over the (plan-time) arguments. No nested calls anywhere."""
    e = unwrap(expr)
    env = {}
    for p, a in zip(params, argvals):
        u = unwrap(a)
        if NUM_RE.match(u):
            env[p] = float(u)
        else:
            try:
                env[p] = eval_arith(u, sc, {})
            except NotPlanTime:
                env[p] = None
    c = as_call(e)
    if not c:
        return bool(static_colour_today(e, sc))
    fn, argtext = c
    pos = [v for n, v in parse_args(argtext) if n is None]
    if fn == 'color.rgb':
        try:
            ch = [eval_arith(v, sc, env) for v in pos[:3]]
        except NotPlanTime:
            return False
        return len(ch) == 3
    if fn != 'color.new':
        return bool(static_colour_today(e, sc))
    if not pos:
        return False
    # base: a static colour, FOLLOWING names (the charitable reading of (i) —
    # today's shipped `color.new` branch does not do even this).
    base = eval_colour_full(pos[0], sc, {}, 0)
    if not base:
        return False
    if len(pos) < 2:
        return True
    try:
        eval_arith(pos[1], sc, {k: v for k, v in env.items() if v is not None})
    except NotPlanTime:
        return False
    return True


# ── candidate (i-C): the NARROWEST fold that could carry Clouds ─────────────
def fold_iC(expr, sc, depth=0):
    """(i) — single-colour-expression body, plan-time call-site arguments — with
    ONE relaxation: the alpha may be a plan-time NUMERIC user-function call
    (multi-statement body, local bindings, builtin math, `color.t` of a static
    colour). Everything else about (i) is unchanged, and it is still scoped to
    colour positions."""
    e = unwrap(expr)
    if depth > 8 or not e:
        return False
    t = as_ternary(e)
    if t:
        # ⛔ EXACTLY TWO BRANCHES, AND NEITHER MAY BE ANOTHER TERNARY. The plot
        # schema holds `colorUp`/`colorDown` and nothing more, and
        # `colourConditional` declines an n-way chain ON PURPOSE (it reports the
        # arity instead). Recursing here would credit a fold with carrying a
        # shape the schema cannot hold — measured: it over-counted the ternary
        # row by 129 uses before this clause was written.
        return _leaf_iC(t[1], sc, depth + 1) and _leaf_iC(t[2], sc, depth + 1)
    return _leaf_iC(e, sc, depth)


def _leaf_iC(expr, sc, depth=0):
    e = unwrap(expr)
    if depth > 8 or not e:
        return False
    if as_ternary(e):
        return False
    if NAME_RE.match(e):
        b = sc.bound(e)
        return _leaf_iC(b, sc, depth + 1) if b else bool(static_colour_today(e, sc))
    if static_colour_today(e, sc):
        return True
    c = as_call(e)
    if not c or c[0] not in sc.funcs:
        return False
    fname, argtext = c
    args = [v for n, v in parse_args(argtext) if v]
    if not all(plan_time_strict(a, sc) for a in args):
        return False
    if body_shape(sc.funcs[fname], sc) != 'single colour expression':
        return False
    return bool(eval_colour_full(e, sc, {}, 0))


# ── candidate (ii), and the no-user-function baseline inside it ─────────────
def fold_ii(expr, sc, depth=0):
    e = unwrap(expr)
    if depth > 8 or not e:
        return False
    t = as_ternary(e)
    if t:
        return _leaf_ii(t[1], sc, depth + 1) and _leaf_ii(t[2], sc, depth + 1)
    return _leaf_ii(e, sc, depth)


def _leaf_ii(expr, sc, depth=0):
    e = unwrap(expr)
    if depth > 8 or not e:
        return False
    if as_ternary(e):
        return False            # see `fold_iC` — the schema holds two colours
    if NAME_RE.match(e):
        b = sc.bound(e)
        if b:
            return _leaf_ii(b, sc, depth + 1)
    return bool(eval_colour_full(e, sc, {}, 0))


def fold_base(expr, sc):
    """(ii)'s machinery with user functions switched OFF — i.e. recursing
    `color.new`'s base through a name and allowing a plan-time arithmetic alpha,
    and nothing else. The DIFFERENCE between this and (ii) is the part of the
    blast radius that user-function folding is actually responsible for."""
    ALLOW_UFN[0] = False
    try:
        return fold_ii(expr, sc)
    finally:
        ALLOW_UFN[0] = True


# ── colour positions ────────────────────────────────────────────────────────
# ⛔⛔ THE POSITIONAL COLOUR ARGUMENT IS NOT OPTIONAL TO READ.
# ⚰️ MEASURED: the first version of this file read only a NAMED `color =` and
# disagreed with the control by exactly 7 scripts — every one of them written
# `plot(series, "title", color.new(base, 30), linewidth = 2)`, Pine's THIRD
# positional argument. The control was right and this matcher was wrong, which
# is the likelier and more important of the two failure directions the brief
# names. The index beside each call is Pine's own signature position.
POSITIONS = [
    ('plot colour', [('plot', ['color'], 2)]),
    ('fill colour', [('fill', ['color'], 2)]),
    ('bgcolor', [('bgcolor', ['color'], 0)]),
    ('barcolor', [('barcolor', ['color'], 0)]),
    ('plotshape/plotchar colour', [('plotshape', ['color', 'textcolor'], 4),
                                   ('plotchar', ['color', 'textcolor'], 4)]),
    ('line/label colour', [('line.new', ['color'], 6),
                           ('label.new', ['color', 'textcolor'], 5),
                           ('line.set_color', [], -1),
                           ('label.set_color', [], -1),
                           ('label.set_textcolor', [], -1)]),
]
OTHER_CALLS = [('plotcandle', ['color', 'wickcolor', 'bordercolor'], None),
               ('hline', ['color'], 2),
               ('box.new', ['border_color', 'bgcolor'], None),
               ('table.cell', ['text_color', 'bgcolor'], None)]


COLOUR_ARG_RE = re.compile(r'(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*colou?r[A-Za-z0-9_]*)\s*=(?!=)')


def colour_arg_spans(src):
    """Every expression that sits in an argument whose NAME says colour.

    ⛔ This is DELIBERATELY WIDER than the six positions the table reports.
    The question "is this helper also called from a NON-colour position?" is
    answered wrongly by the narrow list: `box.set_bgcolor(f(x))` is a colour
    slot the six-position taxonomy does not name, and counting it as a
    non-colour call would put candidate (i)'s scoping in question for a function
    that only ever produces colours.
    """
    out = []
    for m in COLOUR_ARG_RE.finditer(src):
        i = m.end()
        depth, j = 0, i
        while j < len(src):
            ch = src[j]
            if ch in '([':
                depth += 1
            elif ch in ')]':
                if depth == 0:
                    break
                depth -= 1
            elif ch == ',' and depth == 0:
                break
            elif ch == '\n' and depth == 0:
                break
            j += 1
        out.append((i, j))
    return out


def colour_spans(sc, positions):
    """Character ranges of `sc.src` that ARE a colour expression: every
    colour-named argument, every one of the six positions, and — because a
    position is often just a name — the right-hand side of any binding a
    position resolves through."""
    spans = list(colour_arg_spans(sc.src))
    for _, _, e in positions:
        off = sc.src.find(e)
        if off >= 0:
            spans.append((off, off + len(e)))
        seen, cur, d = set(), unwrap(e), 0
        while NAME_RE.match(cur) and cur not in seen and d < 8:
            seen.add(cur)
            b = sc.bound(cur)
            if b is None:
                break
            m = re.search(r'(?m)^[ \t]*(?:var[ \t]+|varip[ \t]+)?'
                          + re.escape(cur) + r'[ \t]*=(?!=)', sc.src)
            if m:
                nl = sc.src.find('\n', m.end())
                spans.append((m.end(), nl if nl > 0 else len(sc.src)))
            cur, d = unwrap(b), d + 1
    return spans


def in_spans(pos, spans):
    return any(a <= pos < b for a, b in spans)


# ⛔⛔ WHAT EACH POSITION CAN CARRY IS A PROPERTY OF THE SHIPPED CARRIER, NOT OF
# THE COLOUR READER — and for the position under decision the two disagree.
#
#   'flat+cond' the output loop passes `{env, resolver, kind}` (pine.js:11586),
#               so `colourConditional` can emit colorUp/colorDown.
#   'flat'      `fill` calls `outputPresentation(fargs, {env})` with NO resolver
#               (pine.js:11287), and `resolveFillHandles` holds ONE `color`
#               field. A conditional fill colour therefore arrives with no
#               colour BY DESIGN — asserted by the shipped rail
#               `fillColourCarriage.test.js` ("a DYNAMIC fill colour arrives
#               with NO colour, never a guessed one").
#   'none'      `bgcolor`/`barcolor` are in `CHART_ONLY_CALLS` (pine.js:1785)
#               and are not special-cased ahead of it, so they emit a note and
#               no output at all. Nothing about their colour is carried.
#
# ⚠️ `other` is heterogeneous — `hline` gets NO ctx (pine.js:11263) so it is
# flat-only and does not even follow a name, while `box`/`table` sit on the
# object lane, whose `colorNodeOf` does carry a conditional. It is scored
# 'flat+cond', which OVERSTATES hline. Stated rather than silently mixed.
CARRIER = {
    'plot colour': 'flat+cond',
    'fill colour': 'flat',
    'bgcolor': 'none',
    'barcolor': 'none',
    'plotshape/plotchar colour': 'flat+cond',
    'line/label colour': 'flat+cond',
    'other (not in the six)': 'flat+cond',
}


def resolve_ternary(expr, sc, depth=0):
    e = unwrap(expr)
    if depth > 8 or not e:
        return None
    if NAME_RE.match(e):
        b = sc.bound(e)
        return resolve_ternary(b, sc, depth + 1) if b else None
    return as_ternary(e)


def find_calls(src, word):
    pat = re.compile(r'(?<![A-Za-z0-9_.])' + re.escape(word) + r'\s*\(')
    for m in pat.finditer(src):
        yield m.start(), call_args(src, m.start())


def colour_positions(sc):
    """[(position_label, call_word, expr_text)] for one script."""
    out = []
    for label, specs in POSITIONS + [('other (not in the six)', OTHER_CALLS)]:
        for word, named, posidx in specs:
            for start, argtext in find_calls(sc.src, word):
                args = parse_args(argtext)
                pos = [v for n, v in args if n is None]
                got = False
                for nm in named:
                    for n, v in args:
                        if n == nm and v:
                            out.append((label, word, v))
                            got = True
                if posidx is not None and not got:
                    if posidx == -1:
                        if len(pos) >= 2 and pos[-1]:
                            out.append((label, word, pos[-1]))
                    elif len(pos) > posidx and pos[posidx] \
                            and not any(n for n, _ in args[:posidx + 1]):
                        out.append((label, word, pos[posidx]))
    return out


# ── the control: replicate tools/pine_colour_census.py's own predicate ──────
CONTROL_HELPERS = ('color.new', 'color.t', 'color.rgb', 'color.from_gradient')
CONTROL_PLOT = re.compile(r'\bplot\s*\(')


def control_plot_set(files):
    hit = []
    for path, src in files:
        for m in CONTROL_PLOT.finditer(src):
            if any(h in call_args(src, m.start()) for h in CONTROL_HELPERS):
                hit.append(os.path.basename(path))
                break
    return set(hit)


def main():
    w = sys.stdout.write
    files = []
    for d in DIRS:
        if not os.path.isdir(d):
            continue
        for nm in sorted(os.listdir(d)):
            if nm.endswith('.pine') or nm.endswith('.txt'):
                p = os.path.join(d, nm)
                files.append((p, strip_pine(io.open(p, encoding='utf-8', errors='replace').read())))

    scripts = [Script(p, s) for p, s in files]
    by_name = {s.name: s for s in scripts}

    # ── non-vacuity control on the POSITION READER itself ───────────────────
    # An empty result satisfies every check below it, so the reader is proved to
    # SEE two known positions — one named, one positional — before anything is
    # counted.
    probe = Script('<probe>', strip_pine('\n'.join([
        'f(k) => color.new(base, k)',
        'plot(close, "t", color.new(color.red, 30), linewidth = 2)',
        'fill(a, b, color = up ? f(0) : color.blue)',
        '// fill(a, b, color = f(9)) in a comment',
    ])))
    pp = probe.colour_positions_for_control = colour_positions(probe)
    assert sum(1 for l, _, _ in pp if l == 'plot colour') == 1, 'reader control: positional plot colour'
    assert sum(1 for l, _, _ in pp if l == 'fill colour') == 1, 'reader control: named fill colour'
    assert [f for f, _ in user_fn_calls_in([e for l, _, e in pp if l == 'fill colour'][0], probe)] == ['f'], \
        'reader control: user-fn call inside a ternary branch'

    # ── control ─────────────────────────────────────────────────────────────
    control = control_plot_set(files)
    mine_literal = set()          # same predicate, computed by MY position reader
    for sc in scripts:
        for label, word, expr in colour_positions(sc):
            if label == 'plot colour' and any(h in expr for h in CONTROL_HELPERS):
                mine_literal.add(sc.name)
    mine_semantic = set()         # same question, but names FOLLOWED
    for sc in scripts:
        for label, word, expr in colour_positions(sc):
            if label != 'plot colour':
                continue
            e, d = unwrap(expr), 0
            while NAME_RE.match(e) and sc.bound(e) and d < 8:
                e, d = unwrap(sc.bound(e)), d + 1
            if any(h in e for h in CONTROL_HELPERS) or any(h in expr for h in CONTROL_HELPERS):
                mine_semantic.add(sc.name)
    teal_only = set()
    for nm in control:
        sc = by_name[nm]
        real = False
        for m in CONTROL_PLOT.finditer(sc.src):
            a = call_args(sc.src, m.start())
            if any(h in a for h in ('color.new', 'color.rgb', 'color.from_gradient')) \
               or re.search(r'color\.t\s*\(', a):
                real = True
        if not real:
            teal_only.add(nm)

    w('=' * 78 + '\n')
    w('CONTROL - agreement with tools/pine_colour_census.py (recorded: 56)\n')
    w('=' * 78 + '\n')
    w('  control predicate re-derived here      : %d scripts\n' % len(control))
    w('  my plot-position reader, same predicate: %d scripts\n' % len(mine_literal))
    w('  AGREEMENT (control == 56)              : %s\n'
      % ('PASS' if len(control) == 56 else 'FAIL'))
    w('  AGREEMENT (mine == control, same set)  : %s\n'
      % ('PASS' if mine_literal == control else 'FAIL — %d only in mine, %d only in control'
         % (len(mine_literal - control), len(control - mine_literal))))
    if mine_literal != control:
        for nm in sorted(mine_literal - control):
            w('      only in mine   : %s\n' % nm)
        for nm in sorted(control - mine_literal):
            w('      only in control: %s\n' % nm)
    w('  names FOLLOWED (a helper behind a name): %d scripts (superset, +%d)\n'
      % (len(mine_semantic), len(mine_semantic - control)))
    w('  of the control set, scripts whose ONLY match is the substring\n')
    w('  `color.t` inside `color.teal` (i.e. no real helper)  : %d %s\n'
      % (len(teal_only), sorted(teal_only) if teal_only else ''))

    # ── per-position census ─────────────────────────────────────────────────
    shape_uses = Counter()
    shape_files = defaultdict(set)
    shape_today = Counter()
    shape_i = Counter()
    shape_itern = Counter()
    shape_iC = Counter()
    shape_base = Counter()
    shape_ii = Counter()
    pos_uses = Counter()
    pos_files = defaultdict(set)
    pos_rows = defaultdict(lambda: Counter())
    changes_i, changes_itern, changes_ii = set(), set(), set()
    changes_iC, changes_base = set(), set()
    fn_rows = []
    both_positions = []
    clouds_detail = []

    for sc in scripts:
        positions = colour_positions(sc)
        colour_call_sites = defaultdict(int)
        for label, word, expr in positions:
            sh = shape_of(expr, sc)
            shape_uses[sh] += 1
            shape_files[sh].add(sc.name)
            pos_uses[label] += 1
            pos_files[label].add(sc.name)
            carrier = CARRIER[label]

            def gate(flat_ans, full_ans, _c=carrier):
                if _c == 'none':
                    return False
                return flat_ans if _c == 'flat' else full_ans

            ct = gate(bool(static_colour_today(expr, sc)), carried_today(expr, sc))
            fi = gate(_leaf_i(expr, sc, False, 0), fold_i(expr, sc, False))
            fit = gate(_leaf_i(expr, sc, True, 0), fold_i(expr, sc, True))
            fic = gate(_leaf_iC(expr, sc), fold_iC(expr, sc))
            ALLOW_UFN[0] = False
            try:
                fb = gate(_leaf_ii(expr, sc), fold_ii(expr, sc))
            finally:
                ALLOW_UFN[0] = True
            fii = gate(_leaf_ii(expr, sc), fold_ii(expr, sc))
            shape_today[sh] += 1 if ct else 0
            shape_i[sh] += 1 if (ct or fi) else 0
            shape_itern[sh] += 1 if (ct or fit) else 0
            shape_iC[sh] += 1 if (ct or fic) else 0
            shape_base[sh] += 1 if (ct or fb) else 0
            shape_ii[sh] += 1 if (ct or fii) else 0
            pos_rows[label]['uses'] += 1
            pos_rows[label]['today'] += 1 if ct else 0
            pos_rows[label]['i'] += 1 if (ct or fi) else 0
            pos_rows[label]['iC'] += 1 if (ct or fic) else 0
            pos_rows[label]['ii'] += 1 if (ct or fii) else 0
            if fi and not ct:
                changes_i.add(sc.name)
            if fit and not ct:
                changes_itern.add(sc.name)
            if fic and not ct:
                changes_iC.add(sc.name)
            if fb and not ct:
                changes_base.add(sc.name)
            if fii and not ct:
                changes_ii.add(sc.name)
            for fname, argvals in user_fn_calls_in(expr, sc):
                colour_call_sites[fname] += 1
                fn = sc.funcs[fname]
                sts = body_statements(fn) or []
                alpha = alpha_kind(fn, sc)
                fn_rows.append({
                    'file': sc.name, 'fn': fname, 'position': label,
                    'body': body_shape(fn, sc),
                    'args_plan_time': all(plan_time_strict(a, sc) for a in argvals),
                    'alpha': alpha,
                    'carried_today': ct, 'i': fi, 'i_tern': fit,
                    'iC': fic, 'ii': fii,
                })
                if sc.name == 'uncharted-clouds.pine':
                    clouds_detail.append((word, fname, argvals, fi, fit, fii))
        # a colour helper also called from a NON-colour position
        spans = colour_spans(sc, positions)
        defline = {f: sc.funcs[f]['line'] for f in sc.funcs}
        for fname in colour_call_sites:
            n_col, others = 0, []
            for off, _ in find_calls(sc.src, fname):
                ln = sc.src.count('\n', 0, off) + 1
                if ln == defline.get(fname):
                    continue                     # the definition, not a call
                if in_spans(off, spans):
                    n_col += 1
                else:
                    others.append((ln, sc.src.split('\n')[ln - 1].strip()[:92]))
            if others:
                both_positions.append((sc.name, fname, n_col, tuple(others[:2])))

    w('\n' + '=' * 78 + '\n')
    w('COLOUR POSITIONS - uses / files\n')
    w('=' * 78 + '\n')
    w('%-28s %7s %6s %9s %7s %7s %7s %7s\n'
      % ('position', 'uses', 'files', 'carrier', 'today', '(i)', '(i-C)', '(ii)'))
    for label, _ in POSITIONS + [('other (not in the six)', None)]:
        r = pos_rows[label]
        w('%-28s %7d %6d %9s %7d %7d %7d %7d\n'
          % (label, pos_uses[label], len(pos_files[label]), CARRIER[label],
             r['today'], r['i'], r['iC'], r['ii']))
    w('\n  carrier: what the SHIPPED code can hold at that position -\n')
    w('    flat+cond  a flat colour OR colorUp/colorDown (resolver passed)\n')
    w('    flat       a flat colour ONLY - `fill` gets no resolver and\n')
    w('               `resolveFillHandles` has one `color` field\n')
    w('    none       `bgcolor`/`barcolor` are CHART_ONLY and emit no output\n')
    w('  NOT MEASURED: whether a conditional TEST resolves into a canonical\n')
    w('  tree. Every `flat+cond` number is therefore an UPPER bound.\n')

    w('\n' + '=' * 78 + '\n')
    w('SHAPE TABLE - uses, files, and what each candidate carries\n')
    w('=' * 78 + '\n')
    w('%-26s %6s %6s %7s %6s %8s %6s %6s %6s\n'
      % ('shape', 'uses', 'files', 'today', '(i)', '(i-tern)', '(i-C)', '(base)', '(ii)'))
    for sh in SHAPES:
        w('%-26s %6d %6d %7d %6d %8d %6d %6d %6d\n'
          % (sh, shape_uses[sh], len(shape_files[sh]), shape_today[sh],
             shape_i[sh], shape_itern[sh], shape_iC[sh], shape_base[sh], shape_ii[sh]))
    w('%-26s %6d %6d %7d %6d %8d %6d %6d %6d\n'
      % ('TOTAL', sum(shape_uses.values()),
         len(set().union(*shape_files.values()) if shape_files else set()),
         sum(shape_today.values()), sum(shape_i.values()), sum(shape_itern.values()),
         sum(shape_iC.values()), sum(shape_base.values()), sum(shape_ii.values())))
    w('\nblast radius (scripts whose PRESENTATION would change):\n')
    w('  under (i)      : %d\n' % len(changes_i))
    w('  under (i-tern) : %d\n' % len(changes_itern))
    w('  under (i-C)    : %d\n' % len(changes_iC))
    w('  under (base)   : %d   [no user functions at all - `color.new` base\n'
      '                        recursed through a name + plan-time arithmetic alpha]\n'
      % len(changes_base))
    w('  under (ii)     : %d   [colour positions only - a corpus-wide folder\n'
      '                        also changes NUMERIC positions, NOT measured here]\n'
      % len(changes_ii))
    w('  attributable to USER-FUNCTION folding, (ii) minus (base): %d scripts\n'
      % len(changes_ii - changes_base))

    for title, s in (('(i)', changes_i),
                     ('(i-tern) but not (i)', changes_itern - changes_i),
                     ('(i-C)', changes_iC),
                     ('(base), no user functions', changes_base),
                     ('(ii) but not (base)', changes_ii - changes_base)):
        w('\nscripts that would CHANGE under %s  [%d]:\n' % (title, len(s)))
        for nm in sorted(s) or ['  (none)']:
            w('  %s\n' % nm)

    w('\n' + '=' * 78 + '\n')
    w('USER FUNCTIONS IN A COLOUR POSITION\n')
    w('=' * 78 + '\n')
    w('  call sites in a colour position : %d\n' % len(fn_rows))
    w('  distinct (file, function)       : %d\n'
      % len({(r['file'], r['fn']) for r in fn_rows}))
    w('  files                           : %d\n' % len({r['file'] for r in fn_rows}))
    w('\n  body shapes:\n')
    for k, v in Counter(r['body'] for r in fn_rows).most_common():
        w('    %-40s %d call sites\n' % (k, v))
    w('\n  every call-site argument plan-time (strict):\n')
    for k, v in Counter(r['args_plan_time'] for r in fn_rows).most_common():
        w('    %-40s %d call sites\n' % (str(k), v))
    w('\n  the body alpha is:\n')
    for k, v in Counter(r['alpha'] for r in fn_rows).most_common():
        w('    %-40s %d call sites\n' % (k, v))
    w('\n  per (file, function):\n')
    seen = set()
    for r in fn_rows:
        key = (r['file'], r['fn'], r['position'])
        if key in seen:
            continue
        seen.add(key)
        w('    %-34s %-22s %-14s body=%-34s plan-time=%-5s alpha=%-26s today=%-5s (i)=%-5s (i-C)=%-5s (ii)=%s\n'
          % (r['file'][:34], r['fn'][:22], r['position'][:14], r['body'][:34],
             r['args_plan_time'], r['alpha'], r['carried_today'], r['i'],
             r['iC'], r['ii']))

    w('\n' + '=' * 78 + '\n')
    w('FUNCTIONS CALLED FROM BOTH A COLOUR AND A NON-COLOUR POSITION\n')
    w('=' * 78 + '\n')
    w('  (a call site counts as COLOUR when it sits inside any colour-named\n'
      '   argument, one of the six positions, or a binding a position resolves\n'
      '   through - the wider test, so a function is only named here when a\n'
      '   genuinely non-colour use was found. The non-colour lines are printed.)\n\n')
    if not both_positions:
        w('  (none)\n')
    for nm, fname, ncol, others in sorted(set(both_positions)):
        w('  %s\n    %s  colour=%d  non-colour=%d\n' % (nm, fname, ncol, len(others)))
        for ln, txt in others:
            w('      :%-5d %s\n' % (ln, txt))
    folded = {(r['file'], r['fn']) for r in fn_rows if r['iC']}
    flagged = {(nm, f) for nm, f, _, _ in both_positions}
    w('\n  => functions a fold would actually SUBSTITUTE under (i)/(i-C) : %s\n'
      % (sorted(folded) if folded else 'none'))
    w('  => of those, called from a non-colour position                : %s\n'
      % (sorted(folded & flagged) if (folded & flagged) else 'NONE'))

    w('\n' + '=' * 78 + '\n')
    w("CLOUDS - every fill's colour, position by position\n")
    w('=' * 78 + '\n')
    sc = by_name.get('uncharted-clouds.pine')
    if sc:
        fills = [(w2, e) for (l, w2, e) in colour_positions(sc) if l == 'fill colour']
        w('  fill colour positions            : %d\n' % len(fills))
        w('  carried today                    : %d\n'
          % sum(1 for _, e in fills if carried_today(e, sc)))
        w('  would carry under (i)            : %d\n'
          % sum(1 for _, e in fills if fold_i(e, sc, False)))
        w('  would carry under (i-tern)       : %d\n'
          % sum(1 for _, e in fills if fold_i(e, sc, True)))
        w('  would carry under (i-C)          : %d\n'
          % sum(1 for _, e in fills if _leaf_iC(e, sc)))
        w('  would carry under (ii)           : %d\n'
          % sum(1 for _, e in fills if _leaf_ii(e, sc)))
        w('\n  ** the fill carrier holds ONE colour, so a CONDITIONAL fill colour\n'
          '     is uncarried whatever the fold does. Measured separately: **\n')
        w('  fills whose colour is a ternary  : %d\n'
          % sum(1 for _, e in fills if resolve_ternary(e, sc)))
        w('  BOTH branches fold under (i)     : %d\n'
          % sum(1 for _, e in fills if fold_i(e, sc, False)))
        w('  BOTH branches fold under (i-C)   : %d\n'
          % sum(1 for _, e in fills if fold_iC(e, sc)))
        w('  BOTH branches fold under (ii)    : %d\n'
          % sum(1 for _, e in fills if fold_ii(e, sc)))
        w('\n  why (i) refuses each fill, clause by clause:\n')
        e0 = fills[0][1] if fills else ''
        t0 = as_ternary(e0)
        for branch in ([t0[1], t0[2]] if t0 else [e0]):
            c = as_call(unwrap(branch))
            if not c or c[0] not in sc.funcs:
                continue
            fname = c[0]
            argv = [v for n, v in parse_args(c[1]) if v]
            fn = sc.funcs[fname]
            sts = body_statements(fn) or []
            alpha_expr = ''
            cc = as_call(unwrap(sts[0])) if sts else None
            if cc and cc[0] == 'color.new':
                p = [v for n, v in parse_args(cc[1]) if n is None]
                alpha_expr = p[1] if len(p) > 1 else ''
                base_expr = p[0] if p else ''
            else:
                base_expr = ''
            inner = as_call(unwrap(alpha_expr))
            w('    %s(%s)\n' % (fname, ', '.join(argv)))
            w('      call-site args plan-time (strict)    : %s\n'
              % all(plan_time_strict(a, sc) for a in argv))
            w('      body is a SINGLE colour expression   : %s\n'
              % (body_shape(fn, sc) == 'single colour expression'))
            w('      base `%s` static TODAY (no recursion): %s\n'
              % (base_expr, bool(static_colour_today('color.new(%s, 0)' % base_expr, sc))))
            w('      base `%s` static with recursion      : %s\n'
              % (base_expr, bool(eval_colour_full(base_expr, sc, {}, 0))))
            w('      alpha `%s`\n' % alpha_expr[:80])
            w('        is a literal                       : %s\n'
              % bool(NUM_RE.match(unwrap(alpha_expr))))
            try:
                eval_arith(alpha_expr, sc, {p: 0.0 for p in fn['params']})
                arith = True
            except NotPlanTime:
                arith = False
            w('        is arithmetic on a plan-time arg    : %s\n' % arith)
            w('        is a NESTED USER-FUNCTION call      : %s   -> %s\n'
              % (bool(inner and inner[0] in sc.funcs),
                 inner[0] if inner else '-'))
        for fname in ('getBullFillColor', 'getBearFillColor', 'getAdjustedTransparency'):
            if fname in sc.funcs:
                fn = sc.funcs[fname]
                sts = body_statements(fn)
                w('\n  %s(%s)\n' % (fname, ', '.join(fn['params'])))
                w('    body shape   : %s (%s statements)\n'
                  % (body_shape(fn, sc), len(sts) if sts is not None else '?'))
                w('    alpha kind   : %s\n' % alpha_kind(fn, sc))
                if sts:
                    for s in sts:
                        w('      | %s\n' % s[:110])
        w('\n  fold (ii) evaluation of the first three fills:\n')
        for k in range(3):
            for f in ('getBullFillColor', 'getBearFillColor'):
                if f in sc.funcs:
                    try:
                        v = call_fn(f, [str(k)], sc, {}, 0, 'colour')
                    except NotPlanTime:
                        v = None
                    w('    %s(%d) -> %s\n' % (f, k, v))
    w('\n')
    carrier_only_section(scripts, w)


def carrier_only_section(scripts, w):
    """ADDITIVE SECTION - added after the census above was published; it changes
    no number in it.

    THE COUNTERFACTUAL, and it is narrow on purpose: hold the FOLD exactly as it
    ships today (`staticColourOf` unchanged - no (i), no (i-C), no base
    recursion) and change ONLY the carrier. That is, suppose `fill` were passed
    `{env, resolver, kind}` the way the output loop is at `pine.js:11586`, and
    `resolveFillHandles` carried `colorUp`/`colorDown`/`colorCondition` beside
    `color`.

    Then the ONLY new thing a fill can hold is `colourConditional`'s two-branch
    result, so a fill gains exactly when:
      - it does NOT already fold flat under today's `staticColourOf`, AND
      - its colour resolves (through a bound name) to a TERNARY whose BOTH
        branches fold flat under today's `staticColourOf`.
    A nested ternary is excluded because `staticColourOf` returns null on one, so
    `colourConditional` declines and reports the arity instead - the schema holds
    two colours. `cond ? colour : na` is excluded for the same reason (the `na`
    branch is not a static colour); it is counted separately as `naGated` below,
    because it is a VISIBILITY gate wearing a colour argument and carrying its
    inner colour would draw a band where the author hid one.
    """
    w('=' * 78 + '\n')
    w('CARRIER-ONLY COUNTERFACTUAL - today\'s fold, a conditional fill carrier\n')
    w('=' * 78 + '\n')
    gains, na_gated, arity_gt2, still_dynamic = [], [], [], []
    total_fill, flat_today = 0, 0
    for sc in scripts:
        for label, word, expr in colour_positions(sc):
            if label != 'fill colour':
                continue
            total_fill += 1
            if static_colour_today(expr, sc):
                flat_today += 1
                continue
            t = resolve_ternary(expr, sc)
            if not t:
                still_dynamic.append((sc.name, expr))
                continue
            up = static_colour_today(t[1], sc)
            dn = static_colour_today(t[2], sc)
            if up and dn:
                a = alpha_of_branch(t[1], sc)
                b = alpha_of_branch(t[2], sc)
                gains.append((sc.name, t[0], up, dn,
                              'agree' if (a is not None and a == b)
                              else ('none' if (a is None and b is None) else 'differ')))
                continue
            isna = (lambda x: unwrap(x) == 'na' or unwrap(x).startswith('na('))
            if isna(t[1]) or isna(t[2]):
                na_gated.append((sc.name, expr))
            else:
                arity_gt2.append((sc.name, expr))
    files = sorted({f for f, _, _, _, _ in gains})
    w('  fill colour positions (unchanged from the table above) : %d\n' % total_fill)
    w('  carrying TODAY (flat static only)                      : %d\n' % flat_today)
    w('  (1) gain a colour under CARRIER-ONLY                    : %d\n' % len(gains))
    w('      delta against the %d carried today                  : +%d\n'
      % (flat_today, len(gains)))
    w('      fill positions carrying after carrier-only          : %d of %d\n'
      % (flat_today + len(gains), total_fill))
    w('  (2) DISTINCT SCRIPTS gaining at least one fill colour   : %d\n' % len(files))
    w('  (3) of those, gaining via a ternary whose BOTH branches\n')
    w('      already fold with today\'s staticColourOf            : %d\n' % len(files))
    w('      -- identical BY CONSTRUCTION: carrier-only adds no folding, so the\n')
    w('         two-branch-already-static ternary is the ONLY mechanism by which\n')
    w('         a fill can gain. (1) and (3) cannot differ; stated, not inferred.\n')
    w('  (4) uncharted-clouds.pine in that list                  : %s\n'
      % ('YES' if 'uncharted-clouds.pine' in files else 'NO'))
    degen = [g for g in gains if g[2] == g[3]]
    strcmp = [g for g in gains
              if re.search(r'(==|!=|>=|<=|>|<)\s*$', g[1]) or re.match(r'^(==|!=)', g[1])]
    w('\n  what the %d gaining fills actually are:\n' % len(gains))
    w('    two DIFFERENT colours (a real two-colour conditional)   : %d\n'
      % (len(gains) - len(degen)))
    w('    colorUp == colorDown (an ALPHA-only conditional)        : %d\n' % len(degen))
    w('      !! the schema holds ONE `opacity`, so for these the hex is carried\n')
    w('         and the per-bar alpha is DROPPED - a visible gain over nothing,\n')
    w('         but not fidelity. Counted, not hidden.\n')
    w('    branch opacities agree (carried)                        : %d\n'
      % len([g for g in gains if g[4] == 'agree']))
    w('    branch opacities differ (dropped)                       : %d\n'
      % len([g for g in gains if g[4] == 'differ']))
    w('    neither branch names a colour helper (no opacity)       : %d\n'
      % len([g for g in gains if g[4] == 'none']))
    w('    test compares against a STRING literal                  : %d\n' % len(strcmp))

    w('\n  still uncarried after carrier-only:\n')
    w('    ternary, a branch is `na` (a VISIBILITY gate, correctly declined) : %d\n'
      % len(na_gated))
    w('    ternary, more than two distinct colours / nested ternary         : %d\n'
      % len(arity_gt2))
    w('    not a ternary at all (a call, arithmetic, an unfoldable name)    : %d\n'
      % len(still_dynamic))

    w('\n  (2) NAMED - every script gaining at least one fill colour:\n')
    per = defaultdict(list)
    for f, test, up, dn, op in gains:
        per[f].append((test, up, dn, op))
    w('    (a test shown with a missing operand had a STRING LITERAL there -\n')
    w('     `strip_pine` blanks those. A bare name is shown with its binding.)\n')
    by_name = {s.name: s for s in scripts}
    for f in files:
        sc = by_name[f]
        w('    %s  [%d fill(s)]\n' % (f, len(per[f])))
        for test, up, dn, op in per[f]:
            note = ''
            if re.search(r'(==|!=|>=|<=|>|<)\s*$', test) or re.match(r'^(==|!=)', test):
                note = '   [!! operand is a STRING LITERAL - the likeliest resolver refusal]'
            if NAME_RE.match(test.strip()) and sc.bound(test.strip()):
                note = '   <= %s' % sc.bound(test.strip())[:70]
            w('        %s -> %s / %s   opacity: %s%s\n'
              % (test[:64], up, dn, op, note))
    if not files:
        w('    (none)\n')

    w('\n  (5) the `flat+cond` caveat, for THIS set:\n')
    w('      NOT MEASURED, and it cannot be measured by this tool. Whether\n')
    w('      `ctx.resolver.resolve(cond.test)` succeeds is a property of the JS\n')
    w('      translator; answering it means running `translatePine`, which is a\n')
    w('      Node process and outside this instrument\'s Python-only remit.\n')
    w('      UPPER bound %d scripts / %d fills (every test resolves).\n'
      % (len(files), len(gains)))
    w('      LOWER bound 0 scripts / 0 fills (no test resolves) - a real bound,\n')
    w('      not a rhetorical one: `outputPresentation` catches the throw and\n')
    w('      falls through to `colorDynamic`, so a resolver failure is silent.\n')
    w('      The TEST EXPRESSION of every gaining fill is printed above so the\n')
    w('      bound can be closed without re-deriving the set. One command closes\n')
    w('      it - translate each named script and count fills with `colorUp`.\n')


def alpha_of_branch(expr, sc, depth=0):
    """`colourHelperAlpha` for one branch, following a bound name the way
    `staticColourOf` does. Returns None when the branch names no helper."""
    e = unwrap(expr)
    if depth > 8 or not e:
        return None
    if NAME_RE.match(e):
        b = sc.bound(e)
        return alpha_of_branch(b, sc, depth + 1) if b else None
    c = as_call(e)
    if not c or c[0] not in ('color.new', 'color.rgb'):
        return None
    pos = [v for n, v in parse_args(c[1]) if n is None]
    idx = 1 if c[0] == 'color.new' else 3
    if len(pos) <= idx or not NUM_RE.match(unwrap(pos[idx])):
        return None
    return max(0.0, min(1.0, 1 - float(unwrap(pos[idx])) / 100.0))


def alpha_kind(fn, sc):
    """What the body's alpha argument IS: literal / argument / arithmetic /
    a nested user-function call / a builtin call / none."""
    sts = body_statements(fn)
    if not sts:
        return 'n/a (nested body)'
    expr = sts[-1]
    t = as_ternary(expr)
    cands = [t[1], t[2]] if t else [expr]
    kinds = []
    for e in cands:
        c = as_call(unwrap(e))
        if not c or c[0] not in ('color.new', 'color.rgb'):
            kinds.append('none (not a helper)')
            continue
        pos = [v for n, v in parse_args(c[1]) if n is None]
        idx = 1 if c[0] == 'color.new' else 3
        if len(pos) <= idx:
            kinds.append('absent')
            continue
        a = unwrap(pos[idx])
        if NUM_RE.match(a):
            kinds.append('literal')
        elif NAME_RE.match(a) and a in fn['params']:
            kinds.append('an argument')
        elif as_call(a):
            fname2 = as_call(a)[0]
            kinds.append('user-fn call' if fname2 in sc.funcs else 'builtin call')
        elif any(p in re.findall(IDENT, a) for p in fn['params']):
            kinds.append('arithmetic on an argument')
        else:
            kinds.append('other expression')
    return ' / '.join(sorted(set(kinds)))


if __name__ == '__main__':
    main()
