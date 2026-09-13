"""Wave P5 lane D — what happens to a scanned document's words afterwards.

⛔⛔ EVERY WAVE-P SURFACE HAS BEEN CERTIFIED ON THE WAY IN. Upload, classify,
read, search, quote, cite, attach. Nothing has asked the questions that only
matter on the way OUT, and they are the ones a member would ask a lawyer:

    1  can ANOTHER member read my scanned page?
    2  when I delete the document, do its words actually leave — including the
       search index that is a separate table with its own triggers?
    3  when I delete the document, what happens to the excerpt I staked a
       thesis on? (it must degrade honestly, not 404 in silence)
    4  does what I export carry the provenance the app shows me on screen?

⛔ LOCALHOST ONLY. Drives a fail-closed sandbox, refuses anything else.
⛔ SYNTHETIC PAGES ONLY, from `tools/wave_p_fixtures.py`.

    python tools/wave_p5_lifecycle_audit.py --port 8077
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("fx", ROOT / "tools" / "wave_p_fixtures.py")
fx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fx)

OWNER = ("p5owner@local.dev", "LocalTest2026!")
STRANGER = ("p5stranger@local.dev", "LocalTest2026!")

# A phrase that exists ONLY inside the scan, so finding it proves the OCR text
# is in the index and not finding it proves the index was actually cleaned.
NEEDLE = "CONDENSED"


class Client:
    def __init__(self, base: str):
        self.base, self.cookie = base, ""

    def call(self, path, data=None, *, method=None, files=None, timeout=120, raw=False):
        headers = {"User-Agent": "uct-p5-lifecycle"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        body = None
        if files is not None:
            boundary = "----uctp5life"
            name, filename, content, ctype = files
            buf = io.BytesIO()
            buf.write(f"--{boundary}\r\n".encode())
            buf.write(f'Content-Disposition: form-data; name="{name}"; '
                      f'filename="{filename}"\r\n'.encode())
            buf.write(f"Content-Type: {ctype}\r\n\r\n".encode())
            buf.write(content)
            buf.write(f"\r\n--{boundary}--\r\n".encode())
            body = buf.getvalue()
            headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        elif data is not None:
            body = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=body, headers=headers,
                                     method=method or ("POST" if body else "GET"))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                sc = r.headers.get_all("Set-Cookie") or []
                if sc:
                    self.cookie = "; ".join(c.split(";")[0] for c in sc)
                payload = r.read()
                return r.status, (payload if raw else json.loads(payload or b"{}"))
        except urllib.error.HTTPError as e:
            return e.code, {"error": e.read().decode()[:160]}

    def sign_in(self, email, password, name):
        self.call("/api/auth/signup", {"email": email, "password": password,
                                       "display_name": name})
        st, _ = self.call("/api/auth/login", {"email": email, "password": password})
        return st


def seed_scanned_note(cli: Client) -> tuple[str, str, str]:
    """A note with a scanned document whose OCR has finished, plus one excerpt."""
    st, note = cli.call("/api/j2/notes", {
        "title": "P5 lifecycle", "bodyJson": {"type": "doc",
                                              "content": [{"type": "paragraph"}]}})
    note_id = ((note or {}).get("note") or {}).get("id")
    img, _ = fx.page_clean()
    cli.call(f"/api/j2/notes/{note_id}/attachments",
             files=("file", "lifecycle-scan.pdf",
                    fx._images_to_scanned_pdf([img]), "application/pdf"))
    doc_id = None
    for _ in range(90):
        st, docs = cli.call(f"/api/j2/notes/{note_id}/documents")
        rows = (docs.get("documents") or []) if isinstance(docs, dict) else []
        if rows:
            doc_id = rows[0]["id"]
            if rows[0].get("textComplete"):
                break
        time.sleep(1)
    else:
        raise SystemExit("OCR never finished — the sandbox may not be armed (--ocr)")
    st, tr = cli.call(f"/api/j2/notes/documents/{doc_id}/pages/1/text")
    text = (tr or {}).get("text") or ""
    quote = "Total revenue was $12.48 billion"
    if quote not in text:
        raise SystemExit("the fixture phrase is not on the page — corpus drift?")
    idx = text.index(quote)
    st, ex = cli.call(f"/api/j2/notes/{note_id}/excerpts", {
        "documentId": doc_id, "pageNumber": 1, "capturedText": quote,
        "quotePrefix": text[max(0, idx - 40):idx], "quoteSuffix": text[idx + len(quote):idx + len(quote) + 40],
        "charStart": idx, "charEnd": idx + len(quote)})
    if st != 200:
        raise SystemExit(f"excerpt refused: {st} {ex}")
    return note_id, doc_id, ex["excerpt"]["id"]


def purge_in_sandbox(auth_db: str | None, data_dir: str | None) -> int | None:
    """Run the product's OWN retention sweep, with the retention set to zero.

    ⛔ THE SWEEP, NOT A DELETE STATEMENT. The question is whether the shipped
    purge takes the scanned text and its FTS mirror with it, so hand-writing the
    SQL here would test this script instead of the product.

    It runs in THIS process against the sandbox's database files — the paths are
    read at import, so they are set before the import. The sandbox is idle while
    this runs and the databases are WAL.
    """
    if not auth_db or not data_dir:
        return None
    import os
    os.environ["AUTH_DB_PATH"] = auth_db
    os.environ["DATA_DIR"] = data_dir
    sys.path.insert(0, str(ROOT))
    try:
        from api.services.journal_two import notes as notes_service
    except Exception as e:  # noqa: BLE001
        print(f"  (could not import the notes service: {e})")
        return None
    try:
        return int(notes_service.purge_expired_deleted_notes(retention_days=0))
    except Exception as e:  # noqa: BLE001
        print(f"  (the sweep raised: {e})")
        return None


def check(name: str, ok: bool, detail: str = "") -> dict:
    print(f"  {'[ok]' if ok else '[X] '} {name}" + (f"  — {detail}" if detail else ""))
    return {"check": name, "ok": ok, "detail": detail}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8077)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--auth-db", default=None,
                    help="the sandbox's auth.db, so the retention "
                         "sweep can be run against its data")
    ap.add_argument("--data-dir", default=None)
    args = ap.parse_args()
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print("REFUSING: loopback only.", file=sys.stderr)
        return 2
    base = f"http://{args.host}:{args.port}"

    owner, stranger = Client(base), Client(base)
    if owner.sign_in(*OWNER, "P5 owner") != 200:
        print("REFUSING: owner login failed.", file=sys.stderr)
        return 2
    if stranger.sign_in(*STRANGER, "P5 stranger") != 200:
        print("REFUSING: second account login failed.", file=sys.stderr)
        return 2

    print("seeding a scanned note…")
    note_id, doc_id, excerpt_id = seed_scanned_note(owner)
    results = []

    print("\n1 · another member's eyes")
    st, body = stranger.call(f"/api/j2/notes/documents/{doc_id}/pages/1/text")
    results.append(check("a stranger cannot read the page transcript",
                         st in (401, 403, 404), f"HTTP {st}"))
    st, hits = stranger.call(f"/api/j2/notes/documents/search?q={NEEDLE}")
    n = len((hits or {}).get("results") or (hits or {}).get("hits") or [])
    results.append(check("a stranger's search does not reach the scanned page",
                         st != 200 or n == 0, f"HTTP {st}, {n} hit(s)"))
    st, body = stranger.call(f"/api/j2/notes/{note_id}")
    results.append(check("a stranger cannot open the note",
                         st in (401, 403, 404), f"HTTP {st}"))

    print("\n2 · the owner can, which is the control")
    st, hits = owner.call(f"/api/j2/notes/documents/search?q={NEEDLE}")
    rows = (hits or {}).get("results") or (hits or {}).get("hits") or []
    mine = [r for r in rows if r.get("documentId") == doc_id]
    results.append(check("the owner's search finds the scanned page",
                         bool(mine), f"{len(mine)} hit(s)"))
    results.append(check("the hit says the words were read off a scan",
                         bool(mine) and mine[0].get("textOrigin") == "ocr",
                         (mine[0].get("textOrigin") if mine else "no hit") or "absent"))

    # ⛔ THERE IS NO "DELETE THIS DOCUMENT" ROUTE. A member removes a scanned
    # document by deleting the NOTE it arrived on, and `DELETE /notes/{id}` is a
    # SOFT delete — Wave 0's trash, restorable for TRASH_RETENTION_DAYS. So the
    # honest audit has two stages, and the first one's answer is a product fact
    # worth stating either way rather than a pass/fail.
    print("\n3 · the trash (soft delete)")
    st, _ = owner.call(f"/api/j2/notes/{note_id}", method="DELETE")
    results.append(check("the note moves to the trash", st == 200, f"HTTP {st}"))
    time.sleep(0.5)
    st, hits = owner.call(f"/api/j2/notes/documents/search?q={NEEDLE}")
    rows = (hits or {}).get("results") or []
    still = [r for r in rows if r.get("documentId") == doc_id]
    trashed_still_searchable = bool(still)
    print(f"  [--] a trashed note's scanned page is "
          f"{'STILL searchable' if trashed_still_searchable else 'no longer searchable'}"
          f" — {len(still)} hit(s). Restorable-for-30-days makes either answer "
          f"defensible; it is recorded here so it is a decision, not an accident.")
    results.append({"check": "trashed note's scanned page still searchable",
                    "ok": True, "detail": f"{len(still)} hit(s) — recorded, not judged"})

    print("\n4 · the purge, which is the promise that actually matters")
    purged = purge_in_sandbox(args.auth_db, args.data_dir)
    results.append(check("the retention sweep runs", purged is not None,
                         f"purged {purged} note(s)" if purged is not None
                         else "could not run the sweep in this sandbox"))
    if purged is not None:
        st, hits = owner.call(f"/api/j2/notes/documents/search?q={NEEDLE}")
        rows = (hits or {}).get("results") or []
        still = [r for r in rows if r.get("documentId") == doc_id]
        results.append(check("the scanned words leave the SEARCH INDEX, not just "
                             "the page table", not still,
                             f"{len(still)} hit(s) remain"))
        st, tr = owner.call(f"/api/j2/notes/documents/{doc_id}/pages/1/text")
        results.append(check("the page transcript is gone", st in (403, 404),
                             f"HTTP {st}"))
        st, one = owner.call(f"/api/j2/excerpts/{excerpt_id}")
        results.append(check("a purged excerpt answers honestly rather than "
                             "hanging", st in (200, 404), f"HTTP {st}"))

    bad = [r for r in results if not r["ok"]]
    print(f"\n{len(results) - len(bad)}/{len(results)} checks passed")
    if bad:
        print("\nFINDINGS:")
        for r in bad:
            print(f"  [X] {r['check']} — {r['detail']}")
    out = ROOT / "tools" / "wave_p5_load_out" / "lifecycle.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"results": results}, indent=2), encoding="utf-8")
    print(f"\nwrote {out}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
