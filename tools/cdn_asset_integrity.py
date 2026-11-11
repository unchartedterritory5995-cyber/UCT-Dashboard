"""Does every hashed JS/CSS file reach members intact through Cloudflare? (CLAUDE.md speed rule 9)

Crawls the live site's asset graph (index.html, then every `assets/...js|css` name found inside each JS
file, which covers Vite's preload map and lazy chunks), and for each file compares:

  * what the EDGE delivers to a browser-like request (Accept-Encoding: br, gzip), decoded, against
  * the PLAIN file fetched from the origin directly (Railway domain, Accept-Encoding: identity),

for BOTH cache variants Cloudflare keeps: with and without an `Origin` request header. Browsers send
`Origin` on every module script, and Cloudflare caches that CORS response as a SEPARATE object
(2026-11-10: after the no-transform switch and a URL purge, header-less checks were all Brotli while
real Chrome still got 150 of 221 files uncompressed from the stale Origin variant). A purge must name
both variants too: `files: [{"url": ...}, {"url": ..., "headers": {"Origin": "https://uctintelligence.com"}}]`.

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


def get(url: str, accept: str, origin: str | None = None) -> tuple[int, dict, bytes]:
    headers = {"User-Agent": UA, "Accept-Encoding": accept, "Accept": "*/*"}
    if origin:
        headers["Origin"] = origin
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()


def decode(body: bytes, encoding: str) -> bytes:
    enc = (encoding or "").strip().lower()
    if enc in ("", "identity"):
        return body
    if enc == "gzip":
        return gzip.decompress(body)
    if enc == "zstd":
        raise ValueError("zstd on the wire: the Compression Rule must exclude it (72f1c438f8)")
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
        # The variant a browser actually gets: the same request with an Origin header.
        s2, h2, wire2 = get(f"{edge}/{name}{suffix}", "gzip, deflate, br, zstd", origin=edge)
        enc2 = h2.get("content-encoding", "")
        decoded2 = decode(wire2, enc2)
        row.update(status=status, encoding=enc or "identity", wire_bytes=len(wire), plain_bytes=len(plain),
                   cache=h.get("cf-cache-status", ""), cache_control=h.get("cache-control", ""),
                   origin_encoding=enc2 or "identity", origin_wire_bytes=len(wire2),
                   origin_cache_control=h2.get("cache-control", ""),
                   intact=decoded == plain and decoded2 == plain and s2 == 200)
        if not row["intact"]:
            row["detail"] = f"decoded {len(decoded)} B / Origin variant {len(decoded2)} B vs origin {len(plain)} B"
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
    by_enc_o: dict[str, int] = {}
    for r in rows:
        by_enc[r.get("encoding", "?")] = by_enc.get(r.get("encoding", "?"), 0) + 1
        by_enc_o[r.get("origin_encoding", "?")] = by_enc_o.get(r.get("origin_encoding", "?"), 0) + 1
    wire = sum(r.get("wire_bytes", 0) for r in rows)
    wire_o = sum(r.get("origin_wire_bytes", 0) for r in rows)
    plain = sum(r.get("plain_bytes", 0) for r in rows)
    pct = lambda w: (w / plain * 100 if plain else 0)
    print(f"assets checked: {len(rows)}  intact (both variants): {len(rows) - len(bad)}  broken: {len(bad)}")
    print(f"encodings, no Origin: {by_enc}   with Origin (what browsers get): {by_enc_o}")
    print(f"bytes on the wire: {wire:,} / with Origin {wire_o:,} of {plain:,} plain ({pct(wire):.1f}% / {pct(wire_o):.1f}%)")
    for r in bad[:30]:
        print(f"  BROKEN {r['asset']}: {r.get('detail', '')}")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"rows": rows}, f, indent=1)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
