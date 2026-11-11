"""Hand mutations for W9-T11: copy, mutate, run, restore by copy, check with cmp (filecmp)."""
import filecmp, io, os, shutil, subprocess, sys, json

WT = r'C:/Users/Patrick/uct-worktrees/pine-dsk-w9t11'
APP = WT + '/app'
RT = 'src/components/chart/engine/runtime/'
MP = 'src/components/chart/builder/memberPane/'
REC = RT + '__tests__/w9T11Record.test.js'
STAMP = MP + 'w9T11StrategyStamp.test.js'
NODE = r'C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/tools/node-v20.20.2-win-x64'
BAK = sys.argv[1]  # backup dir (outside the worktree)
OUT = sys.argv[2]
only = sys.argv[3:]

M = [
  ('control', RT + 'runtimeColumns.js', '// ⭐⭐ W9-T11 — the run\'s `strategy` record (design 3.2) and the window a broker run takes.',
   '// control (comment only)', [REC]),
  ('vm-not-told-window', RT + 'runtimeColumns.js',
   '      ...(ctx && ctx.historyWindowBars !== undefined ? { historyWindowBars: ctx.historyWindowBars } : {}),\n      // ⭐ UIE',
   '      ...({}),\n      // ⭐ UIE', [REC]),
  ('drop-record-attach', RT + 'runtimeColumns.js', '  if (res.broker) {\n    withStrategyRecord(', '  if (false) {\n    withStrategyRecord(', [REC]),
  ('no-slice', RT + 'runtimeColumns.js',
   '  if (!(Number.isInteger(win) && win > 0) || rows.length <= win) return computeRuntimeColumnsOnce(def, rows, ctx, opts)',
   '  return computeRuntimeColumnsOnce(def, rows, ctx, opts)', [REC]),
  ('cut-keeps-listing', RT + 'runtimeColumns.js', "{ ...(ctx || {}), historyFromListing: false }", '(ctx || {})', [REC]),
  ('window-not-in-memo-key', RT + 'runtimeColumns.js', '${settings}${framed}${hw}`', '${settings}${framed}`', [REC]),
  ('drop-gate-off-stamp-guard', RT + 'runtimeColumns.js', '  if (strategyDoc && !program.broker) {', '  if (false) {', [REC]),
  ('drop-slides-guard', RT + 'runtimeColumns.js', '  if (program.broker && slides) {', '  if (false) {', [REC]),
  ('probe-broker-false', RT + 'runtimeColumns.js', '    broker: !!program.broker,', '    broker: false,', [REC]),
  ('literal-window-default', RT + 'runtimeColumns.js', '  const win = ctx && ctx.historyWindowBars\n',
   '  const win = (ctx && ctx.historyWindowBars) || 5000\n', [REC]),
  ('strategy-skips-window', RT + 'runtimeColumns.js',
   '  if (def && def.meta && def.meta.runtimeHistory === STRATEGY_WINDOW_HISTORY) return computeStrategyWindow(def, rows, ctx, opts)',
   '  if (false) return computeStrategyWindow(def, rows, ctx, opts)', [REC]),
  ('worker-no-gate-register', RT + 'runtimeWorker.js', 'registerStrategyBrokerGate(strategyBrokerEnabled)\n', '\n', [REC]),
  ('worker-drops-record', RT + 'runtimeWorker.js', ', strategy: runtimeStrategyOf(columns) })', ' })', [REC]),
  ('main-drops-record', RT + 'runtimeAsync.js', '    if (landed && strategy) withStrategyRecord(landed, strategy)\n', '\n', [REC]),
  ('message-drops-window', RT + 'runtimeAsync.js',
   '    ...(ctx && ctx.historyWindowBars !== undefined ? { historyWindowBars: ctx.historyWindowBars } : {}),\n  }',
   '  }', [REC]),
  ('door-stamps-listing', MP + 'memberPaneDefinition.js', "...(probe.broker === true ? { runtimeHistory: STRATEGY_WINDOW_HISTORY } : routed",
   "...(false ? { runtimeHistory: STRATEGY_WINDOW_HISTORY } : routed", [STAMP]),
  ('door-stamps-always', MP + 'memberPaneDefinition.js', "...(probe.broker === true ? { runtimeHistory: STRATEGY_WINDOW_HISTORY } : routed",
   "...(true ? { runtimeHistory: STRATEGY_WINDOW_HISTORY } : routed", [STAMP]),
  ('asof-ignores-forming', RT + 'strategyRecord.js', 'confirmed === true ? n - 1 : n - 2', 'n - 1', [REC]),
  ('shape-skips-unserved', RT + 'strategyRecord.js', '  for (const path of Object.keys(rec.unserved || {})) {', '  for (const path of []) {', [REC]),
  ('shape-skips-window-bound', RT + 'strategyRecord.js', '&& w.bars <= w.historyWindowBars,', '|| true,', [REC]),
  ('record-trade-time-index', RT + 'strategyRecord.js', '    entryTime: t.entry ? t.entry.time : null,', '    entryTime: i,', [REC]),
  ('record-window-from-literal', RT + 'strategyRecord.js', '      historyWindowBars,\n', '      historyWindowBars: 5000,\n', [REC]),
]

env = dict(os.environ)
env['PATH'] = NODE + os.pathsep + env['PATH']
os.makedirs(BAK, exist_ok=True)
rows = []
for name, rel, old, new, tests in M:
    if only and name not in only:
        continue
    f = os.path.join(APP, rel)
    raw = io.open(f, encoding='utf-8', newline='').read()
    crlf = '\r\n' in raw
    o = old.replace('\n', '\r\n') if crlf else old
    n = new.replace('\n', '\r\n') if crlf else new
    if raw.count(o) != 1:
        rows.append((name, 'BADMATCH', raw.count(o)))
        print(name, 'BADMATCH', raw.count(o), flush=True)
        continue
    bak = os.path.join(BAK, os.path.basename(f))
    shutil.copyfile(f, bak)
    try:
        io.open(f, 'w', encoding='utf-8', newline='').write(raw.replace(o, n))
        r = subprocess.run(['npx.cmd', 'vitest', 'run', *tests, '--maxWorkers=1'], cwd=APP, env=env,
                           capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
        tail = [l for l in r.stdout.splitlines() if 'Tests' in l][-1:]
        verdict = 'KILLED' if r.returncode != 0 else 'SURVIVED'
    finally:
        shutil.copyfile(bak, f)
    same = filecmp.cmp(bak, f, shallow=False)
    rows.append((name, verdict, ' '.join(tail).strip(), 'restored-cmp-ok' if same else 'RESTORE-MISMATCH'))
    print(rows[-1], flush=True)
    if not same:
        sys.exit('restore mismatch: ' + f)
io.open(OUT, 'w', encoding='utf-8').write(json.dumps(rows, indent=1, ensure_ascii=True))
