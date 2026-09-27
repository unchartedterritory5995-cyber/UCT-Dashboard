"""Lane 10E-2 -- the cross-tenant and anonymous probe over the Notebook's routes, against a
running census-pinned sandbox. A MEASUREMENT, not a rail: it writes its raw record first
(R-RAW) and judges after.

    python docs/notebook/proof/e2-d9e887ca0/security/cross_tenant_probe.py <scratch-dir> <out.json>

<scratch-dir> is the one `e2_sandbox.py` was started with (its `sandbox-ready.json` names the
base URL and the integrity log). Nothing is sent until `sandbox_identity.verify` proves the
server is that sandbox.

What it asks, and how each answer is judged
-------------------------------------------
Member A creates one of every owned object the routes name by id (note, folder, template,
saved view, property, inbox capture, image, fact, evidence, version, share link, publication,
personal token), each carrying a random MARKER. Then:

* FOREIGN READS -- member B and the sandbox ADMIN ask every by-id read with A's ids. A LEAK is
  a 2xx whose body carries A's marker. A 2xx without it is recorded (several reads answer an
  empty list for a foreign id by design, and say so in their docstrings); 403/404 is a refusal.
* FOREIGN WRITES -- B tries every by-id write on A's objects; afterwards A re-reads each object
  and it must be exactly as A left it (title, trash state, share and publication still live,
  token still listed). A write that took is a TAMPER.
* CROSS-TENANT BEARER -- A's personal token is used against B's note: it must not append.
* ANONYMOUS -- every Notebook path in the sandbox's own `/openapi.json` (the running server's
  answer, not a list typed here) is asked with no cookie and placeholder ids. A 2xx is judged
  against the route's declared class: only the public-token routes may answer, and only with a
  REAL token (the placeholder must 404).

CONTROLS, and the report is refused without them
------------------------------------------------
* NON-VACUITY: A's own read of each object must carry the marker, or that object's foreign rows
  are INCONCLUSIVE (a 404 for B proves nothing about an id that does not exist).
* PLANTED LEAK: the judge is run on a synthetic 200 carrying the marker and on a synthetic
  tampered re-read; both MUST be flagged, or the whole run reads INSTRUMENT-FAILED.
* ANONYMOUS CAN SEE A 2xx: the real share token must answer 200 to the anonymous context.
"""
import base64
import json
import re
import secrets
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import e2_common as C  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

# A 1x1 PNG, the smallest image the upload door accepts (image/png).
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

PUBLIC_PREFIXES = ("/api/j2/shared/", "/api/j2/published/")
# Paths that are not session routes and answer an anonymous caller by design; the reason is
# the route's own credential. Anything anonymous-2xx that is not here is a finding.
ANON_BY_DESIGN = {
    "/api/j2/capture/token": "code exchange (the single-use code is the credential)",
    "/api/j2/inbound-email": "HMAC-signed by the email worker (the signature is the credential)",
    "/api/j2/notes/connectors/obsidian/redeem": "connect-code exchange (HMAC-signed code)",
    "/api/j2/notes/connectors/obsidian/ingest": "device token (Authorization header)",
    "/api/j2/notes/connectors/{provider}/callback": "OAuth state bound to the session",
    "/api/j2/notebook-validation-report": "PUSH_SECRET bearer or admin session, checked in-handler",
}


def is_notebook_path(p: str) -> bool:
    low = p.lower()
    return ("notebook" in low or p.startswith(("/api/j2/notes", "/api/j2/note-", "/api/j2/property-defs",
            "/api/j2/saved-views", "/api/j2/facts", "/api/j2/evidence", "/api/j2/excerpts",
            "/api/j2/inbox", "/api/j2/capture", "/api/j2/ask", "/api/j2/telemetry", "/api/j2/link-preview",
            "/api/j2/share", "/api/j2/shared", "/api/j2/publish", "/api/j2/published", "/api/j2/export",
            "/api/j2/onboarding", "/api/j2/personal", "/api/j2/inbound-email")))


def body_text(resp) -> str:
    try:
        raw = resp.body()
    except Exception:  # noqa: BLE001 -- a streamed or aborted body
        return ""
    try:
        return raw.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        return ""


