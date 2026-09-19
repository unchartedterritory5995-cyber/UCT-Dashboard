"""Compare our own rendering of a Pine indicator against a human-provided
TradingView screenshot. The TradingView side is NEVER automated — a human has
already opened and authenticated that chart before this tool runs; see the
module-level docstring further down and spec §2 NG1
(docs/superpowers/specs/universal-indicator-ecosystem/RENDERING_PARITY_VERIFICATION_PROGRAM.md).

Uses SSIM (structural similarity), not chart_parity.py's exact-pixel diff() —
two renders of the same data on two different platforms (different fonts, AA,
DPI, JPEG compression, watermarks) are never near-pixel-identical, and an
exact-pixel comparator would report ~100% "changed" on every real pair. SSIM
compares local structure (luminance/contrast/structure windows) instead of
per-pixel bytes, so it tolerates that class of rendering noise while still
catching a genuinely different shape or color family.
"""
from __future__ import annotations

import json
import pathlib
import time

from PIL import Image
from skimage.metrics import structural_similarity
import numpy as np


def compare(a_path: pathlib.Path, b_path: pathlib.Path) -> dict:
    """Perceptual comparison. Returns {"score", "a_size", "b_size", "size_mismatch"}.

    A size mismatch is reported, never silently resized past — resizing one
    image to match the other changes what's being measured and would hide
    exactly the "the two builds framed the chart differently" class of
    problem chart_parity.py's own diff() refuses to paper over.
    """
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        return {"score": None, "a_size": list(a.size), "b_size": list(b.size),
                 "size_mismatch": True}

    a_arr = np.asarray(a)
    b_arr = np.asarray(b)
    # channel_axis=-1, never a greyscale conversion first: chart_parity.py's own
    # diff() documents a real incident where luma-weighted greyscale hid a
    # whole-canvas color change because blue only weighs 0.114 in that
    # formula. SSIM's multichannel mode compares each channel's structure
    # rather than collapsing to one luminance value first.
    score = structural_similarity(a_arr, b_arr, channel_axis=-1)
    return {"score": float(score), "a_size": list(a.size), "b_size": list(b.size),
             "size_mismatch": False}


#: Starting point, not a calibrated constant. No real vendor-pair SSIM
#: measurements exist yet — recalibrate once the first several real
#: comparisons have been run and a human has judged whether each one
#: "looked right." Override with --threshold; the CLI (Task 6) requires a
#: stated reason when overriding, mirroring chart_parity.py's own
#: --tolerance/--tolerance-reason pairing.
DEFAULT_THRESHOLD = 0.80


def verdict(compare_result: dict, threshold: float = DEFAULT_THRESHOLD) -> str:
    if compare_result["size_mismatch"]:
        return "SIZE_MISMATCH"
    return "OK" if compare_result["score"] >= threshold else "NEEDS_REVIEW"


def write_report(out_dir: pathlib.Path, slug: str, tag: str, member_shot: pathlib.Path,
                  vendor_shot: pathlib.Path, compare_result: dict, verdict_str: str) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"parity-report-{slug}-{tag}"
    md_path = out_dir / f"{stem}.md"
    json_path = out_dir / f"{stem}.json"

    record = {
        "slug": slug, "tag": tag, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "member_shot": str(member_shot), "vendor_shot": str(vendor_shot),
        "score": compare_result["score"], "size_mismatch": compare_result["size_mismatch"],
        "verdict": verdict_str,
    }
    json_path.write_text(json.dumps(record, indent=2))

    md_path.write_text(
        f"# Vendor parity report — {slug} ({tag})\n\n"
        f"**Verdict:** {verdict_str}\n"
        f"**SSIM score:** {compare_result['score']!r}\n"
        f"**Member shot:** `{member_shot}`\n"
        f"**Vendor shot:** `{vendor_shot}`\n\n"
        f"{'⚠️ Needs human review — score below threshold.' if verdict_str == 'NEEDS_REVIEW' else ''}"
        f"{'⛔ Size mismatch — the two captures are not directly comparable.' if verdict_str == 'SIZE_MISMATCH' else ''}\n"
    )
    return {"md": md_path, "json": json_path}


import argparse
import sys

import tools.pine_member_pane_capture as pmpc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://127.0.0.1:8131",
                     help="the local member-pane rig (see docs/pine/wip/rig/boot_rig.py)")
    ap.add_argument("--script", required=True, type=pathlib.Path,
                     help="path to the .pine fixture to attach on our own side")
    ap.add_argument("--slug", required=True,
                     help="short name for output files, e.g. 'rsi-divergence'")
    ap.add_argument("--vendor-screenshot", required=True, type=pathlib.Path,
                     help="path to the ALREADY-CAPTURED TradingView screenshot — a human "
                          "must produce this; this tool never opens or logs into TradingView")
    ap.add_argument("--out", default="docs/pine/capture", type=pathlib.Path)
    ap.add_argument("--tag", default=time.strftime("%Y-%m-%d"))
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    ap.add_argument("--threshold-reason", default="",
                     help="REQUIRED when --threshold differs from the default; printed in "
                          "the report, mirroring chart_parity.py's --tolerance-reason")
    args = ap.parse_args()

    if args.threshold != DEFAULT_THRESHOLD and not args.threshold_reason:
        ap.error("--threshold-reason is required when --threshold overrides the default")

    if not args.vendor_screenshot.exists():
        print(f"[vendor-parity] INCONCLUSIVE: vendor screenshot not found: "
              f"{args.vendor_screenshot}")
        return 2

    captured = pmpc.capture_member_pane(
        base=args.base, script_path=args.script, out_dir=args.out,
        tag=args.tag, slug=args.slug,
    )
    if not captured["ok"]:
        print(f"[vendor-parity] INCONCLUSIVE: member-side capture failed: {captured['reason']}")
        return 2

    result = compare(captured["shot"], args.vendor_screenshot)
    v = verdict(result, threshold=args.threshold)
    paths = write_report(
        out_dir=args.out, slug=args.slug, tag=args.tag,
        member_shot=captured["shot"], vendor_shot=args.vendor_screenshot,
        compare_result=result, verdict_str=v,
    )
    print(f"[vendor-parity] {v} — score={result['score']!r} — report: {paths['md']}")
    return 0 if v == "OK" else 1


if __name__ == "__main__":
    sys.exit(main())
