"""Wave P5 — 5.4.0 (the numbers we have) against 5.3.0 (the numbers that ship).

⛔⛔ THIS TOOL DOES NOT SET A BAR. The wave directive is explicit — "do not
retune against 5.3.0 before first measurement" — and a threshold invented after
seeing the first number is not a threshold, it is a rationalisation. So this
prints the DELTA and the benchmark's OWN findings (computed by rules that
existed before the run) and stops there. Whether the delta is acceptable is the
owner's call, on the evidence.

⛔ IT ALSO REFUSES TO COMPARE TWO DIFFERENT QUESTIONS. Same page-segmentation
mode, same fixture set, same per-page rows — otherwise the two columns are not
measuring one thing and the table would invite exactly the wrong conclusion.

    python tools/wave_p_ocr_version_compare.py \
        --reference tools/wave_p_ocr_reference_5_4_0.json \
        --candidate tools/wave_p15_tesseract_out/linux-bookworm.json
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys


def _rows(rep: dict) -> dict[str, dict]:
    return {f"{r['fixture']}:{r['page']}": r for r in rep["results"]}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", required=True)
    ap.add_argument("--candidate", required=True)
    args = ap.parse_args()

    ref = json.loads(pathlib.Path(args.reference).read_text(encoding="utf-8"))
    cnd = json.loads(pathlib.Path(args.candidate).read_text(encoding="utf-8"))

    print(f"reference : {ref['engine']}  psm={ref['psm'] or 'default'}")
    print(f"candidate : {cnd['engine']}  psm={cnd['psm'] or 'default'}")
    if ref["psm"] != cnd["psm"]:
        print("\nREFUSING: different page-segmentation modes. These are two "
              "questions, not one comparison.", file=sys.stderr)
        return 2

    a, b = _rows(ref), _rows(cnd)
    only_ref = sorted(set(a) - set(b))
    only_cnd = sorted(set(b) - set(a))
    if only_ref or only_cnd:
        for k in only_ref: print(f"  [X] in the reference only: {k}")
        for k in only_cnd: print(f"  [X] in this run only: {k}")
        print("\nREFUSING: the two runs do not cover the same pages.",
              file=sys.stderr)
        return 2

    def fmt(v, d=3):
        return f"{v:.{d}f}" if isinstance(v, (int, float)) else "  -  "

    print()
    print(f"{'page':<22} {'class':<8} {'CER':>13} {'financial':>13} "
          f"{'searchable':>13} {'sec':>13}")
    print("-" * 90)
    regressions = []
    for k in sorted(a):
        ra, rb = a[k], b[k]
        cells = []
        for field, d in (("cer", 3), ("financial_recall", 2),
                         ("fts_search_recall", 2), ("seconds", 2)):
            va, vb = ra.get(field), rb.get(field)
            cells.append(f"{fmt(va, d)}→{fmt(vb, d)}")
            if field in ("financial_recall", "fts_search_recall") \
                    and isinstance(va, (int, float)) and isinstance(vb, (int, float)) \
                    and vb < va:
                regressions.append(f"{k} {field}: {va} → {vb}")
            if field == "cer" and isinstance(va, (int, float)) \
                    and isinstance(vb, (int, float)) and vb > va:
                regressions.append(f"{k} cer: {va} → {vb} (worse)")
        print(f"{k:<22} {rb['classified']:<8} " + " ".join(f"{c:>13}" for c in cells))

    print()
    for label, key in (("FTS SEARCH recall", "fts_search_recall"),
                       ("financial recall", "financial_recall")):
        print(f"{label:<18}: mean {ref[key]['mean_readable']} → "
              f"{cnd[key]['mean_readable']}   ·   min "
              f"{ref[key]['min_readable']} → {cnd[key]['min_readable']}")
    print(f"{'seconds/page':<18}: p50 {ref['seconds_per_page']['p50']} → "
          f"{cnd['seconds_per_page']['p50']}   ·   max "
          f"{ref['seconds_per_page']['max']} → {cnd['seconds_per_page']['max']}")
    print(f"{'cold first page':<18}: {ref['cold_first_page_seconds']} → "
          f"{cnd['cold_first_page_seconds']}")

    # ⛔ The benchmark's own findings, not a new rule invented here.
    if cnd["findings"]:
        print("\nTHE BENCHMARK'S OWN FINDINGS ON THIS RUN:")
        for x in cnd["findings"]:
            print(f"  [X] {x}")

    if regressions:
        print("\nPER-PAGE MOVES IN THE WRONG DIRECTION (reported, not judged):")
        for r in regressions:
            print(f"  · {r}")
    else:
        print("\nNo per-page recall or CER moved in the wrong direction.")

    print("\n⛔ This is EVIDENCE, not a verdict. P2-LINUX-OCR-VERSION-CERT is "
          "closed by the owner reading these numbers, not by this exit code.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
