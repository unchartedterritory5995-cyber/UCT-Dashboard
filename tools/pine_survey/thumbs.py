"""
thumbs.py — build small embeddable thumbnails for the report gallery.

An Artifact page cannot load images from tradingview.com (the runtime CSP blocks
every non-allowlisted host, silently), so gallery images must be inlined as data
URIs. That makes bytes the binding constraint: the page must stay under 16 MB.

Emits thumbs.json:  { scriptIdPart: {"d": "<base64 jpeg>", "w":..,"h":.. } }
Only for scripts present in lane3_candidates.json (the ranked case studies).

Usage: python thumbs.py [count] [width] [quality]
"""

import base64
import io
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SNAP = os.path.join(HERE, "snapshots")


def main(count=120, width=420, quality=68):
    count, width, quality = int(count), int(width), int(quality)
    cands = json.load(open(os.path.join(HERE, "lane3_candidates.json"), encoding="utf-8"))
    out = {}
    total = 0
    missing = []
    for c in cands[:count]:
        iid = None
        if c.get("snapshot_file"):
            iid = os.path.splitext(os.path.basename(c["snapshot_file"]))[0]
        if not iid:
            missing.append(c["slug"])
            continue
        p = os.path.join(SNAP, iid + ".png")
        if not os.path.exists(p):
            missing.append(c["slug"])
            continue
        try:
            im = Image.open(p)
            im = im.convert("RGB")
            w, h = im.size
            nh = max(1, round(h * width / w))
            im = im.resize((width, nh), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
            b = buf.getvalue()
            out[c["scriptIdPart"] or c["slug"]] = {
                "d": base64.b64encode(b).decode("ascii"),
                "w": width, "h": nh, "slug": c["slug"],
            }
            total += len(b)
        except Exception as e:  # noqa: BLE001
            missing.append("%s (%s)" % (c["slug"], str(e)[:40]))

    json.dump(out, open(os.path.join(HERE, "thumbs.json"), "w", encoding="utf-8"))
    print("thumbnails : %d" % len(out))
    print("raw bytes  : %.2f MB" % (total / 1e6))
    print("base64 est : %.2f MB" % (total * 1.37 / 1e6))
    print("missing    : %d %s" % (len(missing), missing[:8]))


if __name__ == "__main__":
    main(*sys.argv[1:])
