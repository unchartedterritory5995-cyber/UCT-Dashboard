"""W14-C2 mutation proof (docs/notebook/wave14-w14-c2.md section 6).

Usage: python tools/notebook_w14c2_mutation_proof.py <M1-session-ignored|M2-answered-offers-next|
       M3-client-skips-merge-door|M4-server-replaces-whole-map>

 apply one textual mutation, run the named rails, restore from a
captured copy, verify the restore by sha256 AND against nothing else touching the file."""
import hashlib, subprocess, sys, pathlib, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\notebook-w14-c2")
OE = "app/src/pages/journal-2-0/components/notebook/onboarding/"
MUTS = {
  "M1-session-ignored": (OE + "tourEligibility.js",
     "  if (session) {\n    if (session.answered) return null\n    return offerable.find((t) => t.id === session.id) || null\n  }\n", "",
     ["npx", "vitest", "run", OE + "tourEligibility.test.js", OE + "TourOfferGate.test.jsx", "--maxWorkers=2"]),
  "M2-answered-offers-next": (OE + "tourEligibility.js",
     "    if (session.answered) return null\n", "    if (session.answered) return offerable[0] || null\n",
     ["npx", "vitest", "run", OE + "tourEligibility.test.js", OE + "TourOfferGate.test.jsx", "--maxWorkers=2"]),
  "M3-client-skips-merge-door": (OE + "tourSeenState.js",
     "      res = await fetch(TOUR_ROW_URL(tourId), {", "      res = null; void ({",
     ["npx", "vitest", "run", OE + "tourSeenState.crossTab.test.js", OE + "tourSeenState.test.js", "--maxWorkers=2"]),
  "M4-server-replaces-whole-map": ("api/services/journal_two/tour_seen_state.py",
     "         THEN user_preferences.pref_value ELSE '{}' END,", "         THEN '{}' ELSE '{}' END,",
     ["python", "-m", "pytest", "tests/test_notebook_tour_seen_state.py", "-q", "-p", "no:cacheprovider", "-W", "ignore"]),
}
name = sys.argv[1]
rel, old, new, cmd = MUTS[name]
p = ROOT / rel
orig = p.read_bytes()
sha = hashlib.sha256(orig).hexdigest()
text = orig.decode("utf-8")
assert text.count(old) == 1, f"{name}: anchor found {text.count(old)} times"
p.write_bytes(text.replace(old, new).encode("utf-8"))
try:
    cwd = ROOT / "app" if cmd[0] == "npx" else ROOT
    if cmd[0] == "npx":
        cmd = [c.replace(OE, "src/pages/journal-2-0/components/notebook/onboarding/") for c in cmd]
    r = subprocess.run(" ".join(cmd), cwd=cwd, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    out = r.stdout + r.stderr
finally:
    p.write_bytes(orig)
assert hashlib.sha256(p.read_bytes()).hexdigest() == sha, "RESTORE FAILED"
out = re.sub(r"\x1b\[[0-9;]*m", "", out)
(ROOT / "docs/notebook/evidence/wave14-w14-c2" / f"{name}.txt").write_text(out, encoding="utf-8")
lines = [l for l in out.splitlines() if ("Tests " in l or "passed" in l or "failed" in l or "×" in l or "FAILED" in l)]
print(f"== {name}  exit={r.returncode}  restored sha {sha[:12]} OK")
print("\n".join(lines[-14:]))
