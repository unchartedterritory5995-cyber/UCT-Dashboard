"""r1 mutation driver: each edit is applied to definition_record.py, the named test file run, the
bytes restored. Run from the worktree root: python docs/pine/evidence/2026-11-04-w5-t16/mutate_r1.py"""
import os, pathlib, subprocess, sys
P = pathlib.Path('api/services/definition_record.py')
orig = P.read_bytes()
CRLF = b'\r\n' in orig
src = orig.decode('utf-8').replace('\r\n', '\n')
i = src.index('def record_runtime_pass')
def at(old, new, start=i):
    k = src.index(old, start)
    return src[:k] + new + src[k + len(old):]
M = [
 ("pass the label as the service tf", at("tf=_service_tf(tf_label)", "tf=tf_label")),
 ("_service_tf returns label", at('            return code\n    raise', '            return label\n    raise', src.index('def _service_tf'))),
 ("pad ignored", at("_tally(column, bars, n)", "_tally(column, bars, 0)")),
 ("warm-up guard removed", at("if isinstance(n, bool) or not isinstance(n, int) or not 0 <= n <= len(bars):", "if False:")),
 ("bool warm-up accepted", at("if isinstance(n, bool) or not", "if not")),
 ("warm-up upper bound dropped", at("or not 0 <= n <= len(bars):", "or not 0 <= n:")),
 ("warm-up lower bound dropped", at("or not 0 <= n <= len(bars):", "or not n <= len(bars):")),
 ("def_hash constant", at("def_hash = runtime_definitions.handle(definition)", "def_hash = 'sha256:' + '0' * 64")),
 ("def_hash stripped of the runtime prefix", at("def_hash = runtime_definitions.handle(definition)", "def_hash = runtime_definitions.handle(definition).split(':', 1)[1]")),
 ("runtime key shape refused", src.replace('[0-9a-f]{64}$")', '[0-9a-f]{65}$")', 1)),
 ("tree shape replaced by a copy", src.replace("_HASH_RE = _defs.RESULT_IDENTITY_RE", "_HASH_RE = re.compile(_defs.RESULT_IDENTITY_RE.pattern, re.ASCII)", 1)),
 ("key shape ignores the tree identity", src.replace("bool(_HASH_RE.match(value) or _runtime_key_re().match(value))", "bool(_runtime_key_re().match(value))", 1)),
 ("column length unchecked", at("or len(column) != len(bars):", ":")),
 ("runtime check removed", at("if not runtime_definitions.is_runtime(definition):", "if False:")),
 ("withheld not caught", at("except runtime_server_lane.ServerLaneWithheld as exc:", "except ZeroDivisionError as exc:")),
 ("lane record -> alert", at('fn = column_fn or runtime_server_lane.runtime_column_fn(row, plot_key, "record")', 'fn = column_fn or runtime_server_lane.runtime_column_fn(row, plot_key, "alert")')),
 ("zero-evaluated row written", at('if evaluated == 0:\n        out["skipped"] = "no bar in this window was computable"\n        return out\n    out["recorded"]', 'if False:\n        return out\n    out["recorded"]')),
 ("forward-only origin gate off", src.replace("if started is not None and first_key < started:", "if False:", 1)),
]
res = []
try:
    for name, new in M:
        P.write_bytes((new.replace('\n', '\r\n') if CRLF else new).encode('utf-8'))
        r = subprocess.run([sys.executable, "-B", "-m", "pytest", "tests/test_definition_record_runtime.py", "-q", "-x", "-p", "no:cacheprovider"],
                           capture_output=True, text=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        f = [l for l in r.stdout.splitlines() if l.startswith("FAILED")][:1]
        res.append((name, "KILLED" if r.returncode else "SURVIVED", f))
        print(res[-1], flush=True)
finally:
    P.write_bytes(orig)
print("restored", P.read_bytes() == orig)
