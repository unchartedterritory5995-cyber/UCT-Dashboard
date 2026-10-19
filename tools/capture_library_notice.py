"""Capture the community library's two bell rows from the REAL producer and the REAL route (P3a Task 7).

The Notices fixture for the library kind is CAPTURED, never typed (lib/__fixtures__/notices.json,
`_provenance`). This tool runs, in a census-pinned CHILD process (the way tools/capture_followup_notice.py
does, so nothing reaches C:\\data):

  1. hub_sandbox_boot.apply_sandbox_env(data_dir, reclaim_conftest_temp=True), the library and journal-styles
     switches set to 1, and auth_db.init_db();
  2. an author and a member made by auth_service.create_user (the function the signup route calls);
  3. the author's style shared and approved, the member adopting it with "tell me about updates";
  4. the author's next version shared and approved (template_gallery.admin_act -> the update ring), then
     the author taking the style down (template_gallery.unpublish -> the withdraw ring), both with the
     DEFAULT delivery (alerts.add_alert);
  5. GET /api/alerts?limit=20 through a TestClient over a FastAPI app holding only the alerts router, with
     get_current_user overridden to the member. The child prints `CAPTURED <json>`.

The parent writes the printed body to <out>/alerts-body.json and the child's raw output to <out>/child.log
(R-RAW: raw first, committed before any fixture uses it). It never touches C:\\data and refuses a data dir
that resolves there. Nothing is patched: every step is the product's own code.

    python tools/capture_library_notice.py [--out docs/notebook/evidence/p3a-library-notice-capture] [--data-dir DIR]
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
DEFAULT_OUT = REPO / "docs" / "notebook" / "evidence" / "p3a-library-notice-capture"

CHILD = r'''
import json, os, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo); sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
os.environ["NOTEBOOK_STYLE_LIBRARY_ENABLED"] = "1"
os.environ["NOTEBOOK_JOURNAL_STYLES_ENABLED"] = "1"
from api.services import auth_db
auth_db.init_db()
from api.services import auth_service
author = auth_service.create_user(spec["author"], spec["password"], "Capture Author")["id"]
member = auth_service.create_user(spec["member"], spec["password"], "Capture Member")["id"]
from api.services.journal_two import journal_styles as js
from api.services.journal_two import template_gallery as gallery
conn = auth_db.get_connection()
style = js.create_style(author, {"name": "Weekend Prep", "kindId": "weekend_prep", "blocks": [],
                                 "outlineBodyJson": {"type": "doc", "content": []}}, conn)
item = gallery.publish_style(author, style["id"], title="Weekend Prep", description="", category="journal",
                             trading_style=None, conn=conn)
gallery.admin_act("capture-admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
copy = gallery.adopt_style(member, item["id"], notify=True, conn=conn)["style"]
js.update_style(author, style["id"], {"blocks": [{"block": "myRules", "enabled": True, "settings": {}}]}, conn)
gallery.publish_style(author, style["id"], title="Weekend Prep", description="", category="journal",
                      trading_style=None, conn=conn)
rev = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
gallery.admin_act("capture-admin", item["id"], "approve", reviewed_updated_at=rev["updatedAt"], conn=conn)
assert gallery.unpublish(author, item["id"], conn=conn) is True
conn.close()
print("RESULT " + json.dumps({"item": item["id"], "copy": copy["id"]}, sort_keys=True))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.middleware.auth_middleware import get_current_user
from api.routers import alerts as alerts_router
app = FastAPI()
app.include_router(alerts_router.router)
app.dependency_overrides[get_current_user] = lambda: {"id": member, "email": spec["member"]}
resp = TestClient(app).get("/api/alerts?limit=20")
assert resp.status_code == 200, resp.status_code
body = resp.json()
assert isinstance(body, list) and len(body) == 2, body
assert {r["type"] for r in body} == {"notebook_style_library"}, body
print("CAPTURED " + json.dumps(body, sort_keys=True))
'''


def _refuse_shared_root(path: Path) -> None:
    resolved = str(path.resolve()).replace("\\", "/").rstrip("/").lower()
    if resolved in ("c:/data", "/data") or resolved.startswith(("c:/data/", "/data/")):
        raise SystemExit(f"refusing a data dir inside the shared root: {path}")


def capture(out: Path, data_dir: Path | None = None) -> dict:
    data_dir = data_dir or Path(tempfile.mkdtemp(prefix="p3a-capture-"))
    _refuse_shared_root(data_dir)
    spec = {"author": "capture-author@local.dev", "member": "capture-member@local.dev",
            "password": "CaptureOnly-2026!"}
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
    meta = {"tool": "tools/capture_library_notice.py", "tip": tip,
            "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "producer": "template_gallery.admin_act (approve of a held revision) and template_gallery.unpublish,"
                        " default delivery -> alerts.add_alert",
            "route": "GET /api/alerts?limit=20 (api.routers.alerts, get_current_user overridden)",
            "seams_patched": [], "data_dir": str(data_dir)}
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
