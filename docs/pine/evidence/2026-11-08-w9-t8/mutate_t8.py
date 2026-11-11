"""W9-T8 hand mutants (evidence; rerun from anywhere with Node 20 first on PATH).

Each mutant: copy the file aside (outside the tree), apply ONE textual change (asserted unique), run the focused
rails with vitest's JSON reporter, restore the copy and `filecmp` it. Never `git checkout`. Writes muts.json beside
this file, with the failing tests of every kill.
"""
import filecmp
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
APP = os.path.join(ROOT, 'app')
E = 'src/components/chart/engine'
B = f'{E}/runtime/broker.js'
R = f'{E}/runtime/brokerRules.js'
SB = f'{E}/ast/strategyBroker.js'
FE = f'{E}/ast/pineRuntimeFrontend.js'
T = f'{E}/runtime/__tests__'
TESTS = [f'{T}/w9T8Risk.test.js', f'{T}/s1StrategyBroker.test.js', f'{T}/w9T1Broker.test.js',
         f'{E}/ast/strategiesAreRuled.test.js']

MUTANTS = [
    # ── allow_entry_in ──
    ('M1 a forbidden entry proceeds (reverses)', B, "    if (allow === 'all' || allow === side) return undefined", '    return undefined'),
    ('M2 B-RISK-ALLOW never asked', B, "    rule(RISK_RULES.allow)\n    riskDefaultOnly('`strategy.risk.allow_entry_in`')",
     "    riskDefaultOnly('`strategy.risk.allow_entry_in`')"),
    ('M3 direction.all forbids the other side', B, "if (allow === 'all' || allow === side)", 'if (allow === side)'),
    ('M4 a forbidden price entry served', B, "    if (o.type !== 'market') {\n      throw new BrokerRefusal(`the ${o.type} entry",
     "    if (false) {\n      throw new BrokerRefusal(`the ${o.type} entry"),
    ('M5 the risk close not labelled B-RISK-ALLOW', B, '    fillRule = RISK_RULES.allow\n', ''),
    ('M6 a forbidden entry while flat walks the close path', B, '    entries = entries.filter((e) => e !== o)\n    if (!open.length) return null\n',
     '    entries = entries.filter((e) => e !== o)\n'),
    ('M7 the forbidden entry stays queued', B, '    entries = entries.filter((e) => e !== o)\n    if (!open.length) return null\n',
     '    if (!open.length) return null\n'),
    # ── shared ──
    ('M8 risk beside a cost served', B, '    if (costOn || slipTicks) {\n      throw new BrokerRefusal(`${what} with ${costOn',
     '    if (false) {\n      throw new BrokerRefusal(`${what} with ${costOn'),
    ('M9 risk under process_orders_on_close served', B,
     "    if (poc || coof) {\n      throw new BrokerRefusal(`${what} under ${poc ? 'process_orders_on_close' : 'calc_on_order_fills'} is not served `\n        + '(no capture combines the two)', riskRow)",
     "    if (false) {\n      throw new BrokerRefusal(`${what} under ${poc ? 'process_orders_on_close' : 'calc_on_order_fills'} is not served `\n        + '(no capture combines the two)', riskRow)"),
    ('M10 a T7 kind beside a risk command served', B, 'if (riskOn) throw new BrokerRefusal(', 'if (false) throw new BrokerRefusal('),
    ('M11 one row for every risk refusal', B, "const riskRow = allow !== null || maxDd !== null ? 'W9-R1' : 'W9-R1i'", "const riskRow = 'W9-R1'"),
    # ── max_drawdown ──
    ('M12 the limit is strict (>)', B, 'if (dd >= limit - 1e-9', 'if (dd > limit + 1e-9'),
    ('M13 a percent of the peak, not the initial capital', B, ': cap * maxDd.value / 100', ': ddPeak * maxDd.value / 100'),
    ('M14 no sample at a fill level', B, '        riskTick(best) // W9-T8', '        // riskTick(best) // W9-T8'),
    ('M15 no sample at the vertices', B, '      riskTick(target) // W9-T8', '      // riskTick(target) // W9-T8'),
    ('M16 the peak never moves', B, 'ddPeak = Math.max(ddPeak, eq)', 'ddPeak = Math.max(ddPeak, ddPeak)'),
    ('M17 B-RISK-DDOWN never asked', B, '    rule(RISK_RULES.maxDrawdown)\n', ''),
    ('M18 max_drawdown under POC served', B, "    riskDefaultOnly('`strategy.risk.max_drawdown`')\n", ''),
    # ── max_intraday_filled_orders ──
    ('M19 an unknown trading day counted, not refused', B, '    if (day === undefined || day === null) {', '    if (false) {'),
    ('M20 the limit is strict (>)', B, '    if (n >= dayCap) {', '    if (n > dayCap) {'),
    ('M21 an opened trade not counted', B, '  const openTrade = (o, price, bar, exact, reversed) => {\n    riskFill(bar)\n',
     '  const openTrade = (o, price, bar, exact, reversed) => {\n'),
    ('M22 a closed trade not counted', B, '    if (i < 0) return\n    riskFill(bar)\n', '    if (i < 0) return\n'),
    ('M23 B-RISK-INTRADAY-ORDERS never asked', B, '    rule(RISK_RULES.intradayOrders)\n', ''),
    ('M24 intraday beside a cost served', B, "    riskDefaultOnly('`strategy.risk.max_intraday_filled_orders`')\n", ''),
    ('M25 one count for every day', B, '    const n = (dayFills.get(day) || 0) + 1\n    dayFills.set(day, n)',
     "    const n = (dayFills.get('all') || 0) + 1\n    dayFills.set('all', n)"),
    # ── the reader (build) ──
    ('M26 a risk call inside a block read', FE, '            if (condDepth !== 0) {', '            if (false) {'),
    ('M27 any Pine version read', SB, '  if (Number(version) !== 6) throw', '  if (false) throw'),
    ('M28 a second call wins', SB, "need(risk[key] === undefined, 'is called more than once", "need(true, 'is called more than once"),
    ('M29 a percent above 100 read', SB, "(type === 'cash' || n <= 100)", '(true)'),
    ('M30 the unwitnessed commands fall through', SB, '  if (Object.prototype.hasOwnProperty.call(RISK_UNWITNESSED, fn)) throw',
     '  if (false) throw'),
    ('M31 any type name read as cash', SB, "nameOf(t) === 'strategy.cash' ? 'cash' : null)", "'cash')"),
    ('M32 a non-literal alert_message read past', SB, "got.get('alert_message').type !== 'string'", 'false'),
    # ── the vocabulary ──
    ('M33 B-RISK-DDOWN pinned by W9-R1i', R, "'B-RISK-DDOWN': Object.freeze({ capture: 'W9-R1',", "'B-RISK-DDOWN': Object.freeze({ capture: 'W9-R1i',"),
]


