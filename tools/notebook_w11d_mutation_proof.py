"""Wave 11 lane 11D mutation proof -- break each key guard of the trade-plan canvas, one at a
time, and show a rail goes RED.

    python tools/notebook_w11d_mutation_proof.py docs/notebook/evidence/w11d/mutation-<sha>.txt

Guards: the write path (the board's one transaction, the create door's landed revision, the
server compare-and-set, the schema level that refuses an older bundle), the gate (server
default, client doors), the frozen chart's as-of day, level persistence, keyboard move, and
the two performance guards (culling, a stable card api).

Each mutation is applied to the CAPTURED bytes of one file and the named rail files are run
WHOLE (never `vitest -t` / a filter that could match nothing and exit 0). A mutation is KILLED
only when the run reports at least one failed test. Every restore writes back the captured
bytes -- never `git checkout` -- and is verified against the committed blob
(`git cat-file blob HEAD:<path>`, line endings normalised). An unmutated control runs green
before and after. Exit 0 only when every mutation is killed and every restore verified.
"""
import hashlib
import pathlib
import re
import shutil
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
APP = REPO / "app"
OUT = pathlib.Path(sys.argv[1])
J2 = "app/src/pages/journal-2-0"

VT_MODEL = f"{J2}/lib/tradeCanvas.test.js"
VT_BOARD = f"{J2}/components/notebook/TradeCanvasBoard.test.jsx"
VT_PAGE = f"{J2}/components/notebook/NoteEditorPage.tradeCanvas.test.jsx"
VT_TAB = f"{J2}/tabs/NotebookTab.tradeCanvas.test.jsx"
VT_DOORS = f"{J2}/lib/offline/doorFamilies.settle.test.jsx"
PY_CANVAS = "tests/test_notebook_trade_canvas.py"

# (name, path, old, new, rails)
MUTATIONS = [
    ("W1 write path: the board's commit never reaches the editor (no transaction dispatched)",
     f"{J2}/lib/tradeCanvas.js",
     "  editor.view.dispatch(tr)\n  return true\n",
     "  return true\n",
     [VT_MODEL, VT_PAGE]),
    ("W2 door ledger: the create door stops landing its revision (no settleNoteWrite)",
     f"{J2}/lib/tradeCanvasCreate.js",
     "  await settleNoteWrite(created?.id ?? null, created)\n",
     "",
     [VT_DOORS]),
    ("W3 server compare-and-set dropped (a stale board write would land)",
     "api/services/journal_two/notes.py",
     'if expected_updated_at is not None and existing["updated_at"] != expected_updated_at:',
     "if False:",
     [PY_CANVAS]),
    ("W4 schema guard: the canvas node registered at level 2 (an older bundle may write it blank)",
     "api/services/journal_two/notebook_schema.py",
     '    "tradeCanvas": 3,\n',
     '    "tradeCanvas": 2,\n',
     [PY_CANVAS]),
    ("G1 gate: the server default flipped ON",
     "api/routers/auth.py",
     '    "NOTEBOOK_TRADE_CANVAS_ENABLED": False,',
     '    "NOTEBOOK_TRADE_CANVAS_ENABLED": True,',
     [PY_CANVAS]),
    ("G2 gate: the client doors ignore the flag",
     f"{J2}/lib/tradeCanvasCreate.js",
     "  return notebookFlag(CANVAS_FLAG) === true\n",
     "  return true\n",
     [VT_TAB, VT_PAGE]),
    ("F1 frozen chart: the as-of day never reaches the chart (no ?to= cut-off)",
     f"{J2}/components/notebook/TradeCanvasItem.jsx",
     "params: { symbol: item.symbol, tf: item.tf, to: item.mode === 'frozen' ? item.asOf : null },",
     "params: { symbol: item.symbol, tf: item.tf, to: null },",
     [VT_BOARD]),
    ("F2 frozen chart: the stored as-of day is dropped on read (every frozen card turns live)",
     f"{J2}/lib/tradeCanvas.js",
     "    item.mode = raw.mode === 'frozen' && asOf ? 'frozen' : 'live'\n",
     "    item.mode = 'live'\n",
     [VT_MODEL, VT_BOARD]),
    ("L1 levels: a level's chart is not kept (lines never drawn on the chart)",
     f"{J2}/lib/tradeCanvas.js",
     "      price, chartId: charts.has(lv.chartId) ? lv.chartId : null,\n    })\n  }\n  return take.length",
     "      price, chartId: null,\n    })\n  }\n  return take.length",
     [VT_MODEL, VT_BOARD]),
    ("L2 levels: normalisation drops every stored level",
     f"{J2}/lib/tradeCanvas.js",
     "  return { v: BOARD_VERSION, items, edges, levels }\n",
     "  return { v: BOARD_VERSION, items, edges, levels: [] }\n",
     [VT_MODEL, VT_BOARD]),
    ("K1 keyboard: arrow keys no longer move the card",
     f"{J2}/components/notebook/TradeCanvasBoard.jsx",
     "      if (onItem || sel.size) { targetIds(onItem); nudgeSelection(dx, dy); return }",
     "      if (onItem || sel.size) { return }",
     [VT_BOARD]),
    ("P1 performance: culling off (every card rendered whatever the camera)",
     f"{J2}/lib/tradeCanvas.js",
     "    if (it.x < x1 && it.x + it.w > x0 && it.y < y1 && it.y + it.h > y0) out.push(it.id)\n",
     "    out.push(it.id)\n",
     [VT_MODEL, VT_BOARD]),
    ("P2 performance: a fresh card api every render (every card re-renders on every board render)",
     f"{J2}/components/notebook/TradeCanvasBoard.jsx",
     "  }), [])\n  actions.current.focused",
     "  }), [selection])\n  actions.current.focused",
     [VT_BOARD]),
    ("T1 touch: a finger whose pointerup was lost blocks every later pinch",
     f"{J2}/components/notebook/TradeCanvasBoard.jsx",
     "    if (e.isPrimary === true) pointersRef.current.clear()
",
     "",
     [VT_BOARD]),
    ("T2 touch: a pinch's second finger on a panel over the board is ignored",
     f"{J2}/components/notebook/TradeCanvasBoard.jsx",
     "    const ongoing = pointersRef.current.size > 0 && e.isPrimary !== true
",
     "    const ongoing = false
",
     [VT_BOARD]),
    ("K2 keyboard: letters typed before a new card's text box mounts reach the shortcuts",
     f"{J2}/components/notebook/TradeCanvasBoard.jsx",
     "    if (editingRef.current && e.key !== 'Escape' && e.key !== 'Tab') { if (e.key.length === 1) e.preventDefault(); return }
",
     "",
     [VT_BOARD]),
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
        env = {**__import__("os").environ, "PYTHONDONTWRITEBYTECODE": "1"}
        r = subprocess.run([sys.executable, "-m", "pytest", *py, "-q", "-p", "no:cacheprovider", "-W", "ignore"],
                           cwd=REPO, capture_output=True, text=True, env=env, timeout=1200)
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


ALL_RAILS = sorted({r for m in MUTATIONS for r in m[4]})
out = [f"lane 11D mutation proof at HEAD {subprocess.run(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()}"]
ok = True
rc, failed, lines = run(ALL_RAILS)
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

rc, failed, lines = run(ALL_RAILS)
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
print("\n".join(out))
sys.exit(0 if ok else 1)
