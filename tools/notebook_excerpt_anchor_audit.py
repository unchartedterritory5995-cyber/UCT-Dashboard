"""Wave K Slice 0 — READ-ONLY excerpt-anchor corpus integrity audit.

WHY THIS EXISTS
---------------
Wave J's most important closure lesson: a stored excerpt anchor can silently
become invalid while every ordinary test stays green. The anchor was landing
NULL for essentially every multi-line capture and nothing went red -- the
excerpt saved, the card rendered, and only the durability guarantee was gone.

Wave K is about to build citation-grounded answers ON TOP of those anchors.
A retrieval system layered on silently-degraded anchors produces confident
answers citing passages it cannot locate, and nothing would go red there
either. So this runs FIRST, against the real corpus, before retrieval code.

CONTRACT (directive §18-19)
---------------------------
- READ-ONLY. This tool NEVER writes, repairs, or rewrites member research.
  It opens the database in SQLite read-only URI mode so that is enforced by
  the driver, not by discipline.
- Reports counts and ids ONLY. Never excerpt text, note titles, page text,
  or any other private content -- this output may be pasted into a report.
- An unresolved anchor does not invalidate the excerpt. `captured_text` is
  immutable and remains valid historical evidence (Wave J checkpoint
  decision 14). What degrades is CITATION NAVIGATION CONFIDENCE, and this
  tool exists so that confidence can be represented honestly rather than
  assumed.

WHAT IT VALIDATES, per excerpt
------------------------------
owner exists · note exists · note not trashed · document exists · page row
exists · captured_text non-empty · the stored anchor re-resolves against the
CURRENT extracted page text · the resolution is unambiguous enough to
navigate to.

A NOTE ON THE TWO PAGE TEXTS
----------------------------
The anchor is captured client-side against pdf.js's rendered text layer
(`PdfDocumentViewer._buildPageText`: span text plus "\n" at each <br>).
`j2_note_document_pages.text` is the SERVER's pypdf extraction. These are
independently produced strings and there is no guarantee they agree.
Measured on real Wave J data (2026-09-07) they DO agree -- captured_text
matched the server text exactly, and char_start/char_end indexed into the
server text correctly -- because both reproduce the PDF's own line
structure. This tool does not assume that: it tries exact, then
whitespace-normalized, then quote-context resolution, and reports which
tier each excerpt needed. A corpus that starts needing tier 2 or 3 is the
early warning that the two extractions have diverged.

USAGE
-----
    python tools/notebook_excerpt_anchor_audit.py --db <path-to-auth.db>
    python tools/notebook_excerpt_anchor_audit.py --db <path> --json
    python tools/notebook_excerpt_anchor_audit.py --db <path> --ids degraded
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter

# Verdicts, ordered worst -> best for reporting.
MISSING_OWNER = "missing_owner"
MISSING_NOTE = "missing_note"
MISSING_DOCUMENT = "missing_document"
TRASHED_SOURCE = "trashed_source"
MISSING_PAGE = "missing_page"
EMPTY_CAPTURE = "empty_capture"
UNRESOLVED = "unresolved_not_found"
DEGRADED_AMBIGUOUS = "degraded_ambiguous"
DEGRADED_NORMALIZED = "degraded_normalized"
RESOLVED_CONTEXT = "resolved_via_quote_context"
RESOLVED_EXACT = "resolved_exact"

# Verdicts that must NOT be used as a fully-confident source-navigation
# citation. `captured_text` is still valid evidence for every one of them.
NOT_NAVIGABLE = frozenset({
    MISSING_OWNER, MISSING_NOTE, MISSING_DOCUMENT, TRASHED_SOURCE,
    MISSING_PAGE, EMPTY_CAPTURE, UNRESOLVED, DEGRADED_AMBIGUOUS,
})

ORDER = [
    RESOLVED_EXACT, RESOLVED_CONTEXT, DEGRADED_NORMALIZED, DEGRADED_AMBIGUOUS,
    UNRESOLVED, EMPTY_CAPTURE, MISSING_PAGE, TRASHED_SOURCE,
    MISSING_DOCUMENT, MISSING_NOTE, MISSING_OWNER,
]


def _norm(s: str) -> str:
    """Whitespace-insensitive comparison form. Deliberately NOT a fuzzy
    match -- it collapses runs of whitespace and nothing else, so a tier-2
    resolution still means the characters are the member's own."""
    return " ".join((s or "").split())


def classify(exc: dict, page_text: str | None) -> tuple[str, int]:
    """Returns (verdict, occurrences). Pure -- no I/O, unit-testable."""
    captured = exc.get("captured_text") or ""
    if not captured.strip():
        return EMPTY_CAPTURE, 0
    if page_text is None:
        return MISSING_PAGE, 0

    hits = page_text.count(captured)
    if hits == 1:
        return RESOLVED_EXACT, 1
    if hits > 1:
        # Ambiguous on the bare text -- the quote context is exactly what
        # Wave J stored to disambiguate this case.
        prefix = exc.get("quote_prefix") or ""
        suffix = exc.get("quote_suffix") or ""
        if prefix or suffix:
            with_ctx = f"{prefix}{captured}{suffix}"
            ctx_hits = page_text.count(with_ctx)
            if ctx_hits == 1:
                return RESOLVED_CONTEXT, ctx_hits
        return DEGRADED_AMBIGUOUS, hits

    # Zero exact hits -- try whitespace normalization before calling it lost.
    n_page, n_cap = _norm(page_text), _norm(captured)
    n_hits = n_page.count(n_cap) if n_cap else 0
    if n_hits >= 1:
        return DEGRADED_NORMALIZED, n_hits
    return UNRESOLVED, 0


