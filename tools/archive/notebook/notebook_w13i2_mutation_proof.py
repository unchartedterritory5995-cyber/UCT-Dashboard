"""Wave 13 lane 13I-2 mutation proof -- break each load-bearing guard of the fingerprint panel
and the visual playbook, one at a time, and show a rail goes RED.

    python tools/notebook_w13i2_mutation_proof.py docs/notebook/evidence/wave13-13i2/mutation-<sha>.txt

Guards: the freeze is written ONLY through the member's own save path (`updateAttributes`) and only
after the save lands; a suggestion never applies itself; the outcome joins on the STABLE trade_ref;
the slice stats are the per-setup authority's arithmetic; the R3 band; a missing value never passes
a range; the gate (router dependency and its default); the checklist marks the Checklist and not
another list; the "too few to judge" stats stay behind their reveal.

Each mutation is applied to the CAPTURED bytes of one file and the named rail files are run WHOLE
(never `-k` / `vitest -t`, which can match nothing and exit 0). A mutation is KILLED only when the
run reports at least one failed test. Every restore writes back the captured bytes -- never `git
checkout` -- and is verified against the committed blob (`git cat-file blob HEAD:<path>`, line
endings normalised). An unmutated control runs green before and after. Exit 0 only when every
mutation is killed and every restore verified. (Adapted from tools/notebook_w13a_mutation_proof.py.)
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
VP = "api/services/journal_two/visual_playbook.py"
ROUTER = "api/routers/notebook_visual_playbook.py"
PANEL = f"{J2}/components/notebook/FingerprintPanel.jsx"
BOOK = f"{J2}/components/notebook/VisualPlaybook.jsx"
CHECK = f"{J2}/lib/fingerprintChecklist.js"

PY_VP = "tests/test_notebook_visual_playbook.py"
VT_PANEL = f"{J2}/components/notebook/FingerprintPanel.test.jsx"
VT_BOOK = f"{J2}/components/notebook/VisualPlaybook.test.jsx"
VT_CHECK = f"{J2}/lib/fingerprintChecklist.test.js"

# (name, path, old, new, rails)
MUTATIONS = [
    ("P1 save path: the freeze is written by a PUT to the note instead of updateAttributes", PANEL,
     "    updateAttributes?.({ ta: withFingerprint(attrsRef.current?.ta, fingerprint, { replace }) })\n",
     "    fetch(`/api/j2/notes/${editor?.storage?.uctJournalWidgets?.noteId}`, { method: 'PUT', credentials: 'include',"
     " body: JSON.stringify({ ta: withFingerprint(attrsRef.current?.ta, fingerprint, { replace }) }) })\n",
     [VT_PANEL]),
    ("P2 after the save lands: a 404 (save not landed) stops instead of retrying", PANEL,
     "      if (e.status === 404) { setState('waiting'); return 'retry' }   // the save has not landed yet\n",
     "      if (e.status === 404) { setState('error'); return 'stop' }\n", [VT_PANEL]),
    ("S1 suggestion: the first confirmed detection is applied without a click", PANEL,
     "  const templateKey = planTemplateForTag(ta?.setupTag)\n",
     "  useEffect(() => { if (suggestions[0] && !ta?.setupTag) setTag(suggestions[0].tag) })\n"
     "  const templateKey = planTemplateForTag(ta?.setupTag)\n", [VT_PANEL]),
    ("O1 stable key: the outcome joins on j2_trades.id (a broker resync reissues it)", VP,
     '            t = resolve_trade_by_ref(user_id, ln["trade_ref"], conn)\n',
     '            t = conn.execute("SELECT * FROM j2_trades WHERE user_id = ? AND id = ?",'
     ' (user_id, ln["trade_ref"].split(":", 1)[1])).fetchone()\n', [PY_VP]),
    ("A1 authority: the slice win rate re-derived over ALL trades (breakeven in the denominator)", VP,
     '        "winRate": rec["winRate"], "avgR": rec["avgR"], "rTrades": len(rs),\n',
     '        "winRate": round(wins / len(rows), 4), "avgR": rec["avgR"], "rTrades": len(rs),\n', [PY_VP]),
    ("R1 R3: the band is read one trade high (9 reads thin)", VP,
     "    band = plan_grading.sample_band(n)\n", "    band = plan_grading.sample_band(n + 1)\n", [PY_VP]),
    ("X1 ranges: a block with no number for the field PASSES the range", VP,
     "    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):\n        return None\n",
     "    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):\n        return True\n",
     [PY_VP]),
    ("G1 gate: the router dependency never refuses", ROUTER,
     "    if not vp.enabled():\n        raise public.not_found()\n", "    if False:\n        raise public.not_found()\n",
     [PY_VP]),
    ("G2 gate: the gate's default flipped ON", VP,
     "    return flag_on(FLAG, False)\n", "    return flag_on(FLAG, True)\n", [PY_VP]),
    ("C1 checklist: the evidence lands on the LAST bullet list (Management), not the Checklist", CHECK,
     "  const list = at >= 0 ? content.slice(at + 1).find((n) => n.type === 'bulletList') : null\n  if (!list) return out\n",
     "  const list = content.filter((n) => n.type === 'bulletList').at(-1)\n  if (!list) return out\n", [VT_CHECK]),
    ("V1 R3 reveal: 'too few to judge' shows its numbers without the reveal", BOOK,
     "      {stats.band === 'too_few' ? (\n", "      {false ? (\n", [VT_BOOK]),
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
        r = subprocess.run([NPX, "vitest", "run", *[v[len("app/"):] for v in vt], "--maxWorkers=1"],
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
    out = [f"lane 13I-2 mutation proof at HEAD {head}"]
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
