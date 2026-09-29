"""Rollback rehearsal probe (lane R1, scorecard clause 3b): one run against ONE sandbox.

Run against a sandbox booted from the tip (the control, `--mode seed`) or from a `git archive`
of one step of the newest-first revert chain (`--mode check`). It writes only through the app's
own doors, and only after the server proves it is the sandbox that writes `--integrity-log`
(the launcher's per-run nonce, `scripts/sandbox_identity.py`).

Every run measures the SAME things, whatever the step, so each landing's behaviour can be seen
leaving at its own step and staying gone, and every landing not yet reverted can be seen staying:

  A. one discriminating door per landing (`LANDING_PROBES`): an HTTP answer, or a computed style
     on the Notebook page, that the landing changed for members (or, where a landing is an
     operations surface, for the admin);
  B. the never-revert set: three notes created on the TIP (level 0, level 1 = a `highlight` mark,
     level 2 = a `tableOfContents` node) are opened in the served editor, typed into, and read
     back. Per body PUT: the declared `X-UCT-Notebook-Schema` and the status. After: whether the
     stored body still holds its node/mark and whether the typed words landed.

    python probe.py --base http://127.0.0.1:8229 --integrity-log <log> --out <dir> \
        --mode seed|check --fixtures <fixtures.json> --label <step>
Prints one JSON object and writes <out>/probe.json. Exit 0 always: the caller compares steps.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[4]            # the tip checkout: its launcher identity and provisioning
MEMBER = ("r1rb-member@local.dev", "LocalTest2026!", "r1rb rollback")
RECALL_WORD = "zephyrquartz"      # in the level-0 note's BODY only, never in a title
NOTICE_STRINGS = ("stored in a form the editor can't open", "newer version of the app",
                  "can't open", "read-only to keep it safe", "Reload to edit it")


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _p(text, marks=None):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = marks
    return {"type": "paragraph", "content": [node]}


FIXTURE_BODIES = {
    "n0": ("r1rb level 0", _doc(_p("level zero body"), _p(f"the recall word is {RECALL_WORD}"))),
    "n1": ("r1rb level 1", _doc(_p("level one body"), _p("marked words", [{"type": "highlight"}]))),
    "n2": ("r1rb level 2", _doc({"type": "heading", "attrs": {"level": 2},
                                 "content": [{"type": "text", "text": "Section"}]},
                                {"type": "tableOfContents"}, _p("level two body"))),
}
FIXTURE_MARKER = {"n0": RECALL_WORD, "n1": '"highlight"', "n2": '"tableOfContents"'}


def _deep_body(depth):
    """A bullet list nested `depth` levels (JSON depth well past MAX_BODY_DEPTH = 97)."""
    node = _p("deep")
    for _ in range(depth):
        node = {"type": "bulletList", "content": [{"type": "listItem", "content": [node]}]}
    return _doc(node)


def _status(resp):
    return resp.status


def _json(resp):
    try:
        return resp.json()
    except Exception:  # noqa: BLE001
        return None


def _note_of(body):
    if isinstance(body, dict):
        return body.get("note") if isinstance(body.get("note"), dict) else body
    return {}


def _trash(req, base, nid):
    if nid:
        try:
            req.delete(base + f"/api/j2/notes/{nid}")
        except Exception:  # noqa: BLE001
            pass


def landing_probes(member, admin, base, fx):
    """A. One discriminating door per landing. Each row: what was asked and what came back."""
    out = {}

    def get(req, path):
        r = req.get(base + path)
        return r.status, _json(r)

    def door(req, path):
        """A GET door's answer. ⛔ The status alone is not enough: an UNMOUNTED /api path is
        answered by the SPA catch-all with 200 text/html (measured on step p03), so a door is
        present only when it answers JSON."""
        r = req.get(base + path)
        ctype = (r.headers.get("content-type") or "").split(";")[0]
        return {"status": r.status, "json": _json(r) is not None and ctype == "application/json",
                "content_type": ctype}

    # L1c #228 (F6 switcher recall): a word only in a BODY is found by the quick switcher.
    s, j = get(member, f"/api/j2/notes/switcher?q={RECALL_WORD}")
    rows = (j or {}).get("notes") if isinstance(j, dict) else None
    out["L1c_switcher_body_recall"] = {"status": s, "text_matches": sum(
        1 for r in (rows or []) if isinstance(r, dict) and r.get("matched") == "text"),
        "rows": len(rows or [])}
    # L1b #224 (10D operations): the save-SLO read, admin.
    out["L1b_admin_notebook_slo"] = door(admin, "/api/admin/notebook-slo")
    # L1a #205 (10C integrity): a body with an EMPTY text node is refused at create.
    r = member.post(base + "/api/j2/notes", data={"title": "r1rb unbuildable",
                                                   "bodyJson": _doc({"type": "paragraph", "content": [
                                                       {"type": "text", "text": ""}]})})
    nid = _note_of(_json(r)).get("id") if r.status in (200, 201) else None
    _trash(member, base, nid)
    out["L1a_unbuildable_body_at_create"] = {"status": r.status}
    # #203 (kept): a body nested past the depth cap is refused at create.
    r = member.post(base + "/api/j2/notes", data={"title": "r1rb deep", "bodyJson": _deep_body(60)})
    nid = _note_of(_json(r)).get("id") if r.status in (200, 201) else None
    _trash(member, base, nid)
    out["h203_depth_cap_at_create"] = {"status": r.status}
    # wave 9 #202: the selected-notes export checks ?format=.
    r = member.post(base + "/api/j2/notes/batch/export?format=__bogus__", data={"ids": [fx["n0"]]})
    out["w9_batch_export_bogus_format"] = {"status": r.status}
    # wave 8 #198: share links and publish (gates set to production's values for every boot).
    out["w8_share_links"] = door(member, "/api/j2/share/links")
    out["w8_publish"] = door(member, "/api/j2/publish")
    # 9C #197: the soak read, admin.
    out["9C_admin_notebook_soak"] = door(admin, "/api/admin/notebook-soak")
    # wave 7 #196: the personal API's token list.
    out["w7_personal_tokens"] = door(member, "/api/j2/personal/tokens")
    # wave 6 #193: note templates.
    out["w6_note_templates"] = door(member, "/api/j2/note-templates")
    # wave 5 #186: the quick switcher's own door.
    out["w5_switcher_door"] = door(member, "/api/j2/notes/switcher?q=r1rb")
    s, j = get(member, "/api/j2/notes/switcher?q=r1rb")
    out["w5_switcher_door"]["has_notes_key"] = isinstance(j, dict) and "notes" in j
    return out


def dom_probes(ctx, base, perf, out_dir):
    """#225 and #201 are CSS: read the computed styles they changed on the Notebook page."""
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    res = {}
    try:
        page.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        perf._dismiss_intro(page)
        page.wait_for_timeout(4000)
        res["skip_link"] = page.evaluate("""() => {
            // The NOTEBOOK's skip link (NotebookTab.jsx, into the Layout's slot) -- the Layout's own
            // app-level link also carries a class with "skipLink" in it and comes first.
            const el = document.querySelector('a[href="#notebook-pane"]');
            if (!el) return {present: false};
            const cs = getComputedStyle(el);
            return {present: true, pointerEvents: cs.pointerEvents, opacity: cs.opacity};
        }""")
        page.mouse.click(5, 5)            # a MOUSE interaction first: the bug was a mouse click
        res["pane_heading"] = page.evaluate("""() => {
            const el = document.querySelector('[class*="paneHeading"]');
            if (!el) return {present: false};
            el.focus();
            const cs = getComputedStyle(el);
            return {present: true, focused: document.activeElement === el, position: cs.position,
                    pointerEvents: cs.pointerEvents};
        }""")
        page.screenshot(path=str(out_dir / "notebook.png"))
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"[:300]
    res["page_errors"] = errors
    page.close()
    return res


