"""W9-T6 r1 hand mutants: copy aside, ONE replacement (must match once), run the rail, restore, assert bytes.
Never git checkout."""
import hashlib, json, os, shutil, subprocess, sys

REPO = r'C:/Users/Patrick/uct-worktrees/pine-dsk-w9t6'
APP = REPO + '/app'
RT = 'app/src/components/chart/engine/runtime/'
AST = 'app/src/components/chart/engine/ast/'
VT = f'source C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/node20.sh && cd {APP} && npx vitest run src/components/chart/engine/runtime/__tests__/w9T6FillTiming.test.js --maxWorkers=1'
PY = f'cd {REPO} && python -m pytest tests/test_broker_pins_resolve.py -q -x'
OUT = sys.argv[1]

MUTS = [
    ('control-comment-merge', RT + 'broker.js', "  let tickPx = null\n", "  let tickPx = null // mutant control\n", VT),
    ('T4xT6 tickPx sizing refusal off', RT + 'broker.js', "    if (tickPx !== null) {\n      throw new BrokerRefusal(`the entry", "    if (false) {\n      throw new BrokerRefusal(`the entry", VT),
]


def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


results = []
for name, rel, old, new, cmd in MUTS:
    if rel is None:
        results.append({'mutant': name, 'verdict': 'NOT RUN'})
        continue
    path = os.path.join(REPO, rel)
    bak = path + '.mutbak'
    before = sha(path)
    shutil.copyfile(path, bak)
    try:
        src = open(path, encoding='utf-8', newline='').read()
        n = src.count(old)
        if n != 1:
            results.append({'mutant': name, 'verdict': f'BADMATCH ({n})'})
            continue
        open(path, 'w', encoding='utf-8', newline='').write(src.replace(old, new))
        r = subprocess.run(['bash', '-lc', cmd], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
        results.append({'mutant': name, 'file': rel, 'verdict': 'KILLED' if r.returncode != 0 else 'SURVIVED'})
    finally:
        shutil.copyfile(bak, path)
        os.remove(bak)
        assert sha(path) == before, f'{name}: restore mismatch'
    print(results[-1], flush=True)
json.dump(results, open(OUT, 'w'), indent=1)
