"""Recap-poster backfill for Desk videos.

The Zoom-published Live Trading Sessions get a branded "Session Recap" poster in
the left rail; backfilled library videos didn't. This renders that same poster
for every enriched video that lacks one — server-side from already-stored
insights (no LLM, no YouTube, no proxy) — so the whole library is uniform with
the session standard. Idempotent.

    python scripts/backfill_posters.py            # all
    python scripts/backfill_posters.py 5          # first 5 (smoke test)
    python scripts/backfill_posters.py --base http://localhost:8000
"""
from __future__ import annotations

import os
import sys
import time

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _envpath in (os.path.join(_ROOT, ".env"), r"C:\Users\Patrick\uct-dashboard\.env"):
    if os.path.exists(_envpath):
        for _line in open(_envpath, encoding="utf-8"):
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
        break

BASE = "https://uctintelligence.com"
if "--base" in sys.argv:
    BASE = sys.argv[sys.argv.index("--base") + 1]
LIMIT = next((int(a) for a in sys.argv[1:] if a.isdigit()), None)
H = {
    "Authorization": f"Bearer {os.environ.get('PUSH_SECRET', '')}",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) uct-posters",
}


def main():
    r = requests.get(f"{BASE}/api/education/insights-backfill/needs-posters?limit=2000",
                     headers=H, timeout=30)
    r.raise_for_status()
    vids = r.json()["videos"]
    if LIMIT:
        vids = vids[:LIMIT]
    print(f"{len(vids)} enriched videos needing a recap poster\n")

    done = failed = 0
    for i, v in enumerate(vids, 1):
        vid, title = v["id"], (v["title"] or "")
        print(f"[{i}/{len(vids)}] {vid} — {title[:60]}")
        try:
            pr = requests.post(f"{BASE}/api/education/videos/{vid}/generate-poster",
                               headers=H, timeout=60)
        except Exception as e:
            print(f"    request failed ({type(e).__name__})"); failed += 1; continue
        if pr.ok:
            print("    ✓ poster rendered"); done += 1
        else:
            print(f"    HTTP {pr.status_code}: {pr.text[:140]}"); failed += 1
        time.sleep(0.3)

    print(f"\nDONE — {done} posters rendered · {failed} failed")


if __name__ == "__main__":
    main()
