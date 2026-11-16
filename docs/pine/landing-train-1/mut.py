"""TRAIN-1 scratch: generic copy-aside mutant runner (run INSIDE the heavy lock).
usage: mut.py SPEC.json OUT.json   SPEC = {"rail": [vitest files relative to app/], "mutants": [{"id","file","edits":[[a,b],...],"what"}]}
Control first; every anchor must occur exactly once; restore from the copy; `git hash-object` == HEAD blob."""
import json, os, shutil, subprocess, sys, time
W = r'C:\Users\Patrick\uct-worktrees\train-1'
APP = os.path.join(W, 'app')
spec = json.load(open(sys.argv[1], encoding='utf-8'))
out_path = sys.argv[2]
logdir = os.path.splitext(out_path)[0] + '-logs'
os.makedirs(logdir, exist_ok=True)
PY = 'pytest' in spec
RAIL = ([sys.executable, '-m', 'pytest', *spec['pytest'], '-q', '-p', 'no:cacheprovider'] if PY
        else ['node', 'node_modules/vitest/vitest.mjs', 'run', *spec['rail'], '--maxWorkers=2'])
CR, LF = chr(13), chr(10)


def blob_ok(p):
    a = subprocess.run(['git', '-C', W, 'hash-object', p], capture_output=True, text=True).stdout.strip()
    b = subprocess.run(['git', '-C', W, 'rev-parse', 'HEAD:' + p], capture_output=True, text=True).stdout.strip()
    return a == b and len(a) == 40


def rail(log):
    with open(log, 'w', encoding='utf-8', errors='replace') as fh:
        rc = subprocess.run(RAIL, cwd=(W if PY else APP), env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'), stdout=fh, stderr=subprocess.STDOUT).returncode
    tail = [l for l in open(log, encoding='utf-8', errors='replace').read().splitlines() if ('Tests ' in l or ' passed' in l or ' failed' in l)]
    return rc, (tail[-1].strip() if tail else 'NO TOTALS LINE')


res = {}
for m in spec['mutants']:
    if not blob_ok(m['file']):
        print('STOP: not at HEAD before starting:', m['file']); sys.exit(2)
rc, tot = rail(os.path.join(logdir, 'control.log'))
res['C0'] = {'rc': rc, 'totals': tot}
print('C0 rc=%d %s' % (rc, tot), flush=True)
if rc != 0:
    json.dump(res, open(out_path, 'w'), indent=1); print('STOP: the control is not green'); sys.exit(3)
for m in spec['mutants']:
    full = os.path.join(W, m['file'])
    orig = open(full, encoding='utf-8', newline='').read()
    crlf = (CR + LF) in orig
    s = orig.replace(CR + LF, LF)
    counts = [s.count(a) for a, _ in m['edits']]
    if any(c != 1 for c in counts):
        res[m['id']] = {'error': 'anchor count', 'counts': counts}; print(m['id'], 'ANCHOR PROBLEM', counts, flush=True); continue
    for a, b in m['edits']:
        s = s.replace(a, b)
    if crlf:
        s = s.replace(LF, CR + LF)
    aside = os.path.join(logdir, m['id'] + '.orig')
    shutil.copy2(full, aside)
    try:
        with open(full, 'w', encoding='utf-8', newline='') as fh:
            fh.write(s)
        now = time.time() + 3
        os.utime(full, (now, now))
        rc, tot = rail(os.path.join(logdir, m['id'] + '.log'))
    finally:
        shutil.copyfile(aside, full)
    ok = blob_ok(m['file'])
    res[m['id']] = {'what': m.get('what'), 'rc': rc, 'totals': tot, 'verdict': 'KILLED' if rc != 0 else 'SURVIVED', 'restoredEqualsHead': ok}
    print(m['id'], res[m['id']]['verdict'], tot, 'restored==HEAD', ok, flush=True)
    json.dump(res, open(out_path, 'w'), indent=1)
    if not ok:
        print('STOP: restore != HEAD', m['file']); sys.exit(4)
json.dump(res, open(out_path, 'w'), indent=1)
