"""13H-2 mutation harness: capture -> mutate -> run named vitest -> restore -> verify vs git blob."""
import json, subprocess, sys, pathlib, hashlib, datetime
ROOT = pathlib.Path(r'C:\Users\Patrick\uct-worktrees\notebook-w13h2')
APP = ROOT / 'app'
OUT = ROOT / 'docs' / 'notebook' / 'evidence' / 'wave13-13h2'
NB = 'app/src/pages/journal-2-0/components/notebook/'
MUTATIONS = [
  ('M1-alert-id-not-namespaced', NB + 'ChartPlanPanel.jsx',
   "drawingId: boundAlertId(embedId, drawing.id), direction", "drawingId: drawing.id, direction",
   [NB + 'ChartPlanPanel.test.jsx']),
  ('M2-touch-family-not-claimed', NB + 'ChartPlanPanel.jsx',
   "const types = ['pointerdown', 'mousedown', 'touchstart']", "const types = ['pointerdown', 'mousedown']",
   [NB + 'ChartPlanPanel.test.jsx']),
  ('M3-embed-doors-ignore-the-gate', NB + 'WidgetEmbedView.jsx',
   "&& editor?.isEditable !== false && !frozen && chartPlanEnabled()", "&& editor?.isEditable !== false && !frozen",
   [NB + 'WidgetEmbedView.chartPlan.test.jsx']),
  ('M4-slash-vs-ignores-the-gate', NB + 'SlashMenu.jsx',
   "const planOn = chartPlanEnabled()", "const planOn = true",
   [NB + 'SlashMenu.chartPlan.test.jsx']),
  ('M5-panel-sizes-without-the-server-reading', NB + 'ChartPlanPanel.jsx',
   "compass: reading.data?.compass,\n  }) : null)", "compass: null,\n  }) : null)",
   [NB + 'ChartPlanPanel.test.jsx']),
]
only = sys.argv[1:] 
results = []
for name, rel, old, new, tests in MUTATIONS:
    if only and name not in only: continue
    p = ROOT / rel
    orig = p.read_bytes()
    text = orig.decode('utf-8')
    crlf = '\r\n' in text
    o = old.replace('\n', '\r\n') if crlf else old
    n = new.replace('\n', '\r\n') if crlf else new
    assert text.count(o) == 1, (name, text.count(o))
    p.write_bytes(text.replace(o, n).encode('utf-8'))
    try:
        r = subprocess.run(['npx.cmd', 'vitest', 'run', '--maxWorkers=1', *[t.replace('app/', '', 1) for t in tests]],
                           cwd=APP, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    finally:
        p.write_bytes(orig)
    blob = subprocess.run(['git', 'cat-file', 'blob', f'HEAD:{rel}'], cwd=ROOT, capture_output=True).stdout
    restored_vs_head = blob.replace(b'\r\n', b'\n') == p.read_bytes().replace(b'\r\n', b'\n')
    clean = subprocess.run(['git', 'diff', '--quiet', '--', rel], cwd=ROOT).returncode == 0
    out = r.stdout + r.stderr
    import re
    plain = re.sub(r'\x1b\[[0-9;]*m', '', out)
    totals = [l.strip() for l in plain.splitlines() if l.strip().startswith(('Test Files', 'Tests '))]
    failed = [l.strip() for l in plain.splitlines() if l.strip().startswith('×')]
    rec = {'mutation': name, 'file': rel, 'exit': r.returncode, 'killed': r.returncode != 0 and bool(totals),
           'totals': totals, 'failed_tests': failed, 'restored_matches_HEAD_blob': restored_vs_head,
           'git_diff_quiet_after_restore': clean, 'at': datetime.datetime.now().isoformat()}
    results.append(rec)
    (OUT / f'mutation-{name}.log').write_text(plain, encoding='utf-8')
    print(json.dumps(rec))
(OUT / 'mutations-raw.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
