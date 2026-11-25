// Read-only measurement of the coach guard against the independent held-out fixtures.
// Calls only the public check() of the browser guard (app/src/agent/coach/guard.js) and,
// through the venv, the server guard (api/services/uct_agent/coach/guard.py).
// Does NOT modify the guard. Prints counts/rates and miss lists only.
//
//   node scripts/agent/measure_coach_guard_heldout.mjs [--json out.json] [--python <venv python>]
//
// A case is "flagged" when check(text) returns a non-empty list of codes.
// Two modes are reported:
//   noInputs   : check(text)            (inputs omitted, as a reply with no grounded figures)
//   selfInputs : check(text, [text])    (every figure is treated as traceable, so the
//                                        'figure' code cannot fire; isolates the language rules)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'app/src/agent/__fixtures__/coachGuardIndependent');
const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PY = argVal('--python', 'C:/Users/blake/projects/UCT-Dashboard/.venv/Scripts/python.exe');

const sets = Object.fromEntries(['advice', 'critical', 'educational'].map((s) => [s, JSON.parse(readFileSync(join(FIX, `${s}.json`), 'utf8'))]));

// ---- browser guard --------------------------------------------------------
const js = await import(pathToFileURL(join(ROOT, 'app/src/agent/coach/guard.js')).href);
const runJs = (text, mode) => js.check(text, mode === 'selfInputs' ? [text] : null) || [];

// ---- server guard (one python process for all cases) ----------------------
function runPyAll() {
  const payload = JSON.stringify(Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.cases.map((c) => c.text)])));
  const code = [
    'import json, sys',
    'sys.path.insert(0, ".")',
    'from api.services.uct_agent.coach.guard import check',
    'data = json.loads(sys.stdin.read())',
    'out = {k: {"noInputs": [list(check(t)) for t in v], "selfInputs": [list(check(t, [t])) for t in v]} for k, v in data.items()}',
    'sys.stdout.write(json.dumps(out))',
  ].join('\n');
  const r = spawnSync(PY, ['-c', code], { cwd: ROOT, input: payload, encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (r.status !== 0) { console.error('python guard unavailable:', (r.stderr || r.error || '').toString().slice(-800)); return null; }
  return JSON.parse(r.stdout);
}
const py = runPyAll();

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const report = {};
for (const impl of ['js', 'py']) {
  if (impl === 'py' && !py) continue;
  report[impl] = {};
  for (const mode of ['noInputs', 'selfInputs']) {
    const r = {};
    for (const [name, set] of Object.entries(sets)) {
      const results = set.cases.map((c, i) => ({ c, codes: impl === 'js' ? runJs(c.text, mode) : py[name][mode][i] }));
      const flagged = results.filter((x) => x.codes.length > 0);
      const wrong = set.expect === 'block' ? results.filter((x) => x.codes.length === 0) : flagged;
      const byCat = {};
      for (const x of results) {
        const k = x.c.category; byCat[k] ||= { total: 0, wrong: 0 };
        byCat[k].total++; if (wrong.includes(x)) byCat[k].wrong++;
      }
      const codeCounts = {};
      for (const x of flagged) for (const code of x.codes) codeCounts[code] = (codeCounts[code] || 0) + 1;
      r[name] = {
        expect: set.expect,
        total: results.length,
        flagged: flagged.length,
        rate: set.expect === 'block' ? `recall ${pct(flagged.length, results.length)}` : `false-positive ${pct(flagged.length, results.length)}`,
        codeCounts,
        byCategory: byCat,
        wrong: wrong.map((x) => ({ id: x.c.id, category: x.c.category, codes: x.codes, text: x.c.base ? `[obf] ${x.c.base}` : x.c.text })),
      };
    }
    report[impl][mode] = r;
  }
}

for (const [impl, modes] of Object.entries(report)) {
  for (const [mode, r] of Object.entries(modes)) {
    console.log(`\n=== ${impl} / ${mode} ===`);
    for (const [name, s] of Object.entries(r)) {
      console.log(`${name.padEnd(12)} ${s.flagged}/${s.total} flagged  ${s.rate}  codes=${JSON.stringify(s.codeCounts)}`);
      const cats = Object.entries(s.byCategory).filter(([, v]) => v.wrong).map(([k, v]) => `${k} ${v.wrong}/${v.total}`);
      if (cats.length) console.log(`  ${s.expect === 'block' ? 'misses' : 'false positives'} by category: ${cats.join(', ')}`);
    }
  }
}
// parity between implementations
if (report.py) {
  let diff = 0;
  for (const name of Object.keys(sets)) sets[name].cases.forEach((c, i) => { if ((runJs(c.text, 'noInputs').length > 0) !== (py[name].noInputs[i].length > 0)) diff++; });
  console.log(`\njs/py flag disagreement (noInputs): ${diff} cases`);
  report.parityDisagreements = diff;
}
const outPath = argVal('--json', null);
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
