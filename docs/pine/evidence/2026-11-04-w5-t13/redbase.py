"""redbase.py BASE_SHA TESTFILE... : the rails are red on the base. Writes the base's bytes of every
code file this lane changes (`git show BASE:path`; the test files stay the tip's), runs pytest with
-rf, restores the tip's saved bytes and asserts them byte-exact. No checkout, stash or reset."""
import os, subprocess, sys

CODE = ['api/services/alert_user_series.py', 'api/services/indicator_alert_evaluator.py',
        'api/services/indicator_alert_service.py', 'api/services/alert_shadow_log.py',
        'api/routers/indicator_alerts.py']
base = sys.argv[1]
saved = {p: open(p, 'rb').read() for p in CODE}
try:
    for p in CODE:
        b = subprocess.run(['git', 'show', f'{base}:{p}'], capture_output=True, check=True).stdout
        b = b.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')     # the checkout's CRLF
        open(p + '.base', 'wb').write(b); os.replace(p + '.base', p)
    r = subprocess.run([sys.executable, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:warnings',
                        '-rf', *sys.argv[2:]], capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    print('base rc=%d' % r.returncode)
    print('\n'.join(l for l in (r.stdout + r.stderr).splitlines()
                    if l.startswith(('ERROR', 'FAILED')) or ' passed' in l or ' failed' in l))
finally:
    for p, b in saved.items():
        open(p + '.restore', 'wb').write(b); os.replace(p + '.restore', p)
for p, b in saved.items():
    assert open(p, 'rb').read() == b
print('restored byte-exact')
