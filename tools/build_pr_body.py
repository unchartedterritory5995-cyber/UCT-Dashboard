# -*- coding: utf-8 -*-
"""R31 — the ONE place that knows how `PR-BODY-COMBINED.md` is built.

`docs/pine/PR-BODY-COMBINED.md` is what gets pasted into PR #145. It is a
GENERATED file: the concatenation of three part-files, in order.

    PR-BODY-HEADER.md   the two-waves preamble and its `---`
    PR-BODY.md          Wave 1
    PR-BODY-WAVE2.md    Wave 2

⛔⛔ THE RECIPE LIVES HERE AND NOWHERE ELSE. `tests/test_pr_body_is_generated.py`
IMPORTS this module rather than restating the order or the part list, and a human
regenerating the file calls `--write`. A rail carrying its own copy of the recipe
would agree with itself while the artifact drifted — which is precisely the defect
R31 closes, not a second instance of it.

⚰️ THE INCIDENT. `PR-BODY-WAVE2.md` was updated when j.1 landed and the combined
file was never regenerated, so PR #145 described item (j) as *"scoped only, 11 gaps
with file:line"* through BOTH j.1 and j.2. Nothing detected it: the source of truth
was correct the entire time, the generated file was stale, and no check compared the
two. It was found only by rebuilding the file and diffing — which is now the rail.

⭐ THE HEADER IS A PART-FILE, NOT A LITERAL IN THIS SCRIPT, and that is load-bearing.
It used to exist ONLY inside the generated file, which made "rebuild it" circular:
the only way to obtain the header was to read the artifact you were trying to
verify. A build that reads its own output cannot detect drift in it.

⛔ BYTES, NEVER TEXT. The parts are read and joined as bytes so line endings survive
untouched. These files are stored LF and GitHub keeps them LF; decoding to `str` and
re-encoding is how a 51 KB body turns into a whole-file diff (see R-2).

Usage:
    python tools/build_pr_body.py --check    # exit 0 if the artifact is current
    python tools/build_pr_body.py --write    # regenerate it
    python tools/build_pr_body.py --self-check
"""
from __future__ import annotations

import argparse
import hashlib
import io
import os
import sys

DOCS = os.path.join('docs', 'pine')

#: The parts, IN ORDER. This tuple is the recipe.
PARTS = (
    'PR-BODY-HEADER.md',
    'PR-BODY.md',
    'PR-BODY-WAVE2.md',
)

#: What the recipe produces.
COMBINED = 'PR-BODY-COMBINED.md'


def repo_root(start=None):
    """The worktree root, found by walking up to the directory holding `docs/pine`."""
    here = os.path.abspath(start or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    while True:
        if os.path.isdir(os.path.join(here, DOCS)):
            return here
        nxt = os.path.dirname(here)
        if nxt == here:
            raise RuntimeError('no repo root above %r (looked for %s)' % (start, DOCS))
        here = nxt


def part_paths(root):
    return [os.path.join(root, DOCS, name) for name in PARTS]


def combined_path(root):
    return os.path.join(root, DOCS, COMBINED)


def build(root):
    """The three parts, concatenated, as BYTES.

    ⛔ Raises if a part is missing. A build that quietly skips an absent part would
    produce a shorter file that still *looks* like a body, and the comparison against
    it would pass for the wrong reason.
    """
    out = bytearray()
    for path in part_paths(root):
        if not os.path.isfile(path):
            raise RuntimeError('missing part: %s' % path)
        with io.open(path, 'rb') as fh:
            out += fh.read()
    return bytes(out)


def current(root):
    """The committed artifact, as BYTES, or None when it does not exist."""
    path = combined_path(root)
    if not os.path.isfile(path):
        return None
    with io.open(path, 'rb') as fh:
        return fh.read()


def check(root):
    """`(rc, message)` — 0 when the artifact equals the rebuild."""
    built = build(root)
    have = current(root)
    if have is None:
        return 1, '%s does not exist; run --write' % COMBINED
    if have == built:
        return 0, '%s is current (%d bytes, sha256 %s)' % (
            COMBINED, len(built), hashlib.sha256(built).hexdigest())
    return 1, (
        '%s is STALE — it is not what its parts produce.\n'
        '  committed : %d bytes, sha256 %s\n'
        '  rebuilt   : %d bytes, sha256 %s\n'
        '  parts     : %s\n'
        'Regenerate with:  python tools/build_pr_body.py --write'
    ) % (
        COMBINED,
        len(have), hashlib.sha256(have).hexdigest(),
        len(built), hashlib.sha256(built).hexdigest(),
        ' + '.join(PARTS),
    )


def write(root):
    """Regenerate the artifact atomically. Returns `(bytes_written, sha256)`."""
    built = build(root)
    dest = combined_path(root)
    tmp = dest + '.tmp'
    with io.open(tmp, 'wb') as fh:
        fh.write(built)
    os.replace(tmp, dest)
    return len(built), hashlib.sha256(built).hexdigest()


def self_check(root):
    """⛔ PROVE THE CHECK CAN FAIL. A gate nobody has seen fail is not a gate."""
    built = build(root)
    if not built:
        return 1, 'self-check: the rebuild is EMPTY, so nothing below means anything'
    rc, _ = check(root)
    if rc != 0:
        return 1, 'self-check: the artifact is already stale; fix that first'
    # A one-byte difference must be reported as stale.
    dest = combined_path(root)
    original = current(root)
    try:
        with io.open(dest, 'wb') as fh:
            fh.write(original + b'x')
        rc_after, msg = check(root)
    finally:
        with io.open(dest, 'wb') as fh:
            fh.write(original)
    if rc_after == 0:
        return 1, 'self-check FAILED: a planted byte was not reported as stale'
    if current(root) != original:
        return 1, 'self-check FAILED: the artifact was not restored'
    return 0, 'self-check: a planted byte is reported STALE, and the file is restored'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--root', default=None)
    ap.add_argument('--write', action='store_true', help='regenerate the combined file')
    ap.add_argument('--check', action='store_true', help='exit 1 if it is stale')
    ap.add_argument('--self-check', dest='selfcheck', action='store_true')
    args = ap.parse_args(argv)
    root = repo_root(args.root)
    if args.selfcheck:
        rc, msg = self_check(root)
        print(msg)
        return rc
    if args.write:
        n, sha = write(root)
        print('wrote %s — %d bytes, sha256 %s' % (COMBINED, n, sha))
        return 0
    rc, msg = check(root)
    print(msg)
    return rc


if __name__ == '__main__':
    sys.exit(main())
