"""Wave 11 lane 11A mutation proof (summary validation + the cap refusal).

    python tools/notebook_w11a_mutation_proof.py docs/notebook/evidence/w11a/mutation-backend-<sha>.txt

Each mutation of api/services/journal_two/voice_notes.py must turn its named rails in
tests/test_notebook_voice_notes.py RED. Every restore writes back the CAPTURED bytes
(never `git checkout`) and is verified against the committed blob, and the unmutated
control runs green before and after. Exit 0 only when every mutation is killed."""
import hashlib
import os
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
TARGET = REPO / "api/services/journal_two/voice_notes.py"
OUT = pathlib.Path(sys.argv[1])

MUTATIONS = [
    ("M1 ticker gate: an unsupported ticker is kept",
     "if not _SYMBOL.match(sym) or sym not in allowed or sym in tickers:",
     "if not _SYMBOL.match(sym) or sym in tickers:",
     "invented_ticker or route_answers_the_validated or stub_answers"),
    ("M2 summary gate: a summary naming an unsaid ticker/number is kept",
     "if any(s not in allowed for s in named) or not _numbers_supported(summary, transcript):",
     "if False:",
     "unsaid_ticker_or_number or nothing_usable"),
    ("M3 action-item grounding dropped",
     "if not s or not _grounded(s, low) or not _numbers_supported(s, transcript) or s in items:",
     "if not s or s in items:",
     "plain_text_and_grounded"),
    ("M4 cap: a recording longer than the minutes left is admitted",
     'if need > st["remainingSeconds"]:',
     "if False:",
     "minutes_left or open_job_holds"),
    ("M5 cap: a spent month is admitted",
     'if st["remainingSeconds"] <= 0:',
     "if False:",
     "spent_month or minutes_left"),
    ("M6 cap check skipped entirely (check_cap returns at once)",
     '    st = cap_state(user)\n    if st["unlimited"]:',
     '    return\n    st = cap_state(user)\n    if st["unlimited"]:',
     "minutes_left or spent_month or open_job_holds"),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def blob():
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", "HEAD:api/services/journal_two/voice_notes.py"],
                          capture_output=True, check=True).stdout


def clear_pyc():
    d = TARGET.parent / "__pycache__"
    if d.is_dir():
        for p in d.glob("voice_notes*.pyc"):
            p.unlink()


def run(k):
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    clear_pyc()
    r = subprocess.run([sys.executable, "-m", "pytest", "tests/test_notebook_voice_notes.py", "-q",
                        "-p", "no:cacheprovider", "-W", "ignore", "-k", k],
                       cwd=REPO, capture_output=True, text=True, env=env, timeout=600)
    tail = [ln for ln in r.stdout.splitlines() if ln.startswith(("FAILED", "ERROR")) or " passed" in ln or " failed" in ln]
    return r.returncode, tail


original = TARGET.read_bytes()
committed = blob()
lines = [f"target {TARGET.relative_to(REPO)}  captured sha {sha(original)}  committed blob sha {sha(committed)}"]
assert original.replace(b"\r\n", b"\n") == committed.replace(b"\r\n", b"\n"), "working file differs from HEAD before mutating"

rc, tail = run("validat or ticker or summary or cap or spent or minutes or open_job or grounded or stub")
lines.append(f"CONTROL (unmutated) rc={rc}: " + " | ".join(tail))
ok = rc == 0
for name, old, new, k in MUTATIONS:
    text = original.decode("utf-8")
    assert text.count(old) == 1, (name, text.count(old))
    try:
        TARGET.write_bytes(text.replace(old, new).encode("utf-8"))
        rc, tail = run(k)
    finally:
        TARGET.write_bytes(original)
        clear_pyc()
    restored = TARGET.read_bytes()
    verdict = "KILLED" if rc != 0 and any(t.startswith("FAILED") for t in tail) else "SURVIVED"
    ok = ok and verdict == "KILLED" and restored == original
    lines.append(f"{name}: rc={rc} {verdict}; restored sha {sha(restored)} == captured: {restored == original}")
    lines += [f"    {t}" for t in tail]

final = TARGET.read_bytes()
lines.append(f"FINAL working sha {sha(final)}; equals committed blob (LF-normalised): "
             f"{final.replace(b'\r\n', b'\n') == committed.replace(b'\r\n', b'\n')}")
rc, tail = run("validat or ticker or summary or cap or spent or minutes or open_job or grounded or stub")
lines.append(f"CONTROL after restore rc={rc}: " + " | ".join(tail))
ok = ok and rc == 0
lines.append("VERDICT: " + ("PASS - every mutation killed, every restore verified" if ok else "FAIL"))
OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines))
sys.exit(0 if ok else 1)
