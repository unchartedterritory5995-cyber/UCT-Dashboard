"""Wave P activation canary — ONE controlled document, in production.

⛔⛔ THIS IS THE ONLY SCRIPT IN THE WAVE THAT TOUCHES PRODUCTION MEMBER-SERVING
STORAGE, AND IT IS BOUNDED BY CONSTRUCTION.

  · ONE note, ONE attachment, ONE document. There is no loop over documents and
    no reprocess path. It cannot become a backlog sweep by accident.
  · The owner-provisioned robot account ONLY (`canary-robot@uctintelligence.com`),
    resolved by email at run time. It will not write into a member's Notebook.
  · It REFUSES if that account already holds a document, so "exactly one first
    document" is enforced by the script rather than by remembering.
  · It REFUSES if OCR is not actually armed — a canary that silently proves
    nothing is worse than no canary.

⛔ THE PAGE IS SYNTHETIC. It comes from `tools/wave_p_fixtures.py`, the same
generator the benchmark and the rails use, so the expected text is known exactly
and no member content is involved.

⭐ WHAT IT PROVES, and it drives the product's own functions rather than
re-implementing them: classification → OCR → the usability gate → the FTS-safe
page write → Search with provenance → the page transcript → an exact,
source-backed excerpt — plus the refusal of a quote that is NOT on the page.

    /opt/venv/bin/python /app/tools/wave_p_activation_canary.py
    /opt/venv/bin/python /app/tools/wave_p_activation_canary.py --cleanup
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sqlite3
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

CANARY_EMAIL = "canary-robot@uctintelligence.com"
NOTE_TITLE = "Wave P OCR activation canary (synthetic — safe to delete)"
# ⛔ A WORD THAT EXISTS ONLY INSIDE THE SCANNED IMAGE. The note body is empty
# and production held ZERO document pages before this run, so a hit on it can
# only have come from OCR text reaching the search index. (Deliberately taken
# from the fixture's own ground truth, not from the test adapter's phrase —
# those are different corpora and mixing them is how a canary passes by
# accident.)
NEEDLE = "CONDENSED"
EXACT_FIGURE = "Total revenue was $12.48 billion"
NOT_ON_THE_PAGE = "Revenue was $99 billion"


def _fixtures():
    spec = importlib.util.spec_from_file_location(
        "wave_p_fixtures", ROOT / "tools" / "wave_p_fixtures.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _canary_user(conn) -> str | None:
    row = conn.execute("SELECT id FROM users WHERE email = ?",
                       (CANARY_EMAIL,)).fetchone()
    return row[0] if row else None


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--cleanup", action="store_true",
                    help="delete the canary note again (trash), nothing else")
    args = ap.parse_args()

    from api.services.auth_db import get_connection
    from api.services.journal_two import document_extraction as dx
    from api.services.journal_two import document_ocr as ocr
    from api.services.journal_two import document_ocr_tesseract as tess
    from api.services.journal_two import document_search
    from api.services.journal_two import note_excerpts as nx
    from api.services.journal_two import notes as notes_svc

    out: dict = {"engine": {}, "steps": []}

    def step(name, ok, detail=""):
        out["steps"].append({"step": name, "ok": bool(ok), "detail": str(detail)})
        print(f"  {'[ok]' if ok else '[X] '} {name}"
              + (f"  — {detail}" if detail else ""), flush=True)
        return ok

    # ── Arm, and refuse if it will not arm ──────────────────────────────────
    state = tess.install_if_enabled()
    out["engine"] = {**state, "max_concurrency": ocr.OCR_MAX_CONCURRENCY,
                     "fingerprint": tess.startup_fingerprint()}
    print(out["engine"]["fingerprint"], flush=True)
    if not ocr.ocr_available():
        print("REFUSING: OCR is not armed in this process. A canary that "
              "cannot run the engine proves nothing.", file=sys.stderr)
        return 2

    conn = get_connection()
    conn.row_factory = sqlite3.Row
    user_id = _canary_user(conn)
    if not user_id:
        print(f"REFUSING: no {CANARY_EMAIL} account.", file=sys.stderr)
        return 2

    if args.cleanup:
        n = 0
        for r in conn.execute("SELECT id FROM j2_notes WHERE user_id = ? AND title = ?",
                              (user_id, NOTE_TITLE)).fetchall():
            notes_svc.delete_note(user_id, r["id"])
            n += 1
        print(json.dumps({"trashed_notes": n}))
        return 0

    existing = conn.execute(
        "SELECT COUNT(*) FROM j2_note_documents WHERE user_id = ?",
        (user_id,)).fetchone()[0]
    if existing:
        print(f"REFUSING: the canary account already holds {existing} "
              "document(s). This runs ONCE.", file=sys.stderr)
        return 2

    # ── One note, one synthetic scan ────────────────────────────────────────
    fx = _fixtures()
    img, _ = fx.page_clean()
    pdf = fx._images_to_scanned_pdf([img])
    note = notes_svc.create_note(user_id, {
        "title": NOTE_TITLE,
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    note_id = note["id"]
    att = notes_svc.save_note_attachment_bytes(
        user_id, note_id, pdf, "wave-p-canary-scan.pdf", "application/pdf")
    doc = dx.create_document(user_id, note_id, att["url"], att.get("name"))
    doc_id = doc["id"]
    out["ids"] = {"note": note_id, "document": doc_id, "user": user_id,
                  "pdf_bytes": len(pdf)}
    step("one synthetic scanned document created", True,
         f"note {note_id[:8]} · doc {doc_id[:8]} · {len(pdf)} bytes")

    # ── The real production path ────────────────────────────────────────────
    t0 = time.perf_counter()
    dx.process_document(doc_id)          # native extraction + OCR planning
    plan_secs = time.perf_counter() - t0
    plan = ocr.plan_document(doc_id)
    step("the page is classified as a scan and claimed for OCR",
         plan.get("ocr_required") == [1],
         f"classes={plan.get('classes')} claimed={plan.get('ocr_required')}")

    t0 = time.perf_counter()
    res = ocr.ocr_document(doc_id, ocr.get_adapter())
    ocr_secs = time.perf_counter() - t0
    out["timing"] = {"extract_and_plan_seconds": round(plan_secs, 2),
                     "ocr_seconds": round(ocr_secs, 2),
                     "seconds_per_page": round(ocr_secs / max(1, res.get("pages_read") or 1), 2)}
    step("the page is read", (res.get("pages_read") == 1
                              and not res.get("stopped_early")),
         json.dumps({k: res.get(k) for k in ("pages_read", "pages_failed",
                                             "status", "stopped_early")}))

    state = ocr.document_text_state(conn, user_id, doc_id)
    step("the document reports itself complete and truthful",
         bool(state.get("text_complete")) and state.get("pages_from_ocr") == 1,
         json.dumps({k: state.get(k) for k in
                     ("status", "pages_total", "pages_with_text",
                      "pages_from_ocr", "pages_awaiting_ocr")}))

    # ── Search, with provenance ─────────────────────────────────────────────
    hits = document_search.search_document_pages(user_id, NEEDLE, limit=10)
    mine = [h for h in hits if h["document_id"] == doc_id]
    step("Search finds a word that exists ONLY inside the scan",
         bool(mine), f"{len(mine)} hit(s) for {NEEDLE!r}")
    step("the hit says the words were read off a scan",
         bool(mine) and mine[0]["text_origin"] == "ocr",
         (mine[0]["text_origin"] if mine else "no hit"))
    step("the hit points at a real document page, not a derived object",
         bool(mine) and mine[0]["page_number"] == 1,
         f"page {mine[0]['page_number']}" if mine else "-")

    # ── The transcript a member selects from ────────────────────────────────
    tr = ocr.page_transcript(user_id, doc_id, 1)
    text = (tr or {}).get("text") or ""
    step("the page transcript is available for selection",
         bool(tr) and tr.get("available") and tr.get("text_origin") == "ocr",
         f"{len(text)} chars")

    # ── An exact, source-backed excerpt — and the refusal ───────────────────
    idx = text.find(EXACT_FIGURE)
    if idx >= 0:
        ex = nx.create_excerpt(
            user_id, note_id, document_id=doc_id, page_number=1,
            captured_text=EXACT_FIGURE,
            quote_prefix=text[max(0, idx - 40):idx],
            quote_suffix=text[idx + len(EXACT_FIGURE):idx + len(EXACT_FIGURE) + 40],
            char_start=idx, char_end=idx + len(EXACT_FIGURE))
        step("an exact figure from the scan can be saved as a source quote",
             bool(ex) and ex.get("capturedText") == EXACT_FIGURE,
             f"offsets {ex.get('charStart')}-{ex.get('charEnd')}")
        out["ids"]["excerpt"] = (ex or {}).get("id")
        # ⛔ MIRROR THE ROUTE, DO NOT SHORTCUT IT. The endpoint follows
        # `create_excerpt` with `append_document_excerpt`, which puts the node
        # in the note body — and the note's excerpt LIST is rebuilt from those
        # nodes (the Wave N sidecar). Skipping it would make the read below
        # report "not listed" and read as a provenance defect that is really a
        # canary that did half the product's work.
        notes_svc.append_document_excerpt(user_id, note_id, ex["id"])
        # ⛔ PROVENANCE IS DERIVED FROM THE PAGE ON THE READ, never stored on
        # the excerpt — so the create return has no `textOrigin` and asking it
        # for one would report None and read as a defect. Ask the read path,
        # which is what every surface a member sees actually uses.
        listed = [e for e in nx.list_note_excerpts(user_id, note_id)
                  if e.get("id") == (ex or {}).get("id")]
        step("and the saved quote still says where its words came from",
             bool(listed) and listed[0].get("textOrigin") == "ocr",
             (listed[0].get("textOrigin") if listed else "not listed"))
    else:
        step("an exact figure from the scan can be saved as a source quote",
             False, "the fixture phrase is not on the page")

    refused = False
    try:
        nx.create_excerpt(user_id, note_id, document_id=doc_id, page_number=1,
                          captured_text=NOT_ON_THE_PAGE)
    except Exception as e:  # noqa: BLE001 — the refusal IS the assertion
        refused = "not on" in str(e).lower() or "page" in str(e).lower()
        out["refusal_message"] = str(e)[:160]
    step("a quote that is NOT on the page is refused", refused,
         out.get("refusal_message", "it was accepted — that is the defect"))

    conn.close()
    bad = [s for s in out["steps"] if not s["ok"]]
    out["passed"] = len(out["steps"]) - len(bad)
    out["total"] = len(out["steps"])
    print("\n" + json.dumps({k: out[k] for k in
                             ("engine", "ids", "timing", "passed", "total")},
                            indent=1))
    if bad:
        print("\nFINDINGS:", file=sys.stderr)
        for s in bad:
            print(f"  [X] {s['step']} — {s['detail']}", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