def failing_tests(report_path):
    try:
        rep = json.load(open(report_path, encoding='utf-8'))
    except Exception as e:  # noqa: BLE001
        return [f'(no JSON report: {e})']
    out = []
    for f in rep.get('testResults', []):
        for a in f.get('assertionResults', []):
            if a.get('status') == 'failed':
                out.append(f"{os.path.basename(f.get('name', ''))} > {a.get('fullName') or a.get('title')}")
        if f.get('status') == 'failed' and not f.get('assertionResults'):
            out.append(f"{os.path.basename(f.get('name', ''))} (suite failed: {str(f.get('message', ''))[:160]})")
    return out


def run_tests(report_path):
    cmd = ['npx', 'vitest', 'run', *TESTS, '--maxWorkers=1', '--reporter=json', f'--outputFile={report_path}']
    p = subprocess.run(' '.join(cmd), cwd=APP, shell=True, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode


def main():
    only = set(sys.argv[1:])
    results = []
    tmp = tempfile.mkdtemp(prefix='t8_muts_')
    for name, rel, a, b in MUTANTS:
        if only and name.split()[0] not in only:
            continue
        path = os.path.join(APP, rel)
        src = open(path, encoding='utf-8', newline='').read()
        if '\r\n' in src:  # a Windows checkout (core.autocrlf): the anchors are written with LF
            a, b = a.replace('\n', '\r\n'), b.replace('\n', '\r\n')
        assert src.count(a) == 1, (name, src.count(a))
        backup = os.path.join(tmp, os.path.basename(rel) + '.bak')
        shutil.copyfile(path, backup)
        report = os.path.join(tmp, 'report.json')
        if os.path.exists(report):
            os.remove(report)
        try:
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write(src.replace(a, b))
            code = run_tests(report)
        finally:
            shutil.copyfile(backup, path)
            assert filecmp.cmp(backup, path, shallow=False), f'{name}: restore failed'
        fails = failing_tests(report)
        verdict = 'killed' if code != 0 else 'SURVIVED'
        print(f'{name}: {verdict} ({len(fails)} failed)', flush=True)
        for t in fails[:3]:
            print(f'    {t}', flush=True)
        results.append({'mutant': name, 'file': rel, 'verdict': verdict, 'failed': len(fails), 'failing_tests': fails})
    out = os.path.join(os.path.dirname(__file__), 'muts.json')
    if only and os.path.exists(out):
        # a partial rerun replaces only the mutants it ran, keeping the rest of the last full run
        prev = json.load(open(out, encoding='utf-8'))
        mine = {r['mutant']: r for r in results}
        results = [mine.pop(r['mutant'], r) for r in prev] + list(mine.values())
    json.dump(results, open(out, 'w', encoding='utf-8'), indent=1)


if __name__ == '__main__':
    main()
