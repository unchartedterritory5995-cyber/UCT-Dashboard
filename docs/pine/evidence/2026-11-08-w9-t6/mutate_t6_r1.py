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
    ('control-comment', RT + 'broker.js', "  let tickPx = null\n", "  let tickPx = null // mutant control\n", VT),
    ('drop-B-FILLS-ask (the one site)', RT + 'broker.js', "    rule('B-FILLS')\n    return true", "    return true", VT),
    ('X7 drop the realtime refusal', RT + 'vm.js', "  if (brokerReruns && realtime) {", "  if (false && realtime) {", VT),
    ('fill-limits accepted again', AST + 'strategyBroker.js', "case 'backtest_fill_limits_assumption': need(key, n === 0,", "case 'backtest_fill_limits_assumption': need(key, true,", VT),
    ('poc-endBar-off', RT + 'broker.js', "    if (!poc) return false\n    const c = C[bar]", "    return false\n    const c = C[bar]", VT),
    ('drop-B-POC-ask', RT + 'broker.js', "      if (atClose) fillRule = m.immediate ? 'B-POC-PRICE' : 'B-POC'", "      if (atClose) fillRule = m.immediate ? 'B-POC-PRICE' : 'B-MARKET'", VT),
    ('drop-B-POC-PRICE-ask', RT + 'broker.js', "      fillRule = atClose ? 'B-POC-PRICE' : 'B-GAP'", "      fillRule = 'B-GAP'", VT),
    ('vm-no-rollback', RT + 'vm.js', "        restoreBar(barSnap)\n", "", VT),
    ('X4 close attempt skips extra-execution orders: n/a (no stamp exists; equivalent, see EVIDENCE)', None, None, None, None),
    ('resolver-J1-precondition-off', 'tools/vendor_harness/evidence_engine.py', "                if not j1_readback_ok(r, names):", "                if False:", PY),
    ('resolver-J1-any-row', 'tools/vendor_harness/evidence_engine.py', '            if v == "MATCH" and _is_queue_row(r, J1_QUEUE_ROW):', '            if v == "MATCH":', PY),
    ('resolver-J1-one-default-dropped', 'tools/vendor_harness/evidence_engine.py', '    "use_bar_magnifier": False,              # bar detalization: off\n', '', PY),
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
