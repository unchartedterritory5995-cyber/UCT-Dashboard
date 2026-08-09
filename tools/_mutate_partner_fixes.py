"""Mutation gauntlet for the four partner-owned fixes (2026-08-09).

Run:  python tools/_mutate_partner_fixes.py

Discipline, and every clause of it is load-bearing:

  * CONTROL A runs the rails unmutated FIRST and **aborts on zero collected**.
    A gauntlet whose suite collects nothing kills every mutation and reports a
    perfect score (`lesson_mutation_harness_needs_a_control`).
  * Every mutation is **proven applied** by comparing the file's sha256 before
    and after the edit. A `str.replace` that matched nothing is a mutation that
    was never made, and the "KILLED" it produces is a lie
    (`lesson_test_that_passes_vacuously`).
  * Every verdict is a **bare process exit code**. No pipe, no `| tail`, no
    parsing of stdout — a pipeline's exit status is the last command's.
  * Every artifact is **restored from bytes and re-verified by sha**, and
    `__pycache__` is purged around each mutation
    (`lesson_python_pycache_defeats_same_length_mutation` — a same-length edit
    can otherwise be shadowed by a stale .pyc).
  * CONTROL B re-runs the rails after all restores. If it is red, the gauntlet
    corrupted the tree and none of the verdicts above mean anything.
"""
from __future__ import annotations

import hashlib
import os
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

RAILS = [
    "tests/test_schwab_partner_fixes.py",
    "tests/test_llm_timeout_census.py",
]

# (label, relative path, old text, new text, the rail that must go red)
MUTATIONS = [
    ("M1  the LLM client loses its timeout=",
     "api/schwab_router.py",
     'anthropic.Anthropic(api_key=api_key, timeout=llm_timeouts.seconds("SCHWAB_NARRATIVE_LLM_TIMEOUT_SECS", llm_timeouts.REQUEST_PATH))',
     'anthropic.Anthropic(api_key=api_key)',
     None),

    ("M2  the handler goes back ON the event loop",
     "api/schwab_router.py",
     "def market_narrative(_auth: dict = Depends(require_flow_user)):",
     "async def market_narrative(_auth: dict = Depends(require_flow_user)):",
     None),

    ("M3  /chart-proxy loses its gate",
     "api/schwab_router.py",
     "    _auth: dict = Depends(require_flow_user),\n):\n    \"\"\"\n    Proxy Finviz chart image",
     "):\n    \"\"\"\n    Proxy Finviz chart image",
     None),

    ("M4  /market-narrative loses its gate",
     "api/schwab_router.py",
     "def market_narrative(_auth: dict = Depends(require_flow_user)):",
     "def market_narrative():",
     None),

    ("M5  /snapshot-now downgraded to any logged-in user",
     "api/schwab_router.py",
     "async def snapshot_now(_auth: dict = Depends(require_flow_admin)):",
     "async def snapshot_now(_auth: dict = Depends(require_flow_user)):",
     None),

    ("M6  the daily budget is no longer consulted",
     "api/schwab_router.py",
     '    if narrative_cost_guard.over_budget("schwab_market_narrative"):\n'
     '        return JSONResponse(status_code=429, content={"error": "Daily narrative budget reached."})\n',
     "",
     None),

    ("M7  a served narrative is no longer charged",
     "api/schwab_router.py",
     '        narrative_cost_guard.record_from_response("schwab_market_narrative", "claude-sonnet-4-6", response)\n',
     "",
     None),

    ("M8  the shim stops resolving the params it omits",
     "api/live_massive_router.py",
     "        symbol=None,\n        lookback_days=1,\n",
     "",
     None),

    ("M9  /thresholds loses its gate",
     "api/live_massive_router.py",
     "def get_thresholds(_auth: dict = Depends(require_flow_user)):",
     "def get_thresholds():",
     None),

    ("M10 a cap of 0 is read as unlimited",
     "api/services/narrative_cost_guard.py",
     "    return value if value > 0 else default",
     "    return value",
     None),

    ("M11 an unknown model prices at $0",
     "api/services/narrative_cost_guard.py",
     "        rates = max(_PRICES.values(), key=lambda r: r[1])",
     "        rates = (0.0, 0.0)",
     None),

    ("M12 the schwab quarantine entry is left behind (stale exemption)",
     "tests/test_llm_timeout_census.py",
     'QUARANTINE: dict[str, int] = {\n',
     'QUARANTINE: dict[str, int] = {\n    "api/schwab_router.py": 1,\n',
     None),
]


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def purge_pycache() -> None:
    for d in ROOT.rglob("__pycache__"):
        if "node_modules" in d.parts or ".git" in d.parts:
            continue
        shutil.rmtree(d, ignore_errors=True)


def run_rails() -> int:
    """Bare exit code. NO pipe — a pipeline reports the last command's status."""
    return subprocess.run(
        [sys.executable, "-m", "pytest", *RAILS, "-q", "-p", "no:randomly",
         "--no-header", "-x"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode


def collected() -> int:
    out = subprocess.run(
        [sys.executable, "-m", "pytest", *RAILS, "--collect-only", "-q",
         "-p", "no:randomly"],
        cwd=ROOT, capture_output=True, text=True)
    for line in reversed(out.stdout.splitlines()):
        if "test" in line and "collected" in line:
            for token in line.split():
                if token.isdigit():
                    return int(token)
    return sum(1 for line in out.stdout.splitlines() if "::" in line)


def main() -> int:
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    purge_pycache()

    n = collected()
    print(f"CONTROL A — {n} tests collected")
    if n == 0:
        print("ABORT: the rails collect nothing; every verdict below would be vacuous")
        return 2
    if run_rails() != 0:
        print("ABORT: CONTROL A is RED before any mutation")
        return 2
    print("CONTROL A — GREEN\n")

    results = []
    for label, rel, old, new, _ in MUTATIONS:
        path = ROOT / rel
        original = path.read_bytes()
        before = sha(path)
        text = original.decode("utf-8")
        # The tree mixes CRLF and LF. A multi-line anchor written with `\n`
        # silently matches nothing in a CRLF file — which is exactly the
        # vacuous mutation this harness must never report as KILLED, so the
        # anchors are translated to the file's own newline before matching.
        if "\r\n" in text:
            old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
        if old not in text:
            print(f"{label}\n    NOT APPLIED — the anchor text is absent. "
                  "Verdict withheld.")
            results.append((label, "NOT-APPLIED"))
            continue
        # write_bytes, never write_text: write_text translates `\n` to os.linesep
        # and would rewrite every line ending in an LF file.
        path.write_bytes(text.replace(old, new, 1).encode("utf-8"))
        after = sha(path)
        assert after != before, f"{label}: sha unchanged — the edit was a no-op"
        purge_pycache()

        code = run_rails()
        verdict = "KILLED" if code != 0 else "SURVIVED"

        path.write_bytes(original)
        purge_pycache()
        assert sha(path) == before, f"{label}: restore did not reproduce the sha"

        print(f"{label}\n    applied {before[:12]} -> {after[:12]} | "
              f"pytest exit {code} | {verdict}")
        results.append((label, verdict))

    print()
    if run_rails() != 0:
        print("CONTROL B — RED after restore. The tree is dirty; discard the "
              "verdicts above.")
        return 2
    print("CONTROL B — GREEN (every artifact restored)\n")

    killed = sum(1 for _, v in results if v == "KILLED")
    print(f"{killed}/{len(results)} killed")
    for label, verdict in results:
        if verdict != "KILLED":
            print(f"  !! {label}: {verdict}")
    return 0 if killed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