def zip_text(resp) -> str:
    """An export answers a zip: read every member so a marker inside a file is still seen."""
    import io
    import zipfile
    try:
        z = zipfile.ZipFile(io.BytesIO(resp.body()))
        return "\n".join(z.read(n).decode("utf-8", errors="replace") for n in z.namelist())
    except Exception:  # noqa: BLE001 -- not a zip
        return body_text(resp)


def judge_read(status: int, text: str, marker: str) -> str:
    """LEAK when a 2xx carries the owner's marker; REFUSED for 401/403/404; else ANSWERED-EMPTY."""
    if 200 <= status < 300 and marker and marker in text:
        return "LEAK"
    if status in (401, 403, 404):
        return "REFUSED"
    if 200 <= status < 300:
        return "ANSWERED-EMPTY"
    return f"OTHER-{status}"


def judge_state(before: dict, after: dict) -> str:
    return "INTACT" if before == after else "TAMPER"


def main() -> int:
    scratch, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    ready = C.ready_record(scratch)
    base = ready["base"]
    rec = {"tool": "cross_tenant_probe", "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "base": base, "integrity_log": ready["integrity_log"], "rows": [], "objects": {},
           "controls": {}, "anonymous": [], "errors": []}
    rec["nonce"] = C.require_identity(base, ready["integrity_log"])
    MARK = "E2MARK" + secrets.token_hex(6)
    rec["marker"] = MARK

    def dump():
        out_path.write_text(json.dumps(rec, indent=1, default=str), encoding="utf-8")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        adm = browser.new_context()
        a = browser.new_context()
        b = browser.new_context()
        anon = browser.new_context()
        C.signup_or_login(adm.request, base, C.ADMIN_EMAIL, C.PW, "hubtest")
        me_a = C.provision(adm.request, a.request, base, C.MEMBER_A, "e2 member a")
        me_b = C.provision(adm.request, b.request, base, C.MEMBER_B, "e2 member b")
        rec["accounts"] = {"A_paid": me_a.get("paid_equiv"), "B_paid": me_b.get("paid_equiv"),
                           "admin_ok": adm.request.get(base + "/api/auth/me").ok}
        A, B, ADM, ANON = a.request, b.request, adm.request, anon.request
        uid_a = (me_a.get("user") or {}).get("id")

        def j(resp):
            try:
                return resp.json()
            except Exception:  # noqa: BLE001
                return None

        # ---- A builds one of everything, each carrying the marker --------------------------
        o = rec["objects"]
        body = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"body {MARK}"}]}]}
        r = A.post(base + "/api/j2/notes", data={"title": f"A note {MARK}", "bodyJson": body})
        note = (j(r) or {}).get("note") or {}
        o["note"] = {"status": r.status, "id": note.get("id")}
        NA = note.get("id")
        # two more saves, so version history holds something
        for i in range(2):
            cur = (j(A.get(f"{base}/api/j2/notes/{NA}")) or {}).get("note") or {}
            body2 = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"body {MARK} rev{i}"}]}]}
            A.put(f"{base}/api/j2/notes/{NA}", data={"bodyJson": body2, "baseUpdatedAt": cur.get("updatedAt")})
        vers = (j(A.get(f"{base}/api/j2/notes/{NA}/versions")) or {}).get("versions") or []
        o["version"] = {"count": len(vers), "id": (vers[0] or {}).get("id") if vers else None}
        r = A.post(base + "/api/j2/note-folders", data={"name": f"A folder {MARK}"})
        o["folder"] = {"status": r.status, "id": ((j(r) or {}).get("folder") or {}).get("id")}
        r = A.post(base + "/api/j2/note-templates", data={"noteId": NA, "name": f"A template {MARK}"})
        o["template"] = {"status": r.status, "id": ((j(r) or {}).get("template") or {}).get("id")}
        r = A.post(base + "/api/j2/saved-views", data={"name": f"A view {MARK}", "viewType": "list", "spec": {}})
        o["view"] = {"status": r.status, "id": ((j(r) or {}).get("savedView") or {}).get("id")}
        r = A.post(base + "/api/j2/property-defs", data={"name": f"Aprop{MARK}", "type": "text"})
        o["property"] = {"status": r.status, "id": ((j(r) or {}).get("propertyDef") or {}).get("id")}
        r = A.post(base + "/api/j2/inbox", data={"widgetId": "chart", "params": {"marker": MARK}, "searchText": MARK})
        o["capture"] = {"status": r.status, "id": (j(r) or {}).get("id")}
        r = A.post(base + f"/api/j2/notes/{NA}/evidence", data={"targetType": "note", "targetId": NA,
                                                               "stance": "supports", "caption": f"ev {MARK}"})
        o["evidence"] = {"status": r.status, "id": ((j(r) or {}).get("evidence") or {}).get("id"), "detail": body_text(r)[:200]}
        r = A.post(base + f"/api/j2/notes/{NA}/images",
                   multipart={"file": {"name": "e2.png", "mimeType": "image/png", "buffer": PNG_1PX}})
        o["image"] = {"status": r.status, "url": (j(r) or {}).get("url")}
        r = A.post(base + f"/api/j2/notes/{NA}/share", data={"expiresInDays": None})
        o["share"] = {"status": r.status, "token": ((j(r) or {}).get("share") or {}).get("token")}
        r = A.post(base + f"/api/j2/publish/notes/{NA}", data={"expiresInDays": None})
        pub = (j(r) or {}).get("publication") or {}
        o["publication"] = {"status": r.status, "slug": pub.get("slug")}
        r = A.post(base + "/api/j2/personal/tokens", data={"label": "e2 probe"})
        tok = j(r) or {}
        o["personal_token"] = {"status": r.status, "id": tok.get("tokenId"),
                               "keys": sorted(tok.keys()) if isinstance(tok, dict) else None}
        bearer = tok.get("token") if isinstance(tok.get("token"), str) else None
        r = A.post(base + "/api/j2/capture", data={"noteId": NA, "url": "https://example.com/e2-" + MARK,
                                                  "title": "A capture " + MARK, "passage": "passage " + MARK,
                                                  "tier": "passage"})
        cap = j(r) or {}
        o["document"] = {"status": r.status, "id": cap.get("documentId"), "excerpt": cap.get("excerptId"),
                         "detail": body_text(r)[:200] if r.status != 200 else None}
        r = A.post(base + f"/api/j2/notes/{NA}/facts", data={"ticker": "AAPL", "factType": "price", "value": 123.45,
                                                            "caption": "fact " + MARK})
        o["fact"] = {"status": r.status, "id": ((j(r) or {}).get("fact") or {}).get("id"),
                     "detail": body_text(r)[:200] if r.status != 200 else None}
        # B's own note, for the cross-tenant bearer check
        r = B.post(base + "/api/j2/notes", data={"title": "B note", "bodyJson": {"type": "doc", "content": []}})
        NB = ((j(r) or {}).get("note") or {}).get("id")
        o["b_note"] = {"status": r.status, "id": NB}
        dump()

        ids = {"note_id": NA, "version_id": o["version"]["id"], "folder_id": o["folder"]["id"],
               "template_id": o["template"]["id"], "view_id": o["view"]["id"],
               "property_id": o["property"]["id"], "capture_id": o["capture"]["id"],
               "evidence_id": o["evidence"]["id"], "token_id": o["personal_token"]["id"],
               "slug": o["publication"]["slug"], "b_note": NB, "document_id": o["document"]["id"],
               "excerpt_id": o["document"]["excerpt"], "fact_id": o["fact"]["id"], "page_number": 1}

        # ---- non-vacuity: A's own reads carry the marker -----------------------------------
        own_reads = {
            "note": f"/api/j2/notes/{NA}",
            "version": f"/api/j2/notes/{NA}/versions/{ids['version_id']}" if ids["version_id"] else None,
            "folder": "/api/j2/note-folders",
            "template": f"/api/j2/note-templates/{ids['template_id']}" if ids["template_id"] else None,
            "view": "/api/j2/saved-views",
            "property": "/api/j2/property-defs",
            "capture": "/api/j2/inbox",
            "evidence": f"/api/j2/notes/{NA}/evidence",
            "image": o["image"]["url"],
            "document": f"/api/j2/excerpts/{ids['excerpt_id']}" if ids.get("excerpt_id") else None,
            "fact": f"/api/j2/notes/{NA}/facts",
        }
        visible = {}
        for k, path in own_reads.items():
            if not path:
                visible[k] = False
                continue
            rr = A.get(base + path)
            t = body_text(rr)
            visible[k] = rr.ok and (MARK in t or (k == "image" and rr.ok and len(rr.body()) > 0))
        rec["controls"]["owner_sees_own_objects"] = visible

        # ---- foreign reads -----------------------------------------------------------------
        reads = [
            ("GET", "/api/j2/notes/{note_id}", "note"),
            ("GET", "/api/j2/notes/{note_id}/versions", "note"),
            ("GET", "/api/j2/notes/{note_id}/versions/{version_id}", "version"),
            ("GET", "/api/j2/notes/{note_id}/export", "note"),
            ("GET", "/api/j2/export/notes/{note_id}", "note"),
            ("GET", "/api/j2/notes/{note_id}/backlinks", "note"),
            ("GET", "/api/j2/notes/{note_id}/related-from", "note"),
            ("GET", "/api/j2/notes/{note_id}/properties", "note"),
            ("GET", "/api/j2/notes/{note_id}/facts", "note"),
            ("GET", "/api/j2/notes/{note_id}/evidence", "evidence"),
            ("GET", "/api/j2/notes/{note_id}/thesis-summary", "evidence"),
            ("GET", "/api/j2/notes/{note_id}/reviews", "note"),
            ("GET", "/api/j2/notes/{note_id}/documents", "note"),
            ("GET", "/api/j2/notes/{note_id}/excerpts", "note"),
            ("GET", "/api/j2/notes/{note_id}/evidence-candidates", "note"),
            ("GET", "/api/j2/notes/{note_id}/trade-ref/resolve", "note"),
            ("GET", "/api/j2/notes/{note_id}/unlinked-mentions", "note"),
            ("GET", "/api/j2/notes/{note_id}/share", "note"),
            ("GET", "/api/j2/publish?note_id={note_id}", "note"),
            ("GET", "/api/j2/note-templates/{template_id}", "template"),
            ("GET", "/api/j2/notes?savedViewId={view_id}", "view"),
            ("GET", "/api/j2/notes/link-targets?ids={note_id}", "note"),
            ("GET", "/api/j2/notes/by-folders?ids={folder_id}", "note"),
            ("GET", "/api/j2/notes/switcher?q=" + MARK, "note"),
            ("GET", "/api/j2/notes?q=" + MARK, "note"),
            ("GET", "/api/j2/notes/tag-members?tag=" + MARK, "note"),
            ("GET", "/api/j2/note-folders", "folder"),
            ("GET", "/api/j2/saved-views", "view"),
            ("GET", "/api/j2/property-defs", "property"),
            ("GET", "/api/j2/inbox", "capture"),
            ("GET", "/api/j2/note-templates", "template"),
            ("GET", "/api/j2/notes/graph", "note"),
            ("GET", "/api/j2/notebook/home", "note"),
            ("GET", "/api/j2/notes/documents/search?q=" + MARK, "note"),
            ("GET", "/api/j2/notes/excerpts/search?q=" + MARK, "note"),
            ("GET", "/api/j2/personal/tokens", "note"),
            ("GET", "IMAGE", "image"),
            ("GET", "/api/j2/notes/documents/{document_id}/pages/{page_number}/text", "document"),
            ("GET", "/api/j2/excerpts/{excerpt_id}", "document"),
            ("GET", "/api/j2/notes/recents", "note"),
            ("GET", "/api/j2/notes/favorites", "note"),
        ]
        for who, req in (("B", B), ("ADMIN", ADM)):
            for method, tmpl, obj in reads:
                if tmpl == "IMAGE":
                    path = o["image"]["url"]
                else:
                    try:
                        path = tmpl.format(**ids)
                    except (KeyError, IndexError):
                        path = None
                if not path or "None" in path:
                    rec["rows"].append({"who": who, "kind": "read", "route": tmpl, "verdict": "NOT RUN",
                                        "why": "the owned object could not be made in the sandbox"})
                    continue
                rr = req.get(base + path)
                text = zip_text(rr) if "export" in path else body_text(rr)
                v = judge_read(rr.status, text, MARK)
                if v != "LEAK" and not visible.get(obj, True):
                    v = "INCONCLUSIVE(owner-cannot-see)"
                rec["rows"].append({"who": who, "kind": "read", "method": method, "route": tmpl, "path": path,
                                    "status": rr.status, "marker_in_body": MARK in text, "verdict": v,
                                    "body_head": text[:160] if v not in ("REFUSED",) else None})
        dump()

        # batch-shaped reads: POST, the owner's ids in the body
        batch_reads = [
            ("POST", "/api/j2/notes/batch/export", {"ids": [NA]}),
            ("POST", "/api/j2/notes/enrichment/scan", {"noteIds": [NA]}),
            ("POST", "/api/j2/notes/import/check", {"importKeys": [MARK]}),
        ]
        for method, path, payload in batch_reads:
            rr = B.post(base + path, data=payload)
            text = zip_text(rr) if "export" in path else body_text(rr)
            rec["rows"].append({"who": "B", "kind": "read", "method": method, "route": path, "path": path,
                                "status": rr.status, "marker_in_body": MARK in text,
                                "verdict": judge_read(rr.status, text, MARK)})

        # ---- foreign writes, then A re-reads -----------------------------------------------
        def snapshot():
            n = (j(A.get(f"{base}/api/j2/notes/{NA}")) or {}).get("note") or {}
            return {
                "note": {k: n.get(k) for k in ("title", "folderId", "tags", "locked", "archivedAt", "deletedAt", "heroImageUrl")},
                "note_ok": A.get(f"{base}/api/j2/notes/{NA}").status,
                "folder": sorted(f.get("name") for f in (j(A.get(base + "/api/j2/note-folders")) or {}).get("folders") or []),
                "template": ((j(A.get(f"{base}/api/j2/note-templates/{ids['template_id']}")) or {}).get("template") or {}).get("name") if ids["template_id"] else None,
                "views": sorted(v.get("name") for v in (j(A.get(base + "/api/j2/saved-views")) or {}).get("savedViews") or []),
                "props": sorted(v.get("name") for v in (j(A.get(base + "/api/j2/property-defs")) or {}).get("propertyDefs") or []),
                "inbox": len((j(A.get(base + "/api/j2/inbox")) or {}).get("captures") or []),
                "evidence": len((j(A.get(f"{base}/api/j2/notes/{NA}/evidence")) or {}).get("evidence") or []),
                "share_live": bool(((j(A.get(f"{base}/api/j2/notes/{NA}/share")) or {}).get("share") or {}).get("token")),
                "publication_live": ANON.get(f"{base}/api/j2/published/{ids['slug']}").status if ids["slug"] else None,
                "tokens": len((j(A.get(base + "/api/j2/personal/tokens")) or {}).get("tokens") or []),
                "favorite": NA in json.dumps(j(A.get(base + "/api/j2/notes/favorites")) or {}),
                "facts": sorted((f.get("caption") or "") for f in (j(A.get(f"{base}/api/j2/notes/{NA}/facts")) or {}).get("facts") or []),
                "excerpt": ((j(A.get(f"{base}/api/j2/excerpts/{ids['excerpt_id']}")) or {}).get("excerpt") or {}).get("annotation") if ids.get("excerpt_id") else None,
                "a_recents_has_b": NB in json.dumps(j(A.get(base + "/api/j2/notes/recents")) or {}),
                "a_folder_holds_b_note": NB in json.dumps(j(A.get(f"{base}/api/j2/notes/by-folders?ids={ids['folder_id']}")) or {}),
            }

        before = snapshot()
        rec["state_before"] = before
        writes = [
            ("PUT", "/api/j2/notes/{note_id}", {"title": "B was here"}),
            ("PATCH", "/api/j2/notes/{note_id}/lock", {"locked": True}),
            ("PATCH", "/api/j2/notes/{note_id}/tags", {"add": ["bwashere"], "remove": []}),
            ("PATCH", "/api/j2/notes/{note_id}/archive", {"archived": True}),
            ("POST", "/api/j2/notes/{note_id}/favorite", None),
            ("POST", "/api/j2/notes/{note_id}/embeds", {"attrs": {"widgetId": "chart", "params": {}}}),
            ("POST", "/api/j2/notes/{note_id}/evidence", {"targetType": "note", "targetId": NB, "stance": "supports"}),
            ("POST", "/api/j2/notes/{note_id}/reviews", {}),
            ("POST", "/api/j2/notes/{note_id}/versions/{version_id}/restore", {}),
            ("DELETE", "/api/j2/notes/{note_id}/hero", None),
            ("POST", "/api/j2/notes/{note_id}/share", {"expiresInDays": 7}),
            ("DELETE", "/api/j2/notes/{note_id}/share", None),
            ("POST", "/api/j2/publish/{slug}/refresh", None),
            ("PATCH", "/api/j2/publish/{slug}", {"expiresInDays": 7}),
            ("DELETE", "/api/j2/publish/{slug}", None),
            ("POST", "/api/j2/publish/notes/{note_id}", {"expiresInDays": None}),
            ("POST", "/api/j2/publish/folders/{folder_id}", {"expiresInDays": None}),
            ("PUT", "/api/j2/note-folders/{folder_id}", {"name": "B was here"}),
            ("DELETE", "/api/j2/note-folders/{folder_id}", None),
            ("PATCH", "/api/j2/note-templates/{template_id}", {"name": "B was here"}),
            ("DELETE", "/api/j2/note-templates/{template_id}", None),
            ("POST", "/api/j2/note-templates", {"noteId": NA, "name": "B copy"}),
            ("PUT", "/api/j2/saved-views/{view_id}", {"name": "B was here"}),
            ("DELETE", "/api/j2/saved-views/{view_id}", None),
            ("PUT", "/api/j2/property-defs/{property_id}", {"name": "Bwashere"}),
            ("DELETE", "/api/j2/property-defs/{property_id}", None),
            ("DELETE", "/api/j2/inbox/{capture_id}", None),
            ("DELETE", "/api/j2/evidence/{evidence_id}", None),
            ("DELETE", "/api/j2/personal/tokens/{token_id}", None),
            ("DELETE", "/api/j2/capture/connections/{token_id}", None),
            ("POST", "/api/j2/notes/batch", {"ids": [NA], "op": "trash", "args": {}}),
            ("POST", "/api/j2/notes", {"title": "B into A folder", "folderId": "{folder_id}"}),
            ("POST", "/api/j2/notes/import/confirm", {"notes": [{"title": "x", "markdown": "y"}], "destFolderId": "{folder_id}"}),
            ("POST", "/api/j2/notes/{note_id}/images", "PNG"),
            ("POST", "/api/j2/notes/{note_id}/writing-help/stream", {"action": "summarize", "scope": "whole", "text": "some words"}),
            ("POST", "/api/j2/notes/{note_id}/writing-help/autofill", {}),
            ("POST", "/api/j2/notes/{note_id}/ask/stream", {"query": "what is here"}),
            ("POST", "/api/j2/ask/stream", {"scope": "note", "target": "{note_id}", "query": "what is here"}),
            ("POST", "/api/j2/notes/{note_id}/facts", {"ticker": "AAPL", "factType": "price", "value": 1}),
            ("POST", "/api/j2/notes/{note_id}/hero", "PNG"),
            ("POST", "/api/j2/notes/{note_id}/attachments", "PNG"),
            ("POST", "/api/j2/capture", {"noteId": "{note_id}", "url": "https://example.com/b", "passage": "b words", "tier": "passage"}),
            ("POST", "/api/j2/notes/{note_id}/opened", None),
            ("POST", "/api/j2/notes/{b_note}/excerpts", {"documentId": "{document_id}", "pageNumber": 1, "capturedText": "x"}),
            ("POST", "/api/j2/notes/{b_note}/evidence", {"targetType": "note", "targetId": "{note_id}", "stance": "supports"}),
            ("POST", "/api/j2/notes/{b_note}/evidence", {"targetType": "document_excerpt", "targetId": "{excerpt_id}", "stance": "supports"}),
            ("POST", "/api/j2/notes/{b_note}/facts/{fact_id}/insert", None),
            ("PATCH", "/api/j2/excerpts/{excerpt_id}", {"annotation": "B was here"}),
            ("PUT", "/api/j2/facts/{fact_id}", {"caption": "B was here"}),
            ("DELETE", "/api/j2/facts/{fact_id}", None),
            ("POST", "/api/j2/notes/batch", {"ids": ["{b_note}"], "op": "move", "args": {"folderId": "{folder_id}"}}),
            ("POST", "/api/j2/saved-views", {"name": "B view", "viewType": "list", "spec": {"propertyFilter": [{"propertyId": "{property_id}", "op": "is_not_empty"}]}}),
            ("POST", "/api/j2/notes/{note_id}/restore", None),
            ("DELETE", "/api/j2/notes/{note_id}", None),
        ]
        for method, tmpl, payload in writes:
            try:
                path = tmpl.format(**ids)
            except (KeyError, IndexError):
                path = None
            if not path or "None" in path:
                rec["rows"].append({"who": "B", "kind": "write", "route": tmpl, "verdict": "NOT RUN",
                                    "why": "the owned object could not be made in the sandbox"})
                continue
            if isinstance(payload, dict):
                txt = json.dumps(payload)
                for key in ("folder_id", "note_id", "b_note", "document_id", "excerpt_id", "property_id"):
                    txt = txt.replace("{" + key + "}", str(ids.get(key)))
                payload = json.loads(txt)
            fn = {"GET": B.get, "POST": B.post, "PUT": B.put, "PATCH": B.patch, "DELETE": B.delete}[method]
            if payload == "PNG":
                rr = fn(base + path, multipart={"file": {"name": "b.png", "mimeType": "image/png", "buffer": PNG_1PX}})
            elif payload is None:
                rr = fn(base + path)
            else:
                rr = fn(base + path, data=payload)
            text = body_text(rr)
            rec["rows"].append({"who": "B", "kind": "write", "method": method, "route": tmpl, "path": path,
                                "status": rr.status, "marker_in_body": MARK in text,
                                "verdict": "LEAK" if (200 <= rr.status < 300 and MARK in text) else None,
                                "body_head": text[:200]})
        # What B's OWN note now shows: a cross-reference that took must not carry A's words.
        b_views = (j(B.get(base + "/api/j2/saved-views")) or {}).get("savedViews") or []
        b_view_paths = [f"/api/j2/notes?savedViewId={v['id']}" for v in b_views if v.get("id")]
        for path in (*b_view_paths, f"/api/j2/notes/{NB}", f"/api/j2/notes/{NB}/evidence", f"/api/j2/notes/{NB}/thesis-summary",
                     f"/api/j2/notes/{NB}/excerpts", f"/api/j2/notes/{NB}/facts", "/api/j2/saved-views",
                     "/api/j2/notes/recents"):
            rr = B.get(base + path)
            text = body_text(rr)
            rec["rows"].append({"who": "B-own", "kind": "read", "method": "GET", "route": path, "path": path,
                                "status": rr.status, "marker_in_body": MARK in text,
                                "verdict": judge_read(rr.status, text, MARK),
                                "body_head": text[:200]})
        after = snapshot()
        rec["state_after"] = after
        rec["write_verdict"] = judge_state(before, after)
        rec["write_diff"] = {k: [before[k], after[k]] for k in before if before[k] != after[k]}

        # ---- cross-tenant bearer: A's personal token on B's note -------------------------
        if bearer and NB:
            rr = ANON.post(f"{base}/api/j2/personal/notes/{NB}/append",
                           headers={"Authorization": f"Bearer {bearer}"}, data={"markdown": f"from A {MARK}"})
            nb_after = body_text(B.get(f"{base}/api/j2/notes/{NB}"))
            rec["rows"].append({"who": "A-bearer", "kind": "write", "method": "POST",
                                "route": "/api/j2/personal/notes/{note_id}/append (B's note)",
                                "status": rr.status, "marker_landed_in_B_note": MARK in nb_after,
                                "verdict": "TAMPER" if MARK in nb_after else "REFUSED"})
            rr = ANON.post(f"{base}/api/j2/personal/notes/{NA}/append",
                           headers={"Authorization": f"Bearer {bearer}"}, data={"markdown": "own append ok"})
            rec["controls"]["bearer_works_on_own_note"] = rr.status
        else:
            rec["rows"].append({"who": "A-bearer", "kind": "write", "verdict": "NOT RUN",
                                "why": f"no bearer in the mint response (keys {o['personal_token'].get('keys')})"})

        # ---- anonymous census over the server's own openapi --------------------------------
        spec = j(ANON.get(base + "/openapi.json")) or {}
        paths = sorted(pth for pth in (spec.get("paths") or {}) if is_notebook_path(pth))
        rec["anonymous_route_count"] = len(paths)
        filler = {"note_id": "e2-nope", "version_id": "e2-nope", "folder_id": "e2-nope", "template_id": "e2-nope",
                  "view_id": "e2-nope", "property_id": "e2-nope", "capture_id": "e2-nope", "fact_id": "e2-nope",
                  "evidence_id": "e2-nope", "excerpt_id": "e2-nope", "document_id": "e2-nope", "page_number": "1",
                  "token": "e2-nope-token", "slug": "e2-nope-slug", "pid": "e2-nope", "sub": "inline",
                  "filename": "x.png", "user_id_param": "e2-nope", "token_id": "e2-nope", "symbol": "AAPL",
                  "provider": "notion", "source_id": "e2-nope"}
        for pth in paths:
            for method in sorted((spec["paths"][pth] or {}).keys()):
                if method.upper() not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                    continue
                concrete = re.sub(r"\{([^}]+)\}", lambda m: filler.get(m.group(1), "e2-nope"), pth)
                fn = {"GET": ANON.get, "POST": ANON.post, "PUT": ANON.put, "PATCH": ANON.patch,
                      "DELETE": ANON.delete}[method.upper()]
                try:
                    rr = fn(base + concrete, max_redirects=0) if method.upper() == "GET" else fn(base + concrete, data={})
                    st = rr.status
                except Exception as e:  # noqa: BLE001
                    st = f"error {type(e).__name__}"
                public = pth.startswith(PUBLIC_PREFIXES)
                ok2xx = isinstance(st, int) and 200 <= st < 300
                if not ok2xx:
                    verdict = "REFUSED"
                elif pth in ANON_BY_DESIGN:
                    verdict = "ANSWERED-BY-DESIGN"
                else:
                    verdict = "ANON-2XX"
                rec["anonymous"].append({"method": method.upper(), "path": pth, "status": st,
                                         "public_token_route": public, "verdict": verdict})
        if o["share"]["token"]:
            rr = ANON.get(f"{base}/api/j2/shared/{o['share']['token']}")
            rec["controls"]["anonymous_can_see_a_2xx"] = {"status": rr.status, "marker": MARK in body_text(rr)}
        browser.close()

    # ---- the planted defects: the judges must flag them ------------------------------------
    rec["controls"]["planted_leak_flagged"] = judge_read(200, f'{{"note":{{"title":"{MARK}"}}}}', MARK) == "LEAK"
    rec["controls"]["planted_tamper_flagged"] = judge_state({"t": "A"}, {"t": "B"}) == "TAMPER"
    instrument_ok = (rec["controls"]["planted_leak_flagged"] and rec["controls"]["planted_tamper_flagged"]
                     and (rec["controls"].get("anonymous_can_see_a_2xx") or {}).get("status") == 200)
    leaks = [r for r in rec["rows"] if r.get("verdict") == "LEAK"]
    anon_bad = [r for r in rec["anonymous"] if r["verdict"] == "ANON-2XX"]
    tamper = rec.get("write_verdict") == "TAMPER" or any(r.get("verdict") == "TAMPER" for r in rec["rows"])
    rec["summary"] = {
        "instrument": "OK" if instrument_ok else "INSTRUMENT-FAILED",
        "foreign_reads": sum(1 for r in rec["rows"] if r.get("kind") == "read"),
        "leaks": len(leaks), "tamper": tamper, "write_diff": rec.get("write_diff"),
        "anonymous_routes": len(rec["anonymous"]), "anonymous_2xx_not_by_design": len(anon_bad),
        "not_run": sum(1 for r in rec["rows"] if r.get("verdict") == "NOT RUN"),
        "inconclusive": sum(1 for r in rec["rows"] if str(r.get("verdict", "")).startswith("INCONCLUSIVE")),
    }
    dump()
    print(json.dumps(rec["summary"], indent=1, default=str))
    return 0 if instrument_ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
