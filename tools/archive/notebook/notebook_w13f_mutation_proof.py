"""Wave 13 lane 13F mutation proof -- break each load-bearing guard of the leak finder and
the review-drafts data/doc pipeline, one at a time, and show a rail goes RED.

    python tools/notebook_w13f_mutation_proof.py docs/notebook/evidence/wave13-13f/mutation-<sha>.txt

Guards: a finding's trades always sum to its dollars; a finding with nothing to cite is never a
placeholder; the placeholder-stop skip in "sizing up after a loss"; the regime vocabulary
(amber is NOT unfavourable); held-into-earnings' date window; the weak-time-window pick (worst,
never best); Compass SKIP membership; unplanned/stops-not-honoured's status and check reads; the
router's 404 gate; the weekly window boundary; the client's reveal (below n=10 collapsed, never
plain); frozen charts never carrying live-workspace drawings; Compass quoted only when present;
the daily append's compare-and-set baseline; and the two UI doors' own flag gates.

Same discipline as 13B's harness (tools/notebook_w13b_mutation_proof.py): each mutation is
applied to the CAPTURED bytes of one file, the named rail FILES are run whole (never -k /
vitest -t), a mutation is KILLED only when the run reports at least one failed test, every
restore writes back the captured bytes -- never `git checkout` -- and is verified against the
committed blob (`git cat-file blob HEAD:<path>`, line endings normalised). An unmutated control
runs green before and after. Exit 0 only when every mutation is killed and every restore
verified.
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

LF = "api/services/journal_two/leak_finder.py"
RD = "api/services/journal_two/review_drafts.py"
RT = "api/routers/notebook_review_drafts.py"
RDJS = f"{J2}/lib/reviewDrafts.js"
EOD = f"{J2}/components/EODRecap.jsx"
CR = f"{J2}/components/CompassReview.jsx"

PY_LF = "tests/test_leak_finder.py"
PY_RD = "tests/test_review_drafts.py"
VT_RDJS = f"{J2}/lib/reviewDrafts.test.js"
VT_EOD = f"{J2}/components/EODRecap.test.jsx"
VT_CR = f"{J2}/components/CompassReview.test.jsx"

# (name, path, old, new, rails)
MUTATIONS = [
    ("F1 a finding's dollars no longer equal the sum of its own cited trades", LF,
     '    net = sum(t["pnlDollarNet"] for t in cited)\n',
     '    net = sum(t["pnlDollarNet"] for t in cited) * 1.1\n', [PY_LF]),
    ("F2 a finding with nothing to cite is returned anyway (a placeholder)", LF,
     "    if not cited:\n        return None\n", "    if False:\n        return None\n", [PY_LF]),
    ("S1 sizing-up-after-a-loss stops skipping the broker placeholder stop", LF,
     "    if is_placeholder_stop(stop, entry):\n        return None\n",
     "    if False:\n        return None\n", [PY_LF]),
    ("R1 regime vocabulary: amber joins the unfavourable set", LF,
     'UNFAVOURABLE_REGIMES = frozenset({"orange", "red"})\n',
     'UNFAVOURABLE_REGIMES = frozenset({"orange", "red", "amber"})\n', [PY_LF]),
    ("E1 held-into-earnings: the window test is inverted", LF,
     "        if entry_day and exit_day and entry_day <= report_date <= exit_day:\n",
     "        if entry_day and exit_day and report_date <= entry_day:\n", [PY_LF]),
    ("W1 weak time window: the WORST hour is replaced by the best", LF,
     '        if worst_avg is None or avg < worst_avg:\n',
     '        if worst_avg is None or avg > worst_avg:\n', [PY_LF]),
    ("K1 Compass SKIP membership: GO verdicts are cited instead of SKIP", LF,
     '        if vid is not None and label == "SKIP":\n',
     '        if vid is not None and label == "GO":\n', [PY_LF]),
    ("U1 stops-not-honoured reads 'kept' instead of 'missed'", LF,
     '        if isinstance(t.get("checks"), dict) and (t["checks"].get("stop") or {}).get("state") == "missed"\n',
     '        if isinstance(t.get("checks"), dict) and (t["checks"].get("stop") or {}).get("state") == "kept"\n',
     [PY_LF]),
    ("G1 the router's gate is inverted: a 404 on, not off", RT,
     "    if not enabled():\n", "    if enabled():\n", [PY_RD]),
    ("B1 the weekly window is one day short", RD,
     "    end = start + timedelta(days=5)\n", "    end = start + timedelta(days=4)\n", [PY_RD]),
    ("V1 the reveal: a too-few finding is shown OPEN, never collapsed", RDJS,
     "  return toggle(summary, [...body, linkList], { open: !tooFew })\n",
     "  return toggle(summary, [...body, linkList], { open: true })\n", [VT_RDJS]),
    ("C1 a frozen trade chart inherits the symbol's live workspace drawings", RDJS,
     "      tradeRef: trade.tradeRef, tradeRefType: 'equity_trade', annotations: [],\n",
     "      tradeRef: trade.tradeRef, tradeRefType: 'equity_trade',\n", [VT_RDJS]),
    ("Q1 Compass is quoted even when the payload carries none", RDJS,
     "  if (!compassText || !compassText.text) return []\n", "  if (false) return []\n", [VT_RDJS]),
    ("D1 the daily append drops its compare-and-set baseline", RDJS,
     "    body: JSON.stringify({ bodyJson: doc(appended), baseUpdatedAt: daily.updatedAt }),\n",
     "    body: JSON.stringify({ bodyJson: doc(appended) }),\n", [VT_RDJS]),
    ("DOOR1 EODRecap's draft door ignores the flag gate", EOD,
     "          {reviewDraftsEnabled() && (\n", "          {true && (\n", [VT_EOD]),
    ("DOOR2 CompassReview's draft door ignores the flag gate", CR,
     "          {reviewDraftsEnabled() && (\n", "          {true && (\n", [VT_CR]),
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
    out = [f"lane 13F mutation proof at HEAD {head}"]
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
