"""Wave P1.5 §31 — Tesseract on the SAME corpus, with the SAME metrics.

⛔ THE METRICS ARE IMPORTED, NEVER RE-IMPLEMENTED. `wave_p0_ocr_benchmark`
already owns `_fts_search_recall`, `_searchable_words`, `_financial_tokens`,
`_cer` and `_wer`. A second copy here would let the two engines be scored by two
slightly different rulers, which is exactly how an apples-to-apples comparison
stops being one.

⛔ NO TEMP FILES. Tesseract reads the page image from STDIN and writes text to
STDOUT (`tesseract - -`), so the "no OCR temp surface" property P0 and P1 both
preserved survives this benchmark too (§26). If a future adapter ever needs a
file, that becomes its own decision with its own cleanup proof.

⛔ NO PYTHON WRAPPER. This shells out to the binary directly rather than
depending on `pytesseract`, so the measurement says nothing about a wrapper we
have not chosen — and a production adapter could work exactly this way, keeping
the Python dependency at zero.

⛔ BASELINE FIRST (§9). Default page-segmentation mode, no pre-processing, no
tuning. The point is to learn what Tesseract does out of the box on the same
pages the incumbent was measured on.

    python tools/wave_p15_tesseract_benchmark.py \\
        --tesseract "C:/Program Files/Tesseract-OCR/tesseract.exe"
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import pathlib
import statistics
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_FIXTURES = ROOT / "tools" / "wave_p_fixtures_out"
OUT_DIR = ROOT / "tools" / "wave_p15_tesseract_out"

_BM_PATH = ROOT / "tools" / "wave_p0_ocr_benchmark.py"
_spec = importlib.util.spec_from_file_location("wave_p0_ocr_benchmark", _BM_PATH)
bm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bm)

# ⛔ §13 — DOES THE ENGINE "CORRECT" THE SOURCE? Tesseract applies a dictionary
# by default. A search-friendly engine that silently rewrites a ticker or a
# figure is NOT better; source fidelity and searchability are separate
# questions and are reported separately.
FIDELITY_TOKENS = ["NVDA", "EBITDA", "RBOB", "AMC", "BMO"]


def ocr_via_stdin(tess: str, image, *, psm: int | None = None,
                  timeout: int = 180) -> tuple[str, float]:
    """One page, in memory, out to stdout."""
    buf = io.BytesIO()
    image.convert("L").save(buf, format="PNG")
    cmd = [tess, "stdin", "stdout", "-l", "eng"]
    if psm is not None:
        cmd += ["--psm", str(psm)]
    t0 = time.perf_counter()
    p = subprocess.run(cmd, input=buf.getvalue(), stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, timeout=timeout)
    secs = time.perf_counter() - t0
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode("utf-8", "replace")[:200])
    return p.stdout.decode("utf-8", "replace"), secs


def version(tess: str) -> str:
    out = subprocess.run([tess, "--version"], stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT).stdout
    return out.decode("utf-8", "replace").splitlines()[0].strip()


def run(tess: str, fixtures: pathlib.Path, *, psm: int | None = None) -> dict:
    from pypdf import PdfReader

    man = json.loads((fixtures / "manifest.json").read_text(encoding="utf-8"))
    ledger = man["ledger"]

    # Cold start: the first invocation pays process spawn + language load.
    img0, _ = None, None
    results, findings = [], []
    cold = None

    for key, meta in man["fixtures"].items():
        pdf = fixtures / f"{key}.pdf"
        reader = PdfReader(io.BytesIO(pdf.read_bytes()))
        for pno, page in enumerate(reader.pages, start=1):
            native = bm._norm(page.extract_text() or "")
            images = bm._page_images(page)
            truth_lines = meta["truth"].get(str(pno), [])
            truth = bm._norm(" ".join(truth_lines))
            row = {"fixture": key, "page": pno, "kind": meta["kind"],
                   "classified": ("native" if native else
                                  ("scanned" if images else "empty"))}
            if native or not images:
                row.update({"ocr_ran": False, "seconds": 0.0,
                            "cer": bm._cer(truth, native) if native else None,
                            "financial_recall": None, "fts_search_recall": None})
                results.append(row)
                continue
            try:
                got_raw, secs = ocr_via_stdin(tess, images[0], psm=psm)
            except Exception as e:  # noqa: BLE001
                findings.append(f"{key} p{pno}: tesseract failed: {e}")
                row.update({"ocr_ran": False, "seconds": 0.0, "cer": None,
                            "financial_recall": None, "fts_search_recall": None})
                results.append(row)
                continue
            if cold is None:
                cold = secs
            got = bm._norm(got_raw)

            toks = bm._financial_tokens(truth_lines, ledger)
            hits = [t for t in toks if t in got]
            words = bm._searchable_words(truth_lines)
            srch, unfindable = bm._fts_search_recall(got, words)
            # §13 · fidelity: a token that IS on the page must come back
            # unchanged, not "corrected".
            body = " ".join(truth_lines)
            fid_expected = [t for t in FIDELITY_TOKENS if t in body]
            fid_kept = [t for t in fid_expected if t in got]

            row.update({
                "ocr_ran": True, "seconds": round(secs, 2),
                "cer": round(bm._cer(truth, got), 4),
                "wer": round(bm._wer(truth, got), 4),
                "financial_tokens": len(toks), "financial_hits": len(hits),
                "financial_recall": round(len(hits) / len(toks), 4) if toks else None,
                "missed_tokens": [t for t in toks if t not in got][:8],
                "searchable_words": len(words),
                "fts_search_recall": round(srch, 4),
                "unfindable_words": unfindable[:8],
                "fidelity_expected": fid_expected, "fidelity_kept": fid_kept,
                "ocr_chars": len(got),
            })
            results.append(row)

    def readable(r):
        return not (r["fixture"] == "scan_failed_page" and r["page"] == 2)

    ocr_rows = [r for r in results if r["ocr_ran"]]
    srch = [r["fts_search_recall"] for r in ocr_rows if readable(r)]
    fin = [r["financial_recall"] for r in ocr_rows
           if r["financial_recall"] is not None and readable(r)]
    secs = [r["seconds"] for r in ocr_rows]

    # Controls, same as the incumbent's (§12/§38)
    by = {(r["fixture"], r["page"]): r for r in results}
    for r in results:
        if r["classified"] == "native" and r["ocr_ran"]:
            findings.append(f"{r['fixture']} p{r['page']}: a NATIVE page was OCR'd")
    bad = by.get(("scan_failed_page", 2))
    if bad and (bad.get("financial_recall") or 0) > bm.UNREADABLE_CEILING:
        findings.append("the unreadable-page control scored too well — the "
                        "corpus cannot detect bad OCR for this engine")
    lost = [t for r in ocr_rows for t in r.get("fidelity_expected", [])
            if t not in r.get("fidelity_kept", [])]
    if lost:
        findings.append(f"SOURCE FIDELITY: tokens the page contains but the "
                        f"engine did not return: {sorted(set(lost))}")

    return {
        "engine": version(tess), "psm": psm,
        "cold_first_page_seconds": round(cold, 2) if cold else None,
        "pages_ocred": len(ocr_rows),
        "seconds_per_page": {
            "p50": round(statistics.median(secs), 2) if secs else None,
            "max": round(max(secs), 2) if secs else None},
        "fts_search_recall": {
            "mean_readable": round(statistics.mean(srch), 4) if srch else None,
            "min_readable": round(min(srch), 4) if srch else None},
        "financial_recall": {
            "mean_readable": round(statistics.mean(fin), 4) if fin else None,
            "min_readable": round(min(fin), 4) if fin else None},
        "results": results, "findings": findings,
    }


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--tesseract", default="tesseract")
    ap.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    ap.add_argument("--psm", type=int, default=None)
    ap.add_argument("--label", default="report")
    args = ap.parse_args()

    fixtures = pathlib.Path(args.fixtures)
    if not (fixtures / "manifest.json").exists():
        print("run tools/wave_p_fixtures.py first", file=sys.stderr)
        return 2
    try:
        version(args.tesseract)
    except Exception as e:  # noqa: BLE001
        print(f"REFUSING TO RUN: no usable tesseract at {args.tesseract!r} ({e}).\n"
              "A benchmark that skips itself reads as a pass.", file=sys.stderr)
        return 2

    rep = run(args.tesseract, fixtures, psm=args.psm)
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / f"{args.label}.json").write_text(json.dumps(rep, indent=2),
                                                encoding="utf-8")
    print(f"{rep['engine']}  psm={rep['psm'] or 'default'}  "
          f"cold first page {rep['cold_first_page_seconds']}s")
    print(f"{'fixture':<20} {'p':>2} {'class':<8} {'sec':>6} {'CER':>6} "
          f"{'fin':>6} {'srch':>6}  words Search would miss")
    print("-" * 100)
    for r in rep["results"]:
        f = lambda v, w=6, d=3: (f"{v:.{d}f}" if v is not None else "  -  ")  # noqa: E731
        print(f"{r['fixture']:<20} {r['page']:>2} {r['classified']:<8} "
              f"{r['seconds']:>6.2f} {f(r.get('cer')):>6} "
              f"{f(r.get('financial_recall'), d=2):>6} "
              f"{f(r.get('fts_search_recall'), d=2):>6}  "
              f"{','.join(r.get('unfindable_words') or [])[:44]}")
    print(f"\nFTS SEARCH recall : mean {rep['fts_search_recall']['mean_readable']} "
          f"· min {rep['fts_search_recall']['min_readable']}")
    print(f"financial recall  : mean {rep['financial_recall']['mean_readable']} "
          f"· min {rep['financial_recall']['min_readable']}")
    print(f"seconds/page      : p50 {rep['seconds_per_page']['p50']} "
          f"· max {rep['seconds_per_page']['max']}")
    if rep["findings"]:
        print("\nFINDINGS:")
        for x in rep["findings"]:
            print(f"  [X] {x}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
