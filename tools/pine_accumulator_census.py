# -*- coding: utf-8 -*-
"""a4b.1 — classify the 379 counted-`for` ACCUMULATOR bodies.

`tools/pine_iteration_census.py` established that 379 of 1,004 counted-`for` bodies
accumulate — more than every other admitted shape combined, and a3's unroll serves none
of them. Ruling R3 opened a4b, "the accumulator fold", on that number, and made it
census-first: before any build estimate, classify those 379 by what would actually have
to be foldable.

`s = 0.0 / for i = 0 to 2 / s := s + close[i]` is plan-time expressible BY CONSTRUCTION
as `((0 + close[0]) + close[1]) + close[2]` — Mechanism A applied to a scalar instead of
a vector. What decides whether a given accumulator is that, or something else wearing
the same syntax, is five things, and this tool counts all five:

  SEED      the initial value: literal / plan-time expression / series / absent
  SHAPE     `s := s op e` (a left-nested fold) vs `s := f(s, e)` (general) vs other
  OPERAND   is `e` plan-time, or does it read a series / the loop index
  BOUND     literal (iterations known) / name / expression — and iterations x nesting
            against MAX_UNROLLED_NODES = 30000
  ESCAPE    is `s` read anywhere the loop does not own, which would make the fold's
            value bar-dependent rather than plan-time

⛔ Comments and string literals are stripped before matching, and the stripper carries
its own control — this repo has six recorded instances of a literal-hunting check
matching its own prose. The 379 is reproduced exactly as the second control: an
instrument that cannot re-derive the number it refines is measuring something else.

Usage:  python tools/pine_accumulator_census.py [--list BUCKET]
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = [
    os.path.join(ROOT, 'corpus', 'committed'),
    os.path.join(ROOT, 'tests', 'fixtures', 'pine_oos'),
    os.path.join(ROOT, 'tests', 'fixtures', 'member'),
]

MAX_UNROLLED_NODES = 30000          # arrayVectors.js:73 — not retyped elsewhere

FORM_PAIRED = re.compile(r'^\s*for\s*\[\s*\w+\s*,\s*\w+\s*\]\s+in\s+')
FORM_SINGLE = re.compile(r'^\s*for\s+\w+\s+in\s+')
FORM_COUNTED = re.compile(r'^\s*for\s+(\w+)\s*=\s*(.+?)\s+to\s+(.+?)\s*$')
FORM_WHILE = re.compile(r'^\s*while\s+')

WRITE_CALL = re.compile(r'\b(?:array|matrix|map)\.(set|push|unshift|insert|pop|shift|remove|clear)\s*\(')
SCALAR_ASSIGN = re.compile(r'^\s*(\w+)\s*(:=|\+=|-=|\*=|/=|%=)\s*(.*)$')
DRAW_CALL = re.compile(r'\b(plot|plotshape|plotchar|label\.new|line\.new|box\.new|table\.|fill|bgcolor)\s*\(')

SERIES = re.compile(r'\b(close|open|high|low|volume|hl2|hlc3|ohlc4|hlcc4|time|bar_index|'
                    r'ta\.|request\.|syminfo\.|timenow|barstate\.)')
NUMBER = re.compile(r'^-?\d+(\.\d+)?$')


def strip_pine(src):
    """Remove `//` comments and string literals, preserving line structure."""
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
    return out


def indent_of(s):
    return len(s) - len(s.lstrip())


def body_of(lines, at):
    base = indent_of(lines[at])
    body = []
    for k in range(at + 1, len(lines)):
        if not lines[k].strip():
            continue
        if indent_of(lines[k]) <= base:
            break
        body.append(lines[k])
    return body


def classify_body(body):
    """Identical order to pine_iteration_census.classify — the two must agree."""
    text = '\n'.join(body)
    if not body:
        return 'empty'
    if DRAW_CALL.search(text):
        return 'draws'
    if WRITE_CALL.search(text):
        return 'writes-slot'
    if any(SCALAR_ASSIGN.match(b) for b in body):
        return 'accumulates'
    return 'other'


def seed_of(lines, at, name):
    """The binding of `name` before the loop: its kind, searching upward."""
    pat = re.compile(r'^\s*(?:var\s+|varip\s+)?(?:float\s+|int\s+|bool\s+)?'
                     + re.escape(name) + r'\s*=\s*(.+?)\s*$')
    for k in range(at - 1, -1, -1):
        m = pat.match(lines[k])
        if not m:
            continue
        rhs = m.group(1).strip()
        if NUMBER.match(rhs) or rhs in ('na', 'true', 'false'):
            return 'literal'
        if SERIES.search(rhs):
            return 'series'
        return 'plan-time expr'
    return 'absent'


def shape_of(rhs, name):
    """`s := s op e` is the foldable shape; `s := f(s, e)` is general."""
    body = rhs.strip()
    m = re.match(r'^' + re.escape(name) + r'\s*([+\-*/%])\s*(.+)$', body)
    if m:
        return 's := s op e', m.group(1), m.group(2)
    m = re.match(r'^(math\.\w+|\w+)\s*\(\s*' + re.escape(name) + r'\s*,\s*(.+?)\s*\)$', body)
    if m:
        return 's := f(s, e)', m.group(1), m.group(2)
    if re.search(r'\b' + re.escape(name) + r'\b', body):
        return 's mentioned, other shape', '?', body
    return 'no self-reference', '?', body


def operand_kind(expr, loop_var):
    if re.search(r'\[\s*' + re.escape(loop_var) + r'\s*\]', expr):
        return 'index-substituted'
    if SERIES.search(expr):
        return 'series'
    if NUMBER.match(expr.strip()):
        return 'literal'
    return 'other'


def const_env(lines, at):
    """Top-level `name = <number>` bindings visible before line `at`.

    ⚰️ WITHOUT THIS THE CENSUS REPORTS ITS OWN BLIND SPOT AS A CORPUS FACT. a3 folds a
    bound through the engine's own folder, so `for i = 0 to numLayers - 1` with
    `numLayers = 21` is a 21-iteration loop — Uncharted Clouds' own loop, the fixture
    this whole item was built on. A `bound_kind` that accepts only a bare numeral calls
    that "expression" and would have reported Clouds itself as undecidable.
    """
    env = {}
    for k in range(0, at):
        m = re.match(r'^(?:var\s+|varip\s+)?(?:float\s+|int\s+)?(\w+)\s*=\s*(-?\d+(?:\.\d+)?)\s*$',
                     lines[k])
        if m:
            env[m.group(1)] = float(m.group(2))
    return env


def fold_bound(expr, env):
    """A number, a known constant, or simple arithmetic over them — else None."""
    e = expr.strip()
    if NUMBER.match(e):
        return float(e)
    if e in env:
        return env[e]
    m = re.match(r'^([\w.]+)\s*([+\-*/])\s*([\w.]+)$', e)
    if m:
        a, op, b = m.group(1), m.group(2), m.group(3)
        av = float(a) if NUMBER.match(a) else env.get(a)
        bv = float(b) if NUMBER.match(b) else env.get(b)
        if av is None or bv is None:
            return None
        try:
            return {'+': av + bv, '-': av - bv, '*': av * bv,
                    '/': (av / bv if bv else None)}[op]
        except ZeroDivisionError:
            return None
    return None


def bound_kind(lo, hi, env):
    lov, hiv = fold_bound(lo, env), fold_bound(hi, env)
    if lov is not None and hiv is not None:
        kind = 'literal' if (NUMBER.match(lo.strip()) and NUMBER.match(hi.strip())) \
            else 'literal-derived'
        return kind, int(abs(hiv - lov)) + 1
    return ('name' if re.match(r'^\w+$', hi.strip()) else 'expression'), None


# ── control 1: the stripper ─────────────────────────────────────────────────
PROBE = ['// s := s + 1', 'y = "s := s + 1"', 'for i = 0 to 2', '    s := s + 1']
_p = strip_pine('\n'.join(PROBE))
assert len([ln for ln in _p if SCALAR_ASSIGN.match(ln)]) == 1, 'stripper control'

files = []
for d in DIRS:
    if not os.path.isdir(d):
        continue
    for nm in sorted(os.listdir(d)):
        if nm.endswith('.pine') or nm.endswith('.txt'):
            files.append(os.path.join(d, nm))

counted_total = 0
accum = []
for path in files:
    lines = strip_pine(io.open(path, encoding='utf-8', errors='replace').read())
    base = os.path.basename(path)
    for i, line in enumerate(lines):
        if FORM_PAIRED.match(line) or FORM_SINGLE.match(line) or FORM_WHILE.match(line):
            continue
        m = FORM_COUNTED.match(line)
        if not m:
            continue
        counted_total += 1
        body = body_of(lines, i)
        if classify_body(body) != 'accumulates':
            continue
        loop_var, lo, hi = m.group(1), m.group(2), m.group(3)
        hi = re.sub(r'\s+by\s+.*$', '', hi)
        # ⚰️ ALL the assignments, not the first. Taking `next(...)` classified a body
        # whose first `:=` is a helper (`tmp := …`) and whose SECOND is the real
        # accumulator as "no self-reference" — and that bucket was 40% of the corpus,
        # i.e. the instrument's largest finding was its own shortcut. The real
        # accumulator is the self-referencing update if the body has one.
        updates = [b for b in body if SCALAR_ASSIGN.match(b)]
        chosen = None
        for cand in updates:
            a = SCALAR_ASSIGN.match(cand)
            nm, o, rh = a.group(1), a.group(2), a.group(3)
            sh = ('s := s op e', o[0], rh) if o != ':=' else shape_of(rh, nm)
            if sh[0] in ('s := s op e', 's := f(s, e)'):
                chosen = (nm, o, rh, sh)
                break
            if chosen is None:
                chosen = (nm, o, rh, sh)
        name, op, rhs, (shape, oper, e) = chosen
        bk, iters = bound_kind(lo, hi, const_env(lines, i))
        depth = 1 + sum(1 for b in body
                        if FORM_COUNTED.match(b) or FORM_WHILE.match(b)
                        or FORM_SINGLE.match(b) or FORM_PAIRED.match(b))
        rest = [b for b in body if not (SCALAR_ASSIGN.match(b)
                                        and SCALAR_ASSIGN.match(b).group(1) == name)]
        escapes = any(re.search(r'\b' + re.escape(name) + r'\b', b) for b in rest)
        accum.append({
            'file': base, 'line': i + 1, 'name': name,
            'seed': seed_of(lines, i, name), 'shape': shape, 'op': oper,
            'operand': operand_kind(e, loop_var), 'bound': bk,
            'iters': iters, 'depth': depth, 'escapes': escapes,
        })

w = sys.stdout.buffer.write


def table(title, key, rows):
    counts = {}
    for r in rows:
        counts[r[key]] = counts.get(r[key], 0) + 1
    w(('\n%s\n' % title).encode())
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        w(('  %-24s %4d  %5.1f%%\n' % (k, v, 100.0 * v / max(1, len(rows)))).encode())


w(('files scanned: %d\n' % len(files)).encode())
w(('counted `for` loops: %d\n' % counted_total).encode())
w(('of which ACCUMULATE: %d\n' % len(accum)).encode())

# ── control 2: the number this tool refines must re-derive exactly ─────────
if len(accum) != 379:
    w(('\n*** CONTROL FAILED: expected 379 accumulator bodies, got %d ***\n'
       % len(accum)).encode())
else:
    w(b'control: 379 reproduced exactly\n')

table('SEED — the accumulator\'s initial value', 'seed', accum)
table('SHAPE — the update form', 'shape', accum)
table('OPERAND — what `e` is', 'operand', accum)
table('BOUND — is the iteration count knowable', 'bound', accum)
table('ESCAPE — is `s` read outside its own update', 'escapes', accum)

# ── the admissible set: every axis has to be plan-time at once ─────────────
adm = [r for r in accum
       if r['seed'] in ('literal', 'plan-time expr')
       and r['shape'] == 's := s op e'
       and r['operand'] in ('index-substituted', 'literal', 'series')
       and r['bound'] in ('literal', 'literal-derived')
       and not r['escapes']]
w(('\nADMISSIBLE (seed known · foldable shape · literal bound · no escape): %d of %d\n'
   % (len(adm), len(accum))).encode())

# ⭐ SENSITIVITY — which axis is actually binding. A conjunction of five filters can
# reach a small number for a reason that is not the interesting one, and "admissible: 1"
# is only informative beside what each axis costs on its own.
AXES = {
    'seed known': lambda r: r['seed'] in ('literal', 'plan-time expr'),
    'shape s := s op e': lambda r: r['shape'] == 's := s op e',
    'bound knowable': lambda r: r['bound'] in ('literal', 'literal-derived'),
    'no escape': lambda r: not r['escapes'],
}
w('\nSENSITIVITY — each axis alone, and the set with that axis DROPPED\n'.encode())
for label, keep in AXES.items():
    alone = sum(1 for r in accum if keep(r))
    without = [r for r in accum if all(f(r) for k, f in AXES.items() if k != label)]
    w(('  %-20s alone %4d   drop it -> admissible becomes %4d\n'
       % (label, alone, len(without))).encode())

# ⭐ AND THE TWO WEAKEST AXES DROPPED TOGETHER, because a reader comparing two single
# relaxations will ask it, and the pair is not the sum of the parts.
pair = [r for r in accum
        if all(f(r) for k, f in AXES.items() if k not in ('bound knowable', 'no escape'))]
w(('  %-20s             drop BOTH -> admissible becomes %4d\n'
   % ('bound + escape', len(pair))).encode())

# ⛔ THE CEILING. Anything that must be unrolled needs a settleable iteration count, so
# no relaxation of the other axes can lift the admissible set above the BOUND bucket.
w(('\nCEILING — any set requiring a settleable iteration count is capped at %d of %d\n'
   % (sum(1 for r in accum if r['bound'] in ('literal', 'literal-derived')), len(accum)))
  .encode())

over = [r for r in adm if r['iters'] and r['iters'] * r['depth'] > MAX_UNROLLED_NODES]
w(('  of those, over the %d-node ceiling: %d\n' % (MAX_UNROLLED_NODES, len(over))).encode())
if adm:
    worst = max(adm, key=lambda r: (r['iters'] or 0) * r['depth'])
    w(('  worst admitted cost: %s iterations x depth %d = %s\n'
       % (worst['iters'], worst['depth'], (worst['iters'] or 0) * worst['depth'])).encode())

if len(sys.argv) > 2 and sys.argv[1] == '--list':
    want = sys.argv[2]
    rows = adm if want == 'admissible' else [r for r in accum if want in (r['seed'], r['shape'], r['operand'], r['bound'])]
    w(('\n%s: %d row(s)\n' % (want, len(rows))).encode())
    for r in rows[:60]:
        w(('  %-44s :%-5d %-10s %-18s %-16s %-10s iters=%s d=%d\n'
           % (r['file'][:44], r['line'], r['name'][:10], r['shape'], r['operand'],
              r['seed'], r['iters'], r['depth'])).encode('utf-8', 'replace'))
