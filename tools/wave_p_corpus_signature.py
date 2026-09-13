"""Wave P5 — is the Linux run measuring the SAME pages the 5.4.0 numbers came from?

⛔⛔ THE WHOLE POINT OF THE 5.3.0 CERTIFICATION IS AN APPLES-TO-APPLES NUMBER.
The fixture corpus is GENERATED, not committed (`.gitignore` line 44), so a
Linux runner regenerates it — and a regenerated corpus that differs by one
anti-aliased pixel would produce a recall number nobody could compare to
anything. "Probably the same, it's the same script" is exactly the assumption
this program keeps paying for.

⭐ SO IT IS MEASURED. This hashes the PAGE IMAGES THE ENGINE ACTUALLY SEES —
the decoded, grayscale pixel buffer pulled out of each fixture PDF by the same
`_page_images` the benchmark uses — not the files on disk.

⛔ THE FILE HASHES WOULD HAVE LIED IN BOTH DIRECTIONS. Measured on Windows,
regenerating the corpus produces eight scanned PDFs with different bytes (the
wrapper carries a timestamp) and eleven page images that are byte-identical. A
file-level check would refuse a corpus that is in fact identical; a check that
skipped the PDFs entirely would miss a real change to what the engine reads.

⚰️ AND THIS IS NOT HYPOTHETICAL — IT FIRED ON THE FIRST REAL RUN. Regenerating
the corpus inside the bookworm container moved ALL ELEVEN page images: same
script, same seeds, different Pillow/FreeType. Without this check the job would
have produced a "5.3.0 recall number" measured on different pixels, and it
would have looked exactly like an answer. The corpus the certification runs
against is therefore FROZEN in `tools/wave_p_cert_corpus/` — the same bytes the
5.4.0 reference was measured on, which is what isolates the engine as the one
variable under test.

    python tools/wave_p_corpus_signature.py --write     # record (a human act)
    python tools/wave_p_corpus_signature.py             # verify, exit 1 on drift

⛔ A MISSING RECORD IS A FAILURE, NOT A PASS. Verify refuses to run rather than
reporting green against a signature nobody wrote — `lesson_gate_that_cannot_fail`.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
# ⛔ THE FROZEN corpus, not the generated one. See the module docstring: a
# regeneration on another toolchain moved every one of the eleven page images.
DEFAULT_FIXTURES = ROOT / "tools" / "wave_p_cert_corpus"
RECORD = ROOT / "tools" / "wave_p_corpus_signature.json"

_BM_PATH = ROOT / "tools" / "wave_p0_ocr_benchmark.py"
_spec = importlib.util.spec_from_file_location("wave_p0_ocr_benchmark", _BM_PATH)
bm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bm)


def signature(fixtures: pathlib.Path) -> dict[str, str]:
    """`fixture:page:image -> sha256 of the grayscale pixel buffer`."""
    from pypdf import PdfReader

    man = json.loads((fixtures / "manifest.json").read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for key in man["fixtures"]:
        reader = PdfReader(io.BytesIO((fixtures / f"{key}.pdf").read_bytes()))
        for pno, page in enumerate(reader.pages, start=1):
            for idx, im in enumerate(bm._page_images(page)):
                g = im.convert("L")
                h = hashlib.sha256()
                h.update(f"{g.size[0]}x{g.size[1]}|".encode())
                h.update(g.tobytes())
                out[f"{key}:{pno}:{idx}"] = h.hexdigest()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    ap.add_argument("--write", action="store_true",
                    help="record the current corpus as the reference")
    args = ap.parse_args()

    fixtures = pathlib.Path(args.fixtures)
    if not (fixtures / "manifest.json").exists():
        print("run tools/wave_p_fixtures.py first", file=sys.stderr)
        return 2
    got = signature(fixtures)
    if not got:
        print("REFUSING: the corpus yielded no page images at all.", file=sys.stderr)
        return 2

    if args.write:
        RECORD.write_text(json.dumps({"pages": got}, indent=2, sort_keys=True) + "\n",
                          encoding="utf-8")
        print(f"recorded {len(got)} page images -> {RECORD.name}")
        return 0

    if not RECORD.exists():
        print(f"REFUSING: no reference at {RECORD.name}. A comparison with "
              "nothing to compare against is not a pass.", file=sys.stderr)
        return 2
    want = json.loads(RECORD.read_text(encoding="utf-8"))["pages"]
    missing = sorted(set(want) - set(got))
    extra = sorted(set(got) - set(want))
    changed = sorted(k for k in set(want) & set(got) if want[k] != got[k])
    print(f"page images: {len(got)} here, {len(want)} recorded")
    if missing or extra or changed:
        for k in missing: print(f"  [X] missing here: {k}")
        for k in extra:   print(f"  [X] not in the record: {k}")
        for k in changed: print(f"  [X] pixels differ: {k}")
        print("\nThe corpus is NOT the one the reference numbers were measured "
              "on. Any recall figure from this run is incomparable.", file=sys.stderr)
        return 1
    print("identical to the recorded corpus, page for page.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
