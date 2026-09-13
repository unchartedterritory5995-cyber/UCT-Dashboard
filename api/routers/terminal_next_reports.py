"""Read-only report surface for the `terminal-next-monitor` service.

⛔⛔ **WHY THIS ENDPOINT EXISTS AT ALL — THE VOLUME ANSWER, STATED ONCE.**
A Railway volume mounts to **exactly one service**. `/data` belongs to `web`, so
a separate monitor service **cannot** read the alert-taxonomy, catalyst or D2
sample stores directly, read-only or otherwise. The runbook's supported path for
cross-service reads is the **private network** (`*.railway.internal`), the same
idiom `WORKER_INTERNAL_URL` already uses for the flow proxy. So the monitor asks
web, and web runs the tools it already has.

⛔ **IT ADDS NO NEW MEASUREMENT.** Every route here shells out to a tool that is
already the authority — `s7_price_level_report.py`, `terminal_next_gate_check.py`
— and returns its stdout verbatim with its exit code. A second implementation of
any of these numbers would be a second authority over them, which is the whole
defect class this programme exists to avoid. If a tool is wrong, it is wrong in
one place.

⛔ **READ-ONLY, AND BEARER-GATED ON `PUSH_SECRET`** — the same gate
`/api/breadth-monitor/push` and `/api/desk/sessions-status` use. Nothing here
writes, arms, flips or deploys.

⚠️ **UNREADABLE IS NOT ZERO.** A tool that cannot open its store exits non-zero
and says so; this hands that back unchanged. A route that swallowed the failure
and returned `{}` would let the monitor post a confident zero about a store
nobody could open.
"""
from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

_PUSH_SECRET = os.environ.get("PUSH_SECRET", "")
_ROOT = pathlib.Path(__file__).resolve().parents[2]
_TIMEOUT = 240

#: The only commands this surface may run. ⛔ A DECLARED ALLOW-LIST, never a
#: parameter: an endpoint that ran an arbitrary argv would be a remote shell with
#: a bearer token in front of it.
_REPORTS = {
    "ticking":    ["tools/s7_price_level_report.py", "--ticking"],
    "report":     ["tools/s7_price_level_report.py"],
    "gate-check": ["tools/terminal_next_gate_check.py"],
}


def _check_auth(request: Request) -> None:
    if not _PUSH_SECRET:
        raise HTTPException(status_code=500, detail="PUSH_SECRET not configured")
    if request.headers.get("Authorization", "") != f"Bearer {_PUSH_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def _run(name: str) -> dict:
    argv = _REPORTS.get(name)
    if argv is None:
        raise HTTPException(status_code=404, detail="unknown report %r" % name)
    exe = sys.executable or shutil.which("python") or "python"
    try:
        r = subprocess.run([exe] + argv, cwd=str(_ROOT), capture_output=True,
                           text=True, encoding="utf-8", errors="replace",
                           timeout=_TIMEOUT)
    except subprocess.TimeoutExpired:
        # ⛔ A TIMEOUT IS ITS OWN ANSWER, never an empty success.
        return {"report": name, "exit": 124, "stdout": "",
                "stderr": "UNREADABLE: %s exceeded %ds" % (name, _TIMEOUT)}
    except Exception as e:                                   # noqa: BLE001
        return {"report": name, "exit": 125, "stdout": "",
                "stderr": "UNREADABLE: %s: %s" % (type(e).__name__, e)}
    return {"report": name, "exit": r.returncode,
            "stdout": r.stdout, "stderr": r.stderr[-2000:]}


@router.get("/api/terminal-next/report/{name}")
def terminal_next_report(name: str, request: Request):
    """Run one declared report and hand back its stdout and exit code verbatim."""
    _check_auth(request)
    return _run(name)


@router.get("/api/terminal-next/catalyst-receipt")
def catalyst_receipt(request: Request):
    """Today's F-CAT-1 run receipt — did the engine spend and persist?

    ⭐ Reads `catalyst_runs`, the durable receipt F-CAT-1 added, rather than
    counting `catalysts` rows: a day's row count cannot tell one healthy run from
    thirty-four failed ones, which is exactly how 2026-09-08 read as healthy.
    """
    _check_auth(request)
    import sqlite3
    from api.services.catalyst import engine as _eng
    from api.services.catalyst import store as _store
    try:
        md = _eng._today_market_date()
        closed, why = _eng._market_closed_today()
        con = sqlite3.connect("file:%s?mode=ro" % _store._DB_PATH, uri=True)
        rows = [dict(zip(("market_date", "started_at", "rows_written", "spend_usd",
                          "skipped", "errors_json"), r))
                for r in con.execute(
                    "SELECT market_date, started_at, rows_written, spend_usd, skipped, "
                    "errors_json FROM catalyst_runs WHERE market_date = ? "
                    "ORDER BY id DESC LIMIT 20", (md,))]
        persisted = sum(int(r["rows_written"] or 0) for r in rows)
        spent = sum(float(r["spend_usd"] or 0.0) for r in rows)
        con.close()
        return {"market_date": md, "market_closed": closed, "closed_reason": why,
                "runs": len(rows), "rows_persisted": persisted,
                "spend_usd": round(spent, 4), "recent": rows[:5]}
    except Exception as e:                                   # noqa: BLE001
        # ⛔ UNREADABLE, never a zero. A store that cannot be opened says nothing
        # about the population inside it.
        raise HTTPException(status_code=503,
                            detail="UNREADABLE: %s: %s" % (type(e).__name__, e))
