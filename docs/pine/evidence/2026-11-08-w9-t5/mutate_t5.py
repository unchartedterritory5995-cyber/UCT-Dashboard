"""W9-T5 hand mutants (evidence; rerun from the repo root with Node 20 on PATH).

Each mutant: copy the file aside, apply ONE textual change (asserted unique), run the focused T5 rails,
restore the copy and `filecmp` it. Never `git checkout`. Writes muts.json beside this file.
"""
import filecmp
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
APP = os.path.join(ROOT, 'app')
E = 'src/components/chart/engine'
B = f'{E}/runtime/broker.js'
R = f'{E}/runtime/brokerRules.js'
REP = f'{E}/runtime/brokerReport.js'
REC = f'{E}/runtime/strategyRecord.js'
SB = f'{E}/ast/strategyBroker.js'
T = f'{E}/runtime/__tests__'
TESTS = [f'{T}/w9T5Costs.test.js', f'{T}/w9T13aBrokerReport.test.js', f'{T}/w9T1Broker.test.js',
         f'{T}/s1StrategyBroker.test.js', f'{T}/w9BrokerIntegration.test.js']

MUTANTS = [
    ('M1 percent fee scale /1000', B, 'pointvalue * comm.value / 100 }', 'pointvalue * comm.value / 1000 }'),
    ('M2 exit fee never charged', B, 'const exitFee = feeOf(t.qty, price)', 'const exitFee = 0'),
    ('M3 entry fee never charged', B, 'fee: feeOf(o.qty, price) }', 'fee: 0 }'),
    ('M4 openprofit not net of the paid entry fee', B,
     'if (costOn) return sum(open, (t) => (C[bar] - t.price) * t.dir * t.qty) * pointvalue - openFees()',
     'if (costOn) return sum(open, (t) => (C[bar] - t.price) * t.dir * t.qty) * pointvalue'),
    ('M5 sign of the GROSS profit under a commission', B, 'return Math.sign(net)', 'return Math.sign(t.profit)'),
    ('M6 grossprofit sums gross profits', B, 'if (costOn) return sum(closed, (t) => (netOf(t) > 0 ? netOf(t) : 0))',
     'if (false) return sum(closed, (t) => (netOf(t) > 0 ? netOf(t) : 0))'),
    ('M7 per-order two-trade guard dropped', B, 'if (orderFees > 1) {', 'if (orderFees > 99) {'),
    ('M8 slippage in the favourable direction', B, '(k + side * slipTicks) * mintick', '(k - side * slipTicks) * mintick'),
    ('M9 slippage asks no B-SLIPPAGE', B, "    rule('B-SLIPPAGE')\n", ''),
    ('M10 a close slips the entry side', B, 'slipped(price0, -targets[0].dir)', 'slipped(price0, targets[0].dir)'),
    ('M11 a stop entry is slipped, not refused', B, "    noPriceOrderSlippage(`the ${o.type} entry",
     "    if (o.type === 'stop') return slipped(price, o.dir)\n    noPriceOrderSlippage(`the ${o.type} entry"),
    ('M12 stop-loss slippage refusal dropped', B, "if (lo.leg === 'sl') noPriceOrderSlippage(", "if (false) noPriceOrderSlippage("),
    ('M13 a limit is slipped', B, "if (o.type === 'market') return slipped(price, o.dir)", "if (o.type !== 'stop') return slipped(price, o.dir)"),
    ('M14 B-POC-COST never asked', B, "if (costTick === 'poc') rule('B-POC-COST')", "if (false) rule('B-POC-COST')"),
    ('M15 extra-execution cost refusal dropped', B, "else if (costTick === 'vertex') {", 'else if (false) {'),
    ('M16 T7 kind with a commission served', B, '    if (costOn) {\n      throw new BrokerRefusal(`${what} with a commission',
     '    if (false) {\n      throw new BrokerRefusal(`${what} with a commission'),
    ('M17 cash / percent size under a cost served', B, 'if (costOn || slipTicks) {', 'if (false) {'),
    ('M18 a defaulted type does not ask B-DEFAULTS', R, 'return c.typeDefaulted === false ? [r] : [r, COMMISSION_RULE]', 'return [r]'),
    ('M19 a zero commission asks the type rule', R, 'if (!(typeof c.value === \'number\' && c.value > 0)) return [COMMISSION_RULE]',
     'if (false) return [COMMISSION_RULE]'),
    ('M20 values ask no commission rule', B, 'if (COMMISSION_NET_VALUES.includes(fn)) askCommission()', 'if (false) askCommission()'),
    ('M21 report ignores the fees', REP, 'const costOn = commission.value > 0', 'const costOn = false'),
    ('M22 report commission paid served with a fee-paying open trade', REP, 'if (open.some((t) => t.commission > 0)) {', 'if (false) {'),
    ('M23 report rests on B-DEFAULTS only', REP, "...(kind === 'count' ? [] : commissionRulesOf(commission))", "...(kind === 'count' ? [] : ['B-DEFAULTS'])"),
    ('M24 record drops the trade fee', REC, 'commission: Number.isFinite(t.commission) ? t.commission : 0,', 'commission: 0,'),
    ('M25 declaration does not read slippage', SB, 'cfg.slippage = n; break', 'break'),
    ('M26 declaration: type always defaulted', SB, "cfg.commission.typeDefaulted = !named.has('commission_type')", 'cfg.commission.typeDefaulted = true'),
    ('M27 reversal closes at the unslipped price', B, 'closeTrade(t, price, bar, exact)\n      reversed = true',
     'closeTrade(t, price0, bar, exact)\n      reversed = true'),
    ('M28 equity gross of fees', B, 'if (costOn) return capital() + moneyOfClosed()', 'if (false) return capital() + moneyOfClosed()'),
    ('M29 netprofit gross of fees', B, 'return costOn ? moneyOfClosed() : netPts() * pointvalue', 'return netPts() * pointvalue'),
    ('M30 closedtrades.profit gross of fees', B, 'return costOn ? netOf(t) : t.profit * pointvalue', 'return t.profit * pointvalue'),
    ('M31 margin check asks no commission rule', B, '    askCommission()\n    const dir = open[0].dir', '    const dir = open[0].dir'),
    # ── r1 (review W9-T5 B1, U2, U5a) ──
    ('M32 a limit entry under slippage served unslipped (B1)', B, "    if (!slipTicks) return\n    if (kind === 'stop') {",
     "    if (!slipTicks || kind !== 'stop') return\n    if (kind === 'stop') {"),
    ('M33 a take-profit under slippage served (B1)', B, "else if (lo.leg === 'tp') noPriceOrderSlippage(", "else if (false) noPriceOrderSlippage("),
    ('M34 an off-grid market fill slipped, not refused (U5a)', B,
     'if (!(Math.abs(price - k * mintick) <= 1e-9 * Math.max(1, Math.abs(price)))) {', 'if (false) {'),
    ('M36 the r1 grid test (1 / mintick a whole number) restored (r2)', B,
     'if (!(Math.abs(price - k * mintick) <= 1e-9 * Math.max(1, Math.abs(price)))) {',
     'if (!(onTick(price) && Math.abs(Math.round(1 / mintick) * mintick - 1) < 1e-12)) {'),
    ('M37 the slipped price not written at the tick decimals (r2)', B,
     'return Number(((k + side * slipTicks) * mintick).toFixed(tickDecimals(mintick)))',
     'return (k + side * slipTicks) * mintick'),
    ('M38 tickDecimals ignores the exponent (r3)', B, 'Math.max(0, frac - (exp ? Number(exp) : 0))', 'Math.max(0, frac)'),
    ('M35 percent fee ignores pointvalue (U2)', B, 'return units * price * pointvalue * comm.value / 100 }',
     'return units * price * comm.value / 100 }'),
]


