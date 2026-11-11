"""mutate_pytest.py MUTS.json TESTFILE... : apply each [name, file, old, new] (old must occur once;
CRLF-aware), run pytest -x, record KILLED/SURVIVED, restore byte-exact and assert it. -B plus pyc
deletion defeat the stale-pyc same-length trap. Run from the repo root."""
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
    crlf = '\r\n' in s
    o = old.replace('\n', '\r\n') if crlf else old
    n = new.replace('\n', '\r\n') if crlf else new
    if s.count(o) != 1:
        res.append((name, 'BADMATCH %d' % s.count(o), [])); continue
    tmp = f + '.mut'
    open(tmp, 'wb').write(s.replace(o, n).encode('utf-8')); os.replace(tmp, f)
    try:
        drop_pyc(f)
        p = subprocess.run([sys.executable, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:warnings',
                            '-x', *tests], capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
        out = p.stdout + p.stderr
        fails = [l.strip()[:150] for l in out.splitlines() if l.startswith(('FAILED', 'ERROR'))][:2]
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
