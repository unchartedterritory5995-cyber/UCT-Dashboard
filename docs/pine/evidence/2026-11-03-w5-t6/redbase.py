"""Red-on-base proof, byte-exact restore. Base caa9d246f4 has no services/pine_runtime modules and
the T1 serverEntry without NATIVE_TFS / DEFAULT_LIMITS. Run from the repo root."""
import os, subprocess, sys
W = os.getcwd()
mods = ['services/pine_runtime/auth.mjs', 'services/pine_runtime/protocol.mjs', 'services/pine_runtime/server.mjs']
tests = sorted('services/pine_runtime/test/' + f for f in os.listdir('services/pine_runtime/test') if f.endswith('.test.mjs'))
saved = {f: open(f, 'rb').read() for f in mods}
try:
    for f in mods: os.replace(f, f + '.aside')
    p = subprocess.run(['node', '--test', '--test-force-exit', *tests], capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = p.stdout + p.stderr
    print('BASE-MODULES node --test rc=%d' % p.returncode)
    print('\n'.join([l for l in out.splitlines() if l.startswith(('ℹ tests', 'ℹ pass', 'ℹ fail')) or 'Cannot find module' in l][:12]))
finally:
    for f in mods: os.replace(f + '.aside', f)
    assert all(open(f, 'rb').read() == saved[f] for f in mods)
E = 'app/src/components/chart/engine/runtime/serverEntry.js'
cur = open(E, 'rb').read()
base = subprocess.run(['git', 'show', 'caa9d246f4:' + E], capture_output=True).stdout
assert base and base != cur
try:
    open(E + '.tmp', 'wb').write(base.replace(b'\n', b'\r\n') if b'\r\n' in cur and b'\r\n' not in base else base); os.replace(E + '.tmp', E)
    p = subprocess.run(['node', 'node_modules/vitest/vitest.mjs', 'run', 'src/components/chart/engine/runtime/__tests__/serverBundle.rail.test.js', '--maxWorkers=2'],
                       cwd='app', capture_output=True, text=True, encoding='utf-8', errors='replace')
    print('BASE-ENTRY serverBundle.rail rc=%d' % p.returncode)
    print('\n'.join(l for l in (p.stdout + p.stderr).splitlines() if ('Tests' in l or '×' in l or 'FAIL' in l))[:1500])
    p = subprocess.run(['node', '--test', '--test-force-exit', 'services/pine_runtime/test/bundle.test.mjs'], capture_output=True, text=True, encoding='utf-8', errors='replace')
    print('BASE-ENTRY bundle.test rc=%d' % p.returncode)
    print('\n'.join(l for l in (p.stdout + p.stderr).splitlines() if l.startswith(('ℹ pass', 'ℹ fail', '✖')))[:800])
finally:
    open(E + '.tmp', 'wb').write(cur); os.replace(E + '.tmp', E)
    assert open(E, 'rb').read() == cur
print('REDBASE_DONE')
