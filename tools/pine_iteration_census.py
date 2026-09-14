# -*- coding: utf-8 -*-
"""Which corpus scripts use which ITERATION FORM, and what their bodies DO.

WHY THIS EXISTS. `docs/pine/WAVE2-A-CENSUS.md` records form COUNTS — `for i = a to b`
1,004 · `while` 116 · `for x in` 92 · `for [i, x] in` 34 — but not which SCRIPT uses
which, and not what the body does. a4 needs both: the acceptance has to name scripts,
and the body shape decides whether unrolling a `for ... in` produces anything usable.

THE BODY SHAPE IS THE LOAD-BEARING COLUMN. A body that writes an array slot
(`array.set(b, j, x)`) unrolls into ordinary expression trees and is what Mechanism A
is for. A body that accumulates into a scalar (`s := s + x`) is refused TODAY by
`pine:reassign` — measured, in a COUNTED `for` as well, so it is not a property of the
iteration form at all. Counting the two separately is what turns "should a4 unroll
for-in" into a question with an answer.

⛔ Comments and string literals are stripped before matching, and the stripper carries
its own control — this repo has six recorded instances of a literal-hunting check
matching its own prose.

Usage:  python tools/pine_iteration_census.py [--list FORM]
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

# `for [i, x] in expr` must be tested BEFORE `for x in expr`, or the second matches it.
FORM_PAIRED = re.compile(r'^\s*for\s*\[\s*\w+\s*,\s*\w+\s*\]\s+in\s+(.+?)\s*$')
FORM_SINGLE = re.compile(r'^\s*for\s+\w+\s+in\s+(.+?)\s*$')
FORM_COUNTED = re.compile(r'^\s*for\s+\w+\s*=\s*.+?\s+to\s+')
FORM_WHILE = re.compile(r'^\s*while\s+')

WRITE_CALL = re.compile(r'\b(?:array|matrix|map)\.(set|push|unshift|insert|pop|shift|remove|clear)\s*\(')
SCALAR_ASSIGN = re.compile(r'^\s*\w+\s*(:=|\+=|-=|\*=|/=|%=)')
DRAW_CALL = re.compile(r'\b(plot|plotshape|plotchar|label\.new|line\.new|box\.new|table\.|fill|bgcolor)\s*\(')


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


def indent_of(line):
    return len(line) - len(line.lstrip())


def body_of(lines, at):
    """The indented block under `lines[at]`, as a list of lines."""
    base = indent_of(lines[at])
    body = []
    for k in range(at + 1, len(lines)):
        if not lines[k].strip():
            continue
        if indent_of(lines[k]) <= base:
            break
        body.append(lines[k])
    return body


def classify(body):
    """What does this loop body DO? The order encodes which fact dominates."""
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


# ── the stripper's own control ──────────────────────────────────────────────
PROBE = ['// for x in a', 'y = "for x in a"', 'for x in a', '    s := s + x']
_probe = strip_pine('\n'.join(PROBE))
_hits = [ln for ln in _probe if FORM_SINGLE.match(ln)]
assert len(_hits) == 1, 'stripper control: expected exactly 1 real `for x in`, got %d' % len(_hits)

files = []
for d in DIRS:
    if not os.path.isdir(d):
        continue
    for name in sorted(os.listdir(d)):
        if name.endswith('.pine') or name.endswith('.txt'):
            files.append(os.path.join(d, name))

forms = {'for x in': {}, 'for [i, x] in': {}, 'while': {}, 'for i = a to b': {}}
bodies = {k: {} for k in forms}
sources = {'for x in': {}, 'for [i, x] in': {}}

for path in files:
    lines = strip_pine(io.open(path, encoding='utf-8', errors='replace').read())
    base = os.path.basename(path)
    for i, line in enumerate(lines):
        m = FORM_PAIRED.match(line)
        form = None
        if m:
            form, src_expr = 'for [i, x] in', m.group(1)
        else:
            m = FORM_SINGLE.match(line)
            if m:
                form, src_expr = 'for x in', m.group(1)
            elif FORM_COUNTED.match(line):
                form, src_expr = 'for i = a to b', None
            elif FORM_WHILE.match(line):
                form, src_expr = 'while', None
        if not form:
            continue
        forms[form][base] = forms[form].get(base, 0) + 1
        kind = classify(body_of(lines, i))
        bodies[form][kind] = bodies[form].get(kind, 0) + 1
        if src_expr is not None:
            sources[form].setdefault(base, []).append((i + 1, src_expr[:60]))

w = sys.stdout.buffer.write
w(('files scanned: %d\n\n' % len(files)).encode())
w(b'form                 uses   files   body shapes\n')
w(b'-------------------  -----  ------  ------------------------------------------\n')
for form in ('for i = a to b', 'for x in', 'for [i, x] in', 'while'):
    uses = sum(forms[form].values())
    shapes = ', '.join('%s %d' % (k, v) for k, v in sorted(bodies[form].items(), key=lambda kv: -kv[1]))
    w(('%-19s  %5d  %6d  %s\n' % (form, uses, len(forms[form]), shapes)).encode())

want = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == '--list' else None
if want and want in sources:
    w(('\nscripts using `%s`:\n' % want).encode())
    for base in sorted(sources[want]):
        for line_no, expr in sources[want][base]:
            w(('  %-56s :%-5d %s\n' % (base[:56], line_no, expr)).encode('utf-8', 'replace'))
