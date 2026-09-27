"""Rollback rehearsal probe (wave 10, lane 10C, ruling R-11: Procedure A on a SANDBOX).

Run against a sandbox booted from EITHER the tip (the control) or a `git archive` of the tree
with the newest wave reverted. It writes only through the app's own doors, and only after the
server proves it is the sandbox (the launcher's per-run nonce, scripts/sandbox_identity.py).

What it measures, the same way on both trees:
  1. THE REVERTED WAVE IS GONE -- wave 9 made `POST /api/j2/notes/batch/export` check
     `?format=`: the tip answers 422 to `format=__bogus__`, a tree without wave 9 ignores the
     parameter and answers 200 with the Markdown zip it always sent.
  2. THE NEVER-REVERT SET IS NOT -- a note holding a LEVEL-2 node (`tableOfContents`, wave 6)
     opens in the served bundle without the unreadable notice, and the editor's body PUT
     declares `X-UCT-Notebook-Schema: 2`: the bundle still registers every table type, so a
     rollback did not drop the declaration a stale writer is judged by.
  3. THE SERVER COPY SURVIVES -- after the editor saved, the stored body still holds the node.

    python rollback-probe.py --base http://127.0.0.1:8213 --integrity-log <log> --out <dir>
Prints one JSON object; exit 0 always (the caller judges it against the other tree's).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[4]
UNREADABLE = ("stored in a form the editor can't open", "newer version of the app",
              "can't open", "read-only to keep it safe")


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--integrity-log", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    base = args.base.rstrip("/")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sid = _load("sid", REPO / "scripts" / "sandbox_identity.py")
    ver = sid.verify(base, args.integrity_log)
    res: dict = {"identity": ver.sentence, "proven": ver.ok}
    if not ver.ok:
        print(json.dumps(res, indent=2))
        return 0
    perf = _load("perf", REPO / "tools" / "notebook_perf_harness.py")
    from playwright.sync_api import sync_playwright
    email = f"w10c-rb-{time.strftime('%H%M%S')}@local.dev"
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        admin = pw.request.new_context()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        perf._provision(admin, ctx.request, base, member=(email, "LocalTest2026!", "w10c rollback"))
        doc = {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Section"}]},
            {"type": "tableOfContents"},
            {"type": "paragraph", "content": [{"type": "text", "text": "rollback probe"}]},
        ]}
        r = ctx.request.post(base + "/api/j2/notes", data={"title": "rollback probe", "bodyJson": doc})
        res["create"] = r.status
        nid = r.json()["note"]["id"] if r.status in (200, 201) else None
        res["note_id"] = nid
        if nid:
            e = ctx.request.post(base + "/api/j2/notes/batch/export?format=__bogus__", data={"ids": [nid]})
            res["batch_export_bogus_format"] = e.status
            puts: list[dict] = []
            page = ctx.new_page()
            page.on("request", lambda q: puts.append({"url": q.url, "schema": q.headers.get("x-uct-notebook-schema")})
                    if q.method == "PUT" and f"/api/j2/notes/{nid}" in q.url else None)
            page.goto(base + f"/journal/notebook?note={nid}", wait_until="domcontentloaded")
            perf._dismiss_intro(page)
            page.wait_for_selector(".ProseMirror", timeout=30000)
            page.wait_for_timeout(1500)
            text = page.locator("body").inner_text()
            res["unreadable_notice"] = any(s in text for s in UNREADABLE)
            pm = page.locator(".ProseMirror").first
            pm.click()
            page.keyboard.press("Control+End")
            page.keyboard.type(" typed after the rollback")
            page.wait_for_timeout(6000)
            res["body_puts"] = puts
            page.screenshot(path=str(out / "editor.png"))
            g = ctx.request.get(base + f"/api/j2/notes/{nid}").json()
            body = json.dumps((g.get("note") or g).get("bodyJson") or (g.get("note") or g).get("body_json") or "")
            res["stored_has_toc"] = "tableOfContents" in body
            res["stored_has_typed"] = "typed after the rollback" in body
        ctx.close()
        admin.dispose()
        browser.close()
    print(json.dumps(res, indent=2))
    (out / "rollback-probe.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
