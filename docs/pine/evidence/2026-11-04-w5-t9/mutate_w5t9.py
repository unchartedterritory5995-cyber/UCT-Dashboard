"""W5-T9 mutation proof. usage: python mutate_w5t9.py <muts.json> [--only name,...]
Each entry: [name, file, old, new, kind]; kind 'node' (node --test on the two T9 files) or 'py'
(pytest on the smoke tests). `old` must occur exactly once; the file's saved bytes are restored
byte-exact in a finally and asserted. A mutation is KILLED when the run exits non-zero."""
import json, os, subprocess, sys

NODE = ['node', '--test', '--test-force-exit', '--test-concurrency=1', '--test-timeout=120000',
        'services/pine_runtime/test/canary.test.mjs', 'services/pine_runtime/test/metrics.test.mjs']
PY = [sys.executable, '-B', '-m', 'pytest', 'tests/test_pine_runtime_service_smoke.py', '-q', '-x', '-p', 'no:cacheprovider']
muts = json.load(open(sys.argv[1], encoding='utf-8'))
only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 and sys.argv[2] == '--only' else None
env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
for name, f, old, new, kind in muts:
    if only and name not in only:
        continue
    saved = open(f, 'rb').read()
    s = saved.decode('utf-8')
    crlf = '\r\n' in s
    o, n = (old.replace('\n', '\r\n'), new.replace('\n', '\r\n')) if crlf else (old, new)
    if s.count(o) != 1:
        print(json.dumps([name, 'BADMATCH', s.count(o)])); continue
    tmp = f + '.mut'
    open(tmp, 'wb').write(s.replace(o, n).encode('utf-8')); os.replace(tmp, f)
    try:
        p = subprocess.run(NODE if kind == 'node' else PY, capture_output=True, text=True, encoding='utf-8', errors='replace', env=env, timeout=600)
        out = p.stdout + p.stderr
        who = [l.strip()[:110] for l in out.splitlines() if l.lstrip().startswith(('\u2716', 'FAILED tests/')) and 'failing tests' not in l][:2]
        print(json.dumps([name, 'KILLED' if p.returncode != 0 else 'SURVIVED', who], ensure_ascii=True), flush=True)
    finally:
        tmp = f + '.restore'
        open(tmp, 'wb').write(saved); os.replace(tmp, f)
        assert open(f, 'rb').read() == saved
