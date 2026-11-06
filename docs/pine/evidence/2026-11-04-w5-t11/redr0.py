"""redr0.py REF TEST... : the r1 rails are red on the r0 tip REF (86218da704). Writes REF's bytes of
the client, the lane and the fake in place (byte-exact restore + assert after), runs pytest -k r1 (or -k $RED_K)."""
import os, subprocess, sys
REF = sys.argv[1]
FILES = ['api/services/pine_runtime_client.py', 'api/services/runtime_server_lane.py', 'tests/fakes/pine_runtime_fake.py']
saved = {p: open(p, 'rb').read() for p in FILES}
try:
    for p in FILES:
        old = subprocess.check_output(['git', 'show', f'{REF}:{p}'])
        open(p + '.r0', 'wb').write(old); os.replace(p + '.r0', p)
    r = subprocess.run([sys.executable, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:warnings',
                        '-k', os.environ.get('RED_K', 'r1'), *sys.argv[2:]], capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    print('r0 rc=%d' % r.returncode)
    print('\n'.join(l for l in (r.stdout + r.stderr).splitlines() if l.startswith(('FAILED', 'ERROR')) or ' passed' in l or ' failed' in l))
finally:
    for p, b in saved.items():
        open(p + '.restore', 'wb').write(b); os.replace(p + '.restore', p)
for p, b in saved.items():
    assert open(p, 'rb').read() == b
print('restored byte-exact')
