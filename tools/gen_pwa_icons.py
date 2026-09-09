"""Generate the PWA icon set from the brand master (Wave L Slice 4).

⛔ WHY THIS EXISTS AS A SCRIPT. The mobile share target is only reachable from a
phone's share sheet once the PWA is INSTALLABLE, and installability is gated on
the manifest declaring real icons. Hand-cropping them would leave four binaries
in the repo that nobody could regenerate or check — so the crop is a program and
the master stays the single source.

    python tools/gen_pwa_icons.py            # write app/public/icon-*.png
    python tools/gen_pwa_icons.py --check    # verify on disk, write nothing

⭐ THE MASKABLE ONE IS NOT THE SAME PICTURE. Android composites a maskable icon
under a launcher-chosen shape (circle, squircle, rounded square) and may crop
anything outside the inner 80% "safe zone" — so a full-bleed logo loses its
edges. The maskable variant paints the brand ground and scales the mark to
`SAFE_FRACTION` of the canvas; the plain ones stay transparent and full-bleed,
which is what a browser tab and the install prompt want. They are declared under
separate `purpose` values for exactly that reason — one file cannot do both jobs
well, and shipping one as both is why so many installed PWAs show a clipped mark.
"""
from __future__ import annotations

import argparse
import pathlib
import sys

from PIL import Image

REPO = pathlib.Path(__file__).resolve().parents[1]
PUBLIC = REPO / "app" / "public"
MASTER = PUBLIC / "UCT_logo_512.png"

# The app's own background token (index.html's data-theme="oled" ground).
BRAND_BG = (14, 15, 13, 255)

# Android's maskable safe zone is the inner 80% circle; 0.62 of the square keeps
# the mark inside it under every launcher shape with room to spare.
SAFE_FRACTION = 0.62

# `any` icons: full-bleed, transparent. 192 and 512 are the two sizes Chrome's
# installability check and the Android install prompt actually look for.
ANY_SIZES = (192, 512)
MASKABLE_SIZE = 512


def _load_master() -> Image.Image:
    if not MASTER.exists():
        raise SystemExit(f"missing brand master: {MASTER}")
    return Image.open(MASTER).convert("RGBA")


def _render_any(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.LANCZOS)


def _render_maskable(master: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BRAND_BG)
    inner = max(1, int(size * SAFE_FRACTION))
    mark = master.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    canvas.paste(mark, (off, off), mark)
    return canvas


def targets() -> list[tuple[pathlib.Path, str, int]]:
    out = [(PUBLIC / f"icon-{s}.png", "any", s) for s in ANY_SIZES]
    out.append((PUBLIC / f"icon-maskable-{MASKABLE_SIZE}.png", "maskable", MASKABLE_SIZE))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="verify the files exist at the right size; write nothing")
    args = ap.parse_args()

    if args.check:
        bad = []
        for path, _purpose, size in targets():
            if not path.exists():
                bad.append(f"{path.name}: missing")
                continue
            with Image.open(path) as im:
                if im.size != (size, size):
                    bad.append(f"{path.name}: {im.size} != ({size}, {size})")
        for line in bad:
            print(f"FAIL {line}")
        print("OK" if not bad else f"{len(bad)} problem(s)")
        return 1 if bad else 0

    master = _load_master()
    for path, purpose, size in targets():
        img = _render_maskable(master, size) if purpose == "maskable" else _render_any(master, size)
        img.save(path, "PNG", optimize=True)
        print(f"wrote {path.relative_to(REPO)} ({size}x{size}, {purpose}, {path.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
