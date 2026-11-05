"""W5-T7 red-on-base proof, byte-exact restore. Base 94b46f55b1 (W5-T6's tip) has no pool.mjs, job.mjs or
sandbox.mjs, its server.mjs has no pool wiring, and its serverEntry.js lacks the five re-exports the
adapter reads. Each part puts the base state in place, runs THIS branch's rails, and restores.
Run from the repo root."""
import os, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8')
BASE = '94b46f55b1'
T = 'services/pine_runtime/test/'
MINE = [T + f for f in ('job.test.mjs', 'adapter.test.mjs', 'pool.test.mjs', 'sandbox.test.mjs', 'hostile.test.mjs')]
NODE = ['node', '--test', '--test-force-exit', '--test-concurrency=2', '--test-timeout=120000']


def node(files):
    p = subprocess.run(NODE + files, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = p.stdout + p.stderr
    keep = [l for l in out.splitlines() if l.startswith(('ℹ tests', 'ℹ pass', 'ℹ fail'))]
    crosses = sorted({l[2:].rsplit(' (', 1)[0] for l in p.stdout.splitlines() if l.startswith('✖ ') and 'failing tests' not in l})
    return p.returncode, keep, crosses, [l for l in out.splitlines() if 'Cannot find module' in l][:3]


def at_base(path):
    cur = open(path, 'rb').read()
    base = subprocess.run(['git', 'show', BASE + ':' + path], capture_output=True).stdout
    assert base and base != cur, path
    if b'\r\n' in cur and b'\r\n' not in base:
        base = base.replace(b'\n', b'\r\n')
    return cur, base


def put(path, data):
    open(path + '.tmp', 'wb').write(data)
    os.replace(path + '.tmp', path)


# 1. the three modules absent, as on base
mods = ['services/pine_runtime/' + m for m in ('job.mjs', 'pool.mjs', 'sandbox.mjs')]
saved = {f: open(f, 'rb').read() for f in mods}
try:
    for f in mods: os.replace(f, f + '.aside')
    rc, keep, crosses, missing = node(MINE)
    print('BASE-MODULES rc=%d' % rc); print('\n'.join(keep + missing))
finally:
    for f in mods: os.replace(f + '.aside', f)
    assert all(open(f, 'rb').read() == saved[f] for f in mods)

# 2. server.mjs at base bytes (no pool wiring)
S = 'services/pine_runtime/server.mjs'
cur, base = at_base(S)
try:
    put(S, base)
    rc, keep, crosses, missing = node([T + 'hostile.test.mjs'])
    print('BASE-SERVER hostile.test rc=%d' % rc); print('\n'.join(keep)); print('\n'.join('  red: ' + c for c in crosses))
finally:
    put(S, cur); assert open(S, 'rb').read() == cur

# 3. serverEntry.js at base bytes (no adapter re-exports)
E = 'app/src/components/chart/engine/runtime/serverEntry.js'
cur, base = at_base(E)
try:
    put(E, base)
    rc, keep, crosses, missing = node([T + 'hostile.test.mjs', T + 'sandbox.test.mjs'])
    print('BASE-ENTRY hostile+sandbox rc=%d' % rc); print('\n'.join(keep)); print('\n'.join('  red: ' + c for c in crosses))
    p = subprocess.run(['node', 'node_modules/vitest/vitest.mjs', 'run', 'src/components/chart/engine/runtime/__tests__/serverBundle.rail.test.js', '--maxWorkers=2'],
                       cwd='app', capture_output=True, text=True, encoding='utf-8', errors='replace')
    print('BASE-ENTRY serverBundle.rail rc=%d' % p.returncode)
    print('\n'.join(l for l in (p.stdout + p.stderr).splitlines() if ('Tests ' in l or '×' in l))[:1500])
finally:
    put(E, cur); assert open(E, 'rb').read() == cur
print('REDBASE_DONE')
