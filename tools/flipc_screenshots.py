#!/usr/bin/env python3
"""The owner's screenshots — so Flip C can be SEEN, not inferred from a number.

`docs/decisions/2026-08-04-flip-c-pane-geometry.md` prices a change nobody has
made. A pixel count is the evidence; a picture is the decision. This captures the
same parity case off two builds and stacks them into one labelled PNG under
`docs/decisions/assets/2026-08-04-flip-c/`.

    python tools/flipc_screenshots.py \
        --pair cutover=5941:5947 --pair sub-2.1=5947:5948 \
        --cases rsi_only bb_rsi_macd engine_three_bands_stacked

⚠️ It captures through `chart_parity.capture`, the SAME function the gate uses —
so a picture here settled the same way a measured frame did, and a case that
cannot settle raises instead of quietly saving whatever frame it had.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import chart_parity as cp  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "docs" / "decisions" / "assets" / "2026-08-04-flip-c"
BAND = 30
BG = (14, 15, 13)
INK = (220, 216, 204)


def stack(paths_labels, out_png, title):
    imgs = [(Image.open(p).convert("RGB"), lab) for p, lab in paths_labels]
    w = max(i.width for i, _ in imgs)
    h = sum(i.height + BAND for i, _ in imgs) + BAND
    canvas = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(canvas)
    d.text((10, 9), title, fill=INK)
    y = BAND
    for img, lab in imgs:
        d.text((10, y + 9), lab, fill=INK)
        y += BAND
        canvas.paste(img, (0, y))
        y += img.height
    canvas.save(out_png)
    return out_png


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", action="append", required=True,
                    help="`name=portA:portB`, repeatable")
    ap.add_argument("--cases", nargs="+", required=True)
    ap.add_argument("--label", action="append", default=[],
                    help="`name=A label|B label`, repeatable")
    ap.add_argument("--ready-timeout", type=int, default=60_000)
    args = ap.parse_args()

    labels = {}
    for spec in args.label:
        name, _, txt = spec.partition("=")
        a, _, b = txt.partition("|")
        labels[name] = (a, b)

    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT.parent / "_tmp"
    tmp.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--force-color-profile=srgb", "--font-render-hinting=none",
                  "--disable-lcd-text"])
        for spec in args.pair:
            name, _, ports = spec.partition("=")
            pa, _, pb = ports.partition(":")
            bases = {"a": f"http://127.0.0.1:{pa}", "b": f"http://127.0.0.1:{pb}"}
            ids = {k: cp.read_build_identity(v)["id"] for k, v in bases.items()}
            la, lb = labels.get(name, ("A", "B"))
            for case_name in args.cases:
                case = cp.load_cases(cp.CASES_PATH, [case_name], False)[0]
                w, h = case.get("w", 1200), case.get("h", 620)
                shots = []
                for side in ("a", "b"):
                    ctx = browser.new_context(viewport={"width": w + 60, "height": h + 60},
                                              device_scale_factor=1, reduced_motion="reduce")
                    page = ctx.new_page()
                    try:
                        url = cp.case_url(bases[side], case, "", None, side="a",
                                          instances_mode="none", perturb_instances=None)
                        png = tmp / f"{name}__{case_name}__{side}.png"
                        cp.capture(page, url, png, args.ready_timeout)
                        shots.append(png)
                    finally:
                        ctx.close()
                out = OUT / f"{name}__{case_name}.png"
                stack([(shots[0], f"A  {la}   build {ids['a']}"),
                       (shots[1], f"B  {lb}   build {ids['b']}")],
                      out, f"{name}  -  {case_name}")
                print(f"wrote {out}")
        browser.close()
    for f in tmp.glob("*.png"):
        f.unlink()
    tmp.rmdir()
    return 0


if __name__ == "__main__":
    sys.exit(main())
