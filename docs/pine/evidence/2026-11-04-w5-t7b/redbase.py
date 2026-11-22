"""W5-T7b red-on-base proof: write the BASE (f526d609e4) bytes of this lane's production files over
the tip, run the lane's rails (tip test files), then restore the tip bytes byte-exact and assert.
Never git checkout/stash/reset. Run from the repo root.
Usage: python redbase.py"""
import os, subprocess, sys
BASE = 'f526d609e4'
FILES = ['services/pine_runtime/protocol.mjs', 'services/pine_runtime/server.mjs', 'services/pine_runtime/job.mjs',
         'services/pine_runtime/sandbox.mjs', 'app/src/components/chart/engine/runtime/serverEntry.js']
RUNS = [
    ('node seal+result', ['node', '--test', '--test-force-exit', '--test-concurrency=1', '--test-timeout=200000',
                          'services/pine_runtime/test/seal.test.mjs', 'services/pine_runtime/test/result.test.mjs'], '.'),
    ('pytest e2e', [sys.executable, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:warnings',
                    'tests/test_pine_runtime_result_integrity.py'], '.'),
    ('vitest serverBundle.rail', ['node', 'node_modules/vitest/vitest.mjs', 'run',
                                  'src/components/chart/engine/runtime/__tests__/serverBundle.rail.test.js', '--maxWorkers=2'], 'app'),
]
saved = {f: open(f, 'rb').read() for f in FILES}
try:
    for f in FILES:
        base = subprocess.run(['git', 'show', f'{BASE}:{f}'], capture_output=True, check=True).stdout
        if b'\r\n' in saved[f] and b'\r\n' not in base:
            base = base.replace(b'\n', b'\r\n')
        with open(f + '.base', 'wb') as fh:
            fh.write(base)
        os.replace(f + '.base', f)
    for label, cmd, cwd in RUNS:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        out = p.stdout + p.stderr
        keep = [l for l in out.splitlines() if l.startswith(('\u2139 pass', '\u2139 fail', '\u2716 ', 'FAILED', 'ERROR'))
                or ' passed' in l or ' failed' in l or 'Tests ' in l or ' \u00d7 ' in l][:40]
        print(f'BASE {label} rc={p.returncode}')
        for l in keep:
            print('  ' + l.strip()[:200].encode('ascii', 'backslashreplace').decode('ascii'))
finally:
    for f in FILES:
        with open(f + '.restore', 'wb') as fh:
            fh.write(saved[f])
        os.replace(f + '.restore', f)
    for f in FILES:
        assert open(f, 'rb').read() == saved[f], f
    print('RESTORED byte-exact')
print('REDBASE_DONE')
