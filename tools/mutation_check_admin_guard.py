"""Mutation harness for the admin-guard registration rail.

The rail exists because `AdminGuardMiddleware` once shipped complete, tested and
UNREGISTERED, leaving ~30 destructive endpoints answering anonymous callers. Its
safety control was repaired on 2026-08-10 (it demanded the SPA catch-all be
present, so it failed on any checkout without a built frontend — red at the
moment the probe was MOST harmless).

Loosening a security rail is only defensible if you then prove it still bites.
Each mutation below breaks one thing the rail claims to detect and demands a
NON-ZERO pytest exit. A control run must pass first, or "caught" means nothing.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = "api/main.py"
TEST = "tests/test_admin_guard_registered.py"

# A handler that CLAIMS the probe path — the exact thing that would make the
# anonymous probe stop being harmless.
CLAIM = '''
@app.post("/api/admin/massive/__guard_probe_no_such_route__")
def _mutation_probe_claimer():
    return {"ok": True}
'''

MUTATIONS = [
    # THE headline defect: the guard is built and tested but never installed.
    # It is aliased at the import (`AdminGuardMiddleware as _AdminGuard`), so the
    # registration reads `app.add_middleware(_AdminGuard)` — grep the call site,
    # not the class name.
    ("admin guard middleware unregistered", MAIN,
     "app.add_middleware(_AdminGuard)", "pass  # unregistered"),

    # The probe path stops being unclaimed -> the probe could execute a handler.
    ("a real handler claims the probe path", MAIN,
     "app.include_router(provider_coverage_router.router)",
     "app.include_router(provider_coverage_router.router)\n" + CLAIM),

    # The non-vacuity control must notice a malformed scope, which is what would
    # let the safety assertion pass by never running.
    ("route matcher fed a malformed scope", TEST,
     'scope = {"type": "http", "method": method, "path": path,',
     'scope = {"type": "http", "method": method, "path": "/__nope__",'),
]


def _clear_pyc():
    for p in ROOT.rglob("__pycache__"):
        shutil.rmtree(p, ignore_errors=True)


def _run():
    _clear_pyc()
    return subprocess.run(
        [sys.executable, "-m", "pytest", TEST, "-q", "--no-header", "-p", "no:warnings"],
        cwd=ROOT, capture_output=True, text=True,
    )


def main():
    print("=== CONTROL (no mutation) ===")
    r = _run()
    print(f"  exit={r.returncode}  {r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ''}")
    if r.returncode != 0:
        print("  CONTROL FAILED — result would be meaningless.")
        return 1

    print("\n=== MUTATIONS: each must be CAUGHT ===")
    escaped = []
    for label, rel, old, new in MUTATIONS:
        path = ROOT / rel
        src = path.read_text(encoding="utf-8")
        assert old in src, f"MUTATION TEXT NOT FOUND in {rel}: {old!r}"
        path.write_text(src.replace(old, new, 1), encoding="utf-8")
        try:
            r = _run()
        finally:
            path.write_text(src, encoding="utf-8")
        caught = r.returncode != 0
        print(f"  [{'CAUGHT' if caught else 'ESCAPED'}] exit={r.returncode}  {label}")
        if not caught:
            escaped.append(label)

    _clear_pyc()
    print()
    if escaped:
        print(f"{len(escaped)} ESCAPED:")
        for e in escaped:
            print(f"  - {e}")
        return 1
    print(f"All {len(MUTATIONS)} mutations caught.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
