"""mutate.py MUTS.json TESTFILE... : for each [name, file, old, new] apply (old must occur once),
run vitest on the test files, record pass/fail, restore the saved bytes. Run from app/."""
import sys, json, subprocess, os
muts = json.load(open(sys.argv[1], encoding='utf-8'))
tests = sys.argv[2:]
res = []
for name, f, old, new in muts:
    saved = open(f, 'rb').read()
    s = saved.decode('utf-8')
    oldn = old.replace('\n', '\r\n') if '\r\n' in s else old
    newn = new.replace('\n', '\r\n') if '\r\n' in s else new
    if s.count(oldn) != 1:
        res.append((name, 'BADMATCH %d' % s.count(oldn))); continue
    tmp = f + '.mut'
    open(tmp, 'wb').write(s.replace(oldn, newn).encode('utf-8')); os.replace(tmp, f)
    try:
        p = subprocess.run(['node', 'node_modules/vitest/vitest.mjs', 'run', *tests, '--maxWorkers=2'],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        out = p.stdout + p.stderr
        fails = [l.strip() for l in out.splitlines() if ('FAIL' in l or '×' in l) and 'Test Files' not in l][:4]
        res.append((name, 'KILLED' if p.returncode != 0 else 'SURVIVED', fails))
    finally:
        tmp = f + '.restore'
        open(tmp, 'wb').write(saved); os.replace(tmp, f)
    assert open(f, 'rb').read() == saved
for r in res: print(json.dumps(r, ensure_ascii=True))
