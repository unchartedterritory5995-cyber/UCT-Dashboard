"""W9-T7-F1 hand mutants (evidence; rerun from the repo root with Node 20 on PATH).

Each mutant: copy the file aside, apply ONE textual change (asserted unique), run the focused F1 rails,
restore the copy and `filecmp` it. Never `git checkout`. Writes muts.json beside this file.
"""
import filecmp
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
APP = os.path.join(ROOT, 'app')
E = 'src/components/chart/engine'
B = f'{E}/runtime/broker.js'
REC = f'{E}/runtime/strategyRecord.js'
MK = f'{E}/runtime/tradeMarkers.js'
REP = f'{E}/runtime/brokerReport.js'
SB = f'{E}/ast/strategyBroker.js'
T = f'{E}/runtime/__tests__'
TESTS = [f'{T}/w9T7F1OrderLog.test.js', f'{T}/w9T12TradeMarkers.test.js', f'{T}/w9T11Record.test.js',
         f'{T}/w9T13aBrokerReport.test.js', 'src/components/chart/builder/memberPane/w9T12MarkersDoor.test.js',
         'src/components/chart/pane/strategyReportPanel.test.jsx']

MUTANTS = [
    # ── the log (broker.js) ──
    ('M1 a fill does not record its size', B, '    r.fillQty = qty\n', '    r.fillQty = null\n'),
    ('M2 a full close does not stamp the closing row', B, 'commission: t.fee + exitFee, xid: closingRow })',
     'commission: t.fee + exitFee, xid: null })'),
    ('M3 a partial close does not stamp the closing row', B, 'commission: 0, xid: closingRow })', 'commission: 0, xid: null })'),
    ('M4 closingWith never sets the row', B, '    closingRow = r ? r.n : null\n', '    closingRow = keep\n'),
    ('M5 a bracket outlives its trade', B, "      endRow(x.rows.get(t), 'cancelled', 'trade-closed')\n", ''),
    ('M6 a dropped entry stays placed', B, "    endRow(e.row, 'cancelled', why)\n", ''),
    ('M7 a pyramiding rejection is not logged', B, "{ endRow(o.row, 'rejected', 'pyramiding'); return null }", '{ return null }'),
    ('M8 a forbidden entry is not rejected', B, "{ endRow(o.row, 'rejected', 'risk-allow-entry-in'); return null }", '{ return null }'),
    ('M9 the filled leg keeps the base comment', B, '      if (own) { r.comment = own.text; r.commentRecorded = own.recorded }\n', ''),
    ('M10 OCA reduce does not update the row size', B, '        if (e.row) e.row.qty = e.qty\n', ''),
    ('M11 a stop-limit trigger is not logged', B, '      if (lo.o.row) lo.o.row.triggerTime = timeOf(bar)\n', ''),
    ('M12 an empty comment is kept as text', B, "const labelOf = (v) => (v === undefined || v === '' ? { text: null, recorded: true }",
     "const labelOf = (v) => (v === undefined ? { text: null, recorded: true }"),
    ('M13 a modification leaves the row as first placed', B,
     '        Object.assign(prev.row, entryRowOf(o, limV, stpV, cmt))\n', ''),
    ('M14 an empty comment reads as an empty text', B,
     "    if (r.comment === null) {\n      throw new BrokerRefusal(`\\`${fn}\\` reads an order placed without a comment",
     "    if (r.comment === 'never') {\n      throw new BrokerRefusal(`\\`${fn}\\` reads an order placed without a comment"),
    ('M15 a computed comment reads as none', B, '    if (!r.commentRecorded) {\n      throw new BrokerRefusal(`\\`${fn}\\` reads a comment the script computes',
     '    if (false) {\n      throw new BrokerRefusal(`\\`${fn}\\` reads a comment the script computes'),
    ('M16 exit_id reads the row id, not the exit id', B, '    const id = asExit ? exitIdOf(r) : r.id\n', '    const id = r.id || \'\'\n'),
    ('M18 the log reads opened from oid of nothing', B, '      add(opened, t.oid, i)\n', ''),
    # ── the record (strategyRecord.js) ──
    ('M19 a reversing entry\'s id is an exit id', REC, "(row.kind === 'exit' || row.kind === 'order')",
     "(row.kind === 'exit' || row.kind === 'order' || row.kind === 'entry')"),
    ('M20 strategy.order\'s id is not an exit id', REC, "(row.kind === 'exit' || row.kind === 'order')", "(row.kind === 'exit')"),
    ('M21 the label prefers the id over the comment', REC, "  if (typeof order.comment === 'string') return order.comment\n", ''),
    ('M22 trades.exitId always null', REC, 'exitId: t.exit ? exitIdOf(closer.get(i + 1)) : null,', 'exitId: null,'),
    ('M23 shape: a trade opened twice passes', REC, 'need(!opener.has(n), `trade ${n} opened twice`)', 'need(true, `trade ${n} opened twice`)'),
    ('M24 shape: exitId not checked against its order', REC, 't.exitId === exitIdOf(cl)', 'true'),
    ('M25 shape: an unfilled order may link trades', REC, 'need(filled || ((o.opened', 'need(true || ((o.opened'),
    ('M26 record: trade numbers off by one', REC, 'opened: o.opened.map((i) => i + 1)', 'opened: o.opened.map((i) => i)'),
    # ── the markers and the report ──
    ('M27 markers: an unknown label is drawn', MK, '    if (label === null) {\n      unlabelled.push(', '    if (false) {\n      unlabelled.push('),
    ('M28 markers: the MK-LOOK pin is not asked', MK, '  if (!isPinned(MARKER_RULE)) {', '  if (false) {'),
    ('M29 report: a computed comment reads as TradingView-named', REP, "      if (o && o.commentRecorded !== true) {", '      if (false) {'),
    ('M30 report: signals ignore the log', REP, "      const label = orderLabelOf(o, role)\n", "      const label = role === 'entry' ? t.entryId : (t.exitId || null)\n"),
    # ── the front end ──
    ('M31 a computed comment is lowered', SB, "    if (ORDER_COMMENT_PARAMS.includes(p) && node.type !== 'string') return { type: 'name', name: 'na', tok: node.tok }\n", ''),
    # ── r1 (review N1): a reversed trade's exit label refuses on every surface ──
    ('M32 r1: the reversal rule never fires', REC, "  return role === 'exit' && !!order && order.kind === 'entry'\n", "  return false\n"),
    ('M33 r1: the label rule ignores the reversal rule', REC, "  if (exitLabelUnstated(order, role)) return null\n", ''),
    ('M34 r1: exit_comment ignores the reversal rule', B, "        if (exitLabelUnstated(r, 'exit')) {", "        if (false) {"),
    ('M35 r1: the report gives the generic sentence for a reversal', REP, "      if (exitLabelUnstated(o, role)) {", "      if (false) {"),
]


def run_tests():
    cmd = ['npx', 'vitest', 'run', *TESTS, '--maxWorkers=1']
    p = subprocess.run(' '.join(cmd), cwd=APP, shell=True, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = p.stdout + p.stderr
    fm = re.search(r'(\d+) failed', out)
    return p.returncode, int(fm.group(1)) if fm else 0


def main():
    only = set(sys.argv[1:])
    results = []
    for name, rel, a, b in MUTANTS:
        if only and name.split()[0] not in only:
            continue
        path = os.path.join(APP, rel)
        raw = open(path, 'rb').read().decode('utf-8')
        crlf = '\r\n' in raw
        src = raw.replace('\r\n', '\n') if crlf else raw
        assert src.count(a) == 1, (name, src.count(a))
        backup = path + '.mutbak'
        shutil.copyfile(path, backup)
        try:
            out = src.replace(a, b)
            open(path, 'wb').write((out.replace('\n', '\r\n') if crlf else out).encode('utf-8'))
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
