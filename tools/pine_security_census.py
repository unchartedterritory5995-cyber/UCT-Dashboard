# -*- coding: utf-8 -*-
"""item (c) — the `request.security` census.

Item (c) is where this wave has been routing things: *"runtime arrays are the IR
lane's, item (c)"*, the 97 timeframe inputs that *"reach `request.security` — item
(c)"*, and the 5 `input.time` expression defaults that *"are (c)'s boundary"*. This
counts what is actually there, per form, so the threshold decides the scope after.

⭐⭐ THE HYPOTHESIS THIS MEASURES (c.3): a tuple result is a PLAN-TIME VECTOR OF
EXPRESSION SLOTS in Mechanism A's exact sense — `[a, b] = request.security(s, tf,
[x, y])` is two slots, slot 0 = `request.security(s, tf, x)`, slot 1 =
`request.security(s, tf, y)`, each an ordinary call tree, no tuple node and no
statement form. Measured through the shipped door BEFORE this tool was written, the
engine already does exactly that for a tuple returned by a USER FUNCTION:

    f() => [high, low]
    [a, b] = request.security("AAPL", "D", f())
    plot(a - b)
      -> ok, no refusal, ast = op('-', [sym(AAPL,[high]), sym(AAPL,[low])])

`pine.js` ≈4749 is the machinery: a destructured name carries `bound.index` into
`bound.fn.value.parts`, and each part resolves through `securityAsNode(bound.call)`.
`pine:tuple` fires only when the part does not exist. So the slot model is not a
proposal for (c) — it SHIPPED, and what this census has to find is which corpus forms
it does not reach.

⛔ WHAT WOULD BREAK THE HYPOTHESIS, and each is counted separately rather than
assumed absent: an element that is not independently expressible as its own security
call — one that READS ANOTHER ELEMENT, a per-call `lookahead`/`gaps` that would have
to differ per element, an element that is itself an ARRAY or a UDT, or shared
per-call state.

⛔ Comments and string literals are stripped before matching; the needle is built by
concatenation so this file does not contain it; the stripper carries controls BOTH
ways (it still sees a real call, and it does NOT see one written in prose).

⭐⭐ THE CONTROL IS ANOTHER CENSUS'S COMMITTED NUMBER. The (b) census measured **97**
`input.timeframe` uses consumed by `request.security`. This tool re-derives that exact
number through (b)'s own consumer walk and exits non-zero if it cannot — an instrument
that cannot reproduce the number it extends is measuring something else.

Usage:  python tools/pine_security_census.py
"""
import io
import importlib.util
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = [
    os.path.join(ROOT, 'corpus', 'committed'),
    os.path.join(ROOT, 'tests', 'fixtures', 'pine_oos'),
    os.path.join(ROOT, 'tests', 'fixtures', 'member'),
]

# ⭐ built by concatenation: this file must not contain its own needle
_SEC = 'security'
CALL = re.compile(r'\b(?:request\.)?%s\s*\(' % _SEC)
#: `[a, b] = …` — the destructure that makes a call a TUPLE use.
DESTRUCTURE = re.compile(r'^\s*\[([^\]]*)\]\s*=')
ARRAY_LIT = re.compile(r'\[\s*[A-Za-z_][^\]]*\]')


