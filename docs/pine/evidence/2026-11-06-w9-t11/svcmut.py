"""W9-T11 r1 hand mutations of the service fix: copy, mutate, node --test, restore by copy, filecmp."""
import filecmp, io, os, shutil, subprocess, sys, json
WT = r'C:/Users/Patrick/uct-worktrees/pine-dsk-w9t11'
SV = 'services/pine_runtime/'
T = SV + 'test/'
BAK, OUT = sys.argv[1], sys.argv[2]
M = [
  ('control', SV + 'job.mjs', "// W9-T11: the window, from the job's ctx", "// W9-T11 (control): the window, from the job's ctx", [T + 'adapter.test.mjs', T + 'job.test.mjs']),
  ('job-drops-window', SV + 'job.mjs',
   '    ...(job.ctx.historyWindowBars !== undefined ? { historyWindowBars: job.ctx.historyWindowBars } : {}),\n', '',
   [T + 'adapter.test.mjs', T + 'job.test.mjs']),
  ('job-literal-window', SV + 'job.mjs',
   '    ...(job.ctx.historyWindowBars !== undefined ? { historyWindowBars: job.ctx.historyWindowBars } : {}),\n',
   '    historyWindowBars: 5000,\n', [T + 'adapter.test.mjs', T + 'job.test.mjs']),
  ('protocol-closes-window', SV + 'protocol.mjs', "['runtimeInputs', 'historyWindowBars'])", "['runtimeInputs'])", [T + 'protocol.test.mjs']),
  ('protocol-accepts-zero', SV + 'protocol.mjs', "if (!Number.isSafeInteger(v) || v < 1) throw bad(path, 'must be a positive integer')",
   "if (!Number.isSafeInteger(v) || v < 0) throw bad(path, 'must be a positive integer')", [T + 'protocol.test.mjs']),
  ('protocol-always-carries', SV + 'protocol.mjs', "`${path}.ctx.historyWindowBars`) } : {}),",
   "`${path}.ctx.historyWindowBars`) } : { historyWindowBars: undefined }),", [T + 'protocol.test.mjs']),
  ('cache-ignores-window', SV + 'cache.mjs', "  if (ctx.historyWindowBars !== undefined) parts.push(`window=${num(ctx.historyWindowBars)}`)\n", '',
   [T + 'cache.test.mjs']),
  ('cache-always-window', SV + 'cache.mjs', "  if (ctx.historyWindowBars !== undefined) parts.push(", "  if (true) parts.push(", [T + 'cache.test.mjs']),
]
os.makedirs(BAK, exist_ok=True)
rows = []
for name, rel, old, new, tests in M:
    f = os.path.join(WT, rel)
    raw = io.open(f, encoding='utf-8', newline='').read()
    crlf = '\r\n' in raw
    o = old.replace('\n', '\r\n') if crlf else old
    n = new.replace('\n', '\r\n') if crlf else new
    if raw.count(o) != 1:
        rows.append((name, 'BADMATCH', raw.count(o))); print(rows[-1], flush=True); continue
    bak = os.path.join(BAK, os.path.basename(f))
    shutil.copyfile(f, bak)
    try:
        io.open(f, 'w', encoding='utf-8', newline='').write(raw.replace(o, n))
        r = subprocess.run(['node', '--test', *tests], cwd=WT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=600)
        tail = [l for l in r.stdout.splitlines() if l.startswith(('\u2139 pass', '\u2139 fail'))]
        verdict = 'KILLED' if r.returncode != 0 else 'SURVIVED'
    finally:
        shutil.copyfile(bak, f)
    same = filecmp.cmp(bak, f, shallow=False)
    rows.append((name, verdict, ' '.join(tail), 'restored-cmp-ok' if same else 'RESTORE-MISMATCH'))
    print(rows[-1], flush=True)
    if not same:
        sys.exit('restore mismatch ' + f)
io.open(OUT, 'w', encoding='utf-8').write(json.dumps(rows, indent=1, ensure_ascii=True))
