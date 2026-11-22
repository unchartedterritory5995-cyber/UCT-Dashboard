"""Wave 13 lane 13A mutation proof -- break each load-bearing guard of plan vs execution grading,
one at a time, and show a rail goes RED.

    python tools/notebook_w13a_mutation_proof.py docs/notebook/evidence/wave13-13a/mutation-<sha>.txt

Guards: the R4 constants and every tolerance boundary (entry, stop slippage, size, target
shortfall), the freeze at first match (INSERT OR IGNORE; the note read as it stood at entry),
the stable key (trade_ref, never j2_trades.id), the broker mirror (status and discipline record
leave nothing out), the gate (server parse default, auth-payload default), R3 sample wording, the
one reader's "conflict reads unreadable", the review-note exclusion, and the client's Unplanned chip.

Each mutation is applied to the CAPTURED bytes of one file and the named rail files are run
WHOLE (never `-k` / `vitest -t`, which can match nothing and exit 0). A mutation is KILLED only
when the run reports at least one failed test. Every restore writes back the captured bytes --
never `git checkout` -- and is verified against the committed blob (`git cat-file blob
HEAD:<path>`, line endings normalised). An unmutated control runs green before and after. Exit 0
only when every mutation is killed and every restore verified.
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
PG = "api/services/journal_two/plan_grading.py"
PX = "api/services/journal_two/plan_extract.py"

PY_GRADING = "tests/test_notebook_plan_grading.py"
PY_EXTRACT = "tests/test_notebook_plan_extract.py"
PY_FLAGS = "tests/test_notebook_flags.py"
VT_TABLE = f"{J2}/components/TradesTable.planGrade.test.jsx"

# (name, path, old, new, rails)
MUTATIONS = [
    ("C1 constants: ENTRY_TOL_R 0.25 -> 0.30", PG,
     '    "ENTRY_TOL_R": 0.25,\n', '    "ENTRY_TOL_R": 0.30,\n', [PY_GRADING]),
    ("C2 constants: ENTRY_TOL_PCT 0.5% -> 0.4%", PG,
     '    "ENTRY_TOL_PCT": 0.005,\n', '    "ENTRY_TOL_PCT": 0.004,\n', [PY_GRADING]),
    ("B1 boundary: entry ON the tolerance reads missed (<= turned <)", PG,
     "        kept = _r(abs(d)) <= _r(tol)\n", "        kept = _r(abs(d)) < _r(tol)\n", [PY_GRADING]),
    ("B2 boundary: an exit ON the stop-slippage line reads not honoured (>= turned >)", PG,
     "        honoured = _r(sign * (float(fill_exit) - limit)) >= 0\n",
     "        honoured = _r(sign * (float(fill_exit) - limit)) > 0\n", [PY_GRADING]),
    ("B3 boundary: the slippage line's sign flipped (stop + 0.25R on the wrong side)", PG,
     '        limit = ps - sign * CONSTANTS["STOP_SLIP_R"] * r_unit\n',
     '        limit = ps + sign * CONSTANTS["STOP_SLIP_R"] * r_unit\n', [PY_GRADING]),
    ("B4 boundary: size ON +/-10% reads missed (<= turned <)", PG,
     '        kept = _r(abs(d)) <= _r(CONSTANTS["SIZE_TOL_PCT"] * pn)\n',
     '        kept = _r(abs(d)) < _r(CONSTANTS["SIZE_TOL_PCT"] * pn)\n', [PY_GRADING]),
    ("B5 boundary: the target shortfall dropped (only an exit AT the target is a hit)", PG,
     '        hit_line = pt - sign * CONSTANTS["TARGET_SHORTFALL_R"] * r_unit\n',
     '        hit_line = pt\n', [PY_GRADING]),
    ("F1 freeze: INSERT OR IGNORE -> OR REPLACE (a second matcher overwrites the first)", PG,
     "        f\"INSERT OR IGNORE INTO j2_trade_plan_links ({_INSERT_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)\",\n",
     "        f\"INSERT OR REPLACE INTO j2_trade_plan_links ({_INSERT_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)\",\n",
     [PY_GRADING]),
    ("F2 freeze: the frozen link is ignored and the trade is re-matched on every read", PG,
     "    link = get_link(conn, user_id, ref)\n    if link is not None:\n",
     "    link = get_link(conn, user_id, ref)\n    if link is not None and False:\n", [PY_GRADING]),
    ("F3 as-of-entry: the note is read as it stands NOW, not as it stood at entry", PG,
     "    if upd is not None and upd <= cutoff:\n", "    if True:\n", [PY_GRADING]),
    ("K1 stable key: the link keyed on j2_trades.id (a broker purge reissues it)", PG,
     "    ref = trade_ref_for_row(trade)\n    link = get_link(conn, user_id, ref)\n",
     "    ref = \"id:\" + trade[\"id\"]\n    link = get_link(conn, user_id, ref)\n", [PY_GRADING]),
    ("M1 mirror: the status answer leaves broker trades out", PG,
     "    for t in conn.execute(f\"SELECT * FROM j2_trades WHERE user_id = ? AND id IN ({marks})\", (user_id, *ids)).fetchall():\n",
     "    for t in conn.execute(f\"SELECT * FROM j2_trades WHERE user_id = ? AND id IN ({marks})\", (user_id, *ids)).fetchall():\n"
     "        if t[\"source\"] == \"broker\":\n            continue\n", [PY_GRADING]),
    ("M2 mirror: the discipline record leaves broker trades out", PG,
     "    for t in conn.execute(f\"SELECT * FROM j2_trades WHERE {where}\", params).fetchall():\n",
     "    for t in conn.execute(f\"SELECT * FROM j2_trades WHERE {where} AND COALESCE(source, '') != 'broker'\", params).fetchall():\n",
     [PY_GRADING]),
    ("G1 gate: the route gate's default flipped ON", PG,
     "    return flag_on(FLAG, False)\n", "    return flag_on(FLAG, True)\n", [PY_GRADING]),
    ("G2 gate: the auth payload's default flipped ON", "api/routers/auth.py",
     '    "NOTEBOOK_PLAN_GRADING_ENABLED": False,', '    "NOTEBOOK_PLAN_GRADING_ENABLED": True,', [PY_FLAGS]),
    # R3 moved to its one home (lane 13B, 13A's decision 6); plan_grading imports it from there.
    ("R1 R3 wording: 'too few to judge' ends at 9, not 10", "api/services/journal_two/sample_size.py",
     'TOO_FEW_BELOW = 10\n', 'TOO_FEW_BELOW = 9\n', [PY_GRADING]),
    ("X1 reader: two different entries read as the first one, not 'unreadable'", PX,
     "    if len(distinct) == 1:\n        return RoleReading(STATE_OK, distinct[0])\n",
     "    if len(distinct) >= 1:\n        return RoleReading(STATE_OK, distinct[0])\n", [PY_EXTRACT]),
    ("X2 review: a plan-review note is read as the next trade's plan", PG,
     "        if _tagged_review(r):\n            continue\n", "", [PY_GRADING]),
    ("U1 client: the Unplanned chip never renders", f"{J2}/components/TradesTable.jsx",
     "['unplanned', 'member_none'].includes(opts?.planStatuses?.[trade.id]?.status)",
     "[].includes(opts?.planStatuses?.[trade.id]?.status)", [VT_TABLE]),
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
        r = subprocess.run([NPX, "vitest", "run", *[v[len("app/"):] for v in vt], "--maxWorkers=2"],
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
    out = [f"lane 13A mutation proof at HEAD {head}"]
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
