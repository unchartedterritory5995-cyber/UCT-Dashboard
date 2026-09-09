"""Wave P §9/§10/§38 — does an OCR engine read FINANCIAL pages well enough?

⛔⛔ NOT A GENERIC WER BENCHMARK. §10 is explicit: an engine is not chosen from
prose accuracy. For a research notebook the decisive question is whether
`74.3%` survives as `74.3%` — because `73.4%`, `74.9%` and `14.3%` are all
"one character off" and all of them would mislead a member about a company's
margin. So the headline metric here is EXACT FINANCIAL TOKEN RECALL, and
character error rate is the supporting number, not the verdict.

⛔ THE ENGINE IS NOT IN `requirements.txt`, ON PURPOSE. This measures a
CANDIDATE. Run it from an isolated venv:

    python -m venv .ocrbench && .ocrbench/Scripts/pip install \\
        rapidocr-onnxruntime pypdf pillow numpy psutil
    .ocrbench/Scripts/python tools/wave_p0_ocr_benchmark.py

Running it with the repo interpreter is expected to fail loudly rather than
silently skip — a benchmark that no-ops when its subject is missing reads as
"verified" forever (`lesson_a_rails_important_half_can_be_opt_in`).

⛔ THE PAGE IMAGE COMES FROM `pypdf`, NOT A RASTERIZER. Measured in P0: a
genuinely scanned page carries exactly one full-page embedded image, and
`page.images` reaches it with no poppler, no pdfium and no temp file. A native
text page returns ZERO images, which makes the same call a reliable page
classifier for §8. That removes an entire dependency class and, with it, the
whole rasterized-temp-image leak surface §35 warns about.

⛔ AND IT CARRIES ITS OWN NON-VACUITY CONTROLS (§38): a page that is
unreadable by construction MUST score near zero, and the native-text control
MUST report that OCR was never needed. If the "unreadable" page scores well,
the corpus is not measuring what it claims to.
"""
from __future__ import annotations

import argparse
import io
import json
import pathlib
import re
import sqlite3
import statistics
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_FIXTURES = ROOT / "tools" / "wave_p_fixtures_out"
OUT_DIR = ROOT / "tools" / "wave_p0_bench_out"

# A page scoring below this on exact financial tokens is not usable for
# research. Not a vendor's number — the threshold this product needs.
FINANCIAL_RECALL_FLOOR = 0.90
# What "unreadable" has to look like for the control to mean anything.
UNREADABLE_CEILING = 0.25


def _rss_mb() -> float:
    try:
        import psutil
        return psutil.Process().memory_info().rss / 1024 / 1024
    except Exception:  # noqa: BLE001
        return float("nan")


def _norm(s: str) -> str:
    """Whitespace-insensitive, case-preserving. ⛔ Case and punctuation are NOT
    normalised away: `$1.2B` vs `$1.28` is exactly the error class this exists
    to catch, and lowercasing would hide `NVDA` vs `nvda` too."""
    return re.sub(r"\s+", " ", (s or "")).strip()


def _cer(truth: str, got: str) -> float:
    """Character error rate by Levenshtein distance, normalised by truth length.
    Two rolling rows rather than a full matrix: a dense page is ~2k characters
    and the full matrix is needless."""
    a, b = _norm(truth), _norm(got)
    if not a:
        return 0.0 if not b else 1.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return min(1.0, prev[-1] / len(a))


def _wer(truth: str, got: str) -> float:
    a, b = _norm(truth).split(), _norm(got).split()
    if not a:
        return 0.0 if not b else 1.0
    prev = list(range(len(b) + 1))
    for i, wa in enumerate(a, 1):
        cur = [i]
        for j, wb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (wa != wb)))
        prev = cur
    return min(1.0, prev[-1] / len(a))


