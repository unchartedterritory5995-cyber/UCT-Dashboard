"""UCT Agent AUTOTEST: the cap, READ-ONLY. Shows the cumulative ledger's committed total against every ceiling.

  python tools/agent_autotest_cap_status.py                  # the pinned ledger (C:/UCT/agent-eval-ledger.db)
  python tools/agent_autotest_cap_status.py --ledger <file>  # another ledger file, for a report only

Opens the ledger with sqlite `mode=ro` (a missing file is reported, never created), reads the cap file and the owner's
authorization file (only max_usd, expires, targets and stages are printed; never the hashes or the ack sentence), and checks
whether the STOP file exists. Writes nothing, creates nothing, makes no call. Dollars and counts only.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools import agent_autotest_gate as gate  # noqa: E402
from tools import agent_eval_ledger as ledger  # noqa: E402

SUM = ("SELECT COALESCE(SUM(CASE status WHEN 'reserved' THEN reserved_usd ELSE 0 END),0),"
       " COALESCE(SUM(CASE status WHEN 'settled' THEN actual_usd ELSE 0 END),0), COUNT(*) FROM eval_spend")


def _json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f), None
    except FileNotFoundError:
        return None, "absent"
    except (OSError, ValueError) as e:
        return None, f"unreadable ({type(e).__name__})"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default=None)
    a = ap.parse_args(argv)
    db = a.ledger or ledger.pinned_ledger()
    cap_file = os.path.join(os.path.dirname(os.path.abspath(db)), ledger.CAP_FILE_NAME)
    out: dict = {"ledger": db, "cap_file": cap_file, "code_cap_usd": ledger.CUMULATIVE_CAP_USD, "gate_max_usd": gate.MAX_AUTHORIZED_USD,
                 "stages_usd": gate.STAGES}
    capj, err = _json(cap_file)
    out["cap_file_usd"] = capj.get("cap_usd") if isinstance(capj, dict) else err
    if not os.path.isfile(db):
        out["ledger_state"] = "absent (no paid call has been reserved on this machine)"
        out.update(total_committed_usd=0.0, program_committed_usd=0.0, by_stage_usd={})
    else:
        c = sqlite3.connect("file:" + os.path.abspath(db).replace("\\", "/") + "?mode=ro", uri=True, timeout=5.0)
        try:
            o, s, n = c.execute(SUM).fetchone()
            out.update(ledger_state="present", rows=n, open_usd=round(o, 6), settled_usd=round(s, 6), total_committed_usd=round(o + s, 6))
            p = c.execute(SUM + " WHERE substr(run_id,1,?)=?", (len(gate.RUN_PREFIX), gate.RUN_PREFIX)).fetchone()
            out["program_committed_usd"] = round(p[0] + p[1], 6)
            out["by_stage_usd"] = {st: round(sum(c.execute(SUM + " WHERE substr(run_id,1,?)=?", (len(pre), pre)).fetchone()[:2]), 6)
                                   for st in gate.STAGES for pre in [f"{gate.RUN_PREFIX}{st}-"]}
        finally:
            c.close()
    auth, err = _json(gate.AUTH_PATH)
    out["authorization"] = {k: auth.get(k) for k in ("max_usd", "expires", "targets", "stages")} if isinstance(auth, dict) else err
    out["stop_in_force"] = os.path.exists(gate.STOP_FILE)
    cap = min(ledger.CUMULATIVE_CAP_USD, out["cap_file_usd"]) if isinstance(out["cap_file_usd"], (int, float)) else None
    out["ledger_remaining_usd"] = None if cap is None else round(max(0.0, cap - out["total_committed_usd"]), 6)
    m = auth.get("max_usd") if isinstance(auth, dict) else None
    out["program_remaining_usd"] = round(max(0.0, min(float(m), gate.MAX_AUTHORIZED_USD) - out["program_committed_usd"]), 6) if isinstance(m, (int, float)) else None
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
