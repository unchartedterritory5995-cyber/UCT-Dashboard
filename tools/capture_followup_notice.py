"""Capture the earnings follow-up bell row from the REAL producer and the REAL route (Tier 2 part B, Task 8).

The Notices fixture for the follow-up kind is CAPTURED, never typed (lib/__fixtures__/notices.json,
`_provenance`). This tool runs, in a census-pinned CHILD process (the way tools/notebook_fin_walk.py runs its
POST_CHILD, so nothing reaches C:\\data):

  1. hub_sandbox_boot.apply_sandbox_env(data_dir, reclaim_conftest_temp=True), both switches set to 1, and
     auth_db.init_db();
  2. a user made by auth_service.create_user (the function the signup route calls);
  3. the job's seams monkeypatched to ONE BMO report of ORCL, dated the pinned trading day, on that user's
     watchlist (reporters_on, _member_ids, _member_sets, _paid, _reaction_pct, and _reporters_configured --
     the V4 "is a provider key set" probe, which the box running this has no reason to satisfy);
  4. earnings_followup.run_followups(now=<that day> 17:00 ET) with its DEFAULT delivery (the in-app bell,
     note_tasks.deliver_in_app -> alerts.add_alert);
  5. GET /api/alerts?limit=20 through a TestClient over a FastAPI app holding only the alerts router, with
     get_current_user overridden to that user. The child prints `CAPTURED <json>`.

The parent writes the printed body to <out>/alerts-body.json and the child's raw output to <out>/child.log
(R-RAW: raw first, committed before any fixture uses it). It never touches C:\\data and refuses a data dir
that resolves there.

    python tools/capture_followup_notice.py [--out docs/notebook/evidence/t2b-notice-capture] [--data-dir DIR]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO / "docs" / "notebook" / "evidence" / "t2b-notice-capture"
#: A Wednesday and a trading day. The captured notice says "Oct 14, 2026", so the test regex is a date shape.
PINNED_DAY = "2026-10-14"
SYMBOL = "ORCL"

CHILD = r'''
import json, os, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo); sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
os.environ["NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED"] = "1"
os.environ["NOTEBOOK_JOURNAL_STYLES_ENABLED"] = "1"
from datetime import date, datetime
from api.services import auth_db
auth_db.init_db()
from api.services import auth_service
user = auth_service.create_user(spec["email"], spec["password"], "Capture Member")
uid = user["id"]
from api.services.journal_two import earnings_followup as ef
from api.services.journal_two.timeutil import ET
day = date.fromisoformat(spec["day"])
sym = spec["symbol"]

# The job's seams: one BMO report, dated the pinned day, on this member's watchlist.
ef.reporters_on = lambda d: ({sym: "bmo"} if d == day else {}, True)
ef._reporters_configured = lambda: True
ef._member_ids = lambda conn: [uid]
ef._member_sets = lambda user_id: {sym: ["watchlist"]}
ef._paid = lambda user_id, conn: True
ef._reaction_pct = lambda symbol, report_date, *a, **k: -4.2    # the warm also passes now / budget / tally

result = ef.run_followups(now=datetime(day.year, day.month, day.day, 17, 0, tzinfo=ET), pass_label="capture")
print("RESULT " + json.dumps(result, sort_keys=True))
assert result["delivered"] == 1, f"expected one delivered notice, got {result}"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.middleware.auth_middleware import get_current_user
from api.routers import alerts as alerts_router
app = FastAPI()
app.include_router(alerts_router.router)
app.dependency_overrides[get_current_user] = lambda: {"id": uid, "email": spec["email"]}
resp = TestClient(app).get("/api/alerts?limit=20")
assert resp.status_code == 200, resp.status_code
body = resp.json()
assert isinstance(body, list) and len(body) == 1 and body[0]["type"] == "notebook_earnings_followup", body
print("CAPTURED " + json.dumps(body, sort_keys=True))
'''


def _refuse_shared_root(path: Path) -> None:
    resolved = str(path.resolve()).replace("\\", "/").rstrip("/").lower()
    if resolved in ("c:/data", "/data") or resolved.startswith(("c:/data/", "/data/")):
        raise SystemExit(f"refusing a data dir inside the shared root: {path}")


def capture(out: Path, data_dir: Path | None = None) -> dict:
    data_dir = data_dir or Path(tempfile.mkdtemp(prefix="t2b-capture-"))
    _refuse_shared_root(data_dir)
    spec = {"day": PINNED_DAY, "symbol": SYMBOL, "email": "capture-member@local.dev", "password": "CaptureOnly-2026!"}
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", CHILD, str(REPO), str(data_dir), json.dumps(spec)],
                       cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=600)
    out.mkdir(parents=True, exist_ok=True)
    tip = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    log = f"tip: {tip}\nrc: {r.returncode}\n--- stdout ---\n{r.stdout or ''}\n--- stderr (tail) ---\n{(r.stderr or '')[-6000:]}\n"
    (out / "child.log").write_text(log, encoding="utf-8", newline="\n")
    lines = [ln for ln in (r.stdout or "").splitlines() if ln.startswith("CAPTURED ")]
    if r.returncode != 0 or not lines:
        raise SystemExit(f"capture failed (rc {r.returncode}); see {out / 'child.log'}")
    body = json.loads(lines[-1][len("CAPTURED "):])
    (out / "alerts-body.json").write_text(json.dumps(body, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    meta = {"tool": "tools/capture_followup_notice.py", "tip": tip, "pinned_day": PINNED_DAY, "symbol": SYMBOL,
            "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "producer": "earnings_followup.run_followups (default delivery -> note_tasks.deliver_in_app -> alerts.add_alert)",
            "route": "GET /api/alerts?limit=20 (api.routers.alerts, get_current_user overridden)",
            "seams_patched": ["reporters_on", "_reporters_configured", "_member_ids", "_member_sets", "_paid", "_reaction_pct"],
            "data_dir": str(data_dir)}
    (out / "meta.json").write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    return {"body": body, "meta": meta}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--data-dir", type=Path, default=None)
    args = ap.parse_args(argv)
    got = capture(args.out, args.data_dir)
    print(json.dumps(got["body"], indent=2, sort_keys=True))
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
