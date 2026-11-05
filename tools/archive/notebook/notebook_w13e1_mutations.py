"""Wave 13 lane 13E-1 -- mutation proofs for the entry-context rails.

Each mutation plants ONE defect in a source file, runs the named rail, and expects it RED;
the file is then restored from the bytes captured before the edit (never `git checkout`) and
verified against the committed blob (`git hash-object` == `git rev-parse HEAD:<path>`). A
fresh PYTHONPYCACHEPREFIX per run keeps a stale .pyc from masking a same-length edit. A
control run with no mutation must be GREEN first, or nothing below means anything.

  python tools/notebook_w13e1_mutations.py [--json OUT]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TEST = "tests/test_notebook_entry_context.py"
SVC = "api/services/journal_two/entry_context.py"
ROUTER = "api/routers/notebook_entry_context.py"
PURGE = "api/services/journal_two/account_purge.py"

MUTATIONS = [
    ("M1-freeze-twice", SVC,
     'if existing is not None:\n            return {"frozen": False, "context": _serialize(existing)}',
     'if False:\n            return {"frozen": False, "context": _serialize(existing)}',
     "test_a_second_freeze_open_or_resync_changes_nothing_and_recomputes_nothing"),
    ("M2-insert-or-replace", SVC,
     '"INSERT OR IGNORE INTO j2_entry_context', '"INSERT OR REPLACE INTO j2_entry_context',
     "test_two_writers_racing_the_first_row_wins_and_the_second_writes_nothing"),
    ("M3-hook-unguarded", SVC,
     '        log.warning("[entry_context] after-sync capture failed", exc_info=True)\n'
     '        return {"ok": False, "error": type(e).__name__}',
     '        raise',
     "test_a_hook_exception_never_fails_the_sync_WITH_A_CONTROL"),
    ("M4-hook-writes-synced-rows", SVC,
     '    today = today or today_et()\n    summary = {"candidates": 0',
     '    today = today or today_et()\n    (conn.execute("UPDATE j2_positions SET notes = \'ctx\'") if conn else None)\n'
     '    summary = {"candidates": 0',
     "test_the_after_sync_hook_freezes_todays_entries_and_leaves_the_synced_rows_byte_identical"),
    ("M5-trade-joined-by-position-id", SVC,
     'day = entry_day_for(t.get("entryDate"))\n        keyed[tid] = (sym, day) if day else None',
     'day = entry_day_for(t.get("entryDate")) if str(t.get("positionId", "")).startswith("manual-") is False else None\n'
     '        keyed[tid] = (sym, day) if day else None',
     "test_a_broker_trade_with_a_sentinel_position_id_reaches_its_context_by_the_key"),
    ("M6-rs-constant-not-the-authority", SVC,
     'row = rs_ranking.get_rs_for_ticker(symbol)',
     'row = {"rs_rank": 91, "rs_score": 1.4}',
     "test_every_field_equals_its_authority_with_source_and_as_of"),
    ("M7-missing-invented", SVC,
     'code = "rs_not_ranked" if rs_ranking.cached_rank_map() else "rs_cache_cold"\n        return _missing(SRC_RS, code)',
     'return _field(50, SRC_RS, read_at)',
     "test_every_missing_value_is_labelled_with_its_reason_never_invented"),
    ("M8-gate-ignored", ROUTER,
     '    if not ectx.enabled():\n        raise public.not_found()',
     '    if False:\n        raise public.not_found()',
     "test_every_route_is_404_while_the_flag_is_off_even_signed_out"),
    ("M9-purge-drops-the-table", PURGE,
     '    "j2_entry_context",\n)', ')',
     "test_account_purge_takes_the_table_and_only_that_member"),
    ("M10-past-day-captured", SVC,
     '    if day != today:\n        return {"status": "not_entry_day", "entryDay": day}',
     '    if False:\n        return {"status": "not_entry_day", "entryDay": day}',
     "test_a_past_day_reads_not_captured_and_is_never_reconstructed"),
]


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()


def _run(test: str) -> tuple[int, str]:
    env = dict(os.environ, PYTHONPYCACHEPREFIX=tempfile.mkdtemp(prefix="w13e1mut_"))
    p = subprocess.run([sys.executable, "-m", "pytest", f"{TEST}::{test}", "-q", "-p", "no:cacheprovider",
                        "-W", "ignore"], cwd=REPO, env=env, capture_output=True, text=True)
    tail = [ln for ln in p.stdout.splitlines() if ln.strip()][-1:] or [""]
    return p.returncode, tail[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    args = ap.parse_args()
    results = []
    for name, rel, old, new, test in MUTATIONS:
        path = REPO / rel
        original = path.read_bytes()
        text = original.decode("utf-8")
        crlf = "\r\n" in text
        o, n = (old.replace("\n", "\r\n"), new.replace("\n", "\r\n")) if crlf else (old, new)
        if text.count(o) != 1:
            results.append({"name": name, "verdict": "NOT-APPLIED", "count": text.count(o)})
            continue
        control_rc, control_tail = _run(test)
        try:
            path.write_bytes(text.replace(o, n).encode("utf-8"))
            rc, tail = _run(test)
        finally:
            path.write_bytes(original)
        restored = _git("hash-object", rel) == _git("rev-parse", f"HEAD:{rel}")
        verdict = "KILLED" if control_rc == 0 and rc != 0 and restored else "SURVIVED-OR-INVALID"
        results.append({"name": name, "file": rel, "test": test, "control": [control_rc, control_tail],
                        "mutant": [rc, tail], "restored_matches_HEAD": restored, "verdict": verdict})
        print(f"{name:36s} control rc={control_rc}  mutant rc={rc}  restored={restored}  {verdict}  | {tail}")
    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    return 0 if all(r["verdict"] == "KILLED" for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
