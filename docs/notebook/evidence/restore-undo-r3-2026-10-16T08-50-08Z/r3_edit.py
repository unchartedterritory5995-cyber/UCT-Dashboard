"""Exact-match edits that preserve each file's on-disk line endings.
Usage: python r3_edit.py <spec.py>   where spec defines EDITS = [(path, [(old, new), ...]), ...]
Each `old` must match exactly once (after CRLF->LF normalisation).
"""
import runpy
import sys
from pathlib import Path


def apply(path, pairs):
    p = Path(path)
    raw = p.read_bytes()
    crlf = b'\r\n' in raw
    s = raw.decode('utf-8').replace('\r\n', '\n')
    assert '\r' not in s, f'{path}: stray CR'
    for old, new in pairs:
        n = s.count(old)
        assert n == 1, (path, n, old[:100])
        s = s.replace(old, new)
    if crlf:
        s = s.replace('\n', '\r\n')
    p.write_bytes(s.encode('utf-8'))
    print('edited', path, 'crlf' if crlf else 'lf')


if __name__ == '__main__':
    spec = runpy.run_path(sys.argv[1])
    for path, pairs in spec['EDITS']:
        apply(path, pairs)
