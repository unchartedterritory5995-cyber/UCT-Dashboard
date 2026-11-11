"""Does every hashed JS/CSS file reach members intact through Cloudflare? (CLAUDE.md speed rule 9)

Crawls the live site's asset graph (index.html, then every `assets/...js|css` name found inside each JS
file, which covers Vite's preload map and lazy chunks), and for each file compares:

  * what the EDGE delivers to a browser-like request (Accept-Encoding: br, gzip), decoded, against
  * the PLAIN file fetched from the origin directly (Railway domain, Accept-Encoding: identity),

byte for byte, plus the encoding and size on the wire. Any mismatch is named and the exit code is 1.
Run before and after turning ASSETS_NO_TRANSFORM_ENABLED off, and after every Cloudflare change.

Usage:
  python tools/cdn_asset_integrity.py [--edge https://uctintelligence.com]
         [--origin https://web-production-05cb6.up.railway.app] [--bust] [--json out.json]
  --bust adds a cache-busting query, so the edge fetches fresh from the origin (tests the CURRENT
  rules instead of whatever is cached).
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Safari/537.36"
ASSET_RE = re.compile(r"assets/[A-Za-z0-9_.\-]+?\.(?:js|css)\b")


def get(url: str, accept: str) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": accept, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()


def decode(body: bytes, encoding: str) -> bytes:
    enc = (encoding or "").strip().lower()
    if enc in ("", "identity"):
        return body
    if enc == "gzip":
        return gzip.decompress(body)
    if enc == "br":
        import brotli  # pip install brotli
        return brotli.decompress(body)
    raise ValueError(f"unexpected content-encoding {enc!r}")


def crawl(origin: str) -> list[str]:
    _, _, html = get(origin + "/", "identity")
    todo = sorted(set(ASSET_RE.findall(html.decode("utf-8", "replace"))))
    seen: set[str] = set()
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        if name.endswith(".js"):
            try:
                _, _, body = get(f"{origin}/{name}", "identity")
            except Exception:
                continue
            for found in ASSET_RE.findall(body.decode("utf-8", "replace")):
                if found not in seen:
                    todo.append(found)
    return sorted(seen)


def check(name: str, edge: str, origin: str, bust: bool) -> dict:
    suffix = f"?integrity={uuid.uuid4().hex[:12]}" if bust else ""
    row: dict = {"asset": name}
    try:
        _, _, plain = get(f"{origin}/{name}", "identity")
        status, h, wire = get(f"{edge}/{name}{suffix}", "br, gzip")
        enc = h.get("content-encoding", "")
        decoded = decode(wire, enc)
        row.update(status=status, encoding=enc or "identity", wire_bytes=len(wire), plain_bytes=len(plain),
                   cache=h.get("cf-cache-status", ""), cache_control=h.get("cache-control", ""),
                   intact=decoded == plain)
        if not row["intact"]:
            row["detail"] = f"decoded {len(decoded)} B vs origin {len(plain)} B"
    except Exception as e:  # noqa: BLE001 -- reported by name, never swallowed
        row.update(intact=False, detail=f"{type(e).__name__}: {e}")
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--edge", default="https://uctintelligence.com")
    ap.add_argument("--origin", default="https://web-production-05cb6.up.railway.app")
    ap.add_argument("--bust", action="store_true")
    ap.add_argument("--json")
    a = ap.parse_args()
    names = crawl(a.origin)
    if len(names) < 20:
        print(f"only {len(names)} assets found: the crawl itself failed; refusing to report a pass")
        return 3
    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(lambda n: check(n, a.edge, a.origin, a.bust), names))
    bad = [r for r in rows if not r.get("intact")]
    by_enc: dict[str, int] = {}
    for r in rows:
        by_enc[r.get("encoding", "?")] = by_enc.get(r.get("encoding", "?"), 0) + 1
    wire = sum(r.get("wire_bytes", 0) for r in rows)
    plain = sum(r.get("plain_bytes", 0) for r in rows)
    print(f"assets checked: {len(rows)}  intact: {len(rows) - len(bad)}  broken: {len(bad)}")
    print(f"encodings on the wire: {by_enc}")
    print(f"bytes on the wire: {wire:,} of {plain:,} plain ({(wire / plain * 100 if plain else 0):.1f}%)")
    for r in bad[:30]:
        print(f"  BROKEN {r['asset']}: {r.get('detail', '')}")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"rows": rows}, f, indent=1)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
