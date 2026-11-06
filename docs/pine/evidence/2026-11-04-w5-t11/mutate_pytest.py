"""mutate_pytest.py MUTS.json TESTFILE... : the parity programme's mutate.py (same apply: `old` must
occur once; same byte-exact restore and assert), with pytest as the runner instead of vitest.

Same-length mutations can be defeated by a stale __pycache__ (the pyc check is mtime + size), so
every run is `python -B` with PYTHONDONTWRITEBYTECODE=1 and the mutated module's pyc files are
deleted before each run. Run from the repo root."""
import glob, json, os, subprocess, sys

muts = json.load(open(sys.argv[1], encoding='utf-8'))
tests = sys.argv[2:]
env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')


def drop_pyc(path):
    d, base = os.path.split(path)
    for p in glob.glob(os.path.join(d, '__pycache__', os.path.splitext(base)[0] + '.*.pyc')):
        os.remove(p)


res = []
for name, f, old, new in muts:
    saved = open(f, 'rb').read()
    s = saved.decode('utf-8')
    if s.count(old) != 1:
        res.append((name, 'BADMATCH %d' % s.count(old), [])); continue
    tmp = f + '.mut'
    open(tmp, 'wb').write(s.replace(old, new).encode('utf-8')); os.replace(tmp, f)
    try:
        drop_pyc(f)
        p = subprocess.run([sys.executable, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:warnings',
                            '-x', *tests], capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
        out = p.stdout + p.stderr
        fails = [l.strip()[:160] for l in out.splitlines() if l.startswith(('FAILED', 'ERROR'))][:3]
        res.append((name, 'KILLED' if p.returncode != 0 else 'SURVIVED', fails))
    finally:
        tmp = f + '.restore'
        open(tmp, 'wb').write(saved); os.replace(tmp, f)
        drop_pyc(f)
    assert open(f, 'rb').read() == saved
for r in res:
    print(json.dumps(r, ensure_ascii=True))
k = sum(1 for r in res if r[1] == 'KILLED')
print('TOTAL %d KILLED %d SURVIVED %d' % (len(res), k, sum(1 for r in res if r[1] == 'SURVIVED')))