def editor_probe(ctx, member, base, perf, key, nid, label, out_dir):
    """B. Open a fixture note in the served editor, type, read the store back."""
    puts, statuses, errors = [], {}, []
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))

    def on_req(q):
        if q.method == "PUT" and f"/api/j2/notes/{nid}" in q.url:
            puts.append({"schema": q.headers.get("x-uct-notebook-schema"), "url": q.url})

    def on_resp(r):
        if r.request.method == "PUT" and f"/api/j2/notes/{nid}" in r.url:
            statuses.setdefault("list", []).append(r.status)

    page.on("request", on_req)
    page.on("response", on_resp)
    res = {"note_id": nid}
    try:
        page.goto(base + f"/journal/notebook?note={nid}", wait_until="domcontentloaded")
        perf._dismiss_intro(page)
        try:
            page.wait_for_selector(".ProseMirror", timeout=30000)
            res["editor_mounted"] = True
        except Exception:  # noqa: BLE001
            res["editor_mounted"] = False
        page.wait_for_timeout(2500)
        text = page.locator("body").inner_text()
        res["notice_strings"] = [s for s in NOTICE_STRINGS if s in text]
        pm = page.locator(".ProseMirror").first
        res["editable_before_typing"] = bool(res["editor_mounted"] and pm.get_attribute("contenteditable") == "true")
        typed = f" r1rb typed {label}"
        if res["editable_before_typing"]:
            pm.click()
            page.keyboard.press("Control+End")
            page.keyboard.type(typed)
        page.wait_for_timeout(7000)
        text = page.locator("body").inner_text()
        res["notice_strings_after"] = [s for s in NOTICE_STRINGS if s in text]
        page.screenshot(path=str(out_dir / f"editor-{key}.png"))
        res["body_puts"] = [{"schema": p["schema"]} for p in puts]
        res["put_statuses"] = statuses.get("list", [])
        g = member.get(base + f"/api/j2/notes/{nid}")
        note = _note_of(_json(g))
        body = json.dumps(note.get("bodyJson") or note.get("body_json") or "")
        res["read_back_status"] = g.status
        res["stored_keeps_marker"] = FIXTURE_MARKER[key] in body
        res["stored_has_typed"] = typed.strip() in body
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"[:300]
    res["page_errors"] = errors
    page.close()
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--integrity-log", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", choices=("seed", "check"), required=True)
    ap.add_argument("--fixtures", required=True)
    ap.add_argument("--label", required=True)
    a = ap.parse_args()
    base = a.base.rstrip("/")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sid = _load("sid", REPO / "scripts" / "sandbox_identity.py")
    ver = sid.verify(base, a.integrity_log)
    res: dict = {"label": a.label, "mode": a.mode, "identity": ver.sentence, "proven": ver.ok}
    if not ver.ok:
        print(json.dumps(res, indent=2))
        (out / "probe.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
        return 0
    perf = _load("perf", REPO / "tools" / "notebook_perf_harness.py")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        admin = pw.request.new_context()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        perf._provision(admin, ctx.request, base, member=MEMBER)
        member = ctx.request
        fx_path = Path(a.fixtures)
        if a.mode == "seed":
            fx = {}
            for key, (title, body) in FIXTURE_BODIES.items():
                r = member.post(base + "/api/j2/notes", data={"title": title, "bodyJson": body})
                fx[key] = _note_of(_json(r)).get("id") if r.status in (200, 201) else None
                res[f"seed_{key}_status"] = r.status
            fx_path.write_text(json.dumps(fx, indent=2), encoding="utf-8")
        fx = json.loads(fx_path.read_text(encoding="utf-8"))
        res["fixtures"] = fx
        res["landings"] = landing_probes(member, admin, base, fx)
        res["dom"] = dom_probes(ctx, base, perf, out)
        res["editor"] = {k: editor_probe(ctx, member, base, perf, k, fx[k], a.label, out)
                         for k in ("n2", "n1", "n0") if fx.get(k)}
        ctx.close()
        admin.dispose()
        browser.close()
    print(json.dumps(res, indent=2))
    (out / "probe.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
