"""redbase.py TESTFILE... : the rails are red on the base (W5-T3 tip 409456ee36), where the three
new modules do not exist. Moves them aside (byte-exact), runs pytest, restores and asserts."""
import os, subprocess, sys
NEW = ['api/services/pine_runtime_client.py', 'api/services/runtime_server_lane.py', 'tests/fakes/pine_runtime_fake.py']
saved = {p: open(p, 'rb').read() for p in NEW}
try:
    for p in NEW:
        os.remove(p)
    r = subprocess.run([sys.executable, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:warnings', *sys.argv[1:]],
                       capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    print('base rc=%d' % r.returncode)
    print('\n'.join(l for l in (r.stdout + r.stderr).splitlines() if l.startswith(('ERROR', 'FAILED')) or 'error' in l.lower()[:20] or ' passed' in l or ' failed' in l or ' error' in l)[-2000:])
finally:
    for p, b in saved.items():
        open(p + '.restore', 'wb').write(b); os.replace(p + '.restore', p)
for p, b in saved.items():
    assert open(p, 'rb').read() == b
print('restored byte-exact')
