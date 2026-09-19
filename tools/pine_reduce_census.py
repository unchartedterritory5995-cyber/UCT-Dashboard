# -*- coding: utf-8 -*-
"""a5.1 — the REDUCE / SEARCH member census.

a5's member list is owner-pending. `REDUCE_MEMBERS` (arrayVectors.js:55) names four —
sum, max, min, avg — the iteration census classes `indexof` and `sort` as reduce, and
`stdev` and `includes` appear in NO source list at all. So the census counts what the
corpus ACTUALLY uses rather than what a hand-off remembered, and the threshold decides
the scope after.

PER USE IT ANSWERS THREE THINGS, because the a4b lesson was that the binding constraint
is rarely the one the member list suggests:

  RECEIVER   is the call's receiver a name this lane created as a plan-time vector,
             and was its size a literal or literal-derived expression at creation —
             the same BOUND question that capped a4b at 63 of 379
  CONSUMER   does the result reach a plot()/alertcondition(), or only a drawing or
             UDT path, where this lane draws nothing anyway
  IN-LOOP    is the call inside a loop body, in which case the loop's own bound has
             to settle too before the call can be unrolled

⛔ Comments and string literals are stripped before matching, and the stripper carries
its own control. The committed counts — indexof 18, sort 10 — are reproduced exactly as
the second control: an instrument that cannot re-derive the numbers it extends is
measuring something else.

⚠️ THE RECEIVER ANSWER HERE IS STRUCTURAL, NOT THE ENGINE'S. `Resolver.foldVectorSize`
is the authority on whether a size settles, and it runs inside `translatePine`; this
tool reports what the SOURCE says about the creation, and the engine-side answer is
measured separately through the shipped door. Where the two disagree the engine wins.

Usage:  python tools/pine_reduce_census.py [--list MEMBER]
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

# The members a5 is scoped around, plus everything else under `array.` so the census
# can report members no list names.
ASKED = ('sum', 'max', 'min', 'avg', 'indexof', 'sort', 'includes', 'stdev')
# arrayVectors.js — HANDLED = CREATE + READ + WRITE + REDUCE
ALREADY_HANDLED = {
    'new_float', 'new_int', 'new_bool', 'new_string', 'new', 'from',
    'get', 'size', 'first', 'last',
    'set', 'push', 'pop', 'shift', 'unshift', 'insert', 'remove', 'clear',
    'sum', 'max', 'min', 'avg',
}

CALL = re.compile(r'\barray\.(\w+)\s*\(')
CREATE = re.compile(r'\b(\w+)\s*=\s*array\.(new\w*|from)\s*(?:<[^>]*>)?\s*\(\s*([^),]*)')
NUMBER = re.compile(r'^-?\d+(\.\d+)?$')
OUTPUT_CALL = re.compile(r'\b(plot|plotshape|plotchar|plotcandle|alertcondition|hline)\s*\(')
DRAW_ONLY = re.compile(r'\b(label\.|line\.|box\.|table\.|polyline\.)')
LOOP_HEAD = re.compile(r'^\s*(for|while)\b')


def strip_pine(src):
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


def const_env(lines, at):
    env = {}
    for k in range(0, at):
        m = re.match(r'^(?:var\s+|varip\s+)?(?:float\s+|int\s+)?(\w+)\s*=\s*(-?\d+(?:\.\d+)?)\s*$',
                     lines[k])
        if m:
            env[m.group(1)] = float(m.group(2))
    return env


def creations(lines):
    """name -> ('literal'|'literal-derived'|'unsettled', line) for every array created."""
    out = {}
    for i, line in enumerate(lines):
        m = CREATE.search(line)
        if not m:
            continue
        name, size = m.group(1), (m.group(3) or '').strip()
        env = const_env(lines, i)
        if size == '' or NUMBER.match(size):
            kind = 'literal'
        elif size in env:
            kind = 'literal-derived'
        else:
            mm = re.match(r'^([\w.]+)\s*([+\-*/])\s*([\w.]+)$', size)
            ok = False
            if mm:
                a, b = mm.group(1), mm.group(3)
                ok = (NUMBER.match(a) or a in env) and (NUMBER.match(b) or b in env)
            kind = 'literal-derived' if ok else 'unsettled'
        out[name] = (kind, i + 1)
    return out


def receiver_of(line, member):
    m = re.search(r'\barray\.' + member + r'\s*\(\s*([A-Za-z_]\w*)', line)
    return m.group(1) if m else None


def enclosing_loop(lines, at):
    base = indent_of(lines[at])
    if base == 0:
        return False
    for k in range(at - 1, -1, -1):
        if not lines[k].strip():
            continue
        if indent_of(lines[k]) < base and LOOP_HEAD.match(lines[k]):
            return True
        if indent_of(lines[k]) == 0:
            return False
    return False


# ── control 1: the stripper ─────────────────────────────────────────────────
PROBE = ['// array.sum(a)', 'y = "array.sum(a)"', 'z = array.sum(a)']
assert sum(len(CALL.findall(ln)) for ln in strip_pine('\n'.join(PROBE))) == 1, 'stripper control'

files = []
for d in DIRS:
    if not os.path.isdir(d):
        continue
    for nm in sorted(os.listdir(d)):
        if nm.endswith('.pine') or nm.endswith('.txt'):
            files.append(os.path.join(d, nm))

rows = []
all_members = {}
for path in files:
    lines = strip_pine(io.open(path, encoding='utf-8', errors='replace').read())
    base = os.path.basename(path)
    made = creations(lines)
    text = '\n'.join(lines)
    for i, line in enumerate(lines):
        for m in CALL.finditer(line):
            member = m.group(1)
            all_members[member] = all_members.get(member, 0) + 1
            if member not in ASKED:
                continue
            recv = receiver_of(line, member)
            kind, made_at = made.get(recv, ('not-created-here', None))
            # ⚰️ DOES THE RESULT REACH AN OUTPUT? The first version of this asked only
            # whether the CALL'S OWN LINE contained a plot(), and reported **0 of 209
            # uses reaching an output across all eight members** — a zero from one
            # heuristic, which is this repo's signature for an instrument reporting its
            # own blind spot. A reduce is almost never written inside the plot call; it
            # is bound to a name and plotted lines later. The binding is followed.
            consumer = None
            if OUTPUT_CALL.search(line):
                consumer = 'output'
            else:
                bound = re.match(r'^\s*(?:var\s+|varip\s+)?(?:float\s+|int\s+|bool\s+)?'
                                 r'(\w+)\s*(?::?=)', line)
                if bound:
                    nm = bound.group(1)
                    use = re.compile(r'\b' + re.escape(nm) + r'\b')
                    for other in lines:
                        if other is line:
                            continue
                        if OUTPUT_CALL.search(other) and use.search(other):
                            consumer = 'output'
                            break
            if consumer is None:
                consumer = 'drawing/UDT' if DRAW_ONLY.search(line) else 'other/indirect'
            rows.append({
                'file': base, 'line': i + 1, 'member': member, 'recv': recv or '?',
                'receiver': kind, 'created_at': made_at,
                'consumer': consumer, 'in_loop': enclosing_loop(lines, i),
            })

w = sys.stdout.buffer.write
w(('files scanned: %d\n' % len(files)).encode())

# ── control 2: the committed numbers ───────────────────────────────────────
counts = {}
for r in rows:
    counts.setdefault(r['member'], []).append(r)
ctl = []
for member, expect in (('indexof', 18), ('sort', 10)):
    got = len(counts.get(member, []))
    ctl.append('%s %d/%d %s' % (member, got, expect, 'OK' if got == expect else 'MISMATCH'))
w(('control (committed counts): %s\n\n' % ' · '.join(ctl)).encode())

w(b'member      uses  files   receiver settled     consumer=output  in-loop\n')
w(b'----------  ----  -----   ------------------   ---------------  -------\n')
for member in ASKED:
    rs = counts.get(member, [])
    if not rs:
        w(('%-10s  %4d  %5d   %-18s   %15s  %7s\n' % (member, 0, 0, '-', '-', '-')).encode())
        continue
    settled = sum(1 for r in rs if r['receiver'] in ('literal', 'literal-derived'))
    out = sum(1 for r in rs if r['consumer'] == 'output')
    inloop = sum(1 for r in rs if r['in_loop'])
    w(('%-10s  %4d  %5d   %4d (%s)%s   %15d  %7d\n'
       % (member, len(rs), len({r['file'] for r in rs}), settled,
          ', '.join(sorted({r['receiver'] for r in rs
                            if r['receiver'] in ('literal', 'literal-derived')})) or 'none',
          '' if settled else '        ', out, inloop)).encode())

adm = {}
for member in ASKED:
    rs = counts.get(member, [])
    adm[member] = [r for r in rs
                   if r['receiver'] in ('literal', 'literal-derived')
                   and r['consumer'] == 'output']
w(b'\nADMISSIBLE per member (receiver settled AND result reaches an output)\n')
for member in ASKED:
    w(('  %-10s %3d of %3d\n' % (member, len(adm[member]), len(counts.get(member, [])))).encode())

w(b'\nOTHER `array.` members the corpus uses, that HANDLED does not name\n')
for member, n in sorted(all_members.items(), key=lambda kv: -kv[1]):
    if member in ALREADY_HANDLED or member in ASKED:
        continue
    w(('  %-16s %4d\n' % (member, n)).encode())

if len(sys.argv) > 2 and sys.argv[1] == '--list':
    want = sys.argv[2]
    w(('\n`array.%s` uses:\n' % want).encode())
    for r in counts.get(want, []):
        w(('  %-44s :%-5d recv=%-12s %-16s %-14s loop=%s\n'
           % (r['file'][:44], r['line'], r['recv'][:12], r['receiver'],
              r['consumer'], r['in_loop'])).encode('utf-8', 'replace'))
