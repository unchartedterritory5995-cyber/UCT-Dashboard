"""Mutation harness for the 2026-08-09 provider-coverage fix-wave.

Each entry UNDOES one fix, re-runs the tests that are supposed to catch it, and
demands a NON-ZERO pytest exit code. A control run (no mutation) must be 0
first, or a harness that always reports "caught" would look like proof.

Every replace asserts its `old` text is present before substituting — a
`str.replace` that silently matched nothing is the classic way this whole
exercise passes vacuously. `__pycache__` is cleared between runs because a
stale .pyc can serve the unmutated module back.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CAL = "api/routers/calendar.py"
PCM = "api/services/provider_coverage_monitor.py"
AA = "api/services/catalyst/analyst_actions.py"
MAS = "api/services/massive.py"

T_VOL = "tests/test_calendar_day_metrics_avg_vol.py"
T_AN = "tests/test_provider_coverage_analyst_reachability.py"
T_RS = "tests/test_provider_coverage_restart_dedup.py"
T_MV = "tests/test_movers_finviz_columns.py"

MUTATIONS = [
    ("column list not requested (back to the account's saved view)", CAL,
     "&auth={fv_token}&c={_FV_EXPORT_COLS}", "&auth={fv_token}", T_VOL),

    ("header name back to the one Finviz never emits", CAL,
     '_gcol(row, "Average Volume", "Avg Volume")', '_gcol(row, "Avg Volume")', T_VOL),

    ("avg-vol thousands scaling removed", CAL,
     "int(float(s) * _FV_AVG_VOL_UNIT)", "int(float(s))", T_VOL),

    ("fallback gated on fv_ok again (suppresses the Massive leg)", CAL,
     'if not fv_ok or _filled("price") == 0 or _filled("avg_vol") == 0:',
     "if not fv_ok:", T_VOL),

    ("completeness stops checking avg_vol", CAL,
     'have_data = _filled("price") > 0 and _filled("avg_vol") > 0',
     "have_data = fv_ok or massive_ok", T_VOL),

    ("analyst field grades recency again", PCM,
     "from api.services.catalyst.analyst_actions import analyst_grades_available",
     "from api.services.catalyst.analyst_actions import finnhub_recent_action as analyst_grades_available",
     T_AN),

    ("grades-availability probe ignores the FMP leg", AA,
     'rows = _fmp_get("/stable/grades", {"symbol": sym}, timeout=_FMP_TIMEOUT)\n        if isinstance(rows, list) and rows:\n            return True',
     "rows = None", T_AN),

    ("prev-defect set read from memory again", PCM,
     "prev_fields = _load_prev_defect_fields()   # from DISK — survives a redeploy",
     'prev_fields = set(_state.get("_prev_defect_fields") or [])', T_RS),

    ("recovered fields never leave the persisted set", PCM,
     'conn.execute(\n                    f"DELETE FROM defect_state WHERE field NOT IN ({placeholders})",\n                    tuple(keep),\n                )',
     "pass", T_RS),

    ("movers screener stops pinning its columns", MAS,
     "?v=152&f={_qf}&c={_qc}&o={order}", "?v=152&f={_qf}&o={order}", T_MV),
]


def _clear_pyc():
    for p in ROOT.rglob("__pycache__"):
        shutil.rmtree(p, ignore_errors=True)


def _run(tests):
    _clear_pyc()
    return subprocess.run(
        [sys.executable, "-m", "pytest", tests, "-q", "--no-header", "-p", "no:warnings"],
        cwd=ROOT, capture_output=True, text=True,
    )


def main():
    print("=== CONTROL (no mutation): every target suite must PASS ===")
    for t in (T_VOL, T_AN, T_RS, T_MV):
        r = _run(t)
        print(f"  {t:62} exit={r.returncode}  {r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ''}")
        if r.returncode != 0:
            print("  CONTROL FAILED — harness result would be meaningless. Stopping.")
            return 1

    print("\n=== MUTATIONS: each must be CAUGHT (non-zero exit) ===")
    escaped = []
    for label, rel, old, new, tests in MUTATIONS:
        path = ROOT / rel
        src = path.read_text(encoding="utf-8")
        assert old in src, f"MUTATION TEXT NOT FOUND in {rel}: {old!r}"
        path.write_text(src.replace(old, new, 1), encoding="utf-8")
        try:
            r = _run(tests)
        finally:
            path.write_text(src, encoding="utf-8")
        caught = r.returncode != 0
        print(f"  [{'CAUGHT' if caught else 'ESCAPED'}] exit={r.returncode}  {label}")
        if not caught:
            escaped.append(label)

    _clear_pyc()
    print()
    if escaped:
        print(f"{len(escaped)} MUTATION(S) ESCAPED:")
        for e in escaped:
            print(f"  - {e}")
        return 1
    print(f"All {len(MUTATIONS)} mutations caught.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
