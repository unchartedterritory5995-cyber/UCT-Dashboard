"""Wave 13 lane 13B mutation proof -- break each load-bearing guard of My Playbook, one at a time,
and show a rail goes RED.

    python tools/notebook_w13b_mutation_proof.py docs/notebook/evidence/wave13-13b/mutation-<sha>.txt

Guards: R3's boundaries and range (Python and JS, the parity rail), "no stat without its n", the
too-few reveal, every displayed number being the payload's, the drill being the same rows as the
count, the broker mirror, the patterns' as-of-entry reading and their minimums and citations, the
frozen snapshot, and the gate.

Same discipline as 13A's harness (tools/notebook_w13a_mutation_proof.py): each mutation is applied
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
SS = "api/services/journal_two/sample_size.py"
PS = "api/services/journal_two/playbook_stats.py"
PP = "api/services/journal_two/playbook_patterns.py"
RT = "api/routers/notebook_playbook.py"
PAGE = f"{J2}/components/insights/MyPlaybook.jsx"
SSJS = f"{J2}/lib/sampleSize.js"
SNAP = f"{J2}/lib/playbookSnapshot.js"

PY_SS = "tests/test_notebook_sample_size.py"
PY_PB = "tests/test_notebook_playbook.py"
VT_PAGE = f"{J2}/components/insights/MyPlaybook.test.jsx"
VT_SS = f"{J2}/lib/sampleSize.test.js"
VT_SNAP = f"{J2}/lib/playbookSnapshot.test.js"

# (name, path, old, new, rails)
MUTATIONS = [
    ("N1 no stat without its n: the n chip is dropped from every stat", PAGE,
     "      <span className={styles.statValue}>{body}{' '}{nChip}</span>\n",
     "      <span className={styles.statValue}>{body}</span>\n", [VT_PAGE]),
    ("R1 R3 boundary (Python): 'too few to judge' ends at 9, not 10", SS,
     "TOO_FEW_BELOW = 10\n", "TOO_FEW_BELOW = 9\n", [PY_SS]),
    ("R2 R3 boundary (JS): 'normal' starts at 24, not 25 -- the parity rail sees it", SSJS,
     "export const NORMAL_FROM = 25\n", "export const NORMAL_FROM = 24\n", [PY_SS, VT_SS]),
    ("R3 range: the Wilson z at 90% (1.645), not 95%", SS,
     "RANGE_Z = 1.96\n", "RANGE_Z = 1.645\n", [PY_SS, PY_PB]),
    ("R4 reveal: a too-few stat is shown plainly, not behind 'too few to judge'", PAGE,
     "  } else if (stat.band === 'too_few') {\n", "  } else if (stat.band === 'never') {\n", [VT_PAGE]),
    ("P1 payload: the drill's P&L is recomputed on the client (x1.01)", PAGE,
     "              <td>{t.pnlDollar.toFixed(2)}</td>\n", "              <td>{(t.pnlDollar * 1.01).toFixed(2)}</td>\n",
     [VT_PAGE]),
    ("D1 drill: the trades list drops its first row (no longer the same rows as the count)", PS,
     '        record["trades"] = [_drill_row(r) for r in rows]\n',
     '        record["trades"] = [_drill_row(r) for r in rows[1:]]\n', [PY_PB]),
    ("M1 mirror: broker trades are filtered out of the per-setup cards", PS,
     "            \"   AND setup IS NOT NULL AND TRIM(setup) != ''\"\n",
     "            \"   AND setup IS NOT NULL AND TRIM(setup) != '' AND COALESCE(source, '') != 'broker'\"\n", [PY_PB]),
    ("A1 as-of-entry: a note edited after entry with no earlier version is read anyway", PP,
     "        if state[\"post_entry\"]:\n            continue   # edited after entry",
     "        if False:\n            continue   # edited after entry", [PY_PB]),
    ("A2 before: a note written AFTER entry counts as a before-note", PP,
     "        if created is None or created > cutoff:\n", "        if created is None:\n", [PY_PB]),
    ("Q1 minimums: one mention is enough to be a finding", PP,
     '        if total < CONSTANTS["MIN_MENTIONS"]:\n', "        if total < 1:\n", [PY_PB]),
    ("C1 citations: a finding cites only its losses", PP,
     "                 for t, notes in hit_l + hit_w]\n", "                 for t, notes in hit_l]\n", [PY_PB]),
    ("S1 frozen snapshot: a live widget slips into the note", SNAP,
     "  const untagged = payload?.untagged?.count || 0\n",
     "  content.push({ type: 'widgetEmbed', attrs: { widgetId: 'playbook', mode: 'live' } })\n"
     "  const untagged = payload?.untagged?.count || 0\n", [VT_SNAP]),
    ("G1 gate: the route gate's default flipped ON", RT,
     "    return flag_on(FLAG, False)\n", "    return flag_on(FLAG, True)\n", [PY_PB]),
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
    out = [f"lane 13B mutation proof at HEAD {head}"]
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
