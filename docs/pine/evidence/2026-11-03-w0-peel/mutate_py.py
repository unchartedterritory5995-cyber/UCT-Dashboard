import subprocess, sys, os, json
muts = [
 ("P1-probe-guard-first-again", "tools/pine_coverage/coverage_map.py",
  '        g = (pr.get("guard") if pr.get("agrees") is not False else None) or rd.get("code") or pr.get("guard")\n',
  '        g = pr.get("guard") or rd.get("code")\n'),
 ("P2-for-in-loop-stays-W4", "tools/pine_coverage/w0/targets.py",
  '    if w == "runtime:loop" and "for-in" in tags:\n', '    if False:\n'),
 ("P3-bare-security-stays-W4", "tools/pine_coverage/w0/targets.py",
  '    if w == "runtime:call-undeclared-builtin-state" and "bare-security" in tags:\n', '    if False:\n'),
 ("P4-order-strategy-no-output-stays-W4", "tools/pine_coverage/w0/targets.py",
  '    if w == "runtime:no-output" and order_strategy:\n', '    if False:\n'),
 ("P5-diverging-script-still-a-target", "tools/pine_coverage/w0/targets.py",
  '    cands = [r for r in rows if r["existingCapture"] not in ("MATCH", "DIVERGE")]\n',
  '    cands = [r for r in rows if r["existingCapture"] != "MATCH"]\n'),
 ("P6-runtime-on-items-credited-to-production", "tools/pine_coverage/w0/targets.py",
  '        covered[best["lane"]] |= set(new)\n', '        covered[PRODUCTION] |= set(new)\n'),
 ("P7-runtime-on-recounts-matched-items", "tools/pine_coverage/w0/targets.py",
  '        return g - set(rt_only) if r["lane"] == RUNTIME_ON else g\n', '        return g\n'),
 ("P8-tag-for-in-lost", "tools/pine_coverage/coverage_map.py",
  '    if guard == "runtime:loop" and "for \u2026 in" in', '    if False and "for \u2026 in" in'),
]
py = os.path.expanduser("~/uct-venv/Scripts/python.exe")
res = []
for name, f, old, new in muts:
    saved = open(f, 'rb').read(); s = saved.decode('utf-8')
    crlf = chr(13) + chr(10) in s
    if crlf:
        old = old.replace(chr(10), chr(13) + chr(10)); new = new.replace(chr(10), chr(13) + chr(10))
    if s.count(old) != 1:
        res.append((name, 'BADMATCH %d' % s.count(old))); continue
    open(f, 'wb').write(s.replace(old, new).encode('utf-8'))
    try:
        p = subprocess.run([py, '-m', 'pytest', 'tests/test_pine_coverage_w4_t0_honesty.py', '-q', '-p', 'no:cacheprovider', '-x'], capture_output=True, text=True)
        fails = [l for l in p.stdout.splitlines() if l.startswith('FAILED')][:2]
        res.append((name, 'KILLED' if p.returncode != 0 else 'SURVIVED', fails))
    finally:
        open(f, 'wb').write(saved)
for r in res: print(json.dumps(r))
