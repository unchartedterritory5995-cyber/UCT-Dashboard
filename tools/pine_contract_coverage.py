# -*- coding: utf-8 -*-
"""a7.3 — what the Python twin actually READS from each contract file.

The twin is a VERIFIER, not a translator: 23 `tests/test_ast_*.py` rails plus
`tools/ast_conformance.py`, which shells out to node and refuses rather than
reporting zero when a lane cannot be measured. This census answers, per contract
file, three questions the contract itself cannot:

  READ       fields some Python reader reads
  IGNORED    fields present in the artifact that no reader touches
  DEMANDED   fields a reader reads that the artifact does NOT always carry
             — that one is a DEFECT, because a reader that indexes a missing key
             raises where it meant to compare

⛔ The last class is the dangerous one and it is the reason to run this at all.
Written-but-unread is at worst dead weight; read-but-not-written is a rail that
breaks on data the writer is entitled to produce.

⭐ Its own control, per the standing rule that a guard asserts the answer: the
census must find a field it KNOWS is read (`rows`) and one it KNOWS is ignored
(`_`, the human note), or the reader-scan is not looking at anything.

Usage:  python tools/pine_contract_coverage.py
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ⚰️⚰️ `dedicated` IS THE WHOLE HONESTY OF THIS INSTRUMENT, AND ITS FIRST RUN PROVED
# WHY. `fields_read_by` collects every `d["x"]` in a reader file, and it cannot tell
# WHICH dict is being indexed. For a reader that exists to read one artifact that is
# fine. For a large multi-purpose tool it is not: run over `chart_parity.py` and
# friends, the census reported **219 "read-but-not-written defects"** including `pid`,
# `url`, `token`, `runner`, `diff_png` and `font_reloads` — none of which has anything
# to do with the contract file. That is the instrument reporting its own over-reach as
# a finding, the exact class this repo has six recorded instances of.
#
# ⛔ SO `DEMANDED` IS COMPUTED ONLY FOR DEDICATED READERS, and for the rest the census
# says it cannot determine it rather than inventing a defect list. READ and IGNORED are
# still reported for every file, clearly labelled as a SUPERSET for shared readers.
CONTRACT = {
    'tools/lookback_agreement.json': [
        'tests/test_ast_lookback_agreement.py', 'tools/vendor_window.py',
    ],
    'app/src/components/chart/engine/ast/closedTable.json': [
        'tests/test_alert_condition_note.py', 'tests/test_ast_conformance.py',
        'tests/test_ast_lookback_parity.py', 'tests/test_input_windows.py',
        'tools/build_canonical_address_book.py',
        'tools/track_a_ingest_vendor_capture.py',
    ],
    'tools/chart_parity_cases.json': [
        'tools/chart_parity.py', 'tools/compat_harness_visual.py',
        'tools/flipc_mutation_gauntlet.py', 'tools/flipc_task12_gauntlet.py',
        'tools/gen_parity_regions.py',
    ],
}

# `d["x"]`, `d.get("x")`, `row["x"]` — the two ways a Python reader names a field.
KEYREF = re.compile(r'''\[\s*["']([A-Za-z_][\w]*)["']\s*\]|\.get\(\s*["']([A-Za-z_][\w]*)["']''')


def strip_py(src):
    """Drop comments and string literals so a field NAMED IN PROSE is not a read.

    ⛔ This repo has six recorded instances of a literal-hunting check matching its
    own documentation. `tableVersion` appears in several docstrings here and is read
    by nobody; without this the census would report it as read.
    """
    out, i, n = [], 0, len(src)
    while i < n:
        ch = src[i]
        if ch == '#':
            while i < n and src[i] != '\n':
                i += 1
            continue
        if src.startswith('"""', i) or src.startswith("'''", i):
            q = src[i:i + 3]
            j = src.find(q, i + 3)
            i = n if j < 0 else j + 3
            continue
        if ch in '"\'':
            j, q = i + 1, ch
            while j < n and src[j] != q:
                j += 2 if src[j] == '\\' else 1
            # keep the quotes so KEYREF can still match d["x"]
            out.append(src[i:min(j + 1, n)])
            i = j + 1
            continue
        out.append(ch)
        i += 1
    return ''.join(out)


def fields_read_by(paths):
    names = set()
    for rel in paths:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        body = strip_py(io.open(p, encoding='utf-8', errors='replace').read())
        for a, b in KEYREF.findall(body):
            names.add(a or b)
    return names


def artifact_fields(rel):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        return None, None
    d = json.load(io.open(p, encoding='utf-8'))
    if not isinstance(d, dict):
        return set(), set()
    top = set(d.keys())
    row = set()
    for v in d.values():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            for item in v[:200]:
                row |= set(item.keys())
    return top, row


# ── the census's own control ────────────────────────────────────────────────
_probe = fields_read_by(['tests/test_ast_lookback_agreement.py'])
assert 'rows' in _probe, 'control: the reader-scan does not see `rows`, so it sees nothing'
assert '_' not in _probe, 'control: `_` is a human note and is read by nobody'

#: files whose readers exist to read THAT artifact, so a key-read is attributable.
DEDICATED = {'tools/lookback_agreement.json'}

w = sys.stdout.buffer.write
w(b'a7.3 - PYTHON TWIN COVERAGE OF THE CONTRACT\n\n')

owed = []
for rel, readers in CONTRACT.items():
    top, row = artifact_fields(rel)
    if top is None:
        w(('%-52s MISSING ON DISK\n' % rel).encode())
        continue
    read = fields_read_by(readers)
    present = top | row
    read_here = sorted(read & present)
    ignored = sorted(present - read)
    dedicated = rel in DEDICATED
    w(('%s\n' % rel).encode())
    w(('   readers   : %d%s\n'
       % (len(readers), '' if dedicated else '  (shared tools)')).encode())
    w(('   READ      : %s%s\n'
       % (', '.join(read_here) or '(none)',
          '' if dedicated else '   [SUPERSET - shared readers index other dicts too]')).encode())
    w(('   IGNORED   : %s\n' % (', '.join(ignored) or '(none)')).encode())
    if dedicated:
        demanded = sorted(read - present)
        w(('   DEMANDED? : %s\n\n' % (', '.join(demanded) or '(none)')).encode())
        for f in demanded:
            owed.append((rel, f))
    else:
        w(b'   DEMANDED? : NOT DETERMINABLE - readers are shared tools, and a key-read\n'
          b'               cannot be attributed to this artifact by text alone\n\n')

w(b'---\n')
w(('read-but-not-always-written (DEFECTS, dedicated readers only): %d\n'
   % len(owed)).encode())
for rel, f in owed:
    w(('   %s <- reader indexes %r, artifact does not carry it\n' % (rel, f)).encode())
w('\nwritten-but-unread — CANDIDATES FOR REMOVAL, RECORDED NOT REMOVED.\n'
  'A threshold governs what is built, never what is removed; taking a field out\n'
  'needs its own authority and its own commit.\n'.encode())
for rel in CONTRACT:
    if rel not in DEDICATED:
        continue
    top, row = artifact_fields(rel)
    unread = sorted(((top or set()) | (row or set())) - fields_read_by(CONTRACT[rel]))
    w(('   %s: %s\n' % (rel, ', '.join(unread) or '(none)')).encode())
