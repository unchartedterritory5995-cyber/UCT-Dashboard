"""Red-on-base proof: base 94b46f55b1 has no cache.mjs. Moves it aside, runs the rail, restores byte-exact."""
import os, subprocess
f = 'services/pine_runtime/cache.mjs'
saved = open(f, 'rb').read()
try:
    os.replace(f, f + '.aside')
    p = subprocess.run(['node', '--test', '--test-force-exit', 'services/pine_runtime/test/cache.test.mjs'], capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = p.stdout + p.stderr
    print('BASE rc=%d' % p.returncode)
    print('\n'.join(l for l in out.splitlines() if l.startswith(('ℹ tests', 'ℹ pass', 'ℹ fail')) or 'ERR_MODULE_NOT_FOUND' in l or 'Cannot find module' in l)[:1500])
finally:
    os.replace(f + '.aside', f)
    assert open(f, 'rb').read() == saved
