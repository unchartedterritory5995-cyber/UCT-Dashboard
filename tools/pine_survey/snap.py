"""
snap.py — download TradingView chart-preview snapshots for the gallery.

Every catalog entry carries an `imageUrl` short id (e.g. "r6dAP7yi"). TradingView
serves the published chart snapshot for that id as a static image. This probes the
candidate URL shapes once, locks onto whichever answers with real image bytes, and
then downloads in bulk.

Usage:
  python snap.py probe            # find the working URL pattern
  python snap.py get [N]          # download snapshots for the top N by boosts
"""

import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SNAP_DIR = os.path.join(HERE, "snapshots")
CATALOG = os.path.join(HERE, "catalog.json")
PATTERN_FILE = os.path.join(HERE, "snap_pattern.json")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")

CANDIDATES = [
    "https://s3.tradingview.com/x/{id}_big.png",
    "https://s3.tradingview.com/x/{id}.png",
    "https://s3.tradingview.com/snapshots/{first}/{id}.png",
    "https://s3.tradingview.com/snapshots/{first}/{id}_big.png",
    "https://s3.amazonaws.com/tradingview/x/{id}_big.png",
    "https://www.tradingview.com/i/{id}/",
]


def fetch(url):
    # The bare request returns 403 from the snapshot bucket: it is referer-gated,
    # not absent. Send the same Referer/Origin the site's own <img> load carries.
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
        "Referer": "https://www.tradingview.com/",
        "Origin": "https://www.tradingview.com",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def load_catalog():
    with open(CATALOG, encoding="utf-8") as f:
        return json.load(f)


def probe():
    cat = load_catalog()
    ids = [v["imageUrl"] for v in cat.values() if v.get("imageUrl")][:5]
    print("probing with image ids:", ids)
    winners = {}
    for pat in CANDIDATES:
        good = 0
        for iid in ids:
            url = pat.format(id=iid, first=iid[0].lower())
            try:
                status, ctype, body = fetch(url)
                is_img = ctype.startswith("image/") and len(body) > 2000
                if is_img:
                    good += 1
                print("  %-56s %s %s %db %s" % (url[:56], status, ctype[:18], len(body),
                                                "OK" if is_img else ""))
            except Exception as e:  # noqa: BLE001
                print("  %-56s ERR %s" % (url[:56], str(e)[:50]))
            time.sleep(0.2)
        winners[pat] = good
    best = max(winners, key=lambda k: winners[k])
    print("\nBEST PATTERN: %s  (%d/%d ok)" % (best, winners[best], len(ids)))
    if winners[best] > 0:
        with open(PATTERN_FILE, "w", encoding="utf-8") as f:
            json.dump({"pattern": best, "hits": winners[best]}, f)
        print("saved to snap_pattern.json")
    else:
        print("NO PATTERN WORKED — snapshots need a browser; record that and move on.")


def get(n=300):
    if not os.path.exists(PATTERN_FILE):
        print("run `python snap.py probe` first")
        return
    pat = json.load(open(PATTERN_FILE, encoding="utf-8"))["pattern"]
    os.makedirs(SNAP_DIR, exist_ok=True)
    cat = load_catalog()
    items = [v for v in cat.values() if v.get("imageUrl") and v.get("access") == 1]
    items.sort(key=lambda v: -(v.get("agreeCount") or 0))
    items = items[:int(n)]
    manifest = {}
    mpath = os.path.join(HERE, "snap_manifest.json")
    if os.path.exists(mpath):
        manifest = json.load(open(mpath, encoding="utf-8"))
    ok = skip = fail = 0
    for i, v in enumerate(items, 1):
        iid = v["imageUrl"]
        out = os.path.join(SNAP_DIR, iid + ".png")
        if os.path.exists(out) and os.path.getsize(out) > 2000:
            skip += 1
            continue
        url = pat.format(id=iid, first=iid[0].lower())
        try:
            status, ctype, body = fetch(url)
            if not ctype.startswith("image/") or len(body) < 2000:
                fail += 1
                time.sleep(0.2)
                continue
            with open(out, "wb") as f:
                f.write(body)
            manifest[v["scriptIdPart"]] = {
                "imageUrl": iid, "file": out, "bytes": len(body),
                "title": v.get("title"), "author": v.get("author"),
                "agreeCount": v.get("agreeCount"), "editorsPick": v.get("editorsPick"),
            }
            ok += 1
        except Exception:  # noqa: BLE001
            fail += 1
        if i % 50 == 0:
            json.dump(manifest, open(mpath, "w", encoding="utf-8"), indent=1)
            print("  %d/%d ok=%d skip=%d fail=%d" % (i, len(items), ok, skip, fail), flush=True)
        time.sleep(0.25)
    json.dump(manifest, open(mpath, "w", encoding="utf-8"), indent=1)
    print("\nSNAPSHOTS DONE ok=%d skip=%d fail=%d -> %s" % (ok, skip, fail, SNAP_DIR))


def cands():
    """Snapshots for the COMPLEXITY-ranked case studies.

    `get()` walks the catalog by boosts; the case studies are ranked by measured
    visual complexity instead, so the two sets only partly overlap and the
    gallery came up short. This fills exactly the candidate list.
    """
    if not os.path.exists(PATTERN_FILE):
        print("run `python snap.py probe` first")
        return
    pat = json.load(open(PATTERN_FILE, encoding="utf-8"))["pattern"]
    os.makedirs(SNAP_DIR, exist_ok=True)
    cl = json.load(open(os.path.join(HERE, "lane3_candidates.json"), encoding="utf-8"))
    cat = load_catalog()
    ok = skip = fail = 0
    for i, c in enumerate(cl, 1):
        sid = c.get("scriptIdPart")
        entry = cat.get(sid) or {}
        iid = entry.get("imageUrl")
        if not iid:
            fail += 1
            continue
        out = os.path.join(SNAP_DIR, iid + ".png")
        if os.path.exists(out) and os.path.getsize(out) > 2000:
            skip += 1
            continue
        try:
            status, ctype, body = fetch(pat.format(id=iid, first=iid[0].lower()))
            if ctype.startswith("image/") and len(body) > 2000:
                with open(out, "wb") as f:
                    f.write(body)
                ok += 1
            else:
                fail += 1
        except Exception:  # noqa: BLE001
            fail += 1
        time.sleep(0.25)
    print("CANDIDATE SNAPSHOTS ok=%d skip(already had)=%d fail=%d" % (ok, skip, fail))


if __name__ == "__main__":
    c = sys.argv[1] if len(sys.argv) > 1 else "probe"
    if c == "probe":
        probe()
    elif c == "cands":
        cands()
    else:
        get(sys.argv[2] if len(sys.argv) > 2 else 300)