def _load_b_census():
    """(b)'s own module, so the 97 is re-derived by ITS walk, not by a copy."""
    p = os.path.join(ROOT, 'tools', 'pine_time_input_census.py')
    spec = importlib.util.spec_from_file_location('b_census', p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


B = _load_b_census()
strip_pine = B.strip_pine          # one stripper, not two
call_args = B.call_args
split_args = B.split_args


def scripts():
    out = []
    for d in SOURCES:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith('.pine') or f.endswith('.txt'):
                out.append((os.path.basename(d), f, os.path.join(d, f)))
    return out


def symbol_shape(a):
    a = (a or '').strip()
    if 'syminfo.tickerid' in a or 'syminfo.ticker' in a:
        return 'tickerid'
    if a.startswith(('"', "'")):
        return 'literal'
    if 'input.symbol' in a or a.startswith('input'):
        return 'input'
    if re.match(r'^[A-Za-z_]\w*$', a):
        return 'name'
    return 'expression'


def tf_shape(a):
    a = (a or '').strip()
    if re.match(r'^["\']\s*["\']$', a):
        return 'empty(chart)'
    if a.startswith(('"', "'")):
        return 'literal'
    if 'input.' in a or a.startswith('input'):
        return 'input'
    if re.match(r'^[A-Za-z_]\w*$', a):
        return 'name'
    return 'expression'


CONSUMERS = [
    ('plot/alert', re.compile(r'\b(plot|plotshape|plotchar|plotcandle|alertcondition'
                              r'|hline|fill|bgcolor|barcolor)\s*\(')),
    ('drawing', re.compile(r'\b(line|label|box|table|polyline)\.')),
]

# ── the stripper's own controls, BOTH ways ─────────────────────────────────
# ⚰️ v1 of this control asserted three matches unstripped and failed on its own probe:
# the string-literal line read `'request.security inside a STRING'` with NO paren, so
# the needle had never matched it and the "before" number was 2, not 3. The control was
# wrong, not the needle — fixed at the control, with the case now written as a real call.
_PROBE = '\n'.join([
    '// request.%s("AAPL","D",close) in a COMMENT is not a use' % _SEC,
    "x = 'request.%s(\"AAPL\",\"D\",close) inside a STRING is not a use'" % _SEC,
    'real = request.%s("AAPL", "D", close)' % _SEC,
])
assert len(CALL.findall(_PROBE)) == 3, \
    'stripper control: unstripped, all three must be visible — else the needle is wrong'
assert len(CALL.findall(strip_pine(_PROBE))) == 1, \
    'stripper control: exactly ONE real call must survive the strip'
assert symbol_shape('syminfo.tickerid') == 'tickerid', 'shape control'
assert tf_shape('""') == 'empty(chart)', 'shape control: the chart timeframe'


def main():
    w = sys.stdout.buffer.write
    rows = []
    breakers = Counter()
    targets = Counter()
    files = scripts()

    for _d, fname, path_ in files:
        raw = io.open(path_, encoding='utf-8', errors='replace').read()
        stripped = strip_pine(raw)
        lines = raw.split('\n')
        for m in CALL.finditer(stripped):
            line_no = raw[:m.start()].count('\n') + 1
            line = lines[line_no - 1] if line_no <= len(lines) else ''
            argtext = call_args(raw, raw.find('(', m.start()))
            args = split_args(argtext)
            dm = DESTRUCTURE.match(line)
            arity = len([x for x in dm.group(1).split(',') if x.strip()]) if dm else 1
            expr = args[2] if len(args) > 2 else ''
            named = {}
            for a in args[3:]:
                if '=' in a:
                    k, v = a.split('=', 1)
                    named[k.strip()] = v.strip()
            # ⛔⛔ THE HYPOTHESIS BREAKERS — and v1 of this block got two of its three
            # categories WRONG, which is recorded rather than quietly corrected:
            #
            #   `array-literal-arg` was counted as a breaker (90 of 193). It is the
            #   OPPOSITE: `request.security(s, tf, [x, y])` is precisely the form the
            #   hypothesis describes, and it is the form the engine refuses today with
            #   `pine:tuple`. It is the TARGET, not an obstacle.
            #
            #   `per-call-lookahead/gaps-on-a-tuple` was counted as a breaker (32). A
            #   breaker has to be semantics that DIFFER PER ELEMENT; `lookahead=` and
            #   `gaps=` are ONE call-level argument applied to the whole call, so slot
            #   expansion gives every element the same value, which is correct. Measured
            #   through the door beforehand: a scalar call carrying either still folds.
            #
            # ⛔ What survives is the real test: an element that cannot stand as its own
            # security call.
            # ⚰️⚰️ AND THE ONE "BREAKER" v2 REPORTED WAS A FALSE POSITIVE TOO.
            # `\bname\b` matched the destructured name `log` inside `math.log(...)`
            # on `high_engagement__18-cross-correlation-kioseff-trading.pine:226` —
            # a METHOD name, not the variable. The corpus breaker count is ZERO, and
            # the hypothesis holds on 193 of 193. A name preceded by `.` is a member,
            # never a read of a sibling element.
            brk = []
            if dm and arity > 1:
                names = [x.strip() for x in dm.group(1).split(',') if x.strip()]
                if any(re.search(r'(?<![.\w])%s\b' % re.escape(n), expr) for n in names):
                    brk.append('element-reads-another-element')
            if dm and re.search(r'\barray\.\w+\s*\(', expr):
                brk.append('element-is-an-array')
            if dm and re.search(r'\b\w+\.new\s*\(', expr):
                brk.append('element-is-a-UDT')
            for b in brk:
                breakers[b] += 1
            # the TARGET form, tracked separately from the breakers
            is_target = bool(dm and ARRAY_LIT.search(expr))
            if is_target:
                targets['array-literal-arg'] += 1
            # ⛔⛔ REACHABILITY USES (b)'s INTERPROCEDURAL WALK, NOT A LINE SCAN.
            # (b) learned this the hard way: a line-based consumer test reported
            # "(nothing)" for 82 of 158 timeframe inputs and could not cross a
            # function boundary. Reachability is the number the threshold turns on,
            # so an under-count here argues for retiring something members use.
            lhs = ([x.strip() for x in dm.group(1).split(',') if x.strip()] if dm
                   else [(B.bound_name(raw, m.start()) or '')])
            cons = set()
            for nm in lhs:
                if not nm:
                    continue
                c, _reach = B.consumers_of(stripped, nm)
                cons |= c
            rows.append({
                'file': fname, 'line': line_no,
                'form': 'tuple' if dm else 'scalar', 'arity': arity,
                'sym': symbol_shape(args[0] if args else ''),
                'tf': tf_shape(args[1] if len(args) > 1 else ''),
                'lookahead': 'lookahead' in named, 'gaps': 'gaps' in named,
                'consumers': cons, 'breakers': brk, 'is_target': is_target,
            })

    # ── THE CONTROL: (b)'s 97, re-derived by (b)'s own walk ────────────────
    sec97 = 0
    for _d, fname, path_ in files:
        raw = io.open(path_, encoding='utf-8', errors='replace').read()
        st = B.strip_pine(raw)
        for m in B.CALL.finditer(st):
            kind = m.group(1) or 'input'
            if kind != 'timeframe':
                continue
            name = B.bound_name(raw, m.start())
            cons, _reach = B.consumers_of(st, name)
            if 'request.security' in cons:
                sec97 += 1

    w(b'ITEM (c) - request.security CENSUS\n\n')
    w(('scripts read: %d   security calls: %d\n\n' % (len(files), len(rows))).encode())
    w(b'--- THE CONTROL: (b) census cross-check ---\n')
    w(('  input.timeframe uses consumed by request.security: %d  (b) measured 97\n'
       % sec97).encode())
    ok = (sec97 == 97)
    w(('  CONTROL %s\n\n' % ('OK' if ok else '*** MISMATCH ***')).encode())

    forms = Counter(r['form'] for r in rows)
    w(b'--- FORM ---\n')
    for k, v in forms.most_common():
        w(('  %-8s %5d\n' % (k, v)).encode())
    tup = [r for r in rows if r['form'] == 'tuple']
    w(('\n--- TUPLE ARITY (%d tuple uses) ---\n' % len(tup)).encode())
    for k, v in sorted(Counter(r['arity'] for r in tup).items()):
        w(('  arity %-3d %5d\n' % (k, v)).encode())
    w(b'\n--- SYMBOL SHAPE ---\n')
    for k, v in Counter(r['sym'] for r in rows).most_common():
        w(('  %-12s %5d\n' % (k, v)).encode())
    w(b'\n--- TIMEFRAME SHAPE ---\n')
    for k, v in Counter(r['tf'] for r in rows).most_common():
        w(('  %-12s %5d\n' % (k, v)).encode())
    w(b'\n--- barmerge ARGUMENTS ---\n')
    w(('  lookahead present: %d\n' % sum(1 for r in rows if r['lookahead'])).encode())
    w(('  gaps present     : %d\n' % sum(1 for r in rows if r['gaps'])).encode())
    w(b'\n--- CONSUMER ---\n')
    cc = Counter()
    for r in rows:
        if not r['consumers']:
            cc['(further expression / none on the line)'] += 1
        for c in r['consumers']:
            cc[c] += 1
    for k, v in cc.most_common():
        w(('  %-38s %5d\n' % (k, v)).encode())

    w(b'\n--- REACHABLE (reaches a plot/alertcondition), per form ---\n')
    for form in ('scalar', 'tuple'):
        fr = [r for r in rows if r['form'] == form]
        reach = [r for r in fr if 'plot/alert' in r['consumers']]
        w(('  %-8s %5d uses   %5d reachable\n' % (form, len(fr), len(reach))).encode())
    tgt_reach = [r for r in rows if r.get('is_target') and 'plot/alert' in r['consumers']]
    w(('  %-8s %5d uses   %5d reachable   <- the TARGET form\n'
       % ('target', sum(1 for r in rows if r.get('is_target')), len(tgt_reach))).encode())
    w(b'\n--- c.3 HYPOTHESIS ---\n')
    broke = sum(1 for r in tup if r['breakers'])
    w(('  tuple uses satisfying the slot model : %d of %d\n'
       % (len(tup) - broke, len(tup))).encode())
    w(('  uses with a REAL BREAKER             : %d\n' % broke).encode())
    if breakers:
        for k, v in breakers.most_common():
            w(('      %-34s %d\n' % (k, v)).encode())
    else:
        w(b'      (none found in the corpus)\n')
    w(b'\n  the TARGET form - refused today, and what the hypothesis would carry:\n')
    for k, v in targets.most_common():
        w(('      %-34s %d\n' % (k, v)).encode())
    if not targets:
        w(b'      (none)\n')

    w(b'\n--- R17 SPECIMEN ---\n')
    for r in rows:
        if r['file'].startswith('high_engagement__20'):
            w(('  %s:%d form=%s sym=%s tf=%s breakers=%s\n'
               % (r['file'][:44], r['line'], r['form'], r['sym'], r['tf'],
                  r['breakers'] or '[]')).encode())

    w(b'\n--- FILES WITH TUPLE USES ---\n')
    byf = defaultdict(int)
    for r in tup:
        byf[r['file']] += 1
    for f, n in sorted(byf.items(), key=lambda kv: -kv[1])[:10]:
        w(('  %-58s %d\n' % (f[:58], n)).encode())
    w(('  (tuple uses in %d files)\n' % len(byf)).encode())
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
