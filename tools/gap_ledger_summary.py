"""Generate the competitive gap ledger's summary block from its rows — never hand-typed.

    python tools/gap_ledger_summary.py              # print the block
    python tools/gap_ledger_summary.py --check      # exit 1 when the committed block differs
    python tools/gap_ledger_summary.py --write      # replace the committed block, nothing else
    python tools/gap_ledger_summary.py --self-check # prove --check can fail (and pass)
    ... [--ledger PATH]

Wave 9, lane 9B (B3). The ledger's old summary (`## Summary counts (2026-09-06)`) was typed
by hand and went stale within a day; this block is derived from the rows every time, and
`tests/test_gap_ledger_summary.py` fails when the committed copy disagrees with this tool.

THE BUCKETING RULE — explicit, and the only one:

1. Rows. Every line that starts with `| G-` is a row. Its cells are the text between pipes
   (a missing trailing pipe is tolerated). The STATUS cell is found by the column named
   `Status` in the most recent header row above it (`| ID | ... |`). A row whose cell count
   differs from that header's is MALFORMED: its columns cannot be trusted, so it is listed
   under UNBUCKETED by ID and counted nowhere else.
2. Live status. A STATUS cell corrected in place carries its history: `⚰️ was: <old text>
   ⟶ <corrected text>`. When a cell contains `⚰️ was:`, the live status is the text after
   the LAST `⟶` (U+27F6), a delimiter no older status uses. Otherwise the whole cell is live.
   `**` and backticks are removed before reading it.
3. Bucket. The live status is scanned for these UPPER-CASE words (whole words, case
   sensitive); the bucket is the one whose keyword appears FIRST in the text:
       DONE        DONE, SHIPPED, FIXED, CLOSED, LIVE, ARMED
       PARTIAL     PARTIAL, PARTIALLY
       OPEN        OPEN
       BUILT-DARK  "BUILT, DARK", "BUILT-DARK", "BUILT DARK"
       REJECTED    REJECTED, OUT-OF-SCOPE, "OUT OF SCOPE"
       BLOCKED     BLOCKED
       EXPERIMENT  EXPERIMENT
       DUPLICATE   DUPLICATE
   "First by position" is deliberate: `PARTIAL — price DONE, estimates gated` is PARTIAL,
   `EXPERIMENT, BLOCKED` is EXPERIMENT, `BUILT, DARK — BLOCKED on ZDR` is BUILT-DARK.
   DUPLICATE (controller ruling, 2026-09-26, wave 9 lane 9B fix round 1): a row whose
   capability is tracked by another row keeps its line — the ledger never deletes one — and
   is counted in its OWN bucket, listed by ID, never folded into DONE or any other bucket
   (`DUPLICATE of G-044 — tracked there` is DUPLICATE, not the status of G-044).
4. A row whose live status holds none of the words is UNBUCKETED, listed by ID with the
   reason. Nothing is ever dropped: the block states that bucket counts plus UNBUCKETED
   equal the number of rows, and the tool refuses to write a block where they do not.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_LEDGER = os.path.join(REPO, 'docs', 'notebook', 'competitive-gap-ledger.md')

BEGIN = '<!-- GENERATED:gap-ledger-summary:BEGIN -->'
END = '<!-- GENERATED:gap-ledger-summary:END -->'
TOMBSTONE = '⚰️ was:'
ARROW = '⟶'

BUCKETS = ('DONE', 'PARTIAL', 'OPEN', 'BUILT-DARK', 'REJECTED', 'BLOCKED', 'EXPERIMENT', 'DUPLICATE')
KEYWORDS = (
    ('DONE', r'DONE|SHIPPED|FIXED|CLOSED|LIVE|ARMED'),
    ('PARTIAL', r'PARTIALLY|PARTIAL'),
    ('OPEN', r'OPEN'),
    ('BUILT-DARK', r'BUILT,\s*DARK|BUILT-DARK|BUILT\s+DARK'),
    ('REJECTED', r'REJECTED|OUT-OF-SCOPE|OUT\s+OF\s+SCOPE'),
    ('BLOCKED', r'BLOCKED'),
    ('EXPERIMENT', r'EXPERIMENT'),
    ('DUPLICATE', r'DUPLICATE'),
)
_KW = [(b, re.compile(r'(?<![A-Z0-9_-])(?:' + rx + r')(?![A-Z0-9_])')) for b, rx in KEYWORDS]


@dataclass
class Row:
    rid: str
    line: int
    status: str | None      # the live status text, None when malformed
    bucket: str | None      # None -> UNBUCKETED
    reason: str = ''


def split_cells(line: str) -> list[str]:
    s = line.strip()
    if s.startswith('|'):
        s = s[1:]
    if s.endswith('|'):
        s = s[:-1]
    return [c.strip() for c in s.split('|')]


def live_status(cell: str) -> str:
    text = cell
    if TOMBSTONE in text and ARROW in text:
        text = text.rsplit(ARROW, 1)[1]
    return text.replace('**', '').replace('`', '').strip()


def bucket_of(status: str) -> str | None:
    best = None
    for bucket, rx in _KW:
        m = rx.search(status)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), bucket)
    return best[1] if best else None


def parse(text: str) -> list[Row]:
    rows: list[Row] = []
    header: list[str] | None = None
    for i, line in enumerate(text.replace('\r\n', '\n').split('\n'), 1):
        if line.startswith('| ID |'):
            header = split_cells(line)
            continue
        if not line.startswith('| G-'):
            continue
        cells = split_cells(line)
        rid = cells[0]
        if header is None or 'Status' not in header:
            rows.append(Row(rid, i, None, None, 'no header row with a Status column above it'))
            continue
        if len(cells) != len(header):
            rows.append(Row(rid, i, None, None,
                            f'malformed: {len(cells)} cells against a {len(header)}-column header'))
            continue
        status = live_status(cells[header.index('Status')])
        b = bucket_of(status)
        rows.append(Row(rid, i, status, b, '' if b else 'no bucket word in its status'))
    return rows


def render(rows: list[Row], nl: str = '\n') -> str:
    total = len(rows)
    by = {b: [r.rid for r in rows if r.bucket == b] for b in BUCKETS}
    unb = [r for r in rows if r.bucket is None]
    counted = sum(len(v) for v in by.values()) + len(unb)
    if counted != total:  # pragma: no cover - a defect in this file, never in the ledger
        raise SystemExit(f'refusing to write: counted {counted} of {total} rows')
    out = [
        BEGIN,
        '',
        'Generated by `python tools/gap_ledger_summary.py` from every `| G-` row of this file; do '
        'not hand-edit it (`--check` fails when this block and the rows disagree). The bucketing '
        'rule is written at the top of that tool.',
        '',
        f'**Rows: {total}.** Bucket counts plus UNBUCKETED equal the row count.',
        '',
        '| Bucket | Count | IDs |',
        '|---|---:|---|',
    ]
    for b in BUCKETS:
        ids = ', '.join(by[b]) if by[b] else '—'
        out.append(f'| {b} | {len(by[b])} | {ids} |')
    if unb:
        detail = '; '.join(f'{r.rid} ({r.reason})' for r in unb)
        out.append('')
        out.append(f'UNBUCKETED ({len(unb)}): {detail}')
    else:
        out.append('')
        out.append('UNBUCKETED (0): none')
    out.append('')
    out.append(END)
    return nl.join(out)


def committed_block(text: str) -> str | None:
    t = text.replace('\r\n', '\n')
    a, b = t.find(BEGIN), t.find(END)
    if a < 0 or b < 0 or b < a:
        return None
    return t[a:b + len(END)]


def check(text: str) -> tuple[bool, str]:
    want = render(parse(text))
    have = committed_block(text)
    if have is None:
        return False, 'no generated block (markers missing)'
    if have != want:
        return False, 'the committed block differs from the rows'
    return True, 'the committed block matches the rows'


def write(path: str) -> None:
    raw = open(path, 'rb').read()
    nl = '\r\n' if b'\r\n' in raw else '\n'
    text = raw.decode('utf-8')
    block = render(parse(text), nl)
    a, b = text.find(BEGIN), text.find(END)
    if a < 0 or b < 0 or b < a:
        raise SystemExit('markers missing: add the BEGIN/END lines where the block belongs first')
    new = text[:a] + block + text[b + len(END):]
    with open(path, 'wb') as fh:
        fh.write(new.encode('utf-8'))


def self_check(path: str) -> int:
    """Prove the check passes on the real ledger and FAILS on two broken copies."""
    text = open(path, 'rb').read().decode('utf-8')
    results = []
    ok, why = check(text)
    results.append(('real ledger passes', ok, why))
    # 1. one STATUS changed in a copy: the block no longer matches the rows.
    rows = parse(text)
    target = next((r for r in rows if r.bucket == 'DONE'), None)
    mutated = text
    if target is not None:
        lines = text.replace('\r\n', '\n').split('\n')
        line = lines[target.line - 1]
        lines[target.line - 1] = line.replace('DONE', 'OPEN', 1) if 'DONE' in line else line
        mutated = '\n'.join(lines)
    ok1, why1 = check(mutated)
    results.append(('one STATUS changed fails', not ok1, why1))
    # 2. the UNBUCKETED line dropped from the committed block.
    t = text.replace('\r\n', '\n')
    dropped = '\n'.join(l for l in t.split('\n') if not l.startswith('UNBUCKETED ('))
    ok2, why2 = check(dropped)
    results.append(('UNBUCKETED line dropped fails', not ok2, why2))
    # non-vacuity: both mutations really changed the text they were checked against.
    results.append(('both mutations changed the text', mutated != t and dropped != t,
                    f'status row {target.rid if target else None}; block line dropped'))
    bad = [r for r in results if not r[1]]
    for name, good, why in results:
        print(f"{'ok  ' if good else 'FAIL'} {name}: {why}")
    print('SELF-CHECK:', 'PASS' if not bad else f'FAIL ({len(bad)})')
    return 0 if not bad else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--ledger', default=DEFAULT_LEDGER)
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--check', action='store_true')
    g.add_argument('--write', action='store_true')
    g.add_argument('--self-check', action='store_true')
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check(a.ledger)
    if a.write:
        write(a.ledger)
        a.check = True
    text = open(a.ledger, 'rb').read().decode('utf-8')
    if a.check:
        ok, why = check(text)
        print(('OK: ' if ok else 'DIFFERS: ') + why)
        return 0 if ok else 1
    sys.stdout.write(render(parse(text)) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
