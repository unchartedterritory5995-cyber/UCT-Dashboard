import io, subprocess, sys, shutil, os
WT = 'C:/Users/Patrick/uct-worktrees/pine-dsk-w34t0'
CM = WT + '/tools/pine_coverage/coverage_map.py'
JS = WT + '/app/src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js'
PYT = ['python', '-m', 'pytest', 'tests/test_pine_coverage_w3w4_t0_honesty.py', '-q', '-p', 'no:cacheprovider', '-x', '--no-header']
JST = ['node', 'node_modules/vitest/vitest.mjs', 'run', 'src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js', '--maxWorkers=1', '-t', 'W3W4-T0']
MUTS = [
 ('P0 no-op control (comment only)', CM, 'DROP_VIA = " <- "', 'DROP_VIA = " <- "  # no-op', 'green'),
 ('P1 restore the attached-only drop read', CM, 'if (si == 0 and not st.get("attached") and step0_guards & OBJECT_PROGRAM_GUARDS', 'if (False and si == 0 and not st.get("attached") and step0_guards & OBJECT_PROGRAM_GUARDS', 'red'),
 ('P2 drop the guard resolution', CM, 'guards = sorted({h["guard"] for h in heads if ops and h["op"] in ops and h["guard"]})', 'guards = []', 'red'),
 ('P3 drop the paint split', CM, 'BUCKET_PAINT_WITHHELD if paint_only else "drawing-objects"', '"drawing-objects"', 'red'),
 ('P4 never-attempted folded into no-output-other', CM, 'BUCKET_NEVER_ATTEMPTED if split == "never-attempted" else BUCKET_NO_OUTPUT_OTHER', 'BUCKET_NO_OUTPUT_OTHER', 'red'),
 ('P5 resolved drop keeps the drawing-objects capability', CM, 'return GUARD_BUCKET.get(g, "drawing-objects") if g else "drawing-objects"', 'return "drawing-objects"', 'red'),
 ('P6 no-output other folded into never-attempted', CM, '"never-attempted" if not (st.get("attemptedOps") or 0) else "no-output-other"', '"never-attempted"', 'red'),
 ('P7 guard beside no-output no longer wins', CM, 'and not any(GUARD_BUCKET.get(g) != "output-contract" and g not in OBJECT_PROGRAM_GUARDS', 'and not any(False and g not in OBJECT_PROGRAM_GUARDS', 'red'),
 ('P8 attached dirty drops read the old unresolved key', CM, 'for k, _ in drop_walls(st):\n        keys.add(k)', 'for k, _ in drop_walls(st):\n        keys.add(("drop", k[1].split(DROP_VIA)[0]))', 'red'),
 ('J0 no-op control', JS, "return [...new Set(out)].slice(0, 60)", "return [...new Set(out)].slice(0, 61)", 'green'),
 ('J1 dropHeads returns nothing', JS, "return [...new Set(out)].slice(0, 60)", "return []", 'red'),
 ('J2 dropHeads keeps the message text', JS, "if (m) out.push(`create:${m[1]}@${m[2]}: ${m[3] === 'no' ? 'unrecorded' : m[3]}`)", "if (m) out.push(String(e))", 'red'),
]
res = []
for name, path, a, b, want in MUTS:
    s = io.open(path, encoding='utf-8', newline='').read()
    crlf = '\r\n' in s
    s2 = s.replace('\r\n', '\n')
    if a not in s2:
        res.append((name, 'NOT-APPLIED', want)); continue
    bak = path + '.mutbak'
    shutil.copy(path, bak)
    try:
        io.open(path, 'w', encoding='utf-8', newline='').write(s2.replace(a, b, 1).replace('\n', '\r\n') if crlf else s2.replace(a, b, 1))
        for d in ('tools/pine_coverage/__pycache__',):
            shutil.rmtree(os.path.join(WT, d), ignore_errors=True)   # lesson: pycache defeats same-length mutation
        if path == CM:
            r = subprocess.run(PYT, cwd=WT, capture_output=True, text=True)
        else:
            r = subprocess.run(JST, cwd=WT + '/app', capture_output=True, text=True, shell=True)
        got = 'green' if r.returncode == 0 else 'red'
        res.append((name, got, want, 'OK' if got == want else 'MISMATCH'))
    finally:
        shutil.copy(bak, path); os.remove(bak)
        shutil.rmtree(os.path.join(WT, 'tools/pine_coverage/__pycache__'), ignore_errors=True)
for r in res: print(r)
