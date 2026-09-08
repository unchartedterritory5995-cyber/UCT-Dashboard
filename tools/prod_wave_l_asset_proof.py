"""Prove Wave L is actually SERVING in production, from the emitted asset graph.

⛔⛔ TWO RULES THIS FILE EXISTS TO OBEY, both learned the hard way in Wave K:

  1. A BUNDLE GREP IS WORTHLESS WITHOUT THE ENTRY HASH. A sweep of 247 prod
     chunks once found ZERO Wave K markers — because `index.html` had been
     fetched while the OLD pod was still serving. **A stale artifact reads
     exactly like a missing feature.** So `/` is cache-busted, and the entry
     hash is recorded and reported alongside every verdict.

  2. A BUNDLE-ABSENCE CLAIM IS ONLY VALID AFTER A COMPLETE SWEEP. Never infer
     absence from `index-*.js` alone — code-split features live elsewhere (the
     Wave K markers turned out to live in a chunk Vite named after one of the
     panel's *importers*). This walks the WHOLE emitted graph reachable from the
     entry, and if it cannot, it labels the result **PARTIAL**.

    python tools/prod_wave_l_asset_proof.py --base https://uctintelligence.com
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import urllib.request

OUT_DIR = pathlib.Path(__file__).parent / "prod_asset_proof_out"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# ⛔ STRING LITERALS ONLY. Identifiers are renamed by minification; these are
# member-facing copy and route constants, which survive. Each names a distinct
# Slice-4/5 behaviour, so a partial deploy cannot pass by carrying one of them.
MARKERS = {
    "share_route": "/journal/share",
    "share_signin_testid": "share-signin",
    "storage_refusal_copy": "blocking storage for this site",
    "capture_connect_route": "/journal/capture-connect",
    # Slice 5: the context-derived destination label. Its presence is the only
    # asset-level evidence that the door passes a destination at all.
    "context_destination_label": "This note",
    # ── Wave M ─────────────────────────────────────────────────────────────
    # The source-kind-aware labels. Their PRESENCE is the asset-level evidence
    # that a web capture can no longer be rendered as "· p.N".
    "wave_m_captured_passage_label": "Captured passage",
    "wave_m_saved_passage_label": "Saved passage",
}


def fetch(url: str, timeout: int = 45) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,                     # Cloudflare 1010-blocks bare curl UAs
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://uctintelligence.com")
    args = ap.parse_args()
    OUT_DIR.mkdir(exist_ok=True)
    base = args.base.rstrip("/")

    # ── 1. Cache-bust the entry and record its hash. ────────────────────────
    import time
    html = fetch(f"{base}/?cb={int(time.time())}").decode("utf-8", "replace")
    entry = re.findall(r'src="(/assets/[^"]+\.js)"', html)
    css = re.findall(r'href="(/assets/[^"]+\.css)"', html)
    if not entry:
        print("FAIL: no entry script found in index.html", file=sys.stderr)
        return 2
    entry_hash = entry[0]

    # ── 2. Walk the whole emitted graph reachable from the entry. ───────────
    seen: set[str] = set()
    queue = list(entry) + list(css)
    contents: dict[str, str] = {}
    complete = True
    while queue:
        path = queue.pop(0)
        if path in seen:
            continue
        seen.add(path)
        try:
            body = fetch(f"{base}{path}").decode("utf-8", "replace")
        except Exception as e:                                    # noqa: BLE001
            complete = False
            print(f"  ! could not fetch {path}: {e}")
            continue
        contents[path] = body
        # Vite emits relative chunk specifiers inside each chunk; follow them.
        for ref in set(re.findall(r'["\'`](/assets/[A-Za-z0-9._\-]+\.(?:js|css))["\'`]', body)):
            if ref not in seen:
                queue.append(ref)
        # ⛔ THE DISCOVERY PATTERN THAT ACTUALLY MATCHES THIS BUILD. Vite emits
        # sibling chunk specifiers as bare `"./Name-hash.js"` — an earlier
        # version required `from` immediately before, found 4 assets out of
        # ~250, and reported COMPLETE. That is the mislabelled-partial-sweep
        # failure this module's header exists to prevent, committed inside the
        # tool that warns about it.
        for ref in set(re.findall(r"""["'`]\./([A-Za-z0-9._\-]+\.(?:js|css))["'`]""", body)):
            p2 = "/assets/" + ref
            if p2 not in seen:
                queue.append(p2)

    # ── 3. Where does each marker live? ────────────────────────────────────
    found: dict[str, list[str]] = {}
    for name, needle in MARKERS.items():
        hits = [p for p, body in contents.items() if needle in body]
        found[name] = hits

    missing = [n for n, h in found.items() if not h]
    # ⛔ A SANITY FLOOR ON "COMPLETE". Every fetch succeeding is not proof the
    # WALK was complete — a discovery pattern that matches nothing also throws
    # no errors. This build emits ~100+ chunks; anything near-empty means the
    # walker, not the deploy, is what is missing.
    if len(contents) < 20:
        complete = False
    verdict = "COMPLETE" if complete else "PARTIAL"

    report = {
        "base": base,
        "entry": entry_hash,
        "sweep": verdict,
        "assets_swept": len(contents),
        "markers": {n: {"present": bool(h), "chunks": h} for n, h in found.items()},
        "missing": missing,
    }
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"entry            : {entry_hash}")
    print(f"assets swept     : {len(contents)}  ({verdict})")
    for n, h in found.items():
        where = h[0] if h else "-"
        print(f"  {'OK  ' if h else 'MISS'} {n:28} {where}")
    if verdict == "PARTIAL":
        print("\n⚠️  PARTIAL SWEEP — an absence claim from this run is NOT valid.")
    print(f"\nreport: {OUT_DIR / 'report.json'}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
