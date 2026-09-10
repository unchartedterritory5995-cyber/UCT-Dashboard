#!/usr/bin/env python
"""WRITE a vendor capture fixture, with provenance, from a browser-read payload.

    python tools/visual_conformance/write_capture.py \\
        --out tests/fixtures/vendor/aroon-spy-1d-2026-09-10.json \\
        --payload <file.json> --chars 1520 --fnv1a 3367346568 \\
        --study "Aroon (14)" --symbol AMEX:SPY --tf 1D \\
        --job A --pine-source tools/visual_conformance/probes/foo.pine

⭐⭐ WHY THIS EXISTS. Every vendor capture before 2026-09-10 was hand-transcribed
into a fixture, so the only thing standing between a browser reading and a
committed number was a person copying it. This program has already paid for that
once: ``clock_parity.json`` claimed to be "RECORDED FROM THAT LANE" while its
recorder was never committed, and 14 of its 15 merge conflicts were two people
serialising the same numbers two ways.

⛔ THE RECEIPT IS CHECKED BEFORE ANYTHING IS WRITTEN. The page reports the exact
character count and an FNV-1a hash of the payload it staged; this recomputes both
over the bytes that actually arrived. A truncated or stomped transport cannot
match, and a mismatch writes NOTHING. (The prior capture programme lost a payload
to a concurrent session overwriting the clipboard mid-copy -- a silent no-op is
the worst possible failure for a capture, because the file still gets written and
every later number is quietly about the wrong thing.)

⛔ PROVENANCE IS NOT OPTIONAL AND IS NOT DECORATION. Every fixture carries the UTC
instant, the symbol, the timeframe, the study, the tab state AS ASSERTED, this
program's own invocation, and the sha256 of the ``.pine`` source that produced the
study. A fixture whose source cannot be named is a number nobody can reproduce.
⚠️ For a VENDOR BUILT-IN there is no ``.pine``: pass --study-id instead and the
provenance records the vendor's own identifier. Do not fake a hash and do not
leave the field empty -- say which kind of provenance this is.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import io
import json
import pathlib
import sys
import zoneinfo

ROOT = pathlib.Path(__file__).resolve().parents[2]
ET = zoneinfo.ZoneInfo("America/New_York")


def fnv1a(s: str) -> int:
    """⭐ THE SAME HASH THE PAGE COMPUTES. 32-bit FNV-1a over UTF-16 code units,
    which is what ``charCodeAt`` yields in the browser -- matching the algorithm
    matters more than choosing a good one."""
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True)
    ap.add_argument("--payload", required=True, help="JSON file the browser read")
    ap.add_argument("--chars", type=int, required=True, help="receipt: page-reported length")
    ap.add_argument("--fnv1a", type=int, required=True, help="receipt: page-reported hash")
    ap.add_argument("--job", required=True)
    ap.add_argument("--study", required=True)
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--tf", required=True)
    ap.add_argument("--layout", default="UCT AGENT VISIT 2026-09-10 (disposable)")
    ap.add_argument("--pine-source", default=None,
                    help="path to the .pine that produced the study (own scripts)")
    ap.add_argument("--study-id", default=None,
                    help="vendor identifier, for BUILT-INS that have no .pine")
    ap.add_argument("--tab-state", default=None, help="JSON file: the 0d assertion")
    ap.add_argument("--note", default=None)
    args = ap.parse_args()

    raw = io.open(args.payload, encoding="utf-8").read()
    payload = json.loads(raw)

    # ── the receipt, checked over what ARRIVED ────────────────────────────────
    # ⛔ HASHED OVER THE RAW FILE TEXT, NOT A RE-SERIALISATION. Re-encoding the
    # parsed object would compare Python's float repr against JavaScript's, so a
    # mismatch would mean "the two languages print doubles differently" rather
    # than "the transport lost bytes" -- and that is the one thing this check
    # exists to distinguish. The payload file must be the page's own
    # JSON.stringify output, byte for byte.
    canon = raw.strip()
    got_chars, got_hash = len(canon), fnv1a(canon)
    if got_chars != args.chars or got_hash != args.fnv1a:
        print("⛔ RECEIPT MISMATCH — NOTHING WRITTEN")
        print(f"   chars  page={args.chars}  shell={got_chars}")
        print(f"   fnv1a  page={args.fnv1a}  shell={got_hash}")
        print("   The payload that arrived is not the payload the page staged.")
        return 1

    if not args.pine_source and not args.study_id:
        print("⛔ REFUSING: neither --pine-source nor --study-id given. A fixture "
              "whose study cannot be named is not reproducible.")
        return 2

    src_block = {}
    if args.pine_source:
        p = pathlib.Path(args.pine_source)
        text = io.open(p, encoding="utf-8").read()
        exact = text[:-1] if text.endswith("\n") else text
        src_block = {
            "kind": "own .pine source",
            "path": str(p.relative_to(ROOT)).replace("\\", "/"),
            "sha256_no_trailing_newline": hashlib.sha256(exact.encode()).hexdigest(),
        }
    else:
        src_block = {
            "kind": "VENDOR BUILT-IN — no .pine exists",
            "studyId": args.study_id,
            "_note": ("A built-in has no source we can hash. The vendor's identifier IS "
                      "the provenance; it is recorded rather than a hash faked or a "
                      "field left blank."),
        }

    now = datetime.datetime.now(datetime.timezone.utc)
    doc = {
        "_": f"Vendor capture, job {args.job}. GENERATED — do not hand-edit.",
        "_recorder": (
            "⛔ GENERATED by tools/visual_conformance/write_capture.py. Rewrite by "
            "re-reading the chart and re-running that program; do not edit numbers "
            "here. The receipt below was verified over the bytes that arrived before "
            "this file was written."
        ),
        "_invocation": (
            "python tools/visual_conformance/write_capture.py "
            f"--out {args.out} --payload <browser payload> --chars {args.chars} "
            f"--fnv1a {args.fnv1a} --job {args.job} --study {args.study!r} "
            f"--symbol {args.symbol} --tf {args.tf}"
            + (f" --pine-source {src_block.get('path')}" if args.pine_source
               else f" --study-id {args.study_id}")
        ),
        "job": args.job,
        "capturedAtUTC": now.isoformat(timespec="seconds"),
        "capturedAtET": now.astimezone(ET).isoformat(timespec="seconds"),
        "symbol": args.symbol,
        "timeframe": args.tf,
        "study": args.study,
        "layout": args.layout,
        "source": src_block,
        "receipt": {"chars": got_chars, "fnv1a": got_hash, "verified": True},
        "payload": payload,
    }
    if args.tab_state:
        doc["tabStateAsAsserted"] = json.loads(io.open(args.tab_state, encoding="utf-8").read())
    if args.note:
        doc["_note"] = args.note

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    io.open(out, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    print(f"wrote {out}")
    print(f"  receipt VERIFIED: chars={got_chars} fnv1a={got_hash}")
    print(f"  provenance: {src_block['kind']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
