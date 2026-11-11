"""W9-T7 mutants: copy the file aside, apply ONE text replacement (must match exactly once), run the
focused rail, require it RED, restore by copying the saved bytes back and checking the sha. Never git."""
import hashlib, json, os, shutil, subprocess, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = r'C:/Users/Patrick/uct-worktrees/pine-dsk-w9t7/app'
ENG = ROOT + '/src/components/chart/engine'
BROKER = ENG + '/runtime/broker.js'
SB = ENG + '/ast/strategyBroker.js'
FE = ENG + '/ast/pineRuntimeFrontend.js'
RAIL = ['src/components/chart/engine/runtime/__tests__/w9T7Exits.test.js', 'src/components/chart/engine/runtime/__tests__/w9BrokerIntegration.test.js']
NODE20 = r'C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/tools/node-v20.20.2-win-x64'

MUTANTS = [
  ('M1 trail best never ratchets', BROKER, "if (t.dir > 0 ? px > st.best : px < st.best) st.best = px", "if (false) st.best = px"),
  ('M2 trail best starts at the entry price', BROKER, "lo.x.trailState.set(lo.t, { best: price })", "lo.x.trailState.set(lo.t, { best: lo.t.price })"),
  ('M3 activation check accepts any level', BROKER, "if (!(t.dir > 0 ? act > t.price : act < t.price)) {", "if (false) {"),
  ('M4 sl + trail served', BROKER, "      if (sl) {\n        // R6 remarks", "      if (false) {\n        // R6 remarks"),
  ('M5 reservation ignores the other exits', BROKER, "const taken = sum(others, (y) => (y.res.has(t) ? y.res.get(t) : t.qty))", "const taken = 0"),
  ('M6 exit-once memory dropped', BROKER, "    if (x.done.has(t)) return\n", "\n"),
  ('M7 percent rounding refusal dropped (exit)', BROKER, "      if (Math.abs(want - Math.round(want)) > 1e-9) {", "      if (false) {"),
  ('M8 partial close takes the percent of the whole position', BROKER, "const total = sum(targets, (t) => t.qty)", "const total = sum(open, (t) => t.qty)"),
  ('M9 FIFO allowed-check dropped', BROKER, "      if (allowed && !allowed.includes(t)) {", "      if (false) {"),
  ('M10 oca.cancel is a no-op', BROKER, "      if (o.oca.type === 'cancel') dropEntry(e)", "      if (o.oca.type === 'cancel') {}"),
  ('M11 oca.reduce does not reduce', BROKER, "else { e.qty -= q; if (!(e.qty > 0)) dropEntry(e) }", "else { if (!(e.qty > 0)) dropEntry(e) }"),
  ('M12 strategy.order routed as an entry', BROKER, "    if (o.kind === 'order') return fillOrder(o, price, bar, exact)\n", "\n"),
  ('M13 order overshoot refusal dropped', BROKER, "    if (o.qty > total) {", "    if (false) {"),
  ('M14 immediately fills at the open', BROKER, "executeClose(cl, C[bar], bar, onTick(C[bar]))", "executeClose(cl, O[bar], bar, onTick(O[bar]))"),
  ('M15 read-after-immediate refusal dropped', BROKER, "    if (immediateBar === bar) {", "    if (false) {"),
  ('M16 stop-limit becomes a limit at the STOP', BROKER, "      lo.o.level = lo.o.limit", "      lo.o.level = lo.o.level"),
  ('M17 stop-limit limit-beyond-stop refusal dropped', BROKER, "      if (dir > 0 ? !(limV < stpV) : !(limV > stpV)) {", "      if (false) {"),
  ('M18 v6 exit levels take the farther level', BROKER, "return sign * t.dir > 0 ? Math.min(spec.abs, r) : Math.max(spec.abs, r)", "return sign * t.dir > 0 ? Math.max(spec.abs, r) : Math.min(spec.abs, r)"),
  ('M19 v5 exit levels take the distance', BROKER, "        if (cfg.version === 5) return spec.abs", "        if (cfg.version === 5) return rel()"),
  ('M20 B-TRAIL never asked at the call', BROKER, "    if (finite(trP) || finite(trPts) || finite(trOff)) {\n      rule('B-TRAIL')", "    if (finite(trP) || finite(trPts) || finite(trOff)) {\n      void 0"),
  ('M21 B-ORDER never asked at placement', BROKER, "if (kind === 'order') { rule('B-ORDER'); t7DefaultTimingOnly", "if (kind === 'order') { void 0; t7DefaultTimingOnly"),
  ('M22 B-OCA never asked', BROKER, "    if (name === '') return null\n    rule('B-OCA')", "    if (name === '') return null\n    void 0"),
  ('M23 FE: oca.cancel read as reduce', FE, "'strategy.oca.cancel': 'cancel'", "'strategy.oca.cancel': 'reduce'"),
  ('M24 exit oca_name accepted at build', SB, "  oca_name: (n) => n.type === 'string' && n.value === '',", "  oca_name: () => true,"),
  ('M26 second full exit reserved even while B-EXIT-QTY is unpinned', BROKER, "    if (!isPinned('B-EXIT-QTY')) {", "    if (false) {"),
  ('M27 S1 fallback taken even when B-EXIT-QTY is pinned', BROKER, "    if (!isPinned('B-EXIT-QTY')) {", "    if (true) {"),
  ('M28 T7 kinds served under POC / calc_on_order_fills', BROKER, "    if (poc || coof) {\n      throw new BrokerRefusal(`${what} under", "    if (false) {\n      throw new BrokerRefusal(`${what} under"),
  ('M29 T6 tick routine closes whole trades again', BROKER, "      executeClose(cl, px, bar, true)\n    } else if (markets.length) {", "      for (const t of (cl.kind === 'all' ? open.slice() : open.filter((u) => u.entryId === cl.id))) closeTrade(t, px, bar, true)\n      afterPositionChange()\n    } else if (markets.length) {"),
  ('M30 trail best ignores the open', BROKER, "    checkActivation(o, opened.fresh)\n    ratchetTrails(o)\n", "    checkActivation(o, opened.fresh)\n"),
  ('M31 N7: margin check does not ask COMMISSION_RULE', BROKER, "    // it rests on the commission being 0 (COMMISSION_RULE) whether or not the margin was defaulted\n    rule(COMMISSION_RULE)\n", "\n"),
  ('M32 N7: equityAt does not ask COMMISSION_RULE', BROKER, "    // not only the `strategy.equity` value) rests on COMMISSION_RULE\n    rule(COMMISSION_RULE)\n", "\n"),
  ('M25 partial exit closes the whole trade', BROKER, "      closePart(lo.t, units, price, bar, exact)\n      lo.x.trades.delete", "      closePart(lo.t, lo.t.qty, price, bar, exact)\n      lo.x.trades.delete"),
]

