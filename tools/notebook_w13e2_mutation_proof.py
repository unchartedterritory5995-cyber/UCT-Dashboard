"""Wave 13 lane 13E-2 mutation proof -- break each load-bearing guard of the card, the prompt and
the bell, one at a time, and show a rail goes RED.

    python tools/notebook_w13e2_mutation_proof.py docs/notebook/evidence/wave13-13e2/mutation-<sha>.txt

Guards named by the brief: one bell line a day, a past day reads "not captured" (never field
rows), no microphone with the voice flag off, and purge.

Same discipline as 13B's harness (tools/notebook_w13b_mutation_proof.py): each mutation is applied
to the CAPTURED bytes of one file, the named rail FILES are run whole (never -k / vitest -t, which
can match nothing and exit 0), a mutation is KILLED only when the run reports at least one failed
test, every restore writes back the captured bytes -- never `git checkout` -- and is verified
against the committed blob (`git cat-file blob HEAD:<path>`, line endings normalised). An
unmutated control runs green before and after. Exit 0 only when every mutation is killed and
every restore verified.
"""
import hashlib
import os
import pathlib
import re
import shutil
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
APP = REPO / "app"
OUT = pathlib.Path(sys.argv[1])
J2 = "app/src/pages/journal-2-0"

SVC = "api/services/journal_two/entry_context.py"
PURGE = "api/services/journal_two/account_purge.py"
CARD = f"{J2}/components/EntryContextCard.jsx"
WHY = f"{J2}/components/WhyPrompt.jsx"

PY_BELL = "tests/test_notebook_entry_context_bell.py"
VT_CARD = f"{J2}/components/EntryContextCard.test.jsx"
VT_WHY = f"{J2}/components/WhyPrompt.test.jsx"

# (name, path, old, new, rails)
MUTATIONS = [
    ("B1 bell: the per-day claim's early return is dropped -- every freeze delivers", SVC,
     '            if cur.rowcount == 0:\n                return False\n',
     '            if False:\n                return False\n',
     [PY_BELL]),
    ("B3 bell: a failed delivery never releases its claim (a later freeze that day never retries)", SVC,
     '            except Exception:  # noqa: BLE001 -- a bell failure must never surface\n'
     '                c.execute("DELETE FROM j2_entry_context_bell_log WHERE user_id = ? AND day = ?",\n'
     '                         (str(user_id), day))\n'
     '                c.commit()\n'
     '                return False\n',
     '            except Exception:  # noqa: BLE001 -- a bell failure must never surface\n'
     '                return False\n',
     [PY_BELL]),
    ("N1 not-captured: the card renders field rows instead of the server's own sentence", CARD,
     "  if (status !== 'captured' || !context) {\n",
     "  if (false) {\n",
     [VT_CARD]),
    ("V1 voice: the dictation control (and its microphone) mounts even with the flag off", WHY,
     "        {voiceOn && (\n",
     "        {true && (\n",
     [VT_WHY]),
    ("P1 purge: the bell-log claim table is dropped from the purge manifest", PURGE,
     '    # Wave 13 (lane 13E-2, the one-a-day new-fill bell) -- the claim log that dedupes it.\n'
     '    # Self-ensured by entry_context.py; same no-op-on-a-fresh-pod note as the row above.\n'
     '    "j2_entry_context_bell_log",\n',
     '    # Wave 13 (lane 13E-2, the one-a-day new-fill bell) -- the claim log that dedupes it.\n'
     '    # Self-ensured by entry_context.py; same no-op-on-a-fresh-pod note as the row above.\n',
     [PY_BELL]),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def blob(rel):
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", f"HEAD:{rel}"],
                          capture_output=True, check=True).stdout


def norm(b):
    return b.replace(b"\r\n", b"\n")


def clear_pyc(rel):
    p = REPO / rel
    d = p.parent / "__pycache__"
    if d.is_dir():
        for f in d.glob(p.stem + "*.pyc"):
            f.unlink()


NPX = shutil.which("npx") or shutil.which("npx.cmd")


