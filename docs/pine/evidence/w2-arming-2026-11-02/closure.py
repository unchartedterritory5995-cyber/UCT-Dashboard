#!/usr/bin/env python3
"""closure.py : which files that master changed sit on the Pine runtime lane's import path?

W2 arming packet (2026-11-02), sections 10 and 11. The second merge of origin/master brought 205
files. This answers, from the committed tree and git alone (no test run, no heavy job):

  1. for each entry set below, the size of its forward import closure and which of the changed
     files fall inside it (an over-approximation: an import is not an execution);
  2. for the runtime lane's own entry points, the SHORTEST import chain to each changed file that
     is reachable, which shows how far the lane is from it.

Imports are read with regexes (static, dynamic, `export ... from`, `new URL(.., import.meta.url)`,
`require`); `@/` resolves to app/src; bare packages are not followed.

    python docs/pine/evidence/w2-arming-2026-11-02/closure.py --base 67a6dada10 --head HEAD
"""
import argparse
import collections
import os
import re
import subprocess
import sys

RX = [
    re.compile(r"""(?:^|[^\w.])import\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]""", re.M),
    re.compile(r"""export\s+[^'"();]*?\s+from\s+['"]([^'"]+)['"]"""),
    re.compile(r"""import\(\s*['"]([^'"]+)['"]\s*\)"""),
    re.compile(r"""new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url"""),
    re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)"""),
]
EXTS = ['', '.js', '.jsx', '.mjs', '.json', '.ts', '.tsx', '/index.js', '/index.jsx', '/index.mjs']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--head', default='HEAD')
    ap.add_argument('--repo', default=None)
    a = ap.parse_args()
    repo = os.path.abspath(a.repo or subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
    src = os.path.join(repo, 'app', 'src')
    out = subprocess.check_output(['git', '-C', repo, 'diff', '--name-only', a.base, a.head], text=True)
    changed = set(l.strip() for l in out.splitlines() if l.strip())
    if not changed:
        sys.exit('no changed files between %s and %s: refusing to report an empty intersection as a result' % (a.base, a.head))
    rel = lambda p: os.path.relpath(p, repo).replace(os.sep, '/')
    cache = {}

    def resolve(frm, spec):
        if spec.startswith('@/'):
            base = os.path.join(src, spec[2:])
        elif spec.startswith('.'):
            base = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
        else:
            return None
        for e in EXTS:
            if os.path.isfile(base + e):
                return base + e
        return None

    def deps(path):
        if path in cache:
            return cache[path]
        try:
            text = open(path, encoding='utf-8', errors='replace').read()
        except OSError:
            text = ''
        res = []
        for rx in RX:
            for m in rx.finditer(text):
                r = resolve(path, m.group(1))
                if r:
                    res.append(r)
        cache[path] = res
        return res

    def bfs(entries):
        par = {}
        q = collections.deque()
        for e in entries:
            if os.path.isfile(e):
                par[e] = None
                q.append(e)
        while q:
            p = q.popleft()
            for d in deps(p):
                if d not in par:
                    par[d] = p
                    q.append(d)
        return par

    eng = os.path.join(src, 'components', 'chart', 'engine')
    vh = os.path.join(eng, '__tests__', 'vendorHarness')
    lane = {
        'runtime worker (runtime/runtimeWorker.js)': [os.path.join(eng, 'runtime', 'runtimeWorker.js')],
        'main-thread door (nativeRegistry.js, runtimeKill.js, runtimePaneGate.js, runtime/runtimeColumns.js, runtime/runtimeAsync.js)': [
            os.path.join(eng, 'nativeRegistry.js'), os.path.join(eng, 'runtimeKill.js'), os.path.join(eng, 'runtimePaneGate.js'),
            os.path.join(eng, 'runtime', 'runtimeColumns.js'), os.path.join(eng, 'runtime', 'runtimeAsync.js')],
        'permission latch (lib/runtimePanePermission.js)': [os.path.join(src, 'lib', 'runtimePanePermission.js')],
    }
    wide = {
        'vendor harness (vendorHarness.corpus.test.js, runtimeAllowlistParity.test.js, harness.js, ourSide.js)': [
            os.path.join(vh, 'vendorHarness.corpus.test.js'), os.path.join(vh, 'runtimeAllowlistParity.test.js'),
            os.path.join(vh, 'harness.js'), os.path.join(vh, 'ourSide.js')],
        'member door (builder/memberPane/memberPaneDefinition.js)': [
            os.path.join(src, 'components', 'chart', 'builder', 'memberPane', 'memberPaneDefinition.js')],
    }
    print('changed files between %s and %s: %d (%d under app/src)' % (a.base, a.head, len(changed), sum(1 for c in changed if c.startswith('app/src/'))))
    print()
    for title, sets in (('A. the lane proper', lane), ('B. the wide test and builder surface (an import is not an execution)', wide)):
        print('== %s' % title)
        for name, ents in sets.items():
            par = bfs(ents)
            hit = sorted(rel(p) for p in par if rel(p) in changed)
            print('  %s' % name)
            print('    entries found %d of %d | closure %d files | changed files inside it: %d' % (
                sum(1 for e in ents if os.path.isfile(e)), len(ents), len(par), len(hit)))
            for h in hit:
                chain, x = [], os.path.join(repo, h.replace('/', os.sep))
                while x:
                    chain.append(os.path.basename(x))
                    x = par[x]
                print('      %s  (depth %d: %s)' % (h, len(chain) - 1, ' < '.join(chain[:6])))
        print()


if __name__ == '__main__':
    main()
