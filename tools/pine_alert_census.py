# -*- coding: utf-8 -*-
"""item (d) — the ALERT census.

"alertSets" is the owner's phrase and is undefined in the repo. This counts what the
corpus actually writes, so the threshold decides the scope after — the shape a1's
census used for loops and (b)'s for time inputs.

⭐⭐ WHAT THE ENGINE DOES TODAY, measured through the shipped door before this tool was
written, because two of the three answers are SILENT and a census that only counted
call sites would have missed them:

  alertcondition(cond, title, message)
      -> an OUTPUT with `kind: 'alertcondition'`; `title` is carried as a FIELD on the
         output, exactly like a plot's, so `str`'s textop-only parentage is never
         engaged and no 12th node type is implied
      -> ⛔ the MESSAGE IS DROPPED ENTIRELY. No `message` key, and the string appears
         NOWHERE in the result — for a literal, for `{{placeholder}}`, and for an
         expression alike. No refusal, no note.
  alert(message, freq)                 (the runtime form)
      -> ⛔ SILENTLY DROPPED. ok=true, no output, no refusal, no note.

⛔ Both silences are the finding. This engine's standing rule is that a construct it
cannot carry is REFUSED BY NAME or NOTED — never dropped — so the census's job is to
size them, not to discover them.

⭐⭐ RULING D1 IS THE OTHER HALF: *"a pane does not select an alert"*. Measured on the
member script, strict `selected` is **0** ("Volume"), not the alertcondition at index 4
— while the SCREENER selects the alertcondition first, which is correct for a scan.
So "what a set is worth" differs per surface, and the census reports per surface.

THE CONTROL IS THE PRODUCT'S OWN COMMITTED NUMBER: `uncharted-volume-v2.pine` carries
exactly ONE alertcondition, and D1 pins the host lane's `selected` at 0. The census
re-derives the count and the harness re-derives the selection; either mismatching exits
non-zero.

⛔ Comments and string literals are stripped before matching; the needle is built by
concatenation; the stripper carries controls BOTH ways.

Usage:  python tools/pine_alert_census.py
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

_AC = 'alert' + 'condition'
AC = re.compile(r'\b%s\s*\(' % _AC)
#: the runtime form — `alert(` but NOT `alertcondition(`
ALERT = re.compile(r'\balert\s*\(')
PLACEHOLDER = re.compile(r'\{\{[^}]*\}\}')

# one stripper, shared with (b)'s census rather than copied
_spec = importlib.util.spec_from_file_location(
    'b_census', os.path.join(ROOT, 'tools', 'pine_time_input_census.py'))
_B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_B)
strip_pine, call_args, split_args = _B.strip_pine, _B.call_args, _B.split_args

# ── the stripper's controls, BOTH ways ──────────────────────────────────────
_PROBE = '\n'.join([
    '// %s(c, "T", "M") in a COMMENT is not a use' % _AC,
    "x = '%s(c, \"T\", \"M\") inside a STRING is not a use'" % _AC,
    'real = %s(c, "T", "M")' % _AC,
])
assert len(AC.findall(_PROBE)) == 3, 'control: unstripped, all three must be visible'
assert len(AC.findall(strip_pine(_PROBE))) == 1, 'control: exactly ONE survives the strip'


def shape_of(arg):
    a = (arg or '').strip()
    if not a:
        return 'absent'
    if PLACEHOLDER.search(a):
        return 'placeholder'
    if a.startswith(('"', "'")) and a.endswith(('"', "'")) and '+' not in a:
        return 'literal'
    if a.startswith(('"', "'")):
        return 'expression'
    return 'expression'


def cond_family(expr):
    """The identifiers a condition is built from — its 'signal family'."""
    return frozenset(re.findall(r'\b[A-Za-z_]\w*\b', expr or '')) - {
        'and', 'or', 'not', 'true', 'false', 'na', 'close', 'open', 'high', 'low'}


def scripts():
    out = []
    for d in SOURCES:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith('.pine') or f.endswith('.txt'):
                out.append((os.path.basename(d), f, os.path.join(d, f)))
    return out


def main():
    w = sys.stdout.buffer.write
    per_file = defaultdict(list)
    alert_calls = Counter()
    title_shapes, msg_shapes = Counter(), Counter()
    files = scripts()

    for _d, fname, path_ in files:
        raw = io.open(path_, encoding='utf-8', errors='replace').read()
        st = strip_pine(raw)
        for m in AC.finditer(st):
            args = split_args(call_args(raw, raw.find('(', m.start())))
            cond = args[0] if args else ''
            title = args[1] if len(args) > 1 else ''
            msg = args[2] if len(args) > 2 else ''
            ts, ms = shape_of(title), shape_of(msg)
            title_shapes[ts] += 1
            msg_shapes[ms] += 1
            per_file[fname].append({
                'line': raw[:m.start()].count('\n') + 1,
                'title': ts, 'msg': ms, 'family': cond_family(cond),
            })
        for m in ALERT.finditer(st):
            # ⛔ `alertcondition(` also matches `alert` + `condition(`? No — but
            # `\balert\s*\(` must not match INSIDE `alertcondition(`, so the AC spans
            # are excluded by position.
            if any(a.start() <= m.start() < a.end() for a in AC.finditer(st)):
                continue
            if st[m.start():m.start() + len(_AC)] == _AC:
                continue
            alert_calls[fname] += 1

    total_ac = sum(len(v) for v in per_file.values())
    w(b'ITEM (d) - ALERT CENSUS\n\n')
    w(('scripts read: %d\n' % len(files)).encode())
    w(('alertcondition uses: %d in %d files\n' % (total_ac, len(per_file))).encode())
    w(('alert() runtime uses: %d in %d files\n\n'
       % (sum(alert_calls.values()), len(alert_calls))).encode())

    w(b'--- THE CONTROL: the product\'s own number ---\n')
    v2 = len(per_file.get('uncharted-volume-v2.pine', []))
    w(('  uncharted-volume-v2 alertconditions: %d   (D1 measured 1, at index 4)\n'
       % v2).encode())
    ok = (v2 == 1)
    w(('  CONTROL %s\n\n' % ('OK' if ok else '*** MISMATCH ***')).encode())

    w(b'--- TITLE shape ---\n')
    for k, n in title_shapes.most_common():
        w(('  %-12s %5d\n' % (k, n)).encode())
    w(b'\n--- MESSAGE shape (ALL of these are dropped today) ---\n')
    for k, n in msg_shapes.most_common():
        w(('  %-12s %5d\n' % (k, n)).encode())

    w(b'\n--- HOW MANY PER SCRIPT (is an "alertSet" a real pattern?) ---\n')
    counts = Counter(len(v) for v in per_file.values())
    for k in sorted(counts):
        w(('  %2d alertcondition(s): %4d file(s)\n' % (k, counts[k])).encode())

    w(b'\n--- SETS: several alertconditions sharing a SIGNAL FAMILY ---\n')
    setty = 0
    members = Counter()
    for f, rows in per_file.items():
        if len(rows) < 2:
            continue
        for i, a in enumerate(rows):
            for b in rows[i + 1:]:
                if a['family'] & b['family']:
                    setty += 1
                    members[f] += 1
                    break
    w(('  files with 2+ alertconditions            : %d\n'
       % sum(1 for v in per_file.values() if len(v) > 1)).encode())
    w(('  files where 2+ share a condition family  : %d\n' % len(members)).encode())
    w(('  alertconditions inside such a family     : %d\n' % setty).encode())

    w(b'\n--- THE ONLY-OUTPUT CASE (D1 territory) ---\n')
    only = 0
    for _d, fname, path_ in files:
        if fname not in per_file:
            continue
        raw = strip_pine(io.open(path_, encoding='utf-8', errors='replace').read())
        if not re.search(r'\bplot\w*\s*\(', raw):
            only += 1
    w(('  scripts whose ONLY output is alertcondition(s): %d\n' % only).encode())
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