def _page_images(page):
    """Embedded images for one page, as PIL images. Never raises: a page whose
    image cannot be decoded is a page with no image, which is an honest input
    to the classifier rather than a crash in a background job."""
    out = []
    try:
        for im in page.images:
            try:
                out.append(im.image)
            except Exception:  # noqa: BLE001
                continue
    except Exception:  # noqa: BLE001
        return []
    return out


# ⛔⛔ THE METRIC THAT CAUGHT WHAT NOTHING ELSE DID (P1.5). CER and financial
# token recall both looked acceptable for an engine whose output Search could
# not use at all: `j2_note_document_pages_fts` tokenises with `porter
# unicode61`, so a recogniser that emits `revenuewas$12.48billion` as one run
# produces a page that is indexed, a job that reports complete, and a member
# who searches "revenue" and gets nothing. Measured: one candidate scored CER
# 0.075 on a slide and found ZERO of its searchable words.
#
# This indexes the OCR output with the PRODUCTION tokenizer and asks the only
# question Wave P actually exists to answer.
_SEARCH_STOPWORDS = {
    "the", "was", "and", "for", "with", "per", "net", "not", "all", "its",
    "are", "our", "from", "that", "this", "were", "than", "over", "year",
}


def _searchable_words(truth_lines):
    """Words a member would plausibly type. Derived from THIS page's own ground
    truth, never a global list, for the same reason the financial tokens are."""
    out = []
    for w in re.findall(r"[A-Za-z]{4,}", " ".join(truth_lines)):
        lw = w.lower()
        if lw not in _SEARCH_STOPWORDS and lw not in out:
            out.append(lw)
    return out


def _fts_search_recall(text, words):
    """Index as production indexes, query as production queries."""
    if not words:
        return 1.0, []
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE VIRTUAL TABLE t USING fts5(text, tokenize='porter unicode61')")
    conn.execute("INSERT INTO t(text) VALUES (?)", (text,))
    missing, found = [], 0
    for w in words:
        if conn.execute("SELECT 1 FROM t WHERE t MATCH ?", (w,)).fetchone():
            found += 1
        else:
            missing.append(w)
    conn.close()
    return found / len(words), missing