def run_tests():
    cmd = ['npx', 'vitest', 'run', *TESTS, '--maxWorkers=1']
    p = subprocess.run(' '.join(cmd), cwd=APP, shell=True, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = p.stdout + p.stderr
    import re
    m = re.search(r'Tests\s+(?:\x1b\[[0-9;]*m)*\s*(?:(\d+) failed)?', out)
    failed = 0
    fm = re.search(r'(\d+) failed', out)
    if fm:
        failed = int(fm.group(1))
    return p.returncode, failed


def main():
    only = set(sys.argv[1:])
    results = []
    for name, rel, a, b in MUTANTS:
        if only and name.split()[0] not in only:
            continue
        path = os.path.join(APP, rel)
        src = open(path, encoding='utf-8').read()
        assert src.count(a) == 1, (name, src.count(a))
        backup = path + '.mutbak'
        shutil.copyfile(path, backup)
        try:
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write(src.replace(a, b))
            code, failed = run_tests()
        finally:
            shutil.copyfile(backup, path)
            assert filecmp.cmp(backup, path, shallow=False), f'{name}: restore failed'
            os.remove(backup)
        verdict = 'killed' if code != 0 else 'SURVIVED'
        print(f'{name}: {verdict} ({failed} failed)', flush=True)
        results.append({'mutant': name, 'file': rel, 'verdict': verdict, 'failed': failed})
    json.dump(results, open(os.path.join(os.path.dirname(__file__), 'muts.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
