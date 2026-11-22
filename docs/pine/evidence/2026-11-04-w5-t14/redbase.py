"""redbase.py BASE_SHA TESTFILE... : the rails are red on the base (the merge of W5-T11 and master,
before this lane). Puts the BASE copies of the two lane files in place (from `git show BASE:path`),
runs pytest, restores byte-exact and asserts. Run from the repo root with python -B."""
import os, subprocess, sys
base = sys.argv[1]
FILES = ['api/services/screener/scan_evaluator.py', 'api/services/screener/scan_run.py']
saved = {p: open(p, 'rb').read() for p in FILES}
try:
    for p in FILES:
        b = subprocess.run(['git', 'show', f'{base}:{p}'], capture_output=True, check=True).stdout
        open(p + '.base', 'wb').write(b); os.replace(p + '.base', p)
    r = subprocess.run([sys.executable, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:warnings', *sys.argv[2:]],
                       capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    print('base rc=%d' % r.returncode)
    print('\n'.join(l for l in (r.stdout + r.stderr).splitlines() if ' passed' in l or ' failed' in l or ' error' in l)[-1500:])
finally:
    for p, b in saved.items():
        open(p + '.restore', 'wb').write(b); os.replace(p + '.restore', p)
for p, b in saved.items():
    assert open(p, 'rb').read() == b
print('restored byte-exact')