def _financial_tokens(truth_lines: list[str], ledger: dict) -> list[str]:
    """The ledger values that actually appear on THIS page, plus every other
    number-shaped token in its ground truth.

    ⛔ DERIVED FROM THE PAGE, NOT A GLOBAL LIST. Scoring a page against values
    it never contained would make recall depend on which fixture it is.
    """
    body = " ".join(truth_lines)
    toks = [v for v in ledger.values() if v in body]
    # Every currency/percent/ratio/grouped-number on the page, so a table's
    # own values count even though they are not in the ledger.
    toks += re.findall(r"\(?\$?\d[\d,]*\.?\d*[%x]?\)?", body)
    seen, out = set(), []
    for t in toks:
        t = t.strip(".,")
        if len(t) > 1 and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def run(fixtures: pathlib.Path) -> dict:
    from pypdf import PdfReader
    from rapidocr_onnxruntime import RapidOCR

    man = json.loads((fixtures / "manifest.json").read_text(encoding="utf-8"))
    ledger = man["ledger"]

    t0 = time.perf_counter()
    rss_before = _rss_mb()
    engine = RapidOCR()
    cold_start_s = time.perf_counter() - t0
    rss_after_load = _rss_mb()

    results = []
    findings: list[str] = []

    for key, meta in man["fixtures"].items():
        pdf_path = fixtures / f"{key}.pdf"
        reader = PdfReader(io.BytesIO(pdf_path.read_bytes()))
        for pno, page in enumerate(reader.pages, start=1):
            native = _norm(page.extract_text() or "")
            images = _page_images(page)
            truth_lines = meta["truth"].get(str(pno), [])
            truth = _norm(" ".join(truth_lines))

            row = {
                "fixture": key, "page": pno, "kind": meta["kind"],
                "native_chars": len(native), "embedded_images": len(images),
                # §8's page classifier, and it is dependency-free.
                "classified": ("native" if native else
                               ("scanned" if images else "empty")),
            }

            if native:
                # §39 — a native page must never be sent through OCR.
                row.update({"ocr_ran": False, "cer": _cer(truth, native),
                            "wer": _wer(truth, native),
                            "financial_recall": None, "seconds": 0.0})
                results.append(row)
                continue

            if not images:
                row.update({"ocr_ran": False, "cer": None, "wer": None,
                            "financial_recall": None, "seconds": 0.0})
                results.append(row)
                continue

            import numpy as np
            t = time.perf_counter()
            got_parts = []
            for im in images:
                res, _ = engine(np.asarray(im.convert("RGB")))
                if res:
                    got_parts.extend(r[1] for r in res)
            secs = time.perf_counter() - t
            got = _norm(" ".join(got_parts))

            toks = _financial_tokens(truth_lines, ledger)
            hits = [t_ for t_ in toks if t_ in got]
            recall = (len(hits) / len(toks)) if toks else None
            words = _searchable_words(truth_lines)
            search_recall, unfindable = _fts_search_recall(got, words)

            row.update({
                "ocr_ran": True, "seconds": round(secs, 2),
                "cer": round(_cer(truth, got), 4),
                "wer": round(_wer(truth, got), 4),
                "financial_tokens": len(toks),
                "financial_hits": len(hits),
                "financial_recall": round(recall, 4) if recall is not None else None,
                "missed_tokens": [t_ for t_ in toks if t_ not in got][:8],
                "searchable_words": len(words),
                "fts_search_recall": round(search_recall, 4),
                "unfindable_words": unfindable[:8],
                "ocr_chars": len(got),
            })
            results.append(row)

    # ── The controls that make the numbers mean something (§38) ─────────────
    by = {(r["fixture"], r["page"]): r for r in results}

    # 1 · native pages must not have gone through OCR
    for r in results:
        if r["kind"] in ("native_pdf", "mixed_pdf") and r["classified"] == "native":
            if r["ocr_ran"]:
                findings.append(
                    f"{r['fixture']} p{r['page']}: a NATIVE text page was sent "
                    f"through OCR — §39 forbids it")

    # 2 · the mixed document must classify per page, not per document
    mixed = [r for r in results if r["fixture"] == "mixed"]
    kinds = {r["page"]: r["classified"] for r in mixed}
    if kinds != {1: "native", 2: "scanned", 3: "native"}:
        findings.append(f"the mixed control did not classify per page: {kinds}")

    # 3 · the unreadable page must actually fail
    bad = by.get(("scan_failed_page", 2))
    if bad is None:
        findings.append("the unreadable-page control is missing from the corpus")
    else:
        rec = bad.get("financial_recall")
        if rec is not None and rec > UNREADABLE_CEILING:
            findings.append(
                f"THE CORPUS CANNOT DETECT BAD OCR: the deliberately unreadable "
                f"page scored {rec:.2f} financial recall (ceiling "
                f"{UNREADABLE_CEILING}) — every other number here is suspect")

    # 4 · the clean page is the positive control
    clean = by.get(("scan_clean", 1))
    if clean and (clean.get("financial_recall") or 0) < FINANCIAL_RECALL_FLOOR:
        findings.append(
            f"the CLEAN control read only {clean['financial_recall']:.2f} of its "
            f"financial tokens — the engine does not clear the floor on the "
            f"easiest possible page")

    ocr_rows = [r for r in results if r["ocr_ran"]]
    per_page = [r["seconds"] for r in ocr_rows]
    def _readable(r):
        return not (r["fixture"] == "scan_failed_page" and r["page"] == 2)
    recalls = [r["financial_recall"] for r in ocr_rows
               if r["financial_recall"] is not None and _readable(r)]
    searches = [r["fts_search_recall"] for r in ocr_rows
                if r.get("fts_search_recall") is not None and _readable(r)]

    report = {
        "engine": "rapidocr-onnxruntime (candidate, NOT in requirements.txt)",
        "cold_start_seconds": round(cold_start_s, 2),
        "rss_mb": {"before_engine": round(rss_before, 1),
                   "after_engine_load": round(rss_after_load, 1),
                   "peak": round(_rss_mb(), 1)},
        "pages_ocred": len(ocr_rows),
        "seconds_per_page": {
            "p50": round(statistics.median(per_page), 2) if per_page else None,
            "max": round(max(per_page), 2) if per_page else None,
        },
        "financial_recall": {
            "mean_readable": round(statistics.mean(recalls), 4) if recalls else None,
            "min_readable": round(min(recalls), 4) if recalls else None,
        },
        # ⛔ THE PRIMARY ACCEPTANCE METRIC. Wave P ships a SEARCH feature.
        "fts_search_recall": {
            "mean_readable": round(statistics.mean(searches), 4) if searches else None,
            "min_readable": round(min(searches), 4) if searches else None,
        },
        "results": results,
        "findings": findings,
    }
    return report


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    args = ap.parse_args()

    fixtures = pathlib.Path(args.fixtures)
    if not (fixtures / "manifest.json").exists():
        print("run tools/wave_p_fixtures.py first", file=sys.stderr)
        return 2
    try:
        import rapidocr_onnxruntime  # noqa: F401
    except ImportError:
        print("REFUSING TO RUN: the candidate engine is not installed.\n"
              "This benchmark measures a package that is deliberately NOT in\n"
              "requirements.txt. Install it in an isolated venv — see the\n"
              "module docstring. A benchmark that skips itself reads as a pass.",
              file=sys.stderr)
        return 2

    rep = run(fixtures)
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "report.json").write_text(
        json.dumps(rep, indent=2), encoding="utf-8")

    print(f"cold start {rep['cold_start_seconds']}s · RSS "
          f"{rep['rss_mb']['before_engine']} -> {rep['rss_mb']['peak']} MB")
    print(f"{'fixture':<20} {'p':>2} {'class':<8} {'ocr':>4} {'sec':>6} "
          f"{'CER':>6} {'fin':>6} {'srch':>6}  words Search would miss")
    print("-" * 96)
    for r in rep["results"]:
        cer = f"{r['cer']:.3f}" if r["cer"] is not None else "  -  "
        fin = (f"{r['financial_recall']:.2f}"
               if r["financial_recall"] is not None else "  -  ")
        srch = (f"{r['fts_search_recall']:.2f}"
                if r.get("fts_search_recall") is not None else "  -  ")
        print(f"{r['fixture']:<20} {r['page']:>2} {r['classified']:<8} "
              f"{('yes' if r['ocr_ran'] else 'no'):>4} {r['seconds']:>6.2f} "
              f"{cer:>6} {fin:>6} {srch:>6}  "
              f"{','.join(r.get('unfindable_words') or [])[:40]}")
    print(f"\nFTS SEARCH recall (readable pages): mean "
          f"{rep['fts_search_recall']['mean_readable']} · min "
          f"{rep['fts_search_recall']['min_readable']}   "
          f"<- the metric Wave P is actually judged on")
    print(f"\nfinancial recall (readable pages): mean "
          f"{rep['financial_recall']['mean_readable']} · min "
          f"{rep['financial_recall']['min_readable']}")
    print(f"seconds/page p50 {rep['seconds_per_page']['p50']} · max "
          f"{rep['seconds_per_page']['max']}")
    if rep["findings"]:
        print("\nFINDINGS:")
        for f in rep["findings"]:
            print(f"  [X] {f}")
        return 1
    print("\ncontrols green: native never OCR'd · mixed classified per page · "
          "unreadable page failed · clean page cleared the floor")
    return 0


if __name__ == "__main__":
    sys.exit(main())