def audit(db_path: str) -> dict:
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        try:
            rows = conn.execute(
                "SELECT e.id, e.user_id, e.note_id, e.document_id, e.page_number,"
                " e.captured_text, e.quote_prefix, e.quote_suffix,"
                " e.char_start, e.char_end,"
                " u.id AS owner_ok, n.id AS note_ok, n.deleted_at AS note_deleted,"
                " d.id AS doc_ok"
                " FROM j2_note_excerpts e"
                " LEFT JOIN users u ON u.id = e.user_id"
                " LEFT JOIN j2_notes n ON n.id = e.note_id"
                " LEFT JOIN j2_note_documents d ON d.id = e.document_id"
            ).fetchall()
        except sqlite3.OperationalError as exc:
            return {"ok": False, "error": f"schema not present: {exc}", "total": 0}

        by_verdict: Counter = Counter()
        ids: dict[str, list[str]] = {}
        offset_disagreements: list[str] = []

        for r in rows:
            e = dict(r)
            if e["owner_ok"] is None:
                verdict, occ = MISSING_OWNER, 0
            elif e["note_ok"] is None:
                verdict, occ = MISSING_NOTE, 0
            elif e["note_deleted"] is not None:
                verdict, occ = TRASHED_SOURCE, 0
            elif e["doc_ok"] is None:
                verdict, occ = MISSING_DOCUMENT, 0
            else:
                page = conn.execute(
                    "SELECT text FROM j2_note_document_pages"
                    " WHERE document_id = ? AND page_number = ?",
                    (e["document_id"], e["page_number"]),
                ).fetchone()
                page_text = page["text"] if page is not None else None
                verdict, occ = classify(e, page_text)

                # Supplementary, never load-bearing: do the stored offsets
                # still index to the captured text in the CURRENT server
                # extraction? Disagreement is not a failure (the offsets were
                # captured against the client-side text layer) but a rising
                # count is the tell that the two extractions have drifted.
                if (page_text is not None and e["char_start"] is not None
                        and e["char_end"] is not None):
                    sl = page_text[e["char_start"]:e["char_end"]]
                    if sl != (e["captured_text"] or ""):
                        offset_disagreements.append(e["id"])

            by_verdict[verdict] += 1
            ids.setdefault(verdict, []).append(e["id"])

        total = len(rows)
        navigable = sum(c for v, c in by_verdict.items() if v not in NOT_NAVIGABLE)
        return {
            "ok": True,
            "total": total,
            "navigable": navigable,
            "not_navigable": total - navigable,
            "by_verdict": {v: by_verdict[v] for v in ORDER if by_verdict[v]},
            "ids": ids,
            "offset_disagreements": len(offset_disagreements),
            "offset_disagreement_ids": offset_disagreements,
        }
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", required=True, help="path to auth.db (opened READ-ONLY)")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    ap.add_argument("--ids", metavar="VERDICT",
                    help="also print the excerpt ids for one verdict "
                         "(or 'degraded' for every non-navigable verdict)")
    args = ap.parse_args()

    report = audit(args.db)
    if args.json:
        print(json.dumps(report, indent=2))
        return 0 if report.get("ok") else 2

    if not report.get("ok"):
        print(f"AUDIT DID NOT RUN: {report.get('error')}")
        return 2

    total = report["total"]
    print(f"Excerpt anchor audit - {total} excerpt(s)")
    if total == 0:
        print("  (no excerpts in this corpus - nothing to validate)")
        return 0
    print(f"  navigable citations : {report['navigable']}")
    print(f"  NOT navigable       : {report['not_navigable']}")
    for verdict, count in report["by_verdict"].items():
        flag = "  [X]" if verdict in NOT_NAVIGABLE else "  [ok]"
        print(f"{flag} {verdict:<28} {count}")
    if report["offset_disagreements"]:
        print(f"   -   stored char offsets disagreeing with the server "
              f"extraction: {report['offset_disagreements']} "
              f"(supplementary signal, not a failure)")

    if args.ids:
        want = ([v for v in report["ids"] if v in NOT_NAVIGABLE]
                if args.ids == "degraded" else [args.ids])
        for v in want:
            for i in report["ids"].get(v, []):
                print(f"    {v}\t{i}")

    # Exit non-zero when a citation could be rendered from an anchor that
    # cannot navigate -- that is the condition §19 says must stop the wave.
    return 1 if report["not_navigable"] else 0


if __name__ == "__main__":
    sys.exit(main())
