"""W9-T6 hand mutants: copy the file aside, apply ONE replacement (must match exactly once), run the T6 rail,
restore from the copy and assert the bytes are back. Never git checkout."""
import hashlib, json, os, shutil, subprocess, sys

ROOT = r'C:/Users/Patrick/uct-worktrees/pine-dsk-w9t6/app'
RT = 'src/components/chart/engine/runtime/'
AST = 'src/components/chart/engine/ast/'
TEST = RT + '__tests__/w9T6FillTiming.test.js'
OUT = sys.argv[1]

MUTS = [
    ('control-comment', RT + 'broker.js', "  let tickPx = null\n", "  let tickPx = null // mutant control\n"),
    ('poc-endBar-off', RT + 'broker.js', "    if (!poc) return false\n    const c = C[bar]", "    return false\n    const c = C[bar]"),
    ('poc-declaration-ignored', AST + 'strategyBroker.js', "cfg.processOrdersOnClose = n === 1", "cfg.processOrdersOnClose = false"),
    ('drop-B-POC-ask-markets', RT + 'broker.js', "      if (atClose) rule('B-POC')\n      rule(fillRule)\n      if (m.immediate && !atClose)", "      rule(fillRule)\n      if (m.immediate && !atClose)"),
    ('drop-B-POC-PYR-ask', RT + 'broker.js', "if (atClose && open.length && open[0].dir === m.dir) rule('B-POC-PYR')", "if (false) rule('B-POC-PYR')"),
    ('drop-B-POC-FILLS-rerun', RT + 'broker.js', "    if (coof) { rule('B-POC-FILLS'); return true }", "    if (coof) { rule('B-POC-FILLS'); return false }"),
    ('drop-B-J1-ask', RT + 'broker.js', "      rule('B-J1')\n", ""),
    ('drop-B-TICK-HIST-ask', RT + 'broker.js', "  if (cfg.calcOnEveryTick === true) rule('B-TICK-HIST')\n", ""),
    ('coof-never', RT + 'broker.js', "  const coof = cfg.calcOnOrderFills === true", "  const coof = false"),
    ('vm-no-rollback', RT + 'vm.js', "        restoreBar(barSnap)\n", ""),
    ('vertex-market-fill-off', RT + 'broker.js', "      if (coof && waiting()) {\n        const r = tickFill(target, bar, 'vertex')", "      if (false) {\n        const r = tickFill(target, bar, 'vertex')"),
    ('closing-tick-guard-off', RT + 'broker.js', "          if (last && best === target) closingTick()\n", ""),
    ('afterExtra-off', RT + 'broker.js', "  const afterExtra = (px) => {\n", "  const afterExtra = (px) => { return\n"),
    ('extra-run-prices-at-close', RT + 'broker.js', "const cl = tickPx === null ? C[bar] : tickPx", "const cl = C[bar]"),
    ('fill-limits-fill-at-trigger', RT + 'broker.js', "return { level: level + (up ? 1 : -1) * fillLimits * mintick, px: level }", "return { level: level + (up ? 1 : -1) * fillLimits * mintick, px: level + (up ? 1 : -1) * fillLimits * mintick }"),
    ('fill-limits-ignored', RT + 'broker.js', "  const fillLimits = Number.isInteger(cfg.fillLimitsTicks) && cfg.fillLimitsTicks > 0 ? cfg.fillLimitsTicks : 0", "  const fillLimits = 0"),
    ('drop-B-FILLS-ask-open', RT + 'broker.js', "if (coof && opened.filled) { rule('B-FILLS'); tickPx = o;", "if (coof && opened.filled) { tickPx = o;"),
    ('record-poc-null', RT + 'strategyRecord.js', "      process_orders_on_close: cfg.processOrdersOnClose === true,", "      process_orders_on_close: false,"),
]

def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()

results = []
for name, rel, old, new in MUTS:
    path = os.path.join(ROOT, rel)
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
        cmd = f'source C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/node20.sh && cd {ROOT} && npx vitest run {TEST} --maxWorkers=1'
        r = subprocess.run(['bash', '-lc', cmd], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
        failed = [l.strip() for l in r.stdout.splitlines() if '×' in l][:3]
        verdict = 'KILLED' if r.returncode != 0 else 'SURVIVED'
        results.append({'mutant': name, 'file': rel, 'verdict': verdict, 'failing': failed})
    finally:
        shutil.copyfile(bak, path)
        os.remove(bak)
        assert sha(path) == before, f'{name}: restore mismatch'
    print(results[-1], flush=True)
json.dump(results, open(OUT, 'w'), indent=1)
