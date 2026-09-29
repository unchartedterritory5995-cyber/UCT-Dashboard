"""Lane SK mutation harness: each mutation must RED the named rail; restore by content hash
and prove the restore against the COMMITTED blob (git cat-file), never our own capture alone."""
import hashlib, os, pathlib, re, subprocess, sys, time

REPO = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\notebook-w10-sk")
SCRIPT = REPO / "scripts" / "hub_sandbox_boot.py"
PROBE = REPO / "api" / "services" / "_w10sk_mutation_probe.py"
TEST = "tests/test_hub_sandbox_model_keys.py"
OUT = REPO / "docs" / "notebook" / "proof" / "w10-sk" / "mutation-log.txt"

def sha(b): return hashlib.sha256(b).hexdigest()
def blob(rel):
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", f"HEAD:{rel}"],
                          capture_output=True, check=True).stdout

def run():
    for pyc in (REPO / "scripts" / "__pycache__").glob("hub_sandbox_boot*.pyc"):
        pyc.unlink()
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    r = subprocess.run([sys.executable, "-m", "pytest", TEST, "-q", "-p", "no:cacheprovider",
                        "-W", "ignore", "-rf"], cwd=REPO, capture_output=True, text=True, env=env)
    out = r.stdout + r.stderr
    totals = [l for l in out.splitlines() if re.search(r"\d+ (passed|failed)", l)]
    failed = sorted(set(re.findall(r"FAILED tests/test_hub_sandbox_model_keys.py::(\w+)", out)))
    return r.returncode, (totals[-1].strip() if totals else "NO TOTALS LINE"), failed

MUT = [
 ("M1 blanking loop removed", "a", SCRIPT, '        environ[key] = ""\n', '        pass\n'),
 ("M2 pop instead of blank", "a", SCRIPT, '        environ[key] = ""\n', '        environ.pop(key, None)\n'),
 ("M3 policy not called by apply_sandbox_env", "a", SCRIPT,
  '    print(apply_model_key_policy(os.environ, allow_model_keys), flush=True)\n', '    pass\n'),
 ("M4 opt-in ignored (always blanks)", "b", SCRIPT, '    if allow:\n', '    if False:\n'),
 ("M5 env opt-in accepts any non-empty value", "b", SCRIPT,
  'environ.get(ALLOW_MODEL_KEYS_ENV, "") == "1"', 'environ.get(ALLOW_MODEL_KEYS_ENV, "") != ""'),
 ("M6 PERPLEXITY_API_KEY dropped from the model list", "c", SCRIPT,
  '    "PERPLEXITY_API_KEY",        # api/services/perplexity_search.py:430\n', ''),
 ("M7 OPENAI_API_KEY reclassified NON-model", "c", SCRIPT,
  [('    "OPENAI_API_KEY",            # api/services/voice_openai.py:118\n', ''),
   ('    "TWITTERAPI_IO_API_KEY", "UW_API_KEY",\n',
    '    "TWITTERAPI_IO_API_KEY", "UW_API_KEY", "OPENAI_API_KEY",\n')], None),
 ("M8 a new provider key read in api/ (XAI_API_KEY)", "c", PROBE, None,
  'import os\nXAI = os.environ.get("XAI_API_KEY", "")\n'),
 ("M9 phantom classified name with no read site", "c", SCRIPT,
  '    "TWITTERAPI_IO_API_KEY", "UW_API_KEY",\n', '    "TWITTERAPI_IO_API_KEY", "UW_API_KEY", "GHOST_API_KEY",\n'),
]

lines = [f"# lane SK mutation log -- {time.strftime('%Y-%m-%dT%H:%M:%S%z')}",
         f"# HEAD {subprocess.run(['git','-C',str(REPO),'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip()}",
         f"# suite: {TEST}", ""]
orig = SCRIPT.read_bytes()
assert sha(orig) == sha(blob("scripts/hub_sandbox_boot.py")), "script not at HEAD before starting"
rc, tot, failed = run()
lines.append(f"CONTROL (unmutated): rc={rc} | {tot} | failed={failed}")
ok = rc == 0 and not failed
killed = 0
for name, rail, path, old, new in MUT:
    if path == PROBE:
        assert not PROBE.exists()
        PROBE.write_text(new, encoding="utf-8")
    else:
        s = orig.decode("utf-8")
        for o, n in (old if isinstance(old, list) else [(old, new)]):
            assert s.count(o) == 1, (name, s.count(o))
            s = s.replace(o, n)
        path.write_bytes(s.encode("utf-8"))
    try:
        rc, tot, failed = run()
    finally:
        if path == PROBE:
            PROBE.unlink()
        else:
            SCRIPT.write_bytes(orig)
    restored = sha(SCRIPT.read_bytes()) == sha(blob("scripts/hub_sandbox_boot.py")) and not PROBE.exists()
    red = rc != 0 and bool(failed)
    killed += red
    lines.append(f"{name} [rail {rail}]: {'RED (killed)' if red else 'GREEN (SURVIVED)'} rc={rc} | {tot}")
    lines.append(f"    failed: {failed}")
    lines.append(f"    restored == HEAD blob: {restored}")
    ok = ok and red and restored
rc, tot, failed = run()
lines.append(f"CONTROL (after restore): rc={rc} | {tot} | failed={failed}")
ok = ok and rc == 0 and not failed
lines.append(f"\nVERDICT: {killed}/{len(MUT)} mutations killed; controls green; {'PASS' if ok else 'FAIL'}")
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_bytes(("\n".join(lines) + "\n").encode("utf-8"))
print("\n".join(lines))
sys.exit(0 if ok else 1)