def run(rails):
    """Run rail FILES whole; return (rc, failed_count, summary lines)."""
    vt = [r for r in rails if r.startswith("app/")]
    py = [r for r in rails if not r.startswith("app/")]
    failed, lines, rc = 0, [], 0
    if vt:
        r = subprocess.run([NPX, "vitest", "run", *[v[len("app/"):] for v in vt], "--maxWorkers=1",
                            "--testTimeout=120000"],
                           cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1200)
        txt = re.sub(r"\x1b\[[0-9;]*m", "", r.stdout + r.stderr)
        tot = [ln.strip() for ln in txt.splitlines() if re.match(r"\s*(Test Files|Tests)\s", ln)]
        m = re.search(r"Tests\s+(\d+) failed", txt)
        failed += int(m.group(1)) if m else 0
        if not tot:
            lines.append("vitest: NO TOTALS LINE (a run without one is not a run)")
            rc = rc or 99
        lines += [f"vitest: {t}" for t in tot]
        lines += [f"  {ln.strip()}" for ln in txt.splitlines() if " FAIL " in ln or ln.strip().startswith("×")][:6]
        rc = rc or r.returncode
    if py:
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        r = subprocess.run([sys.executable, "-m", "pytest", *py, "-q", "-p", "no:cacheprovider", "-W", "ignore"],
                           cwd=REPO, capture_output=True, text=True, env=env, timeout=1800)
        tot = [ln for ln in r.stdout.splitlines() if re.search(r"\d+ (passed|failed)", ln)]
        m = re.search(r"(\d+) failed", r.stdout)
        failed += int(m.group(1)) if m else 0
        if not tot:
            lines.append("pytest: NO TOTALS LINE")
            rc = rc or 99
        lines += [f"pytest: {t}" for t in tot[-1:]]
        lines += [f"  {ln}" for ln in r.stdout.splitlines() if ln.startswith("FAILED")][:6]
        rc = rc or r.returncode
    return rc, failed, lines


def main() -> int:
    head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    out = [f"lane 13E-2 mutation proof at HEAD {head}"]
    all_rails = sorted({r for m in MUTATIONS for r in m[4]})
    ok = True
    rc, failed, lines = run(all_rails)
    out.append(f"CONTROL before (unmutated) rc={rc} failed={failed}")
    out += lines
    ok = ok and rc == 0 and failed == 0

    for name, rel, old, new, rails in MUTATIONS:
        path = REPO / rel
        original = path.read_bytes()
        committed = blob(rel)
        if norm(original) != norm(committed):
            out.append(f"{name}: SKIPPED -- {rel} differs from HEAD before mutating (commit first)")
            ok = False
            continue
        text = original.decode("utf-8")
        n = text.replace("\r\n", "\n").count(old)
        if n != 1:
            out.append(f"{name}: SKIPPED -- the target text occurs {n} times in {rel}")
            ok = False
            continue
        mutated = text.replace("\r\n", "\n").replace(old, new)
        if "\r\n" in text:
            mutated = mutated.replace("\n", "\r\n")
        try:
            path.write_bytes(mutated.encode("utf-8"))
            clear_pyc(rel)
            rc, failed, lines = run(rails)
        finally:
            path.write_bytes(original)
            clear_pyc(rel)
        restored = path.read_bytes()
        verified = restored == original and norm(restored) == norm(committed)
        verdict = "KILLED" if failed > 0 else "SURVIVED"
        ok = ok and verdict == "KILLED" and verified
        out.append(f"{name}: {verdict} (rc={rc}, failed tests={failed}); restored sha {sha(restored)[:16]} == captured: "
                   f"{restored == original}; == committed blob (LF-normalised): {norm(restored) == norm(committed)}")
        out += [f"    {ln}" for ln in lines]

    rc, failed, lines = run(all_rails)
    out.append(f"CONTROL after restore rc={rc} failed={failed}")
    out += lines
    ok = ok and rc == 0 and failed == 0
    dirty = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "--", "api", "app/src"],
                           capture_output=True, text=True).stdout.strip()
    out.append(f"git status over api/ and app/src after the run: {dirty or 'clean'}")
    ok = ok and not dirty
    out.append("VERDICT: " + ("PASS - every mutation killed, every restore verified against the committed blob" if ok else "FAIL"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    print("\n".join(out))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