ONLY = sys.argv[1:]
if ONLY:
    MUTANTS = [m for m in MUTANTS if m[0].split()[0] in ONLY]

def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()

def run_rail():
    env = dict(os.environ)
    env['PATH'] = NODE20 + os.pathsep + env['PATH']
    r = subprocess.run(['npx.cmd', 'vitest', 'run', *RAIL, '--maxWorkers=1'], cwd=ROOT, env=env,
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    out = r.stdout + r.stderr
    import re
    out = re.sub(r'\[[0-9;]*m', '', out)
    tail = [l for l in out.splitlines() if 'Tests ' in l or 'Test Files' in l]
    return r.returncode, tail[-1] if tail else out[-300:]

results = []
base_rc, base_tail = run_rail()
print('CONTROL (no mutant):', base_rc, base_tail, flush=True)
if base_rc != 0:
    sys.exit('control is red; mutants mean nothing')
for name, path, old, new in MUTANTS:
    before = sha(path)
    raw = open(path, 'rb').read()
    text = raw.decode('utf-8')
    crlf = '\r\n' in text
    norm = text.replace('\r\n', '\n')
    n = norm.count(old)
    if n != 1:
        results.append({'mutant': name, 'status': f'NOT APPLIED (matched {n})'})
        print(name, 'NOT APPLIED', n, flush=True)
        continue
    bak = path + '.t7bak'
    shutil.copyfile(path, bak)
    try:
        mutated = norm.replace(old, new)
        if crlf:
            mutated = mutated.replace('\n', '\r\n')
        open(path, 'wb').write(mutated.encode('utf-8'))
        rc, tail = run_rail()
    finally:
        shutil.copyfile(bak, path)
        os.remove(bak)
    assert sha(path) == before, f'restore failed for {path}'
    status = 'KILLED' if rc != 0 else 'SURVIVED'
    results.append({'mutant': name, 'status': status, 'rail': tail.strip()})
    print(name, status, tail.strip(), flush=True)

out = r'C:/Users/Patrick/uct-worktrees/pine-dsk-w9t7/docs/pine/evidence/2026-11-08-w9-t7/' + ('muts-integration-' + '-'.join(ONLY) + '.json' if ONLY else 'muts-integration.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump({'control': base_tail.strip(), 'results': results}, open(out, 'w', encoding='utf-8'), indent=1)
print('survivors:', [r['mutant'] for r in results if r['status'] != 'KILLED'])
